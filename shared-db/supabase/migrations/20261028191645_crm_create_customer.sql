-- #4982: create a customer from the CRM (human-reviewed), for a customer-classified
-- email domain that has no customer to route to.
--
-- Owner (Albert Hazan, 2026-10-28): "for a new domain that was classified as a
-- customer but doesn't have a Company record to route to, we need to make a
-- workflow to create that customer record."
-- This supersedes, for human-reviewed creation from the CRM only, the note that
-- customers come only from the curated path (20260629034600 era). It does NOT
-- revive automatic domain-to-customer promotion: only an explicit CRM user call
-- creates a row.
--
-- The existing AFTER INSERT triggers on core.customer then link matching
-- crm.ingested_domain rows (#4936) and attach unattached contacts on the
-- domain (#4946); nothing here duplicates that work.

create or replace function api.crm_create_customer(
  p_name text,
  p_domain text,
  p_customer_status text default 'POTENTIAL_CUSTOMER',
  p_display_name text default null,
  p_chain_type text default null,
  p_routing_aliases text default null
)
returns core.customer
language plpgsql
security definer
set search_path = app, core, crm, public
as $fn$
declare
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_domain text := lower(trim(both '.' from regexp_replace(btrim(coalesce(p_domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i')));
  v_status text := upper(btrim(coalesce(p_customer_status, 'POTENTIAL_CUSTOMER')));
  v_chain  text := nullif(upper(btrim(coalesce(p_chain_type, ''))), '');
  v_owner  text;
  result   core.customer;
begin
  if not coalesce(app.has_app_access('crm'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'crm: customer name is required' using errcode = 'check_violation';
  end if;

  if v_domain = '' or position('.' in v_domain) = 0 or v_domain ~ '\s' then
    raise exception 'crm: a valid customer domain is required' using errcode = 'check_violation';
  end if;

  if v_status not in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER') then
    raise exception 'crm: customer status must be ACTIVE_CUSTOMER or POTENTIAL_CUSTOMER'
      using errcode = 'check_violation';
  end if;

  if v_chain is not null and v_chain not in
     ('OFF_PRICE', 'SPECIALTY', 'VALUE', 'MASS_MARKET', 'GROCERY_DRUG', 'ECOM', 'CLUB', 'OTHER') then
    raise exception 'crm: unknown chain type %', p_chain_type using errcode = 'check_violation';
  end if;

  -- Serialize concurrent creates for the same domain, then refuse a domain an
  -- existing customer already owns (same normalisation as the #4936 matcher).
  perform pg_advisory_xact_lock(hashtextextended('crm_create_customer:' || v_domain, 0));

  select c.name into v_owner
  from core.customer c
  where lower(trim(both '.' from regexp_replace(btrim(coalesce(c.domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i'))) = v_domain
  limit 1;
  if found then
    raise exception 'crm: domain % already belongs to customer "%"', v_domain, v_owner
      using errcode = 'unique_violation';
  end if;

  insert into core.customer (
    name, display_name, domain, status, is_potential,
    customer_status, chain_type, routing_aliases, metadata
  )
  values (
    v_name,
    nullif(btrim(coalesce(p_display_name, '')), ''),
    v_domain,
    case when v_status = 'ACTIVE_CUSTOMER' then 'active'::app.entity_status else 'potential'::app.entity_status end,
    v_status = 'POTENTIAL_CUSTOMER',
    v_status,
    v_chain,
    nullif(btrim(coalesce(p_routing_aliases, '')), ''),
    jsonb_build_object('source', 'crm_create_customer', 'created_by', auth.uid())
  )
  returning * into result;

  return result;
end;
$fn$;

revoke all on function api.crm_create_customer(text, text, text, text, text, text) from public, anon;
grant execute on function api.crm_create_customer(text, text, text, text, text, text) to authenticated;

comment on function api.crm_create_customer(text, text, text, text, text, text) is
  'Human-reviewed CRM customer creation (#4982). Requires CRM access. Creates one core.customer (ACTIVE_CUSTOMER or POTENTIAL_CUSTOMER) with a normalized domain; refuses a blank name or a domain another customer already owns. Existing insert triggers link ingested domains and attach unattached contacts on the domain.';

notify pgrst, 'reload schema';
