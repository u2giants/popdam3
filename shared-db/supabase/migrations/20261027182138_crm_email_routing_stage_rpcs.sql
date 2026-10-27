-- Issue #4920 (author claim #4921): full-history stage counts and paged stage
-- lists for the popcrm-web Email Routing page (u2giants/popcrm-web PR #17).
--
-- The page routes each message in three levels (company -> department ->
-- program) and can only see the newest 1,000 messages today: reading every row
-- of crm.email_message through the security-invoker queue view times out,
-- because the crm_read policy evaluates app.has_app_access('crm') per row
-- (22,682 rows, measured read-only on production 2026-10-27).
--
-- Both functions follow api.crm_email_routing_recent (20260629031500): security
-- definer, one app.has_app_access('crm') check, granted to authenticated only.
--
-- Stage rule (mirrors stageOf() in the page; first match wins):
--   opportunity set            -> routed
--   routing_status = SKIPPED   -> skipped
--   no company                 -> needs_company
--   no department              -> needs_department
--   otherwise                  -> needs_program

create or replace function api.crm_email_routing_stage_counts()
returns table (
  needs_company bigint,
  needs_department bigint,
  needs_program bigint,
  routed bigint,
  skipped bigint,
  total bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, api, crm, app, public
as $$
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    count(*) filter (where e.opportunity_id is null and e.routing_status is distinct from 'SKIPPED'
                       and e.company_id is null),
    count(*) filter (where e.opportunity_id is null and e.routing_status is distinct from 'SKIPPED'
                       and e.company_id is not null and e.department_id is null),
    count(*) filter (where e.opportunity_id is null and e.routing_status is distinct from 'SKIPPED'
                       and e.company_id is not null and e.department_id is not null),
    count(*) filter (where e.opportunity_id is not null),
    count(*) filter (where e.opportunity_id is null and e.routing_status = 'SKIPPED'),
    count(*)
  from crm.email_message e;
end;
$$;

create or replace function api.crm_email_routing_stage_page(
  p_stage text default 'all',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  subject text,
  sender text,
  recipients text,
  received_at timestamptz,
  routing_status text,
  routing_method text,
  body_preview text,
  detected_so_numbers text,
  detected_po_numbers text,
  company_id uuid,
  company_name text,
  department_id uuid,
  department_name text,
  opportunity_id uuid,
  opportunity_name text,
  opportunity_stage text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, api, crm, core, app, public
as $$
declare
  v_stage text := coalesce(nullif(p_stage, ''), 'all');
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_stage not in ('all', 'needs_company', 'needs_department', 'needs_program', 'routed', 'skipped') then
    raise exception 'crm: unknown routing stage %', v_stage using errcode = 'invalid_parameter_value';
  end if;

  return query
  with page as (
    select src.*
      from crm.email_message src
     where case v_stage
             when 'all' then true
             when 'routed' then src.opportunity_id is not null
             when 'skipped' then src.opportunity_id is null and src.routing_status = 'SKIPPED'
             when 'needs_company' then src.opportunity_id is null and src.routing_status is distinct from 'SKIPPED'
                                       and src.company_id is null
             when 'needs_department' then src.opportunity_id is null and src.routing_status is distinct from 'SKIPPED'
                                          and src.company_id is not null and src.department_id is null
             else src.opportunity_id is null and src.routing_status is distinct from 'SKIPPED'
                  and src.company_id is not null and src.department_id is not null
           end
     order by src.received_at desc nulls last, src.id
     limit least(greatest(coalesce(p_limit, 100), 1), 1000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    e.id, e.subject, e.sender, e.recipients, e.received_at, e.routing_status,
    e.routing_method, e.body_preview, e.detected_so_numbers, e.detected_po_numbers,
    e.company_id, comp.name, e.department_id, d.name,
    e.opportunity_id, o.name, o.stage, e.updated_at
  from page e
  left join core.customer comp on comp.id = e.company_id
  left join crm.department d on d.id = e.department_id
  left join crm.opportunity o on o.id = e.opportunity_id
  order by e.received_at desc nulls last, e.id;
end;
$$;

revoke all on function api.crm_email_routing_stage_counts() from public;
revoke all on function api.crm_email_routing_stage_page(text, integer, integer) from public;
grant execute on function api.crm_email_routing_stage_counts() to authenticated;
grant execute on function api.crm_email_routing_stage_page(text, integer, integer) to authenticated;

comment on function api.crm_email_routing_stage_counts() is
  'CRM Email Routing full-history stage counts (needs_company, needs_department, needs_program, routed, skipped, total). Hard-gated on app.has_app_access(''crm'').';
comment on function api.crm_email_routing_stage_page(text, integer, integer) is
  'CRM Email Routing: one page (limit <= 1000) of messages in a routing stage or ''all'', newest first; body_preview only. Hard-gated on app.has_app_access(''crm'').';
