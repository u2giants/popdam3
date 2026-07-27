-- Exact, department-isolated reporting contracts for Poppim secondary screens.
-- Records without an attributable department are deliberately excluded.

create or replace function api.pm_department_report(p_business_unit text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_units text[];
  v_result jsonb;
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units := array['licensed', 'pop', 'pop creations'];
    when 'generic' then v_units := array['generic', 'spruce', 'spruce line'];
    when 'software' then v_units := array['software'];
    else raise exception using errcode = '22023', message = 'PM_INVALID_BUSINESS_UNIT';
  end case;

  with
  products as materialized (
    select p.*
    from pim.product p
    where lower(coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department', '')) = any(v_units)
  ),
  projects as materialized (
    select pr.*
    from pim.project pr
    where lower(coalesce(pr.metadata ->> 'business_unit', pr.metadata ->> 'department', '')) = any(v_units)
       or exists (select 1 from products p where p.project_id = pr.id)
  ),
  designs as materialized (
    select d.*
    from pim.design d
    where lower(coalesce(d.metadata ->> 'business_unit', d.metadata ->> 'department', '')) = any(v_units)
       or exists (select 1 from products p where p.design_id = d.id)
  ),
  orders as materialized (
    select o.*
    from pim.customer_order o
    where exists (select 1 from products p where p.id = o.product_id)
       or exists (select 1 from projects pr where pr.id = o.project_id)
       or lower(coalesce(o.metadata ->> 'business_unit', o.metadata ->> 'department', '')) = any(v_units)
  ),
  revisions as materialized (
    select r.* from pim.revision_request r join products p on p.id = r.product_id
  ),
  submissions as materialized (
    select s.* from pim.product_submission s join products p on p.id = s.product_id
  ),
  samples as materialized (
    select s.* from pim.product_sample s join products p on p.id = s.product_id
  ),
  activities as materialized (
    select a.*
    from app.activity a
    where a.action in ('pm_dependency', 'pm_decision')
      and (
        (a.target_schema = 'pim' and a.target_table = 'product' and exists (select 1 from products p where p.id = a.target_id))
        or (a.target_schema = 'pim' and a.target_table = 'project' and exists (select 1 from projects pr where pr.id = a.target_id))
      )
  ),
  notifications as materialized (
    select n.*
    from app.notification n
    where n.app = 'pm'
      and (
        (n.target_schema = 'pim' and n.target_table = 'product' and exists (select 1 from products p where p.id = n.target_id))
        or (n.target_schema = 'pim' and n.target_table = 'project' and exists (select 1 from projects pr where pr.id = n.target_id))
      )
  ),
  templates as materialized (
    select v.*
    from pim.saved_view v
    where v.scope = 'workflow_template'
      and lower(coalesce(v.config ->> 'business_unit', v.config ->> 'department', '')) = any(v_units)
  ),
  stage_buckets as (
    select coalesce(p.stage, 'No stage') key, count(*)::int count
    from products p group by 1 order by count(*) desc, 1
  ),
  closure_buckets as (
    select coalesce(nullif(p.metadata ->> 'closure_reason', ''), 'Unknown') key, count(*)::int count
    from products p
    where nullif(p.metadata ->> 'closure_reason', '') is not null
    group by 1 order by count(*) desc, 1
  ),
  risk_buckets as (
    select coalesce(nullif(p.metadata ->> 'risk_level', ''), 'Unknown') key, count(*)::int count
    from products p
    where nullif(p.metadata ->> 'risk_level', '') is not null
    group by 1 order by count(*) desc, 1
  ),
  waiting_buckets as (
    select coalesce(nullif(p.metadata ->> 'waiting_on', ''), 'Unknown') key, count(*)::int count
    from products p
    where nullif(p.metadata ->> 'waiting_on', '') is not null
    group by 1 order by count(*) desc, 1
  )
  select jsonb_build_object(
    'as_of', clock_timestamp(),
    'totals', jsonb_build_object(
      'products', (select count(*) from products),
      'projects', (select count(*) from projects),
      'designs', (select count(*) from designs),
      'orders', (select count(*) from orders)
    ),
    'operational', jsonb_build_object(
      'blocked', (select count(*) from products p where nullif(p.metadata ->> 'blocker_reason', '') is not null or nullif(p.metadata ->> 'waiting_on', '') is not null or lower(coalesce(p.lifecycle_status, '')) in ('blocked','waiting')),
      'ownership_gaps', (select count(*) from products p where nullif(p.metadata ->> 'next_action', '') is not null and nullif(p.metadata ->> 'next_owner_name', '') is null and nullif(p.metadata ->> 'next_owner_role_name', '') is null and nullif(p.metadata ->> 'waiting_on', '') is null),
      'evidence_gaps', (select count(*) from products p where jsonb_array_length(case when jsonb_typeof(p.metadata -> 'evidence_gaps') = 'array' then p.metadata -> 'evidence_gaps' else '[]'::jsonb end) > 0),
      'overdue_dates', (select count(*) from products p where nullif(p.metadata ->> 'pps_requested_date','')::date < current_date or nullif(p.metadata ->> 'on_shelf_date','')::date < current_date),
      'open_revisions', (select count(*) from revisions r where lower(coalesce(r.status,'')) not in ('resolved','accepted','rejected','canceled')),
      'waiting_submissions', (select count(*) from submissions s where lower(coalesce(s.status,'')) in ('ready','submitted','waiting','changes_requested')),
      'active_samples', (select count(*) from samples s where lower(coalesce(s.status,'')) not in ('approved','canceled','not_required')),
      'open_dependencies', (select count(*) from activities a where a.action = 'pm_dependency' and lower(coalesce(a.payload ->> 'status','open')) in ('open','waiting')),
      'open_reminders', (select count(*) from notifications n where n.read_at is null and lower(coalesce(n.payload ->> 'status','open')) in ('open','snoozed')),
      'recorded_decisions', (select count(*) from activities a where a.action = 'pm_decision'),
      'active_templates', (select count(*) from templates v where coalesce((v.config ->> 'active')::boolean, true))
    ),
    'stage_buckets', coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',key,'count',count) order by count desc,key) from stage_buckets), '[]'::jsonb),
    'closure_buckets', coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',key,'count',count) order by count desc,key) from closure_buckets), '[]'::jsonb),
    'risk_buckets', coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',key,'count',count) order by count desc,key) from risk_buckets), '[]'::jsonb),
    'waiting_buckets', coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',key,'count',count) order by count desc,key) from waiting_buckets), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$$;

create or replace function api.pm_department_handoffs(
  p_business_unit text,
  p_since timestamptz default (now() - interval '30 days'),
  p_limit integer default 30
)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  from_stage_id uuid,
  from_stage_name text,
  to_stage_id uuid,
  to_stage_name text,
  changed_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_units text[];
begin
  case lower(btrim(p_business_unit))
    when 'licensed' then v_units := array['licensed', 'pop', 'pop creations'];
    when 'generic' then v_units := array['generic', 'spruce', 'spruce line'];
    when 'software' then v_units := array['software'];
    else raise exception using errcode = '22023', message = 'PM_INVALID_BUSINESS_UNIT';
  end case;

  return query
  select h.id, p.id, p.name, h.from_stage_id, fs.name, h.to_stage_id, ts.name, h.changed_at
  from pim.stage_history h
  join pim.product p on p.id = h.product_id
  left join pim.stage fs on fs.id = h.from_stage_id
  left join pim.stage ts on ts.id = h.to_stage_id
  where lower(coalesce(p.metadata ->> 'business_unit', p.metadata ->> 'department', '')) = any(v_units)
    and h.changed_at >= p_since
  order by h.changed_at desc, h.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
end
$$;

revoke all on function api.pm_department_report(text) from public, anon;
revoke all on function api.pm_department_handoffs(text,timestamptz,integer) from public, anon;
grant execute on function api.pm_department_report(text) to authenticated;
grant execute on function api.pm_department_handoffs(text,timestamptz,integer) to authenticated;

comment on function api.pm_department_report(text) is
  'Exact Poppim report aggregates for one mandatory department. Unattributable rows are excluded.';
comment on function api.pm_department_handoffs(text,timestamptz,integer) is
  'Bounded recent Poppim stage handoffs for one mandatory department, ordered by changed_at/id.';
