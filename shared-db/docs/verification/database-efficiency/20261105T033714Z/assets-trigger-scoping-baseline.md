# Issue #5609 pre-change baseline

Exact query IDs and updated pre-change cumulative counters, November 4, 2026,
10:48:30 PM EST (read-only target re-proved immediately before this read):

```json
[
  {
    "queryid": "-3507091764867901600",
    "calls": 64,
    "total_exec_time": 2041.052813,
    "wal_bytes": "2897230",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "8695287796313115953",
    "calls": 21642,
    "total_exec_time": 3954079.07465001,
    "wal_bytes": "1292913927",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-5353890463906428388",
    "calls": 1,
    "total_exec_time": 54.48421,
    "wal_bytes": "77886",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-2200186808143858685",
    "calls": 6792,
    "total_exec_time": 1167909.294526,
    "wal_bytes": "340024533",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-4258679261381200171",
    "calls": 12,
    "total_exec_time": 266.611418,
    "wal_bytes": "546964",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-5438723947593814594",
    "calls": 16,
    "total_exec_time": 892.572837,
    "wal_bytes": "851453",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-640555994218644254",
    "calls": 1174,
    "total_exec_time": 49892.252451,
    "wal_bytes": "121554517",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-4489082252313461571",
    "calls": 2,
    "total_exec_time": 64.398165,
    "wal_bytes": "144748",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "6812761708967041595",
    "calls": 33,
    "total_exec_time": 1729.849443,
    "wal_bytes": "2122467",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-6408571764798647371",
    "calls": 123,
    "total_exec_time": 66108.368001,
    "wal_bytes": "7032995",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-9172451651300148137",
    "calls": 1,
    "total_exec_time": 13.104645,
    "wal_bytes": "34307",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "6430535887002143036",
    "calls": 212,
    "total_exec_time": 6312.977658,
    "wal_bytes": "9681162",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "6862715532547800613",
    "calls": 17,
    "total_exec_time": 209.016175,
    "wal_bytes": "448005",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  },
  {
    "queryid": "-4910506429341774761",
    "calls": 3,
    "total_exec_time": 3.519845,
    "wal_bytes": "21696",
    "observed_at": "2026-11-04 22:48:30.219347-05"
  }
]
```

Query: `select queryid::text,calls,total_exec_time,wal_bytes,now() as observed_at from extensions.pg_stat_statements where query ilike 'with pgrst_source as (update "public"."assets"%';`

Observed November 4, 2026, 10:37 PM EST, against the production target proved with `get_project_url` immediately before the read-only query. Statistics reset November 4, 2026, 12:52:59 PM EST. No counters were reset and no production data was written.

Raw sanitized metrics (no asset identities or licensed content):

```json
{
  "patch": [
    {
      "calls": 64,
      "queryid": -3507091764867901400,
      "wal_bytes": 2897230,
      "wal_per_call": 45269.21875,
      "mean_exec_time": 31.891450203125,
      "total_exec_time": 2041.052813
    },
    {
      "calls": 21415,
      "queryid": 8695287796313116000,
      "wal_bytes": 1282522521,
      "wal_per_call": 59888.980667756245,
      "mean_exec_time": 170.077045367033,
      "total_exec_time": 3642199.92653501
    },
    {
      "calls": 1,
      "queryid": -5353890463906428000,
      "wal_bytes": 77886,
      "wal_per_call": 77886,
      "mean_exec_time": 54.48421,
      "total_exec_time": 54.48421
    },
    {
      "calls": 6777,
      "queryid": -2200186808143858700,
      "wal_bytes": 339546166,
      "wal_per_call": 50102.72480448576,
      "mean_exec_time": 165.434137967832,
      "total_exec_time": 1121147.153008
    },
    {
      "calls": 12,
      "queryid": -4258679261381200400,
      "wal_bytes": 546964,
      "wal_per_call": 45580.333333333336,
      "mean_exec_time": 22.2176181666667,
      "total_exec_time": 266.611418
    },
    {
      "calls": 16,
      "queryid": -5438723947593815000,
      "wal_bytes": 851453,
      "wal_per_call": 53215.8125,
      "mean_exec_time": 55.7858023125,
      "total_exec_time": 892.572837
    },
    {
      "calls": 1174,
      "queryid": -640555994218644200,
      "wal_bytes": 121554517,
      "wal_per_call": 103538.77086882453,
      "mean_exec_time": 42.4976596686542,
      "total_exec_time": 49892.252451
    },
    {
      "calls": 2,
      "queryid": -4489082252313462000,
      "wal_bytes": 144748,
      "wal_per_call": 72374,
      "mean_exec_time": 32.1990825,
      "total_exec_time": 64.398165
    },
    {
      "calls": 33,
      "queryid": 6812761708967042000,
      "wal_bytes": 2122467,
      "wal_per_call": 64317.181818181816,
      "mean_exec_time": 52.4196800909091,
      "total_exec_time": 1729.849443
    },
    {
      "calls": 77,
      "queryid": -6408571764798647000,
      "wal_bytes": 4143947,
      "wal_per_call": 53817.493506493505,
      "mean_exec_time": 670.132688311688,
      "total_exec_time": 51600.217
    },
    {
      "calls": 1,
      "queryid": -9172451651300148000,
      "wal_bytes": 34307,
      "wal_per_call": 34307,
      "mean_exec_time": 13.104645,
      "total_exec_time": 13.104645
    },
    {
      "calls": 212,
      "queryid": 6430535887002143000,
      "wal_bytes": 9681162,
      "wal_per_call": 45665.85849056604,
      "mean_exec_time": 29.7781965,
      "total_exec_time": 6312.977658
    },
    {
      "calls": 17,
      "queryid": 6862715532547801000,
      "wal_bytes": 448005,
      "wal_per_call": 26353.235294117647,
      "mean_exec_time": 12.2950691176471,
      "total_exec_time": 209.016175
    },
    {
      "calls": 3,
      "queryid": -4910506429341775000,
      "wal_bytes": 21696,
      "wal_per_call": 7232,
      "mean_exec_time": 1.17328166666667,
      "total_exec_time": 3.519845
    }
  ],
  "tables": [
    {
      "relname": "assets",
      "n_tup_upd": 88680,
      "n_dead_tup": 18446,
      "n_live_tup": 150106,
      "n_tup_hot_upd": 48142
    },
    {
      "relname": "dam_search_documents",
      "n_tup_upd": 87729,
      "n_dead_tup": 29585,
      "n_live_tup": 147282,
      "n_tup_hot_upd": 14599
    }
  ],
  "observed_at": "2026-11-04T22:37:14.356072-05:00",
  "stats_reset": "2026-11-04T12:52:59.176055-05:00",
  "thumbnail_drift": 60
}
```

The production function catalog was inspected read-only. `source_updated_at` in search documents is assigned by rebuild/refresh functions; no database function reads it to compare against an asset's `updated_at`. The other similarly named references in `refresh_sku_human_description` and `plm.peanuts_publish_lifecycle` concern different tables. Search freshness therefore follows the last search-relevant change rather than unrelated scan timestamps.

Five drift samples all had matching group membership and active primary assets, differing non-null thumbnail URLs, and equal thumbnail errors. Catalog writers `set_style_group_cover`, `refresh_style_group_primaries`, the thumbnail trigger, and count/reconcile functions derive cached values from the primary asset or clear them for empty groups. App review of supabase/functions and src found no independent cache writer; only derived asset thumbnails are reconciled.

Exact query used (query IDs in the recorded JSON are tool-rendered numbers;
use `queryid::text` on subsequent reads to avoid precision loss):

```sql
select jsonb_build_object('observed_at',now(),
 'stats_reset',(select stats_reset from extensions.pg_stat_statements_info),
 'patch',(select jsonb_agg(to_jsonb(q)) from (
   select queryid,calls,mean_exec_time,total_exec_time,wal_bytes,
     wal_bytes/nullif(calls,0) as wal_per_call
   from extensions.pg_stat_statements
   where query ilike 'with pgrst_source as (update "public"."assets"%')q),
 'tables',(select jsonb_agg(to_jsonb(q)) from (
   select relname,n_dead_tup,n_live_tup,n_tup_upd,n_tup_hot_upd
   from pg_stat_user_tables where schemaname='public'
   and relname in ('assets','dam_search_documents'))q),
 'thumbnail_drift',(select count(*) from public.style_groups sg
   join public.assets a on a.id=sg.primary_asset_id
   where sg.primary_thumbnail_url is distinct from a.thumbnail_url
      or sg.primary_thumbnail_error is distinct from a.thumbnail_error));
```

Acceptance remains pending until post-promotion 24-hour interval measurements establish the required latency/WAL reductions and zero thumbnail drift. Compare interval deltas under one unchanged stats reset, not cumulative means. A reset requires a new baseline and measurement interval. Also verify three recently scanned assets' document metadata against current asset values and the search-document write-rate decrease.
