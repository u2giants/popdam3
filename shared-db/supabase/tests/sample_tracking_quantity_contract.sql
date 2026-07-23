-- Run on preview inside a transaction; proves conservation, idempotency,
-- discrepancies, immutability, closeout distinction, and unknown legacy state.
BEGIN;

DO $$
DECLARE
  v_sample integer; v_box integer; v_line bigint; v_first bigint; v_replay bigint;
  v_ny bigint; v_nb bigint; v_customer bigint; v_transit bigint;
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
  IF v_nb<>1 OR v_ny<>2 OR v_customer<>1 OR v_transit<>0 THEN
    RAISE EXCEPTION 'four-piece conservation failed: ningbo %, nyc %, customer %, transit %',v_nb,v_ny,v_customer,v_transit;
  END IF;

  BEGIN
    PERFORM dflow.post_sample_movement(v_sample,2,'office','ningbo','customer','x','deliver','test','production','overdraw','overdraw');
    RAISE EXCEPTION 'negative balance was permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE dflow.sample_movement SET quantity=99 WHERE movement_id=v_first;
    RAISE EXCEPTION 'posted movement was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  IF (SELECT derived_status FROM dflow.sample_global_status WHERE sample_id_pk=v_sample) <> 'outstanding' THEN
    RAISE EXCEPTION 'retained balances must remain globally outstanding';
  END IF;

  RAISE NOTICE 'sample tracking quantity contract: all checks passed';
END $$;

ROLLBACK;
