create or replace function api.pm_account_page(
  p_business_unit text,
  p_search text default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, name text, core_status text, project_count bigint,
  order_count bigint, buyers jsonb
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
  with projects as materialized (
    select distinct pr.id,pr.company_id
    from pim.project pr left join pim.product p on p.project_id=pr.id
    where lower(coalesce(pr.metadata->>'business_unit',pr.metadata->>'department',''))=any(v_units)
       or lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
  ), orders as materialized (
    select distinct o.id,o.company_id
    from pim.customer_order o
    left join pim.product p on p.id=o.product_id
    left join projects pr on pr.id=o.project_id
    where lower(coalesce(o.metadata->>'business_unit',o.metadata->>'department',''))=any(v_units)
       or lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
       or pr.id is not null
  )
  select c.id,coalesce(c.display_name,c.name,c.id::text),c.core_status::text,
    (select count(*) from projects pr where pr.company_id=c.id),
    (select count(*) from orders o where o.company_id=c.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('id',ct.id,'name',coalesce(ct.full_name,ct.email::text),'email',ct.email::text) order by coalesce(ct.full_name,ct.email::text),ct.id)
      from core.contact_company cc join core.contact ct on ct.id=cc.contact_id where cc.company_id=c.id
    ),'[]'::jsonb)
  from api.pm_customer_list c
  where (exists(select 1 from projects pr where pr.company_id=c.id) or exists(select 1 from orders o where o.company_id=c.id))
    and (nullif(btrim(p_search),'') is null or coalesce(c.display_name,c.name,'') ilike '%'||btrim(p_search)||'%'
      or exists(select 1 from core.contact_company cc join core.contact ct on ct.id=cc.contact_id where cc.company_id=c.id and (coalesce(ct.full_name,'') ilike '%'||btrim(p_search)||'%' or coalesce(ct.email::text,'') ilike '%'||btrim(p_search)||'%')))
    and (p_after_name is null or (lower(coalesce(c.display_name,c.name,'')),c.id)>(lower(p_after_name),p_after_id))
  order by lower(coalesce(c.display_name,c.name,'')),c.id
  limit greatest(1,least(coalesce(p_limit,50),101));
end $$;

revoke all on function api.pm_account_page(text,text,text,uuid,integer) from public,anon;
grant execute on function api.pm_account_page(text,text,text,uuid,integer) to authenticated;
