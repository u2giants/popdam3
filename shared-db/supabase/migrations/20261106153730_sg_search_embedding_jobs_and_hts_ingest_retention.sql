-- Claim #5890 (work issue #5758, plan_db-anti-bloat-safeguards.md Step 4).
-- derived-from: none
--
-- 1) PopSG embedding queue state moves off the wide search document.
--    public.style_guide_search_documents is ~2.3 GB with 14 indexes and 0% HOT
--    updates (2026-11-06: 205,802 updates, 0 HOT). Every claim, error and
--    reset rewrote the whole wide row and all of its index entries just to move
--    a lease or an attempt counter. That state now lives in the narrow
--    public.style_guide_search_embedding_jobs (primary key only, fillfactor 70,
--    so its updates are HOT). The document keeps only the result
--    (embedding, embedding_model, embedding_updated_at).
--
--    A job row is valid only while its content_sha256 equals the document's.
--    When content changes, the refresh already clears the document's vector;
--    a job row for the old content is simply ignored (and replaced at the next
--    claim), so the refresh needs no change. A completed embedding deletes its
--    job row, so the table holds only pending / failed work.
--
--    The legacy document columns embedding_error, embedding_error_category,
--    embedding_next_retry_at, embedding_attempts, embedding_max_attempts and
--    embedding_lease_* are no longer read or written by the embedding RPCs.
--    No application reads them directly (popdam3 and supabase/functions only
--    call the RPCs). They are dropped in a later release, together with the
--    refresh's CASE that still clears them on content change.
--
-- 2) hts_rag.hts_rag_ruling_ingest_jobs keeps finished ('done') jobs for 30
--    days. A queue should not hold history forever; failures ('dead_letter')
--    stay, because the HTS ruling library status page lists them.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1a. The narrow jobs table.
-- ---------------------------------------------------------------------------
create table public.style_guide_search_embedding_jobs (
  style_guide_file_id uuid primary key
    references public.style_guide_search_documents (style_guide_file_id) on delete cascade,
  content_sha256 text not null,
  lease_token uuid,
  claimed_by text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts >= 1),
  error text,
  error_category text check (error_category in ('transient', 'permanent')),
  next_retry_at timestamptz,
  updated_at timestamptz not null default now()
) with (fillfactor = 70);

comment on table public.style_guide_search_embedding_jobs is
  'Issue #5758 Step 4. Lease, attempt and error state of the PopSG image-embedding queue, one row per search document with pending or failed embedding work. Only the primary key is indexed so every lease/attempt update is HOT. A row applies only while content_sha256 equals the document''s; a successful embedding deletes it. Written only by claim_sg_search_embedding_documents, upsert_sg_search_embedding, mark_sg_search_embedding_error and reset_sg_search_embedding_errors.';

alter table public.style_guide_search_embedding_jobs enable row level security;
revoke all on table public.style_guide_search_embedding_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.style_guide_search_embedding_jobs to service_role;

-- Backfill: carry live state for documents still waiting for a vector.
insert into public.style_guide_search_embedding_jobs
  (style_guide_file_id, content_sha256, lease_token, claimed_by, lease_expires_at,
   attempt_count, max_attempts, error, error_category, next_retry_at, updated_at)
select d.style_guide_file_id, d.content_sha256, d.embedding_lease_token, d.embedding_lease_owner,
       d.embedding_lease_expires_at, d.embedding_attempts, d.embedding_max_attempts,
       d.embedding_error, d.embedding_error_category, d.embedding_next_retry_at, now()
  from public.style_guide_search_documents d
 where d.embedding is null
   and d.content_sha256 is not null
   and (d.embedding_attempts <> 0
        or d.embedding_max_attempts <> 5
        or d.embedding_error is not null
        or d.embedding_error_category is not null
        or d.embedding_next_retry_at is not null
        or d.embedding_lease_token is not null
        or d.embedding_lease_owner is not null
        or d.embedding_lease_expires_at is not null);

-- ---------------------------------------------------------------------------
-- 1b. Claim: locks the document row (no new row version) and writes the job.
-- ---------------------------------------------------------------------------
create or replace function public.claim_sg_search_embedding_documents(
  p_limit integer default 100,
  p_worker_id text default null,
  p_lease_seconds integer default 300)
returns table(style_guide_file_id uuid, search_text text, thumbnail_url text, content_sha256 text,
              lease_token uuid, lease_expires_at timestamptz, attempt integer)
language plpgsql
security definer
set search_path to 'public', 'extensions'
set enable_hashjoin to 'off'
set enable_mergejoin to 'off'
set enable_sort to 'off'
as $function$
begin
  if (select auth.role()) <> 'service_role' or nullif(btrim(p_worker_id), '') is null then
    raise exception 'service_role and worker id required' using errcode = '42501';
  end if;
  -- The worker must embed the LIVE thumbnail the content identity names
  -- (snapshot equals live URL); documents without a thumbnail are not claimable.
  return query with candidates as (
    select d.style_guide_file_id, d.content_sha256
      from public.style_guide_search_documents d
      join public.style_guide_files f on f.id = d.style_guide_file_id
      left join public.style_guide_search_embedding_jobs j
        on j.style_guide_file_id = d.style_guide_file_id
       and j.content_sha256 = d.content_sha256
     where d.is_active and f.is_active
       and d.thumbnail_url is not distinct from f.thumbnail_url
       and f.thumbnail_url is not null
       and d.content_sha256 is not null
       and d.embedding is null
       and coalesce(j.attempt_count, 0) < coalesce(j.max_attempts, 5)
       and (j.next_retry_at is null or j.next_retry_at <= now())
       and (j.lease_expires_at is null or j.lease_expires_at <= now())
       and j.error_category is distinct from 'permanent'
     order by d.document_updated_at, d.style_guide_file_id
     for update of d skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 1000))
  ), claimed as (
    insert into public.style_guide_search_embedding_jobs as j
      (style_guide_file_id, content_sha256, lease_token, claimed_by, lease_expires_at,
       attempt_count, max_attempts, updated_at)
    select c.style_guide_file_id, c.content_sha256, gen_random_uuid(), p_worker_id,
           now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600))),
           1, 5, now()
      from candidates c
    on conflict on constraint style_guide_search_embedding_jobs_pkey do update
       set lease_token = excluded.lease_token,
           claimed_by = excluded.claimed_by,
           lease_expires_at = excluded.lease_expires_at,
           attempt_count = case when j.content_sha256 = excluded.content_sha256
                                then j.attempt_count + 1 else 1 end,
           max_attempts = case when j.content_sha256 = excluded.content_sha256
                               then j.max_attempts else 5 end,
           error = case when j.content_sha256 = excluded.content_sha256 then j.error end,
           error_category = case when j.content_sha256 = excluded.content_sha256 then j.error_category end,
           next_retry_at = case when j.content_sha256 = excluded.content_sha256 then j.next_retry_at end,
           content_sha256 = excluded.content_sha256,
           updated_at = now()
    returning j.style_guide_file_id, j.content_sha256, j.lease_token, j.lease_expires_at, j.attempt_count)
  select d.style_guide_file_id,
         left(d.filename || ' ' || d.style_guide_name || ' ' || coalesce(d.property_folder, '') || ' ' ||
              coalesce(d.licensor_name, ''), 8000),
         d.thumbnail_url, c.content_sha256, c.lease_token, c.lease_expires_at, c.attempt_count
    from claimed c
    join public.style_guide_search_documents d on d.style_guide_file_id = c.style_guide_file_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1c. Result: writes the document only when the vector or model changes;
--     releases the lease by deleting the job row.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_sg_search_embedding(
  p_style_guide_file_id uuid,
  p_content_sha256 text,
  p_lease_token uuid,
  p_embedding extensions.vector,
  p_embedding_model text default 'google/siglip2-base-patch16-naflex')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_embedding_model is distinct from 'google/siglip2-base-patch16-naflex'
     or extensions.vector_dims(p_embedding) is distinct from 768 then
    raise exception 'unsupported embedding model or dimension' using errcode = '22023';
  end if;
  delete from public.style_guide_search_embedding_jobs j
   where j.style_guide_file_id = p_style_guide_file_id
     and j.content_sha256 = p_content_sha256
     and j.lease_token = p_lease_token
     and j.lease_expires_at > now()
     and exists (select 1 from public.style_guide_search_documents d
                  where d.style_guide_file_id = p_style_guide_file_id
                    and d.content_sha256 = p_content_sha256);
  if not found then
    return false;  -- no live lease: nothing is written anywhere
  end if;
  -- pgvector has no equality operator; the text cast is the exact comparison.
  -- An equal vector and model write nothing to the wide row (#5758 D2).
  update public.style_guide_search_documents
     set embedding = p_embedding,
         embedding_model = p_embedding_model,
         embedding_updated_at = now()
   where style_guide_file_id = p_style_guide_file_id
     and content_sha256 = p_content_sha256
     and (embedding is null
          or embedding::text is distinct from p_embedding::text
          or embedding_model is distinct from p_embedding_model);
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1d. Error: records on the job row only; clearing the token makes a repeat
--     under the same (now dead) lease a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.mark_sg_search_embedding_error(
  p_style_guide_file_id uuid,
  p_content_sha256 text,
  p_lease_token uuid,
  p_error text,
  p_category text default 'transient')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_category not in ('transient', 'permanent') then
    raise exception 'invalid embedding error category' using errcode = '22023';
  end if;
  update public.style_guide_search_embedding_jobs j
     set error = left(coalesce(p_error, 'unknown embedding error'), 1000),
         error_category = case when p_category = 'permanent' or j.attempt_count >= j.max_attempts
                               then 'permanent' else 'transient' end,
         next_retry_at = case when p_category = 'transient' and j.attempt_count < j.max_attempts
                              then now() + make_interval(secs => least(3600, 30 * power(2, greatest(0, j.attempt_count - 1))::int)) end,
         lease_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where j.style_guide_file_id = p_style_guide_file_id
     and j.content_sha256 = p_content_sha256
     and j.lease_token = p_lease_token
     and j.lease_expires_at > now()
     and exists (select 1 from public.style_guide_search_documents d
                  where d.style_guide_file_id = p_style_guide_file_id
                    and d.content_sha256 = p_content_sha256);
  return found;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1e. Reset: deleting the job row IS the reset (attempts 0, no error, no lease).
-- ---------------------------------------------------------------------------
create or replace function public.reset_sg_search_embedding_errors(p_style_guide_file_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  delete from public.style_guide_search_embedding_jobs j
   using public.style_guide_search_documents d
   where d.style_guide_file_id = j.style_guide_file_id
     and d.embedding is null
     and (p_style_guide_file_ids is null or j.style_guide_file_id = any (p_style_guide_file_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1f. Meters read the job table (same JSON keys and meanings as before).
-- ---------------------------------------------------------------------------
create or replace function public.get_sg_search_embedding_status()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with jobs as (
  select j.*
    from public.style_guide_search_embedding_jobs j
    join public.style_guide_search_documents d
      on d.style_guide_file_id = j.style_guide_file_id
     and d.content_sha256 = j.content_sha256
     and d.embedding is null
)
select jsonb_build_object(
  'total_documents', (select count(*) from public.style_guide_search_documents),
  'embedded_documents', (select count(*) from public.style_guide_search_documents where embedding is not null),
  'pending_documents', (
    select count(*) from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and not exists (select 1 from jobs j where j.style_guide_file_id = d.style_guide_file_id
                          and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
       and exists (select 1 from public.style_guide_files f
                    where f.id = d.style_guide_file_id and f.thumbnail_url is not null)),
  'waiting_for_thumbnail_documents', (
    select count(*) from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and not exists (select 1 from public.style_guide_files f
                        where f.id = d.style_guide_file_id and f.thumbnail_url is not null)),
  'unidentified_documents', (select count(*) from public.style_guide_search_documents where content_sha256 is null),
  'leased_documents', (select count(*) from jobs where lease_expires_at > now()),
  'errored_documents', (select count(*) from jobs where error is not null),
  'exhausted_documents', (select count(*) from jobs where attempt_count >= max_attempts or error_category = 'permanent'),
  'oldest_pending_updated_at', (
    select d.document_updated_at from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and exists (select 1 from public.style_guide_files f
                    where f.id = d.style_guide_file_id and f.thumbnail_url is not null)
     order by d.document_updated_at
     limit 1),
  'newest_updated_at', (select max(document_updated_at) from public.style_guide_search_documents)
)
$function$;

create or replace function public.get_search_embedding_health()
returns table(corpus text, pending bigint, errored bigint, last_write timestamptz,
              minutes_since_last_write numeric, stale boolean)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role'
     and not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'admin required' using errcode='42501';
  end if;
  return query
  with sg_jobs as (
    select j.*
      from public.style_guide_search_embedding_jobs j
      join public.style_guide_search_documents d
        on d.style_guide_file_id = j.style_guide_file_id
       and d.content_sha256 = j.content_sha256
       and d.embedding is null
  ), counts as (
    select 'dam'::text name,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) pending_count,
      (select count(*) from public.dam_search_documents d where d.embedding_error is not null) error_count,
      (select max(d.embedding_updated_at) from public.dam_search_documents d where d.embedding_updated_at is not null) written,
      (select min(d.indexed_at) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) oldest
    union all
    select 'popsg',
      (select count(*) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null)),
      (select count(*) from sg_jobs j where j.error is not null),
      (select max(d.embedding_updated_at) from public.style_guide_search_documents d where d.is_active and d.embedding_updated_at is not null),
      (select min(d.document_updated_at) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null))
  )
  select name,pending_count,error_count,written,extract(epoch from(now()-written))/60,
    pending_count>0 and (coalesce(written,oldest) is null or coalesce(written,oldest)<=now()-interval '120 minutes')
  from counts;
end;
$function$;

comment on column public.style_guide_search_documents.embedding_attempts is
  'DEPRECATED (#5758 Step 4): queue state moved to public.style_guide_search_embedding_jobs; not read or written by the embedding RPCs. Dropped in a later release.';
comment on column public.style_guide_search_documents.embedding_lease_token is
  'DEPRECATED (#5758 Step 4): queue state moved to public.style_guide_search_embedding_jobs. Dropped in a later release.';
comment on column public.style_guide_search_documents.embedding_error is
  'DEPRECATED (#5758 Step 4): queue state moved to public.style_guide_search_embedding_jobs. Dropped in a later release.';

-- ---------------------------------------------------------------------------
-- 2. hts_rag ingest-job retention: finished jobs older than 30 days.
-- ---------------------------------------------------------------------------
create or replace function hts_rag.prune_ruling_ingest_jobs(p_dry_run boolean default true)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, hts_rag
set lock_timeout = '2s'
as $$
declare
  v_cutoff timestamptz := now() - interval '30 days';
  v_total bigint := 0;
  v_batch bigint;
begin
  if p_dry_run then
    select count(*) into v_total
      from hts_rag.hts_rag_ruling_ingest_jobs
     where status = 'done' and completed_at < v_cutoff;
    return v_total;
  end if;
  loop
    delete from hts_rag.hts_rag_ruling_ingest_jobs j
     where j.id in (select id from hts_rag.hts_rag_ruling_ingest_jobs
                     where status = 'done' and completed_at < v_cutoff
                     limit 20000);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch = 0;
  end loop;
  return v_total;
end;
$$;

revoke all on function hts_rag.prune_ruling_ingest_jobs(boolean) from public, anon, authenticated;
grant execute on function hts_rag.prune_ruling_ingest_jobs(boolean) to service_role;
comment on function hts_rag.prune_ruling_ingest_jobs(boolean) is
  'Issue #5758 Step 4. Deletes hts_rag_ruling_ingest_jobs rows with status done and completed_at older than 30 days, in batches of 20,000. dead_letter, pending and claimed rows are never touched. Dry run (default) only counts. Weekly pg_cron job hts-rag-ingest-jobs-retention runs it for real.';

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'hts-rag-ingest-jobs-retention' loop
    perform cron.unschedule(v_job_id);
  end loop;
  -- Sundays 08:15 UTC = 3:15 AM EST, right after the ColdLion rotation (Step 2).
  perform cron.schedule(
    'hts-rag-ingest-jobs-retention',
    '15 8 * * 0',
    $cron_body$ select hts_rag.prune_ruling_ingest_jobs(false) $cron_body$
  );
end;
$cron$;

commit;
