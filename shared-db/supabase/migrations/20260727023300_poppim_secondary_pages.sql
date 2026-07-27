-- Bounded secondary-screen contracts. Search/window/department predicates run
-- before limits and every order has a UUID tie-breaker.

create or replace function api.pm_project_page(
  p_business_unit text,
  p_search text default null,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, title text, status text, business_unit text, company_id uuid,
  company_name text, contact_id uuid, contact_name text,
  design_collection_id uuid, collection_name text, on_shelf_date text,
  pps_requested_date text, brief text, restrictions text,
  product_count bigint, updated_at timestamptz
)
language plpgsql stable security invoker set search_path = ''
as $$
declare v_units text[];
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units := array['licensed','pop','pop creations'];
    when 'generic' then v_units := array['generic','spruce','spruce line'];
    when 'software' then v_units := array['software'];
    else raise exception using errcode='22023', message='PM_INVALID_BUSINESS_UNIT';
  end case;
  if (p_after_updated_at is null) <> (p_after_id is null) then
    raise exception using errcode='22023', message='PM_INVALID_CURSOR';
  end if;
  return query
  select pr.id, pr.title, pr.status,
    coalesce(pr.metadata->>'business_unit',pr.metadata->>'department'),
    pr.company_id, c.name, pr.primary_contact_id,
    coalesce(ct.full_name,concat_ws(' ',ct.first_name,ct.last_name)),
    pr.design_collection_id, dc.name, pr.metadata->>'on_shelf_date',
    pr.metadata->>'pps_requested_date', pr.metadata->>'brief',
    pr.metadata->>'restrictions', count(p.id), pr.updated_at
  from pim.project pr
  left join core.company c on c.id=pr.company_id
  left join core.contact ct on ct.id=pr.primary_contact_id
  left join pim.design_collection dc on dc.id=pr.design_collection_id
  left join pim.product p on p.project_id=pr.id
  where (
    lower(coalesce(pr.metadata->>'business_unit',pr.metadata->>'department',''))=any(v_units)
    or lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
  )
    and (nullif(btrim(p_search),'') is null or pr.title ilike '%'||btrim(p_search)||'%' or c.name ilike '%'||btrim(p_search)||'%')
    and (p_after_updated_at is null or (pr.updated_at,pr.id)<(p_after_updated_at,p_after_id))
  group by pr.id,c.name,ct.full_name,ct.first_name,ct.last_name,dc.name
  order by pr.updated_at desc,pr.id desc
  limit greatest(1,least(coalesce(p_limit,50),101));
end $$;

create or replace function api.pm_people_workload_page(
  p_business_unit text,
  p_search text default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 60
)
returns table (
  id uuid, display_name text, email text, avatar_url text, status text,
  assignments bigint, reminders bigint, revisions bigint
)
language plpgsql stable security invoker set search_path = ''
as $$
declare v_units text[];
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units:=array['licensed','pop','pop creations'];
    when 'generic' then v_units:=array['generic','spruce','spruce line'];
    when 'software' then v_units:=array['software'];
    else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';
  end case;
  if (p_after_name is null)<>(p_after_id is null) then raise exception using errcode='22023',message='PM_INVALID_CURSOR'; end if;
  return query
  with department_products as materialized (
    select p.id from pim.product p
    where lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
  ), workload as (
    select pr.id,
      (select count(*) from pim.product_assignee pa join department_products dp on dp.id=pa.product_id where pa.profile_id=pr.id) assignments,
      (select count(*) from app.notification n where n.profile_id=pr.id and n.app='pm' and n.read_at is null
        and n.target_table='product' and exists(select 1 from department_products dp where dp.id=n.target_id)) reminders,
      (select count(*) from pim.revision_request r join department_products dp on dp.id=r.product_id
        where r.metadata->>'assigned_to'=pr.id::text and lower(r.status) not in ('resolved','accepted','rejected','canceled')) revisions
    from app.profile pr
  )
  select pr.id,coalesce(pr.display_name,pr.email,'Unnamed person'),pr.email,pr.avatar_url,pr.status::text,
    w.assignments,w.reminders,w.revisions
  from app.profile pr join workload w on w.id=pr.id
  where (nullif(btrim(p_search),'') is null or coalesce(pr.display_name,'') ilike '%'||btrim(p_search)||'%' or coalesce(pr.email,'') ilike '%'||btrim(p_search)||'%')
    and (p_after_name is null or (lower(coalesce(pr.display_name,pr.email,'')),pr.id)>(lower(p_after_name),p_after_id))
  order by lower(coalesce(pr.display_name,pr.email,'')),pr.id
  limit greatest(1,least(coalesce(p_limit,60),101));
end $$;

create or replace function api.pm_notes_page(
  p_business_unit text,
  p_search text default null,
  p_since timestamptz default (now()-interval '30 days'),
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_before_kind text default null,
  p_limit integer default 100
)
returns table (
  id uuid, kind text, body text, target text, created_at timestamptz,
  author text
)
language plpgsql stable security invoker set search_path = ''
as $$
declare v_units text[];
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units:=array['licensed','pop','pop creations'];
    when 'generic' then v_units:=array['generic','spruce','spruce line'];
    when 'software' then v_units:=array['software'];
    else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';
  end case;
  return query
  with department_targets as materialized (
    select 'product'::text kind,p.id from pim.product p
      where lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
    union all
    select 'project',pr.id from pim.project pr
      where lower(coalesce(pr.metadata->>'business_unit',pr.metadata->>'department',''))=any(v_units)
       or exists(select 1 from pim.product p where p.project_id=pr.id and lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units))
  ), notes as (
    select c.id,'comment'::text kind,c.body,c.target_schema||' / '||c.target_table||' / '||c.target_id,
      c.created_at,coalesce(pr.display_name,pr.email) author
    from app.comment c left join app.profile pr on pr.id=c.created_by_profile_id
    where c.created_at>=p_since and c.target_schema='pim'
      and exists(select 1 from department_targets d where d.kind=c.target_table and d.id=c.target_id)
      and (nullif(btrim(p_search),'') is null or c.body ilike '%'||btrim(p_search)||'%')
    union all
    select a.id,'activity',coalesce(a.summary,a.action),a.target_schema||' / '||a.target_table||' / '||a.target_id,
      a.created_at,coalesce(pr.display_name,pr.email)
    from app.activity a left join app.profile pr on pr.id=a.actor_profile_id
    where a.created_at>=p_since and a.target_schema='pim'
      and exists(select 1 from department_targets d where d.kind=a.target_table and d.id=a.target_id)
      and (nullif(btrim(p_search),'') is null or coalesce(a.summary,'') ilike '%'||btrim(p_search)||'%' or a.action ilike '%'||btrim(p_search)||'%')
  )
  select n.* from notes n
  where p_before_created_at is null or (n.created_at,n.id,n.kind)<(p_before_created_at,p_before_id,p_before_kind)
  order by n.created_at desc,n.id desc,n.kind
  limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

revoke all on function api.pm_project_page(text,text,timestamptz,uuid,integer) from public,anon;
revoke all on function api.pm_people_workload_page(text,text,text,uuid,integer) from public,anon;
revoke all on function api.pm_notes_page(text,text,timestamptz,timestamptz,uuid,text,integer) from public,anon;
grant execute on function api.pm_project_page(text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function api.pm_people_workload_page(text,text,text,uuid,integer) to authenticated;
grant execute on function api.pm_notes_page(text,text,timestamptz,timestamptz,uuid,text,integer) to authenticated;
