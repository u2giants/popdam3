# pg_stat observation window (issue #2437)

Run this query alongside **any** `pg_stat_*` reading before quoting it. A usage counter
(`idx_scan`, `n_live_tup`, `n_tup_ins`, `seq_scan`) only covers the time since its last
reset, and nothing in the number says so.

```sql
-- Read-only. Returns the window every pg_stat counter in this database covers.
select
  now()                                                   as observed_at,
  pg_postmaster_start_time()                              as server_started_at,
  d.stats_reset                                           as database_stats_reset,
  (select stats_reset from pg_stat_bgwriter)              as bgwriter_stats_reset,
  coalesce(d.stats_reset, pg_postmaster_start_time())     as window_start,
  now() - coalesce(d.stats_reset, pg_postmaster_start_time()) as usable_window
from pg_stat_database d
where d.datname = current_database();
```

How to read it:

- `database_stats_reset` is null when the database counters were never hand-reset; the
  window then starts at `server_started_at`.
- `bgwriter_stats_reset` within a second of `server_started_at` means the counters date
  from a restart, not a manual `pg_stat_reset()`.
- Any object created after `window_start` has no usage history and must not be called
  unused from `pg_stat` alone.
- The window must also be shown to contain activity: pair it with a positive control,
  such as a table with known writes showing `n_tup_ins > 0`.

Put the output under "Observation window" in the destructive-proposal issue template.
