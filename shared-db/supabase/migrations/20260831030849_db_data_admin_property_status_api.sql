-- Issue #1952: narrow guarded Property lifecycle update for DB Data Admin.
-- derived-from: none

create or replace function api.db_data_admin_set_property_status(
  p_operation_id uuid,
  p_reason text,
  p_property_id uuid,
  p_status text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, app, core, plm, extensions
as $$
declare
  v_existing app.db_data_admin_audit_event%rowtype;
  v_property core.property%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_old jsonb;
  v_new jsonb;
  v_authorization_id uuid;
  v_actor text;
begin
  perform app.require_licensing_manager_access();
  v_actor := coalesce(app.current_profile_id()::text, auth.uid()::text);

  if p_operation_id is null or p_property_id is null then
    raise exception 'db_data_admin property status: operation and Property are required'
      using errcode = '22023';
  end if;
  if v_reason = '' then
    raise exception 'db_data_admin property status: a reason is required'
      using errcode = '22023';
  end if;

  select * into v_existing
  from app.db_data_admin_audit_event
  where operation_id = p_operation_id and operation_item_key = 'primary';
  if found then
    if v_existing.entity_type <> 'property'
       or v_existing.entity_id <> p_property_id
       or v_existing.action <> 'property_set_status'
       or v_existing.new_snapshot ->> 'status' is distinct from v_status
       or v_existing.reason is distinct from v_reason
       or (v_existing.old_snapshot ->> 'updated_at')::timestamptz
          is distinct from p_expected_updated_at
       or v_existing.actor_profile_id is distinct from app.current_profile_id()
       or v_existing.actor_user_id is distinct from auth.uid() then
      raise exception 'db_data_admin property status: operation id already belongs to another action'
        using errcode = '23505';
    end if;
    return jsonb_build_object('success', v_existing.succeeded,
      'code', v_existing.error_code, 'idempotent_replay', true,
      'audit_id', v_existing.id, 'row', v_existing.new_snapshot);
  end if;

  if v_status not in ('active', 'inactive') then
    return jsonb_build_object('success', false, 'code', 'validation',
      'message', 'status must be active or inactive');
  end if;

  select * into v_property from core.property where id = p_property_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'not_found',
      'message', 'that Property no longer exists');
  end if;

  v_old := jsonb_build_object('id',v_property.id,'status',v_property.status,
    'updated_at',v_property.updated_at);
  if p_expected_updated_at is null or v_property.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('success', false, 'code', 'stale_token',
      'message', 'someone else changed this Property; reload and try again', 'current', v_old);
  end if;
  if v_property.status::text = v_status then
    return jsonb_build_object('success', false, 'code', 'no_changes',
      'message', 'nothing to change', 'current', v_old);
  end if;

  insert into plm.licensing_write_authorization(
    backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,
    actor,protected_columns,expires_at)
  values(
    pg_backend_pid(),txid_current(),'core.property','coldlion_status',p_operation_id,
    encode(extensions.digest(concat_ws('/', '1952',p_operation_id::text,
      p_property_id::text,v_status,v_reason,p_expected_updated_at::text,v_actor),
      'sha256'),'hex'),
    v_actor,array['status'],clock_timestamp()+interval '1 minute')
  returning id into v_authorization_id;

  update core.property set status=v_status::app.entity_status, updated_at=clock_timestamp()
  where id=v_property.id;

  if not exists(select 1 from plm.licensing_write_authorization
      where id=v_authorization_id and consumed_at is not null)
     or not exists(select 1 from plm.licensing_write_guard_audit
      where authorization_id=v_authorization_id and target_table='core.property'::regclass
        and operation='UPDATE' and write_kind='coldlion_status'
        and protected_columns=array['status']::text[]) then
    raise exception 'db_data_admin property status: licensing guard evidence missing'
      using errcode = 'P0001';
  end if;

  select jsonb_build_object('id',id,'status',status,'updated_at',updated_at)
  into v_new from core.property where id=v_property.id;
  insert into app.db_data_admin_audit_event(
    operation_id,entity_type,entity_id,action,old_snapshot,new_snapshot,reason,
    actor_profile_id,actor_user_id,succeeded)
  values(p_operation_id,'property',v_property.id,'property_set_status',v_old,v_new,v_reason,
    app.current_profile_id(),auth.uid(),true);

  return jsonb_build_object('success',true,'idempotent_replay',false,
    'authorization_id',v_authorization_id,'row',v_new);
end;
$$;

comment on function api.db_data_admin_set_property_status(uuid,text,uuid,text,timestamptz) is
  'Authenticated DB Data Admin licensing-manager RPC for one Property active/inactive transition. Creates an exact transaction-bound status-only authorization, requires the canonical guard to consume it, and retains both licensing and DB Data Admin audit evidence.';
revoke all on function api.db_data_admin_set_property_status(uuid,text,uuid,text,timestamptz)
  from public, anon, service_role;
grant execute on function api.db_data_admin_set_property_status(uuid,text,uuid,text,timestamptz)
  to authenticated;

