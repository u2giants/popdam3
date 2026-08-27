-- Issue #1607: durable Flow 4 remote-stock requests and Ningbo packing reservations.
-- Request planning, confirmation, reservation, and packing never create custody:
-- dflow.sample_movement remains the sole physical-custody authority.

CREATE TABLE dflow.sample_remote_request (
  sample_remote_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_source text NOT NULL CHECK (request_source IN ('photo','china_warehouse','ningbo_inventory','mixed')),
  business_path text NOT NULL CHECK (business_path IN ('china_warehouse_ningbo_nyo','china_warehouse_ningbo_customer','ningbo_nyo','ningbo_customer','mixed')),
  destination_type text NOT NULL CHECK (destination_type IN ('office','customer')),
  destination_id text NOT NULL CHECK (btrim(destination_id) <> ''),
  requested_by_user text NOT NULL CHECK (btrim(requested_by_user) <> ''),
  requested_by_role text NOT NULL CHECK (requested_by_role = 'nyo'),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  request_hash text NOT NULL CHECK (btrim(request_hash) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sample_remote_request_source_path_check CHECK (
    (request_source IN ('photo','china_warehouse') AND business_path IN ('china_warehouse_ningbo_nyo','china_warehouse_ningbo_customer'))
    OR (request_source = 'ningbo_inventory' AND business_path IN ('ningbo_nyo','ningbo_customer'))
    OR (request_source = 'mixed' AND business_path = 'mixed')
  )
);

CREATE TABLE dflow.sample_remote_request_item (
  sample_remote_request_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_remote_request_id uuid NOT NULL REFERENCES dflow.sample_remote_request(sample_remote_request_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  workflow_id bigint NOT NULL REFERENCES dflow.sample_workflow(sample_workflow_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sample_id_fk integer REFERENCES dflow.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('photo','china_warehouse','ningbo_inventory')),
  business_path text NOT NULL CHECK (business_path IN ('china_warehouse_ningbo_nyo','china_warehouse_ningbo_customer','ningbo_nyo','ningbo_customer')),
  source_reference text,
  current_state text NOT NULL DEFAULT 'requested' CHECK (current_state IN (
    'requested','awaiting_ningbo','awaiting_qc','confirmed','not_found','declined',
    'in_transit_to_ningbo','received','reserved_for_next_box','packed','shipped_onward'
  )),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_hash text NOT NULL CHECK (btrim(request_hash) <> ''),
  created_by_user text NOT NULL CHECK (btrim(created_by_user) <> ''),
  created_by_role text NOT NULL CHECK (created_by_role = 'nyo'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sample_remote_request_id, idempotency_key),
  CHECK (source_type = 'photo' OR sample_id_fk IS NOT NULL),
  CHECK ((source_type IN ('photo','china_warehouse') AND business_path IN ('china_warehouse_ningbo_nyo','china_warehouse_ningbo_customer'))
      OR (source_type = 'ningbo_inventory' AND business_path IN ('ningbo_nyo','ningbo_customer'))),
  CHECK (source_reference IS NULL OR btrim(source_reference) <> '')
);

CREATE TABLE dflow.sample_remote_request_history (
  sample_remote_request_history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sample_remote_request_item_id uuid NOT NULL REFERENCES dflow.sample_remote_request_item(sample_remote_request_item_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL CHECK (to_state IN (
    'requested','awaiting_ningbo','awaiting_qc','confirmed','not_found','declined',
    'in_transit_to_ningbo','received','reserved_for_next_box','packed','shipped_onward'
  )),
  actor_user text NOT NULL CHECK (btrim(actor_user) <> ''),
  actor_role text NOT NULL CHECK (actor_role IN ('nyo','ningbo','qc')),
  note text,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(event_payload) = 'object'),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_hash text NOT NULL CHECK (btrim(request_hash) <> ''),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sample_remote_request_item_id, idempotency_key)
);

CREATE TABLE dflow.sample_reservation (
  sample_reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_remote_request_item_id uuid NOT NULL REFERENCES dflow.sample_remote_request_item(sample_remote_request_item_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sample_id_fk integer NOT NULL REFERENCES dflow.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT,
  reservation_state text NOT NULL DEFAULT 'reserved' CHECK (reservation_state IN ('reserved','packed')),
  open_sample_id integer GENERATED ALWAYS AS (CASE WHEN reservation_state = 'reserved' THEN sample_id_fk END) STORED UNIQUE,
  packed_box_id integer REFERENCES dflow.sample_box(box_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT,
  packed_shipment_line_id bigint REFERENCES dflow.sample_shipment_line(shipment_line_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reserved_by_user text NOT NULL CHECK (btrim(reserved_by_user) <> ''),
  packed_by_user text,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  request_hash text NOT NULL CHECK (btrim(request_hash) <> ''),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  packed_at timestamptz,
  CHECK ((reservation_state = 'reserved' AND packed_box_id IS NULL AND packed_shipment_line_id IS NULL AND packed_at IS NULL)
      OR (reservation_state = 'packed' AND packed_box_id IS NOT NULL AND packed_shipment_line_id IS NOT NULL AND packed_at IS NOT NULL AND btrim(packed_by_user) <> ''))
);

CREATE FUNCTION dflow.post_sample_remote_request_event(
  p_item_id uuid, p_to_state text, p_actor_user text, p_actor_role text,
  p_idempotency_key text, p_request_hash text, p_note text DEFAULT NULL,
  p_event_payload jsonb DEFAULT '{}'::jsonb
) RETURNS dflow.sample_remote_request_history
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, dflow AS $$
DECLARE v_item dflow.sample_remote_request_item; v_request dflow.sample_remote_request; v_workflow dflow.sample_workflow; v_existing dflow.sample_remote_request_history; v_result dflow.sample_remote_request_history;
BEGIN
  IF btrim(coalesce(p_actor_user,''))='' OR btrim(coalesce(p_idempotency_key,''))='' OR btrim(coalesce(p_request_hash,''))='' THEN
    RAISE EXCEPTION 'actor, idempotency key, and request hash are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM dflow.sample_remote_request_item WHERE sample_remote_request_item_id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'remote request item not found' USING ERRCODE='P0002'; END IF;
  -- The item lock serializes same-item first writers. Re-checking the key only
  -- after the lock makes a concurrent exact replay observe the committed row.
  SELECT * INTO v_existing FROM dflow.sample_remote_request_history WHERE sample_remote_request_item_id=p_item_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash OR v_existing.to_state<>p_to_state THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
    RETURN v_existing;
  END IF;
  SELECT * INTO v_request FROM dflow.sample_remote_request WHERE sample_remote_request_id=v_item.sample_remote_request_id;
  SELECT * INTO v_workflow FROM dflow.sample_workflow WHERE sample_workflow_id=v_item.workflow_id;
  IF v_workflow.workflow_type<>'nyo_remote_china_inventory_request' OR v_workflow.business_path<>v_item.business_path
     OR (v_item.sample_id_fk IS NOT NULL AND v_workflow.sample_id_fk<>v_item.sample_id_fk)
     OR (v_request.request_source<>'mixed' AND (v_request.request_source<>v_item.source_type OR v_request.business_path<>v_item.business_path)) THEN
    RAISE EXCEPTION 'request item source/path/workflow identity is invalid' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (v_item.current_state='requested' AND p_to_state='requested' AND p_actor_role='nyo'
      AND NOT EXISTS (SELECT 1 FROM dflow.sample_remote_request_history WHERE sample_remote_request_item_id=p_item_id)) OR
    (v_item.current_state='requested' AND p_to_state=CASE WHEN v_item.source_type='ningbo_inventory' THEN 'awaiting_ningbo' ELSE 'awaiting_qc' END AND p_actor_role='nyo') OR
    (v_item.current_state='awaiting_ningbo' AND p_to_state IN ('confirmed','not_found','declined') AND p_actor_role='ningbo') OR
    (v_item.current_state='awaiting_qc' AND p_to_state IN ('confirmed','not_found','declined') AND p_actor_role='qc') OR
    (v_item.current_state='confirmed' AND v_item.source_type IN ('photo','china_warehouse') AND p_to_state='in_transit_to_ningbo' AND p_actor_role='qc') OR
    (v_item.current_state='in_transit_to_ningbo' AND p_to_state='received' AND p_actor_role='ningbo') OR
    (v_item.current_state='packed' AND p_to_state='shipped_onward' AND p_actor_role='ningbo')
  ) THEN RAISE EXCEPTION 'invalid remote request transition or role: % -> % by %',v_item.current_state,p_to_state,p_actor_role USING ERRCODE='23514'; END IF;
  UPDATE dflow.sample_remote_request_item SET current_state=p_to_state,updated_at=now() WHERE sample_remote_request_item_id=p_item_id;
  INSERT INTO dflow.sample_remote_request_history(sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,note,event_payload,idempotency_key,request_hash)
  VALUES(p_item_id,v_item.current_state,p_to_state,p_actor_user,p_actor_role,p_note,coalesce(p_event_payload,'{}'::jsonb),p_idempotency_key,p_request_hash) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION dflow.reserve_sample_remote_request_item(
  p_item_id uuid, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text
) RETURNS dflow.sample_reservation
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, dflow AS $$
DECLARE v_item dflow.sample_remote_request_item; v_existing dflow.sample_reservation; v_result dflow.sample_reservation;
BEGIN
  IF p_actor_role<>'ningbo' THEN RAISE EXCEPTION 'only Ningbo may reserve a confirmed item' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM dflow.sample_remote_request_item WHERE sample_remote_request_item_id=p_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.sample_id_fk IS NULL THEN RAISE EXCEPTION 'reservable request item not found' USING ERRCODE='P0002'; END IF;
  -- Serialize first writers on the item, then re-check the operation key so a
  -- concurrent exact replay deterministically returns the committed reservation.
  SELECT * INTO v_existing FROM dflow.sample_reservation WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN IF v_existing.request_hash<>p_request_hash OR v_existing.sample_remote_request_item_id<>p_item_id THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF; RETURN v_existing; END IF;
  IF NOT ((v_item.source_type='ningbo_inventory' AND v_item.current_state='confirmed') OR (v_item.source_type IN ('photo','china_warehouse') AND v_item.current_state='received')) THEN
    RAISE EXCEPTION 'item is not physically confirmed in Ningbo' USING ERRCODE='23514';
  END IF;
  INSERT INTO dflow.sample_reservation(sample_remote_request_item_id,sample_id_fk,reserved_by_user,idempotency_key,request_hash)
  VALUES(p_item_id,v_item.sample_id_fk,p_actor_user,p_idempotency_key,p_request_hash) RETURNING * INTO v_result;
  UPDATE dflow.sample_remote_request_item SET current_state='reserved_for_next_box',updated_at=now() WHERE sample_remote_request_item_id=p_item_id;
  INSERT INTO dflow.sample_remote_request_history(sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,idempotency_key,request_hash)
  VALUES(p_item_id,v_item.current_state,'reserved_for_next_box',p_actor_user,p_actor_role,p_idempotency_key,p_request_hash);
  RETURN v_result;
END;
$$;

CREATE FUNCTION dflow.pack_sample_reservation(
  p_reservation_id uuid, p_box_id integer, p_sample_shipment_id bigint,
  p_origin_location_id text, p_destination_type text, p_destination_id text,
  p_route_leg text, p_actor_user text, p_actor_role text,
  p_idempotency_key text, p_request_hash text
) RETURNS dflow.sample_reservation
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, dflow AS $$
DECLARE v_res dflow.sample_reservation; v_item dflow.sample_remote_request_item; v_line dflow.sample_shipment_line; v_line_id bigint; v_membership_id integer;
BEGIN
  IF p_actor_role<>'ningbo' THEN RAISE EXCEPTION 'only Ningbo may pack a reservation' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_res FROM dflow.sample_reservation WHERE sample_reservation_id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE='P0002'; END IF;
  IF v_res.reservation_state='packed' THEN
    SELECT * INTO v_line FROM dflow.sample_shipment_line WHERE shipment_line_id=v_res.packed_shipment_line_id;
    IF v_res.packed_box_id<>p_box_id
       OR v_line.request_hash<>p_request_hash OR v_line.box_id_fk<>p_box_id
       OR v_line.idempotency_key<>p_idempotency_key
       OR v_line.sample_shipment_id IS DISTINCT FROM p_sample_shipment_id
       OR v_line.origin_location_type<>'office'
       OR v_line.origin_location_id<>p_origin_location_id
       OR v_line.destination_location_type<>p_destination_type
       OR v_line.destination_location_id<>p_destination_id
       OR v_line.route_leg<>p_route_leg THEN
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505';
    END IF;
    RETURN v_res;
  END IF;
  IF v_res.reservation_state<>'reserved' THEN RAISE EXCEPTION 'reservation is not open' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_item FROM dflow.sample_remote_request_item WHERE sample_remote_request_item_id=v_res.sample_remote_request_item_id FOR UPDATE;
  IF v_item.current_state<>'reserved_for_next_box' THEN RAISE EXCEPTION 'request item is not reserved for next box' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM dflow.sample_box WHERE box_id_pk=p_box_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'box not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_line FROM dflow.sample_shipment_line WHERE sample_id_fk=v_res.sample_id_fk AND idempotency_key=p_idempotency_key;
  IF FOUND AND (v_line.request_hash<>p_request_hash OR v_line.box_id_fk<>p_box_id
     OR v_line.sample_shipment_id IS DISTINCT FROM p_sample_shipment_id
     OR v_line.origin_location_type<>'office' OR v_line.origin_location_id<>p_origin_location_id
     OR v_line.destination_location_type<>p_destination_type OR v_line.destination_location_id<>p_destination_id
     OR v_line.route_leg<>p_route_leg) THEN
    RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505';
  END IF;
  INSERT INTO dflow.sample_shipment_item(sample_id_fk,box_id_fk,leg_type,added_date,added_user,quantity_intended)
  VALUES(v_res.sample_id_fk,p_box_id,p_route_leg,now(),p_actor_user,1)
  ON CONFLICT (sample_id_fk,box_id_fk) DO NOTHING RETURNING shipment_item_id_pk INTO v_membership_id;
  IF v_membership_id IS NULL AND NOT EXISTS (SELECT 1 FROM dflow.sample_shipment_item WHERE sample_id_fk=v_res.sample_id_fk AND box_id_fk=p_box_id) THEN RAISE EXCEPTION 'box membership conflict'; END IF;
  INSERT INTO dflow.sample_shipment_line(sample_id_fk,box_id_fk,quantity_intended,origin_location_type,origin_location_id,destination_location_type,destination_location_id,route_leg,state,idempotency_key,request_hash,created_by_user,created_by_role,sample_shipment_id)
  VALUES(v_res.sample_id_fk,p_box_id,1,'office',p_origin_location_id,p_destination_type,p_destination_id,p_route_leg,'packed',p_idempotency_key,p_request_hash,p_actor_user,p_actor_role,p_sample_shipment_id)
  ON CONFLICT (sample_id_fk,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key
  RETURNING shipment_line_id INTO v_line_id;
  UPDATE dflow.sample_reservation SET reservation_state='packed',packed_box_id=p_box_id,packed_shipment_line_id=v_line_id,packed_by_user=p_actor_user,packed_at=now() WHERE sample_reservation_id=p_reservation_id RETURNING * INTO v_res;
  UPDATE dflow.sample_remote_request_item SET current_state='packed',updated_at=now() WHERE sample_remote_request_item_id=v_item.sample_remote_request_item_id;
  INSERT INTO dflow.sample_remote_request_history(sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,idempotency_key,request_hash)
  VALUES(v_item.sample_remote_request_item_id,'reserved_for_next_box','packed',p_actor_user,p_actor_role,p_idempotency_key,p_request_hash);
  RETURN v_res;
END;
$$;

REVOKE ALL ON dflow.sample_remote_request,dflow.sample_remote_request_item,dflow.sample_remote_request_history,dflow.sample_reservation FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION dflow.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION dflow.reserve_sample_remote_request_item(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dflow.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dflow.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION dflow.reserve_sample_remote_request_item(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION dflow.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text) TO service_role;
GRANT SELECT,INSERT ON dflow.sample_remote_request,dflow.sample_remote_request_item TO service_role;
GRANT SELECT ON dflow.sample_remote_request_history,dflow.sample_reservation TO service_role;

COMMENT ON TABLE dflow.sample_reservation IS 'Flow 4 Ningbo next-box planning only; reservation and packing do not establish physical custody.';
COMMENT ON FUNCTION dflow.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text) IS 'Atomically consumes one Flow 4 reservation into box membership and shipment intent without writing sample_movement.';
