-- Bounded forward copy of the six preview-proven DB Data Admin migrations.
-- Preview already has the feature gate, so it skips. Production applies only this package.
create or replace procedure public.apply_db_data_admin_bounded_forward()
language plpgsql
as $guard$
begin
  if to_regclass('app.db_data_admin_feature_gate') is not null then
    raise notice 'reconciliation target already exists; baseline skipped';
    return;
  end if;
  execute $ddl_0$
create table app.db_data_admin_feature_gate (
  feature text primary key check (btrim(feature) <> ''),
  enabled boolean not null,
  notes text,
  updated_at timestamptz not null default now()
);
$ddl_0$;
  execute $ddl_1$
comment on table app.db_data_admin_feature_gate is
  'Environment-level DB Data Admin write gates. Data, not DDL, so preview and production differ after the same migration. Browser roles have no access; flipped only by operational DML.';
$ddl_1$;
  execute $ddl_2$
create trigger set_updated_at before update on app.db_data_admin_feature_gate
  for each row execute function app.set_updated_at();
$ddl_2$;
  execute $ddl_3$
alter table app.db_data_admin_feature_gate enable row level security;
$ddl_3$;
  execute $ddl_4$
revoke all on app.db_data_admin_feature_gate from public, anon, authenticated;
$ddl_4$;
  execute $ddl_5$
grant all on app.db_data_admin_feature_gate to service_role;
$ddl_5$;
  execute $ddl_6$
insert into app.db_data_admin_feature_gate (feature, enabled, notes) values (
  'single_record_write',
  false,
  'Step 8 single-record updates (display_name, global status, per-app status, Customer Channels). Enable on preview only until DB_Data_Admin.md Step 11 consumer enforcement passes; production enablement is a Step 13 decision.'
);
$ddl_6$;
  execute $ddl_7$
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
$ddl_7$;
  execute $ddl_8$
comment on function app.db_data_admin_single_record_writes_enabled() is
  'Private DB Data Admin helper. True only when the single_record_write feature gate row exists and is enabled. Called inside the protected update RPCs.';
$ddl_8$;
  execute $ddl_9$
revoke all on function app.db_data_admin_single_record_writes_enabled() from public;
$ddl_9$;
  execute $ddl_10$
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
$ddl_10$;
  execute $ddl_11$
comment on function app.db_data_admin_customer_row(uuid) is
  'Private DB Data Admin helper. Approved single-Customer projection for update results; NULL when the record does not exist.';
$ddl_11$;
  execute $ddl_12$
revoke all on function app.db_data_admin_customer_row(uuid) from public;
$ddl_12$;
  execute $ddl_13$
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
$ddl_13$;
  execute $ddl_14$
comment on function app.db_data_admin_vendor_row(uuid) is
  'Private DB Data Admin helper. Approved single-Vendor projection for update results; NULL when the record does not exist. Vendor PLM status stays null until DesignFlow Factory mapping exists.';
$ddl_14$;
  execute $ddl_15$
revoke all on function app.db_data_admin_vendor_row(uuid) from public;
$ddl_15$;
  execute $ddl_16$
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
$ddl_16$;
  execute $ddl_17$
comment on function api.db_data_admin_update_customer(uuid, timestamptz, uuid, text, text, text, text, text, uuid[]) is
  'DB Data Admin only. Whitelisted single-Customer update: display_name, global status (active/potential/inactive), one per-app (crm/pm/dam) binary status with reason/actor/time, and controlled Channel replacement. Optimistic concurrency on updated_at; p_operation_id is the idempotency key; expected failures return success=false with a committed failure audit row. Returns {success, operation_id, audit_id, idempotent_replay, row} or {success:false, code, message, current}.';
$ddl_17$;
  execute $ddl_18$
revoke all on function api.db_data_admin_update_customer(uuid, timestamptz, uuid, text, text, text, text, text, uuid[]) from public;
$ddl_18$;
  execute $ddl_19$
grant execute on function api.db_data_admin_update_customer(uuid, timestamptz, uuid, text, text, text, text, text, uuid[]) to authenticated;
$ddl_19$;
  execute $ddl_20$
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
$ddl_20$;
  execute $ddl_21$
comment on function api.db_data_admin_update_vendor(uuid, timestamptz, uuid, text, text, text, text, text) is
  'DB Data Admin only. Whitelisted single-Vendor update: display_name, global status (active/potential/inactive), and one per-app (crm/pm/dam) binary status with reason/actor/time. Optimistic concurrency on updated_at; p_operation_id is the idempotency key; expected failures return success=false with a committed failure audit row. Returns {success, operation_id, audit_id, idempotent_replay, row} or {success:false, code, message, current}.';
$ddl_21$;
  execute $ddl_22$
revoke all on function api.db_data_admin_update_vendor(uuid, timestamptz, uuid, text, text, text, text, text) from public;
$ddl_22$;
  execute $ddl_23$
grant execute on function api.db_data_admin_update_vendor(uuid, timestamptz, uuid, text, text, text, text, text) to authenticated;
$ddl_23$;
  execute $ddl_24$
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
$ddl_24$;
  execute $ddl_25$
comment on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) is
  'DB Data Admin only. Newest-first read over the immutable audit ledger with entity/action/actor/time filters, opaque keyset pagination, and actor_label resolved from app.profile. Returns {rows, next_cursor, page_size}.';
$ddl_25$;
  execute $ddl_26$
revoke all on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) from public;
$ddl_26$;
  execute $ddl_27$
grant execute on function api.db_data_admin_audit_list(text, uuid, text, uuid, timestamptz, timestamptz, text, integer) to authenticated;
$ddl_27$;
  execute $ddl_28$
notify pgrst, 'reload schema';
$ddl_28$;
  execute $ddl_29$
insert into app.db_data_admin_feature_gate(feature, enabled, notes) values
  ('merge_execute', false, 'Step 9 destructive merge execution. Enable on preview only until production approval.')
on conflict (feature) do nothing;
$ddl_29$;
  execute $ddl_30$
create or replace function app.db_data_admin_merge_fk_counts(
  p_target regclass, p_loser uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare v record; v_count bigint; v_result jsonb := '{}'::jsonb;
begin
  for v in
    select n.nspname, c.relname, a.attname
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(k.conkey) with ordinality ck(attnum, ord) on true
    join unnest(k.confkey) with ordinality fk(attnum, ord) using (ord)
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = ck.attnum
    where k.contype = 'f' and k.confrelid = p_target and cardinality(k.conkey) = 1
  loop
    execute format('select count(*) from %I.%I where %I = $1', v.nspname, v.relname, v.attname)
      into v_count using p_loser;
    v_result := v_result || jsonb_build_object(v.nspname || '.' || v.relname || '.' || v.attname, v_count);
  end loop;
  return v_result;
end; $$;
$ddl_30$;
  execute $ddl_31$
revoke all on function app.db_data_admin_merge_fk_counts(regclass,uuid) from public;
$ddl_31$;
  execute $ddl_32$
create or replace function app.db_data_admin_extension_conflicts(
  p_table regclass, p_key text, p_loser uuid, p_survivor uuid, p_prefix text
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare v_l jsonb; v_s jsonb; v_result jsonb := '[]'::jsonb; v_key text;
begin
  execute format('select to_jsonb(t) - %L - ''created_at'' - ''updated_at'' from %s t where %I=$1', p_key, p_table, p_key)
    into v_l using p_loser;
  execute format('select to_jsonb(t) - %L - ''created_at'' - ''updated_at'' from %s t where %I=$1', p_key, p_table, p_key)
    into v_s using p_survivor;
  if v_l is null or v_s is null then return v_result; end if;
  for v_key in select jsonb_object_keys(v_l || v_s)
  loop
    if v_key not in ('status_changed_at','status_changed_by')
       and v_l->v_key is distinct from 'null'::jsonb
       and v_s->v_key is distinct from 'null'::jsonb
       and v_l->v_key is distinct from v_s->v_key then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'key', p_prefix || '.' || v_key, 'app', p_prefix, 'field', v_key,
        'survivor', v_s->v_key, 'loser', v_l->v_key));
    end if;
  end loop;
  return v_result;
end; $$;
$ddl_32$;
  execute $ddl_33$
revoke all on function app.db_data_admin_extension_conflicts(regclass,text,uuid,uuid,text) from public;
$ddl_33$;
  execute $ddl_34$
create or replace function app.db_data_admin_reconcile_extension(
  p_table regclass, p_key text, p_loser uuid, p_survivor uuid,
  p_prefix text, p_resolutions jsonb
) returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_l jsonb; v_s jsonb; v_col text; v_lval jsonb; v_sval jsonb; v_chosen jsonb; v_choice text;
begin
  execute format('select to_jsonb(t) - %L - ''created_at'' - ''updated_at'' from %s t where %I=$1', p_key, p_table, p_key)
    into v_l using p_loser;
  execute format('select to_jsonb(t) - %L - ''created_at'' - ''updated_at'' from %s t where %I=$1', p_key, p_table, p_key)
    into v_s using p_survivor;
  if v_l is null or v_s is null then return; end if;
  for v_col in select jsonb_object_keys(v_l || v_s)
  loop
    v_lval := v_l->v_col; v_sval := v_s->v_col;
    if v_lval is not distinct from v_sval then v_chosen := v_sval;
    elsif v_sval is null or v_sval = 'null'::jsonb then v_chosen := v_lval;
    elsif v_lval is null or v_lval = 'null'::jsonb then v_chosen := v_sval;
    elsif v_col in ('status_changed_at','status_changed_by') then v_chosen := v_sval;
    else
      v_choice := p_resolutions->>(p_prefix || '.' || v_col);
      if v_choice not in ('survivor','loser') then
        raise exception 'missing resolution for %', p_prefix || '.' || v_col using errcode='22023';
      end if;
      v_chosen := case v_choice when 'loser' then v_lval else v_sval end;
    end if;
    execute format(
      'update %s set %I=(jsonb_populate_record(null::%s,jsonb_build_object(%L,$1))).%I where %I in ($2,$3)',
      p_table, v_col, p_table, v_col, v_col, p_key)
      using v_chosen, p_loser, p_survivor;
  end loop;
end; $$;
$ddl_34$;
  execute $ddl_35$
revoke all on function app.db_data_admin_reconcile_extension(regclass,text,uuid,uuid,text,jsonb) from public;
$ddl_35$;
  execute $ddl_36$
create or replace function app.db_data_admin_merge_preview(
  p_kind text, p_survivor uuid, p_loser uuid
) returns jsonb
language plpgsql stable security definer
set search_path = app, public
as $$
declare v_s jsonb; v_l jsonb; v_conflicts jsonb := '[]'::jsonb; v_counts jsonb; v_payload jsonb;
begin
  perform app.require_db_data_admin_access();
  if p_survivor is null or p_loser is null or p_survivor=p_loser then
    return jsonb_build_object('success',false,'code','invalid_pair','message','Choose two different records.');
  end if;
  if p_kind='customer' then
    v_s := app.db_data_admin_customer_row(p_survivor); v_l := app.db_data_admin_customer_row(p_loser);
    v_counts := app.db_data_admin_merge_fk_counts('core.customer',p_loser);
    v_conflicts := v_conflicts
      || app.db_data_admin_extension_conflicts('crm.customer_ext','customer_id',p_loser,p_survivor,'crm')
      || app.db_data_admin_extension_conflicts('pim.customer_ext','customer_id',p_loser,p_survivor,'pm')
      || app.db_data_admin_extension_conflicts('dam.customer_ext','customer_id',p_loser,p_survivor,'dam');
  elsif p_kind='vendor' then
    v_s := app.db_data_admin_vendor_row(p_survivor); v_l := app.db_data_admin_vendor_row(p_loser);
    v_counts := app.db_data_admin_merge_fk_counts('core.factory',p_loser);
    v_conflicts := v_conflicts
      || app.db_data_admin_extension_conflicts('crm.factory_ext','factory_id',p_loser,p_survivor,'crm')
      || app.db_data_admin_extension_conflicts('pim.factory_ext','factory_id',p_loser,p_survivor,'pm')
      || app.db_data_admin_extension_conflicts('dam.factory_ext','factory_id',p_loser,p_survivor,'dam');
  else
    return jsonb_build_object('success',false,'code','invalid_entity_type');
  end if;
  if v_s is null or v_l is null then return jsonb_build_object('success',false,'code','not_found'); end if;
  v_payload := jsonb_build_object('entity_type',p_kind,'survivor',v_s,'loser',v_l,
    'affected_counts',v_counts,'conflicts',v_conflicts);
  return jsonb_build_object('success',true,'preview',v_payload,
    'preview_token',encode(digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'));
end; $$;
$ddl_36$;
  execute $ddl_37$
revoke all on function app.db_data_admin_merge_preview(text,uuid,uuid) from public;
$ddl_37$;
  execute $ddl_38$
create or replace function api.db_data_admin_preview_customer_merge(p_survivor_id uuid,p_loser_id uuid)
returns jsonb language sql stable security definer set search_path=api,public
as $$ select app.db_data_admin_merge_preview('customer',p_survivor_id,p_loser_id) $$;
$ddl_38$;
  execute $ddl_39$
create or replace function api.db_data_admin_preview_vendor_merge(p_survivor_id uuid,p_loser_id uuid)
returns jsonb language sql stable security definer set search_path=api,public
as $$ select app.db_data_admin_merge_preview('vendor',p_survivor_id,p_loser_id) $$;
$ddl_39$;
  execute $ddl_40$
create or replace function app.db_data_admin_merge_execute(
  p_kind text,p_survivor uuid,p_loser uuid,p_preview_token text,p_operation_id uuid,
  p_reason text,p_resolutions jsonb
) returns jsonb
language plpgsql security definer
set search_path=app,public
as $$
declare v_prior app.db_data_admin_audit_event%rowtype; v_preview jsonb; v_actual text; v_actor_profile uuid; v_actor_user uuid; v_after jsonb; v_audit uuid; v_error text;
begin
  perform app.require_db_data_admin_access();
  if p_operation_id is null then return jsonb_build_object('success',false,'code','operation_id_required'); end if;
  if p_survivor is null or p_loser is null or p_survivor=p_loser then return jsonb_build_object('success',false,'code','invalid_pair'); end if;
  select * into v_prior from app.db_data_admin_audit_event where operation_id=p_operation_id and operation_item_key='primary';
  if found then return coalesce(v_prior.new_snapshot,'{}'::jsonb)||jsonb_build_object('success',v_prior.succeeded,'audit_id',v_prior.id,'idempotent_replay',true,'code',v_prior.error_code); end if;
  if nullif(btrim(p_reason),'') is null then return jsonb_build_object('success',false,'code','reason_required'); end if;
  if not coalesce((select enabled from app.db_data_admin_feature_gate where feature='merge_execute'),false) then
    insert into app.db_data_admin_audit_event(operation_id,operation_item_key,entity_type,entity_id,action,reason,actor_profile_id,actor_user_id,merge_survivor_id,merge_loser_id,succeeded,error_code,error_detail)
    values(p_operation_id,'primary',p_kind,p_survivor,'merge',btrim(p_reason),app.current_profile_id(),auth.uid(),p_survivor,p_loser,false,'writes_disabled','{}') returning id into v_audit;
    return jsonb_build_object('success',false,'code','writes_disabled','audit_id',v_audit);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(least(p_loser::text,p_survivor::text),case when p_kind='customer' then 10 else 11 end));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_loser::text,p_survivor::text),case when p_kind='customer' then 10 else 11 end));
  v_preview := app.db_data_admin_merge_preview(p_kind,p_survivor,p_loser);
  if not coalesce((v_preview->>'success')::boolean,false) then return v_preview; end if;
  v_actual := v_preview->>'preview_token';
  if p_preview_token is distinct from v_actual then
    insert into app.db_data_admin_audit_event(operation_id,operation_item_key,entity_type,entity_id,action,old_snapshot,reason,actor_profile_id,actor_user_id,merge_survivor_id,merge_loser_id,succeeded,error_code,error_detail)
    values(p_operation_id,'primary',p_kind,p_survivor,'merge',v_preview->'preview',btrim(p_reason),app.current_profile_id(),auth.uid(),p_survivor,p_loser,false,'stale_preview',jsonb_build_object('current_preview_token',v_actual)) returning id into v_audit;
    return jsonb_build_object('success',false,'code','stale_preview','current_preview',v_preview,'audit_id',v_audit);
  end if;
  begin
    if p_kind='customer' then
      perform app.db_data_admin_reconcile_extension('crm.customer_ext','customer_id',p_loser,p_survivor,'crm',coalesce(p_resolutions,'{}'));
      perform app.db_data_admin_reconcile_extension('pim.customer_ext','customer_id',p_loser,p_survivor,'pm',coalesce(p_resolutions,'{}'));
      perform app.db_data_admin_reconcile_extension('dam.customer_ext','customer_id',p_loser,p_survivor,'dam',coalesce(p_resolutions,'{}'));
      perform core.merge_customer(p_loser=>p_loser,p_survivor=>p_survivor,p_alias_loser_name=>true);
      v_after := app.db_data_admin_customer_row(p_survivor);
    elsif p_kind='vendor' then
      perform app.db_data_admin_reconcile_extension('crm.factory_ext','factory_id',p_loser,p_survivor,'crm',coalesce(p_resolutions,'{}'));
      perform app.db_data_admin_reconcile_extension('pim.factory_ext','factory_id',p_loser,p_survivor,'pm',coalesce(p_resolutions,'{}'));
      perform app.db_data_admin_reconcile_extension('dam.factory_ext','factory_id',p_loser,p_survivor,'dam',coalesce(p_resolutions,'{}'));
      perform core.merge_factory(p_loser=>p_loser,p_survivor=>p_survivor,p_alias_loser_name=>true);
      v_after := app.db_data_admin_vendor_row(p_survivor);
    else return jsonb_build_object('success',false,'code','invalid_entity_type'); end if;
  exception when invalid_parameter_value or integrity_constraint_violation or check_violation then
    v_error := sqlerrm;
  end;
  if v_error is not null then
    insert into app.db_data_admin_audit_event(operation_id,operation_item_key,entity_type,entity_id,action,old_snapshot,reason,actor_profile_id,actor_user_id,merge_survivor_id,merge_loser_id,succeeded,error_code,error_detail)
    values(p_operation_id,'primary',p_kind,p_survivor,'merge',v_preview->'preview',btrim(p_reason),app.current_profile_id(),auth.uid(),p_survivor,p_loser,false,'resolution_required',jsonb_build_object('message',v_error)) returning id into v_audit;
    return jsonb_build_object('success',false,'code','resolution_required','message',v_error,'audit_id',v_audit);
  end if;
  v_actor_profile:=app.current_profile_id(); v_actor_user:=auth.uid();
  insert into app.db_data_admin_audit_event(operation_id,operation_item_key,entity_type,entity_id,action,old_snapshot,new_snapshot,reason,actor_profile_id,actor_user_id,merge_survivor_id,merge_loser_id,succeeded)
  values(p_operation_id,'primary',p_kind,p_survivor,'merge',v_preview->'preview',v_after,btrim(p_reason),v_actor_profile,v_actor_user,p_survivor,p_loser,true)
  returning id into v_audit;
  return jsonb_build_object('success',true,'survivor',v_after,'audit_id',v_audit,'idempotent_replay',false);
end; $$;
$ddl_40$;
  execute $ddl_41$
revoke all on function app.db_data_admin_merge_execute(text,uuid,uuid,text,uuid,text,jsonb) from public;
$ddl_41$;
  execute $ddl_42$
create or replace function api.db_data_admin_merge_customer(p_survivor_id uuid,p_loser_id uuid,p_preview_token text,p_operation_id uuid,p_reason text,p_resolutions jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=api,public
as $$ select app.db_data_admin_merge_execute('customer',p_survivor_id,p_loser_id,p_preview_token,p_operation_id,p_reason,p_resolutions) $$;
$ddl_42$;
  execute $ddl_43$
create or replace function api.db_data_admin_merge_vendor(p_survivor_id uuid,p_loser_id uuid,p_preview_token text,p_operation_id uuid,p_reason text,p_resolutions jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=api,public
as $$ select app.db_data_admin_merge_execute('vendor',p_survivor_id,p_loser_id,p_preview_token,p_operation_id,p_reason,p_resolutions) $$;
$ddl_43$;
  execute $ddl_44$
revoke all on function api.db_data_admin_preview_customer_merge(uuid,uuid),api.db_data_admin_preview_vendor_merge(uuid,uuid),api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb),api.db_data_admin_merge_vendor(uuid,uuid,text,uuid,text,jsonb) from public;
$ddl_44$;
  execute $ddl_45$
grant execute on function api.db_data_admin_preview_customer_merge(uuid,uuid),api.db_data_admin_preview_vendor_merge(uuid,uuid),api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb),api.db_data_admin_merge_vendor(uuid,uuid,text,uuid,text,jsonb) to authenticated;
$ddl_45$;
  execute $ddl_46$
create or replace function app.db_data_admin_merge_preview(
  p_kind text, p_survivor uuid, p_loser uuid
) returns jsonb
language plpgsql stable security definer
set search_path = app, public
as $$
declare v_s jsonb; v_l jsonb; v_conflicts jsonb := '[]'::jsonb; v_counts jsonb; v_payload jsonb;
begin
  perform app.require_db_data_admin_access();
  if p_survivor is null or p_loser is null or p_survivor=p_loser then
    return jsonb_build_object('success',false,'code','invalid_pair','message','Choose two different records.');
  end if;
  if p_kind='customer' then
    v_s := app.db_data_admin_customer_row(p_survivor); v_l := app.db_data_admin_customer_row(p_loser);
    v_counts := app.db_data_admin_merge_fk_counts('core.customer',p_loser);
    v_conflicts := v_conflicts
      || app.db_data_admin_extension_conflicts('crm.customer_ext','customer_id',p_loser,p_survivor,'crm')
      || app.db_data_admin_extension_conflicts('pim.customer_ext','customer_id',p_loser,p_survivor,'pm')
      || app.db_data_admin_extension_conflicts('dam.customer_ext','customer_id',p_loser,p_survivor,'dam');
  elsif p_kind='vendor' then
    v_s := app.db_data_admin_vendor_row(p_survivor); v_l := app.db_data_admin_vendor_row(p_loser);
    v_counts := app.db_data_admin_merge_fk_counts('core.factory',p_loser);
    v_conflicts := v_conflicts
      || app.db_data_admin_extension_conflicts('crm.factory_ext','factory_id',p_loser,p_survivor,'crm')
      || app.db_data_admin_extension_conflicts('pim.factory_ext','factory_id',p_loser,p_survivor,'pm')
      || app.db_data_admin_extension_conflicts('dam.factory_ext','factory_id',p_loser,p_survivor,'dam');
  else
    return jsonb_build_object('success',false,'code','invalid_entity_type');
  end if;
  if v_s is null or v_l is null then return jsonb_build_object('success',false,'code','not_found'); end if;
  v_payload := jsonb_build_object('entity_type',p_kind,'survivor',v_s,'loser',v_l,
    'affected_counts',v_counts,'conflicts',v_conflicts);
  return jsonb_build_object('success',true,'preview',v_payload,
    'preview_token',encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'));
end; $$;
$ddl_46$;
  execute $ddl_47$
revoke all on function app.db_data_admin_merge_preview(text,uuid,uuid) from public;
$ddl_47$;
  execute $ddl_48$
create or replace function api.db_data_admin_licensor_property_tree(
  p_search text default null,
  p_include_inactive boolean default false,
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
  v_snapshot_at timestamptz := clock_timestamp();
  v_feeder_last_sync_at timestamptz;
  v_feeder_last_run_status text;
  v_feeder_days_stale integer;
  v_feeder_available boolean := false;
  v_total_licensors integer;
  v_active_licensors integer;
  v_total_properties integer;
  v_active_properties integer;
  v_properties_with_licensor integer;
  v_orphan_count integer;
  v_orphans jsonb;
  v_licensors jsonb;
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

  -- ------------------------------------------------------------------
  -- Feeder / snapshot context. Observed recency of the designflow_plm
  -- feeder only; this never reaches the upstream endpoint. A nightly sync
  -- that has not succeeded within ~2 days is treated as unavailable, so
  -- feeder_available tracks observed mirror recency. That recency is NOT
  -- proof of live reconciliation: this function reads only the canonical
  -- mirror + ingest.sync_run and never compares against live DesignFlow,
  -- so live_upstream_reconciliation is reported as false unconditionally.
  -- ------------------------------------------------------------------
  select max(s.started_at)
  into v_feeder_last_sync_at
  from ingest.sync_run s
  where s.source_system = 'designflow_plm';

  select s.status::text into v_feeder_last_run_status
  from ingest.sync_run s
  where s.source_system = 'designflow_plm'
  order by s.started_at desc nulls last, s.id desc
  limit 1;

  if v_feeder_last_sync_at is not null then
    v_feeder_days_stale := (v_snapshot_at at time zone 'UTC')::date
                         - (v_feeder_last_sync_at at time zone 'UTC')::date;
    v_feeder_available := (v_feeder_last_run_status = 'succeeded'
                           and coalesce(v_feeder_days_stale, 99) <= 2);
  else
    v_feeder_days_stale := null;
    v_feeder_available := false;
  end if;

  -- ------------------------------------------------------------------
  -- Reconciliation summary computed directly from the canonical tables.
  -- These are the structural invariants; they are independent of the
  -- paginated licensable payload below.
  -- ------------------------------------------------------------------
  select count(*),
         count(*) filter (where l.status in ('active'::app.entity_status, 'potential'::app.entity_status))
  into v_total_licensors, v_active_licensors
  from core.licensor l;

  select count(*),
         count(*) filter (where p.status in ('active'::app.entity_status, 'potential'::app.entity_status)),
         count(*) filter (where p.licensor_id is not null),
         count(*) filter (where p.licensor_id is null)
  into v_total_properties, v_active_properties, v_properties_with_licensor, v_orphan_count
  from core.property p;

  -- ------------------------------------------------------------------
  -- Orphan properties: always the complete anomaly list, never filtered by
  -- status or search. A non-empty list is a loud error state in the UI.
  -- ------------------------------------------------------------------
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', op.id,
      'name', op.name,
      'code', op.code,
      'status', op.status::text,
      'licensor_id', null,
      'character_count', (
        select count(*)::integer
        from core.character ch
        where ch.property_id = op.id
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
        from core.taxonomy_source_ref r
        where r.entity_schema = 'core'
          and r.entity_table = 'property'
          and r.entity_id = op.id
      ), '[]'::jsonb),
      -- Division/type-qualified PLM mirror context. mg_type is a fixed
      -- label here (property rows are MG06); it never drives the edge.
      'plm_context', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'plm_id', pi.plm_property_id,
            'division_code', pi.division_code,
            'mg_code', pi.mg_code,
            'mg_type', 'property',
            'mg_category', pi.mg_category
          )
          order by pi.division_code nulls last, pi.mg_code nulls last, pi.plm_property_id
        )
        from plm.property_import pi
        where pi.property_id = op.id
      ), '[]'::jsonb),
      'updated_at', op.updated_at
    )
    order by lower(op.name) collate "C", op.id
  ), '[]'::jsonb)
  into v_orphans
  from core.property op
  where op.licensor_id is null;

  -- ------------------------------------------------------------------
  -- Licensable hierarchy. Pages over licensors by name; the cursor is an
  -- opaque base64 keyset over (lower(name), id). A licensor matches the
  -- search if its own name matches or any of its properties match, so a
  -- property search still reveals its parent licensor.
  -- ------------------------------------------------------------------
  with licensor_match as (
    select
      l.id,
      l.name,
      l.code,
      l.status,
      l.updated_at,
      lower(l.name) collate "C" as sort_value,
      (p_search is null or l.name ilike '%' || p_search || '%') as name_matches
    from core.licensor l
    where (
      p_include_inactive
      or l.status in ('active'::app.entity_status, 'potential'::app.entity_status)
    )
  ),
  licensor_rows as (
    select
      lm.id,
      lm.name,
      lm.code,
      lm.status,
      lm.updated_at,
      lm.sort_value,
      lm.name_matches,
      (
        select count(*)::integer
        from core.property p
        where p.licensor_id = lm.id
          and (
            p_include_inactive
            or p.status in ('active'::app.entity_status, 'potential'::app.entity_status)
          )
      ) as property_count,
      coalesce((
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
        from core.taxonomy_source_ref r
        where r.entity_schema = 'core'
          and r.entity_table = 'licensor'
          and r.entity_id = lm.id
      ), '[]'::jsonb) as source_refs,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'plm_id', li.plm_licensor_id,
            'division_code', li.division_code,
            'mg_code', li.mg_code,
            'mg_type', 'licensor',
            'mg_category', li.mg_category
          )
          order by li.division_code nulls last, li.mg_code nulls last, li.plm_licensor_id
        )
        from plm.licensor_import li
        where li.licensor_id = lm.id
      ), '[]'::jsonb) as plm_context,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'code', p.code,
            'status', p.status::text,
            'licensor_id', p.licensor_id,
            'character_count', (
              select count(*)::integer
              from core.character ch
              where ch.property_id = p.id
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
              from core.taxonomy_source_ref r
              where r.entity_schema = 'core'
                and r.entity_table = 'property'
                and r.entity_id = p.id
            ), '[]'::jsonb),
            'plm_context', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'plm_id', pi.plm_property_id,
                  'division_code', pi.division_code,
                  'mg_code', pi.mg_code,
                  'mg_type', 'property',
                  'mg_category', pi.mg_category
                )
                order by pi.division_code nulls last, pi.mg_code nulls last, pi.plm_property_id
              )
              from plm.property_import pi
              where pi.property_id = p.id
            ), '[]'::jsonb)
          )
          order by lower(p.name) collate "C", p.id
        )
        from core.property p
        where p.licensor_id = lm.id
          and (
            p_include_inactive
            or p.status in ('active'::app.entity_status, 'potential'::app.entity_status)
          )
          and (lm.name_matches or p.name ilike '%' || p_search || '%')
      ), '[]'::jsonb) as properties
    from licensor_match lm
  ),
  qualified as (
    select lr.*
    from licensor_rows lr
    -- Keep a licensor whose own name matched, or whose visible property set
    -- is non-empty after the property-name search.
    where lr.name_matches
       or jsonb_array_length(coalesce(lr.properties, '[]'::jsonb)) > 0
  ),
  cursor_filtered as (
    select q.*
    from qualified q
    where p_cursor is null
      or (q.sort_value collate "C", q.id::text) > (v_cursor_value, v_cursor_id::text)
  ),
  ordered as (
    select cf.*
    from cursor_filtered cf
    order by cf.sort_value asc, cf.id::text asc
    limit v_page_size + 1
  ),
  numbered as (
    select
      o.*,
      row_number() over (order by o.sort_value asc, o.id::text asc) as rn
    from ordered o
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'name', n.name,
          'code', n.code,
          'status', n.status::text,
          'property_count', n.property_count,
          'source_refs', n.source_refs,
          'plm_context', n.plm_context,
          'properties', n.properties,
          'updated_at', n.updated_at
        )
        order by n.rn
      ) filter (where n.rn <= v_page_size),
      '[]'::jsonb
    ),
    count(*),
    max(n.sort_value) filter (where n.rn = v_page_size),
    max(n.id) filter (where n.rn = v_page_size)
  into v_licensors, v_fetched, v_last_sort, v_last_id
  from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(
      convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'),
      'base64'
    );
  end if;

  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'snapshot_at', v_snapshot_at,
      'store', 'core.licensor / core.property (Supabase canonical mirror)',
      'source_system', 'designflow_plm',
      'feeder_last_sync_at', v_feeder_last_sync_at,
      'feeder_last_run_status', v_feeder_last_run_status,
      'feeder_days_stale', v_feeder_days_stale,
      'feeder_available', v_feeder_available,
      'live_upstream_reconciliation', false,
      'note', 'Snapshot of the canonical Supabase mirror only. The Licensor->Property edge is DesignFlow-owned and mirrored via core.property.licensor_id; it is not inferred from mgTypeCode or mg_code. feeder_available reflects observed recency of the designflow_plm feeder (from ingest.sync_run) and does NOT prove live reconciliation. This function never queries or compares against the live DesignFlow upstream, so live_upstream_reconciliation is always false.'
    ),
    'reconciliation', jsonb_build_object(
      'licensor_count', v_total_licensors,
      'active_licensor_count', v_active_licensors,
      'property_count', v_total_properties,
      'active_property_count', v_active_properties,
      'properties_with_licensor', v_properties_with_licensor,
      'orphan_property_count', v_orphan_count,
      'expected_orphan_count_is_zero', (v_orphan_count = 0),
      'partition_reconciles',
        (v_properties_with_licensor + v_orphan_count) = v_total_properties
    ),
    'licensors', v_licensors,
    'orphan_properties', v_orphans,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$$;
$ddl_48$;
  execute $ddl_49$
comment on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) is
  'DB Data Admin only. Fully read-only Licensor -> Property tree (Step 10): dated snapshot with observed feeder status, internal reconciliation summary, the licensable hierarchy with division/type-qualified source context and counts, and a separate always-complete loud orphan collection. The edge comes only from core.property.licensor_id; it is never inferred from mgTypeCode or globally unique codes. Pages over licensors by name; orphan_properties is always the complete anomaly list. Returns {snapshot, reconciliation, licensors, orphan_properties, next_cursor, page_size}.';
$ddl_49$;
  execute $ddl_50$
revoke all on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) from public;
$ddl_50$;
  execute $ddl_51$
grant execute on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) to authenticated;
$ddl_51$;
  execute $ddl_52$
notify pgrst, 'reload schema';
$ddl_52$;
  execute $ddl_53$
do $$
declare
  v_function regprocedure := 'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)'::regprocedure;
  v_definition text;
  v_invalid text := 'max(n.id) filter (where n.rn = v_page_size)';
  v_valid text := '(max(n.id::text) filter (where n.rn = v_page_size))::uuid';
begin
  v_definition := pg_get_functiondef(v_function);
  if position(v_invalid in v_definition) = 0 then
    raise exception 'expected UUID cursor aggregate not found in %', v_function;
  end if;
  execute replace(v_definition, v_invalid, v_valid);
end $$;
$ddl_53$;
  execute $ddl_54$
create or replace function app.db_data_admin_merge_preview(
  p_kind text, p_survivor uuid, p_loser uuid
) returns jsonb
language plpgsql stable security definer
set search_path = app, public
as $$
declare
  v_s jsonb; v_l jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_counts jsonb;
  v_aliases jsonb := '[]'::jsonb;
  v_srefs jsonb := '[]'::jsonb;
  v_loser_name text;
  v_payload jsonb;
begin
  perform app.require_db_data_admin_access();
  if p_survivor is null or p_loser is null or p_survivor=p_loser then
    return jsonb_build_object('success',false,'code','invalid_pair','message','Choose two different records.');
  end if;
  if p_kind='customer' then
    v_s := app.db_data_admin_customer_row(p_survivor); v_l := app.db_data_admin_customer_row(p_loser);
    v_counts := app.db_data_admin_merge_fk_counts('core.customer',p_loser);
    v_conflicts := v_conflicts
      || app.db_data_admin_extension_conflicts('crm.customer_ext','customer_id',p_loser,p_survivor,'crm')
      || app.db_data_admin_extension_conflicts('pim.customer_ext','customer_id',p_loser,p_survivor,'pm')
      || app.db_data_admin_extension_conflicts('dam.customer_ext','customer_id',p_loser,p_survivor,'dam');
    -- Actual aliases that transfer from the loser to the survivor.
    select coalesce(jsonb_agg(jsonb_build_object(
             'alias', a.alias, 'alias_type', a.alias_type, 'source_system', a.source_system, 'origin', 'existing_alias'
           ) order by lower(a.alias), a.id), '[]'::jsonb)
      into v_aliases from core.customer_alias a where a.customer_id=p_loser;
    -- Actual source references that transfer.
    select coalesce(jsonb_agg(jsonb_build_object(
             'source_system', r.source_system, 'source_table', r.source_table,
             'source_id', r.source_id, 'source_code', r.source_code, 'source_name', r.source_name
           ) order by r.source_system, r.source_table, r.source_id), '[]'::jsonb)
      into v_srefs from core.company_source_ref r where r.company_id=p_loser;
  elsif p_kind='vendor' then
    v_s := app.db_data_admin_vendor_row(p_survivor); v_l := app.db_data_admin_vendor_row(p_loser);
    v_counts := app.db_data_admin_merge_fk_counts('core.factory',p_loser);
    v_conflicts := v_conflicts
      || app.db_data_admin_extension_conflicts('crm.factory_ext','factory_id',p_loser,p_survivor,'crm')
      || app.db_data_admin_extension_conflicts('pim.factory_ext','factory_id',p_loser,p_survivor,'pm')
      || app.db_data_admin_extension_conflicts('dam.factory_ext','factory_id',p_loser,p_survivor,'dam');
    select coalesce(jsonb_agg(jsonb_build_object(
             'alias', a.alias, 'alias_type', a.alias_type, 'source_system', a.source_system, 'origin', 'existing_alias'
           ) order by lower(a.alias), a.id), '[]'::jsonb)
      into v_aliases from core.factory_alias a where a.factory_id=p_loser;
    -- core.factory_source_ref has no source_name column.
    select coalesce(jsonb_agg(jsonb_build_object(
             'source_system', r.source_system, 'source_table', r.source_table,
             'source_id', r.source_id, 'source_code', r.source_code
           ) order by r.source_system, r.source_table, r.source_id), '[]'::jsonb)
      into v_srefs from core.factory_source_ref r where r.factory_id=p_loser;
  else
    return jsonb_build_object('success',false,'code','invalid_entity_type');
  end if;
  if v_s is null or v_l is null then return jsonb_build_object('success',false,'code','not_found'); end if;
  -- The merge wrapper is always called with p_alias_loser_name=>true, so the
  -- loser's own display name becomes a new alias on the survivor. Surface it.
  v_loser_name := coalesce(nullif(v_l->>'display_name',''), v_l->>'name');
  if v_loser_name is not null then
    v_aliases := v_aliases || jsonb_build_array(jsonb_build_object(
      'alias', v_loser_name, 'alias_type', 'merged_name', 'source_system', 'db_data_admin_merge', 'origin', 'loser_name'));
  end if;
  v_payload := jsonb_build_object('entity_type',p_kind,'survivor',v_s,'loser',v_l,
    'affected_counts',v_counts,'conflicts',v_conflicts,
    'moving_aliases',v_aliases,'moving_source_refs',v_srefs);
  return jsonb_build_object('success',true,'preview',v_payload,
    'preview_token',encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'));
end; $$;
$ddl_54$;
  execute $ddl_55$
revoke all on function app.db_data_admin_merge_preview(text,uuid,uuid) from public;
$ddl_55$;
end;
$guard$;

call public.apply_db_data_admin_bounded_forward();
drop procedure public.apply_db_data_admin_bounded_forward();
