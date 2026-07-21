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
  every application.
- **Application inactive:** stored in the relevant application extension row; hides the
  record only in that application.

No extension row means enabled for that application. Effective visibility is:

```text
core status is active
AND
application status is not inactive
```

Store the reason, actor, and timestamp for curated inactivation and reactivation. Coldlion
source status is read-only context and must never overwrite global or application-curated
status during a later pull.

Per-app status, `status_reason`, `status_changed_at`, and `status_changed_by` live as typed
columns in that application's extension row. Every change also writes the central audit
event described in §7. Reactivation sets status active and clears the current
`status_reason`; the immutable audit history retains the former reason and actor.

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
both `app.has_role('administrator')` and `app.has_app_access('admin')`. The `app.app_name`
enum already contains `admin`. Grant DB Data Admin app access through the existing
`app.app_access` mechanism to specifically approved administrator profiles—never through
hard-coded email addresses. `api.crm_admin_user_list()` is the security-definer precedent
for pinned search path, internal role check, revocation from `public`, and an authenticated
grant.

All `api.db_data_admin_*` functions are owned by a controlled database-owner role with only
the cross-schema rights required to read/write the approved `core`, `crm`, `dam`, `pim`,
`plm`, and `app` objects. Browser callers receive no direct cross-schema privilege.

### Audit storage

Create `app.db_data_admin_audit_event` as the immutable audit store. Each event records an
operation UUID/idempotency key, entity type/id, action, old/new JSON snapshots limited to
approved business fields, reason, actor profile/user, timestamp, merge survivor/loser when
applicable, success/failure, and error detail. Only the protected operations write it; only
authorized DB Data Admin users read it through `api.db_data_admin_audit_list(...)`.
Retain audit events indefinitely unless a later written retention policy is approved.
Denied calls should emit a security audit event when it can be done without weakening the
authorization boundary.

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

Each Licensor shows display name, status, Property count, divisions/source codes, and source
context. Each Property shows name, Licensor breadcrumb, status, division/type-qualified
source identity, source context, and optionally Character count.

The relationship is **read-only in v1** because DesignFlow owns Licensor → Property edges.
Do not infer hierarchy from Coldlion or edit the edge unless the owner separately approves a
new authority model. Because `core.property.licensor_id` is a strict FK, orphan count should
be zero; surface any unexpected orphan loudly rather than silently hiding it.

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

---

## 10. Delivery sequence

1. **Inventory and ownership catalogue.** List all displayed/editable fields, source
   systems, current API objects, consumers, permissions, and authority. Pass when every
   field has one owner and every old object name in §6 has been verified or rejected.
2. **Mirror prerequisite completed; record the stack.** The centralized
   `.github/workflows/sync.yml` excludes top-level `apps/`, removes previously mirrored copies,
   and verifies the boundary on every consumer sync. Record the frontend framework, build tool, unit runner,
   Playwright/browser setup, and exact RevoGrid version. Recommended baseline is React +
   TypeScript + Vite to align with the non-DesignFlow apps, subject to repository inspection.
   Pass when a sync test proves `apps/` is absent from consumers while canonical shared-db
   content still mirrors.
3. **Application scaffold and infrastructure kickoff.** Create `apps/db-data-admin/`,
   authenticated shell, local setup, unit/browser test harness, container build,
   build-SHA exposure, and CI. In parallel, open the required infrastructure work:
   GitHub Actions builds/publishes to GHCR; Coolify owns the runtime deployment;
   host-level changes route through `u2giants/ansible`; DNS/Cloudflare and deployment
   configuration follow their canonical owning repos. Configure Microsoft SSO like the
   other POP applications and add exact development plus `https://data.designflow.app`
   redirect origins to the Supabase Auth allowlist. Pass when the read-only shell runs
   locally and in a non-production environment and the production delivery path is named,
   owned, and tracked.
4. **Missing extension and shared-classification schema.** Keep the verified DAM extension
   migration intact. Add preview-first typed Customer extension/status tables for CRM,
   PM/PIM, and PLM, including reason/actor/timestamp, plus the controlled Channel and
   Customer-to-Channel tables. Add `app.db_data_admin_audit_event` and
   `app.db_data_admin_grid_state`. Pass when the intended additive objects exist on preview,
   authorization/grants pass, and no existing consumer behavior changes.
5. **Database read contracts.** Add administrator-only Customer, Vendor, and
   Licensor/Property reads through a new migration. Preview first. Pass when an administrator
   with `admin` app access can read required fields, non-admin/no-access users are denied,
   and filter/sort/cursor/page-size parameters are proven.
6. **Read-only RevoGrid prototype.** Build Customers and Vendors first with persistent
   header filtering, detail panels, aliases, and source references. Pass visual, keyboard,
   accessibility, focus-retention-under-debounce, virtualization-state, saved-view, and
   large synthetic-data tests.
7. **Single-record edits and audit.** Add whitelisted updates, status reason/actor/time,
   concurrency protection, and audit display. Pass when edit, conflict, reactivation, and
   failure paths work on preview. Status editing remains preview-only and must not be
   activated in production before the consumer-enforcement step passes.
8. **Merge preview and execution.** Add protected Customer and Vendor merge wrappers and the
   UI in §8.3. Pass when transferred references and old-identifier resolution are verified.
9. **Licensor/Property tree.** Add the fully read-only v1 hierarchy with source context, counts,
   and loud orphan handling. Pass when every canonical Property appears under exactly one
   Licensor and counts reconcile.
10. **Consumer enforcement and safety audit.** Complete §9 and update every picker for global
    plus app-specific status. Non-DesignFlow repos (`u2giants/popcrm-web`,
    `u2giants/poppim-web`, `u2giants/popdam3`) follow their normal main-only workflow.
    The six `popcre/designflow-*` repos stay on Albert's sandbox branch, use PRs to
    `develop`, and are reviewed/merged by Uma—not the AI. Pass only when inactive records
    disappear in exactly the intended applications and every repository's tests/CI pass.
11. **Bulk operations.** Add preview/count/confirm, reason, per-record audit, partial-failure
   reporting, and recovery/reactivation.
12. **Production delivery.** Complete the GitHub Actions → GHCR → Coolify path initiated in
    step 3; verify DNS/TLS, Microsoft SSO redirects, administrator and denied-user behavior,
    HTTP health, and deployed build SHA. The URL decision does not mean infrastructure
    already exists.
13. **Gradual grid consolidation.** Do not expand PopCRM DataTable as a shared platform.
    Migrate an existing non-DesignFlow screen only for a real product reason and after parity
    tests pass.

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
- [ ] Authorization uses both the existing administrator role and `admin` app access; no
      identity is hard-coded by email.
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
