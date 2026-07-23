-- Rolled-back transactional proof of the completion-semantics repair
-- (migration 20260723230000_sample_tracking_completion_semantics.sql).
--
-- Proves:
--   1. A 'known' sample with zero movements is NOT 'complete' (Defect A →
--      derived_status = 'uninitialized').
--   2. A sample whose only non-terminal balance sits at a CLOSED-OUT office
--      stop is still NOT 'complete' (Defect B). Fixture deliberately does
--      NOT ship onward out of that office so the auto-office-inventory
--      trigger does not fire.
--   3. A sample whose units are all in 'terminal' locations IS 'complete'.
--   4. Automatic office inventory: after Ningbo receives 4 and ships 3
--      onward, a retain movement auto-moves the remaining 1 to
--      terminal/ningbo_office_inventory and office/ningbo balance is 0.
--   5. Canonical four-piece end state under CONFIRMED §15 Q4 (2026-07-23):
--        terminal/ningbo_office_inventory = 1
--        terminal/nyc_office_inventory    = 2
--        customer                        = 1
--        in_transit = 0, office/ningbo = 0, office/nyc = 0
--      total conservation = 4 and derived_status = 'complete'.
--   6. Customer balance alone does NOT block completion.
--
-- Movement posting choice: this suite calls dflow.post_sample_movement (same
-- as sample_tracking_quantity_contract.sql) so the concurrency guard,
-- conservation check, idempotency path, AND the AFTER INSERT auto-office-
-- inventory trigger are exercised. Closeout rows are inserted directly into
-- dflow.sample_stop_closeout because there is no dedicated closeout RPC and
-- the Defect B fixture must deliberately close a stop while a positive local
-- balance remains.
--
-- Run on preview after 20260723230000 is applied. Entire fixture rolls back.

BEGIN;

DO $$
DECLARE
  v_zero_sample     integer;
  v_close_sample    integer;
  v_term_sample     integer;
  v_auto_sample     integer;
  v_four_sample     integer;
  v_cust_sample     integer;
  v_box             integer;
  v_line            bigint;
  v_movement_id     bigint;
  v_ship_movement   bigint;
  v_status          text;
  v_nb              bigint;
  v_ny              bigint;
  v_customer        bigint;
  v_transit         bigint;
  v_term_nb         bigint;
  v_term_ny         bigint;
  v_auto_qty        bigint;
  v_auto_action     text;
  v_auto_to_id      text;
  v_total           bigint;
BEGIN
  ----------------------------------------------------------------------------
  -- 1. Defect A: known sample, zero movements → 'uninitialized' (not complete)
  ----------------------------------------------------------------------------
  INSERT INTO dflow.sample(origin, direction, sample_name, status, quantity_migration_state)
  VALUES ('factory', 'inbound', 'completion-semantics-zero-move', 'created', 'known')
  RETURNING sample_id_pk INTO v_zero_sample;

  SELECT derived_status INTO v_status
  FROM dflow.sample_global_status
  WHERE sample_id_pk = v_zero_sample;

  IF v_status IS DISTINCT FROM 'uninitialized' THEN
    RAISE EXCEPTION
      'Defect A failed: known zero-movement sample derived_status=%, expected uninitialized',
      v_status;
  END IF;

  IF v_status = 'complete' THEN
    RAISE EXCEPTION 'Defect A failed: known zero-movement sample must never be complete';
  END IF;

  ----------------------------------------------------------------------------
  -- 2. Defect B: closed-out office still holding pieces → still outstanding
  --
  -- Construct so NO onward shipment leaves the office (no office→in_transit
  -- and no office→customer). That keeps the auto-office-inventory trigger
  -- from firing and preserves a positive office balance under closeout —
  -- the exact Defect B situation.
  ----------------------------------------------------------------------------
  INSERT INTO dflow.sample(origin, direction, sample_name, status, quantity_migration_state)
  VALUES ('factory', 'inbound', 'completion-semantics-closeout-mask', 'created', 'known')
  RETURNING sample_id_pk INTO v_close_sample;

  -- Opening create: 2 pieces arrive at office ningbo (via factory, no transit
  -- needed for this fixture — terminal:created → factory → office).
  SELECT movement_id INTO v_movement_id
  FROM dflow.post_sample_movement(
    v_close_sample, 2,
    'terminal', 'created', 'factory', 'test-factory',
    'create', 'test', 'production',
    'closeout-mask-m1', 'closeout-mask-h1'
  );

  SELECT movement_id INTO v_movement_id
  FROM dflow.post_sample_movement(
    v_close_sample, 2,
    'factory', 'test-factory', 'office', 'ningbo',
    'receive', 'test', 'production',
    'closeout-mask-m2', 'closeout-mask-h2'
  );

  -- Close the ningbo stop while the 2 pieces remain there. This is the exact
  -- situation Defect B previously mis-classified as globally complete.
  INSERT INTO dflow.sample_stop_closeout(
    sample_id_fk, location_type, location_id,
    movement_watermark, note, closed_by_user, closed_by_role, state
  ) VALUES (
    v_close_sample, 'office', 'ningbo',
    v_movement_id,
    'test closeout with remaining retained balance (Defect B fixture)',
    'test', 'production', 'closed'
  );

  -- Open stop work is suppressed by the closeout (local work "done").
  IF EXISTS (
    SELECT 1 FROM dflow.sample_open_stop_work
    WHERE sample_id_fk = v_close_sample
      AND location_type = 'office'
      AND location_id = 'ningbo'
  ) THEN
    RAISE EXCEPTION
      'Defect B fixture setup failed: closed office still appears in open_stop_work';
  END IF;

  -- No auto-inventory movement should exist (no onward ship out of office).
  IF EXISTS (
    SELECT 1 FROM dflow.sample_movement
    WHERE sample_id_fk = v_close_sample
      AND to_location_type = 'terminal'
      AND to_location_id = 'ningbo_office_inventory'
  ) THEN
    RAISE EXCEPTION
      'Defect B fixture setup failed: auto office-inventory fired without onward ship';
  END IF;

  -- Global status must still see the physical office balance.
  SELECT derived_status INTO v_status
  FROM dflow.sample_global_status
  WHERE sample_id_pk = v_close_sample;

  IF v_status IS DISTINCT FROM 'outstanding' THEN
    RAISE EXCEPTION
      'Defect B failed: closed-out office with remaining balance derived_status=%, expected outstanding',
      v_status;
  END IF;

  ----------------------------------------------------------------------------
  -- 3. All units in terminal locations → 'complete'
  ----------------------------------------------------------------------------
  INSERT INTO dflow.sample(origin, direction, sample_name, status, quantity_migration_state)
  VALUES ('factory', 'inbound', 'completion-semantics-all-terminal', 'created', 'known')
  RETURNING sample_id_pk INTO v_term_sample;

  PERFORM dflow.post_sample_movement(
    v_term_sample, 3,
    'terminal', 'created', 'factory', 'test-factory',
    'create', 'test', 'production',
    'all-term-m1', 'all-term-h1'
  );
  PERFORM dflow.post_sample_movement(
    v_term_sample, 3,
    'factory', 'test-factory', 'terminal', 'disposed',
    'dispose', 'test', 'production',
    'all-term-m2', 'all-term-h2'
  );

  SELECT derived_status INTO v_status
  FROM dflow.sample_global_status
  WHERE sample_id_pk = v_term_sample;

  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION
      'All-terminal complete failed: derived_status=%, expected complete',
      v_status;
  END IF;

  ----------------------------------------------------------------------------
  -- 4. Automatic office inventory on onward ship out of Ningbo
  --
  -- Receive 4 at Ningbo, ship 3 onward → remaining 1 must auto-move to
  -- terminal/ningbo_office_inventory with lifecycle_action='retain', and
  -- office/ningbo balance must be 0.
  ----------------------------------------------------------------------------
  INSERT INTO dflow.sample(origin, direction, sample_name, status, quantity_migration_state)
  VALUES ('factory', 'inbound', 'completion-semantics-auto-ofc-inv', 'created', 'known')
  RETURNING sample_id_pk INTO v_auto_sample;

  INSERT INTO dflow.sample_box(box_label, direction, status, ownership_state)
  VALUES ('completion-semantics-auto-ofc-inv', 'inbound', 'packing', 'internal')
  RETURNING box_id_pk INTO v_box;

  INSERT INTO dflow.sample_shipment_line(
    sample_id_fk, box_id_fk, quantity_intended,
    origin_location_type, origin_location_id,
    destination_location_type, destination_location_id,
    route_leg, idempotency_key, request_hash,
    created_by_user, created_by_role
  ) VALUES (
    v_auto_sample, v_box, 4,
    'factory', 'test-factory',
    'office', 'ningbo',
    'factory_to_ningbo', 'auto-line-1', 'auto-line-hash',
    'test', 'production'
  ) RETURNING shipment_line_id INTO v_line;

  PERFORM dflow.post_sample_movement(
    v_auto_sample, 4,
    'terminal', 'created', 'factory', 'test-factory',
    'create', 'test', 'production', 'auto-m1', 'auto-h1'
  );
  PERFORM dflow.post_sample_movement(
    v_auto_sample, 4,
    'factory', 'test-factory', 'in_transit', v_box::text,
    'ship', 'test', 'production', 'auto-m2', 'auto-h2',
    v_box, v_line
  );
  PERFORM dflow.post_sample_movement(
    v_auto_sample, 4,
    'in_transit', v_box::text, 'office', 'ningbo',
    'receive', 'test', 'production', 'auto-m3', 'auto-h3',
    v_box, v_line
  );

  SELECT movement_id INTO v_ship_movement
  FROM dflow.post_sample_movement(
    v_auto_sample, 3,
    'office', 'ningbo', 'in_transit', v_box::text,
    'ship', 'test', 'production', 'auto-m4', 'auto-h4',
    v_box, v_line
  );

  -- Auto-created retain of remaining 1.
  SELECT quantity, lifecycle_action, to_location_id
  INTO v_auto_qty, v_auto_action, v_auto_to_id
  FROM dflow.sample_movement
  WHERE sample_id_fk = v_auto_sample
    AND idempotency_key = 'auto-ofc-inv-' || v_ship_movement::text;

  IF v_auto_qty IS NULL THEN
    RAISE EXCEPTION
      'auto office-inventory failed: no movement with idempotency_key auto-ofc-inv-%',
      v_ship_movement;
  END IF;

  IF v_auto_qty <> 1
     OR v_auto_action IS DISTINCT FROM 'retain'
     OR v_auto_to_id IS DISTINCT FROM 'ningbo_office_inventory' THEN
    RAISE EXCEPTION
      'auto office-inventory failed: qty=%, action=%, to_id=% (expected 1/retain/ningbo_office_inventory)',
      v_auto_qty, v_auto_action, v_auto_to_id;
  END IF;

  SELECT COALESCE(max(quantity), 0) INTO v_nb
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_auto_sample
    AND location_type = 'office'
    AND location_id = 'ningbo';

  IF v_nb <> 0 THEN
    RAISE EXCEPTION
      'auto office-inventory failed: office/ningbo balance=%, expected 0 after remainder move',
      v_nb;
  END IF;

  SELECT COALESCE(max(quantity), 0) INTO v_term_nb
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_auto_sample
    AND location_type = 'terminal'
    AND location_id = 'ningbo_office_inventory';

  IF v_term_nb <> 1 THEN
    RAISE EXCEPTION
      'auto office-inventory failed: terminal/ningbo_office_inventory=%, expected 1',
      v_term_nb;
  END IF;

  ----------------------------------------------------------------------------
  -- 5. Canonical four-piece end state → complete under confirmed Q4
  --
  -- factory makes 4 → Ningbo receives 4, keeps 1 (auto inventory), ships 3
  -- → NY receives 3, keeps 2 (auto inventory), ships 1 to customer.
  -- End: ningbo_office_inventory 1, nyc_office_inventory 2, customer 1,
  -- in_transit 0, office balances 0; total 4; derived_status complete.
  ----------------------------------------------------------------------------
  INSERT INTO dflow.sample(origin, direction, sample_name, status, quantity_migration_state)
  VALUES ('factory', 'inbound', 'completion-semantics-four-piece', 'created', 'known')
  RETURNING sample_id_pk INTO v_four_sample;

  INSERT INTO dflow.sample_box(box_label, direction, status, ownership_state)
  VALUES ('completion-semantics-four-piece', 'inbound', 'packing', 'internal')
  RETURNING box_id_pk INTO v_box;

  INSERT INTO dflow.sample_shipment_line(
    sample_id_fk, box_id_fk, quantity_intended,
    origin_location_type, origin_location_id,
    destination_location_type, destination_location_id,
    route_leg, idempotency_key, request_hash,
    created_by_user, created_by_role
  ) VALUES (
    v_four_sample, v_box, 4,
    'factory', 'test-factory',
    'office', 'ningbo',
    'factory_to_ningbo', 'four-line-1', 'four-line-hash',
    'test', 'production'
  ) RETURNING shipment_line_id INTO v_line;

  PERFORM dflow.post_sample_movement(
    v_four_sample, 4,
    'terminal', 'created', 'factory', 'test-factory',
    'create', 'test', 'production', 'four-m1', 'four-h1'
  );
  PERFORM dflow.post_sample_movement(
    v_four_sample, 4,
    'factory', 'test-factory', 'in_transit', v_box::text,
    'ship', 'test', 'production', 'four-m2', 'four-h2',
    v_box, v_line
  );
  PERFORM dflow.post_sample_movement(
    v_four_sample, 4,
    'in_transit', v_box::text, 'office', 'ningbo',
    'receive', 'test', 'production', 'four-m3', 'four-h3',
    v_box, v_line
  );
  -- Ships 3 onward → auto inventory remaining 1 at Ningbo.
  PERFORM dflow.post_sample_movement(
    v_four_sample, 3,
    'office', 'ningbo', 'in_transit', v_box::text,
    'ship', 'test', 'production', 'four-m4', 'four-h4',
    v_box, v_line
  );
  PERFORM dflow.post_sample_movement(
    v_four_sample, 3,
    'in_transit', v_box::text, 'office', 'nyc',
    'receive', 'test', 'production', 'four-m5', 'four-h5',
    v_box, v_line
  );
  -- Delivers 1 to customer → auto inventory remaining 2 at NYC.
  PERFORM dflow.post_sample_movement(
    v_four_sample, 1,
    'office', 'nyc', 'customer', 'test-customer',
    'deliver', 'test', 'production', 'four-m6', 'four-h6'
  );

  SELECT COALESCE(max(quantity), 0) INTO v_nb
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_four_sample AND location_type = 'office' AND location_id = 'ningbo';
  SELECT COALESCE(max(quantity), 0) INTO v_ny
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_four_sample AND location_type = 'office' AND location_id = 'nyc';
  SELECT COALESCE(max(quantity), 0) INTO v_customer
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_four_sample AND location_type = 'customer';
  SELECT COALESCE(sum(quantity), 0) INTO v_transit
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_four_sample AND location_type = 'in_transit';
  SELECT COALESCE(max(quantity), 0) INTO v_term_nb
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_four_sample
    AND location_type = 'terminal'
    AND location_id = 'ningbo_office_inventory';
  SELECT COALESCE(max(quantity), 0) INTO v_term_ny
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_four_sample
    AND location_type = 'terminal'
    AND location_id = 'nyc_office_inventory';

  IF v_nb <> 0 OR v_ny <> 0 OR v_customer <> 1 OR v_transit <> 0
     OR v_term_nb <> 1 OR v_term_ny <> 2 THEN
    RAISE EXCEPTION
      'four-piece end-state failed: office/ningbo %, office/nyc %, customer %, '
      'transit %, term/ningbo_inv %, term/nyc_inv % '
      '(expected office 0/0, customer 1, transit 0, inv 1/2)',
      v_nb, v_ny, v_customer, v_transit, v_term_nb, v_term_ny;
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO v_total
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_four_sample
    AND quantity > 0;

  IF v_total <> 4 THEN
    RAISE EXCEPTION
      'four-piece conservation failed: total positive balance=%, expected 4',
      v_total;
  END IF;

  SELECT derived_status INTO v_status
  FROM dflow.sample_global_status
  WHERE sample_id_pk = v_four_sample;

  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION
      'four-piece confirmed Q4 failed: derived_status=%, expected complete '
      '(office inventory + customer are resolved terminal/customer dispositions)',
      v_status;
  END IF;

  ----------------------------------------------------------------------------
  -- 6. Customer balance alone does not block completion
  ----------------------------------------------------------------------------
  INSERT INTO dflow.sample(origin, direction, sample_name, status, quantity_migration_state)
  VALUES ('factory', 'inbound', 'completion-semantics-customer-only', 'created', 'known')
  RETURNING sample_id_pk INTO v_cust_sample;

  PERFORM dflow.post_sample_movement(
    v_cust_sample, 2,
    'terminal', 'created', 'factory', 'test-factory',
    'create', 'test', 'production',
    'cust-only-m1', 'cust-only-h1'
  );
  PERFORM dflow.post_sample_movement(
    v_cust_sample, 2,
    'factory', 'test-factory', 'customer', 'test-customer',
    'deliver', 'test', 'production',
    'cust-only-m2', 'cust-only-h2'
  );

  SELECT COALESCE(max(quantity), 0) INTO v_customer
  FROM dflow.sample_balance_by_location
  WHERE sample_id_fk = v_cust_sample AND location_type = 'customer';

  IF v_customer <> 2 THEN
    RAISE EXCEPTION
      'customer-only fixture failed: customer balance=%, expected 2',
      v_customer;
  END IF;

  SELECT derived_status INTO v_status
  FROM dflow.sample_global_status
  WHERE sample_id_pk = v_cust_sample;

  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION
      'customer-only complete failed: derived_status=%, expected complete '
      '(customer is resolved under confirmed §15 Q4)',
      v_status;
  END IF;

  RAISE NOTICE
    'sample tracking completion semantics: all checks passed '
    '(Defect A/B, all-terminal, auto office-inventory, four-piece complete, customer resolved)';
END $$;

ROLLBACK;
