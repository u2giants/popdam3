-- #5609 read-only acceptance; first healthy post-restart opening November 6, 2026, 12:04:19.556744 PM EST.
-- Both earlier windows were invalidated; the second original source is preserved at
-- docs/verification/issue-5609-trigger-acceptance/5609-second-failed-window.sql
-- SHA256 1ca64b803b828c93778a4d4708d0bab6dc89725fe79bfcdc04e6919746211b47
-- Historical failed-window probe preserved byte-for-byte at
-- docs/verification/issue-5609-trigger-acceptance/5609-original-failed-window.sql
-- SHA256 4db994c5425617fe5c211f688b6d35dd520f2af5449ef80d7c7e0c96d6a0eb9f
-- Original post-apply baseline observed November 5, 2026,
-- 12:36:57 AM EST after automatic run41974228042 applied the immutable source.
-- Its catalog-recovery verification remains distinct; never reapply this source.
-- Frozen pre-change main PATCH baseline: November 4, 2026, 10:37 PM EST.
-- Frozen document rate: 8,829 updates / 5,050.846546 seconds, ending
-- November 5, 2026, 12:01:25 AM EST, while the migration was still absent.
-- No writes, timers, helpers, grants, or relaxed limits are introduced.
with baseline as (
 select
   '2026-11-06T12:04:19.556744-05:00'::timestamptz as observed_at,
   '2026-11-06T11:20:19.263334-05:00'::timestamptz as statement_stats_reset,
   null::timestamptz as database_stats_reset,
   '2026-11-06T11:20:19.434455-05:00'::timestamptz as postmaster_started_at,
   0::bigint as statement_dealloc,
   50::bigint as family_entry_count,
   '3a2faf721ab577a88117acfbd14407ce'::text as family_vector_md5,
   17809::oid as asset_relid,
   713489::oid as document_relid,
   2496::bigint as asset_updates,
   4313::bigint as document_updates,
   least(170.077045367033::numeric,4876427.13620301::numeric/29804,5249576.57683701::numeric/30092) as pre_mean_ms,
   least(59888.980667756245::numeric,1764593069::numeric/29804,1778351890::numeric/30092) as pre_wal_per_call,
   (8829::numeric / 5050.846546::numeric) as pre_document_updates_per_second
), baseline_family as (
 select * from (values
(16486::oid,5::oid,true,-9017596525321169182::bigint,'2026-11-06T16:21:35.477259+00:00'::timestamptz,'1458c591bb8b28d04032c2f30246a719',9::bigint,234.39501::numeric,553756::numeric),
(16486::oid,5::oid,true,-8961680761994232889::bigint,'2026-11-06T16:22:10.839373+00:00'::timestamptz,'50d37ba67682e2cc71164ed9983255bf',7::bigint,135.541393::numeric,342529::numeric),
(16486::oid,5::oid,true,-7484128831795557172::bigint,'2026-11-06T16:21:57.257758+00:00'::timestamptz,'bf74ad0dbdad540c304a860703648fe4',57::bigint,1279.9625::numeric,2292657::numeric),
(16486::oid,5::oid,true,-7269086418534825522::bigint,'2026-11-06T16:51:10.659681+00:00'::timestamptz,'7d79496c9407c9bd96c245399edd9e4e',1::bigint,10.590399::numeric,35704::numeric),
(16486::oid,5::oid,true,-7005969626952731885::bigint,'2026-11-06T16:45:09.498145+00:00'::timestamptz,'e8a087d1d68feb0f6ff5a77c048dbfd9',2::bigint,30.596132::numeric,57100::numeric),
(16486::oid,5::oid,true,-6408571764798647371::bigint,'2026-11-06T16:21:19.456780+00:00'::timestamptz,'9eafa83fd1a665e47d12953a612b802c',427::bigint,8937.733761::numeric,24138709::numeric),
(16486::oid,5::oid,true,-6245491547807920623::bigint,'2026-11-06T16:39:37.420930+00:00'::timestamptz,'dcba9dea035ea3e7b2eb5f93119c3bd6',4::bigint,49.646465::numeric,116406::numeric),
(16486::oid,5::oid,true,-6242054255837609863::bigint,'2026-11-06T16:24:07.988695+00:00'::timestamptz,'1ffc6f6dbf18e34f384e09ea4561a7fc',10::bigint,1356.738269::numeric,8398067::numeric),
(16486::oid,5::oid,true,-6239865321800273815::bigint,'2026-11-06T16:21:40.383657+00:00'::timestamptz,'bee1532e9a0a96e706be45cf33ae6b03',7::bigint,114.547058::numeric,251911::numeric),
(16486::oid,5::oid,true,-5879775803191925830::bigint,'2026-11-06T17:01:03.166582+00:00'::timestamptz,'928187e17ad40074abf921717f337fc0',1::bigint,14.998326::numeric,40656::numeric),
(16486::oid,5::oid,true,-5865314087008095744::bigint,'2026-11-06T16:31:16.871545+00:00'::timestamptz,'ab87c436efb65a61f9ba8f72f1dbd5fb',4::bigint,56.062241::numeric,115876::numeric),
(16486::oid,5::oid,true,-5438723947593814594::bigint,'2026-11-06T16:52:51.997733+00:00'::timestamptz,'eee7a6ad3555d59c7139b553cda8f44e',4::bigint,62.083335::numeric,141194::numeric),
(16486::oid,5::oid,true,-4831842545730498456::bigint,'2026-11-06T16:29:28.620779+00:00'::timestamptz,'404b76eede222175264c5ecd4f325bef',2::bigint,120.640454::numeric,102223::numeric),
(16486::oid,5::oid,true,-4304378031524677348::bigint,'2026-11-06T16:21:32.716108+00:00'::timestamptz,'b90024136afb955b54702daf3f5cb6f0',198::bigint,4287.466867::numeric,7750017::numeric),
(16486::oid,5::oid,true,-4258679261381200171::bigint,'2026-11-06T16:22:35.057272+00:00'::timestamptz,'a2b44932978bae79c8a4fe2c02587d72',1::bigint,11.141985::numeric,30123::numeric),
(16486::oid,5::oid,true,-4001955326523898304::bigint,'2026-11-06T16:23:08.120625+00:00'::timestamptz,'e15f9a4aaba8f9f16e1373032b55d1d1',22::bigint,420.873325::numeric,826833::numeric),
(16486::oid,5::oid,true,-3655432256717040365::bigint,'2026-11-06T16:24:46.568388+00:00'::timestamptz,'d795ba9776292721fd4fba17bf67d6c1',2::bigint,26.811857::numeric,80048::numeric),
(16486::oid,5::oid,true,-3507091764867901600::bigint,'2026-11-06T16:22:13.887633+00:00'::timestamptz,'4a3ad8bddd9e673dfc65fc39eca43ab4',2::bigint,31.365228::numeric,127208::numeric),
(16486::oid,5::oid,true,-3422599514789899442::bigint,'2026-11-06T16:21:38.544130+00:00'::timestamptz,'b6edf704650a8a6832b2676fba95a61c',10::bigint,150.452208::numeric,339471::numeric),
(16486::oid,5::oid,true,-2927287377355301244::bigint,'2026-11-06T16:22:02.505222+00:00'::timestamptz,'b7f41a96fc6395cb1df507c10d87ecc9',20::bigint,304.956668::numeric,716273::numeric),
(16486::oid,5::oid,true,-2819429450413652117::bigint,'2026-11-06T16:23:39.436477+00:00'::timestamptz,'693349b45417b9754aeeb655f8d4471f',2::bigint,67.415889::numeric,114969::numeric),
(16486::oid,5::oid,true,-2070279713701663720::bigint,'2026-11-06T16:21:36.021169+00:00'::timestamptz,'95b620216d21b68d60263b49aa49cd18',4::bigint,61.291616::numeric,141927::numeric),
(16486::oid,5::oid,true,-1084662265968513224::bigint,'2026-11-06T16:26:30.378828+00:00'::timestamptz,'fc61eaed15a1a9d509cb097935adce22',3::bigint,221.45505::numeric,182670::numeric),
(16486::oid,5::oid,true,-640555994218644254::bigint,'2026-11-06T16:21:57.711955+00:00'::timestamptz,'24009fb709d4e6bcee863190ac9765bc',33::bigint,971.033282::numeric,1589814::numeric),
(16486::oid,5::oid,true,-547816614327025824::bigint,'2026-11-06T16:27:27.840432+00:00'::timestamptz,'86b1767de923e3b940eae31a2cf6f748',9::bigint,224.753626::numeric,313087::numeric),
(16486::oid,5::oid,true,-239261862598665458::bigint,'2026-11-06T17:01:33.196074+00:00'::timestamptz,'43be64c1c08cd5913770c9b57472838a',1::bigint,16.896086::numeric,53525::numeric),
(16486::oid,5::oid,true,475506692779349257::bigint,'2026-11-06T16:29:50.629561+00:00'::timestamptz,'26ba0234dfff8c8ab423a529168e2b62',6::bigint,90.649291::numeric,293879::numeric),
(16486::oid,5::oid,true,705277641840117542::bigint,'2026-11-06T16:23:06.857505+00:00'::timestamptz,'c081f3c062d5ca3a4ff4d1d7b0564460',4::bigint,62.52493::numeric,165131::numeric),
(16486::oid,5::oid,true,1124168971969388564::bigint,'2026-11-06T16:58:24.026781+00:00'::timestamptz,'692517688402d38fa194d1584b589e26',1::bigint,18.782455::numeric,29710::numeric),
(16486::oid,5::oid,true,1177612810051285035::bigint,'2026-11-06T16:59:37.826755+00:00'::timestamptz,'0c089fd3621695566c7136423e4de618',1::bigint,17.895047::numeric,25660::numeric),
(16486::oid,5::oid,true,1184692672362122791::bigint,'2026-11-06T16:42:12.021288+00:00'::timestamptz,'c39ff01b7cc38deb96dda0192958876c',1::bigint,17.54247::numeric,30093::numeric),
(16486::oid,5::oid,true,3048833575201425536::bigint,'2026-11-06T16:26:00.457933+00:00'::timestamptz,'5c675ac196f2e373399c323529742d0e',1::bigint,11.354971::numeric,44640::numeric),
(16486::oid,5::oid,true,3517010476282697109::bigint,'2026-11-06T16:24:18.366665+00:00'::timestamptz,'8b7852a4939cad16070d5e9d29b8d136',2::bigint,22.040843::numeric,76000::numeric),
(16486::oid,5::oid,true,3716691163661225676::bigint,'2026-11-06T16:58:25.372204+00:00'::timestamptz,'147866db335feed1bc2f1feca3d52e58',1::bigint,14.505832::numeric,37253::numeric),
(16486::oid,5::oid,true,4224640302014661331::bigint,'2026-11-06T16:21:33.890076+00:00'::timestamptz,'5dc92abe71b75dd8e8bf113f1fa945f4',23::bigint,495.059519::numeric,898631::numeric),
(16486::oid,5::oid,true,4331546407317557942::bigint,'2026-11-06T16:22:02.378563+00:00'::timestamptz,'c8f4c350a5a930af818b2e2ab56d4bcc',6::bigint,115.080709::numeric,212035::numeric),
(16486::oid,5::oid,true,4366325668843534194::bigint,'2026-11-06T16:25:35.169104+00:00'::timestamptz,'14657b7b76491c9ce31bcb00221b92a5',2::bigint,30.520198::numeric,71751::numeric),
(16486::oid,5::oid,true,4656379995363957881::bigint,'2026-11-06T16:23:41.497774+00:00'::timestamptz,'d4ae4f9e2b0299a7623c06c1c6235da8',10::bigint,137.811323::numeric,296716::numeric),
(16486::oid,5::oid,true,5103179279542507912::bigint,'2026-11-06T16:48:05.509782+00:00'::timestamptz,'d58cd934b75f811c17055634f6f701fe',1::bigint,9.610256::numeric,22627::numeric),
(16486::oid,5::oid,true,5882761008113839173::bigint,'2026-11-06T16:31:50.873702+00:00'::timestamptz,'baa4a0357577e3b71f406c443a356787',5::bigint,69.76984::numeric,162371::numeric),
(16486::oid,5::oid,true,6348186856622729489::bigint,'2026-11-06T16:33:37.652204+00:00'::timestamptz,'8024227602248994b889d7666668ce6b',5::bigint,83.356633::numeric,161336::numeric),
(16486::oid,5::oid,true,6430535887002143036::bigint,'2026-11-06T16:21:40.863938+00:00'::timestamptz,'88dfeefb81ba5cf9194f7a4789c8d6f0',27::bigint,627.744601::numeric,1164834::numeric),
(16486::oid,5::oid,true,6812761708967041595::bigint,'2026-11-06T16:21:16.073577+00:00'::timestamptz,'cc71dcc6c44f317dd5eff423c5f26ff5',424::bigint,30973.831769::numeric,39290487::numeric),
(16486::oid,5::oid,true,6907289670067793425::bigint,'2026-11-06T16:26:34.184916+00:00'::timestamptz,'0ba12bd6c20108cb0798a7be45092362',2::bigint,74.660205::numeric,146375::numeric),
(16486::oid,5::oid,true,7184230990223857211::bigint,'2026-11-06T16:53:51.734631+00:00'::timestamptz,'5165a0b5a7fd1d2600da4b38194a2704',1::bigint,11.1575::numeric,38132::numeric),
(16486::oid,5::oid,true,7373199178642469211::bigint,'2026-11-06T16:24:02.358772+00:00'::timestamptz,'98263d568034e6d52a769f286bf6e339',1::bigint,24.70517::numeric,43538::numeric),
(16486::oid,5::oid,true,7416563968712206808::bigint,'2026-11-06T16:59:31.221109+00:00'::timestamptz,'6b7dbecd9ed7cb887ea000cca8a522dd',1::bigint,9.809196::numeric,36926::numeric),
(16486::oid,5::oid,true,7861259013639822521::bigint,'2026-11-06T16:26:01.168695+00:00'::timestamptz,'e1f325a348bdd34194f75d67b56bf405',9::bigint,167.938382::numeric,389749::numeric),
(16486::oid,5::oid,true,8265133757273375558::bigint,'2026-11-06T16:22:34.330753+00:00'::timestamptz,'22a63c7a7a651f6f404c92aecfefab58',29::bigint,1102.83684::numeric,1476989::numeric),
(16486::oid,5::oid,true,9087026206194055037::bigint,'2026-11-06T16:53:13.249170+00:00'::timestamptz,'8d01a34c2fb4b7e35565dcfebb205750',1::bigint,9.958555::numeric,35301::numeric)
 )v(userid,dbid,toplevel,queryid,stats_since,query_md5,calls,total_exec_time,wal_bytes)
), query_stats as (
 select userid,dbid,toplevel,queryid,stats_since,md5(query) query_md5,calls,total_exec_time::text::numeric,wal_bytes::text::numeric
 from extensions.pg_stat_statements
 -- Exact authentic PRE collector: no role/database/top-level restriction or LIMIT.
 where query ilike 'with pgrst_source as (update "public"."assets"%'
), family_proof as (
 select
  (select count(*) from baseline_family)=b.family_entry_count and b.family_entry_count>0
  and (select md5(string_agg(row(userid,dbid,toplevel,queryid,extract(epoch from stats_since),query_md5,calls,total_exec_time,wal_bytes)::text,
    E'\n' order by userid,dbid,toplevel,queryid)) from baseline_family)=b.family_vector_md5
  and not exists(select from baseline_family where userid is null or dbid is null or toplevel is null or queryid is null
    or stats_since is null or stats_since>b.observed_at or query_md5 is null or query_md5 !~ '^[0-9a-f]{32}$'
    or calls is null or calls<0 or total_exec_time is null or total_exec_time<0
    or total_exec_time::text in ('NaN','Infinity','-Infinity') or wal_bytes is null or wal_bytes<0
    or wal_bytes::text in ('NaN','Infinity','-Infinity'))
  and not exists(select from baseline_family group by userid,dbid,toplevel,queryid having count(*)<>1)
  and not exists(select from query_stats group by userid,dbid,toplevel,queryid having count(*)<>1)
  and not exists(select from baseline_family f where not exists(select from query_stats q
    where (q.userid,q.dbid,q.toplevel,q.queryid)=(f.userid,f.dbid,f.toplevel,f.queryid)
      and q.stats_since=f.stats_since and q.query_md5=f.query_md5
      and q.calls>=f.calls and q.total_exec_time>=f.total_exec_time and q.wal_bytes>=f.wal_bytes))
  and not exists(select from query_stats q where q.userid is null or q.dbid is null or q.toplevel is null or q.queryid is null
    or q.stats_since is null or q.query_md5 is null or q.query_md5 !~ '^[0-9a-f]{32}$'
    or q.calls is null or q.calls<0 or q.total_exec_time is null or q.total_exec_time<0
    or q.total_exec_time::text in ('NaN','Infinity','-Infinity') or q.wal_bytes is null or q.wal_bytes<0
    or q.wal_bytes::text in ('NaN','Infinity','-Infinity')
    or (not exists(select from baseline_family f where
      (q.userid,q.dbid,q.toplevel,q.queryid)=(f.userid,f.dbid,f.toplevel,f.queryid)) and q.stats_since<b.observed_at)) as valid,
  (select sum(q.calls-coalesce(f.calls,0)) from query_stats q left join baseline_family f using(userid,dbid,toplevel,queryid)) as calls,
  (select sum(q.total_exec_time-coalesce(f.total_exec_time,0)) from query_stats q left join baseline_family f using(userid,dbid,toplevel,queryid)) as total_exec_time,
  (select sum(q.wal_bytes-coalesce(f.wal_bytes,0)) from query_stats q left join baseline_family f using(userid,dbid,toplevel,queryid)) as wal_bytes
 from baseline b
), table_stats as (
 select
  (select n_tup_upd from pg_stat_user_tables where relid='public.assets'::regclass) as asset_updates,
  (select n_tup_upd from pg_stat_user_tables where relid='public.dam_search_documents'::regclass) as document_updates
), expected as (
 select * from (values
  ('trg_auto_queue_render','public.auto_queue_render()',17,array['6d292c5ad846cc05bb3290b926bf1d20','f4a2b5b6f5877746b78d4058f55835bb']),
  ('trg_auto_queue_render_ins_del','public.auto_queue_render()',5,array['caa4f524dd84c8e24d36fc8d68c59c89']),
  ('trg_dam_search_assets_refresh','public.trg_refresh_dam_asset_search_document()',17,array['3adf740fb4f20406f6620052b23e28c3','543a6d307f7d8cb6f17c1ae4c83bdd6a']),
  ('trg_dam_search_assets_refresh_ins_del','public.trg_refresh_dam_asset_search_document()',13,array['9fb1930126a935df0ff11d05bbcfdd4b']),
  ('trg_sync_cover_description_to_style_group','public.sync_cover_description_to_style_group()',17,array['dac32eaf299fd77dfa9ac6827a18211a','9711807e2187b18a28d47bf567089328']),
  ('trg_sync_cover_description_to_style_group_ins_del','public.sync_cover_description_to_style_group()',5,array['b4ddc43b9e60e91649c6fca65ad10f6e']),
  ('trg_sync_designer_to_style_group','public.sync_designer_to_style_group()',17,array['a2037258e3fd300113b8489f25ee62a9','ad1e03640d8163a324e9a7d54db77d6f']),
  ('trg_sync_designer_to_style_group_ins_del','public.sync_designer_to_style_group()',5,array['24a12b32508aee5a6b24075d011e6897']),
  ('trg_sync_primary_on_thumbnail','public.sync_primary_asset_on_thumbnail()',17,array['224aa60d20a0b9f58a052b6f603598b8','28c25be1dbde678c718bc372439edeb4']),
  ('trg_sync_primary_on_thumbnail_ins_del','public.sync_primary_asset_on_thumbnail()',5,array['f7870cdb13d8aedf4901696cf1bc5622'])
 )e(trigger_name,function_name,event_type,definition_md5s)
), recent as (
 select a.* from public.assets a tablesample system(1) repeatable(5609) cross join baseline b
 where not a.is_deleted and a.last_seen_at>=greatest(b.observed_at,now()-interval '24 hours')
   and a.last_seen_at<=now() limit 3
), metadata_source as (
 select a.id,a.modified_at,a.file_size,a.thumbnail_url,
  d.metadata as actual_metadata,d.indexed_at,d.source_updated_at,q.render_completed_at as current_queue_render,d.embedding_lease_token,d.embedding_lease_owner,d.embedding_lease_expires_at,
  jsonb_strip_nulls(jsonb_build_object(
   'file_type',a.file_type,'asset_type',a.asset_type,'content_type',a.content_type,
   'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
   'product_material',a.product_material,'product_dimensions',a.product_dimensions,
   'workflow_status',a.workflow_status,'is_licensed',a.is_licensed,
   'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
   'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
   'product_category',a.product_category,'thumbnail_url',a.thumbnail_url)) as core_metadata,
  -- #05074126 retains a previous completed render after queue retention.
  -- Invalid JSON dates abstain; never invoke its service-only VOLATILE helper.
  greatest(q.render_completed_at,case
    when d.metadata->'_embedding_input'->>'asset_id'=a.id::text
     and pg_input_is_valid(d.metadata->'_embedding_input'->>'render_completed_at','timestamp with time zone')
    then (d.metadata->'_embedding_input'->>'render_completed_at')::timestamptz end) as retained_render,
  coalesce(not coalesce(d.metadata->'_embedding_input' ? 'render_completed_at',false) or
    (jsonb_typeof(d.metadata->'_embedding_input'->'render_completed_at')='string'
     and pg_input_is_valid(d.metadata->'_embedding_input'->>'render_completed_at','timestamp with time zone')),false) as render_valid
 from recent a left join public.style_groups sg on sg.id=a.style_group_id
 left join public.dam_search_documents d on d.document_type='asset' and d.entity_id=a.id
 left join lateral(select rq.completed_at as render_completed_at from public.render_queue rq
    where rq.asset_id=a.id and rq.status='completed' and rq.completed_at is not null
    order by rq.completed_at desc limit 1)q on true
), provenance_input as (
 select m.*,case when nullif(btrim(thumbnail_url),'') is not null
    and (modified_at is not null or retained_render is not null)
  then jsonb_strip_nulls(jsonb_build_object(
   'version',1,'model','google/siglip2-base-patch16-naflex','image_transform','uncropped-thumbnail',
   'asset_id',id,'thumbnail_url',thumbnail_url,
   -- Match the authoritative helper's SET timezone=UTC JSON encoding without SET.
   'source_modified_at',case when modified_at is null then null when isfinite(modified_at)
     then (to_jsonb(modified_at at time zone 'UTC') #>> '{}')||'+00:00' else modified_at::text end,
   'source_file_size',file_size,
   'render_completed_at',case when retained_render is null then null when isfinite(retained_render)
     then (to_jsonb(retained_render at time zone 'UTC') #>> '{}')||'+00:00' else retained_render::text end)) end as expected_input_base
 from metadata_source m
), metadata_checked as (
 select p.*,
  -- Grandfather only unchanged pre-cutover documents; present JSON NULL is not absence.
  coalesce(not (actual_metadata ? '_embedding_input')
    and indexed_at<'2026-11-05T07:30:57-05:00'::timestamptz
    and source_updated_at<'2026-11-05T07:30:57-05:00'::timestamptz
    and (modified_at is null or (modified_at<=indexed_at and modified_at<=source_updated_at))
    and (current_queue_render is null or
      (current_queue_render<=indexed_at and current_queue_render<=source_updated_at)),false) as legacy_unchanged,
  case when expected_input_base is not null then
    expected_input_base||jsonb_build_object('sha256',encode(extensions.digest(expected_input_base::text,'sha256'),'hex')) end as expected_input,
  case when embedding_lease_token is null then
    embedding_lease_owner is null and embedding_lease_expires_at is null
      and (not (actual_metadata ? '_embedding_lease_input_sha256') or
        (jsonb_typeof(actual_metadata->'_embedding_lease_input_sha256')='string'
         and (actual_metadata->>'_embedding_lease_input_sha256') ~ '^[0-9a-f]{64}$'))
   else nullif(btrim(embedding_lease_owner),'') is not null
    and embedding_lease_expires_at is not null and isfinite(embedding_lease_expires_at)
    and jsonb_typeof(actual_metadata->'_embedding_lease_input_sha256')='string'
    and (actual_metadata->>'_embedding_lease_input_sha256') ~ '^[0-9a-f]{64}$' end as lease_valid
 from provenance_input p
), current_metadata as (
 select count(*) as checked,
  bool_and(coalesce(render_valid and lease_valid
    and actual_metadata is not distinct from
      core_metadata||case when expected_input is null or legacy_unchanged then '{}'::jsonb
        else jsonb_build_object('_embedding_input',expected_input) end
      ||case when actual_metadata ? '_embedding_lease_input_sha256' then
        jsonb_build_object('_embedding_lease_input_sha256',actual_metadata->'_embedding_lease_input_sha256') else '{}'::jsonb end,false)) as all_match
 from metadata_checked
)
select case
 when b.observed_at is null or b.family_entry_count is null or b.family_vector_md5 is null
   or b.statement_dealloc is null or b.asset_updates is null or b.document_updates is null
   or b.statement_stats_reset is null or b.postmaster_started_at is null
   or now()<b.observed_at+interval '24 hours' then false
 else coalesce(
  b.asset_relid=to_regclass('public.assets')::oid
  and b.document_relid=to_regclass('public.dam_search_documents')::oid
  and current_user='supabase_read_only_user'
  and pg_has_role(current_user,'pg_read_all_stats','member')
  and not exists(select 1 from unnest(array[
    'public.assets','public.style_groups','public.dam_search_documents',
    'extensions.pg_stat_statements','extensions.pg_stat_statements_info','public.render_queue',
    'supabase_migrations.schema_migrations'])r(rel)
    where not has_table_privilege(current_user,rel,'select'))
  and pg_postmaster_start_time()=b.postmaster_started_at
  and (select stats_reset from extensions.pg_stat_statements_info)=b.statement_stats_reset
  and (select dealloc from extensions.pg_stat_statements_info)=b.statement_dealloc
  and (select stats_reset from pg_stat_database where datname=current_database())
      is not distinct from b.database_stats_reset
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261105033827')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261105074126')
  and exists(select from family_proof f where f.valid and f.calls>=100
    and f.total_exec_time/nullif(f.calls,0)<b.pre_mean_ms*0.5
    and f.wal_bytes/nullif(f.calls,0)<b.pre_wal_per_call*0.5)
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
      and md5(split_part(pg_get_triggerdef(t.oid,false),' EXECUTE FUNCTION ',1))=any(e.definition_md5s)))
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
