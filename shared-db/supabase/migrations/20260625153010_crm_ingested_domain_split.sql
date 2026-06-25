-- CRM ingested-domain front door. Keep email noise OUT of core.customer.
--
-- Design (additive, "front door" model)
-- -------------------------------------
-- We receive email from ~1000 kinds of companies. A domain merely appearing in
-- an ingested email is NOT a customer and must never be written into the shared
-- core.customer hub. Instead:
--
--   ingested email  --record-->  crm.ingested_domain  --promote-->  core.customer
--                                  (CRM-private noise)              (potential customer)
--
-- The worker records every domain into crm.ingested_domain only. A domain
-- becomes a row in the important table (core.customer) ONLY when a human upgrades
-- it via crm.promote_ingested_domain(), which inserts a *potential* customer
-- (is_potential = true). Active/confirmed customers never originate here — they
-- come from PLM/ERP (ColdLion). So garbage never enters core.customer in the
-- first place; there is nothing to wait to remove.
--
-- A one-time copy-out (bottom) captures any noise that already leaked into
-- core.customer under the earlier "collapse everything into core.company" design.
-- It is additive only (no delete). Deleting those leaked rows from core.customer
-- is a CONTRACT step that needs owner sign-off + preview verification; the SQL is
-- drafted in docs/_drafts/, not auto-applied here.

-- ---------------------------------------------------------------------------
-- crm.ingested_domain  <-  Directus `ingested_domains`. CRM-private.
-- ---------------------------------------------------------------------------
create table if not exists crm.ingested_domain (
  id uuid primary key default gen_random_uuid(),
  domain extensions.citext not null,
  display_name text,
  status text not null default 'new',          -- new | ignored | promoted
  email_count integer not null default 0 check (email_count >= 0),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_sender extensions.citext,
  sample_subject text,
  -- Set only once promoted. The customer lives in core.customer; everything else
  -- hangs off that customer id.
  promoted_customer_id uuid references core.customer(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain)
);

comment on table crm.ingested_domain is
  'CRM-private registry of every domain seen in ingested email. NOT a customer. Other apps must not read or FK to this table. Promote to core.customer to make a domain a tracked (potential) customer.';
comment on column crm.ingested_domain.status is
  'new = unreviewed email noise; ignored = explicitly not a customer; promoted = a potential customer exists in core.customer (see promoted_customer_id).';
comment on column crm.ingested_domain.promoted_customer_id is
  'The core.customer this domain was promoted into. Null until promoted.';

create index if not exists crm_ingested_domain_status_idx on crm.ingested_domain (status);
create index if not exists crm_ingested_domain_promoted_idx on crm.ingested_domain (promoted_customer_id);

create trigger set_updated_at before update on crm.ingested_domain
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Worker entry point: record an ingested domain WITHOUT creating a core.customer.
-- ---------------------------------------------------------------------------
create or replace function crm.record_ingested_domain(
  p_domain text,
  p_sender text default null,
  p_subject text default null,
  p_display_name text default null
)
returns crm.ingested_domain
language plpgsql
security definer
set search_path = crm, core, app, extensions, public
as $$
declare
  v_domain extensions.citext := lower(btrim(p_domain))::extensions.citext;
  v_row crm.ingested_domain;
begin
  if v_domain is null or length(v_domain::text) = 0 then
    raise exception 'crm.record_ingested_domain: domain is required';
  end if;

  insert into crm.ingested_domain (
    domain, display_name, email_count, first_seen_at, last_seen_at,
    last_sender, sample_subject
  )
  values (
    v_domain, p_display_name, 1, now(), now(),
    nullif(p_sender, '')::extensions.citext, nullif(p_subject, '')
  )
  on conflict (domain) do update
  set email_count    = crm.ingested_domain.email_count + 1,
      last_seen_at   = now(),
      last_sender    = coalesce(nullif(p_sender, '')::extensions.citext, crm.ingested_domain.last_sender),
      sample_subject = coalesce(crm.ingested_domain.sample_subject, nullif(p_subject, '')),
      display_name   = coalesce(crm.ingested_domain.display_name, p_display_name)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function crm.record_ingested_domain(text, text, text, text) is
  'Idempotently records an ingested email domain in crm.ingested_domain. Does NOT create a core.customer. The email worker must call this instead of inserting domains into core.customer.';

-- ---------------------------------------------------------------------------
-- Promotion: upgrade an ingested domain into a POTENTIAL customer in core.customer.
-- Active customers never come from here; only PLM/ERP makes a customer active.
-- A potential customer and the active customer it later becomes are the SAME
-- core.customer row: when ColdLion confirms the relationship, plm.import_master_data
-- attaches an ERP source ref and the is_potential trigger flips it to false.
-- No FK re-pointing, ever.
-- ---------------------------------------------------------------------------
create or replace function crm.promote_ingested_domain(
  p_domain text,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = crm, core, app, extensions, public
as $$
declare
  v_domain extensions.citext := lower(btrim(p_domain))::extensions.citext;
  v_dom crm.ingested_domain;
  v_customer_id uuid;
  v_name text;
begin
  select * into v_dom from crm.ingested_domain where domain = v_domain;
  if not found then
    raise exception 'crm.promote_ingested_domain: % is not a known ingested domain', p_domain;
  end if;

  if v_dom.promoted_customer_id is not null then
    return v_dom.promoted_customer_id;   -- already promoted
  end if;

  v_name := coalesce(nullif(p_name, ''), v_dom.display_name, v_domain::text);

  -- Reuse an existing customer on the same domain if one already exists.
  select id into v_customer_id
  from core.customer
  where domain is not null and lower(domain) = v_domain::text
  order by created_at
  limit 1;

  if v_customer_id is null then
    insert into core.customer (name, company_type, status, domain, customer_status, is_potential, metadata)
    values (
      v_name, 'customer', 'active', v_domain::text, 'POTENTIAL_CUSTOMER', true,
      jsonb_build_object('promoted_from_ingested_domain', v_domain::text)
    )
    returning id into v_customer_id;
  end if;

  update crm.ingested_domain
  set status = 'promoted', promoted_customer_id = v_customer_id
  where id = v_dom.id;

  return v_customer_id;
end;
$$;

comment on function crm.promote_ingested_domain(text, text) is
  'Promotes an ingested domain to a POTENTIAL customer in core.customer (is_potential = true, no ERP source ref) and links it back via promoted_customer_id. Idempotent.';

-- ---------------------------------------------------------------------------
-- Browser-facing view for the CRM triage screen.
-- ---------------------------------------------------------------------------
create or replace view api.crm_ingested_domain_list
with (security_invoker = true) as
select
  d.id,
  d.domain::text as domain,
  d.display_name,
  d.status,
  d.email_count,
  d.first_seen_at,
  d.last_seen_at,
  d.last_sender::text as last_sender,
  d.sample_subject,
  d.promoted_customer_id,
  c.name as promoted_customer_name,
  d.updated_at
from crm.ingested_domain d
left join core.customer c on c.id = d.promoted_customer_id;

comment on view api.crm_ingested_domain_list is
  'CRM email-domain triage registry. Email noise, not customers. Promote rows to core.customer to track them as potential customers.';

-- ---------------------------------------------------------------------------
-- RLS — CRM-only, mirrors the crm.* policies in 20260621151155_api_rls_realtime.sql
-- ---------------------------------------------------------------------------
alter table crm.ingested_domain enable row level security;

create policy crm_read on crm.ingested_domain
  for select to authenticated
  using (app.has_app_access('crm') or app.has_role('administrator'));

create policy crm_write on crm.ingested_domain
  for all to authenticated
  using (app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]))
  with check (app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

grant select on crm.ingested_domain to authenticated;
grant all on crm.ingested_domain to service_role;
grant select on api.crm_ingested_domain_list to authenticated;
revoke all on function crm.record_ingested_domain(text, text, text, text) from public;
revoke all on function crm.promote_ingested_domain(text, text) from public;
grant execute on function crm.record_ingested_domain(text, text, text, text) to service_role;
grant execute on function crm.promote_ingested_domain(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One-time copy-out (ADDITIVE, no delete): capture noise that already leaked
-- into core.customer under the earlier design, into crm.ingested_domain.
-- Only rows that are provably email noise:
--   * sourced from Directus `ingested_domains`, AND
--   * no ERP/PLM source ref (never a confirmed customer), AND
--   * untriaged (customer_status null or UNASSIGNED), AND
--   * not referenced by any CRM opportunity / department / contact.
-- The matching DELETE from core.customer is the CONTRACT step, drafted in
-- docs/_drafts/crm-ingested-domain-contract-delete.sql, applied only after
-- preview verification + owner sign-off.
-- ---------------------------------------------------------------------------
insert into crm.ingested_domain (domain, display_name, status, metadata, first_seen_at, last_seen_at)
select
  lower(coalesce(c.domain, sr.source_code, c.name))::extensions.citext as domain,
  c.name,
  'new',
  jsonb_build_object('leaked_from_core_customer_id', c.id),
  c.created_at,
  c.updated_at
from core.customer c
join core.company_source_ref sr
  on sr.company_id = c.id and sr.source_table = 'ingested_domains'
where coalesce(lower(coalesce(c.domain, sr.source_code, c.name)), '') <> ''
  and (c.customer_status is null or upper(c.customer_status) = 'UNASSIGNED')
  and not exists (
    select 1 from core.company_source_ref e
    where e.company_id = c.id and e.source_system in ('designflow_plm', 'coldlion')
  )
  and not exists (select 1 from crm.opportunity o where o.company_id = c.id)
  and not exists (select 1 from crm.department dp where dp.company_id = c.id)
  and not exists (select 1 from core.contact_company cc where cc.company_id = c.id)
on conflict (domain) do nothing;
