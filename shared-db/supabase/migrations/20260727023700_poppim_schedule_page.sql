create or replace function api.pm_schedule_page(
  p_business_unit text,
  p_start date,
  p_end date,
  p_search text default null,
  p_after_date date default null,
  p_after_id text default null,
  p_limit integer default 100
)
returns table (
  id text, event_date date, kind text, title text, context text, status text
)
language plpgsql stable security invoker set search_path = ''
as $$
declare v_units text[];
begin
  if p_start is null or p_end is null or p_end<=p_start then
    raise exception using errcode='22023',message='PM_INVALID_DATE_WINDOW';
  end if;
  if (p_after_date is null)<>(p_after_id is null) then
    raise exception using errcode='22023',message='PM_INVALID_CURSOR';
  end if;
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units:=array['licensed','pop','pop creations'];
    when 'generic' then v_units:=array['generic','spruce','spruce line'];
    when 'software' then v_units:=array['software'];
    else raise exception using errcode='22023',message='PM_INVALID_BUSINESS_UNIT';
  end case;
  return query
  with products as materialized (
    select p.id,p.name,p.stage,p.lifecycle_status,p.licensor_id,p.company_id,
      case when p.metadata->>'on_shelf_date' ~ '^\d{4}-\d{2}-\d{2}' then left(p.metadata->>'on_shelf_date',10)::date end on_shelf,
      case when p.metadata->>'pps_requested_date' ~ '^\d{4}-\d{2}-\d{2}' then left(p.metadata->>'pps_requested_date',10)::date end pps
    from pim.product p
    where lower(coalesce(p.metadata->>'business_unit',p.metadata->>'department',''))=any(v_units)
  ), events as (
    select p.id::text||':shelf',p.on_shelf,'on_shelf',p.name,null::text,p.stage from products p where p.on_shelf is not null
    union all
    select p.id::text||':pps',p.pps,'pps',p.name,null::text,p.lifecycle_status from products p where p.pps is not null
    union all
    select 'sample:'||s.id,
      coalesce(s.received_at::date,
        case when s.metadata->>'expected_at' ~ '^\d{4}-\d{2}-\d{2}' then left(s.metadata->>'expected_at',10)::date end,
        s.requested_at::date),
      'sample',p.name,s.sample_type,s.status
    from pim.product_sample s join products p on p.id=s.product_id
    union all
    select 'submission:'||s.id,
      coalesce(case when s.metadata->>'expected_response_at' ~ '^\d{4}-\d{2}-\d{2}' then left(s.metadata->>'expected_response_at',10)::date end,s.submitted_at::date),
      'submission',p.name,s.metadata->>'submission_type',s.status
    from pim.product_submission s join products p on p.id=s.product_id
    union all
    select 'reminder:'||n.id,
      coalesce(case when n.payload->>'due_at' ~ '^\d{4}-\d{2}-\d{2}' then left(n.payload->>'due_at',10)::date end,n.created_at::date),
      'reminder',n.title,n.target_table,coalesce(n.payload->>'status','open')
    from app.notification n
    where n.app='pm' and n.read_at is null and n.target_table='product'
      and exists(select 1 from products p where p.id=n.target_id)
  )
  select e.* from events e
  where e.event_date>=p_start and e.event_date<p_end
    and (nullif(btrim(p_search),'') is null or concat_ws(' ',e.title,e.context,e.status,e.kind) ilike '%'||btrim(p_search)||'%')
    and (p_after_date is null or (e.event_date,e.id)>(p_after_date,p_after_id))
  order by e.event_date,e.id
  limit greatest(1,least(coalesce(p_limit,100),201));
end $$;

revoke all on function api.pm_schedule_page(text,date,date,text,date,text,integer) from public,anon;
grant execute on function api.pm_schedule_page(text,date,date,text,date,text,integer) to authenticated;
