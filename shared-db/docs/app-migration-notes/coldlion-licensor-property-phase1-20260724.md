# ColdLion licensor/property cutover — Phase 1 (mirror schema only)

**Date:** 2026-07-24 (revised: active partial unique + status/resolution matrix)
**Branch worktree:** `codex/grok-neutral-taxonomy-phase1`
**Migration:** `supabase/migrations/20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`
**SQL contracts:** `supabase/tests/coldlion_licensor_property_phase1_contracts.sql`
**Plan (do not edit from this work):** `fix_coldlion_licensor_property_cutover.md`

## What / why

Phase 1 adds **additive storage** for ColdLion licensed-division licensor/property
mirrors and review findings, and **enforces** the neutral parent-edge business
rule on canonical data:

| Concern | Owner / enforcement |
|---|---|
| Source identity / descriptions | ColdLion → `plm.erp_licensor` / `plm.erp_property` |
| Stable UUIDs apps use | `core.licensor` / `core.property` |
| Property → Licensor parent | **ENFORCED NOW:** `core.property.licensor_id` **NOT NULL** scalar FK → `core.licensor(id)` **ON DELETE RESTRICT** (constraint name `property_licensor_id_fkey`) |
| Active / inactive | `core.*.status` (Supabase-curated; ColdLion has no flag) |

Preview evidence used for the NOT NULL gate: **256** `core.property` rows, **0** null
`licensor_id`. Migration preflight **raises loudly** if any null parent exists.

## Schema

| Object | Role |
|---|---|
| `core.property.licensor_id` | NOT NULL + `property_licensor_id_fkey` ON DELETE RESTRICT (name preserved) |
| `plm.merch_group_header` | Extended (`source_hash`, `last_seen_at`, `last_sync_run_id`) + **unique semantic key** `(company_code, division_code, mg_type_code, mg_type_desc)` |
| `plm.erp_licensor` | Typed mirror; composite PK; **FK to header semantic key** ON DELETE RESTRICT; `raw jsonb not null` **no default** |
| `plm.erp_property` | Same pattern for properties |
| `plm.taxonomy_resolution_review` | Typed `proposed_*` / `resolved_*` FKs; `finding_scope` `source` \| `canonical_only`; **partial unique active findings**; **status/resolution CHECK matrix** |
| `api.coldlion_*` views | Read-only evidence; no raw payloads; open-review lateral join uses active statuses only |

### Header semantics

Mirror rows cannot claim `mg_type_desc='Licensor'` when the header for that
`(division, mg_type_code)` is `Big Theme` (or anything else). The four-column FK
to `plm.merch_group_header` enforces that.

### Review model

- **Source findings** (`finding_scope='source'`): real ColdLion composite key required.
- **Canonical-only** (`finding_scope='canonical_only'`): source keys **must be null**;
  subject is `proposed_licensor_id` or `proposed_property_id` (no invented ColdLion keys).
- Typed columns only — no polymorphic `proposed_entity_id` / `resolved_entity_id`.

#### Active uniqueness (preserves review history)

Partial unique indexes (not full-table unique):

| Index | Keys | Predicate |
|---|---|---|
| `plm_taxonomy_resolution_review_source_uidx` | `(entity_type, company_code, division_code, mg_type_code, mg_code)` | `finding_scope='source'` **and** `status in ('open','quarantined','conflict')` |
| `…_canonical_licensor_uidx` | `proposed_licensor_id` | canonical_only + licensor + active statuses |
| `…_canonical_property_uidx` | `proposed_property_id` | canonical_only + property + active statuses |

**Active statuses** = `open` | `quarantined` | `conflict` (still on the work queue).
**Terminal history** = `approved_link` | `ignored` | `dismissed` (do **not** participate in the unique predicate).

A second **active** finding for the same source key fails. After the active row is
`dismissed` or `approved_link`, a **new** active finding for that same key is allowed.
Historical rows stay; nothing is deleted to “free” the key.

#### Status / resolution / resolved-\* matrix (CHECK-enforced)

Two constraints work together:

- `plm_taxonomy_resolution_review_status_resolution_ck` — legal status↔resolution pairs
- `plm_taxonomy_resolution_review_resolved_link_ck` — resolved package rules

| status | resolution (allowed) | resolved IDs / by / at |
|---|---|---|
| `open` | NULL, `unmatched`, `ambiguous`, `canonical_only`, `deferred` | all null |
| `quarantined` | NULL, `quarantined`, `unmatched`, `ambiguous` | all null |
| `conflict` | NULL, `conflict` only | all null |
| `ignored` | NULL, `ignored` only | all null |
| `dismissed` | NULL, `deferred`, `unmatched`, `ignored`, `canonical_only` | all null |
| `approved_link` | **`approved_link` required** | correct typed resolved ID **+** nonblank `resolved_by` **+** nonnull `resolved_at` |

Hard rules:

- `status=approved_link` requires `resolution=approved_link`, the typed resolved ID
  (`resolved_licensor_id` xor `resolved_property_id` per `entity_type`), nonblank
  `resolved_by`, and nonnull `resolved_at`.
- Every non-approved status must keep **both** resolved IDs, `resolved_by`, and
  `resolved_at` null, and must **not** carry `resolution=approved_link`.
- A `conflict` row cannot say `resolution=ignored`; an `ignored` row cannot say
  `resolution=conflict`.
- Typed licensor/property FK column separation is preserved (`entity_columns_ck`).

### Grants / RLS (browser writes forbidden)

- SELECT policies only for `authenticated` (no INSERT/UPDATE/DELETE/ALL policies).
- `REVOKE ALL` from `public`, `authenticated`, and `anon` (when present).
- `GRANT SELECT` to `authenticated`; `GRANT ALL` to `service_role`.

### Header `last_seen_at` honesty

Column add uses `NOT NULL DEFAULT now()` so existing header rows can receive the
column. That **migration-time stamp is not ColdLion freshness**. Only a real
header sync that writes `last_seen_at` / `last_sync_run_id` proves a pull.

## What Phase 1 does **not** include

- ColdLion fetch / runner / schedule / public write wrapper
- Canonical promotion or source-ref linking importer
- DesignFlow staging disablement
- Production apply (requires a separately approved production window)
- Phase 2 importer, scheduler, canonical linking, and DesignFlow cutover

## Tests

`supabase/tests/coldlion_licensor_property_phase1_contracts.sql` (begin → assert → rollback):

- attnotnull + RESTRICT delete action; null parent insert fails; licensor delete RESTRICT
- Header semantic FK (EH001 Big Theme cannot be lied into as Licensor)
- Composite uniqueness; FR collision **only on mirrors** (core fixtures use unique codes)
- Typed review FKs; full approved_link package; canonical_only without fake keys
- **Partial unique active findings:** second active fails; new active succeeds after
  dismiss and after approved_link (history row counts)
- **Status/resolution matrix:** valid samples + invalid pairs (conflict/ignored,
  blank `resolved_by`, missing `resolved_at`, open with resolved package, wrong typed ID)
- Rerun idempotency; ambiguity quarantine; NASA/ZAG/FRIDA inactive survival
- No status / parent mutation from mirror refresh
- raw NOT NULL no default; authenticated has no mutation privileges or write policies
- Views present without raw

Static: `tools/coldlion-licensor-property-phase1.test.mjs`

## Risks

| Risk | Mitigation |
|---|---|
| Apply blocked by unexpected null parents | Loud preflight exception with count |
| Future importer mutates status/parent | Comments + Phase 2 `mirror_only` default + contracts |
| FR code cross-match | Separate mirrors + typed review checks + conflict findings |
| One finding forever (blocked history) | Partial unique on **active** statuses only |
| Loose approved_link / mismatched labels | CHECK matrix on status/resolution/resolved-\* |
| Treating migration `last_seen_at` as freshness | Column comment + this note |
| Treating mirrors as app master data | Apps stay on `core.*` |

## Next (Phase 2 — not this change)

Mirror-only runner + importer: upsert headers/details, open review findings, **zero**
canonical mutations by default.
