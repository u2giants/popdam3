-- Contract for popcre/designflow-backend#278 step 1.3a (claim popcre/shared-db#7177):
-- retrieval RPCs drop rulings labelled out of scope, keep unlabelled and in-scope ones,
-- and never duplicate a ruling labelled in two environments.
begin;
insert into hts_rag.hts_rag_rulings (ruling_number, subject, full_text, full_text_hash, ruling_date, source_environment, effective_status)
values
  ('ZS0001', 'The tariff classification of a plush stuffed toy bear',
   'The merchandise is a plush stuffed toy bear. The applicable subheading is 9503.00.0073.', 's1', '2020-01-01', 'alsand', 'active'),
  ('ZS0002', 'The country of origin marking of a plush stuffed toy bear',
   'Marking ruling for a plush stuffed toy bear imported from China.', 's2', '2020-01-02', 'alsand', 'active'),
  ('ZS0003', 'The tariff classification of a plush stuffed toy bear with sound',
   'A plush stuffed toy bear with a sound module. The applicable subheading is 9503.00.0073.', 's3', '2020-01-03', 'alsand', 'active');
insert into hts_rag.hts_rag_ruling_codes (ruling_number, code, role, extract_version, source_environment)
values ('ZS0001', '9503.00.0073', 'held', 'parse-v1', 'alsand'),
       ('ZS0002', '9503.00.0073', 'held', 'parse-v1', 'alsand'),
       ('ZS0003', '9503.00.0073', 'held', 'parse-v1', 'alsand');
-- ZS0001 unlabelled (fail-open); ZS0002 out of scope; ZS0003 in scope in BOTH environments.
insert into hts_rag.hts_rag_ruling_scope_labels (ruling_number, label_version, scope_label, in_scope, method, source_environment)
values ('ZS0002', 'scope-labels-v1', 'marking', false, 'rule', 'alsand'),
       ('ZS0003', 'scope-labels-v1', 'classification', true, 'rule', 'alsand'),
       ('ZS0003', 'scope-labels-v1', 'classification', true, 'rule', 'production');
insert into hts_rag.hts_rag_ruling_products
  (ruling_number, item_label, plain_phrase, held_chapter, phrase_embedding,
   effective_status, review_state, extract_version, source_environment)
select r, 'scope fixture', 'scope fixture', '95', array_fill(1::real, array[768])::extensions.halfvec,
       'active', 'trusted', 'parse-v1', 'alsand'
from unnest(array['ZS0001','ZS0002','ZS0003']) r;
insert into hts_rag.hts_rag_product_embeddings (product_id, embed_version, source_environment, ruling_number, model, text_hash, embedding)
select rp.id, 'scope-test-v1', 'alsand', rp.ruling_number, 'fixture', 'x', array_fill(1::real, array[768])::extensions.halfvec
from hts_rag.hts_rag_ruling_products rp where rp.ruling_number in ('ZS0001','ZS0002','ZS0003');

grant designflow_hts_alsand_runtime to postgres;
set local role designflow_hts_alsand_runtime;
do $retrieval_scope_filter$
declare
  v_rows text[];
  v_embedding extensions.halfvec := array_fill(1::real, array[768])::extensions.halfvec;
begin
  -- Text (fts + trgm) and vector evidence together, with and without chapters.
  select array_agg(s.ruling_number order by s.ruling_number) into v_rows
  from hts_rag.hts_rag_search_rulings('plush stuffed toy bear', null, 20, v_embedding) s
  where s.ruling_number like 'ZS%';
  if v_rows is distinct from array['ZS0001','ZS0003'] then
    raise exception 'search_rulings returned % (out-of-scope ZS0002 must go, ZS0003 once)', v_rows;
  end if;
  select array_agg(s.ruling_number order by s.ruling_number) into v_rows
  from hts_rag.hts_rag_search_rulings('plush stuffed toy bear', array['95'], 20, v_embedding, 1) s
  where s.ruling_number like 'ZS%';
  if v_rows is distinct from array['ZS0001','ZS0003'] then
    raise exception 'chapter-scoped search_rulings returned %', v_rows;
  end if;
  -- Vector-only evidence.
  select array_agg(s.ruling_number order by s.ruling_number) into v_rows
  from hts_rag.hts_rag_search_rulings('', null, 20, v_embedding) s
  where s.ruling_number like 'ZS%';
  if v_rows is distinct from array['ZS0001','ZS0003'] then
    raise exception 'vector-only search_rulings returned %', v_rows;
  end if;
  -- Nearest products.
  select array_agg(n.ruling_number order by n.ruling_number) into v_rows
  from hts_rag.hts_rag_nearest_products(v_embedding::text, 'scope-test-v1', 50) n;
  if v_rows is distinct from array['ZS0001','ZS0003'] then
    raise exception 'nearest_products returned %', v_rows;
  end if;
end
$retrieval_scope_filter$;
reset role;
rollback;
