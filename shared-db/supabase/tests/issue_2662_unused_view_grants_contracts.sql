-- Role-switched checks use only EXISTS, never emit business or licensed rows.
BEGIN;
DO $contract$
DECLARE
  v_view text;
  v_role text;
  v_denied boolean;
  v_exists boolean;
BEGIN
  FOREACH v_view IN ARRAY ARRAY[
    'api.crm_factory_picker_list',
    'api.opa_disney_property',
    'api.opa_lucasfilm_property',
    'api.opa_marvel_property',
    'api.pm_factory_list',
    'api.source_capture_inventory'
  ] LOOP
    IF to_regclass(v_view) IS NULL
       OR has_table_privilege('authenticated', v_view, 'SELECT')
       OR NOT has_table_privilege('service_role', v_view, 'SELECT') THEN
      RAISE EXCEPTION 'six-view grant contract failed for %', v_view;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['viewer','vendor','designer','administrator','sales','licensing',''] LOOP
      PERFORM set_config('request.jwt.claims',
        jsonb_build_object('app_metadata', jsonb_build_object('roles',
          CASE WHEN v_role = '' THEN '[]'::jsonb ELSE jsonb_build_array(v_role) END))::text, true);
      v_denied := false;
      BEGIN
        EXECUTE 'SET LOCAL ROLE authenticated';
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s LIMIT 1)', v_view) INTO v_exists;
        EXECUTE 'RESET ROLE';
      EXCEPTION WHEN insufficient_privilege THEN
        EXECUTE 'RESET ROLE';
        v_denied := true;
      END;
      IF NOT v_denied THEN RAISE EXCEPTION 'authenticated read succeeded for %', v_view; END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '{"app_metadata":{"roles":["administrator"]}}', true);
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s LIMIT 1)', v_view) INTO v_exists;
    EXECUTE 'RESET ROLE';
  END LOOP;
  -- Unchanged browser-facing sibling controls: do not tighten unrelated grants.
  FOREACH v_view IN ARRAY ARRAY['api.crm_customer_picker_list','api.pm_customer_list','api.dam_customer_list','api.dam_factory_list'] LOOP
    IF NOT has_table_privilege('authenticated', v_view, 'SELECT') THEN
      RAISE EXCEPTION 'unrelated browser grant changed: %', v_view;
    END IF;
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s LIMIT 1)', v_view) INTO v_exists;
    EXECUTE 'RESET ROLE';
  END LOOP;
END
$contract$;
ROLLBACK;
SELECT 'ISSUE_2662_UNUSED_VIEW_GRANTS_OK' AS result;
