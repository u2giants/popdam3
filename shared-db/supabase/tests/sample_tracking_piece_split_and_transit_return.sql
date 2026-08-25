-- Transactional proof for issue #1422. Everything rolls back.
BEGIN;

DO $$
DECLARE
  v_batch bigint;
  v_parent integer;
  v_children integer[] := ARRAY[]::integer[];
  v_child integer;
  v_factory integer;
  v_factories integer[] := ARRAY[]::integer[];
  v_visit bigint;
  v_outbound bigint;
  v_outbound_line bigint;
  v_return bigint;
  v_return_line bigint;
  v_i integer;
  v_active bigint;
  v_before bigint;
  v_after bigint;
BEGIN
  INSERT INTO dflow.sample_creation_batch(
    mode,entry_method,idempotency_key,request_hash,created_by_user,created_by_role)
  VALUES('group','manual','issue-1422-batch','hash','contract-test','ningbo')
  RETURNING creation_batch_id INTO v_batch;

  INSERT INTO dflow.sample(
    origin,direction,sample_name,status,quantity_migration_state,
    item_id_fk,prod_order_no_fk,customer_id_fk)
  VALUES('usa_bought','outbound','issue-1422-parent','created','known',1422,'PO-1422',1422)
  RETURNING sample_id_pk INTO v_parent;
  INSERT INTO dflow.sample_workflow(
    sample_id_fk,creation_batch_id,workflow_type,business_path,created_by_user)
  VALUES(v_parent,v_batch,'nyo_purchased_factory_reference','nyo_ningbo','contract-test');
  PERFORM dflow.post_sample_movement(
    v_parent,3,'terminal','created','office','ningbo','create',
    'contract-test','ningbo','issue-1422-create','hash-create');

  FOR v_i IN 1..3 LOOP
    INSERT INTO dflow.sample(
      origin,direction,sample_name,status,quantity_migration_state,
      item_id_fk,prod_order_no_fk,customer_id_fk)
    VALUES('usa_bought','outbound','issue-1422-child-' || v_i,'created','known',1422,'PO-1422',1422)
    RETURNING sample_id_pk INTO v_child;
    v_children := array_append(v_children,v_child);
    INSERT INTO dflow.sample_workflow(
      sample_id_fk,creation_batch_id,workflow_type,business_path,created_by_user)
    VALUES(v_child,v_batch,'nyo_purchased_factory_reference','nyo_ningbo','contract-test');

    INSERT INTO dflow."Factory"(factory_name)
    VALUES('issue-1422-factory-' || v_i) RETURNING id INTO v_factory;
    v_factories := array_append(v_factories,v_factory);
  END LOOP;

  -- A synthetic opening source is balance-exempt in the generic movement
  -- guard. The split RPC must reject it before writing lineage or movements.
  SELECT count(*) INTO v_before FROM dflow.sample_movement
  WHERE sample_id_fk = ANY(array_prepend(v_parent,v_children));
  BEGIN
    PERFORM dflow.post_sample_piece_split(
      v_parent,
      jsonb_build_array(jsonb_build_object('sample_id',v_children[1],'quantity',1)),
      'terminal','created','invalid synthetic source',
      'contract-test','ningbo','issue-1422-invalid-source','hash-invalid-source'
    );
    RAISE EXCEPTION 'terminal/created split source was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT count(*) INTO v_after FROM dflow.sample_movement
  WHERE sample_id_fk = ANY(array_prepend(v_parent,v_children));
  IF v_after <> v_before OR EXISTS (
    SELECT 1 FROM dflow.sample_piece_lineage WHERE sample_id_fk=ANY(v_children)
  ) THEN
    RAISE EXCEPTION 'rejected terminal/created split wrote custody or lineage rows';
  END IF;

  PERFORM dflow.post_sample_piece_split(
    v_parent,
    jsonb_build_array(
      jsonb_build_object('sample_id',v_children[1],'quantity',1),
      jsonb_build_object('sample_id',v_children[2],'quantity',1),
      jsonb_build_object('sample_id',v_children[3],'quantity',1)
    ),
    'office','ningbo','three independent factory visits',
    'contract-test','ningbo','issue-1422-split','hash-split'
  );

  SELECT COALESCE(sum(b.quantity),0) INTO v_active
  FROM unnest(v_children) c(sample_id)
  JOIN dflow.sample_balance_by_location b ON b.sample_id_fk=c.sample_id
  WHERE b.location_type='office' AND b.location_id='ningbo' AND b.quantity>0;
  IF v_active <> 3 THEN
    RAISE EXCEPTION 'split did not conserve active quantity: expected 3, got %',v_active;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_children) c(sample_id)
    WHERE (SELECT count(*) FROM dflow.sample_balance_by_location b
           WHERE b.sample_id_fk=c.sample_id AND b.quantity>0) <> 1
  ) THEN
    RAISE EXCEPTION 'a split child does not have exactly one custody location';
  END IF;
  IF (SELECT derived_status FROM dflow.sample_global_status WHERE sample_id_pk=v_parent) <> 'split' THEN
    RAISE EXCEPTION 'fully split parent was incorrectly classified as complete';
  END IF;

  SELECT count(*) INTO v_before FROM dflow.sample_movement
  WHERE sample_id_fk = ANY(array_prepend(v_parent,v_children));
  PERFORM dflow.post_sample_piece_split(
    v_parent,
    jsonb_build_array(
      jsonb_build_object('sample_id',v_children[1],'quantity',1),
      jsonb_build_object('sample_id',v_children[2],'quantity',1),
      jsonb_build_object('sample_id',v_children[3],'quantity',1)
    ),
    'office','ningbo','three independent factory visits',
    'contract-test','ningbo','issue-1422-split','hash-split'
  );
  SELECT count(*) INTO v_after FROM dflow.sample_movement
  WHERE sample_id_fk = ANY(array_prepend(v_parent,v_children));
  IF v_after <> v_before OR
     (SELECT count(*) FROM dflow.sample_piece_lineage WHERE parent_sample_id_fk=v_parent) <> 3 THEN
    RAISE EXCEPTION 'split replay created duplicate lineage or movement rows';
  END IF;

  BEGIN
    PERFORM dflow.post_sample_piece_split(
      v_parent,jsonb_build_array(jsonb_build_object('sample_id',v_children[1],'quantity',2)),
      'office','ningbo','changed request','contract-test','ningbo',
      'issue-1422-split','hash-split');
    RAISE EXCEPTION 'changed split request reused the idempotency key';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM dflow.post_sample_piece_split(
      v_parent,
      jsonb_build_array(
        jsonb_build_object('sample_id',v_children[1],'quantity',1),
        jsonb_build_object('sample_id',v_children[1],'quantity',1),
        jsonb_build_object('sample_id',v_children[2],'quantity',1)
      ),
      'office','ningbo','duplicate replay children','contract-test','ningbo',
      'issue-1422-split','hash-split');
    RAISE EXCEPTION 'duplicate child entries were accepted on split replay';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Three siblings can hold three concurrent active factory visits.
  FOR v_i IN 1..3 LOOP
    INSERT INTO dflow.sample_shipment(
      origin_location_type,origin_location_id,destination_location_type,destination_location_id,
      state,actor_user,actor_role,idempotency_key,request_hash)
    VALUES('office','ningbo','factory',v_factories[v_i]::text,'draft',
      'contract-test','ningbo','issue-1422-outbound-' || v_i,'hash')
    RETURNING sample_shipment_id INTO v_outbound;
    INSERT INTO dflow.sample_shipment_line(
      sample_id_fk,sample_shipment_id,quantity_intended,
      origin_location_type,origin_location_id,destination_location_type,destination_location_id,
      route_leg,idempotency_key,request_hash,created_by_user,created_by_role)
    VALUES(v_children[v_i],v_outbound,1,'office','ningbo','factory',v_factories[v_i]::text,
      'ningbo_to_factory','issue-1422-out-line-' || v_i,'hash','contract-test','ningbo')
    RETURNING shipment_line_id INTO v_outbound_line;

    INSERT INTO dflow.sample_factory_visit(
      sample_id_fk,factory_id,visit_order,provenance,
      requested_by_user,requested_by_role,idempotency_key,request_hash)
    VALUES(v_children[v_i],v_factories[v_i],1,'nyo_requested',
      'contract-test','ningbo','issue-1422-visit-' || v_i,'hash')
    RETURNING sample_factory_visit_id INTO v_visit;
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,to_state,
      reason,changed_by_user,changed_by_role)
    VALUES(v_visit,1,'planned','planned','planned','contract test','contract-test','ningbo');

    PERFORM dflow.post_sample_movement(
      v_children[v_i],1,'office','ningbo','in_transit',v_outbound::text,'ship',
      'contract-test','ningbo','issue-1422-ship-' || v_i,'hash',NULL,v_outbound_line);
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
      reason,changed_by_user,changed_by_role)
    VALUES(v_visit,2,'shipped','planned','shipped',v_outbound,
      'contract test','contract-test','ningbo');

    IF v_i=1 THEN
      INSERT INTO dflow.sample_shipment(
        origin_location_type,origin_location_id,destination_location_type,destination_location_id,
        state,actor_user,actor_role,idempotency_key,request_hash)
      VALUES('factory',v_factories[v_i]::text,'office','Ningbo','draft',
        'contract-test','ningbo','issue-1422-return','hash')
      RETURNING sample_shipment_id INTO v_return;
      INSERT INTO dflow.sample_shipment_line(
        sample_id_fk,sample_shipment_id,quantity_intended,
        origin_location_type,origin_location_id,destination_location_type,destination_location_id,
        route_leg,idempotency_key,request_hash,created_by_user,created_by_role)
      VALUES(v_children[v_i],v_return,1,'factory',v_factories[v_i]::text,'office','Ningbo',
        'factory_return_to_ningbo','issue-1422-return-line','hash','contract-test','ningbo')
      RETURNING shipment_line_id INTO v_return_line;

      PERFORM dflow.post_sample_movement(
        v_children[v_i],1,'in_transit',v_outbound::text,'in_transit',v_return::text,'return',
        'contract-test','ningbo','issue-1422-reroute','hash',NULL,v_return_line);

      IF EXISTS (
        SELECT 1 FROM dflow.sample_movement
        WHERE sample_id_fk=v_children[v_i]
          AND (from_location_type='factory' OR to_location_type='factory')
      ) THEN
        RAISE EXCEPTION 'check-in-free return invented a factory receipt movement';
      END IF;
      IF (SELECT quantity FROM dflow.sample_balance_by_location
          WHERE sample_id_fk=v_children[v_i] AND location_type='in_transit'
            AND location_id=v_return::text) <> 1 THEN
        RAISE EXCEPTION 'return reroute did not leave one custody location';
      END IF;

      BEGIN
        PERFORM dflow.post_sample_movement(
          v_children[2],1,'in_transit',v_outbound::text,'in_transit',v_return::text,'return',
          'contract-test','ningbo','issue-1422-wrong-sample','hash',NULL,v_return_line);
        RAISE EXCEPTION 'wrong sample was accepted for return reroute';
      EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
      END;

      PERFORM dflow.post_sample_movement(
        v_children[v_i],1,'in_transit',v_return::text,'office','Ningbo','receive',
        'contract-test','ningbo','issue-1422-return-receive','hash',NULL,v_return_line);
      BEGIN
        PERFORM dflow.post_sample_movement(
          v_children[v_i],1,'in_transit',v_outbound::text,'in_transit',v_return::text,'return',
          'contract-test','ningbo','issue-1422-consumed','hash',NULL,v_return_line);
        RAISE EXCEPTION 'already-consumed outbound transit was accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
    ELSIF v_i=2 THEN
      -- The endpoint comparison is deliberately exact. The canonical app value
      -- succeeds above; the legacy lowercase spelling must remain rejected.
      INSERT INTO dflow.sample_shipment(
        origin_location_type,origin_location_id,destination_location_type,destination_location_id,
        state,actor_user,actor_role,idempotency_key,request_hash)
      VALUES('factory',v_factories[v_i]::text,'office','ningbo','draft',
        'contract-test','ningbo','issue-1502-lowercase-return','hash')
      RETURNING sample_shipment_id INTO v_return;
      INSERT INTO dflow.sample_shipment_line(
        sample_id_fk,sample_shipment_id,quantity_intended,
        origin_location_type,origin_location_id,destination_location_type,destination_location_id,
        route_leg,idempotency_key,request_hash,created_by_user,created_by_role)
      VALUES(v_children[v_i],v_return,1,'factory',v_factories[v_i]::text,'office','ningbo',
        'factory_return_to_ningbo','issue-1502-lowercase-return-line','hash','contract-test','ningbo')
      RETURNING shipment_line_id INTO v_return_line;

      SELECT count(*) INTO v_before FROM dflow.sample_movement
      WHERE sample_id_fk=v_children[v_i];
      BEGIN
        PERFORM dflow.post_sample_movement(
          v_children[v_i],1,'in_transit',v_outbound::text,'in_transit',v_return::text,'return',
          'contract-test','ningbo','issue-1502-lowercase-reroute','hash',NULL,v_return_line);
        RAISE EXCEPTION 'lowercase Ningbo return destination was accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
      SELECT count(*) INTO v_after FROM dflow.sample_movement
      WHERE sample_id_fk=v_children[v_i];
      IF v_after <> v_before THEN
        RAISE EXCEPTION 'rejected lowercase return wrote a movement row';
      END IF;
    END IF;
  END LOOP;

  IF (SELECT count(DISTINCT root_sample_id_fk) FROM dflow.sample_piece_lineage
      WHERE parent_sample_id_fk=v_parent) <> 1 THEN
    RAISE EXCEPTION 'siblings lost their common lineage root';
  END IF;
  IF (SELECT count(*) FROM dflow.sample_factory_visit
      WHERE sample_id_fk=ANY(v_children) AND state='shipped') <> 3 THEN
    RAISE EXCEPTION 'three sibling factory visits were not concurrently active';
  END IF;
END $$;

ROLLBACK;
