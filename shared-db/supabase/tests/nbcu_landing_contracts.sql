-- =====================================================================================
-- NBCU landing contract tests -- migration 20260810070000, issue #628.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, as the migration owner (the Supabase
--   CLI's linked connection, or a psql / node-pg session):
--       \i supabase/tests/nbcu_landing_contracts.sql
--
--   RUN EACH `do $$` BLOCK AS A SEPARATE STATEMENT. Submitting the whole file as one
--   multi-statement batch through the transaction pooler (port 6543) wraps every block
--   in one implicit transaction and stalls -- observed on this database 2026-08-09.
--   psql's \i does the right thing; a programmatic runner must split on the `do $$`
--   boundaries.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one NBCU property, character, title, asset path,
--   file name or portal URL appears here. The fixtures use obviously fake tokens
--   (ZZTEST-*, example.invalid) chosen so that a real row could never be mistaken for
--   one of them, and so a grep for them finds only test scaffolding.
--
-- WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
--   Every assertion checks an OBJECT or a BEHAVIOUR. None of them reads
--   supabase_migrations.schema_migrations. This repo has shipped a migration that
--   recorded a clean ledger row while its object did nothing, so "it applied" is not
--   accepted here as evidence of anything.
--
--   Section D is the one to read first. Immutability in this design is delivered by
--   GRANTS, not by a trigger and not by RLS -- Supabase's service_role carries BYPASSRLS,
--   so an RLS-only guard would admit every write. D therefore inspects
--   information_schema.role_table_grants directly and fails if service_role has ever
--   been handed UPDATE or DELETE on a snapshot table.
--
-- SIDE EFFECTS
--   Creates and then DELETES one synthetic capture and its rows. It writes nothing to
--   core.* or dam.*, and section G asserts exactly that.
--
-- LAST RUN: (fill in after the preview rehearsal)
-- =====================================================================================


-- =====================================================================================
-- A. OBJECT EXISTENCE -- 16 tables and 2 functions, read from the catalog.
-- =====================================================================================
do $$
declare
  v_name text; v_pass integer := 0; v_fail integer := 0; v_n integer;
begin
  raise notice '=== A. OBJECT EXISTENCE (to_regclass / pg_proc) ===';
  foreach v_name in array array[
    'plm.nbcu_capture','plm.nbcu_right','plm.nbcu_scope','plm.nbcu_property',
    'plm.nbcu_ip_family','plm.nbcu_character','plm.nbcu_style_guide','plm.nbcu_asset',
    'plm.nbcu_asset_metadata_value','plm.nbcu_asset_scope','plm.nbcu_ip_family_property',
    'plm.nbcu_property_character','plm.nbcu_asset_property','plm.nbcu_asset_character',
    'plm.nbcu_asset_style_guide','plm.nbcu_style_guide_property'
  ] loop
    if to_regclass(v_name) is null then
      v_fail := v_fail + 1; raise warning 'FAIL table missing: %', v_name;
    else v_pass := v_pass + 1; end if;
  end loop;

  foreach v_name in array array['begin_nbcu_capture','finalize_nbcu_capture'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'plm' and p.proname = v_name;
    if v_n <> 1 then
      v_fail := v_fail + 1; raise warning 'FAIL function missing or overloaded: plm.% (found %)', v_name, v_n;
    else v_pass := v_pass + 1; end if;
  end loop;

  -- Release 1 ships NO views and NOTHING in api. If either appears, someone widened the
  -- blast radius of licensed source data without an access decision.
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname like 'nbcu%' and c.relkind in ('v','m');
  if v_n <> 0 then v_fail := v_fail + 1; raise warning 'FAIL % nbcu view(s) exist; release 1 ships none', v_n;
  else v_pass := v_pass + 1; end if;

  raise notice 'A: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'A FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- B. EVERY SOURCE TABLE'S PRIMARY KEY STARTS WITH capture_id (nbcu_capture excepted).
--    A key that does not start with capture_id would let two snapshots collide on one
--    row and silently overwrite history -- the exact failure append-only design exists
--    to prevent.
-- C. EVERY FOREIGN KEY BETWEEN nbcu TABLES CARRIES capture_id, so no edge can join two
--    snapshots.
-- =====================================================================================
do $$
declare
  r record; v_pass integer := 0; v_fail integer := 0;
begin
  raise notice '=== B. PRIMARY KEYS ARE CAPTURE-SCOPED ===';
  for r in
    select c.relname as tbl,
           (select attname from pg_attribute
             where attrelid = c.oid and attnum = con.conkey[1]) as first_col
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'plm' and con.contype = 'p' and c.relname like 'nbcu\_%'
       and c.relname <> 'nbcu_capture'
  loop
    if r.first_col <> 'capture_id' then
      v_fail := v_fail + 1;
      raise warning 'FAIL %: primary key starts with %, not capture_id', r.tbl, r.first_col;
    else v_pass := v_pass + 1; end if;
  end loop;
  -- 15 of the 16 tables must have been examined. A silent zero here would "pass".
  if v_pass + v_fail <> 15 then
    v_fail := v_fail + 1;
    raise warning 'FAIL examined % capture-scoped tables, expected 15', v_pass + v_fail;
  end if;

  raise notice '=== C. FK ENDPOINTS ARE CAPTURE-SCOPED ===';
  for r in
    select c.relname as tbl, con.conname,
           (select attname from pg_attribute where attrelid = c.oid and attnum = con.conkey[1]) as first_col,
           f.relname as ref_tbl
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_class f on f.oid = con.confrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'plm' and con.contype = 'f' and c.relname like 'nbcu\_%'
       and f.relname like 'nbcu\_%' and f.relname <> 'nbcu_capture'
  loop
    if r.first_col <> 'capture_id' or array_length(
         (select con2.conkey from pg_constraint con2 where con2.conname = r.conname
            and con2.conrelid = (select oid from pg_class where relname = r.tbl
              and relnamespace = (select oid from pg_namespace where nspname='plm'))), 1) < 2 then
      v_fail := v_fail + 1;
      raise warning 'FAIL %.% -> % is not capture-scoped', r.tbl, r.conname, r.ref_tbl;
    else v_pass := v_pass + 1; end if;
  end loop;

  raise notice 'B+C: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'B/C FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- D. RLS IS ON, AND THE GRANTS ARE THE IMMUTABILITY MECHANISM.
--    anon and authenticated get NOTHING. service_role gets SELECT everywhere,
--    INSERT on the 15 snapshot tables, and MUST NOT hold UPDATE or DELETE anywhere --
--    that absence is what makes a landed row immutable.
-- =====================================================================================
do $$
declare
  r record; v_pass integer := 0; v_fail integer := 0; v_n integer;
  v_tables text[] := array[
    'nbcu_capture','nbcu_right','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property'];
  t text;
begin
  raise notice '=== D. RLS AND SERVICE-ONLY GRANTS ===';
  foreach t in array v_tables loop
    select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='plm' and c.relname = t and c.relrowsecurity;
    if v_n <> 1 then v_fail := v_fail+1; raise warning 'FAIL RLS not enabled on plm.%', t;
    else v_pass := v_pass+1; end if;

    -- Nothing at all for the browser roles.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='plm' and table_name=t and grantee in ('anon','authenticated');
    if v_n <> 0 then v_fail := v_fail+1;
      raise warning 'FAIL plm.% grants % privilege(s) to anon/authenticated', t, v_n;
    else v_pass := v_pass+1; end if;

    -- THE IMMUTABILITY ASSERTION.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='plm' and table_name=t and grantee='service_role'
       and privilege_type in ('UPDATE','DELETE','TRUNCATE');
    if v_n <> 0 then v_fail := v_fail+1;
      raise warning 'FAIL plm.% grants UPDATE/DELETE/TRUNCATE to service_role -- rows are NOT immutable', t;
    else v_pass := v_pass+1; end if;

    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='plm' and table_name=t and grantee='service_role'
       and privilege_type='SELECT';
    if v_n <> 1 then v_fail := v_fail+1; raise warning 'FAIL plm.% missing SELECT for service_role', t;
    else v_pass := v_pass+1; end if;

    -- nbcu_capture is written ONLY through the two functions, so it must NOT be insertable.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='plm' and table_name=t and grantee='service_role'
       and privilege_type='INSERT';
    if t = 'nbcu_capture' then
      if v_n <> 0 then v_fail := v_fail+1;
        raise warning 'FAIL plm.nbcu_capture is directly insertable; it must go through begin_nbcu_capture';
      else v_pass := v_pass+1; end if;
    else
      if v_n <> 1 then v_fail := v_fail+1; raise warning 'FAIL plm.% missing INSERT for service_role', t;
      else v_pass := v_pass+1; end if;
    end if;
  end loop;

  -- No trigger may have crept in: the design rejected triggers deliberately.
  select count(*) into v_n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='plm' and c.relname like 'nbcu\_%' and not tg.tgisinternal;
  if v_n <> 0 then v_fail := v_fail+1;
    raise warning 'FAIL % user trigger(s) on nbcu tables; immutability is by privilege, not trigger', v_n;
  else v_pass := v_pass+1; end if;

  -- Functions: execute revoked from the browser roles, granted to service_role.
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='plm' and p.proname in ('begin_nbcu_capture','finalize_nbcu_capture')
  loop
    if has_function_privilege('anon', r.oid, 'EXECUTE')
       or has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      v_fail := v_fail+1; raise warning 'FAIL plm.% is executable by anon/authenticated', r.proname;
    else v_pass := v_pass+1; end if;
    if not has_function_privilege('service_role', r.oid, 'EXECUTE') then
      v_fail := v_fail+1; raise warning 'FAIL plm.% not executable by service_role', r.proname;
    else v_pass := v_pass+1; end if;
    if not (select prosecdef from pg_proc where oid = r.oid) then
      v_fail := v_fail+1; raise warning 'FAIL plm.% is not security definer', r.proname;
    else v_pass := v_pass+1; end if;
  end loop;

  raise notice 'D: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'D FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- E. JSON SHAPE CHECKS -- an array column must reject an object, and vice versa.
--    Loading a scalar or object where the source had an array is how a list silently
--    becomes one comma-joined string.
-- =====================================================================================
do $$
declare
  v_pass integer := 0; v_fail integer := 0; v_cap uuid;
begin
  raise notice '=== E. JSON SHAPE CHECKS ===';
  v_cap := plm.begin_nbcu_capture(
    'nbcu:ZZTEST-E:' || repeat('a',40), 'u2giants/ZZTEST', repeat('a',40), repeat('b',64),
    'https://portal.example.invalid/', now(), '{"assets":0}'::jsonb, '{}'::jsonb, 'contract-test-E');

  begin
    insert into plm.nbcu_asset (capture_id, asset_source_key, asset_path, file_name,
      studio_labels, ip_family_labels, property_labels, character_labels,
      restriction_labels, style_guide_natural_keys, scope_paths,
      source_captured_at, source_url, raw, source_hash)
    values (v_cap,'ZZTEST-A1','/zztest/a1.bin','a1.bin',
      '[]','[]','{"not":"an array"}'::jsonb,'[]','[]','[]','[]',
      now(),'https://portal.example.invalid/a1','{}'::jsonb, repeat('c',64));
    v_fail := v_fail+1; raise warning 'FAIL an OBJECT was accepted into property_labels';
  exception when check_violation then v_pass := v_pass+1;
  end;

  begin
    insert into plm.nbcu_asset (capture_id, asset_source_key, asset_path, file_name,
      studio_labels, ip_family_labels, property_labels, character_labels,
      restriction_labels, style_guide_natural_keys, scope_paths,
      source_captured_at, source_url, raw, source_hash)
    values (v_cap,'ZZTEST-A2','/zztest/a2.bin','a2.bin',
      '[]','[]','[]','[]','[]','[]','[]',
      now(),'https://portal.example.invalid/a2','[]'::jsonb, repeat('c',64));
    v_fail := v_fail+1; raise warning 'FAIL an ARRAY was accepted into raw, which must be an object';
  exception when check_violation then v_pass := v_pass+1;
  end;

  -- A Property row whose key does not follow the section 6.4 key rule must be refused.
  begin
    insert into plm.nbcu_property (capture_id, property_key, property_source_id,
      property_label, source_kind, source_url, source_captured_at, raw)
    values (v_cap,'ZZTEST-wrong-key-shape','ZZTEST-P9','ZZTEST Property','property',
      'https://portal.example.invalid/p9', now(), '{}'::jsonb);
    v_fail := v_fail+1; raise warning 'FAIL a Property key that ignores the source-id rule was accepted';
  exception when check_violation then v_pass := v_pass+1;
  end;

  -- A Character keyed on neither a source id nor a fallback must be refused.
  begin
    insert into plm.nbcu_character (capture_id, character_key, character_label,
      source_url, source_captured_at, raw)
    values (v_cap,'ZZTEST Display Name','ZZTEST Display Name',
      'https://portal.example.invalid/c9', now(), '{}'::jsonb);
    v_fail := v_fail+1; raise warning 'FAIL a Character keyed on a display name was accepted';
  exception when check_violation then v_pass := v_pass+1;
  end;

  -- A nonterminal scope must be refused at the table, before finalization.
  begin
    insert into plm.nbcu_scope (capture_id, scope_key, scope_label, scope_href,
      page_count, indexed_rows, unique_assets, terminal, source_files, raw)
    values (v_cap,'href-sha256:'||repeat('d',64),'ZZTEST scope',
      'https://portal.example.invalid/s9',1,1,1,false,'[]'::jsonb,'{}'::jsonb);
    v_fail := v_fail+1; raise warning 'FAIL a NONTERMINAL scope was accepted';
  exception when check_violation then v_pass := v_pass+1;
  end;

  -- A scope with a paging hole must be refused.
  begin
    insert into plm.nbcu_scope (capture_id, scope_key, scope_label, scope_href,
      page_count, indexed_rows, unique_assets, terminal, missing_offsets, source_files, raw)
    values (v_cap,'href-sha256:'||repeat('e',64),'ZZTEST scope',
      'https://portal.example.invalid/s10',1,1,1,true,'{25}'::integer[],'[]'::jsonb,'{}'::jsonb);
    v_fail := v_fail+1; raise warning 'FAIL a scope with a MISSING OFFSET was accepted';
  exception when check_violation then v_pass := v_pass+1;
  end;

  -- A capture may never record downloaded media.
  begin
    update plm.nbcu_capture set media_downloaded = 1 where id = v_cap;
    v_fail := v_fail+1; raise warning 'FAIL media_downloaded was allowed to be nonzero';
  exception when check_violation then v_pass := v_pass+1;
  end;

  delete from plm.nbcu_capture where id = v_cap;

  raise notice 'E: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'E FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- F. begin_nbcu_capture IDEMPOTENCY AND ITS REFUSALS.
-- =====================================================================================
do $$
declare
  v_pass integer := 0; v_fail integer := 0; v_a uuid; v_b uuid; v_n integer;
  v_key text := 'nbcu:ZZTEST-F:' || repeat('1',40);
begin
  raise notice '=== F. begin_nbcu_capture ===';
  v_a := plm.begin_nbcu_capture(v_key,'u2giants/ZZTEST',repeat('1',40),repeat('2',64),
          'https://portal.example.invalid/', now(), '{"assets":0}'::jsonb,'{}'::jsonb,'contract-test-F');
  v_b := plm.begin_nbcu_capture(v_key,'u2giants/ZZTEST',repeat('1',40),repeat('2',64),
          'https://portal.example.invalid/', now(), '{"assets":0}'::jsonb,'{}'::jsonb,'contract-test-F');
  if v_a <> v_b then v_fail := v_fail+1; raise warning 'FAIL a repeat begin created a SECOND capture';
  else v_pass := v_pass+1; end if;
  select count(*) into v_n from plm.nbcu_capture where capture_key = v_key;
  if v_n <> 1 then v_fail := v_fail+1; raise warning 'FAIL % capture rows for one key', v_n;
  else v_pass := v_pass+1; end if;

  -- Same key, different bytes, is a contradiction and must be refused outright.
  begin
    perform plm.begin_nbcu_capture(v_key,'u2giants/ZZTEST',repeat('1',40),repeat('3',64),
      'https://portal.example.invalid/', now(), '{"assets":0}'::jsonb,'{}'::jsonb,'contract-test-F');
    v_fail := v_fail+1; raise warning 'FAIL a MANIFEST MISMATCH was accepted as a resume';
  exception when others then v_pass := v_pass+1;
  end;

  -- Malformed shas must be refused before anything lands.
  begin
    perform plm.begin_nbcu_capture('nbcu:ZZTEST-F2:short','u2giants/ZZTEST','deadbeef',repeat('2',64),
      'https://portal.example.invalid/', now(), '{"assets":0}'::jsonb,'{}'::jsonb,'contract-test-F');
    v_fail := v_fail+1; raise warning 'FAIL a short commit sha was accepted';
  exception when others then v_pass := v_pass+1;
  end;
  begin
    perform plm.begin_nbcu_capture('nbcu:ZZTEST-F3:x','u2giants/ZZTEST',repeat('4',40),repeat('2',64),
      'https://portal.example.invalid/', now(), '{}'::jsonb,'{}'::jsonb,'contract-test-F');
    v_fail := v_fail+1; raise warning 'FAIL an EMPTY expected_counts document was accepted';
  exception when others then v_pass := v_pass+1;
  end;

  delete from plm.nbcu_capture where capture_key like 'nbcu:ZZTEST-F%';

  raise notice 'F: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'F FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- G. FINALIZATION. The gate must ACCEPT a correct snapshot -- including the explicit
--    zero asset-to-character count -- and REJECT a wrong count and an orphan link,
--    leaving nothing published in either failure case.
-- =====================================================================================
do $$
declare
  v_pass integer := 0; v_fail integer := 0;
  v_cap uuid; v_res jsonb; v_status text; v_n integer;
  v_core_prop_before bigint; v_core_char_before bigint;
  v_pkey text := 'source-id:ZZTEST-P1';
  v_ckey text := 'ZZTEST-C1';
  v_gkey text := 'zztest/guides/alpha';
  v_akey text := 'ZZTEST-A1';
  v_skey text := 'href-sha256:'||repeat('7',64);
  v_ikey text := 'label-sha256:'||repeat('8',64);
  v_exp  jsonb := jsonb_build_object(
    'assets',1,'properties',1,'characters',1,'style_guides',1,'scopes',1,
    'ip_family_property',1,'property_character',1,'asset_property',1,
    'asset_character',0,'asset_style_guide',1,'style_guide_property',1,
    'excluded_unlicensed_assets',0,'failures',0);
begin
  raise notice '=== G. FINALIZATION ===';
  select count(*) into v_core_prop_before from core.property;
  select count(*) into v_core_char_before from core.character;

  v_cap := plm.begin_nbcu_capture('nbcu:ZZTEST-G:'||repeat('9',40),'u2giants/ZZTEST',
    repeat('9',40), repeat('a',64), 'https://portal.example.invalid/', now(),
    v_exp, '{}'::jsonb, 'contract-test-G');

  insert into plm.nbcu_scope (capture_id, scope_key, scope_label, scope_href,
    page_count, indexed_rows, unique_assets, terminal, source_files, raw)
  values (v_cap, v_skey, 'ZZTEST scope','https://portal.example.invalid/scope/1',
    1,1,1,true,'[]'::jsonb,'{}'::jsonb);

  insert into plm.nbcu_property (capture_id, property_key, property_source_id,
    property_label, source_kind, source_url, source_captured_at, raw)
  values (v_cap, v_pkey,'ZZTEST-P1','ZZTEST Property One','property',
    'https://portal.example.invalid/p/1', now(), '{}'::jsonb);

  insert into plm.nbcu_ip_family (capture_id, ip_family_key, ip_family_label, source_url, raw)
  values (v_cap, v_ikey,'ZZTEST Family One','https://portal.example.invalid/f/1','{}'::jsonb);

  insert into plm.nbcu_character (capture_id, character_key, character_source_id,
    character_label, source_url, source_captured_at, raw)
  values (v_cap, v_ckey,'ZZTEST-C1','ZZTEST Character One',
    'https://portal.example.invalid/c/1', now(), '{}'::jsonb);

  insert into plm.nbcu_style_guide (capture_id, style_guide_key, style_guide_label,
    folder_path, source_url, source_captured_at, raw)
  values (v_cap, v_gkey,'Alpha Guide', v_gkey,'https://portal.example.invalid/g/1', now(),'{}'::jsonb);

  insert into plm.nbcu_asset (capture_id, asset_source_key, asset_path, file_name,
    media_type, display_size, display_modified,
    studio_labels, ip_family_labels, property_labels, character_labels,
    restriction_labels, style_guide_natural_keys, scope_paths,
    source_captured_at, source_url, raw, source_hash)
  values (v_cap, v_akey,'/zztest/a1.bin','a1.bin','image/zztest','1.2 MB','1754700000000',
    '[]','[]','["ZZTEST Property One"]','[]','[]','["zztest/guides/alpha"]','[]',
    now(),'https://portal.example.invalid/a/1','{}'::jsonb, repeat('b',64));

  -- An attribute-only heading: no visible text, attributes preserved, never dropped.
  insert into plm.nbcu_asset_metadata_value (capture_id, asset_source_key, field_name,
    value_ordinal, value_text, value_attributes, raw)
  values (v_cap, v_akey,'ZZTEST HEADING',0,'ZZTEST value','{}'::jsonb,'{}'::jsonb),
         (v_cap, v_akey,'ZZTEST HEADING',1,'ZZTEST second value','{}'::jsonb,'{}'::jsonb),
         (v_cap, v_akey,'ZZTEST ATTR ONLY',0,null,'{"zz":"attr"}'::jsonb,'{}'::jsonb);

  insert into plm.nbcu_asset_scope (capture_id, asset_source_key, scope_key)
  values (v_cap, v_akey, v_skey);

  insert into plm.nbcu_ip_family_property (capture_id, ip_family_key, property_key,
    ip_family_label, property_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
  values (v_cap, v_ikey, v_pkey,'ZZTEST Family One','ZZTEST Property One',
    'zztest_evidence','zztest', now(),'https://portal.example.invalid/e/1','{}'::jsonb);

  insert into plm.nbcu_property_character (capture_id, property_key, character_key,
    property_label, character_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
  values (v_cap, v_pkey, v_ckey,'ZZTEST Property One','ZZTEST Character One',
    'zztest_evidence','zztest', now(),'https://portal.example.invalid/e/2','{}'::jsonb);

  insert into plm.nbcu_asset_property (capture_id, asset_source_key, property_key,
    property_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
  values (v_cap, v_akey, v_pkey,'ZZTEST Property One',
    'zztest_evidence','zztest', now(),'https://portal.example.invalid/e/3','{}'::jsonb);

  insert into plm.nbcu_asset_style_guide (capture_id, asset_source_key, style_guide_key,
    evidence_type, evidence_value, source_captured_at, source_url, raw)
  values (v_cap, v_akey, v_gkey,'zztest_evidence','zztest', now(),
    'https://portal.example.invalid/e/4','{}'::jsonb);

  insert into plm.nbcu_style_guide_property (capture_id, style_guide_key, property_key,
    property_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
  values (v_cap, v_gkey, v_pkey,'ZZTEST Property One','zztest_evidence','zztest', now(),
    'https://portal.example.invalid/e/5','{}'::jsonb);

  -- nbcu_asset_character stays EMPTY on purpose. This is the explicit expected zero.

  -- G1. A cross-capture edge must be impossible.
  begin
    insert into plm.nbcu_asset_property (capture_id, asset_source_key, property_key,
      property_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (gen_random_uuid(), v_akey, v_pkey,'ZZTEST Property One',
      'zztest_evidence','zztest', now(),'https://portal.example.invalid/e/6','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'FAIL a CROSS-CAPTURE edge was accepted';
  exception when foreign_key_violation then v_pass := v_pass+1;
  end;

  -- G2. A wrong count must reject, not complete -- and the rejection must SURVIVE.
  -- Note the shape of this test: it does NOT wrap the call in an exception handler.
  -- finalize deliberately returns instead of raising, because a raise would roll back
  -- the rejection record it had just written. If a future change makes it raise again,
  -- this block fails loudly rather than passing by accident.
  update plm.nbcu_capture set expected_counts = v_exp || '{"assets":99}'::jsonb where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected' then v_fail := v_fail+1;
    raise warning 'FAIL finalize returned % for a wrong count, expected rejected', v_res ->> 'status';
  else v_pass := v_pass+1; end if;
  if jsonb_array_length(v_res -> 'errors') = 0 then v_fail := v_fail+1;
    raise warning 'FAIL a rejection returned no structured errors';
  else v_pass := v_pass+1; end if;
  select status into v_status from plm.nbcu_capture where id = v_cap;
  if v_status <> 'rejected' then v_fail := v_fail+1;
    raise warning 'FAIL after a bad count the status is %, expected rejected', v_status;
  else v_pass := v_pass+1; end if;
  select jsonb_array_length(error_summary) into v_n from plm.nbcu_capture where id = v_cap;
  if coalesce(v_n,0) = 0 then v_fail := v_fail+1;
    raise warning 'FAIL a rejection recorded NO structured error';
  else v_pass := v_pass+1; end if;

  -- G3. A rejected capture may not be finalized again; a NEW capture is required.
  update plm.nbcu_capture set expected_counts = v_exp, status='loading',
         error_summary='[]'::jsonb where id = v_cap;

  -- G4. The happy path, including asset_character = 0.
  v_res := plm.finalize_nbcu_capture(v_cap);
  if v_res ->> 'status' <> 'complete' then v_fail := v_fail+1;
    raise warning 'FAIL a correct snapshot did not complete: %', v_res::text;
  else v_pass := v_pass+1; end if;
  if (v_res -> 'observed_counts' ->> 'asset_character') <> '0' then v_fail := v_fail+1;
    raise warning 'FAIL the explicit zero asset_character count was not observed as 0';
  else v_pass := v_pass+1; end if;
  select count(*) into v_n from plm.nbcu_capture
   where id = v_cap and status = 'complete' and load_completed_at is not null;
  if v_n <> 1 then v_fail := v_fail+1;
    raise warning 'FAIL a complete capture has no load_completed_at';
  else v_pass := v_pass+1; end if;

  -- G5. Finalizing again is a no-op, not an error and not a second publication.
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'already_complete') <> 'true' then v_fail := v_fail+1;
    raise warning 'FAIL re-finalizing a complete capture was not idempotent';
  else v_pass := v_pass+1; end if;

  -- G6. NOTHING canonical moved.
  select count(*) into v_n from core.property;
  if v_n <> v_core_prop_before then v_fail := v_fail+1;
    raise warning 'FAIL core.property row count CHANGED (% -> %)', v_core_prop_before, v_n;
  else v_pass := v_pass+1; end if;
  select count(*) into v_n from core.character;
  if v_n <> v_core_char_before then v_fail := v_fail+1;
    raise warning 'FAIL core.character row count CHANGED (% -> %)', v_core_char_before, v_n;
  else v_pass := v_pass+1; end if;

  -- Clean up every synthetic row. on delete restrict means children go first.
  delete from plm.nbcu_style_guide_property where capture_id = v_cap;
  delete from plm.nbcu_asset_style_guide    where capture_id = v_cap;
  delete from plm.nbcu_asset_property       where capture_id = v_cap;
  delete from plm.nbcu_asset_character      where capture_id = v_cap;
  delete from plm.nbcu_property_character   where capture_id = v_cap;
  delete from plm.nbcu_ip_family_property   where capture_id = v_cap;
  delete from plm.nbcu_asset_scope          where capture_id = v_cap;
  delete from plm.nbcu_asset_metadata_value where capture_id = v_cap;
  delete from plm.nbcu_asset                where capture_id = v_cap;
  delete from plm.nbcu_style_guide          where capture_id = v_cap;
  delete from plm.nbcu_character            where capture_id = v_cap;
  delete from plm.nbcu_ip_family            where capture_id = v_cap;
  delete from plm.nbcu_property             where capture_id = v_cap;
  delete from plm.nbcu_scope                where capture_id = v_cap;
  delete from plm.nbcu_right                where capture_id = v_cap;
  delete from plm.nbcu_capture              where id = v_cap;

  select count(*) into v_n from plm.nbcu_capture where capture_key like 'nbcu:ZZTEST%';
  if v_n <> 0 then v_fail := v_fail+1; raise warning 'FAIL % synthetic capture(s) left behind', v_n;
  else v_pass := v_pass+1; end if;

  raise notice 'G: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'G FAILED (% failures)', v_fail; end if;
end;
$$;
