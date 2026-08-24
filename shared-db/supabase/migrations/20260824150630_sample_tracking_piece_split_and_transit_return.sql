-- Sample Tracking Step 5: conserved piece splitting and check-in-free returns.
BEGIN;

ALTER TABLE dflow.sample_movement
  DROP CONSTRAINT sample_movement_lifecycle_action_check;
ALTER TABLE dflow.sample_movement
  ADD CONSTRAINT sample_movement_lifecycle_action_check CHECK (lifecycle_action IN (
    'create','pack','ship','receive','retain','repack','deliver','return',
    'dispose','loss','correct','reopen','closeout','split_out','split_in'
  ));

ALTER TABLE dflow.sample_movement
  DROP CONSTRAINT sample_movement_transit_location_identity_check;
ALTER TABLE dflow.sample_movement
  ADD CONSTRAINT sample_movement_transit_location_identity_check CHECK (
    (
      lifecycle_action = 'return'
      AND from_location_type = 'in_transit'
      AND to_location_type = 'in_transit'
      AND from_location_id <> to_location_id
      AND box_id_fk IS NULL
      AND sample_shipment_id IS NOT NULL
      AND to_location_id = sample_shipment_id::text
    )
    OR
    (
      (from_location_type <> 'in_transit'
       OR from_location_id = COALESCE(box_id_fk::text,sample_shipment_id::text))
      AND
      (to_location_type <> 'in_transit'
       OR to_location_id = COALESCE(box_id_fk::text,sample_shipment_id::text))
    )
  );

CREATE OR REPLACE FUNCTION dflow.sample_movement_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_balance bigint; v_original_sample integer;
BEGIN
  PERFORM pg_advisory_xact_lock(21450, NEW.sample_id_fk);
  IF NEW.reversal_of_movement_id IS NOT NULL THEN
    SELECT sample_id_fk INTO v_original_sample
    FROM dflow.sample_movement WHERE movement_id=NEW.reversal_of_movement_id;
    IF v_original_sample IS NULL OR v_original_sample <> NEW.sample_id_fk THEN
      RAISE EXCEPTION 'Correction must reference an existing movement for the same sample'
        USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT (
    NEW.from_location_type='terminal'
    AND (
      NEW.from_location_id IN ('created','receipt_overage','reconciled_opening')
      OR (NEW.lifecycle_action='split_in' AND NEW.from_location_id LIKE 'split_identity:%')
    )
  ) THEN
    SELECT COALESCE(sum(CASE WHEN to_location_type=NEW.from_location_type
                                  AND to_location_id=NEW.from_location_id
                             THEN quantity ELSE 0 END),0)
         - COALESCE(sum(CASE WHEN from_location_type=NEW.from_location_type
                                  AND from_location_id=NEW.from_location_id
                             THEN quantity ELSE 0 END),0)
      INTO v_balance FROM dflow.sample_movement WHERE sample_id_fk=NEW.sample_id_fk;
    IF v_balance < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient sample balance: available %, requested %',v_balance,NEW.quantity
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION dflow.validate_sample_movement_shipment_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_line dflow.sample_shipment_line;
  v_visit dflow.sample_factory_visit;
  v_outbound_line dflow.sample_shipment_line;
  v_workflow_type text;
BEGIN
  IF NEW.shipment_line_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('sample_shipment_line:' || NEW.shipment_line_id::text,0));
  SELECT * INTO v_line FROM dflow.sample_shipment_line
  WHERE shipment_line_id=NEW.shipment_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment line % does not exist',NEW.shipment_line_id USING ERRCODE='23503';
  END IF;
  IF NEW.sample_id_fk IS DISTINCT FROM v_line.sample_id_fk
     OR NEW.box_id_fk IS DISTINCT FROM v_line.box_id_fk
     OR NEW.sample_shipment_id IS DISTINCT FROM v_line.sample_shipment_id THEN
    RAISE EXCEPTION 'Movement identity does not match shipment line %',NEW.shipment_line_id
      USING ERRCODE='23514';
  END IF;

  IF v_line.sample_shipment_id IS NOT NULL
     AND NEW.lifecycle_action = 'return'
     AND NEW.from_location_type = 'in_transit'
     AND NEW.to_location_type = 'in_transit' THEN
    SELECT v.* INTO v_visit
    FROM dflow.sample_factory_visit v
    WHERE v.sample_id_fk = NEW.sample_id_fk
      AND v.state = 'shipped'
      AND v.outbound_shipment_id::text = NEW.from_location_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transit return has no matching shipped factory visit for sample %',NEW.sample_id_fk
        USING ERRCODE='23514';
    END IF;

    SELECT workflow_type INTO v_workflow_type
    FROM dflow.sample_workflow WHERE sample_id_fk=NEW.sample_id_fk;
    IF v_workflow_type IS DISTINCT FROM 'nyo_purchased_factory_reference' THEN
      RAISE EXCEPTION 'Transit return requires a Flow 1 sample' USING ERRCODE='23514';
    END IF;

    SELECT * INTO v_outbound_line
    FROM dflow.sample_shipment_line
    WHERE sample_shipment_id=v_visit.outbound_shipment_id
      AND sample_id_fk=NEW.sample_id_fk;
    IF NOT FOUND
       OR v_outbound_line.destination_location_type IS DISTINCT FROM 'factory'
       OR v_outbound_line.destination_location_id IS DISTINCT FROM v_visit.factory_id::text
       OR v_line.origin_location_type IS DISTINCT FROM 'factory'
       OR v_line.origin_location_id IS DISTINCT FROM v_visit.factory_id::text
       OR v_line.destination_location_type IS DISTINCT FROM 'office'
       OR v_line.destination_location_id IS DISTINCT FROM 'ningbo'
       OR NEW.to_location_id IS DISTINCT FROM v_line.sample_shipment_id::text
       OR NEW.from_location_id = NEW.to_location_id THEN
      RAISE EXCEPTION 'Transit return shipment does not match factory visit %',v_visit.sample_factory_visit_id
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_line.sample_shipment_id IS NOT NULL AND NOT (
    (NEW.from_location_type IS NOT DISTINCT FROM v_line.origin_location_type
      AND NEW.from_location_id IS NOT DISTINCT FROM v_line.origin_location_id
      AND NEW.to_location_type='in_transit')
    OR
    (NEW.from_location_type='in_transit'
      AND NEW.to_location_type IS NOT DISTINCT FROM v_line.destination_location_type
      AND NEW.to_location_id IS NOT DISTINCT FROM v_line.destination_location_id)
  ) THEN
    RAISE EXCEPTION 'Movement route does not match shipment line %',NEW.shipment_line_id
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION dflow.post_sample_piece_split(
  p_parent_sample_id integer,
  p_children jsonb,
  p_source_location_type text,
  p_source_location_id text,
  p_split_reason text,
  p_actor_user text,
  p_actor_role text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS SETOF dflow.sample_piece_lineage
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_parent_workflow dflow.sample_workflow;
  v_parent_sample dflow.sample;
  v_parent_root integer;
  v_total integer;
  v_existing dflow.sample_movement;
  v_child record;
  v_child_workflow dflow.sample_workflow;
  v_child_sample dflow.sample;
  v_existing_count integer;
  v_expected_count integer;
BEGIN
  IF jsonb_typeof(p_children) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_children) = 0 THEN
    RAISE EXCEPTION 'Piece split requires a non-empty children array' USING ERRCODE='22023';
  END IF;
  IF btrim(COALESCE(p_source_location_type,'')) = ''
     OR btrim(COALESCE(p_source_location_id,'')) = ''
     OR btrim(COALESCE(p_split_reason,'')) = ''
     OR btrim(COALESCE(p_actor_user,'')) = ''
     OR btrim(COALESCE(p_actor_role,'')) = ''
     OR btrim(COALESCE(p_idempotency_key,'')) = ''
     OR btrim(COALESCE(p_request_hash,'')) = '' THEN
    RAISE EXCEPTION 'Piece split identifiers and audit values must be non-empty' USING ERRCODE='22023';
  END IF;
  -- Flow 1 pieces may be split only while physically held by Ningbo or a
  -- factory. Synthetic terminal sources (especially terminal/created) are
  -- balance-exempt opening legs and must never be usable to mint child custody.
  IF p_source_location_type NOT IN ('office','factory') THEN
    RAISE EXCEPTION 'Piece split source must be a physical office or factory location'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_children) c
    WHERE jsonb_typeof(c.value) <> 'object'
       OR (c.value->>'sample_id') IS NULL
       OR (c.value->>'quantity') IS NULL
       OR (c.value->>'quantity')::integer <= 0
  ) OR (SELECT count(*) FROM jsonb_array_elements(p_children)) <>
       (SELECT count(DISTINCT (value->>'sample_id')::integer) FROM jsonb_array_elements(p_children)) THEN
    RAISE EXCEPTION 'Split children must have unique sample_id values and positive quantities'
      USING ERRCODE='23514';
  END IF;

  PERFORM pg_advisory_xact_lock(21450, sample_id)
  FROM (
    SELECT p_parent_sample_id AS sample_id
    UNION
    SELECT (value->>'sample_id')::integer FROM jsonb_array_elements(p_children)
  ) ids ORDER BY sample_id;

  SELECT * INTO v_existing FROM dflow.sample_movement
  WHERE sample_id_fk=p_parent_sample_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.lifecycle_action <> 'split_out'
       OR v_existing.request_hash <> p_request_hash
       OR v_existing.from_location_type <> p_source_location_type
       OR v_existing.from_location_id <> p_source_location_id THEN
      RAISE EXCEPTION 'Idempotency key reused with different split request' USING ERRCODE='23505';
    END IF;
    SELECT count(*) INTO v_existing_count
    FROM dflow.sample_piece_lineage l
    JOIN jsonb_array_elements(p_children) c
      ON l.sample_id_fk=(c.value->>'sample_id')::integer
     AND l.piece_quantity=(c.value->>'quantity')::integer
    WHERE l.parent_sample_id_fk=p_parent_sample_id
      AND l.split_by_user=p_actor_user
      AND l.request_hash=p_request_hash;
    SELECT count(*) INTO v_expected_count FROM jsonb_array_elements(p_children);
    IF v_existing_count <> v_expected_count
       OR v_existing.quantity <> (
         SELECT sum((value->>'quantity')::integer) FROM jsonb_array_elements(p_children)
       ) THEN
      RAISE EXCEPTION 'Idempotency key reused with different split children or quantity'
        USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT l.* FROM dflow.sample_piece_lineage l
      WHERE l.parent_sample_id_fk=p_parent_sample_id
        AND l.split_by_user=p_actor_user AND l.request_hash=p_request_hash
      ORDER BY l.sample_id_fk;
    RETURN;
  END IF;

  SELECT * INTO v_parent_workflow FROM dflow.sample_workflow
  WHERE sample_id_fk=p_parent_sample_id FOR UPDATE;
  SELECT * INTO v_parent_sample FROM dflow.sample
  WHERE sample_id_pk=p_parent_sample_id FOR UPDATE;
  IF NOT FOUND OR v_parent_workflow.workflow_type IS DISTINCT FROM 'nyo_purchased_factory_reference' THEN
    RAISE EXCEPTION 'Piece splitting requires a Flow 1 parent sample' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(l.root_sample_id_fk,p_parent_sample_id) INTO v_parent_root
  FROM (SELECT 1) seed
  LEFT JOIN dflow.sample_piece_lineage l ON l.sample_id_fk=p_parent_sample_id;

  v_total := 0;
  FOR v_child IN
    SELECT (value->>'sample_id')::integer AS sample_id,
           (value->>'quantity')::integer AS quantity
    FROM jsonb_array_elements(p_children) ORDER BY 1
  LOOP
    IF v_child.sample_id = p_parent_sample_id THEN
      RAISE EXCEPTION 'A sample cannot be split into itself' USING ERRCODE='23514';
    END IF;
    SELECT * INTO v_child_workflow FROM dflow.sample_workflow
      WHERE sample_id_fk=v_child.sample_id FOR UPDATE;
    SELECT * INTO v_child_sample FROM dflow.sample
      WHERE sample_id_pk=v_child.sample_id FOR UPDATE;
    IF NOT FOUND OR v_child_workflow.workflow_type IS DISTINCT FROM v_parent_workflow.workflow_type
       OR v_child_workflow.business_path IS DISTINCT FROM v_parent_workflow.business_path
       OR v_child_workflow.creation_batch_id IS DISTINCT FROM v_parent_workflow.creation_batch_id
       OR (v_child_sample.item_id_fk,v_child_sample.prod_order_no_fk,v_child_sample.customer_id_fk)
          IS DISTINCT FROM
          (v_parent_sample.item_id_fk,v_parent_sample.prod_order_no_fk,v_parent_sample.customer_id_fk) THEN
      RAISE EXCEPTION 'Child sample % does not share the parent Flow 1 business identity',v_child.sample_id
        USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM dflow.sample_movement WHERE sample_id_fk=v_child.sample_id)
       OR EXISTS (SELECT 1 FROM dflow.sample_piece_lineage WHERE sample_id_fk=v_child.sample_id) THEN
      RAISE EXCEPTION 'Child sample % already has custody or lineage history',v_child.sample_id
        USING ERRCODE='23514';
    END IF;
    v_total := v_total + v_child.quantity;
  END LOOP;

  PERFORM dflow.post_sample_movement(
    p_parent_sample_id,v_total,p_source_location_type,p_source_location_id,
    'terminal','split_identity:' || p_parent_sample_id::text,'split_out',
    p_actor_user,p_actor_role,p_idempotency_key,p_request_hash
  );

  FOR v_child IN
    SELECT (value->>'sample_id')::integer AS sample_id,
           (value->>'quantity')::integer AS quantity
    FROM jsonb_array_elements(p_children) ORDER BY 1
  LOOP
    INSERT INTO dflow.sample_piece_lineage(
      sample_id_fk,parent_sample_id_fk,root_sample_id_fk,piece_quantity,
      split_reason,split_by_user,split_by_role,idempotency_key,request_hash
    ) VALUES (
      v_child.sample_id,p_parent_sample_id,v_parent_root,v_child.quantity,
      p_split_reason,p_actor_user,p_actor_role,
      p_idempotency_key || ':' || v_child.sample_id::text,p_request_hash
    );
    PERFORM dflow.post_sample_movement(
      v_child.sample_id,v_child.quantity,
      'terminal','split_identity:' || p_parent_sample_id::text,
      p_source_location_type,p_source_location_id,'split_in',
      p_actor_user,p_actor_role,
      p_idempotency_key || ':' || v_child.sample_id::text,p_request_hash
    );
  END LOOP;

  RETURN QUERY SELECT l.* FROM dflow.sample_piece_lineage l
    WHERE l.parent_sample_id_fk=p_parent_sample_id
      AND l.split_by_user=p_actor_user AND l.request_hash=p_request_hash
    ORDER BY l.sample_id_fk;
END $$;

CREATE OR REPLACE VIEW dflow.sample_global_status AS
SELECT
  s.sample_id_pk,
  CASE
    WHEN s.quantity_migration_state = 'unknown' THEN 'legacy_unknown'
    WHEN NOT EXISTS (
      SELECT 1 FROM dflow.sample_movement m WHERE m.sample_id_fk=s.sample_id_pk
    ) THEN 'uninitialized'
    WHEN EXISTS (
      SELECT 1 FROM dflow.sample_balance_by_location b
      WHERE b.sample_id_fk=s.sample_id_pk AND b.location_type='in_transit' AND b.quantity>0
    ) THEN 'in_transit'
    WHEN EXISTS (
      SELECT 1 FROM dflow.sample_balance_by_location b
      WHERE b.sample_id_fk=s.sample_id_pk AND b.quantity>0
        AND b.location_type IN ('factory','office')
    ) THEN 'outstanding'
    WHEN EXISTS (
      SELECT 1 FROM dflow.sample_open_stop_work o
      WHERE o.sample_id_fk=s.sample_id_pk AND o.location_type IN ('factory','office')
    ) THEN 'outstanding'
    WHEN EXISTS (
      SELECT 1 FROM dflow.sample_movement m
      WHERE m.sample_id_fk=s.sample_id_pk AND m.lifecycle_action='split_out'
    ) THEN 'split'
    ELSE 'complete'
  END AS derived_status
FROM dflow.sample s;

REVOKE ALL ON FUNCTION dflow.post_sample_piece_split(integer,jsonb,text,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dflow.validate_sample_movement_shipment_identity()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dflow.sample_movement_guard()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON dflow.sample_global_status FROM anon,authenticated;

COMMENT ON FUNCTION dflow.post_sample_piece_split(integer,jsonb,text,text,text,text,text,text,text) IS
  'Atomically conserves custody quantity when one Flow 1 sample identity is split into child sample identities.';
COMMENT ON VIEW dflow.sample_global_status IS
  'Derived global status from custody balances. Fully split parent identities remain split rather than appearing complete.';

COMMIT;
