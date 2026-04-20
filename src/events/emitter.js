'use strict';

const EventEmitter = require('events');

const supervisionEvents = new EventEmitter();

const EVENTS = {
  SUPERVISION_STARTED: 'supervision.started',
  SUPERVISION_ENDED: 'supervision.ended',
  MODE_CHANGED: 'mode.changed',
  TRANSITION_FAILED: 'transition.failed',
  CLEANUP_COMPLETED: 'cleanup.completed',
};

function emit(event, payload) {
  supervisionEvents.emit(event, {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

module.exports = { supervisionEvents, EVENTS, emit };
