---
issue: 2301
status: OPEN
owner: codex/author-lane-lifecycle-plan
---

# Author-lane abandonment lifecycle plan

## 0. Decisions only the owner can make

None blocks implementation. Ordinary capacity relinquishment preserves all work and locks and does not need Albert.

Already authorized without another owner question: after the new guards land, the orchestrator may terminally retire `clean` work, or `absent` work whose absence and complete durable branch/PR evidence are proven. This routine boundary does not authorize deleting a worktree or ref.

One conditional future decision is already bounded: if an operator wants to terminally retire a `dirty` or `remote` worktree that may contain recoverable uncommitted work, Albert must decide whether to abandon it. The implementing session must not ask now; the future operator must present the complete exact evidence in one request if that situation occurs.

Already settled on 2026-09-04 — do not re-ask: keep object/version protection; expiry alone never releases capacity; never delete refs or worktrees; use `relinquished` plus recovery metadata rather than a new state; successors use a fresh migration version.

## 1. What this application is

`u2giants/shared-db` governs the structure of POP Creations’ shared database. Its author-lane manager allows up to eight unrelated migration authors while preventing overlapping database-object or migration-version work.

## 2. What we set out to do, and why

Albert asked for a permanent fix after all eight author lanes were reported occupied by work whose authors had stopped. Codex and GLM 5.3 debated the design and agreed on a fail-closed lifecycle that frees capacity without dropping locks or losing recoverable work.

The complete implementation specification is [`../plan_author_lane_abandonment_lifecycle.md`](../plan_author_lane_abandonment_lifecycle.md).

## 3. Current state

Planning is complete; implementation has not started. The dated 2026-09-04 audit at `1e2f5ee79f6a72a7d445dbf5db73ac203beb31a9` showed 8/8 occupied, five `expired-unconfirmed`, three active, and zero relinquished. Re-run the audit because live state changes.

The existing code already separates capacity from claim protection and blocks relinquished/expired merges. Missing pieces are recovery metadata, machine-independent relinquishment, terminal tombstones, independent capacity/preview results, and automatic read-only detection.

This handoff and plan are documentation-only work on branch `codex/author-lane-lifecycle-plan`. Verify their live commit/PR/merge evidence from issue #2301 before implementation; this write-once handoff must not be edited after landing.

## 4. What did not work

- Raising the lane cap only postpones recurrence.
- Expiry-only release can overlap database work.
- Closing PRs or deleting refs/worktrees can discard evidence or protection.
- Requiring the abandoned worktree to be locally reachable keeps remote/dead-machine work stuck forever.
- A new `quarantined` state widens parser risk without adding behavior beyond `relinquished` plus metadata.
- Existing closed-claim guards stop merge/resume but not manual claim reopening or branch/worktree identity reuse.

## 5. Root causes and key findings

The lifecycle stops at `expired-unconfirmed`, which deliberately retains capacity. `relinquishAuthorLease()` also requires a clean worktree on the invoking machine even though it changes only claim metadata. Reconciliation lacks an expired branch, preview uncertainty controls the aggregate result, no scheduled audit exists, and released claims lack an immutable retirement record.

The plan’s §§5–8 contain exact file/function evidence and the locked GLM/Codex consensus.

## 6. Exact next steps

1. Start a fresh isolated repo-maintenance session and read the plan STATUS plus §§1–13. You’ll know it started correctly when it is on current `origin/main`, not inside the live structure orchestrator, and no database action is planned.
2. Implement Phase A Steps 1–2 and their focused tests. You’ll know it worked when all worktree-state/parser/recovery cases pass without changing locks or worktrees.
3. Update STATUS with artifacts, start a fresh Phase B session, and implement terminal tombstones. You’ll know it worked when reopened/retired tuples cannot re-enter and successors remain unaffected.
4. In a fresh Phase C session, split reconciliation outcomes and add hourly/dispatch-time read-only detection. You’ll know it worked when preview uncertainty cannot hide capacity truth and scheduled runs never mutate.
5. In Phase D, synchronize rules and canonical skill, run all suites, obtain exact-head independent review, merge, and verify the live report. You’ll know it is complete when every §13 item has an artifact and issue #2301 can close.

## 7. Constraints and gotchas

This is repository maintenance, not schema work. Do not route implementation through the structure orchestrator. Preserve dirty checkouts, stage only owned files, never weaken gates, never infer abandonment from time, never mutate worktrees during relinquishment/retirement, and never apply the lifecycle to live claims merely as a test.

The eight author lanes and the separately configured reviewer-provider pool are different systems. Issue #2280 is also separate.

## 8. Access and environment

Shared-db lives at `C:\repos\shared-db`, targets GitHub `u2giants/shared-db` `main`, and uses Node.js/Python tests plus `gh`. The canonical orchestrator skill source is in `C:\repos\ai-devops\skills\shared\shared-db-orchestrator\SKILL.md`. No database or cloud credentials are required. Secrets, if authentication repair is ever needed, live in 1Password vault `vibe_coding`; never expose values.

## 9. Open questions and risks

No design question blocks work. Exact JSON names, workflow minute, and issue-template mechanism are implementation choices bounded by plan §8. Primary risks are legacy parser compatibility, false abandonment evidence, stale tuple resurrection, API-budget growth, workflow noise, and cross-repo skill drift; plan §13 gives the mitigation for each.

### Handoff self-audit

1. **Fresh developer continuity: yes.** §§1–3 identify the system, goal, exact plan, baseline, and unfinished status; §6 gives ordered gated next steps.
2. **Full session knowledge: yes.** §§4–5 preserve rejected approaches, root causes, and the GLM/Codex consensus, with the plan holding full evidence.
3. **All execution details: yes.** §§6–9 cover actions, verification, constraints, access, risks, and implementation discretion; the plan supplies file/function/test detail.
4. **Owner-decision sweep: yes.** Section 0 records both halves of the authority boundary: clean/proven-absent routine retirement is already authorized, while dirty/remote terminal retirement needs Albert with timing, recommendation, and consequence. No current owner action is needed.
