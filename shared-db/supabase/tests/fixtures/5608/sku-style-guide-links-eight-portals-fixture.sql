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
create table cron.job(jobid bigint primary key,jobname text unique,schedule text,command text,username text default 'postgres',active boolean default true);
create or replace function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobid,jobname,schedule,command) values (case when $1='resolve-sku-style-guide-links-nightly' then 17 else 5608 end,$1,$2,$3) on conflict(jobid) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void language sql as $$update cron.job j set schedule=coalesce($2,j.schedule),command=coalesce($3,j.command),username=coalesce($5,j.username),active=coalesce($6,j.active) where j.jobid=$1$$;
create function cron.unschedule(bigint) returns boolean language sql as $$with x as(delete from cron.job where jobid=$1 returning 1) select exists(select 1 from x)$$;

\ir ../../../../supabase/migrations/20261030043848_sku_style_guide_links.sql
insert into plm.dcp_style_guide(id,source_guide_id,folder_name) values(md5('dcp-guide')::uuid,'g','Guide One');
insert into plm.dcp_asset(id,style_guide_id,file_name) values(md5('dcp-file')::uuid,md5('dcp-guide')::uuid,'Art.PSD');
insert into plm.lucasfilm_dcp_style_guide(id,source_guide_id,folder_name) values(md5('lucas-guide')::uuid,'g','Guide One');
insert into plm.lucasfilm_dcp_asset(id,style_guide_id,file_name) values(md5('lucas-file')::uuid,md5('lucas-guide')::uuid,'Art.PSD');
insert into plm.marvel_dcp_style_guide(id,source_guide_id,folder_name) values(md5('marvel-guide')::uuid,'g','Guide One');
insert into plm.marvel_dcp_asset(id,style_guide_id,file_name) values(md5('marvel-file')::uuid,md5('marvel-guide')::uuid,'Art.PSD');
insert into plm.marvel_asgard_style_guide values(md5('asg-guide')::uuid,'g','g','Guide One');
insert into plm.marvel_asgard_guide_node values(md5('asg-node')::uuid,md5('asg-guide')::uuid);
insert into plm.marvel_asgard_node_asset_observation values(md5('asg-node')::uuid,'Art.PSD');
insert into plm.nbcu_asset values(md5('nbcu-capture')::uuid,'a','Art.PSD');
insert into plm.nbcu_style_guide values(md5('nbcu-capture')::uuid,'g','Guide One',null);
insert into plm.nbcu_asset_style_guide values(md5('nbcu-capture')::uuid,'a','g');
insert into plm.wb_asset_normalized values(md5('wb-file')::uuid,'Art.PSD');
insert into plm.wb_style_guide_normalized values(md5('wb-guide')::uuid,'','g','Guide One');
insert into plm.wb_asset_style_guide_normalized values(md5('wb-file')::uuid,md5('wb-guide')::uuid);
insert into plm.peanuts_asset values(md5('peanuts-capture')::uuid,'Art.PSD','g');
insert into plm.peanuts_style_guide values(md5('peanuts-capture')::uuid,'g','Guide One');
insert into plm.sesame_asset values(md5('sesame-capture')::uuid,1,'Art.PSD');
insert into plm.sesame_style_guide values(md5('sesame-capture')::uuid,'g','Guide One');
insert into plm.sesame_asset_style_guide values(md5('sesame-capture')::uuid,1,'g');
-- Legitimately NULL normalized filenames retain rows in DCP arms.
insert into plm.dcp_asset(id,style_guide_id,file_name) values(md5('dcp-null')::uuid,md5('dcp-guide')::uuid,'   ');
insert into public.assets values(md5('sheet')::uuid,'SKU-ALL','pdf','licensing_sheet.pdf');
insert into public.pdf_text_samples values(md5('sheet')::uuid,'CORE/STYLE GUIDE USED: Guide One',now(),150);
insert into public.sku_files_used values('SKU-ALL','Art.PSD','synthetic');
create table expected_view as select * from plm.asset_file_style_guide_index;

begin;
\ir ../../../../supabase/migrations/20261105044255_sku_style_guide_resolution_incremental.sql
commit;
select count(*) as pending_differences from ((table expected_view except all table plm.asset_file_style_guide_index) union all (table plm.asset_file_style_guide_index except all table expected_view)) d;
call public.resolve_sku_style_guide_links_run();
select count(*) as ready_differences from ((table expected_view except all table plm.asset_file_style_guide_index) union all (table plm.asset_file_style_guide_index except all table expected_view)) d;
select count(distinct source_system) as portals,count(*) as filename_and_label_links from public.sku_style_guide_links where source_system<>'sheet_declared';
alter function public.prepare_sku_style_guide_resolution(boolean) rename to prepare_sku_style_guide_resolution_actual;
create function public.prepare_sku_style_guide_resolution(p_full boolean default false) returns integer language plpgsql security definer set search_path=public as $$begin perform pg_sleep(2); return public.prepare_sku_style_guide_resolution_actual(p_full); end$$;
set statement_timeout='100ms';
\set ON_ERROR_STOP off
call public.resolve_sku_style_guide_links_run();
\set ON_ERROR_STOP on
set statement_timeout=0;
do $$begin if exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory') then raise exception 'Session lock leaked after cancellation';end if;end$$;
begin;
\set ON_ERROR_STOP off
call public.resolve_sku_style_guide_links_run();
\set ON_ERROR_STOP on
rollback;
do $$begin if exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory') then raise exception 'Session lock leaked after invalid explicit-transaction CALL';end if;end$$;
drop function public.prepare_sku_style_guide_resolution(boolean);
alter function public.prepare_sku_style_guide_resolution_actual(boolean) rename to prepare_sku_style_guide_resolution;
insert into public.sku_files_used select 'SKU-INT-'||g,'Art.PSD','synthetic' from generate_series(1,201) g;
select cron.schedule('sku-style-guide-links-catchup-5608','*/5 * * * *','call public.resolve_sku_style_guide_links_run()');
create table public.test_5608_batch_counter(n integer);
insert into public.test_5608_batch_counter values(0);
alter function public.resolve_sku_style_guide_batch(integer) rename to resolve_sku_style_guide_batch_actual;
create function public.resolve_sku_style_guide_batch(p_batch_size integer default 100) returns jsonb language plpgsql security definer set search_path=public as $$declare n integer;begin update public.test_5608_batch_counter set n=test_5608_batch_counter.n+1 returning test_5608_batch_counter.n into n;if n=2 then raise exception 'synthetic interruption after first committed batch';end if;return public.resolve_sku_style_guide_batch_actual(p_batch_size);end$$;
\set ON_ERROR_STOP off
call public.resolve_sku_style_guide_links_run();
\set ON_ERROR_STOP on
do $$begin
if (select count(*) from public.sku_style_guide_resolver_progress where sku like 'SKU-INT-%')<>100 then raise exception 'Successful batch was not durable';end if;
if not exists(select 1 from cron.job where jobname='sku-style-guide-links-catchup-5608') then raise exception 'Failed catchup unscheduled itself';end if;
if exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory') then raise exception 'Session lock leaked after error';end if;
end$$;
drop function public.resolve_sku_style_guide_batch(integer);
alter function public.resolve_sku_style_guide_batch_actual(integer) rename to resolve_sku_style_guide_batch;
call public.resolve_sku_style_guide_links_run();
do $$begin
if (select count(*) from public.sku_style_guide_resolver_progress where sku like 'SKU-INT-%')<>201 then raise exception 'Interrupted work failed to resume';end if;
if exists(select 1 from cron.job where jobname='sku-style-guide-links-catchup-5608') then raise exception 'Successful catchup failed to unschedule';end if;
end$$;
drop table public.test_5608_batch_counter;
