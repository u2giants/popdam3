---
issue: 770
status: OPEN
owner: codex/top-five-closeout-20260907
---

# HANDOFF — top five non-orchestrator blockers (2026-09-07 12:12Z, edge-dev/codex)

> The contract issue is #770. This file also tracks open issues #1031 and #1090. Issues #771 and #810 are complete and closed.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### BLOCKING

1. **Issue #770: authorize the production-only measurements.** Recommended wording is already recorded verbatim in the 2026-09-05 01:15Z issue comment. Albert must authorize both: (a) an aggregate-only duplicate check against Cloud SQL `designflow.productUserAssignment`, and (b) a read-only-source copy rehearsal from Cloud SQL schema `designflow` into a new dated scratch schema on Supabase preview `mvpkijzfmfcxhnzqogzs`. This authorizes no production write, cutover, or infrastructure change.

### RECOVERABLE

None.

### NOT PART OF THIS WORK, AND NOBODY IS ON IT

None found during closeout.

### Already settled — do NOT re-ask

- #1031: Albert confirmed on 2026-09-06 that the privacy-safe ColdLion email was sent on 2026-09-03 at 21:21 EST. Do not ask him to resend it. The issue is waiting on its documented vendor-response window.
- #771 and #810: both are production/live complete and closed. Do not repeat their rehearsals or acceptance tests.
- #1090: no licensing consolidation or curated-row write is authorized. Successor #2336 may build the guarded structural engine only; any later data apply needs separate authority.

The next session must put the complete BLOCKING list above to Albert in one message before attempting #770.

## 1. What this application is

`u2giants/shared-db` is POP Creations' governed source of truth for the structure of the shared Supabase database used by CRM, DAM, PM/PIM, and DesignFlow PLM. It stores migrations, database contracts, business-rule documentation, and coordination tooling. Structural changes are dispatched by one live orchestrator into isolated worktrees, reviewed at the exact commit, rehearsed on preview, merged, applied to production, and verified from the live catalog or business flow.

The relevant external systems are Google Cloud SQL instance `lithe-breaker-323913:us-central1:creatiflow-database`, the shared Supabase preview project `mvpkijzfmfcxhnzqogzs`, and the shared production Supabase project. Issue #770 concerns moving the legacy DesignFlow `designflow` schema from Cloud SQL to Supabase without restoring retired DesignFlow licensing authority. Issue #1031 concerns a private disk-only ColdLion history capture tool. Issue #1090 is the tracker for the canonical licensing Master Data architecture.

## 2. What we set out to do this session, and why

Albert asked for the five non-orchestrator GitHub issues that blocked the most other issues and asked that as many as possible be advanced simultaneously through production. The identified set was #771, #770, #810, #1031, and #1090. The session coordinated and monitored the governed work while preserving production authorization, licensed-data privacy, exact-target proof, and the single-orchestrator rule.

Closeout was invoked after #771 and #810 completed, #1090 advanced through several successors, and #770/#1031 reached external gates. Scope is now frozen: this handoff records remaining work but starts nothing new.

## 3. Current state — what is true right now

- **#771 — CLOSED 2026-09-05 00:31Z.** The locked preview rehearsal processed 1,006,439 rows. All 97 main steps and 10 sequence plans passed; constraints, foreign keys, hashes, teardown, and lock release passed. Peak scratch use was 537,387,008 bytes (512.5 MiB).
- **#810 — CLOSED 2026-09-05 08:49Z.** Realtime migration #2331 reached production. Live build `2936cb4` passed the authenticated two-tab DAM test: edit and restore returned HTTP 204 and propagated automatically; the marker was absent and the original empty value was restored. Evidence: `https://github.com/u2giants/shared-db/issues/810#issuecomment-5550693290`.
- **#1031 — OPEN.** Tooling PR #2328 merged at `3d282d559963110efed07e44700b671b38fff84a`. The private capture completed 451 seven-day windows, 2,406 requests/pages, and 207,423 retained rows; no database or schema write occurred. Albert confirmed the vendor email send time as 2026-09-04 02:21Z. The issue remains open for the documented response clock/window, not for another owner action.
- **#1090 — OPEN.** Plan PR #2337 merged at `12e79fac`. Successor #2333 is production-complete and closed (`373e1b15`, migration `20260905083426`). #2334 and its claim #2405 closed on 2026-09-07 after production completion. #2355 closed after PR #2415 merged at `b0ccbc3752bc3b31c1f9e77aedc6ce760756332c` and production verification. #2335 is closed. The next structural successor is #2336, still open and machine-marked blocked on #2333/#2334/#2335 even though all three are now closed; it has no comments.
- **#770 — OPEN and owner-blocked.** #771, #1315, and #778 are complete. The only configured nonproduction database is shared preview `mvpkijzfmfcxhnzqogzs`; it is technically suitable for a new isolated scratch schema but is not authorized to receive production rows without Albert's exact approval in §0.
- **Current orchestrator marker:** live resolution at closeout returned open marker #2497, route ID `01a07bc6-6f87-7ad0-91bc-ce12706e6506`, engine `codex`, session `shared-db.orch local dependency queue`, machine `local`. Re-resolve immediately before every delegation because markers change.
- **This closeout branch:** `codex/top-five-closeout-20260907`, created from current `origin/main` at `3c62ce52`. This handoff is the only intended change. It is documentation only; no application code, migration, data, preview, or production change was made.
- **Canonical checkout:** `C:\repos\shared-db` was 95 commits behind `origin/main` and contained unrelated `.mcp.json` plus two untracked older handoffs. Those paths were not modified, staged, moved, or deleted.

## 4. Everything we tried that did NOT work

1. **Treating #770's title as the current blocker was stale.** The title still says it is gated by #771, but #771 is closed. Live comments prove the actual blocker is the two exact owner authorizations. Do not reopen or repeat #771.
2. **Treating #1031 as waiting for Albert to send the vendor email was stale.** The earlier handoff said that, but the 2026-09-06 issue comment records the exact send time. It now waits on the vendor-response window.
3. **Treating #2334/#2405 as active was stale after 05:16Z on 2026-09-07.** Both are closed. The remaining #1090 structural successor is #2336.
4. **The handoff standard was not found at `templates/system/handoff-standard.md` in the shared-db checkout.** The complete standard was read from `C:\Users\ahazan\.codex\worktrees\0bda\ai-devops\templates\system\handoff-standard.md`; this file follows all required sections and audit questions.
5. **Writing the handoff in the canonical checkout was unsafe.** That checkout was behind and dirty with other sessions' files. A fresh isolated worktree was created from current `origin/main`, preserving all unrelated work.

## 5. Root causes and key findings

- #770 is not technically blocked by preview availability. It is blocked because production rows may not be queried or copied without exact current authority. The smallest useful rehearsal is already specified in its 2026-09-05 comment.
- #771 measured only the in-preview portion. It did not measure Cloud SQL network export, Supabase restore, freeze-time deltas, repoint/restart, or authenticated smoke tests, so total downtime remains unknown.
- The `AuditLog` high-water mark must use `id`, never `actionDate`; 32,823 historical rows had timestamps that moved backward relative to `id`.
- #1031's delivery and private capture are complete. The remaining wait is external and time-based; it must not trigger another scrape, vendor email, or database write.
- #1090 is a tracker, not a single migration. Its successor chain must stay serialized. #2336 requires hash-pinned preview/apply functions, immutable plan/audit facts, collision and authorization refusals, idempotency, rollback evidence, preview, independent review, guarded merge, production apply, and live catalog proof. It explicitly authorizes no consolidation or curated licensing row write.

## 6. Exact next steps

1. **Re-resolve the orchestrator marker** with `node scripts/check-orchestrator-marker.mjs --resolve`. Use only the newly returned open marker. **Gate:** the command names exactly one open marker and route; a closed or ambiguous marker means stop.
2. **Advance #2336 through the orchestrator.** Have the current orchestrator reclassify it from blocked to ready only after independently verifying #2333, #2334, and #2335 are closed and performing its overlap/object audit. Then claim and dispatch it in an isolated current-main worktree. **Gate:** #2336 has a valid active claim and a live worker acknowledgement; silence is not delivery.
3. **Finish #2336 structurally.** Require exact-head independent review, preview proof, guarded merge, bounded production migration apply, and live catalog verification. Do not apply curated licensing data. **Gate:** the issue closes with merge SHA, migration version, production ledger/catalog proof, and teardown/lease release evidence.
4. **Continue #1090 in its documented successor order.** Re-read `plan_licensing_master_data_implementation.md` STATUS and drift blocks after #2336 closes; create/dispatch only the next already-planned successor that is now eligible. **Gate:** every predecessor is closed with production evidence and no later successor starts out of order; #1090 closes only after all named structural, curated, capture/weekly, consumer-cutover, compatibility-retirement, and sustained-monitoring gates are complete.
5. **Wait on #1031's vendor-response clock.** Do not resend the email or rerun the capture. At the documented deadline, check for a response and apply the issue's closure rule. **Gate:** #1031 closes with the send timestamp and response/no-response outcome recorded without private examples, keys, or internal names.
6. **Put the single #770 authorization request in §0 to Albert.** Do not paraphrase away its limits; the exact minimum wording is in the 2026-09-05 01:15Z issue comment. **Gate:** Albert explicitly authorizes both named operations in the current conversation or issue.
7. **After authorization, execute #770 only through its governed route.** Re-prove both database targets immediately before work, acquire the exclusive preview lock, verify free storage, use a newly dated `zz_rehearsal_cutover_YYYYMMDD_HHMMSS` schema, keep transient exports in a protected local temporary file, publish only counts/timings/sizes/hashes, securely delete the export, drop the exact scratch schema, prove absence, and release the lock. **Gate:** the aggregate duplicate counts and full copy/export timing evidence are recorded with target proof and teardown proof, with no production write or row disclosure.
8. **Use the new measurements to decide whether #770 can schedule a cutover.** A production cutover, production infrastructure mutation, or broader credential use still requires exact current authorization. **Gate:** downtime and rollback claims are based on measured production-source terms, not #771 alone, and authenticated business-flow acceptance is recorded before Cloud SQL fallback is retired.

## 7. Constraints and gotchas in force

- Structural work belongs to the single live orchestrator; this repo session must not self-author it.
- Use isolated current-upstream worktrees. Never edit the shared canonical checkout while other sessions' changes are present.
- Re-resolve the live marker before each dispatch. Handoffs and closed markers are not routing authority.
- Never hand-delete author/reviewer refs, synthesize a verdict, bypass exact-head review, or treat preview dependency waits as success.
- Preview is shared mutable infrastructure. Acquire the governed lock and prove the exact target immediately before every write.
- Production and shared-cloud mutations require exact current owner authorization. #770's measurement authority would not authorize cutover.
- Never edit an applied migration. Repair forward with a new migration.
- Keep ColdLion/licensor rows, raw captures, exports, secrets, and identifying examples out of public issues, logs, prompts, commits, and pull requests.
- Ordinary application rows are outside the structural orchestrator; curated Master Data remains gated.
- Deployment health alone is not acceptance. Preserve live authenticated business-flow proof where required.

## 8. Access and environment

- GitHub CLI is authenticated for `u2giants/shared-db`; current issue and marker state was read live during closeout.
- Worktree: `C:\repos\shared-db-worktrees\top-five-closeout-20260907`.
- Branch: `codex/top-five-closeout-20260907`, based on current `origin/main` at `3c62ce52`.
- Git committer identity verified as `Albert Hazan <u2giants@users.noreply.github.com>`.
- Database and vendor credentials are not in this handoff. Durable secrets belong in 1Password vault `vibe_coding`; never print values in commands, logs, chat, or Git.
- The private #1031 capture remains outside this public repository. This closeout did not inspect or move its rows.

## 9. Open questions and risks

- #770 cannot progress beyond planning until Albert supplies both exact authorizations. Preview availability is not permission to copy production rows.
- #770 still lacks measured production network/export/restore, freeze delta, repoint/restart, and smoke-test time. Quoting a total downtime window now would be unsupported.
- #1031's exact response deadline/closure rule must be taken from its controlling issue/plan at execution time; do not invent a date from the email timestamp.
- #2336's body is still machine-marked blocked although all three declared predecessors are closed. Only the live orchestrator may reclassify it after its own audit.
- #1090 remains open after #2336; its full plan contains later curated, weekly, consumer-cutover, retirement, and monitoring gates. Closing the tracker early would falsely report production completion.
- The earlier handoff `HANDOFF.d/2026-09-06T0015Z-edge-dev-codex-top-five-blockers.md` remains present because its contract issue #770 is open, but several live-state statements in it are superseded by this file. Do not edit it; retire it only when the successor-rule conditions are proven.

## Evidence-backed self-audit

### Six detailed questions

1. **Could a street-new developer continue without asking a question? Yes.** Sections 1–3 define the systems, objective, issues, environments, SHAs, and exact live state. Section 6 supplies ordered actions and a verification gate for every step. The only unavoidable owner decision is consolidated in section 0.
2. **Could they continue as effectively as this session? Yes.** Sections 3 and 5 preserve current issue states, completed production evidence, the current marker, why total downtime is unknown, the `AuditLog.id` rule, and #2336's scope.
3. **Are failed attempts and reasons included? Yes.** Section 4 records every stale assumption corrected during the session, the missing local template, and why the canonical checkout was rejected for writing.
4. **Is every next step executable without guessing and verifiable? Yes.** Every numbered item in section 6 names the action, owner/route, limits, and an explicit success gate.
5. **Are unfamiliar terms, identifiers, paths, and URLs explained or referenced? Yes.** Sections 1, 3, 5, and 8 define the repository, external databases, issue roles, marker, worktree, SHAs, preview ID, and evidence link. Section 6 points to the controlling plan and exact issue comment for details that must remain authoritative.
6. **Was the section-0 sweep completed? Yes.** Sections 1–9 were checked line by line. The only current owner judgment is #770's two-part authorization and it appears in section 0 with a recommendation. #1031's email is already settled; #1090 data apply is explicitly unauthorized and listed under “do not re-ask.” No outside-scope owner decisions were found.

### Four final synthesis questions

1. **Is this file comprehensive enough for a brand-new developer to continue without missing a beat? Yes.** Supported by sections 1–9 and the six-question audit above; no gap was found.
2. **Could they continue as well as this session with all relevant background? Yes.** Sections 3–6 preserve the live evidence, corrected assumptions, root causes, and exact continuation route; no gap was found.
3. **Is every relevant goal, state, failure, decision, constraint, risk, action, and verification item present? Yes.** Goals are in section 2, state in 3, failures in 4, findings in 5, actions/gates in 6, constraints in 7, access in 8, and risks in 9; no gap was found.
4. **Would Albert see every required decision by reading only section 0? Yes.** The line-by-line sweep found one blocking decision: #770's exact two-part authorization. It is fully indexed in section 0. The #1031 send action and completed issues are explicitly marked settled so they are not mistakenly re-asked.
