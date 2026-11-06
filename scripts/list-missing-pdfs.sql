-- Read-only. PDFs whose file was not at the recorded path on their last read.
-- Save as CSV and compare with an edgesynology1 file index; see
-- docs/KNOWN_QUIRKS.md "PDFs missing at their recorded path".
-- PDFs only: pdf_text_samples also holds .ai rows, which this workflow does
-- not repoint (#676).
select a.id as asset_id, a.filename, a.relative_path, a.file_size, a.modified_at, a.quick_hash,
       coalesce(s.indra_rescan_error, s.extraction_error) as error
from public.pdf_text_samples s
join public.assets a on a.id = s.asset_id
where coalesce(a.is_deleted, false) = false
  and a.file_type = 'pdf'
  and (s.indra_rescan_error ilike 'ENOENT%' or s.extraction_error ilike 'ENOENT%')
order by a.relative_path;
