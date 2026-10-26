-- Issue #4692 (author claim #4725): PopDAM image-similarity home —
-- dam.dam_asset_image_vectors + dam.image_embed_jobs + worker heartbeat and the
-- public SECURITY DEFINER entrypoints for the GPU poller, the Railway backfill
-- op and the edge search. Design: u2giants/popdam3 plan_image_similarity_upload_search.md
-- Step 2 (review chain Muse -> GLM -> DeepSeek -> Muse; tracking issue popdam3 #486).
-- derived-from: none
--
-- WHAT THIS CREATES.
--   * dam.dam_asset_image_vectors — one row per asset: vec_dino + vec_siglip
--     extensions.halfvec(768) (both legs written atomically, CHECK-enforced),
--     embedding_model stamp, border_cropped, last_embedded_thumbnail_url
--     watermark, computed_at. Partial HNSW (halfvec_cosine_ops) per leg.
--   * dam.image_embed_jobs — one queue table for 'index' and 'query' jobs with
--     lease claiming (FOR UPDATE SKIP LOCKED), expired-lease reclaim, poison
--     failure at attempts >= 5, unique active index job per asset, and a
--     (kind, status, lease_expires_at) claim index.
--   * dam.image_embed_worker_heartbeat — one row per GPU worker; freshness is
--     "at least one heartbeat within 90 s" (one offline desktop does not make
--     the fleet unavailable).
--   * dam.* functions for the poller (claim / complete / fail / heartbeat /
--     upsert / thumbnail read) and the trigger-side enqueue, plus
--     public.image_embed_enqueue_index / enqueue_query / query_status / status /
--     search_dam_image_similarity wrappers (dam is NOT in pgrst.db_schemas —
--     quirk #64 — so every PostgREST entrypoint is public.* SECURITY DEFINER).
--   * Roles dam_image_embed_worker (NOLOGIN) + dam_image_embed_login (LOGIN
--     member) for pooler least-privilege. NO password appears in this public
--     repository; setting one is a separate credential step (1Password).
--   * pg_cron job purge-image-embed-jobs: done/failed jobs older than 7 days.
--
-- ROLL-OUT SAFETY. The assets trigger no-ops until admin_config
-- IMAGE_EMBED_ENABLED is true (absent key = false), so nothing enqueues at
-- apply time and the poller lane (Step 3) can be built before the flag flips.
--
-- DEVIATION FROM THE REVIEWED PLAN (one): the plan granted the login role
-- SELECT (id, thumbnail_url, is_deleted) on public.assets, but public.assets
-- carries RLS policies scoped to `authenticated`, so that grant would see zero
-- rows. dam.get_image_embed_asset_thumbnails(uuid[]) preserves the
-- least-privilege intent without widening a shared table's RLS.

set statement_timeout = '10min';

-- =====================================================================================
-- Pre-check: pgvector must offer halfvec (>= 0.7) before anything is created.
-- =====================================================================================
do $gate$
declare
  v_extversion text;
begin
  if to_regtype('extensions.halfvec') is null then
    raise exception 'VERIFY FAILED: extensions.halfvec is unavailable; pgvector >= 0.7 is required';
  end if;
  select extversion into v_extversion from pg_extension where extname = 'vector';
  if v_extversion is null or v_extversion < '0.7' then
    raise exception 'VERIFY FAILED: vector extension version % does not support halfvec', v_extversion;
  end if;
end
$gate$;

-- =====================================================================================
-- Roles. Plain `create role` (no if-not-exists): a pre-existing role with unknown
-- attributes must fail the apply rather than be silently adopted (house pattern).
-- No password in this repository.
-- =====================================================================================
create role dam_image_embed_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role dam_image_embed_login login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10;
grant dam_image_embed_worker to dam_image_embed_login;

grant usage on schema dam to dam_image_embed_worker, dam_image_embed_login;
-- The poller's direct SQL casts vector text to extensions.halfvec, so the roles
-- need USAGE on that schema too (function grants alone are not enough).
grant usage on schema extensions to dam_image_embed_worker, dam_image_embed_login;

-- =====================================================================================
-- Embed gate. Absent admin_config key = disabled (fail safe at apply time).
-- =====================================================================================
create or replace function dam.image_embed_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.value #>> '{}' ilike 'true'
       from public.admin_config c
      where c.key = 'IMAGE_EMBED_ENABLED'),
    false);
$$;

comment on function dam.image_embed_enabled() is
  'True only when admin_config.IMAGE_EMBED_ENABLED is exactly true. Read by the assets enqueue trigger; the GPU poller claim loop is expected to honour the same flag, but the database does not enforce that.';

revoke execute on function dam.image_embed_enabled() from public, anon, authenticated;
grant execute on function dam.image_embed_enabled() to service_role, dam_image_embed_worker;

-- =====================================================================================
-- Vector home. Both legs are written by one statement (complete/upsert) and the
-- CHECK keeps them null-or-present together; the partial HNSW indexes only cover
-- present legs.
-- =====================================================================================
create table dam.dam_asset_image_vectors (
  asset_id                     uuid   not null,
  vec_dino                     extensions.halfvec(768) null,
  vec_siglip                   extensions.halfvec(768) null,
  embedding_model              text   not null,
  border_cropped               boolean not null default false,
  last_embedded_thumbnail_url  text   not null,
  computed_at                  timestamptz not null default now(),
  constraint dam_asset_image_vectors_pkey primary key (asset_id),
  constraint dam_asset_image_vectors_asset_fkey
    foreign key (asset_id) references public.assets(id) on delete cascade,
  constraint dam_asset_image_vectors_legs_together_chk
    check ((vec_dino is null) = (vec_siglip is null)),
  constraint dam_asset_image_vectors_stamp_chk
    check (btrim(embedding_model) <> ''),
  constraint dam_asset_image_vectors_watermark_chk
    check (btrim(last_embedded_thumbnail_url) <> '')
);

comment on table dam.dam_asset_image_vectors is
  'PopDAM image-similarity vectors: one DINOv3 + one SigLIP 2 halfvec(768) per asset, with the exact model stamp and the thumbnail URL watermark they were computed from.';

create index dam_asset_image_vectors_vec_dino_hnsw
  on dam.dam_asset_image_vectors
  using hnsw (vec_dino extensions.halfvec_cosine_ops)
  with (m = 16, ef_construction = 64)
  where vec_dino is not null;

create index dam_asset_image_vectors_vec_siglip_hnsw
  on dam.dam_asset_image_vectors
  using hnsw (vec_siglip extensions.halfvec_cosine_ops)
  with (m = 16, ef_construction = 64)
  where vec_siglip is not null;

-- =====================================================================================
-- Job queue: one table, two kinds. Index jobs dedupe to one active row per
-- asset; query jobs carry the upload payload until completion.
-- =====================================================================================
create table dam.image_embed_jobs (
  id                uuid        not null default gen_random_uuid(),
  kind              text        not null,
  asset_id          uuid            null,
  payload           bytea           null,
  status            text        not null default 'pending',
  attempts          integer     not null default 0,
  lease_owner       text            null,
  lease_expires_at  timestamptz     null,
  result_dino       extensions.halfvec(768) null,
  result_siglip     extensions.halfvec(768) null,
  error             text            null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint image_embed_jobs_pkey primary key (id),
  constraint image_embed_jobs_asset_fkey
    foreign key (asset_id) references public.assets(id) on delete cascade,
  constraint image_embed_jobs_kind_chk check (kind in ('index', 'query')),
  constraint image_embed_jobs_status_chk check (status in ('pending', 'leased', 'done', 'failed')),
  constraint image_embed_jobs_attempts_chk check (attempts >= 0),
  constraint image_embed_jobs_index_needs_asset_chk check (kind <> 'index' or asset_id is not null),
  constraint image_embed_jobs_query_needs_payload_chk
    check (kind <> 'query' or payload is not null or status in ('done', 'failed')),
  constraint image_embed_jobs_payload_kind_chk check (payload is null or kind = 'query'),
  constraint image_embed_jobs_results_query_only_chk
    check (kind = 'query' or (result_dino is null and result_siglip is null)),
  constraint image_embed_jobs_lease_pair_chk
    check ((lease_owner is null) = (lease_expires_at is null)),
  constraint image_embed_jobs_lease_active_chk
    check (status <> 'leased' or (lease_owner is not null and lease_expires_at is not null))
);

comment on table dam.image_embed_jobs is
  'PopDAM image-embed queue: index jobs (per-asset thumbnails) and query jobs (uploaded picture payloads) claimed by GPU desktop pollers over the pooler.';

create unique index image_embed_jobs_one_active_index_per_asset_uq
  on dam.image_embed_jobs (asset_id)
  where kind = 'index' and status in ('pending', 'leased');

create index image_embed_jobs_kind_status_lease_idx
  on dam.image_embed_jobs (kind, status, lease_expires_at);

create trigger set_updated_at
before update on dam.image_embed_jobs
for each row execute function app.set_updated_at();

-- =====================================================================================
-- Worker heartbeat: one row per worker, upserted in place.
-- =====================================================================================
create table dam.image_embed_worker_heartbeat (
  worker_id  text        not null,
  seen_at    timestamptz not null,
  constraint image_embed_worker_heartbeat_pkey primary key (worker_id),
  constraint image_embed_worker_heartbeat_worker_chk check (btrim(worker_id) <> '')
);

comment on table dam.image_embed_worker_heartbeat is
  'One row per PopDAM image-embed GPU worker; public.image_embed_status() reports the fleet fresh while at least one row is younger than 90 s.';

-- =====================================================================================
-- dam functions. SECURITY DEFINER, search_path pinned, EXECUTE only for the
-- worker role (the login member) — the grant IS the guard (house pattern).
-- =====================================================================================

-- Enqueue (dedup inside the function, not the trigger body — Muse 12).
create or replace function dam.enqueue_image_embed_index_job(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = dam, public
as $$
begin
  insert into dam.image_embed_jobs (kind, asset_id)
  values ('index', p_asset_id)
  on conflict (asset_id) where kind = 'index' and status in ('pending', 'leased')
  do nothing;
end;
$$;

comment on function dam.enqueue_image_embed_index_job(uuid) is
  'Idempotently enqueue an index job for one asset; ON CONFLICT keeps at most one active index job per asset.';

-- Trigger bridge: raster thumbnails only (jpg/jpeg/png/webp, L-7), distinct URL,
-- gated on IMAGE_EMBED_ENABLED, and an enqueue failure NEVER fails ingest.
create or replace function dam.assets_enqueue_image_embed_trg_fn()
returns trigger
language plpgsql
security definer
set search_path = dam, public
as $$
begin
  begin
    if new.thumbnail_url is not null
       and new.thumbnail_url is distinct from old.thumbnail_url
       and new.thumbnail_url ~* '\.(jpe?g|png|webp)([?#].*)?$'
       and dam.image_embed_enabled()
    then
      perform dam.enqueue_image_embed_index_job(new.id);
    end if;
  exception when others then
    null; -- enqueue failure must not fail ingest
  end;
  return null; -- AFTER trigger
end;
$$;

comment on function dam.assets_enqueue_image_embed_trg_fn() is
  'After-insert / after-thumbnail-update bridge on public.assets: enqueue an image-embed index job for raster thumbnails, never failing ingest.';

create trigger trg_assets_enqueue_image_embed
after insert or update of thumbnail_url on public.assets
for each row execute function dam.assets_enqueue_image_embed_trg_fn();

-- Claim: FOR UPDATE SKIP LOCKED; reclaims expired leases (attempts + 1, still
-- leased, fresh lease) and poisons at attempts >= 5 (DeepSeek D3); query kind
-- claims exactly one row (Muse 15).
create or replace function dam.claim_image_embed_jobs(
  p_kind text,
  p_limit int,
  p_worker_id text,
  p_lease_seconds int
)
returns setof dam.image_embed_jobs
language plpgsql
security definer
set search_path = dam, public
as $$
declare
  v_kind  text    := case p_kind when 'query' then 'query' else 'index' end;
  v_limit int     := case when v_kind = 'query' then 1
                          else greatest(1, least(coalesce(p_limit, 32), 64)) end;
  v_lease int     := greatest(5, least(coalesce(p_lease_seconds,
                          case when v_kind = 'query' then 30 else 300 end), 3600));
  v_worker text   := nullif(btrim(coalesce(p_worker_id, '')), '');
begin
  if v_worker is null then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_WORKER_ID_REQUIRED';
  end if;

  return query
  with candidates as (
    select j.id
    from dam.image_embed_jobs j
    where j.kind = v_kind
      and (j.status = 'pending'
           or (j.status = 'leased' and j.lease_expires_at < now()))
    order by j.created_at
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update dam.image_embed_jobs j
    set status           = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then 'failed' else 'leased' end,
        attempts         = case when j.status = 'leased' then j.attempts + 1
                                else j.attempts end,
        lease_owner      = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then null else v_worker end,
        lease_expires_at = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then null
                                else now() + make_interval(secs => v_lease) end,
        error            = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then left('reclaim poison: attempts >= 5'
                                          || coalesce(': ' || j.error, ''), 1000)
                                else j.error end,
        updated_at       = now()
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select * from claimed
  where status = 'leased';
end;
$$;

comment on function dam.claim_image_embed_jobs(text, integer, text, integer) is
  'Lease pending or expired-lease image-embed jobs for one GPU worker (SKIP LOCKED); reclaim increments attempts and poisons at 5; query kind always claims one row.';

-- All-or-nothing vector upsert (both legs, stamp, watermark in one statement).
create or replace function dam.upsert_dam_asset_image_vectors(
  p_asset_id uuid,
  p_vec_dino extensions.halfvec(768),
  p_vec_siglip extensions.halfvec(768),
  p_embedding_model text,
  p_border_cropped boolean,
  p_last_embedded_thumbnail_url text
)
returns void
language sql
security definer
set search_path = dam
as $$
  insert into dam.dam_asset_image_vectors (
    asset_id, vec_dino, vec_siglip, embedding_model,
    border_cropped, last_embedded_thumbnail_url, computed_at
  )
  values (
    p_asset_id, p_vec_dino, p_vec_siglip, btrim(p_embedding_model),
    coalesce(p_border_cropped, false), p_last_embedded_thumbnail_url, now()
  )
  on conflict (asset_id) do update
  set vec_dino                    = excluded.vec_dino,
      vec_siglip                  = excluded.vec_siglip,
      embedding_model             = excluded.embedding_model,
      border_cropped              = excluded.border_cropped,
      last_embedded_thumbnail_url = excluded.last_embedded_thumbnail_url,
      computed_at                 = now();
$$;

comment on function dam.upsert_dam_asset_image_vectors(uuid, extensions.halfvec(768), extensions.halfvec(768), text, boolean, text) is
  'Atomic per-asset upsert of both image-similarity legs plus the model stamp and thumbnail watermark.';

-- Complete: query jobs keep results on the row (payload nulled); index jobs
-- upsert vectors and re-enqueue when the thumbnail moved underneath us (M-D).
create or replace function dam.complete_image_embed_job(
  p_id uuid,
  p_result_dino extensions.halfvec(768),
  p_result_siglip extensions.halfvec(768),
  p_embedding_model text,
  p_border_cropped boolean,
  p_thumbnail_url text
)
returns void
language plpgsql
security definer
set search_path = dam, public
as $$
declare
  v_job dam.image_embed_jobs%rowtype;
begin
  if p_result_dino is null or p_result_siglip is null then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_BOTH_LEGS_REQUIRED';
  end if;

  select * into v_job from dam.image_embed_jobs where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAM_IMAGE_EMBED_JOB_NOT_FOUND';
  end if;
  if v_job.status <> 'leased' then
    raise exception using errcode = '42501', message = 'DAM_IMAGE_EMBED_JOB_NOT_LEASED';
  end if;

  if v_job.kind = 'query' then
    update dam.image_embed_jobs
    set status = 'done',
        result_dino = p_result_dino,
        result_siglip = p_result_siglip,
        payload = null,
        error = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_id;
  else
    if nullif(btrim(coalesce(p_embedding_model, '')), '') is null then
      raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_MODEL_STAMP_REQUIRED';
    end if;

    update dam.image_embed_jobs
    set status = 'done',
        error = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_id;

    perform dam.upsert_dam_asset_image_vectors(
      v_job.asset_id, p_result_dino, p_result_siglip,
      p_embedding_model, p_border_cropped, p_thumbnail_url);

    if exists (select 1 from public.assets a
                where a.id = v_job.asset_id
                  and a.thumbnail_url is distinct from p_thumbnail_url) then
      perform dam.enqueue_image_embed_index_job(v_job.asset_id);
    end if;
  end if;
end;
$$;

comment on function dam.complete_image_embed_job(uuid, extensions.halfvec(768), extensions.halfvec(768), text, boolean, text) is
  'Mark a leased embed job done: query jobs keep both result vectors (payload dropped); index jobs upsert the asset vectors and re-enqueue when the thumbnail changed.';

create or replace function dam.fail_image_embed_job(
  p_id uuid,
  p_error text,
  p_permanent boolean default false
)
returns void
language plpgsql
security definer
set search_path = dam
as $$
begin
  update dam.image_embed_jobs
  set attempts = attempts + 1,
      status = case when p_permanent or attempts + 1 >= 5 then 'failed' else 'pending' end,
      lease_owner = null,
      lease_expires_at = null,
      payload = case when p_permanent or attempts + 1 >= 5 then null else payload end,
      error = left(coalesce(nullif(btrim(p_error), ''), 'unknown image-embed error'), 1000),
      updated_at = now()
  where id = p_id
    and status = 'leased';

  if not found then
    raise exception using errcode = '42501', message = 'DAM_IMAGE_EMBED_JOB_NOT_LEASED';
  end if;
end;
$$;

comment on function dam.fail_image_embed_job(uuid, text, boolean) is
  'Fail or requeue a leased embed job: permanent failures and the 5th attempt land failed (query payload dropped), otherwise the job returns to pending.';

create or replace function dam.image_embed_worker_heartbeat(p_worker_id text)
returns void
language sql
security definer
set search_path = dam
as $$
  insert into dam.image_embed_worker_heartbeat (worker_id, seen_at)
  values (nullif(btrim(p_worker_id), ''), now())
  on conflict (worker_id) do update
  set seen_at = now();
$$;

comment on function dam.image_embed_worker_heartbeat(text) is
  'Upsert one heartbeat row per GPU worker; no table growth.';

create or replace function dam.image_embed_workers_fresh(p_stale_seconds int default 90)
returns boolean
language sql
stable
security definer
set search_path = dam
as $$
  select exists (
    select 1 from dam.image_embed_worker_heartbeat
    where seen_at > now() - make_interval(secs => least(greatest(coalesce(p_stale_seconds, 90), 1), 86400))
  );
$$;

comment on function dam.image_embed_workers_fresh(integer) is
  'True while at least one worker heartbeat is fresher than the window; internal — the edge reads freshness only through public.image_embed_status().';

-- Thumbnail read helper for the poller (see header: replaces the reviewed plan's
-- direct column grant, which public.assets RLS would empty out).
create or replace function dam.get_image_embed_asset_thumbnails(p_asset_ids uuid[])
returns table (asset_id uuid, thumbnail_url text, is_deleted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.thumbnail_url, a.is_deleted
  from public.assets a
  where a.id = any (coalesce(p_asset_ids, '{}'::uuid[]))
    and a.thumbnail_url is not null;
$$;

comment on function dam.get_image_embed_asset_thumbnails(uuid[]) is
  'Poller helper: (id, thumbnail_url, is_deleted) for claimed index jobs without granting the login role any direct path into public.assets RLS.';

create or replace function dam.image_embed_purge_jobs()
returns integer
language plpgsql
security definer
set search_path = dam
as $$
declare
  v_deleted integer;
begin
  delete from dam.image_embed_jobs
  where status in ('done', 'failed')
    and updated_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function dam.image_embed_purge_jobs() is
  'Purge done/failed embed jobs older than 7 days; scheduled daily by pg_cron job purge-image-embed-jobs.';

-- =====================================================================================
-- public entrypoints (SECURITY DEFINER; never call dam.* over PostgREST).
-- =====================================================================================
create or replace function public.image_embed_enqueue_index(p_asset_id uuid)
returns boolean
language plpgsql
security definer
set search_path = dam, public
as $$
begin
  if not exists (select 1 from public.assets a where a.id = p_asset_id) then
    return false;
  end if;
  if exists (select 1 from dam.image_embed_jobs j
              where j.kind = 'index' and j.asset_id = p_asset_id
                and j.status in ('pending', 'leased')) then
    return true;
  end if;
  perform dam.enqueue_image_embed_index_job(p_asset_id);
  return true;
end;
$$;

comment on function public.image_embed_enqueue_index(uuid) is
  'Service-role entrypoint: enqueue an index job for one asset; true when inserted or already active, false when the asset does not exist.';

create or replace function public.image_embed_enqueue_query(p_payload bytea)
returns uuid
language plpgsql
security definer
set search_path = dam
as $$
declare
  v_id uuid;
begin
  if p_payload is null or octet_length(p_payload) = 0 then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_PAYLOAD_REQUIRED';
  end if;
  if octet_length(p_payload) > 16 * 1024 * 1024 then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_PAYLOAD_TOO_LARGE';
  end if;

  insert into dam.image_embed_jobs (kind, payload)
  values ('query', p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.image_embed_enqueue_query(bytea) is
  'Service-role entrypoint (edge, after authenticateUser): enqueue one query job carrying the uploaded picture bytes; vectors come back via image_embed_query_status.';

create or replace function public.image_embed_query_status(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = dam
as $$
  select jsonb_build_object(
    'status', j.status,
    'reason', j.error,
    'dino', case when j.status = 'done' then j.result_dino::text end,
    'siglip', case when j.status = 'done' then j.result_siglip::text end,
    'embedding_model', null
  )
  from dam.image_embed_jobs j
  where j.id = p_id and j.kind = 'query';
$$;

comment on function public.image_embed_query_status(uuid) is
  'Query-job status for the edge: status/reason plus both vectors as pgvector text once done (cast back to halfvec at the search RPC).';

create or replace function public.image_embed_status()
returns jsonb
language sql
stable
security definer
set search_path = dam
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'leased', count(*) filter (where status = 'leased'),
    'failed', count(*) filter (where status = 'failed'),
    'done', count(*) filter (where status = 'done'),
    'workers_fresh', dam.image_embed_workers_fresh(90),
    'stale_after_seconds', 90
  )
  from dam.image_embed_jobs;
$$;

comment on function public.image_embed_status() is
  'The only freshness API the edge may call: queue counts plus workers_fresh (>=1 heartbeat within 90 s).';

create or replace function public.search_dam_image_similarity(
  p_query_dino extensions.halfvec(768),
  p_query_siglip extensions.halfvec(768),
  p_dino_weight numeric default 0.60,
  p_floor numeric default 0.90,
  p_top_k int default 200,
  p_limit int default 50,
  p_model_stamps text[] default null
)
returns table (
  asset_id uuid,
  dino_pct numeric,
  siglip_pct numeric,
  combined_pct numeric,
  thumbnail_url text,
  filename text,
  relative_path text,
  sku text
)
language plpgsql
volatile
security definer
set search_path = public, dam, extensions
set statement_timeout = '8s'
as $$
declare
  v_stamps text[];
  v_weight numeric := greatest(0, least(coalesce(p_dino_weight, 0.60), 1));
  v_floor  numeric := greatest(0, least(coalesce(p_floor, 0.90), 1));
  -- hnsw.ef_search is hard-capped at 1000 by pgvector; a larger p_top_k
  -- must clamp here or set_config raises at query time.
  v_top_k  int     := greatest(1, least(coalesce(p_top_k, 200), 1000));
  v_limit  int     := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if p_model_stamps is not null and cardinality(array_remove(p_model_stamps, null)) > 0 then
    v_stamps := p_model_stamps;
  else
    select array_agg(distinct s) into v_stamps
    from (
      select (select c.value #>> '{}'
                from public.admin_config c
               where c.key = 'IMAGE_SIM_EMBEDDING_MODEL') as s
      union
      select case when coalesce((select c.value #>> '{}'
                                   from public.admin_config c
                                  where c.key = 'IMAGE_SIM_REEMBED_IN_PROGRESS'), 'false') ilike 'true'
                  then (select c.value #>> '{}'
                          from public.admin_config c
                         where c.key = 'IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS')
             end
    ) t
    where nullif(btrim(s), '') is not null;
  end if;

  if v_stamps is null or cardinality(v_stamps) = 0 then
    return; -- no configured stamp and none supplied: nothing is indexed yet
  end if;

  perform set_config('hnsw.ef_search', greatest(v_top_k, 100)::text, true);

  return query
  with
  dino_ann as (
    select v.asset_id, (1 - (v.vec_dino <=> p_query_dino))::numeric as dino_sim
    from dam.dam_asset_image_vectors v
    where v.vec_dino is not null
      and v.embedding_model = any (v_stamps)
    order by v.vec_dino <=> p_query_dino
    limit v_top_k
  ),
  siglip_ann as (
    select v.asset_id, (1 - (v.vec_siglip <=> p_query_siglip))::numeric as siglip_sim
    from dam.dam_asset_image_vectors v
    where v.vec_siglip is not null
      and v.embedding_model = any (v_stamps)
    order by v.vec_siglip <=> p_query_siglip
    limit v_top_k
  ),
  legs as (
    select coalesce(d.asset_id, s.asset_id) as asset_id,
           d.dino_sim, s.siglip_sim
    from dino_ann d
    full outer join siglip_ann s on s.asset_id = d.asset_id
  ),
  filled as (
    -- exact lookup for the leg an ANN pass missed (Muse: top-K then blend)
    select l.asset_id,
           coalesce(l.dino_sim, (1 - (v.vec_dino <=> p_query_dino))::numeric) as dino_sim,
           coalesce(l.siglip_sim, (1 - (v.vec_siglip <=> p_query_siglip))::numeric) as siglip_sim
    from legs l
    left join dam.dam_asset_image_vectors v
      on v.asset_id = l.asset_id
     and (l.dino_sim is null or l.siglip_sim is null)
     and v.embedding_model = any (v_stamps)
  ),
  blended as (
    select f.asset_id, f.dino_sim, f.siglip_sim,
           (v_weight * f.dino_sim + (1 - v_weight) * f.siglip_sim) as combined
    from filled f
    where f.dino_sim is not null and f.siglip_sim is not null
  )
  select b.asset_id,
         round(b.dino_sim * 100, 1),
         round(b.siglip_sim * 100, 1),
         round(b.combined * 100, 1),
         a.thumbnail_url,
         a.filename,
         a.relative_path,
         a.sku
  from blended b
  join public.assets a
    on a.id = b.asset_id
   and a.is_deleted = false
  where b.combined >= v_floor
  order by b.combined desc
  limit v_limit;
end;
$$;

comment on function public.search_dam_image_similarity(extensions.halfvec(768), extensions.halfvec(768), numeric, numeric, integer, integer, text[]) is
  'Authenticated image-similarity search: per-leg ANN top-K, exact fill for a missed leg, weighted blend (default 0.60 DINOv3), floor filter, model-stamp window.';

-- =====================================================================================
-- RLS + grants. Browser roles get nothing on the tables; access is function-only.
-- The worker/login pair may SELECT jobs and heartbeat rows directly (pooler SQL
-- observability); writes go through the guarded functions.
-- =====================================================================================
alter table dam.dam_asset_image_vectors enable row level security;
alter table dam.image_embed_jobs enable row level security;
alter table dam.image_embed_worker_heartbeat enable row level security;

revoke all on dam.dam_asset_image_vectors, dam.image_embed_jobs, dam.image_embed_worker_heartbeat
  from public, anon, authenticated, service_role;

grant select on dam.image_embed_jobs, dam.image_embed_worker_heartbeat
  to dam_image_embed_worker;

create policy image_embed_worker_jobs_read on dam.image_embed_jobs
  for select to dam_image_embed_worker using (true);
create policy image_embed_worker_heartbeat_read on dam.image_embed_worker_heartbeat
  for select to dam_image_embed_worker using (true);

revoke execute on function dam.enqueue_image_embed_index_job(uuid),
                dam.assets_enqueue_image_embed_trg_fn(),
                dam.claim_image_embed_jobs(text, integer, text, integer),
                dam.complete_image_embed_job(uuid, extensions.halfvec(768), extensions.halfvec(768), text, boolean, text),
                dam.fail_image_embed_job(uuid, text, boolean),
                dam.upsert_dam_asset_image_vectors(uuid, extensions.halfvec(768), extensions.halfvec(768), text, boolean, text),
                dam.image_embed_worker_heartbeat(text),
                dam.image_embed_workers_fresh(integer),
                dam.get_image_embed_asset_thumbnails(uuid[]),
                dam.image_embed_purge_jobs()
  from public, anon, authenticated, service_role;

grant execute on function dam.claim_image_embed_jobs(text, integer, text, integer),
                      dam.complete_image_embed_job(uuid, extensions.halfvec(768), extensions.halfvec(768), text, boolean, text),
                      dam.fail_image_embed_job(uuid, text, boolean),
                      dam.upsert_dam_asset_image_vectors(uuid, extensions.halfvec(768), extensions.halfvec(768), text, boolean, text),
                      dam.image_embed_worker_heartbeat(text),
                      dam.get_image_embed_asset_thumbnails(uuid[])
  to dam_image_embed_worker;

revoke execute on function public.image_embed_enqueue_index(uuid),
                public.image_embed_enqueue_query(bytea),
                public.image_embed_query_status(uuid),
                public.image_embed_status(),
                public.search_dam_image_similarity(extensions.halfvec(768), extensions.halfvec(768), numeric, numeric, integer, integer, text[])
  from public, anon;

grant execute on function public.image_embed_enqueue_index(uuid),
                      public.image_embed_enqueue_query(bytea),
                      public.image_embed_query_status(uuid),
                      public.image_embed_status()
  to service_role;

grant execute on function public.search_dam_image_similarity(extensions.halfvec(768), extensions.halfvec(768), numeric, numeric, integer, integer, text[])
  to authenticated, service_role;

-- =====================================================================================
-- Retention: daily purge of terminal jobs.
-- =====================================================================================
do $cron$
begin
  perform cron.schedule(
    'purge-image-embed-jobs',
    '17 3 * * *',
    $cron_body$ select dam.image_embed_purge_jobs() $cron_body$
  );
end;
$cron$;

-- =====================================================================================
-- POST-APPLY VERIFICATION. Fails the apply unless the whole contract above is
-- standing. Behavioural proofs: supabase/tests/popdam_image_similarity_contracts.sql.
-- =====================================================================================
do $verify$
begin
  if to_regclass('dam.dam_asset_image_vectors') is null
     or to_regclass('dam.image_embed_jobs') is null
     or to_regclass('dam.image_embed_worker_heartbeat') is null then
    raise exception 'VERIFY FAILED: a dam image-embed table is missing';
  end if;

  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'dam' and c.relname = 'dam_asset_image_vectors' and c.relrowsecurity)
     or not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'dam' and c.relname = 'image_embed_jobs' and c.relrowsecurity)
     or not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'dam' and c.relname = 'image_embed_worker_heartbeat' and c.relrowsecurity) then
    raise exception 'VERIFY FAILED: RLS is not enabled on every image-embed table';
  end if;

  if exists (select 1 from information_schema.table_privileges
              where table_schema = 'dam'
                and table_name in ('dam_asset_image_vectors', 'image_embed_jobs', 'image_embed_worker_heartbeat')
                and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) then
    raise exception 'VERIFY FAILED: a browser or service role holds a grant on an image-embed table';
  end if;

  if (select count(*) from pg_index i
       join pg_class c on c.oid = i.indexrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_am am on am.oid = c.relam
       where n.nspname = 'dam'
         and c.relname in ('dam_asset_image_vectors_vec_dino_hnsw',
                           'dam_asset_image_vectors_vec_siglip_hnsw')
         and am.amname = 'hnsw'
         and i.indpred is not null
         and pg_get_indexdef(i.indexrelid) like '%halfvec_cosine_ops%') <> 2 then
    raise exception 'VERIFY FAILED: the two partial HNSW halfvec_cosine_ops leg indexes are missing or malformed';
  end if;

  if not exists (select 1 from pg_index i
       join pg_class c on c.oid = i.indexrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'dam'
         and c.relname = 'image_embed_jobs_one_active_index_per_asset_uq'
         and i.indisunique
         and i.indpred is not null) then
    raise exception 'VERIFY FAILED: the unique partial active-index-per-asset index is missing or malformed';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.assets'::regclass
                  and tgname = 'trg_assets_enqueue_image_embed' and not tgisinternal) then
    raise exception 'VERIFY FAILED: assets enqueue trigger is missing';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'dam_image_embed_worker' and not rolcanlogin)
     or not exists (select 1 from pg_roles where rolname = 'dam_image_embed_login' and rolcanlogin)
     or not pg_has_role('dam_image_embed_login', 'dam_image_embed_worker', 'USAGE') then
    raise exception 'VERIFY FAILED: image-embed role pair or membership is wrong';
  end if;

  if not has_function_privilege('dam_image_embed_worker', 'dam.claim_image_embed_jobs(text,integer,text,integer)', 'EXECUTE')
     or not has_function_privilege('dam_image_embed_worker', 'dam.complete_image_embed_job(uuid,extensions.halfvec,extensions.halfvec,text,boolean,text)', 'EXECUTE')
     or not has_function_privilege('dam_image_embed_worker', 'dam.get_image_embed_asset_thumbnails(uuid[])', 'EXECUTE') then
    raise exception 'VERIFY FAILED: worker role lacks a required dam function grant';
  end if;

  if not has_function_privilege('service_role', 'public.image_embed_enqueue_query(bytea)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.image_embed_status()', 'EXECUTE') then
    raise exception 'VERIFY FAILED: service_role lacks a required public wrapper grant';
  end if;

  if not has_function_privilege('authenticated', 'public.search_dam_image_similarity(extensions.halfvec,extensions.halfvec,numeric,numeric,integer,integer,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.image_embed_enqueue_query(bytea)', 'EXECUTE')
     or has_function_privilege('anon', 'public.search_dam_image_similarity(extensions.halfvec,extensions.halfvec,numeric,numeric,integer,integer,text[])', 'EXECUTE') then
    raise exception 'VERIFY FAILED: search execute is not authenticated-only';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'dam'
         and policyname in ('image_embed_worker_jobs_read', 'image_embed_worker_heartbeat_read')) <> 2 then
    raise exception 'VERIFY FAILED: worker read policies are missing';
  end if;

  if not exists (select 1 from cron.job where jobname = 'purge-image-embed-jobs') then
    raise exception 'VERIFY FAILED: purge-image-embed-jobs cron job is missing';
  end if;
end
$verify$;
