-- DB Data Admin Delivery Step 8: protected single-record update contracts.
--
-- Additive only. No existing application contract, table, grant, policy, or ERP
-- relocation object is altered. The only replaced object is
-- api.db_data_admin_audit_list, re-created with an identical signature (overload-free)
-- to append one additive jsonb key (actor_label) for the Step 8 detail display; the
-- Step 7 frontend does not consume this function yet.
--
-- What this migration adds:
--   * app.db_data_admin_feature_gate: environment-level write gate. ONE gate covers
--     ALL Step 8 single-record writes (display_name, global status, per-app status,
--     and Customer Channels). The product specification requires only status writes to
--     be production-gated; the owner directed on 2026-07-22 that every Step 8 write
--     type stay disabled until the gate is enabled, which is strictly safer and is
--     what is implemented and tested here. The gate is DATA, not DDL, so this same
--     migration promotes safely: it seeds disabled, Codex enables it on the preview
--     branch with one operational UPDATE, and production stays disabled until the
--     Step 11 consumer-enforcement gate passes (spec Step 13).
--   * api.db_data_admin_update_customer / api.db_data_admin_update_vendor: whitelisted
--     single-record updates with an explicit typed-parameter whitelist (never
--     arbitrary table/column/json paths), optimistic concurrency on the core row's
--     updated_at, client operation-UUID idempotency, structured committed
--     expected-failure results, and immutable audit events for successes and
--     authorized expected failures.
--   * Private row-projection helpers so the update result and conflict results carry
--     the same approved field shape the grid consumes, plus per-app
--     status_changed_at evidence.
--
-- Editable whitelist (everything else fails closed):
--   Customer: display_name (shared curation); global status active|potential|inactive
--     (archived/deleted rejected as system/legacy); per-app crm|pm|dam binary status
--     with reason/actor/time on the existing typed extension columns; controlled
--     Channel replacement with validated active channel UUIDs.
--   Vendor (core.factory; UI says Vendor): display_name; global status; per-app
--     crm|pm|dam binary status. No Channels.
-- Refused here: name/code (source vocabulary), is_potential (trigger-owned), PLM
-- status (DesignFlow single writer; Vendor PLM has no Factory mapping), aliases,
-- source refs, related Customer, Licensor/Property, merge, bulk, deletion.
--
-- Authorization: every call requires BOTH the administrator role AND an explicit,
-- non-revoked `admin` app_access row via app.require_db_data_admin_access(). Denials
-- raise insufficient_privilege and write no audit row. Each function is SECURITY
-- DEFINER with a pinned search_path, fully qualified objects, EXECUTE revoked from
-- public, and granted only to authenticated. No browser role receives any direct
-- table grant. No dynamic SQL: the per-app extension table is chosen by if/elsif on
-- the whitelisted p_app value. Note the deliberate mapping: the app ENUM value is
-- 'pm' while the physical extension schema is 'pim' (p_app='pm' -> pim.*_ext).
--
-- Concurrency: one core-row updated_at token per record. After validation and
-- change-set computation (so a no-op writes nothing), the function performs
--   update core.<entity> set updated_at = now() where id = p_id and updated_at = p_expected
-- which is simultaneously the optimistic-token check, the row lock, and the token
-- bump for every admin write including extension-only writes. A mismatch returns
-- code='stale_token' with the fresh row in `current` and commits a failure audit row.
--
-- Idempotency: the client-generated p_operation_id is recorded in
-- app.db_data_admin_audit_event (unique (operation_id, operation_item_key); Step 8
-- always uses item key 'primary'). A retry returns the recorded outcome with
-- idempotent_replay=true and never re-applies, regardless of gate state.
--
-- Expected vs unexpected failures: expected authorized business failures
-- (validation, not_found, stale_token, no_changes, writes_disabled) return
-- success=false, commit a failure audit row whenever the entity id and operation id
-- are both present (the audit table requires both), and roll nothing back. Unexpected
-- exceptions raise, roll back the whole operation including the audit insert, and are
-- evidenced in platform logs.
--
-- Reactivation: setting a per-app status back to 'active' clears the ext row's
-- status_reason and refreshes status_changed_at/status_changed_by, per spec section
-- 5; the immutable audit old/new snapshots retain the former reason and actor.
-- Global status has no typed reason columns by design (spec section 5 assigns them
-- only to per-app extension rows); global reason/actor/time live in the audit ledger.
--
-- dam.customer_ext intentionally gains NO new check constraints in this migration:
-- the RPC enforces the same inactive-reason/binary-status invariants on every write,
-- and constraint hardening is deferred to a separately preview-proven change.
--
-- Row payloads from the Step 6 list contracts are intentionally NOT changed; fresh
-- per-app status evidence returns in the update result row, and history is served by
-- the audit read extended below.

-- ---------------------------------------------------------------------------
-- Feature gate: seeded disabled; preview is enabled later by operational DML only.
-- ---------------------------------------------------------------------------

create table app.db_data_admin_feature_gate (
  feature text primary key check (btrim(feature) <> ''),
  enabled boolean not null,
  notes text,
  updated_at timestamptz not null default now()
);

comment on table app.db_data_admin_feature_gate is
  'Environment-level DB Data Admin write gates. Data, not DDL, so preview and production differ after the same migration. Browser roles have no access; flipped only by operational DML.';

create trigger set_updated_at before update on app.db_data_admin_feature_gate
  for each row execute function app.set_updated_at();

alter table app.db_data_admin_feature_gate enable row level security;
revoke all on app.db_data_admin_feature_gate from public, anon, authenticated;
grant all on app.db_data_admin_feature_gate to service_role;

insert into app.db_data_admin_feature_gate (feature, enabled, notes) values (
  'single_record_write',
  false,
  'Step 8 single-record updates (display_name, global status, per-app status, Customer Channels). Enable on preview only until DB_Data_Admin.md Step 11 consumer enforcement passes; production enablement is a Step 13 decision.'
);

create or replace function app.db_data_admin_single_record_writes_enabled()
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select coalesce((
    select g.enabled
    from app.db_data_admin_feature_gate g
    where g.feature = 'single_record_write'
  ), false);
$$;

comment on function app.db_data_admin_single_record_writes_enabled() is
  'Private DB Data Admin helper. True only when the single_record_write feature gate row exists and is enabled. Called inside the protected update RPCs.';

revoke all on function app.db_data_admin_single_record_writes_enabled() from public;

-- ---------------------------------------------------------------------------
-- Private single-row projections: the approved field shape returned by the update
-- RPCs (success `row` and expected-failure `current`). Superset of the Step 6 list
-- row: adds per-app status_changed_at. Never callable by browser roles.
-- ---------------------------------------------------------------------------

create or replace function app.db_data_admin_customer_row(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_row jsonb;
begin
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'display_name', c.display_name,
    'status', c.status::text,
    'is_potential', c.is_potential,
    'domain', c.domain,
    'channels', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', ch.id, 'code', ch.code, 'name', ch.name)
        order by ch.sort_order, lower(ch.name)
      )
      from core.customer_channel cc
      join core.channel ch on ch.id = cc.channel_id
      where cc.customer_id = c.id
    ), '[]'::jsonb),
    'crm_status', coalesce(crmx.status, 'active'::app.entity_status)::text,
    'crm_status_reason', crmx.status_reason,
    'crm_status_changed_at', crmx.status_changed_at,
    'pm_status', coalesce(pimx.status, 'active'::app.entity_status)::text,
    'pm_status_reason', pimx.status_reason,
    'pm_status_changed_at', pimx.status_changed_at,
    'dam_status', coalesce(damx.status, 'active'::app.entity_status)::text,
    'dam_status_reason', damx.status_reason,
    'dam_status_changed_at', damx.status_changed_at,
    'plm_linked', exists (
      select 1
      from core.company_source_ref plr
      where plr.company_id = c.id
        and plr.source_system = 'designflow_plm'
    ),
    'plm_status', app.db_data_admin_latest_plm_customer_status(c.id),
    'erp_active', (
      select bool_or(e.active)
      from plm.erp_customer e
      where e.customer_id = c.id
    ),
    'alias_count', (
      select count(*)::integer
      from core.customer_alias a
      where a.customer_id = c.id
    ),
    'source_refs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source_system', r.source_system,
          'source_table', r.source_table,
          'source_id', r.source_id,
          'source_code', r.source_code,
          'source_name', r.source_name
        )
        order by r.source_system, r.source_table, r.source_id
      )
      from core.company_source_ref r
      where r.company_id = c.id
    ), '[]'::jsonb),
    'updated_at', c.updated_at
  ) into v_row
  from core.customer c
  left join crm.customer_ext crmx on crmx.customer_id = c.id
  left join pim.customer_ext pimx on pimx.customer_id = c.id
  left join dam.customer_ext damx on damx.customer_id = c.id
  where c.id = p_id;

  return v_row;
end;
$$;

comment on function app.db_data_admin_customer_row(uuid) is
  'Private DB Data Admin helper. Approved single-Customer projection for update results; NULL when the record does not exist.';

revoke all on function app.db_data_admin_customer_row(uuid) from public;

create or replace function app.db_data_admin_vendor_row(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_row jsonb;
begin
  select jsonb_build_object(
    'id', f.id,
    'name', f.name,
    'display_name', f.display_name,
    'code', f.code,
    'status', f.status::text,
    'country', f.country,
    'vendor_group', f.vendor_group,
    'company_id', f.company_id,
    'company_label', (
      select coalesce(cc.display_name, cc.name)
      from core.customer cc
      where cc.id = f.company_id
    ),
    'crm_status', coalesce(crmx.status, 'active'::app.entity_status)::text,
    'crm_status_reason', crmx.status_reason,
    'crm_status_changed_at', crmx.status_changed_at,
    'pm_status', coalesce(pimx.status, 'active'::app.entity_status)::text,
    'pm_status_reason', pimx.status_reason,
    'pm_status_changed_at', pimx.status_changed_at,
    'dam_status', coalesce(damx.status, 'active'::app.entity_status)::text,
    'dam_status_reason', damx.status_reason,
    'dam_status_changed_at', damx.status_changed_at,
    'plm_linked', exists (
      select 1
      from core.factory_source_ref plr
      where plr.factory_id = f.id
        and plr.source_system = 'designflow_plm'
    ),
    'plm_status', null::text,
    'erp_active', (
      select bool_or(e.active)
      from plm.erp_vendor e
      where e.factory_id = f.id
    ),
    'alias_count', (
      select count(*)::integer
      from core.factory_alias a
      where a.factory_id = f.id
    ),
    -- core.factory_source_ref has no source_name column; identity is
    -- source_system/source_table/source_id/source_code only.
    'source_refs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source_system', r.source_system,
          'source_table', r.source_table,
          'source_id', r.source_id,
          'source_code', r.source_code
        )
        order by r.source_system, r.source_table, r.source_id
      )
      from core.factory_source_ref r
      where r.factory_id = f.id
    ), '[]'::jsonb),
    'updated_at', f.updated_at
  ) into v_row
  from core.factory f
  left join crm.factory_ext crmx on crmx.factory_id = f.id
  left join pim.factory_ext pimx on pimx.factory_id = f.id
  left join dam.factory_ext damx on damx.factory_id = f.id
  where f.id = p_id;

  return v_row;
end;
$$;

comment on function app.db_data_admin_vendor_row(uuid) is
  'Private DB Data Admin helper. Approved single-Vendor projection for update results; NULL when the record does not exist. Vendor PLM status stays null until DesignFlow Factory mapping exists.';

revoke all on function app.db_data_admin_vendor_row(uuid) from public;

-- ---------------------------------------------------------------------------
-- Customer single-record update.
-- ---------------------------------------------------------------------------

create or replace function api.db_data_admin_update_customer(
  p_customer_id uuid,
  p_expected_updated_at timestamptz,
  p_operation_id uuid,
  p_reason text,
  p_display_name text default null,
  p_status text default null,
  p_app text default null,
  p_app_status text default null,
  p_channel_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_actor uuid;
  v_replay_id uuid;
  v_replay_succeeded boolean;
  v_replay_error_code text;
  v_replay_error_detail jsonb;
  v_replay_entity uuid;
  v_code text;
  v_message text;
  v_audit_id uuid;
  v_cur_status app.entity_status;
  v_cur_display text;
  v_status app.entity_status;
  v_display text;
  v_old_app_status app.entity_status;
  v_old_app_reason text;
  v_old_channels uuid[];
  v_new_channels uuid[];
  v_bad_channels integer;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  perform app.require_db_data_admin_access();
  v_actor := app.current_profile_id();

  -- Idempotent replay: the client operation UUID is the idempotency key. A retry
  -- returns the recorded outcome and never re-applies, even if the gate changed.
  if p_operation_id is not null then
    select e.id, e.succeeded, e.error_code, e.error_detail, e.entity_id
    into v_replay_id, v_replay_succeeded, v_replay_error_code, v_replay_error_detail,
         v_replay_entity
    from app.db_data_admin_audit_event e
    where e.operation_id = p_operation_id
      and e.operation_item_key = 'primary';
    if found then
      return jsonb_build_object(
        'success', v_replay_succeeded,
        'operation_id', p_operation_id,
        'audit_id', v_replay_id,
        'idempotent_replay', true,
        'code', v_replay_error_code,
        'message', v_replay_error_detail ->> 'message',
        'row', app.db_data_admin_customer_row(v_replay_entity)
      );
    end if;
  end if;

  -- Validation. Fail closed with a structured result; the shared epilogue below
  -- commits a failure audit row when the entity and operation are identifiable.
  if p_customer_id is null then
    v_code := 'validation_failed'; v_message := 'customer id is required';
  elsif p_operation_id is null then
    v_code := 'validation_failed'; v_message := 'operation id is required';
  elsif p_expected_updated_at is null then
    v_code := 'validation_failed'; v_message := 'expected updated_at is required';
  elsif nullif(btrim(coalesce(p_reason, '')), '') is null then
    v_code := 'validation_failed'; v_message := 'reason is required';
  elsif p_status is not null and p_status not in ('active', 'potential', 'inactive') then
    v_code := 'validation_failed';
    v_message := 'status must be active, potential, or inactive; archived and deleted are system states';
  elsif p_app is not null and p_app not in ('crm', 'pm', 'dam') then
    v_code := 'validation_failed';
    v_message := 'app must be crm, pm, or dam; plm status is read-only context';
  elsif p_app is not null and p_app_status is null then
    v_code := 'validation_failed'; v_message := 'app status is required when app is given';
  elsif p_app is null and p_app_status is not null then
    v_code := 'validation_failed'; v_message := 'app status requires an app';
  elsif p_app_status is not null and p_app_status not in ('active', 'inactive') then
    v_code := 'validation_failed'; v_message := 'app status must be active or inactive';
  end if;

  if v_code is null and p_channel_ids is not null then
    select count(*) into v_bad_channels
    from (select distinct unnest(p_channel_ids) as channel_id) ids
    where not exists (
      select 1
      from core.channel ch
      where ch.id = ids.channel_id
        and ch.status = 'active'::app.entity_status
    );
    if v_bad_channels > 0 then
      v_code := 'validation_failed';
      v_message := 'every channel id must reference an active channel';
    end if;
  end if;

  -- Environment gate: ALL Step 8 single-record writes are disabled until the gate
  -- is enabled (preview only, by operational DML; production stays disabled).
  if v_code is null and not app.db_data_admin_single_record_writes_enabled() then
    v_code := 'writes_disabled';
    v_message := 'single-record writes are disabled in this environment';
  end if;

  -- Existence.
  if v_code is null then
    select c.status, c.display_name
    into v_cur_status, v_cur_display
    from core.customer c
    where c.id = p_customer_id;
    if not found then
      v_code := 'not_found'; v_message := 'customer not found';
    end if;
  end if;

  -- Change-set computation happens BEFORE any write so a no-op touches nothing.
  if v_code is null then
    -- display_name: null param = unchanged; blank/whitespace clears to NULL (the
    -- serving layer falls back to name); any other value is trimmed.
    if p_display_name is not null then
      v_display := nullif(btrim(p_display_name), '');
      if v_display is distinct from v_cur_display then
        v_old := v_old || jsonb_build_object('display_name', v_cur_display);
        v_new := v_new || jsonb_build_object('display_name', v_display);
      end if;
    end if;

    if p_status is not null and p_status <> v_cur_status::text then
      v_status := p_status::app.entity_status;
      v_old := v_old || jsonb_build_object('status', v_cur_status::text);
      v_new := v_new || jsonb_build_object('status', p_status);
    end if;

    if p_app is not null then
      -- App enum value 'pm' maps to the physical pim schema.
      if p_app = 'crm' then
        select x.status, x.status_reason
        into v_old_app_status, v_old_app_reason
        from crm.customer_ext x
        where x.customer_id = p_customer_id;
      elsif p_app = 'pm' then
        select x.status, x.status_reason
        into v_old_app_status, v_old_app_reason
        from pim.customer_ext x
        where x.customer_id = p_customer_id;
      else
        select x.status, x.status_reason
        into v_old_app_status, v_old_app_reason
        from dam.customer_ext x
        where x.customer_id = p_customer_id;
      end if;
      v_old_app_status := coalesce(v_old_app_status, 'active'::app.entity_status);
      if p_app_status <> v_old_app_status::text then
        v_old := v_old || jsonb_build_object(
          p_app || '_status', v_old_app_status::text,
          p_app || '_status_reason', v_old_app_reason
        );
        v_new := v_new || jsonb_build_object(
          p_app || '_status', p_app_status,
          p_app || '_status_reason',
          case when p_app_status = 'inactive' then btrim(p_reason) else null end
        );
      end if;
    end if;

    if p_channel_ids is not null then
      select coalesce(array_agg(cc.channel_id order by cc.channel_id), array[]::uuid[])
      into v_old_channels
      from core.customer_channel cc
      where cc.customer_id = p_customer_id;
      select coalesce(array_agg(ids.channel_id order by ids.channel_id), array[]::uuid[])
      into v_new_channels
      from (select distinct unnest(p_channel_ids) as channel_id) ids;
      if v_old_channels is distinct from v_new_channels then
        v_old := v_old || jsonb_build_object('channels', (
          select coalesce(jsonb_agg(x order by x), '[]'::jsonb)
          from unnest(v_old_channels) as x
        ));
        v_new := v_new || jsonb_build_object('channels', (
          select coalesce(jsonb_agg(x order by x), '[]'::jsonb)
          from unnest(v_new_channels) as x
        ));
      end if;
    end if;

    if v_new = '{}'::jsonb then
      v_code := 'no_changes'; v_message := 'no effective changes';
    end if;
  end if;

  -- Optimistic concurrency token + row lock + token bump in one statement.
  if v_code is null then
    update core.customer
    set updated_at = now()
    where id = p_customer_id
      and updated_at = p_expected_updated_at;
    if not found then
      v_code := 'stale_token';
      v_message := 'record changed since it was loaded; reload and retry';
    end if;
  end if;

  -- Shared expected-failure epilogue: commit a failure audit row whenever the
  -- entity id and operation id are both present (the ledger requires both), then
  -- return the structured result with the fresh row when one exists.
  if v_code is not null then
    v_audit_id := null;
    if p_customer_id is not null and p_operation_id is not null then
      insert into app.db_data_admin_audit_event (
        operation_id, operation_item_key, entity_type, entity_id, action,
        old_snapshot, new_snapshot, reason, actor_profile_id, actor_user_id,
        succeeded, error_code, error_detail
      ) values (
        p_operation_id, 'primary', 'customer', p_customer_id, 'update',
        null, null,
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '(no reason supplied)'),
        v_actor, auth.uid(),
        false, v_code, jsonb_build_object('message', v_message)
      )
      returning id into v_audit_id;
    end if;
    return jsonb_build_object(
      'success', false,
      'operation_id', p_operation_id,
      'audit_id', v_audit_id,
      'idempotent_replay', false,
      'code', v_code,
      'message', v_message,
      'current', case
        when p_customer_id is null then null::jsonb
        else app.db_data_admin_customer_row(p_customer_id)
      end
    );
  end if;

  -- Apply the whitelisted changes.
  if v_new ? 'display_name' then
    update core.customer set display_name = v_display where id = p_customer_id;
  end if;

  if v_new ? 'status' then
    update core.customer set status = v_status where id = p_customer_id;
  end if;

  if p_app is not null and (v_new ? (p_app || '_status')) then
    -- Upsert exactly one whitelisted extension table. Inactive stores the reason
    -- and actor/time; reactivation clears the reason and refreshes actor/time.
    if p_app = 'crm' then
      insert into crm.customer_ext (
        customer_id, status, status_reason, status_changed_at, status_changed_by
      ) values (
        p_customer_id, p_app_status::app.entity_status,
        case when p_app_status = 'inactive' then btrim(p_reason) else null end,
        now(), v_actor
      )
      on conflict (customer_id) do update
      set status = excluded.status,
          status_reason = excluded.status_reason,
          status_changed_at = excluded.status_changed_at,
          status_changed_by = excluded.status_changed_by;
    elsif p_app = 'pm' then
      insert into pim.customer_ext (
        customer_id, status, status_reason, status_changed_at, status_changed_by
      ) values (
        p_customer_id, p_app_status::app.entity_status,
        case when p_app_status = 'inactive' then btrim(p_reason) else null end,
        now(), v_actor
      )
      on conflict (customer_id) do update
      set status = excluded.status,
          status_reason = excluded.status_reason,
          status_changed_at = excluded.status_changed_at,
          status_changed_by = excluded.status_changed_by;
    else
      insert into dam.customer_ext (
        customer_id, status, status_reason, status_changed_at, status_changed_by
      ) values (
        p_customer_id, p_app_status::app.entity_status,
        case when p_app_status = 'inactive' then btrim(p_reason) else null end,
        now(), v_actor
      )
      on conflict (customer_id) do update
      set status = excluded.status,
          status_reason = excluded.status_reason,
          status_changed_at = excluded.status_changed_at,
          status_changed_by = excluded.status_changed_by;
    end if;
  end if;

  if v_new ? 'channels' then
    delete from core.customer_channel
    where customer_id = p_customer_id
      and not (channel_id = any (v_new_channels));
    insert into core.customer_channel (customer_id, channel_id, assigned_by)
    select p_customer_id, ids.channel_id, v_actor
    from (select distinct unnest(v_new_channels) as channel_id) ids
    on conflict (customer_id, channel_id) do nothing;
  end if;

  -- Success audit: old/new snapshots of the changed approved fields only.
  insert into app.db_data_admin_audit_event (
    operation_id, operation_item_key, entity_type, entity_id, action,
    old_snapshot, new_snapshot, reason, actor_profile_id, actor_user_id, succeeded
  ) values (
    p_operation_id, 'primary', 'customer', p_customer_id, 'update',
    v_old, v_new, btrim(p_reason), v_actor, auth.uid(), true
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'audit_id', v_audit_id,
    'idempotent_replay', false,
    'row', app.db_data_admin_customer_row(p_customer_id)
  );
end;
$$;

comment on function api.db_data_admin_update_customer(uuid, timestamptz, uuid, text, text, text, text, text, uuid[]) is
  'DB Data Admin only. Whitelisted single-Customer update: display_name, global status (active/potential/inactive), one per-app (crm/pm/dam) binary status with reason/actor/time, and controlled Channel replacement. Optimistic concurrency on updated_at; p_operation_id is the idempotency key; expected failures return success=false with a committed failure audit row. Returns {success, operation_id, audit_id, idempotent_replay, row} or {success:false, code, message, current}.';

revoke all on function api.db_data_admin_update_customer(uuid, timestamptz, uuid, text, text, text, text, text, uuid[]) from public;
grant execute on function api.db_data_admin_update_customer(uuid, timestamptz, uuid, text, text, text, text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Vendor single-record update (core.factory; the UI entity is Vendor).
-- ---------------------------------------------------------------------------

create or replace function api.db_data_admin_update_vendor(
  p_vendor_id uuid,
  p_expected_updated_at timestamptz,
  p_operation_id uuid,
  p_reason text,
  p_display_name text default null,
  p_status text default null,
  p_app text default null,
  p_app_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_actor uuid;
  v_replay_id uuid;
  v_replay_succeeded boolean;
  v_replay_error_code text;
  v_replay_error_detail jsonb;
  v_replay_entity uuid;
  v_code text;
  v_message text;
  v_audit_id uuid;
  v_cur_status app.entity_status;
  v_cur_display text;
  v_status app.entity_status;
  v_display text;
  v_old_app_status app.entity_status;
  v_old_app_reason text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  perform app.require_db_data_admin_access();
  v_actor := app.current_profile_id();

  if p_operation_id is not null then
    select e.id, e.succeeded, e.error_code, e.error_detail, e.entity_id
    into v_replay_id, v_replay_succeeded, v_replay_error_code, v_replay_error_detail,
         v_replay_entity
    from app.db_data_admin_audit_event e
    where e.operation_id = p_operation_id
      and e.operation_item_key = 'primary';
    if found then
      return jsonb_build_object(
        'success', v_replay_succeeded,
        'operation_id', p_operation_id,
        'audit_id', v_replay_id,
        'idempotent_replay', true,
        'code', v_replay_error_code,
        'message', v_replay_error_detail ->> 'message',
        'row', app.db_data_admin_vendor_row(v_replay_entity)
      );
    end if;
  end if;

  if p_vendor_id is null then
    v_code := 'validation_failed'; v_message := 'vendor id is required';
  elsif p_operation_id is null then
    v_code := 'validation_failed'; v_message := 'operation id is required';
  elsif p_expected_updated_at is null then
    v_code := 'validation_failed'; v_message := 'expected updated_at is required';
  elsif nullif(btrim(coalesce(p_reason, '')), '') is null then
    v_code := 'validation_failed'; v_message := 'reason is required';
  elsif p_status is not null and p_status not in ('active', 'potential', 'inactive') then
    v_code := 'validation_failed';
    v_message := 'status must be active, potential, or inactive; archived and deleted are system states';
  elsif p_app is not null and p_app not in ('crm', 'pm', 'dam') then
    v_code := 'validation_failed';
    v_message := 'app must be crm, pm, or dam; plm status is unavailable until DesignFlow Factory mapping exists';
  elsif p_app is not null and p_app_status is null then
    v_code := 'validation_failed'; v_message := 'app status is required when app is given';
  elsif p_app is null and p_app_status is not null then
    v_code := 'validation_failed'; v_message := 'app status requires an app';
  elsif p_app_status is not null and p_app_status not in ('active', 'inactive') then
    v_code := 'validation_failed'; v_message := 'app status must be active or inactive';
  end if;

  if v_code is null and not app.db_data_admin_single_record_writes_enabled() then
    v_code := 'writes_disabled';
    v_message := 'single-record writes are disabled in this environment';
  end if;

  if v_code is null then
    select f.status, f.display_name
    into v_cur_status, v_cur_display
    from core.factory f
    where f.id = p_vendor_id;
    if not found then
      v_code := 'not_found'; v_message := 'vendor not found';
    end if;
  end if;

  if v_code is null then
    if p_display_name is not null then
      v_display := nullif(btrim(p_display_name), '');
      if v_display is distinct from v_cur_display then
        v_old := v_old || jsonb_build_object('display_name', v_cur_display);
        v_new := v_new || jsonb_build_object('display_name', v_display);
      end if;
    end if;

    if p_status is not null and p_status <> v_cur_status::text then
      v_status := p_status::app.entity_status;
      v_old := v_old || jsonb_build_object('status', v_cur_status::text);
      v_new := v_new || jsonb_build_object('status', p_status);
    end if;

    if p_app is not null then
      if p_app = 'crm' then
        select x.status, x.status_reason
        into v_old_app_status, v_old_app_reason
        from crm.factory_ext x
        where x.factory_id = p_vendor_id;
      elsif p_app = 'pm' then
        select x.status, x.status_reason
        into v_old_app_status, v_old_app_reason
        from pim.factory_ext x
        where x.factory_id = p_vendor_id;
      else
        select x.status, x.status_reason
        into v_old_app_status, v_old_app_reason
        from dam.factory_ext x
        where x.factory_id = p_vendor_id;
      end if;
      v_old_app_status := coalesce(v_old_app_status, 'active'::app.entity_status);
      if p_app_status <> v_old_app_status::text then
        v_old := v_old || jsonb_build_object(
          p_app || '_status', v_old_app_status::text,
          p_app || '_status_reason', v_old_app_reason
        );
        v_new := v_new || jsonb_build_object(
          p_app || '_status', p_app_status,
          p_app || '_status_reason',
          case when p_app_status = 'inactive' then btrim(p_reason) else null end
        );
      end if;
    end if;

    if v_new = '{}'::jsonb then
      v_code := 'no_changes'; v_message := 'no effective changes';
    end if;
  end if;

  if v_code is null then
    update core.factory
    set updated_at = now()
    where id = p_vendor_id
      and updated_at = p_expected_updated_at;
    if not found then
      v_code := 'stale_token';
      v_message := 'record changed since it was loaded; reload and retry';
    end if;
  end if;

  if v_code is not null then
    v_audit_id := null;
    if p_vendor_id is not null and p_operation_id is not null then
      insert into app.db_data_admin_audit_event (
        operation_id, operation_item_key, entity_type, entity_id, action,
        old_snapshot, new_snapshot, reason, actor_profile_id, actor_user_id,
        succeeded, error_code, error_detail
      ) values (
        p_operation_id, 'primary', 'vendor', p_vendor_id, 'update',
        null, null,
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '(no reason supplied)'),
        v_actor, auth.uid(),
        false, v_code, jsonb_build_object('message', v_message)
      )
      returning id into v_audit_id;
    end if;
    return jsonb_build_object(
      'success', false,
      'operation_id', p_operation_id,
      'audit_id', v_audit_id,
      'idempotent_replay', false,
      'code', v_code,
      'message', v_message,
      'current', case
        when p_vendor_id is null then null::jsonb
        else app.db_data_admin_vendor_row(p_vendor_id)
      end
    );
  end if;

  if v_new ? 'display_name' then
    update core.factory set display_name = v_display where id = p_vendor_id;
  end if;

  if v_new ? 'status' then
    update core.factory set status = v_status where id = p_vendor_id;
  end if;

  if p_app is not null and (v_new ? (p_app || '_status')) then
    if p_app = 'crm' then
      insert into crm.factory_ext (
        factory_id, status, status_reason, status_changed_at, status_changed_by
      ) values (
        p_vendor_id, p_app_status::app.entity_status,
        case when p_app_status = 'inactive' then btrim(p_reason) else null end,
        now(), v_actor
      )
      on conflict (factory_id) do update
      set status = excluded.status,
          status_reason = excluded.status_reason,
          status_changed_at = excluded.status_changed_at,
          status_changed_by = excluded.status_changed_by;
    elsif p_app = 'pm' then
      insert into pim.factory_ext (
        factory_id, status, status_reason, status_changed_at, status_changed_by
      ) values (
        p_vendor_id, p_app_status::app.entity_status,
        case when p_app_status = 'inactive' then btrim(p_reason) else null end,
        now(), v_actor
      )
      on conflict (factory_id) do update
      set status = excluded.status,
          status_reason = excluded.status_reason,
          status_changed_at = excluded.status_changed_at,
          status_changed_by = excluded.status_changed_by;
    else
      insert into dam.factory_ext (
        factory_id, status, status_reason, status_changed_at, status_changed_by
      ) values (
        p_vendor_id, p_app_status::app.entity_status,
        case when p_app_status = 'inactive' then btrim(p_reason) else null end,
        now(), v_actor
      )
      on conflict (factory_id) do update
      set status = excluded.status,
          status_reason = excluded.status_reason,
          status_changed_at = excluded.status_changed_at,
          status_changed_by = excluded.status_changed_by;
    end if;
  end if;

  insert into app.db_data_admin_audit_event (
    operation_id, operation_item_key, entity_type, entity_id, action,
    old_snapshot, new_snapshot, reason, actor_profile_id, actor_user_id, succeeded
  ) values (
    p_operation_id, 'primary', 'vendor', p_vendor_id, 'update',
    v_old, v_new, btrim(p_reason), v_actor, auth.uid(), true
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'audit_id', v_audit_id,
    'idempotent_replay', false,
    'row', app.db_data_admin_vendor_row(p_vendor_id)
  );
end;
$$;

comment on function api.db_data_admin_update_vendor(uuid, timestamptz, uuid, text, text, text, text, text) is
  'DB Data Admin only. Whitelisted single-Vendor update: display_name, global status (active/potential/inactive), and one per-app (crm/pm/dam) binary status with reason/actor/time. Optimistic concurrency on updated_at; p_operation_id is the idempotency key; expected failures return success=false with a committed failure audit row. Returns {success, operation_id, audit_id, idempotent_replay, row} or {success:false, code, message, current}.';

revoke all on function api.db_data_admin_update_vendor(uuid, timestamptz, uuid, text, text, text, text, text) from public;
grant execute on function api.db_data_admin_update_vendor(uuid, timestamptz, uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit read extension for the Step 8 detail display. Identical signature and
-- behavior as the Step 6 version (overload-free replacement, additive only): the
-- row payload gains actor_label from app.profile; filters, newest-first ordering,
-- and opaque keyset cursor pagination are unchanged.
-- ---------------------------------------------------------------------------

create or replace function api.db_data_admin_audit_list(
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_action text default null,
  p_actor_profile_id uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_cursor text default null,
  p_page_size integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_page_size integer;
  v_cursor_value text;
  v_cursor_id uuid;
  v_rows jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_db_data_admin_access();

  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 200);

  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with filtered as (
    select
      e.id,
      to_char(
        e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) collate "C" as sort_value,
      jsonb_build_object(
        'id', e.id,
        'operation_id', e.operation_id,
        'operation_item_key', e.operation_item_key,
        'entity_type', e.entity_type,
        'entity_id', e.entity_id,
        'action', e.action,
        'old_snapshot', e.old_snapshot,
        'new_snapshot', e.new_snapshot,
        'reason', e.reason,
        'actor_profile_id', e.actor_profile_id,
        'actor_user_id', e.actor_user_id,
        'actor_label', coalesce(ap.display_name, ap.email::text),
        'occurred_at', e.occurred_at,
        'merge_survivor_id', e.merge_survivor_id,
        'merge_loser_id', e.merge_loser_id,
        'succeeded', e.succeeded,
        'error_code', e.error_code,
        'error_detail', e.error_detail
      ) as object
    from app.db_data_admin_audit_event e
    left join app.profile ap on ap.id = e.actor_profile_id
    where (p_entity_type is null or e.entity_type = p_entity_type)
      and (p_entity_id is null or e.entity_id = p_entity_id)
      and (p_action is null or e.action = p_action)
      and (p_actor_profile_id is null or e.actor_profile_id = p_actor_profile_id)
      and (p_since is null or e.occurred_at >= p_since)
      and (p_until is null or e.occurred_at <= p_until)
      and (
        p_cursor is null
        or (
          to_char(
            e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) collate "C",
          e.id::text
        ) < (v_cursor_value, v_cursor_id::text)
      )
  ),
  ordered as (
    select f.id, f.sort_value, f.object
    from filtered f
    order by f.sort_value desc, f.id::text desc
    limit v_page_size + 1
  ),
  numbered as (
    select
      o.id,
      o.sort_value,
      o.object,
      row_number() over (order by o.sort_value desc, o.id::text desc) as rn
    from ordered o
  )
  select
    coalesce(
      jsonb_agg(n.object order by n.rn) filter (where n.rn <= v_page_size),
      '[]'::jsonb
    ),
    count(*),
    max(n.sort_value) filter (where n.rn = v_page_size),
    (max(n.id::text) filter (where n.rn = v_page_size))::uuid
  into v_rows, v_fetched, v_last_sort, v_last_id
  from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(
      convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'),
      'base64'
    );
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$$;

comment on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) is
  'DB Data Admin only. Newest-first read over the immutable audit ledger with entity/action/actor/time filters, opaque keyset pagination, and actor_label resolved from app.profile. Returns {rows, next_cursor, page_size}.';

revoke all on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) from public;
grant execute on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) to authenticated;

notify pgrst, 'reload schema';
