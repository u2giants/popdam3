---
summary: Issue 5609 read-only pre-change measurement of assets and dam_search_documents update, dead-tuple and HOT counters before the trigger-scoping migration.
kind: proof
status: done
read-when: comparing document-write rates before the 5609 trigger-scoping apply
---

# Issue #5609 pre-application document-write rate

This is a read-only **pre-change** measurement, not production application or live acceptance. At November 5, 2026, 12:01:25 AM EST the migration was explicitly confirmed absent in the same snapshot as the counters below. The first endpoint is the recorded November 4, 2026, 10:37:14 PM EST baseline in `assets-trigger-scoping-baseline.md`.

```json
{
  "tables": [
    {
      "relname": "assets",
      "n_tup_upd": 111539,
      "n_dead_tup": 31768,
      "n_live_tup": 150884,
      "n_tup_hot_upd": 62559
    },
    {
      "relname": "dam_search_documents",
      "n_tup_upd": 96558,
      "n_dead_tup": 37279,
      "n_live_tup": 147282,
      "n_tup_hot_upd": 15791
    }
  ],
  "observed_at": "2026-11-05T00:01:25.202618-05:00",
  "migration_recorded": false,
  "database_stats_reset": null,
  "statement_stats_reset": "2026-11-04T12:52:59.176055-05:00"
}
```

First endpoint: `2026-11-04T22:37:14.356072-05:00`, assets `n_tup_upd = 88680`, search documents `n_tup_upd = 87729`. Second endpoint: `2026-11-05T00:01:25.202618-05:00`, assets `111539`, search documents `96558`. Elapsed time is `5050.846546` seconds; document updates are `8829`, giving `8829 / 5050.846546` updates per second. Future proof compares the actual post-application 24-hour interval against this frozen pre-change interval; it does not infer table-counter age from the statement-statistics reset.

Statement statistics reset stayed at `2026-11-04T12:52:59.176055-05:00`. Database statistics reset is SQL NULL. Future proof must capture the actual post-apply reset, entry `stats_since`, postmaster start, exact query entry identity, and monotonic table/call/time/WAL counters. A reset, changed entry identity, counter regression, insufficient traffic, absent migration, or interval shorter than 24 hours refuses proof. No post-apply baseline is invented here.

Exact target-proved read-only second-snapshot query:

```sql
select jsonb_build_object('observed_at',now(),
 'migration_recorded',exists(select 1 from supabase_migrations.schema_migrations where version='20261105033827'),
 'statement_stats_reset',(select stats_reset from extensions.pg_stat_statements_info),
 'database_stats_reset',(select stats_reset from pg_stat_database where datname=current_database()),
 'tables',(select jsonb_agg(to_jsonb(s)) from(select relname,n_tup_upd,n_tup_hot_upd,n_live_tup,n_dead_tup
   from pg_stat_user_tables where schemaname='public' and relname in('assets','dam_search_documents'))s));
```

The immutable pre-change main asset PATCH reference remains `170.077045367033` ms mean and `59888.980667756245` WAL bytes per call from the 10:37 PM EST baseline. Its exact subsequent text query ID is `8695287796313115953`; observed entry identity is user OID `16486`, database OID `5`, top-level true. A future probe requires at least 100 matching post-apply calls and each interval mean below half of the frozen reference, plus document update rate reduction, zero thumbnail drift, three post-baseline current metadata matches, correct five scoped/sibling trigger bindings, and the existing reader's required grants. Individual table resets have no separate timestamp in the captured view; counter monotonicity and reset/start context are necessary safeguards, and any known table reset invalidates the interval.

The supported existing `Shared DB Live Proof` workflow can later run a committed read-only probe and produce its authenticated proof artifact. This introduces no scheduler or new production writer. The future probe template still has NULL post-apply constants and is deliberately **not published as runnable acceptance** until actual application succeeds and its real baseline is captured.

