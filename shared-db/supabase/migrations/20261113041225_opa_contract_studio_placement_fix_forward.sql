-- Issue #2541 / PR #6203: fix-forward to complete the OPA contract studio placement.
-- The post-condition in 20261112225250 checks p.name = o.property_name for every
-- studio-placed OPA property. Two core.property rows have stale names that differ
-- from their linked OPA submission names, breaking the chain:
--   372 "Mickey Mouse"  -> core.property 4bb52946 named "Standard Characters"
--   640 "X-Men"         -> core.property e0cde0d5 named "X-Men Classic"
-- Both rows have valid taxonomy_source_ref links (confidence=verified) and matched
-- source_resolution rows. The rename is the migration's own intent (owner ruling
-- 2026-10-26: OPA submission names are 100% canonical). On preview the rename
-- succeeded in the rehearsal; on production it is rolled back because the
-- post-condition raises in the same DO block. This fix-forward completes the rename
-- and keeps the #2541 post-condition intact.
-- derived-from: 20261112225250

do $fix_forward_2541$
declare
  v_actor constant text := 'shared-db migration 20261113041225';
  r record;
  v_rows integer;
begin
  if to_regclass('core.property') is null or to_regclass('plm.opa_property') is null then
    raise notice '#2541 fix-forward: landing absent; nothing to do';
    return;
  end if;

  for r in
    select o.licensed_property_id::text k, o.property_name l, t.entity_id::uuid pid
      from plm.opa_property o
      join plm.opa_property_studio_resolution s using (licensed_property_id)
      join core.taxonomy_source_ref t on t.source_system='disney_opa' and t.source_table='plm.opa_property'
           and t.source_id = o.licensed_property_id::text
      join core.property p on p.id = t.entity_id
     where s.resolution_status = 'canonical'
       and p.name is distinct from o.property_name
     order by o.licensed_property_id
  loop
    insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
    values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
      encode(extensions.digest('2541/fix-forward/rename/'||r.pid::text||'/'||r.k,'sha256'),'hex'), v_actor,
      array['name'], clock_timestamp() + interval '1 minute');
    update core.property set name = r.l,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('submission_canonical', jsonb_build_object(
        'authorising_issue',2541,'migration','20261113041225','previous_name',name,
        'source_system','disney_opa','licensed_property_id',r.k,'fix_forward',true))
     where id = r.pid;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception '#2541 fix-forward: rename changed % rows for OPA %', v_rows, r.k; end if;
  end loop;

  -- Post-condition: every studio-placed OPA property chain is now complete.
  declare v_n integer; v_expected integer;
  begin
    select count(*) into v_expected
      from plm.opa_property o join plm.opa_property_studio_resolution s using (licensed_property_id)
     where s.resolution_status = 'canonical';
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
      raise exception '#2541 fix-forward post-condition: % of % studio-placed OPA properties are canonical', v_n, v_expected;
    end if;
  end;
end
$fix_forward_2541$;
