# DEPLOYMENT

Goal: You should never have to copy source code to the NAS or "build on Synology." The NAS runs prebuilt images like an appliance. SSH into production is for emergencies only.

---

## 1) Overall Deploy Path

```
git push origin main
  → GitHub Actions (per workflow, per path trigger)
      publish-frontend.yml      → GHCR → Coolify API → production container
      deploy-supabase.yml       → supabase db push + functions deploy
      publish-bridge-agent.yml  → GHCR → BRIDGE_LATEST_BUILD in admin_config
      publish-windows-agent.yml → GitHub Release
      publish-popdam-helper.yml → GitHub Release
  → Railway (auto-detects push, rebuilds worker)
```

SSH into the production server is **emergency break-glass only**. Normal deployments never require SSH. After any emergency SSH action, commit a permanent fix to the repo or record the change in Coolify.

---

## 2) Frontend (React App)

**Workflow:** `.github/workflows/publish-frontend.yml`

**Path trigger:** `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `nginx.conf`

Documentation-only changes (`docs/**`, `*.md`) do NOT trigger a frontend build.

**Steps:**
1. npm ci
2. `npm run build` (Vite, with `APP_COMMIT` and `APP_DATE` injected)
3. `docker build -f Dockerfile.ci` — two-stage: Node builder → nginx:1.27-alpine runtime
4. Push to GHCR: `ghcr.io/u2giants/popdam-frontend:latest` + `:<sha>`
5. POST to Coolify API (`$COOLIFY_URL/api/v1/deploy?uuid=$COOLIFY_APP_UUID`) — Coolify pulls `:latest` and replaces the running container

**Coolify app:**
- UUID: `qxj8a0j3tpa9lq4q5rs6pezy`
- Image: `ghcr.io/u2giants/popdam-frontend:latest`
- Traefik service name: `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker` (stable across redeploys)
- `sg.designflow.app` routing: Traefik file provider at `/data/coolify/proxy/dynamic/popdam-sg.yml` on VPS

**Rollback:**
- In Coolify UI, select an older deployment and redeploy. The `:<sha>` tag is the immutable rollback target — change the image tag in Coolify to any prior `:<sha>` and trigger a redeploy.
- SSH into `178.156.180.212` is emergency break-glass only — prefer the Coolify UI path.

**Required GitHub secrets:**
| Secret | Purpose |
|--------|---------|
| `GHCR_PAT` | Push Docker image to GHCR |
| `COOLIFY_TOKEN` | Authenticate Coolify API |
| `COOLIFY_APP_UUID` | Coolify app identifier |
| `COOLIFY_URL` | Coolify API base URL |

---

## 3) Supabase (DB Migrations + Edge Functions)

**Workflow:** `.github/workflows/deploy-supabase.yml`

**Path trigger:** `supabase/migrations/**` or `supabase/functions/**`

**Steps:**
1. `supabase link --project-ref $SUPABASE_PROJECT_ID`
2. If migrations changed: `supabase db push`
3. If functions changed: deploy each function in `supabase/functions/*/` (skipping `_shared/`)
4. Auto-generate `src/integrations/supabase/types.ts` via `supabase gen types typescript`
5. Commit and push updated types file (`[skip ci]`)

**CRITICAL — migration timestamp discipline:**
The local migration filename timestamp MUST match the timestamp Supabase records in `supabase_migrations.schema_migrations`. A mismatch causes `supabase db push` to fail in CI. Always:
1. Apply via `apply_migration` MCP
2. Call `list_migrations` to get the exact recorded timestamp
3. Create the local file with that exact timestamp
4. Commit immediately

See `CLAUDE.md` for the full discipline and CI failure diagnosis guide.

**Required GitHub secrets:**
| Secret | Purpose |
|--------|---------|
| `SUPABASE_ACCESS_TOKEN` | Authenticate `supabase db push` |
| `EXTERNAL_SUPABASE_PROJECT_ID` | Target project (`ryltkzzernhwnojzouyb`) |
| `EXTERNAL_SUPABASE_DB_PASSWORD` | DB password for migrations |

---

## 4) Railway Worker

**Auto-deploys:** Railway watches the `main` branch directly. Every push to `main` triggers a Railway rebuild regardless of which files changed. This is a Railway platform constraint — no path filters are supported.

**No manual step required.** Railway auto-detects the `apps/worker/` directory and rebuilds.

**Versioning:** Bump `apps/worker/package.json` version in the same commit as worker changes (patch/minor/major per impact). Current version: `1.2.12`.

---

## 5) Bridge Agent Distribution

**Workflow:** `.github/workflows/publish-bridge-agent.yml`

**Path trigger:** `apps/bridge-agent/**` or `packages/path-filters/**`

**Image:** `ghcr.io/u2giants/popdam-bridge`

**Tags published:**
| Tag | Use |
|-----|-----|
| `:stable` | What `deploy/synology/docker-compose.yml` tracks; what in-app self-update pulls |
| `:v{version}` | Pinned rollback target (e.g. `:v1.15.8`) |
| `:latest` | Exists but not used by NAS compose or self-update |
| `:sha-{sha}` | Per-commit tag |

**After publishing:** `BRIDGE_LATEST_BUILD` is upserted into `admin_config` so the admin UI can show the new version and offer an in-app update.

**Versioning:** Bump `apps/bridge-agent/package.json` version in same commit.

### Updating the Bridge Agent on Synology

**Primary path — remote update via admin UI:**

Settings → Agents (Bridge) → Update button. The UI calls `apply-update` on admin-api, which sets an `UPDATE_REQUEST` key in `admin_config`. The bridge agent picks this up on its next heartbeat, pulls `:stable`, and recreates its own container using the Docker socket.

**Requires:** `restart: unless-stopped` in docker-compose.yml AND `/var/run/docker.sock:/var/run/docker.sock` mounted AND `POPDAM_CONTAINER_NAME: popdam-bridge` set in the environment block. All three are in `deploy/synology/docker-compose.yml`.

**Fallback — manual pull on the NAS:**

```bash
sudo docker compose pull && sudo docker compose down && sudo docker compose up -d
```

Run in the directory containing your `docker-compose.yml` (typically `/volume1/docker/popdam/`).

---

## 6) Windows Render Agent

**Workflow:** `.github/workflows/publish-windows-agent.yml`

**Path trigger:** `apps/windows-agent/**` or `packages/path-filters/**`

**Distribution:** GitHub Releases — `windows-agent-latest` tag

**Artifacts:**
- `popdam-windows-agent-setup.exe` — NSIS installer
- `popdam-windows-agent-dist.zip` — OTA update payload (JS only, no full installer)

**Versioning:** `{base}.{GITHUB_RUN_NUMBER}` — auto-incrementing run number appended to the version in `package.json`.

After publishing, the cloud is notified via `agent-api notify-build` so the admin UI can show the new version.

---

## 7) POP DAM Helper (Electron)

**Workflow:** `.github/workflows/publish-popdam-helper.yml`

**Path trigger:** `apps/popdam-helper/**`

**Distribution:** GitHub Releases — `popdam-helper-latest` tag

**Two parallel jobs:**
- **Build Windows** (`windows-latest`): produces `POP-DAM-Helper-Windows-Setup.exe` (x64)
- **Build Mac** (`macos-latest`): produces `POP-DAM-Helper-Mac-arm64.dmg` and `POP-DAM-Helper-Mac-x64.dmg`

**Code signing:** disabled in CI (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Auto-update requires code signing certs — see `HANDOFF.md`.

**Local development:**
```bash
cd apps/popdam-helper
npm install
npm run dev        # electron-vite dev server + Electron window
npm run typecheck
```

---

## 8) Secrets Handling

- Never commit secrets to git.
- `.env.example` is required for all components.
- Raw agent keys must never be stored in DB or returned by APIs.
- Runtime environment variables for `popdam-frontend` are managed in Coolify directly — not in GitHub or any committed file.

---

## 9) pg_cron Scheduled Jobs

pg_cron runs inside Supabase. All jobs are defined in migration files. Current active jobs:

| Job name | Schedule | What it does |
|----------|----------|-------------|
| `nightly-sg-crawl` | `0 2 * * *` (02:00 UTC = 9pm EST) | Upserts `STYLE_GUIDE_CRAWL_REQUEST` to trigger PopSG crawl |
| `nightly-reconcile-sg-asset-counts` | `45 3 * * *` (03:45 UTC) | Calls `refresh_style_group_counts_batch` over all style_groups |
| `purge-render-queue-old-rows` | `0 3 * * *` (03:00 UTC) | Deletes completed/failed render_queue rows older than 30 days |
| `purge-sg-render-queue-old-rows` | `15 3 * * *` (03:15 UTC) | Same for style_guide_render_queue |
| `purge-asset-path-history-old-rows` | `30 3 * * *` (03:30 UTC) | Deletes asset_path_history rows older than 90 days |

The `invoke-bulk-job-runner` cron was removed in migration `20260322000000`. Do not re-add it.

---

## 10) Golden Rule: File Date Preservation

The Bridge Agent volume mount should be `:ro` (read-only) whenever possible. The agent must never modify file timestamps on source art. See `docs/PROJECT_BIBLE.md` §15.
