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

async function getActiveCalls() {
  const config = require('../config');
  const redis = require('../state/redis');
  const auth = Buffer.from(`${config.ari.username}:${config.ari.password}`).toString('base64');
  const ariOpts = {
    headers: { Authorization: `Basic ${auth}` },
    ...(config.ari.url.startsWith('https') ? { agent: new (require('https').Agent)({ rejectUnauthorized: false }) } : {}),
  };

  // Fetch bridges and channels from ARI in parallel
  const [bridgesRes, channelsRes] = await Promise.all([
    fetch(`${config.ari.url}/ari/bridges`, ariOpts),
    fetch(`${config.ari.url}/ari/channels`, ariOpts),
  ]);

  if (!bridgesRes.ok || !channelsRes.ok) {
    throw new Error(`ARI request failed: bridges=${bridgesRes.status}, channels=${channelsRes.status}`);
  }

  const bridges = await bridgesRes.json();
  const channels = await channelsRes.json();

  // Index channels by ID
  const channelMap = {};
  for (const ch of channels) {
    channelMap[ch.id] = ch;
  }

  // Keep call-like bridges with 2+ channels. Exclude known non-call bridge families.
  const activeBridges = bridges.filter(
    (b) => {
      if (!b || !Array.isArray(b.channels) || b.channels.length < 2) return false;
      const name = (b.name || '').toLowerCase();
      if (name.startsWith('rec-agent-')) return false;
      if (name.includes('supervisor')) return false;
      return true;
    }
  );

  // Build call list with channel details + Redis metadata
  const redisClient = redis.getRedis();
  const calls = await Promise.all(
    activeBridges.map(async (b) => {
      const ch1 = channelMap[b.channels[0]];
      const ch2 = channelMap[b.channels[1]];

      // Try to find Redis call metadata for any channel in this bridge
      let meta = null;
      for (const chId of b.channels) {
        try {
          const raw = await redisClient.get(`active_calls:${chId}`);
          if (raw) { meta = JSON.parse(raw); break; }
        } catch {}
      }

      return {
        bridgeId: b.id,
        createdAt: b.creationtime,
        channelCount: b.channels.length,
        caller: ch1 ? {
          number: ch1.caller?.number || '?',
          name: ch1.caller?.name || '',
          state: ch1.state,
        } : null,
        agent: ch2 ? {
          number: ch2.connected?.number || ch2.caller?.number || '?',
          name: ch2.connected?.name || ch2.caller?.name || '',
          state: ch2.state,
        } : null,
        custNo: meta?.custNo || null,
        leadId: meta?.leadId || null,
        startedAt: meta?.startedAt || b.creationtime,
      };
    })
  );

  // Only show calls recognized by the bridge hub.
  // This prevents UI actions (spy/whisper/barge) on ARI bridges that the hub cannot supervise.
  const validated = await Promise.all(
    calls.map(async (c) => {
      try {
        await getSupervisionStatus(c.bridgeId);
        return c;
      } catch (err) {
        if (err.status !== 404) {
          logger.warn({ bridgeId: c.bridgeId, status: err.status, err: err.message }, 'Skipping unjoinable call');
        }
        return null;
      }
    })
  );

  return validated
    .filter(Boolean);
}

module.exports = {
  healthCheck,
  joinSupervision,
  leaveSupervision,
  switchMode,
  getSupervisionStatus,
  getActiveCalls,
};
