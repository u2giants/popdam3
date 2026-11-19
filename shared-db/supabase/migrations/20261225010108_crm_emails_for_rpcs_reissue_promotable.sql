-- Promotable re-issue of the CRM drawer email page/count RPCs + sender index.
-- Claim: popcrm-web issue #40, comment 7000445984 (the object's claim thread),
-- folded into popcre/shared-db#6820 (CRM audit fixes batch), comment
-- 7010998738 (2026-11-19). Version 20261225010108 reserved atomically
-- (refs/db-claims).
--
-- WHY A RE-ISSUE: 20261223010105 (PR #6818) was rehearsed on preview outside
-- the dispatch lane, so preview's ledger holds the version while NO dispatched
-- preview run exists for it; the historical-recovery gate can never prove it
-- and the never-reapply guard refuses a fresh preview apply (runs 44532807597,
-- 44533994147, 44535389768). Stranded-promotion repair: fix-forward under a
-- new version, scoped to this claim's own objects.
--
-- CONTENT: byte-identical re-issue of the drawer email RPCs and sender index
-- from 20261223010105 (definer functions with ONE app.has_app_access('crm')
-- check reading crm.email_message directly, granted to authenticated only;
-- create index if not exists). Preview: no-op (same shapes already rehearsed).
-- Production: creates all three objects.
--
-- The index and both function bodies are written from scratch (IF NOT
-- EXISTS / CREATE OR REPLACE, self-contained), so this file depends on
-- no earlier rewrite and declares no base.
-- derived-from: none

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
