-- Issue #1467: retire the temporary normalization accelerator after #1427.
-- Both preview and production ledgers contain prerequisite 20260825041343 and
-- final activation 20260825082910, so the partial-index predicate can no longer
-- match a valid public.asset_tags row.
--
-- The guard below is a no-op on preview and production, where public.asset_tags
-- has existed since the pre-adoption baseline. It exists for the ephemeral
-- contract-test lane, which replays migrations from an empty database and only
-- retries the ones that failed after loading the baseline. Without a real
-- dependency on the table this drop would succeed as a no-op in the first pass,
-- never be retried, and 20260825041343 would then re-create the index in the
-- second pass -- leaving the ephemeral database in a state the #1467 contract
-- tests correctly refuse.

do $guard$
begin
  if to_regclass('public.asset_tags') is null then
    raise exception 'public.asset_tags is absent; normalization accelerator retirement must run after the table exists';
  end if;
end $guard$;

drop index if exists public.asset_tags_pending_metadata_normalization_idx;
