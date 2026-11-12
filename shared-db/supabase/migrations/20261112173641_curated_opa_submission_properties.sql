-- Issue popcre/shared-db#2541: Disney OPA submission Properties become canonical core.property rows.
--
-- Owner ruling, Albert Hazan, 2026-10-26 (verbatim): "properties scraped from the submissions
-- sites are 100% canonical." (docs/owner-rulings.md 6.31.) Every scraped submission Property is
-- created in core.property under its Licensor, by its exact submission name, if missing.
--
-- Why this is needed: the 2026-10-26 ruling was applied to Paramount TrackerPlus only
-- (20261026150931). The #5079 licensor-scrape promotion (20261030153101 and restores) created
-- OPA *characters* but never OPA *properties*, and the #640 reconciliation only linked 16 OPA
-- properties to pre-existing ColdLion rows (matched-row abstention, no creation). So OPA
-- properties such as "Minnie" and "Preschool CG Mickey (& Friends)" never became core rows.
--
-- NO LICENSED VALUES ARE IN THIS FILE. Names are read inside the database from plm.opa_property.
-- Licensor placement comes only from the governed studio review plm.opa_property_studio_resolution
-- (resolution_status 'canonical'): disney and pixar -> DISNEY (Pixar is part of Disney, #3539),
-- marvel -> MARVEL, lucasfilm -> STAR WARS. Rows the studio review left 'unresolved' or
-- 'ambiguous_crossover' are NOT placed here: Disney-versus-Marvel placement is decided by the
-- signed contract schedule (ruling 2026-08-31), never guessed. They stay preserved and visible.
--
-- Per OPA property, the canonical row is, in order:
--   1. the core.property already linked by a disney_opa taxonomy ref for that OPA id;
--   2. else the one row under that Licensor whose name equals the label ignoring case;
--   3. else a new code-less 'potential' row with the exact label.
-- A matched row whose name differs from the submission label is renamed to the exact label,
-- prior name kept in metadata (same rule as 20261026150931). Status of existing rows is unchanged.
-- Each OPA id gets one core.taxonomy_source_ref and one plm.source_resolution 'matched' decision.
-- Nothing is deleted. Idempotent. No-op where the OPA landing or licensors are absent (CI).

do $opa_submission_canonical$
declare
  v_actor constant text := 'shared-db migration 20261112173641';
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
        'authorising_issue',2541,'owner_instruction_date','2026-10-26','migration','20261112173641',
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
            'authorising_issue',2541,'migration','20261112173641','previous_name',v_name,
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
