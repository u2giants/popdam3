-- =====================================================================================
-- Contract tests for migrations 20260810110000 and 20260810120000 -- the Warner STARLABS
-- landing-table grants and RLS, and api.dam_order_list's SECURITY INVOKER setting.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, as a SUPERUSER connection (the migration
--   owner -- `postgres`), on the SESSION pooler port 5432, NOT the transaction pooler
--   port 6543:
--       psql "postgresql://postgres.rjyboqwcdzcocqgmsyel@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require" \
--            -v ON_ERROR_STOP=1 -f supabase/tests/wb_grants_rls_and_dam_order_list_invoker.sql
--
--   SUPERUSER is required by section D (`set local session authorization`) and by the
--   `session_replication_role` switch used to build the synthetic-principal fixture.
--   On port 6543 the transaction pooler wraps the whole batch in one implicit
--   transaction and stalls -- observed on this database 2026-08-09.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. No real Warner
--   franchise, property, character, style guide, asset id, filename or portal URL appears
--   here; the fixtures use ZZTEST-* tokens, example.invalid URLs and the reserved uuid
--   prefix 99999999-9999-4999-8999-*.
--
-- SIDE EFFECTS: NONE. Every section that writes runs inside an explicit transaction that
--   ends in ROLLBACK. Section F re-asserts that afterwards against the committed state.
--
-- WHAT IT ASSERTS -- and what each section had to be strengthened to stop over-claiming:
--   A  Grants. The table list is ENUMERATED FROM pg_class, so a plm.wb_* table added
--      later is genuinely covered (the previous version hard-coded the same 8 names under
--      a comment claiming otherwise). service_role must hold SELECT and NOTHING else.
--   B1 Policy STRUCTURE, per table: exactly ONE policy, cmd SELECT, roles {authenticated},
--      predicate not `true`, and all 8 predicates byte-identical. The previous version
--      claimed to check "exactly one SELECT policy per table" but only counted policies
--      whose qual was literally 'true' -- it never counted per table, nor checked command,
--      roles or predicate.
--   B2 Policy BEHAVIOUR, on ALL EIGHT tables (the previous version tested only
--      wb_franchise_property), INCLUDING the vendor-with-plm-app-access and
--      viewer-with-plm-app-access principals, which MUST be able to read. See the note on
--      B2 below -- that is the case the shipped comments got wrong.
--   C  api.dam_order_list is security_invoker=true AND base-table RLS demonstrably
--      applies. The previous version asserted the reloption but only `raise notice`d the
--      row count; it is asserted here.
--   D  The loaders still work after the revokes, and the privilege guard is genuinely
--      exercised. The previous version used `set local role service_role`, which leaves
--      session_user = postgres, so plm.wb_loader_privilege_ok (20260810030000:669-680)
--      passed on its `session_user in ('postgres','supabase_admin')` branch no matter
--      what -- the section could not fail. Impersonating a non-postgres session_user is
--      NOT possible from this connection (see the full explanation above section D), so
--      D is split into three checks that each CAN fail: D1 the guard truth table with a
--      non-postgres session_user argument, D2 proof that session_user has no other
--      influence on any loader, D3 the end-to-end run.
--   E  service_role is REFUSED a direct INSERT / UPDATE / DELETE / TRUNCATE.
--   F  No test data survived.
--
-- LAST RUN: 2026-08-10 against preview rjyboqwcdzcocqgmsyel -- all sections passed.
-- =====================================================================================

-- =====================================================================================
-- A. GRANTS. service_role must hold SELECT and NOTHING ELSE on EVERY plm.wb_* table.
--
--    UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN all arrive free from the plm
--    schema default privilege (20260710135975_reconcile_service_role_grants.sql:14) at
--    CREATE TABLE time; INSERT was granted explicitly by 20260810030000 and revoked by
--    20260810120000. MAINTAIN is real on this server (PostgreSQL 17.6).
--
--    The table list is read from pg_class, not hard-coded, so a plm.wb_* table added by a
--    later migration without a matching revoke FAILS here. The 8 known names are then
--    asserted to be PRESENT, so a rename cannot silently shrink the coverage to zero.
-- =====================================================================================
do $$
declare
  v_known text[] := array[
    'wb_franchise_property','wb_style_guide','wb_character','wb_asset',
    'wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character',
    'wb_property_character'
  ];
  v_tables text[];
  v_missing text[];
  t     text;
  p     text;
  v_bad int := 0;
  v_n   int;
begin
  select array_agg(c.relname order by c.relname) into v_tables
  from pg_class c
  where c.relnamespace = 'plm'::regnamespace
    and c.relkind = 'r'
    and c.relname like 'wb\_%';

  if v_tables is null or array_length(v_tables, 1) is null then
    raise exception 'A FAILED: pg_class returned NO plm.wb_* tables -- the enumeration is '
      'broken or the tables are gone; this test would otherwise pass vacuously';
  end if;

  select array_agg(k) into v_missing
  from unnest(v_known) k
  where not (k = any(v_tables));
  if v_missing is not null then
    raise exception 'A FAILED: expected plm.wb_* table(s) % are absent from pg_class', v_missing;
  end if;

  raise notice 'A: enumerated % plm.wb_* table(s) from pg_class: %',
    array_length(v_tables, 1), v_tables;

  foreach t in array v_tables loop
    -- Everything except SELECT must be gone.
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL service_role still holds % on plm.%', p, t;
      end if;
    end loop;

    -- SELECT must remain: the mirror is readable by the service role by design.
    if not has_table_privilege('service_role', format('plm.%I', t)::regclass, 'SELECT') then
      v_bad := v_bad + 1;
      raise warning 'FAIL service_role LOST SELECT on plm.%', t;
    end if;
  end loop;

  -- anon and PUBLIC must hold nothing at all.
  select count(*) into v_n
  from information_schema.role_table_grants
  where table_schema = 'plm' and table_name = any(v_tables)
    and grantee in ('anon', 'PUBLIC');
  if v_n <> 0 then
    v_bad := v_bad + 1;
    raise warning 'FAIL anon/PUBLIC hold % grant(s) on plm.wb_*', v_n;
  end if;

  -- authenticated must be SELECT-only (RLS is not a substitute for a grant).
  select count(*) into v_n
  from information_schema.role_table_grants
  where table_schema = 'plm' and table_name = any(v_tables)
    and grantee = 'authenticated'
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    v_bad := v_bad + 1;
    raise warning 'FAIL authenticated holds % mutation privilege(s) on plm.wb_*', v_n;
  end if;

  if v_bad > 0 then raise exception 'A FAILED (% failures)', v_bad; end if;
  raise notice 'A passed: service_role = SELECT only on all % plm.wb_* table(s); anon/PUBLIC hold nothing',
    array_length(v_tables, 1);
end;
$$;

-- =====================================================================================
-- B1. POLICY STRUCTURE. For EVERY plm.wb_* table: exactly one policy, it is a SELECT
--     policy, it is granted to {authenticated} only, its predicate is not `true`, and all
--     of them are byte-identical to each other.
--
--     "Byte-identical to each other" is the assertion that stops one table drifting to a
--     looser predicate while the others stay correct -- which is precisely how
--     20260810030000 shipped `using (true)` under a comment citing a stricter precedent.
-- =====================================================================================
do $$
declare
  v_tables text[];
  t        text;
  v_bad    int := 0;
  v_n      int;
  v_cmd    text;
  v_roles  text;
  v_qual   text;
  v_ref    text;
begin
  select array_agg(c.relname order by c.relname) into v_tables
  from pg_class c
  where c.relnamespace = 'plm'::regnamespace and c.relkind = 'r' and c.relname like 'wb\_%';

  -- RLS must be enabled at all, or every policy is decoration.
  select count(*) into v_n
  from pg_class c
  where c.relnamespace = 'plm'::regnamespace and c.relname = any(v_tables) and not c.relrowsecurity;
  if v_n <> 0 then
    raise exception 'B1 FAILED: % plm.wb_* table(s) have RLS DISABLED', v_n;
  end if;

  select qual into v_ref from pg_policies
  where schemaname = 'plm' and tablename = 'wb_franchise_property';

  if v_ref is null or btrim(lower(v_ref)) = 'true' then
    raise exception 'B1 FAILED: reference predicate on plm.wb_franchise_property is % -- '
      'the read gate is open', coalesce(v_ref, '<null>');
  end if;

  foreach t in array v_tables loop
    select count(*) into v_n from pg_policies where schemaname = 'plm' and tablename = t;
    if v_n <> 1 then
      v_bad := v_bad + 1;
      raise warning 'FAIL plm.% has % policies, expected exactly 1', t, v_n;
      continue;
    end if;

    select cmd, roles::text, qual into v_cmd, v_roles, v_qual
    from pg_policies where schemaname = 'plm' and tablename = t;

    if v_cmd <> 'SELECT' then
      v_bad := v_bad + 1;
      raise warning 'FAIL plm.% sole policy is for %, expected SELECT', t, v_cmd;
    end if;

    if v_roles <> '{authenticated}' then
      v_bad := v_bad + 1;
      raise warning 'FAIL plm.% policy roles are %, expected {authenticated}', t, v_roles;
    end if;

    if v_qual is null or btrim(lower(v_qual)) = 'true' then
      v_bad := v_bad + 1;
      raise warning 'FAIL plm.% policy predicate is % -- open to every authenticated account',
        t, coalesce(v_qual, '<null>');
    elsif v_qual is distinct from v_ref then
      v_bad := v_bad + 1;
      raise warning 'FAIL plm.% predicate DIFFERS from the reference: % vs %', t, v_qual, v_ref;
    end if;
  end loop;

  if v_bad > 0 then raise exception 'B1 FAILED (% failures)', v_bad; end if;
  raise notice 'B1 passed: all % plm.wb_* tables have exactly one SELECT policy to '
    '{authenticated} with the identical non-open predicate: %', array_length(v_tables, 1), v_ref;
end;
$$;

-- =====================================================================================
-- B2. POLICY BEHAVIOUR, evaluated as real principals against ALL EIGHT tables.
--
--     READ THIS BEFORE CHANGING THE EXPECTATIONS BELOW. The predicate is
--
--         app.has_role('administrator')
--         or app.has_app_access('plm')
--         or app.has_any_role(array['sales','licensing']::app.app_role[])
--
--     and app.has_app_access (20260621150815_app_core.sql:397-411) checks ONLY for a
--     non-revoked row in app.app_access. It never consults app.user_role and never
--     consults the JWT role names. IT IS ROLE-INDEPENDENT.
--
--     So a `vendor` or a `viewer` WITH a plm app_access row CAN READ ALL EIGHT TABLES.
--     That is asserted below as an ALLOW, because it is what the code does. Migration
--     20260810110000's comments claimed the opposite ("vendor and viewer are excluded");
--     20260810120000 corrected the comments to match this behaviour. If a future owner
--     decision narrows the app-access arm, change the PREDICATE first and then flip these
--     two expectations -- do not flip the expectation alone to match a wish.
--
--     Fixtures are built generically from information_schema, so a plm.wb_* table added
--     later is covered without editing this file. Everything is rolled back.
-- =====================================================================================
begin;

-- The synthetic principal: one profile, plm app access, and NO app role at all in
-- app.user_role. Its roles come purely from the JWT below, so the same profile serves as
-- "vendor with plm access" and "viewer with plm access".
-- session_replication_role=replica is needed ONLY to bypass auth's invitation-gate
-- trigger on auth.users (handle_new_user); it is restored immediately.
set local session_replication_role = replica;
insert into auth.users (id, email)
values ('99999999-9999-4999-8999-999999999901', 'zztest-appaccess@example.invalid');
set local session_replication_role = origin;

insert into app.profile (auth_user_id, email, display_name, status)
values ('99999999-9999-4999-8999-999999999901', 'zztest-appaccess@example.invalid',
        'ZZTEST App Access Principal', 'active');

insert into app.app_access (profile_id, app)
select id, 'plm'::app.app_name from app.profile
where auth_user_id = '99999999-9999-4999-8999-999999999901';

-- One marker row per plm.wb_* table, built from the catalog: every NOT NULL column that
-- has no default is filled by data type. source_hash carries the marker token.
do $$
declare
  t      text;
  v_cols text;
  v_vals text;
  v_term text;
begin
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'plm'::regnamespace and c.relkind = 'r' and c.relname like 'wb\_%'
    order by 1
  loop
    -- source_term is pinned by a per-table CHECK ('Property' / 'Character' / 'Style
    -- Guide'). Read the first allowed literal out of that constraint rather than
    -- hard-coding it, so a new plm.wb_* table is still handled.
    select substring(pg_get_constraintdef(c.oid) from '''([^'']*)''')
      into v_term
    from pg_constraint c
    where c.conrelid = format('plm.%I', t)::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%source_term%'
    limit 1;

    select string_agg(quote_ident(a.column_name), ', ' order by a.ordinal_position),
           string_agg(
             case
               when a.column_name = 'source_hash'                then quote_literal('ZZTESTMARKER')
               when a.column_name = 'source_term'                then quote_literal(v_term)
               when a.data_type = 'text'                         then quote_literal('ZZTEST-' || upper(a.column_name))
               when a.data_type = 'date'                         then quote_literal('2026-08-10') || '::date'
               when a.data_type = 'jsonb'                        then quote_literal('{"zztest":true}') || '::jsonb'
               when a.data_type = 'boolean'                      then 'false'
               when a.data_type = 'timestamp with time zone'     then 'now()'
               when a.data_type in ('integer','bigint','numeric') then '0'
               else 'null'
             end, ', ' order by a.ordinal_position)
      into v_cols, v_vals
    from information_schema.columns a
    where a.table_schema = 'plm' and a.table_name = t
      and a.is_nullable = 'NO' and a.column_default is null;

    execute format('insert into plm.%I (%s) values (%s)', t, v_cols, v_vals);
  end loop;
end;
$$;

do $$
declare
  v_tables  text[];
  t         text;
  v_count   int;
  v_bad     int := 0;
  v_case    text;
  v_claims  text;
  v_expect  int;
  -- label, jwt claims, expected visible rows per table
  v_cases   text[][] := array[
    -- DENY: no app access, and none of administrator/sales/licensing.
    ['vendor (no app access)',            '{"app_metadata":{"roles":["vendor"]}}',   '0'],
    ['viewer (no app access)',            '{"app_metadata":{"roles":["viewer"]}}',   '0'],
    ['designer (no app access)',          '{"app_metadata":{"roles":["designer"]}}', '0'],
    ['no app role at all',                '{"app_metadata":{"roles":[]}}',           '0'],
    -- ALLOW via a role arm.
    ['administrator',                     '{"app_metadata":{"roles":["administrator"]}}', '1'],
    ['sales',                             '{"app_metadata":{"roles":["sales"]}}',         '1'],
    ['licensing',                         '{"app_metadata":{"roles":["licensing"]}}',     '1'],
    -- ALLOW via the ROLE-INDEPENDENT app-access arm. These two are the whole point of
    -- this section: the shipped comments said they were excluded. They are not.
    ['vendor WITH plm app access',
     '{"sub":"99999999-9999-4999-8999-999999999901","app_metadata":{"roles":["vendor"]}}', '1'],
    ['viewer WITH plm app access',
     '{"sub":"99999999-9999-4999-8999-999999999901","app_metadata":{"roles":["viewer"]}}', '1']
  ];
  i int;
begin
  select array_agg(c.relname order by c.relname) into v_tables
  from pg_class c
  where c.relnamespace = 'plm'::regnamespace and c.relkind = 'r' and c.relname like 'wb\_%';

  for i in 1 .. array_length(v_cases, 1) loop
    v_case   := v_cases[i][1];
    v_claims := v_cases[i][2];
    v_expect := v_cases[i][3]::int;

    foreach t in array v_tables loop
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', v_claims, true);
      execute format('select count(*) from plm.%I where source_hash = %L', t, 'ZZTESTMARKER')
        into v_count;
      execute 'reset role';
      perform set_config('request.jwt.claims', null, true);

      if v_count <> v_expect then
        v_bad := v_bad + 1;
        raise warning 'FAIL [%] on plm.% saw % row(s), expected %', v_case, t, v_count, v_expect;
      end if;
    end loop;
  end loop;

  if v_bad > 0 then raise exception 'B2 FAILED (% principal/table failures)', v_bad; end if;
  raise notice 'B2 passed: % principals x % tables. vendor/viewer/designer/no-role are '
    'DENIED; administrator/sales/licensing are ALLOWED; and vendor-with-plm-app-access and '
    'viewer-with-plm-app-access are ALLOWED -- app.has_app_access is role-independent, '
    'exactly as the corrected comments now state.',
    array_length(v_cases, 1), array_length(v_tables, 1);
end;
$$;

rollback;

-- =====================================================================================
-- C. api.dam_order_list must be SECURITY INVOKER, and base-table RLS must demonstrably
--    apply through it.
--
--    The view's own row count is currently 0 for everyone because plm.production_order
--    and plm.production_order_line are empty on preview, so a row-count comparison on the
--    view alone would pass under EITHER security mode and prove nothing. The load-bearing
--    assertion is therefore made against core.customer -- a populated base table of the
--    view whose SELECT policy is restricted -- read as a no-role principal. Under invoker
--    semantics that principal must see FEWER rows than the owner does.
-- =====================================================================================
begin;
do $$
declare
  v_opts       text[];
  v_view_rows  int;
  v_cust_owner int;
  v_cust_noRole int;
begin
  select reloptions into v_opts
  from pg_class where relnamespace = 'api'::regnamespace and relname = 'dam_order_list';

  if v_opts is null or not ('security_invoker=true' = any(v_opts)) then
    raise exception 'C FAILED: api.dam_order_list reloptions = % -- security_invoker is '
      'NOT set, so the view runs as postgres (BYPASSRLS) and every authenticated account '
      'reads around the RLS on core.customer, core.factory and plm.item',
      coalesce(v_opts::text, '<null>');
  end if;

  select count(*) into v_cust_owner from core.customer;
  if v_cust_owner = 0 then
    raise exception 'C FAILED: core.customer is EMPTY, so the RLS-inheritance assertion '
      'below would pass vacuously. Point it at a populated restricted base table.';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"app_metadata":{"roles":[]}}', true);
  select count(*) into v_view_rows  from api.dam_order_list;
  select count(*) into v_cust_noRole from core.customer;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- ASSERTED, not merely reported: a no-role principal must not read the restricted base
  -- table through invoker semantics.
  if v_cust_noRole <> 0 then
    raise exception 'C FAILED: a no-role authenticated principal read % of % core.customer '
      'row(s) -- base-table RLS is not being applied', v_cust_noRole, v_cust_owner;
  end if;

  -- ASSERTED: the view itself must not leak rows to a no-role principal either.
  if v_view_rows <> 0 then
    raise exception 'C FAILED: a no-role authenticated principal read % row(s) from '
      'api.dam_order_list', v_view_rows;
  end if;

  raise notice 'C passed: api.dam_order_list is security_invoker=true; a no-role principal '
    'reads 0 of % core.customer rows and 0 view rows', v_cust_owner;
end;
$$;
rollback;

-- =====================================================================================
-- D. The Warner loaders must STILL WORK after the revokes -- and this must be capable of
--    FAILING.
--
--    THE DEFECT THIS REPLACES. The previous version ran the loader under
--    `set local role service_role`. That changes current_user but NOT session_user, which
--    stayed `postgres`. plm.wb_loader_privilege_ok(auth.role(), session_user)
--    (20260810030000:669-680) is TRUE if EITHER the JWT role is service_role OR
--    session_user is in ('postgres','supabase_admin'), so the second branch was
--    unconditionally true and the section could not fail no matter what the guard did.
--
--    WHY IT IS NOT SIMPLY FIXED WITH A NON-POSTGRES session_user. It cannot be, from this
--    connection. `set local session authorization` requires the SESSION's initial role to
--    be a SUPERUSER, and on Supabase the `postgres` login role is NOT one
--    (pg_roles.rolsuper = false, verified on preview 2026-08-10); the statement fails with
--    "permission denied to set session authorization". `service_role` is NOLOGIN so it
--    cannot be connected as directly, `supabase_admin`'s credentials are not held here,
--    and neither dblink nor pg_background is installed, so a second connection cannot be
--    opened from inside SQL either. Closing this properly needs a LOGIN role that is a
--    member of service_role -- in practice `authenticator`, which is exactly what
--    PostgREST connects as in production -- and its password. That is a credential the
--    test harness does not have. DO NOT "fix" this by creating a login role: that is a
--    persistent cluster-level object on a shared preview database.
--
--    WHAT IS ASSERTED INSTEAD -- three falsifiable checks that together carry the same
--    claim without needing to impersonate a login role:
--
--      D1  The guard's TRUTH TABLE, evaluated with a NON-POSTGRES session_user argument.
--          plm.wb_loader_privilege_ok is IMMUTABLE and a pure function of its two
--          arguments, so passing the argument directly is equivalent to being that
--          principal, for this function. This is what proves a non-postgres caller is
--          admitted on the JWT branch and rejected without it.
--      D2  That session_user has NO OTHER INFLUENCE on any loader: each of the eight
--          function bodies is read from pg_get_functiondef and must mention session_user
--          ONLY inside its wb_loader_privilege_ok(...) guard call. If a loader ever grows
--          a second session_user test, D1 stops generalising -- and this check fails.
--      D3  The loader still runs end to end and lands its row after the revokes.
--
--    D1 and D2 both fail loudly on a real regression; D3 fails if the revokes broke the
--    SECURITY DEFINER write path.
-- =====================================================================================
begin;

-- D1 -- guard truth table with a non-postgres session_user.
do $$
declare
  v_bad int := 0;
  procedure_note text;
begin
  if plm.wb_loader_privilege_ok('service_role', 'zztest_not_postgres') is not true then
    v_bad := v_bad + 1;
    raise warning 'FAIL D1: a service_role JWT from a NON-POSTGRES session_user is REJECTED '
      '-- the real serverless caller cannot run the loaders';
  end if;
  if plm.wb_loader_privilege_ok(null, 'zztest_not_postgres') is not false then
    v_bad := v_bad + 1;
    raise warning 'FAIL D1: a NULL role from a non-postgres session_user is ADMITTED';
  end if;
  if plm.wb_loader_privilege_ok('authenticated', 'zztest_not_postgres') is not false then
    v_bad := v_bad + 1;
    raise warning 'FAIL D1: an `authenticated` JWT from a non-postgres session_user is ADMITTED';
  end if;
  if plm.wb_loader_privilege_ok(null, null) is not false then
    v_bad := v_bad + 1;
    raise warning 'FAIL D1: NULL/NULL is ADMITTED';
  end if;
  if v_bad > 0 then raise exception 'D1 FAILED (% failures)', v_bad; end if;
  raise notice 'D1 passed: the loader guard admits a service_role JWT from a NON-POSTGRES '
    'session_user and rejects null / authenticated / null-null';
end;
$$;

-- D2 -- session_user must not influence a loader anywhere except that guard call.
--
-- Each loader legitimately mentions session_user three times:
--   1. the DECISION            -- plm.wb_loader_privilege_ok(v_role, session_user)
--   2. a diagnostic LITERAL    -- '... JWT role %L / session_user %L is not ...'
--   3. a diagnostic ARGUMENT   -- coalesce(session_user, '<null>')
-- Only (1) can change behaviour. This asserts that total = decision + literal + argument,
-- so any FOURTH use -- e.g. a second `if session_user = ...` branch -- fails the section.
do $$
declare
  f        record;
  v_body   text;
  v_total  int;
  v_guard  int;
  v_lit    int;
  v_diag   int;
  v_bad    int := 0;
  v_seen   int := 0;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    where p.pronamespace = 'plm'::regnamespace
      and p.proname like 'sync\_wb\_%'
  loop
    v_seen := v_seen + 1;
    v_body := pg_get_functiondef(f.oid);

    v_total := (length(v_body) - length(replace(v_body, 'session_user', ''))) / length('session_user');
    v_guard := (select count(*) from regexp_matches(
                  v_body, 'wb_loader_privilege_ok\s*\([^)]*session_user[^)]*\)', 'g'));
    v_lit   := (select count(*) from regexp_matches(v_body, 'session_user %L', 'g'));
    v_diag  := (select count(*) from regexp_matches(v_body, 'coalesce\(session_user', 'g'));

    if v_total <> v_guard + v_lit + v_diag then
      v_bad := v_bad + 1;
      raise warning 'FAIL D2: plm.% mentions session_user % time(s); accounted for: % guard '
        '+ % literal + % diagnostic = %. An UNACCOUNTED use of session_user can change '
        'behaviour, so D1 no longer generalises to this loader',
        f.proname, v_total, v_guard, v_lit, v_diag, v_guard + v_lit + v_diag;
    end if;
    if v_guard < 1 then
      v_bad := v_bad + 1;
      raise warning 'FAIL D2: plm.% has NO wb_loader_privilege_ok(session_user) guard', f.proname;
    end if;
  end loop;

  if v_seen < 8 then
    raise exception 'D2 FAILED: found only % plm.sync_wb_* loader(s), expected at least 8', v_seen;
  end if;
  if v_bad > 0 then raise exception 'D2 FAILED (% failures)', v_bad; end if;
  raise notice 'D2 passed: all % plm.sync_wb_* loaders reference session_user ONLY inside '
    'their wb_loader_privilege_ok guard', v_seen;
end;
$$;

-- D3 -- end to end after the revokes.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  v_landed int;
  v_ins    int;
begin
  execute 'set local role service_role';
  if auth.role() <> 'service_role' then
    raise exception 'D3 FAILED (setup): auth.role() is %, expected service_role', auth.role();
  end if;

  select rows_landed, rows_inserted into v_landed, v_ins
  from plm.sync_wb_franchise_property(
    jsonb_build_object(
      'captured_at', '2026-08-10',
      'rows', jsonb_build_array(
        jsonb_build_object(
          'source_term',   'Property',
          'source_id',     'ZZTEST-9000002',
          'label',         'ZZTEST Franchise Two',
          'captured_date', '2026-08-10',
          'source_url',    'https://example.invalid/zztest2'
        )
      )
    ),
    'mirror_only',
    1.0
  );

  execute 'reset role';

  if coalesce(v_landed, -1) <> 1 or coalesce(v_ins, -1) <> 1 then
    raise exception 'D3 FAILED: plm.sync_wb_franchise_property landed % / inserted % '
      '(expected 1 / 1) -- the revokes in 20260810120000 broke the SECURITY DEFINER '
      'write path', v_landed, v_ins;
  end if;

  raise notice 'D3 passed: plm.sync_wb_franchise_property landed 1 / inserted 1 as '
    'service_role AFTER INSERT was revoked -- the loaders never consumed service_role''s '
    'table grants, exactly as 20260810120000 claims';
end;
$$;

rollback;

-- =====================================================================================
-- E. service_role must be REFUSED a direct INSERT, UPDATE, DELETE and TRUNCATE on a
--    Warner table. Section A reads the catalog; this one runs the statements.
--    INSERT is included here because 20260810120000 revoked it: the point of that revoke
--    is that the refusal is LOUD (42501 insufficient_privilege), not silent.
-- =====================================================================================
begin;
do $$
declare
  v_bad  int := 0;
  v_stmt text;
begin
  foreach v_stmt in array array[
    'insert into plm.wb_franchise_property (source_term, source_id, label, captured_date, source_url, raw, source_hash) values (''Property'',''ZZTEST-9000003'',''ZZTEST'',date ''2026-08-10'',''https://example.invalid/z'',''{}''::jsonb,''ZZTESTMARKER'')',
    'update plm.wb_franchise_property set label = label',
    'delete from plm.wb_franchise_property',
    'truncate plm.wb_franchise_property'
  ]
  loop
    begin
      execute 'set local role service_role';
      execute v_stmt;
      execute 'reset role';
      v_bad := v_bad + 1;
      raise warning 'FAIL service_role was ALLOWED to run: %', v_stmt;
      raise exception 'ZZTEST unwind' using errcode = 'ZZ999';
    exception
      when sqlstate 'ZZ999' then null;
      when insufficient_privilege then null;
    end;
  end loop;

  if v_bad > 0 then raise exception 'E FAILED (% failures)', v_bad; end if;
  raise notice 'E passed: service_role is refused INSERT, UPDATE, DELETE and TRUNCATE on '
    'plm.wb_franchise_property (42501 insufficient_privilege -- loud, not silent)';
end;
$$;
rollback;

-- =====================================================================================
-- F. NO TEST DATA SURVIVED. Every writing section above ends in ROLLBACK; this asserts it
--    against the committed state rather than trusting it.
-- =====================================================================================
do $$
declare
  t       text;
  v_n     int;
  v_total int := 0;
begin
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'plm'::regnamespace and c.relkind = 'r' and c.relname like 'wb\_%'
  loop
    execute format(
      'select count(*) from plm.%I where source_hash = %L or coalesce(source_url,'''') like %L',
      t, 'ZZTESTMARKER', 'https://example.invalid/%') into v_n;
    v_total := v_total + v_n;
  end loop;

  select v_total + count(*) into v_total
  from app.profile where auth_user_id = '99999999-9999-4999-8999-999999999901';

  select v_total + count(*) into v_total
  from auth.users where id = '99999999-9999-4999-8999-999999999901';

  if v_total <> 0 then
    raise exception 'F FAILED: % ZZTEST artefact(s) survived -- a section did not roll back', v_total;
  end if;
  raise notice 'F passed: zero ZZTEST rows and zero synthetic principals remain';
end;
$$;
