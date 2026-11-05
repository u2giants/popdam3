with decl as (
    select a.sku,
           btrim(btrim((regexp_match(p.extracted_text,
             '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]),
             E' \t.,;:') as label
    from public.pdf_text_samples p
    join public.assets a on a.id = p.asset_id
    where p.extracted_text is not null
      and p.extracted_text ~* 'style\s+guide\s+used\s*:'
      and a.sku is not null and btrim(a.sku) <> ''
      and public.is_style_guide_source_pdf(a.file_type::text, a.filename)
  ),
  guides as (
    select distinct i.source_system, i.source_style_guide_key, i.style_guide_label,
           i.core_style_guide_id,
           public.style_guide_label_norm(i.style_guide_label) as ln
    from plm.asset_file_style_guide_index i
    where btrim(i.style_guide_label) <> ''
  ),
  hits as (
    select d.sku, g.source_system, g.source_style_guide_key,
           min(g.style_guide_label) as style_guide_label
    from decl d
    join guides g on g.ln = public.style_guide_label_norm(d.label)
    where public.style_guide_label_norm(d.label) is not null
    group by d.sku, g.source_system, g.source_style_guide_key
  )
select * from hits;