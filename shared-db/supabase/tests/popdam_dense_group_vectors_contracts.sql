-- Transactional projection parity and invalidation; fixtures never persist.
begin;
set local search_path=public,extensions,dam;
do $$
declare
  fixture uuid := gen_random_uuid();
  moved uuid := gen_random_uuid();
  v extensions.vector := array_fill(0.25::real,array[768])::extensions.vector;
  v2 extensions.vector := array_fill(0.5::real,array[768])::extensions.vector;
begin
  if exists (
    select 1 from public.dam_search_documents d full join dam.search_group_vectors g
      on d.document_type='style_group' and d.embedding is not null and g.entity_id=d.entity_id
    where (d.document_type='style_group' and d.embedding is not null or g.entity_id is not null)
      and (d.entity_id is null or g.entity_id is null
        or (d.asset_id,d.style_group_id,d.embedding,d.embedding_model)
          is distinct from (g.asset_id,g.style_group_id,g.embedding,g.embedding_model))
  ) then raise exception 'dense vectors differ from canonical documents'; end if;
  if (select attstorage from pg_attribute where attrelid='dam.search_group_vectors'::regclass
      and attname='embedding') <> 'p' then raise exception 'vectors must remain inline'; end if;
  if has_table_privilege('authenticated','dam.search_group_vectors','SELECT')
    or has_table_privilege('anon','dam.search_group_vectors','SELECT') then
    raise exception 'private vector projection is exposed';
  end if;
  insert into public.dam_search_documents(document_type,entity_id,embedding,embedding_model)
    values ('style_group',fixture,v,'google/siglip2-base-patch16-naflex');
  if not exists(select 1 from dam.search_group_vectors where entity_id=fixture and embedding=v) then
    raise exception 'insert not synchronized'; end if;
  update public.dam_search_documents set embedding=v2,embedding_model='test-model'
    where document_type='style_group' and entity_id=fixture;
  if not exists(select 1 from dam.search_group_vectors where entity_id=fixture and embedding=v2 and embedding_model='test-model') then
    raise exception 'replacement not synchronized'; end if;
  update public.dam_search_documents set entity_id=moved where document_type='style_group' and entity_id=fixture;
  if exists(select 1 from dam.search_group_vectors where entity_id=fixture)
    or not exists(select 1 from dam.search_group_vectors where entity_id=moved) then
    raise exception 'key change leaves stale vector'; end if;
  update public.dam_search_documents set embedding=null where document_type='style_group' and entity_id=moved;
  if exists(select 1 from dam.search_group_vectors where entity_id=moved) then
    raise exception 'invalidation leaves stale vector'; end if;
  update public.dam_search_documents set embedding=v where document_type='style_group' and entity_id=moved;
  delete from public.dam_search_documents where document_type='style_group' and entity_id=moved;
  if exists(select 1 from dam.search_group_vectors where entity_id=moved) then
    raise exception 'delete leaves stale vector'; end if;
  insert into public.dam_search_documents(document_type,entity_id,embedding) values('asset',fixture,v);
  if exists(select 1 from dam.search_group_vectors where entity_id=fixture) then
    raise exception 'asset leaked into group vectors'; end if;
end;
$$;
rollback;
