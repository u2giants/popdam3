do $migration$
begin
if to_regclass('plm.style_tracker_value_resolution') is null
  or to_regclass('plm.style_tracker_item_bridge') is null
  or to_regclass('public.style_tracker_rows') is null then
  raise notice 'Skipping Master Data designer resolution migration because style tracker bridge objects are absent in this database.';
else
execute $ddl$

alter table plm.style_tracker_value_resolution
  drop constraint if exists style_tracker_value_resolution_field_key_check;

alter table plm.style_tracker_value_resolution
  add constraint style_tracker_value_resolution_field_key_check
  check (field_key = any (array['sku', 'customer', 'licensor', 'designer', 'factory']::text[]));

alter table plm.style_tracker_item_bridge
  add column if not exists creative_designer_id uuid references core.creative_designer(id) on delete set null;

create index if not exists idx_style_tracker_item_bridge_creative_designer
  on plm.style_tracker_item_bridge (creative_designer_id)
  where creative_designer_id is not null;

create or replace function plm.apply_style_tracker_designer_resolutions()
returns integer
language plpgsql
security definer
set search_path = public, plm, core
as $function$
declare
  v_updated integer;
begin
  with row_values as (
    select
      b.id as bridge_id,
      lower(regexp_replace(btrim(r.designer), '\s+', ' ', 'g')) as designer_norm
    from plm.style_tracker_item_bridge b
    join public.style_tracker_rows r on r.id = b.style_tracker_row_id
    where nullif(btrim(r.designer), '') is not null
  ),
  unique_first_names as (
    select split_part(normalized_name, ' ', 1) as first_name
    from core.creative_designer
    where status = 'active'
    group by split_part(normalized_name, ' ', 1)
    having count(*) = 1
  ),
  automatic_matches as (
    select distinct on (rv.bridge_id)
      rv.bridge_id,
      cd.id,
      cd.name
    from row_values rv
    join core.creative_designer cd
      on cd.status = 'active'
     and (
       cd.normalized_name = rv.designer_norm
       or (
         rv.designer_norm = split_part(cd.normalized_name, ' ', 1)
         and exists (
           select 1
           from unique_first_names u
           where u.first_name = rv.designer_norm
         )
       )
     )
    order by rv.bridge_id, cd.name
  ),
  resolved as (
    select
      rv.bridge_id,
      res.resolution_type,
      res.target_schema,
      res.target_table,
      res.target_id,
      res.target_label,
      res.local_value,
      case
        when res.resolution_type = 'canonical'
          and res.target_schema = 'core'
          and res.target_table = 'creative_designer'
          then res.target_id
        when res.id is null then am.id
        else null
      end as creative_designer_id,
      case
        when res.resolution_type = 'canonical'
          and res.target_schema = 'core'
          and res.target_table = 'creative_designer'
          then res.target_label
        when res.id is null then am.name
        else null
      end as creative_designer_name
    from row_values rv
    left join plm.style_tracker_value_resolution res
      on res.field_key = 'designer'
     and res.normalized_value = rv.designer_norm
    left join automatic_matches am
      on am.bridge_id = rv.bridge_id
  )
  update plm.style_tracker_item_bridge b
  set
    creative_designer_id = resolved.creative_designer_id,
    match_notes = case
      when resolved.resolution_type is null then
        case
          when b.match_notes->'manual_resolution'->>'field_key' = 'designer'
            then (coalesce(b.match_notes, '{}'::jsonb) - 'manual_resolution') #- '{manual_resolutions,designer}'
          else coalesce(b.match_notes, '{}'::jsonb) #- '{manual_resolutions,designer}'
        end
      else
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(b.match_notes, '{}'::jsonb),
              '{manual_resolutions}',
              coalesce(b.match_notes->'manual_resolutions', '{}'::jsonb),
              true
            ),
            '{manual_resolutions,designer}',
            jsonb_strip_nulls(jsonb_build_object(
              'field_key', 'designer',
              'resolution_type', resolved.resolution_type,
              'target_schema', resolved.target_schema,
              'target_table', resolved.target_table,
              'target_id', resolved.target_id,
              'target_label', resolved.target_label,
              'local_value', resolved.local_value
            )),
            true
          ),
          '{manual_resolution}',
          jsonb_strip_nulls(jsonb_build_object(
            'field_key', 'designer',
            'resolution_type', resolved.resolution_type,
            'target_schema', resolved.target_schema,
            'target_table', resolved.target_table,
            'target_id', resolved.target_id,
            'target_label', resolved.target_label,
            'local_value', resolved.local_value
          )),
          true
        )
    end,
    match_status = case
      when resolved.creative_designer_id is not null and b.match_status = 'unmatched' then 'partial'
      when resolved.resolution_type = 'master_data' and b.match_status = 'unmatched' then 'partial'
      else b.match_status
    end,
    match_confidence = case
      when resolved.creative_designer_id is not null and b.match_confidence = 'possible' then 'verified'
      when resolved.resolution_type = 'master_data' and b.match_confidence = 'possible' then 'verified'
      else b.match_confidence
    end,
    last_matched_at = case
      when b.creative_designer_id is distinct from resolved.creative_designer_id then now()
      else b.last_matched_at
    end
  from resolved
  where b.id = resolved.bridge_id
    and (
      b.creative_designer_id is distinct from resolved.creative_designer_id
      or (
        resolved.resolution_type is not null
        and coalesce(b.match_notes->'manual_resolutions'->'designer', '{}'::jsonb) is distinct from jsonb_strip_nulls(jsonb_build_object(
          'field_key', 'designer',
          'resolution_type', resolved.resolution_type,
          'target_schema', resolved.target_schema,
          'target_table', resolved.target_table,
          'target_id', resolved.target_id,
          'target_label', resolved.target_label,
          'local_value', resolved.local_value
        ))
      )
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;

create or replace function public.refresh_style_tracker_item_bridge()
returns table(inserted_count integer, updated_count integer, total_count integer)
language plpgsql
security definer
set search_path = public, plm
as $function$
declare
  v_result record;
  v_designer_updated integer;
begin
  select * into v_result from plm.refresh_style_tracker_item_bridge();
  v_designer_updated := plm.apply_style_tracker_designer_resolutions();

  inserted_count := v_result.inserted_count;
  updated_count := v_result.updated_count + v_designer_updated;
  total_count := v_result.total_count;
  return next;
end;
$function$;

create or replace function public.upsert_style_tracker_value_resolution(
  p_field_key text,
  p_raw_value text,
  p_resolution_type text,
  p_target_schema text default null,
  p_target_table text default null,
  p_target_id uuid default null,
  p_target_label text default null,
  p_local_value text default null
)
returns plm.style_tracker_value_resolution
language plpgsql
security definer
set search_path = public, plm
as $function$
declare
  v_resolution plm.style_tracker_value_resolution;
  v_normalized text;
  v_manual jsonb;
begin
  if p_field_key not in ('sku', 'customer', 'licensor', 'designer', 'factory') then
    raise exception 'Unsupported field_key: %', p_field_key;
  end if;

  if nullif(trim(coalesce(p_raw_value, '')), '') is null then
    raise exception 'raw_value is required';
  end if;

  v_normalized := plm.normalize_style_tracker_value(p_field_key, p_raw_value);
  v_manual := jsonb_strip_nulls(jsonb_build_object(
    'field_key', p_field_key,
    'resolution_type', p_resolution_type,
    'target_schema', p_target_schema,
    'target_table', p_target_table,
    'target_id', p_target_id,
    'target_label', p_target_label,
    'local_value', case when p_resolution_type = 'master_data' then trim(coalesce(p_local_value, p_raw_value)) else null end
  ));

  insert into plm.style_tracker_value_resolution (
    field_key,
    raw_value,
    normalized_value,
    resolution_type,
    target_schema,
    target_table,
    target_id,
    target_label,
    local_value,
    confidence
  )
  values (
    p_field_key,
    trim(p_raw_value),
    v_normalized,
    p_resolution_type,
    p_target_schema,
    p_target_table,
    p_target_id,
    p_target_label,
    case when p_resolution_type = 'master_data' then trim(coalesce(p_local_value, p_raw_value)) else null end,
    'verified'
  )
  on conflict (field_key, normalized_value) do update set
    raw_value = excluded.raw_value,
    resolution_type = excluded.resolution_type,
    target_schema = excluded.target_schema,
    target_table = excluded.target_table,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    local_value = excluded.local_value,
    confidence = excluded.confidence
  returning * into v_resolution;

  update plm.style_tracker_item_bridge b
  set
    creative_designer_id = case
      when p_field_key = 'designer'
        and p_resolution_type = 'canonical'
        and p_target_schema = 'core'
        and p_target_table = 'creative_designer'
        then p_target_id
      when p_field_key = 'designer' then null
      else b.creative_designer_id
    end,
    match_notes = jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(b.match_notes, '{}'::jsonb),
          '{manual_resolutions}',
          coalesce(b.match_notes->'manual_resolutions', '{}'::jsonb),
          true
        ),
        array['manual_resolutions', p_field_key],
        v_manual,
        true
      ),
      '{manual_resolution}',
      v_manual,
      true
    ),
    match_status = case
      when p_resolution_type = 'canonical' then
        case when p_field_key = 'designer' and b.match_status = 'unmatched' then 'partial' else 'matched' end
      else 'partial'
    end,
    match_confidence = 'verified',
    last_matched_at = now()
  from public.style_tracker_rows r
  where b.style_tracker_row_id = r.id
    and case p_field_key
      when 'sku' then plm.normalize_style_tracker_value('sku', r.sku)
      when 'customer' then plm.normalize_style_tracker_value('customer', r.customer)
      when 'licensor' then plm.normalize_style_tracker_value('licensor', r.licensor)
      when 'designer' then plm.normalize_style_tracker_value('designer', r.designer)
      when 'factory' then plm.normalize_style_tracker_value('factory', r.default_vendor)
    end = v_normalized;

  return v_resolution;
end;
$function$;

create or replace view public.style_tracker_rows_with_bridge as
select
  r.id,
  r.source_workbook_id,
  r.source_sheet,
  r.source_row_number,
  r.tracker_type,
  r.sku,
  r.group_id,
  r.description,
  r.customer,
  r.designer,
  r.commissioned,
  r.upc,
  r.customer_sku,
  r.licensor,
  r.license_status,
  r.royalty,
  r.concept_status,
  r.pre_production_status,
  r.production_status,
  r.default_vendor,
  r.discontinued,
  r.notes,
  r.row_data,
  r.imported_at,
  r.created_at,
  r.updated_at,
  r.updated_by,
  b.id as bridge_id,
  b.erp_item_id,
  b.style_group_id,
  b.company_id,
  b.public_licensor_id,
  b.core_licensor_id,
  b.factory_id,
  b.plm_item_id,
  b.match_status,
  b.match_confidence,
  b.match_notes,
  b.last_matched_at,
  erp.item_description as canonical_description,
  company.name as canonical_customer_name,
  coalesce(core_lic.name, public_lic.name) as canonical_licensor_name,
  factory.name as canonical_factory_name,
  sg.sku as style_group_sku,
  erp.style_number as erp_style_number,
  b.creative_designer_id,
  creative.name as canonical_designer_name
from public.style_tracker_rows r
left join plm.style_tracker_item_bridge b on b.style_tracker_row_id = r.id
left join public.erp_items_current erp on erp.id = b.erp_item_id
left join public.style_groups sg on sg.id = b.style_group_id
left join core.customer company on company.id = b.company_id
left join public.licensors public_lic on public_lic.id = b.public_licensor_id
left join core.licensor core_lic on core_lic.id = b.core_licensor_id
left join core.creative_designer creative on creative.id = b.creative_designer_id
left join core.factory factory on factory.id = b.factory_id;

grant execute on function plm.apply_style_tracker_designer_resolutions() to service_role;
grant execute on function public.refresh_style_tracker_item_bridge() to anon, authenticated, service_role;
grant execute on function public.upsert_style_tracker_value_resolution(text, text, text, text, text, uuid, text, text) to anon, authenticated, service_role;

select public.refresh_style_tracker_item_bridge();
$ddl$;
end if;
end
$migration$;
