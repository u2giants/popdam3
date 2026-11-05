# Issue #5609 actual production application and timed acceptance

Automatic production run [41974228042](https://github.com/popcre/shared-db/actions/runs/41974228042) successfully committed immutable migration `20261105033827` on the CBA source. Its subsequent catalog-verification step failed because the existing migration lexer recognizes no trigger objects. At initial capture this was **applied SQL with unfinished verifier recovery**, not a migration failure to replay. That recovery is now verified by successful run 41979854831 after PR #5642; the original failed run remains unchanged. Do not reapply, rerun, edit the applied migration, or fabricate a green original deployment result.

## Immediate read-only facts

The current production target was proved immediately before each query. The existing execution identity was `supabase_read_only_user`; no production writes or new grants were used.

- The earliest post-apply acceptance baseline was captured November 5, 2026, **12:36:57.465690 AM EST**. Its exact query entry and counter/reset/start identities are below.
- The coordinator's independent production read at **12:37 AM EST** found zero primary-thumbnail cache drift. This result is attributed to that read rather than presenting the later timed-out combined query as successful.
- A separate catalog read at **12:41:10 AM EST** confirmed the ledger row, all five scoped enabled UPDATE definitions, all five original INSERT/DELETE sibling behaviors, and the untouched original image-embedding trigger.
- A bounded deterministic sample read at **12:43:17 AM EST** compared three active assets scanned within the preceding 24 hours and found their complete current metadata equal to their stored search documents. Their scan timestamps predate the application; this is **current metadata consistency**, not proof of a new post-apply write path. The future timed probe separately requires three post-baseline recent samples.

The original combined cache/last-seen-sort read hit the existing statement budget. It was split; the metadata sample avoids a whole-table unindexed last-seen sort. No timeout was increased and no index or function changed for the read.

## Immutable post-application baseline

```json
{
  "tables": [
    {
      "relid": "17809",
      "relname": "assets",
      "n_tup_upd": "124808",
      "n_dead_tup": "7887",
      "n_live_tup": "150193",
      "n_tup_hot_upd": "70263"
    },
    {
      "relid": "713489",
      "relname": "dam_search_documents",
      "n_tup_upd": "101273",
      "n_dead_tup": "41464",
      "n_live_tup": "147282",
      "n_tup_hot_upd": "16419"
    }
  ],
  "main_query": [
    {
      "dbid": "5",
      "calls": "23226",
      "userid": "16486",
      "queryid": "8695287796313115953",
      "toplevel": true,
      "wal_bytes": "1380322805",
      "stats_since": "2026-11-04T12:53:41.28733-05:00",
      "total_exec_time": "6700401.86598603"
    }
  ],
  "observed_at": "2026-11-05T00:36:57.46569-05:00",
  "all_asset_patches": [
    {
      "dbid": "5",
      "calls": "101",
      "userid": "16486",
      "queryid": "-3507091764867901600",
      "toplevel": true,
      "wal_bytes": "4825968",
      "stats_since": "2026-11-04T17:00:11.393679-05:00",
      "total_exec_time": "8397.971909"
    },
    {
      "dbid": "5",
      "calls": "23226",
      "userid": "16486",
      "queryid": "8695287796313115953",
      "toplevel": true,
      "wal_bytes": "1380322805",
      "stats_since": "2026-11-04T12:53:41.28733-05:00",
      "total_exec_time": "6700401.86598603"
    },
    {
      "dbid": "5",
      "calls": "1",
      "userid": "16486",
      "queryid": "-5353890463906428388",
      "toplevel": true,
      "wal_bytes": "77886",
      "stats_since": "2026-11-04T18:40:46.742092-05:00",
      "total_exec_time": "54.48421"
    },
    {
      "dbid": "5",
      "calls": "7173",
      "userid": "16486",
      "queryid": "-2200186808143858685",
      "toplevel": true,
      "wal_bytes": "356981031",
      "stats_since": "2026-11-04T12:53:19.458771-05:00",
      "total_exec_time": "1908871.701106"
    },
    {
      "dbid": "5",
      "calls": "25",
      "userid": "16486",
      "queryid": "-4258679261381200171",
      "toplevel": true,
      "wal_bytes": "1147973",
      "stats_since": "2026-11-04T17:12:26.0586-05:00",
      "total_exec_time": "5299.708669"
    },
    {
      "dbid": "5",
      "calls": "33",
      "userid": "16486",
      "queryid": "-5438723947593814594",
      "toplevel": true,
      "wal_bytes": "1680369",
      "stats_since": "2026-11-04T17:01:00.679731-05:00",
      "total_exec_time": "3558.720786"
    },
    {
      "dbid": "5",
      "calls": "1807",
      "userid": "16486",
      "queryid": "-640555994218644254",
      "toplevel": true,
      "wal_bytes": "151497816",
      "stats_since": "2026-11-04T16:37:56.308615-05:00",
      "total_exec_time": "163150.097901"
    },
    {
      "dbid": "5",
      "calls": "2",
      "userid": "16486",
      "queryid": "-4489082252313461571",
      "toplevel": true,
      "wal_bytes": "144748",
      "stats_since": "2026-11-04T13:36:10.693662-05:00",
      "total_exec_time": "64.398165"
    },
    {
      "dbid": "5",
      "calls": "33",
      "userid": "16486",
      "queryid": "6812761708967041595",
      "toplevel": true,
      "wal_bytes": "2122467",
      "stats_since": "2026-11-04T13:17:45.698753-05:00",
      "total_exec_time": "1729.849443"
    },
    {
      "dbid": "5",
      "calls": "281",
      "userid": "16486",
      "queryid": "-6408571764798647371",
      "toplevel": true,
      "wal_bytes": "19560539",
      "stats_since": "2026-11-04T13:17:48.389503-05:00",
      "total_exec_time": "174330.21509"
    },
    {
      "dbid": "5",
      "calls": "1",
      "userid": "16486",
      "queryid": "-9172451651300148137",
      "toplevel": true,
      "wal_bytes": "34307",
      "stats_since": "2026-11-04T13:01:45.435126-05:00",
      "total_exec_time": "13.104645"
    },
    {
      "dbid": "5",
      "calls": "340",
      "userid": "16486",
      "queryid": "6430535887002143036",
      "toplevel": true,
      "wal_bytes": "15481518",
      "stats_since": "2026-11-04T16:39:02.542166-05:00",
      "total_exec_time": "25166.914636"
    },
    {
      "dbid": "5",
      "calls": "17",
      "userid": "16486",
      "queryid": "6862715532547800613",
      "toplevel": true,
      "wal_bytes": "448005",
      "stats_since": "2026-11-04T12:53:36.313001-05:00",
      "total_exec_time": "209.016175"
    },
    {
      "dbid": "5",
      "calls": "3",
      "userid": "16486",
      "queryid": "-4910506429341774761",
      "toplevel": true,
      "wal_bytes": "21696",
      "stats_since": "2026-11-04T13:17:50.047113-05:00",
      "total_exec_time": "3.519845"
    },
    {
      "dbid": "5",
      "calls": "1",
      "userid": "16486",
      "queryid": "6907289670067793425",
      "toplevel": true,
      "wal_bytes": "27370",
      "stats_since": "2026-11-05T00:28:27.130328-05:00",
      "total_exec_time": "53.826491"
    }
  ],
  "database_stats_reset": null,
  "postmaster_started_at": "2026-11-04T12:52:59.286785-05:00",
  "statement_stats_reset": "2026-11-04T12:52:59.176055-05:00"
}
```

The main statement is pinned to query ID `8695287796313115953`, user OID `16486`, database OID `5`, top-level true, and its own `stats_since`. Exact large integers are strings in this record. The later calculation subtracts these counters; cumulative means do not establish the post-apply interval. The earlier real document-write rate remains `8829 / 5050.846546` updates per second, preserved in `assets-trigger-scoping-pre-apply-rate.md`.

## Actual installed trigger definitions

```json
{
  "observed_at": "2026-11-05T00:41:10.367622-05:00",
  "migration_recorded": true,
  "trigger_definitions": [
    {
      "name": "trg_assets_enqueue_image_embed",
      "type": 21,
      "enabled": "O",
      "predicate": false,
      "definition": "CREATE TRIGGER trg_assets_enqueue_image_embed AFTER INSERT OR UPDATE OF thumbnail_url ON public.assets FOR EACH ROW EXECUTE FUNCTION dam.assets_enqueue_image_embed_trg_fn()"
    },
    {
      "name": "trg_auto_queue_render",
      "type": 17,
      "enabled": "O",
      "predicate": true,
      "definition": "CREATE TRIGGER trg_auto_queue_render AFTER UPDATE ON public.assets FOR EACH ROW WHEN (((((old.id IS DISTINCT FROM new.id) OR (old.thumbnail_error IS DISTINCT FROM new.thumbnail_error)) OR (old.thumbnail_url IS DISTINCT FROM new.thumbnail_url)) OR (old.filename IS DISTINCT FROM new.filename))) EXECUTE FUNCTION auto_queue_render()"
    },
    {
      "name": "trg_auto_queue_render_ins_del",
      "type": 5,
      "enabled": "O",
      "predicate": false,
      "definition": "CREATE TRIGGER trg_auto_queue_render_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION auto_queue_render()"
    },
    {
      "name": "trg_dam_search_assets_refresh",
      "type": 17,
      "enabled": "O",
      "predicate": true,
      "definition": "CREATE TRIGGER trg_dam_search_assets_refresh AFTER UPDATE ON public.assets FOR EACH ROW WHEN (((((((((((((((((((((((old.id IS DISTINCT FROM new.id) OR (old.filename IS DISTINCT FROM new.filename)) OR (old.relative_path IS DISTINCT FROM new.relative_path)) OR (old.content_type IS DISTINCT FROM new.content_type)) OR (old.cover_description IS DISTINCT FROM new.cover_description)) OR (old.ai_description IS DISTINCT FROM new.ai_description)) OR (old.scene_description IS DISTINCT FROM new.scene_description)) OR (old.customer IS DISTINCT FROM new.customer)) OR (old.program IS DISTINCT FROM new.program)) OR (old.licensor_name IS DISTINCT FROM new.licensor_name)) OR (old.property_name IS DISTINCT FROM new.property_name)) OR (old.product_category IS DISTINCT FROM new.product_category)) OR (old.product_material IS DISTINCT FROM new.product_material)) OR (old.product_dimensions IS DISTINCT FROM new.product_dimensions)) OR (old.thumbnail_url IS DISTINCT FROM new.thumbnail_url)) OR (old.file_type IS DISTINCT FROM new.file_type)) OR (old.asset_type IS DISTINCT FROM new.asset_type)) OR (old.workflow_status IS DISTINCT FROM new.workflow_status)) OR (old.is_licensed IS DISTINCT FROM new.is_licensed)) OR (old.style_group_id IS DISTINCT FROM new.style_group_id)) OR (old.is_deleted IS DISTINCT FROM new.is_deleted)) OR (old.modified_at IS DISTINCT FROM new.modified_at))) EXECUTE FUNCTION trg_refresh_dam_asset_search_document()"
    },
    {
      "name": "trg_dam_search_assets_refresh_ins_del",
      "type": 13,
      "enabled": "O",
      "predicate": false,
      "definition": "CREATE TRIGGER trg_dam_search_assets_refresh_ins_del AFTER INSERT OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION trg_refresh_dam_asset_search_document()"
    },
    {
      "name": "trg_sync_cover_description_to_style_group",
      "type": 17,
      "enabled": "O",
      "predicate": true,
      "definition": "CREATE TRIGGER trg_sync_cover_description_to_style_group AFTER UPDATE ON public.assets FOR EACH ROW WHEN ((((old.cover_description IS DISTINCT FROM new.cover_description) OR (old.style_group_id IS DISTINCT FROM new.style_group_id)) OR (old.is_deleted IS DISTINCT FROM new.is_deleted))) EXECUTE FUNCTION sync_cover_description_to_style_group()"
    },
    {
      "name": "trg_sync_cover_description_to_style_group_ins_del",
      "type": 5,
      "enabled": "O",
      "predicate": false,
      "definition": "CREATE TRIGGER trg_sync_cover_description_to_style_group_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION sync_cover_description_to_style_group()"
    },
    {
      "name": "trg_sync_designer_to_style_group",
      "type": 17,
      "enabled": "O",
      "predicate": true,
      "definition": "CREATE TRIGGER trg_sync_designer_to_style_group AFTER UPDATE ON public.assets FOR EACH ROW WHEN ((((((old.designer_name IS DISTINCT FROM new.designer_name) OR (old.technical_designer_name IS DISTINCT FROM new.technical_designer_name)) OR (old.freelancer_name IS DISTINCT FROM new.freelancer_name)) OR (old.style_group_id IS DISTINCT FROM new.style_group_id)) OR (old.is_deleted IS DISTINCT FROM new.is_deleted))) EXECUTE FUNCTION sync_designer_to_style_group()"
    },
    {
      "name": "trg_sync_designer_to_style_group_ins_del",
      "type": 5,
      "enabled": "O",
      "predicate": false,
      "definition": "CREATE TRIGGER trg_sync_designer_to_style_group_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION sync_designer_to_style_group()"
    },
    {
      "name": "trg_sync_primary_on_thumbnail",
      "type": 17,
      "enabled": "O",
      "predicate": true,
      "definition": "CREATE TRIGGER trg_sync_primary_on_thumbnail AFTER UPDATE ON public.assets FOR EACH ROW WHEN ((((((old.id IS DISTINCT FROM new.id) OR (old.thumbnail_url IS DISTINCT FROM new.thumbnail_url)) OR (old.thumbnail_error IS DISTINCT FROM new.thumbnail_error)) OR (old.style_group_id IS DISTINCT FROM new.style_group_id)) OR (old.asset_type IS DISTINCT FROM new.asset_type))) EXECUTE FUNCTION sync_primary_asset_on_thumbnail()"
    },
    {
      "name": "trg_sync_primary_on_thumbnail_ins_del",
      "type": 5,
      "enabled": "O",
      "predicate": false,
      "definition": "CREATE TRIGGER trg_sync_primary_on_thumbnail_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION sync_primary_asset_on_thumbnail()"
    }
  ]
}
```

## Current metadata sample

```json
{
  "checked": 3,
  "sampling": "fixed SYSTEM1%, seed5609, first3 active assets scanned within24h; no IDs/values exported",
  "latest_scan": "2026-11-04T20:10:14.465-05:00",
  "observed_at": "2026-11-05T00:43:17.665003-05:00",
  "oldest_scan": "2026-11-04T04:27:34.776-05:00",
  "all_metadata_match": true
}
```

## November 5 resumed functional proof and INTERIM counters

The [same issue's signed custody receipt](https://github.com/popcre/shared-db/issues/5609#issuecomment-6657431242) records renewed production reads through the existing read-only identity, with the production project URL proved immediately before each query. No database writes, grants, baseline replacement, or acceptance changes occurred.

At **6:57:23 AM EST**, the fixed SYSTEM 1%, seed 5609 sample explicitly required `last_seen_at` at or after the immutable post-application baseline and within the latest 24 hours. Three qualifying active assets had complete current metadata matching their search documents. Unlike the historical 12:43 AM sample above, these are genuine **post-baseline** scans. No sample IDs, licensed values, or individual rows were exported. Sampling proves these three matches, not every asset or every possible write path.

```json
{
  "observed_at": "2026-11-05T06:57:23.852279-05:00",
  "exact_scoped_trigger_bindings": 10,
  "primary_thumbnail_cache_drift": 0,
  "post_baseline_metadata_samples": 3,
  "all_sample_metadata_match": true
}
```

The ten-binding read compared names, event types, function identities, enabled states, empty column restrictions, and the committed full-definition prefix hashes. The indexed primary-asset cache comparison found no differing thumbnail/error cache. These are current functional observations; they do not satisfy the elapsed-time or performance gates.

A separate counter snapshot at **6:55:08 AM EST** retained the original context unchanged: query ID `8695287796313115953`, role `16486`, database `5`, top-level identity true, query-entry start `2026-11-04T12:53:41.28733-05:00`, statement reset `2026-11-04T12:52:59.176055-05:00`, postmaster start `2026-11-04T12:52:59.286785-05:00`, and database reset null. Relevant counters remained monotonic and the migration remained recorded.

```json
{
  "observed_at": "2026-11-05T06:55:08.117682-05:00",
  "elapsed_seconds": 22690.651992,
  "full_day_elapsed": false,
  "main_query_calls": "41241",
  "main_query_total_exec_time_ms": "7169124.09813605",
  "main_query_wal_bytes": "1608112723",
  "asset_updates": "230244",
  "search_document_updates": "171499",
  "interval_calls": 18015,
  "INTERIM_interval_mean_ms": 26.0184419733567,
  "INTERIM_interval_wal_bytes_per_call": 12644.458395781294,
  "interval_document_updates": 70226,
  "INTERIM_document_updates_per_second": 3.0949309003883823
}
```

The interim per-call observations are below half the frozen pre-change references, but are **not full-day acceptance**. The interim global document-update rate is **above**, not below, the frozen `8829 / 5050.846546` reference (approximately 1.74803/s). That acceptance condition remains unsatisfied. The baseline and thresholds remain unchanged. Earliest full-interval eligibility is **November 6, 2026, 12:36:57 AM EST**; the supported strict probe and actual full-day result remain pending. Step 4's unmet hosted WAL target and all earlier negative measurements remain intact.

### Exact SQL used for the 6:57:23 AM EST functional receipt

This is the exact query text retained from the execution that returned the aggregate `functional_state` receipt above, not a later equivalent query. It was generated from the committed issue probe by retaining its CTEs and replacing its final acceptance SELECT with the aggregate functional SELECT below. The retained text SHA-256 is `1ff80587a313e4abe8dc87ddc64b2863de7d3867a65ba187adcfbb77c2a0ee44` (including the trailing newline). The target URL check immediately preceding this execution identified the production project; the receipt reports `2026-11-05T06:57:23.852279-05:00`. No new query was run to write this correction.

The `recent` CTE explicitly compares `last_seen_at` with `greatest(b.observed_at, now() - interval '24 hours')` and excludes future timestamps. That is the source of the post-baseline qualification. The older “Exact bounded current-metadata sample” query below belongs to the historical 12:43:17 AM EST consistency sample; it lacks this baseline condition and does not substantiate the newer post-baseline receipt.

```sql
-- #5609 read-only acceptance. Post-apply baseline observed November 5, 2026,
-- 12:36:57 AM EST after automatic run41974228042 applied the immutable source.
-- Its catalog-recovery verification remains distinct; never reapply this source.
-- Frozen pre-change main PATCH baseline: November 4, 2026, 10:37 PM EST.
-- Frozen document rate: 8,829 updates / 5,050.846546 seconds, ending
-- November 5, 2026, 12:01:25 AM EST, while the migration was still absent.
-- No writes, timers, helpers, grants, or relaxed limits are introduced.
with baseline as (
 select
   '2026-11-05T00:36:57.46569-05:00'::timestamptz as observed_at,
   '2026-11-04T12:52:59.176055-05:00'::timestamptz as statement_stats_reset,
   '2026-11-04T12:53:41.28733-05:00'::timestamptz as entry_stats_since,
   null::timestamptz as database_stats_reset,
   '2026-11-04T12:52:59.286785-05:00'::timestamptz as postmaster_started_at,
   23226::bigint as calls,
   6700401.86598603::numeric as total_exec_time,
   1380322805::numeric as wal_bytes,
   124808::bigint as asset_updates,
   101273::bigint as document_updates,
   170.077045367033::numeric as pre_mean_ms,
   59888.980667756245::numeric as pre_wal_per_call,
   (8829::numeric / 5050.846546::numeric) as pre_document_updates_per_second
), query_stats as (
 select calls,total_exec_time,wal_bytes,stats_since
 from extensions.pg_stat_statements
 where queryid='8695287796313115953'::bigint
   and userid='16486'::oid and dbid='5'::oid and toplevel
), table_stats as (
 select
  (select n_tup_upd from pg_stat_user_tables where relid='public.assets'::regclass) as asset_updates,
  (select n_tup_upd from pg_stat_user_tables where relid='public.dam_search_documents'::regclass) as document_updates
), expected as (
 select * from (values
  ('trg_auto_queue_render','public.auto_queue_render()',17,'6d292c5ad846cc05bb3290b926bf1d20'),
  ('trg_auto_queue_render_ins_del','public.auto_queue_render()',5,'caa4f524dd84c8e24d36fc8d68c59c89'),
  ('trg_dam_search_assets_refresh','public.trg_refresh_dam_asset_search_document()',17,'3adf740fb4f20406f6620052b23e28c3'),
  ('trg_dam_search_assets_refresh_ins_del','public.trg_refresh_dam_asset_search_document()',13,'9fb1930126a935df0ff11d05bbcfdd4b'),
  ('trg_sync_cover_description_to_style_group','public.sync_cover_description_to_style_group()',17,'dac32eaf299fd77dfa9ac6827a18211a'),
  ('trg_sync_cover_description_to_style_group_ins_del','public.sync_cover_description_to_style_group()',5,'b4ddc43b9e60e91649c6fca65ad10f6e'),
  ('trg_sync_designer_to_style_group','public.sync_designer_to_style_group()',17,'a2037258e3fd300113b8489f25ee62a9'),
  ('trg_sync_designer_to_style_group_ins_del','public.sync_designer_to_style_group()',5,'24a12b32508aee5a6b24075d011e6897'),
  ('trg_sync_primary_on_thumbnail','public.sync_primary_asset_on_thumbnail()',17,'224aa60d20a0b9f58a052b6f603598b8'),
  ('trg_sync_primary_on_thumbnail_ins_del','public.sync_primary_asset_on_thumbnail()',5,'f7870cdb13d8aedf4901696cf1bc5622')
 )e(trigger_name,function_name,event_type,definition_md5)
), recent as (
 select a.* from public.assets a tablesample system(1) repeatable(5609) cross join baseline b
 where not a.is_deleted and a.last_seen_at>=greatest(b.observed_at,now()-interval '24 hours')
   and a.last_seen_at<=now() limit 3
), current_metadata as (
 select count(*) as checked,
  bool_and(d.metadata is not distinct from jsonb_strip_nulls(jsonb_build_object(
   'file_type',a.file_type,'asset_type',a.asset_type,'content_type',a.content_type,
   'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
   'product_material',a.product_material,'product_dimensions',a.product_dimensions,
   'workflow_status',a.workflow_status,'is_licensed',a.is_licensed,
   'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
   'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
   'product_category',a.product_category,'thumbnail_url',a.thumbnail_url))) as all_match
 from recent a left join public.style_groups sg on sg.id=a.style_group_id
 left join public.dam_search_documents d on d.document_type='asset' and d.entity_id=a.id
)
select jsonb_build_object('observed_at',now(),'metadata',(select to_jsonb(m) from current_metadata m),'exact_bindings', (select count(*) from expected e join pg_trigger t on t.tgrelid='public.assets'::regclass and t.tgname=e.trigger_name and t.tgfoid=to_regprocedure(e.function_name) and t.tgtype=e.event_type and t.tgenabled='O' and t.tgattr=''::int2vector and md5(split_part(pg_get_triggerdef(t.oid,false),' EXECUTE FUNCTION ',1))=e.definition_md5),'drift',(select count(*) from public.style_groups sg join lateral(select a.thumbnail_url,a.thumbnail_error from public.assets a where a.id=sg.primary_asset_id limit 1)a on true where sg.primary_asset_id is not null and (sg.primary_thumbnail_url is distinct from a.thumbnail_url or sg.primary_thumbnail_error is distinct from a.thumbnail_error))) as functional_state;
```

### Additional writer context and attribution limits

Live function definitions confirm that embedding claim updates each claimed document's lease and attempt fields, while embedding completion updates the document's embedding and clears its lease/error state when the lease/hash checks match. These necessary writes are independent of the five asset refresh trigger predicates. A separate cumulative statement read found:

- Embedding completion: query `-3429311119090818236`, role `21299579`, 26,700 calls, 1,576,127,642 WAL bytes; statement fingerprint `9d18467618cac28f659a1a4e7e97ae17`.
- Embedding claim: query `-1110672999031308294`, role `21299579`, 5,535 calls, 118,663,053 WAL bytes; statement fingerprint `7f6f4d7d3c40482a66bd73bd88375626`.

These are cumulative counters, **not post-baseline deltas**; the original baseline did not capture those entries. Production statement tracking is `top`, so nested trigger writes cannot be independently attributed from these entries. At **6:59:38 AM EST**, source inspection also confirmed the existing style-group search refresh trigger includes `updated_at` among its UPDATE columns; the style-group update counter was 43,633. No comparable post-application style-group baseline was captured. Thus this evidence establishes additional legitimate writer paths, not their exact share of the interval increase or a defect requiring suppression. No function bodies or private source dumps are included here, and no capability was changed to improve a measurement.

## Future supported read-only proof

The committed issue probe (`../../../../.github/live-proofs/5609.sql`, not vendored to consumers) uses the existing **Shared DB Live Proof** workflow, with the issue's minimal canonical `db-work-scope` proof metadata. It adds no scheduler, privileged helper, grants, or production writer. The coordinator reviewed the exact probe hash `4db994c5425617fe5c211f688b6d35dd520f2af5449ef80d7c7e0c96d6a0eb9f`; the repository lexer accepted it and the actual production read-only role returned the required early result `passed = false` before the full interval elapsed.

Proof remains false until at least 24 hours after the frozen baseline, at least 100 matching calls occurred, the query entry/global stats/reset/postmaster context still matches, all relevant counters are monotonic, and the interval mean execution time and WAL per call each fall below half of the frozen pre-change references. Document update rate must also be below the real pre-change interval rate. It requires the exact ten trigger prefixes/functions/events/attributes/enabled states, no extra clone among the five covered functions, and the original image trigger's exact binding. Prefixes preserve the complete WHEN expression; `pg_get_expr` cannot deparse OLD/NEW multi-relation trigger predicates and is not substituted as a weaker check.

Cache drift must be zero and three deterministically sampled active assets scanned after the baseline and within the latest 24 hours must have current matching metadata. Fixed SYSTEM 1%, seed 5609 sampling was approved to bound the read; insufficient qualifying samples refuses proof, rather than declaring a data regression or silently passing. Sampling is not a census of all assets. The cache check uses indexed primary-asset lookups, not a full asset-table join scan. Counter reset, restart, changed statement identity, no/insufficient traffic, or a known individual table reset invalidates the measurement window and requires an explicitly captured fresh baseline; never edit constants merely to force a pass.

The hosted synthetic WAL target was not met (all fixed trials are retained in `assets-trigger-scoping-hosted-preview.md`). The real production interval remains the decisive pending acceptance; the issue's live-proof checkbox stays unchecked. Successful catalog recovery and eventual 24-hour performance acceptance are distinct deliverables.

## Exact post-baseline read


```sql
select jsonb_build_object('observed_at',now(),
 'postmaster_started_at',pg_postmaster_start_time(),
 'statement_stats_reset',(select stats_reset from extensions.pg_stat_statements_info),
 'database_stats_reset',(select stats_reset from pg_stat_database where datname=current_database()),
 'main_query',(select jsonb_agg(to_jsonb(q)) from(select queryid::text,userid::text,dbid::text,toplevel,stats_since,calls::text,total_exec_time::text,wal_bytes::text from extensions.pg_stat_statements where queryid='8695287796313115953'::bigint and userid='16486'::oid and dbid='5'::oid and toplevel)q),
 'all_asset_patches',(select jsonb_agg(to_jsonb(q)) from(select queryid::text,userid::text,dbid::text,toplevel,stats_since,calls::text,total_exec_time::text,wal_bytes::text from extensions.pg_stat_statements where query ilike 'with pgrst_source as (update "public"."assets"%')q),
 'tables',(select jsonb_agg(to_jsonb(q)) from(select relname,relid::text,n_dead_tup::text,n_live_tup::text,n_tup_upd::text,n_tup_hot_upd::text from pg_stat_user_tables where schemaname='public' and relname in('assets','dam_search_documents'))q));
```

## Historical 12:43:17 AM EST bounded current-metadata sample

```sql
with recent as materialized (
 select * from public.assets a tablesample system(1) repeatable(5609)
 where not is_deleted and last_seen_at>=now()-interval '24 hours'
   and last_seen_at<=now() limit 3
), compared as (
 select a.last_seen_at,d.metadata as actual,
 jsonb_strip_nulls(jsonb_build_object(
  'file_type',a.file_type,'asset_type',a.asset_type,'content_type',a.content_type,
  'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
  'product_material',a.product_material,'product_dimensions',a.product_dimensions,
  'workflow_status',a.workflow_status,'is_licensed',a.is_licensed,
  'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
  'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
  'product_category',a.product_category,'thumbnail_url',a.thumbnail_url
 )) as expected
 from recent a left join public.style_groups sg on sg.id=a.style_group_id
 left join public.dam_search_documents d on d.document_type='asset' and d.entity_id=a.id
)
select jsonb_build_object('observed_at',now(),
 'sampling','fixed SYSTEM1%, seed5609, first3 active assets scanned within24h; no IDs/values exported',
 'checked',count(*),'oldest_scan',min(last_seen_at),'latest_scan',max(last_seen_at),
 'all_metadata_match',bool_and(actual is not distinct from expected)) as metadata_proof
from compared;
```

## Verified catalog-recovery receipt

The existing [verification-only recovery run 41979854831](https://github.com/popcre/shared-db/actions/runs/41979854831) completed successfully November 5, 2026, **1:21:58 AM EST**, on exact main `b5684a3915f92a88f82d5ff046632f2ebea31e74`. The receipt was independently downloaded and checked by this subagent after the coordinator's verification. Its named catalog contract was enforcing, returned actual count 1 / expected count 1, and reported no errors.

Recovery artifact `13392873858`, named `production-catalog-recovery-41974228042`, has immutable digest `sha256:7810b55d74eea066e862025db2ea912a861b837c6c163cbface795b8c6fb3934`. It binds the original applied run `41974228042`, original artifact `13391053803`, and original artifact digest `sha256:c936f361a3d0dfb368b9d29922c18548570f7a6d46333498f68e3afbeeb41f85`. The original SQL hash remains `ee739f9e5f70cc843d5136a6b5bf428b4e4ea25d3ffe0babf5b924dd9645c894`; ledger addition is only `20261105033827`, with no removals. `verification_only = true` proves this recovery did not replay the applied SQL. The original failure is retained as `Post-apply catalog verification`, not rewritten as a successful original run.

Sanitized receipt (protected target identifier deliberately omitted):

```json
{
  "binding": {
    "schema_version": 1,
    "main_sha": "b5684a3915f92a88f82d5ff046632f2ebea31e74",
    "apply_main_sha": "cba3916673dfa2a1200641b931e7fc11b9b384cf",
    "apply_run_id": 41974228042,
    "apply_artifact_id": 13391053803,
    "apply_artifact_digest": "sha256:c936f361a3d0dfb368b9d29922c18548570f7a6d46333498f68e3afbeeb41f85",
    "allowlist": [
      "20261105033827"
    ],
    "migration_hashes": {
      "20261105033827": "ee739f9e5f70cc843d5136a6b5bf428b4e4ea25d3ffe0babf5b924dd9645c894"
    },
    "ledger_added": [
      "20261105033827"
    ],
    "ledger_removed": [],
    "catalog_enforced": true,
    "original_failure": "Post-apply catalog verification",
    "verification_only": true
  },
  "catalog_enforcing": true,
  "catalog_errors": [],
  "behavior_results": {
    "behavior_checks": [
      {
        "actual_count": 1,
        "expected_count": 1,
        "id": "assets_update_trigger_scoping_exact"
      }
    ]
  },
  "behavior_checks": [
    {
      "contract": "assets_update_trigger_scoping_v1",
      "expected_count": 1,
      "id": "assets_update_trigger_scoping_exact",
      "kind": "catalog_contract",
      "migration_sha256": "ee739f9e5f70cc843d5136a6b5bf428b4e4ea25d3ffe0babf5b924dd9645c894",
      "migration_version": "20261105033827",
      "relation": "catalog:assets_update_trigger_scoping_v1"
    }
  ]
}
```

Implementation and catalog recovery are complete. The full 24-hour production interval, performance targets, reduced document-write rate, current post-baseline metadata checks, and zero-drift acceptance remain pending on #5609. The committed strict probe and the original 12:36:57 AM EST post-apply baseline are unchanged; no early 24-hour probe was run and live proof remains unchecked.
