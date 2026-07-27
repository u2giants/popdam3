create or replace function api.pm_design_page(
  p_business_unit text, p_search text default null,
  p_after_updated_at timestamptz default null, p_after_id uuid default null,
  p_limit integer default 100
)
returns table(id uuid,title text,status text,nas_path text,thumbnail_url text,metadata jsonb,updated_at timestamptz,product_count bigint)
language plpgsql stable security invoker set search_path='' as $$
declare v_units text[];
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units:=array['licensed','pop','pop creations'];
    when 'generic' then v_units:=array['generic','spruce','spruce line'];
    when 'software' then v_units:=array['software'];
    else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';
  end case;
  return query select d.id,d.title,d.status,d.nas_path,d.thumbnail_url,
    jsonb_build_object('business_unit',coalesce(d.metadata->>'business_unit',d.metadata->>'department'),'theme',d.metadata->>'theme'),
    d.updated_at,count(distinct p.id)
  from pim.design d
  left join pim.product p on p.design_id=d.id
  where (lower(coalesce(d.metadata->>'business_unit',d.metadata->>'department',''))=any(v_units)
      or lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units))
    and (nullif(btrim(p_search),'') is null or concat_ws(' ',d.title,d.status,d.nas_path) ilike '%'||btrim(p_search)||'%')
    and (p_after_updated_at is null or (d.updated_at,d.id)<(p_after_updated_at,p_after_id))
  group by d.id order by d.updated_at desc,d.id desc limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

create or replace function api.pm_design_collection_page(
  p_business_unit text,p_search text default null,
  p_after_updated_at timestamptz default null,p_after_id uuid default null,
  p_limit integer default 100
)
returns table(id uuid,name text,season text,status text,company_id uuid,metadata jsonb,updated_at timestamptz,project_count bigint)
language plpgsql stable security invoker set search_path='' as $$
declare v_units text[];
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units:=array['licensed','pop','pop creations'];
    when 'generic' then v_units:=array['generic','spruce','spruce line'];
    when 'software' then v_units:=array['software'];
    else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';
  end case;
  return query select dc.id,dc.name,dc.season,dc.status,dc.company_id,
    jsonb_build_object('business_unit',coalesce(dc.metadata->>'business_unit',dc.metadata->>'department'),'format',dc.metadata->>'format','theme',dc.metadata->>'theme'),
    dc.updated_at,count(distinct pr.id)
  from pim.design_collection dc
  left join pim.project pr on pr.design_collection_id=dc.id
  left join pim.product p on p.project_id=pr.id
  where (lower(coalesce(dc.metadata->>'business_unit',dc.metadata->>'department',''))=any(v_units)
      or lower(coalesce(pr.metadata->>'business_unit',pr.metadata->>'department',''))=any(v_units)
      or lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units))
    and (nullif(btrim(p_search),'') is null or concat_ws(' ',dc.name,dc.season,dc.status) ilike '%'||btrim(p_search)||'%')
    and (p_after_updated_at is null or (dc.updated_at,dc.id)<(p_after_updated_at,p_after_id))
  group by dc.id order by dc.updated_at desc,dc.id desc limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

create or replace function api.pm_order_page(
  p_business_unit text,p_search text default null,
  p_after_updated_at timestamptz default null,p_after_id uuid default null,
  p_limit integer default 100
)
returns table(id uuid,order_number text,order_date date,company_id uuid,product_id uuid,status text,notes text,metadata jsonb,updated_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare v_units text[];
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units:=array['licensed','pop','pop creations'];
    when 'generic' then v_units:=array['generic','spruce','spruce line'];
    when 'software' then v_units:=array['software'];
    else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';
  end case;
  return query select o.id,o.order_number,o.order_date,o.company_id,o.product_id,o.status,o.notes,
    jsonb_build_object('quantity',o.metadata->'quantity'),o.updated_at
  from pim.customer_order o
  left join pim.product p on p.id=o.product_id
  left join pim.project pr on pr.id=coalesce(o.project_id,p.project_id)
  where (lower(coalesce(o.metadata->>'business_unit',o.metadata->>'department',''))=any(v_units)
      or lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
      or lower(coalesce(pr.metadata->>'business_unit',pr.metadata->>'department',''))=any(v_units))
    and (nullif(btrim(p_search),'') is null or concat_ws(' ',o.order_number,o.status,o.notes) ilike '%'||btrim(p_search)||'%')
    and (p_after_updated_at is null or (o.updated_at,o.id)<(p_after_updated_at,p_after_id))
  order by o.updated_at desc,o.id desc limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

revoke all on function api.pm_design_page(text,text,timestamptz,uuid,integer) from public,anon;
revoke all on function api.pm_design_collection_page(text,text,timestamptz,uuid,integer) from public,anon;
revoke all on function api.pm_order_page(text,text,timestamptz,uuid,integer) from public,anon;
grant execute on function api.pm_design_page(text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function api.pm_design_collection_page(text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function api.pm_order_page(text,text,timestamptz,uuid,integer) to authenticated;
