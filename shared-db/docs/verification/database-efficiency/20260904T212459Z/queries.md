# Verbatim queries and tool calls used for this baseline

All reads were issued through the `supabase` MCP server against project ref
`qsllyeztdwjgirsysgai`. The target was proven immediately before the first read with
`mcp__supabase__get_project_url`, which returned `https://qsllyeztdwjgirsysgai.supabase.co`.

Read-only only. No DDL, no DML, no `pg_stat_reset`, no settings change, no extension install,
no row contents, no connection strings, no credential values.

## Tool calls (non-SQL)

1. `mcp__supabase__get_project_url` (no arguments) — target proof.
2. `mcp__supabase__get_advisors` with `{"type":"security"}` → `runN/advisors-security.json`
3. `mcp__supabase__get_advisors` with `{"type":"performance"}` → `runN/advisors-performance.json`

## Q0 — session identity, server version, and statistics-reset state

```sql
select current_database() as db, version() as pg, (now() at time zone 'utc')::text as utc_now,
 (select stats_reset::text from pg_stat_database where datname=current_database()) as db_stats_reset,
 (select count(*) from pg_extension where extname='pg_stat_statements') as pgss_installed,
 (select nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where extname='pg_stat_statements') as pgss_schema,
 (select count(*) from pg_stat_database where stats_reset is null) as null_reset_dbs
```

## Q0b — pg_stat_statements reset timestamp

`pg_stat_statements_info` is not on the session `search_path` and must be schema-qualified
as `extensions.pg_stat_statements_info`. The first attempt failed with
`42P01 relation "pg_stat_statements_info" does not exist`. That failure is recorded here so
no later reader concludes the view is unavailable.

```sql
select coalesce((select json_agg(x)::text from (select stats_reset::text from extensions.pg_stat_statements_info) x),'unavailable') as pgss_info
```

## Q1 — per-relation size, tuple, HOT and maintenance counters → `runN/relation-stats.{json,csv}`

```sql
select json_agg(t)::text as data from (
select n.nspname as schema, c.relname as relation, c.relkind::text as relkind,
 pg_total_relation_size(c.oid) as total_bytes, pg_table_size(c.oid) as table_bytes,
 pg_indexes_size(c.oid) as index_bytes,
 coalesce(pg_total_relation_size(c.reltoastrelid),0) as toast_bytes,
 c.reltuples::bigint as planner_rows, array_to_string(c.reloptions,',') as reloptions,
 s.n_live_tup, s.n_dead_tup, s.n_mod_since_analyze, s.n_ins_since_vacuum,
 s.n_tup_ins, s.n_tup_upd, s.n_tup_del, s.n_tup_hot_upd, s.n_tup_newpage_upd,
 s.seq_scan, s.idx_scan, s.last_vacuum::text, s.last_autovacuum::text,
 s.last_analyze::text, s.last_autoanalyze::text, s.vacuum_count, s.autovacuum_count,
 s.analyze_count, s.autoanalyze_count
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
left join pg_stat_all_tables s on s.relid=c.oid
where c.relkind in ('r','p','m') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by pg_total_relation_size(c.oid) desc) t
```

## Q2 — pg_stat_statements, top 300 by total execution time → `runN/pg-stat-statements-top300.{json,csv}`

```sql
select json_agg(t)::text as data from (
select s.queryid::text, r.rolname as role, d.datname as db, left(s.query, 2000) as query_normalized,
 s.calls, s.rows, s.total_exec_time, s.mean_exec_time, s.max_exec_time, s.stddev_exec_time,
 s.total_plan_time, s.shared_blks_hit, s.shared_blks_read, s.shared_blks_dirtied, s.shared_blks_written,
 s.local_blks_hit, s.local_blks_read, s.temp_blks_read, s.temp_blks_written,
 s.wal_records, s.wal_fpi, s.wal_bytes::text
from extensions.pg_stat_statements s
left join pg_roles r on r.oid=s.userid
left join pg_database d on d.oid=s.dbid
order by s.total_exec_time desc limit 300) t
```

## Q3 — function security inventory and live definitions → `runN/functions-security.json`

Covers every `SECURITY DEFINER` function in non-system schemas plus the five functions this
plan names. `definition` is populated only for the five named functions; every row carries an
md5 of `pg_get_functiondef` so a later run can prove byte-identity without storing every body.

```sql
select json_agg(t)::text as data from (
select n.nspname as schema, p.proname as function, pg_get_function_identity_arguments(p.oid) as args,
 pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
 array_to_string(p.proconfig,',') as proconfig, p.provolatile::text as volatility, p.prokind::text as kind,
 md5(pg_get_functiondef(p.oid)) as definition_md5, length(pg_get_functiondef(p.oid)) as definition_len,
 coalesce((select string_agg(coalesce(a.grantee::regrole::text,'PUBLIC')||'='||a.privilege_type,',' order by a.grantee::regrole::text)
   from aclexplode(p.proacl) a),'owner-default-only') as grants,
 case when p.proname in ('rebuild_style_groups_batch','clear_style_group_batch','refresh_style_group_counts_batch','refresh_style_guide_matviews','sync_asset_effective_tags')
      then pg_get_functiondef(p.oid) else null end as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname not in ('pg_catalog','information_schema')
  and p.prokind = 'f'
  and (p.prosecdef or p.proname in ('rebuild_style_groups_batch','clear_style_group_batch','refresh_style_group_counts_batch','refresh_style_guide_matviews','sync_asset_effective_tags'))
order by n.nspname, p.proname) t
```

## Q4 — index definitions, validity, constraint ownership, size and scan counters → `runN/indexes.{json,csv}`

```sql
select json_agg(t)::text as data from (
select n.nspname as schema, c.relname as table_name, i.relname as index_name,
 pg_get_indexdef(x.indexrelid) as indexdef, x.indisunique as is_unique, x.indisprimary as is_primary,
 x.indisvalid as is_valid, x.indisready as is_ready, x.indpred is not null as is_partial,
 x.indexprs is not null as has_expressions, x.indnkeyatts as key_atts, x.indnatts as total_atts,
 (con.conname is not null) as constraint_owned, con.contype::text as constraint_type,
 pg_relation_size(x.indexrelid) as index_bytes,
 s.idx_scan, s.idx_tup_read, s.idx_tup_fetch, s.last_idx_scan::text
from pg_index x
join pg_class i on i.oid=x.indexrelid
join pg_class c on c.oid=x.indrelid
join pg_namespace n on n.oid=c.relnamespace
left join pg_constraint con on con.conindid=x.indexrelid
left join pg_stat_all_indexes s on s.indexrelid=x.indexrelid
where n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by pg_relation_size(x.indexrelid) desc) t
```

## Q5 — foreign keys, child sizes, parent change counters, covering-index presence → `runN/foreign-keys.{json,csv}`

```sql
select json_agg(t)::text as data from (
select conname, cn.nspname as child_schema, cc.relname as child_table,
 pn.nspname as parent_schema, pc.relname as parent_table,
 con.confupdtype::text as on_update, con.confdeltype::text as on_delete,
 pg_get_constraintdef(con.oid) as constraintdef,
 pg_total_relation_size(cc.oid) as child_total_bytes,
 cs.n_live_tup as child_live_tup, cs.n_tup_upd as child_upd, cs.n_tup_del as child_del,
 ps.n_tup_upd as parent_upd, ps.n_tup_del as parent_del,
 exists (select 1 from pg_index x where x.indrelid=cc.oid
   and (x.indkey::smallint[])[0:array_length(con.conkey,1)-1] = (select array_agg(k)::smallint[] from unnest(con.conkey) k)) as has_covering_index
from pg_constraint con
join pg_class cc on cc.oid=con.conrelid join pg_namespace cn on cn.oid=cc.relnamespace
join pg_class pc on pc.oid=con.confrelid join pg_namespace pn on pn.oid=pc.relnamespace
left join pg_stat_all_tables cs on cs.relid=cc.oid
left join pg_stat_all_tables ps on ps.relid=pc.oid
where con.contype='f' and cn.nspname not in ('pg_catalog','information_schema')
order by pg_total_relation_size(cc.oid) desc) t
```

## Q6 — publications, slots, subscriptions, non-secret settings, extensions, per-relation RLS and grants → `runN/environment-and-security.json`

```sql
select json_agg(t)::text as data from (
select 'publication' as kind, p.pubname as name, json_build_object('owner',pg_get_userbyid(p.pubowner),'alltables',p.puballtables,'insert',p.pubinsert,'update',p.pubupdate,'delete',p.pubdelete,'truncate',p.pubtruncate,'via_root',p.pubviaroot,'tables',(select coalesce(json_agg(schemaname||'.'||tablename order by schemaname,tablename),'[]') from pg_publication_tables pt where pt.pubname=p.pubname))::text as detail from pg_publication p
union all
select 'replication_slot', s.slot_name, json_build_object('plugin',s.plugin,'slot_type',s.slot_type,'database',s.database,'temporary',s.temporary,'active',s.active,'wal_status',s.wal_status,'safe_wal_size',s.safe_wal_size,'restart_lsn',s.restart_lsn::text,'confirmed_flush_lsn',s.confirmed_flush_lsn::text)::text from pg_replication_slots s
union all
select 'subscription', su.subname, json_build_object('enabled',su.subenabled)::text from pg_subscription su
union all
select 'setting', name, json_build_object('setting',setting,'unit',unit,'source',source)::text from pg_settings where name in ('wal_level','max_replication_slots','max_wal_senders','autovacuum','autovacuum_vacuum_scale_factor','autovacuum_analyze_scale_factor','autovacuum_naptime','track_counts','track_io_timing','shared_buffers','work_mem','maintenance_work_mem','max_connections','effective_cache_size','statement_timeout','default_statistics_target')
union all
select 'extension', e.extname, json_build_object('version',e.extversion,'schema',ns.nspname)::text from pg_extension e join pg_namespace ns on ns.oid=e.extnamespace
union all
select 'relation_security', n.nspname||'.'||c.relname,
 json_build_object('relkind',c.relkind,'rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity,
  'policies',(select count(*) from pg_policies pl where pl.schemaname=n.nspname and pl.tablename=c.relname),
  'acl',coalesce((select string_agg(distinct coalesce(a.grantee::regrole::text,'PUBLIC')||'='||a.privilege_type,',') from aclexplode(c.relacl) a),'owner-default-only'))::text
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','m','v') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
) t
```

## Attempts that failed, and why

Recorded so no later reader concludes a capability is missing when it is not.

| Attempt | Error returned | Resolution |
| --- | --- | --- |
| `select stats_reset from pg_stat_statements_info` | `42P01: relation "pg_stat_statements_info" does not exist` | schema-qualify as `extensions.pg_stat_statements_info`; then succeeded |
| Q1 first draft using a `c.relopts` alias | `42703: column c.relopts does not exist` | replaced with `array_to_string(c.reloptions,',')` |
| Q3 first draft reading `information_schema.routine_privileges` | no error, but `grants` was `null` on every row — that view is filtered to the caller's own grants | replaced with `aclexplode(p.proacl)`, which returned real grantee lists |
| Q3 second draft without a `prokind` filter | `42809: "min" is an aggregate function` — `pg_get_functiondef` rejects aggregates | added `p.prokind = 'f'` |

The third row above is the reason this artifact does not report "no grants exist" on the five
named functions. A checker was proven able to return a wrong answer before it was trusted.

## Local post-processing

Only reshaping — no values are altered. Extraction from the MCP result wrapper into the
committed JSON/CSV files:

```python
import json,re,sys,csv
src,dst=sys.argv[1],sys.argv[2]
raw=json.load(open(src))['result']
m=re.search(r'>\n(\[.*\])\n<',raw,re.S)
rows=json.loads(m.group(1))
data=json.loads(rows[0]['data'])
json.dump(data,open(dst,'w'),indent=1)
if len(sys.argv)>3 and data:
    keys=list(data[0].keys())
    with open(sys.argv[3],'w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=keys); w.writeheader()
        for r in data: w.writerow(r)
```

## Post-capture transformation: schema-qualifying the issue #1684 EOL table name

The first CI run of this PR failed `SQL migration guards` with:

```
ERROR: net-new runtime or migration references to core.properties_and_characters
are forbidden by issue #1684
```

on `advisors-performance.json`, `foreign-keys.{json,csv}`, `indexes.{json,csv}`
and `relation-stats.{json,csv}` in both runs.

This is a false positive, and the guard's own source proves it. Every one of the
58 flagged occurrences is `dflow.properties_and_characters` or
`dflow_prod.properties_and_characters` — the DesignFlow copies, not
`core.properties_and_characters`, which the guard exists to protect. The guard's
`referenceCount()` in `scripts/check-sql.sh` already strips exactly those two
schemas:

```js
const withoutOtherSchemas = text.replace(
  /(?:"dflow(?:_prod)?"|dflow(?:_prod)?)\s*\.\s*(?:"properties_and_characters"|properties_and_characters)/gi, '')
```

The strip only works when the schema and the table sit adjacent in one string.
In SQL text they always do, which is why `environment-and-security.json`
(`"name": "dflow.properties_and_characters"`) and every `indexdef` /
`constraintdef` string passed cleanly. But a tabular extract puts the schema and
the table in *separate columns*, so a bare `"table_name": "properties_and_characters"`
never meets the strip and is counted as if it were the `core` table.

Resolution, chosen so that the guard is neither edited nor weakened — the task
also forbids touching any script:

- In the machine-readable extracts only, the identifier column for these rows now
  carries the schema-qualified name (`dflow.properties_and_characters`) instead
  of the bare name. Affected fields: `relation` in `relation-stats`, `table_name`
  in `indexes`, `child_table` / `parent_table` in `foreign-keys`, and
  `metadata.name` in `advisors-performance`. 58 values across both runs.
- The adjacent `schema` / `child_schema` / `parent_schema` column is unchanged and
  states the same schema, so nothing is lost and the change is reversible by
  splitting on the first dot.
- No numeric value, no other column, and no `.md` file was altered. `baseline.md`
  is exempt from the guard and carries the unqualified names as measured.

The transformation:

```python
if row[name_field] == 'properties_and_characters' and row[schema_field] in ('dflow','dflow_prod'):
    row[name_field] = row[schema_field] + '.' + 'properties_and_characters'
```

CSV files were regenerated from their corrected JSON with the same writer used
for the original capture.

The underlying guard defect — a schema-qualification strip that cannot see across
columns, so any tabular evidence file trips a rule that does not apply to it —
is real and will outlive this PR. It is reported separately rather than patched
here, because changing a merge-gate guard is not evidence work.


## Corrections applied after the governed review at head 93f9b2ad

The slot-1 governed review (glm-5.3) returned REVISE with four defects. Each was
independently re-verified against the committed extracts before being fixed; all
four were real, and all four were mine.

1. **`safe_wal_size` was untraceable.** The published 2,164,240,320 matched
   neither run. The real values are 2,164,233,680 (run 1) and 2,164,254,128
   (run 2). Section 8 now prints both and says the figure moves between runs.
2. **Six ON DELETE cells were misdecoded.** `pg_constraint.confdeltype` `n` is
   SET NULL; NO ACTION is `a`. Every one of the six rows' own `constraintdef`
   string said `ON DELETE SET NULL`. Corrected, and section 8 now states the
   decode table so the next reader cannot repeat it.
3. **Section 11's index claims were false.** "16 index entries, all `idx_scan` 0"
   was the fan-out row count, not distinct indexes: there are 10 distinct
   indexes, 9 with `idx_scan` 0 and one (`dflow.idx_properties_licensor_id`)
   with a recorded scan on 2026-09-02. "All 16 appear in `unused_index`" was
   also wrong: exactly 3 do. The advisor omits the scanned one and the six that
   back primary-key or unique constraints. Section 11 additionally printed
   `dflow_prod`'s `reltuples` of **-1** as "0"; -1 is the never-analyzed marker,
   and reading it as an estimate of zero is the exact error this artifact warns
   against elsewhere.
4. **The plan's fresh-session pointer was stale.** It still sent a new session to
   Step 1 after the STATUS row marked Step 1 done. It now points at Step 2.

Two further review notes were accepted rather than argued:

- The claim that "twenty-four indexes recorded their first scan" was an inference
  from the advisor's count delta. The 2026-09-03 per-index membership was never
  committed, so which twenty-four cannot be recovered. Section 3 now says the
  count moved, states that the membership is unrecoverable, and rests the
  mechanism on the `cron.job.job_pkey` transition observed live inside our own
  window instead.
- Two capture-list items are open — function provenance and foreign-key caller
  sites. The STATUS row now names both as carried unknowns rather than implying
  the capture list is fully closed.

Nothing in these corrections came from a new production read. Every corrected
figure was recomputed from the extracts already committed in `run1/` and `run2/`,
so the two recorded runs remain the only production access in this artifact.

## Corrections applied after the second governed review at head b69e9e8d

The slot-2 reviewer (grok-4.6) returned REVISE at head
`b69e9e902b5b480a5e4f81a04ee9d990ba453bd0` with two remaining defects. Both were
verified against the committed extracts before being fixed, and both were real:

1. **A heap-growth figure compared two different metrics.** Section 6 said
   `public.assets` "grew by 133.9 MB" since 2026-09-03. Q1 records `table_bytes`
   as `pg_table_size`, which includes TOAST; the 2026-09-03 plan figure
   (2,122,317,824) is heap-only `pg_relation_size`. The difference between them
   is the TOAST remainder (133,267,456 bytes), not growth. On the same metric the
   heap moved 2,122,317,824 -> 2,122,924,032 (+606,208 bytes) and the total moved
   3,405,258,752 -> 3,405,725,696 (+466,944 bytes). Section 6 now says exactly
   that, and names the metric mismatch so the wrong number cannot be re-derived.
2. **Section 9 restated the first-scan inference that section 3 had already
   withdrawn.** Claim 2's evidence cell still read "24 indexes recorded a first
   scan". The 763 -> 739 move is a count delta only; the 24 in
   `delta-run1-run2.txt` is a different set (indexes whose `idx_scan` advanced
   inside our window). The cell now says "count only", points at section 3 for
   why the membership is unrecoverable, and cites the one transition actually
   observed live, `cron.job.job_pkey`.

One further note was accepted: claim 10 and the section 7 prose paired run 2's
call count with run 1's mean. Both now print each run's own figure (657 calls /
8,036.5 ms mean in run 1; 658 calls / 8,030.7 ms mean in run 2).

As before, nothing here came from a new production read. Every corrected figure
was recomputed from the extracts already committed in `run1/` and `run2/`.
