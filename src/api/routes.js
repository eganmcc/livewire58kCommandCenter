'use strict';

const express = require('express');
const logger = require('../logger');
const manager = require('../supervisor/manager');

const bridge = require('../bridge/client');

const router = express.Router();

// GET /api/supervision/calls — active calls from ARI
router.get('/calls', async (req, res) => {
  try {
    const calls = await bridge.getActiveCalls();
    res.json({ ok: true, calls });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /calls failed');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supervision/start
router.post('/start', async (req, res) => {
  const { bridgeId, supervisorExtension, mode } = req.body;

  if (!bridgeId || !supervisorExtension) {
    return res.status(400).json({ error: 'Missing required fields: bridgeId, supervisorExtension' });
  }

  try {
    const session = await manager.startSupervision(bridgeId, supervisorExtension, mode);
    res.json({ ok: true, session });
  } catch (err) {
    logger.error({ err, bridgeId }, 'POST /start failed');
    const isCallNotFound = /call not found/i.test(err.message || '');
    const status = isCallNotFound ? 404 : (err.status || 500);
    const error = isCallNotFound
      ? `Call ${bridgeId} is not currently available for supervision in bridge service`
      : (err.code === 'SUPERVISOR_NOT_ATTACHED'
        ? `Spy/Whisper did not attach the supervisor endpoint. Session was cleared. Reconnect WebSIP and try again.`
        : err.message);
    res.status(status).json({ error });
  }
});

// POST /api/supervision/mode
router.post('/mode', async (req, res) => {
  const { bridgeId, mode } = req.body;

  if (!bridgeId || !mode) {
    return res.status(400).json({ error: 'Missing required fields: bridgeId, mode' });
  }

  const validModes = ['monitor', 'whisper', 'barge'];
  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}` });
  }

  try {
    const session = await manager.changeMode(bridgeId, mode);
    res.json({ ok: true, session });
  } catch (err) {
    logger.error({ err, bridgeId }, 'POST /mode failed');
    const isSnoopFailure = /snoop channel could not be created|\/snoop returned 500/i.test(err.message || '');
    const status = isSnoopFailure ? 409 : (err.status || 500);
    let error;
    if (err.code === 'STALE_SESSION_CLEARED') {
      error = `Supervisor disconnected during mode change. Session cleared for ${bridgeId}. Start supervision again.`;
    } else if (err.code === 'SUPERVISOR_NOT_ATTACHED') {
      error = 'Spy/Whisper did not attach the supervisor endpoint. Session was cleared. Reconnect WebSIP and try again.';
    } else if (isSnoopFailure) {
      error = 'Whisper/Spy failed because snoop could not be created on this call. Retry once, or use Barge for this call.';
    } else {
      error = err.message;
    }
    res.status(status).json({ error });
  }
});

// POST /api/supervision/stop
router.post('/stop', async (req, res) => {
  const { bridgeId } = req.body;

  if (!bridgeId) {
    return res.status(400).json({ error: 'Missing required field: bridgeId' });
  }

  try {
    await manager.stopSupervision(bridgeId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, bridgeId }, 'POST /stop failed');
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/supervision/status/:bridgeId — queries ARI Bridge directly
router.get('/status/:bridgeId', async (req, res) => {
  try {
    const result = await manager.getRemoteStatus(req.params.bridgeId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/supervision/sessions — local tracked sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await manager.reconcileSessions();
    res.json({ ok: true, sessions });
  } catch (err) {
    logger.error({ err }, 'GET /sessions failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
