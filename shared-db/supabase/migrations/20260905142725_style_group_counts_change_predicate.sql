-- =====================================================================================
-- Issue #2214 - style-group count refresh: write only rows that actually change.
-- Parent plan #2209 (`plan_database_efficiency_and_api_security.md`).
-- Claim #2395 reserves version 20260905142725 and exactly one object:
--
--   function public.refresh_style_group_counts_batch(uuid[])   (replaced in place)
--
-- derived-from: none
--
-- The function has no prior migration in supabase/migrations/. Its only source in this
-- repository is supabase/ci-bootstrap/010_pre_adoption_baseline.sql, and the live
-- production body was proved byte-equivalent to that baseline copy, so this migration
-- is a re-derivation of the baseline body and declares no migration base.
--
-- EVIDENCE THIS MIGRATION IS BUILT ON
-- ---------------------------------------------------------------------------------
-- Entry-gate evidence comment on issue #2214, read-only against production
-- (current_database() = postgres, current_user = supabase_read_only_user, project ref
-- qsllyeztdwjgirsysgai), measurement window pg_stat_statements stats_reset
-- 2026-08-28 21:01:00-04, elapsed 7 days 13:21:37 at capture:
--
--  1. 10,864 of 10,868 style groups already hold exactly the values this function is
--     about to write. Zero groups have a wrong asset_count; four have a stale
--     latest_file_date. The nightly reconcile therefore rewrites 99.96 % of the table
--     to correct four rows.
--  2. `SELECT public.refresh_style_group_counts_batch(array_agg(id)) FROM
--     public.style_groups` (cron job 6, 45 3 * * *) averaged 94,933 ms per call over 8
--     calls, against this function's own 30 s statement_timeout.
--  3. public.style_groups took 1,409,071 updates against 10,868 live rows in that
--     window - roughly 130 updates per live row per week - and each one re-fires
--     trg_dam_search_style_groups_refresh, which rebuilds that group's row in
--     dam_search_documents (3,521,227 updates, 732 MB).
--  4. REMOVING `updated_at = now()` FROM THE BODY WOULD ACHIEVE NOTHING. The table
--     carries an unconditional BEFORE UPDATE FOR EACH ROW trigger,
--     update_style_groups_updated_at -> update_updated_at_column(), whose whole body is
--     `NEW.updated_at = now()`. updated_at is stamped on every UPDATE whether or not
--     this function sets it. The only change that removes the write amplification is
--     not issuing the UPDATE for an unchanged row at all, and no caller-side scheduling
--     or coalescing can substitute for it.
--  5. NO NEW INDEX IS JUSTIFIED AND NONE IS ADDED. The read half is already
--     index-driven (assets_style_group_id_active_idx, 2,221,889 scans; style_groups_pkey,
--     14,009,537 scans). This migration adds no index and changes no index.
--  6. THE OTHER TWO FUNCTIONS IN THE ISSUE'S ORIGINAL SCOPE ARE DELIBERATELY UNTOUCHED.
--     The evidence explicitly records the write-side plans for clear_style_group_batch
--     and rebuild_style_groups_batch as NOT MEASURED (the read-only identity is refused
--     EXPLAIN on writes, SQLSTATE 42501), and states that no database-side change to
--     them can be justified on present evidence. Claim #2395 covers only this function.
--
-- WHAT CHANGES, EXACTLY
-- ---------------------------------------------------------------------------------
-- One added WHERE predicate on the UPDATE. Nothing else in the body moves: the `agg`
-- CTE, the SET list, the CASE expressions that clear the primary-asset fields for an
-- empty group, and `updated_at = now()` are all preserved verbatim.
--
-- The predicate is a full IS DISTINCT FROM comparison over every column the SET list
-- can actually change:
--   * asset_count and latest_file_date, compared to the freshly recomputed aggregate;
--   * the four primary_* columns, but only in the `agg.asset_count = 0` branch, because
--     that is the only branch in which the SET list can change them. When asset_count
--     is non-zero those four columns are set to themselves and can never differ.
-- IS DISTINCT FROM, not `<>`: latest_file_date and every primary_* column is nullable,
-- and `<>` would return NULL - never true - for a genuine NULL-to-value transition, so
-- a stale row would silently stop being corrected.
--
-- PRESERVED CONTRACT
-- ---------------------------------------------------------------------------------
--   * Signature `public.refresh_style_group_counts_batch(p_group_ids uuid[])`, argument
--     name included, so PostgREST named-argument RPC calls keep working.
--   * RETURNS integer, LANGUAGE sql, SECURITY DEFINER.
--   * SET search_path = public, SET statement_timeout = '30s', SET lock_timeout = '0'.
--   * EXECUTE granted to authenticated, service_role and postgres.
--   * The return value still counts rows WRITTEN. Its meaning is unchanged; the number
--     falls because fewer rows are written. The evidence confirms no caller reads it -
--     all four popdam3 edge-function sites are bare `await db.rpc(...)` and the
--     statement-trigger path uses PERFORM - so no caller contract is broken.
--
-- ROLLBACK: a new forward migration restoring the baseline body, which is the block
-- above minus the added WHERE predicate. No index or grant is touched, so nothing else
-- has to be undone.
--
-- Contracts: supabase/tests/style_group_counts_change_predicate_contracts.sql
-- =====================================================================================

create or replace function public.refresh_style_group_counts_batch(p_group_ids uuid[])
 returns integer
 language sql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
 set lock_timeout to '0'
as $function$
  WITH agg AS (
    SELECT
      sg.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id
      AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      -- Clear primary fields for empty groups so they disappear from the library
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
      -- Issue #2214: write only rows whose stored values actually differ from the
      -- recomputed aggregate. See the header for why removing `updated_at = now()`
      -- instead would achieve nothing.
      AND (
           sg.asset_count      IS DISTINCT FROM agg.asset_count
        OR sg.latest_file_date IS DISTINCT FROM agg.latest_file_date
        OR (agg.asset_count = 0
            AND (   sg.primary_asset_id        IS NOT NULL
                 OR sg.primary_asset_type      IS NOT NULL
                 OR sg.primary_thumbnail_url   IS NOT NULL
                 OR sg.primary_thumbnail_error IS NOT NULL))
      )
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

grant execute on function public.refresh_style_group_counts_batch(p_group_ids uuid[]) to authenticated;
grant execute on function public.refresh_style_group_counts_batch(p_group_ids uuid[]) to service_role;
grant execute on function public.refresh_style_group_counts_batch(p_group_ids uuid[]) to postgres;
