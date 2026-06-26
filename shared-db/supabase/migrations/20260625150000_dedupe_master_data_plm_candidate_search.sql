-- Dedupe Master Data candidates when multiple PLM source refs resolve to the
-- same canonical row. Keep the strongest scoring label per target.

create or replace function public.search_style_tracker_link_candidates(
  p_field_key text,
  p_query text,
  p_limit integer default 20,
  p_match_mode text default 'fuzzy'
)
returns table (
  target_schema text,
  target_table text,
  target_id uuid,
  target_label text,
  score real
)
language plpgsql
stable
security definer
set search_path = public, core, plm, extensions, pg_catalog
as $$
declare
  q text := lower(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  max_rows integer := greatest(1, least(coalesce(p_limit, 20), 500));
  use_all boolean := coalesce(p_match_mode, 'fuzzy') = 'all';
  min_score real := 0.35;
begin
  if nullif(q, '') is null then
    return;
  end if;

  if p_field_key = 'customer' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'customer'::text as target_table,
        c.id as target_id,
        coalesce(nullif(csr.source_name, ''), c.name) as target_label,
        greatest(
          similarity(lower(c.name), q),
          similarity(lower(coalesce(csr.source_name, '')), q),
          similarity(lower(coalesce(csr.source_code, '')), q),
          case
            when lower(c.name) = q or lower(coalesce(csr.source_name, '')) = q then 1::real
            when length(c.name) >= 4 and q like '%' || lower(c.name) || '%' then 0.9::real
            when length(coalesce(csr.source_name, '')) >= 4 and q like '%' || lower(csr.source_name) || '%' then 0.9::real
            when lower(c.name) like '%' || q || '%' or lower(coalesce(csr.source_name, '')) like '%' || q || '%' then 0.85::real
            when lower(coalesce(csr.source_code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        c.status
      from core.customer c
      join core.company_source_ref csr on csr.company_id = c.id
      where csr.source_system = 'designflow_plm'
        and csr.source_table = 'customers'
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'licensor' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'licensor'::text as target_table,
        l.id as target_id,
        coalesce(nullif(tsr.source_name, ''), l.name) as target_label,
        greatest(
          similarity(lower(l.name), q),
          similarity(lower(coalesce(tsr.source_name, '')), q),
          similarity(lower(coalesce(tsr.source_code, '')), q),
          case
            when lower(l.name) = q or lower(coalesce(tsr.source_name, '')) = q then 1::real
            when length(l.name) >= 4 and q like '%' || lower(l.name) || '%' then 0.9::real
            when length(coalesce(tsr.source_name, '')) >= 4 and q like '%' || lower(tsr.source_name) || '%' then 0.9::real
            when lower(l.name) like '%' || q || '%' or lower(coalesce(tsr.source_name, '')) like '%' || q || '%' then 0.85::real
            when lower(coalesce(tsr.source_code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        l.status
      from core.licensor l
      join core.taxonomy_source_ref tsr on tsr.entity_id = l.id
      where tsr.entity_schema = 'core'
        and tsr.entity_table = 'licensor'
        and tsr.source_system = 'designflow_plm'
        and tsr.source_table = 'merchGroup'
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'property' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'property'::text as target_table,
        p.id as target_id,
        concat_ws(' / ', nullif(l.name, ''), coalesce(nullif(tsr.source_name, ''), p.name)) as target_label,
        greatest(
          similarity(lower(p.name), q),
          similarity(lower(coalesce(tsr.source_name, '')), q),
          similarity(lower(coalesce(tsr.source_code, '')), q),
          case
            when lower(p.name) = q or lower(coalesce(tsr.source_name, '')) = q then 1::real
            when length(p.name) >= 4 and q like '%' || lower(p.name) || '%' then 0.9::real
            when length(coalesce(tsr.source_name, '')) >= 4 and q like '%' || lower(tsr.source_name) || '%' then 0.9::real
            when lower(p.name) like '%' || q || '%' or lower(coalesce(tsr.source_name, '')) like '%' || q || '%' then 0.85::real
            when lower(coalesce(tsr.source_code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        p.status
      from core.property p
      join core.licensor l on l.id = p.licensor_id
      join core.taxonomy_source_ref tsr on tsr.entity_id = p.id
      where tsr.entity_schema = 'core'
        and tsr.entity_table = 'property'
        and tsr.source_system = 'designflow_plm'
        and tsr.source_table = 'merchGroup'
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'factory' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'factory'::text as target_table,
        f.id as target_id,
        f.name as target_label,
        greatest(
          similarity(lower(f.name), q),
          similarity(lower(coalesce(f.code, '')), q),
          case
            when lower(f.name) = q then 1::real
            when length(f.name) >= 4 and q like '%' || lower(f.name) || '%' then 0.9::real
            when lower(f.name) like '%' || q || '%' then 0.85::real
            when lower(coalesce(f.code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        f.status
      from core.factory f
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'sku' then
    return query
    with candidates as (
      select
        'public'::text as target_schema,
        'style_groups'::text as target_table,
        sg.id as target_id,
        sg.sku as target_label,
        greatest(
          similarity(lower(sg.sku), q),
          case
            when lower(sg.sku) = q then 1::real
            when length(sg.sku) >= 4 and q like '%' || lower(sg.sku) || '%' then 0.9::real
            when lower(sg.sku) like '%' || q || '%' then 0.85::real
            else 0::real
          end
        )::real as score
      from public.style_groups sg
      where sg.sku is not null
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by r.score desc, r.target_label
    limit max_rows;
    return;
  end if;
end;
$$;

grant execute on function public.search_style_tracker_link_candidates(text, text, integer, text) to authenticated;

comment on function public.search_style_tracker_link_candidates(text, text, integer, text)
  is 'Master Data candidate search. Customer/licensor/property candidates are limited to PLM-backed canonical rows via designflow_plm source refs.';
