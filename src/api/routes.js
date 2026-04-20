'use strict';

const express = require('express');
const logger = require('../logger');
const manager = require('../supervisor/manager');

const router = express.Router();

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
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
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
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
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
router.get('/sessions', (req, res) => {
  res.json({ ok: true, sessions: manager.getAllSessions() });
});

module.exports = router;
