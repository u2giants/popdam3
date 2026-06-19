-- PopSG files-mode default lists `WHERE is_active ORDER BY modified_at DESC
-- NULLS LAST, filename` over 214k active rows, which did a parallel seq scan +
-- top-N sort (~489ms warm, slower cold, trending toward the 8s authenticated
-- ceiling as the library grows). This partial index lets it return the page in
-- index order with no sort. ~489ms -> ~35ms.
CREATE INDEX IF NOT EXISTS idx_style_guide_files_active_modified
  ON public.style_guide_files (modified_at DESC NULLS LAST, filename)
  WHERE is_active;
