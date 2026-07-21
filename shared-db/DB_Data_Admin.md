# DB Data Admin — product and implementation plan

Status: **approved direction; implementation not started**  
Decision date: **2026-07-21**  
Owner: **`u2giants/shared-db`**  
Production URL: **`https://data.designflow.app`**

## 1. What this application is

DB Data Admin is the administrator-facing application for reviewing and maintaining the
shared business data used by PopDAM, PopCRM, PopPIM/PM, and DesignFlow PLM. Its first four
managed areas are:

1. Customers
2. Vendors (stored canonically as `core.factory`; the UI must say **Vendor**)
3. Licensors
4. Properties

This is **not** PopDAM's `/styles` Item Master grid. `/styles` manages styles/items. DB Data
Admin manages the shared database records that applications select from.

The application and every database contract it needs are owned by this canonical
`u2giants/shared-db` repository. The intended frontend location is
`apps/db-data-admin/` in this repo. Do not implement this as a PopCRM-only or PopDAM-only
page. The older [`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md) proposal to
put the page in PopCRM is superseded by this document.

## 2. Grid standard — do not grow three grid systems

The target is **two grid engines long-term, not three**:

- **AG Grid remains in DesignFlow PLM** and in existing screens that already depend on it.
  DesignFlow's established AG Grid rules remain in force; this project does not trigger a
  risky rewrite of working PLM grids.
- **RevoGrid Core (MIT) is the standard for DB Data Admin and new non-DesignFlow,
  data-heavy/editable grids.** DB Data Admin will build the missing always-visible header
  filtering as our own thin adapter using RevoGrid Core's public APIs.
- PopCRM's custom `src/components/app/DataTable.tsx` becomes a **legacy component**. Keep it
  working, but do not turn it into a third cross-application grid platform. Replace it
  incrementally only when a screen is otherwise being rebuilt and the replacement has
  behavior/test parity. Do not launch a wholesale rewrite merely for standardization.

This means all three implementations may temporarily exist in source control during the
transition, but only AG Grid and RevoGrid are strategic grid engines.

### Why RevoGrid for DB Data Admin

PopCRM's custom DataTable already has good header search, set filters, autocomplete,
sorting, resizing, reordering, inline editing, and drag-to-copy. RevoGrid adds a maintained
virtualized spreadsheet engine, stronger cell/range selection, keyboard navigation, and a
base for large/wide editable tables. Reuse PopCRM's and PopDAM's interaction design and
tests; do not copy their plain-table DOM into RevoGrid.

RevoGrid Core has filtering but its official always-visible header-input plugin is a Pro
feature. DB Data Admin must remain on the MIT Core package unless the owner separately
approves a paid license. Implement persistent header controls through documented public
column templates and filter state/events. Do not copy RevoGrid Pro source or depend on
undocumented internals.

## 3. Customer and Vendor data model

`core.customer` and `core.factory` are the shared canonical records. Application extension
tables are 1:1 additions to those records, not replacement Customer/Vendor tables and not
status-only tables.

Example DAM read shape:

```text
api.dam_customer_list
  = core.customer
    LEFT JOIN dam.customer_ext ON customer_id
```

One `dam.customer_ext` row can contain many DAM-only typed attributes. Do not create one
table per attribute. Fields used for filtering, sorting, editing, validation, or reporting
must be typed columns; JSON is only for genuinely unstructured leftovers. Full extension
rules: [`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md).

### Shared versus application-owned fields

A field belongs in `core.*` when it is shared identity/classification, is genuinely used by
two or more applications, or drives a shared picker/join. A field used by only one
application belongs in that application's extension table.

**Channel is a shared Customer classification.** It means values such as Mass, Specialty,
E-commerce, and Off-Price, so it belongs in the shared Customer contract, not in
`dam.customer_ext`. Before writing the migration, confirm whether a Customer can have one
Channel or several:

- one Channel: controlled lookup referenced by `core.customer`;
- several Channels: controlled lookup plus a Customer-to-Channel relationship table.

Do not implement Channel as arbitrary free text.

`dilution` remains PLM-owned unless at least two applications genuinely use it as a shared
business attribute. A DAM screen may display an approved authoritative value without
duplicating ownership into `dam.customer_ext`.

### “Originally Designed For” in PopDAM

The PopDAM `/styles` “Originally Designed For” field represents a Customer. Its durable
value must be the UUID of `core.customer`, never a copied Customer name. The picker should
read the DAM Customer serving contract (`api.dam_customer_list`), display
`coalesce(display_name, name)`, and save the selected Customer UUID on the style/item
record. A Customer rename must not break the relationship.

If the necessary style-to-customer FK or DAM serving view does not yet exist, author it in
this repo through a new preview-first shared-db migration before changing PopDAM code.

## 4. Inactivation semantics

There are two independent controls:

- **Global inactive:** `core.customer.status` / `core.factory.status`; hides the record from
  every application.
- **Application inactive:** stored in that application's extension row; hides the record
  only in that application.

No extension row means the record is enabled for that application. Effective visibility is:

```text
core status is active
AND
application status is not inactive
```

Store a reason, actor, and timestamp for curated inactivation/reactivation. Coldlion's raw
status is read-only context and must never overwrite the human-curated Core or per-app
status on a later pull.

DB Data Admin must not release its status controls until all affected application pickers
enforce the same effective-visibility rule.

## 5. Administrator-facing screens

### Customers

Show canonical identity/classification, global status, Channel, Coldlion/other source codes
and source status (read-only), plus CRM/PM/DAM/PLM status. A detail area may show app-owned
attributes according to permission and ownership.

### Vendors

Same pattern as Customers, using `core.factory` underneath while labeling the entity Vendor
throughout the UI.

### Licensors and Properties

Show the hierarchy and division context. Follow
[`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md):
`mgTypeCode` has no universal meaning, codes are scoped by division/type, Coldlion does not
provide licensor-to-property relationships or active status, and DesignFlow owns those
relationships/status decisions.

## 6. Safe database API

Normal application views must continue joining Core only to their own extension table. DB
Data Admin is the explicit administrator-only exception because authorized administrators
must compare global and per-app statuses together.

Prefer narrowly scoped functions such as:

```text
api.db_data_admin_customer_list(...)
api.db_data_admin_vendor_list(...)
api.db_data_admin_licensor_property_list(...)
api.db_data_admin_update_customer(...)
api.db_data_admin_update_vendor(...)
```

Exact names are finalized during schema design. Requirements:

- authenticate the caller and require the administrator role inside every operation;
- revoke execution from `public` and grant only the required authenticated role;
- for `SECURITY DEFINER`, pin a safe `search_path` and fully qualify objects;
- return only explicitly approved fields, never unrestricted raw payloads;
- whitelist writable fields rather than accepting arbitrary table/column names;
- use `updated_at` or a version value to detect conflicting edits;
- audit old value, new value, actor, timestamp, reason, and operation ID;
- make bulk changes previewable, countable, confirmable, and recoverable;
- report partial failures loudly.

All DDL starts here as a new timestamped migration. Preview database first, then production
only after the shared-db merge protocol passes.

## 7. RevoGrid behavior contract

The first release requires:

- always-visible input beneath each filterable text header;
- controlled select filters for statuses/booleans;
- debounced filtering and clear-one/clear-all actions;
- visible active-filter state;
- sorting, resizing, reordering, and column show/hide;
- keyboard navigation and accessible labels;
- per-user saved column/filter state;
- inline editing with validation and clear save/error state;
- copy/paste only where the destination column allows it;
- virtualization without losing edits or filter state.

Use the official Core filter collection/state and documented events. Start with text,
boolean, and status filters; add numeric/date operators and set filters after the Core
adapter is proven. Establish a row-count threshold for server-side filtering before an
entity outgrows safe client-side loading.

Useful behavior references (not shared libraries yet):

- PopDAM: `src/components/ui/filterable-table-head.tsx` — persistent filter row,
  suggestions, sorting.
- PopCRM: `src/components/app/DataTable.tsx` — header search/autocomplete, set filters,
  resize/reorder, edit, drag-fill.

## 8. Delivery plan

1. **Inventory and decisions.** Catalogue the four entities, columns, owners, permissions,
   serving contracts, current pickers, and source systems. Resolve single-versus-multiple
   Customer Channels. Pass when every displayed/editable field has one authority.
2. **Application scaffold.** Create `apps/db-data-admin/`, local development instructions,
   tests, container build, build-SHA exposure, and CI. Pass when a read-only authenticated
   shell runs locally and in a non-production environment.
3. **Database read contract.** Add administrator-only Customer/Vendor and
   Licensor/Property reads in a new migration. Apply to preview first. Pass when an admin
   can read all required fields and a non-admin is denied.
4. **Read-only RevoGrid prototype.** Build Customers and Vendors first with persistent
   header filtering. Pass with visual and keyboard tests at narrow/wide viewports and a
   large synthetic dataset.
5. **Single-record writes and audit.** Add whitelisted RPCs, concurrency checks, reasons,
   and audit history. Pass when edits, conflicts, errors, and reactivation are proven on
   preview.
6. **Licensors and Properties.** Add the relationship view/editor without violating
   division/type keys or treating Coldlion as hierarchy/status authority.
7. **Consumer enforcement.** Update and test every app picker for global plus app-specific
   status. Pass only when inactive records disappear in exactly the intended applications.
8. **Bulk operations.** Add preview/count/confirm, per-record audit, partial-failure
   reporting, and recovery.
9. **Production delivery.** Provision `data.designflow.app` through the repository's normal
   GitHub → image registry → deployment-platform pipeline, configure Supabase Auth redirect
   allowlists, verify TLS/login/authorization, and verify the deployed build SHA. DNS,
   hosting, CI/CD, and Auth configuration are implementation work; the URL decision alone
   does not mean they already exist.
10. **Gradual grid consolidation.** Do not add features to PopCRM DataTable as a shared
    platform. Migrate an existing non-DesignFlow screen to the RevoGrid wrapper only when
    there is a real product reason and parity tests pass.

## 9. Testing gates

- Unit tests: filter adapter, typed editors, effective-status calculation, saved state.
- Database tests: authorization, RLS/RPC boundaries, audit completeness, concurrency,
  Coldlion re-pull survival, global/app status behavior.
- Integration tests: create/update/reactivate, single and bulk changes, error recovery.
- Browser tests: header filters, keyboard editing, copy/paste restrictions, saved views,
  responsive layout, large datasets.
- Cross-app acceptance: Customers/Vendors shown or hidden correctly in CRM, PM/PIM, DAM,
  and PLM.
- Visual QA: serve the application and capture screenshots before reporting UI work done.

## 10. Constraints and non-goals

- No direct database DDL, dashboard schema edits, or app-repo migrations.
- No hard deletion as a normal inactivation mechanism.
- No one-table-per-attribute design, EAV, or structured fields hidden in JSON.
- No duplication of app-owned values merely because another app displays them.
- No general cross-app mega-view accessible to ordinary application users.
- No RevoGrid Pro code or undocumented internals without a separately approved decision.
- No immediate rewrite of working AG Grid or PopCRM screens solely to reduce library count.

