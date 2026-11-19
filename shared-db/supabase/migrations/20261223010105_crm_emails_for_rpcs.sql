-- Per-record email pages/counts for the CRM drawers.
-- Claim: popcrm-web issue #40, comment 7000445984 (2026-11-19).
-- Objects: new index crm_email_message_sender_idx on crm.email_message(sender);
--          new function api.crm_emails_for_page(uuid, text, uuid, integer, integer);
--          new function api.crm_emails_for_count(uuid, text, uuid).
--
-- The customer/contact/program drawers read emails by filtering the
-- security-invoker view api.crm_email_routing_queue per record; that view's
-- per-row crm_read policy evaluates app.has_app_access('crm') for every one of
-- tens of thousands of rows and times out on full-history reads (the measured
-- pattern that produced 20261027182138). These two functions follow
-- api.crm_email_routing_stage_page / _stage_counts exactly: security definer,
-- ONE app.has_app_access('crm') check, granted to authenticated only, reading
-- crm.email_message directly. Row shape is the stage page's shape, which is
-- the queue view's shape (id .. updated_at below).
--
-- Exactly one of (p_company_id, p_sender, p_opportunity_id) must be provided;
-- a drawer asks for one record's emails, and an unfiltered call would be the
-- full-table scan this function exists to avoid. p_sender is matched with
-- e.sender = p_sender so the new sender index serves it; an empty string
-- counts as not provided.
--
-- The sender index: sender had no index (verified against production indexes
-- 2026-11-19); company/department/opportunity/received_at already have theirs.
--
-- derived-from: none
-- (the structure follows 20261027182138).

create index if not exists crm_email_message_sender_idx
  on crm.email_message (sender);

create or replace function api.crm_emails_for_page(
  p_company_id uuid default null,
  p_sender text default null,
  p_opportunity_id uuid default null,
  p_limit integer default 200,
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
  v_filter_count integer :=
    (case when p_company_id is not null then 1 else 0 end)
    + (case when nullif(p_sender, '') is not null then 1 else 0 end)
    + (case when p_opportunity_id is not null then 1 else 0 end);
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_filter_count <> 1 then
    raise exception 'crm: exactly one filter required' using errcode = 'insufficient_privilege';
  end if;

  return query
  with page as (
    select src.*
      from crm.email_message src
     where (p_company_id is not null and src.company_id = p_company_id)
        or (nullif(p_sender, '') is not null and src.sender = p_sender)
        or (p_opportunity_id is not null and src.opportunity_id = p_opportunity_id)
     order by src.received_at desc nulls last, src.id
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)
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

create or replace function api.crm_emails_for_count(
  p_company_id uuid default null,
  p_sender text default null,
  p_opportunity_id uuid default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, api, crm, core, app, public
as $$
declare
  v_filter_count integer :=
    (case when p_company_id is not null then 1 else 0 end)
    + (case when nullif(p_sender, '') is not null then 1 else 0 end)
    + (case when p_opportunity_id is not null then 1 else 0 end);
  v_count bigint;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_filter_count <> 1 then
    raise exception 'crm: exactly one filter required' using errcode = 'insufficient_privilege';
  end if;

  select count(*)
    into v_count
    from crm.email_message e
   where (p_company_id is not null and e.company_id = p_company_id)
      or (nullif(p_sender, '') is not null and e.sender = p_sender)
      or (p_opportunity_id is not null and e.opportunity_id = p_opportunity_id);

  return v_count;
end;
$$;

revoke all on function api.crm_emails_for_page(uuid, text, uuid, integer, integer) from public;
revoke all on function api.crm_emails_for_page(uuid, text, uuid, integer, integer) from anon;
revoke all on function api.crm_emails_for_count(uuid, text, uuid) from public;
revoke all on function api.crm_emails_for_count(uuid, text, uuid) from anon;
grant execute on function api.crm_emails_for_page(uuid, text, uuid, integer, integer) to authenticated;
grant execute on function api.crm_emails_for_count(uuid, text, uuid) to authenticated;

comment on function api.crm_emails_for_page(uuid, text, uuid, integer, integer) is
'CRM drawer email page for ONE record (exactly one of company/sender/opportunity required), newest first, limit <= 1000; reads crm.email_message directly under a definer so the per-row-RLS queue view cost is bypassed. Hard-gated on app.has_app_access(''crm'').';
comment on function api.crm_emails_for_count(uuid, text, uuid) is
'CRM drawer email count for ONE record (exactly one of company/sender/opportunity required), same predicate as api.crm_emails_for_page. Hard-gated on app.has_app_access(''crm'').';
