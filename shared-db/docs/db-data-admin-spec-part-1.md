---
summary: DB Data Admin product and implementation specification part 1 of 2: sections 1, 2, 3, 4, 5, 6, 7, 8, 9.
kind: spec
status: current
read-when: building or changing DB Data Admin (data.designflow.app) behaviour covered by these sections
---

# DB Data Admin — authoritative product and implementation specification — part 1 of 2

> Moved **verbatim** from [`DB_Data_Admin.md`](../DB_Data_Admin.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

## 1. What we are building and why

DB Data Admin is the administrator-facing application for reviewing and maintaining the
canonical business data shared by PopDAM, PopCRM, PopPIM/PM, and DesignFlow PLM. Its first
four managed entities are:

1. Customers
2. Vendors (stored as `core.factory`; the UI must always say **Vendor**)
3. Licensors
4. Properties

Weeks of canonicalization work created clean shared records, display names, aliases,
source-system references, merge functions, and de-duplication logic. Today much of that is
visible only through SQL or application pickers. DB Data Admin makes the canonical layer
visible and safely editable by authorized administrators.

This is **not** PopDAM's `/styles` grid. That screen is the **Item Master / Style Master** and
manages item/style records. DB Data Admin manages the shared tables those items and other
applications select from.

### Ownership decision

Both the frontend and its database contracts belong in `u2giants/shared-db` because this is
a cross-application administration product. Do not implement it as a PopCRM-only, PopDAM-only,
or PopPIM-only page. The historical PopCRM location in
[`fix_impl_visual_admin_page.md`](../fix_impl_visual_admin_page.md) is superseded.

### Repository-mirror decision

This repo's `.github/workflows/sync.yml` mirrors the shareable repository root into the
`shared-db/` folder of nine consumer repositories. On 2026-07-21, the workflow was changed
to exclude the top-level `apps/` workspace while continuing to mirror database contracts,
migrations, documentation, and operating rules. It uses `--delete-excluded`, so a previously
mirrored `apps/` directory is removed rather than merely ignored on later runs.

Every sync injects a temporary `apps/.sync-exclusion-probe`, proves no `apps/` directory reaches
the consumer, and compares the mirrored `AGENTS.md` byte-for-byte with the canonical source.
The frontend remains owned here; only its replication into consumer repos is disabled. No
per-machine configuration is required.

---

## 2. Data architecture a new developer must understand

The shared database follows a bronze → silver → gold → serving flow:

- **`ingest.*` (bronze):** raw source payloads and sync runs, such as
  `ingest.raw_record` and `ingest.sync_run`.
- **`plm.*` and other typed mirrors (silver):** re-pullable source-system mirrors, such as
  `plm.erp_customer` and `plm.erp_vendor`.
- **`core.*` (gold):** canonical shared entities used across applications. DB Data Admin
  curates this layer through protected APIs.
- **`api.*` (serving):** views and functions that browser clients may call. The frontend
  must not read `ingest.*`, `plm.*`, legacy `public.erp_*`, or unrestricted `core.*` tables
  directly.

### Source references preserve identity

Canonical rows retain stable links to their source records:

- `core.company_source_ref`: Customers and their ERP/CRM origins.
- `core.factory_source_ref`: Vendors and their Coldlion/other origins.
- `core.taxonomy_source_ref`: Licensors, Properties, Characters, and their PLM origins.

Source references use stable source codes, not names. That is why renaming or merging a
canonical record does not need to break its ERP/PLM identity. DB Data Admin should display
source references, but normal users must not edit them. Raw source status is context only.

`core.taxonomy_source_ref` is polymorphic and cannot enforce a normal database foreign key;
treat it as display/provenance metadata rather than relationship authority.

### Authority rules

- Coldlion owns source vocabulary and raw Customer/Vendor codes.
- DesignFlow owns Licensor → Property relationships and taxonomy active/inactive decisions.
  Coldlion provides neither that hierarchy nor a reliable taxonomy active flag.
- Supabase holds the shared canonical mirror and human-curated application behavior.
- Re-pulls must not overwrite curated display names or statuses.
- Full taxonomy rules are in
  [`docs/merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md).

---

## 3. Grid standard — do not create three strategic grid platforms

The target is **two grid engines long-term**:

- **AG Grid remains in DesignFlow PLM** and in existing screens that already depend on it.
  This project does not justify rewriting working PLM grids.
- **RevoGrid Core (MIT) is the standard for DB Data Admin and new non-DesignFlow,
  data-heavy/editable grids.**
- PopCRM's custom `src/components/app/DataTable.tsx` is a **legacy component**. Keep it
  working, but do not develop it into a third cross-application grid platform. Replace it
  incrementally only when a screen is otherwise being rebuilt and parity tests pass.

All three may temporarily remain in source control during transition, but only AG Grid and
RevoGrid are strategic engines.

### Why RevoGrid here

PopCRM's DataTable already contains strong UX: header search, set filters, autocomplete,
sorting, resizing, reordering, column visibility, inline editing, and drag-to-copy.
PopDAM's `src/components/ui/filterable-table-head.tsx` provides a reusable interaction
reference for persistent filter inputs, suggestions, and sorting.

RevoGrid adds a maintained virtualized spreadsheet engine, stronger range/cell selection,
keyboard behavior, and a base for large, wide, editable data. Reuse the existing UX ideas
and tests; do not transplant plain-table DOM into RevoGrid.

RevoGrid Core supports filtering, filter state, custom filters, and events. Its official
always-visible header-input plugin is a Pro feature. Unless the owner separately approves a
paid license, build our own thin MIT-Core adapter using documented public column templates
and filter state/events. Do not copy Pro source or depend on undocumented internals.

### Required grid behavior

The first release requires:

- always-visible input below each filterable text header;
- controlled select filters for statuses and booleans;
- debounced filtering, clear-one, and clear-all;
- visible active-filter indicators;
- sorting, resizing, reordering, and show/hide columns;
- keyboard navigation and accessible labels;
- per-user saved filters, order, widths, and visibility;
- inline editing with validation and visible saving/saved/error states;
- copy/paste only where the destination field permits it;
- virtualization without losing edits or filter state.

Pin the exact tested RevoGrid 4.x version; do not float across a major release. The custom
header-filter acceptance test must prove that an input keeps focus and cursor position while
debounced filtering causes header/grid re-renders. Editing and filter state must also survive
row and column virtualization.

Per-user grid state is database-backed, not browser-only. Add
`app.db_data_admin_grid_state`, keyed by profile + entity/view, with administrator-safe
read/upsert operations for filters, sort, order, widths, and visibility. Local storage may
cache the last state for startup speed but is not the durable source of truth.

Start with text, boolean, and status filters. Numeric/date operators are still future work.
Default to server-side filtering/pagination above 5,000
rows, while keeping the same API parameters available below that threshold so switching
modes does not require a contract rewrite.

**Set filters are no longer deferred — they shipped on 2026-07-23.** Each column header is
now a Multi Filter (Text + Set), the equivalent of AG Grid's Multi Filter configured as a
Text Filter plus a Set Filter. See
[docs/db-data-admin-column-multi-filter.md](db-data-admin-column-multi-filter.md) for
the component contract, the reusable helper module, and how to lift it into another app.

**Guarded in-table editing shipped on 2026-07-28.** Customer and Vendor grids have an
**Edit table** mode backed by RevoGrid's documented cell and range-edit events. Only global
Status and the CRM, PM/PIM, and DAM application statuses are editable in the grid. Global
Status uses a strict Active/Potential/Inactive dropdown; application statuses use a strict
Active/Inactive dropdown. Name, ERP, PLM, alias count, and timestamps are read-only.
Copy/paste and drag-fill use the same guarded, audited single-record RPCs as the record
editor and preserve optimistic-concurrency checks.

The toolbar keeps up to 10 local undo actions. A multi-row drag-fill is one action. Undo
performs real compensating writes through the same audited RPCs with reason
`Undid table edit`; it does not merely repaint the browser. Refresh and entity-tab changes
clear the local undo history. The circular-arrows control is **Refresh table** and both it
and Undo expose accessible labels plus native hover tooltips. Implementation and operating
detail: [`apps/db-data-admin/README.md` in popdam3](https://github.com/u2giants/popdam3/blob/main/apps/db-data-admin/README.md).

---

## 4. Shared entities and application extension tables

`core.customer` and `core.factory` are the canonical shared records. Per-application
extension tables are 1:1 additions—not replacement Customer/Vendor tables, not tables per
attribute, and not status-only tables.

Example DAM serving shape:

```text
api.dam_customer_list
  = core.customer
    LEFT JOIN dam.customer_ext ON customer_id
```

One `dam.customer_ext` row may contain many DAM-only typed fields. Any field displayed,
filtered, sorted, edited, validated, or reported should be a typed column. JSON is only for
genuinely unstructured remnants. Do not use EAV. Full rules:
[`docs/per-app-extension-tables-plan.md`](per-app-extension-tables-plan.md).

### Field ownership test

A field belongs in `core.*` when it is shared identity/classification, is genuinely used by
two or more applications, or drives shared pickers/joins. A field used by only one
application belongs in that application's extension table.

### Channel decision

**Channel is shared Customer classification**—for example Mass, Specialty, E-commerce, or
Off-Price—so it belongs in the shared Customer contract, not `dam.customer_ext`.

Decision: a Customer may have **multiple Channels**. Implement a controlled Channel lookup
plus a Customer-to-Channel relationship table. Do not implement Channel as arbitrary free
text or as one value that would force a multi-channel Customer into a false choice.

### Dilution

`dilution` remains PLM-owned unless at least two applications genuinely use it as shared
business data. Another application may display an approved authoritative value without
copying ownership into its own extension table.

### PopDAM “Originally Designed For”

PopDAM `/styles` “Originally Designed For” represents a Customer. Store the UUID of
`core.customer`, never a copied name. Populate the picker from the DAM Customer serving
contract (`api.dam_customer_list`), display `coalesce(display_name, name)`, and save the
Customer UUID on the style/item record. Renaming a Customer must not break this link.

Verified current reference implementation: migration
`20260721143000_dam_master_data_customer_id.sql` creates `dam.customer_ext`,
`api.dam_customer_list`, `public.style_tracker_rows.customer_id`, safe exact-match backfill,
and Customer-ID audit coverage. `api.dam_customer_list` already enforces the effective
visibility rule in §5. Use this implementation as the pattern for other application serving
contracts; do not recreate it.

---

## 5. Global and per-application inactivation

There are two independent controls:

- **Global inactive:** `core.customer.status` / `core.factory.status`; hides the record in
  every application. Administrator-editable global values are `active`, `potential`, and
  `inactive`. Existing `archived` and `deleted` values are visible but remain system/legacy
  states, not ordinary DB Data Admin choices.
- **Application inactive:** stored in the relevant application extension row; hides the
  record only in that application.

No extension row means enabled for that application. Effective visibility is:

```text
core status is active or potential
AND
application status is active (a missing extension row defaults to active)
```

The exact per-application picker visibility that results from one inactivation decision is
the contract every consumer must implement in Step 11:

| Record state | CRM picker | PM/PIM picker | DAM picker | DesignFlow PLM |
|---|---|---|---|---|
| Global `active` (or `potential`), no app override | visible | visible | visible | visible |
| **Global `inactive`** | hidden | hidden | hidden | hidden |
| Global `active`, **CRM** extension inactive | **hidden in CRM only** | visible | visible | visible |
| Global `active`, **PM** extension inactive | visible | **hidden in PM only** | visible | visible |
| Global `active`, **DAM** extension inactive | visible | visible | **hidden in DAM only** | visible |
| Global `active`, **PLM-inactive in DesignFlow** | visible | visible | visible | **hidden in PLM only** |
| Already assigned by UUID (historical) | label still resolves | label still resolves | label still resolves | resolves |
| Merged-loser UUID/code | resolves via alias / source-ref | resolves | resolves | resolves |

The PLM column is not a Supabase extension-table override. DesignFlow owns
`customers_status` / `factory_status`; production DesignFlow runs on Cloud SQL, while the
shared Supabase `dflow` schema is the non-production copy. DB Data Admin must change PLM
status through DesignFlow's protected API and mirror the result back read-only. It must never
create a second editable PLM status in Supabase.

Two consequences follow directly and are non-negotiable for Step 11. First, a record already
stored by UUID on a parent row (for example `public.style_tracker_rows.customer_id`,
`pim.product.company_id`, an opportunity `factory_id`) must keep rendering its label after it
is inactivated — inactivation must never 404 an assigned reference. Second, a merged loser's
old UUID or source code must keep resolving through `core.customer_alias` /
`core.factory_alias` and the matching `*_source_ref`, so any application still holding the
old identifier continues to work.

Store the reason, actor, and timestamp for curated inactivation and reactivation. Coldlion
source status is read-only context and must never overwrite global or application-curated
status during a later pull.

Per-app status is deliberately binary (`active` or `inactive`). It and `status_reason`,
`status_changed_at`, and `status_changed_by` live as typed columns in that application's
extension row. Every committed change also writes the central audit event described in §7.
Reactivation defaults to active and clears the current `status_reason`; when changing the
global status, an administrator may instead choose `potential`. The immutable audit history
retains the former reason and actor.

DB Data Admin must not release status editing until all affected application pickers enforce
the same effective-visibility rule. Inactive records are hidden by default in DB Data Admin,
with an explicit control to show them.

---

## 6. Database inventory to verify before implementation

The following objects were identified in the historical implementation research. They are
leads, not permission to assume current existence or browser safety. Verify every object
against current migrations and preview before designing the final API. In particular, do
not assume the historical `api.customer_list` still exists.

### Serving contracts the Step 11 pickers depend on

Step 11 repoints every CRM/PM/DAM picker onto five status-aware serving views that already
exist in **canonical** shared-db, authored and preview-verified in Step 6
(`20260722005100_app_serving_status_contracts.sql`):

- `api.crm_customer_picker_list` and `api.crm_factory_picker_list`
- `api.pm_customer_list` and `api.pm_factory_list`
- `api.dam_factory_list`

`api.dam_customer_list` (the DAM Customer picker source, `20260721143000`) is the precedent
all five follow: `security_invoker`, core table LEFT JOIN to only that app's extension row,
and the effective-visibility WHERE clause from §5. Each view joins the extension tables from
`20260722003000`–`20260722003400`.

Claude directly verified on 2026-07-23 that all five Step 6 serving views and
`api.dam_customer_list` are present on both preview (`rjyboqwcdzcocqgmsyel`) and production
(`qsllyeztdwjgirsysgai`). The five views are `security_invoker`, LEFT JOIN only the relevant
app extension, enforce `core.status in ('active','potential')` plus
`coalesce(ext.status,'active')='active'`, and grant `select` to `authenticated`.

Never trust a consumer repo's mirrored `shared-db/` folder for current object existence: the
inspected `popdam3` mirror had zero `2026072*` migrations, which caused a false "view does not
exist" conclusion. Canonical shared-db is the source of truth for authored objects; live
queries prove deployment state. Consumer mirrors refresh from the canonical repository on
pushes to shared-db `main`, independently of database migration promotion.

### Customers

Historical/current candidates include:

- reads: `api.crm_customer_list`, `api.crm_customer_overview`,
  `api.crm_customer_segment_list(...)`, `api.crm_customer_segment_counts()`;
- update precedent: `api.crm_update_customer(...)`;
- logo precedent: `api.crm_set_customer_logo(...)`;
- merge engine:
  `core.merge_customer(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean default true)`;
- match helper: `core.match_customer(...)`;
- aliases: `core.customer_alias`;
- source references: `core.company_source_ref`.

The DB Data Admin frontend must not call CRM-specific or sensitive Core functions merely
because they exist. Build administrator-only wrappers with the authorization, preview,
audit, and concurrency behavior defined below.

### Vendors

Historical/current candidates include:

- canonical table: `core.factory`;
- merge engine:
  `core.merge_factory(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean default true)`;
- aliases: `core.factory_alias`;
- source references: `core.factory_source_ref`;
- optional canonical Customer relationship:
  `core.factory.company_id → core.customer(id) ON DELETE SET NULL`.

Both merge engines take the loser first. Always call them with named arguments
(`p_loser => ...`, `p_survivor => ...`); never rely on positional ordering for a destructive
operation.

The historical review found no dedicated safe `api.*` Vendor view at that time. Verify the
current state. If still absent, create a DB Data Admin read function/view and protected
update/merge wrappers here before building the frontend.

### Licensors and Properties

- canonical tables: `core.licensor`, `core.property`;
- strict relationship: `core.property.licensor_id → core.licensor(id)`;
- child entity: `core.character`;
- provenance: `core.taxonomy_source_ref`;
- feeder: `plm.import_master_data()` through `tools/sync-plm-master-data.mjs`.

The historical review found no dedicated safe Licensor/Property serving contract. Verify
the current state and create the administrator-only contract in shared-db if still absent.
The screen reads the canonical mirror; it does not call or silently repair the upstream
sync.

---

## 7. Safe DB Data Admin API

Normal applications must keep reading Core plus only their own extension table. DB Data
Admin is the explicit administrator-only exception because its authorized users must
compare global and per-app state.

Prefer narrowly scoped operations such as:

```text
api.db_data_admin_customer_list(...)
api.db_data_admin_vendor_list(...)
api.db_data_admin_licensor_property_list(...)
api.db_data_admin_update_customer(...)
api.db_data_admin_update_vendor(...)
api.db_data_admin_preview_customer_merge(...)
api.db_data_admin_merge_customer(...)
api.db_data_admin_preview_vendor_merge(...)
api.db_data_admin_merge_vendor(...)
api.db_data_admin_audit_list(...)
api.db_data_admin_grid_state_get(...)
api.db_data_admin_grid_state_upsert(...)
```

### Authorization mechanism

Reuse the live authorization system; do not invent a second admin model. Access requires
both `app.has_role('administrator')` and a new explicit-grant helper,
`app.has_explicit_app_access('admin')`. Do not use `app.has_app_access('admin')` for this
boundary: that existing helper deliberately returns true for every administrator, so combining
it with the role check would not restrict the application to specifically approved people.
`app.has_explicit_app_access(...)` checks a non-revoked `app.app_access` row directly and has
no administrator short-circuit. The `app.app_name` enum already contains `admin`. Grant DB
Data Admin app access through the existing
`app.app_access` mechanism to specifically approved administrator profiles—never through
hard-coded email addresses. `api.crm_admin_user_list()` is the security-definer precedent
for pinned search path, internal role check, revocation from `public`, and an authenticated
grant.

All `api.db_data_admin_*` functions are owned by a controlled database-owner role with only
the cross-schema rights required to read/write the approved `core`, `crm`, `dam`, `pim`,
`plm`, and `app` objects. Browser callers receive no direct cross-schema privilege.
Because `app` is PostgREST-exposed, both DB Data Admin storage tables require RLS and zero
direct `authenticated` table grants; browser access is only through the protected functions.

### Audit storage

Create `app.db_data_admin_audit_event` as the immutable audit store. Each event records an
operation UUID/idempotency key, entity type/id, action, old/new JSON snapshots limited to
approved business fields, reason, actor profile/user, timestamp, merge survivor/loser when
applicable, success/failure, and error detail. Only the protected operations write it; only
authorized DB Data Admin users read it through `api.db_data_admin_audit_list(...)`.
Retain audit events indefinitely unless a later written retention policy is approved.
Denied calls raise `insufficient_privilege` and are evidenced in Supabase/Postgres security
logs; an audit insert in the same transaction would roll back with the denial. Expected
authorized business failures (validation, stale concurrency token, or stale merge preview)
return a structured `success=false` result so the failure audit row can commit. Unexpected
exceptions raise, roll back the whole operation, and are evidenced in platform logs.

Names are finalized during schema design. List functions must accept filter, sort,
cursor/page-size, and inactive-inclusion parameters from their first version, even while
current row counts permit client-side loading. Every operation must:

- authenticate the caller and check administrator role inside the operation;
- revoke execution from `public` and grant only the required authenticated role;
- if `SECURITY DEFINER`, pin a safe `search_path` and fully qualify objects;
- return only explicitly approved fields, never unrestricted raw payloads;
- whitelist writable fields instead of accepting arbitrary table/column names;
- use `updated_at` or a version token to reject conflicting edits;
- audit old value, new value, actor, timestamp, reason, and operation ID;
- make destructive/bulk actions previewable, countable, and confirmable;
- report partial failures loudly;
- preserve source references, aliases, and dependent relationships.

### Merge execution semantics

Merge execution runs in one transaction and takes transaction-scoped advisory locks for
the ordered survivor/loser IDs. The client-generated operation UUID is a unique idempotency
key: retrying the same confirmed request must return the original result, not merge twice.

Before calling the existing `core.merge_customer` or `core.merge_factory` engine, the
wrapper reconciles per-app extension rows. If only the loser has an extension row, move it
to the survivor. If both exist, non-null survivor values win, loser values may fill blanks,
and every conflicting non-null field must be resolved explicitly in the preview and
confirmation payload. No conflict is silently discarded. The audit event stores the
approved resolutions and before/after snapshots. Automatic merge undo is not promised;
safety comes from preview, locking, idempotency, transactionality, and complete evidence.

RLS is not a table grant. Any direct table access still needs explicit privileges, but the
preferred design is protected functions rather than broad browser DML grants.

All DDL starts as a new timestamped migration in this repo. Apply to preview first. Never
edit an applied migration or create schema from an application repo.

---

## 8. Screen requirements

### 8.1 Customers

The grid shows:

- canonical display name and full name;
- global status;
- Channel;
- CRM, PM, DAM, and PLM status;
- source-system badge/code and raw source status (read-only);
- alias count;
- last update/sync context where available.

Supported actions:

- edit the curated display name;
- change global status with a warning that it affects every application;
- change one application's status without affecting the others;
- view aliases and all source references in a detail panel;
- reactivate;
- merge duplicates through the protected workflow below.

### 8.2 Vendors

Use the same pattern as Customers while displaying **Vendor**, never Factory. Include the
optional related Customer when present. Support curated display name, global/per-app status,
aliases, source references, reactivation, and protected duplicate merge.

The completed inventory found a real DAM Vendor picker. Step 4 therefore created
`crm.factory_ext`, `pim.factory_ext`, and `dam.factory_ext`; do not add duplicate extension
objects for visual symmetry. PLM status remains in the required product scope, but its
authority stays in production DesignFlow Cloud SQL and is delivered through the protected
cross-system API/sync path described in §10. Do not create an editable Supabase PLM value.

### 8.3 Duplicate merge workflow

Customer and Vendor merge is powerful and potentially destructive. The UI must:

1. Select a survivor and a duplicate/loser.
2. Call a read-only preview operation.
3. Display exactly what will move or change: aliases, source references, dependent links,
   display/status conflicts, and affected row counts.
4. Require an explicit reason and confirmation.
5. Call the administrator-only merge wrapper, not `core.merge_*` directly.
6. Show the operation/audit ID and final survivor.
7. Verify that the loser's old codes/names resolve through aliases/source references as
   designed.

Normal inactivation is not deletion. Hard deletion is not a standard UI action.

### 8.4 Licensors → Properties

This is the centerpiece of the taxonomy screen. Provide a master/detail or expandable tree:

```text
▸ Marvel — 34 properties
    • Avengers
    • Spider-Man
    • X-Men
▸ Disney — 21 properties
    • Frozen
```

Each Licensor shows name, status, Property count, divisions/source codes, and source
context. Each Property shows name, Licensor breadcrumb, status, division/type-qualified
source identity, source context, and optionally Character count.

The relationship is **read-only in v1** because DesignFlow owns Licensor → Property edges.
Do not infer hierarchy from Coldlion or edit the edge unless the owner separately approves a
new authority model. `core.property.licensor_id` is nullable and its FK uses
`ON DELETE SET NULL`, so orphan rows are structurally possible. The expected orphan count is
zero; surface any orphan loudly rather than silently hiding it.

V1 is fully read-only for Licensors and Properties: no relationship, status, display-name,
or source-reference edits.

#### The flat Properties tab

The tree answers "what does this Licensor own?". A separate **Properties** tab answers the
opposite question — "show me every Property, filterable and sortable as one table" — with
columns for Property, code, Licensor, Licensor code, status, Character count, PLM divisions,
and source. It is the same RevoGrid, set-filter and text-filter surface used by Customers and
Vendors, minus inline editing.

Both tabs read the **same** contract, `api.db_data_admin_licensor_property_tree`. There is
deliberately no separate `db_data_admin_property_list` RPC: a second read path over the same
rows would be free to drift from the tree's own reconciliation counts. The flat rows are built
from the tree payload in `apps/db-data-admin/src/lib/property-rows.ts`.

Orphans appear in the table as ordinary rows parented to `(no licensor)`, plus a banner naming
the exact count — never filtered out, for the same reason the tree surfaces them loudly.

#### Reading the PLM divisions column

`POP Lic (CW001) · GS, Spruce Lic (SP001) · GS` means the record is set up in **both** licensed
divisions, under merch-group code `GS` in each. One entry per `plm.property_import` /
`plm.licensor_import` row.

The tree contract originally identified a division only by its raw `plm."divisionCode"."divCode_id"`
value, so this rendered as the unreadable `1 · property · GS, 8 · property · GS`. Migration
`20260728171500` adds `division_name` and `division_external_code` to every `plm_context` entry.
Both this table and the tree's source-context chips render the name; a division id with no
lookup row falls back to the raw id rather than disappearing.

`mg_type` stays in the contract but is never displayed: it is a fixed literal per branch
('property' on every property, 'licensor' on every licensor), so it added the same dead word to
every row.

Divisions `1` and `7` share the name `POP Lic`, which is why the external company-division code
is shown alongside the name rather than instead of it.

The table has no "Updated" column. The tree contract carries `updated_at` on Licensors and on
orphan Properties, but not on Properties nested under a Licensor, and a column that is blank
for nearly every row reads as missing data. Adding it means adding `updated_at` to the nested
Property object in that RPC first.

---

## 9. Mandatory cross-application cutover-safety audit

We are not allowed to assume that switching screens and pickers to canonical APIs cannot
break an application. Before production release, inspect **PopCRM, PopPIM/PM, PopDAM, and
all relevant DesignFlow consumers**.

Use repository-wide searches adapted to each codebase to find:

1. Reads of legacy `erp_items_current`, `erp_customer`, `erp_vendor`, or `prod_order_*`
   objects instead of sanctioned canonical/serving contracts.
2. Customer/Vendor matching or persistence by mutable name string instead of canonical UUID
   or stable source code.
3. Direct browser reads/writes of unrestricted `core.*`, `plm.*`, `ingest.*`, or legacy
   `public.erp_*` objects.
4. Pickers that filter only Core status or ignore per-application status.
5. Callers of CRM-specific views/functions that should move to a DB Data Admin or
   app-specific contract.
6. Any use of merged loser IDs/codes that no longer resolves through the intended alias or
   source-reference path.

Record findings and the exact fix/verification for every hit. Fix unsafe references before
relying on the new behavior in production. This audit is a release gate, not an optional
cleanup task.

### Dated inventory evidence and repeatable searches

Historical acceptance evidence from the superseded implementation research remains useful
when labeled as a snapshot rather than a timeless row-count promise. As of 2026-07-17, the
Customer baseline was 859 rows: 140 active, 12 potential, and 707 inactive. The same research
counted 20 Licensors and 256 Properties. Re-run and date these counts during implementation;
the timeless gates are that every Property appears under exactly one Licensor, unexpected
orphans are zero, and every count names the database/source and observation date.

At minimum, adapt and run these searches in each consumer source tree, then record every hit:

```bash
rg -n "erp_items_current|erp_customer|erp_vendor|prod_order_" src
rg -n "customer.*name|vendor.*name|factory.*name" src
```

The second search is deliberately broad: classify each hit as display-only, a stable-code or
UUID lookup, or unsafe mutable-name identity. `core.factory_source_ref` has no `source_name`
column; Vendor source badges must use its actual source-system/code fields. Useful immutable
migration anchors for the inventory include `20260621150815`, `20260716143231`,
`20260717123020`, `20260717125909`, and `20260717192922`; verify current replacement bodies
where later migrations use `create or replace`.

### Step 11 repository and live-confirmation findings (2026-07-23)

The code findings below came from read-only inspection of the consumer repositories and were
then checked against current canonical migrations. Claude also performed read-only,
rolled-back queries against preview and production on 2026-07-23. Those queries confirmed:

- production migration head `20260722221700`; preview head `20260723113100`;
- the foundation/read set (`20260722002500` through `20260722005200`, plus
  `20260722163000`) and all six app-serving views are live on both environments;
- production has no `app.db_data_admin_feature_gate`, no DB Data Admin write/merge/tree
  RPCs, and no non-revoked production `admin` grantee;
- preview has the feature gate with `single_record_write=true` and `merge_execute=true`;
- `crm.promote_ingested_domain` and historical `api.customer_list` are absent on both;
- production has 859 Customers, 93 Vendors (91 active / 2 inactive), 20 Licensors,
  256 Properties, zero Property orphans, 54 DesignFlow Customer source refs covering
  50 Customers, 104 Coldlion Factory source refs, and zero DesignFlow Factory refs.

These are dated facts, not permanent assumptions. Re-query before a production change.

**PopCRM (`u2giants/popcrm-web`).** Global picker filtering already exists — all Customer
pickers route through `src/features/crm/pages/_shared.ts`, where `isSelectableCustomer`
(`_shared.ts:26-28`) and `PICKER_ENTITY_STATUSES = {'active','potential'}` (`:24`) filter the
**global hub `status`** client-side, and `withCurrentCustomer` (`:51-59`) deliberately
re-adds the assigned (possibly inactive) row so a historical value still renders. The
feeders pull `crm_customer_segment_list('all')` via `useCustomerSegmentQuery('all', -1)`
(`src/features/crm/queries.ts:140-148`). Five gaps remain for Step 11:

1. **CRM-specific status is not consistently enforced.** The pickers filter the global hub
   `status`, but the `CustomersPage.tsx:45-48,121-130` tabs and the overview/stats reads
   (`api.ts:150-154,426-429`) filter the **legacy CRM `customer_status`**
   (`ACTIVE_CUSTOMER`/`POTENTIAL_CUSTOMER`/`OTHER`/`UNASSIGNED`), a different axis. Treat
   the canonical hub `status` (`core.customer.status`) as authoritative and distinguish it
   from legacy `customer_status`; a globally inactive row that still carries a legacy
   `ACTIVE_CUSTOMER` value will appear in those tabs/stats. Moving pickers to
   `api.crm_customer_picker_list` fixes the picker axis server-side; aligning the tab/stats
   axis to hub status is a separate cleanup.
2. **The global CRM search lacks the effective-status filter.** `searchCrm`
   (`api.ts:837-841`) does an `.or(ilike name|display_name|domain|routing_aliases)` with no
   status gate, so the global CommandSearch (`CommandSearch.tsx:46-48`) returns inactive and
   post-merge rows. Add the global+app status gate (or route through a status-aware search).
3. **Already-assigned inactive UUIDs must remain historically resolvable.** Preserve the
   `withCurrentCustomer` behavior when repointing the feeder so a stored inactive Customer
   still shows its label instead of disappearing.
4. **Cached option lists must not resurrect inactive rows.** The
   `useCustomerSegmentQuery('all', -1)` feed (and per-page `retailerById` memos) is cached
   (`staleTime 2min`). Once the picker reads `api.crm_customer_picker_list` server-side the
   view itself excludes inactive rows, but invalidate or re-query the view on status change
   so a stale cache cannot surface a just-hidden row.
5. **The ingested-domain promotion path calls a function that no longer exists.**
   `src/features/crm/api.ts:464-471` still calls `crm.promote_ingested_domain`, but
   `20260629034600_remove_ingested_domain_customer_association.sql` deliberately dropped it
   and live read-only checks confirmed it is absent on preview and production. Decide whether
   the feature should be rebuilt under the current no-ingested-domain-to-Customer architecture
   or removed from the UI. Do not add a status test around a dead RPC, and do not restore the
   forbidden `crm.ingested_domain` → `core.customer` association.

CRM has **no Vendor picker today**; `factory` appears only as display via
`crm_opportunity_list` (`api.ts:246`) and `factory_id` is written on opportunity update
(`api.ts:390-391`). `api.crm_factory_picker_list` is therefore for a future picker, not a
migration of an existing one. There are **no** direct `core.*`/`plm.*`/`erp_*` browser reads
and **no** name-based Customer/Vendor identity in CRM (identity is UUID-based throughout).

**PM/PIM (`u2giants/poppim-web`).** Three callers still use the removed `api.customer_list`
and must be replaced with `api.pm_customer_list` (the view enforces global+PM status
server-side, so this is a relation swap, not new filtering code):

| File | Caller | Note |
|---|---|---|
| `src/domain/reference/api.ts:10` | `fetchRetailers()` | No importers — dead code, but still compiles against the dropped relation. Delete or migrate. |
| `src/features/accounts/api.ts:18` | `fetchAccountRows()` | Accounts page. |
| `src/features/board/collab.ts:314` | `fetchCustomers()` → `TaskDetailModal` Retailer picker (`src/components/TaskDetailModal.tsx:162,487-498`) | The AGENTS.md "canonical fetch." |

The Task Detail path **swallows errors** — the call is followed by `.catch(() => {})`
(`TaskDetailModal.tsx:162`), so a failed/empty fetch leaves the picker silently empty rather
than surfacing an error. All three callers `select customer_status`/`is_potential` but apply
**no** status filter, so the picker maps every returned row into options.

Live schema confirmation established that `api.customer_list` is absent on production and
preview while `api.pm_customer_list` is present on both. The three callers therefore target
a relation that cannot resolve. The deployed user-visible symptom still needs browser
verification, but the schema/code mismatch is confirmed. Identity is sound — Customer picks
persist the UUID `company_id` (`collab.ts:282`), and there is no name-based Customer/Vendor
identity. PM/PIM has **no Vendor picker**; `api.pm_factory_list` is for a future picker.

**PopDAM (`u2giants/popdam3`).** Customer selection is already correct and is the model to
copy for Vendor: `useDamCustomers()` reads `api.dam_customer_list` (server-filtered
active+potential, `src/hooks/useDamCustomers.ts:22-38`), the `/styles` "Originally Designed
For" and "Special Customer" pickers write the canonical UUID, and `buildUpdate`
(`src/pages/.../StylesPage.tsx:392-396`) sets `payload.customer_id` through
`customerNameToId`. Vendor selection is the gap:

- "Sample Vendor" (`StylesPage.tsx:229,263`) and "Default Vendor(Sales)" (`:237,269`) source
  from `fetchFactoryOptions()`, which reads **`core.factory` directly**
  (`StylesPage.tsx:647-657`, `.eq('status','active')`, `.limit(1000)`, cached under
  `["style-tracker-factory-options"]` `:1040`) — a global-only filter, no per-app (DAM)
  status, and an unrestricted `core.` read.
- Vendor picks **persist a free-text name, not a UUID**: `buildUpdate` (`:383-397`) has a
  `customer` branch writing `customer_id` but no `factory` branch, so a renamed or inactive
  factory breaks the reference with no FK to repair.

Required: replace the `fetchFactoryOptions()` direct read with `api.dam_factory_list`, and
define **stable `factory_id` persistence** as the durable target (mirror the Customer
branch — write a UUID, not a name). That durable target likely needs a
`public.style_tracker_rows.factory_id` column, which does **not** exist today (only
`customer_id` was added, in `20260721143000`; `factory_id` lives on the bridge
`plm.style_tracker_item_bridge`). If so, author it as a **new additive shared-db migration,
preview first** — never an app-repo migration. The vendor-picker visibility fix (hide
inactive via the view) does not require that column and can land independently; the
`factory_id` write path is optional hardening so renamed/inactive factories keep a
repairable FK instead of a stale free-text label.

Coordinate this work with the existing unmerged `popdam3` branch
`dam-customer-hub-picker`, which touches the same Customer/Vendor picker area. Land or
reconcile that branch before beginning Step 11 DAM changes. Do not start from an overlapping
stale base.

**DesignFlow (the six `popcre/designflow-*` repos).** DesignFlow pickers already enforce
`ACTIVE`/`Active` and store stable ids, so Step 11 here is **integration plumbing, not a
picker rewrite**: Customer reads use `where customers_status='ACTIVE'`
(`designflow-backend/models/lib.model.js:239`, `services/customer.service.js:18`); Vendor
reads use `factory_status:'Active'` (`lib.model.js:832-858`); server-side guards reject
saves on inactive entities (`helpers/rfqCustomerGuard.js:34`,
`designflow-item-master/helpers/itemReferenceGuard.js:53`,
`designflow-tracking/models/sample.model.js:319,328`); and the Angular pickers store
`{id: customers_id}` / `{id: Factory.id}` (stable id, no name persistence). No DesignFlow
picker change is required for enforcement; leave the active-only endpoints and `{id}`
persistence as-is.

DesignFlow must remain the **single writer** of PLM application status, and Supabase
`core.*` stays downstream. The reusable assets already exist — do not reinvent them:

- **Protected API-key bridge:** `designflow-bff/src/apiKeyAuth.js` validates `x-api-key`
  against `DESIGNFLOW_API_KEYS` (Secret Manager; SHA-256 + `timingSafeEqual`), mints an
  RS256 JWT (`auth_type:'api_key'`, `api_key_name`, role claims), and is mounted on
  `/api/*` (`routes/api.js:51`). A DB Data Admin PLM operation is a new/tightened
  `authRole(['admin'])` endpoint reached via a new `admin`-claim API-key entry — no new auth
  mechanism. (`tools/sync-plm-master-data.mjs` already uses this bridge.)
- **Customer mirror-back already exists:** `tools/sync-plm-master-data.mjs` pulls
  `getCustomers` and runs `plm.import_master_data()`, mapping
  `customers_status='ACTIVE'` → `core.customer.status='active'` and writing
  `designflow_plm/customers` source refs. Live confirmation found 54 refs covering 50
  Customers. **This current importer is not safe for DB Data Admin status authority:**
  `20260625153020_plm_fuzzy_customer_match.sql` overwrites existing
  `core.customer.status` on every matched re-pull. Before reviving or extending the
  currently-failing sync, change the mirror to preserve curated global status and expose PLM
  status as read-only application context. The Coldlion Customer importer does not have this
  bug; `20260716140000_erp_coldlion_status_app_owned.sql` already made its matched-row path
  status-preserving.
- **Vendor PLM is blocked** on three concrete prerequisites: a canonical Factory export
  endpoint suitable for master-data sync (no `getFactoriesForMasterData` endpoint exists;
  current factory endpoints are UI/search surfaces), a stable source identifier (the integer
  `Factory.id` is stable; there is no `factory_code`, `models/db/Factory.js:4-10`), and a
  reviewed one-time match that populates `core.factory_source_ref` with
  `designflow_plm/Factory/<id>` rows. Live confirmation found 93 Vendors, 104 Coldlion
  Factory refs, and zero DesignFlow Factory refs. Names may propose matches but must never be
  the runtime key. Vendor PLM status is explicitly **deferred** behind this prerequisite —
  documented, not silently dropped.
- **The environment split is resolved.** `popcre/infrastructure` confirms production
  DesignFlow uses Cloud SQL / `5432`; non-production uses the Supabase pooler and `dflow`
  schema. Production mirror-back is therefore cross-system through the protected API and
  master-data sync, never an intra-Supabase SQL hop. DesignFlow stays sole writer of
  `customers_status` / `factory_status`; DB Data Admin must never create a competing editable
  Supabase PLM status. The existing broad Customer PATCH role gate and inline status toggle
  remain authorized DesignFlow writers and must be tightened or explicitly documented as
  part of the single-writer contract.

**Serving-contract presence (all apps).** The CRM/PM/DAM serving contracts the pickers need
are live-verified on production and preview. Consumer mirrors can still be stale; canonical
shared-db defines the objects and direct read-only queries confirm deployment state.

---
