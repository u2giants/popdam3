-- derived-from: 20261031235206, 20261104231008, 20260825082910
set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

-- The keyword hash remains the exact search-text hash. Image jobs carry their
-- own immutable input hash through the existing claim/completion parameter.
create or replace function dam.search_embedding_image_provenance(
  p_asset_id uuid, p_thumbnail_url text, p_previous jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, dam, extensions set timezone = 'UTC' as $$
declare a record; v_render timestamptz; v_cached jsonb; v_input jsonb; v_invalid_previous boolean:=false;
begin
  if p_asset_id is null or nullif(btrim(p_thumbnail_url),'') is null then return null; end if;
  select modified_at,file_size,thumbnail_url into a from public.assets where id=p_asset_id and not is_deleted;
  if not found or a.thumbnail_url is distinct from p_thumbnail_url then return null; end if;
  select metadata->'_embedding_input' into v_cached from public.dam_search_documents
    where document_type='asset' and entity_id=p_asset_id;
  select q.completed_at into v_render from public.render_queue q
    where q.asset_id=p_asset_id and q.status='completed' and q.completed_at is not null
    order by q.completed_at desc limit 1;
  -- Keep the last observed successful render after queue retention removes it.
  if p_previous->>'asset_id'=p_asset_id::text then
    begin
      v_render:=greatest(v_render,(p_previous->>'render_completed_at')::timestamptz);
    exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
      v_invalid_previous:=true;
    end;
  end if;
  if v_cached->>'asset_id'=p_asset_id::text then
    begin
      v_render:=greatest(v_render,(v_cached->>'render_completed_at')::timestamptz);
    exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
      v_invalid_previous:=true;
    end;
  end if;
  if a.modified_at is null and v_render is null and not v_invalid_previous then return null; end if;
  v_input:=jsonb_strip_nulls(jsonb_build_object('version',1,'model','google/siglip2-base-patch16-naflex',
    'image_transform','uncropped-thumbnail','asset_id',p_asset_id,'thumbnail_url',p_thumbnail_url,
    'source_modified_at',a.modified_at,'source_file_size',a.file_size,'render_completed_at',v_render,
    'invalid_previous',case when v_invalid_previous then true end));
  return v_input||jsonb_build_object('sha256',encode(digest(v_input::text,'sha256'),'hex'));
end $$;

create or replace function dam.search_embedding_inputs_match(
 p_old jsonb,p_new jsonb,p_old_text_hash text,p_new_text_hash text,
 p_model text,p_vector_at timestamptz,p_indexed_at timestamptz)
returns boolean language plpgsql stable set search_path=public as $$
declare v_source timestamptz; v_render timestamptz;
begin
 -- Validate JSON dates even on the equal-hash path. Corruption must abstain,
 -- never abort an ordinary tagging/source transaction.
 v_source:=(p_new->'_embedding_input'->>'source_modified_at')::timestamptz;
 v_render:=(p_new->'_embedding_input'->>'render_completed_at')::timestamptz;
 if p_new->'_embedding_input'->>'invalid_previous'='true' then return false; end if;
 return coalesce(case
 when p_new->'_embedding_input'->>'sha256' is not null and p_old->'_embedding_input'->>'sha256' is not null
 then p_new->'_embedding_input'->>'sha256'=p_old->'_embedding_input'->>'sha256'
   and (p_model='google/siglip2-base-patch16-naflex' or (p_model is null and p_vector_at is null))
 when p_new->'_embedding_input'->>'sha256' is not null then
   -- Bootstrap only a proven same-image canonical vector or an existing job
   -- newer than the authoritative source/render revision; never library reset.
   p_old->>'thumbnail_url'=p_new->>'thumbnail_url'
   -- The size trigger identifies only the asset whose source actually changed.
   and current_setting('dam.search_image_size_changed_asset',true) is distinct from p_new->'_embedding_input'->>'asset_id'
   and (p_model='google/siglip2-base-patch16-naflex' or (p_model is null and p_vector_at is null))
   and coalesce(p_vector_at,p_indexed_at)>=greatest(v_source,v_render)
 when p_old->'_embedding_input'->>'sha256' is not null then false
 else p_old_text_hash=p_new_text_hash and p_old->>'thumbnail_url' is not distinct from p_new->>'thumbnail_url'
 end,false);
exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
 return false;
end $$;
revoke all on function dam.search_embedding_image_provenance(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function dam.search_embedding_inputs_match(jsonb,jsonb,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function dam.search_embedding_image_provenance(uuid,text,jsonb) to service_role;
grant execute on function dam.search_embedding_inputs_match(jsonb,jsonb,text,text,text,timestamptz,timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_dam_search_asset_document(p_asset_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dam', 'extensions'
AS $function$
declare v_text text; v_hash text; v_input jsonb; v_old_group uuid; v_new_group uuid;
begin
  select style_group_id into v_old_group from public.dam_search_documents
  where document_type='asset' and entity_id=p_asset_id;
  if not exists (select 1 from public.assets where id=p_asset_id and is_deleted=false) then
    delete from public.dam_search_documents where document_type='asset' and entity_id=p_asset_id;
    if v_old_group is not null then perform public.refresh_dam_search_style_group_document(v_old_group); end if;
    return;
  end if;
  select coalesce(concat_ws(' ', a.filename,a.relative_path,a.content_type,sg.item_description,
    sg.group_ai_description,a.cover_description,a.ai_description,a.scene_description,a.customer,a.program,
    case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
    case when a.style_group_id is null then a.property_name else sg.property_name end,
    a.product_category,array_to_string(a.product_material,' '),a.product_dimensions,
    dam.jsonb_leaf_text(sg.rich_metadata),pdf.txt,atg.tags,gtg.tags,chars.names), '')
  into v_text
  from public.assets a left join public.style_groups sg on sg.id=a.style_group_id
  left join lateral (select string_agg(p.extracted_text,' ' order by p.sampled_at desc) txt
    from public.pdf_text_samples p where p.asset_id=a.id and p.extracted_text is not null) pdf on true
  left join lateral (select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags
    from public.asset_tags t where t.asset_id=a.id and t.status='active') atg on true
  left join lateral (select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags
    from public.style_group_tags t where t.style_group_id=a.style_group_id and t.status='active') gtg on true
  left join lateral (select string_agg(c.name,' ' order by lower(c.name),c.id) names
    from (select c.id,c.name from public.asset_characters ac join public.characters c on c.id=ac.character_id where ac.asset_id=a.id
      union all select lc.id,lc.name from public.asset_licensor_characters alc join core.character lc on lc.id=alc.character_id
      where alc.asset_id=a.id) c) chars on true
  where a.id=p_asset_id;
  v_hash := encode(digest(v_text,'sha256'),'hex');
  select dam.search_embedding_image_provenance(a.id,a.thumbnail_url,d.metadata->'_embedding_input') into v_input
  from public.assets a left join public.dam_search_documents d on d.document_type='asset' and d.entity_id=a.id where a.id=p_asset_id;
  insert into public.dam_search_documents(document_type,entity_id,asset_id,style_group_id,title,path,customer,program,
    search_text,content_sha256,metadata,source_updated_at,indexed_at)
  select 'asset',a.id,a.id,a.style_group_id,coalesce(a.filename,''),coalesce(a.relative_path,''),a.customer,a.program,
    v_text,v_hash,jsonb_strip_nulls(jsonb_build_object('file_type',a.file_type,'asset_type',a.asset_type,
      'content_type',a.content_type,'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
      'product_material',a.product_material,'product_dimensions',a.product_dimensions,'workflow_status',a.workflow_status,
      'is_licensed',a.is_licensed,'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
      'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
      'product_category',a.product_category,'thumbnail_url',a.thumbnail_url,'_embedding_input',v_input)),
    greatest(coalesce(a.updated_at,'-infinity'),coalesce(a.modified_at,'-infinity')),now()
  from public.assets a left join public.style_groups sg on sg.id=a.style_group_id where a.id=p_asset_id and not a.is_deleted
  on conflict(document_type,entity_id) do update set asset_id=excluded.asset_id,style_group_id=excluded.style_group_id,
    title=excluded.title,path=excluded.path,customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,
    content_sha256=excluded.content_sha256,metadata=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) and dam_search_documents.embedding_lease_token is not null then excluded.metadata||jsonb_build_object('_embedding_lease_input_sha256',coalesce(dam_search_documents.metadata->>'_embedding_lease_input_sha256',dam_search_documents.content_sha256)) else excluded.metadata end,source_updated_at=excluded.source_updated_at,indexed_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.indexed_at else now() end,
    embedding=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding end,
    embedding_model=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_model end,
    embedding_updated_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_updated_at end,
    embedding_error=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_token end,embedding_lease_owner=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_owner end,embedding_lease_expires_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_expires_at end,embedding_next_retry_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_next_retry_at end
  where row(dam_search_documents.asset_id,dam_search_documents.style_group_id,dam_search_documents.title,dam_search_documents.path,dam_search_documents.customer,dam_search_documents.program,dam_search_documents.search_text,dam_search_documents.content_sha256,dam_search_documents.metadata-'_embedding_lease_input_sha256')
    is distinct from row(excluded.asset_id,excluded.style_group_id,excluded.title,excluded.path,excluded.customer,excluded.program,excluded.search_text,excluded.content_sha256,excluded.metadata)
    or dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) is not true;
  select style_group_id into v_new_group from public.assets where id=p_asset_id;
  if v_old_group is distinct from v_new_group then
    if v_old_group is not null then perform public.refresh_dam_search_style_group_document(v_old_group); end if;
    if v_new_group is not null then perform public.refresh_dam_search_style_group_document(v_new_group); end if;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.refresh_dam_search_style_group_document(p_style_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dam', 'extensions'
AS $function$
declare v_text text; v_hash text; v_input jsonb;
begin
  if not exists(select 1 from public.style_groups where id=p_style_group_id) then
    delete from public.dam_search_documents where document_type='style_group' and entity_id=p_style_group_id; return;
  end if;
  select coalesce(concat_ws(' ',sg.sku,sg.folder_path,sg.cover_description,sg.item_description,sg.group_ai_description,
    dam.jsonb_leaf_text(sg.rich_metadata),sg.customer,sg.program,sg.licensor_name,sg.property_name,sg.product_category,
    sg.division_name,sg.mg01_name,sg.mg02_name,sg.mg03_name,sg.size_name,gtg.tags,chars.names),'') into v_text
  from public.style_groups sg
  left join lateral(select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags from public.style_group_tags t
    where t.style_group_id=sg.id and t.status='active') gtg on true
  left join lateral(select string_agg(c.name,' ' order by lower(c.name),c.id) names from (select c.id,c.name from public.assets a
    join public.asset_characters ac on ac.asset_id=a.id join public.characters c on c.id=ac.character_id
    where a.style_group_id=sg.id and not a.is_deleted
    union all select lc.id,lc.name from public.assets a
    join public.asset_licensor_characters alc on alc.asset_id=a.id join core.character lc on lc.id=alc.character_id
    where a.style_group_id=sg.id and not a.is_deleted) c) chars on true where sg.id=p_style_group_id;
  v_hash:=encode(digest(v_text,'sha256'),'hex');
  select dam.search_embedding_image_provenance(sg.primary_asset_id,sg.primary_thumbnail_url,d.metadata->'_embedding_input') into v_input
  from public.style_groups sg left join public.dam_search_documents d on d.document_type='style_group' and d.entity_id=sg.id where sg.id=p_style_group_id;
  insert into public.dam_search_documents(document_type,entity_id,style_group_id,title,path,customer,program,search_text,
    content_sha256,metadata,source_updated_at,indexed_at,embedding,embedding_model,embedding_updated_at)
  select 'style_group',sg.id,sg.id,coalesce(sg.sku,''),coalesce(sg.folder_path,''),sg.customer,sg.program,v_text,v_hash,
    jsonb_strip_nulls(jsonb_build_object('asset_count',sg.asset_count,'workflow_status',sg.workflow_status,
      'is_licensed',sg.is_licensed,'licensor_name',sg.licensor_name,'property_name',sg.property_name,
      'product_category',sg.product_category,'item_description_source',sg.item_description_source,
      'group_ai_description_source',sg.group_ai_description_source,'group_ai_description_model',sg.group_ai_description_model,
      'rich_metadata_source',sg.rich_metadata_source,'thumbnail_url',sg.primary_thumbnail_url,'_embedding_input',v_input)),
    greatest(coalesce(sg.updated_at,'-infinity'),coalesce(sg.latest_file_date,'-infinity')),now(),
    case when reuse.ok then ad.embedding end,case when reuse.ok then ad.embedding_model end,case when reuse.ok then ad.embedding_updated_at end
  from public.style_groups sg
  left join public.dam_search_documents ad on ad.document_type='asset' and ad.entity_id=sg.primary_asset_id
  left join lateral(select ad.embedding is not null and ad.embedding_model='google/siglip2-base-patch16-naflex' and v_input is not null
    and dam.search_embedding_inputs_match(ad.metadata,jsonb_build_object('thumbnail_url',sg.primary_thumbnail_url,'_embedding_input',v_input),
      ad.content_sha256,v_hash,ad.embedding_model,ad.embedding_updated_at,ad.indexed_at) ok) reuse on true
  where sg.id=p_style_group_id
  on conflict(document_type,entity_id) do update set style_group_id=excluded.style_group_id,title=excluded.title,path=excluded.path,
    customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,content_sha256=excluded.content_sha256,
    metadata=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) and dam_search_documents.embedding_lease_token is not null then excluded.metadata||jsonb_build_object('_embedding_lease_input_sha256',coalesce(dam_search_documents.metadata->>'_embedding_lease_input_sha256',dam_search_documents.content_sha256)) else excluded.metadata end,source_updated_at=excluded.source_updated_at,indexed_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.indexed_at else now() end,
    embedding=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding else excluded.embedding end,
    embedding_model=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_model else excluded.embedding_model end,
    embedding_updated_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_updated_at else excluded.embedding_updated_at end,
    embedding_error=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_token end,embedding_lease_owner=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_owner end,embedding_lease_expires_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_expires_at end,embedding_next_retry_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_next_retry_at end
  where row(dam_search_documents.style_group_id,dam_search_documents.title,dam_search_documents.path,dam_search_documents.customer,dam_search_documents.program,dam_search_documents.search_text,dam_search_documents.content_sha256,dam_search_documents.metadata-'_embedding_lease_input_sha256')
    is distinct from row(excluded.style_group_id,excluded.title,excluded.path,excluded.customer,excluded.program,excluded.search_text,excluded.content_sha256,excluded.metadata)
    or dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) is not true;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_dam_search_embedding_documents(p_limit integer DEFAULT 100, p_worker_id text DEFAULT NULL::text, p_lease_seconds integer DEFAULT 300)
 RETURNS TABLE(document_type text, entity_id uuid, search_text text, thumbnail_url text, content_sha256 text, lease_token uuid, lease_expires_at timestamp with time zone, attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (coalesce((select auth.role()) = 'service_role', false) or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true or nullif(btrim(p_worker_id),'') is null then raise exception 'authorized embedding actor and worker id required' using errcode='42501'; end if;
  return query with candidates as (
    select d.document_type,d.entity_id from public.dam_search_documents d
    where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
      and (d.embedding_next_retry_at is null or d.embedding_next_retry_at<=now())
      and (d.embedding_lease_expires_at is null or d.embedding_lease_expires_at<=now())
      and d.embedding_error_category is distinct from 'permanent'
      and nullif(d.metadata->>'thumbnail_url','') is not null
    order by (d.document_type = 'style_group') desc, d.indexed_at, d.document_type, d.entity_id for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),1000))
  ), claimed as (update public.dam_search_documents d set embedding_lease_token=gen_random_uuid(),
    embedding_lease_owner=p_worker_id,embedding_lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,300),3600))),
    metadata=d.metadata||jsonb_build_object('_embedding_lease_input_sha256',coalesce(d.metadata->'_embedding_input'->>'sha256',d.content_sha256)),
    embedding_attempts=d.embedding_attempts+1 from candidates c where d.document_type=c.document_type and d.entity_id=c.entity_id
    returning d.*)
  select c.document_type,c.entity_id,left(c.search_text,8000),
    c.metadata->>'thumbnail_url',
    c.metadata->>'_embedding_lease_input_sha256',c.embedding_lease_token,c.embedding_lease_expires_at,c.embedding_attempts from claimed c;
end
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_dam_search_embedding(p_document_type text, p_entity_id uuid, p_content_sha256 text, p_lease_token uuid, p_embedding vector, p_embedding_model text DEFAULT 'google/siglip2-base-patch16-naflex'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (coalesce((select auth.role()) = 'service_role', false) or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then raise exception 'authorized embedding actor required' using errcode='42501'; end if;
  update public.dam_search_documents set embedding=p_embedding,embedding_model=p_embedding_model,embedding_updated_at=now(),
    embedding_error=null,embedding_error_category=null,embedding_next_retry_at=null,embedding_lease_token=null,
    embedding_lease_owner=null,embedding_lease_expires_at=null where document_type=p_document_type and entity_id=p_entity_id
    and coalesce(metadata->>'_embedding_lease_input_sha256',content_sha256)=p_content_sha256 and p_embedding_model='google/siglip2-base-patch16-naflex' and embedding_lease_token=p_lease_token and embedding_lease_expires_at>now(); return found;
end
$function$
;

CREATE OR REPLACE FUNCTION public.mark_dam_search_embedding_error(p_document_type text, p_entity_id uuid, p_content_sha256 text, p_lease_token uuid, p_error text, p_category text DEFAULT 'transient'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (coalesce((select auth.role()) = 'service_role', false) or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then raise exception 'authorized embedding actor required' using errcode='42501'; end if;
  if p_category is null or p_category not in ('transient','permanent') then raise exception 'invalid embedding error category' using errcode='22023'; end if;
  update public.dam_search_documents set embedding_error=left(coalesce(p_error,'unknown embedding error'),1000),
    embedding_error_category=case when p_category='permanent' or embedding_attempts>=embedding_max_attempts then 'permanent' else 'transient' end,
    embedding_next_retry_at=case when p_category='transient' and embedding_attempts<embedding_max_attempts
      then now()+make_interval(secs=>least(3600,30*(2^greatest(0,embedding_attempts-1))::int)) end,
    embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null
  where document_type=p_document_type and entity_id=p_entity_id and coalesce(metadata->>'_embedding_lease_input_sha256',content_sha256)=p_content_sha256
    and embedding_lease_token=p_lease_token and embedding_lease_expires_at>now(); return found;
end $function$
;
