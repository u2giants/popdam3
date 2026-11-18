---
issue: 6493
status: OPEN
owner: claude/handoff-6493-coordinator-closeout (Claude chat 96fb0739-4894-42e6-a355-3d65a9a0a97e, edge-dev3)
summary: Coordinator pass over the three-session closeout's next steps — items 1–3 done, 4 and 5 waiting on real pipeline events, Step 4b proposed.
kind: handoff
read-when: picking up #6493 or #6574 after 2026-11-18 03:22Z; read together with the predecessor handoff linked below.
---

# #6493 / #6574 coordinator closeout (successor to the three-session closeout)

Written 2026-11-17 10:25 PM EST by Claude chat `96fb0739-4894-42e6-a355-3d65a9a0a97e` on edge-dev3.
**Read the predecessor first; it is kept on purpose** (its dead ends and findings, §4–§5, exist nowhere else,
and two of its next steps are still open):
[`HANDOFF.d/20261118T0216Z-edge-dev3-claude-promotion-throughput-three-session-closeout.md`](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261118T0216Z-edge-dev3-claude-promotion-throughput-three-session-closeout.md).

Moving facts at 03:22Z Nov 18: `origin/main` = [`fb97213ba`](https://github.com/popcre/shared-db/commit/fb97213ba00238136e549c42a7cf78d3b164fdc9);
#6493 and #6574 OPEN; no PR carries `promotion-parked`.

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs the owner. Already settled (do not re-ask): see predecessor §0; plus
2026-11-17 (this session): the 5-minute target is not reachable safely with serial rehearse-then-apply; recorded
as a judgement in the [proposal](https://github.com/popcre/shared-db/issues/6493#issuecomment-6968038830), not an owner ask.

## 1. What this application is

See predecessor §1 (shared-db migrations pipeline: trigger → selector → preview rehearsal → production apply →
nudge; freshness gate `scripts/check-main-tip-freshness.mjs`).

## 2. What this session set out to do

Drive predecessor §6 items 1–5 to verified outcomes, with one subagent per item 1–3, then update the #6493
STATUS table and propose (not start) the next step.

## 3. Current state

| Item | Outcome | Evidence |
|---|---|---|
| 1. #6631's 21-min SLO_A | Explained: review-finding hold #6632 (closed 01:53:48Z) + no automatic re-arm; lane idle 01:37:10–01:55:54Z; dispatch came from a manual run (44219263020). Not a #6556 regression. | [comment](https://github.com/popcre/shared-db/issues/6493#issuecomment-6967600536) |
| 2. #6606 / 20261204001000 | Not stranded: rolled back (statement timeout on bulk backfill, runs 44189714544/44192169496/44195180255), reissued as 20261204003429 by PR #6622, applied by run 44198740325; owner issue #6605 closed. | same comment |
| 3. Live-proof probe refusal (run 44187977315) | Fixed: [PR #6639](https://github.com/popcre/shared-db/pull/6639) merged 03:20:26Z; production mode tolerates ADDED or MODIFIED top-level `.github/live-proofs/<name>.sql` and docs only a probe comment names. Gate code / workflow refusals unchanged. | [comment](https://github.com/popcre/shared-db/issues/6493#issuecomment-6968035516) |
| 4. Live proof of #6599/#6614 | **Open.** All successful production runs since 22:06Z Nov 17 (44198740325, 44214975389, 44220040036) had main exactly at the dispatched commit. Checked 9:35 PM EST. | first comment above |
| 5. #6574 Fix B live proof | **Open.** No `promotion-parked` PR exists. Checked 9:35 PM EST. | [#6574 comment](https://github.com/popcre/shared-db/issues/6574#issuecomment-6967305585) |

#6493 STATUS table: row 4 extended, new row "4b. Re-arm on hold clear + reliable backstop — proposed".
Everything merged; this handoff is the only change in its PR. No preview or production writes; one read-only
ledger SELECT (by the item-2 helper).

## 4. What did NOT work

- `gh pr view --json mergeQueueEntry` is not a field; use GraphQL `pullRequest{mergeQueueEntry{position state}}`.
- PR #6639's first version used a `:(glob,exclude)` pathspec; the business-risk gate test flags the word "glob"
  in that script and failed "SQL migration guards". Plain directory exclude passed.
- An "ADDED only" tolerance (as first briefed) would not have fixed run 44187977315: `5609.sql` was MODIFIED.

## 5. Key findings

- GitHub cron for the trigger (`'23 * * * *'`) is badly skipped: last scheduled runs 23:00Z, 14:42Z, 04:40Z,
  22:22Z, 11:47Z. The "hourly backstop" is not a real backstop.
- Nothing wakes the trigger when a `review-finding` / hold issue closes; held PRs wait for the next unrelated event.
- Probe readers (`shared_db_live_proof.py`, `style_group_live_proof.py`, `check-live-proof-probe.mjs`) run only
  from `shared-db-live-proof.yml` and `merge-queue-gate.yml`, never the production jobs.

## 6. Exact next steps

1. **Item 4:** search new "DB production apply" runs' "Verify exact main commit" step for `origin/main advanced`
   with a sidecar + registry in the list. Done when such a run passes → post run id on #6493 and tick the box.
2. **Item 5:** `gh pr list --repo popcre/shared-db --state all --label promotion-parked`. Done when a PR is parked
   after one permanent refusal → post on #6574, close it, apply the successor rule to
   `HANDOFF.d/20261117T1545Z-edge-dev3-claude-stranded-migration-prevention-plan.md`.
3. **Step 4b** (proposal comment above): re-arm trigger on hold-issue close; backstop independent of GitHub cron.
   Done when the next held PR dispatches within ~2 min of its hold clearing without a manual run.
4. When 1 and 2 are done, delete the predecessor handoff and this file (successor rule), fixing any references.

## 7. Constraints

Predecessor §7 applies. Do not weaken the main-moved refusal for gate code or workflows (2026-11-17). Do not
start Step 5. Wait on PRs only with `ai-pr-wait <pr> --repo popcre/shared-db --timeout-minutes 9 --fit-tool-call`.

## 8. Access and environment

edge-dev3; `gh` as `u2giants`; no secrets used. Supabase MCP used read-only once.

## 9. Open questions and risks

- 2026-11-17: #6639 tolerates MODIFIED probes too (wider than "added only"); safe because no production step
  reads them. Re-check if a production script ever starts reading `.github/live-proofs/`.
- Step 4b's hold-clear trigger must not reintroduce CI no-op cancellations (#6565's concurrency split).

## Part (b) — subagents

- **Item 1 helper (Haiku, read-only):** traced trigger runs 01:34–01:56Z; findings above; no changes.
- **Item 2 helper (Haiku, read-only):** ledger SELECT + run logs; no comment posted (nothing stranded).
- **Item 3 coder (Opus, worktree `agent-a7f2eb271871161cc`):** PR #6639 merged; tests 42/42, 342/342, 555 pytest;
  worktree finished, safe to clean.

## Self-audit

1–3: yes — §3 states each item with evidence, §4/§5 carry this session's dead ends and findings, §6 has gated
steps, and the predecessor (kept) carries the background. 4: walked §1–§9 and part (b); no sentence needs Albert; §0 says None.
