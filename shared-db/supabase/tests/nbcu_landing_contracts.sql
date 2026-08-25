-- =====================================================================================
-- NBCU landing contract tests -- migration 20260810070000, issue #628,
-- EXTENDED by migration 20260811070000, issue #757 (the Asset-to-Franchise relationship).
--
-- THIS FILE NOW REQUIRES 20260811070000. Sections A, B, D, G, H and I all expect
-- plm.nbcu_asset_ip_family to exist and the NBCU family to be SEVENTEEN tables. Run it
-- only against a database where that migration has been applied; against a 16-table
-- database it fails immediately in section A, by design, rather than passing vacuously.
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
--   Creates and then DELETES synthetic captures and their rows (section G one, section H
--   two). It writes nothing to core.* or dam.*, and section G asserts exactly that.
--
-- LAST RUN: (fill in after the preview rehearsal)
-- =====================================================================================


-- =====================================================================================
-- A. OBJECT EXISTENCE -- 16 tables and 2 functions, read from the catalog.
--    The sixteenth, plm.nbcu_asset_ip_family, arrives with migration 20260811070000
--    (issue #757). NOTE FOR WHOEVER SEES THIS FAIL: this file REQUIRES that migration.
--    Until it is applied to the database under test, section A fails on the missing
--    table -- that is the intended coupling, not a bug in the test.
-- =====================================================================================
do $$
declare
  v_name text; v_pass integer := 0; v_fail integer := 0; v_n integer;
begin
  raise notice '=== A. OBJECT EXISTENCE (to_regclass / pg_proc) ===';
  foreach v_name in array array[
    'plm.nbcu_capture','plm.nbcu_scope','plm.nbcu_property',
    'plm.nbcu_ip_family','plm.nbcu_character','plm.nbcu_style_guide','plm.nbcu_asset',
    'plm.nbcu_asset_metadata_value','plm.nbcu_asset_scope','plm.nbcu_ip_family_property',
    'plm.nbcu_property_character','plm.nbcu_asset_property','plm.nbcu_asset_character',
    'plm.nbcu_asset_style_guide','plm.nbcu_style_guide_property',
    'plm.nbcu_asset_ip_family'
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

-- A1. PROPERTY SOURCE KIND IS OPEN TO REVIEWED VALUES BUT NEVER BLANK.
-- All labels and identifiers below are synthetic public test tokens.
do $$
declare
  v_cap uuid;
  v_kind text;
  v_n integer;
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'plm.nbcu_property'::regclass
       and conname = 'nbcu_property_source_kind_chk'
  ) then
    raise exception 'A1 FAILED: the retired closed-list source_kind check still exists';
  end if;

  if not exists (
    select 1
     from pg_constraint
     where conrelid = 'plm.nbcu_property'::regclass
       and conname = 'nbcu_property_source_kind_nonblank_chk'
       and pg_get_constraintdef(oid) like '%source_kind ~%[^[:space:]]%'
  ) then
    raise exception 'A1 FAILED: the nonblank source_kind check is missing or malformed';
  end if;

  v_cap := plm.begin_nbcu_capture(
    'nbcu:ZZTEST-J:' || repeat('7', 40),
    'u2giants/ZZTEST',
    repeat('7', 40),
    repeat('8', 64),
    'https://portal.example.invalid/',
    now(),
    '{"properties":4}'::jsonb,
    '{}'::jsonb,
    'contract-test-A1'
  );

  foreach v_kind in array array[
    'property',
    'franchise_asset',
    'asset_metadata_label',
    'future_reviewed_kind'
  ] loop
    insert into plm.nbcu_property (
      capture_id, property_key, property_source_id, property_label,
      source_kind, source_url, source_captured_at, raw
    ) values (
      v_cap, 'source-id:ZZTEST-J-' || v_kind, 'ZZTEST-J-' || v_kind,
      'ZZTEST Source Kind', v_kind,
      'https://portal.example.invalid/source-kind', now(), '{}'::jsonb
    );
  end loop;

  select count(*) into v_n
    from plm.nbcu_property
   where capture_id = v_cap;
  if v_n <> 4 then
    raise exception 'A1 FAILED: expected four accepted synthetic source kinds, got %', v_n;
  end if;

  begin
    insert into plm.nbcu_property (
      capture_id, property_key, property_source_id, property_label,
      source_kind, source_url, source_captured_at, raw
    ) values (
      v_cap, 'source-id:ZZTEST-J-empty', 'ZZTEST-J-empty',
      'ZZTEST Source Kind', '',
      'https://portal.example.invalid/source-kind', now(), '{}'::jsonb
    );
    raise exception 'A1 FAILED: empty source_kind was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into plm.nbcu_property (
      capture_id, property_key, property_source_id, property_label,
      source_kind, source_url, source_captured_at, raw
    ) values (
      v_cap, 'source-id:ZZTEST-J-tab', 'ZZTEST-J-tab',
      'ZZTEST Source Kind', E'\t\t',
      'https://portal.example.invalid/source-kind', now(), '{}'::jsonb
    );
    raise exception 'A1 FAILED: tab-only source_kind was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into plm.nbcu_property (
      capture_id, property_key, property_source_id, property_label,
      source_kind, source_url, source_captured_at, raw
    ) values (
      v_cap, 'source-id:ZZTEST-J-newline', 'ZZTEST-J-newline',
      'ZZTEST Source Kind', E'\r\n',
      'https://portal.example.invalid/source-kind', now(), '{}'::jsonb
    );
    raise exception 'A1 FAILED: line-break-only source_kind was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into plm.nbcu_property (
      capture_id, property_key, property_source_id, property_label,
      source_kind, source_url, source_captured_at, raw
    ) values (
      v_cap, 'source-id:ZZTEST-J-space', 'ZZTEST-J-space',
      'ZZTEST Source Kind', '   ',
      'https://portal.example.invalid/source-kind', now(), '{}'::jsonb
    );
    raise exception 'A1 FAILED: whitespace-only source_kind was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into plm.nbcu_property (
      capture_id, property_key, property_source_id, property_label,
      source_kind, source_url, source_captured_at, raw
    ) values (
      v_cap, 'source-id:ZZTEST-J-null', 'ZZTEST-J-null',
      'ZZTEST Source Kind', null,
      'https://portal.example.invalid/source-kind', now(), '{}'::jsonb
    );
    raise exception 'A1 FAILED: NULL source_kind was accepted';
  exception when not_null_violation then null;
  end;

  delete from plm.nbcu_property where capture_id = v_cap;
  delete from plm.nbcu_capture where id = v_cap;
  raise notice 'A1: source_kind open-value and nonblank contract passed';
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
  -- 15 of the 16 tables must have been examined (nbcu_capture is keyed on its own id).
  -- A silent zero here would "pass". #757 added plm.nbcu_asset_ip_family;
  -- #1242 later removed the contract-derived plm.nbcu_right table.
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
--    anon gets NOTHING. authenticated gets SELECT and only SELECT, gated by the
--    <table>_plm_read policy added for issue #1249. service_role gets SELECT everywhere,
--    INSERT on the 15 snapshot tables, and MUST NOT hold UPDATE or DELETE anywhere --
--    that absence is what makes a landed row immutable.
--    (14 -> 15 snapshot tables with #757's plm.nbcu_asset_ip_family; nbcu_capture is
--    still the one table service_role may not INSERT into directly.)
-- =====================================================================================
do $$
declare
  r record; v_pass integer := 0; v_fail integer := 0; v_n integer;
  v_tables text[] := array[
    'nbcu_capture','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property','nbcu_asset_ip_family'];
  t text;
begin
  raise notice '=== D. RLS AND SERVICE-ONLY GRANTS ===';
  foreach t in array v_tables loop
    select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='plm' and c.relname = t and c.relrowsecurity;
    if v_n <> 1 then v_fail := v_fail+1; raise warning 'FAIL RLS not enabled on plm.%', t;
    else v_pass := v_pass+1; end if;

    -- Nothing at all for anon.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='plm' and table_name=t and grantee = 'anon';
    if v_n <> 0 then v_fail := v_fail+1;
      raise warning 'FAIL plm.% grants % privilege(s) to anon', t, v_n;
    else v_pass := v_pass+1; end if;

    -- CHANGED BY MIGRATION 20260819151510 (issue #1249, the owner ruling "scrape data
    -- should be visible to Licensing department users"). This assertion used to require
    -- that `authenticated` held nothing. It now holds SELECT and only SELECT, and a
    -- `<table>_plm_read` RLS policy -- not the grant -- decides who that SELECT actually
    -- returns rows to. Who is admitted is proved behaviourally in
    -- supabase/tests/wildbrain_nbcu_licensing_read_access_contracts.sql; what this file
    -- keeps asserting is that the grant did not widen past reads.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='plm' and table_name=t
       and grantee='authenticated' and privilege_type='SELECT';
    if v_n <> 1 then v_fail := v_fail+1;
      raise warning 'FAIL plm.% does not grant SELECT to authenticated (issue #1249)', t;
    else v_pass := v_pass+1; end if;

    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='plm' and table_name=t
       and grantee='authenticated' and privilege_type<>'SELECT';
    if v_n <> 0 then v_fail := v_fail+1;
      raise warning 'FAIL plm.% grants % non-SELECT privilege(s) to authenticated -- '
        '#1249 widened READS only', t, v_n;
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

  -- Issue #963 adds exactly four fail-closed guards for the deprecated resolution columns.
  -- Snapshot immutability still comes from privileges; no other user trigger is allowed.
  select count(*) into v_n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='plm' and c.relname like 'nbcu\_%' and not tg.tgisinternal;
  if v_n <> 4 then v_fail := v_fail+1;
    raise warning 'FAIL % user trigger(s) on nbcu tables; expected four resolution guards', v_n;
  else v_pass := v_pass+1; end if;

  select count(*) into v_n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='plm' and not tg.tgisinternal
     and tg.tgname in (
       'nbcu_property_resolution_immutable','nbcu_character_resolution_immutable',
       'nbcu_style_guide_resolution_immutable','nbcu_asset_resolution_immutable'
     );
  if v_n <> 4 then v_fail := v_fail+1;
    raise warning 'FAIL only % of four named NBCU resolution guards exist', v_n;
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
  v_msg text;
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
  -- PINNED to the refusal that must have fired. A bare `when others` passes when ANY
  -- error occurs -- including a typo in the test's own statement -- so it stays green
  -- after the guard under test is deleted. That is a test of nothing (issue #1219,
  -- defect pattern 3).
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%DIFFERENT source manifest hash%' then v_pass := v_pass+1;
    else v_fail := v_fail+1;
      raise warning 'FAIL the manifest-mismatch refusal raised the WRONG error: %', v_msg;
    end if;
  end;

  -- Malformed shas must be refused before anything lands.
  begin
    perform plm.begin_nbcu_capture('nbcu:ZZTEST-F2:short','u2giants/ZZTEST','deadbeef',repeat('2',64),
      'https://portal.example.invalid/', now(), '{"assets":0}'::jsonb,'{}'::jsonb,'contract-test-F');
    v_fail := v_fail+1; raise warning 'FAIL a short commit sha was accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%source_commit_sha must be a 40-character lowercase hex sha%'
      then v_pass := v_pass+1;
    else v_fail := v_fail+1;
      raise warning 'FAIL the short-sha refusal raised the WRONG error: %', v_msg;
    end if;
  end;
  begin
    perform plm.begin_nbcu_capture('nbcu:ZZTEST-F3:x','u2giants/ZZTEST',repeat('4',40),repeat('2',64),
      'https://portal.example.invalid/', now(), '{}'::jsonb,'{}'::jsonb,'contract-test-F');
    v_fail := v_fail+1; raise warning 'FAIL an EMPTY expected_counts document was accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%expected_counts must be a non-empty JSON object%' then v_pass := v_pass+1;
    else v_fail := v_fail+1;
      raise warning 'FAIL the empty-expected_counts refusal raised the WRONG error: %', v_msg;
    end if;
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
  v_core_prop_before bigint;
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
    'asset_ip_family',1,
    'excluded_unlicensed_assets',0,'failures',0);
begin
  raise notice '=== G. FINALIZATION ===';
  select count(*) into v_core_prop_before from core.property;

  if to_regclass('core.character') is not null then
    raise exception 'retired core.character unexpectedly exists';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'plm.nbcu_character'::regclass
      and attname = 'core_character_id' and not attisdropped and not attnotnull
  ) then
    raise exception 'plm.nbcu_character.core_character_id must remain as a nullable compatibility column';
  end if;
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'plm.nbcu_character'::regclass
      and c.contype = 'f'
      and c.conkey = array[(select attnum from pg_attribute
        where attrelid = 'plm.nbcu_character'::regclass and attname = 'core_character_id')]::smallint[]
  ) then
    raise exception 'plm.nbcu_character.core_character_id still has a foreign key to the retired Universe A table';
  end if;

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

  -- The Asset-to-Franchise link (#757). ip_family_label must equal the label the
  -- nbcu_ip_family row actually carries, or finalize's F2 check rejects the capture.
  insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
    ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
  values (v_cap, v_akey, v_ikey,'ZZTEST Family One','asset_metadata_ip_family','zztest',
    now(),'https://portal.example.invalid/e/7','{}'::jsonb);

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
  -- #757: the new relationship must be OBSERVED, not merely permitted to exist.
  if (v_res -> 'observed_counts' ->> 'asset_ip_family') <> '1' then v_fail := v_fail+1;
    raise warning 'FAIL asset_ip_family was observed as %, expected 1',
      coalesce(v_res -> 'observed_counts' ->> 'asset_ip_family','<absent>');
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
  if to_regclass('core.character') is not null then v_fail := v_fail+1;
    raise warning 'FAIL retired core.character was recreated';
  else v_pass := v_pass+1; end if;

  -- Clean up every synthetic row. on delete restrict means children go first.
  delete from plm.nbcu_style_guide_property where capture_id = v_cap;
  delete from plm.nbcu_asset_ip_family      where capture_id = v_cap;
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
  delete from plm.nbcu_capture              where id = v_cap;

  select count(*) into v_n from plm.nbcu_capture where capture_key like 'nbcu:ZZTEST%';
  if v_n <> 0 then v_fail := v_fail+1; raise warning 'FAIL % synthetic capture(s) left behind', v_n;
  else v_pass := v_pass+1; end if;

  raise notice 'G: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'G FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- H. THE ASSET-TO-FRANCHISE RELATIONSHIP -- plm.nbcu_asset_ip_family (issue #757).
--
--    NBCU calls it a Franchise; the schema calls it an IP Family. One row means the
--    asset metadata EXPLICITLY listed that IP Family for that asset -- nothing else may
--    ever create one.
--
--    EVERY VALUE BELOW IS INVENTED. No NBCU franchise, property, character, asset path,
--    file name or portal URL appears here. ZZTEST-* and example.invalid are chosen so a
--    real row could never be mistaken for one of them.
--
--    This section is self-contained: it builds its own captures and deletes them, so it
--    can be re-run and does not depend on section G's fixture surviving.
-- =====================================================================================
do $$
declare
  v_pass integer := 0; v_fail integer := 0;
  v_cap uuid; v_cap2 uuid; v_res jsonb; v_n integer; v_first text;
  v_akey text := 'ZZTEST-H-A1';
  v_ikey text := 'label-sha256:'||repeat('c',64);
  v_ikey2 text := 'label-sha256:'||repeat('d',64);
  v_exp jsonb := jsonb_build_object(
    'assets',1,'properties',0,'characters',0,'style_guides',0,'scopes',0,
    'ip_family_property',0,'property_character',0,'asset_property',0,
    'asset_character',0,'asset_style_guide',0,'style_guide_property',0,
    'asset_ip_family',1,'excluded_unlicensed_assets',0,'failures',0);
begin
  raise notice '=== H. ASSET-TO-FRANCHISE (nbcu_asset_ip_family) ===';

  -- H1. The table exists.
  if to_regclass('plm.nbcu_asset_ip_family') is null then
    raise exception 'H1 FAILED: plm.nbcu_asset_ip_family does not exist. Apply 20260811070000.';
  end if;
  v_pass := v_pass+1;

  -- H2. Its primary key begins with capture_id, so two snapshots cannot collide.
  select (select attname from pg_attribute where attrelid = c.oid and attnum = con.conkey[1])
    into v_first
    from pg_constraint con join pg_class c on c.oid = con.conrelid
   where c.relnamespace = 'plm'::regnamespace
     and c.relname = 'nbcu_asset_ip_family' and con.contype = 'p';
  if coalesce(v_first,'') <> 'capture_id' then v_fail := v_fail+1;
    raise warning 'H2 FAIL: primary key begins with %, not capture_id', coalesce(v_first,'<none>');
  else v_pass := v_pass+1; end if;

  -- H3. BOTH foreign keys are composite and capture-scoped.
  select count(*) into v_n
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class f on f.oid = con.confrelid
   where c.relnamespace = 'plm'::regnamespace
     and c.relname = 'nbcu_asset_ip_family' and con.contype = 'f'
     and f.relname in ('nbcu_asset','nbcu_ip_family')
     and array_length(con.conkey,1) = 2
     and (select attname from pg_attribute
           where attrelid = c.oid and attnum = con.conkey[1]) = 'capture_id';
  if v_n <> 2 then v_fail := v_fail+1;
    raise warning 'H3 FAIL: % capture-scoped composite FK(s), expected 2', v_n;
  else v_pass := v_pass+1; end if;

  -- Build the fixture: one capture, one asset, two IP families.
  v_cap := plm.begin_nbcu_capture('nbcu:ZZTEST-H:'||repeat('5',40),'u2giants/ZZTEST',
    repeat('5',40), repeat('6',64), 'https://portal.example.invalid/', now(),
    v_exp, '{}'::jsonb, 'contract-test-H');

  insert into plm.nbcu_ip_family (capture_id, ip_family_key, ip_family_label, source_url, raw)
  values (v_cap, v_ikey,'ZZTEST Family H1','https://portal.example.invalid/f/h1','{}'::jsonb),
         (v_cap, v_ikey2,'ZZTEST Family H2','https://portal.example.invalid/f/h2','{}'::jsonb);

  insert into plm.nbcu_asset (capture_id, asset_source_key, asset_path, file_name,
    studio_labels, ip_family_labels, property_labels, character_labels,
    restriction_labels, style_guide_natural_keys, scope_paths,
    source_captured_at, source_url, raw, source_hash)
  values (v_cap, v_akey,'/zztest/h1.bin','h1.bin',
    '[]','["ZZTEST Family H1"]','[]','[]','[]','[]','[]',
    now(),'https://portal.example.invalid/a/h1','{}'::jsonb, repeat('7',64));

  insert into plm.nbcu_asset_metadata_value (capture_id, asset_source_key, field_name,
    value_ordinal, value_text, value_attributes, raw)
  values (v_cap, v_akey,'ZZTEST HEADING',0,'ZZTEST value','{}'::jsonb,'{}'::jsonb);

  -- The one legitimate link, from the exact source label.
  insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
    ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
  values (v_cap, v_akey, v_ikey,'ZZTEST Family H1','asset_metadata_ip_family','zztest',
    now(),'https://portal.example.invalid/e/h1','{}'::jsonb);

  -- H4. A relationship may not cross two captures. Both endpoints exist -- but in the
  -- OTHER capture -- which is exactly the corruption capture scoping prevents.
  v_cap2 := plm.begin_nbcu_capture('nbcu:ZZTEST-H2:'||repeat('8',40),'u2giants/ZZTEST',
    repeat('8',40), repeat('9',64), 'https://portal.example.invalid/', now(),
    '{"assets":0}'::jsonb, '{}'::jsonb, 'contract-test-H');
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap2, v_akey, v_ikey,'ZZTEST Family H1','asset_metadata_ip_family','zztest',
      now(),'https://portal.example.invalid/e/h2','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'H4 FAIL: a CROSS-CAPTURE Asset-to-Franchise link was accepted';
  exception when foreign_key_violation then v_pass := v_pass+1;
  end;

  -- H5. A missing ASSET endpoint is rejected.
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap,'ZZTEST-H-NOSUCH', v_ikey,'ZZTEST Family H1','asset_metadata_ip_family',
      'zztest', now(),'https://portal.example.invalid/e/h3','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'H5 FAIL: a link to a NONEXISTENT asset was accepted';
  exception when foreign_key_violation then v_pass := v_pass+1;
  end;

  -- H6. A missing IP FAMILY endpoint is rejected.
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap, v_akey,'label-sha256:'||repeat('f',64),'ZZTEST Family H9',
      'asset_metadata_ip_family','zztest', now(),
      'https://portal.example.invalid/e/h4','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'H6 FAIL: a link to a NONEXISTENT IP Family was accepted';
  exception when foreign_key_violation then v_pass := v_pass+1;
  end;

  -- H7. A duplicate link is rejected. The loader must be retry-safe WITHOUT creating
  --     duplicates, and the primary key is what makes that true.
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap, v_akey, v_ikey,'ZZTEST Family H1','asset_metadata_ip_family','zztest',
      now(),'https://portal.example.invalid/e/h5','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'H7 FAIL: a DUPLICATE Asset-to-Franchise link was accepted';
  exception when unique_violation then v_pass := v_pass+1;
  end;

  -- H8. Blank label and blank evidence values are rejected.
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap, v_akey, v_ikey2,'   ','asset_metadata_ip_family','zztest', now(),
      'https://portal.example.invalid/e/h6','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'H8 FAIL: a BLANK ip_family_label was accepted';
  exception when check_violation then v_pass := v_pass+1;
  end;
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap, v_akey, v_ikey2,'ZZTEST Family H2','','zztest', now(),
      'https://portal.example.invalid/e/h7','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'H8 FAIL: a BLANK evidence_type was accepted';
  exception when check_violation then v_pass := v_pass+1;
  end;
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap, v_akey, v_ikey2,'ZZTEST Family H2','asset_metadata_ip_family','  ', now(),
      'https://portal.example.invalid/e/h8','{}'::jsonb);
    v_fail := v_fail+1; raise warning 'H8 FAIL: a BLANK evidence_value was accepted';
  exception when check_violation then v_pass := v_pass+1;
  end;

  -- H9. `raw` must be a JSON OBJECT. An array or scalar here is how a source record
  --     silently degrades into something that cannot be replayed.
  begin
    insert into plm.nbcu_asset_ip_family (capture_id, asset_source_key, ip_family_key,
      ip_family_label, evidence_type, evidence_value, source_captured_at, source_url, raw)
    values (v_cap, v_akey, v_ikey2,'ZZTEST Family H2','asset_metadata_ip_family','zztest',
      now(),'https://portal.example.invalid/e/h9','[]'::jsonb);
    v_fail := v_fail+1; raise warning 'H9 FAIL: a JSON ARRAY was accepted into raw';
  exception when check_violation then v_pass := v_pass+1;
  end;

  -- H10. finalize ACCEPTS the correct expected count.
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'complete' then v_fail := v_fail+1;
    raise warning 'H10 FAIL: a correct snapshot did not complete: %', v_res::text;
  else v_pass := v_pass+1; end if;
  if (v_res -> 'observed_counts' ->> 'asset_ip_family') <> '1' then v_fail := v_fail+1;
    raise warning 'H10 FAIL: asset_ip_family observed as %, expected 1',
      coalesce(v_res -> 'observed_counts' ->> 'asset_ip_family','<absent>');
  else v_pass := v_pass+1; end if;

  -- H11. finalize REJECTS a wrong expected count. Without this the whole gate is
  --      decoration: a loader could drop links and still publish.
  update plm.nbcu_capture set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"asset_ip_family":99}'::jsonb where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected' then v_fail := v_fail+1;
    raise warning 'H11 FAIL: a wrong asset_ip_family count returned %', v_res ->> 'status';
  else v_pass := v_pass+1; end if;
  if not (v_res -> 'errors') @> '[{"code":"count_mismatch","entity":"asset_ip_family"}]'::jsonb
  then v_fail := v_fail+1;
    raise warning 'H11 FAIL: the rejection did not name asset_ip_family: %', (v_res->'errors')::text;
  else v_pass := v_pass+1; end if;

  -- H11b. An ABSENT expected count must also reject. A loader must not be able to skip
  --       the relationship simply by omitting its count.
  update plm.nbcu_capture set status='loading', load_completed_at=null,
         expected_counts = v_exp - 'asset_ip_family' where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if not (v_res -> 'errors') @> '[{"code":"expected_count_missing","entity":"asset_ip_family"}]'::jsonb
  then v_fail := v_fail+1;
    raise warning 'H11b FAIL: an OMITTED asset_ip_family expected count was tolerated';
  else v_pass := v_pass+1; end if;

  -- H11c. A label that does not match the IP Family row it points at must reject.
  --       The FK cannot catch this: the key resolves, the LABEL is wrong.
  update plm.nbcu_capture set status='loading', load_completed_at=null,
         expected_counts = v_exp where id = v_cap;
  update plm.nbcu_ip_family set ip_family_label = 'ZZTEST Family H1 RENAMED'
   where capture_id = v_cap and ip_family_key = v_ikey;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if not (v_res -> 'errors') @> '[{"code":"unknown_or_mismatched_ip_family_label"}]'::jsonb
  then v_fail := v_fail+1;
    raise warning 'H11c FAIL: a MISMATCHED IP Family label was accepted: %', (v_res->'errors')::text;
  else v_pass := v_pass+1; end if;
  update plm.nbcu_ip_family set ip_family_label = 'ZZTEST Family H1'
   where capture_id = v_cap and ip_family_key = v_ikey;

  -- H12. An EMPTY Asset-to-Franchise set is VALID when the expected count is zero.
  --      An asset whose source array is empty has zero Franchise links, and that is a
  --      correct answer -- not a gap for anyone to fill by inference.
  delete from plm.nbcu_asset_ip_family where capture_id = v_cap;
  update plm.nbcu_capture set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"asset_ip_family":0}'::jsonb where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'complete' then v_fail := v_fail+1;
    raise warning 'H12 FAIL: an empty Asset-to-Franchise set with expected 0 did not complete: %',
      v_res::text;
  else v_pass := v_pass+1; end if;
  if (v_res -> 'observed_counts' ->> 'asset_ip_family') <> '0' then v_fail := v_fail+1;
    raise warning 'H12 FAIL: the explicit zero was not observed as 0';
  else v_pass := v_pass+1; end if;

  -- Clean up. on delete restrict means children first.
  delete from plm.nbcu_asset_ip_family      where capture_id in (v_cap, v_cap2);
  delete from plm.nbcu_asset_metadata_value where capture_id in (v_cap, v_cap2);
  delete from plm.nbcu_asset                where capture_id in (v_cap, v_cap2);
  delete from plm.nbcu_ip_family            where capture_id in (v_cap, v_cap2);
  delete from plm.nbcu_capture              where id in (v_cap, v_cap2);

  select count(*) into v_n from plm.nbcu_capture where capture_key like 'nbcu:ZZTEST-H%';
  if v_n <> 0 then v_fail := v_fail+1;
    raise warning 'H FAIL: % synthetic capture(s) left behind', v_n;
  else v_pass := v_pass+1; end if;

  raise notice 'H: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'H FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- I. SECURITY OF THE NEW TABLE, ASSERTED SEPARATELY FROM SECTION D.
--
--    D proves the posture across the whole family from information_schema. This section
--    additionally proves it with has_table_privilege -- which resolves privileges through
--    role membership, so it cannot be satisfied by a grant that merely looks absent in
--    one catalog view -- and covers the four PostgreSQL 17 bits that predate the original
--    revoke migration (REFERENCES, TRIGGER, MAINTAIN, TRUNCATE).
--
--    `anon` must hold NOTHING on the table. `authenticated` must hold SELECT AND ONLY
--    SELECT -- never a write -- and which signed-in accounts that SELECT actually returns
--    rows to is decided by the `nbcu_asset_ip_family_plm_read` RLS policy added by
--    migration 20260819151510 for issue #1249, Albert Hazan's ruling that "scrape data
--    should be visible to Licensing department users". That policy admits administrator,
--    `plm` app access, and the sales/licensing roles, and it is proved behaviourally --
--    by becoming each principal in turn -- in
--    supabase/tests/wildbrain_nbcu_licensing_read_access_contracts.sql.
--
--    DO NOT "RESTORE" A DENY-ALL POSTURE HERE. Until 2026-08-19 this header said the
--    table must not be reachable by the browser roles at all, and that was correct until
--    the owner decided otherwise. Re-tightening these assertions would quietly undo his
--    ruling and lock Licensing back out.
--
--    The table must still NOT be exposed through any api.* view or public wrapper
--    function; `plm` is not PostgREST-exposed and a read surface is a separate decision.
-- =====================================================================================
do $$
declare
  v_pass integer := 0; v_fail integer := 0; v_n integer; p text; r text;
begin
  raise notice '=== I. nbcu_asset_ip_family SECURITY POSTURE ===';

  -- I1. service_role holds SELECT and INSERT -- the loader must be able to work.
  foreach p in array array['SELECT','INSERT'] loop
    if not has_table_privilege('service_role','plm.nbcu_asset_ip_family',p) then
      v_fail := v_fail+1;
      raise warning 'I1 FAIL: service_role LOST % -- the loader cannot write the relationship', p;
    else v_pass := v_pass+1; end if;
  end loop;

  -- I2. service_role holds NONE of the mutating or DDL-adjacent privileges. This is the
  --     immutability mechanism: a landed row cannot be changed by the only role that can
  --     reach it. MAINTAIN is real on PostgreSQL 17 and is the bit 20260810080000 predates.
  foreach p in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('service_role','plm.nbcu_asset_ip_family',p) then
      v_fail := v_fail+1;
      raise warning 'I2 FAIL: service_role holds % on plm.nbcu_asset_ip_family -- rows are NOT immutable', p;
    else v_pass := v_pass+1; end if;
  end loop;

  -- I3. anon can do NOTHING AT ALL, and `authenticated` may READ and nothing more.
  --
  --     THE EXPLICIT ACCESS DECISION ARRIVED. Until 2026-08-19 this block required that
  --     `authenticated` hold nothing either, on the stated grounds that licensed NBCU
  --     source material is not exposed without an explicit access decision. Albert Hazan
  --     then made one, verbatim: "scrape data should be visible to Licensing department
  --     users" (issue #1249). Migration 20260819151510 grants `authenticated` SELECT and
  --     adds a `<table>_plm_read` policy carrying the house predicate, so the GRANT is no
  --     longer what keeps this data confidential -- the POLICY is. Who the policy admits
  --     is proved behaviourally, by becoming each principal, in
  --     supabase/tests/wildbrain_nbcu_licensing_read_access_contracts.sql. What this
  --     block still owns is the other half: SELECT only, never a write.
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','TRUNCATE'] loop
    if has_table_privilege('anon','plm.nbcu_asset_ip_family',p) then
      v_fail := v_fail+1;
      raise warning 'I3 FAIL: anon holds % on plm.nbcu_asset_ip_family', p;
    else v_pass := v_pass+1; end if;
  end loop;

  if not has_table_privilege('authenticated','plm.nbcu_asset_ip_family','SELECT') then
    v_fail := v_fail+1;
    raise warning 'I3 FAIL: authenticated holds no SELECT on plm.nbcu_asset_ip_family '
      '(issue #1249)';
  else v_pass := v_pass+1; end if;

  foreach p in array array['INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','TRUNCATE'] loop
    if has_table_privilege('authenticated','plm.nbcu_asset_ip_family',p) then
      v_fail := v_fail+1;
      raise warning 'I3 FAIL: authenticated holds % on plm.nbcu_asset_ip_family -- #1249 '
        'widened READS only', p;
    else v_pass := v_pass+1; end if;
  end loop;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='plm' and table_name='nbcu_asset_ip_family'
     and grantee in ('anon','PUBLIC');
  if v_n <> 0 then v_fail := v_fail+1;
    raise warning 'I3 FAIL: anon/PUBLIC hold % grant(s)', v_n;
  else v_pass := v_pass+1; end if;

  -- I4. RLS is enabled.
  select count(*) into v_n from pg_class
   where relnamespace='plm'::regnamespace
     and relname='nbcu_asset_ip_family' and relrowsecurity;
  if v_n <> 1 then v_fail := v_fail+1;
    raise warning 'I4 FAIL: RLS is not enabled on plm.nbcu_asset_ip_family';
  else v_pass := v_pass+1; end if;

  -- I5. No new api.* view, no public wrapper function, no PostgREST exposure.
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='api' and c.relname like '%nbcu%';
  if v_n <> 0 then v_fail := v_fail+1;
    raise warning 'I5 FAIL: % api.* object(s) reference nbcu; this request adds none', v_n;
  else v_pass := v_pass+1; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','api') and p.proname like '%nbcu%';
  if v_n <> 0 then v_fail := v_fail+1;
    raise warning 'I5 FAIL: % public/api wrapper function(s) for nbcu exist', v_n;
  else v_pass := v_pass+1; end if;

  -- I6. No NBCU table gained a broad write grant through the schema default privileges.
  --     Enumerated from pg_class, so all 16 tables remaining after #1242 are covered
  --     automatically and a later addition cannot slip past this test.
  select count(*) into v_n
    from pg_class c, unnest(array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) q
   where c.relnamespace='plm'::regnamespace and c.relkind='r' and c.relname like 'nbcu\_%'
     and has_table_privilege('service_role', c.oid, q);
  if v_n <> 0 then v_fail := v_fail+1;
    raise warning 'I6 FAIL: % unwanted service_role privilege(s) across the nbcu family -- '
      'the plm default privilege hole re-opened', v_n;
  else v_pass := v_pass+1; end if;

  select count(*) into v_n from pg_class
   where relnamespace='plm'::regnamespace and relkind='r' and relname like 'nbcu\_%';
  if v_n <> 16 then v_fail := v_fail+1;
    raise warning 'I6 FAIL: % plm.nbcu_* tables, expected 16', v_n;
  else v_pass := v_pass+1; end if;

  raise notice 'I: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'I FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- F7. begin_nbcu_capture MUST REFUSE AN EXPECTED_COUNTS DOCUMENT IT CANNOT CHECK LATER.
--     Migration 20260819123658, issue #1219.
--
-- WHY BOTH F7 AND G7 EXIST, AND WHY NEITHER MAKES THE OTHER REDUNDANT.
--   F7 covers the door: an argument that can never be verified is refused before a
--   capture row is created at all. G7 covers the gate: finalize re-reads the STORED
--   expected_counts, because plm.nbcu_capture is writable by its owner and an UPDATE can
--   reach the value after begin_ ran. #1219 asks for both in those words.
--
--   AGAINST THE PRE-20260819123658 begin_ BODY EVERY CASE BELOW IS ACCEPTED -- the
--   function validated only that expected_counts was a non-empty JSON object, so a
--   document of nulls started a capture happily and the skipped-count publication in G7
--   followed from it.
--
--   EVERY REJECTION IS PINNED to `raise_exception` plus the message that must have
--   produced it. A bare `when others` passes when ANY error fires, including a typo in
--   the test's own call, so it would stay green after the guard under test is deleted.
--   That is the third defect pattern #1219 asks authors to sweep for.
-- =====================================================================================
do $$
declare
  v_pass integer := 0; v_fail integer := 0;
  v_msg text; v_rejected boolean; v_n integer; v_cap uuid;
  v_bad jsonb; v_label text;
  -- Each pair is one broken value and the fragment of the refusal that must name it.
  v_cases jsonb := jsonb_build_array(
    jsonb_build_object('doc','{"assets":null}',                  'want','must be a JSON number','why','JSON null -- the shape jsonb_build_object with an unset variable produces'),
    jsonb_build_object('doc','{"assets":"12"}',                  'want','must be a JSON number','why','a numeric-looking STRING, which used to cast cleanly and be ACCEPTED as a count'),
    jsonb_build_object('doc','{"assets":"twelve"}',              'want','must be a JSON number','why','a non-numeric string, which used to die on a raw cast at the gate'),
    jsonb_build_object('doc','{"assets":true}',                  'want','must be a JSON number','why','a boolean'),
    jsonb_build_object('doc','{"assets":{}}',                    'want','must be a JSON number','why','an object'),
    jsonb_build_object('doc','{"assets":[]}',                    'want','must be a JSON number','why','an array'),
    jsonb_build_object('doc','{"assets":0.5}',                   'want','NON-NEGATIVE INTEGER','why','a fraction'),
    jsonb_build_object('doc','{"assets":-1}',                    'want','NON-NEGATIVE INTEGER','why','a negative'),
    jsonb_build_object('doc','{"assets":92233720368547758070}',  'want','larger than bigint','why','a number above bigint, which used to raise `bigint out of range` at the gate'),
    -- A GOOD key next to a BAD one must not rescue the document. This is the shape a
    -- real loader produces: eleven counts land, one variable was never set.
    jsonb_build_object('doc','{"assets":1,"properties":null}',   'want','must be a JSON number','why','one good count beside one null'),
    -- The optional scalars are validated by the same blanket rule, not exempted.
    jsonb_build_object('doc','{"assets":1,"failures":null}',     'want','must be a JSON number','why','a null in the optional failures key'),
    jsonb_build_object('doc','{"assets":1,"excluded_unlicensed_assets":"0"}','want','must be a JSON number','why','a string in the optional excluded_unlicensed_assets key')
  );
  v_case jsonb;
begin
  raise notice '=== F7. begin_nbcu_capture ARGUMENT REFUSALS (#1219) ===';

  for v_case in select * from jsonb_array_elements(v_cases) loop
    v_bad := (v_case ->> 'doc')::jsonb;
    v_label := v_case ->> 'why';
    v_rejected := false;
    begin
      perform plm.begin_nbcu_capture(
        'nbcu:ZZTEST-F7:'||md5(v_bad::text), 'u2giants/ZZTEST', repeat('7',40),
        repeat('8',64), 'https://portal.example.invalid/', now(), v_bad, '{}'::jsonb,
        'contract-test-F7');
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text;
      if v_msg like '%begin_nbcu_capture:%'
         and v_msg like '%'||(v_case ->> 'want')||'%' then
        v_rejected := true; v_pass := v_pass+1;
      else
        v_fail := v_fail+1;
        raise warning 'FAIL F7 (%) was refused by the WRONG error: %', v_label, v_msg;
      end if;
    end;
    if not v_rejected and v_msg is null then
      v_fail := v_fail+1;
      raise warning 'FAIL F7 (%) was ACCEPTED: %', v_label, v_bad::text;
    end if;
    v_msg := null;
  end loop;

  -- F7.13 A refused call must leave NOTHING behind. The validation runs before the
  -- advisory lock and the insert, and this proves it stayed there.
  select count(*) into v_n from plm.nbcu_capture where capture_key like 'nbcu:ZZTEST-F7:%';
  if v_n <> 0 then
    v_fail := v_fail+1;
    raise warning 'FAIL F7.13 a refused begin_nbcu_capture left % capture row(s) behind', v_n;
  else v_pass := v_pass+1; end if;

  -- F7.14 THE OTHER HALF OF THE GUARD. A document that IS all non-negative integers --
  -- including a legitimate zero, a large-but-in-range count, and the whole number 1.0,
  -- which is a mathematical integer even though it is not an integer LITERAL -- must
  -- still be ACCEPTED. Without this the twelve refusals above would also pass if begin_
  -- had been broken into refusing everything. 1.0 belongs on the accept side, not the
  -- refuse side: the gate converts it through numeric, so it compares as 1 (G7.12).
  v_cap := plm.begin_nbcu_capture('nbcu:ZZTEST-F7-OK:'||repeat('7',40),'u2giants/ZZTEST',
    repeat('7',40), repeat('9',64), 'https://portal.example.invalid/', now(),
    '{"assets":0,"properties":9007199254740993,"failures":0,"scopes":1.0}'::jsonb, '{}'::jsonb,
    'contract-test-F7');
  if v_cap is null then
    v_fail := v_fail+1;
    raise warning 'FAIL F7.14 a VALID all-integer expected_counts document was refused';
  else v_pass := v_pass+1; end if;

  delete from plm.nbcu_capture where capture_key like 'nbcu:ZZTEST-F7%';

  raise notice 'F7: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'F7 FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- G7. THE COUNT GATE MAY NEVER BE SKIPPED BY A NON-NUMBER EXPECTED COUNT.
--     Migration 20260819123658, issue #1219.
--
-- WHY THIS SECTION EXISTS, AND WHAT IT WOULD HAVE CAUGHT.
--   The gate used to decide a count had been supplied with `v_exp ? v_key`. `jsonb ? key`
--   is TRUE for a key whose value is JSON `null`, so {"scopes": null} passed that test,
--   the expected value became SQL NULL, `observed <> NULL` evaluated to UNKNOWN, and the
--   IF never fired. The count was silently UNCHECKED and the capture published as
--   'complete'. `jsonb_build_object('scopes', v_unset)` produces exactly that shape, so
--   an ordinary loader bug is enough to reach it.
--
--   MEASURED AGAINST THE PRE-20260819123658 FUNCTION BODY, on PostgreSQL 18:
--     G7.2 and G7.3 return 'complete' -- the count check was skipped and the capture
--       PUBLISHED. G7.10 does the same for the optional `failures` key.
--     G7.4 reports count_mismatch, i.e. it silently accepted the STRING "12" as a
--       count via the untyped ->> cast; a non-numeric string would have raised instead.
--     G7.5 raises `invalid input syntax for type bigint: "true"` -- a raw cast error
--       that aborts this block and fails the section loudly, which is the intended
--       detection for the second defect. G7.6 and G7.7 are the float and out-of-range
--       forms of the same crash.
--   A guard with no test that fails when the guard is removed is not a guard.
--
--   Note the shape: finalize deliberately RETURNS a verdict instead of raising, so these
--   calls are NOT wrapped in an exception handler. No `when others` appears anywhere in
--   this section -- a broad handler would turn a typo in the test itself into a green
--   line, which is the third defect pattern issue #1219 asks authors to sweep for.
-- =====================================================================================
do $$
declare
  v_pass integer := 0; v_fail integer := 0;
  v_cap uuid; v_res jsonb; v_status text;
  v_skey text := 'href-sha256:'||repeat('e',64);
  v_exp  jsonb := jsonb_build_object(
    'assets',0,'properties',0,'characters',0,'style_guides',0,'scopes',1,
    'ip_family_property',0,'property_character',0,'asset_property',0,
    'asset_character',0,'asset_style_guide',0,'style_guide_property',0,
    'asset_ip_family',0,'excluded_unlicensed_assets',0,'failures',0);
begin
  raise notice '=== G7. NON-NUMBER EXPECTED COUNTS (#1219) ===';

  v_cap := plm.begin_nbcu_capture('nbcu:ZZTEST-G7:'||repeat('e',40),'u2giants/ZZTEST',
    repeat('e',40), repeat('f',64), 'https://portal.example.invalid/', now(),
    v_exp, '{}'::jsonb, 'contract-test-G7');

  -- One real row, so the null-count cases below are the ACTUAL disaster shape: data
  -- landed, and the expectation that was supposed to verify it is unusable.
  insert into plm.nbcu_scope (capture_id, scope_key, scope_label, scope_href,
    page_count, indexed_rows, unique_assets, terminal, source_files, raw)
  values (v_cap, v_skey, 'ZZTEST G7 scope','https://portal.example.invalid/scope/7',
    1,0,0,true,'[]'::jsonb,'{}'::jsonb);

  -- Every reset below clears load_completed_at with the status: nbcu_capture_complete_
  -- time_chk ties the two together and would reject the UPDATE otherwise.

  -- G7.1 BASELINE. The correct document publishes. Without this the rejections below
  -- could all pass for the wrong reason (an unrelated always-on error, say).
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'complete' then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.1 a correct expected_counts document did not complete: %', v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.2 THE DEFECT. A JSON null for a count that has real rows behind it.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"scopes":null}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected' then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.2 a JSON-NULL expected count PUBLISHED the capture (status %) -- the count check was skipped',
      v_res ->> 'status';
  else v_pass := v_pass+1; end if;
  if not (v_res -> 'errors')
         @> '[{"code":"expected_count_not_a_number","entity":"scopes"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.2 the rejection was not the NAMED expected_count_not_a_number: %',
      coalesce((v_res -> 'errors')::text,'<none>');
  else v_pass := v_pass+1; end if;
  -- The rejection must SURVIVE, not merely be returned.
  select status into v_status from plm.nbcu_capture where id = v_cap;
  if v_status <> 'rejected' then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.2 the persisted status is %, expected rejected', v_status;
  else v_pass := v_pass+1; end if;

  -- G7.3 A JSON null on a zero-row count is equally unchecked, and equally refused.
  -- Stated separately because "the count happened to be 0 anyway" is exactly the
  -- reasoning that makes a skipped check look harmless.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"assets":null}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_number","entity":"assets"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.3 a JSON-null zero-row expected count was not rejected by name: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.4 A JSON STRING. Pre-fix, ->> handed '12' to ::bigint and the gate ACCEPTED a
  -- string as a count (reporting a mismatch against 0 rather than the type error); a
  -- non-numeric string died on the cast instead. Neither is a decision the gate is
  -- allowed to make -- an expected count that is not a JSON number is broken input.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"assets":"12"}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_number","entity":"assets"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.4 a STRING expected count was not rejected by name: %', v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.5 Booleans, objects and arrays take the same named path, each reporting its own
  -- json_type. Asserted rather than assumed -- each is a different jsonb_typeof branch.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"assets":true,"properties":{},"characters":[]}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_number","entity":"assets","json_type":"boolean"}]'::jsonb
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_number","entity":"properties","json_type":"object"}]'::jsonb
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_number","entity":"characters","json_type":"array"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.5 bool/object/array expected counts were not each rejected by name: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.6 A FLOAT and a NEGATIVE are numbers, but they are not counts.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"assets":0.5,"properties":-1}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_nonnegative_integer","entity":"assets"}]'::jsonb
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_nonnegative_integer","entity":"properties"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.6 a fractional or negative expected count was not rejected by name: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.7 A number larger than bigint. Pre-fix the ::bigint cast raised `bigint out of
  -- range` and wedged the capture; it must be a recorded rejection instead.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"assets":92233720368547758070}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_out_of_range","entity":"assets"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.7 an out-of-bigint-range expected count was not rejected by name: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.8 A MISSING key must STILL be its own distinct rejection. The fix must not have
  -- collapsed "absent" into "not a number".
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp - 'assets'
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_missing","entity":"assets"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.8 a MISSING expected count lost its own rejection code: %', v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.9 A genuine COUNT MISMATCH must still be reported as a mismatch, with the numbers.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"scopes":99}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"count_mismatch","entity":"scopes","expected":99,"observed":1}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.9 a real count mismatch was not reported as count_mismatch: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.10 The OPTIONAL scalar keys carry the same trap. A JSON null in `failures` used to
  -- make the expected-failures invariant evaluate to UNKNOWN and skip entirely.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"failures":null}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_number","entity":"failures"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.10 a JSON-null failures key skipped the invariant: %', v_res::text;
  else v_pass := v_pass+1; end if;

  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"excluded_unlicensed_assets":"0"}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_not_a_number","entity":"excluded_unlicensed_assets"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.10 a STRING excluded_unlicensed_assets skipped the invariant: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.12 A WHOLE NUMBER THAT IS NOT A BIGINT LITERAL. `->>` renders the JSON number 1.0
  -- as the TEXT '1.0', and '1.0'::bigint raises -- even though 1.0 is a whole,
  -- non-negative number that passes every type and range guard above. The exception
  -- aborts finalize BEFORE the rejection row is written, so the capture is WEDGED in
  -- 'loading' with no error_summary and a retry dies identically. That is the opposite
  -- failure direction from the JSON null and operationally worse than a refusal.
  -- A raw cast here aborts this whole block, which IS the detection.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"scopes":1.0}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'complete' then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.12 the whole number 1.0 did not compare equal to the one landed row: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- And it must still compare CORRECTLY, not merely survive: 1.0 against zero assets is
  -- a real mismatch and must be reported as one, carrying the integer 1.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"assets":1.0}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"count_mismatch","entity":"assets","expected":1,"observed":0}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.12 the whole number 1.0 was not compared as the integer 1: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.13 The same shape on the OPTIONAL scalar, which casts to `integer` rather than
  -- bigint. 0.0 equals the capture's excluded_unlicensed_assets of 0 and must publish.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"excluded_unlicensed_assets":0.0}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'complete' then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.13 excluded_unlicensed_assets 0.0 did not compare equal to 0: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.14 That scalar has its own, SMALLER limit -- the column is `integer`, not bigint --
  -- so a value between the two must be a named refusal, not an `integer out of range`
  -- abort. It is below the bigint limit checked in G7.7, so this is a distinct branch.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = v_exp || '{"excluded_unlicensed_assets":3000000000}'::jsonb
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'rejected'
     or not (v_res -> 'errors')
            @> '[{"code":"expected_count_out_of_range","entity":"excluded_unlicensed_assets"}]'::jsonb then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.14 an above-integer excluded_unlicensed_assets was not refused by name: %',
      v_res::text;
  else v_pass := v_pass+1; end if;

  -- G7.11 Both optional keys remain OPTIONAL. Absence is not an error: this migration
  -- hardened their VALUES, it did not make them required, and a change that quietly made
  -- them required would refuse captures that are legitimate today.
  update plm.nbcu_capture
     set status='loading', load_completed_at=null,
         expected_counts = (v_exp - 'failures') - 'excluded_unlicensed_assets'
   where id = v_cap;
  v_res := plm.finalize_nbcu_capture(v_cap);
  if (v_res ->> 'status') <> 'complete' then
    v_fail := v_fail+1;
    raise warning 'FAIL G7.11 omitting the OPTIONAL scalar keys was refused: %', v_res::text;
  else v_pass := v_pass+1; end if;

  delete from plm.nbcu_scope   where capture_id = v_cap;
  delete from plm.nbcu_capture where id = v_cap;

  raise notice 'G7: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'G7 FAILED (% failures)', v_fail; end if;
end;
$$;
