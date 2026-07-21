# DB Data Admin implementation inventory

Date: 2026-07-21
Authoritative product specification: [`../DB_Data_Admin.md`](../DB_Data_Admin.md)

Deployment identifiers and the immutable-image release path are recorded in
[`db-data-admin-deployment.md`](db-data-admin-deployment.md).

This is the evidence catalogue required by delivery Step 1. It records current objects,
owners, consumers, and release blockers; it is not a second product specification.

## Repository and delivery baseline

- Canonical repo: `u2giants/shared-db`; frontend location: `apps/db-data-admin/`.
- `apps/` was absent before implementation. The repository had no package manager, frontend
  build, unit runner, browser harness, Dockerfile, or application CI to reuse.
- Chosen baseline: React 19 + TypeScript 6 + Vite 8.1.5, matching current PopCRM and PopPIM
  while avoiding the Windows path-disclosure advisories affecting Vite through 8.0.15.
- Grid: exact pinned `@revolist/revogrid` and `@revolist/react-datagrid` version `4.23.22`
  (MIT). The always-visible header filter remains a Core-only custom adapter.
- Unit/browser: Vitest + Testing Library + Playwright. Database contract tests run against a
  disposable/preview database, not production.
- Runtime: GitHub Actions builds GHCR; Coolify deploys on the Hetzner host. The development
  application and `data-dev.designflow.app` binding were created through the Coolify API on
  2026-07-21. GitHub now stores the orchestration token and non-secret application identifiers.
  Production remains reserved for `data.designflow.app` after the later production gate.
- Microsoft SSO reuses the existing Supabase/Entra registration. On 2026-07-21, the development
  and production origins were added additively to both Supabase Auth allowlists, the Azure
  provider configuration was copied to preview, and the new preview callback URI was added to
  the Entra application without removing the production callback.

## Live canonical baseline

Read-only production observation on 2026-07-21:

| Entity/evidence | Count |
|---|---:|
| Customers | 859 |
| Customer status: active / potential / inactive | 140 / 12 / 707 |
| Customer aliases | 73 |
| Vendors | 510 |
| Vendor status: active / inactive | 91 / 419 |
| Vendor aliases | 9 |
| Licensors | 20 |
| Properties | 256 |
| Properties without Licensor | 0 |
| Non-revoked `admin` app-access grants | 0 |

No production identity may be granted DB Data Admin access until the owner approves the
grantee list. Preview authorization tests use fixtures and must include an administrator with
no explicit grant.

## Field ownership catalogue

| Entity / field | Canonical owner | Editable in DB Data Admin | Notes |
|---|---|---:|---|
| Customer `id` | `core.customer` | No | Stable UUID used by app FKs. |
| Customer `name` | ERP/source vocabulary | No in v1 | Full/source name. |
| Customer `display_name` | shared curation | Yes | Picker label; survives re-pulls. |
| Customer global `status` | shared curation | Yes | UI values active/potential/inactive; archived/deleted read-only. |
| Customer Channels | shared classification | Yes | Controlled many-to-many lookup; not free text. |
| Customer CRM/PM/DAM status | respective extension row | Yes | Binary active/inactive with reason/actor/time. |
| Customer PLM status | DesignFlow Cloud SQL | Yes through PLM write path | Existing `customers.customers_status`; see PLM decision below. |
| Customer aliases | `core.customer_alias` | Read in v1 | Merge may add aliases; no arbitrary alias editor required. |
| Customer source refs | `core.company_source_ref` | No | Stable provenance. Historical table name remains `company_source_ref`. |
| Vendor `id` | `core.factory` | No | UI always says Vendor. |
| Vendor `name` | ERP/source vocabulary | No in v1 | Full/source name. |
| Vendor `display_name` | shared curation | Yes | Picker label; survives re-pulls. |
| Vendor global `status` | shared curation | Yes | Same global status rules as Customer. |
| Vendor CRM/PM/DAM status | respective extension row | Yes | PopDAM has real Styles Vendor selectors; `dam.factory_ext` is required. |
| Vendor PLM status | DesignFlow Cloud SQL | Yes through PLM write path | Existing `Factory.factory_status`; see PLM decision below. |
| Vendor related Customer | `core.factory.company_id` | Read in v1 | Optional FK, `ON DELETE SET NULL`. |
| Vendor aliases | `core.factory_alias` | Read in v1 | Merge may add aliases. |
| Vendor source refs | `core.factory_source_ref` | No | No `source_name` column; use source system/code/id. |
| Licensor/Property name, code, status | DesignFlow-owned taxonomy mirror | No in v1 | Read-only canonical mirror. |
| Property → Licensor | DesignFlow | No in v1 | Nullable FK with `ON DELETE SET NULL`; orphan is a loud error. |
| Audit events | `app.db_data_admin_audit_event` | Append through operations only | Immutable, indefinite retention. |
| Grid state | `app.db_data_admin_grid_state` | Own profile only through RPC | Durable filters/sort/order/widths/visibility. |

## Current serving and authorization objects

- `api.crm_customer_list` exists and is intentionally broad; CRM picker filtering currently
  happens in `popcrm-web/src/features/crm/pages/_shared.ts` using active/potential.
- `api.dam_customer_list` exists and implements global active-or-potential plus default-active
  DAM extension status.
- `api.customer_list` was removed in migration `20260629034600`. PopPIM still calls it in:
  `src/domain/reference/api.ts`, `src/features/accounts/api.ts`, and
  `src/features/board/collab.ts`. These are mandatory cutover fixes.
- No safe PM Vendor serving contract exists yet.
- `app.has_app_access(app)` returns true for every administrator. DB Data Admin therefore needs
  `app.has_explicit_app_access(app)` and must require both administrator role and an explicit,
  non-revoked `admin` access row.
- `api.crm_admin_user_list()` is the protected-function precedent. DB Data Admin tables in
  exposed schema `app` receive RLS and no direct authenticated grants.

## Consumer picker findings

| App | Customer evidence | Vendor evidence | Required cutover |
|---|---|---|---|
| PopCRM | Customer picker helper filters global active/potential. | Opportunities carry `factory_id`; Vendor status is not centrally served. | Add CRM extension-aware contracts and preserve currently assigned inactive rows for display. |
| PopPIM | Three active callers use removed `api.customer_list`. | Products/samples persist `factory_id`; no dedicated safe picker contract found. | Move to `api.pm_customer_list` / `api.pm_factory_list`; enforce global + PM status. |
| PopDAM | Styles “Originally Designed For” is a Customer selector. | Styles has Sample Vendor and Default Vendor selectors. | Keep `api.dam_customer_list`; add `dam.factory_ext` and `api.dam_factory_list`; persist UUIDs. |
| DesignFlow | Many Angular screens call active-only Customer endpoints. | RFQ, standardized, tracking, sample, and item screens use active-only Factory/Vendor endpoints. | Preserve Cloud SQL as PLM status authority and add protected cross-system status operations. |

## PLM single-writer decision

Production DesignFlow uses Cloud SQL and already owns/enforces:

- Customer status: `customers.customers_status`; active picker queries require `ACTIVE`.
- Vendor status: `Factory.factory_status`; active picker queries require `Active`.

Supabase is a downstream DesignFlow mirror, so DB Data Admin must not create a competing
editable `plm.*_ext.status`. The chosen design is:

1. DB Data Admin submits a protected, idempotent PLM-status operation.
2. A server-side integration calls a purpose-built DesignFlow admin API; no DesignFlow secret
   is exposed to the browser.
3. DesignFlow remains the only writer of PLM application status in Cloud SQL.
4. The existing DesignFlow → Supabase master-data sync is extended to mirror the resulting
   PLM status back for DB Data Admin display and audit reconciliation.

Customer mapping is ready: production has 54 `designflow_plm/customers` source refs covering
50 canonical Customers, keyed by stable DesignFlow `customers_id`. Vendor mapping is not
ready: production has 523 Coldlion Vendor refs covering 510 canonical Vendors and zero
DesignFlow Factory refs. Before Vendor PLM status can ship, add a read-only canonical Factory
export from DesignFlow, perform a reviewed one-time match, and store stable
`designflow_plm/Factory/<id>` rows in `core.factory_source_ref`. Names may propose matches but
must never be the runtime key.

DesignFlow changes remain on `sandbox-albert`, PR to `develop`, reviewed and merged by Uma.
Production status editing remains disabled until both Customer and Vendor paths are proven.

## Merge and FK safety findings

- Current `core.merge_customer` predates `public.style_tracker_rows.customer_id` and
  `dam.customer_ext`; deleting a loser can null the Styles link and cascade-delete the DAM
  extension unless the engine/wrapper moves them first.
- Every new extension row uses its core UUID as PK/FK with `ON DELETE CASCADE`, so both merge
  engines require explicit extension reconciliation.
- The regression test must query `pg_constraint` for all FKs targeting `core.customer` and
  `core.factory` and fail on any relationship absent from the approved repoint/cleanup list.
- Always call `core.merge_customer` / `core.merge_factory` with named loser and survivor
  arguments; both engines take loser first.

## In-flight and external dependencies

- No shared-db PR is open. ERP relocation phases remain a separate active workstream, so each
  DB Data Admin migration repeats the one-change-in-flight check and avoids ERP objects.
- `origin/codex/popdam-bakeoff-taxonomy` contains an unmerged Character seed. It does not
  overlap foundation work but must be resolved before Character-count acceptance.
- The DesignFlow master-data API Customer endpoint is healthy (HTTP 200 on 2026-07-21); the
  attempted historical Factory routes returned 404, confirming a new export is required.
- The previously documented Licensor/Property feeder 502 must be rechecked before claiming
  live-source reconciliation. Internal canonical invariants remain independently testable.
