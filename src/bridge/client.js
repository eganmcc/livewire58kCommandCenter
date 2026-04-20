'use strict';

const logger = require('../logger');
const config = require('../config');

async function request(method, path, body) {
  const url = `${config.bridge.url}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  logger.debug({ method, url }, 'Bridge API request');

  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(data.error || data.message || `Bridge API ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

async function healthCheck() {
  return request('GET', '/api/health');
}

async function joinSupervision(bridgeId, supervisorExtension, mode) {
  return request('POST', '/api/supervisor/join', {
    bridgeId,
    supervisorExtension,
    mode: mode || 'monitor',
  });
}

async function leaveSupervision(bridgeId) {
  return request('POST', '/api/supervisor/leave', { bridgeId });
}

async function switchMode(bridgeId, mode) {
  return request('POST', '/api/supervisor/mode', { bridgeId, mode });
}

async function getSupervisionStatus(bridgeId) {
  return request('GET', `/api/calls/${encodeURIComponent(bridgeId)}/supervisor`);
}

module.exports = {
  healthCheck,
  joinSupervision,
  leaveSupervision,
  switchMode,
  getSupervisionStatus,
};
