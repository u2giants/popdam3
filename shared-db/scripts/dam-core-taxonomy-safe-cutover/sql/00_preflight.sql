-- Read-only preflight (from buildPreflightSql)
-- Read-only preflight / progress evidence (no writes).
with licensor_map as (
  select
    lr.legacy_id,
    case
      when coalesce(cardinality(lr.code_ids), 0) = 1 then lr.code_ids[1]
      when coalesce(cardinality(lr.code_ids), 0) = 0
        and coalesce(cardinality(lr.name_ids), 0) = 1 then lr.name_ids[1]
      else null
    end as core_id,
    case
      when coalesce(cardinality(lr.code_ids), 0) > 1 then true
      when coalesce(cardinality(lr.code_ids), 0) = 0
        and coalesce(cardinality(lr.name_ids), 0) > 1 then true
      else false
    end as ambiguous
  from (select
    legacy.id as legacy_id,
    (
      select array_agg(c.id order by c.id)
      from core.licensor c
      where lower(c.code) = lower(
        case legacy.external_id
          when 'DS' then 'DY'
          when 'WWE' then 'WW'
          else legacy.external_id
        end
      )
    ) as code_ids,
    (
      select array_agg(c.id order by c.id)
      from core.licensor c
      where lower(trim(c.name)) = lower(trim(legacy.name))
    ) as name_ids
  from public.licensors legacy) lr
),
unmapped as (
  select count(*)::bigint as n
  from public.licensors l
  left join licensor_map m on m.legacy_id = l.id
  where m.core_id is null and coalesce(m.ambiguous, false) = false
),
ambiguous as (
  select count(*)::bigint as n
  from licensor_map m
  where m.ambiguous = true
),
residual_assets as (
  select count(*)::bigint as n
  from public.assets a
  where (a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id))
     or (a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id))
),
residual_style_groups as (
  select count(*)::bigint as n
  from public.style_groups sg
  where (sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id))
     or (sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id))
),
residual_bakeoff as (
  select count(*)::bigint as n
  from public.ai_tag_bakeoff_results r
  where r.property_id is not null
    and not exists (select 1 from core.property p where p.id = r.property_id)
),
fk as (
  select
    c.conname,
    n.nspname || '.' || rel.relname as table_name,
    rn.nspname || '.' || ref.relname as ref_table
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  join pg_class ref on ref.oid = c.confrelid
  join pg_namespace rn on rn.oid = ref.relnamespace
  where c.contype = 'f'
    and c.conname in (
      'assets_licensor_id_fkey',
      'assets_property_id_fkey',
      'style_groups_licensor_id_fkey',
      'style_groups_property_id_fkey',
      'ai_tag_bakeoff_results_property_id_fkey'
    )
),
catalog as (
  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'dam_character_catalog' and c.relkind in ('v', 'm')
  ) as exists
)
select
  (select n from unmapped) as unmapped_legacy_licensors,
  (select n from ambiguous) as ambiguous_legacy_licensors,
  (select n from residual_assets) as residual_assets,
  (select n from residual_style_groups) as residual_style_groups,
  (select n from residual_bakeoff) as residual_bakeoff,
  (select count(*) from fk where ref_table in ('core.licensor', 'core.property'))::int as core_targeted_fk_count,
  (select count(*) from fk where ref_table in ('public.licensors', 'public.properties'))::int as legacy_targeted_fk_count,
  (5 - (select count(*) from fk))::int as missing_fk_count,
  (select exists from catalog) as character_catalog_exists,
  coalesce((select json_agg(json_build_object('conname', conname, 'table', table_name, 'ref', ref_table) order by conname) from fk), '[]'::json) as fk_details
