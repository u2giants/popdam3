-- popcre/shared-db#6995 (stage C2 of u2giants/popdam3#1298; plan_shared_data_no_copies_db.md)
-- Re-issue of parked 20261225091203 (PR #7024): identical executable SQL, corrected derived-from.
-- derived-from: 20261204003429, 20261105074126
-- PopDAM image character tags (public.asset_characters) stop pointing at
-- PopDAM's own list (public.characters) and point at the shared core.character,
-- through the reviewed map dam.character_core_map built in C1 (#6994).
--
--   1. full snapshot  -> archive.asset_characters_before_core_character_20261124
--   2. links whose PopDAM character has no map row are deleted (kept in the archive)
--   3. links that collapse onto the same (asset, core character) keep one row
--   4. character_id becomes core.character.id (batches of 20,000 rows)
--   5. FK -> core.character(id) on delete cascade (same as asset_licensor_characters)
--   6. dam.character_usage carries PopDAM's usage_count / is_priority per core character
--   7. search builders join asset_characters to core.character, not public.characters
--   8. search documents whose character text changed are rebuilt
--
-- public.characters / properties / licensors / dam_character_catalog stay (C4).
-- Rollback: restore public.asset_characters from the archive table and put the
-- FK back to public.characters(id); drop dam.character_usage.

-- 1. Snapshot (full copy, before anything changes).
create table archive.asset_characters_before_core_character_20261124 as
  select * from public.asset_characters;
alter table archive.asset_characters_before_core_character_20261124
  add primary key (asset_id, character_id);
revoke all on archive.asset_characters_before_core_character_20261124 from public, anon, authenticated;
comment on table archive.asset_characters_before_core_character_20261124 is
  'public.asset_characters before the core.character re-point (popcre/shared-db#6995). Rollback source.';

-- The per-statement search refresh triggers would rebuild every tagged asset
-- (~21k) inside this migration; step 8 rebuilds only documents whose text changed.
alter table public.asset_characters disable trigger asset_characters_dam_search_refresh_ins;
alter table public.asset_characters disable trigger asset_characters_dam_search_refresh_upd;
alter table public.asset_characters disable trigger asset_characters_dam_search_refresh_del;

alter table public.asset_characters drop constraint asset_characters_character_id_fkey;

-- 2. Unmapped links (still in the archive).
delete from public.asset_characters ac
where not exists (select 1 from dam.character_core_map m where m.public_character_id = ac.character_id);

-- 3. Collapse links that map to the same core character on the same asset.
delete from public.asset_characters ac
using dam.character_core_map m, public.asset_characters ac2, dam.character_core_map m2
where m.public_character_id = ac.character_id
  and ac2.asset_id = ac.asset_id
  and m2.public_character_id = ac2.character_id
  and m2.core_character_id = m.core_character_id
  and ac2.character_id < ac.character_id;

-- 4. Re-point in batches. core.character ids and public.characters ids never
--    overlap (checked on production 2026-11-24), so a remapped row is never re-read.
do $$
declare v_rows integer;
begin
  if exists (select 1 from public.characters pc join core.character c on c.id = pc.id) then
    raise exception 'C2: public.characters and core.character share ids; remap would be ambiguous';
  end if;
  loop
    with b as (
      select ac.asset_id, ac.character_id, m.core_character_id
      from public.asset_characters ac
      join dam.character_core_map m on m.public_character_id = ac.character_id
      limit 20000
    )
    update public.asset_characters ac
       set character_id = b.core_character_id
      from b
     where ac.asset_id = b.asset_id and ac.character_id = b.character_id;
    get diagnostics v_rows = row_count;
    exit when v_rows = 0;
  end loop;
end $$;

-- 5. New FK.
alter table public.asset_characters
  add constraint asset_characters_character_id_fkey
  foreign key (character_id) references core.character (id) on delete cascade;
create index if not exists asset_characters_character_id_idx on public.asset_characters (character_id);
comment on column public.asset_characters.character_id is
  'core.character.id (popcre/shared-db#6995). Before 2026-11-24 this held public.characters.id.';

alter table public.asset_characters enable trigger asset_characters_dam_search_refresh_ins;
alter table public.asset_characters enable trigger asset_characters_dam_search_refresh_upd;
alter table public.asset_characters enable trigger asset_characters_dam_search_refresh_del;

-- 6. PopDAM usage counters per core character.
create table dam.character_usage (
  core_character_id uuid primary key references core.character (id) on delete cascade,
  usage_count integer not null default 0,
  is_priority boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table dam.character_usage is
  'PopDAM character usage_count / is_priority keyed by core.character (popcre/shared-db#6995); replaces public.characters columns.';
alter table dam.character_usage enable row level security;
revoke all on dam.character_usage from public, anon, authenticated;
grant select on dam.character_usage to authenticated;
grant all on dam.character_usage to service_role;
create policy character_usage_read on dam.character_usage
  for select to authenticated using (true);

insert into dam.character_usage (core_character_id, usage_count, is_priority)
select m.core_character_id,
       least(sum(coalesce(pc.usage_count, 0)), 2147483647)::integer,
       coalesce(bool_or(pc.is_priority), false)
from dam.character_core_map m
join public.characters pc on pc.id = m.public_character_id
group by m.core_character_id;

-- 7. Search builders: asset_characters now joins core.character.
--    Bodies are the production definitions (2026-11-24) with only that join changed.
CREATE OR REPLACE FUNCTION dam.search_text_embedding_input(p_document_type text, p_entity_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lines text[];
  v_path text;
  v_parts text[];
  v_n integer;
  v_out text;
begin
  if p_document_type = 'style_group' then
    select array[
        'Product type: ' || nullif(concat_ws(', ', variadic array(
          select distinct on (lower(btrim(x))) btrim(x)
            from unnest(array[sg.product_category, sg.mg01_name, sg.mg02_name, sg.mg03_name]) with ordinality u(x, o)
           where nullif(btrim(x), '') is not null
           order by lower(btrim(x)), o)), ''),
        'Item description: ' || nullif(btrim(sg.item_description), ''),
        'Cover description: ' || nullif(btrim(sg.cover_description), ''),
        'AI description: ' || nullif(btrim(sg.group_ai_description), ''),
        'Licensor: ' || nullif(btrim(sg.licensor_name), ''),
        'Property: ' || nullif(btrim(sg.property_name), ''),
        'Characters: ' || nullif(ch.names, ''),
        'Customer: ' || nullif(btrim(sg.customer), ''),
        'Program: ' || nullif(btrim(sg.program), '')],
      sg.folder_path
      into v_lines, v_path
      from public.style_groups sg
      left join lateral (
        select string_agg(n.name, ', ' order by n.k) names
          from (select distinct on (lower(btrim(c.name))) lower(btrim(c.name)) k, btrim(c.name) name
                  from (select pc.name from public.assets a
                          join public.asset_characters ac on ac.asset_id = a.id
                          join core.character pc on pc.id = ac.character_id
                         where a.style_group_id = sg.id and not a.is_deleted
                        union all
                        select lc.name from public.assets a
                          join public.asset_licensor_characters alc on alc.asset_id = a.id
                          join core.character lc on lc.id = alc.character_id
                         where a.style_group_id = sg.id and not a.is_deleted) c
                 where nullif(btrim(c.name), '') is not null
                 order by lower(btrim(c.name)), btrim(c.name)) n) ch on true
     where sg.id = p_entity_id;
    if not found then return null; end if;
  elsif p_document_type = 'asset' then
    -- Only fields that also feed the asset's search_text (enqueue invariant).
    select array[
        'Product type: ' || nullif(btrim(a.product_category), ''),
        'Item description: ' || nullif(btrim(sg.item_description), ''),
        'Cover description: ' || nullif(btrim(a.cover_description), ''),
        'AI description: ' || nullif(btrim(coalesce(nullif(btrim(a.ai_description), ''), sg.group_ai_description)), ''),
        'Licensor: ' || nullif(btrim(case when a.style_group_id is null then a.licensor_name else sg.licensor_name end), ''),
        'Property: ' || nullif(btrim(case when a.style_group_id is null then a.property_name else sg.property_name end), ''),
        'Characters: ' || nullif(ch.names, ''),
        'Customer: ' || nullif(btrim(a.customer), ''),
        'Program: ' || nullif(btrim(a.program), '')],
      -- Folders only: drop the file name when the path ends with it.
      case when a.filename is not null
                and right(regexp_replace(coalesce(a.relative_path, ''), '[/\\]+$', ''), length(a.filename)) = a.filename
           then left(regexp_replace(a.relative_path, '[/\\]+$', ''),
                     length(regexp_replace(a.relative_path, '[/\\]+$', '')) - length(a.filename))
           else a.relative_path end
      into v_lines, v_path
      from public.assets a
      left join public.style_groups sg on sg.id = a.style_group_id
      left join lateral (
        select string_agg(n.name, ', ' order by n.k) names
          from (select distinct on (lower(btrim(c.name))) lower(btrim(c.name)) k, btrim(c.name) name
                  from (select pc.name from public.asset_characters ac
                          join core.character pc on pc.id = ac.character_id
                         where ac.asset_id = a.id
                        union all
                        select lc.name from public.asset_licensor_characters alc
                          join core.character lc on lc.id = alc.character_id
                         where alc.asset_id = a.id) c
                 where nullif(btrim(c.name), '') is not null
                 order by lower(btrim(c.name)), btrim(c.name)) n) ch on true
     where a.id = p_entity_id and not a.is_deleted;
    if not found then return null; end if;
  else
    return null;
  end if;

  -- Last four folders, separators turned into spaces.
  v_parts := array_remove(regexp_split_to_array(coalesce(v_path, ''), '[/\\]+'), '');
  v_n := coalesce(array_length(v_parts, 1), 0);
  if v_n > 0 then
    v_lines := v_lines || ('Folders: ' || array_to_string(v_parts[greatest(1, v_n - 3):v_n], ' '));
  end if;

  select string_agg(regexp_replace(btrim(l), '\s+', ' ', 'g'), E'\n' order by o)
    into v_out
    from unnest(v_lines) with ordinality u(l, o)
   where l is not null and btrim(l) <> '';
  -- Model input limit (Step 0): keep under about 2,000 characters.
  return nullif(btrim(left(v_out, 2000)), '');
end;
$function$
;

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
    from (select c.id,c.name from public.asset_characters ac join core.character c on c.id=ac.character_id where ac.asset_id=a.id
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
    join public.asset_characters ac on ac.asset_id=a.id join core.character c on c.id=ac.character_id
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

-- 8. Rebuild search documents whose character text changed: assets that lost
--    an unmapped link, or whose core name differs from the PopDAM name.
do $$
declare
  v_assets uuid[];
  v_groups uuid[];
  v_chunk uuid[];
  i integer := 1;
begin
  select coalesce(array_agg(distinct x.asset_id), '{}') into v_assets
  from archive.asset_characters_before_core_character_20261124 x
  left join dam.character_core_map m on m.public_character_id = x.character_id
  left join public.characters pc on pc.id = x.character_id
  left join core.character c on c.id = m.core_character_id
  where m.public_character_id is null
     or lower(btrim(pc.name)) is distinct from lower(btrim(c.name));

  select coalesce(array_agg(distinct a.style_group_id), '{}') into v_groups
  from public.assets a where a.id = any(v_assets) and a.style_group_id is not null;

  while i <= coalesce(cardinality(v_assets), 0) loop
    v_chunk := v_assets[i:i + 499];
    perform public.refresh_dam_search_documents_batch(v_chunk, '{}', 500);
    i := i + 500;
  end loop;
  i := 1;
  while i <= coalesce(cardinality(v_groups), 0) loop
    v_chunk := v_groups[i:i + 499];
    perform public.refresh_dam_search_documents_batch('{}', v_chunk, 500);
    i := i + 500;
  end loop;
end $$;
