# Command Center — Production Deployment Guide

**Created:** April 20, 2026  
**Based on:** Last successful deployment (v1.2.7 — ARI Bridge, April 19, 2026)  
**Purpose:** Comprehensive deployment reference for the Livewire 58K Command Center (supervisor listen/whisper/barge)

---

## 1. Target Server

| Item | Value |
|---|---|
| **Production IP** | `10.0.3.230` |
| **Hostname** | `livewire.ptdika.local` |
| **OS** | Ubuntu 22.04.5 LTS |
| **Role** | Application server — runs all Node.js services, Redis, PostgreSQL, Nginx |
| **Asterisk PBX** | `10.0.3.229` (separate server — ARI HTTPS on port 8089, Asterisk 18.16.0) |

### Why 10.0.3.230?

All existing services (ARI Bridge, Voice API, Agent Dashboard, WebSIP Client, Dialer) run on this server. The Command Center connects to the same ARI, Redis, and PostgreSQL — co-locating avoids network latency for Redis/PG calls and simplifies Nginx routing.

---

## 2. Access Method

### SSH

```bash
ssh -i /c/aws/id-ed25519 egan@10.0.3.230
```

| Item | Value |
|---|---|
| **User** | `egan` |
| **Auth** | ED25519 key at `/c/aws/id-ed25519` (from Windows dev machine) |
| **Home directory** | `/home/egan/` |
| **Sudo** | Available (used for Nginx config changes) |

### Deployment Pipeline

There is **no CI/CD pipeline**. Deployment is manual via SCP + PM2:

```bash
# 1. From local dev machine (Git Bash / Windows)
cd /d/repos/livewire58kCommandCenter

# 2. Push code to GitHub
git add -A && git commit -m "description"
git push origin <branch>

# 3. SCP files to server
scp -i /c/aws/id-ed25519 -r src/ package.json .env egan@10.0.3.230:/home/egan/livewire58kCommandCenter/

# 4. SSH to server and install/restart
ssh -i /c/aws/id-ed25519 egan@10.0.3.230
cd ~/livewire58kCommandCenter
npm install --production
source .env && export ARI_URL ARI_USERNAME ARI_PASSWORD ARI_APP REDIS_HOST REDIS_PORT REDIS_PASSWORD HTTP_PORT WS_PORT LOG_LEVEL
pm2 start src/index.js --name command-center
pm2 save
```

### Git Repository

| Item | Value |
|---|---|
| **Organization** | `IT-PTDIKA` |
| **ARI Bridge repo** | `IT-PTDIKA/ari-communication-hub-58k-new` |
| **Command Center repo** | TBD (create under same org) |
| **Current branch (bridge)** | `call-recording-whisper-barging-features` |

---

## 3. Production Configuration

### Environment Variables (.env)

```env
# ─── ARI Connection ───────────────────────────────────────
ARI_URL=https://10.0.3.229:8089
ARI_USERNAME=asterisk
ARI_PASSWORD=D1k4@4r1#D1k4
ARI_APP=command-center

# ─── Redis ────────────────────────────────────────────────
REDIS_HOST=10.0.3.230
REDIS_PORT=6379
REDIS_PASSWORD=D1k4@r3d15

# ─── HTTP & WebSocket ────────────────────────────────────
HTTP_PORT=3050
WS_PORT=3051

# ─── Bridge Integration ──────────────────────────────────
BRIDGE_URL=http://localhost:3100

# ─── Logging ─────────────────────────────────────────────
LOG_LEVEL=info

# ─── TLS (required — Asterisk uses self-signed cert) ─────
NODE_TLS_REJECT_UNAUTHORIZED=0

# ─── Node ────────────────────────────────────────────────
NODE_ENV=production
```

### Config Values: Dev vs Production

| Variable | Dev / Local | Production (10.0.3.230) | Notes |
|---|---|---|---|
| `ARI_URL` | `http://localhost:8088` | `https://10.0.3.229:8089` | **HTTPS required** — Asterisk HTTP endpoint returns empty reply. Port 8089, not 8088 |
| `ARI_USERNAME` | `asterisk` | `asterisk` | Same |
| `ARI_PASSWORD` | `asterisk` | `D1k4@4r1#D1k4` | Production password |
| `ARI_APP` | `command-center` | `command-center` | Must differ from bridge app name (`Livewire-ARI-Bridge0001`) |
| `REDIS_HOST` | `127.0.0.1` | `10.0.3.230` | Use IP, not `localhost` — Redis binds to all interfaces |
| `REDIS_PORT` | `6379` | `6379` | Same |
| `REDIS_PASSWORD` | (none) | `D1k4@r3d15` | **Required** in production. Was previously `arutala123` — that is the OLD wrong password |
| `BRIDGE_URL` | `http://localhost:3100` | `http://localhost:3100` | Same — Command Center runs on same server as bridge |
| `HTTP_PORT` | `3050` | `3050` | No conflict with existing services (3001, 3100 taken) |
| `WS_PORT` | `3051` | `3051` | Separate from bridge Socket.IO (3100) |
| `LOG_LEVEL` | `debug` | `info` | Reduce noise in production |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `1` | `0` | Must be `0` — Asterisk 10.0.3.229 uses a self-signed TLS cert |

### Port Allocation (Production)

| Port | Service | Status |
|---|---|---|
| 443 | Nginx HTTPS (reverse proxy) | In use |
| 3001 | Voice API | In use |
| 3005 | Agent Dashboard | In use |
| 3100 | ARI Bridge (bridge-fast.js) | In use |
| **3050** | **Command Center REST API** | **Available — reserved** |
| **3051** | **Command Center WebSocket** | **Available — reserved** |

---

## 4. Process Manager — PM2

### Current PM2 Landscape

All production Node.js services run under PM2 (v5.x) on 10.0.3.230:

| PM2 ID | Name | Script | Port | Uptime |
|---|---|---|---|---|
| 128 | ari-bridge | bridge-fast.js | 3100 | Stable (v1.2.7) |
| 106 | voice-api | — | 3001 | 3+ days |
| 24 | agent-dashboard | — | 3005 | 2+ months |
| 84 | websip-client-fast-v2 | — | — | 2+ months |
| 6 | dialer-ui-fresh | — | — | 4+ days |
| 120 | fwebdialer | — | — | 3+ days |
| **TBD** | **command-center** | **src/index.js** | **3050/3051** | **Not yet deployed** |

### PM2 Start Command

```bash
# On 10.0.3.230, from the project directory:
cd /home/egan/livewire58kCommandCenter

# Source env vars into shell FIRST — PM2 captures shell env at process creation
source .env
export ARI_URL ARI_USERNAME ARI_PASSWORD ARI_APP \
       REDIS_HOST REDIS_PORT REDIS_PASSWORD \
       HTTP_PORT WS_PORT BRIDGE_URL LOG_LEVEL \
       NODE_TLS_REJECT_UNAUTHORIZED NODE_ENV

# Start with PM2
pm2 start src/index.js --name command-center

# Save state for reboot persistence
pm2 save
```

### PM2 Critical Warnings (Learned from v1.2.7 Deployment)

| Warning | Detail |
|---|---|
| **Never `pm2 delete` a running process** | Deleting wipes all stored env vars from PM2's dump file. The process will crash-loop on restart because vars like `ARI_PASSWORD`, `REDIS_PASSWORD` are gone. |
| **Env vars come from shell, not ecosystem file** | The `ecosystem.config.cjs` only has 3 vars. All credentials are captured from the shell environment at `pm2 start` time. |
| **Always `pm2 save` after changes** | PM2 state is stored at `~/.pm2/dump.pm2`. Without saving, a server reboot loses the process config. |
| **Use `pm2 restart`, not delete + start** | To update code, use `pm2 restart command-center`. To update env vars, use `pm2 restart command-center --update-env` (with new vars exported in shell). |
| **Recover env from dump** | If a process is accidentally deleted, env vars can be recovered from `~/.pm2/dump.pm2` (JSON — search for the process name). |

### Ecosystem Config (Optional)

If you want an ecosystem file for the Command Center:

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'command-center',
    script: 'src/index.js',
    cwd: '/home/egan/livewire58kCommandCenter',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

> **Note:** Even with an ecosystem file, you must still export credentials in the shell before running `pm2 start ecosystem.config.cjs`. The ecosystem file should only contain non-sensitive config.

---

## 5. Node.js Version

| Item | Value |
|---|---|
| **Version on server** | Node.js 20.19.5 |
| **Installed via** | NVM (`nvm install 20.19.5`) |
| **NVM path** | `~/.nvm/versions/node/v20.19.5/bin/node` |
| **npm** | Bundled with Node 20.x |

### Verify on Server

```bash
ssh -i /c/aws/id-ed25519 egan@10.0.3.230
node --version   # v20.19.5
npm --version    # 10.x
```

### Compatibility Notes

- The Command Center uses ES module imports (`import/export`) — ensure `"type": "module"` is set in `package.json`
- Pino logger requires Node 18+
- No native addons — pure JS dependencies only

---

## 6. Reverse Proxy — Nginx

### Current Nginx Setup

Nginx runs on 10.0.3.230, listening on port 443 (HTTPS) with a self-signed certificate.

**Config file:** `/etc/nginx/sites-enabled/websip58k`

### Existing Routes

| Route | Target | Service |
|---|---|---|
| `/api/*` | `http://localhost:3001/api/` | Voice API |
| `/bridge/health` | `http://localhost:3100/api/health` | ARI Bridge health |
| `/ari-socket.io/*` | `http://localhost:3100/socket.io/` | ARI Bridge Socket.IO |
| `/websip58k` | `http://localhost:3000` | WebSIP Client |

### New Routes Required for Command Center

Add these blocks to `/etc/nginx/sites-enabled/websip58k` inside the `server { listen 443 ssl; ... }` block:

```nginx
    # ─── Command Center REST API ──────────────────────────
    location /cmd/ {
        proxy_pass http://localhost:3050/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ─── Command Center WebSocket ─────────────────────────
    location /cmd-ws/ {
        proxy_pass http://localhost:3051/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
```

### Nginx Deployment Steps

```bash
# 1. Backup current config
sudo cp /etc/nginx/sites-enabled/websip58k /etc/nginx/sites-enabled/websip58k.backup-$(date +%Y%m%d)

# 2. Edit config
sudo nano /etc/nginx/sites-enabled/websip58k
# Add the two location blocks above

# 3. Test syntax
sudo nginx -t
# Expected: "syntax is ok" + "test is successful"

# 4. Reload (zero-downtime)
sudo systemctl reload nginx
```

### Resulting URL Map (After Deployment)

| External URL | Internal Target | Service |
|---|---|---|
| `https://livewire.ptdika.local/api/*` | `http://localhost:3001` | Voice API |
| `https://livewire.ptdika.local/bridge/health` | `http://localhost:3100/api/health` | ARI Bridge |
| `https://livewire.ptdika.local/ari-socket.io/*` | `http://localhost:3100/socket.io/` | ARI Bridge WS |
| `https://livewire.ptdika.local/cmd/*` | `http://localhost:3050` | **Command Center API** |
| `https://livewire.ptdika.local/cmd-ws/*` | `http://localhost:3051` | **Command Center WS** |

### SSL Certificate

| Item | Value |
|---|---|
| Type | Self-signed |
| Cert | `/etc/ssl/certs/websip.crt` |
| Key | `/etc/ssl/private/websip.key` |

Browsers will show a certificate warning — this is expected for the internal network.

---

## 7. Dependencies & Pre-Deployment Checklist

### npm Dependencies (from Command Center package.json)

| Package | Purpose |
|---|---|
| `ari-client` | ARI WebSocket + REST client for Asterisk |
| `express` | REST API server |
| `ws` | WebSocket server |
| `ioredis` | Redis client |
| `pino` | Structured JSON logging |
| `dotenv` | Environment variable loading |

### ARI Client Patch (Required)

The `ari-client` npm package has a bug on Asterisk 18 — the swagger API docs endpoint returns 401 for unauthenticated requests. After `npm install`, apply the patch:

```bash
cp patches/ari-client-lib-client.js node_modules/ari-client/lib/client.js
```

Or use the postinstall script (if configured in `package.json`):

```json
{
  "scripts": {
    "postinstall": "bash scripts/postinstall.sh"
  }
}
```

The ARI Bridge repo already has this patch at `patches/ari-client-lib-client.js` — copy it to the Command Center repo.

### Pre-Deployment Checklist

```
[ ] Code pushed to GitHub
[ ] .env file created on server with production values
[ ] patches/ari-client-lib-client.js copied from ari-communication-hub repo
[ ] npm install --production completed
[ ] postinstall patch applied (verify: grep "auth" node_modules/ari-client/lib/client.js)
[ ] logs/ directory created (mkdir -p logs)
[ ] Nginx config updated with /cmd/ and /cmd-ws/ routes
[ ] nginx -t passes
[ ] nginx reloaded
[ ] PM2 started with env vars exported
[ ] pm2 save executed
[ ] Health check passes: curl -s http://localhost:3050/health
[ ] WebSocket connects: wscat -c ws://localhost:3051
[ ] ARI connection verified in PM2 logs
[ ] Redis connection verified in PM2 logs
```

---

## 8. Stasis App Isolation

The Command Center **must** use a different ARI Stasis app name than the ARI Bridge:

| Component | ARI App Name | Purpose |
|---|---|---|
| bridge-fast.js | `Livewire-ARI-Bridge0001` | Call routing, bridging, recording |
| command-center | `command-center` | Supervision only |

### Why This Matters

- Each Stasis app receives its own event stream — channels created under `command-center` won't trigger bridge-fast.js handlers and vice versa
- Snoop channels created by the Command Center enter Stasis under `command-center`, not the bridge app
- Both apps share the same Asterisk instance and can interact with the same bridges/channels via the ARI REST API
- If both used the same app name, event handlers would conflict and cause double-processing

### Asterisk Dialplan

No dialplan changes needed. The Command Center creates all its channels programmatically via ARI — it does not receive inbound calls from the dialplan.

---

## 9. Integration Points with Existing Services

### ARI Bridge (bridge-fast.js, port 3100)

The Command Center needs to know which calls are active and which bridges/channels exist. Two integration approaches:

| Approach | How |
|---|---|
| **ARI direct** | Query `GET /channels`, `GET /bridges` on Asterisk (10.0.3.229:8089) — always the source of truth |
| **Bridge API** | Query `GET http://localhost:3100/api/agents` to get agent states and active call info from the bridge's in-memory state |

The Command Center's supervision operations (snoop, bridge create/destroy) go directly to ARI, not through the bridge.

### Redis (shared)

Both the bridge and Command Center connect to the same Redis instance. Key namespacing:

| Prefix | Owner | Purpose |
|---|---|---|
| `agent:*` | bridge-fast.js | Agent status, call state |
| `agents:*` | bridge-fast.js | Agent sets (all, available) |
| `recording:*` | bridge-fast.js | Recording merge queue |
| `sup:*` | command-center | Supervision session state (recommended prefix) |

### PostgreSQL (optional for Command Center)

The Command Center uses Redis for supervision state (sessions are transient — they exist only while a supervisor is actively monitoring). PostgreSQL is not required unless you want to persist supervision history/audit logs.

If needed, the connection string is:

```
postgresql://lw58k_admin:Lw58kAdm1n%402025@10.0.3.230:5432/live_wire58k
```

---

## 10. Full Deployment Procedure (Step-by-Step)

### Phase 1: Prepare Server Directory

```bash
ssh -i /c/aws/id-ed25519 egan@10.0.3.230
mkdir -p ~/livewire58kCommandCenter/logs
```

### Phase 2: Deploy Code

```bash
# From Windows dev machine (Git Bash):
cd /d/repos/livewire58kCommandCenter
scp -i /c/aws/id-ed25519 -r src/ package.json package-lock.json .env egan@10.0.3.230:~/livewire58kCommandCenter/

# Copy the ARI client patch from the bridge repo
scp -i /c/aws/id-ed25519 /d/repos/ari-communication-hub/patches/ari-client-lib-client.js egan@10.0.3.230:~/livewire58kCommandCenter/patches/
```

### Phase 3: Install Dependencies

```bash
ssh -i /c/aws/id-ed25519 egan@10.0.3.230
cd ~/livewire58kCommandCenter
npm install --production

# Verify patch applied
grep -c "auth" node_modules/ari-client/lib/client.js
# Should return > 0
```

### Phase 4: Configure Nginx

```bash
sudo cp /etc/nginx/sites-enabled/websip58k /etc/nginx/sites-enabled/websip58k.backup-$(date +%Y%m%d)
sudo nano /etc/nginx/sites-enabled/websip58k
# Add /cmd/ and /cmd-ws/ location blocks (see Section 6)
sudo nginx -t
sudo systemctl reload nginx
```

### Phase 5: Start with PM2

```bash
cd ~/livewire58kCommandCenter
source .env
export ARI_URL ARI_USERNAME ARI_PASSWORD ARI_APP \
       REDIS_HOST REDIS_PORT REDIS_PASSWORD \
       HTTP_PORT WS_PORT BRIDGE_URL LOG_LEVEL \
       NODE_TLS_REJECT_UNAUTHORIZED NODE_ENV

pm2 start src/index.js --name command-center
pm2 save
```

### Phase 6: Verify

```bash
# 1. PM2 status — should be "online" with 0 restarts
pm2 list

# 2. Check logs — look for "Connected to ARI" and "Redis connected"
pm2 logs command-center --lines 20 --nostream

# 3. Health check
curl -s http://localhost:3050/health
# Expected: {"status":"ok","uptime":...}

# 4. Through Nginx
curl -sk https://livewire.ptdika.local/cmd/health
# Expected: {"status":"ok","uptime":...}

# 5. List active sessions (should be empty initially)
curl -s http://localhost:3050/api/supervision/sessions
# Expected: {"ok":true,"sessions":[]}
```

---

## 11. Troubleshooting

### Common Issues (from v1.2.7 deployment experience)

| Symptom | Cause | Fix |
|---|---|---|
| Process crash-loops immediately | Missing env vars (ARI_PASSWORD, REDIS_PASSWORD) | Re-export env vars, `pm2 restart --update-env` |
| `Empty reply from server` on ARI | Using HTTP instead of HTTPS, or wrong port (8088 vs 8089) | Use `https://10.0.3.229:8089` |
| `401 Unauthorized` on ARI connect | ari-client patch not applied | Copy `patches/ari-client-lib-client.js` to `node_modules/ari-client/lib/client.js` |
| Redis `NOAUTH` error | Wrong Redis password | Use `D1k4@r3d15` (not the old `arutala123`) |
| `ECONNREFUSED` on Redis | Wrong host — using `localhost` instead of IP | Use `REDIS_HOST=10.0.3.230` |
| Nginx 502 Bad Gateway | Command Center not running or wrong port in nginx config | Check `pm2 list`, verify port in nginx matches `HTTP_PORT` |
| WebSocket won't connect through Nginx | Missing `Upgrade` and `Connection` headers in nginx | Add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` |
| Supervision snoop fails | Bridge or channel ID doesn't exist in ARI | Always verify resource exists with `GET /channels/{id}` before snooping |

### Useful Debug Commands

```bash
# PM2 logs (live tail)
pm2 logs command-center

# PM2 process details (including env vars)
pm2 show command-center

# Check what env vars PM2 captured
pm2 env <pm2_id>

# Test ARI connectivity directly
curl -sk -u asterisk:'D1k4@4r1#D1k4' https://10.0.3.229:8089/ari/asterisk/info

# Test Redis connectivity
redis-cli -h 10.0.3.230 -a 'D1k4@r3d15' ping
# Expected: PONG

# Check all PM2 processes
pm2 list

# Nginx error log
sudo tail -f /var/log/nginx/error.log
```

---

## 12. Directory Structure on Server (After Deployment)

```
/home/egan/
├── ari-communication-hub/         # ARI Bridge (existing, PM2 128)
│   ├── bridge-fast.js
│   ├── package.json
│   ├── .env
│   ├── ecosystem.config.cjs
│   ├── patches/
│   │   └── ari-client-lib-client.js
│   ├── node_modules/
│   └── logs/
│
├── livewire58kCommandCenter/      # Command Center (new)
│   ├── src/
│   │   ├── index.js
│   │   ├── config.js
│   │   ├── logger.js
│   │   ├── api/
│   │   │   └── routes.js
│   │   ├── ari/
│   │   │   └── connection.js
│   │   ├── events/
│   │   │   ├── emitter.js
│   │   │   └── wsServer.js
│   │   ├── state/
│   │   │   └── redis.js
│   │   ├── supervisor/
│   │   │   ├── manager.js
│   │   │   ├── topology.js
│   │   │   ├── ariEvents.js
│   │   │   └── orphanSweep.js
│   │   └── utils/
│   │       ├── helpers.js
│   │       └── transitionLock.js
│   ├── package.json
│   ├── .env
│   ├── patches/
│   │   └── ari-client-lib-client.js
│   ├── node_modules/
│   └── logs/
│
├── voice-api/                     # Voice API (existing, PM2 106)
├── agent-dashboard/               # Dashboard (existing, PM2 24)
└── websip-client/                 # WebSIP (existing, PM2 84)
```

---

## 13. Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                COMMAND CENTER QUICK REFERENCE                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Server:     10.0.3.230                                     │
│  SSH:        ssh -i /c/aws/id-ed25519 egan@10.0.3.230      │
│  Path:       ~/livewire58kCommandCenter                     │
│  PM2 Name:   command-center                                 │
│                                                             │
│  REST API:   http://localhost:3050                           │
│  WebSocket:  ws://localhost:3051                             │
│  Via Nginx:  https://livewire.ptdika.local/cmd/*            │
│              wss://livewire.ptdika.local/cmd-ws/            │
│                                                             │
│  ARI:        https://10.0.3.229:8089  (user: asterisk)      │
│  Redis:      10.0.3.230:6379                                │
│  PostgreSQL: 10.0.3.230:5432  (db: live_wire58k)            │
│                                                             │
│  Health:     curl -s http://localhost:3050/health            │
│  Logs:       pm2 logs command-center                        │
│  Restart:    pm2 restart command-center                     │
│  Stop:       pm2 stop command-center                        │
│                                                             │
│  Stasis App: command-center                                 │
│  Node.js:    v20.19.5 (via NVM)                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
