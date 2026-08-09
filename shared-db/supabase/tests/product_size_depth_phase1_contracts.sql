-- =====================================================================================
-- Issue #597 Phase 1 contract tests — core.product_size / core.product_depth.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, as a role that can read dflow.* and
--   write ingest.* (the Supabase CLI's linked connection, or a psql / node-pg session):
--       \i supabase/tests/product_size_depth_phase1_contracts.sql
--
--   RUN THE TWO `do $$` BLOCKS AS SEPARATE STATEMENTS. Submitting the whole file as one
--   multi-statement batch through the transaction pooler (port 6543) wraps both blocks
--   in one implicit transaction and stalls — observed 2026-08-09. psql's \i does the
--   right thing; a programmatic runner must split on the `do $$` boundaries.
--
-- WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
--   Every assertion checks an OBJECT or a BEHAVIOUR. None of them reads
--   supabase_migrations.schema_migrations. This repo has shipped a migration that
--   recorded a clean ledger row while its object did nothing, so "it applied" is not
--   accepted here as evidence of anything.
--
--   Section C is the one to read first. It exercises the NULL-ROLE case deliberately:
--   on a direct psql/pooler connection auth.role() is NULL and there is no profile,
--   which is exactly the condition under which a guard shaped
--   `if not (... or auth.role() = 'service_role')` NEVER FIRES and admits the call.
--   Every privileged entry point must REFUSE here, and must write nothing.
--
--   Each block RAISES at the end if any assertion failed, so a partial pass cannot be
--   mistaken for a pass.
--
-- SIDE EFFECTS
--   Creates and then deletes rows in ingest.coldlion_product_size_run / _landing
--   (importer scaffolding). It never writes to core.product_size or core.product_depth,
--   and sections C and E assert exactly that.
--
-- LAST RUN: preview rjyboqwcdzcocqgmsyel, 2026-08-09 — 38 passed / 0 failed (part 1),
--           3 passed / 0 failed (part 2).
-- =====================================================================================

do $$
declare
  r record; v_ok boolean; v_msg text; v_n integer; v_id uuid; v_inactive uuid; v_run uuid;
  v_pass integer := 0; v_fail integer := 0;
begin
  raise notice '=== A. OBJECT EXISTENCE (to_regclass / pg_proc, not schema_migrations) ===';
  foreach v_msg in array array[
    'core.product_size','core.product_depth','core.product_size_source_ref',
    'core.product_depth_source_ref','ingest.coldlion_product_size_run',
    'ingest.coldlion_product_size_landing'
  ] loop
    if to_regclass(v_msg) is null then
      v_fail := v_fail + 1; raise notice 'FAIL table missing: %', v_msg;
    else v_pass := v_pass + 1; raise notice 'PASS table exists: %  (oid %)', v_msg, to_regclass(v_msg)::oid;
    end if;
  end loop;

  foreach v_msg in array array[
    'api.product_size_list','api.product_depth_list',
    'api.db_data_admin_product_depth_list','api.db_data_admin_upsert_product_depth',
    'api.db_data_admin_set_product_depth_status',
    'app.require_db_data_admin_product_depth_access',
    'ingest.assert_coldlion_product_size_authority','ingest.apply_coldlion_product_size'
  ] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname||'.'||p.proname = v_msg;
    if v_n = 0 then v_fail := v_fail+1; raise notice 'FAIL function missing: %', v_msg;
    else v_pass := v_pass+1; raise notice 'PASS function exists: % (% overload(s))', v_msg, v_n; end if;
  end loop;

  select count(*) into v_n from pg_trigger
   where tgrelid in ('core.product_size'::regclass,'core.product_depth'::regclass) and not tgisinternal;
  raise notice 'INFO non-internal triggers on the two core tables: % (expect 2 set_updated_at)', v_n;
  if v_n = 2 then v_pass := v_pass+1; else v_fail := v_fail+1; raise notice 'FAIL expected 2 triggers'; end if;

  select count(*) into v_n from pg_attribute
   where attrelid='plm.item'::regclass and attname in ('product_size_id','product_depth_id') and not attisdropped;
  if v_n = 2 then v_pass:=v_pass+1; raise notice 'PASS plm.item link columns present (2)';
  else v_fail:=v_fail+1; raise notice 'FAIL plm.item link columns: found %', v_n; end if;

  raise notice '';
  raise notice '=== B. ROW COUNTS ===';
  select count(*) into v_n from core.product_depth where legacy_id is not null;
  raise notice '%  Depth legacy-backed rows = % (expect 121)', case when v_n=121 then 'PASS' else 'FAIL' end, v_n;
  if v_n=121 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select count(*) into v_n from core.product_size where status='active';
  raise notice '%  Size ACTIVE (current) = % (expect 530)', case when v_n=530 then 'PASS' else 'FAIL' end, v_n;
  if v_n=530 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select count(*) into v_n from core.product_size where status<>'active';
  raise notice '%  Size INACTIVE historical = % (expect 8)', case when v_n=8 then 'PASS' else 'FAIL' end, v_n;
  if v_n=8 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select count(*) into v_n from core.product_size where upper(division_code)='EP001';
  raise notice '%  Size EP001 (Pages) rows = % (expect 0)', case when v_n=0 then 'PASS' else 'FAIL' end, v_n;
  if v_n=0 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  -- the eight named identities, individually
  for r in select division_code, code, status::text st, retired_at from core.product_size
    where (division_code,code) in (('CW001','5B'),('CW001','8H'),('CW001','TT'),
      ('EH001','5B'),('EH001','8T'),('EH001','ET'),('EH001','M8'),('EH001','TT'))
    order by division_code, code
  loop
    raise notice '   historical %/% -> % (retired_at %)', r.division_code, r.code, r.st, r.retired_at;
  end loop;

  select count(*) into v_n from core.product_depth pd join dflow."itemDepth" d on d."itemDepth_id"=pd.legacy_id
    where pd.label is distinct from d."itemDepth_title" or pd.code is distinct from d."itemDepth_code";
  raise notice '%  Depth labels/codes altered in transit = % (expect 0)', case when v_n=0 then 'PASS' else 'FAIL' end, v_n;
  if v_n=0 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  raise notice '';
  raise notice '=== C. PERMISSION TESTS ===';
  raise notice '-- current connection: current_user=%  session_user=%', current_user, session_user;

  -- C1. THE NULL-ROLE CASE. auth.role() is NULL on this psql/pooler connection and there
  -- is no profile. A null-permissive guard would ADMIT here. Both must REFUSE.
  begin
    select auth.role() into v_msg;
    raise notice '   auth.role() on this connection = % (NULL is the dangerous case)', coalesce(v_msg,'<NULL>');
  exception when others then raise notice '   auth.role() not resolvable here (also the NULL case)'; end;

  begin
    perform app.require_db_data_admin_product_depth_access();
    v_fail:=v_fail+1;
    raise notice 'FAIL NULL-role: require_db_data_admin_product_depth_access() ADMITTED a null identity';
  exception when insufficient_privilege then
    v_pass:=v_pass+1; raise notice 'PASS NULL-role: Depth access gate REFUSED (insufficient_privilege)';
  end;

  begin
    perform api.db_data_admin_upsert_product_depth(
      gen_random_uuid(), 'null-role permission probe', 'ZZ probe', 'ZZPROBE');
    v_fail:=v_fail+1; raise notice 'FAIL NULL-role: upsert RPC ADMITTED a null identity';
  exception when insufficient_privilege then
    v_pass:=v_pass+1; raise notice 'PASS NULL-role: upsert RPC REFUSED (insufficient_privilege)';
  end;

  begin
    perform api.db_data_admin_set_product_depth_status(
      gen_random_uuid(), 'null-role permission probe',
      (select id from core.product_depth limit 1), 'inactive', now());
    v_fail:=v_fail+1; raise notice 'FAIL NULL-role: set_status RPC ADMITTED a null identity';
  exception when insufficient_privilege then
    v_pass:=v_pass+1; raise notice 'PASS NULL-role: set_status RPC REFUSED (insufficient_privilege)';
  end;

  -- C2. The importer authority assert. As postgres it must PASS and name the role.
  select ingest.assert_coldlion_product_size_authority() into v_msg;
  raise notice 'PASS importer authority as postgres resolved role = %', v_msg;
  v_pass:=v_pass+1;

  -- C3. Nothing was written by any refused call.
  select count(*) into v_n from core.product_depth where code='ZZPROBE';
  raise notice '%  refused calls wrote nothing: ZZPROBE rows = % (expect 0)',
    case when v_n=0 then 'PASS' else 'FAIL' end, v_n;
  if v_n=0 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select count(*) into v_n from app.db_data_admin_audit_event where entity_type='product_depth';
  raise notice '%  refused calls wrote no audit rows = % (expect 0)',
    case when v_n=0 then 'PASS' else 'FAIL' end, v_n;
  if v_n=0 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  -- C4. Browser roles hold no write grant on the core tables.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='core' and table_name in ('product_size','product_depth')
     and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE');
  raise notice '%  write grants to anon/authenticated on core Size+Depth = % (expect 0)',
    case when v_n=0 then 'PASS' else 'FAIL' end, v_n;
  if v_n=0 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='ingest' and table_name like 'coldlion_product_size%'
     and grantee in ('authenticated','anon');
  raise notice '%  any grant to anon/authenticated on ingest landing/run = % (expect 0)',
    case when v_n=0 then 'PASS' else 'FAIL' end, v_n;
  if v_n=0 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  raise notice '';
  raise notice '=== D. PICKER BEHAVIOUR (inactive only when already selected) ===';
  select count(*) into v_n from api.product_size_list();
  raise notice '%  size picker, nothing selected = % (expect 530 — no inactive leaks)',
    case when v_n=530 then 'PASS' else 'FAIL' end, v_n;
  if v_n=530 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select id into v_inactive from core.product_size where status<>'active' and code='TT' and division_code='CW001';
  select count(*) into v_n from api.product_size_list(array[v_inactive]);
  raise notice '%  size picker WITH that inactive id selected = % (expect 531)',
    case when v_n=531 then 'PASS' else 'FAIL' end, v_n;
  if v_n=531 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select selectable into v_ok from api.product_size_list(array[v_inactive]) where id=v_inactive;
  raise notice '%  that row is marked selectable=% (expect false)',
    case when v_ok is false then 'PASS' else 'FAIL' end, v_ok;
  if v_ok is false then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select count(*) into v_n from api.product_size_list(null,'CW001');
  raise notice 'INFO size picker filtered to CW001 = % rows', v_n;

  select count(*) into v_n from api.product_depth_list();
  raise notice '%  depth picker, nothing selected = % (expect 121, all active)',
    case when v_n=121 then 'PASS' else 'FAIL' end, v_n;
  if v_n=121 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  raise notice '';
  raise notice '=== E. IMPORTER GUARDS ===';
  insert into ingest.coldlion_product_size_run (mode, requested_by, source_endpoint)
    values ('dry_run','preview verification 20260809','/merchGroupDetails') returning id into v_run;

  -- E1. count guard: a truncated feed must be REFUSED, not applied.
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    select v_run,'EDGEHOME',division_code,'04',code,label from core.product_size where status='active' limit 12;
  begin
    perform ingest.apply_coldlion_product_size(v_run);
    v_fail:=v_fail+1; raise notice 'FAIL count guard did not fire on a 12-row feed';
  exception when others then
    v_pass:=v_pass+1; raise notice 'PASS count guard fired: %', left(sqlerrm,110);
  end;

  -- E2. EP001 guard.
  update ingest.coldlion_product_size_run set status='pending' where id=v_run;
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    select v_run,'EDGEHOME','CW001','04','GUARD'||g, 'guard filler '||g from generate_series(1,600) g;
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    values (v_run,'EDGEHOME','EP001','04','114','114');
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    values (v_run,'EDGEHOME','EH001','04','GX','gx'),(v_run,'EDGEHOME','SP001','04','GY','gy');
  begin
    perform ingest.apply_coldlion_product_size(v_run, false, 100, 5000, 1000);
    v_fail:=v_fail+1; raise notice 'FAIL EP001 guard did not fire';
  exception when others then
    v_pass:=v_pass+1; raise notice 'PASS EP001 guard fired: %', left(sqlerrm,110);
  end;

  -- E3. clean dry run on the real active set: plan only, writes nothing to core.
  update ingest.coldlion_product_size_run set status='pending' where id=v_run;
  delete from ingest.coldlion_product_size_landing where run_id=v_run;
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    select v_run,'EDGEHOME',division_code,'04',code,label from core.product_size where status='active';
  raise notice 'INFO clean dry-run plan: %', ingest.apply_coldlion_product_size(v_run);

  select count(*) into v_n from core.product_size where label_source='coldlion';
  raise notice '%  dry run wrote nothing to core (coldlion-sourced labels = %, expect 0)',
    case when v_n=0 then 'PASS' else 'FAIL' end, v_n;
  if v_n=0 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  -- E4. idempotent replay of the finished run.
  select (ingest.apply_coldlion_product_size(v_run)->>'idempotent_replay')::boolean into v_ok;
  raise notice '%  finished run replays idempotently = %', case when v_ok then 'PASS' else 'FAIL' end, v_ok;
  if v_ok then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  -- E5. apply refused when the run was created as dry_run.
  update ingest.coldlion_product_size_run set status='pending' where id=v_run;
  begin
    perform ingest.apply_coldlion_product_size(v_run, true);
    v_fail:=v_fail+1; raise notice 'FAIL apply was permitted on a dry_run-mode run';
  exception when others then
    v_pass:=v_pass+1; raise notice 'PASS apply refused on a dry_run-mode run: %', left(sqlerrm,110);
  end;

  -- cleanup the probe run (verification scaffolding only; core.* untouched)
  delete from ingest.coldlion_product_size_run where id=v_run;

  raise notice '';
  raise notice '=== RESULT: % passed, % failed ===', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'VERIFICATION FAILED: % assertions failed', v_fail using errcode='P0001';
  end if;
end;
$$;


-- i.e. reach each one without an earlier guard short-circuiting first.
do $$
declare v_run uuid; v_n integer; v_pass integer := 0; v_fail integer := 0;
begin
  -- ---- EP001 payload guard, reached with exactly 3 divisions so the coverage
  -- ---- guard cannot fire first. Divisions present: CW001, EH001, EP001.
  insert into ingest.coldlion_product_size_run (mode, requested_by)
    values ('dry_run','preview verification 20260809 supplementary') returning id into v_run;
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    select v_run,'EDGEHOME',division_code,'04',code,label
      from core.product_size where status='active' and division_code in ('CW001','EH001');
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    values (v_run,'EDGEHOME','EP001','04','114','114'),
           (v_run,'EDGEHOME','EP001','04','144','144');
  select count(distinct division_code) into v_n from ingest.coldlion_product_size_landing where run_id=v_run;
  raise notice 'setup: landing covers % divisions (3 = coverage guard will NOT fire)', v_n;
  begin
    perform ingest.apply_coldlion_product_size(v_run, false, 100, 5000, 5000);
    v_fail:=v_fail+1; raise notice 'FAIL EP001 payload guard did not fire';
  exception when others then
    if sqlerrm like '%EP001%' then
      v_pass:=v_pass+1; raise notice 'PASS EP001 payload guard fired: %', left(sqlerrm,160);
    else
      v_fail:=v_fail+1; raise notice 'FAIL wrong guard fired: %', left(sqlerrm,160);
    end if;
  end;
  delete from ingest.coldlion_product_size_run where id=v_run;

  -- ---- Retirement cap, reached with a valid 3-division feed that simply omits rows.
  insert into ingest.coldlion_product_size_run (mode, requested_by)
    values ('apply','preview verification 20260809 supplementary') returning id into v_run;
  -- feed everything EXCEPT 40 CW001 identities -> 40 retirements, cap is 10.
  insert into ingest.coldlion_product_size_landing (run_id, company_code, division_code, mg_type_code, code, label)
    select v_run,'EDGEHOME',division_code,'04',code,label from core.product_size
     where status='active'
       and id not in (select id from core.product_size where status='active' and division_code='CW001' limit 40);
  select count(*) into v_n from ingest.coldlion_product_size_landing where run_id=v_run;
  raise notice 'setup: landing holds % rows (expect 490)', v_n;
  begin
    perform ingest.apply_coldlion_product_size(v_run, true, 400, 700, 10);
    v_fail:=v_fail+1; raise notice 'FAIL retirement cap did not fire on 40 retirements';
  exception when others then
    if sqlerrm like '%retire%' then
      v_pass:=v_pass+1; raise notice 'PASS retirement cap fired: %', left(sqlerrm,170);
    else
      v_fail:=v_fail+1; raise notice 'FAIL wrong guard fired: %', left(sqlerrm,170);
    end if;
  end;
  delete from ingest.coldlion_product_size_run where id=v_run;

  -- ---- Nothing was retired or otherwise changed by the refused apply.
  select count(*) into v_n from core.product_size where status='active';
  raise notice '%  core.product_size still % active after the refused apply (expect 530)',
    case when v_n=530 then 'PASS' else 'FAIL' end, v_n;
  if v_n=530 then v_pass:=v_pass+1; else v_fail:=v_fail+1; end if;

  select count(*) into v_n from ingest.coldlion_product_size_run;
  raise notice 'INFO importer run ledger rows remaining after cleanup = %', v_n;

  raise notice '=== SUPPLEMENTARY RESULT: % passed, % failed ===', v_pass, v_fail;
  if v_fail > 0 then raise exception 'SUPPLEMENTARY VERIFICATION FAILED' using errcode='P0001'; end if;
end;
$$;
