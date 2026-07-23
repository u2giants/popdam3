-- DML bakeoff (from buildBakeoffBackfillSql)
-- DML-only ai_tag_bakeoff_results property rewrite (one short transaction).
do $bo$
declare
  v_rows integer := 0;
  v_rows2 integer := 0;
begin
  create temporary table dam_legacy_licensor_map on commit drop as
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
  from public.licensors legacy) lr;

  create temporary table dam_legacy_property_map on commit drop as
  select legacy.id as legacy_id, min(canonical.id::text)::uuid as core_id
  from public.properties legacy
  join dam_legacy_licensor_map lm on lm.legacy_id = legacy.licensor_id and lm.core_id is not null
  join core.property canonical
    on canonical.licensor_id = lm.core_id
   and lower(trim(canonical.name)) = lower(trim(legacy.name))
  group by legacy.id
  having count(*) = 1;

  with updated as (
    update public.ai_tag_bakeoff_results r
    set property_id = m.core_id
    from dam_legacy_property_map m
    where r.property_id = m.legacy_id
    returning r.asset_id
  )
  select count(*) into v_rows from updated;

  with updated as (
    update public.ai_tag_bakeoff_results r
    set property_id = null
    where r.property_id is not null
      and not exists (select 1 from core.property p where p.id = r.property_id)
    returning r.asset_id
  )
  select count(*) into v_rows2 from updated;

  create temporary table if not exists dam_core_taxonomy_batch_result (
    rows_updated integer not null
  ) on commit drop;
  delete from dam_core_taxonomy_batch_result;
  insert into dam_core_taxonomy_batch_result(rows_updated) values (v_rows + v_rows2);

  raise notice 'dam_core_taxonomy bakeoff updated=%', v_rows + v_rows2;
end
$bo$;
select rows_updated from dam_core_taxonomy_batch_result;
