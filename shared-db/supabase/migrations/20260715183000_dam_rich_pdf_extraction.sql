-- Rich tech-pack / licensing-sheet PDF extraction.
-- Product-level style_group metadata + a small asset facet projection, built on
-- the two-level foundation (20260714203000-203300). All additive.

-- ---------------------------------------------------------------------------
-- 0. Helper: flatten a jsonb value's scalar leaves into a search string.
-- ---------------------------------------------------------------------------
create or replace function dam.jsonb_leaf_text(p jsonb)
returns text
language sql
immutable
as $$
  select string_agg(j #>> '{}', ' ')
  from jsonb_path_query(coalesce(p, '{}'::jsonb), 'strict $.**') j
  where jsonb_typeof(j) in ('string', 'number');
$$;

comment on function dam.jsonb_leaf_text(jsonb) is
  'Concatenate all scalar (string/number) leaf values of a jsonb value, for folding structured metadata into search text.';

-- ---------------------------------------------------------------------------
-- 1. Raw per-PDF extraction (provenance + idempotency). One row per source PDF.
-- ---------------------------------------------------------------------------
create table dam.pdf_rich_extraction (
  asset_id uuid primary key references public.assets (id) on delete cascade,
  style_group_id uuid,
  sku text,
  doc_kind text check (doc_kind in ('tech_pack', 'licensing_sheet')),
  data jsonb not null default '{}'::jsonb,
  source_text_sha256 text,
  model text,
  prompt_version text,
  schema_version integer not null default 1,
  confidence numeric,
  parse_error text,
  extracted_at timestamptz not null default now()
);

create index idx_pdf_rich_extraction_style_group
  on dam.pdf_rich_extraction (style_group_id);

comment on table dam.pdf_rich_extraction is
  'Structured data extracted from tech-pack / licensing-sheet PDFs, one row per source PDF asset. source_text_sha256 makes re-extraction idempotent. Rolled up to style_groups.rich_metadata by refresh_style_group_rich_metadata().';

-- ---------------------------------------------------------------------------
-- 2. Product-level rollup columns on style_groups (mirror item_description).
-- ---------------------------------------------------------------------------
alter table public.style_groups
  add column rich_metadata jsonb,
  add column rich_metadata_source text,
  add column rich_metadata_updated_at timestamptz;

comment on column public.style_groups.rich_metadata is
  'Merged best structured PDF metadata for this SKU group (field-level newest-wins across member tech-pack/licensing-sheet extractions).';

-- ---------------------------------------------------------------------------
-- 3. Asset-level facet projection (v1 facet set; product-level values copied to
--    every member asset so FilterSidebar can facet directly).
-- ---------------------------------------------------------------------------
alter table public.assets
  add column product_material text[],
  add column product_dimensions text;

comment on column public.assets.product_material is
  'Facet projection of production materials from the SKU group rich_metadata.';
comment on column public.assets.product_dimensions is
  'Facet projection of product dimensions from the SKU group rich_metadata.';

-- ---------------------------------------------------------------------------
-- 4. Rollup: recompute style_groups.rich_metadata from member extractions and
--    project the v1 facet fields onto member assets.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_style_group_rich_metadata(p_style_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, dam
as $$
declare
  v_merged jsonb;
  v_source text;
  v_material text[];
  v_dimensions text;
begin
  if p_style_group_id is null then
    return;
  end if;

  -- Field-level newest-wins merge across the group's parsed member extractions.
  with members as (
    select data, extracted_at,
           row_number() over (order by extracted_at desc, asset_id) as rn
    from dam.pdf_rich_extraction
    where style_group_id = p_style_group_id
      and parse_error is null
      and data is not null
      and data <> '{}'::jsonb
  ),
  kv as (
    select e.key, e.value, m.rn
    from members m,
         lateral jsonb_each(m.data) e
    where e.value is not null and e.value <> 'null'::jsonb
  ),
  best as (
    select distinct on (key) key, value
    from kv
    order by key, rn asc
  )
  select jsonb_object_agg(key, value)
  into v_merged
  from best;

  select string_agg(distinct src, ', ')
  into v_source
  from (
    select coalesce(doc_kind, 'pdf') as src
    from dam.pdf_rich_extraction
    where style_group_id = p_style_group_id and parse_error is null
  ) s;

  update public.style_groups sg
  set rich_metadata = v_merged,
      rich_metadata_source = v_source,
      rich_metadata_updated_at = case when v_merged is null then null else now() end
  where sg.id = p_style_group_id
    and (sg.rich_metadata, sg.rich_metadata_source) is distinct from (v_merged, v_source);

  -- v1 facet projection onto member assets.
  v_material := case
    when jsonb_typeof(v_merged #> '{production_specs,materials}') = 'array'
      then array(select jsonb_array_elements_text(v_merged #> '{production_specs,materials}'))
    else null
  end;
  v_dimensions := v_merged #>> '{production_specs,dimensions}';

  update public.assets a
  set product_material = v_material,
      product_dimensions = v_dimensions
  where a.style_group_id = p_style_group_id
    and (a.product_material, a.product_dimensions) is distinct from (v_material, v_dimensions);
end;
$$;

comment on function public.refresh_style_group_rich_metadata(uuid) is
  'Recompute style_groups.rich_metadata from member dam.pdf_rich_extraction rows and project v1 facet fields (product_material, product_dimensions) onto member assets.';

-- ---------------------------------------------------------------------------
-- 5. Extend the DAM search corpus to fold in rich metadata + asset facets.
--    Re-declares the three functions from 20260714203300 with additions only.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_dam_search_asset_document(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_search_text text;
  v_hash text;
begin
  if not exists (select 1 from public.assets a where a.id = p_asset_id and a.is_deleted = false) then
    delete from public.dam_search_documents
    where document_type = 'asset' and entity_id = p_asset_id;
    return;
  end if;

  select concat_ws(
           ' ',
           a.filename,
           a.relative_path,
           a.content_type,
           sg.item_description,
           a.cover_description,
           a.ai_description,
           a.scene_description,
           a.customer,
           a.program,
           a.licensor_name,
           a.property_name,
           a.product_category,
           array_to_string(a.product_material, ' '),
           a.product_dimensions,
           dam.jsonb_leaf_text(sg.rich_metadata),
           pdf.extracted_text
         )
  into v_search_text
  from public.assets a
  left join public.style_groups sg on sg.id = a.style_group_id
  left join lateral (
    select string_agg(pts.extracted_text, ' ' order by pts.sampled_at desc) as extracted_text
    from public.pdf_text_samples pts
    where pts.asset_id = a.id
      and pts.extracted_text is not null
  ) pdf on true
  where a.id = p_asset_id;

  v_search_text := coalesce(v_search_text, '');
  v_hash := encode(digest(v_search_text, 'sha256'), 'hex');

  insert into public.dam_search_documents (
    document_type,
    entity_id,
    asset_id,
    style_group_id,
    title,
    path,
    customer,
    program,
    search_text,
    content_sha256,
    metadata,
    source_updated_at,
    indexed_at
  )
  select
    'asset',
    a.id,
    a.id,
    a.style_group_id,
    coalesce(a.filename, ''),
    coalesce(a.relative_path, ''),
    a.customer,
    a.program,
    v_search_text,
    v_hash,
    jsonb_strip_nulls(jsonb_build_object(
      'file_type', a.file_type,
      'asset_type', a.asset_type,
      'content_type', a.content_type,
      'item_description', sg.item_description,
      'product_material', a.product_material,
      'product_dimensions', a.product_dimensions,
      'workflow_status', a.workflow_status,
      'is_licensed', a.is_licensed,
      'licensor_name', a.licensor_name,
      'property_name', a.property_name,
      'product_category', a.product_category,
      'thumbnail_url', a.thumbnail_url
    )),
    greatest(coalesce(a.updated_at, '-infinity'::timestamptz), coalesce(a.modified_at, '-infinity'::timestamptz)),
    now()
  from public.assets a
  left join public.style_groups sg on sg.id = a.style_group_id
  where a.id = p_asset_id
    and a.is_deleted = false
  on conflict (document_type, entity_id) do update
  set asset_id = excluded.asset_id,
      style_group_id = excluded.style_group_id,
      title = excluded.title,
      path = excluded.path,
      customer = excluded.customer,
      program = excluded.program,
      search_text = excluded.search_text,
      content_sha256 = excluded.content_sha256,
      metadata = excluded.metadata,
      source_updated_at = excluded.source_updated_at,
      indexed_at = now(),
      embedding = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding
        else null
      end,
      embedding_model = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding_model
        else null
      end,
      embedding_updated_at = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding_updated_at
        else null
      end,
      embedding_error = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding_error
        else null
      end;
end;
$$;

create or replace function public.refresh_dam_search_style_group_document(p_style_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_search_text text;
  v_hash text;
begin
  if not exists (select 1 from public.style_groups sg where sg.id = p_style_group_id) then
    delete from public.dam_search_documents
    where document_type = 'style_group' and entity_id = p_style_group_id;
    return;
  end if;

  select concat_ws(
           ' ',
           sg.sku,
           sg.folder_path,
           sg.cover_description,
           sg.item_description,
           dam.jsonb_leaf_text(sg.rich_metadata),
           sg.customer,
           sg.program,
           sg.licensor_name,
           sg.property_name,
           sg.product_category,
           sg.division_name,
           sg.mg01_name,
           sg.mg02_name,
           sg.mg03_name,
           sg.size_name
         )
  into v_search_text
  from public.style_groups sg
  where sg.id = p_style_group_id;

  v_search_text := coalesce(v_search_text, '');
  v_hash := encode(digest(v_search_text, 'sha256'), 'hex');

  insert into public.dam_search_documents (
    document_type,
    entity_id,
    style_group_id,
    title,
    path,
    customer,
    program,
    search_text,
    content_sha256,
    metadata,
    source_updated_at,
    indexed_at
  )
  select
    'style_group',
    sg.id,
    sg.id,
    coalesce(sg.sku, ''),
    coalesce(sg.folder_path, ''),
    sg.customer,
    sg.program,
    v_search_text,
    v_hash,
    jsonb_strip_nulls(jsonb_build_object(
      'asset_count', sg.asset_count,
      'workflow_status', sg.workflow_status,
      'is_licensed', sg.is_licensed,
      'licensor_name', sg.licensor_name,
      'property_name', sg.property_name,
      'product_category', sg.product_category,
      'item_description_source', sg.item_description_source,
      'rich_metadata_source', sg.rich_metadata_source,
      'thumbnail_url', sg.primary_thumbnail_url
    )),
    greatest(coalesce(sg.updated_at, '-infinity'::timestamptz), coalesce(sg.latest_file_date, '-infinity'::timestamptz)),
    now()
  from public.style_groups sg
  where sg.id = p_style_group_id
  on conflict (document_type, entity_id) do update
  set style_group_id = excluded.style_group_id,
      title = excluded.title,
      path = excluded.path,
      customer = excluded.customer,
      program = excluded.program,
      search_text = excluded.search_text,
      content_sha256 = excluded.content_sha256,
      metadata = excluded.metadata,
      source_updated_at = excluded.source_updated_at,
      indexed_at = now(),
      embedding = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding
        else null
      end,
      embedding_model = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding_model
        else null
      end,
      embedding_updated_at = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding_updated_at
        else null
      end,
      embedding_error = case
        when public.dam_search_documents.content_sha256 = excluded.content_sha256 then public.dam_search_documents.embedding_error
        else null
      end;
end;
$$;

create or replace function public.rebuild_dam_search_documents()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_asset_count bigint := 0;
  v_group_count bigint := 0;
begin
  delete from public.dam_search_documents;

  insert into public.dam_search_documents (
    document_type,
    entity_id,
    asset_id,
    style_group_id,
    title,
    path,
    customer,
    program,
    search_text,
    content_sha256,
    metadata,
    source_updated_at,
    indexed_at
  )
  select
    'asset',
    a.id,
    a.id,
    a.style_group_id,
    coalesce(a.filename, ''),
    coalesce(a.relative_path, ''),
    a.customer,
    a.program,
    s.search_text,
    encode(digest(s.search_text, 'sha256'), 'hex'),
    jsonb_strip_nulls(jsonb_build_object(
      'file_type', a.file_type,
      'asset_type', a.asset_type,
      'content_type', a.content_type,
      'item_description', sg.item_description,
      'product_material', a.product_material,
      'product_dimensions', a.product_dimensions,
      'workflow_status', a.workflow_status,
      'is_licensed', a.is_licensed,
      'licensor_name', a.licensor_name,
      'property_name', a.property_name,
      'product_category', a.product_category,
      'thumbnail_url', a.thumbnail_url
    )),
    greatest(coalesce(a.updated_at, '-infinity'::timestamptz), coalesce(a.modified_at, '-infinity'::timestamptz)),
    now()
  from public.assets a
  left join public.style_groups sg on sg.id = a.style_group_id
  left join lateral (
    select string_agg(pts.extracted_text, ' ' order by pts.sampled_at desc) as extracted_text
    from public.pdf_text_samples pts
    where pts.asset_id = a.id
      and pts.extracted_text is not null
  ) pdf on true
  cross join lateral (
    select coalesce(concat_ws(
      ' ',
      a.filename,
      a.relative_path,
      a.content_type,
      sg.item_description,
      a.cover_description,
      a.ai_description,
      a.scene_description,
      a.customer,
      a.program,
      a.licensor_name,
      a.property_name,
      a.product_category,
      array_to_string(a.product_material, ' '),
      a.product_dimensions,
      dam.jsonb_leaf_text(sg.rich_metadata),
      pdf.extracted_text
    ), '') as search_text
  ) s
  where a.is_deleted = false;

  get diagnostics v_asset_count = row_count;

  insert into public.dam_search_documents (
    document_type,
    entity_id,
    style_group_id,
    title,
    path,
    customer,
    program,
    search_text,
    content_sha256,
    metadata,
    source_updated_at,
    indexed_at
  )
  select
    'style_group',
    sg.id,
    sg.id,
    coalesce(sg.sku, ''),
    coalesce(sg.folder_path, ''),
    sg.customer,
    sg.program,
    s.search_text,
    encode(digest(s.search_text, 'sha256'), 'hex'),
    jsonb_strip_nulls(jsonb_build_object(
      'asset_count', sg.asset_count,
      'workflow_status', sg.workflow_status,
      'is_licensed', sg.is_licensed,
      'licensor_name', sg.licensor_name,
      'property_name', sg.property_name,
      'product_category', sg.product_category,
      'item_description_source', sg.item_description_source,
      'rich_metadata_source', sg.rich_metadata_source,
      'thumbnail_url', sg.primary_thumbnail_url
    )),
    greatest(coalesce(sg.updated_at, '-infinity'::timestamptz), coalesce(sg.latest_file_date, '-infinity'::timestamptz)),
    now()
  from public.style_groups sg
  cross join lateral (
    select coalesce(concat_ws(
      ' ',
      sg.sku,
      sg.folder_path,
      sg.cover_description,
      sg.item_description,
      dam.jsonb_leaf_text(sg.rich_metadata),
      sg.customer,
      sg.program,
      sg.licensor_name,
      sg.property_name,
      sg.product_category,
      sg.division_name,
      sg.mg01_name,
      sg.mg02_name,
      sg.mg03_name,
      sg.size_name
    ), '') as search_text
  ) s;

  get diagnostics v_group_count = row_count;

  return jsonb_build_object(
    'asset_documents', v_asset_count,
    'style_group_documents', v_group_count,
    'rebuilt_at', now()
  );
end;
$$;
