# Implementation plan: official licensing Master Data in Supabase

**Plan status:** OPEN

**Settled architecture:** [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md)

**Implementation tracker:** [GitHub #1090](https://github.com/u2giants/shared-db/issues/1090). The architecture is not an issue. #1090 tracks execution only.

**Paired handoff:** [`HANDOFF.d/2026-08-16T2342Z-al8960ofc-codex-licensing-master-data-plan.md`](HANDOFF.d/2026-08-16T2342Z-al8960ofc-codex-licensing-master-data-plan.md)

**Repository:** `u2giants/shared-db`

**Starting commit used for this plan:** `fa59fd151dcc233d81a752a1cb283c0026ff731c`

**Fresh-session starting point:** Phase 0, Step 0.1. Re-read the settled architecture, refresh `origin/main`, audit the current migration ledger and live catalog, then claim the first exact-object migration lane. Do not begin from the older Character/Style Guide or ColdLion plans without applying this plan's supersession rules.

## STATUS

| Step | State | Date | Evidence / next action |
|---|---|---|---|
| 0.1 Reconfirm repository, ledger, live catalog, and object ownership | ⬜ Open | 2026-08-16 | Start here. Produce `docs/verification/licensing-master-data-phase0-<date>/` from the commands in §9. |
| 0.2 Reserve migration lanes and versions | ⬜ Open | 2026-08-16 | After 0.1. Claim exact objects with `scripts/manage-migration-author-lanes.mjs`; never choose versions manually. |
| 1. Canonical entity and relationship foundation | ⬜ Open | 2026-08-16 | Implement Phase 1 migrations and contract tests on an isolated branch. |
| 2. Durable resolution, provenance, and consolidation engine | ⬜ Open | 2026-08-16 | Depends on Phase 1 and on merged migration `20260814224937` being present in the target ledger. |
| 3. Four licensed-source adapters and preview consolidation | ⬜ Open | 2026-08-16 | Disney, NBCU, Paramount, and Warner, one source at a time. No production data write. |
| 4. Guarded ColdLion Active/Inactive calculation | ⬜ Open | 2026-08-16 | Depends on canonical Property mappings and a complete guarded ColdLion cycle. |
| 5. DB Data Admin review and audit surface | ⬜ Open | 2026-08-16 | Depends on Phases 1–4 API contracts. Requires visual verification. |
| 6. Weekly source operations and freshness alerts | ⬜ Open | 2026-08-16 | Requires private source-repo work plus shared database run evidence. |
| 7. Consumer application cutover | ⬜ Open | 2026-08-16 | Begins only after preview canonical contracts are stable. No app-repo schema changes. |
| 8. Governed production landing and monitoring | ⬜ Open | 2026-08-16 | Separate fresh session after all earlier gates and explicit production-risk approval where required. |

Every implementing session must update this table, the current-state sections it changes, and its verification evidence before stopping. A row marked complete must cite an artifact or commit, never a remembered count.

---

## 1. Ultimate goal

POP will have one official, shared licensing catalogue in Supabase for Licensors, Properties, Characters, Style Guides, Asset metadata, and Franchises. Every POP application will read the same records and relationships.

The authorized licensor portals will control official names, Property ownership, entities, and direct relationships. ColdLion will control only whether a Property is Active or Inactive. The stale DesignFlow pull will have no authority. All four authorized source programs will refresh at least weekly, with visible freshness, failure, and review information.

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

- authorized licensor scrapes are canonical for Property spelling and owning Licensor;
- those scrapes are canonical for Characters, Style Guides, Asset metadata, Franchises, and direct source-published relationships;
- ColdLion decides Property Active/Inactive only;
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
| `core.property` | same file, line 191 | One nullable `licensor_id`, name, code, status | Correct one-Licensor shape; needs guarded scrape authority and ColdLion-only status calculation |
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
- no source-scope table proving which canonical Licensor a portal namespace represents;
- no canonical relationship-resolution record for direct source edges.

Production ledger evidence from GitHub Actions run `31979756895` on 2026-08-16 showed 467 versions on `main`, 453 applied, and 14 merged-but-not-applied versions. The source-resolution migrations were among the genuinely pending set. This plan must not assume those objects exist in production and must not promote the unrelated pending set as a batch.

### 5.4 Source landing tables already exist

- Disney OPA: `plm.opa_property_character` plus normalized OPA entity migrations.
- Disney DCP Vault: `plm.dcp_crawl`, `plm.dcp_style_guide`, `plm.dcp_asset`, crawl/gap/load-exception tables, and the separated Disney/Lucasfilm/Marvel/Twentieth Century variants.
- Paramount: `plm.pmt_property`, `plm.pmt_character`, `plm.pmt_collection`, `plm.pmt_franchise`, `plm.pmt_asset`, direct relationship tables, and `plm.pmt_property_franchise_evidence` for co-occurrence only.
- NBCU: `plm.nbcu_property`, `plm.nbcu_ip_family`, `plm.nbcu_character`, `plm.nbcu_style_guide`, `plm.nbcu_asset`, and direct relationship tables.
- Warner: normalized `plm.wb_franchise`, `plm.wb_property`, `plm.wb_character_normalized`, `plm.wb_style_guide_normalized`, `plm.wb_asset_normalized`, direct Asset relationships, Property/Character, and `plm.wb_franchise_property_evidence`.

Do not duplicate these tables. Source adapters must read their latest complete, validated capture contracts.

### 5.5 Current operational scheduling

ColdLion has preview and production workflows with daily snapshot/promotion/comparison and hourly health lanes in `.github/workflows/coldlion-licensor-property-*.yml`.

The four private licensor-source repositories had no checked-in `.github/workflows` schedules in the local clean/current copies inspected on 2026-08-16. Their working copies and branches must be refreshed before implementation. Weekly licensor refresh automation is therefore not complete.

### 5.6 Existing plans that are now subordinate

- `fix_characters_style_guides.md` contains useful historical measurements and tools, but its one-Property-per-Character and DesignFlow-source assumptions are superseded.
- `plan_coldlion_licensor_property_accelerated_cutover.md` contains useful ColdLion safety tooling, but its statements that ColdLion controls canonical names or that DesignFlow retains parent authority are superseded.
- `docs/style-guides-characters-and-royalties.md` is useful for royalty and likeness details but is explicitly subordinate to the 2026-08-16 central architecture.

Do not execute an old phase merely because its status says open. Re-derive each relevant step under this plan.

---

## 6. Key findings and root cause

1. The source capture layer is substantially built, but consolidation into canonical tables is not. Landing evidence and canonical application truth are different layers.
2. The original June schema encoded `core.character.property_id`, which makes one Property per Character structural. The later `core.property_character` bridge contradicts that scalar but did not remove it. Two competing ownership shapes now exist.
3. `core.style_guide.property_id` similarly encodes one Property, while the settled architecture allows every direct source-published relationship and therefore needs a bridge.
4. Franchise data exists in source-specific tables but has no canonical `core.franchise` home.
5. `dam.asset` is the established canonical metadata home and already has application relationships. Creating `core.asset` would create a competing canonical table. The plan therefore extends `dam.asset` and its bridges.
6. Durable human source resolution was correctly separated from capture rows in migration `20260814224937`. The implementation should extend that mechanism rather than write canonical IDs back into replaceable landing snapshots.
7. Paramount explicitly proves why relationship evidence needs a type: Property/Franchise co-occurrence is not a direct relationship. Canonical bridges may contain only direct source statements or explicit curated decisions; co-occurrence remains in labelled evidence views/tables.
8. ColdLion does not supply Characters, Style Guides, Assets, Franchises, or the canonical Property-to-Licensor decision. Its only canonical output in this design is Property membership for Active/Inactive.
9. Weekly licensor-source scheduling is absent from the inspected private repositories, so database freshness columns and alerts must be implemented together with private-repo operations.
10. Production migration drift is real. A live catalog absence can mean “merged but not applied,” not “never built.” Every phase starts by comparing `origin/main`, preview ledger, and production ledger.

Root cause: the shared database was built incrementally from DesignFlow, ColdLion, PopDAM, and individual portal captures before one authority model was settled. The result is good source evidence but overlapping canonical assumptions. The 2026-08-16 architecture supplies the missing authority model; this plan makes the structure and operations agree with it.

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
2. ColdLion controls Property Active/Inactive only. Date: 2026-08-16.
3. DesignFlow has no authority. Date: 2026-08-16.
4. A Character may belong to multiple Properties. Owner/licensing decision recorded before this plan and reaffirmed by the architecture.
5. Style Guide/Character is many-to-many.
6. `core.property.licensor_id` remains one owning Licensor per Property unless future authoritative evidence and a new owner decision change it.
7. Co-occurrence is not a direct Franchise relationship.
8. Canonical records are retained; refreshes do not hard-delete them.
9. Authorized licensor scrapes run at least weekly.
10. Asset means canonical metadata in `dam.asset`, not binaries in the public repository.
11. DB Data Admin is the licensing review and audit surface.

### Implementation choices fixed by this plan

1. Extend existing canonical tables. Do not build a parallel catalogue.
2. Add `core.franchise` as the missing canonical entity table.
3. Retire the scalar `core.character.property_id` and `core.style_guide.property_id` after compatibility migration and consumer cutover.
4. Use explicit bridges: `core.property_character`, `core.property_style_guide`, `core.style_guide_character`, `core.property_franchise`, `dam.asset_property`, `dam.asset_character`, `dam.asset_style_guide`, and `dam.asset_franchise`.
5. Extend `plm.source_resolution` for Licensor and Franchise. Use a separate audited relationship-resolution table because entity resolution and edge evidence are different facts.
6. Use `dam.asset` as the canonical Asset metadata table.
7. Store co-occurrence evidence only in source/evidence tables and views, not canonical direct bridges.

### Open implementation judgments that do not require Albert

- exact index choice after `EXPLAIN` on preview;
- whether a compatibility view or generated API field best carries a single “primary Property” during consumer transition;
- how to split migrations into collision-safe units after current object claims are audited;
- whether each private portal can run fully unattended. Decide from the portal's authorized technical behavior and its source-specific skill. Never weaken security or fabricate success.

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
   - `node scripts/manage-migration-author-lanes.mjs --queue-audit`
5. Capture catalog definitions, constraints, policies, grants, row counts, and dependent views for every object listed in the STATUS table. Prove the connection target immediately before each database read and record only counts/definitions, never licensed row contents.
6. Query `api.source_capture_inventory` and record current coverage/freshness using its declared count basis. Do not guess source table names or treat a null latest-complete count as zero.
7. Save all sanitized output under `docs/verification/licensing-master-data-phase0-<UTC-date>/` with a README explaining target references and command exit codes.

Dependency: none.

Verification gate: the evidence directory proves the exact preview and production ledgers, live object shapes, dependency graph, source freshness, and every current row count required to choose safe migrations. Exit 2 from a ledger check is a failure to check, never “clean.”

#### Step 0.2: split exact-object claims and reserve versions

Use the orchestrator's dynamic queue. Likely author units, subject to current overlap audit:

1. Entity foundation: `core.character`, `core.franchise`, alias tables, `core.taxonomy_source_ref`, `plm.source_resolution`, `plm.licensing_source_scope`.
2. Relationship foundation: the four `core.*` bridges and four `dam.*` bridges.
3. Consolidation/API foundation: candidate views, audited promotion functions, freshness views, and DB Data Admin RPC contracts.

Run `node scripts/manage-migration-author-lanes.mjs --claim ...` with every exact object and the isolated worktree path. Let the tool reserve each 14-digit version. Do not create a migration file before a successful claim.

Verification gate: GitHub-backed claims show no overlapping object owner, each branch/worktree is isolated, and each reserved version came from the lane tool.

### Phase 1: canonical entity and relationship foundation

Natural fresh-session cut point: after the Phase 1 PR is preview-proven and merged. Re-read Phases 2–4 before starting Phase 2.

#### Step 1.1: repair Character ownership without losing data

Target: a new reserved migration under `supabase/migrations/` plus contract tests under `supabase/tests/`.

Behavior:

1. Audit every non-null `core.character.property_id` row and its provenance. The 2026-08-07 evidence reported zero rows, but do not rely on that dated fact.
2. If any current row is backed by an authorized direct source or audited licensing decision, insert the equivalent edge into `core.property_character` with stable source-edge provenance.
3. If a row derives only from stale DesignFlow, do not promote that parent as canonical. Preserve its value as historical evidence and place the identity/edge into review.
4. Remove the `ON DELETE CASCADE` route from Property to Character.
5. Drop the scalar `property_id` and its unique constraint only after a compatibility view/API has replaced every consumer read.
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

After all API and app consumers move, drop `core.style_guide.property_id`. Keep `core.style_guide.licensor_id` as identity scope unless Phase 0 proves a real cross-Licensor guide.

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

Each bridge must carry:

- both endpoint UUIDs with `ON DELETE RESTRICT` unless a reviewed exception proves otherwise;
- `source_system` and stable `source_edge_id` or a deterministic composite source key;
- `evidence_kind` constrained to direct source statement or audited curated decision;
- `first_seen_at`, `last_seen_at`, `is_current`, and `metadata`;
- uniqueness that prevents the same source edge from duplicating while allowing two sources to support the same canonical edge;
- indexes for reverse lookup and current-edge queries;
- RLS/grants matching the endpoints.

Do not place Paramount or Warner co-occurrence rows in `core.property_franchise`. Keep their evidence-only tables and expose clearly labelled evidence views.

Verification gate: tests insert two independent sources supporting one canonical edge without duplicate business display, retire one source observation without removing the other support, reject `evidence_kind='cooccurrence'` from canonical direct bridges, and prove endpoint deletion is blocked.

#### Step 1.5: extend canonical provenance and Asset freshness

Extend `core.taxonomy_source_ref` with source namespace/composite identity, entity kind constraints, `first_seen_at`, `last_seen_at`, `is_current`, `missing_since`, and audit metadata. Add integrity enforcement so a source ref cannot silently point at a nonexistent or wrong-kind target.

Extend `dam.asset` with the same freshness/current-state facts. Retain the established `(source_system, source_id)` identity, but add source namespace if Phase 0 proves a collision risk. Keep the scalar Asset Property/Licensor fields as compatibility-only until all consumers use bridges, then retire them.

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
- migration assertions that preserve every existing decision exactly.

The new migration must work whether the genuinely pending source-resolution migrations are already applied by the time implementation reaches production. Ordered ledger presence is the gate; do not manually skip their SQL.

Verification gate: existing Property/Character/Style Guide/Asset decisions survive byte-for-byte; Licensor and Franchise decisions can be created; wrong-kind target combinations fail; first-writer and optimistic-lock tests stay green.

#### Step 2.2: add authorized source scope

Create `plm.licensing_source_scope` to map an authorized source namespace to its canonical Licensor and permitted entity/relationship kinds. Required fields:

- `source_system`, `source_namespace` primary identity;
- `core_licensor_id`;
- allowed entity kinds and relationship kinds;
- `authorized_at`, `authorized_by`, evidence note/reference;
- `is_enabled`, `disabled_at`, `disabled_reason`;
- expected weekly freshness interval;
- no public/anonymous writes.

This table is how a Disney, NBCU, Paramount, or Warner namespace proves which Licensor scope it may write. It is not inferred from DesignFlow or ColdLion.

Verification gate: a source adapter cannot propose or promote an entity outside its authorized Licensor/kind scope; disabled or stale scopes fail loudly; audit fields are mandatory.

#### Step 2.3: add relationship-resolution and candidate contracts

Create audited structures for unresolved source entities and direct source edges, using exact names selected after the Phase 0 collision audit. Recommended names:

- `plm.licensing_relationship_resolution`
- `api.licensing_entity_candidates`
- `api.licensing_relationship_candidates`
- `api.licensing_resolution_queue`

Entity candidates standardize source system/namespace, entity kind, stable source ID, official name, source parent identity, capture ID, completeness state, and first/last seen. Relationship candidates add source edge ID, endpoint source identities, direct/evidence-only classification, and capture facts.

Candidate views must read only the latest complete validated capture for sources that use replaceable captures. A running, partial, failed, or superseded capture cannot become canonical input.

Verification gate: fixtures for each source show correct stable identities and direct/evidence distinction; incomplete captures return no promotable candidates; display names are never used as the sole key.

#### Step 2.4: implement preview/dry-run-first consolidation

Create a service-role-only consolidation function and a dry-run/read API. The exact function names are chosen after collision audit; recommended:

- `plm.plan_licensing_consolidation(source_system, capture_id)`
- `plm.apply_licensing_consolidation(plan_id, expected_hash)`

Rules:

- only authorized, complete captures;
- source resolution and source scope determine canonical targets;
- create a new canonical row automatically only when the stable source identity and Licensor scope are unambiguous and no normalized/alias collision exists;
- ambiguous matches enter the licensing queue;
- portal spelling and Property ownership update canonical rows, while previous internal spellings become aliases;
- direct relationships upsert current support and record first/last seen;
- absence from a complete capture retires only that source's support, never the entity;
- plan output has deterministic hash, counts, reasons, and no licensed row values in logs;
- apply requires the exact plan hash and serializes per source/capture;
- rerunning the same capture is a no-op.

Verification gate: two-cycle tests prove idempotency, canonical spelling replacement plus alias preservation, ownership correction, safe missing-edge retirement, ambiguity abstention, and deterministic dry-run/apply parity.

### Phase 3: source adapters and preview consolidation

Implement one source at a time. Each source uses its named skill and private repository. Never copy licensed rows into this plan or public evidence.

#### Step 3.1: Disney adapter

Sources: OPA Property/Character plus DCP Vault Style Guide/Asset metadata across the separated Disney, Lucasfilm, Marvel, and Twentieth Century namespaces.

Requirements:

- use OPA stable IDs for Property/Character identity;
- use DCP stable path/ID contracts already defined in the separated landing migrations;
- do not treat a DCP portal tile as a Property or Franchise unless the source contract explicitly says it is one;
- preserve source namespace so equal IDs across studios cannot collide;
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
- retain Warner source namespace and fallback identity method.

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

Verification gate: `docs/verification/licensing-master-data-phase3-<date>/README.md` records the exact preview project, capture IDs/hashes, commands, exit codes, and invariant totals without licensed values.

### Phase 4: guarded ColdLion Active/Inactive

#### Step 4.1: replace old promotion authority with membership-only status logic

Reuse the proven ColdLion pagination, completeness, shrink, serialization, alert, and cycle-state tooling in:

- `tools/sync-coldlion-licensors-properties.mjs`
- `tools/promote-coldlion-source-owned.mjs`
- `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs`
- `.github/workflows/coldlion-licensor-property-production.yml`

Remove or disable any path that writes canonical Property name, code, or `licensor_id` from ColdLion. Add a new plan/apply path whose only canonical mutation is `core.property.status` after mapping the complete current ColdLion Property set.

Behavior:

- mapped present Property becomes Active;
- mapped absent Property becomes Inactive;
- unmatched ColdLion rows enter review and cannot create guessed ownership;
- short/failed/incomplete pulls make no status changes;
- proposed Active/Inactive changes are reviewable and hash-pinned;
- no Property is deleted;
- rerun is idempotent.

Verification gate: fault tests for short pull, missing division, pagination loss, duplicate key, suspicious shrink, and stale plan all refuse mutation; a complete two-cycle rehearsal activates/preserves/deactivates exactly the expected fixture Properties without renaming or re-parenting them.

#### Step 4.2: remove DesignFlow comparison from authority decisions

Historical DesignFlow comparison can remain as a diagnostic labelled non-authoritative, but readiness and promotion must not require DesignFlow agreement or use it to set canonical values.

Verification gate: repository search and tests prove no canonical licensing write reads `dflow.*`, DesignFlow Cloud SQL, or DesignFlow API data. Diagnostic outputs say “historical comparison,” never “source of truth.”

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

Verification gate: a simulated eight-day gap marks the weekly source overdue and alerts; a new complete capture clears the overdue state without erasing failure history.

### Phase 7: consumer application cutover

For each consumer repo, first read its own `AGENTS.md`. Database structure remains in shared-db; app repos change only code, generated types, tests, and docs.

Sequence:

1. DB Data Admin uses canonical APIs first.
2. PopDAM switches licensing entity/relationship reads to canonical APIs and `dam.asset` bridges.
3. PopPIM/PM uses canonical licensing pickers and relationships.
4. PopCRM uses canonical Licensor/Property display contracts where applicable.
5. Six DesignFlow services switch reads from `dflow.*` licensing tables to canonical Supabase APIs according to their sandbox/develop rules. DesignFlow never becomes a writer of canonical truth.
6. Remove compatibility scalar fields/views only after repository-wide search and live telemetry show zero consumers.

Verification gate per app: unit/integration tests pass, real signed-in user journey works, no network/API call reads DesignFlow licensing truth, and generated types match the applied preview schema. UI changes have screenshots.

### Phase 8: governed production landing and monitoring

This is a separate fresh session. Production is not authorized by this plan.

#### Step 8.1: assemble the exact bounded production package

Re-run production ledger drift, rebase each migration from current `main`, and include only this plan's prerequisites and migrations proven together on preview. Respect retired, held, and unrelated pending versions. Use the shared production workflow's immutable evidence and business-risk gate.

Verification gate: package names exact migration versions, immutable review artifacts, preview apply proof, current-main SHA, rollback path, and every consumer compatibility result. The workflow accepts the package without overrides.

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

Verification gate: exact production catalog matches the approved structure; source and relationship invariants are zero-failure; all apps read canonical contracts; live build SHAs are verified where apps changed; weekly monitors are enabled and healthy.

#### Step 8.3: retire superseded paths safely

Only after sustained verified operation:

- disable DesignFlow licensing feeds/writes;
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
  - RLS, grants, FKs, restrict behavior, and indexes.
- `licensing_relationship_evidence_contracts.sql`
  - many-to-many behavior;
  - direct versus co-occurrence rejection;
  - multi-source support and current-edge calculation;
  - no endpoint cascade destruction.
- `licensing_source_resolution_extensions.sql`
  - Licensor/Franchise resolution;
  - wrong-kind rejection;
  - audit and optimistic locking;
  - preservation of existing decisions.
- `licensing_source_scope_contracts.sql`
  - source namespace authorization;
  - cross-Licensor/kind refusal;
  - disabled scope refusal.
- `licensing_consolidation_contracts.sql`
  - dry-run hash;
  - idempotency;
  - spelling/ownership authority;
  - alias preservation;
  - missing-source retention;
  - ambiguous-match abstention;
  - stale DesignFlow non-authority.
- `coldlion_property_status_contracts.sql`
  - membership-only mutation;
  - fail-closed short/partial input;
  - no rename/re-parent/delete.
- `db_data_admin_licensing_contracts.sql`
  - licensing access boundaries;
  - review/audit functions;
  - evidence labels and freshness.

### Node/tool tests

Add or extend:

- source adapter unit tests for Disney, NBCU, Paramount, and Warner;
- two-cycle consolidation rehearsal tests;
- incomplete-capture refusal tests;
- ColdLion status fault matrix;
- weekly schedule mapping and missed-run alert tests;
- workflow contract tests ensuring licensed values cannot enter logs/artifacts.

### DB Data Admin tests

Use Vitest/Testing Library for:

- each entity/relationship view;
- licensing versus administrator permissions;
- ambiguous resolution and optimistic conflict;
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
7. Outside-sourced writes into curated `core.*` remain under curated Master Data governance even after structure is ready.
8. Licensed source rows never enter this public repo, issues, PRs, logs, or outside AI prompts.
9. Fetch 1Password secrets serially from vault `vibe_coding`; never print or store values.
10. DesignFlow data is non-authoritative historical evidence only.
11. ColdLion writes Property status only after guarded membership reconciliation.
12. Never hard-delete canonical licensing entities during refresh.
13. Do not infer direct relationships from names, paths, folders, or co-occurrence.
14. `dam.asset` is metadata, not the licensed binary.
15. Do not create competing canonical tables.
16. DB Data Admin's existing reusable Text + Set grid filter must be reused.
17. UI work requires serve + screenshot verification as real permitted roles.
18. Every fallback alerts loudly; no silent skip of a source or schedule.
19. Preserve recovery before destructive retirement: merged commit, preview proof, rollback SQL/backup, and verified zero consumers.
20. Existing private source repo working copies may contain other sessions' files. Never stage, edit, delete, or tidy unrelated work.

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
- [ ] Source scope prevents cross-Licensor/source writes.
- [ ] All four source adapters pass complete/incomplete/idempotency tests on preview.
- [ ] ColdLion changes only Property Active/Inactive and fails closed on bad input.
- [ ] DB Data Admin supports review, aliases, direct/evidence distinction, status reason, freshness, and audit for Licensing users.
- [ ] Weekly automation or explicit weekly due action exists for all four sources, with missed/failed-run alerts.
- [ ] Consumer applications read canonical APIs and no longer read licensing truth from DesignFlow.
- [ ] All new and existing tests are green.
- [ ] Independent review has no unresolved Critical or High finding.
- [ ] Migrations are preview-proven, merged, and applied through the governed production lane.
- [ ] Production object, data-invariant, application, and weekly-monitor verification pass.
- [ ] Every repo change is committed with Albert's identity, pushed, CI green, and deployed SHA verified where applicable.
- [ ] This plan's STATUS, central architecture, app docs, and handoffs match reality.
- [ ] #1090 is closed only after the entire implementation is verified. The architecture document remains permanent.

### Principal risks and controls

| Risk | Control | Rollback/recovery |
|---|---|---|
| Wrong portal entity matched to canonical row | Stable source IDs, scope gate, ambiguity abstention, human review | Reverse audited resolution/merge; canonical IDs retained |
| Stale DesignFlow value re-enters | No canonical writer reads DesignFlow; contract search/test | Disable offending writer, restore from prior canonical audit, replay authoritative source |
| Short scrape retires relationships | Complete-capture gate and shrink/freshness checks | No apply occurs; prior current edges remain |
| ColdLion mass-deactivates | Hash-pinned plan, complete pagination/division checks, max shrink, preview | Reapply prior status snapshot through audited rollback plan |
| Scalar-to-bridge cutover breaks apps | Compatibility API, consumer inventory, staged cutover | Restore compatibility view/column from migration rollback while bridges remain |
| Co-occurrence becomes false direct relationship | Evidence-kind constraints and source adapter tests | Remove rejected edge through audited plan; source evidence remains |
| Production pending migrations collide | Ledger drift check, exact bounded package, serialized merge/promotion | Stop before apply; never broad-push the pending set |
| Licensed data leaks publicly | Aggregate-only evidence and source-specific private repos | Remove current-version exposure per policy and incident procedure; never publish row values |
| Weekly automation silently stops | due-state and missed-run alerts independent of capture job | Manual approved capture while automation is repaired; never mark stale data fresh |

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

### Required synthesis answers

1. **Could a brand-new AI session with no project knowledge execute this plan without asking a question? Yes.** Sections 1–4 explain the business, product, trigger, and boundaries. Sections 5–8 preserve current state, findings, rejected approaches, and locked decisions. Section 9 gives ordered file/object-level work with a verification gate for every step. Sections 11–13 provide rules, access, risks, rollback, and completion criteria.
2. **Does the plan carry the background, nuance, and reasoning held by the planning session? Yes.** Sections 5–7 record the conflicting scalar/bridge shapes, pending source-resolution migrations, source landing inventory, absent weekly schedules, production ledger drift evidence, subordinate older plans, and every rejected authority model.
3. **Is the goal clear enough to guide a correct judgment when a step is wrong? Yes.** Section 1 defines the desired business state and explicitly says the goal wins. Section 8 identifies locked decisions and safe technical judgment areas; Section 13 says how to stop and escalate a newly discovered business conflict.

No gap remained after the final audit.
