'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const logger = require('./logger');
const config = require('./config');
const redis = require('./state/redis');
const bridge = require('./bridge/client');
const wsServer = require('./events/wsServer');
const apiRoutes = require('./api/routes');
const manager = require('./supervisor/manager');

async function main() {
  logger.info('Starting Livewire 58K Command Center');

  // 1. Connect Redis
  redis.connect();

  // 2. Restore sessions from Redis
  await manager.initialize();

  // 3. Verify ARI Bridge is reachable
  const health = await bridge.healthCheck();
  logger.info({ bridge: health }, 'ARI Bridge connected');

  // 4. Start HTTP + WebSocket on a single port
  const app = express();
  app.use(express.json());
  app.use(express.static('public'));
  app.use('/api/supervision', apiRoutes);

  app.get('/health', async (req, res) => {
    let bridgeOk = false;
    try {
      await bridge.healthCheck();
      bridgeOk = true;
    } catch {}
    res.json({
      status: bridgeOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      bridge: bridgeOk,
    });
  });

  const server = http.createServer(app);
  wsServer.attach(server);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn({ port: config.http.port }, 'Port in use — retrying in 1s');
      setTimeout(() => server.listen(config.http.port), 1000);
    } else {
      throw err;
    }
  });

  server.listen(config.http.port, () => {
    logger.info({ port: config.http.port }, 'HTTP + WebSocket server started');
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down');
    wsServer.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to start Command Center');
  process.exit(1);
});
