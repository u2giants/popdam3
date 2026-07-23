-- DML asset batch default 2000 (from buildAssetBatchSql)
-- DML-only asset batch (single short transaction). Idempotent / resumable.
-- Schema FK DDL is owned by migrations 20260723112910 / 20260723112930 — not here.
do $batch$
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
  create index on dam_core_property_by_code (licensor_id, lookup_key);

  create temporary table dam_core_property_by_name on commit drop as
  select p.licensor_id, lower(trim(p.name)) as lookup_key, min(p.id::text)::uuid as core_id
  from core.property p
  group by p.licensor_id, lower(trim(p.name))
  having count(*) = 1;
  create index on dam_core_property_by_name (licensor_id, lookup_key);

  -- Suppress irrelevant asset triggers for this transaction only.
  -- Requires privilege to set session_replication_role; fails before UPDATE if
  -- the connected role cannot (no table-trigger toggle fallback; that is DDL).
  -- Capability proof: preview rehearsal with the same DB role.
  set local session_replication_role = replica;

  with residual as (
    select a.id
    from public.assets a
    where (a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id))
       or (a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id))
    order by a.id
    limit 2000
  ),
  resolved as (
    select
      a.id,
      coalesce(
        (select c.id from core.licensor c where c.id = a.licensor_id),
        lm.core_id
      ) as licensor_id,
      coalesce(
        (select p.id from core.property p where p.id = a.property_id),
        code_match.core_id,
        name_match.core_id
      ) as property_id
    from public.assets a
    join residual r on r.id = a.id
    left join dam_legacy_licensor_map lm on lm.legacy_id = a.licensor_id
    left join public.properties legacy_property on legacy_property.id = a.property_id
    left join dam_core_property_by_code code_match
      on code_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = a.licensor_id),
           lm.core_id
         )
     and code_match.lookup_key = lower(a.property_code)
    left join dam_core_property_by_name name_match
      on name_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = a.licensor_id),
           lm.core_id
         )
     and name_match.lookup_key = lower(trim(coalesce(a.property_name, legacy_property.name)))
  ),
  updated as (
    update public.assets a
    set licensor_id = resolved.licensor_id,
        property_id = resolved.property_id
    from resolved
    where a.id = resolved.id
    returning a.id
  )
  select count(*) into v_rows from updated;

  create temporary table if not exists dam_core_taxonomy_batch_result (
    rows_updated integer not null
  ) on commit drop;
  delete from dam_core_taxonomy_batch_result;
  insert into dam_core_taxonomy_batch_result(rows_updated) values (v_rows);

  raise notice 'dam_core_taxonomy asset batch updated=%', v_rows;
end
$batch$;
select rows_updated from dam_core_taxonomy_batch_result;
