# Deployment

## Deployment Path

Every production change follows this path:

1. Developer commits and pushes to `main` on both `origin` (harness proxy) and `github` (direct GitHub remote).
2. GitHub Actions evaluates path filters and runs the relevant workflow(s).
3. For frontend changes: `publish-frontend.yml` builds the React app, builds a Docker image with `Dockerfile.ci`, pushes it to GHCR as `ghcr.io/u2giants/popdam-frontend:latest` and `:<short-sha>` using the workflow `GITHUB_TOKEN` first, then `GHCR_PAT` as a retry fallback, then calls the Coolify deploy API.
4. Coolify receives the webhook, pulls `:latest` from GHCR, and replaces the running container. No SSH is involved.
5. For Supabase changes: `deploy-supabase.yml` runs `supabase db push` (migrations) and/or deploys all edge functions, then auto-generates and commits `src/integrations/supabase/types.ts`.
6. For Railway worker changes: Railway detects the push to `main` and triggers its own rebuild automatically — no GitHub Actions step required.

Both `dam.designflow.app` (PopDAM) and `sg.designflow.app` (PopSG) are served by the same container. Traefik on the VPS routes both hostnames to `popdam-frontend`.

---

## GitHub Actions Workflows

| Name | File | Trigger | What it does |
|------|------|---------|-------------|
| CI | `ci.yml` | Push or PR to `main` | Lint, test, and build the frontend with Bun. No deployment. |
| Publish Frontend Image | `publish-frontend.yml` | Push to `main` touching `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `nginx.conf`, or the workflow file; also `workflow_dispatch` | `npm ci` → `vite build` → GHCR login via `GITHUB_TOKEN` → `docker build -f Dockerfile.ci` → push to GHCR (`:latest` + `:<sha>`) → retry with `GHCR_PAT` if needed → POST Coolify deploy API |
| Deploy Supabase (Edge Functions + Migrations) | `deploy-supabase.yml` | Push to `main` touching `supabase/functions/**`, `supabase/migrations/**`, or the workflow file; also `workflow_dispatch` | `supabase db push` (if migrations changed) → deploy all edge functions except `_shared` → generate TypeScript types → commit types back to `main` with `[skip ci]` |
| Edge Functions Format | `edge-functions-format.yml` | Push or PR to `main` touching `supabase/functions/**/*.ts`; also `workflow_dispatch` | Runs `deno fmt` on `supabase/functions/` and commits any formatting changes back |
| Publish Bridge Agent | `publish-bridge-agent.yml` | Push to `main` touching `apps/bridge-agent/**` or `packages/path-filters/**`; also tags matching `bridge-v*` | Builds and pushes Docker image `ghcr.io/u2giants/popdam-bridge` to GHCR with tags `:latest`, `:stable`, `:v{version}`, `:<sha>`; upserts `BRIDGE_LATEST_BUILD` in `admin_config` via Supabase PostgREST |
| Publish Windows Agent | `publish-windows-agent.yml` | Push to `main` touching `apps/windows-agent/**` or `packages/path-filters/**` | Builds TypeScript, bundles Node.js runtime, creates NSIS installer and zip artifact, creates versioned GitHub Release and updates `windows-agent-latest` release, POSTs `notify-build` to `agent-api` |
| Publish PopDAM Helper | `publish-popdam-helper.yml` | Push to `main` touching `apps/popdam-helper/**`; also `workflow_dispatch` | Builds Electron app for Windows (x64 NSIS installer) and macOS (arm64 + x64 DMG) in parallel, publishes all artifacts to GitHub Release `popdam-helper-latest` |
| Deploy PopSG Supabase (Edge Functions) | `deploy-popsg-supabase.yml` | `workflow_dispatch` only | Deploys edge functions from `supabase-popsg/` to the old PopSG Supabase project. **This workflow targets dead code and should not be used.** |

**CI path filters:** `publish-frontend.yml` does not trigger on changes to `docs/**` or top-level `.md` files. `deploy-supabase.yml` does not trigger on frontend source changes.

**Stale frontend diagnostic:** if the live app still shows an old commit, compare it to the latest successful `Publish Frontend Image` run. Coolify only moves after GHCR `:latest` is pushed and the Coolify deploy API step succeeds; a workflow failure before those steps leaves production on the previous successful image. If `docker push` fails with `permission_denied: write_package`, grant `u2giants/popdam3` Write access under the `popdam-frontend` package's "Manage Actions access" settings, or set `GHCR_PAT` to a classic PAT with `write:packages` owned by a package admin.

---

## Docker Image

**Frontend image:** `ghcr.io/u2giants/popdam-frontend`

Tags pushed on every qualifying push to `main`:
- `:latest` — what Coolify pulls on deploy
- `:<git-short-sha>` — immutable tag for rollback (e.g., `ghcr.io/u2giants/popdam-frontend:a3f2c1d`)

**Dockerfile used by CI:** `Dockerfile.ci` (runtime-only nginx stage; the Vite build runs in the GitHub Actions runner before `docker build` is called)

**Runtime base image:** `nginx:1.27-alpine`, port 80. Serves the pre-built `dist/` as static files.

**Build-time args injected by CI:** `APP_COMMIT` (git short hash), `APP_DATE` (ISO commit date). These are embedded in the bundle via `vite.config.ts` `define:` and are not runtime env vars.

**Bridge agent image:** `ghcr.io/u2giants/popdam-bridge`

Tags pushed when `apps/bridge-agent/**` changes:
- `:stable` — what the NAS docker-compose and in-app self-update pull
- `:latest`
- `:v{semver}` (from `apps/bridge-agent/package.json`)
- `:<sha>`

---

## Coolify

**How it is triggered:** GitHub Actions POSTs to the Coolify REST API after pushing the image to GHCR:

```
GET/POST $COOLIFY_URL/api/v1/deploy?uuid=$COOLIFY_APP_UUID&force=false
Authorization: Bearer $COOLIFY_TOKEN
```

Coolify then pulls `ghcr.io/u2giants/popdam-frontend:latest` and replaces the running container. No SSH. No `docker run` on the server.

**App UUID:** `qxj8a0j3tpa9lq4q5rs6pezy`

**Traefik service name:** `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker` (stable across container redeploys; derived from app UUID)

**Coolify URL:** `https://coolify.designflow.app`

**VPS host:** `178.156.180.212`

**Runtime environment variables** live in Coolify — not in GitHub and not baked into the image. The frontend container is a pure static file server and has no runtime env vars. Runtime configuration for agents (DO Spaces keys, OpenRouter keys, etc.) is stored in the `admin_config` Supabase table and delivered to agents via heartbeat responses. The Railway worker's env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`) are set in the Railway dashboard.

**What Coolify owns:** container lifecycle, restart policy, health checks, domain bindings. Domain `dam.designflow.app` is routed via Docker labels that Coolify applies. Domain `sg.designflow.app` is routed via a Traefik file provider at `/data/coolify/proxy/dynamic/popdam-sg.yml` on the VPS host (bind-mounted into `coolify-proxy`), using a `@docker` cross-provider service reference to the same `popdam-frontend` container.

---

## Supabase Deployment

**Workflow:** `deploy-supabase.yml`

**Supabase project:** `ryltkzzernhwnojzouyb` (popdam-prod), supplied via GitHub secret `EXTERNAL_SUPABASE_PROJECT_ID`.

**Migrations:** When `supabase/migrations/**` files change in a push, the workflow runs `supabase db push`. This applies any local migration files not yet recorded in the DB's migration history, in timestamp order. The workflow does NOT use `--include-all`. The CI job checks `git diff HEAD~1 HEAD` to detect whether migration files changed before running `db push`.

**Edge functions:** When `supabase/functions/**` files change, the workflow deploys all subdirectories under `supabase/functions/` except `_shared`, using `supabase functions deploy <name> --no-verify-jwt`. A failure on one function is logged and the loop continues.

**TypeScript type generation:** After deploying, the workflow runs `supabase gen types typescript --project-id $SUPABASE_PROJECT_ID` and writes the output to `src/integrations/supabase/types.ts`. If the file changed, it commits it back to `main` with message `chore: auto-generate Supabase types [skip ci]`.

**Required GitHub secrets:** `SUPABASE_ACCESS_TOKEN`, `EXTERNAL_SUPABASE_PROJECT_ID`, `EXTERNAL_SUPABASE_DB_PASSWORD`.

**Critical constraint:** The local migration filename timestamp must match the timestamp Supabase recorded when the migration was applied. Use `apply_migration` MCP → `list_migrations` MCP → create local file with the exact recorded timestamp. A mismatch causes `supabase db push` to fail in CI. See `CLAUDE.md` for the full discipline.

---

## Environment Promotion

There is no staging environment. There is one production environment.

All changes go directly to `main` and are deployed immediately to production. There are no feature branches, no PR-based workflows, and no staging → production promotion step.

Railway auto-deploys on every push to `main` regardless of which files changed (Railway does not support path filters). This means every push to `main` triggers a Railway worker rebuild, even if `apps/worker/` was not touched.

---

## Rollback

**Frontend rollback:**

1. In the Coolify UI, navigate to the `popdam-frontend` app and open the deployment history.
2. Each past deployment corresponds to a `:<sha>` image tag (e.g., `ghcr.io/u2giants/popdam-frontend:a3f2c1d`).
3. Change the image tag in Coolify to the desired `:<sha>` and trigger a redeploy.
4. Coolify pulls that specific image and replaces the container.

Do not SSH into the server to roll back. Prefer the Coolify UI path.

**Supabase rollback:** Supabase migrations are forward-only. There is no automated rollback mechanism. To undo a migration, write a new migration that reverses the change.

**Railway worker rollback:** Railway keeps deployment history. Roll back via the Railway dashboard by redeploying a prior build.

---

## SSH Access Policy

SSH access to `178.156.180.212` is **emergency break-glass only**. It is not part of any normal deployment path.

Appropriate uses:
- Incident debugging when Coolify cannot provide needed logs
- Emergency repairs that cannot wait for a CI cycle
- One-off diagnostics during an active incident

SSH is not appropriate for:
- Routine deployments (use GitHub Actions → Coolify API)
- Runtime configuration changes (use Coolify UI)
- Schema or edge function changes (use `apply_migration` MCP + push to `main`)
- Hotfixes (commit to `main` and push; CI deploys in ~2 minutes)

Any change made via SSH must be followed immediately by committing a permanent fix to the repo or recording the change in Coolify. The server must never become a hidden source of truth.

The `VPS_SSH_KEY` GitHub secret was removed on 2026-05-15. GitHub Actions no longer has SSH access to the VPS.

---

## Bridge Agent Deployment

The bridge agent runs as a Docker container on the Synology NAS, managed by `docker-compose` with the reference file at `deploy/synology/docker-compose.yml`. The image is `ghcr.io/u2giants/popdam-bridge:stable`.

**Building and publishing (automated):** `publish-bridge-agent.yml` triggers when `apps/bridge-agent/**` or `packages/path-filters/**` changes. It builds and pushes the image with tags `:stable`, `:latest`, `:v{semver}`, and `:<sha>`. After a successful push, it upserts `BRIDGE_LATEST_BUILD` in the `admin_config` table so the admin UI can show the current build.

**Updating on the NAS (two paths):**

Primary — in-app self-update: Admin UI → Settings → Agents → Update. This sets an `UPDATE_REQUEST` command in `admin_config`. The agent receives it on the next heartbeat, pulls `:stable`, and recreates its own container. Requires `POPDAM_CONTAINER_NAME` env var to be set in the agent's `.env`; without it, old containers accumulate.

Fallback — manual on NAS:
```bash
sudo docker compose pull
sudo docker compose down
sudo docker compose up -d
```

**Versioning:** bump `apps/bridge-agent/package.json` version in the same commit as any bridge agent change (patch/minor/major per impact).

---

## Worker Deployment

The cloud worker (`apps/worker/`) runs on Railway as a persistent Node.js process.

**Deploy trigger:** Railway watches `main` and rebuilds on every push — there is no path filter. A push that only touches `src/` still triggers a Railway rebuild of the worker. This is a Railway platform constraint.

**No manual step required.** Railway detects the push, rebuilds from `apps/worker/Dockerfile`, and replaces the running container automatically.

**Runtime env vars** are set in the Railway dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_AI_API_KEY`.

**The worker is not triggered by HTTP.** It runs a continuous polling loop, reading `admin_config.BULK_OPERATIONS` every 1 second. Admin UI actions write a `queued` entry to that config key; the worker picks it up on the next poll.

**Versioning:** bump `apps/worker/package.json` version in the same commit as any worker change.

---

## CI/CD ownership model

Standard single-orchestrated-path, deployment-platform-owned model:

| Owner | Source of truth for |
|-------|---------------------|
| **GitHub** (`main`) | application code, Dockerfiles, Compose, GitHub Actions workflows, deployment docs |
| **GHCR** | built image artifacts (`ghcr.io/u2giants/popdam-frontend`, `ghcr.io/u2giants/popdam-bridge`) |
| **Coolify** | runtime env vars, domains, health checks, restart policy, deploy execution for `popdam-frontend` |
| **Railway** | the worker container lifecycle + its runtime env vars |
| **Production VPS** | runtime host only — never a configuration source |

One normal path, no SSH deploys: push to `main` → GitHub Actions verifies/builds/publishes to GHCR → triggers the Coolify API → Coolify pulls the image. Workflows never SSH the server or run `docker`/`compose` on it as part of a normal deploy. `main` is the only release branch (no staging/promotion).

---

## pg_cron scheduled jobs

pg_cron runs inside Supabase; all jobs are defined in migration files. Current active jobs:

| Job name | Schedule (UTC) | What it does |
|----------|----------------|-------------|
| `nightly-sg-crawl` | `0 2 * * *` | Upserts `STYLE_GUIDE_CRAWL_REQUEST` to trigger the PopSG crawl |
| `nightly-reconcile-sg-asset-counts` | `45 3 * * *` | Calls `refresh_style_group_counts_batch` over all `style_groups` (asset-count drift catch) |
| `purge-render-queue-old-rows` | `0 3 * * *` | Deletes completed/failed `render_queue` rows older than 30 days |
| `purge-sg-render-queue-old-rows` | `15 3 * * *` | Same for `style_guide_render_queue` |
| `purge-asset-path-history-old-rows` | `30 3 * * *` | Deletes `asset_path_history` rows older than 90 days |

The `invoke-bulk-job-runner` cron was removed in migration `20260322000000` — do not re-add it (the `bulk-job-runner` edge function is a deployed no-op; all batch work runs in the Railway worker).
