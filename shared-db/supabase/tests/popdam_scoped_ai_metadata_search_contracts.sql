-- #1427 transaction-rolled-back contract checks. Run after migration 20260825010603.
begin;

do $$
declare
  v_asset uuid;
  v_group uuid;
  v_other_group uuid;
  v_character uuid;
  v_licensor uuid := gen_random_uuid();
  v_property uuid := gen_random_uuid();
  v_manual text := 'zz1427_manual_' || txid_current();
  v_rejected text := 'zz1427_rejected_' || txid_current();
  v_candidate text := 'zz1427_candidate_' || txid_current();
  v_group_tag text := 'zz1427_group_' || txid_current();
  v_asset_tag text := 'zz1427_asset_' || txid_current();
  v_character_name text;
  v_before text;
  v_after text;
  v_doc uuid := gen_random_uuid();
  v_claim record;
  v_claim2 record;
  v_result boolean;
begin
  v_asset:=gen_random_uuid(); v_group:=gen_random_uuid(); v_other_group:=gen_random_uuid(); v_character:=gen_random_uuid();
  v_character_name:='ZZ1427 Canonical Character ' || txid_current();
  insert into public.licensors(id,name,external_id) values(v_licensor,'ZZ1427 Licensor','zz1427-l-'||txid_current());
  insert into public.properties(id,licensor_id,name,external_id) values(v_property,v_licensor,'ZZ1427 Property','zz1427-p-'||txid_current());
  insert into public.characters(id,property_id,name,external_id) values(v_character,v_property,v_character_name,'zz1427-c-'||txid_current());
  insert into public.style_groups(id,sku,folder_path,licensor_id,property_id,licensor_name,property_name)
  values(v_group,'ZZ1427-A-'||txid_current(),'ZZ1427/A',null,null,'ZZ1427 Licensor','ZZ1427 Property'),
        (v_other_group,'ZZ1427-B-'||txid_current(),'ZZ1427/B',null,null,null,null);
  insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,style_group_id,is_deleted)
  values(v_asset,'zz1427.ai','ZZ1427/A/zz1427.ai','ai','zz1427-'||txid_current(),now(),v_group,false);

  -- Legacy reconciliation is idempotent and all legacy AI rows stay unscoped.
  if exists(select 1 from public.asset_tags where source='ai' and category<>'legacy_unscoped') then
    raise exception 'legacy AI tag was assigned an inferred scope/category';
  end if;

  insert into public.asset_tags(asset_id,tag,source,category,status,created_by)
  values(v_asset,v_manual,'manual','other','active',gen_random_uuid());
  insert into public.asset_tags(asset_id,tag,source,category,status,model,rejected_at)
  values(v_asset,v_rejected,'ai','scene','rejected','test-model',now());
  insert into public.asset_tags(asset_id,tag,source,category,status,model)
  values(v_asset,v_candidate,'ai','scene','candidate','test-model');
  insert into public.asset_tags(asset_id,tag,source,category,status,model)
  values(v_asset,v_asset_tag,'ai','scene','active','test-model');

  if (select array_position(tags,v_manual) is null from public.assets where id=v_asset)
     or (select array_position(tags,v_asset_tag) is null from public.assets where id=v_asset)
     or (select array_position(tags,v_rejected) is not null from public.assets where id=v_asset)
     or (select array_position(tags,v_candidate) is not null from public.assets where id=v_asset) then
    raise exception 'assets.tags did not include active-only asset-scope rows';
  end if;

  -- Manual row wins an AI collision, and a retry stays idempotent.
  perform set_config('request.jwt.claim.role','service_role',true);
  perform public.replace_asset_ai_tag_result(v_asset,'ai-test','test-model',jsonb_build_array(
    jsonb_build_object('tag',v_manual,'category','scene','status','active','confidence',0.8),
    jsonb_build_object('tag','zz1427_retry','category','view','status','active','confidence',0.9),
    jsonb_build_object('tag','zz1427_durable_rejection','category','view','status','rejected','confidence',0.2)));
  perform public.replace_asset_ai_tag_result(v_asset,'ai-test','test-model',jsonb_build_array(
    jsonb_build_object('tag',v_manual,'category','scene','status','active','confidence',0.8),
    jsonb_build_object('tag','zz1427_retry','category','view','status','active','confidence',0.9)));
  if (select source from public.asset_tags where asset_id=v_asset and tag=v_manual)<>'manual'
     or (select count(*) from public.asset_tags where asset_id=v_asset and tag='zz1427_retry')<>1
     or not exists(select 1 from public.asset_tags where asset_id=v_asset and tag='zz1427_durable_rejection' and status='rejected') then
    raise exception 'manual authority or AI retry idempotence failed';
  end if;

  insert into public.style_group_tags(style_group_id,tag,category,source,status)
  values(v_group,v_group_tag,'theme','manual','active');
  perform public.refresh_dam_search_asset_document(v_asset);
  perform public.refresh_dam_search_style_group_document(v_group);
  if position(v_group_tag in (select search_text from public.dam_search_documents where document_type='asset' and entity_id=v_asset))=0
     or position(v_group_tag in (select search_text from public.dam_search_documents where document_type='style_group' and entity_id=v_group))=0 then
    raise exception 'active group tag did not match member asset and group';
  end if;
  if position(v_rejected in (select search_text from public.dam_search_documents where document_type='asset' and entity_id=v_asset))>0
     or position(v_candidate in (select search_text from public.dam_search_documents where document_type='asset' and entity_id=v_asset))>0 then
    raise exception 'candidate/rejected tag leaked into search';
  end if;

  -- Asset tags remain isolated from the group document.
  if position(v_asset_tag in (select search_text from public.dam_search_documents where document_type='style_group' and entity_id=v_group))>0 then
    raise exception 'asset-only tag leaked into style-group search';
  end if;

  insert into public.asset_characters(asset_id,character_id) values(v_asset,v_character) on conflict do nothing;
  perform public.refresh_dam_search_documents_batch(array[v_asset],array[v_group],2);
  if position(v_character_name in (select search_text from public.dam_search_documents where document_type='asset' and entity_id=v_asset))=0
     or position(v_character_name in (select search_text from public.dam_search_documents where document_type='style_group' and entity_id=v_group))=0 then
    raise exception 'canonical character name missing from deterministic corpus';
  end if;

  -- Effective identity comes from the current group and changes on reassignment without copying it to assets.
  if exists(select 1 from public.get_effective_asset_metadata(v_asset) m join public.assets a on a.id=v_asset
            where m.effective_licensor_id is distinct from (select licensor_id from public.style_groups where id=v_group)
               or m.effective_property_id is distinct from (select property_id from public.style_groups where id=v_group)) then
    raise exception 'group identity did not win';
  end if;
  update public.assets set style_group_id=v_other_group where id=v_asset;
  perform public.refresh_dam_search_documents_batch(array[v_asset],array[v_group,v_other_group],3);
  if position(v_group_tag in (select search_text from public.dam_search_documents where document_type='asset' and entity_id=v_asset))>0 then
    raise exception 'old group tag survived group reassignment';
  end if;
  update public.assets set style_group_id=v_group where id=v_asset;

  -- Batch refresh deduplicates inputs and is bounded.
  if (public.refresh_dam_search_documents_batch(array[v_asset,v_asset],array[v_group,v_group],1)->>'asset_documents')::int<>1
     or (public.refresh_dam_search_documents_batch(array[v_asset,v_asset],array[v_group,v_group],2)->>'style_group_documents')::int<>1 then
    raise exception 'bounded/deduplicated refresh contract failed';
  end if;

  -- Deterministic hashes preserve unchanged embeddings and invalidate changed ones.
  select content_sha256 into v_before from public.dam_search_documents where document_type='asset' and entity_id=v_asset;
  update public.dam_search_documents set embedding=array_fill(0::real,array[384])::extensions.vector,
    embedding_model='fixture',embedding_updated_at=now() where document_type='asset' and entity_id=v_asset;
  perform public.refresh_dam_search_asset_document(v_asset);
  if (select embedding is null from public.dam_search_documents where document_type='asset' and entity_id=v_asset) then
    raise exception 'unchanged hash discarded embedding';
  end if;
  insert into public.asset_tags(asset_id,tag,source,category,status) values(v_asset,'zz1427_hash_change','manual','other','active');
  select content_sha256 into v_after from public.dam_search_documents where document_type='asset' and entity_id=v_asset;
  if v_after=v_before or (select embedding is not null from public.dam_search_documents where document_type='asset' and entity_id=v_asset) then
    raise exception 'changed corpus did not change hash/invalidate embedding';
  end if;

  -- Real leases are exclusive; stale hashes/tokens refuse writes; expiry permits recovery.
  insert into public.dam_search_documents(document_type,entity_id,title,path,search_text,content_sha256,indexed_at)
  values('asset',v_doc,'fixture','','lease fixture','fixture-hash','1900-01-01');
  select * into v_claim from public.claim_dam_search_embedding_documents(1,'worker-a',60);
  if v_claim.entity_id<>v_doc or v_claim.lease_token is null then raise exception 'claim did not lease fixture'; end if;
  if exists(select 1 from public.claim_dam_search_embedding_documents(1,'worker-b',60) where entity_id=v_doc) then
    raise exception 'live embedding lease was stolen';
  end if;
  select public.upsert_dam_search_embedding('asset',v_doc,'stale-hash',v_claim.lease_token,
    array_fill(0::real,array[384])::extensions.vector,'fixture') into v_result;
  if v_result then raise exception 'stale hash was accepted'; end if;
  update public.dam_search_documents set embedding_lease_expires_at=now()-interval '1 second' where entity_id=v_doc;
  select * into v_claim2 from public.claim_dam_search_embedding_documents(1,'worker-b',60);
  if v_claim2.entity_id<>v_doc or v_claim2.lease_token=v_claim.lease_token then raise exception 'expired lease was not recovered'; end if;

  update public.dam_search_documents set embedding_attempts=embedding_max_attempts,embedding_lease_expires_at=null,
    embedding_lease_token=null where entity_id=v_doc;
  if exists(select 1 from public.claim_dam_search_embedding_documents(1000,'worker-c',60) where entity_id=v_doc) then
    raise exception 'retry-exhausted document was claimed';
  end if;

  -- Least privilege and public-schema access surface.
  if has_function_privilege('authenticated','public.replace_asset_ai_tag_result(uuid,text,text,jsonb)','EXECUTE') then
    raise exception 'authenticated can execute service-only AI replacement'; end if;
  if not has_function_privilege('service_role','public.replace_asset_ai_tag_result(uuid,text,text,jsonb)','EXECUTE') then
    raise exception 'service_role cannot execute AI replacement'; end if;
  if not has_function_privilege('authenticated','public.get_effective_asset_metadata(uuid)','EXECUTE') then
    raise exception 'authenticated cannot read effective metadata'; end if;
  if has_table_privilege('authenticated','dam.pdf_rich_extraction','SELECT') then
    raise exception 'authenticated can read the private dam table'; end if;
end $$;

rollback;
