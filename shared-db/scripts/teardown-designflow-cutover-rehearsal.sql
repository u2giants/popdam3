\set ON_ERROR_STOP on
\if :{?scratch_schema}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'scratch_schema is required'; END $guard$;
\endif
\if :{?expected_project_ref}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_project_ref is required'; END $guard$;
\endif
\if :{?production_project_ref}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'production_project_ref is required'; END $guard$;
\endif

BEGIN;
SET statement_timeout = '5min';
SET lock_timeout = '5s';
SET idle_in_transaction_session_timeout = '1min';
SELECT set_config('issue771.expected_project_ref', :'expected_project_ref', false);
SELECT set_config('issue771.production_project_ref', :'production_project_ref', false);
SELECT set_config('issue771.connection_user', :'USER', false);
SELECT set_config('issue771.scratch_schema', :'scratch_schema', false);

DO $guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR current_setting('issue771.expected_project_ref') = current_setting('issue771.production_project_ref')
     OR current_setting('issue771.connection_user') <> ('postgres.' || current_setting('issue771.expected_project_ref'))
     OR current_setting('issue771.scratch_schema') !~ '^zz_rehearsal_cutover_[0-9]{8}_[0-9]{6}$' THEN
    RAISE EXCEPTION 'target or scratch schema is not the exact expected rehearsal target';
  END IF;
END
$guard$;

DROP SCHEMA :"scratch_schema" CASCADE;

SELECT jsonb_build_object(
  'database', current_database(),
  'user', current_user,
  'connection_user', :'USER',
  'expected_project_ref', :'expected_project_ref',
  'scratch_schema', :'scratch_schema',
  'scratch_schema_exists', to_regnamespace(:'scratch_schema') IS NOT NULL
) AS teardown_proof;
COMMIT;
