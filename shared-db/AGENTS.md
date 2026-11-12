> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`popcre/shared-db`](https://github.com/popcre/shared-db) (formerly `u2giants/shared-db`; moved 2026-09-18, old links redirect) is the **single source of truth**. Its entire contents are mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM/PIM, DesignFlow PLM) on each push to `main`.
>
> **Reading this inside a consumer repo's `shared-db/` folder?** It's a read-only copy — edits here are overwritten on the next sync. Change the canonical repo instead.

---

# AGENTS.md — cross-app coordination playbook

The complete document index is [`docs/INDEX.md`](docs/INDEX.md), generated from document headers. Search it for your topic's keywords (or read it) before opening or searching any other document. Open a document only when its summary matches your task.

This file is a router: it routes, it does not contain. Detail that used to live here is in [`docs/agents/router-detail.md`](docs/agents/router-detail.md) and the §-numbered chapters under `docs/agents/`.

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
Vault withdrawal answers, session wrap-up convention, §1, §2, §3, §7. §5.0-C (run CI and the
review in parallel, batch fixes into one head; its exact-head requirement is superseded) moved
verbatim to [`docs/agents/router-detail.md`](docs/agents/router-detail.md#50-c-run-ci-and-the-governed-review-in-parallel-and-batch-fixes-into-one-head-issue-3002-added-2026-09-20).

## Repository structure

Project-owned: `supabase/migrations/` (never edit an applied one), `supabase/tests/`,
`supabase/ci-bootstrap/`, `scripts/` + `scripts/lib/`, `tools/`, `config/`, `docs/`, `.github/workflows/`.
Generated: `types/database.types.ts` only (never hand-edit). No vendored third-party code, no
`package.json`, no application runtime; Node scripts run directly (`node scripts/...`).
`docs/agents/` = verbatim rulebook chapters, `docs/business-rules/` = companywide rule library,
`docs/verification/` = evidence, `docs/archive/` = history. Root `plan_*.md` / `fix_*.md` are historical
records unless a current doc or issue names one. Full path-by-path table:
[`docs/agents/router-detail.md`](docs/agents/router-detail.md#repository-structure).

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

The full table (shape change, API contract, CI and gates, claim mechanics, business meaning, operating
rules, tools, type regeneration, handoff) is in
[`docs/agents/router-detail.md`](docs/agents/router-detail.md#task-to-file-navigation-what-to-edit-for-common-changes).
The rules that prevent damage:

- Database shape: a **new** `supabase/migrations/<timestamp>_<name>.sql` only — never a migration already on a ledger, never ad-hoc SQL against production.
- Operating rules: change `AGENTS.md` and the matching `docs/agents/` chapter **together**; do not contradict `scripts/check-*.mjs` guards.
- Business meaning: the `docs/business-rules/` topic file, never a competing copy in an app repo.
- Types: regenerate through the generate-database-types workflow; never hand-edit `types/database.types.ts`.
- Handoff: your own new `HANDOFF.d/<UTC>-<machine>-<agent>-<slug>.md`; never rewrite `HANDOFF.md` or another session's file.
- A new document: give it the four-key header (`summary`, `kind`, `status`, `read-when`), then run `ai-doc-health --repo . --fix-index`; never hand-edit `docs/INDEX.md`.

## Data model and external identifiers

Production project ref, preview/sandbox identity, migration version format, curated Master Data
tables, property-code uniqueness `(licensor_id, code)`, app-owned schemas, PostgREST exposed schemas
(`dam` is intentionally not exposed), the generated types contract and the consumer sync destination
are tabled in [`docs/agents/router-detail.md`](docs/agents/router-detail.md#data-model-and-external-identifiers).
Never rename, regenerate or replace a documented identifier casually. Read `PREVIEW_PROJECT_REF`
from the repository variable; never write a preview ref down.

## Container and service inventory

This repository runs no application containers. The external services (Supabase production,
Supabase preview branch, GitHub Actions, consumer app hosts) are tabled in
[`docs/agents/router-detail.md`](docs/agents/router-detail.md#container-and-service-inventory).

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

Never commit anon keys, service-role keys, database passwords, or `.env` files. Secret values live
only in 1Password vault `vibe_coding`; fetch items serially. Do not embed new project refs or other
stable infrastructure identifiers in committed evidence — consumer mirrors enforce a public boundary
against them (§8, #4910). The variable table (names only: Supabase token and DB passwords, project
refs, `SHARED_DB_AUTHOR_ENGINE`, `SHARED_DB_SESSION_ID`, test and GitHub tokens) is in
[`docs/agents/router-detail.md`](docs/agents/router-detail.md#credentials-and-environment); CLI and
credential traps are in [`docs/agents/runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md).

## Deployment

There is no application deploy from this repo. What "shipping" means here:

1. **Branch + PR + merge through the `main` merge queue** into `main` — plain
   `gh pr merge` enqueues the PR and the queue lands it when green. Never
   `--admin` or `--squash`: the queue refuses them ("Changes must be made
   through the merge queue"). This supersedes the older prose-merge teaching
   `gh pr merge --squash --admin` (see [`docs/agents/merge-protocol.md`](docs/agents/merge-protocol.md) §5).
2. **`sync.yml` mirrors the entire tree** into each consumer repo's `shared-db/` folder on push to `main`.
3. **Database shape** is applied via the Supabase migration lane: preview rehearsal first, then the bounded production apply workflow (`shared-supabase-migrations.yml` / production apply evidence), never by hand-editing production.
4. **Rollback** of schema is a new forward migration; rollback of a bad `main` commit is revert + merge. There is no SSH deploy path and no container tag.

Details: [`docs/deployment.md`](docs/deployment.md).

## Critical incidents

Full write-ups: [`docs/agents/router-detail.md`](docs/agents/router-detail.md#critical-incidents)
and [`docs/incidents/`](docs/incidents/). The standing lessons, already encoded as rules:

- **2026-07-17 DesignFlow production DB port** — postmortem is authoritative; do not reopen from memory.
- **2026-07-31 four-way migration collision** — duplicate 14-digit versions silently skip; never spawn
  background task chips here; reserve versions through the lane tool (standing facts 4–5).
- **2026-08-11 production apply pin refused two runs** — freeze merges before every production apply
  (standing fact 14).

If there is no known incident for a new area, say so explicitly in the change that introduces risk;
do not invent history.

## Intentional quirks and non-obvious decisions

Each is explained in full (looks like / actually / why / do not change because) in
[`docs/agents/router-detail.md`](docs/agents/router-detail.md#intentional-quirks-and-non-obvious-decisions).
Do not "fix" any of these:

- `AGENTS.md` is a router; §-numbered chapters live verbatim in `docs/agents/` and section numbers never change.
- Rulebook files (`AGENTS.md`, `CLAUDE.md`, `skills/`) are not "documents-only" changes.
- Migration history is not a clean replay (about 170 intentional empty markers; use `supabase/ci-bootstrap/` for CI).
- Preview and production have diverged in both directions; a passing preview is not production proof.
- `dam` is deliberately absent from the PostgREST schemas.
- Property codes are unique only per licensor: `(licensor_id, code)`.
- The Supabase MCP may be bound to **production**; call `get_project_url` first.

## Pending work

Open work lives in **GitHub Issues** and open `HANDOFF.d/` files, not here.

| Status | Item | Owner/next action |
|---|---|---|
| open | See `gh issue list --repo popcre/shared-db --label db-work` | Claim-first per issue `db-work-scope` |
| open | `HANDOFF.d/` files with a contract still pointing at an open issue | Owning session / successor |

Re-derive state from `git` and `gh`. A heading in a markdown file is not a backlog.

## Current operating route

Author-lane and reviewer-assignment commands were retired by #5409. The
surviving lock, promotion and recovery CLI is
`scripts/manage-migration-coordination.mjs` (#5426). Older claim-first command
examples are historical; do not reintroduce those commands. Historical contract
identifiers resolve to preserved evidence storage as documented in
[`docs/contract-ref-retirement.md`](docs/contract-ref-retirement.md).

- [current-workflow.md](docs/agents/current-workflow.md)
- [plan_shared_db_workflow_refactor.md](plan_shared_db_workflow_refactor.md)
- [plan_shared_release_hold_reduction.md](plan_shared_release_hold_reduction.md)
- [plan_narrow_promotion_freezes.md](plan_narrow_promotion_freezes.md)
- [plan_rls_request_constant_checks.md](plan_rls_request_constant_checks.md)
- [plan_go-live-lane-prevention.md](plan_go-live-lane-prevention.md) (read its STATUS table first — do not re-derive or re-plan; issue #5782)

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

Settled in [`docs/business-rules/licensing-master-data.md`](docs/business-rules/licensing-master-data.md)
("Disney DCP Vault artwork withdrawal signals", 2026-09-25, issue #3347) — the question is not open.
For any later relayed statement about Disney/DCP Vault artwork withdrawal, read
[`docs/disney-dcp-withdrawal-answer-routing.md`](docs/disney-dcp-withdrawal-answer-routing.md) first.
Never contact anyone on Albert's behalf. Original wording:
[`docs/agents/router-detail.md`](docs/agents/router-detail.md#disney-dcp-vault-withdrawal-answers).

## How this file is organized (issue #3481)

### The owner rulings, one line each

Full text, with the owner's verbatim words and the tooling consequences, is in
[`docs/agents/router-detail.md`](docs/agents/router-detail.md#the-owner-rulings-one-line-each-full-text-in-the-linked-file)
and [`docs/agents/owner-rulings.md`](docs/agents/owner-rulings.md). They bind exactly as before.

- **Review is advisory, never a merge gate (Albert Hazan, 2026-10-29).** No PR here waits for or needs
  an AI verdict. Lease, migration ordering, collision checks, tests, preview rehearsal and production
  owner authorization still bind.
- **Never ask a human to approve (2026-09-28).** The AI performs every manual step itself (§1 below).
- **Albert is not a technical reviewer (2026-09-30).** Production risk classes are accepted by the
  automatic promotion workflow, never by Albert ([`owner-rulings.md` §6.23](docs/owner-rulings.md)).
- **The signed contract places OPA Properties under Disney, Marvel or Star Wars — never re-ask Albert (2026-08-31, reaffirmed 2026-11-12)** ([`owner-rulings.md` §6.36](docs/owner-rulings.md)).
- **One independent review is enough (2026-10-14)** ([`owner-rulings.md` §6.27](docs/owner-rulings.md)).
- **§0.0-D — there is no orchestrator; structural work is claim-first (2026-10-02).** A session needing
  a SHAPE change claims the exact objects on the existing issue and does the change itself. Declare
  `SHARED_DB_AUTHOR_ENGINE` and `SHARED_DB_SESSION_ID`. Older "orchestrator", marker and dispatch
  text is historical; this ruling supersedes it everywhere.
- **§0.0-B — STRUCTURE, not DATA (2026-08-13).** This repo governs the database's shape; contents
  belong to the application session that owns the data. Curated Master Data stays gated.
- **§0.0-A — read-only inspection is open (2026-08-10)** to every application repo, with no issue.
- **§0.0-C — structural work gets the minimum (2026-08-21, #1366).** An eligible additive change wholly
  inside `{crm, pim, dam, plm}` may use `route: self-service-additive`
  ([`ephemeral-route-hop-table.md`](docs/agents/ephemeral-route-hop-table.md)).
- **§2.1-W — worktree-only.** Every session works in its own `git worktree` cut from `origin/main`
  ([`worktrees-and-handoffs.md`](docs/agents/worktrees-and-handoffs.md)).

## Session wrap-up convention

When the user says **"wrap up"**, that means finish the session safely: update
the relevant Markdown docs with durable knowledge from the work, run required
checks, complete branch/PR/merge/apply steps, verify 1Password coverage for any
secrets encountered, and leave the repo handoff-safe. For this repo, do not leave
untracked migrations or docs behind; either finish the shared-db branch + PR +
merge workflow or write an explicit handoff with the next exact action.

## 1. The owner is not a programmer

The owner directs the work and judges results; he does not review code, manage branches, or merge.

- **The AI owns all git mechanics**: branch, commit, PR and merge in the same piece of work, once safe (§5). Never leave an open PR for the owner.
- **The owner reviews behavior, not code.** Translate "the dropdown is empty" into changes yourself.
- **Never ask a human to approve (owner ruling 2026-09-28).** Make anything hard to undo recoverable first. AI review is advice only (2026-10-29). Ask Albert only genuine business-meaning questions and report risk in plain English afterwards.

Full text with the owner's verbatim words: [`docs/agents/router-detail.md`](docs/agents/router-detail.md#1-the-owner-is-not-a-programmer).

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

