-- Issue #3298 claim #4204, version 20261015132149.
-- derived-from: none
-- Migration A: additive least-privilege PM Jev activity-triage contract.
-- Pilot v1 writes are administrator-only (admin-only matrix v1). No grant
-- widening on existing tables. No LOGIN role. Evaluation-dataset RPCs and the
-- Deno gateway stay out of scope. Step 7B tightening is a later migration.

-- ============================================================================
-- 1. app.comment.body_revision + trigger
-- ============================================================================

alter table app.comment
  add column if not exists body_revision integer not null default 1;

comment on column app.comment.body_revision is
  'Monotonic comment-body revision. Bumped only when body text changes.';

create or replace function app.comment_body_revision_trg_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.body_revision is null then
      new.body_revision := 1;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.body_revision := greatest(coalesce(old.body_revision, 1), 1) + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

revoke all on function app.comment_body_revision_trg_fn() from public, anon, authenticated, service_role;

drop trigger if exists app_comment_body_revision on app.comment;
create trigger app_comment_body_revision
  before insert or update on app.comment
  for each row execute function app.comment_body_revision_trg_fn();

create unique index if not exists app_comment_poppim_client_operation_uq
  on app.comment (created_by_profile_id, source_id)
  where source_system = 'poppim-web-comment' and source_id is not null;

-- ============================================================================
-- 2. NOLOGIN triage worker role
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pm_jev_triage_worker') then
    create role pm_jev_triage_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

-- ============================================================================
-- 3. Eligibility / reservation ledger
-- ============================================================================

create table if not exists pim.ai_activity_triage_eligibility (
  id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null,
  client_operation_id uuid not null,
  eligibility_version integer not null default 1,
  comment_id uuid,
  product_id uuid not null,
  source_body_revision integer not null,
  cohort text not null default 'pilot' check (cohort in ('validation', 'pilot')),
  eligibility_state text not null default 'reserved'
    check (eligibility_state in ('reserved', 'submitted', 'canceled', 'expired', 'queued', 'source_changed')),
  reservation_token_hash text,
  recovery_handle_mac text,
  reserved_at timestamptz not null default now(),
  submitted_at timestamptz,
  canceled_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_profile_id, client_operation_id, eligibility_version)
);

comment on table pim.ai_activity_triage_eligibility is
  'Append-only-during-pilot eligibility/reservation ledger. No raw comment text.';

create index if not exists ai_activity_triage_eligibility_token_idx
  on pim.ai_activity_triage_eligibility (reservation_token_hash)
  where reservation_token_hash is not null;

create index if not exists ai_activity_triage_eligibility_comment_idx
  on pim.ai_activity_triage_eligibility (comment_id);

-- ============================================================================
-- 4. Triage result table
-- ============================================================================

create table if not exists pim.ai_activity_triage (
  id uuid primary key default gen_random_uuid(),
  eligibility_id uuid not null unique,
  comment_id uuid not null,
  requester_profile_id uuid not null,
  product_id uuid not null,
  source_body_revision integer not null,
  live_comment_id uuid references app.comment(id) on delete set null,
  live_product_id uuid references pim.product(id) on delete set null,
  live_requester_profile_id uuid references app.profile(id) on delete set null,
  created_record_table text,
  created_record_id uuid,
  input_digest text not null,
  input_key_version text not null,
  model text not null,
  contract_version text not null,
  state text not null default 'queued'
    check (state in ('queued', 'claimed', 'leased', 'succeeded', 'failed', 'accepted', 'dismissed', 'source_changed', 'expired')),
  action_label text check (action_label is null or action_label in
    ('routine_update', 'blocker_dependency', 'decision', 'follow_up_reminder', 'unclear')),
  result_payload jsonb not null default '{}'::jsonb,
  usage_payload jsonb not null default '{}'::jsonb,
  error_code text,
  lease_token_hash text,
  lease_expires_at timestamptz,
  lease_acquired_at timestamptz,
  attempt_count integer not null default 0,
  provider_started_at timestamptz,
  timeout_count integer not null default 0,
  reviewed_at timestamptz,
  reviewed_by_profile_id uuid,
  accepted_at timestamptz,
  dismissed_at timestamptz,
  first_impression_at timestamptz,
  request_limit_window_start timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table pim.ai_activity_triage is
  'Redacted provider/result metadata only. Never stores comment text, titles, emails, URLs, or credentials.';

create unique index if not exists ai_activity_triage_comment_idempotency_key
  on pim.ai_activity_triage (comment_id, input_digest, input_key_version, model, contract_version);

create index if not exists ai_activity_triage_requester_idx
  on pim.ai_activity_triage (requester_profile_id, created_at desc);

-- Serves admin-audit / recovery filters on state as a leading equality; the
-- pilot list RPCs lead with requester_profile_id and do not use this index.
create index if not exists ai_activity_triage_state_idx
  on pim.ai_activity_triage (state, reviewed_at);

create index if not exists ai_activity_triage_live_comment_idx
  on pim.ai_activity_triage (live_comment_id)
  where live_comment_id is not null;

-- ============================================================================
-- 5. Narrow RLS on triage tables (direct browser DML stays denied)
-- ============================================================================

alter table pim.ai_activity_triage enable row level security;
alter table pim.ai_activity_triage_eligibility enable row level security;

drop policy if exists pm_ai_activity_triage_select_own on pim.ai_activity_triage;
create policy pm_ai_activity_triage_select_own on pim.ai_activity_triage
  for select to authenticated
  using (requester_profile_id = app.current_profile_id());

drop policy if exists pm_ai_activity_triage_admin_audit on pim.ai_activity_triage;
create policy pm_ai_activity_triage_admin_audit on pim.ai_activity_triage
  for select to authenticated
  using (app.has_role('administrator'));

drop policy if exists pm_ai_activity_triage_eligibility_select_own on pim.ai_activity_triage_eligibility;
create policy pm_ai_activity_triage_eligibility_select_own on pim.ai_activity_triage_eligibility
  for select to authenticated
  using (requester_profile_id = app.current_profile_id());

drop policy if exists pm_ai_activity_triage_eligibility_admin_audit on pim.ai_activity_triage_eligibility;
create policy pm_ai_activity_triage_eligibility_admin_audit on pim.ai_activity_triage_eligibility
  for select to authenticated
  using (app.has_role('administrator'));

revoke all on pim.ai_activity_triage from public, anon, authenticated, service_role;
revoke all on pim.ai_activity_triage_eligibility from public, anon, authenticated, service_role;
grant select on pim.ai_activity_triage to authenticated;
grant select on pim.ai_activity_triage_eligibility to authenticated;

grant select, insert, update on pim.ai_activity_triage to pm_jev_triage_worker;
grant select, insert, update on pim.ai_activity_triage_eligibility to pm_jev_triage_worker;
grant usage on schema pim, api, app to pm_jev_triage_worker;

-- Worker policy (repo pattern: grants + for-all policy; tables stay postgres-owned).
drop policy if exists pm_ai_activity_triage_worker_all on pim.ai_activity_triage;
create policy pm_ai_activity_triage_worker_all on pim.ai_activity_triage
  for all to pm_jev_triage_worker using (true) with check (true);

drop policy if exists pm_ai_activity_triage_eligibility_worker_all on pim.ai_activity_triage_eligibility;
create policy pm_ai_activity_triage_eligibility_worker_all on pim.ai_activity_triage_eligibility
  for all to pm_jev_triage_worker using (true) with check (true);

-- ============================================================================
-- 6. Auth helper
-- ============================================================================

create or replace function pim.pm_jev_require_admin_pm_writer()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;
  if not exists (
    select 1 from app.profile p
    where p.id = v_profile and p.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PM_PROFILE_INACTIVE';
  end if;
  if not (app.has_app_access('pm') or app.has_role('administrator')) then
    raise exception using errcode = '42501', message = 'PM_ACCESS_DENIED';
  end if;
  if not app.has_role('administrator') then
    raise exception using errcode = '42501', message = 'PM_ADMIN_REQUIRED';
  end if;
  return v_profile;
end $$;

revoke all on function pim.pm_jev_require_admin_pm_writer() from public, anon, authenticated, service_role;
grant execute on function pim.pm_jev_require_admin_pm_writer() to pm_jev_triage_worker;

-- ============================================================================
-- 7. HMAC envelope verifier (SECURITY DEFINER, Vault-backed)
-- ============================================================================

create or replace function pim.pm_verify_jev_hmac_envelope(
  p_envelope jsonb,
  p_signature text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_canonical text;
  v_expected text;
  v_required text[] := array[
    'environment', 'requester_profile_id', 'product_id', 'comment_id',
    'eligibility_id', 'source_body_revision', 'lease_token', 'disposition',
    'input_byte_count', 'input_digest', 'input_key_version', 'model',
    'contract_version', 'quality_release_digest', 'target_deployment_digest',
    'emergency_generation', 'timestamp', 'nonce'
  ];
  k text;
begin
  if p_envelope is null or p_signature is null or length(btrim(p_signature)) < 32 then
    return false;
  end if;
  if jsonb_typeof(p_envelope) <> 'object' then
    return false;
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_envelope) ok
    where ok <> all (v_required)
  ) then
    return false;
  end if;
  foreach k in array v_required loop
    if not (p_envelope ? k) then
      return false;
    end if;
  end loop;

  begin
    select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'jev_envelope_hmac_key';
  exception when others then
    return false;
  end;
  if v_key is null or length(v_key) < 16 then
    return false;
  end if;

  v_canonical := (
    select string_agg(
      length(k2) || ':' || k2 || '=' ||
      case when p_envelope ->> k2 is null then ' '
           else length(p_envelope ->> k2) || ':' || (p_envelope ->> k2)
      end,
      ''
      order by k2
    )
    from unnest(v_required) as k2
  );

  v_expected := encode(
    extensions.hmac(convert_to(v_canonical, 'utf8'), convert_to(v_key, 'utf8'), 'sha256'),
    'hex'
  );
  if v_expected <> lower(btrim(p_signature)) then
    return false;
  end if;
  -- Short expiry on the signed timestamp (5 minutes).
  begin
    if (p_envelope ->> 'timestamp') is null
       or abs(extract(epoch from ((p_envelope ->> 'timestamp')::timestamptz - now()))) > 300 then
      return false;
    end if;
  exception when others then
    return false;
  end;
  return true;
end $$;

revoke all on function pim.pm_verify_jev_hmac_envelope(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function pim.pm_verify_jev_hmac_envelope(jsonb, text) to pm_jev_triage_worker;

-- ============================================================================
-- 8. Private workers
-- ============================================================================

create or replace function pim.pm_complete_activity_triage_worker(
  p_triage_id uuid,
  p_lease_token_hash text,
  p_action_label text,
  p_result_payload jsonb,
  p_usage_payload jsonb,
  p_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row pim.ai_activity_triage%rowtype;
begin
  if p_action_label is null or p_action_label not in
    ('routine_update', 'blocker_dependency', 'decision', 'follow_up_reminder', 'unclear') then
    raise exception using errcode = '22023', message = 'PM_INVALID_ACTION_LABEL';
  end if;

  select * into v_row
  from pim.ai_activity_triage
  where id = p_triage_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.state in ('accepted', 'dismissed', 'source_changed', 'expired', 'failed') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_ALREADY_FINAL';
  end if;
  if v_row.lease_token_hash is null or v_row.lease_token_hash <> p_lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_LEASE_MISMATCH';
  end if;
  if v_row.lease_expires_at is not null and v_row.lease_expires_at < now() then
    raise exception using errcode = '22023', message = 'PM_LEASE_EXPIRED';
  end if;

  update pim.ai_activity_triage
  set state = 'succeeded',
      action_label = p_action_label,
      result_payload = coalesce(p_result_payload, '{}'::jsonb),
      usage_payload = coalesce(p_usage_payload, '{}'::jsonb),
      error_code = p_error_code,
      lease_token_hash = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_triage_id;

  return p_triage_id;
end $$;

create or replace function pim.pm_fail_activity_triage_worker(
  p_triage_id uuid,
  p_lease_token_hash text,
  p_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row pim.ai_activity_triage%rowtype;
begin
  if p_error_code is null or length(p_error_code) > 64 then
    raise exception using errcode = '22023', message = 'PM_INVALID_ERROR_CODE';
  end if;

  select * into v_row
  from pim.ai_activity_triage
  where id = p_triage_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.state in ('accepted', 'dismissed', 'source_changed', 'expired', 'failed', 'succeeded') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_ALREADY_FINAL';
  end if;
  if v_row.lease_token_hash is null or v_row.lease_token_hash <> p_lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_LEASE_MISMATCH';
  end if;
  if v_row.lease_expires_at is not null and v_row.lease_expires_at < now() then
    raise exception using errcode = '22023', message = 'PM_LEASE_EXPIRED';
  end if;

  update pim.ai_activity_triage
  set
    -- Timeouts stay re-leaseable until the retry budget is spent; any other
    -- error is terminal. Late completion from the old lease is still rejected
    -- by the lease-token check on complete.
    state = case
      when p_error_code = 'timeout' and timeout_count < 2 then 'queued'
      else 'failed'
    end,
    error_code = p_error_code,
    timeout_count = case when p_error_code = 'timeout' then timeout_count + 1 else timeout_count end,
    lease_token_hash = null,
    lease_expires_at = null,
    lease_acquired_at = null,
    updated_at = now()
  where id = p_triage_id;

  return p_triage_id;
end $$;

revoke all on function pim.pm_complete_activity_triage_worker(uuid, text, text, jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function pim.pm_fail_activity_triage_worker(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function pim.pm_complete_activity_triage_worker(uuid, text, text, jsonb, jsonb, text) to pm_jev_triage_worker;
grant execute on function pim.pm_fail_activity_triage_worker(uuid, text, text) to pm_jev_triage_worker;

-- Private worker implementations execute only under pm_jev_triage_worker
-- (execute revoked from public/anon/authenticated/service_role). They stay
-- owned by the migration role so SECURITY DEFINER can reach the triage tables
-- without a SET ROLE membership grant; the worker reaches rows via the
-- grants and pm_ai_activity_triage*_worker_all policies above. This matches
-- the repo's established NOLOGIN-role pattern (hts_rag / dflow_prod).

-- ============================================================================
-- 9. Comment validation helper
-- ============================================================================

create or replace function pim.pm_validate_comment_body(p_body text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_body is null then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_REQUIRED';
  end if;
  v := btrim(p_body);
  if length(v) < 1 then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_EMPTY';
  end if;
  if length(v) > 4000 then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_TOO_LONG';
  end if;
  -- Reject NUL/controls except tab, newline, carriage return (issue allows those).
  if exists (
    select 1 from unnest(regexp_split_to_array(v, '')) as ch
    where ascii(ch) < 32 and ascii(ch) not in (9, 10, 13)
  ) then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_CONTROL_CHARS';
  end if;
  return v;
end $$;

revoke all on function pim.pm_validate_comment_body(text) from public, anon, authenticated, service_role;
grant execute on function pim.pm_validate_comment_body(text) to pm_jev_triage_worker;

-- ============================================================================
-- 10. api.pm_reserve_product_comment_operation
-- ============================================================================

create or replace function api.pm_reserve_product_comment_operation(
  p_product_id uuid,
  p_client_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_existing pim.ai_activity_triage_eligibility%rowtype;
  v_token text;
  v_token_hash text;
  v_handle text;
  v_row pim.ai_activity_triage_eligibility%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or p_client_operation_id is null then
    raise exception using errcode = '22023', message = 'PM_INVALID_RESERVATION';
  end if;
  if not exists (
    select 1 from pim.product p where p.id = p_product_id
  ) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;

  select * into v_existing
  from pim.ai_activity_triage_eligibility e
  where e.requester_profile_id = v_profile
    and e.client_operation_id = p_client_operation_id
  order by e.eligibility_version desc
  limit 1;

  if found and v_existing.eligibility_state = 'reserved' and v_existing.expires_at > now() then
    return jsonb_build_object(
      'status', 'reserved',
      'eligibility_id', v_existing.id,
      'client_operation_id', v_existing.client_operation_id,
      'expires_at', v_existing.expires_at
    );
  end if;

  if found and v_existing.eligibility_state = 'submitted' then
    return jsonb_build_object(
      'status', 'submitted',
      'eligibility_id', v_existing.id,
      'client_operation_id', v_existing.client_operation_id,
      'comment_id', v_existing.comment_id
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_token_hash := encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex');
  v_handle := v_token || '.' || v_token_hash;

  begin
    insert into pim.ai_activity_triage_eligibility (
      requester_profile_id, client_operation_id, eligibility_version,
      product_id, source_body_revision, eligibility_state,
      reservation_token_hash, recovery_handle_mac, expires_at
    ) values (
      v_profile, p_client_operation_id,
      coalesce((select max(e2.eligibility_version) from pim.ai_activity_triage_eligibility e2
                where e2.requester_profile_id = v_profile
                  and e2.client_operation_id = p_client_operation_id), 0) + 1,
      p_product_id, 1, 'reserved',
      v_token_hash, v_token_hash, now() + interval '7 days'
    )
    returning * into v_row;
  exception when unique_violation then
    -- Concurrent double-reserve returns the winner's reservation.
    select * into v_existing
    from pim.ai_activity_triage_eligibility e
    where e.requester_profile_id = v_profile
      and e.client_operation_id = p_client_operation_id
    order by e.eligibility_version desc
    limit 1;
    if found and v_existing.eligibility_state = 'reserved' and v_existing.expires_at > now() then
      return jsonb_build_object(
        'status', 'reserved',
        'eligibility_id', v_existing.id,
        'client_operation_id', v_existing.client_operation_id,
        'expires_at', v_existing.expires_at
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'status', 'reserved',
    'eligibility_id', v_row.id,
    'client_operation_id', v_row.client_operation_id,
    'recovery_handle', v_handle,
    'expires_at', v_row.expires_at
  );
end $$;

revoke all on function api.pm_reserve_product_comment_operation(uuid, uuid) from public, anon, service_role;
grant execute on function api.pm_reserve_product_comment_operation(uuid, uuid) to authenticated;

-- ============================================================================
-- 11. api.pm_add_product_comment
-- ============================================================================

create or replace function api.pm_add_product_comment(
  p_product_id uuid,
  p_body text,
  p_client_operation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_body text;
  v_comment_id uuid;
  v_revision integer;
  v_elig pim.ai_activity_triage_eligibility%rowtype;
  v_existing app.comment%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  v_body := pim.pm_validate_comment_body(p_body);

  if p_product_id is null then
    raise exception using errcode = '22023', message = 'PM_INVALID_PRODUCT';
  end if;
  if not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;

  if p_client_operation_id is not null then
    select * into v_existing
    from app.comment c
    where c.created_by_profile_id = v_profile
      and c.source_system = 'poppim-web-comment'
      and c.source_id = p_client_operation_id::text
      and c.target_schema = 'pim'
      and c.target_table = 'product'
      and c.target_id = p_product_id;
    if found then
      return jsonb_build_object(
        'status', 'replayed',
        'comment_id', v_existing.id,
        'body_revision', v_existing.body_revision,
        'client_operation_id', p_client_operation_id
      );
    end if;

    select * into v_elig
    from pim.ai_activity_triage_eligibility e
    where e.requester_profile_id = v_profile
      and e.client_operation_id = p_client_operation_id
      and e.eligibility_state = 'reserved'
      and e.expires_at > now()
    order by e.eligibility_version desc
    limit 1
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'PM_RESERVATION_REQUIRED';
    end if;
    if v_elig.product_id <> p_product_id then
      raise exception using errcode = '22023', message = 'PM_RESERVATION_PRODUCT_MISMATCH';
    end if;
  end if;

  begin
    insert into app.comment (
      target_schema, target_table, target_id, body,
      visibility, created_by_profile_id, source_system, source_id
    ) values (
      'pim', 'product', p_product_id, v_body,
      'internal', v_profile, 'poppim-web-comment',
      p_client_operation_id::text
    )
    returning id, body_revision into v_comment_id, v_revision;
  exception when unique_violation then
    -- Concurrent replay of the same client_operation_id returns the original row.
    select * into v_existing
    from app.comment c
    where c.created_by_profile_id = v_profile
      and c.source_system = 'poppim-web-comment'
      and c.source_id = p_client_operation_id::text
      and c.target_schema = 'pim'
      and c.target_table = 'product'
      and c.target_id = p_product_id;
    if found then
      return jsonb_build_object(
        'status', 'replayed',
        'comment_id', v_existing.id,
        'body_revision', v_existing.body_revision,
        'client_operation_id', p_client_operation_id
      );
    end if;
    raise;
  end;

  if p_client_operation_id is not null then
    update pim.ai_activity_triage_eligibility
    set eligibility_state = 'submitted',
        comment_id = v_comment_id,
        source_body_revision = v_revision,
        submitted_at = now(),
        updated_at = now()
    where id = v_elig.id;
  end if;

  return jsonb_build_object(
    'status', 'created',
    'comment_id', v_comment_id,
    'body_revision', v_revision,
    'client_operation_id', p_client_operation_id,
    'created_by_profile_id', v_profile
  );
end $$;

revoke all on function api.pm_add_product_comment(uuid, text, uuid) from public, anon, service_role;
grant execute on function api.pm_add_product_comment(uuid, text, uuid) to authenticated;

-- ============================================================================
-- 12. api.pm_cancel_product_comment_reservation
-- ============================================================================

create or replace function api.pm_cancel_product_comment_reservation(
  p_recovery_handle text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_token text;
  v_hash text;
  v_row pim.ai_activity_triage_eligibility%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_recovery_handle is null or position('.' in p_recovery_handle) < 2 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  v_token := split_part(p_recovery_handle, '.', 1);
  v_hash := encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex');

  select * into v_row
  from pim.ai_activity_triage_eligibility e
  where e.reservation_token_hash = v_hash
    and e.requester_profile_id = v_profile
  order by e.eligibility_version desc
  limit 1
  for update;

  if not found or v_row.eligibility_state <> 'reserved' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  update pim.ai_activity_triage_eligibility
  set eligibility_state = 'canceled',
      canceled_at = now(),
      updated_at = now()
  where id = v_row.id;

  return jsonb_build_object('status', 'canceled', 'eligibility_id', v_row.id);
end $$;

revoke all on function api.pm_cancel_product_comment_reservation(text) from public, anon, service_role;
grant execute on function api.pm_cancel_product_comment_reservation(text) to authenticated;

-- ============================================================================
-- 13. api.pm_recover_product_comment_handle
-- ============================================================================

create or replace function api.pm_recover_product_comment_handle(
  p_recovery_handle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_token text;
  v_hash text;
  v_row pim.ai_activity_triage_eligibility%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_recovery_handle is null or position('.' in p_recovery_handle) < 2 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  v_token := split_part(p_recovery_handle, '.', 1);
  v_hash := encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex');

  select * into v_row
  from pim.ai_activity_triage_eligibility e
  where e.reservation_token_hash = v_hash
    and e.requester_profile_id = v_profile
  order by e.eligibility_version desc
  limit 1;

  if not found
     or v_row.expires_at < now()
     or not exists (select 1 from pim.product p where p.id = v_row.product_id) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  return jsonb_build_object(
    'status', v_row.eligibility_state,
    'product_id', v_row.product_id,
    'eligibility_id', v_row.id,
    'client_operation_id', v_row.client_operation_id,
    'comment_id', v_row.comment_id
  );
end $$;

revoke all on function api.pm_recover_product_comment_handle(text) from public, anon, service_role;
grant execute on function api.pm_recover_product_comment_handle(text) to authenticated;

-- ============================================================================
-- 14. api.pm_begin_activity_triage
-- ============================================================================

create or replace function api.pm_begin_activity_triage(
  p_comment_id uuid,
  p_input_digest text,
  p_input_key_version text,
  p_model text,
  p_contract_version text,
  p_envelope jsonb default null,
  p_signature text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_comment app.comment%rowtype;
  v_existing pim.ai_activity_triage%rowtype;
  v_elig pim.ai_activity_triage_eligibility%rowtype;
  v_lease_hash text;
  v_lease_token text;
  v_row pim.ai_activity_triage%rowtype;
  v_recent integer;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();

  if p_comment_id is null or p_input_digest is null or p_input_key_version is null
     or p_model is null or p_contract_version is null then
    raise exception using errcode = '22023', message = 'PM_INVALID_TRIAGE_REQUEST';
  end if;

  if p_envelope is not null or p_signature is not null then
    if not pim.pm_verify_jev_hmac_envelope(p_envelope, p_signature) then
      raise exception using errcode = '22023', message = 'PM_ENVELOPE_INVALID';
    end if;
  end if;

  select * into v_comment
  from app.comment c
  where c.id = p_comment_id and c.created_by_profile_id = v_profile
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'PM_COMMENT_NOT_OWNED';
  end if;
  if v_comment.target_schema <> 'pim' or v_comment.target_table <> 'product' then
    raise exception using errcode = '22023', message = 'PM_COMMENT_TARGET_INVALID';
  end if;

  -- Serialize concurrent begins for this profile (rate limit + idempotency).
  perform pg_advisory_xact_lock(hashtext('pm_jev_begin:' || v_profile::text));

  select * into v_existing
  from pim.ai_activity_triage t
  where t.comment_id = p_comment_id
    and t.input_digest = p_input_digest
    and t.input_key_version = p_input_key_version
    and t.model = p_model
    and t.contract_version = p_contract_version
  for update;
  if found then
    -- Terminal outcomes never re-lease.
    if v_existing.state in ('accepted', 'dismissed', 'source_changed', 'failed', 'succeeded') then
      return jsonb_build_object(
        'status', 'existing',
        'triage_id', v_existing.id,
        'state', v_existing.state,
        'lease_acquired', false
      );
    end if;
    -- Re-lease a queued row (timeout retry) or take over an expired lease.
    -- Late completion from the old lease is rejected by the workers' lease check.
    if v_existing.state = 'queued'
       or (v_existing.state in ('leased', 'claimed')
           and v_existing.lease_expires_at is not null
           and v_existing.lease_expires_at < now()) then
      v_lease_token := encode(extensions.gen_random_bytes(16), 'hex');
      v_lease_hash := encode(extensions.digest(convert_to(v_lease_token, 'utf8'), 'sha256'), 'hex');
      update pim.ai_activity_triage t
      set state = 'leased',
          lease_token_hash = v_lease_hash,
          lease_expires_at = now() + interval '10 minutes',
          lease_acquired_at = now(),
          attempt_count = t.attempt_count + 1,
          updated_at = now()
      where t.id = v_existing.id
      returning * into v_row;
      return jsonb_build_object(
        'status', 'reclaimed',
        'triage_id', v_row.id,
        'lease_token', v_lease_token,
        'lease_token_hash', v_lease_hash,
        'state', v_row.state,
        'source_body_revision', v_row.source_body_revision
      );
    end if;
    return jsonb_build_object(
      'status', 'existing',
      'triage_id', v_existing.id,
      'state', v_existing.state,
      'lease_acquired', v_existing.state in ('leased', 'claimed')
        and v_existing.lease_expires_at is not null
        and v_existing.lease_expires_at >= now()
    );
  end if;

  -- Per-profile rolling request limit (50 per 24h) applies only when a new
  -- row would be created; re-fetching or reclaiming an existing row is free.
  select count(*) into v_recent
  from pim.ai_activity_triage t
  where t.requester_profile_id = v_profile
    and t.created_at > now() - interval '24 hours';
  if v_recent >= 50 then
    raise exception using errcode = '22023', message = 'PM_RATE_LIMITED';
  end if;

  insert into pim.ai_activity_triage_eligibility (
    requester_profile_id, client_operation_id, eligibility_version,
    comment_id, product_id, source_body_revision, eligibility_state
  ) values (
    v_profile, gen_random_uuid(), 1,
    p_comment_id, v_comment.target_id, v_comment.body_revision, 'queued'
  )
  returning * into v_elig;

  v_lease_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_lease_hash := encode(extensions.digest(convert_to(v_lease_token, 'utf8'), 'sha256'), 'hex');

  begin
    insert into pim.ai_activity_triage (
      eligibility_id, comment_id, requester_profile_id, product_id,
      source_body_revision, live_comment_id, live_product_id, live_requester_profile_id,
      input_digest, input_key_version, model, contract_version,
      state, lease_token_hash, lease_expires_at, lease_acquired_at, attempt_count
    ) values (
      v_elig.id, p_comment_id, v_profile, v_comment.target_id,
      v_comment.body_revision, p_comment_id, v_comment.target_id, v_profile,
      p_input_digest, p_input_key_version, p_model, p_contract_version,
      'leased', v_lease_hash, now() + interval '10 minutes', now(), 1
    )
    returning * into v_row;
  exception when unique_violation then
    -- Concurrent begin for the same idempotency key returns the existing row.
    select * into v_existing
    from pim.ai_activity_triage t
    where t.comment_id = p_comment_id
      and t.input_digest = p_input_digest
      and t.input_key_version = p_input_key_version
      and t.model = p_model
      and t.contract_version = p_contract_version
    for update;
    if found then
      return jsonb_build_object(
        'status', 'existing',
        'triage_id', v_existing.id,
        'state', v_existing.state,
        'lease_acquired', v_existing.state in ('leased', 'claimed')
          and v_existing.lease_expires_at is not null
          and v_existing.lease_expires_at >= now()
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'status', 'leased',
    'triage_id', v_row.id,
    'lease_token', v_lease_token,
    'lease_token_hash', v_lease_hash,
    'state', v_row.state,
    'source_body_revision', v_row.source_body_revision
  );
end $$;

revoke all on function api.pm_begin_activity_triage(uuid, text, text, text, text, jsonb, text) from public, anon, service_role;
grant execute on function api.pm_begin_activity_triage(uuid, text, text, text, text, jsonb, text) to authenticated;

-- ============================================================================
-- 15. Public complete / fail wrappers (original caller JWT + HMAC envelope)
-- ============================================================================

create or replace function api.pm_complete_activity_triage(
  p_triage_id uuid,
  p_lease_token_hash text,
  p_action_label text,
  p_result_payload jsonb default '{}'::jsonb,
  p_usage_payload jsonb default '{}'::jsonb,
  p_envelope jsonb default null,
  p_signature text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;

  if p_envelope is null or p_signature is null
     or not pim.pm_verify_jev_hmac_envelope(p_envelope, p_signature) then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_INVALID';
  end if;
  -- Bind envelope fields to this exact row and action (prevents cross-row replay).
  if (p_envelope ->> 'requester_profile_id') is distinct from v_row.requester_profile_id::text
     or (p_envelope ->> 'comment_id') is distinct from v_row.comment_id::text
     or (p_envelope ->> 'product_id') is distinct from v_row.product_id::text
     or (p_envelope ->> 'source_body_revision') is distinct from v_row.source_body_revision::text
     or (p_envelope ->> 'input_digest') is distinct from v_row.input_digest
     or (p_envelope ->> 'disposition') is distinct from p_action_label
     or (p_envelope ->> 'lease_token') is null
     or encode(extensions.digest(convert_to(p_envelope ->> 'lease_token', 'utf8'), 'sha256'), 'hex')
        is distinct from v_row.lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_ROW_MISMATCH';
  end if;

  perform pim.pm_complete_activity_triage_worker(
    p_triage_id, p_lease_token_hash, p_action_label, p_result_payload, p_usage_payload, null
  );

  return jsonb_build_object('status', 'succeeded', 'triage_id', p_triage_id);
end $$;

create or replace function api.pm_fail_activity_triage(
  p_triage_id uuid,
  p_lease_token_hash text,
  p_error_code text,
  p_envelope jsonb default null,
  p_signature text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
  v_state text;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;

  if p_envelope is null or p_signature is null
     or not pim.pm_verify_jev_hmac_envelope(p_envelope, p_signature) then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_INVALID';
  end if;
  if (p_envelope ->> 'requester_profile_id') is distinct from v_row.requester_profile_id::text
     or (p_envelope ->> 'comment_id') is distinct from v_row.comment_id::text
     or (p_envelope ->> 'product_id') is distinct from v_row.product_id::text
     or (p_envelope ->> 'source_body_revision') is distinct from v_row.source_body_revision::text
     or (p_envelope ->> 'input_digest') is distinct from v_row.input_digest
     or (p_envelope ->> 'lease_token') is null
     or encode(extensions.digest(convert_to(p_envelope ->> 'lease_token', 'utf8'), 'sha256'), 'hex')
        is distinct from v_row.lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_ROW_MISMATCH';
  end if;

  perform pim.pm_fail_activity_triage_worker(p_triage_id, p_lease_token_hash, p_error_code);

  select state into v_state from pim.ai_activity_triage where id = p_triage_id;
  return jsonb_build_object(
    'status', case when v_state = 'queued' then 'retryable' else 'failed' end,
    'triage_id', p_triage_id,
    'state', v_state
  );
end $$;

revoke all on function api.pm_complete_activity_triage(uuid, text, text, jsonb, jsonb, jsonb, text) from public, anon, service_role;
revoke all on function api.pm_fail_activity_triage(uuid, text, text, jsonb, text) from public, anon, service_role;
grant execute on function api.pm_complete_activity_triage(uuid, text, text, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function api.pm_fail_activity_triage(uuid, text, text, jsonb, text) to authenticated;

-- ============================================================================
-- 16. api.pm_get_activity_triage
-- ============================================================================

create or replace function api.pm_get_activity_triage(p_comment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t
  where t.comment_id = p_comment_id
    and t.requester_profile_id = v_profile
  order by t.created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('status', 'absent');
  end if;

  return jsonb_build_object(
    'status', 'found',
    'triage_id', v_row.id,
    'state', v_row.state,
    'action_label', v_row.action_label,
    'source_body_revision', v_row.source_body_revision,
    'reviewed_at', v_row.reviewed_at,
    'accepted_at', v_row.accepted_at,
    'dismissed_at', v_row.dismissed_at
  );
end $$;

revoke all on function api.pm_get_activity_triage(uuid) from public, anon, service_role;
grant execute on function api.pm_get_activity_triage(uuid) to authenticated;

-- ============================================================================
-- 17. Operations RPCs (Jev-independent)
-- ============================================================================

create or replace function api.pm_create_dependency(
  p_product_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_title text;
  v_id uuid;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;
  v_title := btrim(p_title);
  if v_title is null or length(v_title) < 1 or length(v_title) > 200 then
    raise exception using errcode = '22023', message = 'PM_INVALID_DEPENDENCY_TITLE';
  end if;
  if exists (select 1 from unnest(regexp_split_to_array(v_title, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;

  insert into app.activity (target_schema, target_table, target_id, action, summary, payload, actor_profile_id)
  values (
    'pim', 'product', p_product_id, 'pm_dependency', v_title,
    jsonb_build_object('kind', 'dependency', 'type', 'blocked_by', 'title', v_title, 'status', 'open'),
    v_profile
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id, 'kind', 'dependency', 'title', v_title);
end $$;

create or replace function api.pm_create_decision(
  p_product_id uuid,
  p_type text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_type text;
  v_notes text;
  v_id uuid;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;
  v_type := btrim(p_type);
  if v_type is null or length(v_type) < 1 or length(v_type) > 100 then
    raise exception using errcode = '22023', message = 'PM_INVALID_DECISION_TYPE';
  end if;
  if exists (select 1 from unnest(regexp_split_to_array(v_type, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and length(v_notes) > 2000 then
    raise exception using errcode = '22023', message = 'PM_INVALID_DECISION_NOTES';
  end if;
  if v_notes is not null and exists (select 1 from unnest(regexp_split_to_array(v_notes, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;

  insert into app.activity (target_schema, target_table, target_id, action, summary, payload, actor_profile_id)
  values (
    'pim', 'product', p_product_id, 'pm_decision', v_type,
    jsonb_build_object('kind', 'decision', 'type', v_type, 'notes', v_notes, 'status', 'decided'),
    v_profile
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id, 'kind', 'decision', 'type', v_type);
end $$;

create or replace function api.pm_create_reminder(
  p_product_id uuid,
  p_title text,
  p_due_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_title text;
  v_id uuid;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;
  v_title := btrim(p_title);
  if v_title is null or length(v_title) < 1 or length(v_title) > 200 then
    raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_TITLE';
  end if;
  if exists (select 1 from unnest(regexp_split_to_array(v_title, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;
  if p_due_at is not null and p_due_at < date '2000-01-01' then
    raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_DUE';
  end if;

  insert into app.notification (profile_id, app, target_schema, target_table, target_id, title, body, payload)
  values (
    v_profile, 'pm', 'pim', 'product', p_product_id, v_title, null,
    jsonb_build_object(
      'kind', 'reminder',
      'title', v_title,
      'due_at', case when p_due_at is null then null else to_char(p_due_at, 'YYYY-MM-DD') end,
      'status', 'open',
      'reminder_type', 'follow_up'
    )
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id, 'kind', 'reminder', 'title', v_title);
end $$;

create or replace function api.pm_update_dependency_status(
  p_activity_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row app.activity%rowtype;
  v_status text;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  v_status := lower(btrim(p_status));
  if v_status is null or v_status not in ('open', 'waiting', 'resolved', 'canceled') then
    raise exception using errcode = '22023', message = 'PM_INVALID_DEPENDENCY_STATUS';
  end if;

  select * into v_row from app.activity a where a.id = p_activity_id for update;
  if not found or v_row.action <> 'pm_dependency' then
    raise exception using errcode = 'P0002', message = 'PM_DEPENDENCY_NOT_FOUND';
  end if;

  update app.activity
  set payload = payload || jsonb_build_object('status', v_status)
  where id = p_activity_id;

  return jsonb_build_object('status', v_status, 'id', p_activity_id);
end $$;

create or replace function api.pm_update_reminder_status(
  p_notification_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row app.notification%rowtype;
  v_status text;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  v_status := lower(btrim(p_status));
  if v_status is null or v_status not in ('open', 'snoozed', 'done', 'canceled') then
    raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_STATUS';
  end if;

  select * into v_row from app.notification n where n.id = p_notification_id for update;
  if not found or v_row.app <> 'pm' or v_row.profile_id <> v_profile then
    raise exception using errcode = 'P0002', message = 'PM_REMINDER_NOT_FOUND';
  end if;

  update app.notification
  set payload = payload || jsonb_build_object('status', v_status),
      read_at = case when v_status in ('done', 'canceled') then now() else read_at end
  where id = p_notification_id;

  return jsonb_build_object('status', v_status, 'id', p_notification_id);
end $$;

revoke all on function api.pm_create_dependency(uuid, text) from public, anon, service_role;
revoke all on function api.pm_create_decision(uuid, text, text) from public, anon, service_role;
revoke all on function api.pm_create_reminder(uuid, text, date) from public, anon, service_role;
revoke all on function api.pm_update_dependency_status(uuid, text) from public, anon, service_role;
revoke all on function api.pm_update_reminder_status(uuid, text) from public, anon, service_role;
grant execute on function api.pm_create_dependency(uuid, text) to authenticated;
grant execute on function api.pm_create_decision(uuid, text, text) to authenticated;
grant execute on function api.pm_create_reminder(uuid, text, date) to authenticated;
grant execute on function api.pm_update_dependency_status(uuid, text) to authenticated;
grant execute on function api.pm_update_reminder_status(uuid, text) to authenticated;

-- ============================================================================
-- 18. Accept / dismiss
-- ============================================================================

create or replace function api.pm_accept_activity_triage(
  p_triage_id uuid,
  p_title text default null,
  p_type text default null,
  p_notes text default null,
  p_due_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
  v_comment app.comment%rowtype;
  v_record_id uuid;
  v_kind text;
  v_result jsonb;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;
  if v_row.state in ('accepted', 'dismissed', 'source_changed', 'expired') then
    return jsonb_build_object(
      'status', case when v_row.state = 'accepted' then 'already_accepted'
                     when v_row.state = 'dismissed' then 'already_dismissed'
                     else v_row.state end,
      'triage_id', v_row.id,
      'created_record_table', v_row.created_record_table,
      'created_record_id', v_row.created_record_id
    );
  end if;
  if v_row.state <> 'succeeded' or v_row.action_label is null then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_NOT_ACTIONABLE';
  end if;
  if v_row.action_label in ('routine_update', 'unclear') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_NOT_ACTIONABLE';
  end if;

  select * into v_comment
  from app.comment c where c.id = v_row.comment_id;
  if not found or v_comment.body_revision <> v_row.source_body_revision then
    update pim.ai_activity_triage
    set state = 'source_changed', updated_at = now()
    where id = p_triage_id;
    return jsonb_build_object('status', 'source_changed', 'triage_id', p_triage_id);
  end if;

  v_kind := v_row.action_label;
  if v_kind = 'blocker_dependency' then
    if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 200 then
      raise exception using errcode = '22023', message = 'PM_INVALID_DEPENDENCY_TITLE';
    end if;
    v_result := api.pm_create_dependency(v_row.product_id, btrim(p_title));
    v_record_id := (v_result ->> 'id')::uuid;
  elsif v_kind = 'decision' then
    if p_type is null or length(btrim(p_type)) < 1 or length(btrim(p_type)) > 100 then
      raise exception using errcode = '22023', message = 'PM_INVALID_DECISION_TYPE';
    end if;
    v_result := api.pm_create_decision(v_row.product_id, btrim(p_type), p_notes);
    v_record_id := (v_result ->> 'id')::uuid;
  elsif v_kind = 'follow_up_reminder' then
    if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 200 then
      raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_TITLE';
    end if;
    v_result := api.pm_create_reminder(v_row.product_id, btrim(p_title), p_due_at);
    v_record_id := (v_result ->> 'id')::uuid;
  else
    raise exception using errcode = '22023', message = 'PM_TRIAGE_NOT_ACTIONABLE';
  end if;

  update pim.ai_activity_triage
  set state = 'accepted',
      accepted_at = now(),
      reviewed_at = now(),
      reviewed_by_profile_id = v_profile,
      created_record_table = case when v_kind = 'follow_up_reminder' then 'app.notification' else 'app.activity' end,
      created_record_id = v_record_id,
      updated_at = now()
  where id = p_triage_id;

  return jsonb_build_object(
    'status', 'accepted',
    'triage_id', p_triage_id,
    'created_record_table', case when v_kind = 'follow_up_reminder' then 'app.notification' else 'app.activity' end,
    'created_record_id', v_record_id
  );
end $$;

create or replace function api.pm_dismiss_activity_triage(p_triage_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;
  if v_row.state = 'dismissed' then
    return jsonb_build_object('status', 'already_dismissed', 'triage_id', p_triage_id);
  end if;
  if v_row.state in ('accepted', 'source_changed', 'expired') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_ALREADY_FINAL';
  end if;

  update pim.ai_activity_triage
  set state = 'dismissed',
      dismissed_at = now(),
      reviewed_at = now(),
      reviewed_by_profile_id = v_profile,
      lease_token_hash = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_triage_id;

  return jsonb_build_object('status', 'dismissed', 'triage_id', p_triage_id);
end $$;

revoke all on function api.pm_accept_activity_triage(uuid, text, text, text, date) from public, anon, service_role;
revoke all on function api.pm_dismiss_activity_triage(uuid) from public, anon, service_role;
grant execute on function api.pm_accept_activity_triage(uuid, text, text, text, date) to authenticated;
grant execute on function api.pm_dismiss_activity_triage(uuid) to authenticated;

-- ============================================================================
-- 19. Runtime fence
-- ============================================================================

create or replace function api.pm_verify_jev_runtime_fence(
  p_triage_id uuid,
  p_lease_token_hash text,
  p_release_digest text,
  p_emergency_generation integer,
  p_timestamp timestamptz,
  p_nonce text,
  p_signature text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
  v_key text;
  v_canon text;
  v_expected text;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t where t.id = p_triage_id;
  if not found or v_row.requester_profile_id <> v_profile then
    return jsonb_build_object('allowed', false, 'reason', 'unavailable');
  end if;
  if v_row.state not in ('claimed', 'leased') then
    return jsonb_build_object('allowed', false, 'reason', 'state');
  end if;
  if v_row.lease_token_hash is null or v_row.lease_token_hash <> p_lease_token_hash then
    return jsonb_build_object('allowed', false, 'reason', 'lease');
  end if;
  if p_signature is null or length(btrim(p_signature)) < 32 then
    return jsonb_build_object('allowed', false, 'reason', 'signature');
  end if;
  if p_timestamp is null or p_timestamp < now() - interval '5 minutes'
     or p_timestamp > now() + interval '5 minutes' then
    return jsonb_build_object('allowed', false, 'reason', 'expired');
  end if;
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'jev_envelope_hmac_key';
  exception when others then
    return jsonb_build_object('allowed', false, 'reason', 'key_unavailable');
  end;
  if v_key is null or length(v_key) < 16 then
    return jsonb_build_object('allowed', false, 'reason', 'key_unavailable');
  end if;
  v_canon := 'fence|' || p_triage_id::text || '|' || coalesce(p_lease_token_hash, '') || '|'
    || coalesce(p_release_digest, '') || '|' || coalesce(p_emergency_generation::text, '') || '|'
    || extract(epoch from p_timestamp)::text || '|' || coalesce(p_nonce, '');
  v_expected := encode(extensions.hmac(convert_to(v_canon, 'utf8'), convert_to(v_key, 'utf8'), 'sha256'), 'hex');
  if v_expected <> lower(btrim(p_signature)) then
    return jsonb_build_object('allowed', false, 'reason', 'signature');
  end if;

  return jsonb_build_object('allowed', true, 'emergency_generation', 0);
end $$;

revoke all on function api.pm_verify_jev_runtime_fence(uuid, text, text, integer, timestamptz, text, text) from public, anon, service_role;
grant execute on function api.pm_verify_jev_runtime_fence(uuid, text, text, integer, timestamptz, text, text) to authenticated;

-- ============================================================================
-- 20. Recovery pages / impression / repair
-- ============================================================================

create or replace function api.pm_list_active_jev_triage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'triage_id', t.id,
      'comment_id', t.comment_id,
      'state', t.state,
      'action_label', t.action_label,
      'source_body_revision', t.source_body_revision,
      'created_at', t.created_at
    ) order by t.created_at desc)
    from pim.ai_activity_triage t
    where t.requester_profile_id = v_profile
      and t.state in ('queued', 'claimed', 'leased', 'succeeded')
  ), '[]'::jsonb);
end $$;

create or replace function api.pm_list_reviewed_jev_triage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'triage_id', t.id,
      'comment_id', t.comment_id,
      'state', t.state,
      'action_label', t.action_label,
      'reviewed_at', t.reviewed_at,
      'accepted_at', t.accepted_at,
      'dismissed_at', t.dismissed_at
    ) order by coalesce(t.reviewed_at, t.updated_at) desc)
    from pim.ai_activity_triage t
    where t.requester_profile_id = v_profile
      and t.state in ('accepted', 'dismissed', 'source_changed', 'expired', 'failed')
  ), '[]'::jsonb);
end $$;

create or replace function api.pm_record_jev_suggestion_impression(p_triage_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  update pim.ai_activity_triage
  set first_impression_at = coalesce(first_impression_at, now()),
      updated_at = now()
  where id = p_triage_id
    and requester_profile_id = v_profile
    and first_impression_at is null;

  if found then
    return jsonb_build_object('status', 'recorded');
  end if;
  if exists (
    select 1 from pim.ai_activity_triage t
    where t.id = p_triage_id and t.requester_profile_id = v_profile
  ) then
    return jsonb_build_object('status', 'already_recorded');
  end if;
  return jsonb_build_object('status', 'unavailable');
end $$;

create or replace function api.pm_repair_comment_triage_queue()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_changed integer := 0;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  update pim.ai_activity_triage t
  set state = 'source_changed',
      lease_token_hash = null,
      lease_expires_at = null,
      updated_at = now()
  from app.comment c
  where t.live_comment_id = c.id
    and t.requester_profile_id = v_profile
    and t.state in ('queued', 'claimed', 'leased', 'succeeded')
    and c.body_revision is distinct from t.source_body_revision;

  get diagnostics v_changed = row_count;
  return jsonb_build_object('status', 'repaired', 'source_changed_count', v_changed);
end $$;

revoke all on function api.pm_list_active_jev_triage() from public, anon, service_role;
revoke all on function api.pm_list_reviewed_jev_triage() from public, anon, service_role;
revoke all on function api.pm_record_jev_suggestion_impression(uuid) from public, anon, service_role;
revoke all on function api.pm_repair_comment_triage_queue() from public, anon, service_role;
grant execute on function api.pm_list_active_jev_triage() to authenticated;
grant execute on function api.pm_list_reviewed_jev_triage() to authenticated;
grant execute on function api.pm_record_jev_suggestion_impression(uuid) to authenticated;
grant execute on function api.pm_repair_comment_triage_queue() to authenticated;

-- ============================================================================
-- 21. body_revision bump marks unreviewed non-final triage source_changed
-- ============================================================================

create or replace function pim.pm_jev_source_changed_trg_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    update pim.ai_activity_triage
    set state = 'source_changed',
        lease_token_hash = null,
        lease_expires_at = null,
        updated_at = now()
    where live_comment_id = new.id
      and state in ('queued', 'claimed', 'leased', 'succeeded');
    update pim.ai_activity_triage_eligibility
    set eligibility_state = 'source_changed',
        updated_at = now()
    where comment_id = new.id
      and eligibility_state in ('reserved', 'submitted', 'queued');
  end if;
  return new;
end $$;

revoke all on function pim.pm_jev_source_changed_trg_fn() from public, anon, authenticated, service_role;

drop trigger if exists pm_jev_source_changed on app.comment;
create trigger pm_jev_source_changed
  after update of body on app.comment
  for each row execute function pim.pm_jev_source_changed_trg_fn();




