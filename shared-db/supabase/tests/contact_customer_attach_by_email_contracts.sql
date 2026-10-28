-- Contract test for migration 20261028041540 (#4946): a contact with no
-- customer attachment is attached to the single customer whose domain matches
-- its email (exact or subdomain); ambiguous matches and already-attached
-- contacts are left alone; a new customer domain picks up waiting contacts.
-- All fixtures roll back.
begin;

do $$
declare
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_root text;
  v_a uuid; v_b uuid; v_c uuid; v_late uuid;
  v_exact uuid; v_sub uuid; v_amb uuid; v_kept uuid; v_wait uuid; v_moved uuid; v_bad uuid;
  v_n int;
begin
  v_root := 'zz' || v_tag || '.test';

  if has_function_privilege('authenticated', 'core.contact_attach_customer_by_email()', 'execute')
     or has_function_privilege('authenticated', 'core.customer_attach_contacts_by_domain()', 'execute') then
    raise exception 'attach trigger functions must not be callable by authenticated';
  end if;

  insert into core.customer (name, domain) values ('ZZ attach A ' || v_tag, 'https://www.' || v_root || '/') returning id into v_a;
  insert into core.customer (name, domain) values ('ZZ attach B ' || v_tag, 'b' || v_root) returning id into v_b;
  insert into core.customer (name, domain) values ('ZZ attach C ' || v_tag, 'amb.b' || v_root) returning id into v_c;

  -- Exact domain match attaches.
  insert into core.contact (email) values ('x@' || v_root) returning id into v_exact;
  select count(*) into v_n from core.contact_company
   where contact_id = v_exact and company_id = v_a and metadata->>'source' = 'email_domain_auto';
  if v_n <> 1 then raise exception 'exact match did not attach (%)', v_n; end if;

  -- Subdomain match attaches.
  insert into core.contact (email) values ('y@mail.' || v_root) returning id into v_sub;
  if not exists (select 1 from core.contact_company where contact_id = v_sub and company_id = v_a) then
    raise exception 'subdomain match did not attach';
  end if;

  -- Ambiguous (matches B and C) stays unattached.
  insert into core.contact (email) values ('z@amb.b' || v_root) returning id into v_amb;
  if exists (select 1 from core.contact_company where contact_id = v_amb) then
    raise exception 'ambiguous match must not attach';
  end if;

  -- An existing attachment is never changed, even when the email changes.
  insert into core.contact (email) values ('k@nomatch-' || v_tag || '.test') returning id into v_kept;
  insert into core.contact_company (contact_id, company_id) values (v_kept, v_b);
  update core.contact set email = 'k@' || v_root where id = v_kept;
  select count(*) into v_n from core.contact_company where contact_id = v_kept;
  if v_n <> 1 or not exists (select 1 from core.contact_company where contact_id = v_kept and company_id = v_b) then
    raise exception 'existing attachment was changed';
  end if;

  -- An unattached contact whose email changes to a matching domain attaches.
  insert into core.contact (email) values ('m@elsewhere-' || v_tag || '.test') returning id into v_moved;
  update core.contact set email = 'm@' || v_root where id = v_moved;
  if not exists (select 1 from core.contact_company where contact_id = v_moved and company_id = v_a) then
    raise exception 'email change to a matching domain did not attach';
  end if;

  -- An email without @ never attaches.
  insert into core.contact (email) values (v_root) returning id into v_bad;
  if exists (select 1 from core.contact_company where contact_id = v_bad) then
    raise exception 'malformed email attached';
  end if;

  -- A contact waiting with no match attaches when a customer gains its domain.
  insert into core.contact (email) values ('w@late' || v_root) returning id into v_wait;
  if exists (select 1 from core.contact_company where contact_id = v_wait) then
    raise exception 'unmatched contact attached early';
  end if;
  insert into core.customer (name, domain) values ('ZZ attach late ' || v_tag, 'late' || v_root) returning id into v_late;
  if not exists (select 1 from core.contact_company where contact_id = v_wait and company_id = v_late) then
    raise exception 'new customer domain did not attach waiting contact';
  end if;
end
$$;

rollback;
