-- #6912: pin the tracking grant's exact itemDetail column allowlist and runtime access.
-- Self-contained, read-only contract check.
begin;

do $contract$
declare
  expected_columns text[] := array[
    'EAN',
    'GTIN',
    'GenerateUPC',
    'NMFC_code_hed',
    'UPC',
    'base_qty_hed',
    'carton_code_ext',
    'carton_depth_size_hed',
    'carton_length_size_hed',
    'carton_packtype_fk',
    'carton_qty',
    'carton_weight_size_hed',
    'carton_width_size_hed',
    'color_code_fk',
    'compare_price_hed',
    'created_timedate',
    'created_user_fk',
    'dim_code_fk',
    'discont_status',
    'ds_cat',
    'hts_num_hed_ext_fk',
    'innerpk_qty_hed',
    'item_active_status',
    'item_avail_status',
    'item_cbm_size',
    'item_content_hed',
    'item_cost_hed_ext',
    'item_depth_size_hed',
    'item_length_size_hed',
    'item_pk',
    'item_status_hed',
    'item_weight_size_hed',
    'item_width_size_hed',
    'label_code_fk',
    'mod_timedate',
    'mod_user_fk',
    'non_inv_item',
    'pack_type_hed',
    'prepack_code_fk',
    'reserved_qty',
    'retail_pric_hed',
    'royalty_code_fk',
    'salesperson_fk',
    'season_code_hed',
    'selling_price_hed',
    'share_UPC',
    'size_allowed_hed',
    'size_code_fk',
    'size_explo_code_hed_ext',
    'size_seq',
    'udf_date01',
    'udf_date02',
    'udf_date03',
    'udf_date04',
    'udf_date05',
    'udf_date06',
    'udf_date07',
    'udf_date08',
    'udf_date09',
    'udf_date10',
    'udf_date11',
    'udf_date12',
    'udf_date13',
    'udf_date14',
    'udf_date15',
    'udf_date16',
    'udf_date17',
    'udf_date18',
    'udf_date19',
    'udf_date20',
    'udf_freeform_01',
    'udf_freeform_02',
    'udf_freeform_03',
    'udf_freeform_04',
    'udf_freeform_05',
    'udf_freeform_06',
    'udf_freeform_07',
    'udf_freeform_08',
    'udf_freeform_09',
    'udf_freeform_10',
    'udf_freeform_11',
    'udf_freeform_12',
    'udf_freeform_13',
    'udf_freeform_14',
    'udf_freeform_15',
    'udf_freeform_16',
    'udf_freeform_17',
    'udf_freeform_18',
    'udf_freeform_19',
    'udf_freeform_20',
    'udf_int01',
    'udf_int02',
    'udf_int03',
    'udf_int04',
    'udf_int05',
    'udf_int06',
    'udf_int07',
    'udf_int08',
    'udf_int09',
    'udf_int10',
    'udf_item_priceA',
    'udf_item_priceB',
    'udf_item_priceC',
    'udf_item_priceD',
    'udf_item_priceE',
    'udf_item_priceF',
    'udf_item_priceG',
    'udf_item_priceH',
    'udf_merchgroup01',
    'udf_merchgroup02',
    'udf_merchgroup03',
    'udf_merchgroup04',
    'udf_merchgroup05',
    'udf_merchgroup06',
    'udf_merchgroup07',
    'udf_merchgroup08',
    'udf_merchgroup09',
    'udf_merchgroup10',
    'udf_merchgroup11',
    'udf_merchgroup12',
    'udf_merchgroup13',
    'udf_merchgroup14',
    'udf_merchgroup15',
    'udf_merchgroup16',
    'udf_merchgroup17',
    'udf_merchgroup18',
    'udf_merchgroup19',
    'udf_merchgroup20',
    'udf_merchgroup21',
    'udf_merchgroup22',
    'udf_merchgroup23',
    'udf_merchgroup24',
    'udf_merchgroup25',
    'udf_num01',
    'udf_num02',
    'udf_num03',
    'udf_num04',
    'udf_num05',
    'udf_num06',
    'udf_num07',
    'udf_num08',
    'udf_num09',
    'udf_num10',
    'udf_yesno01',
    'udf_yesno02',
    'udf_yesno03',
    'udf_yesno04',
    'udf_yesno05',
    'udf_yesno06',
    'udf_yesno07',
    'udf_yesno08',
    'udf_yesno09',
    'udf_yesno10',
    'udf_yesno11',
    'udf_yesno12',
    'udf_yesno13',
    'udf_yesno14',
    'udf_yesno15',
    'uom_code_hed_fk',
    'uom_size_fk_hed',
    'uom_weight_fk_hed',
    'upc_created_timedate',
    'vendor_code_hed_fk',
    'whse_sku_id'
  ];
  granted_columns text[];
  runtime_columns text[];
begin
  if has_table_privilege('designflow_prod_tracking_grants', 'dflow_prod."itemDetail"', 'SELECT') then
    raise exception '#6912: tracking grants role has broad table SELECT';
  end if;
  if has_table_privilege('designflow_prod_tracking_runtime', 'dflow_prod."itemDetail"', 'SELECT') then
    raise exception '#6912: tracking runtime has broad table SELECT';
  end if;

  if exists (
    select 1
      from pg_attribute a
      cross join lateral aclexplode(coalesce(a.attacl, acldefault('c', a.attrelid))) acl
     where a.attrelid = 'dflow_prod."itemDetail"'::regclass
       and a.attnum > 0 and not a.attisdropped
       and acl.grantee = 'designflow_prod_tracking_grants'::regrole
       and (acl.privilege_type <> 'SELECT' or acl.is_grantable)
  ) then
    raise exception '#6912: tracking grant role has unexpected itemDetail column privileges';
  end if;

  select array_agg(a.attname::text order by a.attname::text collate "C")
    into granted_columns
    from pg_attribute a
    cross join lateral aclexplode(coalesce(a.attacl, acldefault('c', a.attrelid))) acl
   where a.attrelid = 'dflow_prod."itemDetail"'::regclass
     and a.attnum > 0 and not a.attisdropped
     and acl.grantee = 'designflow_prod_tracking_grants'::regrole
     and acl.privilege_type = 'SELECT';
  if granted_columns is distinct from (select array_agg(c order by c collate "C") from unnest(expected_columns) c) then
    raise exception '#6912: tracking grant role itemDetail SELECT columns differ';
  end if;

  select array_agg(a.attname::text order by a.attname::text collate "C")
    into runtime_columns
    from pg_attribute a
   where a.attrelid = 'dflow_prod."itemDetail"'::regclass
     and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('designflow_prod_tracking_runtime', 'dflow_prod."itemDetail"', a.attname, 'SELECT');
  if runtime_columns is distinct from (select array_agg(c order by c collate "C") from unnest(expected_columns) c) then
    raise exception '#6912: tracking runtime effective itemDetail SELECT columns differ';
  end if;
end
$contract$;

rollback;
