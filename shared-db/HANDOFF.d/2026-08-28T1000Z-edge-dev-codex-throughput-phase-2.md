---
issue: 1738
status: OPEN
owner: codex/issue-1738-throughput-phase-2
---

# 0. Decisions only the owner can make

None — nothing in this workstream needs Albert before implementation begins. The plan preserves one-at-a-time preview/merge/production, exact object protection and required reviewer coverage. Any later proposal to weaken those boundaries is outside issue #1738 and must be raised separately.

Already settled — do not re-ask:

- 2026-08-28: Phase 2 must preserve every safety gate while removing false capacity use and unnecessary evidence replay.
- 2026-08-21: repository-maintenance work belongs to a separate repo session, not the structural orchestrator.

# 1. What this application is

`u2giants/shared-db` governs POP Creations' shared database structure. Its orchestrator coordinates isolated migration authors, independent reviews, one shared preview database, guarded merges and production promotion. The implementation target is repository coordination scripts/workflows/tests/docs, not the database.

# 2. What this session set out to do, and why

Albert asked for an implementation-plan-writer Phase 2 plan using all evidence from the completed `shared-db.orch` task. The goal is to stop blocked claims, shared locks, mutable preview state and unrelated `main` movement from causing avoidable capacity loss and repeated review/preview work while preserving safety.

# 3. Current state

The comprehensive plan is [`../plan_orchestrator_throughput_phase_2.md`](../plan_orchestrator_throughput_phase_2.md). It is documentation only on branch `codex/issue-1738-throughput-phase-2`, based on planning `origin/main` SHA `4433467af5e40a82f1a8def381efa1d5a9cc52c7`. No Phase 2 code, workflow, migration, database write or deployment has occurred. Issue #1738 tracks implementation.

# 4. What did not work

- Counting blocked claims as active author lanes produced “five occupied” while only three workers ran.
- Exact-head-only review identity caused byte-identical #1713 migration evidence to be reviewed again after unrelated `main` movement.
- Shared-preview dependencies surfaced as failed workflows, notably #1720 behind unmerged #1713.
- Reviewer selection serialized unrelated issues and an interrupted review left a stale mutex.
- Route/verifier incompatibilities were discovered late: #1684 supersession/test deletion, #1720 constraint-only verification, and #1646 dependency/history compatibility.

The plan's §7 records rejected fixes, including releasing claims, raising the lane cap, parallel database writes and unsafe review reuse.

# 5. Root causes and key findings

The governing defect is coupling: a claim simultaneously represents object protection and worker capacity; a Git commit simultaneously represents reviewed content and integration state; preview failure simultaneously represents unsafe state and an expected queue dependency. The plan separates those identities while retaining conservative failure behavior. Full measurements and the event timeline are in plan §3.

# 6. Exact next steps

1. Start at plan Step 1 and create the scrubbed machine-readable baseline. **Worked when:** schema tests reproduce the issue/timeline table without inventing active effort.
2. Complete Phase A claim/lease separation. **Worked when:** blocked claims protect objects but do not consume five active-author leases.
3. Continue phases in order, using a fresh session at each marked cut and updating STATUS. **Worked when:** every step's named tests/gates pass.
4. Roll out in shadow mode before enabling behavior. **Worked when:** no unsafe mismatch exists and old enforcement remains authoritative.
5. Merge only after required checks/review; verify post-merge main. **Worked when:** issue #1738's definition of done is fully evidenced.

# 7. Constraints and gotchas

Do not route implementation to the structural orchestrator. Do not release object claims to free capacity. Do not parallelize preview/merge/production writes. Do not reuse review if any bundle member or global invalidator changed. Do not commit the private transcript. Preserve legacy coordination-ref readers during rollout. Update the plan STATUS immediately as work lands.

# 8. Access and environment

Use authenticated `git`/`gh` for `u2giants/shared-db`, Node/Python in the repo, and isolated worktrees from current `origin/main`. Existing database credentials, if a read-only proof is unavoidable, live in 1Password vault `vibe_coding`; never expose values. The raw evidence source is private Codex task `01a0461f-d1bf-7e02-8c84-ee8783f965b0` and must not be committed.

# 9. Open questions and risks

Module boundaries and lease cadence are implementer choices under plan §8. Ambiguous invalidation must remain `UNVERIFIABLE` and repeat full review. The largest risks are accidental claim release, unsafe review reuse and scheduler races; plan §13 gives controls and reversible rollout for each.

## Handoff self-audit

1. **Newcomer continuity: yes.** §§1–3 explain the repo, goal, exact state and plan link; §6 gives ordered gates.
2. **Full session knowledge: yes.** §§4–5 carry the failed mechanisms and root cause; the linked plan §3 contains the complete timestamped evidence.
3. **Execution completeness: yes.** §§6–9 cover actions, constraints, environment, risks and proof; commit/deploy state is explicit in §3.
4. **Owner-decision sweep: yes.** §§1–9 contain no present owner choice; §0 states none and lists settled boundaries. Any future safety reduction is explicitly outside scope and must be raised separately.
