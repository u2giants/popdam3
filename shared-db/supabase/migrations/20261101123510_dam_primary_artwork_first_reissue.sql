-- Version: 20261101123510
-- Reissue of 20261101065326 and 20261101074415 (issue #5315, claim #5317), whose
-- production applies timed out in the public.assets backfill: production run
-- 41290786479 scanned the 3.4 GB table twice under a 10-minute statement limit,
-- while the transaction held the trigger lock that blocks all assets reads.
-- derived-from: 20261101005850
--
-- Same end state as those two migrations; both are stranded and registered as
-- preview-ledger orphans. Changes: one scan, taken BEFORE any assets lock; a
-- bounded lock wait; the 20261101074415 reset predicate in step 6. Idempotent.

set statement_timeout = '45min';
set lock_timeout = '60s';

-- 0) One scan, before any lock on public.assets: rows the amended ladder changes.
create temp table pg_temp.tier_changes_20261101123510 on commit drop as
select id, style_group_id, updated_at, new_tier
from (
  select a.id, a.style_group_id, a.updated_at, a.primary_sort_tier,
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
    end as new_tier
  from public.assets a
) s
where primary_sort_tier is distinct from new_tier;

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

-- 3) Backfill from the scan. A row written since then has a newer updated_at
--    and was already recomputed by the trigger.
update public.assets a
set primary_sort_tier = c.new_tier
from pg_temp.tier_changes_20261101123510 c
where a.id = c.id
  and a.updated_at is not distinct from c.updated_at
  and a.primary_sort_tier is distinct from c.new_tier;

-- 4) Refresh primaries only for groups holding a changed asset, in batches.
do $$
declare
  v_batch uuid[];
begin
  for v_batch in
    select array_agg(style_group_id order by style_group_id)
    from (
      select style_group_id,
             (row_number() over (order by style_group_id)) / 500 as bucket
      from (select distinct style_group_id
            from pg_temp.tier_changes_20261101123510
            where style_group_id is not null) g
    ) s
    group by bucket
  loop
    perform public.refresh_style_group_primaries(v_batch);
  end loop;
end $$;

-- 5) Complete the style_group embed-queue reset, covering every marker the
--    claim predicate consults (the 20261101074415 predicate).
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
       or embedding_model is not null
       or embedding_updated_at is not null
       or embedding_error is not null
       or embedding_error_category is not null
       or embedding_next_retry_at is not null
       or embedding_attempts <> 0
       or embedding_lease_token is not null
       or embedding_lease_owner is not null
       or embedding_lease_expires_at is not null);

revoke all on function public.compute_primary_sort_tier() from public, anon, authenticated;
