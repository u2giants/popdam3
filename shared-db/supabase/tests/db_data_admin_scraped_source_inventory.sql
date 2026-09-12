begin;

-- Issue #2797: the raw scraped source inventory contract.
--
-- This proves the shape of api.db_data_admin_scraped_source_inventory without
-- reading a single licensed row: every assertion runs against the function
-- definition and the catalog, so no private source content can leak into public
-- CI evidence. It also proves that api.db_data_admin_scraped_properties, the
-- Property Matching contract, is still present and still separate.

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
    'Pixar - Creative (DCP Vault)',
    'Pixar - Submissions (OPA)',
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
  -- Disney, Marvel, Pixar and Lucasfilm / Star Wars stay separate licensors,
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

rollback;
