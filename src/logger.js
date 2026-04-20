'use strict';

const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.log.level,
  transport: {
    target: 'pino/file',
    options: { destination: 1 },
  },
});

module.exports = logger;
