---
issue: 2336
status: BLOCKED
owner: codex/2336-licensing-recovery
---

# Licensing consolidation forward repair and dependent outcomes

## 0. Business decisions only the owner can make

No new technical approval is requested from Albert. Parent recovery session owns technical routing, claims, merge and promotion decisions. His current MG05/MG06 business clarification is already supplied: portal-authoritative properties must replace ColdLion MG06; existing items need individually supported mappings from their legacy classification to the exact new property; MG05 alone cannot identify a property because each licensor has many properties; new items choose the new MG06 values. The canonical ruling is published in merged [PR4159](https://github.com/popcre/shared-db/pull/4159), commit [d6250fe05ee9d6cf7d9615d21b1d1b0d5e93d1f6](https://github.com/popcre/shared-db/commit/d6250fe05ee9d6cf7d9615d21b1d1b0d5e93d1f6), with successful [consumer sync38141683304](https://github.com/popcre/shared-db/actions/runs/38141683304) and [2541 ruling comment](https://github.com/popcre/shared-db/issues/2541#issuecomment-6109331703). This is not admission of either historical 33 or 66 candidates. Laura/Ilona mapping work is user-reported in progress; activity time is unverified. Do not contact them.

## 1. What this application is

[shared-db](https://github.com/popcre/shared-db) governs the shared Supabase PostgreSQL schema and curated licensing master data consumed by POP applications. Licensing source adapters reconcile private portal captures with canonical properties, characters, franchises, artwork and direct relationships. Raw licensed captures belong in the private licensor-source-data repository, never public issues or reviewer prompts.

## 2. What this session set out to do

Albert requested clearing issues 2599, 2598, 2541 and 2358 as part of a larger parallel cleanup. This lane audited their dependencies and recovered the merged #2336 preview route. It found original consolidation capability missing; preparation and catalog installation cannot stand in for full delivery.

## 3. Current state

Recovery owner is the parent Codex session that delegated this lane. This artifact's branch identifies the evidence holder, not a transfer of claim 4152. Parent is active in this shared conversation; do not infer another author's present activity. Original MiMo author's last verified durable #2336 update was October 9, 2026, 10:41 PM EDT; current activity unverified.

[2336 blocker evidence](https://github.com/popcre/shared-db/issues/2336#issuecomment-6109317521) includes the bounded behavioral audit and failed review release. [PR4153](https://github.com/popcre/shared-db/pull/4153) is merged. Source head is [30db82311326f67023c25372f274e1010df90c89](https://github.com/popcre/shared-db/commit/30db82311326f67023c25372f274e1010df90c89); base is [43d6902dc176c1c37ab90537dedfc51ce0fa3d7c](https://github.com/popcre/shared-db/commit/43d6902dc176c1c37ab90537dedfc51ce0fa3d7c). Migration version 20261009224453 has SHA256 e66c4eb6590824a9c7e0933c2f4f27a16002ba8883b363e0ad42ce0946bbc980 and must remain immutable.

[Preview38140871380](https://github.com/popcre/shared-db/actions/runs/38140871380) succeeded before this lane's [38140994603](https://github.com/popcre/shared-db/actions/runs/38140994603), which safely refused already-applied preview evidence. Automatic [production38141056185](https://github.com/popcre/shared-db/actions/runs/38141056185) failed before SQL because both required durable production-risk-assessment blocks were missing. No production acceptance or issue closure is established.

Claim [4152](https://github.com/popcre/shared-db/issues/4152), mimo/2336-consolidation, remains protected although its lease expired. Installed author transfer requires an OPEN PR; merged4153 cannot use it. Parent inspected [4109](https://github.com/popcre/shared-db/pull/4109): draft source dea119ab5df521a3fb2ed68ea5850f310d2d6b27 remains the old manager implementation, with allocator collision3999. Contract3618/4 proposes expired-MERGED recovery but is not implemented on main. Expiry is not release or authority.

[2598](https://github.com/popcre/shared-db/issues/2598) and [2599](https://github.com/popcre/shared-db/issues/2599) remain blocked on fully accepted2336, plus their own current validated captures and two-cycle adapter proof. [2358](https://github.com/popcre/shared-db/issues/2358) is blocked on accepted2336 and valid object claims. [2541](https://github.com/popcre/shared-db/issues/2541) remains a distinct business reconciliation; [1941](https://github.com/popcre/shared-db/issues/1941) Creative mapping was delivered but ColdLion reconciliation is outstanding.

## 4. Attempts that did not work

Local 1Password CLI had no configured accounts; use the connector's protected environment injection, not credential output. Ordinary merged-preview launch does not require author adoption or claim_pr: merged_preview_source_pr is its supported authority. The duplicate preview run refused safely; do not retry an already-applied version.

Risk slot3 sequence6083 was assigned StepFun and terminated with exact `AI_REVIEWER_OUT_OF_CREDIT provider=stepfun code=insufficient_quota`, exit92, no verdict or artifact. Allocator release recorded failure SHA55e8db50f072f28f2e339851284f1269b2d146d1 and released-lease SHA16bcaf20aaead0db5b726e5c291ef2659474cf3c. No pending lease remains. Do not buy a replacement review for the incomplete original engine.

## 5. Root causes and findings

The immutable [migration](https://github.com/popcre/shared-db/blob/30db82311326f67023c25372f274e1010df90c89/supabase/migrations/20261009224453_hash_pinned_licensing_consolidation.sql) does not implement the full required contract: relationship support upsert/retire only increases a no-op counter; entity support retirement records a count/audit without updating support. New canonical property creation, spelling aliases and source ownership correction are also missing. Character/style-guide/asset/franchise operations are refused, not delivered. Catalog-only tests therefore cannot close2336.

Synthetic PostgreSQL16 tests used the original guarded-write machinery and byte-identical migration. They passed source-scope refusal, deterministic plan identity, stale hash refusal, revoked scope refusal, matched-property rename preserving active status, idempotent reapply, collision refusal, and co-occurrence refusal. They do not establish direct-support updates, creation/aliases/corrections, two capture cycles or production behavior. The network-none disposable container has been stopped and removed.

Private fixtures and logs are retained in the recovery worktree's ignored `.ai/recovery/2336-20261011T130602Z`, with manifest SHA25686af44d9fd58af82bb62db452d14acae13ebdeff5dcc92ac95482ebaba78bde2. This local evidence package is intentionally not pushed. Parent must preserve it when moving recovery ownership.

## 6. Exact next steps

1. Parent resolves the supported expired-MERGED ownership route through existing3618/4109 work, without releasing/adopting4152 by age or bypass. Gate: installed main supports the exact reviewed transition and actual claim authority is valid.
2. Re-read live2336 contract, current main, all claims and source captures. Claim only the missing forward-repair objects and reserve a new migration version. Gate: no object collision and current lease belongs to the implementing session.
3. Bound the repair around existing `plm.plan_licensing_consolidation`, `plm.apply_licensing_consolidation`, plan-table/immutability objects and required canonical bridges/support. Enumerate exact object signatures before claiming; no new migration is authorized by this inventory alone. Support tables are core.property_character_source_edge, core.property_style_guide_source_edge, core.property_franchise_source_edge, core.style_guide_character_source_edge, dam.asset_property_source_edge, dam.asset_character_source_edge, dam.asset_style_guide_source_edge, dam.asset_franchise_source_edge. Prove canonical counterpart/constraint semantics from current catalog. Gate: direct support, first/last observation, source-specific absence retirement, aliases, stable identity and immutable correction audit have executable paths instead of counters.
4. Preserve all other sources' support. Current-support uniqueness excludes source_id; do not invent a collision policy. Last-direct-support retirement and bridge withdrawal must satisfy existing deferred constraints without deleting a canonical entity. Co-occurrence must never become direct support. Gate: complete two-cycle fixtures show precisely the contracted writes; injected mid-transaction failure leaves no partial state.
5. Obtain allocator-assigned exact-head review and production-risk assessments only after full behavior passes; use normal guarded merge and automatic merged-preview/promotion. Gate: immutable preview, production target/dry-run/locks, installation and bounded live behavior all pass. No manual production SQL or curated merge execution.
6. Resume2598/2599 independently using private current captures, source-scoped exact identifiers and direct evidence. Historical receipt success is not today's accepted two-cycle proof. Gate: each adapter fulfills its own two validated cycles and injected-failure acceptance, without licensed rows in public evidence.
7. Resume2358 only after2336 acceptance. First contract excludes Licensor merging and covers compatible-Licensor property/character/franchise merges. Inventory every mutable FK and logical reference, including source_resolution, licensing_relationship_resolution and taxonomy_source_ref. Preserve immutable historical IDs with survivor tracing; unsupported relationships or uniqueness conflicts refuse the entire plan. Hash the full graph and row before-images; enforce canonical_merge authorization, tombstone/alias picker exclusion, immutable history and drift-safe reversal. Audit actual API pickers before proposing guard additions. Gate: allocator-approved exact object scope, full graph/reversal tests and live picker proof; no real canonical merge is authorized.
8. Deliver2541 under the published ruling: replace ColdLion MG06 with the exact portal-authoritative values, establish individually supported existing-item property mappings, perform the governed cutover, and prove existing/new-item behavior live. MG05 alone cannot determine a specific property; each licensor has many properties. Gate: exact portal identifiers, mapping authority, complete cutover and live proof are established; no inferred33/66 load.

## 7. Constraints and gotchas

Read current AGENTS router and relevant shared-db skill. Fresh upstream worktree only; claim-first object safety, reserved migration version, independent allocator review and gate checks remain mandatory. Never mutate the preview-applied migration. Ordinary merged-preview authority is independent of author adoption; forward implementation is not. No paid review replacements before capability repair. Do not contact people on Albert's behalf. Keep all human-facing times America/New_York with EDT/EST labels. Sign every GitHub update.

## 8. Access and environment

GitHub CLI is authenticated. Supabase MCP is pinned to production qsllyeztdwjgirsysgai: prove get_project_url before read-only catalog inspection; never assume it is preview. Configured preview is mvpkijzfmfcxhnzqogzs. 1Password connector protected op_run injection uses vault vibe_coding and serialized access; never print values or pass credentials in arguments. No credentials are in this file. Private licensor-source-data contains historical NBCU and Paramount receipt evidence, not current acceptance. Recovery evidence is held by the parent on edge-dev3; no test container remains running.

## 9. Open questions and risks

As of October11,2026,9:08 AM EDT: ownership recovery implementation is absent, original2336 cannot be accepted on counters/catalog evidence, and no new protected code claim is valid. Parent owns these technical blockers. Source captures/identity authority and full graph/picker coverage must be proved separately. Existing immutable source approvals remain historical evidence; they do not approve a forward migration. Public comments must disclose only sanitized outcome/count/hash evidence. Delete this handoff when the succeeding step is genuinely delivered and all remaining obligations are carried forward.
