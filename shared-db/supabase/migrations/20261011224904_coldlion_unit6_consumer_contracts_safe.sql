begin;
-- derived-from: none
-- Standalone never-installed replacement of immutable PR3839 dd269428fc3953e98366142cec24c71e25d71b09.
-- Original20261005025111 retired by receipt6328e126316baca16b7f3d842f79a769599f478c after slot7 REVISE.
-- Fresh reservation48460174599ba8a580e818389eb9f06070345e67; claim3838 nineteen objects.
-- =====================================================================================
-- Issue #2176 - ColdLion landing UNIT 6: consumer-safe promotion contracts.
--
-- Tracker: #2081. Plan: plan_coldlion_landing_schema_completion.md section 9 Step 8.
-- Author lane claim: #3838. Reserved version: 20261011224904. Structure only; this
-- migration loads no rows.
--
-- WHAT THIS UNIT PUBLISHES
-- ------------------------
-- Application roles must remain unable to query coldlion.*. Authorized consumers read
-- reviewed fields only through stable contracts:
--
--   * customer / vendor / season / salesperson promotion extends the plm.erp_* path.
--     plm.erp_customer and plm.erp_vendor already exist and stay the promotion
--     destination; this unit creates plm.erp_season and plm.erp_salesperson additively
--     and their landing-to-mirror importers.
--   * merch_group_header/detail -> read-only candidates function only. Licensor/property
--     link stays hand-curated; codes are unique only per division+type, never alone.
--   * item_header / item_detail / item_merch_group, production history, prepack and
--     prod detail -> plm.* views.
--   * sales history -> plm.* component view of approved per-design quantities only.
--     NO fulfilment inference from document-number presence. NO source-document type
--     claim: ColdLion exposes no source-document marker (plan section 6.6).
--   * item image metadata -> pim.* view (landing under #2179 / 20260929093750).
--   * pickticket and receiving are out of scope (owner 2026-09-13).
--   * schema coldlion keeps no app-role grants (closed posture, schema-level).
--
-- NEVER CREATED HERE
-- ------------------
--   plm.import_coldlion_vendors does NOT exist live (dropped by 20260722213000 in
--   favour of the guarded vendor importer). Vendor promotion uses that guarded path.
--   This migration does not invent, recreate, or assume it.
--
-- NO AUTOMATIC PROMOTION INTO core.*
-- ---------------------------------
-- Per the settled placement (issue #2176, 2026-09-28): no automatic promotion into
-- core.* without a separately reviewed authority rule. Season and salesperson
-- promotion stops at plm.erp_*.
--
-- LAYER RULES
-- -----------
--   * Views use security_invoker=false so they can read closed coldlion.* landing
--     tables on the consumer's behalf. Consumers never receive landing grants.
--   * Two administrator-only SELECT policies are claimed explicitly; no new indexes or triggers.
--   * Landing provenance (run_id, source_hash, first_seen_at, fetched_at) stays out of
--     consumer contracts except source last_seen_at where available. Histories expose
--     stable grain IDs and quantities; no shared freshness field is invented.
--   * User-defined fields (udf*) stay out: their business meaning is not established.
--   * prod_detail.item_desc and prod_detail.merch_group_05_desc stay out of the
--     consumer contract: the landing comments mark them as not exposable without an
--     owner ruling.
-- =====================================================================================

do $preflight$
begin
  if exists (
    select 1 from (values
    ('app.profile','id','uuid'),
    ('app.profile','auth_user_id','uuid'),
    ('app.profile','status','app.entity_status'),
    ('app.role','id','uuid'),
    ('app.role','slug','app.app_role'),
    ('app.user_role','profile_id','uuid'),
    ('app.user_role','role_id','uuid'),
    ('app.user_role','revoked_at','timestamp with time zone'),
    ('coldlion.customer','company_code','text'),
    ('coldlion.customer','customer_code','text'),
    ('coldlion.item_detail','active','text'),
    ('coldlion.item_detail','actual_dims','text'),
    ('coldlion.item_detail','carton_height','numeric'),
    ('coldlion.item_detail','carton_length','numeric'),
    ('coldlion.item_detail','carton_qty','numeric'),
    ('coldlion.item_detail','carton_weight','numeric'),
    ('coldlion.item_detail','carton_width','numeric'),
    ('coldlion.item_detail','company_code','text'),
    ('coldlion.item_detail','created_time','timestamp with time zone'),
    ('coldlion.item_detail','division_code','text'),
    ('coldlion.item_detail','hts_number','text'),
    ('coldlion.item_detail','inner_pack_qty','numeric'),
    ('coldlion.item_detail','item_available','text'),
    ('coldlion.item_detail','item_cost','numeric'),
    ('coldlion.item_detail','item_discontinued','text'),
    ('coldlion.item_detail','item_height','numeric'),
    ('coldlion.item_detail','item_length','numeric'),
    ('coldlion.item_detail','item_no','text'),
    ('coldlion.item_detail','item_pkey','text'),
    ('coldlion.item_detail','item_price_a','numeric'),
    ('coldlion.item_detail','item_price_b','numeric'),
    ('coldlion.item_detail','item_price_c','numeric'),
    ('coldlion.item_detail','item_price_d','numeric'),
    ('coldlion.item_detail','item_status','text'),
    ('coldlion.item_detail','item_volume','numeric'),
    ('coldlion.item_detail','item_weight','numeric'),
    ('coldlion.item_detail','item_width','numeric'),
    ('coldlion.item_detail','label_code','text'),
    ('coldlion.item_detail','last_seen_at','timestamp with time zone'),
    ('coldlion.item_detail','mod_time','timestamp with time zone'),
    ('coldlion.item_detail','nmfc_code','text'),
    ('coldlion.item_detail','pre_pack_code','text'),
    ('coldlion.item_detail','retail_price','numeric'),
    ('coldlion.item_detail','royalty_code','text'),
    ('coldlion.item_detail','royalty_code2','text'),
    ('coldlion.item_detail','sales_person_code1','text'),
    ('coldlion.item_detail','sales_person_code2','text'),
    ('coldlion.item_detail','season_code','text'),
    ('coldlion.item_detail','selling_price','numeric'),
    ('coldlion.item_detail','upc','text'),
    ('coldlion.item_header','active','text'),
    ('coldlion.item_header','annual_sample_date','date'),
    ('coldlion.item_header','annual_sample_qty','numeric'),
    ('coldlion.item_header','annual_sample_sent_date','date'),
    ('coldlion.item_header','brand_assurance_no','text'),
    ('coldlion.item_header','carton_height','numeric'),
    ('coldlion.item_header','carton_length','numeric'),
    ('coldlion.item_header','carton_qty','numeric'),
    ('coldlion.item_header','carton_weight','numeric'),
    ('coldlion.item_header','carton_width','numeric'),
    ('coldlion.item_header','character_likeness','text'),
    ('coldlion.item_header','character_list','text'),
    ('coldlion.item_header','company_code','text'),
    ('coldlion.item_header','compare_price','numeric'),
    ('coldlion.item_header','contract_sample_date','date'),
    ('coldlion.item_header','contract_sample_qty','numeric'),
    ('coldlion.item_header','contract_sample_sent_date','date'),
    ('coldlion.item_header','created_time','timestamp with time zone'),
    ('coldlion.item_header','design_no','text'),
    ('coldlion.item_header','division_code','text'),
    ('coldlion.item_header','has_image','text'),
    ('coldlion.item_header','hts_number','text'),
    ('coldlion.item_header','hts_number2','text'),
    ('coldlion.item_header','inner_pack_qty','numeric'),
    ('coldlion.item_header','item_available','text'),
    ('coldlion.item_header','item_cost','numeric'),
    ('coldlion.item_header','item_desc','text'),
    ('coldlion.item_header','item_discontinued','text'),
    ('coldlion.item_header','item_display_desc','text'),
    ('coldlion.item_header','item_height','numeric'),
    ('coldlion.item_header','item_length','numeric'),
    ('coldlion.item_header','item_no','text'),
    ('coldlion.item_header','item_price_a','numeric'),
    ('coldlion.item_header','item_price_b','numeric'),
    ('coldlion.item_header','item_price_c','numeric'),
    ('coldlion.item_header','item_price_d','numeric'),
    ('coldlion.item_header','item_status','text'),
    ('coldlion.item_header','item_volume','numeric'),
    ('coldlion.item_header','item_weight','numeric'),
    ('coldlion.item_header','item_width','numeric'),
    ('coldlion.item_header','last_seen_at','timestamp with time zone'),
    ('coldlion.item_header','mfg_lead_time','numeric'),
    ('coldlion.item_header','mg_category','text'),
    ('coldlion.item_header','mod_time','timestamp with time zone'),
    ('coldlion.item_header','movie_art','text'),
    ('coldlion.item_header','non_inventory_item','text'),
    ('coldlion.item_header','origin_country','text'),
    ('coldlion.item_header','po_lead_time','numeric'),
    ('coldlion.item_header','prepro_approved','text'),
    ('coldlion.item_header','prepro_approved_date','date'),
    ('coldlion.item_header','product_manager','text'),
    ('coldlion.item_header','retail_price','numeric'),
    ('coldlion.item_header','royalty_code','text'),
    ('coldlion.item_header','royalty_code2','text'),
    ('coldlion.item_header','sales_person_code1','text'),
    ('coldlion.item_header','sales_person_code2','text'),
    ('coldlion.item_header','season_code','text'),
    ('coldlion.item_header','selling_price','numeric'),
    ('coldlion.item_image_metadata','color_code','text'),
    ('coldlion.item_image_metadata','company_code','text'),
    ('coldlion.item_image_metadata','created_time','timestamp with time zone'),
    ('coldlion.item_image_metadata','division_code','text'),
    ('coldlion.item_image_metadata','file_name','text'),
    ('coldlion.item_image_metadata','file_type','text'),
    ('coldlion.item_image_metadata','item_image_desc','text'),
    ('coldlion.item_image_metadata','item_no','text'),
    ('coldlion.item_image_metadata','label_code','text'),
    ('coldlion.item_image_metadata','last_seen_at','timestamp with time zone'),
    ('coldlion.item_image_metadata','mod_time','timestamp with time zone'),
    ('coldlion.item_image_metadata','pkey','bigint'),
    ('coldlion.item_image_metadata','resource_id','bigint'),
    ('coldlion.item_merch_group','company_code','text'),
    ('coldlion.item_merch_group','division_code','text'),
    ('coldlion.item_merch_group','id','uuid'),
    ('coldlion.item_merch_group','item_no','text'),
    ('coldlion.item_merch_group','item_pkey','text'),
    ('coldlion.item_merch_group','last_seen_at','timestamp with time zone'),
    ('coldlion.item_merch_group','mg_code','text'),
    ('coldlion.item_merch_group','slot_no','smallint'),
    ('coldlion.merch_group_detail','active','text'),
    ('coldlion.merch_group_detail','company_code','text'),
    ('coldlion.merch_group_detail','division_code','text'),
    ('coldlion.merch_group_detail','last_seen_at','timestamp with time zone'),
    ('coldlion.merch_group_detail','mg_category','text'),
    ('coldlion.merch_group_detail','mg_code','text'),
    ('coldlion.merch_group_detail','mg_desc','text'),
    ('coldlion.merch_group_detail','mg_type_code','text'),
    ('coldlion.merch_group_header','company_code','text'),
    ('coldlion.merch_group_header','division_code','text'),
    ('coldlion.merch_group_header','mg_type_code','text'),
    ('coldlion.merch_group_header','mg_type_desc','text'),
    ('coldlion.order_history_component','id','uuid'),
    ('coldlion.order_history_component','invoice_qty','numeric'),
    ('coldlion.order_history_component','line_id','uuid'),
    ('coldlion.order_history_component','line_price','numeric'),
    ('coldlion.order_history_component','order_amount','numeric'),
    ('coldlion.order_history_component','order_qty','numeric'),
    ('coldlion.order_history_component','quantity','numeric'),
    ('coldlion.order_history_component','ship_amount','numeric'),
    ('coldlion.order_history_component','ship_qty','numeric'),
    ('coldlion.order_history_component','sub_item_no','text'),
    ('coldlion.order_history_component','sub_label_code','text'),
    ('coldlion.order_history_line','cancel_date','date'),
    ('coldlion.order_history_line','company_code','text'),
    ('coldlion.order_history_line','customer_code','text'),
    ('coldlion.order_history_line','customer_desc','text'),
    ('coldlion.order_history_line','division_code','text'),
    ('coldlion.order_history_line','id','uuid'),
    ('coldlion.order_history_line','label_code','text'),
    ('coldlion.order_history_line','master_item_no','text'),
    ('coldlion.order_history_line','po_number','text'),
    ('coldlion.order_history_line','pre_pack_code','text'),
    ('coldlion.order_history_line','prod_cost','numeric'),
    ('coldlion.order_history_line','prod_reference_no','text'),
    ('coldlion.order_history_line','sales_order_line_no','integer'),
    ('coldlion.order_history_line','sales_order_no','bigint'),
    ('coldlion.order_history_line','sales_person_code1','text'),
    ('coldlion.order_history_line','start_date','date'),
    ('coldlion.order_history_line','warehouse_code','text'),
    ('coldlion.prepack_detail','color_code','text'),
    ('coldlion.prepack_detail','company_code','text'),
    ('coldlion.prepack_detail','created_time','timestamp with time zone'),
    ('coldlion.prepack_detail','detail_prepack','text'),
    ('coldlion.prepack_detail','dim_code','text'),
    ('coldlion.prepack_detail','division_code','text'),
    ('coldlion.prepack_detail','item_cost','numeric'),
    ('coldlion.prepack_detail','item_no','text'),
    ('coldlion.prepack_detail','item_price','numeric'),
    ('coldlion.prepack_detail','item_price_capitalized','numeric'),
    ('coldlion.prepack_detail','label_code','text'),
    ('coldlion.prepack_detail','last_seen_at','timestamp with time zone'),
    ('coldlion.prepack_detail','mod_time','timestamp with time zone'),
    ('coldlion.prepack_detail','prepack_code','text'),
    ('coldlion.prepack_detail','quantity','integer'),
    ('coldlion.prepack_detail','sequence_no','integer'),
    ('coldlion.prepack_detail','size_code','text'),
    ('coldlion.prod_detail','color_code','text'),
    ('coldlion.prod_detail','company_code','text'),
    ('coldlion.prod_detail','created_time','timestamp with time zone'),
    ('coldlion.prod_detail','cust_po_number','text'),
    ('coldlion.prod_detail','dim_code','text'),
    ('coldlion.prod_detail','division_code','text'),
    ('coldlion.prod_detail','item_no','text'),
    ('coldlion.prod_detail','item_pkey','bigint'),
    ('coldlion.prod_detail','label_code','text'),
    ('coldlion.prod_detail','last_seen_at','timestamp with time zone'),
    ('coldlion.prod_detail','mod_time','timestamp with time zone'),
    ('coldlion.prod_detail','pkey','bigint'),
    ('coldlion.prod_detail','prepack_code','text'),
    ('coldlion.prod_detail','prod_cost','numeric'),
    ('coldlion.prod_detail','prod_line_seq','integer'),
    ('coldlion.prod_detail','prod_order_no','bigint'),
    ('coldlion.prod_detail','prod_qty','numeric'),
    ('coldlion.prod_detail','size_code','text'),
    ('coldlion.prod_detail','wip_qty','numeric'),
    ('coldlion.prod_history_component','id','uuid'),
    ('coldlion.prod_history_component','line_id','uuid'),
    ('coldlion.prod_history_component','line_price','numeric'),
    ('coldlion.prod_history_component','ppk_detail_cost','numeric'),
    ('coldlion.prod_history_component','ppk_detail_qty','numeric'),
    ('coldlion.prod_history_component','prepack_division_code','text'),
    ('coldlion.prod_history_component','prepack_item_no','text'),
    ('coldlion.prod_history_component','prepack_item_pkey','text'),
    ('coldlion.prod_history_component','sub_item_no','text'),
    ('coldlion.prod_history_line','arrival_port_code','text'),
    ('coldlion.prod_history_line','company_code','text'),
    ('coldlion.prod_history_line','cust_po_number','text'),
    ('coldlion.prod_history_line','customer_code','text'),
    ('coldlion.prod_history_line','customer_desc','text'),
    ('coldlion.prod_history_line','division_code','text'),
    ('coldlion.prod_history_line','due_date','date'),
    ('coldlion.prod_history_line','ext_cost','numeric'),
    ('coldlion.prod_history_line','freight_forwarder_code','text'),
    ('coldlion.prod_history_line','id','uuid'),
    ('coldlion.prod_history_line','item_no','text'),
    ('coldlion.prod_history_line','label_code','text'),
    ('coldlion.prod_history_line','pre_pack_code','text'),
    ('coldlion.prod_history_line','prepack_qty','numeric'),
    ('coldlion.prod_history_line','prod_cost','numeric'),
    ('coldlion.prod_history_line','prod_country','text'),
    ('coldlion.prod_history_line','prod_line_seq','bigint'),
    ('coldlion.prod_history_line','prod_order_date','date'),
    ('coldlion.prod_history_line','prod_order_no','bigint'),
    ('coldlion.prod_history_line','prod_order_qty','numeric'),
    ('coldlion.prod_history_line','prod_reference_no','text'),
    ('coldlion.prod_history_line','prod_type_code','text'),
    ('coldlion.prod_history_line','receive_date','date'),
    ('coldlion.prod_history_line','requested_stage_code','text'),
    ('coldlion.prod_history_line','sales_order_link_present','boolean'),
    ('coldlion.prod_history_line','sales_order_no','bigint'),
    ('coldlion.prod_history_line','ship_date','date'),
    ('coldlion.prod_history_line','short_item_no','text'),
    ('coldlion.prod_history_line','stage_code','text'),
    ('coldlion.prod_history_line','total_ppk_qty','numeric'),
    ('coldlion.prod_history_line','total_prod_cost','numeric'),
    ('coldlion.prod_history_line','vendor_code','text'),
    ('coldlion.prod_history_line','vendor_desc','text'),
    ('coldlion.prod_history_line','warehouse_code','text'),
    ('coldlion.prod_history_line','warehouse_sku','text'),
    ('coldlion.salesperson','active','text'),
    ('coldlion.salesperson','company_code','text'),
    ('coldlion.salesperson','created_time','timestamp with time zone'),
    ('coldlion.salesperson','first_seen_at','timestamp with time zone'),
    ('coldlion.salesperson','last_name','text'),
    ('coldlion.salesperson','last_seen_at','timestamp with time zone'),
    ('coldlion.salesperson','mod_time','timestamp with time zone'),
    ('coldlion.salesperson','salesperson_code','text'),
    ('coldlion.salesperson','source_hash','text'),
    ('coldlion.season','company_code','text'),
    ('coldlion.season','created_time','timestamp with time zone'),
    ('coldlion.season','division_code','text'),
    ('coldlion.season','first_seen_at','timestamp with time zone'),
    ('coldlion.season','last_seen_at','timestamp with time zone'),
    ('coldlion.season','mod_time','timestamp with time zone'),
    ('coldlion.season','season_code','text'),
    ('coldlion.season','source_hash','text'),
    ('coldlion.sync_run','id','uuid'),
    ('coldlion.vendor','company_code','text'),
    ('coldlion.vendor','vendor_code','text'),
    ('plm.erp_customer','customer_code','text'),
    ('plm.erp_licensor','company_code','text'),
    ('plm.erp_licensor','division_code','text'),
    ('plm.erp_licensor','mg_code','text'),
    ('plm.erp_licensor','mg_type_code','text'),
    ('plm.erp_licensor','resolution_status','text'),
    ('plm.erp_property','company_code','text'),
    ('plm.erp_property','division_code','text'),
    ('plm.erp_property','mg_code','text'),
    ('plm.erp_property','mg_type_code','text'),
    ('plm.erp_property','resolution_status','text'),
    ('plm.erp_vendor','vendor_code','text')
    ) required(relation_name,column_name,column_type)
    left join pg_class c on c.oid=to_regclass(required.relation_name)
    left join pg_attribute a on a.attrelid=c.oid and a.attname=required.column_name and a.attnum>0 and not a.attisdropped
    where c.oid is null or c.relkind not in ('r','p') or a.attnum is null
       or format_type(a.atttypid,a.atttypmod) <> required.column_type
  ) then raise exception 'unit6 required dependency relation kind/column/type missing or changed'; end if;
  if exists(select 1 from (values ('plm.erp_season'), ('plm.erp_salesperson'), ('plm.coldlion_item_header'), ('plm.coldlion_item_detail'), ('plm.coldlion_item_merch_group'), ('plm.coldlion_sales_history'), ('plm.coldlion_prod_history'), ('plm.coldlion_prepack_detail'), ('plm.coldlion_prod_detail'), ('pim.coldlion_item_image_metadata')) owned(name) where to_regclass(name) is not null)
     or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='plm' and p.proname in ('import_coldlion_seasons', 'import_coldlion_salespersons', 'coldlion_merch_group_candidates'))
  then raise exception 'unit6 unexpected owned object already exists; refusing overwrite'; end if;
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('app.has_role(app.app_role)') and p.prorettype='boolean'::regtype and p.provolatile='s' and p.prosecdef and p.proconfig @> array['search_path=app, public'])
     or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('app.current_profile_id()') and p.prorettype='uuid'::regtype and p.provolatile='s' and p.prosecdef)
     or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('app.jwt_role_names()') and p.prorettype='text[]'::regtype and p.provolatile='s')
     or to_regprocedure('app.has_role(app.app_role)') is null
     or not exists(select 1 from pg_enum e where e.enumtypid=to_regtype('app.app_role') and e.enumlabel='administrator')
     or not has_schema_privilege('authenticated','app','USAGE')
     or not has_function_privilege('authenticated','app.has_role(app.app_role)','EXECUTE')
     or to_regprocedure('plm.import_coldlion_customers(jsonb)') is null
     or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='plm' and p.proname='import_coldlion_vendors')
  then raise exception 'unit6 required administrator/customer authority contract missing or forbidden vendor importer present'; end if;
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_am am on am.oid=(select relam from pg_class where oid=i.indexrelid)
      where c.oid=to_regclass('coldlion.prod_detail') and i.indisvalid and i.indisready and am.amname='btree'
       and i.indpred is null and i.indexprs is null and i.indnkeyatts=2
       and (select array_agg(a.attname::text order by k.ord) from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where k.ord<=i.indnkeyatts)=array['company_code','prod_order_no'])
  then raise exception 'unit6 previously installed prod_detail serving index required'; end if;
  if exists(select 1 from (values
    ('coldlion.sync_run',array['id']),
    ('coldlion.merch_group_header',array['company_code','division_code','mg_type_code']),
    ('coldlion.merch_group_detail',array['company_code','division_code','mg_type_code','mg_category','mg_code']),
    ('plm.erp_licensor',array['company_code','division_code','mg_type_code','mg_code']),
    ('plm.erp_property',array['company_code','division_code','mg_type_code','mg_code']),
    ('coldlion.item_header',array['company_code','division_code','item_no']),
    ('coldlion.item_detail',array['company_code','division_code','item_no','item_pkey']),
    ('coldlion.customer',array['company_code','customer_code']),
    ('coldlion.vendor',array['company_code','vendor_code']),
    ('coldlion.season',array['company_code','division_code','season_code']),
    ('coldlion.salesperson',array['company_code','salesperson_code']),
    ('coldlion.item_merch_group',array['id']),
    ('coldlion.order_history_line',array['id']),
    ('coldlion.order_history_component',array['id']),
    ('coldlion.prod_history_line',array['id']),
    ('coldlion.prod_history_component',array['id']),
    ('coldlion.prepack_detail',array['company_code','prepack_code','sequence_no']),
    ('coldlion.prod_detail',array['company_code','pkey']),
    ('coldlion.item_image_metadata',array['company_code','pkey'])
  ) expected(name,columns) where not exists(select 1 from pg_constraint p where p.conrelid=to_regclass(expected.name) and p.contype='p' and (select array_agg(a.attname::text order by k.ord) from unnest(p.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.num)=expected.columns))
  then raise exception 'unit6 required source primary-key grain missing or changed'; end if;
  if not exists(select 1 from pg_constraint p where p.conrelid=to_regclass('coldlion.item_merch_group') and p.contype='u' and (select array_agg(a.attname::text order by k.ord) from unnest(p.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.num)=array['company_code','division_code','item_no','item_pkey','slot_no'] and (select indnullsnotdistinct from pg_index where indexrelid=p.conindid))
  then raise exception 'unit6 merchandise NULLS NOT DISTINCT header/SKU identity required'; end if;
  if to_regnamespace('pim') is null or to_regnamespace('plm') is null or to_regnamespace('app') is null
  then raise exception 'unit6 required consumer schemas missing'; end if;
  if exists(select 1 from (values ('authenticated','plm'),('authenticated','pim'),('service_role','plm'),('service_role','pim')) consumer(role_name,schema_name)
    where not has_schema_privilege(consumer.role_name,consumer.schema_name,'USAGE'))
  then raise exception 'unit6 existing consumer schema USAGE required'; end if;
end
$preflight$;


-- =====================================================================================
-- 1. Schema coldlion stays closed to application roles.
--    Written at SCHEMA level so this unit never opens a write on any landing table.
-- =====================================================================================
revoke all on all tables in schema coldlion from public, anon, authenticated;
revoke usage on schema coldlion from public, anon, authenticated;
grant usage on schema coldlion to service_role;
grant select, insert, update, delete on all tables in schema coldlion to service_role;

-- =====================================================================================
-- 2. Customer / vendor promotion path already on main. Touch the durable contract
--    comments only; do not rewrite the live importer body.
-- =====================================================================================
comment on table plm.erp_customer is
  'Typed Coldlion ERP (Edge Home) /customers mirror and the customer promotion destination under issue #2176 unit 6. Every Coldlion customer (active + inactive), keyed by customerCode. customer_id links to the canonical core.customer only for active accounts that were promoted (see plm.import_coldlion_customers). Consumers read this table; they never read coldlion.customer. No automatic promotion into core.* beyond the existing importer contract.';

comment on table plm.erp_vendor is
  'Typed Coldlion ERP (Edge Home) /vendors mirror and the vendor promotion destination under issue #2176 unit 6. Every Coldlion vendor (active + inactive), keyed by vendorCode. factory_id links to the canonical core.factory only for active vendors promoted by the guarded vendor importer (20260722213000). plm.import_coldlion_vendors does NOT exist and must not be recreated. Consumers read this table; they never read coldlion.vendor.';

comment on function plm.import_coldlion_customers(jsonb) is
  'Idempotently imports a Coldlion /customers payload array: raw -> ingest.raw_record, typed -> plm.erp_customer, and (active=Y only) resolves into core.customer + core.company_source_ref (source_system=coldlion). Matches existing canonical customers by normalized name to avoid duplicates. Issue #2176 unit 6 keeps this as the customer promotion function; consumers read plm.erp_customer, never coldlion.customer.';

-- =====================================================================================
-- 3. Season promotion objects (additive). Natural key follows coldlion.season:
--    (company_code, division_code, season_code). /seasons exposes no active marker
--    and no separate name, and this unit invents neither.
-- =====================================================================================
create table plm.erp_season (
  company_code   text        not null,
  division_code  text        not null,
  season_code    text        not null,
  -- /seasons returns only the code. Name is the code; do not invent a label.
  name           text        not null,
  -- NULL: ColdLion has no active marker on this endpoint (landing comment).
  active         boolean,
  erp_created_at timestamptz,
  erp_updated_at timestamptz,
  raw            jsonb       not null default '{}'::jsonb,
  source_hash    text        not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  imported_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (company_code, division_code, season_code)
);

comment on table plm.erp_season is
  'Typed ColdLion /seasons mirror and the season promotion destination (issue #2176 unit 6). Grain is one season code within one division within one company - never season_code alone. name is the code because the endpoint exposes no separate label. active is NULL because ColdLion has no active marker here; none is invented and last_seen_at is never read as one. source_hash is SHA-256 over the complete fetched record before projection, carried from coldlion.season for idempotent re-pull change detection. Consumers read this table; they never read coldlion.season.';

create table plm.erp_salesperson (
  company_code     text        not null,
  salesperson_code text        not null,
  -- coldlion.salesperson.last_name under its own promoted name. Widening the
  -- personal-data projection requires a NEW owner ruling (#2081 comment 5519623574).
  name             text,
  active           boolean,
  erp_created_at   timestamptz,
  erp_updated_at   timestamptz,
  raw              jsonb       not null default '{}'::jsonb,
  source_hash      text        not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  imported_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (company_code, salesperson_code)
);

comment on table plm.erp_salesperson is
  'Typed ColdLion /salespersons mirror and the salesperson promotion destination (issue #2176 unit 6). Grain is one sales rep within one company - NOT division-scoped. Deliberately narrow by owner ruling #2081 comment 5519623574: name, code, company and active status only. name is coldlion.salesperson.last_name as returned (this layer does not compose a display name). active is interpreted from the feed single-character flag and is NULL when blank; never guessed. E-mail, telephone, home address, commission and quota stay declined as personal data. Widening requires a NEW owner ruling. Consumers read this table; they never read coldlion.salesperson.';

alter table plm.erp_season enable row level security;
create policy plm_erp_season_admin_only on plm.erp_season
  for select to authenticated using (app.has_role('administrator'::app.app_role));

alter table plm.erp_salesperson enable row level security;
create policy plm_erp_salesperson_admin_only on plm.erp_salesperson
  for select to authenticated using (app.has_role('administrator'::app.app_role));

revoke all on plm.erp_season from public, anon, authenticated;
revoke all on plm.erp_salesperson from public, anon, authenticated;
grant select on plm.erp_season to authenticated;
grant select on plm.erp_salesperson to authenticated;
grant all on plm.erp_season to service_role;
grant all on plm.erp_salesperson to service_role;

-- =====================================================================================
-- 4. Season / salesperson landing-to-mirror importers.
--    Promote coldlion.season / coldlion.salesperson into plm.erp_*. No core.* write.
-- =====================================================================================
create function plm.import_coldlion_seasons()
returns table (
  seasons_seen      integer,
  seasons_upserted  integer
)
language plpgsql
security definer
set search_path = plm, coldlion, extensions, public
as $$
declare
  v_seen     integer;
  v_upserted integer;
begin
  select count(*) into v_seen from coldlion.season;

  insert into plm.erp_season (
    company_code, division_code, season_code,
    name, active,
    erp_created_at, erp_updated_at,
    raw, source_hash, first_seen_at, last_seen_at
  )
  select
    s.company_code,
    s.division_code,
    s.season_code,
    s.season_code,
    null::boolean,
    s.created_time,
    s.mod_time,
    jsonb_build_object(
      'companyCode',  s.company_code,
      'divisionCode', s.division_code,
      'seasonCode',   s.season_code
    ),
    s.source_hash,
    s.first_seen_at,
    s.last_seen_at
  from coldlion.season s
  on conflict (company_code, division_code, season_code) do update set
    name           = excluded.name,
    erp_created_at = excluded.erp_created_at,
    erp_updated_at = excluded.erp_updated_at,
    raw            = excluded.raw,
    source_hash    = excluded.source_hash,
    last_seen_at   = excluded.last_seen_at,
    updated_at     = now();

  get diagnostics v_upserted = row_count;
  return query select v_seen, v_upserted;
end
$$;

comment on function plm.import_coldlion_seasons is
  'Promotes coldlion.season into plm.erp_season additively (issue #2176 unit 6). Upsert on (company_code, division_code, season_code). first_seen_at never moves forward. No core.* write and no invented active flag. Structure only until a loader calls it.';

create function plm.import_coldlion_salespersons()
returns table (
  salespersons_seen     integer,
  salespersons_upserted integer
)
language plpgsql
security definer
set search_path = plm, coldlion, extensions, public
as $$
declare
  v_seen     integer;
  v_upserted integer;
begin
  select count(*) into v_seen from coldlion.salesperson;

  insert into plm.erp_salesperson (
    company_code, salesperson_code,
    name, active,
    erp_created_at, erp_updated_at,
    raw, source_hash, first_seen_at, last_seen_at
  )
  select
    s.company_code,
    s.salesperson_code,
    s.last_name,
    case
      when s.active is null or btrim(s.active) = '' then null
      when upper(s.active) = 'Y' then true
      else false
    end,
    s.created_time,
    s.mod_time,
    jsonb_build_object(
      'companyCode',      s.company_code,
      'salesPersonCode',  s.salesperson_code,
      'lastName',         s.last_name,
      'active',           s.active
    ),
    s.source_hash,
    s.first_seen_at,
    s.last_seen_at
  from coldlion.salesperson s
  on conflict (company_code, salesperson_code) do update set
    name           = excluded.name,
    active         = excluded.active,
    erp_created_at = excluded.erp_created_at,
    erp_updated_at = excluded.erp_updated_at,
    raw            = excluded.raw,
    source_hash    = excluded.source_hash,
    last_seen_at   = excluded.last_seen_at,
    updated_at     = now();

  get diagnostics v_upserted = row_count;
  return query select v_seen, v_upserted;
end
$$;

comment on function plm.import_coldlion_salespersons is
  'Promotes coldlion.salesperson into plm.erp_salesperson additively (issue #2176 unit 6). Upsert on (company_code, salesperson_code). Preserves the owner-approved narrow projection only (name, code, company, active). No core.* write. Structure only until a loader calls it.';

revoke all on function plm.import_coldlion_seasons() from public, anon, authenticated;
revoke all on function plm.import_coldlion_salespersons() from public, anon, authenticated;
grant execute on function plm.import_coldlion_seasons() to service_role;
grant execute on function plm.import_coldlion_salespersons() to service_role;

-- =====================================================================================
-- 5. Merch-group candidates (read-only). Offers candidates only; never links.
--    Codes are unique per division+type, never alone. Licensor/property link stays
--    hand-curated under the existing authority rules.
-- =====================================================================================
create function plm.coldlion_merch_group_candidates(
  p_company_code  text default null,
  p_division_code text default null
)
returns table (
  company_code     text,
  division_code    text,
  mg_type_code     text,
  mg_type_desc     text,
  mg_code          text,
  mg_desc          text,
  mg_category      text,
  active           text,
  candidate_kind   text,
  resolution_status text,
  last_seen_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = plm, coldlion, extensions, public
as $$
begin
  return query
  select
    h.company_code,
    h.division_code,
    h.mg_type_code,
    h.mg_type_desc,
    d.mg_code,
    d.mg_desc,
    d.mg_category,
    d.active,
    case
      when lower(btrim(h.mg_type_desc)) = 'licensor' then 'licensor'
      when lower(btrim(h.mg_type_desc)) = 'property' then 'property'
    end as candidate_kind,
    coalesce(l.resolution_status, p.resolution_status, 'unresolved') as resolution_status,
    d.last_seen_at
  from coldlion.merch_group_header h
  join coldlion.merch_group_detail d
    on  d.company_code  = h.company_code
    and d.division_code = h.division_code
    and d.mg_type_code  = h.mg_type_code
  left join plm.erp_licensor l
    on  l.company_code  = h.company_code
    and l.division_code = h.division_code
    and l.mg_type_code  = h.mg_type_code
    and l.mg_code       = d.mg_code
    and lower(btrim(h.mg_type_desc)) = 'licensor'
  left join plm.erp_property p
    on  p.company_code  = h.company_code
    and p.division_code = h.division_code
    and p.mg_type_code  = h.mg_type_code
    and p.mg_code       = d.mg_code
    and lower(btrim(h.mg_type_desc)) = 'property'
  where lower(btrim(h.mg_type_desc)) in ('licensor', 'property')
    and (p_company_code  is null or h.company_code  = p_company_code)
    and (p_division_code is null or h.division_code = p_division_code);
end
$$;

comment on function plm.coldlion_merch_group_candidates is
  'Read-only merch-group candidates for hand-curated licensor/property linking (issue #2176 unit 6). Offers candidates only: this function never writes, never auto-links, and never promotes into core.*. Landing candidate identity is (company, division, mg_type_code, mg_category, mg_code): repeated codes in different categories remain separate rows. The mirror resolution identity is (company, division, mg_type_code, mg_code), so one existing mirror resolution legitimately applies across those categories. resolution_status is observed from plm.erp_licensor / plm.erp_property and is never mutated.';

revoke all on function plm.coldlion_merch_group_candidates(text, text) from public, anon, authenticated;
grant execute on function plm.coldlion_merch_group_candidates(text, text) to authenticated, service_role;

-- =====================================================================================
-- 6. Item header consumer contract.
--    Reviewed commercial and descriptive fields only. UDF fields stay out.
-- =====================================================================================
create view plm.coldlion_item_header
with (security_invoker = false, security_barrier = true) as
select
  h.company_code,
  h.division_code,
  h.item_no,
  h.item_desc,
  h.item_display_desc,
  h.item_status,
  h.season_code,
  h.design_no,
  h.product_manager,
  h.brand_assurance_no,
  h.movie_art,
  h.character_likeness,
  h.character_list,
  h.royalty_code,
  h.royalty_code2,
  h.hts_number,
  h.hts_number2,
  h.origin_country,
  h.mg_category,
  h.retail_price,
  h.selling_price,
  h.compare_price,
  h.item_cost,
  h.item_price_a,
  h.item_price_b,
  h.item_price_c,
  h.item_price_d,
  h.item_length,
  h.item_width,
  h.item_height,
  h.item_weight,
  h.item_volume,
  h.carton_qty,
  h.carton_length,
  h.carton_width,
  h.carton_height,
  h.carton_weight,
  h.inner_pack_qty,
  h.po_lead_time,
  h.mfg_lead_time,
  h.sales_person_code1,
  h.sales_person_code2,
  h.active,
  h.item_available,
  h.item_discontinued,
  h.non_inventory_item,
  h.has_image,
  h.contract_sample_sent_date,
  h.contract_sample_date,
  h.annual_sample_sent_date,
  h.annual_sample_date,
  h.contract_sample_qty,
  h.annual_sample_qty,
  h.prepro_approved,
  h.prepro_approved_date,
  h.created_time as erp_created_at,
  h.mod_time    as erp_updated_at,
  h.last_seen_at
from coldlion.item_header h;

comment on view plm.coldlion_item_header is
  'Consumer contract over coldlion.item_header (issue #2176 unit 6). Reviewed item-master fields only: identity, description, commercial prices, physical dimensions, classification, status and sample flags. UDF fields are excluded (business meaning not established). Landing provenance other than last_seen_at stays out. Consumers never receive grants on coldlion.item_header.';

revoke all on plm.coldlion_item_header from public, anon, authenticated, service_role;
grant select on plm.coldlion_item_header to authenticated, service_role;

-- =====================================================================================
-- 7. Item detail (SKU) consumer contract.
-- =====================================================================================
create view plm.coldlion_item_detail
with (security_invoker = false, security_barrier = true) as
select
  d.company_code,
  d.division_code,
  d.item_no,
  d.item_pkey,
  d.label_code,
  d.pre_pack_code,
  d.upc,
  d.item_status,
  d.season_code,
  d.active,
  d.item_available,
  d.item_discontinued,
  d.retail_price,
  d.item_cost,
  d.selling_price,
  d.item_price_a,
  d.item_price_b,
  d.item_price_c,
  d.item_price_d,
  d.carton_qty,
  d.nmfc_code,
  d.actual_dims,
  d.item_length,
  d.item_width,
  d.item_height,
  d.item_weight,
  d.item_volume,
  d.carton_length,
  d.carton_width,
  d.carton_height,
  d.carton_weight,
  d.inner_pack_qty,
  d.hts_number,
  d.royalty_code,
  d.royalty_code2,
  d.sales_person_code1,
  d.sales_person_code2,
  d.created_time as erp_created_at,
  d.mod_time    as erp_updated_at,
  d.last_seen_at
from coldlion.item_detail d;

comment on view plm.coldlion_item_detail is
  'Consumer contract over coldlion.item_detail (issue #2176 unit 6). One row per ColdLion SKU (item_pkey). Colour and size are deliberately absent from the landing layer and therefore from this contract. Merch-group slots are deliberately absent here: they are rows in coldlion.item_merch_group, exposed through plm.coldlion_item_merch_group. UDF fields excluded. Consumers never receive grants on coldlion.item_detail.';

revoke all on plm.coldlion_item_detail from public, anon, authenticated, service_role;
grant select on plm.coldlion_item_detail to authenticated, service_role;

-- =====================================================================================
-- 8. Item merch-group slots consumer contract.
-- =====================================================================================
create view plm.coldlion_item_merch_group
with (security_invoker = false, security_barrier = true) as
select
  g.company_code,
  g.division_code,
  g.item_no,
  g.slot_no,
  g.mg_code,
  g.last_seen_at,
  g.id,
  g.item_pkey
from coldlion.item_merch_group g;

comment on view plm.coldlion_item_merch_group is
  'Consumer contract over coldlion.item_merch_group (issue #2176 unit 6). One row per existing id: company/division/item/item_pkey/slot, with NULL item_pkey for header scope. All fourteen ColdLion merch-group slots as rows. A cleared slot is deleted by the current-state loader; this view never synthesises empty slots. Consumers never receive grants on coldlion.item_merch_group.';

revoke all on plm.coldlion_item_merch_group from public, anon, authenticated, service_role;
grant select on plm.coldlion_item_merch_group to authenticated, service_role;

-- =====================================================================================
-- 9. Sales-history aggregate consumer contract.
--    APPROVED PER-DESIGN QUANTITIES ONLY.
--    No fulfilment inference from document-number presence.
--    No source-document type claim of any kind (plan section 6.6).
-- =====================================================================================
create view plm.coldlion_sales_history
with (security_invoker = false, security_barrier = true) as
select
  l.company_code,
  l.division_code,
  l.sales_order_no,
  l.sales_order_line_no,
  l.customer_code,
  l.customer_desc,
  l.po_number,
  l.sales_person_code1,
  l.start_date,
  l.cancel_date,
  l.master_item_no,
  l.label_code,
  l.pre_pack_code,
  l.warehouse_code,
  l.prod_cost,
  l.prod_reference_no,
  c.sub_item_no,
  c.sub_label_code,
  c.line_price,
  c.quantity    as component_qty,
  c.order_qty,
  c.invoice_qty,
  c.ship_qty,
  c.order_amount,
  c.ship_amount,
  l.id as line_id,
  c.id as component_id
from coldlion.order_history_line l
join coldlion.order_history_component c
  on c.line_id = l.id;

comment on view plm.coldlion_sales_history is
  'Consumer contract over ColdLion sales history (issue #2176 unit 6). One row per order-line component design; line_id identifies the parent and component_id identifies the component. Exposes the approved per-design quantities and amounts only (order_qty, invoice_qty, ship_qty, order_amount, ship_amount, line_price). MUST NOT infer fulfilment from document-number presence: an invoice number never proves the row was invoiced. MUST NOT claim a source-document type: ColdLion exposes no source-document marker (plan section 6.6). Invoice and pick-ticket tokens stay on the landing tables and are deliberately absent here. Parent line_qty is a parent total and is never summed across components.';

revoke all on plm.coldlion_sales_history from public, anon, authenticated, service_role;
grant select on plm.coldlion_sales_history to authenticated, service_role;

-- =====================================================================================
-- 10. Production-history consumer contract.
-- =====================================================================================
create view plm.coldlion_prod_history
with (security_invoker = false, security_barrier = true) as
select
  l.company_code,
  l.division_code,
  l.prod_order_no,
  l.prod_line_seq,
  l.stage_code,
  l.requested_stage_code,
  l.prod_type_code,
  l.customer_code,
  l.customer_desc,
  l.vendor_code,
  l.vendor_desc,
  l.item_no,
  l.short_item_no,
  l.label_code,
  l.pre_pack_code,
  l.warehouse_code,
  l.warehouse_sku,
  l.prod_country,
  l.freight_forwarder_code,
  l.arrival_port_code,
  l.sales_order_no,
  l.sales_order_link_present,
  l.prod_reference_no,
  l.cust_po_number,
  l.prod_order_date,
  l.due_date,
  l.ship_date,
  l.receive_date,
  l.prod_order_qty,
  l.prepack_qty,
  l.total_ppk_qty,
  l.prod_cost,
  l.ext_cost,
  l.total_prod_cost,
  c.prepack_item_no,
  c.prepack_item_pkey,
  c.prepack_division_code,
  c.sub_item_no,
  c.line_price,
  c.ppk_detail_qty,
  c.ppk_detail_cost,
  l.id as line_id,
  c.id as component_id
from coldlion.prod_history_line l
left join coldlion.prod_history_component c
  on c.line_id = l.id;

comment on view plm.coldlion_prod_history is
  'Consumer contract over ColdLion production history (issue #2176 unit 6). One row per purchase-line version times component; line_id identifies the parent, component_id the component. A parent without components remains as a header-only row with NULL component_id. prod_order_qty, prepack_qty and total_ppk_qty are repeated parent totals; count once per line_id. sales_order_no = 0 means no linked sales order and is never joined on. last_prod_cost lives on the landing lookup table and is deliberately absent: it is another production''s cost. Parent totals are never summed across components. Consumers never receive grants on coldlion.prod_history_*.';

revoke all on plm.coldlion_prod_history from public, anon, authenticated, service_role;
grant select on plm.coldlion_prod_history to authenticated, service_role;

-- =====================================================================================
-- 11. Prepack-detail consumer contract.
-- =====================================================================================
create view plm.coldlion_prepack_detail
with (security_invoker = false, security_barrier = true) as
select
  p.company_code,
  p.prepack_code,
  p.sequence_no,
  p.division_code,
  p.item_no,
  p.color_code,
  p.size_code,
  p.dim_code,
  p.label_code,
  p.quantity,
  p.detail_prepack,
  p.item_cost,
  p.item_price,
  p.item_price_capitalized,
  p.created_time as erp_created_at,
  p.mod_time    as erp_updated_at,
  p.last_seen_at
from coldlion.prepack_detail p;

comment on view plm.coldlion_prepack_detail is
  'Consumer contract over coldlion.prepack_detail (issue #2176 unit 6). One row per company + prepackCode + sequence. quantity is the recipe multiplier (how many of this SKU are in one prepack), never an order quantity. item_price and item_price_capitalized are ColdLion''s duplicate-cased properties and are both exposed; they are never folded.';

revoke all on plm.coldlion_prepack_detail from public, anon, authenticated, service_role;
grant select on plm.coldlion_prepack_detail to authenticated, service_role;

-- =====================================================================================
-- 12. Prod-detail consumer contract.
--     item_desc and merch_group_05_desc stay out (landing ruling: not exposable
--     without an owner ruling).
-- =====================================================================================
create view plm.coldlion_prod_detail
with (security_invoker = false, security_barrier = true) as
select
  d.company_code,
  d.pkey,
  d.prod_order_no,
  d.prod_line_seq,
  d.division_code,
  d.item_pkey,
  d.item_no,
  d.color_code,
  d.size_code,
  d.dim_code,
  d.label_code,
  d.prepack_code,
  d.prod_qty,
  d.wip_qty,
  d.prod_cost,
  d.cust_po_number,
  d.created_time as erp_created_at,
  d.mod_time    as erp_updated_at,
  d.last_seen_at
from coldlion.prod_detail d;

comment on view plm.coldlion_prod_detail is
  'Consumer contract over coldlion.prod_detail (issue #2176 unit 6). One row per production-order LINE. prod_detail.item_desc and prod_detail.merch_group_05_desc are deliberately absent: the landing layer marks them as not exposable without an owner ruling. wip_qty is recorded as sent and never derived.';

revoke all on plm.coldlion_prod_detail from public, anon, authenticated, service_role;
grant select on plm.coldlion_prod_detail to authenticated, service_role;

-- =====================================================================================
-- 13. Item image metadata consumer contract (pim.*).
--     Metadata only. Image bytes are excluded from the landing layer entirely.
-- =====================================================================================
create view pim.coldlion_item_image_metadata
with (security_invoker = false, security_barrier = true) as
select
  i.company_code,
  i.pkey,
  i.resource_id,
  i.division_code,
  i.item_no,
  i.color_code,
  i.label_code,
  i.file_name,
  i.file_type,
  i.item_image_desc,
  i.created_time as erp_created_at,
  i.mod_time    as erp_updated_at,
  i.last_seen_at
from coldlion.item_image_metadata i;

comment on view pim.coldlion_item_image_metadata is
  'Consumer contract over coldlion.item_image_metadata (issue #2176 unit 6). Metadata only: file name, type and description. resourceContent and thumbnail128 (image bytes) are excluded from the landing layer and have no column. resource_id is descriptive and is NOT an identity (8 duplicate groups over 75 sampled rows); pkey is the only proven identity. hasImage=Y is not proof a row exists.';

revoke all on pim.coldlion_item_image_metadata from public, anon, authenticated, service_role;
grant select on pim.coldlion_item_image_metadata to authenticated, service_role;


-- Atomic post-apply exact catalog verification: no row mutation or importer invocation.
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

commit;
