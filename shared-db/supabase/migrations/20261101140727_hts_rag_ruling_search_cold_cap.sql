-- derived-from: 20261101115125
-- designflow-backend#254 / shared-db#5305: cap the ruling search full-text pass at
-- 300 heap reads. With up to 2000 candidates a first-time query still took 3-7 s
-- (18 s seen by the sandbox runtime) on a cold cache. All-stem rulings come first;
-- half-stem rulings only fill the rest. Signature, grants, outer function unchanged.

-- Load pg_trgm before the function pins its parameter (see 20261101000005).
select extensions.show_limit();

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
  with recursive scope as materialized (
    select distinct c.ruling_number
    from hts_rag.hts_rag_ruling_codes c
    where p_scope_chapters is not null and c.role = 'held' and left(c.code, 2) = any (p_scope_chapters)
  ),
  -- The query's distinct stems (at most 8). The full-text pass matches rulings that
  -- contain all of them, or at least half of them, instead of any one of them: an OR of
  -- every word matched ~16k rulings for a 4-word query, and ranking that many read
  -- thousands of pages from disk once the cache was cold (98-120 s per call, #5305).
  lex as materialized (
    select w, row_number() over (order by w) as i
    from (select w from unnest(tsvector_to_array(to_tsvector('english'::regconfig, coalesce(p_query, '')))) w
          where p_tsquery is not null order by w limit 8) x
  ),
  need as materialized (
    select greatest(1, ceil(count(*) / 2.0))::integer as k, count(*)::integer as n from lex
  ),
  combo (last_i, n, expr) as (
    select l.i, 1, quote_literal(l.w) from lex l
    union all
    select l.i, c.n + 1, c.expr || ' & ' || quote_literal(l.w)
    from combo c join lex l on l.i > c.last_i
    where c.n < (select k from need)
  ),
  ftsq as materialized (
    select (select string_agg(quote_literal(l.w), ' & ')::tsquery from lex l) as all_q,
           (select string_agg('(' || c.expr || ')', ' | ')::tsquery from combo c where c.n = (select k from need)) as most_q
  ),
  -- Every candidate costs one heap page, and on a cold cache each page is a disk
  -- read, so the pass reads at most 300 rulings: those holding every stem first,
  -- then rulings holding half the stems only to fill the remainder (#5305).
  all_hits as materialized (
    select r.ruling_number, r.subject, r.ruling_date, true as all_words
    from hts_rag.hts_rag_rulings r
    where r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and r.search_tsv @@ (select all_q from ftsq)
      and (p_scope_chapters is null or r.ruling_number in (select s.ruling_number from scope s))
    limit 300
  ),
  most_hits as (
    select r.ruling_number, r.subject, r.ruling_date, false as all_words
    from hts_rag.hts_rag_rulings r
    where (select count(*) from all_hits) < 300
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and r.search_tsv @@ (select most_q from ftsq)
      and not (r.search_tsv @@ (select all_q from ftsq))
      and (p_scope_chapters is null or r.ruling_number in (select s.ruling_number from scope s))
    limit (select 300 - count(*) from all_hits)
  ),
  fts_hits as (
    select * from all_hits
    union all
    select * from most_hits
  ),
  -- Rank by the subject line, not the TOASTed full-text vector: rulings holding every
  -- word first, then subject relevance, then the newest.
  fts as (
    select f.ruling_number,
           row_number() over (order by f.all_words desc,
                                       ts_rank(to_tsvector('english'::regconfig, coalesce(f.subject, '')), p_tsquery) desc,
                                       f.ruling_date desc nulls last, f.ruling_number)::integer as rnk
    from fts_hits f
    order by rnk
    limit 200
  ),
  trgm as (
    select r.ruling_number,
           row_number() over (order by extensions.word_similarity(lower(p_query), lower(r.subject)) desc, r.ruling_date desc nulls last, r.ruling_number)::integer as rnk
    from hts_rag.hts_rag_rulings r
    where p_query <> ''
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and lower(p_query) operator(extensions.<%) lower(r.subject)
      and (p_scope_chapters is null or r.ruling_number in (select s.ruling_number from scope s))
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
