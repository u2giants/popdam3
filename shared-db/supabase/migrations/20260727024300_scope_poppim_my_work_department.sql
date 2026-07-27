-- Preview correction: My Work is department-scoped like every other Poppim
-- screen. The profile is always derived from auth.uid(); callers cannot select
-- another profile.

drop function if exists api.pm_my_work_page(uuid,timestamptz,uuid,integer);

create or replace function api.pm_my_work_page(
  p_business_unit text,
  p_role_id uuid default null,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 100
)
returns table(
  id uuid,name text,status text,stage text,lifecycle_status text,cover_url text,
  project_id uuid,design_id uuid,company_id uuid,buyer_contact_id uuid,
  factory_id uuid,licensor_id uuid,property_id uuid,product_type_id uuid,
  updated_at timestamptz,metadata jsonb
)
language plpgsql stable security invoker set search_path='' as $$
declare v_profile_id uuid; v_units text[];
begin
  v_profile_id := nullif(api.current_user_profile()->>'id','')::uuid;
  if v_profile_id is null then raise exception using errcode='42501',message='PM_PROFILE_REQUIRED'; end if;
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units:=array['licensed','pop','pop creations'];
    when 'generic' then v_units:=array['generic','spruce','spruce line'];
    when 'software' then v_units:=array['software'];
    else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';
  end case;
  if (p_after_updated_at is null)<>(p_after_id is null) then raise exception using errcode='22023',message='PM_INVALID_CURSOR'; end if;
  return query
  select p.id,p.name,p.status,p.stage,p.lifecycle_status,p.cover_url,p.project_id,p.design_id,
    p.company_id,p.buyer_contact_id,p.factory_id,p.licensor_id,p.property_id,p.product_type_id,
    p.updated_at,
    jsonb_build_object('business_unit',coalesce(p.metadata->>'business_unit',p.metadata->>'department'),
      'next_owner_user',p.metadata->>'next_owner_user','next_owner_role',p.metadata->>'next_owner_role',
      'next_action',p.metadata->>'next_action','waiting_on',p.metadata->>'waiting_on',
      'blocker_reason',p.metadata->>'blocker_reason','priority',p.metadata->>'priority','due_at',p.metadata->>'due_at')
  from pim.product p
  where lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
    and (exists(select 1 from pim.product_assignee pa where pa.product_id=p.id and pa.profile_id=v_profile_id)
      or p.metadata->>'next_owner_user'=v_profile_id::text
      or (p_role_id is not null and p.metadata->>'next_owner_role'=p_role_id::text))
    and (p_after_updated_at is null or (p.updated_at,p.id)<(p_after_updated_at,p_after_id))
  order by p.updated_at desc,p.id desc
  limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

create or replace function api.pm_my_revision_page(p_business_unit text,p_limit integer default 100)
returns table(id uuid,product_id uuid,submission_id uuid,requested_by_profile_id uuid,status text,body text,requested_at timestamptz,resolved_at timestamptz,metadata jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare v_profile_id uuid;v_units text[];
begin
  v_profile_id:=nullif(api.current_user_profile()->>'id','')::uuid;
  if v_profile_id is null then raise exception using errcode='42501',message='PM_PROFILE_REQUIRED';end if;
  case lower(btrim(p_business_unit)) when 'licensed' then v_units:=array['licensed','pop','pop creations'];when 'generic' then v_units:=array['generic','spruce','spruce line'];when 'software' then v_units:=array['software'];else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';end case;
  return query select r.id,r.product_id,r.submission_id,r.requested_by_profile_id,r.status,r.body,r.requested_at,r.resolved_at,r.metadata
  from pim.revision_request r join pim.product p on p.id=r.product_id
  where lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
    and r.metadata->>'assigned_to'=v_profile_id::text and lower(r.status) not in ('resolved','accepted','rejected','canceled')
  order by r.requested_at desc,r.id desc limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

create or replace function api.pm_my_reminder_page(p_business_unit text,p_limit integer default 100)
returns table(id uuid,target_table text,target_id uuid,title text,body text,profile_id uuid,read_at timestamptz,created_at timestamptz,payload jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare v_profile_id uuid;v_units text[];
begin
  v_profile_id:=nullif(api.current_user_profile()->>'id','')::uuid;
  if v_profile_id is null then raise exception using errcode='42501',message='PM_PROFILE_REQUIRED';end if;
  case lower(btrim(p_business_unit)) when 'licensed' then v_units:=array['licensed','pop','pop creations'];when 'generic' then v_units:=array['generic','spruce','spruce line'];when 'software' then v_units:=array['software'];else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';end case;
  return query select n.id,n.target_table,n.target_id,n.title,n.body,n.profile_id,n.read_at,n.created_at,n.payload
  from app.notification n join pim.product p on n.target_table='product' and p.id=n.target_id
  where n.app='pm' and n.profile_id=v_profile_id and n.read_at is null
    and lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
  order by n.created_at desc,n.id desc limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

revoke all on function api.pm_my_work_page(text,uuid,timestamptz,uuid,integer) from public,anon;
revoke all on function api.pm_my_revision_page(text,integer) from public,anon;
revoke all on function api.pm_my_reminder_page(text,integer) from public,anon;
grant execute on function api.pm_my_work_page(text,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function api.pm_my_revision_page(text,integer) to authenticated;
grant execute on function api.pm_my_reminder_page(text,integer) to authenticated;
