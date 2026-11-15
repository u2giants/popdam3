-- Issue popcre/shared-db#6209 — corrected #2541 OPA contract-studio-placement fix-forward.
-- derived-from: 20261112225250
-- Its post-condition is restated below, in its own DO block, AFTER the writes,
-- so a failure can never roll the writes back.
--
-- Owner rulings in force (docs/owner-rulings.md):
--   6.31 (2026-10-26): OPA submission names are 100% canonical.
--   6.38 (2026-11-13, Mickey half): "Mickey Mouse", "Minnie & Me" and "Standard Characters"
--     are three separate properties; MM "Standard Characters" links to OPA 361, not 372.
--   6.40 (2026-11-14): the one-property X-Men half of 6.38 is DROPPED — it contradicts the
--     submissions site scrape, which lists OPA 640 and OPA 1107 as separate entries
--     (Albert, verbatim: "if it contradicts the submission site scrape drop my one-property
--     X-Men ruling"). OPA 640 and OPA 1107 are SEPARATE properties.
--
-- The wrong predecessor 20261113041225 renamed two shared core.property rows to make the
-- #2541 name check pass. Never rename a shared entity to fix a link. Per handoff
-- HANDOFF.d/2026-11-13T1455Z-edge-dev-mimo-opa-fix-forward-repair.md step 6.2 this migration:
--   (a) restores the two wrongly-renamed rows wherever 20261113041225 applied (no-op where
--       it never applied — production);
--   (b) creates the two missing core.property records for OPA 372 and OPA 640 under their
--       studio licensors (marvel -> MV, else DY);
--   (c) re-points the disney_opa chains for OPA 361/372/640/1107 to the right rows;
--   (d) re-states the #2541 post-condition in its own DO block.
-- Submission links use the 20261113183820 columns (submission_source/submission_property_id);
-- the retired metadata.submission_canonical key is never written. Every property name in this
-- migration is read live from the plm.opa_property scrape at run time — no licensed names are
-- in this file.

do $fix_forward_6209$
declare
  v_actor constant text := 'shared-db migration 20261115041745';
  v_reason constant text := '#2541 corrected fix-forward (issue #6209)';
  v_lic_dy uuid;
  v_lic_mv uuid;
  v_lic372 uuid;
  v_lic640 uuid;
  v_mm_row uuid;
  v_xm_row uuid;
  v_mm_new uuid;
  v_xm_new uuid;
  v_name361 text;
  v_name372 text;
  v_name640 text;
  v_name1107 text;
  v_studio372 text;
  v_studio640 text;
  v_ts timestamptz;
  v_rows integer;
begin
  if to_regclass('core.property') is null or to_regclass('plm.opa_property') is null then
    raise notice '#2541 fix-forward: landing absent; nothing to do';
    return;
  end if;
  if to_regclass('core.taxonomy_source_ref') is null or to_regclass('plm.source_resolution') is null
     or to_regclass('plm.opa_property_studio_resolution') is null then
    raise notice '#2541 fix-forward: link tables absent; nothing to do';
    return;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'core' and table_name = 'property'
                    and column_name = 'submission_property_id') then
    raise exception '#2541 fix-forward: requires migration 20261113183820 (core.property submission link columns) first';
  end if;
  if (select count(*) from core.licensor where code in ('DY','MV','SW')) <> 3 then
    raise exception '#2541 fix-forward: DISNEY/MARVEL/STAR WARS licensors not all present; re-check target database';
  end if;
  select property_name into v_name361 from plm.opa_property where licensed_property_id = 361;
  select property_name into v_name372 from plm.opa_property where licensed_property_id = 372;
  select property_name into v_name640 from plm.opa_property where licensed_property_id = 640;
  select property_name into v_name1107 from plm.opa_property where licensed_property_id = 1107;
  if v_name361 is null or v_name372 is null or v_name640 is null or v_name1107 is null then
    raise exception '#2541 fix-forward: OPA landing rows 361/372/640/1107 not all present; re-check target database';
  end if;

  select id into v_lic_dy from core.licensor where code = 'DY';
  select id into v_lic_mv from core.licensor where code = 'MV';

  -- Studio mapping for created rows: marvel -> MV, lucasfilm -> SW, else DY (same rule as
  -- 20261112225250). Read from the governed studio resolution, never assumed.
  select studio_code into v_studio372 from plm.opa_property_studio_resolution
   where licensed_property_id = 372 and resolution_status = 'canonical' limit 1;
  select studio_code into v_studio640 from plm.opa_property_studio_resolution
   where licensed_property_id = 640 and resolution_status = 'canonical' limit 1;
  select id into v_lic372 from core.licensor
   where code = case v_studio372 when 'marvel' then 'MV' when 'lucasfilm' then 'SW' else 'DY' end;
  select id into v_lic640 from core.licensor
   where code = case v_studio640 when 'marvel' then 'MV' when 'lucasfilm' then 'SW' else 'DY' end;

  -- (a) Restore the rows the wrong fix-forward 20261113041225 renamed. No-op where that
  -- migration never applied (production) or where the Coldlion sync already repaired them.
  select id into v_mm_row from core.property where licensor_id = v_lic_dy and code = 'MM';
  select id into v_xm_row from core.property where licensor_id = v_lic_mv and code = 'XM';
  if v_mm_row is null or v_xm_row is null then
    raise exception '#2541 fix-forward: expected core.property rows MM (DY) and XM (MV); found MM=% XM=%', v_mm_row, v_xm_row;
  end if;

  if exists (select 1 from core.property where id = v_mm_row and name = v_name372) then
    insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
    values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
      encode(extensions.digest('6209/fix-forward/restore/'||v_mm_row::text,'sha256'),'hex'), v_actor,
      array['name'], clock_timestamp() + interval '1 minute');
    update core.property set name = v_name361 where id = v_mm_row;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception '#2541 fix-forward: MM restore changed % rows', v_rows; end if;
  end if;

  if exists (select 1 from core.property where id = v_xm_row and name = v_name640) then
    insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
    values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
      encode(extensions.digest('6209/fix-forward/restore/'||v_xm_row::text,'sha256'),'hex'), v_actor,
      array['name'], clock_timestamp() + interval '1 minute');
    update core.property set name = v_name1107 where id = v_xm_row;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception '#2541 fix-forward: XM restore changed % rows', v_rows; end if;
  end if;

  -- Normalize the two restored rows' submission links to their own OPA entries
  -- (the link columns are not guarded columns; the 20261113183820 trigger fills the name).
  update core.property
     set submission_source = 'disney_opa', submission_property_id = '361'
   where id = v_mm_row
     and (submission_source is distinct from 'disney_opa' or submission_property_id is distinct from '361');
  update core.property
     set submission_source = 'disney_opa', submission_property_id = '1107'
   where id = v_xm_row
     and (submission_source is distinct from 'disney_opa' or submission_property_id is distinct from '1107');

  -- (b) The two missing records. Owner rulings 6.38 (Mickey half) and 6.40: these are
  -- separate properties from the rows above and from each other. Created as 'potential',
  -- names taken live from the submissions site scrape.
  select id into v_mm_new from core.property where licensor_id = v_lic372 and name = v_name372;
  if v_mm_new is null then
    insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
    values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create', gen_random_uuid(),
      encode(extensions.digest('6209/fix-forward/create/372','sha256'),'hex'), v_actor,
      array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
    insert into core.property(licensor_id,name,code,status,metadata,submission_source,submission_property_id)
    values (v_lic372, v_name372, null, 'potential',
      jsonb_build_object('curated',true,'import_owned',false,'authorising_issue',2541,
        'owner_instruction_date','2026-11-14','migration','20261115041745',
        'curated_source',jsonb_build_object('source_system','disney_opa','source_table','plm.opa_property',
          'licensed_property_id','372','studio_code',v_studio372)),
      'disney_opa','372')
    returning id into v_mm_new;
  end if;
  update core.property set submission_source = 'disney_opa', submission_property_id = '372'
   where id = v_mm_new
     and (submission_source is distinct from 'disney_opa' or submission_property_id is distinct from '372');

  select id into v_xm_new from core.property where licensor_id = v_lic640 and name = v_name640;
  if v_xm_new is null then
    insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
    values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create', gen_random_uuid(),
      encode(extensions.digest('6209/fix-forward/create/640','sha256'),'hex'), v_actor,
      array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
    insert into core.property(licensor_id,name,code,status,metadata,submission_source,submission_property_id)
    values (v_lic640, v_name640, null, 'potential',
      jsonb_build_object('curated',true,'import_owned',false,'authorising_issue',2541,
        'owner_instruction_date','2026-11-14','migration','20261115041745',
        'curated_source',jsonb_build_object('source_system','disney_opa','source_table','plm.opa_property',
          'licensed_property_id','640','studio_code',v_studio640)),
      'disney_opa','640')
    returning id into v_xm_new;
  end if;
  update core.property set submission_source = 'disney_opa', submission_property_id = '640'
   where id = v_xm_new
     and (submission_source is distinct from 'disney_opa' or submission_property_id is distinct from '640');

  -- (c) Re-point the disney_opa chains. taxonomy_source_ref holds one row per OPA id;
  -- update-or-insert so every OPA id resolves to its own property row.
  insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,source_code,source_name,confidence,raw)
  values ('core','property',v_mm_row,'disney_opa','plm.opa_property','361',null,v_name361,'verified',
          jsonb_build_object('authorising_issue',2541,'identity_method','opa_licensed_property_id','owner_ruling','2026-11-14','migration','20261115041745')),
         ('core','property',v_mm_new,'disney_opa','plm.opa_property','372',null,v_name372,'verified',
          jsonb_build_object('authorising_issue',2541,'identity_method','opa_licensed_property_id','owner_ruling','2026-11-14','migration','20261115041745')),
         ('core','property',v_xm_new,'disney_opa','plm.opa_property','640',null,v_name640,'verified',
          jsonb_build_object('authorising_issue',2541,'identity_method','opa_licensed_property_id','owner_ruling','2026-11-14','migration','20261115041745')),
         ('core','property',v_xm_row,'disney_opa','plm.opa_property','1107',null,v_name1107,'verified',
          jsonb_build_object('authorising_issue',2541,'identity_method','opa_licensed_property_id','owner_ruling','2026-11-14','migration','20261115041745'))
  on conflict (source_system, source_table, source_id)
  do update set entity_id = excluded.entity_id,
                source_name = excluded.source_name,
                confidence = excluded.confidence,
                raw = excluded.raw;

  -- source_resolution: same four chains, through the governed setter. The setter's optimistic
  -- check requires the current updated_at when replacing an existing decision.
  select updated_at into v_ts from plm.source_resolution
   where source_system = 'disney_opa' and entity_kind = 'property' and source_id = '361';
  perform plm.set_source_resolution('disney_opa'::text,'property'::text,'361','matched'::text,
    v_mm_row, null::uuid, null::uuid, null::uuid, v_reason, v_ts);
  select updated_at into v_ts from plm.source_resolution
   where source_system = 'disney_opa' and entity_kind = 'property' and source_id = '372';
  perform plm.set_source_resolution('disney_opa'::text,'property'::text,'372','matched'::text,
    v_mm_new, null::uuid, null::uuid, null::uuid, v_reason, v_ts);
  select updated_at into v_ts from plm.source_resolution
   where source_system = 'disney_opa' and entity_kind = 'property' and source_id = '640';
  perform plm.set_source_resolution('disney_opa'::text,'property'::text,'640','matched'::text,
    v_xm_new, null::uuid, null::uuid, null::uuid, v_reason, v_ts);
  select updated_at into v_ts from plm.source_resolution
   where source_system = 'disney_opa' and entity_kind = 'property' and source_id = '1107';
  perform plm.set_source_resolution('disney_opa'::text,'property'::text,'1107','matched'::text,
    v_xm_row, null::uuid, null::uuid, null::uuid, v_reason, v_ts);
end
$fix_forward_6209$;

-- (d) #2541 post-condition, unchanged in substance from 20261112225250 and kept in its own
-- DO block AFTER the writes: every studio-placed OPA property has one ref to a row under its
-- studio licensor carrying its exact submission name, and a matched resolution to that row.
do $fix_forward_6209_post$
declare
  v_n integer;
  v_expected integer;
begin
  if to_regclass('plm.opa_property') is null or to_regclass('plm.opa_property_studio_resolution') is null then
    raise notice '#2541 fix-forward post-condition: landing absent; nothing to do';
    return;
  end if;
  select count(*) into v_expected
    from plm.opa_property o join plm.opa_property_studio_resolution s using (licensed_property_id)
   where s.resolution_status = 'canonical';
  if v_expected = 0 then
    raise notice '#2541 fix-forward post-condition: no studio-placed OPA properties; nothing to do';
    return;
  end if;
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
end
$fix_forward_6209_post$;
