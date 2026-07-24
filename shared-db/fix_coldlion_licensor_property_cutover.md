# ColdLion licensor/property master-data cutover

**Status:** implementation plan; no schema, importer, scheduler, or production cutover is
authorized by this document.

**Written:** 2026-07-23  
**Repository:** `u2giants/shared-db`  
**Preview Supabase project:** `rjyboqwcdzcocqgmsyel`
(`shared-db-schema-rehearsal`)  
**Production Supabase project:** `qsllyeztdwjgirsysgai`

This plan makes ColdLion the direct upstream source for **licensor and property master
records** while keeping `core.licensor` and `core.property` as the stable, canonical records
used by every application.

It does **not** make ColdLion authoritative for the licensor→property relationship or for
active/inactive status. ColdLion does not supply either. Those are curated canonical facts
owned in Supabase, initially preserved and checked against DesignFlow.

The distinction is the foundation of the cutover:

| Concern | Authority after cutover |
|---|---|
| ColdLion source rows, source codes, names, division/type context | ColdLion, mirrored faithfully in `plm.erp_licensor` / `plm.erp_property` |
| Stable application-facing records and UUIDs | `core.licensor` / `core.property` |
| Property→licensor parent edge | `core.property.licensor_id`, curated in Supabase |
| Active/inactive status | `core.licensor.status` / `core.property.status`, curated in Supabase |
| Aliases, manual overrides, application metadata | Supabase canonical/curation tables |
| Temporary comparison source for parent edges and status | DesignFlow, during the parallel-run and deprecation period |
| Items’ resolved relationships to canonical licensors/properties | `plm.item.licensor_id` / `plm.item.property_id` |

Throughout this plan, **master data** means the identity and descriptive fields of a
licensor/property. **Relationship data** means which licensor owns a property.
**Lifecycle data** means whether the licensor/property is currently active. The term
“taxonomy” is deliberately avoided where it would blur these three separate concerns.

---

## 1. Why this work is needed

Today:

- `core.licensor` and `core.property` are already the canonical application-facing tables.
- Their records are populated through DesignFlow staging:
  `plm.licensor_import` / `plm.property_import`.
- `core.taxonomy_source_ref` contains DesignFlow provenance only.
- There is no direct ColdLion mirror named `plm.erp_licensor` or `plm.erp_property`.
- ColdLion exposes the source records through division-specific merch-group dictionaries,
  not dedicated `/licensors` or `/properties` endpoints.
- For licensed divisions, the live measured counts are approximately 22 ColdLion licensors
  and 258 ColdLion properties versus 20 canonical licensors and 256 canonical properties.
- ColdLion still returns lapsed licenses such as NASA, ZAG, and FRIDA KAHLO with no inactive
  marker.
- ColdLion does not transmit property→licensor parent edges.
- `FR` is a known collision: it is a DesignFlow/Supabase licensor for FRIENDS TV, while the
  ColdLion licensed-division data contains `FR` as a property code for “1ST ORDER TROOPER.”

The desired change is therefore not “replace `core.*` with ColdLion.” It is:

```text
ColdLion merch-group dictionaries
    → ingest.raw_record
    → plm.erp_licensor / plm.erp_property       faithful direct mirrors
    → guarded resolution and source references
    → core.licensor / core.property             stable canonical records

DesignFlow relationship/status feed
    → comparison and curated-state preservation
    → core.property.licensor_id + core.*.status
```

No application should receive new UUIDs or have a foreign key repointed merely because the
upstream transport changes.

---

## 2. Current facts and assumptions that must be reverified

These are planning baselines, not permanent truths:

| Fact | Baseline |
|---|---|
| Canonical licensors | 20 before the pending PopSG manual-backfill work |
| Canonical properties | 256 |
| DesignFlow licensor staging | 37 rows collapsing to 20 distinct canonical licensors |
| DesignFlow property staging | 468 rows collapsing to 256 canonical properties |
| ColdLion CW001 licensors | 22 |
| ColdLion CW001 properties | 258 |
| ColdLion lifecycle flag | None |
| ColdLion parent relationship | None |
| DesignFlow provenance | 505 `core.taxonomy_source_ref` rows, all `designflow_plm` at last verification |

The current branch `feat/popsg-missing-licensors` and PR #198 add manually curated PopSG
licensors, including NASA. That work changes the canonical count and demonstrates why the
cutover must compare row identities, not use `20/256` as hard-coded production assertions.
Before implementation begins, serialize with that PR and take a fresh baseline.

The first implementation PR must record a dated baseline under
`docs/verification/`, containing:

- exact ColdLion counts per `(companyCode, divisionCode, mgTypeCode, mgTypeDesc)`;
- exact DesignFlow staging counts and distinct codes;
- exact canonical counts by status;
- all current ColdLion and DesignFlow source references;
- all parent edges;
- all unmatched and ambiguous records;
- the current disposition of NASA, ZAG, FRIDA KAHLO, and FRIENDS TV;
- every database object and application query depending on `core.licensor`,
  `core.property`, `plm.licensor_import`, or `plm.property_import`.

The implementation must not begin while another shared schema change is in flight. Run the
AGENTS.md §6 checks first and serialize the work.

---

## 3. Non-negotiable safety rules

1. **Canonical UUIDs never change during source cutover.** Existing application foreign keys
   keep pointing to the same `core.*` rows.
2. **ColdLion cannot update curated fields.** A re-pull must never update:
   - `core.licensor.status`;
   - `core.property.status`;
   - `core.property.licensor_id`;
   - aliases, manual display names, review decisions, or app-owned metadata.
3. **No automatic deletion or inactivation.** Absence from a ColdLion pull creates drift or
   review work; it never deletes or inactivates a canonical row.
4. **No automatic activation.** Presence in ColdLion does not activate a canonical row.
   This prevents resurrection of NASA, ZAG, FRIDA KAHLO, or any other lapsed license.
5. **Never classify by `mgTypeCode` alone.** Resolve
   `(companyCode, divisionCode, mgTypeCode) → mgTypeDesc` from
   `/merchGroupHeaders`, and accept only explicitly recognized licensed-division meanings.
6. **Never identify a source row by `mgCode` alone.** The source natural key is
   `(companyCode, divisionCode, mgTypeCode, mgCode)`. `mgDesc` is mutable and must not be in
   the key.
7. **Never infer a parent edge during automatic promotion.** Item co-occurrence may be
   reported as evidence, but it cannot change `core.property.licensor_id`.
8. **Ambiguity quarantines the record.** A questionable match is not a partial success.
9. **Empty or suspiciously short pulls cannot promote.** They must record a durable failed or
   blocked run and alert.
10. **All-or-nothing promotion.** The fetched source snapshot may be recorded, but canonical
    promotion must occur transactionally only after every validation gate passes.
11. **Failures must survive rollback.** Use the durable failure pattern already implemented
    for guarded ColdLion vendor synchronization.
12. **Preview first.** Every migration and operational run is rehearsed on
    `rjyboqwcdzcocqgmsyel` before production.
13. **Additive first.** DesignFlow staging and sync continue unchanged throughout groundwork
    and parallel running.
14. **No production promotion without an approved window.**
15. **No application-visible cutover based only on matching counts.** Identity, parent,
    status, and UUID preservation must all reconcile.

---

## 4. Target data model

### 4.1 Faithful ColdLion mirror tables

Add typed mirror tables. They contain source facts and resolution state; they are not
application master tables.

```sql
create table plm.erp_licensor (
  company_code          text not null,
  division_code         text not null,
  mg_type_code          text not null,
  mg_code               text not null,
  mg_type_desc          text not null,
  name                   text not null,
  licensor_id            uuid references core.licensor(id) on delete set null,
  resolution_status      text not null default 'unresolved',
  resolution_reason      text,
  resolved_at            timestamptz,
  resolved_by            text,
  erp_created_at         timestamptz,
  erp_updated_at         timestamptz,
  raw                    jsonb not null,
  source_hash            text not null,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  last_sync_run_id       uuid references ingest.sync_run(id) on delete set null,
  primary key (company_code, division_code, mg_type_code, mg_code)
);

create table plm.erp_property (
  company_code          text not null,
  division_code         text not null,
  mg_type_code          text not null,
  mg_code               text not null,
  mg_type_desc          text not null,
  name                   text not null,
  property_id            uuid references core.property(id) on delete set null,
  resolution_status      text not null default 'unresolved',
  resolution_reason      text,
  resolved_at            timestamptz,
  resolved_by            text,
  erp_created_at         timestamptz,
  erp_updated_at         timestamptz,
  raw                    jsonb not null,
  source_hash            text not null,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  last_sync_run_id       uuid references ingest.sync_run(id) on delete set null,
  primary key (company_code, division_code, mg_type_code, mg_code)
);
```

The final migration may adjust field names to the verified API payload, but it must preserve
the composite key and separation between source data and canonical linkage.

Required constraints:

- `resolution_status` limited to:
  `unresolved`, `auto_matched`, `manually_matched`, `new_candidate`, `ambiguous`,
  `quarantined`, `ignored`.
- `licensor_id`/`property_id` must be non-null for matched states and null for unresolved or
  quarantined states.
- `mg_type_desc` must be normalized and validated as the correct entity type for that
  division.
- Source payload and hash must be retained for audit.
- Source-row timestamps must not be confused with canonical `updated_at`.

Required indexes:

- canonical-link indexes on `licensor_id` and `property_id`;
- review indexes on `resolution_status`;
- lookup indexes on normalized `name`;
- `last_seen_at` / `last_sync_run_id` indexes for reconciliation.

### 4.2 Header dictionary

Reuse the all-division ColdLion merch-group header dictionary created for item taxonomy
wiring if its contract is sufficient. Do not create a second dictionary.

At minimum it must retain:

```text
company_code, division_code, mg_type_code, mg_type_desc,
source_hash, raw, last_seen_at, last_sync_run_id
```

The licensor/property pull must first refresh and validate this dictionary, then derive
which `(division, mgTypeCode)` pairs mean Licensor and Property. It must not assume `05/06`
globally.

### 4.3 Source-reference strategy

During the additive phases, reuse `core.taxonomy_source_ref` so DesignFlow and ColdLion refs
can coexist on the same canonical UUID:

```text
source_system = 'coldlion'
source_table  = 'merchGroupDetails'
source_id     = encoded composite natural key
source_code   = mgCode
entity_table  = 'licensor' or 'property'
entity_id     = stable core UUID
```

`source_id` must use a deterministic, reversible encoding of:

```text
companyCode / divisionCode / mgTypeCode / mgCode
```

It must not be only `mgCode`.

Splitting `core.taxonomy_source_ref` into strict per-entity source-ref tables is a separate
schema-hardening decision. Do not combine it with this cutover unless it is required for
correctness; unnecessary simultaneous refactoring increases production risk.

### 4.4 Reconciliation and quarantine

Add a durable review table rather than hiding ambiguous rows in logs:

```sql
create table plm.taxonomy_resolution_review (
  id                    uuid primary key default gen_random_uuid(),
  entity_type           text not null,
  company_code          text not null,
  division_code         text not null,
  mg_type_code          text not null,
  mg_code               text not null,
  source_name           text not null,
  proposed_entity_id    uuid,
  match_method          text,
  confidence            text not null,
  reason                text not null,
  evidence              jsonb not null default '{}'::jsonb,
  status                text not null default 'open',
  resolution            text,
  resolved_entity_id    uuid,
  resolved_by           text,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (entity_type, company_code, division_code, mg_type_code, mg_code)
);
```

This table must support at least:

- exact match needing confirmation;
- name-only match;
- code/name disagreement;
- one ColdLion row matching multiple canonical rows;
- multiple ColdLion rows matching one canonical row;
- new ColdLion-only record;
- canonical-only record;
- entity-type collision;
- known lapsed license present in ColdLion;
- missing parent edge;
- `FR / FRIENDS TV` special review.

Review writes must be auditable. Automated runs may create/update open findings but may not
resolve human decisions.

### 4.5 Read-only comparison views

Create API or internal views for the parallel run:

- `api.coldlion_licensor_reconciliation`;
- `api.coldlion_property_reconciliation`;
- `api.coldlion_taxonomy_cutover_summary`.

They must expose no secrets or raw sensitive payloads. At minimum they report:

- source composite key and source name;
- matched canonical UUID, code, name, and status;
- DesignFlow source refs;
- canonical parent UUID/name for properties;
- resolution status and reason;
- whether a curated field would differ;
- first/last seen timestamps;
- open review status;
- item-use counts where available.

These views are evidence surfaces, not mutation APIs.

---

## 5. Field-ownership contract

The importer must implement an explicit allowlist. Anything not listed as ColdLion-owned is
untouchable.

### 5.1 ColdLion-owned mirror fields

ColdLion may overwrite these fields in `plm.erp_*` on every successful pull:

- company/division/type/code composite identity;
- source name/description;
- verified source timestamps;
- raw payload;
- source hash;
- last-seen and sync-run linkage.

### 5.2 Canonical fields ColdLion may propose or update

For an already linked canonical record:

- `code`: update only under a separately approved rename/code-change rule; default is report
  drift, not overwrite.
- `name`: default is update a source-name field or alias, not overwrite the curated display
  name. If `core.*` lacks separate source/display naming, Phase 0 must decide whether to add
  one before promotion.
- metadata: add namespaced ColdLion provenance only; never replace the metadata object.

For a genuinely new, approved canonical record:

- generate a new stable UUID;
- seed code and name from the reviewed ColdLion row;
- choose status explicitly. Default is `inactive` or review-required, never implicitly
  active merely because ColdLion returned it;
- properties require an approved `licensor_id` before application visibility.

### 5.3 Canonical fields ColdLion must never update

- `core.licensor.status`;
- `core.property.status`;
- `core.property.licensor_id`;
- canonical UUIDs;
- created timestamps;
- manual aliases;
- app-curated display names;
- manual metadata outside the `coldlion` namespace;
- relationship or lifecycle review history.

Add regression tests proving a second import with conflicting source data cannot alter these
fields.

---

## 6. Guarded importer design

Implement a database function plus an operational runner, following the guarded vendor sync
pattern.

Recommended boundaries:

```text
tools/sync-coldlion-licensors-properties.mjs
    fetches headers + relevant details
    validates completeness and semantic types
    records durable fetch failures
    calls one public SECURITY DEFINER wrapper

public.sync_coldlion_licensors_properties(payload, mode)
    validates payload contract
    writes ingest + typed mirrors
    calculates matches and review findings
    promotes only pre-approved links/creates
    writes complete run accounting

plm.sync_coldlion_licensors_properties(...)
    internal implementation, not browser callable
```

### 6.1 Fetch sequence

1. Fetch `/merchGroupHeaders` for every enabled division.
2. Validate that expected divisions are present and each header key is unique.
3. Identify type pairs whose normalized descriptions explicitly mean Licensor or Property.
4. Fetch every page of `/merchGroupDetails` for those pairs.
5. Reject non-array payloads, incomplete pagination, duplicate natural keys with conflicting
   payloads, missing codes, or missing descriptions.
6. Calculate per-division/per-type counts and hashes.
7. Compare counts with the most recent successful full run.
8. If empty or suspiciously short, record a blocked/failed run and stop before promotion.
9. Pass the complete validated snapshot to the database function.

Initial execution should always be a full snapshot. Incremental support may be added only if
the endpoint exposes a verified reliable watermark. A scheduled weekly full reconciliation
remains mandatory even if incrementals are later introduced.

### 6.2 Pull guards

The runner and database function must independently enforce:

- non-empty headers;
- non-empty licensed entity sets;
- required licensed divisions present;
- all pages reached a terminal page;
- no unexpected `mgTypeDesc` meaning change;
- no source natural-key collision;
- no unexplained count drop beyond a configurable threshold;
- no duplicate code/name disagreement inside one natural-key scope;
- no attempt to treat EH001/EP001 `05/06` meanings as licensor/property;
- no promotion when any required validation fails.

Thresholds must be configuration, not embedded business constants. The initial baseline can
inform warning thresholds, but `22` and `258` must not become permanent “correct” counts.

### 6.3 Match order

For each mirror row:

1. Existing exact ColdLion composite source reference → reuse its canonical UUID.
2. Approved manual resolution in `plm.taxonomy_resolution_review` → reuse the approved UUID.
3. Exact compatible DesignFlow source mapping, using division + entity type + code.
4. Exact canonical code match **only when entity type and division semantics are proven
   compatible**.
5. Exact normalized-name match only when it produces one candidate and has no conflicting
   code/type evidence.
6. Otherwise quarantine.

An automatic match must never cross `licensor` and `property`, even when code/name text
matches. It must never select the first of several candidates.

### 6.4 Promotion modes

The function must support explicit modes:

- `mirror_only`: update raw and `plm.erp_*`; create reconciliation findings; never mutate
  canonical rows or source refs.
- `link_approved`: add approved ColdLion source refs and mirror→canonical UUID links; do not
  create canonical rows or update canonical descriptive fields.
- `promote_approved`: create only explicitly approved new canonical rows and apply approved
  descriptive changes; never change status or parent edges implicitly.

The default must be `mirror_only`.

### 6.5 Transaction and failure behavior

- Raw/mirror import and canonical promotion must use a clear transaction boundary.
- A validation or ambiguity error rolls back canonical promotion.
- A failure row must be recorded in a separate committed transaction so it survives rollback.
- `ingest.sync_run` must record:
  - endpoint and mode;
  - divisions/types fetched;
  - pages fetched;
  - rows seen by entity type;
  - inserted/updated/unchanged mirror rows;
  - auto-matched/manually matched/new/ambiguous/quarantined counts;
  - canonical rows created;
  - source refs added;
  - canonical fields changed, grouped by field;
  - warnings and error details;
  - source hashes and comparison-to-prior-run summary.
- Two consecutive failures or blocked promotions must trigger the existing alert path.

No per-row exception may be swallowed while the overall run reports success.

---

## 7. Reconciliation of ColdLion 22/258 versus canonical 20/256

Counts are a starting clue, not the acceptance test. Produce a complete, reviewable ledger.

### 7.1 Required reconciliation categories

Every ColdLion and canonical record must land in exactly one category:

1. exact source-ref match;
2. exact compatible code match;
3. exact normalized-name match;
4. probable alias/rename;
5. ColdLion-only candidate;
6. canonical-only curated/legacy record;
7. code collision;
8. name collision;
9. entity-type collision;
10. lapsed-but-present-in-ColdLion;
11. missing or disputed parent;
12. ignored by approved business rule.

### 7.2 Reconciliation artifact

Generate dated CSV/Markdown evidence under:

```text
docs/verification/coldlion-licensor-property-reconciliation-YYYYMMDD/
```

Required files:

- `README.md` — methodology, environment, timestamps, counts, conclusions;
- `licensors.csv` — one row per source/canonical reconciliation unit;
- `properties.csv`;
- `parent_edges.csv`;
- `status_differences.csv`;
- `unmatched.csv`;
- `ambiguous.csv`;
- `known-lapsed.csv`;
- `source-hashes.json` — non-secret snapshot hashes and counts.

Do not store raw API payloads containing unnecessary data in git. The database mirror is the
audit source for raw records.

### 7.3 Acceptance criteria

Before any canonical linking:

- 100% of ColdLion rows are categorized;
- 100% of existing canonical rows are categorized;
- zero unresolved entity-type collisions;
- zero ambiguous automatic matches;
- zero proposed UUID replacements;
- every canonical status difference is documented as “preserve canonical” unless an explicit
  business decision says otherwise;
- every property retains an existing valid parent or has an approved parent decision;
- the ledger explains the apparent count differences, including manually curated PopSG rows;
- the four named cases—NASA, ZAG, FRIDA KAHLO, FRIENDS TV—have explicit dispositions.

---

## 8. Named high-risk cases

### 8.1 NASA, ZAG, and FRIDA KAHLO

These appear active-looking in ColdLion because the API has no lifecycle flag.

Required behavior:

- mirror them faithfully;
- link only after review;
- preserve the canonical status exactly;
- never make them active due to source presence;
- show a high-severity reconciliation warning if ColdLion presence conflicts with canonical
  inactive/absent state;
- include regression fixtures proving repeated pulls cannot resurrect them.

NASA has an additional complication: PR #198 proposes a manual PopSG-backed canonical
licensor. The reconciliation must distinguish:

- existence as a record needed to classify historical/style-guide assets;
- permission to use it for new licensed work;
- lifecycle status.

Those are not the same decision.

### 8.2 `FR / FRIENDS TV`

Known facts:

- `core.licensor` has `FR = FRIENDS TV`, with a property relationship, sourced through
  DesignFlow.
- ColdLion has no corresponding `FR` licensor in the licensed divisions measured.
- ColdLion uses `FR` as a property code for “1ST ORDER TROOPER.”

Automatic behavior:

- never link the ColdLion property `FR` to the canonical licensor `FR`;
- quarantine any cross-entity code match;
- preserve the canonical FRIENDS TV UUID, status, parent relationships, and DesignFlow
  provenance;
- do not delete or inactivate FRIENDS TV because it is absent from ColdLion.

Required business decision before final cutover:

1. FRIENDS TV remains a Supabase-curated/DesignFlow-only licensor;
2. it is mapped to a different verified ColdLion key; or
3. it is retired through an explicitly approved lifecycle change.

The recommended default is option 1 until authoritative evidence supports another outcome.

### 8.3 Properties with no ColdLion-observable parent

ColdLion property presence cannot create a canonical visible property by itself.

- Existing canonical property: retain its current `licensor_id`.
- New ColdLion-only property: mirror and quarantine until a parent is assigned.
- Conflicting evidence: keep the current parent and open review.
- Item co-occurrence: attach as evidence only.

---

## 9. DesignFlow parallel run

DesignFlow is not being retained as the master-record transport forever. During preparation,
it remains the comparison source for the two facts ColdLion lacks: parent edges and lifecycle
curation.

### 9.1 Parallel-run lanes

Run both independently:

```text
Lane A: ColdLion → ingest.raw_record → plm.erp_* → mirror/reconciliation only
Lane B: DesignFlow → plm.*_import → existing core promotion/refresh path
```

Lane A must not change parent/status during the observation period. Lane B continues current
behavior until the cutover gate is approved.

### 9.2 Duration

Minimum observation:

- at least 14 consecutive calendar days;
- at least two successful scheduled ColdLion full snapshots;
- at least two successful DesignFlow refreshes;
- no unexplained failed/partial runs;
- longer if either upstream is unavailable during the window.

If DesignFlow remains operationally broken, the clock does not start merely because ColdLion
runs. First obtain a trustworthy DesignFlow comparison snapshot or explicitly approve a
frozen, dated baseline.

### 9.3 Daily comparison

For every successful pair of snapshots compare:

- source identities and names;
- new/removed/renamed source rows;
- canonical UUID resolution;
- statuses;
- property parent edges;
- unresolved/quarantined counts;
- item-use counts for affected records;
- checksum/count drift by division/type.

Any difference must be:

- explained by source ownership;
- linked to an approved review decision; or
- left open and therefore blocking cutover.

### 9.4 Parallel-run success criteria

- ColdLion runs complete without silent pair/page skips.
- All required divisions/types are present on every run.
- Re-running identical payloads produces no canonical changes.
- Name changes update only permitted source-owned data.
- Canonical status and parent-edge hashes remain unchanged during ColdLion runs.
- DesignFlow changes to status/parents are detected and preserved in `core.*`.
- No application-visible regression is observed in CRM, DAM, PM/PIM, DB Data Admin, or
  DesignFlow consumers.
- Reconciliation reaches zero unexplained differences.

---

## 10. Implementation phases

Each schema phase is a separate timestamped migration on a shared-db branch and follows:

```text
scripts/check-sql.sh
→ preview dry-run
→ preview apply
→ preview verification/tests
→ PR checks
→ merge
→ approved production apply when applicable
```

Do not stack this work on an unrelated open schema PR.

### Phase 0 — baseline and decisions

Deliver:

- current in-flight work serialized;
- dated live baseline;
- entity field-ownership matrix approved;
- licensed division/type allowlist derived from headers;
- status policy confirmed as Supabase-owned;
- parent policy confirmed as Supabase-owned;
- FRIENDS TV disposition recorded or explicitly deferred to curated-only;
- naming/display-name handling decided;
- current consumers and dependency graph recorded.

Gate: no unanswered question can change schema shape or automatic matching behavior.

### Phase 1 — additive mirror and review schema

Deliver:

- `plm.erp_licensor`;
- `plm.erp_property`;
- reuse/extension of all-division header dictionary;
- resolution-review table;
- read-only reconciliation views;
- grants/RLS following existing `plm` internal-table patterns;
- comments documenting field ownership;
- SQL fixtures and schema tests.

Gate: preview migration is additive, application behavior is unchanged, and all tests pass.

### Phase 2 — mirror-only runner and importer

Deliver:

- shared ColdLion paging/validation reuse;
- operational runner;
- `mirror_only` database function and public wrapper;
- durable failure recording;
- sync accounting;
- empty/short/semantic-change guards;
- unit tests for fetch classification and payload validation;
- SQL tests for idempotent mirror upserts.

Gate: preview can pull a complete snapshot twice with identical second-run results and zero
canonical mutations.

### Phase 3 — reconciliation and human decisions

Deliver:

- complete reconciliation artifacts;
- approved exact mappings;
- aliases/renames reviewed;
- lapsed-license decisions recorded;
- FRIENDS TV handled;
- every ColdLion-only and canonical-only row classified;
- parent-edge evidence report.

Gate: zero ambiguous automatic matches and 100% categorized coverage.

### Phase 4 — approved canonical linking

Deliver:

- `link_approved` mode;
- ColdLion source refs added beside DesignFlow refs;
- mirror rows linked to existing canonical UUIDs;
- no canonical creates unless separately approved;
- before/after UUID, status, and parent hashes.

Gate:

- canonical row counts unchanged unless approved;
- canonical UUID set unchanged;
- status hash unchanged;
- parent-edge hash unchanged;
- all dependent FK counts unchanged;
- applications pass preview smoke tests.

### Phase 5 — controlled creation of approved new records

Only if reconciliation finds legitimate ColdLion-only records that applications need:

- create reviewed canonical rows;
- seed conservative lifecycle status;
- assign approved parent before exposing new properties;
- attach ColdLion source refs;
- retain review evidence.

Gate: every new row has an explicit approval record and no unresolved parent/status.

### Phase 6 — parallel run

Deliver:

- scheduled mirror-only ColdLion sync;
- continued DesignFlow sync;
- daily comparison;
- alerts;
- at least 14 days of evidence.

Gate: all §9.4 success criteria pass.

### Phase 7 — production source cutover

“Cutover” here means ColdLion becomes the routine direct source of licensor/property
identity and descriptions. It does not transfer parent/status ownership.

Deliver:

- production-approved schedule;
- final full ColdLion snapshot;
- guarded link/promotion run;
- current canonical backup/export evidence;
- monitoring dashboard/query;
- application smoke tests;
- rollback rehearsal evidence.

Gate: §12 production checklist passes in an approved window.

### Phase 8 — DesignFlow deprecation

Do not immediately drop DesignFlow staging.

1. Stop DesignFlow from overwriting master-record fields now owned by ColdLion.
2. Continue consuming or comparing relationship/status data until a replacement curation
   workflow is proven.
3. Observe a defined deprecation period.
4. Verify no views, functions, jobs, application code, or recovery procedures use
   `plm.licensor_import` / `plm.property_import`.
5. Only then author a separate contract migration to retire obsolete transport objects.

Dropping DesignFlow staging is not part of the initial production cutover.

---

## 11. Test plan

### 11.1 SQL contract tests

Add rolled-back tests under `supabase/tests/` for:

1. mirror insert;
2. mirror update by composite key;
3. same `mgCode` in different divisions remains distinct;
4. same `mgCode` across entity types remains distinct;
5. `mgDesc` rename updates the mirror without creating a duplicate;
6. rerun idempotency;
7. existing ColdLion source-ref match;
8. approved manual match;
9. exact compatible DesignFlow match;
10. ambiguous name match quarantines;
11. new record quarantines by default;
12. `FR` property cannot match FRIENDS TV licensor;
13. ColdLion presence cannot activate an inactive canonical record;
14. ColdLion absence cannot inactivate/delete a canonical record;
15. changed payload cannot modify `property.licensor_id`;
16. changed payload cannot modify canonical UUID;
17. property creation without approved parent fails;
18. mirror-only mode produces zero canonical/source-ref mutations;
19. link-approved mode cannot create canonical rows;
20. failed validation produces no partial canonical work;
21. run accounting matches actual operations;
22. grants/RLS deny browser mutation;
23. source-ref uniqueness uses the full composite key;
24. NASA/ZAG/FRIDA fixtures remain inactive or quarantined;
25. a DesignFlow parent/status change survives the next ColdLion pull.

### 11.2 Runner unit tests

Test:

- pagination;
- array and paged response forms;
- non-JSON/HTTP failure;
- missing API key;
- empty headers;
- missing licensed division;
- semantic header change;
- empty details;
- suspicious short pull;
- duplicate conflicting natural key;
- terminal-page detection;
- durable failure SQL generation;
- `--dry-run` default/safety;
- explicit target/environment reporting;
- no secret emission.

### 11.3 Preview integration tests

- first full snapshot;
- identical second snapshot;
- simulated name change;
- simulated code collision;
- simulated missing page;
- simulated lapsed record;
- approved link run;
- status/parent hash comparison;
- concurrent-run lock;
- rollback after forced failure.

### 11.4 Application smoke tests

Against preview, verify:

- DB Data Admin licensor/property tree and filters;
- DAM assets/style-guide lookups;
- PM/PIM licensor/property pickers;
- CRM consumers, if any;
- DesignFlow item creation/reference validation;
- item→taxonomy resolver;
- inactive records remain hidden wherever currently required;
- existing deep links and UUID-based selections still work.

---

## 12. Production cutover checklist

All items must be true:

- [ ] No other shared schema change is in flight.
- [ ] Phase 0 decisions are recorded.
- [ ] SQL checks pass.
- [ ] Preview dry-run contains only intended additive changes.
- [ ] Preview migration and importer tests pass.
- [ ] Reconciliation covers 100% of records.
- [ ] No unresolved ambiguous/entity-type matches.
- [ ] NASA, ZAG, FRIDA KAHLO, and FRIENDS TV have recorded dispositions.
- [ ] Canonical UUID preservation is proven.
- [ ] Canonical status preservation is proven.
- [ ] Property parent-edge preservation is proven.
- [ ] Parallel run meets the minimum duration and success criteria.
- [ ] All application preview smoke tests pass.
- [ ] Empty/short-pull, semantic-change, and durable-failure alerts are proven.
- [ ] Rollback has been rehearsed on preview.
- [ ] A pre-cutover canonical export and hashes are stored securely as verification evidence.
- [ ] Production window is explicitly approved.
- [ ] Production CLI is linked to the correct project and dry-run is clean.
- [ ] Post-cutover run accounting is successful.
- [ ] Production application smoke tests pass.
- [ ] Monitoring is watched through at least the next scheduled run.

Evidence must include the migration version, PR URL, merge SHA, workflow run, sync-run UUID,
before/after counts, status hash, parent-edge hash, and application verification results.

---

## 13. Rollback and recovery

Because the groundwork is additive, the primary rollback is operational:

1. disable the ColdLion licensor/property schedule;
2. leave `plm.erp_*` mirrors in place for evidence;
3. restore the DesignFlow master-record refresh as the only promoter;
4. remove or deactivate erroneous ColdLion source refs only through a reviewed corrective
   migration;
5. restore canonical descriptive fields from the pre-cutover export if an allowlisted field
   was changed incorrectly;
6. verify canonical UUID, status, and parent hashes;
7. run application smoke tests.

Rollback must not:

- delete canonical rows;
- regenerate UUIDs;
- null parent edges;
- blanket-activate/inactivate records;
- drop mirrors while investigating;
- run direct ad-hoc production DDL.

If new canonical rows were created during the cutover, default recovery is to mark them
inactive and unlink application visibility after dependency review—not hard-delete them.

A later schema cleanup (dropping obsolete functions/tables) requires its own migration and
cannot be the emergency rollback mechanism.

---

## 14. Operational ownership after cutover

### Scheduled jobs

- ColdLion direct mirror: routine scheduled pull, with a weekly full reconciliation at
  minimum.
- Relationship/status curation: initially DesignFlow comparison plus Supabase canonical
  curation; eventually DB Data Admin or another explicitly owned workflow.
- Drift report: scheduled comparison of source identities, canonical links, status, and
  parent edges.

### Alerts

Alert on:

- fetch/auth/HTTP failure;
- empty or suspicious short pull;
- missing division/type;
- `mgTypeDesc` semantic change;
- incomplete pagination;
- new ambiguity/collision;
- new ColdLion-only record;
- canonical-only row disappearing from source expectations;
- attempted curated-field mutation;
- status/parent hash change caused by ColdLion lane;
- two consecutive non-successful runs;
- stale successful run beyond the agreed schedule.

### Human maintenance

DB Data Admin is the preferred long-term surface for:

- resolving new/ambiguous source matches;
- setting lifecycle status;
- assigning/reassigning property parent edges;
- maintaining aliases/display names;
- reviewing drift.

Those mutations require audit history and must not be implemented as raw table editing.

---

## 15. Exact first implementation handoff

The first coding session must implement **Phase 1 only**:

1. Re-run in-flight-work checks and stop if another schema PR exists.
2. Capture the dated baseline.
3. Confirm/reuse the existing all-division header dictionary.
4. Add mirror and review tables, constraints, indexes, comments, grants/RLS, and comparison
   views.
5. Add SQL fixtures for composite keys, entity-type collisions, curated-field protection,
   and named lapsed cases.
6. Run `scripts/check-sql.sh`.
7. Authenticate Supabase CLI through the canonical 1Password path.
8. Link to preview `rjyboqwcdzcocqgmsyel`.
9. Run `supabase db push --dry-run`.
10. Apply to preview and run all SQL tests.
11. Prove no application-facing rows or views changed.
12. Open the shared-db PR and merge only when the docs-only/schema checklist in AGENTS.md is
    satisfied.

It must **not**:

- fetch production ColdLion data into canonical tables;
- add a schedule;
- create/link canonical records;
- disable DesignFlow;
- resolve FRIENDS TV by assumption;
- promote the migration to production outside an approved window.

The second handoff implements Phase 2 mirror-only ingestion. Keeping these separate makes the
schema reviewable before any external data is introduced.

---

## 16. Definition of done

This work is complete only when:

- ColdLion directly and reliably mirrors every licensed-division licensor/property source
  row into typed `plm.erp_*` tables;
- every mirror row has a reviewed resolution state;
- `core.*` remains the sole stable application-facing canonical layer;
- canonical UUIDs, statuses, and parent edges are demonstrably preserved;
- source-field refreshes are guarded by an explicit allowlist;
- lapsed licenses cannot be resurrected by synchronization;
- `FR` cannot cross-match entity types;
- the 22/258 versus canonical population is fully reconciled, not merely count-matched;
- DesignFlow and ColdLion have run in parallel long enough to prove behavior;
- alerts and durable failure records work;
- production cutover and rollback are verified;
- DesignFlow is retired only from the master-record transport role, while relationship and
  lifecycle ownership remain explicitly maintained in Supabase.

---

## 17. Related authoritative documents

- [`AGENTS.md`](AGENTS.md) — shared schema ownership, preview-first protocol, and
  anti-collision rules.
- [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md) —
  verified ColdLion/DesignFlow semantics, division/type rules, lifecycle behavior, and `FR`.
- [`docs/coldlion-direct-sync-and-taxonomy-plan.md`](docs/coldlion-direct-sync-and-taxonomy-plan.md) —
  broader direct-sync and item-wiring architecture.
- [`docs/master-data-cutover-scoreboard.md`](docs/master-data-cutover-scoreboard.md) —
  source/mirror naming convention and last verified cutover state.
- [`fix_item_taxonomy_wiring.md`](fix_item_taxonomy_wiring.md) — separate item→canonical FK
  resolver and item cutover.
- [`docs/coldlion-erp-api-reference.md`](docs/coldlion-erp-api-reference.md) — endpoint,
  paging, and authentication behavior.
- [`docs/app-migration-notes/coldlion-customers-vendors-20260715.md`](docs/app-migration-notes/coldlion-customers-vendors-20260715.md) —
  earlier ColdLion master-data cutover pattern.
- [`supabase/migrations/20260715234500_erp_coldlion_customer_vendor_import.sql`](supabase/migrations/20260715234500_erp_coldlion_customer_vendor_import.sql) —
  typed mirror/source-ref precedent.
- [`tools/sync-coldlion-vendors.mjs`](tools/sync-coldlion-vendors.mjs) and
  [`tools/coldlion-sync-common.mjs`](tools/coldlion-sync-common.mjs) — guarded pull,
  pagination, and durable-failure patterns.
