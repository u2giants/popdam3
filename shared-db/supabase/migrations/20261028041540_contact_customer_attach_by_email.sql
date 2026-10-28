-- #4946: attach contacts to the customer whose domain matches their email.
--
-- Owner (Albert Hazan, 2026-10-27): "those 19 contacts should be attached to
-- their customers automatically".
--
-- Only a contact with NO customer attachment is touched. Its email domain must
-- match exactly one customer (exact domain or subdomain), using the same
-- matcher as #4936. Existing attachments are never changed or removed.
-- Auto rows carry metadata {"source":"email_domain_auto"}.

create or replace function core.contact_attach_customer_by_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
begin
  if new.email is null or position('@' in new.email) = 0 then
    return null;
  end if;
  if exists (select 1 from core.contact_company cc where cc.contact_id = new.id) then
    return null;
  end if;
  v_customer := crm.match_ingested_domain_customer(split_part(lower(btrim(new.email)), '@', 2));
  if v_customer is not null then
    insert into core.contact_company (contact_id, company_id, metadata)
    values (new.id, v_customer, jsonb_build_object('source', 'email_domain_auto'))
    on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke all on function core.contact_attach_customer_by_email() from public, anon, authenticated;

drop trigger if exists contact_attach_customer_by_email on core.contact;
create trigger contact_attach_customer_by_email
  after insert or update of email on core.contact
  for each row execute function core.contact_attach_customer_by_email();

create or replace function core.customer_attach_contacts_by_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cd text;
begin
  -- Same normalisation as crm.match_ingested_domain_customer.
  v_cd := lower(trim(both '.' from regexp_replace(btrim(coalesce(new.domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i')));
  if nullif(v_cd, '') is null then
    return null;
  end if;
  -- Prefilter to contacts whose email domain is this domain or a subdomain of
  -- it, so the matcher (uniqueness check) runs only on real candidates.
  insert into core.contact_company (contact_id, company_id, metadata)
  select c.id, new.id, jsonb_build_object('source', 'email_domain_auto')
  from (
    select ct.id, split_part(lower(btrim(ct.email)), '@', 2) as d
    from core.contact ct
    where position('@' in coalesce(ct.email, '')) > 0
      and not exists (select 1 from core.contact_company cc where cc.contact_id = ct.id)
  ) c
  where (c.d = v_cd or c.d like '%.' || v_cd)
    and crm.match_ingested_domain_customer(c.d) = new.id
  on conflict do nothing;
  return null;
end;
$$;

revoke all on function core.customer_attach_contacts_by_domain() from public, anon, authenticated;

drop trigger if exists customer_attach_contacts_by_domain on core.customer;
create trigger customer_attach_contacts_by_domain
  after insert or update of domain on core.customer
  for each row execute function core.customer_attach_contacts_by_domain();

-- Backfill: unattached contacts whose email domain matches exactly one customer.
insert into core.contact_company (contact_id, company_id, metadata)
select ct.id, m.customer_id, jsonb_build_object('source', 'email_domain_auto')
from core.contact ct
cross join lateral (
  select crm.match_ingested_domain_customer(split_part(lower(btrim(ct.email)), '@', 2)) as customer_id
) m
where position('@' in coalesce(ct.email, '')) > 0
  and m.customer_id is not null
  and not exists (select 1 from core.contact_company cc where cc.contact_id = ct.id)
on conflict do nothing;
