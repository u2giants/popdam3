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
| Modify app behavior / project-owned code | `AGENTS.md`, the relevant folder/area, `docs/architecture.md` if system design is affected | `docs/deployment.md` unless deploy behavior changes |
| Change configuration, env vars, admin_config keys, or runtime settings | `AGENTS.md`, `docs/configuration.md`, `docs/INFRASTRUCTURE.md`; Coolify for prod runtime env | unrelated architecture docs |
| Change local setup, dev scripts, test/lint, tooling | `AGENTS.md`, `docs/development.md`, the relevant `package.json`/config | `docs/deployment.md` unless CI/CD changes |
| Change deployment, Docker, CI/CD, hosting, rollback | `AGENTS.md` → Deployment, `docs/deployment.md`, `SELFHOST.md`, `.github/workflows/*` | local-only dev docs |
| Change DB schema, migrations, models, external IDs, data flow | `AGENTS.md`, `CLAUDE.md` (migration timestamp discipline — **read before any migration**), `docs/SCHEMA.md`, `docs/STYLE_GROUPS.md` if groups are touched | deployment docs unless rollout changes |
| Work on stage / customer / program (path-derived attributes) or the Stage/Customer/Program filters | `AGENTS.md`, `docs/PATH_ATTRIBUTES.md` (and `docs/PATH_UTILS.md` for canonical path format) | unrelated UI/ERP docs |
| Work on bulk operations / the Railway worker | `AGENTS.md`, `docs/BULK_JOBS.md`, `docs/WORKER_LOGIC.md` | unrelated UI docs |
| Work on ERP sync / MG codes / category classification | `AGENTS.md`, `docs/ERP_ENRICHMENT_PLAN.md` | deployment docs |
| Work on the desktop Helper / checkout-checkin / Seafile / SeaDrive | `AGENTS.md`, `docs/POPDAM_HELPER.md`, `docs/SEAFILE_INTEGRATION.md` | PopSG / ERP docs |
| Work on PopSG (style-guide mode) | `AGENTS.md`, `docs/POPSG.md` | PopDAM-only ERP/style-group docs |
| Work on auth / SSO / login | `AGENTS.md`, `docs/AUTHENTICATION.md` | unrelated docs |
| Investigate bugs / incidents | `AGENTS.md` → Incidents + Intentional Quirks, `docs/KNOWN_QUIRKS.md`, `HANDOFF.md` if present | unrelated folder docs |
| Continue unfinished work | `AGENTS.md`, `HANDOFF.md`, the docs named inside `HANDOFF.md` | docs unrelated to the handoff scope |
| Claude Code session | `CLAUDE.md`, then `AGENTS.md` | other docs unless the task needs them |
| Documentation-only cleanup | `AGENTS.md`, `README.md`, the affected docs under `docs/` | source files except as needed to verify accuracy |

> **Doc-set note:** `docs/` uses one canonical file per topic. The core four are lowercase: `docs/architecture.md`, `docs/deployment.md`, `docs/configuration.md`, `docs/development.md` (the older UPPERCASE `ARCHITECTURE.md`/`DEPLOYMENT.md` duplicates were merged into these and removed on 2026-06-10). `future_improvements.md` (root, untracked, local) holds storage-transport research notes, not operating docs. (`lucid.md` is **not** in this repo — it lives in `u2giants/seafile`.)

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
| Change stage/customer/program derivation | New migration editing `infer_path_attrs()` + a re-backfill (batched); `src/types/assets.ts`, `src/hooks/useAssets.ts`, `src/hooks/useStyleGroups.ts`, `src/components/library/FilterSidebar.tsx` | `workflow_status` derivation in `_shared/metadata-derivation.ts` (separate concern) |
| Fix Seafile check-in receipt verification | `apps/bridge-agent/src/checkin-verifier.ts`, `supabase/functions/agent-api/index.ts` (claim-checkin-verifications / report-checkin-verification), `supabase/functions/helper-api/index.ts` (complete-checkin Seafile branch) | — |
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
| Path-derived columns | `stage`, `customer`, `program` on `assets` **and** `style_groups` (see `docs/PATH_ATTRIBUTES.md`) | Confuse `stage` with `workflow_status` — different source and meaning |
| Path-attr DB functions | `infer_path_attrs(path)`, `get_path_facets(customer)`; triggers `trg_set_path_attrs` | — |
| Path-attr anchor folder | `____New Structure` (four leading underscores) | — |

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

### PDF text backfill runs on the Windows agent, not the bridge agent

**Looks like:** The bridge agent is the natural home for all NAS-side batch work, including the full-library PDF/.ai text extraction backfill.
**Actually:** `agent-api/handleHeartbeat()` routes `trigger_pdf_backfill` to the `windows-render` agent when a healthy Windows agent reports a **backfill-capable version (≥ 0.16.0)** — `windowsBackfillCapable` — and falls back to the `bridge` agent otherwise. This version/capability gate makes the cutover automatic and gap-free: the bridge keeps running the backfill until the Windows agent has self-updated to a build that actually contains the loop. The Windows agent (`apps/windows-agent/src/pdf-backfill.ts`) runs the same mupdf→OCR→AI extraction (reusing the `pdf-text-sampler` cascade) and shares the `claim-pdf-backfill-batch` / `complete-pdf-backfill-batch` endpoints, so all extraction CPU runs on the Windows VM instead of the Synology.
**Config-key gotcha:** the command only fires if `PDF_BACKFILL` is in the agent type's heartbeat config-key set (`getConfigKeysForAgent()` in `agent-api`). It must be present in `HEARTBEAT_CONFIG_KEYS_WINDOWS`, or the `windows-render` heartbeat never sees `configMap.PDF_BACKFILL` and the trigger is silently always-false.
**Handover gotcha:** the claim loop self-drives — once started it keeps claiming until `PDF_BACKFILL.status != "running"` or the queue is empty, independent of the heartbeat trigger. To hand the job from bridge → Windows cleanly, set `status=paused`, wait for the bridge to stop on its next claim, then `status=running`; otherwise both agents run concurrently (safe via `ON CONFLICT` dedupe, but wasteful).
**Status/UI gotcha:** the admin Backfill card reads `admin_config.PDF_BACKFILL` through `admin-api/get-pdf-backfill-status`, but the authoritative queue state is `count_pdf_backfill_remaining()`. Completion must be based on **remaining = 0**, not only `processed >= total`, because the initial total can become stale if files are sampled by another path while the job is running. The status route intentionally normalizes a stale `status="running"` row to `completed` when remaining is zero, so the UI shows a terminal result instead of silence or a forever-running state.
**Do not remove the routing/gate:** reverting to bridge-only pushes heavy extraction onto the NAS CPU.

### Sibling file scans need a 10-minute lease/expiry

**Looks like:** `claimed` sibling scan requests should be treated exactly like `pending` requests until the Bridge Agent completes them.
**Actually:** The "Find Sibling Files" UI stores folder-scan jobs as `admin_config` rows named `sibling_scan_request_*`. The Bridge Agent claims a row, scans the NAS folder for sibling JPG/PNG/eligible PDF files, then reports completion through `complete-sibling-scan`. If the agent restarts or throws after claiming, the row can otherwise stay `claimed` forever and the UI will sit at "Waiting for Bridge Agent..." indefinitely.
**Do not remove because:** `supabase/functions/_shared/admin-handlers/sibling-scan-handlers.ts` intentionally expires stale `claimed` rows after 10 minutes, and `supabase/functions/agent-api/index.ts` intentionally lets the Bridge Agent reclaim stale claims. `apps/bridge-agent/src/index.ts` also reports a failed scan when a per-request worker throws. Keep these together so a dead agent/request becomes a retryable failure instead of blocking future scans for the same folder.

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

### Seafile check-ins park in `verifying` status before completing

**Looks like:** Check-in should immediately mark the checkout `complete` once the helper's upload returns, the same as a Synology direct upload.
**Actually:** For Seafile-sourced check-ins (`source_provider = 'seafile'`), the file travels designer → Seafile server → Synology NAS (extra hop). The helper's upload returning proves only that the file arrived on Seafile, not that it landed intact on the Synology. `helper-api/complete-checkin` parks these checkouts in `status: 'verifying'` (lock still held) instead of `complete`. The bridge agent (running on the Synology) claims pending verifications via `claim-checkin-verifications`, stat-checks the on-disk file for size match, then computes a quick-hash (SHA-256 of first 64 KB + last 64 KB + size — a ~128 KB read). On match it calls `report-checkin-verification` and the checkout advances to `complete`. Synology direct uploads bypass this entirely and complete immediately as before.
**Feature flag:** gated by `admin_config.CHECKIN_VERIFICATION_ENABLED` (read in `complete-checkin`). **Activated 2026-06-09.** When off/absent, Seafile check-ins complete immediately like before — set it to `false` for instant rollback, no redeploy. It was shipped *dark* first because helper-api and the bridge agent deploy via different pipelines; activating before the verifying-capable agent (≥ v1.16.0) is live would hang check-ins with nothing to confirm them.
**Why:** Releasing the lock before the file has synced defeats the checkout/check-in guarantee — a second designer could check out and overwrite a partially-synced file.
**Do not remove because:** `verifying` is included in the `asset_checkouts_one_active_per_asset` partial unique index (same as `active`), so the lock is held throughout. Removing the step silently re-introduces a race condition for WFH Brazil check-ins.
**Timing / deadlines:** T1 = 30 min (`verify_deadline_at`) — flag surfaced to designer + admin, re-drive triggered. T2 = 2 hours (`verify_resolve_at`) — auto-resolve releases the lock into `error` with diagnostics. Both deadlines freeze when the bridge agent is offline (detected by a gap > 3 heartbeats in `verify_last_attempt_at`); see `handleReportCheckinVerification` in `supabase/functions/agent-api/index.ts`.
**Code:** `supabase/functions/helper-api/index.ts` (complete-checkin Seafile branch), `supabase/functions/agent-api/index.ts` (claim-checkin-verifications / report-checkin-verification), `apps/bridge-agent/src/checkin-verifier.ts`, migration `20260609120000_asset_checkouts_receipt_verification.sql`.

---

### Agent reported `version` can lie — the admin panel trusts `build_sha`, not the version string

**Looks like:** The Settings → Bridge Agents "Up to date ✅" badge means the agent is running the latest published code.
**Actually:** The agent reports three identity fields. `version` is read from `package.json` at **runtime** (a mutable, human-edited string); `image_tag` and `build_sha` are baked into the image at **build time** (immutable). A botched self-update can leave a stale container running an old image whose `version` still reads the new number, so a version-string comparison falsely shows "up to date." The panel now compares the agent's `build_sha` against `BRIDGE_LATEST_BUILD.sha` (returned by admin-api `get-latest-agent-build`). "Up to date" is sha-based; a version-matches-but-build-differs state renders a red **"Build mismatch"** warning with the recovery command.
**Why:** On 2026-06-09 the panel showed v1.16.0 "up to date" while the NAS container was still v1.9.6 — a failed update never swapped the container (see Incidents). The version string hid it; `build_sha` exposed it.
**Do not change because:** The self-updater is fragile (see `docs/KNOWN_QUIRKS.md` #26 — ~50 iterations to stabilize). Detection via `build_sha` is the safe, no-touch way to catch update failures; reverting the badge to a version-string compare re-introduces the silent-stale-image failure. Code: `src/pages/SettingsPage.tsx` (`AgentStatusSection`), `supabase/functions/admin-api/index.ts` (`handleGetLatestAgentBuild`).

---

### `stage` is not `workflow_status` (path-derived attributes)

**Looks like:** `assets.stage` and `assets.workflow_status` are redundant — both come from the folder path, so pick one.
**Actually:** They answer different questions. `stage` is **positional** — the folder directly under `____New Structure` (one of the 5 lifecycle buckets: In Development, Concept Approved Designs, Product Ideas, Freelancer art, Discontinued), set by a DB trigger. `workflow_status` is a **deepest-first scan** against `admin_config.WORKFLOW_FOLDER_MAP`, set by edge-function ingest code, and its values include adoption/approval states (`customer_adopted`, `licensor_approved`). For the same file, `stage="In Development"` while `workflow_status="customer_adopted"`. `customer`/`program` ride alongside `stage`, derived only in the In Development → Customer Adopted branch.
**Why:** `workflow_status` predates `____New Structure` and is ambiguous there (it conflates lifecycle with approval and deliberately drops the Concept-Approved signal). `stage` gives a clean lifecycle bucket for the new tree.
**Do not change because:** Filters, search (`Ross Wall 2026` → its files/groups), and `get_filter_counts`/`get_path_facets` all depend on these columns; the triggers keep them in sync on folder moves. Full rules: `docs/PATH_ATTRIBUTES.md`.

## 11. Environment and Credentials

| Variable | Purpose | Stored where | Required in dev | Required in prod |
|----------|---------|-------------|----------------|-----------------|
| `SUPABASE_URL` | Worker → Supabase | Railway env vars | No (hardcoded in app) | Yes (Railway) |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker → Supabase service role | Railway env vars | No | Yes (Railway) |
| `OPENROUTER_API_KEY` | Worker AI calls | Railway env vars | No | Yes (Railway) |
| `SUPABASE_ACCESS_TOKEN` | CI → Supabase CLI | GitHub secret | No | Yes |
| `EXTERNAL_SUPABASE_PROJECT_ID` | CI → Supabase CLI | GitHub secret | No | Yes |
| `EXTERNAL_SUPABASE_DB_PASSWORD` | CI → Supabase CLI | GitHub secret | No | Yes |
| `GHCR_PAT` | GHCR push fallback (frontend) + bridge agent CI | GitHub secret | No | Yes |
| `GHCR_USERNAME` | Optional username for `GHCR_PAT` owner | GitHub secret | No | No |
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
**Triggers:** push to `main` touching `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `nginx.conf`, `.github/workflows/publish-frontend.yml`; also `workflow_dispatch` for manual redeploys.
**Steps:** `verify` job (`npm ci` + `npm run lint`) → `build-and-push` (`needs: verify`): npm ci → vite build → GHCR login with `GHCR_PAT` if present, otherwise the workflow `GITHUB_TOKEN` (`packages: write`) → `docker build -f Dockerfile.ci` → push to GHCR (`:latest` + `:<sha>`) → POST Coolify API → Coolify pulls `:latest` and replaces container. The deploy is gated on `verify` via a native `needs` dependency (a lint failure blocks publish + deploy). `ci.yml` (bun lint/test/build) is the broad repo CI and runs in parallel; it is **not** the deploy gate.
**GHCR package access:** the existing `ghcr.io/u2giants/popdam-frontend` package must grant `u2giants/popdam3` **Write** under package Settings → Manage Actions access, or `GHCR_PAT` must be a classic PAT with `write:packages` owned by a package admin. If neither is true, the workflow can log in but `docker push` fails with `permission_denied: write_package`.
**Stale-site check:** if the live header shows an old commit, check the latest `Publish Frontend Image` run first. If it failed before "Push image to GHCR" or "Deploy via Coolify", Coolify will keep running the previous successful image (for example, `8c0508d` stayed live because later runs failed before a newer GHCR `:latest` image was published).
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
| 🟡 open | **Seafile/SeaDrive Helper — Brazil pilot** | First slice (v1.4.1) + receipt verification (bridge agent v1.16.x) shipped and **active** (`CHECKIN_VERIFICATION_ENABLED = true`, 2026-06-09); build-drift detection in the admin panel shipped. Next: install Helper + SeaDrive on one Brazil Mac and validate checkout/check-in round-trip — watch the first real check-in go `verifying → complete`. See `HANDOFF.md`, `docs/SEAFILE_INTEGRATION.md`. |
| 🟡 open | **Helper code signing** | Repo wired (macOS `CSC_LINK`/`CSC_KEY_PASSWORD` + `APPLE_*`; notarize hook). Blocked on adding the Developer ID `.p12` + Apple secrets to GitHub. Windows needs a separate OV/EV cert. See `HANDOFF.md`. |
| 🟡 open | **PopSG render pass** | Windows Agent on **v0.16.0**; render backlog not fully processed (operational — run Retry All + queue EPS). See `HANDOFF.md`. |
| 🟢 external | **Seafile server direct-MS SSO** | Entra app `8d9da03c…` is configured; the `seafile.designflow.app` server (`u2giants/seafile` repo) still needs `seahub_settings.py` OAuth enabled. Not this repo. |

### Resolved 2026-06-10: Bridge agent crash loop (PDF_BACKFILL + missing `ok: true`)

What happened: `claim-pdf-backfill-batch` in `agent-api` returned JSON without `ok: true` in both return paths. `callApi()` in the bridge agent treats any response missing `ok: true` as an error and throws. The `runPdfBackfill()` call in `sendHeartbeat()` had `.finally()` but no `.catch()`, so the thrown error became an unhandled promise rejection — Node.js ≥15 terminates on these. With `PDF_BACKFILL` stuck in `"running"` state, every heartbeat triggered the backfill → threw → crashed the process → restarted → crashed again.

Impact: Bridge agent on `edgesynology2` crash-looped for several hours. Alternative Images (sibling folder scan) timed out for all users; all bridge agent work was offline.

Root cause: Missing `ok: true` in `handleClaimPdfBackfillBatch()` return values + missing `.catch()` on the fire-and-forget `runPdfBackfill()` call.

Recovery: Added `ok: true` to both return paths; added `.catch()` on `runPdfBackfill()`. Deployed as part of bridge agent v1.16.0. Follow-up (v1.16.1): added `unhandledRejection`/`uncaughtException` handlers in `apps/bridge-agent/src/index.ts` as a last-resort safety net; wrapped inner claim/complete loops in `apps/bridge-agent/src/pdf-backfill.ts` with try/catch so a mid-loop fault logs and breaks out instead of propagating. Same-day follow-up also: (1) **offloaded** the full-library backfill to the Windows agent (v0.16.0) behind a version/capability gate (see the "PDF text backfill runs on the Windows agent" quirk); (2) fixed the progress `total` to count `.pdf`+`.ai` via `count_pdf_backfill_remaining()` (was a `.pdf`-only undercount that would have falsely marked the run "completed" early) and made `complete-pdf-backfill-batch` accumulate per-method `stats` + `files_used_added`; (3) surfaced `claim-pdf-backfill-batch` RPC errors as 5xx instead of an opaque empty body; (4) added a completion summary + **stall/offline warning** to the admin Backfill card; (5) added `PDF_BACKFILL` to the `windows-render` heartbeat config keys (without it the Windows trigger was silently always-false); (6) follow-up commit `6325a37` made the UI show queued/processed/remaining, timestamps, Windows agent heartbeat, zero-work completion, method/error stats, and files-used rows added. That commit also made `admin-api/get-pdf-backfill-status` and `agent-api/complete-pdf-backfill-batch` use remaining-count normalization so a drained run cannot report no result.

Rule added to prevent recurrence: Every `json({...})` return in agent-api routes called by the bridge agent must include `ok: true`. The bridge agent's `callApi()` throws on any response where `data.ok` is falsy. All fire-and-forget async calls in `sendHeartbeat()` must have both `.catch()` and `.finally()`.

---

### Resolved 2026-06-09: Bridge agent ran a stale image while the panel showed "up to date"

What happened: After publishing bridge agent v1.16.0, the admin panel showed the agent "up to date" at v1.16.0, but it was still running the old v1.9.6 image. The agent reported a contradictory identity — `version: 1.16.0` (from `package.json`) but `image_tag: v1.9.6` / `build_sha: e0cc499` (the old image's baked env). A manual `docker compose pull && down && up` had pulled the new image but **`down` couldn't remove the running container** ("Running 0/0" — it had drifted out of compose's tracking), so the new container hit a name conflict and never started; the old container kept running.

Impact: The new receipt-verification code wasn't actually running, even though the UI said it was. Nearly activated `CHECKIN_VERIFICATION_ENABLED` against a dead code path (which would have hung Seafile check-ins). Caught because `build_sha` didn't match the published commit.

Root cause: (1) The admin panel computed "up to date" from the **version string**, which can match while the running image differs. (2) The agent's `docker run` self-update fallback creates a container outside the compose project (by design — the agent has no host compose file), so later `docker compose` commands can't manage it.

Recovery: `sudo docker rm -f popdam-bridge && sudo docker compose up -d --remove-orphans` on `edgesynology2` — force-removes the orphan by name, then recreates from the pulled image. Afterward all three identity fields agreed on the new commit.

Rule added to prevent recurrence: The admin Bridge Agents panel now detects drift by comparing `build_sha` to `BRIDGE_LATEST_BUILD.sha` (a red "Build mismatch" badge with the recovery command) — never trust the version string alone. The fragile self-updater was deliberately **not** modified (see `docs/KNOWN_QUIRKS.md` #26); detection, not surgery, is the chosen guard. Confirm an agent's true build via `agent_registrations.metadata->'version_info'` — `version`, `image_tag`, and `build_sha` must all match the intended commit.

---

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
| `docs/architecture.md` | Full system design, components, data flow, API boundaries, networking model |
| `docs/INFRASTRUCTURE.md` | Supabase project, Railway, Spaces, edge function inventory |
| `docs/STYLE_GROUPS.md` | Style group rebuild, reconcile, primary selection, tag propagation |
| `docs/BULK_JOBS.md` | All bulk operations, lane system, conflict map |
| `docs/SCHEMA.md` | Database schema reference |
| `docs/ERP_ENRICHMENT_PLAN.md` | ERP sync, MG codes, AI category classification |
| `docs/AUTHENTICATION.md` | Microsoft/Azure SSO, Google OAuth, email/password, legacy Authentik |
| `docs/KNOWN_QUIRKS.md` | Intentional oddities — read before changing anything |
| `docs/WORKER_LOGIC.md` | Bridge agent behavior contracts |
| `docs/deployment.md` | Full deploy pipeline (frontend, Supabase, Railway, agents, Helper), pg_cron jobs, rollback, SSH policy |
| `docs/development.md` | Local dev setup, running, testing |
| `docs/configuration.md` | Environment variables, admin config keys |
| `docs/ONBOARDING.md` | First-run checklist |
| `docs/PATH_UTILS.md` | Path canonicalization rules (relative_path format, UNC/display conversion) |
| `docs/PATH_ATTRIBUTES.md` | Path-derived `stage`/`customer`/`program` columns, triggers, facets, and Stage-vs-workflow_status |
| `docs/POPSG.md` | PopSG mode — schema, crawl flow, render pipeline |
| `docs/POPDAM_HELPER.md` | Desktop Helper architecture (checkout/check-in, local server, auth) |
| `docs/SEAFILE_INTEGRATION.md` | Seafile/SeaDrive transport for WFH designers (region model, libraries, SeaDrive client) |
| `docs/ADMIN_OPERATIONS.md` | Admin UI operations reference |
| `docs/API_CONTRACTS.md` | Edge function API contracts |
| `docs/WINDOWS_AGENT_RUNBOOK.md` | Windows render agent operations |
