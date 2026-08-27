-- Transactional contracts for issue #1607 / Flow 4 remote requests.
BEGIN;

DO $$
DECLARE
  v_warehouse_sample integer;
  v_ningbo_sample integer;
  v_workflow_warehouse bigint;
  v_workflow_ningbo bigint;
  v_request uuid;
  v_warehouse_item uuid;
  v_ningbo_item uuid;
  v_reservation uuid;
  v_box integer;
  v_shipment bigint;
  v_before_movement bigint;
  v_first_line bigint;
  v_event_id bigint;
  v_event_replay_id bigint;
  v_event_definition text;
  v_reserve_definition text;
BEGIN
  IF to_regclass('dflow.sample_remote_request') IS NULL
     OR to_regclass('dflow.sample_remote_request_item') IS NULL
     OR to_regclass('dflow.sample_remote_request_history') IS NULL
     OR to_regclass('dflow.sample_reservation') IS NULL THEN
    RAISE EXCEPTION 'Flow 4 remote request relations are missing';
  END IF;

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('china_warehouse','inbound','flow4-warehouse-contract','created','known')
  RETURNING sample_id_pk INTO v_warehouse_sample;
  INSERT INTO dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
  VALUES(v_warehouse_sample,'nyo_remote_china_inventory_request','china_warehouse_ningbo_nyo','contract-test')
  RETURNING sample_workflow_id INTO v_workflow_warehouse;

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('ningbo_inventory','inbound','flow4-ningbo-contract','created','known')
  RETURNING sample_id_pk INTO v_ningbo_sample;
  INSERT INTO dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
  VALUES(v_ningbo_sample,'nyo_remote_china_inventory_request','ningbo_nyo','contract-test')
  RETURNING sample_workflow_id INTO v_workflow_ningbo;

  SELECT count(*) INTO v_before_movement FROM dflow.sample_movement
  WHERE sample_id_fk IN (v_warehouse_sample,v_ningbo_sample);

  INSERT INTO dflow.sample_remote_request(request_source,business_path,destination_type,destination_id,requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES('mixed','mixed','office','nyo','nyo-user','nyo','request-1','request-hash-1')
  RETURNING sample_remote_request_id INTO v_request;

  INSERT INTO dflow.sample_remote_request_item(sample_remote_request_id,workflow_id,sample_id_fk,source_type,business_path,source_reference,idempotency_key,request_hash,created_by_user,created_by_role)
  VALUES(v_request,v_workflow_warehouse,v_warehouse_sample,'china_warehouse','china_warehouse_ningbo_nyo','warehouse-listing','item-warehouse','item-hash-warehouse','nyo-user','nyo')
  RETURNING sample_remote_request_item_id INTO v_warehouse_item;
  INSERT INTO dflow.sample_remote_request_item(sample_remote_request_id,workflow_id,sample_id_fk,source_type,business_path,source_reference,idempotency_key,request_hash,created_by_user,created_by_role)
  VALUES(v_request,v_workflow_ningbo,v_ningbo_sample,'ningbo_inventory','ningbo_nyo','ningbo-listing','item-ningbo','item-hash-ningbo','nyo-user','nyo')
  RETURNING sample_remote_request_item_id INTO v_ningbo_item;

  PERFORM dflow.post_sample_remote_request_event(v_warehouse_item,'requested','nyo-user','nyo','item-warehouse','item-hash-warehouse');
  PERFORM dflow.post_sample_remote_request_event(v_ningbo_item,'requested','nyo-user','nyo','item-ningbo','item-hash-ningbo');
  IF (SELECT count(*) FROM dflow.sample_remote_request_history WHERE sample_remote_request_item_id IN (v_warehouse_item,v_ningbo_item) AND to_state='requested') <> 2 THEN RAISE EXCEPTION 'initial requested history is missing'; END IF;

  SELECT sample_remote_request_history_id INTO v_event_id
  FROM dflow.post_sample_remote_request_event(v_warehouse_item,'awaiting_qc','nyo-user','nyo','warehouse-await','h-await');
  SELECT sample_remote_request_history_id INTO v_event_replay_id
  FROM dflow.post_sample_remote_request_event(v_warehouse_item,'awaiting_qc','nyo-user','nyo','warehouse-await','h-await');
  IF v_event_replay_id <> v_event_id THEN RAISE EXCEPTION 'event replay did not return the committed event'; END IF;
  BEGIN
    PERFORM dflow.post_sample_remote_request_event(v_warehouse_item,'confirmed','wrong-user','ningbo','warehouse-wrong-role','h-wrong');
    RAISE EXCEPTION 'wrong role confirmed warehouse stock';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM dflow.post_sample_remote_request_event(v_warehouse_item,'confirmed','qc-user','qc','warehouse-confirm','h-confirm');
  PERFORM dflow.post_sample_remote_request_event(v_warehouse_item,'in_transit_to_ningbo','qc-user','qc','warehouse-transit','h-transit');
  PERFORM dflow.post_sample_remote_request_event(v_warehouse_item,'received','ningbo-user','ningbo','warehouse-received','h-received');

  SELECT sample_reservation_id INTO v_reservation
  FROM dflow.reserve_sample_remote_request_item(v_warehouse_item,'ningbo-user','ningbo','warehouse-reserve','h-reserve');
  IF (SELECT sample_reservation_id FROM dflow.reserve_sample_remote_request_item(v_warehouse_item,'ningbo-user','ningbo','warehouse-reserve','h-reserve')) <> v_reservation THEN
    RAISE EXCEPTION 'reservation replay duplicated the reservation';
  END IF;
  BEGIN
    PERFORM dflow.reserve_sample_remote_request_item(v_warehouse_item,'ningbo-user','ningbo','warehouse-reserve-2','h-reserve-2');
    RAISE EXCEPTION 'a duplicate open reservation was accepted';
  EXCEPTION WHEN check_violation OR unique_violation THEN NULL;
  END;

  INSERT INTO dflow.sample_box(box_label,status,origin_office,dest_office)
  VALUES('flow4-contract-box','open','ningbo','nyo') RETURNING box_id_pk INTO v_box;
  INSERT INTO dflow.sample_shipment(origin_location_type,origin_location_id,destination_location_type,destination_location_id,state,actor_user,actor_role,idempotency_key,request_hash)
  VALUES('office','ningbo','office','nyo','packed','ningbo-user','ningbo','flow4-shipment','flow4-shipment-hash')
  RETURNING sample_shipment_id INTO v_shipment;

  PERFORM dflow.pack_sample_reservation(v_reservation,v_box,v_shipment,'ningbo','office','nyo','ningbo_to_nyc','ningbo-user','ningbo','warehouse-pack','h-pack');
  SELECT packed_shipment_line_id INTO v_first_line FROM dflow.sample_reservation WHERE sample_reservation_id=v_reservation;
  IF (SELECT sample_reservation_id FROM dflow.reserve_sample_remote_request_item(v_warehouse_item,'ningbo-user','ningbo','warehouse-reserve','h-reserve')) <> v_reservation THEN
    RAISE EXCEPTION 'reservation replay after packing did not return the committed reservation';
  END IF;
  PERFORM dflow.pack_sample_reservation(v_reservation,v_box,v_shipment,'ningbo','office','nyo','ningbo_to_nyc','ningbo-user','ningbo','warehouse-pack','h-pack');
  IF (SELECT count(*) FROM dflow.sample_shipment_item WHERE sample_id_fk=v_warehouse_sample AND box_id_fk=v_box) <> 1
     OR (SELECT count(*) FROM dflow.sample_shipment_line WHERE sample_id_fk=v_warehouse_sample AND idempotency_key='warehouse-pack') <> 1
     OR (SELECT packed_shipment_line_id FROM dflow.sample_reservation WHERE sample_reservation_id=v_reservation) <> v_first_line THEN
    RAISE EXCEPTION 'packing replay duplicated membership or shipment intent';
  END IF;
  BEGIN
    PERFORM dflow.pack_sample_reservation(v_reservation,v_box,v_shipment,'ningbo','office','nyo','ningbo_to_nyc','ningbo-user','ningbo','competing-pack','h-pack');
    RAISE EXCEPTION 'a competing pack command consumed an already packed reservation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF pg_get_functiondef('dflow.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)'::regprocedure) NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'packing does not serialize on a row lock';
  END IF;

  v_event_definition := lower(pg_get_functiondef('dflow.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)'::regprocedure));
  IF strpos(v_event_definition,'for update') = 0
     OR strpos(v_event_definition,'from dflow.sample_remote_request_history') = 0
     OR strpos(v_event_definition,'for update') > strpos(v_event_definition,'from dflow.sample_remote_request_history') THEN
    RAISE EXCEPTION 'event idempotency lookup occurs before the item row lock';
  END IF;
  v_reserve_definition := lower(pg_get_functiondef('dflow.reserve_sample_remote_request_item(uuid,text,text,text,text)'::regprocedure));
  IF strpos(v_reserve_definition,'for update') = 0
     OR strpos(v_reserve_definition,'from dflow.sample_reservation') = 0
     OR strpos(v_reserve_definition,'for update') > strpos(v_reserve_definition,'from dflow.sample_reservation') THEN
    RAISE EXCEPTION 'reservation idempotency lookup occurs before the item row lock';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='dflow.sample_reservation'::regclass
      AND pg_get_constraintdef(oid) LIKE '%released%'
  ) THEN RAISE EXCEPTION 'reservation advertises an unreachable released lifecycle'; END IF;

  PERFORM dflow.post_sample_remote_request_event(v_ningbo_item,'awaiting_ningbo','nyo-user','nyo','ningbo-await','n-await');
  PERFORM dflow.post_sample_remote_request_event(v_ningbo_item,'not_found','ningbo-user','ningbo','ningbo-not-found','n-not-found','physically absent');
  BEGIN
    PERFORM dflow.reserve_sample_remote_request_item(v_ningbo_item,'ningbo-user','ningbo','ningbo-reserve','n-reserve');
    RAISE EXCEPTION 'not-found stock was reserved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF has_table_privilege('service_role','dflow.sample_remote_request_history','UPDATE')
     OR has_table_privilege('service_role','dflow.sample_remote_request_history','DELETE') THEN
    RAISE EXCEPTION 'service_role can mutate append-only request history';
  END IF;

  IF (SELECT count(*) FROM dflow.sample_movement WHERE sample_id_fk IN (v_warehouse_sample,v_ningbo_sample)) <> v_before_movement THEN
    RAISE EXCEPTION 'request, confirmation, reservation, or packing changed physical custody';
  END IF;
END $$;

ROLLBACK;
