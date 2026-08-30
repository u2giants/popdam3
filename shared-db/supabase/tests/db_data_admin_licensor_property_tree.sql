-- Rollback-safe canonical Licensing Manager tree contract after issue #1684.
begin;

do $contracts$
declare
  v_sig regprocedure := 'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)'::regprocedure;
  v_definition text;
  v_admin_role uuid;
  v_licensing_role uuid;
  v_profile uuid;
  v_auth uuid;
  v_denied_profile uuid;
  v_denied_auth uuid;
  v_licensor uuid := '14000000-0000-4000-8000-000000000001';
  v_property uuid := '14000000-0000-4000-8000-000000000002';
  v_character uuid := '14000000-0000-4000-8000-000000000003';
  v_licensor_2 uuid := '14000000-0000-4000-8000-000000000011';
  v_licensor_3 uuid := '14000000-0000-4000-8000-000000000012';
  v_licensor_inactive uuid := '14000000-0000-4000-8000-000000000013';
  v_page jsonb;
  v_page_2 jsonb;
begin
  if has_function_privilege('public', v_sig, 'execute')
     or not has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'Licensing Manager tree execution grants changed';
  end if;
  select pg_get_functiondef(v_sig) into v_definition;
  if position('security definer' in lower(v_definition)) = 0
     or position('app.require_licensing_manager_access()' in v_definition) = 0 then
    raise exception 'Licensing Manager tree lost its server-side authorization boundary';
  end if;
  if position('core.licensor l' in v_definition) = 0
     or position('core.property p' in v_definition) = 0
     or position('core.property_character_associations a' in v_definition) = 0
     or position('properties_and_characters' in v_definition) > 0 then
    raise exception 'Licensing Manager tree does not use the separated canonical contract';
  end if;

  select p.id,p.auth_user_id into v_profile,v_auth
  from app.profile p where p.status='active' and p.auth_user_id is not null
  order by p.created_at,p.id limit 1;
  select p.id,p.auth_user_id into v_denied_profile,v_denied_auth
  from app.profile p where p.status='active' and p.auth_user_id is not null
  order by p.created_at,p.id limit 1 offset 1;
  if v_profile is null or v_denied_profile is null then
    raise exception 'fixture requires two active authenticated profiles';
  end if;
  select id into v_admin_role from app.role where slug='administrator'::app.app_role;
  delete from app.user_role where profile_id in (v_profile,v_denied_profile) and role_id=v_admin_role;
  delete from app.app_access where profile_id in (v_profile,v_denied_profile) and app in ('admin','plm');
  perform set_config('request.jwt.claim.sub',v_denied_auth::text,true);
  begin
    perform api.db_data_admin_licensor_property_tree(null,true,null,1);
    raise exception 'unauthorized caller was allowed';
  exception when insufficient_privilege then null;
  end;
  select id into v_licensing_role from app.role where slug='licensing'::app.app_role;
  insert into app.user_role(profile_id,role_id) values(v_denied_profile,v_licensing_role);
  insert into app.app_access(profile_id,app) values(v_denied_profile,'plm');
  begin
    perform api.db_data_admin_licensor_property_tree(null,true,null,1);
  exception when insufficient_privilege then
    raise exception 'narrow Licensing-plus-PLM caller was denied';
  end;
  insert into app.user_role(profile_id,role_id) values(v_profile,v_admin_role);
  insert into app.app_access(profile_id,app) values(v_profile,'admin');
  perform set_config('request.jwt.claim.sub',v_auth::text,true);

  insert into core.licensor(id,name,code,status)
  values(v_licensor,'Issue 1400 Canonical Licensor','I1400','active');
  insert into core.property(id,licensor_id,name,code,status)
  values(v_property,v_licensor,'Issue 1400 Canonical Property','I1400-P','active');
  insert into core.character(id,licensor_id,name,code,status)
  values(v_character,v_licensor,'Issue 1400 Canonical Character','I1400-C','active');
  insert into core.property_character_associations(property_id,character_id)
  values(v_property,v_character);

  insert into core.licensor(id,name,code,status) values
    (v_licensor_2,'Issue 1400 Canonical Tie','I1400-2','active'),
    (v_licensor_3,'Issue 1400 Canonical TIE','I1400-3','active'),
    (v_licensor_inactive,'Issue 1400 Inactive','I1400-X','inactive');

  select api.db_data_admin_licensor_property_tree('Issue 1400 Canonical',true,null,1)
    into v_page;
  if jsonb_array_length(v_page->'licensors') <> 1
     or v_page#>>'{licensors,0,id}' <> v_licensor::text
     or v_page#>>'{licensors,0,properties,0,id}' <> v_property::text
     or (v_page#>>'{licensors,0,properties,0,character_count}')::integer <> 1 then
    raise exception 'canonical Licensing Manager hierarchy result is wrong: %',v_page;
  end if;
  if v_page#>>'{snapshot,store}' <> 'core.licensor / core.property'
     or v_page#>>'{snapshot,source_system}' <> 'normalized_authoritative_sources' then
    raise exception 'tree still advertises the retired mixed source: %',v_page->'snapshot';
  end if;
  if v_page->>'next_cursor' is null then
    raise exception 'first keyset page did not provide a continuation cursor';
  end if;
  select api.db_data_admin_licensor_property_tree(
    'Issue 1400 Canonical',true,v_page->>'next_cursor',1
  ) into v_page_2;
  if jsonb_array_length(v_page_2->'licensors') <> 1
     or v_page_2#>>'{licensors,0,id}' = v_page#>>'{licensors,0,id}' then
    raise exception 'UUID keyset pagination duplicated or omitted a page: %, %',v_page,v_page_2;
  end if;
  select api.db_data_admin_licensor_property_tree('Issue 1400 Inactive',false,null,10)
    into v_page_2;
  if jsonb_array_length(v_page_2->'licensors') <> 0 then
    raise exception 'inactive Licensor escaped include_inactive=false';
  end if;
  begin
    perform api.db_data_admin_licensor_property_tree(null,true,'not-a-cursor',1);
    raise exception 'invalid cursor was accepted';
  exception when invalid_parameter_value then null;
  end;
end
$contracts$;

rollback;
