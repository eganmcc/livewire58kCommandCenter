'use strict';

const WebSocket = require('ws');
const logger = require('../logger');
const config = require('../config');
const { supervisionEvents, EVENTS } = require('../events/emitter');

let wss = null;

function attach(httpServer) {
  wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws) => {
    logger.info('WebSocket client connected');
    ws.on('close', () => logger.info('WebSocket client disconnected'));
  });

  // Forward all supervision events to connected clients
  Object.values(EVENTS).forEach((eventName) => {
    supervisionEvents.on(eventName, (payload) => {
      broadcast(payload);
    });
  });

  logger.info('WebSocket server attached');
}

function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function stop() {
  if (wss) {
    wss.close();
    wss = null;
  }
}

module.exports = { attach, stop, broadcast };
