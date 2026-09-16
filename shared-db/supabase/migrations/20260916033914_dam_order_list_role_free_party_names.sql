-- Issue #2988; claim #3005. PopDAM OrderList must open for every signed-in
-- PopDAM user, including one with no app.user_role row.
-- derived-from: 20260810010000
--
-- The two helpers are narrow views in the dam schema, owned by postgres and
-- left at the default security_invoker = false, so they read core.customer and
-- core.factory as their owner. core.customer and core.factory are owned by
-- postgres and do NOT have FORCE ROW LEVEL SECURITY, so the owner is not
-- subject to their policies and the per-row qual below is never evaluated.
-- Evidence, read read-only from production qsllyeztdwjgirsysgai on 2026-09-16:
--   select relname, relowner::regrole::text, relrowsecurity, relforcerowsecurity
--   from pg_class where oid in ('core.customer'::regclass,'core.factory'::regclass);
--   -> (customer, postgres, t, f) and (factory, postgres, t, f).
-- The production contract dam_order_list_role_free_party_names_v1 re-asserts
-- exactly that pair of rows, so a change to it fails verification rather than
-- silently invalidating this comment.
--
-- They are views, not SECURITY DEFINER functions, on purpose. A function that
-- raises on a non-authenticated caller cannot be LEFT JOINed safely: a LEFT
-- JOIN does not swallow the exception, so service_role, a table-owner session
-- and any no-JWT session would get 42501 instead of the order list, and
-- supabase/tests/wb_grants_rls_and_dam_order_list_invoker.sql -- which selects
-- from the view under a JWT carrying neither sub nor role -- would abort. A
-- view has no such failure mode: every caller that may select it gets rows,
-- and every caller that may not gets a plain permission error on the view.
--
-- dam is not in this project's PostgREST exposure list. Evidence, read
-- read-only from production qsllyeztdwjgirsysgai on 2026-09-16:
--   select setconfig from pg_db_role_setting s
--   join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator';
--   -> pgrst.db_schemas=public, graphql_public, api, crm, pim, core, app
--      (alongside statement_timeout=8s and lock_timeout=8s); `dam` is absent.
--   select rolname, rolcanlogin from pg_roles
--   where rolname in ('authenticated','service_role','anon','authenticator');
--   -> authenticated f, service_role f, anon f, authenticator t.
-- So neither helper is reachable over the REST API, and the roles that hold
-- SELECT on them cannot log in -- they are only ever assumed by authenticator
-- behind PostgREST. Both readings are role settings on the production project
-- and are NOT verifiable from this file alone; they were observed at the date
-- above and the second is what the NOLOGIN claim rests on. A PopDAM end user
-- therefore has no route to either helper except through api.dam_order_list.
--
-- PRODUCTION DIAGNOSIS (read-only, 2026-09-15/16, qsllyeztdwjgirsysgai).
--   api.dam_order_list is a security-invoker view that LEFT JOINs core.customer
--   (826 rows) and core.factory (93 rows). Both carry the `shared_read` policy
--   `app.has_any_role(array[administrator,sales,licensing,designer,viewer,vendor])`.
--   That qual takes no row-dependent argument but is STABLE, so PostgreSQL
--   evaluates it once PER ROW instead of folding it. Measured under the
--   reporting user's own JWT claims on production (the PopDAM account named in
--   issue #2988; referred to by issue, not by address, per AGENTS.md 6.14), 826
--   evaluations of that exact qual cost 5,373 ms and every one returned false. That is the whole of
--   the ~3.44 s customer node and ~0.41 s factory node in the issue's plan, and
--   the reason a bounded 500-row page reaches the 8 s authenticated timeout.
--   Reading the same two columns with no policy evaluation costs 1.2 ms.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
--   The two joins now read a pair of NARROW owner-evaluated directory views
--   that expose only (id, name) -- the exact two values the grid already
--   displays. The policy qual is not evaluated at all, for any number of rows.
--   Nothing else about the view changes: same columns, same order, same types,
--   same rows, same joins, same ordering, same LIMIT behaviour.
--
--   * api.dam_order_list STAYS security_invoker = true. Issue #2662 (definer
--     views and cross-application leakage) is untouched and this migration does
--     not pre-empt it: every other input of the view is still read under the
--     caller's own RLS.
--   * core.customer and core.factory policies, grants and columns are NOT
--     changed. Direct access to either table is exactly what it was, for every
--     role. A user with no business role still cannot select those tables, and
--     still cannot see any column beyond a party's display name through this
--     view -- which is already what the grid shows and what a role-bearing user
--     has always seen there.
--   * The helpers live in `dam`, which this project's PostgREST does not
--     expose, so they are not reachable as RPC. anon and PUBLIC get no SELECT;
--     only authenticated and service_role do, which is exactly the set of
--     roles that may already select api.dam_order_list.
--   * No timeout is raised, no dataset is loaded in full, and no index,
--     materialized view or scheduled job is introduced.

-- IDEMPOTENCE. An earlier shape of this migration created these four helpers as
-- SECURITY DEFINER set-returning functions; that shape was abandoned because a
-- raising function cannot be LEFT JOINed (see above). A function and a view
-- cannot share a name in the same schema, so a re-run, or an environment where
-- the first shape was partially applied, must drop them before the views are
-- created. Dropping something that was never created is a no-op.
drop function if exists dam.dam_order_list_customer_directory();
drop function if exists dam.dam_order_list_vendor_directory();
drop function if exists app.dam_order_list_customer_directory();
drop function if exists app.dam_order_list_vendor_directory();

create or replace view dam.dam_order_list_customer_directory as
select
  c.id   as customer_id,
  c.name as customer_name
from core.customer c;

create or replace view dam.dam_order_list_vendor_directory as
select
  f.id   as vendor_id,
  f.name as vendor_name
from core.factory f;

-- Explicit, not inherited: these read their source tables as their postgres
-- owner. That is the whole point, and it is stated in the catalog so the
-- production contract can pin it.
alter view dam.dam_order_list_customer_directory set (security_invoker = false);
alter view dam.dam_order_list_vendor_directory   set (security_invoker = false);

revoke all on dam.dam_order_list_customer_directory from public, anon;
revoke all on dam.dam_order_list_vendor_directory   from public, anon;
-- authenticated and service_role are precisely the roles that may already
-- select api.dam_order_list; nobody else gains anything.
grant select on dam.dam_order_list_customer_directory to authenticated, service_role;
grant select on dam.dam_order_list_vendor_directory   to authenticated, service_role;

comment on view dam.dam_order_list_customer_directory is
  'Issue #2988. Narrow (id, name) customer directory for api.dam_order_list, read as its postgres owner so the bounded OrderList page never pays the per-row core.customer policy evaluation. Exposes no other column; core.customer policies, grants and columns are unchanged. Not exposed by PostgREST.';
comment on view dam.dam_order_list_vendor_directory is
  'Issue #2988. Narrow (id, name) vendor directory for api.dam_order_list, read as its postgres owner so the bounded OrderList page never pays the per-row core.factory policy evaluation. Exposes no other column; core.factory policies, grants and columns are unchanged. Not exposed by PostgREST.';

create or replace view api.dam_order_list as
select
  -- identity
  pol.id                                    as order_line_id,
  po.id                                     as order_id,

  -- order (header) facts
  po.production_order_number,
  po.status                                 as order_status,
  po.company_id,
  cust.customer_name                        as customer_name,
  po.factory_id,
  fact.vendor_name                          as vendor_name,
  po.metadata ->> 'ordering_company'        as ordering_company,
  po.order_date,
  po.sent_po_date,
  po.seal_container_date,
  po.vendor_delivery_date,
  po.requested_ship_date,
  po.actual_ship_date,
  po.booking_state,
  po.etd,
  po.eta,
  po.warehouse_date,
  po.container_booking_group,
  po.mbl,
  po.close_tracking,
  po.voided_at                              as order_voided_at,
  po.void_reason                            as order_void_reason,

  -- line facts
  pol.line_number,
  pol.order_person,
  pol.order_type,
  pol.customer_suffix,
  pol.customer_po_number,
  pol.assortment_id,
  pol.assortment_component_ordinal,
  pol.sku,
  pol.sku_normalized,
  pol.quantity_ordered,
  pol.quantity_shipped,
  pol.unit_cost,
  pol.order_depth_inches,
  pol.case_pack,
  pol.cases_reported,
  pol.ship_to,
  pol.start_ship_date,
  pol.start_ship_raw,
  pol.cancel_date,
  pol.cancel_raw,
  pol.cargo_forecast_date,
  pol.cargo_forecast_raw,
  pol.test_report,
  pol.professional_photos,
  pol.contractual_sample_reorder,
  pol.status                                as line_status,
  pol.voided_at                             as line_voided_at,
  pol.void_reason                           as line_void_reason,

  -- how this line resolved to a product
  pol.source_style_type,
  pol.master_data_match_status,
  pol.item_id,

  -- CURRENT product facts (live, read-only in the UI)
  item.item_number                          as item_number,
  item.style_number                         as item_style_number,
  item.name                                 as item_name,
  item.description                          as item_description,
  bridge.id                                 as style_tracker_bridge_id,
  bridge.style_tracker_row_id,
  bridge.tracker_type                       as master_data_tracker_type,
  str.description                           as master_data_description,
  str.license_status                        as master_data_license_status,
  str.licensor                              as master_data_licensor,
  str.default_vendor                        as master_data_default_vendor,
  str.customer                              as master_data_customer,

  -- IMMUTABLE source snapshot (display fallback only, never current truth)
  pol.metadata #>> '{order_list_snapshot,sku}'            as snapshot_sku,
  pol.metadata #>> '{order_list_snapshot,description}'    as snapshot_description,
  pol.metadata #>> '{order_list_snapshot,license_status}' as snapshot_license_status,
  pol.metadata #>> '{order_list_snapshot,style_type}'     as snapshot_style_type,
  pol.metadata #>> '{order_list_snapshot,source_row}'     as snapshot_source_row,

  -- diagnostics the grid renders as a badge, computed here so every client agrees
  (pol.item_id is null)                     as item_link_missing,
  (
    pol.item_id is not null
    and bridge.id is not null
    and pol.source_style_type is not null
    and bridge.tracker_type is distinct from pol.source_style_type
  )                                         as item_link_type_mismatch,

  -- provenance
  google_ref.source_id                      as google_source_id,
  coldlion_ref.source_id                    as coldlion_source_id,
  pol.created_at                            as line_created_at,
  pol.updated_at                            as line_updated_at
from plm.production_order_line pol
join plm.production_order po
  on po.id = pol.production_order_id
-- Issue #2988: the two party names come from narrow authenticated-only
-- directories, evaluated once per query, instead of a per-row RLS policy
-- evaluation over core.customer / core.factory.
left join dam.dam_order_list_customer_directory cust
  on cust.customer_id = po.company_id
left join dam.dam_order_list_vendor_directory fact
  on fact.vendor_id = po.factory_id
left join plm.item item
  on item.id = pol.item_id
left join plm.style_tracker_item_bridge bridge
  on bridge.plm_item_id = pol.item_id
left join public.style_tracker_rows str
  on str.id = bridge.style_tracker_row_id
left join plm.production_order_line_source_ref google_ref
  on google_ref.production_order_line_id = pol.id
 and google_ref.source_system = 'google_order_list'
left join plm.production_order_line_source_ref coldlion_ref
  on coldlion_ref.production_order_line_id = pol.id
 and coldlion_ref.source_system = 'coldlion';

-- Re-asserted, not changed: the view keeps the invoker semantics fixed by
-- 20260810110000 and the same grants it already carries. anon stays excluded.
-- The service_role write grants below are not new and are not decorative: the
-- live view's relacl on production today is
--   {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}
-- so re-asserting them reproduces the existing state exactly. Dropping them
-- would be an unrelated privilege change outside this issue's scope.
alter view api.dam_order_list set (security_invoker = true);
revoke all on api.dam_order_list from public, anon;
grant select on api.dam_order_list to authenticated;
grant select, insert, update, delete on api.dam_order_list to service_role;

comment on view api.dam_order_list is
  'PopDAM OrderList read contract. security_invoker view over plm order/line/item/bridge inputs under the caller''s own RLS. Issue #2988: customer and vendor display names come from dam.dam_order_list_customer_directory and dam.dam_order_list_vendor_directory, narrow owner-evaluated (id, name) directory views, so a signed-in user with no business role loads the bounded page without the per-row core.customer and core.factory policy cost. Direct core.customer and core.factory access is unchanged.';
