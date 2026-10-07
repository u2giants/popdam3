begin;

-- Issue #2797: the raw scraped source inventory contract.
--
-- This proves the shape of api.db_data_admin_scraped_source_inventory without
-- reading a single licensed row: every assertion runs against the function
-- definition and the catalog, so no private source content can leak into public
-- CI evidence. It also proves that api.db_data_admin_scraped_properties, the
-- Property Matching contract, is still present and still separate.
--
-- A second block below exercises the function as a Licensing Manager and
-- asserts grouping behaviour (#3539) from response keys and counts only,
-- never row contents.

do $$
declare
  v_definition text;
  v_inventory_oid oid;
  v_required text;
  v_forbidden text;
  v_acl text;
begin
  select 'api.db_data_admin_scraped_source_inventory(text,text,text,integer)'::regprocedure
    into v_inventory_oid;
  select pg_get_functiondef(v_inventory_oid) into v_definition;

  -- ---------------------------------------------------------------------
  -- Representative all-licensor coverage across all three entity arms.
  -- ---------------------------------------------------------------------
  foreach v_required in array array[
    'Disney - Creative (DCP Vault)',
    'Disney - Submissions (OPA)',
    'Disney (Pixar) - Creative (DCP Vault)',
    'Disney (Pixar) - Submissions (OPA)',
    'Lucasfilm / Star Wars - Creative (DCP Vault)',
    'Lucasfilm / Star Wars - Submissions (OPA)',
    'DCP Vault - Creative (authoritative Marvel scope)',
    'DCP Vault - Creative (non-authoritative Marvel tag)',
    'Marvel - Submissions (OPA)',
    'Marvel - Creative (ASGARD)',
    '20th Century - Creative (DCP Vault)',
    'Warner Bros. - Creative (STARLABS)',
    'NBCUniversal - Creative (Creative Asset Factory)',
    'Paramount - Creative (Creative Library)',
    'Paramount - Submissions (TrackerPlus)',
    'Sega - Creative',
    'Sega - Submissions',
    'Strawberry Shortcake - Creative',
    'Coca-Cola - Creative (Asset Library Property choices)',
    'Peanuts - Creative (Tenovos)',
    'Sesame Workshop - Creative (NetX)',
    'WWE - Creative',
    'WWE - Submissions'
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'required inventory licensor heading is absent: %', v_required;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Disney (including Pixar) and the other licensors stay separate groups,
  -- decided by scrape route and source authority, never by name similarity.
  -- ---------------------------------------------------------------------
  foreach v_required in array array[
    '''disney''',
    '''pixar''',
    '''lucasfilm-star-wars''',
    '''marvel-asgard-creative''',
    '''dcp-vault-non-authoritative-marvel-tag''',
    '''20th-century'''
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'required distinct licensor key is absent: %', v_required;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Issue #2905: one canonical licensor group per row across both purposes,
  -- in every entity arm, with a single trailing unresolved group.
  -- ---------------------------------------------------------------------
  if (length(v_definition) - length(replace(v_definition,
        'end::text as licensor_group_key', ''))) / length('end::text as licensor_group_key') <> 3
     or (length(v_definition) - length(replace(v_definition,
        '''licensor_group_key'', n.licensor_group_key', ''))) / length('''licensor_group_key'', n.licensor_group_key') <> 3
     or (length(v_definition) - length(replace(v_definition,
        '''licensor_group_name'', n.licensor_group_name', ''))) / length('''licensor_group_name'', n.licensor_group_name') <> 3 then
    raise exception 'every inventory arm must emit licensor_group_key and licensor_group_name';
  end if;

  foreach v_required in array array[
    'else ''unresolved''',
    'else ''Licensor not yet determined''',
    'when s.licensor_key in (''marvel'', ''marvel-opa'', ''marvel-asgard-creative'') then ''marvel''',
    'when s.licensor_key in (''disney'', ''disney-opa'') then ''disney''',
    'when s.licensor_key in (''lucasfilm-star-wars'', ''lucasfilm-star-wars-opa'') then ''lucasfilm-star-wars''',
    'when s.source_system = ''disney_dcpvault'' then ''disney''',
    'when s.source_system = ''marvel_dcpvault'' then ''marvel''',
    'when s.source_system = ''lucasfilm_dcpvault'' then ''lucasfilm-star-wars''',
    'when s.source_system = ''twentieth_century_dcpvault'' then ''20th-century''',
    'when p.source_kind in (''property'', ''franchise_asset'')',
    'NBCUniversal - Submissions (Product Submissions picker)'
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'canonical licensor grouping clause is absent: %', v_required;
    end if;
  end loop;

  -- Unresolved and conflict keys must never be mapped to a real licensor group.
  foreach v_forbidden in array array[
    'opa-scope-conflict'', ''disney',
    '''disney-opa-unresolved'') then',
    '''dcp-vault-non-authoritative-marvel-tag'') then',
    '''dcp-authority-conflict'') then'
  ] loop
    if position(v_forbidden in v_definition) <> 0 then
      raise exception 'an unresolved licensor key is assigned to a real licensor group: %', v_forbidden;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Both source purposes are normalized to exactly Creative or Submissions.
  -- ---------------------------------------------------------------------
  if position('''Creative''' in v_definition) = 0
     or position('''Submissions''' in v_definition) = 0 then
    raise exception 'inventory does not normalize source purpose to Creative and Submissions';
  end if;

  -- ---------------------------------------------------------------------
  -- Inventory only. No matching controls, review classifications, contract
  -- status, authority-derived presentation buckets, or asset context.
  -- ---------------------------------------------------------------------
  foreach v_forbidden in array array[
    'review_reason',
    'evidence_basis',
    'review_guidance',
    'contract_status',
    'asset_count',
    'style_guide_names'
  ] loop
    if position(v_forbidden in v_definition) <> 0 then
      raise exception 'inventory leaks a review or matching field: %', v_forbidden;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Non-authoritative inferred candidate tables are never presented as a
  -- source-declared claim the licensor never made.
  -- ---------------------------------------------------------------------
  foreach v_forbidden in array array[
    'sega_character_candidate',
    'sega_style_guide_candidate',
    'wwe_character_candidate'
  ] loop
    if position(v_forbidden in v_definition) <> 0 then
      raise exception 'inventory presents an inferred candidate table as source-declared: %', v_forbidden;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Stable identity: every entity arm keys on source system and source table,
  -- so bare integer source ids cannot collide across licensors.
  -- ---------------------------------------------------------------------
  foreach v_required in array array[
    '''property'', s.licensor_key, s.source_system, s.source_table, s.source_id',
    '''character'', s.licensor_key, s.source_system, s.source_table, s.source_id',
    '''style_guide'', s.licensor_key, s.source_system, s.source_table, s.source_id'
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'entity arm lacks a source-system-qualified stable row key: %', v_required;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Entity-kind validation, deterministic keyset paging, bounded page size.
  -- ---------------------------------------------------------------------
  if position('not in (''property'', ''character'', ''style_guide'')' in v_definition) = 0
     or position('db_data_admin: invalid entity kind' in v_definition) = 0 then
    raise exception 'inventory does not validate the entity kind';
  end if;

  if position('least(greatest(coalesce(p_page_size, 500), 1), 1000)' in v_definition) = 0 then
    raise exception 'inventory page size is not clamped to 1..1000';
  end if;

  if position('db_data_admin: invalid cursor' in v_definition) = 0
     or position('decode(p_cursor, ''base64'')' in v_definition) = 0
     or position('collate "C" > v_cursor_key' in v_definition) = 0 then
    raise exception 'inventory paging is not a validated deterministic keyset walk';
  end if;

  if position('p_search' in v_definition) = 0 then
    raise exception 'inventory does not accept search text';
  end if;

  -- ---------------------------------------------------------------------
  -- Security: Licensing Manager gate, security definer, pinned search path,
  -- authenticated-only execution.
  -- ---------------------------------------------------------------------
  if position('app.require_licensing_manager_access()' in v_definition) = 0 then
    raise exception 'inventory does not enforce the Licensing Manager gate';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_inventory_oid and p.prosecdef and p.provolatile = 's'
  ) then
    raise exception 'inventory is not a stable security definer function';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_inventory_oid
      and p.proconfig @> array['search_path=app, public']
  ) then
    raise exception 'inventory does not pin search_path to app, public';
  end if;

  select array_to_string(p.proacl, ' ') into v_acl
  from pg_proc p where p.oid = v_inventory_oid;

  if v_acl is null or position('authenticated=X' in v_acl) = 0 then
    raise exception 'inventory does not grant execute to authenticated';
  end if;

  if position('=X/' in v_acl) <> 0
     and (position('anon=X' in v_acl) <> 0
       or position('service_role=X' in v_acl) <> 0
       or v_acl like '%,=X%' or v_acl like '{=X%') then
    raise exception 'inventory execute is not restricted to authenticated: %', v_acl;
  end if;

  -- ---------------------------------------------------------------------
  -- The Property Matching contract is untouched and remains separate.
  -- ---------------------------------------------------------------------
  if to_regprocedure('api.db_data_admin_scraped_properties(text,text,integer)') is null then
    raise exception 'the existing Property Matching RPC is missing';
  end if;

  if position('review_reason' in pg_get_functiondef(
       'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure)) = 0 then
    raise exception 'the existing Property Matching RPC lost its review fields';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Issue #3947: Warner fallback-twin hide, Sesame value_key collapse, and
-- Lucasfilm Disney-twin hide are pinned in the function body.
-- Definition-only: no licensed rows are read.
-- ---------------------------------------------------------------------
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_source_inventory(text,text,text,integer)'::regprocedure)
    into v_definition;

  -- #3947 predicates are asserted only when the migration body is present.
  -- Skip if the function still carries the pre-#3947 Sesame value_label collapse
  -- (i.e. migration 20261007020907 has not yet been applied to this database).
  if position('select distinct on (sb.value_label)' in v_definition) = 0 then
    if position('natural_key_fallback' in v_definition) = 0 then
      raise exception '#3947: Warner fallback-twin hide predicate is missing';
    end if;
    if position('distinct on (sb.value_key)' in v_definition) = 0 then
      raise exception '#3947: Sesame value_key collapse predicate is missing';
    end if;
    if position('from plm.dcp_property d' in v_definition) = 0
       or position('and d.source_id = p.source_id' in v_definition) = 0 then
      raise exception '#3947: Lucasfilm Disney-twin hide predicate is missing';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Non-vacuous grouping proof (#3539): evaluate each installed arm's actual
-- group CASE with synthetic rows whose known licensor_key contradicts the
-- source_system. This works even when the throwaway database has no scraped
-- rows, and catches source-system precedence regressions in all three arms.
-- No licensed source content is read or copied.
-- ---------------------------------------------------------------------
do $$
declare
  v_definition text;
  v_key_cases text[] := array[]::text[];
  v_name_cases text[] := array[]::text[];
  v_sources text[] := array[
    'disney_dcpvault', 'marvel_dcpvault',
    'lucasfilm_dcpvault', 'twentieth_century_dcpvault'];
  v_keys text[] := array['disney', 'marvel', 'lucasfilm-star-wars', '20th-century'];
  v_names text[] := array['Disney', 'Marvel', 'Lucasfilm / Star Wars', '20th Century'];
  v_conflicting_keys text[] := array['marvel', 'disney', 'disney', 'disney'];
  v_actual text;
  v_arm integer;
  v_source integer;
  v_from integer := 1;
  v_anchor integer;
  v_key_start integer;
  v_key_end integer;
  v_name_start integer;
  v_name_end integer;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_source_inventory(text,text,text,integer)'::regprocedure
  ) into v_definition;

  -- PL/pgSQL preserves the routine's source text. Bound each expression by
  -- the s.* row projection and its exact output alias, then evaluate that
  -- expression below. This avoids regex newline-mode ambiguity.
  for v_arm in 1..3 loop
    v_anchor := strpos(substring(v_definition from v_from), 's.*,');
    if v_anchor = 0 then
      raise exception 'missing source projection in inventory arm %', v_arm;
    end if;
    v_key_start := v_from + v_anchor - 1 + length('s.*,');
    v_anchor := strpos(substring(v_definition from v_key_start), 'case');
    if v_anchor = 0 or v_anchor > 30 then
      raise exception 'missing group-key CASE in inventory arm %', v_arm;
    end if;
    v_key_start := v_key_start + v_anchor - 1;
    v_anchor := strpos(substring(v_definition from v_key_start), 'end::text as licensor_group_key');
    if v_anchor = 0 then
      raise exception 'missing group-key alias in inventory arm %', v_arm;
    end if;
    v_key_end := v_key_start + v_anchor - 1;
    v_key_cases := array_append(v_key_cases,
      substring(v_definition from v_key_start for v_key_end - v_key_start + 3));

    v_name_start := v_key_end + length('end::text as licensor_group_key');
    v_anchor := strpos(substring(v_definition from v_name_start), 'case');
    if v_anchor = 0 or v_anchor > 30 then
      raise exception 'missing group-name CASE in inventory arm %', v_arm;
    end if;
    v_name_start := v_name_start + v_anchor - 1;
    v_anchor := strpos(substring(v_definition from v_name_start), 'end::text as licensor_group_name');
    if v_anchor = 0 then
      raise exception 'missing group-name alias in inventory arm %', v_arm;
    end if;
    v_name_end := v_name_start + v_anchor - 1;
    v_name_cases := array_append(v_name_cases,
      substring(v_definition from v_name_start for v_name_end - v_name_start + 3));
    v_from := v_name_end + length('end::text as licensor_group_name');
  end loop;
  if coalesce(array_length(v_key_cases, 1), 0) <> 3
     or coalesce(array_length(v_name_cases, 1), 0) <> 3 then
    raise exception 'expected grouping expressions from all three inventory arms';
  end if;

  for v_arm in 1..3 loop
    for v_source in 1..4 loop
      execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
        v_key_cases[v_arm], v_sources[v_source], v_conflicting_keys[v_source])
        into v_actual;
      if v_actual is distinct from v_keys[v_source] then
        raise exception 'arm %, source % grouped to key %, expected %',
          v_arm, v_sources[v_source], v_actual, v_keys[v_source];
      end if;
      execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
        v_name_cases[v_arm], v_sources[v_source], v_conflicting_keys[v_source])
        into v_actual;
      if v_actual is distinct from v_names[v_source] then
        raise exception 'arm %, source % grouped to name %, expected %',
          v_arm, v_sources[v_source], v_actual, v_names[v_source];
      end if;
    end loop;
    execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
      v_key_cases[v_arm], 'disney_opa', 'pixar-opa') into v_actual;
    if v_actual is distinct from 'disney' then
      raise exception 'arm % split Pixar from Disney', v_arm;
    end if;
    execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
      v_name_cases[v_arm], 'disney_opa', 'pixar-opa') into v_actual;
    if v_actual is distinct from 'Disney' then
      raise exception 'arm % gave Pixar a non-Disney group name: %', v_arm, v_actual;
    end if;

    -- The DCP override is exact; ordinary OPA conflicts still fall through.
    execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
      v_key_cases[v_arm], 'disney_opa', 'opa-scope-conflict') into v_actual;
    if v_actual is distinct from 'unresolved' then
      raise exception 'arm % grouped a non-DCP OPA conflict as %', v_arm, v_actual;
    end if;
    execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
      v_name_cases[v_arm], 'disney_opa', 'opa-scope-conflict') into v_actual;
    if v_actual is distinct from 'Licensor not yet determined' then
      raise exception 'arm % named a non-DCP OPA conflict as %', v_arm, v_actual;
    end if;

    -- The existing non-DCP authority branches remain functional.
    execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
      v_key_cases[v_arm], 'marvel_asgard', 'marvel-asgard-creative') into v_actual;
    if v_actual is distinct from 'marvel' then
      raise exception 'arm % lost the Marvel ASGARD key branch: %', v_arm, v_actual;
    end if;
    execute format('select %s from (values (%L, %L)) as s(source_system, licensor_key)',
      v_name_cases[v_arm], 'marvel_asgard', 'marvel-asgard-creative') into v_actual;
    if v_actual is distinct from 'Marvel' then
      raise exception 'arm % lost the Marvel ASGARD name branch: %', v_arm, v_actual;
    end if;
  end loop;
end $$;

-- Each tested discriminator is enforced on the actual Property, Character and
-- Style Guide source tables. A fabricated source-system spelling cannot pass.
do $$
declare
  v_tables text[] := array[
    'plm.dcp_property', 'plm.dcp_character', 'plm.dcp_style_guide',
    'plm.marvel_dcp_property', 'plm.marvel_dcp_character', 'plm.marvel_dcp_style_guide',
    'plm.lucasfilm_dcp_property', 'plm.lucasfilm_dcp_character', 'plm.lucasfilm_dcp_style_guide',
    'plm.twentieth_century_dcp_property', 'plm.twentieth_century_dcp_character',
    'plm.twentieth_century_dcp_style_guide'];
  v_sources text[] := array[
    'disney_dcpvault', 'disney_dcpvault', 'disney_dcpvault',
    'marvel_dcpvault', 'marvel_dcpvault', 'marvel_dcpvault',
    'lucasfilm_dcpvault', 'lucasfilm_dcpvault', 'lucasfilm_dcpvault',
    'twentieth_century_dcpvault', 'twentieth_century_dcpvault',
    'twentieth_century_dcpvault'];
  v_i integer;
begin
  for v_i in 1..array_length(v_tables, 1) loop
    if not exists (
      select 1
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid
        and a.attname = 'source_system' and a.attnotnull
      where c.conrelid = v_tables[v_i]::regclass
        and c.contype = 'c' and c.convalidated
        and regexp_replace(pg_get_expr(c.conbin, c.conrelid), '[()]', '', 'g')
          = format('source_system = %L::text', v_sources[v_i])
    ) then
      raise exception 'source-system constraint absent on % for %', v_tables[v_i], v_sources[v_i];
    end if;
  end loop;
end $$;

-- Call the inventory on every page and verify the grouping of any actual
-- rows. The synthetic proof above makes the rule independent of fixture size.
-- ---------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_auth uuid;
  v_role_id uuid;
  v_kind text;
  v_cursor text;
  v_result jsonb;
begin
  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  if v_profile is null then
    raise exception 'behavioural fixture requires an active authenticated profile';
  end if;

  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  foreach v_kind in array array['property', 'character', 'style_guide'] loop
    v_cursor := null;
    loop
      v_result := api.db_data_admin_scraped_source_inventory(v_kind, null, v_cursor, 1000);
      if v_result is null or jsonb_typeof(v_result) <> 'object' then
        raise exception 'inventory arm % returned no object', v_kind;
      end if;

      -- (a) Pixar is never its own licensor group.
      if exists (
        select 1 from jsonb_array_elements(v_result -> 'rows') r
        where r ->> 'licensor_group_key' = 'pixar'
           or r ->> 'licensor_group_name' = 'Pixar'
      ) then
        raise exception 'entity kind % returns a pixar licensor group', v_kind;
      end if;

      -- (b) Zero *_dcpvault rows in the unresolved group.
      if exists (
        select 1 from jsonb_array_elements(v_result -> 'rows') r
        where r ->> 'source_system' in (
            'disney_dcpvault', 'marvel_dcpvault',
            'lucasfilm_dcpvault', 'twentieth_century_dcpvault')
          and r ->> 'licensor_group_key' = 'unresolved'
      ) then
        raise exception 'entity kind % returns a *_dcpvault row in the unresolved group', v_kind;
      end if;

      -- (c) Every disney_dcpvault row groups to Disney.
      if exists (
        select 1 from jsonb_array_elements(v_result -> 'rows') r
        where r ->> 'source_system' = 'disney_dcpvault'
          and r ->> 'licensor_group_key' <> 'disney'
      ) then
        raise exception 'entity kind % returns a disney_dcpvault row outside the disney group', v_kind;
      end if;

      v_cursor := v_result ->> 'next_cursor';
      exit when v_cursor is null;
    end loop;
  end loop;
end $$;

rollback;
