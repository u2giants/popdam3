-- popcre/designflow-backend#278 (plan_hts-ruling-intelligence-and-memory.md step 1.3a), claim popcre/shared-db#7177:
-- the two live HTS retrieval RPCs stop returning rulings labelled out of scope
-- (marking, carriers, entry, valuation, ...) in hts_rag.hts_rag_ruling_scope_labels.
--
-- Filter is fail-open: a ruling with no 'scope-labels-v1' row stays searchable; only an
-- explicit in_scope = false row removes it. It is a NOT EXISTS anti-join, never a join:
-- the label key is (ruling_number, label_version, source_environment), so a join would
-- duplicate a ruling labelled in more than one environment.
--
-- Both bodies are the live production definitions (pg_get_functiondef, 2026-11-26) with
-- only the filter added: nearest_products and the fts (all_hits, most_hits), trgm and vec
-- CTEs of search_rulings_pass. CREATE OR REPLACE keeps signatures, owner, grants,
-- comments, SECURITY and SET options unchanged.
-- derived-from: 20261102181554

-- Load the vector library in this session so the hnsw.* SET options below are known
-- parameters (otherwise a non-superuser gets "permission denied to set parameter").
-- pg_trgm (pg_trgm.word_similarity_threshold) is loaded the same way.
select extensions.vector_dims('[1]'::extensions.vector);
select extensions.similarity('a', 'a');

create or replace function hts_rag.hts_rag_nearest_products(p_embedding text, p_embed_version text, p_limit integer DEFAULT 200, p_scope_chapters text[] DEFAULT NULL::text[])
 RETURNS TABLE(product_id uuid, ruling_number text, distance real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
 SET "hnsw.ef_search" TO '400'
 SET "hnsw.iterative_scan" TO 'relaxed_order'
AS $function$
  select n.product_id, n.ruling_number, n.distance
  from (
    select e.product_id, e.ruling_number,
           (e.embedding operator(extensions.<=>) cast(p_embedding as extensions.halfvec(768)))::real as distance
    from hts_rag.hts_rag_product_embeddings e
    join hts_rag.hts_rag_ruling_products rp on rp.id = e.product_id
    join hts_rag.hts_rag_rulings r on r.ruling_number = e.ruling_number
    where e.embed_version = p_embed_version
      and rp.effective_status = 'active' and rp.review_state = 'trusted'
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and not exists (
        select 1 from hts_rag.hts_rag_ruling_scope_labels l
        where l.ruling_number = r.ruling_number and l.label_version = 'scope-labels-v1'
          and l.in_scope = false
      )
      and (p_scope_chapters is null or rp.held_chapter = any (p_scope_chapters))
    order by e.embedding operator(extensions.<=>) cast(p_embedding as extensions.halfvec(768))
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ) n
  order by n.distance, n.product_id
$function$;

create or replace function hts_rag.hts_rag_search_rulings_pass(p_query text, p_tsquery tsquery, p_query_embedding extensions.halfvec, p_scope_chapters text[])
 RETURNS TABLE(ruling_number text, fts_rank integer, trgm_rank integer, vector_rank integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET "pg_trgm.word_similarity_threshold" TO '0.4'
AS $function$
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
      and not exists (
        select 1 from hts_rag.hts_rag_ruling_scope_labels l
        where l.ruling_number = r.ruling_number and l.label_version = 'scope-labels-v1'
          and l.in_scope = false
      )
      and (p_scope_chapters is null or r.ruling_number in (select s.ruling_number from scope s))
    limit 300
  ),
  most_hits as (
    select r.ruling_number, r.subject, r.ruling_date, false as all_words
    from hts_rag.hts_rag_rulings r
    where (select count(*) from all_hits) < 300
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and r.search_tsv @@ (select most_q from ftsq)
      and not exists (
        select 1 from hts_rag.hts_rag_ruling_scope_labels l
        where l.ruling_number = r.ruling_number and l.label_version = 'scope-labels-v1'
          and l.in_scope = false
      )
      and r.ruling_number not in (select a.ruling_number from all_hits a)
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
  -- The trigram candidates are materialized WITHOUT the chapter scope first, so
  -- the planner uses hts_rag_rulings_subject_trgm_active_idx instead of probing
  -- the scope list and re-checking the similarity filter per row (the measured
  -- 5.6s/3.8s scope-driven shape, #5283).
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
      and not exists (
        select 1 from hts_rag.hts_rag_ruling_scope_labels l
        where l.ruling_number = c.ruling_number and l.label_version = 'scope-labels-v1'
          and l.in_scope = false
      )
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
        and not exists (
          select 1 from hts_rag.hts_rag_ruling_scope_labels l
          where l.ruling_number = r.ruling_number and l.label_version = 'scope-labels-v1'
            and l.in_scope = false
        )
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
