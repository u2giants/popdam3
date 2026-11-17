-- popcre/designflow-backend#278 (plan_hts-4-upgrades.md Phase 3 steps 1-2): a separate,
-- versioned store of product-phrase embeddings for nearest-product retrieval.
--
-- hts_rag_ruling_products.phrase_embedding is already filled by a writer and model nobody
-- can identify, so #278 neither overwrites nor uses it. Each row here records its model,
-- so queries embed with the same model. Workers select/insert/delete only (no UPDATE):
-- a re-embed is a new embed_version, or delete+insert (plan §8a item 12).

create table hts_rag.hts_rag_product_embeddings (
  product_id uuid not null,
  embed_version text not null,
  source_environment text not null,
  ruling_number text not null,
  model text not null,
  text_hash text not null,
  embedding extensions.halfvec(768) not null,
  created_at timestamptz not null default now(),
  constraint hts_rag_product_embeddings_pkey primary key (product_id, embed_version, source_environment),
  constraint hts_rag_product_embeddings_product_fkey foreign key (product_id)
    references hts_rag.hts_rag_ruling_products(id) on delete cascade,
  constraint hts_rag_product_embeddings_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_product_embeddings is
  'Product-phrase embeddings per embed_version (model recorded per row); insert/delete only (no worker UPDATE). designflow-backend#278 plan_hts-4-upgrades.md Phase 3.';
create index hts_rag_product_embeddings_hnsw_idx
  on hts_rag.hts_rag_product_embeddings using hnsw (embedding extensions.halfvec_cosine_ops);
create index hts_rag_product_embeddings_ruling_idx
  on hts_rag.hts_rag_product_embeddings (ruling_number);
alter table hts_rag.hts_rag_product_embeddings enable row level security;
revoke all on hts_rag.hts_rag_product_embeddings
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_product_embeddings
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select on hts_rag.hts_rag_product_embeddings
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_embeddings
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_product_embeddings
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_product_embeddings
  for delete to designflow_hts_prod_worker using (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_embeddings
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_product_embeddings
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_product_embeddings
  for delete to designflow_hts_alsand_worker using (source_environment = 'alsand');
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_product_embeddings
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_product_embeddings
  for select to designflow_hts_alsand_runtime using (true);

-- Nearest products by cosine distance for one embed_version. The HTS logins have no USAGE
-- on schema extensions, so the vector type and operator live behind this definer function;
-- the query vector arrives as text ('[x,y,...]', 768 numbers). Active, trusted products of
-- active, unrevoked rulings only; optional held-chapter scope.
create function hts_rag.hts_rag_nearest_products(
  p_embedding text,
  p_embed_version text,
  p_limit integer default 200,
  p_scope_chapters text[] default null
)
returns table (product_id uuid, ruling_number text, distance real)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set hnsw.ef_search = '400'
set hnsw.iterative_scan = 'relaxed_order'
as $function$
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
      and (p_scope_chapters is null or rp.held_chapter = any (p_scope_chapters))
    order by e.embedding operator(extensions.<=>) cast(p_embedding as extensions.halfvec(768))
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ) n
  order by n.distance, n.product_id
$function$;
comment on function hts_rag.hts_rag_nearest_products(text, text, integer, text[]) is
  'Nearest active trusted ruling products for one embed_version (cosine). designflow-backend#278 Phase 3 step 2.';
revoke all on function hts_rag.hts_rag_nearest_products(text, text, integer, text[]) from public, anon, authenticated, service_role;
grant execute on function hts_rag.hts_rag_nearest_products(text, text, integer, text[])
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
     designflow_hts_prod_worker, designflow_hts_alsand_worker;
