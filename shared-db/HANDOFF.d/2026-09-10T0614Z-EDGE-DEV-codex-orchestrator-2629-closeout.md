---
issue: 2439
status: OPEN
owner: codex/orch-2629-closeout
---

# shared-db orchestrator #2629 closeout

## 0. Decisions only the owner can make

Put this whole list to Albert in one message before any irreversible work:

1. **Issue #2543 — production activation and private Disney OPA load.** Migration `20260909115140_opa_coherent_complete_capture.sql` is merged and rehearsed on preview, but production apply and the private capture/load remain unauthorized. Recommendation: authorize only after reviewing the preview artifact and the private loader's own dry-run evidence.
2. **Issue #2622 — production activation.** Migration `20260909194231_coldlion_merch_group_detail_category_identity.sql` is merged and rehearsed on preview, but no production apply was authorized. Recommendation: authorize the normal production review/apply window after the application owner confirms the category-aware key is expected.
3. **Issue #2290 — deployment authority.** The ColdLion health-lane deployment actions still require owner authority. Recommendation: keep it blocked until Albert names the exact deployment action and target.

Already settled; do not re-ask: Albert authorized production for #2439 on 2026-09-09 and it was completed; he instructed this session on 2026-09-10 to take no new tasks, finish in-process work, and close; the worktree reaper must not run with `--apply` until #2624 is fixed.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the shared Supabase database structure used by POP's applications. It owns migrations, structural contracts, preview rehearsals, production evidence, and the coordination machinery that prevents concurrent agents from colliding. GitHub is the delivery system. The shared rehearsal database must always be resolved afresh from repository variable `PREVIEW_PROJECT_REF`; never copy an old literal from a handoff. Production project `qsllyeztdwjgirsysgai` was the live target proved during this session and must also be re-proved before any future write.

## 2. What we set out to do this session, and why

Marker #2629 continued the clean handoff from marker #2597. The ordered agenda was: merge PR #2425/#2403 only after a current-main refresh and two fresh governed reviewers; unblock and rehearse #2440 after #2439; refill the queue around #2543 and #2580 without crossing #2290 owner authority or the #2624 reaper defect; and advance #2439, #2440, #2466, #2481, #2482, #2580, and #2579 concurrently. Albert later narrowed the scope: take no new work, finish what was already in process, then close this session.

## 3. Current state — verified 2026-09-10 06:11–06:16 UTC

- `origin/main` is `dc1b3835860408f0f90b2c28d22d6fd5150360f8`. The maximum merged migration is `20260909220101_popdam_item_state_and_prediction_identity.sql`.
- PR #2425 merged as `5874305e5ac200677ecb3e5ab7e265734e21cef6` after two exact-head reviewer reservations and governed review. Its migration `20260909121403_hts_rag_split_isolated_schema.sql` is still not applied to shared preview; issue #2403 remains open for its DesignFlow non-production activation.
- #2439 is in production. PR #2654 merged as `b436dcb7b6310075a48b6ea1594ffc1b7c8020b6`; preview run 34408940052, production review 34409160306, and production apply 34409221406 succeeded. Production artifact 10126621959 has digest `sha256:08563192975bdfd869ed683ce62e2a92cdeee758e0a4340d6082ec0d0672d82f`. Production ledger and catalog were checked after apply. Issue #2439 remains open only for the PopDAM business-flow acceptance of the completed-job truth.
- #2440 is closed, but its owed preview rehearsal is still outstanding. Migration `20260909005945_chain_style_group_counts_to_rebuild_completion.sql` is merged but absent from preview. Its initial dependency refusal on open #2439 is obsolete; the later derivation-parser blocker #2652 was fixed by PR #2653, guarded-merged in run 34444022762 as `dc1b3835860408f0f90b2c28d22d6fd5150360f8` after Grok 4.6 and Qwen 3.8 Max approved exact head `cc4ab5f885ecd57f0423d4945858a3412f5d1a2a`. Issue #2652 is closed.
- #2466 is closed. PR #2634 merged as `ecfe38ac39956fe45f5ec6fdc2b00029e39f0d05`; `20260909132734_repoint_plm_item_list.sql` is on preview and remains absent from production.
- #2481 is closed. #2482 remains open and still depends on PopDAM repointing its six readers. #2580 is closed; PR #2627 merged as `e472592446826f1410449b23ab14adada69b514f`, and `20260909084253_sample_shipment_notice_outbox.sql` is on preview, not production. #2579 remains open and unstarted by this session.
- #2543 structural PR #2631 merged as `cc5ae41e4d03e1af08513adecaa4db36613bf56d`. Preview run 34433956340 succeeded; artifact 10135520140 digest is `sha256:e75270e4b5ec68cdc3d3500b60418154fc40d75bb5bbb89f807b5b373c44cc89`. Prerequisite restoration PRs #2642 and #2663 merged; issues #2657 and #2641 are fulfilled. Issue #2543 remains open for the owner-gated production and private data steps.
- #2622 structural PR #2651 merged as `7b82064e3264f2921cade463cbb046fb292d0da5`. Preview run 34437375367 succeeded; artifact 10136698313 digest is `sha256:2652f887634de20ff5a434eed967ca61b6589aee37d493cb9179d0cfba234dc8`. Restoration PR #2656 merged as `ad84f9281fefcd43321aabdc99c784a27e761520`; issue #2655 is closed. Issue #2622 remains open for owner-gated production.
- PR #2649/#2644 merged as `2dfd6de555ac47d88375c2b8f6987a50e4056041`; preview run 34420986240 succeeded, artifact 10130916817 digest `sha256:9fffb323dd483c998a2e163aaff36c2e84b7ea649e65078a89dbd01eac0c86e0`; #2644 is closed.
- Qwen's SHA-bound adapter repair PR #2667 merged as `236caf500edb01f78baf1d829855704b5d1093f9` and received live acceptance on PR #2653. Issue #2666 is closed.
- Preview ledger check at 06:13 UTC found 637 of 652 merged versions applied. Ten entries are retired/held. The five genuinely pending versions were `20260907030418`, `20260907031246`, `20260907051735`, `20260909005945`, and `20260909121403`. Do not broad-apply this list.
- Production ledger check at 06:16 UTC found 615 of 652 merged versions applied. Among the current session's work, `20260909084253`, `20260909115140`, `20260909121403`, `20260909132734`, and `20260909194231` are genuinely pending; `20260909220101` is base-absent until `20260909132734` is co-present or an exact resulting state is governed. Do not broad-apply.
- Open PR inventory at 06:02 UTC contained #2645, #2640, #2639, #2638, #2607, #2583, #2557, #2527, and #2526 besides then-open #2653. All nine predate this closeout and were conflicting with newer main; this session did not adopt or mutate them.
- The first closeout queue audit found four finished claims still consuming lanes. Claims #2443 (#2439), #2648 (#2644), #2650 (#2622), and #2630 (#2543) were released through the guarded `--release-claim` path only after their PR branches were proved closed. The final audit at 06:21 UTC accounted for all eight lanes: active claims #2524 and #2525; expired-unconfirmed claims #2574 and #2578; and four empty lanes. It reported one dispatchable issue, but Albert's no-new-work instruction means this session did not draw it. Claim #2574 on lane 3 has no PR and protects queued #2503; claim #2578 on lane 4 has an open PR and protects queued #2506/#2507. Expiry does not release their object locks. Re-run the audit; do not treat this timestamped snapshot as current.

## 4. Everything we tried that did not work

- `--prepare-preview-dispatch` persisted a `PREVIEW_READY` ref but did not create a GitHub run, despite the command name and standing description saying it dispatches. Exact-manifest workflow dispatch was therefore used for #2543 and #2622. Treat this as a tooling discrepancy; do not assume a ready ref means a run exists.
- #2440 preparation first refused with `migration dependency closure is incomplete: #2439`; #2439 was then completed in production. A second blocker appeared because `20260909005945` used prose after `-- derived-from:`. PR #2653 fixed only the exact immutable historical case without editing migration bytes or accepting general prose.
- #2543's first restoration pin did not match the corrected historical bytes. PR #2663 re-pinned the exact 61,299-byte migration before structural review and preview.
- Kimi reviewer calls hit provider quota. Qwen initially had stale sessions and a repository lock, and an earlier adapter could omit the mandatory governed-verdict SHA. Stale session metadata was preserved before deletion; PR #2667 fixed the adapter; the final normal adapter call produced durable Qwen replacement verdict `3fdbf2ead6f17f8e60b6943e3c37e6191a6f251b`. It took about 21 minutes with no streaming output but completed inside its 30-minute bound.
- Closeout PR #2668 itself required multiple governed rounds as its head changed. Kimi hit quota, one Grok wrapper was cancelled without a final answer, and one Qwen response used an extra parseable decision line so its findings were preserved but no verdict recorded. Muse initially misunderstood the intentional two-file evidence tail, then withdrew the block after reading the enforced verifier. Qwen's later findings exposed stale Qwen-roster prose, the missing successor `authorization:` field, incomplete lane accounting, a preview-ref literal, and an invalid one-file evidence tail; all were corrected before the final contract generation.
- Main moved repeatedly while PR #2653 was under review. Each move correctly voided the old evidence and verdicts, so the branch, contract, checks, both reviewer reservations, and reviews were refreshed before guarded merge.
- `gh pr merge --admin` is not a valid escape hatch here. Every merge named above used the repository's guarded merge path.
- The first guarded dispatch for closeout PR #2668, run 34445162477, failed before checkout because PowerShell passed `$j.headRefOid` as a literal property expression inside the external command. No repository or authorization state changed; storing the SHA in a scalar variable fixes the invocation.
- Worktree cleanup was deliberately not applied. Issue #2624 proves the current reap script can delete worktrees containing unpushed commits.

## 5. Root causes and key findings

- The #2440 derivation failure was metadata, not database structure: `scripts/migration_derivation.py` treated reserved `-- derived-from:` prose as a malformed machine declaration. The merged repair now uses `IMMUTABLE_NON_LEDGER_DERIVATIONS`, pinned to exact version and exact historical source text, before the normal parser.
- `AGENTS.md` previously taught only `LEGACY_DECLARATIONS`. This closeout adds the missing distinction: real migration ancestry belongs there; a proven pre-ledger source uses the exact non-ledger registry. Neither is permission to weaken parsing or guess ancestry.
- Reviewer validity is head-pinned and base-sensitive. Updating from main after review invalidates the verdict even when the functional change is unchanged.
- A reviewer marked busy is not necessarily doing useful work. Inspect wrapper session and process state; preserve evidence before reclaiming only demonstrably abandoned state.
- A successful preview apply is not production authorization. #2543 and #2622 deliberately stop at preview.

## 6. Exact next steps

1. Open a new orchestrator only with fresh owner authority and a new route ID. A marker opened on or after 2026-09-10 must carry `authorization: owner-current-chat <ISO-8601 instant>` from its own conversation, or `authorization: owner-authorized-handover #2629` only when Albert explicitly orders direct succession and the marker also says `handover_issue: 2629`. Resolve the marker and reread live GitHub/main/ledger state. It worked when exactly one marker resolves to the new route ID and the admission check accepts its authorization.
2. Re-run `node scripts/manage-migration-author-lanes.mjs --prepare-preview-dispatch 2440` from the new orchestrator worktree after exporting its route ID; then independently confirm whether a workflow run was actually created. If not, use only the emitted exact manifest to dispatch the bounded preview workflow. It worked when `20260909005945` is in the preview ledger and its rehearsal artifact is green.
3. Continue #2403's named DesignFlow non-production activation for `20260909121403`; do not confuse the shared preview database with that isolated target. It worked when the issue's target database is proved and its nine-table schema is verified there.
4. Obtain the three owner decisions in section 0 before any production or deployment mutation. Each worked only when the authorization is explicit in the current chat and the exact target/action is named.
5. For #2439, obtain live PopDAM business-flow proof that completed rebuild work is reported truthfully; then close the issue with that evidence. It worked when the application flow, not merely SQL or HTTP health, passes.
6. Resume queue selection from open `db-work` issues, prioritizing downstream blockers and creation time. #2482 and #2579 remain open; #2440, #2466, #2481, and #2580 are closed. It worked when every adopted item has a fresh claim and isolated worktree.
7. Do not run `scripts/reap-merged-worktrees.mjs --apply` until #2624 is fixed, reviewed, merged, and proved against local-only commits. It worked when the fixed dry run explicitly preserves such worktrees.
8. Inspect claims #2574 and #2578 against their issue, PR, branch, and worktree evidence, then use only the lane manager's explicit renew, resume, or close-out path. It worked when the audit no longer says `expired-unconfirmed` while every object remains protected or is safely transferred.

## 7. Constraints and gotchas in force

- Never reuse marker #2629 or route ID `01a085f2-a84f-7963-b474-e5770b149ecd`.
- Never run the lane manager from `C:\repos\shared-db`; its canonical copy can be stale. Use the new isolated orchestrator worktree and export its own route ID.
- Reserve both reviewer slots before invoking either. Never put two workers on one PR. Merge immediately after current-main, exact-head, checks, and both durable verdicts agree.
- Merge first, then rehearse preview. Re-merging main after review voids the head-pinned verdict.
- `--prepare-preview-dispatch` may only write readiness state; verify a run exists rather than trusting its name.
- Do not use `gh pr merge --admin`. Do not broad-apply ledger drift. Do not mutate production without current exact authority.
- #2624 forbids reap `--apply`. The many pre-existing worktrees remain intentionally untouched; this session's coordinator, #2543, #2622, and #2652 worktrees are clean and their PRs merged, so they are safe candidates only after the reaper itself is fixed.
- PR #2668's contract is pinned to base `dc1b3835860408f0f90b2c28d22d6fd5150360f8`. If `main` moves before its guarded merge, refresh the branch and re-publish the contract generation, completion report, both reviewer reservations, and both verdicts; none carries across the move.
- The Qwen review produced four low-priority hardening/doc observations. The live-doc gap was fixed here. The remaining test-hardening suggestions do not weaken the current exact pin and were not opened as new work because Albert explicitly stopped new intake.

## 8. Access and environment

- Machine: `EDGE-DEV`; repository: `C:\repos\shared-db`; this session's isolated coordinator worktree: `C:\repos\shared-db-worktrees\orch-01a085f2`.
- GitHub CLI was authenticated to `u2giants/shared-db`. Commit identity was verified as `Albert Hazan <u2giants@users.noreply.github.com>` before the closeout commit.
- Supabase access came through 1Password vault `vibe_coding`, existing item `Supabase CLI Personal Access Token`, field `SUPABASE_ACCESS_TOKEN`, via the protected `mcp.env` reference file. No value was printed or written into the repository.
- Secrets sweep: all owned diffs, untracked files, and the locally preserved Qwen incident evidence were checked; nothing new requires storage. The obsolete untracked PR #2653 prompt was removed from its exact worktree path.
- Docs pass: `AGENTS.md` was stale about immutable non-ledger derivations and the Qwen roster, while `docs/agents/section-4-anti-collision-rules.md` repeated the obsolete Qwen quarantine and omitted Qwen from its rotation sentence. All four in-scope live-document defects are corrected in this handoff PR. A final governed review also found contradictory historical reviewer comments in `scripts/manage-migration-author-lanes.mjs`; that executable file is outside this documentation contract and was not changed during closeout, so successors must continue treating the executable roster values as authoritative.

## 9. Open questions and risks

- Owner gates are exactly the three items in section 0; do not surface them piecemeal.
- #2440's rehearsal remains owed even though the issue is closed. The derivation gate is now repaired, but the next session must prove the dispatch/run and new preview evidence rather than carry forward an old claim.
- The readiness command/dispatch mismatch could strand future work as a ready ref with no workflow run. No new issue was opened because intake was stopped; the next orchestrator should compare live behavior with the current implementation before deciding whether an existing issue already covers it.
- The queue audit exits nonzero because open non-structural issues still require their declared reject/fork/repository-session routes and because claims #2574/#2578 need explicit reconciliation. It is not evidence that their locks may be manually deleted.
- Artifact digests are evidence only for their exact recorded run, head, and manifest; never carry one across a changed head or producer set.
- Production drift contains many unrelated retired, held, pending, and base-absent versions. This handoff is not authorization for any of them.
- Counts, SHAs, issue states, and PR states were live at the timestamps above and may move as soon as another session starts.

# Part B — per-agent and reviewer work

### Agent: pr2425_2403 / inherited issue #2403 worktree
- **Asked to do:** refresh PR #2425 from main and prepare exact-head governed review.
- **Actually did:** produced head `e5252b5b11e0cded4212129b78fda1f1d9dd869d`; root reserved both reviewer slots, reviewed, and guarded-merged it as `5874305e5ac200677ecb3e5ab7e265734e21cef6`.
- **Found:** merge completion and target activation are separate; `20260909121403` is still absent from shared preview and the isolated DesignFlow target.
- **PR / branch:** PR #2425 merged.
- **Worktree:** finished for merge; activation remains on issue #2403.
- **Deliberately did NOT do, and why:** did not apply to the wrong shared preview target.

### Agent: issue_2482
- **Asked to do:** assess whether #2482 could advance in the priority set.
- **Actually did:** no branch, commit, or PR attributable to this session; current issue state remains open.
- **Found:** retirement still waits for PopDAM to repoint six readers.
- **PR / branch:** none.
- **Worktree:** none attributable; safe from this session's perspective.
- **Deliberately did NOT do, and why:** did not retire live views before their consumers move.

### Agent: restore_2543_fix
- **Asked to do:** help restore the corrected historical #2543 migration evidence.
- **Actually did:** never initialized and produced no artifact; root interrupted the pending agent and completed the repair through PR #2663.
- **Found:** nothing independently.
- **PR / branch:** none from this agent.
- **Worktree:** none; finished/no state to recover.
- **Deliberately did NOT do, and why:** no work ran because the agent remained pending-init.

### Agent: pr2631_2543 / `C:\repos\shared-db-worktrees\issue-2543-opa-capture`
- **Asked to do:** author the Disney OPA coherent complete-capture structural contract.
- **Actually did:** PR #2631 head `d10061cd22ec4617fa1b52900d30ed7f0071c3f6`; root obtained Muse and Grok governed approvals after Kimi/Qwen failures, guarded-merged, and rehearsed preview.
- **Found:** corrected historical restoration bytes had to be re-pinned first.
- **PR / branch:** PR #2631 merged as `cc5ae41e4d03e1af08513adecaa4db36613bf56d`.
- **Worktree:** clean and finished; leave until #2624 makes cleanup safe.
- **Deliberately did NOT do, and why:** no production apply or private OPA data load without owner authority.

### Agent: pr2651_2622 / `C:\repos\shared-db-worktrees\issue-2622-merch-group-detail-key`
- **Asked to do:** preserve ColdLion category identity in the merch-group detail key.
- **Actually did:** PR #2651 head `548cd688b463de34bff62e4faf696c190a1bee85`; root merged prerequisite PR #2656, obtained Muse and Grok approvals, guarded-merged, and rehearsed preview.
- **Found:** the prior key collapsed 346 live rows because category was omitted.
- **PR / branch:** PR #2651 merged as `7b82064e3264f2921cade463cbb046fb292d0da5`.
- **Worktree:** clean and finished; leave until #2624 makes cleanup safe.
- **Deliberately did NOT do, and why:** no production apply without owner authority.

### Agent: qwen_adapter_repair / Codex task `01a088ae-625f-7ff2-9b68-dd2f91e4d0c6`
- **Asked to do:** route Qwen through the exact SHA-bound governed-verdict contract.
- **Actually did:** ai-devops PR #368 and shared-db PR #2667 merged; root proved the normal adapter live on PR #2653 and closed #2666.
- **Found:** stale Qwen session records and a repository lock can survive an interrupted zero-turn review; preserve `show` and transcript evidence before deleting only the abandoned record.
- **PR / branch:** shared-db PR #2667 merged as `236caf500edb01f78baf1d829855704b5d1093f9`; ai-devops PR #368 merged as `e03e51ca29ce5420ef1f1fdccf2dc4c5a42b1700`.
- **Worktree:** shared-db `qwen-requalify-20260910` remains; do not clean through the broken reaper.
- **Deliberately did NOT do, and why:** did not delete unrelated Qwen sessions or bypass provider/wrapper safety.

### Reviewers: Grok 4.6, Muse, Kimi K3, and Qwen 3.8 Max
- **Asked to do:** independent, exact-head governed reviews, always after both slots were reserved.
- **Actually did:** Grok and Muse supplied the required durable approvals across the merged PRs; Kimi failures were quota-bound; Qwen's final repaired run approved PR #2653 with four low-priority suggestions and durable replacement verdict `3fdbf2ead6f17f8e60b6943e3c37e6191a6f251b`.
- **Found:** reviewer provider availability and wrapper correctness are separate gates.
- **PR / branch:** verdict refs only; no authored branches.
- **Worktree:** disposable reviewer state; no database worktree ownership.
- **Deliberately did NOT do, and why:** failed/silent reviewers never counted as approval and no synthetic verdict was posted.

# Mandatory self-audit

1. **Fresh-developer continuity: YES.** Sections 1–3 define the system, objective, exact live state, environments, merged SHAs, runs, and remaining work; section 6 gives ordered acceptance gates.
2. **Full session knowledge: YES.** Sections 4–5 preserve the failed dependency, derivation, restoration, reviewer, main-movement, and dispatch dead ends plus their root causes.
3. **Every execution detail: YES.** Sections 0 and 6–9 cover owner authority, constraints, credentials by location only, risks, next commands/consequences, preview and production state, and cleanup prohibition; Part B separates every worker/reviewer stream known to this session.
4. **Owner-only completeness: YES.** A line-by-line owner/authorize/decision sweep of sections 1–9 and Part B found exactly #2543 production/private load, #2622 production, and #2290 deployment authority; all three appear with recommendations in section 0. The already-settled list prevents re-asking #2439 and the no-new-work/cleanup rulings.
