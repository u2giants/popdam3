-- Synthetic rollback-only regression for the single operative source crosswalk.
-- Canonical UUID resolution remains a distinct, untouched contract.
begin;
create function pg_temp.crosswalk_header(p_id uuid,p_key text,p_version bigint,p_state text,p_previous uuid default null)
returns void language sql as $$
  insert into plm.dcp_opa_property_resolution(resolution_id,source_system,source_table,source_property_id,
    decision_version,approval_status,supersedes_resolution_id,evidence_reference,evidence_sha256,
    decision_reason,approved_at,approved_by,creative_decision_state)
  values(p_id,'synthetic_creative','plm.synthetic_property',p_key,p_version,'approved',p_previous,
    'synthetic reviewed decision',repeat('a',64),'synthetic audit',now(),'synthetic reviewer',p_state);
$$;
create function pg_temp.crosswalk_member(p_id uuid,p_key text,p_ordinal integer default 1)
returns void language sql as $$
  insert into plm.dcp_opa_property_resolution_member(resolution_id,submission_source_system,
    submission_source_table,submission_source_id,member_ordinal)
  values(p_id,'synthetic_submission','plm.synthetic_property',p_key,p_ordinal);
$$;
do $$
declare
  unmapped uuid:=gen_random_uuid(); conflict uuid:=gen_random_uuid(); first_map uuid:=gen_random_uuid();
  second_map uuid:=gen_random_uuid(); key_prefix text:=gen_random_uuid()::text;
  legacy uuid:=gen_random_uuid(); profile_id uuid; auth_id uuid;
  failed boolean; table_name text; privilege_name text; current_count bigint;
begin
  perform pg_temp.crosswalk_header(unmapped,key_prefix||'-unmapped',1,'unmapped');
  perform pg_temp.crosswalk_header(conflict,key_prefix||'-conflict',1,'conflict');
  perform pg_temp.crosswalk_member(conflict,'candidate');
  perform pg_temp.crosswalk_header(first_map,key_prefix||'-mapped',1,'mapped');
  perform pg_temp.crosswalk_member(first_map,'member-a');
  perform pg_temp.crosswalk_member(first_map,'member-b',2);
  perform pg_temp.crosswalk_header(second_map,key_prefix||'-mapped',2,'mapped',first_map);
  perform pg_temp.crosswalk_member(second_map,'member-c');
  set constraints all immediate; set constraints all deferred;
  if (select count(*) from plm.dcp_opa_property_resolution_member where resolution_id=first_map)<>2 then
    raise exception 'one-to-many mapping was collapsed'; end if;
  if (select creative_decision_state from plm.dcp_opa_property_resolution where resolution_id=conflict)<>'conflict' then
    raise exception 'conflict disposition was lost'; end if;
  failed:=false;
  begin
    perform pg_temp.crosswalk_header(gen_random_uuid(),key_prefix||'-memberless',1,'mapped');
    set constraints all immediate;
  exception when check_violation then failed:=true; end;
  set constraints all deferred;
  if not failed then raise exception 'memberless mapped decision accepted'; end if;
  failed:=false;
  begin perform pg_temp.crosswalk_member(unmapped,'forbidden'); set constraints all immediate;
  exception when check_violation then failed:=true; end;
  set constraints all deferred;
  if not failed then raise exception 'member-bearing unmapped decision accepted'; end if;
  failed:=false;
  begin perform pg_temp.crosswalk_header(gen_random_uuid(),key_prefix||'-mapped',2,'conflict');
  exception when unique_violation or check_violation then failed:=true; end;
  if not failed then raise exception 'duplicate decision version accepted'; end if;
  failed:=false;
  begin perform pg_temp.crosswalk_member(first_map,'member-a',3);
  exception when unique_violation then failed:=true; end;
  if not failed then raise exception 'duplicate exact member accepted'; end if;
  failed:=false;
  begin perform pg_temp.crosswalk_header(gen_random_uuid(),key_prefix||'-other',3,'conflict',second_map);
  exception when foreign_key_violation or check_violation then failed:=true; end;
  if not failed then raise exception 'cross-identity supersession accepted'; end if;
  failed:=false;
  begin perform pg_temp.crosswalk_header(gen_random_uuid(),key_prefix||'-mapped',3,'conflict',first_map);
  exception when unique_violation then failed:=true; end;
  if not failed then raise exception 'second direct successor accepted'; end if;
  failed:=false;
  begin update plm.dcp_opa_property_resolution set decision_reason='rewrite' where resolution_id=first_map;
  exception when object_not_in_prerequisite_state or restrict_violation then failed:=true; end;
  if not failed then raise exception 'header rewrite accepted'; end if;
  failed:=false;
  begin delete from plm.dcp_opa_property_resolution_member where resolution_id=first_map;
  exception when object_not_in_prerequisite_state or restrict_violation then failed:=true; end;
  if not failed then raise exception 'member deletion accepted'; end if;
  foreach table_name in array array['dcp_opa_property_resolution','dcp_opa_property_resolution_member'] loop
    foreach privilege_name in array array['SELECT','INSERT'] loop
      if not has_table_privilege('service_role','plm.'||table_name,privilege_name) then
        raise exception 'service read/append capability lost'; end if;
    end loop;
    if has_table_privilege('service_role','plm.'||table_name,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'service mutation privilege widened'; end if;
    failed:=false;
    begin execute format('truncate table plm.%I',table_name);
    exception when object_not_in_prerequisite_state or restrict_violation or feature_not_supported then failed:=true; end;
    if not failed then raise exception 'owner-path truncate accepted'; end if;
  end loop;
  foreach table_name in array array['creative_submission_property_resolution_archive','creative_submission_property_resolution_member_archive'] loop
    if not has_table_privilege('service_role','plm.'||table_name,'SELECT')
       or has_table_privilege('service_role','plm.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       or has_table_privilege('authenticated','plm.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('anon','plm.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'archive access is not private read-only'; end if;
    failed:=false;
    begin execute format('insert into plm.%I default values',table_name);
    exception when object_not_in_prerequisite_state or restrict_violation then failed:=true; end;
    if not failed then raise exception 'archive insertion accepted'; end if;
    failed:=false;
    begin execute format('truncate table plm.%I',table_name);
    exception when object_not_in_prerequisite_state or restrict_violation or feature_not_supported then failed:=true; end;
    if not failed then raise exception 'archive truncate accepted'; end if;
  end loop;
  set constraints all immediate;
  insert into plm.dcp_opa_property_resolution(resolution_id,source_system,source_table,source_property_id,
    decision_version,approval_status,evidence_reference,evidence_sha256,decision_reason)
    values(legacy,'synthetic_creative','plm.dcp_property',key_prefix||'-legacy',1,'pending','synthetic',repeat('b',64),'synthetic');
  perform pg_temp.crosswalk_member(legacy,'legacy-member');
  select p.id,p.auth_user_id into strict profile_id,auth_id from app.profile p
    where p.status='active' and p.auth_user_id is not null order by p.created_at,p.id limit 1;
  insert into app.user_role(profile_id,role_id)
    select profile_id,r.id from app.role r where r.slug='licensing'::app.app_role
    on conflict do nothing;
  perform set_config('request.jwt.claim.sub',auth_id::text,true);
  set local role authenticated;
  if not exists(select 1 from plm.dcp_opa_property_resolution where resolution_id=legacy) then
    raise exception 'positive control: original authorized DCP read was lost'; end if;
  if not exists(select 1 from plm.dcp_opa_property_resolution_member where resolution_id=legacy) then
    raise exception 'positive control: original authorized DCP member read was lost'; end if;
  select count(*) into current_count from plm.dcp_opa_property_resolution where resolution_id in (unmapped,conflict,first_map,second_map);
  if current_count<>0 then raise exception 'generic decisions leaked through DCP table grant'; end if;
  select count(*) into current_count from plm.dcp_opa_property_resolution_member where resolution_id in (unmapped,conflict,first_map,second_map);
  if current_count<>0 then raise exception 'generic members leaked through DCP table grant'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  set local role authenticated;
  if exists(select 1 from plm.dcp_opa_property_resolution where resolution_id=legacy)
     or exists(select 1 from plm.dcp_opa_property_resolution_member where resolution_id=legacy) then
    raise exception 'unentitled signed-in account gained legacy DCP access'; end if;
  reset role;
end;
$$;
rollback;
