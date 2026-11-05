-- Synthetic private tables only; exercise the installed definitions without
-- firing production asset/render triggers or depending on licensed source rows.
begin;
set local search_path=pg_temp,public,extensions;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
create temporary table va_assets as select * from public.assets with no data;
create temporary table va_groups as select * from public.style_groups with no data;
create temporary table va_docs as select * from public.dam_search_documents with no data;
create temporary table va_render as select * from public.render_queue with no data;
alter table va_docs alter embedding_attempts set default 0, alter embedding_max_attempts set default 5;
create unique index va_docs_key on va_docs(document_type,entity_id);
do $$ declare r record; s text; n text; begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  (n.nspname='dam' and p.proname in ('search_embedding_image_provenance','search_embedding_inputs_match')) or
  (n.nspname='public' and p.proname in ('refresh_dam_search_asset_document','refresh_dam_search_style_group_document',
    'claim_dam_search_embedding_documents','upsert_dam_search_embedding','mark_dam_search_embedding_error',
    'refresh_dam_search_after_render_completion','refresh_dam_search_after_source_size_change'))
 loop
  s:=pg_get_functiondef(r.oid);
  s:=replace(replace(replace(replace(s,'public.assets','pg_temp.va_assets'),
    'public.style_groups','pg_temp.va_groups'),'public.dam_search_documents','pg_temp.va_docs'),'public.render_queue','pg_temp.va_render');
  s:=replace(s,'dam_search_documents.','va_docs.');
  foreach n in array array['dam.search_embedding_image_provenance','dam.search_embedding_inputs_match',
   'public.refresh_dam_search_asset_document','public.refresh_dam_search_style_group_document',
   'public.claim_dam_search_embedding_documents','public.upsert_dam_search_embedding','public.mark_dam_search_embedding_error',
   'public.refresh_dam_search_after_render_completion','public.refresh_dam_search_after_source_size_change']
  loop s:=replace(s,n,'pg_temp.va_'||split_part(n,'.',2)); end loop;
  execute s;
 end loop;
end $$;
create trigger va_render_completed after update of status,completed_at on va_render for each row
execute function pg_temp.va_refresh_dam_search_after_render_completion();
create trigger va_size_changed after update of file_size on va_assets for each row
when (old.file_size is distinct from new.file_size and old.modified_at is not distinct from new.modified_at
 and old.thumbnail_url is not distinct from new.thumbnail_url) execute function pg_temp.va_refresh_dam_search_after_source_size_change();
create function pg_temp.va_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'image input contract: %',label; end if; end $$;
do $$
declare id uuid:='00000000-0000-4000-8000-000000056340'; gid uuid:='00000000-0000-4000-8000-000000056341';
 j record; before_doc record; after_doc record; v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;
 old_fp text; new_fp text; old_tid tid; new_tid tid;
begin
 insert into va_assets(id,filename,relative_path,file_type,is_deleted,thumbnail_url,ai_description,updated_at,modified_at,file_size)
 values(id,'synthetic.png','fixture/synthetic.png','png',false,'https://example.invalid/stable.png','original',now(),now()-interval '1 day',100);
 perform pg_temp.va_refresh_dam_search_asset_document(id);
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'fixture',300);
 select * into before_doc from va_docs where entity_id=id;
 update va_assets set ai_description='new exact keywords';
 perform pg_temp.va_refresh_dam_search_asset_document(id);
 select * into after_doc from va_docs where entity_id=id;
 perform pg_temp.va_assert(before_doc.embedding_lease_token=after_doc.embedding_lease_token,'text refresh preserves lease');
 perform pg_temp.va_assert(before_doc.indexed_at=after_doc.indexed_at,'text refresh preserves pending queue age');
 perform pg_temp.va_assert(before_doc.content_sha256<>after_doc.content_sha256,'keyword hash still updates exactly');
 perform pg_temp.va_assert(pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,
   'google/siglip2-base-patch16-naflex'),'original poller claim completes after text change');
 update va_assets set ai_description='more keywords'; perform pg_temp.va_refresh_dam_search_asset_document(id);
 perform pg_temp.va_assert((select embedding is not null from va_docs where entity_id=id),'text preserves vector');
 update va_assets set modified_at=now()-interval '1 minute',file_size=101; perform pg_temp.va_refresh_dam_search_asset_document(id);
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=id),'same URL source revision invalidates');
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'fixture',300);
 update va_assets set ai_description='keywords during lease'; perform pg_temp.va_refresh_dam_search_asset_document(id);
 perform pg_temp.va_assert(pg_temp.va_mark_dam_search_embedding_error(j.document_type,j.entity_id,j.content_sha256,j.lease_token,
   'fixture error','transient'),'original claim reports error after text change');
 update va_docs set embedding_next_retry_at=null;
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'fixture',300);
 insert into va_render(id,asset_id,status,completed_at) values(gen_random_uuid(),id,'pending',null);
 update va_render set status='completed',completed_at=now()-interval '30 seconds';
 perform pg_temp.va_assert((select embedding_lease_token is null from va_docs where entity_id=id),'same URL render clears old lease');
 perform pg_temp.va_assert(not pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,
   'google/siglip2-base-patch16-naflex'),'stale image completion rejected');
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'fixture',300);
 perform pg_temp.va_assert(not pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,
   'wrong/model'),'wrong model rejected');
 perform pg_temp.va_assert(not pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,gen_random_uuid(),v,
   'google/siglip2-base-patch16-naflex'),'wrong token rejected');
 update va_docs set embedding_lease_expires_at=now()-interval '1 second';
 perform pg_temp.va_assert(not pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,
   'google/siglip2-base-patch16-naflex'),'expired completion rejected');
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'fixture',300);
 perform pg_temp.va_assert(pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,
   'google/siglip2-base-patch16-naflex'),'current image claim completes');
 delete from va_render; perform pg_temp.va_refresh_dam_search_asset_document(id);
 perform pg_temp.va_assert((select embedding is not null from va_docs where entity_id=id),'render retention preserves vector');
 insert into va_groups(id,sku,folder_path,primary_asset_id,primary_thumbnail_url,updated_at)
 values(gid,'FIXTURE','fixture',id,'https://example.invalid/stable.png',now());
 perform pg_temp.va_refresh_dam_search_style_group_document(gid);
 perform pg_temp.va_assert((select embedding=v and embedding_model='google/siglip2-base-patch16-naflex' from va_docs where entity_id=gid),'new nightly group reuses exact original canonical asset vector');
 update va_groups set group_ai_description='group keywords'; perform pg_temp.va_refresh_dam_search_style_group_document(gid);
 perform pg_temp.va_assert((select embedding is not null from va_docs where entity_id=gid),'group text preserves vector');
 update va_docs set metadata=metadata-'_embedding_input' where entity_id=id;
 perform pg_temp.va_refresh_dam_search_asset_document(id);
 perform pg_temp.va_assert((select embedding=v and embedding_model='google/siglip2-base-patch16-naflex' from va_docs where entity_id=id),'bounded legacy bootstrap retains exact original canonical vector');
 perform pg_temp.va_assert(not pg_temp.va_search_embedding_inputs_match(
   (select metadata-'_embedding_input' from va_docs where entity_id=id),(select metadata from va_docs where entity_id=id),
   'same','same','google/siglip2-base-patch16-naflex',now()-interval '2 days',now()),'legacy vector older than known image revision is not adopted');
 perform set_config('TimeZone','America/New_York',true);
 old_fp:=pg_temp.va_search_embedding_image_provenance(id,'https://example.invalid/stable.png','{}')->>'sha256';
 perform set_config('TimeZone','UTC',true);
 new_fp:=pg_temp.va_search_embedding_image_provenance(id,'https://example.invalid/stable.png','{}')->>'sha256';
 perform pg_temp.va_assert(old_fp=new_fp,'session timezone cannot change image identity');
 perform pg_temp.va_assert(not pg_temp.va_search_embedding_inputs_match(
   (select metadata from va_docs where entity_id=id),(select metadata from va_docs where entity_id=id),
   'same','same',null,now(),now()),'unidentified vector model is not silently adopted');
 select ctid into old_tid from va_docs where entity_id=id;
 perform pg_temp.va_refresh_dam_search_asset_document(id);
 select ctid into new_tid from va_docs where entity_id=id;
 perform pg_temp.va_assert(old_tid=new_tid,'unchanged search document avoids heap and vector-index rewrite');
 update va_assets set file_size=102;
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=id),'size-only trigger invalidates image');
 update va_assets set thumbnail_url='https://example.invalid/new.png'; perform pg_temp.va_refresh_dam_search_asset_document(id);
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=id),'changed URL invalidates');
end $$;
-- A rejected legacy completion must not consume or alter its valid lease.
do $$
declare v_asset_id uuid:='00000000-0000-4000-8000-000000056340'; j record; before_doc jsonb;
 v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;
begin
 update va_docs set embedding_error_category='permanent' where entity_id<>v_asset_id;
 update va_docs set metadata=metadata-'_embedding_input',embedding=null,embedding_model=null,
  embedding_updated_at=null,embedding_error_category=null,embedding_lease_token=null,embedding_lease_expires_at=null where entity_id=v_asset_id;
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'legacy-fixture',300);
 perform pg_temp.va_assert(j.entity_id=v_asset_id,'legacy fixture owns actual claim');
 select to_jsonb(d) into before_doc from va_docs d where entity_id=v_asset_id;
 perform pg_temp.va_assert(not pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,'wrong/model'),'legacy wrong-model completion rejected');
 perform pg_temp.va_assert((select to_jsonb(d)=before_doc from va_docs d where entity_id=v_asset_id),'rejected legacy model leaves complete row and lease unchanged');
 perform pg_temp.va_assert(pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,'google/siglip2-base-patch16-naflex'),'valid legacy completion still accepted');
end $$;

-- Legacy keyword adoption and actual legacy source-size invalidation differ.
do $$
declare v_asset_id uuid:='00000000-0000-4000-8000-000000056340';
 v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;
begin
 update va_docs set metadata=metadata-'_embedding_input',embedding=v,embedding_model='google/siglip2-base-patch16-naflex',embedding_updated_at=now() where entity_id=v_asset_id;
 update va_assets set ai_description='unchanged legacy image keywords' where va_assets.id=v_asset_id;
 perform pg_temp.va_refresh_dam_search_asset_document(v_asset_id);
 perform pg_temp.va_assert((select embedding=v from va_docs where entity_id=v_asset_id),'legacy keyword update retains canonical vector');
 update va_docs set metadata=metadata-'_embedding_input' where entity_id=v_asset_id;
 update va_assets set file_size=file_size+1 where va_assets.id=v_asset_id;
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=v_asset_id),'legacy size-only change invalidates same URL and timestamps');
end $$;

-- Malformed retained provenance must never abort an ordinary tagging write.
do $$
declare v_asset_id uuid:='00000000-0000-4000-8000-000000056340'; before_marker text;
 v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;
begin
 update va_docs set embedding=v,embedding_model='google/siglip2-base-patch16-naflex',embedding_updated_at=now(),
  metadata=jsonb_set(metadata,'{_embedding_input,render_completed_at}','"not-a-timestamp"') where entity_id=v_asset_id;
 update va_assets set ai_description='tagging write survives malformed cached timestamp' where va_assets.id=v_asset_id;
 perform pg_temp.va_refresh_dam_search_asset_document(v_asset_id);
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=v_asset_id),'malformed cached timestamp safely invalidates vector');
 perform pg_temp.va_assert((select ai_description='tagging write survives malformed cached timestamp' from va_assets where va_assets.id=v_asset_id),'tagging write preserved');
 perform pg_temp.va_assert(not pg_temp.va_search_embedding_inputs_match(
  '{"thumbnail_url":"u"}', '{"thumbnail_url":"u","_embedding_input":{"sha256":"new","source_modified_at":"invalid"}}',
  'same','same','google/siglip2-base-patch16-naflex',now(),now()),'malformed new source timestamp abstains');
 perform pg_temp.va_assert(not pg_temp.va_search_embedding_inputs_match(
  '{"thumbnail_url":"u"}', '{"thumbnail_url":"u","_embedding_input":{"sha256":"new","render_completed_at":"999999999999-01-01"}}',
  'same','same','google/siglip2-base-patch16-naflex',now(),now()),'overflowed new render timestamp abstains');
end $$;

-- Use the ordinary tagging-update trigger path, not just a direct helper call.
create function pg_temp.va_tag_refresh() returns trigger language plpgsql as $$
begin perform pg_temp.va_refresh_dam_search_asset_document(new.id); return new; end $$;
create trigger va_tag_update after update of ai_description on va_assets
for each row execute function pg_temp.va_tag_refresh();
do $$
declare v_asset_id uuid:='00000000-0000-4000-8000-000000056340';
begin
 update va_docs set metadata=jsonb_set(metadata,'{_embedding_input,render_completed_at}','"corrupt"') where entity_id=v_asset_id;
 update va_assets set ai_description='ordinary tag trigger still saves' where id=v_asset_id;
 perform pg_temp.va_assert((select ai_description='ordinary tag trigger still saves' from va_assets where id=v_asset_id),'malformed cached date does not abort actual tagging trigger');
 update va_docs set metadata=jsonb_set(metadata,'{_embedding_input,render_completed_at}','"2026-01-01 00:00:00+99:99"') where entity_id=v_asset_id;
 update va_assets set ai_description='ordinary tag trigger survives invalid offset' where id=v_asset_id;
 perform pg_temp.va_assert((select ai_description='ordinary tag trigger survives invalid offset' from va_assets where id=v_asset_id),'invalid cached timezone does not abort actual tagging trigger');
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=v_asset_id),'invalid cached timezone safely invalidates');
 perform pg_temp.va_assert(not pg_temp.va_search_embedding_inputs_match(
  '{"thumbnail_url":"u"}', '{"thumbnail_url":"u","_embedding_input":{"sha256":"new","source_modified_at":"2026-01-01 00:00:00+99:99"}}',
  'same','same','google/siglip2-base-patch16-naflex',now(),now()),'invalid new source timezone abstains');
 perform pg_temp.va_assert(not pg_temp.va_search_embedding_inputs_match(
  '{"thumbnail_url":"u"}', '{"thumbnail_url":"u","_embedding_input":{"sha256":"new","render_completed_at":"2026-01-01 00:00:00+99:99"}}',
  'same','same','google/siglip2-base-patch16-naflex',now(),now()),'invalid new render timezone abstains');
end $$;

-- Nested source changes restore their outer asset identity. An unrelated legacy
-- keyword refresh inside the outer callback must retain its canonical vector.
create function pg_temp.va_nested_source_refresh() returns trigger language plpgsql as $$
begin
 if new.entity_id='00000000-0000-4000-8000-000000056342'::uuid then
  if current_setting('dam.fixture_force_error',true)='yes' then raise check_violation using message='synthetic refresh failure'; end if;
  if current_setting('dam.fixture_nested',true)='yes' then
   update va_assets set file_size=file_size+1 where id='00000000-0000-4000-8000-000000056343'::uuid;
   perform set_config('dam.fixture_nested_observed',current_setting('dam.search_image_size_changed_asset',true),true);
   update va_assets set ai_description='unrelated nested keyword' where id='00000000-0000-4000-8000-000000056344'::uuid;
  end if;
 end if;
 return new;
end $$;
create trigger va_nested_before_refresh before insert on va_docs
for each row execute function pg_temp.va_nested_source_refresh();
do $$
declare v_outer uuid:='00000000-0000-4000-8000-000000056342';
 v_inner uuid:='00000000-0000-4000-8000-000000056343'; v_other uuid:='00000000-0000-4000-8000-000000056344';
 v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector; v_size bigint;
begin
 insert into va_assets(id,filename,relative_path,file_type,is_deleted,thumbnail_url,modified_at,file_size)
 select x,'nested.png','fixture/nested.png','png',false,'https://example.invalid/nested.png',now()-interval '1 day',100
 from unnest(array[v_outer,v_inner,v_other]) x;
 perform pg_temp.va_refresh_dam_search_asset_document(v_outer);
 perform pg_temp.va_refresh_dam_search_asset_document(v_inner);
 perform pg_temp.va_refresh_dam_search_asset_document(v_other);
 update va_docs set metadata=metadata-'_embedding_input',embedding=v,embedding_model='google/siglip2-base-patch16-naflex',embedding_updated_at=now()
 where entity_id in(v_outer,v_inner,v_other);
 perform set_config('dam.search_image_size_changed_asset','outer-sentinel',true);
 perform set_config('dam.fixture_nested','yes',true);
 update va_assets set file_size=101 where id=v_outer;
 perform pg_temp.va_assert(current_setting('dam.search_image_size_changed_asset',true)='outer-sentinel','successful size trigger restores prior marker');
 perform pg_temp.va_assert(current_setting('dam.fixture_nested_observed',true)=v_outer::text,'nested size trigger restores outer asset context');
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=v_outer),'outer legacy size change invalidates');
 perform pg_temp.va_assert((select embedding is null from va_docs where entity_id=v_inner),'nested legacy size change invalidates');
 perform pg_temp.va_assert((select embedding=v from va_docs where entity_id=v_other),'cross-asset nested keyword retains vector');
 perform set_config('dam.fixture_nested','no',true);
 perform set_config('dam.fixture_force_error','yes',true);
 select file_size into v_size from va_assets where id=v_outer;
 begin
  update va_assets set file_size=file_size+1 where id=v_outer;
  raise exception 'synthetic refresh failure did not fire';
 exception when check_violation then null;
 end;
 perform pg_temp.va_assert(current_setting('dam.search_image_size_changed_asset',true)='outer-sentinel','exceptional size trigger restores prior marker');
 perform pg_temp.va_assert((select file_size=v_size from va_assets where id=v_outer),'failed source refresh rolls back source row');
 perform set_config('dam.fixture_force_error','no',true);
 perform set_config('dam.search_image_size_changed_asset','',true);
end $$;

rollback;
