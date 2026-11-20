-- #5825: designflow_prod_backend_runtime keeps only its own grant role.
-- derived-from: none
-- Item master, data sync (2026-11-20) and tracking (2026-11-06) now log in as
-- their own runtimes, so the backend login no longer needs their grant roles.
-- Read-only audit of designflow-backend main 767a85d found two privileges it
-- used only through those roles; they move to designflow_prod_backend_grants:
--   itemDetail column SELECT (HTS prepack lookup, helpers/hts-classification/prepack.js:43)
--   email_logs SELECT (INSERT ... RETURNING, services/email.service.js:11)
-- core USAGE is lost too, but backend already lacks SELECT on the core tables
-- it names, so no working path changes. Recoverable: re-GRANT the memberships.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $pre$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION '#5825: require postgres'; END IF;
  IF to_regrole('designflow_prod_backend_runtime') IS NULL OR to_regrole('designflow_prod_backend_grants') IS NULL THEN
    RAISE EXCEPTION '#5825: backend roles missing';
  END IF;
END
$pre$;

GRANT SELECT (item_pk, item_num_id, compan_code_fk, div_code_fk, prepack_code_fk)
  ON TABLE dflow_prod."itemDetail" TO designflow_prod_backend_grants;
GRANT SELECT ON TABLE dflow_prod.email_logs TO designflow_prod_backend_grants;

REVOKE designflow_prod_tracking_grants FROM designflow_prod_backend_runtime;
REVOKE designflow_prod_item_master_grants FROM designflow_prod_backend_runtime;
REVOKE designflow_prod_data_sync_grants FROM designflow_prod_backend_runtime;

DO $post$
BEGIN
  IF (SELECT array_agg(g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid
      WHERE m.member='designflow_prod_backend_runtime'::regrole) IS DISTINCT FROM ARRAY['designflow_prod_backend_grants'] THEN
    RAISE EXCEPTION '#5825: backend runtime memberships not exact';
  END IF;
  IF NOT has_column_privilege('designflow_prod_backend_runtime','dflow_prod."itemDetail"','prepack_code_fk','SELECT')
     OR NOT has_table_privilege('designflow_prod_backend_runtime','dflow_prod.email_logs','SELECT') THEN
    RAISE EXCEPTION '#5825: backend replacement grants missing';
  END IF;
END
$post$;
COMMIT;
