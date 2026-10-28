-- #4936: link CRM ingested email domains to the customer they belong to.
-- derived-from: 20260629034600
--
-- Owner (Albert Hazan, 2026-10-27): "they need to be linked" (CRM email
-- domains and customers). This supersedes the "no customer association"
-- contract of 20260629034600. It links only to EXISTING customers; nothing
-- here creates, promotes or source-references a customer from a domain, and
-- no domain status is changed.
--
-- Match rule: the ingested domain equals the customer's domain, or is a
-- subdomain of it. A domain matching two or more customers stays unlinked.

begin;

alter table crm.ingested_domain
  add column if not exists customer_id uuid
    references core.customer(id) on delete set null;

create index if not exists crm_ingested_domain_customer_id_idx
  on crm.ingested_domain (customer_id) where customer_id is not null;

comment on column crm.ingested_domain.customer_id is
  'Existing customer this email domain belongs to (exact or subdomain match on core.customer.domain). Null when none or ambiguous.';

-- The single customer whose domain matches p_domain, or null if none or ambiguous.
create or replace function crm.match_ingested_domain_customer(p_domain text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select c.id
    from core.customer c
    cross join lateral (
      select lower(trim(both '.' from regexp_replace(btrim(c.domain), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i'))) as cd
    ) n
    where nullif(n.cd, '') is not null
      and (lower(btrim(p_domain)) = n.cd or lower(btrim(p_domain)) like '%.' || n.cd)
  )
  select case when count(*) = 1 then min(id::text)::uuid end from m;
$$;

revoke all on function crm.match_ingested_domain_customer(text) from public, anon, authenticated;

-- New or renamed ingested domains auto-link when unlinked.
create or replace function crm.ingested_domain_link_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_id is null then
    new.customer_id := crm.match_ingested_domain_customer(new.domain::text);
  end if;
  return new;
end;
$$;

revoke all on function crm.ingested_domain_link_customer() from public, anon, authenticated;

drop trigger if exists ingested_domain_link_customer on crm.ingested_domain;
create trigger ingested_domain_link_customer
  before insert or update of domain on crm.ingested_domain
  for each row execute function crm.ingested_domain_link_customer();

-- A customer domain set or changed: drop this customer's links that no longer
-- match, then link unlinked domains under the new domain that now match
-- exactly one customer. Only candidate domains are re-matched.
create or replace function crm.customer_domain_link_ingested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cd text := lower(trim(both '.' from regexp_replace(btrim(coalesce(new.domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i')));
begin
  if tg_op = 'UPDATE' then
    update crm.ingested_domain d
       set customer_id = null
     where d.customer_id = new.id
       and crm.match_ingested_domain_customer(d.domain::text) is distinct from new.id;
  end if;
  if v_cd <> '' then
    update crm.ingested_domain d
       set customer_id = crm.match_ingested_domain_customer(d.domain::text)
     where d.customer_id is null
       and (lower(d.domain::text) = v_cd or lower(d.domain::text) like '%.' || v_cd)
       and crm.match_ingested_domain_customer(d.domain::text) is not null;
  end if;
  return null;
end;
$$;

revoke all on function crm.customer_domain_link_ingested() from public, anon, authenticated;

drop trigger if exists customer_link_ingested_domains on core.customer;
create trigger customer_link_ingested_domains
  after insert or update of domain on core.customer
  for each row
  execute function crm.customer_domain_link_ingested();

-- A canonical Customer merge must carry the loser's domain links to the
-- survivor. Body is the live 20260723223100 definition plus one repoint.
create or replace function core.merge_customer(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean default true)
returns void
language plpgsql
security definer
set search_path to 'core', 'crm', 'pim', 'dam', 'plm', 'app', 'public'
as $function$
declare
  v_loser_name text;
  v_loser_display text;
begin
  if p_loser = p_survivor then
    raise exception 'merge_customer: loser and survivor are the same (%).', p_loser;
  end if;
  if not exists (select 1 from core.customer where id = p_survivor) then
    raise exception 'merge_customer: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display
  from core.customer where id = p_loser;
  if not found then
    raise exception 'merge_customer: loser % does not exist.', p_loser;
  end if;

  -- Serialize concurrent attempts for the same pair in a stable order.
  perform pg_advisory_xact_lock(hashtextextended(least(p_loser::text, p_survivor::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_loser::text, p_survivor::text), 0));

  -- Per-app 1:1 rows: move one-sided data, collapse identical rows, and stop
  -- before data loss when business fields differ.
  perform core.reconcile_merge_extension_row('crm.customer_ext', 'customer_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('pim.customer_ext', 'customer_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('dam.customer_ext', 'customer_id', p_loser, p_survivor);

  -- Customer Channels are set membership. Preserve the survivor assignment on
  -- duplicate membership and move every loser-only assignment.
  delete from core.customer_channel lc
  where lc.customer_id = p_loser
    and exists (
      select 1 from core.customer_channel sc
      where sc.customer_id = p_survivor and sc.channel_id = lc.channel_id
    );
  update core.customer_channel set customer_id = p_survivor where customer_id = p_loser;

  -- CRM department/company consistency must be resolved before ordinary FK
  -- repoints because enforcement triggers validate both columns together.
  update core.contact_company cc
  set company_id = p_survivor, crm_department_id = s.id
  from crm.department l
  join crm.department s on s.company_id = p_survivor and s.name = l.name
  where l.company_id = p_loser and cc.crm_department_id = l.id;

  update crm.opportunity o
  set company_id = p_survivor, department_id = s.id
  from crm.department l
  join crm.department s on s.company_id = p_survivor and s.name = l.name
  where l.company_id = p_loser and o.department_id = l.id;

  delete from crm.department l
  where l.company_id = p_loser
    and exists (
      select 1 from crm.department s
      where s.company_id = p_survivor and s.name = l.name
    );
  update crm.department set company_id = p_survivor where company_id = p_loser;

  delete from core.contact_company lc
  where lc.company_id = p_loser
    and exists (
      select 1 from core.contact_company sc
      where sc.company_id = p_survivor and sc.contact_id = lc.contact_id
    );
  update core.contact_company set company_id = p_survivor where company_id = p_loser;
  update crm.opportunity set company_id = p_survivor where company_id = p_loser;

  delete from core.customer_alias la
  where la.customer_id = p_loser
    and exists (
      select 1 from core.customer_alias sa
      where sa.customer_id = p_survivor
        and sa.normalized_alias = la.normalized_alias
    );
  update core.customer_alias set customer_id = p_survivor where customer_id = p_loser;

  update core.company_source_ref set company_id = p_survivor where company_id = p_loser;

  update core.factory set company_id = p_survivor where company_id = p_loser;
  update crm.email_message set company_id = p_survivor where company_id = p_loser;
  update crm.ingested_domain set customer_id = p_survivor where customer_id = p_loser;
  update crm.licensor_approval_thread set company_id = p_survivor where company_id = p_loser;
  update crm.meeting_note set company_id = p_survivor where company_id = p_loser;
  update crm.note set company_id = p_survivor where company_id = p_loser;
  update crm.task set company_id = p_survivor where company_id = p_loser;
  update dam.asset set company_id = p_survivor where company_id = p_loser;
  update dam.style_group set company_id = p_survivor where company_id = p_loser;
  update dam.style_guide_file set company_id = p_survivor where company_id = p_loser;
  update pim.customer_order set company_id = p_survivor where company_id = p_loser;
  update pim.design_collection set company_id = p_survivor where company_id = p_loser;
  update pim.product set company_id = p_survivor where company_id = p_loser;
  update pim.project set company_id = p_survivor where company_id = p_loser;
  update plm.customer_import set company_id = p_survivor where company_id = p_loser;
  update plm.erp_customer set customer_id = p_survivor where customer_id = p_loser;
  update plm.item set company_id = p_survivor where company_id = p_loser;
  update plm.production_order set company_id = p_survivor where company_id = p_loser;
  update plm.rfq_group set company_id = p_survivor where company_id = p_loser;
  update plm.style_tracker_item_bridge set company_id = p_survivor where company_id = p_loser;
  update public.assets set customer_id = p_survivor where customer_id = p_loser;
  update public.style_groups set customer_id = p_survivor where customer_id = p_loser;
  update public.style_tracker_rows set customer_id = p_survivor where customer_id = p_loser;

  if p_alias_loser_name then
    insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged customer ' || p_loser
    on conflict (customer_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge',
        'display name from merged customer ' || p_loser
      on conflict (customer_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.customer where id = p_loser;
end;
$function$;

comment on function core.merge_customer(uuid,uuid,boolean) is
  'Canonical Customer merge. Covers every inventoried Customer FK, including stable public.assets/style_groups/style_tracker_rows Customer UUIDs and crm.ingested_domain links, and fails closed on extension conflicts.';

-- Backfill (status untouched).
update crm.ingested_domain d
   set customer_id = m.cid
  from (select id, crm.match_ingested_domain_customer(domain::text) as cid
          from crm.ingested_domain) m
 where d.id = m.id and m.cid is not null and d.customer_id is distinct from m.cid;

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
  d.updated_at,
  d.customer_id,
  c.name as customer_name,
  c.status::text as customer_status
from crm.ingested_domain d
left join core.customer c on c.id = d.customer_id;

comment on view api.crm_ingested_domain_list is
  'CRM-private ingested email-domain triage list, with the existing customer each domain is linked to (customer_id/name/status; null when unmatched or ambiguous).';

grant select on api.crm_ingested_domain_list to authenticated;

commit;
