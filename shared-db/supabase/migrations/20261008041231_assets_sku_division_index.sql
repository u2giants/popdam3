-- derived-from: none
-- PopDAM ERP apply matches assets by (sku, division_code) on live rows; without
-- this index each lookup scans the whole table (~17.7 s, over the 8 s API limit).
create index if not exists idx_assets_sku_division_active
  on public.assets (sku, division_code)
  where is_deleted = false;
