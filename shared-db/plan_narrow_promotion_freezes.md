# Evidence-first implementation proposal: narrower promotion freezes

**Proposal only; no safeguard or production implementation authorization.** [Issue #4039](https://github.com/popcre/shared-db/issues/4039). Read [report](docs/investigations/narrow-promotion-freezes.md) and [Muse debate ledger](docs/investigations/narrow-promotion-freezes-muse-debate.md). Initial baseline fee69a25ffd9b39c2b3accfde680dfbac3aa54f5; upstream refreshed to d241515e9454b663d8f2d49258820e089f15863a, October 7, 2026. Runtime safeguards unchanged by that upstream movement.

| Step | Status | Evidence / gate |
|---|---|---|
| Initial independent design review | HISTORICAL APPROVE | Gemini sequence 5638 at 610e80cd; heavier original proposal superseded |
| Muse review/debate | CONCURRENCE | Three completed persistent turns approve evidence-first sequence, not feature readiness |
| 0. Measurements, bindings and separate cleanup | OPEN / NOT AUTHORIZED | §9.0 |
| 1. Benefit and binding gate | OPEN | §9.1; insufficient evidence holds feature |
| 2. Minimal strict-mode implementation | CONDITIONAL / NOT STARTED | §9.2; no new subsystem by default |
| 3. Full caller and concurrency integration | CONDITIONAL / NOT STARTED | §9.3 |
| 4. Review, rollout and live acceptance | CONDITIONAL / NOT STARTED | §9.4; live proof stays on #4039 |

**Fresh-session starting point:** verify retained Muse outcome, live publication/ownership and this STATUS. Do not start code without later authorization. After authorization execute evidence-first phases; a failed gate stops downstream phases. Register successor owner on #4039 and use [handoff](HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md). Current default remains the existing global freeze.

## 1. Ultimate goal

Reduce unnecessary promotion-related blocking without weakening protection of the shared database or exact acceptance evidence. If a step conflicts with that goal, stop and flag it. Ordinary-prose admission is partial relief only: it does not solve unrelated code/schema blocking. A feature whose benefit is unproved must not be built merely because a safe-looking design exists.

## 2. System and environment

Canonical repository [popcre/shared-db](https://github.com/popcre/shared-db) owns SQL migrations for one shared Supabase database consumed by POP applications (CRM, DAM, PIM and DesignFlow). GitHub is source authority; automatic workflows execute reviewed changes. This is repository tooling, not a database structure change. Implementation languages are Node ES modules, Python and GitHub workflow YAML. Production identity is guarded by existing policy; preview identity comes from repository variable `PREVIEW_PROJECT_REF`. Never infer target from a local config.

Work only in a dedicated current-upstream worktree. Never edit a consumer's mirrored `shared-db/` directory or another session's checkout. Read repository `AGENTS.md`, `docs/agents/current-workflow.md`, relevant merge/claim/standing rules and activated production policy. Current automatic policy is active in `config/production-risk-policy-activation.json`. Never manual-dispatch production to test this proposal.

## 3. Trigger and reproduction

Albert asked whether promotion freezes could avoid blocking all shared-db merges. The supplied investigation task expressly prohibits implementation/deployment. Original mechanism on #3919 intentionally protects main while a risk assessment is obtained. On October 7 the #2875/#3708 freeze blocked generic merge acquisition and document authorization. Reproduce offline using existing freeze tests in `scripts/manage-migration-author-lanes.test.mjs`; never create a production freeze as an experiment.

## 4. Scope

IN: evidence-first measurement and binding audit; a separate cleanup-fencing proposal; conditionally justified single-source prose admission using existing context/records/module, complete caller conversion, train/queue synchronization, tests and reviewed rollout. No implementation in this investigation.

OUT: all new SQL/schema or data writes; generic disjoint-migration admission; snapshot promotion of migration trains; releasing existing locks; changing reviewer membership/approval semantics; reducing required checks; changing branch protection; new manual production lane; reopening retired orchestrator instructions; changing consumer deployment/acceptance rules; a new scheduling service. Do not fabricate a migration to get a reviewer.

Retain broad blocking during actual production ownership. The conditional first delivery may offer review-period relief without a semantic SQL dependency engine; meaningful benefit is unproved until the measurement gate passes.

## 5. Current code and delivery state

Nothing in this proposal is implemented, committed as code, deployed or live-accepted. Existing behavior and pinned references are fully mapped in report §§1–3. Entry points:

* `scripts/manage-migration-author-lanes.mjs:3943,3953,4043,4063–4158`: acquisition, freeze records and documents authorization.
* `scripts/lib/lanes/exclusive-policy.mjs:110–201` and `exclusive-locks.mjs`: extracted compatibility policy, must match orchestration.
* `scripts/lib/documents-only-change.mjs`, `scripts/check-documents-only-merge-authorization.mjs`: base-owned complete comparison/classification.
* `scripts/check-main-tip-freshness.mjs:64–109,121–243`: existing path-based production-inert exception, **not enough for new admission**.
* `.github/workflows/shared-supabase-migrations.yml:431,1173,1557,1800,1831,2159–2182`: preview, qualifier, apply and cleanup.
* `scripts/merge-queue-contract.mjs:233–276,436–468`, `.github/workflows/merge-queue-gate.yml`: final queue recheck.
* `scripts/production_business_risk_gate.py:596,1244,2229,3743`: runtime/provenance/source/risk chain.
* `scripts/production_migration_guard.py:1070,1543,2280,2511`: bounded ordered guards and fresh dry-run.

Line numbers are baseline locators, not permission to edit blindly after upstream movement. Re-read live code first. Existing production source review equivalence is preserved; tests do not become unreviewed implementation equivalence.

## 6. Findings and root cause

Exact-main protection is spread across several independent guards. One production freshness check already allows documentation/tests/evidence movement, but preview and qualification/lock still require literal equality. Removing only the freeze would make work fail later. Production-held merge blocking and status revocation are separate mechanisms.

Claims/version leases model named read/write overlap, not complete transitive SQL dependencies. Stored bodies, dynamic SQL, role/default privileges, FK/trigger/type dependencies and promotion code invalidate schema-only independence. Baseline cleanup is exact-delete within each operation but matches release by PR across attempts; an old same-PR cleanup can match a replacement freeze. See report §5 for fencing distinction.

## 7. Rejected approaches

Reject bare freeze release, schema/table-only comparison, blindly permitting `.md`, using only the existing production-inert predicate, candidate review transplanted to moving main, source-PR-only cleanup fencing, accepting an expired lock as abandoned, and weakening reviewer retention/parsers. Do not broaden reviewed-source equivalence to tests. Do not add a separate broker, scheduler or duplicate promotion implementation.

Generic migration tail admission is deferred, not approved by implication. A future plan must prove dependency closure, version barriers, changed live ledger and producer-code authority; this plan cannot pass its positive case.

## 8. Locked and open design decisions

**Locked invariants:** exact source approval; risk at fixed S and ordered V; immutable migration bytes and producer provenance; fresh target proof and dry-run; exclusive production writes; unchanged applied migrations; live issue/activation/revocation proofs; original application acceptance. Unknown state refuses. No human technical approval/manual work.

**Locked scope:** no production-held merge exception, no SQL/code tail admission, no new scheduling service or authority namespace. Preserve global freeze until a separately reviewed implementation changes admission. Keep broad source pause during production ownership. An expired freeze is neither promotion approval nor abandoned production ownership.

**Reuse:** extend existing `scripts/check-main-tip-freshness.mjs` with one strict `promotionProseTail` comparison mode, reusing ancestry/two-point/no-renames. Add complete tree mode/type validation and base-owned consumed-prose/runtime/global-invalidator closure. Existing broader predicates remain legacy behavior outside the activated new mode; every new caller uses the same strict mode. No duplicate Python policy. Reuse existing target-queue manifest helpers, run context, artifact schemas and freeze record; reconcile live Step 10 #3781 ownership before any shared-file edits.

**Identity choice contingent on audit:** before review, retain immutable S/source PR/head, ordered V/digests, runtime/producer/policy identity, candidate attempt (run ID + attempt), exact freeze ref identity and train-read proof. The freeze record cannot contain its own commit SHA recursively: consumers read the outer ref SHA and bind it separately. Existing run artifact/context retains identity after TTL/release. Approved preview/risk/dispatch/recovery artifacts may provide the final approval join if audit proves exact complete bindings and live revocation checks. No separate candidate-ref/approved-attestation lifecycle is mandated. Missing bindings stop and require an explicit revised reviewed design; do not automatically build a stronger subsystem. Mutable freeze TTL controls admission only, not evidence validity.

Open gates: benefit measurement, approved-artifact binding completeness, full runtime denylist, both backend read guarantees, live cancellation/revocation, prior queue authorizations and preview/production baseline freshness. Future implementing workstream owns them; assigned reviewer assesses technical sufficiency.

## 9. Sequenced executable phases

### 9.0 Evidence and independent cleanup preparation

After separate authorization, fetch main into an isolated worktree; declare actual task class, read current rules, inspect #4039, #3919, Step 10 #3781 and in-flight overlapping changes. Do not inherit application claims/other freeze ownership. Keep every existing gate/required check. Prove current behavior with existing tests before edits.

Pre-register a bounded observation sample: next two naturally independently authorized promotions or 14 days, whichever first. This is an observation bound, not permission to launch production or create a scheduler. Insufficient sample means feature HOLD. Existing authorized runs can supply read-only evidence; any instrumentation code itself needs normal review/CI.

Record separately: eligible ready prose PRs and causal refusal codes/timestamps; overlapping blocked-PR minutes; critical-path wall-clock delay; broad code/schema blocked work; review-retry events/provider dollars/active-agent time; implementation/review/upkeep cost estimates. CI, mutex, runner and production-held delays stay separate. Two proven authorization refusals are not end-to-end wait durations. Never add PR minutes to retry counts or equate overlapping waits with labor saved; convert only using recorded defensible assumptions.

Inspect artifact binding matrix against actual source: preview→S/V/digests/producer; risk→S/source PR/ordered V; dispatch→S/allowlist/artifact digest; recovery→original attempt/apply S/evidence; candidate→complete train generation/absence state. Include shared-preview baseline, fresh live ledger/catalog and cancelled/superseded approval. Record exact evidence and missing fields, not an assumed digest contract.

Separate first safety correction, if authorized: exact observed freeze SHA + acquired run/attempt fencing for all cleanup callers, under existing mutex/CAS. Old cleanup cannot delete renewed same-PR record. Preserve legacy unreadable recovery/no foreign-release, production lock ownership and every current admission rule. Deliver this as its own reviewed small change with deterministic ABA/idempotence tests; it grants no prose admission.

Exit: complete observation/binding inventory or explicit insufficiency, standalone cleanup disposition, ownership reconciled; no feature authority change.

### 9.1 Gate before feature building

Technical reviewer assesses measured benefit, retry/starvation alternative and estimated implementation/review/upkeep burden using separate units and transparent conversions. Compare partial prose relief against all blocked work honestly. Pre-register decision method before collecting sample; no invented SLA, arbitrary threshold or automatic approval at elapsed deadline. If benefit or bindings are insufficient, HOLD the feature and keep existing global freeze.

Alternative assessed here: later separately reviewed removal/shortening of early freeze while retaining exact-main gates and late production interlock. Verified guarded paths refuse stale continuation, but frequent changes may starve production and discard paid reviews. No automatic unbounded paid-review rerun. This is an evaluated alternative, not current default or permission to release locks. Reject or select it only on complete safety/liveness evidence.

Exit: same-issue signed gate record with exact source, valid binding matrix, measured uncertainty, reviewer technical concurrence and scoped implementation choice. Missing binding requires revised design/re-review; it cannot authorize automatic new snapshot machinery.

### 9.2 Conditional minimal strict-mode implementation

Only after gate passes and code scope is authorized. Extend existing freshness module with strict mode; compare complete S→T tree using trusted base code, protected-main ancestry, no unproved renames/deletions/symlinks/executable modes and unchanged migration/runtime closure. Explicitly deny instructions (including AGENTS/skills/.claude), executable-consumed prose, global policy, tests/evidence/config/SQL in the new exception. `.txt` only if the single strict policy proves it inert; otherwise safe refusal with clean requalification. Mode-only paths are reported by Git but currently not checked as modes; fix validation rather than claiming path invisibility.

Evolve existing freeze/context schema compatibly, retaining immutable attempt identity and complete approved-evidence join from §8. Legacy records remain exact-main/global blocking. Candidate-only context never dispatches/applies. Missing/unknown/duplicate fields, identity order/digest differences and unreadable state refuse. Freeze expiry cannot confer approval or discard recovery identity. No silent S→T substitution.

Exit: strict module/context negative tests, complete fixed identity, no new authority namespace/service, existing legacy tests unchanged.

### 9.3 Consistent callers and synchronized admission

Convert complete caller matrix together: repository-maintenance auth/merge admission; final queue group check; preview-rehearsal acquisition; qualification; `dispatch-production-apply.mjs`; production acquisition; `production-apply-review-evidence.yml`; `production-catalog-verification-recovery.yml`. Consume the same strict validator/approved-evidence join; exact checkout S/risk S/ordered V stay fixed. Partial-apply recovery after eligible prose must preserve original attempt and never replay applied SQL. Unknown/code movement refuses safely.

Activation proves prior merge lane/groups drained or revalidates complete actual final group. `recheckQueueInterlock` and actual final workflow branch must freshly re-read candidate identity/generation, exact current group/head and full tree delta under mutex; old success/status alone is insufficient. Preserve single-member rule; multi/mixed groups refuse. Keep productionHeld blockade and production revoke/restore semantics unchanged.

Candidate activation/prose admission and train authorize/dispatch take the same existing coordination mutex with two-sided exclusion. Outstanding authorized/dispatched/failed partial train authority blocks candidate; active candidate blocks new train authority. No administrative train cancellation. Inspect acquire order, release behavior and load/contention on the hot mutex.

Train absence proof validates complete actual reference history and latest immutable generation, never a cached empty list. Production `listRefs` uses REST/ghPaginated; review-budget adapter uses Git. Validate both backends, successful complete-read contract and exact row/SHA/ref identity; malformed/missing-SHA rows must refuse rather than filter. Non-array refusal does not detect truncated arrays. Unprovable completeness stops; a timestamp or invented complete flag is not proof. Add truncated/failed/malformed read fixtures and backend contract tests; preserve current guards outside new route.

Exit: offline complete-chain fixture plus synchronized race/load evidence; all old target/dry-run/ledger/allowlist/review/acceptance guards still operate. No positive SQL-tail case permitted.

### 9.4 Review, staged rollout and rollback

Run §10 adversarial suites and full affected tests. Start allocator-assigned exact-head review concurrently with CI after push; batch fixes once, re-review changed head. Keep normal branch protection/merge queue and all required checks. Muse debate is not this approval.

Default-off opt-in; shadow-only comparison first without admissions. Require zero false allows across hostile corpus. Activation goes through exact reviewed config/runtime and stronger task gates. Use one next independently authorized real promotion as canary; do not launch production solely for this feature. Eligible prose moves T while S/V/evidence remain fixed; record lock timings, target, fresh dry-run/apply, ledger/catalog and original application acceptance. Live proof stays on #4039 and original application issue; no leftover ticket.

Rollback through reviewed revert/default-off: stop new admissions, let owned active apply finish/reconcile, preserve exact run/ref evidence; never delete lock, cancel SQL apply, edit applied migrations or roll back ledger. Resume legacy exact-main only after old context is terminal/reconciled. Natural session cut points follow each phase; successor reads all downstream gates.

## 10. Tests and adversarial input matrix

Implement tests in the existing nearest suites and extend existing `scripts/target-queue-identity.test.mjs`; no duplicate snapshot module. Test names below describe required observable assertions, not just return values.

| External input / race | Hostile case | Named test and expected evidence |
|---|---|---|
| Snapshot JSON | Duplicate key, unknown schema/field, malformed SHA, changed digest/V order | `snapshot_record_rejects_ambiguous_identity`; no dispatch/write |
| Protected-main delta | Rewritten/non-ancestor history, unreadable/empty unexplained diff | `snapshot_tail_requires_readable_protected_ancestry` |
| Exact files/modes | Renamed instruction, Markdown symlink, executable mode, runtime-consumed prose | `snapshot_prose_cannot_hide_runtime_change` |
| Train authority | Existing authorized/dispatched/failed train; authorization races candidate activation | `stage_one_train_authority_retains_global_freeze` and `train_candidate_activation_has_one_winner`; no stranded approved train |
| Train listing | Missing SHA, truncated valid array, failed REST/Git read, unproved complete history | `train_listing_incomplete_or_malformed_refuses_candidate`; no absence authority |
| Train contention | Candidate/authorize/dispatch under real mutex load | `train_candidate_mutex_load_preserves_progress`; no starvation/lock leakage |
| Train recovery | Retry after partial apply or stale snapshot | `train_partial_apply_recovery_stays_legacy_and_no_prose_exception`; applied prefix never replays |
| Candidate lifecycle | Before risk approval, missing final evidence | `candidate_docs_only_never_dispatches_or_writes`; complete existing approved-evidence join required |
| Recovery callers | Docs advance after partial apply or before immutable recovery evidence | `snapshot_recovery_accepts_prose_but_preserves_original_attempt`; no replay |
| Pure docs | Regular inert prose advances T during review | `snapshot_docs_advance_preserves_exact_identity`; S/V/A unchanged |
| Migration/code tail | Apparently disjoint additive CREATE in another schema | `stage_one_disjoint_sql_still_refuses`; no approval implied |
| SQL dependencies | Shared role/grant/function, cross-schema FK, trigger, DO/dynamic SQL | `unknown_and_shared_dependencies_refuse`; no SQL parser certification |
| Version inventory | Earlier/later version, duplicate, edited applied, ledger hole | `snapshot_tail_cannot_change_migration_inventory`; preserve legacy guard refusals |
| Live database | Extra applied version absent from S or partial A/B batch | `snapshot_live_ledger_reconciliation_refuses_stale_baseline`; applied A never reruns |
| Artifact/run | Expired/cancelled/wrong producer, another run attempt or source issue | `snapshot_rechecks_live_provenance_and_authority` |
| Policy/runtime closure | Mid-review promotion workflow/config/sidecar/security revocation change | `snapshot_global_invalidator_stops_old_runtime` |
| Final admission | Main/group/head changes after earlier authorization | `queue_final_snapshot_generation_race`; success only for exact validated group |
| Activation | Merge lane already held when snapshot begins | `snapshot_activation_drains_or_revalidates_prior_merge` |
| Concurrent acquire | Two sessions | `snapshot_create_only_has_one_winner` |
| Cleanup | Old attempt same PR deletes newer generation | `cleanup_old_attempt_cannot_release_new_same_pr_freeze` |
| Retry cleanup | Already absent expected generation | `cleanup_repeated_exact_attempt_is_idempotent` |
| TTL | Inert tail after expiry vs non-prose tail; expiry mid-apply | `expiry_keeps_bound_attempt_but_never_approves_invalid_tail` and `expiry_does_not_release_production` |
| Batch queue | Mixed safe/unsafe members | `queue_multi_member_snapshot_refuses` |

Run existing `node --test scripts/target-queue-identity.test.mjs scripts/dispatch-production-apply.test.mjs scripts/orchestrator-flow/migration-train.test.mjs scripts/manage-migration-author-lanes.test.mjs scripts/check-main-tip-freshness.test.mjs scripts/merge-queue-contract.test.mjs scripts/check-merge-queue-workflows.test.mjs scripts/lib/documents-only-change.test.mjs scripts/lib/lanes/exclusive-policy.test.mjs`; discover any actual renamed files before execution. Run Python suites `scripts/test_production_business_risk_gate.py`, `scripts/test_production_apply_review_evidence.py`, migration guard and derivation suites using repository documented Python context. Run `bash scripts/check-sql.sh`, all required workflow checks and promotion-sidecar closure guard. For concurrency, control barriers around observed ref SHA/final authorization, and assert loser leaves winner's ref intact.

A later SQL extension must add a positive `disjoint_additive_tail_merge_preserves_order_and_live_baseline` test with independent dependency proof; it is **not stage-one done criteria** and remains a refusal here.


Add `strict_tail_refused_then_requalified_does_not_wedge` and `prose_partial_apply_recovery_never_replays_applied_prefix`. Actual storage is existing run/context; test labels "snapshot" mean immutable promotion identity, not a required new ref subsystem. Binding/measurement insufficiency tests precede feature build. No mock success substitutes for real backend completeness or final application acceptance.

## 11. Constraints and traps

One parent issue #4039 for this tooling need. No structural object claim. Respect Step 10 ownership and all foreign records. Installed task gates/ai-gh, exact-head implementation review, unchanged checks, normal protected merge, exclusive writes and live application proof remain. Current source/owners change between reads. Sign GitHub posts with actual Codex chat/machine; human times EDT/EST. Raw transcript/prompts stay private; retained reviewer reports are sanitized source-only evidence. No secrets/1Password/provider replacement during reviews.

Do not confuse initial Gemini design approval, subsequent Muse debate concurrence, publication, future implementation approval, deployed code, database application and application acceptance. Missing proof is pending. Technical gates never become Albert's manual step. Do not add scheduler/broker, duplicate classifier or mandate stronger storage after a failed audit.

## 12. Access and evidence

Node/Python3, installed task gates, ai-gh and protected named Muse session available. No database credentials needed for investigation. Private raw evidence `/tmp/narrow-freeze-evidence` is ephemeral; durable report/debate retain timing/run/verdict provenance. Reread real source and GitHub rather than temp captures. Baseline observed 74 freshness/exclusive tests, seven freeze tests, 29 queue/dispatch tests and SQL static checks passed; these prove existing behavior, not proposed feature. Future code tests/credentials use supported repository procedure.

## 13. Definition of done, risks and open ownership

This owner-requested review/debate is done when actual persistent Muse turns, substantive disagreement/concessions, revised artifacts and normal publication are retained. Feature readiness remains conditional, never labelled completed from this debate.

Future implementation done requires approved gate record, separately authorized scope, exact-head assigned review, tests/CI, normal merge, activated-code identity, real prose canary and complete original application acceptance with measured cleanup. HOLD if sample or bindings are insufficient. Risks are classifier mistakes, incomplete records, stale runtime/live authority, prior groups, same-PR cleanup replacement, preview/ledger drift and mutex starvation; each maps to a named test or stop gate.

Future implementing workstream owns bindings, observation ledgers, benefit choice and code/live acceptance; existing coordination-IO maintainer/Step 10 owner must reconcile scope; allocator-assigned reviewer judges technical sufficiency and actual exact-head change. Register one named successor on #4039, not generic unowned work. This Codex workstream owns publication and handoff until completed. No business question currently open.

## Self-audit

1. Newcomer execution: read STATUS, report, debate and handoff; evidence-first phases have explicit exits and HOLD behavior. No chat/temp-file dependency.
2. Context/failure coverage: system, trigger, source, ownership, ABA, classifier, both train read backends, unit mismatch and all recovery/queue callers present.
3. Goal and scope: partial relief honest; existing global freeze default; no implementation authority, no duplicate policy/storage, all original safety/live proof retained. Thirteen sections, adversarial tests, rollout/rollback and bidirectional handoff included.
