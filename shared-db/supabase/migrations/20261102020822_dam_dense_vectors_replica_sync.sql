-- derived-from: 20261102003027
-- #4508: keep the dense projection current for origin and replica-mode writers.
begin;
set local lock_timeout = '5s';
-- Hold the writer-conflicting trigger lock through complete reconciliation.
alter table public.dam_search_documents enable always trigger trg_sync_search_group_vectors;
insert into dam.search_group_vectors(entity_id,document_type,asset_id,style_group_id,embedding,embedding_model)
select entity_id,document_type,asset_id,style_group_id,embedding,embedding_model
from public.dam_search_documents where document_type='style_group' and embedding is not null
on conflict(entity_id) do update set
  asset_id=excluded.asset_id,style_group_id=excluded.style_group_id,
  embedding=excluded.embedding,embedding_model=excluded.embedding_model
where (search_group_vectors.asset_id,search_group_vectors.style_group_id,search_group_vectors.embedding,search_group_vectors.embedding_model)
  is distinct from (excluded.asset_id,excluded.style_group_id,excluded.embedding,excluded.embedding_model);
delete from dam.search_group_vectors g
where not exists (
  select 1 from public.dam_search_documents d
  where d.document_type='style_group' and d.embedding is not null and d.entity_id=g.entity_id
);
analyze dam.search_group_vectors;
commit;
