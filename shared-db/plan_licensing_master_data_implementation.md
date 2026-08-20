# Implementation plan: official licensing Master Data in Supabase

**Plan status:** OPEN

**Settled architecture:** [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md)

**Implementation tracker:** [GitHub #1090](https://github.com/u2giants/shared-db/issues/1090). The architecture is not an issue. #1090 tracks execution only.

**Paired handoff:** [`HANDOFF.d/2026-08-17T0016Z-al8960ofc-codex-licensing-plan-review-fixes.md`](HANDOFF.d/2026-08-17T0016Z-al8960ofc-codex-licensing-plan-review-fixes.md)

**Repository:** `u2giants/shared-db`

**Review revision:** rewritten from merged plan commit `1e7daffd7ac6d1507a76dc8452462bef6f876d0a` on repository base `b262a9fd698b60ab0e455d63b8b97a965eb9bfbb` after GLM 5.3 review and a two-turn Grok 4.6 review. Sections 6.1 and 6.2 record every finding and its disposition. Grok's final verdict was **Ready**.

**Fresh-session starting point:** Phase 0, Step 0.1. Re-read the settled architecture, refresh `origin/main`, audit the current migration ledger and live catalog, then claim the first exact-object migration lane. Do not begin from the older Character/Style Guide or ColdLion plans without applying this plan's supersession rules.

## STATUS

| Step | State | Date | Evidence / next action |
|---|---|---|---|
| 0.1 Reconfirm repository, ledger, live catalog, and object ownership | ⬜ Open | 2026-08-17 | Start here. Produce `docs/verification/licensing-master-data-phase0-<date>/` from the commands in §9. |
| 0.2 Reserve migration lanes and versions | ⬜ Open | 2026-08-17 | After 0.1. Claim exact objects with `scripts/manage-migration-author-lanes.mjs`; never choose versions manually. |
| 1.0 Install a durable licensing write guard and stop every non-authoritative writer | ⬜ Open | 2026-08-19 | Must block DesignFlow and keep ColdLion writes inside the settled Licensor-name, uncovered-Property, and status boundaries. |
| 1.1 Repair Character ownership without losing data | ⬜ Open | 2026-08-17 | Add bridge compatibility first; scalar removal waits for Step 7.2. |
| 1.2 Create canonical Franchise | ⬜ Open | 2026-08-17 | Add canonical entity and aliases with source-scoped identity. |
| 1.3 Replace scalar Style Guide ownership with a bridge | ⬜ Open | 2026-08-17 | Add bridge compatibility first; scalar removal waits for Step 7.2. |
| 1.4 Standardize direct relationship bridges | ⬜ Open | 2026-08-17 | Preserve canonical pair identity and add per-source support tables; Step 2.3 replaces the old axis invariant after the queue exists. |
| 1.5 Extend canonical provenance and Asset freshness | ⬜ Open | 2026-08-17 | Preserve source identity, freshness, and compatibility fields. |
| 2.1 Extend and backfill `plm.source_resolution` | ⬜ Open | 2026-08-17 | Preserve all existing portal decisions and freeze only portal landing-resolution columns. ColdLion `erp_*` stays writable until Step 4.0. |
| 2.2 Add authorized source scope | ⬜ Open | 2026-08-17 | Scope each full portal `source_system` to one authorized Licensor and allowed facts. |
| 2.3 Add relationship-resolution and candidate contracts | ⬜ Open | 2026-08-17 | Latest complete captures only. |
| 2.4 Implement preview/dry-run-first consolidation | ⬜ Open | 2026-08-17 | New scraped Properties must start `potential`, never `active`. |
| 2.5 Add canonical duplicate merge and ownership history | ⬜ Open | 2026-08-17 | Repoint safely, retain aliases/tombstone, audit, and support reversal. |
| 3.0 Prove a complete validated preview capture for each source | ⬜ Open | 2026-08-17 | Includes the first Warner capture before its adapter can run. |
| 3.1 Disney adapter | ⬜ Open | 2026-08-17 | Use authorized OPA and DCP identities and direct relationships. |
| 3.2 NBCU adapter | ⬜ Open | 2026-08-17 | Preserve IP Family terminology and direct links. |
| 3.3 Paramount adapter | ⬜ Open | 2026-08-17 | Keep co-occurrence evidence out of direct bridges. |
| 3.4 Warner adapter | ⬜ Open | 2026-08-17 | Run only after Step 3.0 has a complete Warner preview capture. |
| 3.5 Consolidated preview and performance proof | ⬜ Open | 2026-08-17 | Correctness, idempotency, timing, and lock-budget evidence. |
| 4.0 Build ColdLion-to-canonical Property mapping | ⬜ Open | 2026-08-17 | Reuse existing approved links and add reviewed create-new handling. |
| 4.1 Apply guarded ColdLion authority | ⬜ Open | 2026-08-19 | Apply Licensor names, uncovered ColdLion-only Property truth, and Active/Inactive without overriding scrape-covered Property authority. |
| 4.2 Remove DesignFlow comparison from authority decisions | ⬜ Open | 2026-08-17 | Check `dflow.*`, Cloud SQL, APIs, `plm.import_master_data`, and `plm-sync`. |
| 5.1 Expand DB Data Admin server-side APIs | ⬜ Open | 2026-08-17 | Depends on Phases 1–4 contracts. |
| 5.2 Implement and visually verify DB Data Admin UI | ⬜ Open | 2026-08-17 | Requires role tests and screenshots. |
| 6.1 Add weekly automation in each private source repo | ⬜ Open | 2026-08-17 | Two complete preview cycles plus one injected failure per source. |
| 6.2 Add freshness monitoring and escalation | ⬜ Open | 2026-08-17 | Second consecutive missed weekly deadline disables scope and pages a human. |
| 7.1 Cut every consumer over to canonical APIs | ⬜ Open | 2026-08-17 | No app-repo schema changes. |
| 7.2 Retire compatibility scalar fields and views | ⬜ Open | 2026-08-17 | Separate post-cutover migration after search and live telemetry prove zero readers. |
| 8.1 Assemble the exact bounded production package | ⬜ Open | 2026-08-17 | Separate fresh session, merge freeze, held-version exclusions, immutable evidence. |
| 8.2 Promote structure, curated data, status, and consumers | ⬜ Open | 2026-08-17 | Production is not authorized by this plan. |
| 8.3 Retire superseded paths safely | ⬜ Open | 2026-08-17 | Only after sustained verified operation and recovery proof. |

Every implementing session must update this table, the current-state sections it changes, and its verification evidence before stopping. A row marked complete must cite an artifact or commit, never a remembered count.

---

## 1. Ultimate goal

POP will have one official, shared licensing catalogue in Supabase for Licensors, Properties, Characters, Style Guides, Asset metadata, and Franchises. Every POP application will read the same records and relationships.

ColdLion will control official Licensor names. Authorized licensor portals will control Property names, Property ownership, entities, and direct relationships inside their scrape coverage. For a ColdLion-only Property under a Licensor with no scrape data, ColdLion's Property name and owning Licensor will be canonical truth. ColdLion will also control whether a Property is Active or Inactive. The stale DesignFlow pull will have no authority. All four authorized source programs will refresh at least weekly, with visible freshness, failure, and review information.

When finished:

- a Property has one official spelling and one owning Licensor;
- a Character can belong to more than one Property;
- Style Guides, Characters, Assets, Properties, and Franchises retain all direct source relationships without turning co-occurrence into fact;
- every canonical record can be traced to stable source identities and capture history;
- uncertain matches wait for licensing review instead of being guessed;
- missing source records are retained and reviewed, never deleted;
- a complete ColdLion set calculates Property Active/Inactive safely;
- DB Data Admin is the human review and audit surface;
- applications stop reading licensing truth from DesignFlow and competing legacy tables.

**If a step conflicts with this goal, the goal wins. Stop and flag the conflict instead of implementing the step literally.**

---

## 2. What this application is

`u2giants/shared-db` is the canonical repository for the PostgreSQL database hosted by Supabase and shared by PopDAM, PopPIM, PopCRM, DB Data Admin, and the six DesignFlow PLM services. It contains timestamped database migrations, SQL contract tests, source-ingestion helpers, GitHub Actions workflows, and the React-based DB Data Admin application.

Environments:

| Environment | Supabase project reference | Purpose |
|---|---|---|
| Preview | `rjyboqwcdzcocqgmsyel` | All migrations, consolidation rehearsals, and UI verification first |
| Production | `qsllyeztdwjgirsysgai` | Shared live database; no mutation until governed promotion |

Relevant application:

- DB Data Admin: `https://data.designflow.app`, implemented in `apps/db-data-admin/`.
- Canonical source-specific private repositories on this machine:
  - `C:\repos\licensor-source-data-disney`
  - `C:\repos\licensor-source-data-nbcu`
  - `C:\repos\licensor-source-data-paramount`
  - `C:\repos\licensor-source-data-warner`

The private repositories hold authorized source capture logic and licensed evidence. Licensed rows and files must never be copied into this public repository, a public GitHub issue, a pull request, logs, or an external AI prompt.

The intended data path is:

```text
Authorized portal capture in private source repo
        ↓
source-specific plm.* landing tables in shared Supabase
        ↓ complete-capture validation
source adapter views with stable IDs and direct evidence labels
        ↓ durable resolution + guarded consolidation
core.licensor / core.property / core.character / core.style_guide / core.franchise
dam.asset metadata + canonical relationship tables
        ↓
api.* application contracts and DB Data Admin review/audit

ColdLion complete Property set
        ↓ separate guarded reconciliation
core.property.status = active or inactive
```

---

## 3. What triggered this work

On 2026-08-16 Albert Hazan settled the central architecture in [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md):

- ColdLion is canonical for Licensor names;
- authorized licensor scrapes are canonical for Property spelling and owning Licensor inside their coverage;
- ColdLion-only Property data under a Licensor with no scrape data is canonical truth;
- those scrapes are canonical for Characters, Style Guides, Asset metadata, Franchises, and direct source-published relationships;
- ColdLion also decides Property Active/Inactive;
- DesignFlow, including the one stale Supabase pull, has no authority;
- the authorized source programs run weekly.

The database already contains parts of the destination, but its shape and older plans still reflect superseded assumptions. This plan starts the controlled transition from partial source landing structures to one canonical catalogue.

This is not a bug reproduction. It is a database and application architecture implementation.

---

## 4. Scope

### In this plan

- audit the applied and merged database state before declaring gaps;
- repair the canonical entity structure for the six official entity types;
- add or correct canonical many-to-many relationships;
- extend durable source resolution to Licensor and Franchise;
- retain provenance, aliases, first-seen, last-seen, current/missing state, and audit history;
- add guarded source-to-canonical consolidation contracts;
- integrate Disney, NBCU, Paramount, and Warner landing tables through source-specific adapters;
- implement ColdLion-driven Property Active/Inactive as a separate guarded step;
- add DB Data Admin review, conflict, freshness, and audit behavior;
- establish weekly source-run evidence and alerting;
- cut consumers over to canonical API contracts;
- verify on preview, then land through the governed production process.

### Not in this plan

- scraping or storing the licensed artwork binaries in this public repository;
- treating DesignFlow as a fallback authority;
- recreating source-specific landing tables that already exist;
- deleting historical landing evidence or canonical records;
- rewriting ColdLion itself or asking Albert to administer that third-party system;
- migrating unrelated customer, vendor, item, order, sample, product-depth, or royalty-rate structures;
- changing production Cloud SQL, GCP triggers, secrets, Terraform, or DesignFlow production infrastructure;
- replacing the source portals' private repositories with one public scraper repository;
- resolving licensed row-by-row matches in public documentation;
- applying all currently pending production migrations as one broad batch;
- completing the weekly source login automation if a portal technically requires a human login that cannot be automated safely. In that case the weekly job must create a visible due/failed state and exact operator instruction rather than silently pretending it ran.

---

## 5. Current state of the code and database

### 5.1 Settled documentation

The controlling architecture is committed on `main` in [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md). `AGENTS.md` links it near the top and states that it is a central contract, not a proposal.

### 5.2 Canonical tables that already exist in migrations

| Existing object | Definition | Useful behavior | Gap against settled architecture |
|---|---|---|---|
| `core.licensor` | `supabase/migrations/20260621150815_app_core.sql:180` | UUID identity, name, code, status, metadata | Lacks first/last-seen fields on the row; authority is not enforced by a consolidation contract |
| `core.property` | base definition at `supabase/migrations/20260621150815_app_core.sql:191`; tightened by `supabase/migrations/20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql:69-76`; `potential` added by `supabase/migrations/20260717122237_core_entity_status_add_potential.sql` | One `licensor_id` that is `NOT NULL` with `ON DELETE RESTRICT`, plus name, code, status | Correct one-Licensor shape; `status` still defaults to `active`, so every consolidation insert must explicitly use the already-defined `potential` value; needs guarded scrape authority and ColdLion-only status calculation |
| `core.character` | same file, line 203 | UUID identity and metadata | Still has scalar `property_id`, `ON DELETE CASCADE`, and uniqueness scoped to one Property; conflicts with many-to-many Property membership |
| `core.taxonomy_source_ref` | same file, line 215 | Generic source identity record | Lacks first/last-seen, current/missing state, evidence kind, and enforced target integrity |
| `core.style_guide` | `supabase/migrations/20260727230000_core_style_guide_axis.sql:24` | Canonical Style Guide identity and parent guide | Still has scalar `property_id`; comments say one-Property assumptions that are superseded |
| `core.style_guide_character` | same file, line 67 | Many-to-many Style Guide/Character bridge | Lacks direct-evidence provenance, first/last-seen, and current state; cascade behavior needs safety review |
| `core.property_character` | `supabase/migrations/20260807170000_opa_property_character_landing.sql:243` | Many-to-many Property/Character bridge | Source is free text; lacks stable source-edge identity, first/last-seen, current state, and consistent evidence contract |
| `dam.asset` | `supabase/migrations/20260621151024_domain_tables.sql:245` | Existing canonical Asset metadata home with source identity | Has scalar Property and Licensor links but lacks canonical many-to-many Property, Style Guide, and Franchise bridges and freshness fields |
| `dam.asset_character` | same file, line 273 | Existing Asset/Character bridge | Lacks source-edge provenance, first/last-seen, and current state |
| `core.property_alias` | `supabase/migrations/20260731150000_popsg_property_resolution_contracts.sql:98` | Reviewed Property aliases | Can be reused; normalization name is PopSG-specific and must be audited before using it for portal aliases |
| `core.licensor_alias` | `supabase/migrations/20260731210000_core_licensor_alias.sql:118` | Reviewed Licensor aliases | Can be reused; approval states and source semantics must be retained |

`core.franchise`, `core.property_style_guide`, `core.property_franchise`, `dam.asset_property`, `dam.asset_style_guide`, and `dam.asset_franchise` do not have canonical table definitions on `main` as of the starting commit. The implementer must still re-run the Phase 0 migration and live-catalog checks before acting, because `main` may advance.

### 5.3 Durable source resolution already authored but not live everywhere

Migration `supabase/migrations/20260814224937_source_resolution_durable_home.sql:9` creates `plm.source_resolution` for Property, Character, Style Guide, and Asset decisions. Migration `20260814233423_remaining_source_resolution_durable_home.sql` extends the backfill/guard coverage to remaining sources.

The source-resolution model is the correct foundation and must be extended, not replaced. Current gaps:

- no `licensor` or `franchise` entity kind;
- no `core_licensor_id` or `core_franchise_id` target;
- no source-scope table proving which canonical Licensor a full portal `source_system` represents;
- no canonical relationship-resolution record for direct source edges.

Production ledger evidence from GitHub Actions run `31979756895` on 2026-08-16 showed 467 versions on `main`, 453 applied, and 14 merged-but-not-applied versions. The source-resolution migrations were among the genuinely pending set. This plan must not assume those objects exist in production and must not promote the unrelated pending set as a batch.

### 5.4 Source landing tables already exist

- Disney OPA: `plm.opa_property_character` plus normalized OPA entity migrations.
- Disney DCP Vault: `plm.dcp_crawl`, `plm.dcp_style_guide`, `plm.dcp_asset`, crawl/gap/load-exception tables, and the separated Disney/Lucasfilm/Marvel/Twentieth Century variants.
- Paramount: `plm.pmt_property`, `plm.pmt_character`, `plm.pmt_collection`, `plm.pmt_franchise`, `plm.pmt_asset`, direct relationship tables, and `plm.pmt_property_franchise_evidence` for co-occurrence only.
- NBCU: `plm.nbcu_property`, `plm.nbcu_ip_family`, `plm.nbcu_character`, `plm.nbcu_style_guide`, `plm.nbcu_asset`, and direct relationship tables.
- Warner: normalized `plm.wb_franchise`, `plm.wb_property`, `plm.wb_character_normalized`, `plm.wb_style_guide_normalized`, `plm.wb_asset_normalized`, direct Asset relationships, Property/Character, and `plm.wb_franchise_property_evidence`.

Do not duplicate these tables. Source adapters must read their latest complete, validated capture contracts.

The 2026-08-13 evidence recorded zero rows in every Warner normalized landing table. Treat that as dated evidence, not current truth: Phase 0 rechecks it, and Step 3.0 requires the first complete validated Warner capture on preview before the Warner adapter may run.

### 5.5 Current operational scheduling

ColdLion has preview and production workflows with daily snapshot/promotion/comparison and hourly health lanes in `.github/workflows/coldlion-licensor-property-*.yml`.

The four private licensor-source repositories had no checked-in `.github/workflows` schedules in the local clean/current copies inspected on 2026-08-16. Their working copies and branches must be refreshed before implementation. Weekly licensor refresh automation is therefore not complete.

### 5.6 Existing plans that are now subordinate

- `fix_characters_style_guides.md` contains useful historical measurements and tools, but its one-Property-per-Character and DesignFlow-source assumptions are superseded.
- `plan_coldlion_licensor_property_accelerated_cutover.md` contains useful ColdLion safety tooling. Its DesignFlow parent-authority assumptions are superseded; its ColdLion authority statements survive only where they match the 2026-08-19 scope rule.
- `docs/style-guides-characters-and-royalties.md` is useful for royalty and likeness details but is explicitly subordinate to the 2026-08-16 central architecture.

Do not execute an old phase merely because its status says open. Re-derive each relevant step under this plan.

### 5.7 Existing overwrite and mapping paths that must be handled explicitly

`plm.import_master_data(jsonb, jsonb)` is the DesignFlow PLM API catch-up importer, not a `dflow.*` table reader. The production definition can force `core.property.licensor_id` and Property/Licensor status back to DesignFlow-supplied values. The daily `systemd/plm-sync.timer` lane still exists. Neither may run, be repaired, or be re-enabled until Step 1.0 has installed and verified a forward guard that prevents licensing canonical writes.

ColdLion already has resolution state in `plm.erp_licensor`, `plm.erp_property`, `plm.taxonomy_resolution_review`, and approved links used by `tools/promote-coldlion-source-owned.mjs`. These decisions must be migrated into the durable resolution home before legacy landing-resolution columns are frozen. They are evidence and mapping inputs, not authority for scrape-covered Property spelling or ownership.

---

## 6. Key findings and root cause

1. The source capture layer is substantially built, but consolidation into canonical tables is not. Landing evidence and canonical application truth are different layers.
2. The original June schema encoded `core.character.property_id`, which makes one Property per Character structural. The later `core.property_character` bridge contradicts that scalar but did not remove it. Two competing ownership shapes now exist.
3. `core.style_guide.property_id` similarly encodes one Property, while the settled architecture allows every direct source-published relationship and therefore needs a bridge.
4. Franchise data exists in source-specific tables but has no canonical `core.franchise` home.
5. `dam.asset` is the established canonical metadata home and already has application relationships. Creating `core.asset` would create a competing canonical table. The plan therefore extends `dam.asset` and its bridges.
6. Durable human source resolution was correctly separated from capture rows in migration `20260814224937`. The implementation should extend that mechanism rather than write canonical IDs back into replaceable landing snapshots.
7. Paramount explicitly proves why relationship evidence needs a type: Property/Franchise co-occurrence is not a direct relationship. Canonical bridges may contain only direct source statements or explicit curated decisions; co-occurrence remains in labelled evidence views/tables.
8. ColdLion does not supply Characters, Style Guides, Assets, or Franchises. It is canonical for Licensor names, Active/Inactive membership, and ColdLion-only Property identity under Licensors with no authorized scrape data. Inside scrape coverage, the portal remains canonical for Property names and ownership.
9. Weekly licensor-source scheduling is absent from the inspected private repositories, so database freshness columns and alerts must be implemented together with private-repo operations.
10. Production migration drift is real. A live catalog absence can mean “merged but not applied,” not “never built.” Every phase starts by comparing `origin/main`, preview ledger, and production ledger.
11. New scraped Properties cannot rely on the current `core.property.status` default because it is `active`. The consolidation function must explicitly insert `potential`, and only guarded ColdLion membership may later set `active`.
12. The existing `core.property_character` pair row cannot itself retain two independent source observations. Step 1.4 preserves its application-facing pair key and adds companion source-support rows; Step 2.3 replaces the old scalar-based Style Guide/Character axis invariant after the audited queue exists.
13. Durable source resolution cannot become authoritative while approved decisions remain only in landing-table columns. Step 2.1 backfills and freezes portal landing decisions; Step 4.0 atomically retargets ColdLion tools, backfills `erp_*` decisions with an explicit status map, and only then freezes those live match columns.
14. Duplicate discovery after canonical creation needs a reversible merge operation. Repointing relationships without an audited merge contract would lose history and make rollback unsafe.

Root cause: the shared database was built incrementally from DesignFlow, ColdLion, PopDAM, and individual portal captures before one authority model was settled. The result is good source evidence but overlapping canonical assumptions. The 2026-08-16 architecture supplies the missing authority model; this plan makes the structure and operations agree with it.

### 6.1 GLM 5.3 review correction ledger

GLM 5.3 reviewed merged plan commit `1e7daffd7ac6d1507a76dc8452462bef6f876d0a` on 2026-08-17. Every finding is resolved below so a later session does not have to rediscover or reinterpret the review.

| Finding | Resolution in this revision |
|---|---|
| H1 ColdLion mappings were assumed but never built | Added Step 4.0 using the existing ERP resolution/review machinery, approved links, review for ambiguity, and guarded create-new handling. Under Licensors with no scrape data, ColdLion-only Property names and ownership are canonical; later authorized scrape coverage supersedes the Property wording and preserves the prior wording as an alias. |
| H2 new scraped rows could default Active | Step 2.4 explicitly inserts `status='potential'`; tests forbid consolidation from creating or changing a Property to Active. Phase 8 applies status in the same bounded release before consumer enablement. |
| H3 scrape authority conflicted with §6.4 matched-row abstention | `AGENTS.md` now states the narrow owner-approved exception for the future guarded, source-scoped complete-capture consolidator. Ad-hoc external loads remain fully bound by §6.4. |
| H4 DesignFlow PLM importer could overwrite the catalogue | Step 1.0 installs a table-level protected-column guard that survives later function replacement, blocks `plm.import_master_data`, and stops `systemd/plm-sync.timer` before consolidation. Step 8.1 replays held function `20260802170000` after the guard and proves it still cannot write. |
| M5 alleged nonexistent `--queue-audit` command | Verified against revised base `b262a9f`: `scripts/manage-migration-author-lanes.mjs:749,819` supports `--queue-audit`, and `AGENTS.md:668-670` requires it. The GLM checkout was stale, so Step 0.1 retains both `--audit` and `--queue-audit` and cites the verified locations. |
| M6 Property/Character key and cross-axis invariant were unspecified | Step 1.4 preserves the application-facing endpoint-pair key and adds per-source support rows. Step 2.3 replaces the scalar-derived invariant only after the relationship queue exists, without inferring a direct edge. |
| M7 landing-table resolution decisions could remain a second truth | Step 2.1 backfills/freezes portal landing decisions. Step 4.0 separately retargets all live ColdLion matching tools, proves parity with an explicit status map, then freezes only the `erp_*` decision columns. |
| M8 Warner had no complete capture prerequisite | Added Step 3.0; Warner adapter work cannot start until a complete validated Warner preview capture exists. |
| M9 Property Licensor nullability was wrong | §5.2 now records `licensor_id NOT NULL` and `ON DELETE RESTRICT` from migration `20260724030000`. |
| M10 duplicate merge/history was missing | Added Step 2.5 with repointing, alias/tombstone retention, ownership/name history, audit, dry run, and reversal. |
| L1 scalar drops appeared to happen in Phase 1 | Phase 1 is additive compatibility only. Step 7.2 is the separate post-cutover removal migration. |
| L2 production merge freeze and held versions were unnamed | Step 8.1 now requires the §12.1 merge freeze and explicitly excludes held versions `20260802170000` and `20260802171000` unless separately released. |
| L3 overdue escalation was missing | Step 6.2 alerts on the first missed deadline and disables the source scope plus pages a human after the second consecutive missed weekly deadline. Recovery requires a complete capture and reviewed re-enable. |
| L4 no real-volume time/lock rehearsal | Step 3.5 adds three full-volume timed preview rehearsals, a five-second lock timeout, measured lock evidence, and a production budget derived from the slowest successful preview run plus 50 percent. |

### 6.2 Grok 4.6 review correction ledger

Grok 4.6 reviewed the first GLM-corrected working tree on 2026-08-17. The initial turn cost $0.21711448 and found four High, five Medium, and four Low items. Every item was resolved. The same session then reread the complete revision for $0.15495568 and returned **Ready**, confirming that every prior High, Medium, and Low finding was resolved. Total Grok cost: $0.37207016.

| Finding | Resolution in this revision |
|---|---|
| H1 current ColdLion promotion could restore old names before Phase 4 | Step 1.0 now installs the table guard and retires both ColdLion promotion functions/workflows before any scrape apply. Step 2.4/3.5 depend on it. |
| H2 one unresolved ColdLion row froze all status work | Step 4.1 changes only rows with a resolved membership outcome. Unresolved records protect only their candidate canonical rows; unrelated mapped/resolved-absence rows proceed. Allowed exclusion reasons are enumerated. |
| H3 ColdLion live match columns froze before tool cutover | Step 2.1 excludes `erp_*`. Step 4.0 publishes the exact legacy status map, retargets every function/tool/UI, proves parity, then freezes only decision columns atomically. |
| H4 held importer file could undo a function-body lock | Step 1.0 uses a table-level transaction-bound protected-column guard. Step 8.1 replays `20260802170000` after the guard and requires post-apply guard proof. |
| M1 axis rule depended on a queue created later | Step 1.4 only adds source-support structure. Step 2.3 creates the queue and then replaces `opa_property_character_landing_contracts.sql:334-353`. |
| M2 source identity and scope used two different keys | The locked key is `(source_system, entity_kind, source_id)` everywhere. Existing full DCP source-system names carry studio scope; no second namespace key is introduced. |
| M3 §6.9 appeared to require ColdLion rows to remain Potential forever | `AGENTS.md` now says Potential is the admission status; after durable mapping and a complete current ColdLion set, the newer status rule may make the row Active. |
| M4 replacing the Property/Character primary key could break readers | The endpoint-pair primary key remains. A companion source-support table carries multiple source observations; Phase 0 inventories all readers/FKs before any future compatible surrogate addition. |
| M5 Step 0.2 omitted the first claimed objects | The first claim unit now names the protected tables, guard, DesignFlow importer, both ColdLion promotion functions, grants, tools, services, and workflows. |
| L1 Potential migration was not cited | §5.2 and Step 2.4 cite `20260717122237_core_entity_status_add_potential.sql` and forbid recreating the value. |
| L2 header had two planning bases | The obsolete original starting-commit line was removed. The review revision names one current base and Phase 0 still refreshes `main`. |
| L3 the old axis test was replaced in two phases | Step 2.3 is the sole replacement point; Step 7.2 removes only scalar-specific tests. |
| L4 opening router omitted Potential/reviewed create-new | The opening `AGENTS.md` licensing summary now states both rules. |

---

## 7. Approaches considered and rejected

### Rejected: record the architecture as an unresolved ticket

Albert rejected this framing on 2026-08-16. The architecture is settled in the central document. GitHub #1090 is an execution tracker only and cannot reopen the design.

### Rejected: seed missing Property ownership from DesignFlow

The one DesignFlow pull is stale and explicitly has no authority. DesignFlow may remain as historical aliases/source references only.

### Rejected: let ColdLion rename or re-parent canonical Properties

ColdLion's role is Active/Inactive membership only. Portal spelling and ownership win.

### Rejected: create a second canonical entity family

Do not create `licensing.property`, `public.properties_v2`, `core.asset`, or another competing catalogue. Reuse `core.licensor`, `core.property`, `core.character`, `core.style_guide`, `dam.asset`, and add only the missing `core.franchise` and relationship structures.

### Rejected: keep both scalar and many-to-many ownership indefinitely

Leaving `core.character.property_id` beside `core.property_character`, or `core.style_guide.property_id` beside a new bridge, creates two truths. Compatibility may require a transition view, but the scalar columns must be retired after consumers move.

### Rejected: infer direct relationships from filenames, folders, or co-occurrence

Only a direct portal statement or an audited licensing decision creates a canonical relationship. Paramount co-occurrence stays evidence-only.

### Rejected: hard-delete records missing from a refresh

Missing records keep their canonical identity and last-seen history. Relationship edges become non-current after a complete capture proves absence. Entities are never automatically deleted.

### Rejected: write human decisions into capture-scoped landing rows

Capture rows are replaceable evidence. Use `plm.source_resolution` and audited relationship-resolution structures.

### Rejected: one giant migration or broad production apply

The work touches high-fan-out shared objects and production already has unrelated pending migrations. Use bounded phases, exact-object claims, preview proof, and one guarded merge/promotion at a time.

### Rejected: store licensed files in this repository

Only metadata and protected database references belong here. Files stay in authorized systems/storage.

### Rejected: silently skip a weekly portal run

If authentication or portal availability prevents a run, record a failure/due state and alert. Never report old data as fresh.

---

## 8. Locked and open design decisions

### Locked decisions, do not relitigate

1. Authorized licensor scrapes control Property spelling, Property ownership, entities, and direct source-published relationships. Date: 2026-08-16.
2. ColdLion controls official Licensor names and Property Active/Inactive. Under Licensors with no authorized scrape data, ColdLion-only Property names and ownership are canonical truth. Date: clarified by Albert Hazan on 2026-08-19.
3. DesignFlow has no authority. Date: 2026-08-16.
4. A Character may belong to multiple Properties. Owner/licensing decision recorded before this plan and reaffirmed by the architecture.
5. Style Guide/Character is many-to-many.
6. `core.property.licensor_id` remains one owning Licensor per Property unless future authoritative evidence and a new owner decision change it.
7. Co-occurrence is not a direct Franchise relationship.
8. Canonical records are retained; refreshes do not hard-delete them.
9. Authorized licensor scrapes run at least weekly.
10. Asset means canonical metadata in `dam.asset`, not binaries in the public repository.
11. DB Data Admin is the licensing review and audit surface.
12. A Property created from an authorized scrape starts `potential`, never `active`; only guarded ColdLion membership may set `active`.
13. An unmatched ColdLion Property under a Licensor with no authorized scrape data may be created from ColdLion's canonical name and ownership through the guarded path. Ambiguous identity or coverage requires Licensing review. A later authorized portal scrape overrides the Property values inside its coverage and preserves the prior spelling as an alias.

### Implementation choices fixed by this plan

1. Extend existing canonical tables. Do not build a parallel catalogue.
2. Add `core.franchise` as the missing canonical entity table.
3. Retire the scalar `core.character.property_id` and `core.style_guide.property_id` after compatibility migration and consumer cutover.
4. Use explicit bridges: `core.property_character`, `core.property_style_guide`, `core.style_guide_character`, `core.property_franchise`, `dam.asset_property`, `dam.asset_character`, `dam.asset_style_guide`, and `dam.asset_franchise`.
5. Extend `plm.source_resolution` for Licensor and Franchise. Use a separate audited relationship-resolution table because entity resolution and edge evidence are different facts.
6. Use `dam.asset` as the canonical Asset metadata table.
7. Store co-occurrence evidence only in source/evidence tables and views, not canonical direct bridges.
8. Hard-gate `plm.import_master_data` before any canonical consolidation so the DesignFlow PLM API cannot overwrite licensing names, ownership, or status.
9. Use one reversible canonical merge operation for duplicates discovered after creation; direct manual re-pointing is forbidden.

### Open implementation judgments that do not require Albert

- exact index choice after `EXPLAIN` on preview;
- whether a compatibility view or generated API field best carries a single “primary Property” during consumer transition;
- how to split migrations into collision-safe units after current object claims are audited;
- whether each private portal can run fully unattended. Decide from the portal's authorized technical behavior and its source-specific skill. Never weaken security or fabricate success.
- the final production time budget after three full-volume preview rehearsals. Set it to the slowest successful preview apply plus 50 percent, record the measured value, and stop rather than raising it if production exceeds the approved budget.

Any new business authority question discovered during implementation stops the affected source only. It does not permit the implementer to guess or redesign the locked model.

---

## 9. Executable implementation plan

### Phase 0: establish current truth and reserve work

Natural fresh-session cut point: after Phase 0 evidence is committed. Re-read Phases 1–3 before starting Phase 1.

#### Step 0.1: refresh and inventory the exact current state

Files and commands:

1. Read `AGENTS.md`, `docs/core-master-data-consolidation-aim.md`, this plan's STATUS table, and all open `HANDOFF.d/` files newest-first.
2. Verify the active orchestrator marker and route #1090 through it. The implementation is structural and must be dispatched to isolated worktrees.
3. Fetch `origin/main`; never implement from a stale local `main`.
4. Run:
   - `node scripts/check-migration-ledger-drift.mjs --target production`
   - the same check for preview using the script's supported preview target;
   - `node scripts/manage-migration-author-lanes.mjs --audit`
   - `node scripts/manage-migration-author-lanes.mjs --queue-audit` (verified on revision base at `scripts/manage-migration-author-lanes.mjs:749,819`; it audits/refills dynamic queues and is distinct from the lane audit)
5. Capture catalog definitions, constraints, policies, grants, row counts, and dependent views for every object listed in the STATUS table. Prove the connection target immediately before each database read and record only counts/definitions, never licensed row contents.
6. Query `api.source_capture_inventory` and record current coverage/freshness using its declared count basis. Do not guess source table names or treat a null latest-complete count as zero.
7. Save all sanitized output under `docs/verification/licensing-master-data-phase0-<UTC-date>/` with a README explaining target references and command exit codes.

Dependency: none.

Verification gate: the evidence directory proves the exact preview and production ledgers, live object shapes, dependency graph, source freshness, and every current row count required to choose safe migrations. Exit 2 from a ledger check is a failure to check, never “clean.”

#### Step 0.2: split exact-object claims and reserve versions

Use the orchestrator's dynamic queue. Likely author units, subject to current overlap audit:

1. Write-authority guard first: `core.licensor` and `core.property` protected-column triggers/guard state, `plm.import_master_data`, `plm.promote_coldlion_source_owned`, `public.promote_coldlion_source_owned`, their grants, and every repository caller/workflow including `systemd/plm-sync.*` and the ColdLion promotion workflows.
2. Entity foundation: `core.character`, `core.franchise`, alias tables, `core.taxonomy_source_ref`, `plm.source_resolution`, `plm.licensing_source_scope`.
3. Relationship foundation: the four `core.*` bridges, four `dam.*` bridges, and their source-support tables.
4. Consolidation/API foundation: candidate views, audited promotion functions, freshness views, and DB Data Admin RPC contracts.

Run `node scripts/manage-migration-author-lanes.mjs --claim ...` with every exact object and the isolated worktree path. Let the tool reserve each 14-digit version. Do not create a migration file before a successful claim.

Verification gate: GitHub-backed claims show no overlapping object owner, each branch/worktree is isolated, and each reserved version came from the lane tool.

### Phase 1: canonical entity and relationship foundation

Natural fresh-session cut point: after the Phase 1 PR is preview-proven and merged. Re-read Phases 2–4 before starting Phase 2.

#### Step 1.0: install a durable licensing write guard and stop every non-authoritative writer

Target a new forward migration under `supabase/migrations/`; do not edit already-applied or held migration files. Create private table `plm.licensing_write_authorization`, trigger function `app.enforce_licensing_write_authority()`, and triggers `licensor_licensing_write_guard` / `property_licensing_write_guard`. Protect authoritative columns on every `core.licensor` / `core.property` insert and update with table-level guards that survive later `CREATE OR REPLACE FUNCTION` statements.

The guard requires a non-expired authorization row matching `pg_backend_pid()`, the current transaction ID, write kind, plan ID/hash, actor, and exact protected-column set. Revoke direct writes to the authorization table; only controlled `SECURITY DEFINER` plan/apply functions may create an authorization after validating source scope, capture/plan hash, and caller role. Allowed kinds are explicit:

- `scrape_consolidation`: portal-authoritative Licensor/Property name/code/ownership; a new Property status must be exactly `potential`, and matched Property status cannot change;
- `coldlion_uncovered_create`: one guarded ColdLion-only Property insert under a Licensor proven to lack scrape data, using ColdLion name, ownership, and `potential` status; ambiguous cases require review;
- `coldlion_status`: Property status only, to `active` or `inactive`;
- `canonical_merge`: only the exact survivor/tombstone changes declared by the Step 2.5 hash-pinned merge plan.

Direct table grants or a caller-set session variable do not create an authorization. A legacy function body cannot bypass the guard merely because it is replaced or applied later.

In the same bounded change:

1. Redefine or wrap `plm.import_master_data(jsonb, jsonb)` so any Licensor/Property portion is rejected before mutation. Preserve unrelated import behavior only where Phase 0 proves it is still required and contract tests show it cannot reach licensing tables.
2. Replace `plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)` and `public.promote_coldlion_source_owned(jsonb,jsonb,boolean)` with a loud retired-until-Step-4 refusal. The existing function and `tools/promote-coldlion-source-owned.mjs` currently permit ColdLion name writes; they cannot run after the first authoritative scrape name is applied.
3. Stop and inventory `systemd/plm-sync.timer`, every DesignFlow PLM importer caller, and every ColdLion promotion workflow/caller. None may be repaired or re-enabled until it targets the later narrow authorized function.
4. Add an immutable guard audit that records allowed/refused write kind, protected columns, plan/capture reference, actor, and timestamp without licensed values.

Dependency: Phase 0 evidence and exact claims on both protected tables, the guard objects, both promotion functions, `plm.import_master_data`, grants, and callers. This step must merge before Steps 2.4, 3.5, or 4.1 can apply canonical data.

Verification gate: SQL tests prove direct writes, a DesignFlow licensing payload, the current/held `plm.import_master_data` body, and the current ColdLion promotion body all fail before changing protected columns when no valid transaction authorization exists. Authorized test functions can change only their allowed column set. Reapplying the function definition from held migration `20260802170000` after the guard is installed still cannot change Property ownership or status. Caller evidence proves `systemd/plm-sync.timer` and old ColdLion promotion schedules are stopped. Existing non-licensing tests remain green.

#### Step 1.1: repair Character ownership without losing data

Target: a new reserved migration under `supabase/migrations/` plus contract tests under `supabase/tests/`.

Behavior:

1. Audit every non-null `core.character.property_id` row and its provenance. The 2026-08-07 evidence reported zero rows, but do not rely on that dated fact.
2. If any current row is backed by an authorized direct source or audited licensing decision, insert the equivalent edge into `core.property_character` with stable source-edge provenance.
3. If a row derives only from stale DesignFlow, do not promote that parent as canonical. Preserve its value as historical evidence and place the identity/edge into review.
4. Remove the `ON DELETE CASCADE` route from Property to Character.
5. In Phase 1, add a compatibility view/API and mark the scalar `property_id` deprecated/read-only; do not drop it here. Step 7.2 owns the separate removal migration after every consumer read is replaced.
6. Give `core.character` a Licensor scope suitable for identity (`licensor_id` nullable during review, `ON DELETE RESTRICT`) and a partial unique code index only when the source supplies a stable code. Do not deduplicate on name alone.

Verification gate: SQL tests prove one Character can link to two Properties; deleting/inactivating a Property cannot delete the Character; no stale DesignFlow parent is promoted; every pre-existing authoritative scalar link is preserved as an edge; old consumers have a tested compatibility result during transition.

#### Step 1.2: create canonical Franchise

Create `core.franchise` with:

- UUID primary key;
- nullable `licensor_id` during unresolved review, `ON DELETE RESTRICT`;
- `name`, optional `code`, and `source_term` so “Franchise” and “IP Family” remain distinguishable;
- `status app.entity_status` for human retirement, not auto-deletion;
- `metadata`, `created_at`, `updated_at`;
- indexes by Licensor/name and Licensor/code when code exists;
- RLS and grants matching the shared licensing catalogue, with service-role write and authenticated role-scoped read;
- no uniqueness on normalized name alone.

Also create `core.franchise_alias` and `core.character_alias` following the reviewed alias patterns while using a source-neutral normalizer. Add `core.style_guide_alias` if current source measurements show alternate official/internal spellings that must be searchable.

Verification gate: contract tests prove same-name Franchises can exist under different Licensors/source scopes, aliases cannot point across the wrong Licensor, unauthenticated users cannot read, and authenticated licensing/application roles can read without gaining direct writes.

#### Step 1.3: replace scalar Style Guide ownership with a bridge

Create `core.property_style_guide` and migrate only direct-source or audited links from `core.style_guide.property_id`. Stale DesignFlow-derived links go to review/evidence, not the bridge.

In Phase 1, add a compatibility view/API and mark `core.style_guide.property_id` deprecated/read-only; do not drop it here. Step 7.2 owns the separate removal migration after all API and app consumers move. Keep `core.style_guide.licensor_id` as identity scope unless Phase 0 proves a real cross-Licensor guide.

Verification gate: one Style Guide can link to multiple Properties; a Style Guide with no resolved Property remains valid; removing an edge cannot delete either endpoint; compatibility reads remain correct during transition.

#### Step 1.4: standardize direct relationship bridges

Ensure these canonical direct-edge tables exist:

- `core.property_character`
- `core.property_style_guide`
- `core.style_guide_character`
- `core.property_franchise`
- `dam.asset_property`
- `dam.asset_character`
- `dam.asset_style_guide`
- `dam.asset_franchise`

Each canonical bridge keeps one business row per endpoint pair, with both endpoint UUIDs using `ON DELETE RESTRICT`, pair uniqueness, current/retired summary state, reverse-lookup indexes, and endpoint-matching RLS/grants. Source support is stored in a companion `<bridge>_source_edge` table keyed by the full `source_system` plus stable `source_edge_id` or a documented deterministic source key. Each support row carries `evidence_kind`, `first_seen_at`, `last_seen_at`, `is_current`, and metadata. Two sources can therefore support one canonical pair without duplicating the application-facing pair.

For `core.property_character`, keep the existing `(property_id, character_id)` primary key in Phase 1 and add `core.property_character_source_edge` with a composite foreign key back to that pair. Phase 0 must inventory every foreign key, view, function, generated type, and application reader that treats the endpoint pair as identity. If the evidence later proves a surrogate pair ID is necessary, add it compatibly and retain the endpoint unique key; do not replace the primary key while readers are unknown.

Do not replace the existing scalar-based axis test in Phase 1 because the audited relationship-review queue does not exist until Step 2.3. Phase 1 adds source-support structure and forbids creating new inferred Property/Character edges. Step 2.3 owns the replacement of `supabase/tests/opa_property_character_landing_contracts.sql:334-353` after the queue exists.

Do not place Paramount or Warner co-occurrence rows in `core.property_franchise`. Keep their evidence-only tables and expose clearly labelled evidence views.

Verification gate: tests preserve the existing `core.property_character` endpoint-pair contract, insert two independent source-support rows for one canonical pair without duplicate business display, retire one source observation without removing the other support, reject `evidence_kind='cooccurrence'` from direct support tables, create no inferred edge, and prove endpoint deletion is blocked.

#### Step 1.5: extend canonical provenance and Asset freshness

Extend `core.taxonomy_source_ref` with the existing collision-proof `source_system` plus complete source-specific `source_id`, entity kind constraints, `first_seen_at`, `last_seen_at`, `is_current`, `missing_since`, and audit metadata. Add integrity enforcement so a source ref cannot silently point at a nonexistent or wrong-kind target.

Extend `dam.asset` with the same freshness/current-state facts and retain the established `(source_system, source_id)` identity. If Phase 0 proves an actual collision, assign a distinct full `source_system` value consistent with the durable-resolution model rather than introducing a second namespace key. Keep the scalar Asset Property/Licensor fields as deprecated, read-only compatibility fields during Phases 1–7. Step 7.2 retires them only after all consumers use bridges.

Verification gate: source refs preserve multiple source identities for one entity, reject cross-kind targets, and mark missing/current without deleting. Asset tests prove multiple Properties/Style Guides/Franchises can link to one Asset.

### Phase 2: durable resolution, provenance, and consolidation engine

#### Step 2.1: extend `plm.source_resolution`

Build on migrations `20260814224937` and `20260814233423`; never create a competing resolution table.

Add:

- entity kinds `licensor` and `franchise`;
- targets `core_licensor_id` and `core_franchise_id`;
- target-kind checks covering all six entity types;
- corresponding parameters and checks in `plm.set_source_resolution`;
- API fields and DB Data Admin read/write contracts;
- migration assertions that preserve every existing decision exactly;
- a one-time, source-by-source backfill from approved portal landing-resolution columns in Paramount, NBCU, OPA, and every other portal landing table found by Phase 0;
- count-parity and target-parity assertions before the backfill commits;
- database guards that make those portal landing-resolution columns read-only compatibility evidence after parity succeeds. New portal decisions go only through `plm.set_source_resolution`. Do not freeze `plm.erp_licensor` or `plm.erp_property` here; Step 4.0 moves their live ColdLion tools and freezes them atomically.

The new migration must work whether the genuinely pending source-resolution migrations are already applied by the time implementation reaches production. Ordered ledger presence is the gate; do not manually skip their SQL.

Verification gate: existing portal Property/Character/Style Guide/Asset decisions survive byte-for-byte; the durable table has exact source/target parity with every approved portal decision; attempted post-freeze writes to those portal landing columns fail loudly; ColdLion `erp_*` matching still works unchanged until Step 4.0; Licensor and Franchise decisions can be created; wrong-kind target combinations fail; first-writer and optimistic-lock tests stay green.

#### Step 2.2: add authorized source scope

Create `plm.licensing_source_scope` to map the existing full `source_system` identity to its canonical Licensor and permitted entity/relationship kinds. The identity rule is locked: canonical source identity is `(source_system, entity_kind, source_id)`, matching `plm.source_resolution`; `source_system` itself carries the collision-proof studio/portal namespace. Use already-shipped names such as `disney_dcpvault`, `lucasfilm_dcpvault`, `marvel_dcpvault`, and `twentieth_century_dcpvault`. Do not introduce a second `source_namespace` key unless a future migration changes the resolution key and all consumers together.

Required fields:

- `source_system` primary key;
- `core_licensor_id`;
- allowed entity kinds and relationship kinds;
- `authorized_at`, `authorized_by`, evidence note/reference;
- `is_enabled`, `disabled_at`, `disabled_reason`;
- expected weekly freshness interval;
- consecutive missed-deadline count, last alert time, and reviewed re-enable facts;
- no public/anonymous writes.

This table is how each full Disney, NBCU, Paramount, or Warner `source_system` proves which Licensor scope it may write. It is not inferred from DesignFlow or ColdLion.

Verification gate: a source adapter cannot propose or promote an entity outside its authorized Licensor/kind scope; disabled or stale scopes fail loudly; audit fields are mandatory.

#### Step 2.3: add relationship-resolution and candidate contracts

Create audited structures for unresolved source entities and direct source edges, using exact names selected after the Phase 0 collision audit. Recommended names:

- `plm.licensing_relationship_resolution`
- `api.licensing_entity_candidates`
- `api.licensing_relationship_candidates`
- `api.licensing_resolution_queue`

Entity candidates use the exact `(source_system, entity_kind, source_id)` key, official name, source parent identity, capture ID, completeness state, and first/last seen. Relationship candidates add source edge ID, endpoint source identities, direct/evidence-only classification, and capture facts.

Candidate views must read only the latest complete validated capture for sources that use replaceable captures. A running, partial, failed, or superseded capture cannot become canonical input.

After `api.licensing_resolution_queue` exists, replace the scalar-derived rule in `supabase/tests/opa_property_character_landing_contracts.sql:334-353`. The successor behavior is: direct Property/Character source evidence creates current support; a Style Guide linked to a Property and Character does not by itself manufacture that direct edge; any potentially missing direct edge appears in the audited relationship queue with its two supporting facts. This replacement belongs here, not Step 1.4 or Step 7.2.

Verification gate: fixtures for each source show the exact three-part identity key, correct stable identities, and direct/evidence distinction; equal source IDs in Disney/Lucasfilm/Marvel/Twentieth Century remain distinct through their existing `source_system` names; incomplete captures return no promotable candidates; display names are never used as the sole key; the old axis test is replaced and no inferred direct edge is created.

#### Step 2.4: implement preview/dry-run-first consolidation

Create a service-role-only consolidation function and a dry-run/read API. The exact function names are chosen after collision audit; recommended:

- `plm.plan_licensing_consolidation(source_system, capture_id)`
- `plm.apply_licensing_consolidation(plan_id, expected_hash)`

Rules:

- only authorized, complete captures;
- the Step 1.0 table-level write guard is present and the caller obtains a transaction-bound `scrape_consolidation` authorization for the exact plan/hash before protected writes;
- source resolution and source scope determine canonical targets;
- create a new canonical row automatically only when the stable source identity and owning Licensor are unambiguous and no normalized/alias collision exists; `core.property.licensor_id` is never null;
- every scrape-created Property explicitly inserts `status='potential'` using the value already added by `supabase/migrations/20260717122237_core_entity_status_add_potential.sql`; never recreate the enum value, rely on the table's `active` default, or let consolidation create or change a Property to `active`;
- ambiguous matches enter the licensing queue;
- for an authorized, source-scoped complete capture, portal spelling and Property ownership update matched canonical rows, while previous internal spellings become aliases and ownership changes enter immutable history; this is the narrow approved-source exception recorded in `AGENTS.md`, not permission for an ad-hoc external load;
- direct relationships upsert current support and record first/last seen;
- absence from a complete capture retires only that source's support, never the entity;
- plan output has deterministic hash, counts, reasons, and no licensed row values in logs;
- apply requires the exact plan hash and serializes per source/capture;
- rerunning the same capture is a no-op.

Verification gate: two-cycle tests prove idempotency, canonical spelling replacement plus alias preservation, ownership correction plus history, safe missing-edge retirement, ambiguity abstention, and deterministic dry-run/apply parity. A dedicated assertion proves every newly inserted Property is `potential` and consolidation leaves the status of every matched Property unchanged; only the separate ColdLion function can set `active` or `inactive`.

#### Step 2.5: add reversible canonical duplicate merge and ownership history

Create one service-role-only dry-run/apply merge contract for duplicates discovered after canonical creation. Recommended names after collision audit:

- `plm.plan_licensing_canonical_merge(entity_kind, survivor_id, duplicate_id)`
- `plm.apply_licensing_canonical_merge(plan_id, expected_hash)`
- `plm.licensing_canonical_change_history`

The operation must validate same entity kind and compatible Licensor/source scope; re-point every source resolution, alias, and relationship support to the survivor; deduplicate only identical source-edge support; retain the duplicate ID as a non-selectable merged tombstone plus alias; record before/after ownership and spelling, actor, reason, source evidence, hash, and timestamps; and create an audited reversal plan. It must abstain when the two rows have conflicting direct-source ownership that is not already resolved by the authority matrix.

Direct `UPDATE` statements that manually re-point a subset of bridges are forbidden because they can leave split identity behind.

Verification gate: fixtures merge duplicates with relationships from two sources, preserve every source reference, collapse only true duplicate edge support, keep the old ID traceable but absent from active pickers, and reverse the merge without loss. Conflicting Licensor scope refuses before mutation.

### Phase 3: source adapters and preview consolidation

Implement one source at a time. Each source uses its named skill and private repository. Never copy licensed rows into this plan or public evidence.

#### Step 3.0: prove one complete validated preview capture for every source

Before an adapter is allowed to consolidate, use the matching private source repository and source-specific skill to produce or identify one complete, validated capture loaded into preview. This prerequisite may be a controlled manual capture; Phase 6 later makes the process weekly and operationally durable.

For Disney, NBCU, Paramount, and Warner, record only sanitized capture identity/hash, validation result, completeness basis, timestamps, and counts under `docs/verification/licensing-master-data-phase3-prerequisites-<date>/`. Do not record licensed row values. Warner requires an actual first complete preview capture because the 2026-08-13 evidence found its normalized tables empty. A schema-ready Warner loader is not a completed capture.

Verification gate: `api.source_capture_inventory` and the source-specific validator agree that each named capture is complete and current; every validator exit code is recorded; the Warner capture has nonzero validated coverage in the normalized tables required by Step 3.4. An absent, partial, running, stale, or failed capture blocks only that source adapter and cannot be treated as an empty authoritative universe.

#### Step 3.1: Disney adapter

Sources: OPA Property/Character plus DCP Vault Style Guide/Asset metadata across the separated Disney, Lucasfilm, Marvel, and Twentieth Century namespaces.

Requirements:

- use OPA stable IDs for Property/Character identity;
- use DCP stable path/ID contracts already defined in the separated landing migrations;
- do not treat a DCP portal tile as a Property or Franchise unless the source contract explicitly says it is one;
- preserve the already-separated DCP `source_system` names so equal IDs across studios cannot collide;
- reconcile OPA and DCP evidence without assuming display-name equality proves identity.

Verification gate: preview evidence shows every promotable entity has stable source identity and authorized scope; direct Property/Character and Asset/Style Guide relationships reconcile; ambiguous cross-source matches abstain.

#### Step 3.2: NBCU adapter

Sources: Property, IP Family, Character, Style Guide, Asset, and direct relationship tables.

Requirements:

- map IP Family to canonical Franchise while preserving `source_term='IP Family'`;
- preserve the explicit NBCU direct IP Family/Property and Asset/IP Family relationships;
- use existing deterministic fallback keys only where the landing contract already declares them stable;
- keep rights/scope classification as protected source evidence, not public plan content.

Verification gate: preview builds canonical Franchise identities and only direct relationships; same-label collisions stay source-scoped; protected rights data never appears in repository artifacts.

#### Step 3.3: Paramount adapter

Sources: Property, Character, Collection, Franchise, Asset, and direct relationships.

Requirements:

- map source Collection to Style Guide only where the source contract states it functions as one;
- map source Franchise to canonical Franchise;
- promote direct Asset/Franchise, Asset/Property, Asset/Character, Asset/Collection, Property/Character, and Property/Collection edges;
- never promote `plm.pmt_property_franchise_evidence` into `core.property_franchise`; it remains co-occurrence evidence only.

Verification gate: contract test intentionally supplies Property/Franchise co-occurrence and proves the canonical direct bridge remains empty while the evidence view reports it accurately.

#### Step 3.4: Warner adapter

Use the normalized Warner tables, not deprecated combined “Franchise/Property” landing paths.

Requirements:

- treat normalized Franchise and Property as separate entities;
- promote direct Asset relationships and Property/Character;
- keep `plm.wb_franchise_property_evidence` evidence-only unless a future direct source pair is captured;
- retain Warner's full `source_system` identity and fallback identity method.

Verification gate: deprecated combined tables are never read by the canonical adapter; normalized direct edges reconcile; inferred Franchise/Property evidence cannot enter the direct bridge.

#### Step 3.5: consolidated preview proof

Run all four adapters against complete preview captures. Produce sanitized evidence containing counts, hashes, duplicate/orphan totals, freshness, and exception categories only.

Required invariants:

- zero duplicate source identities;
- zero wrong-Licensor writes outside source scope;
- zero canonical relationships derived from co-occurrence;
- zero stale DesignFlow authority reads;
- zero hard deletes;
- every change tied to a source resolution/scope and audit event;
- rerun produces zero changes;
- every unresolved collision appears in DB Data Admin queue.

Performance and lock gate:

1. Restore the same documented preview snapshot and run each full-volume source apply three times from the same starting state; do not compare a mutating first run to idempotent no-op reruns.
2. Set `lock_timeout = '5s'` for the apply transaction and record transaction duration, lock waits, rows examined/changed, and query plans without row values.
3. The apply must not require an unbounded table lock or hold an `ACCESS EXCLUSIVE` lock over the canonical tables during data consolidation.
4. Set the proposed production time budget to the slowest successful full-volume preview apply plus 50 percent. Record the calculated number in the Phase 3 evidence and carry it into the production package. A production timeout is a stop signal, not permission to raise the budget during the run.

Verification gate: `docs/verification/licensing-master-data-phase3-<date>/README.md` records the exact preview project, restored-snapshot identity, capture IDs/hashes, commands, exit codes, invariant totals, three-run timing/lock evidence, and calculated production budget without licensed values.

### Phase 4: guarded ColdLion Active/Inactive

#### Step 4.0: build ColdLion-to-canonical mapping with bounded ColdLion identity authority

Reuse and rehome the existing approved resolution evidence from `plm.erp_licensor`, `plm.erp_property`, and `plm.taxonomy_resolution_review` into the durable source-resolution contract from Step 2.1. ColdLion may set canonical Licensor names. Automated matching may link stable source identities using approved aliases and exact unambiguous keys. It may set Property name and owning Licensor only for a ColdLion-only Property under a Licensor proven to have no authorized scrape data; inside scrape coverage it may not override portal-authoritative Property values.

ColdLion legacy-to-durable status map:

| `erp_*`.resolution_status | `plm.source_resolution`.resolution_status | Rule |
|---|---|---|
| `unresolved` | `unresolved` | No decision. |
| `auto_matched` | `matched` | Preserve target and record automation reason. |
| `manually_matched` | `matched` | Preserve target, actor, timestamp, and approved-link history. |
| `new_candidate` | `no_match` | No existing canonical target; eligible for reviewed create-new, never automatic insert. |
| `ambiguous` | `ambiguous` | Keep in active review. |
| `quarantined` | `deferred` | Preserve quarantine reason; no promotion. |
| `ignored` | `rejected` | Preserve terminal ignored reason; no promotion. |

For `plm.taxonomy_resolution_review`, only `approved_link` creates a durable `matched` decision. `ignored` and `dismissed` remain terminal review history with their original reason; they do not invent a canonical target. Count/target/actor/timestamp parity must pass before switching readers.

Required review behavior:

- approved existing links retain their decision history and are not re-decided on every pull;
- ambiguous or conflicting keys enter the DB Data Admin licensing queue;
- an unmatched ColdLion Property under a Licensor with no authorized scrape data may use a guarded create-new action with ColdLion's canonical name and ownership; ambiguous identity or coverage requires Licensing review;
- the new reviewed Property is inserted `potential`, with the ColdLion source reference and reviewer/audit facts, then Step 4.1 may set it Active because it is present;
- ColdLion Licensor names are canonical; ColdLion Property spelling and ownership may write only outside authorized scrape coverage;
- if a later authorized portal scrape covers that Property, the scrape spelling and ownership win, the previous reviewed/ColdLion wording becomes an alias, and the change enters history.

Retarget `tools/promote-coldlion-source-owned.mjs`, every `plm.promote_coldlion_source_owned` replacement, DB Data Admin mapping APIs/UI, readiness tools, and recurring-cycle tests to read/write `plm.source_resolution`. Only after parity and all callers pass may the migration freeze `plm.erp_licensor`/`plm.erp_property` resolution columns as read-only evidence. The raw ColdLion mirror fields remain refreshable; only the legacy match-decision fields freeze.

Dependency: Steps 1.0, 2.1–2.5, and a complete guarded ColdLion capture. Unresolved source rows do not freeze the whole catalogue. They remain in review, and only specific canonical candidate rows that the unresolved source row might represent are protected from an Inactive change until resolved.

Allowed terminal exclusion reasons are limited to: reviewed non-Property record; reviewed duplicate of an already mapped ColdLion key; outside the authorized division/Licensor scope proven by `plm.licensing_source_scope`; or reviewed ignored/dismissed record with actor, timestamp, and reason. “Unmatched,” “unknown,” missing data, or a display-name mismatch is not an exclusion.

Verification gate: every legacy status maps exactly as the table above; approved-link count/target/actor/timestamp parity passes; old and new mapping views return the same resolved targets before cutover; all named tools/functions/UI write durable resolution only; attempted post-cutover writes to `erp_*` decision columns fail loudly; ColdLion can write Licensor names and uncovered ColdLion-only Property truth but cannot override scrape-covered Property values; ambiguous create-new refuses without review; an uncovered ColdLion-only fixture starts `potential`, becomes Active through Step 4.1, and is later superseded correctly when authorized scrape coverage appears while retaining its alias/history.

#### Step 4.1: replace old promotion authority with membership-only status logic

Reuse the proven ColdLion pagination, completeness, shrink, serialization, alert, and cycle-state tooling in:

- `tools/sync-coldlion-licensors-properties.mjs`
- `tools/promote-coldlion-source-owned.mjs`
- `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs`
- `.github/workflows/coldlion-licensor-property-production.yml`

Step 1.0 has blocked unbounded legacy writers. Replace the retired promotion path with a hash-pinned plan/apply function that can write official Licensor names, uncovered ColdLion-only Property identity, and `core.property.status` only within the settled authority boundaries. It must never overwrite scrape-covered Property identity and must obtain a transaction-bound ColdLion authorization from the Step 1.0 table guard.

Behavior:

- a canonical Property durably mapped to a ColdLion key present in the complete current set becomes Active;
- a canonical Property whose durable ColdLion key is absent from the complete current set becomes Inactive;
- a scrape-only canonical Property with no ColdLion key and no unresolved ColdLion candidate pointing at it is a resolved absence and becomes Inactive, matching the settled “only present in ColdLion is Active” rule;
- canonical rows named as candidates for an unresolved ColdLion record retain their prior status, or remain Potential if new, while that record stays in review; they are the bounded fail-closed exception and do not block status changes for other rows;
- unmatched ColdLion rows enter review and cannot create guessed spelling or ownership or directly receive canonical status;
- short/failed/incomplete pulls make no status changes;
- proposed Active/Inactive changes are reviewable and hash-pinned;
- no Property is deleted;
- rerun is idempotent.

Verification gate: fault tests for short pull, missing division, pagination loss, duplicate key, suspicious shrink, and stale plan all refuse mutation. An unresolved fixture protects only its candidate canonical rows while unrelated mapped/present rows activate and resolved-absence rows deactivate. Invalid exclusion reasons refuse. A complete two-cycle rehearsal activates/preserves/deactivates exactly the expected fixture Properties without renaming or re-parenting them; the status function cannot obtain authority for name, code, or `licensor_id`.

#### Step 4.2: remove DesignFlow comparison from authority decisions

Historical DesignFlow comparison can remain as a diagnostic labelled non-authoritative, but readiness and promotion must not require DesignFlow agreement or use it to set canonical values. This check includes DesignFlow API payloads and the `plm.import_master_data`/`systemd/plm-sync.timer` route, not only `dflow.*` tables.

Verification gate: repository search, function-definition capture, caller inventory, and tests prove no canonical licensing write reads `dflow.*`, DesignFlow Cloud SQL, or DesignFlow API data; `plm.import_master_data` refuses licensing writes; `systemd/plm-sync.timer` remains stopped. Diagnostic outputs say “historical comparison,” never “source of truth.”

### Phase 5: DB Data Admin review and audit surface

#### Step 5.1: expand server-side APIs

Extend or add `api.*` RPCs/views for:

- the six canonical entity lists;
- direct relationships and separately labelled evidence-only observations;
- unresolved/ambiguous source identities and edges;
- alias review;
- complete source freshness and weekly due/failure state;
- dry-run consolidation plans;
- ColdLion Active/Inactive proposal review;
- source resolution writes through guarded functions only.

Keep Customer/Vendor/Merge/Product Depth administrator gates unchanged. Licensing Master Data uses `app.require_licensing_manager_access()` and explicit PLM access as established by migration `20260814000000_licensing_manager_gate.sql`.

Verification gate: SQL tests prove Licensing users can review licensing data but cannot use unrelated administrator RPCs; anonymous users have no access; direct table writes remain blocked.

#### Step 5.2: implement the UI

Target files after the implementer rechecks current layout:

- `apps/db-data-admin/src/DataAdmin.tsx`
- existing `LicensorTree` components and tests;
- new focused components under `apps/db-data-admin/src/` for Characters, Style Guides, Franchises, Assets, relationships, source resolution, and freshness;
- reusable filters in `apps/db-data-admin/src/lib/grid-filters.ts`, never a duplicate filter implementation.

Required behavior:

- browse all six entity types and their direct relationships;
- see source identities, aliases, last successful capture, and Active/Inactive reason;
- clearly distinguish direct relationships from evidence-only co-occurrence;
- resolve ambiguous entity/edge matches with reason and audit trail;
- preview a consolidation/status plan before apply;
- no delete control for canonical entities;
- loud, specific errors and stale-data warnings.

Verification gate: unit tests cover permissions, ambiguity, stale/failed source, evidence labels, no-delete behavior, optimistic-lock conflict, and Active/Inactive reason. Serve locally and capture screenshots at desktop and narrow widths. Verify as a Licensing user and Administrator without using the emergency bypass.

### Phase 6: weekly source operations and freshness alerts

Natural fresh-session cut point: one source repository per session unless context remains small. Re-read the source-specific skill before each source.

#### Step 6.1: add weekly automation in each private source repo

For Disney, NBCU, Paramount, and Warner:

1. refresh the private repo from `origin/main` and preserve unrelated work;
2. use its source-specific skill and authorized login method;
3. add a weekly scheduled workflow or approved runner that captures to the private repo's protected artifact path and loads the corresponding `plm.*` landing tables through the existing guarded importer;
4. never commit captured licensed rows to a public repo;
5. record start/success/failure, capture identity, row-count basis, completeness, and freshness in shared Supabase;
6. trigger consolidation only after complete validation;
7. alert on missed schedule, failed capture, partial capture, suspicious shrink, load failure, or consolidation failure.

If a portal cannot be safely automated, schedule a weekly due event and exact operator action, then record success only after the guarded capture completes.

Verification gate: each source completes two preview cycles plus one injected failure. The second identical cycle is idempotent; the failure creates a visible alert and does not change canonical data.

#### Step 6.2: add shared freshness monitoring

Create a source-health API and alert workflow that reports:

- last attempted and last successful complete capture;
- next due time;
- current overdue/failure state;
- latest complete count basis;
- last consolidation plan/apply state;
- unresolved exception counts.

Do not expose licensed values in alerts. Use source/system names, counts, timestamps, hashes, and failure categories.

Escalation is deterministic and idempotent:

1. At the first missed weekly deadline, mark the source overdue and alert Licensing plus the technical owner. Do not change canonical data.
2. At the second consecutive missed weekly deadline, atomically set `plm.licensing_source_scope.is_enabled = false`, record the reason/timestamp, and page a human. Count each scheduled boundary once, not every monitor poll.
3. A disabled scope blocks consolidation but preserves the last canonical entities and relationships exactly as they were.
4. A disabled scope may run validation and a read-only recovery dry run, but cannot apply canonical changes. Re-enable only after a new complete validated capture, that successful dry run, and an audited Licensing/administrator acknowledgement. Clearing an alert must not erase failure history or re-enable automatically.

Verification gate: a simulated first missed boundary alerts without changing scope; the second consecutive missed boundary disables the scope exactly once and pages a human; repeated monitor polls are no-ops; a complete capture alone does not re-enable; reviewed recovery re-enables without erasing failure history.

### Phase 7: consumer application cutover

For each consumer repo, first read its own `AGENTS.md`. Database structure remains in shared-db; app repos change only code, generated types, tests, and docs.

#### Step 7.1: cut every consumer over to canonical APIs

Sequence:

1. DB Data Admin uses canonical APIs first.
2. PopDAM switches licensing entity/relationship reads to canonical APIs and `dam.asset` bridges.
3. PopPIM/PM uses canonical licensing pickers and relationships.
4. PopCRM uses canonical Licensor/Property display contracts where applicable.
5. Six DesignFlow services switch reads from `dflow.*` licensing tables to canonical Supabase APIs according to their sandbox/develop rules. DesignFlow never becomes a writer of canonical truth.

Verification gate per app: unit/integration tests pass, real signed-in user journey works, no network/API call reads DesignFlow licensing truth, and generated types match the applied preview schema. UI changes have screenshots.

#### Step 7.2: retire compatibility scalar fields and views in a separate post-cutover migration

After every Step 7.1 consumer is deployed and verified, run repository-wide searches plus live API/query telemetry for `core.character.property_id`, `core.style_guide.property_id`, scalar Asset Property/Licensor fields, and every compatibility view/API. Observe at least one normal business cycle with zero readers. Then reserve a new migration version and exact object claims to remove only the proven-unused columns, constraints, views, and compatibility code.

Remove only tests that directly require the retired scalar columns. The relationship-axis test was already replaced in Step 2.3 and must remain green. Do not bundle this removal into the Phase 1 additive migrations or an application repository.

Verification gate: the evidence names every searched repository and deployed version, includes the telemetry window with zero readers, proves current bridge counts/invariants before and after, and shows all consumers remain green against the removal migration on preview. Recovery is the tested compatibility-view restoration migration, not deletion of canonical bridges.

### Phase 8: governed production landing and monitoring

This is a separate fresh session. Production is not authorized by this plan.

#### Step 8.1: assemble the exact bounded production package

Enter the orchestrator's §12.1 pre-apply merge freeze before taking the final ledger snapshot. Re-run production ledger drift, rebase each migration from current `main`, and include only this plan's prerequisites and migrations proven together on preview. The held bundle `20260802170000` and `20260802171000` is excluded unless its separate hold is explicitly released and it is reviewed as part of the exact package; never pull it in merely because it is pending. Respect every retired, held, and unrelated pending version. Use the shared production workflow's immutable evidence and business-risk gate.

The Step 1.0 protection is table-level and must remain effective regardless of which `plm.import_master_data` function body exists. In preview, install the guard, then apply or replay the exact function definition from held migration `20260802170000` and prove its attempted ownership/status writes are refused. If the held FRIENDS/FRIDA bundle is ever released later, its package must include this regression proof and post-apply trigger/guard verification; replacing the function never counts as replacing or weakening the guard.

Verification gate: merge-freeze evidence and a final unchanged ledger snapshot exist; the package names exact migration versions, explicit included/excluded held versions, immutable review artifacts, preview apply proof, current-main SHA, rollback path, performance/lock budget, and every consumer compatibility result. A held-function replay test and catalog check prove the table-level guard survives. The workflow accepts the package without overrides.

#### Step 8.2: promote structure, then curated data, then consumers

Order:

1. structural migrations;
2. object/grant/RLS verification;
3. source-resolution and consolidation dry run;
4. governed curated Master Data apply, source by source;
5. ColdLion status reconciliation;
6. read-only application smoke tests;
7. enable weekly schedules one source at a time;
8. intensified monitoring at immediate, +1 hour, +4 hours, +24 hours, and after the first weekly boundary.

Every production write must prove and quote project `qsllyeztdwjgirsysgai` immediately before execution.

Scrape-created Properties enter as `potential`. Canonical consumer APIs and new application readers remain disabled until the same bounded release completes ColdLion reconciliation and proves every Property has the expected Active/Inactive result. If ColdLion reconciliation fails, do not cut consumers over and do not change new rows to Active manually.

Verification gate: exact production catalog matches the approved structure; source and relationship invariants are zero-failure; all apps read canonical contracts; live build SHAs are verified where apps changed; weekly monitors are enabled and healthy.

#### Step 8.3: retire superseded paths safely

Only after sustained verified operation:

- remove the already-blocked DesignFlow licensing importer callers and retire `systemd/plm-sync.timer` only after proving no unrelated required behavior depends on them;
- remove compatibility scalar columns/views;
- retain historical evidence and aliases;
- remove deprecated landing paths only when their replacement captures are complete and rollback no longer depends on them;
- update this plan STATUS and delete its paired handoff only when #1090 is genuinely complete.

Verification gate: repository-wide and runtime checks show zero consumers, no canonical writes from DesignFlow, and rollback remains possible through commits/database backups/evidence before each destructive retirement.

---

## 10. Tests required

### SQL contract tests

Add focused files under `supabase/tests/` covering:

- `licensing_canonical_entities_contracts.sql`
  - six canonical homes exist;
  - no scalar Character/Style Guide Property authority after cutover;
  - scrape-created Property explicitly starts `potential` and cannot use the `active` default;
  - RLS, grants, FKs, restrict behavior, and indexes.
- `licensing_relationship_evidence_contracts.sql`
  - many-to-many behavior;
  - canonical endpoint-pair identity stays stable while companion source rows allow two sources to support one pair;
  - bridge-based Style Guide/Character/Property invariant replaces the retired scalar invariant;
  - direct versus co-occurrence rejection;
  - multi-source support and current-edge calculation;
  - no endpoint cascade destruction.
- `licensing_source_resolution_extensions.sql`
  - Licensor/Franchise resolution;
  - wrong-kind rejection;
  - audit and optimistic locking;
  - preservation and count/target parity of existing landing-table decisions;
  - portal decision columns freeze in Step 2.1;
  - ColdLion status-word mapping, tool parity, and delayed `erp_*` decision-column freeze in Step 4.0.
- `licensing_source_scope_contracts.sql`
  - full `source_system` authorization and exact identity-key compatibility;
  - cross-Licensor/kind refusal;
  - disabled scope refusal;
  - first/second missed-deadline escalation and reviewed re-enable.
- `licensing_consolidation_contracts.sql`
  - dry-run hash;
  - idempotency;
  - spelling/ownership authority;
  - ownership-change history;
  - new Property `potential` status and matched Property status preservation;
  - alias preservation;
  - missing-source retention;
  - ambiguous-match abstention;
  - stale DesignFlow non-authority.
- `licensing_write_authority_guard_contracts.sql`
  - direct and legacy-function protected-column writes refuse without transaction-bound authorization;
  - authorized scrape writes can change only official identity/ownership fields;
  - authorized ColdLion writes can change Licensor names, uncovered ColdLion-only Property identity, and Property status, but cannot override scrape-covered Property truth;
  - DesignFlow PLM payload and current ColdLion promotion body produce zero protected-column changes;
  - replaying held function definition `20260802170000` cannot bypass the table guard;
  - unrelated retained importer behavior cannot reach licensing tables.
- `licensing_canonical_merge_contracts.sql`
  - complete source/alias/edge repointing;
  - merged tombstone traceability;
  - conflicting scope abstention;
  - audited reversal without loss.
- `coldlion_property_status_contracts.sql`
  - durable mapping and reviewed create-new behavior;
  - exact legacy-to-durable status map and parity;
  - membership-only mutation;
  - fail-closed short/partial input;
  - unresolved records protect only their candidate canonical rows;
  - allowed exclusion reasons only;
  - no automatic rename/re-parent/delete.
- `db_data_admin_licensing_contracts.sql`
  - licensing access boundaries;
  - review/audit functions;
  - evidence labels and freshness.

### Node/tool tests

Add or extend:

- source adapter unit tests for Disney, NBCU, Paramount, and Warner;
- two-cycle consolidation rehearsal tests;
- three-run restored-snapshot performance and lock-budget test;
- incomplete-capture refusal tests;
- ColdLion status fault matrix;
- legacy ColdLion promotion retirement and durable-resolution caller tests;
- Warner complete-capture prerequisite test;
- weekly schedule mapping and missed-run alert tests;
- workflow contract tests ensuring licensed values cannot enter logs/artifacts.

### DB Data Admin tests

Use Vitest/Testing Library for:

- each entity/relationship view;
- licensing versus administrator permissions;
- ambiguous resolution and optimistic conflict;
- ColdLion mapping/create-new review and later scrape supersession;
- duplicate canonical merge preview, apply, and reversal;
- source freshness/overdue/failure;
- evidence-only label;
- no delete controls;
- Active/Inactive reason and proposed change review;
- server error visibility.

### Existing suites that must stay green

- repository SQL migration guards;
- ephemeral Supabase database tests;
- `tools-offline-tests` workflow;
- DB Data Admin `npm test`, build, and container checks;
- ColdLion promotion contract suite;
- source-resolution durability/coherence/race suites;
- source-specific importer tests;
- `git diff --check`.

A flaky test may be rerun once only after its full log proves it is unrelated. A repeated failure is a blocker, not permission to merge.

---

## 11. Constraints, standing rules, and gotchas

1. `shared-db` uses branch + PR; the AI owns the merge after review/checks. Structural implementation is dispatched by the single orchestrator to isolated worktrees.
2. At most three migration authors; exact object locks and versions come from `manage-migration-author-lanes.mjs`.
3. Preview apply, merge, and production are serialized one at a time.
4. No direct production database change, dashboard SQL, broad migration apply, Terraform apply, or mutating GCP command.
5. Read the ledger before claiming an object is missing. Exit 2 is not a clean result.
6. Prove the database target immediately before every data write. Production is `qsllyeztdwjgirsysgai`; preview is `rjyboqwcdzcocqgmsyel`.
7. Outside-sourced writes into curated Master Data remain under §6.4 governance. The only matched-row exception is the owner-approved guarded consolidator for an authorized full `source_system` and complete validated capture, limited to the facts that source owns and backed by durable resolution, scope, dry-run hash, and audit. Ad-hoc API pulls, spreadsheets, pasted rows, and direct SQL remain fully abstention-bound.
8. Licensed source rows never enter this public repo, issues, PRs, logs, or outside AI prompts.
9. Fetch 1Password secrets serially from vault `vibe_coding`; never print or store values.
10. DesignFlow data is non-authoritative historical evidence only.
11. ColdLion automation writes official Licensor names, uncovered ColdLion-only Property truth, and Property status after durable mapping and guarded reconciliation. It never overwrites scrape-covered Property names or ownership. Ambiguous identity or coverage requires Licensing review.
12. Never hard-delete canonical licensing entities during refresh.
13. Do not infer direct relationships from names, paths, folders, or co-occurrence.
14. `dam.asset` is metadata, not the licensed binary.
15. Do not create competing canonical tables.
16. DB Data Admin's existing reusable Text + Set grid filter must be reused.
17. UI work requires serve + screenshot verification as real permitted roles.
18. Every fallback alerts loudly; no silent skip of a source or schedule.
19. Preserve recovery before destructive retirement: merged commit, preview proof, rollback SQL/backup, and verified zero consumers.
20. Existing private source repo working copies may contain other sessions' files. Never stage, edit, delete, or tidy unrelated work.
21. A table-level protected-column guard must block `plm.import_master_data`, current/held replacement bodies, and current ColdLion promotion before canonical consolidation. `systemd/plm-sync.timer` and old ColdLion promotion workflows remain stopped until retired or retargeted to narrow guarded functions.
22. Phase 1 is additive compatibility work. Scalar and compatibility removal happens only in Step 7.2 after deployed-reader evidence.
23. The Phase 8 production package enters a merge freeze and explicitly excludes held versions `20260802170000` and `20260802171000` unless their separate hold is released.

---

## 12. Access and environment

### Available tools

- GitHub CLI `gh` was authenticated during planning.
- Supabase CLI is installed; authenticate through 1Password, never inline credentials.
- 1Password CLI `op` uses vault `vibe_coding`.
- Node.js and PowerShell are available on Windows machine `al8960ofc`.

### Secret locations, names only

- Supabase management token: vault `vibe_coding`, item `Supabase CLI Personal Access Token`, field `SUPABASE_ACCESS_TOKEN`.
- Preview database password: vault `vibe_coding`, item `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`, field `password`.
- Production database password: vault `vibe_coding`, item `Supabase DB Password - shared POP database`, field `password`.
- ColdLion and portal credentials: use the source-specific skill and the corresponding private repo's approved 1Password references. Never copy their values into this plan.

On this Windows machine, injected environment values do not cross into bare WSL `bash`. Use native PowerShell, `cmd`, or Node for secret-injected commands.

### Repositories and branches

- Canonical structure: `C:\repos\shared-db`, branch per orchestrator claim, PR to `main`.
- Four private source repositories: paths listed in §2, main-only unless their own `AGENTS.md` says otherwise.
- Consumer app repositories follow their own branch rules. The six `popcre/designflow-*` repos use Albert's sandbox branch and PRs to `develop`; never self-merge those PRs.

### Required source-specific skills

- Disney: `disney-source-data-scrape`
- NBCU: `nbcu-creative-assets-scrape`
- Paramount: `paramount-creative-library-scrape`
- Warner: `wb-starlabs-scrape`
- shared structural work: `shared-db-orchestrator`
- stopping/handing off shared work: `shared-db-handover`

---

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] All six canonical entity types have one documented and applied home.
- [ ] Character/Property and Style Guide/Property are many-to-many with scalar authority removed.
- [ ] All direct relationship bridges carry stable source evidence and freshness.
- [ ] Franchise is canonical and preserves source terminology.
- [ ] `dam.asset` supports all required canonical relationships without storing binaries here.
- [ ] Durable source resolution supports all six entity kinds and preserves existing decisions.
- [ ] Every approved legacy landing-resolution decision is backfilled with parity proof and the legacy columns are read-only.
- [ ] Source scope prevents cross-Licensor/source writes.
- [ ] `plm.import_master_data` and every DesignFlow/PLM sync caller cannot write licensing canonical values.
- [ ] The table-level guard blocks current and held legacy function bodies and permits only exact scrape-identity or ColdLion-status column sets through hash-pinned plans.
- [ ] Existing ColdLion promotion functions/workflows cannot write names, codes, or ownership before the first authoritative scrape apply.
- [ ] All four source adapters pass complete/incomplete/idempotency tests on preview.
- [ ] A complete validated Warner preview capture exists before Warner consolidation.
- [ ] Every scrape-created Property starts `potential`; consolidation never sets Active/Inactive.
- [ ] ColdLion changes official Licensor names, uncovered ColdLion-only Property truth, and Property Active/Inactive only within its authority scope, and fails closed on bad input.
- [ ] ColdLion-to-canonical mapping supports guarded create-new outside scrape coverage and refuses to overwrite scrape-covered Property truth.
- [ ] ColdLion tools use durable resolution, the published status map passes parity, and legacy `erp_*` decision columns are frozen only after caller cutover.
- [ ] Duplicate canonical entities have one reversible, audited merge path with complete relationship/source repointing.
- [ ] DB Data Admin supports review, aliases, direct/evidence distinction, status reason, freshness, and audit for Licensing users.
- [ ] Weekly automation or explicit weekly due action exists for all four sources, with missed/failed-run alerts.
- [ ] Two consecutive missed weekly deadlines disable the affected source scope and require reviewed recovery.
- [ ] Consumer applications read canonical APIs and no longer read licensing truth from DesignFlow.
- [ ] All new and existing tests are green.
- [ ] Independent review has no unresolved Critical or High finding.
- [ ] Migrations are preview-proven, merged, and applied through the governed production lane.
- [ ] Three restored-snapshot full-volume preview rehearsals establish the production duration/lock budget.
- [ ] Production object, data-invariant, application, and weekly-monitor verification pass.
- [ ] Every repo change is committed with Albert's identity, pushed, CI green, and deployed SHA verified where applicable.
- [ ] This plan's STATUS, central architecture, app docs, and handoffs match reality.
- [ ] #1090 is closed only after the entire implementation is verified. The architecture document remains permanent.

### Principal risks and controls

| Risk | Control | Rollback/recovery |
|---|---|---|
| Wrong portal entity matched to canonical row | Stable source IDs, scope gate, ambiguity abstention, human review | Reverse audited resolution/merge; canonical IDs retained |
| Stale DesignFlow value re-enters | No canonical writer reads DesignFlow; contract search/test | Disable offending writer, restore from prior canonical audit, replay authoritative source |
| A legacy DesignFlow or ColdLion function overwrites authority | Table-level protected-column guard, stopped callers, held-function replay test | Keep callers stopped, verify guard, restore prior canonical audit, replay authorized source |
| New scraped Properties appear Active before ColdLion | Explicit `potential` insert and contract test; consumers remain gated through status reconciliation | Keep consumer cutover disabled; rerun guarded ColdLion plan, never manually mass-activate |
| Short scrape retires relationships | Complete-capture gate and shrink/freshness checks | No apply occurs; prior current edges remain |
| ColdLion mass-deactivates | Hash-pinned plan, complete pagination/division checks, max shrink, preview | Reapply prior status snapshot through audited rollback plan |
| One unresolved ColdLion row blocks or misclassifies the whole catalogue | Candidate-scoped status protection and enumerated exclusions | Leave only candidate rows unchanged, resolve review, rerun hash-pinned status plan |
| Scalar-to-bridge cutover breaks apps | Compatibility API, consumer inventory, staged cutover | Restore compatibility view/column from migration rollback while bridges remain |
| Co-occurrence becomes false direct relationship | Evidence-kind constraints and source adapter tests | Remove rejected edge through audited plan; source evidence remains |
| Production pending migrations collide | Ledger drift check, exact bounded package, serialized merge/promotion | Stop before apply; never broad-push the pending set |
| Licensed data leaks publicly | Aggregate-only evidence and source-specific private repos | Remove current-version exposure per policy and incident procedure; never publish row values |
| Weekly automation silently stops | due-state and missed-run alerts independent of capture job | Manual approved capture while automation is repaired; never mark stale data fresh |
| Duplicate merge loses source or relationships | Hash-pinned whole-graph merge plan, tombstone, audit, reversal test | Apply audited reversal plan; source evidence and old ID remain traceable |

### Open questions

No business-design question is open at plan creation. Technical implementation judgments are listed in §8 and have decision criteria. If implementation discovers a source fact that conflicts with the settled authority matrix, stop that source, preserve evidence privately, and ask Albert one plain-language question before changing the central architecture.

### Rollback principle

Prefer forward-compatible, additive phases. Before dropping scalar columns or disabling old readers, prove zero consumers and retain a merged commit plus database backup/rollback script. Never roll back by deleting newly consolidated canonical identities or source evidence. Disable the new writer, restore the prior API compatibility surface, and correct forward.

---

## Mandatory self-audit

### Objective checklist

- [x] All 13 required sections are present.
- [x] The ultimate goal is first, plain, and contains the “goal wins” rule.
- [x] A fresh session can start at Phase 0 without this chat.
- [x] Rejected approaches and failed framings are recorded with reasons.
- [x] Every implementation step names targets and has a verification gate.
- [x] Locked decisions and technical judgments are separated.
- [x] Out-of-scope work is explicit.
- [x] Tests are named by behavior and file.
- [x] Projects, paths, source repos, credentials by title, tools, and SHAs are defined.
- [x] No secret value or licensed row content is included.
- [x] Definition of done covers commit, push, CI, governed production apply, app/deploy proof, docs, and handoff retirement.
- [x] This plan and its paired handoff link to each other; `AGENTS.md` and the topic architecture link to the plan.
- [x] Every GLM 5.3 High, Medium, and Low finding has an explicit disposition in §6.1 and an executable correction in §9–13.
- [x] Every Grok 4.6 High, Medium, and Low finding has an explicit disposition in §6.2 and an executable correction; the same Grok session reread the completed revision and returned Ready.

### Required synthesis answers

1. **Could a brand-new AI session with no project knowledge execute this plan without asking a question? Yes.** Sections 1–4 explain the business, product, trigger, and boundaries. Sections 5–8 preserve current state, GLM's complete correction ledger, rejected approaches, and locked decisions. Section 9 now has one STATUS row and one executable, verified step for every unit of work, including the importer guard, durable mapping backfill, Warner prerequisite, ColdLion mapping, duplicate merge, freshness escalation, scalar retirement, performance budget, merge freeze, and held versions. Sections 11–13 provide rules, access, risks, rollback, and completion criteria.
2. **Does the plan carry the background, nuance, and reasoning held by the planning session? Yes.** Sections 5–7 record the conflicting scalar/bridge shapes, pending source-resolution migrations, source landing inventory, absent weekly schedules, DesignFlow API overwrite path, Active default, legacy resolution dual truth, Warner capture gap, duplicate-merge need, production ledger drift evidence, subordinate older plans, and every GLM and Grok finding/disposition. The paired handoff preserves failed review attempts and the reason ColdLion proposals still require Licensing confirmation.
3. **Is the goal clear enough to guide a correct judgment when a step is wrong? Yes.** Section 1 defines the desired business state and explicitly says the goal wins. Section 8 separates locked authority decisions, fixed implementation choices, and bounded technical measurements. Sections 9 and 13 say how to stop, preserve evidence, and escalate a genuine new authority conflict without redesigning the model.

No gap remained after the final audit.
