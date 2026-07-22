# DB Data Admin — authoritative product and implementation specification

Status: **approved direction; implementation not started**  
Decision date: **2026-07-21**  
Owner and code repository: **`u2giants/shared-db`**

Planned frontend location: **`apps/db-data-admin/`**

Production URL: **`https://data.designflow.app`**

This is the cold-start specification for a developer with no prior context. It incorporates
the useful database inventory, curation workflows, safety checks, traps, and acceptance
criteria from [`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md), while replacing
that document's obsolete proposal to build the page inside PopCRM.

---

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
[`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md) is superseded.

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
  [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md).

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

Start with text, boolean, and status filters. Add numeric/date operators and set filters
after the Core adapter is proven. Default to server-side filtering/pagination above 5,000
rows, while keeping the same API parameters available below that threshold so switching
modes does not require a contract rewrite.

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
[`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md).

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

### Customers

Historical/current candidates include:

- reads: `api.crm_customer_list`, `api.crm_customer_overview`,
  `api.crm_customer_segment_list(...)`, `api.crm_customer_segment_counts()`;
- update precedent: `api.crm_update_customer(...)`;
- logo precedent: `api.crm_set_customer_logo(...)`;
- merge engine: `core.merge_customer(p_survivor, p_loser)`;
- match helper: `core.match_customer(...)`;
- aliases: `core.customer_alias`;
- source references: `core.company_source_ref`.

The DB Data Admin frontend must not call CRM-specific or sensitive Core functions merely
because they exist. Build administrator-only wrappers with the authorization, preview,
audit, and concurrency behavior defined below.

### Vendors

Historical/current candidates include:

- canonical table: `core.factory`;
- merge engine: `core.merge_factory(p_survivor, p_loser)`;
- aliases: `core.factory_alias`;
- source references: `core.factory_source_ref`;
- optional canonical Customer relationship:
  `core.factory.company_id → core.customer(id) ON DELETE SET NULL`.

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

The inventory must determine which applications have a real Vendor picker before creating
extension tables merely for visual symmetry. CRM and PM/PIM are known Vendor consumers, so
v1 requires `crm.factory_ext` and `pim.factory_ext`. Add `dam.factory_ext` only if the audit
finds a DAM Vendor picker rather than a read-only display. PLM status remains in the required
product scope, but its authority and production Cloud SQL delivery path must be resolved by
the inventory gate described in §10; do not create an editable Supabase value that production
DesignFlow cannot consume.

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

---

## 10. Delivery sequence

0. **Specification errata and review gate.** Correct this document in place before coding;
   do not create a second authoritative ledger. Preserve the full PLM-status promise unless
   the owner explicitly approves a later scope change. Keep
   `fix_impl_visual_admin_page.md` byte-for-byte untouched. Pass when the docs-only PR is
   reviewed, SQL checks pass, and the AI merges it under this repo's normal protocol.
1. **Inventory and ownership catalogue.** List all displayed/editable fields, source systems,
   current API objects, consumers, permissions, authority, and every FK to
   `core.customer`/`core.factory`. Verify or reject every old object name in §6 and inventory
   each real Customer/Vendor picker. Trace production DesignFlow Customer/Vendor status from
   UI through Cloud SQL and choose one single-writer PLM design: either Supabase-owned curated
   state delivered through a transactional outbox/idempotent DesignFlow consumer, or
   PLM-owned state changed through a protected DesignFlow API and mirrored read-only back to
   Supabase. Never dual-write. If neither is safe, stop and ask the owner rather than silently
   removing PLM from scope. Also identify the Cloudflare zone owner, named non-production
   host, Supabase Auth allowlist executor, and stale taxonomy-branch disposition. Pass when
   every field and delivery path has one owner and the PLM mechanism is documented.
2. **Mirror prerequisite completed; record the stack.** The centralized
   `.github/workflows/sync.yml` excludes top-level `apps/`, removes previously mirrored copies,
   and verifies the boundary on every consumer sync. Record the frontend framework, build
   tool, unit runner, Playwright/browser setup, and exact RevoGrid version. Recommended
   baseline is React + TypeScript + Vite. Pass when the sync test proves `apps/` is absent
   from consumers while canonical shared-db content still mirrors.
3. **Application scaffold and development infrastructure — completed 2026-07-21.**
   `apps/db-data-admin/` now contains the authenticated shell, local setup, unit/browser
   harnesses, container build, build-SHA exposure, and CI. GitHub Actions publishes an
   immutable GHCR image and deploys development through Coolify at
   `https://data-dev.designflow.app`; health and the deployed SHA were verified. The
   Supabase/Entra development routing is configured. Production remains gated. The original
   requirement was to create an
   authenticated shell, local setup, unit/browser and database test harnesses, container
   build, build-SHA exposure, and CI. GitHub Actions builds/publishes to GHCR; Coolify owns
   runtime deployment; host changes route through `u2giants/ansible`; Cloudflare routing is
   remote and current Coolify tunnels must be inspected rather than assumed. Reuse the live
   Microsoft/Entra registration and add exact development plus
   `https://data.designflow.app` origins to both preview and production Supabase Auth
   allowlists. Pass when the read-only shell runs locally and in the named non-production
   environment and every production-delivery owner is tracked.
4. **Foundation and extension schema — completed on preview 2026-07-22; production gated.**
   The migrations and contract tests described below were merged and applied successfully
   to preview only; see
   [`docs/verification/db-data-admin-foundation-20260722.md`](docs/verification/db-data-admin-foundation-20260722.md).
   Keep the verified DAM extension intact.
   First add `app.has_explicit_app_access`, `app.db_data_admin_audit_event`, and
   `app.db_data_admin_grid_state` with RLS and no direct authenticated table grants. Then add
   typed `crm.customer_ext`, `pim.customer_ext`, `crm.factory_ext`, and `pim.factory_ext`,
   plus controlled Channel and Customer-to-Channel tables. Add DAM Vendor or PLM extension
   objects only as established by Step 1; the PLM write path must match the chosen authority.
   Before each migration, repeat the §6 in-flight check. Pass when every additive object is
   applied and tested on preview, grants/RLS pass, and no consumer behavior changes.
5. **Merge-engine repair and FK coverage.** Before exposing merge previews, extend
   `core.merge_customer` and `core.merge_factory` for every new or previously missed dependent
   relationship, including `public.style_tracker_rows.customer_id` and extension rows. Add a
   `pg_constraint` coverage test that fails for every unhandled FK. Call the loser/survivor
   parameters by name. Pass when preview fixture merges preserve all intended links and old
   identifiers continue resolving.
6. **Per-app serving and administrator read contracts.** Add an additive status-aware CRM
   contract, PM Customer/Vendor contracts, the PLM contract chosen in Step 1, and protected
   `api.db_data_admin_*` Customer, Vendor, Licensor/Property, audit, and grid-state reads.
   Pass when the full authorization matrix includes denial of an administrator without an
   explicit `admin` grant and filter/sort/cursor/page-size parameters are proven.
7. **Read-only RevoGrid prototype.** Build Customers and Vendors first with persistent header
   filtering, detail panels, aliases, and source references. Pass visual, keyboard,
   accessibility, focus-retention-under-debounce, virtualization-state, saved-view, and both
   client/server large-data mode tests.
8. **Single-record edits and audit.** Add whitelisted updates, status reason/actor/time,
   concurrency protection, structured expected-failure results, and audit display. Pass when
   edit, conflict, reactivation, and failure paths work on preview. Status writes remain
   database-gated off in production until consumer enforcement passes.
9. **Merge preview and execution.** Add protected Customer and Vendor merge wrappers and the
   UI in §8.3. Pass when transferred references, idempotent retry, extension conflict
   resolutions, and old-identifier resolution are verified.
10. **Licensor/Property tree.** Add the fully read-only v1 hierarchy with source context,
    counts, and loud orphan handling. Pass when every canonical Property appears under exactly
    one Licensor and internal invariants reconcile against a dated snapshot. Do not claim live
    source reconciliation while the upstream DesignFlow feeder is unavailable.
11. **Consumer enforcement and safety audit.** Complete §9 and update every picker for global
    plus app-specific status. Non-DesignFlow repos (`u2giants/popcrm-web`,
    `u2giants/poppim-web`, `u2giants/popdam3`) follow their normal main-only workflow. The six
    `popcre/designflow-*` repos stay on Albert's sandbox branch, use PRs to `develop`, and are
    reviewed/merged by Uma—not the AI. Pass only when inactive records disappear in exactly
    the intended applications, PLM production consumes the chosen single-writer status path,
    the audit ledger is closed, and every repository's tests/CI pass.
12. **Bulk operations.** Add preview/count/confirm, reason, per-record audit, partial-failure
    reporting, and recovery/reactivation.
13. **Production delivery.** Promote migrations only in an approved window and complete the
    GitHub Actions → GHCR → Coolify path. Verify DNS/TLS, Microsoft SSO redirects,
    administrator and denied-user behavior, HTTP health, and deployed build SHA. Enable the
    production status-write gate only after Step 11 passes or the owner explicitly approves a
    phased release.
14. **Gradual grid consolidation.** Do not expand PopCRM DataTable as a shared platform.
    Migrate an existing non-DesignFlow screen only for a real product reason and after parity
    tests pass.
15. **Final superseded-plan removal.** Only after every requirement above is implemented and
    verified, confirm the tri-state status behavior, concrete cutover searches, dated inventory
    snapshots, `core.factory_source_ref` shape, and historical migration anchors from
    `fix_impl_visual_admin_page.md` are incorporated. Then delete that file and every inbound
    reference in the same final completion PR.

---

## 11. Testing and visual-verification gates

### Automated tests

- Unit: RevoGrid filter adapter, typed editors, effective-status resolution, saved state,
  merge-preview presentation.
- Database: administrator authorization, denied non-admin calls, grants/RLS boundaries,
  audit completeness, concurrency, source-ref preservation, Coldlion re-pull survival,
  global/app status behavior.
- Integration: rename, status change, reactivation, merge preview/apply, bulk changes,
  partial-failure recovery.
- Browser: persistent header filters, keyboard editing, copy/paste restrictions, saved
  views, responsive layout, and large datasets.
- Cross-app: Customer/Vendor picker visibility in CRM, PM/PIM, DAM, and PLM.

### Required visual evidence

Before UI work is reported done, serve the application and capture screenshots of:

- Customer grid with header filters and status columns;
- Vendor grid;
- Customer/Vendor detail panel with aliases and source references;
- merge preview/confirmation dialog;
- Licensor → Property tree;
- narrow and wide viewport behavior;
- clear unauthorized/failed-operation state where applicable.

The first development-shell visual check is retained at
[`docs/verification/db-data-admin-development.png`](docs/verification/db-data-admin-development.png).
It proves the deployed shell renders, but it does not satisfy the later grid/detail/merge/tree
screenshots listed above.

Develop and test against the preview Supabase project, not production. Never embed or commit
keys. Use the repository's sanctioned configuration path once the application scaffold
defines it.

---

## 12. Definition of done

- [ ] DB Data Admin is implemented in `shared-db/apps/db-data-admin/` and available at
      `https://data.designflow.app`.
- [x] `.github/workflows/sync.yml` excludes `apps/`, and a sync test proves the frontend is
      not mirrored into consumer repositories while canonical shared-db content still is.
- [ ] Only authorized administrators can enter or call its database operations.
- [ ] Authorization uses both the existing administrator role and an explicit non-revoked
      `admin` app-access row via `app.has_explicit_app_access`; no identity is hard-coded by
      email.
- [ ] RevoGrid Core provides the required persistent header-filter experience without Pro
      source or undocumented internals.
- [ ] Customer grid supports display name, Channel, global/per-app status, aliases, source
      refs, reactivation, and protected merge.
- [ ] Vendor grid provides equivalent capabilities and labels the entity Vendor.
- [ ] Licensor → Property tree reconciles every canonical record, includes source context,
      and treats the relationship as read-only in v1.
- [ ] Merge preview identifies every affected reference and the post-merge verification
      proves old identifiers still resolve as designed.
- [ ] Merge execution is transactional, locked, idempotent, audited, and reconciles every
      loser/survivor extension-row conflict explicitly.
- [ ] The dedicated audit and per-user grid-state stores and protected APIs are live and
      tested.
- [ ] Every new database object was authored in shared-db via a new migration, passed SQL
      checks, applied/tested on preview first, merged, and promoted in an approved window.
- [ ] The cross-application safety audit has recorded and resolved every relevant hit.
- [ ] All consumer pickers enforce global and application-specific status correctly.
- [ ] PLM production uses the single-writer status path selected during inventory; DesignFlow
      changes were reviewed and merged by Uma through the sandbox-to-`develop` workflow.
- [ ] Unit, database, integration, browser, accessibility, and cross-app tests pass.
- [ ] Required screenshots are attached to the implementation evidence.
- [ ] GitHub CI is green and the live build SHA is verified.
- [ ] After every requirement in this specification is implemented and verified,
      [`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md) is deleted from this
      repository in the same completion PR. Its useful requirements have been absorbed here;
      retaining the superseded file after delivery would create documentation flotsam that is
      mirrored into consumer repositories. That PR must re-confirm that no unique requirement
      remains and remove every inbound reference to the deleted file from `HANDOFF.md`, this
      document, and the rest of the repository.

---

## 13. Known traps and failed shortcuts

- **Direct browser access to `core.*`:** convenient for early pickers but inappropriate for
  this broad administration surface. Use protected `api.*` operations.
- **RLS without grants:** an RLS policy does not confer table privileges. A missing grant
  causes `permission denied ... (42501)` before row policy evaluation. Prefer protected
  functions and still verify their grants.
- **Assuming old `api.*` objects exist:** the historical spec names objects that may have
  changed or been removed. Verify migrations and preview first; notably do not assume
  `api.customer_list` exists. It was created in migration `20260625160000` and deliberately
  removed in `20260629034600`; do not recreate that legacy name as a shortcut.
- **Calling `core.merge_*` directly:** wrap sensitive operations with administrator checks,
  preview, audit, concurrency protection, and explicit confirmation.
- **Name-based identity:** names are mutable. Store canonical UUIDs or stable source codes.
- **Letting re-pulls overwrite curation:** display names and curated statuses must survive.
- **Treating Coldlion as taxonomy hierarchy/status authority:** it supplies neither.
- **Using `mgTypeCode` globally:** meanings vary by division; use division/type/code identity.
- **Silent orphan/error handling:** unexpected taxonomy orphans, partial bulk failures, and
  sync/API failures must be visible.
- **Grid proliferation:** do not build new shared features on the legacy PopCRM DataTable or
  rewrite functioning AG Grid screens solely for standardization.

---

## 14. Constraints and non-goals

- No direct DDL, dashboard schema edits, or application-repo migrations.
- No hard deletion as ordinary inactivation.
- No EAV, one-table-per-attribute design, or structured fields hidden in JSON.
- No duplication of app-owned values simply because another application displays them.
- No general cross-app mega-view accessible to ordinary application users.
- No editing Licensor → Property relationships in v1.
- No RevoGrid Pro code or undocumented internals without separate approval.
- No immediate rewrite of existing AG Grid or PopCRM screens merely to reduce library count.
- No production release before preview proof and the cross-application safety gate.

---

## 15. Key references

- [`HANDOFF.md`](HANDOFF.md): current repository state and active workstreams.
- [`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md): superseded PopCRM-hosted
  proposal retained only while implementation is unfinished. This document is authoritative;
  delete the superseded file when DB Data Admin is fully implemented and verified.
- [`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md): application
  extension-table architecture.
- [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md):
  Licensor/Property source authority and composite-key rules.
- [`docs/app-migration-notes/coldlion-customers-vendors-20260715.md`](docs/app-migration-notes/coldlion-customers-vendors-20260715.md):
  Customer/Vendor import and curated-status behavior.
- [`docs/coldlion-customer-dedupe-review.md`](docs/coldlion-customer-dedupe-review.md): Customer
  deduplication rulings and canonical state.
- [`fix_vendor_review.md`](fix_vendor_review.md): Vendor cleanup state.
- [`fix_schema_for_api.md`](fix_schema_for_api.md): ERP mirror relocation and related cutover
  dependencies.
