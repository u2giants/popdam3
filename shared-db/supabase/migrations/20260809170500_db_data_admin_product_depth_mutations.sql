-- =====================================================================================
-- Issue #597 Phase 1 — protected DB Data Admin mutations for Product Depth.
--
-- Owner decision 1 on #597: Product Depth maintenance is allowed for administrators
-- AND the shared Designer role (the role Carlos Corral holds).
-- Owner decision 3: DB Data Admin is the ONLY place to add, rename, activate or
-- deactivate a Product Depth value. The old DesignFlow editor is retired.
--
-- WHY THIS DOES NOT REUSE app.require_db_data_admin_access()
-- ----------------------------------------------------------
-- That gate is `has_role('administrator') AND has_explicit_app_access('admin')`.
-- Reusing it would lock the Designer out of the one screen the owner just made
-- responsible for this data. So there is a second, Depth-specific gate that widens
-- the ROLE arm to administrator-or-designer and keeps the app-access arm unchanged —
-- a Designer still needs an explicit, non-revoked `admin` app_access row to reach DB
-- Data Admin at all, exactly like every other user of that app.
--
-- >>> PROVISIONING NOTE, STATED LOUDLY BECAUSE IT IS THE PART THAT SILENTLY FAILS:
-- >>> granting the Designer ROLE is not enough. Carlos also needs an `admin`
-- >>> app_access row. Without it every call below raises insufficient_privilege.
-- >>> That is deliberate — a role alone must not open an admin tool — but it means
-- >>> the cutover is not finished until that row exists in each environment.
--
-- THE PRIVILEGE GUARD IS NOT NULL-PERMISSIVE
-- ------------------------------------------
-- app.has_role / app.has_any_role resolve through app.current_profile_id() and return
-- FALSE, never NULL, when there is no JWT — so `if not (...) then raise` is safe here
-- in a way that `if not (... or auth.role() = 'service_role')` would NOT have been.
-- The distinction matters and is tested: inside a migration, on a psql connection, and
-- for any caller without a profile, these functions REFUSE. There is no path where an
-- unresolvable identity is treated as permission.
--
-- OPTIMISTIC CONCURRENCY, IDEMPOTENCY, IMMUTABLE AUDIT
-- ----------------------------------------------------
-- Same contract as the existing Step 8 single-record updates:
--   * p_expected_updated_at must match the row, or the call returns code='stale_token'
--     with the fresh row in `current`.
--   * p_operation_id is recorded in app.db_data_admin_audit_event, which is unique on
--     (operation_id, operation_item_key) and is UPDATE/DELETE-blocked by a trigger. A
--     retry replays the recorded outcome and re-applies nothing.
--   * Expected business failures return success=false and still write an audit row.
--     Unexpected exceptions raise and roll everything back, audit row included.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Access gate
-- -------------------------------------------------------------------------------------

create or replace function app.require_db_data_admin_product_depth_access()
returns void
language plpgsql
stable
set search_path = app, public
as $$
begin
  if not (
    app.has_any_role(array['administrator', 'designer']::app.app_role[])
    and app.has_explicit_app_access('admin')
  ) then
    raise exception 'db_data_admin product_depth: not authorized'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function app.require_db_data_admin_product_depth_access() is
  'Product Depth maintenance gate: the administrator OR designer role, AND an explicit, non-revoked admin app_access row. Widens only the role arm of app.require_db_data_admin_access() so the shared Designer role can maintain Depth (owner decision 1 on issue #597). Raises insufficient_privilege otherwise. Internal helper; not a browser RPC.';

revoke all on function app.require_db_data_admin_product_depth_access() from public, anon;

-- -------------------------------------------------------------------------------------
-- 2. Row projection
-- -------------------------------------------------------------------------------------

create or replace function app.db_data_admin_product_depth_row(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, core, public
as $$
  select jsonb_build_object(
    'id', pd.id,
    'legacy_id', pd.legacy_id,
    'code', pd.code,
    'label', pd.label,
    'status', pd.status::text,
    'source_system', pd.source_system,
    'sort_order', pd.sort_order,
    'created_at', pd.created_at,
    'updated_at', pd.updated_at
  )
  from core.product_depth pd
  where pd.id = p_id;
$$;

revoke all on function app.db_data_admin_product_depth_row(uuid) from public, anon, authenticated;

-- -------------------------------------------------------------------------------------
-- 3. Read contract
-- -------------------------------------------------------------------------------------

create or replace function api.db_data_admin_product_depth_list(
  p_search           text default null,
  p_include_inactive boolean default true,
  p_page_size        integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, core, public
as $$
declare
  v_rows jsonb;
begin
  perform app.require_db_data_admin_product_depth_access();

  select coalesce(jsonb_agg(r order by r->>'sort_order', r->>'label'), '[]'::jsonb)
    into v_rows
  from (
    select app.db_data_admin_product_depth_row(pd.id) as r
    from core.product_depth pd
    where (coalesce(p_include_inactive, true) or pd.status = 'active')
      and (
            p_search is null or btrim(p_search) = ''
            or pd.label ilike '%' || btrim(p_search) || '%'
            or pd.code  ilike '%' || btrim(p_search) || '%'
          )
    order by pd.sort_order nulls last, pd.label, pd.code
    limit greatest(1, least(coalesce(p_page_size, 500), 2000))
  ) s;

  return jsonb_build_object('rows', v_rows);
end;
$$;

comment on function api.db_data_admin_product_depth_list(text, boolean, integer) is
  'DB Data Admin Product Depth grid read. Requires administrator-or-designer plus explicit admin app_access. Includes inactive values by default so a maintainer can see and reactivate them. Issue #597 Phase 1.';

revoke all on function api.db_data_admin_product_depth_list(text, boolean, integer) from public, anon;
grant execute on function api.db_data_admin_product_depth_list(text, boolean, integer) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 4. Write contracts
-- -------------------------------------------------------------------------------------

create or replace function api.db_data_admin_upsert_product_depth(
  p_operation_id        uuid,
  p_reason              text,
  p_label               text,
  p_code                text,
  p_depth_id            uuid default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, core, public
as $$
declare
  v_existing app.db_data_admin_audit_event%rowtype;
  v_row      core.product_depth%rowtype;
  v_old      jsonb;
  v_new      jsonb;
  v_id       uuid;
  v_action   text;
  v_label    text := btrim(coalesce(p_label, ''));
  v_code     text := btrim(coalesce(p_code, ''));
begin
  perform app.require_db_data_admin_product_depth_access();

  if p_operation_id is null then
    raise exception 'db_data_admin product_depth: p_operation_id is required'
      using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'db_data_admin product_depth: a reason is required'
      using errcode = 'P0001';
  end if;

  -- IDEMPOTENCY: replay a recorded outcome; never re-apply.
  select * into v_existing
    from app.db_data_admin_audit_event
   where operation_id = p_operation_id and operation_item_key = 'primary';
  if found then
    return jsonb_build_object(
      'success', v_existing.succeeded,
      'code', v_existing.error_code,
      'idempotent_replay', true,
      'audit_id', v_existing.id,
      'row', v_existing.new_snapshot
    );
  end if;

  if v_label = '' or v_code = '' then
    return jsonb_build_object('success', false, 'code', 'validation',
      'message', 'code and label are both required and may not be blank');
  end if;

  if p_depth_id is null then
    -- CREATE
    v_action := 'product_depth_create';
    if exists (select 1 from core.product_depth where code = v_code) then
      return jsonb_build_object('success', false, 'code', 'duplicate_code',
        'message', format('a Product Depth with code %L already exists', v_code));
    end if;

    insert into core.product_depth (code, label, status, source_system, metadata)
    values (v_code, v_label, 'active', 'db_data_admin',
            jsonb_build_object('created_by_operation', p_operation_id))
    returning * into v_row;

    v_id := v_row.id;
    v_old := null;
  else
    -- UPDATE
    v_action := 'product_depth_update';
    select * into v_row from core.product_depth where id = p_depth_id for update;
    if not found then
      return jsonb_build_object('success', false, 'code', 'not_found',
        'message', 'that Product Depth no longer exists');
    end if;

    v_id  := v_row.id;
    v_old := app.db_data_admin_product_depth_row(v_id);

    if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object('success', false, 'code', 'stale_token',
        'message', 'someone else changed this row; reload and try again',
        'current', v_old);
    end if;

    if v_row.code = v_code and v_row.label = v_label then
      return jsonb_build_object('success', false, 'code', 'no_changes',
        'message', 'nothing to change', 'current', v_old);
    end if;

    if v_code <> v_row.code and exists (select 1 from core.product_depth where code = v_code) then
      return jsonb_build_object('success', false, 'code', 'duplicate_code',
        'message', format('a Product Depth with code %L already exists', v_code));
    end if;

    -- legacy_id is NEVER touched. Issue #597 requires the legacy identity preserved,
    -- and a rename must not break resolution of existing items.
    update core.product_depth
       set code = v_code, label = v_label, updated_at = now()
     where id = v_id;
  end if;

  v_new := app.db_data_admin_product_depth_row(v_id);

  insert into app.db_data_admin_audit_event (
    operation_id, entity_type, entity_id, action, old_snapshot, new_snapshot,
    reason, actor_profile_id, actor_user_id, succeeded
  ) values (
    p_operation_id, 'product_depth', v_id, v_action, v_old, v_new,
    btrim(p_reason), app.current_profile_id(), auth.uid(), true
  );

  return jsonb_build_object('success', true, 'idempotent_replay', false, 'row', v_new);
end;
$$;

comment on function api.db_data_admin_upsert_product_depth(uuid, text, text, text, uuid, timestamptz) is
  'The ONLY supported way to add or rename a Product Depth value. Administrator or Designer plus explicit admin app_access. Optimistic concurrency on updated_at, client operation-UUID idempotency, mandatory reason, immutable audit row. legacy_id is never modified. Issue #597 Phase 1.';

create or replace function api.db_data_admin_set_product_depth_status(
  p_operation_id        uuid,
  p_reason              text,
  p_depth_id            uuid,
  p_status              text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, core, public
as $$
declare
  v_existing app.db_data_admin_audit_event%rowtype;
  v_row      core.product_depth%rowtype;
  v_old      jsonb;
  v_new      jsonb;
  v_status   text := lower(btrim(coalesce(p_status, '')));
begin
  perform app.require_db_data_admin_product_depth_access();

  if p_operation_id is null or p_depth_id is null then
    raise exception 'db_data_admin product_depth: p_operation_id and p_depth_id are required'
      using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'db_data_admin product_depth: a reason is required'
      using errcode = 'P0001';
  end if;

  select * into v_existing
    from app.db_data_admin_audit_event
   where operation_id = p_operation_id and operation_item_key = 'primary';
  if found then
    return jsonb_build_object('success', v_existing.succeeded, 'code', v_existing.error_code,
      'idempotent_replay', true, 'audit_id', v_existing.id, 'row', v_existing.new_snapshot);
  end if;

  -- Only the two lifecycle values a maintainer is allowed to set. `archived` and
  -- `deleted` exist in the enum but are system/legacy states and are refused here.
  if v_status not in ('active', 'inactive') then
    return jsonb_build_object('success', false, 'code', 'validation',
      'message', 'status must be active or inactive');
  end if;

  select * into v_row from core.product_depth where id = p_depth_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'not_found',
      'message', 'that Product Depth no longer exists');
  end if;

  v_old := app.db_data_admin_product_depth_row(v_row.id);

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('success', false, 'code', 'stale_token',
      'message', 'someone else changed this row; reload and try again', 'current', v_old);
  end if;

  if v_row.status::text = v_status then
    return jsonb_build_object('success', false, 'code', 'no_changes',
      'message', 'nothing to change', 'current', v_old);
  end if;

  -- Deactivation is NEVER a delete. The row stays, so existing items keep resolving
  -- and only the picker stops offering it.
  update core.product_depth
     set status = v_status::app.entity_status, updated_at = now()
   where id = v_row.id;

  v_new := app.db_data_admin_product_depth_row(v_row.id);

  insert into app.db_data_admin_audit_event (
    operation_id, entity_type, entity_id, action, old_snapshot, new_snapshot,
    reason, actor_profile_id, actor_user_id, succeeded
  ) values (
    p_operation_id, 'product_depth', v_row.id, 'product_depth_set_status', v_old, v_new,
    btrim(p_reason), app.current_profile_id(), auth.uid(), true
  );

  return jsonb_build_object('success', true, 'idempotent_replay', false, 'row', v_new);
end;
$$;

comment on function api.db_data_admin_set_product_depth_status(uuid, text, uuid, text, timestamptz) is
  'The ONLY supported way to activate or deactivate a Product Depth value. Administrator or Designer plus explicit admin app_access. Deactivation sets status=inactive and NEVER deletes, so existing items keep resolving while the picker stops offering the value. Refuses archived/deleted. Issue #597 Phase 1.';

revoke all on function api.db_data_admin_upsert_product_depth(uuid, text, text, text, uuid, timestamptz) from public, anon;
revoke all on function api.db_data_admin_set_product_depth_status(uuid, text, uuid, text, timestamptz) from public, anon;

grant execute on function api.db_data_admin_upsert_product_depth(uuid, text, text, text, uuid, timestamptz) to authenticated, service_role;
grant execute on function api.db_data_admin_set_product_depth_status(uuid, text, uuid, text, timestamptz) to authenticated, service_role;
