-- Index-backed projection of immutable Sample Tracking movement truth.
BEGIN;

CREATE TABLE dflow.sample_inventory_balance (
  sample_id_fk integer NOT NULL
    REFERENCES dflow.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT,
  location_type text NOT NULL,
  location_id text NOT NULL,
  quantity bigint NOT NULL,
  available_since timestamptz NOT NULL,
  PRIMARY KEY (sample_id_fk, location_type, location_id)
);

CREATE INDEX sample_inventory_balance_screen_idx
  ON dflow.sample_inventory_balance (
    (CASE WHEN location_type = 'terminal'
            AND location_id IN ('nyc_office_inventory','ningbo_office_inventory')
      THEN 'office' ELSE location_type END),
    (CASE WHEN location_id = 'nyc_office_inventory' THEN 'nyc'
          WHEN location_id = 'ningbo_office_inventory' THEN 'ningbo'
          ELSE location_id END),
    available_since DESC,
    sample_id_fk DESC
  ) WHERE quantity > 0;

CREATE OR REPLACE FUNCTION dflow.project_sample_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, dflow AS $$
BEGIN
  INSERT INTO dflow.sample_inventory_balance
    (sample_id_fk,location_type,location_id,quantity,available_since)
  VALUES
    (NEW.sample_id_fk,NEW.to_location_type,NEW.to_location_id,
     NEW.quantity::bigint,NEW.occurred_at)
  ON CONFLICT (sample_id_fk,location_type,location_id) DO UPDATE
  SET quantity = dflow.sample_inventory_balance.quantity + EXCLUDED.quantity,
      available_since = greatest(dflow.sample_inventory_balance.available_since,
                                 EXCLUDED.available_since);

  INSERT INTO dflow.sample_inventory_balance
    (sample_id_fk,location_type,location_id,quantity,available_since)
  VALUES
    (NEW.sample_id_fk,NEW.from_location_type,NEW.from_location_id,
     -NEW.quantity::bigint,NEW.occurred_at)
  ON CONFLICT (sample_id_fk,location_type,location_id) DO UPDATE
  SET quantity = dflow.sample_inventory_balance.quantity + EXCLUDED.quantity,
      available_since = greatest(dflow.sample_inventory_balance.available_since,
                                 EXCLUDED.available_since);
  RETURN NEW;
END $$;

CREATE TRIGGER sample_movement_project_inventory
AFTER INSERT ON dflow.sample_movement
FOR EACH ROW EXECUTE FUNCTION dflow.project_sample_inventory_movement();

-- CREATE TRIGGER holds ShareRowExclusiveLock through commit. Concurrent posters
-- wait and then fire the trigger, so none can land between snapshot and activation.
INSERT INTO dflow.sample_inventory_balance
  (sample_id_fk,location_type,location_id,quantity,available_since)
SELECT l.sample_id_fk,l.location_type,l.location_id,
       sum(l.quantity_delta)::bigint,max(l.occurred_at)
FROM (
  SELECT m.sample_id_fk,m.to_location_type AS location_type,
         m.to_location_id AS location_id,m.quantity::bigint AS quantity_delta,
         m.occurred_at
  FROM dflow.sample_movement m
  UNION ALL
  SELECT m.sample_id_fk,m.from_location_type,m.from_location_id,
         -m.quantity::bigint,m.occurred_at
  FROM dflow.sample_movement m
) l
GROUP BY l.sample_id_fk,l.location_type,l.location_id;

CREATE OR REPLACE VIEW dflow.sample_inventory AS
SELECT
  b.sample_id_fk,
  b.location_type,
  CASE WHEN b.location_type = 'terminal'
         AND b.location_id IN ('nyc_office_inventory','ningbo_office_inventory')
    THEN 'office' ELSE b.location_type END AS product_location_type,
  CASE WHEN b.location_id = 'nyc_office_inventory' THEN 'nyc'
       WHEN b.location_id = 'ningbo_office_inventory' THEN 'ningbo'
       ELSE b.location_id END AS product_location_id,
  b.quantity,
  b.available_since,
  EXISTS (SELECT 1 FROM dflow.sample_shipment_item si
          WHERE si.sample_id_fk=b.sample_id_fk AND si.box_id_fk IS NOT NULL) AS is_boxed,
  (b.location_type='in_transit') AS is_in_transit,
  (b.quantity>0 AND b.location_type<>'in_transit') AS is_eligible,
  CASE WHEN b.quantity<=0 THEN 'no_balance'
       WHEN b.location_type='in_transit' THEN 'in_transit'
       ELSE NULL END AS ineligibility_reason
FROM dflow.sample_inventory_balance b
WHERE b.quantity>0;

COMMENT ON TABLE dflow.sample_inventory_balance IS
  'Index-backed projection of immutable movement-ledger balances; maintained only by sample_movement_project_inventory.';
COMMENT ON VIEW dflow.sample_inventory IS
  'Server inventory read model over the indexed movement-balance projection, including parked office leftovers.';

REVOKE ALL ON dflow.sample_inventory_balance,dflow.sample_inventory
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dflow.project_sample_inventory_movement()
  FROM PUBLIC,anon,authenticated;

DO $$
BEGIN
  IF to_regclass('dflow.sample_inventory_balance_screen_idx') IS NULL THEN
    RAISE EXCEPTION 'Sample inventory screen index is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='dflow.sample_movement'::regclass
      AND tgname='sample_movement_project_inventory' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Sample inventory projection trigger is missing';
  END IF;
  IF has_table_privilege('anon','dflow.sample_inventory_balance','SELECT')
     OR has_table_privilege('authenticated','dflow.sample_inventory_balance','SELECT')
     OR has_table_privilege('anon','dflow.sample_inventory','SELECT')
     OR has_table_privilege('authenticated','dflow.sample_inventory','SELECT') THEN
    RAISE EXCEPTION 'Sample inventory projection has a forbidden direct privilege';
  END IF;
END $$;

COMMIT;
