-- #5608: run AFTER the eight-portal fixture in an explicitly disposable cluster.
-- This synthetic fixture installs the forward migration and commits local work.
\set ON_ERROR_STOP on
do $$begin if current_setting('app.sku_sg_disposable',true) is distinct from 'yes' then
 raise exception 'This fixture requires an explicitly disposable database';end if;end$$;
-- Exact duplicate observations remain a multiset, never a unique temp index.
insert into plm.dcp_asset(id,style_guide_id,file_name) select md5('snapshot-dcp-duplicate')::uuid,style_guide_id,file_name from plm.dcp_asset where file_name='Art.PSD' limit 1;
insert into plm.lucasfilm_dcp_asset(id,style_guide_id,file_name) select md5('snapshot-lucas-duplicate')::uuid,style_guide_id,file_name from plm.lucasfilm_dcp_asset limit 1;
insert into plm.marvel_dcp_asset(id,style_guide_id,file_name) select md5('snapshot-marvel-duplicate')::uuid,style_guide_id,file_name from plm.marvel_dcp_asset limit 1;
insert into plm.marvel_asgard_node_asset_observation(guide_node_id,exact_filename) select guide_node_id,exact_filename from plm.marvel_asgard_node_asset_observation limit 1;
insert into plm.nbcu_asset_style_guide select * from plm.nbcu_asset_style_guide limit 1;
insert into plm.wb_asset_style_guide_normalized select * from plm.wb_asset_style_guide_normalized limit 1;
insert into plm.peanuts_asset(capture_id,file_name,style_guide_key) select capture_id,file_name,style_guide_key from plm.peanuts_asset limit 1;
insert into plm.sesame_asset_style_guide select * from plm.sesame_asset_style_guide limit 1;
select public.resolve_sku_style_guide_links();
create table snapshot_expected_output as select sku,file_name,source_system,source_style_guide_key,style_guide_label,match_method,match_confidence,matched_asset_count,core_style_guide_id from public.sku_style_guide_links;
create table snapshot_expected_portal as select * from plm.asset_file_style_guide_index;
create table snapshot_expected_nightly as select jobid,jobname,schedule,username,active from cron.job where jobname='resolve-sku-style-guide-links-nightly';
begin;
\ir ../../../../supabase/migrations/20261105061627_sku_style_guide_resolution_snapshot.sql
commit;
do $$begin
 if not exists(select from cron.job j join snapshot_expected_nightly e using(jobid) where j.jobname=e.jobname and j.schedule=e.schedule and j.username=e.username and j.active=e.active and j.command='call public.resolve_sku_style_guide_links_run() /* shared-db:20261105061627 */') then raise exception 'Existing nightly identity changed';end if;
 if exists((select source_system,file_name_norm,source_style_guide_key,style_guide_label,core_style_guide_id,matched_file_name from plm.asset_file_style_guide_keys except all table snapshot_expected_portal) union all (table snapshot_expected_portal except all select source_system,file_name_norm,source_style_guide_key,style_guide_label,core_style_guide_id,matched_file_name from plm.asset_file_style_guide_keys)) then raise exception 'Ready all-eight multiset changed';end if;
end$$;
select public.resolve_sku_style_guide_links();
do $$begin
 if exists((select sku,file_name,source_system,source_style_guide_key,style_guide_label,match_method,match_confidence,matched_asset_count,core_style_guide_id from public.sku_style_guide_links except all table snapshot_expected_output) union all (table snapshot_expected_output except all select sku,file_name,source_system,source_style_guide_key,style_guide_label,match_method,match_confidence,matched_asset_count,core_style_guide_id from public.sku_style_guide_links)) then raise exception 'All-three-arm output changed';end if;
 if (select count(distinct source_system) from pg_temp.sku_sg_portal)<>8 then raise exception 'Portal arm missing';end if;
end$$;
-- Force the pending phase without source changes, only inside this disposable DB.
do $$declare t text; c text;begin
 foreach t in array array['dcp_asset','lucasfilm_dcp_asset','marvel_dcp_asset','marvel_asgard_node_asset_observation','nbcu_asset','wb_asset_normalized','peanuts_asset','sesame_asset'] loop
 execute format('alter table plm.%I disable trigger sku_sg_file_key',t);
 execute format('update plm.%I set sku_sg_file_key=null',t);
 execute format('alter table plm.%I enable trigger sku_sg_file_key',t);
 end loop;
 foreach t in array array['dcp_style_guide','lucasfilm_dcp_style_guide','marvel_dcp_style_guide','marvel_asgard_style_guide','nbcu_style_guide','wb_style_guide_normalized','peanuts_style_guide','sesame_style_guide'] loop
 execute format('alter table plm.%I disable trigger sku_sg_label_key',t);
 execute format('update plm.%I set sku_sg_label_key=null',t);
 execute format('alter table plm.%I enable trigger sku_sg_label_key',t);
 end loop;
 if exists((select source_system,file_name_norm,source_style_guide_key,style_guide_label,core_style_guide_id,matched_file_name from plm.asset_file_style_guide_keys except all table plm.asset_file_style_guide_index) union all (table plm.asset_file_style_guide_index except all select source_system,file_name_norm,source_style_guide_key,style_guide_label,core_style_guide_id,matched_file_name from plm.asset_file_style_guide_keys)) or exists(select from plm.asset_file_style_guide_keys where style_guide_label_key is distinct from public.style_guide_label_norm(style_guide_label)) then raise exception 'Pending all-eight fallback changed';end if;
end$$;
call public.resolve_sku_style_guide_links_run();
-- A nonblank extension-only filename normalizes to NULL in ALL eight portals.
update plm.dcp_asset set file_name='.psd';
update plm.lucasfilm_dcp_asset set file_name='.psd';
update plm.marvel_dcp_asset set file_name='.psd';
update plm.marvel_asgard_node_asset_observation set exact_filename='.psd';
update plm.nbcu_asset set file_name='.psd';
update plm.wb_asset_normalized set file_name='.psd';
update plm.peanuts_asset set file_name='.psd';
update plm.sesame_asset set original_file_name='.psd';
call public.resolve_sku_style_guide_links_run();
call public.resolve_sku_style_guide_links_run();
do $$begin
 if (select count(distinct source_system) from pg_temp.sku_sg_portal where file_name_norm is null)<>8 or (select count(distinct source_system) from public.sku_style_guide_links where sku='SKU-ALL' and file_name is null and match_method='sheet_label_match')<>8 then raise exception 'NULL filename removed valid portal labels';end if;
 if public.prepare_sku_style_guide_resolution(false)<>0 then raise exception 'Repeated same-session CALL did not converge';end if;
end$$;
