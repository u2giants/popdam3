-- derived-from: 20261204003429
-- Claim popcre/shared-db#6630. Application u2giants/popdam3#1037 (Production
-- Canary calls public.get_search_embedding_health()).
--
-- Problem (production, read-only, 2026-11-17 8 PM EST): the health function took
-- 63 s, so PostgREST returned 500. The time was full scans on an IO-capped disk:
--   dam   max(embedding_updated_at) and count(embedding_error) - seq scans of
--         public.dam_search_documents (462 MB heap): 28 s
--   popsg max(embedding_updated_at) - seq scan of style_guide_search_documents: 13 s
--   dam_text not-yet-seeded count over the asset key range: 6 s
--
-- Fix, same signature and columns, same stale rule (pending > 0 and no write
-- for 120 minutes):
--   * last write for dam and popsg comes from dam.search_embedding_last_write, a
--     two-row table kept current by row triggers that fire only when a row's
--     embedding_updated_at changes. It starts empty (no full scan is run to
--     seed it): until the first write after this migration last_write is null
--     and staleness is judged, as before, from the oldest pending document.
--     Read-only check at authoring: dam and popsg had 0 pending, so no false alarm.
--   * dam errored counts errors on documents without a picture vector, read
--     through the existing partial index on embedding IS NULL (an error is only
--     ever recorded on a leased, unembedded document; a successful write clears it).
--   * dam_text pending is queued jobs plus one for each seed cursor that has not
--     finished, so it stays > 0 while existing documents are still entering the
--     queue; the exact figure remains in get_dam_search_text_embedding_status().
--     dam_text last write reads a new index on dam.search_text_vectors(embedded_at).
-- Every statement here is bounded: two-row inserts, an index on a small table,
-- triggers (lock_timeout bounded) and function replacement.

begin;
set local lock_timeout = '20s';

create table if not exists dam.search_embedding_last_write (
  corpus text primary key check (corpus in ('dam', 'popsg')),
  last_write timestamptz,
  created_at timestamptz not null default now()
);
insert into dam.search_embedding_last_write(corpus) values ('dam'), ('popsg')
on conflict (corpus) do nothing;
alter table dam.search_embedding_last_write enable row level security;
revoke all on dam.search_embedding_last_write from public, anon, authenticated, service_role;

create or replace function dam.note_search_embedding_write()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  update dam.search_embedding_last_write w
     set last_write = greatest(coalesce(w.last_write, new.embedding_updated_at), new.embedding_updated_at)
   where w.corpus = tg_argv[0]
     and (w.last_write is null or w.last_write < new.embedding_updated_at);
  return null;
end;
$function$;
revoke all on function dam.note_search_embedding_write() from public, anon, authenticated;

drop trigger if exists trg_note_dam_search_embedding_write on public.dam_search_documents;
create trigger trg_note_dam_search_embedding_write
  after insert or update of embedding_updated_at on public.dam_search_documents
  for each row when (new.embedding_updated_at is not null)
  execute function dam.note_search_embedding_write('dam');

drop trigger if exists trg_note_sg_search_embedding_write on public.style_guide_search_documents;
create trigger trg_note_sg_search_embedding_write
  after insert or update of embedding_updated_at on public.style_guide_search_documents
  for each row when (new.embedding_updated_at is not null and new.is_active)
  execute function dam.note_search_embedding_write('popsg');

create index if not exists search_text_vectors_embedded_at_idx
  on dam.search_text_vectors (embedded_at desc);

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
  ), text_jobs as (
    -- One pass over the text queue.
    select count(*) filter (where j.attempts<j.max_attempts and j.error_category is distinct from 'permanent') pending,
           count(*) filter (where j.error is not null) errored,
           min(j.enqueued_at) filter (where j.attempts<j.max_attempts and j.error_category is distinct from 'permanent') oldest
      from dam.search_text_embed_jobs j
  ), counts as (
    select 'dam'::text name,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) pending_count,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_error is not null) error_count,
      (select w.last_write from dam.search_embedding_last_write w where w.corpus = 'dam') written,
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
      (select w.last_write from dam.search_embedding_last_write w where w.corpus = 'popsg'),
      (select min(d.document_updated_at) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null))
    union all
    select 'dam_text',
      tj.pending + (select count(*) from dam.search_text_seed_state st where not st.done),
      tj.errored,
      (select max(v.embedded_at) from dam.search_text_vectors v),
      tj.oldest
    from text_jobs tj
  )
  select name,pending_count,error_count,written,extract(epoch from(now()-written))/60,
    pending_count>0 and (coalesce(written,oldest) is null or coalesce(written,oldest)<=now()-interval '120 minutes')
  from counts;
end;
$function$;

commit;
