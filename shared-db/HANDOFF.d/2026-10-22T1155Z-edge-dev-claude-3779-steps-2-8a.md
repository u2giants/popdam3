---
issue: 3779
status: OPEN
owner: claude/745ea991-2041-4729-8860-ca595c6faf46
---

# Handoff — popcre/shared-db #3779 plan steps 2 and 8a (edge-dev)

**Session:** Claude chat `745ea991-2041-4729-8860-ca595c6faf46` on `edge-dev`
**When:** 2026-10-22, 7:55 AM EDT (written); work ran 2026-10-21 11:00 AM – 2026-10-22 1:50 AM EDT
**Repo:** https://github.com/popcre/shared-db
**Plan:** https://github.com/popcre/shared-db/blob/main/plan_shared_release_hold_reduction.md (STATUS rows 2 and 8)
**Issue:** https://github.com/popcre/shared-db/issues/3779

## 1. Goal and current state

Goal: plan step 2 (bounded preparation and release-state contracts, §8.1 A–C) and
step 8a (owner-and-generation release everywhere, legacy SHA-release call-site
audit). Step 2's contract layer and step 8a's **first, backward-compatible landing**
are merged and verified by tests. Step 8a's **second landing** (workflow callers) is
not started. No database was touched; no claim, preview, merge or production stage
is held (`ai-shared-db-closeout-check` ok at 7:51 AM EDT, zero blocking claims/stages).

## 2. What was done (all merged through Guarded Merge)

| PR | What | Merge commit |
|---|---|---|
| [#4545](https://github.com/popcre/shared-db/pull/4545) | Step 2: [`scripts/lib/release-hold-evidence.mjs`](https://github.com/popcre/shared-db/blob/main/scripts/lib/release-hold-evidence.mjs) strict schemas, evidence ref names, create-only publish + readback, 3 attempts / 90 s, cleanup table, deletion guard for `refs/db-release-evidence/*` | `78111ed8` |
| [#4546](https://github.com/popcre/shared-db/pull/4546) | Step 8a first landing: every `--release-<lane>` runs `releaseExclusive` under the mutex; legacy `--owner-sha` resolved to holder + generation; tests in [`scripts/release-hold-ownership.test.mjs`](https://github.com/popcre/shared-db/blob/main/scripts/release-hold-ownership.test.mjs); audit [legacy SHA release call sites](https://github.com/popcre/shared-db/blob/main/docs/verification/shared-release-holds/2026-10-21-legacy-sha-release-call-site-audit.md) | `4ed0f0fa` |
| [#4605](https://github.com/popcre/shared-db/pull/4605) | #4604 regression fix: shared preview ref releases any preview-family lease (8a had bound the exact kind and broke post-merge rehearsals) | `f74420c1` |
| [#4553](https://github.com/popcre/shared-db/pull/4553) | Owner ruling §6.29 ("make it 1hr."): stale-place queue window 24 h → 1 h, skip message derived from the constant | `921898c6` |
| [#4554](https://github.com/popcre/shared-db/pull/4554) | (sub-session, issue #4552) cross-reference mentions no longer reset the stale-place clock | `92511afa` |

Evidence pairs: `.agent/work/3779/12` (#4545), `/16` (#4553), `/20` (#4546), `.agent/work/4604/1` (#4605).

## 3. Preview / production

Nothing applied to preview or production. One lane operation: the stranded
`preview-rehearsal` lease left by run 39727737391 (completed, failed by the #4604 bug)
was released at 1:33 AM EDT with its exact acquisition sha through the supported CLI.

## 4. Half-finished

None mid-way. Remaining scope is unstarted (section 6).

## 5. Owned

Nothing. All branches merged and their worktrees removed, except this session's own
app-managed worktree `upbeat-shaw-ceaa66`, which carries only this handoff PR.

## 6. Next actions

1. **Step 8a second landing.** In the five workflow release sites listed in the audit
   (guarded merge, merge-queue gate, shared preview, shared production, preview
   recovery), export `holder_id` and `generation` from the acquisition JSON beside
   `owner_sha` and pass `--holder-id --generation` on release. Add point-of-use
   `--assert-exclusive` before each mutation (preview/production `supabase db push`,
   atomic apply, preview-ledger reconciliation apply, final merge / queue
   authorization). Named test: `every_mutating_workflow_asserts_acquired_identity`.
   Editing the plan file makes the class `reviewer-safety`.
2. **#4604 live proof:** the next post-merge rehearsal must release its lease cleanly
   (checkbox on #4604). The Guides search session (#4210) was told to re-run its
   rehearsal.
3. Carry the three Muse notes from #4545's review into steps 4–5: require
   `apply_result === 'verified'` and `mandatory_verification_passed` on the
   cleanup-table release row; align `evidenceRef`/`parseEvidenceRef` generation and
   ordinal bounds; consider a central deletion guard for `io.deleteRef`/`updateRef`.

## 7. Blocked on

Nothing. No owner decision is outstanding.

## 8. What did NOT work, and why

- **Combining steps 2 and 8a in one PR** — the reviewer draw refuses while an earlier
  open PR edits the same protected lane file (`scripts/check-pr-source-collisions.mjs`
  `PROTECTED_SOURCE_PATHS`). Split the non-overlapping part out.
- **Mentioning a blocking PR with `#<n>`** in your own PR bodies created
  `cross-referenced` events that (before #4554) restarted its stale clock.
- **Posting a stale-place nudge on a green PR** does nothing; the rule needs failing
  checks or a main conflict. Message the owning session instead.
- **First StepFun review** never started: `ai-task-gates` was declared against an old
  base and saw another session's migration as in-scope. Redeclare with `--base <main>`
  before every review.
- **Re-running a governed review after a paid start** is refused; release the failed
  start with `--release-failed-reviewer` and draw `--replace-failed-reviewer`.
- **`ai-pr-wait` on a code PR** exits early on the always-failing
  `Documents-only merge authorization`; watch the guarded-merge run instead.
- **8a bound the caller's lane kind exactly** — wrong for the shared preview ref
  (#4604). Any future identity check must compare refs, not kind names.

## 9. Possibly stale facts

`main` tip `9555ec69` and max migration `20261022113157`, both checked 7:53 AM EDT
2026-10-22. PR states above checked 7:52 AM EDT.
