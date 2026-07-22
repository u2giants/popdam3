-- Rollback-safe Step 9 preview-detail contract test.
-- Run on preview only after migration 20260722210000.
-- Proves the merge preview exposes the ACTUAL aliases and source references that
-- will move (not just counts), that they are token-covered (mutating them makes
-- the token stale), and that the executed merge really transfers them.
begin;
do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
  v_profile uuid; v_auth uuid; v_role uuid;
  v_s uuid; v_l uuid; v_vs uuid; v_vl uuid;
  v_preview jsonb; v_preview2 jsonb; v_result jsonb; v_token text; v_op uuid := gen_random_uuid();
  v_aliases jsonb; v_srefs jsonb;
begin
  select p.id,p.auth_user_id into v_profile,v_auth from app.profile p
  where p.status='active' and p.auth_user_id is not null order by p.created_at,p.id limit 1;
  select id into v_role from app.role where slug='administrator'::app.app_role;
  delete from app.user_role where profile_id=v_profile and role_id=v_role;
  delete from app.app_access where profile_id=v_profile and app='admin';
  insert into app.user_role(profile_id,role_id) values(v_profile,v_role);
  insert into app.app_access(profile_id,app) values(v_profile,'admin');
  perform set_config('request.jwt.claim.sub',v_auth::text,true);

  -- Customer fixture: loser carries a real alias and a real source reference.
  insert into core.customer(name,display_name,status) values('Preview survivor '||v_suffix,'Survivor','active') returning id into v_s;
  insert into core.customer(name,display_name,status) values('Preview loser '||v_suffix,'Loser '||v_suffix,'active') returning id into v_l;
  insert into core.customer_alias(customer_id,alias,alias_type,source_system)
    values(v_l,'Legacy Loser Co '||v_suffix,'legacy_name','step9-test');
  insert into core.company_source_ref(company_id,source_system,source_table,source_id,source_code,source_name)
    values(v_l,'step9-test','customers',v_suffix,'OLD-'||v_suffix,'Loser Source '||v_suffix);

  v_preview := api.db_data_admin_preview_customer_merge(v_s,v_l);
  if not (v_preview->>'success')::boolean then raise exception 'preview failed: %',v_preview; end if;

  -- moving_aliases must contain the actual existing alias AND the loser-name alias.
  v_aliases := v_preview#>'{preview,moving_aliases}';
  if v_aliases is null or jsonb_typeof(v_aliases)<>'array' then
    raise exception 'moving_aliases missing from preview: %',v_preview;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_aliases) e
    where e->>'alias' = 'Legacy Loser Co '||v_suffix and e->>'origin'='existing_alias'
  ) then raise exception 'preview did not expose the actual moving alias: %',v_aliases; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_aliases) e
    where e->>'alias' = 'Loser '||v_suffix and e->>'origin'='loser_name'
  ) then raise exception 'preview did not expose the loser-name alias: %',v_aliases; end if;

  -- moving_source_refs must contain the actual source reference that transfers.
  v_srefs := v_preview#>'{preview,moving_source_refs}';
  if not exists (
    select 1 from jsonb_array_elements(v_srefs) e where e->>'source_id' = v_suffix and e->>'source_code'='OLD-'||v_suffix
  ) then raise exception 'preview did not expose the actual moving source reference: %',v_srefs; end if;

  -- Token coverage: adding an alias to the loser must change the preview token.
  v_token := v_preview->>'preview_token';
  insert into core.customer_alias(customer_id,alias,alias_type,source_system)
    values(v_l,'Another Loser Alias '||v_suffix,'legacy_name','step9-test');
  v_preview2 := api.db_data_admin_preview_customer_merge(v_s,v_l);
  if (v_preview2->>'preview_token') = v_token then
    raise exception 'moving aliases are not covered by the preview token';
  end if;

  -- Execute with the fresh token; the aliases and source refs must actually move.
  update app.db_data_admin_feature_gate set enabled=true where feature='merge_execute';
  v_result := api.db_data_admin_merge_customer(v_s,v_l,v_preview2->>'preview_token',v_op,'verified duplicate','{}');
  if not (v_result->>'success')::boolean or exists(select 1 from core.customer where id=v_l) then
    raise exception 'customer merge failed: %',v_result;
  end if;
  if not exists(select 1 from core.company_source_ref where company_id=v_s and source_id=v_suffix)
     or not exists(select 1 from core.customer_alias where customer_id=v_s and normalized_alias=lower('Legacy Loser Co '||v_suffix))
     or not exists(select 1 from core.customer_alias where customer_id=v_s and normalized_alias=lower('Loser '||v_suffix)) then
    raise exception 'previewed aliases/source references were not actually transferred';
  end if;

  -- Vendor fixture: loser source reference (no source_name column) must appear.
  insert into core.factory(name,code,status) values('Preview vendor survivor '||v_suffix,'PVS-'||v_suffix,'active') returning id into v_vs;
  insert into core.factory(name,code,status) values('Preview vendor loser '||v_suffix,'PVL-'||v_suffix,'active') returning id into v_vl;
  insert into core.factory_source_ref(factory_id,source_system,source_table,source_id,source_code)
    values(v_vl,'step9-test','vendors',v_suffix,'PVL-'||v_suffix);
  v_preview := api.db_data_admin_preview_vendor_merge(v_vs,v_vl);
  if not exists (
    select 1 from jsonb_array_elements(v_preview#>'{preview,moving_source_refs}') e where e->>'source_id'=v_suffix
  ) then raise exception 'vendor preview did not expose the moving source reference: %',v_preview; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_preview#>'{preview,moving_aliases}') e where e->>'origin'='loser_name'
  ) then raise exception 'vendor preview did not expose the loser-name alias: %',v_preview; end if;
end $$;
rollback;
