---
issue: 1680
status: OPEN
owner: codex/consensus-throughput-plan
---

# Handoff — implement the consensus throughput-guard truth plan

## 0. Decisions only the owner can make

None before implementation. Albert directed Codex, Claude Opus 5 and Grok 4.6 to debate until all agree on the best plan. The final independent approvals must be preserved in the plan/issue before implementation begins. Already settled: extend the existing hash-bound sidecars rather than create a second manifest; live catalog never changes migration acceptance; reviewer routing exhausts the active rotation, uses Codex overflow once, then fails closed.

## 1. What this repository is

`u2giants/shared-db` owns shared database structure and its safety tooling. Issue #1680 is repository-maintenance work covering scripts, tests, workflows and documentation only. It authorizes no migration, database write, preview/production apply, infrastructure mutation or new credential.

## 2. Goal and trigger

Implement [`plan_orchestrator_throughput_guard_truth.md`](../plan_orchestrator_throughput_guard_truth.md) so guards report migration-file, ledger and catalog evidence independently without weakening any refusal. Issue #1645 exposed the representative failure: stripped-text analysis could not see an applied dynamic creator even though the live object and a hash-bound verification sidecar existed.

## 3. Current state

The plan was registered in merge `172d2bb`, rewritten in `d4bbfceb`, and revised after Claude rejected the parallel manifest design and Grok independently agreed. Implementation Steps 1–9 remain open. No scripts, workflows, migrations or databases have changed. The predecessor handoff was retired because its merged history is proven, its open obligation is carried here, and its rejected design is preserved in the plan.

## 4. Failed approaches

- Automatic target scans misclassified comments, tagged quotes, called routines, quoted identifiers, duplicates and temporary drops.
- `config/apply-time-targets.json` duplicated the stronger existing sidecar store and did not fit the current verifier model safely.
- A changed-file guard in the shallow tools workflow had no reliable pull-request or push base.
- A two-replacement cap contradicted the existing Codex-overflow route.
- Explicit test lists had already allowed new tests to land without running.
- Optional blocker-ledger rows made “zero recurrence” gameable.

## 5. Root causes and key findings

`load_behavior_sidecars()` already enforces allowlist scope, strict shape and canonical migration SHA-256. `20260825082910.json` already covers #1645 through verifier-owned exact catalog contracts. The missing control is a fail-closed requirement that every changed/mandatory migration marker has a reviewed disposition tied to real checks or a substantive no-durable-target range. File, ledger and catalog truth remain independent. The blocker ledger is one immutable incident file per ID so parallel worktrees do not conflict.

## 6. Exact next steps

1. Start Phase A at Step 1 in a fresh repository-maintenance worktree. Gate: current `origin/main`, clean owned files and verified committer identity.
2. Implement Steps 1–5. Gate: sidecars remain hash-bound and acceptance-isolated; every marker is covered; live and guarded-merge workflows validate exact branch changes; open migration PRs are cleared; #1645 rescue and all exits are unchanged.
3. Start a fresh Phase B session and implement Steps 6–8. Gate: fixture-ledger binding prevents omitted incidents, triage is read-only, and reviewer text matches existing overflow-then-refuse tooling.
4. Run Phase C, obtain the required independent review, merge, verify post-merge checks, update STATUS and close #1680. Gate: merged SHA on `main`, all checks green and no database mutation.

## 7. Constraints and gotchas

Repository maintenance only; do not route it to the schema orchestrator. Never build an apply-time parser, change `strip_sql()`, feed sidecars/catalog state into `created_objects()`, `available` or `preflight_batch()`, copy `HARD_BLOCKED`, replace a substantive `REVISE`, reduce review coverage, or maintain explicit growing test lists. Requested unavailable evidence is `UNVERIFIABLE` with exit 2.

## 8. Access and environment

Use authenticated `gh`, repository Node/Python runtimes and the existing read-only Management API path. Secrets remain references in 1Password vault `vibe_coding`; no new secret is required and no value may be printed. Worktrees live under `C:\repos\shared-db-worktrees\` and base on `main`.

## 9. Open questions and risks

No design question remains open once all three reviewers approve the same head. Risks are parser creep, sidecars leaking into acceptance, unsafe identity interpolation, omitted blocker rows, test-discovery drift and reviewer routing drift. The plan assigns a fail-closed test or rollback to each.

## Self-audit

1. A new developer can continue from §§1–6 and the linked 13-section plan without chat context.
2. §§4–5 preserve the failed designs, exact sidecar discovery and reason for the consensus revision.
3. §§6–9 cover actions, verification, constraints, access and risks; commit/deploy state is explicit in §3.
4. Owner sweep passed: §0 contains the only owner-facing condition, and no hidden decision appears in §§1–9.
