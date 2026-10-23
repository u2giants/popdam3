-- #4659 / claim #4660: Item Master production UPC read contract.
-- derived-from: none
-- New production projection, preserving the legacy dflow view and business rows.
-- Reuses the existing full item/company/division identity; no inferred backfill.
-- Security invoker: only the thirteen projected base columns are newly readable
-- by the existing Item Master grant group. No writes or browser access.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $pre$
BEGIN
  IF current_user <> 'postgres' OR to_regclass('dflow_prod.item_detail_upc') IS NOT NULL THEN
    RAISE EXCEPTION '#4659: require postgres and absent production UPC view';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_class c WHERE c.oid=to_regclass('dflow_prod."itemDetail"')
      AND c.relkind='r' AND c.relowner='postgres'::regrole AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION '#4659: production source owner/type/RLS contract differs';
  END IF;
  IF NOT has_schema_privilege('designflow_prod_item_master_grants','dflow_prod','USAGE') THEN
    RAISE EXCEPTION '#4659: existing Item Master schema access missing';
  END IF;
  IF has_table_privilege('designflow_prod_item_master_grants','dflow_prod."itemDetail"','SELECT') THEN
    RAISE EXCEPTION '#4659: pre-existing full source read would defeat thirteen-column isolation';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='dflow_prod."itemDetail"'::regclass
      AND attnum>0 AND NOT attisdropped AND attname=ANY(ARRAY['item_pk','item_num_id','compan_code_fk','div_code_fk','UPC','EAN','GTIN','color_code_fk','size_code_fk','size_seq','whse_sku_id','item_active_status','coldlion_synced_at']))<>13 THEN
    RAISE EXCEPTION '#4659: production UPC source columns missing';
  END IF;
  IF EXISTS (
    SELECT FROM (VALUES
      ('item_pk','int4'),('item_num_id','varchar'),('compan_code_fk','int4'),
      ('div_code_fk','int4'),('UPC','varchar'),('EAN','varchar'),('GTIN','varchar'),
      ('color_code_fk','varchar'),('size_code_fk','varchar'),('size_seq','int4'),
      ('whse_sku_id','varchar'),('item_active_status','varchar'),('coldlion_synced_at','timestamptz')
    ) AS expected(name,type_name)
    LEFT JOIN pg_attribute a ON a.attrelid='dflow_prod."itemDetail"'::regclass
      AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_type t ON t.oid=a.atttypid
    WHERE t.typname IS DISTINCT FROM expected.type_name
      OR (expected.name='item_num_id' AND a.atttypmod<>54)
  ) THEN RAISE EXCEPTION '#4659: production UPC source column types differ'; END IF;
END
$pre$;
CREATE VIEW dflow_prod.item_detail_upc WITH (security_invoker=true) AS
SELECT item_pk, item_num_id, compan_code_fk, div_code_fk,
       "UPC" AS upc, "EAN" AS ean, "GTIN" AS gtin,
       color_code_fk, size_code_fk, size_seq, whse_sku_id,
       item_active_status, coldlion_synced_at
FROM dflow_prod."itemDetail"
WHERE item_num_id IS NOT NULL AND coalesce("UPC",'')<>'';
COMMENT ON VIEW dflow_prod.item_detail_upc IS '#4659: production Item Master UPC read contract; match full item/company/division identity, source remains authoritative sync; security invoker, no data writes.';
REVOKE ALL ON dflow_prod.item_detail_upc FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (item_pk,item_num_id,compan_code_fk,div_code_fk,"UPC","EAN","GTIN",color_code_fk,size_code_fk,size_seq,whse_sku_id,item_active_status,coldlion_synced_at)
  ON dflow_prod."itemDetail" TO designflow_prod_item_master_grants;
GRANT SELECT ON dflow_prod.item_detail_upc TO designflow_prod_item_master_grants;
DO $post$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_class WHERE oid='dflow_prod.item_detail_upc'::regclass
      AND reloptions @> ARRAY['security_invoker=true'])
     OR NOT has_table_privilege('designflow_prod_item_master_runtime','dflow_prod.item_detail_upc','SELECT') THEN
    RAISE EXCEPTION '#4659: intended Item Master runtime read contract failed';
  END IF;
  -- #4475 holds service-identity cutover. Fresh production metadata proves the
  -- currently deployed shared backend inherits Item Master grants (known open
  -- membership drift #4475; this migration neither legitimizes nor changes it).
  -- Preserve that
  -- existing bridge; do not broaden the backend grant group or create membership.
  IF pg_has_role('designflow_prod_backend_runtime','designflow_prod_item_master_grants','member')
     AND NOT has_table_privilege('designflow_prod_backend_runtime','dflow_prod.item_detail_upc','SELECT') THEN
    RAISE EXCEPTION '#4659: existing shared-runtime bridge does not resolve UPC view';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','designflow_prod_tracking_runtime','designflow_prod_data_sync_runtime'] LOOP
    IF has_table_privilege(r,'dflow_prod.item_detail_upc','SELECT') THEN
      RAISE EXCEPTION '#4659: unexpected production UPC reader: %',r;
    END IF;
  END LOOP;
END
$post$;
COMMIT;
