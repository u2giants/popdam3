-- derived-from: none
-- Issue #7041 (claim on #7041 for step 3.1): DesignFlow assembled item
-- descriptions — search functions, PRODUCTION HALF (schema `dflow_prod`).
-- Paired with the sandbox half 20261225130602 (schema `dflow`). Work issue
-- popcre/designflow-item-master#194, plan steps 3.1/3.2.
--
-- Objects (this file): functions dflow_prod.resolve_mg_path(text, text[],
-- text[], text[]), dflow_prod.product_type_search(text, text, text, text[],
-- integer), dflow_prod.embellishment_phrase_search(text, text, integer).
-- SECURITY DEFINER with search_path '' because the runtime login has no USAGE
-- on schema extensions (read live 2026-11-25); EXECUTE revoked from
-- public/anon/authenticated and granted to designflow_prod_item_master_grants
-- only. No tables, no data written.
--
-- Idempotent (OR REPLACE). Rollback: drop the three functions.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regclass('dflow_prod.product_type') is null or to_regclass('dflow_prod."merchGroup"') is null then
    raise exception '#7041/20261225130603 self-check: dflow_prod.product_type or dflow_prod."merchGroup" is missing — 20261225091507 has not been applied here'
      using errcode = 'feature_not_supported';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_item_master_grants') then
    raise exception '#7041/20261225130603 self-check: role designflow_prod_item_master_grants does not exist'
      using errcode = 'feature_not_supported';
  end if;
end $$;

-- D3 resolution of one MG path in one division. Each level is a text[3]
-- {code, category, name}; matching is trimmed code, null-safe trimmed
-- category, case-insensitive trimmed name, active rows only (the same rule as
-- the item service's seed-lib resolvePath). MG01 is a root (parent_id null)
-- of the division; MG02/MG03 are active children. state: resolved | missing |
-- ambiguous; level names where it failed; match_ids lists the rows when not
-- exactly one. active_mg03 counts the MG02's active children (D2). Callers
-- require state = 'resolved'. Reads only "merchGroup"; writes nothing.
create or replace function dflow_prod.resolve_mg_path(
  p_division text, p_mg01 text[], p_mg02 text[], p_mg03 text[] default null
)
returns table (state text, level text, mg01_id integer, mg02_id integer, mg03_id integer,
               active_mg03 integer, match_ids integer[])
language plpgsql
stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  r1 integer[]; r2 integer[]; r3 integer[]; k integer;
begin
  select coalesce(array_agg(m.mg_id order by m.mg_id), '{}') into r1
    from dflow_prod."merchGroup" m
   where m."mgTypeCode" = '01' and m.parent_id is null and m."divisionCode_fk" = p_division
     and coalesce(m.is_active, false)
     and btrim(m.mg_code) = btrim(p_mg01[1])
     and nullif(btrim(coalesce(m."mgCategory", '')), '') is not distinct from nullif(btrim(coalesce(p_mg01[2], '')), '')
     and lower(btrim(m.mg_desc)) = lower(btrim(p_mg01[3]));
  if cardinality(r1) <> 1 then
    return query select case when cardinality(r1) = 0 then 'missing' else 'ambiguous' end, 'MG01',
      null::integer, null::integer, null::integer, null::integer, r1;
    return;
  end if;
  select coalesce(array_agg(m.mg_id order by m.mg_id), '{}') into r2
    from dflow_prod."merchGroup" m
   where m.parent_id = r1[1] and coalesce(m.is_active, false)
     and btrim(m.mg_code) = btrim(p_mg02[1])
     and nullif(btrim(coalesce(m."mgCategory", '')), '') is not distinct from nullif(btrim(coalesce(p_mg02[2], '')), '')
     and lower(btrim(m.mg_desc)) = lower(btrim(p_mg02[3]));
  if cardinality(r2) <> 1 then
    return query select case when cardinality(r2) = 0 then 'missing' else 'ambiguous' end, 'MG02',
      r1[1], null::integer, null::integer, null::integer, r2;
    return;
  end if;
  select count(*)::integer into k from dflow_prod."merchGroup" m where m.parent_id = r2[1] and coalesce(m.is_active, false);
  if p_mg03 is null then
    return query select 'resolved', null::text, r1[1], r2[1], null::integer, k, null::integer[];
    return;
  end if;
  select coalesce(array_agg(m.mg_id order by m.mg_id), '{}') into r3
    from dflow_prod."merchGroup" m
   where m.parent_id = r2[1] and coalesce(m.is_active, false)
     and btrim(m.mg_code) = btrim(p_mg03[1])
     and nullif(btrim(coalesce(m."mgCategory", '')), '') is not distinct from nullif(btrim(coalesce(p_mg03[2], '')), '')
     and lower(btrim(m.mg_desc)) = lower(btrim(p_mg03[3]));
  if cardinality(r3) <> 1 then
    return query select case when cardinality(r3) = 0 then 'missing' else 'ambiguous' end, 'MG03',
      r1[1], r2[1], null::integer, k, r3;
    return;
  end if;
  return query select 'resolved', null::text, r1[1], r2[1], r3[1], k, null::integer[];
end
$fn$;

-- Step 3.1 product-type search. Fuses full-text (any stem of the query),
-- trigram word similarity over name and search_terms, and, when an embedding
-- is passed as a vector literal, cosine distance, by reciprocal rank (k = 60),
-- modelled on hts_rag.hts_rag_search_rulings. Only rows whose status is in
-- p_statuses (the item service passes {approved} for designers; approvers may
-- evaluate drafts) and whose division mapping (override, else default)
-- resolves in p_division with an active MG03 child — and, for pick mode, at
-- least one allowed MG03 present — are returned (D3, D2). Rows with no vector
-- still rank by words; a vector of another size is ignored (D5, no vector
-- index). An empty query returns the division's most-chosen types. Writes
-- nothing (the caller logs the search).
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
  with cand as (
    select t.id, t.name, t.short_name, t.status, t.search_terms, t.embedding, t.embedding_dim,
           m.id as ptm_id, m.mg03_mode, r.state, r.mg01_id, r.mg02_id, r.mg03_id, r.active_mg03
      from dflow_prod.product_type t
      cross join lateral (
        select x.* from dflow_prod.product_type_mg x
         where x.product_type_id = t.id and (x.division_code = p_division or x.division_code is null)
         order by x.division_code nulls last limit 1) m
      cross join lateral dflow_prod.resolve_mg_path(p_division,
        array[m.mg01_code, m.mg01_category, m.mg01_name],
        array[m.mg02_code, m.mg02_category, m.mg02_name],
        case when m.mg03_mode = 'fixed' then array[m.mg03_code, m.mg03_category, m.mg03_name] end) r
     where t.status = any (p_statuses)
  ),
  ok as materialized (
    select c.* from cand c
     where c.state = 'resolved' and c.active_mg03 > 0
       and (c.mg03_mode <> 'pick' or exists (
         select 1 from dflow_prod.product_type_mg03_allowed a
           join dflow_prod."merchGroup" k on k.parent_id = c.mg02_id and coalesce(k.is_active, false)
            and btrim(k.mg_code) = btrim(a.mg03_code)
            and nullif(btrim(coalesce(k."mgCategory", '')), '') is not distinct from nullif(btrim(coalesce(a.mg03_category, '')), '')
            and lower(btrim(k.mg_desc)) = lower(btrim(a.mg03_name))
          where a.product_type_mg_id = c.ptm_id))
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
     where s.sim > 0.2
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
             coalesce(1.0 / (60 + f.rnk), 0) + coalesce(1.0 / (60 + g.rnk), 0) + coalesce(1.0 / (60 + v.rnk), 0) end sc,
           f.rnk fr, g.rnk gr, v.rnk vr, coalesce(u.n, 0) un
      from ok o
      left join fts f on f.id = o.id
      left join trg g on g.id = o.id
      left join vec v on v.id = o.id
      left join used u on u.id = o.id
     where v_q = '' or f.id is not null or g.id is not null or v.id is not null
  )
  select o.id, o.name, o.short_name, o.status, fu.sc, fu.fr, fu.gr, fu.vr, o.ptm_id, o.mg03_mode,
         o.mg01_id, o.mg02_id, o.mg03_id
    from fused fu join ok o on o.id = fu.id
   order by fu.sc desc, fu.un desc, o.name
   limit v_lim;
end
$fn$;

-- Step 3.2 extra-embellishment suggestions: the same fusion over
-- embellishment_phrase, ordered by fused rank then use_count. An empty query
-- returns the most-used phrases. Writes nothing.
create or replace function dflow_prod.embellishment_phrase_search(
  p_query text, p_embedding text, p_limit integer default 5
)
returns table (embellishment_phrase_id bigint, phrase text, use_count integer, score double precision,
               fts_rank integer, trgm_rank integer, vector_rank integer)
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
  v_lim integer := least(greatest(coalesce(p_limit, 5), 1), 50);
begin
  if p_embedding is not null and btrim(p_embedding) <> '' then
    v_vec := p_embedding::extensions.vector;
  end if;
  if v_q <> '' then
    select string_agg(quote_literal(l), ' | ')::tsquery into v_ts
      from unnest(tsvector_to_array(to_tsvector('pg_catalog.english'::regconfig, v_q))) l;
  end if;
  return query
  with fts as (
    select p.id, row_number() over (order by ts_rank(to_tsvector('pg_catalog.english'::regconfig, p.phrase), v_ts) desc, p.id)::integer rnk
      from dflow_prod.embellishment_phrase p
     where v_ts is not null and to_tsvector('pg_catalog.english'::regconfig, p.phrase) @@ v_ts
     limit 200
  ),
  trg as (
    select s.id, row_number() over (order by s.sim desc, s.id)::integer rnk
      from (select p.id, greatest(extensions.word_similarity(v_q, lower(p.phrase)),
                                  extensions.word_similarity(lower(p.phrase), v_q)) sim
              from dflow_prod.embellishment_phrase p where v_q <> '') s
     where s.sim > 0.2
     limit 200
  ),
  vec as (
    select p.id, row_number() over (order by p.embedding operator(extensions.<=>) v_vec, p.id)::integer rnk
      from dflow_prod.embellishment_phrase p
     where v_vec is not null and p.embedding is not null and p.embedding_dim = extensions.vector_dims(v_vec)
     order by p.embedding operator(extensions.<=>) v_vec
     limit 200
  ),
  fused as (
    select p.id,
           case when v_q = '' then 0::double precision else
             coalesce(1.0 / (60 + f.rnk), 0) + coalesce(1.0 / (60 + g.rnk), 0) + coalesce(1.0 / (60 + v.rnk), 0) end sc,
           f.rnk fr, g.rnk gr, v.rnk vr
      from dflow_prod.embellishment_phrase p
      left join fts f on f.id = p.id
      left join trg g on g.id = p.id
      left join vec v on v.id = p.id
     where v_q = '' or f.id is not null or g.id is not null or v.id is not null
  )
  select p.id, p.phrase, p.use_count, fu.sc, fu.fr, fu.gr, fu.vr
    from fused fu join dflow_prod.embellishment_phrase p on p.id = fu.id
   order by fu.sc desc, p.use_count desc, p.phrase
   limit v_lim;
end
$fn$;

-- SECURITY DEFINER (the runtime login has no USAGE on schema extensions, so
-- the vector and trigram calls run as the owner): nobody but the item service
-- may execute them.
revoke all on function dflow_prod.resolve_mg_path(text, text[], text[], text[]) from public;
revoke all on function dflow_prod.product_type_search(text, text, text, text[], integer) from public;
revoke all on function dflow_prod.embellishment_phrase_search(text, text, integer) from public;
revoke all on function dflow_prod.resolve_mg_path(text, text[], text[], text[]) from anon, authenticated;
revoke all on function dflow_prod.product_type_search(text, text, text, text[], integer) from anon, authenticated;
revoke all on function dflow_prod.embellishment_phrase_search(text, text, integer) from anon, authenticated;

grant execute on function dflow_prod.resolve_mg_path(text, text[], text[], text[]) to designflow_prod_item_master_grants;
grant execute on function dflow_prod.product_type_search(text, text, text, text[], integer) to designflow_prod_item_master_grants;
grant execute on function dflow_prod.embellishment_phrase_search(text, text, integer) to designflow_prod_item_master_grants;
