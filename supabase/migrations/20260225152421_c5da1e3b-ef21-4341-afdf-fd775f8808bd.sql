ALTER TABLE public.render_queue
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;