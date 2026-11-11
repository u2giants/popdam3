# AGENTS.md — PopDAM Router

The complete document index is [`docs/INDEX.md`](docs/INDEX.md), generated from
document headers. Read it (or search it for your topic's keywords) before
opening or searching any other document; open a document only when its summary
matches your task. This file routes — it does not contain. The detail behind
every section below lives in [`docs/agents-reference.md`](docs/agents-reference.md)
(same section names), and the deep-dive docs under `docs/` it points to.

Every new Markdown file opens with the four-key header (`summary`, `kind`,
`status`, `read-when`); then regenerate the index with
`ai-doc-health --repo . --fix-index` (tool: popcre/ai-devops, rules:
`docs/doc-health.md` there). The advisory check is `.github/workflows/doc-health.yml`;
it never blocks a merge.

## Session wrap-up convention

When the user says **"wrap up"**, that means: update the relevant Markdown docs with durable knowledge from the session, run required checks, commit/push/merge/deploy according to repo rules, verify 1Password coverage for any secrets encountered, and leave every repo handoff-safe. For shared Supabase/backend changes, update canonical `/worksp/shared-db` docs and complete the shared-db branch → PR → merge workflow. Do not treat "wrap up" as a summary-only request.

## Project summary

**PopDAM** is an internal Digital Asset Manager for licensed consumer-product art (Disney, Marvel, etc.). Source design files (PSD, AI) live on a Synology NAS. The system ingests them, generates thumbnails, uploads them to DigitalOcean Spaces, and gives the team a dark-mode web UI for browsing, searching, filtering, tagging, and managing artwork submissions.

**PopSG** is a second mode served by the same codebase — a style-guide library for licensors (folder-based browsing, no SKUs or ERP). Same Docker image; hostname determines mode at runtime.

**What matters:** assets get processed quickly, thumbnails appear, ERP codes resolve correctly, and style group assignments stay accurate. The team reviews and approves artwork against licensing deadlines.

Key moving parts: React web app (`src/`, Coolify), Supabase edge functions (`supabase/functions/`), shared PostgreSQL (canonical `/worksp/shared-db`), cloud worker (`apps/worker/`, Railway), NAS bridge agent (`apps/bridge-agent/`), Windows render agent (`apps/windows-agent/`), image-embed GPU poller (`apps/image-embed-worker/`, edge-dev), desktop Helper (`apps/popdam-helper/`). Full inventory: agents-reference → Container and service inventory.

## AI tool notes

Claude Code uses .claudeignore. Other tools follow **What to ignore** below. Do not bulk-load every .md file — start from `docs/INDEX.md`.

## Documentation map: what to read for each task

Always start with `AGENTS.md` (this file), then `HANDOFF.md` → the open files in `HANDOFF.d/` when continuing unfinished work. Business logic is companywide, organized by topic at the [companywide application and task map](https://github.com/u2giants/shared-db/blob/main/docs/business-rules/application-map.md); this repo must not keep a competing copy of a business rule.

| Task / question | Read these docs |
|---|---|
| Quick repo orientation | `README.md`, `docs/ONBOARDING.md`, `docs/architecture.md` |
| Modify app behavior / project-owned code | The relevant folder + its folder-level README; `docs/architecture.md` if system design changes |
| Configuration, env vars, admin_config keys | `docs/configuration.md`; agents-reference → Credentials and environment |
| Local setup, dev scripts, test/lint | `docs/development.md` |
| Deployment, Docker, CI/CD, rollback | `docs/deployment.md`, `SELFHOST.md` |
| DB schema, migrations, external IDs | `docs/SCHEMA.md`; **Standing rules** below; canonical `/worksp/shared-db/AGENTS.md` |
| Stage/customer/program (path-derived) | `docs/PATH_ATTRIBUTES.md`, `docs/PATH_UTILS.md` |
| Bulk operations / Railway worker | `docs/BULK_JOBS.md`, `docs/WORKER_LOGIC.md` |
| ERP sync / MG codes / classification | `docs/ERP_ENRICHMENT_PLAN.md` (historical), `docs/MODEL_RULES.md`; agents-reference → Task-to-file navigation |
| OrderList / `/orders` | `docs/ORDER_LIST.md`, `docs/orderlist-exception-tools.md` |
| Master Data / style tracker | `docs/MASTER_DATA.md` |
| Helper / checkout-checkin / Seafile | `docs/POPDAM_HELPER.md`, `docs/SEAFILE_INTEGRATION.md` |
| Image similarity / embeddings | `plan_image_similarity_upload_search.md` (STATUS first), `apps/image-embed-worker/README.md` |
| Search embeddings / semantic search (DAM or PopSG) | `plan_vector_consolidation.md` (STATUS first) |
| PopSG style-guide mode | `docs/POPSG.md` |
| Mockup tool | `docs/MOCKUP_TOOL.md`, `plan_mockup_auto_match.md` (STATUS first) |
| Auth / SSO / login | `docs/AUTHENTICATION.md` |
| MCP servers / 1Password secrets | `docs/MCP_SERVERS.md`, `docs/1password.md` |
| Bugs / incidents | `docs/incident-log.md`, `docs/idiosyncrasies.md`, `docs/KNOWN_QUIRKS.md`, open `HANDOFF.d/` files |
| Changing any AI model reference | `docs/MODEL_RULES.md`, `docs/KNOWN_QUIRKS.md` |

Active plans live at the root as `plan_*.md` — always read each plan's STATUS first; do not re-derive completed steps. One implementation plan per open GitHub issue sits in `docs/plans/issue-<n>-*.md`. The full list with statuses is in `docs/INDEX.md`.

## Standing rules (never skip)

- **Shared DB Gatekeeper.** All database/schema changes for the shared Supabase project `qsllyeztdwjgirsysgai` are authored in canonical `u2giants/shared-db` (**moved to `popcre/shared-db`**; the old URL redirects, but `gh search` against the old name fails) using a branch + PR + timestamped migration, preview-first, with the AI owning the merge before any dependent app code. That means no app-side DDL, no inline/startup migrations, no Dashboard SQL, no one-off `execute_sql`, and no new files in this repo's `supabase/migrations/`. The only allowed copy of shared DB migrations here is the vendored read-only `shared-db/` mirror. `shared-db-guard.yml` fails PRs that add DDL outside it; the only override is an explicitly approved exception (PR label `db-change-approved` or `[db-change-approved]` in a direct-push commit message). Full rules + startup/shutdown hygiene: agents-reference → Shared DB Gatekeeper.
- **Task gates.** Repository-local task routing is declared in `.ai-devops/task-gates.json` and verified by `scripts/test-task-gates.sh`; acknowledgement never bypasses a database-route refusal.
- **Never push directly to protected `main`.** Feature branch + PR; checks and the merge queue decide. Albert does not merge — you do (except DesignFlow or a PR he said he will review first).
- **Railway worker** auto-deploys from `main` changes matching `/apps/worker/**`; the bridge agent ships only with an `apps/bridge-agent/package.json` version bump and applies updates on request (`AGENT_UPDATE_REQUEST`).
- Credentials and secrets: 1Password vault `vibe_coding`; the root `.mcp.json` carries no secrets (tokens come from 1Password). Full environment table: agents-reference → Credentials and environment.
- New quirk → `docs/idiosyncrasies.md` (short) or `docs/KNOWN_QUIRKS.md` (deep dive); new incident → `docs/incident-log.md`; in-flight status → agents-reference → Pending work. Never expand this router with them.

## Repository structure (short)

```
src/                     ← React web app (Vite + Tailwind + Shadcn)
supabase/functions/      ← Deno edge functions (_shared/ = shared handlers)
apps/worker/             ← Railway cloud worker (handlers/ per operation)
apps/bridge-agent/       ← Synology NAS scanner + thumbnailer
apps/windows-agent/      ← Windows render agent (Inkscape/IM/GS/Poppler/Indra OCR)
apps/image-embed-worker/ ← GPU embed poller (edge-dev)
apps/text-embed/         ← SigLIP2 query-tower embedding service
apps/db-data-admin/      ← Shared Master Data admin frontend (own workflow)
apps/popdam-helper/      ← Electron desktop helper
packages/path-filters/, packages/agent-common/  ← shared workspace packages
scripts/, deploy/, .github/workflows/           ← tooling and CI/CD
docs/                    ← deep-dive docs + INDEX.md; docs/plans/ = per-issue plans
shared-db/               ← vendored read-only migration mirror (never edit; canonical repo is authoritative)
HANDOFF.md → HANDOFF.d/  ← static pointer + one write-once file per session
plan_*.md                ← active/historical implementation plans (STATUS first)
```

Full tree with per-folder notes: agents-reference → Repository structure.

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

**Before touching anything outside these paths, ask why.** Known exceptions are listed in agents-reference → Core modification inventory (currently only `nginx.conf` listening on IPv6 for the Coolify health check).

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
apps/*/src/common/          (generated copy of packages/agent-common/src)
apps/popdam-helper/out/  and  .webpack/
.cache/
coverage/
.nyc_output/
*.tsbuildinfo
package-lock.json
apps/*/package-lock.json
.lovable/               # Lovable platform memory
server                  # untracked symlink into the Coolify deploy dir — not part of the build
src/integrations/supabase/types.ts
docs/verification/      # dated evidence records (screenshots, run logs)
verification/           # dated evidence records
shared-db/              # vendored read-only mirror; canonical /worksp/shared-db is authoritative
docs/archive/           # history, not operating guidance
```

`.claudeignore` and `.cursorignore` mirror this list. Doc-health excludes those trees too (`.doc-health.json`).

## Intentional quirks, incidents, pending work

- Quirks (looks wrong but is intentional): full index and rules at agents-reference → Intentional quirks; entries in `docs/idiosyncrasies.md` (short registry) and `docs/KNOWN_QUIRKS.md` (deep dives). Read the matching entry before changing any of that behaviour.
- Incidents: `docs/incident-log.md` — read the matching entry before changing behaviour an incident touched. Index: agents-reference → Critical incidents.
- Pending work and open handoffs: agents-reference → Pending work; `HANDOFF.md` → open files in `HANDOFF.d/` (read newest-first; never edit another session's file).

## Deployment (short)

Application changes: feature branch → PR to protected `main` → CI → merge. `main` is the release branch. Frontend: merge → publish-frontend.yml → GHCR → Coolify. Edge functions: merge → deploy-supabase.yml. Railway worker: auto on `/apps/worker/**`. Bridge agent: publish-bridge-agent.yml → `:stable` + version bump, NAS applies on request. Windows agent + Helper: GitHub Releases (Helper installers stay unsigned forever). Rollback: older Coolify deployment by `:<sha>` tag. Full runbook incl. stale-site check and SSH policy: `docs/deployment.md`, `SELFHOST.md`.

## Host / server changes — do NOT make them here

<!-- ansible-host-policy: managed rollout from u2giants/ansible -->
The `hetz` server's host/OS layer is managed by **Ansible** in **[`u2giants/ansible`](https://github.com/u2giants/ansible)**.
To change the server (packages, users, firewall, DNS, Docker *engine* config, system cron,
systemd units, Cloudflare Tunnel 1, the backup watchdog), **open a PR there** and let CI apply
it — **never** SSH into the box and hand-edit it. Manual changes are drift and get reverted by
the next apply. See [`u2giants/ansible/AGENTS.md`](https://github.com/u2giants/ansible/blob/main/AGENTS.md).

This repo is **not** the host layer. Its own changes belong here and deploy through their normal
pipeline (e.g. Coolify). Don't put host-level changes here, and don't manage this service's
container with Ansible. Scope boundary: **Ansible owns the host; Coolify owns the apps.**
