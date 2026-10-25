-- #4646 / author claim #4753: production milestone persistence only.
-- derived-from: none
-- Depends on #3869 database-applied: reuse its valid unique production-header ID index.
-- New empty table only; no projections, parent index creation or source access changes.
-- Identity insertion requires no sequence grant (isolated PG17 proof).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
DO $pre$
DECLARE target text;
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION '#4646: postgres author identity required'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='designflow_prod_tracking_grants'
  AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
  AND NOT rolcreatedb AND NOT rolreplication) THEN
  RAISE EXCEPTION '#4646: existing tracking grant role shape changed or missing';
 END IF;
 IF NOT has_schema_privilege('designflow_prod_tracking_grants','dflow_prod','USAGE') THEN
  RAISE EXCEPTION '#4646: tracking schema usage precondition missing';
 END IF;
 FOREACH target IN ARRAY ARRAY['dflow_prod.prod_order_milestone_schedule','dflow_prod.prod_order_milestone_schedule_id_seq'] LOOP
  IF to_regclass(target) IS NOT NULL THEN RAISE EXCEPTION '#4646: new object exists; refuse replacement: %',target; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  WHERE c.oid=to_regclass('dflow_prod."ProdOrderHeader"') AND c.relkind='r'
   AND a.attname='id' AND NOT a.attisdropped AND a.atttypid='integer'::regtype AND a.attnotnull) THEN
  RAISE EXCEPTION '#4646: existing production header integer NOT NULL id required';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
  WHERE i.indrelid='dflow_prod."ProdOrderHeader"'::regclass AND a.attname='id'
   AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
   AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indexprs IS NULL AND i.indpred IS NULL) THEN
  RAISE EXCEPTION '#4646: existing valid plain unique parent id index required; wait for #3869 database-applied';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  WHERE c.oid=to_regclass('dflow_prod."FactoryTime"') AND c.relkind='r'
   AND a.attname='id' AND NOT a.attisdropped AND a.atttypid='integer'::regtype) THEN
  RAISE EXCEPTION '#4646: existing FactoryTime integer id required';
 END IF;
END
$pre$;

CREATE TABLE dflow_prod.prod_order_milestone_schedule (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prod_order_header_id integer NOT NULL REFERENCES dflow_prod."ProdOrderHeader"(id) ON DELETE CASCADE,
  sku text NOT NULL DEFAULT '',
  stage_name text NOT NULL,
  needed_date date,
  estimated_date date,
  actual_date date,
  status text NOT NULL,
  anchor_type text,
  anchor_date date,
  factory_time_id integer REFERENCES dflow_prod."FactoryTime"(id) ON DELETE SET NULL,
  sampling_days integer,
  mass_production_days integer,
  template_source text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  first_past_due_at timestamptz,
  stage_id integer NULL CHECK(stage_id>0),
  CONSTRAINT prod_order_milestone_schedule_stage_name_not_blank_check CHECK(btrim(stage_name)<>'' AND stage_name=btrim(stage_name)),
  CONSTRAINT prod_order_milestone_schedule_sku_trimmed_check CHECK(sku=btrim(sku)),
  CONSTRAINT prod_order_milestone_schedule_status_not_blank_check CHECK(btrim(status)<>'' AND status=btrim(status)),
  CONSTRAINT prod_order_milestone_schedule_days_nonnegative_check CHECK((sampling_days IS NULL OR sampling_days>=0) AND (mass_production_days IS NULL OR mass_production_days>=0))
);
-- Retain the unpredicated legacy key: current deployed writers omit stage_id.
CREATE UNIQUE INDEX prod_order_milestone_schedule_upsert_key ON dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,sku);
CREATE INDEX prod_order_milestone_schedule_status_needed_idx ON dflow_prod.prod_order_milestone_schedule(status,needed_date);
CREATE INDEX prod_order_milestone_schedule_factory_time_id_idx ON dflow_prod.prod_order_milestone_schedule(factory_time_id);
CREATE UNIQUE INDEX prod_order_milestone_schedule_catalog_stage_key ON dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_id,sku) WHERE stage_id IS NOT NULL;
CREATE UNIQUE INDEX prod_order_milestone_schedule_legacy_name_key ON dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,sku) WHERE stage_id IS NULL;
COMMENT ON TABLE dflow_prod.prod_order_milestone_schedule IS '#4646: production tracking snapshots; legacy name key retained. Optional immutable stage identity has no live catalog FK, so catalog deletion cannot erase history. Empty at creation; application owns rows.';

REVOKE ALL ON TABLE dflow_prod.prod_order_milestone_schedule FROM PUBLIC,anon,authenticated,service_role,
 designflow_prod_backend_grants,designflow_prod_item_master_grants,designflow_prod_tracking_grants,designflow_prod_data_sync_grants;
REVOKE ALL ON SEQUENCE dflow_prod.prod_order_milestone_schedule_id_seq FROM PUBLIC,anon,authenticated,service_role,
 designflow_prod_backend_grants,designflow_prod_item_master_grants,designflow_prod_tracking_grants,designflow_prod_data_sync_grants;
GRANT SELECT,INSERT,UPDATE ON TABLE dflow_prod.prod_order_milestone_schedule TO designflow_prod_tracking_grants;
DO $post$
DECLARE r text;
BEGIN
 IF NOT has_table_privilege('designflow_prod_tracking_grants','dflow_prod.prod_order_milestone_schedule','SELECT')
 OR NOT has_table_privilege('designflow_prod_tracking_grants','dflow_prod.prod_order_milestone_schedule','INSERT')
 OR NOT has_table_privilege('designflow_prod_tracking_grants','dflow_prod.prod_order_milestone_schedule','UPDATE')
 OR has_table_privilege('designflow_prod_tracking_grants','dflow_prod.prod_order_milestone_schedule','DELETE') THEN
  RAISE EXCEPTION '#4646: milestone minimum tracking privileges differ';
 END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','designflow_prod_backend_grants','designflow_prod_item_master_grants','designflow_prod_data_sync_grants'] LOOP
  IF has_table_privilege(r,'dflow_prod.prod_order_milestone_schedule','SELECT')
   OR has_table_privilege(r,'dflow_prod.prod_order_milestone_schedule','INSERT')
   OR has_table_privilege(r,'dflow_prod.prod_order_milestone_schedule','UPDATE')
   OR has_table_privilege(r,'dflow_prod.prod_order_milestone_schedule','DELETE') THEN
   RAISE EXCEPTION '#4646: unintended milestone access: %',r;
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','designflow_prod_backend_grants','designflow_prod_item_master_grants','designflow_prod_tracking_grants','designflow_prod_data_sync_grants'] LOOP
  IF has_sequence_privilege(r,'dflow_prod.prod_order_milestone_schedule_id_seq','USAGE')
   OR has_sequence_privilege(r,'dflow_prod.prod_order_milestone_schedule_id_seq','SELECT')
   OR has_sequence_privilege(r,'dflow_prod.prod_order_milestone_schedule_id_seq','UPDATE') THEN
   RAISE EXCEPTION '#4646: unintended identity sequence access: %',r;
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM dflow_prod.prod_order_milestone_schedule) THEN RAISE EXCEPTION '#4646: new table must remain empty'; END IF;
END
$post$;
COMMIT;
