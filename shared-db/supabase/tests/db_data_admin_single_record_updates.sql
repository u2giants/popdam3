-- Preview/disposable verification for DB Data Admin Step 8 single-record update
-- contracts (migration 20260722170000_db_data_admin_single_record_updates.sql).
-- All fixture changes roll back. Run only after the migration is applied.
--
-- Proves:
--   * exact function signatures, EXECUTE grants, SECURITY DEFINER, pinned
--     search_path, and helper privacy;
--   * feature-gate storage boundaries (RLS, no policies, no browser grants) and
--     writes_disabled behavior for display/status/channel/vendor writes;
--   * the authorization matrix, including denial of an administrator WITHOUT an
--     explicit `admin` grant, and that denied calls write no audit row;
--   * display_name success/clear, global status with reason + reactivation,
--     per-app crm/pm/dam status with reason/actor/time and reactivation clearing
--     the reason (app enum 'pm' maps to physical pim schema);
--   * Customer Channel validation and replacement semantics;
--   * stale_token without mutation, idempotent replay without re-apply,
--     no_changes without token bump, not_found, validation failures including PLM;
--   * immutable success/failure audit rows and the actor_label audit read with
--     cursor pagination.
--
-- Environment independence: the suite normalizes the gate row inside this
-- transaction (rolled back), because Codex may have operationally enabled the
-- preview gate before this suite runs. The migration seeds enabled=false.
begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_role_id uuid;
  v_admin_profile uuid;
  v_admin_auth uuid;
  v_no_grant_profile uuid;
  v_no_grant_auth uuid;
  v_non_admin_profile uuid;
  v_non_admin_auth uuid;
  v_sig text;
  v_cust_a uuid;
  v_cust_b uuid;
  v_cust_c uuid;
  v_cust_d uuid;
  v_cust_e uuid;
  v_vend_a uuid;
  v_vend_b uuid;
  v_chan_a uuid;
  v_chan_b uuid;
  v_chan_off uuid;
  v_op uuid;
  v_token timestamptz;
  v_token2 timestamptz;
  v_result jsonb;
  v_result2 jsonb;
  v_row jsonb;
  v_audit app.db_data_admin_audit_event%rowtype;
  v_count integer;
  v_expected_label text;
  v_cursor text;
  v_definer boolean;
  v_config text[];
begin
  -- ------------------------------------------------------------------
  -- Static object, privilege, definer, and search_path assertions.
  -- ------------------------------------------------------------------
  foreach v_sig in array array[
    'api.db_data_admin_update_customer(uuid,timestamptz,uuid,text,text,text,text,text,uuid[])',
    'api.db_data_admin_update_vendor(uuid,timestamptz,uuid,text,text,text,text,text)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'missing protected function: %', v_sig;
    end if;
    if has_function_privilege('public', v_sig::regprocedure, 'execute') then
      raise exception 'public can execute %', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'authenticated cannot execute %', v_sig;
    end if;
    select p.prosecdef, p.proconfig into v_definer, v_config
    from pg_proc p
    where p.oid = v_sig::regprocedure;
    if not v_definer then
      raise exception '% must be security definer', v_sig;
    end if;
    if not ('search_path=app, public' = any(coalesce(v_config, array[]::text[]))) then
      raise exception '% must pin search_path=app, public', v_sig;
    end if;
  end loop;

  -- Private helpers exist and are not executable by public or authenticated.
  foreach v_sig in array array[
    'app.db_data_admin_single_record_writes_enabled()',
    'app.db_data_admin_customer_row(uuid)',
    'app.db_data_admin_vendor_row(uuid)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'missing private helper: %', v_sig;
    end if;
    if has_function_privilege('public', v_sig::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'helper % must stay private', v_sig;
    end if;
  end loop;

  -- Audit read keeps its exact Step 6 signature and grants.
  if to_regprocedure('api.db_data_admin_audit_list(text,uuid,text,uuid,timestamptz,timestamptz,text,integer)') is null then
    raise exception 'audit read signature changed';
  end if;
  if has_function_privilege('public', 'api.db_data_admin_audit_list(text,uuid,text,uuid,timestamptz,timestamptz,text,integer)'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'api.db_data_admin_audit_list(text,uuid,text,uuid,timestamptz,timestamptz,text,integer)'::regprocedure, 'execute') then
    raise exception 'audit read execute grants are incorrect';
  end if;

  -- Feature gate storage boundaries: RLS on, zero policies, no browser grants,
  -- seed row present (migration seeds enabled=false; the live value may have
  -- been operationally changed and is normalized below, transaction-scoped).
  if to_regclass('app.db_data_admin_feature_gate') is null then
    raise exception 'feature gate table is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'app.db_data_admin_feature_gate'::regclass) then
    raise exception 'RLS is not enabled on the feature gate table';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'app.db_data_admin_feature_gate'::regclass) then
    raise exception 'feature gate must not expose direct RLS policies';
  end if;
  if has_table_privilege('authenticated', 'app.db_data_admin_feature_gate', 'select')
     or has_table_privilege('authenticated', 'app.db_data_admin_feature_gate', 'insert')
     or has_table_privilege('authenticated', 'app.db_data_admin_feature_gate', 'update')
     or has_table_privilege('authenticated', 'app.db_data_admin_feature_gate', 'delete') then
    raise exception 'authenticated received a direct feature gate grant';
  end if;
  if not exists (
    select 1 from app.db_data_admin_feature_gate where feature = 'single_record_write'
  ) then
    raise exception 'single_record_write gate seed row is missing';
  end if;

  -- ------------------------------------------------------------------
  -- Fixture identities (reuse preview profiles; all role/access changes
  -- are transaction-scoped and restored by the rollback).
  -- ------------------------------------------------------------------
  select p.id, p.auth_user_id into v_admin_profile, v_admin_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_no_grant_profile, v_no_grant_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  select p.id, p.auth_user_id into v_non_admin_profile, v_non_admin_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 2;

  if v_non_admin_profile is null then
    raise exception 'fixture requires three active authenticated profiles';
  end if;

  select r.id into v_role_id from app.role r where r.slug = 'administrator'::app.app_role;
  if v_role_id is null then
    raise exception 'fixture requires the administrator role';
  end if;

  delete from app.user_role
  where profile_id in (v_admin_profile, v_no_grant_profile, v_non_admin_profile)
    and role_id = v_role_id;
  delete from app.app_access
  where profile_id in (v_admin_profile, v_no_grant_profile, v_non_admin_profile)
    and app = 'admin';

  insert into app.user_role (profile_id, role_id) values
    (v_admin_profile, v_role_id),
    (v_no_grant_profile, v_role_id);
  insert into app.app_access (profile_id, app) values
    (v_admin_profile, 'admin'),
    (v_non_admin_profile, 'admin');

  select coalesce(p.display_name, p.email::text) into v_expected_label
  from app.profile p where p.id = v_admin_profile;

  -- Fixture entities.
  insert into core.customer (name, display_name, status)
  values ('Step8 Alpha ' || v_suffix, 'Alpha Display ' || v_suffix, 'active')
  returning id into v_cust_a;
  insert into core.customer (name, status)
  values ('Step8 Bravo ' || v_suffix, 'active')
  returning id into v_cust_b;
  insert into core.customer (name, status)
  values ('Step8 Charlie ' || v_suffix, 'active')
  returning id into v_cust_c;
  insert into core.customer (name, status)
  values ('Step8 Delta ' || v_suffix, 'active')
  returning id into v_cust_d;
  insert into core.customer (name, display_name, status)
  values ('Step8 Echo ' || v_suffix, 'Echo Display ' || v_suffix, 'active')
  returning id into v_cust_e;
  insert into core.factory (name, display_name, code, status)
  values ('Step8 Vendor A ' || v_suffix, 'Vendor A Display ' || v_suffix,
          'S8A-' || v_suffix, 'active')
  returning id into v_vend_a;
  insert into core.factory (name, code, status)
  values ('Step8 Vendor B ' || v_suffix, 'S8B-' || v_suffix, 'active')
  returning id into v_vend_b;

  insert into core.channel (code, name, status, sort_order)
  values ('S8A-' || v_suffix, 'Step8 Channel A ' || v_suffix, 'active', 991)
  returning id into v_chan_a;
  insert into core.channel (code, name, status, sort_order)
  values ('S8B-' || v_suffix, 'Step8 Channel B ' || v_suffix, 'active', 992)
  returning id into v_chan_b;
  insert into core.channel (code, name, status, sort_order)
  values ('S8X-' || v_suffix, 'Step8 Channel Off ' || v_suffix, 'inactive', 993)
  returning id into v_chan_off;

  -- Normalize the gate to disabled (transaction-scoped) for deterministic
  -- writes_disabled assertions regardless of operational preview state.
  update app.db_data_admin_feature_gate
  set enabled = false
  where feature = 'single_record_write';

  -- ------------------------------------------------------------------
  -- Authorization matrix (gate still disabled: an authorized call reaches
  -- the gate and returns writes_disabled instead of raising).
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  select c.updated_at into v_token from core.customer c where c.id = v_cust_a;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'authorization probe', p_display_name => 'Allowed'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not false
     or v_result ->> 'code' <> 'writes_disabled' then
    raise exception 'authorized administrator did not reach the gate';
  end if;

  -- Administrator WITHOUT an explicit grant: denied, and no audit row is written.
  perform set_config('request.jwt.claim.sub', v_no_grant_auth::text, true);
  v_op := gen_random_uuid();
  begin
    perform api.db_data_admin_update_customer(
      v_cust_a, v_token, v_op, 'denied attempt', p_display_name => 'Nope'
    );
    raise exception 'administrator without explicit grant was allowed on update_customer';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform api.db_data_admin_update_vendor(
      v_vend_a, v_token, v_op, 'denied attempt', p_display_name => 'Nope'
    );
    raise exception 'administrator without explicit grant was allowed on update_vendor';
  exception
    when insufficient_privilege then null;
  end;
  if exists (
    select 1 from app.db_data_admin_audit_event e where e.operation_id = v_op
  ) then
    raise exception 'a denied call wrote an audit row';
  end if;

  -- Non-administrator WITH an explicit grant: denied on both RPCs.
  perform set_config('request.jwt.claim.sub', v_non_admin_auth::text, true);
  begin
    perform api.db_data_admin_update_customer(
      v_cust_a, v_token, gen_random_uuid(), 'denied attempt', p_display_name => 'Nope'
    );
    raise exception 'non-administrator with explicit grant was allowed on update_customer';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform api.db_data_admin_update_vendor(
      v_vend_a, v_token, gen_random_uuid(), 'denied attempt', p_display_name => 'Nope'
    );
    raise exception 'non-administrator with explicit grant was allowed on update_vendor';
  exception
    when insufficient_privilege then null;
  end;

  -- Revoked grant: denied; un-revoked: allowed again.
  update app.app_access set revoked_at = now()
  where profile_id = v_admin_profile and app = 'admin';
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  begin
    perform api.db_data_admin_update_customer(
      v_cust_a, v_token, gen_random_uuid(), 'denied attempt', p_display_name => 'Nope'
    );
    raise exception 'revoked admin grant was accepted';
  exception
    when insufficient_privilege then null;
  end;
  update app.app_access set revoked_at = null
  where profile_id = v_admin_profile and app = 'admin';

  -- ------------------------------------------------------------------
  -- Gate disabled: every Step 8 write type returns writes_disabled, commits
  -- a failure audit row, and mutates nothing.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'gated display edit', p_display_name => 'Gated'
  ) into v_result;
  if v_result ->> 'code' <> 'writes_disabled' then
    raise exception 'display edit was not gated';
  end if;
  if not exists (
    select 1 from app.db_data_admin_audit_event e
    where e.operation_id = v_op and e.succeeded = false and e.error_code = 'writes_disabled'
  ) then
    raise exception 'gated display edit did not commit a failure audit row';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'gated status edit', p_status => 'inactive'
  ) into v_result;
  if v_result ->> 'code' <> 'writes_disabled' then
    raise exception 'status edit was not gated';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'gated channel edit', p_channel_ids => array[v_chan_a]
  ) into v_result;
  if v_result ->> 'code' <> 'writes_disabled' then
    raise exception 'channel edit was not gated';
  end if;

  select f.updated_at into v_token2 from core.factory f where f.id = v_vend_a;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_a, v_token2, v_op, 'gated vendor edit', p_display_name => 'Gated'
  ) into v_result;
  if v_result ->> 'code' <> 'writes_disabled' then
    raise exception 'vendor edit was not gated';
  end if;

  if (select display_name from core.customer where id = v_cust_a) is distinct from 'Alpha Display ' || v_suffix
     or (select status::text from core.customer where id = v_cust_a) <> 'active'
     or exists (select 1 from core.customer_channel where customer_id = v_cust_a)
     or (select display_name from core.factory where id = v_vend_a) is distinct from 'Vendor A Display ' || v_suffix then
    raise exception 'a gated write mutated state';
  end if;

  -- Enable the gate (transaction-scoped; production keeps the disabled seed).
  update app.db_data_admin_feature_gate
  set enabled = true
  where feature = 'single_record_write';

  -- ------------------------------------------------------------------
  -- Validation failures: structured result plus committed failure audit row
  -- whenever entity and operation are identifiable.
  -- ------------------------------------------------------------------

  -- Null customer id: no entity, so no audit row is possible.
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    null, v_token, v_op, 'no entity', p_display_name => 'X'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not false
     or v_result ->> 'code' <> 'validation_failed'
     or v_result ->> 'audit_id' is not null then
    raise exception 'null customer id did not fail validation without an audit row';
  end if;
  if exists (select 1 from app.db_data_admin_audit_event e where e.operation_id = v_op) then
    raise exception 'an unidentifiable failure wrote an audit row';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, '   ', p_display_name => 'X'
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed'
     or not exists (
       select 1 from app.db_data_admin_audit_event e
       where e.operation_id = v_op and e.succeeded = false and e.error_code = 'validation_failed'
     ) then
    raise exception 'blank reason did not fail validation with a failure audit row';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'bad status', p_status => 'archived'
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'archived status was accepted';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'plm attempt', p_app => 'plm', p_app_status => 'inactive'
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'plm app write was accepted';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'orphan app status', p_app_status => 'inactive'
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'app status without app was accepted';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'missing app status', p_app => 'crm'
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'app without app status was accepted';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'bad app status', p_app => 'crm', p_app_status => 'potential'
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'non-binary app status was accepted';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'unknown channel', p_channel_ids => array[gen_random_uuid()]
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'unknown channel id was accepted';
  end if;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'inactive channel', p_channel_ids => array[v_chan_off]
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'inactive channel id was accepted';
  end if;

  -- ------------------------------------------------------------------
  -- Customer display_name: success, audit completeness, returned token, and
  -- blank-clears-to-NULL.
  -- ------------------------------------------------------------------
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'Curated rename', p_display_name => ' Alpha Renamed ' || v_suffix || ' '
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (v_result ->> 'idempotent_replay')::boolean is not false
     or v_result -> 'row' ->> 'display_name' <> 'Alpha Renamed ' || v_suffix then
    raise exception 'display_name update did not succeed with a trimmed value';
  end if;
  if (v_result -> 'row' ->> 'updated_at')::timestamptz is distinct from
     (select updated_at from core.customer where id = v_cust_a) then
    raise exception 'display_name result did not return the persisted updated_at token';
  end if;
  if not (v_result -> 'row' ? 'crm_status')
     or not (v_result -> 'row' ? 'crm_status_changed_at')
     or not (v_result -> 'row' ? 'channels')
     or not (v_result -> 'row' ? 'status') then
    raise exception 'update result row is missing approved keys';
  end if;
  if (select display_name from core.customer where id = v_cust_a) <> 'Alpha Renamed ' || v_suffix then
    raise exception 'display_name was not persisted';
  end if;

  select * into v_audit from app.db_data_admin_audit_event e where e.operation_id = v_op;
  if v_audit.entity_type <> 'customer'
     or v_audit.entity_id <> v_cust_a
     or v_audit.action <> 'update'
     or v_audit.operation_item_key <> 'primary'
     or not v_audit.succeeded
     or v_audit.reason <> 'Curated rename'
     or v_audit.actor_profile_id is distinct from v_admin_profile
     or v_audit.old_snapshot ->> 'display_name' <> 'Alpha Display ' || v_suffix
     or v_audit.new_snapshot ->> 'display_name' <> 'Alpha Renamed ' || v_suffix then
    raise exception 'success audit row is incomplete or incorrect';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  if v_audit.actor_user_id is distinct from v_admin_auth then
    raise exception 'audit actor_user_id does not match the JWT subject';
  end if;

  -- Blank input clears display_name to NULL (serving falls back to name).
  select c.updated_at into v_token from core.customer c where c.id = v_cust_a;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'Clear curated name', p_display_name => '   '
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select display_name from core.customer where id = v_cust_a) is not null then
    raise exception 'blank display_name did not clear to NULL';
  end if;

  -- ------------------------------------------------------------------
  -- Customer global status: reason required by validation above; inactivation,
  -- reactivation, and potential are ordinary edits.
  -- ------------------------------------------------------------------
  select c.updated_at into v_token from core.customer c where c.id = v_cust_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_b, v_token, v_op, 'Dormant account', p_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select status::text from core.customer where id = v_cust_b) <> 'inactive' then
    raise exception 'global inactivation failed';
  end if;
  select * into v_audit from app.db_data_admin_audit_event e where e.operation_id = v_op;
  if v_audit.old_snapshot ->> 'status' <> 'active'
     or v_audit.new_snapshot ->> 'status' <> 'inactive' then
    raise exception 'global status audit snapshots are incorrect';
  end if;

  select c.updated_at into v_token from core.customer c where c.id = v_cust_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_b, v_token, v_op, 'Customer returned', p_status => 'active'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select status::text from core.customer where id = v_cust_b) <> 'active' then
    raise exception 'global reactivation failed';
  end if;

  select c.updated_at into v_token from core.customer c where c.id = v_cust_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_b, v_token, v_op, 'Mark as potential', p_status => 'potential'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select status::text from core.customer where id = v_cust_b) <> 'potential' then
    raise exception 'potential status was not accepted';
  end if;

  -- ------------------------------------------------------------------
  -- Per-app status: reason/actor/time typed columns; reactivation clears the
  -- reason. App enum 'pm' must land in the physical pim schema.
  -- ------------------------------------------------------------------
  select c.updated_at into v_token from core.customer c where c.id = v_cust_c;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_c, v_token, v_op, 'CRM opt-out', p_app => 'crm', p_app_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true then
    raise exception 'crm inactivation failed';
  end if;
  if not exists (
    select 1 from crm.customer_ext x
    where x.customer_id = v_cust_c
      and x.status = 'inactive'
      and x.status_reason = 'CRM opt-out'
      and x.status_changed_at is not null
      and x.status_changed_by = v_admin_profile
  ) then
    raise exception 'crm.customer_ext did not store status/reason/actor/time';
  end if;
  if v_result -> 'row' ->> 'crm_status' <> 'inactive'
     or v_result -> 'row' ->> 'crm_status_changed_at' is null then
    raise exception 'result row does not carry crm status evidence';
  end if;
  if exists (select 1 from pim.customer_ext where customer_id = v_cust_c)
     or exists (select 1 from dam.customer_ext where customer_id = v_cust_c) then
    raise exception 'an unselected app extension row was written';
  end if;

  -- Reactivation: reason cleared, actor/time refreshed, audit retains history.
  select c.updated_at into v_token from core.customer c where c.id = v_cust_c;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_c, v_token, v_op, 'CRM re-enabled', p_app => 'crm', p_app_status => 'active'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or not exists (
       select 1 from crm.customer_ext x
       where x.customer_id = v_cust_c
         and x.status = 'active'
         and x.status_reason is null
         and x.status_changed_at is not null
         and x.status_changed_by = v_admin_profile
     ) then
    raise exception 'crm reactivation did not clear the reason';
  end if;
  select * into v_audit from app.db_data_admin_audit_event e where e.operation_id = v_op;
  if v_audit.old_snapshot ->> 'crm_status_reason' <> 'CRM opt-out'
     or v_audit.new_snapshot ->> 'crm_status' <> 'active'
     or v_audit.new_snapshot ->> 'crm_status_reason' is not null then
    raise exception 'reactivation audit snapshots do not retain the former reason';
  end if;

  -- 'pm' enum value must write the physical pim.customer_ext table.
  select c.updated_at into v_token from core.customer c where c.id = v_cust_c;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_c, v_token, v_op, 'PM opt-out', p_app => 'pm', p_app_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or not exists (
       select 1 from pim.customer_ext x
       where x.customer_id = v_cust_c and x.status = 'inactive'
         and x.status_reason = 'PM opt-out' and x.status_changed_by = v_admin_profile
     ) then
    raise exception 'p_app=pm did not write pim.customer_ext';
  end if;

  select c.updated_at into v_token from core.customer c where c.id = v_cust_c;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_c, v_token, v_op, 'DAM opt-out', p_app => 'dam', p_app_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or not exists (
       select 1 from dam.customer_ext x
       where x.customer_id = v_cust_c and x.status = 'inactive'
         and x.status_reason = 'DAM opt-out' and x.status_changed_by = v_admin_profile
     ) then
    raise exception 'p_app=dam did not write dam.customer_ext';
  end if;

  -- ------------------------------------------------------------------
  -- Customer Channels: replacement semantics and assigned_by evidence.
  -- ------------------------------------------------------------------
  select c.updated_at into v_token from core.customer c where c.id = v_cust_d;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_d, v_token, v_op, 'Assign channels', p_channel_ids => array[v_chan_a, v_chan_b]
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select count(*) from core.customer_channel where customer_id = v_cust_d) <> 2
     or not exists (
       select 1 from core.customer_channel cc
       where cc.customer_id = v_cust_d and cc.channel_id = v_chan_a
         and cc.assigned_by = v_admin_profile
     ) then
    raise exception 'channel assignment failed';
  end if;
  select * into v_audit from app.db_data_admin_audit_event e where e.operation_id = v_op;
  if jsonb_array_length(v_audit.new_snapshot -> 'channels') <> 2
     or jsonb_array_length(v_audit.old_snapshot -> 'channels') <> 0 then
    raise exception 'channel audit snapshots are incorrect';
  end if;

  select c.updated_at into v_token from core.customer c where c.id = v_cust_d;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_d, v_token, v_op, 'Narrow channels', p_channel_ids => array[v_chan_b]
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select count(*) from core.customer_channel where customer_id = v_cust_d) <> 1
     or not exists (
       select 1 from core.customer_channel cc
       where cc.customer_id = v_cust_d and cc.channel_id = v_chan_b
     ) then
    raise exception 'channel replacement did not narrow to one channel';
  end if;

  select c.updated_at into v_token from core.customer c where c.id = v_cust_d;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_d, v_token, v_op, 'Clear channels', p_channel_ids => array[]::uuid[]
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or exists (select 1 from core.customer_channel where customer_id = v_cust_d) then
    raise exception 'channel clearing failed';
  end if;

  -- ------------------------------------------------------------------
  -- no_changes: structured failure, failure audit row, and NO token bump.
  -- ------------------------------------------------------------------
  select c.updated_at into v_token from core.customer c where c.id = v_cust_e;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_e, v_token, v_op, 'Nothing to do'
  ) into v_result;
  if v_result ->> 'code' <> 'no_changes'
     or not exists (
       select 1 from app.db_data_admin_audit_event e
       where e.operation_id = v_op and e.succeeded = false and e.error_code = 'no_changes'
     ) then
    raise exception 'empty change set did not return no_changes with an audit row';
  end if;
  if (select updated_at from core.customer where id = v_cust_e) <> v_token then
    raise exception 'no_changes bumped the concurrency token';
  end if;

  -- Same-value edit is also a no-op.
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_e, v_token, v_op, 'Same name', p_display_name => 'Echo Display ' || v_suffix
  ) into v_result;
  if v_result ->> 'code' <> 'no_changes' then
    raise exception 'same-value display edit was not recognized as a no-op';
  end if;

  -- ------------------------------------------------------------------
  -- stale_token: no mutation, fresh row in `current`, failure audit row.
  -- ------------------------------------------------------------------
  select c.updated_at into v_token2 from core.customer c where c.id = v_cust_e;

  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_e, v_token2 - interval '1 second', v_op, 'Conflicting rename', p_display_name => 'Echo Second ' || v_suffix
  ) into v_result;
  if (v_result ->> 'success')::boolean is not false
     or v_result ->> 'code' <> 'stale_token'
     or (v_result -> 'current' ->> 'updated_at')::timestamptz <> v_token2 then
    raise exception 'stale token was not detected with the fresh row in current';
  end if;
  if (select display_name from core.customer where id = v_cust_e) <> 'Echo Display ' || v_suffix then
    raise exception 'a stale-token write mutated state';
  end if;
  if not exists (
    select 1 from app.db_data_admin_audit_event e
    where e.operation_id = v_op and e.succeeded = false and e.error_code = 'stale_token'
  ) then
    raise exception 'stale_token did not commit a failure audit row';
  end if;

  -- ------------------------------------------------------------------
  -- Idempotent replay: same operation id returns the recorded outcome,
  -- writes no second audit row, and never re-applies.
  -- ------------------------------------------------------------------
  select c.updated_at into v_token from core.customer c where c.id = v_cust_e;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    v_cust_e, v_token, v_op, 'Idempotent rename', p_display_name => 'Echo Idem ' || v_suffix
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true then
    raise exception 'idempotency setup edit failed';
  end if;

  -- Change the underlying value directly; a replay must not restore the old edit.
  update core.customer set display_name = 'Echo Tampered ' || v_suffix where id = v_cust_e;

  select api.db_data_admin_update_customer(
    v_cust_e, v_token, v_op, 'Idempotent rename', p_display_name => 'Echo Idem ' || v_suffix
  ) into v_result2;
  if (v_result2 ->> 'success')::boolean is not true
     or (v_result2 ->> 'idempotent_replay')::boolean is not true
     or (v_result2 ->> 'audit_id')::uuid is distinct from (v_result ->> 'audit_id')::uuid
     or v_result2 -> 'row' ->> 'display_name' <> 'Echo Tampered ' || v_suffix then
    raise exception 'idempotent replay did not return the recorded outcome without re-apply';
  end if;
  select count(*) into v_count from app.db_data_admin_audit_event e
  where e.operation_id = v_op;
  if v_count <> 1 then
    raise exception 'idempotent replay wrote a second audit row';
  end if;

  -- Operation id reused against a DIFFERENT entity resolves to the original
  -- operation without mutating the second entity or writing another audit row.
  select api.db_data_admin_update_customer(
    v_cust_a, v_token, v_op, 'Mismatched retry', p_display_name => 'Should Not Apply'
  ) into v_result2;
  if (v_result2 ->> 'idempotent_replay')::boolean is not true
     or (v_result2 -> 'row' ->> 'id')::uuid is distinct from v_cust_e then
    raise exception 'cross-entity operation id reuse was not resolved safely';
  end if;
  if (select display_name from core.customer where id = v_cust_a) is not null then
    raise exception 'cross-entity operation id reuse mutated the wrong record';
  end if;
  if exists (
    select 1 from app.db_data_admin_audit_event e
    where e.operation_id = v_op and e.entity_id <> v_cust_e
  ) then
    raise exception 'cross-entity operation id reuse wrote an audit row for the wrong entity';
  end if;

  -- ------------------------------------------------------------------
  -- not_found: structured failure with a committed failure audit row.
  -- ------------------------------------------------------------------
  v_op := gen_random_uuid();
  select api.db_data_admin_update_customer(
    gen_random_uuid(), v_token, v_op, 'Ghost edit', p_display_name => 'Ghost'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not false
     or v_result ->> 'code' <> 'not_found'
     or not exists (
       select 1 from app.db_data_admin_audit_event e
       where e.operation_id = v_op and e.succeeded = false and e.error_code = 'not_found'
     ) then
    raise exception 'unknown customer did not return not_found with an audit row';
  end if;

  -- ------------------------------------------------------------------
  -- Audit ledger immutability still holds for Step 8 rows.
  -- ------------------------------------------------------------------
  select e.* into v_audit from app.db_data_admin_audit_event e
  where e.entity_id = v_cust_e and e.succeeded
  order by e.occurred_at desc limit 1;
  begin
    update app.db_data_admin_audit_event set reason = 'tamper' where id = v_audit.id;
    raise exception 'audit update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
  begin
    delete from app.db_data_admin_audit_event where id = v_audit.id;
    raise exception 'audit delete unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  -- ------------------------------------------------------------------
  -- Audit read: actor_label, newest-first, failure visibility, cursor paging.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  select api.db_data_admin_audit_list('customer', v_cust_e, null, null, null, null, null, 1)
  into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1
     or v_result ->> 'next_cursor' is null then
    raise exception 'audit list did not page with a cursor';
  end if;
  v_row := v_result -> 'rows' -> 0;
  if v_row ->> 'actor_label' is distinct from v_expected_label then
    raise exception 'audit list actor_label is incorrect';
  end if;
  v_cursor := v_result ->> 'next_cursor';
  select api.db_data_admin_audit_list('customer', v_cust_e, null, null, null, null, v_cursor, 1)
  into v_result2;
  if jsonb_array_length(v_result2 -> 'rows') <> 1
     or (v_result2 -> 'rows' -> 0 ->> 'id')::uuid = (v_row ->> 'id')::uuid then
    raise exception 'audit list cursor did not advance to a distinct row';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(
      api.db_data_admin_audit_list('customer', v_cust_e, null, null, null, null, null, 200) -> 'rows'
    ) r
    where r ->> 'succeeded' = 'false' and r ->> 'error_code' = 'stale_token'
  ) then
    raise exception 'audit list must surface failure events with their error code';
  end if;

  -- Administrator without a grant is still denied on the extended audit read.
  perform set_config('request.jwt.claim.sub', v_no_grant_auth::text, true);
  begin
    perform api.db_data_admin_audit_list('customer', v_cust_e);
    raise exception 'administrator without grant reached the audit read';
  exception
    when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  -- ------------------------------------------------------------------
  -- Vendor parity: display_name, global status, per-app crm/pm/dam,
  -- reactivation, stale token, not_found, and vendor audit rows.
  -- ------------------------------------------------------------------
  select f.updated_at into v_token from core.factory f where f.id = v_vend_a;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_a, v_token, v_op, 'Vendor rename', p_display_name => 'Vendor Renamed ' || v_suffix
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select display_name from core.factory where id = v_vend_a) <> 'Vendor Renamed ' || v_suffix
     or not (v_result -> 'row' ? 'code')
     or v_result -> 'row' ->> 'plm_status' is not null then
    raise exception 'vendor display_name update failed or row shape is wrong';
  end if;
  select * into v_audit from app.db_data_admin_audit_event e where e.operation_id = v_op;
  if v_audit.entity_type <> 'vendor' or v_audit.entity_id <> v_vend_a or not v_audit.succeeded then
    raise exception 'vendor audit row is incorrect';
  end if;

  select f.updated_at into v_token from core.factory f where f.id = v_vend_a;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_a, v_token, v_op, 'Vendor dormant', p_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or (select status::text from core.factory where id = v_vend_a) <> 'inactive' then
    raise exception 'vendor global inactivation failed';
  end if;

  -- Per-app vendor status across all three apps, then a DAM reactivation.
  select f.updated_at into v_token from core.factory f where f.id = v_vend_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_b, v_token, v_op, 'Vendor CRM opt-out', p_app => 'crm', p_app_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true then
    raise exception 'vendor crm inactivation failed';
  end if;
  select f.updated_at into v_token from core.factory f where f.id = v_vend_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_b, v_token, v_op, 'Vendor PM opt-out', p_app => 'pm', p_app_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true then
    raise exception 'vendor pm inactivation failed';
  end if;
  select f.updated_at into v_token from core.factory f where f.id = v_vend_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_b, v_token, v_op, 'Vendor DAM opt-out', p_app => 'dam', p_app_status => 'inactive'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true then
    raise exception 'vendor dam inactivation failed';
  end if;
  if not exists (select 1 from crm.factory_ext x where x.factory_id = v_vend_b and x.status = 'inactive')
     or not exists (select 1 from pim.factory_ext x where x.factory_id = v_vend_b and x.status = 'inactive')
     or not exists (select 1 from dam.factory_ext x where x.factory_id = v_vend_b and x.status = 'inactive') then
    raise exception 'vendor per-app extensions were not all written';
  end if;

  select f.updated_at into v_token from core.factory f where f.id = v_vend_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_b, v_token, v_op, 'Vendor DAM re-enabled', p_app => 'dam', p_app_status => 'active'
  ) into v_result;
  if (v_result ->> 'success')::boolean is not true
     or not exists (
       select 1 from dam.factory_ext x
       where x.factory_id = v_vend_b and x.status = 'active' and x.status_reason is null
     ) then
    raise exception 'vendor dam reactivation did not clear the reason';
  end if;

  -- Vendor stale token (a deliberately old token cannot mutate the row).
  select f.updated_at into v_token from core.factory f where f.id = v_vend_b;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_b, v_token - interval '1 second', v_op, 'Vendor conflict', p_display_name => 'Vendor Second ' || v_suffix
  ) into v_result;
  if v_result ->> 'code' <> 'stale_token'
     or (select display_name from core.factory where id = v_vend_b) is not null then
    raise exception 'vendor stale token was not detected without mutation';
  end if;

  -- Vendor not_found and PLM rejection.
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    gen_random_uuid(), v_token, v_op, 'Ghost vendor', p_display_name => 'Ghost'
  ) into v_result;
  if v_result ->> 'code' <> 'not_found' then
    raise exception 'unknown vendor did not return not_found';
  end if;
  v_op := gen_random_uuid();
  select api.db_data_admin_update_vendor(
    v_vend_a, v_token, v_op, 'Vendor plm attempt', p_app => 'plm', p_app_status => 'inactive'
  ) into v_result;
  if v_result ->> 'code' <> 'validation_failed' then
    raise exception 'vendor plm app write was accepted';
  end if;
end $$;

rollback;
