> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`popcre/shared-db`](https://github.com/popcre/shared-db) (formerly `u2giants/shared-db`; moved 2026-09-18, old links redirect) is the **single source of truth**. Its entire contents are mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM/PIM, DesignFlow PLM) on each push to `main`.
>
> **Reading this inside a consumer repo's `shared-db/` folder?** It's a read-only copy — edits here are overwritten on the next sync. Change the canonical repo instead.

---

# AGENTS.md — cross-app coordination playbook

## Project summary

This repository is the **shape-of-database** source of truth for POP Creations'
shared Supabase project. It holds timestamped migrations, schema/API contracts,
the business-rule library, generation tooling for `types/database.types.ts`,
and the operating rules every AI session must follow when changing shared
structure. CRM, DAM, PM/PIM, and DesignFlow PLM all read the same tables. The
outcome that matters: a schema change lands once, is reviewed and rehearsed, and
does not break a consumer app that another session built months ago.

## Multi-model AI note

There is no universal ignore-file standard across AI coding tools.

`.claudeignore` works for Claude Code.

When using any other AI tool, paste this file as your first message and follow the instructions in the "What to ignore" section.

## Documentation map: what to read for each task

Always start with:

- `AGENTS.md`

Then load additional docs only when relevant:

| Task / question | Read these docs | Usually do not need |
|---|---|---|
| Quick repo orientation | `README.md`, `AGENTS.md` | Deep docs under `docs/` unless the task requires them |
| Current route / policy matrix | `AGENTS.md`, [current-workflow.md](docs/agents/current-workflow.md) | Historical plans |
| Structural / schema change | `AGENTS.md`, [`docs/agents/anti-collision-summary.md`](docs/agents/anti-collision-summary.md), [`docs/agents/merge-protocol.md`](docs/agents/merge-protocol.md), [`docs/agents/worktrees-and-handoffs.md`](docs/agents/worktrees-and-handoffs.md) | Business-rule topics you do not touch |
| Business meaning, permissions, workflows, calculations | [`docs/business-rules/application-map.md`](docs/business-rules/application-map.md) then only the topics involved | Other business-rule files |
| Architecture / entity ownership / data flow | `docs/architecture.md`, [`docs/unified-supabase-schema-map.md`](docs/unified-supabase-schema-map.md) | Deployment docs |
| Local setup, tests, lint, migration authoring | `docs/development.md` | Deployment docs |
| Env vars, config files, project refs, secrets *names* | `docs/configuration.md`, [`docs/agents/runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md) | Architecture docs |
| Deploy, sync to consumer repos, production promotion, rollback | `docs/deployment.md`, [`docs/agents/merge-protocol.md`](docs/agents/merge-protocol.md), [`docs/production-promotion-procedure.md`](docs/production-promotion-procedure.md) | Local dev docs |
| Owner rulings / what belongs in this repo | [`docs/agents/owner-rulings.md`](docs/agents/owner-rulings.md) | Long-form §4/§6 unless the task is that rule |
| In-flight collision check before starting | [`docs/agents/in-flight-check.md`](docs/agents/in-flight-check.md) | Unrelated folder READMEs |
| Continue unfinished work | `HANDOFF.md` (pointer) → open files in `HANDOFF.d/` newest-first by **parsed** timestamp | Docs unrelated to the handoff |
| Investigate an incident / near-miss | `AGENTS.md` Critical incidents, [`docs/incidents/`](docs/incidents/), relevant `docs/verification/` folder | Every verification folder |
| App migration / consumer impact | [`docs/app-migration-notes/`](docs/app-migration-notes/) for that app | Other apps' notes |
| Work in a subfolder with its own README | `AGENTS.md`, that folder README, and only broader docs it names | Other folder READMEs |
| Claude Code session | `CLAUDE.md`, then `AGENTS.md` | Other docs unless the task requires them |
| Documentation-only cleanup | `AGENTS.md`, `README.md`, affected docs under `docs/` | Source files except to verify accuracy |

Rules: this map is task-based; do not load every `.md` file. Historical
`plan_*.md` and `fix_*.md` at the repository root are **records of past work**,
not current instructions — load one only when a current doc or issue names it.
`docs/verification/` is evidence, not policy. `docs/archive/` is history.

### Task router — rulebook sections (when a citation says "AGENTS.md §X")

This file is a router. The full rulebook text moved **verbatim**, with its original headings and
section numbers, into `docs/agents/`. A rule there binds exactly as it did here; nothing was
reworded. Read only the files your task needs. When a document cites "AGENTS.md §X", find §X in
the map below.

| Read this | When | Sections |
|---|---|---|
| [`docs/agents/active-contracts-and-plans.md`](docs/agents/active-contracts-and-plans.md) | Before touching any area with an active plan or contract; historical MG classification | Historical item MG classification; Active contracts and implementation plans |
| [`docs/agents/owner-rulings.md`](docs/agents/owner-rulings.md) | Deciding whether work belongs here; any consumer-repo schema question; data vs structure; secrets ownership; DB Data Admin; grid filters; Scraped Properties; Master Data editing | §0, §0.0-A, §0.0-B, §0.1, §0.1-A, §0.2, §0.3, §0.3-A, §0.4 |
| [`docs/agents/orchestrator.md`](docs/agents/orchestrator.md) | Admission test for structural work and safety reference (orchestrator role retired, §0.0-D; marker/dispatch text historical) | §0.0-C, §11b, §11c, §11d |
| [`docs/agents/worktrees-and-handoffs.md`](docs/agents/worktrees-and-handoffs.md) | Before any edit (worktree setup and retirement); writing or retiring a HANDOFF.d file; host/server boundary | §2.1-W, §2.1-W.1, §2.1-H, §2.1 |
| [`docs/agents/anti-collision-summary.md`](docs/agents/anti-collision-summary.md) | Any database change: the five anti-collision rules, author lanes, extension tables | §4, §4.1, §4.2, §4.3 |
| [`docs/agents/section-4-anti-collision-rules.md`](docs/agents/section-4-anti-collision-rules.md) | The long-form §4 rules and procedures | §4 long form |
| [`docs/agents/merge-protocol.md`](docs/agents/merge-protocol.md) | Opening, reviewing, or merging any PR here; rulebook/guarded-merge lane; production promotion; red checks | §5, §5.0-D, §5.0-E, §5.1, §5.2, §5.2-A, §5.2-B |
| [`docs/agents/in-flight-check.md`](docs/agents/in-flight-check.md) | Before starting a change, to see whether it is already in flight | §6 (long form: [`section-6-in-flight-long-form.md`](docs/agents/section-6-in-flight-long-form.md)) |
| [`docs/agents/references-and-runbooks.md`](docs/agents/references-and-runbooks.md) | Project refs, exposed schemas, Supabase CLI and credentials, further reading, known traps | §8, §8.1, §9, §10, §10.1–10.3 and §11 (full runbook: [`runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md)) |
| [`docs/agents/standing-facts.md`](docs/agents/standing-facts.md) | Starting any session in this repo | §12, §12.1 |

Kept in this file: task declaration, companywide business rules, Disney DCP
Vault withdrawal answers, session wrap-up convention, §1, §2, §3, §5.0-C, §7.

## Repository structure

| Path | Role |
|---|---|
| `supabase/migrations/` | Timestamped SQL migrations (project-owned schema). Never edit one that may already be applied. |
| `supabase/ci-bootstrap/` | Intentional **non-migration** bootstrap for clean-slate CI replay of objects that predate this repo. |
| `supabase/tests/` | SQL contract tests. |
| `scripts/` | Project-owned Node (`.mjs`) and Python (`.py`) gates, lanes, promotion guards, evidence tools. |
| `scripts/lib/` | Shared libraries for those scripts (including `documents-only-change.mjs`, lane packages). |
| `types/database.types.ts` | **Generated** TypeScript contract. Never hand-edit. |
| `config/` | Repository policy JSON (allowlists, risk policy, contracts). |
| `docs/` | Durable documentation. `docs/agents/` holds verbatim rulebook long form. `docs/business-rules/` is the companywide rule library. `docs/verification/` is evidence. `docs/archive/` is history. |
| `docs/agents/` | Verbatim §-numbered rulebook chapters (issue #3481 split). |
| `tools/` | Operational loaders/reconcilers (ColdLion, ClickUp, taxonomy, etc.). |
| `tests/` | Longer acceptance/verification write-ups (not unit tests). |
| `HANDOFF.md`, `HANDOFF.d/` | Static pointer + one write-once file per open session workstream. |
| `plan_*.md`, `fix_*.md` | Historical plans and fix records at repo root. Not current instructions unless named. |
| `.github/workflows/` | CI, guarded merge, promotion, sync-to-consumers, observability. |
| `.github/live-proofs/` | Per-issue live-proof SQL. |
| `node_modules/`, `supabase/.temp/`, `__pycache__/`, `.ai/`, `.claude/` | Local/generated/scratch — do not commit, do not load. |

There is no application runtime in this repository and no `package.json`. Node
scripts are run directly (`node scripts/...`). Generated code is only
`types/database.types.ts`. Third-party code is not vendored here.

## Prime Directive: custom-code boundary

Our custom code lives here:

- `supabase/migrations/`
- `scripts/` and `scripts/lib/`
- `tools/`
- `config/`
- `docs/`
- `.github/workflows/`
- `types/` (generated output only — regenerate, do not hand-edit)

Everything else requires justification before touching.

## Core modification inventory

| File | Change made | Why it was necessary | Risk during upgrades |
|---|---|---|---|
| _(none)_ | This repository does not patch framework, vendor, or OS files. | N/A | N/A |

`types/database.types.ts` is generated and is not a core modification.

## Task-to-file navigation: what to edit for common changes

| Task | Files to touch | Files not to touch |
|---|---|---|
| Change database shape (table/column/view/function/RLS/index) | New `supabase/migrations/<timestamp>_<name>.sql` only | Any migration already on a ledger; consumer-repo schema copies |
| Change shared API contract / browser view | New migration + `docs/architecture.md` / schema map if ownership changes | Ad-hoc SQL against production |
| Change CI, merge, promotion, or task gates | Relevant `.github/workflows/*.yml`, `scripts/` guards + tests | Live production settings except via reviewed workflow |
| Change author-lane / claim / review mechanics | `scripts/manage-migration-author-lanes.mjs`, `scripts/lib/lanes/**`, tests | Bypassing lease, ordering, or production authorization checks |
| Change business meaning / permissions / workflows | `docs/business-rules/` topic file via the business-rules process | Competing copies inside app repos |
| Change operating rules / owner rulings | `AGENTS.md` and the matching `docs/agents/` chapter **together** | Silent edits that contradict `scripts/check-*.mjs` guards |
| Add or change a tool/loader | `tools/**` + its `*.test.mjs` | Hand-built Windows direct-invocation guards without testing |
| Regenerate database types | Generate-database-types workflow / path in `docs/development.md` | Hand-editing `types/database.types.ts` |
| Session handoff | Your own new `HANDOFF.d/<UTC>-<machine>-<agent>-<slug>.md` | Rewriting `HANDOFF.md`; another session's `HANDOFF.d/` file |

## Data model and external identifiers

| Entity/System | Identifier | Where defined | Notes |
|---|---|---|---|
| Supabase production project | `qsllyeztdwjgirsysgai` | Supabase / runbook §8 | Do not write a preview ref down; read `PREVIEW_PROJECT_REF` |
| Preview project | repository variable `PREVIEW_PROJECT_REF` | GitHub Actions repo variable | Historical literals are not authority |
| Sandbox / DesignFlow migration project | `xupnyeifmpsacrqahwwm` | workflow constants | Verify in the invoking workflow before use |
| Migration versions | 14-digit UTC timestamp `YYYYMMDDHHMMSS` | `supabase/migrations/` filenames | Duplicate versions silently skip; reserve via lane tool |
| Curated Master Data | `core.licensor`, `core.property`, `core.character`, `core.customer`, `core.factory` (+ `*_ext`) | migrations / business rules | Outside-sourced bulk load stays gated |
| Property code uniqueness | `(licensor_id, code)` | `supabase/migrations/20260621150815_app_core.sql` | Licensor codes are globally unique; property codes are **not** |
| App-owned boundary schemas | `{crm, pim, dam, plm}` | `scripts/check-self-service-additive-lane.mjs` | Self-service additive lane boundary (owner ruling 2026-09-25) |
| PostgREST exposed schemas | `public, graphql_public, api, crm, pim, core, app` | runbook §8.1 | `dam` is intentionally **not** exposed |
| Generated TS contract | `types/database.types.ts` | generate-database-types workflow | Mirrored to consumers as `shared-db/types/database.types.ts` |
| Consumer sync destination | `shared-db/` folder in each consumer repo | `.github/workflows/sync.yml` | Entire tree mirrored on push to `main` |
| DB Data Admin hostname | `https://data.designflow.app` | [`docs/db-data-admin-domain-ownership.md`](docs/db-data-admin-domain-ownership.md) | App lives in `u2giants/popdam3` `apps/db-data-admin/` |

## Container and service inventory

This repository does not run application containers. Runtime services are
external:

| Container/service | Purpose | Managed by | App/project ID | Image/source |
|---|---|---|---|---|
| Supabase production | Shared Postgres + PostgREST + Auth for all apps | Supabase | `qsllyeztdwjgirsysgai` | Hosted Supabase |
| Supabase preview branch | Rehearsal / preview apply target | Supabase branches | `PREVIEW_PROJECT_REF` (repo variable) | Hosted Supabase |
| GitHub Actions | CI, guarded merge, promotion, sync | GitHub | `popcre/shared-db` | Workflow YAML in `.github/workflows/` |
| Consumer app hosts (Coolify/Cloud Build, etc.) | Deploy the apps, not this repo | Each app repo | See each app's docs | Out of scope here |

## What to ignore

Do not load these into context (also reflected in `.claudeignore` / `.cursorignore` and `.gitignore`):

- `node_modules/`
- `supabase/.temp/`
- `__pycache__/`, `*.pyc`, `.pytest_cache/`
- `.ai/`, `.ai-review/`, `.ai-review*.txt` (scratch and review packets; a short named allowlist of committed reviews is intentional — see `.gitignore`)
- `.claude/`, `.playwright-mcp/`, `.agents/`, `.mimocode/`
- `tmp/`, `outputs/`
- `docs/verification/**` evidence bulk (load only the folder an issue names)
- `docs/archive/`
- Root `plan_*.md` / `fix_*.md` unless a current doc or issue names the file
- Generated local CSV/XLSX audit artifacts listed in `.gitignore`

## Credentials and environment

| Variable | Purpose | Stored where | Required in dev | Required in prod |
|---|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI login | 1Password `vibe_coding` | for CLI | for CI where configured |
| `PROD_DB_PASSWORD` / production DB password | `supabase link` to production | 1Password `vibe_coding` | for prod link | yes |
| `PREVIEW_DB_PASSWORD` | `supabase link` to preview | 1Password preview item (address by item ID) | for preview work | n/a |
| `PREVIEW_PROJECT_REF` | Preview target identity | GitHub repository variable | when previewing | workflows |
| `PRODUCTION_PROJECT_REF` / `qsllyeztdwjgirsysgai` | Production target identity | this document / runbook | when promoting | yes |
| `SHARED_DB_TEST_TOKEN` | Post-batch app verification | workflow secret | n/a | when verification runs |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API from Actions or `gh` | Actions / user auth | for PR automation | for CI |
| `SHARED_DB_AUTHOR_ENGINE` | Authoring engine id for reviewer exclusion | set by the session | structural sessions | n/a |
| `SHARED_DB_SESSION_ID` | Claim-first session authority | set by the session | preview prep / abandonment | n/a |
| `ANTHROPIC_API_KEY` | Advisory model review in production apply | **not configured** — step is a silent no-op (standing fact 12) | n/a | n/a |

Never commit anon keys, service-role keys, database passwords, or `.env` files.
Secret values live only in 1Password vault `vibe_coding`. Fetch items serially.
Full CLI/credential traps: [`docs/agents/runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md).

## Deployment

There is no application deploy from this repo. What "shipping" means here:

1. **Branch + PR + guarded merge** into `main` (see [`docs/agents/merge-protocol.md`](docs/agents/merge-protocol.md)).
2. **`sync.yml` mirrors the entire tree** into each consumer repo's `shared-db/` folder on push to `main`.
3. **Database shape** is applied via the Supabase migration lane: preview rehearsal first, then the bounded production apply workflow (`shared-supabase-migrations.yml` / production apply evidence), never by hand-editing production.
4. **Rollback** of schema is a new forward migration; rollback of a bad `main` commit is revert + merge. There is no SSH deploy path and no container tag.

Details: [`docs/deployment.md`](docs/deployment.md).

## Critical incidents

Known disasters and near-misses are recorded under [`docs/incidents/`](docs/incidents/) and in the §-numbered rulebook chapters. Standing lessons already encoded as rules:

### [2026-07-17] DesignFlow production DB port

What happened: production DB port exposure / incorrect environment contract.

Impact: production risk; remediation and evidence in
[`docs/incidents/20260717-designflow-production-db-port.md`](docs/incidents/20260717-designflow-production-db-port.md).

Root cause / recovery / rule: see that postmortem. Do not reopen the issue from
memory; the document is authoritative.

### [2026-07-31] Four-way migration collision (duplicate versions)

What happened: competing `CREATE OR REPLACE` migrations shared version
`20260731170000`; duplicate 14-digit versions **silently skip**.

Impact: one migration applies, the other is ignored with no error.

Root cause: parallel chip-spawned sessions without claims/reservation.

Recovery: fix forward; CI now blocks duplicate and backdated versions.

Rule added: never spawn background task chips here; reserve versions through
`scripts/manage-migration-author-lanes.mjs --claim` (standing facts 4–5).

### [2026-08-11] Production apply pin refused two approved runs

What happened: PRs merged between staging and the owner's click; the
`origin/main` SHA pin refused the apply.

Impact: two owner approvals wasted; nothing was written.

Root cause: no merge freeze around the apply window.

Recovery: third run landed under a deliberate freeze.

Rule added: freeze merges before every production apply (standing fact 14).

If there is no known incident for a new area, say so explicitly in the change
that introduces risk; do not invent history.

## Intentional quirks and non-obvious decisions

### AGENTS.md is a router, not the full rulebook

Looks like:
A new session might expect every rule in this file, or might load every `docs/` file to find §X.

Actually:
Issue #3481 moved §-numbered chapters **verbatim** into `docs/agents/`. Citations of "AGENTS.md §X" resolve there. Section numbers never change.

Why:
This file is loaded in full at session start; it was cut from 234 KB to a router so sessions are not forced to ingest the whole history.

Do not change because:
CI and `scripts/production_migration_guard.py` cite those section numbers; renumbering breaks them. Where wording differs, `AGENTS.md` wins.

### Rulebook files are not "documents-only"

Looks like:
A PR that only touches `AGENTS.md`, `CLAUDE.md`, `skills/`, or `plan_*.md` looks like a docs PR.

Actually:
`scripts/lib/documents-only-change.mjs` excludes those paths. They get full engineering treatment (branch, checks; review is advisory since 2026-10-29).

Why:
Agent instructions change behavior. Treating them as prose would skip the review that keeps instructions from drifting from enforcement.

Do not change because:
The documents-only merge lane depends on this classification.

### Migration history is not a clean replay

Looks like:
Someone tries to apply every migration to an empty database and expects success.

Actually:
About 170 files are intentional empty markers aligning the ledger with objects created before this repo was canonical. Clean-slate replay is unsupported; use `supabase/ci-bootstrap/` for CI.

Why:
Adoption-on-populated-database. A file inserted at the front of an applied sequence can never re-run.

Do not change because:
"Fixing" the empty markers would rewrite history and break ledgers (standing fact 13, §10.1).

### Preview and production have diverged in both directions

Looks like:
"Preview is production plus/minus N migrations."

Actually:
Verified object-by-object they diverge both ways (standing fact 11). A passing preview means "worked on preview", not "will work in production".

Why:
Independent apply histories and a production-only canary.

Do not change because:
Post-apply verification against production is mandatory; assuming parity is how sessions get misled.

### `dam` is not in PostgREST schemas

Looks like:
A missing `dam` schema in `pgrst.db_schemas` is a bug to fix.

Actually:
It is deliberate. Workers reach `dam.*` via `public` `SECURITY DEFINER` functions.

Why:
Broader exposure would require RLS on every `dam` table and widen the shared API (§8.1).

Do not change because:
Adding `dam` to `pgrst.db_schemas` is a security surface change, not a fix.

### Property codes are not globally unique

Looks like:
Resolve property by `code` alone.

Actually:
Unique is `(licensor_id, code)`. Licensor codes are global; property codes repeat across licensors (standing fact 9).

Why:
Parent-child licensor→property model confirmed by the owner 2026-08-06.

Do not change because:
Code-only resolution produces nonsense re-parenting instructions.

### Supabase MCP may be bound to production

Looks like:
An MCP tool call is aimed at preview.

Actually:
The Supabase MCP server takes no project parameter and may be bound to **production**. Call `get_project_url` first (standing fact 6).

Why:
Hosted tool configuration.

Do not change because:
A wrong-target MCP write is a production write.

## Pending work

Open work lives in **GitHub Issues** and open `HANDOFF.d/` files, not here.

| Status | Item | Owner/next action |
|---|---|---|
| open | See `gh issue list --repo popcre/shared-db --label db-work` | Claim-first per issue `db-work-scope` |
| open | `HANDOFF.d/` files with a contract still pointing at an open issue | Owning session / successor |
| done | Five uncited closed-issue `HANDOFF.d/` files retired 2026-10-15 (owner-authorized; all #2336: `…licensing-forward-repair`, `…ten-issues-recovery`, `…eight-issues-acceptance`, `…eight-issues-preview-recovery`, `…2336-production-live-proof`) | Retire any new ones in a PR that names each file (see Handoff report; never delete silently) |
| done | Docs overhaul of AGENTS.md router + required topic docs (this change) | Completed in the docs-overhaul PR |

Re-derive state from `git` and `gh`. A heading in a markdown file is not a backlog.

## Current operating route

- [current-workflow.md](docs/agents/current-workflow.md)
- [plan_shared_db_workflow_refactor.md](plan_shared_db_workflow_refactor.md)
- [plan_shared_release_hold_reduction.md](plan_shared_release_hold_reduction.md)
- [plan_narrow_promotion_freezes.md](plan_narrow_promotion_freezes.md)
- [plan_rls_request_constant_checks.md](plan_rls_request_constant_checks.md)

## Task declaration

Before starting work, run `ai-task-gates start --class <class>` from the
installed [`popcre/ai-devops` toolkit](https://github.com/popcre/ai-devops/blob/main/docs/deployment.md).
If the command is absent, stop and use that supported installation route; do
not copy or bypass the gate. The command rechecks the real change set before
review, waiting, shipping, or deployment. If scope reaches a protected class,
redeclare at that class and satisfy its proofs because acknowledgement or
owner-request flags cannot bypass it.

- [plan_reviewer_assignment_hold_reduction.md](plan_reviewer_assignment_hold_reduction.md)

## Companywide business rules

Business logic is organized by business topic, not by application. Before
changing behavior, definitions, permissions, workflows, calculations, or source
authority, start at
[`docs/business-rules/application-map.md`](docs/business-rules/application-map.md)
and load only the topics the task touches. Application repos may link to these
rules but must not maintain competing copies. The collection, status, correction,
and dissemination process is
[`docs/business-rules/README.md`](docs/business-rules/README.md).

## Historical item merchandise-group classification

Before interpreting `full_item_master.csv`, changing item-description parsing, or reporting historical MG match counts, read [`docs/agents/active-contracts-and-plans.md`](docs/agents/active-contracts-and-plans.md) first; it carries this section in full.

## Disney DCP Vault withdrawal answers

The withdrawal-confirmation question is **settled** in [`docs/business-rules/licensing-master-data.md`](docs/business-rules/licensing-master-data.md) under "Disney DCP Vault artwork withdrawal signals" (recorded 2026-09-25, provenance on issue #3347). Read that rule before answering or acting on it — the question is not open. If anyone relays a later statement about Disney/DCP Vault artwork withdrawal, removal status or missing artwork — including an ambiguous one, or one from an unnamed or non-Laura/Ilona speaker — read [`docs/disney-dcp-withdrawal-answer-routing.md`](docs/disney-dcp-withdrawal-answer-routing.md) first: record the sanitized answer and its provenance at the durable issue named there, apply it only to the behavior it actually settles, and classify any follow-up from its own scope. Never contact anyone on Albert's behalf.

## How this file is organized (issue #3481)

### The owner rulings, one line each (full text in the linked file)

- **Review is advisory, never a merge gate (Albert Hazan, 2026-10-29, verbatim: "this past week
  where i didn't have to deal with reviewer errors was the first time in 10 months where things
  actually got done ... you need to find a way to cut more reviewer 'fat'.").** No PR here, migrations
  included, waits for or needs an AI verdict to merge. Lease, migration ordering, collision checks,
  tests, preview rehearsal and production owner authorization still bind. Supersedes the review
  parts of the three rulings below. Full text: [`docs/agents/owner-rulings.md`](docs/agents/owner-rulings.md).
- **Never ask a human to approve (Albert Hazan, 2026-09-28).** The AI performs every manual
  step itself. AI review is advice only (2026-10-29). Full text: §1 below.
- **Albert is not a technical reviewer, now or in the future (Albert Hazan, 2026-09-30).**
  Production risk classes are accepted by the automatic promotion workflow (plan_skinny-review
  rule 8.6: preview rehearsal, tests, no open review-finding issue), never by Albert. Full text: [`owner-rulings.md` §6.23](docs/owner-rulings.md).
- **One independent review is enough for every change (Albert Hazan, 2026-10-14, verbatim:
  "change the rules so that we don't need 2 reviews").** The two-slot migration minimum is
  retired. Full text: [`owner-rulings.md` §6.27](docs/owner-rulings.md).

- **§0.0-D — there is no orchestrator; structural work is claim-first (Albert Hazan,
  2026-10-02, verbatim: "there is no longer an orchestrator").** No session is the orchestrator.
  Never route work to one, open a HANDOVER issue and stop, resolve or open a marker, wait for
  dispatch, or label tickets orchestrator / non-orchestrator. A session needing a SHAPE change
  claims the exact objects on the existing issue and starts, doing the change itself: own
  worktree and branch, migration version via the lane tool, pull request, the assigned AI
  and proof of the target before every write. Every
  safety rule (exact-object claims, version reservation, guarded merge, serial
  production lane, live proof) still binds. Where older text below says "the orchestrator",
  read "the session doing the structural work"; marker and dispatch steps are historical.
  Tooling follows (#3874): new structural issues use `route: claim-first`
  (`route: shared-db-orchestrator` is still accepted as a legacy alias); reviewer assignment no
  longer reads the marker, and the authoring session declares its engine in
  `SHARED_DB_AUTHOR_ENGINE` (required — unset or unknown refuses) so a same-engine reviewer is
  excluded; the orchestrator / non-orchestrator issue labeler is removed. The marker guard, the
  marker resolver and `orchestrator-admission.mjs` are deleted; preview preparation, abandonment
  action and operator adoption now require claim-first session authority: the acting session
  declares `SHARED_DB_SESSION_ID` (fail closed when unset or malformed); preview preparation on a
  named claim also requires that claim to be leased to that session. Abandonment and adoption act
  on another session's claim and keep their own evidence gates.
  **This ruling supersedes every older passage in this repo that says otherwise** (dated docs,
  plans, handoffs, runbooks): such passages are historical records, not instructions.

- **§0.0-B — STRUCTURE, not DATA (Albert Hazan, 2026-08-13).** This repo governs the *shape* of the database (schema, tables, columns, views, functions, triggers, RLS,
  grants, indexes, constraints, migrations). Changing the *contents* is done by the application
  session that owns the data. The one carve-out: curated Master Data stays gated. The test: *am I
  changing the shape of the database, or the contents of it?*
  [`owner-rulings.md`](docs/agents/owner-rulings.md)
- **§0.0-A — read-only inspection is open (Albert Hazan, 2026-08-10).** Every application repo may
  inspect this database read-only, with no issue, no handoff, and no dispatch.
  [`owner-rulings.md`](docs/agents/owner-rulings.md)
- **§0.0-C — structural work gets the minimum (owner ruling 2026-08-21, #1366; orchestrator role retired by §0.0-D).** The
  structural lane keeps only work that changes the database's SHAPE (plus curated Master Data
  routing). Repository maintenance, proofs, documentation, tooling, and monitoring are not
  structural-lane jobs. [`orchestrator.md`](docs/agents/orchestrator.md)
  An eligible additive change wholly inside `{crm, pim, dam, plm}` may use
  `route: self-service-additive` instead of the ordinary claim-first path; the boundary is enforced at
  merge time by `check-self-service-additive-lane.mjs` (see
  [`ephemeral-route-hop-table.md`](docs/agents/ephemeral-route-hop-table.md)).
- **§2.1-W — worktree-only.** Every session works in its own
  `git worktree` cut from `origin/main`. The shared checkout is for reading and `git fetch` only.
  [`worktrees-and-handoffs.md`](docs/agents/worktrees-and-handoffs.md)

## Session wrap-up convention

When the user says **"wrap up"**, that means finish the session safely: update
the relevant Markdown docs with durable knowledge from the work, run required
checks, complete branch/PR/merge/apply steps, verify 1Password coverage for any
secrets encountered, and leave the repo handoff-safe. For this repo, do not leave
untracked migrations or docs behind; either finish the shared-db branch + PR +
merge workflow or write an explicit handoff with the next exact action.

## 1. The owner is not a programmer

The repository owner directs the work and judges results, but does **not** review
code, manage branches, or merge pull requests. Therefore:

- **The AI owns all git mechanics.** Branches, commits, pull requests, and merges
  are the AI's job from start to finish. Never leave an open PR for the owner to
  deal with — open it *and* merge it within the same piece of work, once it is
  safe (see §5).
- **The owner reviews behavior, not code.** Their feedback is "the board doesn't
  load," "the dropdown is empty." Translate that into changes yourself.
- **Never ask a human to approve (owner ruling 2026-09-28, Albert Hazan,
  verbatim: "never ask a human to approve. as i have said at least 1000 times,
  i am a solo vibe coder with no technical knowledge. ai has to do everything
  for me without asking me to do manual things. institute that.").** Before
  anything hard to undo (dropping a column, applying to production, deleting
  data), make it recoverable first. AI review is advice only and never a gate
  (owner rulings 2026-10-29). The AI performs every manual
  step itself (access, tooling, keys). Ask Albert only genuine business-meaning
  questions, and report risk in plain English afterwards.

## 2. Two workflows — choose by where you are working

| Where | Workflow | Why |
|---|---|---|
| **Non-DesignFlow app repo** (`poppim-web`, `popcrm-web`, `popdam-web`) | Commit straight to **`main`. No branches.** Build must pass, then push; CI deploys. | One app, one owner, a deploy you can watch. Branches add ceremony with no safety gain. Fix-forward or revert on `main`. |
| **DesignFlow app repo** (`popcre/designflow-*`) | Work on **`sandbox-albert`**, push, and open/update a PR to **`develop`**. Do not merge it yourself. | DesignFlow work is reviewed by Uma. Keep schema changes out of these repos; use `shared-db` first. |
| **This repo** (`shared-db`) | **Branch + PR, and the AI merges it** once the §5 checklist passes. | All apps read these tables. A bad change breaks everyone at once. The PR is a safety checkpoint and an undo button — not paperwork for the owner. |


## 3. Why `shared-db` is the dangerous one

Every app reads and writes the **same tables in the same Supabase project**. A
single schema change here can break an app that a different session built months
ago. The database has no "just this app" — it is always shared. That is why the
four rules below are non-negotiable for any database change.


## 7. When two apps need conflicting database changes

Serialize, do not parallelize. Land one change, let it sync, test it, then start
the next. Where possible, prefer one **additive** change that satisfies both apps
rather than two competing edits. If they genuinely conflict, explain the trade-off
to the owner in plain English and let them choose order.


## Running pull-request waits (kept in this file)

### 5.0-C Run CI and the governed review in PARALLEL, and batch fixes into ONE head (issue #3002, added 2026-09-20)

Observed 2026-09-15 on PRs #2980 and #2981: sessions waited for a full green CI
run before requesting the governed review that must approve the merge, then
pushed once per review finding, rerunning the whole matrix each time (the Windows
jobs alone are ~30 minutes). That roughly doubles wall-clock per pull request.
The cause is structural, not carelessness: review evidence binds to the exact
head SHA, so any fix pushed after a review voids that review, and sessions learn
to "spend" only one review.

**The rule, from now on:**

1. **Start the governed review as soon as a head is pushed, in parallel with
   CI.** Do not wait for a green matrix first. Accept that a required fix costs
   one re-review — that is cheaper than serialising two long waits, and a
   re-review is exactly what the exact-head rule is for.
2. **Batch fixes into a single new head.** Collect every finding from the review
   round *and* every CI failure, fix them together, and push once. One push per
   finding is forbidden: each one reruns the full matrix and voids the review
   again.
3. **Hold the wait inside the turn.** Watch both with the repository's bounded,
   event-aware waiter, concurrently. Never end a turn to report that something
   is still running.

**Superseded (owner rulings 2026-10-29, 2026-10-29 night, 2026-10-30 #2172):** no exact-head
APPROVE is required anywhere; `scripts/check-exact-head-approval.mjs` and
`check-review-parallelism-brief.mjs` are deleted. The one advisory CI review runs once per PR;
its findings become `review-finding` issues, which hold only automatic production promotion.
