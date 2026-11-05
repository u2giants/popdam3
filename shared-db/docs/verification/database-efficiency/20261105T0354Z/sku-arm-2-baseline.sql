with raw_decl as (
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
  decl as (
    -- One proposal per result identity, including equivalent OCR spellings.
    select sku, public.style_guide_label_norm(label) as label_key, min(label) as label
    from raw_decl
    where label <> ''
      and public.style_guide_label_norm(label) is not null
      and public.is_plausible_source_file_name(label)
    group by sku, public.style_guide_label_norm(label)
  )
select * from decl;