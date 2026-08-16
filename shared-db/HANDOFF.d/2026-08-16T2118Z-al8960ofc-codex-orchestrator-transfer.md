---
issue: 1079
status: OPEN
owner: codex/orchestrator-marker-1053
---

# HANDOFF — shared-db orchestrator transfer (2026-08-16 21:18 UTC, al8960ofc/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

The incoming orchestrator must put this complete list to Albert in one message before starting decision-dependent work. Do not ask these one at a time. None blocks the immediate engineering continuation of #853 or #764.

### Blocking owner decisions already queued with `needs-albert`

- #1031 and #906: confirm whether ColdLion has a usable HTTPS history endpoint before building or operating the historical puller. Recommendation: do not invent an endpoint or scrape a different interface.
- #903: answer the prepared division-code questions that must go to Uma. Recommendation: send the exact prepared questions unchanged.
- #898: decide whether DELETE should remain enabled on `pim.stage` and the two ClickUp-history tables. Recommendation: keep current behavior unchanged until the blast radius is reviewed.
- #865: choose which of the two disjoint `core.property` universes is the intended reconciliation target. Recommendation: do not load curated data until the target is explicit.
- #817, #816, and #815: settle the incomplete Paramount capture, the authoritative portal-wide asset count, and whether three published Paramount titles must be removed from the public repository. Recommendation: treat the capture as incomplete and disclose no additional licensed names until answered.
- #810: decide who performs the remaining B5 application smoke test and non-admin acknowledgement. Recommendation: name an accountable person before promotion.
- #769: confirm whether the R5 ruling was ever made. Recommendation: treat R5 as unconfirmed until an authenticated ruling exists.
- #768: confirm whether DesignFlow production already writes to Supabase. Recommendation: measure the connection target before planning any cutover.
- #732: accept or correct the NBCU count of 58 properties and supply the missing contract restrictions. Recommendation: use 58 only as a provisional measured count, not a final commercial ruling.
- #711: answer the remaining promotion decisions D2, D5, and D6. D7 was already completed and must not be re-asked. Recommendation: keep the affected promotion held.
- #645: decide the response to vendor emails, phones, and addresses published in `baseline.json`. Recommendation: remove public personal data through a reviewed history-safe plan; do not rotate unrelated credentials.
- #539 and #516: answer the remaining ColdLion property-code and licensor/property cutover questions. Recommendation: preserve abstention on ambiguous mappings rather than selecting the first match.
- #531: decide whether to shorten the orchestrator skill. Recommendation: leave it unchanged unless the replacement keeps every enforced safety rule and test.
- #521: choose the correct Disney Coco property row for the style guide. Recommendation: do not guess from a label alone.
- #515: decide how an ownerless property should be represented. Recommendation: use an explicit nullable/unknown state, not a fabricated licensor.
- #511: decide whether deleting a property should cascade-delete its characters. Recommendation: change to a fail-loud restriction unless the business explicitly wants destructive cascade behavior.

All twenty issues above were verified OPEN and carrying `needs-albert` during closeout. Six misleading internal statuses (#817, #645, #539, #521, #515, #511) were corrected to `owner-decision`; the final queue audit reported no dispatchable or malformed work.

### Already settled, do not re-ask

- 2026-08-16: Albert approved the material signed-in access change for #1049. Migration `20260816045120` was then applied and verified in production run 31969314143. #1049 is closed.
- 2026-08-16: #853 remains the first engineering priority. Ambiguous item identities must remain unresolved rather than guessed, and existing ERP links must be preserved.
- 2026-08-13: shared-db governs database structure, not ordinary application data. Do not route normal application row writes into migration-author lanes.

## 1. What this application is

`u2giants/shared-db` is the source-controlled safety gate for the shared Supabase database used by POP Creations applications, including PopDAM, PopPIM, PopCRM, DB Data Admin, and DesignFlow integrations. It owns database structure: migrations, tables, views, functions, grants, indexes, constraints, and cross-application contracts. Ordinary application rows belong to their applications, except outside-sourced curated Master Data loads.

The production Supabase project reference is `qsllyeztdwjgirsysgai`. The shared preview project reference is `rjyboqwcdzcocqgmsyel`. Preview is a shared rehearsal database and is not clean by default. GitHub issues carrying `db-work` are the work queue. `COORDINATOR_INTAKE.md` is retired and must not be edited.

Only one orchestrator may run. It coordinates at most three migration authors, one preview action, one merge action, and one production action at a time through GitHub-backed locks.

## 2. What we set out to do this session, and why

Albert asked this orchestrator to complete #853 first, then assign and finish every open repository issue through production until none remained. The session inherited a large historical queue, three migration workstreams, incomplete production promotion, and fragile external-review tooling.

The practical goals became:

1. finish #1049's six Warner inferred relationship views through production;
2. reconcile and complete #853/#868 without guessing item identities or breaking existing OrderList links;
3. resume #764's stale DesignFlow sequence repair;
4. classify every open issue honestly rather than closing unresolved owner, data, or dependency work;
5. make reviewer provider/permission failures recoverable rather than queue-stopping;
6. leave the next orchestrator a live, issue-backed, exact-state handoff.

## 3. Current state — what is true right now

### 3.1 Coordination state, checked 2026-08-16 21:18–21:25 UTC

- `origin/main`: `7ee1df5e8ae624eae354af704735038c86323805` (`Separate work status from routing`, PR #1078).
- Highest migration version on current `main`: `20260816063532`.
- Open orchestrator marker: #1053. Close it only after this handoff PR is merged and the final audits pass.
- Author lanes: 2 of 3 occupied, 1 expired but still protective.
  - Claim #1069: owner `codex-issue-853-orderlist`, branch `codex/issue-853-orderlist-safe-forward`, worktree `C:\repos\shared-db-wt-853-safe-forward`, reserved version `20260816110750`, lease expires 2026-08-16 23:07:45Z. It protects the #853 bridge/function/view/table set.
  - Claim #1056: owner `issue_764_sequence_repair/session-1053`, branch `codex/issue-764-sequence-repair`, worktree `C:\repos\shared-db-worktrees\issue-764-sequence-repair`, old reserved version `20260816044638`. Its lease expired at 16:46:32Z, but expiry never releases protection.
- Exclusive coordination refs: only `refs/db-coordination/reviewer-round-robin` exists. Preview, merge, production, and author-acquisition locks are absent.
- Final queue audit: fully audited, no malformed issues, no unclassified issues, no dispatchable structural issue. Lane 3 is legitimately empty because all remaining work is blocked, owner-decision, data/source/app work, or repository maintenance.

### 3.2 #1049 is complete in production

- Implementation PR #1059 merged as `611037e62fc449adfd367193b741e60939228eef`.
- The exact migration blob remained identical to the approved head through later `main` advances.
- Owner approval comment: issue #1049 comment ID `5309383926`, authenticated OWNER and unedited, accepting only `material_access_change` for migration `20260816045120`.
- Owner-evidence run 31969132321, artifact digest `sha256:f68387ba9b55f1fcb54a59234a8a1dfb2f9ae15e7dc3217deb11e43e8a45a410`.
- Current-main review-evidence run 31969177655, digest `sha256:9e45cc17e47aaadccd217dc661060675153da6d2bcc8aacbc0babda0ad6e0356`.
- Historical preview proof run 31969178786, digest `sha256:c1232cf04c253093a3a5da4e77c9708adef5657b0f4d496cba36673f43efb197`.
- Production dry-run 31969249232 succeeded.
- Production apply 31969314143 succeeded, applied only `20260816045120`, verified all six Warner views, saved artifact digest `sha256:61b2eb479aa29cb48c7c35d8cf7a379b9fb43f2a4f83b3b69e0b5abbaa327686`, and released the production lock.
- Issue #1049 is closed with evidence comment `5309409967`.

### 3.3 #853/#868 OrderList workstream is unfinished but stable

Merged and preview-applied:

- `20260816045130`: bridge migration. It is merged and already on preview, but RETIRED and hard-blocked from production. Its explicit `BEGIN`/`COMMIT` was proven to let database changes commit without the migration ledger row under Supabase CLI 2.105.0.
- `20260816063532`: expression index `plm.item_upper_trim_item_number_idx`. It is merged and preview-applied.
- Preview contains the application-owned ColdLion snapshot of 19,315 unique full item identities loaded for the scale rehearsal.
- After the index, a full preview bridge refresh completed atomically in 4.720 seconds: 15,533 bridge rows; ERP links remained 13,701 before/after; PLM links increased 0 to 14,535; 998 unresolved; changed ERP links 0; changed existing PLM links 0.

Open PRs:

- PR #1074, branch `codex/issue-1073-atomic-migration-apply`, exact head `83a2592a82119661ef63b10c3493ad5664658d42`, worktree `C:\repos\shared-db-wt-1073`. It is a draft and is behind current `main`. All applicable CI passed at this head, including the disposable PostgreSQL atomicity suite. It needs update from `main` and a fresh exact-head review.
- PR #1071, branch `codex/issue-853-orderlist-safe-forward`, exact head `c53ec2268983690bb5d3257dc60fb67535bcd6cf`, worktree `C:\repos\shared-db-wt-853-safe-forward`. It carries safe-forward migration `20260816110750`. It must wait for #1074, then update from `main`, rerun CI/review, and use the atomic runner for preview. It has one pre-existing untracked `.ai/qwen-pr1071-1b6f0f8-brief.md`; do not delete without checking ownership.
- Issue handover #1080 links this workstream to this file. Original issues #853, #868, and tooling issue #1073 remain open.

No safe-forward preview or production write has occurred. The attempted preview of `20260816110750` failed at statement 0 because bare `LOCK TABLE` was outside a transaction. Ledger delta was zero and the preview lock was released.

### 3.4 #764 sequence repair is unfinished but stable

- Tooling PR #1072, branch `codex/active-claim-reversion-filename-fix`, exact head `656c6bdf7db2751e3efa464e279a8efbb6869048`, worktree `C:\repos\shared-db-worktrees\active-claim-reversion-filename-fix`.
- It is based on `f87bbf2`, so current `main` advanced afterward through PR #1078. Its scoped diff is two manager-tool files. All CI passed and focused tests passed 70/70 at the current head, but it needs update from current `main` and a fresh exact-head review.
- Migration PR #1047, branch `codex/issue-764-sequence-repair`, head `0d423cac69850536bd31416ad1986bf313418afc`, worktree `C:\repos\shared-db-worktrees\issue-764-sequence-repair`. Its old reserved migration sorts behind merged versions and cannot pass the guard. It must not be previewed.
- After #1072 merges, use the reviewed active-claim reversion command to reserve a fresh later migration version atomically, rename the exact migration, update claim #1056, and preserve permanent reservation proof.
- The #1047 worktree contains pre-existing untracked `.ai/issue-764-eligible-body.md`, `.ai/kimi-764-review.md`, `.ai/kimi-764-run.err`, and `.ai/kimi-764-run.out`. Preserve them.
- Handover issue #1081 links this workstream to this file. Original #764 remains open.

### 3.5 Reviewer-resilience tooling remains incomplete

- PR #1076 merged as `f87bbf290ff6fbb109732156e64857afe3dfc042` and closed the immediate #1049 owner-evidence blocker. It generalized owner approval to an exact nonempty, unique, ordered 14-digit migration allowlist while preserving exact-main, merged-source-PR, allowed-risk, and authenticated-unedited-comment binding.
- The same PR added the rule that reviewer wrappers run from the full-access orchestrator; auth/session access is checked first; quota, permission, and provider failures with no verdict are transport failures; and substantive `REVISE` verdicts may never be replaced.
- Remaining defect: the migration-author manager currently supports only one durable replacement per exact PR head. A second consecutive no-verdict failure returns `durable reviewer replacement does not match this retry`.
- Issue #1075 and dedicated handover #1082 remain open. Implement chained immutable replacements and executable preflight, with tests and external review.

### 3.6 Issue queue and documentation state

- New issue #1079: overall orchestrator continuation and queue completion.
- New issue #1080: #853 continuation.
- New issue #1081: #764 continuation.
- New issue #1082: reviewer transport recovery continuation.
- New issue #1083: reconcile the legacy root `HANDOFF.md` and retire proven-stale handoff files.
- Open owner decisions are labeled `needs-albert`. The six mislabeled issues listed in §0 were also reclassified internally to `status: owner-decision`.
- `HANDOFF.md` on current `main` is still a large legacy state document, not the static pointer. It contains stale backlog headings. Do not rewrite it casually and never write to `COORDINATOR_INTAKE.md`; #1083 owns reconciliation.
- Present handoff files whose contract issue is closed and therefore need successor-rule review: the two #958 files dated 2026-08-14 13:46 and 17:00 UTC, plus the #1050 file dated 2026-08-16 03:15 UTC. They were deliberately not deleted because this session did not prove every obligation was carried forward outside those files.
- The primary checkout `C:\repos\shared-db` is dirty with unrelated files from other sessions, including `.gitignore`, `.agents/`, `.ai/`, verification artifacts, and an untracked handoff created at 21:19 UTC. This session did not stage, edit, delete, or claim any of them. The handoff PR uses isolated worktree `C:\repos\shared-db-worktrees\orchestrator-handover-20260816-2118`.

## 4. Everything we tried that did NOT work

### Reviewer execution failures

- Delegated/restricted tasks could not read fixed Windows reviewer authentication or create session folders under `C:\Users\ahazan2`. Moving wrapper state with `AI_*_STATE_DIR` did not relocate Grok/Kimi's own credential and session stores. These were execution-profile failures, not review findings.
- Qwen reached its weekly quota and returned `insufficient_quota` with zero tokens and no verdict. It was correctly recorded as a failed reviewer and replaced.
- Grok sometimes reached its turn limit with no verdict. A narrower fresh read-only review under the same assigned model succeeded for PR #1076. Do not treat a no-verdict run as approval.
- The manager can replace the original reviewer once, but a replacement reviewer failing again cannot currently be durably replaced. This is #1075/#1082, not permission to hand-select unlimited reviewers.
- Several early reviewer assignments used incorrectly expanded full SHAs. Each was caught before acceptance. Always read the exact 40-character PR head from GitHub; never infer it from a short prefix.

### #1049 production failures

- #1049 was initially closed after merge even though its own delivery contract required production. It was reopened, promoted, verified, and closed correctly.
- The first owner-decision evidence script was hard-coded to the historical Disney two-migration batch. It safely refused #1049. PR #1076 fixed the root cause; no evidence was forged.
- A #1049 preview recovery initially could not reconcile an already-previewed #853 migration absent from the #1049 branch. The safe historical recovery path used current `main` plus the exact merged source PR and proved no preview write.
- Production initially stopped because the six signed-in views materially changed access. Albert explicitly accepted that exact risk; it was not bypassed.

### #853 migration atomicity and performance failures

- Bare-ID mapping was not total: ColdLion and legacy counts did not permit a wholesale bridge replacement. The migration preserves old ERP links and leaves ambiguous identities unresolved.
- The first full preview bridge refresh timed out. The missing normalized item-number index was the root cause. After `20260816063532`, the same scale refresh completed in 4.720 seconds.
- `LOCK TABLE` outside an explicit transaction failed at statement 0. Adding `BEGIN`/`COMMIT` made the lock legal but created a worse failure: disposable PostgreSQL proof showed the SQL could commit while the Supabase ledger insert failed. Therefore `20260816045130` is retired from production.
- Removing only the explicit `COMMIT` did not solve the safe-forward migration because Supabase CLI 2.105.0 does not wrap the file in a transaction. Preview failed before DDL and made zero ledger change.
- PR #1074's first reviewed head missed several fail-closed cases: retired migration fallback, malformed/multi-version fallback, PostgreSQL `END`/`ABORT`, absent `psql`, production-path tests, safe version handling, redacted errors, and robust history validation. Head `83a2592...` fixes those findings and passes tests, but has not been rereviewed after updating from current `main`.
- Preview-lock acquisition cleanup twice failed on delayed GitHub 404 visibility. PR #1068 added bounded readback and fixed it. Never blindly retry an ambiguous lock release; prove and recover the exact owner ref.

### #764 claim/version failures

- Version `20260816044638` was valid when reserved but became backdated after later migrations merged. Renaming it manually or editing claim/ref bodies is forbidden.
- The first reversion tooling found migration files by SQL content only and missed a version appearing only in a filename. PR #1072 adds filename discovery.
- Grok found the first PR #1072 tests did not exercise real Git discovery and that partial rename failure could escape rollback. Head `656c6bd...` adds real temporary-Git tests and content/name restoration; 70/70 pass.

### Queue/documentation dead ends

- A blanket request to close every open issue cannot supply missing business facts. Owner decisions, external-source facts, application data, and dependency-blocked work were kept open rather than falsely completed.
- `COORDINATOR_INTAKE.md` is retired. Rebuilding a queue there would violate required CI and recreate a known failure.
- The primary checkout is not safe for handoff edits because it contains unrelated concurrent work. This handoff uses an isolated branch/worktree and stages only its own file.

## 5. Root causes and key findings

1. The session's apparent reviewer “Windows denial” was not Windows Full Access being absent globally. It was the delegated task's restricted execution profile preventing access to per-user reviewer state. The main orchestrator has working `gh` auth and reviewer auth.
2. A provider failure and a substantive review finding are different states. Only terminal no-verdict/no-artifact failures may enter replacement; `REVISE` findings must be fixed.
3. Migration safety requires database changes and the migration ledger record to commit or roll back together. Supabase CLI 2.105.0 did not provide that guarantee for transaction-required files, so PR #1074 builds an exact native transaction containing both.
4. Preview's ledger is shared mutable state. A branch missing another already-previewed migration cannot safely run ordinary CLI reconciliation; use the governed historical path or correct ancestry, never repair the ledger casually.
5. Claims remain protective after expiry. #1056 is expired but still blocks the two DesignFlow sequences until explicitly reverted/released.
6. `db-work` is intake, not structural ownership. The final queue audit correctly separates status, work type, and route. An empty author lane is valid when no ready structural issue exists.
7. #1049 demonstrates why “merged” is not “done”: its production outcome required a separate owner-risk decision, exact evidence, bounded deployment, and catalog verification.

## 6. Exact next steps

1. Open a new orchestrator session using the prompt in the closing report, create a fresh `orchestrator-marker`, read this file newest-first, fetch `main`, and rerun `--audit` plus `--queue-audit`. Success: exactly one new marker is open, no exclusive lock is stranded, and the queue has zero malformed/unclassified items.
2. Resume #853 first. Update PR #1074 from current `main` in `C:\repos\shared-db-wt-1073`, verify its diff remains tooling/tests only, rerun the full tests, obtain a fresh manager-assigned exact-head review, and merge only after green approval. Success: #1074 is merged and no database/claim ref changed.
3. Update PR #1071 from the new `main`, confirm it contains exactly safe-forward migration `20260816110750` plus its focused evidence/docs, rerun CI and a fresh exact-head review. Success: exact head is green and reviewer says safe for bounded atomic preview.
4. Use the merged atomic runner for preview with allowlist only `20260816110750`. Re-run the 19,315-item scale refresh and fail-loud link contracts. Success: SQL and ledger both record the version, existing ERP/PLM links remain unchanged, refresh completes within the proven range, and preview lock releases.
5. Guard-merge PR #1071, release claim #1069 only after proving its PR is closed/merged, then run the governed production dry-run/apply for safe-forward `20260816110750` followed by already-merged index `20260816063532` only as the production ledger requires. Never apply retired `20260816045130`. Success: production ledger/catalog verification passes and no retired version runs.
6. Complete #853/#868 application-owned ColdLion load/refresh and PopDAM `/orders` deployment verification in the owning application sessions. Close only when production behavior is proven. Success: canonical item linking works in the real signed-in app and issues #853/#868 close with evidence.
7. Resume #764. Update PR #1072 from current `main`, rerun 70+ focused tests/CI, obtain fresh exact-head review, merge it, then execute its guarded active-claim reversion for #1056/#1047. Success: manager reserves a new later version, updates claim/filename atomically, and both permanent refs prove readable.
8. Update PR #1047 with the manager-produced version, rerun review/CI, preview, guarded merge, release #1056, then production dry-run/apply and sequence catalog verification. Success: next inserts cannot collide and issue #764 closes.
9. Finish #1075/#1082 chained reviewer replacement and executable full-access preflight. Success: tests prove two consecutive terminal no-verdict failures advance immutably without replacing a real verdict.
10. Work the remaining queue by its recorded route, not by label alone. Present all §0 owner decisions together. Keep structural, curated-data, application-data, source-data, and repository-maintenance work in their correct owners. Success: queue audit remains fully classified and issues close only with outcome evidence.
11. Resolve #1083. Reconcile the legacy root handoff and retire only predecessor files satisfying the successor rule. Success: no handoff file points to a closed issue and no obligation is lost.
12. At the end of every phase, reread all later steps in this section and record any discovery that changes their assumptions before continuing.

## 7. Constraints and gotchas in force

- One orchestrator marker only. Do not start work before creating it.
- At most three migration authors. Claims are GitHub locks; expiry is not release.
- Preview, merge, and production are serialized. Instructions in chat are not locks.
- Never reuse or hand-edit a reserved migration version or fenced claim block.
- Current `main` may advance between review and merge. Any head change requires fresh CI and exact-head review.
- Use manager-assigned reviewers. A terminal transport failure may be replaced only with immutable evidence; a substantive `REVISE` may not.
- Never expose licensed row values. Counts and structure only in public issues/reviews.
- Preview is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`. Prove the target immediately before every write.
- `20260816045130` is retired from production. Do not “repair” it into the ledger or remove its hard block.
- Preserve every existing ERP bridge link during #853 cutover. Ambiguous item identities remain unresolved.
- `COORDINATOR_INTAKE.md` is a retired pointer. Do not write into it.
- Do not clean dirty/untracked worktrees during takeover. Their files may be another session's only copy.
- The root checkout has concurrent files. Use isolated worktrees and stage explicit paths only.

## 8. Access and environment

- Machine: Windows 11 `al8960ofc`; repository `C:\repos\shared-db`.
- `gh` is authenticated as GitHub owner `u2giants` in the main full-access task.
- Git commit identity is `Albert Hazan <u2giants@users.noreply.github.com>`; verify again before the first commit.
- Reviewer wrappers installed: `ai-grok-review`, `ai-glm`, `ai-kimi`, `ai-qwen`. Run from Git Bash and the main full-access orchestrator. Never read or print reviewer auth files.
- Supabase credentials and any other secrets belong in 1Password vault `vibe_coding`; no new secret was created, pasted, or stored during this session.
- GitHub Actions owns preview/production database credentials and the governed deployment paths. Do not extract them locally.
- Handoff worktree: `C:\repos\shared-db-worktrees\orchestrator-handover-20260816-2118`, branch `codex/orchestrator-handover-20260816-2118`.

## 9. Open questions and risks

- The twenty owner decisions are consolidated in §0 and must be raised together. None authorizes a database write merely by being labeled.
- PRs #1074, #1071, #1072, and #1047 can become stale whenever `main` advances. Re-read live GitHub state.
- Claim #1069 will expire soon after this handoff timestamp; it remains protective, but the new orchestrator should renew legitimate active work through the supported manager path if available, never manual body editing.
- Claim #1056 is already expired and must remain until guarded reversion or explicit proven release.
- Preview contains #853's 19,315-row ColdLion rehearsal data and applied versions `20260816045130`, `20260816063532`, and `20260816045120`. This is disclosed state, not permission to delete it.
- The primary checkout's unrelated dirty files and the stale handoff files are owned elsewhere. #1083 tracks documentation cleanup; do not delete based only on age.
- The user's global goal of zero open issues is not complete. The live queue contains many legitimate business decisions, source-data work, application work, blocked parent programs, and production promotions. Closing them without proof would be false.

## Part B — every dispatched sub-agent, separated

### Agent: `issue_1049_warner_views` / `C:\repos\shared-db-worktrees\issue-1049-warner-inferred-views`

- **Asked to do:** implement #1049's six inferred Warner relationship views.
- **Actually did:** authored migration `20260816045120`, contract tests, multiple exact-head reviews/fixes, PR #1059, preview proof, and merge `611037e...`. The root orchestrator later completed production run 31969314143.
- **Found:** timestamp inversion and correlated support scans were material review findings and were fixed before merge.
- **PR / branch:** #1059 / `codex/issue-1049-warner-inferred-views`, merged.
- **Worktree:** finished code, still present; safe cleanup requires GitHub-based merged-PR verification, not ancestry guessing.
- **Deliberately did NOT do:** production initially, because it was outside that agent's authorized stage. Root later completed it.

### Agent: `issue_853_orderlist` / `C:\repos\shared-db-wt-853*`

- **Asked to do:** complete #853/#868 mapping, structural bridge cutover, preview scale proof, merge, and production.
- **Actually did:** reconciled 19,315 ColdLion identities against 17,703 legacy IDs; authored/merged/previewed bridge and index migrations; preserved old links; proved scale refresh after indexing; opened safe-forward PR #1071 and tooling PR #1074.
- **Found:** mapping is not total; explicit COMMIT separates SQL from ledger; bare LOCK fails without a transaction; normalized item-number index removes the scale timeout.
- **PR / branch:** #1071 `codex/issue-853-orderlist-safe-forward`, #1074 `codex/issue-1073-atomic-migration-apply`.
- **Worktree:** live/resumable; exact state in §3.3.
- **Deliberately did NOT do:** promote retired `20260816045130`, guess ambiguous mappings, or write production after the safety experiment failed.

### Agent: `production_and_queue`

- **Asked to do:** production recovery, lane/queue auditing, #764 resume, and manager safety tooling.
- **Actually did:** completed Disney production recovery; reopened #764 PR #1047; built/reviewed claim split, expansion, reviewer replacement, ref-delete readback, and active-claim reversion tooling; closed only evidence-proven stale issues.
- **Found:** historical PRs can predate required lease checks; GitHub deleted refs can remain visible briefly; claims need manager-supported recovery instead of manual edits.
- **PR / branch:** many merged tooling PRs #1061–#1070; remaining #1072.
- **Worktree:** remaining #1072 worktree live/resumable.
- **Deliberately did NOT do:** bulk-close unresolved issues or apply drift wholesale.

### Agent: `queue_audit_close`

- **Asked to do:** audit all open issues and close only conclusive stale items.
- **Actually did:** closed #792 and #941 with evidence; classified structural, data, owner, and dependency work.
- **Found:** #764 was the only independently eligible structural issue at that audit point; #853 then remained dependent on proof.
- **PR / branch:** none; issue-only read/audit work.
- **Worktree:** finished.
- **Deliberately did NOT do:** close parent programs or consume migration lanes for nonstructural work.

### Agent: `stale_audit_500_699`

- **Asked to do:** read-only stale-issue audit for issues 500–699.
- **Actually did:** proved #530 safe to close; root closed it. Documented why #518, #526, #529, #584, #597, #619, #655, and #696 remain open.
- **Found:** merged PR references do not prove a parent outcome is complete.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do:** close issues whose own evidence says work remains.

### Agent: `stale_audit_700_899`

- **Asked to do:** read-only stale-issue audit for issues 700–899.
- **Actually did:** proved #805 safe to close; root closed it. Preserved #711, #734, and #748.
- **Found:** #711 still has D2/D5/D6; #734 has unconfirmed R5; #748 still has promotion work.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do:** infer completion from partial merged phases.

### Agent: `stale_audit_900_plus`

- **Asked to do:** read-only stale-issue audit for issues 900+.
- **Actually did:** found no safe closure; preserved #901, #943, #949, #1051, #900, #912, #933, and #974.
- **Found:** production drift and preview parity remain real work; #1051's unsafe ai-devops PR remains open.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do:** close issues based on incomplete cross-references.

### Agent: `grok_review_1072`

- **Asked to do:** exact-head Grok review of PR #1072 from a delegated task.
- **Actually did:** no review. The restricted task could not read Grok auth/session state and timed out.
- **Found:** workspace-local wrapper state does not relocate Grok's own fixed auth/session files.
- **PR / branch:** #1072, unchanged by this agent.
- **Worktree:** finished failed attempt.
- **Deliberately did NOT do:** weaken permissions, claim a verdict, edit, or merge.

### Agent: `grok_review_1074`

- **Asked to do:** exact-head Grok review of PR #1074 from a delegated task.
- **Actually did:** no review for the same restricted-auth reason.
- **Found:** main full-access execution, not a weaker security setting, is required.
- **PR / branch:** #1074, unchanged by this agent.
- **Worktree:** finished failed attempt.
- **Deliberately did NOT do:** bypass auth or count the failed run as evidence.

### Agent: `resume_764_2`

- **Asked to do:** resume #764 and prepare guarded reversion.
- **Actually did:** verified exact files/tests and prepared the guarded command, but its delegated GitHub token was invalid and it could not mutate GitHub.
- **Found:** filename-only version discovery needed PR #1072.
- **PR / branch:** #1072/#1047.
- **Worktree:** superseded by `live_grok_1072`, but preserve the #1047 worktree.
- **Deliberately did NOT do:** mutate claim #1056 without authenticated GitHub proof.

### Agent: `resume_853_atomic2`

- **Asked to do:** resume atomic-runner PR #1074 and obtain exact review.
- **Actually did:** confirmed exact head/green CI and attempted Kimi; Kimi failed because the restricted profile could not create its fixed user session directory.
- **Found:** the earlier “Full Access” contradiction came from task-level delegation, not the main task.
- **PR / branch:** #1074.
- **Worktree:** superseded by `live_grok_1074` and remains resumable.
- **Deliberately did NOT do:** merge without a real verdict.

### Agent: `live_grok_1072` / `C:\repos\shared-db-worktrees\active-claim-reversion-filename-fix`

- **Asked to do:** run Grok exact review, implement findings, update from `main`, and stop at a handoff checkpoint.
- **Actually did:** Grok found missing real-Git tests and rollback gaps; agent fixed them, reached 70/70 tests, updated to `f87bbf2`, and pushed `656c6bdf...`.
- **Found:** filename discovery needs cached plus untracked renamed files; rollback must snapshot and restore both content and name.
- **PR / branch:** #1072 / `codex/active-claim-reversion-filename-fix`.
- **Worktree:** live/resumable and clean.
- **Deliberately did NOT do:** merge, reversion, claim mutation, preview, or production.

### Agent: `live_grok_1074` / `C:\repos\shared-db-wt-1073`

- **Asked to do:** run Grok exact review, fix all valid findings, and stop at a handoff checkpoint.
- **Actually did:** fixed retired fallback, malformed/mixed lists, END/ABORT checks, psql installation, exact policy binding, error redaction, ledger compatibility, and production-path rollback tests; pushed `83a2592...`. Full Python tests 524 passed; SQL guards 18 passed; focused suite 206 passed; CI green.
- **Found:** the first atomic runner could have fallen back to ordinary deployment in unsafe cases and lacked a runnable production `psql` path.
- **PR / branch:** #1074 / `codex/issue-1073-atomic-migration-apply`.
- **Worktree:** live/resumable; only pre-existing `.ai/kimi-pr1074-brief.md` untracked.
- **Deliberately did NOT do:** merge, preview, production, or claim mutation.

## Handoff self-audit

1. **Could a street-new developer continue without asking this session a question? Yes.** Sections 1–3 define the system and exact live state; §6 gives ordered commands/outcomes; §8 gives access and paths; Part B identifies every agent and worktree.
2. **Could they continue as effectively as this orchestrator? Yes.** Sections 3–5 preserve exact SHAs, versions, counts, evidence runs, failed approaches, and root causes; Part B preserves agent-specific omissions and discoveries.
3. **Are background, goal, intended outcome, state, failures, decisions, constraints, risks, actions, and verification all present? Yes.** They map respectively to §§1, 2, 2/6, 3, 4, 0/5, 7, 9, 6, and 3/6. No gap was found after rereading.
4. **Would Albert see every decision by reading only §0? Yes.** The line-by-line sweep of §§1–9 and Part B found the twenty open `needs-albert` issues, the settled #1049 access approval, the #853 no-guess ruling, and the structure/data boundary. Every live owner ask is in §0; operational risks elsewhere require engineering evidence, not a new owner ruling.

Secrets sweep: completed; nothing new was found or stored. Documentation pass: this file is the durable record; the legacy root/stale handoff discrepancy is explicitly queued as #1083 rather than silently rewritten.
