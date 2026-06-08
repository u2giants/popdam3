# AGENTS.md — PopDAM Developer & AI Session Guide

Read this first. Under 5 minutes. Everything else in `docs/` is a deep-dive reference.

---

## 1. Project Summary

**PopDAM** is an internal Digital Asset Manager for licensed consumer-product art (Disney, Marvel, etc.). Source design files (PSD, AI) live on a Synology NAS. The system ingests them, generates thumbnails, uploads them to DigitalOcean Spaces, and gives the team a dark-mode web UI for browsing, searching, filtering, tagging, and managing artwork submissions.

**PopSG** is a second mode served by the same codebase — a style-guide library for licensors (folder-based browsing, no SKUs or ERP). Same Docker image; hostname determines mode at runtime.

**What matters:** assets get processed quickly, thumbnails appear, ERP codes resolve correctly, and style group assignments stay accurate. The team reviews and approves artwork against licensing deadlines.

**Key moving parts:**

| Component | Location | Platform |
|-----------|----------|----------|
| React web app | `src/` | Coolify (Docker, self-hosted VPS) |
| Supabase edge functions | `supabase/functions/` | Supabase (Deno) |
| PostgreSQL DB | `supabase/migrations/` | Supabase (hosted) |
| Cloud worker (AI tagging, ERP, rebuild) | `apps/worker/` | Railway (Node.js) |
| Bridge agent (NAS scanner + thumbnailer) | `apps/bridge-agent/` | Synology Docker |
| Windows render agent (Illustrator) | `apps/windows-agent/` | Windows VM (manual install) |
| Desktop helper (checkout/checkin) | `apps/popdam-helper/` | Electron, Mac + Windows |

---

## Multi-model AI note

There is no universal ignore-file standard across AI coding tools.

`.claudeignore` works for Claude Code.

When using any other AI tool, paste this file as your first message and follow the instructions in the "What to Ignore" section.

(`.cursorignore` exists with matching content. There is no `.copilotignore` — GitHub Copilot is not used in this repo.)

---

## Documentation map: what to read for each task

Always start with:

- `AGENTS.md` (this file)
- `HANDOFF.md` **if it exists** — unfinished/in-progress work; required reading before continuing anything.

Then load additional docs only when relevant — do **not** ingest every `.md` file:

| Task / question | Read these docs | Usually do not need |
|---|---|---|
| Quick repo orientation | `README.md`, `AGENTS.md` | Deep docs under `docs/` unless the task needs them |
| Modify app behavior / project-owned code | `AGENTS.md`, the relevant folder/area, `docs/ARCHITECTURE.md` if system design is affected | `docs/DEPLOYMENT.md` unless deploy behavior changes |
| Change configuration, env vars, admin_config keys, or runtime settings | `AGENTS.md`, `docs/configuration.md`, `docs/INFRASTRUCTURE.md`; Coolify for prod runtime env | unrelated architecture docs |
| Change local setup, dev scripts, test/lint, tooling | `AGENTS.md`, `docs/development.md`, the relevant `package.json`/config | `docs/DEPLOYMENT.md` unless CI/CD changes |
| Change deployment, Docker, CI/CD, hosting, rollback | `AGENTS.md` → Deployment, `docs/DEPLOYMENT.md`, `SELFHOST.md`, `.github/workflows/*` | local-only dev docs |
| Change DB schema, migrations, models, external IDs, data flow | `AGENTS.md`, `CLAUDE.md` (migration timestamp discipline — **read before any migration**), `docs/SCHEMA.md`, `docs/STYLE_GROUPS.md` if groups are touched | deployment docs unless rollout changes |
| Work on bulk operations / the Railway worker | `AGENTS.md`, `docs/BULK_JOBS.md`, `docs/WORKER_LOGIC.md` | unrelated UI docs |
| Work on ERP sync / MG codes / category classification | `AGENTS.md`, `docs/ERP_ENRICHMENT_PLAN.md` | deployment docs |
| Work on the desktop Helper / checkout-checkin / Seafile / SeaDrive | `AGENTS.md`, `docs/POPDAM_HELPER.md`, `docs/SEAFILE_INTEGRATION.md` | PopSG / ERP docs |
| Work on PopSG (style-guide mode) | `AGENTS.md`, `docs/POPSG.md` | PopDAM-only ERP/style-group docs |
| Work on auth / SSO / login | `AGENTS.md`, `docs/AUTHENTICATION.md` | unrelated docs |
| Investigate bugs / incidents | `AGENTS.md` → Incidents + Intentional Quirks, `docs/KNOWN_QUIRKS.md`, `HANDOFF.md` if present | unrelated folder docs |
| Continue unfinished work | `AGENTS.md`, `HANDOFF.md`, the docs named inside `HANDOFF.md` | docs unrelated to the handoff scope |
| Claude Code session | `CLAUDE.md`, then `AGENTS.md` | other docs unless the task needs them |
| Documentation-only cleanup | `AGENTS.md`, `README.md`, the affected docs under `docs/` | source files except as needed to verify accuracy |

> **Doc-set note:** the actively-maintained reference set is the UPPERCASE `docs/*.md` (e.g. `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`) plus the lowercase `docs/configuration.md` and `docs/development.md`. The lowercase `docs/architecture.md` and `docs/deployment.md` are older parallel copies that overlap their UPPERCASE namesakes — prefer the UPPERCASE ones; consolidation is tracked in Pending Work. `lucid.md`/`future_improvements.md` are research/strategy notes, not operating docs.

---

## Multi-model AI usage in code (where models are configured)

This codebase uses multiple AI models in multiple places. Before changing any model reference, check ALL of:
- `admin_config.AI_TASK_MODELS` (DB table, runtime-configurable)
- `apps/worker/src/handlers/erp.ts` — ERP classification model
- `apps/bridge-agent/src/pdf-text-sampler.ts` — PDF extraction cascade
- `apps/windows-agent/src/pdf-text-sampler.ts` — same cascade on Windows side
- `supabase/functions/ai-tag/` — legacy vision tagging (now Windows agent only)

Changing a model in one place does not change it in others. Each consumer reads from a different config source.

---

## 3. Repository Structure

```
popdam3/
├── src/                        ← React web app (Vite + Tailwind + Shadcn)
│   ├── components/settings/    ← Admin UI — bulk ops, ERP, diagnostics
│   ├── components/library/     ← Asset grid, detail panel, filters
│   ├── pages/popsg/            ← PopSG-only pages (IS_POPSG guards)
│   ├── lib/app-mode.ts         ← Runtime mode detection (dam vs sg hostname)
│   └── integrations/supabase/ ← Generated types + Supabase client
├── supabase/
│   ├── functions/              ← Edge functions (Deno)
│   │   ├── admin-api/          ← Admin operations router (~1300 lines)
│   │   ├── agent-api/          ← Bridge/Windows agent comms (~2800 lines)
│   │   ├── helper-api/         ← Desktop helper checkout/checkin
│   │   ├── _shared/            ← Shared handlers, types, constants
│   │   └── bulk-job-runner/    ← No-op stub (replaced by Railway worker)
│   └── migrations/             ← Timestamped SQL migration files
├── apps/
│   ├── worker/                 ← Railway cloud worker (Node.js, TypeScript)
│   │   └── src/handlers/       ← Per-operation batch handlers
│   ├── bridge-agent/           ← Synology NAS agent (Docker, TypeScript)
│   ├── windows-agent/          ← Windows Illustrator render agent (TypeScript)
│   └── popdam-helper/          ← Electron desktop app
├── packages/path-filters/      ← Shared path filter logic (Node.js workspace pkg)
├── scripts/                    ← Utility scripts (nas-ssh.sh, etc.)
├── deploy/synology/            ← Reference docker-compose.yml for NAS
├── .github/workflows/          ← CI/CD pipelines
├── docs/                       ← Deep-dive reference docs
├── CLAUDE.md                   ← Claude Code instructions (read after this)
├── SELFHOST.md                 ← VPS / Coolify / Traefik ops guide
└── HANDOFF.md                  ← Unfinished work (delete when done)
```

**Generated / third-party (do not edit):**
- `src/integrations/supabase/types.ts` — auto-generated by `deploy-supabase.yml`
- `dist/` — Vite build output
- `node_modules/`, `apps/*/node_modules/`
- `.lovable/` — Lovable platform memory (ignore)
- `supabase-popsg/` — dead code directory for an abandoned separate Supabase project

---

## 4. Prime Directive: Custom-Code Boundary

Project-owned code lives in:

```
src/
supabase/functions/
supabase/migrations/
apps/worker/src/
apps/bridge-agent/src/
apps/windows-agent/src/
apps/popdam-helper/src/
packages/path-filters/src/
```

**Before touching anything outside these paths, ask why.** The main risk areas:
- `src/integrations/supabase/client.ts` — re-exports from `external-supabase.ts`; Lovable overwrites this periodically (quirk #2)
- `src/integrations/supabase/types.ts` — auto-generated; edit will be overwritten on next deploy
- `supabase-popsg/` — dead code directory, do not edit or deploy from it

---

## 5. Core Modification Inventory

Files outside project-owned areas that were intentionally modified:

| File | Change made | Why necessary | Upgrade risk |
|------|------------|---------------|--------------|
| `nginx.conf` | Added `listen [::]:80;` | Coolify health check resolves `localhost` → `::1` on IPv6; nginx only listening on IPv4 caused health check failures and Traefik routing to stop | Low — standard nginx directive |

---

## 6. Task-to-File Navigation

| Task | Files to touch | Files NOT to touch |
|------|---------------|-------------------|
| Add/fix admin UI bulk operation | `src/components/settings/diagnostics/`, `apps/worker/src/handlers/`, `apps/worker/src/operation-loop.ts`, `supabase/functions/_shared/operation-constants.ts` | `supabase/functions/bulk-job-runner/` (no-op stub) |
| Add/fix edge function route | `supabase/functions/admin-api/index.ts` or `agent-api/index.ts`, `supabase/functions/_shared/admin-handlers/` | `src/integrations/supabase/types.ts` (auto-generated) |
| DB schema change | New file in `supabase/migrations/` via `apply_migration` MCP | Any existing migration file |
| Fix style group rebuild | `apps/worker/src/handlers/style-groups.ts`, DB functions in `supabase/migrations/` | `supabase/functions/bulk-job-runner/` |
| Fix style group asset_count drift | `supabase/migrations/` (new migration), `supabase/functions/_shared/` | — |
| Fix ERP sync | `apps/worker/src/handlers/erp.ts`, `supabase/functions/_shared/mg-codes.ts`, `src/lib/mg-lookup.ts` | — |
| Fix bridge agent scan | `apps/bridge-agent/src/scanner.ts`, `apps/bridge-agent/src/handlers/` | — |
| Fix thumbnail generation | `apps/bridge-agent/src/thumbnailer.ts` | — |
| Add PopSG page | `src/pages/popsg/`, `src/App.tsx` (route guard) | `src/components/library/` (PopDAM-only) |
| Change Traefik routing | `/data/coolify/proxy/dynamic/` on VPS, or Coolify app config | `nginx.conf` (unless fixing health check) |
| Change AI classification prompt | `apps/worker/src/handlers/erp.ts` (~line 336) | — |
| Add new pg_cron job | New migration file using `cron.schedule()` | Direct Supabase Dashboard edits |

---

## 7. Important Identifiers

| Identifier | Value | Do not... |
|-----------|-------|-----------|
| Supabase project ID (prod) | `ryltkzzernhwnojzouyb` | Confuse with SynoMon project `qnjimovrsaacneqkggsn` |
| Coolify app UUID | `qxj8a0j3tpa9lq4q5rs6pezy` | Regenerate — embedded in Traefik service name and CI secrets |
| Coolify Traefik service name | `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker` | Change — referenced in `popdam-sg.yml` file provider |
| Production domains | `dam.designflow.app`, `sg.designflow.app` | — |
| DigitalOcean Spaces bucket | `popdam` (CDN: `cdn.designflow.app`) | Rename without migrating all `thumbnail_url` values |
| Railway worker service | `apps/worker/` project in Railway | Deploy manually — Railway auto-deploys from `main` |
| GHCR frontend image | `ghcr.io/u2giants/popdam-frontend` | Rename without updating `Dockerfile.ci` and Coolify app config |
| GHCR bridge agent image | `ghcr.io/u2giants/popdam-bridge` (`:stable` tag) | Remove `:stable` — in-app self-update and NAS compose file reference it |
| pg_cron job: nightly SG crawl | `nightly-sg-crawl` | — |
| pg_cron job: nightly asset count reconcile | `nightly-reconcile-sg-asset-counts` | — |
| pg_cron job: render queue purge | `purge-render-queue-old-rows` | — |
| pg_cron job: sg render queue purge | `purge-sg-render-queue-old-rows` | — |
| pg_cron job: path history purge | `purge-asset-path-history-old-rows` | — |
| Key DB tables | `assets`, `style_groups`, `erp_items_current`, `style_guide_files`, `admin_config`, `product_category_predictions` | — |

---

## 8. Services / Containers

| Service | Runtime | Managed by | Deploy trigger |
|---------|---------|-----------|----------------|
| `popdam-frontend` | nginx:1.27-alpine, port 80 | Coolify on VPS | `publish-frontend.yml` → GHCR → Coolify API |
| `coolify-proxy` | Traefik | Coolify | Coolify admin UI |
| Railway worker | Node.js 20 | Railway | Push to `main` (any file change) — Railway auto-detects |
| Bridge agent | Node.js Docker, Synology | docker-compose on NAS | In-app update or manual `docker compose pull` |
| Windows render agent | Node.js, Windows VM | Manual | GitHub Release download |
| Supabase edge functions | Deno | Supabase | `deploy-supabase.yml` (triggers on `supabase/functions/**`) |
| PostgreSQL | Supabase-managed | Supabase | `deploy-supabase.yml` (triggers on `supabase/migrations/**`) |

**Railway deploy note:** Railway watches `main` and rebuilds on every push. Changes to `apps/worker/` do not trigger `deploy-supabase.yml` or `publish-frontend.yml` — only Railway picks them up.

**Coolify ownership:** Coolify owns runtime environment variables, domain bindings, health checks, restart policy, and container lifecycle for `popdam-frontend`. Changes to runtime configuration (env vars, feature flags) go through Coolify directly — not via GitHub or SSH. Source code, Dockerfiles, and workflow changes must go through GitHub as normal.

**CI path triggers:** `publish-frontend.yml` triggers only on application file changes (`src/**`, `Dockerfile`, etc.) — documentation-only changes to `docs/**` and top-level `.md` files do not trigger a frontend build. `deploy-supabase.yml` triggers only on `supabase/migrations/**` and `supabase/functions/**` changes.

---

## 9. What to Ignore

```
dist/
node_modules/
apps/*/node_modules/
apps/*/dist/
apps/popdam-helper/out/
.cache/
coverage/
supabase-popsg/         # dead code, never deploy from here
.lovable/               # Lovable platform memory
worksp_symlink.md       # harness bookkeeping
server                  # untracked symlink into the Coolify deploy dir — not part of the build
```

> Note: `app/` and `duplicate-folders.txt` were one-off local artifacts and have been removed from the tree. `apps/popdam-helper/out/` (Electron build output) and an untracked `apps/popdam-helper/package-lock.json` may reappear locally — both are non-source.

---

## 10. Intentional Quirks

### Dual-mode (PopDAM / PopSG) via hostname detection

**Looks like:** Two separate Supabase projects, two separate deployments.
**Actually:** One Docker image, one Coolify app, one Supabase project (`ryltkzzernhwnojzouyb`). `src/lib/app-mode.ts` reads `window.location.host` and returns `"popdam"` or `"popsg"`. `IS_POPSG` guards routes, UI panels, and page components throughout `App.tsx` and the components tree.
**Do not change because:** Splitting the mode into two builds or two containers would double the deployment surface for no functional gain.
**Local testing:** Add `?mode=popsg` to any localhost URL — stored in `sessionStorage` for the tab.

### `asset_count` on `style_groups` is a cached field, not computed on read

**Looks like:** `style_groups.asset_count` should always be up to date — just query `COUNT(*) FROM assets WHERE style_group_id = ...`.
**Actually:** `asset_count` is a denormalized cache. It is maintained by:
1. A statement-level trigger `trg_refresh_sg_counts_on_asset_change` (migration `20260515080654`) — fires on INSERT/DELETE of `assets` and on UPDATE when `is_deleted` or `style_group_id` changes.
2. A pg_cron job `nightly-reconcile-sg-asset-counts` (migration `20260531142011`) running at 03:45 UTC daily — calls `refresh_style_group_counts_batch(array_agg(id))` over all groups to catch any drift the trigger missed.
3. The `reconcile-style-group-stats` Railway worker op — on-demand full reconcile.
**Why cached:** Computing `COUNT(*)` with a join on every library page load at the style_groups level is prohibitively slow at scale.
**Drift can occur when:** A bulk asset delete bypasses the trigger (e.g., direct SQL via service role without triggering the transition table logic), or the trigger fires but the DB rolls back after the count update. Before the nightly cron was added (2026-05-31), pre-existing drift from before 2026-05-15 was never cleaned up — 17 style groups had stale counts including 2 with `asset_count=1` but zero actual assets.
**Do not compute live:** Use `reconcile-style-group-stats` op or the nightly cron to fix drift.

### `supabase-popsg/` directory is dead code

**Looks like:** A separate Supabase project for PopSG with its own functions and workflow.
**Actually:** PopSG was originally on a separate project (`eeueczxhezfhyrhdmidg`). It was consolidated into the PopDAM project. The directory was never cleaned up.
**Do not deploy from it:** The `deploy-popsg-supabase.yml` workflow targets the old abandoned project.

### `.ai` file sentinel pattern

**Looks like:** The bridge agent is ignoring many `.ai` files for no obvious reason.
**Actually:** Adobe Illustrator can save `.ai` files without "Create PDF Compatible File" enabled. These files contain only a boilerplate compatibility-alert warning page — no actual artwork. The bridge agent detects them via `isAiWithoutPdfCompat()` in `apps/bridge-agent/src/thumbnailer.ts` (reads file header, then uses mupdf to check page text for the sentinel phrase "saved without PDF Content"). Detected files are permanently added to `scanner_ai_ignores` so they are never re-processed.
**Do not remove the check:** Without it, these files generate "compatibility alert" thumbnails that look like real artwork in the library.

### ERP `product_category` cutoff date (2025-05-10)

**Looks like:** Some ERP items have no `product_category` even though they have valid MG codes.
**Actually:** Before 2025-05-10, the MG01 field from the ERP API used single-letter codes with unstable meanings. After that date the letters reliably map to categories. The worker (`apps/worker/src/handlers/erp.ts`) only uses `mg_category` to set `product_category` when `erp_updated_at >= 2025-05-10`. Items before that date fall through to the AI prediction path. About 5,500 style groups with pre-cutoff ERP data have null `product_category` and need AI classification.
**Do not remove the guard:** Items before the cutoff would get wrong categories applied automatically.

### Bridge agent defers thumbnails to Windows Render Agent for certain files

**Looks like:** Some `.ai` files get `thumbnail_error = "deferred_to_windows_agent"` even though the bridge agent could attempt to render them.
**Actually:** When `windows_render_mode = "primary"` or the `windows_render_policy` mode is set to `"shared"` with the file type in `shared_types`, the bridge agent intentionally skips local thumbnailing and queues a `render_queue` job for the Windows agent instead. The policy is set in `admin_config` and delivered via heartbeat response.
**Do not treat as failures:** These are intentional deferrals, not errors. The Windows agent renders them via Illustrator (higher quality than the PDF-compat path).

### `app/` symlink at repo root

**Looks like:** An older version of the frontend code.
**Actually:** Dead symlink to an old build snapshot. Has no effect on the build or runtime.
**Do not use:** Ignore entirely.

### `bulk-job-runner` edge function is a deployed no-op

**Looks like:** A real function that runs batch jobs.
**Actually:** Returns `{ ok: true, message: "replaced by railway worker" }`. All batch work runs in the Railway worker. The pg_cron schedule that used to call this was removed in migration `20260322000000`.
**Do not add logic here:** It would conflict with the Railway worker.

### `verify_jwt = false` on `admin-api` in `supabase/config.toml`

**Looks like:** Security hole — admin API doesn't verify JWTs at the gateway level.
**Actually:** CORS preflight (`OPTIONS`) carries no auth header; gateway-level JWT check rejects it. Verification happens inside the function. See `docs/KNOWN_QUIRKS.md` #4.

### Style group rebuild `finalize_stats` calls `reconcile_style_group_stats_batch` in a loop

**Looks like:** Should just call `run_full_reconcile_style_group_stats` once.
**Actually:** `run_full_reconcile_style_group_stats` has no `SET statement_timeout`, so after a full rebuild the DB-level role timeout kills it. The batched approach (100 groups/batch for counts, 25 for primaries) each has `SET statement_timeout = '120s'` and completes without hitting the limit.
**Do not revert:** "Start Fresh" rebuild reliably times out on "Compute counts" when there are many groups.

### `trg_sync_primary_on_thumbnail` fires on INSERT **and** UPDATE

**Looks like:** Overkill — why would an INSERT need to sync a cover?
**Actually:** The bridge agent sets `thumbnail_url` at insert time (single DB write). If the trigger only fired on UPDATE (which it did before migration `20260529132758`), those assets never triggered the sync, leaving `primary_asset_id = null`. A backfill in that migration fixed 482 affected groups.
**Do not revert to UPDATE-only:** It would silently break cover assignment for any asset inserted with a thumbnail already set.

### Railway worker deploys on every push to `main`

**Looks like:** Wasteful — most pushes don't touch `apps/worker/`.
**Actually:** Railway doesn't support path filters. Every push triggers a Railway rebuild regardless of which files changed. This is a Railway platform constraint, not a bug.

### Two separate `OPENROUTER_API_KEY` locations

**Looks like:** Duplication or confusion.
**Actually:** `admin_config.OPENROUTER_API_KEY` feeds bridge/windows agents via heartbeat response. Railway env `OPENROUTER_API_KEY` feeds the Railway worker directly. Setting one does not set the other.

### `src/integrations/supabase/client.ts` is a one-line re-export

**Looks like:** Should create a Supabase client.
**Actually:** Re-exports from `external-supabase.ts` so that Lovable overwrites don't break production. See `docs/KNOWN_QUIRKS.md` #2.

### Supabase credentials hardcoded in `src/lib/app-mode.ts`

**Looks like:** Security anti-pattern.
**Actually:** The anon key is a publishable key (like a Firebase web API key); the service role key is never hardcoded. Lovable overwrites `.env` on every deploy, so env vars can't be trusted. See `docs/KNOWN_QUIRKS.md` #1.
**Do not move to env vars:** All queries would silently route to the empty Lovable-provisioned project.

### Helper storage provider is per-machine/region, not a global flag

**Looks like:** `admin_config.HELPER_SEAFILE_PREFERRED` should globally switch all designers to Seafile.
**Actually:** Transport is chosen **per machine by region** — Brazil (WFH) → Seafile/SeaDrive, USA → Synology `edgesynology1` over SMB. The Helper's local `config.preferredProvider` is the real lever (set at install); `HELPER_SEAFILE_LIBRARIES` + `HELPER_SYNOLOGY_FALLBACK_ALLOWED` flow from `admin_config` via `helper-api /config`. Brazil keeps a Synology fallback over Tailscale SMB. A library is matched by **longest path-prefix** on `relative_path` (a PopDAM root can hold multiple Seafile libraries as subfolders).
**Do not change because:** A single global flag breaks the region split; see `docs/SEAFILE_INTEGRATION.md`.

### SeaDrive installer is self-hosted and auto-mirrored by the worker

**Looks like:** The Downloads page should just link seafile.com for the SeaDrive client.
**Actually:** The Railway worker's `seadrive-mirror` handler runs weekly from `tick()`, scrapes the official SeaDrive download page, and mirrors the latest `.pkg`/`.msi` into the `popdam` Spaces bucket, recording `admin_config.SEADRIVE_LATEST` ({version, mac_url, win_url, mirrored, checked_at}). The Downloads page reads that and serves the pinned hosted version (fallback: official URLs). Spaces creds come from `admin_config.DO_SPACES_*` — the worker has no Spaces env var.
**Do not change because:** Removing the mirror reverts to an uncontrolled third-party download; the LRU cache/pinning is SeaDrive-native (not our code).

---

## 11. Environment and Credentials

| Variable | Purpose | Stored where | Required in dev | Required in prod |
|----------|---------|-------------|----------------|-----------------|
| `SUPABASE_URL` | Worker → Supabase | Railway env vars | No (hardcoded in app) | Yes (Railway) |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker → Supabase service role | Railway env vars | No | Yes (Railway) |
| `OPENROUTER_API_KEY` | Worker AI calls | Railway env vars | No | Yes (Railway) |
| `SUPABASE_ACCESS_TOKEN` | CI → Supabase CLI | GitHub secret | No | Yes |
| `EXTERNAL_SUPABASE_PROJECT_ID` | CI → Supabase CLI | GitHub secret | No | Yes |
| `EXTERNAL_SUPABASE_DB_PASSWORD` | CI → Supabase CLI | GitHub secret | No | Yes |
| `GHCR_PAT` | CI → GHCR push | GitHub secret | No | Yes |
| `COOLIFY_TOKEN` | CI → Coolify deploy API | GitHub secret | No | Yes |
| `COOLIFY_APP_UUID` | CI → Coolify deploy API | GitHub secret | No | Yes |
| `COOLIFY_URL` | CI → Coolify deploy API | GitHub secret | No | Yes |
| `GH_TOKEN` | CI → GitHub Releases (Helper) | GitHub secret | No | Yes |
| `SUPABASE_URL` (CI) | Bridge agent CI notification | GitHub secret | No | Yes |
| `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` | Bridge agent CI → admin_config update | GitHub secret | No | Yes |
| Bridge agent env vars | NAS agent config | `.env` in NAS docker dir | Yes (bridge dev) | Yes |

Dev note: the frontend connects directly to the production Supabase project. No `.env.local` required for `npm run dev`.

---

## 12. Deployment

### Frontend (React app)

**Workflow:** `.github/workflows/publish-frontend.yml`
**Triggers:** push to `main` touching `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `nginx.conf`
**Steps:** `verify` job (`npm ci` + `npm run lint`) → `build-and-push` (`needs: verify`): npm ci → vite build → `docker build -f Dockerfile.ci` → push to GHCR (`:latest` + `:<sha>`) → POST Coolify API → Coolify pulls `:latest` and replaces container. The deploy is gated on `verify` via a native `needs` dependency (a lint failure blocks publish + deploy). `ci.yml` (bun lint/test/build) is the broad repo CI and runs in parallel; it is **not** the deploy gate.
**Rollback:** In Coolify UI, select an older deployment and redeploy. The `:<sha>` tag is the immutable rollback target.

### Supabase (DB migrations + edge functions)

**Workflow:** `.github/workflows/deploy-supabase.yml`
**Triggers:** push to `main` touching `supabase/migrations/**` or `supabase/functions/**`
**Steps:** `supabase db push` (if migrations changed) → deploy all edge functions (if functions changed) → auto-generate and commit `src/integrations/supabase/types.ts`
**CRITICAL:** migration filename timestamp must match the timestamp Supabase records. See `CLAUDE.md` for the full discipline.

### Railway Worker

**Auto-deploys:** Railway watches the `main` branch. Every push to `main` triggers a Railway rebuild regardless of which files changed.
**No manual step required.**

### Bridge Agent

**Workflow:** `.github/workflows/publish-bridge-agent.yml`
**Triggers:** push to `main` touching `apps/bridge-agent/**`
**Tags:** `:stable` (what NAS compose and self-update pull), `:v{version}`, `:latest`
**Versioning:** Bump `apps/bridge-agent/package.json` version in same commit.

### Windows Render Agent

**Workflow:** `.github/workflows/publish-windows-agent.yml`
**Distribution:** GitHub Release (`windows-agent-latest` tag)

### POP DAM Helper (Electron)

**Workflow:** `.github/workflows/publish-popdam-helper.yml` (parallel Windows + macOS jobs)
**Distribution:** GitHub Release (`popdam-helper-latest` tag)
**Code signing:** wired but unset. The macOS job reads `CSC_LINK`/`CSC_KEY_PASSWORD` (Developer ID `.p12`) + `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (notarization via `scripts/notarize.cjs`); with secrets unset it ships an **unsigned** dmg (Gatekeeper right-click→Open) and skips notarization. Windows is unsigned (SmartScreen warns). See `HANDOFF.md`.
**Seafile/SeaDrive:** the Helper supervises (does not embed) the SeaDrive virtual-drive client for WFH designers; see `docs/SEAFILE_INTEGRATION.md`.

---

## 13. Incidents and Pending Work

### Pending Work

| Status | Item | Next action |
|--------|------|-------------|
| 🟡 open | **Seafile/SeaDrive Helper — Brazil pilot** | First slice shipped (Helper v1.4.1: provider selection, hydration, prefix-based library mapping; `admin_config` seeded with `HELPER_SEAFILE_*`, `SEADRIVE_LATEST`). Next: install Helper + SeaDrive on one Brazil Mac and validate checkout/check-in. See `HANDOFF.md`, `docs/SEAFILE_INTEGRATION.md`. |
| 🟡 open | **Helper code signing** | Repo wired (macOS `CSC_LINK`/`CSC_KEY_PASSWORD` + `APPLE_*`; notarize hook). Blocked on adding the Developer ID `.p12` + Apple secrets to GitHub. Windows needs a separate OV/EV cert. See `HANDOFF.md`. |
| 🟡 open | **PopSG render pass** | Windows Agent on **v0.15.0**; render backlog not fully processed (operational — run Retry All + queue EPS). See `HANDOFF.md`. |
| 🟢 external | **Seafile server direct-MS SSO** | Entra app `8d9da03c…` is configured; the `seafile.designflow.app` server (`u2giants/seafile` repo) still needs `seahub_settings.py` OAuth enabled. Not this repo. |
| 🟢 cleanup | **Consolidate duplicate docs** | `docs/architecture.md`↔`docs/ARCHITECTURE.md` and `docs/deployment.md`↔`docs/DEPLOYMENT.md` differ only by case with overlapping content; pick one canonical per topic and remove/merge the other. |

### Resolved 2026-06-07/08: Seafile-aware Helper + SeaDrive self-host + CI gate

- Seafile/SeaDrive Helper first slice (provider selection, hydration, prefix-based library mapping, `helper-api` config/heartbeat/complete-checkin) — Helper v1.4.x; migration `20260607120639` (nullable `asset_checkouts` source columns).
- Worker `seadrive-mirror` (Spaces, weekly) + Downloads page pinned latest — worker v1.3.0.
- Frontend production deploy now gated on `verify` (`publish-frontend.yml`); `ipc.ts` `storeSession` import bug fixed.

### Resolved 2026-05-31: style_groups.asset_count stale counts

17 style groups had stale `asset_count` values including 2 (MF162DYPN01, MFZ93DYNX03) with `asset_count=1` but zero actual assets. Root cause: the asset count reconciliation trigger was only added 2026-05-15 (migration `20260515080654`); pre-existing drift from before that date was never cleaned up. Fixed by:
1. Bulk SQL fix via `execute_sql` MCP to correct all 17 rows.
2. Adding pg_cron job `nightly-reconcile-sg-asset-counts` (migration `20260531142011`) running at 03:45 UTC daily — calls `refresh_style_group_counts_batch(array_agg(id))` over all style groups.

### Resolved 2026-05-26: Style group rebuild timeout on "Compute counts" stage

After a full "Start Fresh" rebuild, the `finalize_stats` stage called `run_full_reconcile_style_group_stats` — a function with no `SET statement_timeout` that does a single unbounded UPDATE+JOIN across all style groups. The DB-level role timeout killed it (~33 minutes in). Fixed by driving `reconcile_style_group_stats_batch` in batches instead. Worker v1.2.12.

### Resolved 2026-05-15: CI/CD migration to Coolify API

Frontend deploy migrated from SSH-based (`docker run` on VPS) to Coolify API trigger. `VPS_SSH_KEY` secret removed. See `SELFHOST.md` and `docs/KNOWN_QUIRKS.md` #41–42.

---

## Deep-Dive References

| Doc | Topic |
|-----|-------|
| `CLAUDE.md` | Claude Code-specific workflow instructions |
| `SELFHOST.md` | VPS / Coolify / Traefik architecture and ops runbook |
| `docs/ARCHITECTURE.md` | Full system design, networking model |
| `docs/INFRASTRUCTURE.md` | Supabase project, Railway, Spaces, edge function inventory |
| `docs/STYLE_GROUPS.md` | Style group rebuild, reconcile, primary selection, tag propagation |
| `docs/BULK_JOBS.md` | All bulk operations, lane system, conflict map |
| `docs/SCHEMA.md` | Database schema reference |
| `docs/ERP_ENRICHMENT_PLAN.md` | ERP sync, MG codes, AI category classification |
| `docs/AUTHENTICATION.md` | Authentik SSO, Google/Microsoft OAuth, email/password |
| `docs/KNOWN_QUIRKS.md` | Intentional oddities — read before changing anything |
| `docs/WORKER_LOGIC.md` | Bridge agent behavior contracts |
| `docs/DEPLOYMENT.md` | Bridge agent + Helper release pipeline |
| `docs/development.md` | Local dev setup, running, testing |
| `docs/configuration.md` | Environment variables, admin config keys |
| `docs/ONBOARDING.md` | First-run checklist |
| `docs/PATH_UTILS.md` | Path canonicalization rules |
| `docs/POPSG.md` | PopSG mode — schema, crawl flow, render pipeline |
| `docs/POPDAM_HELPER.md` | Desktop Helper architecture (checkout/check-in, local server, auth) |
| `docs/SEAFILE_INTEGRATION.md` | Seafile/SeaDrive transport for WFH designers (region model, libraries, SeaDrive client) |
| `docs/ADMIN_OPERATIONS.md` | Admin UI operations reference |
| `docs/API_CONTRACTS.md` | Edge function API contracts |
| `docs/WINDOWS_AGENT_RUNBOOK.md` | Windows render agent operations |
