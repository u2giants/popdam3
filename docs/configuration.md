# Configuration Reference

## Frontend — Build-Time Config

The frontend has **no runtime env vars**. All configuration is baked into the bundle at build time.

### Hardcoded Supabase config (`src/lib/app-mode.ts`)

```typescript
const POPDAM_SUPABASE_URL = "https://ryltkzzernhwnojzouyb.supabase.co";
const POPDAM_ANON_KEY = "sb_publishable_7pDNMn_LIJOkdYmhcI0n7g_IuKABuWK";
```

Both PopDAM and PopSG modes use the same Supabase project. Mode controls UI and routing only. See quirk #1 in [KNOWN_QUIRKS.md](KNOWN_QUIRKS.md) for why the keys are hardcoded rather than in env vars.

### Build-time env vars (optional, CI-only)

| Var | Purpose | Injected by |
|-----|---------|-------------|
| `APP_COMMIT` | Short git SHA shown in header | `publish-frontend.yml` |
| `APP_DATE` | ISO commit timestamp shown in header | `publish-frontend.yml` |

These are optional; omitting them leaves the version display blank in the header. They are defined in `vite.config.ts` via `define: { __APP_COMMIT__: ..., __APP_DATE__: ... }`.

---

## GitHub Actions Secrets

### Frontend (publish-frontend.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `GHCR_PAT` | Optional classic PAT (`write:packages`) owned by a package admin | Fallback for pushing Docker image to GHCR if package Actions access is not granted |
| `GHCR_USERNAME` | Optional GitHub username for `GHCR_PAT` owner | Required only if `GHCR_PAT` belongs to an account other than `u2giants` |
| `COOLIFY_TOKEN` | Coolify API token (deploy permission) | Trigger Coolify deployment |
| `COOLIFY_APP_UUID` | `qxj8a0j3tpa9lq4q5rs6pezy` | Coolify app identifier |
| `COOLIFY_URL` | `https://coolify.designflow.app` | Coolify API base URL |

Frontend GHCR pushes prefer `GHCR_PAT` when present and otherwise use the workflow's implicit `GITHUB_TOKEN` with `packages: write`. For `GITHUB_TOKEN` to push the existing `ghcr.io/u2giants/popdam-frontend` package, the package settings must grant repository `u2giants/popdam3` **Write** under "Manage Actions access." Without that package permission or a valid `GHCR_PAT`, `docker push` fails with `permission_denied: write_package`; on 2026-06-10 this left production stuck on commit `8c0508d` because no newer `:latest` image reached GHCR.

### Supabase deploy (deploy-supabase.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token | Authenticate `supabase db push` |
| `EXTERNAL_SUPABASE_PROJECT_ID` | `ryltkzzernhwnojzouyb` | Target Supabase project |
| `EXTERNAL_SUPABASE_DB_PASSWORD` | DB password | Database connection for migrations |

### Bridge Agent (publish-bridge-agent.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `GHCR_PAT` | GitHub PAT (`write:packages`) | Push Docker image to GHCR |
| `SUPABASE_URL` | Supabase project URL | Notify cloud of new version |
| `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` | Service role key | Update `BRIDGE_LATEST_BUILD` in admin_config |

### Helper (publish-popdam-helper.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `GH_TOKEN` | GitHub PAT | Create/update GitHub Release |
| `CSC_IDENTITY_AUTO_DISCOVERY` | `false` | Suppresses code signing until certs are provisioned |

Code signing certs are **not yet configured**. See [HANDOFF.md](../HANDOFF.md) for what's needed.

### Windows Agent (publish-windows-agent.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `GITHUB_TOKEN` | Auto-provided | Create GitHub Releases |
| `SUPABASE_URL` | Supabase project URL | Notify cloud of new version |
| `DEPLOY_WEBHOOK_KEY` | Deploy key | Authenticate `notify-build` call to agent-api |

---

## Supabase — `admin_config` Table

Runtime configuration lives in the `admin_config` table (`key`, `value` jsonb columns). Managed through Settings in the web UI. Key entries:

| Key | Purpose |
|-----|---------|
| `OPENROUTER_API_KEY` | API key for AI tagging and PDF vision (feeds bridge/windows agents via heartbeat) |
| `POPDAM_MOUNT_PATH` | NAS root path for PopDAM scan |
| `POPSG_MOUNT_PATH` | NAS root path for PopSG crawl |
| `AGENT_API_KEY` | Pre-shared key agents include in every request |
| `DIGITAL_OCEAN_SPACES_*` | DigitalOcean Spaces non-secret config (bucket, region, endpoint, public_base_url) |
| `COLDLION_*` | ERP API credentials |
| `BULK_OPERATIONS` | State for all bulk jobs (see `docs/BULK_JOBS.md`) |
| `SCAN_REQUEST` | Pending scan trigger flags for agents |
| `STYLE_GUIDE_CRAWL_REQUEST` | Pending PopSG crawl trigger |
| `ERP_LAST_SYNC_DATE` | Watermark for incremental ERP sync |
| `ERP_CATEGORY_CUTOFF_DATE` | Items before this date have mg_category nulled (legacy) |
| `BRIDGE_LATEST_BUILD` | Latest published bridge agent build: `{ version, sha, published_at, ... }`. The `sha` (git commit) is the immutable identity the admin UI compares the agent's reported `build_sha` against to detect drift — see the "Agent `version` can lie" quirk in `AGENTS.md`. |
| `AI_TASK_MODELS` | Per-task AI model overrides (vision_tagging, text_classification, pdf_extraction) |
| `BLANK_THUMB_CLEANUP_REQUEST` | Pending blank thumbnail cleanup trigger |
| `UPDATE_REQUEST` | Bridge agent self-update trigger |
| `CHECKIN_VERIFICATION_ENABLED` | **Feature flag** (boolean). When true, Seafile-sourced check-ins park in `verifying` until the bridge agent confirms receipt on the Synology (size + quick-hash); when false/absent they complete immediately on upload. Activated 2026-06-09. Set to `false` for instant rollback — no redeploy. See the "Seafile check-ins park in `verifying`" quirk in `AGENTS.md`. |

---

## Supabase — Vault Secrets

Sensitive values that edge functions access via `select * from vault.decrypted_secrets`. Managed in the Supabase dashboard → Vault.

Key secrets: `BREVO_API_KEY` (email invites), `OPENROUTER_API_KEY` (AI models), DigitalOcean Spaces credentials.

---

## Bridge Agent (`apps/bridge-agent`)

Configuration comes from the agent's `admin_config` entries (fetched from Supabase on startup via heartbeat) and from environment variables set in the Synology Docker Compose file.

Key env vars (set in `deploy/synology/docker-compose.yml`):

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for agent API auth |
| `AGENT_API_KEY` | Pre-shared key (must match `admin_config`) |
| `POPDAM_CONTAINER_NAME` | Canonical container name (used for self-update; prevents accumulation of `-old-*` containers) |
| `POPDAM_IMAGE_TAG` | Injected at Docker build time; shown in heartbeat version info |
| `POPDAM_BUILD_SHA` | Injected at Docker build time; shown in heartbeat version info |
| `NAS_MOUNT` | Container-side mount path for NAS volume |
| `SUPABASE_ANON_KEY` | Optional; enables Realtime watcher for instant scan delivery |

---

## Cloud Worker (`apps/worker`)

Runs on Railway. Environment variables are set in the Railway project dashboard.

| Var | Required | Purpose |
|-----|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `OPENROUTER_API_KEY` | Yes | AI tagging and ERP classification — **not the same as admin_config.OPENROUTER_API_KEY** |
| `GOOGLE_AI_API_KEY` | No | Legacy fallback if no OpenRouter key |

**Critical:** `OPENROUTER_API_KEY` in Railway and `OPENROUTER_API_KEY` in `admin_config` are two separate things. Setting the key in the admin UI (Settings → AI Models) only updates `admin_config`. The Railway worker reads exclusively from Railway ENV variables.

---

## POP DAM Helper (`apps/popdam-helper`)

The desktop app stores its configuration in a local file (`dam-config.json`, path varies by OS) and uses Electron's `safeStorage` for encrypted credential storage. The user provides:

1. **Supabase URL** — pre-populated from `dam-config.json` distributed with the installer
2. **Email + password** — stored in `safeStorage` after first sign-in
3. **Anon key** — bundled in `dam-config.json`

No `.env` file is used by the Helper.

---

## Traefik / VPS

Runtime Traefik configuration lives in `/data/coolify/proxy/dynamic/` on the VPS host (bind-mounted into the `coolify-proxy` container). Files here are loaded live — no Traefik restart needed.

| File | Purpose |
|------|---------|
| `coolify.yaml` | Coolify's own routing (auto-generated; do not edit) |
| `popdam-sg.yml` | `sg.designflow.app` → popdam-frontend routing |
| `default_redirect_503.yaml` | Coolify catchall fallback |

The Coolify Traefik instance has two cert resolvers:
- `letsencrypt` — HTTP-01 challenge (used by popdam-frontend)
- `letsencrypt-dns` — Cloudflare DNS-01 challenge (available but not used by popdam-frontend)
