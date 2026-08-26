BEGIN;

DO $$
DECLARE
  v_sample integer;
  v_sample_qc integer;
  v_attachment integer;
  v_other_attachment integer;
  v_before bigint;
  v_first_id bigint;
  v_replay_id bigint;
BEGIN
  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('usa_bought','outbound','approval-no-qc','created','known')
  RETURNING sample_id_pk INTO v_sample;
  INSERT INTO dflow.sample_attachment(attachment_type,attachment_link,sample_id_fk)
  VALUES('photo','contract://photo',v_sample)
  RETURNING sample_attachment_id INTO v_attachment;
  SELECT count(*) INTO v_before FROM dflow.sample_movement WHERE sample_id_fk=v_sample;

  PERFORM dflow.post_sample_approval_event(v_sample,'photo','pending',false,
    'contract-test','production','photo-1','hash-1',v_attachment);
  PERFORM dflow.post_sample_approval_event(v_sample,'photo','approved',false,
    'contract-test','production','photo-2','hash-2',v_attachment,'customer','customer-1');
  IF (SELECT approval_state FROM dflow.sample_approval_current
      WHERE sample_id_fk=v_sample AND approval_type='photo') <> 'approved' THEN
    RAISE EXCEPTION 'approved photo was not current';
  END IF;
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_sample,'qc','pending',false,
      'contract-test','production','qc-forbidden','hash-qf');
    RAISE EXCEPTION 'QC was accepted when not required';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('usa_bought','outbound','approval-qc','created','known')
  RETURNING sample_id_pk INTO v_sample_qc;
  INSERT INTO dflow.sample_attachment(attachment_type,attachment_link,sample_id_fk)
  VALUES('photo','contract://other-photo',v_sample_qc)
  RETURNING sample_attachment_id INTO v_other_attachment;
  BEGIN
    INSERT INTO dflow.sample_approval_event(sample_id_fk,sample_attachment_id,approval_type,
      approval_state,qc_required,actor_user,actor_role,idempotency_key,request_hash)
    VALUES(v_sample,v_other_attachment,'photo','pending',false,'contract-test','production',
      'cross-sample-attachment','hash-cross');
    RAISE EXCEPTION 'cross-sample attachment was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO dflow.sample_approval_event(sample_id_fk,approval_type,approval_state,qc_required,
      actor_user,actor_role,idempotency_key,request_hash)
    VALUES(v_sample_qc,'qc','approved',true,'contract-test','production','direct-skip','hash-direct');
    RAISE EXCEPTION 'direct insert bypassed the approval transition guard';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_sample_qc,'photo','approved',true,
      'contract-test','production','skip-photo','hash-sp');
    RAISE EXCEPTION 'initial pending photo state was skipped';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM dflow.post_sample_approval_event(v_sample_qc,'photo','pending',true,
    'contract-test','production','photo-q1','hash-q1');
  PERFORM dflow.post_sample_approval_event(v_sample_qc,'photo','rejected',true,
    'contract-test','production','photo-q2','hash-q2',NULL,NULL,NULL,'needs rework');
  BEGIN
    UPDATE dflow.sample_approval_event SET reason='rewritten'
    WHERE sample_id_fk=v_sample_qc AND idempotency_key='photo-q2';
    RAISE EXCEPTION 'approval history update was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM dflow.sample_approval_event
    WHERE sample_id_fk=v_sample_qc AND idempotency_key='photo-q2';
    RAISE EXCEPTION 'approval history delete was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    INSERT INTO dflow.sample_approval_event(sample_id_fk,approval_type,approval_state,qc_required,
      actor_user,actor_role,idempotency_key,request_hash)
    VALUES(v_sample_qc,'photo','rejected',true,'contract-test','production',
      'reasonless-reject','hash-reasonless');
    RAISE EXCEPTION 'reasonless rejection was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM dflow.post_sample_approval_event(v_sample_qc,'photo','pending',true,
    'contract-test','production','photo-q3','hash-q3');
  PERFORM dflow.post_sample_approval_event(v_sample_qc,'photo','approved',true,
    'contract-test','production','photo-q4','hash-q4');
  IF (SELECT count(*) FROM dflow.sample_approval_event
      WHERE sample_id_fk=v_sample_qc AND approval_type='photo') <> 4 THEN
    RAISE EXCEPTION 'photo rejection/rework history was not preserved';
  END IF;

  SELECT sample_approval_event_id INTO v_first_id
  FROM dflow.post_sample_approval_event(v_sample_qc,'qc','pending',true,
    'contract-test','production','qc-q1','hash-qq1');
  SELECT sample_approval_event_id INTO v_replay_id
  FROM dflow.post_sample_approval_event(v_sample_qc,'qc','pending',true,
    'contract-test','production','qc-q1','hash-qq1');
  IF v_first_id <> v_replay_id THEN RAISE EXCEPTION 'exact replay inserted another event'; END IF;
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_sample_qc,'qc','pending',true,
      'contract-test','production','qc-q1','different-hash');
    RAISE EXCEPTION 'idempotency conflict was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM dflow.post_sample_approval_event(v_sample_qc,'qc','rejected',true,
    'contract-test','production','qc-q2','hash-qq2',NULL,NULL,NULL,'failed QC');
  PERFORM dflow.post_sample_approval_event(v_sample_qc,'qc','pending',true,
    'contract-test','production','qc-q3','hash-qq3');
  PERFORM dflow.post_sample_approval_event(v_sample_qc,'qc','approved',true,
    'contract-test','production','qc-q4','hash-qq4');
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_sample_qc,'qc','rejected',true,
      'contract-test','production','qc-skip','hash-skip',NULL,NULL,NULL,'late reject');
    RAISE EXCEPTION 'approved QC was allowed to transition';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF (SELECT count(*) FROM dflow.sample_movement WHERE sample_id_fk IN (v_sample,v_sample_qc)) <> v_before THEN
    RAISE EXCEPTION 'approval events posted sample movements';
  END IF;
END $$;

ROLLBACK;
