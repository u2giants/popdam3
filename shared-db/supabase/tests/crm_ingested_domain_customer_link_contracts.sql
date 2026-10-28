-- Contract test for migration 20261027223520 (#4936): crm.ingested_domain
-- links to the single existing customer whose domain matches exactly or as a
-- parent domain; ambiguous matches stay unlinked; status is never changed;
-- api.crm_ingested_domain_list exposes the link. All fixtures roll back.
begin;

do $$
declare
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_root text;
  v_a uuid; v_b uuid; v_c uuid;
  v_exact uuid; v_sub uuid; v_amb uuid; v_none uuid; v_late uuid;
  v_link uuid; v_status text;
begin
  v_root := 'zz' || v_tag || '.test';

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'crm.ingested_domain'::regclass and contype = 'f'
       and confrelid = 'core.customer'::regclass
  ) then
    raise exception 'crm.ingested_domain.customer_id must reference core.customer';
  end if;
  if not exists (select 1 from pg_class where oid = 'api.crm_ingested_domain_list'::regclass
                 and 'security_invoker=true' = any(coalesce(reloptions, '{}'))) then
    raise exception 'api.crm_ingested_domain_list must stay security_invoker';
  end if;
  if has_function_privilege('authenticated', 'crm.match_ingested_domain_customer(text)', 'execute') then
    raise exception 'matcher must not be callable by authenticated';
  end if;

  insert into core.customer (name, domain) values ('ZZ link A ' || v_tag, 'https://www.' || v_root || '/')
  returning id into v_a;

  -- New ingests auto-link: exact and subdomain.
  insert into crm.ingested_domain (domain, status) values (v_root, 'new') returning id into v_exact;
  insert into crm.ingested_domain (domain, status) values ('mail.' || v_root, 'new') returning id into v_sub;
  select customer_id into v_link from crm.ingested_domain where id = v_exact;
  if v_link is distinct from v_a then raise exception 'exact domain not linked'; end if;
  select customer_id into v_link from crm.ingested_domain where id = v_sub;
  if v_link is distinct from v_a then raise exception 'subdomain not linked'; end if;

  -- Lookalike suffix without a dot boundary does not link.
  insert into crm.ingested_domain (domain, status) values ('not' || v_root, 'new') returning id into v_none;
  select customer_id into v_link from crm.ingested_domain where id = v_none;
  if v_link is not null then raise exception 'non-subdomain suffix linked'; end if;

  -- Two customers on the same domain: a fresh ingest stays unlinked.
  insert into core.customer (name, domain) values ('ZZ link B ' || v_tag, 'b' || v_root) returning id into v_b;
  insert into core.customer (name, domain) values ('ZZ link C ' || v_tag, 'b' || v_root) returning id into v_c;
  insert into crm.ingested_domain (domain, status) values ('x.b' || v_root, 'new') returning id into v_amb;
  select customer_id into v_link from crm.ingested_domain where id = v_amb;
  if v_link is not null then raise exception 'ambiguous domain was linked'; end if;

  -- A customer that gains a domain later links existing unlinked domains.
  insert into crm.ingested_domain (domain, status) values ('late' || v_tag || '.test', 'OTHER')
  returning id into v_late;
  update core.customer set domain = 'late' || v_tag || '.test' where id = v_b;
  update core.customer set domain = null where id = v_c;
  select customer_id, status into v_link, v_status from crm.ingested_domain where id = v_late;
  if v_link is distinct from v_b then raise exception 'customer domain change did not link'; end if;
  if v_status <> 'OTHER' then raise exception 'link changed domain status'; end if;

  -- Changing a customer's domain unlinks domains that no longer match.
  update core.customer set domain = 'moved' || v_tag || '.test' where id = v_b;
  select customer_id into v_link from crm.ingested_domain where id = v_late;
  if v_link is not null then raise exception 'stale link kept after customer domain change'; end if;

  -- View exposes the link.
  if not exists (
    select 1 from api.crm_ingested_domain_list
     where id = v_exact and customer_id = v_a and customer_name = 'ZZ link A ' || v_tag
       and customer_status is not null
  ) then
    raise exception 'api.crm_ingested_domain_list does not expose the customer link';
  end if;

  -- Deleting the customer clears the link.
  delete from core.customer where id = v_a;
  select customer_id into v_link from crm.ingested_domain where id = v_exact;
  if v_link is not null then raise exception 'customer delete did not clear link'; end if;
end
$$;

rollback;
