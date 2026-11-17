-- Contracts for 20261204001000_dam_search_text_vectors.sql (claim #6605,
-- application u2giants/popdam3#1037 Step 3). Writes inside one transaction
-- and rolls back.
--
-- Pinned:
--   1. Text vectors survive a thumbnail change; picture vectors survive a
--      description change (D5): independent storage, independent queue.
--   2. A search_text change that leaves the embedding input identical
--      enqueues nothing; a description change enqueues exactly one job.
--   3. Claim -> upsert round trip (service-role actor) writes one vector with
--      the admin_config model stamp and removes the job; a stale lease, wrong
--      model or wrong dimension is refused cleanly.
--   4. Empty input is marked permanent at claim time, never returned.
--   5. anon / authenticated cannot read dam.search_text_vectors or execute
--      the four RPCs; dam_image_embed_worker can execute all four.
--   6. Deleting a search document cascades its vector and job (FKs also
--      cascade key moves, which popdam_dense_group_vectors_contracts performs).

begin;

do $contract$
declare
  v_sg uuid := gen_random_uuid();
  v_empty uuid := gen_random_uuid();
  v_model text := (select value #>> '{}' from public.admin_config where key = 'SEARCH_TEXT_EMBEDDING_MODEL');
  v_vec text := '[' || array_to_string(array_fill(0.03125::real, array[1024]), ',') || ']';
  v_pic text := '[' || array_to_string(array_fill(0.036::real, array[768]), ',') || ']';
  r record;
  v_ok boolean;
  v_n integer;
  f text;
begin
  if v_model is distinct from 'Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3' then
    raise exception 'CONTRACT FAILED: SEARCH_TEXT_EMBEDDING_MODEL is %', v_model;
  end if;

  -- 5. privileges
  foreach f in array array[
    'public.claim_dam_search_text_embedding_documents(integer, text, integer)',
    'public.upsert_dam_search_text_embedding(text, uuid, text, uuid, extensions.halfvec, text)',
    'public.mark_dam_search_text_embedding_error(text, uuid, text, uuid, text, text)',
    'public.get_dam_search_text_embedding_status()'] loop
    if not has_function_privilege('dam_image_embed_worker', f, 'execute') then
      raise exception 'CONTRACT FAILED: worker lacks execute on %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'CONTRACT FAILED: browser role may execute %', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'dam.search_text_vectors', 'select')
     or has_table_privilege('authenticated', 'dam.search_text_vectors', 'select')
     or has_table_privilege('authenticated', 'dam.search_text_embed_jobs', 'select') then
    raise exception 'CONTRACT FAILED: browser role can read text-vector tables';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'dam.search_text_vectors'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'dam.search_text_embed_jobs'::regclass) then
    raise exception 'CONTRACT FAILED: row-level security is off';
  end if;

  -- Fixture: one style group with text, one with nothing to embed.
  -- A style_groups trigger may already create the search documents; upsert them.
  insert into public.style_groups(id, sku, item_description, licensor_name, folder_path)
  values (v_sg, 'CONTRACT-TV-' || v_sg, 'Contract fixture pink frame', 'Contract Licensor', '/a/b/c/d/e/f');
  insert into public.style_groups(id, sku, folder_path) values (v_empty, 'CONTRACT-TV-' || v_empty, '');
  insert into public.dam_search_documents(document_type, entity_id, style_group_id, title, path, search_text, content_sha256, metadata)
  values ('style_group', v_sg, v_sg, '', '', 'fixture text', repeat('a', 64), '{"thumbnail_url":"https://example.invalid/1.png"}'),
         ('style_group', v_empty, v_empty, '', '', 'fixture empty', repeat('b', 64), '{}')
  on conflict (document_type, entity_id) do update
     set search_text = excluded.search_text, metadata = excluded.metadata;

  if not exists (select 1 from dam.search_text_embed_jobs where document_type = 'style_group' and entity_id = v_sg) then
    raise exception 'CONTRACT FAILED: insert did not enqueue a text job';
  end if;
  if dam.search_text_embedding_input('style_group', v_sg) <> E'Item description: Contract fixture pink frame\nLicensor: Contract Licensor\nFolders: c d e f' then
    raise exception 'CONTRACT FAILED: unexpected input text %', dam.search_text_embedding_input('style_group', v_sg);
  end if;
  if length(dam.search_text_embedding_input('style_group', v_sg)) > 2000 then
    raise exception 'CONTRACT FAILED: input over 2,000 characters';
  end if;

  -- Only fixture jobs are claimable for the rest of this transaction.
  update dam.search_text_embed_jobs set next_retry_at = now() + interval '1 day'
   where entity_id not in (v_sg, v_empty);

  -- 3/4. claim (privileges are pinned above; the CI runner cannot SET ROLE)
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into r from public.claim_dam_search_text_embedding_documents(10, 'contract', 60) c where c.entity_id = v_sg;
  if r.entity_id is null or r.model <> v_model or r.input_text is null then
    raise exception 'CONTRACT FAILED: claim did not return the fixture';
  end if;
  begin
    perform public.upsert_dam_search_text_embedding('style_group', v_sg, r.input_sha256, r.lease_token, v_vec::extensions.halfvec, 'other-model');
    raise exception 'CONTRACT FAILED: wrong model accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.upsert_dam_search_text_embedding('style_group', v_sg, r.input_sha256, r.lease_token, '[1,2,3]'::extensions.halfvec, v_model);
    raise exception 'CONTRACT FAILED: wrong dimension accepted';
  exception when invalid_parameter_value then null;
  end;
  if public.upsert_dam_search_text_embedding('style_group', v_sg, r.input_sha256, gen_random_uuid(), v_vec::extensions.halfvec, v_model) then
    raise exception 'CONTRACT FAILED: foreign lease accepted';
  end if;
  if not public.upsert_dam_search_text_embedding('style_group', v_sg, r.input_sha256, r.lease_token, v_vec::extensions.halfvec, v_model) then
    raise exception 'CONTRACT FAILED: valid upsert refused';
  end if;

  if not exists (select 1 from dam.search_text_vectors where entity_id = v_sg and model = v_model and input_sha256 = r.input_sha256)
     or exists (select 1 from dam.search_text_embed_jobs where entity_id = v_sg) then
    raise exception 'CONTRACT FAILED: upsert did not write the vector and clear the job';
  end if;
  if not exists (select 1 from dam.search_text_embed_jobs where entity_id = v_empty and error_category = 'permanent') then
    raise exception 'CONTRACT FAILED: empty input was not marked permanent';
  end if;

  -- 1/2. thumbnail-only change and identical-input search_text change: nothing enqueued
  update public.dam_search_documents set metadata = '{"thumbnail_url":"https://example.invalid/2.png"}',
         embedding = v_pic::extensions.vector
   where document_type = 'style_group' and entity_id = v_sg;
  update public.dam_search_documents set search_text = 'fixture text changed elsewhere'
   where document_type = 'style_group' and entity_id = v_sg;
  if exists (select 1 from dam.search_text_embed_jobs where entity_id = v_sg)
     or not exists (select 1 from dam.search_text_vectors where entity_id = v_sg) then
    raise exception 'CONTRACT FAILED: thumbnail or no-op text change touched the text lane';
  end if;

  -- description change: one job, old text vector kept, picture vector untouched
  update public.style_groups set item_description = 'Contract fixture blue frame' where id = v_sg;
  update public.dam_search_documents set search_text = 'fixture text blue'
   where document_type = 'style_group' and entity_id = v_sg;
  select count(*) into v_n from dam.search_text_embed_jobs where entity_id = v_sg;
  if v_n <> 1 then
    raise exception 'CONTRACT FAILED: description change queued % jobs', v_n;
  end if;
  if not exists (select 1 from public.dam_search_documents where entity_id = v_sg and embedding is not null)
     or not exists (select 1 from dam.search_text_vectors where entity_id = v_sg) then
    raise exception 'CONTRACT FAILED: a description change cleared a vector';
  end if;

  -- 6. cascade
  delete from public.dam_search_documents where entity_id in (v_sg, v_empty);
  if exists (select 1 from dam.search_text_vectors where entity_id = v_sg)
     or exists (select 1 from dam.search_text_embed_jobs where entity_id in (v_sg, v_empty)) then
    raise exception 'CONTRACT FAILED: delete did not cascade';
  end if;
end
$contract$;

rollback;
