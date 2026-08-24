---
issue: 1415
status: OPEN
owner: codex-20260823-1244Z/orchestrator-closeout
---

# Orchestrator #1370 closeout — production releases, DesignFlow isolation, Universe B, and Paramount preview

Checked against live GitHub and `origin/main` on 2026-08-24 at 12:03–12:11 UTC. This is the Path B closeout for the sole orchestrator marker #1370. `COORDINATOR_INTAKE.md` is retired and was not changed.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message before attempting any owner-gated action.

### Blocking

1. **DesignFlow live cutover — #1352 and #1353.** The empty isolated production structure is live, but copying the real DesignFlow rows and redirecting the four production services will change production data, database secrets, and Cloud Run bindings. Recommendation: authorize only the exact runbook resources/actions after timed rehearsal #771 is current and engineering re-confirms nobody or no job is writing. This blocks the first live data copy and service switch. Both issues carry `needs-albert`.
2. **Licensed Paramount record in a private Codex transcript — #1413.** One licensed metadata record was printed into private task `01a02ea5-11b6-7ab2-a886-ff03271a754b`; no credential or public post occurred. Recommendation: choose restricted retention or deletion according to POP's licensed-data policy. This blocks final incident disposition, not database work.

### Existing owner-routed queue items not decided in this session

- #1291, #1204, and #778 remain open with `needs-albert`; read their current bodies before asking because their questions may have changed.
- #1238 still carries `needs-albert`, although this session recorded settled decisions: `core.licensor` stays, nothing else is worth salvaging, and the remaining retirement gates are technical. Re-derive whether the label is still justified rather than re-asking settled questions.

### Already settled — do not re-ask

- 2026-08-23: use `dflow_prod` for isolated DesignFlow production structure and `dflow_archive` for old audit history.
- 2026-08-23: keep 24 months of AuditLog live; archive older history indefinitely with simple search/export.
- 2026-08-23: Sunday is the preferred one-time cutover window, but that is not blanket production authorization.
- 2026-08-23: `core.licensor` remains; Universe A property/character data has no salvage value.
- 2026-08-24: retire migrations `20260814233342` and `20260814233423`; preview-only rehearsal of Paramount versions `20260814193351`, `20260814213043`, `20260814223552` was authorized. Production promotion was explicitly forbidden and did not occur.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the structure of the shared Supabase/Postgres database used by POP's CRM, DAM, PM/PIM, source-data pipelines, DB Data Admin, and DesignFlow applications. One orchestrator owns schema coordination at a time. It accepts structural work, dispatches authors into isolated worktrees, serializes preview/merge/production, and preserves an auditable branch/PR/review/rehearsal path.

The permanent DB Data Admin production hostname is `https://data.designflow.app`. DesignFlow itself spans several `popcre/designflow-*` repositories. Licensed source rows live in private source repositories and must not be copied into this public repo, issues, PRs, or external reviewer prompts.

## 2. What we set out to do this session, and why

Marker #1370 began from the 2026-08-21 orchestrator closeout. Priorities were to ship the held reviewer-coordination fix, deliver Sample Tracking Release B, advance Universe A retirement, separate DesignFlow production from non-production, and keep unsafe/stale work such as #1090 from being dispatched literally.

The session later received explicit work to finish #1211 in production and to rehearse exactly three Paramount migrations on preview only. The business outcome was safer PopDAM batches, repaired migration coordination, isolated DesignFlow production structure, progress toward deleting Universe A, and a truthful Paramount preview rehearsal that found a loader defect before production.

## 3. Current state — what is true right now

### Moving facts checked 2026-08-24 12:03–12:11 UTC

- `origin/main`: `1d70642d8405fbad3030bef4659ead7c02978dff`.
- Maximum migration on `origin/main`: `20260824011750_create_dflow_prod_and_audit_archive.sql`.
- Sole open orchestrator marker before final close: #1370.
- Open shared-db PRs after the final refresh: #1406, #1379, #1365. PR #1411 merged concurrently at `1d70642d8405fbad3030bef4659ead7c02978dff` and its now-stale success-oriented capture documentation is tracked for correction in #1416.
- Queue audit exited non-clean (`fullyAudited: false`), reported two empty author lanes and dispatchable #1352/#1140. Under the 2026-08-21 ruling, repo-maintenance/documentation issues are visible to the audit but are not orchestrator assignments.

### Completed and production-verified

- **#1211 / PR #1372:** PopDAM receipt-proven terminal clear is live. Final migration `20260824004025`; preview run `32680107162`; immutable evidence run `32680216673`; production run `32680246580`; production ledger/catalog verification passed; issue closed.
- **#1315 / PR #1399:** 18 referenced DesignFlow sequences advanced to safe ceilings. Migration `20260823233716`; preview `32674765945`; production `32675736359`. Apply and ledger succeeded; generic post-apply lexer could not understand sequence-only DDL and made the workflow red after apply. Issue closed with that distinction.
- **#1307 / PR #1360:** Sample Tracking Release B live. Preview `32642141695`, production `32642238110`, generated types `32642337789`; EXPLAIN evidence posted; issue closed during closeout.
- **#1352 structural foundation / PR #1398:** additive `dflow_prod` and `dflow_archive` structure is live. Migration `20260824011750`; preview `32681272614`; production `32681471964`; post-apply verification passed. No business rows were copied and no services/secrets were redirected. #1352 stays open for cutover and now carries `needs-albert`.
- **#1374 / PR #1377:** empty `core.character` and `core.property_character` retirement step merged and released independently.
- **#1380 / PR #1385:** Warner-to-Universe-B relationship bridge released to production in run `32659028280`; #1090 was demoted to planned so its stale Universe A list cannot dispatch.
- **#1351 shared-db half / PR #1359:** durable reviewer assignments merged. Its companion `u2giants/ai-devops#60` was closed without merge, so #1351 remains open for reconciliation.
- **Coordination repairs:** PRs #1396, #1407, #1408, #1410 fixed quoted claim identifiers and governed preview recovery/security. The preview recovery security review caught and fixed workflow command injection before use.

### Paramount preview state — not clean

- Preview project was proven as `mvpkijzfmfcxhnzqogzs`; production is `qsllyeztdwjgirsysgai` and was explicitly rejected/skipped.
- Governed run `32721695779` applied exactly, in order: `20260814193351`, `20260814213043`, `20260814223552` from main `2ecdd43741048c4053f6d240d1e0758afcdc984e`.
- Preview ledger moved 489 → 492, adding exactly those versions. Artifact `9518010813`, digest `sha256:984f09a26b2bd2753f598e4de1b11f965cc135ad9edc7651d8a83e5a593fe87f`. All three live preview contract suites passed. No production job ran.
- A real private-source capture `379cbf7b-8e55-4e0d-b34a-89a7bd22a289` is marked failed. It retained 33,862 assets and seven metadata-element headings, but zero metadata-value rows. Existing two complete captures remain authoritative.
- Root cause: loader sends JSON `null` for absent `raw_value`; `pmt_amv_raw_value_shape_chk` accepts SQL NULL or a JSON object. Private file audit found 52,873 raw objects, zero non-object raw values, zero forbidden-key rows. The source data is not malformed.
- The loader repair was filed as shared issue #1412 then guard-forwarded to private `u2giants/licensor-source-data#43`. Do not alter licensed source data or weaken the check to make the capture pass.
- Owner retirement ruling for `20260814233342` and `20260814233423` is on #949 comment `5394518562`; PR #1402 (`cbff6f19613850a16a1a851717c0af19a4d6e0da`) hard-blocks both.

### Open work and merge/release order

1. **#1400 / PR #1406 first:** secure Universe B Data Admin RPC. Head `e1bc5792a71c192c8e7e2f89b39ea8fca56758ca`; all CI green; independently approved; claim #1405 remains open. It was not previewed, merged, or promoted.
2. **#1358 / PR #1379 after #1400 production:** current app PR head `0940ea1debc3a9f0bcd9666f7ae783bda7e7b6e7` is green but unsafe. It performs a separate role check and then direct `core.*` reads, so authorization is not atomic. Revise it to call only the protected #1400 RPC, fix stable pagination, re-review, then merge/deploy.
3. **#1352/#1353 DesignFlow cutover:** structure and four app/infrastructure preparations are green, but real row copy, secret rebinding, Cloud Run switch, rehearsal #771, and cutover have not occurred. This is owner-gated production work.
4. **#1238 Universe A:** salvage/blast-radius are settled. Remaining gates are #1358/#1400, stopping the DesignFlow writer into `core.property`, and retiring remaining read sites. Do not delete `core.licensor`.
5. **PR #1365 / #1414:** Factory compatibility work has no valid claim and its Migration Author Lease check fails. Re-derive or close; do not merge as-is.
6. **Merged PR #1411 / #1416:** documentation for a Paramount preview capture merged after the real failure was known but still describes the capture as outstanding. A repo-maintenance session must add the actual failed-capture result and retry gate; do not treat the merged plan as proof of success.
7. **#1090:** stale umbrella stays planned; never dispatch its literal object list. Bounded Warner successor #1380 is complete.
8. **#1351:** reconcile the closed-without-merge ai-devops half; repo-maintenance, not structural orchestrator work.

### Worktrees and untracked state

- Live/resumable: `C:/repos/shared-db-worktrees/issue-1358-db-data-admin-universe-b` (PR #1379; 10 modified PNG verification screenshots); `C:/repos/shared-db-worktrees/issue-1400-universe-b-rpc` (PR #1406; two untracked reviewer prompt files).
- Finished but dirty; preserve for deliberate cleanup: issue-1315 (two untracked reviewer files), issue-1352 (five untracked reviewer prompts), issue-1374 (one untracked reviewer brief).
- Finished and clean cleanup candidates after marker closure: pull-latest detached, recursing-bohr/PR #1401, prior orchestrator closeout/PR #1364, six-unapplied/PR #1402, issue-1211/PR #1372, recovery-chain/PR #1410, issue-1351/PR #1359, issue-1393/PR #1396, repo-preview-orphan/PRs #1407/#1408, Sample Tracking/PR #1360, generated types/PR #1373, Paramount documentation/PR #1411.
- Root checkout is intentionally not cleaned. It is 29 commits behind `origin/main` at the audit and has nine pre-existing untracked `.ai` briefs: `glm-1358-review.md`, `glm-1380-followup.md`, `glm-1380-review.md`, `issue-1090-warner-complete.md`, `issue-1090-warner-successor.md`, `issue-1358-secure-universe-b-rpc.md`, `issue-1380-close.md`, `issue-quoted-claim-identifiers.md`, `muse-1352-1353-business-decision.md`. This closeout also used temporary `.ai/handover-*.md` bodies; remove only those owned temporary files after issue creation, never the pre-existing nine.
- Local branch `claude/review-evidence-coverage-rule` maps to closed unmerged PR #1260 and no worktree. Preserve until a cleanup-worktree session decides whether it contains unique work.

## 4. Everything we tried that did NOT work

1. **Grok 4.6 review:** known wrapper failure hung silently with zero output; guarded assignments were skipped/replaced. Do not trust a zero-byte file or its nominal timeout.
2. **GLM reviews:** some completed usefully, but others stalled at 15 minutes and were cancelled/replaced. A nonterminal session is not approval.
3. **#1211 initial green code:** first independent review found that an expired completed job could mint a takeover receipt and clear the pointer. The first fix still allowed legacy completed rows without a historical receipt to mint one. Both were fixed with regression tests before release.
4. **#1211 preview reuse:** corrected SQL had reused a version already applied to preview. The migration was safely superseded, but the old preview-only ledger row blocked rehearsal. Hard-coded recovery supported only earlier incidents, so PRs #1407/#1408 generalized exact governed recovery.
5. **#1211 recovery evidence:** production risk gate rejected recovered evidence because the producer script changed during the repair. Do not relax producer equality. PR #1410 added an exact same-version preview reset; the migration was reapplied from current main, then production succeeded.
6. **Preview recovery workflow security:** independent review found direct workflow-input interpolation could permit shell injection. Every shell occurrence was moved through quoted environment variables; security re-review approved before the workflow ran.
7. **#1352 first draft:** runtime/dynamic schema cloning copied non-production defaults and did not deterministically define all sequences/grants. It was discarded and replaced with static Cloud SQL schema-only DDL.
8. **#1352 preview attempts before #1211 completed:** safely failed because preview held an unmerged #1211 version. This was correct serialization, not a reason to bypass the ledger.
9. **#1358 direct reads:** a browser role check followed by separate direct core reads is bypassable/non-atomic; unstable pagination could skip/duplicate results. Do not merge current PR #1379 before #1400 is live and the app calls only that RPC.
10. **#1315 overall red production workflow:** apply succeeded and ledger recorded the sequence migration, but the generic catalog verifier could not derive targets from `ALTER SEQUENCE`. Do not rerun an already-applied migration.
11. **Paramount real capture:** schema contracts passed, but loader JSON null is not SQL NULL. The failed capture is valuable evidence; do not weaken the constraint or rewrite licensed rows.
12. **Confidentiality failure:** an overbroad local `rg` printed one licensed Paramount record into this private Codex transcript. Never run broad content searches over private raw captures; use bounded scripts that report counts/schema only.
13. **Claim release calls:** one release omitted the owner and was refused; retry with exact owner succeeded. Claims are not inferred from context.
14. **A command used an unsupported `--list-claims` flag:** it failed harmlessly; use queue audit or documented manager commands.

## 5. Root causes and key findings

- Preview is shared mutable state, not a disposable local database. Version identity and producer-script identity must remain exact across review, rehearsal, recovery, merge, and production.
- Reviewer independence found two real #1211 defects after all CI was green. Green tests are necessary but not a substitute for adversarial review.
- DesignFlow production isolation required copying the exact current Cloud SQL structure into a new additive schema before any row cutover. The structural foundation is now live without activating empty reads.
- Dev, staging, and sandbox still write into the same non-production `dflow` schema/project arrangement; the owner concern in #1353 remains operationally important.
- Universe A retirement is not one monolithic drop. Empty character tables could be removed independently; property retirement is gated by the Data Admin screens, the writer, and remaining reads. `core.licensor` is retained.
- #1090 combines stale deletion targets with valid future aims. Bounded successors are the safe unit; #1380 proves that path.
- The Paramount database contract is structurally sound under its contract suites. The real source path failed at loader serialization, not source-data quality or schema deployment.
- Under current AGENTS.md §0.0-C, repo-maintenance and documentation are owned by separately started repo sessions. A new structural orchestrator lists them for visibility but does not dispatch or implement them.

## 6. Exact next steps

1. Start one new shared-db orchestrator only after marker #1370 is confirmed closed. Run queue audit and re-fetch main. **Worked when:** exactly one new marker exists and live main/max migration are recorded.
2. Renew/validate claim #1405, refresh PR #1406 from current main, obtain an exact-head independent review if the head changes, then preview → guarded merge → production. **Worked when:** #1400 is closed with successful preview and production evidence and the claim is released.
3. Return PR #1379 to its app author. Replace separate authorization/direct reads with one call to `api.db_data_admin_licensor_property_tree`, implement stable paging, rerun DB Data Admin tests and human-access checks. **Worked when:** reviewer finds no High/Critical issue and the screens show Universe B data only to authorized users.
4. Reassess #1238 after #1358 is live: find/stop the DesignFlow writer to `core.property`, retire remaining reads, then author only the exact remaining structural drops. **Worked when:** live read-only dependency proof is empty and `core.licensor` remains.
5. For DesignFlow cutover, a repo/application/infrastructure session completes #771 and presents Albert the exact data-copy, secret-version, Cloud Run resources, duration and rollback. Do not infer authorization from the structural release. **Worked when:** Albert names/approves exact live actions and the runbook gates are green.
6. Private source session fixes `u2giants/licensor-source-data#43`, repeats the Paramount preview capture, and proves it completes without changing existing complete-capture authority incorrectly. **Worked when:** new capture is complete, metadata values load, and inventory reflects it correctly.
7. Repo-maintenance session corrects the merged Paramount capture document under #1416 and resolves #1351; structural orchestrator must not do that work. **Worked when:** docs match the real capture and reviewer tooling issue is accurately closed or carried forward.
8. Structural session re-derives PR #1365 under #1414. **Worked when:** it either has a valid exact claim and successful governed release or is closed as obsolete with evidence.
9. Owner resolves #1413 transcript handling. **Worked when:** the authorized retention/deletion action is completed and documented without reproducing the licensed record.
10. Run `cleanup-worktree` only after the new marker situation is safe; preserve dirty/live worktrees and untracked evidence. **Worked when:** GitHub-proven merged clean worktrees are retired and no unique dirty artifact is lost.

## 7. Constraints and gotchas in force

- One orchestrator marker at a time; close #1370 only after this docs-only handoff PR is merged and all closeout gates pass.
- Structural database work only. Repo-maintenance/documentation are outside the orchestrator under the 2026-08-21 ruling; curated Master Data remains a governed fork.
- Never pre-acquire preview/merge/production locks; workflows acquire and release them.
- Never assume a migration is unapplied from the live catalog; compare the ledger to main.
- Never infer a scrape result from a table name; use `api.source_capture_inventory`.
- Every table, view, function, index, trigger, policy and other write must be explicitly claimed. Quoted/mixed-case identifiers are supported after PR #1396.
- DesignFlow app PRs target `develop` from Albert's sandbox branch and are never self-merged by an AI session.
- Production infrastructure changes require exact current-chat authorization naming resources/actions.
- Licensed rows stay in private repositories. External reviewers receive code/contracts, not licensed values.
- `COORDINATOR_INTAKE.md` is a retired pointer and must remain untouched.
- Preserve `required_status_checks.strict: false`; owner-approved policy beats stale documentation.

## 8. Access and environment

- Machine: EDGE-DEV (`C:/repos/shared-db`).
- GitHub CLI was authenticated as `u2giants`; GitHub remained source of truth.
- Supabase workflows proved preview `mvpkijzfmfcxhnzqogzs` and production `qsllyeztdwjgirsysgai`; this closeout did not expose tokens.
- Private Paramount source and authorized credentials were available through the approved private repository path during the capture. Do not copy their values or rows into this repo.
- Secret sweep result: no `.env`, key, credential file, private-key block, credential URL, Supabase token/service key, DB password, or API-key assignment was found in dirty/untracked text. Two live screenshot filenames contain `stale-token`; binary contents were not printed or assumed safe. No new 1Password item is needed.
- Reviewer tooling: Muse was reliable; GLM is usable with bounded monitoring; grok-4.6 remains unsafe due silent hangs tracked outside this repo.
- Docs pass: the handoff is the primary new durable record. PR #1411 is intentionally not merged because it must be reconciled with the failed real capture; no other live document was found newly false by this closeout.

## 9. Open questions and risks

- Preview is intentionally ahead of production by the three Paramount migrations and contains failed-capture partial rows. Any future rehearsal must account for that state rather than call preview clean.
- PR #1406's claim lease can expire; revalidate before any action.
- PR #1379's screenshots and PR #1406's reviewer prompts are dirty/untracked evidence in live worktrees. Cleanup without inspection risks losing verification evidence.
- The root checkout is behind main; never commit from it without first creating/updating a branch from current `origin/main` and staging only owned files.
- The exact current main, claims, PR checks, and migration maximum can move within minutes. Recheck at action time.
- The licensed transcript incident is private but unresolved until Albert rules on #1413.
- The failed Paramount capture retained partial preview rows by design. Do not delete them casually; they are audit evidence and ordinary application/source-data cleanup belongs to the owning private-source session.

# Part B — sub-agent state, separated by agent

### Agent: designflow_sync_sandbox_data
- **Asked to do:** diagnose the data-syncing sandbox startup failure without changing shared structure.
- **Actually did:** proved missing application metadata, restored exactly two canonical sandbox `dflow."UDFTable"` rows (IDs 94/95), and verified build/revision `popcre-albert-sync-sandbox-00089-jm5` ready with `db_ready`.
- **Found:** failure was application-data absence, not the new connection contract.
- **PR / branch:** DesignFlow data-syncing PR #19 remained open/green.
- **Worktree:** finished; owning app session must manage its checkout.
- **Deliberately did NOT do, and why:** no production/schema/secret changes; those were outside its application-data repair.

### Agent: issue_1090_warner_scope
- **Asked to do:** re-derive the Warner requirement without dispatching stale #1090.
- **Actually did:** bounded the successor to three relationship tables, guarded loader and filtered candidate view; later #1380/PR #1385 delivered it.
- **Found:** licensed reconciliation and ongoing evidence loads belong to the private Warner source session.
- **PR / branch:** no author PR from this analysis agent.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** did not execute #1090's stale Universe A deletions.

### Agent: issue_1315_author
- **Asked to do:** reconcile remaining DesignFlow sequence ceilings.
- **Actually did:** authored PR #1399 covering exactly 18 sequences; merged and applied.
- **Found:** seven sequences were correctly excluded; quoted/spaced identifiers required claim-tool repair #1396.
- **PR / branch:** #1399, `codex/issue-1315-sequence-reconcile`.
- **Worktree:** finished but dirty with two untracked reviewer files; preserve until cleanup.
- **Deliberately did NOT do, and why:** no unrelated sequence advances.

### Agents: issue_1352_author and issue_1352_release
- **Asked to do:** create and release additive isolated DesignFlow production/audit schemas.
- **Actually did:** replaced unsafe dynamic clone with static DDL; PR #1398 merged; migration `20260824011750` applied to preview and production.
- **Found:** structure must precede row copy; style-tracker bridge must remain on populated `dflow` until cutover.
- **PR / branch:** #1398, `codex/issue-1352-dflow-prod`.
- **Worktree:** finished but dirty with reviewer prompts; preserve until cleanup.
- **Deliberately did NOT do, and why:** no row copy, secret rebinding, Cloud Run change, or live cutover; separately owner-gated.

### Agent: issue_1358_app
- **Asked to do:** rebuild two Data Admin screens on Universe B.
- **Actually did:** produced PR #1379 and review evidence.
- **Found:** direct core reads after a separate role check are unsafe; stable pagination missing; requires #1400.
- **PR / branch:** #1379, `codex/issue-1358-db-data-admin-universe-b`.
- **Worktree:** live/resumable and dirty with 10 screenshots.
- **Deliberately did NOT do, and why:** did not merge an access-control defect.

### Agents: issue_1211_release and issue_1211_final_production
- **Asked to do:** finish PopDAM terminal-clear contract through production.
- **Actually did:** repaired two independent-review defects, superseded migration safely, merged PR #1372, applied version `20260824004025`, verified live function/privileges, closed #1211.
- **Found:** green CI missed takeover/legacy receipt edge cases; preview recovery chain needed exact current-producer evidence.
- **PR / branch:** #1372; production run `32680246580`.
- **Worktree:** finished/clean candidate.
- **Deliberately did NOT do, and why:** never reused invalid preview evidence or bypassed fail-closed production gates.

### Agents: preview_orphan_recovery and recovery_chain_gate_fix
- **Asked to do:** repair governed preview recovery for #1211.
- **Actually did:** PRs #1407/#1408/#1410; exact preview ledger reconciliation/reset; security repair; successful reapply from current main.
- **Found:** historical recovery and current producer equality form a circular gate unless the same version is reset and truly reapplied; workflow input interpolation was unsafe.
- **PR / branch:** merged PRs #1407, #1408, #1410.
- **Worktree:** finished/clean candidate (`repo-preview-orphan-1211`, recovery-chain worktree).
- **Deliberately did NOT do, and why:** did not weaken producer equality or edit production ledger.

### Agent: issue_1400_rpc
- **Asked to do:** author secure Universe B data service for #1358.
- **Actually did:** PR #1406 at `e1bc5792...`, full CI green, exact-head GLM approval, claim #1405.
- **Found:** server-side authorization, aggregation and stable paging can be enforced in one RPC.
- **PR / branch:** #1406, `codex/issue-1400-universe-b-rpc`.
- **Worktree:** live/resumable; two untracked reviewer prompts.
- **Deliberately did NOT do, and why:** no preview/merge/production because serialized releases and closeout intervened.

### Agent: issue_1380_author
- **Asked to do:** refresh the bounded Warner successor.
- **Actually did:** PR #1385 refreshed, then merged/released; production run `32659028280`.
- **Found:** direct/inferred evidence must remain separate and entitlement filtering fail-closed.
- **PR / branch:** #1385, merged.
- **Worktree:** finished/safe cleanup candidate if clean.
- **Deliberately did NOT do, and why:** did not load licensed rows or revive Universe A.

### Agent: paramount_preview_rehearsal
- **Asked to do:** record retirement ruling, apply exactly three Paramount migrations to preview, verify, and run real capture if authorized source existed.
- **Actually did:** run `32721695779`, ledger 489→492, contract suites passed; real capture attempted and failed safely; ruling posted to #949; #1412 forwarded to private issue #43.
- **Found:** loader JSON-null defect; source data valid. One licensed record was accidentally printed into private transcript.
- **PR / branch:** documentation PR #1411 at branch `codex/document-paramount-preview-job` merged as `1d70642d8405fbad3030bef4659ead7c02978dff`; corrective documentation is tracked by #1416.
- **Worktree:** finished/cleanup candidate if clean.
- **Deliberately did NOT do, and why:** no production action; explicit prohibition. Did not broaden credentials or alter licensed source.

### Agents: closeout_queue_audit and closeout_workspace_audit
- **Asked to do:** read-only live queue/workspace evidence for Path B.
- **Actually did:** identified missing issue for PR #1365, Paramount loader issue, #1352 owner gate, #1307 closure, live/dirty worktrees, untracked files, no stale HANDOFF.d contracts, and clean secret-pattern sweep.
- **Found:** PR #1411 appeared during closeout; root is behind main; no stale handoff file points to a closed issue.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** no cleanup or mutation; evidence-only audits.

# Fresh-developer self-audit

1. **Yes, a brand-new developer can continue without questions.** Sections 1–3 establish the system, exact current state, evidence and ownership; section 6 provides ordered executable gates.
2. **Yes, the developer has the session's non-obvious knowledge.** Sections 4–5 preserve every important failed path and root cause; Part B separates every dispatched agent.
3. **Yes, execution details are complete.** Sections 3 and 6 name versions, runs, PRs, SHAs, preview state, next actions and success criteria; sections 7–9 cover constraints, access and risks.
4. **Yes, section 0 contains every owner decision found by line-by-line sweep.** The live cutover and transcript incident are blocking asks; existing owner-routed issues are indexed; settled decisions are explicitly marked do-not-reask. No other section requires owner judgment.
