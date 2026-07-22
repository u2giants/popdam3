-- DB Data Admin Delivery Step 6: protected administrator read contracts.
--
-- Additive only. No existing application contract is altered or replaced:
-- api.crm_customer_list, api.crm_account_list, and api.dam_customer_list keep
-- their current definitions and grants. The functions below are the
-- administrator-only surface defined in DB_Data_Admin.md section 7. Every call
-- requires BOTH the administrator role AND an explicit, non-revoked `admin`
-- app_access row; app.has_explicit_app_access has no administrator
-- short-circuit, so an administrator without an explicit grant is denied.
--
-- Browser callers receive no cross-schema privilege. Each function is
-- SECURITY DEFINER with a pinned search_path, fully qualified objects,
-- EXECUTE revoked from public, and granted only to authenticated. Raw source
-- payloads are never returned; rows expose only approved business fields.
--
-- Every list function accepts filter, sort, cursor/page-size, and
-- inactive-inclusion parameters from this first version so the grid can move
-- between client and server modes without a contract rewrite. Cursors are
-- opaque base64 keyset tokens over (sort_value, id); sort columns are
-- whitelisted, never interpolated.
--
-- PLM status is read-only context per the Step 1 single-writer decision:
-- Customer PLM status comes from the mirrored plm.customer_import row and
-- designflow_plm source refs; Vendor PLM status stays null until the reviewed
-- DesignFlow Factory mapping exists in core.factory_source_ref.

-- Shared authorization gate. Internal helper, not a browser RPC: only the
-- owning role can execute it, from inside the protected functions below.
create or replace function app.require_db_data_admin_access()
returns void
language plpgsql
stable
set search_path = app, public
as $$
begin
  if not (app.has_role('administrator') and app.has_explicit_app_access('admin')) then
    raise exception 'db_data_admin: not authorized'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function app.require_db_data_admin_access() is
  'DB Data Admin gate: active administrator role AND an explicit, non-revoked admin app_access row. Raises insufficient_privilege otherwise. Internal helper; not a browser RPC.';

revoke all on function app.require_db_data_admin_access() from public;

-- Controlled Channel lookup for the administrator grid. The channel tables
-- intentionally have no browser grants (20260722003500); this function is
-- their protected serving path. Inactive channels are included so saved
-- filters can still resolve historical assignments.
create or replace function api.db_data_admin_channel_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  result jsonb;
begin
  perform app.require_db_data_admin_access();

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ch.id,
      'code', ch.code,
      'name', ch.name,
      'description', ch.description,
      'status', ch.status::text,
      'sort_order', ch.sort_order,
      'updated_at', ch.updated_at
    )
    order by ch.sort_order, lower(ch.name)
  ), '[]'::jsonb)
  into result
  from core.channel ch;

  return result;
end;
$$;

comment on function api.db_data_admin_channel_list() is
  'DB Data Admin only. Controlled Customer Channel lookup (id, code, name, description, status, sort_order) for grid filters and display.';

revoke all on function api.db_data_admin_channel_list() from public;
grant execute on function api.db_data_admin_channel_list() to authenticated;

-- Administrator Customer read contract.
create or replace function api.db_data_admin_customer_list(
  p_search text default null,
  p_status text default null,
  p_app text default null,
  p_app_status text default null,
  p_include_inactive boolean default false,
  p_sort text default 'name',
  p_sort_dir text default 'asc',
  p_cursor text default null,
  p_page_size integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_page_size integer;
  v_dir_asc boolean;
  v_cursor_value text;
  v_cursor_id uuid;
  v_rows jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_db_data_admin_access();

  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_dir_asc := lower(coalesce(p_sort_dir, 'asc')) = 'asc';

  if p_status is not null
     and p_status not in ('active', 'potential', 'inactive', 'archived', 'deleted') then
    raise exception 'db_data_admin: invalid status filter'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_app is not null and p_app not in ('crm', 'pm', 'dam', 'plm') then
    raise exception 'db_data_admin: invalid app filter'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_app_status is not null and p_app_status not in ('active', 'inactive') then
    raise exception 'db_data_admin: invalid app status filter'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_app_status is not null and p_app is null then
    raise exception 'db_data_admin: app status filter requires an app filter'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_sort not in ('name', 'display_name', 'status', 'updated_at') then
    raise exception 'db_data_admin: invalid sort'
      using errcode = 'invalid_parameter_value';
  end if;
  if lower(coalesce(p_sort_dir, 'asc')) not in ('asc', 'desc') then
    raise exception 'db_data_admin: invalid sort direction'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with filtered as (
    select
      c.id,
      case p_sort
        when 'name' then lower(c.name)
        when 'display_name' then lower(coalesce(c.display_name, c.name))
        when 'status' then c.status::text
        when 'updated_at' then to_char(
          c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      end collate "C" as sort_value,
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'display_name', c.display_name,
        'status', c.status::text,
        'is_potential', c.is_potential,
        'domain', c.domain,
        'channels', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', ch.id, 'code', ch.code, 'name', ch.name)
            order by ch.sort_order, lower(ch.name)
          )
          from core.customer_channel cc
          join core.channel ch on ch.id = cc.channel_id
          where cc.customer_id = c.id
        ), '[]'::jsonb),
        'crm_status', coalesce(crmx.status, 'active'::app.entity_status)::text,
        'crm_status_reason', crmx.status_reason,
        'pm_status', coalesce(pimx.status, 'active'::app.entity_status)::text,
        'pm_status_reason', pimx.status_reason,
        'dam_status', coalesce(damx.status, 'active'::app.entity_status)::text,
        'dam_status_reason', damx.status_reason,
        'plm_linked', exists (
          select 1
          from core.company_source_ref plr
          where plr.company_id = c.id
            and plr.source_system = 'designflow_plm'
        ),
        'plm_status', (
          select ci.status
          from plm.customer_import ci
          where ci.company_id = c.id
          order by ci.updated_at desc nulls last
          limit 1
        ),
        'erp_active', (
          select bool_or(e.active)
          from plm.erp_customer e
          where e.customer_id = c.id
        ),
        'alias_count', (
          select count(*)::integer
          from core.customer_alias a
          where a.customer_id = c.id
        ),
        'source_refs', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'source_system', r.source_system,
              'source_table', r.source_table,
              'source_id', r.source_id,
              'source_code', r.source_code,
              'source_name', r.source_name
            )
            order by r.source_system, r.source_table, r.source_id
          )
          from core.company_source_ref r
          where r.company_id = c.id
        ), '[]'::jsonb),
        'updated_at', c.updated_at
      ) as object
    from core.customer c
    left join crm.customer_ext crmx on crmx.customer_id = c.id
    left join pim.customer_ext pimx on pimx.customer_id = c.id
    left join dam.customer_ext damx on damx.customer_id = c.id
    where (
        p_search is null
        or c.name ilike '%' || p_search || '%'
        or c.display_name ilike '%' || p_search || '%'
      )
      and (p_status is null or c.status::text = p_status)
      and (
        p_include_inactive
        or c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
      )
      and (
        p_app_status is null
        or (p_app = 'crm'
            and coalesce(crmx.status, 'active'::app.entity_status)::text = p_app_status)
        or (p_app = 'pm'
            and coalesce(pimx.status, 'active'::app.entity_status)::text = p_app_status)
        or (p_app = 'dam'
            and coalesce(damx.status, 'active'::app.entity_status)::text = p_app_status)
        -- PLM effective status is only meaningful for Customers linked to a
        -- mirrored PLM row; unlinked Customers match neither value.
        or (p_app = 'plm' and p_app_status = 'active' and exists (
          select 1
          from plm.customer_import ci
          where ci.company_id = c.id
            and upper(coalesce(ci.status, '')) = 'ACTIVE'))
        or (p_app = 'plm' and p_app_status = 'inactive' and exists (
          select 1
          from plm.customer_import ci
          where ci.company_id = c.id
            and upper(coalesce(ci.status, '')) <> 'ACTIVE'))
      )
      and (
        p_cursor is null
        or (v_dir_asc and (
          case p_sort
            when 'name' then lower(c.name)
            when 'display_name' then lower(coalesce(c.display_name, c.name))
            when 'status' then c.status::text
            when 'updated_at' then to_char(
              c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          end collate "C",
          c.id::text
        ) > (v_cursor_value, v_cursor_id::text))
        or (not v_dir_asc and (
          case p_sort
            when 'name' then lower(c.name)
            when 'display_name' then lower(coalesce(c.display_name, c.name))
            when 'status' then c.status::text
            when 'updated_at' then to_char(
              c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          end collate "C",
          c.id::text
        ) < (v_cursor_value, v_cursor_id::text))
      )
  ),
  ordered as (
    select f.id, f.sort_value, f.object
    from filtered f
    order by
      case when v_dir_asc then f.sort_value end asc,
      case when v_dir_asc then f.id::text end asc,
      case when not v_dir_asc then f.sort_value end desc,
      case when not v_dir_asc then f.id::text end desc
    limit v_page_size + 1
  ),
  numbered as (
    select
      o.id,
      o.sort_value,
      o.object,
      row_number() over (
        order by
          case when v_dir_asc then o.sort_value end asc,
          case when v_dir_asc then o.id::text end asc,
          case when not v_dir_asc then o.sort_value end desc,
          case when not v_dir_asc then o.id::text end desc
      ) as rn
    from ordered o
  )
  select
    coalesce(
      jsonb_agg(n.object order by n.rn) filter (where n.rn <= v_page_size),
      '[]'::jsonb
    ),
    count(*),
    max(n.sort_value) filter (where n.rn = v_page_size),
    max(n.id) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_sort, v_last_id
  from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(
      convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'),
      'base64'
    );
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$$;

comment on function api.db_data_admin_customer_list(text, text, text, text, boolean, text, text, text, integer) is
  'DB Data Admin only. Canonical Customer grid read with global + per-app status, Channels, alias counts, source refs, and read-only PLM/ERP context. Supports search, global/app status filters, inactive inclusion, whitelisted sorting, and opaque keyset pagination. Returns {rows, next_cursor, page_size}.';

revoke all on function api.db_data_admin_customer_list(text, text, text, text, boolean, text, text, text, integer) from public;
grant execute on function api.db_data_admin_customer_list(text, text, text, text, boolean, text, text, text, integer) to authenticated;

-- Administrator Vendor read contract. The UI entity is Vendor; the canonical
-- table remains core.factory.
create or replace function api.db_data_admin_vendor_list(
  p_search text default null,
  p_status text default null,
  p_app text default null,
  p_app_status text default null,
  p_include_inactive boolean default false,
  p_sort text default 'name',
  p_sort_dir text default 'asc',
  p_cursor text default null,
  p_page_size integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_page_size integer;
  v_dir_asc boolean;
  v_cursor_value text;
  v_cursor_id uuid;
  v_rows jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_db_data_admin_access();

  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_dir_asc := lower(coalesce(p_sort_dir, 'asc')) = 'asc';

  if p_status is not null
     and p_status not in ('active', 'potential', 'inactive', 'archived', 'deleted') then
    raise exception 'db_data_admin: invalid status filter'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_app is not null and p_app not in ('crm', 'pm', 'dam') then
    -- Vendor PLM status cannot ship until the reviewed DesignFlow Factory
    -- export/match populates core.factory_source_ref. Fail closed.
    raise exception 'db_data_admin: plm vendor status is unavailable until DesignFlow Factory mapping exists'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_app_status is not null and p_app_status not in ('active', 'inactive') then
    raise exception 'db_data_admin: invalid app status filter'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_app_status is not null and p_app is null then
    raise exception 'db_data_admin: app status filter requires an app filter'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_sort not in ('name', 'display_name', 'status', 'updated_at') then
    raise exception 'db_data_admin: invalid sort'
      using errcode = 'invalid_parameter_value';
  end if;
  if lower(coalesce(p_sort_dir, 'asc')) not in ('asc', 'desc') then
    raise exception 'db_data_admin: invalid sort direction'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with filtered as (
    select
      f.id,
      case p_sort
        when 'name' then lower(f.name)
        when 'display_name' then lower(coalesce(f.display_name, f.name))
        when 'status' then f.status::text
        when 'updated_at' then to_char(
          f.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      end collate "C" as sort_value,
      jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'display_name', f.display_name,
        'code', f.code,
        'status', f.status::text,
        'country', f.country,
        'vendor_group', f.vendor_group,
        'company_id', f.company_id,
        'company_label', (
          select coalesce(cc.display_name, cc.name)
          from core.customer cc
          where cc.id = f.company_id
        ),
        'crm_status', coalesce(crmx.status, 'active'::app.entity_status)::text,
        'crm_status_reason', crmx.status_reason,
        'pm_status', coalesce(pimx.status, 'active'::app.entity_status)::text,
        'pm_status_reason', pimx.status_reason,
        'dam_status', coalesce(damx.status, 'active'::app.entity_status)::text,
        'dam_status_reason', damx.status_reason,
        'plm_linked', exists (
          select 1
          from core.factory_source_ref plr
          where plr.factory_id = f.id
            and plr.source_system = 'designflow_plm'
        ),
        'plm_status', null::text,
        'erp_active', (
          select bool_or(e.active)
          from plm.erp_vendor e
          where e.factory_id = f.id
        ),
        'alias_count', (
          select count(*)::integer
          from core.factory_alias a
          where a.factory_id = f.id
        ),
        -- core.factory_source_ref has no source_name column; identity is
        -- source_system/source_table/source_id/source_code only.
        'source_refs', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'source_system', r.source_system,
              'source_table', r.source_table,
              'source_id', r.source_id,
              'source_code', r.source_code
            )
            order by r.source_system, r.source_table, r.source_id
          )
          from core.factory_source_ref r
          where r.factory_id = f.id
        ), '[]'::jsonb),
        'updated_at', f.updated_at
      ) as object
    from core.factory f
    left join crm.factory_ext crmx on crmx.factory_id = f.id
    left join pim.factory_ext pimx on pimx.factory_id = f.id
    left join dam.factory_ext damx on damx.factory_id = f.id
    where (
        p_search is null
        or f.name ilike '%' || p_search || '%'
        or f.display_name ilike '%' || p_search || '%'
      )
      and (p_status is null or f.status::text = p_status)
      and (
        p_include_inactive
        or f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
      )
      and (
        p_app_status is null
        or (p_app = 'crm'
            and coalesce(crmx.status, 'active'::app.entity_status)::text = p_app_status)
        or (p_app = 'pm'
            and coalesce(pimx.status, 'active'::app.entity_status)::text = p_app_status)
        or (p_app = 'dam'
            and coalesce(damx.status, 'active'::app.entity_status)::text = p_app_status)
      )
      and (
        p_cursor is null
        or (v_dir_asc and (
          case p_sort
            when 'name' then lower(f.name)
            when 'display_name' then lower(coalesce(f.display_name, f.name))
            when 'status' then f.status::text
            when 'updated_at' then to_char(
              f.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          end collate "C",
          f.id::text
        ) > (v_cursor_value, v_cursor_id::text))
        or (not v_dir_asc and (
          case p_sort
            when 'name' then lower(f.name)
            when 'display_name' then lower(coalesce(f.display_name, f.name))
            when 'status' then f.status::text
            when 'updated_at' then to_char(
              f.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          end collate "C",
          f.id::text
        ) < (v_cursor_value, v_cursor_id::text))
      )
  ),
  ordered as (
    select f.id, f.sort_value, f.object
    from filtered f
    order by
      case when v_dir_asc then f.sort_value end asc,
      case when v_dir_asc then f.id::text end asc,
      case when not v_dir_asc then f.sort_value end desc,
      case when not v_dir_asc then f.id::text end desc
    limit v_page_size + 1
  ),
  numbered as (
    select
      o.id,
      o.sort_value,
      o.object,
      row_number() over (
        order by
          case when v_dir_asc then o.sort_value end asc,
          case when v_dir_asc then o.id::text end asc,
          case when not v_dir_asc then o.sort_value end desc,
          case when not v_dir_asc then o.id::text end desc
      ) as rn
    from ordered o
  )
  select
    coalesce(
      jsonb_agg(n.object order by n.rn) filter (where n.rn <= v_page_size),
      '[]'::jsonb
    ),
    count(*),
    max(n.sort_value) filter (where n.rn = v_page_size),
    max(n.id) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_sort, v_last_id
  from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(
      convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'),
      'base64'
    );
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$$;

comment on function api.db_data_admin_vendor_list(text, text, text, text, boolean, text, text, text, integer) is
  'DB Data Admin only. Canonical Vendor (core.factory) grid read with global + CRM/PM/DAM status, related Customer label, alias counts, and source refs (no source_name; identity is system/table/id/code). PLM vendor status is intentionally null until DesignFlow Factory mapping exists. Returns {rows, next_cursor, page_size}.';

revoke all on function api.db_data_admin_vendor_list(text, text, text, text, boolean, text, text, text, integer) from public;
grant execute on function api.db_data_admin_vendor_list(text, text, text, text, boolean, text, text, text, integer) to authenticated;

-- Administrator Licensor -> Property read contract. Fully read-only in v1:
-- DesignFlow owns the hierarchy. Properties whose licensor_id is null are
-- structurally possible (ON DELETE SET NULL) and expected to be zero; they
-- are surfaced loudly in orphan_properties on every page.
create or replace function api.db_data_admin_licensor_property_list(
  p_search text default null,
  p_include_inactive boolean default false,
  p_cursor text default null,
  p_page_size integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_page_size integer;
  v_cursor_value text;
  v_cursor_id uuid;
  v_orphans jsonb;
  v_licensors jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_db_data_admin_access();

  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 200);

  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- Orphans are an anomaly report: always complete, never filtered.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', op.id,
      'name', op.name,
      'code', op.code,
      'status', op.status::text,
      'licensor_id', null,
      'character_count', (
        select count(*)::integer
        from core.character ch
        where ch.property_id = op.id
      ),
      'source_refs', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'source_system', r.source_system,
            'source_table', r.source_table,
            'source_id', r.source_id,
            'source_code', r.source_code,
            'source_name', r.source_name
          )
          order by r.source_system, r.source_table, r.source_id
        )
        from core.taxonomy_source_ref r
        where r.entity_schema = 'core'
          and r.entity_table = 'property'
          and r.entity_id = op.id
      ), '[]'::jsonb),
      'plm_context', (
        select jsonb_build_object(
          'division_code', pi.division_code,
          'mg_code', pi.mg_code,
          'mg_category', pi.mg_category
        )
        from plm.property_import pi
        where pi.property_id = op.id
        order by pi.imported_at desc nulls last
        limit 1
      )
    )
    order by lower(op.name) collate "C", op.id
  ), '[]'::jsonb)
  into v_orphans
  from core.property op
  where op.licensor_id is null;

  with licensor_match as (
    select
      l.id,
      l.name,
      l.code,
      l.status,
      l.updated_at,
      lower(l.name) collate "C" as sort_value,
      (p_search is null or l.name ilike '%' || p_search || '%') as name_matches
    from core.licensor l
    where (
      p_include_inactive
      or l.status in ('active'::app.entity_status, 'potential'::app.entity_status)
    )
  ),
  licensor_rows as (
    select
      lm.id,
      lm.name,
      lm.code,
      lm.status,
      lm.updated_at,
      lm.sort_value,
      lm.name_matches,
      (
        select count(*)::integer
        from core.property p
        where p.licensor_id = lm.id
          and (
            p_include_inactive
            or p.status in ('active'::app.entity_status, 'potential'::app.entity_status)
          )
      ) as property_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'source_system', r.source_system,
            'source_table', r.source_table,
            'source_id', r.source_id,
            'source_code', r.source_code,
            'source_name', r.source_name
          )
          order by r.source_system, r.source_table, r.source_id
        )
        from core.taxonomy_source_ref r
        where r.entity_schema = 'core'
          and r.entity_table = 'licensor'
          and r.entity_id = lm.id
      ), '[]'::jsonb) as source_refs,
      (
        select jsonb_build_object(
          'division_code', li.division_code,
          'mg_code', li.mg_code,
          'mg_category', li.mg_category
        )
        from plm.licensor_import li
        where li.licensor_id = lm.id
        order by li.imported_at desc nulls last
        limit 1
      ) as plm_context,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'code', p.code,
            'status', p.status::text,
            'licensor_id', p.licensor_id,
            'character_count', (
              select count(*)::integer
              from core.character ch
              where ch.property_id = p.id
            ),
            'source_refs', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'source_system', r.source_system,
                  'source_table', r.source_table,
                  'source_id', r.source_id,
                  'source_code', r.source_code,
                  'source_name', r.source_name
                )
                order by r.source_system, r.source_table, r.source_id
              )
              from core.taxonomy_source_ref r
              where r.entity_schema = 'core'
                and r.entity_table = 'property'
                and r.entity_id = p.id
            ), '[]'::jsonb),
            'plm_context', (
              select jsonb_build_object(
                'division_code', pi.division_code,
                'mg_code', pi.mg_code,
                'mg_category', pi.mg_category
              )
              from plm.property_import pi
              where pi.property_id = p.id
              order by pi.imported_at desc nulls last
              limit 1
            )
          )
          order by lower(p.name) collate "C", p.id
        )
        from core.property p
        where p.licensor_id = lm.id
          and (
            p_include_inactive
            or p.status in ('active'::app.entity_status, 'potential'::app.entity_status)
          )
          and (lm.name_matches or p.name ilike '%' || p_search || '%')
      ), '[]'::jsonb) as properties
    from licensor_match lm
  ),
  qualified as (
    select lr.*
    from licensor_rows lr
    where lr.name_matches
      or exists (
        select 1
        from core.property p2
        where p2.licensor_id = lr.id
          and (
            p_include_inactive
            or p2.status in ('active'::app.entity_status, 'potential'::app.entity_status)
          )
          and p2.name ilike '%' || p_search || '%'
      )
  ),
  cursor_filtered as (
    select q.*
    from qualified q
    where p_cursor is null
      -- Explicit "C" keeps the keyset comparison on the same collation as
      -- the ordering, regardless of the database default collation.
      or (q.sort_value collate "C", q.id::text) > (v_cursor_value, v_cursor_id::text)
  ),
  ordered as (
    select cf.*
    from cursor_filtered cf
    order by cf.sort_value asc, cf.id::text asc
    limit v_page_size + 1
  ),
  numbered as (
    select
      o.*,
      row_number() over (order by o.sort_value asc, o.id::text asc) as rn
    from ordered o
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'name', n.name,
          'code', n.code,
          'status', n.status::text,
          'property_count', n.property_count,
          'source_refs', n.source_refs,
          'plm_context', n.plm_context,
          'properties', n.properties,
          'updated_at', n.updated_at
        )
        order by n.rn
      ) filter (where n.rn <= v_page_size),
      '[]'::jsonb
    ),
    count(*),
    max(n.sort_value) filter (where n.rn = v_page_size),
    max(n.id) filter (where n.rn = v_page_size)
  into v_licensors, v_fetched, v_last_sort, v_last_id
  from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(
      convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'),
      'base64'
    );
  end if;

  return jsonb_build_object(
    'licensors', v_licensors,
    'orphan_properties', v_orphans,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$$;

comment on function api.db_data_admin_licensor_property_list(text, boolean, text, integer) is
  'DB Data Admin only. Read-only Licensor -> Property hierarchy with source context, PLM division/type context, character counts, and loud orphan surfacing. Pages over Licensors by name; orphan_properties is always the complete anomaly list. Returns {licensors, orphan_properties, next_cursor, page_size}.';

revoke all on function api.db_data_admin_licensor_property_list(text, boolean, text, integer) from public;
grant execute on function api.db_data_admin_licensor_property_list(text, boolean, text, integer) to authenticated;

-- Administrator audit read contract over the immutable ledger.
create or replace function api.db_data_admin_audit_list(
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_action text default null,
  p_actor_profile_id uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_cursor text default null,
  p_page_size integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_page_size integer;
  v_cursor_value text;
  v_cursor_id uuid;
  v_rows jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_db_data_admin_access();

  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 200);

  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with filtered as (
    select
      e.id,
      to_char(
        e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) collate "C" as sort_value,
      jsonb_build_object(
        'id', e.id,
        'operation_id', e.operation_id,
        'operation_item_key', e.operation_item_key,
        'entity_type', e.entity_type,
        'entity_id', e.entity_id,
        'action', e.action,
        'old_snapshot', e.old_snapshot,
        'new_snapshot', e.new_snapshot,
        'reason', e.reason,
        'actor_profile_id', e.actor_profile_id,
        'actor_user_id', e.actor_user_id,
        'occurred_at', e.occurred_at,
        'merge_survivor_id', e.merge_survivor_id,
        'merge_loser_id', e.merge_loser_id,
        'succeeded', e.succeeded,
        'error_code', e.error_code,
        'error_detail', e.error_detail
      ) as object
    from app.db_data_admin_audit_event e
    where (p_entity_type is null or e.entity_type = p_entity_type)
      and (p_entity_id is null or e.entity_id = p_entity_id)
      and (p_action is null or e.action = p_action)
      and (p_actor_profile_id is null or e.actor_profile_id = p_actor_profile_id)
      and (p_since is null or e.occurred_at >= p_since)
      and (p_until is null or e.occurred_at <= p_until)
      and (
        p_cursor is null
        or (
          to_char(
            e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) collate "C",
          e.id::text
        ) < (v_cursor_value, v_cursor_id::text)
      )
  ),
  ordered as (
    select f.id, f.sort_value, f.object
    from filtered f
    order by f.sort_value desc, f.id::text desc
    limit v_page_size + 1
  ),
  numbered as (
    select
      o.id,
      o.sort_value,
      o.object,
      row_number() over (order by o.sort_value desc, o.id::text desc) as rn
    from ordered o
  )
  select
    coalesce(
      jsonb_agg(n.object order by n.rn) filter (where n.rn <= v_page_size),
      '[]'::jsonb
    ),
    count(*),
    max(n.sort_value) filter (where n.rn = v_page_size),
    max(n.id) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_sort, v_last_id
  from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(
      convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'),
      'base64'
    );
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$$;

comment on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) is
  'DB Data Admin only. Newest-first read over the immutable audit ledger with entity/action/actor/time filters and opaque keyset pagination. Returns {rows, next_cursor, page_size}.';

revoke all on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) from public;
grant execute on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) to authenticated;

-- Per-user grid state: owner-scoped get. The storage table has no browser
-- grants and no policies; these functions are the only access path and never
-- accept a profile id parameter.
create or replace function api.db_data_admin_grid_state_get(
  p_entity_type text,
  p_view_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_profile uuid;
  v_state jsonb;
  v_version bigint;
  v_updated_at timestamptz;
begin
  perform app.require_db_data_admin_access();

  if nullif(btrim(coalesce(p_entity_type, '')), '') is null
     or nullif(btrim(coalesce(p_view_key, '')), '') is null then
    raise exception 'db_data_admin: entity_type and view_key are required'
      using errcode = 'invalid_parameter_value';
  end if;

  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception 'db_data_admin: no profile for current session'
      using errcode = 'insufficient_privilege';
  end if;

  select gs.state, gs.version, gs.updated_at
  into v_state, v_version, v_updated_at
  from app.db_data_admin_grid_state gs
  where gs.profile_id = v_profile
    and gs.entity_type = p_entity_type
    and gs.view_key = p_view_key;

  if v_version is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'state', v_state,
    'version', v_version,
    'updated_at', v_updated_at
  );
end;
$$;

comment on function api.db_data_admin_grid_state_get(text, text) is
  'DB Data Admin only. Returns the calling profile''s saved grid state for (entity_type, view_key): {found, state, version, updated_at}. Never reads another profile''s state.';

revoke all on function api.db_data_admin_grid_state_get(text, text) from public;
grant execute on function api.db_data_admin_grid_state_get(text, text) to authenticated;

-- Per-user grid state: owner-scoped upsert with optimistic concurrency.
create or replace function api.db_data_admin_grid_state_upsert(
  p_entity_type text,
  p_view_key text,
  p_state jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_profile uuid;
  v_version bigint;
begin
  perform app.require_db_data_admin_access();

  if nullif(btrim(coalesce(p_entity_type, '')), '') is null
     or nullif(btrim(coalesce(p_view_key, '')), '') is null then
    raise exception 'db_data_admin: entity_type and view_key are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'db_data_admin: state must be a jsonb object'
      using errcode = 'invalid_parameter_value';
  end if;

  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception 'db_data_admin: no profile for current session'
      using errcode = 'insufficient_privilege';
  end if;

  -- Create the owner row if missing; FOUND distinguishes a first save from
  -- an existing row without a read-before-write race.
  insert into app.db_data_admin_grid_state (profile_id, entity_type, view_key, state)
  values (v_profile, p_entity_type, p_view_key, p_state)
  on conflict (profile_id, entity_type, view_key) do nothing;

  if found then
    if p_expected_version is not null and p_expected_version <> 1 then
      return jsonb_build_object(
        'ok', false,
        'code', 'version_conflict',
        'current_version', 1
      );
    end if;
    return jsonb_build_object('ok', true, 'version', 1, 'state', p_state);
  end if;

  select gs.version
  into v_version
  from app.db_data_admin_grid_state gs
  where gs.profile_id = v_profile
    and gs.entity_type = p_entity_type
    and gs.view_key = p_view_key
  for update;

  if p_expected_version is not null and v_version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'version_conflict',
      'current_version', v_version
    );
  end if;

  update app.db_data_admin_grid_state gs
  set state = p_state,
      version = gs.version + 1
  where gs.profile_id = v_profile
    and gs.entity_type = p_entity_type
    and gs.view_key = p_view_key;

  return jsonb_build_object(
    'ok', true,
    'version', v_version + 1,
    'state', p_state
  );
end;
$$;

comment on function api.db_data_admin_grid_state_upsert(text, text, jsonb, bigint) is
  'DB Data Admin only. Saves the calling profile''s grid state for (entity_type, view_key). First save creates version 1; later saves bump the version. When p_expected_version is given and stale, returns {ok:false, code:"version_conflict", current_version} instead of writing. On success returns {ok:true, version, state}.';

revoke all on function api.db_data_admin_grid_state_upsert(text, text, jsonb, bigint) from public;
grant execute on function api.db_data_admin_grid_state_upsert(text, text, jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
