with src as (
    select distinct u.sku, u.file_name, public.file_name_norm(u.file_name) as fn
    from public.sku_files_used u
    where u.file_name is not null and btrim(u.file_name) <> ''
  ),
  hits as (
    select s.sku, s.file_name, i.source_system, i.source_style_guide_key,
           min(i.style_guide_label) as style_guide_label,
           min(i.core_style_guide_id::text)::uuid as core_style_guide_id,
           bool_or(lower(btrim(s.file_name)) = lower(btrim(i.matched_file_name))) as exact_match,
           count(distinct i.matched_file_name)    as matched_asset_count
    from src s
    join plm.asset_file_style_guide_index i on i.file_name_norm = s.fn
    group by s.sku, s.file_name, i.source_system, i.source_style_guide_key
  ),
  scored as (
    -- How many distinct portal guides this one (sku, file_name) lands on. More than
    -- one means the file name is not decisive, so confidence is divided accordingly.
    select h.*, count(*) over (partition by h.sku, h.file_name) as guide_count
    from hits h
  )
select * from scored;