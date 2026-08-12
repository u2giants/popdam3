-- CRM Sidebar + Overview server-side aggregate and bounded recent-row contracts.
--
-- Phase 7A of the CRM audit remediation. Replaces the browser-side full-table
-- counting in popcrm-web's `useCrmStatsQuery` (queries.ts), which fans out seven
-- `limit = -1` full-table fetches (customers, contacts, opportunities, emails,
-- meetings, tasks, approvals) and counts/sorts them client-side, with
-- purpose-specific, browser-safe server contracts.
--
-- Design rules honored (see docs/verification/crm-overview-contracts-20260812/):
--   • Additive + idempotent: `create or replace function` only. No tables, no
--     drops, no renames. Existing api.crm_* contracts are untouched.
--   • Exact server-side counts: every filter reproduces the CRM client filter
--     verbatim (null/empty handling included) so the server count equals the
--     current client count. See the inventory doc.
--   • Bounded recent rows: `p_limit` clamped to [1,100], deterministic order
--     with an `id` ascending tie-breaker, only rendered columns returned.
--   • Authorization: every RPC is security definer, hard-gated on
--     app.has_app_access('crm'); a caller without CRM access is DENIED with
--     `insufficient_privilege` (the api.crm_admin_user_list precedent), never
--     silently empty.
--   • Failure tolerance: the historically slow email domain is isolated from the
--     people/pipeline/work counts, and each bounded panel is independently
--     callable, so one degraded group no longer blanks the rest.
--
-- Search paths list every schema touched; all object references are fully
-- qualified so a hostile search_path cannot redirect resolution.

-- ---------------------------------------------------------------------------
-- 1. Scalar KPI counts (Sidebar badges + Overview KPI strip), EXCEPT email.
--    One round trip for customers, contacts, open programs, meetings, open
--    tasks and pending approvals. Email is served separately (§2) so an email
--    outage cannot blank these KPIs.
-- ---------------------------------------------------------------------------
create or replace function api.crm_overview_counts()
returns table (
  customers bigint,
  contacts bigint,
  open_opportunities bigint,
  meetings bigint,
  open_tasks bigint,
  pending_approvals bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, api, core, crm, app, public
as $$
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    -- Customers KPI = active customer segment (fetchRetailers('active')).
    (select count(*)
       from core.customer c
      where c.customer_status in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER')) as customers,
    -- Contacts KPI = contacts whose PRIMARY company relationship is an active
    -- customer (fetchBuyers client filter on crm_contact_list). The lateral
    -- mirrors api.crm_contact_list's primary-company selection and is backed by
    -- core_contact_company_contact_primary_idx (contact_id, is_primary desc, id).
    (select count(*)
       from core.contact ct
       left join lateral (
         select comp.customer_status as company_customer_status
           from core.contact_company x
           join core.customer comp on comp.id = x.company_id
          where x.contact_id = ct.id
          order by x.is_primary desc nulls last, x.id
          limit 1
       ) cc on true
      where cc.company_customer_status in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER')) as contacts,
    -- Open programs = stage IS NOT 'CLOSED' (JS `o.stage !== 'CLOSED'`; null counts as open).
    (select count(*)
       from crm.opportunity o
      where o.stage is distinct from 'CLOSED') as open_opportunities,
    -- Meetings KPI = all meeting notes (meetings.length).
    (select count(*) from crm.meeting_note) as meetings,
    -- Open tasks = status not DONE/CANCELED (JS `!==`; null counts as open).
    (select count(*)
       from crm.task t
      where t.status is distinct from 'DONE'
        and t.status is distinct from 'CANCELED') as open_tasks,
    -- Pending approvals = NOT isApprovalResolved(stage) (regex match on the
    -- free-form stage string; null/empty stage = pending).
    (select count(*)
       from crm.licensor_approval_thread a
      where coalesce(a.stage, '') !~* '(approv|reject|declin|denied|complete|closed|signed)') as pending_approvals;
end;
$$;

revoke all on function api.crm_overview_counts() from public;
grant execute on function api.crm_overview_counts() to authenticated;

comment on function api.crm_overview_counts() is
  'CRM Sidebar + Overview scalar KPI counts (customers, contacts, open_opportunities, meetings, open_tasks, pending_approvals). Hard-gated on app.has_app_access(''crm''). Email counts are served by crm_overview_email_counts so an email outage cannot blank these KPIs.';

-- ---------------------------------------------------------------------------
-- 2. Email aggregate counts: total, needs_routing, and the per-routing-status
--    breakdown that drives the Overview routing-health donut. needsRouting()
--    = status is non-empty and not ROUTED/SKIPPED. Null/empty routing_status is
--    bucketed as UNROUTED in the donut (mirrors `e.routing_status || 'UNROUTED'`).
--    `other` captures any status outside the six known keys so the buckets sum
--    to `total` and the math is auditable.
-- ---------------------------------------------------------------------------
create or replace function api.crm_overview_email_counts()
returns table (
  total bigint,
  needs_routing bigint,
  routed bigint,
  skipped bigint,
  company_only bigint,
  company_dept bigint,
  unrouted bigint,
  no_company bigint,
  other bigint
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
    count(*) as total,
    count(*) filter (
      where nullif(e.routing_status, '') is not null
        and e.routing_status not in ('ROUTED', 'SKIPPED')
    ) as needs_routing,
    count(*) filter (where e.routing_status = 'ROUTED') as routed,
    count(*) filter (where e.routing_status = 'SKIPPED') as skipped,
    count(*) filter (where e.routing_status = 'COMPANY_ONLY') as company_only,
    count(*) filter (where e.routing_status = 'COMPANY_DEPT') as company_dept,
    count(*) filter (where coalesce(nullif(e.routing_status, ''), 'UNROUTED') = 'UNROUTED') as unrouted,
    count(*) filter (where e.routing_status = 'CUSTOMER_EMAIL_NO_COMPANY') as no_company,
    count(*) filter (
      where nullif(e.routing_status, '') is not null
        and e.routing_status not in ('ROUTED', 'SKIPPED', 'COMPANY_ONLY', 'COMPANY_DEPT', 'UNROUTED', 'CUSTOMER_EMAIL_NO_COMPANY')
    ) as other
  from crm.email_message e;
end;
$$;

revoke all on function api.crm_overview_email_counts() from public;
grant execute on function api.crm_overview_email_counts() to authenticated;

comment on function api.crm_overview_email_counts() is
  'CRM Overview email aggregate: total messages, needs_routing, and per-routing-status counts for the routing-health donut. Hard-gated on app.has_app_access(''crm'').';

-- ---------------------------------------------------------------------------
-- 3. Pipeline distribution: one row per known OPPORTUNITY_STAGES value with the
--    opportunity count. Null/empty stage is bucketed to DIRECTIVE_RECEIVED
--    (mirrors `o.stage || OPPORTUNITY_STAGES[0]`); opportunities with an unknown
--    stage are excluded from the bars (mirrors the chart mapping over known
--    stages only) but remain counted in open_opportunities (§1).
-- ---------------------------------------------------------------------------
create or replace function api.crm_overview_pipeline_stages()
returns table (
  stage text,
  count bigint
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
  with stages(s) as (
    values
      ('DIRECTIVE_RECEIVED'),
      ('DESIGN_IN_PROGRESS'),
      ('BUYER_REVIEW'),
      ('PRICING_AND_SAMPLING'),
      ('AWAITING_SALES_ORDER'),
      ('IN_PRODUCTION'),
      ('SHIPPED'),
      ('CLOSED')
  ),
  effective as (
    select coalesce(nullif(o.stage, ''), 'DIRECTIVE_RECEIVED') as stage
      from crm.opportunity o
  )
  select s.s as stage,
         count(e.stage) as count
    from stages s
    left join effective e on e.stage = s.s
   group by s.s
   order by array_position(array[
      'DIRECTIVE_RECEIVED','DESIGN_IN_PROGRESS','BUYER_REVIEW','PRICING_AND_SAMPLING',
      'AWAITING_SALES_ORDER','IN_PRODUCTION','SHIPPED','CLOSED'
   ], s.s);
end;
$$;

revoke all on function api.crm_overview_pipeline_stages() from public;
grant execute on function api.crm_overview_pipeline_stages() to authenticated;

comment on function api.crm_overview_pipeline_stages() is
  'CRM Overview pipeline distribution: opportunity count per known stage (null/empty bucketed to DIRECTIVE_RECEIVED). Hard-gated on app.has_app_access(''crm'').';

-- ---------------------------------------------------------------------------
-- 4. Email volume: rolling weekly ingested vs. routed series for the Overview
--    email-volume chart. ISO weeks (Monday 00:00 UTC) for the last p_weeks
--    weeks (default 12, clamped [1,24]). `routed` = messages with
--    routing_status = 'ROUTED'. Uses the received_at index for a bounded range
--    scan per week.
-- ---------------------------------------------------------------------------
create or replace function api.crm_overview_email_volume(p_weeks integer default 12)
returns table (
  week_start date,
  ingested bigint,
  routed bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, api, crm, app, public
as $$
declare
  v_weeks integer := least(greatest(coalesce(p_weeks, 12), 1), 24);
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  with weeks as (
    select gs as week_start
      from generate_series(
             date_trunc('week', now()) - (v_weeks - 1) * interval '7 days',
             date_trunc('week', now()),
             interval '7 days') gs
  )
  select w.week_start::date as week_start,
         count(e.id) as ingested,
         count(e.id) filter (where e.routing_status = 'ROUTED') as routed
    from weeks w
    left join crm.email_message e
      on e.received_at >= w.week_start
     and e.received_at <  w.week_start + interval '7 days'
   group by w.week_start
   order by w.week_start;
end;
$$;

revoke all on function api.crm_overview_email_volume(integer) from public;
grant execute on function api.crm_overview_email_volume(integer) to authenticated;

comment on function api.crm_overview_email_volume(integer) is
  'CRM Overview 12-week email volume series (ingested vs. routed per ISO week). Hard-gated on app.has_app_access(''crm''). p_weeks clamped to [1,24].';

-- ---------------------------------------------------------------------------
-- 5. Bounded recent-row panel: unrouted emails (Needs routing).
--    needsRouting(routing_status) = non-empty status not in (ROUTED, SKIPPED).
--    Only rendered columns: id, subject, sender, routing_status.
-- ---------------------------------------------------------------------------
create or replace function api.crm_overview_recent_unrouted(p_limit integer default 6)
returns table (
  id uuid,
  subject text,
  sender text,
  routing_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, api, crm, app, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 100);
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  select e.id, e.subject, e.sender, e.routing_status
    from crm.email_message e
   where nullif(e.routing_status, '') is not null
     and e.routing_status not in ('ROUTED', 'SKIPPED')
   order by e.received_at desc nulls last, e.id
   limit v_limit;
end;
$$;

revoke all on function api.crm_overview_recent_unrouted(integer) from public;
grant execute on function api.crm_overview_recent_unrouted(integer) to authenticated;

comment on function api.crm_overview_recent_unrouted(integer) is
  'CRM Overview "Needs routing" panel: most recent unrouted emails (rendered columns only). Hard-gated on app.has_app_access(''crm''). p_limit clamped to [1,100], default 6.';

-- ---------------------------------------------------------------------------
-- 6. Bounded recent-row panel: recent meetings.
--    Only rendered columns: id, name(title), company_id, company_name, date.
-- ---------------------------------------------------------------------------
create or replace function api.crm_overview_recent_meetings(p_limit integer default 6)
returns table (
  id uuid,
  name text,
  company_id uuid,
  company_name text,
  date timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, api, core, crm, app, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 100);
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  select m.id,
         m.title as name,
         m.company_id,
         comp.name as company_name,
         m.meeting_at as date
    from crm.meeting_note m
    left join core.customer comp on comp.id = m.company_id
   order by m.meeting_at desc nulls last, m.id
   limit v_limit;
end;
$$;

revoke all on function api.crm_overview_recent_meetings(integer) from public;
grant execute on function api.crm_overview_recent_meetings(integer) to authenticated;

comment on function api.crm_overview_recent_meetings(integer) is
  'CRM Overview "Recent meetings" panel: most recent meetings (rendered columns only). Hard-gated on app.has_app_access(''crm''). p_limit clamped to [1,100], default 6.';

-- ---------------------------------------------------------------------------
-- 7. Bounded recent-row panel: pending approvals.
--    NOT isApprovalResolved(stage). Only rendered columns: id, name,
--    property_name, opportunity_id, opportunity_name, stage.
-- ---------------------------------------------------------------------------
create or replace function api.crm_overview_pending_approvals(p_limit integer default 6)
returns table (
  id uuid,
  name text,
  property_name text,
  opportunity_id uuid,
  opportunity_name text,
  stage text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, api, crm, app, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 100);
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  select a.id,
         a.name,
         a.property_name,
         a.opportunity_id,
         o.name as opportunity_name,
         a.stage
    from crm.licensor_approval_thread a
    left join crm.opportunity o on o.id = a.opportunity_id
   where coalesce(a.stage, '') !~* '(approv|reject|declin|denied|complete|closed|signed)'
   order by a.submitted_date desc nulls last, a.id
   limit v_limit;
end;
$$;

revoke all on function api.crm_overview_pending_approvals(integer) from public;
grant execute on function api.crm_overview_pending_approvals(integer) to authenticated;

comment on function api.crm_overview_pending_approvals(integer) is
  'CRM Overview "Pending approvals" panel: most recently submitted unresolved approvals (rendered columns only). Hard-gated on app.has_app_access(''crm''). p_limit clamped to [1,100], default 6.';
