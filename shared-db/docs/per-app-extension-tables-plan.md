# Per-app extension tables — implementation plan

Status: **decision made 2026-07-17 (owner + Kimi K3 review); this document is the implementation guide.**
Scope: shared Supabase Postgres (`qsllyeztdwjgirsysgai`, preview branch `xjcyeuvzkhtzsheknaiu`) and the four apps that share it — CRM (`popcrm-web`), PM/PIM (`poppim-web`), DAM (`popdam3`), PLM (DesignFlow, mirrors in).

---

## 1. Plain-English summary

All four apps share one set of "business card" tables (`core.customer` for customers, `core.factory` for vendors, and friends). The business card holds only what every app agrees on: who the company is, whether it is active, where it lives. Each app also wants to remember its own private things about the same company — the CRM wants a lead score, the DAM wants delivery preferences, the PLM wants ERP flags. The decision is: **each app gets its own "notebook" table** (for example `crm.customer_ext`) that is stapled to the business card by the same ID. Apps never write their private notes onto the shared card itself, and no app can read another app's notebook. This keeps the shared tables small and stable — a change one app needs can no longer break the other three — at the price of one extra join per screen, which is cheap and safe.

## 2. The rule and the litmus test

**The rule.** App-specific attributes on a shared canonical entity live in a **per-app extension table**: `<appschema>.<entity>_ext`, exactly one row per core row, primary key = foreign key to the core table. Not columns on `core.*`, not a jsonb grab-bag on `core.*`, never EAV.

**Litmus test — when a column may live on `core.<entity>` instead of an ext table.** A column belongs on the shared `core.*` table only if at least one of these is true:

1. **Two or more apps genuinely need it** (not "might someday" — two apps read or write it today);
2. it is **identity or classification** of the entity itself (name, display_name, status, domain, address, phone, is_potential); or
3. it is used in **cross-app joins or shared pickers** (e.g. anything `api.global_search` or a shared dropdown resolves through).

Everything else goes in the owning app's `<entity>_ext` table. `metadata jsonb` on either side is for genuinely free-form scraps (import leftovers, one-off annotations) — never for a field the app filters, sorts, or renders as a first-class UI element. EAV (entity-attribute-value pivot tables) is banned outright.

**Grandfather clause.** `core.customer` already carries six CRM-flavored columns — `customer_status`, `chain_type`, `routing_aliases`, `so_patterns`, `primary_salesperson_profile_id`, `account_owner_profile_id` (added by `20260621151239_crm_parity_fields.sql`, i.e. before this rule existed). **They stay where they are for now.** Do not migrate them as part of this work; see §8 for the future deprecation question.

## 3. Canonical template (copy-paste)

One extension table per migration file. Placeholders: `<appschema>` = `crm` | `pim` | `dam` | `plm`; `<entity>` = `customer` | `factory` | ...; `<appkey>` = the `app.app_name` value used by `app.has_app_access()` (`crm`, `pm`, `dam`, `plm` — note **PM/PIM's schema is `pim` but its app key and policy prefix are `pm`**); `<read_role_expr>` / `<write_role_expr>` = the app's existing baseline expressions from `20260621151155_api_rls_realtime.sql` (see per-app sections below).

```sql
-- <YYYYMMDDHHMMSS>_<appschema>_<entity>_ext.sql
--
-- <APP>-owned extension of core.<entity> (per-app extension table pattern,
-- docs/per-app-extension-tables-plan.md). 1:1 "notebook" row: PK = FK, at most
-- one row per core row, missing row is normal (consumers LEFT JOIN).
-- Additive; no backfill; ext rows are created lazily on first save.

create table <appschema>.<entity>_ext (
  <entity>_id uuid primary key references core.<entity>(id) on delete cascade,

  -- App-specific columns here. Typed columns with defaults; metadata jsonb
  -- only for genuinely free-form scraps.
  example_flag    boolean not null default false,
  example_score   integer,
  example_note    text,
  metadata        jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table <appschema>.<entity>_ext is
  '<APP>-owned 1:1 extension of core.<entity> (PK=FK, lazy rows). App-specific
   attributes only: shared identity/classification stays on core.<entity>,
   provenance stays in core.*_source_ref. Other apps never read this table.';

-- House-style updated_at trigger (app.set_updated_at from 20260621150714_foundation.sql).
create trigger set_updated_at before update on <appschema>.<entity>_ext
  for each row execute function app.set_updated_at();

alter table <appschema>.<entity>_ext enable row level security;

-- RLS: mirror the app's baseline policies (20260621151155_api_rls_realtime.sql).
-- The ext table lives in the app's schema, so the app's own read/write policies
-- apply verbatim -- app A's browser role can never satisfy app B's <appkey>_read.
create policy <appkey>_read on <appschema>.<entity>_ext
  for select to authenticated
  using (<read_role_expr>);

create policy <appkey>_write on <appschema>.<entity>_ext
  for all to authenticated
  using (<write_role_expr>)
  with check (<write_role_expr>);

-- GRANTS. An RLS policy is NOT a table GRANT: Postgres checks table privileges
-- first, so without these every browser write fails 42501 even with a perfect
-- policy (hard-won lesson, see 20260715220500_grant_crm_write_dml_to_authenticated.sql).
grant select on <appschema>.<entity>_ext to authenticated;
-- Include the next line ONLY if the browser writes the table directly via
-- PostgREST. Omit it when writes go through a security-definer RPC/worker.
grant insert, update, delete on <appschema>.<entity>_ext to authenticated;
grant all on <appschema>.<entity>_ext to service_role;

-- PostgREST caches table privileges.
notify pgrst, 'reload schema';
```

The app's browser-facing view then LEFT JOINs the ext table. Views stay **per-app** — `api.<appkey>_<entity>_list` joins `core.<entity>` + that app's ext table only:

```sql
-- Same migration file (or a follow-up; same PR either way).
create or replace view api.<appkey>_<entity>_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.display_name,
  c.status,
  c.domain,
  -- ... existing core columns the view already exposes ...
  x.example_flag,   -- NULL when no ext row exists: safe for old app code
  x.example_score,
  x.example_note
from core.<entity> c
left join <appschema>.<entity>_ext x
  on x.<entity>_id = c.id;
```

Template notes:

- **No surrogate `id`.** The PK is the FK. `on delete cascade` means a merged/deleted core row takes its notebook with it (consistent with `core.customer_alias` and `*_source_ref` behavior).
- **Append view columns at the end.** `create or replace view` keeps grants but forbids renaming/reordering existing output columns; appending new ones at the end of the select list is the safe shape. Existing precedent: `api.crm_customer_list` has been recreated this way several times (e.g. `20260717125909_api_customer_views_expose_display_name.sql`).
- **Avoid output-name collisions.** If the view already exposes `metadata` from core, select the ext column as `x.metadata as ext_metadata` (or rename the ext column) — duplicate output names break the view.
- **`security_invoker = true` is load-bearing.** The browser role reads the ext table *through* the view, so the ext table's own grant + `<appkey>_read` policy do the gating. Never join another app's ext table into this view, and never build one mega-view joining all four.
- **Realtime:** only add the table to the realtime publication if the app actually subscribes; most ext tables are read-on-detail-page data and don't need it.

## 4. Per-app sections

All candidate column lists below are **ILLUSTRATIVE — inferred from each app's domain, to be confirmed with the owner before any migration is written** (see §8). They exist to make the pattern concrete, not to be built as-is.

### 4.1 CRM (`popcrm-web`) — `crm.customer_ext`

- **Entities extended:** `core.customer` (primary). Possibly `core.factory` later if CRM starts triaging vendor-ish inbound mail; not needed now.
- **Candidate fields (illustrative):** sales workflow and scoring — `lead_score integer`, `lead_score_updated_at timestamptz`, `triage_state text`, `next_follow_up_at date`, `lost_reason text`, `referral_source text`, `account_tier text`, `preferred_contact_channel text`, email-routing/triage prefs — `auto_route_enabled boolean`, `triage_notes text`. (Note: `routing_aliases`, `so_patterns`, `customer_status` etc. already live on `core.customer` as grandfathered columns — do not duplicate them in the ext table.)
- **API view:** extend `api.crm_customer_list` (and `api.crm_account_list` / `api.crm_customer_overview` if the fields belong on those contracts). Current definitions: `20260717125909_api_customer_views_expose_display_name.sql`.
- **RLS/roles:** baseline CRM policies — `crm_read` = `app.has_app_access('crm') or app.has_role('administrator')`; `crm_write` = `administrator` or `sales`/`licensing` (`20260621151155_api_rls_realtime.sql`). CRM writes operational tables directly from the browser by design, so the DML grant to `authenticated` **is** required here (that is exactly the `20260715220500` fix).
- **Notes:** CRM is the natural pilot — it has the clearest per-customer attribute backlog and an existing per-app view contract to extend.

### 4.2 PM/PIM (`poppim-web`) — `pim.customer_ext`, `pim.factory_ext`

- **Entities extended:** `core.customer` and `core.factory` (vendor workflow is half of what PM does).
- **Candidate fields (illustrative):** on customer: product-workflow preferences — `approval_required boolean`, `sample_required boolean`, `default_currency text`, `price_list_code text`, `default_board_lane text`, `packaging_requirements text`, `moq_notes text`. On factory: vendor/production-management attributes — `default_lead_time_days integer`, `audit_status text`, `audit_expires_at date`, `qc_standard text`, `capacity_notes text`, `preferred_sample_room text`. (Watch the litmus test: if CRM *and* PM both need `default_currency`, it graduates to `core`.)
- **API view:** new `api.pm_customer_list` and/or `api.pm_factory_list` (PM currently has `api.pm_product_board` / `api.pm_product_assets` but no customer/vendor-centric view — this work creates one; keep it core + `pim.*_ext` only).
- **RLS/roles:** **naming quirk — schema is `pim`, app key is `pm`.** Policies are named `pm_read` / `pm_write` per baseline: `pm_read` = `app.has_app_access('pm') or app.has_role('administrator')`; `pm_write` = `administrator` or `licensing`/`designer`/`sales`.
- **Notes:** `pim.factory_ext` is likely the higher-value table (vendor lead times and audit state come up constantly in item-master work); consider it first within this app's slice.

### 4.3 DAM (`popdam3`) — `dam.customer_ext`

- **Entities extended:** `core.customer`.
- **Candidate fields (illustrative):** asset-delivery and branding preferences — `brand_portal_enabled boolean`, `delivery_watermark_policy text`, `preferred_formats text[]`, `auto_share_on_publish boolean`, `usage_rights_notes text`, `asset_credit_line text`, `style_guide_asset_id uuid references app.file_object(id)` (CRM's logo-override storage pattern, `20260708143000_crm_customer_logo_overrides.sql`, shows the appetite for per-customer branding).
- **API view:** new `api.dam_customer_list` joining `core.customer` + `dam.customer_ext` (DAM's existing browser surface is `api.dam_asset_library`).
- **RLS/roles — the `dam` schema exposure caveat.** `dam` is **deliberately absent from `pgrst.db_schemas`** (AGENTS.md §8.1): the DAM frontend never queries `dam.*` directly. So `dam.customer_ext` is reachable from the browser **only through `api.*` views** (grants + `dam_read` policy still apply via `security_invoker`), and writes go through a **`security definer` RPC granted to `authenticated`/`service_role`** (the `public.get_pdf_rich_extraction_hashes` / `public.upsert_pdf_rich_extraction` pattern), not direct PostgREST table writes. Do **not** add `dam` to `pgrst.db_schemas` to "fix" this. Baseline DAM policies: `dam_read` = `app.has_app_access('dam') or app.has_role('administrator')`; `dam_write` = `administrator` or `designer`/`licensing`.
- **Notes:** smallest slice of the four; fine to land late.

### 4.4 PLM (DesignFlow) — `plm.customer_ext`, `plm.factory_ext`

- **Entities extended:** `core.customer`, `core.factory`.
- **Candidate fields (illustrative):** ERP/production flags mirrored from DesignFlow/Coldlion — on customer: `erp_blocked boolean`, `erp_credit_status text`, `requires_pp_sample boolean`, `default_ship_via text`, `production_lead_time_days integer`; on factory: `erp_factory_code text`, `default_incoterm text`, `payment_terms text`, `erp_currency text`. Precedent: `plm.customer_import` already carries PLM-flavored per-customer data (`dilution`, `logistic_load`, `logo_url`) — the ext table is where *curated* subsets of that live long-term. Do **not** duplicate ERP codes that provenance already tracks in `core.company_source_ref` / `core.factory_source_ref` (or `metadata.plm_customer_code`); ext columns are for attributes, not lineage.
- **API view:** extend `api.plm_item_list` / `api.plm_item_status` consumers via a new `api.plm_customer_list` if the fields are customer-centric (current ERP serving view: `20260715193000_erp_phase1_api_plm_item_list.sql`).
- **RLS/roles:** baseline PLM policies — `plm_read` = `app.has_app_access('plm')` or `administrator` or `sales`/`licensing`; `plm_admin_write` = `administrator` only. In practice writers are the import/sync functions (`plm.import_master_data`, the Coldlion pull) running as `security definer` / `service_role` — **omit the browser DML grant** for these tables.
- **Caveat — mirror, not system of record.** DesignFlow runs on its **own Cloud SQL** database; what lands in `plm.*` here is a synced mirror/subset. `plm.*_ext` rows are written by sync code, may lag the ERP, and must never be treated as authoritative over the ERP. Also: the **ERP mirror relocation is in flight** (AGENTS.md §6, `fix_schema_for_api.md`, phases 2–5 pending) — PLM ext work must not start a parallel ERP schema change; schedule it after (or explicitly around) those phases.

## 5. Migration sequencing (how to introduce safely)

1. **One ext table per migration file**, new timestamped `supabase/migrations/YYYYMMDDHHMMSS_<appschema>_<entity>_ext.sql`; never edit an applied migration. The matching `create or replace view` may ride in the same file.
2. **Additive only.** New table + appended view columns. Nothing existing is renamed, dropped, or retyped, so §4.3 of the merge protocol (additive-by-default) is satisfied by construction.
3. **Preview first, every time:** branch → PR → `scripts/check-sql.sh` → `supabase db push --dry-run` against preview (`xjcyeuvzkhtzsheknaiu`) → apply to preview → point the app at preview and verify → author merges → promote to production in an approved window (full checklist: AGENTS.md §5).
4. **No backfill.** Ext rows are created lazily — the first time a user (or sync job) saves an app-specific field for that customer/vendor, upsert the ext row. A missing row means "all defaults", which is exactly what the LEFT JOIN's NULLs express.
5. **Existing app code is untouched by the schema change itself.** Because consumers LEFT JOIN, old code keeps working; apps adopt the new view columns whenever convenient, in their own repos, on their own schedule. The `shared-db` PR does not need a coordinated app deploy.
6. **Serialize with other in-flight schema work** (AGENTS.md §4 rule 1, §6): before starting each ext migration, run the §6 checks (`gh pr list`, branch list, `ls supabase/migrations`, `git status`) and don't overlap with the ERP relocation phases.

## 6. Rollout order and effort/risk

Recommended order (each step is one independent PR; stop anywhere and the system is still coherent):

| # | App / table | Effort | Risk | Rationale |
|---|---|---|---|---|
| 1 | CRM `crm.customer_ext` + extend `api.crm_customer_list` | Small | Low | Clearest backlog, mature view contract, direct-write pattern already proven by `20260715220500`. Pilot that validates the template. |
| 2 | PM/PIM `pim.factory_ext` + `api.pm_factory_list` | Small–medium | Low | Highest-value PM table (vendor lead times/audit); creates PM's first vendor-centric view. |
| 3 | PM/PIM `pim.customer_ext` + `api.pm_customer_list` | Small | Low | Same pattern, second entity; `pim`/`pm` naming quirk already de-risked by step 2. |
| 4 | DAM `dam.customer_ext` + `api.dam_customer_list` + write RPC | Small | Low–medium | Only app needing a `security definer` write path (schema not exposed); otherwise identical. |
| 5 | PLM `plm.customer_ext` / `plm.factory_ext` (sync-written) | Medium | Medium | Depends on ERP relocation phases 2–5; writers are sync jobs, so needs sync-code changes in the same window. |

Nothing about the ordering is load-bearing except: **CRM first** (pilot), **PLM last** (ERP relocation dependency).

## 7. Do-NOT list

- **No mega-view.** Never one `api.*` view joining all four apps' ext tables; views stay per-app (`api.<appkey>_<entity>_list`).
- **No EAV**, and no new jsonb attribute bags for fields an app filters/sorts/renders. `metadata jsonb` is for scraps only.
- **No new app-specific columns on `core.*`.** If only one app needs it, it goes in that app's ext table — even when adding it to core would be one line shorter.
- **Don't migrate the grandfathered CRM columns** (`customer_status`, `chain_type`, `routing_aliases`, `so_patterns`, `primary_salesperson_profile_id`, `account_owner_profile_id`) off `core.customer` in this work. That's a future, separately-approved deprecation.
- **Don't expose `dam`** via `pgrst.db_schemas`; DAM ext access goes through `api.*` views + RPCs.
- **Don't put provenance/sync bookkeeping in ext tables** — that stays in `core.company_source_ref` / `core.factory_source_ref` / `core.taxonomy_source_ref`.
- **Don't add a surrogate `id`** or allow multiple ext rows per core row; PK = FK, 1:1, `on delete cascade`.
- **Don't backfill** ext rows; they're created lazily.
- **Don't skip the grants.** RLS policy ≠ table privilege; a directly-written table needs `grant insert, update, delete ... to authenticated` *and* its policy.
- **Don't edit an already-applied migration**; new timestamped file per change.

## 8. Open questions for the owner

1. **Confirm the candidate columns** in §4 per app — which illustrative fields are real, which are missing, which belong on `core` after all (the litmus test applies: 2+ apps, identity/classification, or cross-app joins/pickers).
2. **PM/PIM entity priority:** is `pim.factory_ext` (vendors) indeed more valuable than `pim.customer_ext`, and are there other shared entities PM wants to extend (e.g. `core.contact`)?
3. **PLM timing:** build PLM ext tables only after ERP relocation phases 2–5 land, or carve out a safe subset now? Also: does the still-open "dflow vs direct Coldlion" sourcing decision change what PLM mirrors here?
4. **`api.customer_list` (the cross-app read view):** confirm it stays core-only forever, so no app leaks another app's notebook into shared screens.
5. **Grandfathered CRM columns:** ever deprecate them into `crm.customer_ext` (with a checked cross-app deprecation), or accept them as permanent core residents? Recommendation: revisit only after all four ext tables exist.
6. **DAM write path:** preference for the write RPC shape — one generic `dam.upsert_customer_ext(...)` security-definer function, or fold ext writes into an existing DAM RPC?
7. **Realtime:** does any app need live updates on its ext table, or is read-on-demand enough for all four?
