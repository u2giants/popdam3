-- Version: 20261110192227
-- DAM cover tier: COMP files rank right after "3-4" and mockup files.
-- Claim issue popcre/shared-db#6011; application change u2giants/popdam3#907
-- (edge function selectPrimaryAsset + scanner import COMP files).
-- derived-from: 20261101182210
--
-- Owner ruling (Albert, 2026-11-10, exact words): "A file with COMP, COMPVIEW,
-- COMP-VIEW or COMP_VIEW in the file name should automatically be imported and
-- it is chosen as the cover image right after '3-4' and 'mockup' files."
--
-- is_comp = lower(filename) ~ '(^|[^a-z])comp([-_ ]?view)?([^a-z]|$)'
-- (whole word: "complete", "component", "compare" do not match).
--
-- New ladder (old -> new):
--    1 photo34                               1 -> 1
--    2 mockup + thumb                        2 -> 2
--    3 comp + thumb                          NEW
--    4 art + thumb                           3 -> 4
--    5 techpack + thumb                      4 -> 5
--    6 neutral artwork + thumb               5 -> 6
--    7 packaging + thumb                     6 -> 7
--    8 neutral (pdf) + thumb                 7 -> 8
--    9 mockup, no thumb                      8 -> 9
--   10 comp, no thumb                        NEW
--   11 art, no thumb                         9 -> 11
--   12 techpack, no thumb                   10 -> 12
--   13 neutral, no thumb                    11 -> 13 (column default)
--   14 everything else                      12 -> 14
-- Comp files are excluded from every "neutral" tier. The non-comp mapping is
-- strictly monotonic, so no group's winner changes except groups holding a
-- comp asset; only those groups get a primaries refresh.
--
-- Consumers with hardcoded tier numbers: the AI-tag candidate exclusion
-- "primary_sort_tier not in (4, 8)" (techpack + thumb, mockup no thumb) in
-- get_ai_tag_candidates() and its two partial indexes becomes "not in (5, 9)"
-- here; the PopDAM app copies of that predicate move in a follow-up app PR.
-- refresh_style_group_primaries / propagate_group_tags_batch /
-- sync_primary_asset_on_thumbnail only order by the tier (unaffected).
--
-- Batched like 20261101182210: the tier pass runs in primary-key chunks of
-- 2000 rows so no statement rewrites the 3.4 GB public.assets table at once.
-- Idempotent: re-running on a database already in the end state changes
-- nothing.

set statement_timeout = '45min';
set lock_timeout = '60s';

-- 1) Tier function.
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
  is_comp boolean := (fn ~ '(^|[^a-z])comp([-_ ]?view)?([^a-z]|$)');
  is_art boolean := (fn LIKE '%art%');
  is_techpack boolean := (fn LIKE '%tech pack%' OR fn LIKE '%techpack%' OR fn LIKE '%tech_pack%');
  is_pkg boolean := (fn LIKE '%packaging%');
  is_artwork_file boolean := (NEW.file_type <> 'pdf');
begin
  IF is_photo34 THEN NEW.primary_sort_tier := 1;
  ELSIF is_mockup AND has_thumb THEN NEW.primary_sort_tier := 2;
  ELSIF is_comp AND has_thumb THEN NEW.primary_sort_tier := 3;
  ELSIF is_art AND has_thumb THEN NEW.primary_sort_tier := 4;
  ELSIF is_techpack AND has_thumb THEN NEW.primary_sort_tier := 5;
  ELSIF NOT is_mockup AND NOT is_comp AND NOT is_art AND NOT is_techpack AND NOT is_pkg
    AND has_thumb AND is_artwork_file THEN NEW.primary_sort_tier := 6;
  ELSIF is_pkg AND has_thumb THEN NEW.primary_sort_tier := 7;
  ELSIF NOT is_mockup AND NOT is_comp AND NOT is_art AND NOT is_techpack AND NOT is_pkg
    AND has_thumb THEN NEW.primary_sort_tier := 8;
  ELSIF is_mockup THEN NEW.primary_sort_tier := 9;
  ELSIF is_comp THEN NEW.primary_sort_tier := 10;
  ELSIF is_art THEN NEW.primary_sort_tier := 11;
  ELSIF is_techpack THEN NEW.primary_sort_tier := 12;
  ELSIF NOT is_mockup AND NOT is_comp AND NOT is_art AND NOT is_techpack AND NOT is_pkg THEN NEW.primary_sort_tier := 13;
  ELSE NEW.primary_sort_tier := 14;
  END IF;
  RETURN NEW;
END; $function$;

revoke all on function public.compute_primary_sort_tier() from public, anon, authenticated;

alter table public.assets alter column primary_sort_tier set default 13;

-- 2) Recompute every row's tier in primary-key chunks and capture the groups
--    holding a comp asset (the only groups whose winner can change). The CASE mirrors step 1 exactly.
create temp table pg_temp.comp_tier_groups_20261110192227 (style_group_id uuid primary key) on commit drop;

do $$
declare
  v_last_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  loop
    with src as (
      select a.id, a.style_group_id, a.primary_sort_tier,
        lower(a.filename) as fn,
        lower(regexp_replace(a.filename, '\.[^.]+$', '')) as base_name,
        (a.thumbnail_url is not null and a.thumbnail_error is null) as has_thumb,
        (a.file_type <> 'pdf') as is_artwork_file
      from public.assets a
      where a.id > v_last_id
      order by a.id
      limit 2000
    ),
    flags as (
      select s.*,
        (s.base_name like '%3-4%') as is_photo34,
        (s.fn like '%mockup%' or s.fn like '%mock up%') as is_mockup,
        (s.fn ~ '(^|[^a-z])comp([-_ ]?view)?([^a-z]|$)') as is_comp,
        (s.fn like '%art%') as is_art,
        (s.fn like '%tech pack%' or s.fn like '%techpack%' or s.fn like '%tech_pack%') as is_techpack,
        (s.fn like '%packaging%') as is_pkg
      from src s
    ),
    chunk as (
      select f.id, f.style_group_id, f.primary_sort_tier, f.is_comp,
        (case
          when f.is_photo34 then 1
          when f.is_mockup and f.has_thumb then 2
          when f.is_comp and f.has_thumb then 3
          when f.is_art and f.has_thumb then 4
          when f.is_techpack and f.has_thumb then 5
          when not f.is_mockup and not f.is_comp and not f.is_art and not f.is_techpack and not f.is_pkg
            and f.has_thumb and f.is_artwork_file is true then 6
          when f.is_pkg and f.has_thumb then 7
          when not f.is_mockup and not f.is_comp and not f.is_art and not f.is_techpack and not f.is_pkg
            and f.has_thumb then 8
          when f.is_mockup then 9
          when f.is_comp then 10
          when f.is_art then 11
          when f.is_techpack then 12
          when not f.is_mockup and not f.is_comp and not f.is_art and not f.is_techpack and not f.is_pkg then 13
          else 14
        end) as new_tier
      from flags f
    ),
    upd as (
      update public.assets a
      set primary_sort_tier = c.new_tier
      from chunk c
      where a.id = c.id
        and a.primary_sort_tier is distinct from c.new_tier
      returning a.id
    ),
    -- Every group holding a comp asset, changed or not: a comp+art file
    -- keeps tier 3 while a pure-art sibling moves 3 -> 4, so a former tie
    -- can flip without the comp row changing.
    ins as (
      insert into pg_temp.comp_tier_groups_20261110192227 (style_group_id)
      select distinct c.style_group_id
      from chunk c
      where c.is_comp and c.style_group_id is not null
      on conflict do nothing
    )
    -- (uuid has no max() aggregate before PostgreSQL 18; take the last row)
    select id into v_last_id from chunk order by id desc limit 1;
    exit when v_last_id is null;
  end loop;
end $$;

-- 3) AI-tag candidate exclusion keeps its meaning under the new numbers:
--    old 4 (techpack + thumb) is now 5, old 8 (mockup, no thumb) is now 9.
create or replace function public.get_ai_tag_candidates(
  p_mode text,
  p_limit integer,
  p_after_tier integer default null,
  p_after_id uuid default null,
  p_group_ids uuid[] default null
)
returns table (
  id uuid,
  thumbnail_url text,
  filename text,
  relative_path text,
  style_group_id uuid,
  primary_sort_tier integer
)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_has_cursor boolean := p_after_tier is not null and p_after_id is not null;
  v_group_scoped boolean := coalesce(cardinality(p_group_ids), 0) > 0;
begin
  if p_mode is null or p_mode not in ('untagged', 'all') then
    raise exception 'invalid AI tag candidate mode: %', coalesce(p_mode, '<null>')
      using errcode = '22023';
  end if;

  if (p_after_tier is null) <> (p_after_id is null) then
    raise exception 'AI tag candidate cursor requires both tier and asset ID'
      using errcode = '22023';
  end if;

  if p_mode = 'untagged' then
    return query
    select
      candidate.id,
      candidate.thumbnail_url,
      candidate.filename,
      candidate.relative_path,
      candidate.style_group_id,
      candidate.primary_sort_tier::integer
    from public.assets candidate
    where candidate.is_deleted = false
      and candidate.thumbnail_url is not null
      and candidate.primary_sort_tier not in (5, 9)
      and candidate.status <> 'tagged'
      and (not v_group_scoped or candidate.style_group_id = any(p_group_ids))
      and (
        v_group_scoped
        or candidate.style_group_id is null
        or not exists (
          select 1
          from public.assets tagged
          where tagged.style_group_id = candidate.style_group_id
            and tagged.is_deleted = false
            and tagged.status = 'tagged'
            and tagged.ai_tagged_at is not null
        )
      )
      and (
        not v_has_cursor
        or (candidate.primary_sort_tier, candidate.id) > (p_after_tier, p_after_id)
      )
    order by candidate.primary_sort_tier, candidate.id
    limit v_limit;
  else
    return query
    select
      candidate.id,
      candidate.thumbnail_url,
      candidate.filename,
      candidate.relative_path,
      candidate.style_group_id,
      candidate.primary_sort_tier::integer
    from public.assets candidate
    where candidate.is_deleted = false
      and candidate.thumbnail_url is not null
      and candidate.primary_sort_tier not in (5, 9)
      and (not v_group_scoped or candidate.style_group_id = any(p_group_ids))
      and (
        not v_has_cursor
        or (candidate.primary_sort_tier, candidate.id) > (p_after_tier, p_after_id)
      )
    order by candidate.primary_sort_tier, candidate.id
    limit v_limit;
  end if;
end;
$function$;

drop index if exists public.idx_assets_ai_tag_untagged_candidates;
create index idx_assets_ai_tag_untagged_candidates
  on public.assets (primary_sort_tier, id)
  include (thumbnail_url, filename, relative_path, style_group_id)
  where is_deleted = false
    and thumbnail_url is not null
    and primary_sort_tier not in (5, 9)
    and status <> 'tagged';

drop index if exists public.idx_assets_ai_tag_all_candidates;
create index idx_assets_ai_tag_all_candidates
  on public.assets (primary_sort_tier, id)
  include (thumbnail_url, filename, relative_path, style_group_id)
  where is_deleted = false
    and thumbnail_url is not null
    and primary_sort_tier not in (5, 9);

-- 4) Refresh primaries only for groups holding a comp asset.
do $$
declare
  v_batch uuid[];
begin
  for v_batch in
    select array_agg(style_group_id order by style_group_id)
    from (
      select style_group_id,
             (row_number() over (order by style_group_id)) / 500 as bucket
      from pg_temp.comp_tier_groups_20261110192227
    ) s
    group by bucket
  loop
    perform public.refresh_style_group_primaries(v_batch);
  end loop;
end $$;
