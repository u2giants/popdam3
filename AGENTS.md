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
| Windows render agent (Illustrator) | `apps/windows-agent/` | Windows VM (manual install) |
| Desktop helper (checkout/checkin) | `apps/popdam-helper/` | Electron, Mac + Windows |

---

## Multi-model AI note

There is no universal ignore-file standard across AI coding tools.

`.claudeignore` works for Claude Code.

When using any other AI tool, paste this file as your first message and follow the instructions in the "What to ignore" section.

(`.cursorignore` exists with matching content. There is no `.copilotignore` — GitHub Copilot is not used in this repo.)

---

## Documentation map: what to read for each task

Always start with:

- `AGENTS.md` (this file)
- `HANDOFF.md` **if it exists** — unfinished/in-progress work; required reading before continuing anything.

Active cross-app reference-data plan:

- `plan_master_data_designflow_reference_cutover.md` — compare and then converge Packaging Type, ColdLion MG04 Product Size, Creative Designer assignments, ColdLion-backed Factory/Vendor, and Depth across PopDAM Master Data and DesignFlow Item Details. Read its STATUS table first; do not re-derive or re-plan completed steps.

Active AI model interaction reliability plan:

- `plan_ai_model_interaction_reliability.md` — replace model-name capability guesses, premature structured-output failures, silent ERP skips, and split PDF-agent behavior with one tested capability-driven contract. Read its STATUS table first; do not re-derive or re-plan completed steps.

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

> **Doc-set note:** `docs/` uses one canonical file per topic. The core four are lowercase: `docs/architecture.md`, `docs/deployment.md`, `docs/configuration.md`, `docs/development.md` (the older UPPERCASE `ARCHITECTURE.md`/`DEPLOYMENT.md` duplicates were merged into these and removed on 2026-06-10). `future_improvements.md` (root, untracked, local) holds storage-transport research notes, not operating docs. (`lucid.md` is **not** in this repo — it lives in `u2giants/seafile`.)

**Shared infrastructure standards:** `u2giants/albert-standards` is the cross-project operating knowledgebase. When a PopDAM change alters non-code infrastructure or operating decisions that apply beyond this repo — VPS/Coolify/Traefik/GHCR/DNS/Railway behavior, Synology NAS operating assumptions, bridge-agent host facts, or incident runbooks — update the relevant standards docs too:
- `https://github.com/u2giants/albert-standards/tree/main/infrastructure` for VPS/Coolify/Traefik/GHCR/Railway/DNS/server operations.
- `https://github.com/u2giants/albert-standards/tree/main/synology` for NAS hardware, networking, health, and PopDAM bridge-agent host assumptions.

**Host/server change boundary:** this repo is app-layer. Durable host/OS changes belong in the canonical Ansible repo at `/worksp/ansible` / `https://github.com/u2giants/ansible`, then GitHub Actions applies them. Host changes include packages, users, firewall, SSH/sudo, Docker engine or daemon config, systemd units/timers, cron, `/etc`, `/usr/local/bin` or `/usr/local/sbin`, Cloudflare Tunnel 1, Coolify host glue, and backup/DNS watchdogs. Do not SSH, sudo, or edit the host directly for durable infra changes; make an Ansible PR instead. App code/config owned by PopDAM still changes here and deploys through the normal PopDAM/Coolify pipeline. Break-glass direct host repair must be explicitly called out, then followed by an Ansible PR to capture or reconcile the drift.

---

## Shared DB Gatekeeper

This repo shares Supabase backend project `qsllyeztdwjgirsysgai` with the other
POP apps. All database/schema changes for that shared backend must be authored
in the canonical repo [`u2giants/shared-db`](https://github.com/u2giants/shared-db)
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

Why this exists:
`popdam3`, `poppim-web`, and `popcrm-web` all depend on the same Supabase backend.
An unfinished migration or dirty canonical `u2giants/shared-db` checkout can block
unrelated app commits or, worse, ship a database change without the right preview
checks. Future AI sessions must keep shared-db work isolated and leave the
workspace clean enough for the next vibe-coding session.

Startup checklist:

1. Run `git status --short` in this repo before editing.
2. If the task may touch shared Supabase schema, RLS, API views/RPCs, generated
   database types, or cross-app data contracts, also run `git status --short` in
   `/worksp/shared-db` before editing.
3. Treat `shared-db/` inside this repo as a read-only mirror. Do not create or
   edit migrations there; use canonical `/worksp/shared-db`.
4. Do not create new database migrations in this repo's `supabase/migrations/`.
   That folder is historical only. All shared Supabase schema/data migrations,
   including DAM-only tables/functions/triggers/RPCs, belong in canonical
   `/worksp/shared-db`.
5. If `/worksp/shared-db` has untracked migrations or unrelated dirty files, stop
   and report them before creating new database work. Do not mix another
   session's shared-db changes into this app's commit.
6. Before creating a shared-db migration, create/switch to a dedicated
   `/worksp/shared-db` branch named for the database change. App repos commit to
   `main`; shared-db uses branch + PR.

Shutdown checklist:

1. Run `git status --short` in this repo and, if touched or inspected for backend
   work, in `/worksp/shared-db`.
2. No untracked shared-db migration may remain. Every shared-db migration must be
   committed on its own branch, stashed with a clear name, or removed if
   abandoned.
3. If shared-db work is incomplete, leave durable handoff text that names the
   branch/stash, migration file, preview/prod apply status, and the next exact
   action.
4. Final reports must separate app commits from shared-db status so the owner can
   keep vibe-coding without becoming the git janitor.

Credential/auth failures are not a reason to invent alternate production paths:
if Supabase CLI, database, GitHub, 1Password, or other deployment credentials
fail, fix the canonical credential or tool login path first, verify it with the
normal dry-run/status command, and update the relevant 1Password notes. Do not
paper over the failure with ad hoc SQL/API calls, embedded tokens, copied browser
sessions, or one-off host state. A failed env-var invocation can be a shell/tool
usage bug, not a bad secret; prove the credential independently before rotating
or declaring it broken. For the exact Supabase CLI, preview branch, production
DB password, and pooler commands, use `/worksp/shared-db/AGENTS.md` section
"Supabase CLI and database credential runbook."

---

## Multi-model AI usage in code (where models are configured)

This codebase uses multiple AI models in multiple places. Before changing any model reference, check ALL of:
- `admin_config.AI_TASK_MODELS` (DB table, runtime-configurable)
- `apps/worker/src/handlers/erp.ts` — ERP classification model
- `apps/bridge-agent/src/pdf-text-sampler.ts` — PDF extraction cascade
- `apps/windows-agent/src/pdf-text-sampler.ts` — same cascade on Windows side
- `supabase/functions/ai-tag/` — legacy vision tagging (now Windows agent only)

Changing a model in one place does not change it in others. Each consumer reads from a different config source.

### Image Tagging / Vision Bake-Off contract

All structured AI work uses the capability planner in
`apps/worker/src/model-capabilities.ts` and bounded executor in
`apps/worker/src/structured-output.ts`. Runtime routing comes from OpenRouter's
account catalog plus `admin_config.AI_MODEL_CAPABILITY_OVERRIDES`, never a new
model-name regular expression. Malformed output advances to the next supported
method; authentication, billing, exhausted rate limits, invalid media, and
content-policy failures stop immediately. ERP counts every attempted item as
classified, failed, or unclassifiable.

Production Image Tagging and the Vision Bake-Off intentionally use the same
worker path: `apps/worker/src/handlers/ai-tagging-shared.ts`. The bake-off is a
production-behavior evaluator, not a stricter tool-calling-only test. A model is
eligible when it has image input and can return the `tag_asset` contract via one
of: OpenRouter tool calling, `response_format` JSON schema/structured outputs,
or `response_format: { "type": "json_object" }` with app-side validation.
Required fields are `tags`, `ai_description`, `scene_description`, and `content_type`; malformed
JSON gets one repair retry in JSON mode.

The description fields are search metadata, not free-form captions.
`ai_description` should be a concise, search-friendly sentence for designers and
salespeople; `scene_description` should be a literal visual sentence. The
canonical wording lives in `supabase/functions/_shared/tag-asset-contract.js`.
Keep it compact because it is sent for every tagged asset.

OpenRouter model IDs may route to different provider endpoints, so the same
model can flip pass/fail per call. Three things follow, detailed in
`docs/KNOWN_QUIRKS.md` #59/#60/#62 and `docs/MODEL_RULES.md`:

- **Detecting which endpoint failed is NOT supported by OpenRouter's API.**
  Bake-off rows store best-effort route evidence under
  `ai_tag_bakeoff_results.raw_output._popdam_provider`, but the
  `openrouter_metadata.attempts[]` / `endpoints.available` fields the code
  parses are **undocumented and, per a 2026-07-14 investigation, appear to never
  populate** (0/251 prod rows had the blob; docs list no such fields; couldn't
  confirm live because the account data-policy blocks bare text calls). The API
  only ever names the *serving* endpoint (response `model` + `/api/v1/generation`),
  never the failed legs. Don't build features assuming the failed-leg list
  exists. Do not add shared-db provider columns unless the app needs cross-run
  filtering/reporting outside the bake-off UI.
- **To force / diagnose an endpoint, pin it.** Set
  `admin_config.AI_TASK_MODELS.vision_tagging_provider` to OpenRouter provider
  slug(s); the worker sends `provider: { only: [...], allow_fallbacks: false }`
  so a bad endpoint hard-fails instead of silently rerouting. This is the
  reliable way to know which endpoint failed. Only Image Tagging reads it today.
- **Exacto is the default routing mode.** Every OpenRouter call is sent with the
  `:exacto` model variant (`withExactoRouting` in `openrouter.ts`), routing to
  the endpoint with the best measured tool-calling accuracy. It's free and is the
  primary mitigation for the flip-per-call problem — pin an explicit `:variant`
  in a model slug to opt out. Applies to all OpenRouter paths. See #62.

`GOOGLE_AI_API_KEY` looks dead after the direct-Gemini `ai-tag` edge function was
deleted (2026-07-14), but it is **live**: the on-prem bridge/windows agents use it
for direct-Google PDF text extraction. Do not remove it, the `agent-api`
passthrough, or the ApisTab "Google AI API Key" field. See `docs/KNOWN_QUIRKS.md` #63.

---

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
- `apps/*/dist/`, `apps/popdam-helper/out/` — app build/package output
- `node_modules/`, `apps/*/node_modules/`
- `.lovable/` — Lovable platform memory (ignore)
- `supabase-popsg/` — dead code directory for an abandoned separate Supabase project

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
- `supabase-popsg/` — dead code directory, do not edit or deploy from it

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
| Fix ERP sync | `apps/worker/src/handlers/erp.ts`, `supabase/functions/_shared/mg-codes.ts`, `src/lib/mg-lookup.ts` | — |
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
| Key DB tables | `assets`, `style_groups`, `erp_items_current`, `style_guide_files`, `admin_config`, `product_category_predictions` | `docs/SCHEMA.md`, migrations | Core PopDAM/PopSG data model |
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
| `popdam-bridge` | Synology NAS scanner, thumbnailer, upload/check-in verifier | Synology Container Manager / docker compose | Host `edgesynology2`; compose reference `deploy/synology/docker-compose.yml` | `ghcr.io/u2giants/popdam-bridge:stable` from `.github/workflows/publish-bridge-agent.yml` |
| Windows render agent | Illustrator/Windows render and PDF text backfill agent | Manual Windows VM install | Release channel `windows-agent-latest` | `apps/windows-agent/`, packaged by `.github/workflows/publish-windows-agent.yml` |
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
supabase-popsg/         # dead code, never deploy from here
.lovable/               # Lovable platform memory
worksp_symlink.md       # harness bookkeeping
server                  # untracked symlink into the Coolify deploy dir — not part of the build
src/integrations/supabase/types.ts
apps/popdam-helper/.webpack/
```

> Note: `app/` and `duplicate-folders.txt` were one-off local artifacts and have been removed from the tree. `apps/popdam-helper/out/` (Electron build output) and an untracked `apps/popdam-helper/package-lock.json` may reappear locally — both are non-source.

---

## Intentional quirks

Use this exact shape for every new quirk:

- **Looks like:** the misleading symptom.
- **Actually:** the true behavior.
- **Why:** the reason this behavior exists.
- **Do not change because:** the failure mode if someone "cleans it up."

### Dual-mode (PopDAM / PopSG) via hostname detection

**Looks like:** Two separate Supabase projects, two separate deployments.
**Actually:** One Docker image, one Coolify app, one Supabase project (`qsllyeztdwjgirsysgai`). `src/lib/app-mode.ts` reads `window.location.host` and returns `"popdam"` or `"popsg"`. `IS_POPSG` guards routes, UI panels, and page components throughout `App.tsx` and the components tree.
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
**Do not change because:** Use `reconcile-style-group-stats` op or the nightly cron to fix drift; computing live would reintroduce expensive page loads.

### Style-group SKU extraction must skip category folders but accept digit-leading SKUs

**Looks like:** The SKU folder regex should require a long code that starts with letters, such as `MQK8ASESC01`.
**Actually:** Real DAM SKU folders can start with digits and can be shorter, for example `3FZ93DYEC01`, `27W4AV4`, and `3DWC01JK`. The durable rule is: path segment is purely alphanumeric, length ≥ 7, contains at least one letter and one digit, and is not the filename segment. This skips category folders like `B3M_3FZ - 3D Lenticular framed` while still grouping real `3FZ...` art.
**Why:** On 2026-07-08, live production `rebuild_style_groups_batch` still used the old loose regex (`^[A-Za-z]{1,6}[0-9]` without an end anchor), so searching Style Groups for `3fz` returned one bogus category group with 2,234 assets. A preview-verified shared-db migration `20260708150000_dam_strict_style_group_sku_regex.sql` updates the DB rebuild RPC, and `supabase/functions/_shared/style-grouping.ts` matches it.
**Do not change because:** Tightening back to "starts with letters" or length ≥ 10 drops valid digit-leading/short SKUs; loosening back to prefix matching collapses category folders into giant bogus groups. If grouping looks wrong, compare app extractor and DB RPC first, then rebuild style groups after the migration is live.

### `supabase-popsg/` directory is dead code

**Looks like:** A separate Supabase project for PopSG with its own functions and workflow.
**Actually:** PopSG was originally on a separate project (`eeueczxhezfhyrhdmidg`). It was consolidated into the PopDAM project. The directory was never cleaned up.
**Do not change because:** `deploy-popsg-supabase.yml` is intentionally blocked; deploying from `supabase-popsg/` would target the old abandoned project.

### `.ai` "no PDF compatibility" ≠ empty — these files STILL contain real artwork (corrected 2026-07-03)

**Looks like:** An `.ai` saved without "Create PDF Compatible File" is an empty placeholder containing "only Adobe's boilerplate warning" — junk that is safe to delete/hide. (The ".ai Sentinel Cleanup" feature and an earlier version of this quirk both assumed this. **It is wrong.**)
**Actually:** Such a file still contains **all of its native Illustrator artwork** (the PGF layer). Only the *embedded PDF preview* is a boilerplate stub. Tools that read the PDF layer — mupdf, Sharp, Ghostscript's PDF path, `isAiWithoutPdfCompat()`/`isAiSentinel()` — correctly see "no PDF content", but that is **not** the same as "no artwork". Evidence gathered 2026-07-03: of 140 flagged files, median size **745 KB** (up to 657 MB), each with a **unique `quick_hash`** (no empty-stub cluster), names like `spdrmn pth.ai` / `Pooh diecut block art-REV.ai`, and even 4–8 KB files render real art. A native renderer (**Inkscape/Ghostscript reading the native AI, not the PDF**) recovers the artwork — which is how the Windows agent's Inkscape path produces real thumbnails for these files.
**Do not repeat this mistake:** Do **not** delete or hide `.ai` files based on PDF-layer sentinel detection alone. The ".ai Sentinel Cleanup" card (`ai-sentinel-handlers.ts`) *soft-deletes* (`is_deleted=true`) + clears the thumbnail + adds to `scanner_ai_ignores` — the NAS source file is untouched (recoverable), but ~1,319 real artworks were already hidden from the catalog under the false "empty placeholder" premise. The reliable "has recoverable art" signal is a **non-blank native render**, surfaced by the compat-thumbnail audit (below), not a PDF-text match.
**Detection code:** `apps/bridge-agent/src/ai-sentinel-detect.ts` (`isAiSentinel`/`inspectAiPage`, added 2026-07-03) does marker-text + draw-op probe on page 0. This only inspects the PDF layer, so it does **not** distinguish "empty" from "native art present" — it agrees these are PDF-sentinels. `get_ai_sentinel_stats` (re-homed to `shared-db`, exact-phrase match) counts them; migration `supabase/migrations/20260702120000_*.sql` here is **orphaned** (app repos no longer run `db push`; the `forbid-shared-db-bypass.yml` guard even blocks deleting it — leave it inert).

### Compat-thumbnail audit = the real fix for `.ai` thumbnails (perceptual-hash, not OCR)

**Looks like:** "Audit AI Compat Thumbnails" (Settings → Windows Agent) OCRs thumbnails for the word "compatibility" to find the warning-page thumbnails.
**Actually (fixed 2026-07-03):** the OCR check matched the literal `"compatibility"`, but Adobe's warning says "PDF **Compatible** File" — so it flagged **0**, ran ~1 img/sec (≈12 h full-library), and died on a transient 502. `apps/windows-agent/src/compat-audit.ts` now detects via a **256-bit dHash** against a small reference set of the fixed warning image (threshold 30; validated: boilerplate hashes to distance 0, real art ≥53), with 16-way fetch concurrency + batch-fetch retry. It flags → clears (`thumbnail_url=null`) → re-queues for **native** render (Inkscape). A full 45,841-thumbnail scan takes ~8 min and found **547** boilerplate thumbnails.
**Do not change because:** reverting to OCR silently flags nothing. If you change the warning-page render, recompute the reference dHashes in `COMPAT_REF_HASHES`.

### Windows agent self-update was silently frozen (WINDOWS_LATEST_BUILD, fixed 2026-07-03)

**Looks like:** `publish-windows-agent.yml` "succeeds", so the Windows render agent is on the latest build.
**Actually:** the self-updater compares its version to `admin_config.WINDOWS_LATEST_BUILD`. That pointer was **frozen at `0.16.1.147` from 2026-06-20** because the publish step notified the cloud via the `notify-build` edge function using **`DEPLOY_WEBHOOK_KEY`** — a secret **not carried into the new Virginia project at the 2026-06-20 cutover** — and the step was `continue-on-error: true`, so it 401'd silently. The agent ran a **2-week-old build** the whole time. Fixed by rewriting the step to upsert `WINDOWS_LATEST_BUILD` via **PostgREST + `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY`** (exactly how `publish-bridge-agent.yml` already does it — which is why the bridge never had this problem), dropping `continue-on-error`, and using `curl -sf`.
**Do not repeat this mistake:** the `notify-build`/`DEPLOY_WEBHOOK_KEY` path is still un-set in prod — do not route agent build notifications through it; use the PostgREST/service-role write. To push a Windows-agent build to a stuck agent immediately, upsert `WINDOWS_LATEST_BUILD` in prod `admin_config` with `{version, download_url, installer_url, checksum_sha256 (must match the release zip), commit_sha}`. See `docs/WINDOWS_AGENT_RUNBOOK.md`.

### ERP `product_category` cutoff date (2025-05-10)

**Looks like:** Some ERP items have no `product_category` even though they have valid MG codes.
**Actually:** Before 2025-05-10, the MG01 field from the ERP API used single-letter codes with unstable meanings. After that date the letters reliably map to categories. The worker (`apps/worker/src/handlers/erp.ts`) only uses `mg_category` to set `product_category` when `erp_updated_at >= 2025-05-10`. Items before that date fall through to the AI prediction path. About 5,500 style groups with pre-cutoff ERP data have null `product_category` and need AI classification.
**Do not change because:** Items before the cutoff would get wrong categories applied automatically.

### PLM production PO sync has two auth layers, and browser JWTs are not durable

**Looks like:** `getProdOrderHeader` only needs the Cloud Run `Authorization` identity token and an `X-User-Authorization` value copied from the PLM web app.
**Actually:** Cloud Run auth and PLM app auth are separate. Cloud Run is handled server-side with `PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON` / service-account impersonation. The PLM app token (`X-User-Authorization`, stored as `PROD_ORDER_API_TOKEN_2`) is a short-lived browser JWT; one verified token expired on 2026-06-16 and later requests returned `403 Invalid Token`.
**Data shape gotcha:** the SKU is nested in `details[]` as `Item #` / `matchedItemNumber`; the production PO number is on the header as `Prod Reference #` / `Prod Order No`.
**Do not change because:** A copied browser token will keep expiring and breaking background sync. The durable fix is for the PLM/BFF developer to provide service-to-service auth: either trust the Cloud Run invoker service account, expose a client-credentials/token-refresh flow, or issue a long-lived read-only API token.

### Bridge agent defers thumbnails to Windows Render Agent for certain files

**Looks like:** Some `.ai` files get `thumbnail_error = "deferred_to_windows_agent"` even though the bridge agent could attempt to render them.
**Actually:** When `windows_render_mode = "primary"` or the `windows_render_policy` mode is set to `"shared"` with the file type in `shared_types`, the bridge agent intentionally skips local thumbnailing and queues a `render_queue` job for the Windows agent instead. The policy is set in `admin_config` and delivered via heartbeat response.
**Do not change because:** These are intentional deferrals, not errors. The Windows agent renders them via Illustrator (higher quality than the PDF-compat path).

### PDF text backfill runs on the Windows agent, not the bridge agent

**Looks like:** The bridge agent is the natural home for all NAS-side batch work, including the full-library PDF/.ai text extraction backfill.
**Actually:** `agent-api/handleHeartbeat()` routes `trigger_pdf_backfill` to the `windows-render` agent when a healthy Windows agent reports a **backfill-capable version (≥ 0.16.0)** — `windowsBackfillCapable` — and falls back to the `bridge` agent otherwise. This version/capability gate makes the cutover automatic and gap-free: the bridge keeps running the backfill until the Windows agent has self-updated to a build that actually contains the loop. The Windows agent (`apps/windows-agent/src/pdf-backfill.ts`) runs the same mupdf→OCR→AI extraction (reusing the `pdf-text-sampler` cascade) and shares the `claim-pdf-backfill-batch` / `complete-pdf-backfill-batch` endpoints, so all extraction CPU runs on the Windows VM instead of the Synology.
**Config-key gotcha:** the command only fires if `PDF_BACKFILL` is in the agent type's heartbeat config-key set (`getConfigKeysForAgent()` in `agent-api`). It must be present in `HEARTBEAT_CONFIG_KEYS_WINDOWS`, or the `windows-render` heartbeat never sees `configMap.PDF_BACKFILL` and the trigger is silently always-false.
**Handover gotcha:** the claim loop self-drives — once started it keeps claiming until `PDF_BACKFILL.status != "running"` or the queue is empty, independent of the heartbeat trigger. To hand the job from bridge → Windows cleanly, set `status=paused`, wait for the bridge to stop on its next claim, then `status=running`; otherwise both agents run concurrently (safe via `ON CONFLICT` dedupe, but wasteful).
**Status/UI gotcha:** the admin Backfill card reads `admin_config.PDF_BACKFILL` through `admin-api/get-pdf-backfill-status`, but the authoritative queue state is `count_pdf_backfill_remaining()`. Completion must be based on **remaining = 0**, not only `processed >= total`, because the initial total can become stale if files are sampled by another path while the job is running. The status route intentionally normalizes a stale `status="running"` row to `completed` when remaining is zero, so the UI shows a terminal result instead of silence or a forever-running state.
**Do not change because:** Reverting to bridge-only pushes heavy extraction onto the NAS CPU.

### Style Guide Sources (`sku_files_used`) only come from licensing/tech-pack PDFs; resolution is fuzzy + continuous

**Looks like:** `.ai` files and ordinary PDFs should populate a SKU's "Style Guide Sources," and unresolved entries are garbage to delete.
**Actually:** Only PDFs whose filename contains `licensing sheet`/`license sheet`/`tech pack`/`techpack` write `sku_files_used` (gate `is_style_guide_source_pdf()`, migration `20260610070731`). Resolution against the 214k-row `style_guide_files` is trigram-fuzzy (`resolve_sku_files_used_fuzzy`, nightly cron `resolve-sku-files-used-nightly` 04:00 UTC) and **quarantine-model — never auto-deletes/unlinks**. Full detail: `docs/POPSG.md` → "Style Guide Sources"; quirks #46–#48.
**Do not change because:** Do NOT bulk-delete unresolved `sku_files_used` rows that look like filenames — PopSG is not a comprehensive ground truth (a stale crawl can mark real files inactive; see quirk #46), so "no match" ≠ "garbage." Only categorical non-filenames (style-guide titles, a SKU used as its own filename) are safe to delete. Files-used live in PopSG `style_guide_files`, **not** PopDAM `assets` — don't reconcile against `assets`.

### Master Data style tracker is temporary; PLM APIs are canonical for customers/licensors/properties

**Looks like:** `master.designflow.app/styles` can fuzzy-match customer-looking strings and treat those as canonical customers.
**Actually:** the Master Data style tracker is a temporary Google Sheet replica. The user clarified on 2026-06-24 that canonical licensors/properties/customers come from read-only PLM APIs, whose credential is stored in 1Password item `DesignFlow PLM Canonical Master Data API`. Canonical customers now live in `core.customer`; confirmed PLM-backed customers have `is_potential = false` and a `designflow_plm` row in `core.company_source_ref`. Email/domain noise belongs only in `crm.ingested_domain` and must never create, promote into, source-ref, FK to, or otherwise associate with customers.
**Why:** PLM is the source of truth for this business data, but PLM is not yet fully transferred into the shared Supabase project. The tracker needs a bridge now without polluting or over-trusting shared tables.
**Do not change because:** do not write new values into shared canonical tables from the tracker, do not use `api.customer_list`, and do not assume customer candidates are correct unless reconciled to PLM. Use `docs/MASTER_DATA.md` for the app/data-flow details.

### Sibling file scans need a 10-minute lease/expiry

**Looks like:** `claimed` sibling scan requests should be treated exactly like `pending` requests until the Bridge Agent completes them.
**Actually:** The "Find Sibling Files" UI stores folder-scan jobs as `admin_config` rows named `sibling_scan_request_*`. The Bridge Agent claims a row, scans the NAS folder for sibling JPG/PNG/eligible PDF files, then reports completion through `complete-sibling-scan`. If the agent restarts or throws after claiming, the row can otherwise stay `claimed` forever and the UI will sit at "Waiting for Bridge Agent..." indefinitely.
**Do not change because:** `supabase/functions/_shared/admin-handlers/sibling-scan-handlers.ts` intentionally expires stale `claimed` rows after 10 minutes, and `supabase/functions/agent-api/index.ts` intentionally lets the Bridge Agent reclaim stale claims. `apps/bridge-agent/src/index.ts` also reports a failed scan when a per-request worker throws. Keep these together so a dead agent/request becomes a retryable failure instead of blocking future scans for the same folder.

### `app/` symlink at repo root

**Looks like:** An older version of the frontend code.
**Actually:** Dead symlink to an old build snapshot. Has no effect on the build or runtime.
**Do not change because:** Ignore entirely; it has no build/runtime role.

### `bulk-job-runner` edge function is a deployed no-op

**Looks like:** A real function that runs batch jobs.
**Actually:** Returns `{ ok: true, message: "replaced by railway worker" }`. All batch work runs in the Railway worker. The pg_cron schedule that used to call this was removed in migration `20260322000000`.
**Do not change because:** Adding logic here would conflict with the Railway worker.

### PopSG file tagging (`tag-popsg-files`) runs in the Railway worker, not an edge function

**Looks like:** A tagging/search feature, so it must live in `supabase/functions/`
alongside the other PopSG API routes.
**Actually:** The whole op is `apps/worker/src/handlers/popsg-tags.ts`. That file owns
both phases and writes the resume cursor. `supabase/functions/` only holds the
registry entry in `_shared/operation-constants.ts`. This is the general rule, not a
special case: **long-running batch/bulk operations are worker handlers; edge functions
are request-response only** (see the `bulk-job-runner` quirk above).
**Cursor detail:** two shapes, both accepted by `isResumableOperationCursor` in
`src/hooks/usePersistentOperation.ts`. Phase 1 (deterministic) uses a bare UUID.
Phase 2 (folder consensus) uses `consensus:<base64url>` — `base64url`, so the
alphabet is `A-Za-z0-9-_` with **no `=` padding**. Do not "fix" the validation regex
to allow `=`/`+`/`/`; that would be matching an encoding the writer never produces.
When the op is finished or has no next key, the worker writes `null`, never a bare
`consensus:`.
**Do not change because:** Adding a duplicate implementation under
`supabase/functions/` would fight the worker for the same `BULK_OPERATIONS` entry.

### `verify_jwt = false` on `admin-api` in `supabase/config.toml`

**Looks like:** Security hole — admin API doesn't verify JWTs at the gateway level.
**Actually:** CORS preflight (`OPTIONS`) carries no auth header; gateway-level JWT check rejects it. Verification happens inside the function. See `docs/KNOWN_QUIRKS.md` #4.

### Style group rebuild `finalize_stats` calls `reconcile_style_group_stats_batch` in a loop

**Looks like:** Should just call `run_full_reconcile_style_group_stats` once.
**Actually:** `run_full_reconcile_style_group_stats` has no `SET statement_timeout`, so after a full rebuild the DB-level role timeout kills it. The batched approach (100 groups/batch for counts, 25 for primaries) each has `SET statement_timeout = '120s'` and completes without hitting the limit.
**Do not change because:** "Start Fresh" rebuild reliably times out on "Compute counts" when there are many groups.

### `trg_sync_primary_on_thumbnail` fires on INSERT **and** UPDATE

**Looks like:** Overkill — why would an INSERT need to sync a cover?
**Actually:** The bridge agent sets `thumbnail_url` at insert time (single DB write). If the trigger only fired on UPDATE (which it did before migration `20260529132758`), those assets never triggered the sync, leaving `primary_asset_id = null`. A backfill in that migration fixed 482 affected groups.
**Do not change because:** Reverting to UPDATE-only would silently break cover assignment for any asset inserted with a thumbnail already set.

### Railway worker deploys on every push to `main`

**Looks like:** Wasteful — most pushes don't touch `apps/worker/`.
**Actually:** Railway doesn't support path filters. Every push triggers a Railway rebuild regardless of which files changed. This is a Railway platform constraint, not a bug.

### Two separate `OPENROUTER_API_KEY` locations

**Looks like:** Duplication or confusion.
**Actually:** `admin_config.OPENROUTER_API_KEY` feeds bridge/windows agents via heartbeat response. Railway env `OPENROUTER_API_KEY` feeds the Railway worker directly. Setting one does not set the other.

### `.mcp.json` carries no secrets — MCP tokens come from 1Password (do NOT re-hardcode)

**Looks like:** `devops-mcp`/`synology-monitor` in the root `.mcp.json` have `Bearer ${DEVOPS_MCP_TOKEN}` / `${NAS_MCP_TOKEN}` placeholders that "should" hold the actual token.
**Actually:** The tokens are injected from 1Password (`vibe_coding/designflow-mcp`) — on the VPS via a `~/.bashrc` `op read` block, elsewhere via `op run`. The old hardcoded tokens were exposed in git history and had to be rotated (2026-06-22).
**Do not change because:** pasting real tokens back into `.mcp.json` commits them to git and re-exposes them. Full model + rotation steps: `docs/MCP_SERVERS.md`.

### `supabase` MCP server needs its own explicit `env` block, unlike the `http`-type servers

**Looks like:** Since `devops-mcp`/`synology-monitor` resolve their `${VAR}` bearer-token placeholders automatically, the `supabase` entry (a local `npx` stdio server) should too.
**Actually:** `${VAR}` auto-resolution from 1Password (some hosting environments do this) has only been observed for `http`-type servers' `headers` block. The `supabase` entry originally had **no `env` key at all**, so it depended entirely on `SUPABASE_ACCESS_TOKEN` already being exported in the shell that launches the session (the `~/.bashrc` `op read` block) — which doesn't happen in every session type (confirmed 2026-07-08: a non-VPS session had the token unset, and `npx @supabase/mcp-server-supabase` failed instantly with "provide a personal access token"). Fixed by adding `"env": {"SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"}` to the `supabase` entry in `.mcp.json`, matching the placeholder pattern already used elsewhere in the file.
**Do not change because:** this still carries no literal secret (placeholder only). If `supabase` MCP tools are unavailable after a session restart, check whether the specific environment's launcher exports `SUPABASE_ACCESS_TOKEN` before starting Claude Code — see `docs/MCP_SERVERS.md`.

### `src/integrations/supabase/client.ts` is a one-line re-export

**Looks like:** Should create a Supabase client.
**Actually:** Re-exports from `external-supabase.ts` so that Lovable overwrites don't break production. See `docs/KNOWN_QUIRKS.md` #2.

### Supabase credentials hardcoded in `src/lib/app-mode.ts`

**Looks like:** Security anti-pattern.
**Actually:** The anon key is a publishable key (like a Firebase web API key); the service role key is never hardcoded. Lovable overwrites `.env` on every deploy, so env vars can't be trusted. See `docs/KNOWN_QUIRKS.md` #1.
**Do not change because:** Moving these to env vars would make all queries silently route to the empty Lovable-provisioned project.

### Helper storage provider is per-machine/region, not a global flag

**Looks like:** `admin_config.HELPER_SEAFILE_PREFERRED` should globally switch all designers to Seafile.
**Actually:** Transport is chosen **per machine by region** — Brazil (WFH) → Seafile/SeaDrive, USA → Synology `edgesynology1` over SMB. The Helper's local `config.preferredProvider` is the real lever (set at install); `HELPER_SEAFILE_LIBRARIES` + `HELPER_SYNOLOGY_FALLBACK_ALLOWED` flow from `admin_config` via `helper-api /config`. Brazil keeps a Synology fallback over Tailscale SMB. USA/Synology check-in first writes through the configured local NAS folder mapping with temp-copy-then-rename, then falls back to Synology File Station if the local SMB write fails. A library is matched by **longest path-prefix** on `relative_path` (a PopDAM root can hold multiple Seafile libraries as subfolders).
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
**Do not change because:** `verifying` is included in the `asset_checkouts_one_active_per_asset` partial unique index (same as `active`), so the lock is held throughout. Removing the step silently re-introduces a race condition for WFH Brazil check-ins.
**Timing / deadlines:** T1 = 30 min (`verify_deadline_at`) — flag surfaced to designer + admin, re-drive triggered. T2 = 2 hours (`verify_resolve_at`) — auto-resolve releases the lock into `error` with diagnostics. Both deadlines freeze when the bridge agent is offline (detected by a gap > 3 heartbeats in `verify_last_attempt_at`); see `handleReportCheckinVerification` in `supabase/functions/agent-api/index.ts`.
**Code:** `supabase/functions/helper-api/index.ts` (complete-checkin Seafile branch), `supabase/functions/agent-api/index.ts` (claim-checkin-verifications / report-checkin-verification), `apps/bridge-agent/src/checkin-verifier.ts`, migration `20260609120000_asset_checkouts_receipt_verification.sql`.

---

### Agent reported `version` can lie — the admin panel trusts `build_sha`, not the version string

**Looks like:** The Settings → Bridge Agents "Up to date ✅" badge means the agent is running the latest published code.
**Actually:** The agent reports three identity fields. `version` is read from `package.json` at **runtime** (a mutable, human-edited string). `image_tag` and `build_sha` identify the running image and — **as of bridge v1.16.4** — are read from an **immutable `/app/build-info.json` baked into the image** (`readBuildInfo()` in `apps/bridge-agent/src/index.ts`), **not** from env vars. This file-based source matters: the self-updater's `recreateViaDockerRun` clones the previous container's entire env as explicit `-e` flags, which **used to override the env-based `POPDAM_BUILD_SHA`/`POPDAM_IMAGE_TAG`** and freeze them at the first image's values even after a *successful* update (see Incidents 2026-06-21 + `docs/KNOWN_QUIRKS.md` #26). A file in the image layer can't be overridden by env-cloning, so the reported `build_sha` now always matches the running image. The panel compares the agent's `build_sha` against `BRIDGE_LATEST_BUILD.sha` (returned by admin-api `get-latest-agent-build`). "Up to date" is sha-based; a version-matches-but-build-differs state renders a red **"Build mismatch"** warning with the recovery command.
**Why:** On 2026-06-09 the panel showed v1.16.0 "up to date" while the NAS container ran v1.9.6 — the version string hid a failed update; `build_sha` exposed it. But the env-based `build_sha` then produced **false** "Build mismatch" alerts on every later (successful) update because the env-clone froze it — root-caused and fixed 2026-06-21 by moving build identity to the immutable file. Env vars remain only as a pre-1.16.4 / dev fallback.
**Do not change because:** The self-updater is fragile (see `docs/KNOWN_QUIRKS.md` #26 — ~50 iterations to stabilize) and was deliberately left untouched; the fix went into the build (file) + reader, not the recreate logic. **Do not "simplify" `readBuildInfo()` back to `process.env.POPDAM_BUILD_SHA`** — that re-introduces the env-clone freeze and the false alerts. Code: `apps/bridge-agent/{Dockerfile,src/index.ts}`, `src/pages/SettingsPage.tsx` (`AgentStatusSection`), `supabase/functions/admin-api/index.ts` (`handleGetLatestAgentBuild`).

---

### `stage` is not `workflow_status` (path-derived attributes)

**Looks like:** `assets.stage` and `assets.workflow_status` are redundant — both come from the folder path, so pick one.
**Actually:** They answer different questions. `stage` is **positional** — the folder directly under `____New Structure` (one of the 5 lifecycle buckets: In Development, Concept Approved Designs, Product Ideas, Freelancer art, Discontinued), set by a DB trigger. `workflow_status` is a **deepest-first scan** against `admin_config.WORKFLOW_FOLDER_MAP`, set by edge-function ingest code, and its values include adoption/approval states (`customer_adopted`, `licensor_approved`). For the same file, `stage="In Development"` while `workflow_status="customer_adopted"`. `customer`/`program` ride alongside `stage`, derived only in the In Development → Customer Adopted branch.
**Why:** `workflow_status` predates `____New Structure` and is ambiguous there (it conflates lifecycle with approval and deliberately drops the Concept-Approved signal). `stage` gives a clean lifecycle bucket for the new tree.
**Do not change because:** Filters, search (`Ross Wall 2026` → its files/groups), and `get_filter_counts`/`get_path_facets` all depend on these columns; the triggers keep them in sync on folder moves. Full rules: `docs/PATH_ATTRIBUTES.md`.

### `quick_hash` is NOT content-unique — move detection is guarded (fixed forward 2026-06-20)

**Looks like:** `quick_hash` should identify a file's contents, so matching it is enough to detect a move.
**Actually:** `quick_hash` = SHA-256(first 64KB + last 64KB + size), a *sampled* hash. Template-derived design files and all 0-byte files can collide, while byte-identical duplicate copies intentionally share a hash. Since bridge agent v1.16.2 and the matching `agent-api`, move detection is allowed only when the incoming path has no existing row, file size is nonzero, the candidate is unique by `(quick_hash, filename)`, and the bridge has not marked the file with `skip_move_detection`.
**Why:** The old hash-only logic flip-flapped one asset row between duplicate/colliding paths, hid the other real files from the Library, and grew `asset_path_history` to millions of rows. After v1.16.2 was deployed, a repair scan and verification scan completed; the verification scan saw `122,380` files, `81` moves, and `0` errors. Then `9,299,506` high-churn `asset_path_history` rows were pruned and `VACUUM (ANALYZE)` succeeded.
**Do not change because:** Reverting to hash-only move detection will regenerate path-history bloat and hide duplicate/colliding files again. Preserve the bridge's scan-wide `(quick_hash, filename)` seen set, the `check-changed.existing_content_identities` response, `skip_move_detection`, and the server-side uniqueness/0-byte/path guards. Full detail: `docs/KNOWN_QUIRKS.md` #51.

### Library list/facet queries must beat the 8s `authenticated` timeout (2026-06-19)

**Looks like:** `get_filter_counts` / `assets` count queries 500 intermittently on cold load; "works in SQL."
**Actually:** Direct SQL runs as `postgres` (no statement_timeout). The browser runs as `authenticated` (`statement_timeout=8s`, Supavisor-enforced — `SET LOCAL` can't raise it, see `docs/KNOWN_QUIRKS.md` #33). `get_filter_counts` was 14s (5 table scans); fixed to ~260ms via one materialized scan + the `idx_assets_facet_counts` covering index (index-only). `asset_path_history` reads needed `idx_asset_path_history_asset_id_detected_at` (30s→16ms).
**Do not change because:** Always size `assets`-aggregation RPCs against the 8s `authenticated` ceiling cold, never against `postgres` timings. Keep `get_filter_counts` reading only columns in `idx_assets_facet_counts`. In Style Groups mode, do not run the background all-assets list query just to populate counters; group counts and filtered file totals should come from `style_groups` (`useStyleGroupCount` / `useStyleGroupAssetCount`). This matters for legacy Wall/`3FZ` filters, where the group queries are valid but the unnecessary `assets` query can 500. Detail: `docs/KNOWN_QUIRKS.md` #49–#52.

### The `dam` schema is NOT exposed to PostgREST — reach `dam.*` via `public` RPCs (2026-07-15)

**Looks like:** `client.schema("dam").from(...)` from the worker/edge should work with the service-role key.
**Actually:** `dam` is not in `pgrst.db_schemas` (`public, graphql_public, api, crm, pim, core, app`), so any PostgREST call to `dam.*` returns **`Invalid schema: dam`** — even for `service_role`. This is deliberate: `dam` holds worker-internal tables (`sku_human_description`, `pdf_rich_extraction`) the frontend never queries.
**Do not change because:** Adding `dam` to the exposed list broadens the shared API surface for all apps and needs RLS on every `dam` table. Instead reach `dam.*` through `public` `SECURITY DEFINER` functions granted to `service_role` (e.g. `get_pdf_rich_extraction_hashes`, `upsert_pdf_rich_extraction`, `refresh_style_group_rich_metadata`). Full detail: `docs/KNOWN_QUIRKS.md` #64.

### Rich-PDF extraction uses DeepSeek's **direct** API, not OpenRouter (2026-07-15)

**Looks like:** all worker AI goes through OpenRouter/Exacto, so rich-PDF should too.
**Actually:** the `rich-pdf-extract` op calls DeepSeek directly (`apps/worker/src/deepseek.ts`, key `DEEPSEEK_API_KEY`) because it sends an identical instructions+schema prefix on every one of ~19k calls, and DeepSeek's **automatic prefix caching** bills cache hits at ~1/10 — a saving OpenRouter does not reliably pass through. The op puts the stable prompt in `system` and the variable PDF text in `user` to maximize cache hits, and normalizes extracted `materials` (uppercase) so the DAM Material facet doesn't split on casing.
**Do not change because:** routing this batch through OpenRouter loses the caching economics. General rule for future cacheable, high-volume LLM batches: prefer the direct provider API. Full detail: `docs/RICH_PDF_EXTRACTION.md`.

### Compact chrome duplicates its media query in TS **and** CSS on purpose (2026-07-29)

**Looks like:** `COMPACT_CHROME_QUERY` in `src/hooks/use-compact-chrome.ts` is the single source of truth for the short-screen library layout, so changing it is enough.
**Actually:** the same condition `(max-height: 1300px), (max-width: 1700px)` is written **twice** — once in that TS constant (drives React branching) and once as an `@media` block in `src/index.css` that flips `--pd-header-h` between `3.5rem` and `3rem`. A TypeScript constant cannot drive a CSS media query, so the duplication is unavoidable. The page shells in `Index.tsx` and `StylesPage.tsx` size themselves with `h-[calc(100vh-var(--pd-header-h))]`.
**Do not change because:** editing one and not the other yields a page shell 8px taller or shorter than the header, which shows up as a stray scrollbar or clipped pagination bar rather than an obvious break. Change both together. Also note the query is height-first, not the usual width breakpoint — the problem it solves is vertical space on wide-but-short screens like 1920x1200. Full detail: `docs/UI_OVERVIEW.md` → "Compact Chrome".

## Credentials and environment

| Variable | Purpose | Stored where | Required in dev | Required in prod |
|----------|---------|-------------|----------------|-----------------|
| `SUPABASE_URL` | Supabase project URL for worker, edge functions, agents, CI notifications | Railway env, Supabase function env, GitHub secrets, agent `.env` | No for frontend (`src/lib/app-mode.ts` is hardcoded); yes for worker/agent dev | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker → Supabase service role | Railway env vars | No | Yes (Railway) |
| `OPENROUTER_API_KEY` | Worker AI calls | Railway env vars | No | Yes (Railway) |
| `ANTHROPIC_API_KEY` | Worker ERP classification fallback/alternative; listed in `apps/worker/.env.example` | Railway env vars | No | Optional |
| `GOOGLE_AI_API_KEY` | Legacy Gemini AI tagging fallback and `supabase/functions/ai-tag` | Railway env vars / Supabase function secrets | No | Optional unless using legacy AI tag path |
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

### Frontend (React app)

**Workflow:** `.github/workflows/publish-frontend.yml`
**Triggers:** push to `main` touching `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `Dockerfile.ci`, `nginx.conf`, `.github/workflows/publish-frontend.yml`; also `workflow_dispatch` for manual redeploys.
**Steps:** `verify` job (`npm ci` + `npm run lint`) → `build-and-push` (`needs: verify`): npm ci → vite build → GHCR login with `GHCR_PAT` when present, otherwise the workflow `GITHUB_TOKEN` (`packages: write`) → Docker `build-push-action` with `Dockerfile.ci` → push to GHCR (`:latest`, `:sha-<short-sha>`, `:<short-sha>`) → POST Coolify API → Coolify pulls `:latest` and replaces container. The deploy is gated on `verify` via a native `needs` dependency (a lint failure blocks publish + deploy). `ci.yml` (bun lint/test/build) is the broad repo CI and runs in parallel; it is **not** the deploy gate.
**GHCR package access:** `ghcr.io/u2giants/popdam-frontend` is a user-scoped package. The workflow prefers a repo secret `GHCR_PAT` with package write access because GitHub can reject `GITHUB_TOKEN` writes unless the package's **Manage Actions access** setting grants `u2giants/popdam3` write access. If both are missing, `docker/build-push-action` fails before Coolify is triggered.
**Coolify pull access:** Coolify's helper container pulls private GHCR images using the Docker credential file mounted from the VPS (`/root/.docker/config.json`). A green GitHub workflow does not prove live deployment if Coolify cannot pull from GHCR. In that case Coolify records a failed deployment with registry `unauthorized`; restore the VPS GHCR login without putting token values in docs.
**Stale-site check:** if the live header shows an old commit, check the latest `Publish Frontend Image` run first. If it failed before "Push image to GHCR" or "Deploy via Coolify", Coolify will keep running the previous successful image (for example, `8c0508d` stayed live because later runs failed before a newer GHCR `:latest` image was published). If the workflow is green but the site is old, inspect Coolify deployment logs and `docker ps` on the VPS; do not assume the GitHub deployment sidebar means the frontend is current.
**Rollback:** In Coolify UI, select an older deployment and redeploy. The `:<sha>` tag is the immutable rollback target.

### Supabase edge functions

**Workflow:** `.github/workflows/deploy-supabase.yml`
**Triggers:** push to `main` touching `supabase/functions/**`
**Steps:** deploy edge functions (if functions changed) → auto-generate and commit `src/integrations/supabase/types.ts`
**Database rule:** this repo no longer runs `supabase db push`. All shared Supabase migrations go through canonical `/worksp/shared-db` branch + PR, using `shared-db/AGENTS.md` and the `Shared Supabase Migrations` workflow.

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
**Code signing:** **permanently abandoned — installers stay unsigned forever** (user decision, 2026-06-25; the Apple Account-Holder cert + separate Windows OV/EV cert hurdle is too high). The macOS job reads `CSC_LINK`/`CSC_KEY_PASSWORD` (Developer ID `.p12`) + `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (notarization via `scripts/notarize.cjs`), but the secrets are intentionally left unset, so it ships an **unsigned** dmg (Gatekeeper right-click→Open) and skips notarization; Windows is unsigned (SmartScreen "More info → Run anyway"). These first-launch warnings are the accepted permanent UX — **not** pending work. Wiring is dormant only so a future maintainer could revive it. See `HANDOFF.md` §5.3.
**Seafile/SeaDrive:** the Helper supervises (does not embed) the SeaDrive virtual-drive client for WFH designers; see `docs/SEAFILE_INTEGRATION.md`.
**CI caching rule (learned the hard way):** the Windows job caches **only** `~\AppData\Local\electron\Cache` (the immutable Electron binary). **Never** add `~\AppData\Local\electron-builder\Cache` back — that dir is the NSIS toolchain that stamps the (un)installer, and caching it once shipped a corrupted uninstaller that failed 100% with "NSIS Error: Error launching installer" on uninstall (`docs/KNOWN_QUIRKS.md` #54, fixed 2026-06-25 commit `d7a1133`). Re-download the toolchain fresh every run.
**Microsoft OAuth:** the "Continue with Microsoft" flow must **not** pass its own `state` to `/auth/v1/authorize` — Supabase GoTrue forwards a caller `state` to the provider verbatim and then can't match it on callback, failing with `bad_oauth_state` and dumping the user on the project Site URL (`crm.designflow.app`). GoTrue manages state itself; PKCE binds the flow. Fixed in `apps/popdam-helper/src/main/oauth.ts`, Helper v1.4.2 (2026-06-25).

**Mac SeaDrive health checks:** never traverse a SeaDrive mount synchronously
from Electron's main thread. SeaDrive metadata calls can block long enough for
macOS to report **Application Not Responding**, especially immediately after a
user selects the mount folder. UI/status callers use
`getSeafileHealthAsync()` (Helper v1.4.13, commit `4301a34`); preserve its nested
category/group discovery. See `docs/POPDAM_HELPER.md` and
`docs/KNOWN_QUIRKS.md` #66.

**Mounted does not mean file present:** Helper storage health validates the
SeaDrive mount/library, not every deep asset placeholder. On macOS,
`/Users/<user>/Library/CloudStorage/SeaDrive-<account>` is a valid File Provider
root. After ~20 minutes, compare the exact path in Finder and Seafile web rather
than waiting longer. Also preserve/report `seafileIssue` when Synology fallback
fails; the current final `File not found locally` error can hide the primary
SeaDrive reason. See `docs/KNOWN_QUIRKS.md` #67.
**Checkout/check-in robustness (v1.4.3–1.4.8):** SeaDrive library location is **auto-discovered** (mounts vary per user/OS — `My Libraries`/`Shared with …`, bounded scan + cache); failures are never silent (failed checkout releases the orphaned lock + notifies; permanent upload failure pops a modal; missing Synology creds open Settings to the field); edits are tracked by an atomic-save-aware directory watcher driving an hourly reminder + a quit guard; a Photoshop UXP plugin (`resources/photoshop-plugin/`, Helper `POST /editor-event`) offers check-in on document close (Illustrator has no close event — intentionally unsupported). Full detail: `docs/POPDAM_HELPER.md`.

---

## Pending work

Keep `HANDOFF.md` while any row here is open. Delete `HANDOFF.md` only after the pilot, PopSG render/backfill, and style-guide archival readiness items are done or intentionally abandoned. (Helper code signing is **permanently abandoned**, not a pending row — see above and `HANDOFF.md` §5.3.)

| Status | Item | Next action |
|--------|------|-------------|
| 🟡 open | **Seafile/SeaDrive Helper — Brazil pilot** | First slice (v1.4.1) + receipt verification (bridge agent v1.16.x) shipped and **active** (`CHECKIN_VERIFICATION_ENABLED = true`, 2026-06-09); Helper Microsoft OAuth + USA SMB/local check-in shipped in `1cc3fd3`; Supabase Auth callback `http://127.0.0.1:47380/auth/callback` allowed on 2026-06-24. Next: install Helper + SeaDrive on one Brazil Mac and validate checkout/check-in round-trip — watch the first real check-in go `verifying → complete`. See `HANDOFF.md`, `docs/SEAFILE_INTEGRATION.md`. |
| 🟡 open | **PopSG render pass** | Windows Agent on **v0.16.0**; render backlog not fully processed (operational — run Retry All + queue EPS). See `HANDOFF.md`. |
| 🟢 done 2026-06-18 | **Frontend deploy GHCR package access** | `publish-frontend.yml` now uses `GHCR_PAT` when present, the repo secret is set, and GHCR publish succeeded for image tags `latest`, `sha-5482fb7`, and `5482fb7`. Coolify pull access also depends on the VPS Docker login at `/root/.docker/config.json`; see the 2026-06-18 critical incident and `docs/deployment.md`. |
| 🟡 open | **Style Guide Sources archival readiness** | Let the licensing-PDF backfill finish, add crawl-regression guard before archiving, then build an explicit archived state for old style guides. See `HANDOFF.md` and `docs/POPSG.md`. |
| 🟢 done external | **Seafile server direct-MS SSO** | Fixed 2026-06-08 in the separate `u2giants/seafile` repo. Keep this note only as context for the Brazil pilot. |
| 🟢 shipped 2026-07-15 | **Two-level asset metadata** | Product-level `style_groups.item_description` (+ `dam.sku_human_description`) and file-level `assets.content_type`, folded into the DAM search rollup (shared-db PR #67). Frontend Content Type filter + item-description display; worker classifies `content_type`. Done. |
| 🟡 mostly done 2026-07-15 | **Rich tech-pack/licensing PDF extraction (§5.15)** | Schema + worker + frontend all shipped and live (shared-db PRs #74 schema, #77 RPC access, #78 material facet). Backfill **Pass 1 complete** (246 PDFs — every tech-pack/licensing PDF with extracted text). `DEEPSEEK_API_KEY` set in Railway (verified). Remaining: **Pass 2** — on-prem text-extract the ~19k eligible PDFs that have no `pdf_text_samples.extracted_text` yet, then re-run the `rich-pdf-extract` op (idempotent). See `docs/RICH_PDF_EXTRACTION.md`, `HANDOFF.md` §5.15. |

## Critical incidents

### Resolved 2026-07-01: Microsoft login returned "500: Database error granting user" on first attempt

What happened: Users signing into `dam.designflow.app` with Microsoft/Azure hit `500: Database error granting user` on the first OAuth callback. Retrying often worked, which made it look like a transient OAuth issue.

Impact: New/returning SSO users could not reliably enter PopDAM on the first attempt. No asset data impact.

Root cause 1 (fixed 2026-06-30, commit `4073f2c`): the shared CRM auth migration in `/worksp/shared-db` (`20260621162220_crm_auth_provision`) used the generic `on_auth_user_created` trigger name on `auth.users`, replacing PopDAM's original `public.handle_new_user()` trigger. Azure users were created in `auth.users` and shared `app.profile`, but did not get PopDAM `public.profiles`, `public.user_roles`, or `public.app_access('popdam')`. Fix: migration `20260630173500_restore_popdam_auth_trigger.sql` adds a PopDAM-specific `on_auth_user_created_popdam` trigger and backfills missing managed-SSO access rows.

Root cause 2 (actual remaining first-login failure, fixed 2026-07-01, commit `ab265bb`): Supabase Auth logs still showed `Database error granting user`; the matching Postgres log showed `duplicate key value violates unique constraint "refresh_tokens_pkey"`. `auth.refresh_tokens_id_seq` was behind the imported rows (`last_value = 281`, `max(id) = 3518`), so token creation could collide. Fix: reset the live sequence and commit migration `20260701114000_repair_auth_refresh_token_sequence.sql`.

Rule added to prevent recurrence: Never use the generic `on_auth_user_created` trigger name for PopDAM-owned provisioning; keep `on_auth_user_created_popdam`. When Supabase Auth reports `Database error granting user`, inspect both `auth_logs` and `postgres_logs` around the same timestamp/request ID; the browser error is only a wrapper. After Supabase imports/restores/cutovers, verify Auth-owned sequences such as `auth.refresh_tokens_id_seq` are not behind their table max.

---

### Resolved 2026-06-25: PopDAM Helper (Windows) uninstall failed with "NSIS Error: Error launching installer" — CI cached the NSIS toolchain

What happened: A pilot user could not uninstall the Windows Helper — it failed **100% of the time** with `NSIS Error — Error launching installer`, both via Settings → Apps → Uninstall and by running the uninstaller directly; quitting the tray app first did not help. Install worked; only uninstall was broken.

Impact: No data impact. The broken uninstaller was on every Windows build produced after the bad cache entry was created; the corrected installer overwrites in place and writes a fresh, working uninstaller (no manual deletion needed to recover).

Root cause: An electron-builder NSIS uninstaller copies itself to `%TEMP%` and relaunches that copy to delete its own folder; "Error launching installer" means that relaunch failed. The Windows CI job cached **`~\AppData\Local\electron-builder\Cache`** — the NSIS *toolchain* (uninstaller stub + plugins + winCodeSign) that stamps the (un)installer — keyed only on `package-lock.json`. A corrupted toolchain entry therefore persisted across every build and shipped the same broken uninstaller. (The other possible cause of this error — Windows blocking the *unsigned* temp copy via SmartScreen/Smart App Control/AV — was **not** the cause here; that one is only fixable by code signing, which is permanently abandoned.)

Recovery / fix (commit `d7a1133`): Stop caching the electron-builder toolchain dir; cache **only** the immutable Electron binary (`~\AppData\Local\electron\Cache`) and re-download the integrity-checked NSIS toolchain fresh each run. Cache key prefix changed `electron-win-` → `electron-bin-win-` so the old suspect cache is never restored. Verified: rebuilt Helper uninstalls cleanly. Same push also shipped the Helper v1.4.2 Microsoft-OAuth `bad_oauth_state` fix.

Rule to prevent recurrence: **Never cache a build toolchain dir** (`~\AppData\Local\electron-builder\Cache` / `~/Library/Caches/electron-builder` / `~/.cache/electron-builder`) in CI — only cache immutable dependency downloads. Full writeup: `docs/KNOWN_QUIRKS.md` #54.

---

### Resolved 2026-06-22: coolify-proxy lost its Docker socket again → nas-mcp 502 (now self-healing)

What happened: While rotating the MCP bearer tokens, redeploying the `nas-mcp` Coolify **Application** created a new container that returned `502` publicly — even though the container was healthy and `coolify-proxy` could reach it directly (`wget` inside the proxy → `405`). Traefik's logs showed sustained `Cannot connect to the Docker daemon at unix:///var/run/docker.sock` (docker provider down). `devops-mcp` survived because it's a **Service** routed via Traefik's **file** provider; `nas-mcp` is an **Application** routed via the **docker** provider, which was blind.

Impact: `nas-mcp.designflow.app` was 502 for ~15 min; other domains stayed up. (No data impact.)

Root cause: Same class as 2026-06-18 — after a Docker daemon event, `coolify-proxy`'s bind-mounted `/var/run/docker.sock` goes stale (old inode), so Traefik's docker provider can't see container events and keeps routing to the old (gone) container. The host socket is fine; only the proxy's view is stale.

Recovery: `docker restart coolify-proxy` (re-establishes the socket mount; Traefik re-reads all labels). All sites recovered within seconds.

Rule added to prevent recurrence: **Root cause = `unattended-upgrades` auto-upgrading `docker-ce`/`containerd`** (confirmed in `dpkg.log`: both incidents coincide with docker upgrades — 06-18 and 06-21). The daemon restart recreates `/var/run/docker.sock` (new inode), stranding coolify-proxy's read-only file mount. Compounded by **`live-restore: true`**, which keeps coolify-proxy running across the daemon restart so it holds a stale socket mount. **Primary fix (applied + verified 2026-06-22):** `coolify-proxy-reconnect.service` — a systemd unit `BindsTo`/`WantedBy=docker.service` that restarts only coolify-proxy after the daemon (re)starts, restoring routing in ~30s automatically. Docker stays **unheld** (auto-updates freely); apps stay up via live-restore, only the proxy blips. (`deploy/vps/restart-coolify-proxy-after-docker.sh`.) **Backstop:** a self-healing watchdog (`deploy/vps/coolify-proxy-socket-watchdog.sh`, systemd timer every 3 min, restarts the proxy only on *sustained* socket failure, rate-limited 1/15 min, logs to `/var/log/coolify-proxy-watchdog.log`) covers the rare manual-upgrade/crash case. Both documented in `deploy/vps/README.md`. Symptom to recognize: a **new/changed** container 502s while existing sites stay up → `docker logs coolify-proxy | grep "Cannot connect to the Docker daemon"`; auto-fixes in ~30s (reconnect unit) or ~3 min (watchdog), or `docker restart coolify-proxy`. **Full writeup: `deploy/vps/coolify-proxy-socket-fix.md`.**

---

### Resolved 2026-06-21: Bridge "Build mismatch" false alarm — self-update froze `build_sha` (and a wrong-project investigation detour)

What happened: After the bridge self-updated, the admin panel showed a red **"Build mismatch — reports v1.16.3 but running sha:8340ef9, not published sha:a35414d."** The bridge was in fact running the correct published image (verified: the running container's image OCI label `org.opencontainers.image.revision` matched `:stable`), but it self-reported a stale `build_sha`/`image_tag`. Separately, the first hour of investigation was misdirected because the default `mcp__supabase__*` tooling points at the **decommissioned Ohio project `ryltkzzernhwnojzouyb` ("popdam-prod.old")**, whose `agent_registrations` froze at the cutover — looking real but 16h stale. The live data is in **Virginia `qsllyeztdwjgirsysgai`**.

Impact: Cosmetic but alarming — the badge implied a failed/stale deploy fleet-wide while the agents were healthy and current. No functional outage. Risk was a wasted "fix" (`docker rm -f && compose up`) or chasing a dead database.

Root cause: `recreateViaDockerRun` (`apps/bridge-agent/src/index.ts`) clones the previous container's entire `.Config.Env` as explicit `-e` flags (to preserve `SUPABASE_URL`/`AGENT_KEY` on installs with no compose file). Explicit `-e` beats the new image's baked `ENV`, so `POPDAM_BUILD_SHA`/`POPDAM_IMAGE_TAG` were **frozen at the first-ever image's values** and re-inherited on every update. The drift detector reads `build_sha`, so it false-alarmed on every successful update. (This is the same mechanism behind the 2026-06-09 incident's contradictory identity, finally root-caused.)

Recovery: Bake build identity into an immutable `/app/build-info.json` at build time (Dockerfile) and read it via `readBuildInfo()` (file-first, env-fallback). A file can't be overridden by env-cloning, so the reported sha always matches the running image. Shipped as bridge **v1.16.4** (commit `fa26b14`); the fragile `recreateViaDockerRun` was left untouched. Self-heals on the next update — verified live: bridge reports `version 1.16.4 / build_sha fa26b14 / image_tag v1.16.4`, matching `BRIDGE_LATEST_BUILD`.

Rule added to prevent recurrence: Build/version identity for agents must come from an **immutable image file**, never from env vars that the self-updater clones forward. When diagnosing agent state, confirm you are querying the **live Virginia project** (`qsllyeztdwjgirsysgai`), not Ohio `.old` — the default Supabase MCP still points at the old one. To verify an image's true build at any time: `docker inspect <img> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.

---

### Resolved 2026-06-18: Frontend CI was green enough to mislead, but production stayed old

What happened: PopSG frontend code was pushed to `main`, but the live site stayed on the old June 10 frontend image. The GitHub repository page showed a green `popdam / production` deployment, but that badge was Railway worker status, not frontend status. The frontend `Publish Frontend Image` workflow was failing at GHCR with `permission_denied: write_package`, so no new `ghcr.io/u2giants/popdam-frontend:latest` image reached Coolify. After GHCR publishing was fixed, Coolify accepted the deploy API call but failed to pull the private image because the VPS Docker credential file no longer had a valid GHCR login. After restoring the VPS GHCR login, Coolify deployed the new container, but both domains briefly returned 502 because `coolify-proxy` had a stale bind-mounted Docker socket and Traefik could not see the new Docker service until the proxy container was restarted.

Impact: `sg.designflow.app` and `dam.designflow.app` served stale frontend assets until the full chain was fixed. During the final rollout, both domains briefly returned 502 even though the app container itself was healthy.

Root cause: Three separate assumptions were wrong: (1) a green GitHub deployment badge was treated as frontend proof even though it was Railway; (2) successful GitHub Actions/Coolify API trigger was treated as deployment proof before checking Coolify's actual deployment record; (3) Traefik's Docker provider was assumed healthy despite a stale `/var/run/docker.sock` mount inside `coolify-proxy`.

Recovery: Added a valid package-write `GHCR_PAT` repo secret and updated `publish-frontend.yml` to use it for GHCR login when present; confirmed GHCR tags `latest`, `sha-5482fb7`, and `5482fb7`; restored the VPS GHCR Docker login used by Coolify's helper; reran the frontend workflow; confirmed Coolify deployment `bmkalsjd7d8feykdvacqkdld` finished; restarted `coolify-proxy` to refresh its Docker socket; verified both production domains returned HTTP 200 with `Last-Modified: Thu, 18 Jun 2026 22:35:55 GMT` and the running container labels included `org.opencontainers.image.revision=5482fb734c7a969406c4f00a21a454f58bb1f890`.

Rule added to prevent recurrence: For frontend deploys, success requires all four checks: (1) `Publish Frontend Image` is green; (2) GHCR has a fresh `latest` tag and `sha-<short-sha>` tag; (3) Coolify deployment status is `finished`, not merely "queued" by the API; (4) both `https://dam.designflow.app/library` and `https://sg.designflow.app/library` return HTTP 200 with a fresh `Last-Modified`/asset hash. If the public domains return 502 while the app container is healthy, check `docker logs coolify-proxy` for Docker provider errors and verify `/var/run/docker.sock` inside `coolify-proxy` matches the live host socket; restart only `coolify-proxy` if the socket mount is stale.

---

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
| `docs/WINDOWS_AGENT_RUNBOOK.md` | Windows render agent operations |
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
