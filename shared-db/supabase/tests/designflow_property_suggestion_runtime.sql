BEGIN;

DO $test$
DECLARE
  backend CONSTANT name := 'designflow_prod_backend_runtime';
  original CONSTANT regprocedure := 'plm.suggested_property_for_sku(text)'::regprocedure;
  service_schema text;
  facade oid;
  actor name;
  source regclass;
BEGIN
  ASSERT (SELECT NOT prosecdef AND md5(prosrc) = '5a545f4b0e46a3b0b596000216d92163'
          FROM pg_proc WHERE oid = original),
    'the legacy component-scoped lookup must retain its invoker query';
  ASSERT NOT has_function_privilege('anon', original, 'EXECUTE')
     AND has_function_privilege('authenticated', original, 'EXECUTE')
     AND has_function_privilege('service_role', original, 'EXECUTE'),
    'the legacy lookup must retain its authorized callers';

  FOREACH service_schema IN ARRAY ARRAY['dflow_prod', 'dflow'] LOOP
    IF to_regnamespace(service_schema) IS NULL THEN
      CONTINUE;
    END IF;
    facade := to_regprocedure(service_schema || '.suggested_property_for_sku(text)');
    ASSERT EXISTS (
      SELECT FROM pg_proc
      WHERE oid = facade AND prosecdef AND proisstrict AND provolatile = 's'
        AND proowner = 'postgres'::regrole AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']
    ), 'the facade must have a fixed search path and existing source owner';
    FOREACH actor IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role']::name[] LOOP
      ASSERT NOT has_function_privilege(actor, facade, 'EXECUTE'),
        'API roles must not reach the direct service facade';
    END LOOP;
  END LOOP;

  IF to_regnamespace('dflow_prod') IS NOT NULL THEN
    ASSERT has_function_privilege(backend, 'dflow_prod.suggested_property_for_sku(text)', 'EXECUTE')
       AND NOT has_function_privilege(backend, original, 'EXECUTE')
       AND NOT has_schema_privilege(backend, 'plm', 'CREATE'), -- USAGE: #4707 copy reads
      'the production runtime may call the facade within its own schema';
    FOREACH source IN ARRAY ARRAY[
      'plm.coldlion_item_merch_group', 'plm.dcp_asset', 'plm.dcp_asset_property_observation',
      'plm.dcp_property', 'plm.dcp_property_mg06_crosswalk',
      'public.sku_files_used', 'public.style_guide_files'
    ]::regclass[] LOOP
      ASSERT NOT has_any_column_privilege(backend, source, 'SELECT, INSERT, UPDATE')
         AND NOT has_table_privilege(backend, source, 'DELETE, TRUNCATE, TRIGGER'),
        'production runtime must not gain source access on ' || source;
    END LOOP;
  END IF;
END
$test$;

ROLLBACK;
