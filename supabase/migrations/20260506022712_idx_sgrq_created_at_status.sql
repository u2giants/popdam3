CREATE INDEX IF NOT EXISTS idx_sgrq_created_at
  ON public.style_guide_render_queue USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sgrq_status_created_at
  ON public.style_guide_render_queue USING btree (status, created_at DESC);
