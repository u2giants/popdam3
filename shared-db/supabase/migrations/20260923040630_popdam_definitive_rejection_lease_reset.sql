-- popcre/shared-db#3418; claim #3425.
-- derived-from: none
-- A provider's parsed definitive rejection is the one safe exit from an
-- unbound, still-live submission lease. This does not change the existing
-- update_bulk_operation writer or its ambiguity and pointer guards.
do $prerequisites$
declare
  v_table_oid oid := to_regclass('public.admin_config');
  v_key_attnum smallint;
begin
  if v_table_oid is null or not exists (
    select 1 from pg_class where oid = v_table_oid and relkind = 'r'
  ) then
    raise exception 'lease reset requires public.admin_config to be an ordinary table';
  end if;
  select attnum into v_key_attnum from pg_attribute
  where attrelid = v_table_oid and attname = 'key' and not attisdropped;
  if v_key_attnum is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = v_table_oid and attname = 'key'
         and atttypid = 'pg_catalog.text'::regtype and not attisdropped
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = v_table_oid and attname = 'value'
         and atttypid = 'pg_catalog.jsonb'::regtype and not attisdropped
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = v_table_oid and attname = 'updated_at'
         and atttypid = 'pg_catalog.timestamptz'::regtype and not attisdropped
     ) then
    raise exception 'lease reset requires exact admin_config key/value/updated_at types';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = v_table_oid and conname = 'admin_config_pkey'
      and contype = 'p' and conkey = array[v_key_attnum]::smallint[]
  ) then
    raise exception 'lease reset requires admin_config_pkey on key';
  end if;
  if to_regprocedure('public.update_bulk_operation(text,jsonb,text,bigint,text,integer)') is null
     or to_regprocedure('public.update_bulk_operations_batch(jsonb)') is null then
    raise exception 'lease reset requires the exact guarded writer signatures';
  end if;
end;
$prerequisites$;

create or replace function public.reset_bulk_operation_submission_lease(
  p_op_key text,
  p_expected_revision bigint,
  p_submission_owner text,
  p_lease_token text,
  p_reason text,
  p_http_status integer,
  p_provider_error jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_operations jsonb;
  v_operation jsonb;
  v_job jsonb;
  v_reset_job jsonb;
  v_reset_operation jsonb;
  v_revision bigint;
  v_lease_expires timestamptz;
  v_now timestamptz;
begin
  if p_op_key is null or btrim(p_op_key) = ''
     or p_expected_revision is null or p_expected_revision < 0
     or p_submission_owner is null or btrim(p_submission_owner) = ''
     or p_lease_token is null or btrim(p_lease_token) = '' then
    raise exception 'reset_bulk_operation_submission_lease: key, current revision, owner and receipt are required'
      using errcode = '22023';
  end if;

  -- This is caller-supplied evidence, not a claim that SQL can authenticate an
  -- external HTTP response. PopDAM must call only after it parsed a definitive
  -- provider-origin validation rejection. SQL cannot distinguish a provider
  -- response from a proxy response based on status and body alone; PopDAM must
  -- establish that origin before calling. The positive status set accepts
  -- only the currently justified validation-rejection codes. Every other
  -- status stays on the existing ambiguous-submission path until its exact
  -- provider contract is proven.
  if p_reason is distinct from 'provider_definitive_rejection'
     or p_http_status is null
     or p_http_status <> all(array[400, 422])
     or jsonb_typeof(p_provider_error) is distinct from 'object'
     or p_provider_error = '{}'::jsonb then
    raise exception 'reset_bulk_operation_submission_lease: parsed definitive 4xx rejection evidence is required'
      using errcode = '22023';
  end if;

  -- Exactly the lock used by update_bulk_operation: validation and the reset
  -- serialize with every ordinary lease claim, provider binding and state write.
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));
  v_now := clock_timestamp();
  select value into v_operations
  from public.admin_config
  where key = 'BULK_OPERATIONS';
  v_operations := coalesce(v_operations, '{}'::jsonb);
  v_operation := case when jsonb_typeof(v_operations -> p_op_key) = 'object'
                      then v_operations -> p_op_key end;
  v_job := case when jsonb_typeof(v_operation -> 'external_job') = 'object'
                then v_operation -> 'external_job' end;
  v_revision := coalesce(nullif(v_operation ->> 'state_revision', '')::bigint, 0);
  v_lease_expires := nullif(v_job ->> 'lease_expires_at', '')::timestamptz;

  -- A bare owner name or readable revision is never authority. The original
  -- one-time receipt, still-live lease and exact current revision are all
  -- required. No bound or ambiguous provider job can be reset through here.
  if v_operation is null or v_job is null
     or v_revision is distinct from p_expected_revision
     or v_operation ->> 'status' is distinct from 'running'
     or v_job ->> 'phase' is distinct from 'submitting'
     or nullif(v_job ->> 'provider_batch_id', '') is not null
     or nullif(v_job ->> 'submission_owner', '') is distinct from p_submission_owner
     or v_lease_expires is null or v_lease_expires <= v_now
     or nullif(v_job ->> 'lease_proof', '') is distinct from md5(p_lease_token)
     or v_job ?| array['ambiguous_since', 'ambiguous_reason',
                       'ambiguous_prior_phase', 'ambiguous_prior_owner'] then
    raise exception 'reset_bulk_operation_submission_lease: current live unbound submission receipt was not proven'
      using errcode = '55000';
  end if;

  -- Consume the old receipt. No receipt is returned or reissued here. The
  -- ordinary guarded writer may mint a new receipt only on a later fresh
  -- revision claim; its stop, ambiguity and provider-pointer guards remain in
  -- force. The parsed provider error body is neither stored nor returned.
  v_reset_job := (v_job - 'submission_owner' - 'lease_expires_at'
                       - 'lease_claimed_at' - 'lease_proof' - 'lease_token'
                       - 'submitted_at' - 'next_poll_at')
                 || jsonb_build_object(
                      'phase', 'prepared',
                      'last_definitive_rejection_status', p_http_status,
                      'last_definitive_rejection_at', v_now);
  v_reset_operation := jsonb_set(v_operation, array['external_job'], v_reset_job)
                       || jsonb_build_object('state_revision', v_revision + 1);
  v_operations := jsonb_set(v_operations, array[p_op_key], v_reset_operation);

  insert into public.admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_operations, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'reason', 'provider_definitive_rejection',
    'op_key', p_op_key,
    'state_revision', v_revision + 1,
    'lease_receipt_issued', false,
    'lease_token', null,
    'operation', v_reset_operation);
end;
$function$;

comment on function public.reset_bulk_operation_submission_lease(text, bigint, text, text, text, integer, jsonb) is
  'For popcre/shared-db#3418. Consumes only the current, unexpired submission receipt on an unbound running operation after PopDAM presents parsed provider-origin definitive validation rejection evidence. The caller must authenticate the provider response; SQL cannot distinguish provider from proxy origin. Only HTTP 400 and 422 are accepted until another exact provider contract is proven; timeout, disconnect, all other 4xx, 5xx, expired or ambiguous lease, stale revision, wrong holder or receipt, and bound provider job cannot reset. The function never returns or remints a receipt.';

revoke execute on function public.reset_bulk_operation_submission_lease(text, bigint, text, text, text, integer, jsonb)
  from public, anon;
grant execute on function public.reset_bulk_operation_submission_lease(text, bigint, text, text, text, integer, jsonb)
  to authenticated, service_role, postgres;

do $postapply$
declare
  v_proc oid := to_regprocedure(
    'public.reset_bulk_operation_submission_lease(text,bigint,text,text,text,integer,jsonb)');
begin
  if v_proc is null or not exists (
    select 1 from pg_proc
    where oid = v_proc and prosecdef and provolatile = 'v'
      and 'search_path=public, pg_temp' = any(proconfig)
  ) then
    raise exception 'lease reset RPC signature or security/volatility contract is wrong';
  end if;
end;
$postapply$;
