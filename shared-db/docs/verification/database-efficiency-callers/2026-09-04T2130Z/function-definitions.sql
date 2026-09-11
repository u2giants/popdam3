-- Step 3 evidence: live production definitions, read 2026-09-04 ~21:30 UTC
-- Project ref: qsllyeztdwjgirsysgai (production)
-- Source: SELECT pg_get_functiondef(p.oid) ... (queries Q5 and Q11 in call-graph.md)
-- Source: SELECT pg_get_triggerdef(t.oid) ... (queries Q6 and Q19 in call-graph.md)
--
-- REFERENCE ONLY. This file is a verbatim read of deployed state for audit.
-- It is NOT a migration and MUST NOT be applied. shared-db structural changes
-- are authored as forward-only migrations through the orchestrator.

-- ---------------------------------------------------------------------------
-- HOW TO REPRODUCE THIS EVIDENCE EXACTLY
-- ---------------------------------------------------------------------------
-- The long plpgsql bodies (rebuild_style_groups_batch is ~130 lines,
-- sync_asset_effective_tags ~90) are deliberately NOT hand-transcribed here.
-- Retyping identifiers by hand is how a corrupted name spreads by imitation,
-- and a transcription error in an evidence file is worse than a pointer to the
-- authoritative source. Run these to obtain byte-exact deployed definitions:

SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'rebuild_style_groups_batch',
    'clear_style_group_batch',
    'refresh_style_group_counts_batch',
    'refresh_style_guide_matviews',
    'sync_asset_effective_tags',
    'queue_nightly_rebuild_style_groups',
    'refresh_style_group_counts_on_asset_change'
  )
ORDER BY p.proname;

SELECT c.relname AS table_name, t.tgname, p.proname AS function_name,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND c.relname IN ('assets', 'style_groups', 'asset_tags', 'style_group_tags')
ORDER BY c.relname, t.tgname;

-- ---------------------------------------------------------------------------
-- SHORT DEFINITIONS, VERBATIM (quoted in full in call-graph.md sections 3.5-6.2)
-- ---------------------------------------------------------------------------

-- The whole body of refresh_style_guide_matviews(). Note the second statement
-- is NOT concurrent, and style_guide_folders has zero unique indexes, so
-- CONCURRENTLY is not currently possible for it.
--
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups;
--   REFRESH MATERIALIZED VIEW public.style_guide_folders;

-- The partial index that makes clear_style_group_batch keyset-clean:
CREATE INDEX idx_assets_clear_style_cursor ON public.assets USING btree (id)
  WHERE ((is_deleted = false) AND (style_group_id IS NOT NULL));

-- The index serving the counts aggregation:
CREATE INDEX assets_style_group_id_active_idx ON public.assets USING btree (style_group_id, id)
  WHERE ((is_deleted = false) AND (style_group_id IS NOT NULL));

-- The three triggers that populate asset_effective_tags. There is no scheduled
-- job and no application RPC for this table.
CREATE TRIGGER asset_tags_effective_tags_sync AFTER INSERT OR DELETE OR UPDATE
  ON public.asset_tags FOR EACH ROW EXECUTE FUNCTION sync_asset_effective_tags();
CREATE TRIGGER style_group_tags_effective_tags_sync AFTER INSERT OR DELETE OR UPDATE
  ON public.style_group_tags FOR EACH ROW EXECUTE FUNCTION sync_asset_effective_tags();
CREATE TRIGGER assets_effective_tags_sync AFTER INSERT OR DELETE OR UPDATE OF style_group_id, is_deleted
  ON public.assets FOR EACH ROW EXECUTE FUNCTION sync_asset_effective_tags();

-- The trigger that turns a no-op counts update into a search-document rebuild.
-- updated_at is itself a trigger key, and refresh_style_group_counts_batch sets
-- updated_at = now() unconditionally on every group it is passed.
CREATE TRIGGER trg_dam_search_style_groups_refresh
  AFTER INSERT OR DELETE OR UPDATE OF sku, folder_path, cover_description, customer, program,
    licensor_name, property_name, product_category, division_name, mg01_name, mg02_name,
    mg03_name, size_name, asset_count, workflow_status, is_licensed, primary_thumbnail_url,
    updated_at, latest_file_date
  ON public.style_groups FOR EACH ROW
  EXECUTE FUNCTION trg_refresh_dam_style_group_search_document();
