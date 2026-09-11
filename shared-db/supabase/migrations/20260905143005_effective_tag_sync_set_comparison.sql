-- Issue #2213 (parent #2209): stop the measured no-op write amplification in the
-- effective-tag projection.
--
-- derived-from: 20260830110517
--
-- The body below is re-derived from that migration's
-- public.sync_asset_effective_tags(), which the #2213 evidence confirms is
-- byte-for-byte identical to pg_get_functiondef in production. This file must
-- not be applied to a database that does not already hold that base.
--
-- EVIDENCE THIS IMPLEMENTS (issue #2213, the #2209 Steps 1 & 3 read-only
-- production comment). Over a 7.556-day window ending 2026-09-05:
--
--   * public.asset_effective_tags took 6,762,623 deletes and 6,762,623 inserts
--     after its one-off backfill, and n_live_tup never moved off the backfill's
--     own 2,045,705 rows. Net change from 13,525,246 row versions: ZERO.
--   * All of it came from one PostgREST statement shape,
--     UPDATE "public"."assets" SET "style_group_id" = ..., 710,514 calls, which
--     is the only observed shape naming a column the assets trigger watches.
--     9.52 projection rows were rewritten per firing.
--   * The churn is provably 100% no-op: the assets branch re-derives the set
--     from public.asset_tags (ZERO writes in the window) and
--     public.style_group_tags (EMPTY), so the re-derived set is identical to
--     the set it had just deleted, whether or not style_group_id changed value.
--   * Consequence in the catalogue: 261,433 dead tuples, 11.33% of the table,
--     16 autovacuum cycles, on a projection whose content has not changed since
--     the backfill.
--   * The reported 181-second population is the one-off migration backfill
--     (pg_stat_statements calls = 1), NOT a recurring job.
--
-- WHAT WAS RULED OUT ON THE SAME MEASUREMENT, and is deliberately NOT done here:
--   * A supporting index. The delete already runs as an index scan on the
--     asset_id-leading unique index: idx_tup_fetch 6,762,627 vs n_tup_del
--     6,762,623. The delete path is not scan-bound and no index is missing.
--   * Statement-level transition handling, a durable changed-ID path, and
--     staging/swap. None is needed once the rewrite itself is conditional, and
--     each is a larger change than the evidence supports.
--
-- THE CHANGE. Exactly one thing moves: the assets branch stops being an
-- unconditional delete-all-then-reinsert of the asset's whole tag set and
-- becomes an unchanged-set comparison -- delete only the rows that are no
-- longer derived, insert only the rows that are newly derived. An unchanged
-- input set therefore writes nothing at all.
--
-- The asset_tags and style_group_tags branches are transcribed BYTE FOR BYTE
-- from the live baseline (supabase/migrations/20260830110517_popdam_effective_
-- asset_filters.sql, confirmed identical to pg_get_functiondef in production).
-- They were already single-row targeted and contribute none of the measured
-- churn, so touching them would be a speculative rewrite.
--
-- Signature, return type, volatility, SECURITY DEFINER, search_path, the
-- advisory-lock protocol (F2 of the #1664 review) and every grant are preserved
-- exactly. The three triggers are NOT redefined: they keep pointing at this
-- function by name and are outside this change's claimed objects.
--
-- ROLLBACK is a new forward migration restoring the function body from
-- 20260830110517_popdam_effective_asset_filters.sql verbatim. No index, trigger,
-- table, policy or grant is added, altered or removed here, so nothing else has
-- to be restored.

begin;

create or replace function public.sync_asset_effective_tags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock_keys text[];
  v_lock_ids bigint[];
  v_lock_id bigint;
begin
  -- F2 (#1664 review): re-derivation reads a snapshot of the *other* source
  -- table, so a concurrent regroup and group-tag write can each omit the same
  -- (asset, tag, style_group) key with no unique conflict to force a retry.
  -- Each branch below serialises every writer touching the same asset or style
  -- group on a transaction-scoped advisory lock, acquired in sorted id order so
  -- two writers holding overlapping sets cannot deadlock against each other.
  if tg_table_name = 'asset_tags' then
    v_lock_keys := array['aet_asset:' || coalesce(new.asset_id, old.asset_id)::text];
  elsif tg_table_name = 'style_group_tags' then
    v_lock_keys := array['aet_group:' || new.style_group_id::text,
                         'aet_group:' || old.style_group_id::text];
  elsif tg_table_name = 'assets' then
    v_lock_keys := array['aet_asset:' || coalesce(new.id, old.id)::text,
                         'aet_group:' || new.style_group_id::text,
                         'aet_group:' || old.style_group_id::text];
  else
    raise exception 'sync_asset_effective_tags called from unsupported table %', tg_table_name;
  end if;

  select coalesce(
           array_agg(distinct hashtextextended(k, 0) order by hashtextextended(k, 0)),
           '{}'::bigint[]
         )
    into v_lock_ids
  from unnest(v_lock_keys) k
  where k is not null;

  foreach v_lock_id in array v_lock_ids loop
    perform pg_advisory_xact_lock(v_lock_id);
  end loop;

  if tg_table_name = 'asset_tags' then
    if tg_op in ('DELETE', 'UPDATE') then
      delete from public.asset_effective_tags e
      where e.asset_id = old.asset_id
        and e.tag = old.tag
        and e.scope = 'asset';
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select new.asset_id, new.tag, 'asset'
      from public.assets a
      where a.id = new.asset_id
        and a.is_deleted = false
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'style_group_tags' then
    if tg_op in ('DELETE', 'UPDATE') then
      delete from public.asset_effective_tags e
      using public.assets a
      where a.id = e.asset_id
        and a.style_group_id = old.style_group_id
        and e.tag = old.tag
        and e.scope = 'style_group';
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select a.id, new.tag, 'style_group'
      from public.assets a
      where a.style_group_id = new.style_group_id
        and a.is_deleted = false
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'assets' then
    -- #2213. The old body deleted every projection row for the asset and then
    -- reinserted the freshly derived set unconditionally. The delete is kept
    -- verbatim ONLY for the states whose derived set is empty by definition --
    -- the asset row is gone, or it is now soft-deleted -- because there is
    -- nothing to compare against.
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.is_deleted = true) then
      delete from public.asset_effective_tags e
      where e.asset_id = old.id;

      if tg_op = 'DELETE' then return old; else return new; end if;
    end if;

    -- An UPDATE that moves the primary key would otherwise strand the old id's
    -- rows, which the old delete-all-by-old.id covered incidentally. Keep that
    -- behaviour explicitly; the comparison below is keyed on new.id.
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      delete from public.asset_effective_tags e
      where e.asset_id = old.id;
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.is_deleted = false then
      -- The desired set is derived exactly as before. `union` rather than
      -- `union all` only removes duplicates that the unique index would have
      -- collapsed anyway, so the resulting set is identical.
      with desired as (
        select new.id as asset_id, t.tag, 'asset'::text as scope
        from public.asset_tags t
        where t.asset_id = new.id
          and t.status = 'active'
        union
        select new.id as asset_id, t.tag, 'style_group'::text as scope
        from public.style_group_tags t
        where t.style_group_id = new.style_group_id
          and t.status = 'active'
      ),
      -- Data-modifying CTEs always execute, referenced or not. This removes
      -- only rows that are no longer derived; an unchanged set deletes nothing.
      removed as (
        delete from public.asset_effective_tags e
        where e.asset_id = new.id
          and not exists (
            select 1 from desired d
            where d.tag = e.tag
              and d.scope = e.scope
          )
        returning 1
      )
      -- Every CTE reads the same statement snapshot, so this `not exists` sees
      -- the pre-delete image. That is correct: a row `removed` deletes is by
      -- definition absent from `desired` and can never be selected here.
      -- `on conflict do nothing` still covers a concurrent inserter, exactly as
      -- the previous body did.
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select d.asset_id, d.tag, d.scope
      from desired d
      where not exists (
        select 1
        from public.asset_effective_tags e
        where e.asset_id = d.asset_id
          and e.tag = d.tag
          and e.scope = d.scope
      )
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  raise exception 'sync_asset_effective_tags called from unsupported table %', tg_table_name;
end;
$$;

-- Restated, not changed: `create or replace function` preserves the existing
-- ACL, and these are the grants the baseline installed.
revoke all on function public.sync_asset_effective_tags() from public, anon, authenticated;

comment on function public.sync_asset_effective_tags() is
  'Maintains public.asset_effective_tags. The assets branch compares the derived set against the stored set and writes only the difference (#2213); an unchanged set performs no delete and no insert.';

commit;
