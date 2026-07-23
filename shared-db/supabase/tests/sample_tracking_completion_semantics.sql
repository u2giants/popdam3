-- Rolled-back transactional proof of the completion-semantics repair
-- (migration 20260723230000_sample_tracking_completion_semantics.sql).
--
-- Proves:
--   1. A 'known' sample with zero movements is NOT 'complete' (Defect A →
--      derived_status = 'uninitialized').
--   2. A sample whose only non-terminal balance sits at a CLOSED-OUT office
--      stop is still NOT 'complete' (Defect B).
--   3. A sample whose units are all in 'terminal' locations IS 'complete'.
--   4. The canonical four-piece end state (1 retained Ningbo office /
--      2 retained NYC office / 1 at customer) resolves under the SHIPPED
--      plan §15 Q4 interpretation: still 'outstanding' because office-retained
--      and customer-held balances are non-terminal.
--
-- Movement posting choice: this suite calls dflow.post_sample_movement (same
-- as sample_tracking_quantity_contract.sql) so the concurrency guard,
-- conservation check, and idempotency path are exercised. Closeout rows are
-- inserted directly into dflow.sample_stop_closeout because there is no
-- dedicated closeout RPC and the Defect B fixture must deliberately close a
-- stop while a positive local balance remains.
--
-- Run on preview after 20260723230000 is applied. Entire fixture rolls back.

BEGIN;

DO $$
DECLARE
  v_zero_sample   integer;
  v_close_sample  integer;
  v_term_sample   integer;
  v_four_sample   integer;
  v_box           integer;
  v_line          bigint;
  v_movement_id   bigint;
  v_status        text;
  v_nb            bigint;
  v_ny            bigint;
  v_customer      bigint;
  v_transit       bigint;
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
  -- 4. Canonical four-piece end state under SHIPPED §15 Q4 interpretation
  --
  -- End balances (same as sample_tracking_quantity_contract.sql):
  --   office/ningbo = 1 (retained)
  --   office/nyc    = 2 (retained)
  --   customer/*    = 1 (held / delivered-to-customer location)
  --   in_transit    = 0
  --
  -- SHIPPED interpretation (migration 20260723230000, plan §15 Q4):
  --   office-retained AND customer-held both count as non-terminal, so the
  --   batch remains 'outstanding'. Only balances at location_type='terminal'
  --   are treated as resolved. If product later decides customer-held is
  --   complete, flip the single CASE branch in sample_global_status and
  --   update this assertion + comment together.
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

  IF v_nb <> 1 OR v_ny <> 2 OR v_customer <> 1 OR v_transit <> 0 THEN
    RAISE EXCEPTION
      'four-piece conservation failed: ningbo %, nyc %, customer %, transit %',
      v_nb, v_ny, v_customer, v_transit;
  END IF;

  SELECT derived_status INTO v_status
  FROM dflow.sample_global_status
  WHERE sample_id_pk = v_four_sample;

  -- SHIPPED §15 Q4: office-retained + customer-held → outstanding (not complete).
  IF v_status IS DISTINCT FROM 'outstanding' THEN
    RAISE EXCEPTION
      'four-piece §15 Q4 (shipped conservative) failed: derived_status=%, expected outstanding '
      '(office-retained and customer-held are non-terminal under this interpretation)',
      v_status;
  END IF;

  RAISE NOTICE 'sample tracking completion semantics: all checks passed (Q4 shipped=conservative outstanding)';
END $$;

ROLLBACK;
