-- Hosted Supabase installs pgcrypto in extensions, not public.
-- Replace only the private preview helper to qualify digest explicitly.
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
revoke all on function app.db_data_admin_merge_preview(text,uuid,uuid) from public;
