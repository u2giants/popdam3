
-- TIFF optimization queue: tracks scanned TIFFs and compression jobs
CREATE TABLE public.tiff_optimization_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relative_path text NOT NULL,
  filename text NOT NULL,
  file_size bigint NOT NULL,
  file_modified_at timestamptz NOT NULL,
  file_created_at timestamptz,
  compression_type text, -- 'none', 'zip', 'lzw', 'packbits', 'jpeg', 'deflate', etc.
  status text NOT NULL DEFAULT 'scanned', -- scanned, queued_test, queued_process, processing, completed, failed
  mode text, -- 'test' or 'process'
  new_file_size bigint,
  new_filename text,
  new_file_modified_at timestamptz,
  new_file_created_at timestamptz,
  original_backed_up boolean DEFAULT false,
  original_deleted boolean DEFAULT false,
  error_message text,
  scan_session_id text,
  claimed_by text,
  claimed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(relative_path)
);

-- Enable RLS
ALTER TABLE public.tiff_optimization_queue ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admin manage tiff_optimization_queue" ON public.tiff_optimization_queue
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Indexes
CREATE INDEX idx_tiff_opt_status ON public.tiff_optimization_queue(status);
CREATE INDEX idx_tiff_opt_compression ON public.tiff_optimization_queue(compression_type);

-- Claim function for Windows Agent
CREATE OR REPLACE FUNCTION public.claim_tiff_jobs(
  p_agent_id text,
  p_batch_size integer DEFAULT 1,
  p_lease_minutes integer DEFAULT 10
)
RETURNS TABLE(id uuid, relative_path text, filename text, file_size bigint, file_modified_at timestamptz, file_created_at timestamptz, mode text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT tq.id
    FROM tiff_optimization_queue tq
    WHERE tq.status IN ('queued_test', 'queued_process')
    ORDER BY tq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE tiff_optimization_queue tq
  SET
    status = 'processing',
    claimed_by = p_agent_id,
    claimed_at = now()
  FROM claimable
  WHERE tq.id = claimable.id
  RETURNING tq.id, tq.relative_path, tq.filename, tq.file_size, tq.file_modified_at, tq.file_created_at,
    CASE WHEN tq.status = 'queued_test' THEN 'test' ELSE 'process' END AS mode;
END;
$$;
