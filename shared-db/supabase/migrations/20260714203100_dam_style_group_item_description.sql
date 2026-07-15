-- Store the authoritative Master Data item description once per style group.

alter table public.style_groups
  add column item_description text,
  add column item_description_source text;

comment on column public.style_groups.item_description is
  'Authoritative product-level description shared by every asset in this SKU style group.';
comment on column public.style_groups.item_description_source is
  'Provenance for item_description, currently master_data when seeded from the style tracker.';

-- One-shot, set-based backfill (~10.5k groups; safely below the ~20k batching threshold).
update public.style_groups sg
set item_description = d.description,
    item_description_source = 'master_data'
from dam.sku_human_description d
where sg.sku = d.sku
  and (sg.item_description, sg.item_description_source)
      is distinct from (d.description, 'master_data'::text);

-- Keep Master Data-owned group descriptions synchronized after each nightly lookup refresh.
create or replace function public.refresh_sku_human_description()
returns bigint
language plpgsql
security definer
set search_path = public, dam
as $$
declare
  v_row_count bigint;
begin
  truncate table dam.sku_human_description;

  insert into dam.sku_human_description (
    sku,
    description,
    tracker_type,
    source_row_id,
    source_updated_at,
    refreshed_at
  )
  select distinct on (trim(r.sku))
    trim(r.sku),
    trim(r.description),
    r.tracker_type,
    r.id,
    r.updated_at,
    now()
  from public.style_tracker_rows r
  where r.sku is not null
    and length(trim(r.sku)) > 0
    and r.description is not null
    and length(trim(r.description)) > 0
  order by trim(r.sku), r.updated_at desc nulls last;

  get diagnostics v_row_count = row_count;

  update public.style_groups sg
  set item_description = d.description,
      item_description_source = 'master_data'
  from dam.sku_human_description d
  where sg.sku = d.sku
    and (sg.item_description is null or sg.item_description_source = 'master_data')
    and (sg.item_description, sg.item_description_source)
        is distinct from (d.description, 'master_data'::text);

  return v_row_count;
end;
$$;

