-- Extend the maintained DAM search corpus with product-level and file-level metadata.
-- Existing embeddings are preserved when content is unchanged and nulled when the hash changes.
-- The bulk re-index is intentionally deferred to the separately batched embedding/search pipeline.

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
