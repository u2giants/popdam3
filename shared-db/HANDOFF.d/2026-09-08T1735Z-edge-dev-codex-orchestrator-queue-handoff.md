---
issue: 2586
status: OPEN
owner: shared-db.orch/01a0812c-13ca-75e2-992c-b309b882a37d
---

# EDGE-DEV shared-db orchestrator queue handoff

## 0. DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message before starting work; do not raise the items one at a time.

### Blocking now

1. **Approve or continue holding production migration `20260907031246` for issue #2548.** No exact production authorization was found. Recommendation: keep it held until Albert explicitly names that version and production action.
2. **Supply the signed Laura/Ilona review for #1941.** All 2,880 curated decisions remain blank. Recommendation: keep #1941 and dependent #2541 blocked rather than guessing any licensed match.
3. **Settle the remaining 53 field decisions on #2179.** Recommendation: keep that source blocked; do not infer decisions from current payloads.

### Later owner gate, not blocking current implementation

4. **HTS machine-promoted precedents may become operative only after calibration.** The locked gate is at least 100 representative cases, at least 25 in the proposed family, zero known false promotions in that family, and a one-sided 95% precision lower bound of at least 97%. Recommendation: make no decision until Step 7 evidence exists; #2535 remains additive, non-operative structure.

### Already settled — do not re-ask

- 2026-09-08: this session may finish the inherited and transfer-priority queue through each governed gate; it does not waive exact target, review, preview, merge, or production proof.
- 2026-09-08: Albert authorized rotation of the exposed DesignFlow MCP and NAS MCP bearer credentials. Both were rotated in place; new credentials returned HTTP 200, retired credentials returned 403 and 401 respectively, and the local encrypted cache was retired.
- 2026-09-07: HTS Apply is not correctness evidence; Spark and Luna must form independent first opinions and final blind votes, and auto-promoted precedents remain non-operative during calibration.
- 2026-08-13: shared-db governs database shape, not ordinary application rows; outside-sourced curated Master Data remains gated.
- 2026-08-13: claims protect objects even when worker capacity is relinquished or a lease expires; never hand-delete claim refs.

## 1. What this application is

`u2giants/shared-db` is the canonical structure repository for the shared Supabase/PostgreSQL database used by PopDAM, PopPIM, PopCRM, DB Data Admin, and DesignFlow. One live orchestrator owns structural intake, exact object claims, isolated migration worktrees, independent reviews, serialized preview, guarded merge, production review/apply, and live verification. GitHub issues and immutable refs are the queue and audit trail; handoffs are context only.

The current marker is #2577 for route `01a0812c-13ca-75e2-992c-b309b882a37d` on EDGE-DEV. This handoff is paired with open documentation issue #2586. The canonical checkout at `C:\repos\shared-db` is landing-only and contains unrelated local state; all writes must use current-upstream isolated worktrees.

## 2. What we set out to do this session, and why

The session resumed the stale 2026-09-08 12:51Z queue handoff, re-resolved the live marker and current main, completed repository prerequisite PR #2575, then finished Asset freshness issue #2356/PR #2523 through preview, guarded merge, production review/apply, and live catalog proof. It then reconciled stale queue records, admitted new structural intake, recovered protected inherited work, filled the newly available author lane with #2535, and prepared exact continuation gates for every inherited and transfer-priority item.

The business objective is uninterrupted, truthful schema delivery: preserve every capability and claim, never treat a green check or merge as production acceptance, and never let stale handoff text override current GitHub, ledger, catalog, or marker state.

## 3. Current state — what is true right now

### Live coordination snapshot

- Checked 2026-09-08 17:34Z: `origin/main` is `fbd49fe829a33a225805334a0cdba662dfd44084`.
- Maximum migration on that exact tree is `20260907200221`.
- Marker #2577 resolves to this outgoing route. Close it only after this handoff PR is merged.
- Queue audit at 17:34Z found all 8 lanes occupied, no expired claims, no dispatchable structural issue, and no dependency cycle. It reports `fullyAudited: false` because known non-structural/curated items remain visible for routing; do not mistake that for an empty or free queue.
- No active shared preview, guarded-merge, or production operation ref existed at the last gate snapshot.
- Preview project `mvpkijzfmfcxhnzqogzs` has 641 main versions and 628 applied. Ten are retired/held; three genuinely pending versions remain: `20260907030418`, `20260907031246`, and `20260907051735`. Preview is not clean.

### Completed and immutable

- PR #2575 merged as `59f914dd8fddc75026ca2038dcb8507ef5f9de4c`; issue #2573 has immutable completion and is closed.
- Issue #2356/PR #2523 is complete. Migration `20260907152838` merged as current main `fbd49fe829a33a225805334a0cdba662dfd44084`. Preview run 34249227742, guarded merge run 34249557152, production review run 34249789308, and production apply run 34249862877 succeeded. Live production checks proved the ledger row, three columns, two constraints, enabled trigger, and guard function. Claim #2521 and issue #2356 are closed; the permanent version ref remains.
- The required reviewer record landed in `popcre/ai-devops` PR #331 as `4ffc32e61d463390652ab1126ed188adb57fa1ba`. The docs-only admin merge exception was used because an unrelated broken link on main blocked the merge queue; reviewer-safety passed and the hosted Windows job was not interrupted.
- #2449 immutable completion was repaired from production evidence for PR #2452, merge `c3fca1c...`, migration `20260907200221`, run 34224860332.
- #2476 was correctly forwarded to private `licensor-source-data` #67 and closed. Private data rebuild from #2576 was forwarded to private issue #61.

### Active structural queue and exact continuation order

1. **#2535 / PR #2584 / claim #2581 / version `20260908163250`.** Worktree `C:\repos\shared-db-worktrees\issue-2535-hts-debate`, branch `codex/issue-2535-hts-debate`, clean head `128733209636534336c81198001825c64bef903d`. CI is green. Grok 4.6 review sequence 1825 and lease `9d93044d6c8c92d1df3a770cc17fe46f58819796` were still active at freeze; no verdict existed. Do not replace an active reviewer. This security/migration contract needs two manager-assigned exact-head reviews before preview.
2. **#2582 / PR #2583**, the minimal historical-restoration prerequisite for #2493. Worktree `C:\repos\shared-db-worktrees\issue-2493-historical-restoration`, branch `codex/issue-2582-2493-historical-restoration`, clean head `1bc92f33090590ef5bc833bac229fefd72e43808`. All 14 required checks passed; Gemini sequence 1824 approved with durable verdict `a045243870f705d86b5097e72fc0f233f81891fb`. If main is unchanged, dispatch guarded merge with PR 2583 and that head. Then record immutable completion with `migration_versions: []`, close #2582, and resume #2493.
3. **#2493 / PR #2526 / claim #2524.** Authoritative worktree `C:\repos\shared-db-worktrees\orch-2559-2493`, branch `codex/issue-2493-source-resolution-new-kinds`. The locally refreshed head is `8f784633`; migration hash remains `7cff10dcf68d2ba8993201790e8c276d517fd2410efa049e3e2026504abf6c50`. It passed sidecars 44/44, contract 44/44, and disposable PostgreSQL with rollback. It was deliberately not pushed until #2583 removes the backdated-registry refusal. Four untracked `.ai/contract-drafts` files belong to another source and remain untouched.
4. **#2501 / PR #2527 / claim #2525.** Current recorded head `99acf4d...`. After #2493, refresh on current main, regenerate exact evidence, obtain inherited required reviews, preview, merge, production review/apply, and live proof. Its only known merge conflict is coordination metadata; never replace whole function bodies casually.
5. **#2506 / PR #2542 / claim #2510.** Recorded head `881087cf...`. It follows #2501 because both touch `public.search_style_guide_library_v2`. After guarded merge, immediately run post-merge preview plus the required combined historical proof for `20260907131610` and `20260907183041`, then production allowlist/review/apply. Create a correct current-head worktree; the old checkout is not on the authoritative branch.
6. **#2507 / claim #2578 / version `20260908134917`.** Worktree `C:\repos\shared-db-2507`, branch `codex/issue-2507-popsg-pdf-v2`, head `42db7a18347deb92f48330f4f768be2b1147492f`. SQL, contract validation, 44 tests, and whitespace passed. The behavior suite was authored but not run because the worker lacked Docker/PostgreSQL. No PR or review exists.
7. **#2439 / PR #2447 / claim #2443.** Recorded head `e8b8a3d...`. The additive `public.bulk_operation_runs` migration version `20260907200137` is now backdated. Preserve the divergent old checkout, create a fresh PR-head worktree, read ledger, and use only the guarded active-claim supersession path. Never rename the migration manually. Production authorization must be re-established at its exact future version.
8. **#2403 / PR #2425 / claim #2418.** Recorded head `c6805e2...`; separate target is `xupnyeifmpsacrqahwwm`, not shared preview/production. No governed target-specific apply lane exists, so shared preview and manual apply are forbidden. Keep the claim protected until a target lane supplies exact apply and acceptance proof. #2580 waits behind it in the same lane.
9. **#2503 / claim #2574.** No worker/worktree was found. Narrow its scope to the seven bootstrap tables; `licensor_id` is an application-contract correction, not new schema. Expiry never releases its protected objects.
10. **#2543, then #2576, then #2579** share the source-inventory collision lane. #2543 has no claim/PR and must preserve the 10-column inventory contract. #2576 has 3 writes and exact 31-definition reads, no claim/branch/PR. #2579 is the all-licensor coverage/TrackerPlus structural package with exact exposed/not-applicable/blocked classification and private successors #68 and #69; it also has no claim/SQL. Do not reorder them without a fresh overlap and dependency audit.
11. **#2357** remains blocked until #2543 and the private OPA complete capture/load finish. Amend its exact reads before any new claim. Its old claim #2522 was released; version `20260907152920` is permanently unusable.
12. **#2580** is admitted but undispatched behind #2403. Its exact two-table notice contract and claim function include immutable `provider_idempotency_key`; the application uses that value for Brevo idempotency and the retry contract permits five attempts no faster than five minutes within the 30-minute provider window.

### Non-structural and blocked items

- #1941 and #2541 are curated Master Data forks and stay blocked on signed human decisions.
- #2548 is an owner-decision structural item; no production action without exact authorization for `20260907031246`.
- #2538 is repo-maintenance and must be handled by a separately started repo session, not this orchestrator.
- #2590 is closed. PR #2592 merged the permanent fix: documents-only classification now runs before agent-contract enforcement, so prose-only PRs do not need the JSON evidence pair and do not consume an external reviewer.
- #2179 remains blocked on 53 owner field decisions and its source prerequisites.
- Open repo-maintenance items shown by queue audit are visibility only. Do not consume orchestrator context or author lanes for them.

### Plan continuity and documentation drift

The full licensing Master Data, PopSG production-readiness, and HTS dual-model debate plans were re-read at closeout. Their downstream ordering remains valid. The licensing STATUS snapshot dated 2026-09-04 still calls #2356 unproven; today’s immutable/live evidence above supersedes that row, and issue #1090 remains the open documentation tracker for a later coherent status update. The HTS plan remains at Step 1; #2535 is only its shared-db structural unit. PopSG remains dependent on #2506/#2507 plus application-side acceptance and must not be called production-ready from schema delivery alone.

## 4. Everything we tried that did NOT work

- A stale marker/handoff target was initially present. Reusing it would have delegated into a closed session, so it was rejected; marker #2577 was created and re-resolved live.
- #2493 could not be pushed after a normal current-main refresh because the historical version registry lacked exact restoration authority. Renaming the migration would destroy content-addressed evidence, so the narrow no-migration prerequisite #2582/PR #2583 was created instead.
- Reviewer draws for #2583 encountered Kimi insufficient quota, Qwen staleness, and a Muse REVISE on an older evidence head. None was treated as approval. The current-head Gemini approval is the valid durable verdict.
- #2535’s first reviewer acquisition briefly hit the shared lock. Retrying after the lock cleared was valid; replacing the now-active Grok reviewer is not.
- Queue-audit output is large and can time out at 30 seconds. Use a bounded running session and poll once; do not infer an empty queue from no initial output.
- The PopSG preview-stats timeout was not repaired by raising timeouts. Its structural path was kept bounded and queued; application acceptance remains separate.
- This handoff PR initially hit a contradictory gate: adding mandatory `.agent` evidence made prose consume an external reviewer. PR #2592 fixed the workflow by classifying prose before enforcing the evidence pair. Future prose-only PRs carry no pair, retain every automated check, and use the guarded docs-only merge path without an external review.
- A broad Windows process query exposed two bearer values in private tool output. Never inspect process command lines broadly; use targeted process identity/status checks that omit command-line arguments.

## 5. Root causes and key findings

- Repository state, review evidence, and database acceptance are independently mutable. Exact-head review becomes stale after a head/base/evidence change, and a merged migration is invisible to a catalog until applied.
- Historical content-addressed migrations need a hash-bound restoration registry before a backdated-but-valid file can pass current guards. PR #2583 supplies only that evidence and intentionally ships no migration.
- Author lanes are capacity, while claims are protection. A missing worker or expired lease never authorizes reuse of a version or object.
- Preview is a shared mutable resource and currently has three genuine pending versions. Every preview dispatch must re-resolve the marker, prepare dispatch, and recheck the fresh ledger/selector instruction.
- #2535 changes both migration and security contracts, so one green review is insufficient; it needs the configured second independent review.
- #2403’s database is a separate target with no sanctioned apply lane. Its code can remain preserved, but neither shared preview nor manual production-style application can substitute for target acceptance.
- #2543/#2576/#2579 share inventory function/view objects and must be serialized even though their business sources differ.
- The inherited whole-plan ordering has not changed: additive structure before application dependency, private data after production structure, and authenticated business-flow proof after deployment.

## 6. Exact next steps

1. Run marker resolution, fetch `origin/main`, inspect marker #2577/#2586, rerun queue audit, and verify no preview/merge/production ref appeared. **You’ll know it worked when** current GitHub/main/claim/ledger state agrees with or explicitly supersedes this snapshot.
2. Create the successor marker for the new route before delegating anything; never reuse #2577 after it closes. **You’ll know it worked when** `--resolve` names only the new live route and a reply confirms reachability.
3. Recheck PR #2583 head/base/checks/verdict. If main remains `fbd49fe...`, dispatch `guarded-migration-merge.yml` for PR 2583 and head `1bc92f33090590ef5bc833bac229fefd72e43808`; otherwise refresh and reacquire current-head evidence first. **You’ll know it worked when** GitHub reports merged, the merge is on current main, #2582 has immutable `merged` completion with no migration versions, and #2582 is closed.
4. Resume #2493 only after step 3. Push the already-tested refreshed head, verify exact migration bytes, obtain both inherited manager-assigned exact-head reviews, prepare preview, recheck ledger/selector, then preview, guarded merge, production review/apply, and live proof. **You’ll know it worked when** issue #2493 and claim #2524 close from immutable production evidence without changing the four foreign drafts.
5. In parallel only where the governance engine permits, monitor #2535’s existing Grok lease/process. Validate its verdict when durable, then obtain the required second manager-assigned review. Do not preview until both exact-head reviews and release checks pass. **You’ll know it worked when** two valid current-head verdicts exist and the preview selector produces the matching dispatch instruction.
6. Continue #2501, then #2506, preserving whole function contracts and regenerating evidence after each main movement. **You’ll know it worked when** each exact migration has review, preview, merge, production apply, and live contract proof; #2506 also has the combined historical preview proof.
7. Finish #2507’s disposable-database behavior suite before opening its PR. **You’ll know it worked when** rollback and behavior assertions pass in PostgreSQL and the PR contains only the claimed migration/tests/evidence.
8. Recover #2439 only through guarded active-claim supersession after a fresh ledger read; preserve the old divergent checkout. **You’ll know it worked when** the new version is tool-issued, exact content is preserved, and all review/preview gates bind the replacement.
9. Keep #2403 frozen until a governed lane exists for `xupnyeifmpsacrqahwwm`; do not use shared preview. **You’ll know it worked when** a repository-backed workflow can apply and verify the exact head on that target without manual SQL.
10. When capacity opens, re-run overlap/dependency audit and follow the selector. Preserve source lane order #2543 → #2576 → #2579 and #2403 → #2580 unless current evidence changes it. **You’ll know it worked when** every dispatched issue has a live exact-object claim and isolated current-main worktree.
11. After each phase, re-read all downstream phases in the relevant plan and record whether ordering, dependencies, or acceptance gates changed. **You’ll know it worked when** the plan STATUS/evidence is updated from artifacts, not remembered counts.
12. Before any final closeout, run the secrets/licensed-data sweep, docs pass, per-agent verification, queue seed audit, and handoff self-audit. **You’ll know it worked when** no obligation exists only in prose and every completion has a current artifact.

## 7. Constraints and gotchas in force

- Keep `C:\repos\shared-db` landing-only. All write-capable work starts from current upstream in isolated worktrees.
- Re-resolve marker, current main, PR head/base, claim, target, ledger, review, preview, merge, and production state at every gate. This handoff is not live proof.
- Never dispatch a structural item without a successful exact-object claim and tool-reserved 14-digit migration version.
- Never run a reviewer outside the manager-selected provider/wrapper. Do not replace an active reviewer or treat a timeout/quota/stale verdict as approval.
- Two reviews are required where migration/security contract policy says so. Preview, merge, production review, apply, and live verification are separate gates.
- No manual preview or production SQL. Use only the matching selector/workflow instruction after a fresh ledger check.
- Preserve capabilities and unrelated files. Do not reset, clean, force-remove, weaken tests, raise timeouts, rewrite historical migrations, or hand-delete coordination refs.
- Licensed rows, filenames, contracts, provider payloads, and private source evidence stay private. Public artifacts contain only safe aggregates, hashes, and contract facts.
- Production/shared infrastructure is read-only unless Albert names the exact resource and action in the current conversation.
- GPT-5.6 uses low or medium reasoning only. DesignFlow changes use sandbox branches/PRs to `develop` and are never self-merged.
- Do not call deployment health acceptance. The owning application must still prove its authenticated business flow at the exact deployed SHA.

## 8. Access and environment

- Host: EDGE-DEV, PowerShell, workspace `C:\repos\shared-db`.
- GitHub CLI is authenticated for `u2giants`; DesignFlow repositories use the `popcre` organization.
- Supabase secrets live in 1Password vault `vibe_coding`; use protected injection and never print values. Preview checked here was `mvpkijzfmfcxhnzqogzs`; production identity must be freshly proven before any action.
- Current handoff worktree: `C:\repos\shared-db-worktrees\orchestrator-handoff-rapid-close`, branch `codex/orchestrator-handoff-20260908-rapid-close`.
- Active structural worktrees and branches are named in section 3. Treat every other dirty, locked, divergent, or untracked worktree as owned until independently proven otherwise.
- Relevant plans: `plan_licensing_master_data_implementation.md`; PopSG `plan_popsg_production_readiness.md` in `u2giants/popdam3`; HTS debate `plan_hts-rag-dual-model-debate-promotion.md` and count-based graduation plan in DesignFlow backend.

## 9. Open questions and risks

- 2026-09-08: the exposed DesignFlow MCP and NAS MCP bearer credentials were rotated and the retired credentials were proved unusable. Continue to avoid diagnostics that print process command lines.
- 2026-09-08: #2548 exact production authorization is absent. Keep held.
- 2026-09-08: #2439’s final superseding version does not exist yet, so production authorization must bind the replacement exact version after safe supersession.
- 2026-09-08: #2403 cannot reach target acceptance without a governed lane for `xupnyeifmpsacrqahwwm`; creating or changing that lane is repository/infrastructure work outside an author claim.
- 2026-09-08: claims #2574, #2524, and #2443 had no active worker at different points. They remain protected; renew or recover through the lifecycle tool, never from expiry alone.
- 2026-09-08: main movement invalidates the ready-to-dispatch condition for PR #2583 and may stale any review or evidence. Re-evaluate before pressing the gate.
- 2026-09-08: preview has three genuinely pending migrations. Any manual or broad apply could mingle unrelated work and destroy attribution.

## Part B — every sub-agent from this session

### Agent: finish_2575_2356 / `C:\repos\shared-db-worktrees\issue-2356-restoration` and `orch-2559-2356`
- **Asked to do:** Finish the historical-restoration prerequisite and carry #2356 through governed delivery.
- **Actually did:** Merged PR #2575, completed exact review/preview/guarded merge/production gates for PR #2523, and verified live production structure for migration `20260907152838`.
- **Found:** Historical evidence needed the narrow restoration prerequisite before the real migration could move.
- **PR / branch:** #2575 merged `59f914dd...`; #2523 merged `fbd49fe...`; branches `codex/issue-2573-2356-historical-restoration` and `codex/issue-2356-asset-freshness`.
- **Worktree:** finished; cleanup only through the cleanup skill after marker closure and fresh PR-state proof.
- **Deliberately did NOT do, and why:** Did not remove permanent version/evidence refs or unrelated worktrees; they are audit/protection state.

### Agent: reconcile_queue
- **Asked to do:** Reconcile inherited issue/claim/PR truth and rank blockers.
- **Actually did:** Produced the current dependency and collision picture used in section 3.
- **Found:** Claims protect work independently of workers; several records were stale or underspecified.
- **PR / branch:** N/A; read-only queue work.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** Did not mutate claims or dispatch work without exact scope.

### Agent: issue_2507 / `C:\repos\shared-db-2507`
- **Asked to do:** Author the PopSG PDF extraction structural unit.
- **Actually did:** Authored migration `20260908134917`, tests, and evidence at head `42db7a18347deb92f48330f4f768be2b1147492f`; static/contract/44-test checks passed.
- **Found:** The disposable PostgreSQL behavior suite could not run in that worker environment.
- **PR / branch:** No PR; `codex/issue-2507-popsg-pdf-v2`.
- **Worktree:** live and resumable.
- **Deliberately did NOT do, and why:** Did not open a PR or claim behavioral acceptance without the database suite.

### Agent: recover_inherited_claims
- **Asked to do:** Inspect #2493 and #2439 protected claims/worktrees without loss.
- **Actually did:** Identified authoritative/recovery paths and preserved divergent/untracked state.
- **Found:** #2493 could refresh safely but was blocked by historical registry; #2439 requires a fresh worktree and guarded supersession.
- **PR / branch:** Existing PRs #2526 and #2447.
- **Worktree:** finished read-only recovery analysis; underlying author worktrees remain live.
- **Deliberately did NOT do, and why:** Did not reset, clean, rename migrations, or remove claims.

### Agent: reconcile_2449_2576
- **Asked to do:** Repair #2449 completion truth and classify #2576.
- **Actually did:** Published #2449 immutable production completion and corrected #2576 to structural-only scope with private data work forwarded.
- **Found:** #2576 needs 31 exact function-definition reads to preserve the current contract.
- **PR / branch:** #2449 used merged PR #2452; #2576 has no PR/branch.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** Did not mix private row rebuild into public structural delivery.

### Agent: clear_queue_debt
- **Asked to do:** Clear malformed/unrouted queue debt.
- **Actually did:** Forwarded #2476 to private issue #67 and closed the public misroute.
- **Found:** Non-structural work was consuming audit visibility but did not belong in an author lane.
- **PR / branch:** N/A.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** Did not perform private source-data work in the orchestrator.

### Agent: repair_queue_records
- **Asked to do:** Correct incomplete scope blocks and dependency records.
- **Actually did:** Corrected #2541, #2548, #2538, #2357, and related queue metadata.
- **Found:** #2548 lacks exact production authorization and #2357 depends on #2543 plus private OPA completion.
- **PR / branch:** N/A; issue metadata/comments only.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** Did not turn owner-decision or blocked work into dispatchable work.

### Agent: intake_2579
- **Asked to do:** Admit the all-licensor property-source coverage request precisely.
- **Actually did:** Expanded #2579 to exact TrackerPlus tables/functions, inventory/API contracts, coverage manifest, validator/tests, and per-source classifications; opened private successors #68 and #69.
- **Found:** #2579 collides with #2543/#2576 on source inventory objects and must follow them.
- **PR / branch:** No structural PR/branch.
- **Worktree:** finished intake.
- **Deliberately did NOT do, and why:** Did not claim objects or copy licensed data into the public issue.

### Agent: classify_2538
- **Asked to do:** Decide whether #2538 is structural queue work.
- **Actually did:** Classified it as repo-maintenance outside the orchestrator.
- **Found:** It changes repository tooling, not database shape.
- **PR / branch:** N/A.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** Did not spend an author lane on non-structural work.

### Agent: preflight_2493
- **Asked to do:** Derive the exact safe continuation for #2493.
- **Actually did:** Verified whole-body function/view scope, prerequisite, review count, and full preview/production sequence.
- **Found:** Current database overlap is clear, but historical registry blocks publication before #2583.
- **PR / branch:** Existing PR #2526.
- **Worktree:** finished preflight; author worktree live.
- **Deliberately did NOT do, and why:** Did not publish or dispatch gates before the prerequisite.

### Agent: preflight_2501
- **Asked to do:** Derive exact continuation for #2501.
- **Actually did:** Confirmed current head, three whole-body functions, sequencing after #2493, and governed authorization scope.
- **Found:** Coordination metadata conflicts must be refreshed without losing function behavior.
- **PR / branch:** #2527, head `99acf4d...`.
- **Worktree:** finished preflight.
- **Deliberately did NOT do, and why:** Did not refresh/review while its predecessor still owned the lane sequence.

### Agent: preflight_2506
- **Asked to do:** Derive exact continuation for PopSG search v2.
- **Actually did:** Confirmed sequencing after #2501 and the required combined historical preview proof.
- **Found:** No correct authoritative worktree currently exists for the recorded PR branch.
- **PR / branch:** #2542, head `881087cf...`.
- **Worktree:** finished preflight; successor must create a fresh current-head worktree.
- **Deliberately did NOT do, and why:** Did not mutate a mismatched checkout.

### Agent: preflight_2439
- **Asked to do:** Recover the bulk-operation audit migration safely.
- **Actually did:** Established the exact additive scope and guarded supersession requirement.
- **Found:** Version `20260907200137` is backdated and the old checkout diverged; no explicit production authorization was recorded.
- **PR / branch:** #2447, head `e8b8a3d...`.
- **Worktree:** finished preflight; old worktree intentionally preserved.
- **Deliberately did NOT do, and why:** Did not rename the migration, overwrite the checkout, or infer production permission.

### Agent: preflight_2403
- **Asked to do:** Determine how #2403 can reach its separate database target.
- **Actually did:** Verified target `xupnyeifmpsacrqahwwm`, existing PR/claim, and the absence of a governed target lane.
- **Found:** Shared preview and manual apply are invalid substitutes.
- **PR / branch:** #2425, head `c6805e2...`.
- **Worktree:** finished preflight.
- **Deliberately did NOT do, and why:** Did not mutate either shared database or invent infrastructure authority.

### Agent: preflight_2543
- **Asked to do:** Establish exact admission/order for OPA capture structure.
- **Actually did:** Verified dependency #1883 complete and the 10-column inventory contract that must survive.
- **Found:** Direct collision with #2576/#2579 requires serialization.
- **PR / branch:** No claim/PR/branch.
- **Worktree:** finished preflight.
- **Deliberately did NOT do, and why:** Did not dispatch while all lanes were occupied.

### Agent: preflight_2357
- **Asked to do:** Reassess licensing candidate/review API readiness.
- **Actually did:** Confirmed it remains blocked and that its reads are incomplete.
- **Found:** #2543 plus private OPA complete capture/load are prerequisites; old version `20260907152920` cannot be reused.
- **PR / branch:** None current; old claim #2522 released.
- **Worktree:** finished preflight.
- **Deliberately did NOT do, and why:** Did not reclaim or reuse a retired version.

### Agent: preflight_2576
- **Asked to do:** Confirm exact structure and preservation reads for the inventory repair.
- **Actually did:** Derived three writes and 31 live-definition dependencies.
- **Found:** Private data rebuild is separate issue #61 and the structural item collides with #2543/#2579.
- **PR / branch:** No claim/PR/branch.
- **Worktree:** finished preflight.
- **Deliberately did NOT do, and why:** Did not combine data mutation with schema work.

### Agent: intake_2580
- **Asked to do:** Admit the DesignFlow sample-shipment notice contract.
- **Actually did:** Defined exact tables, recipient snapshots, claim result, provider idempotency key, and bounded retry semantics in issue comments.
- **Found:** It shares lane 1 behind #2403 but does not overlap its HTS objects.
- **PR / branch:** No claim/PR/branch.
- **Worktree:** finished intake.
- **Deliberately did NOT do, and why:** Did not dispatch without lane capacity.

### Agent: issue_2535 / `C:\repos\shared-db-worktrees\issue-2535-hts-debate`
- **Asked to do:** Author HTS dual-model debate/promotion audit structure.
- **Actually did:** Created PR #2584 at clean head `128733209636534336c81198001825c64bef903d`; all CI passed, including the 5m24 isolated SQL suite; started manager-assigned Grok review sequence 1825.
- **Found:** The evidence tail initially had the wrong commit shape and was corrected before review; this change requires two reviews.
- **PR / branch:** #2584 / `codex/issue-2535-hts-debate`.
- **Worktree:** live and resumable.
- **Deliberately did NOT do, and why:** Did not replace the active reviewer or touch preview, merge, production, DesignFlow code, claim release, or licensed/provider data.

### Agent: record_2356_review
- **Asked to do:** Permanently record the required #2356 external review in `popcre/ai-devops`.
- **Actually did:** Merged docs-only PR #331 as `4ffc32e61d463390652ab1126ed188adb57fa1ba` after reviewer-safety passed.
- **Found:** The merge queue was blocked by an unrelated broken link already on main.
- **PR / branch:** popcre/ai-devops #331, merged.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** Did not interrupt the hosted Windows job or treat the unrelated link failure as a code failure.

### Agent: finish_2493 / `C:\repos\shared-db-worktrees\orch-2559-2493`
- **Asked to do:** Refresh, test, and continue #2493 without losing local drafts.
- **Actually did:** Normal-merged current main to local head `8f784633`; preserved migration bytes and four untracked drafts; passed sidecars, contracts, and disposable PostgreSQL/rollback.
- **Found:** Push remained blocked by the backdated historical-registry guard.
- **PR / branch:** #2526 / `codex/issue-2493-source-resolution-new-kinds`.
- **Worktree:** live and resumable after #2583.
- **Deliberately did NOT do, and why:** Did not push through the guard, rename the migration, or touch foreign drafts.

### Agent: repair_2493_registry / `C:\repos\shared-db-worktrees\issue-2493-historical-restoration`
- **Asked to do:** Build the smallest safe registry prerequisite for #2493.
- **Actually did:** Opened PR #2583 at head `1bc92f33090590ef5bc833bac229fefd72e43808`, passed all required CI and exact-byte mutation tests, and obtained current-head Gemini APPROVE sequence 1824.
- **Found:** Exact pins independently match PR #2526 blob `2b1af5e2...`: version `20260907154543`, statement bytes 6091, statement SHA `4464c6d2...`, file SHA `7cff10dc...`, and objects `plm.source_resolution_target_missing` plus `api.source_resolution`.
- **PR / branch:** #2583 / `codex/issue-2582-2493-historical-restoration`.
- **Worktree:** live and clean at the guarded-merge boundary.
- **Deliberately did NOT do, and why:** Did not merge while main could still move, mutate #2493’s migration/tests, or touch any database/claim/preview/production object.

## Queue seed and closeout audit

Every outstanding item above has an open GitHub issue: #2535, #2582, #2493, #2501, #2506, #2507, #2439, #2403, #2503, #2543, #2576, #2579, #2357, #2580, #1941, #2541, #2548, #2179, and documentation handover #2586. Repo-maintenance #2590 is resolved by merged PR #2592. Private successors are licensor-source-data #61, #67, #68, and #69. Nothing outstanding exists only in this file.

Secrets/licensed-data sweep: no credential value, licensed row, filename, contract row, provider payload, or private artifact is present in this handoff or its branch. The two exposed credentials were rotated, their retired values were denied by both services, and no repository copy was created.

Docs pass: no operating document changed in this session except this handoff. Known plan STATUS drift is explicitly recorded in section 3 and remains attached to open tracker #1090 rather than silently rewritten from partial queue work.

Self-audit:

1. Could a new session continue without this chat? **Yes** — exact branches, heads, worktrees, claims, versions, order, blockers, and gates are above.
2. Are unsuccessful attempts and deliberate omissions preserved? **Yes** — sections 4 and Part B name them separately.
3. Does every unfinished deliverable have a queue item and verification gate? **Yes** — the queue seed maps every survivor to an open issue.
4. Would Albert see every decision by reading only section 0? **Yes** — #2548, #1941, #2179, and the later HTS operative gate are consolidated there; credential rotation is recorded as settled.

Exact fresh-session prompt:

> Resume `C:\repos\shared-db` as the sole orchestrator from `HANDOFF.d/2026-09-08T1735Z-edge-dev-codex-orchestrator-queue-handoff.md`. Re-resolve the live marker and current main, create your own marker, finish #2582/PR #2583 and then #2493/PR #2526, preserve #2535/PR #2584's active Grok review, and continue the inherited and transfer-priority queue through every governed review, preview, merge, production, and live-verification gate. Re-read all downstream plan phases after each phase and report any drift before continuing.
