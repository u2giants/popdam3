-- derived-from: 20261225130603
-- Issue #7095: DesignFlow assembled item descriptions — product_type_search
-- revision, PRODUCTION HALF (schema dflow_prod; paired sandbox half 20261225130703). Replaces only dflow_prod.product_type_search (same signature);
-- resolve_mg_path and embellishment_phrase_search are unchanged.
-- Why (measured on the sandbox Cloud Run item service 2026-11-25,
-- designflow-item-master docs/verification/assembled-item-description/
-- search-eval-2026-11-25.md): the first version called the plpgsql
-- resolve_mg_path once per catalog row (database p95 808 ms) and its equal
-- RRF weights let weak trigram matches bury the meaning rank (paraphrase
-- top-5 40%). This version resolves the whole catalog set-based in one pass
-- and weights words 0.5 / trigram (> 0.7) 1 / meaning 2 with k = 10.
-- No tables, no data written. Idempotent (OR REPLACE). Rollback: re-apply
-- the 20261225130603 body of dflow_prod.product_type_search.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regprocedure('dflow_prod.product_type_search(text,text,text,text[],integer)') is null then
    raise exception '#7095/20261225130704 self-check: dflow_prod.product_type_search is missing — 20261225130603 has not been applied here'
      using errcode = 'feature_not_supported';
  end if;
end $$;

-- Step 3.1 product-type search (revision of 20261225130602/130603, tuned and
-- measured on Cloud Run 2026-11-25, designflow-item-master#194
-- search-eval-2026-11-25). Fuses full-text (any stem of the query, weight
-- 0.5), trigram word similarity of the name or search_terms inside the query
-- (only above 0.7, weight 1) and, when an embedding is passed as a vector
-- literal, cosine distance (weight 2), by weighted reciprocal rank (k = 10).
-- Only rows whose status is in p_statuses (the item service passes
-- {approved} for designers; approvers may evaluate drafts) and whose division
-- mapping (override, else default) resolves in p_division with an active MG03
-- child — and, for pick mode, at least one allowed MG03 present — are
-- returned (D3, D2). Resolution is set-based here (same rule as
-- resolve_mg_path) so the whole catalog is checked in one pass. Rows with no
-- vector still rank by words; a vector of another size is ignored (D5, no
-- vector index). An empty query returns the division's most-chosen types.
-- Writes nothing (the caller logs the search).
create or replace function dflow_prod.product_type_search(
  p_query text, p_embedding text, p_division text,
  p_statuses text[] default array['approved'], p_limit integer default 8
)
returns table (product_type_id bigint, name text, short_name text, status text, score double precision,
               fts_rank integer, trgm_rank integer, vector_rank integer, product_type_mg_id bigint,
               mg03_mode text, mg01_id integer, mg02_id integer, mg03_id integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_q text := lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  v_vec extensions.vector;
  v_ts tsquery;
  v_lim integer := least(greatest(coalesce(p_limit, 8), 1), 50);
begin
  if p_embedding is not null and btrim(p_embedding) <> '' then
    v_vec := p_embedding::extensions.vector;
  end if;
  if v_q <> '' then
    select string_agg(quote_literal(l), ' | ')::tsquery into v_ts
      from unnest(tsvector_to_array(to_tsvector('pg_catalog.english'::regconfig, v_q))) l;
  end if;
  return query
  with mg as materialized (
    select g.mg_id, g.parent_id, g."mgTypeCode" typ, btrim(g.mg_code) code,
           nullif(btrim(coalesce(g."mgCategory", '')), '') cat, lower(btrim(g.mg_desc)) nm
      from dflow_prod."merchGroup" g
     where g."divisionCode_fk" = p_division and coalesce(g.is_active, false)
  ),
  pm as materialized (
    select distinct on (t.id) t.id, t.name, t.short_name, t.status, t.search_terms, t.embedding, t.embedding_dim,
           x.id ptm_id, x.mg03_mode,
           btrim(x.mg01_code) c1, nullif(btrim(coalesce(x.mg01_category, '')), '') k1, lower(btrim(x.mg01_name)) n1,
           btrim(x.mg02_code) c2, nullif(btrim(coalesce(x.mg02_category, '')), '') k2, lower(btrim(x.mg02_name)) n2,
           btrim(x.mg03_code) c3, nullif(btrim(coalesce(x.mg03_category, '')), '') k3, lower(btrim(x.mg03_name)) n3
      from dflow_prod.product_type t
      join dflow_prod.product_type_mg x on x.product_type_id = t.id and (x.division_code = p_division or x.division_code is null)
     where t.status = any (p_statuses)
     order by t.id, x.division_code nulls last
  ),
  l1 as (
    select p.id, min(g.mg_id) mg01, count(*) n from pm p
      join mg g on g.typ = '01' and g.parent_id is null and g.code = p.c1 and g.cat is not distinct from p.k1 and g.nm = p.n1
     group by p.id
  ),
  l2 as (
    select p.id, min(g.mg_id) mg02, count(*) n from pm p join l1 on l1.id = p.id and l1.n = 1
      join mg g on g.parent_id = l1.mg01 and g.code = p.c2 and g.cat is not distinct from p.k2 and g.nm = p.n2
     group by p.id
  ),
  ok as materialized (
    select p.*, l1.mg01, l2.mg02, f3.mg03
      from pm p
      join l1 on l1.id = p.id and l1.n = 1
      join l2 on l2.id = p.id and l2.n = 1
      left join lateral (
        select min(g.mg_id) mg03, count(*) n from mg g
         where p.mg03_mode = 'fixed' and g.parent_id = l2.mg02 and g.code = p.c3 and g.cat is not distinct from p.k3 and g.nm = p.n3) f3 on true
     where exists (select 1 from mg k where k.parent_id = l2.mg02)
       and (p.mg03_mode <> 'fixed' or f3.n = 1)
       and (p.mg03_mode <> 'pick' or exists (
         select 1 from dflow_prod.product_type_mg03_allowed a
           join mg k on k.parent_id = l2.mg02 and k.code = btrim(a.mg03_code)
            and k.cat is not distinct from nullif(btrim(coalesce(a.mg03_category, '')), '') and k.nm = lower(btrim(a.mg03_name))
          where a.product_type_mg_id = p.ptm_id))
  ),
  fts as (
    select o.id, row_number() over (order by ts_rank(to_tsvector('pg_catalog.english'::regconfig, o.name || ' ' || o.search_terms), v_ts) desc, o.id)::integer rnk
      from ok o
     where v_ts is not null and to_tsvector('pg_catalog.english'::regconfig, o.name || ' ' || o.search_terms) @@ v_ts
  ),
  trg as (
    select s.id, row_number() over (order by s.sim desc, s.id)::integer rnk
      from (select o.id, greatest(extensions.word_similarity(lower(o.name), v_q),
                    case when o.search_terms <> '' then extensions.word_similarity(lower(o.search_terms), v_q) else 0 end) sim
              from ok o where v_q <> '') s
     where s.sim > 0.7
  ),
  vec as (
    select o.id, row_number() over (order by o.embedding operator(extensions.<=>) v_vec, o.id)::integer rnk
      from ok o
     where v_vec is not null and o.embedding is not null and o.embedding_dim = extensions.vector_dims(v_vec)
  ),
  used as (
    select l.chosen_product_type_id id, count(*) n from dflow_prod.product_type_search_log l
     where v_q = '' and l.division_code = p_division and l.chosen_product_type_id is not null group by 1
  ),
  fused as (
    select o.id,
           case when v_q = '' then 0::double precision else
             coalesce(0.5 / (10 + f.rnk), 0) + coalesce(1.0 / (10 + g.rnk), 0) + coalesce(2.0 / (10 + v.rnk), 0) end sc,
           f.rnk fr, g.rnk gr, v.rnk vr, coalesce(u.n, 0) un
      from ok o
      left join fts f on f.id = o.id
      left join trg g on g.id = o.id
      left join vec v on v.id = o.id
      left join used u on u.id = o.id
     where v_q = '' or f.id is not null or g.id is not null or v.id is not null
  )
  select o.id, o.name, o.short_name, o.status, fu.sc, fu.fr, fu.gr, fu.vr, o.ptm_id, o.mg03_mode,
         o.mg01, o.mg02, o.mg03
    from fused fu join ok o on o.id = fu.id
   order by fu.sc desc, fu.un desc, o.name
   limit v_lim;
end
$fn$;

revoke all on function dflow_prod.product_type_search(text, text, text, text[], integer) from public;
revoke all on function dflow_prod.product_type_search(text, text, text, text[], integer) from anon, authenticated;
grant execute on function dflow_prod.product_type_search(text, text, text, text[], integer) to designflow_prod_item_master_grants;
