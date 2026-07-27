create or replace function api.pm_my_work_page(
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
declare v_profile_id uuid;
begin
  v_profile_id := nullif(api.current_user_profile()->>'id','')::uuid;
  if v_profile_id is null then raise exception using errcode='42501',message='PM_PROFILE_REQUIRED'; end if;
  if (p_after_updated_at is null)<>(p_after_id is null) then raise exception using errcode='22023',message='PM_INVALID_CURSOR'; end if;
  return query
  select p.id,p.name,p.status,p.stage,p.lifecycle_status,p.cover_url,p.project_id,p.design_id,
    p.company_id,p.buyer_contact_id,p.factory_id,p.licensor_id,p.property_id,p.product_type_id,
    p.updated_at,
    jsonb_build_object(
      'business_unit',coalesce(p.metadata->>'business_unit',p.metadata->>'department'),
      'next_owner_user',p.metadata->>'next_owner_user','next_owner_role',p.metadata->>'next_owner_role',
      'next_action',p.metadata->>'next_action','waiting_on',p.metadata->>'waiting_on',
      'blocker_reason',p.metadata->>'blocker_reason','priority',p.metadata->>'priority',
      'due_at',p.metadata->>'due_at'
    )
  from pim.product p
  where (exists(select 1 from pim.product_assignee pa where pa.product_id=p.id and pa.profile_id=v_profile_id)
      or p.metadata->>'next_owner_user'=v_profile_id::text
      or (p_role_id is not null and p.metadata->>'next_owner_role'=p_role_id::text))
    and (p_after_updated_at is null or (p.updated_at,p.id)<(p_after_updated_at,p_after_id))
  order by p.updated_at desc,p.id desc
  limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

revoke all on function api.pm_my_work_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function api.pm_my_work_page(uuid,timestamptz,uuid,integer) to authenticated;
