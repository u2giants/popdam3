# ColdLion licensor/property master-data cutover

**Status:** Phase 2A (mirror-only importer) is implemented and verified on preview.
Migrations `20260724060000` and `20260724061000` are applied to preview; rolled-back
contracts pass; preview still has zero mirror rows, zero Phase 2 sync runs, and zero
schedules. Phase 2A has performed **no importer pull**; the first real preview pull is the
Phase 2B session. Phase 2A
writes only Phase 1 mirrors/evidence and seeds cross-entity `conflict` findings; it
does not link, create, status, re-parent, or source-ref any canonical record. Later
phases remain gated by this plan; this document does not by itself authorize a
production data run, schedule, canonical linking, canonical creation, or DesignFlow
cutover.

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

### Shipped Phase 1 state — authoritative correction to the original draft

Implementation PR [#208](https://github.com/u2giants/shared-db/pull/208), merge
`eda80e7e6fd420e53394dc2947c07d45fbadd44a`, shipped migration
`20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql` to preview
and production on 2026-07-24.

The shipped model intentionally improves the illustrative §4 draft:

- `core.property.licensor_id` is now `NOT NULL` with `ON DELETE RESTRICT`;
- mirror rows have semantic FKs to the division-aware header dictionary;
- review IDs are typed `proposed_licensor_id` / `proposed_property_id` and
  `resolved_licensor_id` / `resolved_property_id`, not polymorphic UUIDs;
- canonical-only findings carry no invented ColdLion key;
- partial unique indexes allow one active finding while preserving terminal history;
- the status/resolution/resolver matrix is CHECK-enforced;
- raw mirror payloads are required and have no silent default;
- authenticated browser roles have SELECT only; service-role workers write;
- all three reconciliation views are read-only and omit raw payloads.

When this plan's earlier example DDL differs from the applied migration, the
applied migration and its SQL contracts are authoritative. Never edit the
applied migration; use a new timestamped migration for any correction.

---

## 1. Why this work is needed

Today:

- `core.licensor` and `core.property` are already the canonical application-facing tables.
- Their records are populated through DesignFlow staging:
  `plm.licensor_import` / `plm.property_import`.
- `core.taxonomy_source_ref` contains DesignFlow provenance only.
- Phase 1 created direct ColdLion mirror tables `plm.erp_licensor` and
  `plm.erp_property`; they are intentionally empty until Phase 2.
- ColdLion exposes the source records through division-specific merch-group dictionaries,
  not dedicated `/licensors` or `/properties` endpoints.
- For licensed divisions, the original live measured counts were approximately
  22 ColdLion licensors and 258 ColdLion properties. After the merged PopSG
  manual backfill, Phase 1 production verification found 26 canonical licensors
  and 256 canonical properties. Counts are dated evidence, never hard-coded guards.
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
| Canonical licensors | 26 after merged PopSG manual backfill; reverify before each run |
| Canonical properties | 256 |
| DesignFlow licensor staging | 37 rows collapsing to 20 distinct canonical licensors |
| DesignFlow property staging | 468 rows collapsing to 256 canonical properties |
| ColdLion CW001 licensors | 22 |
| ColdLion CW001 properties | 258 |
| ColdLion lifecycle flag | None |
| ColdLion parent relationship | None |
| DesignFlow provenance | 505 `core.taxonomy_source_ref` rows, all `designflow_plm` at last verification |

PR #198 merged the manually curated PopSG licensors, including NASA. This
changed the canonical count and demonstrates why the cutover must compare row
identities rather than use `20/256`, `26/256`, or any source count as a
hard-coded production assertion. Every operational phase takes a fresh baseline.

The table above was re-measured live against production on 2026-07-24 and matches;
snapshot with per-status breakdown, the 6 provenance-free `X-` licensors, and the
current disposition of the named high-risk cases:
[`docs/verification/licensor-property-cutover-baseline-20260724.md`](docs/verification/licensor-property-cutover-baseline-20260724.md).
That snapshot covers the measurement rows below but **not** the full Phase-0 artifact
(it does not yet enumerate all parent edges, per-division ColdLion counts beyond CW001,
or the complete dependency inventory) — the first implementation PR still owes those.

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

Phase 1 shipped before that full artifact was completed. Phase 2A now owns the
remaining obligation: it must extend the dated baseline before importer coding
begins. The existing
`docs/verification/licensor-property-cutover-baseline-20260724.md` is useful
evidence, but it is not a substitute for the missing per-division ColdLion
inventory, complete parent-edge export, unmatched/ambiguous ledger, source-ref
inventory, and consumer dependency graph listed above.

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

Phase 1 added typed mirror tables. They contain source facts and resolution
state; they are not application master tables.

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

It must not be only `mgCode`. Phase 2A fixed the concrete encoding as the slash-joined
`<companyCode>/<divisionCode>/<mgTypeCode>/<mgCode>` used today for
`ingest.raw_record.source_id` by `plm.sync_coldlion_licensors_properties`; Phase 4
`link_approved` must write `core.taxonomy_source_ref.source_id` in this same form so a
source ref resolves back to one mirror row.

Splitting `core.taxonomy_source_ref` into strict per-entity source-ref tables is a separate
schema-hardening decision. Do not combine it with this cutover unless it is required for
correctness; unnecessary simultaneous refactoring increases production risk.

### 4.4 Reconciliation and quarantine

Phase 1 added the durable `plm.taxonomy_resolution_review` table rather than
hiding ambiguous rows in logs. Its applied contract is authoritative:

- typed proposed/resolved Licensor and Property FKs, never polymorphic UUIDs;
- `finding_scope='source'` requires the real ColdLion composite key;
- `finding_scope='canonical_only'` forbids invented source keys;
- partial unique indexes permit at most one active
  `open|quarantined|conflict` finding while retaining terminal history;
- `approved_link` requires the matching typed resolved ID, nonblank resolver,
  resolution timestamp, and coherent status/resolution pair;
- non-approved states cannot carry resolved-link fields;
- browser roles cannot mutate the review queue.

Exact columns and constraints are in migration `20260724030000` and
`supabase/tests/coldlion_licensor_property_phase1_contracts.sql`.

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

NASA has an additional complication: merged PR #198 added a manual
PopSG-backed canonical licensor. The reconciliation must distinguish:

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

### Mandatory fresh-session and forward-impact protocol

Use a new AI session with a fresh context window for:

- Phase 2 implementation;
- the first real preview pull and comparison;
- Phase 3 reconciliation/human-decision preparation;
- each of Phases 4–8;
- any recovery/correction that changes a previously approved phase.

Do not combine Phase 2 implementation with its first operational preview
comparison. The implementation session proves code and contracts; the next
fresh session runs it against preview, investigates the full result set, and
updates later-phase assumptions without carrying coding tunnel vision.

At the start of **every** phase session, the implementing agent must:

1. Read `AGENTS.md`, the dedicated handoff, and this entire plan—not only the
   current phase.
2. Read every later phase, the test plan, production checklist, rollback plan,
   and operational-ownership sections.
3. Read the authoritative related documents in §17 that touch its files or data.
4. Reverify current GitHub, preview, production, API, row-count, and scheduler
   facts rather than trusting dated counts.
5. State which current-phase decisions could constrain later phases.

Before ending **every** phase session, the agent must perform a forward-impact
audit:

- Did the implementation change a table, column, key, status, mode, permission,
  function signature, source-reference encoding, run-accounting field, or view
  assumed by a later phase?
- Did live API/database behavior contradict any future-phase assumption?
- Did a new ambiguity, source collision, lifecycle case, relationship case,
  operational limit, access constraint, or failure mode appear?
- Do later tests, acceptance gates, rollback steps, schedules, smoke tests, or
  production evidence requirements need revision?
- Does another workstream—items, style guides/characters/royalties, DB Data
  Admin, DAM, PM/PIM, CRM, or DesignFlow—now need an explicit dependency?

If any answer is yes, update this plan and the dedicated handoff in the same
session. Name the affected future phase and the exact change. A session may not
report complete while knowingly leaving a later phase based on a false
assumption. If no future phase is affected, record an evidence-based “no
forward-plan changes” statement in the handoff.

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

### Phase 1 — additive mirror and review schema — COMPLETE

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

Completion evidence: PR #208, merge `eda80e7`, migration `20260724030000`,
preview and production contract tests, and
`docs/verification/coldlion-licensor-property-phase1-20260724.md`.

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

Run Phase 2 as two fresh sessions:

1. **Phase 2A — implementation session:** build and test the runner/importer
   without performing a production run.
2. **Phase 2B — preview operation/comparison session:** execute the first two
   complete preview snapshots, inspect every category and guard, and produce the
   dated comparison artifact used by Phase 3.

Phase 2A's implementing agent must read Phases 3–8 first and preserve everything
they will require: deterministic source identity, durable run IDs, immutable raw
evidence, resolution history, before/after hashes, replayability, modes that can
later add approved links without rewriting the mirror, and enough accounting to
prove canonical UUID/status/parent immutability.

**Phase 2A completion evidence (2026-07-24):**

- final preview function contract: `20260724061000`, applied after `20260724060000`;
- 34 runner unit tests, static checks, and rolled-back preview SQL contracts pass;
- preview has 0 mirror rows, 0 Phase 2 sync runs, and 0 Phase 2 schedules;
- raw detail payloads are preserved without a stamped `mgTypeDesc`; pair meaning travels
  separately and runner/database both enforce configured completeness;
- residual Phase 0 evidence is under
  `docs/verification/coldlion-licensor-property-phase0-20260724/`;
- Phase 2B commands/evidence fields are in
  `fix_coldlion_licensor_property_phase2a_handoff.md`.

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
5. `mgDesc` rename updates the mirror without creating a duplicate; a change to any other
   raw source field must also change the raw/source hash and register as an update;
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

## 15. Exact next implementation handoffs

### 15.1 Phase 2A — fresh implementation session

Implement only the mirror-only runner/importer. Required deliverables:

1. Re-run in-flight-work and scheduler/duplicate-sync checks.
2. Read this full plan, especially Phases 3–8, §11 tests, §12 production
   checklist, §13 rollback, and §14 operations.
3. Complete the remaining Phase 0 baseline obligation in §2 before coding.
   Extend the dated verification artifact with every listed inventory and
   dependency, clearly separating freshly measured facts from historical
   evidence. If a source is unavailable, record the exact blocker and stop
   rather than silently omitting that section.
4. Reuse `tools/coldlion-sync-common.mjs` and the guarded vendor-sync durable
   failure pattern where their contracts fit; do not fork paging/failure logic
   casually.
5. Fetch headers for every enabled division, derive Licensor/Property pairs
   from normalized descriptions, then fetch all detail pages/array responses.
6. Build deterministic composite natural keys and source hashes.
7. Add a `mirror_only` database entry point that can write only Phase 1 mirrors,
   run accounting, and unresolved/review findings. It must not mutate
   `core.*`, `core.taxonomy_source_ref`, canonical links, status, or parents.
8. Enforce completeness independently in runner and database: headers,
   divisions/types, terminal pagination, nonempty sets, semantic stability,
   duplicate conflicts, configurable count/sanity bands, and concurrent-run lock.
9. Record failures durably outside a rolled-back promotion transaction and
   alert according to the existing two-consecutive-failure pattern.
10. Add unit and rolled-back SQL contracts covering §11.1–11.2 Phase 2 cases,
   named lapsed records, `FR`, idempotency, raw audit, no secret output, and
   zero canonical/source-ref mutations.
11. Run local/static checks and preview migration rehearsal if Phase 2 needs a
    new migration. Do not perform the first real external preview pull in this
    coding session.
12. Update this plan/handoff using the mandatory forward-impact audit.

Exit gate: the complete Phase 0 baseline artifact exists with every §2 item
present or an explicit blocking ruling; code is merged; CI is green; preview
schema/contracts pass; no schedule exists; no production data run occurred;
and a fresh Phase 2B session has exact commands and evidence fields for the
operational run.

### 15.2 Phase 2B — fresh preview run and comparison session

This is deliberately separate from implementation.

1. Re-read the entire plan and the Phase 2A handoff/diff.
2. Confirm the target is preview `rjyboqwcdzcocqgmsyel`, display it in output,
   and confirm no production credential/URL is in use.
3. Capture pre-run canonical counts plus UUID, status, and parent-edge hashes;
   mirror/review counts; latest successful run; DesignFlow comparison snapshot;
   and named-case state.
4. Run one full `mirror_only` snapshot.
5. Verify paging, type-pair coverage, counts/hashes, run accounting, raw evidence,
   failures/alerts, review categories, and zero canonical/source-ref mutations.
6. Run the identical full snapshot again. Prove idempotency: no duplicates,
   stable source hashes/links, expected last-seen changes only, and no canonical
   changes.
7. Categorize every ColdLion and canonical row; inspect NASA, ZAG, FRIDA KAHLO,
   FRIENDS TV/`FR`, collisions, canonical-only, ColdLion-only, and inactive cases.
8. Compare with a trustworthy dated DesignFlow snapshot. If DesignFlow is
   unavailable/stale, record that explicitly and do not start the parallel-run clock.
9. Exercise DAM, PopSG, PM/PIM, CRM if applicable, DB Data Admin, DesignFlow
   validation, and item-taxonomy preview smoke checks without changing production.
10. Write a dated `docs/verification/` artifact containing run UUIDs, commands,
    counts, hashes, category ledger, unexplained differences, failures, screenshots
    or HTTP evidence where relevant, and a Phase 3 readiness ruling.
11. Perform the future-phase impact audit and update Phases 3–8 before handoff.

Exit gate: two complete successful preview runs, identical second-run result,
zero canonical mutation, 100% categorized rows or explicitly blocking findings,
and a fresh Phase 3 session can start without this conversation.

### 15.3 Phase 3 and every later phase

Use one fresh session per phase. Each session receives:

- the latest dedicated handoff;
- this full plan with all forward-impact updates;
- the preceding phase's dated verification artifact and run UUIDs;
- exact unresolved decisions and owners;
- explicit environment/access instructions without secret values;
- entry criteria, deliverables, tests, exit gate, rollback, and next-phase impact.

Phase 3 must produce the complete human-decision ledger and may not link
canonical records. Phase 4 alone introduces approved linking. Phase 5 alone
creates specifically approved new canonical records. Phase 6 is the measured
parallel run. Phase 7 is the separately approved production source cutover.
Phase 8 is a later DesignFlow deprecation—not an automatic consequence of
Phase 7.

Per-phase cold-start contracts:

- **Phase 3 — reconciliation and decisions.** Entry: Phase 2B verification
  artifact with two successful runs and trustworthy DesignFlow baseline.
  Deliver: a row-level ruling ledger for every source/canonical row, named-case
  dispositions, alias/rename decisions, parent evidence, and zero unexplained
  ambiguity. The starting exception ledger must include the freshly measured FRIDA KAHLO
  Licensor-to-canonical-Property code collision, not only NASA, ZAG, and FRIENDS TV. No
  canonical link/create is allowed. Exit: 100% categorized,
  human owners named for every non-automatic decision, and Phase 4's exact
  approved mapping input frozen and hashed.
- **Phase 4 — approved linking.** Entry: approved Phase 3 ledger and unchanged
  baseline hashes. Deliver: `link_approved` mode, deterministic ColdLion source
  refs, mirror links to existing UUIDs, run accounting, and preview app smoke
  evidence. No canonical creates. Exit: UUID, row-count, status, parent, and
  dependent-FK hashes unchanged; rollback of links rehearsed; Phase 5 need
  explicitly ruled yes/no.
- **Phase 5 — approved new records, only if needed.** Entry: individually
  approved ColdLion-only records with explicit status and Property parent.
  Deliver: conservative canonical creation plus source refs and audit evidence.
  Exit: every new row traces to approval, no unresolved parent/status, all app
  visibility reviewed, and recovery defaults to inactive/unexposed—not delete.
- **Phase 6 — parallel run.** Entry: Phases 3–5 complete or explicitly not
  needed, schedules/alerts tested, and DesignFlow comparison trustworthy.
  Deliver: at least 14 consecutive days, two ColdLion full snapshots, two
  DesignFlow refreshes, daily comparisons, application smoke evidence, and no
  unexplained failures. Use persistent monitoring plus a fresh evaluation
  session; do not pretend one chat turn constitutes the observation window.
  Exit: all §9.4 criteria pass and the production-cutover evidence package is complete.
- **Phase 7 — production source cutover.** Entry: Phase 6 evidence, rollback
  rehearsal, secure pre-cutover export/hashes, clean production dry-run, and
  Albert's explicit production-window approval. Deliver: guarded final snapshot,
  approved link/promotion only, schedule/monitoring activation, app smoke tests,
  and watched next scheduled run. Exit: §12 checklist fully evidenced; any
  failure triggers §13 operational rollback.
- **Phase 8 — DesignFlow deprecation.** Entry: Phase 7 stable through the agreed
  observation period and an owned replacement for relationship/status curation.
  Deliver: stop only superseded master-field writes, prove no consumers/jobs/
  recovery paths need staging, then use a separate contract migration if
  retirement is justified. Exit: DesignFlow transport dependency removed
  without losing parent/lifecycle ownership or rollback capability.

Every one of these sessions must rerun the forward-impact audit and rewrite the
later cold-start contract when evidence changes it.

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
