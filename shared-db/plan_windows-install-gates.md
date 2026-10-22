# Implementation Plan: Unblock Windows installation of ai-devops toolkit

## STATUS

| Phase | Step | Status | Evidence |
|-------|------|--------|----------|
| 1 | P1 — Patch `update.sh` path normalization | Done: merged source; do not redo | [ai-devops PR #1559](https://github.com/popcre/ai-devops/pull/1559); merged source commit `167790b022ff0d87be4ab58be7870807fd90a162`; syntax, focused path checks, independent exact-head review, required CI and merge-group checks pass. |
| 1 | P2 — Patch `update.sh` / `ai-task-gates` lock fallback | Done: merged source; do not redo | Same PR; real edge-dev missing-`flock` concurrent exclusion, signal cleanup and lock reuse pass. No `flock` call exists in `ai-task-gates`; Linux descriptor locking is retained. Independent review, required CI and normal merge are complete; installed acceptance is also verified at P6-P8. |
| 1 | P3 — Patch `ai-task-gates` launcher path check | Done: merged source; do not redo | Same PR; real edge-dev MSYS/Windows root equivalence and managed launcher routing pass with both ProgramFiles variables unset. Independent review, required CI and normal merge are complete; installed acceptance is also verified at P6-P8. |
| 2 | P4 — Separate review and installation tasks | Done October 11, 2026 | Own Windows REVIEW and INSTALL linked worktrees; preserved installation start head `698554f6013a78e7be4c67ecf8afa9b2a4409708`, independent review task. Historical Mimo/b904 task retained, not reused. |
| 2 | P5 — Fresh final-check of selected merged release | Done | Muse APPROVE/nonstale at `6a7fd7340969c075687600b1988ef7b542efc90b`, base actual installed merge-base `698554f6013a78e7be4c67ecf8afa9b2a4409708`, implementer/caller Codex, October 11, 2026, 10:52:49 AM EDT. |
| 2 | P6 — authorize-install with MSYS bindings | Done | Exact target/source/report/lifecycle admitted; `/c/repos/ai-devops`, managed extensionless launcher and own `/tmp/` review path. One-use authority consumed by supported installer. |
| 3 | P7 — Supported full Windows installation | Done | Full installer exit 0 with `-ExpectedHead 6a7fd7340969c075687600b1988ef7b542efc90b`; no copied launcher, downgrade, source-only flag or quarantine bypass. |
| 3 | P8 — Installed hashes, routing and native privacy | Done | Exact clean target; all 72 catalogued bash/cmd launcher receipts match target and actual source hashes. 788 task-state entries: owner-only full access, no reparse points. Muse and DeepSeek installed-healthy/usable. |

**Fresh session starts at:** Windows installation/privacy and supported Linux installation at selected merged `e4bfa05aa47963c27ced1272ac4c27323a11849a` are verified; toolkit#1531/#1548 are closed. Fresh genuine v20 full52-path/exact-action review approved clean private source `abb6741fb49443972298ad4a5ccc6708bb17b132`; both native stages and all six hostile changes refused correctly under real installed enforcement. The approved action finished with both105-table forward rounds matched and a genuine60,549,467-byte copied snapshot exported. The local undo runner then failed with BrokenPipeError after READY_CURRENT, before RESTORED_CURRENT or either undo round. Mandatory original103-table/1,007,245-row/catalog/archive-absence restoration passed79.45580676296959 seconds; temporary credentials/transports were deleted and owned action/namespace processes exited. Full recovery and production acceptance remain false. The new failure was found during the requested wrap-up and is recorded for the successor; no fresh database attempt or capability-reducing workaround is started. Preserve the existing v20 outputs; a new corrected source/output generation requires fresh review. Production privacy remains an actual capability refusal on the7:39 PM EDT read-only proof. Physical PITR, writer fencing, the single scheduled move and authenticated production acceptance for allfour services remain unproved. Continue from the [current recovery handoff](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-10-12T0008Z-edge-dev3-codex-770-recovery-production.md); do not repeat completed installs or earlier dead ends.

**Final v20 recovery disposition — observed October11,2026,8:21:51 PM EDT:** Exact approved action exited1; both forward rounds matched all105 tables and observed/preserved all99 source counters without source writes or writer freeze. Round1 base1,016,039rows/124.26597492297878seconds, AuditLog delta33rows/4.846111446036957seconds, frozen full reload1,016,072rows/124.6738839110476seconds; round2 base1,016,072rows/142.14486867195228seconds, delta0rows/18.625728954037186seconds, full reload1,016,072rows/125.89729862200329seconds. These are fresh source projections; changing source rows during this unfenced rehearsal are not claimed frozen. Copied snapshot export succeeded,60,549,467bytes,SHA256 `e616933ab4a1a60985fe31c19c5da3640198ca9b3f741c13dd186620d57c2258`; the scoped catalog cursor correction worked.

The local namespace undo runner failed during current-snapshot FIFO ingestion. Protected error is `[Errno 32] Broken pipe`; last phase READY_CURRENT, with RESTORED_CURRENT, both reverse dumps and final reverse result absent. Root cause is not yet established and no undo/PITR acceptance is claimed. Full-operation result SHA256 `7f14a838a6e346c4f4ec4ac2cf4808dc92d3d68fd6557e9d3c33576c4f2633c9`, copy_verifiedfalse, postwrite_recovery_verifiedfalse, credentialsNOT_RUN and application acceptancefalse. Mandatory original recovery independently verified all103 tables,1,007,245rows/catalog,original archive absence and deletion of temporary credential/transports in79.45580676296959seconds; restoration SHA256 `89a41f2793037242afbeea668bd4c67481faab71d468c9fe2bd2a2ad73654ea6`. The owned namespace supervisor and exact action processes are absent. Snapshot, postwrite configuration and error/namespace logs remain encrypted and immutable; do not delete or overwrite these now-existing leaves or retryv20. The requested wrap-up defers this newly discovered runner failure into the same existing#770/#160 cards and current handoff.

**Fresh v20 recovery approval and native admission — October11,2026,8:00:58 PM EDT:** Genuine independent provider20261011-195656-1094282 completed APPROVE/nonstale at original `abb6741fb49443972298ad4a5ccc6708bb17b132`, synthetic `565afca42f08a52a675fef6934c828b4c232e9d1`, full selected-code review base `a80f96b5f389c9cfd7b3dea5ccf6bbf498a30789` and stable task predecessor8af. All52 selected paths,51 typed code hashes,77 frozen inputs and five absent future outputs are bound. Report SHA256 `fc59ffc884caac7b8a56f8e7930b625bc9c47a5bd473d489d418358490f5f280`; packet `56a7ee18f57874ba3951e0e6f1668006db2eb6255acdd6f7d44efca62396c94c`; descriptor `bb582b1640c4494df4977f08a324882f81a1b59ff7a227c7d3b4bfca48677219`; reviewed manifest `a1a71d3e8ef691bc2659546ba13f876bcb91b66845a46865a98aa7d5165eca93`; binder proof `30e72bf9a60a51e15241dae9c7c6588ce7934e5e309e4026b83cfc05cdc5b472`. Root verified actual installede4/native receipt, protected private-evidence class, ordinary-report refusal, initial-forward/original-restoration passes, all six production-target/schema/credential mutations refused, and repeated initial admission. Exact prepared action is active with the existing installation mutex held through final restoration. Credentials, application callbacks and production remain excluded; no timing/recovery outcome is claimed before immutable results.

**Historical checkpoints below:** Dated active/review/wait observations describe the state at that earlier time; the fresh-session checkpoint and final recovery disposition take precedence. Do not restart completed installations or reuse older approvals.

**Actual v19 forward proof, export refusal and correction — October11,2026,7:55 PM EDT:** Both actual forward rounds completed at source8af. Each base and frozen full reload matched105 tables and1,016,035 source-projection rows. Base copy/reconciliation seconds125.05766771401977 and127.78608165297192; frozen full reload123.04863511095755 and122.65423938800814; AuditLog ID-delta rows0 in both rounds,3.8165002450114116 and7.525142248021439 seconds. Each pass observed all99 source counters, retained source/collision contracts and wrote no source sequence. Source writer freeze remainedfalse. These are timing/reconciliation proofs, not production downtime, physical PITR or application acceptance.

Post-write callback reached a default-tuple connection but its archive catalog requires named rows, producingTypeError before snapshot creation. The whole operation therefore reports `copy_verified:false`, `postwrite_recovery_verified:false`, credential statusNOT_RUN and application acceptancefalse; it is not full recovery acceptance despite successful forward rounds. Mandatory original restoration passed all103 tables,1,007,245 rows/catalog,original archive absence and transient transport deletion in83.19163450296037 seconds. Immutable result SHA256 `cc5223da40f2d79a73b67f6cd40e37aa25e027ffa6754aa59862efaa8fecba82`; original-restoration SHA256 `ef96e606e51cb786d6bc9d327c4649687db3852897b031021e3ac97fb4ab0d59`. Copied-snapshot and postwrite output leaves remain absent.

New preserved private source `abb6741fb49443972298ad4a5ccc6708bb17b132` uses a scoped `dict_row` cursor solely for archive comparison; native tuple custody identity and exported snapshot contracts remain unchanged. Full callback regression reproduces oldTypeError and passes the correction; altered archive contents refuse before exporting, and temporary password transport is removed. Actual verified-TLS isolated read-only probe independently confirms tuple identity, old named-index refusal, corrected dictionary access and tuple snapshot contract, with writes0. All179 rehearsal+82 recovery+37 credential checks pass. All51 code commitments and77 v20 input hashes are updated/verified; five typed future-output entries are true/absent. Pending manifest SHA256 `3956f9945355af3e195e72cd97cc498a2cd86396e970f5604e098c2b71fca1d5`. Fresh v20 review completed genuine APPROVE for originalabb/synthetic565af; its exact reviewed manifest is bound and native conditions pass. The approved action is active; v19 approval is not reused.

The documentation draft was automatically archived at7:41:25 PM EDT in a recoverable snapshot. Exact owned bytes were recovered into an attached managed worktree; the saved snapshot and all private recovery sources/evidence remain preserved. No draft loss or unreviewed repository replacement occurred.

**Fresh production prerequisite verification — October11,2026,7:39 PM EDT:** Serial protected vault custody and verified-TLS/read-only transaction freshly confirm four production runtime roles and all four passwords NULL. `log_error_verbosity=default`, native SET privilege false, and supautils allowlist lacks the control. DUMMY fatal redaction remains unproved; zero database writes, no setter, no issuance, no logger change and no credential-incident reopening. Protected exclusive readiness-v3 retains the proof. Required production privacy remains an actual platform capability refusal, not a human-approval request.

**Fresh v19 approval and native execution — October11,2026,7:34 PM EDT:** Genuine provider20261011-192714-666199 completed APPROVE/nonstale at original `8afda0edfae275b6c85e9827c67483fd180f711f`, synthetic `9c3081edfc97ebba2ef3aa46948c20312feed1df`. It recomputed every selected52-file hash and all51 typed code commitments, examined installed enforcement and the opaque native77-input commitment. Report SHA256 `b05d5a5e10f4a4e795092d45291100c0d8b5f12e2bfa2e65f08885538b6fa409`; packet `0a7e75786e02866777ee21aad5ce9835b0209f3fb35b31c3ccfc650b9f0e9567`; descriptor `e1a1c593b6f2f868dd71d2ceed89dc427376fdc86c70c3da0f6130e10ce21abe`; actual reviewed manifest `c182f9017f010c2e75341fff2f9ca047fa05446b85667b9af4c538265ba39d0b`; binder proof `eb8179d9f916da3c10cad8ea945ffe59385f6807186c8cbc07f23026a9a3a642`. The first genuine v19 attempt encountered a provider connection reset and was retained failed; the fresh invocation supplied genuine completion, never a backfilled verdict. Native protected private-evidence classification, ordinary-report refusal, initial-forward/original-restoration PASS, all six credential/production-target/schema mutation refusals and repeated initial admission are verified under real installede4 enforcement. Exact prepared child is active with the installation mutex held through final restoration. Credential issuance, callbacks and production remain excluded.

The review disclosed a stale managed-verifier pin in the separate independent-recovery main entrypoint. That entrypoint is not invoked by this timing profile; its inert custody/manifest-comparison helpers retain their exact frozen bytes. Approval expressly excludes re-running the separate main entrypoint until it receives a separately repaired/reviewed commitment. Same-UID custody, trusted host-buffer swap, abrupt host-loss recovery and physical PITR residuals remain explicit; none is claimed solved by timing approval.

**Additional supported cloud capability — October 11, 2026, 7:30 PM EDT:** Fresh credential-free Cloud SQL metadata proves the matched source already has private IP and private networking, with zero read replicas. Current [official read-replica creation documentation](https://docs.cloud.google.com/sql/docs/postgres/replication/create-replica) supports explicit `ipv4Enabled:false` at insertion, but requires the replica to share the primary VPC. [Replication documentation](https://docs.cloud.google.com/sql/docs/postgres/replication) confirms source passwords propagate. This is a different supported capability from the forbidden public clone-then-patch dead end; it is not proof of effective pre-startup isolation, IAM scope, an existing-source PITR backup-lineage restore, recovery equality, bounded cost/TTL or reviewed cleanup. No replica/network/firewall/policy/IAM/cloud mutation occurred. Actual physical PITR remains unproved; no credential or production gate is relaxed.

**Actual v17 refusal and next correction — October 11, 2026, 7:19 PM EDT:** Genuine selected-code approval at source ec085 used the unique unpunctuated exact scope line; original lifecycle completed/nonstale at 7:05:37 PM EDT. Report SHA256 `e9c6c7362a4483506884a54d7056c5c82ef069852c6515eaf0fcfbbd65393b7d`, packet `731a40b2b34e12eb4a4154a0c4f65827cd99ce633fe73347b5f250629b0de098`, descriptor `8815a1ead922a4aa2a9cb8d766ef299540d67bc9d8ef50dd1f9a602b2763a031`, reviewed manifest `084ff65b49e3bf771fc5a93cd541bf92e1f68e326dbe7713bbdd1811f982d7fd`. Both native action stages passed; ordinary-report approval and all six target/schema/credential mutations refused. The exact attempt passed seed verification but failed `nondeferrable_self_foreign_key_refused` before any forward round. Mandatory original restoration verified all103 tables,1,007,245 rows/catalog,original archive absence and deletion of temporary transports in80.7491228490253 seconds. Result SHA256 `c3eb577b82de70cde9facc7c3d1c876056e0c41d10432194a4625bcc55b5b6da`; restoration SHA256 `87d85be22caa4259b798d348010cbc498da8bcdeed3f621b36fa5bb5f6d0951f`. No copy, post-write recovery or production acceptance is claimed.

Frozen schema analysis found114 nondeferrable edges, including5 self edges, no AuditLog self edge and no cross-table cycle. Actual network-isolated PG17 single binary COPY accepted reversed row order and a mutual self row cycle while all foreign keys remained NOT DEFERRABLE/validated. Missing references failed23503, left zero inserted rows and preserved valid rows. The correction removes the erroneous self-edge blanket refusal; it retains parent-table ordering, cross-table cycle refusal, one binary COPY per table, all foreign-key enforcement, row/count checksums and canonical seed rendering. New private source8af updates the exact held loader hash and typed51-code commitment;177 rehearsal+82 recovery+37 credential checks pass. All77 v19 input hashes are verified, five typed future-output map entries are true and absent, pending manifest SHA256 `9adabae74f9ffb9ddd0aad79afbe82a7991a050dc0f2f1e7f5c9f456f06b38bf`. The initial v18 preparation accidentally used a list instead of the required future-output map; native admission refused before provider dispatch or database execution, and that failed preparation remains immutable. Fresh v19 review is active; old approvals do not authorize8af.

**Actual v16 refusal and next correction — October 11, 2026, 7:00 PM EDT:** The exact approved action completed with zero forward rounds and `lookup_seed_checksum_refused`; no copy, post-write recovery, crash/PITR, fencing, credential or application acceptance was proved. Full mandatory original restoration verified all 103 tables, 1,007,245 rows and catalog, original archive absence, and deletion of temporary credential transports in 79.52010462497128 seconds. Preserved result SHA256 `386279b3be59f0b43a6901017a3cb070a450d453022d1edb6e6766b8869881ba`; restoration SHA256 `f8be9e2f9678a5adcd589ac9da060466af0a82a6184750cabb3892aec953de35`; original encrypted dump remains `4abf393d825d45f544e3bd03a22cca804f65c0f0aa47f921e405b44da870b0cf`.

The first format hypothesis was disproved by a real PG17 fixture: frozen seed checksum `a458c54a3d8e043cd3afc98fd64c6cd89c5ec70eb80590b67279f791b5b9a091` is correct for positional text under canonical UTC. Read-only inspection proved the isolated target defaults to America/New_York, ISO/MDY, float precision 0 and en_US locales. A network-isolated fixture over the immutable four-row seed reproduced New York checksum `bc8ae47f07f74b4f989aa2ea77354cbb5172ea78668c07cf556e43197facb291`, UTC matched the unchanged commitment, and changed data differed. No checksum expectation, row-data protection or check was weakened. New clean source `ec08530b44609ac1946d9b7f4b49f6056d658aba` applies the existing canonical session helper before the seed; 176 rehearsal, 82 recovery and 37 credential checks pass. The regression fails on preserved7fe and passes on the correction; a backend refusing UTC stops before inserting any seed row. Frozen pending v17 manifest SHA256 `87dc6c26fd71bafe93059ff8e64f49bfdd86e7a44a3646e952cbf09391010064`; 77 hashes verified and five new output leaves absent. Task declaration uses actual successor base7fe; the full selected-code review remains against a80 to inspect the complete implementation. Fresh review is active, and no new execution authority is claimed until it passes.

**Fresh isolated recovery approval and execution — October 11, 2026, 6:39 PM EDT:** Genuine selected-code DeepSeek final-check completed APPROVE for synthetic `eaa9f537bb71611d21ba3d6f21059f3b08ae9248`, mapped to clean original source `7fe739cef75c24a332bde2a7d6a18f5180be5772`. It reviewed all 52 selected paths, all 51 typed code commitments, installed public enforcement and the native non-authorizing projection. Exact action descriptor SHA256 `6dfe813c93cb82e3605ca06022728b1e3b7efb394afb32379e1686dcb45ccb88`; reviewed manifest SHA256 `c1f39cc3d05f68590c120aed42bcaf5b8f3c9ff5bee37644618802ee842ebf91`; genuine binder proof SHA256 `88f49d8355f9bd62380e29354b9214d9a17ad4fb3674dc77450b9a9313c330cf`. Approval is conditional on genuine completion, exact installed profile and both native action stages; it does not claim remote inspection of private values, production, credential issuance or application acceptance. The provider used a punctuated exact scope line; offline byte-preservation coverage also proves the unpunctuated case, without backfilling either old failed review. Root independently verified actual private-evidence classification, ordinary-report refusal, initial-forward and original-restoration PASS, all six credential/production-target/schema mutation refusals, and repeated initial admission. The exact prepared v16 child is active under the existing installation mutex held through mandatory original restoration. No result is claimed until that child and restoration complete.

**Supported Linux installed proof — October 11, 2026, 6:31 PM EDT:** Full `update.sh` installation of the separately approved pinned merged `e4bfa05aa47963c27ced1272ac4c27323a11849a` completed with exit 0; temporary protected sudo transport was removed before the installer child. All 30 required stages passed. Clean canonical source and all 94 launchers, 3 managed configurations and 82 skill markers match their receipt. Receipt SHA256 `76391adb19bf9fd9b47548978b7257f8b150b9dc75a46c154c34c4d9101d9706`; stage TSV SHA256 `f711d4246f1c3c1f2745cbe6c503ebf60822329190a96da3531d93d790cd2097`. Genuine native enforcement reports VERIFIED_INSTALLED_SOURCE; the updated scope parser SHA256 is `9eb4fd4668ffbfcccd2d82488234f7c1c7b1d3cc42863bd57e27914928624f55`. One-use authorization and stage marker are absent and completed target is exact. Native state root is 0700, receipt 0600, all 1,255 inspected entries owned and no links; existing weaker leaf modes remain protected by the private parent, so this is not a claim that every historical leaf is 0600. DeepSeek installed admission is usable with quota UNKNOWN retained. Fresh selected-code v16 review is active; no new recovery action or production acceptance is claimed.

**Merged-release installation approval — October 11, 2026, 6:28:54 PM EDT:** Separate Muse final-check completed APPROVE/nonstale for `e4bfa05aa47963c27ced1272ac4c27323a11849a`, base actual installed `b6411266ac18921bec5ddb3321f740103d59dc98`, implementer/caller Codex. Report SHA256 `577c94dc63f9b2fa5cd6eca298714c4de6b7f09f920d2bef2ff9bbfff69d4469`; packet SHA256 `f5ead93e382f80da7c08e80c56b2e7200062ed6be98a8afd770084431c7914d7`. Muse inspected all intervening merged code, independently passed 38 action-profile, 114 Qwen and Gemini checks, and classified one unchanged sealed-suite failure as the reviewer sandbox's read-only event store. Root's 17 sealed checks and required CI remain passing. The earlier drifted verdict and StepFun credit failure are not authority. Fresh supported authorization passed for this pinned merged target and full installation is in progress; later merges do not change that pin or authorize their bytes.

**Latest repair checkpoint — October 11, 2026, 5:07 PM EDT:** Private source `e94f65d79ca8964e4b7d30a3519f8d6192779617` preserves the grant fix and binds its new immutable grant snapshot into the typed contract; all 77 action inputs and five absent v15 output leaves are verified. All 173 rehearsal, 82 recovery and 37 credential checks pass. Clean 6534, cd91 and original7bdd worktrees/commits remain preserved.

The two new native reviews at original6534 genuinely returned APPROVE with the exact profile/descriptor but omitted only the scope sentence's final period. Their source lifecycles correctly remained failed under the installed strict literal comparison; neither report is execution authority and neither will be backfilled. Incident `20261011T205951Z-edge-dev3-deepseek-4068819` tracks that false refusal. Public [PR #1583](https://github.com/popcre/ai-devops/pull/1583), source `e7b3c048c07f0b981a24ee810d044ebf759a0289`, accepts only a unique unindented exact profile/full-descriptor line with zero or one terminal period and strengthens conflicting/duplicate refusal. Actual 38 native/profile tests and 17 sealed code-only checks pass, including unchanged provider bytes and prospective completion without a period. Required CI is active. Muse's native preflight reports a temporary provider-unavailable quarantine; it is preserved, not cleared or retried. A qualified independent StepFun final review is active. Normal merge, separate merged-target review/full supported installation and a new genuine private v15 approval remain required before another action. No additional recovery, credential or production operation occurred.

**Linux and recovery checkpoint — October 11, 2026, 4:49 PM EDT:** [PR #1578](https://github.com/popcre/ai-devops/pull/1578) source `8ae95d25ef202f58c4dfad744f9cec0a0ae0f73f` received independent Muse APPROVE, 35 native profile and 363 task-gate tests, normal required CI and merge-group checks, then merged as `b6411266ac18921bec5ddb3321f740103d59dc98`. The separate merged-target installation review compared with the actual previously installed `4eb599475d78f36eedab3975529a09f4f5cfd320`; Muse APPROVE at 4:10:35 PM EDT, report SHA256 `428919b3e25c57bc87495d39ae4a53f7339cf74728dd8b6d5ab33ae616d804e1`, packet `fa913d114ad14efc7564144429f643aad160ecb2444325c869cd5e3c98d4a98a`. Supported full installation completed at 4:13:38 PM EDT: all 30 stages PASS, 94 launcher hashes and all 179 catalogued artifacts match, receipt SHA256 `5da8c9d3d3bcf28a40deb38fc9dcdedf78561bf04ac19423bca56b18c25c350b`. Current receipt/private recovery state are 0600 under a 0700 state parent; the four public enforcement files are 0644/0755. Native evidence is `VERIFIED_INSTALLED_SOURCE`; no test/profile override is present. One-use installation authorization is consumed and the completion binds b641. DeepSeek is installed-healthy/usable; credit remains UNKNOWN rather than invented availability. Prior Linux no-new-privileges and native protected-admission blockers are resolved through supported delivery, not bypassed.

Fresh full-code private invocation `20261011-162011-1574808` genuinely completed APPROVE at 4:25:17 PM EDT: original cd91, synthetic `7038c5d6321724e5c194775e02ec1e5975567596`, packet `2265f56493b20c85fdbc5be0105c949ee29142404d0c901cd7dd88c8a7456c94`. The real prospective original lifecycle completed; binder-v13 changed only eight review fields, never provider/lifecycle records. Reviewed manifest SHA256 `cd12006a71dd2807ea7b33c478f46f7270bb76f5f0b7e303c863cf49177e9b1d`. Root held the existing installation lock through the exact action and mandatory original restoration. Actual initial-forward and original-restoration native checks passed; ordinary approval and all six target/schema/credential mutations refused. The protected class and synthetic-only boundary remained effective. Reviewer incident `20261008T215237Z-edge-dev3-deepseek-2377863` is resolved with installed/live evidence; toolkit #1531 is closed. The separate older uncontrolled public-review incident is preserved and is not claimed fixed by this private-route proof.

The actual v13 isolated attempt failed with `InvalidGrantOperation` / `0LP01`, completing **zero forward rounds**. Mandatory original restoration succeeded: all 103 original tables, 1,007,245 rows, full before-manifest/catalog and original archive absence verified; transient credential transport deleted. Restoration took **81.68526290499722 seconds**. `timing-result-v8.json`, `final-original-restoration-action-v12.json`, v13 native proof, decision and encrypted log remain immutable. This is original restoration proof, not successful source-copy, postwrite recovery, crash/PITR, source fencing, credential issuance or application acceptance. No production mutation occurred.

Root reproduced the circular administrator regrant failure in an isolated local PG17 synthetic fixture. Private repair 6534 asserts the exact automatic creator membership (ADMIN true, INHERIT false, SET false), refusing missing or changed privileges instead of regranting ADMIN; all final privilege closure checks remain. Actual local PG17 preservation and missing-membership refusal pass, plus 173 rehearsal and 82 recovery tests. New pending-v14 contains 77 frozen inputs and five absent output leaves, reserves new result/restoration names and retains all predecessor artifacts; separate genuine full-code/action review is in progress. No historical approval authorizes this repair.

Tracking PR #111 is verified merged on October 8, 2026, 11:48:56 AM EDT (`92c9f91a087636f7387976e2f6b064d6f17fd13e`); older Uma-wait entries are superseded. Uma still owns DesignFlow integration. Root owns supported permanent-credential privacy, physically isolated pre-startup PITR, exact reviewed writer fencing, one scheduled move and all four new-identity/production business acceptance. Provider capability constraints and handoff dead ends remain binding; no logging reduction, unsafe password probe, cloud clone, IAM/policy change or production write occurred.

**Current checkpoint:** October 11, 2026, 11:00 AM EDT. Albert explicitly superseded b904 with “Use the latest merged ai-devops head instead of b904689. Get the required fresh review, complete the Windows install and privacy proof, then finish #770 recovery and production acceptance. Don’t retry the handoff’s dead ends.” Selected latest merged release `6a7fd7340969c075687600b1988ef7b542efc90b` is installed and independently proven. Report SHA256 `372f9c493635245d7b671287c9bb9147dd05b5700c5256e0488adb6e3aafe871`; packet SHA256 `5f48fff19f44e375d57f82382bbd523033a3f0a627706147a21e1eda635d3d15`; source digest `9419ecc43027682bc45b3caea08f11b73a3b0c9984a8b0b790eb5ae6614d9138`. Native installation proof: `C:/Users/ahazan/AppData/Local/Temp/tmp.1xeo9Icyrz/installed-proof.json`. Managed gate source SHA256 `492cc32fc8725de92ebb153fb57a350ae9b925bacaa8d795d15d193587d27991`.

An independently moving canonical checkout advanced from the first reviewed/installed bb3700 release to merged 6a7 (documentation only). Root preserved that forward movement, obtained the second matching review and repeated the full supported authorization/install, then verified exact target receipts. Actor identity remains unverified; no backward reset or copied receipt was used.

Native owner-only ACL proof is distinct from the unchanged failing Unix `stat` assertion. The latter remains an open test portability matter in existing PR #1382; no test was suppressed and no foreign branch adopted. Installer automatic Gemini qualification still fails on authentication timeout and keeps it quarantined; exact retained issue `20261011T145844Z-edge-dev-gemini-1914780`. Muse and DeepSeek remain usable. This separate failure is not Windows privacy proof or #770 acceptance.

All original 77 protected recovery inputs and 9,571 runtime entries were freshly hash-verified; new exclusively created pending-v12/invocation-v12 retain the admitted canonical 77 runtime inputs/52 implementation paths at new source cd91. Independently reviewed policy/test files are source-admission controls, not added to the closed runtime profile. The intermediate v11 expansion (79/54) was correctly refused before provider dispatch and is retained, leaving pending-v10 and its bindings unchanged; all five future outputs are absent, original recovery HEAD `7bdd0d61ae913e5505c8fa3eeef58ac8fc4059a2` is clean, and authority remains false. No recovery, credential issuance or production write occurred. Production still requires supported credential-error redaction, physically isolated PITR, writer fencing and four-service live acceptance; no handoff dead end was retried.

**Recovery continuation — October 11, 2026, 11:31 AM EDT:** Native session `20261011-110804-1205055` reached genuine complete/BLOCKED at synthetic `fd4e56d9f575f6caee11a154af0a95eb6cd51108`, mapped to local cd91. Reviewer found no code defect in inspected recovery guards but correctly withheld approval because public installed action-profile enforcement was absent from its packet. [ai-devops PR #1569](https://github.com/popcre/ai-devops/pull/1569) supplies four genuine fixed public enforcement sources via existing ordinary attachments, preserving the canonical packet and withholding all private operational inputs. Final source head `190f90d15298abac28faf95ae431004a6abe024e` has fresh Muse APPROVE/nonstale (October 11, 2026, 11:38:51 AM EDT; report `34ff9468173f647864048d1fc649323a910ddd1c7279993a58eeb5b0691f18fd`, packet `a394a3ee524746613e9876356b839f724b3ee0d1019d5a77eac15b842f35ed44`), 19/19 native action-profile tests and 17/17 sealed-review tests; required CI/normal queue are active. This source approval does not authorize recovery. No review field, completion record or action authority was fabricated.

The Linux canonical checkout is clean at d7ae3261, while its installation manifest still names 30281c12. Separate own review/install worktrees are prepared, preserving actual installation start head d7. The supported stale-linux-manifest-recovery route needs an exact merged-target review binding both stale manifest and live-source evidence. Administrator capability is unavailable: the actual sudo check refuses because this process has no-new-privileges. Required system paths are root-owned and the supported installer requires privileged stages. No installation authority was issued, no canonical update/manifest rewrite performed, and no alternate tool or host used to bypass that boundary. Root owns this platform blocker on existing [ai-devops #1531](https://github.com/popcre/ai-devops/issues/1531#issuecomment-6110600910).

Fresh guarded read-only production proof confirms verified TLS/read-only transaction, four runtime roles and four NULL passwords. `log_error_verbosity=default`, native SET privilege false, supautils allowlist excludes that control. No setter/credential issuance ran. Current [Supabase configuration documentation](https://supabase.com/docs/guides/database/custom-postgres-config) still omits it; supported fatal/error redaction and actual DUMMY proof remain necessary. Fresh matched Cloud SQL source: PG17/ENTERPRISE, public IP enabled, eight authorized networks, seven-day PITR. Current v1/v1beta4 CloneContext discovery supports destinationNetwork/destinationProject but no ipv4Enabled/authorizedNetworks overrides; destinationNetwork describes private services access, not public-IP removal. [Current clone documentation](https://docs.cloud.google.com/sql/docs/postgres/clone-instance) says connectivity and passwords are copied. Physically isolated pre-startup PITR is unproved. No clone, IAM/policy, source fencing, credential, recovery or production mutation ran.

**Release distinction:** The source repair introduces new bytes in PR #1559; those bytes are not in the historical `b904689` release. Do not patch the clean installation candidate locally or treat the old review as approval of the new repair. The new repair has its own independent exact-head review. The original installation review remains preserved for its original target only.

**Source review passed:** Muse completed an independent final-check APPROVE/nonstale at repair head `7658048db5ee9c2123a2a5e03983bd94b722fd73`, implementer/caller `codex`, comparison base `d7ae3261214d33a62ec7024dc3e5f4da7ed88df1`, on October 11, 2026, 9:27:27 AM EDT. [Durable review checkpoint](https://github.com/popcre/ai-devops/pull/1559#issuecomment-6109525040). Report SHA256 `275279880f2757cee8bc063f4ffb4d3cb2c694c94bf628299b2adfe18bb5d5ec`; sealed packet SHA256 `659d8c09c17fcbb851838680d9ef3b9290ba773dd1ae5eb9dec4049caa39e25a`. Required CI, the single normal failed-job retest, merge-group checks and normal merge have now passed. This is not installation or production authority.

**Validation update — October 11, 2026:** Native Windows task-gate suite completed with 339 passing checks and one failing existing assertion, `the explain cache directory is private`. That unchanged Unix-mode assertion and native Windows state protection are already covered by the separate open [ai-devops PR #1382](https://github.com/popcre/ai-devops/pull/1382); its body records the native ACL repair. Do not suppress that test. This historical mode assertion does not establish native privacy; the later owner-only native ACL proof above establishes installed privacy separately. The reviewer lifecycle suite subsequently passed all 81 checks in the same dedicated Windows source worktree, with the runner collision check clear. Native ProgramFiles/root-path and missing-`flock` concurrent exclusion/signal cleanup/reuse canaries also pass. At that historical checkpoint no authority existed and no installed head had changed; the later forward installation above supersedes this observation.

Actual Linux CI at the approved repair head reports task gates **340 passed, 0 failed**. A separate unchanged `test-ai-pr-wait.sh` pagination-accounting assertion failed once (89/1). Its waiter, test and measurement reporter are byte-unchanged from the source comparison base; the affected fixture explicitly disables task gates. After local runner collision clearance, the isolated exact-current-source waiter suite passed **90/0**, including that same assertion. After the original run completed, one normal failed-job re-run was accepted at 9:58 AM EDT and completed successfully; the merge-group run also passed, with every required check retained. This is a diagnostic/retest, not a claim that the unrelated accounting defect was repaired.

The first source review correctly rejected a Linux-fragile test stub (the closing `]` argument was missing from the stub's match); CI confirmed 339 passing checks and that one failure. The consolidated correction exposed a second fixture defect: a Bash-only last-argument expansion in a generated `#!/bin/sh` script. Both generated fixtures now use a POSIX argument loop, directly verified under real `sh`, including the `--` separator. The fresh repair-head review above approves the correction; neither earlier rejection authorizes merge. Both earlier reviews found no defect in the changed installer/gate functions. These fixture findings do not change the retained installation review's target or authority.

**Linked handoff:** `HANDOFF.d/2026-10-09T2200Z-edge-dev-mimo-windows-install-gates.md`

---

## Part 1 — Why

### 1. The ultimate goal

Historical problem: the original b904689 release could not be installed on edge-dev because Windows-specific gates refused. Albert superseded that target with the latest merged release. The reviewed 6a7 release is now installed and proven as recorded above. The remaining phase instructions are retained history, not a request to repeat installation or downgrade to b904. New source repairs require their own merged-target review, authorization and installation. #770 recovery and production acceptance are separately open.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

### 2. What this application is

`popcre/ai-devops` is the AI DevOps toolkit: reviewer wrappers (`ai-review`), task gates (`ai-task-gates`), lifecycle tracking, sandbox management, and installers. It is installed locally on each machine (no cloud deployment). The canonical checkout is `C:\repos\ai-devops`. Managed launchers live at `%USERPROFILE%\.local\bin\`. The repo's `main` branch is the release branch; merge queue enforces checks.

### 3. What triggered this work

Session `ses_ffe5ee11d71a2ffe5UuMOc8kR7` on edge-dev merged PR #1533 (fixture repair for the code-only test) and attempted to install the merged toolkit. The installation hit seven distinct Windows gate failures in sequence. The handoff at `HANDOFF.d/2026-10-09T0400Z-edge-dev3-codex-770-recovery-continuation.md` assumed installation on edge-dev3 (Linux). This machine (edge-dev, Windows 11, Git Bash MINGW64) has never had a clean supported install of this release.

### 4. Scope

**In scope:**
- Patch `update.sh` and `ai-task-gates` for Windows path and lock compatibility.
- Run the two-task install process (review task + installation task) on edge-dev.
- Run `install-ai-devops-windows.ps1` with one-use authorization.
- Verify installed hashes and routing.

**NOT in this plan:**
- Fixing the ENVY CI runner (Smart App Control / Worker 2.337.0). Separate limitation, preserved not bypassed.
- The shared-db #770 production cutover, rehearsal, or credential issuance. Those are downstream of installation.
- The private custody archive transfer from edge-dev3. Separate dependency.
- Any change to the merge queue, branch protection, or CI workflow configuration.

---

## Part 2 — What we already know

### 5. Current state of the code

- **Historical merged target (superseded; do not install):** `b9046892660d7eccd3efc0e4af84cf85849923a6` on `popcre/ai-devops` `main`. PR #1533 merged 2026-10-09T15:52:39Z. CI green except ENVY Windows section 2 (known limitation).
- **Installed checkout — UPDATED October 11, 2026:** Clean `C:/repos/ai-devops` at reviewed merged `6a7fd7340969c075687600b1988ef7b542efc90b`. Historical 63e83, b904 and 698 observations are not current installation targets.
- **Managed launchers:** all 72 bash/cmd receipts match 6a7 and actual source hashes; both task-gate launchers route successfully, and native privacy is proved above.
- **Own linked worktrees:** native temporary root `C:/Users/ahazan/AppData/Local/Temp/tmp.1xeo9Icyrz`, REVIEW and INSTALL at 6a7. Installation task preserves start head 698; original `C:/tmp/ai-devops-install` and prior review evidence remain untouched.
- **`update.sh`** is at repo root. `install-ai-devops-windows.ps1` is at `bin/`. `authorize-install` is a subcommand of `ai-task-gates`.

### 6. Key findings and root cause

| # | Error | Root cause | Evidence |
|---|-------|-----------|----------|
| 1 | `flock: command not found` | Git Bash lacks `flock` (util-linux). `update.sh:67` calls `flock -n 9`. | `update.sh:67` |
| 2 | `candidate or installed path is not a Git worktree root` | `pwd` returns `/c/tmp/...`; `git rev-parse --show-toplevel` returns `C:/tmp/...`. String comparison at `update.sh:44` fails. | `update.sh:44` |
| 3 | `Launcher is not canonical managed path` | `$HOME` is `/c/Users/ahazan` (MSYS). The canonical path is `$HOME/.local/bin/ai-task-gates`. Passing `C:/Users/...` fails the `=` comparison. | `ai-task-gates:1834-1835` |
| 4 | `Installed Windows launcher routing differs` | `PROGRAMFILES` env var is unset in Git Bash. `windows_launcher_route` builds `expected_programfiles` from `${PROGRAMFILES}\Git\bin\bash.exe`. Unset → mismatch. | `ai-task-gates:910-916` |
| 5 | `This install verification route is Linux-only` | Hard-coded `uname -s` check. `[ "$(uname -s)" = Linux ] || blocked ...` | `ai-task-gates:1495` |
| 6 | `Empty release needs an installed receipt` | `start_head == target_head` when the installation task was declared at the target commit instead of the pre-update head. | `ai-task-gates:1780-1782` |
| 7 | `Protected review and installation must use separate tasks` | The same Muse review was reused for both the PR diff-review and the install deploy authorization. `reviewer_approval_summary` for action `deploy` requires `review_mode` to be `final-check` or `security-review`, and the task declaration must be `installation` (separate from the review task). | `ai-task-gates:1835`, `review-operation.sh:449` |

### 7. Approaches considered and REJECTED

- **Faking `flock` with a stub that always succeeds.** Rejected as a permanent fix: it silently disables mutual exclusion. Never use this as an installation workaround; the real lock repair has landed and is installed.
- **Patching `update.sh` in the candidate worktree and committing it.** Rejected: the candidate HEAD must exactly match the reviewed commit (`b904689`). A local commit changes the HEAD and the gate refuses.
- **Bare `git pull` on the installed checkout.** Rejected by handoff rule: "Never bare-pull installed canonical checkout or copy launcher files manually."
- **Using `ai-review-preflight passed-head` to skip review.** Not applicable: that path is for reusing an existing pass, not for authorizing a deploy.
- **Running the Linux `update.sh` install verification route.** It is hard-coded Linux-only (`ai-task-gates:1495`). The Windows route is `install-ai-devops-windows.ps1`.
- **Reusing the Muse diff-review as the deploy approval.** Rejected by `reviewer_approval_summary`: action `deploy` requires `review_mode` of `final-check` or `security-review`, not `diff-review`.

### 8. Design decisions already made

- **LOCKED:** The installation must go through `ai-task-gates authorize-install` with a one-use authorization consumed by the installer. No bare pulls, no manual launcher copies.
- **LOCKED:** The review that authorizes the deploy must be a separate `final-check` review with `--implementer mimo` (different from provider `muse`), bound to the exact target head.
- **LOCKED:** The installation task must be declared with `start --class installation` at the **pre-update** installed head (`63e83b07`), then the candidate advances to the target (`b904689`).
- **LOCKED:** The ENVY CI runner limitation is preserved, not bypassed.
- **SOURCE DECISION October 11, 2026:** Permanent source repair is authored upstream in ai-devops PR #1559, separately reviewed and tested. The original clean installation candidate and installed checkout are untouched.
- **SOURCE DECISION October 11, 2026:** Detect ProgramFiles in the script from either existing variable, then the actual existing Git installation. No profile mutation or routing bypass.

---

## Part 3 — How to build it

### Phase 1 — Patch the Windows incompatibilities (30 min)

Context cut point. Re-read this STATUS table before Phase 2.

#### P1 — Patch `update.sh` path normalization

**Target:** `update.sh` lines 42-55 (the worktree-root comparison block).

**Change:** Replace the string comparison of `source_top`/`installed_top` with `SOURCE_ROOT`/`REPO_ROOT` to use `cygpath -m` normalization with `realpath` fallback. On Windows Git Bash, `cygpath -m` converts both MSYS and Windows paths to `C:/...` form. On Linux, `cygpath` is absent and `realpath` is the correct tool.

```bash
# Before (line 44):
[ "$source_top" = "$SOURCE_ROOT" ] && [ "$installed_top" = "$REPO_ROOT" ] || {

# After:
[ "$(cygpath -m "$source_top" 2>/dev/null || realpath "$source_top")" = "$(cygpath -m "$SOURCE_ROOT" 2>/dev/null || realpath "$SOURCE_ROOT")" ] && [ "$(cygpath -m "$installed_top" 2>/dev/null || realpath "$installed_top")" = "$(cygpath -m "$REPO_ROOT" 2>/dev/null || realpath "$REPO_ROOT")" ] || {
```

**Verification gate:** `bash -n update.sh` passes. Running `update.sh --installed-checkout /c/repos/ai-devops --expected-head b9046892660d7eccd3efc0e4af84cf85849923a6` from a clean candidate worktree no longer prints `candidate or installed path is not a Git worktree root`.

#### P2 — Patch lock fallback for missing `flock`

**Target:** `update.sh` line 67. Also check `ai-task-gates` for any `flock` usage.

**Change:** Before the `flock -n 9` call, test whether `flock` exists. If not, use a fallback: create a lock directory with `mkdir` (atomic on all platforms) and store the PID. On exit, remove it. The fallback must still refuse concurrent installs.

```bash
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { warn 'another installation is active for this checkout'; exit 1; }
else
  # Git Bash on Windows lacks flock. Use mkdir-based lock.
  lockdir="${install_lock_file}.d"
  mkdir "$lockdir" 2>/dev/null || { warn 'another installation is active for this checkout'; exit 1; }
  trap 'rmdir "$lockdir" 2>/dev/null' EXIT INT TERM
fi
```

**Verification gate:** Running `update.sh` on Git Bash proceeds past the lock step. Two concurrent runs: the second prints `another installation is active`.

#### P3 — Patch `ai-task-gates` launcher path and `PROGRAMFILES` detection

**Target:** `ai-task-gates` lines 1834-1835 (canonical launcher check) and lines 910-916 (inside `windows_launcher_route`).

**Change A (launcher path):** Normalize both sides of the comparison at line 1835 with `cygpath -m`:

```bash
[ "$(cygpath -m "$installed_launcher" 2>/dev/null || echo "$installed_launcher")" = "$(cygpath -m "$canonical_launcher" 2>/dev/null || echo "$canonical_launcher")" ] || blocked 'ai-task-gates: STOP. Launcher is not canonical managed path.'
```

**Change B (`PROGRAMFILES`):** At the top of `windows_launcher_route`, detect `PROGRAMFILES` from the registry or filesystem if unset:

```bash
if [ -z "${PROGRAMFILES:-${ProgramFiles:-}}" ]; then
  if [ -d "/c/Program Files/Git" ]; then
    PROGRAMFILES="C:\\Program Files"
  fi
fi
program_files="${PROGRAMFILES:-${ProgramFiles:-}}"
```

**Verification gate:** `ai-task-gates authorize-install` with MSYS-style launcher path passes the canonical-path check and the launcher-routing check (no more `Installed Windows launcher routing differs`).

---

### Phase 2 — Two-task review and authorization (45 min)

Context cut point. Re-read Phase 1 verification results before starting.

#### P4 — Split review vs. install into separate tasks

**Target:** The `ai-task-gates` task declaration state under `%USERPROFILE%\.local\state\ai-devops\task-gates\`.

**What to do:** The review that approved PR #1533 was a `diff-review` under a `reviewer-safety` or `code-only-review` task. The installation needs its own `installation`-class task with `start_head=63e83b07` (the pre-update head). The existing candidate worktree at `C:\tmp\ai-devops-install` already has this state (verified: `status` shows `declared_class: installation`, `start_head: 63e83b07`, `base: b904689`). Do not create a second installation task — use this one.

**Verification gate:** `ai-task-gates status` from `C:\tmp\ai-devops-install` shows `declared_class: installation` and `start_head` equal to the full SHA `63e83b0772b5b8e7a071264829b163dd863c39f6`.

#### P5 — Run second `final-check` review for deploy action

**Target:** Run `ai-review muse final-check --implementer mimo --base 1861259dfa243ebe25f1b984b43d1f2a44bcd8c4 --assert-head b9046892660d7eccd3efc0e4af84cf85849923a6` from the candidate worktree `C:\tmp\ai-devops-install`.

**Critical:** The `--base` must be the merge-base (`1861259dfa243ebe25f1b984b43d1f2a44bcd8c4`), NOT `origin/main` (which is ahead). Using `origin/main` makes reviewers find false issues in files not in the PR diff. This cost 2 hours in the prior session.

**Also critical:** The review must complete with `review_mode: final-check` (not `diff-review`). The `reviewer_approval_summary` function at `ai-task-gates:450` requires `final-check` or `security-review` for the `deploy` action.

**Note:** A `final-check` review was already run at `C:\tmp\ai-devops-install\.ai\reviews\muse-final-check-20261009T175147-1827819-20806.md`. If that lifecycle record is still present and non-stale, it can be reused. Check first:

```bash
ls ~/.local/state/ai-devops/review-lifecycle/runs/4f09a1a507678570aa6c6b414021875a79038ab90865c9c97920623777170f00/muse/zcode/
```

If a completed APPROVE final-check at head `b9046892660d7eccd3efc0e4af84cf85849923a6` exists, reuse its report path. Otherwise run a fresh one.

**Verification gate:** The lifecycle state JSON has `"status":"completed"`, `"verdict":"APPROVE"`, `"stale":false`, `"review_mode":"final-check"`, `"head":"b9046892660d7eccd3efc0e4af84cf85849923a6"`, and `provider` != `implementer_engine`.

#### P6 — Run `authorize-install` with correct bindings

**Target:** From `C:\tmp\ai-devops-install`:

```bash
export PROGRAMFILES="C:\Program Files"
/c/repos/ai-devops/bin/ai-task-gates authorize-install \
  --target-head b9046892660d7eccd3efc0e4af84cf85849923a6 \
  --installed-checkout /c/repos/ai-devops \
  --installed-launcher /c/Users/ahazan/.local/bin/ai-task-gates \
  --review-report <path-to-final-check-report> \
  --reviewer-approval <path-to-same-report>
```

**Critical:** Use MSYS-style paths (`/c/...`), not Windows-style (`C:/...`) for `--installed-checkout` and `--installed-launcher`. The canonical launcher comparison at `ai-task-gates:1834` uses `$HOME` which is `/c/Users/ahazan` in Git Bash.

**Critical:** `--installed-launcher` must be `/c/Users/ahazan/.local/bin/ai-task-gates` (the managed extensionless launcher), NOT `C:/repos/ai-devops/bin/ai-task-gates`.

**Verification gate:** The command prints an authorization receipt (a one-use token/path). No `STOP` message.

---

### Phase 3 — Install and verify (30 min)

#### P7 — Run the Windows installer

**Target:** From the candidate worktree `C:\tmp\ai-devops-install`:

```powershell
pwsh -NoProfile -File C:\tmp\ai-devops-install\bin\install-ai-devops-windows.ps1 -RepoPath C:\repos\ai-devops -ExpectedHead b9046892660d7eccd3efc0e4af84cf85849923a6
```

The installer consumes the one-use authorization from P6. It fast-forwards the installed checkout, refreshes managed launchers, and records the install manifest.

**Verification gate:** The installer exits 0. `git -C C:\repos\ai-devops rev-parse HEAD` returns `b9046892660d7eccd3efc0e4af84cf85849923a6`. The managed launchers at `%USERPROFILE%\.local\bin\ai-task-gates` have a fresh `source-sha` receipt matching the new HEAD.

#### P8 — Verify installed hashes and routing

**Commands:**

```bash
# Source receipt matches
sha256sum /c/repos/ai-devops/bin/ai-task-gates
grep source-sha /c/Users/ahazan/.local/bin/ai-task-gates

# Launchers work
/c/Users/ahazan/.local/bin/ai-task-gates --version 2>&1 | head -3

# Reviewer wrapper resolves
ai-review-preflight usable deepseek 2>&1 | head -5

# Task gates functional
cd /c/repos/ai-devops && ai-task-gates start --class reviewer-safety 2>&1
```

**Verification gate:** All four commands succeed. `ai-review-preflight usable deepseek` names the resolved wrapper (`wrapper_command: ai-deepseek-agent` or similar).

---

## Part 4 — Landing it

### 10. Tests required

- `bash -n update.sh` — syntax check after P1 and P2 patches.
- `bash -n bin/ai-task-gates` — syntax check after P3 patches.
- `tests/test-ai-task-gates.sh` — must stay green (run from `C:\repos\ai-devops` after install, or from the candidate before).
- `tests/test-ai-review-lifecycle.sh` — must stay green.
- No new test files are required for the path/lock fallbacks if the existing suites cover the code paths; add a focused test only if the existing suites do not exercise the Windows path format.

### 11. Constraints, standing rules, and gotchas

- **Branch policy:** `feature-branch-pr` for `popcre/ai-devops`. Never push to protected `main` directly. The patches in P1-P3 need their own PR if contributed upstream; a local-only fix does not.
- **No bare pulls** on the installed checkout. Always through `authorize-install` + installer.
- **Never copy launcher files manually.** The installer owns them.
- **Reviewer must differ from implementer.** Provider `muse`, implementer `mimo`. Never the same engine.
- **`--base` must be the merge-base** (`1861259d`), not `origin/main`. Using `origin/main` makes reviewers diff against the wrong range and find phantom issues.
- **MSYS paths in `authorize-install` calls.** `/c/Users/ahazan/.local/bin/ai-task-gates`, not `C:/Users/...`.
- **`PROGRAMFILES` must be set** in the shell running `authorize-install` if the script patch (P3-B) is not yet applied.
- **The installation task's `start_head` must be the pre-update head** (`63e83b07`), not the target. Declaring at the target triggers `Empty release needs an installed receipt`.
- **ENVY runner limitation is preserved.** Do not disable Smart App Control or downgrade Worker.

### 12. Access and environment

- **Machine:** edge-dev (Windows 11, Git Bash MINGW64_NT-10.0-26300).
- **Git identity:** `Albert Hazan <u2giants@users.noreply.github.com>` (verified via `git var GIT_COMMITTER_IDENT`).
- **Repos:** `C:\repos\ai-devops` (installed checkout), `C:\tmp\ai-devops-install` (candidate worktree).
- **1Password:** vault `vibe_coding`. No secrets needed for this installation — the reviewer wrappers use their own protected key stores.
- **Reviewer tooling:** `ai-review` at `%USERPROFILE%\.local\bin\ai-review`. Muse is registered and available. DeepSeek doctor passes (curl, Python, timeout 300s).
- **Environment variables needed:** `PROGRAMFILES="C:\Program Files"` (until P3-B lands).

### 13. Definition of done — current installed acceptance

- [x] P1-P3 source patches merged in PR #1559; syntax, Linux CI, native Windows path/lock canaries and separate exact-head review pass. Installed acceptance remains P6-P8.
- [ ] Existing test suites (`test-ai-task-gates.sh`, `test-ai-review-lifecycle.sh`) pass.
- [x] P4: separate own Windows review/install tasks preserve actual installed start `698554f6013a78e7be4c67ecf8afa9b2a4409708`.
- [x] P5: current selected-target Muse final-check APPROVE/nonstale at `6a7fd7340969c075687600b1988ef7b542efc90b`, implementer/caller Codex, actual installed comparison base698554f. Historical Mimo/b904/186 review is preserved only for its original target.
- [x] P6: exact MSYS-bound one-use authorize-install receipt was consumed by the supported full installer.
- [x] P7: Windows full installer exited0 at `6a7fd7340969c075687600b1988ef7b542efc90b`; no downgrade or copied launcher.
- [x] P8: all72 launcher receipts/hashes match; native owner-only ACL and installed usable reviewer/task-gate routing pass.
- [x] GitHub issue #1548 closed with live proof.
- [x] Plan STATUS table contains verified evidence for P1-P8.
- [x] Supported Linux installation at selected merged e4bfa05: all30 stages,179 artifact receipts, native private state and live review/admission acceptance verified; toolkit #1531 closed.
- [ ] Successful isolated copy/post-write recovery, production credential privacy, physical PITR, writer fencing, scheduled move and all four production service acceptance remain on existing #770/#160, owned by this session.

**Risks:**
- The Muse review system was flaky on this machine earlier (DeepSeek processes killed, Codex sandbox denied). If Muse also fails, try `ai-review stepfun final-check` or `ai-review glm final-check` — both are registered.
- The installer may hit additional Windows gates not yet discovered. Each new gate needs its root cause diagnosed before a workaround is applied; do not blanket-disable checks.

**Current technical blockers (owned by this session):**
- Windows and Linux supported installations are complete; historical downgrade/no-new-privileges blockers below are superseded, not steps to retry.
- The unchanged Unix-mode test assertion remains separately owned by existing PR #1382; native Windows owner-only ACL acceptance is independently proved. No test was suppressed.
- Production credential error privacy remains blocked: actual SET privilege and supautils capability are absent; the current supported Management API PostgreSQL configuration contract does not advertise `log_error_verbosity`. No unsupported PUT, fatal-password probe, logger suppression or SCRAM fallback was attempted.
- Pre-startup physically isolated PITR remains unproved; current clone APIs cannot override inherited public-IP/authorized-network exposure. No unsafe clone, IAM/policy mutation or source restart was attempted.
- v17 failed before copying and original restoration is verified. v19 forward rounds completed, export failed and full original restoration passed. Fresh genuine v20 approval and both native stages passed; its completed action matched both forward rounds/exported the snapshot, then failed local undo ingestion and restored the full original. The new undo failure is deferred under the requested wrap-up; changed code/output generation requires fresh exact review. Production and all four application acceptance remain dependent on independent gates.

---

## Self-audit

1. **Could a brand-new AI session with no project knowledge execute this plan without asking anything?** Yes. Sections 5-8 carry the full state, root causes, and rejected approaches. Section 9 names exact files, line numbers, commands, and verification gates. Section 12 defines the environment. The one gap found and filled: the `--base` merge-base trap (P5) and MSYS path requirement (P6) were added after the audit prompted for "every trap specific to THIS work."

2. **Does the plan carry every piece of background and nuance?** Yes. Section 7 records all seven failures and their root causes with `file:line` evidence. Section 7 lists every rejected approach. Section 8 labels locked vs. open decisions.

3. **Is the ultimate goal stated clearly enough for judgment calls?** Yes. Section 1 states the goal in business English and includes the "goal wins" instruction. If a patch would break Linux behavior, the implementer knows to stop and flag.
