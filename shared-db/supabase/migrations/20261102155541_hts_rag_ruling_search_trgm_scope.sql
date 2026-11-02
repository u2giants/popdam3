-- Narrow the ruling search trigram pass for the chapter-scoped benchmark
-- (issue #5283, claim #5432; unblocks shared-db #5188's live assertion).
-- derived-from: none
--
-- Profiled on production (issue #5188 comment 6553758780, #5283 comments
-- 6553845723/6554406461): the chapter-scoped search's trigram pass was 5,612 ms
-- (3,758 ms after the covering index) because the planner drives from the
-- 950-row chapter scope and re-evaluates the similarity filter per probe. Run
-- WITHOUT the scope semi-join, the same predicate takes the intended plan —
-- `Bitmap Index Scan on hts_rag_rulings_subject_trgm_active_idx` — in about
-- 1.8 s, most of that the GIN scan itself. This rewrites only the trigram pass:
-- the candidates are materialized first (forcing that index plan), and the
-- chapter scope then filters that small set. Everything else is identical —
-- return shape, RRF fusion, the full-text and vector passes, and the
-- pg_trgm.word_similarity_threshold pin. A reissue of the same objects as
-- 20261101000005, idempotent for replay.

select extensions.word_similarity('', '');

create or replace function hts_rag.hts_rag_search_rulings_pass(
  p_query text,
  p_tsquery tsquery,
  p_query_embedding extensions.halfvec(768),
  p_scope_chapters text[]
)
returns table (ruling_number text, fts_rank integer, trgm_rank integer, vector_rank integer)
language sql
stable
security invoker
set search_path = ''
set pg_trgm.word_similarity_threshold = '0.4'
as $function$
  with scope as materialized (
    select distinct c.ruling_number
    from hts_rag.hts_rag_ruling_codes c
    where p_scope_chapters is not null and c.role = 'held' and left(c.code, 2) = any (p_scope_chapters)
  ),
  fts as (
    select r.ruling_number,
           row_number() over (order by ts_rank(r.search_tsv, p_tsquery, 1) desc, r.ruling_date desc nulls last, r.ruling_number)::integer as rnk
    from hts_rag.hts_rag_rulings r
    where p_tsquery is not null
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and r.search_tsv @@ p_tsquery
      and (p_scope_chapters is null or r.ruling_number in (select s.ruling_number from scope s))
    order by rnk
    limit 200
  ),
  -- The trigram candidates are materialized WITHOUT the chapter scope first, so
  -- the planner uses hts_rag_rulings_subject_trgm_active_idx (the standalone
  -- plan) instead of probing the scope list and re-checking the filter per row.
  trgm_candidates as materialized (
    select r.ruling_number, r.subject, r.ruling_date
    from hts_rag.hts_rag_rulings r
    where p_query <> ''
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and lower(p_query) operator(extensions.<%) lower(r.subject)
  ),
  trgm as (
    select c.ruling_number,
           row_number() over (order by extensions.word_similarity(lower(p_query), lower(c.subject)) desc, c.ruling_date desc nulls last, c.ruling_number)::integer as rnk
    from trgm_candidates c
    where (p_scope_chapters is null or c.ruling_number in (select s.ruling_number from scope s))
    order by rnk
    limit 200
  ),
  vec as (
    select n.ruling_number, row_number() over (order by min(n.distance), n.ruling_number)::integer as rnk
    from (
      select rp.ruling_number, rp.phrase_embedding operator(extensions.<=>) p_query_embedding as distance
      from hts_rag.hts_rag_ruling_products rp
      join hts_rag.hts_rag_rulings r on r.ruling_number = rp.ruling_number
      where p_query_embedding is not null
        and rp.phrase_embedding is not null
        and rp.effective_status = 'active' and rp.review_state = 'trusted'
        and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
        and (p_scope_chapters is null or rp.held_chapter = any (p_scope_chapters))
      order by rp.phrase_embedding operator(extensions.<=>) p_query_embedding
      limit 200
    ) n
    group by n.ruling_number
  )
  select coalesce(f.ruling_number, t.ruling_number, v.ruling_number), f.rnk, t.rnk, v.rnk
  from fts f
  full join trgm t on t.ruling_number = f.ruling_number
  full join vec v on v.ruling_number = coalesce(f.ruling_number, t.ruling_number)
$function$;
