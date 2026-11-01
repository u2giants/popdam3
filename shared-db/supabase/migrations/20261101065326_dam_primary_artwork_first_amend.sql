-- Version: 20261101065326
-- Amend 20261101005850 per review-finding #5253 (issue #5259; application
-- issue u2giants/popdam3#616).
-- derived-from: 20261101005850
--
-- Accepted findings and their cures:
--  1. compute_primary_sort_tier() now depends on NEW.file_type, but
--     trg_compute_primary_sort_tier fired only on UPDATE OF filename,
--     relative_path, thumbnail_url, thumbnail_error — a later file_type
--     correction (e.g. pdf->psd) left a stale tier. The trigger is recreated
--     with file_type in the watched column list.
--  2. 20261101005850's step-3 comment claimed "updates only groups whose
--     winning asset changed" while refresh_style_group_primaries() rewrites
--     every group in its input unconditionally, dirtying all ~11k groups.
--     This migration refreshes ONLY groups that contain an asset whose tier
--     the amended ladder changes (a group's winner cannot change otherwise)
--     and states so accurately.
--  3. 20261101005850's embedding clear did not reset embedding_attempts or
--     the lease fields, so an exhausted or actively-leased style_group row
--     stayed outside the claim predicate and could not be re-embedded. The
--     reset now zeroes attempts and clears the lease fields (same shape as
--     the documented reset in 20260825031841), idempotently.
--  4. The positive artwork file list ('psd','ai','jpg','png') mis-files any
--     future artwork enum value as a document; artwork is now defined as the
--     complement of the one document type: file_type <> 'pdf'.
--
-- Refuted with production evidence (no change): the ACL finding —
-- compute_primary_sort_tier on production already carries
-- {postgres=X,service_role=X} only (pg_proc.proacl, verified 2026-10-31
-- read-only), and PostgREST/bridge writes have worked since the 2026-07-29
-- lockdown; trigger firing does not check per-caller EXECUTE. The revoke
-- re-assert matches live state.
--
-- Groups-first claim order (accepted, bounded): style_group documents are
-- ~11k/night (~7 minutes at the measured 26 docs/s) before asset documents
-- resume strict FIFO among themselves.

set statement_timeout = '10min';

-- 1) Tier function: artwork = complement of the document type.
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
  is_artwork_file boolean := (NEW.file_type <> 'pdf');
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

-- 2) Watch file_type so corrections recompute the tier (finding 1).
drop trigger if exists trg_compute_primary_sort_tier on public.assets;
create trigger trg_compute_primary_sort_tier
  before insert or update of filename, relative_path, file_type, thumbnail_url, thumbnail_error
  on public.assets
  for each row execute function public.compute_primary_sort_tier();

-- 3) Capture, BEFORE the backfill, the groups containing a tier-changed
--    asset (finding 2): a group's winner cannot change without a member
--    tier change, so only these groups need a primaries refresh afterwards.
create temp table pg_temp.tier_changed_groups_20261101065326 (style_group_id uuid primary key) on commit drop;

insert into pg_temp.tier_changed_groups_20261101065326 (style_group_id)
select distinct a.style_group_id
from public.assets a
where a.style_group_id is not null
  and a.primary_sort_tier is distinct from (
    case
      when lower(regexp_replace(a.filename, '\.[^.]+$', '')) like '%3-4%' then 1
      when (lower(a.filename) like '%mockup%' or lower(a.filename) like '%mock up%')
        and a.thumbnail_url is not null and a.thumbnail_error is null then 2
      when lower(a.filename) like '%art%'
        and a.thumbnail_url is not null and a.thumbnail_error is null then 3
      when (lower(a.filename) like '%tech pack%' or lower(a.filename) like '%techpack%' or lower(a.filename) like '%tech_pack%')
        and a.thumbnail_url is not null and a.thumbnail_error is null then 4
      when lower(a.filename) not like '%mockup%' and lower(a.filename) not like '%mock up%'
        and lower(a.filename) not like '%art%'
        and lower(a.filename) not like '%tech pack%' and lower(a.filename) not like '%techpack%' and lower(a.filename) not like '%tech_pack%'
        and lower(a.filename) not like '%packaging%'
        and a.thumbnail_url is not null and a.thumbnail_error is null
        and a.file_type <> 'pdf' then 5
      when lower(a.filename) like '%packaging%'
        and a.thumbnail_url is not null and a.thumbnail_error is null then 6
      when lower(a.filename) not like '%mockup%' and lower(a.filename) not like '%mock up%'
        and lower(a.filename) not like '%art%'
        and lower(a.filename) not like '%tech pack%' and lower(a.filename) not like '%techpack%' and lower(a.filename) not like '%tech_pack%'
        and lower(a.filename) not like '%packaging%'
        and a.thumbnail_url is not null and a.thumbnail_error is null then 7
      when (lower(a.filename) like '%mockup%' or lower(a.filename) like '%mock up%') then 8
      when lower(a.filename) like '%art%' then 9
      when (lower(a.filename) like '%tech pack%' or lower(a.filename) like '%techpack%' or lower(a.filename) like '%tech_pack%') then 10
      when lower(a.filename) not like '%mockup%' and lower(a.filename) not like '%mock up%'
        and lower(a.filename) not like '%art%'
        and lower(a.filename) not like '%tech pack%' and lower(a.filename) not like '%techpack%' and lower(a.filename) not like '%tech_pack%'
        and lower(a.filename) not like '%packaging%' then 11
      else 12
    end);

-- 4) Idempotent backfill of any row whose tier differs under the amended
--    ladder (rows changed by 20261101005850 already match; this catches
--    file_type corrections made between the two applies, if any).
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
        and a2.file_type <> 'pdf' then 5
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

-- 5) Refresh primaries only for the captured groups, in batches.
do $$
declare
  v_batch uuid[];
begin
  for v_batch in
    select array_agg(style_group_id order by style_group_id)
    from (
      select style_group_id,
             (row_number() over (order by style_group_id)) / 500 as bucket
      from pg_temp.tier_changed_groups_20261101065326
    ) s
    group by bucket
  loop
    perform public.refresh_style_group_primaries(v_batch);
  end loop;
end $$;

-- 6) Complete the style_group embed-queue reset (finding 3): zero attempts
--    and clear lease fields so every style_group document is claimable.
update public.dam_search_documents
set embedding = null,
    embedding_model = null,
    embedding_updated_at = null,
    embedding_error = null,
    embedding_error_category = null,
    embedding_next_retry_at = null,
    embedding_attempts = 0,
    embedding_lease_token = null,
    embedding_lease_owner = null,
    embedding_lease_expires_at = null
where document_type = 'style_group'
  and (embedding is not null
       or embedding_attempts <> 0
       or embedding_lease_token is not null
       or embedding_lease_owner is not null
       or embedding_lease_expires_at is not null
       or embedding_next_retry_at is not null);

revoke all on function public.compute_primary_sort_tier() from public, anon, authenticated;
