-- popcre/shared-db#6995 (stage C2, follow-up to 20261225091406; review finding #7037)
-- derived-from: 20261225010417
-- After C2, public.asset_characters.character_id holds core.character ids.
-- public.dam_search_named_scope matched asset_characters only against
-- requiredLegacyCharacterIds (public.characters ids), so PopDAM image tags would
-- stop counting for the named-character rule. Now:
--   * requiredCharacterIds (core ids) match asset_characters and asset_licensor_characters;
--   * requiredLegacyCharacterIds are translated through dam.character_core_map to
--     core ids (an unmapped id is kept as-is and matches nothing) and match both.
-- Body is the production definition (2026-11-24) with only those legs changed.
-- The one-argument overload delegates to this one and is unchanged.

CREATE OR REPLACE FUNCTION public.dam_search_named_scope(p_filters jsonb, p_need_asset_sets boolean, OUT character_groups uuid[], OUT character_assets uuid[], OUT property_groups uuid[], OUT property_assets uuid[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_characters uuid[] := public.dam_search_uuid_list(p_filters->'requiredCharacterIds');
  v_legacy uuid[] := public.dam_search_uuid_list(p_filters->'requiredLegacyCharacterIds');
  v_names tsquery[] := public.dam_search_name_queries(p_filters->'requiredCharacterNames');
  v_properties uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyIds');
  v_property_characters uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds');
  v_tag_ids uuid[];
begin
  -- C2 (popcre/shared-db#6995): public.asset_characters holds core.character ids.
  -- Legacy public.characters ids are translated through dam.character_core_map;
  -- core ids match both tag tables.
  if v_characters is not null or v_legacy is not null then
    select coalesce(array_agg(distinct x), '{}') into v_tag_ids from (
      select unnest(coalesce(v_characters, '{}')) x
      union
      select coalesce(m.core_character_id, l)
      from unnest(coalesce(v_legacy, '{}')) l
      left join dam.character_core_map m on m.public_character_id = l
    ) s;
  end if;
  -- NULL = no scope. An empty array = a scope that allows nothing.
  if v_characters is not null or v_legacy is not null or v_names is not null then
    -- style groups: a non-deleted member file is tagged, or the group's own text names it
    select coalesce(array_agg(distinct x.id), '{}') into character_groups from (
      select a.style_group_id id
      from public.asset_licensor_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is not null
      union all
      select a.style_group_id
      from public.asset_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is not null
      union all
      select k.entity_id
      from unnest(v_names) q
      join public.dam_search_keys k on k.search_tsv @@ q
      where k.document_type = 'style_group'
    ) x where x.id is not null;
    -- ungrouped asset documents: the file itself is tagged. (Name matching runs on style-group
    -- text only: on 171k asset texts a common name reads ~10k rows, 13 s cold on production.)
    if p_need_asset_sets is distinct from false then
      select coalesce(array_agg(distinct x.id), '{}') into character_assets from (
        select a.id
        from public.asset_licensor_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is null
        union all
        select a.id
        from public.asset_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_tag_ids) and not a.is_deleted and a.style_group_id is null
      ) x where x.id is not null;
    end if;
  end if;
  if v_properties is not null or v_property_characters is not null then
    select coalesce(array_agg(distinct x.id), '{}') into property_groups from (
      select g.id from public.style_groups g where g.property_id = any(v_properties)
      union all
      select a.style_group_id
      from public.asset_licensor_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is not null
    ) x where x.id is not null;
    if p_need_asset_sets is distinct from false then
      select coalesce(array_agg(distinct x.id), '{}') into property_assets from (
        select a.id from public.assets a
        where a.property_id = any(v_properties) and a.style_group_id is null and not a.is_deleted
        union all
        select a.id
        from public.asset_licensor_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is null
      ) x where x.id is not null;
    end if;
  end if;
end;
$function$;
