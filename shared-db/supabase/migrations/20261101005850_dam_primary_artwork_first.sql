-- Version: 20261101005850
-- DAM style-group primary prefers artwork over document pages (issue #5250;
-- application issue u2giants/popdam3#616 — Spider-Man coir recall).
-- derived-from: 20261023184940
--
-- Measured on production (read-only, 2026-10-31):
--  * 988 style groups have a PDF primary while in-group artwork with a
--    thumbnail exists. Cause: compute_primary_sort_tier() tier 5 is
--    "thumbnail + neutral filename" regardless of file type, and ties break
--    by created_at/ai_tagged_at, so a neutral-named licensing/PDF page can
--    beat real artwork. Those groups' picture vectors (once embedded) would
--    be text pages — the exact "garbage group vector" failure mode.
--  * 9,978 of 11,232 style_group search documents have no embedding: the
--    one-shot GPU embed ran 2026-10-23 and nothing has drained the queue
--    since; claim order is FIFO by indexed_at and every group document is
--    re-indexed nightly, so group docs always sort behind the accumulated
--    asset backlog (79,110 pending asset docs, oldest 2026-10-25).
--
-- This migration:
--  1. compute_primary_sort_tier(): split old tier 5 by artwork-vs-document
--     file type. Neutral-named artwork (psd/ai/jpg/png) with thumbnail keeps
--     tier 5; packaging keeps 6; neutral-named PDF with thumbnail becomes NEW
--     tier 7 (below artwork and packaging, above every no-thumbnail tier —
--     a renderable PDF page still beats an asset with no image at all).
--     No-thumbnail tiers shift 7-11 -> 8-12; their relative order is
--     unchanged. Tier 4 (techpack + thumbnail) is untouched, so every
--     `primary_sort_tier not in (4, 8)` AI-tag candidate predicate keeps its
--     meaning: tier 4 is identical, and new tier 8 (mockup, no thumbnail) is
--     unreachable under those predicates' `thumbnail_url is not null` filter,
--     exactly as old tier 8 (art, no thumbnail) was. Column default moves
--     10 -> 11 (neutral filename, no thumbnail — same meaning, new number).
--  2. One-time backfill of assets.primary_sort_tier where the new ladder
--     differs (measured: 6,191 pdf-with-thumbnail rows 5->7 and 10,497
--     no-thumbnail rows +1). UPDATE touches only primary_sort_tier, which no
--     trigger watches, so no side effects fire.
--  3. Re-run refresh_style_group_primaries() over every group in batches so
--     the 988 groups whose PDF beat artwork get an artwork primary now
--     (nightly reconcile would also converge; this makes it immediate and
--     deterministic for verification). Each style_groups row update fires
--     the existing document-refresh trigger, same as the nightly rebuild.
--  4. One-time clear of style_group picture vectors: no group may keep an
--     embedding computed from a non-current primary thumbnail after the
--     re-selection. 1,254 vectors cleared; the same delivery's catch-up GPU
--     run re-embeds every group document from its current primary.
--  5. claim_dam_search_embedding_documents(): claim order becomes
--     (document_type = 'style_group') desc first, then the previous
--     indexed_at, document_type, entity_id FIFO. Group documents (~11k, the
--     primary search surface) stop starving behind the asset backlog; asset
--     documents keep strict FIFO among themselves. Body otherwise identical
--     to the 20261023184940 version.
--
-- Follow-up tracked on u2giants/popdam3#616 (blocked by the active claim on
-- refresh_dam_search_style_group_document, #5231 lane): fold
-- primary_thumbnail_url into the group document content hash so future
-- primary flips invalidate stale vectors without a bulk clear.
--
-- No SKU pattern-matching anywhere (owner instruction).

set statement_timeout = '10min';

-- 1) New tier ladder.
create or replace function public.compute_primary_sort_tier()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  fn text := lower(NEW.filename);
  base_name text := lower(regexp_replace(NEW.filename, '\.[^.]+$', ''));
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_photo34 boolean := (base_name LIKE '%3-4%');
  is_mockup boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art boolean := (fn LIKE '%art%');
  is_techpack boolean := (fn LIKE '%tech pack%' OR fn LIKE '%techpack%' OR fn LIKE '%tech_pack%');
  is_pkg boolean := (fn LIKE '%packaging%');
  is_artwork_file boolean := (NEW.file_type IN ('psd', 'ai', 'jpg', 'png'));
begin
  IF is_photo34 THEN NEW.primary_sort_tier := 1;
  ELSIF is_mockup AND has_thumb THEN NEW.primary_sort_tier := 2;
  ELSIF is_art AND has_thumb THEN NEW.primary_sort_tier := 3;
  ELSIF is_techpack AND has_thumb THEN NEW.primary_sort_tier := 4;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg
    AND has_thumb AND is_artwork_file THEN NEW.primary_sort_tier := 5;
  ELSIF is_pkg AND has_thumb THEN NEW.primary_sort_tier := 6;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg
    AND has_thumb THEN NEW.primary_sort_tier := 7;
  ELSIF is_mockup THEN NEW.primary_sort_tier := 8;
  ELSIF is_art THEN NEW.primary_sort_tier := 9;
  ELSIF is_techpack THEN NEW.primary_sort_tier := 10;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg THEN NEW.primary_sort_tier := 11;
  ELSE NEW.primary_sort_tier := 12;
  END IF;
  RETURN NEW;
END; $function$;

alter table public.assets alter column primary_sort_tier set default 11;

-- 2) Backfill rows whose tier the new ladder changes. The CASE mirrors the
--    function body exactly; the WHERE keeps the UPDATE to affected rows only.
update public.assets a
set primary_sort_tier = x.new_tier
from (
  select a2.id,
    case
      when lower(regexp_replace(a2.filename, '\.[^.]+$', '')) like '%3-4%' then 1
      when (lower(a2.filename) like '%mockup%' or lower(a2.filename) like '%mock up%')
        and a2.thumbnail_url is not null and a2.thumbnail_error is null then 2
      when lower(a2.filename) like '%art%'
        and a2.thumbnail_url is not null and a2.thumbnail_error is null then 3
      when (lower(a2.filename) like '%tech pack%' or lower(a2.filename) like '%techpack%' or lower(a2.filename) like '%tech_pack%')
        and a2.thumbnail_url is not null and a2.thumbnail_error is null then 4
      when lower(a2.filename) not like '%mockup%' and lower(a2.filename) not like '%mock up%'
        and lower(a2.filename) not like '%art%'
        and lower(a2.filename) not like '%tech pack%' and lower(a2.filename) not like '%techpack%' and lower(a2.filename) not like '%tech_pack%'
        and lower(a2.filename) not like '%packaging%'
        and a2.thumbnail_url is not null and a2.thumbnail_error is null
        and a2.file_type in ('psd', 'ai', 'jpg', 'png') then 5
      when lower(a2.filename) like '%packaging%'
        and a2.thumbnail_url is not null and a2.thumbnail_error is null then 6
      when lower(a2.filename) not like '%mockup%' and lower(a2.filename) not like '%mock up%'
        and lower(a2.filename) not like '%art%'
        and lower(a2.filename) not like '%tech pack%' and lower(a2.filename) not like '%techpack%' and lower(a2.filename) not like '%tech_pack%'
        and lower(a2.filename) not like '%packaging%'
        and a2.thumbnail_url is not null and a2.thumbnail_error is null then 7
      when (lower(a2.filename) like '%mockup%' or lower(a2.filename) like '%mock up%') then 8
      when lower(a2.filename) like '%art%' then 9
      when (lower(a2.filename) like '%tech pack%' or lower(a2.filename) like '%techpack%' or lower(a2.filename) like '%tech_pack%') then 10
      when lower(a2.filename) not like '%mockup%' and lower(a2.filename) not like '%mock up%'
        and lower(a2.filename) not like '%art%'
        and lower(a2.filename) not like '%tech pack%' and lower(a2.filename) not like '%techpack%' and lower(a2.filename) not like '%tech_pack%'
        and lower(a2.filename) not like '%packaging%' then 11
      else 12
    end as new_tier
  from public.assets a2
) x
where a.id = x.id
  and a.primary_sort_tier is distinct from x.new_tier;

-- 3) Re-select primaries for every group in batches (existing SECURITY DEFINER
--    helper, same one the nightly reconcile uses). Updates only groups whose
--    winning asset changed; each update fires the document-refresh trigger.
do $$
declare
  v_batch uuid[];
begin
  for v_batch in
    select array_agg(id order by id)
    from (
      select id, (row_number() over (order by id)) / 500 as bucket
      from public.style_groups
    ) s
    group by bucket
  loop
    perform public.refresh_style_group_primaries(v_batch);
  end loop;
end $$;

-- 4) One-time clear of style_group picture vectors so no group keeps a vector
--    computed from a non-current primary thumbnail.
update public.dam_search_documents
set embedding = null,
    embedding_model = null,
    embedding_updated_at = null,
    embedding_error = null,
    embedding_error_category = null,
    embedding_next_retry_at = null
where document_type = 'style_group'
  and embedding is not null;

-- 5) Group documents claim first (they are ~11k and re-index nightly; the
--    asset backlog must not starve them). Body otherwise unchanged from the
--    20261023184940 version.
create or replace function public.claim_dam_search_embedding_documents(p_limit integer default 100, p_worker_id text default null, p_lease_seconds integer default 300)
returns table(document_type text, entity_id uuid, search_text text, thumbnail_url text, content_sha256 text, lease_token uuid, lease_expires_at timestamptz, attempt integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select auth.role()) <> 'service_role' or nullif(btrim(p_worker_id),'') is null then raise exception 'service_role and worker id required' using errcode='42501'; end if;
  return query with candidates as (
    select d.document_type,d.entity_id from public.dam_search_documents d
    where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
      and (d.embedding_next_retry_at is null or d.embedding_next_retry_at<=now())
      and (d.embedding_lease_expires_at is null or d.embedding_lease_expires_at<=now())
      and d.embedding_error_category is distinct from 'permanent'
    order by (d.document_type = 'style_group') desc, d.indexed_at, d.document_type, d.entity_id for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),1000))
  ), claimed as (update public.dam_search_documents d set embedding_lease_token=gen_random_uuid(),
    embedding_lease_owner=p_worker_id,embedding_lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,300),3600))),
    embedding_attempts=d.embedding_attempts+1 from candidates c where d.document_type=c.document_type and d.entity_id=c.entity_id
    returning d.*)
  select c.document_type,c.entity_id,left(c.search_text,8000),
    c.metadata->>'thumbnail_url',
    c.content_sha256,c.embedding_lease_token,c.embedding_lease_expires_at,c.embedding_attempts from claimed c;
end
$function$;

revoke all on function public.claim_dam_search_embedding_documents(integer,text,integer) from public, anon, authenticated;
grant execute on function public.claim_dam_search_embedding_documents(integer,text,integer) to service_role;

revoke all on function public.compute_primary_sort_tier() from public, anon, authenticated;
