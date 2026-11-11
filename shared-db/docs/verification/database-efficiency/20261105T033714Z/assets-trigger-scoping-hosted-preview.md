---
summary: Issue 5609 hosted preview proof for assets trigger scoping (PR 5618, migration 20261105033827); production lock timeout failure and remaining acceptance.
kind: proof
status: open
read-when: finishing production acceptance of the assets trigger scoping migration
---

# Issue #5609 hosted preview proof and remaining acceptance

Recorded November 4, 2026, 11:43 PM EST. Source PR #5618 merged at `2326913af8f8089e4647c7f46c080edbd3a96ad0`; immutable migration `20261105033827`. Production application and the required 24-hour production interval are **not proved by this document**.

The production migration's first automatic attempt (run `41966565466`) failed at the first trigger drop with SQLSTATE `55P03` after the deliberate five-second lock timeout. The coordinator's read-only inspection found an active asset writer holding the conflicting row-exclusive lock. No timeout was raised, writer killed, merged SQL edited, or manual production apply attempted. Subsequent source/queue failures are not evidence that this migration applied. Production remains unverified until its owning automatic run and catalog proof establish it.

## What the hosted exercises establish

All three hosted exercises used the current repository preview variable, matched it to the live-vault preview tenant metadata, and proved the protected connection. Each ran only after the coordinator approved the exact script hash, acquired the current preview-rehearsal holder/generation, and passed the database task gate. Preview references and credential values are deliberately absent here. The database password traveled only through protected 1Password environment injection. Every fixture was invented; no licensed strings, actual asset IDs, source documents or real vectors were exported.

The scripts refuse pre-existing fixture prefixes/IDs, use a five-second lock timeout and 120-second statement timeout, and run all trigger substitutions and fixture mutations inside a transaction with savepoint rollback. Final rollback leaves the installed trigger definitions unchanged and zero fixture asset/group rows. Rollback does **not** erase emitted WAL, consumed processing clocks, or physical dead-tuple/index-page effects; these were real preview mutations, not read-only production work.

The original empty/small fixture run's complete group checksum differed. A second, pre-approved diagnostic compared every synthetic group column and established that the **only** differing column was `style_group_changed_at`. That legitimate wall-clock value differs between executions. Search document checksums and all non-clock business fields matched. The clock function was preserved.

The unembedded diagnostic improved runtime by 77.53% and WAL by 46.02%; the latter **fails** the requested 50% hosted WAL target. The production-shaped fixed trials also did not prove a 50% WAL reduction. No favorable pair was selected, and no legitimate base-asset or clock write was suppressed to obtain a benchmark result.

## Actual production shape used to define the later fixture

Read-only aggregate-only production sampling used SYSTEM 0.03% for assets and SYSTEM 1% for groups, fixed seed 5609. Larger reads timed out under the database/explicit read budget; the smaller sample and its limits are retained, not described as the full population. There were 65 sampled active assets and 129 sampled groups. All 65 sampled asset documents had embeddings; both production and hosted preview were independently verified as `vector(768)`. The original local snapshot had `vector(384)` and the first synthetic fixture had NULL embeddings, so it was insufficiently representative of document size.

The final fixture used 1,000 invented assets, 125 invented groups (mean 8, median 7, p90 16 assets per group), and deterministic synthetic 768-dimensional vectors. It assigned 900 assets the rounded-up measured median field lengths and 100 the rounded-up p90 lengths, with deterministic pseudo-word filler. This is a coarse marginal shape, **not** a reconstruction of the real joint distribution. Empty groups were not invented. The group sample contained no empty groups.

The generated profile is disclosed below: asset-row median 816 bytes versus production sample median 1,248; search document row median 5,956 versus 5,524; generated search median 668 bytes versus 800; metadata median 327 versus 358. Unpopulated real fields, missing tags/PDF text, compression, HOT eligibility and index/page history remain limitations. No field lengths were retuned after seeing the resulting trial metrics. Fixed order OLD/NEW/OLD/NEW with one warmup per trial was retained in full. Checkpoint counters were unchanged and no other active writer was seen at the boundary samples; those samples do not rule out brief interleaved/background activity.

## Initial hosted rehearsal

| Trial | Trigger definitions | Runtime ms | Total WAL bytes | Main-node WAL records | Main-node full-page images |
|---|---|---:|---:|---:|---:|
| 1 | old | 3543.244 | 10246480 | 37754 | 289 |
| 2 | new | 1238.478 | 21566360 | 37335 | 6146 |

The complete checksum assertion intentionally refused the mismatch and psql disconnected, rolling back. A separate read-only safety check at 11:21:29 PM EST found zero fixture assets/groups, all five scoped update triggers and five siblings present, and asset-trigger catalog hash `0fbb84947aad93a9683ec3b4c4df495b`. The differing full-page-image counts are observed; checkpoint interference was not measured in this initial run and is not asserted as proved.

<details><summary>Sanitized context and complete EXPLAIN results</summary>

```json
{
  "contexts": [
    {
      "database": "postgres",
      "observed_at": "2026-11-04T23:20:01.5594-05:00",
      "other_active_writers": 0
    },
    {
      "new": {
        "groups": "0499b6097344c105de4ec9f2ae6eff6a",
        "documents": "ef06a44b8f69284c84f03751a793cfbd"
      },
      "old": {
        "groups": "619975ea1d8c1a3b9c932ab2a0c3a370",
        "documents": "ef06a44b8f69284c84f03751a793cfbd"
      },
      "semantic_match": false
    }
  ],
  "plans": [
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 460.837,
        "Actual Total Time": 460.839,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 104550,
        "Shared Read Blocks": 469,
        "Shared Dirtied Blocks": 457,
        "Shared Written Blocks": 29,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 37754,
        "WAL FPI": 289,
        "WAL Bytes": 5580309,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 3.189,
            "Actual Total Time": 24.955,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 4000,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 0,
            "WAL FPI": 0,
            "WAL Bytes": 0,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 3.152,
                "Actual Total Time": 4.406,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 0.115,
                    "Actual Total Time": 2.638,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.01,
                "Actual Total Time": 0.01,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 4000,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 3,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.58,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 42.777,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 199.638,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 16.432,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 5.968,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 21.364,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.224,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_auto_queue_render",
          "Relation": "assets",
          "Time": 9.721,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 19.954,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_dam_search_assets_refresh",
          "Relation": "assets",
          "Time": 1097.088,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 4.26,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 17.923,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_cover_description_to_style_group",
          "Relation": "assets",
          "Time": 103.017,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_designer_to_style_group",
          "Relation": "assets",
          "Time": 1549.408,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_primary_on_thumbnail",
          "Relation": "assets",
          "Time": 50.223,
          "Calls": 1000
        }
      ],
      "Execution Time": 3543.244
    },
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 1040.882,
        "Actual Total Time": 1040.883,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 103546,
        "Shared Read Blocks": 642,
        "Shared Dirtied Blocks": 384,
        "Shared Written Blocks": 26,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 37335,
        "WAL FPI": 6146,
        "WAL Bytes": 21422966,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 3.236,
            "Actual Total Time": 30.46,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 4000,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 0,
            "WAL FPI": 0,
            "WAL Bytes": 0,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 3.199,
                "Actual Total Time": 4.995,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 0.113,
                    "Actual Total Time": 2.68,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.011,
                "Actual Total Time": 0.011,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 4000,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 0,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.466,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 32.613,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 144.735,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 21.717,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 6.724,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 14.144,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.02,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 27.619,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 4.996,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 24.574,
          "Calls": 1000
        }
      ],
      "Execution Time": 1238.478
    }
  ]
}
```

</details>

## Clock diagnosis

| Trial | Trigger definitions | Runtime ms | Total WAL bytes | Main-node WAL records | Main-node full-page images |
|---|---|---:|---:|---:|---:|
| 1 | old | 3548.022 | 9806960 | 37806 | 183 |
| 2 | new | 797.133 | 5294064 | 36774 | 187 |

Only `style_group_changed_at` differed; all business fields and document checksums matched. Final rollback proved all asset trigger definitions unchanged, zero fixture assets/groups and five scoped update triggers. The second run completed successfully.

<details><summary>Sanitized context and complete EXPLAIN results</summary>

```json
{
  "contexts": [
    {
      "database": "postgres",
      "observed_at": "2026-11-04T23:24:44.235015-05:00",
      "other_active_writers": 0
    },
    {
      "phase": "before_batch",
      "checkpointer": {
        "num_timed": 22519,
        "sync_time": 85353,
        "write_time": 171501346,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3460018,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "after_batch",
      "checkpointer": {
        "num_timed": 22519,
        "sync_time": 85353,
        "write_time": 171501346,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3460018,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "before_batch",
      "checkpointer": {
        "num_timed": 22519,
        "sync_time": 85353,
        "write_time": 171501346,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3460018,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "after_batch",
      "checkpointer": {
        "num_timed": 22519,
        "sync_time": 85353,
        "write_time": 171501346,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3460018,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "new": {
        "groups": "c896d529b8889ed1320c638b6a3a24c4",
        "documents": "ef06a44b8f69284c84f03751a793cfbd"
      },
      "old": {
        "groups": "508a625fde7cea78033e910fb8333db9",
        "documents": "ef06a44b8f69284c84f03751a793cfbd"
      },
      "semantic_match": false
    },
    {
      "examples": [
        {
          "new_value": "2026-11-04T23:25:11.492835-05:00",
          "old_value": "2026-11-04T23:24:59.892027-05:00",
          "column_name": "style_group_changed_at"
        },
        {
          "new_value": "2026-11-04T23:25:11.503228-05:00",
          "old_value": "2026-11-04T23:24:59.904565-05:00",
          "column_name": "style_group_changed_at"
        },
        {
          "new_value": "2026-11-04T23:25:11.508392-05:00",
          "old_value": "2026-11-04T23:24:59.90555-05:00",
          "column_name": "style_group_changed_at"
        },
        {
          "new_value": "2026-11-04T23:25:11.490143-05:00",
          "old_value": "2026-11-04T23:24:59.890424-05:00",
          "column_name": "style_group_changed_at"
        },
        {
          "new_value": "2026-11-04T23:25:11.502342-05:00",
          "old_value": "2026-11-04T23:24:59.90374-05:00",
          "column_name": "style_group_changed_at"
        }
      ],
      "clock_columns": [
        "style_group_changed_at"
      ],
      "behavior_columns": null,
      "differing_columns": [
        "style_group_changed_at"
      ],
      "stable_business_fields_match": true
    },
    {
      "fixture_assets": 0,
      "fixture_groups": 0,
      "scoped_updates": 5,
      "all_asset_trigger_definitions_unchanged": true
    }
  ],
  "plans": [
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 417.058,
        "Actual Total Time": 417.06,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 105815,
        "Shared Read Blocks": 351,
        "Shared Dirtied Blocks": 806,
        "Shared Written Blocks": 47,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 37806,
        "WAL FPI": 183,
        "WAL Bytes": 5262855,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 3.333,
            "Actual Total Time": 25.353,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 4000,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 0,
            "WAL FPI": 0,
            "WAL Bytes": 0,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 3.293,
                "Actual Total Time": 4.445,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 0.119,
                    "Actual Total Time": 2.741,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.01,
                "Actual Total Time": 0.01,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 4000,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 2,
        "Shared Read Blocks": 1,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 1.075,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 46.185,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 198.983,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 17.068,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 5.581,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 22.665,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.722,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_auto_queue_render",
          "Relation": "assets",
          "Time": 11.359,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 20.788,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_dam_search_assets_refresh",
          "Relation": "assets",
          "Time": 1124.52,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 4.099,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 19.583,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_cover_description_to_style_group",
          "Relation": "assets",
          "Time": 117.146,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_designer_to_style_group",
          "Relation": "assets",
          "Time": 1547.469,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_primary_on_thumbnail",
          "Relation": "assets",
          "Time": 52.702,
          "Calls": 1000
        }
      ],
      "Execution Time": 3548.022
    },
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 567.908,
        "Actual Total Time": 567.91,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 102479,
        "Shared Read Blocks": 443,
        "Shared Dirtied Blocks": 533,
        "Shared Written Blocks": 64,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 36774,
        "WAL FPI": 187,
        "WAL Bytes": 5218864,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 3.348,
            "Actual Total Time": 33.062,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 4000,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 0,
            "WAL FPI": 0,
            "WAL Bytes": 0,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 3.318,
                "Actual Total Time": 5.029,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 0.119,
                    "Actual Total Time": 2.789,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.012,
                "Actual Total Time": 0.012,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-preview-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 4000,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 0,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.456,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 40.163,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 168.0,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 25.22,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 7.514,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 15.28,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.021,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 27.676,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 4.339,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 26.879,
          "Calls": 1000
        }
      ],
      "Execution Time": 797.133
    }
  ]
}
```

</details>

## Representative fixed trials

| Trial | Trigger definitions | Runtime ms | Total WAL bytes | Main-node WAL records | Main-node full-page images |
|---|---|---:|---:|---:|---:|
| 1 | old | 6395.461 | 22634104 | 42625 | 426 |
| 2 | new | 2179.074 | 28536616 | 211347 | 652 |
| 3 | old | 7346.948 | 40914224 | 210266 | 508 |
| 4 | new | 1366.943 | 13986952 | 45259 | 434 |

Across **all** fixed trials, arithmetic mean runtime fell 74.20% and total WAL fell 33.08%. The 50% hosted WAL target remains **not met**. Physical main-node WAL records varied strongly despite unchanged logical updates. This does not justify selecting one successful-looking pair or changing legitimate writes.

<details><summary>Sanitized context and complete EXPLAIN results</summary>

```json
{
  "contexts": [
    {
      "embedded": 1000,
      "asset_row_p90": 845.600000000007,
      "fixture_assets": 1000,
      "asset_row_median": 816,
      "document_row_p90": 6364.40000000001,
      "search_bytes_p90": 767.000000000005,
      "metadata_bytes_p90": 327,
      "document_row_median": 5956,
      "search_bytes_median": 668,
      "metadata_bytes_median": 327
    },
    {
      "phase": "before_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "after_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "before_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "after_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "before_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "after_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "before_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "phase": "after_batch",
      "checkpointer": {
        "num_timed": 22523,
        "sync_time": 85635,
        "write_time": 172111975,
        "stats_reset": "2026-08-18T15:30:16.183076-04:00",
        "num_requested": 82,
        "buffers_written": 3470833,
        "restartpoints_req": 8,
        "restartpoints_done": 9,
        "restartpoints_timed": 1
      },
      "other_active_writers": 0
    },
    {
      "fixture_assets": 0,
      "fixture_groups": 0,
      "all_asset_trigger_definitions_unchanged": true
    }
  ],
  "plans": [
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 908.562,
        "Actual Total Time": 908.564,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 125889,
        "Shared Read Blocks": 778,
        "Shared Dirtied Blocks": 482,
        "Shared Written Blocks": 54,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 42625,
        "WAL FPI": 426,
        "WAL Bytes": 11400746,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 3.339,
            "Actual Total Time": 30.013,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 4906,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 0,
            "WAL FPI": 0,
            "WAL Bytes": 0,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 3.308,
                "Actual Total Time": 4.871,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 0.114,
                    "Actual Total Time": 2.802,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.012,
                "Actual Total Time": 0.012,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 4906,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 0,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.406,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 57.144,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 197.016,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 20.262,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 6.467,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 21.557,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.016,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_auto_queue_render",
          "Relation": "assets",
          "Time": 10.784,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 25.086,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_dam_search_assets_refresh",
          "Relation": "assets",
          "Time": 3196.609,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 3.525,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 22.752,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_cover_description_to_style_group",
          "Relation": "assets",
          "Time": 144.468,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_designer_to_style_group",
          "Relation": "assets",
          "Time": 1786.973,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_primary_on_thumbnail",
          "Relation": "assets",
          "Time": 63.185,
          "Calls": 1000
        }
      ],
      "Execution Time": 6395.461
    },
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 1989.253,
        "Actual Total Time": 1989.255,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 636154,
        "Shared Read Blocks": 809,
        "Shared Dirtied Blocks": 628,
        "Shared Written Blocks": 185,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 211347,
        "WAL FPI": 652,
        "WAL Bytes": 27700293,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 12.535,
            "Actual Total Time": 46.236,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 4999,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 47,
            "WAL FPI": 0,
            "WAL Bytes": 2646,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 12.448,
                "Actual Total Time": 14.0,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 1.973,
                    "Actual Total Time": 11.782,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.014,
                "Actual Total Time": 0.014,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 4999,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 47,
                "WAL FPI": 0,
                "WAL Bytes": 2646
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 0,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.719,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 35.017,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 136.018,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 23.336,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 7.006,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 13.84,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.019,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 26.837,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 3.898,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 25.638,
          "Calls": 1000
        }
      ],
      "Execution Time": 2179.074
    },
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 1935.613,
        "Actual Total Time": 1935.616,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 635452,
        "Shared Read Blocks": 693,
        "Shared Dirtied Blocks": 588,
        "Shared Written Blocks": 163,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 210266,
        "WAL FPI": 508,
        "WAL Bytes": 28977945,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 3.265,
            "Actual Total Time": 30.509,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 5000,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 0,
            "WAL FPI": 0,
            "WAL Bytes": 0,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 3.229,
                "Actual Total Time": 4.776,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 0.117,
                    "Actual Total Time": 2.732,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.013,
                "Actual Total Time": 0.013,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 5000,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 0,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.545,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 53.632,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 190.53,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 20.395,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 6.639,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 21.785,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.016,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_auto_queue_render",
          "Relation": "assets",
          "Time": 9.718,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 25.689,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_dam_search_assets_refresh",
          "Relation": "assets",
          "Time": 3122.131,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 4.047,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 22.62,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_cover_description_to_style_group",
          "Relation": "assets",
          "Time": 146.79,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_designer_to_style_group",
          "Relation": "assets",
          "Time": 1800.679,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_sync_primary_on_thumbnail",
          "Relation": "assets",
          "Time": 56.62,
          "Calls": 1000
        }
      ],
      "Execution Time": 7346.948
    },
    {
      "Plan": {
        "Node Type": "ModifyTable",
        "Operation": "Update",
        "Parallel Aware": false,
        "Async Capable": false,
        "Relation Name": "assets",
        "Alias": "assets",
        "Startup Cost": 12.94,
        "Total Cost": 540.85,
        "Plan Rows": 0,
        "Plan Width": 0,
        "Actual Startup Time": 1178.315,
        "Actual Total Time": 1178.316,
        "Actual Rows": 0,
        "Actual Loops": 1,
        "Shared Hit Blocks": 140150,
        "Shared Read Blocks": 689,
        "Shared Dirtied Blocks": 562,
        "Shared Written Blocks": 159,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "WAL Records": 45259,
        "WAL FPI": 434,
        "WAL Bytes": 13864427,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 12.94,
            "Total Cost": 540.85,
            "Plan Rows": 1000,
            "Plan Width": 954,
            "Actual Startup Time": 6.514,
            "Actual Total Time": 38.698,
            "Actual Rows": 1000,
            "Actual Loops": 1,
            "Inner Unique": true,
            "Shared Hit Blocks": 5000,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "WAL Records": 25,
            "WAL FPI": 0,
            "WAL Bytes": 1432,
            "Plans": [
              {
                "Node Type": "Aggregate",
                "Strategy": "Hashed",
                "Partial Mode": "Simple",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 12.5,
                "Total Cost": 14.5,
                "Plan Rows": 200,
                "Plan Width": 32,
                "Actual Startup Time": 6.471,
                "Actual Total Time": 8.522,
                "Actual Rows": 1000,
                "Actual Loops": 1,
                "Group Key": [
                  "(md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid"
                ],
                "Planned Partitions": 0,
                "HashAgg Batches": 1,
                "Peak Memory Usage": 209,
                "Disk Usage": 0,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 0,
                "WAL FPI": 0,
                "WAL Bytes": 0,
                "Plans": [
                  {
                    "Node Type": "Function Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Function Name": "generate_series",
                    "Alias": "i",
                    "Startup Cost": 0.0,
                    "Total Cost": 10.0,
                    "Plan Rows": 1000,
                    "Plan Width": 32,
                    "Actual Startup Time": 1.112,
                    "Actual Total Time": 5.893,
                    "Actual Rows": 1000,
                    "Actual Loops": 1,
                    "Shared Hit Blocks": 0,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "WAL Records": 0,
                    "WAL FPI": 0,
                    "WAL Bytes": 0
                  }
                ]
              },
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "assets_pkey",
                "Relation Name": "assets",
                "Alias": "assets",
                "Startup Cost": 0.43,
                "Total Cost": 2.63,
                "Plan Rows": 1,
                "Plan Width": 934,
                "Actual Startup Time": 0.014,
                "Actual Total Time": 0.014,
                "Actual Rows": 1,
                "Actual Loops": 1000,
                "Index Cond": "(id = (md5(('zz5609-rep-asset-'::text || (i.i)::text)))::uuid)",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 5000,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "WAL Records": 25,
                "WAL FPI": 0,
                "WAL Bytes": 1432
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 0,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.415,
      "Triggers": [
        {
          "Trigger Name": "RI_ConstraintTrigger_c_87798",
          "Constraint Name": "assets_style_group_id_fkey",
          "Relation": "assets",
          "Time": 34.319,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_effective_tags_sync",
          "Relation": "assets",
          "Time": 135.835,
          "Calls": 1000
        },
        {
          "Trigger Name": "assets_style_group_change_clock",
          "Relation": "assets",
          "Time": 26.24,
          "Calls": 1000
        },
        {
          "Trigger Name": "set_assets_updated_at",
          "Relation": "assets",
          "Time": 7.57,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_enqueue_image_embed",
          "Relation": "assets",
          "Time": 13.661,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_assets_rollup_pdf_rich_extraction_groups",
          "Relation": "assets",
          "Time": 0.02,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_compute_primary_sort_tier",
          "Relation": "assets",
          "Time": 29.456,
          "Calls": 1000
        },
        {
          "Trigger Name": "trg_refresh_sg_counts_on_update",
          "Relation": "assets",
          "Time": 3.777,
          "Calls": 1
        },
        {
          "Trigger Name": "trg_set_path_attrs",
          "Relation": "assets",
          "Time": 28.127,
          "Calls": 1000
        }
      ],
      "Execution Time": 1366.943
    }
  ]
}
```

</details>

## Aggregate production sample and exact read-only query

```json
{
  "assets": {
    "ai_bytes": {
      "n": 65,
      "p90": 189.6,
      "mean": 104.49230769230769,
      "median": 120
    },
    "row_bytes": {
      "n": 65,
      "p90": 1692.8,
      "mean": 1290.2153846153847,
      "median": 1248
    },
    "path_bytes": {
      "n": 65,
      "p90": 199.8,
      "mean": 169.66153846153847,
      "median": 167
    },
    "cover_bytes": {
      "n": 65,
      "p90": 87.6,
      "mean": 49.723076923076924,
      "median": 54
    },
    "scene_bytes": {
      "n": 65,
      "p90": 322,
      "mean": 160.5076923076923,
      "median": 167
    },
    "search_bytes": {
      "n": 65,
      "p90": 2832.6,
      "mean": 1071.5230769230768,
      "median": 800
    },
    "filename_bytes": {
      "n": 65,
      "p90": 37.2,
      "mean": 27.123076923076923,
      "median": 24
    },
    "material_bytes": {
      "n": 65,
      "p90": 0,
      "mean": 0,
      "median": 0
    },
    "metadata_bytes": {
      "n": 65,
      "p90": 433.8,
      "mean": 334.32307692307694,
      "median": 358
    },
    "dimensions_bytes": {
      "n": 65,
      "p90": 0,
      "mean": 0,
      "median": 0
    },
    "document_row_bytes": {
      "n": 65,
      "p90": 9485.6,
      "mean": 6125.292307692308,
      "median": 5524
    }
  },
  "groups": {
    "asset_count": {
      "n": 129,
      "p90": 16,
      "mean": 7.9689922480620154,
      "median": 7
    },
    "group_ai_bytes": {
      "n": 129,
      "p90": 0,
      "mean": 0,
      "median": 0
    },
    "group_row_bytes": {
      "n": 129,
      "p90": 896,
      "mean": 769.4883720930233,
      "median": 768
    },
    "rich_metadata_bytes": {
      "n": 2,
      "p90": 1186.7,
      "mean": 1049.5,
      "median": 1049.5
    }
  },
  "sampling": "assets SYSTEM 0.03%, groups SYSTEM 1%, REPEATABLE 5609; aggregate lengths only",
  "observed_at": "2026-11-04T23:31:35.317314-05:00"
}
```

```sql
begin read only;
set local statement_timeout='20s';
with a as materialized (
 select pg_column_size(a)::numeric as row_bytes,
 octet_length(coalesce(a.filename,''))::numeric as filename_bytes,
 octet_length(coalesce(a.relative_path,''))::numeric as path_bytes,
 octet_length(coalesce(a.cover_description,''))::numeric as cover_bytes,
 octet_length(coalesce(a.ai_description,''))::numeric as ai_bytes,
 octet_length(coalesce(a.scene_description,''))::numeric as scene_bytes,
 octet_length(coalesce(array_to_string(a.product_material,' '),''))::numeric as material_bytes,
 octet_length(coalesce(a.product_dimensions,''))::numeric as dimensions_bytes,
 octet_length(coalesce(d.search_text,''))::numeric as search_bytes,
 pg_column_size(d.metadata)::numeric as metadata_bytes,
 d.document_row_bytes
 from public.assets a tablesample system(0.03) repeatable(5609)
 left join lateral(select d.metadata,d.search_text,pg_column_size(d)::numeric as document_row_bytes from public.dam_search_documents d where d.document_type='asset' and d.entity_id=a.id limit 1)d on true
 where not a.is_deleted),
g as materialized (
 select asset_count::numeric as asset_count,pg_column_size(sg)::numeric as group_row_bytes,
 pg_column_size(sg.rich_metadata)::numeric as rich_metadata_bytes,
 octet_length(coalesce(sg.group_ai_description,''))::numeric as group_ai_bytes
 from public.style_groups sg tablesample system(1) repeatable(5609)),
am as (select k,v from a cross join lateral(values
 ('row_bytes',row_bytes),('filename_bytes',filename_bytes),('path_bytes',path_bytes),
 ('cover_bytes',cover_bytes),('ai_bytes',ai_bytes),('scene_bytes',scene_bytes),
 ('material_bytes',material_bytes),('dimensions_bytes',dimensions_bytes),
 ('search_bytes',search_bytes),('metadata_bytes',metadata_bytes),
 ('document_row_bytes',document_row_bytes))m(k,v)),
gm as(select k,v from g cross join lateral(values('asset_count',asset_count),
 ('group_row_bytes',group_row_bytes),('rich_metadata_bytes',rich_metadata_bytes),
 ('group_ai_bytes',group_ai_bytes))m(k,v))
select jsonb_build_object('observed_at',now(),
 'sampling','assets SYSTEM 0.03%, groups SYSTEM 1%, REPEATABLE 5609; aggregate lengths only',
 'assets',(select jsonb_object_agg(k,stats) from(select k,jsonb_build_object(
   'n',count(v),'median',percentile_cont(0.5)within group(order by v),
   'p90',percentile_cont(0.9)within group(order by v),'mean',avg(v))as stats from am group by k)s),
 'groups',(select jsonb_object_agg(k,stats) from(select k,jsonb_build_object(
   'n',count(v),'median',percentile_cont(0.5)within group(order by v),
   'p90',percentile_cont(0.9)within group(order by v),'mean',avg(v))as stats from gm group by k)s)) as aggregate_distribution;
rollback;
```

Embedding prevalence was checked with a lateral, indexed lookup of `embedding is not null` over the same fixed asset sample; only counts were returned. No actual vector values were read into the transcript. `pg_attribute`/`format_type` proved the 768 dimensions independently on production and preview.

## Exact approved script: 5609-preview-rehearsal.sql

SHA-256: `f6c9b6b22b139b962e51e9c41192377a0f0260c422027d86144a404f5dd53b62`. The coordinator lease and target proof are external prerequisites; this evidence is not authority to run the script.

<details><summary>Reviewed rollback-only SQL</summary>

```sql
-- #5609 shared PREVIEW rehearsal, reviewed scratch script, not production.
-- psql -X -v ON_ERROR_STOP=1 required. Verify target immediately before execution.
-- Entire script is rollback-only. No production role or promotion authority here.
-- Global WAL includes any unrelated preview activity; record/qualify interference.
-- Rollback on disconnect is PostgreSQL's fail-safe if a timeout/error interrupts.
begin;
set local statement_timeout='120s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='5min';
select jsonb_build_object('observed_at',now(),'database',current_database(),
 'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid()
   and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) as rehearsal_context;
do $guard$
begin
 if exists(select 1 from public.assets where quick_hash like 'zz5609-preview-%'
     or relative_path like 'ZZ5609-PREVIEW/%'
     or id in(select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i))
   or exists(select 1 from public.style_groups where sku like 'ZZ5609-PREVIEW-%'
     or folder_path like 'ZZ5609-PREVIEW/%'
     or id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i)) then
  raise exception '5609 preview fixture collision: refusing; no pre-existing row may be modified';
 end if;
 if (select count(*) from pg_trigger where tgrelid='public.assets'::regclass and tgtype=17
    and tgqual is not null and tgname in('trg_dam_search_assets_refresh','trg_sync_primary_on_thumbnail',
      'trg_sync_designer_to_style_group','trg_sync_cover_description_to_style_group','trg_auto_queue_render')) <>5 then
  raise exception '5609 scoped migration not installed: refusing preview rehearsal';
 end if;
end $guard$;
select md5(string_agg(pg_get_triggerdef(oid),E'\n' order by tgname)) as trigger_hash
 from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal \gset installed_
savepoint original_installed_state;
-- OLD trigger definitions (restore only inside savepoint)
drop trigger if exists trg_dam_search_assets_refresh on public.assets;
drop trigger if exists trg_dam_search_assets_refresh_ins_del on public.assets;
CREATE TRIGGER trg_dam_search_assets_refresh AFTER INSERT OR DELETE OR UPDATE OF filename, relative_path, cover_description, ai_description, scene_description, customer, program, licensor_name, property_name, product_category, thumbnail_url, file_type, asset_type, workflow_status, is_licensed, style_group_id, is_deleted, updated_at, modified_at ON public.assets FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_dam_asset_search_document();
drop trigger if exists trg_sync_primary_on_thumbnail on public.assets;
drop trigger if exists trg_sync_primary_on_thumbnail_ins_del on public.assets;
CREATE TRIGGER trg_sync_primary_on_thumbnail AFTER INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_primary_asset_on_thumbnail();
drop trigger if exists trg_sync_designer_to_style_group on public.assets;
drop trigger if exists trg_sync_designer_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_designer_to_style_group AFTER INSERT OR UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_designer_to_style_group();
drop trigger if exists trg_sync_cover_description_to_style_group on public.assets;
drop trigger if exists trg_sync_cover_description_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_cover_description_to_style_group AFTER INSERT OR UPDATE OF cover_description, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_cover_description_to_style_group();
drop trigger if exists trg_auto_queue_render on public.assets;
drop trigger if exists trg_auto_queue_render_ins_del on public.assets;
CREATE TRIGGER trg_auto_queue_render AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url ON public.assets FOR EACH ROW EXECUTE FUNCTION public.auto_queue_render();

insert into public.style_groups(id,sku,folder_path)
select md5('zz5609-preview-group-'||i)::uuid,'ZZ5609-PREVIEW-'||i,'ZZ5609-PREVIEW/'||i from generate_series(1,100) i;
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,
  style_group_id,thumbnail_url,asset_type,designer_name,cover_description)
select md5('zz5609-preview-asset-'||i)::uuid,'zz5609-preview-'||i||'.ai','ZZ5609-PREVIEW/'||((i-1)/10+1)||'/'||i||'.ai',
  'ai','zz5609-preview-'||i,'2026-11-01'::timestamptz,md5('zz5609-preview-group-'||((i-1)/10+1))::uuid,
  'https://fixture.invalid/'||i||'.jpg','art_piece','fixture designer','fixture cover'
from generate_series(1,1000) i;

select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i);
select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');

-- Mixed workload: rename, thumbnail, regroup, delete/revive, designer, cover,
-- no-op and metadata edits. Search newly added dependency columns are tested
-- separately in the contract suite because old behavior omitted those refreshes.
update public.assets set filename='renamed.ai' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set thumbnail_url='https://fixture.invalid/new.jpg' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set style_group_id=md5('zz5609-preview-group-2')::uuid where id=md5('zz5609-preview-asset-2')::uuid;
update public.assets set is_deleted=true where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set is_deleted=false where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set designer_name='changed designer' where id=md5('zz5609-preview-asset-4')::uuid;
update public.assets set cover_description='changed cover' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set filename=filename,last_seen_at=clock_timestamp() where id=md5('zz5609-preview-asset-5')::uuid;
select jsonb_build_object(
  'documents', (select md5(string_agg(jsonb_build_array(document_type,entity_id,style_group_id,title,path,
    customer,program,search_text,content_sha256,metadata,embedding is null)::text,'' order by document_type,entity_id))
    from public.dam_search_documents where entity_id in(select id from public.assets where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i))
      or entity_id in(select id from public.style_groups where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))),
  'groups', (select md5(string_agg((to_jsonb(sg)-'created_at'-'updated_at')::text,'' order by id))
    from public.style_groups sg where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))) as semantic_checksum \gset old_

rollback to savepoint original_installed_state;
-- NEW installed state restored by rollback, same synthetic workload
insert into public.style_groups(id,sku,folder_path)
select md5('zz5609-preview-group-'||i)::uuid,'ZZ5609-PREVIEW-'||i,'ZZ5609-PREVIEW/'||i from generate_series(1,100) i;
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,
  style_group_id,thumbnail_url,asset_type,designer_name,cover_description)
select md5('zz5609-preview-asset-'||i)::uuid,'zz5609-preview-'||i||'.ai','ZZ5609-PREVIEW/'||((i-1)/10+1)||'/'||i||'.ai',
  'ai','zz5609-preview-'||i,'2026-11-01'::timestamptz,md5('zz5609-preview-group-'||((i-1)/10+1))::uuid,
  'https://fixture.invalid/'||i||'.jpg','art_piece','fixture designer','fixture cover'
from generate_series(1,1000) i;

select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i);
select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');

-- Mixed workload: rename, thumbnail, regroup, delete/revive, designer, cover,
-- no-op and metadata edits. Search newly added dependency columns are tested
-- separately in the contract suite because old behavior omitted those refreshes.
update public.assets set filename='renamed.ai' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set thumbnail_url='https://fixture.invalid/new.jpg' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set style_group_id=md5('zz5609-preview-group-2')::uuid where id=md5('zz5609-preview-asset-2')::uuid;
update public.assets set is_deleted=true where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set is_deleted=false where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set designer_name='changed designer' where id=md5('zz5609-preview-asset-4')::uuid;
update public.assets set cover_description='changed cover' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set filename=filename,last_seen_at=clock_timestamp() where id=md5('zz5609-preview-asset-5')::uuid;
select jsonb_build_object(
  'documents', (select md5(string_agg(jsonb_build_array(document_type,entity_id,style_group_id,title,path,
    customer,program,search_text,content_sha256,metadata,embedding is null)::text,'' order by document_type,entity_id))
    from public.dam_search_documents where entity_id in(select id from public.assets where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i))
      or entity_id in(select id from public.style_groups where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))),
  'groups', (select md5(string_agg((to_jsonb(sg)-'created_at'-'updated_at')::text,'' order by id))
    from public.style_groups sg where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))) as semantic_checksum \gset new_

select jsonb_build_object('old', :'old_semantic_checksum'::jsonb,
 'new', :'new_semantic_checksum'::jsonb,
 'semantic_match', :'old_semantic_checksum'::jsonb=:'new_semantic_checksum'::jsonb) as equivalence;
select 1/case when :'old_semantic_checksum'::jsonb=:'new_semantic_checksum'::jsonb then 1 else 0 end as equivalence_assertion;
rollback;

-- Read-only post-rollback safety proof: installed scopes and zero fixture residue.
select jsonb_build_object('all_asset_trigger_definitions_unchanged',(select md5(string_agg(pg_get_triggerdef(oid),E'\n' order by tgname))=:'installed_trigger_hash' from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal),'scoped_updates',(select count(*) from pg_trigger
 where tgrelid='public.assets'::regclass and tgtype=17 and tgqual is not null
 and tgname in('trg_dam_search_assets_refresh','trg_sync_primary_on_thumbnail',
 'trg_sync_designer_to_style_group','trg_sync_cover_description_to_style_group','trg_auto_queue_render')),
 'fixture_assets',(select count(*) from public.assets where quick_hash like 'zz5609-preview-%'),
 'fixture_groups',(select count(*) from public.style_groups where sku like 'ZZ5609-PREVIEW-%'))
 as rollback_safety;
```

</details>

## Exact approved script: 5609-preview-diagnostic.sql

SHA-256: `4dbd9656b834b05d9f5c850069dcc7916c3f062e5273c8a3f21eff07679cfa22`. The coordinator lease and target proof are external prerequisites; this evidence is not authority to run the script.

<details><summary>Reviewed rollback-only SQL</summary>

```sql
-- #5609 shared PREVIEW rehearsal, reviewed scratch script, not production.
-- psql -X -v ON_ERROR_STOP=1 required. Verify target immediately before execution.
-- Entire script is rollback-only. No production role or promotion authority here.
-- Global WAL includes any unrelated preview activity; record/qualify interference.
-- Rollback on disconnect is PostgreSQL's fail-safe if a timeout/error interrupts.
begin;
set local statement_timeout='120s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='5min';
select jsonb_build_object('observed_at',now(),'database',current_database(),
 'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid()
   and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) as rehearsal_context;
do $guard$
begin
 if exists(select 1 from public.assets where quick_hash like 'zz5609-preview-%'
     or relative_path like 'ZZ5609-PREVIEW/%'
     or id in(select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i))
   or exists(select 1 from public.style_groups where sku like 'ZZ5609-PREVIEW-%'
     or folder_path like 'ZZ5609-PREVIEW/%'
     or id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i)) then
  raise exception '5609 preview fixture collision: refusing; no pre-existing row may be modified';
 end if;
 if (select count(*) from pg_trigger where tgrelid='public.assets'::regclass and tgtype=17
    and tgqual is not null and tgname in('trg_dam_search_assets_refresh','trg_sync_primary_on_thumbnail',
      'trg_sync_designer_to_style_group','trg_sync_cover_description_to_style_group','trg_auto_queue_render')) <>5 then
  raise exception '5609 scoped migration not installed: refusing preview rehearsal';
 end if;
end $guard$;
select md5(string_agg(pg_get_triggerdef(oid),E'\n' order by tgname)) as trigger_hash
 from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal \gset installed_
savepoint original_installed_state;
-- OLD trigger definitions (restore only inside savepoint)
drop trigger if exists trg_dam_search_assets_refresh on public.assets;
drop trigger if exists trg_dam_search_assets_refresh_ins_del on public.assets;
CREATE TRIGGER trg_dam_search_assets_refresh AFTER INSERT OR DELETE OR UPDATE OF filename, relative_path, cover_description, ai_description, scene_description, customer, program, licensor_name, property_name, product_category, thumbnail_url, file_type, asset_type, workflow_status, is_licensed, style_group_id, is_deleted, updated_at, modified_at ON public.assets FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_dam_asset_search_document();
drop trigger if exists trg_sync_primary_on_thumbnail on public.assets;
drop trigger if exists trg_sync_primary_on_thumbnail_ins_del on public.assets;
CREATE TRIGGER trg_sync_primary_on_thumbnail AFTER INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_primary_asset_on_thumbnail();
drop trigger if exists trg_sync_designer_to_style_group on public.assets;
drop trigger if exists trg_sync_designer_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_designer_to_style_group AFTER INSERT OR UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_designer_to_style_group();
drop trigger if exists trg_sync_cover_description_to_style_group on public.assets;
drop trigger if exists trg_sync_cover_description_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_cover_description_to_style_group AFTER INSERT OR UPDATE OF cover_description, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_cover_description_to_style_group();
drop trigger if exists trg_auto_queue_render on public.assets;
drop trigger if exists trg_auto_queue_render_ins_del on public.assets;
CREATE TRIGGER trg_auto_queue_render AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url ON public.assets FOR EACH ROW EXECUTE FUNCTION public.auto_queue_render();

insert into public.style_groups(id,sku,folder_path)
select md5('zz5609-preview-group-'||i)::uuid,'ZZ5609-PREVIEW-'||i,'ZZ5609-PREVIEW/'||i from generate_series(1,100) i;
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,
  style_group_id,thumbnail_url,asset_type,designer_name,cover_description)
select md5('zz5609-preview-asset-'||i)::uuid,'zz5609-preview-'||i||'.ai','ZZ5609-PREVIEW/'||((i-1)/10+1)||'/'||i||'.ai',
  'ai','zz5609-preview-'||i,'2026-11-01'::timestamptz,md5('zz5609-preview-group-'||((i-1)/10+1))::uuid,
  'https://fixture.invalid/'||i||'.jpg','art_piece','fixture designer','fixture cover'
from generate_series(1,1000) i;

select jsonb_build_object('phase','before_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i);
select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');
select jsonb_build_object('phase','after_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;

-- Mixed workload: rename, thumbnail, regroup, delete/revive, designer, cover,
-- no-op and metadata edits. Search newly added dependency columns are tested
-- separately in the contract suite because old behavior omitted those refreshes.
update public.assets set filename='renamed.ai' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set thumbnail_url='https://fixture.invalid/new.jpg' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set style_group_id=md5('zz5609-preview-group-2')::uuid where id=md5('zz5609-preview-asset-2')::uuid;
update public.assets set is_deleted=true where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set is_deleted=false where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set designer_name='changed designer' where id=md5('zz5609-preview-asset-4')::uuid;
update public.assets set cover_description='changed cover' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set filename=filename,last_seen_at=clock_timestamp() where id=md5('zz5609-preview-asset-5')::uuid;
select jsonb_build_object(
  'documents', (select md5(string_agg(jsonb_build_array(document_type,entity_id,style_group_id,title,path,
    customer,program,search_text,content_sha256,metadata,embedding is null)::text,'' order by document_type,entity_id))
    from public.dam_search_documents where entity_id in(select id from public.assets where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i))
      or entity_id in(select id from public.style_groups where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))),
  'groups', (select md5(string_agg((to_jsonb(sg)-'created_at'-'updated_at')::text,'' order by id))
    from public.style_groups sg where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))) as semantic_checksum \gset old_
select jsonb_object_agg(id::text,to_jsonb(sg)) as group_rows from public.style_groups sg where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i) \gset old_

rollback to savepoint original_installed_state;
-- NEW installed state restored by rollback, same synthetic workload
insert into public.style_groups(id,sku,folder_path)
select md5('zz5609-preview-group-'||i)::uuid,'ZZ5609-PREVIEW-'||i,'ZZ5609-PREVIEW/'||i from generate_series(1,100) i;
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,
  style_group_id,thumbnail_url,asset_type,designer_name,cover_description)
select md5('zz5609-preview-asset-'||i)::uuid,'zz5609-preview-'||i||'.ai','ZZ5609-PREVIEW/'||((i-1)/10+1)||'/'||i||'.ai',
  'ai','zz5609-preview-'||i,'2026-11-01'::timestamptz,md5('zz5609-preview-group-'||((i-1)/10+1))::uuid,
  'https://fixture.invalid/'||i||'.jpg','art_piece','fixture designer','fixture cover'
from generate_series(1,1000) i;

select jsonb_build_object('phase','before_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i);
select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');
select jsonb_build_object('phase','after_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;

-- Mixed workload: rename, thumbnail, regroup, delete/revive, designer, cover,
-- no-op and metadata edits. Search newly added dependency columns are tested
-- separately in the contract suite because old behavior omitted those refreshes.
update public.assets set filename='renamed.ai' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set thumbnail_url='https://fixture.invalid/new.jpg' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set style_group_id=md5('zz5609-preview-group-2')::uuid where id=md5('zz5609-preview-asset-2')::uuid;
update public.assets set is_deleted=true where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set is_deleted=false where id=md5('zz5609-preview-asset-3')::uuid;
update public.assets set designer_name='changed designer' where id=md5('zz5609-preview-asset-4')::uuid;
update public.assets set cover_description='changed cover' where id=md5('zz5609-preview-asset-1')::uuid;
update public.assets set filename=filename,last_seen_at=clock_timestamp() where id=md5('zz5609-preview-asset-5')::uuid;
select jsonb_build_object(
  'documents', (select md5(string_agg(jsonb_build_array(document_type,entity_id,style_group_id,title,path,
    customer,program,search_text,content_sha256,metadata,embedding is null)::text,'' order by document_type,entity_id))
    from public.dam_search_documents where entity_id in(select id from public.assets where id in (select md5('zz5609-preview-asset-'||i)::uuid from generate_series(1,1000)i))
      or entity_id in(select id from public.style_groups where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))),
  'groups', (select md5(string_agg((to_jsonb(sg)-'created_at'-'updated_at')::text,'' order by id))
    from public.style_groups sg where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i))) as semantic_checksum \gset new_
select jsonb_object_agg(id::text,to_jsonb(sg)) as group_rows from public.style_groups sg where id in(select md5('zz5609-preview-group-'||i)::uuid from generate_series(1,100)i) \gset new_

select jsonb_build_object('old', :'old_semantic_checksum'::jsonb,
 'new', :'new_semantic_checksum'::jsonb,
 'semantic_match', :'old_semantic_checksum'::jsonb=:'new_semantic_checksum'::jsonb) as equivalence;
with rows as (select o.key as synthetic_group,o.value as old_row,n.value as new_row
 from jsonb_each(:'old_group_rows'::jsonb)o join jsonb_each(:'new_group_rows'::jsonb)n on n.key=o.key),
 differences as (select synthetic_group,k.key as column_name,old_row->k.key as old_value,new_row->k.key as new_value
 from rows cross join lateral jsonb_object_keys(old_row)k(key) where old_row->k.key is distinct from new_row->k.key)
select jsonb_build_object('differing_columns',(select jsonb_agg(distinct column_name) from differences),
 'clock_columns',(select jsonb_agg(distinct column_name) from differences where column_name in('created_at','updated_at','style_group_changed_at')),
 'behavior_columns',(select jsonb_agg(distinct column_name) from differences where column_name not in('created_at','updated_at','style_group_changed_at')),
 'examples',(select jsonb_agg(to_jsonb(x)) from (select column_name,old_value,new_value from differences order by column_name,synthetic_group limit 5)x),
 'stable_business_fields_match',not exists(select 1 from differences where column_name not in('created_at','updated_at','style_group_changed_at')))
 as synthetic_group_differences;
select 1/case when not exists(select 1 from jsonb_each(:'old_group_rows'::jsonb)o join jsonb_each(:'new_group_rows'::jsonb)n on n.key=o.key
 where (o.value-'created_at'-'updated_at'-'style_group_changed_at') is distinct from (n.value-'created_at'-'updated_at'-'style_group_changed_at'))
 and (:'old_semantic_checksum'::jsonb->'documents')=(:'new_semantic_checksum'::jsonb->'documents') then 1 else 0 end as stable_equivalence_assertion;
rollback;

-- Read-only post-rollback safety proof: installed scopes and zero fixture residue.
select jsonb_build_object('all_asset_trigger_definitions_unchanged',(select md5(string_agg(pg_get_triggerdef(oid),E'\n' order by tgname))=:'installed_trigger_hash' from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal),'scoped_updates',(select count(*) from pg_trigger
 where tgrelid='public.assets'::regclass and tgtype=17 and tgqual is not null
 and tgname in('trg_dam_search_assets_refresh','trg_sync_primary_on_thumbnail',
 'trg_sync_designer_to_style_group','trg_sync_cover_description_to_style_group','trg_auto_queue_render')),
 'fixture_assets',(select count(*) from public.assets where quick_hash like 'zz5609-preview-%'),
 'fixture_groups',(select count(*) from public.style_groups where sku like 'ZZ5609-PREVIEW-%'))
 as rollback_safety;
```

</details>

## Exact approved script: 5609-preview-representative.sql

SHA-256: `4844b7a45e7f0a92943aca9b825741c88247f431781224de4f61bd654da88e2e`. The coordinator lease and target proof are external prerequisites; this evidence is not authority to run the script.

<details><summary>Reviewed rollback-only SQL</summary>

```sql
-- #5609 production-shaped synthetic preview benchmark. NEVER production.
-- Predeclared profile: aggregate-only production sample65 assets/129 groups.
-- Median / p90 lengths rounded up; 900 median rows and100 p90 rows.
-- Both sampled production and verified hosted preview use vector(768).
-- All65 sampled production asset docs are embedded; seed synthetic vectors only.
-- Four FIXED alternating trials OLD,NEW,OLD,NEW, one fixed warmup per trial.
-- Retain ALL results; no counter resets, checkpoint changes, or favorable filtering.
-- WAL uses whole-server insertion LSN and records concurrent-writer/checkpoint context.
-- Transaction abort/disconnect rolls back every fixture and trigger definition.
begin;
set local statement_timeout='120s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='5min';
do $guard$
begin
 if exists(select 1 from public.assets where quick_hash like 'zz5609-rep-%'
    or relative_path like 'ZZ5609-REP/%'
    or id in(select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i))
  or exists(select 1 from public.style_groups where sku like 'ZZ5609-REP-%'
    or folder_path like 'ZZ5609-REP/%'
    or id in(select md5('zz5609-rep-group-'||i)::uuid from generate_series(1,125)i)) then
  raise exception '5609 representative fixture collision: refusing';
 end if;
 if (select atttypmod from pg_attribute where attrelid='public.dam_search_documents'::regclass and attname='embedding')<>768 then
  raise exception '5609 representative benchmark requires existing vector768; no schema alteration authorized';
 end if;
 if (select count(*) from pg_trigger where tgrelid='public.assets'::regclass and tgtype=17 and tgqual is not null
  and tgname in('trg_dam_search_assets_refresh','trg_sync_primary_on_thumbnail','trg_sync_designer_to_style_group','trg_sync_cover_description_to_style_group','trg_auto_queue_render'))<>5 then
  raise exception '5609 scoped migration is not installed';
 end if;
end $guard$;
select md5(string_agg(pg_get_triggerdef(oid),E'\n' order by tgname)) as trigger_hash
 from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal \gset installed_
insert into public.style_groups(id,sku,folder_path,item_description)
select md5('zz5609-rep-group-'||i)::uuid,'ZZ5609-REP-'||i,'ZZ5609-REP/'||i,
 left((select string_agg(substr(md5('group-'||i||'-'||j),1,7),' ' order by j) from generate_series(1,30)j),case when i%10=0 then 196 else 120 end)
from generate_series(1,125)i;
-- Counts:100 groups of7,13 of16,11 of8,and1 of4 =>1000assets,mean8,median7,p9016.
with numbered as(select i,case when i<=700 then(i-1)/7+1 when i<=908 then 100+(i-701)/16+1
 when i<=996 then 113+(i-909)/8+1 else 125 end as g, i%10=0 as p90 from generate_series(1,1000)i),
payloads as(select *, (select string_agg(substr(md5('row-'||i||'-'||j),1,7),' ' order by j) from generate_series(1,160)j) as payload from numbered)
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,style_group_id,
 thumbnail_url,asset_type,designer_name,cover_description,ai_description,scene_description,content_type)
select md5('zz5609-rep-asset-'||i)::uuid,'z'||substr(payload,1,case when p90 then 34 else 20 end)||'.ai',
 'ZZ5609-REP/'||g||'/'||substr(payload,40,(case when p90 then 200 else 167 end)-length('ZZ5609-REP/'||g||'/')),
 'ai','zz5609-rep-'||i,'2026-11-01'::timestamptz,md5('zz5609-rep-group-'||g)::uuid,
 'https://fixture.invalid/'||i||'.jpg','art_piece','fixture designer',
 substr(payload,300,case when p90 then 88 else 54 end),
 substr(payload,400,case when p90 then 190 else 120 end),
 substr(payload,700,case when p90 then 322 else 167 end),'source_art'
from payloads;
update public.dam_search_documents d
set embedding=(select array_agg((get_byte(decode(md5(d.entity_id::text||':'||j),'hex'),0)::real/255)-0.5 order by j)::extensions.vector
 from generate_series(1,768)j),embedding_model='fixture-only/768',embedding_updated_at=now()
where document_type='asset' and entity_id in(select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);
select jsonb_build_object('fixture_assets',count(*),'embedded',count(*)filter(where d.embedding is not null),
 'asset_row_median',percentile_cont(0.5)within group(order by pg_column_size(a)),
 'asset_row_p90',percentile_cont(0.9)within group(order by pg_column_size(a)),
 'search_bytes_median',percentile_cont(0.5)within group(order by octet_length(d.search_text)),
 'search_bytes_p90',percentile_cont(0.9)within group(order by octet_length(d.search_text)),
 'metadata_bytes_median',percentile_cont(0.5)within group(order by pg_column_size(d.metadata)),
 'metadata_bytes_p90',percentile_cont(0.9)within group(order by pg_column_size(d.metadata)),
 'document_row_median',percentile_cont(0.5)within group(order by pg_column_size(d)),
 'document_row_p90',percentile_cont(0.9)within group(order by pg_column_size(d))) as generated_profile
from public.assets a join public.dam_search_documents d on d.document_type='asset' and d.entity_id=a.id
where a.id in(select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);
\echo trial=1 arm=old
savepoint trial_start;
drop trigger if exists trg_dam_search_assets_refresh on public.assets;
drop trigger if exists trg_dam_search_assets_refresh_ins_del on public.assets;
CREATE TRIGGER trg_dam_search_assets_refresh AFTER INSERT OR DELETE OR UPDATE OF filename, relative_path, cover_description, ai_description, scene_description, customer, program, licensor_name, property_name, product_category, thumbnail_url, file_type, asset_type, workflow_status, is_licensed, style_group_id, is_deleted, updated_at, modified_at ON public.assets FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_dam_asset_search_document();
drop trigger if exists trg_sync_primary_on_thumbnail on public.assets;
drop trigger if exists trg_sync_primary_on_thumbnail_ins_del on public.assets;
CREATE TRIGGER trg_sync_primary_on_thumbnail AFTER INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_primary_asset_on_thumbnail();
drop trigger if exists trg_sync_designer_to_style_group on public.assets;
drop trigger if exists trg_sync_designer_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_designer_to_style_group AFTER INSERT OR UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_designer_to_style_group();
drop trigger if exists trg_sync_cover_description_to_style_group on public.assets;
drop trigger if exists trg_sync_cover_description_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_cover_description_to_style_group AFTER INSERT OR UPDATE OF cover_description, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_cover_description_to_style_group();
drop trigger if exists trg_auto_queue_render on public.assets;
drop trigger if exists trg_auto_queue_render_ins_del on public.assets;
CREATE TRIGGER trg_auto_queue_render AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url ON public.assets FOR EACH ROW EXECUTE FUNCTION public.auto_queue_render();

-- One fixed warmup, excluded from reported metric.
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select jsonb_build_object('phase','before_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');
select jsonb_build_object('phase','after_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
rollback to savepoint trial_start;
\echo trial=2 arm=new
savepoint trial_start;
-- One fixed warmup, excluded from reported metric.
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select jsonb_build_object('phase','before_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');
select jsonb_build_object('phase','after_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
rollback to savepoint trial_start;
\echo trial=3 arm=old
savepoint trial_start;
drop trigger if exists trg_dam_search_assets_refresh on public.assets;
drop trigger if exists trg_dam_search_assets_refresh_ins_del on public.assets;
CREATE TRIGGER trg_dam_search_assets_refresh AFTER INSERT OR DELETE OR UPDATE OF filename, relative_path, cover_description, ai_description, scene_description, customer, program, licensor_name, property_name, product_category, thumbnail_url, file_type, asset_type, workflow_status, is_licensed, style_group_id, is_deleted, updated_at, modified_at ON public.assets FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_dam_asset_search_document();
drop trigger if exists trg_sync_primary_on_thumbnail on public.assets;
drop trigger if exists trg_sync_primary_on_thumbnail_ins_del on public.assets;
CREATE TRIGGER trg_sync_primary_on_thumbnail AFTER INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_primary_asset_on_thumbnail();
drop trigger if exists trg_sync_designer_to_style_group on public.assets;
drop trigger if exists trg_sync_designer_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_designer_to_style_group AFTER INSERT OR UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_designer_to_style_group();
drop trigger if exists trg_sync_cover_description_to_style_group on public.assets;
drop trigger if exists trg_sync_cover_description_to_style_group_ins_del on public.assets;
CREATE TRIGGER trg_sync_cover_description_to_style_group AFTER INSERT OR UPDATE OF cover_description, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_cover_description_to_style_group();
drop trigger if exists trg_auto_queue_render on public.assets;
drop trigger if exists trg_auto_queue_render_ins_del on public.assets;
CREATE TRIGGER trg_auto_queue_render AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url ON public.assets FOR EACH ROW EXECUTE FUNCTION public.auto_queue_render();

-- One fixed warmup, excluded from reported metric.
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select jsonb_build_object('phase','before_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');
select jsonb_build_object('phase','after_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
rollback to savepoint trial_start;
\echo trial=4 arm=new
savepoint trial_start;
-- One fixed warmup, excluded from reported metric.
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select jsonb_build_object('phase','before_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
select pg_current_wal_insert_lsn() as wal_before \gset
explain(analyze,buffers,wal,format json)
update public.assets set filename=filename,relative_path=relative_path,
  content_type=content_type,cover_description=cover_description,ai_description=ai_description,
  scene_description=scene_description,customer=customer,program=program,
  licensor_name=licensor_name,property_name=property_name,product_category=product_category,
  product_material=product_material,product_dimensions=product_dimensions,
  thumbnail_url=thumbnail_url,thumbnail_error=thumbnail_error,file_type=file_type,
  asset_type=asset_type,workflow_status=workflow_status,is_licensed=is_licensed,
  style_group_id=style_group_id,is_deleted=is_deleted,modified_at=modified_at,
  designer_name=designer_name,technical_designer_name=technical_designer_name,
  freelancer_name=freelancer_name,last_seen_at=clock_timestamp()
where id in (select md5('zz5609-rep-asset-'||i)::uuid from generate_series(1,1000)i);

select 'total_wal_bytes='||pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'wal_before');
select jsonb_build_object('phase','after_batch','checkpointer',to_jsonb(c),'other_active_writers',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='active' and query !~* '^[[:space:]]*(select|show)')) from pg_stat_checkpointer c;
rollback to savepoint trial_start;
rollback;
select jsonb_build_object('all_asset_trigger_definitions_unchanged',(select md5(string_agg(pg_get_triggerdef(oid),E'\n' order by tgname))=:'installed_trigger_hash' from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal),
 'fixture_assets',(select count(*) from public.assets where quick_hash like 'zz5609-rep-%'),
 'fixture_groups',(select count(*) from public.style_groups where sku like 'ZZ5609-REP-%')) as rollback_safety;
```

</details>

## Acceptance still required

- Automatic production application and immediate read-only catalog/cache/three-current-metadata verification.
- A new exact-ID/counter baseline at production application; then the full 24-hour production interval with the same stats reset. Compare interval deltas, not cumulative means.
- The planned latency and WAL-per-call targets, document-write-rate reduction, zero cache drift, and current metadata correctness. Keep #5609 live proof unchecked until those facts are established.

The app-side deliverable was filing the separately owned follow-up, completed at https://github.com/u2giants/popdam3/issues/753. Its implementation is not represented as part of this database change.
