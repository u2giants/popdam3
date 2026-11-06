-- Issue #5784: real JWT-aware authorization, inside the harness BEGIN/ROLLBACK.
-- Only synthetic contacts and principals; no shared database execution.
do $$
declare
  write_policy record;
  expected text := '(app.has_role(''administrator''::app.app_role) OR app.has_any_role(ARRAY[''sales''::app.app_role]))';
begin
  select * into strict write_policy from pg_policies
  where schemaname = 'crm' and tablename = 'contact_ext' and policyname = 'crm_write';
  if write_policy.cmd <> 'ALL' or write_policy.roles <> array['authenticated']::name[]
     or write_policy.qual is distinct from expected
     or write_policy.with_check is distinct from expected then
    raise exception 'contact_ext write policy must allow exactly administrator or sales: %', write_policy;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'crm.contact_ext'::regclass) then
    raise exception 'contact_ext row security is disabled';
  end if;
end $$;

-- Follow the existing contract fixture convention to bypass auth invitation hooks.
set local session_replication_role = replica;
insert into auth.users (id, email)
values ('57840000-0000-4000-8000-000000000001', 'zztest-contact-access@example.invalid');
set local session_replication_role = origin;
insert into app.profile (auth_user_id, email, display_name, status)
values ('57840000-0000-4000-8000-000000000001', 'zztest-contact-access@example.invalid',
        'ZZTEST contact access', 'active');
insert into app.app_access (profile_id, app)
select id, 'crm'::app.app_name from app.profile
where auth_user_id = '57840000-0000-4000-8000-000000000001';

insert into core.contact (id, full_name) values
  ('57840000-0000-4000-8000-000000000002', 'ZZTEST existing contact'),
  ('57840000-0000-4000-8000-000000000003', 'ZZTEST new contact');
insert into crm.contact_ext (contact_id)
values ('57840000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub', '57840000-0000-4000-8000-000000000001', true);
do $$
declare
  role_name text;
  changed integer;
  allowed boolean;
begin
  -- CRM access alone and licensing cannot write; administrator and sales can.
  foreach role_name in array array['', 'licensing', 'administrator', 'sales'] loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '57840000-0000-4000-8000-000000000001', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('roles',
        case when role_name = '' then '[]'::jsonb else jsonb_build_array(role_name) end)
    )::text, true);
    allowed := role_name in ('administrator', 'sales');
    set local role authenticated;
    if not app.has_app_access('crm')
       or app.has_role('administrator') is distinct from (role_name = 'administrator')
       or app.has_role('sales') is distinct from (role_name = 'sales') then
      raise exception 'unexpected fixture authorization for %', role_name;
    end if;
    if not exists (select 1 from crm.contact_ext
                   where contact_id = '57840000-0000-4000-8000-000000000002') then
      raise exception 'CRM principal % lost read access', role_name;
    end if;

    begin
      insert into crm.contact_ext (contact_id)
      values ('57840000-0000-4000-8000-000000000003');
      if not allowed then
        raise exception 'principal % unexpectedly inserted contact_ext', role_name;
      end if;
    exception when insufficient_privilege then
      if allowed then raise; end if;
    end;

    update crm.contact_ext set defunct_reason = 'retired', defunct_at = now(),
      defunct_by = '57840000-0000-4000-8000-000000000001'
    where contact_id = '57840000-0000-4000-8000-000000000002';
    get diagnostics changed = row_count;
    if changed <> allowed::int then
      raise exception 'unexpected UPDATE authorization for %: % rows', role_name, changed;
    end if;
    delete from crm.contact_ext
    where contact_id = '57840000-0000-4000-8000-000000000002';
    get diagnostics changed = row_count;
    if changed <> allowed::int then
      raise exception 'unexpected DELETE authorization for %: % rows', role_name, changed;
    end if;
    reset role;
    -- Restore exactly the same starting rows for the next principal.
    delete from crm.contact_ext where contact_id = '57840000-0000-4000-8000-000000000003';
    insert into crm.contact_ext (contact_id)
    values ('57840000-0000-4000-8000-000000000002') on conflict (contact_id) do nothing;
  end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
