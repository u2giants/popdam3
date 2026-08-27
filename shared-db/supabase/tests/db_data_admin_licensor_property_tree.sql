-- Rollback-safe contract for issue #1400.
-- Proves the protected RPC reads Universe B only, refuses unauthorized users,
-- aggregates more than one PostgREST page of associations server-side, and
-- keyset-pages licensors without duplicates or omissions.

begin;

do $$
declare
  v_sig text := 'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)';
  v_definition text;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_base integer := -1000000000 + floor(random() * 100000)::integer * 10000;
  v_role_id uuid;
  v_licensing_role_id uuid;
  v_admin_profile uuid;
  v_admin_auth uuid;
  v_denied_profile uuid;
  v_denied_auth uuid;
  v_page jsonb;
  v_all jsonb := '[]'::jsonb;
  v_cursor text;
  v_ids integer[];
  v_expected integer[];
  v_orphan_id integer;
  v_fixture_seen integer;
  v_character_count integer;
  v_property_count integer;
  v_live_licensors integer;
  v_live_properties integer;
  v_live_parented integer;
  v_live_orphans integer;
  v_pages integer := 0;
  v_security_definer boolean;
begin
  v_search := 'Issue1400-' || v_suffix;

  if to_regprocedure(v_sig) is null then
    raise exception 'missing protected function: %', v_sig;
  end if;
  if has_function_privilege('public', v_sig::regprocedure, 'execute') then
    raise exception 'public can execute %', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
    raise exception 'authenticated cannot execute %', v_sig;
  end if;

  select pg_get_functiondef(p.oid), p.prosecdef
  into v_definition, v_security_definer
  from pg_proc p where p.oid = v_sig::regprocedure;
  if v_security_definer is distinct from true then
    raise exception 'function must remain SECURITY DEFINER';
  end if;
  if position('app.require_licensing_manager_access()' in v_definition) = 0 then
    raise exception 'server-side licensing-manager gate is missing';
  end if;
  if position('core."licenseList"' in v_definition) = 0
     or position('core.properties_and_characters' in v_definition) = 0
     or position('core.property_character_associations' in v_definition) = 0 then
    raise exception 'function must read all three Universe B objects';
  end if;
  if position('core.licensor ' in v_definition) <> 0
     or position('core.property ' in v_definition) <> 0 then
    raise exception 'function still reads a disjoint Universe A catalogue';
  end if;

  -- Reuse two authenticated profiles and normalize only their relevant grants;
  -- rollback restores every row.
  select p.id, p.auth_user_id into v_admin_profile, v_admin_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  select p.id, p.auth_user_id into v_denied_profile, v_denied_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  if v_denied_profile is null then
    raise exception 'fixture requires two active authenticated profiles';
  end if;

  select r.id into v_role_id from app.role r where r.slug = 'administrator'::app.app_role;
  delete from app.user_role
  where profile_id in (v_admin_profile, v_denied_profile) and role_id = v_role_id;
  delete from app.app_access
  where profile_id in (v_admin_profile, v_denied_profile) and app = 'admin';
  insert into app.user_role (profile_id, role_id) values (v_admin_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_admin_profile, 'admin');

  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  begin
    perform api.db_data_admin_licensor_property_tree(v_search, true, null, 2);
    raise exception 'unauthorized caller was allowed';
  exception when insufficient_privilege then null;
  end;

  -- Prove the intended narrow path too: licensing role plus PLM access can
  -- reach this RPC without receiving the broader administrator role.
  select r.id into v_licensing_role_id
  from app.role r where r.slug = 'licensing'::app.app_role;
  if v_licensing_role_id is null then
    raise exception 'fixture requires the licensing role';
  end if;
  delete from app.user_role
  where profile_id = v_denied_profile and role_id = v_licensing_role_id;
  delete from app.app_access
  where profile_id = v_denied_profile and app = 'plm';
  insert into app.user_role (profile_id, role_id)
  values (v_denied_profile, v_licensing_role_id);
  insert into app.app_access (profile_id, app)
  values (v_denied_profile, 'plm');
  begin
    perform api.db_data_admin_licensor_property_tree(v_search, true, null, 2);
  exception when insufficient_privilege then
    raise exception 'licensing manager with PLM access was denied';
  end;

  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  begin
    perform api.db_data_admin_licensor_property_tree(v_search, true, null, 2);
  exception when insufficient_privilege then
    raise exception 'authorized administrator was denied';
  end;

  -- Five searchable licensors. Two have the same normalized title, so their
  -- integer ids are the mandatory stable tie-breaker. One is inactive.
  insert into core."licenseList" (
    "licenseList_id", "licenseList_code", "licenseList_title", "licenseList_status"
  ) values
    (v_base + 1, 'A-' || v_suffix, v_search || ' Alpha', 'active'),
    (v_base + 2, 'B-' || v_suffix, v_search || ' beta', 'active'),
    (v_base + 3, 'B2-' || v_suffix, v_search || ' BETA', 'active'),
    (v_base + 4, 'D-' || v_suffix, v_search || ' Delta', 'inactive'),
    (v_base + 5, 'G-' || v_suffix, v_search || ' Gamma', null);
  v_expected := array[v_base + 1, v_base + 2, v_base + 3, v_base + 4, v_base + 5];

  -- Issue #1684 makes this legacy table read-only. Disable only its named EOL
  -- trigger inside this rollback-only fixture so the pre-cutover read contract
  -- remains testable without weakening the live guard.
  alter table core.properties_and_characters
    disable trigger properties_and_characters_eol_write_guard;

  insert into core.properties_and_characters (
    id, name, type, licensor_id, source_licensed_property_id
  ) values
    (v_base + 101, v_search || ' Property One', 'PROPERTY', v_base + 1, 'portal-one-' || v_suffix),
    (v_base + 102, v_search || ' Property Two', 'PROPERTY', v_base + 2, 'portal-two-' || v_suffix),
    (v_base + 103, v_search || ' Looks Like Code Join', 'PROPERTY', v_base + 1, 'B-' || v_suffix);

  -- 1,001 character rows and links prove aggregation is server-side and has no
  -- client/API page-size truncation.
  insert into core.properties_and_characters (
    id, name, type, licensor_id, source_licensed_property_id, source_character_id
  )
  select v_base + 1000 + g, v_search || ' Character ' || g, 'CHARACTER',
         v_base + 1, 'portal-one-' || v_suffix, 'character-' || v_suffix || '-' || g
  from generate_series(1, 1001) g;

  insert into core.property_character_associations (property_id, character_id, licensor_id)
  select v_base + 101, v_base + 1000 + g, v_base + 1
  from generate_series(1, 1001) g;

  -- Temporarily remove the FK inside this rolled-back transaction to prove the
  -- complete anomaly list. Production keeps the FK throughout.
  alter table core.properties_and_characters
    drop constraint properties_and_characters_licensor_id_fkey;
  v_orphan_id := v_base + 104;
  insert into core.properties_and_characters (
    id, name, type, licensor_id, source_licensed_property_id
  ) values (
    v_orphan_id, v_search || ' Orphan', 'PROPERTY', v_base + 9999, 'portal-orphan-' || v_suffix
  );
  alter table core.properties_and_characters
    enable trigger properties_and_characters_eol_write_guard;

  -- Traverse every entity page. The same normalized title plus page size two
  -- exercises both halves of the (normalized title, integer id) cursor.
  loop
    select api.db_data_admin_licensor_property_tree(v_search, true, v_cursor, 2) into v_page;
    v_pages := v_pages + 1;
    if jsonb_array_length(v_page -> 'orphan_properties') <> 1
       or (v_page -> 'orphan_properties' -> 0 ->> 'id')::integer <> v_orphan_id then
      raise exception 'complete orphan collection was not returned on page %', v_pages;
    end if;
    v_all := v_all || (v_page -> 'licensors');
    v_cursor := v_page ->> 'next_cursor';
    exit when v_cursor is null;
    if v_pages > 10 then raise exception 'pagination did not terminate'; end if;
  end loop;

  select array_agg((x ->> 'id')::integer order by ord)
  into v_ids from jsonb_array_elements(v_all) with ordinality t(x, ord);
  if v_ids is distinct from v_expected then
    raise exception 'stable pages duplicated, skipped, or reordered licensors: got %, expected %', v_ids, v_expected;
  end if;
  select count(distinct (x ->> 'id')::integer) into v_fixture_seen
  from jsonb_array_elements(v_all) x;
  if v_fixture_seen <> 5 then
    raise exception 'expected five distinct paged licensors, got %', v_fixture_seen;
  end if;

  select (p ->> 'character_count')::integer into v_character_count
  from jsonb_array_elements(v_all) l, jsonb_array_elements(l -> 'properties') p
  where (p ->> 'id')::integer = v_base + 101;
  if v_character_count <> 1001 then
    raise exception 'expected exact server-side character count 1001, got %', v_character_count;
  end if;

  -- The code collision belongs to Alpha by integer licensor_id, never Beta by
  -- license code. Character-grain entities never appear as properties.
  if not exists (
    select 1 from jsonb_array_elements(v_all) l, jsonb_array_elements(l -> 'properties') p
    where (l ->> 'id')::integer = v_base + 1 and (p ->> 'id')::integer = v_base + 103
  ) or exists (
    select 1 from jsonb_array_elements(v_all) l, jsonb_array_elements(l -> 'properties') p
    where (l ->> 'id')::integer = v_base + 2 and (p ->> 'id')::integer = v_base + 103
  ) then
    raise exception 'property parent was inferred from a code instead of integer licensor_id';
  end if;
  select coalesce(sum(jsonb_array_length(l -> 'properties')), 0) into v_property_count
  from jsonb_array_elements(v_all) l;
  if v_property_count <> 3 then
    raise exception 'PROPERTY-only fixture expected three nested rows, got %', v_property_count;
  end if;

  select count(*)::integer into v_live_licensors from core."licenseList";
  select count(*)::integer,
         count(*) filter (where l."licenseList_id" is not null)::integer,
         count(*) filter (where l."licenseList_id" is null)::integer
  into v_live_properties, v_live_parented, v_live_orphans
  from core.properties_and_characters p
  left join core."licenseList" l on l."licenseList_id" = p.licensor_id
  where p.type = 'PROPERTY';
  if (v_page -> 'reconciliation' ->> 'licensor_count')::integer <> v_live_licensors
     or (v_page -> 'reconciliation' ->> 'property_count')::integer <> v_live_properties
     or (v_page -> 'reconciliation' ->> 'properties_with_licensor')::integer <> v_live_parented
     or (v_page -> 'reconciliation' ->> 'orphan_property_count')::integer <> v_live_orphans
     or (v_page -> 'reconciliation' ->> 'partition_reconciles')::boolean is distinct from true then
    raise exception 'Universe B reconciliation does not match its source tables';
  end if;

  select api.db_data_admin_licensor_property_tree(v_search, false, null, 200) into v_page;
  if exists (
    select 1 from jsonb_array_elements(v_page -> 'licensors') l
    where (l ->> 'id')::integer = v_base + 4
  ) then
    raise exception 'inactive licensor was returned without include_inactive';
  end if;

  begin
    perform api.db_data_admin_licensor_property_tree(v_search, true, 'not-a-cursor', 2);
    raise exception 'invalid cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;
