---
issue: 2873
status: BLOCKED
owner: Codex chat 01a1126f-6efb-7a22-8034-4471909f2c86 on edge-dev3
---

# Shared-db #2873 production delivery and instruction closeout

Snapshot: October 7, 2026, 6:12 PM EDT. The owner invoked `$wrap-up`; task implementation, new reviews, merges and database actions stopped under the shared-db handover gate. This is a resumable handoff, not a completion claim. Reverify moving facts before any action.

## 0. Business decisions only Albert can make

None. Nothing here needs Albert's technical approval, a command, access setup or a manual repair. Uma owns the DesignFlow application merge. Platform access and host-trust failures are technical blockers, not approval requests to Albert.

Already settled — do not re-ask:
- Carry #2873 and its dependencies through production and authenticated application acceptance. A merged PR is not acceptance.
- Remove the one-child/per-session stopping mandate permanently everywhere. Continue all authorized independent work concurrently; keep genuine claims, review and production protections.
- Never ask Albert for technical approval. Assigned AI reviewers gate technical actions. DesignFlow sandbox-albert goes to develop and Uma merges it.
- #2873 creates four passwordless LOGIN identities plus four NOLOGIN grant roles. It does not perform credential cutover, password rotation, global PUBLIC revocation or the separate #770 cutover.
- Existing inherited PUBLIC invoker helpers and the settled pg_net exception are preserved and explicitly tested. Do not expand grants for Tracking's Coldlion compatibility gap; that belongs to #770/backend #94.

A successor must consolidate any genuinely new business question in one message. There are none identified in this handoff.

## 1. Application, repositories and purpose

POP applications share the Supabase production project `qsllyeztdwjgirsysgai`. Database structure belongs to https://github.com/popcre/shared-db; consumer mirrors are read-only. DesignFlow PLM services need narrowly limited database identities in `dflow_prod`. The services are backend, item_master, tracking and data_sync. Application acceptance returns to `popcre/designflow-backend`.

The session also removed a global instruction that caused agents to stop after one child issue. Its canonical configuration belongs to `popcre/ai-devops`, tracked on #1409. Installation across machines and proof that running clients adopted the change are distinct from merged source.

There is no orchestrator or marker requirement. Structural work claims exact objects on the existing issue. Do not create a marker, dispatch ticket or leftover-proof issue.

## 2. Authorized goals and closeout trigger

Original goal: complete #2873 through production, including #2874, #2875 and #3737. Albert explicitly requested subagents and maximum safe parallelism, permanent removal of the stopping rule, a narrowing-freezes investigation prompt and a lightweight coordinator operating-procedure prompt.

On October 7 Albert invoked wrap-up. `/home/ahazan/.codex/skills/wrap-up/SKILL.md` routes a shared-db session into `/home/ahazan/.codex/skills/shared-db-handover/SKILL.md`, whose unfinished-work route says to stop task work and preserve same-issue handover state. No new paid provider, production action, installation or bug-fix scope was started after that instruction. Documentation publication is the closeout exception.

The user repeatedly found agents inactive. That was real: root ended earlier turns while completed agents needed root decisions. During the final working turn root resumed agents, stayed active, completed #3737 closure, released its own finished reservations, assigned the newly found collision recovery, and retained review/merge/production decisions. A successor must inspect actual agent inventory, resume unfinished actionable work, and never call an allocation an approval or report stale activity as live.

## 3. Verified current state

### Completed production prerequisites

- #2874 CLOSED/live_verified. Version `20261006235109`, PR #4023, merged production SHA `5df3dc4798d8aedbbf72ea2faead8a5f4ac134be`, production run `37561887885`, backend acceptance run `37622983858`. Strict evidence: https://github.com/popcre/shared-db/issues/2874#issuecomment-6038217816 . Claim #3704 released by its actual root owner and CLOSED.
- #2875 CLOSED/live_verified. Version `20261007132915`, PR #3708, merged/production SHA `fee69a25ffd9b39c2b3accfde680dfbac3aa54f5`, production run `37649977101`, backend acceptance run `37651900067`. Strict evidence: https://github.com/popcre/shared-db/issues/2875#issuecomment-6043304643 . Root completed outcome at 1:37 PM EDT. Claim #3705 released and CLOSED.
- #3737 CLOSED/live_verified. Version `20261007173858`, PR #4045, source head `b165a0276adc1bbbe68e3c0c2f0713ec22eede8c`, actual merged main `82d1b625477ac362e7c3c4792132dfcb68788dcb`. Guarded merge `37676251440`, dry-run `37680315788`, preview apply `37680944105`, automatic production `37681342112`, central observer `37682774422`, Tracking acceptance `37683064162` all succeeded. Strict evidence https://github.com/popcre/shared-db/issues/3737#issuecomment-6046688135 . All original ZIP digests, identities and generated-type bytes were authenticated. `verified_at` exactly matched observation `2026-10-07T20:32:47.265Z` (4:32:47.265 PM EDT). Root's supported complete-outcome returned completed=true and digest `6f33ceeb1480f64b2ddcf5a502c6cc3bc3926a6b2b01dda9468579a5408ea416`; direct issue readback CLOSED. Claim #4044 released and CLOSED.

The promotion freeze was automatically removed after #3737 production. Root independently confirmed no freeze was set, then `git ls-remote origin refs/db-coordination/promotion-freeze` returned no ref at closeout. Do not recreate a freeze for paperwork/application acceptance. Other sessions' stage leases must not be touched.

### Protected preview and current source

#3737 version `20261007173858` was applied to protected preview by the guarded workflow. No manual application row load occurred. Disposable PostgreSQL fixtures were separate synthetic, network-none environments. The full preview catalog was not rescanned at closure; it is not asserted clean and other sessions may have used it since.

At closeout remote main was `f435616ee5b2ed88bacc4f68ef7628ca48339d1c`; maximum source migration was `20261007190954`. This is source inventory, not a statement that every version is applied. The new documentation worktree is based on that main. All main, preview, latest version and quota facts need fresh verification on resume.

### #2873 preparation: complete preparation, no production delivery

Central worktree `/home/ahazan/.codex/worktrees/2873-live-acceptance/shared-db`, branch `codex/2873-live-acceptance`, clean committed head `004b810fd1239d7f9fd09849d319558d142b682e`. Observer commits were rebased onto then-current main `7403017589a56c955894b378006a9a5ec438f69c`; qualification fix preserved exact privileges. Relevant producer entry is `scripts/proofs/shared-db-2873-observation.mjs:7`; the associated compiled SQL/profile/workflow/tests are in that commit.

Exactly eight roles: `designflow_prod_<service>_grants` and `designflow_prod_<service>_runtime`. Grant groups NOLOGIN/NOINHERIT; runtime identities LOGIN/INHERIT, no passwords or administrative options, connection limits 20/10/10/10. The exact direct matrix has 427 entries and nine function grants. The three inherited PUBLIC helpers are SECURITY INVOKER: get_parent_id, get_child_id and reject_sample_movement_mutation. Exact body/security metadata and caller refusal are tested; nine direct function grants do not imply only nine effective callable functions. Effective relation closure, membership/set/inherit flags, ownership/default/grant-option exclusions, client access, outside-schema access, global CREATE and TRUNCATE exclusions are tested.

Proof: central six tests, backend 73 profile tests, actual isolated PostgreSQL17 full427 matrix and eight helper refusals, plus nine malicious negative mutations all passed with rollback. Qualified prospective migration also committed in the disposable fixture. These are rehearsal proofs, not production acceptance.

No fresh #2873 claim, reserved version, migration file or structural PR exists. Retired version `20260928183329` must never be reused. Exactly320 supported claim keys are prepared (relation table/view ambiguous pairs are deliberate). Source template/claim commands are under `/home/ahazan/.cache/2873-delivery/` and original preparation files under `/tmp/2873-fresh-*`; exact assembly notes are `/tmp/2873-fresh-delivery-ready.md` and `/tmp/2873-fresh-source-assembly/assembly.json`. Rebase before structural authorship, then use the actual returned claim/version, removing only four prospective header lines.

Backend worktree `/home/ahazan/.codex/worktrees/2873-backend-acceptance/designflow-backend`, own approved head `e11c1e453d9748be583f5c85817f48cb7aff465f`, pushed safely through sandbox-albert. Foreign head `12f57fddf4436a89435d8f197e423319b9f3c89a` is preserved; every #2873 proof/workflow byte is unchanged. PR #122 OPEN at 6:09 PM EDT: https://github.com/popcre/designflow-backend/pull/122 . Uma alone merges develop. Independent Muse APPROVE for e11 is `.ai/reviews/muse-final-check-20261007T214441-189496-7510.md` in the backend worktree; it does not silently approve foreign subsequent source.

The latest preserved backend source12f57 was sandbox-deployed: Cloud Build `8f92227c-bf1c-4735-b06d-42a99b174e5a` SUCCESS; revision `popcre-albert-core-sandbox-00533-2d7` Ready=True,100%traffic, digest `sha256:5ac1835b35b496b38023f3e91a09090d897e6395462a06b3705908c63cef6cc4`, verified 6:01 PM EDT. This is sandbox tooling delivery, not #2873 production acceptance.

### Actual #2873 blocker: completed foreign claim #3733

Root compared all16 open claims against the320-key scope. Its own completed3704/3705/4044 are now closed. The only observed remaining overlap is #3733 on dflow_prod.RFQItem and itemHeader.

Claim #3733 belongs to `Claude chat 626c9036-7381-4131-aeee-6e29883153c6 on edge-dev3`, branch `claude/3400-hts-phrase`, foreign worktree `/home/ahazan/repos/shared-db/.claude/worktrees/hts-3400`, version `20260928182014`, lease expired September29 2:19:42 AM EDT. Linked #3400 CLOSED, PR #3734 merged: head `41ba011a6accf01b0c654f252d7657df460ebb85`, merge `1a58e94a5f2ec04e109d3d34a6ecdeb1da8d8cd9`. Fresh read-only production inspection confirmed installed version and all12 nullable/no-default columns. Old #3400 completion metadata incorrectly names shared-db as application consumer; it is not current authenticated backend acceptance. Administrative ownership release must not falsely close that acceptance gap.

Foreign worktree is DIRTY: only deletion of `-- derived-from: none` from the migration. Pending bytes match published canonical preservation base `36d26a393ec311b416023fd21a543310165e6ca2`, not the original PR3734 grouped-DDL source. Root independently verified exact single-comment difference. No foreign file was edited, moved or deleted.

Durable sanitized preservation: commit `efb3c3e90fa5ac11cc6f28c559dd370071e544b5`, tree `1ab8cd090b9e0e4d471ed6e6cd33f63f2318a786`, create-only ref `refs/db-claim-preservation/20260928182014` in public shared-db; independent remote readback matched. Exactly catalog.json, pending.patch and pending.sql, all reviewed public SQL/catalog metadata; no raw MCP transcript or customer rows. Pending SQL SHA256 `2f69e7aac826da127795159149045322945131637afdd3527edba717dc4159d3`. Catalog captured_at is capture time, not falsely provider observed_at. Runtime recovery must obtain real fresh server observation.

### Recovery capability repair: #4054 / PR #4056

https://github.com/popcre/shared-db/issues/4054 ; https://github.com/popcre/shared-db/pull/4056 . Worktree `/home/ahazan/.codex/worktrees/completed-foreign-claim-recovery/shared-db`, branch `codex/completed-foreign-claim-recovery`, clean pushed head `42ade5e80dc1eaa099c4ff7e13ed1faff6bc5d34`.

833 Node and221 Python tests PASS. Independent additional audit APPROVE,42/42 focused tests PASS; this is NOT the allocator gate. Latest readback PR OPEN, ephemeral database CI IN_PROGRESS; no terminal failure on the corrected head was observed at closure. Bounded existing CI waiter34150/log corrected-ci-wait.log may finish; do not treat pending as success.

Formal review assignment sequence5711: deepseek-v4.1-flash / ai-deepseek-agent / slot1, exact42ade head. NO paid provider was launched. Allocation is not an APPROVE. Deliberately preserved under root ownership; supported unstarted probe/reclaim requires age>=10min and no durable start. No generic cancel or fabricated provider failure is allowed. Exact disposition: https://github.com/popcre/shared-db/issues/4054#issuecomment-6047871992 . Verify current lease before starting or reclaiming it.

New command `--recover-completed-claim` is unmerged and MUST NOT be run yet. Module `scripts/lib/lanes/completed-claim-recovery.mjs:19` validates exact manifest; :28 proves fixed registered3400 recovery; :59 creates immutable administrative receipt and closes the claim under mutex. It requires closed linked shape record, expired exact lease, current session authority, merged source/current-main ancestry, exact harmless pending preservation, no open source PR, fresh fixed read-only target/catalog/version, and allocator APPROVE of separately reviewed regular config bytes. Static trusted dependency closure/config guards prevent authority-code movement. Receipt retry preserves immutable identity while rechecking fresh catalog; final foreign bytes/claim/source/main race checks refuse changes.

Root ruling for this ADMINISTRATIVE action: safe descendant-main movement is permitted only with unchanged trusted recovery/authority code and all live guards. It changes no production-preview rules and needs no global promotion freeze. No manifest PR, runtime recovery receipt or #3733 release has happened.

Same-issue handovers:4054 https://github.com/popcre/shared-db/issues/4054#issuecomment-6047853321 ;2873 https://github.com/popcre/shared-db/issues/2873#issuecomment-6047858160 . Private state `/home/ahazan/.codex/private-evidence/completed-claim-recovery/wrap-up-state.md`; implementation note `/home/ahazan/.cache/2873-delivery/subagent-handover-20261007.md`.

### Permanent stopping-rule removal: source done, fleet incomplete

Canonical ai-devops PR1395 merged `75ce911360378ba27a9573560150828373b135e2`, removing stopping mandates from25 documents/four client globals. PR1417 installation-gate repair merged actual `d8e68164182fff38e4184539050acadb23562ca0`; source tests282 plus actual Windows fixtures passed and independent review approved. Existing parent/child issues received revocation notes; no continuing one-child cap is authorized by this owner's earlier explicit instruction.

Track remaining installation/acceptance at https://github.com/popcre/ai-devops/issues/1409 . Worktree `/home/ahazan/.codex/worktrees/stoprule-legacy-adoption-repair/ai-devops` clean and preserved. Full recovery timeline `/tmp/restore-stoprule-ready.md`.

- 916: actual native reviewed current05 installation, launcher receipt/doctor and allfour globals verified. Original42-line machine section byte-for-byte preserved. Private original backup C:/Users/ahazan2/.local/state/ai-devops/stoprule-global-originals-6a2ddaf69c0b4bb59acbf3ae162de498. Existing running-client refresh not proved.
- Hetz managed ai account: fresh allfour continuation rules present, revoked mandate absent; installed bodies verified. Separate inaccessible root profile is not claimed verified.
- 4837/al8960ofc: original installed source/globals unchanged. Latest e637 native review lifecycle `20261007T214224-211345-13875` timed out, genuine `4837 exit 124`, enforced ceiling6:11:55 PM EDT. Provider/supervisor processes absent, report/verdict null, lifecycle still erroneously running. No fabricated finalization or installation. Current source moved to `598d6144944f1a14d65b49d55192b9c302e7e52d` at6:09 PM EDT; even a historical e637 verdict would not authorize current-main installation.
- Local edge-dev3: missing-link symptom resolved, native doctor PASS. Protected stale installation manifest still requires unavailable noninteractive sudo; allfour old globals still carry the mandate. Report platform block; do not bypass its supported reviewed installation gate.
- edge-dev: foreign tmp/ and new HANDOFF.d/2026-10-07T2206Z-edge-dev-mimo-3947-forward-replace-merged.md belong to MiMo #3947/#3955; newest owner artifact6:06 PM EDT, execution currently unverified. Process absence is not abandonment. Keep foreign work untouched; no canonical advance while ownership conflicts.
- alien: strict trusted SSH host-key mismatch still refuses. Do not accept replacement fingerprint without trusted verification.
- Envy: authenticated account and readable profiles have no observed four-client globals/toolkit. No client provisioned; no mandate removal falsely claimed there.

The narrowing-freezes prompt `/tmp/investigate-narrow-promotion-freezes.md` and coordinator-SOP prompt `/tmp/ai-devops-coordinator-progress-procedure-prompt.md` were delivered. They are prompts, not verified deployment of new policy. Do not claim all fleet/active-client instructions complete.

## 4. Failed attempts and dead ends

- Root ended earlier turns while agents awaited ready decisions. Corrective action was actual inventory/resumption and root action, not a future promise to monitor.
- #3737 preview preparation initially lacked token; unsupported native op account could not resolve it. Protected MCP op_run was used. A60s killed preparation left own author mutex; supported stale recovery run37679742058 succeeded. Serialized protected token injection then completed preparation; token file deleted.
- GitHub core quota paused original consumer artifact requests until4:54:42 PM EDT. No identity swap, throttle override or fake proof. Strict #3737 evidence was published only after reset and authenticated original bytes.
- #2873 bare properties_and_characters labels tripped the preserved core SQL guard. Explicit dflow_prod qualification fixed metadata/preconditions without changing320 keys or427 privileges; full real fixture/negative proof rerun.
- /tmp is32GB tmpfs and filled with foreign #658 prototypes/3536 private checkout. Reviews failed ENOSPC before provider; supported0700 task TMPDIR under owned home restored privacy classification, packet and provider capability. No foreign deletion.
- Ordinary #2873 claim refused4044, then3733. Own completed reservations were released properly. Foreign3733 cannot be released by supplying its old owner's identity. Adoption/recover-expired require an open PR; PR3734 is merged, so those routes correctly refuse.
- Recovery first head bcb2: missing critical dependency protection, prohibited per-file GitHub contents query, invalidator and catalog entry inventory gaps. One batched42ade correction reused trusted cached tree/blob reads, bounded dependency closure/non-import policy, and actual Git refusal tests. Initial issue change_type tooling was invalid; corrected to repo-maintenance before paid review. No provider was charged on that refusal.
- Initial preservation assumed PR3734 head. Actual pending bytes derive from later published36d26 canonical migration; separate pinned preservation base corrected this without widening pending SQL allowance.
- Windows4837 previous Muse lacked tooling; initial Grok door lacked cached env; original dirty review snapshot edited one test line and correctly failed drift. All failed evidence preserved. Subsequent current-source reviews were invalidated by main moving, never accepted via ancestor bypass. Final bounded e637 review timed out; no approval invented.
- Windows916 ordinary PowerShell5 stderr/.NET backup issues were corrected before global writes using supported PowerShell7. Existing local missing symlink block is obsolete; current protected-manifest/sudo block remains.
- Five-minute waiters returned pending; later actual deployments were independently verified. A pending waiter is not a passing check. Synthetic HTS node-runner failure was not claimed as full foreign HTS validation.

## 5. Root causes, findings and durable decisions

Ownership and terminal acceptance are distinct. Closed application work can leave an authoritative structural claim open; expiry does not release it. Do not infer safe owner takeover from process absence. Ordinary owner release stays unchanged; foreign completed recovery is a separate reviewed capability.

Recovery manifests must be regular config, not .agent-only evidence equivalence. Source tool review and exact-input action review are separate. Match all approval identities; source main/target/immutable artifact proofs cannot be inferred from allocation, merge or an old report. Check critical authority dependencies/config too, not just direct source files.

#2873 direct/effective privileges differ because existing PUBLIC helper ACLs are inherited. Preserve exact approved exceptions, test caller refusal, and prove no outside CREATE/TRUNCATE. Application generated-types default remains required; only #2873 profile says not-applicable.

Docs pass: no unrelated current rules were rewritten during closeout. This handoff and same-issue notes carry current state; recovery source docs already describe the proposed unmerged capability. Historical handoffs are not instructions. One-child stopping text is revoked by Albert; do not reintroduce it. A merged installation repair is not installed globals, and disk globals are not running-client adoption.

## 6. Exact next steps and observable gates

1. Read current2873/4054/1409 and this handoff. Inspect actual main, source heads, claims, freeze/stage leases, provider quota and task authority. Verify no active predecessor tool; assign a new named owner. Gate: current live facts documented and foreign work untouched.
2. Resume maintenance4054 PR4056 at exact42ade or newer reviewed head. Inspect assignment5711 and its age/start record; either start the allocated provider through supported governed runner or use documented probe/reclaim only when eligible. Run review concurrently with the existing bounded CI waiter; no duplicate provider/polling. Gate: allocator exact-head APPROVE plus actual required checks green, not just independent42-test audit.
3. Root/successor dispatches guarded merge for PR4056/head using fresh task gate and .github/workflows/guarded-migration-merge.yml. Gate: actual protected main contains merged tool; keep4054 open/reopen after source auto-close until runtime acceptance succeeds.
4. Prepare separate maintenance evidence PR on same4054 with config/completed-claim-recovery/3733.json containing current actor/new session UUID, exact old claim body digest, sourcePR3734/head/merge, actual reviewed merged tool/main ancestry, preservation base36d26 and efb3 commit/digests. Re-read claim/source/foreign bytes first; no fake timestamp. Gate: correct manifest passes validation and assigned exact-input review APPROVE of its regular config bytes. Do not inherit predecessor actor identity.
5. Run supported current-main --recover-completed-claim3733 using exact approved manifest/reviewissue/PR/head, correct session authority and serialized protected vault token. Its fixed producer obtains actual read_only target/version/12column/server observed_at; mutex rechecks preservation/claims/source/main and immutable receipt precede closure. Gate:3733 CLOSED, immutable refs/db-claim-recoveries/20260928182014 readback, no foreign changes and no false3400 application acceptance. Only then complete4054 runtime record and merge/audit evidence as governed.
6. Rebase clean #2873 central preparation onto actual current upstream, retain004b qualification. Recheck scope/320 keys against current application sources and reservations. Use supported exact-object claim/reservation on2873; generate migration with returned fresh claim/version/header, never retired20260928183329. Gate: valid live lease/sourcecontract/version with full427 matrix unchanged and SQL guard/tests passing.
7. Push one structural head; start two allocator migration reviews concurrently with CI. Batch all findings into one head. Guarded merge only on exact-head approvals/required checks. On actual merged main obtain risk-slot approval/immutable merged-main preview, prove bounded allowlist and automatic promotion gates. Any freeze/stage lease must be shortest supported scope/duration and released immediately after terminal production; never bypass another owner. Gate: workflow-qualified automatic production SUCCESS with exact source/version/target.
8. Uma merges backend PR122; reverify actual develop SHA and unchanged approved proof bytes. Dispatch new central2873 observation with actual source/main/version and backend SHA; authenticate original archive identity/digest/bytes, relay unchanged archive through backend proof workflow. Gate: genuine backend acceptance artifact and all real role/catalog flags pass; verified_at equals immutable observed_at. Supported complete-outcome closes SAME2873. Keep its live-proof checkbox open until then; do not create leftover ticket.
9. Resume1409 fleet installation from true current source. Diagnose orphan timed-out4837 lifecycle via supported tooling; do not fabricate review report or duplicate provider. A fresh exact-current host-local qualified review, unchanged source/report hash, supported authorizer/receipt/doctor and allfour body parity/machine preservation are required. Respect local platform block, alien trust and edge-dev foreign work. Gate: each applicable profile installed and actual running-client refresh proven; record exclusions honestly.

## 7. Constraints and gotchas

Use ai-gh and bounded event-aware waiters; no quota evasion or long hand-written polling. Structural claims/serial production are real dependencies; no coordinator marker or one-child cap. Use fresh own upstream worktrees and stage only owned files. Shared canonical checkouts are landing-only. Source cleanup and merge decisions remain the coordinator's; independent audit does not replace allocator review. Sign every GitHub post with actual chat UUID and machine. Human-facing times are EDT/EST New York.

Do not manually dispatch production or execute manual live SQL mutations. Automatic qualified merged-preview lane is the authorized production route. No app row data/backfill/credential cutover here. No foreign worktree cleanup, handoff rewrite, shared HANDOFF.md edit or secrets in public preservation. No --admin merge or direct protected main push. Existing root HANDOFF.md is already the static pointer and was not changed.

On resume the closeout freeze ends for the explicitly authorized original work; it does not create authority for unrelated cleanup. Continue all remaining authorized scope once real gates pass. Ask Albert only new business-meaning questions, never routine technical permission.

## 8. Access, environments, preserved work and secrets sweep

Production project is fixed above; preview must resolve fresh repository PREVIEW_PROJECT_REF. Existing Supabase management credential is in vibe_coding vault, item ID `3t2xoqk5luyz7ffgdhj24gvtpq`. It is an existing credential; no new password/credential created or rotated. Native op account was unavailable; protected MCP op_run with reference-only env file plus serialized0600 protected pipe/file route worked. Never expose token in arguments/logs/transcripts. Protected temporary /home/ahazan/.cache/shared-db/3737-preview-access.token confirmed ABSENT at closeout. Credential metadata lookup confirmed existing vault item; no vault mutation needed. Owned source/diffs/state scans found no new value requiring storage. Synthetic negative-test passwords are fixtures, not live secrets.

Deliberately retained worktrees, branches and ignored evidence because parent2873/fleet work is unfinished:
- root `/home/ahazan/.codex/worktrees/77d7/shared-db`, branch codex/3972-guarded-successor-recovery, clean; old recovery evidence, not next write location.
- `/home/ahazan/.codex/worktrees/3737-parallel-recovery/shared-db` and `/home/ahazan/.codex/worktrees/3737-actual-main-risk/shared-db`: completed child source/risk evidence needed for parent audit; preserve ignored .ai reports. No active claim4044.
- `/home/ahazan/.codex/worktrees/2874-risk-recovery/shared-db`, 2874-merged-risk/shared-db and 2874-merged-delivery/shared-db: prerequisite evidence referenced above; no active3704 claim.
- `/home/ahazan/.codex/worktrees/2875-recovery/shared-db`, 2875-claim-policy/shared-db and agent-2875-* evidence: no active3705 claim; retained parent/source proof.
- central2873-live-acceptance and backend2873-backend-acceptance: clean committed unmerged/current preparation, MUST preserve.
- completed-foreign-claim-recovery: clean pushed OPEN4056, MUST preserve.
- stoprule-legacy-adoption-repair/ai-devops: merged source but unfulfilled fleet installation evidence, MUST preserve.
- closeout2873-session-closeout/shared-db: only owned prose handoff, published through its own docs PR. Remove only after its merged state, clean tree and ignored-file preservation are proven.

No branch/worktree deletion performed. This is a deliberate protected inventory, not unexplained abandoned work. Prior private temp artifacts, fixture containers and evidence remain; no /tmp sweeping. The predecessor handoff files were not opened or deleted for housekeeping: successor retirement requires individual proof and preservation of all obligations. No current handoff is marked DONE.

## 9. Risks, uncertainties and continuation prompt

Main/CI/claims/quota/provider lifecycles and application sources move quickly. Every snapshot above has its observation time or explicit stale warning. source maximum != applied maximum. Current preview full state is unverified. #3400's older application-acceptance metadata is not repaired by administrative claim release. No role grants are in production yet. Fleet rollout is incomplete; unreachable profiles and active clients are not silently excluded.

The final4837 provider timed out; no genuine approval/report exists even if lifecycle says running. Supported diagnosis is required, not a forged lifecycle finish. Assignment5711 has no paid start; honor the documented age/start guards. The corrective source CI was still nonterminal at closure; the same bounded waiter may have completed afterward.

### Copy-paste next-session prompt

Continue popcre/shared-db #2873 through production from HANDOFF.d/2026-10-07T2212Z-edge-dev3-codex-service-identities-closeout.md. Read sections0–9 and all per-agent blocks before acting. #2874/#2875/#3737 are production-complete and their owned claims3704/3705/4044 are released; no promotion freeze is set. #2873 has tested passwordless eight-role preparation at004b810f but no fresh claim/version/migration. First resume maintenance4054/PR4056 exact42ade, verify formal reviewer assignment5711 and actual CI, obtain allocated approval and guarded merge. Then separately review the exact regular recovery manifest and safely release completed foreign3733 using the new supported command with preserved efb3 artifact; never impersonate old owner or touch foreign files. Claim/ship2873 on fresh upstream with actual returned version, two exact-head migration approvals and qualified automatic production. Uma owns backendPR122 merge; authenticate final actual backend acceptance before completing SAME2873. Resume ai-devops1409 permanent stopping-rule installation separately; its fleet, access and orphan-review facts are in this handoff. Spawn/restart subagents for independent work, verify actual activity, keep coordinating ready decisions, and do not stop after one child. Ask no technical approval from Albert. Preserve every owned/foreign worktree and private artifact listed. Reverify current main, claims, review records and target before writes.

## Part (b): each dispatched agent, separately

### Agent /root/deliver_3737
Asked to complete3737 production and acceptance, then audit/recover the foreign3733 blocker. Actually completed production/central/Tracking proofs and strict signed3737 evidence; root closed outcome and own4044 claim. Subsequently authored/pushed maintenance4056 corrected42ade,833Node/221PythonPASS, allocated5711 but did not launch provider. Own recovery worktree clean/resumable; sourceCI nonterminal. Found exact oldclaim dirtycomment difference and wrong preservation-base assumption, corrected transport/criticaldependency/invalidator defects. Deliberately did NOT release foreign3733, merge4056, launch post-wrap-up review or assert3400 app acceptance. Existing4054 notes linked above carry final state.

### Agent /root/identity_acceptance_2873
Asked to prepare genuine427-entry role/catalog acceptance and backend strict relay while parent prerequisites ran. Actually committed central004b and pushed independently approved backende11; preserved foreign12f57, verified actual sandbox image/revision/traffic, authored exact320claim inputs/prospectiveSQL, ran real positive/negative fixtures. Independent recovery audit first REVISE then42adeAPPROVE42/42. Own central/backend worktrees clean/resumable. Did NOT claim/version/migrate sharedDB, perform credentials/cutover or self-merge Uma's PR. Same2873 handover linked above.

### Agent /root/restore_instruction_delivery
Asked to carry permanent rule removal through supported installation on reachable fleet. Actually shipped gate repair1417; completed916 source/receipt/doctor/globals/machine-preservation and Hetz managed-profile parity. Accounted for other hosts, corrected tool transport safely and preserved timed-out4837 native outcome. ai-devops worktree clean/resumable; original remote4837 source unchanged. Did NOT infer runtime adoption, bypass current-main/host trust/sudo, touch MiMo work or launch new post-wrap-up review/install.1409 records exact unresolved state.

### Historical agent /root/identities_2873
Prepared initial prospective identities SQL/security findings, inherited-helper and Tracking compatibility analysis. Artifacts /tmp/2873-parallel-prepared-identities.sql and /tmp/2873-tracking-cutover-compatibility-proposal.md were superseded for execution by central004b qualified preparation. Did not claim/version/apply production. Current acceptance agent's exact source/evidence above governs; preserve earlier private preparation worktree for audit.

### Historical agent /root/tracking_2875
Prepared/recovered Tracking parity and its application acceptance. Completed deliverable is2875's strict record/source3708/version20261007132915 above; root alone performed final completion and released3705. Prior recovery worktree preserved for parent evidence. No separate future2875 task remains; do not redo its completed production work.

### Historical agent /root/prerequisite_3737
Prepared predecessor notice/factory recovery. Current deliver_3737 source4045/version20261007173858 and authenticated strict outcome supersede earlier drafts; old3737-recovery worktree is intentionally preserved. Did not own final root production decision or final outcome closure.

### Historical agent /root/remove_stop_rule
Removed stopping instructions in canonical source PR1395 and active issue notes, including the user-authorized small memory extension. Later restore_instruction_delivery owns installation repair1417 and fleet1409. Source removal is complete; installed/runtime fleet proof is not. Do not treat source merge as full permanent rollout.

## Self-audit: all four questions passed

1. Fresh-developer completeness: YES. Sections1–3 identify repositories/goals/exact states,6 gives gated ordered actions,8 lists access and preserved locations, and part(b) separates each agent.
2. Can continue as effectively as this session: YES. Sections4–5 preserve failed paths, ownership distinctions, actual preservation base, quotas/temporary-storage recovery, direct/effective privileges and current-main installation pitfalls.
3. Every relevant execution detail included: YES. Sections3,6–9 pin source/version/artifacts/approval identities, expose incomplete stages and require actual live success; no preparation is called delivery. All pending scope is on existing2873/4054/1409.
4. Business-decision sweep: YES. Every approval/access/manual-step statement in1–9/part(b) was reviewed: all are technical coordinator/reviewer or Uma dependencies, none asks Albert for technical approval. Section0 explicitly says none and preserves settled instructions. No undisclosed business decision was found.

Posted by Codex chat 01a1126f-6efb-7a22-8034-4471909f2c86 on edge-dev3
