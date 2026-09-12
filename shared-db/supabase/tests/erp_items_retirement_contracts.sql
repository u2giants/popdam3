-- #2482 contract: the frozen DesignFlow item feed is retired to the archive schema,
-- recoverably, and nothing live still reads it.

do $$
declare
  v_n integer;
  v_list text;
  v_prediction uuid;
  v_item uuid;
  v_legacy uuid;
begin
  -- Positive control: the checks below must be able to see a real table and routine.
  if to_regclass('plm.style_tracker_item_bridge') is null
     or to_regprocedure('plm.refresh_style_tracker_item_bridge()') is null then
    raise exception '#2482 control: catalog lookups cannot see known objects';
  end if;

  if to_regclass('public.erp_items_current') is not null
     or to_regclass('public.erp_items_raw') is not null then
    raise exception '#2482: legacy ERP tables are still in public';
  end if;
  if to_regclass('archive.erp_items_current') is null
     or to_regclass('archive.erp_items_raw') is null then
    raise exception '#2482: legacy ERP tables were not kept in the archive schema';
  end if;

  if has_schema_privilege('anon', 'archive', 'usage')
     or has_schema_privilege('authenticated', 'archive', 'usage') then
    raise exception '#2482: API roles can use the archive schema';
  end if;
  select count(*) into v_n
  from information_schema.role_table_grants
  where table_schema = 'archive'
    and table_name in ('erp_items_current', 'erp_items_raw')
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_n <> 0 then
    raise exception '#2482: % API-role grant(s) remain on archived ERP tables', v_n;
  end if;

  select string_agg(distinct rw.ev_class::regclass::text, ', ') into v_list
  from pg_depend dep
  join pg_rewrite rw on rw.oid = dep.objid
  where dep.classid = 'pg_rewrite'::regclass
    and dep.refobjid in ('archive.erp_items_current'::regclass, 'archive.erp_items_raw'::regclass)
    and rw.ev_class not in ('archive.erp_items_current'::regclass, 'archive.erp_items_raw'::regclass);
  if v_list is not null then
    raise exception '#2482: views still depend on archived ERP tables: %', v_list;
  end if;

  select string_agg(conname || ' on ' || conrelid::regclass::text, ', ') into v_list
  from pg_constraint
  where contype = 'f'
    and confrelid in ('archive.erp_items_current'::regclass, 'archive.erp_items_raw'::regclass)
    and conrelid not in ('archive.erp_items_current'::regclass, 'archive.erp_items_raw'::regclass);
  if v_list is not null then
    raise exception '#2482: foreign keys still reference archived ERP tables: %', v_list;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_list
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prosrc ~* '(from|join)\s+((public|archive)\.)?erp_items_(current|raw)\M';
  if v_list is not null then
    raise exception '#2482: routines still read the retired ERP tables: %', v_list;
  end if;

  if pg_get_functiondef('plm.refresh_style_tracker_item_bridge()'::regprocedure)
       not like '%FROM plm.legacy_erp_item_identity%'
     or pg_get_functiondef('public.resolve_product_category_prediction_item_identity()'::regprocedure)
       not like '%from plm.legacy_erp_item_identity legacy%'
     or pg_get_viewdef('api.plm_item_list'::regclass, true) not like '%legacy_erp_item_identity%' then
    raise exception '#2482: a legacy reader was not repointed to the crosswalk';
  end if;

  if exists (select 1 from pg_constraint
             where conname = 'style_tracker_item_bridge_erp_item_id_fkey') then
    raise exception '#2482: bridge legacy FK still exists';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'plm' and table_name = 'style_tracker_item_bridge'
                   and column_name = 'erp_item_id') then
    raise exception '#2482: bridge erp_item_id column must be kept';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'plm.legacy_erp_item_identity'::regclass)
     or has_table_privilege('anon', 'plm.legacy_erp_item_identity', 'select')
     or has_table_privilege('authenticated', 'plm.legacy_erp_item_identity', 'insert')
     or not has_table_privilege('authenticated', 'plm.legacy_erp_item_identity', 'select')
     or not exists (select 1 from pg_policy
                    where polrelid = 'plm.legacy_erp_item_identity'::regclass
                      and polname = 'legacy_erp_item_identity_admin_read'
                      and polcmd = 'r') then
    raise exception '#2482: crosswalk access contract is wrong';
  end if;

  select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) into v_list
  from information_schema.columns
  where table_schema = 'api' and table_name = 'plm_item_list';
  if v_list is distinct from
     'id:uuid,source_id:text,style_number:text,item_description:text,mg_category:text,mg01_code:text,mg02_code:text,mg03_code:text,mg04_code:text,mg05_code:text,mg06_code:text,size_code:text,licensor_code:text,property_code:text,division_code:text,prepack_code:text,prepack_codes:jsonb,dismissed:boolean,erp_updated_at:timestamp with time zone,synced_at:timestamp with time zone,source_system:text' then
    raise exception '#2482: api.plm_item_list column contract changed: %', v_list;
  end if;
end;
$$;

begin;

-- Behaviour: a legacy UUID still resolves through the crosswalk for the view id and
-- the prediction identity trigger.
do $$
declare
  v_item uuid;
  v_legacy uuid;
  v_prediction uuid;
begin
  insert into plm.item (item_number, description, source_system, source_id, raw)
  values ('ZZ2482ITEM', 'ZZ2482 DESCRIPTION', 'coldlion', 'ZZCO|ZZ001|ZZ2482ITEM',
          '{"companyCode":"ZZCO","divisionCode":"ZZ001","itemNo":"ZZ2482ITEM"}')
  returning id into v_item;

  if (select id from api.plm_item_list where source_id = 'ZZ2482ITEM') is distinct from v_item then
    raise exception '#2482 control: item without a legacy row must use its plm.item id';
  end if;

  insert into plm.legacy_erp_item_identity (id, external_id, style_number, division_code)
  values (gen_random_uuid(), 'ZZ2482ITEM', 'ZZ2482ITEM', 'ZZ001')
  returning id into v_legacy;

  if (select id from api.plm_item_list where source_id = 'ZZ2482ITEM') is distinct from v_legacy then
    raise exception '#2482: view id did not keep the legacy UUID from the crosswalk';
  end if;

  insert into public.product_category_predictions (
    erp_item_id, external_id, predicted_category, confidence, classification_source, status
  ) values (
    v_legacy, 'coldlion|ZZ001|ZZ2482ITEM', 'Wall', 0.9, 'ai', 'approved'
  ) returning id into v_prediction;

  if not exists (
    select 1 from public.product_category_predictions
    where id = v_prediction and plm_item_id = v_item and item_identity_status = 'resolved'
  ) then
    raise exception '#2482: prediction legacy identity did not resolve through the crosswalk';
  end if;

  raise notice '#2482 PASSED: tables archived and revoked, no live dependents, readers repointed, FK dropped with column kept, legacy identity resolves.';
end;
$$;

rollback;
