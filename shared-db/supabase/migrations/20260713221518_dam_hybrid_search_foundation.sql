-- DAM search foundation:
-- 1. Enable Supabase/Postgres performance tooling extensions.
-- 2. Move library search onto a maintained document table with a stored tsvector.
-- 3. Add pgvector-ready embedding storage and hybrid search RPC support.

set statement_timeout = '10min';

create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists hypopg with schema extensions;
create extension if not exists index_advisor cascade;
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.dam_search_documents (
  document_type text not null check (document_type in ('asset', 'style_group')),
  entity_id uuid not null,
  asset_id uuid null,
  style_group_id uuid null,
  title text not null default '',
  path text not null default '',
  customer text null,
  program text null,
  search_text text not null default '',
  content_sha256 text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(384) null,
  embedding_model text null,
  embedding_updated_at timestamptz null,
  embedding_error text null,
  source_updated_at timestamptz null,
  indexed_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' ||
      coalesce(path, '') || ' ' ||
      coalesce(customer, '') || ' ' ||
      coalesce(program, '') || ' ' ||
      coalesce(search_text, '')
    )
  ) stored,
  primary key (document_type, entity_id)
);

create index if not exists idx_dam_search_documents_asset_id
  on public.dam_search_documents (asset_id)
  where asset_id is not null;

create index if not exists idx_dam_search_documents_style_group_id
  on public.dam_search_documents (style_group_id)
  where style_group_id is not null;

create index if not exists idx_dam_search_documents_tsv
  on public.dam_search_documents using gin (search_tsv);

create index if not exists idx_dam_search_documents_title_trgm
  on public.dam_search_documents using gin (title extensions.gin_trgm_ops);

create index if not exists idx_dam_search_documents_path_trgm
  on public.dam_search_documents using gin (path extensions.gin_trgm_ops);

create index if not exists idx_dam_search_documents_customer_trgm
  on public.dam_search_documents using gin (customer extensions.gin_trgm_ops);

create index if not exists idx_dam_search_documents_program_trgm
  on public.dam_search_documents using gin (program extensions.gin_trgm_ops);

create index if not exists idx_dam_search_documents_embedding_hnsw
  on public.dam_search_documents
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

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

select public.rebuild_dam_search_documents();

create or replace function public.trg_refresh_dam_asset_search_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.dam_search_documents
    where document_type = 'asset' and entity_id = old.id;
    return old;
  end if;

  perform public.refresh_dam_search_asset_document(new.id);
  return new;
end;
$$;

create or replace function public.trg_refresh_dam_style_group_search_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.dam_search_documents
    where document_type = 'style_group' and entity_id = old.id;
    return old;
  end if;

  perform public.refresh_dam_search_style_group_document(new.id);
  return new;
end;
$$;

create or replace function public.trg_refresh_dam_pdf_search_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_dam_search_asset_document(old.asset_id);
    return old;
  end if;

  perform public.refresh_dam_search_asset_document(new.asset_id);
  return new;
end;
$$;

drop trigger if exists trg_dam_search_assets_refresh on public.assets;
create trigger trg_dam_search_assets_refresh
after insert or update of
  filename,
  relative_path,
  cover_description,
  ai_description,
  scene_description,
  customer,
  program,
  licensor_name,
  property_name,
  product_category,
  thumbnail_url,
  file_type,
  asset_type,
  workflow_status,
  is_licensed,
  style_group_id,
  is_deleted,
  updated_at,
  modified_at
or delete on public.assets
for each row
execute function public.trg_refresh_dam_asset_search_document();

drop trigger if exists trg_dam_search_style_groups_refresh on public.style_groups;
create trigger trg_dam_search_style_groups_refresh
after insert or update of
  sku,
  folder_path,
  cover_description,
  customer,
  program,
  licensor_name,
  property_name,
  product_category,
  division_name,
  mg01_name,
  mg02_name,
  mg03_name,
  size_name,
  asset_count,
  workflow_status,
  is_licensed,
  primary_thumbnail_url,
  updated_at,
  latest_file_date
or delete on public.style_groups
for each row
execute function public.trg_refresh_dam_style_group_search_document();

drop trigger if exists trg_dam_search_pdf_text_samples_refresh on public.pdf_text_samples;
create trigger trg_dam_search_pdf_text_samples_refresh
after insert or update of extracted_text, sampled_at or delete on public.pdf_text_samples
for each row
execute function public.trg_refresh_dam_pdf_search_document();

create or replace function public.search_dam_documents(
  p_query text,
  p_limit int default 500,
  p_document_types text[] default null,
  p_query_embedding extensions.vector(384) default null
)
returns table(
  document_type text,
  entity_id uuid,
  asset_id uuid,
  style_group_id uuid,
  keyword_rank real,
  semantic_rank real,
  rank real
)
language sql
stable
security definer
set search_path = public, extensions
set statement_timeout = '8s'
as $$
  with normalized as (
    select nullif(trim(p_query), '') as query_text,
           greatest(1, least(coalesce(p_limit, 500), 20000)) as result_limit,
           p_query_embedding as query_embedding
  ),
  q as (
    select websearch_to_tsquery('simple', query_text) as tsq,
           '%' || query_text || '%' as like_pattern,
           result_limit,
           query_embedding
    from normalized
    where query_text is not null
  ),
  keyword_matches as (
    select
      d.document_type,
      d.entity_id,
      d.asset_id,
      d.style_group_id,
      greatest(
        ts_rank_cd(d.search_tsv, q.tsq),
        case
          when d.title ilike q.like_pattern then 0.04
          when d.path ilike q.like_pattern then 0.03
          when d.customer ilike q.like_pattern or d.program ilike q.like_pattern then 0.02
          else 0.01
        end
      )::real as keyword_rank,
      null::real as semantic_rank
    from public.dam_search_documents d
    cross join q
    where (p_document_types is null or d.document_type = any(p_document_types))
      and (
        d.search_tsv @@ q.tsq
        or d.title ilike q.like_pattern
        or d.path ilike q.like_pattern
        or d.customer ilike q.like_pattern
        or d.program ilike q.like_pattern
      )
  ),
  semantic_matches as (
    select
      d.document_type,
      d.entity_id,
      d.asset_id,
      d.style_group_id,
      null::real as keyword_rank,
      greatest(0, 1 - (d.embedding <=> q.query_embedding))::real as semantic_rank
    from public.dam_search_documents d
    cross join q
    where q.query_embedding is not null
      and d.embedding is not null
      and (p_document_types is null or d.document_type = any(p_document_types))
    order by d.embedding <=> q.query_embedding
    limit (select result_limit from q)
  ),
  combined as (
    select * from keyword_matches
    union all
    select * from semantic_matches
  )
  select
    combined.document_type,
    combined.entity_id,
    combined.asset_id,
    combined.style_group_id,
    max(combined.keyword_rank)::real as keyword_rank,
    max(combined.semantic_rank)::real as semantic_rank,
    (
      coalesce(max(combined.keyword_rank), 0) +
      coalesce(max(combined.semantic_rank), 0) * 0.35
    )::real as rank
  from combined
  group by combined.document_type, combined.entity_id, combined.asset_id, combined.style_group_id
  order by (
    coalesce(max(combined.keyword_rank), 0) +
    coalesce(max(combined.semantic_rank), 0) * 0.35
  ) desc, combined.document_type, combined.entity_id
  limit (select result_limit from q);
$$;

create or replace function public.search_assets_full_text(
  p_query text,
  p_limit int default 10000
)
returns table(
  asset_id uuid,
  style_group_id uuid,
  rank real
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '8s'
as $$
  select
    d.asset_id,
    d.style_group_id,
    d.rank
  from public.search_dam_documents(p_query, p_limit, array['asset']::text[], null) d
  where d.asset_id is not null;
$$;

create or replace function public.search_style_groups_full_text(
  p_query text,
  p_limit int default 10000
)
returns table(
  style_group_id uuid,
  rank real
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '8s'
as $$
  with direct_groups as (
    select d.style_group_id, d.rank
    from public.search_dam_documents(p_query, p_limit, array['style_group']::text[], null) d
    where d.style_group_id is not null
  ),
  asset_groups as (
    select d.style_group_id, max(d.rank) * 0.8 as rank
    from public.search_dam_documents(p_query, p_limit, array['asset']::text[], null) d
    where d.style_group_id is not null
    group by d.style_group_id
  ),
  combined as (
    select * from direct_groups
    union all
    select * from asset_groups
  )
  select combined.style_group_id, max(combined.rank)::real as rank
  from combined
  group by combined.style_group_id
  order by max(combined.rank) desc, combined.style_group_id
  limit greatest(1, least(coalesce(p_limit, 10000), 20000));
$$;

create or replace function public.claim_dam_search_embedding_documents(
  p_limit int default 100
)
returns table(
  document_type text,
  entity_id uuid,
  search_text text,
  content_sha256 text
)
language sql
stable
security definer
set search_path = public
as $$
  select d.document_type, d.entity_id, left(d.search_text, 8000), d.content_sha256
  from public.dam_search_documents d
  where d.embedding is null
    and d.embedding_error is null
  order by d.indexed_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

create or replace function public.upsert_dam_search_embedding(
  p_document_type text,
  p_entity_id uuid,
  p_content_sha256 text,
  p_embedding extensions.vector(384),
  p_embedding_model text default 'gte-small'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dam_search_documents
  set embedding = p_embedding,
      embedding_model = p_embedding_model,
      embedding_updated_at = now(),
      embedding_error = null
  where document_type = p_document_type
    and entity_id = p_entity_id
    and content_sha256 = p_content_sha256;

  return found;
end;
$$;

create or replace function public.mark_dam_search_embedding_error(
  p_document_type text,
  p_entity_id uuid,
  p_content_sha256 text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dam_search_documents
  set embedding_error = left(coalesce(p_error, 'unknown embedding error'), 1000)
  where document_type = p_document_type
    and entity_id = p_entity_id
    and content_sha256 = p_content_sha256;

  return found;
end;
$$;

create or replace function public.get_dam_search_embedding_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_documents', count(*),
    'embedded_documents', count(*) filter (where embedding is not null),
    'pending_documents', count(*) filter (where embedding is null and embedding_error is null),
    'errored_documents', count(*) filter (where embedding_error is not null),
    'asset_documents', count(*) filter (where document_type = 'asset'),
    'style_group_documents', count(*) filter (where document_type = 'style_group'),
    'oldest_pending_indexed_at', min(indexed_at) filter (where embedding is null and embedding_error is null),
    'newest_indexed_at', max(indexed_at)
  )
  from public.dam_search_documents;
$$;

create or replace function public.get_dam_search_performance_stats()
returns table(
  query text,
  calls bigint,
  mean_exec_ms double precision,
  max_exec_ms double precision,
  total_exec_ms double precision,
  rows bigint,
  shared_blks_hit bigint,
  shared_blks_read bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    left(s.query, 500) as query,
    s.calls,
    s.mean_exec_time as mean_exec_ms,
    s.max_exec_time as max_exec_ms,
    s.total_exec_time as total_exec_ms,
    s.rows,
    s.shared_blks_hit,
    s.shared_blks_read
  from extensions.pg_stat_statements s
  where s.query ilike '%search_dam_documents%'
     or s.query ilike '%search_assets_full_text%'
     or s.query ilike '%search_style_groups_full_text%'
     or s.query ilike '%get_filter_counts%'
  order by s.total_exec_time desc
  limit 25;
$$;

create or replace function public.advise_dam_search_query_indexes(p_query text)
returns table(
  startup_cost_before jsonb,
  startup_cost_after jsonb,
  total_cost_before jsonb,
  total_cost_after jsonb,
  index_statements text[],
  errors text[]
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select *
  from index_advisor(p_query);
$$;

grant select on public.dam_search_documents to service_role;
grant execute on function public.search_dam_documents(text, int, text[], extensions.vector(384)) to authenticated, service_role;
grant execute on function public.search_assets_full_text(text, int) to authenticated, service_role;
grant execute on function public.search_style_groups_full_text(text, int) to authenticated, service_role;
grant execute on function public.get_dam_search_embedding_status() to service_role;
grant execute on function public.get_dam_search_performance_stats() to service_role;
grant execute on function public.advise_dam_search_query_indexes(text) to service_role;
grant execute on function public.claim_dam_search_embedding_documents(int) to service_role;
grant execute on function public.upsert_dam_search_embedding(text, uuid, text, extensions.vector(384), text) to service_role;
grant execute on function public.mark_dam_search_embedding_error(text, uuid, text, text) to service_role;
