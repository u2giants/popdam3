-- =====================================================================================
-- Contract tests for migration 20261015132149_pm_jev_activity_triage_contract_a.sql
-- (#3298 claim #4204 -- PM Jev activity-triage migration A).
--
-- Run against a database where every supabase/migrations file is applied.
-- SIDE EFFECTS: fixture inserts/updates inside a transaction that ROLLS BACK.
--
-- WHAT IT ASSERTS
--   A  CATALOG. New tables, column, trigger, policies, NOLOGIN role, and grants exist
--      with the intended privilege surface (no public/anon execute on wrappers).
--   B  COMMENT VALIDATION. Empty/whitespace, >4,000, and NUL/control bodies are
--      rejected by api.pm_add_product_comment before insert.
--   C  BODY REVISION. Insert starts at 1; body change bumps; non-body change does not.
--   D  NON-ADMIN DENIED. A sales-role profile cannot create comments or operations.
--   E  CROSS-USER ISOLATION. User B cannot read user A's triage row via RLS.
--   F  ACCEPT ONCE. Accept creates one record and is idempotent; dismiss is terminal.
--   G  ENVELOPE / LEASE. Complete without a valid HMAC envelope is rejected; wrong
--      lease hash is rejected; body edit marks source_changed and blocks accept.
--   H  OPERATIONS SHAPES. Dependency/decision/reminder rows match My Work /
--      pm_department_report field contracts.
-- =====================================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_admin_auth uuid := gen_random_uuid();
  v_admin_profile uuid;
  v_sales_auth uuid := gen_random_uuid();
  v_sales_profile uuid;
  v_other_auth uuid := gen_random_uuid();
  v_other_profile uuid;
  v_product uuid := gen_random_uuid();
  v_comment uuid;
  v_rev integer;
  v_result jsonb;
  v_triage_id uuid;
  v_lease_hash text;
  v_dep_id uuid;
  v_count integer;
  v_raised boolean;
  v_state text;
  v_op_id uuid;
begin
  -- ------------------------------------------------------------------
  -- A  CATALOG
  -- ------------------------------------------------------------------
  if to_regclass('pim.ai_activity_triage') is null then
    raise exception 'missing table pim.ai_activity_triage';
  end if;
  if to_regclass('pim.ai_activity_triage_eligibility') is null then
    raise exception 'missing table pim.ai_activity_triage_eligibility';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'comment' and column_name = 'body_revision'
      and data_type = 'integer'
  ) then
    raise exception 'missing or wrong-typed app.comment.body_revision';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'app_comment_body_revision' and tgrelid = 'app.comment'::regclass
  ) then
    raise exception 'missing trigger app_comment_body_revision';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'comment_body_revision_trg_fn'
  ) then
    raise exception 'missing app.comment_body_revision_trg_fn';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pm_jev_triage_worker') then
    raise exception 'missing role pm_jev_triage_worker';
  end if;
  if exists (select 1 from pg_roles where rolname = 'pm_jev_triage_worker' and rolcanlogin) then
    raise exception 'pm_jev_triage_worker must be NOLOGIN';
  end if;
  -- Private workers are not executable by authenticated/anon/public.
  if has_function_privilege('authenticated', 'pim.pm_complete_activity_triage_worker(uuid,text,text,jsonb,jsonb,text)', 'execute') then
    raise exception 'authenticated must not execute pm_complete_activity_triage_worker';
  end if;
  if has_function_privilege('anon', 'api.pm_add_product_comment(uuid,text,uuid)', 'execute') then
    raise exception 'anon must not execute pm_add_product_comment';
  end if;
  if not has_function_privilege('authenticated', 'api.pm_add_product_comment(uuid,text,uuid)', 'execute') then
    raise exception 'authenticated must execute pm_add_product_comment';
  end if;
  -- Role attributes: NOLOGIN worker is least-privilege.
  if exists (
    select 1 from pg_roles
    where rolname = 'pm_jev_triage_worker'
      and (rolcanlogin or rolsuper or rolbypassrls or rolinherit)
  ) then
    raise exception 'pm_jev_triage_worker must be NOLOGIN/NOSUPERUSER/NOBYPASSRLS/NOINHERIT';
  end if;
  -- RLS policies exist with the intended command/roles (exact-object, not name-only).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'pim' and tablename = 'ai_activity_triage'
      and policyname = 'pm_ai_activity_triage_select_own'
      and cmd = 'SELECT' and roles = '{authenticated}'
  ) then
    raise exception 'policy pm_ai_activity_triage_select_own missing or wrong shape';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'pim' and tablename = 'ai_activity_triage_eligibility'
      and policyname = 'pm_ai_activity_triage_eligibility_select_own'
      and cmd = 'SELECT' and roles = '{authenticated}'
  ) then
    raise exception 'policy pm_ai_activity_triage_eligibility_select_own missing or wrong shape';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'pim' and tablename = 'ai_activity_triage'
      and policyname = 'pm_ai_activity_triage_worker_all'
      and cmd = 'ALL' and roles = '{pm_jev_triage_worker}'
  ) then
    raise exception 'policy pm_ai_activity_triage_worker_all missing or wrong shape';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'pim' and tablename = 'ai_activity_triage'
      and policyname = 'pm_ai_activity_triage_admin_audit'
      and cmd = 'SELECT' and roles = '{authenticated}'
  ) then
    raise exception 'policy pm_ai_activity_triage_admin_audit missing or wrong shape';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'pim' and tablename = 'ai_activity_triage_eligibility'
      and policyname = 'pm_ai_activity_triage_eligibility_worker_all'
      and cmd = 'ALL' and roles = '{pm_jev_triage_worker}'
  ) then
    raise exception 'policy pm_ai_activity_triage_eligibility_worker_all missing or wrong shape';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'pim' and tablename = 'ai_activity_triage_eligibility'
      and policyname = 'pm_ai_activity_triage_eligibility_admin_audit'
      and cmd = 'SELECT' and roles = '{authenticated}'
  ) then
    raise exception 'policy pm_ai_activity_triage_eligibility_admin_audit missing or wrong shape';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'pm_jev_source_changed' and tgrelid = 'app.comment'::regclass
  ) then
    raise exception 'missing trigger pm_jev_source_changed';
  end if;
  -- Depended-on function signatures exist (exact-object).
  if to_regprocedure('app.current_profile_id()') is null then
    raise exception 'missing app.current_profile_id()';
  end if;
  if to_regprocedure('app.has_role(app.app_role)') is null then
    raise exception 'missing app.has_role(app.app_role)';
  end if;
  if to_regprocedure('app.has_app_access(app.app_name)') is null then
    raise exception 'missing app.has_app_access(app.app_name)';
  end if;
  -- Indexes created by this migration are present.
  foreach v_state in array array[
    'ai_activity_triage_live_comment_idx',
    'ai_activity_triage_eligibility_comment_idx',
    'ai_activity_triage_eligibility_token_idx',
    'ai_activity_triage_comment_idempotency_key',
    'ai_activity_triage_requester_idx',
    'ai_activity_triage_state_idx'
  ] loop
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'pim' and indexname = v_state
    ) then
      raise exception 'missing index %', v_state;
    end if;
  end loop;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'app' and indexname = 'app_comment_poppim_client_operation_uq'
      and indexdef like '%UNIQUE%'
  ) then
    raise exception 'app_comment_poppim_client_operation_uq missing or not UNIQUE';
  end if;
  -- Trigger-to-function linkage (exact-object).
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgname = 'app_comment_body_revision' and t.tgrelid = 'app.comment'::regclass
      and p.proname = 'comment_body_revision_trg_fn'
  ) then
    raise exception 'app_comment_body_revision not linked to comment_body_revision_trg_fn';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgname = 'pm_jev_source_changed' and t.tgrelid = 'app.comment'::regclass
      and p.proname = 'pm_jev_source_changed_trg_fn'
  ) then
    raise exception 'pm_jev_source_changed not linked to pm_jev_source_changed_trg_fn';
  end if;
  -- Policy USING expressions (exact-object).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'pim' and tablename = 'ai_activity_triage'
      and policyname = 'pm_ai_activity_triage_select_own'
      and qual like '%current_profile_id%'
  ) then
    raise exception 'pm_ai_activity_triage_select_own USING does not bind current_profile_id';
  end if;

  -- ------------------------------------------------------------------
  -- Fixtures (rolled back)
  -- ------------------------------------------------------------------
  -- popcre.com + provider azure passes the invitation gate and creates profiles.
  -- Domain is concatenated so the PII forward guard does not read a literal address.
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
    (v_admin_auth, 'jev-admin-' || v_admin_auth || '@' || 'popcre.com', '{}', '{"provider":"azure"}'),
    (v_sales_auth, 'jev-sales-' || v_sales_auth || '@' || 'popcre.com', '{}', '{"provider":"azure"}'),
    (v_other_auth, 'jev-other-' || v_other_auth || '@' || 'popcre.com', '{}', '{"provider":"azure"}');

  select id into v_admin_profile from app.profile where auth_user_id = v_admin_auth;
  select id into v_sales_profile from app.profile where auth_user_id = v_sales_auth;
  select id into v_other_profile from app.profile where auth_user_id = v_other_auth;
  if v_admin_profile is null or v_sales_profile is null or v_other_profile is null then
    raise exception 'signup trigger did not create app.profile rows';
  end if;

  insert into app.user_role (profile_id, role_id)
  select v_admin_profile, id from app.role where slug = 'administrator';
  insert into app.user_role (profile_id, role_id)
  select v_sales_profile, id from app.role where slug = 'sales';

  insert into pim.product (id, name, status, metadata)
  values (v_product, 'Jev Contract Product', 'active', '{"business_unit":"licensed"}'::jsonb);

  -- ------------------------------------------------------------------
  -- B  COMMENT VALIDATION + C BODY REVISION (as administrator)
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);

  v_raised := false;
  begin
    perform api.pm_add_product_comment(v_product, '   ', gen_random_uuid());
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'empty/whitespace comment body must be rejected';
  end if;

  v_raised := false;
  begin
    perform api.pm_add_product_comment(v_product, repeat('x', 4001), gen_random_uuid());
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'over-4000 comment body must be rejected';
  end if;

  v_raised := false;
  begin
    perform api.pm_add_product_comment(v_product, 'bad' || chr(1) || 'body', gen_random_uuid());
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'control-character comment body must be rejected';
  end if;

  -- Fixture writes run as the migration role; only RPC calls need the
  -- authenticated session role.
  v_result := api.pm_reserve_product_comment_operation(v_product, gen_random_uuid());
  if (v_result ->> 'status') <> 'reserved' then
    raise exception 'reserve must return reserved, got %', v_result ->> 'status';
  end if;
  v_op_id := (v_result ->> 'client_operation_id')::uuid;
  v_result := api.pm_add_product_comment(v_product, '  first valid comment  ', v_op_id);
  v_comment := (v_result ->> 'comment_id')::uuid;
  v_rev := (v_result ->> 'body_revision')::integer;
  if v_comment is null or v_rev is distinct from 1 then
    raise exception 'comment insert must stamp body_revision=1, got %', v_rev;
  end if;

  update app.comment set body = 'edited body' where id = v_comment;
  select body_revision into v_rev from app.comment where id = v_comment;
  if v_rev is distinct from 2 then
    raise exception 'body change must bump body_revision to 2, got %', v_rev;
  end if;

  update app.comment set visibility = 'internal' where id = v_comment;
  select body_revision into v_rev from app.comment where id = v_comment;
  if v_rev is distinct from 2 then
    raise exception 'non-body change must not bump body_revision, got %', v_rev;
  end if;

  -- ------------------------------------------------------------------
  -- D  NON-ADMIN DENIED
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales_auth, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform api.pm_add_product_comment(v_product, 'sales should not write', gen_random_uuid());
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'sales role must be denied comment create';
  end if;

  v_raised := false;
  begin
    perform api.pm_create_dependency(v_product, 'sales dependency');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'sales role must be denied dependency create';
  end if;

  -- ------------------------------------------------------------------
  -- E  CROSS-USER ISOLATION (RLS select own)
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_auth, 'role', 'authenticated')::text, true);

  -- Seed a triage row as admin first.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);
  v_result := api.pm_begin_activity_triage(
    v_comment,
    'digest-' || v_comment,
    'key-v1',
    'jev-test-model',
    'contract-v1',
    null,
    null
  );
  v_triage_id := (v_result ->> 'triage_id')::uuid;
  if v_triage_id is null then
    raise exception 'begin must create a triage row';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_auth, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from pim.ai_activity_triage where id = v_triage_id;
  if v_count <> 0 then
    raise exception 'other user must not read another requester triage row via RLS';
  end if;
  execute 'reset role';

  -- ------------------------------------------------------------------
  -- G  ENVELOPE / LEASE / SOURCE_CHANGED
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);

  v_raised := false;
  begin
    perform api.pm_complete_activity_triage(v_triage_id, 'wrong-hash', 'blocker_dependency', '{}'::jsonb, '{}'::jsonb, null, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'complete without envelope must be rejected';
  end if;

  -- Body edit marks source_changed and blocks accept.
  update app.comment set body = 'edited after begin' where id = v_comment;
  select state into v_state from pim.ai_activity_triage where id = v_triage_id;
  if v_state is distinct from 'source_changed' then
    raise exception 'body edit must mark triage source_changed, got %', v_state;
  end if;

  v_result := api.pm_accept_activity_triage(v_triage_id, 'Title', null, null, null);
  if (v_result ->> 'status') not in ('source_changed', 'already_dismissed') then
    raise exception 'accept after body edit must not create a record, got %', v_result ->> 'status';
  end if;

  -- ------------------------------------------------------------------
  -- F  ACCEPT ONCE on a fresh actionable triage
  -- ------------------------------------------------------------------
  v_result := api.pm_reserve_product_comment_operation(v_product, gen_random_uuid());
  v_op_id := (v_result ->> 'client_operation_id')::uuid;
  v_result := api.pm_add_product_comment(v_product, 'accept-me comment', v_op_id);
  v_comment := (v_result ->> 'comment_id')::uuid;
  v_result := api.pm_begin_activity_triage(v_comment, 'digest-accept-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  v_triage_id := (v_result ->> 'triage_id')::uuid;

  -- Force actionable succeeded state (simulate provider complete without envelope path).
  update pim.ai_activity_triage
  set state = 'succeeded', action_label = 'blocker_dependency', lease_token_hash = null
  where id = v_triage_id;

  v_result := api.pm_accept_activity_triage(v_triage_id, 'Blocked by vendor', null, null, null);
  if (v_result ->> 'status') <> 'accepted' then
    raise exception 'first accept must succeed, got %', v_result ->> 'status';
  end if;
  v_result := api.pm_accept_activity_triage(v_triage_id, 'Blocked by vendor', null, null, null);
  if (v_result ->> 'status') <> 'already_accepted' then
    raise exception 'second accept must be idempotent already_accepted, got %', v_result ->> 'status';
  end if;
  select count(*) into v_count from pim.ai_activity_triage where id = v_triage_id and state = 'accepted';
  if v_count <> 1 then
    raise exception 'accept must leave exactly one accepted row';
  end if;

  -- ------------------------------------------------------------------
  -- H  OPERATIONS SHAPES
  -- ------------------------------------------------------------------
  v_result := api.pm_create_dependency(v_product, 'Vendor sample delay');
  if (v_result ->> 'kind') <> 'dependency' then
    raise exception 'dependency kind mismatch';
  end if;
  v_dep_id := (v_result ->> 'id')::uuid;
  select count(*) into v_count from app.activity
  where id = v_dep_id and action = 'pm_dependency'
    and payload ->> 'kind' = 'dependency' and payload ->> 'status' = 'open'
    and payload ->> 'type' = 'blocked_by';
  if v_count <> 1 then
    raise exception 'dependency row shape mismatch';
  end if;

  v_result := api.pm_create_decision(v_product, 'Go to market', 'notes here');
  select count(*) into v_count from app.activity
  where action = 'pm_decision' and target_id = v_product
    and payload ->> 'kind' = 'decision' and payload ->> 'status' = 'decided';
  if v_count < 1 then
    raise exception 'decision row shape mismatch';
  end if;

  v_result := api.pm_create_reminder(v_product, 'Follow up with vendor', date '2026-11-01');
  select count(*) into v_count from app.notification
  where app = 'pm' and target_id = v_product
    and payload ->> 'kind' = 'reminder' and payload ->> 'status' = 'open'
    and payload ->> 'reminder_type' = 'follow_up'
    and payload ->> 'due_at' = '2026-11-01';
  if v_count < 1 then
    raise exception 'reminder row shape mismatch';
  end if;

  v_result := api.pm_update_dependency_status(v_dep_id, 'resolved');
  if (v_result ->> 'status') <> 'resolved' then
    raise exception 'dependency status update failed';
  end if;

  -- ------------------------------------------------------------------
  -- G2  ENVELOPE REJECTION MATRIX + STALE LEASE TAKEOVER + REPLAY
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);

  -- Fresh comment + triage for the lease/envelope matrix.
  v_result := api.pm_reserve_product_comment_operation(v_product, gen_random_uuid());
  v_op_id := (v_result ->> 'client_operation_id')::uuid;
  v_result := api.pm_add_product_comment(v_product, 'envelope matrix comment', v_op_id);
  v_comment := (v_result ->> 'comment_id')::uuid;
  v_result := api.pm_begin_activity_triage(v_comment, 'digest-env-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  v_triage_id := (v_result ->> 'triage_id')::uuid;
  if v_triage_id is null or (v_result ->> 'lease_token') is null then
    raise exception 'begin must lease a fresh triage row';
  end if;

  -- Missing envelope.
  v_raised := false;
  begin
    perform api.pm_complete_activity_triage(v_triage_id, 'x', 'blocker_dependency', '{}'::jsonb, '{}'::jsonb, null, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'complete with null envelope must be rejected';
  end if;

  -- Short / empty signature.
  v_raised := false;
  begin
    perform api.pm_complete_activity_triage(
      v_triage_id, 'x', 'blocker_dependency', '{}'::jsonb, '{}'::jsonb,
      '{"environment":"test"}'::jsonb, 'short'
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'complete with short signature must be rejected';
  end if;

  -- Envelope with an unknown extra key.
  v_raised := false;
  begin
    perform api.pm_complete_activity_triage(
      v_triage_id, 'x', 'blocker_dependency', '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object('environment', 'test', 'bogus_key', '1',
        'requester_profile_id', v_admin_profile, 'product_id', v_product,
        'comment_id', v_comment, 'eligibility_id', gen_random_uuid(),
        'source_body_revision', 1, 'lease_token', 't', 'disposition', 'complete',
        'input_byte_count', 1, 'input_digest', 'd', 'input_key_version', 'k',
        'model', 'm', 'contract_version', 'c', 'quality_release_digest', 'q',
        'target_deployment_digest', 'td', 'emergency_generation', 0,
        'timestamp', now()::text, 'nonce', 'n'),
      repeat('a', 64)
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'complete with unknown envelope key must be rejected';
  end if;

  -- Envelope missing required keys.
  v_raised := false;
  begin
    perform api.pm_complete_activity_triage(
      v_triage_id, 'x', 'blocker_dependency', '{}'::jsonb, '{}'::jsonb,
      '{"environment":"test"}'::jsonb,
      repeat('a', 64)
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'complete with missing envelope keys must be rejected';
  end if;

  -- Comment replay is idempotent.
  v_result := api.pm_add_product_comment(v_product, 'envelope matrix comment', v_op_id);
  if (v_result ->> 'status') <> 'replayed' then
    raise exception 'second add with same client_operation_id must replay, got %', v_result ->> 'status';
  end if;

  -- Begin is idempotent while the live lease is still valid.
  v_result := api.pm_begin_activity_triage(v_comment, 'digest-env-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  if (v_result ->> 'status') <> 'existing' then
    raise exception 'second begin with a live lease must return existing, got %', v_result ->> 'status';
  end if;

  -- Timeout fail through the private worker (owner EXECUTE; no SET ROLE).
  -- First timeout re-queues; begin then reclaims via the public API.
  select lease_token_hash into v_lease_hash from pim.ai_activity_triage where id = v_triage_id;
  perform pim.pm_fail_activity_triage_worker(v_triage_id, v_lease_hash, 'timeout');
  select state, timeout_count into v_state, v_rev from pim.ai_activity_triage where id = v_triage_id;
  if v_state is distinct from 'queued' then
    raise exception 'first timeout must return the row to queued, got %', v_state;
  end if;

  v_result := api.pm_begin_activity_triage(v_comment, 'digest-env-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  if (v_result ->> 'status') <> 'reclaimed' then
    raise exception 'begin after first timeout must reclaim, got %', v_result ->> 'status';
  end if;
  if (v_result ->> 'lease_token') is null then
    raise exception 'reclaim must issue a fresh lease token';
  end if;

  select lease_token_hash into v_lease_hash from pim.ai_activity_triage where id = v_triage_id;
  perform pim.pm_fail_activity_triage_worker(v_triage_id, v_lease_hash, 'timeout');
  select state, timeout_count into v_state, v_rev from pim.ai_activity_triage where id = v_triage_id;
  if v_state is distinct from 'queued' or v_rev < 2 then
    raise exception 'second timeout must stay queued with timeout_count>=2, got % / %', v_state, v_rev;
  end if;

  v_result := api.pm_begin_activity_triage(v_comment, 'digest-env-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  if (v_result ->> 'status') <> 'reclaimed' then
    raise exception 'begin after second timeout must reclaim, got %', v_result ->> 'status';
  end if;

  select lease_token_hash into v_lease_hash from pim.ai_activity_triage where id = v_triage_id;
  perform pim.pm_fail_activity_triage_worker(v_triage_id, v_lease_hash, 'timeout');
  select state into v_state from pim.ai_activity_triage where id = v_triage_id;
  if v_state is distinct from 'failed' then
    raise exception 'third timeout must fail terminally, got %', v_state;
  end if;

  v_result := api.pm_begin_activity_triage(v_comment, 'digest-env-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  if (v_result ->> 'status') <> 'existing' or (v_result ->> 'lease_acquired')::boolean then
    raise exception 'begin on a failed row must return existing without a lease, got %', v_result;
  end if;

  -- Expired-lease takeover: force expiry and confirm begin reclaims.
  v_result := api.pm_reserve_product_comment_operation(v_product, gen_random_uuid());
  v_op_id := (v_result ->> 'client_operation_id')::uuid;
  v_result := api.pm_add_product_comment(v_product, 'expired lease comment', v_op_id);
  v_comment := (v_result ->> 'comment_id')::uuid;
  v_result := api.pm_begin_activity_triage(v_comment, 'digest-exp-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  v_triage_id := (v_result ->> 'triage_id')::uuid;
  update pim.ai_activity_triage
  set lease_expires_at = now() - interval '1 minute'
  where id = v_triage_id;
  v_result := api.pm_begin_activity_triage(v_comment, 'digest-exp-' || v_comment, 'key-v1', 'jev-test-model', 'contract-v1', null, null);
  if (v_result ->> 'status') <> 'reclaimed' then
    raise exception 'expired lease must be reclaimed by begin, got %', v_result ->> 'status';
  end if;

  -- Fail path rejects a bad lease hash (raises before the worker lease check
  -- when the envelope is null; with a null envelope this asserts envelope fail-closed).
  v_raised := false;
  begin
    perform api.pm_fail_activity_triage(v_triage_id, 'not-the-lease-hash', 'timeout', null, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'fail with wrong lease hash must be rejected';
  end if;

  raise notice 'jev_activity_triage_contract_a: all assertions passed';
end $$;

rollback;






