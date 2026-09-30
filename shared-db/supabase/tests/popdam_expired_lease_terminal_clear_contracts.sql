-- popcre/shared-db#3543, claim #3844. Every fixture write rolls back.
-- Behavior tests for the governed clear of a terminal external_job after the
-- submission-lease receipt has expired (worker crashed between saving the
-- completed job and clearing it; u2giants/popdam3#92):
--   terminal + expired clears once; live phases refuse; ambiguous refuses;
--   wrong revision refuses; a second clear is a no-op. Also: an unexpired lease
--   without the receipt refuses, a wrong presented receipt refuses, a legacy
--   bound row that never had a receipt refuses, and the provider id must match.
begin;

create table if not exists public.admin_config (
  key text not null,
  value jsonb not null,
  updated_at timestamptz default now() not null,
  updated_by uuid
);
do $bootstrap$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_config'::regclass and contype = 'p'
  ) then
    alter table public.admin_config add constraint admin_config_pkey primary key (key);
  end if;
end $bootstrap$;

-- Exact objects the function depends on: an ordinary table with exact column
-- types and admin_config_pkey on key (required by its on conflict (key)).
do $exact_objects$
declare
  v_table_oid oid := to_regclass('public.admin_config');
  v_key_attnum smallint;
begin
  if v_table_oid is null or not exists (
    select 1 from pg_class where oid = v_table_oid and relkind = 'r'
  ) then
    raise exception 'admin_config is not an ordinary table';
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
  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.update_bulk_operation(text,jsonb,text,bigint,text,integer)')
      and prosecdef and provolatile = 'v'
      and 'search_path=public, pg_temp' = any(proconfig)
  ) then
    raise exception 'update_bulk_operation signature or security contract drifted';
  end if;
end $exact_objects$;

do $$
declare
  v_job     jsonb;
  v_base    jsonb;
  v_out     jsonb;
  v_stored  jsonb;
  v_before  jsonb;
  v_failed  boolean;
  v_phase   text;
begin
  if to_regprocedure('public.update_bulk_operation(text,jsonb,text,bigint,text,integer)') is null then
    raise exception 'public.update_bulk_operation is missing';
  end if;

  -- A completed, bound job whose receipt lease expired an hour ago.
  v_job := jsonb_build_object(
    'phase', 'completed',
    'provider_batch_id', 'batch_3543',
    'submission_owner', 'crashed-worker',
    'lease_claimed_at', now() - interval '2 hours',
    'lease_expires_at', now() - interval '1 hour',
    'lease_proof', md5('lost-receipt'),
    'items', jsonb_build_array(jsonb_build_object('asset_id', 'a1', 'status', 'applied')));
  v_base := jsonb_build_object(
    'status', 'running',
    'state_revision', 5,
    'external_job', v_job);

  insert into public.admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', jsonb_build_object('op-3543', v_base), now())
  on conflict (key) do update set value = excluded.value;

  -- 1. Wrong revision refuses (raises 55000) and mutates nothing.
  select value into v_before from public.admin_config where key = 'BULK_OPERATIONS';
  v_failed := false;
  begin
    perform public.update_bulk_operation('op-3543',
      jsonb_build_object('status', 'running',
        'external_job', v_job || jsonb_build_object('clear_after_reconciliation', true)),
      null, 4);
  exception when sqlstate '55000' then v_failed := true;
  end;
  if not v_failed then raise exception 'a stale-revision expired clear did not raise 55000'; end if;
  select value into v_stored from public.admin_config where key = 'BULK_OPERATIONS';
  if v_stored is distinct from v_before then raise exception 'a refused clear mutated state'; end if;

  -- 2. A presented but wrong receipt still refuses even after expiry.
  v_failed := false;
  begin
    perform public.update_bulk_operation('op-3543',
      jsonb_build_object('status', 'running',
        'external_job', v_job || jsonb_build_object(
          'lease_token', 'not-the-receipt', 'clear_after_reconciliation', true)),
      null, 5);
  exception when sqlstate '55000' then v_failed := true;
  end;
  if not v_failed then raise exception 'a wrong receipt was accepted by the expired clear'; end if;

  -- 3. Provider id must match exactly.
  v_failed := false;
  begin
    perform public.update_bulk_operation('op-3543',
      jsonb_build_object('status', 'running',
        'external_job', v_job || jsonb_build_object(
          'provider_batch_id', 'batch_other', 'clear_after_reconciliation', true)),
      null, 5);
  exception when sqlstate '55000' then v_failed := true;
  end;
  if not v_failed then raise exception 'a mismatched provider_batch_id was cleared'; end if;

  -- 4. Live phases refuse, even with an expired lease.
  foreach v_phase in array array['prepared', 'submitting', 'pending', 'applying'] loop
    update public.admin_config
       set value = jsonb_set(value, array['op-3543', 'external_job', 'phase'], to_jsonb(v_phase))
     where key = 'BULK_OPERATIONS';
    v_failed := false;
    begin
      perform public.update_bulk_operation('op-3543',
        jsonb_build_object('status', 'running',
          'external_job', v_job || jsonb_build_object('phase', v_phase, 'clear_after_reconciliation', true)),
        null, 5);
    exception when sqlstate '55000' then v_failed := true;
    end;
    if not v_failed then raise exception 'live phase % was cleared', v_phase; end if;
    select value -> 'op-3543' into v_stored from public.admin_config where key = 'BULK_OPERATIONS';
    if not (v_stored ? 'external_job') then raise exception 'live phase % lost its external_job', v_phase; end if;
  end loop;

  -- 5. Ambiguous refuses: both the ambiguous phase and a completed job that
  --    carries ambiguity markers.
  update public.admin_config
     set value = jsonb_set(value, array['op-3543', 'external_job', 'phase'], to_jsonb('ambiguous_submission'::text))
   where key = 'BULK_OPERATIONS';
  v_failed := false;
  begin
    perform public.update_bulk_operation('op-3543',
      jsonb_build_object('status', 'running',
        'external_job', v_job || jsonb_build_object('phase', 'ambiguous_submission', 'clear_after_reconciliation', true)),
      null, 5);
  exception when sqlstate '55000' then v_failed := true;
  end;
  if not v_failed then raise exception 'an ambiguous_submission job was cleared'; end if;

  update public.admin_config
     set value = jsonb_set(value, array['op-3543', 'external_job'],
       v_job || jsonb_build_object('ambiguous_since', now() - interval '3 hours',
                                   'ambiguous_reason', 'x'))
   where key = 'BULK_OPERATIONS';
  v_failed := false;
  begin
    perform public.update_bulk_operation('op-3543',
      jsonb_build_object('status', 'running',
        'external_job', v_job || jsonb_build_object('ambiguous_since', now() - interval '3 hours',
                                                     'ambiguous_reason', 'x',
                                                     'clear_after_reconciliation', true)),
      null, 5);
  exception when sqlstate '55000' then v_failed := true;
  end;
  if not v_failed then raise exception 'a completed job with ambiguity markers was cleared'; end if;

  -- 6. An unexpired lease without the receipt refuses.
  update public.admin_config
     set value = jsonb_set(value, array['op-3543', 'external_job'],
       v_job || jsonb_build_object('lease_expires_at', now() + interval '10 minutes'))
   where key = 'BULK_OPERATIONS';
  v_failed := false;
  begin
    perform public.update_bulk_operation('op-3543',
      jsonb_build_object('status', 'running',
        'external_job', v_job || jsonb_build_object('lease_expires_at', now() + interval '10 minutes',
                                                     'clear_after_reconciliation', true)),
      null, 5);
  exception when sqlstate '55000' then v_failed := true;
  end;
  if not v_failed then raise exception 'a live-leased completed job was cleared without its receipt'; end if;

  -- 7. A legacy bound row that never held a receipt refuses (fails closed).
  update public.admin_config
     set value = jsonb_set(value, array['op-3543', 'external_job'], v_job - 'lease_proof')
   where key = 'BULK_OPERATIONS';
  v_failed := false;
  begin
    perform public.update_bulk_operation('op-3543',
      jsonb_build_object('status', 'running',
        'external_job', (v_job - 'lease_proof') || jsonb_build_object('clear_after_reconciliation', true)),
      null, 5);
  exception when sqlstate '55000' then v_failed := true;
  end;
  if not v_failed then raise exception 'a receipt-less legacy completed job was cleared'; end if;

  -- 8. Terminal + expired clears once, at the exact revision, with no remint.
  update public.admin_config
     set value = jsonb_set(value, array['op-3543'], v_base)
   where key = 'BULK_OPERATIONS';
  v_out := public.update_bulk_operation('op-3543',
    jsonb_build_object('status', 'completed',
      'external_job', v_job || jsonb_build_object('clear_after_reconciliation', true)),
    null, 5);
  if (v_out ->> 'ok')::boolean is not true
     or (v_out ->> 'state_revision')::bigint <> 6
     or v_out -> 'operation' ? 'external_job'
     or (v_out ->> 'lease_receipt_issued')::boolean is not false
     or v_out ->> 'lease_token' is not null then
    raise exception 'the governed expired clear did not succeed cleanly: %', v_out;
  end if;
  select value -> 'op-3543' into v_stored from public.admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'external_job' or (v_stored ->> 'state_revision')::bigint <> 6
     or v_stored ->> 'status' <> 'completed' then
    raise exception 'the expired clear did not remove only external_job and advance the revision: %', v_stored;
  end if;

  -- 9. A second clear is a no-op: no raise, no write, no revision change.
  select value into v_before from public.admin_config where key = 'BULK_OPERATIONS';
  v_out := public.update_bulk_operation('op-3543',
    jsonb_build_object('status', 'completed',
      'external_job', v_job || jsonb_build_object('clear_after_reconciliation', true)),
    null, 5);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'already_cleared'
     or (v_out ->> 'state_revision')::bigint <> 6 then
    raise exception 'a second clear was not a no-op: %', v_out;
  end if;
  select value into v_stored from public.admin_config where key = 'BULK_OPERATIONS';
  if v_stored is distinct from v_before then raise exception 'a second clear mutated state'; end if;

  raise notice 'popdam_expired_lease_terminal_clear_contracts: all assertions held';
end $$;

rollback;
