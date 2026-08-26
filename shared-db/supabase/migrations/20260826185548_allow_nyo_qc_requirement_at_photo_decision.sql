-- Issue #1610: let NYO decide that QC is required when approving a pending photo.
-- All other approval-history QC flag changes remain forbidden.
BEGIN;

CREATE OR REPLACE FUNCTION dflow.validate_sample_approval_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current dflow.sample_approval_event;
  v_photo dflow.sample_approval_event;
BEGIN
  PERFORM pg_advisory_xact_lock(1520, NEW.sample_id_fk);

  IF NEW.sample_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dflow.sample_attachment
    WHERE sample_attachment_id = NEW.sample_attachment_id
      AND sample_id_fk = NEW.sample_id_fk
  ) THEN
    RAISE EXCEPTION 'Attachment % does not belong to sample %',
      NEW.sample_attachment_id, NEW.sample_id_fk USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_current
  FROM dflow.sample_approval_event
  WHERE sample_id_fk = NEW.sample_id_fk AND approval_type = NEW.approval_type
  ORDER BY created_at DESC, sample_approval_event_id DESC
  LIMIT 1;

  IF NOT FOUND AND NEW.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'The first % approval event must be pending', NEW.approval_type
      USING ERRCODE = '23514';
  ELSIF FOUND AND NOT (
    (v_current.approval_state = 'pending' AND NEW.approval_state IN ('approved','rejected')) OR
    (v_current.approval_state = 'rejected' AND NEW.approval_state = 'pending')
  ) THEN
    RAISE EXCEPTION 'Invalid % approval transition from % to %',
      NEW.approval_type, v_current.approval_state, NEW.approval_state USING ERRCODE = '23514';
  END IF;

  IF FOUND AND NEW.qc_required IS DISTINCT FROM v_current.qc_required
     AND NOT (
       NEW.approval_type = 'photo'
       AND v_current.approval_state = 'pending'
       AND NEW.approval_state = 'approved'
       AND NOT v_current.qc_required
       AND NEW.qc_required
     ) THEN
    RAISE EXCEPTION 'QC requirement cannot change within an approval history'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.approval_type = 'qc' THEN
    SELECT * INTO v_photo
    FROM dflow.sample_approval_event
    WHERE sample_id_fk = NEW.sample_id_fk AND approval_type = 'photo'
    ORDER BY created_at DESC, sample_approval_event_id DESC
    LIMIT 1;
    IF NOT FOUND OR v_photo.approval_state <> 'approved' OR NOT v_photo.qc_required THEN
      RAISE EXCEPTION 'QC decisions require a currently approved photo with QC required'
        USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.qc_required THEN
      RAISE EXCEPTION 'QC events must carry qc_required=true' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
