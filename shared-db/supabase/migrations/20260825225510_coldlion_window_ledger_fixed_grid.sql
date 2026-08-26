-- Issue #1195: pin every ColdLion history window to the owner-approved
-- seven-day grid anchored at 2019-01-01. The existing identity constraint
-- prevents duplicate starts; this constraint also prevents a shifted grid
-- from creating overlapping requests with different starts.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'coldlion.window_ledger'::regclass
      and conname = 'coldlion_window_ledger_fixed_grid'
  ) then
    alter table coldlion.window_ledger
      add constraint coldlion_window_ledger_fixed_grid
      check ((window_from - date '2019-01-01') % 7 = 0);
  end if;
end;
$$;

comment on table coldlion.window_ledger is
  'One row per 7-day window per capped history endpoint (/prodHistory, /orderHistory), with its state: pending, running, loaded or failed. This is what makes a multi-year backfill resumable and what proves no window was skipped or double-counted. Those two endpoints are NOT paged - `page`/`size` are silently ignored, so chunking is by date window only and a window is all-or-nothing. Windows advance by exactly 7 days (toDate = fromDate + 6) on the single grid anchored at 2019-01-01. Issue #1184 phase 1; fixed-grid follow-up #1195.';
