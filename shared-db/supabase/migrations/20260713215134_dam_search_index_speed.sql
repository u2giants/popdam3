-- DAM library search: keep substring search indexed.
--
-- The 20260709151000 compatibility migration preserved old substring semantics
-- by adding broad ILIKE OR predicates across every metadata text column. On the
-- production asset table, SKU-prefix searches such as "3fz" fell off the GIN
-- path and took tens of seconds. Keep substring matching for SKU/path-style
-- fields, but let description/licensor/property/category text use the existing
-- full-text GIN indexes.

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_style_groups_sku_trgm
  on public.style_groups using gin (sku extensions.gin_trgm_ops);

create index if not exists idx_style_groups_folder_path_trgm
  on public.style_groups using gin (folder_path extensions.gin_trgm_ops);

create index if not exists idx_style_groups_customer_trgm
  on public.style_groups using gin (customer extensions.gin_trgm_ops);

create index if not exists idx_style_groups_program_trgm
  on public.style_groups using gin (program extensions.gin_trgm_ops);

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
  with normalized as (
    select nullif(trim(p_query), '') as query_text,
           greatest(1, least(coalesce(p_limit, 10000), 20000)) as result_limit
  ),
  q as (
    select websearch_to_tsquery('simple', query_text) as tsq,
           '%' || query_text || '%' as like_pattern,
           result_limit
    from normalized
    where query_text is not null
  ),
  asset_matches as (
    select
      a.id as asset_id,
      a.style_group_id,
      greatest(
        ts_rank_cd(
          to_tsvector(
            'simple',
            (coalesce(a.filename, '') || ' ' || coalesce(a.relative_path, '') || ' ' || coalesce(a.cover_description, '') || ' ' || coalesce(a.ai_description, '') || ' ' || coalesce(a.scene_description, '') || ' ' || coalesce(a.customer, '') || ' ' || coalesce(a.program, '') || ' ' || coalesce(a.licensor_name, '') || ' ' || coalesce(a.property_name, '') || ' ' || coalesce(a.product_category, ''))
          ),
          q.tsq
        ),
        case
          when a.filename ilike q.like_pattern then 0.04
          when a.relative_path ilike q.like_pattern then 0.03
          when a.customer ilike q.like_pattern or a.program ilike q.like_pattern then 0.02
          else 0.01
        end
      ) as rank
    from public.assets a
    cross join q
    where a.is_deleted = false
      and (
        to_tsvector(
          'simple',
          (coalesce(a.filename, '') || ' ' || coalesce(a.relative_path, '') || ' ' || coalesce(a.cover_description, '') || ' ' || coalesce(a.ai_description, '') || ' ' || coalesce(a.scene_description, '') || ' ' || coalesce(a.customer, '') || ' ' || coalesce(a.program, '') || ' ' || coalesce(a.licensor_name, '') || ' ' || coalesce(a.property_name, '') || ' ' || coalesce(a.product_category, ''))
        ) @@ q.tsq
        or a.filename ilike q.like_pattern
        or a.relative_path ilike q.like_pattern
        or a.customer ilike q.like_pattern
        or a.program ilike q.like_pattern
      )
  ),
  pdf_matches as (
    select
      pts.asset_id,
      a.style_group_id,
      ts_rank_cd(to_tsvector('simple', coalesce(pts.extracted_text, '')), q.tsq) * 0.5 as rank
    from public.pdf_text_samples pts
    join public.assets a on a.id = pts.asset_id
    cross join q
    where a.is_deleted = false
      and pts.extracted_text is not null
      and to_tsvector('simple', coalesce(pts.extracted_text, '')) @@ q.tsq
  ),
  combined as (
    select * from asset_matches
    union all
    select * from pdf_matches
  )
  select
    combined.asset_id,
    combined.style_group_id,
    max(combined.rank)::real as rank
  from combined
  group by combined.asset_id, combined.style_group_id
  order by max(combined.rank) desc, combined.asset_id
  limit (select result_limit from q);
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
  with normalized as (
    select nullif(trim(p_query), '') as query_text,
           greatest(1, least(coalesce(p_limit, 10000), 20000)) as result_limit
  ),
  q as (
    select websearch_to_tsquery('simple', query_text) as tsq,
           '%' || query_text || '%' as like_pattern,
           result_limit
    from normalized
    where query_text is not null
  ),
  group_matches as (
    select
      sg.id as style_group_id,
      greatest(
        ts_rank_cd(
          to_tsvector(
            'simple',
            (coalesce(sg.sku, '') || ' ' || coalesce(sg.folder_path, '') || ' ' || coalesce(sg.cover_description, '') || ' ' || coalesce(sg.customer, '') || ' ' || coalesce(sg.program, '') || ' ' || coalesce(sg.licensor_name, '') || ' ' || coalesce(sg.property_name, '') || ' ' || coalesce(sg.product_category, ''))
          ),
          q.tsq
        ),
        case
          when sg.sku ilike q.like_pattern then 0.04
          when sg.folder_path ilike q.like_pattern then 0.03
          when sg.customer ilike q.like_pattern or sg.program ilike q.like_pattern then 0.02
          else 0.01
        end
      ) as rank
    from public.style_groups sg
    cross join q
    where to_tsvector(
      'simple',
      (coalesce(sg.sku, '') || ' ' || coalesce(sg.folder_path, '') || ' ' || coalesce(sg.cover_description, '') || ' ' || coalesce(sg.customer, '') || ' ' || coalesce(sg.program, '') || ' ' || coalesce(sg.licensor_name, '') || ' ' || coalesce(sg.property_name, '') || ' ' || coalesce(sg.product_category, ''))
    ) @@ q.tsq
    or sg.sku ilike q.like_pattern
    or sg.folder_path ilike q.like_pattern
    or sg.customer ilike q.like_pattern
    or sg.program ilike q.like_pattern
  ),
  asset_group_matches as (
    select
      m.style_group_id,
      max(m.rank) * 0.8 as rank
    from public.search_assets_full_text(p_query, p_limit) m
    where m.style_group_id is not null
    group by m.style_group_id
  ),
  combined as (
    select * from group_matches
    union all
    select * from asset_group_matches
  )
  select
    combined.style_group_id,
    max(combined.rank)::real as rank
  from combined
  group by combined.style_group_id
  order by max(combined.rank) desc, combined.style_group_id
  limit (select result_limit from q);
$$;

grant execute on function public.search_assets_full_text(text, int) to authenticated, service_role;
grant execute on function public.search_style_groups_full_text(text, int) to authenticated, service_role;
