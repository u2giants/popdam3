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
| `GHCR_PAT` | GitHub PAT (`write:packages`) | Push Docker image to GHCR |
| `COOLIFY_TOKEN` | Coolify API token (deploy permission) | Trigger Coolify deployment |
| `COOLIFY_APP_UUID` | `qxj8a0j3tpa9lq4q5rs6pezy` | Coolify app identifier |
| `COOLIFY_URL` | `https://coolify.designflow.app` | Coolify API base URL |

### Supabase deploy (deploy-supabase.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token | Authenticate `supabase db push` |

### Bridge Agent (publish-bridge-agent.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `GHCR_PAT` | GitHub PAT (`write:packages`) | Push Docker image to GHCR |

### Helper (publish-popdam-helper.yml)

| Secret | Value | Purpose |
|--------|-------|---------|
| `GH_TOKEN` | GitHub PAT | Create/update GitHub Release |
| `CSC_IDENTITY_AUTO_DISCOVERY` | `false` | Suppresses code signing until certs are provisioned |

Code signing certs are **not yet configured**. See [HANDOFF.md](../HANDOFF.md) for what's needed.

---

## Supabase — `admin_config` Table

Runtime configuration lives in the `admin_config` table (`key`, `value` text columns). Managed through Settings in the web UI. Key entries:

| Key | Purpose |
|-----|---------|
| `OPENROUTER_API_KEY` | API key for AI tagging and PDF vision |
| `POPDAM_MOUNT_PATH` | NAS root path for PopDAM scan |
| `POPSG_MOUNT_PATH` | NAS root path for PopSG crawl |
| `AGENT_API_KEY` | Pre-shared key agents include in every request |
| `DIGITAL_OCEAN_SPACES_*` | DigitalOcean Spaces credentials for thumbnail upload |
| `COLDLION_*` | ERP API credentials |

---

## Supabase — Vault Secrets

Sensitive values that edge functions access via `select * from vault.decrypted_secrets`. Managed in the Supabase dashboard → Vault.

Key secrets: `BREVO_API_KEY` (email invites), `OPENROUTER_API_KEY` (AI models), DigitalOcean Spaces credentials.

---

## Bridge Agent (`apps/bridge-agent`)

Configuration comes from the agent's `admin_config` entries (fetched from Supabase on startup) and from environment variables set in the Synology Docker Compose file.

Key env vars (set in `deploy/synology/docker-compose.yml`):

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for agent API auth |
| `AGENT_API_KEY` | Pre-shared key (must match `admin_config`) |
| `POPDAM_CONTAINER_NAME` | Canonical container name (used for self-update; prevents accumulation of `-old-*` containers) |

---

## Cloud Worker (`apps/worker`)

Runs on Railway. Environment variables are set in the Railway project dashboard.

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key |
| `OPENROUTER_API_KEY` | AI tagging and classification |
| `DIGITAL_OCEAN_*` | Spaces credentials for thumbnail access |

---

## POP DAM Helper (`apps/popdam-helper`)

The desktop app stores its configuration in a local file (`dam-config.json`, path varies by OS) and uses Electron's `safeStorage` for encrypted credential storage. The user provides:

1. **Supabase URL** — pre-populated from `dam-config.json` distributed with the installer (points to `ryltkzzernhwnojzouyb.supabase.co`)
2. **Email + password** — stored in `safeStorage` after first sign-in
3. **Anon key** — bundled in `dam-config.json`

No `.env` file is used by the Helper. All runtime config flows through `dam-config.json` and the Supabase-backed `admin_config` table.

---

## Traefik / VPS

Runtime Traefik configuration lives in `/data/coolify/proxy/dynamic/` on the VPS host (bind-mounted into the `coolify-proxy` container). Files here are loaded live — no Traefik restart needed.

| File | Purpose |
|------|---------|
| `coolify.yaml` | Coolify's own routing (auto-generated; do not edit) |
| `popdam-sg.yml` | `sg.designflow.app` → popdam-frontend routing (see [SELFHOST.md](../SELFHOST.md)) |
| `default_redirect_503.yaml` | Coolify catchall fallback |

The Coolify Traefik instance has two cert resolvers:
- `letsencrypt` — HTTP-01 challenge (used by popdam-frontend and all other Coolify apps)
- `letsencrypt-dns` — Cloudflare DNS-01 challenge (available but not used by popdam-frontend)
