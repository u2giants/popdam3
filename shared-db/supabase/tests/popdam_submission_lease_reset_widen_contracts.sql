-- popcre/shared-db#3464, claim #3486. Every fixture write rolls back.
-- Behavior tests for the widened reset: not_submitted with NULL status and
-- fixed provider_error category, and provider_definitive_rejection with
-- HTTP 400/401/402/403/422/429. Every other guard is unchanged.
begin;

create table if not exists public.admin_config (
  key text not null,
  value jsonb not null,
  updated_at timestamptz default now() not null,
  updated_by uuid
);
do $bootstrap$
begin
  if exists (
    select 1 from pg_class
    where oid = to_regclass('public.admin_config') and relkind = 'r'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_config'::regclass and contype = 'p'
  ) then
    alter table public.admin_config add primary key (key);
  end if;
end $bootstrap$;

do $exact_objects$
declare
  v_table_oid oid := to_regclass('public.admin_config');
  v_key_attnum smallint;
  v_reset_proc oid := to_regprocedure(
    'public.reset_bulk_operation_submission_lease(text,bigint,text,text,text,integer,jsonb)');
begin
  if v_table_oid is null or not exists (
    select 1 from pg_class where oid = v_table_oid and relkind = 'r'
  ) then
    raise exception 'admin_config is not the exact table required by the reset';
  end if;
  select attnum into v_key_attnum from pg_attribute
  where attrelid = v_table_oid and attname = 'key' and not attisdropped;
  if v_key_attnum is null
     or not exists (select 1 from pg_attribute where attrelid = v_table_oid
       and attname = 'key' and atttypid = 'pg_catalog.text'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = v_table_oid
       and attname = 'value' and atttypid = 'pg_catalog.jsonb'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = v_table_oid
       and attname = 'updated_at' and atttypid = 'pg_catalog.timestamptz'::regtype
       and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = v_table_oid
       and conname = 'admin_config_pkey' and contype = 'p'
       and conkey = array[v_key_attnum]::smallint[]) then
    raise exception 'admin_config columns or exact key primary key drifted';
  end if;
  if to_regprocedure('public.update_bulk_operation(text,jsonb,text,bigint,text,integer)') is null
     or to_regprocedure('public.update_bulk_operations_batch(jsonb)') is null then
    raise exception 'required guarded writer signature is missing';
  end if;
  if v_reset_proc is null or not exists (
    select 1 from pg_proc where oid = v_reset_proc and prosecdef
      and provolatile = 'v' and 'search_path=public, pg_temp' = any(proconfig)
  ) then
    raise exception 'reset signature, security definer, search_path or volatility drifted';
  end if;
end;
$exact_objects$;

create or replace function pg_temp.expect_lease_reset_refusal(
  p_revision bigint,
  p_owner text,
  p_token text,
  p_reason text,
  p_status integer,
  p_error jsonb,
  p_sqlstate text,
  p_key text default 'bulk-tag'
)
returns void
language plpgsql
as $helper$
declare
  v_before jsonb;
  v_after jsonb;
  v_actual text;
  v_rejected boolean := false;
begin
  select value into v_before from public.admin_config where key = 'BULK_OPERATIONS';
  begin
    perform public.reset_bulk_operation_submission_lease(
      p_key, p_revision, p_owner, p_token, p_reason, p_status, p_error);
  exception when others then
    get stacked diagnostics v_actual = returned_sqlstate;
    if v_actual is distinct from p_sqlstate then
      raise exception 'unexpected reset refusal SQLSTATE %, wanted %', v_actual, p_sqlstate;
    end if;
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'unsafe lease reset was accepted';
  end if;
  select value into v_after from public.admin_config where key = 'BULK_OPERATIONS';
  if v_after is distinct from v_before then
    raise exception 'refused lease reset changed stored state';
  end if;
end;
$helper$;

create or replace function pg_temp.expect_unproven_writer_refusal(
  p_payload jsonb,
  p_batch boolean
)
returns void
language plpgsql
as $writer_refusal$
declare
  v_before jsonb;
  v_after jsonb;
  v_refused boolean := false;
begin
  select value into v_before from public.admin_config where key = 'BULK_OPERATIONS';
  begin
    if p_batch then
      perform public.update_bulk_operations_batch(jsonb_build_object(
        'bulk-sibling', jsonb_build_object('status', 'queued'),
        'bulk-tag', p_payload));
    else
      perform public.update_bulk_operation('bulk-tag', p_payload, null::text);
    end if;
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'unproven % writer changed a reset submission',
      case when p_batch then 'batch' else 'legacy' end;
  end if;
  select value into v_after from public.admin_config where key = 'BULK_OPERATIONS';
  if v_after is distinct from v_before or v_after ? 'bulk-sibling' then
    raise exception 'refused % writer partially applied',
      case when p_batch then 'batch' else 'legacy' end;
  end if;
end;
$writer_refusal$;

do $test$
declare
  v_claim jsonb;
  v_token text;
  v_claimed jsonb;
  v_reset jsonb;
  v_reclaim jsonb;
  v_new_token text;
  v_job jsonb;
  v_status integer;
  v_marker text;
  v_with_extra jsonb;
  v_error constant jsonb := '{"error":{"message":"synthetic rejection"}}'::jsonb;
  v_not_submitted constant jsonb := '{"category":"not_submitted"}'::jsonb;
begin
  -- Use the real writer to mint the one-time receipt.
  insert into public.admin_config(key, value, updated_at)
  values ('BULK_OPERATIONS',
          '{"bulk-tag":{"status":"running","state_revision":0,"external_job":{"phase":"prepared"}}}'::jsonb,
          now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  v_claim := public.update_bulk_operation(
    'bulk-tag',
    '{"status":"running","external_job":{"phase":"submitting"}}'::jsonb,
    'running', 0, 'worker-A', 120);
  v_token := v_claim ->> 'lease_token';
  if v_claim ->> 'ok' is distinct from 'true'
     or v_claim ->> 'lease_receipt_issued' is distinct from 'true'
     or v_token is null then
    raise exception 'real writer did not issue the fixture receipt';
  end if;
  select value into v_claimed from public.admin_config where key = 'BULK_OPERATIONS';

  -- 1. Every other 4xx still refuses under provider_definitive_rejection.
  --    Only 400/401/402/403/422/429 are accepted.
  for v_status in 400..499 loop
    if v_status not in (400, 401, 402, 403, 422, 429) then
      perform pg_temp.expect_lease_reset_refusal(
        1, 'worker-A', v_token, 'provider_definitive_rejection',
        v_status, v_error, '22023');
    end if;
  end loop;

  -- 2. 5xx and timeout-shaped statuses refuse.
  foreach v_status in array array[500, 501, 502, 503, 504] loop
    perform pg_temp.expect_lease_reset_refusal(
      1, 'worker-A', v_token, 'provider_definitive_rejection',
      v_status, v_error, '22023');
  end loop;

  -- 3. NULL status with the wrong reason refuses.
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', null, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'timeout', null, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'disconnect', null, v_error, '22023');

  -- 4. Non-NULL status with not_submitted refuses.
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', 400, v_not_submitted, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', 200, v_not_submitted, '22023');

  -- 5. not_submitted with wrong provider_error category refuses.
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, '{"category":"wrong"}'::jsonb, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, '{}'::jsonb, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, null, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, '"string"'::jsonb, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, v_error, '22023');

  -- 6. Wrong reason still refuses.
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'timeout', 400, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'disconnect', 400, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'some_other_reason', 400, v_error, '22023');

  -- 7. Invalid provider_error shapes refuse for provider_definitive_rejection.
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', 400, null, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', 400, '{}'::jsonb, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', 400, '[]'::jsonb, '22023');

  -- 8. Argument guards remain unchanged.
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', 400, v_error, '22023', '');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', 400, v_error, '22023', null);
  perform pg_temp.expect_lease_reset_refusal(
    null, 'worker-A', v_token, 'provider_definitive_rejection', 400, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, '', v_token, 'provider_definitive_rejection', 400, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, null, v_token, 'provider_definitive_rejection', 400, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', '', 'provider_definitive_rejection', 400, v_error, '22023');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', null, 'provider_definitive_rejection', 400, v_error, '22023');

  -- 9. Wrong revision, wrong owner, wrong receipt refuse.
  perform pg_temp.expect_lease_reset_refusal(
    0, 'worker-A', v_token, 'provider_definitive_rejection', 400, v_error, '55000');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-B', v_token, 'provider_definitive_rejection', 400, v_error, '55000');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', 'wrong-receipt', 'provider_definitive_rejection', 400, v_error, '55000');

  -- 10. Expired lease refuses.
  update public.admin_config
  set value = jsonb_set(v_claimed,
    '{bulk-tag,external_job,lease_expires_at}',
    to_jsonb((clock_timestamp() - interval '1 second')::text))
  where key = 'BULK_OPERATIONS';
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', 400, v_error, '55000');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, v_not_submitted, '55000');
  update public.admin_config set value = v_claimed where key = 'BULK_OPERATIONS';

  -- 11. Ambiguity markers refuse.
  foreach v_marker in array array['ambiguous_since', 'ambiguous_reason',
                                  'ambiguous_prior_phase', 'ambiguous_prior_owner'] loop
    update public.admin_config
    set value = jsonb_set(v_claimed,
      array['bulk-tag', 'external_job', v_marker], '"fixture"'::jsonb)
    where key = 'BULK_OPERATIONS';
    perform pg_temp.expect_lease_reset_refusal(
      1, 'worker-A', v_token, 'provider_definitive_rejection', 400, v_error, '55000');
  end loop;
  update public.admin_config set value = v_claimed where key = 'BULK_OPERATIONS';

  -- 12. Bound provider job ID refuses.
  update public.admin_config
  set value = jsonb_set(v_claimed,
    '{bulk-tag,external_job,provider_batch_id}', '"bound-fixture"'::jsonb)
  where key = 'BULK_OPERATIONS';
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'provider_definitive_rejection', 400, v_error, '55000');
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, v_not_submitted, '55000');
  update public.admin_config set value = v_claimed where key = 'BULK_OPERATIONS';

  -- 13. Positive path: not_submitted with NULL status and fixed category resets.
  v_with_extra := jsonb_set(
    jsonb_set(
      jsonb_set(v_claimed, '{bulk-tag,external_job,lease_token}', '"stored-fixture"'::jsonb),
      '{bulk-tag,external_job,submitted_at}', '"fixture"'::jsonb),
    '{bulk-tag,external_job,next_poll_at}', '"fixture"'::jsonb);
  update public.admin_config set value = v_with_extra where key = 'BULK_OPERATIONS';
  v_reset := public.reset_bulk_operation_submission_lease(
    'bulk-tag', 1, 'worker-A', v_token,
    'not_submitted', null, v_not_submitted);
  v_job := v_reset -> 'operation' -> 'external_job';
  if v_reset ->> 'ok' is distinct from 'true'
     or v_reset ->> 'reason' is distinct from 'not_submitted'
     or (v_reset ->> 'state_revision')::bigint is distinct from 2
     or v_reset ->> 'lease_receipt_issued' is distinct from 'false'
     or v_reset ->> 'lease_token' is not null
     or v_job ->> 'phase' is distinct from 'prepared'
     or v_job ? 'submission_owner' or v_job ? 'lease_expires_at'
     or v_job ? 'lease_claimed_at' or v_job ? 'lease_token'
     or v_job ? 'submitted_at' or v_job ? 'next_poll_at'
     or v_job ? 'lease_proof' or v_job ? 'provider_batch_id'
     or (v_job ->> 'last_definitive_rejection_status')::integer is not null
     or v_job ->> 'last_definitive_rejection_reason' is distinct from 'not_submitted'
     or nullif(v_job ->> 'last_definitive_rejection_at', '')::timestamptz is null then
    raise exception 'not_submitted reset did not consume the lease safely';
  end if;

  -- 14. No receipt remint: neither unproven writer may advance the reset.
  perform pg_temp.expect_unproven_writer_refusal(
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb), false);
  perform pg_temp.expect_unproven_writer_refusal(
    jsonb_set(v_reset -> 'operation', '{external_job,lease_proof}', '"forged-digest"'::jsonb), false);
  perform pg_temp.expect_unproven_writer_refusal(
    jsonb_set(v_reset -> 'operation', '{external_job,provider_batch_id}', '"forged-job"'::jsonb), false);
  perform pg_temp.expect_unproven_writer_refusal(
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb), true);
  perform pg_temp.expect_unproven_writer_refusal(
    jsonb_set(v_reset -> 'operation', '{external_job,lease_proof}', '"forged-digest"'::jsonb), true);
  perform pg_temp.expect_unproven_writer_refusal(
    jsonb_set(v_reset -> 'operation', '{external_job,provider_batch_id}', '"forged-job"'::jsonb), true);

  -- 15. Stale process cannot reset or claim the old revision.
  perform pg_temp.expect_lease_reset_refusal(
    1, 'worker-A', v_token, 'not_submitted', null, v_not_submitted, '55000');
  v_reclaim := public.update_bulk_operation(
    'bulk-tag',
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb),
    'running', 1, 'worker-B', 120);
  if v_reclaim ->> 'ok' is distinct from 'false'
     or v_reclaim ->> 'reason' is distinct from 'revision_conflict' then
    raise exception 'stale revision unexpectedly reclaimed a submission slot';
  end if;

  -- 16. Fresh revision claim gets its own receipt; new statuses each reset once.
  v_reclaim := public.update_bulk_operation(
    'bulk-tag',
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb),
    'running', 2, 'worker-B', 120);
  v_new_token := v_reclaim ->> 'lease_token';
  if v_reclaim ->> 'ok' is distinct from 'true'
     or v_reclaim ->> 'lease_receipt_issued' is distinct from 'true'
     or v_new_token is null or v_new_token = v_token then
    raise exception 'fresh revision did not receive its own one-time receipt';
  end if;

  -- 16a. 401 resets once.
  v_reset := public.reset_bulk_operation_submission_lease(
    'bulk-tag', 3, 'worker-B', v_new_token,
    'provider_definitive_rejection', 401, v_error);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 4
     or (v_reset -> 'operation' -> 'external_job' ->> 'last_definitive_rejection_status')::integer
        is distinct from 401
     or v_reset ->> 'reason' is distinct from 'provider_definitive_rejection' then
    raise exception '401 rejection was not safely reset';
  end if;

  -- 16b. 402 resets once on a fresh revision.
  v_reclaim := public.update_bulk_operation(
    'bulk-tag',
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb),
    'running', 4, 'worker-B', 120);
  v_new_token := v_reclaim ->> 'lease_token';
  v_reset := public.reset_bulk_operation_submission_lease(
    'bulk-tag', 5, 'worker-B', v_new_token,
    'provider_definitive_rejection', 402, v_error);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 6
     or (v_reset -> 'operation' -> 'external_job' ->> 'last_definitive_rejection_status')::integer
        is distinct from 402 then
    raise exception '402 rejection was not safely reset';
  end if;

  -- 16c. 403 resets once on a fresh revision.
  v_reclaim := public.update_bulk_operation(
    'bulk-tag',
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb),
    'running', 6, 'worker-B', 120);
  v_new_token := v_reclaim ->> 'lease_token';
  v_reset := public.reset_bulk_operation_submission_lease(
    'bulk-tag', 7, 'worker-B', v_new_token,
    'provider_definitive_rejection', 403, v_error);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 8
     or (v_reset -> 'operation' -> 'external_job' ->> 'last_definitive_rejection_status')::integer
        is distinct from 403 then
    raise exception '403 rejection was not safely reset';
  end if;

  -- 16d. 429 resets once on a fresh revision.
  v_reclaim := public.update_bulk_operation(
    'bulk-tag',
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb),
    'running', 8, 'worker-B', 120);
  v_new_token := v_reclaim ->> 'lease_token';
  v_reset := public.reset_bulk_operation_submission_lease(
    'bulk-tag', 9, 'worker-B', v_new_token,
    'provider_definitive_rejection', 429, v_error);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 10
     or (v_reset -> 'operation' -> 'external_job' ->> 'last_definitive_rejection_status')::integer
        is distinct from 429 then
    raise exception '429 rejection was not safely reset';
  end if;

  -- 16e. 400 still resets on a fresh revision.
  v_reclaim := public.update_bulk_operation(
    'bulk-tag',
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb),
    'running', 10, 'worker-B', 120);
  v_new_token := v_reclaim ->> 'lease_token';
  v_reset := public.reset_bulk_operation_submission_lease(
    'bulk-tag', 11, 'worker-B', v_new_token,
    'provider_definitive_rejection', 400, v_error);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 12 then
    raise exception '400 rejection was not safely reset';
  end if;

  -- 16f. 422 still resets on a fresh revision.
  v_reclaim := public.update_bulk_operation(
    'bulk-tag',
    jsonb_set(v_reset -> 'operation', '{external_job,phase}', '"submitting"'::jsonb),
    'running', 12, 'worker-B', 120);
  v_new_token := v_reclaim ->> 'lease_token';
  v_reset := public.reset_bulk_operation_submission_lease(
    'bulk-tag', 13, 'worker-B', v_new_token,
    'provider_definitive_rejection', 422, v_error);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 14 then
    raise exception '422 rejection was not safely reset';
  end if;

  -- 17. Privilege checks unchanged.
  if has_function_privilege('anon',
       'public.reset_bulk_operation_submission_lease(text,bigint,text,text,text,integer,jsonb)',
       'EXECUTE') then
    raise exception 'anon must not execute the reset contract';
  end if;
  if exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.reset_bulk_operation_submission_lease(text,bigint,text,text,text,integer,jsonb)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC must not execute the reset contract';
  end if;
  if not has_function_privilege('authenticated',
       'public.reset_bulk_operation_submission_lease(text,bigint,text,text,text,integer,jsonb)',
       'EXECUTE') then
    raise exception 'authenticated worker lost reset execution privilege';
  end if;
end;
$test$;

-- Exercise the actual RPC as each granted/denied API role.
do $role_fixtures$
declare
  v_claim jsonb;
begin
  update public.admin_config
  set value = value || jsonb_build_object(
    'auth-reset', jsonb_build_object('status', 'running', 'state_revision', 0,
      'external_job', jsonb_build_object('phase', 'prepared')),
    'service-reset', jsonb_build_object('status', 'running', 'state_revision', 0,
      'external_job', jsonb_build_object('phase', 'prepared')))
  where key = 'BULK_OPERATIONS';
  v_claim := public.update_bulk_operation(
    'auth-reset', '{"status":"running","external_job":{"phase":"submitting"}}'::jsonb,
    'running', 0, 'authenticated-worker', 120);
  if v_claim ->> 'lease_receipt_issued' is distinct from 'true' then
    raise exception 'authenticated role fixture did not obtain a real receipt';
  end if;
  perform set_config('test.auth_reset_receipt', v_claim ->> 'lease_token', true);
  v_claim := public.update_bulk_operation(
    'service-reset', '{"status":"running","external_job":{"phase":"submitting"}}'::jsonb,
    'running', 0, 'service-worker', 120);
  if v_claim ->> 'lease_receipt_issued' is distinct from 'true' then
    raise exception 'service role fixture did not obtain a real receipt';
  end if;
  perform set_config('test.service_reset_receipt', v_claim ->> 'lease_token', true);
end;
$role_fixtures$;

set local role anon;
do $anon_denied$
declare
  v_denied boolean := false;
begin
  if current_user <> 'anon' then raise exception 'anon role was not set'; end if;
  begin
    perform public.reset_bulk_operation_submission_lease(
      'auth-reset', 1, 'authenticated-worker', current_setting('test.auth_reset_receipt'),
      'provider_definitive_rejection', 400, '{"error":{"message":"synthetic"}}'::jsonb);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then raise exception 'anon executed the reset RPC'; end if;
end;
$anon_denied$;
reset role;

set local role authenticated;
do $authenticated_allowed$
declare
  v_reset jsonb;
begin
  if current_user <> 'authenticated' then raise exception 'authenticated role was not set'; end if;
  v_reset := public.reset_bulk_operation_submission_lease(
    'auth-reset', 1, 'authenticated-worker', current_setting('test.auth_reset_receipt'),
    'not_submitted', null, '{"category":"not_submitted"}'::jsonb);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 2
     or v_reset ->> 'lease_receipt_issued' is distinct from 'false'
     or v_reset ->> 'reason' is distinct from 'not_submitted' then
    raise exception 'authenticated role could not safely reset with not_submitted';
  end if;
end;
$authenticated_allowed$;
reset role;

set local role service_role;
do $service_allowed$
declare
  v_reset jsonb;
begin
  if current_user <> 'service_role' then raise exception 'service role was not set'; end if;
  v_reset := public.reset_bulk_operation_submission_lease(
    'service-reset', 1, 'service-worker', current_setting('test.service_reset_receipt'),
    'provider_definitive_rejection', 429, '{"error":{"message":"synthetic"}}'::jsonb);
  if v_reset ->> 'ok' is distinct from 'true'
     or (v_reset ->> 'state_revision')::bigint is distinct from 2
     or v_reset ->> 'lease_receipt_issued' is distinct from 'false' then
    raise exception 'service role could not safely reset with 429 rejection';
  end if;
end;
$service_allowed$;
reset role;

rollback;
