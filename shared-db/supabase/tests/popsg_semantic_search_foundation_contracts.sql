-- Issue #4437: contracts for the stage-1 PopSG embedding foundation.
-- Service-role-only claim/upsert/mark/reset RPCs, lease/retry state, and
-- refresh_style_guide_matviews content-identity invalidation.
begin;

insert into public.style_guide_files
  (id, root_label, relative_path, directory_path, filename, basename_no_ext,
   file_extension, normalized_name, property_folder, style_guide_folder,
   size_bytes, modified_at, is_active, thumbnail_url, thumbnail_error)
values
  ('44370000-0000-4000-8000-000000000001', 'ZZ4437', 'TestLicensor/SemA/one.pdf', 'SemA', 'one.pdf', 'one', 'pdf', 'one', 'TestProperty', 'SemA', 100, '2026-10-01', true, 'https://example.invalid/one.jpg', null),
  ('44370000-0000-4000-8000-000000000002', 'ZZ4437', 'TestLicensor/SemB/two.pdf', 'SemB', 'two.pdf', 'two', 'pdf', 'two', 'TestProperty', 'SemB', 200, '2026-10-01', true, 'https://example.invalid/two.jpg', null),
  ('44370000-0000-4000-8000-000000000003', 'ZZ4437', 'TestLicensor/SemC/three.pdf', 'SemC', 'three.pdf', 'three', 'pdf', 'three', 'TestProperty', 'SemC', 300, '2026-10-01', false, null, null),
  ('44370000-0000-4000-8000-000000000004', 'ZZ4437', 'TestLicensor/SemD/four.pdf', 'SemD', 'four.pdf', 'four', 'pdf', 'four', 'TestProperty', 'SemD', 400, '2026-10-01', true, 'https://example.invalid/four.jpg', null),
  ('44370000-0000-4000-8000-000000000005', 'ZZ4437', 'TestLicensor/SemE/five.pdf', 'SemE', 'five.pdf', 'five', 'pdf', 'five', 'TestProperty', 'SemE', 500, '2026-10-01', true, 'https://example.invalid/five.jpg', null),
  -- Review round 2, M1: an active file whose render has not produced a
  -- thumbnail yet. Identified (digest over the empty thumbnail), but the
  -- claim must not hand it to the worker and the meter must report it in its
  -- own waiting bucket instead of as backlog or as a worker failure.
  ('44370000-0000-4000-8000-000000000006', 'ZZ4437', 'TestLicensor/SemF/six.pdf', 'SemF', 'six.pdf', 'six', 'pdf', 'six', 'TestProperty', 'SemF', 600, '2026-10-01', true, null, 'render pending');

insert into public.style_guide_search_documents
  (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
   style_guide_name, directory_path, relative_path, filename, file_extension,
   tag_names, size_bytes, modified_at, thumbnail_url, is_active,
   pdf_text_status, pdf_text_length, source_identity, content_sha256, search_vector)
select f.id, f.root_label, 'TestLicensor', f.property_folder, f.style_guide_folder,
       f.style_guide_folder, f.directory_path, f.relative_path, f.filename,
       f.file_extension, array['zz4437-tag'], f.size_bytes, f.modified_at,
       f.thumbnail_url, f.is_active,
       null, 0,
       -- exactly the identity refresh_style_guide_matviews recomputes, so an
       -- untouched fixture row is genuinely "unchanged content"
       md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
           coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
           coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
           coalesce(f.licensor_name, '') || '|' || f.is_active::text),
       encode(extensions.digest(
         md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
             coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
             coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
             coalesce(f.licensor_name, '') || '|' || f.is_active::text)
         || '|' || coalesce(f.thumbnail_url, ''), 'sha256'), 'hex'),
       to_tsvector('simple', f.filename)
  from public.style_guide_files f where f.root_label = 'ZZ4437';

-- B starts exhausted: embedding null, attempts spent, transient error recorded.
update public.style_guide_search_documents
   set embedding_attempts = embedding_max_attempts,
       embedding_error = 'zz4437 boom',
       embedding_error_category = 'transient',
       embedding_next_retry_at = now() + interval '1 hour'
 where style_guide_file_id = '44370000-0000-4000-8000-000000000002';

-- D starts embedded; E starts embedded with unchanged content ahead.
update public.style_guide_search_documents d
   set embedding = (select ('[' || string_agg('0.1', ',') || ']')::extensions.vector
                      from generate_series(1, 768)),
       embedding_model = 'google/siglip2-base-patch16-naflex',
       embedding_updated_at = now(),
       embedding_attempts = 1
 where d.style_guide_file_id in ('44370000-0000-4000-8000-000000000004',
                                 '44370000-0000-4000-8000-000000000005');

do $contracts$
declare
  v_claimed record;
  v_json jsonb;
  v_reset integer;
  v_token uuid;
begin
  -- Contract 1: the five stage-1 RPCs exist with exact signatures, and only
  -- service_role may execute them.
  if to_regprocedure('public.claim_sg_search_embedding_documents(integer,text,integer)') is null
     or to_regprocedure('public.upsert_sg_search_embedding(uuid,text,uuid,extensions.vector(768),text)') is null
     or to_regprocedure('public.mark_sg_search_embedding_error(uuid,text,uuid,text,text)') is null
     or to_regprocedure('public.get_sg_search_embedding_status()') is null
     or to_regprocedure('public.reset_sg_search_embedding_errors(uuid[])') is null then
    raise exception 'contract 1: a stage-1 embedding RPC is missing';
  end if;
  if has_function_privilege('anon', 'public.claim_sg_search_embedding_documents(integer,text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_sg_search_embedding_documents(integer,text,integer)', 'execute')
     or has_function_privilege('anon', 'public.upsert_sg_search_embedding(uuid,text,uuid,extensions.vector(768),text)', 'execute')
     or has_function_privilege('authenticated', 'public.upsert_sg_search_embedding(uuid,text,uuid,extensions.vector(768),text)', 'execute')
     or has_function_privilege('anon', 'public.mark_sg_search_embedding_error(uuid,text,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_sg_search_embedding_error(uuid,text,uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.get_sg_search_embedding_status()', 'execute')
     or has_function_privilege('authenticated', 'public.get_sg_search_embedding_status()', 'execute')
     or has_function_privilege('anon', 'public.reset_sg_search_embedding_errors(uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.reset_sg_search_embedding_errors(uuid[])', 'execute') then
    raise exception 'contract 1: a browser role can execute a worker-only embedding RPC';
  end if;
  if not has_function_privilege('service_role', 'public.claim_sg_search_embedding_documents(integer,text,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.upsert_sg_search_embedding(uuid,text,uuid,extensions.vector(768),text)', 'execute')
     or not has_function_privilege('service_role', 'public.mark_sg_search_embedding_error(uuid,text,uuid,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.get_sg_search_embedding_status()', 'execute')
     or not has_function_privilege('service_role', 'public.reset_sg_search_embedding_errors(uuid[])', 'execute') then
    raise exception 'contract 1: service_role lost a worker embedding RPC';
  end if;

  -- Contract 2: claim picks only eligible documents (active, identified, not
  -- embedded, attempts left, no live lease, not permanent), in one bounded
  -- batch, and stamps a fresh lease.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select * into v_claimed
    from public.claim_sg_search_embedding_documents(p_limit => 10, p_worker_id => 'zz4437-worker');
  if v_claimed.style_guide_file_id is distinct from '44370000-0000-4000-8000-000000000001'
     or v_claimed.lease_token is null
     or v_claimed.lease_expires_at <= now()
     or v_claimed.attempt is distinct from 1 then
    raise exception 'contract 2: claim did not lease exactly the eligible document with a fresh lease';
  end if;
  v_token := v_claimed.lease_token;

  if exists (select 1 from public.claim_sg_search_embedding_documents(p_limit => 10, p_worker_id => 'zz4437-worker')) then
    raise exception 'contract 2: a second claim re-leased the same document';
  end if;

  -- Contract 3: non-service roles and empty worker ids are refused.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform public.claim_sg_search_embedding_documents(p_limit => 1, p_worker_id => 'zz4437-worker');
    raise exception 'contract 3: authenticated role reached the embedding claim RPC';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.claim_sg_search_embedding_documents(p_limit => 1, p_worker_id => '  ');
    raise exception 'contract 3: empty worker id was accepted';
  exception when insufficient_privilege then null;
  end;

  -- Contract 4: a stale lease token cannot write an embedding.
  if public.upsert_sg_search_embedding(
       p_style_guide_file_id => '44370000-0000-4000-8000-000000000001',
       p_content_sha256 => (select content_sha256 from public.style_guide_search_documents
                             where style_guide_file_id = '44370000-0000-4000-8000-000000000001'),
       p_lease_token => gen_random_uuid(),
       p_embedding => (select ('[' || string_agg('0.2', ',') || ']')::extensions.vector
                         from generate_series(1, 768))) then
    raise exception 'contract 4: a foreign lease token wrote an embedding';
  end if;

  -- Contract 5: dimension and model are enforced before any write.
  begin
    perform public.upsert_sg_search_embedding(
      p_style_guide_file_id => '44370000-0000-4000-8000-000000000001',
      p_content_sha256 => (select content_sha256 from public.style_guide_search_documents
                             where style_guide_file_id = '44370000-0000-4000-8000-000000000001'),
      p_lease_token => v_token,
      p_embedding => (select ('[' || string_agg('0.2', ',') || ']')::extensions.vector
                        from generate_series(1, 767)));
    raise exception 'contract 5: a 767-dimension vector was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Contract 6: a live lease writes the vector, stamps the model, and clears
  -- the lease.
  if not public.upsert_sg_search_embedding(
       p_style_guide_file_id => '44370000-0000-4000-8000-000000000001',
       p_content_sha256 => (select content_sha256 from public.style_guide_search_documents
                             where style_guide_file_id = '44370000-0000-4000-8000-000000000001'),
       p_lease_token => v_token,
       p_embedding => (select ('[' || string_agg('0.2', ',') || ']')::extensions.vector
                         from generate_series(1, 768))) then
    raise exception 'contract 6: live lease upsert refused';
  end if;
  if not exists (select 1 from public.style_guide_search_documents
                  where style_guide_file_id = '44370000-0000-4000-8000-000000000001'
                    and embedding is not null
                    and embedding_model = 'google/siglip2-base-patch16-naflex'
                    and embedding_updated_at is not null
                    and embedding_lease_token is null
                    and embedding_lease_owner is null
                    and embedding_lease_expires_at is null) then
    raise exception 'contract 6: successful upsert did not store vector and clear lease';
  end if;

  -- Contract 7: error marking uses the lease, backs off, and categorizes;
  -- the coverage meter reports the true states; reset re-opens exhausted rows.
  update public.style_guide_search_documents
     set embedding = null, embedding_model = null, embedding_updated_at = null,
         embedding_attempts = 0, embedding_lease_token = null, embedding_lease_expires_at = null
   where style_guide_file_id = '44370000-0000-4000-8000-000000000001';
  select lease_token into v_token
    from public.claim_sg_search_embedding_documents(p_limit => 1, p_worker_id => 'zz4437-worker')
   where style_guide_file_id = '44370000-0000-4000-8000-000000000001';
  if v_token is null then
    raise exception 'contract 7: re-claim after clearing failed';
  end if;
  if not public.mark_sg_search_embedding_error(
       p_style_guide_file_id => '44370000-0000-4000-8000-000000000001',
       p_content_sha256 => (select content_sha256 from public.style_guide_search_documents
                             where style_guide_file_id = '44370000-0000-4000-8000-000000000001'),
       p_lease_token => v_token,
       p_error => 'zz4437 transient',
       p_category => 'transient') then
    raise exception 'contract 7: error marking refused a live lease';
  end if;
  if not exists (select 1 from public.style_guide_search_documents
                  where style_guide_file_id = '44370000-0000-4000-8000-000000000001'
                    and embedding_error = 'zz4437 transient'
                    and embedding_error_category = 'transient'
                    and embedding_next_retry_at > now()
                    and embedding_attempts >= 1
                    and embedding_lease_token is null) then
    raise exception 'contract 7: transient error state was not recorded with backoff';
  end if;

  -- Review round 3, M2: the backoff is exponential 30 * power(2, attempts - 1)
  -- seconds (written with power(), never a bare ^ operator whose integer
  -- reading could be argued bitwise). attempts=2 must land at ~60 seconds.
  declare
    v_retry timestamptz;
  begin
    update public.style_guide_search_documents
       set embedding_next_retry_at = null
     where style_guide_file_id = '44370000-0000-4000-8000-000000000001';
    select lease_token into v_token
      from public.claim_sg_search_embedding_documents(p_limit => 1, p_worker_id => 'zz4437-worker')
     where style_guide_file_id = '44370000-0000-4000-8000-000000000001';
    if v_token is null then
      raise exception 'contract 7: backoff-progression re-claim found nothing to lease';
    end if;
    perform public.mark_sg_search_embedding_error(
      p_style_guide_file_id => '44370000-0000-4000-8000-000000000001',
      p_content_sha256 => (select content_sha256 from public.style_guide_search_documents
                             where style_guide_file_id = '44370000-0000-4000-8000-000000000001'),
      p_lease_token => v_token,
      p_error => 'zz4437 second',
      p_category => 'transient');
    select embedding_next_retry_at into v_retry
      from public.style_guide_search_documents
     where style_guide_file_id = '44370000-0000-4000-8000-000000000001';
    if v_retry < now() + interval '55 seconds' or v_retry > now() + interval '65 seconds' then
      raise exception 'contract 7: backoff at attempts=2 is not the exponential 60 seconds (%)', v_retry;
    end if;
    update public.style_guide_search_documents
       set embedding_error = 'zz4437 transient',
           embedding_error_category = 'transient',
           embedding_next_retry_at = null
     where style_guide_file_id = '44370000-0000-4000-8000-000000000001';
  end;

  -- Meter semantics (review round 2, M1/L1): pending counts only claimable
  -- work -- A (active, identified, thumbnail present, retries left, transient
  -- error); F (no thumbnail yet) sits in waiting_for_thumbnail; the inactive
  -- C is neither; D and E are embedded; B is exhausted with a recorded error.
  select public.get_sg_search_embedding_status() into v_json;
  if (v_json ->> 'total_documents')::int is distinct from 6
     or (v_json ->> 'embedded_documents')::int is distinct from 2
     or (v_json ->> 'pending_documents')::int is distinct from 1
     or (v_json ->> 'waiting_for_thumbnail_documents')::int is distinct from 1
     or (v_json ->> 'exhausted_documents')::int is distinct from 1
     or (v_json ->> 'errored_documents')::int is distinct from 2
     or (v_json ->> 'leased_documents')::int is distinct from 0
     or (v_json ->> 'unidentified_documents')::int is distinct from 0 then
    raise exception 'contract 7: coverage meter disagrees with fixture state: %', v_json::text;
  end if;

  select public.reset_sg_search_embedding_errors(
           array['44370000-0000-4000-8000-000000000002']::uuid[]) into v_reset;
  if v_reset is distinct from 1 or exists (
    select 1 from public.style_guide_search_documents
     where style_guide_file_id = '44370000-0000-4000-8000-000000000002'
       and (embedding_error is not null or embedding_attempts is distinct from 0
            or embedding_next_retry_at is not null)) then
    raise exception 'contract 7: reset did not re-open the exhausted document';
  end if;

  perform set_config('request.jwt.claims', null, true);
end
$contracts$;

-- Contract 8: refresh_style_guide_matviews maintains content_sha256 and
-- invalidates the embedding exactly when content identity changes. D's file
-- changes (modified_at drives source_identity); E's is queued unchanged.
-- The seeding inserts already queued every fixture row through the files
-- trigger, so these are upserts that re-stamp both entries as older than
-- the refresh call.
update public.style_guide_files
   set modified_at = '2026-10-02'
 where id = '44370000-0000-4000-8000-000000000004';
insert into public.style_guide_search_sync_queue (style_guide_file_id, queued_at)
values ('44370000-0000-4000-8000-000000000004', now() - interval '1 minute'),
       ('44370000-0000-4000-8000-000000000005', now() - interval '1 minute')
on conflict (style_guide_file_id) do update
   set queued_at = now() - interval '1 minute';

do $contracts$
declare
  v_result record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select * into v_result from public.refresh_style_guide_matviews(null, 100, 'search');
  if v_result.search_documents_synced is distinct from 1 then
    raise exception 'contract 8: refresh synced % rows, expected exactly the changed document',
      v_result.search_documents_synced;
  end if;
  if not exists (select 1
                  from public.style_guide_search_documents d
                  join public.style_guide_files f on f.id = d.style_guide_file_id
                 where d.style_guide_file_id = '44370000-0000-4000-8000-000000000004'
                   and d.modified_at = '2026-10-02'
                   and d.content_sha256 = encode(extensions.digest(
                       md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                           coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                           coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                           coalesce(f.licensor_name, '') || '|' || f.is_active::text)
                       || '|' || coalesce(f.thumbnail_url, ''), 'sha256'), 'hex')
                   and d.embedding is null
                   and d.embedding_model is null
                   and d.embedding_attempts = 0) then
    raise exception 'contract 8: changed content did not recompute identity and invalidate the embedding';
  end if;
  if not exists (select 1 from public.style_guide_search_documents d
                  where d.style_guide_file_id = '44370000-0000-4000-8000-000000000005'
                    and d.embedding is not null
                    and d.embedding_model = 'google/siglip2-base-patch16-naflex'
                    and d.embedding_attempts = 1) then
    raise exception 'contract 8: unchanged content lost its embedding or retry state';
  end if;
  perform set_config('request.jwt.claims', null, true);
end
$contracts$;


-- Contract 9 (#4437 review B1): a thumbnail-only change re-syncs the document,
-- recomputes content_sha256 over the new image URL and invalidates the vector.
update public.style_guide_search_documents
   set embedding = (select ('[' || string_agg('0.3', ',') || ']')::extensions.vector
                      from generate_series(1, 768)),
       embedding_model = 'google/siglip2-base-patch16-naflex',
       embedding_updated_at = now(),
       embedding_attempts = 1
 where style_guide_file_id = '44370000-0000-4000-8000-000000000004';

update public.style_guide_files
   set thumbnail_url = 'https://example.invalid/four-rerendered.jpg'
 where id = '44370000-0000-4000-8000-000000000004';

insert into public.style_guide_search_sync_queue (style_guide_file_id, queued_at)
values ('44370000-0000-4000-8000-000000000004', now() - interval '1 minute')
on conflict (style_guide_file_id) do update
   set queued_at = now() - interval '1 minute';

do $contracts$
declare
  v_result record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select * into v_result from public.refresh_style_guide_matviews(null, 100, 'search');
  if v_result.search_documents_synced is distinct from 1 then
    raise exception 'contract 9: thumbnail-only change did not resync (%)', v_result.search_documents_synced;
  end if;
  if not exists (select 1
                   from public.style_guide_search_documents d
                   join public.style_guide_files f on f.id = d.style_guide_file_id
                  where d.style_guide_file_id = '44370000-0000-4000-8000-000000000004'
                    and d.thumbnail_url = 'https://example.invalid/four-rerendered.jpg'
                    and d.embedding is null
                    and d.embedding_model is null
                    and d.embedding_attempts = 0
                    and d.content_sha256 = encode(extensions.digest(
                        md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                            coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                            coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                            coalesce(f.licensor_name, '') || '|' || f.is_active::text)
                        || '|' || 'https://example.invalid/four-rerendered.jpg', 'sha256'), 'hex')) then
    raise exception 'contract 9: re-rendered thumbnail did not invalidate the embedding or recompute identity';
  end if;
  perform set_config('request.jwt.claims', null, true);
end
$contracts$;

-- Contract 10 (#4437 review B1): the claim hands the worker the LIVE thumbnail
-- and skips documents whose stored snapshot is stale until the refresh heals
-- them.
update public.style_guide_search_documents
   set thumbnail_url = 'https://example.invalid/stale-snapshot.jpg',
       embedding = null, embedding_model = null, embedding_updated_at = null,
       embedding_attempts = 0, embedding_error = null, embedding_error_category = null,
       embedding_next_retry_at = null
 where style_guide_file_id = '44370000-0000-4000-8000-000000000004';

do $contracts$
declare
  v_claimed record;
  v_result record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if exists (select 1 from public.claim_sg_search_embedding_documents(p_limit => 10, p_worker_id => 'zz4437-worker')
              where style_guide_file_id = '44370000-0000-4000-8000-000000000004') then
    raise exception 'contract 10: claim handed out a stale-snapshot document';
  end if;

  insert into public.style_guide_search_sync_queue (style_guide_file_id, queued_at)
  values ('44370000-0000-4000-8000-000000000004', now() - interval '1 minute')
  on conflict (style_guide_file_id) do update
     set queued_at = now() - interval '1 minute';
  select * into v_result from public.refresh_style_guide_matviews(null, 100, 'search');
  if v_result.search_documents_synced is distinct from 1 then
    raise exception 'contract 10: stale thumbnail did not resync (%)', v_result.search_documents_synced;
  end if;

  select * into v_claimed
    from public.claim_sg_search_embedding_documents(p_limit => 10, p_worker_id => 'zz4437-worker')
   where style_guide_file_id = '44370000-0000-4000-8000-000000000004';
  if v_claimed.style_guide_file_id is null
     or v_claimed.thumbnail_url is distinct from 'https://example.invalid/four-rerendered.jpg' then
    raise exception 'contract 10: healed document was not claimable with its live thumbnail';
  end if;
  perform set_config('request.jwt.claims', null, true);
end
$contracts$;

-- Contract 11 (#4437 review M4): the structural objects themselves.
do $contracts$
declare
  v_column text;
begin
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.style_guide_search_documents')
                    and a.attname = 'embedding' and not a.attisdropped
                    and a.atttypid = 'extensions.vector'::regtype and a.atttypmod = 768) then
    raise exception 'contract 11: embedding column is not extensions.vector(768)';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.style_guide_search_documents')
                    and a.attname = 'content_sha256' and not a.attisdropped
                    and a.atttypid = 'text'::regtype) then
    raise exception 'contract 11: content_sha256 column is not text';
  end if;
  if not exists (select 1 from pg_indexes i
                  where i.schemaname = 'public'
                    and i.indexname = 'idx_sg_search_documents_embedding_hnsw'
                    and i.indexdef like '%USING hnsw%vector_cosine_ops%') then
    raise exception 'contract 11: HNSW index missing or wrong shape';
  end if;
  if not exists (select 1 from pg_indexes i
                  where i.schemaname = 'public'
                    and i.indexname = 'idx_sg_search_documents_embedding_pending'
                    and i.indexdef like '%WHERE (is_active AND (content_sha256 IS NOT NULL) AND (embedding IS NULL))%') then
    raise exception 'contract 11: pending-claim index missing or wrong predicate';
  end if;
  -- Review round 2, L5: every state column the RPCs write must exist, not
  -- just the vector; a missing one would otherwise surface only at the first
  -- worker call.
  foreach v_column in array array[
    'embedding', 'embedding_model', 'embedding_updated_at', 'embedding_error',
    'embedding_error_category', 'embedding_next_retry_at', 'embedding_attempts',
    'embedding_max_attempts', 'embedding_lease_token', 'embedding_lease_owner',
    'embedding_lease_expires_at', 'content_sha256'] loop
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = to_regclass('public.style_guide_search_documents')
                      and a.attname = v_column and not a.attisdropped and a.attnum > 0) then
      raise exception 'contract 11: column % is missing', v_column;
    end if;
  end loop;
  -- Review round 2, B1: the scheduled no-argument command must resolve to the
  -- reviewed delegating body, and the await helper must pin exactly that body.
  if to_regprocedure('public.refresh_style_guide_matviews()') is not null
     or not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
         and p.prosecdef and p.pronargdefaults = 2
         and md5(p.prosrc) = '044a40244377bb9b64dc65efbc7ccf6a') then
    raise exception 'contract 11: the scheduled refresh overload is not the reviewed delegating body';
  end if;
  if not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.await_style_guide_matview_refresh(uuid)')
         and position('044a40244377bb9b64dc65efbc7ccf6a' in p.prosrc) > 0) then
    raise exception 'contract 11: await_style_guide_matview_refresh does not pin the reviewed scheduled body';
  end if;
end
$contracts$;


-- Contract 12 (#4437 review round 2 B1, round 3 hardening): the SCHEDULED
-- refresh path -- the no-argument overload the hourly cron command resolves
-- to -- delegates to the stepping overload, so the search-sync behavior it
-- runs is exercised here through the stepping 'search' step (the matview
-- REFRESH ... CONCURRENTLY statements cannot be assumed executable inside
-- the CI wrapper's transaction, so they are never invoked from a test; the
-- delegation itself is byte-pinned by contract 11, 3458 test 2 and bounded
-- contract 14). A thumbnail-only re-render invalidates the vector, and a
-- brand-new file gets a claimable document with content_sha256 on its first
-- cycle. M1: the claim never hands out a document with no thumbnail.
update public.style_guide_files
   set thumbnail_url = 'https://example.invalid/five-rerendered.jpg'
 where id = '44370000-0000-4000-8000-000000000005';

insert into public.style_guide_files
  (id, root_label, relative_path, directory_path, filename, basename_no_ext,
   file_extension, normalized_name, property_folder, style_guide_folder,
   size_bytes, modified_at, is_active, thumbnail_url, thumbnail_error)
values
  ('44370000-0000-4000-8000-000000000007', 'ZZ4437', 'TestLicensor/SemG/seven.pdf', 'SemG', 'seven.pdf', 'seven', 'pdf', 'seven', 'TestProperty', 'SemG', 700, '2026-10-03', true, 'https://example.invalid/seven.jpg', null);

do $contracts$
declare
  v_result record;
  v_claimed record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  if exists (select 1 from public.claim_sg_search_embedding_documents(p_limit => 10, p_worker_id => 'zz4437-worker')
              where style_guide_file_id = '44370000-0000-4000-8000-000000000006') then
    raise exception 'contract 12: claim handed out a document without a thumbnail';
  end if;

  select * into v_result from public.refresh_style_guide_matviews(null, 100, 'search');
  if v_result.search_documents_synced is distinct from 2 then
    raise exception 'contract 12: scheduled refresh synced % rows, expected the re-render and the new file',
      v_result.search_documents_synced;
  end if;

  if not exists (select 1
                   from public.style_guide_search_documents d
                   join public.style_guide_files f on f.id = d.style_guide_file_id
                  where d.style_guide_file_id = '44370000-0000-4000-8000-000000000005'
                    and d.thumbnail_url = 'https://example.invalid/five-rerendered.jpg'
                    and d.embedding is null
                    and d.embedding_model is null
                    and d.embedding_attempts = 0
                    and d.content_sha256 = encode(extensions.digest(
                        md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                            coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                            coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                            coalesce(f.licensor_name, '') || '|' || f.is_active::text)
                        || '|' || 'https://example.invalid/five-rerendered.jpg', 'sha256'), 'hex')) then
    raise exception 'contract 12: the scheduled path did not invalidate the re-rendered thumbnail';
  end if;

  if not exists (select 1
                   from public.style_guide_search_documents d
                   join public.style_guide_files f on f.id = d.style_guide_file_id
                  where d.style_guide_file_id = '44370000-0000-4000-8000-000000000007'
                    and d.is_active
                    and d.content_sha256 = encode(extensions.digest(
                        md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                            coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                            coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                            coalesce(f.licensor_name, '') || '|' || f.is_active::text)
                        || '|' || 'https://example.invalid/seven.jpg', 'sha256'), 'hex')) then
    raise exception 'contract 12: a brand-new file was left unidentified by the scheduled path';
  end if;
  if not exists (select 1
                   from public.style_guide_search_documents d
                   join public.style_guide_files f on f.id = d.style_guide_file_id
                  where d.style_guide_file_id = '44370000-0000-4000-8000-000000000007'
                    and d.thumbnail_url is not distinct from f.thumbnail_url) then
    raise exception 'contract 12: the new document was not claimable (stale or missing thumbnail snapshot)';
  end if;

  select * into v_claimed
    from public.claim_sg_search_embedding_documents(p_limit => 10, p_worker_id => 'zz4437-worker')
   where style_guide_file_id = '44370000-0000-4000-8000-000000000007';
  if v_claimed.style_guide_file_id is null
     or v_claimed.thumbnail_url is distinct from 'https://example.invalid/seven.jpg'
     or v_claimed.attempt is distinct from 1 then
    raise exception 'contract 12: the newly synced document was not claimable with its live thumbnail';
  end if;

  perform set_config('request.jwt.claims', null, true);
end
$contracts$;

rollback;
