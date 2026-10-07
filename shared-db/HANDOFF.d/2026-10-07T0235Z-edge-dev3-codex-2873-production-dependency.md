---
issue: 2873
status: BLOCKED
owner: codex/01a1126f-6efb-7a22-8034-4471909f2c86
---

# Service identities delivery: production prerequisite verified, application merge pending

## 0. Business decisions only the owner can make

None. No technical approval, password, click, merge, or installation is requested from Albert. Albert's direct chat request was “complete shared-db #2873 through to production”; he confirmed #3398 completed through production. These are settled instructions, not questions to reopen. DesignFlow application merges belong to Uma; do not self-merge them or contact her without explicit messaging authorization.

## 1. What this application is

`popcre/shared-db` owns the structural contract of the Supabase database shared by POP Creations applications. Production project is `qsllyeztdwjgirsysgai`, URL `https://qsllyeztdwjgirsysgai.supabase.co`. DesignFlow backend, Item Master, Tracking and Data Sync need distinct service identities instead of broad shared access. #2873 is the final role/grant change. Its ordered prerequisites are #2874 backend workflow parity, #2875 Tracking parity, and #3737 corrected identity fixture/generated types. Existing credential/cutover issue #770 is outside these passwordless role changes.

GitHub remains authoritative. Schema writes occur only through claimed migrations, assigned AI review, guarded merge and the activated automatic promotion lane. There is no orchestrator, marker, dispatch owner, or orchestrator/non-orchestrator classification.

## 2. Goal and session scope

Complete #2873 through production with actual service/refusal proof, preserving existing application capability and excluding legacy-schema grants. This is NOT complete. #3398/#2870 were previously verified complete. This session recovered stranded/retired claims, corrected unsafe/incomplete prospective evidence, obtained current source approvals, repaired reviewer input/startup bugs, and delivered #2874's successor migration to production. Application acceptance is still blocked by Uma's backend PR120 merge. Do not skip that acceptance to advance the next dependency.

## 3. Current state and ownership

Times below are October6 EDT. These are observations, not permanent authority.

### Production delivery actually completed

- #2874 PR4023 MERGED at `5df3dc4798d8aedbbf72ea2faead8a5f4ac134be`; source `1d127cbab228ac04186b4a7281450318eac4ffab`, generation11, version **20261006235109**, claim3704. Guarded merge37553278899 SUCCESS. Original **20261006211240** stays retained, permanently reserved, retired and hard-blocked; never fabricate its production ledger row.
- Source quorum: Muse slot1 APPROVE `4e297210de242b726e453ff731ef5bd8e6fb42fd`; Gemini slot2 APPROVE `54e5d8dcfd991442109e4028ee9471b28756ae61`.
- Actual-main production assessment: allocator Grok sequence5509, replacement of failed5497 in slot4, APPROVE `4c7baf306ed963a6827c07160f1753ef72d26c89` at `refs/db-review-verdict-replacements/2874-4023-1d127cbab228ac04186b4a7281450318eac4ffab-slot4-5497`. Findings https://github.com/popcre/shared-db/pull/4023#issuecomment-6029419632 . The untouched acceptance parser passed for main5df, allowlist235109 and all three risks. Native cost $0.6469554, 2,748,751 tokens, one review turn.
- Preview dry-run **37561064956 SUCCESS**; merged-main preview apply **37561668135 SUCCESS**, including automatic qualification. The qualifier itself dispatched production at **10:25:12 PM EDT**. Production **37561887885 SUCCESS**, exact main5df; SQL guards, immutable review/hard guards and automatic production apply passed. Session dispatched only preview, NEVER production or production SQL.
- Read-only production at **10:33 PM EDT**: ledger **705**, tip **20261006235109**, successor present, original211240 absent. Four relations/five functions exactly match `scripts/proofs/2874-contract.json`: structure hash `a4ff412de69582b5611d5f459b994cba33b73e4f57c6ceb165eaf0b9f8e89452`, closed client access. Committed `scripts/proofs/2874-catalog.sql` was executed read-only through the fixed-project Supabase connector and the unmodified `validateCatalog` accepted it.
- At **10:34 PM EDT**, both identity sequences are bigint/postgres-owned, start/increment/min/cache1, max9223372036854775807, no cycle; zero client roles have any sequence privilege. Notification/users/RFQItem remain zero rows. No application data was copied, inserted, updated or deleted by this delivery.
- Exact production catalog evidence `/tmp/2874-generation11-actual-production-catalog.json`; `...production-completed.json`, `...preview-apply-completed.json`, `...valid-production-risk-acceptance.json`, and `...auto-qualification.log` retain private machine evidence. Public result/links belong on the same issues.
- Automatic lane released the owned promotion freeze. `git ls-remote` showed NO freeze at **10:35 PM EDT**. Main advanced from5df to **2ca0994bcf056ba12f56e2130cf5a7a47e41ad7d** (#3890 foreign legacy-transition recovery) after delivery. Source tree's highest merged filename then was **20261007000937**; this is NOT the production ledger tip. Re-prove both independently before later work.

### Application acceptance is not delivered

Backend PR https://github.com/popcre/designflow-backend/pull/120 remains OPEN at **10:34 PM EDT**, head **f6d5d807b5c148664db09251d8640c1d374d749c**. Uma owns the merge to `develop`. Current61 plain-node readiness tests passed, and exact-head Cloud Build `cb40e51b-50db-4a5c-8033-c7fe1e130903` SUCCESS. Earlier0d60 approval/build is historical and does not review intervening #3882 changes. These sandbox results do not prove the required develop application acceptance.

The shared-db catalog observer requires an exact approved develop SHA, and explicitly does NOT claim application acceptance. Do not insert sandbox SHA into a develop assertion. #2874 stays OPEN with live application proof pending; #2875 must not advance until its prerequisite is accepted.

### #2875 source ready, not merged or applied

PR3708 OPEN, source **42b967619169f8910345978c277435aba7ab325b**, generation4, active claim3705, successor **20261007003347**. Old **20261006224357** remains permanently reserved/retired. Contract hash `48d9ff06d2798989431dd81355b40cde93b1224dc3196f89314fea09c62a27ae`, immutable ref `refs/db-contracts/2875/4` at `41b60f6020bef193a0beb1d93492583437f53109`. All required source CI passed, as did four actual-session Tracking SQL suites and all707 fingerprints in the pinned disposable fixture.

Current source quorum is complete: Gemini replacement5488 slot2 APPROVE `d29bbaf4f162fb112973b043f2b86e48f5c52d2b`; Muse replacement5499 slot1 APPROVE `72daf27c5c75798a60b25fede81fac625101d8a0`. Logs `/tmp/2875-generation4-gemini-replacement-current-review.log`, `/tmp/2875-generation4-muse-replacement-review.log`. Advisory indexes and later freshness/types/live acceptance remain documented; no source revision was requested. Fresh actual-main production assessment, guarded merge, preview/automatic promotion and acceptance are NOT done.

### #3737 and #2873 preserved, not freshly authored

#3737 old claim3738 retired (retirement evidence retained on the claim), PR3962 CLOSED, old sourceversion **20260928182644** preserved. Prospective fixture correction uses `OVERRIDING SYSTEM VALUE` for GENERATED ALWAYS users.id and passed disposable tests. Fresh claim/version/source/types are not started.

#2873 old claim3739 retired (retirement evidence retained on the claim), PR3963 CLOSED, oldversion **20260928183329** preserved. Prospective `/tmp/2873-prospective-explicit-service-identities.sql` has a placeholder header: it is NOT a reserved/publishable migration. It grants Tracking balance SELECT/INSERT/UPDATE, and nine exact callable signatures instead of all-overload dynamic grants. `/tmp/2873-current-exact-callable-signatures.txt` records them. Backend signatures: `set_item_user_assignment(integer,text,integer,boolean,jsonb)` and `record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)`. Tracking gets six canonical RPCs plus `claim_sample_shipment_notice(bigint)`.

Disposable rollback proofs: `/tmp/2873-prospective-explicit-service-contract.sql`, `...contract-transaction.sql`, `...contract-result.log`, and `/tmp/2873-prospective-tracking-movement-contract.sql/.log`. Actual movement/conservation/idempotency/negative balance/history refusals passed. Four NOLOGIN groups plus four passwordless LOGIN roles, connection limits20/10/10/10, INHERIT and no superuser/createrole/bypassrls. No roles or grants from #2873 were created in production. Credential/cutover #770 stays separate.


Exact role names are `designflow_prod_backend_{grants,runtime}`, `designflow_prod_item_master_{grants,runtime}`, `designflow_prod_tracking_{grants,runtime}` and `designflow_prod_data_sync_{grants,runtime}`. Grant groups are NOLOGIN/NOINHERIT; runtime roles LOGIN/INHERIT. Re-derive all rights from the original committed **20260928183329** source at5f2ce plus current application/schema, retaining the two documented fixes. The six Tracking callable signatures from the private snapshot are:

- `pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)`
- `post_sample_approval_event(integer,text,text,boolean,text,text,text,text,integer,text,text,text)`
- `post_sample_movement(integer,integer,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,bigint,text,text)`
- `post_sample_piece_split(integer,jsonb,text,text,text,text,text,text,text)`
- `post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)`
- `reserve_sample_remote_request_item(uuid,text,text,text,text)`

Together with the two backend signatures and `claim_sample_shipment_notice(bigint)` these make nine. They all belong to `dflow_prod`; never use this dated snapshot as a replacement for fresh exact-signature verification.

### Worktrees deliberately retained

The listed source trees were clean when inspected during handoff preparation; the delivery tree holds only this owned prose commit. They remain resumable; no cleanup or broad reaper was run.

- `/home/ahazan/.codex/worktrees/2874-risk-recovery/shared-db`: source1d, merged source/risk evidence, retained because application acceptance is incomplete.
- `/home/ahazan/.codex/worktrees/2874-merged-risk/shared-db`: source1d, protected native review receipts. No paid review remains running.
- `/home/ahazan/.codex/worktrees/2874-merged-delivery/shared-db`: fast-forwarded clean to2ca, now own `codex/2873-production-handoff` branch for this prose-only file. Publication PR and its merge SHA are recorded on #2873 after this file is written.
- `/home/ahazan/.codex/worktrees/2875-recovery/shared-db`: source42, branch `claude/2875-dflow-prod-tracking`, PR3708 and current reviews preserved.
- `/home/ahazan/.codex/worktrees/3737-recovery/shared-db`: `52d39235086ed994d1c88d42ff8ee0bb73510add`, corrected prospective identity work remains private.
- `/home/ahazan/.codex/worktrees/77d7/shared-db-2873-recovery`: `5f2ce35866ddfbb4b9f45c641c8e3ac5cbe89472`, final role prospective artifacts remain private.
- `/home/ahazan/.codex/worktrees/77d7/designflow-backend-2874-proof`: sourcef6, sandbox-albert, PR120 belongs to Uma's merge route.
- `/home/ahazan/.codex/worktrees/2873-stepfun-repair/ai-devops`: clean source **11a9127eaf1adf94ef8833f2fabe5c1b830957c2**. PR1371 MERGED at **9619270242b8c31b9bd1a5d0c42d718d768b9eff**. Repair issue1370 stays OPEN for installed live proof.

No sub-agents were spawned; per-sub-agent sections are not applicable. Disposable network-none containers `codex-2874-supabase-proof` and `codex-2874-workflow-proof` are owned fixture evidence, retained intentionally, not production. Do not kill other sessions' containers/processes/worktrees.

## 4. Attempts that failed and why

1. Source approval was initially confused with final production risk acceptance. DeepSeek slot3 approved but emitted a `json` fence; the strict required `production-risk-assessment` parser correctly refused it. Immutable verdict `eaf33481fe5197da1dd32d2fbc187f63ade866da` was never rewritten. Missing this requirement caused avoidable review rework.
2. Acquiring the promotion freeze BEFORE guarded merge caused the first merge run to refuse. Released only the owned freeze, then used guarded merge before the postmerge freeze. Never repeat that order.
3. Installed StepFun failed pre-provider with E2BIG on a large argv and OpenCode failed writing its .gitignore through a read-only config bind. Repair PR1371 preserves the sandbox, uses a private600 prompt attachment for >64KiB StepCode input, and narrowly binds only a private .gitignore writable for OpenCode. Ninety host tests, required CI, independent Muse final-check and candidate live doctor passed. Real full-input native attempts confirmed both startup/transport faults gone.
4. StepFun StepCode then exhausted bounded retries on actual TPM429 (current621931, limit500000). Supported OpenCode completed substantial review but emitted continuation/compaction text after an earlier APPROVE; final-verdict guard refused it. No earlier mid-response verdict was extracted or accepted. Failed5475 was released as wrapper_terminal_failure, not fake provider outage.
5. GLM source5473 waited30 minutes before failing; replacement risk5497 failed natively almost immediately with HTTP429 code1310 Weekly/Monthly Limit Exhausted, but the legacy wrapper hid the terminal error while polling. Own session `2874-production-risk-gen11` was aborted; release `e3dabcc7ae369c3de260dbe6081be32e298d7232` records insufficient_quota. Supported local capacity hold uses actual observed epoch1791337534, one hour, not a freshly extended hold. Reset timezone was unqualified and was not invented. Native error evidence remains private `/tmp/2874-glm-current-error-private.json`. Never blindly wait another30 minutes on that terminal quota failure.
6. First Gemini replacement recorder invocation omitted `--replacement-sequence`; it looked up a released original assignment and voided the paid response. It was NOT revived. A fresh properly bound follow-up produced the current valid5488 verdict. Always pass the actual newly assigned replacement sequence (5509 for latest #2874, not failed5497).
7. Global repair installation is blocked: both sudo-n-true and sudo-n-l refused interactive authentication. Do not ask Albert for a password or use an unmanaged installation prefix. Canonical `/home/ahazan/repos/ai-devops` remains clean installed **535067b65c9d57b9a9b136cd8b62664ae549658e**; protected manifest source **744f836f703a673735cbf77d8e14f5f3c911f3d7** is stale. A supported update additionally needs assigned independent exact merged-target stale-linux-manifest-recovery approval; candidate11a approval alone does not authorize merged961 installation.
8. A supposed RFQItem grant gap was a mistaken finding and was corrected publicly. The real Tracking ON CONFLICT balance path needs SELECT+UPDATE as well as INSERT. Preserve the corrected explicit role proof, not the retracted finding.
9. `ai-gh` refuses run watch. Use `ai-gh-wait` with an explicit deadline. Match top-level status ONLY: including full nested jobs with regex `"status":"completed"` can match a completed step while the run is still active. Terminal waits here used only status/conclusion; complete jobs were inspected separately afterward. No polling bypass was used.

## 5. Root causes and evidence pointers

Merged source, preview, production apply and application acceptance are distinct outcomes. Source exact approvals expire on changed content; actual-main risk assessment is separately pinned. Production source **235109** now genuinely exists in the fixed target; the earlier original does not. The canonical stored bodies, signatures, volatility, relation shape and effective client/sequence closure all matched. Relevant code: `supabase/migrations/20261006235109_dflow_prod_backend_workflow_parity.sql`, `scripts/proofs/2874-catalog.sql`, `scripts/proofs/shared-db-2874-observation.mjs`, `scripts/prove-production-risk-acceptance.mjs`, `scripts/production_migration_guard.py`, and `scripts/manage-migration-author-lanes.mjs`.

Protected role details must be derived from actual current application source and actual PostgreSQL sessions. `/tmp/2873-current-service-source-pins.json` is an old read-only snapshot, NOT current consumer authority; refresh it before fresh role authorship. Fingerprints/counts and main/current PR states are similarly per-observation. Public evidence may contain sanitized metadata/results; raw native transcripts, prompt caches and private fixture/source evidence stay local.

## 6. Exact next steps, in order

1. Read current AGENTS/router and current live issue #2873, #2874 and applicationPR120. Recheck main, production ledger/project and app develop head. Do not reuse this document's SHAs as fresh permission. **Gate:** actual current identities and states are recorded in EDT, not assumed.
2. Uma must merge applicationPR120 to develop. Codex owns the dependency and resumes proof after that merge. Do not self-merge or message Uma absent authorization. Verify the actual merged develop content/build/readiness; then produce the required application acceptance and the read-only shared-db2874 observation bound to that approved develop SHA. **Gate:** real branch-bound acceptance validates the complete #2874 contract; only then complete the same #2874 issue/outcome and advance the parent.
3. Resume #2875 PR3708 from source42. A NEW session declares its own engine/sessionID; never impersonate this chat UUID. The existing3705 author lease belongs to this session, so use supported transfer/rebind/lease recovery with exact issue/PR/head evidence and Albert's original authorization, or resume in this same chat. Re-prove current-main freshness and collision-safe byte-identical diff; protect current valid approvals where the enforced equivalence permits. Then guarded merge, postmerge finite freeze, allocator-assigned actual-main risk assessment, prepared merged-main preview, and ONLY the preview launch. Let the activated lane dispatch production independently. **Gate:** intended version only, immutable review/rehearsal, live ledger/catalog, actual Tracking behavior and application acceptance all pass. Do not invent manual production authority.
4. After #2875 acceptance, claim fresh #3737 exact objects/version through the lane tool, preserving retired original. Author corrected identity fixture and actual generated types from current accepted schema, run source/actual-session tests, assigned review/guarded delivery and automatic production. **Gate:** real corrected identity/types contract and live acceptance, not the private prospective fixture alone.
5. After #3737 acceptance, claim fresh #2873 roles/grants/version and re-derive from current consumer heads and callable signatures. Use the narrow nine-signature prototype plus real SELECT/INSERT/UPDATE balance behavior, not dynamic all-overload grants. Source review, exact apply-risk review, preview, guarded merge/promotion ordering, automatic production and actual service/refusal proof stay mandatory. **Gate:** all eight intended identities and exact rights work, unrelated/client/legacy access is refused, full role history/policies and application capability remain intact; #2873 may close only then. Credential/cutover #770 is not silently folded into this change.
6. Restore installed reviewer capability under ai-devops#1370 via the supported reviewed installer when machine authority is available to the AI. Review the actual merged target/full installed delta and stale-manifest recovery inputs before installation. **Gate:** installed launchers, protected manifest, source identity and real supported full-input invocation are verified. No manual task goes to Albert.

Keep pending proof checkboxes on the SAME existing issues. Every technical approval is assigned AI approval; there are no new leftover-proof tickets. A subsequent session may retire this file only after carrying forward every still-open obligation and verifying its preceding work landed.

## 7. Constraints and gotchas

Claim-first supersedes all older marker/orchestrator instructions. Exact-object claims, immutable reservations, review rotation, session-authority checks, target proof, stage leases and exclusive production serialization still bind. Author engine is codex for this session; a successor declares its own. Never alter already-applied SQL bytes, fake a ledger row, widen ACLs to quiet a failing test, extract a nonterminal verdict, overwrite durable findings, or force a preferred reviewer. Source/CI review runs in parallel and fixes are batched into one head.

No direct production commands, database writes, production dispatch, infrastructure mutation or live server edit is authorized here. The ONLY production path used was guarded source merge, prepared exact-main preview and independently guarded automatic promotion. Do not hold a promotion freeze while waiting for Uma. This session's freeze is gone; do not release another owner's future freeze.

All GitHub notes are signed with `Posted by Codex chat <id> on <machine>`. Use ai-gh and sanctioned bounded waiters; cost of unknown GitHub requests remains unknown. Use dedicated current-upstream worktrees, stage only owned files, verify Albert/u2giants committer, and preserve unfinished worktrees. DesignFlow remains sandbox-albert→develop under Uma's merge ownership.

## 8. Access and environment

Machine edge-dev3, Linux, timezone America/New_York. This Codex chat is `01a1126f-6efb-7a22-8034-4471909f2c86`. Supabase connector is authenticated to fixed productionqsl; execute_sql is safe for read-only catalog/sample inspection, not a production-write escape hatch. GitHub/Cloud Build read-only access worked. Reviewer wrappers use protected preexisting credential caches; they never call 1Password during a review. Secrets belong in vault `vibe_coding`, referenced by item ID only if needed. No credentials were created, printed, rotated, placed in files or retrieved from 1Password by this session.

Secrets sweep: actual owned source diffs/untracked inventory and session-created evidence reviewed; nothing new to store. Private native error/prompt/cache evidence stays local. Documentation pass: the source repair/retired-version behavior is already in merged code/tests and the delivery-specific lessons belong in this handoff; no unrelated AGENTS, old handoffs or business-rule text was rewritten. Other sessions' worktrees/containers/files were not swept or changed.

## 9. Open risks, remaining card and self-audit

As of10:35 PM EDT: #2873 OPEN/incomplete; #2874 applied-and-catalog-verified but app acceptance pending; #2875 source approved/CI passed but unmerged/unapplied; #3737 and final#2873 fresh delivery not started. Uma owns the application merge; Codex owns the database dependency and delivery. Machine privilege blocks global tool installation. No business question or technical manual step is assigned to Albert.

The existing #2873 issue is the durable card, including prior signed detailed comments6029334917,6029465589,6029626825 and the final publication note. #2874 receives its own production result/live-app-proof checklist. The publication note records the current documentation PR/main after this file's merge. No background automation, task chip or delegated agent was created. No partial production migration is hidden: the single successor transaction and its automatic verification completed SUCCESS.

Counts, source/main hashes, latest application/PR states, quota holds and private /tmp evidence may change or disappear. Re-fetch/re-query before use. Old consumer pins and old review/base evidence are explicitly historical. Do not treat sandbox build, installed files, a source APPROVE, a merge or a catalog-only observer as full end-user acceptance.

Self-audit completed: all10 sections exist. (1) A fresh developer can continue without a question: §§1–3 define repos/scope/ownership/exact states, §§6–8 define ordered gates/access. (2) All session knowledge required to continue is retained in §§3–5, including private evidence paths and failed review/tool/claim routes. (3) Background, goal, current verified versus pending outcomes, dead ends, constraints and exact verification gates are covered by §§1–9; no sub-agent work exists to omit. (4) Every sentence concerning owner/approval/access/merge/credential responsibility was checked: no business decision is open, so §0 explicitly says None, and technical platform/app gates are named in §§3,6,8,9. No technical approval is disguised as an Albert decision.

Posted by Codex chat 01a1126f-6efb-7a22-8034-4471909f2c86 on edge-dev3

## Moving-fact addendum — 10:47–10:49 PM EDT October6

The earlier installed535 observation is now historical: another process updated canonical ai-devops to **fdbbbe41c931e2d4cfc2ac719576202e726ee2e3**, `fix(ai-glm): end the turn at once when the provider returns an error (#1376)`. Repair merge961 is an ancestor; `bin/ai-stepfun` is byte-identical to reviewed candidate11a. `/usr/local/bin/ai-stepfun` resolves to that canonical file. Its free installed doctor PASSED at10:49 PM EDT with live=not-run. This does not prove the managed installation/full-input live outcome. Protected manifest still names744; sudo-n-true still refused interactive authentication at10:47 PM EDT. No owned installation operation occurred. ai-devops#1370 remains open for exact current-state managed/installed proof; re-derive the current source/manifest/launcher inputs rather than use the earlier535 delta blindly.

At10:46 PM EDT, own continuationPR4026 remainedOPEN at3c730f06 with auto-merge enabled10:45:21 PM EDT. Authorization correctly refused OTHER owner codex-01a1126e-c598-7d60-8cf4-e14427127e20's #3890/PR4024 freezee3326525eb3cdaca29a4c35025f0bb493d30cf96, acquired10:36:18 PM EDT, expiry11:36:18 PM EDT. Another owner's freeze must not be released/admin-bypassed. The publication note on#2873 supplies this addendum's resulting current head. After the freeze clears, rerun the failed prose authorization on the actual current head; query the latest failed run first (initial37563232497). Auto-merge still needs valid required statuses. This is an external publication blocker; the full continuation state already exists on the SAME issue.

Latest direct read-only production at10:47 PM EDT still proved705ledgerrows, tip235109, successorpresent and retiredoriginalabsent. BackendPR120 and TrackingPR3708 remainedOPEN at10:46 PM EDT. No application acceptance or final#2873 production outcome is claimed.

Posted by Codex chat 01a1126f-6efb-7a22-8034-4471909f2c86 on edge-dev3
