-- Final validation (from buildFinalValidationSql)
-- Exact end-state proof query (read-only). Five named core FKs + zero residuals + view.
select
  (select count(*) from public.assets a
    where a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id)
  )::bigint as bad_asset_licensors,
  (select count(*) from public.assets a
    where a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id)
  )::bigint as bad_asset_properties,
  (select count(*) from public.style_groups sg
    where sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id)
  )::bigint as bad_sg_licensors,
  (select count(*) from public.style_groups sg
    where sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id)
  )::bigint as bad_sg_properties,
  (select count(*) from public.ai_tag_bakeoff_results r
    where r.property_id is not null and not exists (select 1 from core.property p where p.id = r.property_id)
  )::bigint as bad_bakeoff_properties,
  (
    select count(*)
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f'
      and c.conname in (
        'assets_licensor_id_fkey',
        'assets_property_id_fkey',
        'style_groups_licensor_id_fkey',
        'style_groups_property_id_fkey',
        'ai_tag_bakeoff_results_property_id_fkey'
      )
      and rn.nspname || '.' || ref.relname in ('core.licensor', 'core.property')
  )::int as core_fk_count,
  (
    select coalesce(json_agg(json_build_object(
      'conname', c.conname,
      'ref', rn.nspname || '.' || ref.relname
    ) order by c.conname), '[]'::json)
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f'
      and c.conname in (
        'assets_licensor_id_fkey',
        'assets_property_id_fkey',
        'style_groups_licensor_id_fkey',
        'style_groups_property_id_fkey',
        'ai_tag_bakeoff_results_property_id_fkey'
      )
  ) as fk_details,
  exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'dam_character_catalog' and c.relkind in ('v','m')
  ) as character_catalog_exists,
  (select count(*) from public.assets where licensor_id is not null)::bigint as asset_licensor_links,
  (select count(*) from public.assets where property_id is not null)::bigint as asset_property_links
