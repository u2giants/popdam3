-- =====================================================================================
-- Issue #4174 - serialize on-demand style-group count refreshes against the nightly
-- reconcile (PopDAM u2giants/popdam3#294, app half landed in popdam3 PR #325).
-- Claim #4177 reserves version 20261011195719 and exactly one object:
--
--   function public.refresh_style_group_counts_serialized(uuid[])   (new)
--
-- derived-from: none
--
-- WHY A WRAPPER, AND WHY THIS LOCK KEY
-- ---------------------------------------------------------------------------------
-- 1. The lock is NOT added inside public.refresh_style_group_counts_batch(uuid[]).
--    That function is also called per row by the asset triggers
--    refresh_style_group_counts_on_asset_change() and
--    refresh_group_on_asset_hard_delete(); a lock there would make ordinary asset
--    writes wait for, or fail behind, the multi-minute nightly reconcile.
-- 2. The nightly reconcile is pg_cron job `nightly-rebuild-style-groups` ->
--    public.queue_nightly_rebuild_style_groups(). That function takes
--    pg_advisory_xact_lock(hashtext('BULK_OPERATIONS')) first and holds it for its whole
--    transaction, including its chunked refresh_style_group_counts_batch loop. Taking
--    the same key here serializes admin/edge callers against that job without editing
--    it (it is claimed by #4158).
-- 3. lock_timeout is bounded (5s) instead of 0, so a caller blocked behind the nightly
--    job fails visibly with SQLSTATE 55P03 (lock_not_available) and can retry, instead
--    of waiting without limit. The inner function's own `SET lock_timeout = 0` applies
--    only after this lock is already held.
-- 4. Ids are de-duplicated and sorted so concurrent callers update rows in one order.
-- 5. Execute is limited to service_role (the edge functions' client). The existing
--    function and its grants are unchanged: the advisory lock binds only callers that
--    use this wrapper (the PopDAM edge functions, switched in popdam3 #294); the asset
--    triggers keep calling refresh_style_group_counts_batch directly by design (1).
-- 6. CONTENTION, ACCEPTED AND BOUNDED: holding the BULK_OPERATIONS key also makes the
--    other BULK_OPERATIONS writers (update_bulk_operation, update_bulk_operations_batch,
--    which set no lock_timeout) wait while a wrapper call runs. Edge callers pass only
--    the groups an admin action touched, so a call is normally milliseconds. Be exact
--    about the bound: PostgreSQL arms statement_timeout when the top-level statement
--    starts, so neither this wrapper's `statement_timeout = 15s` nor the callee's
--    `30s` re-arms the timer of a call already running. The key-hold is bounded by
--    the statement_timeout in force for the calling statement (the API role's
--    setting for an RPC through PostgREST); the function-level clauses are kept only
--    as declared intent and do not tighten that bound. Ids are passed in one call, not chunked,
--    so the key is taken once per call rather than held across chunks.
--
-- ROLLBACK: drop function public.refresh_style_group_counts_serialized(uuid[]);
-- =====================================================================================

create function public.refresh_style_group_counts_serialized(p_group_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '15s'
set lock_timeout to '5s'
as $function$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(distinct g order by g), '{}'::uuid[])
    into v_ids
  from unnest(p_group_ids) as g
  where g is not null;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  return coalesce(public.refresh_style_group_counts_batch(v_ids), 0);
end;
$function$;

revoke all on function public.refresh_style_group_counts_serialized(uuid[]) from public;
revoke all on function public.refresh_style_group_counts_serialized(uuid[]) from anon;
revoke all on function public.refresh_style_group_counts_serialized(uuid[]) from authenticated;
grant execute on function public.refresh_style_group_counts_serialized(uuid[]) to service_role;

comment on function public.refresh_style_group_counts_serialized(uuid[]) is
  'shared-db#4174: refresh_style_group_counts_batch under the BULK_OPERATIONS advisory lock '
  '(same key the nightly reconcile holds), lock_timeout 5s; fails with 55P03 when blocked.';
