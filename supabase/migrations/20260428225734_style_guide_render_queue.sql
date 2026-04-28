-- 1. Queue table: mirrors render_queue but references style_guide_files
CREATE TABLE public.style_guide_render_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  style_guide_file_id uuid NOT NULL REFERENCES public.style_guide_files(id) ON DELETE CASCADE,
  status public.queue_status NOT NULL DEFAULT 'pending',
  claimed_by text NULL,
  claimed_at timestamptz NULL,
  completed_at timestamptz NULL,
  error_message text NULL,
  lease_expires_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sgrq_status ON public.style_guide_render_queue(status);
CREATE INDEX idx_sgrq_file_id ON public.style_guide_render_queue(style_guide_file_id);

ALTER TABLE public.style_guide_render_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage style_guide_render_queue"
  ON public.style_guide_render_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Atomic claim with FOR UPDATE SKIP LOCKED (mirrors claim_render_jobs)
CREATE OR REPLACE FUNCTION public.claim_sg_render_jobs(
  p_agent_id text,
  p_batch_size int DEFAULT 1,
  p_lease_minutes int DEFAULT 5,
  p_max_attempts int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  style_guide_file_id uuid,
  attempts int,
  lease_expires_at timestamptz
)
LANGUAGE sql
AS $$
  UPDATE public.style_guide_render_queue q
  SET
    status = 'claimed',
    claimed_by = p_agent_id,
    claimed_at = now(),
    lease_expires_at = now() + (p_lease_minutes || ' minutes')::interval,
    attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT id FROM public.style_guide_render_queue
    WHERE
      (status = 'pending' OR (status = 'claimed' AND lease_expires_at < now()))
      AND attempts < p_max_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING q.id, q.style_guide_file_id, q.attempts, q.lease_expires_at;
$$;

-- 3. Insert pending jobs for a set of file IDs (called per crawl batch).
--    Skips files already pending/claimed, already thumbnailed, errored, or unsupported type.
CREATE OR REPLACE FUNCTION public.queue_sg_render_jobs_by_ids(p_file_ids uuid[])
RETURNS int
LANGUAGE sql
AS $$
  WITH inserted AS (
    INSERT INTO public.style_guide_render_queue (style_guide_file_id)
    SELECT t.id
    FROM unnest(p_file_ids) AS t(id)
    JOIN public.style_guide_files f ON f.id = t.id
    WHERE f.thumbnail_url IS NULL
      AND f.thumbnail_error IS NULL
      AND lower(f.file_extension) IN ('pdf', 'ai', 'psd')
      AND NOT EXISTS (
        SELECT 1 FROM public.style_guide_render_queue q
        WHERE q.style_guide_file_id = t.id
          AND q.status IN ('pending', 'claimed')
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;
