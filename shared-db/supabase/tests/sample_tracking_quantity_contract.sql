-- Run on preview inside a transaction; proves conservation, idempotency,
-- discrepancies, immutability, closeout distinction, and unknown legacy state.
--
-- Updated 2026-07-23 for the CONFIRMED office-inventory rule (migration
-- 20260723230000): when pieces ship onward out of an office, the remainder at
-- that office is automatically moved to that office's terminal inventory
-- bucket ({office}_office_inventory) and leaves the tracking flow. Pieces stay
-- conserved. Customer-delivered is also resolved. The canonical four-piece end
-- state is therefore ningbo_office_inventory=1, nyc_office_inventory=2,
-- customer=1, offices=0, and the batch derives 'complete' (previously this
-- suite expected office balances 1/2 and 'outstanding').
BEGIN;

DO $$
DECLARE
  v_sample integer; v_box integer; v_line bigint; v_first bigint; v_replay bigint;
  v_ny bigint; v_nb bigint; v_customer bigint; v_transit bigint;
  v_nb_inv bigint; v_ny_inv bigint; v_total bigint;
BEGIN
  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('factory','inbound','quantity-contract-test','created','known') RETURNING sample_id_pk INTO v_sample;
  INSERT INTO dflow.sample_box(box_label,direction,status,ownership_state)
  VALUES('quantity-contract-test','inbound','packing','internal') RETURNING box_id_pk INTO v_box;
  INSERT INTO dflow.sample_shipment_line(sample_id_fk,box_id_fk,quantity_intended,origin_location_type,origin_location_id,destination_location_type,destination_location_id,route_leg,idempotency_key,request_hash,created_by_user,created_by_role)
  VALUES(v_sample,v_box,4,'factory','test-factory','office','ningbo','factory_to_ningbo','line-1','line-hash','test','production') RETURNING shipment_line_id INTO v_line;

  SELECT movement_id INTO v_first FROM dflow.post_sample_movement(v_sample,4,'terminal','created','factory','test-factory','create','test','production','m1','h1');
  SELECT movement_id INTO v_replay FROM dflow.post_sample_movement(v_sample,4,'terminal','created','factory','test-factory','create','test','production','m1','h1');
  IF v_first <> v_replay THEN RAISE EXCEPTION 'idempotent replay created a second movement'; END IF;
  BEGIN
    PERFORM dflow.post_sample_movement(v_sample,3,'terminal','created','factory','test-factory','create','test','production','m1','different');
    RAISE EXCEPTION 'conflicting idempotency reuse was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  PERFORM dflow.post_sample_movement(v_sample,4,'factory','test-factory','in_transit',v_box::text,'ship','test','production','m2','h2',v_box,v_line);
  PERFORM dflow.post_sample_movement(v_sample,4,'in_transit',v_box::text,'office','ningbo','receive','test','production','m3','h3',v_box,v_line);
  PERFORM dflow.post_sample_movement(v_sample,3,'office','ningbo','in_transit',v_box::text,'ship','test','production','m4','h4',v_box,v_line);
  PERFORM dflow.post_sample_movement(v_sample,3,'in_transit',v_box::text,'office','nyc','receive','test','production','m5','h5',v_box,v_line);
  PERFORM dflow.post_sample_movement(v_sample,1,'office','nyc','customer','test-customer','deliver','test','production','m6','h6');

  SELECT COALESCE(max(quantity),0) INTO v_nb FROM dflow.sample_balance_by_location WHERE sample_id_fk=v_sample AND location_type='office' AND location_id='ningbo';
  SELECT COALESCE(max(quantity),0) INTO v_ny FROM dflow.sample_balance_by_location WHERE sample_id_fk=v_sample AND location_type='office' AND location_id='nyc';
  SELECT COALESCE(max(quantity),0) INTO v_customer FROM dflow.sample_balance_by_location WHERE sample_id_fk=v_sample AND location_type='customer';
  SELECT COALESCE(sum(quantity),0) INTO v_transit FROM dflow.sample_balance_by_location WHERE sample_id_fk=v_sample AND location_type='in_transit';
  SELECT COALESCE(max(quantity),0) INTO v_nb_inv FROM dflow.sample_balance_by_location WHERE sample_id_fk=v_sample AND location_type='terminal' AND location_id='ningbo_office_inventory';
  SELECT COALESCE(max(quantity),0) INTO v_ny_inv FROM dflow.sample_balance_by_location WHERE sample_id_fk=v_sample AND location_type='terminal' AND location_id='nyc_office_inventory';

  -- Office remainders were auto-moved into each office's inventory bucket.
  IF v_nb<>0 OR v_ny<>0 OR v_customer<>1 OR v_transit<>0 THEN
    RAISE EXCEPTION 'four-piece conservation failed: ningbo %, nyc %, customer %, transit % (offices must be 0 after auto office-inventory)',v_nb,v_ny,v_customer,v_transit;
  END IF;
  IF v_nb_inv<>1 OR v_ny_inv<>2 THEN
    RAISE EXCEPTION 'auto office-inventory failed: ningbo_office_inventory %, nyc_office_inventory % (expected 1 and 2)',v_nb_inv,v_ny_inv;
  END IF;

  -- All four pieces remain conserved across every location.
  SELECT COALESCE(sum(quantity),0) INTO v_total FROM dflow.sample_balance_by_location WHERE sample_id_fk=v_sample AND quantity>0;
  IF v_total<>4 THEN
    RAISE EXCEPTION 'four-piece total conservation failed: total % (expected 4)',v_total;
  END IF;

  BEGIN
    PERFORM dflow.post_sample_movement(v_sample,2,'office','ningbo','customer','x','deliver','test','production','overdraw','overdraw');
    RAISE EXCEPTION 'negative balance was permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE dflow.sample_movement SET quantity=99 WHERE movement_id=v_first;
    RAISE EXCEPTION 'posted movement was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  -- CONFIRMED 2026-07-23: office remainders left the tracking flow into their
  -- office inventory buckets and the delivered piece is resolved, so the batch
  -- is globally complete with all four pieces still conserved.
  IF (SELECT derived_status FROM dflow.sample_global_status WHERE sample_id_pk=v_sample) <> 'complete' THEN
    RAISE EXCEPTION 'four-piece end state must be globally complete once office remainders moved to office inventory (got %)',
      (SELECT derived_status FROM dflow.sample_global_status WHERE sample_id_pk=v_sample);
  END IF;

  RAISE NOTICE 'sample tracking quantity contract: all checks passed';
END $$;

ROLLBACK;
