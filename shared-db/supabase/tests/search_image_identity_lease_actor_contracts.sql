-- Requires the existing disposable initial superuser for real SESSION AUTHORIZATION.
-- SET ROLE cannot substitute: SECURITY DEFINER must check the actual SESSION_USER.
-- Actual installed function definitions over synthetic private tables only.
begin;
set local search_path=pg_temp,public,extensions;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
create temporary table va_assets as select * from public.assets with no data;
create temporary table va_groups as select * from public.style_groups with no data;
create temporary table va_docs as select * from public.dam_search_documents with no data;
create temporary table va_render as select * from public.render_queue with no data;
alter table va_docs alter embedding_attempts set default 0,alter embedding_max_attempts set default 5;
create unique index va_docs_key on va_docs(document_type,entity_id);
create function pg_temp.va_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'stage2 identity contract: %',label; end if; end $$;
do $$ declare r record;s text;n text;f regprocedure;actor text;
begin
 foreach f in array array['public.claim_dam_search_embedding_documents(integer,text,integer)'::regprocedure,
 'public.upsert_dam_search_embedding(text,uuid,text,uuid,extensions.vector,text)'::regprocedure,
 'public.mark_dam_search_embedding_error(text,uuid,text,uuid,text,text)'::regprocedure] loop
  foreach actor in array array['anon','authenticated'] loop
   perform pg_temp.va_assert(not has_function_privilege(actor,f,'execute'),'client ACL denies '||actor||' on '||f);
  end loop;
  foreach actor in array array['service_role','dam_image_embed_login'] loop
   perform pg_temp.va_assert(has_function_privilege(actor,f,'execute'),'existing caller ACL preserves '||actor||' on '||f);
  end loop;
 end loop;
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='dam' and p.proname in('search_embedding_image_provenance','search_embedding_inputs_match')) or
 (n.nspname='public' and p.proname in('refresh_dam_search_asset_document','refresh_dam_search_style_group_document',
 'claim_dam_search_embedding_documents','upsert_dam_search_embedding','mark_dam_search_embedding_error')) loop
  s:=pg_get_functiondef(r.oid);
  s:=replace(replace(replace(replace(s,'public.assets','pg_temp.va_assets'),'public.style_groups','pg_temp.va_groups'),
   'public.dam_search_documents','pg_temp.va_docs'),'public.render_queue','pg_temp.va_render');
  s:=replace(s,'dam_search_documents.','va_docs.');
  foreach n in array array['dam.search_embedding_image_provenance','dam.search_embedding_inputs_match',
   'public.refresh_dam_search_asset_document','public.refresh_dam_search_style_group_document',
   'public.claim_dam_search_embedding_documents','public.upsert_dam_search_embedding','public.mark_dam_search_embedding_error']
  loop s:=replace(s,n,'pg_temp.va_'||split_part(n,'.',2));end loop;
  execute s;
 end loop;
end $$;
-- Deliberately expose only private clones so guard tests reach the body;
-- original public RPC ACLs above remain unchanged and are tested independently.
create role va_stage2_unauthorized nologin nosuperuser noinherit;
do $$ begin execute format('grant usage on schema %I to public',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant usage on schema extensions to va_stage2_unauthorized;
create temporary table va_preimages(label text primary key,doc jsonb);
grant select on va_preimages to public;
do $$
declare a uuid:='00000000-0000-4000-8000-000000056650';j record;old_token uuid:=gen_random_uuid();
 old_text_hash text;v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;p jsonb;q jsonb;fp jsonb;pre jsonb;
begin
 insert into va_assets(id,filename,relative_path,file_type,is_deleted,thumbnail_url,ai_description,updated_at,modified_at,file_size)
 values(a,'synthetic.png','fixture/stage2.png','png',false,'https://example.invalid/stage2.png','original',now(),now()-interval '1 day',100);
 perform pg_temp.va_refresh_dam_search_asset_document(a);
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'stage2-service',300);
 perform pg_temp.va_assert(j.content_sha256 is distinct from (select content_sha256 from va_docs where entity_id=a),'claim carries opaque image hash');
 update va_assets set ai_description='changed keywords';perform pg_temp.va_refresh_dam_search_asset_document(a);
 perform pg_temp.va_assert(pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,'google/siglip2-base-patch16-naflex'),'unchanged caller returns opaque hash after keyword change');
 update va_docs set embedding=null,metadata=metadata-'_embedding_lease_input_sha256',embedding_lease_token=old_token,embedding_lease_expires_at=now()+interval '5 minutes' where entity_id=a;
 select content_sha256 into old_text_hash from va_docs where entity_id=a;
 update va_assets set ai_description='keywords during pre-upgrade lease';perform pg_temp.va_refresh_dam_search_asset_document(a);
 perform pg_temp.va_assert(pg_temp.va_upsert_dam_search_embedding('asset',a,old_text_hash,old_token,v,'google/siglip2-base-patch16-naflex'),'pre-upgrade keyword-hash lease completes after keyword change');
 p:='{"thumbnail_url":"u"}';q:='{"thumbnail_url":"u","_embedding_input":{"sha256":"image","asset_id":"00000000-0000-4000-8000-000000056650","source_modified_at":"2026-01-01T00:00:00Z"}}';
 perform pg_temp.va_assert(pg_temp.va_search_embedding_inputs_match(p,q,'old','new','google/siglip2-base-patch16-naflex',now(),now()),'source-only legacy bootstrap');
 q:='{"thumbnail_url":"u","_embedding_input":{"sha256":"image","asset_id":"00000000-0000-4000-8000-000000056650","render_completed_at":"2026-01-01T00:00:00Z"}}';
 perform pg_temp.va_assert(pg_temp.va_search_embedding_inputs_match(p,q,'old','new','google/siglip2-base-patch16-naflex',now(),now()),'render-only legacy bootstrap');
 update va_docs set metadata=metadata-'_embedding_input' where entity_id=a;
 fp:=pg_temp.va_search_embedding_image_provenance(a,'https://example.invalid/stage2.png',jsonb_build_object('asset_id',a,'render_completed_at','2026-01-01T00:00:00Z'));
 perform pg_temp.va_assert((fp->>'render_completed_at')::timestamptz='2026-01-01T00:00:00Z'::timestamptz,'render retained with empty queue');
 insert into va_render(id,asset_id,status,completed_at) values(gen_random_uuid(),a,'completed','2026-01-02T00:00:00Z');
 fp:=pg_temp.va_search_embedding_image_provenance(a,'https://example.invalid/stage2.png',jsonb_build_object('asset_id',a));
 perform pg_temp.va_assert((fp->>'render_completed_at')::timestamptz='2026-01-02T00:00:00Z'::timestamptz,'queue render survives absent retained timestamp');
 update va_docs set embedding=null,embedding_lease_token=null,embedding_lease_expires_at=null where entity_id=a;
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'stage2-null-category',300);
 select to_jsonb(d) into pre from va_docs d where entity_id=a;
 begin
  perform pg_temp.va_mark_dam_search_embedding_error(j.document_type,j.entity_id,j.content_sha256,j.lease_token,'invalid null category',null);
  raise exception 'NULL category did not reject';
 exception when invalid_parameter_value then null;end;
 perform pg_temp.va_assert((select to_jsonb(d)=pre from va_docs d where entity_id=a),'NULL category preserves full valid lease preimage');
 perform pg_temp.va_assert(pg_temp.va_mark_dam_search_embedding_error(j.document_type,j.entity_id,j.content_sha256,j.lease_token,'valid transient','transient'),'service JWT error preserves capability');
 update va_docs set embedding_error_category=null,embedding_next_retry_at=null where entity_id=a;
 insert into va_preimages values('unauthorized',(select to_jsonb(d) from va_docs d where entity_id=a));
end $$;
set local request.jwt.claim.role='';set local request.jwt.claims='{}';
select pg_temp.va_assert(auth.role() is null,'fixture represents genuine NULL JWT role');
set session authorization va_stage2_unauthorized;
do $$ begin
 begin perform pg_temp.va_claim_dam_search_embedding_documents(1,'unauthorized',300);raise exception 'NULL unauthorized claim accepted';exception when insufficient_privilege then null;end;
 begin perform pg_temp.va_upsert_dam_search_embedding('asset','00000000-0000-4000-8000-000000056650','x',null,null,'google/siglip2-base-patch16-naflex');raise exception 'NULL unauthorized completion accepted';exception when insufficient_privilege then null;end;
 begin perform pg_temp.va_mark_dam_search_embedding_error('asset','00000000-0000-4000-8000-000000056650','x',null,'x','transient');raise exception 'NULL unauthorized error accepted';exception when insufficient_privilege then null;end;
end $$;
reset session authorization;
select pg_temp.va_assert((select to_jsonb(d)=(select doc from va_preimages where label='unauthorized') from va_docs d),'unauthorized calls preserve full document preimage');
-- JWT service actor succeeds independently of worker-role membership.
set local request.jwt.claim.role='service_role';set local request.jwt.claims='{"role":"service_role"}';
set session authorization service_role;
do $$ declare j record;v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;
begin
 perform pg_temp.va_assert(not pg_has_role(session_user,'dam_image_embed_worker','MEMBER'),'service test is independent of worker membership');
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'stage2-service-actor',300);
 perform pg_temp.va_assert(j.entity_id is not null,'JWT service actor claims');
 perform pg_temp.va_assert(pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,'google/siglip2-base-patch16-naflex'),'JWT service actor completes');
end $$;
reset session authorization;
update va_docs set embedding=null,embedding_attempts=0;
set local request.jwt.claim.role='';set local request.jwt.claims='{}';
select pg_temp.va_assert(auth.role() is null,'direct worker has genuine NULL JWT');
-- A real worker SESSION_USER with no JWT must work inside SECURITY DEFINER.
set session authorization dam_image_embed_login;
do $$ declare j record;v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;
begin
 perform pg_temp.va_assert(session_user='dam_image_embed_login','real worker session identity');
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'stage2-direct-worker',300);
 perform pg_temp.va_assert(j.entity_id is not null,'direct worker claims without JWT');
 perform pg_temp.va_assert(pg_temp.va_mark_dam_search_embedding_error(j.document_type,j.entity_id,j.content_sha256,j.lease_token,'worker permanent','permanent'),'direct worker errors without JWT');
end $$;
reset session authorization;
update va_docs set embedding_error_category=null,embedding_next_retry_at=null,embedding_attempts=0;
set session authorization dam_image_embed_login;
do $$ declare j record;v extensions.vector:=('[1,'||repeat('0,',766)||'0]')::extensions.vector;
begin
 select * into j from pg_temp.va_claim_dam_search_embedding_documents(1,'stage2-direct-complete',300);
 perform pg_temp.va_assert(pg_temp.va_upsert_dam_search_embedding(j.document_type,j.entity_id,j.content_sha256,j.lease_token,v,'google/siglip2-base-patch16-naflex'),'direct worker opaque completion without JWT');
end $$;
reset session authorization;
rollback;
