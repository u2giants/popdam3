-- =====================================================================================
-- Issue #2419 - public.reconcile_style_group_drift: a READ-ONLY detector for
-- style-group assignment drift and effective-tag projection drift.
-- Parent plan #2209 (`plan_database_efficiency_and_api_security.md`).
-- Claim #2473 reserves version 20260907031246 and exactly one object:
--
--   function public.reconcile_style_group_drift(integer)   (created, new object)
--
-- derived-from: none
--
-- NO TABLE, COLUMN, INDEX, CONSTRAINT, TRIGGER, POLICY OR EXISTING GRANT IS TOUCHED.
-- The function only READS public.assets, public.style_groups, public.asset_tags,
-- public.style_group_tags and public.asset_effective_tags - the exact read set the
-- claim authorises - and returns a single row of counts.
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------------
-- Today the nightly cycle self-heals by brute force: clear_style_group_batch blanks
-- assets.style_group_id and rebuild_style_groups_batch reassigns from scratch over
-- every live asset. That pass is expensive, but it is also the system's ONLY
-- correction mechanism: it silently repairs manual edits, missed trigger firings,
-- group merges and splits, and changes to the SKU derivation rule. #2408 and the
-- watermark/retirement issues that follow it remove most of that cost - and with it
-- the safety net. Both independent reviewers of the parent plan raised the same
-- objection without seeing each other's work: nothing would notice the first drift
-- after those changes ship until a person spotted wrong data in the DAM.
--
-- This is the detector that has to be live and reading clean before anything removes
-- the net. It reports; it does not repair.
--
-- IT CANNOT GROW A REPAIR MODE, AND THAT IS ENFORCED BY POSTGRES, NOT BY REVIEW
-- ---------------------------------------------------------------------------------
-- The function is LANGUAGE sql and declared STABLE. PostgreSQL refuses to create or
-- to execute a non-volatile function containing INSERT, UPDATE, DELETE or MERGE
-- ("... is not allowed in a non-volatile function"). So a later edit that tried to
-- "just fix what it finds" would fail to install rather than quietly start writing.
-- A detector that repairs stops being evidence that the system is correct and hides
-- the recurrence rate that says whether the underlying fix worked (#2419).
--
-- THE SKU RULE IS THE REBUILD'S RULE, CHARACTER FOR CHARACTER
-- ---------------------------------------------------------------------------------
-- The derivation rule has already changed once
-- (20260708150000_dam_strict_style_group_sku_regex.sql). A reconciler that derives
-- differently from the rebuild reports drift that is really a rule mismatch, which is
-- the fastest way to make people stop reading its output.
--
-- The correlated subquery in the `live` CTE below is copied verbatim from
-- public.rebuild_style_groups_batch as it stands after
-- 20260906035323_style_group_rebuild_guard_and_ungroup.sql (issue #2408): the same
-- four predicates (`^[A-Za-z0-9]+$`, contains a letter, contains a digit,
-- length >= 7), the same `ord < array_length(...)` filename exclusion, and the same
-- `order by ord limit 1` tie-break.
--
-- IT IS COPIED RATHER THAN SHARED, DELIBERATELY, AND THIS IS A KNOWN DEBT.
-- #2419 asks for one shared function so the two can never diverge. Extracting one
-- means REPLACING public.rebuild_style_groups_batch, and this branch's object claim
-- (#2473) authorises exactly one object: this function. Writing that second object
-- here would collide with another active author's boundary on the style-group write
-- path. The divergence is therefore closed the only other way available in one
-- branch: the contract test
-- supabase/tests/style_group_drift_reconciler_contracts.sql extracts the four
-- predicates from the LIVE pg_get_functiondef of BOTH routines and fails if either
-- side loses one or if the two texts stop agreeing. A follow-up may hoist the shared
-- helper once both objects can be claimed together; until then CI, not memory, is
-- what keeps them identical.
--
-- WHAT IT COUNTS (the three comparisons #2419 specifies)
-- ---------------------------------------------------------------------------------
-- 1a. `assets_missing_or_wrong_group` - live assets whose path DOES yield a SKU but
--     which carry no group, the wrong group, or whose SKU has no style_groups row at
--     all (the rebuild would create one and assign it, so that is drift too).
-- 1b. `assets_with_unexpected_group` - live assets whose path yields NO SKU yet which
--     still carry a style_group_id. This is the direction the pre-#2408 rebuild could
--     not detect at all, because it only ever SET the column; it is also the
--     direction with a wrong-licensor consequence, since filter_effective_assets
--     resolves licensor/property/customer facets through style_groups.
-- 2.  `orphan_group_references` - live assets whose style_group_id matches no
--     style_groups row. Baseline zero, and structurally so: assets_style_group_id_fkey
--     is ON DELETE SET NULL. It is checked anyway because a future FK change, a
--     NOT VALID re-add or a restore is exactly the event nothing else would report.
-- 3.  Effective-tag projection drift, SAMPLED - public.asset_effective_tags is a
--     multi-million-row projection and an exhaustive comparison is not a thing to run
--     on a schedule. `p_effective_tag_sample` live assets are drawn at random; for
--     each, the desired set (active asset_tags at scope 'asset', plus active
--     style_group_tags of its group at scope 'style_group') is compared both ways
--     against the actual projection rows. Passing a sample larger than the live asset
--     count compares every asset, which is what the contract test does.
--
--     ALERT ON THE RATE, NOT ON A ROW. `effective_tag_drift_rate` is drifted sampled
--     assets over sampled assets. A sample will occasionally catch an in-flight
--     transaction, so a single drifted asset is noise; a rate that moves is not.
--     Directions 1a, 1b and 2 are whole-population counts and any non-zero value
--     there is real.
--
-- The row also carries the population figures (`live_assets`, `grouped_assets`,
-- `ungrouped_assets`, `style_group_rows`, `effective_tag_rows`) so the alerting job
-- records today's reading rather than a number pasted into a document
-- (AGENTS.md 4.3).
--
-- COST. One pass over live assets with a per-row regex derivation, two index lookups
-- against style_groups per row, plus count(*) over style_groups and
-- asset_effective_tags. statement_timeout is set to 600s for that reason - it is a
-- scheduled read, not an interactive one - and lock_timeout to 5s so it can never sit
-- in a lock queue in front of a writer. It takes no locks of its own beyond the
-- ordinary ACCESS SHARE of a SELECT.
--
-- GRANTS. New object, so the ACL is set here from scratch: EXECUTE is REVOKED from
-- PUBLIC (the default for a new function is EXECUTE to PUBLIC) and granted to
-- postgres and service_role only. `anon` and `authenticated` get nothing: the
-- scheduled job runs as service_role, and although the function returns counts rather
-- than rows, it is SECURITY DEFINER over the whole live asset table and there is no
-- reason for a browser session to hold it.
--
-- ROLLBACK: a new forward migration doing
-- `drop function if exists public.reconcile_style_group_drift(integer);`. Nothing
-- else was changed, so nothing else has to be undone.
--
-- Contracts: supabase/tests/style_group_drift_reconciler_contracts.sql
-- =====================================================================================

create or replace function public.reconcile_style_group_drift(
  p_effective_tag_sample integer default 5000
)
returns table (
  observed_at timestamptz,
  live_assets bigint,
  grouped_assets bigint,
  ungrouped_assets bigint,
  style_group_rows bigint,
  effective_tag_rows bigint,
  assets_missing_or_wrong_group bigint,
  assets_with_unexpected_group bigint,
  orphan_group_references bigint,
  effective_tag_sample_assets bigint,
  effective_tag_missing_rows bigint,
  effective_tag_extra_rows bigint,
  effective_tag_drifted_assets bigint,
  effective_tag_drift_rate numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '600s'
set lock_timeout = '5s'
as $$
with live as (
  select
    a.id,
    a.style_group_id,
    -- VERBATIM from public.rebuild_style_groups_batch (20260906035323, itself derived
    -- from 20260708150000). Do not "tidy" this: the contract test compares the four
    -- predicates in this expression against the ones in the live rebuild body and
    -- fails the build if they stop matching.
    (
      select seg
      from unnest(string_to_array(a.relative_path, '/')) with ordinality as t(seg, ord)
      where seg ~ '^[A-Za-z0-9]+$'
        and seg ~ '[A-Za-z]'
        and seg ~ '[0-9]'
        and length(seg) >= 7
        and ord < array_length(string_to_array(a.relative_path, '/'), 1)
      order by ord
      limit 1
    ) as sku
  from public.assets a
  where a.is_deleted = false
),
resolved as (
  select
    l.id,
    l.style_group_id,
    l.sku,
    expected.id as expected_group_id,
    (held.id is not null) as held_group_exists
  from live l
  -- The group the SKU rule says this asset belongs in. NULL when the path yields no
  -- SKU, and also NULL when it yields one for which no style_groups row exists yet.
  left join public.style_groups expected on expected.sku = l.sku
  -- The group the asset actually points at. A NULL here with a non-null
  -- style_group_id is an orphan reference.
  left join public.style_groups held on held.id = l.style_group_id
),
group_drift as (
  select
    count(*) as live_assets,
    count(*) filter (where style_group_id is not null) as grouped_assets,
    count(*) filter (where style_group_id is null) as ungrouped_assets,
    -- 1a. Should be grouped; is not, or is in the wrong group. `expected_group_id is
    -- null` is included on purpose: a SKU with no style_groups row is an asset the
    -- rebuild would group on its next pass, so it is drift now.
    count(*) filter (
      where sku is not null
        and (expected_group_id is null or style_group_id is distinct from expected_group_id)
    ) as assets_missing_or_wrong_group,
    -- 1b. Carries a group but should not.
    count(*) filter (where sku is null and style_group_id is not null)
      as assets_with_unexpected_group,
    -- 2. Points at a style_groups row that does not exist.
    count(*) filter (where style_group_id is not null and not held_group_exists)
      as orphan_group_references
  from resolved
),
tag_sample as (
  select r.id, r.style_group_id
  from resolved r
  order by random()
  limit greatest(coalesce(p_effective_tag_sample, 0), 0)
),
desired_tags as (
  select s.id as asset_id, t.tag, 'asset'::text as scope
  from tag_sample s
  join public.asset_tags t
    on t.asset_id = s.id
   and t.status = 'active'
  union
  select s.id, gt.tag, 'style_group'::text
  from tag_sample s
  join public.style_group_tags gt
    on gt.style_group_id = s.style_group_id
   and gt.status = 'active'
),
actual_tags as (
  select e.asset_id, e.tag, e.scope
  from tag_sample s
  join public.asset_effective_tags e on e.asset_id = s.id
),
missing_tags as (
  select asset_id, tag, scope from desired_tags
  except
  select asset_id, tag, scope from actual_tags
),
extra_tags as (
  select asset_id, tag, scope from actual_tags
  except
  select asset_id, tag, scope from desired_tags
),
tag_drift as (
  select
    (select count(*) from tag_sample) as sample_assets,
    (select count(*) from missing_tags) as missing_rows,
    (select count(*) from extra_tags) as extra_rows,
    (
      select count(*)
      from (
        select asset_id from missing_tags
        union
        select asset_id from extra_tags
      ) drifted
    ) as drifted_assets
)
select
  now(),
  g.live_assets,
  g.grouped_assets,
  g.ungrouped_assets,
  (select count(*) from public.style_groups),
  (select count(*) from public.asset_effective_tags),
  g.assets_missing_or_wrong_group,
  g.assets_with_unexpected_group,
  g.orphan_group_references,
  t.sample_assets,
  t.missing_rows,
  t.extra_rows,
  t.drifted_assets,
  case
    when t.sample_assets = 0 then null
    else round(t.drifted_assets::numeric / t.sample_assets::numeric, 6)
  end
from group_drift g
cross join tag_drift t;
$$;

comment on function public.reconcile_style_group_drift(integer) is
  'Issue #2419. READ-ONLY drift detector for style-group assignment and the asset_effective_tags projection. Returns one row of counts and repairs nothing; STABLE so PostgreSQL itself refuses a body containing INSERT/UPDATE/DELETE. Derives the SKU with the same rule as public.rebuild_style_groups_batch.';

-- New object: set the ACL explicitly. A new function is EXECUTE-to-PUBLIC by default.
revoke all on function public.reconcile_style_group_drift(integer) from public;
grant execute on function public.reconcile_style_group_drift(integer) to postgres;
grant execute on function public.reconcile_style_group_drift(integer) to service_role;
