-- #7070: the live DesignFlow backend (designflow_prod_backend_runtime) serves
-- the factory approvals screen. It checks the user's permissions itself, so
-- its grant role gets plain table access plus row policies (the pattern of
-- coldlion.merch_group_event_log). Upload-side triggers are security definer,
-- so no function EXECUTE is needed. Notifications are limited to app 'plm'.
-- Recoverable: REVOKE the grants and DROP the four *_dflow_prod_backend policies.
-- derived-from: none
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $pre$
BEGIN
  IF to_regrole('designflow_prod_backend_grants') IS NULL THEN
    RAISE NOTICE '#7070: designflow_prod_backend_grants absent; nothing to grant';
  END IF;
END
$pre$;

DO $g$
BEGIN
  IF to_regrole('designflow_prod_backend_grants') IS NULL THEN RETURN; END IF;
  GRANT USAGE ON SCHEMA core, app TO designflow_prod_backend_grants;
  GRANT SELECT ON core.factory_source_ref TO designflow_prod_backend_grants;
  GRANT SELECT, INSERT, UPDATE ON core.factory_approval, core.factory_approval_form TO designflow_prod_backend_grants;
  GRANT SELECT ON app.profile TO designflow_prod_backend_grants;
  GRANT SELECT, UPDATE (read_at) ON app.notification TO designflow_prod_backend_grants;

  DROP POLICY IF EXISTS factory_source_ref_dflow_prod_backend ON core.factory_source_ref;
  CREATE POLICY factory_source_ref_dflow_prod_backend ON core.factory_source_ref
    FOR SELECT TO designflow_prod_backend_grants USING (true);
  DROP POLICY IF EXISTS factory_approval_dflow_prod_backend ON core.factory_approval;
  CREATE POLICY factory_approval_dflow_prod_backend ON core.factory_approval
    FOR ALL TO designflow_prod_backend_grants USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS factory_approval_form_dflow_prod_backend ON core.factory_approval_form;
  CREATE POLICY factory_approval_form_dflow_prod_backend ON core.factory_approval_form
    FOR ALL TO designflow_prod_backend_grants USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS profile_dflow_prod_backend ON app.profile;
  CREATE POLICY profile_dflow_prod_backend ON app.profile
    FOR SELECT TO designflow_prod_backend_grants USING (true);
  DROP POLICY IF EXISTS notification_dflow_prod_backend ON app.notification;
  CREATE POLICY notification_dflow_prod_backend ON app.notification
    FOR ALL TO designflow_prod_backend_grants USING (app = 'plm'::app.app_name) WITH CHECK (app = 'plm'::app.app_name);

  IF to_regrole('designflow_prod_backend_runtime') IS NOT NULL AND (
       NOT has_table_privilege('designflow_prod_backend_runtime','core.factory_approval','INSERT')
    OR NOT has_table_privilege('designflow_prod_backend_runtime','core.factory_approval_form','UPDATE')
    OR NOT has_table_privilege('designflow_prod_backend_runtime','app.profile','SELECT')
    OR NOT has_column_privilege('designflow_prod_backend_runtime','app.notification','read_at','UPDATE')) THEN
    RAISE EXCEPTION '#7070: backend runtime approval grants not effective';
  END IF;
END
$g$;
COMMIT;
