-- DB Data Admin Step 9: protected, preview-first Customer and Vendor merges.
-- Additive only. Production execution remains disabled by the merge_execute gate.

insert into app.db_data_admin_feature_gate(feature, enabled, notes) values
  ('merge_execute', false, 'Step 9 destructive merge execution. Enable on preview only until production approval.')
on conflict (feature) do nothing;

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
revoke all on function app.db_data_admin_merge_fk_counts(regclass,uuid) from public;

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
revoke all on function app.db_data_admin_extension_conflicts(regclass,text,uuid,uuid,text) from public;

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
revoke all on function app.db_data_admin_reconcile_extension(regclass,text,uuid,uuid,text,jsonb) from public;

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
revoke all on function app.db_data_admin_merge_preview(text,uuid,uuid) from public;

create or replace function api.db_data_admin_preview_customer_merge(p_survivor_id uuid,p_loser_id uuid)
returns jsonb language sql stable security definer set search_path=api,public
as $$ select app.db_data_admin_merge_preview('customer',p_survivor_id,p_loser_id) $$;
create or replace function api.db_data_admin_preview_vendor_merge(p_survivor_id uuid,p_loser_id uuid)
returns jsonb language sql stable security definer set search_path=api,public
as $$ select app.db_data_admin_merge_preview('vendor',p_survivor_id,p_loser_id) $$;

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
revoke all on function app.db_data_admin_merge_execute(text,uuid,uuid,text,uuid,text,jsonb) from public;

create or replace function api.db_data_admin_merge_customer(p_survivor_id uuid,p_loser_id uuid,p_preview_token text,p_operation_id uuid,p_reason text,p_resolutions jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=api,public
as $$ select app.db_data_admin_merge_execute('customer',p_survivor_id,p_loser_id,p_preview_token,p_operation_id,p_reason,p_resolutions) $$;
create or replace function api.db_data_admin_merge_vendor(p_survivor_id uuid,p_loser_id uuid,p_preview_token text,p_operation_id uuid,p_reason text,p_resolutions jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=api,public
as $$ select app.db_data_admin_merge_execute('vendor',p_survivor_id,p_loser_id,p_preview_token,p_operation_id,p_reason,p_resolutions) $$;

revoke all on function api.db_data_admin_preview_customer_merge(uuid,uuid),api.db_data_admin_preview_vendor_merge(uuid,uuid),api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb),api.db_data_admin_merge_vendor(uuid,uuid,text,uuid,text,jsonb) from public;
grant execute on function api.db_data_admin_preview_customer_merge(uuid,uuid),api.db_data_admin_preview_vendor_merge(uuid,uuid),api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb),api.db_data_admin_merge_vendor(uuid,uuid,text,uuid,text,jsonb) to authenticated;
