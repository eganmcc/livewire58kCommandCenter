'use strict';

const logger = require('../logger');
const bridge = require('../bridge/client');
const redis = require('../state/redis');
const { emit, EVENTS } = require('../events/emitter');

const activeSessions = new Map();

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

  const result = await bridge.joinSupervision(bridgeId, supervisorExtension, mode);

  const session = {
    bridgeId,
    supervisorExtension,
    mode: mode || 'monitor',
    supervisor: result.supervisor,
    startedAt: new Date().toISOString(),
  };

  activeSessions.set(bridgeId, session);
  await redis.setSupervisionState(bridgeId, session);

  emit(EVENTS.SUPERVISION_STARTED, {
    bridgeId,
    supervisorExtension,
    mode: session.mode,
  });

  logger.info({ bridgeId, mode: session.mode }, 'Supervision started');
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

  const result = await bridge.switchMode(bridgeId, newMode);

  session.mode = newMode;
  session.supervisor = result.supervisor;
  activeSessions.set(bridgeId, session);
  await redis.setSupervisionState(bridgeId, session);

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

  await bridge.leaveSupervision(bridgeId);

  activeSessions.delete(bridgeId);
  await redis.deleteSupervisionState(bridgeId);

  emit(EVENTS.SUPERVISION_ENDED, {
    bridgeId,
    supervisorExtension: session.supervisorExtension,
    lastMode: session.mode,
  });

  logger.info({ bridgeId }, 'Supervision stopped');
}

async function getRemoteStatus(bridgeId) {
  return bridge.getSupervisionStatus(bridgeId);
}

function getAllSessions() {
  return Array.from(activeSessions.values());
}

module.exports = {
  startSupervision,
  changeMode,
  stopSupervision,
  getRemoteStatus,
  getSession,
  hasActiveSupervisor,
  getAllSessions,
};
