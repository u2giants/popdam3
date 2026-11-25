-- Verification for migration 20261225120502_c4_retire_dam_legacy_lists (popcre/shared-db#6996).
-- Proves: the five retired copies are absent, the bridge licensor FK targets
-- core.licensor, the style-tracker view and bridge refresh no longer read
-- public.licensors, and the DAM named-search contract still answers. Rolls back.
begin;

do $$
declare
  v_obj text;
  v_lookup jsonb;
  v_scope record;
begin
  foreach v_obj in array array['public.characters','public.properties','public.licensors',
                               'public.dam_character_catalog','dam.character_core_map'] loop
    if to_regclass(v_obj) is not null then
      raise exception 'C4: % must be dropped', v_obj;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.style_tracker_item_bridge'::regclass and contype = 'f'
      and conname = 'style_tracker_item_bridge_public_licensor_id_fkey'
      and confrelid = 'core.licensor'::regclass) then
    raise exception 'C4: bridge public_licensor_id must reference core.licensor';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname not in ('pg_catalog','information_schema','archive')
               and p.prosrc ~ '(public\.(characters|properties|licensors|dam_character_catalog)\M|character_core_map)') then
    raise exception 'C4: a function still reads a retired object';
  end if;

  if pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass) !~ 'core\.licensor public_lic' then
    raise exception 'C4: style_tracker_rows_with_bridge must read core.licensor';
  end if;
  perform 1 from public.style_tracker_rows_with_bridge limit 1;

  -- The CI baseline lacks core.licensor_alias (read by the lookup); every real database has it.
  if to_regclass('core.licensor_alias') is not null then
    v_lookup := public.get_dam_search_named_rows(array['unmatchablec4']);
    if v_lookup is distinct from
      '{"characters":[],"aliases":[],"legacyCharacters":[],"properties":[],"propertyCharacters":[],"licensorNames":[]}'::jsonb then
      raise exception 'C4: named lookup contract changed: %', v_lookup;
    end if;
  end if;
  if (select prosrc from pg_proc where oid = 'public.get_dam_search_named_rows(text[])'::regprocedure)
     !~ $q$'legacyCharacters', '\[\]'::jsonb$q$ then
    raise exception 'C4: legacyCharacters must be an always-empty key';
  end if;

  -- The retired legacy key is accepted and ignored.
  select * into v_scope from public.dam_search_named_scope(
    jsonb_build_object('requiredLegacyCharacterIds', jsonb_build_array(gen_random_uuid())), true);
  if v_scope.character_groups is not null or v_scope.character_assets is not null then
    raise exception 'C4: requiredLegacyCharacterIds must be a no-op';
  end if;

  if to_regclass('archive.licensors_before_c4_20261124') is null
     or to_regclass('archive.characters_before_c4_20261124') is null
     or to_regclass('archive.properties_before_c4_20261124') is null
     or to_regclass('archive.dam_character_catalog_before_c4_20261124') is null
     or to_regclass('archive.dam_character_core_map_before_c4_20261124') is null
     or to_regclass('archive.style_tracker_item_bridge_public_licensor_before_c4_20261124') is null then
    raise exception 'C4: archive snapshots missing';
  end if;
  if has_table_privilege('anon', 'archive.licensors_before_c4_20261124', 'select')
     or has_table_privilege('authenticated', 'archive.characters_before_c4_20261124', 'select') then
    raise exception 'C4: archive snapshots must not be readable by app roles';
  end if;
end $$;

rollback;
