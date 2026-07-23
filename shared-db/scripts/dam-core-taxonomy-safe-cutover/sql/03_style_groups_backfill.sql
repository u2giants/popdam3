-- DML style_groups (from buildStyleGroupsBackfillSql)
-- DML-only style_groups rewrite (one short transaction).
do $sg$
declare
  v_rows integer;
  v_unmapped bigint;
  v_ambiguous bigint;
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

  select count(*) into v_unmapped
  from public.licensors l
  left join dam_legacy_licensor_map m on m.legacy_id = l.id
  where m.core_id is null and coalesce(m.ambiguous, false) = false;

  select count(*) into v_ambiguous
  from dam_legacy_licensor_map m
  where m.ambiguous = true;

  if v_unmapped <> 0 then
    raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have no canonical core.licensor match', v_unmapped;
  end if;
  if v_ambiguous <> 0 then
    raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have ambiguous core.licensor matches', v_ambiguous;
  end if;

  create temporary table dam_core_property_by_code on commit drop as
  select p.licensor_id, lower(p.code) as lookup_key, min(p.id::text)::uuid as core_id
  from core.property p
  where p.code is not null
  group by p.licensor_id, lower(p.code)
  having count(*) = 1;

  create temporary table dam_core_property_by_name on commit drop as
  select p.licensor_id, lower(trim(p.name)) as lookup_key, min(p.id::text)::uuid as core_id
  from core.property p
  group by p.licensor_id, lower(trim(p.name))
  having count(*) = 1;

  with residual as (
    select sg.id
    from public.style_groups sg
    where (sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id))
       or (sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id))
  ),
  resolved as (
    select
      sg.id,
      coalesce(
        (select c.id from core.licensor c where c.id = sg.licensor_id),
        lm.core_id
      ) as licensor_id,
      coalesce(
        (select p.id from core.property p where p.id = sg.property_id),
        code_match.core_id,
        name_match.core_id
      ) as property_id
    from public.style_groups sg
    join residual r on r.id = sg.id
    left join dam_legacy_licensor_map lm on lm.legacy_id = sg.licensor_id
    left join public.properties legacy_property on legacy_property.id = sg.property_id
    left join dam_core_property_by_code code_match
      on code_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = sg.licensor_id),
           lm.core_id
         )
     and code_match.lookup_key = lower(sg.property_code)
    left join dam_core_property_by_name name_match
      on name_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = sg.licensor_id),
           lm.core_id
         )
     and name_match.lookup_key = lower(trim(coalesce(sg.property_name, legacy_property.name)))
  ),
  updated as (
    update public.style_groups sg
    set licensor_id = resolved.licensor_id,
        property_id = resolved.property_id
    from resolved
    where sg.id = resolved.id
    returning sg.id
  )
  select count(*) into v_rows from updated;

  create temporary table if not exists dam_core_taxonomy_batch_result (
    rows_updated integer not null
  ) on commit drop;
  delete from dam_core_taxonomy_batch_result;
  insert into dam_core_taxonomy_batch_result(rows_updated) values (v_rows);

  raise notice 'dam_core_taxonomy style_groups updated=%', v_rows;
end
$sg$;
select rows_updated from dam_core_taxonomy_batch_result;
