# Configuration

Environment variables, runtime config keys, and deployment settings for all components.

---

## Frontend Environment Variables

The React/Vite frontend has **no** `VITE_*` environment variables. The Lovable platform overwrites `.env` files on every deploy, so all credentials that the frontend needs are hardcoded directly in source.

**Hardcoded in `src/lib/app-mode.ts`:**
- Supabase project URL: `https://ryltkzzernhwnojzouyb.supabase.co`
- Supabase anon key for project `ryltkzzernhwnojzouyb`

**Build-time constants injected via `vite.config.ts` `define`:**

| Constant | Source | Example value |
|----------|--------|---------------|
| `__APP_COMMIT__` | `git rev-parse --short HEAD` at build time | `"b4a9b9b"` |
| `__APP_DATE__` | ISO date string at build time | `"2026-05-31"` |

These appear in the UI's version footer. They are injected at build time by the `define` block in `vite.config.ts`, not via `import.meta.env`.

Do not add `VITE_*` variables to `.env` files for this project — they will not survive a Lovable deploy and will cause unexpected behavior when Lovable overwrites them.

---

## Edge Function Environment Variables

Set these in the Supabase dashboard under Project Settings → Edge Functions → Secrets (project `ryltkzzernhwnojzouyb`). Some are auto-injected by the Supabase runtime.

| Variable | Auto-injected? | Used by | Purpose |
|----------|---------------|---------|---------|
| `SUPABASE_URL` | Yes | all functions | Project URL |
| `SUPABASE_ANON_KEY` | Yes | all functions | Anon key for client-side operations |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | all functions | Service role key for privileged DB access |
| `SUPABASE_DB_URL` | Yes | `export-sql-dump`, `export-table` | Direct PostgreSQL connection |
| `BREVO_API_KEY` | No | `send-invite-email` | Brevo transactional email API key |
| `DO_SPACES_KEY` | No | `agent-api` (thumbnail proxy) | DigitalOcean Spaces access key |
| `DO_SPACES_SECRET` | No | `agent-api` (thumbnail proxy) | DigitalOcean Spaces secret |
| `DO_SPACES_BUCKET` | No | `agent-api` | Spaces bucket name (`popdam`) |
| `DO_SPACES_REGION` | No | `agent-api` | Spaces region (`nyc3`) |
| `DO_SPACES_ENDPOINT` | No | `agent-api` | Spaces endpoint URL |
| `DEPLOY_WEBHOOK_KEY` | No | `admin-api` | Secret for the deploy webhook route |
| `OPENROUTER_API_KEY` | No | `ai-tag`, `erp-sync` | OpenRouter API key for AI inference in edge functions |
| `ANTHROPIC_API_KEY` | No | `ai-tag` | Anthropic direct API key (fallback) |
| `GOOGLE_AI_API_KEY` | No | `ai-tag` | Google Gemini API key for PDF text extraction |
| `COLDLION_API_KEY` | No | `sync-external` | External licensor/character sync API key |
| `AUTHENTIK_JWKS_URL` | No | `authenticate-with-authentik` | JWKS endpoint for Authentik SSO token validation |
| `AUTHENTIK_CLIENT_ID` | No | `authenticate-with-authentik` | OAuth2 client ID for Authentik |

---

## Bridge Agent Environment Variables

Set in the `.env` file at `apps/bridge-agent/.env` on the Synology NAS (never committed to git). For multi-tenant installs, each tenant process reads its own `.env` via the `TENANT_ENV_FILE` variable set by `tenant-supervisor.ts`.

### Required

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `AGENT_KEY` | Secret key from `agent_registrations.key_hash` (pre-image) |
| `SUPABASE_ANON_KEY` | Anon key for Supabase Realtime subscription |
| `DO_SPACES_KEY` | DigitalOcean Spaces access key |
| `DO_SPACES_SECRET` | DigitalOcean Spaces secret |

### Strongly Recommended

| Variable | Default | Purpose |
|----------|---------|---------|
| `DO_SPACES_BUCKET` | `popdam` | Spaces bucket name |
| `DO_SPACES_REGION` | `nyc3` | Spaces region |
| `DO_SPACES_ENDPOINT` | `https://nyc3.digitaloceanspaces.com` | Spaces endpoint |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat poll interval (ms) |

### NAS Filesystem

| Variable | Purpose |
|----------|---------|
| `NAS_CONTAINER_MOUNT_ROOT` | Absolute path where NAS volumes are mounted inside the container (e.g., `/mnt/popdam`) |
| `SCAN_ROOTS` | Comma-separated list of folder names under `NAS_CONTAINER_MOUNT_ROOT` to scan |

Note: `POPDAM_MOUNT_PATH` and `POPSG_MOUNT_PATH` are delivered at runtime via heartbeat config from `admin_config` and override any local values.

### Self-Update and Container Identity

| Variable | Purpose |
|----------|---------|
| `POPDAM_CONTAINER_NAME` | Docker container name of this agent (used by self-update to restart the container) |
| `DOCKER_IMAGE` | Docker image to pull during self-update (e.g., `ghcr.io/u2giants/popdam-bridge:stable`) |

### Multi-Tenant

| Variable | Purpose |
|----------|---------|
| `TENANTS` | JSON array of tenant configs; when set, `tenant-supervisor.ts` spawns one child process per tenant |
| `TENANT_ID` | Set by supervisor on child processes; identifies the active tenant |

In the standard single-tenant install, `TENANTS` is unset and the agent runs as a single process.

### Performance Fallbacks

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_CONCURRENT_THUMBNAILS` | `4` | Parallel thumbnail generation limit |
| `BATCH_SIZE` | `100` | Files per `batch-ingest` call |
| `SCAN_CHUNK_SIZE` | `500` | Files walked before yielding to event loop |

### Internal / Runtime

| Variable | Set by | Purpose |
|----------|--------|---------|
| `AGENT_ID` | Written to `.agent-id` file after first registration | Persisted agent UUID |
| `NODE_ENV` | Docker Compose | `production` in the deployed container |

### Storage Config Delivered via Heartbeat

These keys in `admin_config` are delivered to the agent on every heartbeat response and override any local `.env` values:

| admin_config key | Purpose |
|-----------------|---------|
| `SPACES_CONFIG` | Full DO Spaces connection config (bucket, region, endpoint, CDN prefix) |
| `POPDAM_MOUNT_PATH` | Override for PopDAM NAS mount path |
| `POPSG_MOUNT_PATH` | Override for PopSG NAS mount path |
| `SCAN_CONCURRENCY` | Override for concurrent thumbnail workers |

Secrets (`DO_SPACES_KEY`, `DO_SPACES_SECRET`) are never included in the heartbeat payload — they stay in the local `.env`.

---

## Worker Environment Variables

Set in Railway project settings. The worker has no `.env` file in the repo.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Service role key for privileged DB access |
| `OPENROUTER_API_KEY` | No | falls back to `admin_config` | OpenRouter API key; if set here, takes precedence over the DB value |
| `ANTHROPIC_API_KEY` | No | — | Anthropic direct key (fallback if OpenRouter unavailable) |
| `POLL_INTERVAL_MS` | No | `1000` | How often to poll `admin_config.BULK_OPERATIONS` |
| `NODE_ENV` | No | `production` | Set to `production` by Railway |

### Two `OPENROUTER_API_KEY` Locations

The worker looks for `OPENROUTER_API_KEY` in two places, in order:

1. **Railway environment variable** — takes precedence if set.
2. **`admin_config.OPENROUTER_API_KEY`** — fetched from DB and cached for 60 s.

The DB value allows rotating the key without redeploying Railway. The Railway env var is available as an emergency override.

---

## Feature Flags and Runtime Config

`admin_config` is a key/value table (`key TEXT PRIMARY KEY`, `value TEXT`) in Supabase. It serves as both a configuration store and a lightweight job queue. All writes require either an admin JWT or a service role key.

### Core Operation Keys

| Key | Format | Purpose |
|-----|--------|---------|
| `BULK_OPERATIONS` | JSON object | Job queue for all Railway worker operations. Keyed by op name; each entry has `status`, `cursor`, `total`, `processed`, `errors`. |
| `SCAN_REQUEST` | JSON | Triggers a bridge agent scan. Written by `admin-api`; consumed by the agent on next heartbeat. |
| `SCAN_PROGRESS` | JSON | Scan progress written by the bridge agent; read by the frontend. |
| `SCAN_CHECKPOINT` | JSON | Cursor state for resuming an interrupted scan. |
| `STYLE_GUIDE_CRAWL_REQUEST` | JSON | Triggers a PopSG crawl on the bridge agent. |
| `SIBLING_SCAN_REQUEST` | JSON | Triggers a sibling image scan on the bridge agent. |
| `BLANK_THUMB_CLEANUP_REQUEST` | JSON | Triggers blank thumbnail cleanup on the bridge agent. |

### Heartbeat-Delivered Config Keys

These keys are included in the heartbeat response payload and delivered to the agent on every poll.

**All agents:**

| Key | Purpose |
|-----|---------|
| `SPACES_CONFIG` | DO Spaces connection config (bucket, region, endpoint, CDN prefix) |
| `AGENT_API_KEY` | The `x-agent-key` value the agent must send with all `agent-api` calls |

**Bridge agent only:**

| Key | Purpose |
|-----|---------|
| `POPDAM_MOUNT_PATH` | NAS mount path for PopDAM assets |
| `POPSG_MOUNT_PATH` | NAS mount path for PopSG assets |
| `SCAN_CONCURRENCY` | Override for thumbnail worker concurrency |
| `BRIDGE_LATEST_BUILD` | Latest available bridge agent version; triggers self-update check |

**Windows render agent only:**

| Key | Purpose |
|-----|---------|
| `RENDER_CONCURRENCY` | Number of concurrent Illustrator render jobs |
| `WINDOWS_AGENT_LATEST_BUILD` | Latest available Windows agent version |

### ERP and AI Keys

| Key | Format | Purpose |
|-----|--------|---------|
| `OPENROUTER_API_KEY` | String | OpenRouter API key for worker AI operations (Railway env var takes precedence if set) |
| `AI_TASK_MODELS` | JSON object | Model overrides per task type. Keys: `text_classification`, `ai_tagging`, `pdf_extraction`. Each defaults to `anthropic/claude-3.5-haiku` if not set. Cached 60 s by the worker. |
| `ERP_LAST_SYNC_DATE` | ISO datetime string | Watermark for incremental ERP syncs. Written by `erp-sync` after each successful run. |
| `ERP_API_URL` | String | Override for the ERP API endpoint (default: `https://api.item.designflow.app/lib/getApiAllItems`) |

### Build Metadata Keys

| Key | Purpose |
|-----|---------|
| `BRIDGE_LATEST_BUILD` | Latest published bridge agent version (set by CI after a successful bridge agent publish) |
| `WINDOWS_AGENT_LATEST_BUILD` | Latest published Windows render agent version |

### Path Config Keys

| Key | Purpose |
|-----|---------|
| `POPDAM_MOUNT_PATH` | Root NAS path for PopDAM (e.g., `/volume1/design`) |
| `POPSG_MOUNT_PATH` | Root NAS path for PopSG style guides |
| `CDN_PREFIX` | CDN URL prefix for thumbnail URLs (e.g., `https://cdn.designflow.app`) |

---

## Dual-Mode Configuration

### Mode Detection (Frontend)

`src/lib/app-mode.ts` runs once at module load. Priority order:

1. `?mode=popsg` or `?mode=popdam` query parameter — detected, written to `sessionStorage`, then removed from the URL.
2. Existing value in `sessionStorage['app-mode']`.
3. Hostname: `sg.*` or `popsg.*` prefix → PopSG; everything else → PopDAM.

The module exports:
- `APP_MODE`: `'popdam'` or `'popsg'`
- `IS_POPSG`: boolean
- `IS_POPDAM`: boolean
- `CURRENT_APP`: display name string

### Local Dev Preview

To preview PopSG locally without changing hostnames:

```
http://localhost:8080/?mode=popsg
```

The `?mode=popsg` param is consumed and stored in `sessionStorage`. Subsequent navigation in that tab stays in PopSG mode. Open a new tab or add `?mode=popdam` to switch back.

### Production Routing (Traefik)

The container receives **no environment variable** indicating which hostname is active. Both hostnames route to the same container; mode is detected purely from `window.location.host` at runtime.

**PopDAM routing** (`dam.designflow.app`): configured via Docker labels on the `popdam-frontend` container, managed by Coolify (app UUID `qxj8a0j3tpa9lq4q5rs6pezy`).

**PopSG routing** (`sg.designflow.app`): configured via a Traefik file provider at `/data/coolify/proxy/dynamic/popdam-sg.yml` on the VPS host (`178.156.180.212`). This file references the Traefik internal service name `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker`. Example content:

```yaml
http:
  routers:
    popsg-router:
      rule: "Host(`sg.designflow.app`)"
      service: "https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker"
      tls:
        certResolver: letsencrypt
      entryPoints:
        - https
```

Changes to this file take effect immediately (Traefik watches the file provider directory). No container restart required.

---

## GitHub Actions Secrets Reference

### `deploy-supabase.yml` (Supabase DB push + edge function deploy)

| Secret | Value / source | Purpose |
|--------|---------------|---------|
| `SUPABASE_ACCESS_TOKEN` | Supabase account token | Authenticates `supabase` CLI |
| `SUPABASE_DB_PASSWORD` | Supabase project DB password | Required by `supabase db push` |
| `SUPABASE_PROJECT_ID` | `ryltkzzernhwnojzouyb` | Target project for all Supabase CLI commands |

### `ci.yml` (Lint + test)

No secrets required. Runs `bun run lint` and `bun run test` against the checked-out source.

### `build-and-push.yml` (Docker image build)

| Secret | Value / source | Purpose |
|--------|---------------|---------|
| `GHCR_TOKEN` | GitHub PAT with `write:packages` | Push to `ghcr.io/u2giants/popdam-frontend` |
| `COOLIFY_WEBHOOK_URL` | Coolify deploy webhook URL | Triggers Coolify to redeploy the container after push |
| `COOLIFY_TOKEN` | Coolify API token | Authenticates the deploy trigger call |

### `build-and-push-bridge.yml` (Bridge agent Docker image)

| Secret | Value / source | Purpose |
|--------|---------------|---------|
| `GHCR_TOKEN` | GitHub PAT with `write:packages` | Push to `ghcr.io/u2giants/popdam-bridge` |

### `publish-popdam-helper.yml` (Electron desktop app release)

| Secret | Value / source | Purpose |
|--------|---------------|---------|
| `GHCR_TOKEN` or `GH_TOKEN` | GitHub PAT | Create/update the `popdam-helper-latest` release and upload artifacts |
| `CSC_LINK` | Base64-encoded `.p12` certificate | Code signing (macOS/Windows) — not yet active; blocked on cert procurement |
| `CSC_KEY_PASSWORD` | Certificate passphrase | Code signing passphrase |
