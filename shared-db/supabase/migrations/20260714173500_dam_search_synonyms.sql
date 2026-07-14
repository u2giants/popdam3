-- Add a table-driven DAM search vocabulary so business-language aliases can be
-- improved without rewriting the search RPC each time.

create table if not exists public.dam_search_synonyms (
  search_term text primary key,
  expansion text not null,
  note text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dam_search_synonyms_search_term_format
    check (search_term = lower(search_term) and search_term ~ '^[[:alnum:] ]+$'),
  constraint dam_search_synonyms_expansion_not_blank
    check (btrim(expansion) <> '')
);

comment on table public.dam_search_synonyms is
  'Curated DAM search aliases. Terms are normalized lowercase words; expansions are query text variants.';
comment on column public.dam_search_synonyms.search_term is
  'Lowercase normalized term to look for in a user query, using spaces instead of punctuation.';
comment on column public.dam_search_synonyms.expansion is
  'Replacement query text, for example spiderman -> spider man or canvas -> wall art.';

create or replace function public.touch_dam_search_synonyms_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_dam_search_synonyms_updated_at on public.dam_search_synonyms;
create trigger trg_dam_search_synonyms_updated_at
before update on public.dam_search_synonyms
for each row
execute function public.touch_dam_search_synonyms_updated_at();

insert into public.dam_search_synonyms (search_term, expansion, note)
values
  ('spiderman', 'spider man', 'Collapsed character name; most metadata is Spider-Man / Spider Man.'),
  ('mickeymouse', 'mickey mouse', 'Collapsed character name.'),
  ('minniemouse', 'minnie mouse', 'Collapsed character name.'),
  ('winniethepooh', 'winnie the pooh', 'Collapsed character/property name.'),
  ('pooh', 'winnie the pooh', 'Common shorthand for Winnie the Pooh.'),
  ('starwars', 'star wars', 'Collapsed property name.'),
  ('blackpanther', 'black panther', 'Collapsed character/property name.'),
  ('captainamerica', 'captain america', 'Collapsed character/property name.'),
  ('ironman', 'iron man', 'Collapsed character name.'),
  ('deadpoolwolverine', 'deadpool wolverine', 'Collapsed property/style-guide naming.'),
  ('jurassicworld', 'jurassic world', 'Collapsed property name.'),
  ('toystory', 'toy story', 'Collapsed property name.'),
  ('nightmarebeforechristmas', 'nightmare before christmas', 'Collapsed property name.'),
  ('nightmare', 'nightmare before christmas', 'Common shorthand for Nightmare Before Christmas.'),
  ('3 d', '3d', 'Punctuation-normalized 3-D searches should still match 3D text.'),
  ('3d', 'lenticular', 'Sales/design shorthand for lenticular wall-art treatments.'),
  ('lenticular', '3d', 'Reverse synonym for 3D/lenticular art.'),
  ('canvas', 'wall art', 'Canvas is often categorized under Wall / Wall Art.'),
  ('stretched canvas', 'canvas', 'Product-type wording variant.'),
  ('wall decor', 'wall art', 'Product category wording variant.'),
  ('wallart', 'wall art', 'Collapsed product category wording.'),
  ('prints', 'wall art', 'Common sales shorthand for printable wall-art programs.'),
  ('poster', 'wall art', 'Common sales shorthand for wall-art products.')
on conflict (search_term) do update
set expansion = excluded.expansion,
    note = excluded.note,
    is_active = true,
    updated_at = now();

create or replace function public.expand_dam_search_queries(p_query text)
returns table(query_text text)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(
      btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')),
      ''
    ) as raw_query
  ),
  base_variants as (
    select raw_query as query_text
    from normalized
    where raw_query is not null

    union

    select nullif(
      btrim(
        regexp_replace(
          regexp_replace(raw_query, '[-_/]+', ' ', 'g'),
          '\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) as query_text
    from normalized
    where raw_query is not null
  ),
  synonym_pass_1 as (
    select distinct nullif(
      btrim(
        regexp_replace(
          b.query_text,
          '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)',
          E'\\1' || s.expansion || E'\\2',
          'gi'
        )
      ),
      ''
    ) as query_text
    from base_variants b
    join public.dam_search_synonyms s
      on s.is_active
     and lower(b.query_text) ~ (
       '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)'
     )
  ),
  synonym_pass_2 as (
    select distinct nullif(
      btrim(
        regexp_replace(
          p.query_text,
          '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)',
          E'\\1' || s.expansion || E'\\2',
          'gi'
        )
      ),
      ''
    ) as query_text
    from synonym_pass_1 p
    join public.dam_search_synonyms s
      on s.is_active
     and lower(p.query_text) ~ (
       '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)'
     )
  ),
  synonym_variants as (
    select query_text from synonym_pass_1
    union
    select query_text from synonym_pass_2
  )
  select distinct query_text
  from (
    select query_text from base_variants
    union all
    select query_text from synonym_variants
  ) variants
  where query_text is not null;
$$;

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
    select websearch_to_tsquery('simple', v.query_text) as tsq,
           '%' || v.query_text || '%' as like_pattern,
           n.result_limit,
           n.query_embedding
    from normalized n
    cross join public.expand_dam_search_queries(n.query_text) v
    where n.query_text is not null
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
    limit (select result_limit from normalized)
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
  limit (select result_limit from normalized);
$$;

grant select on public.dam_search_synonyms to authenticated, service_role;
grant execute on function public.expand_dam_search_queries(text) to authenticated, service_role;
grant execute on function public.search_dam_documents(text, int, text[], extensions.vector(384)) to authenticated, service_role;
