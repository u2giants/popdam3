-- Drop the no-arg overload so PostgREST resolves unambiguously to the batched version.
-- PostgREST picks the no-arg function when both overloads exist (it ignores passed params
-- if a zero-arg match exists), causing the full-table UPDATE to hit the proxy timeout.
DROP FUNCTION IF EXISTS public.requeue_all_failed_sg_jobs();
