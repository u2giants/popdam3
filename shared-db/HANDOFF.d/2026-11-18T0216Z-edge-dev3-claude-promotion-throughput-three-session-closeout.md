---
issue: 6493
status: OPEN
owner: next session that picks up #6493 (claim-first; no structural claim is needed for pipeline code)
summary: Consolidated closeout of three sessions on promotion speed (#6493) and stranded-migration prevention (#6574) — what landed, what is unproven live, exact next checks.
kind: handoff
read-when: picking up #6493 or #6574; before editing the promotion trigger, the selector, check-main-tip-freshness, or the stranded-migration fixes.
---

# Promotion throughput (#6493) + stranded-migration prevention (#6574) — three-session closeout

Written 2026-11-17 9:20 PM EST by Claude chat `6bd1eddc-79bb-44f5-96c2-0a07363b4c02` on edge-dev3, at the owner's request
("create one handoff consolidated from the 3 of you"). It consolidates:

| Session (app title) | Claude chat id | Model | Scope |
|---|---|---|---|
| A. "Selector merge-to-apply latency" (the writer) | `6bd1eddc-79bb-44f5-96c2-0a07363b4c02` | Fable 5.2 | #6493 Step 4: trace, idle-lane fixes, main-moved fixes |
| A1. "Shorten the promotion queue's decision step" (sub-session of A, closed earlier) | see PR #6572 | Opus 5.5 low | #6493 Step 1c: selector job speed-up |
| B. "Shared-db selector latency issue #6493" | `1ef24f88-4104-457f-bbad-cb690f419367` | — | #6493 Step 4 (parallel attempt), then planned #6574 |
| C. "Build stranded-migration fixes (#6574)" (sub-session of B) | `06d8b8dc-73f9-4b7b-bb2d-d05d095f215a` | Haiku 5.5 | #6574 Fixes A–D |

Moving facts, checked 2026-11-18 02:14Z (9:14 PM EST): `origin/main` =
[`d58d1f373`](https://github.com/popcre/shared-db/commit/d58d1f373c8736217a2e0ccaaf6572e002c943cb);
maximum migration version `20261204003532`; issues #6493 and #6574 both OPEN; no PR carries
`promotion-parked` or `promotion-held`.

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in these workstreams needs the owner.**

Already settled — do NOT re-ask:

- 2026-11-17, Albert: "Yes, fix it" (fix the repeated first production tries). Done as far as is safe: PRs #6599 and #6614.
- 2026-11-17: Albert asked for a Muse second opinion on making the remaining repeats cheaper. Muse advised against
  reusing rehearsals or widening the merge freeze; session A agreed and **decided to make no further change**
  ([record](https://github.com/popcre/shared-db/issues/6493#issuecomment-6958604959)). Albert was told and did not object.
  Revisit only if repeats stay near 1 in 6 after pipeline-code merges slow down.

## 1. What this application is

[`popcre/shared-db`](https://github.com/popcre/shared-db) holds the structure (migrations) of POP Creations' shared
Supabase Postgres database. A merged migration PR reaches production only through an automatic GitHub Actions pipeline;
nobody approves or runs anything by hand.

- [`automatic-production-trigger.yml`](https://github.com/popcre/shared-db/blob/main/.github/workflows/automatic-production-trigger.yml)
  — "the trigger". Wakes on a push to main, on a `production-queue-nudge` repository_dispatch, on `workflow_run`
  completion and on a schedule; a lane guard skips it while an apply run is in progress; then runs the selector.
- [`scripts/automatic_promotion_candidates.py`](https://github.com/popcre/shared-db/blob/main/scripts/automatic_promotion_candidates.py)
  — "the selector". Picks the oldest eligible merged migration PR, takes a dispatch claim (`refs/dispatch-claims/pr-N`),
  dispatches the apply workflow, and prints `SLO_A` / `SLO_B` notices.
- [`shared-supabase-migrations.yml`](https://github.com/popcre/shared-db/blob/main/.github/workflows/shared-supabase-migrations.yml)
  — "the apply workflow". One dispatched run rehearses on the preview database ("DB preview apply …"), then a second run
  applies to production ("DB production apply …"). Its last job, "Nudge the production queue", wakes the trigger again.
- [`scripts/check-main-tip-freshness.mjs`](https://github.com/popcre/shared-db/blob/main/scripts/check-main-tip-freshness.mjs)
  — refuses a production run when main has moved past the dispatched commit, unless every changed path is provably harmless.
- [`scripts/automatic_index_maintenance.py`](https://github.com/popcre/shared-db/blob/main/scripts/automatic_index_maintenance.py)
  — a step inside the trigger job that selects optional index maintenance.

Targets (issue #6493 Part 1): **SLO A** merge → dispatch p50 < 2 min; **SLO B** merge → production apply start
p50 < 5 min, p95 < 15 min for the PR at the head of the queue. Safety rules are not negotiable: serial applies,
review-finding holds, attempt caps, production ledger as the final word, no duplicate dispatch.

## 2. What we set out to do, and why

- **#6493 Step 4 (sessions A and B).** On the Nov 17 overnight burst (9 migration PRs) merge → apply start p50 was
  ~86 min. Albert asked to trace each PR's timeline, fix it, re-measure live and post results. Later asks: explain the
  ~5 min gap between runs, shorten "the five-minute decision step" (sub-session A1), and fix repeated first tries.
- **#6574 (sessions B and C).** PR #6433 failed repeatedly on its own evidence and stranded. Session B wrote a
  prevention plan ([`plan_stranded_migration_prevention.md`](https://github.com/popcre/shared-db/blob/main/plan_stranded_migration_prevention.md))
  and delegated Fixes A–D to session C.

## 3. Current state — what is true right now

### Landed and verified live

| PR | Merged (UTC) | What | Live evidence |
|---|---|---|---|
| [#6556](https://github.com/popcre/shared-db/pull/6556) | 2026-11-17 ~13:06 | Lane guard waits for a finishing run instead of dropping its nudge; dead dispatch claim reclaimed when the newest run did not succeed; selector passes over a candidate claimed elsewhere | 6 of 6 wake-ups acted on; dead-claim reclaim seen; [comment](https://github.com/popcre/shared-db/issues/6493#issuecomment-6950305278) |
| [#6565](https://github.com/popcre/shared-db/pull/6565) | 2026-11-17 13:51 | Index-maintenance step no longer sleeps ~80 s per run; CI no-op `workflow_run` events use a separate concurrency group so they stop cancelling pending nudges | step 2m16s → 1m10s, same comment |
| [#6572](https://github.com/popcre/shared-db/pull/6572) (A1) | 2026-11-17 15:36 | Workflow-run cache between selector reads | trigger job 265 s → 74 s cold / 59 s warm; [comment](https://github.com/popcre/shared-db/issues/6493#issuecomment-6952982666) |
| [#6578](https://github.com/popcre/shared-db/pull/6578) (A1) | 2026-11-17 16:07 | Hold reads run in parallel | dispatching run 44141940698 = 115 s (was 265 s) |
| [#6585](https://github.com/popcre/shared-db/pull/6585) (C) Fix A | 2026-11-17 18:03 | Refuse pre-merge preview apply of high-risk migrations | run 44149841592 refused in validate, nothing applied |
| [#6588](https://github.com/popcre/shared-db/pull/6588) (C) Fix C | 2026-11-17 18:36 | Refuse added migrations the post-apply catalog check cannot read | run 44144185872 |
| [#6598](https://github.com/popcre/shared-db/pull/6598) (C) Step D | 2026-11-17 18:55 | Documentation of the pre-merge refusal | n/a (prose) |

### Landed, tests pass, NOT yet proven live

| PR | Merged (UTC) | What | Why unproven |
|---|---|---|---|
| [#6599](https://github.com/popcre/shared-db/pull/6599) | 2026-11-17 19:15 | A production run is no longer refused when main gains a later migration **plus that migration's own verification sidecar** | Needs a migration with a sidecar to merge while another migration's production run is in flight |
| [#6614](https://github.com/popcre/shared-db/pull/6614) | 2026-11-17 22:06 | Completes #6599: the sidecar registry `config/production-verification-sidecar-registry.json` rides along when it only gains entries for appended migrations (review finding #6600, closed) | Same |
| [#6586](https://github.com/popcre/shared-db/pull/6586) (C) Fix B | 2026-11-17 17:14 | Park immediately on a permanent producer-mismatch refusal | Replay proof only; no real park has occurred |

Production runs since #6614 merged (checked 02:14Z): #6622, #6608, #6629, #6631 applied. Run
[44216435966](https://github.com/popcre/shared-db/actions/runs/44216435966) passed with main moved by one appended
migration and no sidecar — that is the older tolerance (#4845), **not** proof of #6599/#6614.

### Measured, and still short of the target

- Clean path, merge → apply start: **9m36s** (#6577) against 5 min. Roughly 1m50s to dispatch, ~4m15s preview
  rehearsal, ~3m30s of guards and evidence checks inside the production run.
- Latest selector notice (trigger run 44220738303, PR #6631): `SLO_A` 1271 s, `SLO_B` 1545 s; rolling
  p50 `SLO_A` 1843 s, `SLO_B` 2467 s over the last 20 PRs. The rolling numbers still include the pre-fix burst. The
  21-minute `SLO_A` for #6631 has **not been explained** (most likely queue wait behind #6608/#6629, which applied at
  01:19Z and 01:31Z) — see next steps.
- About 1 in 6 production runs is refused because main moved mid-run; each repeat costs +10 to +14 min
  ([breakdown](https://github.com/popcre/shared-db/issues/6493#issuecomment-6958330879)).

### Not started

- #6493 Step 5 (bounded-parallel apply): deferred by plan; do not start without evidence the queue backs up.
- Any reduction of the fixed ~8 min (preview rehearsal + production guards).

### Commit / push / deploy status

Everything above is merged to `main` through the merge queue. There is no deploy step: these are workflow and script
files that take effect on merge. Nothing is uncommitted. This handoff file is the only change in its PR.

## 4. Everything we tried that did NOT work

- **A fresh full selector scan on each wake-up** was the original cost; a committed cache file on main was rejected in
  the plan (merge conflicts, trigger loops). The cache lives in GitHub Actions cache.
- **Raw `gh api` in a workflow step** (session A, PR #6556): the transport conformance test in "Tools offline tests"
  forbids it. Use `gh run list` / `gh run view --json jobs`.
- **Tolerating only the sidecar file** (#6599): incomplete. Every one of the last 12 sidecar-adding commits also edits
  the registry JSON, so the normal case still refused. The advisory reviewer caught it (#6600); fixed by #6614. Lesson:
  check what a real compliant PR changes before narrowing a tolerance.
- **Reusing the old preview rehearsal after a main-moved refusal** (considered, rejected): the refused runs changed
  exactly the files `prove_preview_producer_matches_main` in
  [`scripts/production_business_risk_gate.py`](https://github.com/popcre/shared-db/blob/main/scripts/production_business_risk_gate.py)
  pins byte-for-byte, so reuse would promote on a rehearsal made by older safety code.
- **Freezing gate-code merges from preview dispatch** (considered, rejected): serializes every pipeline PR behind every
  promotion; the narrow form already exists (`BACKSTOP_AFTER_STALE = 2` in the selector).
- **Fail-faster early freshness check** (Muse's one suggestion, not done): saves ~2 min and only when main moved before
  the production run started; in run 44143056415 main moved mid-run and it would have saved nothing.
- **Hand-written loops over `gh pr view` / `gh pr list`**: blocked by the `pr-poll-guard` hook (all three sessions hit
  it). Use one GraphQL query for several PRs and `ai-pr-wait <pr> --repo popcre/shared-db --timeout-minutes 9 --fit-tool-call`
  to wait.
- **`ai-pr-wait` without `--repo`** from a worktree: "cannot determine the repository". Pass `--repo popcre/shared-db`.
- **`timeout … gh run watch`**: denied by permissions in session A; session C could not watch a CI run because its
  permission prompt was denied. Use a single status read.
- **Session B's own lane-guard fix, PR [#6558](https://github.com/popcre/shared-db/pull/6558)**: CLOSED unmerged. It
  duplicated what session A had already landed on main (`68fe67f0e`, `0ca4bf84a`). Two sessions worked the same step
  in parallel; nothing was lost, an afternoon was.
- **Pushing to a branch already in the merge queue** (session B): refused; dequeue first.
- **Session C waiting on CI while its PR #6585 was actually conflicted (DIRTY)**: it needed an explicit rebase
  instruction. A PR that sits "pending" for long should be checked for `mergeStateStatus`.
- **Cross-session replies**: session B's first handoff reply never reached session A. Durable relay is a signed comment
  on the issue.
- **The session temp directory was cleared mid-session** (twice): test fixtures failed with `ENOENT … mkdtemp`.
  Recreate `$TMPDIR` and the scratch directory, then rerun.

## 5. Root causes and key findings

- The overnight delay was **73% idle lane**, not slow work: (1) completion nudges arrived 10–25 s before their run was
  `completed`, so the lane guard skipped them; (2) a dispatch claim left by a preview-success + production-failure run
  (PR #6370) parked the queue 97 min; (3) the "hourly" schedule actually fires about every 6 h; (4) the index-maintenance
  step slept ~80 s per run; (5) CI no-op `workflow_run` events cancelled pending nudges through the concurrency group.
- Only 2 of the 9 burst PRs (#6532: 213 min, #6542: 91 min) were production candidates; 7 were sandbox-only.
- Main-moved refusals, 11 traced: 8 were gate code or the apply workflow changing mid-run (correctly refused); 1 was
  migration + sidecar (fixed); 1 added a stray `.whl` at the repo root; 1 modified a `supabase/tests/*.sql` file.
- **New refusal shape seen during closeout, not handled:** run
  [44187977315](https://github.com/popcre/shared-db/actions/runs/44187977315) (PR #6606) was refused because main gained
  `.github/live-proofs/5609.sql` and a `docs/verification/issue-5609-…` file. Neither is on the inert list.
- The merge freeze starts **before** the production run is dispatched (not at lane acquisition, as session A first
  wrote); the unprotected window is the preview rehearsal plus qualification.
- "Post-apply catalog verification" has shown **false reds** on migrations that did apply (#6559, #6566, #6593, #6596):
  issues #6571 (fixed by #6573) and #6603 (fixed by #6615, another session). A red production run is not proof the
  migration is absent; check the production ledger.

## 6. Exact next steps

1. **Live-prove #6599 + #6614.** In the logs of new "DB production apply" runs, search the step "Verify exact main
   commit" for `origin/main has advanced`. You'll know it worked when a run passes whose `added past the dispatched
   commit` list includes a `scripts/production-verification-sidecars/<version>.json` and the registry. Post the run id
   on #6493. If such a run is instead REFUSED naming only those files, the fix is wrong: reopen.
2. **Explain the 21-minute `SLO_A` for PR #6631** (merged shortly before 01:39Z; dispatched ~02:00Z). List trigger runs
   between its merge and 02:00Z and confirm each was either skipped by the lane guard for a real in-flight apply
   (#6608 at 01:19Z, #6629 at 01:31Z) or acted. You'll know it is fine when every gap is an apply in progress; if a
   wake-up was dropped with the lane idle, that is a regression of #6556.
3. **Check PR #6606 (another session's, PopDAM text vectors).** It failed three production applies at "Fresh dry-run,
   then apply" (runs 44189714544, 44192169496, 44195180255) and one main-moved refusal. Session A did not determine
   whether version `20261204001000` is in the production ledger or whether its owner has reissued it. Read the latest
   trigger log for `PR #6606`; if it is neither applied nor parked nor owned, tell its owning session
   ("PopDAM typed search meaning matching") or record it on its issue. Do not repair it under #6493.
4. **Decide on the `.github/live-proofs/*.sql` + `docs/verification/*` refusal shape** (finding in §5). Verify first
   whether any production step reads `.github/live-proofs/`; only if none does, consider tolerating ADDED files there,
   with tests in [`check-main-tip-freshness.test.mjs`](https://github.com/popcre/shared-db/blob/main/scripts/check-main-tip-freshness.test.mjs).
   You'll know it worked when the positive-control tests still refuse gate code and workflows.
5. **#6574 Fix B live proof.** Wait for the next real permanent producer-mismatch refusal. You'll know it worked when
   the selector parks that PR after its first such refusal with no further retries. Then tick the proof on #6574 and
   close it, and apply the successor rule to
   [`HANDOFF.d/20261117T1545Z-edge-dev3-claude-stranded-migration-prevention-plan.md`](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261117T1545Z-edge-dev3-claude-stranded-migration-prevention-plan.md).
6. Only after 1–4: judge whether SLO B needs more work (the fixed ~8 min), and write that as a new step on #6493
   rather than starting Step 5.

## 7. Constraints and gotchas in force

- Never push to `main`; branch + PR; merge with `gh pr merge <n> --auto` (the merge queue picks the strategy; never
  `--admin`, never `--squash`).
- Declare `ai-task-gates start --class code` (or `prose`) before edits; changing `AGENTS.md`, skills or `plan_*.md` is
  class `reviewer-safety`.
- Production is read-only for sessions. Migrations reach production only through the pipeline.
- Reviews are advisory. Findings arrive as `review-finding` issues; read the one for your PR (#6600 was right).
- "Documents-only merge authorization" shows FAILURE on every code PR; it is advisory and expected.
- `plan_promotion_stranding_watch.md` (#6561, another session) also edits the selector; rebase before touching it.
- Tool output on edge-dev3 is sometimes compressed or empty; write command output to a file and read the file.
- Sign every GitHub post with the session's `$AI_GH_SIGNATURE`.

## 8. Access and environment

- Machine edge-dev3; `gh` authenticated as the owner's `u2giants` identity; no database credential was used by any of
  the three sessions (all work was GitHub Actions code and read-only run inspection).
- Secrets, if ever needed, live in the 1Password vault `vibe_coding`. None appeared in these sessions.
- Muse second opinion: `ai-muse`, session name `main-moved-repeat-6493` (transcript retrievable with
  `ai-muse transcript main-moved-repeat-6493`).

## 9. Open questions and risks

- 2026-11-17: #6599/#6614 widen a fail-closed gate. The widening is narrow (ADDED sidecar and pure registry gain for an
  appended migration only) and Muse's review called it "an incomplete fix, not an unsafe widening" before #6614, but it
  has no live run yet.
- 2026-11-17: the 1-in-6 repeat rate is assumed to come from this week's heavy pipeline development. If it persists,
  the "no further change" decision in §0 should be revisited.
- The rolling `SLO` p50 values will stay inflated until 20 post-fix PRs have passed.
- Facts that may be stale: every run id, SHA, PR state and the max migration version above (checked 02:14Z Nov 18).

---

# Part (b) — one block per session

### Agent A: "Selector merge-to-apply latency" (the writer) — worktree `happy-faraday-54acb3`
- **Asked to do:** #6493 Step 4 trace, fix, live re-measure, post results; then explain the 5-min gap, shorten the
  decision step (delegated to A1), fix repeated first tries, get a Muse opinion.
- **Actually did:** PRs #6556, #6565, #6599, #6614 (all MERGED); six evidence comments on #6493; closed review finding
  #6600 via #6614.
- **Found:** the idle-lane causes and the main-moved breakdown in §5.
- **PR / branch:** all merged; this handoff's branch `claude/handoff-6493-three-sessions`.
- **Preview / production writes:** none.
- **Claims:** `ai-shared-db-closeout-check` ok, 0 blocking claims, 0 blocking stages (9 claims, 3 stages checked).
- **Worktree:** finished, clean; safe to clean once this handoff PR is merged. Local-only branches
  `claude/selector-evidence-cache-6493`, `-phase-timing-6493`, `-pr-cache-6493`, `-revalidation-6493` belong to earlier
  #6493 sessions (PRs #6500/#6507/#6514 era) and were left untouched on purpose.
- **Deliberately did NOT do, and why:** fail-faster check (low value); cheaper repeats (unsafe or costly, see §4);
  steps 2–4 in §6 (found during closeout; scope freeze). The #6493 STATUS table rows 1c/4 and its
  "fresh session starts here" line were refreshed at closeout and point at this file.

### Agent A1: "Shorten the promotion queue's decision step" (sub-session of A)
- **Asked to do:** cut the trigger job's ~4½ min.
- **Actually did:** PRs #6572 and #6578, MERGED; evidence comment on #6493; updated STATUS row 1c.
- **Worktree:** finished; it reported its closeout check passed, working copy clean, both branches gone from GitHub.
- **Deliberately did NOT do:** the two 20 s review-finding hold settles are locked by design and were left.

### Agent B: "Shared-db selector latency issue #6493"
Verbatim record: [its closeout comment](https://github.com/popcre/shared-db/issues/6574#issuecomment-6966986475).
- **Asked to do:** #6493 Step 4, then explain PR #6433's retries and plan prevention.
- **Actually did:** Step 4 results comment; PR #6558 CLOSED as a duplicate of A's fix; issue #6568 opened and closed
  after the reissue (PR #6566, version `20261204000300`) was confirmed live; plan PR #6575 MERGED; delegated to C.
- **Preview / production writes:** none.
- **Claims:** closeout check ok, 0 blocking.
- **Worktree:** local worktree on `claude/plan-stranded-migration-prevention`, clean and merged; no open PRs.
- **Deliberately did NOT do:** Fix B live proof (cannot be forced; needs a real refusal).

### Agent C: "Build stranded-migration fixes (#6574)" (sub-session of B) — worktree `elegant-goodall-b5079d`
Verbatim record: [its closeout comment](https://github.com/popcre/shared-db/issues/6574#issuecomment-6966991099).
- **Asked to do:** implement Steps A–D of the stranded-migration plan.
- **Actually did, all MERGED:** Fix A #6585, Fix B #6586, Fix C #6588, Step D doc #6598; related #6582 (PL/pgSQL
  migration lint) and #6583. Last commit on `claude/stranded-fixD-doc-and-proof`:
  [`2d8e78013`](https://github.com/popcre/shared-db/commit/2d8e78013).
- **Found:** it reports "queue head #6577 has a duplicate migration version (another session's; not fixed here)".
  **Unverified and probably stale:** PR #6577 applied to production at 17:36Z on Nov 17 (run 44138250522, success).
  Re-check before acting on it.
- **Preview / production writes:** none (no migrations, no data rows).
- **Claims:** closeout check ok, 0 blocking claims, 0 blocking stages.
- **Worktree:** clean, nothing unpushed, no open PRs; safe to clean.
- **What did not work:** Fix A was first placed in the preview job and failed the closure tests, so it moved to the
  validate job; the first Fix C test insertion broke syntax and was reinserted; `gh run watch` was denied by permission.
- **Deliberately did NOT do, and why:** Fix B live proof — it needs a real permanently-refused migration. Check with
  `gh pr list --repo popcre/shared-db --state all --label promotion-parked` (empty at 02:14Z Nov 18).

## Self-audit (handoff-writer gate), answered at write time

1. *Could a newcomer pick up without a question?* Yes — §1 defines every component by file URL, §3 gives each PR's
   state and proof, §6 gives ordered steps with checks.
2. *As well as the writers could?* Yes — §4 and §5 carry the dead ends and non-obvious findings of all three sessions,
   and part (b) links each session's verbatim closeout.
3. *Every detail for execution?* Yes — goals §2, state §3, failures §4, decisions §0/§9, constraints §7, next actions §6.
   Known gaps are stated as gaps: PR #6606's ledger state, PR #6631's `SLO_A`, agent C's #6577 remark.
4. *Does §0 hold every owner decision?* Walked §1–§9 and part (b): no sentence needs Albert's judgement; sessions B and C
   each state "no question for Albert". §0 says None and lists what is already settled.
