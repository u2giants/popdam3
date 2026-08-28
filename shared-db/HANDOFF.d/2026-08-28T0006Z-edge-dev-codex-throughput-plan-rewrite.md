---
issue: 1680
status: OPEN
owner: codex/rewrite-throughput-guard-plan
---

# Handoff — implement the throughput guard truth plan

## 0. Decisions only the owner can make

None. Albert authorized rewriting the plan. The remaining implementation is repository maintenance and requires no database or production approval.

Already settled on 2026-08-27: use a declared manifest instead of a dynamic-SQL parser; reviewer timeout must never reduce required review coverage; measure guard-caused delay separately from general issue age.

## 1. What this repository is

`u2giants/shared-db` governs the structure and safety checks for the shared POP database used by several applications. The work in issue #1680 improves repository guards and diagnostics only; it does not change the database.

## 2. Goal and trigger

Rewrite and then implement [`plan_orchestrator_throughput_guard_truth.md`](../plan_orchestrator_throughput_guard_truth.md). Issue #1645 showed that a text scanner could explain live database state incorrectly when durable objects were created through dynamic SQL.

## 3. Current state

The plan was rewritten on branch `codex/rewrite-throughput-guard-plan` from `origin/main` at `4025647`. The rewrite removes the rejected parser path, preserves the manifest decision, makes reviewer replacement mandatory after timeout, and replaces overall issue age with causal blocker measures. Implementation Steps 1–9 remain open. No script, workflow, migration or database was changed.

## 4. Failed approaches

Four automatic dynamic-DDL scans produced wrong answers through comment pairing, tagged/digit-bearing dollar quotes, called procedures, quoted identifiers and temporary objects. The old plan still required the rejected parser in its checklist. Overall issue lead time also mixed guard delay with owner decisions and planned waits. These approaches are now explicitly rejected in §7 of the plan.

## 5. Root cause and findings

Text analysis can safely say `NOT_DERIVABLE`; it cannot prove live absence. The safe implementation is asymmetric: a version-keyed manifest adds post-apply probes but never feeds batch availability. Runtime truth must keep migration files, ledgers and live catalogs separate. A reviewer timeout is a harness failure, not permission to waive review.

## 6. Exact next steps

1. Start at the plan STATUS table and Step 1 in a fresh repository-maintenance worktree. Gate: the branch starts from current `origin/main`.
2. Implement Phase A, Steps 1–5, exactly in order. Gate: focused and offline tests prove the manifest cannot manufacture acceptance and the corpus bites.
3. Start a fresh session for Phase B, Steps 6–8. Gate: causal report, triage command and reviewer-preservation wording pass their named tests.
4. Run Phase C and merge. Gate: full Node/Python suites and required checks are green on the merged `main` SHA; no migration changed.

## 7. Constraints and gotchas

This is repository maintenance, not orchestrator work. Never create a migration or write to preview/production. Do not build `apply_time_ddl_statements()`, alter `strip_sql()`, or feed manifest values into `created_objects()`/`available`. An unavailable truth source exits 2 and is never reported absent. Work only in an isolated worktree and stage owned files.

## 8. Access and environment

Use authenticated `gh`, repository Node/Python runtimes, and the existing read-only Management API path. Existing secrets remain in 1Password vault `vibe_coding`; no new credential is needed and no value may be printed. Base branch is `main`.

## 9. Open questions and risks

No owner question is open. Language boundaries may be chosen by the implementer within §8 of the plan. The main risk is a stale manifest; Step 2's required fail-loud check is mandatory. The previous Claude handoff remains historical and contains superseded counts and parser instructions; this file and the rewritten plan control.

## Self-audit

All ten sections are present. Sections 1–5 provide context, current state, dead ends and findings; §6 gives ordered gates; §§7–9 cover rules, access and risks. Section 0 confirms there is no owner decision. A fresh session can continue from Step 1 without the planning chat.
