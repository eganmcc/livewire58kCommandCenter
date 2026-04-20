# Livewire 58K Command Center

ARI-based supervisor command center for real-time call supervision — listen, whisper, and barge.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Command Center                  │
│                                                  │
│  ┌──────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ REST API │  │ WebSocket  │  │ Orphan Sweep │ │
│  │ (Express)│  │  Server    │  │  (periodic)  │ │
│  └────┬─────┘  └─────┬──────┘  └──────┬───────┘ │
│       │               │               │         │
│       └───────┬───────┘               │         │
│               ▼                       │         │
│  ┌────────────────────────┐           │         │
│  │   Supervision Manager  │◄──────────┘         │
│  │  (state machine + lock)│                     │
│  └───────────┬────────────┘                     │
│              ▼                                  │
│  ┌────────────────────────┐                     │
│  │   Topology Builder     │                     │
│  │  (snoop/bridge ops)    │                     │
│  └───────────┬────────────┘                     │
│              │                                  │
│   ┌──────────┴──────────┐                       │
│   ▼                     ▼                       │
│ ┌─────┐           ┌─────────┐                   │
│ │ ARI │           │  Redis  │                   │
│ └─────┘           │ (cache) │                   │
│                   └─────────┘                   │
└─────────────────────────────────────────────────┘
```

---

## Project Structure

```
src/
├── api/
│   └── routes.js              REST endpoints for supervision control
├── ari/
│   └── connection.js          ARI client connection, reconnect, resource checks
├── events/
│   ├── emitter.js             Event schema and in-process event emitter
│   └── wsServer.js            WebSocket server — relays events to supervisor UI
├── state/
│   └── redis.js               Redis state layer (read/write supervision state)
├── supervisor/
│   ├── ariEvents.js           ARI event handlers (ChannelDestroyed, BridgeDestroyed)
│   ├── manager.js             Core state machine — start, changeMode, stop, cleanup
│   ├── orphanSweep.js         Periodic Redis↔ARI reconciliation
│   └── topology.js            Snoop channel and bridge lifecycle management
├── utils/
│   ├── helpers.js             waitForCondition with retry/timeout, sleep
│   └── transitionLock.js      Per-call mutex with TTL deadlock protection
├── config.js                  Environment-based configuration
├── logger.js                  Pino logger
└── index.js                   Application entry point
```

---

## Supervision Modes

### Listen
Supervisor hears the call without being heard by either party.

```
Bridge A (main call)         Bridge B (supervision)
┌──────────────────┐        ┌──────────────────────┐
│  Caller           │        │  Snoop (spy only)     │
│  Agent            │───────▶│  Supervisor           │
└──────────────────┘        └──────────────────────┘
         snoop on agent channel (spy=in, whisper=none)
```

### Whisper
Supervisor can speak to the agent only. Caller cannot hear the supervisor.

```
Bridge A (main call)         Bridge B (supervision)
┌──────────────────┐        ┌──────────────────────┐
│  Caller           │        │  Snoop (spy+whisper)  │
│  Agent            │───────▶│  Supervisor           │
└──────────────────┘        └──────────────────────┘
         snoop on agent channel (spy=in, whisper=in)
```

### Barge
Supervisor joins the main call directly. All parties can hear each other.

```
Bridge A (main call)
┌──────────────────┐
│  Caller           │
│  Agent            │
│  Supervisor       │
└──────────────────┘
   (no snoop, no Bridge B)
```

---

## Mode Transition Sequence

Every transition follows a strict 7-step protocol:

1. **Lock** — acquire per-call transition mutex (10s TTL)
2. **Teardown** — destroy old snoop channel and supervision bridge
3. **Verify** — poll ARI to confirm resources are gone
4. **Build** — create new topology for the target mode
5. **Update** — write new state to in-memory map + Redis
6. **Emit** — fire event to WebSocket clients
7. **Unlock** — release transition lock

If step 4 fails, the system attempts **rollback** to the previous mode. If rollback also fails, a **full cleanup** removes all supervision resources and ends the session.

---

## API Reference

All endpoints use JSON request/response bodies.

### POST `/api/supervision/start`
Begin supervising a call in listen mode.

**Request:**
```json
{
  "callId": "call-123",
  "supervisorChannelId": "PJSIP/supervisor-00000001",
  "agentChannelId": "PJSIP/agent-00000002",
  "mainBridgeId": "bridge-main-456"
}
```

**Response (200):**
```json
{
  "ok": true,
  "session": {
    "callId": "call-123",
    "supervisorChannelId": "PJSIP/supervisor-00000001",
    "agentChannelId": "PJSIP/agent-00000002",
    "mainBridgeId": "bridge-main-456",
    "supervisionBridgeId": "sup-bridge-abc",
    "snoopChannelId": "snoop-def",
    "mode": "listen",
    "startedAt": "2026-04-20T12:00:00.000Z"
  }
}
```

### POST `/api/supervision/mode`
Change supervision mode.

**Request:**
```json
{
  "callId": "call-123",
  "mode": "whisper"
}
```
Valid modes: `listen`, `whisper`, `barge`

### POST `/api/supervision/stop`
End supervision and clean up all resources.

**Request:**
```json
{
  "callId": "call-123"
}
```

### GET `/api/supervision/status/:callId`
Get the current supervision session for a call.

### GET `/api/supervision/sessions`
List all active supervision sessions.

### GET `/health`
Health check — returns `{ "status": "ok", "uptime": 123.45 }`.

---

## WebSocket Events

Connect to `ws://host:3051`. All events are JSON with this shape:

```json
{
  "event": "supervision.started",
  "timestamp": "2026-04-20T12:00:00.000Z",
  "callId": "call-123",
  "..."
}
```

| Event | Fired When |
|---|---|
| `supervision.started` | Supervisor begins listening to a call |
| `mode.changed` | Mode transitions (listen→whisper, etc.) |
| `supervision.ended` | Supervisor stops supervising |
| `transition.failed` | A mode change failed (includes error) |
| `cleanup.completed` | Full cleanup finished after a failure |

---

## Safety Guarantees

Per the go-live safety spec, the following are enforced:

| Rule | Implementation |
|---|---|
| **Single transition at a time** | Per-call `TransitionLock` mutex — concurrent transitions throw immediately |
| **Deadlock protection** | Lock has a 10-second TTL — auto-releases if transition hangs |
| **ARI is source of truth** | Orphan sweep compares Redis state against live ARI resources every 30s |
| **Explicit snoop cleanup** | `ChannelDestroyed` event handler triggers `fullCleanup()` — no reliance on auto-cleanup |
| **Verified teardown** | `waitForCondition` polls ARI (200ms interval, 15 retries) to confirm resources are destroyed |
| **Rollback on failure** | Failed transitions attempt to restore previous mode before falling back to full cleanup |
| **Single supervisor** | `startSupervision` rejects if a supervisor is already active on the call |
| **Channel loss detection** | Destruction of supervisor, agent, or snoop channel triggers automatic cleanup |

---

## Configuration

Copy `.env.example` to `.env`:

```env
ARI_URL=http://localhost:8088
ARI_USERNAME=asterisk
ARI_PASSWORD=asterisk
ARI_APP=command-center

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

HTTP_PORT=3050
WS_PORT=3051

LOG_LEVEL=info
```

Tunable supervision parameters in `src/config.js`:

| Parameter | Default | Purpose |
|---|---|---|
| `transitionLockTtlMs` | 10000 | Max time a transition lock can be held |
| `cleanupPollIntervalMs` | 200 | Polling interval for cleanup verification |
| `cleanupPollMaxRetries` | 15 | Max polls before declaring cleanup failed |
| `orphanSweepIntervalMs` | 30000 | How often to reconcile Redis vs ARI |

---

## Running

```bash
npm start        # production
npm run dev      # with --watch (auto-restart on file changes)
```

Requires a running Asterisk instance with ARI enabled and a Redis server.
