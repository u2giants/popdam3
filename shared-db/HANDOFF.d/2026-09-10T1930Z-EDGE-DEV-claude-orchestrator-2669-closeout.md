---
issue: 2669
status: OPEN
owner: claude/orch-2629-successor
---

# Orchestrator closeout — marker #2669 (successor to closed marker #2629)

- **Session:** `shared-db.orch EDGE-DEV succ-2629`, engine claude, route_id `local_ab36afbe-07da-45a5-b608-783a137606de`, started 2026-09-10T12:26:14Z.
- **Facts below were re-derived at 2026-09-10T19:27:47Z:** `origin/main` = `4bffc3894c6fa446a7853276f4a62b31ef3315a1`; highest migration version on main = `20260910123636`. Both go stale quickly — re-derive, do not quote.

## 1. What this session was doing and why

Owner handover from closed marker #2629 with an explicit eight-item priority list: finish the owed #2440 preview rehearsal; confirm #2403's isolated DesignFlow activation; get fresh owner authority before any #2543 / #2622 / #2290 production action; finish #2439 on live PopDAM proof; continue #2482 and #2579; reconcile the expired-unconfirmed claims #2574 and #2578 through the supported path; and hold `reap-merged-worktrees.mjs --apply` until #2624 lands.

## 2. What was actually done

- **#2440 preview rehearsal — COMPLETE.** `20260909005945` was confirmed absent from preview by a live ledger query, PR #2612 identified as its author, and the post-merge preview route dispatched. Run `34514941938` succeeded; artifact digest `sha256:b576e0c5…`. Evidence posted as issue comment `5623590501`. Issue closed.
- **#2403 — verified already complete, no action owed.** Applied to the isolated DesignFlow non-production project `xupnyeifmpsacrqahwwm`, four independent target guards, 262/262 structure-fingerprint lines with zero differences, ledger row written in the same transaction. The shared preview database was **not** substituted, as instructed. Already closed.
- **The Friends TV ("FR") removal is already live on production.** A production apply was dispatched for the bounded FR ship set `20260802170000, 20260817225127, 20260818174350, 20260820183334`. Run `34514396561` refused with `BLOCKED: already applied on production: <all four>`. That refusal is a live read of production's own ledger and is the proof. Recorded as a finding on #2290. **Consequence: the §6.5 divergence note in `20260804120000_taxonomy_baseline_pins_table.sql` ("production has FR active, preview has FR inactive") is now STALE as a description of production.**
- **Expired claims reconciled through the supported path, no lock hand-deleted.** Claim #2524 (issue #2493, PR #2526) and claim #2525 (issue #2501, PR #2527) were renewed for 12 hours via `--renew-claim`. Claim #2574 was found already properly released; #2578 was found not yet expired. No reconciliation was owed on either.
- **#2290 baseline picture established** — see §7.
- **Reviewer incident recorded** in ai-devops as `20260910T192734Z-edge-dev-grok-8417`.

## 3. Applied to preview / production

- **Preview:** one apply, the #2440 historical/post-merge rehearsal above (run `34514941938`). No ad-hoc data rows were written to preview by this session.
- **Production:** one apply **attempt**, refused before any SQL because the versions were already applied. **Nothing was written to production by this session.**

## 4. Half-finished or abandoned

- **PR #2677 / issue #2326 — ABANDONED DELIBERATELY, and this is the session's main error.** I spent a long stretch driving governed reviews on this PR. It is `work_type: repo-maintenance`, `route: repo-maintenance` — a REPO-SESSION exit under the admission test, **not orchestrator work**. A separate repository session owned it, closed #2677 at 19:17:26Z as "superseded by clean, evidence-only PR #2686", and opened #2684 and #2686. I stood down. Two genuine accuracy fixes made on the old branch at commit `47d86551162552c67273001aafd26705832488b5` were handed to that session as issue comment `5624163626`: the `.agent` files were repinned from `678e78a1` to the reviewed head `483772d9` with all three checks re-run there; the upstream base was converted from an assumption to a measurement (`git merge-base origin/main codex/issue-2326-step3` = `b4b0962b5489e2e8235b97cf1b8b9661d34f237e`, which refutes the reviewer's `e9f39d51` reading from the sealed packet); the contract was republished as `refs/db-contracts/2326/11`; and the Step 3 STATUS row was qualified with the partial scope the closeout certifies. **No verdict artifact exists at `47d86551`** — both round-6 reviews were abandoned when the PR closed.
- **PR #2681 (issue #2579) — NOT STARTED, and it is the next real orchestrator item.** Head `8d22d459a5c46f2e620a1b87ab3cd7e68dcb01b8`, OPEN, MERGEABLE, checks green apart from a stale `Migration guarded merge authorization` pending line that says the production freeze ended and the workflow should be re-run. **Both reviewer slots must be drawn at that exact head before either reviewer is invoked.**

## 5. What this session owns

- Branch `claude/orch-2629-successor` in worktree `.claude/worktrees/shared-db-orchestrator-issues-b3dd88` — clean apart from this handoff file.
- **All review worktrees this session created were removed**: `fix-2677`, `rev-2677-483772d9`, `rev-2677-47d86551`, `rev-2677-d42cac36`, `rev-2677-d473dbf9`. Nothing of this session's is left under `.claude/worktrees/` except the orchestrator worktree itself.
- **Deliberately left alone:** every other worktree in `git worktree list` (roughly 100 of them, across `C:/repos/shared-db-worktrees/`, `C:/tmp/` and `.codex/worktrees/`). They belong to other sessions. `scripts/reap-merged-worktrees.mjs --apply` was **not** run, per the standing hold until #2624 is fixed, reviewed, merged and proved safe for unpushed commits — PR #2639 is the fix and is still open.
- No claim is held by this session. Claims #2524 and #2525 were renewed on behalf of their existing owners, not taken over.

### Sub-agent blocks

#### Agent: review runner — PR #2677 slot 1 (rounds 4-6)
- **Asked to do:** run governed slot-1 reviews of PR #2677 at each successive head from a detached worktree.
- **Actually did:** returned an APPROVE at `d473dbf9` (sequence 2197, muse) and a refusal at `47d86551` because the PR had closed under it.
- **Found:** nothing unsafe; the accuracy findings all came from slot 2.
- **PR / branch:** #2677 (now CLOSED) / `codex/issue-2326-step3`.
- **Worktree:** finished and already removed.
- **Deliberately did NOT do, and why:** no verdict was recorded at `47d86551` — the PR closed mid-review, and manufacturing a verdict outside the runner would be a counterfeit.

#### Agent: review runner — PR #2677 slot 2 (rounds 4-6)
- **Asked to do:** independent second-slot review at each head.
- **Actually did:** REVISE at `d473dbf9` (sequence 2198) with two accuracy findings; round-5 attempts died as provider failures (grok `turn_limit_cancelled` ×2, kimi `insufficient_quota` ×2) before qwen returned a usable report.
- **Found:** the record's `head_sha` and diff range trailed the reviewed head — a real defect, fixed. It also asserted a merge-base of `e9f39d51`, which a direct `git merge-base` refuted.
- **PR / branch:** as above.
- **Worktree:** finished and already removed.
- **Deliberately did NOT do, and why:** its merge-base finding was **not** conceded; a measurement beats a sealed packet whose branch refs are known to drop.

## 6. What was about to happen next

Draw both reviewer slots for PR #2681 at head `8d22d459a5c46f2e620a1b87ab3cd7e68dcb01b8`, run both reviews from a detached worktree at that exact head, and guarded-merge if both clear.

## 7. Blocked on

- **#2290 baseline — blocked on an owner decision, and it is not orchestrator work.** The issue's own scope block is `work_type: security-settings`, `route: owner-only`, which is RETURN-TO-OWNER. Baseline activation exists **only** as the SQL function `plm.activate_taxonomy_baseline(...)` (`20260804120000_taxonomy_baseline_pins_table.sql:345`), granted to `service_role` only. **No workflow and no script calls it**, and `coldlion-licensor-property-production.yml`'s `preflight` job explicitly refuses to hold a production password, so it cannot derive the metrics either. The production `baseline_key` `phase4_production` exists only as a prescribed name with NOT FOUND values; nothing is active on either database (health returns `no_active_baseline`). Step 1 is done, step 2 is blocked until a baseline is active, steps 3-4 are moot.
  - The live blocker is a **2026-09-07 owner HOLD** requiring two named business reviewers to confirm production's licensor and property data is correct. **Owner named them on 2026-09-10: Ilona and Laura** (recorded as issue comment `5623778721`). The owner has been asked, in plain language, whether Ilona and Laura still need to review the corrected list or whether removing Friends TV settled it. **That answer had not arrived when this session closed.**
- **#2439 — blocked on owner hand-setting three values.** The alert relay is merged (popdam3 PR #126, merge `50c6818408a99a69f5e85029ba48b7270bba5876`) but not deployed. Railway needs `BULK_OPERATION_ALERT_WEBHOOK_URL`; Supabase needs `BULK_OPERATION_ALERT_SECRET` and `BREVO_API_KEY`. Owner named the alert recipient mailbox in chat (a popcre.com service address; withheld here because this repo is public). Live acceptance then needs a deliberate failed rebuild alert followed by a successful run.
- **#2543 residual** — the private Disney/Lucas OPA capture is owned by the private licensor session, not this repo.

## 8. What was tried that did NOT work — MANDATORY

- **The FR historical preview recovery run `34513855063` failed with exit 1 and no error message.** `--log-failed` showed only the script's own echo lines, which was actively misleading. The cause was found by reading the step's env dump (`MAIN_SHA:` was empty) and then `shared-supabase-migrations.yml:441-492`, where `test -n "$MAIN_SHA"` runs under `set -euo pipefail`. **Root cause: `commit_sha` was omitted from the dispatch. BOTH preview routes require `commit_sha`, including historical recovery.** Re-dispatched with it → run `34514033238` succeeded.
- **Claim renewal was refused five times in a row for five different stated reasons.** The flag is `--claim-number`, not `--claim`; then it demanded `--issue`, `--branch`, `--pr`, `--head-sha` one at a time; then it reported `claim owner, branch, or worktree mismatch` **while being passed the exactly correct values**. **Root cause: Git Bash MSYS path conversion silently rewrote `/tmp/shared-db-orch-2517-2493` into a Windows path**, breaking an exact-string comparison. Fixed by prefixing `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`. Expect this on any lane-manager argument that looks like a POSIX path.
- **Four reviewer failures in one PR.** grok-4.6 cancelled without a final answer **twice** (sequences 2197 and 2203, `turn_limit_cancelled`); kimi-k3 hit its usage limit **twice** (2205 and 2216, `insufficient_quota`). In every case a substitute returned a well-formed verdict on the identical head and prompt, so the target was never the problem. Recorded as ai-devops incident `20260910T192734Z-edge-dev-grok-8417`.
- **The `mcp__supabase__execute_sql` tool has no `project_id` parameter and is bound to PREVIEW** (`mvpkijzfmfcxhnzqogzs`), proven by probe. It cannot reach production. Do not plan a production read around it.
- **Reviewer wrappers need `AI_<PROVIDER>_CALLER` exported** or they fail as a local dependency fault. The working export is `AI_MUSE_CALLER=claude AI_KIMI_CALLER=claude AI_GEMINI_CALLER=claude AI_QWEN_CALLER=claude AI_GROK_CALLER=claude`. Filed as #2678.
- **The largest wasted effort of the session was working PR #2677 at all.** The admission test would have exited it to a repository session immediately; `--queue-audit` did list #2326 under REPO-SESSION. Run the admission test against the issue's own scope block *before* drawing a reviewer, not after.

## 9. Facts that may already be stale

- The `main` SHA and maximum migration version in the header — checked 19:27:47Z, and this repo moves within the hour.
- Every PR state and head SHA quoted here, especially #2681's `8d22d459…` and #2686's.
- Claim leases #2524 and #2525 expire 2026-09-11T06:37Z.
- The reviewer pool's quota state: grok and kimi were failing at 19:20Z; both usually return.
- `20260804120000_taxonomy_baseline_pins_table.sql` §6.5's claim that production has FR active — **known stale**, see §2.
- The owner's answer on the #2290 hold may have arrived after this file was written; check issue #2290 before acting on the baseline.

## Sweep results

- **Secrets sweep: swept, nothing new.** No credential appeared in chat, in a scratch file, or in any diff this session. The only credential-adjacent items are the three values in §7 that the owner must set by hand in Railway and Supabase; none of their values were seen, requested, or written anywhere.
- **Documentation pass:** one thing outside this handover is now wrong — the §6.5 divergence note named in §2. It is a comment inside an already-applied migration file, which is immutable history and must not be edited; the correction is recorded here and on #2290 instead. Nothing else outside the handover is stale.
- **Queue seed:** every outstanding item named above has an open `db-work` issue — #2290, #2439, #2543, #2579, #2493, #2501, #2678, and #2326 (owned by the repository session). Nothing outstanding exists only in this prose.
