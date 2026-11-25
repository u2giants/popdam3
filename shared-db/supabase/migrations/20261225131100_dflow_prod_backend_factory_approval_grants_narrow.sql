-- #7070 / #7114: narrow the live DesignFlow backend's factory-approval access
-- granted in 20261225131000. Upload history and OCR columns stay owned by the
-- OCR worker: the backend may only insert an upload row (no update), and every
-- row policy is command-specific instead of FOR ALL. Notifications: read and
-- mark read (app 'plm') only. Recoverable: re-run 20261225131000's grants.
-- derived-from: none
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $g$
DECLARE r text := 'designflow_prod_backend_grants';
BEGIN
  IF to_regrole(r) IS NULL THEN
    RAISE NOTICE '#7114: % absent; nothing to narrow', r;
    RETURN;
  END IF;

  REVOKE INSERT, UPDATE ON core.factory_approval_form FROM designflow_prod_backend_grants;
  GRANT INSERT (factory_id, program, storage_path, file_name, uploaded_by)
    ON core.factory_approval_form TO designflow_prod_backend_grants;
  REVOKE UPDATE ON app.notification FROM designflow_prod_backend_grants;
  GRANT UPDATE (read_at) ON app.notification TO designflow_prod_backend_grants;

  DROP POLICY IF EXISTS factory_approval_dflow_prod_backend ON core.factory_approval;
  CREATE POLICY factory_approval_dflow_prod_backend_select ON core.factory_approval
    FOR SELECT TO designflow_prod_backend_grants USING (true);
  CREATE POLICY factory_approval_dflow_prod_backend_insert ON core.factory_approval
    FOR INSERT TO designflow_prod_backend_grants WITH CHECK (true);
  CREATE POLICY factory_approval_dflow_prod_backend_update ON core.factory_approval
    FOR UPDATE TO designflow_prod_backend_grants USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS factory_approval_form_dflow_prod_backend ON core.factory_approval_form;
  CREATE POLICY factory_approval_form_dflow_prod_backend_select ON core.factory_approval_form
    FOR SELECT TO designflow_prod_backend_grants USING (true);
  CREATE POLICY factory_approval_form_dflow_prod_backend_insert ON core.factory_approval_form
    FOR INSERT TO designflow_prod_backend_grants
    WITH CHECK (storage_bucket = 'factory-approval-forms' AND ocr_status = 'pending' AND uploaded_by IS NOT NULL);

  DROP POLICY IF EXISTS notification_dflow_prod_backend ON app.notification;
  CREATE POLICY notification_dflow_prod_backend_select ON app.notification
    FOR SELECT TO designflow_prod_backend_grants USING (app = 'plm'::app.app_name);
  CREATE POLICY notification_dflow_prod_backend_update ON app.notification
    FOR UPDATE TO designflow_prod_backend_grants
    USING (app = 'plm'::app.app_name) WITH CHECK (app = 'plm'::app.app_name);

  IF to_regrole('designflow_prod_backend_runtime') IS NOT NULL THEN
    IF has_table_privilege('designflow_prod_backend_runtime','core.factory_approval_form','UPDATE')
       OR has_column_privilege('designflow_prod_backend_runtime','core.factory_approval_form','ocr_status','INSERT')
       OR has_table_privilege('designflow_prod_backend_runtime','core.factory_approval','DELETE')
       OR has_table_privilege('designflow_prod_backend_runtime','app.notification','INSERT')
       OR has_table_privilege('designflow_prod_backend_runtime','app.notification','DELETE')
       OR has_column_privilege('designflow_prod_backend_runtime','app.notification','body','UPDATE') IS TRUE THEN
      RAISE EXCEPTION '#7114: backend runtime still has write access beyond the approvals screen';
    END IF;
    IF NOT has_table_privilege('designflow_prod_backend_runtime','core.factory_source_ref','SELECT')
       OR NOT has_table_privilege('designflow_prod_backend_runtime','core.factory_approval','UPDATE')
       OR NOT has_column_privilege('designflow_prod_backend_runtime','core.factory_approval_form','storage_path','INSERT')
       OR NOT has_table_privilege('designflow_prod_backend_runtime','app.profile','SELECT')
       OR NOT has_table_privilege('designflow_prod_backend_runtime','app.notification','SELECT')
       OR NOT has_column_privilege('designflow_prod_backend_runtime','app.notification','read_at','UPDATE') THEN
      RAISE EXCEPTION '#7114: backend runtime approval access missing';
    END IF;
  END IF;
END
$g$;
COMMIT;
