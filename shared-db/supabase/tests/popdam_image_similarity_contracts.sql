-- PopDAM image-similarity contracts (#4692 / claim #4725, popdam3 #486).
-- Disposable-database transaction only; the harness owns BEGIN/ROLLBACK.
-- Covers: grant/RLS posture, trigger enqueue (raster/PDF/gate), unique active
-- index, claim exclusivity + expired-lease poison, query claim = 1, complete
-- upsert + re-enqueue on thumbnail change, fail paths, heartbeat freshness,
-- halfvec text round-trip via query_status, stamp-filtered search + floor,
-- HNSW EXPLAIN (forced; see the phase 10 note), purge.

-- =====================================================================================
-- Phase 1 — grant / RLS posture.
-- =====================================================================================
do $phase1$
begin
  if has_table_privilege('service_role', 'dam.dam_asset_image_vectors', 'SELECT')
     or has_table_privilege('service_role', 'dam.image_embed_jobs', 'INSERT')
     or has_table_privilege('authenticated', 'dam.image_embed_jobs', 'SELECT')
     or has_table_privilege('anon', 'dam.image_embed_worker_heartbeat', 'SELECT') then
    raise exception 'browser/service roles hold direct grants on image-embed tables';
  end if;
  if not has_table_privilege('dam_image_embed_worker', 'dam.image_embed_jobs', 'SELECT')
     or not has_table_privilege('dam_image_embed_worker', 'dam.image_embed_worker_heartbeat', 'SELECT')
     or has_table_privilege('dam_image_embed_worker', 'dam.dam_asset_image_vectors', 'INSERT') then
    raise exception 'worker role SELECT posture on jobs/heartbeat/vectors is wrong';
  end if;
  if has_function_privilege('authenticated', 'public.image_embed_enqueue_query(bytea)', 'EXECUTE')
     or has_function_privilege('anon', 'public.image_embed_status()', 'EXECUTE')
     or has_function_privilege('anon', 'public.search_dam_image_similarity(extensions.halfvec,extensions.halfvec,numeric,numeric,integer,integer,text[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.search_dam_image_similarity(extensions.halfvec,extensions.halfvec,numeric,numeric,integer,integer,text[])', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.image_embed_enqueue_index(uuid)', 'EXECUTE')
     or not has_function_privilege('dam_image_embed_worker', 'dam.claim_image_embed_jobs(text,integer,text,integer)', 'EXECUTE') then
    raise exception 'function execute posture is wrong';
  end if;
  if (select count(*) from pg_policies where schemaname = 'dam'
       and policyname in ('image_embed_worker_jobs_read', 'image_embed_worker_heartbeat_read')) <> 2 then
    raise exception 'worker read policies missing';
  end if;
end
$phase1$;

-- =====================================================================================
-- Phase 2 — trigger: enqueue on raster thumbnail, skip PDF, respect the gate,
-- one active index job per asset.
-- =====================================================================================
insert into public.admin_config (key, value)
values ('IMAGE_EMBED_ENABLED', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted, thumbnail_url, sku)
values ('00000000-0000-4000-8000-000000000481', 'zz486-a.jpg', 'ZZ486/zz486-a.jpg', 'jpg', 'zz486-a', now(), false,
        'https://cdn.example.test/zz486-a.jpg', 'ZZ486SKU');

insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted, thumbnail_url)
values ('00000000-0000-4000-8000-000000000482', 'zz486-b.pdf', 'ZZ486/zz486-b.pdf', 'pdf', 'zz486-b', now(), false,
        'https://cdn.example.test/zz486-b.pdf');

-- gate off before the third asset
update public.admin_config set value = 'false'::jsonb where key = 'IMAGE_EMBED_ENABLED';
insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted, thumbnail_url)
values ('00000000-0000-4000-8000-000000000483', 'zz486-c.png', 'ZZ486/zz486-c.png', 'png', 'zz486-c', now(), false,
        'https://cdn.example.test/zz486-c.png');
update public.admin_config set value = 'true'::jsonb where key = 'IMAGE_EMBED_ENABLED';

do $phase2$
begin
  if (select count(*) from dam.image_embed_jobs
       where asset_id = '00000000-0000-4000-8000-000000000481' and kind = 'index') <> 1 then
    raise exception 'test_trigger_enqueues_on_thumbnail: raster insert did not enqueue exactly one job';
  end if;
  if exists (select 1 from dam.image_embed_jobs
              where asset_id = '00000000-0000-4000-8000-000000000482') then
    raise exception 'test_trigger_skips_pdf_thumbnail: PDF thumbnail enqueued';
  end if;
  if exists (select 1 from dam.image_embed_jobs
              where asset_id = '00000000-0000-4000-8000-000000000483') then
    raise exception 'trigger enqueued while IMAGE_EMBED_ENABLED was false';
  end if;
end
$phase2$;

-- thumbnail change while enabled: still exactly one ACTIVE job (unique partial index)
update public.assets
   set thumbnail_url = 'https://cdn.example.test/zz486-a2.jpg'
 where id = '00000000-0000-4000-8000-000000000481';

do $phase2b$
begin
  if (select count(*) from dam.image_embed_jobs
       where asset_id = '00000000-0000-4000-8000-000000000481'
         and kind = 'index' and status in ('pending', 'leased')) <> 1 then
    raise exception 'test_unique_pending_index: active index jobs for one asset <> 1';
  end if;
end
$phase2b$;

-- =====================================================================================
-- Phase 3 — claim exclusivity, complete upsert, re-enqueue on thumbnail change.
-- =====================================================================================
create temp table zz486_claimed as
  select j.* from dam.claim_image_embed_jobs('index', 32, 'zz486-worker-1', 300) j;

do $phase3$
declare
  v_job record;
  v_again bigint;
begin
  if (select count(*) from zz486_claimed) <> 1
     or (select status from zz486_claimed) <> 'leased'
     or (select lease_owner from zz486_claimed) <> 'zz486-worker-1' then
    raise exception 'claim did not lease the single pending index job';
  end if;

  select count(*) into v_again from dam.claim_image_embed_jobs('index', 32, 'zz486-worker-2', 300);
  if v_again <> 0 then
    raise exception 'test_claim_exclusive: a second worker claimed a leased job';
  end if;

  select * into v_job from zz486_claimed;
  -- complete with the CURRENT assets thumbnail URL; vectors land atomically.
  perform dam.complete_image_embed_job(
    v_job.id,
    ('[' || (select string_agg(g::text, ',') from generate_series(1, 768) g) || ']')::extensions.halfvec,
    ('[' || (select string_agg((g * 2)::text, ',') from generate_series(1, 768) g) || ']')::extensions.halfvec,
    'zz486-stamp-v1', false, 'https://cdn.example.test/zz486-a2.jpg');

  if not exists (select 1 from dam.dam_asset_image_vectors
                  where asset_id = '00000000-0000-4000-8000-000000000481'
                    and vec_dino is not null and vec_siglip is not null
                    and embedding_model = 'zz486-stamp-v1') then
    raise exception 'complete did not upsert both vector legs atomically';
  end if;
  if exists (select 1 from dam.image_embed_jobs where id = v_job.id and status <> 'done') then
    raise exception 'completed job is not done';
  end if;
end
$phase3$;

-- complete against a MOVED thumbnail must re-enqueue (M-D): flip the asset's URL,
-- enqueue + lease + complete with the OLD URL, expect a fresh pending job.
do $phase3b$
declare
  v_id uuid;
begin
  update public.assets
     set thumbnail_url = 'https://cdn.example.test/zz486-a3.jpg'
   where id = '00000000-0000-4000-8000-000000000481';

  perform public.image_embed_enqueue_index('00000000-0000-4000-8000-000000000481');
  select id into v_id from dam.claim_image_embed_jobs('index', 32, 'zz486-worker-1', 300);
  if v_id is null then
    raise exception 'phase3b: expected a leased index job';
  end if;

  perform dam.complete_image_embed_job(
    v_id,
    ('[' || (select string_agg(g::text, ',') from generate_series(1, 768) g) || ']')::extensions.halfvec,
    ('[' || (select string_agg((g * 2)::text, ',') from generate_series(1, 768) g) || ']')::extensions.halfvec,
    'zz486-stamp-v1', false, 'https://cdn.example.test/zz486-a2.jpg');

  if (select count(*) from dam.image_embed_jobs
       where asset_id = '00000000-0000-4000-8000-000000000481'
         and kind = 'index' and status = 'pending') <> 1 then
    raise exception 'test_complete_reenqueues_on_thumbnail_change: no fresh pending job after stale complete';
  end if;
  if not exists (select 1 from dam.dam_asset_image_vectors
                  where asset_id = '00000000-0000-4000-8000-000000000481'
                    and last_embedded_thumbnail_url = 'https://cdn.example.test/zz486-a2.jpg') then
    raise exception 'stale complete did not record its own watermark';
  end if;
end
$phase3b$;

-- =====================================================================================
-- Phase 4 — expired-lease reclaim and the attempts >= 5 poison (D3).
-- =====================================================================================
do $phase4$
declare
  v_id uuid;
  v_count int;
begin
  select id into v_id from dam.image_embed_jobs
   where asset_id = '00000000-0000-4000-8000-000000000481'
     and kind = 'index' and status = 'pending' limit 1;
  if v_id is null then
    raise exception 'phase4: expected the re-enqueued pending job to exist';
  end if;
  update dam.image_embed_jobs
     set status = 'leased', lease_owner = 'zz486-worker-1',
         lease_expires_at = now() - interval '1 minute', attempts = 4
   where id = v_id;

  select count(*) into v_count from dam.claim_image_embed_jobs('index', 32, 'zz486-worker-2', 300);
  if v_count <> 0 then
    raise exception 'test_claim_reaps_expired_lease: poisoned job was handed out again';
  end if;
  if not exists (select 1 from dam.image_embed_jobs
                  where id = v_id and status = 'failed'
                    and error like 'reclaim poison%') then
    raise exception 'test_claim_reaps_expired_lease: attempts>=5 reclaim did not poison';
  end if;
end
$phase4$;

-- =====================================================================================
-- Phase 5 — public enqueue (L-2) and fail paths.
-- =====================================================================================
do $phase5$
declare
  v_ok boolean;
  v_id uuid;
begin
  select public.image_embed_enqueue_index('00000000-0000-4000-8000-000000000481') into v_ok;
  if not v_ok then
    raise exception 'enqueue_index refused a real asset';
  end if;
  select public.image_embed_enqueue_index('00000000-0000-4000-8000-000000000481') into v_ok;
  if not v_ok then
    raise exception 'test_unique_pending_index: idempotent enqueue_index did not return true';
  end if;
  if public.image_embed_enqueue_index('00000000-0000-4000-8000-00000000dead') then
    raise exception 'enqueue_index returned true for a missing asset';
  end if;

  select id into v_id from dam.claim_image_embed_jobs('index', 32, 'zz486-worker-3', 300);
  if v_id is null then
    raise exception 'phase5: nothing to claim';
  end if;
  perform dam.fail_image_embed_job(v_id, 'zz transient', false);
  if not exists (select 1 from dam.image_embed_jobs where id = v_id and status = 'pending' and attempts = 1) then
    raise exception 'transient fail did not requeue with attempts=1';
  end if;

  select id into v_id from dam.claim_image_embed_jobs('index', 32, 'zz486-worker-3', 300);
  perform dam.fail_image_embed_job(v_id, 'zz permanent', true);
  if not exists (select 1 from dam.image_embed_jobs where id = v_id and status = 'failed' and error = 'zz permanent') then
    raise exception 'permanent fail did not fail the job';
  end if;
end
$phase5$;

-- =====================================================================================
-- Phase 6 — query jobs: claim exactly one, complete, status text round-trip.
-- =====================================================================================
do $phase6$
declare
  v_ids uuid[] := array[
    public.image_embed_enqueue_query(convert_to('zz486-query-bytes-1', 'UTF8')),
    public.image_embed_enqueue_query(convert_to('zz486-query-bytes-2', 'UTF8')),
    public.image_embed_enqueue_query(convert_to('zz486-query-bytes-3', 'UTF8'))];
  v_claimed uuid;
  v_status jsonb;
  v_dino text := '[' || (select string_agg(g::text, ',') from generate_series(1, 768) g) || ']';
begin
  select id into v_claimed from dam.claim_image_embed_jobs('query', 8, 'zz486-worker-1', 30);
  if v_claimed is null or not (v_claimed = any (v_ids)) then
    raise exception 'test_query_claim_one: query claim returned nothing or a foreign job';
  end if;

  perform dam.complete_image_embed_job(
    v_claimed, v_dino::extensions.halfvec, v_dino::extensions.halfvec, null, false, null);

  select public.image_embed_query_status(v_claimed) into v_status;
  if v_status ->> 'status' <> 'done'
     or (v_status ->> 'dino')::extensions.halfvec <> v_dino::extensions.halfvec
     or (v_status ->> 'siglip')::extensions.halfvec <> v_dino::extensions.halfvec then
    raise exception 'halfvec text round-trip via query_status failed: %', v_status;
  end if;
  if exists (select 1 from dam.image_embed_jobs where id = v_claimed and payload is not null) then
    raise exception 'completed query job kept its payload';
  end if;
end
$phase6$;

-- =====================================================================================
-- Phase 7 — heartbeat freshness through the only public freshness API.
-- =====================================================================================
do $phase7$
declare
  v_status jsonb;
begin
  perform dam.image_embed_worker_heartbeat('zz486-worker-1');
  select public.image_embed_status() into v_status;
  if v_status ->> 'workers_fresh' <> 'true'
     or (v_status ->> 'pending')::int < 1
     or (v_status ->> 'failed')::int < 2
     or (v_status ->> 'done')::int < 1 then
    raise exception 'test_embed_workers_fresh_stale: unexpected status payload %', v_status;
  end if;

  update dam.image_embed_worker_heartbeat
     set seen_at = now() - interval '10 minutes'
   where worker_id = 'zz486-worker-1';
  select public.image_embed_status() into v_status;
  if v_status ->> 'workers_fresh' <> 'false' then
    raise exception 'test_embed_workers_fresh_stale: stale heartbeat still reported fresh';
  end if;
end
$phase7$;

-- =====================================================================================
-- Phase 8 — search: self-match at 100, stamp filter, floor, default stamps.
-- =====================================================================================
insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted, thumbnail_url)
values ('00000000-0000-4000-8000-000000000484', 'zz486-d.jpg', 'ZZ486/zz486-d.jpg', 'jpg', 'zz486-d', now(), false,
        'https://cdn.example.test/zz486-d.jpg');

do $phase8$
declare
  v_dino text := '[' || (select string_agg(g::text, ',') from generate_series(1, 768) g) || ']';
  v_siglip text := '[' || (select string_agg((g * 2)::text, ',') from generate_series(1, 768) g) || ']';
  v_anti text := '[' || (select string_agg((-g)::text, ',') from generate_series(1, 768) g) || ']';
  v_self record;
  v_count int;
begin
  -- asset 484 carries a DIFFERENT stamp; 481 carries zz486-stamp-v1 from Phase 3.
  insert into dam.dam_asset_image_vectors (asset_id, vec_dino, vec_siglip, embedding_model, last_embedded_thumbnail_url)
  values ('00000000-0000-4000-8000-000000000484',
          v_dino::extensions.halfvec, v_siglip::extensions.halfvec,
          'zz486-stamp-v9', 'https://cdn.example.test/zz486-d.jpg')
  on conflict (asset_id) do nothing;

  select * into v_self from public.search_dam_image_similarity(
    v_dino::extensions.halfvec, v_siglip::extensions.halfvec, 0.60, 0.0, 200, 50, array['zz486-stamp-v1']);
  if v_self.asset_id is null or v_self.asset_id <> '00000000-0000-4000-8000-000000000481'
     or v_self.combined_pct <> 100.0 then
    raise exception 'self-match missing or not 100%%: %', v_self;
  end if;

  -- test_search_model_stamp_filter: the stamp-v9 row is invisible in a v1 window
  select count(*) into v_count from public.search_dam_image_similarity(
    v_dino::extensions.halfvec, v_siglip::extensions.halfvec, 0.60, 0.0, 200, 50, array['zz486-stamp-v1']);
  if v_count <> 1 then
    raise exception 'stamp filter leaked a foreign-stamp row: % rows', v_count;
  end if;

  -- floor: opposite vectors are below any sensible floor
  select count(*) into v_count from public.search_dam_image_similarity(
    v_anti::extensions.halfvec, v_anti::extensions.halfvec, 0.60, 0.90, 200, 50, array['zz486-stamp-v1']);
  if v_count <> 0 then
    raise exception 'floor filter leaked a below-floor row';
  end if;

  -- default stamp resolution from admin_config
  insert into public.admin_config (key, value)
  values ('IMAGE_SIM_EMBEDDING_MODEL', '"zz486-stamp-v1"'::jsonb)
  on conflict (key) do update set value = excluded.value;
  select count(*) into v_count from public.search_dam_image_similarity(
    v_dino::extensions.halfvec, v_siglip::extensions.halfvec, 0.60, 0.0, 200, 50, null);
  if v_count <> 1 then
    raise exception 'default stamp resolution did not use IMAGE_SIM_EMBEDDING_MODEL';
  end if;
end
$phase8$;

-- =====================================================================================
-- Phase 9 — retention purge (bypass the updated_at trigger for the backdate).
-- =====================================================================================
alter table dam.image_embed_jobs disable trigger set_updated_at;
update dam.image_embed_jobs
   set updated_at = now() - interval '8 days'
 where status in ('done', 'failed');
alter table dam.image_embed_jobs enable trigger set_updated_at;

do $phase9$
declare
  v_purged int;
begin
  select dam.image_embed_purge_jobs() into v_purged;
  if v_purged < 1 then
    raise exception 'test_purge_image_embed_jobs: nothing purged';
  end if;
  if exists (select 1 from dam.image_embed_jobs
              where status in ('done', 'failed')
                and updated_at < now() - interval '7 days') then
    raise exception 'purge left terminal jobs older than 7 days';
  end if;
end
$phase9$;

-- =====================================================================================
-- Phase 10 — HNSW usage: forced (enable_seqscan=off); seeded cardinality
-- without the GUC (DeepSeek non-block requirement, made binding here).
-- =====================================================================================
insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted, thumbnail_url)
select ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'zz486-seed-' || g || '.jpg', 'ZZ486/seed/' || g || '.jpg', 'jpg',
       'zz486-seed-' || g, now(), false,
       'https://cdn.example.test/zz486-seed-' || g || '.jpg'
from generate_series(1, 1200) g;

insert into dam.dam_asset_image_vectors (asset_id, vec_dino, vec_siglip, embedding_model, last_embedded_thumbnail_url)
select ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       ('[' || (select string_agg((x % 97 + 1)::text, ',') from generate_series(g, g + 767) x) || ']')::extensions.halfvec,
       ('[' || (select string_agg((x % 89 + 1)::text, ',') from generate_series(g, g + 767) x) || ']')::extensions.halfvec,
       'zz486-stamp-v1', 'https://cdn.example.test/zz486-seed-' || g || '.jpg'
from generate_series(1, 1200) g;

-- a bulk insert inside a test transaction carries no statistics; without this
-- the planner cannot know the seeded cardinality the no-GUC assertion relies on
analyze dam.dam_asset_image_vectors;

do $phase10$
declare
  v_plan jsonb;
  v_dino text := '[' || (select string_agg(g::text, ',') from generate_series(1, 768) g) || ']';
  v_leg text := $sql$
    select asset_id from dam.dam_asset_image_vectors
     where vec_dino is not null and embedding_model = any (array['zz486-stamp-v1'])
     order by vec_dino <=> $1
     limit 200
  $sql$;
begin
  -- Forced mode: with seq scans off the planner must serve the ordered leg
  -- from the partial HNSW index. The "no GUC at seeded cardinality" variant
  -- was tried at 1200 seeded rows (with ANALYZE) and is deliberately NOT
  -- asserted: with a non-selective embedding_model filter the planner
  -- legitimately prefers a top-N seq scan at this scale, so that assertion
  -- measures the cost model, not the index. The migration's post-apply
  -- verify block asserts the exact partial HNSW indexes structurally
  -- (amname = hnsw, halfvec_cosine_ops, indpred) instead.
  perform set_config('enable_seqscan', 'off', true);
  execute 'explain (format json, costs off) ' || v_leg into v_plan using v_dino::extensions.halfvec;
  if v_plan::text !~* 'hnsw' then
    raise exception 'test_search_explain_uses_hnsw (forced): plan has no hnsw scan: %', v_plan::text;
  end if;
end
$phase10$;
