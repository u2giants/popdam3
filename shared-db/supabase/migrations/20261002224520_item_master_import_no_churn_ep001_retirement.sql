-- derived-from: 20260720121000
-- Issue #3910 (follow-up of #3903). Body re-derived from the live production
-- definition of plm.import_item_master_data(jsonb), which matches 20260720121000.
-- 1. The plm.item and plm.item_import upserts, and the item_id/outcome back-fill,
--    update a row only when its content changed, so a repeat nightly sweep no longer bumps updated_at on every item.
-- 2. A sweep that omits division EP001 (out of scope by owner ruling 2026-08-28)
--    promotes and retires it instead of failing every night.
-- ACL, signature, SECURITY DEFINER and search_path are unchanged (create or replace);
-- the verify block at the end asserts all four.
-- 3. ingest.raw_record rewrites only changed payloads, and a reviewed/dismissed
--    disagreement is re-opened only when the disagreement itself changed (it was
--    forced back to 'open' every night). plm.item_import_unresolved stays a
--    per-sweep quarantine snapshot (rebuilt each run by design).
-- Retiring EP001 cascades its plm.item_import_unresolved/disagreement rows (FK on
-- delete cascade); production holds 0 EP001 disagreement rows (2026-10-02).
-- A retired EP001 item keeps its plm.item row, exactly as any item that leaves the
-- vendor feed always has: plm.item is the durable Item Master and never deletes.

create or replace function plm.import_item_master_data(import_payload jsonb)
 RETURNS TABLE(sync_run_id uuid, rows_seen integer, rows_inserted integer, rows_updated integer, rows_resolved integer, rows_partially_resolved integer, rows_ambiguous integer, rows_unresolved integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'ingest', 'plm', 'extensions', 'public'
AS $function$
declare
  sync_id uuid := coalesce(nullif(import_payload ->> 'sweepId', '')::uuid, gen_random_uuid());
  items jsonb := coalesce(import_payload -> 'items', '[]'::jsonb);
  terminal_reached boolean := coalesce((import_payload ->> 'terminalReached')::boolean, false);
  sanity_ratio numeric := coalesce(nullif(import_payload ->> 'minimumSilverRatio', '')::numeric, 0.80);
  seen_count integer := 0;
  inserted_count integer := 0;
  updated_count integer := 0;
  existing_count integer := 0;
  resolved_count integer := 0;
  partial_count integer := 0;
  ambiguous_count integer := 0;
  unresolved_count integer := 0;
begin
  if jsonb_typeof(items) <> 'array' then raise exception 'import_payload.items must be a JSON array'; end if;
  if sanity_ratio <= 0 or sanity_ratio > 1 then raise exception 'minimumSilverRatio must be greater than 0 and at most 1'; end if;

  insert into ingest.sync_run(id, source_system, source_name, status, started_at, metadata)
  values (sync_id, 'coldlion', 'item_taxonomy_resolver', 'running', now(),
    jsonb_build_object('endpoint','/items','terminal_reached',terminal_reached,'minimum_silver_ratio',sanity_ratio));

  if not terminal_reached then raise exception 'item sweep did not reach a terminal or empty page; silver was not promoted'; end if;

  delete from plm.item_import_staging where sweep_id=sync_id;
  insert into plm.item_import_staging(
    sweep_id, company_code, division_code, item_no, item_description, style_number, status,
    merch_group_01, merch_group_02, merch_group_03, merch_group_04, merch_group_05, merch_group_06,
    merch_groups, raw)
  select sync_id,
    nullif(btrim(x->>'companyCode'),''), nullif(btrim(x->>'divisionCode'),''), nullif(btrim(x->>'itemNo'),''),
    nullif(x->>'itemDesc',''), nullif(coalesce(x->>'styleNumber',x->>'styleNo'),''), nullif(x->>'status',''),
    nullif(x->>'merchGroup01',''), nullif(x->>'merchGroup02',''), nullif(x->>'merchGroup03',''),
    nullif(x->>'merchGroup04',''), nullif(x->>'merchGroup05',''), nullif(x->>'merchGroup06',''),
    jsonb_build_object('01',x->>'merchGroup01','02',x->>'merchGroup02','03',x->>'merchGroup03',
      '04',x->>'merchGroup04','05',x->>'merchGroup05','06',x->>'merchGroup06'), x
  from jsonb_array_elements(items) x;

  if exists(select 1 from plm.item_import_staging where sweep_id=sync_id and
    (company_code is null or division_code is null or item_no is null)) then
    raise exception 'items payload contains a row missing companyCode, divisionCode, or itemNo';
  end if;

  select count(*) into seen_count from plm.item_import_staging where sweep_id=sync_id;
  if seen_count=0 then raise exception 'item sweep is empty; silver was not promoted'; end if;
  if exists(select 1 from (select division_code, count(*) c from plm.item_import_staging where sweep_id=sync_id group by division_code) d where c=0) then
    raise exception 'item sweep contains a zero-row division; silver was not promoted';
  end if;
  select count(*) into existing_count from plm.item_import;
  -- A retiring EDGEHOME/EP001 (absent from this sweep) does not count against the band.
  if existing_count>0 and seen_count < ceil(sanity_ratio * (existing_count - case
       when exists(select 1 from plm.item_import_staging st where st.sweep_id=sync_id
                   and st.company_code='EDGEHOME' and st.division_code='EP001') then 0
       else (select count(*) from plm.item_import where company_code='EDGEHOME' and division_code='EP001') end)) then
    raise exception 'item sweep row count % is below sanity band % of current silver %', seen_count, sanity_ratio, existing_count;
  end if;
  if existing_count>0 and exists(
    select 1 from (select distinct company_code, division_code from plm.item_import) current_division
    -- EDGEHOME/EP001 is permanently out of scope (owner ruling 2026-08-28): its absence
    -- from a sweep is a retirement, pruned below by the full-sweep promotion and
    -- recorded in this run's metadata as retired_divisions, not a failure.
    where (current_division.company_code, current_division.division_code) <> ('EDGEHOME', 'EP001')
      and not exists(select 1 from plm.item_import_staging staged
      where staged.sweep_id=sync_id and staged.company_code=current_division.company_code
        and staged.division_code=current_division.division_code)
  ) then
    raise exception 'item sweep omitted a division present in current silver; silver was not promoted';
  end if;
  -- Retiring EP001 cascades its quarantine and disagreement rows; never let that
  -- silently discard a human reviewed/dismissed disagreement decision.
  if exists(select 1 from plm.item_taxonomy_disagreement d
            where d.company_code='EDGEHOME' and d.division_code='EP001' and d.status <> 'open')
     and not exists(select 1 from plm.item_import_staging st where st.sweep_id=sync_id
                    and st.company_code='EDGEHOME' and st.division_code='EP001') then
    raise exception 'retiring EDGEHOME/EP001 would delete reviewed disagreement decisions; silver was not promoted';
  end if;

  select count(*) into inserted_count from plm.item_import_staging s left join plm.item_import i
    using(company_code,division_code,item_no) where s.sweep_id=sync_id and i.item_no is null;
  drop table if exists item_taxonomy_changed_rows;
  create temporary table item_taxonomy_changed_rows (
    company_code text not null,
    division_code text not null,
    item_no text not null,
    primary key(company_code,division_code,item_no)
  ) on commit drop;
  insert into item_taxonomy_changed_rows
  select s.company_code,s.division_code,s.item_no from plm.item_import_staging s join plm.item_import i
    using(company_code,division_code,item_no) where s.sweep_id=sync_id and
    (i.item_description,i.style_number,i.status,i.merch_group_01,i.merch_group_02,i.merch_group_03,
     i.merch_group_04,i.merch_group_05,i.merch_group_06,i.merch_groups,i.raw) is distinct from
    (s.item_description,s.style_number,s.status,s.merch_group_01,s.merch_group_02,s.merch_group_03,
     s.merch_group_04,s.merch_group_05,s.merch_group_06,s.merch_groups,s.raw);

  insert into ingest.raw_record(sync_run_id,source_system,source_table,source_id,record_hash,payload,imported_at)
  select sync_id,'coldlion','items',company_code||'|'||division_code||'|'||item_no,md5(raw::text),raw,now()
  from plm.item_import_staging where sweep_id=sync_id
  on conflict(source_system,source_table,source_id) do update set sync_run_id=excluded.sync_run_id,
    record_hash=excluded.record_hash,payload=excluded.payload,imported_at=excluded.imported_at
  -- unchanged payloads are not rewritten; sync_run_id then names the run that last changed it
  where ingest.raw_record.record_hash is distinct from excluded.record_hash;

  insert into plm.item_import(company_code,division_code,item_no,item_description,style_number,status,
    merch_group_01,merch_group_02,merch_group_03,merch_group_04,merch_group_05,merch_group_06,merch_groups,raw,imported_at)
  select company_code,division_code,item_no,item_description,style_number,status,merch_group_01,merch_group_02,
    merch_group_03,merch_group_04,merch_group_05,merch_group_06,merch_groups,raw,now()
  from plm.item_import_staging where sweep_id=sync_id
  on conflict(company_code,division_code,item_no) do update set item_description=excluded.item_description,
    style_number=excluded.style_number,status=excluded.status,merch_group_01=excluded.merch_group_01,
    merch_group_02=excluded.merch_group_02,merch_group_03=excluded.merch_group_03,
    merch_group_04=excluded.merch_group_04,merch_group_05=excluded.merch_group_05,
    merch_group_06=excluded.merch_group_06,merch_groups=excluded.merch_groups,raw=excluded.raw,imported_at=excluded.imported_at
  where (plm.item_import.item_description,plm.item_import.style_number,plm.item_import.status,
         plm.item_import.merch_group_01,plm.item_import.merch_group_02,plm.item_import.merch_group_03,
         plm.item_import.merch_group_04,plm.item_import.merch_group_05,plm.item_import.merch_group_06,
         plm.item_import.merch_groups,plm.item_import.raw)
    is distinct from
        (excluded.item_description,excluded.style_number,excluded.status,excluded.merch_group_01,
         excluded.merch_group_02,excluded.merch_group_03,excluded.merch_group_04,excluded.merch_group_05,
         excluded.merch_group_06,excluded.merch_groups,excluded.raw);

  update ingest.sync_run set metadata=metadata || jsonb_build_object('retired_divisions',
    coalesce((select jsonb_agg(distinct i.company_code||'|'||i.division_code) from plm.item_import i
      where not exists(select 1 from plm.item_import_staging s where s.sweep_id=sync_id
        and s.company_code=i.company_code and s.division_code=i.division_code)),'[]'::jsonb))
  where id=sync_id;

  -- A full-sweep promotion makes silver an exact last-good snapshot.
  delete from plm.item_import i where not exists(select 1 from plm.item_import_staging s where s.sweep_id=sync_id
    and (s.company_code,s.division_code,s.item_no)=(i.company_code,i.division_code,i.item_no));

  drop table if exists item_taxonomy_resolution;
  create temporary table item_taxonomy_resolution on commit drop as
  with base as (
    select i.*,
      lower(btrim(h5.mg_type_desc)) meaning_05, lower(btrim(h6.mg_type_desc)) meaning_06
    from plm.item_import i
    left join plm.merch_group_header h5 on h5.company_code=i.company_code and h5.division_code=i.division_code and h5.mg_type_code='05'
    left join plm.merch_group_header h6 on h6.company_code=i.company_code and h6.division_code=i.division_code and h6.mg_type_code='06'
  ), candidates as (
    select b.*,
      lc.candidate_count lic_count, lc.candidate_id slot_licensor_id,
      pc.candidate_count property_count, pc.candidate_id sole_property_id, pc.parent_id sole_property_licensor_id,
      sp.candidate_count scoped_property_count, sp.candidate_id scoped_property_id, sp.parent_id scoped_property_licensor_id
    from base b
    left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id from core.licensor where code=b.merch_group_05) lc on true
    left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id,
      (array_agg(licensor_id order by id))[1] parent_id from core.property where code=b.merch_group_06) pc on true
    left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id,
      (array_agg(licensor_id order by id))[1] parent_id from core.property
      where code=b.merch_group_06 and licensor_id=lc.candidate_id) sp on true
  )
  select c.*,
    case when not (lic_count>1 or (meaning_06='property' and scoped_property_count=0 and property_count>1))
      and meaning_05='licensor' and lic_count=1 then slot_licensor_id end resolved_slot_licensor_id,
    case when not (lic_count>1 or (meaning_06='property' and scoped_property_count=0 and property_count>1)) then
      case when meaning_06='property' and scoped_property_count=1 then scoped_property_id
           when meaning_06='property' and property_count=1 then sole_property_id end end resolved_property_id,
    case when not (lic_count>1 or (meaning_06='property' and scoped_property_count=0 and property_count>1)) then
      case when meaning_06='property' and scoped_property_count=1 then scoped_property_licensor_id
           when meaning_06='property' and property_count=1 then sole_property_licensor_id
           when meaning_05='licensor' and lic_count=1 then slot_licensor_id end end resolved_licensor_id,
    case
      when (meaning_05='licensor' and lic_count>1) or
           (meaning_06='property' and scoped_property_count=0 and property_count>1) then 'ambiguous'
      when meaning_05='licensor' and meaning_06='property' and lic_count=1 and
           (scoped_property_count=1 or property_count=1) then 'resolved'
      when (meaning_05='licensor' and lic_count=1) or
           (meaning_06='property' and (scoped_property_count=1 or property_count=1)) then 'partially-resolved'
      else 'unresolved'
    end outcome
  from candidates c;

  -- plm.item receives only the two locked taxonomy FKs. product_type_id and
  -- merch_group_id remain untouched because their canonical tables are empty.
  insert into item_taxonomy_changed_rows(company_code,division_code,item_no)
  select r.company_code,r.division_code,r.item_no
  from item_taxonomy_resolution r
  join plm.item p on p.source_system='coldlion' and p.source_id=r.company_code||'|'||r.division_code||'|'||r.item_no
  where (p.item_number,p.name,p.description,p.licensor_id,p.property_id,p.status,p.raw) is distinct from
    (r.item_no,r.style_number,r.item_description,r.resolved_licensor_id,r.resolved_property_id,r.status,r.raw)
  on conflict do nothing;
  select count(*) into updated_count from item_taxonomy_changed_rows;

  insert into plm.item(item_number,name,description,licensor_id,property_id,status,source_system,source_id,raw)
  select item_no,style_number,item_description,resolved_licensor_id,resolved_property_id,status,'coldlion',
    company_code||'|'||division_code||'|'||item_no,raw from item_taxonomy_resolution
  on conflict(source_system,source_id) do update set item_number=excluded.item_number,name=excluded.name,
    description=excluded.description,licensor_id=excluded.licensor_id,property_id=excluded.property_id,
    status=excluded.status,raw=excluded.raw,updated_at=now()
  -- Only real changes bump updated_at; an unchanged nightly sweep writes nothing (#3910).
  where (plm.item.item_number,plm.item.name,plm.item.description,plm.item.licensor_id,
         plm.item.property_id,plm.item.status,plm.item.raw)
    is distinct from
        (excluded.item_number,excluded.name,excluded.description,excluded.licensor_id,
         excluded.property_id,excluded.status,excluded.raw);

  update plm.item_import i set item_id=p.id,resolution_outcome=r.outcome
  from item_taxonomy_resolution r join plm.item p on p.source_system='coldlion' and
    p.source_id=r.company_code||'|'||r.division_code||'|'||r.item_no
  where (i.company_code,i.division_code,i.item_no)=(r.company_code,r.division_code,r.item_no)
    and (i.item_id,i.resolution_outcome) is distinct from (p.id,r.outcome);

  -- Rebuild the current quarantine for this sweep. This deliberately clears a
  -- formerly unresolved (item, slot) when the same slot resolves on re-run.
  delete from plm.item_import_unresolved u using item_taxonomy_resolution r
  where (u.company_code,u.division_code,u.item_no)=(r.company_code,r.division_code,r.item_no);

  insert into plm.item_import_unresolved(company_code,division_code,item_no,slot_code,slot_meaning,
    source_code,outcome,reason,candidate_count,tiebreak,last_seen_at,sync_run_id)
  select company_code,division_code,item_no,slot_code,slot_meaning,source_code,
    case when outcome='resolved' then 'partially-resolved' else outcome end,
    reason,candidate_count,'none; ambiguous candidates are quarantined',now(),sync_id
  from item_taxonomy_resolution r
  cross join lateral (values
    ('05',r.meaning_05,r.merch_group_05,
      case when r.meaning_05 is null then 'unknown division-scoped slot meaning'
           when r.meaning_05<>'licensor' then 'slot is '||r.meaning_05||', not licensor'
           when r.merch_group_05 is null then 'licensor slot is empty'
           when r.lic_count=0 then 'licensor code did not match core.licensor.code'
           when r.lic_count>1 then 'licensor code matched multiple candidates'
      end,r.lic_count),
    ('06',r.meaning_06,r.merch_group_06,
      case when r.meaning_06 is null then 'unknown division-scoped slot meaning'
           when r.meaning_06<>'property' then 'slot is '||r.meaning_06||', not property'
           when r.merch_group_06 is null then 'property slot is empty'
           when r.scoped_property_count=0 and r.property_count=0 then 'property code did not match core.property.code'
           when r.scoped_property_count=0 and r.property_count>1 then 'property code is ambiguous outside the resolved licensor'
      end,r.property_count)
  ) q(slot_code,slot_meaning,source_code,reason,candidate_count)
  where reason is not null;

  insert into plm.item_taxonomy_disagreement(company_code,division_code,item_no,licensor_slot_code,
    property_slot_code,slot_licensor_id,property_id,property_licensor_id,reason,last_seen_at,sync_run_id)
  select company_code,division_code,item_no,merch_group_05,merch_group_06,resolved_slot_licensor_id,
    resolved_property_id,resolved_licensor_id,'property parent wins: property.licensor_id disagrees with the item licensor slot',now(),sync_id
  from item_taxonomy_resolution where resolved_property_id is not null and resolved_slot_licensor_id is not null
    and resolved_slot_licensor_id is distinct from resolved_licensor_id
  on conflict(company_code,division_code,item_no) do update set licensor_slot_code=excluded.licensor_slot_code,
    property_slot_code=excluded.property_slot_code,slot_licensor_id=excluded.slot_licensor_id,
    property_id=excluded.property_id,property_licensor_id=excluded.property_licensor_id,
    reason=excluded.reason,last_seen_at=excluded.last_seen_at,sync_run_id=excluded.sync_run_id,
    -- a reviewed/dismissed decision is re-opened only when the disagreement itself changed
    status=case when (plm.item_taxonomy_disagreement.licensor_slot_code,plm.item_taxonomy_disagreement.property_slot_code,
                      plm.item_taxonomy_disagreement.slot_licensor_id,plm.item_taxonomy_disagreement.property_id,
                      plm.item_taxonomy_disagreement.property_licensor_id)
                     is distinct from
                     (excluded.licensor_slot_code,excluded.property_slot_code,excluded.slot_licensor_id,
                      excluded.property_id,excluded.property_licensor_id)
                then 'open' else plm.item_taxonomy_disagreement.status end;

  delete from plm.item_taxonomy_disagreement d using item_taxonomy_resolution r
  where (d.company_code,d.division_code,d.item_no)=(r.company_code,r.division_code,r.item_no)
    and not (r.resolved_property_id is not null and r.resolved_slot_licensor_id is not null
      and r.resolved_slot_licensor_id is distinct from r.resolved_licensor_id);

  delete from plm.item_import_staging where sweep_id=sync_id;

  select count(*) filter(where outcome='resolved'),count(*) filter(where outcome='partially-resolved'),
    count(*) filter(where outcome='ambiguous'),count(*) filter(where outcome='unresolved')
  into resolved_count,partial_count,ambiguous_count,unresolved_count from item_taxonomy_resolution;

  update ingest.sync_run set status='succeeded',finished_at=now(),rows_seen=seen_count,
    rows_inserted=inserted_count,rows_updated=updated_count,rows_failed=ambiguous_count+unresolved_count,
    metadata=metadata || jsonb_build_object(
      'outcomes',jsonb_build_object('resolved',resolved_count,'partially_resolved',partial_count,'ambiguous',ambiguous_count,'unresolved',unresolved_count),
      'per_division_per_outcome',coalesce((select jsonb_object_agg(division_code,counts) from
        (select division_code,jsonb_object_agg(outcome,row_count) counts from
          (select division_code,outcome,count(*) row_count from item_taxonomy_resolution group by division_code,outcome) x
         group by division_code) y),'{}'::jsonb),
      'per_division_per_type',coalesce((select jsonb_object_agg(division_code,counts) from
        (select division_code,jsonb_build_object(
          'items',count(*),
          'licensor_resolved',count(*) filter(where resolved_licensor_id is not null),
          'property_resolved',count(*) filter(where resolved_property_id is not null),
          'licensor_quarantined',count(*) filter(where meaning_05 is distinct from 'licensor' or resolved_licensor_id is null),
          'property_quarantined',count(*) filter(where meaning_06 is distinct from 'property' or resolved_property_id is null)
        ) counts from item_taxonomy_resolution group by division_code) z),'{}'::jsonb))
  where id=sync_id;

  return query select sync_id,seen_count,inserted_count,updated_count,resolved_count,partial_count,ambiguous_count,unresolved_count;
end;
$function$;

do $verify$
declare p record;
begin
  select prosecdef, proconfig, proacl, pg_get_function_identity_arguments(oid) as args
    into p from pg_proc where oid = 'plm.import_item_master_data(jsonb)'::regprocedure;
  if not p.prosecdef then raise exception '#3910: plm.import_item_master_data lost SECURITY DEFINER'; end if;
  if p.proconfig is distinct from array['search_path=app, core, ingest, plm, extensions, public'] then
    raise exception '#3910: unexpected search_path %', p.proconfig;
  end if;
  if p.args <> 'import_payload jsonb' then raise exception '#3910: unexpected signature %', p.args; end if;
  if pg_get_function_result('plm.import_item_master_data(jsonb)'::regprocedure) <> 'TABLE(sync_run_id uuid, rows_seen integer, rows_inserted integer, rows_updated integer, rows_resolved integer, rows_partially_resolved integer, rows_ambiguous integer, rows_unresolved integer)'
     or (select provolatile from pg_proc where oid = 'plm.import_item_master_data(jsonb)'::regprocedure) <> 'v'
     or (select l.lanname from pg_proc pr join pg_language l on l.oid = pr.prolang where pr.oid = 'plm.import_item_master_data(jsonb)'::regprocedure) <> 'plpgsql' then
    raise exception '#3910: return shape, volatility or language changed';
  end if;
  if (select array_agg(format('%s:%s', coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'), a.privilege_type) order by 1)
        from aclexplode(p.proacl) a where a.grantee <> 0)
     is distinct from array['postgres:EXECUTE', 'service_role:EXECUTE']
     or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) then
    raise exception '#3910: execute ACL changed: %', p.proacl;
  end if;
  if has_function_privilege('anon', 'plm.import_item_master_data(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'plm.import_item_master_data(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'plm.import_item_master_data(jsonb)', 'execute') then
    raise exception '#3910: execute grants changed';
  end if;
end
$verify$;
