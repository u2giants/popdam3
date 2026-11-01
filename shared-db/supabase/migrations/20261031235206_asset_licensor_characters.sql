-- #5231: asset <-> licensor character (core.character) tags for the PopDAM tagger.
-- Mirrors public.asset_characters; the four DAM functions below are their live
-- definitions with only the licensor-character additions.
-- derived-from: 20260825010603, 20260825082910, 20260826144047

create table public.asset_licensor_characters (
  asset_id uuid not null references public.assets(id) on delete cascade,
  character_id uuid not null references core.character(id) on delete cascade,
  source text not null default 'ai',
  model text,
  tagged_at timestamptz not null default now(),
  primary key (asset_id, character_id)
);
create index asset_licensor_characters_character_id_idx on public.asset_licensor_characters (character_id);
alter table public.asset_licensor_characters enable row level security;
create policy "Authenticated read" on public.asset_licensor_characters for select to authenticated using (true);
create policy "Admin write" on public.asset_licensor_characters for all to authenticated
  using ((select has_role(auth.uid(), 'admin'::app_role) as has_role));
grant all on table public.asset_licensor_characters to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_dam_search_asset_document(p_asset_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dam', 'extensions'
AS $function$
declare v_text text; v_hash text; v_old_group uuid; v_new_group uuid;
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
  insert into public.dam_search_documents(document_type,entity_id,asset_id,style_group_id,title,path,customer,program,
    search_text,content_sha256,metadata,source_updated_at,indexed_at)
  select 'asset',a.id,a.id,a.style_group_id,coalesce(a.filename,''),coalesce(a.relative_path,''),a.customer,a.program,
    v_text,v_hash,jsonb_strip_nulls(jsonb_build_object('file_type',a.file_type,'asset_type',a.asset_type,
      'content_type',a.content_type,'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
      'product_material',a.product_material,'product_dimensions',a.product_dimensions,'workflow_status',a.workflow_status,
      'is_licensed',a.is_licensed,'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
      'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
      'product_category',a.product_category,'thumbnail_url',a.thumbnail_url)),
    greatest(coalesce(a.updated_at,'-infinity'),coalesce(a.modified_at,'-infinity')),now()
  from public.assets a left join public.style_groups sg on sg.id=a.style_group_id where a.id=p_asset_id and not a.is_deleted
  on conflict(document_type,entity_id) do update set asset_id=excluded.asset_id,style_group_id=excluded.style_group_id,
    title=excluded.title,path=excluded.path,customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,
    content_sha256=excluded.content_sha256,metadata=excluded.metadata,source_updated_at=excluded.source_updated_at,indexed_at=now(),
    embedding=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding end,
    embedding_model=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_model end,
    embedding_updated_at=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_updated_at end,
    embedding_error=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null,embedding_next_retry_at=null;
  select style_group_id into v_new_group from public.assets where id=p_asset_id;
  if v_old_group is distinct from v_new_group then
    if v_old_group is not null then perform public.refresh_dam_search_style_group_document(v_old_group); end if;
    if v_new_group is not null then perform public.refresh_dam_search_style_group_document(v_new_group); end if;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.refresh_dam_search_style_group_document(p_style_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dam', 'extensions'
AS $function$
declare v_text text; v_hash text;
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
  insert into public.dam_search_documents(document_type,entity_id,style_group_id,title,path,customer,program,search_text,
    content_sha256,metadata,source_updated_at,indexed_at)
  select 'style_group',sg.id,sg.id,coalesce(sg.sku,''),coalesce(sg.folder_path,''),sg.customer,sg.program,v_text,v_hash,
    jsonb_strip_nulls(jsonb_build_object('asset_count',sg.asset_count,'workflow_status',sg.workflow_status,
      'is_licensed',sg.is_licensed,'licensor_name',sg.licensor_name,'property_name',sg.property_name,
      'product_category',sg.product_category,'item_description_source',sg.item_description_source,
      'group_ai_description_source',sg.group_ai_description_source,'group_ai_description_model',sg.group_ai_description_model,
      'rich_metadata_source',sg.rich_metadata_source,'thumbnail_url',sg.primary_thumbnail_url)),
    greatest(coalesce(sg.updated_at,'-infinity'),coalesce(sg.latest_file_date,'-infinity')),now()
  from public.style_groups sg where sg.id=p_style_group_id
  on conflict(document_type,entity_id) do update set style_group_id=excluded.style_group_id,title=excluded.title,path=excluded.path,
    customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,content_sha256=excluded.content_sha256,
    metadata=excluded.metadata,source_updated_at=excluded.source_updated_at,indexed_at=now(),
    embedding=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding end,
    embedding_model=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_model end,
    embedding_updated_at=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_updated_at end,
    embedding_error=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null,embedding_next_retry_at=null;
end $function$;

CREATE OR REPLACE FUNCTION public.propagate_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 100)
 RETURNS TABLE(next_cursor uuid, propagated integer, skipped integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '0'
AS $function$
declare
  v_next_cursor uuid;
  v_total_propagated integer := 0;
  v_group_count integer := 0;
  v_batch_propagated integer;
  v_file_specific_tags text[] := array[
    'art_piece','art piece','product','product shot','product photo',
    'packaging','package','tech_pack','tech pack','technical pack',
    'photography','photo','mockup','mock up','mock-up',
    'front view','back view','side view','flat lay','flatlay',
    'render','3d render'
  ];
begin
  for v_next_cursor in
    select sg.id
    from public.style_groups sg
    where (p_cursor is null or sg.id > p_cursor)
    order by sg.id
    limit p_batch_size
  loop
    v_group_count := v_group_count + 1;

    with source_asset as (
      select a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      from public.assets a
      where a.style_group_id = v_next_cursor
        and a.is_deleted = false
        and a.ai_tagged_at is not null
      order by a.primary_sort_tier asc, a.ai_tagged_at asc
      limit 1
    ),
    source_tags as (
      select at2.tag
      from public.asset_tags at2
      join source_asset sa on sa.id = at2.asset_id
      where at2.source = 'ai'
        and at2.category = 'legacy_unscoped'
        and at2.status = 'active'
        and lower(trim(at2.tag)) != all(v_file_specific_tags)
    ),
    source_chars as (
      select ac.character_id
      from public.asset_characters ac
      join source_asset sa on sa.id = ac.asset_id
    ),
    source_licensor_chars as (
      select alc.character_id, alc.source, alc.model
      from public.asset_licensor_characters alc
      join source_asset sa on sa.id = alc.asset_id
    ),
    siblings as (
      select a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      from public.assets a
      cross join source_asset sa
      where a.style_group_id = v_next_cursor
        and a.is_deleted = false
        and a.id != sa.id
    ),
    inserted_tags as (
      insert into public.asset_tags (asset_id, tag, source, category, status)
      select s.id, st.tag, 'ai', 'legacy_unscoped', 'active'
      from siblings s
      cross join source_tags st
      on conflict (asset_id, tag) do nothing
      returning 1
    ),
    inserted_chars as (
      insert into public.asset_characters (asset_id, character_id)
      select s.id, sc.character_id
      from siblings s
      cross join source_chars sc
      on conflict (asset_id, character_id) do nothing
      returning 1
    ),
    inserted_licensor_chars as (
      insert into public.asset_licensor_characters (asset_id, character_id, source, model)
      select s.id, slc.character_id, slc.source, slc.model
      from siblings s
      cross join source_licensor_chars slc
      on conflict (asset_id, character_id) do nothing
      returning 1
    ),
    meta_updates as (
      update public.assets a
      set
        licensor_id = coalesce(a.licensor_id, sa.licensor_id),
        property_id = coalesce(a.property_id, sa.property_id),
        is_licensed = case when a.is_licensed = true then true else coalesce(sa.is_licensed, a.is_licensed) end,
        big_theme = coalesce(a.big_theme, sa.big_theme),
        little_theme = coalesce(a.little_theme, sa.little_theme),
        design_style = coalesce(a.design_style, sa.design_style),
        cover_description = coalesce(a.cover_description, sa.cover_description)
      from source_asset sa, siblings s
      where a.id = s.id
        and (
          (a.licensor_id is null and sa.licensor_id is not null) or
          (a.property_id is null and sa.property_id is not null) or
          (a.is_licensed is not true and sa.is_licensed = true) or
          (a.big_theme is null and sa.big_theme is not null) or
          (a.little_theme is null and sa.little_theme is not null) or
          (a.design_style is null and sa.design_style is not null) or
          (a.cover_description is null and sa.cover_description is not null)
        )
      returning 1
    )
    select
      (select count(*)::integer from inserted_tags)
      + (select count(*)::integer from inserted_chars)
      + (select count(*)::integer from inserted_licensor_chars)
    into v_batch_propagated;

    v_total_propagated := v_total_propagated + coalesce(v_batch_propagated, 0);
  end loop;

  return query select
    v_next_cursor,
    v_total_propagated,
    0::integer,
    (v_group_count < p_batch_size);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 5, p_min_group_size integer DEFAULT 50)
 RETURNS TABLE(next_cursor uuid, groups_processed integer, tags_deleted integer, characters_deleted integer, metadata_cleared integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_group record;
  v_groups_processed int := 0;
  v_tags_deleted int := 0;
  v_chars_deleted int := 0;
  v_meta_cleared int := 0;
  v_last_id uuid;
  v_group_count int := 0;
  v_batch_tags int;
  v_batch_chars int;
  v_batch_meta int;
BEGIN
  FOR v_group IN
    SELECT sg.id
    FROM style_groups sg
    WHERE sg.asset_count >= p_min_group_size
      AND (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;
    v_last_id := v_group.id;

    -- 1) Delete contaminated tags from NON-directly-tagged assets (ai_tagged_at IS NULL)
    --    These assets only have propagated tags — delete all AI tags.
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_tags_null AS (
      DELETE FROM asset_tags at
      USING non_tagged_assets nta
      WHERE at.asset_id = nta.id
        AND at.source = 'ai'
      RETURNING 1
    ),
    -- 2) Delete contaminated tags from DIRECTLY-tagged assets
    --    Keep tags created within 5 min of ai_tagged_at; delete the rest.
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    ),
    del_tags_late AS (
      DELETE FROM asset_tags at
      USING tagged_assets ta
      WHERE at.asset_id = ta.id
        AND at.source = 'ai'
        AND at.created_at > ta.ai_tagged_at + interval '5 minutes'
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM del_tags_null) + (SELECT count(*) FROM del_tags_late)
    INTO v_batch_tags;

    v_tags_deleted := v_tags_deleted + COALESCE(v_batch_tags, 0);

    -- 3) Delete contaminated asset_characters (same logic)
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_chars_null AS (
      DELETE FROM asset_characters ac
      USING non_tagged_assets nta
      WHERE ac.asset_id = nta.id
      RETURNING 1
    ),
    del_licensor_chars_null AS (
      DELETE FROM asset_licensor_characters alc
      USING non_tagged_assets nta
      WHERE alc.asset_id = nta.id
      RETURNING 1
    ),
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    )
    SELECT (SELECT count(*) FROM del_chars_null) + (SELECT count(*) FROM del_licensor_chars_null)
    INTO v_batch_chars;

    v_chars_deleted := v_chars_deleted + COALESCE(v_batch_chars, 0);

    -- 4) Clear propagated metadata on non-tagged assets
    WITH cleared AS (
      UPDATE assets a
      SET
        big_theme = NULL,
        little_theme = NULL,
        design_style = NULL,
        cover_description = NULL
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
        AND (a.big_theme IS NOT NULL OR a.little_theme IS NOT NULL
             OR a.design_style IS NOT NULL OR a.cover_description IS NOT NULL)
      RETURNING 1
    )
    SELECT count(*) INTO v_batch_meta FROM cleared;

    v_meta_cleared := v_meta_cleared + COALESCE(v_batch_meta, 0);
    v_groups_processed := v_groups_processed + 1;
  END LOOP;

  RETURN QUERY SELECT
    v_last_id,
    v_groups_processed,
    v_tags_deleted,
    v_chars_deleted,
    v_meta_cleared,
    (v_group_count < p_batch_size);
END;
$function$;
