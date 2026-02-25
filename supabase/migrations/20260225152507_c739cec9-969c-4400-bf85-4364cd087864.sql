CREATE OR REPLACE FUNCTION public.claim_render_jobs(
  p_agent_id text,
  p_batch_size integer DEFAULT 1,
  p_lease_minutes integer DEFAULT 5,
  p_max_attempts integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  asset_id uuid,
  attempts integer,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT rq.id
    FROM render_queue rq
    WHERE (
      -- Pending jobs
      rq.status = 'pending'
      OR
      -- Expired-lease claimed jobs (crashed agent)
      (rq.status = 'claimed' AND rq.lease_expires_at IS NOT NULL AND rq.lease_expires_at < now())
    )
    AND rq.attempts < p_max_attempts
    ORDER BY rq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE render_queue rq
  SET
    status = 'claimed',
    claimed_by = p_agent_id,
    claimed_at = now(),
    lease_expires_at = now() + (p_lease_minutes || ' minutes')::interval,
    attempts = rq.attempts + 1
  FROM claimable
  WHERE rq.id = claimable.id
  RETURNING rq.id, rq.asset_id, rq.attempts, rq.lease_expires_at;
END;
$$;