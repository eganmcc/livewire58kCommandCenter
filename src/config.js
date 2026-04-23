'use strict';

const config = {
  bridge: {
    url: process.env.BRIDGE_URL || 'http://10.0.3.230:3100',
  },
  ari: {
    url: process.env.ARI_URL || 'https://10.0.3.229:8089',
    username: process.env.ARI_USERNAME || 'asterisk',
    password: process.env.ARI_PASSWORD || '',
  },
  redis: {
    host: process.env.REDIS_HOST || '10.0.3.230',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
  http: {
    port: parseInt(process.env.HTTP_PORT, 10) || 3050,
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
