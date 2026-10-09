# AGENTS.md — PopDAM Developer & AI Session Guide

Read this first. Under 5 minutes. Everything else in `docs/` is a deep-dive reference.

---

## Session wrap-up convention

When the user says **"wrap up"**, that means: update the relevant Markdown docs with durable knowledge from the session, run required checks, commit/push/merge/deploy according to repo rules, verify 1Password coverage for any secrets encountered, and leave every repo handoff-safe. For shared Supabase/backend changes, update canonical `/worksp/shared-db` docs and complete the shared-db branch → PR → merge workflow. Do not treat "wrap up" as a summary-only request.

---

## Project summary

**PopDAM** is an internal Digital Asset Manager for licensed consumer-product art (Disney, Marvel, etc.). Source design files (PSD, AI) live on a Synology NAS. The system ingests them, generates thumbnails, uploads them to DigitalOcean Spaces, and gives the team a dark-mode web UI for browsing, searching, filtering, tagging, and managing artwork submissions.

**PopSG** is a second mode served by the same codebase — a style-guide library for licensors (folder-based browsing, no SKUs or ERP). Same Docker image; hostname determines mode at runtime.

**What matters:** assets get processed quickly, thumbnails appear, ERP codes resolve correctly, and style group assignments stay accurate. The team reviews and approves artwork against licensing deadlines.

**Key moving parts:**

| Component | Location | Platform |
|-----------|----------|----------|
| React web app | `src/` | Coolify (Docker, self-hosted VPS) |
| Supabase edge functions | `supabase/functions/` | Supabase (Deno) |
| PostgreSQL DB | canonical `/worksp/shared-db/supabase/migrations/` | Supabase (hosted) |
| Cloud worker (AI tagging, ERP, rebuild) | `apps/worker/` | Railway (Node.js) |
| Bridge agent (NAS scanner + thumbnailer) | `apps/bridge-agent/` | Synology Docker |
| Windows render agent (no Illustrator) | `apps/windows-agent/` | Windows PC/VM (manual install) |
| Desktop helper (checkout/checkin) | `apps/popdam-helper/` | Electron, Mac + Windows |

---

## AI tool notes

Claude Code uses .claudeignore. Other tools follow **What to ignore** below. Do not bulk-load every .md file.

## Documentation map: what to read for each task

Business logic is companywide and organized by topic, not by application. Start at
[companywide application and task map](https://github.com/u2giants/shared-db/blob/main/docs/business-rules/application-map.md)
and load only the topics the task touches. This repo documents DAM implementation; it must
not maintain a competing copy of a business rule.

Always start with:

- `AGENTS.md` (this file)
- `HANDOFF.md` **if it exists** — unfinished/in-progress work; required reading before continuing anything.

Active plans (read STATUS first; do not re-derive completed steps):

- plan_master_data_designflow_reference_cutover.md — converge shared Master Data vs DesignFlow Item Details
- plan_openrouter_batch_restart_recovery.md — Image Tagging batches survive Railway restarts
- plan_ai_model_interaction_reliability.md — capability-driven model contract (replaces name guessing)
- plan_hybrid_search_rollout.md — keyword + pgvector discovery
- plan_style_group_scoped_ai_metadata.md — product vs file-level AI metadata
- plan_popsg_production_readiness.md — PopSG library truthfulness and search
- plan_master_data_orderlist_loading_performance.md — first-paint and OrderList Find performance
- plan_orderlist_sheets_full_integration.md — native Sheets integration; read STATUS and its own HANDOFF.d link first

Then load additional docs only when relevant — do **not** ingest every `.md` file:

| Task / question | Read these docs | Usually do not need |
|---|---|---|
| Quick repo orientation | `README.md`, `AGENTS.md` | Deep docs under `docs/` unless the task needs them |
| Modify app behavior / project-owned code | `AGENTS.md`, the relevant folder/area, `docs/architecture.md` if system design is affected | `docs/deployment.md` unless deploy behavior changes |
| Change configuration, env vars, admin_config keys, or runtime settings | `AGENTS.md`, `docs/configuration.md`, `docs/INFRASTRUCTURE.md`; Coolify for prod runtime env | unrelated architecture docs |
| Change local setup, dev scripts, test/lint, tooling | `AGENTS.md`, `docs/development.md`, the relevant `package.json`/config | `docs/deployment.md` unless CI/CD changes |
| Change deployment, Docker, CI/CD, hosting, rollback | `AGENTS.md` → Deployment, `docs/deployment.md`, `SELFHOST.md`, `.github/workflows/*` | local-only dev docs |
| Change DB schema, migrations, models, external IDs, data flow | `AGENTS.md` → Shared DB Gatekeeper, canonical `/worksp/shared-db/AGENTS.md`, `docs/SCHEMA.md`, `docs/STYLE_GROUPS.md` if groups are touched | deployment docs unless rollout changes |
| Work on stage / customer / program (path-derived attributes) or the Stage/Customer/Program filters | `AGENTS.md`, `docs/PATH_ATTRIBUTES.md` (and `docs/PATH_UTILS.md` for canonical path format) | unrelated UI/ERP docs |
| Work on bulk operations / the Railway worker | `AGENTS.md`, `docs/BULK_JOBS.md`, `docs/WORKER_LOGIC.md` | unrelated UI docs |
| Work on ERP sync / MG codes / category classification / production PO sync | `AGENTS.md`, `docs/ERP_ENRICHMENT_PLAN.md` | deployment docs |
| Work on OrderList / `/orders` / production orders from the legacy OrderList sheet | `AGENTS.md`, `docs/ORDER_LIST.md`; shared backend contract lives in `shared-db/plan_popdam_order_list.md` | Master Data docs unless the task touches the style tracker |
| Work on Master Data / style tracker / Google Sheet replica | `AGENTS.md`, `docs/MASTER_DATA.md`; shared backend changes also need `shared-db/docs/app-migration-notes/master-data-style-tracker-20260624.md` | PopSG/ERP docs unless the task touches them |
| Work on the desktop Helper / checkout-checkin / Seafile / SeaDrive | `AGENTS.md`, `docs/POPDAM_HELPER.md`, `docs/SEAFILE_INTEGRATION.md` | PopSG / ERP docs |
| Work on PopSG (style-guide mode) | `AGENTS.md`, `docs/POPSG.md` | PopDAM-only ERP/style-group docs |
| Work on auth / SSO / login | `AGENTS.md`, `docs/AUTHENTICATION.md` | unrelated docs |
| Touch MCP servers / `.mcp.json` / MCP tokens / 1Password secrets | `AGENTS.md`, `docs/MCP_SERVERS.md`; VPS proxy ops → `deploy/vps/` | unrelated app docs |
| Investigate bugs / incidents | `AGENTS.md` → Incidents + Intentional Quirks, `docs/KNOWN_QUIRKS.md`, `HANDOFF.md` if present | unrelated folder docs |
| Continue unfinished work | `AGENTS.md`, `HANDOFF.md`, the docs named inside `HANDOFF.md` | docs unrelated to the handoff scope |
| Work in a subfolder with its own README | `AGENTS.md`, that folder-level `README.md`, then only broader docs it links to | other folder-level READMEs and unrelated deep docs |
| Claude Code session | `CLAUDE.md`, then `AGENTS.md` | other docs unless the task needs them |
| Documentation-only cleanup | `AGENTS.md`, `README.md`, the affected docs under `docs/` | source files except as needed to verify accuracy |

> **Doc-set note:** `docs/` uses one canonical file per topic. The core four are lowercase: `docs/architecture.md`, `docs/deployment.md`, `docs/configuration.md`, `docs/development.md` (the older UPPERCASE `ARCHITECTURE.md`/`DEPLOYMENT.md` duplicates were merged into these and removed on 2026-06-10). `future_improvements.md` (root, untracked, local) holds storage-transport research notes, not operating docs. (`lucid.md` is **not** in this repo — it lives in `u2giants/seafile`.) Finished or stale root `fix_*`/`plan_*`/`use_*` notes live in `docs/archive/` (history only, not operating guidance); the live plans stay at the root and are linked from this file.

**Shared infrastructure standards:** `u2giants/albert-standards` is the cross-project operating knowledgebase. When a PopDAM change alters non-code infrastructure or operating decisions that apply beyond this repo — VPS/Coolify/Traefik/GHCR/DNS/Railway behavior, Synology NAS operating assumptions, bridge-agent host facts, or incident runbooks — update the relevant standards docs too:
- `https://github.com/u2giants/albert-standards/tree/main/infrastructure` for VPS/Coolify/Traefik/GHCR/Railway/DNS/server operations.
- `https://github.com/u2giants/albert-standards/tree/main/synology` for NAS hardware, networking, health, and PopDAM bridge-agent host assumptions.

**Host/server change boundary:** this repo is app-layer. Durable host/OS changes belong in the canonical Ansible repo at `/worksp/ansible` / `https://github.com/u2giants/ansible`, then GitHub Actions applies them. Host changes include packages, users, firewall, SSH/sudo, Docker engine or daemon config, systemd units/timers, cron, `/etc`, `/usr/local/bin` or `/usr/local/sbin`, Cloudflare Tunnel 1, Coolify host glue, and backup/DNS watchdogs. Do not SSH, sudo, or edit the host directly for durable infra changes; make an Ansible PR instead. App code/config owned by PopDAM still changes here and deploys through the normal PopDAM/Coolify pipeline. Break-glass direct host repair must be explicitly called out, then followed by an Ansible PR to capture or reconcile the drift.

---

## Shared DB Gatekeeper

Repository-local task routing is declared in `.ai-devops/task-gates.json` and
verified by `scripts/test-task-gates.sh`. Protected browser, agent, worker,
deployment, and shared-database paths require their full treatment;
acknowledgement never bypasses a database-route refusal.

This repo shares Supabase backend project `qsllyeztdwjgirsysgai` with the other
POP apps. All database/schema changes for that shared backend must be authored
in the canonical repo [`u2giants/shared-db`](https://github.com/u2giants/shared-db) (**moved to `popcre/shared-db` by 2026-09-18**; the old URL redirects, but `gh search` against the old name fails — use `popcre/shared-db`)
using a branch + PR + timestamped migration, preview-first, with the AI owning
the merge before any dependent app code is written.

Never make shared database changes from this app repo. That means no app-side
DDL, no inline/startup migrations, no Dashboard SQL, no one-off `execute_sql`,
and no new migration files under this repo's local `supabase/migrations/`
folder. The only allowed copy of shared DB migrations in this repo is the
vendored read-only `shared-db/` mirror that syncs from the canonical repo.

The `.github/workflows/shared-db-guard.yml` workflow runs on `push` and
`pull_request` and fails changes that add database DDL or migrations outside the
vendored `shared-db/` folder. The only override is an explicitly approved
exception: add PR label `db-change-approved`, or include `[db-change-approved]`
in the commit message for direct pushes.

## Shared-backend startup/shutdown hygiene

All POP apps share one Supabase backend. Keep shared-db work isolated:

- Before editing, git status --short here and in canonical /worksp/shared-db if the task touches schema, RLS, RPCs, types, or cross-app contracts.
- shared-db/ in this repo is a read-only mirror. No new migrations here — they belong in /worksp/shared-db on a named branch + PR.
- Stop if /worksp/shared-db has untracked migrations or unrelated dirty files from another session.
- Shutdown: no untracked migration left; unfinished shared-db work gets a durable handoff naming branch, migration, preview/prod status, and the next exact action.
- Never paper over a credential failure with ad hoc SQL/API calls or embedded tokens. Fix the canonical credential path first; runbook: /worksp/shared-db/AGENTS.md → Supabase CLI and database credential runbook.

## Multi-model AI usage in code

Model locations, structured-output contract, Exacto routing, endpoint pinning, bake-off rules, and Google/DeepSeek keys are documented in [docs/MODEL_RULES.md](docs/MODEL_RULES.md). Quirks that look like bugs are in [docs/KNOWN_QUIRKS.md](docs/KNOWN_QUIRKS.md). Before changing any model reference, read those files — a model is configured in several places (dmin_config.AI_TASK_MODELS, worker handlers, bridge/windows samplers).

## Repository structure

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
│   └── migrations/             ← Historical/inert only; new migrations go in `/worksp/shared-db`
├── apps/
│   ├── worker/                 ← Railway cloud worker (Node.js, TypeScript)
│   │   └── src/handlers/       ← Per-operation batch handlers
│   ├── bridge-agent/           ← Synology NAS agent (Docker, TypeScript)
│   ├── windows-agent/          ← Windows render agent: Inkscape/ImageMagick/Ghostscript/Poppler/Tesseract (TypeScript)
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
- `apps/*/dist/`, `apps/popdam-helper/out/` — app build/package output
- `node_modules/`, `apps/*/node_modules/`
- `.lovable/` — Lovable platform memory (ignore)

**Project-owned source:** `src/`, `supabase/functions/`, `apps/*/src/`, `packages/path-filters/src/`.
**Docs and runbooks:** root `*.md`, `docs/`, `SELFHOST.md`, `HANDOFF.md`.
**Scripts and deployment metadata:** `scripts/`, `deploy/`, `.github/workflows/`, Dockerfiles, `nginx.conf`.

---

## Prime Directive: Custom-Code Boundary

Project-owned code lives in:

```
src/
supabase/functions/
apps/worker/src/
apps/bridge-agent/src/
apps/windows-agent/src/
apps/popdam-helper/src/
packages/path-filters/src/
```

**Before touching anything outside these paths, ask why.** The main risk areas:
- `src/integrations/supabase/client.ts` — re-exports from `external-supabase.ts`; Lovable overwrites this periodically (quirk #2)
- `src/integrations/supabase/types.ts` — auto-generated; edit will be overwritten on next deploy

---

## Core modification inventory

Files outside project-owned areas that were intentionally modified:

| File | Change made | Why necessary | Upgrade risk |
|------|------------|---------------|--------------|
| `nginx.conf` | Added `listen [::]:80;` | Coolify health check resolves `localhost` → `::1` on IPv6; nginx only listening on IPv4 caused health check failures and Traefik routing to stop | Low — standard nginx directive |

---

## Task-to-file navigation

| Task | Files to touch | Files NOT to touch |
|------|---------------|-------------------|
| Add/fix admin UI bulk operation | `src/components/settings/diagnostics/`, `apps/worker/src/handlers/`, `apps/worker/src/operation-loop.ts`, `supabase/functions/_shared/operation-constants.ts` | `supabase/functions/bulk-job-runner/` (no-op stub) |
| Add/fix edge function route | `supabase/functions/admin-api/index.ts` or `agent-api/index.ts`, `supabase/functions/_shared/admin-handlers/` | `src/integrations/supabase/types.ts` (auto-generated) |
| DB schema change | Canonical `/worksp/shared-db/supabase/migrations/` via shared-db branch + PR | This repo's `supabase/migrations/`; any existing migration file |
| Fix style group rebuild | `apps/worker/src/handlers/style-groups.ts`, DB functions in canonical `/worksp/shared-db/supabase/migrations/` | `supabase/functions/bulk-job-runner/`; this repo's `supabase/migrations/` |
| Fix style group asset_count drift | Canonical `/worksp/shared-db/supabase/migrations/`, `supabase/functions/_shared/` if function code changes | This repo's `supabase/migrations/` |
| Fix ERP sync | `apps/worker/src/handlers/erp.ts`, `supabase/functions/_shared/mg-codes.ts`, `supabase/functions/_shared/mg-lookup.ts` | — |
| Fix SKU-derived MG01–MG03 names | `supabase/functions/_shared/sku-parser.ts`, `_shared/mg-lookup.ts` (current, hierarchical), `_shared/mg-legacy.ts` (pre-2025-05-14 flat lists) | `src/lib/mg-lookup.ts` is only a re-export |
| Fix production PO sync | `supabase/functions/_shared/admin-handlers/prod-order-handlers.ts`, canonical `/worksp/shared-db/supabase/migrations/` for DB changes, `src/components/settings/ErpEnrichmentTab.tsx`, `src/components/library/StyleGroupDetailPanel.tsx` | This repo's `supabase/migrations/`; do not rely on copied browser JWTs as durable auth |
| Fix bridge agent scan / ingest / move detection | `apps/bridge-agent/src/index.ts`, `apps/bridge-agent/src/scanner.ts`, `apps/bridge-agent/src/api-client.ts`, `supabase/functions/agent-api/index.ts`, `docs/WORKER_LOGIC.md`, `docs/API_CONTRACTS.md` | Do not treat `quick_hash` as unique; do not edit generated Supabase types |
| Fix thumbnail generation | `apps/bridge-agent/src/thumbnailer.ts` | — |
| Add PopSG page | `src/pages/popsg/`, `src/App.tsx` (route guard) | `src/components/library/` (PopDAM-only) |
| Change Traefik routing | `/data/coolify/proxy/dynamic/` on VPS, or Coolify app config | `nginx.conf` (unless fixing health check) |
| Change AI classification prompt | `apps/worker/src/handlers/erp.ts` (~line 336) | — |
| Change stage/customer/program derivation | New canonical shared-db migration editing `infer_path_attrs()` + a re-backfill (batched); `src/types/assets.ts`, `src/hooks/useAssets.ts`, `src/hooks/useStyleGroups.ts`, `src/components/library/FilterSidebar.tsx` | This repo's `supabase/migrations/`; `workflow_status` derivation in `_shared/metadata-derivation.ts` (separate concern) |
| Fix Seafile check-in receipt verification | `apps/bridge-agent/src/checkin-verifier.ts`, `supabase/functions/agent-api/index.ts` (claim-checkin-verifications / report-checkin-verification), `supabase/functions/helper-api/index.ts` (complete-checkin Seafile branch) | — |
| Add new pg_cron job | New canonical shared-db migration file using `cron.schedule()` | This repo's `supabase/migrations/`; direct Supabase Dashboard edits |

---

## Data model and external identifiers

| Entity / system | Identifier | Where defined | Notes |
|-----------|-------|-----------|-------|
| Supabase project ID (prod) | `qsllyeztdwjgirsysgai` | GitHub secret `EXTERNAL_SUPABASE_PROJECT_ID`, docs/config | Virginia (us-east-1), name "popdam". ⚠️ **MCP trap:** the old Ohio project `ryltkzzernhwnojzouyb` ("popdam-prod.old") is decommissioned but still ACTIVE, and the default `mcp__supabase__*` tools / `get_project_url` **resolve to it** — returning data frozen at the 2026-06-20 cutover. For live data use `mcp__claude_ai_Supabase__*` with `project_id: qsllyeztdwjgirsysgai`. Don't confuse with SynoMon `qnjimovrsaacneqkggsn`. |
| Coolify app UUID | `qxj8a0j3tpa9lq4q5rs6pezy` | Coolify, GitHub secret `COOLIFY_APP_UUID` | Embedded in Traefik service name and CI secrets |
| Coolify Traefik service name | `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker` | `/data/coolify/proxy/dynamic/popdam-sg.yml` | Referenced by the PopSG file-provider route |
| Production domains | `dam.designflow.app`, `sg.designflow.app` | Coolify + Traefik | Same frontend container; hostname chooses mode |
| DigitalOcean Spaces bucket | `popdam` (CDN: `cdn.designflow.app`) | `admin_config.DO_SPACES_*` | Renaming requires migrating stored URLs |
| Railway worker service | `apps/worker/` project in Railway | Railway dashboard | Auto-deploys from every push to `main` |
| GHCR frontend image | `ghcr.io/u2giants/popdam-frontend` | `.github/workflows/publish-frontend.yml` | Published by the frontend workflow as `:latest`, `:sha-<short-sha>`, and `:<short-sha>`; user-scoped package uses `GHCR_PAT` when package Actions access blocks `GITHUB_TOKEN` |
| GHCR bridge agent image | `ghcr.io/u2giants/popdam-bridge` (`:stable`) | `.github/workflows/publish-bridge-agent.yml` | `:stable` is used by NAS compose + self-update |
| pg_cron job | `nightly-sg-crawl` | migration files | PopSG crawl |
| pg_cron job | `nightly-reconcile-sg-asset-counts` | migration files | Repairs cached style-group counts |
| pg_cron job | `purge-render-queue-old-rows` / `purge-sg-render-queue-old-rows` | migration files | Queue retention |
| pg_cron job | `purge-asset-path-history-old-rows` | migration files | Path-history retention |
| Key DB tables/views | `assets`, `style_groups`, `api.plm_item_list`, `style_guide_files`, `admin_config`, `product_category_predictions` | `docs/SCHEMA.md`, migrations | Core PopDAM/PopSG data model |
| Asset content hint | `assets.quick_hash`, `assets.quick_hash_version` | Bridge Agent / Helper hashing code; `docs/PROJECT_BIBLE.md` §9 | Sampled hash only; never a content-unique key |
| Path-history table | `asset_path_history` | `agent-api` move-detection branch; migration `20260619131239` adds `(asset_id, detected_at DESC)` index | Records accepted moves; high-churn rows were pruned after v1.16.2 verification |
| Path-derived columns | `stage`, `customer`, `program` on `assets` and `style_groups` | `docs/PATH_ATTRIBUTES.md` | Not the same as `workflow_status` |
| Path-attr DB functions | `infer_path_attrs(path)`, `get_path_facets(customer)`; trigger `trg_set_path_attrs` | migrations | Path facet derivation |
| Path-attr anchor folder | `____New Structure` | NAS path convention | Four leading underscores |

---

## Container and service inventory

| Container/service | Purpose | Managed by | App/project ID | Image/source |
|---|---|---|---|---|
| `popdam-frontend` | React/Vite static web app for PopDAM + PopSG | Coolify on VPS | Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`; domains `dam.designflow.app`, `sg.designflow.app` | `ghcr.io/u2giants/popdam-frontend:latest` from `.github/workflows/publish-frontend.yml` + `Dockerfile.ci` |
| `coolify-proxy` | Traefik reverse proxy for Coolify apps | Coolify on VPS | Traefik service `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker` routes to frontend | `traefik:v3.6` managed by Coolify |
| Railway worker | Persistent batch processor for AI tagging, ERP, style groups, SeaDrive mirror | Railway | Railway service for `apps/worker/` (exact Railway project ID unknown; verify in Railway dashboard) | `apps/worker/Dockerfile`; Railway rebuilds on every push to `main` |
| `popdam-bridge` | Synology NAS scanner, thumbnailer, upload/check-in verifier | Synology Container Manager / docker compose | Host `edgesynology1` (edgesynology2 copy retired 2026-09-23, #141); compose reference `deploy/synology/docker-compose.yml` | `ghcr.io/u2giants/popdam-bridge:stable` from `.github/workflows/publish-bridge-agent.yml` |
| Windows render agent | Windows render (Inkscape, ImageMagick, Ghostscript, Poppler, Tesseract — no Illustrator) and PDF text backfill agent | Manual Windows VM install | Release channel `windows-agent-latest` | `apps/windows-agent/`, packaged by `.github/workflows/publish-windows-agent.yml` |
| POP DAM Helper | Designer desktop checkout/check-in helper | End-user desktop install | Release channel `popdam-helper-latest` | `apps/popdam-helper/`, packaged by `.github/workflows/publish-popdam-helper.yml` |
| Supabase edge functions | Admin, agent, helper, auth, export, sync APIs | Supabase | Project `qsllyeztdwjgirsysgai` | `supabase/functions/**`, deployed by `.github/workflows/deploy-supabase.yml` |
| PostgreSQL | PopDAM/PopSG database, auth metadata, pg_cron jobs | Supabase | Project `qsllyeztdwjgirsysgai` | Canonical `u2giants/shared-db/supabase/migrations/**`, applied through shared-db preview-first workflow |

**NAS topology (read this before pointing anything at a NAS):** PopDAM/PopSG use
**two** Synology units — `edgesynology1` (192.168.3.100) and `edgesynology2`
(192.168.3.101), both joined to AD `IML.isaacmorris.com`. Sync is **one-way**:
edge2 pulls from edge1, nothing flows back. **Read on edge2** (crawl/scan/scrape —
offloads edge1) and **write on edge1** (moves/checkouts — a write to edge2 is
stranded and lost). The file-scraping agents run against edge2 by design; the
Linux write-worker targets edge1. Canonical spec:
[`u2giants/synology-monitor` → `docs/NAS_TOPOLOGY.md`](https://github.com/u2giants/synology-monitor/blob/main/docs/NAS_TOPOLOGY.md).

**Railway deploy note:** Railway watches `main` and rebuilds on every push. Changes to `apps/worker/` do not trigger `deploy-supabase.yml` or `publish-frontend.yml` — only Railway picks them up.
**GitHub deployment badge gotcha:** the green `popdam / production` deployment shown in GitHub's repository sidebar is emitted by Railway (`railway-app[bot]`). It means the Railway worker deployed that commit; it does **not** prove the frontend at `dam.designflow.app` / `sg.designflow.app` updated. For frontend freshness, check the `Publish Frontend Image` workflow and the live build SHA/header.

**Coolify ownership:** Coolify owns runtime environment variables, domain bindings, health checks, restart policy, and container lifecycle for `popdam-frontend`. Changes to runtime configuration (env vars, feature flags) go through Coolify directly — not via GitHub or SSH. Source code, Dockerfiles, and workflow changes must go through GitHub as normal.

**VPS session check:** Some AI sessions run directly on the production VPS (`hetz`, public IP `178.156.180.212`). Before attempting `ssh root@178.156.180.212`, run `hostname -f` and `ip route get 1.1.1.1`; if already on the VPS, inspect local Docker/Coolify state directly. For urgent frontend break-glass deploys, use the Coolify compose file under `/data/coolify/applications/qxj8a0j3tpa9lq4q5rs6pezy/` and document the manual action afterward (see `docs/deployment.md`).

**CI path triggers:** `publish-frontend.yml` triggers only on application file changes (`src/**`, `Dockerfile`, `Dockerfile.ci`, etc.) — documentation-only changes to `docs/**` and top-level `.md` files do not trigger a frontend build. `deploy-supabase.yml` triggers only on `supabase/functions/**` changes for app-owned deploys; new database migrations belong in canonical `/worksp/shared-db`, not this repo.

---

## What to ignore

```
dist/
build/
out/
node_modules/
apps/*/node_modules/
apps/*/dist/
apps/*/out/
packages/path-filters/dist/
apps/popdam-helper/out/
.cache/
coverage/
.nyc_output/
*.tsbuildinfo
package-lock.json
bun.lock
bun.lockb
apps/*/package-lock.json
.lovable/               # Lovable platform memory
worksp_symlink.md       # harness bookkeeping
server                  # untracked symlink into the Coolify deploy dir — not part of the build
src/integrations/supabase/types.ts
apps/popdam-helper/.webpack/
```

> Note: `app/` and `duplicate-folders.txt` were one-off local artifacts and have been removed from the tree. `apps/popdam-helper/out/` (Electron build output) and an untracked `apps/popdam-helper/package-lock.json` may reappear locally — both are non-source.

---

## Intentional quirks

- **MG01–MG03 letters mean different things by era (2026-10-06).** Items created before 2025-05-14 use the old flat per-division lists (MG01 = material, MG02 = product type, MG03 = finish; source: ColdLion exports in Albert's Dropbox `ai/old_merch`, now `_shared/mg-legacy.ts`). Newer items use the hierarchical list where MG02 depends on MG01 and MG03 on both. `parseSku` picks the era from ColdLion's item `createdTime`, falling back to the file date. Never resolve MG02/MG03 with a flat code table.

Full entries live in [`docs/idiosyncrasies.md`](docs/idiosyncrasies.md) — read the matching entry before changing any of this behaviour. Add new entries there, not here. Index:

- Dual-mode (PopDAM / PopSG) via hostname detection
- `asset_count` on `style_groups` is a cached field, not computed on read
- Style-group SKU extraction must skip category folders but accept digit-leading SKUs
- `.ai` "no PDF compatibility" ≠ empty — these files STILL contain real artwork (corrected 2026-07-03)
- Style Group IDs change every night (`rebuild-style-groups`) — pin cohorts by SKU (2026-09-23)
- Muse Spark 1.3 Contributor reports its capacity limit as 404 `model_not_found` — cap and retry, never switch models (2026-09-23)
- Compat-thumbnail audit = the real fix for `.ai` thumbnails (perceptual-hash, not OCR)
- Windows agent self-update was silently frozen (WINDOWS_LATEST_BUILD, fixed 2026-07-03)
- ERP `product_category` cutoff date (2025-05-10)
- PLM production PO sync has two auth layers, and browser JWTs are not durable
- Bridge agent defers thumbnails to Windows Render Agent for certain files
- PDF text backfill runs on the Windows agent, not the bridge agent
- Style Guide Sources (`sku_files_used`) only come from licensing/tech-pack PDFs; resolution is fuzzy + continuous
- Master Data style tracker is temporary; companywide business rules own source authority
- Sibling file scans need a 10-minute lease/expiry
- `app/` symlink at repo root
- `bulk-job-runner` edge function is a deployed no-op
- PopSG file tagging (`tag-popsg-files`) runs in the Railway worker, not an edge function
- `verify_jwt = false` on `admin-api` in `supabase/config.toml`
- Style group rebuild `finalize_stats` calls `reconcile_style_group_stats_batch` in a loop
- `trg_sync_primary_on_thumbnail` fires on INSERT **and** UPDATE
- Railway worker deploys on every push to `main`
- `admin_config.OPENROUTER_API_KEY` is the single source of the OpenRouter key
- A brand-new OpenRouter batch 404s on the first status poll
- `.mcp.json` carries no secrets — MCP tokens come from 1Password (do NOT re-hardcode)
- `supabase` MCP server needs its own explicit `env` block, unlike the `http`-type servers
- `src/integrations/supabase/client.ts` is a one-line re-export
- Supabase credentials hardcoded in `src/lib/app-mode.ts`
- Helper storage provider is per-machine/region, not a global flag
- SeaDrive installer is self-hosted and auto-mirrored by the worker
- Seafile check-ins park in `verifying` status before completing
- Agent reported `version` can lie — the admin panel trusts `build_sha`, not the version string
- `stage` is not `workflow_status` (path-derived attributes)
- `quick_hash` is NOT content-unique — move detection is guarded (fixed forward 2026-06-20)
- Library list/facet queries must beat the 8s `authenticated` timeout (2026-06-19)
- The `dam` schema is NOT exposed to PostgREST — reach `dam.*` via `public` RPCs (2026-07-15)
- Rich-PDF extraction uses DeepSeek's **direct** API, not OpenRouter (2026-07-15)
- Compact chrome duplicates its media query in TS **and** CSS on purpose (2026-07-29)

## Credentials and environment

| Variable | Purpose | Stored where | Required in dev | Required in prod |
|----------|---------|-------------|----------------|-----------------|
| `SUPABASE_URL` | Supabase project URL for worker, edge functions, agents, CI notifications | Railway env, Supabase function env, GitHub secrets, agent `.env` | No for frontend (`src/lib/app-mode.ts` is hardcoded); yes for worker/agent dev | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker → Supabase service role | Railway env vars | No | Yes (Railway) |
| `OPENROUTER_API_KEY` | Worker AI calls | `admin_config.OPENROUTER_API_KEY` (primary); Railway env var is a fallback only | No | No — set it in Settings → APIs |
| `ANTHROPIC_API_KEY` | Worker ERP classification fallback/alternative; listed in `apps/worker/.env.example` | Railway env vars | No | Optional |
| `GOOGLE_AI_API_KEY` | Direct Gemini Image Tagging batches and agent PDF text extraction | `admin_config` (primary); Railway env fallback; agent passthrough | No | Optional unless either direct-Google path is selected |
| `WORKER_POLL_INTERVAL_MS` / `AI_BATCH_CONCURRENCY` / `AI_BATCH_SIZE` | Worker tuning knobs | Railway env vars | No | Optional |
| `SUPABASE_ACCESS_TOKEN` | CI → Supabase CLI for edge-function deploys/types | GitHub secret | No | Yes |
| `EXTERNAL_SUPABASE_PROJECT_ID` | CI → Supabase CLI target project | GitHub secret | No | Yes |
| `GHCR_PAT` | GHCR push fallback (frontend) + bridge agent CI | GitHub secret | No | Yes |
| `GHCR_USERNAME` | Optional username for `GHCR_PAT` owner | GitHub secret | No | No |
| `COOLIFY_TOKEN` | CI → Coolify deploy API | GitHub secret | No | Yes |
| `COOLIFY_APP_UUID` | CI → Coolify deploy API | GitHub secret | No | Yes |
| `COOLIFY_URL` | CI → Coolify deploy API | GitHub secret | No | Yes |
| `GH_TOKEN` | CI → GitHub Releases (Helper) | GitHub secret | No | Yes |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Helper macOS Developer ID signing cert | GitHub secrets | No | Only for signed Helper DMGs |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | Helper macOS notarization | GitHub secrets | No | Only for notarized Helper DMGs |
| `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` | Bridge agent CI → admin_config update | GitHub secret | No | Yes |
| `DEPLOY_WEBHOOK_KEY` | Windows-agent release workflow → `agent-api/notify-build` | GitHub secret | No | Yes for Windows-agent release notification |
| `BREVO_API_KEY` | Invite-email delivery from edge functions | Supabase function secret / Vault | No | Yes if invite email is enabled |
| `DO_SPACES_KEY` / `DO_SPACES_SECRET` / `DO_SPACES_BUCKET` / `DO_SPACES_REGION` / `DO_SPACES_ENDPOINT` | Thumbnail/asset object storage credentials and endpoint | `admin_config` and agent heartbeat; some handlers read `DO_SPACES_*` config rows | No | Yes for thumbnail upload/delete and SeaDrive mirror |
| `AGENT_KEY` | Bridge agent credential written/persisted after pairing | NAS bridge `.env` or `/data/agent-config.json` | Yes for bridge dev | Yes |
| `BOOTSTRAP_TOKEN` | Windows agent first-run pairing/install token | Windows agent local config/env during install | No | Yes for new Windows agent installs |
| `POPDAM_SERVER_URL` / `POPDAM_PAIRING_CODE` | Bridge agent install/pairing values; server URL falls back to `SUPABASE_URL` | NAS bridge `.env` or install bundle | Yes for bridge dev | Yes for new bridge installs |
| `SUPABASE_ANON_KEY` | Optional agent Realtime watcher and some edge-function anon clients | Agent `.env`, Supabase function env | No | Optional; without it bridge commands wait for heartbeat |
| `NAS_CONTAINER_MOUNT_ROOT` / `SCAN_ROOTS` | Bridge scan root inside the container | NAS bridge `.env`, heartbeat config | Yes for bridge dev | Yes |
| `POPDAM_CONTAINER_NAME` / `POPDAM_COMPOSE_PATH` | Bridge self-update target container and optional host compose path | NAS docker compose / bridge `.env` | No | Yes for reliable self-update |
| `POPDAM_IMAGE_TAG` / `POPDAM_BUILD_SHA` | Build metadata reported by agents | Docker build args/env from image workflows | No | Yes for drift detection |
| `TENANTS` / `POPDAM_DATA_DIR` / `POPDAM_DATA_FILE` | Multi-tenant bridge supervisor and persisted agent config paths | Bridge `.env` / supervisor child env | No | Optional |
| `WINDOWS_AGENT_NAS_HOST` / `WINDOWS_AGENT_NAS_SHARE` / `WINDOWS_AGENT_NAS_USER` / `WINDOWS_AGENT_NAS_PASS` / `WINDOWS_REPAIR_CODE` | Windows render agent NAS mapping and repair flow | `admin_config`, Windows agent local config | No | Optional, Windows-agent only |
| `HELPER_*` keys (`HELPER_DAM_URL`, `HELPER_SEAFILE_LIBRARIES`, etc.) | Helper checkout/check-in provider config | `admin_config`, returned by `helper-api /config` | No | Yes for Helper installs |
| `COLDLION_API_KEY` / `COLDLION_*` | ColdLion / ERP integration credentials and endpoint config | Supabase Vault and `admin_config` | No | Yes if ERP/ColdLion sync is used |

Do not put secret values, PATs, passwords, private keys, or service-role keys in documentation. The frontend's hardcoded Supabase anon key is publishable client config; the service-role key is never bundled.

Dev note: the frontend connects directly to the production Supabase project. No `.env.local` required for `npm run dev`. Deno is installed in this Codex environment at `/root/.deno/bin/deno`; add `/root/.deno/bin` to `PATH` or call that binary directly.

---

## Deployment

Application changes use a dedicated feature branch and pull request targeting protected `main`. Never push application changes directly to `main`; pass the required reviews/checks and merge through the normal protected path. `main` remains the release branch. Verify the GitHub remote before pushing.

Full runbooks: [docs/deployment.md](docs/deployment.md), [docs/POPDAM_HELPER.md](docs/POPDAM_HELPER.md), [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md).

| Component | How it ships | Notes |
|---|---|---|
| Frontend | merge PR to main → publish-frontend.yml → GHCR → Coolify | Gate is erify (lint). Green CI ≠ live site if Coolify cannot pull GHCR. |
| Supabase edge functions | merge PR to main → deploy-supabase.yml | No supabase db push here — shared migrations go through canonical /worksp/shared-db. |
| Railway worker | every push to main auto-deploys | No manual step. |
| Bridge agent | publish-bridge-agent.yml → :stable | Bump pps/bridge-agent/package.json version in the same commit. |
| Windows render agent | publish-windows-agent.yml → GitHub Release | Inkscape/ImageMagick/Ghostscript/Poppler/Tesseract — no Illustrator. |
| POP DAM Helper | publish-popdam-helper.yml → GitHub Release | Installers stay **unsigned forever** (owner decision). Never cache the electron-builder NSIS toolchain. Helper OAuth/SeaDrive rules: docs/POPDAM_HELPER.md + docs/KNOWN_QUIRKS.md. |

Stale-site check: if the live header shows an old commit, inspect the latest Publish Frontend Image run and Coolify deploy logs. Rollback via an older Coolify deployment (:<sha> tags).

## Pending work

Keep `HANDOFF.md` while any row here is open. Delete `HANDOFF.md` only after the pilot, PopSG render/backfill, and style-guide archival readiness items are done or intentionally abandoned. (Helper code signing is **permanently abandoned**, not a pending row — see above and `HANDOFF.md` §5.3.)

| Status | Item | Next action |
|--------|------|-------------|
| 🟡 open | **Seafile/SeaDrive Helper — Brazil pilot** | First slice (v1.4.1) + receipt verification (bridge agent v1.16.x) shipped and **active** (`CHECKIN_VERIFICATION_ENABLED = true`, 2026-06-09); Helper Microsoft OAuth + USA SMB/local check-in shipped in `1cc3fd3`; Supabase Auth callback `http://127.0.0.1:47380/auth/callback` allowed on 2026-06-24. Next: install Helper + SeaDrive on one Brazil Mac and validate checkout/check-in round-trip — watch the first real check-in go `verifying → complete`. See `HANDOFF.md`, `docs/SEAFILE_INTEGRATION.md`. |
| 🟡 open | **PopSG production readiness (#107)** | Tracked in `plan_popsg_production_readiness.md` — read its STATUS table. As of 2026-09-18: previews classified, bridge 1.16.12, v2 search fast; blocked on shared-db #3282 (PDF claim timeout) and on the nightly crawl recovering after #3023. |
| 🟡 open | **Style Guide Sources archival readiness** | Let the licensing-PDF backfill finish, add crawl-regression guard before archiving, then build an explicit archived state for old style guides. See `HANDOFF.md` and `docs/POPSG.md`. |

## Critical incidents

Full entries live in [`docs/incident-log.md`](docs/incident-log.md) — read the matching entry before changing any of this behaviour. Add new entries there, not here. Index:

- Resolved 2026-07-01: Microsoft login returned "500: Database error granting user" on first attempt
- Resolved 2026-06-25: PopDAM Helper (Windows) uninstall failed with "NSIS Error: Error launching installer" — CI cached the NSIS toolchain
- Resolved 2026-06-22: coolify-proxy lost its Docker socket again → nas-mcp 502 (now self-healing)
- Resolved 2026-06-21: Bridge "Build mismatch" false alarm — self-update froze `build_sha` (and a wrong-project investigation detour)
- Resolved 2026-06-18: Frontend CI was green enough to mislead, but production stayed old
- Resolved 2026-06-10: Bridge agent crash loop (PDF_BACKFILL + missing `ok: true`)
- Resolved 2026-06-09: Bridge agent ran a stale image while the panel showed "up to date"
- Resolved 2026-06-07/08: Seafile-aware Helper + SeaDrive self-host + CI gate
- Resolved 2026-05-31: style_groups.asset_count stale counts
- Resolved 2026-05-26: Style group rebuild timeout on "Compute counts" stage
- Resolved 2026-05-15: CI/CD migration to Coolify API

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
| `docs/MASTER_DATA.md` | Temporary Master Data style tracker app, Google Sheet import, matching workflow, PLM canonical API notes |
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
| `docs/WINDOWS_AGENT_RUNBOOK.md` | Windows render agent operations (incl. unattended install via `popdam-agent.ini`) |
<!-- ansible-host-policy: managed rollout from u2giants/ansible -->
## Host / server changes — do NOT make them here

The `hetz` server's host/OS layer is managed by **Ansible** in **[`u2giants/ansible`](https://github.com/u2giants/ansible)**.
To change the server (packages, users, firewall, DNS, Docker *engine* config, system cron,
systemd units, Cloudflare Tunnel 1, the backup watchdog), **open a PR there** and let CI apply
it — **never** SSH into the box and hand-edit it. Manual changes are drift and get reverted by
the next apply. See [`u2giants/ansible/AGENTS.md`](https://github.com/u2giants/ansible/blob/main/AGENTS.md).

This repo is **not** the host layer. Its own changes belong here and deploy through their normal
pipeline (e.g. Coolify). Don't put host-level changes here, and don't manage this service's
container with Ansible. Scope boundary: **Ansible owns the host; Coolify owns the apps.**
