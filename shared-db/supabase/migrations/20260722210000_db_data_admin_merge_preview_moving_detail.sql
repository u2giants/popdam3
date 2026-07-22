-- DB Data Admin Step 9 correction: the merge preview must display exactly what
-- will move or change (DB_Data_Admin.md §8.3), including the actual aliases and
-- source references that transfer from the loser to the survivor — not only the
-- affected-row counts and extension conflicts.
--
-- Additive and preview-first: this only extends the private preview projection
-- with two new token-covered arrays (moving_aliases, moving_source_refs). Because
-- these arrays are folded into the same v_payload that is hashed into the
-- preview_token, and app.db_data_admin_merge_execute recomputes the token by
-- calling this same function, the displayed detail is an exact, token-covered
-- representation: if the loser's aliases or source references change between
-- preview and execute, the token goes stale and the merge is loudly rejected.
--
-- No new privileges. Execution stays behind the off-by-default merge_execute gate.
-- Never edit the already-applied 20260722194000 / 20260722194100 migrations.

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
revoke all on function app.db_data_admin_merge_preview(text,uuid,uuid) from public;
