# Database efficiency baseline — 2026-09-04T21:24:59Z

Step 1 of `plan_database_efficiency_and_api_security.md`, for issue #2326 (executing #2209).

- **Target proven before the first read:** `mcp__supabase__get_project_url` returned
  `https://qsllyeztdwjgirsysgai.supabase.co`. Every read in this artifact is against
  production project ref `qsllyeztdwjgirsysgai`, database `postgres`,
  PostgreSQL 17.6.
- **Nature of the work:** read-only. No DDL, no DML, no `pg_stat_reset`, no settings change,
  no extension install, no index change, no migration, no reserved migration version.
- **Reproducibility:** captured twice. Run 1 began 2026-09-04T21:25:25Z; run 2 finished
  2026-09-04T21:31:01Z; separation 5 minutes 36 seconds. Both runs are committed in full
  under `run1/` and `run2/`, with the machine-computed comparison in `delta-run1-run2.txt`.
- **Every query is recorded verbatim** in `queries.md`, including the four attempts that
  failed and why, so no reader mistakes a broken query for an absent capability.
- **No row contents, credentials, or connection strings** appear anywhere in this directory.

## Files

| File | Contents |
| --- | --- |
| `queries.md` | every tool call and SQL statement, verbatim, plus failures and local post-processing |
| `run1/`, `run2/` | the two independent captures, same schema of evidence |
| `runN/advisors-security.json`, `runN/advisors-performance.json` | raw advisor responses |
| `runN/relation-stats.{json,csv}` | 893 relations: heap/index/TOAST bytes, planner rows, live/dead tuples, insert/update/delete/HOT counters, seq/idx scans, vacuum and analyze times and counts, reloptions |
| `runN/pg-stat-statements-top300.{json,csv}` | top 300 statements by total execution time: queryid, normalized text, calls, rows, total/mean/max/stddev exec time, plan time, shared/local/temp blocks, WAL records/FPI/bytes |
| `runN/functions-security.json` | 359 functions: every `SECURITY DEFINER` function in non-system schemas plus the five functions this plan names; owner, security mode, `proconfig` search path, volatility, EXECUTE grants, definition md5 and length; full live definition for the five named functions |
| `runN/indexes.{json,csv}` | index definitions with uniqueness, primary/constraint ownership, partial predicate, expressions, key vs. included attribute counts, validity, size, `idx_scan`, tuples read/fetched, last scan time |
| `runN/foreign-keys.{json,csv}` | every foreign key with child table total size, child and parent change counters, referential actions, and whether a covering index exists |
| `runN/environment-and-security.json` | publications, replication slots, subscriptions, non-secret settings, extensions, and per-relation RLS/force-RLS/policy-count/grant state for 983 relations |
| `delta-run1-run2.txt` | machine-computed run-to-run comparison |

## 1. Verification gate — did the second run reproduce the first?

Yes, and the schema of evidence is identical.

| Evidence set | Run 1 rows | Run 2 rows | Column set identical |
| --- | --- | --- | --- |
| relation stats | 893 | 893 | yes |
| pg_stat_statements top 300 | 300 | 300 | yes |
| function security inventory | 359 | 359 | yes |
| index inventory | 3,388 | 3,388 | yes |
| foreign keys | 1,081 | 1,081 | yes |
| environment and relation security | 1,015 | 1,015 | yes |

Advisor counts were byte-identical between the two runs (security 340 findings,
performance 1,390 findings). All 359 function definition md5 values were identical, so no
function was replaced during the window.

Only three relations moved at all in the 5m36s window — `public.style_guide_folders`
(+380 inserts, a materialized-view refresh), `public.agent_registrations` (18 updates, agent
heartbeats) and `crm.worker_delta_cursor` (2 HOT updates). Twenty-three statements advanced.
That is a genuinely quiet window, and the fact that it is quiet is itself part of the finding
in section 4.

## 2. Statistics-reset timestamp — resolved, not "unknown"

The plan and issue #1966 both record that the cumulative statistics have no proven reset
point. That is now only half true, and the half that changed matters.

- `pg_stat_database.stats_reset` for `postgres` is **NULL**. Four databases on the instance
  report NULL. Table, index and tuple counters therefore still have **no derivable reset
  timestamp**. Do not date anything from them.
- `extensions.pg_stat_statements_info.stats_reset` is **`2026-08-28 21:01:00.960228-04`**,
  confirmed identically in both runs.

So every `pg_stat_statements` number quoted in the plan — and every number in this artifact —
covers a **known window of roughly 7 days 0.5 hours**, from 2026-08-29T01:01:00Z to the
capture. That view was previously read as "cumulative totals without a proven reset
timestamp". It is now a bounded, dated window, which makes rate arithmetic legitimate for
the first time.

The earlier "not derivable" conclusion was not wrong so much as under-searched:
`pg_stat_statements_info` is not on the session `search_path` and a bare reference to it
returns `42P01 relation ... does not exist`, which reads exactly like "unavailable". It must
be schema-qualified. This is recorded in `queries.md`.

## 3. Advisor census — reconciled against the 2026-09-03 comment on #2209

The prior census reported 340 security findings. **It still matches exactly.**

| Security rule | Level | 2026-09-03 claim | 2026-09-04 observed | Verdict |
| --- | --- | --- | --- | --- |
| `authenticated_security_definer_function_executable` | WARN | 143 | 143 | confirmed |
| `function_search_path_mutable` | WARN | 99 | 99 | confirmed |
| `rls_enabled_no_policy` | INFO | 55 | 55 | confirmed |
| `anon_security_definer_function_executable` | WARN | 21 | 21 | confirmed |
| `security_definer_view` | ERROR | 19 | 19 | confirmed |
| `materialized_view_in_api` | WARN | 2 | 2 | confirmed |
| `auth_leaked_password_protection` | WARN | 1 | 1 | confirmed |
| **Total** | | **340** | **340** | **confirmed** |

Performance advisors moved, in one rule only.

| Performance rule | Level | 2026-09-03 claim | 2026-09-04 observed | Verdict |
| --- | --- | --- | --- | --- |
| `unused_index` | INFO | 763 | **739** | **moved, −24** |
| `unindexed_foreign_keys` | INFO | 426 | 426 | confirmed |
| `multiple_permissive_policies` | WARN | 125 | 125 | confirmed |
| `auth_rls_initplan` | WARN | 68 | 68 | confirmed |
| `duplicate_index` | WARN | 22 | 22 | confirmed |
| `no_primary_key` | INFO | 9 | 9 | confirmed |
| `auth_db_connections_absolute` | INFO | 1 | 1 | confirmed |

**The 24 indexes that stopped being "unused" are the finding.** No index was created or
dropped — the index inventory is identical in count, size and validity across both runs, and
none is invalid. What moved is the advisor's own count, 763 to 739, between the 2026-09-03
census and this run; the per-index membership of the 2026-09-03 set was never committed, so
"which twenty-four" cannot be recovered and this artifact does not claim to know. The
mechanism, however, was observed directly: within our own 5m36s window `cron.job.job_pkey`
left the zero-scan set, with no DDL. That is a live, ongoing drift, not a one-off, and it is
the simplest explanation of a 24-index decrease with an unchanged index inventory.

That directly supports the plan's existing prohibition on dropping an index because its
lifetime `idx_scan` is zero: a zero here has been demonstrated, on this database, this week,
to mean "not yet observed" rather than "never used". It also means #1966's 2026-09-17 delta
is measuring something real and must not be disturbed.

The claimed "127 RLS-disabled exposed tables" notice still **does not exist**. No such rule
appears in either advisor response in either run.

## 4. Named functions — live definitions, security, grants

All five are captured with full live definitions in `runN/functions-security.json`. All five
are owned by `postgres`, all five are `SECURITY DEFINER`, and all five pin a `search_path`.

| Function | Args | Owner | Security | `proconfig` | EXECUTE grants |
| --- | --- | --- | --- | --- | --- |
| `public.rebuild_style_groups_batch` | `p_last_asset_id uuid, p_batch_size integer` | postgres | DEFINER | `search_path=public, statement_timeout=120s, lock_timeout=0` | `authenticated`, `postgres`, `service_role` |
| `public.clear_style_group_batch` | `p_last_id uuid, p_batch_size integer` | postgres | DEFINER | `search_path=public, statement_timeout=120s, lock_timeout=0` | `authenticated`, `postgres`, `service_role` |
| `public.refresh_style_group_counts_batch` | `p_group_ids uuid[]` | postgres | DEFINER | `search_path=public, statement_timeout=30s, lock_timeout=0` | `authenticated`, `postgres`, `service_role` |
| `public.refresh_style_guide_matviews` | none | postgres | DEFINER | `search_path=public` | `authenticated`, `postgres`, `service_role` |
| `public.sync_asset_effective_tags` | none (trigger) | postgres | DEFINER | `search_path=public, pg_temp` | `postgres`, `service_role` only |

Definition md5 values, stable across both runs:

| Function | md5 of `pg_get_functiondef` | Definition length |
| --- | --- | --- |
| `rebuild_style_groups_batch` | `189990c7ec25f6987831830060b2aeb3` | 5,532 |
| `clear_style_group_batch` | `3dbea0ab37aa21181efa966cbb4e1d8f` | 1,142 |
| `refresh_style_group_counts_batch` | `b64bc771ea4f4ff1f60bf24f095b3508` | 1,384 |
| `refresh_style_guide_matviews` | `272a67904484bdac2fc5a32fb8f45e3f` | 309 |
| `sync_asset_effective_tags` | `05815a57e75154269b77f122c90ed7be` | 3,917 |

Two observations that Step 2 owns and this artifact only records:

1. **The three expensive batch functions are EXECUTE-able by `authenticated`,** and
   `pg_stat_statements` proves they are in fact being called through PostgREST — the
   `rebuild_style_groups_batch` and `clear_style_group_batch` entries carry the
   `WITH pgrst_source AS (SELECT "pgrst_call".* ...)` PostgREST RPC wrapper. A single
   `clear_style_group_batch` call averages 34.6 seconds. This is an availability surface as
   much as a security one, and it belongs in the Step 2 access matrix with an HTTP test.
2. **`sync_asset_effective_tags` is NOT executable by `anon` or `authenticated`** — its only
   grants are `postgres` and `service_role`. It is correctly not exposed as an RPC.

Its `search_path` is `public, pg_temp`, which is why it appears under
`function_search_path_mutable` despite having a `SET search_path`: including `pg_temp` in a
`SECURITY DEFINER` function's search path is the pattern that rule flags. Recorded, not
proposed for change; the fix belongs to Step 6 with a per-object contract.

**Repository provenance is not yet closed.** The plan requires a byte-for-byte comparison of
each live definition against its actual later migration. That comparison is deliberately not
asserted here: the live md5 values above are the authority and are now recorded, but matching
each to its originating migration file requires reading `supabase/migrations/` history and is
carried as an explicit **unknown**, not an inference. See section 9.

## 5. Named-function cost, over a now-dated window

Window: 2026-08-29T01:01:00Z to 2026-09-04T21:31Z, about 7 days.

| Statement | Calls | Mean ms | Total ms | Movement run1→run2 |
| --- | --- | --- | --- | --- |
| Realtime WAL poll (`SELECT wal->>$5 as type, ...`) | 1,363,171 | 28.9 | 39,356,351 | +526 calls, +6,651 ms |
| `rebuild_style_groups_batch` via PostgREST RPC | 3,973 | 2,982.5 | 11,849,392 | **no movement** |
| `clear_style_group_batch` via PostgREST RPC | 287 | 34,617.3 | 9,935,165 | **no movement** |
| `crm.email_message` select | 173,818 | 50.1 | 8,705,753 | no movement |
| `UPDATE public.assets SET division_code = ...` | 538,871 | 11.0 | 5,913,871 | no movement |
| `SELECT public.refresh_style_guide_matviews()` | 657 → **658** | 8,036.5 | 5,279,954 → **5,284,213** | **+1 call, +4,259 ms, +222,402 WAL bytes** |
| `get_dam_search...` RPC | 13,244 | 265.8 | 3,520,859 | no movement |
| `UPDATE public.assets SET file_created_at = ...` | 335,253 | 9.9 | 3,307,470 | no movement |
| `INSERT INTO public.style_guide_files(...)` | 3,073 | 905.0 | 2,781,142 | no movement |
| `refresh_style_group_counts_batch(array_agg(id))` over all groups | 7 | 95,637.5 | 669,463 | no movement |

Reconciliation against the plan's 2026-09-03 figures:

| Plan claim (2026-09-03) | 2026-09-04 observation | Verdict |
| --- | --- | --- |
| `rebuild_style_groups_batch`: 3,973 calls, 2,982.5 ms mean, 11,849,391.9 ms total | identical to the digit | **confirmed, and dormant since** |
| `clear_style_group_batch`: 287 calls, 34,617.3 ms mean, 9,935,165.1 ms total | identical to the digit | **confirmed, and dormant since** |
| `refresh_style_guide_matviews`: 540 direct calls, 8,623.8 ms mean, plus one PostgREST call | now 658 direct calls (run 1: 657); mean 8,036.5 ms in run 1 and 8,030.7 ms in run 2; the single PostgREST call is still there at 1 call / 7,467 ms | **confirmed and still running** |
| `refresh_style_group_counts_batch`: six all-group calls, 98,583.3 ms mean | now 7 calls, 95,637.5 ms mean | **confirmed, +1 call since** |

Three things follow, and none of them was visible before the window was dated.

1. **The two most expensive style-group functions have not run at all since 2026-09-03.**
   Their totals are unchanged to the tenth of a millisecond across a full day. Roughly 21.8
   million ms — 6.1 hours of database execution time, the single largest application-owned
   block on this list — was spent by two functions that are currently idle. Step 3 must find
   out whether that was a bounded one-off backfill or a job that will fire again, because the
   answer decides whether optimising them is worth anything at all.
2. **`refresh_style_guide_matviews` is the live one.** It fired once inside our 5m36s window,
   cost 4,259 ms, and wrote 222,402 bytes of WAL for that single call. Extrapolating from the
   dated window: 658 calls in 7 days is roughly 4 per hour, at about 8 seconds each. It is a
   non-concurrent `REFRESH MATERIALIZED VIEW public.style_guide_folders` plus a concurrent
   refresh of `public.style_guide_file_groups`, and it is the cheapest credible target in the
   set because it is provably recurring.
3. **The top consumer is not ours.** The Realtime WAL poll is 39.4 million ms, more than
   three times `rebuild_style_groups_batch`, at 1.36 million calls over the window — about 8
   calls per minute at 29 ms each, and it advanced by 526 calls in our window. This statement
   is Supabase Realtime infrastructure reading the logical decoding slot, not application SQL
   we can rewrite. It reinforces the plan's own hypothesis that WAL cost must be attributed
   before Realtime settings are touched; and it means the 21 tables in the
   `supabase_realtime` publication (section 8) set the floor on that cost.

## 6. Relation sizes and maintenance — reconciled

| Relation | Total bytes | Heap | Index | TOAST | Planner rows | Live | Dead | HOT upd | Total upd | Last autovacuum | Last autoanalyze |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `public.assets` | 3,405,725,696 | 2,256,191,488 | 1,149,534,208 | 133,267,456 | 145,745 | 145,746 | 21,248 | 739,983 | 1,478,880 | 2026-09-04 13:44:39 | 2026-09-04 16:31:27 |
| `plm.dcp_metadata_asset` | 1,333,559,296 | 1,206,632,448 | 126,926,848 | 884,465,664 | 374,610 | **0** | 0 | 0 | 0 | never | never |
| `public.asset_tags` | 1,237,778,432 | 478,543,872 | 759,234,560 | 8,192 | 2,172,534 | **0** | 0 | 0 | 0 | never | never |
| `plm.nbcu_asset_metadata_value` | 1,043,570,688 | 442,712,064 | 600,858,624 | 8,192 | 1,189,429 | **0** | 0 | 0 | 0 | never | never |
| `public.style_guide_files` | 881,672,192 | 285,999,104 | 595,673,088 | 90,112 | 296,608 | 296,608 | 5,818 | 0 | 1,565,455 | 2026-09-03 22:12:05 | 2026-09-03 22:12:09 |
| `public.dam_search_documents` | 766,763,008 | 463,740,928 | 303,022,080 | 179,773,440 | 145,973 | 146,007 | 28,288 | 215,191 | 3,437,857 | 2026-09-04 12:14:45 | 2026-09-04 14:24:26 |
| `public.style_guide_file_tags` | 681,771,008 | 367,132,672 | 314,638,336 | 8,192 | 1,021,282 | 10,217 | 3 | 0 | 0 | never | never |
| `public.asset_effective_tags` | 546,750,464 | 161,865,728 | 384,884,736 | 8,192 | 2,045,705 | 2,045,705 | 261,433 | 0 | 0 | 2026-09-03 04:12:08 | 2026-09-03 04:21:56 |
| `public.style_groups` | 43,384,832 | 12,582,912 | 30,801,920 | 32,768 | 10,865 | 10,866 | 1,535 | 852,120 | 1,392,386 | 2026-09-04 00:30:25 | 2026-09-04 16:04:15 |

Reconciliation notes:

- `public.assets` grew from 3,405,258,752 to 3,405,725,696 total bytes since the 2026-09-03
  reading — **+466,944 bytes**, not the 133.9 MB an earlier draft of this note claimed. That
  133.9 MB was an artefact of comparing two different metrics: Q1's `table_bytes` is
  `pg_table_size`, which *includes* TOAST (2,256,191,488 = 2,122,924,032 heap + 133,267,456
  TOAST), while the 2026-09-03 plan figure 2,122,317,824 is heap-only `pg_relation_size`.
  Subtracting one from the other returns the TOAST remainder, not growth. On the same metric
  the heap moved 2,122,317,824 → 2,122,924,032, i.e. **+606,208 bytes (about 592 KB)**. Its HOT ratio is 739,983 of 1,478,880 updates — exactly 50%.
  This is the one relation where the plan's rejected "lower fillfactor broadly" idea would
  have had a plausible target, and the counter says half the updates are already HOT.
- **`dam_search_documents` has the worst HOT ratio on the list: 215,191 HOT out of 3,437,857
  updates, 6.3%.** That is 3.2 million non-HOT updates, each rewriting index entries. It is
  also the table #2196 already owns for a measured fillfactor decision. This artifact
  supports that issue having a real target and says nothing beyond it.
- **`style_guide_files` has zero HOT updates out of 1,565,455.** Not a low ratio — zero. With
  595 MB of indexes on 286 MB of heap, every one of those updates touched an indexed column
  or found no room in the page. This was not called out in the plan and is a candidate for
  Step 3 to attribute before anything is proposed.
- The zero-live-tuple counters on `plm.dcp_metadata_asset`, `public.asset_tags` and
  `plm.nbcu_asset_metadata_value` **persist unchanged**, with no recorded vacuum or analyze
  ever. The plan's instruction stands: these are not empty tables. `asset_tags` shows
  1,874,218 index scans against a planner estimate of 2.17 million rows, so it is being read
  heavily while reporting no tuples at all. Treat every counter on these three relations as
  absent, not as zero.
- **`public.asset_effective_tags` has not changed by a single byte or tuple since
  2026-09-03** — same 546,750,464 bytes, same 2,045,705 live, same 261,433 dead, same
  autovacuum timestamp of 2026-09-03 04:12:08. Its lifetime counters do show real churn
  (8,808,328 inserts, 6,762,623 deletes, 0 updates, consistent with the delete/insert trigger
  design), and 148,486 modifications since the last analyze. But nothing moved in the last
  day. The plan's confirmed finding #2 — "`asset_effective_tags` has real churn" — is
  therefore **confirmed historically but not reproduced as current activity**, which is
  precisely the distinction Step 3 was asked to settle about the 181-second population.

## 7. Indexes

Counting note, stated because it changes the numbers: the index query left-joins
`pg_constraint` on `conindid`, and an index can back more than one constraint, so the raw
extract has 3,388 rows for 2,308 distinct indexes. **All index figures below are computed on
distinct index identity**, and both runs contain the same 3,388 rows, so the comparison is
still valid. Anyone re-deriving numbers from `indexes.csv` must de-duplicate on
(schema, table, index) first.

| Measure | Run 1 | Run 2 |
| --- | --- | --- |
| Distinct indexes | 2,308 | 2,308 |
| Total index bytes | 6,101,065,728 | 6,101,065,728 |
| Invalid or not-ready indexes | 0 | 0 |
| Indexes with `idx_scan` = 0 | 1,876 | 1,875 |
| Bytes held by zero-scan indexes | 3,551,748,096 | 3,551,731,712 |
| Zero-scan indexes that are constraint-owned | 968 | 967 |

Zero-scan indexes hold 3.55 GB — 58% of all index bytes. **968 of them back a primary key or
unique constraint and cannot be dropped at all**, which is by itself enough to refuse any
bulk action on the 739 `unused_index` advisories. The largest zero-scan index in the database
is `plm.nbcu_asset_metadata_value_pkey` at 580 MB, on one of the three tables whose counters
are missing entirely.

Largest zero-scan indexes:

| Index | Bytes | Unique | Constraint-owned |
| --- | --- | --- | --- |
| `plm.nbcu_asset_metadata_value.nbcu_asset_metadata_value_pkey` | 580,493,312 | yes | yes |
| `public.assets.idx_assets_relative_path_trgm` | 292,536,320 | no | no |
| `plm.dcp_asset_term_observation.dcp_asset_term_obs_pkey` | 208,109,568 | yes | yes |
| `public.asset_tags.asset_tags_asset_id_tag_key` | 184,328,192 | yes | yes |
| `public.asset_tags.asset_tags_pkey` | 141,434,880 | yes | yes |
| `public.style_guide_files.idx_sgf_relative_path_trgm` | 134,053,888 | no | no |
| `public.style_guide_files.idx_sgf_directory_path_trgm` | 111,771,648 | no | no |
| `plm.nbcu_asset_property.nbcu_asset_property_pkey` | 90,890,240 | yes | yes |
| `plm.pmt_asset_metadata_value.pmt_asset_metadata_value_pkey` | 85,090,304 | yes | yes |
| `public.assets.idx_assets_tags` | 84,500,480 | no | no |

The four largest **droppable** zero-scan candidates are all trigram indexes —
`idx_assets_relative_path_trgm` (292 MB), `idx_sgf_relative_path_trgm` (134 MB),
`idx_sgf_directory_path_trgm` (112 MB) and `idx_assets_tags` (84 MB), 622 MB together — and
three of the four sit on `public.assets` and `public.style_guide_files`, which are two of the
four tables frozen by #1966 until 2026-09-17. Nothing may be proposed about them before then,
and the 24-index drift documented in section 3 is a live demonstration of why.

## 8. Foreign keys, publications, replication, environment

**Foreign keys.** 1,081 constraints. **433 have no covering index on the child side**, close
to the 426 the advisor reports; the small difference is that this query tests the leading
columns of any index, while the advisor applies its own rule. Largest uncovered-FK child
tables, with the parent-change counters that decide whether the missing index costs anything:

| Child table (constraint) | Child bytes | Parent updates | Parent deletes | ON DELETE |
| --- | --- | --- | --- | --- |
| `plm.dcp_metadata_asset` (`dcp_metadata_asset_membership_fk`) | 1,333,559,296 | 0 | 0 | restrict |
| `plm.dcp_metadata_asset` (`dcp_metadata_asset_run_fk`) | 1,333,559,296 | 0 | 0 | cascade |
| `public.style_guide_file_tags` (`style_guide_file_tags_source_file_id_fkey`) | 681,771,008 | **1,565,455** | 0 | set null |
| `public.style_guide_file_tags` (`style_guide_file_tags_created_by_fkey`) | 681,771,008 | 412 | 0 | set null |
| `public.style_guide_file_tags` (`style_guide_file_tags_confirmed_by_fkey`) | 681,771,008 | 412 | 0 | set null |
| `plm.dcp_asset_term_observation` (`dcp_asset_term_obs_asset_fk`) | 458,457,088 | 0 | 0 | cascade |
| `ingest.raw_record` (`raw_record_sync_run_id_fkey`) | 310,001,664 | 0 | 0 | set null |
| `plm.dcp_asset_property_observation` (`dcp_asset_property_obs_asset_fk`) | 200,310,784 | 0 | 0 | cascade |
| `pim.product` (`product_factory_id_fkey`) | 173,596,672 | 0 | 0 | set null |
| `pim.product` (`product_product_type_id_fkey`) | 173,596,672 | 0 | 0 | set null |

The ON DELETE column decodes `pg_constraint.confdeltype`: `a` NO ACTION, `r` RESTRICT,
`c` CASCADE, `n` SET NULL. Six of the rows above are `n` — **SET NULL**, not NO ACTION.
That distinction matters downstream: SET NULL writes the child row on a parent delete
where NO ACTION only checks it, so a Step 5 shortlist built from this table must price
the child write. It does not change the argument below, because every one of those six
parents has zero recorded deletes.

This is exactly the discrimination the plan asked for and it separates the list cleanly.
**One row on this list has a parent that actually changes:**
`style_guide_file_tags_source_file_id_fkey`, whose parent `public.style_guide_files` has taken
1,565,455 updates — the same table with zero HOT updates from section 6. Every other large
uncovered FK points at a parent with zero recorded updates and zero deletes, i.e. a cold
landing table where the missing index would cost write amplification and buy nothing. The
plan's refusal to add all 426 indexes is supported by measurement, and the shortlist worth
considering later is small.

**Publications.** Two.

- `supabase_realtime`, owner `postgres`, not all-tables, INSERT/UPDATE/DELETE/TRUNCATE, 21
  tables: `app.activity`, `app.comment`, `app.notification`, `crm.department`,
  `crm.email_message`, `crm.licensor_approval_thread`, `crm.meeting_note`, `crm.note`,
  `crm.opportunity`, `crm.task`, `dam.asset`, `dam.style_group`, `pim.customer_order`,
  `pim.product`, `pim.product_assignee`, `pim.product_sample`, `pim.product_submission`,
  `pim.revision_request`, `pim.stage_history`, `public.admin_config`,
  `public.agent_registrations`.
- `supabase_realtime_messages_publication`, owner `supabase_admin`, covering seven daily
  `realtime.messages_2026_09_0N` partitions.

**Replication slots.** Two, both logical, both temporary, both active, both
`wal_status = reserved`. `safe_wal_size` is per run and moves between them: 2,164,233,680
in run 1 and 2,164,254,128 in run 2 for both slots (a 20,448-byte difference over 5m36s,
which is WAL headroom drifting normally, not a slot falling behind) —
`supabase_realtime_replication_slot_2_134_2_3e6fc57` (plugin `wal2json`) and
`supabase_realtime_messages_replication_slot_2_134_2_3e6fc57` (plugin `pgoutput`). No
subscriptions. No slot is lagging or in a `lost`/`unreserved` state, so replication is not
currently retaining WAL abnormally — the Realtime cost in section 5 is polling cost, not
backpressure.

**Settings** (non-secret, recorded for attribution only; none was changed):
`wal_level=logical`, `autovacuum=on` (default), `autovacuum_vacuum_scale_factor=0.2`
(default), `autovacuum_analyze_scale_factor=0.1` (default), `autovacuum_naptime=60s`,
`track_counts=on`, **`track_io_timing=off`**, `shared_buffers=512MB`,
`effective_cache_size=1536MB`, `work_mem=5MB`, `maintenance_work_mem=128MB`,
`max_connections=90`, `statement_timeout=120s`, `default_statistics_target=100`,
`max_replication_slots=10`, `max_wal_senders=10`.

`track_io_timing=off` is worth naming: it means the block-read numbers in
`pg-stat-statements-top300` are counts, not time, so no I/O-time attribution is possible from
this baseline. That is a bound on Step 3, recorded now rather than discovered later. Turning
it on is a global setting change and is out of scope by the plan's own rules.

Twelve extensions are installed; the full list with versions and schemas is in
`environment-and-security.json`.

## 9. Claim reconciliation

Every dashboard-AI and plan claim in scope, classified. Nothing here is inferred from a NULL
or zero counter alone; where a counter is absent it is recorded as **unknown**.

| # | Claim | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 340 security advisor findings across 7 rules | **confirmed** | both runs, identical rule-by-rule |
| 2 | 763 unused-index notices | **superseded** | count only: now 739. Which 24 left the set cannot be recovered (see §3). One index, `cron.job.job_pkey`, was observed leaving the zero-scan set inside our own 5m36s window |
| 3 | 426 unindexed foreign keys | **confirmed** | advisor; catalog cross-check finds 433 by leading-column test |
| 4 | 125 multiple-permissive-policy, 68 RLS-initplan, 22 duplicate-index, 9 no-PK, 1 auth-connection | **confirmed** | both runs |
| 5 | "127 RLS-disabled exposed tables" | **not reproduced** | no such rule in either advisor response |
| 6 | No RLS-disabled table has direct `anon` DML privilege | **confirmed** | catalog ACL scan over the nine application schemas; 0 found |
| 7 | Three RLS-disabled tables have some `authenticated` DML privilege | **not reproduced** | the same scan found **0**, not 3. Either the earlier scan used a broader definition or state changed. Step 2 must settle it with both catalog and HTTP evidence rather than inheriting either number |
| 8 | `rebuild_style_groups_batch` 3,973 calls / 2,982.5 ms mean / 11,849,391.9 ms total | **confirmed**, and dormant since 2026-09-03 | pg_stat_statements, unchanged to the digit |
| 9 | `clear_style_group_batch` 287 calls / 34,617.3 ms mean / 9,935,165.1 ms total | **confirmed**, and dormant since 2026-09-03 | as above |
| 10 | `refresh_style_guide_matviews` 540 direct calls / 8,623.8 ms mean | **superseded** — run 1: 657 calls / 8,036.5 ms mean; run 2: 658 calls / 8,030.7 ms mean, actively running | advanced during our own 5m36s window |
| 11 | `refresh_style_group_counts_batch` six all-group calls / 98,583.3 ms mean | **confirmed**, now 7 calls / 95,637.5 ms | pg_stat_statements |
| 12 | pg_stat_statements totals have no proven reset timestamp | **superseded** | `extensions.pg_stat_statements_info.stats_reset = 2026-08-28 21:01:00.960228-04` |
| 13 | Table/index/tuple counters have no derivable reset timestamp | **confirmed** | `pg_stat_database.stats_reset` is NULL for all four databases |
| 14 | `plm.dcp_metadata_asset`, `public.asset_tags`, `plm.nbcu_asset_metadata_value` report zero live tuples but are not empty | **confirmed** | planner estimates 374,610 / 2,172,534 / 1,189,429; `asset_tags` shows 1,874,218 index scans; counters treated as **unknown**, not zero |
| 15 | `asset_effective_tags` has real churn | **confirmed historically, not reproduced as current activity** | 8.8M lifetime inserts / 6.76M deletes, but zero movement in bytes, tuples or vacuum time since 2026-09-03 |
| 16 | The 181-second `asset_effective_tags` population is recurring | **unknown** | no caller or timestamp is derivable from this baseline; Step 3 owns it |
| 17 | Autovacuum is active on the named large tables | **confirmed** | `assets`, `dam_search_documents`, `style_groups` all vacuumed and analyzed on 2026-09-04 |
| 18 | Repository provenance of the five named function definitions | **unknown** | live md5 values are now recorded and are the authority; byte-for-byte matching to the originating migrations is not asserted and remains open |
| 19 | WAL/logical-replication cost may be application write amplification | **partially answered** | the single largest statement is the Realtime WAL poll (39.4M ms, 1.36M calls) and both slots are healthy and reserved, so this is polling over the 21 publication tables, not replication backpressure. Attribution of the write side still belongs to Step 3 |

## 10. Explicit limits of this baseline

These are bounds, not failures, and each is named so that no later step mistakes silence for
an answer.

1. `pg_stat_database.stats_reset` is NULL: no table, index or tuple counter can be dated.
   Only `pg_stat_statements` has a window.
2. `track_io_timing` is off: no I/O-time attribution is possible for any statement.
3. Three large relations report no tuple statistics at all; every counter on them is unknown.
4. No caller, scheduler, concurrency or query plan is established here. That is Step 3, which
   the orchestrator is handling separately, and nothing in this artifact substitutes for it.
5. No HTTP behaviour was tested. Every access statement here is catalog-only. Step 2 owns the
   actual Data API boundary, including the `authenticated` EXECUTE grants in section 4.
6. The window between the two runs is 5m36s. It is long enough to prove the schema of
   evidence reproduces and to catch live drift, and it did catch some. It is not a workload
   window, and no rate in this document is derived from it — the rates in section 5 come from
   the dated `pg_stat_statements` window instead.
7. No script was added under `scripts/database-efficiency/`. Manual extraction repeated
   cleanly twice and every statement is recorded verbatim in `queries.md`, so the plan's
   condition for adding code was not met.

## 11. Incidental finding — the issue #1684 EOL table, and a guard that cannot see across columns

Not part of Step 1's capture list, but it fell out of the census and is recorded
here because it is evidence about production that someone will otherwise
re-measure.

**The DesignFlow copies of the EOL mixed table are still present and are inert.**

| Relation | Total bytes | Live tuples | Planner rows | Inserts | Updates | Deletes | Seq scans | Index scans | Ever vacuumed/analyzed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dflow.properties_and_characters` | 3,006,464 | 0 | 10,122 | 0 | 0 | 0 | 1 | 1 | never |
| `dflow_prod.properties_and_characters` | 49,152 | 0 | unknown (`reltuples` -1) | 0 | 0 | 0 | 0 | 0 | never |

These are `dflow` / `dflow_prod`, **not** `core.properties_and_characters`. Both
carry zero live tuples and zero recorded write activity over the window. The
`dflow` copy's 10,122 planner rows against 0 live tuples means the planner
estimate is stale, not that rows exist — nothing has ever analyzed it. The
`dflow_prod` copy's `reltuples` is **-1**, which is PostgreSQL's "never analyzed,
unknown" marker and must not be read as an estimate of zero; the earlier draft of
this section printed it as 0, which was wrong in exactly the way this artifact
warns against elsewhere.

Between them the two relations have **10 distinct indexes**, named by 8
foreign-key rows. (`indexes.csv` shows 16 rows for them because of the
`pg_constraint` fan-out disclosed in section 7 — count distinct index identity,
not rows.) **Nine** of the ten have `idx_scan` 0. The tenth,
`dflow.idx_properties_licensor_id`, has `idx_scan` 1 with 10,122 tuples read and
`last_idx_scan` 2026-09-02 15:56:11-04 — it is the same single index scan the
table above reports for that relation.

Only **three** of them appear in the `unused_index` advisor rule:
`idx_properties_name` on `dflow`, and `idx_properties_licensor_id` and
`idx_properties_name` on `dflow_prod`. The advisor correctly omits
`dflow.idx_properties_licensor_id` because it has a recorded scan, and omits the
remaining six because they back primary-key or unique constraints, which that
rule excludes — the same reason 968 zero-scan indexes are undroppable in section 7.

Read this as "not reproduced as active", not "empty": `n_live_tup` is a counter,
and `pg_stat_database.stats_reset` is NULL (section 2), so these zeros cannot be
dated. Per the plan's gate, no claim is inferred from a NULL/zero counter alone —
this row says only that no activity was observed, and a `select count(*)` was
deliberately not run because Step 1 is forbidden from capturing row contents.

**The guard defect.** The first CI run of this PR failed `SQL migration guards`
on the issue #1684 EOL reference rule. Every flagged occurrence was one of the
`dflow` rows above, which that guard explicitly exempts — but its exemption strips
`dflow.properties_and_characters` as a single adjacent string, and a tabular
extract holds the schema and the table in separate columns, so the bare table name
never meets the strip. Any future evidence file, migration inventory, or CSV export
that lists relations in columns will trip the same rule for the same wrong reason.
The extracts were schema-qualified rather than the guard edited; `queries.md`
records the exact transformation and the guard source that proves the false
positive.
