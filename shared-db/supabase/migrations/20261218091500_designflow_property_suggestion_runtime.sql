-- Issue #6693: service-only DesignFlow SKU property suggestions.
-- derived-from: 20261201210000
-- The shared PLM lookup retains its body, ACLs, and row-security behavior.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $install$
DECLARE
  service_schema text;
  facade oid;
  backend_role oid := pg_catalog.to_regrole('designflow_prod_backend_runtime');
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc
    WHERE oid = pg_catalog.to_regprocedure('plm.suggested_property_for_sku(text)')
      AND proowner = 'postgres'::regrole
      AND NOT prosecdef
      AND provolatile = 's'
      AND pg_catalog.md5(prosrc) = '5a545f4b0e46a3b0b596000216d92163'
  ) THEN
    RAISE EXCEPTION 'Need postgres and the reviewed component-scoped property suggestion';
  END IF;

  IF pg_catalog.to_regnamespace('dflow_prod') IS NULL
     AND pg_catalog.to_regnamespace('dflow') IS NULL THEN
    RAISE EXCEPTION 'An existing private DesignFlow service schema is required';
  END IF;

  -- Production installs into dflow_prod, the sandbox into dflow. The shared
  -- preview contains both schemas and rehearses both service entry points.
  IF pg_catalog.to_regnamespace('dflow_prod') IS NOT NULL THEN
    IF backend_role IS NULL THEN
      RAISE EXCEPTION 'The production Core login is required for the production facade';
    END IF;

    CREATE FUNCTION dflow_prod.suggested_property_for_sku(p_sku text)
    RETURNS TABLE (mg_code text, mg_desc text, file_count bigint, basis text, file_names text[])
    LANGUAGE sql STABLE STRICT SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $lookup$
      SELECT suggestion.mg_code, suggestion.mg_desc, suggestion.file_count,
             suggestion.basis, suggestion.file_names
      FROM plm.suggested_property_for_sku(p_sku) AS suggestion
      ORDER BY suggestion.file_count DESC, suggestion.mg_code;
    $lookup$;

    REVOKE ALL ON FUNCTION dflow_prod.suggested_property_for_sku(text)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION dflow_prod.suggested_property_for_sku(text)
      TO designflow_prod_backend_runtime;
  END IF;

  IF pg_catalog.to_regnamespace('dflow') IS NOT NULL THEN
    CREATE FUNCTION dflow.suggested_property_for_sku(p_sku text)
    RETURNS TABLE (mg_code text, mg_desc text, file_count bigint, basis text, file_names text[])
    LANGUAGE sql STABLE STRICT SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $lookup$
      SELECT suggestion.mg_code, suggestion.mg_desc, suggestion.file_count,
             suggestion.basis, suggestion.file_names
      FROM plm.suggested_property_for_sku(p_sku) AS suggestion
      ORDER BY suggestion.file_count DESC, suggestion.mg_code;
    $lookup$;

    REVOKE ALL ON FUNCTION dflow.suggested_property_for_sku(text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;

  FOREACH service_schema IN ARRAY ARRAY['dflow_prod', 'dflow'] LOOP
    IF pg_catalog.to_regnamespace(service_schema) IS NULL THEN
      CONTINUE;
    END IF;
    facade := pg_catalog.to_regprocedure(service_schema || '.suggested_property_for_sku(text)');
    IF EXISTS (
      SELECT
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
      WHERE p.oid = facade
        AND acl.grantee <> 'postgres'::regrole
        AND NOT (service_schema = 'dflow_prod' AND acl.grantee = backend_role AND acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable)
    ) THEN
      RAISE EXCEPTION 'Unexpected direct access to the % property suggestion function', service_schema;
    END IF;
    IF service_schema = 'dflow_prod' AND NOT (
      pg_catalog.has_schema_privilege(backend_role, 'dflow_prod', 'USAGE')
      AND pg_catalog.has_function_privilege(backend_role, facade, 'EXECUTE')
      AND NOT pg_catalog.has_schema_privilege(backend_role, 'plm', 'USAGE,CREATE')
    ) THEN
      RAISE EXCEPTION 'DesignFlow production lookup must preserve private PLM schema custody';
    END IF;
  END LOOP;
END
$install$;

COMMIT;
