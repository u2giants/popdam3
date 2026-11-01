-- Version: 20261101161640
-- Batched successor of the stranded DAM primary-artwork chain: supersedes
-- 20261101065326 and 20261101074415 (reissued as 20261101123510, itself
-- stranded; all three stay unapplied everywhere this version lands).
-- Lane issue #5315 / claim #5317; batching work issue #5331; application
-- issue u2giants/popdam3#616.
-- derived-from: 20261101005850
--
-- Why a further version: every production apply of the chain timed out on a
-- monolithic whole-table tier CASE statement -- run 41310018370 cancelled at
-- psql:...sql:123 (capture scan) under concurrent load, and run 41321002399
-- cancelled at psql:...sql:165 (backfill UPDATE) even at ~1 concurrent query
-- (statement cap, 10 minutes at that migration's own setting). No calm window
-- makes one statement that rewrites the 3.4 GB public.assets table fit.
--
-- This version performs the identical work in primary-key chunks of 2000 rows
-- so no single statement touches more than a few thousand rows, and it runs
-- the chunked pass BEFORE the trigger DDL, so the table-wide lock taken by the
-- trigger recreation covers only the (group-bounded) primaries refresh and
-- the style_group embed-queue reset, not the assets pass.
--
-- Same end state as 20261101065326 + 20261101074415: amended tier ladder
-- (artwork = the complement of the one document type, file_type <> 'pdf'),
-- trigger watching file_type so corrections recompute the tier, primaries
-- refreshed only for groups holding a tier-changed asset, and the complete
-- style_group embed-queue reset predicate of 20261101074415 (every marker the
-- claim predicate consults). Idempotent: re-running on a database already in
-- the end state changes nothing.

set statement_timeout = '45min';
set lock_timeout = '60s';

-- 1) Tier function: artwork = complement of the document type (finding 4 of
--    20261101065326; review-finding #5253).
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

-- 2) Capture the groups holding a tier-changed asset and backfill any row
--    whose tier differs under the amended ladder, in primary-key chunks.
--    Each statement scans at most 2000 rows by the assets primary-key index;
--    rows already matching (the common case on a database that carries
--    20261101005850 with only psd/ai/jpg/png/pdf file types) update nothing.
create temp table pg_temp.tier_changed_groups_20261101161640 (style_group_id uuid primary key) on commit drop;

do $$
declare
  v_last_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  loop
    with chunk as (
      select a.id, a.style_group_id,
        (case
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
        end) as new_tier
      from public.assets a
      where a.id > v_last_id
      order by a.id
      limit 2000
    ),
    upd as (
      update public.assets a
      set primary_sort_tier = c.new_tier
      from chunk c
      where a.id = c.id
        and a.primary_sort_tier is distinct from c.new_tier
      returning a.style_group_id
    ),
    ins as (
      insert into pg_temp.tier_changed_groups_20261101161640 (style_group_id)
      select distinct style_group_id from upd
      where style_group_id is not null
      on conflict do nothing
    )
    -- (uuid has no max() aggregate before PostgreSQL 18; take the last row)
    select id into v_last_id from chunk order by id desc limit 1;
    exit when v_last_id is null;
  end loop;
end $$;

-- 3) Watch file_type so corrections recompute the tier (finding 1 of
--    20261101065326). Taken after the chunked pass so the table-wide lock of
--    the trigger recreation is not held across the assets pass.
drop trigger if exists trg_compute_primary_sort_tier on public.assets;
create trigger trg_compute_primary_sort_tier
  before insert or update of filename, relative_path, file_type, thumbnail_url, thumbnail_error
  on public.assets
  for each row execute function public.compute_primary_sort_tier();

-- 4) Refresh primaries only for the captured groups, in batches (finding 2 of
--    20261101065326): a group's winner cannot change without a member tier
--    change, so only these groups need a primaries refresh afterwards.
do $$
declare
  v_batch uuid[];
begin
  for v_batch in
    select array_agg(style_group_id order by style_group_id)
    from (
      select style_group_id,
             (row_number() over (order by style_group_id)) / 500 as bucket
      from pg_temp.tier_changed_groups_20261101161640
    ) s
    group by bucket
  loop
    perform public.refresh_style_group_primaries(v_batch);
  end loop;
end $$;

-- 5) Complete the style_group embed-queue reset with the 20261101074415
--    predicate: zero attempts and clear every marker the claim predicate
--    consults, so every style_group document is claimable again (finding 3 of
--    20261101065326; issue #5292 / review-finding #5268).
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

-- 6) The revoke re-assert matches live production ACL state (pg_proc.proacl
--    {postgres=X,service_role=X}, verified 2026-10-31 read-only; also finding
--    of the #5253 review).
revoke all on function public.compute_primary_sort_tier() from public, anon, authenticated;
