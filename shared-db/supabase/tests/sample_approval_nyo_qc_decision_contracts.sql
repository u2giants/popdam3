BEGIN;

DO $$
DECLARE
  v_allowed integer;
  v_rework integer;
  v_rejected integer;
  v_reverse integer;
  v_qc integer;
BEGIN
  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('factory_created','inbound','nyo-qc-allowed','created','known')
  RETURNING sample_id_pk INTO v_allowed;
  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('factory_created','inbound','nyo-qc-rework','created','known')
  RETURNING sample_id_pk INTO v_rework;
  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('factory_created','inbound','nyo-qc-rejected','created','known')
  RETURNING sample_id_pk INTO v_rejected;
  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('factory_created','inbound','nyo-qc-reverse','created','known')
  RETURNING sample_id_pk INTO v_reverse;
  INSERT INTO dflow.sample(origin,direction,sample_name,status,quantity_migration_state)
  VALUES('factory_created','inbound','nyo-qc-events','created','known')
  RETURNING sample_id_pk INTO v_qc;

  PERFORM dflow.post_sample_approval_event(v_allowed,'photo','pending',false,
    'vendor','vendor','allowed-1','allowed-hash-1');
  PERFORM dflow.post_sample_approval_event(v_allowed,'photo','approved',true,
    'nyo','nyo','allowed-2','allowed-hash-2');
  IF NOT (SELECT qc_required FROM dflow.sample_approval_current
          WHERE sample_id_fk=v_allowed AND approval_type='photo') THEN
    RAISE EXCEPTION 'NYO false-to-true QC decision was not retained';
  END IF;

  PERFORM dflow.post_sample_approval_event(v_rework,'photo','pending',false,
    'vendor','vendor','rework-1','rework-hash-1');
  PERFORM dflow.post_sample_approval_event(v_rework,'photo','rejected',false,
    'nyo','nyo','rework-2','rework-hash-2',NULL,NULL,NULL,'rework required');
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_rework,'photo','pending',true,
      'vendor','vendor','rework-3','rework-hash-3');
    RAISE EXCEPTION 'rejected-to-pending rework changed QC requirement';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  PERFORM dflow.post_sample_approval_event(v_rejected,'photo','pending',false,
    'vendor','vendor','reject-1','reject-hash-1');
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_rejected,'photo','rejected',true,
      'nyo','nyo','reject-2','reject-hash-2',NULL,NULL,NULL,'rejected');
    RAISE EXCEPTION 'pending-to-rejected changed QC requirement';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  PERFORM dflow.post_sample_approval_event(v_reverse,'photo','pending',true,
    'vendor','vendor','reverse-1','reverse-hash-1');
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_reverse,'photo','approved',false,
      'nyo','nyo','reverse-2','reverse-hash-2');
    RAISE EXCEPTION 'photo approval changed QC from true to false';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  PERFORM dflow.post_sample_approval_event(v_qc,'photo','pending',false,
    'vendor','vendor','qc-1','qc-hash-1');
  PERFORM dflow.post_sample_approval_event(v_qc,'photo','approved',true,
    'nyo','nyo','qc-2','qc-hash-2');
  BEGIN
    PERFORM dflow.post_sample_approval_event(v_qc,'qc','pending',false,
      'qc','qc','qc-3','qc-hash-3');
    RAISE EXCEPTION 'QC event accepted qc_required=false';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM dflow.post_sample_approval_event(v_qc,'qc','pending',true,
    'qc','qc','qc-4','qc-hash-4');
END $$;

ROLLBACK;
