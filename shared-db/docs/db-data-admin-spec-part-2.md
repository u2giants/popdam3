---
summary: DB Data Admin product and implementation specification part 2 of 2: sections 10, 11, 12, 13, 14, 15.
kind: spec
status: current
read-when: building or changing DB Data Admin (data.designflow.app) behaviour covered by these sections
---

# DB Data Admin — authoritative product and implementation specification — part 2 of 2

> Moved **verbatim** from [`DB_Data_Admin.md`](../DB_Data_Admin.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

## 10. Delivery sequence

### Live deployment state and migration-order hazard (read before Steps 11–13)

Claude live-verified on 2026-07-23 that the Step 4–6 foundation and read contracts are
already present on production. This resolves the former ordering blocker: PopCRM, PM/PIM,
and PopDAM may call the status-aware serving views without a PostgREST schema miss. No
additional read-contract promotion is required before their Step 11 changes.

Production remains deliberately read-only for DB Data Admin:

- production head is `20260722221700`;
- `app.db_data_admin_feature_gate` is absent;
- `20260722170000` (single-record writes),
  `20260722194000` / `20260722194100` (merge execution),
  `20260722203000` / `20260722203100` (Licensor tree), and
  `20260722210000` (merge-preview moving detail) are absent from production but present on
  preview;
- the production DB Data Admin `admin` grantee list is empty.

Those unapplied DB Data Admin migrations have timestamps older than production's current
head. A normal `supabase db push` skips older-than-head pending versions, but
`supabase db push --include-all` would apply them. Therefore:

- **Never run an unbounded production `--include-all` from the full migration directory.**
- Any approved production apply for a newer unrelated tranche (for example a DAM cutover)
  must use a clean temporary checkout whose migration directory physically excludes
  `20260722170000`, `20260722194000`, `20260722194100`, `20260722203000`,
  `20260722203100`, and `20260722210000`, followed by an exact dry-run review.
- Step 11 does not authorize production DB Data Admin writes, merge execution, Licensor-tree
  promotion, an `admin` grantee, or any production PLM status write.
- Step 13 owns the separately approved promotion of the remaining DB Data Admin migrations
  and write-gate enablement after the corrected Step 11 gate passes.

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
4. **Foundation and extension schema — completed on preview and production; writes gated.**
   The foundation, extension, Channel, merge-FK, and read-contract migrations were merged,
   preview-tested, and live-verified on production on 2026-07-23; see
   [`docs/verification/db-data-admin-foundation-20260722.md`](verification/db-data-admin-foundation-20260722.md).
   Production still has no DB Data Admin feature-gate table, write/merge/tree RPCs, `admin`
   grantee, or enabled write path. Keep the verified DAM extension intact.
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
   explicit `admin` grant and filter/sort/cursor/page-size parameters are proven. The Step 6
   serving views and read contracts are live-verified on preview and production; production
   remains inert because it has no explicit DB Data Admin `admin` grantee.
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
    plus app-specific status. This is a serialized step; do the sub-steps in order. Non-
    DesignFlow repos (`u2giants/popcrm-web`, `u2giants/poppim-web`, `u2giants/popdam3`)
    follow their normal main-only workflow. The six `popcre/designflow-*` repos stay on
    Albert's sandbox branch, use PRs to `develop`, and are reviewed/merged by Uma — **not**
    the AI. Pass only when inactive records disappear in exactly the intended applications,
    the Customer PLM mirror-back is proven status-safe without production PLM writes, Vendor
    PLM's prerequisite/deferral is explicit, the audit ledger is closed, and every
    repository's applicable tests/CI pass. Production PLM enablement belongs to Step 13.

    Serialized sub-order (honor the §10 migration hazard throughout):

    1. **Run the §9 audit in all nine repos** (read-only grep/read; record every hit with
       `file:line` and its fix). **No merges yet.** Confirm one shared-db schema change is
       not already in flight (`gh pr list`, branches, `git status --short`). Record the
       existing `popdam3` `dam-customer-hub-picker` overlap and reconcile it before DAM work.
    2. **Record the resolved DesignFlow environment contract:** production is Cloud SQL /
       `5432`; non-production is Supabase `dflow`; production mirror-back is cross-system.
       Before using that mirror-back, repair `plm.import_master_data()` so it cannot overwrite
       curated global `core.customer.status`. This is a serialized shared-db schema tranche:
       new timestamped migration, regression test, preview dry-run/apply, PR, and AI merge;
       do not promote it to production or restart the failing sync in Step 11.
    3. **`poppim-web` (PM/PIM) — first because its schema mismatch is confirmed.** Replace
       the three removed `api.customer_list` callers with `api.pm_customer_list`
       (`domain/reference/api.ts:10`, `features/accounts/api.ts:18`,
       `features/board/collab.ts:314`), delete or migrate dead `fetchRetailers`, update stale
       app documentation, and stop `TaskDetailModal.tsx:162` from swallowing the fetch error.
       Commit to `main`; CI deploys.
    4. **`popdam3` (DAM).** Land or reconcile `dam-customer-hub-picker` first. Keep Customer
       on `api.dam_customer_list`; move Vendor selectors to `api.dam_factory_list`. Treat
       stable base-table `factory_id` persistence as a separate additive shared-db tranche:
       preview-first migration, merge-FK coverage, app update, then production only in an
       approved window. The Step 11 picker-enforcement change must not silently expand into
       that schema tranche.
    5. **`popcrm-web` (CRM).** Repoint the Customer picker feeder to
       `api.crm_customer_picker_list`, preserve `withCurrentCustomer`, gate `searchCrm`, and
       align the tab/stats axis off legacy `customer_status`, and resolve the dead
       `crm.promote_ingested_domain` UI path without restoring the forbidden ingested-domain
       association. Commit to `main`.
    6. **DesignFlow (six repos).** Customer PLM: design and sandbox-test the idempotent
       protected DB Data Admin operation through `apiKeyAuth.js`, but do not use the existing
       clobbering mirror unchanged and do not enable production writes. Vendor PLM: define
       the master-data Factory export using stable `Factory.id`, add the sync/import arm, and
       prepare the reviewed one-time mapping for `core.factory_source_ref`; do **not** ship
       Vendor PLM writes until the match is reviewed. Work on `sandbox-albert`, PR to
       `develop`, **Uma reviews/merges**.
    7. **Verify cross-app picker visibility** against the corrected §5 matrix, including the
       PLM-owned inactive row, then **close the audit ledger** by recording every §9 hit and
       its resolution under `docs/verification/`.
12. **Bulk operations.** Add preview/count/confirm, reason, per-record audit, partial-failure
    reporting, and recovery/reactivation.
13. **Production delivery.** Promote migrations only in an approved window and complete the
    GitHub Actions → GHCR → Coolify path. Verify DNS/TLS, Microsoft SSO redirects,
    administrator and denied-user behavior, HTTP health, and deployed build SHA. Enable the
    production status-write gate and production DesignFlow status path only after Step 11
    passes or the owner explicitly approves a phased release. Use a physically bounded
    migration checkout: never allow an unrelated `--include-all` to promote the older,
    pending write/merge/tree migrations accidentally.
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

### Step 11 enforcement and audit verification gates

These repository-specific gates are mandatory for Step 11; they make "inactive records
disappear in exactly the intended applications, and nothing else breaks" a checkable claim.

**Grep gates (must pass in each consumer repo):**

- No picker path reads `core.*`, `plm.*`, `ingest.*`, `public.erp_*`, or
  `erp_items_current`/`erp_customer`/`erp_vendor`/`prod_order_*` directly.
  Search both SQL-style names and Supabase schema chaining:
  `rg -n "from\\s+core\\.|from\\s+plm\\.|\\.schema\\((?:[\"'\x60])(core|plm|ingest)(?:[\"'\x60])\\)|erp_items_current|erp_customer|erp_vendor|prod_order_" src`
- No active code path holds Customer/Vendor identity by mutable name string (UUID or stable
  source code only). `rg -n "customer.*name|vendor.*name|factory.*name" src` — classify each
  hit as display-only, stable-code/UUID lookup, or unsafe name identity.
- `poppim-web`: **zero exact calls** to the removed `customer_list` relation:
  `rg -n "\\.from\\([\"']customer_list[\"']\\)" src`. Do not use a broad
  `rg "customer_list"` gate; generated types legitimately contain names such as
  `crm_customer_list`.
- `popdam3`: no direct `core.factory` read in the vendor-picker path.
- `popcrm-web`: no **new** `core.`/`plm.`/`erp_*` reads introduced by the repoint.

**Unit tests and repository-specific harnesses:**

`popcrm-web` and `poppim-web` currently have no unit-test runner or Playwright harness.
Before claiming unit coverage, add a deliberately scoped Vitest harness to each repository
or record owner-approved reliance on shared-db contract tests, build/lint CI, and direct
browser evidence. `popdam3` already has Vitest. Never report a nonexistent "existing unit or
browser suite" as green.

- `popcrm-web`: `customerPickerOptions` sourced from `api.crm_customer_picker_list` hides
  global-inactive and CRM-inactive while keeping the assigned current id
  (`withCurrentCustomer`); `searchCrm` excludes inactive/merged rows; the dead
  `crm.promote_ingested_domain` caller is removed or replaced by an approved architecture
  that does not associate `crm.ingested_domain` with `core.customer`.
- `poppim-web`: the three former `api.customer_list` callers
  (`domain/reference/api.ts:10`, `features/accounts/api.ts:18`, `features/board/collab.ts:314`)
  now read `api.pm_customer_list`; the `TaskDetailModal` picker is non-empty and active-only;
  UUID `company_id` persistence is unchanged.
- `popdam3`: `fetchFactoryOptions` sourced from `api.dam_factory_list` hides DAM-inactive and
  global-inactive; if the `factory_id` write path is added, assert it persists a UUID (not
  free-text) and survives a factory rename.

**Contract test (shared-db backbone, re-run during Step 11):**
`supabase/tests/app_serving_status_contracts.sql` proves, as real authenticated CRM/PM/DAM
users, that per-app-inactive rows vanish from that app's picker, globally-inactive rows never
appear, and visible rows report `<app>_status='active'` — for both Customer and Vendor
fixtures. This single rollback-safe suite is the inactive-filter/authorization proof for every
CRM/PM/DAM picker. The PLM read side is covered by `db_data_admin_read_contracts.sql`
(Customer `plm_linked`/`plm_status`; Vendor `p_app=>'plm'` rejected until Factory mapping
exists).
The current suite does not yet prove assigned-historical UUID or merged-loser resolution;
add those fixtures before closing Step 11.

**Browser/visual:** capture per app — active picker list, an inactive record hidden in the
intended app only, an assigned-historical UUID still rendering its label, and a post-merge
loser id still resolving. For `poppim-web` specifically, regression-capture the
`TaskDetailModal` Retailer picker populating instead of silently empty.

**Historical-ID verification (load-bearing):** for each entity, prove an already-assigned UUID
and a merged-loser UUID still resolve after the source row is inactivated or merged. Reuse the
`app_serving_status_contracts.sql` fixtures and add assigned-historical + merged-loser
fixtures: a `public.style_tracker_rows.customer_id` (DAM), a `pim.product.company_id` (PM),
and a `core.customer_alias`/`core.factory_alias` loser row — then assert each still resolves
its label. A merged loser must resolve through alias / `*_source_ref`, never through a name
string.

**CI:** every repository's actually available checks stay green; any newly added harness must
run in CI. For PopCRM/PM without a new runner, require build/lint plus shared-db contract and
browser evidence. Shared-db schema PR CI runs `scripts/check-sql.sh`, a clean preview dry-run,
and the relevant rollback-safe SQL suites. Production must continue to prove
`app.db_data_admin_feature_gate` absent until Step 13.

The first development-shell visual check was captured at
`docs/verification/db-data-admin-development.png` (screenshot not tracked in this repository).
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
- [ ] `poppim-web` no longer references the removed `api.customer_list` (grep gate clean) and
      the Task Detail Retailer picker is non-empty instead of silently empty.
- [ ] `popdam3` Vendor selectors read `api.dam_factory_list`; no direct `core.factory` read
      remains in the vendor-picker path. Stable base-table `factory_id` persistence is either
      completed through its own additive preview-first migration/app tranche or explicitly
      gated as required before production Vendor status writes; it is not smuggled into the
      picker-enforcement change.
- [ ] `popcrm-web` Customer pickers read `api.crm_customer_picker_list`, `searchCrm` excludes
      inactive/merged rows, the legacy `customer_status` axis is reconciled with hub
      `status`, and the dead `crm.promote_ingested_domain` caller is resolved without
      recreating the prohibited ingested-domain association.
- [ ] The additive read-serving views remain verified on production; **no** production write
      gate or DB Data Admin `admin` grant is enabled before Step 13.
- [ ] Assigned historical UUIDs and merged-loser UUIDs still resolve in every app.
- [ ] DesignFlow Vendor PLM status is explicitly deferred behind the documented Factory-export
      and mapping prerequisite (not silently dropped).
- [ ] `plm.import_master_data()` no longer overwrites curated global Customer status; Customer
      PLM mirror-back is proven status-safe on preview/non-production.
- [ ] DesignFlow work follows the resolved production-Cloud-SQL/non-production-Supabase
      single-writer architecture and is reviewed through sandbox-to-`develop` by Uma.
- [ ] Production PLM writes remain disabled in Step 11; their approved go-live is verified in
      Step 13.
- [ ] Unit, database, integration, browser, accessibility, and cross-app tests pass.
- [ ] Required screenshots are attached to the implementation evidence.
- [ ] GitHub CI is green and the live build SHA is verified.
- [ ] After every requirement in this specification is implemented and verified,
      [`fix_impl_visual_admin_page.md`](../fix_impl_visual_admin_page.md) is deleted from this
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
- **Trusting a consumer `shared-db/` mirror for object existence:** those mirrors are stale
  (the `popdam3` mirror has zero `2026072*` migrations) and already caused a false "view does
  not exist" conclusion. Canonical shared-db is the source of truth for authored objects;
  mirrors refresh on pushes to canonical shared-db `main`, independently of database
  promotion.
- **Treating a dated production verification as permanent:** the Step 6 serving views were
  live-verified on production on 2026-07-23. Re-query before a later production-targeted
  change, but do not repeat the already-completed promotion as if it were pending.
- **Cached option lists resurrecting inactive rows:** a cached Customer/Vendor dropdown
  (`useCustomerSegmentQuery`, `["style-tracker-factory-options"]`, etc.) can surface a
  just-hidden row. Invalidate on status change, or re-query the serving view each open.
- **Swallowed fetch errors masking an empty picker:** the `poppim-web` Task Detail fetch is
  followed by `.catch(() => {})`, so a broken/empty result leaves the picker silently empty.
  Do not replicate this pattern; surface picker-fetch failures.
- **Persisting a Vendor by free-text name:** `popdam3` writes `sample_vendor`/`default_vendor`
  as free text, so a renamed/inactive factory breaks the reference with no FK to repair.
  Persisting a UUID requires a separate base-table migration/app tranche; do not pretend the
  read-only bridge-view `factory_id` is writable.
- **Unbounded production `--include-all`:** production's head is newer than several
  intentionally absent DB Data Admin migrations. Running `--include-all` from the full
  directory would apply the write/merge/tree tranche accidentally. Physically exclude it in
  any approved unrelated production apply.
- **Letting PLM mirror-back overwrite global status:** current `plm.import_master_data()`
  writes `core.customer.status` on matched rows. Repair this before reviving the sync; PLM
  application status and global curated status are different authorities.
- **Misreading the DesignFlow environment split:** production is Cloud SQL / `5432`;
  non-production is Supabase `dflow`. Production mirror-back is cross-system through the
  protected API/sync path, not an intra-Supabase SQL shortcut.
- **Two PopCRM status axes:** the canonical hub `status` (`core.customer.status`) and the
  legacy CRM `customer_status` are different columns. A globally inactive row can still carry
  a legacy `ACTIVE_CUSTOMER` value and show in CRM tabs/stats. Treat hub `status` as
  authoritative.

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

- [`HANDOFF.md`](../HANDOFF.md): current repository state and active workstreams.
- [`fix_impl_visual_admin_page.md`](../fix_impl_visual_admin_page.md): superseded PopCRM-hosted
  proposal retained only while implementation is unfinished. This document is authoritative;
  delete the superseded file when DB Data Admin is fully implemented and verified.
- [`docs/per-app-extension-tables-plan.md`](per-app-extension-tables-plan.md): application
  extension-table architecture.
- [`docs/merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md):
  Licensor/Property source authority and composite-key rules.
- [`docs/app-migration-notes/coldlion-customers-vendors-20260715.md`](app-migration-notes/coldlion-customers-vendors-20260715.md):
  Customer/Vendor import and curated-status behavior.
- [`docs/coldlion-customer-dedupe-review.md`](coldlion-customer-dedupe-review.md): Customer
  deduplication rulings and canonical state.
- [`fix_vendor_review.md`](../fix_vendor_review.md): Vendor cleanup state.
- [`fix_schema_for_api.md`](../fix_schema_for_api.md): ERP mirror relocation and related cutover
  dependencies.
- [`docs/verification/db-data-admin-read-contracts-20260721.md`](verification/db-data-admin-read-contracts-20260721.md):
  authoritative record of the Step 6 serving views (`api.crm_customer_picker_list`,
  `api.pm_customer_list`, `api.crm_factory_picker_list`, `api.pm_factory_list`,
  `api.dam_factory_list`) and their effective-visibility enforcement.
