-- Complete the preview-only DB Data Admin read contract before the first grid
-- consumes it. The Customer list has no production or application consumers;
-- replace its signature atomically to add Channel filtering without leaving a
-- PostgREST overload or a parallel buggy contract.

create or replace function app.db_data_admin_latest_plm_customer_status(
  p_company_id uuid
)
returns text
language sql
stable
security definer
set search_path = app, public
as $$
  select ci.status
  from plm.customer_import ci
  where ci.company_id = p_company_id
  order by
    ci.updated_at desc nulls last,
    ci.imported_at desc nulls last,
    ci.plm_customer_id desc
  limit 1;
$$;

comment on function app.db_data_admin_latest_plm_customer_status(uuid) is
  'Private DB Data Admin helper. Returns the one deterministic latest mirrored PLM Customer status; NULL means unknown/unavailable, not inactive.';

revoke all on function app.db_data_admin_latest_plm_customer_status(uuid) from public;
revoke all on function app.db_data_admin_latest_plm_customer_status(uuid) from authenticated;

drop function api.db_data_admin_customer_list(
  text, text, text, text, boolean, text, text, text, integer
);

create function api.db_data_admin_customer_list(
  p_search text default null,
  p_status text default null,
  p_app text default null,
  p_app_status text default null,
  p_include_inactive boolean default false,
  p_sort text default 'name',
  p_sort_dir text default 'asc',
  p_cursor text default null,
  p_page_size integer default null,
  p_channel_id uuid default null
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
        'plm_status', app.db_data_admin_latest_plm_customer_status(c.id),
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
        p_channel_id is null
        or exists (
          select 1
          from core.customer_channel cc
          where cc.customer_id = c.id
            and cc.channel_id = p_channel_id
        )
      )
      and (
        p_app_status is null
        or (p_app = 'crm'
            and coalesce(crmx.status, 'active'::app.entity_status)::text = p_app_status)
        or (p_app = 'pm'
            and coalesce(pimx.status, 'active'::app.entity_status)::text = p_app_status)
        or (p_app = 'dam'
            and coalesce(damx.status, 'active'::app.entity_status)::text = p_app_status)
        or (p_app = 'plm' and p_app_status = 'active'
            and upper(coalesce(app.db_data_admin_latest_plm_customer_status(c.id), '')) = 'ACTIVE')
        or (p_app = 'plm' and p_app_status = 'inactive'
            and app.db_data_admin_latest_plm_customer_status(c.id) is not null
            and upper(app.db_data_admin_latest_plm_customer_status(c.id)) <> 'ACTIVE')
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
    (max(n.id::text) filter (where n.rn = v_page_size))::uuid
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

comment on function api.db_data_admin_customer_list(
  text, text, text, text, boolean, text, text, text, integer, uuid
) is
  'DB Data Admin only. Canonical Customer grid read with deterministic latest PLM status and Channel filtering. NULL PLM status is unknown and matches neither active nor inactive.';

revoke all on function api.db_data_admin_customer_list(
  text, text, text, text, boolean, text, text, text, integer, uuid
) from public;
grant execute on function api.db_data_admin_customer_list(
  text, text, text, text, boolean, text, text, text, integer, uuid
) to authenticated;

create or replace function api.db_data_admin_customer_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_result jsonb;
begin
  perform app.require_db_data_admin_access();
  if p_id is null then
    raise exception 'db_data_admin: customer id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'aliases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alias', a.alias,
        'alias_type', a.alias_type,
        'source_system', a.source_system,
        'notes', a.notes,
        'created_at', a.created_at
      ) order by lower(a.alias), a.id)
      from core.customer_alias a
      where a.customer_id = c.id
    ), '[]'::jsonb),
    'source_refs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_system', r.source_system,
        'source_table', r.source_table,
        'source_id', r.source_id,
        'source_code', r.source_code,
        'source_name', r.source_name,
        'confidence', r.confidence,
        'created_at', r.created_at
      ) order by r.source_system, r.source_table, r.source_id)
      from core.company_source_ref r
      where r.company_id = c.id
    ), '[]'::jsonb)
  ) into v_result
  from core.customer c
  where c.id = p_id;

  if v_result is null then
    raise exception 'db_data_admin: customer not found'
      using errcode = 'invalid_parameter_value';
  end if;
  return v_result;
end;
$$;

comment on function api.db_data_admin_customer_detail(uuid) is
  'DB Data Admin only. Read-only Customer aliases and source references loaded on demand for the detail panel.';
revoke all on function api.db_data_admin_customer_detail(uuid) from public;
grant execute on function api.db_data_admin_customer_detail(uuid) to authenticated;

create or replace function api.db_data_admin_vendor_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_result jsonb;
begin
  perform app.require_db_data_admin_access();
  if p_id is null then
    raise exception 'db_data_admin: vendor id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object(
    'id', f.id,
    'aliases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alias', a.alias,
        'alias_type', a.alias_type,
        'source_system', a.source_system,
        'notes', a.notes,
        'created_at', a.created_at
      ) order by lower(a.alias), a.id)
      from core.factory_alias a
      where a.factory_id = f.id
    ), '[]'::jsonb),
    'source_refs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_system', r.source_system,
        'source_table', r.source_table,
        'source_id', r.source_id,
        'source_code', r.source_code,
        'confidence', r.confidence,
        'created_at', r.created_at
      ) order by r.source_system, r.source_table, r.source_id)
      from core.factory_source_ref r
      where r.factory_id = f.id
    ), '[]'::jsonb)
  ) into v_result
  from core.factory f
  where f.id = p_id;

  if v_result is null then
    raise exception 'db_data_admin: vendor not found'
      using errcode = 'invalid_parameter_value';
  end if;
  return v_result;
end;
$$;

comment on function api.db_data_admin_vendor_detail(uuid) is
  'DB Data Admin only. Read-only Vendor aliases and source references loaded on demand for the detail panel.';
revoke all on function api.db_data_admin_vendor_detail(uuid) from public;
grant execute on function api.db_data_admin_vendor_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
