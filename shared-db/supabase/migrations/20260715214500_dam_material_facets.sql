-- Distinct product-material facet options for the DAM library filter sidebar.
-- Sources from assets.product_material (projected from rich-PDF extraction).
-- Additive.

-- Speeds the sidebar's Material filter (product_material && selected[]).
create index if not exists idx_assets_product_material_gin
  on public.assets using gin (product_material);

-- Small partial index so the facet enumeration only visits rows that have a
-- material (rather than scanning every asset).
create index if not exists idx_assets_has_product_material
  on public.assets (id)
  where product_material is not null;

create or replace function public.get_dam_material_facets()
returns table (material text, asset_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.material, count(*)::bigint as asset_count
  from public.assets a
  cross join lateral unnest(a.product_material) as m(material)
  where a.is_deleted = false
    and a.product_material is not null
    and m.material is not null
    and m.material <> ''
  group by m.material
  order by asset_count desc, m.material;
$$;

comment on function public.get_dam_material_facets() is
  'Distinct product_material values with asset counts, for the DAM library Material filter facet.';

grant execute on function public.get_dam_material_facets() to anon, authenticated, service_role;
