-- Issue popcre/shared-db#2541: place 13 more Disney OPA properties by the signed Disney contract.
--
-- Owner rulings (owner-rulings 6.36): 2026-10-26 "properties scraped from the submissions sites are 100% canonical"
-- (owner-rulings 6.31); 2026-08-31 the signed contract schedule decides Disney versus Marvel.
-- Evidence: contract K2557 Disney section; each clause names the franchise whose title equals the
-- OPA property (private repo u2giants/licensor-source-data,
-- disney-dcpvault/derived/contract-k2557-property-schedule.csv). Pairs below are
-- (OPA licensed_property_id, K2557 Disney clause). Only exact franchise-title matches are used;
-- clauses that merely mention a character (e.g. inside Standard Characters or Toy Story) are not.
-- OPA site branch is NOT used for Disney vs Marvel (it cannot separate them). The other OPA
-- properties stay unresolved. No licensed names in this file.
--
-- Step 1 turns the 13 unresolved studio rows canonical 'disney'. Step 2 re-runs the
-- 20261112173641 canonical-property step (idempotent) so they get core.property rows.

do $opa_contract_placement$
declare v_n integer;
begin
  if to_regclass('plm.opa_property_studio_resolution') is null then return; end if;
  if not exists (select 1 from plm.opa_property where licensed_property_id = 361) then
    raise notice '#2541: OPA landing empty; nothing to do'; return;
  end if;
  with p(id, clause) as (values
    (361,15),
    (1159071163,28),
    (1159124989,30),
    (130,38),
    (1159109249,53),
    (536,59),
    (1118,68),
    (1159141309,69),
    (380,75),
    (1159128413,76),
    (1159088182,78),
    (1034,17),
    (1159137990,87))
  update plm.opa_property_studio_resolution r
     set studio_code = 'disney', resolution_status = 'canonical', provenance_type = 'direct_source_assertion',
         provenance_reference = 'contract:K2557:disney:clause-' || p.clause,
         resolution_reason = 'Signed contract K2557 Disney section names this franchise (#2541)',
         resolved_at = clock_timestamp(), resolved_by = 'shared-db migration 20261112225250', updated_at = clock_timestamp()
    from p
   where r.licensed_property_id = p.id and r.resolution_status = 'unresolved';
  select count(*) into v_n from plm.opa_property_studio_resolution
   where licensed_property_id in (361,1159071163,1159124989,130,1159109249,536,1118,1159141309,380,1159128413,1159088182,1034,1159137990) and resolution_status = 'canonical' and studio_code = 'disney';
  if v_n <> 13 then raise exception '#2541: expected 13 contract-placed OPA rows, found %', v_n; end if;
end
$opa_contract_placement$;

do $opa_submission_canonical$
declare
  v_actor constant text := 'shared-db migration 20261112225250';
  v_reason constant text := '#2541 OPA submission Property canonical (owner ruling 2026-10-26)';
  r record; v_lic uuid; v_id uuid; v_name text; v_n integer; v_rows integer; v_expected integer;
begin
  if to_regclass('plm.opa_property') is null or to_regclass('plm.opa_property_studio_resolution') is null then
    raise notice '#2541: OPA landing absent; nothing to do';
    return;
  end if;
  select count(*) into v_expected
    from plm.opa_property o join plm.opa_property_studio_resolution s using (licensed_property_id)
   where s.resolution_status = 'canonical';
  if v_expected = 0 then
    raise notice '#2541: no studio-placed OPA properties; nothing to do';
    return;
  end if;
  if (select count(*) from core.licensor where code in ('DY','MV','SW')) <> 3 then
    raise exception '#2541: DISNEY/MARVEL/STAR WARS licensors not all present; re-check target database';
  end if;
  if exists (select 1 from plm.opa_property_studio_resolution
              where resolution_status = 'canonical' and studio_code not in ('disney','pixar','marvel','lucasfilm')) then
    raise exception '#2541: unknown OPA studio code; extend the mapping deliberately';
  end if;

  for r in
    select o.licensed_property_id::text k, o.property_name l, s.studio_code st
      from plm.opa_property o join plm.opa_property_studio_resolution s using (licensed_property_id)
     where s.resolution_status = 'canonical'
     order by o.licensed_property_id
  loop
    select id into v_lic from core.licensor
     where code = case r.st when 'marvel' then 'MV' when 'lucasfilm' then 'SW' else 'DY' end;

    v_id := null;
    select t.entity_id into v_id from core.taxonomy_source_ref t
     where t.source_system = 'disney_opa' and t.source_table = 'plm.opa_property' and t.source_id = r.k;
    if v_id is not null and not exists (select 1 from core.property where id = v_id and licensor_id = v_lic) then
      raise exception '#2541: OPA property % is linked to a row outside its studio licensor', r.k;
    end if;

    if v_id is null then
      select count(*), min(id::text)::uuid into v_n, v_id
        from core.property where licensor_id = v_lic and lower(name) = lower(r.l);
      if v_n > 1 then raise exception '#2541: % rows share one OPA label ignoring case (OPA id %)', v_n, r.k; end if;
    end if;

    if v_id is null then
      insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
      values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create', gen_random_uuid(),
        encode(extensions.digest('2541/opa/create/'||r.k,'sha256'),'hex'), v_actor,
        array['licensor_id','name','code','status'], clock_timestamp()+interval '1 minute');
      insert into core.property(licensor_id,name,code,status,metadata)
      values (v_lic, r.l, null, 'potential', jsonb_build_object('curated',true,'import_owned',false,
        'authorising_issue',2541,'owner_instruction_date','2026-10-26','migration','20261112225250',
        'curated_source',jsonb_build_object('source_system','disney_opa','source_table','plm.opa_property',
          'licensed_property_id',r.k,'studio_code',r.st)))
      returning id into v_id;
    else
      select name into v_name from core.property where id = v_id;
      if v_name is distinct from r.l then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
          encode(extensions.digest('2541/opa/rename/'||v_id::text||'/'||r.k,'sha256'),'hex'), v_actor,
          array['name'], clock_timestamp()+interval '1 minute');
        update core.property set name = r.l,
          metadata = coalesce(metadata,'{}') || jsonb_build_object('submission_canonical', jsonb_build_object(
            'authorising_issue',2541,'migration','20261112225250','previous_name',v_name,
            'source_system','disney_opa','licensed_property_id',r.k))
         where id = v_id;
        get diagnostics v_rows = row_count;
        if v_rows <> 1 then raise exception '#2541: rename changed % rows', v_rows; end if;
      end if;
    end if;

    insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,source_code,source_name,confidence,raw)
    values ('core','property',v_id,'disney_opa','plm.opa_property',r.k,null,r.l,'verified',
      jsonb_build_object('authorising_issue',2541,'identity_method','opa_licensed_property_id',
        'studio_code',r.st,'owner_ruling','2026-10-26'))
    on conflict (source_system,source_table,source_id) do nothing;

    if not exists (select 1 from plm.source_resolution
                    where source_system = 'disney_opa' and entity_kind = 'property' and source_id = r.k) then
      perform plm.set_source_resolution('disney_opa'::text, 'property'::text, r.k, 'matched'::text,
        v_id, null::uuid, null::uuid, null::uuid, v_reason, null::timestamptz);
    end if;
  end loop;

  -- Post-conditions: every studio-placed OPA property has one ref to a row under its licensor
  -- carrying its exact submission name, and a matched resolution to that same row.
  select count(*) into v_n
    from plm.opa_property o
    join plm.opa_property_studio_resolution s using (licensed_property_id)
    join core.taxonomy_source_ref t on t.source_system='disney_opa' and t.source_table='plm.opa_property'
         and t.source_id = o.licensed_property_id::text
    join core.property p on p.id = t.entity_id and p.name = o.property_name
    join core.licensor l on l.id = p.licensor_id
         and l.code = case s.studio_code when 'marvel' then 'MV' when 'lucasfilm' then 'SW' else 'DY' end
    join plm.source_resolution sr on sr.source_system='disney_opa' and sr.entity_kind='property'
         and sr.source_id = o.licensed_property_id::text and sr.resolution_status='matched' and sr.core_property_id = p.id
   where s.resolution_status = 'canonical';
  if v_n <> v_expected then
    raise exception '#2541 post-condition: % of % studio-placed OPA properties are canonical', v_n, v_expected;
  end if;
end
$opa_submission_canonical$;
