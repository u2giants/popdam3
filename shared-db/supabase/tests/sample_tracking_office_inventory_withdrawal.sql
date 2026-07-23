-- Proves that stock which auto-moved into an office inventory bucket can be
-- put back into a box (added to a new shipment) as a normal, balance-checked
-- movement -- i.e. office inventory is a resting place, NOT a one-way trap.
--
-- Business rule (confirmed 2026-07-23): when pieces ship onward out of an
-- office, the remainder auto-moves to that office's inventory bucket and leaves
-- the tracking flow. Those pieces must still be addable to a later box.
--
-- Why this works with no schema change: dflow.sample_movement_guard exempts
-- ONLY terminal sources 'created' / 'receipt_overage' / 'reconciled_opening'
-- from the balance check. A movement OUT of terminal/{office}_office_inventory
-- is therefore fully balance-checked -- you can withdraw what is in inventory
-- and no more.
--
-- Run on preview after 20260723230000 is applied. Entire fixture rolls back.

BEGIN;

DO $$
DECLARE
  v_sample integer;
  v_box    integer;
  v_box2   integer;
  v_line   bigint;
  v_line2  bigint;
  v_inv    bigint;
  v_transit bigint;
  v_status text;
  v_overdrawn boolean := false;
BEGIN
  INSERT INTO dflow.sample(origin, direction, sample_name, status, quantity_migration_state)
  VALUES ('factory','inbound','office-inventory-withdrawal','created','known')
  RETURNING sample_id_pk INTO v_sample;

  INSERT INTO dflow.sample_box(box_label, direction, status, ownership_state)
  VALUES ('inv-withdrawal-box-1','inbound','packing','internal') RETURNING box_id_pk INTO v_box;
  INSERT INTO dflow.sample_box(box_label, direction, status, ownership_state)
  VALUES ('inv-withdrawal-box-2','inbound','packing','internal') RETURNING box_id_pk INTO v_box2;

  INSERT INTO dflow.sample_shipment_line(
    sample_id_fk, box_id_fk, quantity_intended,
    origin_location_type, origin_location_id,
    destination_location_type, destination_location_id,
    route_leg, idempotency_key, request_hash, created_by_user, created_by_role)
  VALUES (v_sample, v_box, 4,'factory','test-factory','office','ningbo',
          'factory_to_ningbo','inv-line-1','inv-line-h1','test','production')
  RETURNING shipment_line_id INTO v_line;

  -- Factory makes 4, ships to Ningbo, Ningbo receives 4.
  PERFORM dflow.post_sample_movement(v_sample,4,'terminal','created','factory','test-factory','create','test','production','inv-m1','inv-h1');
  PERFORM dflow.post_sample_movement(v_sample,4,'factory','test-factory','in_transit',v_box::text,'ship','test','production','inv-m2','inv-h2',v_box,v_line);
  PERFORM dflow.post_sample_movement(v_sample,4,'in_transit',v_box::text,'office','ningbo','receive','test','production','inv-m3','inv-h3',v_box,v_line);

  -- Ningbo ships 3 onward -> the remaining 1 auto-moves to Ningbo Ofc Inventory.
  PERFORM dflow.post_sample_movement(v_sample,3,'office','ningbo','in_transit',v_box::text,'ship','test','production','inv-m4','inv-h4',v_box,v_line);

  SELECT COALESCE(max(quantity),0) INTO v_inv FROM dflow.sample_balance_by_location
   WHERE sample_id_fk=v_sample AND location_type='terminal' AND location_id='ningbo_office_inventory';
  IF v_inv <> 1 THEN
    RAISE EXCEPTION 'setup failed: expected 1 piece in ningbo_office_inventory, got %', v_inv;
  END IF;

  ----------------------------------------------------------------------------
  -- Withdrawing MORE than inventory holds must be rejected by the guard.
  ----------------------------------------------------------------------------
  INSERT INTO dflow.sample_shipment_line(
    sample_id_fk, box_id_fk, quantity_intended,
    origin_location_type, origin_location_id,
    destination_location_type, destination_location_id,
    route_leg, idempotency_key, request_hash, created_by_user, created_by_role)
  VALUES (v_sample, v_box2, 1,'terminal','ningbo_office_inventory','office','nyc',
          'ningbo_to_nyc','inv-line-2','inv-line-h2','test','production')
  RETURNING shipment_line_id INTO v_line2;

  BEGIN
    PERFORM dflow.post_sample_movement(v_sample,2,'terminal','ningbo_office_inventory','in_transit',v_box2::text,
                                       'pack','test','production','inv-over','inv-over-h',v_box2,v_line2);
  EXCEPTION WHEN check_violation THEN
    v_overdrawn := true;
  END;
  IF NOT v_overdrawn THEN
    RAISE EXCEPTION 'withdrawing more than office inventory holds was permitted';
  END IF;

  ----------------------------------------------------------------------------
  -- Withdrawing the piece that IS in inventory into a new box must succeed.
  ----------------------------------------------------------------------------
  PERFORM dflow.post_sample_movement(v_sample,1,'terminal','ningbo_office_inventory','in_transit',v_box2::text,
                                     'pack','test','production','inv-m5','inv-h5',v_box2,v_line2);

  SELECT COALESCE(max(quantity),0) INTO v_inv FROM dflow.sample_balance_by_location
   WHERE sample_id_fk=v_sample AND location_type='terminal' AND location_id='ningbo_office_inventory';
  IF COALESCE(v_inv,0) <> 0 THEN
    RAISE EXCEPTION 'office inventory should be empty after withdrawal, got %', v_inv;
  END IF;

  SELECT COALESCE(sum(quantity),0) INTO v_transit FROM dflow.sample_balance_by_location
   WHERE sample_id_fk=v_sample AND location_type='in_transit' AND location_id=v_box2::text;
  IF v_transit <> 1 THEN
    RAISE EXCEPTION 'withdrawn piece should be in transit on the new box, got %', v_transit;
  END IF;

  -- The batch is back in the tracking flow.
  SELECT derived_status INTO v_status FROM dflow.sample_global_status WHERE sample_id_pk=v_sample;
  IF v_status <> 'in_transit' THEN
    RAISE EXCEPTION 'sample should re-enter the flow as in_transit after inventory withdrawal, got %', v_status;
  END IF;

  -- All four pieces still conserved.
  IF (SELECT COALESCE(sum(quantity),0) FROM dflow.sample_balance_by_location
       WHERE sample_id_fk=v_sample AND quantity>0) <> 4 THEN
    RAISE EXCEPTION 'conservation broken after inventory withdrawal';
  END IF;

  RAISE NOTICE 'office inventory withdrawal: all checks passed (add-to-box from inventory works, over-withdrawal blocked)';
END $$;

ROLLBACK;
