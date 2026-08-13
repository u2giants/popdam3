# Warner STARLABS normalized source schema plan

Status date: 2026-08-13

Workstream: GitHub issue #925

Production project: `qsllyeztdwjgirsysgai`

Preview project: `rjyboqwcdzcocqgmsyel`

Handoff: [`../HANDOFF.d/2026-08-13T1829Z-al8960ofc-codex-wb-scrape-schema-change.md`](../HANDOFF.d/2026-08-13T1829Z-al8960ofc-codex-wb-scrape-schema-change.md)

This plan contains structure and object names only. It contains no licensed Warner row values.

## STATUS

| Phase | State | Evidence or blocker |
|---|---|---|
| 1. Evidence and plan | COMPLETE | Repository, consumer, ledger, and production catalog checks completed read-only on 2026-08-13. |
| 2. Additive migration | COMPLETE ON BRANCH | Claim #928 holds versions `20260813230000` and `20260813231000`; collision gate and static SQL checks passed. |
| 3. Synthetic tests | COMPLETE ON BRANCH | Catalog, identity, namespace, FK action, loader inventory, routing, grants, and Node stream tests use invented values only. |
| 4. Preview rehearsal | NOT STARTED | Requires reviewed migration and an exclusive preview lane. |
| 5. Pull request and approval package | IN PROGRESS | Implementation branch is ready for CI and independent review; preview remains a separate bounded gate. |
| 6. Production promotion | BLOCKED BY OWNER | Albert must approve the exact migration after preview and PR checks pass. |
| 7. Legacy retirement | OUT OF SCOPE | No legacy Warner object is dropped in this workstream. |

## Goal and fixed rules

The current landing shape mixes Franchise and Property identities. It also mixes their asset links. The replacement keeps Warner source truth separate and traceable:

- Franchise, Property, Character, Style Guide, and Asset are separate identities.
- A real source ID, with its source namespace, controls identity. A label is observed data and may change.
- The same label with different real source IDs remains separate.
- Missing IDs use an explicit exact natural-key fallback. Empty text is not an ID.
- Asset relationships use separate link tables with foreign keys.
- Direct Property-to-Character evidence comes only from the Product catalogue.
- Franchise-to-Property evidence remains empty unless Warner directly supplies both endpoints in one relationship.
- Asset co-occurrence never invents a direct Franchise-to-Property relationship.
- Landing a source relationship never requires a prior `core.*` match.
- Applied migrations remain unchanged. The first change is additive.
- No private source rows, licensed labels, file names, or paths belong in this public repository.

## Phase 1 evidence

### Repository and production migration state

`origin/main` was `e04676719dec25396204b071d21e14b30dbcf674` when this audit began. Its maximum migration was `20260813200000`. PR #924 was the only open pull request and owns the migration writer lane.

The production ledger has 439 applied versions while main has 442 migration versions. All Warner migrations on main are applied. The only drift is unrelated:

- `20260729120000`: retired and must never be applied.
- `20260802170000` and `20260802171000`: deliberately held as one FR bundle.

The Warner structure is defined or hardened by these immutable migrations:

- `20260810030000_warner_starlabs_source_landing.sql`
- `20260810110000_warner_grants_rls_and_dam_order_list_invoker.sql`
- `20260810120000_wb_correct_read_claim_and_revoke_service_role_insert.sql`
- `20260810130000_wb_chunked_capture_protocol.sql`
- `20260810180000_plm_default_privilege_hole_and_pg17_maintain_revokes.sql`

The two later DCP migrations mention Warner only as a comparison. They do not change Warner objects.

### Live production catalog

Each database call was preceded immediately by proof of project ref `qsllyeztdwjgirsysgai`. Calls used the Management API in read-only mode. No row values were selected.

All nine live Warner tables contain zero rows:

| Table | Rows | RLS |
|---|---:|---|
| `plm.wb_capture` | 0 | enabled |
| `plm.wb_franchise_property` | 0 | enabled |
| `plm.wb_style_guide` | 0 | enabled |
| `plm.wb_character` | 0 | enabled |
| `plm.wb_asset` | 0 | enabled |
| `plm.wb_asset_style_guide` | 0 | enabled |
| `plm.wb_asset_franchise_property` | 0 | enabled |
| `plm.wb_asset_character` | 0 | enabled |
| `plm.wb_property_character` | 0 | enabled |

Catalog totals are 131 columns, 37 constraints, 1 foreign key, 24 indexes, 9 read policies, 0 user triggers, 21 Warner functions, and 2 API views.

Important live facts:

- The sole foreign key is `wb_property_character_property_id_fkey`, from the old source relationship to curated `core.property`.
- The four existing source relationship tables do not have foreign keys to Warner landing identities.
- `wb_franchise_property` uses `(source_term, source_id, label)` as its key.
- `wb_character` uses `(source_term, source_id, label)` as its key.
- `wb_style_guide.source_id` is required and constrained to the empty string. Its natural key is the primary key.
- `wb_asset_style_guide.style_guide_source_id` is also required.
- The eight original landing tables and `wb_capture` each have one read policy.
- Direct table grants are read-only for `authenticated` and `service_role`; writes are through controlled functions. The two API views grant read to `authenticated` and full access to `service_role`.
- The 21 functions are eight `plm.sync_wb_*` loaders, eight public wrappers, four capture functions, and `plm.wb_loader_privilege_ok`.
- The API views are `api.wb_property_character` and `api.wb_property_reconciliation`.

### Dependency audit

Clean searches excluded `.git`, packages, builds, worktrees, and mirrored `shared-db/` folders. PopCRM, PopDAM, PopPIM, both local DesignFlow trees, Ansible, infrastructure, and ai-devops contain no active reference to the Warner objects.

| Repository | File and line | Use | Fields or objects used | Current meaning | Replacement candidate | Cutover | Risk if missed |
|---|---|---|---|---|---|---|---|
| shared-db | `tools/sync-warner-starlabs.mjs:150-213` | write through RPC | all eight old stream names | runtime private-file loader routing | add five split/new streams and route normalized loaders | Phase 2-3 | new schema could exist but remain unloadable |
| shared-db | `tools/sync-warner-starlabs.mjs:744-793` | write through RPC | begin, chunk, finalize, fail capture calls | guarded chunk protocol | keep protocol, expand allowed targets | Phase 2-3 | partial or untracked loads |
| shared-db | `tools/sync-warner-starlabs.test.mjs:125-132` | test | old eight stream names | loader contract test | synthetic normalized stream contract | Phase 3 | wrong stream routing could pass CI |
| shared-db | `scripts/post_batch_app_verification.py:1032-1039` | read/catalog check | old eight tables | post-change verification inventory | add normalized objects and retain legacy checks | Phase 2-3 | verification could miss a broken new object |
| shared-db | `scripts/test_production_catalog_verification.py:480` | test | `plm.sync_wb_character` | expected production function inventory | extend only if the production verifier is meant to cover new functions | Phase 3 | catalog contract becomes incomplete |
| shared-db | five Warner migrations listed above | schema history | tables, functions, views, grants, policies | applied immutable history | no edit; supersede additively | never | editing history breaks ledger integrity |
| shared-db | Warner schema and loader documentation | read | old combined model | operator guidance | update after migration contract is final | Phase 2-3 | operators may load the wrong streams |
| consumer apps and operations repos | repository-wide clean search | none | none | no active consumer | no app cutover required now | verify again before preview | a future reference added after this audit could be missed |
| production catalog | 9 tables, 21 functions, 2 views | live runtime | old combined identity/link contract | applied but empty source landing | additive normalized contract | Phase 4-6 | changing only SQL on main would not change live behavior |

There are no unexplained active code references. Historical migrations and documentation are explained dependencies, not active app readers.

## Target object model

### Locked physical contract (approved 2026-08-13)

All nine legacy Warner tables and all legacy functions remain unchanged. The two combined legacy tables receive deprecation comments only. The normalized physical tables and capture target strings are exactly:

`wb_franchise`, `wb_property`, `wb_character_normalized`, `wb_style_guide_normalized`, `wb_asset_normalized`, `wb_asset_franchise`, `wb_asset_property`, `wb_asset_character_normalized`, `wb_asset_style_guide_normalized`, `wb_property_character_normalized`, and `wb_franchise_property_evidence`.

Those strings must match byte-for-byte in table names, capture validation, database loaders, public wrappers, and Node `STREAMS`. Legacy targets route only to legacy loaders.

Every normalized identity uses a nonblank namespace and exactly one of a nonblank source ID or an exact nonblank fallback key. `identity_method` must agree with that choice. Partial unique indexes enforce namespace plus source ID or namespace plus fallback key. Labels never participate in identity. Property namespace is restricted to `warner_product_catalogue` or `warner_art_assets`. Assets require a real source ID and have no fallback.

All normalized relationship and capture/evidence foreign keys use `ON DELETE RESTRICT`. Tests inspect both endpoint type and delete action.

The 2026-08-13 implementation ruling clarifies capture compatibility: the existing `wb_capture` target check and the definitions of `plm.begin_wb_capture` and `plm.finalize_wb_capture` may be extended in place. All eight legacy target strings and routes must retain their existing behavior. Each of the 11 normalized targets must be accepted and route exactly once. No second capture table or protocol may be created.

The migration author must confirm naming with the collision gate, then create these normalized objects:

| Object | One-row meaning | Required identity and links |
|---|---|---|
| `plm.wb_franchise` | one Warner Franchise source identity | UUID key; nullable source ID; namespace; exact label; identity method; exact fallback key when needed; source/capture/audit fields |
| `plm.wb_property` | one Warner Property source identity | same identity pattern; source context or namespace must distinguish Product and Art Asset IDs if required |
| `plm.wb_character` | one Warner Character source identity | additive repair or normalized successor so labels are not keys; nullable source ID and marked fallback |
| `plm.wb_style_guide` | one Warner Style Guide source identity | nullable source ID; required exact natural key only when ID is absent; never empty-string ID |
| `plm.wb_asset` | one Warner/Nuxeo asset identity | stable asset source ID; exact metadata; capture and audit fields; label arrays only as evidence |
| `plm.wb_asset_franchise` | one direct Asset-to-Franchise source relationship | foreign keys to Asset and Franchise; unique endpoint pair; evidence and audit fields |
| `plm.wb_asset_property` | one direct Asset-to-Property source relationship | foreign keys to Asset and Property; unique endpoint pair; evidence and audit fields |
| `plm.wb_asset_character` | one direct Asset-to-Character source relationship | normalized endpoint foreign keys; unique endpoint pair |
| `plm.wb_asset_style_guide` | one direct Asset-to-Style-Guide source relationship | normalized endpoint foreign keys; supports natural-key fallback identity |
| `plm.wb_property_character` | one direct Product-catalogue Property-to-Character relationship | normalized endpoint foreign keys; original IDs/labels as evidence; nullable later `core.property` reconciliation |
| `plm.wb_franchise_property_evidence` | one directly supplied Franchise-to-Property relationship | both endpoint foreign keys; unique endpoints plus direct evidence source; never asset-derived |
| `plm.wb_capture` | one header or chunk in a guarded capture | preserve provenance and add distinct target names for every normalized stream |

Because five existing normalized-name tables already exist but have the wrong keys, the migration author must use an additive transition pattern. Do not drop or rename them in place. Preferred pattern: add stable UUID identity columns and nullable source-ID/fallback fields where constraints can be changed safely while tables are empty, create new split tables, add new foreign-key columns to old-name link tables, and preserve the old columns during transition. If PostgreSQL dependency analysis shows that cannot be done without breaking the current functions/views, create explicit `_v2` successors and document the later rename. The final choice must be proven in preview before it is accepted.

## Exact proposed write set

Phase 2 is expected to write only these object families:

- Tables: the 12 target objects above, including alterations to existing Warner tables only where the additive transition requires them.
- Constraints and indexes belonging only to those Warner tables.
- RLS policies and grants on only those Warner tables.
- `plm.sync_wb_*` normalized loaders and required public wrappers.
- `plm.begin_wb_capture`, `plm.load_wb_chunk`, `plm.finalize_wb_capture`, and `plm.fail_wb_capture` only to add normalized target streams.
- `api.wb_property_character` and `api.wb_property_reconciliation` only if their definitions must follow the normalized endpoints.
- Deprecation comments on `plm.wb_franchise_property`, `plm.wb_asset_franchise_property`, and their old loaders.
- `tools/sync-warner-starlabs.mjs`, its focused tests, production catalog verification lists, and directly relevant Warner docs.

No `core.*` table, unrelated `plm.*` object, app repository, private source row, or production object is in scope.

## Migration allocation

Do not reserve timestamps while PR #924 owns the writer lane. After it merges:

1. Fetch `origin/main`; recheck open PRs, claims, worktrees, and the maximum migration.
2. Run the collision gate with the complete write set above. Exit 1 or 2 stops the work.
3. Allocate consecutive unique versions above the then-current maximum:
   - Migration A: additive identities, relationship tables, columns, keys, indexes, RLS, and grants.
   - Migration B: normalized loaders, capture target routing, API view adjustments, and deprecation comments.
4. Keep synthetic tests in public test files, not SQL seed rows.
5. If A and B cannot be independently valid, combine them in one transaction rather than expose a half-contract.

## Verification gates

### Phase 2: additive SQL

- Old objects still exist and no old table is dropped.
- Franchise and Property are separate tables.
- Asset-to-Franchise and Asset-to-Property are separate tables.
- Every normalized link has foreign keys to the correct endpoint types.
- Real IDs are unique by namespace; labels are not identity keys.
- Missing-ID fallback is explicit, exact, and never an empty ID.
- Functions have fixed search paths, narrow execution grants, and safe errors.
- Required repository SQL and collision checks exit zero.

### Phase 3: public synthetic tests

Tests must prove real-ID label changes do not duplicate identity; equal labels with different IDs remain separate; missing-ID fallback works; empty IDs are rejected or converted to NULL; every link rejects a missing/wrong endpoint; no asset co-occurrence creates direct Franchise-to-Property evidence; only direct Product evidence creates Property-to-Character links; repeated import is a no-op; shrink guards and capture checks fail closed; errors expose no source values; and legacy objects remain present.

### Phase 4: preview

- Obtain the exclusive preview lane.
- Prove ref `rjyboqwcdzcocqgmsyel` immediately before every write.
- Show that only the intended Warner migrations are pending. Stop on unrelated pending work.
- Apply the bounded migration set, load synthetic data only, run the loaders twice, test failures and rollback, and inspect catalog/grants/policies.
- Confirm zero legacy drops and zero licensed rows in logs.

### Phase 5: PR and approval package

- PR diff contains only the approved migration, loader/tests, and directly relevant docs.
- CI and preview checks are green at the exact head.
- Package names exact migrations, objects created/altered, zero dropped objects, row-count-only production baseline, preview proof, rollback, risks, and the exact bounded production workflow.
- Ask Albert one yes-or-no question for the exact production action.

### Phase 6: production

Production remains forbidden until Albert approves the exact migration after Phase 5. After approval, prove `qsllyeztdwjgirsysgai` immediately before each write, apply only the approved versions, verify ledger and catalog read-only, and report exact live definitions. Do not load Warner source data as part of schema promotion.

## Rejected approaches

- Keep adding types to `wb_franchise_property`.
- Keep one combined asset link with a type column as the final model.
- Use labels in stable primary keys.
- Treat equal labels as equal identities.
- Represent missing IDs as empty strings or copy a natural key into an ID.
- Infer Franchise-to-Property from asset co-occurrence.
- Require a curated Master Data match before source landing.
- Put licensed examples in migrations or tests.
- Edit an applied migration.
- Drop legacy objects in the first migration.
- Use a broad production `db push` that includes unrelated migrations.

## Phase 1 self-audit

1. Can a new developer continue without questions? **Yes.** The target, current state, dependencies, write set, blockers, and gates are explicit.
2. Is the evidence reconciled across main and production? **Yes.** Warner ledger state and live catalog were checked independently.
3. Are active dependencies explained? **Yes.** Shared-db references are classified and consumer searches are clean.
4. Are next steps concrete and verifiable? **Yes.** Each phase has a stop condition and proof gate.
5. Are confidentiality and production limits explicit? **Yes.** No licensed values are present, and production requires later exact approval.
