---
issue: 1680
status: OPEN
owner: codex/revise-throughput-plan-grok
---

# Handoff — implement the reviewed throughput-guard truth plan

## 0. Decisions only the owner can make

None before implementation. Albert authorized incorporating Grok 4.6's blocking and optional corrections. Already settled: declared manifest instead of target parser; catalog evidence never changes acceptance; reviewer timeout never reduces coverage or replaces a substantive `REVISE`; estimates never become headline measurements.

If two replacement reviewers fail on the same head during future implementation, the implementing session must stop and put that single blocker to Albert. That is an operational escalation, not a decision needed now.

## 1. What this repository is

`u2giants/shared-db` governs the structure and safety checks for the shared POP database used by multiple applications. Issue #1680 is repository maintenance only: scripts, tests, workflows and documentation. It authorizes no migration, database write or apply.

## 2. Goal and trigger

Implement [`plan_orchestrator_throughput_guard_truth.md`](../plan_orchestrator_throughput_guard_truth.md) so guards explain file, ledger and catalog truth accurately without weakening refusals. Issue #1645 showed an applied dynamic-SQL creator hidden from stripped-text analysis while a visible hard-blocked creator received the blame.

## 3. Current state

The plan was registered in merge `172d2bb`, rewritten manifest-only in merge `d4bbfceb`, then reviewed by Grok 4.6 on 2026-08-28. Grok returned `APPROVE WITH CHANGES`, finding six blockers and optional corrections. This revision incorporates all of them. Implementation Steps 1–9 remain open. No production, preview, migration, script or workflow has been changed by the planning sessions.

The two predecessor handoffs were retired in this revision because their merged work is proven, every open obligation is carried into the plan and this file, and their useful dead ends are preserved below. Their stale parser instructions must not remain discoverable as open work.

## 4. Failed approaches

- Four automatic scans misclassified dynamic SQL through comments, quote tags, called procedures, quoted identifiers, duplicates and temporary drops.
- The first rewrite still asked a “conservative detector” to distinguish called from uncalled bodies; Grok correctly identified that as the rejected parser under another name.
- Overall issue age mixed guard delay with owner and deployment waits.
- A fixed 20-minute reviewer cap could kill a live reviewer producing a blocking verdict.
- Five combined `catalog-truth` labels blurred object, version and source states.

## 5. Root causes and key findings

- #1645 uses a `$ddl$` helper argument, not only `DO`; three creator migrations exist, two hard-blocked and one applied.
- The three `reconcile_*` procedures are called and dropped, so their bodies execute during apply.
- Dynamic RLS may use `execute format` or single-quoted helper arguments and is absent from the relation scanner.
- `$applyddl$` functions, triggers, spaced policies and quoted identifiers require typed verification identities.
- `derive_targets()` must union manifest data only for its allowlist. Migration acceptance must not read the manifest at all.
- Reviewer replacement is justified by no verdict plus no progress or explicit transport/coverage failure, never elapsed time alone.

## 6. Exact next steps

1. Start Phase A at Step 1 in a fresh repository-maintenance worktree. Gate: current `origin/main`, clean owned files, current committer identity.
2. Implement Steps 1–5 in order. Gate: manifest is allowlist-scoped, presence guard infers nothing, typed truth tests pass, guard exits and #1645 rescue are unchanged, and corpus bite is demonstrated.
3. Start a fresh session for Phase B. Implement Steps 6–8. Gate: evidence-only metrics, triage command and matching reviewer rules in both authority files pass named tests.
4. Start Phase C, run Node plus Python unittest suites, obtain required review and merge. Gate: required checks green on merged `main`, no migration/database mutation, STATUS and issue current.

## 7. Constraints and gotchas

Repository maintenance only; do not route to the schema orchestrator. Never build `apply_time_ddl_statements()`, classify execution in Step 2, infer targets, change `strip_sql()`, or feed manifest/catalog data into `created_objects()`, `available` or `preflight_batch()`. Unavailable requested evidence is `UNVERIFIABLE`, exit 2. Use explicit workflow steps for `scripts/` tests and `python -m unittest`.

## 8. Access and environment

Use authenticated `gh`, repository Node/Python runtimes, and the existing read-only Management API path. Secrets remain references in 1Password vault `vibe_coding`; no new secret is required and no value may be printed. Worktrees live under `C:\repos\shared-db-worktrees\` and base on `main`.

## 9. Open questions and risks

No design question remains open. Module language boundaries and optional PR comments are implementer choices within the plan. Main risks are a parser sneaking into the presence guard, manifest data leaking into acceptance, unsafe quoted identity interpolation, guessed metrics, and reviewer replacement hiding a verdict. Each has an explicit static or behavior test and rollback in §13.

## Self-audit

1. A fresh developer can continue: §§1–6 identify the repository, incident, current state, failed attempts, findings and exact gated steps.
2. They have the full session knowledge: §§4–5 preserve every Grok blocker and the historical dynamic-SQL traps.
3. Execution details are complete: §§6–9 cover actions, constraints, access and risks; the linked plan supplies file-level tests and rollback.
4. Owner sweep passed: §0 lists the only future escalation condition; no present owner decision is hidden elsewhere.
