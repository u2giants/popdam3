---
issue: 6493
status: OPEN
owner: claude/6493-step4b-handoff (Claude chat 516f0f5a-916d-4e3f-ba0b-0439f1b78d89, edge-dev3)
summary: Step 4b (hold-clear wake + cron-independent re-check) merged in PR #6700; the live dispatch proof is still open.
kind: handoff
read-when: closing #6493 STATUS row 4b, or when a held migration PR's review-finding issue closes.
---

# #6493 Step 4b — live proof still open

Written 2026-11-18 12:32 PM EST. Predecessors (kept; their items 4 and 5 are still open and not covered here):
[coordinator closeout](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261118T0322Z-edge-dev3-claude-6493-coordinator-closeout.md),
and its own predecessor (three-session closeout, §4/§5/§7).

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE
None. Nothing in this workstream needs the owner.

## 1. What this application is
This is the shared-db migrations pipeline: trigger, then selector, then preview rehearsal, then production apply, then a nudge. The trigger is
[automatic-production-trigger.yml](https://github.com/popcre/shared-db/blob/main/.github/workflows/automatic-production-trigger.yml).

## 2. Goal
Stop the lane from sitting idle after a promotion hold clears (#6631 sat idle for 18 minutes). Also give the trigger a backstop that does not depend on GitHub cron.

## 3. Current state
- [PR #6700](https://github.com/popcre/shared-db/pull/6700) merged 17:17:58Z (12:17 PM EST). The workflow:
  - adds `issues: [closed, unlabeled]`, filtered at job level to `review-finding`, `promotion-held` and `promotion-parked`;
  - sends other issue events to the `-issue-noise` group, and leaves the `-ci-noise` split byte-identical;
  - moves concurrency onto the job;
  - when the selector reports a transient wait (`needs_recheck()` in `scripts/automatic_promotion_candidates.py`), runs a `recheck` job that sleeps 720 s and then calls `gh workflow run ... -f recheck_hop=N+1`. The cap is 8 hops and the job has its own cancel-in-progress group. Cron is kept.
- Tests pass: 242 promotion-candidate tests (9 new), 34 review-finding hold, 12 index maintenance, 42 freshness.
- Live, partial: review-finding #6657 closed at 17:27:53Z. Trigger run 44358969981 (event `issues`) started at 17:27:58Z and succeeded. It dispatched nothing, which was correct: #6655 was not waiting, the selector reported idle, and #6451 was still held by #6452. Recorded in [this comment](https://github.com/popcre/shared-db/issues/6493#issuecomment-6986334812). STATUS row 4b reads 🟡.
- Not yet seen: a held PR dispatching within about 2 minutes of its hold closing; a `workflow_dispatch` recheck hop in run history.

## 4. What did NOT work
- In a `sed s#…#` edit of the issue body, `#` in "PR #6700" ended the expression early. Use `|` as the delimiter instead.
- actionlint is not installed on edge-dev3, so the workflow was checked only by the parsing tests.

## 5. Key findings
- A closed hold whose PR is already in production, or not otherwise waiting, wakes the trigger, and the trigger correctly does nothing. That is not proof; the proof needs a PR that is actually held.
- Hold issues and parked PRs never request a re-check, by design. Only transient waits do: lane busy, ledger unreadable, a production dependency, or a selector claim.

## 6. Exact next steps
1. Check: `gh issue view 6452 --repo popcre/shared-db --json state,closedAt`. When it closes, find the trigger run with event `issues` and the migrations run `DB preview apply … PR6451`. **Done when** the preview dispatch time minus `closedAt` is at most about 2 minutes, with no manual run. Any other held PR whose hold closes counts too; the selector log line is `held: PR #N by #M`.
2. Check: `gh run list --workflow automatic-production-trigger.yml --event workflow_dispatch` for a run with a `recheck_hop` input. **Done when** one exists that a `recheck` job started.
3. Post both run ids as a signed comment on #6493, set STATUS row 4b to ✅, and delete this file under the successor rule.

## 7. Constraints
Production is read-only. Do not start Step 5. Do not weaken the main-moved refusal for gate code or workflows. Wait on PRs only with `ai-pr-wait <pr> --repo popcre/shared-db --timeout-minutes 9 --fit-tool-call`.

## 8. Access
`gh` as `u2giants` on edge-dev3. No secrets used.

## 9. Risks
2026-11-18: if a recheck chain runs all 8 hops on a long lane-busy wait, the cron is the only wake after that. Check this once in run history.

## Part (b) — subagents
- Implementer (general-purpose, this worktree): wrote PR #6700's commit 8749c08. It did not push; the coordinator landed it. Its worktree is finished.

## Self-audit
1–3 yes: §1–§3 give the background and state, §4–§5 the dead ends and findings, §6 the gated steps.
4 yes: I walked every section and nothing needs Albert.
