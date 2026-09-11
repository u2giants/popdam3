---
issue: 2469
status: OPEN
owner: claude/shared-db.orch-5e0e7c81
---

# Orchestrator closeout — shared-db.orch edge-dev (session local_5e0e7c81-fb70-475a-9291-47d620a02a13)

All moving facts below were re-read from `origin/main` at **2026-09-06T20:51:34Z**.

- `origin/main` tip: `cd6649089057ad3666538ec2ef99621a948166ad`
- Highest migration file on main: `20260906035323_style_group_rebuild_guard_and_ungroup.sql`
- Marker: issue **#2442**, `route_id: local_5e0e7c81-fb70-475a-9291-47d620a02a13` — closed as the final action of this session.
- Preview: **this session applied nothing to preview and nothing to production.** No preview lock was ever taken. Whatever is sitting on preview is not mine and I did not inspect it.

## 1. What this session was for

Run the shared-db orchestrator: audit the queue, dispatch structural work to sub-agents in isolated
worktrees, serialize review/preview/merge, and resolve operational blockers rather than idling.

## 2. What actually landed

Three PRs merged to main this session, each after two governed APPROVEs:

| PR | What | main after |
|---|---|---|
| #2455 | duplicate-claim release capability | `8fa7408b` |
| #2446 | Gemini rotation docs / section-4 authoritative text | `e82eec28` |
| #2461 | `allowClaimSuperset` fix for expired-claim recovery (#2460) | `bdf188d2` |

Also done:
- Released the duplicate claim on #2444; authority claim **#2405** retains version `20260906143801`.
- Recovered expired claim **#2405** (`--recover-expired-claim-from-pr --claim-number 2405 --lease-hours 8`). New expiry `2026-09-07T02:24:21.948Z` — **this has now passed or is about to; re-check before using it.**
- Filed tooling defects **#2458, #2459, #2460 (fixed), #2464, #2465, #2467**.

## 3. Preview / production

Nothing. No migration applied to preview, nothing promoted to production, by this session or any agent it dispatched.

## 4. Half-finished — READ THIS FIRST

### PR #2409 (issue #2334, claim #2405) — canonical licensing relationship bridges

Head `91f731bac57a1f2379b9d30e5dca63ea7f80cbd2`. **Substantively approved, blocked only by tooling.**

Five review rounds:

- R1 head `f1273d76`: muse-spark **REVISE**, four findings — unpinned search_path and no EXECUTE revokes on the guard functions; support rows not tied to their endpoints' licensor; wiring asserted by trigger name only; no UPDATE-repoint or second-licensor tests. **All four fixed.**
- R2 head `6755e007`: glm-5.3 **APPROVE**, muse-spark **APPROVE**. The glm artifact was created and then destroyed by defect #2464.
- R3 head `a36775fd`: grok-4.6 **REVISE**, two findings — the licensor guard read `dam.asset` and `dam.asset_character` as the inserting role, which `service_role` cannot SELECT; and the search_path test only checked a 12-character prefix. **Both fixed**: all five guards are now `SECURITY DEFINER` (matching `plm.reject_legacy_landing_resolution_write()` and `public.sync_asset_effective_tags()`), with contract step 6c running real `service_role` writes and asserting the guard's own P0001 sqlstate; the test now asserts the exact `search_path=pg_catalog, pg_temp` plus `prosecdef`.
- R4 head `28351693`: glm-5.3 **APPROVE recorded** (`refs/db-review-verdicts/2334-2409-283516930a02c223eda22c6e58252f58ed84d207` = `6ff1eaf4`). The muse-spark APPROVE was **destroyed by #2464**.
- R5 head `91f731ba`: both slots destroyed by #2464.

**Coverage limit stated honestly:** Docker and Supabase are unavailable on edge-dev. The five guard
functions and the whole contract DO block were **compiled and catalog-checked** against a disposable
PostgreSQL 18.6 cluster. The behavioural `service_role` case in step 6c has **never been executed**;
it first runs in CI. Do not report it as behaviourally proven.

### PR #2468 (issue #2464) — the fix for the recorder defect

Head `4a251b7d40a7b4246df705ac2ea6c345a20fc32e`. **No verdict recorded.** Slots 1512 (glm-5.3) and
1513 (muse-spark) were drawn at that head and the review was started but never completed.

## 5. What I own and what I left behind

- Branch `claude/issue-2334-canonical-bridges` in worktree `.claude/worktrees/issue-2334-canonical-bridges` — **live**, holds PR #2409. Do not clean.
- Branch `claude/issue-2464-verdict-readback` in `C:\Users\ahazan\AppData\Local\Temp\claude\wt2464\w` — **live**, holds PR #2468.
- Scratch review worktrees under `C:\Users\ahazan\AppData\Local\Temp\claude\` (`wt2409r3b`, `wt2409r4`, `wt2409r5`, `wt2468r1`, `wt2409fix`) — detached, **safe to delete**.
- Claim **#2405** on the #2334 objects — deliberately NOT released, because PR #2409 has not merged.
- I ran no worktree sweep. `scripts/reap-merged-worktrees.mjs` refuses while a marker is open; run it after the marker closes.

## 6. What I was about to do

Finish the PR #2468 review, merge it (that unblocks all merging), then re-review and merge PR #2409,
then work the queue: #2447, #2452, #2425, #2415.

## 7. Blocked on

**#2464 blocks every merge in this repository.** The governed review runner creates the durable
create-only verdict artifact, then a single immediate readback of an eventually-consistent GitHub
custom ref returns 404, so it declares a disagreement, refuses, and runs its void path — editing the
findings comment whose sha256 the now-immutable artifact records. The tuple is permanently burned and
a genuine APPROVE becomes unusable. It fired on **four consecutive rounds** of PR #2409 and is no
longer intermittent. PR #2468 fixes it and is itself waiting on a review that needs the broken tool.

Nothing is blocked on Albert except the standing product-item-master question, tracked separately.

## 8. What did NOT work — MANDATORY

- **Pushing an empty commit to move the head is no longer a workaround for #2464.** It worked on PRs
  #2455 and #2461. By round 5 the defect fired at the new head too. Each attempt costs a full reviewer
  round from a five-reviewer pool. Fix the tool; do not retry the head bump.
- **Sub-agents dispatched to run governed reviews repeatedly died mid-run**, at roughly 10 to 23 minutes,
  returning "waiting on the X run" and no result. Three separate agents did this. A GLM or grok review
  takes longer than the agent survives. **Verify from `git ls-remote origin 'refs/db-review-verdict*'`
  rather than believing an agent's final message**, and consider running the review in the foreground.
- `--slot 2` is **silently ignored** by `run-governed-review.mjs`; only `--review-slot` works, and the
  ignored flag defaults the run to slot 1, corrupting the wrong ref. It burned a complete muse-spark
  review. Filed as **#2467**.
- `--failing-check <terminal code>` is refused with a message that *lists the code you just supplied*.
  The terminal code goes in **`--failure-code`**; `--failing-check` names a failing doctor check and
  only pairs with `local_dependency_unavailable`.
- `--recover-expired-claim-from-pr --claim 2405` fails with `unknown argument: 2405`. `--claim` is the
  boolean acquire flag; the numeric selector is **`--claim-number`**.
- `git ls-remote origin 'refs/db-review-verdicts/<issue>-<pr>-*'` returns empty even when the refs
  exist. List `refs/db-review-verdict*` and grep.
- `ai-gemini` still cannot record a governed verdict (**#2458**) — it writes PASS into a git-ignored
  report file the runner never parses. Replace it on sight with `wrapper_terminal_failure`.
- `codex-gpt-5.6-sol` was out of quota for much of the session (`insufficient_quota`).
- A `RECOVERY REQUIRED` message about `refs/db-coordination/author-acquisition` is a known stale-read
  false alarm (**#2457**); retrying the same command once succeeds.
- `scripts/public-data-venue.test.mjs` has **one pre-existing failure on clean main**, about eight
  licensed-data CSV files under `docs/verification/database-efficiency/20260904T212459Z/`. Reproduced at
  `origin/main`. Not caused by any PR here.
- I got a fact wrong in issue #2460's body and PR #2461's comment: they name `resumeAuthorLease` where
  the `allowClaimSuperset` precedent actually belongs to `renewExpiredClaim`. grok-4.6 caught it. The
  argument and the fix are unaffected; the prose is still wrong.

## 9. Facts that may already be stale

- Claim **#2405**'s lease expiry `2026-09-07T02:24:21.948Z` — likely expired by the time you read this.
- Reviewer sequence numbers (latest drawn: 1513) and which reviewers have quota.
- Every SHA above, and the open-PR list, are as of 2026-09-06T20:51:34Z.
- The worktree list was read once, at the same time.

## Sub-agent blocks

### Agent: PR #2409 round-1 fixes (`.claude/worktrees/issue-2334-canonical-bridges`)

- **Asked to do:** fix muse-spark's four REVISE findings.
- **Actually did:** pinned `search_path` and revoked EXECUTE on five guard functions; added
  `core.require_support_edge_licensor_matches_endpoints()` on all eight `*_source_edge` tables; pinned
  all 29 wirings by function OID and exact argument values; added UPDATE-repoint and second-licensor
  tests; rebound the production-verification sidecar. Head `6755e007`.
- **Found:** the repo's definer and search_path convention lives in `plm.reject_legacy_landing_resolution_write()` and `public.sync_asset_effective_tags()`.
- **Worktree:** live.
- **Deliberately did NOT do:** run the behavioural contract suite — it needs Docker, unavailable here.

### Agent: PR #2409 round-3 fixes (same worktree)

- **Asked to do:** fix grok-4.6's two findings.
- **Actually did:** made all five guards `SECURITY DEFINER`; added contract step 6c exercising
  `service_role` and asserting P0001 so a 42501 cannot pass as a refusal; tightened the search_path
  assertion to the exact value plus `prosecdef`; re-anchored the sidecar markers. Head `91f731ba`
  (via `28351693`).
- **Found:** no schema-wide `dam` read grant to `service_role` exists anywhere in the repo, so the
  definer route is both conventional and narrower than granting SELECT.
- **Worktree:** live.
- **Deliberately did NOT do:** grant `service_role` SELECT on `dam.asset` — it would hand a write role
  standing read access it does not otherwise have.

### Agent: #2464 repair (`C:\Users\ahazan\AppData\Local\Temp\claude\wt2464\w`)

- **Asked to do:** find and fix the real cause of the void-after-create defect without weakening the
  create-only guarantee.
- **Actually did:** proved the cause (a single readback of an eventually-consistent ref; the repo's own
  `readRefAfterWrite` documents that inconsistency), switched to `readRefAfterWrite` so only *absence*
  is retried and a genuinely different SHA still fails closed, marked post-create failures
  `verdictArtifactCreated` so the void path refuses to run, and made an existing artifact validate
  against its own `findings_ref`. Four regression tests, each failing before and passing after.
  Commit `4a251b7d`, PR **#2468**.
- **Evidence line:** artifact `refs/db-review-verdicts/2334-2409-2835169-slot2` = `500e6ee6` holds an
  APPROVE authored `2026-09-06T20:05:05Z`; the refusal and comment void posted `20:05:06Z`.
- **Worktree:** live.
- **Deliberately did NOT do:** repair the already-burned artifacts. They are immutable.

## Secrets sweep

**Swept, nothing new.** No credential appeared in this session; nothing was written to a scratch
`.env`; no token entered chat or any command line. No 1Password entry was created or updated.

## Documentation pass

Nothing outside this handover is stale as a result of this session. The two behavioural corrections
this session established (`--failure-code` versus `--failing-check`, and `--claim-number` versus
`--claim`) are argument-shape facts that belong with the tool, not in `AGENTS.md`; they are recorded
here and in session memory. Issue #2460 and PR #2461 carry a wrong function name (see section 8) —
corrected in prose here rather than by rewriting the audit trail.
