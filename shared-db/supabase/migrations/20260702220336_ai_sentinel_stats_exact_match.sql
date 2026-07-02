-- Tighten the .ai "sentinel" pending count to an EXACT match on the canonical phrase.
--
-- Illustrator files saved without "Create PDF Compatible File" embed only Adobe's
-- boilerplate warning instead of artwork. The DAM bridge agent collapses a CONFIRMED
-- sentinel's pdf_text_samples.extracted_text to exactly this phrase; real .ai keep
-- their actual extracted text. The previous definition used a LIKE substring match,
-- which also counted real artwork that merely carries the CompatibilityAlert text on
-- the page. Matching the phrase exactly keeps genuine placeholders and excludes real
-- artwork, aligning this count with the DAM admin cleanup list (which the DAM
-- admin-api edge handler already matches exactly).
--
-- Re-homed here per shared-db ownership; previously authored app-side in popdam-web.
create or replace function get_ai_sentinel_stats()
returns jsonb
language sql stable security definer as $$
  select jsonb_build_object(
    'total_ai',
      (select count(*) from assets where file_type = 'ai' and is_deleted = false),
    'sampled',
      (select count(*) from pdf_text_samples pts
       join assets a on a.id = pts.asset_id
       where a.file_type = 'ai' and a.is_deleted = false),
    'sentinel_pending',
      (select count(*) from pdf_text_samples pts
       join assets a on a.id = pts.asset_id
       where a.file_type = 'ai'
         and a.is_deleted = false
         and pts.extracted_text = 'This is an Adobe® Illustrator® File that was saved without PDF Content.'
         and not exists (
           select 1 from ai_sentinel_cleanup_log l where l.ai_asset_id = a.id
         )),
    'cleaned_up',
      (select count(*) from ai_sentinel_cleanup_log),
    'no_replacement_found',
      (select count(*) from ai_sentinel_cleanup_log where replacement_asset_id is null)
  );
$$;

grant execute on function get_ai_sentinel_stats() to service_role;
