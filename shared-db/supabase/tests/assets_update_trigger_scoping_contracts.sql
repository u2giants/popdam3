-- #5609: execute against an ephemeral database only; all synthetic rows roll back.
-- ctid (not xmin or now()) distinguishes rewrites inside one transaction.
begin;
do $$
declare
  ga uuid := gen_random_uuid(); gb uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  suffix text := txid_current()::text;
  doc_tid tid; group_tid tid; b_tid tid; old_hash text;
  n text; col text; val text; before_count bigint;
begin
  insert into public.admin_config(key,value) values('IMAGE_EMBED_ENABLED','true')
  on conflict(key) do update set value=excluded.value;
  insert into public.style_groups(id,sku,folder_path)
  values(ga,'ZZ5609-A-'||suffix,'ZZ5609/A'),(gb,'ZZ5609-B-'||suffix,'ZZ5609/B');
  insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,
                            style_group_id,thumbnail_url,asset_type,designer_name)
  values(a,'zz5609-a.ai','ZZ5609/A/a.ai','ai','zz5609-a-'||suffix,now(),ga,'https://fixture.invalid/a.jpg','art_piece','A'),
        (b,'zz5609-b.ai','ZZ5609/A/b.ai','ai','zz5609-b-'||suffix,now(),ga,null,'art_piece','B'),
        (c,'zz5609-c.ai','ZZ5609/B/c.ai','ai','zz5609-c-'||suffix,now(),gb,null,'art_piece',null);
  -- R7/R16: INSERT retains search and primary selection.
  if not exists(select 1 from public.dam_search_documents where entity_id=a and document_type='asset')
     or (select primary_asset_id from public.style_groups where id=ga) is distinct from a then
    raise exception 'INSERT search/primary behavior lost';
  end if;

  -- R13: set every ingester search column to itself; only scan timestamp changes.
  select ctid into doc_tid from public.dam_search_documents where document_type='asset' and entity_id=a;
  select ctid into group_tid from public.style_groups where id=ga;
  update public.assets set filename=filename,relative_path=relative_path,
    content_type=content_type,cover_description=cover_description,ai_description=ai_description,
    scene_description=scene_description,customer=customer,program=program,
    licensor_name=licensor_name,property_name=property_name,product_category=product_category,
    product_material=product_material,product_dimensions=product_dimensions,
    thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
    asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
    style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
    designer_name=designer_name,technical_designer_name=technical_designer_name,
    freelancer_name=freelancer_name,last_seen_at=clock_timestamp() where id=a;
  if doc_tid is distinct from (select ctid from public.dam_search_documents where document_type='asset' and entity_id=a)
     or group_tid is distinct from (select ctid from public.style_groups where id=ga) then
    raise exception 'no-op PATCH rewrote derived search/group tuples';
  end if;

  -- Catalog checks follow the behavior check so the old definition fails R13.
  foreach n in array array['trg_dam_search_assets_refresh','trg_sync_primary_on_thumbnail',
      'trg_sync_designer_to_style_group','trg_sync_cover_description_to_style_group','trg_auto_queue_render'] loop
    if not exists(select 1 from pg_trigger where tgrelid='public.assets'::regclass
      and tgname=n and tgtype=17 and tgqual is not null and tgenabled='O'
      and pg_get_triggerdef(oid) ilike '%IS DISTINCT FROM%') then
      raise exception 'missing enabled value-scoped update trigger %',n;
    end if;
    if not exists(select 1 from pg_trigger where tgrelid='public.assets'::regclass
      and tgname=n||'_ins_del' and tgtype=case when n='trg_dam_search_assets_refresh' then 13 else 5 end
      and tgqual is null and tgenabled='O') then
      raise exception 'missing preserved INSERT/DELETE sibling %',n;
    end if;
  end loop;

  -- R1 and NULL-safe search dependencies, including the three formerly missing.
  update public.assets set filename='zz5609-renamed.ai' where id=a;
  if (select title from public.dam_search_documents where document_type='asset' and entity_id=a) <> 'zz5609-renamed.ai' then
    raise exception 'rename did not refresh title';
  end if;
  foreach col in array array['content_type','product_material','product_dimensions'] loop
    select ctid into doc_tid from public.dam_search_documents where document_type='asset' and entity_id=a;
    execute format('update public.assets set %1$I=%1$I where id=$1',col) using a;
    if doc_tid is distinct from (select ctid from public.dam_search_documents where document_type='asset' and entity_id=a) then
      raise exception 'NULL no-op refreshed %',col;
    end if;
    val := case col when 'product_material' then 'ARRAY[''fixture material'']::text[]'
      when 'content_type' then quote_literal('source_art') else quote_literal('fixture '||col) end;
    execute format('update public.assets set %I=%s where id=$1',col,val) using a;
    if doc_tid is not distinct from (select ctid from public.dam_search_documents where document_type='asset' and entity_id=a)
       or not (select metadata ? col from public.dam_search_documents where document_type='asset' and entity_id=a) then
      raise exception 'new metadata dependency did not refresh %',col;
    end if;
  end loop;
  -- R2: path and any customer/program derived by BEFORE triggers are final values.
  update public.assets set relative_path='ZZ5609/Customer/Program/renamed.ai' where id=a;
  if exists(select 1 from public.assets x join public.dam_search_documents d on d.entity_id=x.id and d.document_type='asset'
    where x.id=a and (d.path is distinct from x.relative_path or d.customer is distinct from x.customer or d.program is distinct from x.program)) then
    raise exception 'BEFORE-derived path attributes missing from search';
  end if;
  -- R4: an ungrouped asset uses its own licensed names in text and metadata.
  insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at)
  values(d,'zz5609-d.ai','ZZ5609/D/d.ai','ai','zz5609-d-'||suffix,now());
  select content_sha256 into old_hash from public.dam_search_documents where entity_id=d and document_type='asset';
  update public.assets set licensor_name='ZZ5609 licensor',property_name='ZZ5609 property' where id=d;
  if not exists(select 1 from public.dam_search_documents where entity_id=d and document_type='asset'
    and metadata->>'licensor_name'='ZZ5609 licensor' and metadata->>'property_name'='ZZ5609 property'
    and search_text like '%ZZ5609 licensor%' and content_sha256 is distinct from old_hash) then
    raise exception 'licensing metadata did not refresh';
  end if;

  -- R7: a thumbnail appearing on an EXISTING asset can fill an empty primary.
  update public.style_groups set primary_asset_id=null,primary_thumbnail_url=null where id=gb;
  update public.assets set thumbnail_url='https://fixture.invalid/appeared.jpg' where id=c;
  if (select primary_asset_id from public.style_groups where id=gb) is distinct from c then
    raise exception 'existing asset thumbnail appearance failed primary selection';
  end if;

  -- R8/R10: primary cache tracks thumbnail-only errors and changed URLs.
  update public.assets set thumbnail_error='fixture error' where id=a;
  if (select primary_thumbnail_error from public.style_groups where id=ga) <> 'fixture error' then
    raise exception 'primary thumbnail error not synchronized';
  end if;
  select ctid into group_tid from public.style_groups where id=ga;
  update public.assets set thumbnail_error=thumbnail_error where id=a;
  if group_tid is distinct from (select ctid from public.style_groups where id=ga) then raise exception 'thumbnail no-op rewrote group'; end if;
  update public.assets set thumbnail_url='https://fixture.invalid/changed.jpg' where id=a;
  if (select primary_thumbnail_url from public.style_groups where id=ga) <> 'https://fixture.invalid/changed.jpg' then
    raise exception 'primary thumbnail URL not synchronized';
  end if;
  if dam.image_embed_enabled() and not exists(select 1 from dam.image_embed_jobs where asset_id=a and kind='index') then
    raise exception 'thumbnail change did not enqueue image embedding';
  end if;
  -- R9: render enqueue preserved, including filename-only change from junk.
  update public.assets set thumbnail_error='fixture render',thumbnail_url=null where id=b;
  if not exists(select 1 from public.render_queue where asset_id=b and status='pending') then
    raise exception 'render enqueue lost';
  end if;
  select count(*) into before_count from public.render_queue where asset_id=b;
  update public.assets set thumbnail_error=thumbnail_error,thumbnail_url=thumbnail_url where id=b;
  if before_count <> (select count(*) from public.render_queue where asset_id=b) then raise exception 'render no-op duplicated queue'; end if;
  -- R11: designer aggregate includes active assets only.
  update public.assets set designer_name='C' where id=b;
  if not (select designer_conflict from public.style_groups where id=ga) then raise exception 'designer conflict missing'; end if;
  select ctid into group_tid from public.style_groups where id=ga;
  update public.assets set technical_designer_name=null,freelancer_name=null where id=b;
  if group_tid is distinct from (select ctid from public.style_groups where id=ga) then raise exception 'NULL designer no-op rewrote group'; end if;
  update public.assets set technical_designer_name='fixture tech',freelancer_name='fixture freelance' where id=b;
  if (select technical_designer_name from public.style_groups where id=ga) <> 'fixture tech' then raise exception 'NULL-to-value designer not synced'; end if;
  update public.assets set is_deleted=true where id=b;
  if (select designer_conflict from public.style_groups where id=ga) then raise exception 'deleted designer still in aggregate'; end if;
  -- R5: soft-delete/revive search and effective tags retain original triggers.
  if exists(select 1 from public.dam_search_documents where entity_id=b and document_type='asset') then raise exception 'soft-delete left document'; end if;
  update public.assets set is_deleted=false where id=b;
  if not exists(select 1 from public.dam_search_documents where entity_id=b and document_type='asset') then raise exception 'revive missing document'; end if;
  -- R12: primary and fallback cover description.
  update public.assets set cover_description='fixture cover' where id=a;
  if (select cover_description from public.style_groups where id=ga) <> 'fixture cover' then raise exception 'cover description not synced'; end if;
  select ctid into group_tid from public.style_groups where id=ga;
  update public.assets set cover_description=cover_description where id=a;
  if group_tid is distinct from (select ctid from public.style_groups where id=ga) then raise exception 'cover no-op rewrote group'; end if;
  update public.assets set cover_description='fallback cover' where id=b;
  update public.assets set cover_description=null where id=a;
  if (select cover_description from public.style_groups where id=ga) <> 'fallback cover' then raise exception 'fallback cover not synced'; end if;
  -- Other existing triggers repick a deleted primary; fallback must still flow.
  update public.assets set cover_description='fixture primary retained' where id=a;
  update public.assets set is_deleted=true where id=a;
  if (select cover_description from public.style_groups where id=ga) <> 'fallback cover' then raise exception 'deleted primary did not fall back'; end if;
  update public.assets set is_deleted=false where id=a;
  -- R6: regroup refreshes both aggregate search documents.
  update public.assets set style_group_id=gb where id=b;
  if (select style_group_id from public.dam_search_documents where entity_id=b and document_type='asset') is distinct from gb
     or (select asset_count from public.style_groups where id=ga) <> 1
     or (select asset_count from public.style_groups where id=gb) <> 2 then raise exception 'regroup projection/counts incorrect'; end if;
  -- R15: only actually changed rows in a multi-row update rewrite documents.
  select ctid into b_tid from public.dam_search_documents where entity_id=b and document_type='asset';
  select ctid into doc_tid from public.dam_search_documents where entity_id=c and document_type='asset';
  update public.assets set filename=case when id=c then 'zz5609-multi.ai' else filename end,last_seen_at=clock_timestamp() where id in(a,b,c);
  if b_tid is distinct from (select ctid from public.dam_search_documents where entity_id=b and document_type='asset')
     or doc_tid is not distinct from (select ctid from public.dam_search_documents where entity_id=c and document_type='asset') then
    raise exception 'multi-row update did not isolate changed document';
  end if;
  -- R16: hard DELETE still removes the document.
  delete from public.assets where id=c;
  if exists(select 1 from public.dam_search_documents where entity_id=c and document_type='asset') then raise exception 'hard-delete left document'; end if;
end;
$$;
rollback;
