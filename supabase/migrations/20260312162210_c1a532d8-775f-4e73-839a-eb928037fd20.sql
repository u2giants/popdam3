-- Step 1: Remove duplicate agent_registrations, keeping the row with latest heartbeat (ties broken by created_at)
DELETE FROM public.agent_registrations a
USING public.agent_registrations b
WHERE a.agent_name = b.agent_name
  AND a.id != b.id
  AND (
    (a.last_heartbeat IS NULL AND b.last_heartbeat IS NOT NULL)
    OR (a.last_heartbeat IS NOT NULL AND b.last_heartbeat IS NOT NULL AND a.last_heartbeat < b.last_heartbeat)
    OR (a.last_heartbeat IS NOT NULL AND b.last_heartbeat IS NOT NULL AND a.last_heartbeat = b.last_heartbeat AND a.created_at < b.created_at)
    OR (a.last_heartbeat IS NULL AND b.last_heartbeat IS NULL AND a.created_at < b.created_at)
  );

-- Step 2: Add unique constraint on agent_name
ALTER TABLE public.agent_registrations
ADD CONSTRAINT agent_registrations_agent_name_key UNIQUE (agent_name);