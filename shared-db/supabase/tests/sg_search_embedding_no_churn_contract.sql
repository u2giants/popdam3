-- #5758 Steps 3a and 4: the PopSG embedding writers perform ZERO no-op writes.
-- A repeat result, a repeat error, or a repeat reset with every target value
-- already in place must not rewrite the wide, 14-index style_guide_search_documents
-- row (baseline: 197,739 updates, 0% HOT). Rewrite detection is content-based
-- (embedding_updated_at / row jsonb snapshots), because statistics counters lag
-- inside one transaction.
begin;

insert into public.style_guide_files
  (id, root_label, relative_path, directory_path, filename, basename_no_ext,
   file_extension, normalized_name, property_folder, style_guide_folder,
   size_bytes, modified_at, is_active, thumbnail_url, thumbnail_error)
values
  ('57580000-0000-4000-8000-000000000001', 'ZZ5758', 'TestLicensor/NoChurn/one.pdf', 'NoChurn', 'one.pdf', 'one', 'pdf', 'one', 'TestProperty', 'NoChurn', 100, '2026-10-01', true, 'https://example.invalid/one.jpg', null),
  ('57580000-0000-4000-8000-000000000002', 'ZZ5758', 'TestLicensor/NoChurn/two.pdf', 'NoChurn', 'two.pdf', 'two', 'pdf', 'two', 'TestProperty', 'NoChurn', 200, '2026-10-01', true, 'https://example.invalid/two.jpg', null);

insert into public.style_guide_search_documents
  (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
   style_guide_name, directory_path, relative_path, filename, file_extension,
   tag_names, size_bytes, modified_at, thumbnail_url, is_active,
   pdf_text_status, pdf_text_length, source_identity, content_sha256, search_vector)
select f.id, f.root_label, 'TestLicensor', f.property_folder, f.style_guide_folder,
       f.style_guide_folder, f.directory_path, f.relative_path, f.filename,
       f.file_extension, array['zz5758-tag'], f.size_bytes, f.modified_at,
       f.thumbnail_url, f.is_active, null, 0,
       md5(f.relative_path || '|' || f.size_bytes::text),
       encode(extensions.digest(md5(f.relative_path || '|' || f.size_bytes::text) || '|' || coalesce(f.thumbnail_url, ''), 'sha256'), 'hex'),
       to_tsvector('simple', f.filename)
  from public.style_guide_files f where f.root_label = 'ZZ5758';

do $contracts$
declare
  v_token   uuid := gen_random_uuid();
  v_dead    uuid := gen_random_uuid();
  v_vec     extensions.vector := (select ('[' || string_agg('0.05', ',') || ']')::extensions.vector from generate_series(1, 768));
  v_vec2    extensions.vector := (select ('[' || string_agg('0.06', ',') || ']')::extensions.vector from generate_series(1, 768));
  v_file1   uuid := '57580000-0000-4000-8000-000000000001';
  v_file2   uuid := '57580000-0000-4000-8000-000000000002';
  v_sha1    text;
  v_sha2    text;
  v_updated timestamptz;
  v_row     jsonb;
  v_ret     boolean;
  v_count   integer;
begin
  select content_sha256 into v_sha1 from public.style_guide_search_documents where style_guide_file_id = v_file1;
  select content_sha256 into v_sha2 from public.style_guide_search_documents where style_guide_file_id = v_file2;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Step 4: a real claim leases both documents through the narrow job table
  -- and leaves the wide document rows byte-identical.
  select jsonb_agg(to_jsonb(d) order by d.style_guide_file_id) into v_row
    from public.style_guide_search_documents d where style_guide_file_id in (v_file1, v_file2);
  select count(*) into v_count
    from public.claim_sg_search_embedding_documents(p_limit => 1000, p_worker_id => 'zz5758-worker') c
   where c.style_guide_file_id in (v_file1, v_file2);
  if v_count is distinct from 2 then
    raise exception 'contract 0: claim leased % of the two fixture documents', v_count;
  end if;
  if (select jsonb_agg(to_jsonb(d) order by d.style_guide_file_id)
        from public.style_guide_search_documents d where style_guide_file_id in (v_file1, v_file2)) is distinct from v_row then
    raise exception 'contract 0: the lease claim rewrote style_guide_search_documents';
  end if;
  -- Pin a known token so the rest of the contract can use it.
  update public.style_guide_search_embedding_jobs
     set lease_token = v_token
   where style_guide_file_id in (v_file1, v_file2);

  -- 1) A first result writes; a byte-identical repeat under the same lease
  --    writes NOTHING (returns false, row untouched).
  select public.upsert_sg_search_embedding(v_file1, v_sha1, v_token, v_vec) into v_ret;
  if v_ret is distinct from true then
    raise exception 'contract 1: first upsert did not report writing';
  end if;
  select to_jsonb(d) - 'embedding_updated_at' into v_row
    from public.style_guide_search_documents d where style_guide_file_id = v_file1;
  select embedding_updated_at into v_updated from public.style_guide_search_documents where style_guide_file_id = v_file1;
  select public.upsert_sg_search_embedding(v_file1, v_sha1, v_token, v_vec) into v_ret;
  if v_ret is not distinct from true then
    raise exception 'contract 1: repeat upsert reported a write';
  end if;
  if (select embedding_updated_at from public.style_guide_search_documents where style_guide_file_id = v_file1) is distinct from v_updated
     or (select to_jsonb(d) - 'embedding_updated_at' from public.style_guide_search_documents d where style_guide_file_id = v_file1) is distinct from v_row then
    raise exception 'contract 1: repeat upsert rewrote the row (values or updated_at moved)';
  end if;

  -- 2) The same vector under a lease that never existed writes nothing.
  select public.upsert_sg_search_embedding(v_file1, v_sha1, v_dead, v_vec) into v_ret;
  if v_ret is distinct from false then
    raise exception 'contract 2: unknown-lease upsert reported a write';
  end if;
  if (select embedding_updated_at from public.style_guide_search_documents where style_guide_file_id = v_file1) is distinct from v_updated then
    raise exception 'contract 2: unknown-lease upsert moved embedding_updated_at';
  end if;

  -- 3) mark_error under the live lease writes; the SAME error under a dead
  --    lease writes nothing.
  select to_jsonb(d) into v_row from public.style_guide_search_documents d where style_guide_file_id = v_file2;
  select public.mark_sg_search_embedding_error(v_file2, v_sha2, v_token, 'zz5758 boom') into v_ret;
  if v_ret is distinct from true then
    raise exception 'contract 3: first mark_error did not report writing';
  end if;
  if (select to_jsonb(d) from public.style_guide_search_documents d where style_guide_file_id = v_file2) is distinct from v_row then
    raise exception 'contract 3: mark_error rewrote the wide document row (state belongs in the job table)';
  end if;
  if not exists (select 1 from public.style_guide_search_embedding_jobs
                  where style_guide_file_id = v_file2 and error = 'zz5758 boom' and lease_token is null) then
    raise exception 'contract 3: mark_error did not record the error on the job row';
  end if;
  select to_jsonb(d) into v_row from public.style_guide_search_documents d where style_guide_file_id = v_file2;
  select public.mark_sg_search_embedding_error(v_file2, v_sha2, v_dead, 'zz5758 boom') into v_ret;
  if v_ret is distinct from false then
    raise exception 'contract 3: dead-lease mark_error reported a write';
  end if;
  if (select to_jsonb(d) from public.style_guide_search_documents d where style_guide_file_id = v_file2) is distinct from v_row then
    raise exception 'contract 3: dead-lease mark_error rewrote the row';
  end if;

  -- 4) reset touches only rows not already in the reset state; the repeat
  --    reset writes nothing and reports zero.
  select public.reset_sg_search_embedding_errors(array[v_file2]) into v_count;
  if v_count is distinct from 1 then
    raise exception 'contract 4: first reset reported % rows, expected exactly the one errored document', v_count;
  end if;
  select to_jsonb(d) into v_row from public.style_guide_search_documents d where style_guide_file_id = v_file2;
  select public.reset_sg_search_embedding_errors(array[v_file2]) into v_count;
  if v_count is distinct from 0 then
    raise exception 'contract 4: repeat reset reported % rows, expected 0', v_count;
  end if;
  if (select to_jsonb(d) from public.style_guide_search_documents d where style_guide_file_id = v_file2) is distinct from v_row then
    raise exception 'contract 4: repeat reset rewrote already-reset rows';
  end if;

  -- 5) A DIFFERENT vector under a fresh live lease is a real change and still
  --    writes (the guards suppress only equal values, never real results).
  insert into public.style_guide_search_embedding_jobs
    (style_guide_file_id, content_sha256, lease_token, claimed_by, lease_expires_at, attempt_count)
  values (v_file1, v_sha1, v_token, 'zz5758-worker', now() + interval '5 minutes', 1);
  select public.upsert_sg_search_embedding(v_file1, v_sha1, v_token, v_vec2) into v_ret;
  if v_ret is distinct from true then
    raise exception 'contract 5: a changed embedding value did not report writing';
  end if;
  if (select embedding is distinct from v_vec2 from public.style_guide_search_documents where style_guide_file_id = v_file1) then
    raise exception 'contract 5: changed embedding value was not stored';
  end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'contracts passed: repeat embedding results, repeat errors and repeat resets write nothing; real changes still write.';
end;
$contracts$;

rollback;
