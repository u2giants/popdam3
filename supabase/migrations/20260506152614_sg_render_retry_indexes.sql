-- Speed up retry_sg_render_errors: partial index for files that need retrying
CREATE INDEX IF NOT EXISTS idx_sgf_render_errored
  ON public.style_guide_files (id)
  WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NOT NULL;

-- Speed up queue_sg_render_jobs_by_ids NOT EXISTS check
CREATE INDEX IF NOT EXISTS idx_sgrq_file_status
  ON public.style_guide_render_queue (style_guide_file_id, status);
