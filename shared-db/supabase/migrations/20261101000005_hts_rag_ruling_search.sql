-- Ruling search (designflow-backend#254 step 6, design docs/design_cbp-ruling-database.md §5-§6).
-- derived-from: none
-- Reissue of 20261030190639_hts_rag_ruling_search.sql, which was stranded: its production
-- apply hit the default statement timeout while backfilling search_tsv. Same objects,
-- idempotent, with a longer statement timeout; the stranded preview-only row is registered
-- as an orphan. Declared `none` deliberately: the stranded version is absent from the
-- production ledger and this file re-creates the objects without depending on it, so a
-- named base would make promotion base-absent (ai-review finding 1, issue #5246).
-- Issue popcre/shared-db#5163 (claim #5174, reissued to 20261101000005).
-- Two-pass hybrid search over active CBP rulings, fused by reciprocal rank fusion (k = 60):
--   lists: full-text (weighted subject A + ruling text D), trigram on the subject,
--          and, when the caller passes a query embedding, the nearest trusted product phrases.
--   pass 1: only rulings whose held code is in the caller's candidate chapters.
--   pass 2: all active rulings, run when no chapters are given or pass 1 is weak
--           (fewer than p_min_pass1 hits); in-chapter rulings keep a one-rank boost.
-- Held codes come from hts_rag_ruling_codes (role 'held', any extract_version), so the
-- function works on parse-v1 today and on AI extraction output later without change.

set statement_timeout = '30min';

alter table hts_rag.hts_rag_rulings
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(subject, '')), 'A')
    || setweight(to_tsvector('english'::regconfig, left(full_text, 3000)), 'D')
  ) stored;
comment on column hts_rag.hts_rag_rulings.search_tsv is
  'Weighted full-text vector (subject A, first 3,000 characters (the facts and holding of most rulings; keeps ranking fast) of the ruling D) for hts_rag_search_rulings. designflow-backend#254.';

create index if not exists hts_rag_rulings_search_tsv_active_idx
  on hts_rag.hts_rag_rulings using gin (search_tsv)
  where effective_status = 'active';
create index if not exists hts_rag_rulings_subject_trgm_active_idx
  on hts_rag.hts_rag_rulings using gin (lower(subject) extensions.gin_trgm_ops)
  where effective_status = 'active';
create index if not exists hts_rag_ruling_codes_held_chapter_idx
  on hts_rag.hts_rag_ruling_codes (left(code, 2), ruling_number)
  where role = 'held';

-- One pass of the search: three ranked lists of at most 200 rulings each. p_scope_chapters
-- null means all active rulings; otherwise only rulings whose held code is in those chapters.
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

comment on function hts_rag.hts_rag_search_rulings_pass(text, tsquery, extensions.halfvec, text[]) is
  'Internal: one pass of hts_rag_search_rulings (three ranked lists, at most 200 rulings each). designflow-backend#254.';

-- The search interface (signature is the contract the classifier builds against).
create or replace function hts_rag.hts_rag_search_rulings(
  p_query text,
  p_chapters text[] default null,
  p_limit integer default 20,
  p_query_embedding extensions.halfvec(768) default null,
  p_min_pass1 integer default 5
)
returns table (
  ruling_number text,
  subject text,
  ruling_date date,
  held_codes text[],
  score double precision,
  fts_rank integer,
  trgm_rank integer,
  vector_rank integer,
  in_candidate_chapters boolean,
  pass smallint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with params as materialized (
    select btrim(coalesce(p_query, '')) as q,
           -- OR of the query's words: a product phrase rarely matches with AND; cover-density
           -- ranking still puts rulings that contain more of the words, and in the subject, first.
           nullif(replace(plainto_tsquery('english'::regconfig, btrim(coalesce(p_query, '')))::text, ' & ', ' | '), '')::tsquery as tsq,
           (select array_agg(distinct c) from unnest(p_chapters) c where c ~ '^[0-9]{2}$') as chapters,
           least(greatest(coalesce(p_limit, 20), 1), 100) as lim
  ),
  pass1_params as materialized (
    select * from params p
    where p.chapters is not null and (p.q <> '' or p_query_embedding is not null)
  ),
  pass1 as materialized (
    select h.*, 1::smallint as pass
    from pass1_params p
    cross join lateral hts_rag.hts_rag_search_rulings_pass(p.q, p.tsq, p_query_embedding, p.chapters) h
  ),
  pass2_params as materialized (
    select * from params p
    where (p.q <> '' or p_query_embedding is not null)
      and (p.chapters is null or (select count(*) from pass1) < least(coalesce(p_min_pass1, 5), p.lim))
  ),
  pass2 as materialized (
    select h.*, 2::smallint as pass
    from pass2_params p
    cross join lateral hts_rag.hts_rag_search_rulings_pass(p.q, p.tsq, p_query_embedding, null) h
  ),
  hits as (
    select * from pass1
    union all
    select * from pass2 where pass2.ruling_number not in (select pass1.ruling_number from pass1)
  ),
  scored as (
    select h.*,
           h.pass = 1 or exists (
             select 1 from params p, hts_rag.hts_rag_ruling_codes c
             where p.chapters is not null and c.ruling_number = h.ruling_number
               and c.role = 'held' and left(c.code, 2) = any (p.chapters)) as in_chapter
    from hits h
  )
  select r.ruling_number, r.subject, r.ruling_date,
         coalesce((select array_agg(distinct c.code order by c.code)
                   from hts_rag.hts_rag_ruling_codes c
                   where c.ruling_number = r.ruling_number and c.role = 'held'), '{}'::text[]),
         coalesce(1.0 / (60 + s.fts_rank), 0) + coalesce(1.0 / (60 + s.trgm_rank), 0)
           + coalesce(1.0 / (60 + s.vector_rank), 0)
           + case when s.in_chapter and s.pass = 2 then 1.0 / (60 + 1) else 0 end,
         s.fts_rank, s.trgm_rank, s.vector_rank, s.in_chapter, s.pass
  from scored s
  join hts_rag.hts_rag_rulings r on r.ruling_number = s.ruling_number
  order by 5 desc, r.ruling_date desc nulls last, r.ruling_number
  limit (select lim from params)
$function$;

comment on function hts_rag.hts_rag_search_rulings(text, text[], integer, extensions.halfvec, integer) is
  'Two-pass RRF (k=60) ruling search over active rulings: full-text, subject trigram, optional product-phrase vector. Pass 1 = candidate chapters; pass 2 = all active law when pass 1 is weak. designflow-backend#254.';

-- Read-only SECURITY DEFINER: the runtime roles may read search results without table
-- access to ruling codes or products. The pass helper is internal and granted to nobody.
revoke all on function hts_rag.hts_rag_search_rulings(text, text[], integer, extensions.halfvec, integer),
  hts_rag.hts_rag_search_rulings_pass(text, tsquery, extensions.halfvec, text[])
  from public, anon, authenticated, service_role;
grant execute on function hts_rag.hts_rag_search_rulings(text, text[], integer, extensions.halfvec, integer)
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
     designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Runtime access for the classifier (designflow-backend#254 comment 6531208064). The
-- ruling library is the classifier's evidence (design §5), so both runtime roles read
-- every ruling, not only those behind an accepted precedent. Rulings are public CBP
-- documents. Policies are permissive and OR with the existing precedent-only ones.
-- Product rows stay worker-only: hts_rag_search_rulings (SECURITY DEFINER) returns them.
drop policy if exists hts_rag_prod_runtime_library_read on hts_rag.hts_rag_rulings;
create policy hts_rag_prod_runtime_library_read on hts_rag.hts_rag_rulings
  for select to designflow_hts_prod_runtime using (true);
drop policy if exists hts_rag_alsand_runtime_library_read on hts_rag.hts_rag_rulings;
create policy hts_rag_alsand_runtime_library_read on hts_rag.hts_rag_rulings
  for select to designflow_hts_alsand_runtime using (true);
grant usage on schema extensions to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
