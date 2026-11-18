---
summary: "Step 7 WAL/Realtime attribution (2026-11-18): 292.2 GiB WAL since 2026-11-06 reset; rebuild family 3.23%; Realtime retention 141.5 MiB; no tuning done"
kind: proof
status: done
read-when: attributing WAL to rebuild/projection vs application/Realtime/CDC producers, or reviewing Step 7 WAL/Realtime evidence for the #2326 program
---

# Step 7 WAL/Realtime attribution report — 2026-11-18

**Plan / program:** `plan_database_efficiency_and_api_security.md` Step 7 (Phase E), program #2326.
**Reported issue:** "Step 7 WAL/Realtime attribution report (#2326 program)".
**Recorded:** captures 2026-11-18T03:48Z–04:17Z (2026-11-17 10:48 PM – 11:17 PM EST).
**Session:** MiMo chat `ses_ffe5e136` on edge-dev (`SHARED_DB_AUTHOR_ENGINE=mimo`,
`SHARED_DB_SESSION_ID=ses_ffe5e136dd083ffeY5NeNhRAz5`).
**Scope:** read-only production measurements through the Supabase Management API
`database/query` endpoint with `read_only: true` (pattern: `scripts/catalog-truth.mjs`),
production project ref `qsllyeztdwjgirsysgai`. No DDL, no DML, no `pg_stat_reset`,
no settings change, no row contents, no credentials. **No Realtime, logical-replication,
or CDC setting was disabled or altered — not even temporarily; no tuning action of any
kind was taken (Step 7 is attribution only).** Raw captures live beside this file
(`q-*.json`, `q60-step3-to-now-deltas.json`).

## Window facts (read before comparing any counter)

- `pg_stat_statements` and `pg_stat_wal` share one global stats reset:
  **2026-11-06 11:20:19 EST**
  (`extensions.pg_stat_statements_info.stats_reset` = `2026-11-06 11:20:19.263334-05`;
  `pg_stat_wal.stats_reset` = `2026-11-06 11:20:19.869905-05` — `q15-pgss-info.json`,
  `q11-pg-stat-wal.json`). Every `pg_stat_statements` figure below is a
  cumulative-since-reset counter, not a lifetime counter. Nothing in this report is
  comparable to the 2026-09-04 baseline counters without that reset fact.
- `pg_stat_statements.track = top` (unchanged from the Step 3 capture): statements inside
  plpgsql/sql functions get **no separate entry**. WAL produced inside a called function
  lands on the top-level call's entry (evidenced by the rebuild RPC entry carrying
  multi-GiB `wal_bytes` for one top-level statement). Per-internal-statement splits are
  therefore unavailable.
- Server: PostgreSQL 17.11 (`server_version_num 170011`). API role: **`supabase_read_only_user`**
  (`q00-identity.json`). Write-side EXPLAIN and some WAL/replication views are refused 42501;
  each refusal is recorded below as a platform boundary, not worked around.
- Three dated windows used in this report:
  - **Window A — 2026-11-06 11:20:19 EST → 2026-11-13 11:37:11 EST (7.012 days).**
    Values are the 2026-11-13 Step 3 captures
    (`docs/verification/database-efficiency/20261113T163700Z-step3-residual/`
    `q-pgss-top80.json` + `q-pgss-targeted.json`, whose `q0-identity.json` stamps
    `utc_now = 2026-11-13 16:37:11.140973`). This is the program's "before Step 4's
    reductions" baseline (the 4,438 calls / 1,184 ms mean / 5.88 GiB figure).
  - **Window B — 2026-11-13 11:37:11 EST → 2026-11-17 23:04:43 EST (4.478 days).**
    Values are the delta from those captures to this capture (`q44-wal-delta-since-step3.json`
    stamps `now_utc = 2026-11-17 23:04:43.327089-05`; per-query deltas in
    `q60-step3-to-now-deltas.json`).
  - **Cumulative since reset — 2026-11-06 11:20:19 EST → 2026-11-17 23:04:43 EST
    (11.489 days)** for the §3 share table.
- **Comparability:** both windows sit after the same single reset and no reset occurred
  between captures, so window-B deltas are arithmetically valid. **But Window A is not a
  pure pre-Step-4 baseline:** the matview-cron schedule change (shared-db PR #4192 /
  migration `20261011175808`) landed 2026-10-11, and popdam3's serialized RPC (#294) and
  #295's commit `67685c55` were already live before the 2026-11-13 closure audit. Window A
  is therefore mixed pre/post for those changes; only the July–October cadence that
  #293 replaced lies entirely outside both windows. Any before/after claim must carry
  this caveat. (Raw capture timestamps are machine UTC/EST as returned by `now()`.)

## 1. Inventory

### 1.1 Publications (`q02-pg-publication.json`, `q03-pg-publication-tables.json`)

Exactly two publications, both non-`puballtables`, both publish insert/update/delete/truncate:

| publication | owner | tables |
|---|---|---|
| `supabase_realtime` | `postgres` | 13 tables: `core.contact`, `core.contact_company`, `crm.department`, `crm.email_message`, `crm.ingested_domain`, `crm.meeting_note`, `crm.note`, `crm.opportunity`, `crm.task`, `public.admin_config`, `public.agent_registrations`, `public.render_queue`, `public.style_tracker_rows` (full column lists per table in `q03`) |
| `supabase_realtime_messages_publication` | `supabase_admin` | 7 daily partitions `realtime.messages_2026_11_15` … `realtime.messages_2026_11_21` |

No publication carries the rebuild/projection relations (`style_groups`,
`style_group_counts`, `asset_effective_tags`, style-guide matviews): rebuild writes are
not decoded into any logical-replication stream. That rules out "rebuild WAL is amplified
by CDC payload" as a hypothesis — rebuild WAL is plain heap/index WAL from the writes.

### 1.2 Replication slots (`q04`, `q05-slot-lag.json`, `q27`, `q54`)

Two logical slots, both `temporary: true`, both `active`, both `wal_status: 'reserved'`,
`safe_wal_size` 2,008,408,064 B, same `restart_lsn` `3D9/DB7539D0`, `catalog_xmin`
`46030109`:

| slot | plugin | consumer (pid, application_name) | confirmed_flush_lsn | lag from confirmed | retained from restart_lsn |
|---|---|---|---|---|---|
| `supabase_realtime_messages_replication_slot_2_163_0_a640b93` | `pgoutput` | 1342570 `realtime_replication_connection` (streaming walsender, `START_REPLICATION`) | `3D9/E44A1F41`→`3D9/E44C8E31` across captures | 12,111 B | 148,341,680 B (141.5 MiB) |
| `supabase_realtime_replication_slot_2_163_0_a640b93` | `wal2json` | 1342552 `realtime_rls` (SQL-interface consumer, reads `wal->>'type'`) | `3D9/E415F220` | 3,591,008 B (3.42 MiB) | 148,341,680 B (141.5 MiB) |

Walsender lag (q06): `sent_lsn`/`write_lsn`/`flush_lsn`/`replay_lsn` within 1 B of
`pg_current_wal_lsn()`; `lag_bytes_sent` 0; `write_lag`/`flush_lag`/`replay_lag`
`00:00:00.001651`; `sync_state` async. Point-in-time view only (see §3 boundary 5).

### 1.3 Subscriber-side lag

- `pg_stat_subscription` returns **0 rows** (q07) — this instance is the publisher and has
  no local logical subscription; expected.
- `pg_replication_origin_status`: **refused 42501** `permission denied for function
  pg_show_replication_origin_status` (q08) — platform boundary for
  `supabase_read_only_user`.
- Subscriber-side lag is therefore visible only through the publisher-side proxies in
  §1.2 (confirmed-flush lag 12,111 B / 3.42 MB). Realtime's internal subscriber queue
  depth is not exposed read-only.

### 1.4 Realtime channels / config (`q09`, `q32`, `q33`, `q53`, `q51`)

- `realtime` schema exists (q09). `realtime.subscription` **is readable** at
  config/aggregation level (q32/q33): **10 live subscription rows**, 10 distinct
  `subscription_id`, **2 entities** — `admin_config` (6 subscriptions, `action_filter`
  `*`, `claims_role` `authenticated`) and `agent_registrations` (4, same). Created
  2026-11-17 22:09:47 – 22:42:01 EST. No other entities or channels.
- Broadcast payload tables: `realtime.messages_2026_11_15` … `_21` all hold **0 rows**
  (q53, `count(*)` per partition). pg_stat_statements contains **zero message INSERTs**
  (q51) — only partition `CREATE`/`DROP`/`ALTER` (supabase_admin), `delete from
  realtime.subscription`, `realtime.schema_migrations` rows, and the Realtime RLS
  publication checks (`with candidates as (… pg_publication_tables …)`).
- Realtime's own WAL footprint in pg_stat_statements is **≈14.3 MB total** (q51):
  RLS/publication checks 6.7 MB / 3,077 calls + 1.4 MB / 757 calls, `wal->` decoding
  reads 4.88 MB / 2,048,909 calls, subscription deletes 0.93 MB / 822 calls, partition
  DDL ≈0.2 MB. Negligible as a WAL generator.

### 1.5 Write-heavy application windows (`q20-cron-job.json`, `q22b`, `q34`, `q35`, `q36`)

16 active `cron.job` entries. Run details cover 2026-11-03 23:00 EST → 2026-11-17 22:56 EST.
The write-heavy windows:

| job | schedule | runs (succeeded) | avg s | drives |
|---|---|---|---|---|
| 19 `dam-default-visible-flag-sweep` | `* * * * *` | 16,875 | 0.5 | `dam_sweep_default_visible_flags_batched(5000)` — pgss 2.47 GiB WAL / 16,543 calls |
| 13 `prewarm-style-guide-search` | `4-59/10 * * * *` | 3,023 | 5.0 | search prewarm (read-mostly) |
| 11 `nightly-rebuild-style-groups` | `*/10 * * * *` | 1,976 | 0.2 | `queue_nightly_rebuild_style_groups()` **enqueue only** — the rebuild RPC itself is driven by the popdam3 worker (role `service_role` via PostgREST), outside cron |
| 12 `refresh-style-guide-library-default-snapshot` | `*/15 * * * *` | 1,271 | 12.1 | library default snapshot projection |
| 9 `refresh-style-guide-matviews` | `7 * * * *` (Step 4 #293 cadence) | 319 | 7.5 | `refresh_style_guide_matviews_job()` — the projection refresh |
| 17 `resolve-sku-style-guide-links-nightly` | `30 4 * * *` | 11 (+3 failed) | 23.6 | SKU↔style-guide link resolution |
| 16 `nightly-style-tracker-item-autoflow` | `50 5 * * *` | 14 | 12.0 | style-tracker item autoflow |
| 10 `refresh-sku-human-description` | `30 4 * * *` | 14 | 5.1 | description refresh |
| 5 `nightly-sg-crawl` | `0 2 * * *` | 14 | 0.0 | crawl request enqueue (`admin_config`) |
| 2/3/25 purge jobs | `0 3:00` / `15 3:00` / `30 3:00` | 14 each | ≤0.3 | delete-only retention |
| 14 `purge-image-embed-jobs` | `17 3 * * *` | 14 | 0.2 | embed-job retention |
| 28 `coldlion-core-property-sync` | `30 15 * * *` | 2 | 0.3 | licensor/property sync (owner-ruling path) |
| 18/22 weekly | `0 8 * * 0` / `15 8 * * 0` | 2 each | 42.3 / 0.2 | change-log rotation, hts retention |

Failed runs cluster 2026-11-04 → 2026-11-05 (jobs 9/11/12/13/17: 17 + 39 + 72 + 7 + 3
failures, avg 53–120 s — job 9/12 hit the 10 min `statement_timeout`, others 120 s) and
stop after 2026-11-06. The largest WAL writers are **not** cron-driven:
`replace_asset_ai_tag_result` (124,883 calls) and `update_bulk_operation` (28,670 calls)
arrive as app-worker PostgREST RPCs; `hts_rag.*` writes come from role
`designflow_hts_alsand_worker`.

## 2. Correlation — WAL delta vs rebuild/projection/job windows, before and after Step 4

**Method.** Per-statement `wal_bytes` from `pg_stat_statements`, split into Window A and
Window B as defined above (same reset, no intermediate reset, deltas matched by
`queryid` — `q60-step3-to-now-deltas.json`). Job windows come from
`cron.job_run_details`. **Boundary: no time-series WAL history exists in any read-only
view — `pg_stat_wal` is cumulative since the 2026-11-06 reset only — so WAL cannot be
sliced by clock window.** Correlation is therefore per-statement-family rates over the two
named windows, matched to the job/worker that issues the statement. That is the strongest
dated correlation the read-only surface supports.

**Per-producer deltas** (A = 7.012 d ending 2026-11-13 11:37 EST; B = 4.478 d ending
2026-11-17 23:04 EST; rates are per day):

| producer (`queryid`) | Window A: calls / WAL / WAL-day | Window B: calls / WAL / WAL-day | Δ WAL-day |
|---|---|---|---|
| `rebuild_style_groups_batch` RPC (`693367342154916556`) — the program's measured "rebuild batch / refresh_style_group_counts_batch family", params `p_last_asset_id, p_batch_size, p_changed_since` | 4,438 / 5.88 GiB / 858.8 MiB | 2,307 / 3.38 GiB / 772.4 MiB | **−10.1 %** (calls/day 632.9 → 515.2, −18.6 %) |
| `refresh_style_guide_matviews_job()` (`4823001052977070422`) | 168 / 99.8 MiB / 14.24 MiB | 107 / 5.06 MiB / 1.13 MiB | **−92.1 %** (calls/day flat, 24.0 → 23.9) |
| `queue_nightly_rebuild_style_groups()` (`7327558641138002573`) | 1,009 / 11.7 MiB / 1.67 MiB | 644 / 9.4 MiB / 2.09 MiB | flat (144 calls/day both; enqueue-only) |
| `replace_asset_ai_tag_result` (`-5753757789977632690`) | 122,857 / 40.65 GiB / 5.80 GiB | 2,026 / 0.60 GiB / 0.134 GiB | −97.7 % |
| `update_bulk_operation` (`-6692293795927846673`) | 23,800 / 17.24 GiB / 2.46 GiB | 4,870 / 3.42 GiB / 0.764 GiB | −69.0 % |
| `hts_rag.hts_rag_rulings` `raw_json` UPDATE (`2351805783924082538`) | 3,874 / 1.91 GiB / 0.272 GiB | 42,120 / 18.63 GiB / 4.16 GiB | **+1,429 %** |
| `upsert_style_guide_crawl_files` (`-6163793804568660475`) | 6,677 / 1.31 GiB / 0.187 GiB | 11,958 / 2.85 GiB / 0.636 GiB | +240 % |
| `plm.import_item_master_data` (`6198424913178270339`) | 23 / 2.80 GiB / 0.399 GiB | 11 / 1.41 GiB / 0.315 GiB | −21 % |

**Per-call shape of the rebuild family:** 1,422,663 B/call → 1,571,900 B/call (+10.5 %);
mean 1,184 ms → 1,251 ms. The WAL-day reduction is **call-rate driven** (Step 4's
app-side coalescing/serialization), not a per-call cost reduction.

**Rebuild/projection vs job windows:**

- The rebuild RPC is **not cron-driven**. Job 11 only enqueues (144 runs/day, 0.2 s). The
  RPC runs from the popdam3 worker; its windows are that worker's poll loop, not a named
  cron row. Correlation for it is by statement family only. **Boundary: `pg_stat_statements`
  has no timestamps — WAL of an individual rebuild batch cannot be attributed to a specific
  `cron.job_run_details` row.**
- The matview projection **is** cron-driven (job 9, hourly at :07 since migration
  `20261011175808` — the Step 4 #293 cadence, `*/15` → `7 * * * *`). Runs/day stayed flat
  while WAL/day collapsed −92.1 % (mean WAL/call 622,979 B → 49,637 B). This is the
  cleanest dated before/after signal for the Step 4 projection changes: hourly runs now
  mostly find nothing to rewrite.
- **Total-WAL split between Windows A and B is not reconstructable:** the 2026-11-13
  Step 3 captures did not include `pg_stat_wal` or a pgss `sum(wal_bytes)`
  (`q0-identity.json` holds identity + pgss reset only). Only per-statement deltas are
  dated. Recorded as a boundary, not estimated.
- Non-program movement dominates the totals between the windows: the DAM AI-tag campaign
  (top producer in A at 5.80 GiB/day) collapsed −97.7 %/day, while the DesignFlow HTS RAG
  ingest grew +1,429 %/day to 4.16 GiB/day. These families are outside Step 4's scope;
  their movement is why whole-server WAL totals cannot serve as the program's
  before/after proof.

## 3. Attribution verdict

Denominator: `pg_stat_wal.wal_bytes` = **313,794,872,168 B (292.24 GiB)** cumulative
2026-11-06 11:20:19 EST → 2026-11-17 23:04:43 EST (`q44`). Family shares from `q41`
(same capture minute; family rows sum 237.29 GiB vs pgss total 237.33 GiB — 39 MB
intra-minute drift).

| WAL producer family | share of `pg_stat_wal` | measured | evidence query |
|---|---|---|---|
| **Application writes — DAM tag/bulk-ops/misc** (`replace_asset_ai_tag_result` 41.25 GiB, `update_bulk_operation` 20.67 GiB, `UPDATE assets` 6.44 GiB, `DELETE asset_characters` 3.20 GiB, `INSERT asset_licensor_characters` 3.26 GiB, `infer_path_attrs` bulk update 3.20 GiB, `dam_sweep_default_visible_flags_batched` 2.47 GiB, misc) | **38.23 %** | 111.74 GiB | `q41` family `other_application`; named entries `q43` |
| **Application writes — HTS RAG ingest** (`designflow_hts_alsand_worker`, `hts_rag.*`) | **30.05 %** | 87.82 GiB | `q41` family `hts_rag_ingest_worker` |
| Application writes — style-guide crawl/import | 5.04 % | 14.74 GiB | `q41` family `style_guide_crawl_import` |
| **Rebuild/projection family** (rebuild RPC 9.28 GiB + queue 0.02 GiB + matview projection 0.18 GiB) | **3.23 %** | 9.46 GiB | `q41` families `rebuild_style_groups_rpc` + `projection_matview_refresh`; `q18b` |
| Application writes — search sync/embed | 2.11 % | 6.17 GiB | `q41` family `search_sync_embed` |
| Application writes — PLM item import | 1.44 % | 4.21 GiB | `q41` family `plm_item_import` |
| Application writes — image embed jobs | 1.08 % | 3.15 GiB | `q41` family `image_embed_jobs` |
| Realtime/CDC overhead (its own writes only) | 0.005 % | ≈14.3 MB | `q51` |
| Explicit `VACUUM`/`ANALYZE` statements | 0.0005 % | 1.46 MB | `q41` family `explicit_vacuum_analyze` |
| `clear_style_group` | 0 % | 0 B (3 calls) | `q41` |
| **pg_stat_statements subtotal** | **81.21 %** | 237.33 GiB | `q44` |
| **Unattributed gap (background workers etc.)** | **18.79 %** | **54.91 GiB** | `q44` minus pgss sum |
| **`pg_stat_wal` total** | 100 % | 292.24 GiB | `q44` |

**Verdict.** The rebuild/projection family Step 3 named as the top write-amplification
target is **3.23 % of WAL since the 2026-11-06 reset** (9.46 GiB combined). Between the
two dated windows its rates fell 10.1 % (rebuild RPC) and 92.1 % (matview projection),
with the rebuild reduction coming from call rate (−18.6 %), not per-call cost. The
dominant producers are unrelated application families — DAM tag/bulk-ops 38.23 % and
HTS RAG ingest 30.05 % — whose totals moved for reasons outside this program (AI-tag
campaign ended; HTS ingest started). **Realtime/logical replication is not a material WAL
generator** (0.005 % own footprint; 141.5 MiB slot retention; zero broadcast rows) and
was not touched. No share below was guessed; every unmeasurable item carries its boundary:

1. **Autovacuum share — not measurable.** Background workers do not submit
   `pg_stat_statements` entries, and no per-vacuum WAL view is exposed to
   `supabase_read_only_user`. User-invoked `VACUUM` statements are 1.46 MB. The 54.91 GiB
   gap is the unattributed floor containing autovacuum + background/internal WAL; it
   cannot be split further read-only. **Boundary: not visible to `supabase_read_only_user`:
   per-maintenance-op WAL (autovacuum/analyze/checkpointer internals).**
2. **Realtime retention ≠ generation.** The two slots retain 141.5 MiB from `restart_lsn`
   (a disk footprint), while Realtime's own generated WAL is ≈14.3 MB. No tuning was
   applied to either.
3. **Subscriber-side lag beyond publisher proxies — not visible to
   `supabase_read_only_user`:** `pg_replication_origin_status` refused 42501
   (`permission denied for function pg_show_replication_origin_status`); Realtime service
   internal queue depth is not exposed. Only confirmed-flush lag (12,111 B / 3.42 MB) is
   visible.
4. **Nested-statement attribution — not available:** `pg_stat_statements.track = top`;
   per-internal-statement WAL splits inside a plpgsql rebuild batch cannot be produced.
5. **WAL per calendar window — not reconstructable:** `pg_stat_wal` is cumulative since
   2026-11-06 11:20:19 EST only (no time-series WAL history in read-only views), and the
   2026-11-13 captures did not record it. Slot-retention/lag figures in §1.2 are
   point-in-time (2026-11-18T03:52Z), not window integrals.
6. **Per-run WAL vs `cron.job_run_details` rows — not available:** `pg_stat_statements`
   carries no timestamps; statement-family rates over the two named windows are the
   strongest correlation the surface supports.

## 4. Compliance record

- Realtime, logical replication, and CDC were **not** disabled or altered at any point —
  not on production, not on preview. The only replication-related statements observed
  were Supabase's own daily `realtime.messages_*` partition DDL (`q51`), untouched.
- No tuning action of any kind: no settings change, no cadence change, no migration, no
  DDL/DML. Every query ran with `read_only: true` as `supabase_read_only_user`.
- Known-measurement facts cited and extended (not redone): the rebuild family's
  4,438 calls / 1,184 ms mean / 5.88 GiB per 7 days figure
  (`docs/verification/database-efficiency/20261113T163700Z-step3-residual/step-3-runtime-measurements.md`;
  also cited in `20261115T213745Z-step-5-split/step-5-split-triage.md`); pg_stat_statements
  reset 2026-11-06 11:20:19 EST with `track=top` — no comparison across that reset is made
  anywhere in this report without saying so.

## SQL appendix (verbatim, all with `read_only: true`)

Raw request/response JSON for each is beside this file as `qNN-*.json` (captured
2026-11-18T03:48Z–04:17Z). `q8`/`q10`/`q17`/`q18`/`q19`/`q21`/`q22`/`q25`/`q26` recorded
SQL errors (column-name misses, later re-run as `q17b`/`q18b`/`q19b`/`q22b`/`q25b`/`q26b`)
or 42501 (`q08`) and are kept as boundary evidence.

```sql
-- q00 identity + current WAL position
select current_user as api_role, current_database() as db,
       (select setting from pg_settings where name='server_version') as server_version,
       now() as captured_at_utc, pg_current_wal_lsn()::text as current_wal_lsn,
       pg_walfile_name(pg_current_wal_lsn()) as current_wal_file;

-- q02 publications
select pubname, pubowner::regrole::text as pubowner, puballtables, pubinsert, pubupdate,
       pubdelete, pubtruncate, pubviaroot from pg_publication order by pubname;

-- q03 publication tables
select pubname, schemaname, tablename from pg_publication_tables
 order by pubname, schemaname, tablename;

-- q04 / q05 / q27 slots + retained/lag bytes
select slot_name, plugin, slot_type, database, temporary, active, active_pid,
       restart_lsn::text, confirmed_flush_lsn::text, wal_status, safe_wal_size,
       two_phase, conflicting, catalog_xmin::text from pg_replication_slots order by slot_name;
select slot_name, plugin, active, restart_lsn::text, confirmed_flush_lsn::text,
       pg_current_wal_lsn()::text as current_wal_lsn,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) as retained_bytes_from_restart,
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) as lag_bytes_from_confirmed,
       wal_status from pg_replication_slots order by slot_name;

-- q06 walsender lag
select pid, application_name, state, sent_lsn::text, write_lsn::text, flush_lsn::text,
       replay_lsn::text, pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn) as lag_bytes_sent,
       write_lag, flush_lag, replay_lag, sync_state from pg_stat_replication;

-- q07 subscriber stats (0 rows) ; q08 origin status (REFUSED 42501)
select * from pg_stat_subscription;
select * from pg_replication_origin_status;

-- q32/q33 realtime channels/config (aggregates + config columns only, no claims contents)
select entity::text as entity, action_filter, claims_role::text as claims_role,
       count(*) as subscriptions, min(created_at) as oldest_created_at,
       max(created_at) as newest_created_at
  from realtime.subscription group by 1,2,3 order by 4 desc;
select count(*) as channel_rows, count(distinct subscription_id) as distinct_subscriptions,
       count(distinct entity) as distinct_entities, min(created_at), max(created_at)
  from realtime.subscription;

-- q53 realtime broadcast rows (count per daily partition, no row contents)
select table_name,
       (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from realtime.%I', table_name), false, true, '')))[1]::text::bigint as row_count
  from information_schema.tables
 where table_schema='realtime' and table_name like 'messages_%' order by table_name;

-- q11 / q44 / q55 WAL totals
select * from pg_stat_wal;
select (select wal_bytes from pg_stat_wal) as pgstatwal_now_bytes,
       (select sum(wal_bytes) from extensions.pg_stat_statements) as pgss_now_bytes,
       now() as now_utc;

-- q15 pgss reset
select stats_reset, dealloc from extensions.pg_stat_statements_info;

-- q18b rebuild/projection family (post column-fix)
select queryid, userid::regrole::text as role_name, left(query, 200) as query_head, calls,
       round(mean_exec_time::numeric, 1) as mean_ms, rows, wal_records, wal_fpi, wal_bytes
  from extensions.pg_stat_statements
 where query ilike '%refresh_style_guide_matviews%' or query ilike '%refresh_style_group_counts%'
    or query ilike '%clear_style_group%' or query ilike '%rebuild_style_group%'
    or query ilike '%style_group_counts%' order by calls desc limit 40;

-- q37 / q41 family aggregation (q41 is the §3 table)
select case
      when query ilike '%hts_rag%' then 'hts_rag_ingest_worker'
      when query ilike '%rebuild_style_group%' then 'rebuild_style_groups_rpc'
      when query ilike '%queue_nightly_rebuild_style_groups%' then 'rebuild_queue_cron'
      when query ilike '%refresh_style_guide_matviews%' or query ilike '%refresh_style_guide_library_default_snapshot%' then 'projection_matview_refresh'
      when query ilike '%clear_style_group%' then 'clear_style_group'
      when query ilike '%realtime.messages%' or query ilike '%realtime\.messages%' then 'realtime_messages_writes'
      when query ilike '%upsert_dam_search_text_embedding%' or query ilike '%claim_sg_search_embedding%' or query ilike '%search_dam_documents%' then 'search_sync_embed'
      when query ilike '%style_guide_files%' or query ilike '%style_guide_render%' then 'style_guide_crawl_import'
      when query ilike '%image_embed%' then 'image_embed_jobs'
      when query ilike '%import_item_master%' then 'plm_item_import'
      when query ilike '%vacuum%' or query ilike 'ANALYZE%' then 'explicit_vacuum_analyze'
      else 'other_application' end as family,
      count(*) as entries, sum(calls) as calls,
      sum(wal_bytes) as wal_bytes, sum(wal_records) as wal_records, sum(wal_fpi) as wal_fpi
  from extensions.pg_stat_statements group by 1 order by sum(wal_bytes)::numeric desc nulls last;

-- q40 top WAL producers (25)
select queryid, userid::regrole::text as role_name, left(query, 420) as query_head, calls,
       round(mean_exec_time::numeric, 1) as mean_ms, rows, wal_bytes
  from extensions.pg_stat_statements order by wal_bytes::numeric desc nulls last limit 25;

-- q51 all realtime-touching pgss entries
select queryid, userid::regrole::text as role_name, left(query, 160) as query_head, calls, rows, wal_bytes
  from extensions.pg_stat_statements where query ilike '%realtime%'
 order by wal_bytes::numeric desc nulls last limit 20;

-- q20 / q34 / q35 cron inventory + run windows
select jobid, schedule, command, database, username, active, jobname from cron.job order by jobid;
select r.jobid, j.jobname, j.schedule, r.status, count(*) as runs,
       min(r.start_time) as first_start, max(r.start_time) as last_start,
       round(avg(extract(epoch from (r.end_time - r.start_time)))::numeric, 1) as avg_duration_s
  from cron.job_run_details r left join cron.job j on j.jobid = r.jobid
 where r.start_time > now() - interval '14 days'
 group by r.jobid, j.jobname, j.schedule, r.status order by r.jobid, r.status;

-- q54 slot-owner activity
select a.pid, a.usename, a.application_name, a.state, a.backend_start, a.state_change,
       left(a.query, 80) as query_head from pg_stat_activity a
 where a.pid in (select active_pid from pg_replication_slots where active_pid is not null);
```

**Window-delta arithmetic** (local, over the two committed capture sets — no new DB
access): for each `queryid` present in both
`docs/verification/database-efficiency/20261113T163700Z-step3-residual/q-pgss-top80.json`
(+ `q-pgss-targeted.json`) and this folder's `q40-pgss-top-wal-full.json` (+ `q18b`),
`delta = now − step3`, then `rate = delta / window_days`. Script output:
`q60-step3-to-now-deltas.json` (30 matched entries).

