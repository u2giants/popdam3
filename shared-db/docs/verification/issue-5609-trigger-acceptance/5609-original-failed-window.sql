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
select case
 when b.observed_at is null or b.calls is null or b.total_exec_time is null
   or b.wal_bytes is null or b.asset_updates is null or b.document_updates is null
   or b.statement_stats_reset is null or b.entry_stats_since is null or b.postmaster_started_at is null
   or now()<b.observed_at+interval '24 hours' then false
 else coalesce(
  current_user='supabase_read_only_user'
  and pg_has_role(current_user,'pg_read_all_stats','member')
  and not exists(select 1 from unnest(array[
    'public.assets','public.style_groups','public.dam_search_documents',
    'extensions.pg_stat_statements','extensions.pg_stat_statements_info',
    'supabase_migrations.schema_migrations'])r(rel)
    where not has_table_privilege(current_user,rel,'select'))
  and pg_postmaster_start_time()=b.postmaster_started_at
  and (select stats_reset from extensions.pg_stat_statements_info)=b.statement_stats_reset
  and (select stats_reset from pg_stat_database where datname=current_database())
      is not distinct from b.database_stats_reset
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261105033827')
  and (select count(*) from query_stats)=1
  and exists(select 1 from query_stats q where q.stats_since=b.entry_stats_since
    and q.calls-b.calls>=100
    and q.total_exec_time>=b.total_exec_time and q.wal_bytes>=b.wal_bytes
    and (q.total_exec_time-b.total_exec_time)/nullif(q.calls-b.calls,0)<b.pre_mean_ms*0.5
    and (q.wal_bytes-b.wal_bytes)/nullif(q.calls-b.calls,0)<b.pre_wal_per_call*0.5)
  and exists(select 1 from table_stats t where t.asset_updates>b.asset_updates
    and t.document_updates>=b.document_updates
    and (t.document_updates-b.document_updates)
        /extract(epoch from now()-b.observed_at)<b.pre_document_updates_per_second)
  and (select count(*) from expected)=10
  and not exists(select 1 from expected e where not exists(
    select 1 from pg_trigger t where t.tgrelid=to_regclass('public.assets')
      and t.tgname=e.trigger_name and t.tgtype=e.event_type and t.tgenabled='O'
      and not t.tgisinternal and not t.tgdeferrable and not t.tginitdeferred
      and t.tgnargs=0 and t.tgattr=''::int2vector
      and (t.tgqual is not null)=(e.event_type=17)
      and t.tgfoid=to_regprocedure(e.function_name)
      and md5(split_part(pg_get_triggerdef(t.oid,false),' EXECUTE FUNCTION ',1))=e.definition_md5))
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.assets')
    and tgfoid in(select to_regprocedure(function_name) from expected))=10
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.assets')
    and tgfoid in(select to_regprocedure(function_name) from expected) and tgtype=17)=5
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.assets')
    and tgfoid in(select to_regprocedure(function_name) from expected) and tgtype in(5,13))=5
  and exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.assets')
    and t.tgname='trg_assets_enqueue_image_embed' and t.tgenabled='O' and t.tgtype=21
    and not t.tgisinternal and not t.tgdeferrable and not t.tginitdeferred and t.tgnargs=0
    and t.tgqual is null and t.tgfoid=to_regprocedure('dam.assets_enqueue_image_embed_trg_fn()')
    and t.tgattr::text=(select attnum::text from pg_attribute
      where attrelid=to_regclass('public.assets') and attname='thumbnail_url' and not attisdropped))
  and not exists(select 1 from public.style_groups sg join lateral(
      select a.thumbnail_url,a.thumbnail_error from public.assets a where a.id=sg.primary_asset_id limit 1
    )a on true where sg.primary_asset_id is not null
      and (sg.primary_thumbnail_url is distinct from a.thumbnail_url
           or sg.primary_thumbnail_error is distinct from a.thumbnail_error))
  and (select checked=3 and all_match from current_metadata)
 ,false)
end as passed
from baseline b;
