# Deployment

## Deployment Path

Every production change follows this path:

1. Develop on a feature branch and open a pull request targeting `main`. Verify the GitHub remote with `git remote -v` and push to the remote whose URL is `https://github.com/u2giants/popdam3.git`; do not assume a remote alias identifies GitHub. Let required checks pass before merging through the normal protected path. Do not push application changes directly to `main`.
2. GitHub Actions evaluates path filters and runs the relevant workflow(s).
3. For frontend changes: `publish-frontend.yml` builds the React app, builds a Docker image with `Dockerfile.ci`, pushes it to GHCR as `ghcr.io/u2giants/popdam-frontend:latest`, `:sha-<short-sha>`, and `:<short-sha>` using `GHCR_PAT` when present, otherwise the workflow `GITHUB_TOKEN`, then calls the Coolify deploy API.
4. Coolify receives the webhook, pulls `:latest` from GHCR, and replaces the running container. No SSH is involved.
5. For Supabase edge-function changes: `deploy-supabase.yml` deploys all edge functions, then auto-generates and commits `src/integrations/supabase/types.ts`. Shared database structure changes are authored in canonical `popcre/shared-db` on a feature branch and pull request, then applied through its governed workflow; they are never run from this repository.
6. For Railway worker changes: Railway detects the push to `main` and triggers its own rebuild automatically — no GitHub Actions step required. GitHub's green `popdam / production` deployment badge is Railway worker status, not proof that the frontend has deployed.

Both `dam.designflow.app` (PopDAM) and `sg.designflow.app` (PopSG) are served by the same container. Traefik on the VPS routes both hostnames to `popdam-frontend`.

---

## GitHub Actions Workflows

| Name | File | Trigger | What it does |
|------|------|---------|-------------|
| CI | `ci.yml` | Push or PR to `main` | Lint, test, and build the frontend with Bun. No deployment. |
| Publish Frontend Image | `publish-frontend.yml` | Push to `main` touching `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `Dockerfile.ci`, `nginx.conf`, or the workflow file; also `workflow_dispatch` | `npm ci` → `vite build` → GHCR login via `GHCR_PAT` or `GITHUB_TOKEN` → `docker/build-push-action` with `Dockerfile.ci` → push to GHCR (`:latest`, `:sha-<sha>`, `:<sha>`) → POST Coolify deploy API |
| Deploy Supabase Edge Functions | `deploy-supabase.yml` | Push to `main` touching `supabase/functions/**` or the workflow file; also `workflow_dispatch` | Deploy all edge functions except `_shared` and fail the job if any deploy fails → generate TypeScript types → commit types back to `main` with `[skip ci]` |
| Edge Functions Format | `edge-functions-format.yml` | Push or PR to `main` touching `supabase/functions/**/*.ts`; also `workflow_dispatch` | Runs `deno fmt` on `supabase/functions/` and commits any formatting changes back |
| Publish Bridge Agent | `publish-bridge-agent.yml` | Push to `main` touching `apps/bridge-agent/**` or `packages/path-filters/**`; also tags matching `bridge-v*` | Builds and pushes Docker image `ghcr.io/u2giants/popdam-bridge` to GHCR with tags `:latest`, `:stable`, `:v{version}`, `:<sha>`; upserts `BRIDGE_LATEST_BUILD` in `admin_config` via Supabase PostgREST |
| Publish Windows Agent | `publish-windows-agent.yml` | Push to `main` touching `apps/windows-agent/**` or `packages/path-filters/**` | Builds TypeScript, bundles Node.js runtime, creates NSIS installer and zip artifact, creates versioned GitHub Release and updates `windows-agent-latest` release, POSTs `notify-build` to `agent-api` |
| Publish PopDAM Helper | `publish-popdam-helper.yml` | Push to `main` touching `apps/popdam-helper/**`; also `workflow_dispatch` | Builds Electron app for Windows (x64 NSIS installer) and macOS (arm64 + x64 DMG) in parallel, publishes all artifacts to GitHub Release `popdam-helper-latest` |
| OrderList Integration Live Proof | `orderlist-integration-live-proof.yml` | Manual `workflow_dispatch` on `main` only; requires the full deployed frontend commit SHA | Confirms the deployed source binding, verifies production types, performs read-only production acceptance as existing administrator and viewer accounts, and publishes generated-type and live-proof artifacts. It does not create accounts, change permissions, or write customer/application rows. |

**CI path filters:** `publish-frontend.yml` does not trigger on changes to `docs/**` or top-level `.md` files. `deploy-supabase.yml` does not trigger on frontend source changes.

### OrderList Integration Live Proof

The proof workflow checks the full SHA of the frontend already served in
production, validates the production project, generates the real production
TypeScript schema, and runs read-only administrator and viewer acceptance. It
publishes the generated schema, its verification record, and the live proof
record as GitHub Actions artifacts. Dispatch it on `main` only after its normal
merge/deployment gates; it verifies a deployment and does not deploy one.

The workflow uses four existing GitHub secrets. Their 1Password item references
are recorded here for secure maintenance; secret values must never be added to
this document, logs, arguments, or commits.

| GitHub secret | Existing 1Password item reference |
|---|---|
| `POPDAM_TEST_USER` | `op://vibe_coding/7s5uzpbjenka4fpvrqogh44bre` — `username` |
| `POPDAM_TEST_PASSWORD` | `op://vibe_coding/7s5uzpbjenka4fpvrqogh44bre` — `password` |
| `POPDAM_VIEWER_TEST_USER` | `op://vibe_coding/mbspkosvp2rf25qxhqufipxqca` — `username` |
| `POPDAM_VIEWER_TEST_PASSWORD` | `op://vibe_coding/mbspkosvp2rf25qxhqufipxqca` — `password` |

Use those existing accounts only. Transfer values through protected stdin when
maintaining GitHub secrets; do not create accounts or change their permissions.

### Frontend GHCR Package Access

What changed:
`publish-frontend.yml` logs in to GHCR with `GHCR_PAT` when present, otherwise `GITHUB_TOKEN`, uses Docker's official login/build-push actions, and pushes `popdam-frontend:latest`, `:sha-<sha>`, and `:<sha>`. It also supports `workflow_dispatch` for manual redeploys.

Why:
On 2026-06-10, production stayed on commit `8c0508d` because later frontend workflows passed build but failed before publishing a newer GHCR `:latest` image. Verified failures were `permission_denied: write_package` for `GITHUB_TOKEN` and `denied` for the existing `GHCR_PAT` retry; the fixed workflow uses a valid package-write `GHCR_PAT` fallback for the user-scoped package.

Future sessions should:
If the live header shows an old commit, compare it to the latest successful `Publish Frontend Image` run, not only the GitHub Deployments sidebar. A green `popdam / production` deployment can be Railway worker status. If frontend image push fails with `permission_denied: write_package`, verify that the `ghcr.io/u2giants/popdam-frontend` package exists, that repository `u2giants/popdam3` has package Actions access, or that repo secret `GHCR_PAT` is a valid package-write token.

### Latest verified OrderList refresh deployment

PR #289 merge `9883315c7d64b9ed274cc92ae3c1d0c73cc6597b` is live. Publish run
`37986360726` succeeded at 4:25 PM EDT; production returned HTTP 200 with token
`9883315`, served asset `/assets/index-B2s-PtZY.js` (SHA-256
`574bdff6df39c7533993996c591b04c8133e62e82b3e25626f29a5258c8c46fb`), and
`APP_DATE=2026-10-09T16:20:46-04:00`. The container is healthy, OCI revision
matches the merge, and Coolify deployment `btf5t1we2eh3alydmt6wxcoi` completed.
Focused administrator/viewer edit and refresh checks passed without production
business-row writes. Native workflow `37987001226` passed 90 checks across both
roles (checks-label manifest SHA-256
`708b9395e8e6e054372a7c9b7a7bb73b03f0ce3448df2acec338b447586eb0e1`). The
schema SHA-256 `fc9041a48038b8604e94a8e0169d06d049214eba57dd609dd296f95823738954`
matched; type artifact `11643178561` SHA-256
`7fdbb47c64e182e3893d104ef3105a751e6a5666efe857d9d640943d306229a7` and live
artifact `11642863862` SHA-256
`54f02a6384171d797ce11ba7ef306dbc39e7d9e41a24c71c3f12b1672332ed59` passed.
Shared-db #4111 and PopDAM #275 are closed. The #275 UI proof passed 53 administrator/viewer checks; report `coldlion-owner-link-proof.json` SHA-256 `fd33979beb4abe88c0a5eb969b58ec7b679ebffda9f227d63b1bfb9b6d7a219f`, with evidence in [#275 completion comment](https://github.com/u2giants/popdam3/issues/275#issuecomment-6089001259). PopDAM #281 is closed after reviewed documentation landed in PR #290. The post-link cohort has 23 lines across 7 Items; missing current Master tracker facts remain Unknown, with no records created.

### Frontend Deploy Verification Checklist

A frontend deployment is not proven live until all four checks pass:

1. The `Publish Frontend Image` GitHub Actions run is green.
2. GHCR has fresh `ghcr.io/u2giants/popdam-frontend:latest`, `:sha-<short-sha>`, and `:<short-sha>` tags for the target commit.
3. Coolify's deployment record is `finished`; a successful API response only means the deployment was queued.
4. Both `https://dam.designflow.app/library` and `https://sg.designflow.app/library` return HTTP 200 with a fresh `Last-Modified` header or new asset hash.

Common failure split:

- `permission_denied: write_package` in GitHub Actions: the workflow cannot push the user-scoped GHCR package. Check `GHCR_PAT` and package Actions access.
- `unauthorized` in Coolify deployment logs during `docker compose pull`: Coolify on the VPS cannot pull the private GHCR image. Refresh the VPS Docker login for `ghcr.io` without documenting token values.
- Public 502 while the app container is healthy: Traefik may not see Docker services. Check `docker logs coolify-proxy` for Docker provider errors. If `/var/run/docker.sock` inside `coolify-proxy` is stale compared with the host socket, restart only `coolify-proxy` to remount the live socket.

### Frontend VPS Break-Glass Deploy

What changed:
During the 2026-06-10 PopSG incident, the session shell was already running on the production VPS (`hetz`, public IP `178.156.180.212`). GHCR publish was blocked, so the fixed frontend image was built locally and the Coolify-managed service was recreated from `/data/coolify/applications/qxj8a0j3tpa9lq4q5rs6pezy/docker-compose.yaml` with `docker compose up -d --no-deps --force-recreate`.

Why:
This kept Coolify's compose project, labels, network, restart policy, and container name ownership intact while bypassing the broken GHCR push. The first local image served `403` because `dist/` files copied into nginx as unreadable (`index.html` mode `600`, asset directories `700`); `Dockerfile.ci` now runs `chmod -R a+rX /usr/share/nginx/html` to make future images nginx-readable.

Future sessions should:
Prefer the normal GitHub Actions → GHCR → Coolify path. If GHCR is down or package permissions block an urgent deploy and the shell is already on the VPS, build the frontend image locally, verify it is tagged `ghcr.io/u2giants/popdam-frontend:latest`, then recreate only the Coolify service from `/data/coolify/applications/qxj8a0j3tpa9lq4q5rs6pezy/docker-compose.yaml`. After recreation, verify `docker ps` reports the container healthy and `curl -I https://sg.designflow.app/library` returns `200`. Do not use this as the routine path; fix GHCR package access afterward.

---

## Docker Image

**Frontend image:** `ghcr.io/u2giants/popdam-frontend`

Tags pushed on every qualifying push to `main`:
- `:latest` — what Coolify pulls on deploy
- `:sha-<git-short-sha>` — immutable rollback/audit tag preferred by the CI/CD rules
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

**Runtime environment variables** live in Coolify — not in GitHub and not baked into the image. The frontend container is a pure static file server and has no runtime env vars. Runtime configuration for agents (DO Spaces keys, OpenRouter keys, etc.) is stored in the `admin_config` Supabase table and delivered to agents via heartbeat responses. The Railway worker's env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are set in the Railway dashboard. The OpenRouter key is NOT one of them: the worker reads `admin_config.OPENROUTER_API_KEY` like everything else, and only falls back to a Railway `OPENROUTER_API_KEY` if that row is empty.

**What Coolify owns:** container lifecycle, restart policy, health checks, domain bindings. Domain `dam.designflow.app` is routed via Docker labels that Coolify applies. Domain `sg.designflow.app` is routed via a Traefik file provider at `/data/coolify/proxy/dynamic/popdam-sg.yml` on the VPS host (bind-mounted into `coolify-proxy`), using a `@docker` cross-provider service reference to the same `popdam-frontend` container.

**Private GHCR pull credential:** Coolify's deployment helper uses the VPS Docker credential file (`/root/.docker/config.json`) to pull `ghcr.io/u2giants/popdam-frontend:latest`. Do not store the token value in docs or commit it to the repo. If Coolify logs `error from registry: unauthorized`, refresh the VPS Docker login for `ghcr.io`, then rerun the GitHub Actions workflow so the deploy still follows the normal CI → GHCR → Coolify path.

---

## Supabase Deployment

**Workflow:** `deploy-supabase.yml`

**Supabase project:** `qsllyeztdwjgirsysgai` (popdam-prod, Virginia), supplied via GitHub secret `EXTERNAL_SUPABASE_PROJECT_ID`. The previous Ohio project was `ryltkzzernhwnojzouyb`.

**Migrations:** This repo no longer runs database migrations. New shared Supabase schema/data changes must be authored in canonical `popcre/shared-db` under `supabase/migrations/`, tested through the `Shared Supabase Migrations` workflow, and merged via the shared-db feature-branch + PR process. The local `supabase/migrations/` folder is historical only.

**Edge functions:** When `supabase/functions/**` files change, the workflow deploys all subdirectories under `supabase/functions/` except `_shared`, using `supabase functions deploy <name> --no-verify-jwt`. The loop records failures and exits non-zero after attempting all deploys, so a broken function no longer produces a green workflow.

**TypeScript type generation:** After deploying, the workflow runs `supabase gen types typescript --project-id $SUPABASE_PROJECT_ID` and writes the output to `src/integrations/supabase/types.ts`. If the file changed, it commits it back to `main` with message `chore: auto-generate Supabase types [skip ci]`.

**Required GitHub secrets:** `SUPABASE_ACCESS_TOKEN`, `EXTERNAL_SUPABASE_PROJECT_ID`.

**Critical constraint:** Do not add new files under this repo's `supabase/migrations/`. The `Forbid Shared DB Bypass` workflow blocks app-owned shared database changes. Use `shared-db/AGENTS.md` for the canonical migration discipline.

---

## Environment Promotion

There is no staging environment. There is one production environment.

Application changes are merged to `main` through feature branches and pull requests after required checks; production workflows run from the merged source. There is no staging environment or manual staging-to-production promotion step.

Railway auto-deploys on every push to `main` regardless of which files changed (Railway does not support path filters). This means every push to `main` triggers a Railway worker rebuild, even if `apps/worker/` was not touched.

---

## Worker outbound connectivity

`apps/worker/railway.toml` enables supported outbound IPv6 through `deploy.ipv6EgressEnabled = true`; existing IPv4 remains available. October 11, 2026 live verification of PR #344 proved that the actual worker discovers eight Meta models, including Contributor, over IPv6, while IPv4 and the ordinary default fetch return zero models and Contributor 404. The same protected key works from the operator host. This is a connection-origin difference; billing, capacity and an exact Meta-side cause are not proved.

The direct Meta client uses a request-scoped Undici dispatcher with DNS `order: ipv6first` and native connection-family fallback. It resolves the official hostname normally, preserves TLS verification/SNI and IPv4 connection fallback, and changes no global DNS or dispatcher setting. Other providers and Supabase retain their existing connections. There is no address pin, proxy, model switch, credential rotation, timeout increase, region change or replica change. The worker's existing response validation, Contributor concurrency cap and bounded retries remain in place. Sources: https://docs.railway.com/networking/outbound-networking and https://nodejs.org/api/dns.html#dnslookuphostname-options-callback.

### Exact deployment and single-asset verification for this repair

Owner request in chat, quoted verbatim: "do deeper research. fix the problem" and "tag the untagged PopDAM assets using Muse Spark 1.3 contributor". Owner: Codex chat 01a12c67-9746-7172-9ffb-36ff93bbfec2. Tracker: https://github.com/u2giants/popdam3/issues/96. Independent review must explicitly authorize the source deployment and ONE conditional native real-asset canary described here; code-only/document-only approval does not authorize row writes.

Deploy only by normal feature PR/checks/merge and Railway's automatic GitHub deployment, with all worker operations idle immediately before merge and production gates passed. Production target: Railway project8645c5fe-ae60-413e-8464-508456c65365, environment70aef28e-b9f8-4aa6-b902-c9a06aec08d5, servicef777713f-d0f8-4f9b-9685-37c9090c98ef; one replica in us-east4-eqdc4a. Verify successful merged SHA, effective IPv6=true, unchanged placement/key and ordinary Supabase polling. From that actual runtime, at most four metadata GETs using the shipped Meta dispatcher may establish a nonempty list with Contributor and exact Contributor HTTP200; no paid synthetic probe.

ONLY after those guards pass, take the exact asset identity privately from the sole `params.asset_ids` element in the completed prior `ai-tag-untagged` receipt with run_id90267d0a-25d9-42fc-842a-5bcd67109081. That is an operation ID, not an asset UUID. Immediately before enqueue assert that exact receipt ID, completed status, no external_job, one ID, active/pending asset with working thumbnail and no active AI tags. If anything changes, stop; never choose a replacement asset. Re-prove production Supabase https://qsllyeztdwjgirsysgai.supabase.co, exact `meta-direct/muse-spark-1.3-contributor`, blank fallback/provider pin and no conflicting jobs. Privately back up the receipt. With independent exact-head action approval and production/database gates, use existing admin-api `update-bulk-op`, op_key `ai-tag-untagged`, `only_if_status: completed`, fresh run_id/running state/cursor0/progress.total1 and the one proved asset ID. Assert read-back own run_id and await terminal receipt. No direct SQL writes. Success requires tagged1/failed0, fresh saved ai_tagged_at, exact model, nonblank description and active AI tags. Completed+failed1 is failure. Manual tags and rejection tombstones retain existing protections.

No bulk run, group profiling, PopSG, preview changes or new provider terms are authorized by this one-asset verification. If connection verification or the canary fails, stop without repeating paid requests; preserve failure receipts and review the next exact action. A failed deploy is reverted through a fresh current-upstream reviewed PR removing only owned changes, preserving intervening work. The original missing-tag request remains open until persisted worker proof and separately reviewed bulk processing complete. Required reviewer sentence if approving both actions: "Approved the Meta connection deployment and one conditional native canary as specified."

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
- Schema changes (use canonical `shared-db` branch + PR) or edge function changes (commit to this repo and let `deploy-supabase.yml` deploy functions)
- Hotfixes (use a feature branch and pull request, then merge through the normal protected path)

Any change made via SSH must be followed immediately by committing a permanent fix to the repo or recording the change in Coolify. The server must never become a hidden source of truth.

The `VPS_SSH_KEY` GitHub secret was removed on 2026-05-15. GitHub Actions no longer has SSH access to the VPS.

---

## Bridge Agent Deployment

The bridge agent runs as a Docker container on the Synology NAS, managed by `docker-compose` with the reference file at `deploy/synology/docker-compose.yml`. The image is `ghcr.io/u2giants/popdam-bridge:stable`.

**Building and publishing (automated):** `publish-bridge-agent.yml` triggers when `apps/bridge-agent/**` or `packages/path-filters/**` changes. It builds and pushes the image with tags `:stable`, `:latest`, `:v{semver}`, and `:<sha>`. After a successful push, it upserts `BRIDGE_LATEST_BUILD` in the `admin_config` table so the admin UI can show the current build.

**Updating on the NAS (two paths):**

Primary — in-app self-update: Admin UI → Settings → Agents → Update. This sets an `UPDATE_REQUEST` command in `admin_config`. The agent receives it on the next heartbeat, pulls `:stable`, and recreates through its existing Compose file, run from a detached one-shot helper container under the host project name (see KNOWN_QUIRKS #26). If Compose cannot be found or fails, the update stops visibly and preserves the running container; there is no unmanaged `docker run` fallback.

Fallback — manual on NAS:
```bash
sudo docker compose pull
sudo ./update.sh
```

The updater validates Compose before mutation, recreates only `bridge-agent`, waits through the restart window, confirms zero restarts plus Compose ownership, and restores the prior image on failure. Never use `docker compose down` for a bridge update. The PopDAM NAS mount must be writable for marker/check-in behavior; the independent Style Guides mount remains read-only. The reference Compose intentionally omits `deploy.resources.limits.cpus` because the Synology kernel rejects Docker NanoCPU controls.

**Versioning:** bump `apps/bridge-agent/package.json` version in the same commit as any bridge agent change (patch/minor/major per impact).

---

## Worker Deployment

The cloud worker (`apps/worker/`) runs on Railway as a persistent Node.js process.

**Deploy trigger:** Railway watches `main` and rebuilds on every push — there is no path filter. A push that only touches `src/` still triggers a Railway rebuild of the worker. This is a Railway platform constraint.

**No manual step required.** Railway detects the push, rebuilds from `apps/worker/Dockerfile`, and replaces the running container automatically.

**Runtime env vars** are set in the Railway dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_AI_API_KEY`, `META_API_KEY`, and `SCALEDOWN_API_KEY`. The OpenRouter key comes from `admin_config.OPENROUTER_API_KEY` (Settings → Processing → AI Tagging); a Railway `OPENROUTER_API_KEY` is only a fallback. Meta and ScaleDown keys set in Settings take precedence, with Railway values used only if the corresponding Settings row is missing or unreadable.

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

One normal path, no SSH deploys: merge a reviewed pull request to `main` → GitHub Actions verifies/builds/publishes to GHCR → triggers the Coolify API → Coolify pulls the image. Workflows never SSH the server or run `docker`/`compose` on it as part of a normal deploy. `main` is the only release branch (no staging/promotion).

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
