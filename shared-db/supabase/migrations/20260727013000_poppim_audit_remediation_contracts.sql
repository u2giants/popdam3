-- Add bounded, RLS-preserving PM pipeline reads and atomic PM mutations.
-- These contracts are additive; existing tables and api.pm_product_board remain
-- available while Poppim adopts the new RPCs.

create index if not exists pim_product_pipeline_keyset_idx
  on pim.product (
    lower(coalesce(metadata ->> 'business_unit', metadata ->> 'department')),
    updated_at desc,
    id desc
  )
  where clickup_parent_id is null
    and lower(coalesce(metadata ->> 'clickup_status_type', metadata ->> 'status_type', ''))
      in ('open', 'custom');

create or replace function api.pm_pipeline_page(
  p_business_unit text,
  p_search text default null,
  p_licensor_ids uuid[] default null,
  p_list_names text[] default null,
  p_lifecycle_states text[] default null,
  p_limit integer default 50,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  code text,
  name text,
  status text,
  stage text,
  lifecycle_status text,
  cover_url text,
  project_id uuid,
  project_title text,
  company_id uuid,
  company_name text,
  buyer_contact_id uuid,
  buyer_name text,
  factory_id uuid,
  factory_name text,
  licensor_id uuid,
  licensor_name text,
  property_id uuid,
  property_name text,
  product_type_id uuid,
  product_type_name text,
  plm_item_id uuid,
  plm_item_number text,
  clickup_task_id text,
  updated_at timestamptz,
  clickup_parent_id text,
  clickup_status text,
  clickup_status_type text,
  clickup_status_color text,
  clickup_status_order numeric,
  clickup_folder_name text,
  clickup_list_name text,
  clickup_time_estimate_ms bigint,
  clickup_orderindex text,
  business_unit text,
  next_action text,
  next_owner_name text,
  next_owner_role_name text,
  waiting_on text,
  blocker_reason text,
  risk_level text,
  pps_requested_date text,
  on_shelf_date text,
  pi_status text,
  brand_assurance_number text,
  closure_reason text,
  description text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, api, pim, core, plm
as $$
declare
  v_business_units text[];
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_search text := nullif(btrim(p_search), '');
begin
  if p_business_unit is null or btrim(p_business_unit) = '' then
    raise exception using
      errcode = '22023',
      message = 'PM_PIPELINE_BUSINESS_UNIT_REQUIRED';
  end if;

  case lower(btrim(p_business_unit))
    when 'licensed' then v_business_units := array['licensed', 'pop', 'pop creations'];
    when 'generic' then v_business_units := array['generic', 'spruce', 'spruce line'];
    when 'software' then v_business_units := array['software'];
    else
      raise exception using
        errcode = '22023',
        message = 'PM_PIPELINE_BUSINESS_UNIT_INVALID';
  end case;

  if (p_after_updated_at is null) <> (p_after_id is null) then
    raise exception using
      errcode = '22023',
      message = 'PM_PIPELINE_CURSOR_INCOMPLETE';
  end if;

  return query
  select
    p.id,
    p.code,
    p.name,
    p.status,
    p.stage,
    p.lifecycle_status,
    p.cover_url,
    p.project_id,
    pr.title,
    p.company_id,
    c.name,
    p.buyer_contact_id,
    coalesce(ct.full_name, concat_ws(' ', ct.first_name, ct.last_name)),
    p.factory_id,
    f.name,
    p.licensor_id,
    l.name,
    p.property_id,
    prop.name,
    p.product_type_id,
    pt.name,
    p.plm_item_id,
    i.item_number,
    p.clickup_task_id,
    p.updated_at,
    p.clickup_parent_id,
    p.clickup_status,
    coalesce(p.metadata ->> 'clickup_status_type', p.metadata ->> 'status_type'),
    p.metadata ->> 'clickup_status_color',
    nullif(p.metadata ->> 'clickup_status_order', '')::numeric,
    p.metadata ->> 'clickup_folder_name',
    p.metadata ->> 'clickup_list_name',
    nullif(p.metadata ->> 'clickup_time_estimate_ms', '')::bigint,
    p.metadata ->> 'clickup_orderindex',
    coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department'),
    p.metadata ->> 'next_action',
    p.metadata ->> 'next_owner_name',
    p.metadata ->> 'next_owner_role_name',
    p.metadata ->> 'waiting_on',
    p.metadata ->> 'blocker_reason',
    p.metadata ->> 'risk_level',
    p.metadata ->> 'pps_requested_date',
    p.metadata ->> 'on_shelf_date',
    p.metadata ->> 'pi_status',
    p.metadata ->> 'brand_assurance_number',
    p.metadata ->> 'closure_reason',
    p.metadata ->> 'description',
    p.created_at
  from pim.product p
  left join pim.project pr on pr.id = p.project_id
  left join core.customer c on c.id = p.company_id
  left join core.contact ct on ct.id = p.buyer_contact_id
  left join core.factory f on f.id = p.factory_id
  left join core.licensor l on l.id = p.licensor_id
  left join core.property prop on prop.id = p.property_id
  left join core.product_type pt on pt.id = p.product_type_id
  left join plm.item i on i.id = p.plm_item_id
  where p.clickup_parent_id is null
    and lower(coalesce(p.metadata ->> 'clickup_status_type', p.metadata ->> 'status_type', ''))
      in ('open', 'custom')
    and lower(coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department', ''))
      = any(v_business_units)
    and (
      v_search is null
      or concat_ws(
        ' ',
        p.name,
        p.code,
        pr.title,
        c.name,
        l.name,
        p.metadata ->> 'clickup_list_name'
      ) ilike '%' || v_search || '%'
    )
    and (
      coalesce(cardinality(p_licensor_ids), 0) = 0
      or p.licensor_id = any(p_licensor_ids)
    )
    and (
      coalesce(cardinality(p_list_names), 0) = 0
      or p.metadata ->> 'clickup_list_name' = any(p_list_names)
    )
    and (
      coalesce(cardinality(p_lifecycle_states), 0) = 0
      or p.lifecycle_status = any(p_lifecycle_states)
    )
    and (
      p_after_updated_at is null
      or (p.updated_at, p.id) < (p_after_updated_at, p_after_id)
    )
  order by p.updated_at desc, p.id desc
  limit v_limit;
end;
$$;

create or replace function api.pm_pipeline_count(
  p_business_unit text,
  p_search text default null,
  p_licensor_ids uuid[] default null,
  p_list_names text[] default null,
  p_lifecycle_states text[] default null
)
returns bigint
language plpgsql
stable
security invoker
set search_path = pg_catalog, pim, core
as $$
declare
  v_business_units text[];
  v_search text := nullif(btrim(p_search), '');
  v_count bigint;
begin
  if p_business_unit is null or btrim(p_business_unit) = '' then
    raise exception using errcode = '22023', message = 'PM_PIPELINE_BUSINESS_UNIT_REQUIRED';
  end if;

  case lower(btrim(p_business_unit))
    when 'licensed' then v_business_units := array['licensed', 'pop', 'pop creations'];
    when 'generic' then v_business_units := array['generic', 'spruce', 'spruce line'];
    when 'software' then v_business_units := array['software'];
    else
      raise exception using errcode = '22023', message = 'PM_PIPELINE_BUSINESS_UNIT_INVALID';
  end case;

  select count(*)
  into v_count
  from pim.product p
  left join pim.project pr on pr.id = p.project_id
  left join core.customer c on c.id = p.company_id
  left join core.licensor l on l.id = p.licensor_id
  where p.clickup_parent_id is null
    and lower(coalesce(p.metadata ->> 'clickup_status_type', p.metadata ->> 'status_type', ''))
      in ('open', 'custom')
    and lower(coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department', ''))
      = any(v_business_units)
    and (
      v_search is null
      or concat_ws(
        ' ',
        p.name,
        p.code,
        pr.title,
        c.name,
        l.name,
        p.metadata ->> 'clickup_list_name'
      ) ilike '%' || v_search || '%'
    )
    and (
      coalesce(cardinality(p_licensor_ids), 0) = 0
      or p.licensor_id = any(p_licensor_ids)
    )
    and (
      coalesce(cardinality(p_list_names), 0) = 0
      or p.metadata ->> 'clickup_list_name' = any(p_list_names)
    )
    and (
      coalesce(cardinality(p_lifecycle_states), 0) = 0
      or p.lifecycle_status = any(p_lifecycle_states)
    );

  return v_count;
end;
$$;

-- Facets intentionally represent the complete eligible department, independent
-- of active search/licensor/lifecycle filters. They populate the stable sidebar
-- navigation and are optional supporting data for the primary list.
create or replace function api.pm_pipeline_list_facets(
  p_business_unit text
)
returns table (
  folder_name text,
  list_name text,
  product_count bigint
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pim
as $$
declare
  v_business_units text[];
begin
  if p_business_unit is null or btrim(p_business_unit) = '' then
    raise exception using
      errcode = '22023',
      message = 'PM_PIPELINE_BUSINESS_UNIT_REQUIRED';
  end if;

  case lower(btrim(p_business_unit))
    when 'licensed' then v_business_units := array['licensed', 'pop', 'pop creations'];
    when 'generic' then v_business_units := array['generic', 'spruce', 'spruce line'];
    when 'software' then v_business_units := array['software'];
    else
      raise exception using
        errcode = '22023',
        message = 'PM_PIPELINE_BUSINESS_UNIT_INVALID';
  end case;

  return query
  select
    p.metadata ->> 'clickup_folder_name',
    p.metadata ->> 'clickup_list_name',
    count(*)
  from pim.product p
  where p.clickup_parent_id is null
    and lower(coalesce(p.metadata ->> 'clickup_status_type', p.metadata ->> 'status_type', ''))
      in ('open', 'custom')
    and lower(coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department', ''))
      = any(v_business_units)
    and nullif(p.metadata ->> 'clickup_list_name', '') is not null
  group by
    p.metadata ->> 'clickup_folder_name',
    p.metadata ->> 'clickup_list_name'
  order by count(*) desc, p.metadata ->> 'clickup_list_name';
end;
$$;

create or replace function api.pm_set_product_stage(
  p_product_id uuid,
  p_target_stage_id uuid
)
returns table (
  id uuid,
  name text,
  stage text,
  lifecycle_status text,
  updated_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, api, pim, app
as $$
declare
  v_product pim.product%rowtype;
  v_target pim.stage%rowtype;
  v_from_stage_id uuid;
  v_product_pipeline text;
begin
  select *
  into v_product
  from pim.product
  where pim.product.id = p_product_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;

  select *
  into v_target
  from pim.stage
  where pim.stage.id = p_target_stage_id;

  if not found then
    raise exception using errcode = '22023', message = 'PM_TARGET_STAGE_INVALID';
  end if;

  v_product_pipeline :=
    case lower(coalesce(v_product.metadata ->> 'business_unit', v_product.metadata ->> 'department', ''))
      when 'licensed' then 'POP Creations'
      when 'pop' then 'POP Creations'
      when 'pop creations' then 'POP Creations'
      when 'generic' then 'Spruce Line'
      when 'spruce' then 'Spruce Line'
      when 'spruce line' then 'Spruce Line'
      when 'software' then 'Software'
      else null
    end;

  if v_product_pipeline is null or v_target.pipeline <> v_product_pipeline then
    raise exception using
      errcode = '22023',
      message = 'PM_TARGET_STAGE_WRONG_PIPELINE';
  end if;

  if v_product.stage is not distinct from v_target.name then
    return query
    select v_product.id, v_product.name, v_product.stage,
      v_product.lifecycle_status, v_product.updated_at;
    return;
  end if;

  select s.id
  into v_from_stage_id
  from pim.stage s
  where s.pipeline = v_product_pipeline
    and s.name = v_product.stage;

  update pim.product p
  set stage = v_target.name,
      updated_at = clock_timestamp()
  where p.id = v_product.id
  returning p.* into v_product;

  insert into pim.stage_history (
    product_id,
    project_id,
    from_stage_id,
    to_stage_id,
    changed_by_profile_id,
    metadata
  )
  values (
    v_product.id,
    v_product.project_id,
    v_from_stage_id,
    v_target.id,
    app.current_profile_id(),
    jsonb_build_object('source', 'poppim', 'contract', 'pm_set_product_stage')
  );

  return query
  select v_product.id, v_product.name, v_product.stage,
    v_product.lifecycle_status, v_product.updated_at;
end;
$$;

create or replace function api.pm_patch_product_metadata(
  p_product_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz default null
)
returns table (
  id uuid,
  metadata jsonb,
  updated_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pim
as $$
declare
  v_product pim.product%rowtype;
  v_forbidden_keys constant text[] := array[
    'id', 'name', 'status', 'stage', 'lifecycle_status', 'cover_url',
    'project_id', 'design_id', 'plm_item_id', 'company_id',
    'buyer_contact_id', 'factory_id', 'licensor_id', 'property_id',
    'product_type_id', 'external_source', 'external_id', 'clickup_task_id',
    'clickup_parent_id', 'clickup_status', 'metadata', 'created_at', 'updated_at'
  ];
  v_key text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'PM_METADATA_PATCH_OBJECT_REQUIRED';
  end if;

  select key
  into v_key
  from jsonb_object_keys(p_patch) key
  where key = any(v_forbidden_keys)
  limit 1;

  if v_key is not null then
    raise exception using
      errcode = '22023',
      message = 'PM_METADATA_PATCH_FORBIDDEN_KEY',
      detail = v_key;
  end if;

  select *
  into v_product
  from pim.product
  where pim.product.id = p_product_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;

  if p_expected_updated_at is not null
    and v_product.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'PM_METADATA_CONFLICT',
      detail = v_product.updated_at::text;
  end if;

  update pim.product p
  set metadata = p.metadata || p_patch,
      updated_at = clock_timestamp()
  where p.id = v_product.id
  returning p.* into v_product;

  return query
  select v_product.id, v_product.metadata, v_product.updated_at;
end;
$$;

create or replace function api.pm_upsert_view_pref(
  p_scope text,
  p_patch jsonb
)
returns table (
  id uuid,
  profile_id uuid,
  scope text,
  config jsonb,
  updated_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pim, app
as $$
declare
  v_profile_id uuid := app.current_profile_id();
begin
  if v_profile_id is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  if p_scope is null or p_scope !~ '^view:[0-9a-fA-F-]{36}$' then
    raise exception using errcode = '22023', message = 'PM_VIEW_PREF_SCOPE_INVALID';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'PM_VIEW_PREF_PATCH_OBJECT_REQUIRED';
  end if;

  return query
  insert into pim.view_pref as pref (profile_id, scope, config, updated_at)
  values (v_profile_id, p_scope, p_patch, clock_timestamp())
  on conflict (profile_id, scope) do update
  set config = pref.config || excluded.config,
      updated_at = excluded.updated_at
  returning pref.id, pref.profile_id, pref.scope, pref.config, pref.updated_at;
end;
$$;

revoke all on function api.pm_pipeline_page(
  text, text, uuid[], text[], text[], integer, timestamptz, uuid
) from public, anon;
revoke all on function api.pm_pipeline_count(
  text, text, uuid[], text[], text[]
) from public, anon;
revoke all on function api.pm_pipeline_list_facets(text) from public, anon;
revoke all on function api.pm_set_product_stage(uuid, uuid) from public, anon;
revoke all on function api.pm_patch_product_metadata(uuid, jsonb, timestamptz) from public, anon;
revoke all on function api.pm_upsert_view_pref(text, jsonb) from public, anon;

grant execute on function api.pm_pipeline_page(
  text, text, uuid[], text[], text[], integer, timestamptz, uuid
) to authenticated;
grant execute on function api.pm_pipeline_count(
  text, text, uuid[], text[], text[]
) to authenticated;
grant execute on function api.pm_pipeline_list_facets(text) to authenticated;
grant execute on function api.pm_set_product_stage(uuid, uuid) to authenticated;
grant execute on function api.pm_patch_product_metadata(uuid, jsonb, timestamptz) to authenticated;
grant execute on function api.pm_upsert_view_pref(text, jsonb) to authenticated;

comment on function api.pm_pipeline_page(
  text, text, uuid[], text[], text[], integer, timestamptz, uuid
) is 'RLS-preserving PM pipeline keyset page. Department and eligibility filters run before the bounded limit; exact count is deliberately separate.';
comment on function api.pm_pipeline_count(
  text, text, uuid[], text[], text[]
) is 'Optional exact PM pipeline count with the same filter semantics as pm_pipeline_page.';
comment on function api.pm_pipeline_list_facets(text) is
  'Optional PM folder/list facets for the full eligible department, independent of active search/licensor/lifecycle filters.';
comment on function api.pm_set_product_stage(uuid, uuid) is
  'Atomically validates a department-specific stage UUID, updates the product stage, and records stage history. No-op transitions do not add history.';
comment on function api.pm_patch_product_metadata(uuid, jsonb, timestamptz) is
  'Atomically merges PM product metadata and optionally rejects stale updated_at versions with PM_METADATA_CONFLICT.';
comment on function api.pm_upsert_view_pref(text, jsonb) is
  'Atomically merges the current profile saved-view preference using the existing unique (profile_id, scope) constraint.';
