-- Synthetic-only rehearsal owned by #5608; retained as regression evidence.
-- Run only in a fresh disposable PostgreSQL 17 cluster, never a shared target.
-- Require PGOPTIONS='-c app.sku_sg_disposable=yes' before this script can run.
\set ON_ERROR_STOP on
do $$begin if current_setting('app.sku_sg_disposable',true) is distinct from 'yes' then
 raise exception 'This fixture requires an explicitly disposable database';end if;end$$;
create role anon; create role authenticated; create role service_role bypassrls;
create schema plm; create schema core; create schema app; create schema cron;
create table core.style_guide(id uuid primary key);
create function app.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end $$;
create function cron.schedule(text,text,text) returns bigint language sql as $$select 17::bigint$$;
create function public.is_style_guide_source_pdf(text,text) returns boolean language sql immutable as $$select $1='pdf' and $2 in ('licensing_sheet.pdf','tech_pack.pdf')$$;
create table public.assets(id uuid primary key,sku text,file_type text,filename text);
create index on public.assets(sku);
create table public.pdf_text_samples(asset_id uuid,extracted_text text,sampled_at timestamptz,char_count int);
create index on public.pdf_text_samples(asset_id);
create table public.sku_files_used(sku text,file_name text,source text,unique(sku,file_name));
create table plm.dcp_asset(id uuid primary key,style_guide_id uuid,file_name text);
create table plm.dcp_style_guide(id uuid primary key,source_guide_id text,folder_name text,core_style_guide_id uuid);
create table plm.lucasfilm_dcp_asset(like plm.dcp_asset including all);
create table plm.lucasfilm_dcp_style_guide(like plm.dcp_style_guide including all);
create table plm.marvel_dcp_asset(like plm.dcp_asset including all);
create table plm.marvel_dcp_style_guide(like plm.dcp_style_guide including all);
create table plm.marvel_asgard_node_asset_observation(guide_node_id uuid,exact_filename text);
create table plm.marvel_asgard_guide_node(id uuid primary key,style_guide_id uuid);
create table plm.marvel_asgard_style_guide(id uuid primary key,source_guide_key text,source_identity_key text,exact_label text);
create table plm.nbcu_asset(capture_id uuid,asset_source_key text,file_name text);
create table plm.nbcu_asset_style_guide(capture_id uuid,asset_source_key text,style_guide_key text);
create table plm.nbcu_style_guide(capture_id uuid,style_guide_key text,style_guide_label text,core_style_guide_id uuid);
create table plm.wb_asset_normalized(id uuid primary key,file_name text);
create table plm.wb_asset_style_guide_normalized(asset_id uuid,style_guide_id uuid);
create table plm.wb_style_guide_normalized(id uuid primary key,source_id text,fallback_key text,label text);
create table plm.peanuts_asset(capture_id uuid,file_name text,style_guide_key text);
create table plm.peanuts_style_guide(capture_id uuid,value_key text,value_label text);
create table plm.sesame_asset(capture_id uuid,asset_source_id int,original_file_name text);
create table plm.sesame_asset_style_guide(capture_id uuid,asset_source_id int,value_key text);
create table plm.sesame_style_guide(capture_id uuid,value_key text,value_label text);
create table cron.job(jobid bigint primary key,jobname text unique,schedule text,command text);
create or replace function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values (case when $1='resolve-sku-style-guide-links-nightly' then 17 else 5608 end,$1,$2,$3) on conflict(jobid) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;
create function cron.unschedule(bigint) returns boolean language sql as $$with x as(delete from cron.job where jobid=$1 returning 1) select exists(select 1 from x)$$;

\ir ../../../../supabase/migrations/20261030043848_sku_style_guide_links.sql
insert into plm.dcp_style_guide(id,source_guide_id,folder_name)
select md5('guide'||g)::uuid, 'guide-'||g, 'The Guide '||g from generate_series(1,10000) g;
insert into plm.dcp_asset(id,style_guide_id,file_name)
select md5('file'||g)::uuid,md5('guide'||(g%10000+1))::uuid,'File_'||g||'.PSD' from generate_series(1,553600) g;
insert into public.assets select md5('sheet'||g)::uuid,'SKU-'||(g%12821+1),'pdf','licensing_sheet.pdf' from generate_series(1,27915) g;
insert into public.pdf_text_samples(asset_id,extracted_text,sampled_at,char_count)
select md5('sheet'||g)::uuid, E'CORE/STYLE GUIDE USED: The Guide '||(g%10000+1)||E'\n'||repeat(md5(g::text),100),now(),3400 from generate_series(1,27915) g;
insert into public.sku_files_used select 'SKU-'||(g%12821+1),'File_'||g||'.PSD','synthetic' from generate_series(1,11600) g;
analyze;

\timing on
select public.resolve_sku_style_guide_links();
create table reference_output as select sku,file_name,source_system,source_style_guide_key,style_guide_label,match_method,match_confidence,matched_asset_count,core_style_guide_id from public.sku_style_guide_links;
create table reference_view as select * from plm.asset_file_style_guide_index;
begin;
\ir ../../../../supabase/migrations/20261105044255_sku_style_guide_resolution_incremental.sql
commit;
select count(*) as pending_view_differences from ((table reference_view except all table plm.asset_file_style_guide_index) union all (table plm.asset_file_style_guide_index except all table reference_view)) d;
set statement_timeout='60s';
call public.resolve_sku_style_guide_links_run();
select count(*) as output_differences from ((table reference_output except select sku,file_name,source_system,source_style_guide_key,style_guide_label,match_method,match_confidence,matched_asset_count,core_style_guide_id from public.sku_style_guide_links) union all (select sku,file_name,source_system,source_style_guide_key,style_guide_label,match_method,match_confidence,matched_asset_count,core_style_guide_id from public.sku_style_guide_links except table reference_output)) d;
select count(*) as ready_view_differences from ((table reference_view except all table plm.asset_file_style_guide_index) union all (table plm.asset_file_style_guide_index except all table reference_view)) d;
call public.resolve_sku_style_guide_links_run();
\timing on
select public.prepare_sku_style_guide_resolution(true);
create temp table batch_times(ms numeric,n integer);
do $$declare t timestamptz;r jsonb;begin loop t=clock_timestamp();r=public.resolve_sku_style_guide_batch(100);insert into batch_times values(extract(epoch from clock_timestamp()-t)*1000,(r->>'sku_rows')::integer);exit when (r->>'sku_rows')::integer=0;end loop;end$$;
select count(*) as batches,sum(n) as skus,max(ms) as max_batch_ms,round(avg(ms),3) as avg_batch_ms,sum(ms) as total_batch_ms from batch_times;
select public.prepare_sku_style_guide_resolution(false);
explain (analyze,buffers) select * from plm.asset_file_style_guide_index where file_name_norm='file_100';

\ir ../../../../supabase/tests/sku_style_guide_links_contracts.sql
