'use strict';

const Redis = require('ioredis');
const logger = require('../logger');
const config = require('../config');

let redis = null;

function connect() {
  redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      logger.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting');
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('error', (err) => logger.error({ err }, 'Redis error'));

  return redis;
}

function getRedis() {
  if (!redis) throw new Error('Redis not connected. Call connect() first.');
  return redis;
}

const PREFIX = 'sup:';

async function getSupervisionState(callId) {
  const raw = await getRedis().get(`${PREFIX}${callId}`);
  return raw ? JSON.parse(raw) : null;
}

async function setSupervisionState(callId, state) {
  await getRedis().set(`${PREFIX}${callId}`, JSON.stringify(state));
}

async function deleteSupervisionState(callId) {
  await getRedis().del(`${PREFIX}${callId}`);
}

async function getAllSupervisionKeys() {
  return getRedis().keys(`${PREFIX}*`);
}

module.exports = {
  connect,
  getRedis,
  getSupervisionState,
  setSupervisionState,
  deleteSupervisionState,
  getAllSupervisionKeys,
};
