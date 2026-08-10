-- =====================================================================================
-- Contract test for migration 20260810170000_plm_item_authenticated_read.sql
-- (issue #653, claim #698) -- the blank item columns in api.dam_order_list for PopDAM
-- staff.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, as the migration owner (`postgres`) on
--   the SESSION pooler port 5432, NOT the transaction pooler port 6543:
--       psql "$PREVIEW_SESSION_URL" \
--            -v ON_ERROR_STOP=1 -f supabase/tests/dam_order_list_item_columns_contract.sql
--
--   $PREVIEW_SESSION_URL is the preview owner connection string on the SESSION pooler
--   (port 5432, user `postgres.<preview-project-ref>`, sslmode=require) -- the same URL
--   supabase/tests/wb_grants_rls_and_dam_order_list_invoker.sql documents in full. It is
--   not repeated literally here because the PII forward guard reads `user@host` as an
--   email address (AGENTS.md section 6.14).
--
--   The owner connection is required because section C builds a synthetic principal in
--   auth.users behind `session_replication_role = replica` (auth's handle_new_user
--   invitation gate would otherwise refuse the insert), exactly as
--   supabase/tests/wb_grants_rls_and_dam_order_list_invoker.sql section B2 does. On port
--   6543 the transaction pooler wraps the whole batch in one implicit transaction and
--   stalls -- observed on this database 2026-08-09.
--
-- SIDE EFFECTS: NONE. The entire file is ONE explicit transaction that ends in ROLLBACK.
--   Preview carries a production data clone, so this file must never be converted to
--   `commit`.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. Fixtures use
--   ZZTEST-* tokens, example.invalid addresses and the reserved uuid prefix
--   99999999-9999-4999-8999-*.
--
-- WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
--   A  The new policy exists on plm.item and is PERMISSIVE, cmd SELECT, to
--      {authenticated}. It also asserts that plm.item's policy set is EXACTLY
--      {plm_read, plm_admin_write, item_popdam_read}: if some other policy were doing
--      the work, section C would pass for the wrong reason.
--   B  api.dam_order_list is STILL security_invoker = true. 20260810110000:183 set that
--      deliberately; reverting it would make the item columns populate again while
--      silently re-exposing core.customer, core.factory and plm.item to every
--      authenticated account THROUGH THE VIEW. Any future revert must fail here, loudly.
--   C  THE ACTUAL DEFECT. A PopDAM-staff-shaped principal -- `dam` app access, JWT role
--      designer or viewer, NOT administrator/sales/licensing, and NO plm app access --
--      reads a fixture row through api.dam_order_list and gets NON-NULL item_number,
--      item_style_number, item_name and item_description.
--
--      C is guarded against passing vacuously. Before the read it asserts, AS THAT
--      PRINCIPAL, that every arm of the plm_read predicate
--      (20260621151155_api_rls_realtime.sql:457) evaluates FALSE. So the only policy
--      that can be admitting the row is the new one, and before 20260810170000 this
--      section fails on NULL item columns.
--
--      The principal is resolved the way the database resolves it: app.has_role reads
--      the request JWT (app.jwt_role_names) and app.has_app_access reads app.app_access
--      via app.current_profile_id() -> auth.uid(). NEITHER consults `current_user`.
--      A reviewer got this wrong once. Hence `set local role authenticated` PLUS a
--      request.jwt.claims payload carrying `sub`, matching the mechanism in
--      wb_grants_rls_and_dam_order_list_invoker.sql sections B2 and C.
--
-- LAST RUN: not yet run -- authored 2026-08-10, to be run on preview by the orchestrator.
-- =====================================================================================

begin;

-- =====================================================================================
-- A. THE POLICY ITSELF
-- =====================================================================================
do $$
declare
  v_cmd        text;
  v_permissive text;
  v_roles      text;
  v_qual       text;
  v_policies   text[];
  v_bad        int := 0;
begin
  select cmd, permissive, roles::text, qual
    into v_cmd, v_permissive, v_roles, v_qual
  from pg_policies
  where schemaname = 'plm' and tablename = 'item' and policyname = 'item_popdam_read';

  if not found then
    raise exception 'A FAILED: policy item_popdam_read does not exist on plm.item -- '
      'migration 20260810170000 has not been applied';
  end if;

  if v_cmd <> 'SELECT' then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: item_popdam_read is for %, expected SELECT', v_cmd;
  end if;

  -- RESTRICTIVE would AND with plm_read instead of OR-ing, which would NARROW the read
  -- audience to nobody rather than widening it. The whole fix depends on PERMISSIVE.
  if upper(v_permissive) <> 'PERMISSIVE' then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: item_popdam_read is %, expected PERMISSIVE -- a restrictive '
      'policy ANDs with plm_read and would make things worse, not better', v_permissive;
  end if;

  if v_roles <> '{authenticated}' then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: item_popdam_read roles are %, expected {authenticated}', v_roles;
  end if;

  if v_qual is null or btrim(lower(v_qual)) <> 'true' then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: item_popdam_read predicate is %, expected true (owner ruling '
      'Option A)', coalesce(v_qual, '<null>');
  end if;

  -- The baseline PLM policies must both survive: this change is additive, and it must
  -- not have widened WRITES.
  select array_agg(policyname order by policyname) into v_policies
  from pg_policies where schemaname = 'plm' and tablename = 'item';

  if v_policies is distinct from array['item_popdam_read','plm_admin_write','plm_read'] then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: plm.item policy set is %, expected exactly '
      '{item_popdam_read, plm_admin_write, plm_read}. Either the additive change dropped '
      'a baseline policy, or an unexpected policy exists -- in which case section C '
      'could pass for the wrong reason', v_policies;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'plm.item'::regclass) then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: RLS is DISABLED on plm.item -- every policy here is decoration';
  end if;

  -- A policy is useless without the table grant, and vice versa. Both must hold.
  if not has_table_privilege('authenticated', 'plm.item', 'SELECT') then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: authenticated holds no SELECT grant on plm.item';
  end if;

  -- Writes were NOT widened by this change.
  if has_table_privilege('anon', 'plm.item', 'SELECT') then
    v_bad := v_bad + 1;
    raise warning 'FAIL A: anon can select plm.item';
  end if;

  if v_bad > 0 then raise exception 'A FAILED (% failures)', v_bad; end if;
  raise notice 'A passed: plm.item carries exactly {item_popdam_read, plm_admin_write, '
    'plm_read}; item_popdam_read is a PERMISSIVE SELECT policy to {authenticated} using (true)';
end;
$$;

-- =====================================================================================
-- B. api.dam_order_list MUST STILL BE security_invoker = true.
--
--    This is the regression guard for the one thing this fix must never become. If a
--    future session "fixes" a blank-column report by dropping security_invoker, the item
--    columns will populate -- and core.customer, core.factory and plm.item will be
--    readable by every authenticated account through the view, because it would then run
--    as its owner (postgres, BYPASSRLS). That must fail here rather than ship.
-- =====================================================================================
do $$
declare
  v_opts text[];
begin
  select reloptions into v_opts
  from pg_class where relnamespace = 'api'::regnamespace and relname = 'dam_order_list';

  if v_opts is null or not ('security_invoker=true' = any(v_opts)) then
    raise exception 'B FAILED: api.dam_order_list reloptions = % -- security_invoker is '
      'NOT true. The view now runs as postgres (BYPASSRLS) and every authenticated '
      'account reads around the RLS on core.customer, core.factory and plm.item. '
      '20260810110000:183 set this deliberately; restore it instead of reverting it',
      coalesce(v_opts::text, '<null>');
  end if;

  raise notice 'B passed: api.dam_order_list is still security_invoker=true';
end;
$$;

-- =====================================================================================
-- C. THE DEFECT ITSELF, as a real PopDAM-staff-shaped principal.
-- =====================================================================================

-- The synthetic principal: one active profile with `dam` app access (the PopDAM app; the
-- app.app_name enum has no `popdam` label) and NO row in app.user_role at all. Its roles
-- come purely from the JWT below, so the same profile serves as both "designer" and
-- "viewer". session_replication_role=replica is needed ONLY to bypass auth's
-- invitation-gate trigger on auth.users (handle_new_user); it is restored immediately.
set local session_replication_role = replica;
insert into auth.users (id, email)
values ('99999999-9999-4999-8999-999999999653', 'zztest-popdam-staff@example.invalid');
set local session_replication_role = origin;

insert into app.profile (auth_user_id, email, display_name, status)
values ('99999999-9999-4999-8999-999999999653', 'zztest-popdam-staff@example.invalid',
        'ZZTEST PopDAM Staff Principal', 'active');

insert into app.app_access (profile_id, app)
select id, 'dam'::app.app_name from app.profile
where auth_user_id = '99999999-9999-4999-8999-999999999653';

do $$
declare
  v_item   uuid;
  v_order  uuid;
  v_line   uuid;
  v_bad    int := 0;
  v_case   text;
  v_claims text;
  v_n      int;
  v_number text;
  v_style  text;
  v_name   text;
  v_desc   text;
  v_b      boolean;
  v_roles  text[] := array['designer', 'viewer'];
  r        text;
begin
  -- ------------------------------------------------------------------ fixtures ------
  -- plm.item still carries `unique nulls not distinct (source_system, source_id)`, so a
  -- source-less fixture item would collide with any other. Give it its own pair.
  insert into plm.item (item_number, style_number, name, description, source_system, source_id)
  values ('ZZTEST-ITEM-653', 'ZZTESTSTYLE653', 'ZZTEST Item 653',
          'ZZTEST item description 653', 'dam_order_list_item_columns_contract',
          'ct653-item')
  returning id into v_item;

  insert into plm.production_order (production_order_number, status, source_system, source_id)
  values ('ZZTEST-PO-653', 'Open', 'dam_order_list_item_columns_contract', 'ct653-order')
  returning id into v_order;

  insert into plm.production_order_line
    (production_order_id, line_number, sku, quantity_ordered, source_style_type,
     item_id, master_data_match_status, source_system, source_id)
  values
    (v_order, '1', 'ZZTESTSTYLE653', 1, 'licensed',
     v_item, 'matched', 'dam_order_list_item_columns_contract', 'ct653-line')
  returning id into v_line;

  -- Sanity: as the owner, the view must project the item facts. If this fails the
  -- fixture is wrong and everything below would be measuring nothing.
  select item_number into v_number from api.dam_order_list where order_line_id = v_line;
  if v_number is distinct from 'ZZTEST-ITEM-653' then
    raise exception 'C FAILED (fixture): the OWNER reads item_number = % through the '
      'view, expected ZZTEST-ITEM-653. The fixture, not the policy, is broken',
      coalesce(v_number, '<null>');
  end if;

  -- ------------------------------------------------------- the principal, per role ---
  foreach r in array v_roles loop
    v_case := r || ' with dam app access (PopDAM staff shape)';
    v_claims := json_build_object(
      'sub', '99999999-9999-4999-8999-999999999653',
      'role', 'authenticated',
      'app_metadata', json_build_object('roles', json_build_array(r))
    )::text;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', v_claims, true);

    -- NON-VACUITY GATE. Every arm of plm_read must be FALSE for this principal, or the
    -- read below proves nothing about the new policy.
    select app.has_app_access('plm'::app.app_name) into v_b;
    if v_b is not false then
      v_bad := v_bad + 1;
      raise warning 'FAIL C [%]: app.has_app_access(''plm'') is % -- the principal is not '
        'PopDAM-staff-shaped and the assertions below would pass via plm_read', v_case, v_b;
    end if;

    select app.has_role('administrator'::app.app_role) into v_b;
    if v_b is not false then
      v_bad := v_bad + 1;
      raise warning 'FAIL C [%]: the principal IS an administrator', v_case;
    end if;

    select app.has_any_role(array['sales','licensing']::app.app_role[]) into v_b;
    if v_b is not false then
      v_bad := v_bad + 1;
      raise warning 'FAIL C [%]: the principal holds sales/licensing', v_case;
    end if;

    -- ...and it really is the intended profile, i.e. the JWT `sub` resolved.
    select app.has_app_access('dam'::app.app_name) into v_b;
    if v_b is not true then
      v_bad := v_bad + 1;
      raise warning 'FAIL C [%]: app.has_app_access(''dam'') is % -- the JWT sub did not '
        'resolve to the synthetic profile, so this principal is not PopDAM staff at all '
        'and the whole section is measuring the wrong thing', v_case, v_b;
    end if;

    -- 1. The base table is readable at all.
    select count(*) into v_n from plm.item where id = v_item;
    if v_n <> 1 then
      v_bad := v_bad + 1;
      raise warning 'FAIL C [%]: read % of 1 fixture row(s) from plm.item -- the additive '
        'SELECT policy is not admitting PopDAM staff', v_case, v_n;
    end if;

    -- 2. THE DEFECT: the four item columns must come back NON-NULL through the view.
    select item_number, item_style_number, item_name, item_description
      into v_number, v_style, v_name, v_desc
    from api.dam_order_list where order_line_id = v_line;

    if v_number is distinct from 'ZZTEST-ITEM-653'
       or v_style  is distinct from 'ZZTESTSTYLE653'
       or v_name   is distinct from 'ZZTEST Item 653'
       or v_desc   is distinct from 'ZZTEST item description 653' then
      v_bad := v_bad + 1;
      raise warning 'FAIL C [%]: api.dam_order_list projected item_number=%, '
        'item_style_number=%, item_name=%, item_description=% -- ISSUE #653 IS NOT FIXED',
        v_case, coalesce(v_number,'<null>'), coalesce(v_style,'<null>'),
        coalesce(v_name,'<null>'), coalesce(v_desc,'<null>');
    end if;

    -- 3. The line itself is visible (production_order[_line]_popdam_read, 20260810010000)
    --    and the link diagnostic is honest.
    select item_link_missing into v_b from api.dam_order_list where order_line_id = v_line;
    if v_b is not false then
      v_bad := v_bad + 1;
      raise warning 'FAIL C [%]: item_link_missing is % on a linked line', v_case, v_b;
    end if;

    -- 4. The change did NOT widen writes. plm_admin_write is administrator-only and this
    --    principal is not one, so an UPDATE must be refused by RLS.
    begin
      update plm.item set name = 'ZZTEST tampered' where id = v_item;
      -- RLS refuses an UPDATE with no matching policy by affecting ZERO rows, not by
      -- raising, so check the row count rather than expecting an exception.
      get diagnostics v_n = row_count;
      if v_n <> 0 then
        v_bad := v_bad + 1;
        raise warning 'FAIL C [%]: a non-administrator UPDATED % row(s) of plm.item -- '
          'this change widened WRITES, which it must not', v_case, v_n;
      end if;
    exception when insufficient_privilege then
      null;  -- a grant-level refusal is equally acceptable, and equally loud
    end;

    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
  end loop;

  if v_bad > 0 then
    raise exception 'C FAILED (% failures)', v_bad;
  end if;

  raise notice 'C passed: a PopDAM-staff-shaped principal (dam app access, designer or '
    'viewer, no plm access, not administrator/sales/licensing -- every arm of plm_read '
    'asserted FALSE) reads plm.item and gets non-NULL item_number / item_style_number / '
    'item_name / item_description through api.dam_order_list, and still cannot write it';
end;
$$;

-- Everything above -- fixtures, the synthetic principal, its auth.users row -- is
-- discarded here. NEVER convert this to `commit`: preview carries a production clone.
rollback;

-- =====================================================================================
-- D. NOTHING SURVIVED. Runs after the rollback, against committed state.
-- =====================================================================================
do $$
declare
  v_total int := 0;
begin
  select count(*) into v_total from plm.item
   where source_system = 'dam_order_list_item_columns_contract';
  select v_total + count(*) into v_total from plm.production_order
   where source_system = 'dam_order_list_item_columns_contract';
  select v_total + count(*) into v_total from plm.production_order_line
   where source_system = 'dam_order_list_item_columns_contract';
  select v_total + count(*) into v_total from app.profile
   where auth_user_id = '99999999-9999-4999-8999-999999999653';
  select v_total + count(*) into v_total from auth.users
   where id = '99999999-9999-4999-8999-999999999653';

  if v_total <> 0 then
    raise exception 'D FAILED: % ZZTEST artefact(s) survived -- the transaction did not '
      'roll back', v_total;
  end if;
  raise notice 'D passed: zero ZZTEST rows and zero synthetic principals remain';
end;
$$;
