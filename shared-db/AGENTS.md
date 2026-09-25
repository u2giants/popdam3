> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`popcre/shared-db`](https://github.com/popcre/shared-db) (formerly `u2giants/shared-db`; moved 2026-09-18, old links redirect) is the **single source of truth**. Its entire contents are mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM/PIM, DesignFlow PLM) on each push to `main`.
>
> **Reading this inside a consumer repo's `shared-db/` folder?** It's a read-only copy — edits here are overwritten on the next sync. Change the canonical repo instead.

---

# AGENTS.md — cross-app coordination playbook

## Current operating route

- [current-workflow.md](docs/agents/current-workflow.md)
- [plan_shared_db_workflow_refactor.md](plan_shared_db_workflow_refactor.md)

## Task declaration

Before starting work, run `ai-task-gates start --class <class>` from the
installed [`popcre/ai-devops` toolkit](https://github.com/popcre/ai-devops/blob/main/docs/deployment.md).
If the command is absent, stop and use that supported installation route; do
not copy or bypass the gate. The command rechecks the real change set before
review, waiting, shipping, or deployment. If scope reaches a protected class,
redeclare at that class and satisfy its proofs because acknowledgement or
owner-request flags cannot bypass it.

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

## How this file is organized (issue #3481)

This file is a router. The full rulebook text moved **verbatim**, with its original headings and
section numbers, into `docs/agents/`. A rule there binds exactly as it did here; nothing was
reworded. Read only the files your task needs. When a document cites "AGENTS.md §X", find §X in
the map below.

### The owner rulings, one line each (full text in the linked file)

- **§0.0-B — STRUCTURE, not DATA (Albert Hazan, 2026-08-13).** This repo and its orchestrator
  govern the *shape* of the database (schema, tables, columns, views, functions, triggers, RLS,
  grants, indexes, constraints, migrations). Changing the *contents* is done by the application
  session that owns the data. The one carve-out: curated Master Data stays gated. The test: *am I
  changing the shape of the database, or the contents of it?*
  [`owner-rulings.md`](docs/agents/owner-rulings.md)
- **§0.0-A — read-only inspection is open (Albert Hazan, 2026-08-10).** Every application repo may
  inspect this database read-only, with no issue, no handoff, and no dispatch.
  [`owner-rulings.md`](docs/agents/owner-rulings.md)
- **§0.0-C — the orchestrator gets the minimum (owner ruling 2026-08-21, #1366).** The
  orchestrator keeps only work that changes the database's SHAPE (plus curated Master Data
  routing). Repository maintenance, proofs, documentation, tooling, and monitoring are not
  orchestrator jobs. [`orchestrator.md`](docs/agents/orchestrator.md)
- **§2.1-W — worktree-only.** Every session, the orchestrator included, works in its own
  `git worktree` cut from `origin/main`. The shared checkout is for reading and `git fetch` only.
  [`worktrees-and-handoffs.md`](docs/agents/worktrees-and-handoffs.md)

### Task router — where each section lives and when to read it

| Read this | When | Sections |
|---|---|---|
| [`docs/agents/active-contracts-and-plans.md`](docs/agents/active-contracts-and-plans.md) | Before touching any area with an active plan or contract; historical MG classification | Historical item MG classification; Active contracts and implementation plans |
| [`docs/agents/owner-rulings.md`](docs/agents/owner-rulings.md) | Deciding whether work belongs here; any consumer-repo schema question; data vs structure; secrets ownership; DB Data Admin; grid filters; Scraped Properties; Master Data editing | §0, §0.0-A, §0.0-B, §0.1, §0.1-A, §0.2, §0.3, §0.3-A, §0.4 |
| [`docs/agents/orchestrator.md`](docs/agents/orchestrator.md) | Running, routing to, or handing over the orchestrator; admission of queue work; dispatch waiting instruction | §0.0-C, §11b, §11c, §11d |
| [`docs/agents/worktrees-and-handoffs.md`](docs/agents/worktrees-and-handoffs.md) | Before any edit (worktree setup and retirement); writing or retiring a HANDOFF.d file; host/server boundary | §2.1-W, §2.1-W.1, §2.1-H, §2.1 |
| [`docs/agents/anti-collision-summary.md`](docs/agents/anti-collision-summary.md) | Any database change: the five anti-collision rules, author lanes, extension tables | §4, §4.1, §4.2, §4.3 |
| [`docs/agents/section-4-anti-collision-rules.md`](docs/agents/section-4-anti-collision-rules.md) | The long-form §4 rules and procedures | §4 long form |
| [`docs/agents/merge-protocol.md`](docs/agents/merge-protocol.md) | Opening, reviewing, or merging any PR here; rulebook/guarded-merge lane; production promotion; red checks | §5, §5.0-D, §5.0-E, §5.1, §5.2, §5.2-A, §5.2-B |
| [`docs/agents/in-flight-check.md`](docs/agents/in-flight-check.md) | Before starting a change, to see whether it is already in flight | §6 (long form: [`section-6-in-flight-long-form.md`](docs/agents/section-6-in-flight-long-form.md)) |
| [`docs/agents/references-and-runbooks.md`](docs/agents/references-and-runbooks.md) | Project refs, exposed schemas, Supabase CLI and credentials, further reading, known traps | §8, §8.1, §9, §10, §10.1–10.3 and §11 (full runbook: [`runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md)) |
| [`docs/agents/standing-facts.md`](docs/agents/standing-facts.md) | Starting any session in this repo | §12, §12.1 |

Kept in this file: task declaration, companywide business rules, session wrap-up convention,
§1, §2, §3, §7.

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
- **Surface risk in plain English.** Before anything hard to undo (dropping a
  column, applying to production, deleting data), explain the risk in one or two
  plain sentences and ask. Approval for one change does not extend to the next.

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

