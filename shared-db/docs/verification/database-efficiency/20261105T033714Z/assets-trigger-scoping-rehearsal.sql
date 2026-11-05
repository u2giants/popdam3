-- #5609 synthetic-only rehearsal. Run once with old triggers, once with new.
-- Own isolated database required. Never use against production/shared preview.
-- Semantic checksum excludes identity tuples, scan/freshness timestamps and leases.
begin;
set local statement_timeout='120s';
insert into public.style_groups(id,sku,folder_path)
select md5('zz5609-group-'||i)::uuid,'ZZ5609-'||i,'ZZ5609/'||i from generate_series(1,100) i;
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,
  style_group_id,thumbnail_url,asset_type,designer_name,cover_description)
select md5('zz5609-asset-'||i)::uuid,'zz5609-'||i||'.ai','ZZ5609/'||((i-1)/10+1)||'/'||i||'.ai',
  'ai','zz5609-'||i,'2026-11-01'::timestamptz,md5('zz5609-group-'||((i-1)/10+1))::uuid,
  'https://fixture.invalid/'||i||'.jpg','art_piece','fixture designer','fixture cover'
from generate_series(1,1000) i;

select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where quick_hash like 'zz5609-%';
select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');

-- Mixed workload: rename, thumbnail, regroup, delete/revive, designer, cover,
-- no-op and metadata edits. Search newly added dependency columns are tested
-- separately in the contract suite because old behavior omitted those refreshes.
update public.assets set filename='renamed.ai' where id=md5('zz5609-asset-1')::uuid;
update public.assets set thumbnail_url='https://fixture.invalid/new.jpg' where id=md5('zz5609-asset-1')::uuid;
update public.assets set style_group_id=md5('zz5609-group-2')::uuid where id=md5('zz5609-asset-2')::uuid;
update public.assets set is_deleted=true where id=md5('zz5609-asset-3')::uuid;
update public.assets set is_deleted=false where id=md5('zz5609-asset-3')::uuid;
update public.assets set designer_name='changed designer' where id=md5('zz5609-asset-4')::uuid;
update public.assets set cover_description='changed cover' where id=md5('zz5609-asset-1')::uuid;
update public.assets set filename=filename,last_seen_at=clock_timestamp() where id=md5('zz5609-asset-5')::uuid;
select jsonb_build_object(
  'documents', (select md5(string_agg(jsonb_build_array(document_type,entity_id,style_group_id,title,path,
    customer,program,search_text,content_sha256,metadata,embedding is null)::text,'' order by document_type,entity_id))
    from public.dam_search_documents where entity_id in(select id from public.assets where quick_hash like 'zz5609-%')
      or entity_id in(select id from public.style_groups where sku like 'ZZ5609-%')),
  'groups', (select md5(string_agg((to_jsonb(sg)-'created_at'-'updated_at')::text,'' order by id))
    from public.style_groups sg where sku like 'ZZ5609-%')) as semantic_checksum;
rollback;
