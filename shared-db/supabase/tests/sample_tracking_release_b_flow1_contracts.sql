-- Transactional Release B (Flow 1 factory visits) contract proof.
-- Run after all migrations. Everything here rolls back.
BEGIN;

DO $$
DECLARE
  v_f1 integer;
  v_f2 integer;
  v_f3 integer;
  v_parent integer;
  v_child_a integer;
  v_child_b integer;
  v_other integer;
  v_notflow integer;
  v_visit1 bigint;
  v_visit2 bigint;
  v_visit3 bigint;
  v_visit4 bigint;
  v_visit_a bigint;
  v_visit_b bigint;
  v_ship bigint;
  v_state text;
  v_plan text := '';
  r record;
BEGIN
  -- Relations exist ------------------------------------------------------
  IF to_regclass('dflow.sample_factory_visit') IS NULL
     OR to_regclass('dflow.sample_factory_visit_event') IS NULL
     OR to_regclass('dflow.sample_piece_lineage') IS NULL
     OR to_regclass('dflow.sample_visit_plan') IS NULL THEN
    RAISE EXCEPTION 'Release B relations are missing';
  END IF;

  -- Release A already carries both Flow 1 route legs; Release B adds none.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'dflow.sample_shipment_line'::regclass
      AND conname = 'sample_shipment_line_route_leg_check'
      AND pg_get_constraintdef(oid) LIKE '%ningbo_to_factory%'
      AND pg_get_constraintdef(oid) LIKE '%factory_return_to_ningbo%'
  ) THEN
    RAISE EXCEPTION 'Release A Flow 1 route legs are missing from the allow-list';
  END IF;

  -- Fixtures -------------------------------------------------------------
  INSERT INTO dflow."Factory"(factory_name) VALUES('release-b-factory-1')
  RETURNING id INTO v_f1;
  INSERT INTO dflow."Factory"(factory_name) VALUES('release-b-factory-2')
  RETURNING id INTO v_f2;
  INSERT INTO dflow."Factory"(factory_name) VALUES('release-b-factory-3')
  RETURNING id INTO v_f3;

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('usa_bought','outbound','release-b-parent','created','known')
  RETURNING sample_id_pk INTO v_parent;
  INSERT INTO dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
  VALUES(v_parent,'nyo_purchased_factory_reference','nyo_ningbo','contract-test');

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('usa_bought','outbound','release-b-child-a','created','known')
  RETURNING sample_id_pk INTO v_child_a;
  INSERT INTO dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
  VALUES(v_child_a,'nyo_purchased_factory_reference','nyo_ningbo','contract-test');

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('usa_bought','outbound','release-b-child-b','created','known')
  RETURNING sample_id_pk INTO v_child_b;
  INSERT INTO dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
  VALUES(v_child_b,'nyo_purchased_factory_reference','nyo_ningbo','contract-test');

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('usa_bought','outbound','release-b-unrelated','created','known')
  RETURNING sample_id_pk INTO v_other;

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('factory_offer','inbound','release-b-not-flow1','created','known')
  RETURNING sample_id_pk INTO v_notflow;
  INSERT INTO dflow.sample_workflow(sample_id_fk,workflow_type,business_path,created_by_user)
  VALUES(v_notflow,'vendor_unsolicited_offer','factory_nyo','contract-test');

  -- (8) A visit on a non-Flow-1 sample is rejected -----------------------
  BEGIN
    INSERT INTO dflow.sample_factory_visit(
      sample_id_fk,factory_id,visit_order,provenance,
      requested_by_user,requested_by_role,idempotency_key,request_hash)
    VALUES(v_notflow,v_f1,1,'nyo_requested','nyo','nyo','k-notflow','h');
    RAISE EXCEPTION 'a factory visit was accepted on a non-Flow-1 sample';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (9) Lineage root coherence ------------------------------------------
  INSERT INTO dflow.sample_piece_lineage(
    sample_id_fk,parent_sample_id_fk,root_sample_id_fk,piece_quantity,
    split_reason,split_by_user,split_by_role,idempotency_key,request_hash)
  VALUES(v_child_a,v_parent,v_parent,1,'divergent factories','ningbo','ningbo','k-la','h');

  BEGIN
    INSERT INTO dflow.sample_piece_lineage(
      sample_id_fk,parent_sample_id_fk,root_sample_id_fk,piece_quantity,
      split_reason,split_by_user,split_by_role,idempotency_key,request_hash)
    VALUES(v_child_b,v_child_a,v_other,1,'wrong root','ningbo','ningbo','k-bad','h');
    RAISE EXCEPTION 'a lineage row with a drifting root was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Correct: child of a child keeps the grandparent root.
  INSERT INTO dflow.sample_piece_lineage(
    sample_id_fk,parent_sample_id_fk,root_sample_id_fk,piece_quantity,
    split_reason,split_by_user,split_by_role,idempotency_key,request_hash)
  VALUES(v_child_b,v_child_a,v_parent,1,'divergent factories','ningbo','ningbo','k-lb','h');

  -- Plan three factories on the parent piece ----------------------------
  INSERT INTO dflow.sample_factory_visit(
    sample_id_fk,factory_id,visit_order,provenance,
    requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES(v_parent,v_f1,1,'nyo_requested','nyo','nyo','k-v1','h')
  RETURNING sample_factory_visit_id INTO v_visit1;
  INSERT INTO dflow.sample_factory_visit(
    sample_id_fk,factory_id,visit_order,provenance,
    requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES(v_parent,v_f2,2,'nyo_requested','nyo','nyo','k-v2','h')
  RETURNING sample_factory_visit_id INTO v_visit2;
  INSERT INTO dflow.sample_factory_visit(
    sample_id_fk,factory_id,visit_order,provenance,
    requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES(v_parent,v_f3,3,'ningbo_added','ningbo','ningbo','k-v3','h')
  RETURNING sample_factory_visit_id INTO v_visit3;

  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES
    (v_visit1,1,'planned','planned','planned','nyo plan','nyo','nyo'),
    (v_visit2,1,'planned','planned','planned','nyo plan','nyo','nyo'),
    (v_visit3,1,'planned','planned','planned','ningbo addition','ningbo','ningbo');

  -- (7) A state change with no matching event row raises -----------------
  BEGIN
    UPDATE dflow.sample_factory_visit SET state='shipped'
    WHERE sample_factory_visit_id=v_visit1;
    RAISE EXCEPTION 'visit state changed without a matching event row';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  -- (3) Reorder among planned visits ------------------------------------
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,from_visit_order,to_visit_order,
    reason,changed_by_user,changed_by_role)
  VALUES(v_visit3,2,'reordered','planned',3,4,'ningbo resequenced','ningbo','ningbo');
  IF (SELECT visit_order FROM dflow.sample_factory_visit
      WHERE sample_factory_visit_id=v_visit3) <> 4 THEN
    RAISE EXCEPTION 'reorder event did not apply the new visit order';
  END IF;

  -- Ship visit 1 ---------------------------------------------------------
  INSERT INTO dflow.sample_shipment(
    origin_location_type,origin_location_id,destination_location_type,destination_location_id,
    state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
  VALUES('office','ningbo','factory',v_f1::text,'shipped',now(),'ningbo','ningbo','k-s1','h')
  RETURNING sample_shipment_id INTO v_ship;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
    reason,changed_by_user,changed_by_role)
  VALUES(v_visit1,2,'shipped','planned','shipped',v_ship,'outbound','ningbo','ningbo');

  IF (SELECT state FROM dflow.sample_factory_visit WHERE sample_factory_visit_id=v_visit1)
     <> 'shipped' THEN
    RAISE EXCEPTION 'shipped event did not apply to the visit';
  END IF;

  -- (3b) Reordering a shipped visit is rejected --------------------------
  BEGIN
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,from_visit_order,to_visit_order,
      reason,changed_by_user,changed_by_role)
    VALUES(v_visit1,3,'reordered','shipped',1,9,'late reorder','ningbo','ningbo');
    RAISE EXCEPTION 'a shipped visit was reordered';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (1) A second active visit on the same piece is rejected --------------
  BEGIN
    INSERT INTO dflow.sample_shipment(
      origin_location_type,origin_location_id,destination_location_type,destination_location_id,
      state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
    VALUES('office','ningbo','factory',v_f2::text,'shipped',now(),'ningbo','ningbo','k-s2','h')
    RETURNING sample_shipment_id INTO v_ship;
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
      reason,changed_by_user,changed_by_role)
    VALUES(v_visit2,2,'shipped','planned','shipped',v_ship,'second outbound','ningbo','ningbo');
    RAISE EXCEPTION 'a second active visit was accepted on one physical piece';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- (1b) Two sibling pieces of one root may be active at once ------------
  INSERT INTO dflow.sample_factory_visit(
    sample_id_fk,factory_id,visit_order,provenance,
    requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES(v_child_a,v_f2,1,'ningbo_added','ningbo','ningbo','k-va','h')
  RETURNING sample_factory_visit_id INTO v_visit_a;
  INSERT INTO dflow.sample_factory_visit(
    sample_id_fk,factory_id,visit_order,provenance,
    requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES(v_child_b,v_f3,1,'ningbo_added','ningbo','ningbo','k-vb','h')
  RETURNING sample_factory_visit_id INTO v_visit_b;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES
    (v_visit_a,1,'planned','planned','planned','sibling plan','ningbo','ningbo'),
    (v_visit_b,1,'planned','planned','planned','sibling plan','ningbo','ningbo');

  INSERT INTO dflow.sample_shipment(
    origin_location_type,origin_location_id,destination_location_type,destination_location_id,
    state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
  VALUES('office','ningbo','factory',v_f2::text,'shipped',now(),'ningbo','ningbo','k-sa','h')
  RETURNING sample_shipment_id INTO v_ship;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
    reason,changed_by_user,changed_by_role)
  VALUES(v_visit_a,2,'shipped','planned','shipped',v_ship,'sibling outbound','ningbo','ningbo');

  INSERT INTO dflow.sample_shipment(
    origin_location_type,origin_location_id,destination_location_type,destination_location_id,
    state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
  VALUES('office','ningbo','factory',v_f3::text,'shipped',now(),'ningbo','ningbo','k-sb','h')
  RETURNING sample_shipment_id INTO v_ship;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
    reason,changed_by_user,changed_by_role)
  VALUES(v_visit_b,2,'shipped','planned','shipped',v_ship,'sibling outbound','ningbo','ningbo');

  IF (SELECT count(*) FROM dflow.sample_factory_visit
      WHERE sample_id_fk IN (v_child_a,v_child_b) AND state='shipped') <> 2 THEN
    RAISE EXCEPTION 'two sibling pieces could not be at two factories at once';
  END IF;

  -- (2) Full happy path with the optional factory check-in ---------------
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES(v_visit1,3,'factory_received','shipped','at_factory','factory checked in','factory','factory');
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES(v_visit1,4,'return_started','at_factory','returning','factory returning','factory','factory');
  INSERT INTO dflow.sample_shipment(
    origin_location_type,origin_location_id,destination_location_type,destination_location_id,
    state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
  VALUES('factory',v_f1::text,'office','ningbo','shipped',now(),'factory','factory','k-r1','h')
  RETURNING sample_shipment_id INTO v_ship;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
    reason,changed_by_user,changed_by_role)
  VALUES(v_visit1,5,'returned','returning','returned',v_ship,'ningbo received','ningbo','ningbo');

  SELECT state INTO v_state FROM dflow.sample_factory_visit WHERE sample_factory_visit_id=v_visit1;
  IF v_state <> 'returned' THEN
    RAISE EXCEPTION 'happy path did not close the visit, state is %', v_state;
  END IF;
  IF (SELECT closed_at IS NULL OR returned_at IS NULL OR return_shipment_id IS NULL
      FROM dflow.sample_factory_visit WHERE sample_factory_visit_id=v_visit1) THEN
    RAISE EXCEPTION 'returned visit is missing its closure evidence';
  END IF;

  -- (2b) The same path with factory check-in skipped entirely ------------
  INSERT INTO dflow.sample_shipment(
    origin_location_type,origin_location_id,destination_location_type,destination_location_id,
    state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
  VALUES('office','ningbo','factory',v_f2::text,'shipped',now(),'ningbo','ningbo','k-s2b','h')
  RETURNING sample_shipment_id INTO v_ship;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
    reason,changed_by_user,changed_by_role)
  VALUES(v_visit2,2,'shipped','planned','shipped',v_ship,'next visit becomes active','ningbo','ningbo');

  INSERT INTO dflow.sample_shipment(
    origin_location_type,origin_location_id,destination_location_type,destination_location_id,
    state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
  VALUES('factory',v_f2::text,'office','ningbo','shipped',now(),'factory','factory','k-r2','h')
  RETURNING sample_shipment_id INTO v_ship;
  -- shipped -> returned DIRECTLY: factory check-in is optional and must never
  -- be able to strand the return.
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
    reason,changed_by_user,changed_by_role)
  VALUES(v_visit2,3,'returned','shipped','returned',v_ship,'ningbo received','ningbo','ningbo');
  IF (SELECT state FROM dflow.sample_factory_visit WHERE sample_factory_visit_id=v_visit2)
     <> 'returned' THEN
    RAISE EXCEPTION 'a return could not close a visit that skipped factory check-in';
  END IF;

  -- (4) Cancelling a planned visit frees its order slot ------------------
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES(v_visit3,3,'cancelled','planned','cancelled','no longer needed','ningbo','ningbo');

  INSERT INTO dflow.sample_factory_visit(
    sample_id_fk,factory_id,visit_order,provenance,
    requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES(v_parent,v_f3,4,'ningbo_added','ningbo','ningbo','k-v4','h')
  RETURNING sample_factory_visit_id INTO v_visit4;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES(v_visit4,1,'planned','planned','planned','replacement visit','ningbo','ningbo');

  -- (4b) Cancelling a shipped visit is rejected --------------------------
  BEGIN
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
    VALUES(v_visit_a,3,'cancelled','shipped','cancelled','too late','ningbo','ningbo');
    RAISE EXCEPTION 'a shipped visit was cancelled';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (5) not_returned is terminal and blocks a new visit on that piece ----
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES(v_visit_a,3,'marked_not_returned','shipped','not_returned','factory never returned it','ningbo','ningbo');
  IF (SELECT state FROM dflow.sample_factory_visit WHERE sample_factory_visit_id=v_visit_a)
     <> 'not_returned' THEN
    RAISE EXCEPTION 'marked_not_returned did not apply';
  END IF;
  BEGIN
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
    VALUES(v_visit_a,4,'return_started','not_returned','returning','undo','ningbo','ningbo');
    RAISE EXCEPTION 'a not_returned visit was moved out of its terminal state';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO dflow.sample_factory_visit(
    sample_id_fk,factory_id,visit_order,provenance,
    requested_by_user,requested_by_role,idempotency_key,request_hash)
  VALUES(v_child_a,v_f1,2,'ningbo_added','ningbo','ningbo','k-va2','h')
  RETURNING sample_factory_visit_id INTO v_visit_a;
  INSERT INTO dflow.sample_factory_visit_event(
    sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
  VALUES(v_visit_a,1,'planned','planned','planned','retry','ningbo','ningbo');
  BEGIN
    INSERT INTO dflow.sample_shipment(
      origin_location_type,origin_location_id,destination_location_type,destination_location_id,
      state,shipped_at,actor_user,actor_role,idempotency_key,request_hash)
    VALUES('office','ningbo','factory',v_f1::text,'shipped',now(),'ningbo','ningbo','k-sa2','h')
    RETURNING sample_shipment_id INTO v_ship;
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,to_state,sample_shipment_id,
      reason,changed_by_user,changed_by_role)
    VALUES(v_visit_a,2,'shipped','planned','shipped',v_ship,'ship a lost piece','ningbo','ningbo');
    RAISE EXCEPTION 'a piece a factory never returned was shipped again';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (6) The event table is provably append-only --------------------------
  BEGIN
    UPDATE dflow.sample_factory_visit_event SET reason='rewritten'
    WHERE sample_factory_visit_id=v_visit1 AND revision=1;
    RAISE EXCEPTION 'a visit event was updated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM dflow.sample_factory_visit_event
    WHERE sample_factory_visit_id=v_visit1 AND revision=1;
    RAISE EXCEPTION 'a visit event was deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  -- Revisions are monotonic ----------------------------------------------
  BEGIN
    INSERT INTO dflow.sample_factory_visit_event(
      sample_factory_visit_id,revision,event_type,from_state,to_state,reason,changed_by_user,changed_by_role)
    VALUES(v_visit4,7,'cancelled','planned','cancelled','skipped revision','ningbo','ningbo');
    RAISE EXCEPTION 'a non-monotonic visit event revision was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- An unknown factory is now rejected (the real foreign key) ------------
  BEGIN
    INSERT INTO dflow.sample_factory_visit(
      sample_id_fk,factory_id,visit_order,provenance,
      requested_by_user,requested_by_role,idempotency_key,request_hash)
    VALUES(v_parent,-987654,9,'ningbo_added','ningbo','ningbo','k-badf','h');
    RAISE EXCEPTION 'a visit to an unknown factory was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Provenance survives reorder and cancellation --------------------------
  IF (SELECT provenance FROM dflow.sample_factory_visit WHERE sample_factory_visit_id=v_visit3)
     <> 'ningbo_added' THEN
    RAISE EXCEPTION 'provenance did not survive reorder and cancellation';
  END IF;

  -- The read view returns the plan ---------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM dflow.sample_visit_plan
    WHERE sample_id_fk = v_child_b AND root_sample_id_fk = v_parent AND piece_count = 3
  ) THEN
    RAISE EXCEPTION 'sample_visit_plan did not report the lineage root and piece count';
  END IF;

  -- (10) The view is index-usable on both documented filter paths.
  -- With sequential scans disabled the planner must be ABLE to reach an
  -- index; that is exactly the property dflow.sample_inventory lacks (#1181),
  -- where CASE-wrapped predicates make an index unreachable at any cost.
  SET LOCAL enable_seqscan = off;

  v_plan := '';
  FOR r IN EXECUTE
    'EXPLAIN SELECT * FROM dflow.sample_visit_plan WHERE sample_id_fk = ' || v_parent
  LOOP
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  END LOOP;
  IF v_plan NOT LIKE '%Index%sample_factory_visit%' AND v_plan NOT LIKE '%sample_factory_visit%Index%' THEN
    RAISE EXCEPTION 'sample_visit_plan cannot use an index for sample_id_fk. Plan: %', v_plan;
  END IF;
  IF v_plan LIKE '%Seq Scan on sample_factory_visit %' THEN
    RAISE EXCEPTION 'sample_visit_plan still sequentially scans the visit table. Plan: %', v_plan;
  END IF;

  v_plan := '';
  FOR r IN EXECUTE
    'EXPLAIN SELECT * FROM dflow.sample_visit_plan WHERE factory_id = ' || v_f3
    || ' AND state = ''planned'''
  LOOP
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  END LOOP;
  IF v_plan NOT LIKE '%Index%sample_factory_visit%' AND v_plan NOT LIKE '%sample_factory_visit%Index%' THEN
    RAISE EXCEPTION 'sample_visit_plan cannot use an index for (factory_id, state). Plan: %', v_plan;
  END IF;
  IF v_plan LIKE '%Seq Scan on sample_factory_visit %' THEN
    RAISE EXCEPTION 'sample_visit_plan still sequentially scans the visit table. Plan: %', v_plan;
  END IF;

  RESET enable_seqscan;

  RAISE NOTICE 'Release B Flow 1 factory visit contracts passed';
END $$;

ROLLBACK;
