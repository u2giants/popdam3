-- Remove the per-row fuzzy resolve trigger on public.sku_files_used (#5092 follow-up).
--
-- WHY. trg_fn_resolve_sku_file_used fires on every insert into sku_files_used and
-- scans style_guide_files with
--   normalize_for_sg_match(filename) = normalize_for_sg_match(NEW.file_name)
-- an unindexed per-row expression scan over the 214k-row library. It manufactured
-- 0.6-trigram-similarity style-guide links that are not licensor statements, and it
-- already broke the historical parse backfill with a statement timeout inside the
-- trigger (observed 2026-10-30 while running backfill_pdf_files_used_v2()). The
-- licensor-scrape cross-reference public.sku_style_guide_links (migration
-- 20261030043848) answers the item -> style-guide question from direct portal
-- assertions now, and the nightly fuzzy resolver is already unscheduled.
--
-- Existing sku_files_used.style_guide_file_id values are untouched: quarantine
-- model, never auto-unlink. The batch helper resolve_sku_files_used() from
-- 20260503202754 stays callable on purpose; only the per-row trigger goes.

drop trigger if exists trg_resolve_sku_file_used on public.sku_files_used;

drop function if exists public.trg_fn_resolve_sku_file_used();
