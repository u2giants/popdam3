-- Contract for issue #5163 (designflow-backend#254 step 6): ruling search (behavioural).
do $ruling_search_privileges$
declare
  v_role text;
begin
  foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime',
                                'designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if not has_function_privilege(v_role,
         'hts_rag.hts_rag_search_rulings(text, text[], integer, extensions.halfvec, integer)', 'EXECUTE') then
      raise exception '% cannot run the ruling search', v_role;
    end if;
  end loop;
  foreach v_role in array array['anon','authenticated','service_role','designflow_hts_prod_runtime'] loop
    if has_function_privilege(v_role,
         'hts_rag.hts_rag_search_rulings_pass(text, tsquery, extensions.halfvec, text[])', 'EXECUTE') then
      raise exception '% can run the internal search pass', v_role;
    end if;
  end loop;
  foreach v_role in array array['anon','authenticated'] loop
    if has_function_privilege(v_role,
         'hts_rag.hts_rag_search_rulings(text, text[], integer, extensions.halfvec, integer)', 'EXECUTE') then
      raise exception '% can run the ruling search', v_role;
    end if;
  end loop;
  if (select provolatile from pg_proc where oid = 'hts_rag.hts_rag_search_rulings(text, text[], integer, extensions.halfvec, integer)'::regprocedure) <> 's' then
    raise exception 'ruling search must be STABLE (read-only)';
  end if;
  foreach v_role in array array['hts_rag_rulings_search_tsv_active_idx','hts_rag_rulings_subject_trgm_active_idx'] loop
    if not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = v_role
                    and indexdef like '%WHERE (effective_status = ''active''::text)%') then
      raise exception 'partial active-only index % missing', v_role;
    end if;
  end loop;
end
$ruling_search_privileges$;

-- Behaviour: chapter pass, fallback pass, active-only, RRF ordering, held codes.
begin;
insert into hts_rag.hts_rag_rulings (ruling_number, subject, full_text, full_text_hash, ruling_date, source_environment, effective_status)
values
  ('ZT0001', 'The tariff classification of a plush stuffed toy bear from China',
   'The merchandise is a plush stuffed toy bear made of polyester. The applicable subheading is 9503.00.0073.', 'h1', '2020-01-01', 'alsand', 'active'),
  ('ZT0002', 'The tariff classification of a stuffed pillow in the form of a bear',
   'The article is a stuffed bear shaped pillow cushion. The applicable subheading is 9404.90.2000.', 'h2', '2019-01-01', 'alsand', 'active'),
  ('ZT0003', 'The tariff classification of a plush stuffed toy bear',
   'Revoked ruling for a plush stuffed toy bear. The applicable subheading was 9503.00.0073.', 'h3', '2010-01-01', 'alsand', 'revoked'),
  ('ZT0004', 'The tariff classification of a ceramic mug',
   'The merchandise is a ceramic mug. The applicable subheading is 6912.00.4400.', 'h4', '2021-01-01', 'alsand', 'active');
insert into hts_rag.hts_rag_ruling_codes (ruling_number, code, role, extract_version, source_environment)
values ('ZT0001', '9503.00.0073', 'held', 'parse-v1', 'alsand'),
       ('ZT0002', '9404.90.2000', 'held', 'parse-v1', 'alsand'),
       ('ZT0002', '9503.00.0073', 'rejected', 'parse-v1', 'alsand'),
       ('ZT0003', '9503.00.0073', 'held', 'parse-v1', 'alsand'),
       ('ZT0004', '6912.00.4400', 'held', 'parse-v1', 'alsand');

-- Vector-only evidence: the closer out-of-chapter ruling must lose to the
-- in-chapter fallback boost. Product chapters deliberately differ from held codes
-- for ZT0001, exercising a pass-2 in-chapter hit that was absent from pass 1.
insert into hts_rag.hts_rag_ruling_products
  (ruling_number, item_label, plain_phrase, held_chapter, phrase_embedding,
   effective_status, review_state, extract_version, source_environment)
select ruling_number, 'search fixture', 'search fixture', '94', embedding,
       status, review, 'parse-v1', 'alsand'
from (values
  ('ZT0001', (array[1::real] || array_fill(0::real, array[767]))::extensions.halfvec, 'active', 'trusted'),
  ('ZT0002', array_fill(1::real, array[768])::extensions.halfvec, 'active', 'trusted'),
  ('ZT0003', array_fill(1::real, array[768])::extensions.halfvec, 'active', 'trusted'),
  ('ZT0004', null::extensions.halfvec, 'active', 'trusted'),
  ('ZT0004', array_fill(1::real, array[768])::extensions.halfvec, 'active', 'pending'),
  ('ZT0004', array_fill(1::real, array[768])::extensions.halfvec, 'revoked', 'trusted')
) as fixtures(ruling_number, embedding, status, review);

grant designflow_hts_alsand_runtime to postgres;
set local role designflow_hts_alsand_runtime;
do $ruling_search_behaviour$
declare
  v_rows text[];
  v_held text[];
  v_pass smallint;
  v_in boolean;
  v_embedding extensions.halfvec := array_fill(1::real, array[768])::extensions.halfvec;
begin
  -- Chapter 95 only, threshold 1: pass 1 is enough; the revoked ruling never appears.
  select array_agg(s.ruling_number order by s.score desc), min(s.pass)
    into v_rows, v_pass
  from hts_rag.hts_rag_search_rulings('plush stuffed toy bear', array['95'], 10, null, 1) s;
  if v_rows is distinct from array['ZT0001'] or v_pass <> 1 then
    raise exception 'pass 1 returned % (pass %), expected only ZT0001', v_rows, v_pass;
  end if;

  -- Rejected codes do not put a ruling in a chapter; pass 2 runs (threshold 5) and keeps the in-chapter boost.
  select array_agg(s.ruling_number order by s.score desc) into v_rows
  from hts_rag.hts_rag_search_rulings('plush stuffed toy bear', array['95'], 10) s;
  if v_rows[1] <> 'ZT0001' or not ('ZT0002' = any (v_rows)) or 'ZT0003' = any (v_rows) then
    raise exception 'pass 2 returned %', v_rows;
  end if;
  select s.pass, s.in_candidate_chapters into v_pass, v_in
  from hts_rag.hts_rag_search_rulings('plush stuffed toy bear', array['95'], 10) s where s.ruling_number = 'ZT0002';
  if v_pass <> 2 or v_in then
    raise exception 'ZT0002 should come from pass 2 outside the candidate chapters (pass %, in %)', v_pass, v_in;
  end if;

  -- No chapters: all active law; held codes returned; score is RRF with k = 60.
  select s.held_codes into v_held from hts_rag.hts_rag_search_rulings('ceramic mug', null, 5) s
  where s.ruling_number = 'ZT0004';
  if v_held is distinct from array['6912.00.4400'] then
    raise exception 'held codes for ZT0004 were %', v_held;
  end if;
  if exists (select 1 from hts_rag.hts_rag_search_rulings('ceramic mug', null, 5) s
             where s.score > (case when s.fts_rank is null then 0 else 1.0 / (60 + s.fts_rank) end)
                           + (case when s.trgm_rank is null then 0 else 1.0 / (60 + s.trgm_rank) end) + 1e-9) then
    raise exception 'score is not reciprocal rank fusion with k = 60';
  end if;

  -- Vector-only search: null embeddings, untrusted/inactive products and
  -- revoked rulings contribute no evidence. Nearest vector wins without chapters.
  select array_agg(s.ruling_number order by s.score desc) into v_rows
  from hts_rag.hts_rag_search_rulings('', null, 10, v_embedding) s;
  if v_rows is distinct from array['ZT0002', 'ZT0001'] then
    raise exception 'vector-only order/filtering returned %', v_rows;
  end if;
  if exists (select 1 from hts_rag.hts_rag_search_rulings('', null, 10, v_embedding) s
             where s.vector_rank is null or s.fts_rank is not null or s.trgm_rank is not null
                or abs(s.score - 1.0 / (60 + s.vector_rank)) > 1e-9) then
    raise exception 'vector-only score is not RRF';
  end if;

  -- Product chapter 94 supplies a strong pass 1; chapter 95 must fall back.
  if (select count(*) from hts_rag.hts_rag_search_rulings('', array['94'], 10, v_embedding, 1) s
      where s.pass = 1 and s.vector_rank is not null) <> 2 then
    raise exception 'vector chapter pass did not return both trusted products';
  end if;
  select array_agg(s.ruling_number order by s.score desc) into v_rows
  from hts_rag.hts_rag_search_rulings('', array['95'], 10, v_embedding, 1) s;
  if v_rows is distinct from array['ZT0001', 'ZT0002'] then
    raise exception 'vector fallback boost returned %', v_rows;
  end if;
  if exists (select 1 from hts_rag.hts_rag_search_rulings('', array['95'], 10, v_embedding, 1) s
             where s.pass <> 2 or s.vector_rank is null
                or s.in_candidate_chapters <> (s.ruling_number = 'ZT0001')
                or abs(s.score - (1.0 / (60 + s.vector_rank)
                   + case when s.ruling_number = 'ZT0001' then 1.0 / 61 else 0 end)) > 1e-9) then
    raise exception 'vector fallback score or chapter flag is incorrect';
  end if;

  -- Empty query returns nothing; limit is honoured.
  if exists (select 1 from hts_rag.hts_rag_search_rulings('   ', null, 5)) then
    raise exception 'empty query returned rows';
  end if;
  if (select count(*) from hts_rag.hts_rag_search_rulings('tariff classification', null, 1)) <> 1 then
    raise exception 'limit not honoured';
  end if;
end
$ruling_search_behaviour$;
reset role;
rollback;

-- Runtime access (#5163): both runtime roles read every ruling and may use schema extensions.
do $ruling_runtime_access$
declare
  v_role text;
begin
  foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
    if not has_schema_privilege(v_role, 'extensions', 'USAGE') then
      raise exception '% lacks USAGE on schema extensions', v_role;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_rulings'
                    and roles @> array[v_role::name] and cmd = 'SELECT' and qual = 'true') then
      raise exception '% cannot read the whole ruling library', v_role;
    end if;
    if has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_products', 'SELECT') then
      raise exception '% reads product rows directly; they stay worker-only', v_role;
    end if;
  end loop;
end
$ruling_runtime_access$;
