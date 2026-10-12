-- Rolled-back exact unit6 catalog and synthetic behavior contracts for #2176.
begin;
do $catalog$
declare ok boolean;
begin
with expected_relations(name,kind,columns) as (values
    ('plm.erp_season','r','[["company_code","text"],["division_code","text"],["season_code","text"],["name","text"],["active","boolean"],["erp_created_at","timestamp with time zone"],["erp_updated_at","timestamp with time zone"],["raw","jsonb"],["source_hash","text"],["first_seen_at","timestamp with time zone"],["last_seen_at","timestamp with time zone"],["imported_at","timestamp with time zone"],["updated_at","timestamp with time zone"]]'::jsonb),
    ('plm.erp_salesperson','r','[["company_code","text"],["salesperson_code","text"],["name","text"],["active","boolean"],["erp_created_at","timestamp with time zone"],["erp_updated_at","timestamp with time zone"],["raw","jsonb"],["source_hash","text"],["first_seen_at","timestamp with time zone"],["last_seen_at","timestamp with time zone"],["imported_at","timestamp with time zone"],["updated_at","timestamp with time zone"]]'::jsonb),
    ('plm.coldlion_item_header','v','[["company_code","text"],["division_code","text"],["item_no","text"],["item_desc","text"],["item_display_desc","text"],["item_status","text"],["season_code","text"],["design_no","text"],["product_manager","text"],["brand_assurance_no","text"],["movie_art","text"],["character_likeness","text"],["character_list","text"],["royalty_code","text"],["royalty_code2","text"],["hts_number","text"],["hts_number2","text"],["origin_country","text"],["mg_category","text"],["retail_price","numeric"],["selling_price","numeric"],["compare_price","numeric"],["item_cost","numeric"],["item_price_a","numeric"],["item_price_b","numeric"],["item_price_c","numeric"],["item_price_d","numeric"],["item_length","numeric"],["item_width","numeric"],["item_height","numeric"],["item_weight","numeric"],["item_volume","numeric"],["carton_qty","numeric"],["carton_length","numeric"],["carton_width","numeric"],["carton_height","numeric"],["carton_weight","numeric"],["inner_pack_qty","numeric"],["po_lead_time","numeric"],["mfg_lead_time","numeric"],["sales_person_code1","text"],["sales_person_code2","text"],["active","text"],["item_available","text"],["item_discontinued","text"],["non_inventory_item","text"],["has_image","text"],["contract_sample_sent_date","date"],["contract_sample_date","date"],["annual_sample_sent_date","date"],["annual_sample_date","date"],["contract_sample_qty","numeric"],["annual_sample_qty","numeric"],["prepro_approved","text"],["prepro_approved_date","date"],["erp_created_at","timestamp with time zone"],["erp_updated_at","timestamp with time zone"],["last_seen_at","timestamp with time zone"]]'::jsonb),
    ('plm.coldlion_item_detail','v','[["company_code","text"],["division_code","text"],["item_no","text"],["item_pkey","text"],["label_code","text"],["pre_pack_code","text"],["upc","text"],["item_status","text"],["season_code","text"],["active","text"],["item_available","text"],["item_discontinued","text"],["retail_price","numeric"],["item_cost","numeric"],["selling_price","numeric"],["item_price_a","numeric"],["item_price_b","numeric"],["item_price_c","numeric"],["item_price_d","numeric"],["carton_qty","numeric"],["nmfc_code","text"],["actual_dims","text"],["item_length","numeric"],["item_width","numeric"],["item_height","numeric"],["item_weight","numeric"],["item_volume","numeric"],["carton_length","numeric"],["carton_width","numeric"],["carton_height","numeric"],["carton_weight","numeric"],["inner_pack_qty","numeric"],["hts_number","text"],["royalty_code","text"],["royalty_code2","text"],["sales_person_code1","text"],["sales_person_code2","text"],["erp_created_at","timestamp with time zone"],["erp_updated_at","timestamp with time zone"],["last_seen_at","timestamp with time zone"]]'::jsonb),
    ('plm.coldlion_item_merch_group','v','[["company_code","text"],["division_code","text"],["item_no","text"],["slot_no","smallint"],["mg_code","text"],["last_seen_at","timestamp with time zone"],["id","uuid"],["item_pkey","text"]]'::jsonb),
    ('plm.coldlion_sales_history','v','[["company_code","text"],["division_code","text"],["sales_order_no","bigint"],["sales_order_line_no","integer"],["customer_code","text"],["customer_desc","text"],["po_number","text"],["sales_person_code1","text"],["start_date","date"],["cancel_date","date"],["master_item_no","text"],["label_code","text"],["pre_pack_code","text"],["warehouse_code","text"],["prod_cost","numeric"],["prod_reference_no","text"],["sub_item_no","text"],["sub_label_code","text"],["line_price","numeric"],["component_qty","numeric"],["order_qty","numeric"],["invoice_qty","numeric"],["ship_qty","numeric"],["order_amount","numeric"],["ship_amount","numeric"],["line_id","uuid"],["component_id","uuid"]]'::jsonb),
    ('plm.coldlion_prod_history','v','[["company_code","text"],["division_code","text"],["prod_order_no","bigint"],["prod_line_seq","bigint"],["stage_code","text"],["requested_stage_code","text"],["prod_type_code","text"],["customer_code","text"],["customer_desc","text"],["vendor_code","text"],["vendor_desc","text"],["item_no","text"],["short_item_no","text"],["label_code","text"],["pre_pack_code","text"],["warehouse_code","text"],["warehouse_sku","text"],["prod_country","text"],["freight_forwarder_code","text"],["arrival_port_code","text"],["sales_order_no","bigint"],["sales_order_link_present","boolean"],["prod_reference_no","text"],["cust_po_number","text"],["prod_order_date","date"],["due_date","date"],["ship_date","date"],["receive_date","date"],["prod_order_qty","numeric"],["prepack_qty","numeric"],["total_ppk_qty","numeric"],["prod_cost","numeric"],["ext_cost","numeric"],["total_prod_cost","numeric"],["prepack_item_no","text"],["prepack_item_pkey","text"],["prepack_division_code","text"],["sub_item_no","text"],["line_price","numeric"],["ppk_detail_qty","numeric"],["ppk_detail_cost","numeric"],["line_id","uuid"],["component_id","uuid"]]'::jsonb),
    ('plm.coldlion_prepack_detail','v','[["company_code","text"],["prepack_code","text"],["sequence_no","integer"],["division_code","text"],["item_no","text"],["color_code","text"],["size_code","text"],["dim_code","text"],["label_code","text"],["quantity","integer"],["detail_prepack","text"],["item_cost","numeric"],["item_price","numeric"],["item_price_capitalized","numeric"],["erp_created_at","timestamp with time zone"],["erp_updated_at","timestamp with time zone"],["last_seen_at","timestamp with time zone"]]'::jsonb),
    ('plm.coldlion_prod_detail','v','[["company_code","text"],["pkey","bigint"],["prod_order_no","bigint"],["prod_line_seq","integer"],["division_code","text"],["item_pkey","bigint"],["item_no","text"],["color_code","text"],["size_code","text"],["dim_code","text"],["label_code","text"],["prepack_code","text"],["prod_qty","numeric"],["wip_qty","numeric"],["prod_cost","numeric"],["cust_po_number","text"],["erp_created_at","timestamp with time zone"],["erp_updated_at","timestamp with time zone"],["last_seen_at","timestamp with time zone"]]'::jsonb),
    ('pim.coldlion_item_image_metadata','v','[["company_code","text"],["pkey","bigint"],["resource_id","bigint"],["division_code","text"],["item_no","text"],["color_code","text"],["label_code","text"],["file_name","text"],["file_type","text"],["item_image_desc","text"],["erp_created_at","timestamp with time zone"],["erp_updated_at","timestamp with time zone"],["last_seen_at","timestamp with time zone"]]'::jsonb)
), expected_functions(signature,result_type,volatility,configuration) as (values
    ('plm.import_coldlion_seasons()','TABLE(seasons_seen integer, seasons_upserted integer)','v','search_path=plm, coldlion, extensions, public'),
    ('plm.import_coldlion_salespersons()','TABLE(salespersons_seen integer, salespersons_upserted integer)','v','search_path=plm, coldlion, extensions, public'),
    ('plm.coldlion_merch_group_candidates(text,text)','TABLE(company_code text, division_code text, mg_type_code text, mg_type_desc text, mg_code text, mg_desc text, mg_category text, active text, candidate_kind text, resolution_status text, last_seen_at timestamp with time zone)','s','search_path=plm, coldlion, extensions, public')
), checks as (
select
  true
  and (select count(*) from expected_relations)=10
  and not exists(select 1 from expected_relations e left join pg_class c on c.oid=to_regclass(e.name)
    where c.oid is null or c.relkind::text<>e.kind
      or coalesce((select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod)) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb)<>e.columns
      or not has_table_privilege('authenticated',c.oid,'SELECT') or not has_table_privilege('service_role',c.oid,'SELECT')
      or has_table_privilege('anon',c.oid,'SELECT')
      or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0)
      or (e.kind='v' and has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      or (e.kind='v' and not coalesce(c.reloptions @> array['security_invoker=false','security_barrier=true'],false)))
  and (select count(*) from expected_functions)=3
  and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='plm' and p.proname in ('import_coldlion_seasons','import_coldlion_salespersons','coldlion_merch_group_candidates'))=3
  and not exists(select 1 from expected_functions e left join pg_proc p on p.oid=to_regprocedure(e.signature)
    where p.oid is null or pg_get_function_result(p.oid)<>e.result_type or p.provolatile::text<>e.volatility
      or not p.prosecdef or array_to_string(p.proconfig,',') is distinct from e.configuration
      or not has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')
      or has_function_privilege('authenticated',p.oid,'EXECUTE')<>(p.proname='coldlion_merch_group_candidates'))
  and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='plm' and p.proname='import_coldlion_vendors')
  and not has_schema_privilege('anon','coldlion','USAGE') and not has_schema_privilege('authenticated','coldlion','USAGE')
  and has_schema_privilege('service_role','coldlion','USAGE')
  and not exists(select 1 from pg_class c where c.relnamespace=to_regnamespace('coldlion') and c.relkind in ('r','p','v','m','f')
    and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
  and not exists(select 1 from (values ('plm.erp_season','plm_erp_season_admin_only',array['company_code','division_code','season_code']),('plm.erp_salesperson','plm_erp_salesperson_admin_only',array['company_code','salesperson_code'])) mirrors(name,policy_name,pk)
    join pg_class c on c.oid=to_regclass(mirrors.name)
    where not c.relrowsecurity or c.relforcerowsecurity
      or has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or (select count(*) from pg_policy where polrelid=c.oid)<>1
      or not exists(select 1 from pg_policy p where p.polrelid=c.oid and p.polname=mirrors.policy_name and p.polcmd='r' and p.polpermissive and p.polroles=array[(select oid from pg_roles where rolname='authenticated')]
         and pg_get_expr(p.polqual,p.polrelid)='app.has_role(''administrator''::app.app_role)' and p.polwithcheck is null)
      or not exists(select 1 from pg_constraint p where p.conrelid=c.oid and p.contype='p' and (select array_agg(a.attname::text order by k.ord) from unnest(p.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum)=mirrors.pk))
  and not exists(select 1 from (values ('authenticated','plm'),('authenticated','pim'),('service_role','plm'),('service_role','pim')) consumer(role_name,schema_name) where not has_schema_privilege(consumer.role_name,consumer.schema_name,'USAGE'))
  and not exists(select 1 from (values
    ('coldlion.merch_group_detail',array['company_code','division_code','mg_type_code','mg_category','mg_code']),
    ('plm.erp_licensor',array['company_code','division_code','mg_type_code','mg_code']),
    ('plm.erp_property',array['company_code','division_code','mg_type_code','mg_code'])
  ) dependency(name,pk) where not exists(select 1 from pg_constraint p where p.conrelid=to_regclass(dependency.name) and p.contype='p' and (select array_agg(a.attname::text order by k.ord) from unnest(p.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.attnum)=dependency.pk))
  and has_schema_privilege('authenticated','app','USAGE') and has_function_privilege('authenticated','app.has_role(app.app_role)','EXECUTE')
  as passed
)
select coalesce(passed,false) into ok from checks;

if not ok then raise exception 'unit6 exact catalog contract failed'; end if;
end $catalog$;
-- Synthetic fixtures only. All inserts and importer writes roll back.
insert into coldlion.sync_run(endpoint,requested_by,id) values('/fixture2176','unit6-contract','ac217600-0000-0000-0000-000000000001');
insert into coldlion.season(company_code,division_code,season_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at) values('FIX2176','CW001','S1','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P0','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','Y');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P1','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','y');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P2','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','N');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P3','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','YES');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P4','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','TRUE');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P5','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','T');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P6','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','1');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P7','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic',null);
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P8','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic','');
insert into coldlion.salesperson(company_code,salesperson_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,last_name,active) values('FIX2176','P9','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic',' Y ');
set local role service_role;
do $counter$ declare x record; expected integer; begin
 select count(*) into expected from coldlion.season;
 for i in 1..2 loop select * into x from plm.import_coldlion_seasons(); if x.seasons_seen<>expected or x.seasons_upserted<>expected then raise exception 'unit6 season importer counters failed'; end if; end loop;
 select count(*) into expected from coldlion.salesperson;
 for i in 1..2 loop select * into x from plm.import_coldlion_salespersons(); if x.salespersons_seen<>expected or x.salespersons_upserted<>expected then raise exception 'unit6 salesperson importer counters failed'; end if; end loop;
end $counter$;
reset role;
do $importers$ begin
 if (select count(*) from plm.erp_salesperson where company_code='FIX2176')<>10
    or exists(select 1 from plm.erp_salesperson where company_code='FIX2176' and active is distinct from case when salesperson_code in ('P0','P1') then true when salesperson_code in ('P7','P8') then null else false end)
    or exists(select 1 from plm.erp_salesperson where company_code='FIX2176' and (name<>'Synthetic' or source_hash<>'82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82' or first_seen_at<>'2026-10-11T12:00:00Z'::timestamptz))
    or not exists(select 1 from plm.erp_season where company_code='FIX2176' and name='S1' and active is null)
 then raise exception 'unit6 strict-Y/idempotency/raw identity importer contract failed'; end if;
end $importers$;
update coldlion.salesperson set last_name='Synthetic changed', source_hash='82eb950f000cc969b6651b97de8f0bb4917b95881af5de4de371cadba673eed7', last_seen_at='2026-10-12T12:00:00Z' where company_code='FIX2176' and salesperson_code='P0';
set local role service_role;
select * from plm.import_coldlion_salespersons();
reset role;
do $update$ begin
 if not exists(select 1 from plm.erp_salesperson where company_code='FIX2176' and salesperson_code='P0' and name='Synthetic changed' and source_hash='82eb950f000cc969b6651b97de8f0bb4917b95881af5de4de371cadba673eed7' and first_seen_at='2026-10-11T12:00:00Z' and last_seen_at='2026-10-12T12:00:00Z' and raw->>'lastName'='Synthetic changed') then raise exception 'unit6 importer update lost original first sighting or raw'; end if;
end $update$;
-- Exercise both actual signup triggers; invitation-only access remains enforced.
do $signup_denial$ begin
 if not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created' and tgfoid=to_regprocedure('app.handle_new_auth_user()') and tgenabled='O' and not tgisinternal)
   or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created_popdam' and tgfoid=to_regprocedure('public.handle_new_user()') and tgenabled='O' and not tgisinternal)
 then raise exception 'unit6 fixture requires both actual signup triggers'; end if;
 begin
   insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values('ac217600-0000-0000-0001-000000000006','unit6-uninvited@fixture.invalid','{}','{}');
   raise exception 'unit6 uninvited signup was allowed';
 exception when raise_exception then
   if sqlerrm <> 'Access denied: no valid invitation found for unit6-uninvited@fixture.invalid' then raise; end if;
 end;
 if exists(select 1 from auth.users where id='ac217600-0000-0000-0001-000000000006')
    or exists(select 1 from app.profile where auth_user_id='ac217600-0000-0000-0001-000000000006')
    or exists(select 1 from public.profiles where user_id='ac217600-0000-0000-0001-000000000006')
 then raise exception 'unit6 refused signup left partial identity rows'; end if;
end $signup_denial$;
insert into public.invitations(email) select 'unit6-'||i||'@fixture.invalid' from generate_series(1,5) i;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values('ac217600-0000-0000-0001-000000000001','unit6-1@fixture.invalid','{"full_name":"Synthetic Unit6"}'::jsonb,'{}'::jsonb);
insert into app.profile(auth_user_id,email,status) values('ac217600-0000-0000-0001-000000000001','unit6-1@fixture.invalid','active') on conflict(auth_user_id) do update set email=excluded.email,status=excluded.status;
insert into app.user_role(profile_id,role_id,revoked_at) select p.id,r.id,null from app.profile p cross join app.role r where p.auth_user_id='ac217600-0000-0000-0001-000000000001' and r.slug='administrator' on conflict(profile_id,role_id) do update set revoked_at=excluded.revoked_at;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values('ac217600-0000-0000-0001-000000000002','unit6-2@fixture.invalid','{"full_name":"Synthetic Unit6"}'::jsonb,'{}'::jsonb);
insert into app.profile(auth_user_id,email,status) values('ac217600-0000-0000-0001-000000000002','unit6-2@fixture.invalid','active') on conflict(auth_user_id) do update set email=excluded.email,status=excluded.status;
insert into app.user_role(profile_id,role_id,revoked_at) select p.id,r.id,null from app.profile p cross join app.role r where p.auth_user_id='ac217600-0000-0000-0001-000000000002' and r.slug='viewer' on conflict(profile_id,role_id) do update set revoked_at=excluded.revoked_at;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values('ac217600-0000-0000-0001-000000000003','unit6-3@fixture.invalid','{"full_name":"Synthetic Unit6"}'::jsonb,'{}'::jsonb);
insert into app.profile(auth_user_id,email,status) values('ac217600-0000-0000-0001-000000000003','unit6-3@fixture.invalid','inactive') on conflict(auth_user_id) do update set email=excluded.email,status=excluded.status;
insert into app.user_role(profile_id,role_id,revoked_at) select p.id,r.id,null from app.profile p cross join app.role r where p.auth_user_id='ac217600-0000-0000-0001-000000000003' and r.slug='administrator' on conflict(profile_id,role_id) do update set revoked_at=excluded.revoked_at;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values('ac217600-0000-0000-0001-000000000004','unit6-4@fixture.invalid','{"full_name":"Synthetic Unit6"}'::jsonb,'{}'::jsonb);
insert into app.profile(auth_user_id,email,status) values('ac217600-0000-0000-0001-000000000004','unit6-4@fixture.invalid','active') on conflict(auth_user_id) do update set email=excluded.email,status=excluded.status;
insert into app.user_role(profile_id,role_id,revoked_at) select p.id,r.id,now() from app.profile p cross join app.role r where p.auth_user_id='ac217600-0000-0000-0001-000000000004' and r.slug='administrator' on conflict(profile_id,role_id) do update set revoked_at=excluded.revoked_at;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values('ac217600-0000-0000-0001-000000000005','unit6-5@fixture.invalid','{"full_name":"Synthetic Unit6"}'::jsonb,'{}'::jsonb);
do $invited_signup$ begin
 if (select count(*) from public.invitations where email in (select 'unit6-'||i||'@fixture.invalid' from generate_series(1,5) i) and accepted_at is not null)<>5
   or (select count(*) from public.profiles where email in (select 'unit6-'||i||'@fixture.invalid' from generate_series(1,5) i))<>5
   or (select count(*) from app.profile where email in (select 'unit6-'||i||'@fixture.invalid' from generate_series(1,5) i))<>5
   or exists(select 1 from auth.users u where u.email in (select 'unit6-'||i||'@fixture.invalid' from generate_series(1,5) i)
     and (not exists(select 1 from public.user_roles r where r.user_id=u.id and r.role='user'::public.app_role)
       or not exists(select 1 from public.app_access a where a.user_id=u.id and a.app='popdam'::public.app_name)))
 then raise exception 'unit6 invited signup did not consume invitations and provision actual profiles/default access'; end if;
end $invited_signup$;
delete from app.profile where auth_user_id='ac217600-0000-0000-0001-000000000005';
set local role authenticated;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000001", "role": "authenticated", "app_metadata": {"roles": []}}',true);
do $access$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>1 or (select count(*) from plm.erp_salesperson where company_code='FIX2176')<>10 then raise exception 'unit6 actual profile role case 1 failed'; end if; end $access$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000002", "role": "authenticated", "app_metadata": {"roles": []}}',true);
do $access$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 or (select count(*) from plm.erp_salesperson where company_code='FIX2176')<>0 then raise exception 'unit6 actual profile role case 2 failed'; end if; end $access$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000003", "role": "authenticated", "app_metadata": {"roles": []}}',true);
do $access$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 or (select count(*) from plm.erp_salesperson where company_code='FIX2176')<>0 then raise exception 'unit6 actual profile role case 3 failed'; end if; end $access$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000004", "role": "authenticated", "app_metadata": {"roles": []}}',true);
do $access$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 or (select count(*) from plm.erp_salesperson where company_code='FIX2176')<>0 then raise exception 'unit6 actual profile role case 4 failed'; end if; end $access$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000005", "role": "authenticated", "app_metadata": {"roles": []}}',true);
do $access$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 or (select count(*) from plm.erp_salesperson where company_code='FIX2176')<>0 then raise exception 'unit6 actual profile role case 5 failed'; end if; end $access$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000004", "role": "authenticated"}',true);
do $jwt$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 then raise exception 'unit6 JWT missing semantics failed'; end if; end $jwt$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000004", "role": "authenticated", "user_metadata": {"roles": ["administrator"]}}',true);
do $jwt$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 then raise exception 'unit6 JWT user metadata semantics failed'; end if; end $jwt$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000004", "role": "administrator"}',true);
do $jwt$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 then raise exception 'unit6 JWT top-level semantics failed'; end if; end $jwt$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000004", "role": "authenticated", "app_metadata": {"roles": ["administrator"]}}',true);
do $jwt$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>1 then raise exception 'unit6 JWT trusted admin semantics failed'; end if; end $jwt$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000004", "role": "authenticated", "app_metadata": {"roles": ["ADMINISTRATOR"]}}',true);
do $jwt$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>1 then raise exception 'unit6 JWT case-insensitive semantics failed'; end if; end $jwt$;
select set_config('request.jwt.claims','{"sub": "ac217600-0000-0000-0001-000000000004", "role": "authenticated", "app_metadata": {"roles": null}}',true);
do $jwt$ begin if (select count(*) from plm.erp_season where company_code='FIX2176')<>0 then raise exception 'unit6 JWT null semantics failed'; end if; end $jwt$;
do $denials$ begin
 begin insert into plm.erp_season(company_code,division_code,season_code,name,source_hash) values('FIX2176','CW001','DENIED','DENIED','x'); raise exception 'authenticated INSERT was allowed'; exception when insufficient_privilege then null; end;
 begin update plm.erp_season set name='DENIED'; raise exception 'authenticated UPDATE was allowed'; exception when insufficient_privilege then null; end;
 begin delete from plm.erp_season; raise exception 'authenticated DELETE was allowed'; exception when insufficient_privilege then null; end;
 begin perform * from plm.import_coldlion_seasons(); raise exception 'authenticated importer was allowed'; exception when insufficient_privilege then null; end;
 begin perform * from coldlion.season; raise exception 'authenticated landing SELECT was allowed'; exception when insufficient_privilege then null; end;
end $denials$;
select set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"roles":"administrator"}}',true);
do $malformed$ begin
 begin perform * from plm.erp_season; raise exception 'malformed roles granted access'; exception when invalid_parameter_value then null; end;
end $malformed$;
reset role;
set local role anon;
do $anonymous$ begin
 begin perform * from plm.erp_season; raise exception 'anonymous SELECT was allowed'; exception when insufficient_privilege then null; end;
 begin perform * from plm.coldlion_merch_group_candidates(null,null); raise exception 'anonymous candidate EXECUTE was allowed'; exception when insufficient_privilege then null; end;
end $anonymous$;
reset role;
select set_config('request.jwt.claims','{}',true);
insert into coldlion.item_header(company_code,division_code,item_no,run_id,fetched_at,source_hash,first_seen_at,last_seen_at) values('FIX2176','CW001','I1','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z');
insert into coldlion.item_detail(company_code,division_code,item_no,item_pkey,run_id,fetched_at,source_hash,first_seen_at,last_seen_at) values('FIX2176','CW001','I1','SKU1','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z');
insert into coldlion.item_merch_group(company_code,division_code,item_no,slot_no,mg_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,id,item_pkey) values('FIX2176','CW001','I1','6','NEW','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','ac217600-0000-0000-0002-000000000001',null);
insert into coldlion.item_merch_group(company_code,division_code,item_no,slot_no,mg_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,id,item_pkey) values('FIX2176','CW001','I1','6','NEW','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','82c888e56adf4c7c829192ef283ab2ad773b197de4dd7047313fd9e9ae2a0b82','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','ac217600-0000-0000-0002-000000000002','SKU1');
insert into coldlion.prod_history_line(company_code,prod_order_no,prod_line_seq,requested_stage_code,stage_code,source_observed_at,line_source_hash,run_id,fetched_at,id,prod_order_qty,prepack_qty,total_ppk_qty) values('FIX2176','1','1','ISS','ISS','2026-10-11T12:00:00Z','750f7eda495bfdb2e6c52c5b7d767da4f33e2633683373a2f914e96c0a7407a8','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','ac217600-0000-0000-0003-000000000001','12','2','24');
insert into coldlion.prod_history_line(company_code,prod_order_no,prod_line_seq,requested_stage_code,stage_code,source_observed_at,line_source_hash,run_id,fetched_at,id,prod_order_qty,prepack_qty,total_ppk_qty) values('FIX2176','2','1','ISS','ISS','2026-10-11T12:00:00Z','d30c129a9fd5d36f098de00711066f9566aa1922e7296e3bab783d74edb61a64','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','ac217600-0000-0000-0003-000000000002','12','2','24');
insert into coldlion.prod_history_component(line_id,component_source_hash,run_id,fetched_at,id,sub_item_no,ppk_detail_qty) values('ac217600-0000-0000-0003-000000000001','bef8417d013eb0600a4c5dccc8e690ffa6876af5f3cc643481164e33b61f4bed','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','ac217600-0000-0000-0004-000000000001','SKU1','1');
insert into coldlion.prod_history_component(line_id,component_source_hash,run_id,fetched_at,id,sub_item_no,ppk_detail_qty) values('ac217600-0000-0000-0003-000000000001','d226d92ca45eeb6571ffac2fb9133c8f7763567bf22c9fee20d3364d6eedfbef','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','ac217600-0000-0000-0004-000000000002','SKU2','2');
insert into coldlion.order_history_line(sales_order_no,sales_order_line_no,master_item_no,line_source_hash,run_id,fetched_at,id,company_code) values('1','1','I1','188d79be2c98f9df67c9a6386a445c844a2ca70fe6da3710350fd84a04cd975e','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','ac217600-0000-0000-0005-000000000001','FIX2176');
insert into coldlion.order_history_component(line_id,component_source_hash,run_id,fetched_at,id,sub_item_no,order_qty) values('ac217600-0000-0000-0005-000000000001','54787fd34957fcfd93a11d58fa804205c02ebb3e0d6a0b5ab9c57de5d6b40f7e','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','ac217600-0000-0000-0006-000000000001','SKU1','1');
insert into coldlion.order_history_component(line_id,component_source_hash,run_id,fetched_at,id,sub_item_no,order_qty) values('ac217600-0000-0000-0005-000000000001','e550ee24f9cb25142417ac3b9724f42a7d847fee0227f45e161b858264db83b7','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','ac217600-0000-0000-0006-000000000002','SKU2','2');
set local role authenticated;
do $grain$ begin
 if (select count(*) from plm.coldlion_item_merch_group where company_code='FIX2176')<>2
   or (select count(distinct id) from plm.coldlion_item_merch_group where company_code='FIX2176')<>2
   or (select count(*) from plm.coldlion_item_merch_group where company_code='FIX2176' and item_pkey is null)<>1
   or (select count(*) from plm.coldlion_prod_history where company_code='FIX2176')<>3
   or (select count(*) from plm.coldlion_prod_history where company_code='FIX2176' and component_id is null)<>1
   or (select sum(parent_qty) from(select max(prod_order_qty) parent_qty from plm.coldlion_prod_history where company_code='FIX2176' group by line_id) parents)<>24
   or (select sum(prod_order_qty) from plm.coldlion_prod_history where company_code='FIX2176')<>36
   or (select count(distinct component_id) from plm.coldlion_sales_history where company_code='FIX2176')<>2
   or (select sum(order_qty) from plm.coldlion_sales_history where company_code='FIX2176')<>3
 then raise exception 'unit6 stable merchandise/history grain or preserved quantities failed'; end if;
end $grain$;
reset role;
insert into coldlion.merch_group_header(company_code,division_code,mg_type_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_type_desc) values('FIX2176','CW001','05','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Licensor');
insert into coldlion.merch_group_header(company_code,division_code,mg_type_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_type_desc) values('FIX2176','CW001','06','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Property');
insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc) values('FIX2176','CW001','05','SAME','CAT_A','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic Licensor');
insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc) values('FIX2176','CW001','05','SAME','CAT_B','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic Licensor Other Category');
insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc) values('FIX2176','CW001','06','SAME','CAT_A','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic Property');
insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc) values('FIX2176','CW001','06','SAME','CAT_B','ac217600-0000-0000-0000-000000000001','2026-10-11T12:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-10-11T12:00:00Z','2026-10-11T12:00:00Z','Synthetic Property Other Category');
insert into plm.merch_group_header(company_code,division_code,mg_type_code,mg_type_desc) values('FIX2176','CW001','05','Licensor'),('FIX2176','CW001','06','Property');
insert into plm.erp_licensor(company_code,division_code,mg_type_code,mg_code,mg_type_desc,name,raw,source_hash,resolution_status) values('FIX2176','CW001','05','SAME','Licensor','Synthetic Licensor','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','ignored');
insert into plm.erp_property(company_code,division_code,mg_type_code,mg_code,mg_type_desc,name,raw,source_hash,resolution_status) values('FIX2176','CW001','06','SAME','Property','Synthetic Property','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','ignored');
set local role authenticated;
do $candidates$ begin
 if (select count(*) from plm.coldlion_merch_group_candidates('FIX2176','CW001'))<>4
   or (select count(distinct candidate_kind) from plm.coldlion_merch_group_candidates('FIX2176','CW001'))<>2
   or exists(select 1 from plm.coldlion_merch_group_candidates('FIX2176','CW001') where resolution_status<>'ignored' or mg_code<>'SAME'
       or mg_category not in ('CAT_A','CAT_B'))
   or exists(select 1 from (select candidate_kind from plm.coldlion_merch_group_candidates('FIX2176','CW001') group by candidate_kind having count(*)<>2 or count(distinct mg_category)<>2) broken_category_grain)
   or exists(select 1 from plm.coldlion_merch_group_candidates('FIX2176','OTHER'))
 then raise exception 'unit6 candidate category grain, shared mirror resolution or no-auto-link contract failed'; end if;
end $candidates$;
reset role;
rollback;
