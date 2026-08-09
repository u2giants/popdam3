-- =====================================================================================
-- Issue #597 Phase 1 — picker contracts for Product Size and Product Depth.
--
-- THE RULE THESE EXIST TO ENFORCE (owner decision 2 on issue #597)
-- ----------------------------------------------------------------
--   "Inactive values remain visible on existing items but are excluded from new
--    selections."
--
-- That rule is a property of a REQUEST, not of a row: the same inactive Size must be
-- returned when an item already holds it and withheld when it does not. A plain view
-- cannot express it — a view has no way to know what the caller already has selected.
-- So these are set-returning FUNCTIONS taking the currently-selected ids.
--
-- This is a deliberate deviation from the word "view" in the issue text and in claim
-- #602. Implementing them as views would have meant either publishing every inactive
-- value to every picker (breaking the rule) or hiding inactive values entirely
-- (breaking existing items, which then render a blank Size). Callers use them exactly
-- like a view: `select * from api.product_size_list(...)`.
--
-- EVERY ROW CARRIES `selectable`. The caller never has to re-derive the rule, and an
-- inactive row that is only present because it is already selected is visibly marked
-- as not choosable rather than silently offered.
--
-- SECURITY INVOKER (the default), so the RLS `shared_read` policies on the underlying
-- core tables remain in force and a picker cannot become a way around them.
-- =====================================================================================

create or replace function api.product_size_list(
  p_selected_ids  uuid[] default null,
  p_division_code text   default null,
  p_search        text   default null,
  p_limit         integer default 1000
)
returns table (
  id uuid,
  company_code text,
  division_code text,
  mg_type_code text,
  code text,
  label text,
  status text,
  selectable boolean,
  currently_selected boolean
)
language sql
stable
set search_path = api, core, app, public
as $$
  select
    ps.id,
    ps.company_code,
    ps.division_code,
    ps.mg_type_code,
    ps.code,
    ps.label,
    ps.status::text,
    (ps.status = 'active') as selectable,
    (p_selected_ids is not null and ps.id = any (p_selected_ids)) as currently_selected
  from core.product_size ps
  where (
          ps.status = 'active'
          -- An inactive value appears ONLY because this caller already holds it.
          or (p_selected_ids is not null and ps.id = any (p_selected_ids))
        )
    and (p_division_code is null or ps.division_code = btrim(p_division_code))
    and (
          p_search is null
          or btrim(p_search) = ''
          or ps.label ilike '%' || btrim(p_search) || '%'
          or ps.code  ilike '%' || btrim(p_search) || '%'
        )
  order by (ps.status = 'active') desc, ps.division_code, ps.label, ps.code
  limit greatest(1, least(coalesce(p_limit, 1000), 5000));
$$;

comment on function api.product_size_list(uuid[], text, text, integer) is
  'Product Size picker contract. Returns active Sizes plus any INACTIVE Size whose id is passed in p_selected_ids — the owner rule is that a retired value stays visible on an item that already holds it and is never offered for a new selection. Every row carries `selectable`. A set-returning function rather than a view because the rule depends on what the caller already has selected. SECURITY INVOKER: core.product_size RLS still applies. Issue #597 Phase 1.';

create or replace function api.product_depth_list(
  p_selected_ids uuid[] default null,
  p_search       text   default null,
  p_limit        integer default 1000
)
returns table (
  id uuid,
  legacy_id integer,
  code text,
  label text,
  status text,
  selectable boolean,
  currently_selected boolean
)
language sql
stable
set search_path = api, core, app, public
as $$
  select
    pd.id,
    pd.legacy_id,
    pd.code,
    pd.label,
    pd.status::text,
    (pd.status = 'active') as selectable,
    (p_selected_ids is not null and pd.id = any (p_selected_ids)) as currently_selected
  from core.product_depth pd
  where (
          pd.status = 'active'
          or (p_selected_ids is not null and pd.id = any (p_selected_ids))
        )
    and (
          p_search is null
          or btrim(p_search) = ''
          or pd.label ilike '%' || btrim(p_search) || '%'
          or pd.code  ilike '%' || btrim(p_search) || '%'
        )
  -- sort_order carries the legacy id so the picker keeps DesignFlow's original
  -- ordering; label is the tiebreak because 7 labels legitimately repeat.
  order by (pd.status = 'active') desc, pd.sort_order nulls last, pd.label, pd.code
  limit greatest(1, least(coalesce(p_limit, 1000), 5000));
$$;

comment on function api.product_depth_list(uuid[], text, integer) is
  'Product Depth picker contract. Returns active Depths plus any INACTIVE Depth whose id is passed in p_selected_ids, so a retired value stays visible on an item that already holds it and is never offered for a new selection. Ordered by the preserved legacy id. SECURITY INVOKER: core.product_depth RLS still applies. Issue #597 Phase 1.';

revoke all on function api.product_size_list(uuid[], text, text, integer)  from public, anon;
revoke all on function api.product_depth_list(uuid[], text, integer)       from public, anon;

grant execute on function api.product_size_list(uuid[], text, text, integer) to authenticated, service_role;
grant execute on function api.product_depth_list(uuid[], text, integer)      to authenticated, service_role;
