# RLS permission-check performance repair

## STATUS — read first

Execution snapshot: October 18, 2026, 2:23 PM EDT. Publication/inventory prerequisites are merged. The administrator family is under source qualification; no preview or production repair has been accepted. Later families remain dependency-gated.
Fresh session starts at Step 1; refresh upstream, this table and live issue before editing. Update this table and §5 after every executed step. A done row must cite immutable file/commit/run evidence, not a count or issue number alone.

| Step | Deliverable | Status / date | Evidence required to mark done |
|---|---|---|---|
| 1 | Refresh full inventory, contracts and custody | ⬜ open — October 18, 2026 EDT | New catalog/claims snapshot and classified manifest |
| 2 | Baseline access and performance fixtures | ⬜ open — October 18, 2026 EDT | Role-enforced before-tests and raw timing plans |
| 3 | Forward migrations and contract tests | ⬜ open — October 18, 2026 EDT | Migration commit, exact metadata delta, focused test run |
| 4 | Preview rehearsal and independent review | ⬜ open — October 18, 2026 EDT | Preview run, role matrix, durable exact-head APPROVE |
| 5 | Guarded merge and governed production apply | ⬜ open — October 18, 2026 EDT | Merged commit plus immutable promotion/ledger/catalog evidence |
| 6 | Production live proof and consumer acceptance | ⬜ open — October 18, 2026 EDT | Rescan, representative plans, permission/consumer proof |
| 7 | Final reconciliation and retirement | ⬜ open — October 18, 2026 EDT | Acceptance record, updated plan/program and handoff retirement |

Owning outcome: [issue #4421](https://github.com/popcre/shared-db/issues/4421).
Parent program: [#2326](https://github.com/popcre/shared-db/issues/2326), specifically the RLS initialization-performance slice of [plan_database_efficiency_and_api_security.md](plan_database_efficiency_and_api_security.md) Step 6.
Handoff: [HANDOFF.d/2026-10-18T1421Z-edge-dev3-codex-rls-performance-plan.md](HANDOFF.d/2026-10-18T1421Z-edge-dev3-codex-rls-performance-plan.md).
Evidence: [baseline inventory and measured timings](docs/verification/rls-initplan/2026-10-18-baseline.md).
This is a planning deliverable. It does not begin implementation, claim objects, reserve versions, or authorize a production write.

### Execution issue map — updated October 18, 2026 EDT

Parent #4421 now has six verified native sub-issues and native blocked-by links. Publication #4425 and inventory #4426 are closed with native merged prerequisite records. Implementation #4427–#4430 remains open; preparation and isolated CI are not live repair.

| Child | Responsibility | Prerequisites |
|---|---|---|
| [#4425](https://github.com/popcre/shared-db/issues/4425) | Resolve publication gate conflict and land existing plan | None |
| [#4426](https://github.com/popcre/shared-db/issues/4426) | Fresh read-only inventory, actual query baselines and test specification | None; may proceed independently of publication |
| [#4427](https://github.com/popcre/shared-db/issues/4427) | All 46 public-admin policies end-to-end | #4425, #4426 |
| [#4428](https://github.com/popcre/shared-db/issues/4428) | All 17 owner-uid policies end-to-end | #4425, #4426, #4427 |
| [#4429](https://github.com/popcre/shared-db/issues/4429) | All four app-access policies end-to-end | #4425, #4426, #4428 |
| [#4430](https://github.com/popcre/shared-db/issues/4430) | Both packaging/JWT policies end-to-end | #4425, #4426, #4429 |

This refines §8's formerly open batching choice: use family deliveries in that order, each carrying its own live-proof checklist through completion; do not create separate proof tickets. Preparation does not claim objects or write fixtures. Each structural child redoes fresh Step 1 custody and executes Steps 2–7 for its family, including preview fixtures, review, merge, production and live acceptance. Parent #4421 remains tracking-only; the admitted repair child is its source PR's single structural issue. Update this plan and each relevant child as results land. Codex chat 01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e owns continuation. Native subagents prepare later-family tests concurrently; implementation and closure remain ordered by each predecessor’s live acceptance.


## 1. Ultimate goal

Make asset and related application operations use less database work while leaving every person's access exactly as it is today. Cover every currently flagged policy, not just assets. Completion means the actual policies work efficiently in production, legitimate actions still work, and forbidden actions remain forbidden.

**If a step conflicts with this goal, the goal wins — stop and flag it.** A faster permission bypass is a failure. A quiet advisor with unchanged expensive helper work is not sufficient evidence of the intended performance outcome.

## 2. What this application is

POP Creations' CRM, DAM, PM/PIM and DesignFlow consume one shared Supabase PostgreSQL database and PostgREST API. This repository, [popcre/shared-db](https://github.com/popcre/shared-db), owns database structure, forward migrations, tests and consumer-shared contracts. It has no application runtime and no package.json. Browser applications and workers live in their own repositories; DB Data Admin lives in u2giants/popdam3, not here.

Observed production API: https://qsllyeztdwjgirsysgai.supabase.co . This identifies the inspected target, not future write authority. Resolve preview from GitHub repository variable PREVIEW_PROJECT_REF every time; never use historical preview literals. Re-read AGENTS.md and docs/agents/current-workflow.md at execution. Begin in a new current-origin/main isolated worktree, on a fresh codex/ branch. Planning base: [845a92d77b097a8153baf523ec5291b3bcb29b5d](https://github.com/popcre/shared-db/commit/845a92d77b097a8153baf523ec5291b3bcb29b5d).

## 3. Trigger and reproduction

Albert supplied Supabase's warning for public.assets policy “Admins can insert assets,” then requested a wider search and measured timings, then a plan to fix the whole finding. Live production catalog showed the insert WITH CHECK and update USING both call public.has_role(auth.uid(), 'admin'::public.app_role).

Reproduce read-only: verify MCP get_project_url, retrieve get_advisors(type=performance), filter auth_rls_initplan, and query pg_policies as recorded in the baseline evidence. At the snapshot there are 69 warnings / 49 tables: 46 public-admin policies, 17 owner-uid policies, four style-guide app-access policies, and two packaging/JWT policies. Sixty-seven policies are additional to the two assets policies. These are baseline identities, not a future hard-coded expected global count.

## 4. Scope

IN: all 69 exact policy identities in the baseline; refresh for already-fixed/removed/changed policies; optimize request-constant authentication/authorization expressions while preserving policy metadata and row predicates; equivalent-access tests, measured plans, preview, independent review, guarded merge, governed production apply, live proof and consumer smoke checks.

NOT in this plan:
- Policy consolidation, changing permissive/restrictive semantics, grants, RLS enable/force flags or exposed schemas.
- Role/enum unification, helper-body rewrites, security-definer/search-path changes, changing JWT allowlist emails, or business access changes.
- Index creation/removal, unused-index cleanup, unrelated advisor families, Auth settings, broad security hardening or the rest of #2326.
- Production fixture inserts, data backfills, maintenance/statistics resets, manual production SQL application, or app releases.
- Changing already-applied migrations or making the historical migration set replay cleanly.
- Modifying Codex skills or portable memory; no separate memory update was requested.

New matching policies discovered at execution must be recorded and individually qualified; include them only after fresh scope/admission/claim expansion. Do not silently extend claims or declare the new items fixed. Already-remediated baseline entries need live proof and a manifest disposition, not another rewrite.

## 5. Current state and code evidence

October 18, 2026, 2:23 PM EDT: original PR #4423 was superseded without changing its five candidate files; #4425 merged through PR #4433. #4426 baseline preparation merged through PR #4434. Each has its native merged prerequisite record.

Claim #4158’s stopped source was independently preserved in its original clean checkout, a separate clean clone and a verified Git bundle. Supported recovery capability PR #4438 was independently reviewed and merged; its live adoption receipts were verified, then the new owner released the old source claim normally. Original application issue #2421 remains OPEN for its separate runtime acceptance. No migration/history was discarded.

Administrator repair #4427 uses new claim #4502 and reserved version 20261019192822, draft PR #4444. Fresh qualification retains all46 baseline dispositions/39tables/72overlapping policies;44 policy expressions across37tables are candidates. Two retired archive policies have zero current effective nonbypass callers and stay unchanged, with final live requalification required. claim #4502 retains its original stronger85 object locks.

Isolated CI [39152564172](https://github.com/popcre/shared-db/actions/runs/39152564172) passed migration replay,1932 authenticated before/after results and exact errors, metadata/ACL/union checks and198 actual write plans at source d771ef8cb6eb19fe24d6feccc588d858180593ca. Representative administrator-configuration candidate checks executed once per statement. Eight of nine measured cases improved; single-row INSERT was5.75percent slower, below the10percent investigation threshold. This is synthetic isolated evidence, not shared-preview, production, UI or all-policy performance acceptance. Expanded CI39154055887 at2fbc889e50ccc59090742531e049a1c3232b1778 subsequently passed2124 outcomes and198 raw plans; median single-row INSERT was7.39percent slower, still below10percent. Durable source-bound raw evidence is in docs/verification/rls-initplan/4427/source-runtime-evidence.json.gz with its readable digest/measurement summary.

Muse approved source5d03a81a862fec937cb057929ef6db0eeee001cb, but guarded merge39154975427 correctly refused a missing automatic installed-catalog probe. Generation6 prospectively adds that read-only proof; fresh exact-head review is required for the updated source. Preview rehearsal, source delivery, guarded merge, governed production promotion and live consumer read/write proof remain OPEN on #4427. #4428–#4430 have private preparations only; they must independently recheck custody and execute after predecessor live acceptance. No shared-preview or production SQL write has occurred in this continuation.

Repository anchors at the planning base:
- supabase/ci-bootstrap/010_pre_adoption_baseline.sql:5170–5180 defines the adopted public.has_role helper. Line 6635 contains the legacy assets insert policy; nearby policies establish legacy context. This file supports clean CI setup; it is NOT a migration to edit or run against production.
- supabase/migrations/20260723170000_popsg_file_tags.sql:773–788 defines the four style-guide app-access SELECT policies.
- supabase/migrations/20260709144500_core_packaging_type.sql:30–62 defines packaging read/write policies and grants.
- plan_database_efficiency_and_api_security.md:286–309 describes broader Step 6. This plan narrows its performance work; the broader program remains open.
- docs/agents/current-workflow.md defines current routing and supersedes historical orchestrator wording.
- supabase/tests/admin_config_apply_counters_contracts.sql:1 is an example of rolled-back SQL contracts; use the current database-contract workflow's runner and bootstrap, not an invented package command.

Exact live inventory and expression drift fingerprints are in docs/verification/rls-initplan/2026-10-18-baseline.md under “Exact policy inventory.” The live catalog outranks historical SQL. Before editing, resolve each manifest identity to its current definition and its latest upstream migration, with fresh line references. Original assets definitions predate adoption, so absence of an authoring migration is expected.

## 6. Findings and root cause

Supabase can evaluate a direct auth call once per row. Replacing just auth.uid() with a scalar SELECT avoids repeating the identity lookup but can leave an expensive permission-table lookup running for every row.

Five alternating 10,000-row production expression tests had median execution times 132.956 ms original, 123.219 ms UID-only SELECT (7.3% reduction), and 3.788 ms whole permission check SELECT (97.2%, 35.1x). The baseline artifact contains all 15 samples, warmup, exact SQL and limitations. These were generated-row aggregate FILTER tests through an elevated connection, not actual role-enforced RLS or asset write throughput. They do not establish application speed or production security equivalence. PostgreSQL may already hoist a row-independent stable policy predicate into a one-time filter on some real query shapes; therefore the generated-row FILTER benchmark cannot establish that the actual policy incurs the measured per-row helper cost. Inspect actual policy plans before claiming that saving.

The four policy families require different rewrites:
1. Public-admin (46): confirmed stable public.has_role(uuid, public.app_role), no row inputs; candidate wraps the entire helper call.
2. Owner-uid (17): only identity is constant; user_id remains a per-row comparison. Candidate user_id = (SELECT auth.uid()). Never wrap the entire row comparison.
3. App-access (4): public.has_app_access(uuid, public.app_name) is STABLE SECURITY DEFINER and checks public.app_access. Candidate wraps its entire fixed-user/fixed-app call after privilege and dependency qualification.
4. JWT-packaging (2): app.has_role and app.has_any_role use a different app role system, with transitive profile/JWT dependencies. The existing email exception and OR logic must stay intact. Qualify all transitive dependencies first; wrap each independently constant role predicate and auth.jwt() call. Do not blanket-wrap a boolean tree and risk eager evaluation/errors without equivalence proof.

Qualifying a call requires stable request inputs, no referenced row fields, no intentional per-row side effects, unchanged function overload/OID and effective privileges, and statement-scoped rather than cross-request caching. PostgreSQL volatility declarations are evidence, not sufficient proof by themselves.

## 7. Rejected approaches and failures

- UID-only SELECT as the universal fix: measured only 7.3% improvement for assets and leaves helper lookup cost; use the widest proven request-constant permission call instead.
- Wrapping every whole policy: invalid for owner predicates because row ownership must remain row-dependent.
- Regex replacement of SQL strings: nested SELECTs, casts, named arguments, quoted names, comments and existing wrappers can be misclassified. Use an explicit reviewed per-policy mapping, not a broad text rewrite.
- Drop/recreate policies to tune them: risks roles/commands, policy OIDs, restrictive flags, dependencies or implicit WITH CHECK inheritance. Prefer ALTER POLICY changing only existing expressions.
- Testing as postgres/service_role only: bypasses RLS; expression truth tests cannot prove client permissions.
- EXPLAIN ANALYZE of production INSERT/UPDATE, even under rollback: executes writes and triggers; use preview fixtures for DML timing.
- Disabling RLS, removing policies/helpers, changing helper volatility or suppressing advisor warnings: reduces or misstates the capability.
- Editing bootstrap/applied migrations, manual production db push, broad include-all, credential exposure: forbidden and unnecessary.
- Earlier investigation's task-class guesses “read-only” were rejected as unknown; shared-db was valid. Planning work uses prose. Do not copy the invalid guesses.
- Scratch-only evidence: temporary reports can disappear, so the inventory, methodology and raw timing values are preserved in the tracked baseline.

## 8. Decisions — October 18, 2026 EDT

LOCKED: preserve access exactly; cover the entire baseline; forward migrations only; classify by family; prefer complete request-constant helper SELECTs where proven; owner comparisons retain row evaluation; do not modify helper bodies, grants or role definitions; production stays on the existing guarded lane; one independent exact-head review; keep #4421 open through live proof and #2326 open for its remaining work.

OPEN technical judgments, owned by implementer: one atomic migration versus several family batches, based on exact-object collisions, rehearsal duration, all-or-nothing rollback and review size. Default one explicit ALTER POLICY migration when all objects are available; if a claimed object is busy, progress on independent families using separately admitted scopes and keep every remaining baseline entry accounted for on #4421. Multi-source promotion must use the current supported lane and cannot be improvised. Expand test fixture helpers only if existing harness cannot represent actual policies. Timing thresholds are measured evidence gates below, not business SLAs. No business decision is needed.

## 9. Ordered execution

### Phase A — qualify the exact change

**Step 1 — refresh inventory and take custody.**
Read AGENTS.md; docs/agents/current-workflow.md; docs/agents/anti-collision-summary.md; docs/agents/in-flight-check.md; docs/agents/worktrees-and-handoffs.md; docs/agents/active-contracts-and-plans.md for this active plan; and docs/agents/merge-protocol.md. Refresh current upstream, #4421, #2326, open PRs and exact-object claims. Start ai-task-gates with shared-db class before structural work. Planning prose intent does not authorize migration work.

Create docs/verification/rls-initplan/<new-UTC-key>/manifest.md and before-catalog evidence. Include all baseline policy identities, family, current qual/with_check privately where sensitive, public fingerprint, roles, cmd, permissive, table RLS flags, grants, function OIDs/definitions/volatility, dependencies, existing unflagged overlapping policies and affected consumers. Classify fixed/removed/eligible/blocked separately; no silent omissions.

Normalize #4421 to the current structural issue format and db-work admission with exact writes before claim; do not inherit #2326's repo-maintenance route. Declare SHARED_DB_AUTHOR_ENGINE=codex and valid SHARED_DB_SESSION_ID. Use scripts/manage-migration-author-lanes.mjs admission/claim/version reservation as documented in anti-collision-summary; claim policy/table objects at the tool's required granularity and read dependencies. A fingerprint alone is not custody. Publish generation-keyed .agent/work/4421/<generation>/contract.json through the current contract tool before edits. Re-read tool options from current source/runbook rather than using fabricated flags.

Gate: every baseline row has a disposition; every planned ALTER is covered by current admitted exact-object writes, a leased claim and new reserved version. Any overlapping live owner stays protected. No predecessor authority is reused.

**Step 2 — establish real before-tests and benchmarks.** Depends on Step 1.
Add planned test targets supabase/tests/rls_initplan_equivalence_contracts.sql and supabase/tests/rls_initplan_catalog_contracts.sql, using rolled-back synthetic fixtures in local/isolated test PostgreSQL with the repository bootstrap. Use production policy definitions as baseline, not an idealized clone. Take before snapshots of row identities/result sets and exact SQLSTATEs under SET LOCAL ROLE authenticated and anon; transaction-local request claims must be reset between cases. Exercise actual table policies, not just helper expressions. Prove current_user and table owner/BYPASSRLS status before tests; never disable RLS to make fixtures pass.

Before shared-preview fixture writes, acquire current preview lease, prove target and run ai-task-gates check --before database. Seed only synthetic minimal rows, in a rolled-back transaction or explicit tagged cleanup path. Record unavoidable trigger side effects/external integration limits; never invoke real external jobs. Populate both owner and other-user rows and relevant helper-role/app-access rows. Evaluate actual OR-union of all applicable policies; do not incorrectly expect one restrictive policy to override another permissive allow.

Extend the baseline method to each family, small and large batches: 1, 100, 10,000 rows, ten alternating before/after runs after warmup, median and p95, raw plans/buffers/counts, identical role/context/cardinality/settings. Preview real INSERT/UPDATE/DELETE timing may execute only rolled-back synthetic fixtures. Separate auth-only, helper, actual policy and API/client timing. Capture plans under authenticated, avoiding service-role bypass. Production timing is bounded read-only.

Gate: named tests below establish meaningful positive/negative baseline and each family's actual query path is reproducible; no timing claim lacks a raw plan artifact.

Natural context cut after Step 2 if needed: use fresh-session skill, update STATUS/current-state, then re-read all downstream phases before proceeding.

### Phase B — make and prove the minimal rewrite

**Step 3 — author forward ALTER POLICY migration(s).** Depends on Steps 1–2.
Target supabase/migrations/<reserved-version>_rls_request_constant_checks.sql (or reserved family suffixes if split); exact filenames come from the lane reservation, never invent a timestamp. Include derived-from header as required, selecting real dependencies from fresh ledger/migration evidence; pre-ledger bootstrap is not a migration ancestry. Use -- derived-from: none only when genuinely supported. Include transaction/fail-closed preconditions for expected target policies, semantics and helper identity. A missing/drifted policy must raise a clear failure, not silently skip.

Use explicit schema-qualified ALTER POLICY statements and exact quoted policy names from manifest. For existing quals rewrite USING only; for existing explicit checks rewrite WITH CHECK only, or both where both exist. Preserve null WITH CHECK as null (its command-dependent inheritance), cmd, roles, permissive, names, OIDs, grants, flags and overlap. Do not accidentally materialize an inherited check. Fully qualify public versus app enum overloads. Public admin example: WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role))). App-access example: USING ((SELECT public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name))). Owner example: USING (user_id = (SELECT auth.uid())). Packaging retains exact email literal/case handling/null behavior; only approved stable subexpressions gain scalar SELECTs, including separately qualified app role helpers.

If a dependency turns out row-dependent/volatile, leave that part row-dependent and wrap only proven request-constant auth inputs; demonstrate its behavior/remaining helper cost honestly. Do not broaden scope to fix the helper. Any unresolved targeted warning stays open with evidence and named implementation owner.

Gate: catalog diff changes only approved expression trees; all 69 dispositions accounted for; before/after access results and SQLSTATEs match; correlated ownership remains correct; actual plans show one initialization execution per wrapped stable expression. Run bash scripts/check-sql.sh and focused contract runner. Save rollback exact prior expressions and metadata in approved protected evidence, and prepare a new-forward restoration recipe before shared apply.

**Step 4 — preview rehearsal, app checks and independent review.** Depends on Step 3.
Read docs/development.md, docs/deployment.md and docs/production-promotion-procedure.md. Use supported isolated rehearsal/preparation then exclusive shared-preview lane, current target variable, clean exact dry-run, and bounded intended apply only. Re-prove target before every write. Run full focused catalog/access/performance suite against preview and applicable existing database-contract CI. Test consumer read/create/update flows on synthetic preview fixtures for DAM assets, style-guide access, own saved views/devices/checkouts, admin-managed configuration/queues, and shared packaging dropdown/manager writes. Resolve actual caller mapping during Step 1; do not assume every table is an active browser feature.

Complete generation-keyed completion evidence. Obtain allocator-assigned independent reviewer with author-engine exclusion after ai-task-gates check --before review. One durable exact-head APPROVE is required; no same-engine substitute or manually fabricated receipt. Fix/retest findings and re-pin if content changes.

Gate: preview grants/role/deny matrix matches baseline, policy warnings resolved for qualified entries, raw before/after plans support improvement, all affected consumers retain intended preview behavior, exact-head review and required checks pass. A global warning total may change from unrelated work; compare targeted policy identities.

### Phase C — land and verify the live outcome

**Step 5 — guarded merge and governed production apply.** Depends on Step 4.
Check ai-task-gates before pr-wait/ship and use bin/ai-pr-wait <pr> --timeout-minutes N for bounded check waiting. Follow guarded-migration-merge workflow and current merge/production interlock. AI merges when gates pass; never push main or use admin bypass. Link exactly the admitted structural issue per source PR; don't let #2326 appear as a second structural apply issue.

After merge, ai-task-gates check --before shared-db-promotion gates launching the approved merged-main preview workflow. The existing qualified workflow owns bounded production dispatch and re-proves immutable evidence, exact target, current main, derivation, dry-run, lock and post-apply ledger/catalog. Use its current freeze/lease mechanism. Do not dispatch a handcrafted production workflow or hand-apply SQL. A refusal remains a refusal; repair evidence through the supported route.

Gate: exact intended migration bytes/versions appear in production ledger, production catalog matches approved expression-only change, and immutable run evidence exists. Source merge alone cannot mark this step done.

**Step 6 — production live proof and consumer acceptance.** Depends on Step 5.
Immediately rescan pg_policies, metadata and advisor target identities; qualify advisor freshness and any delayed dashboard refresh with catalog proof. Compare every baseline disposition. Re-run bounded SELECT-only production benchmarks with real representative authenticated plans for ownership and app-access read paths; generated-row helper measurements are supplementary. Confirm statement-scoped InitPlan loops rather than per-row helper evaluation where intended. Never run EXPLAIN ANALYZE writes on production.

Run existing authorized live consumer smoke paths using current account/test-data contracts; production create/update proof may use only the owning app's approved disposable test route, not ad-hoc SQL fixtures. If no safe live write path exists, record write behavior as preview-proven and production write acceptance UNKNOWN on #4421; do not close. Read-only production role/metadata checks alone cannot claim live INSERT acceptance. No contact with people is authorized.

Performance acceptance: for originally repetitive stable helpers, demonstrate one call/InitPlan per statement and lower repeated-run median at scale; for owner predicates preserve indexed/filter shape and avoid regressions. Flag >10% repeatable median regression on the same actual workload, or any statistically noisy/inconsistent benefit; investigate plans before promotion where possible and before closure always. The 97.2% microbenchmark figure is not a required app latency gain. Report absolute milliseconds alongside percentages and p95, and explain workload differences in the artifact.

Gate: no unresolved in-scope unnecessary per-row auth calls, all equivalent allow/deny tests passed, safe live consumer operations confirmed, no repeatable workload regression, targeted advisor findings cleared or proven false positives individually with reviewed rationale. Missing access or delayed live proof stays on this issue with named owner.

**Step 7 — reconcile and close only the proved slice.** Depends on Step 6.
Update this STATUS table, §5, docs/verification/rls-initplan/<key>/acceptance.md and parent program Step 6's scoped progress, with immutable migration commit/run/ledger/catalog/test links. Do not mark all broader Step 6 or #2326 done. Close #4421 only under repository closure authority and after its entire live checklist passes. Remove this handoff when all obligations are fulfilled; retain completed plan/evidence as history and remove obsolete router links when retiring files. Commit/push/CI/merge any documentation closeout. If stopped externally, create/update only own handoff and exact same issue with blocker, last verified activity in EDT and next action; no leftover-proof ticket.

Gate: every requested baseline entry has an evidenced outcome; no source/preview/production/acceptance stage is conflated; no unfinished duty is lost.

### Adversarial cases — required trust-boundary tests

| External input / boundary | Hostile or edge case | Named test |
|---|---|---|
| Auth claims | Missing subject/null claims, anonymous role, malformed UUID claim | missing_and_malformed_subject_equivalence |
| Authenticated identity | Ordinary user without admin role tries admin read/write | admin_denies_unassigned_user |
| Owner row input | Own row vs another user's ID; UPDATE changes owner to another user | owner_cross_user_and_reassignment |
| INSERT data | Forged owner_id/user_id in batch with mixed ownership | mixed_batch_owner_checks |
| Permission tables | Role/app access granted then revoked between statements | revocation_visible_next_statement |
| Pooled request context | Admin then non-admin on same connection | no_cross_request_permission_cache |
| JWT packaging exception | Missing/empty/mixed-case email, nonallowlisted email, exact allowlist match | packaging_email_equivalence |
| App roles | Each permitted role, revoked role, JWT role branch, no role | packaging_role_union_equivalence |
| App access | styleguides grant present/absent/revoked; unrelated app grant | styleguide_app_isolation |
| Policy composition | Another permissive policy allows row; restrictive policy denies | policy_union_and_restrictive_intersection |
| SQL/catalog drift | Policy missing or fingerprint/roles/command changed before apply | migration_refuses_policy_drift |
| Query inputs | NULL owner, empty batch, multi-row batch, repeated prepared execution | null_empty_and_prepared_equivalence |
| Role boundary | anon/authenticated vs owner/service-role bypass; misleading elevated test | enforced_role_and_bypass_detection |
| Exceptions/short circuit | Malformed JWT same error or branch short-circuit before/after | error_and_short_circuit_equivalence |

Malformed claim behavior must match the existing error, not invent a new “deny” if baseline raises. A revoked app-role row may still be allowed by the existing JWT role branch; preserve that existing OR contract rather than silently hardening it.

## 10. Tests required

Planned SQL files:
- supabase/tests/rls_initplan_catalog_contracts.sql: manifest coverage, metadata_unchanged, implicit_with_check_preserved, helper_oids_unchanged, stable_subqueries_present, row_predicates_remain_correlated, migration_refuses_policy_drift.
- supabase/tests/rls_initplan_equivalence_contracts.sql: every named adversarial test above plus positive admin insert/update, all 69 policies' applicable command/role combinations, own-row read/update/delete, app-access allowed reads, packaging manager writes and allowed-role reads.
- docs/verification/rls-initplan/<key>/performance.md: raw plans and samples for all four families, actual preview DML and production read-only paths, small/large batch and all claimed before/after comparisons.

Use the repository's current database-contract-tests.yml invocation and bootstrap as the authoritative SQL runner; inspect it before running. A plain psql execution of transaction/DO-based contracts with ON_ERROR_STOP=1 is valid where that runner supports it; do not assume these scripts are pgTAP. Existing checks: bash scripts/check-sql.sh; node --test scripts/check-sql.test.mjs; node --test scripts/check-handoff-contract.test.mjs when handoff touched; the normal database-contract workflow and required migration PR guards. Add no unrelated broad benchmark framework or brittle wall-time CI assertion. A green catalog-only test cannot replace role-enforced SQL/consumer proof.

For preview role fixtures, record touched rows and cleanup. Pre/post snapshots compare complete applicable policies, not only changed ones. Timing is not a security test.

## 11. Constraints and gotchas

Read the repository rulebook before execution; current rules supersede stale historical orchestrator/two-review/manual-promotion text. Structural route is claim-first, one independent assigned review, new reserved migration version, isolated current-upstream worktree, immutable contracts, exact-object collision controls, exclusive preview/merge/production mutation lanes, fresh target proof before every write, existing promotion workflow only. Database writes themselves do not need a second AI; independent migration/merge/promotion gates remain.

Preview and production differ both ways; never assume parity. Historical empty markers/bootstrap are not a replay baseline. MCP may be production-bound and cannot be switched by query parameter. Do not print credentials, JWTs, user IDs or licensed data in public evidence. Preserve existing role hierarchy, visibility, owner predicates, email exception and implicit check behavior. Do not disable the capability, weaken guards, or call warning suppression a repair. Sign GitHub posts with the actual Codex chat ID and machine. User-facing times use America/New_York with EST/EDT.

No UI redesign is planned; consumer smoke checks still need observed behavior. Any unexpected security exposure is separately tracked/routed without silently changing permissions in this performance fix. Do not contact anyone on Albert's behalf.

## 12. Access and environment

At planning time Supabase MCP get_project_url, execute_sql and get_advisors read access worked against production; gh read/write worked for popcre/shared-db. Future authentication and write permissions must be re-verified; preview and production promotion access are NOT proved by these reads.

Secrets: 1Password vault vibe_coding; use secrets-to-1password skill before secret handling and serialize access. CLI token item “Supabase CLI Personal Access Token”; production password item “Supabase DB Password - shared POP database”; resolve preview password by the current documented item ID in docs/agents/runbooks-credentials-cli-and-gotchas.md, never guess a name. No credential values belong here. Get current safe consumer test accounts from their application rules and approved 1Password references; this plan does not invent a universal test login.

Required tools: installed ai-task-gates, gh, repository Node/Python/Bash, current Supabase CLI or documented pg runner; Docker only if the current local database-contract setup requires it. Read docs/development.md for actual commands and docs/configuration.md / credential runbook for current target/secret names. There is no local app server to start here. If a platform access limit cannot be repaired via supported authentication, stop the affected gate with owner/evidence/next supported action; never ask Albert to run commands or approve technical work.

## 13. Definition of done, risks and open questions

- [ ] Every baseline policy and any admitted new matching policy has an explicit evidenced disposition.
- [ ] Forward migrations/tests committed, pushed, independently reviewed, required CI passed and guarded merge verified by exact commit.
- [ ] Preview role/command/negative/positive/error tests and cleanup pass; permissions/metadata unchanged.
- [ ] Production apply verified by bounded workflow run, ledger and approved catalog fingerprint.
- [ ] Production live read and safe live app write proof complete; targeted advisor findings gone or individually explained false positives.
- [ ] Representative repeated performance plans show less constant helper work with no repeatable >10% actual workload regression; absolute timings and limits recorded.
- [ ] Consumers retain allowed actions and forbidden access remains forbidden; no production fixture SQL, secret or licensed-data disclosure.
- [ ] Same issue live checklist complete; broader #2326 unchanged except scoped evidence link; current STATUS, acceptance evidence and handoff retirement committed/pushed/merged.

Main risks: changed RLS OR/check behavior, caller privileges or helper overload changes, eager exception evaluation, stale preview, lost implicit checks, prepared-query cross-request assumptions, noisy benchmark conclusions, concurrent policy drift, and a global advisor count hiding unrelated changes. The specified metadata/role/error/plan tests guard each.

Rollback: capture exact prior policy expressions and metadata before any apply. Rehearse restoration on preview using a new reserved forward migration through the same claims/review/merge/promotion path. Never edit/re-run an applied version, disable RLS, or hand-apply production SQL. Restoring only the intended expression delta keeps grants/role contracts intact. If production behavior regresses, keep #4421 open, name the affected consumer and preserve proof; repair or restore through the governed lane.

Open technical facts resolved by Steps 1–2, not Albert: all helper transitive volatility/privileges, preview parity, actual consumer ownership/use, current collisions, and permission-safe real-write acceptance route. None is silently assumed. Business questions: none; preserving today's behavior is settled. If a proposed optimization requires changing who may do something, exclude it from this repair and seek a separately scoped business decision.

## Final self-audit

All checklist items pass for a planning deliverable:
- All 13 sections exist; §1 states the business goal and conflict rule.
- §§2–6 define system, trigger, full inventory, evidence, code anchors and current untouched implementation state; no planning chat or scratch file is required.
- §§7–8 retain rejected methods, failed class guesses, benchmark limits and locked/open choices.
- §9 names concrete target files, ordered dependencies, custody, verification gates, cut points and an adversarial table with named tests for every external boundary.
- §§10–12 specify tests, constraints, supported tools/secret locations and access unknowns without publishing values.
- §13 requires commit/push/CI/merge/apply/live proof, rollback and same-issue closure.
- The relative handoff backlink above and handoff's relative plan link are present; AGENTS router and parent topic plan link here. Root HANDOFF.md is unchanged.
- No skill workflow needs changing for this scoped repair and no memory entry is written without explicit authorization.

1. Could a brand-new session execute without asking Albert? **Yes:** §§2–5 orient it, §§8–12 give criteria, commands/current authoritative runners, access paths, fixtures, dependencies and gates. Future live drift is handled explicitly in Step 1 rather than guessed.
2. Does this carry the background, nuance and rejected reasoning? **Yes:** §§3,5–8 and the baseline retain the original warning, all 69 identities, exact measured samples, elevated-expression limitations, weaker rewrite result, role-system distinction and rejected unsafe shortcuts.
3. Is the ultimate goal enough to steer correct judgment if reality differs? **Yes:** §1 requires equal access and less database work; §§4,8,9,13 bound scope, preserve unresolved findings and require measured production/consumer acceptance rather than a quiet dashboard.

Self-audit passed October 18, 2026 EDT. Review/publication evidence is tracked on #4421; this audit is not an independent migration review or evidence that implementation is complete.
