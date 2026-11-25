-- #7117: audited designflow-backend develop services/factoryApprovals.service.js.
-- Writes: insert..on conflict update into core.factory_approval (:151-159,
-- updated_by = caller profile); insert into core.factory_approval_form
-- (factory_id, program, storage_path, file_name, uploaded_by) (:172), passing
-- uploaded_by explicitly; update app.notification set read_at, app 'plm' (:202).
-- All fit 20261225131100's grants. uploaded_by may be null when the signed-in
-- user has no app.profile, so the upload policy no longer requires it.
-- Recoverable: re-create the policy with uploaded_by IS NOT NULL.
-- derived-from: none
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $g$
BEGIN
  IF to_regrole('designflow_prod_backend_grants') IS NULL THEN
    RAISE NOTICE '#7117: designflow_prod_backend_grants absent; nothing to change';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS factory_approval_form_dflow_prod_backend_insert ON core.factory_approval_form;
  CREATE POLICY factory_approval_form_dflow_prod_backend_insert ON core.factory_approval_form
    FOR INSERT TO designflow_prod_backend_grants
    WITH CHECK (storage_bucket = 'factory-approval-forms' AND ocr_status = 'pending');
END
$g$;
COMMIT;
