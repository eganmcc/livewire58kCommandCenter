'use strict';

const logger = require('../logger');
const bridge = require('../bridge/client');
const redis = require('../state/redis');
const { emit, EVENTS } = require('../events/emitter');

const activeSessions = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotFoundError(err) {
  const message = (err && err.message ? err.message : '').toLowerCase();
  return (
    message.includes('channel not found') ||
    message.includes('call not found') ||
    message.includes('no supervisor on this call') ||
    message.includes('no active supervision')
  );
}

function isSnoopCreateError(err) {
  const message = (err && err.message ? err.message : '').toLowerCase();
  return (
    message.includes('snoop channel could not be created') ||
    message.includes('/snoop returned 500') ||
    message.includes('failed to create snoop')
  );
}

function hasAttachedSupervisor(status) {
  return Boolean(status && status.supervisor);
}

async function assertAttachedForSnoopModes(bridgeId, mode) {
  if (mode === 'barge') return;

  // Give bridge a brief window to finalize snoop/supervisor state.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const status = await bridge.getSupervisionStatus(bridgeId);
      if (hasAttachedSupervisor(status)) return;
    } catch (err) {
      if (!isNotFoundError(err)) {
        logger.warn({ bridgeId, mode, attempt, err: err.message }, 'Status check failed while verifying supervisor attachment');
      }
    }
    await delay(250);
  }

  const attachErr = new Error('Supervisor was not attached for spy/whisper mode');
  attachErr.status = 409;
  attachErr.code = 'SUPERVISOR_NOT_ATTACHED';
  throw attachErr;
}

async function clearSession(bridgeId, reason) {
  const session = getSession(bridgeId);
  if (!session) return;

  activeSessions.delete(bridgeId);
  await redis.deleteSupervisionState(bridgeId);

  emit(EVENTS.SUPERVISION_ENDED, {
    bridgeId,
    supervisorExtension: session.supervisorExtension,
    lastMode: session.mode,
    reason,
  });

  logger.info({ bridgeId, reason }, 'Supervision session cleared');
}

function getSession(bridgeId) {
  return activeSessions.get(bridgeId) || null;
}

function hasActiveSupervisor(bridgeId) {
  return activeSessions.has(bridgeId);
}

async function startSupervision(bridgeId, supervisorExtension, mode) {
  if (hasActiveSupervisor(bridgeId)) {
    throw new Error(`Bridge ${bridgeId} already has an active supervisor`);
  }

  const requestedMode = mode || 'monitor';

  let result;
  try {
    result = await bridge.joinSupervision(bridgeId, supervisorExtension, requestedMode);
  } catch (err) {
    throw err;
  }

  const session = {
    bridgeId,
    supervisorExtension,
    mode: requestedMode,
    supervisor: result.supervisor,
    startedAt: new Date().toISOString(),
  };

  activeSessions.set(bridgeId, session);
  await redis.setSupervisionState(bridgeId, session);

  try {
    await assertAttachedForSnoopModes(bridgeId, requestedMode);
  } catch (err) {
    try {
      await bridge.leaveSupervision(bridgeId);
    } catch (_) {}
    await clearSession(bridgeId, 'supervisor-not-attached');
    throw err;
  }

  emit(EVENTS.SUPERVISION_STARTED, {
    bridgeId,
    supervisorExtension,
    mode: requestedMode,
  });

  logger.info({ bridgeId, mode: requestedMode }, 'Supervision started');
  return session;
}

async function changeMode(bridgeId, newMode) {
  const session = getSession(bridgeId);
  if (!session) {
    throw new Error(`No active supervision for bridge ${bridgeId}`);
  }

  if (session.mode === newMode) {
    logger.warn({ bridgeId, mode: newMode }, 'Already in requested mode');
    return session;
  }

  const previousMode = session.mode;

  let result;
  try {
    result = await bridge.switchMode(bridgeId, newMode);
  } catch (err) {
    if (newMode !== 'barge' && isSnoopCreateError(err)) {
      logger.warn({ bridgeId, newMode }, 'Snoop creation failed on mode change; retrying switch once');

      // Fast retry for transient ARI timing issues.
      try {
        await delay(250);
        result = await bridge.switchMode(bridgeId, newMode);
      } catch (retryErr) {
        logger.warn({ bridgeId, newMode }, 'Switch retry failed; attempting full rejoin in requested mode');

        // Rebuild supervision for the same supervisor extension as a stronger recovery path.
        const supervisorExtension = session.supervisorExtension;
        try {
          await bridge.leaveSupervision(bridgeId);
        } catch (leaveErr) {
          if (!isNotFoundError(leaveErr)) {
            throw leaveErr;
          }
        }

        let joinResult;
        try {
          joinResult = await bridge.joinSupervision(bridgeId, supervisorExtension, newMode);
        } catch (rejoinErr) {
          if (isNotFoundError(rejoinErr)) {
            await clearSession(bridgeId, 'remote-session-missing');
            const staleErr = new Error('Supervisor disconnected during mode change. Session cleared for this call. Reconnect WebSIP and start supervision again.');
            staleErr.status = 409;
            staleErr.code = 'STALE_SESSION_CLEARED';
            throw staleErr;
          }
          throw rejoinErr;
        }

        const recoveredSession = {
          bridgeId,
          supervisorExtension,
          mode: newMode,
          supervisor: joinResult.supervisor,
          startedAt: session.startedAt || new Date().toISOString(),
        };

        activeSessions.set(bridgeId, recoveredSession);
        await redis.setSupervisionState(bridgeId, recoveredSession);

        try {
          await assertAttachedForSnoopModes(bridgeId, newMode);
        } catch (verifyErr) {
          try {
            await bridge.leaveSupervision(bridgeId);
          } catch (_) {}
          await clearSession(bridgeId, 'supervisor-not-attached');
          throw verifyErr;
        }

        emit(EVENTS.MODE_CHANGED, {
          bridgeId,
          previousMode,
          newMode,
          supervisorExtension,
          recovered: true,
        });

        logger.warn({ bridgeId, previousMode, newMode }, 'Recovered mode change by full supervision rejoin');
        return recoveredSession;
      }
    }

    if (isNotFoundError(err)) {
      const supervisorExtension = session.supervisorExtension;
      await clearSession(bridgeId, 'remote-session-missing');

      // Try to self-heal stale session on a mode click by rejoining directly in the requested mode.
      try {
        const joinResult = await bridge.joinSupervision(bridgeId, supervisorExtension, newMode);
        const recoveredSession = {
          bridgeId,
          supervisorExtension,
          mode: newMode,
          supervisor: joinResult.supervisor,
          startedAt: new Date().toISOString(),
        };

        activeSessions.set(bridgeId, recoveredSession);
        await redis.setSupervisionState(bridgeId, recoveredSession);

        try {
          await assertAttachedForSnoopModes(bridgeId, newMode);
        } catch (verifyErr) {
          try {
            await bridge.leaveSupervision(bridgeId);
          } catch (_) {}
          await clearSession(bridgeId, 'supervisor-not-attached');
          throw verifyErr;
        }

        emit(EVENTS.SUPERVISION_STARTED, {
          bridgeId,
          supervisorExtension,
          mode: newMode,
          recovered: true,
        });

        logger.warn({ bridgeId, newMode }, 'Recovered stale session by rejoining supervision');
        return recoveredSession;
      } catch (rejoinErr) {
        const staleErr = new Error('Supervisor disconnected during mode change. Session cleared for this call. Reconnect WebSIP and start supervision again.');
        staleErr.status = 409;
        staleErr.code = 'STALE_SESSION_CLEARED';
        throw staleErr;
      }
    }
    throw err;
  }

  session.mode = newMode;
  session.supervisor = result.supervisor;
  activeSessions.set(bridgeId, session);
  await redis.setSupervisionState(bridgeId, session);

  try {
    await assertAttachedForSnoopModes(bridgeId, newMode);
  } catch (err) {
    try {
      await bridge.leaveSupervision(bridgeId);
    } catch (_) {}
    await clearSession(bridgeId, 'supervisor-not-attached');
    throw err;
  }

  emit(EVENTS.MODE_CHANGED, {
    bridgeId,
    previousMode,
    newMode,
    supervisorExtension: session.supervisorExtension,
  });

  logger.info({ bridgeId, previousMode, newMode }, 'Mode changed');
  return session;
}

async function stopSupervision(bridgeId) {
  const session = getSession(bridgeId);
  if (!session) {
    logger.warn({ bridgeId }, 'No active supervision to stop');
    return;
  }

  try {
    await bridge.leaveSupervision(bridgeId);
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
    logger.warn({ bridgeId, err: err.message }, 'Remote supervision already gone; clearing local session');
  }

  await clearSession(bridgeId, 'stopped');
}

async function getRemoteStatus(bridgeId) {
  return bridge.getSupervisionStatus(bridgeId);
}

function getAllSessions() {
  return Array.from(activeSessions.values());
}

async function reconcileSessions() {
  const sessions = getAllSessions();

  for (const session of sessions) {
    try {
      const status = await bridge.getSupervisionStatus(session.bridgeId);

      // For spy/whisper flows, a null supervisor means bridge has no attached supervisor anymore.
      if (session.mode !== 'barge' && !hasAttachedSupervisor(status)) {
        await clearSession(session.bridgeId, 'remote-session-missing');
      }
    } catch (err) {
      if (isNotFoundError(err)) {
        await clearSession(session.bridgeId, 'remote-session-missing');
      } else {
        logger.warn(
          { bridgeId: session.bridgeId, err: err.message, status: err.status },
          'Failed to reconcile supervision session'
        );
      }
    }
  }

  return getAllSessions();
}

async function initialize() {
  logger.info('Initializing supervisor manager - restoring sessions from Redis');
  
  try {
    const keys = await redis.getAllSupervisionKeys();
    logger.info({ count: keys.length }, 'Found supervision keys in Redis');
    
    for (const key of keys) {
      const bridgeId = key.replace(/^sup:/, '');
      const sessionData = await redis.getSupervisionState(bridgeId);
      
      if (sessionData) {
        activeSessions.set(bridgeId, sessionData);
        logger.info({ bridgeId, mode: sessionData.mode }, 'Restored session from Redis');
      }
    }
    
    logger.info({ restored: activeSessions.size }, 'Session restoration complete');
  } catch (err) {
    logger.error({ err }, 'Failed to restore sessions from Redis');
  }
}

module.exports = {
  initialize,
  startSupervision,
  changeMode,
  stopSupervision,
  getRemoteStatus,
  getSession,
  hasActiveSupervisor,
  getAllSessions,
  reconcileSessions,
};
