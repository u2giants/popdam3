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

-- Keep search_path, custom settings, and every scratch write on one backend even
-- through the transaction-mode pooler. ON_ERROR_STOP disconnects and rolls the
-- whole scratch schema back if any step fails.
BEGIN;
SET statement_timeout = '20min';
SET lock_timeout = '5s';
SET idle_in_transaction_session_timeout = '2min';
SELECT set_config('issue771.expected_project_ref', :'expected_project_ref', false);
SELECT set_config('issue771.production_project_ref', :'production_project_ref', false);
SELECT set_config('issue771.connection_user', :'USER', false);
SELECT set_config('issue771.scratch_schema', :'scratch_schema', false);

DO $guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR current_setting('issue771.expected_project_ref') = current_setting('issue771.production_project_ref')
     OR current_setting('issue771.connection_user') <> ('postgres.' || current_setting('issue771.expected_project_ref')) THEN
    RAISE EXCEPTION 'target is not the expected Supabase preview project';
  END IF;
END
$guard$;
DO $guard$
BEGIN
  IF current_setting('issue771.scratch_schema') !~ '^zz_rehearsal_cutover_[0-9]{8}_[0-9]{6}$' THEN
    RAISE EXCEPTION 'scratch_schema does not match the issue #771 rehearsal allowlist';
  END IF;
END
$guard$;
SELECT jsonb_build_object('database', current_database(), 'user', current_user,
  'connection_user', :'USER', 'server_address', inet_server_addr(), 'expected_project_ref', :'expected_project_ref') AS target_proof;

CREATE SCHEMA :"scratch_schema";
SET search_path = :"scratch_schema", dflow, public;
CREATE TABLE timings (
  phase text NOT NULL,
  object_name text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  elapsed_ms numeric NOT NULL,
  ok boolean NOT NULL,
  detail jsonb
);

CREATE OR REPLACE FUNCTION record_timing(
  p_phase text, p_object text, p_sql text, p_detail_sql text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  began timestamptz := clock_timestamp();
  details jsonb;
BEGIN
  EXECUTE p_sql;
  IF p_detail_sql IS NOT NULL THEN EXECUTE p_detail_sql INTO details; END IF;
  INSERT INTO timings
  VALUES (p_phase, p_object, began, clock_timestamp(),
          extract(epoch FROM clock_timestamp() - began) * 1000, true, details);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO timings
  VALUES (p_phase, p_object, began, clock_timestamp(),
          extract(epoch FROM clock_timestamp() - began) * 1000, false,
          jsonb_build_object('sqlstate', SQLSTATE, 'error', SQLERRM));
END
$fn$;

CREATE TABLE selected_tables(table_name text PRIMARY KEY);
INSERT INTO selected_tables VALUES
  ('AuditLog'), ('email_logs'), ('quote_auth_token'), ('user_notification'),
  ('itemHeader'), ('RFQItem'), ('itemDetail'), ('itemAttachment'),
  ('productUserAssignment'), ('users');

WITH RECURSIVE dependency_tables(table_name) AS (
  -- pg_class.relname uses the catalog's "C" collation on PostgreSQL 17 while
  -- the scratch text column inherits the database default. Recursive terms
  -- must agree exactly, so pin both sides instead of relying on deployment
  -- locale.
  SELECT table_name COLLATE "C" FROM selected_tables
  UNION
  SELECT parent.relname COLLATE "C"
  FROM dependency_tables d
  JOIN pg_class child ON child.relname = d.table_name
  JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace AND child_ns.nspname = 'dflow'
  JOIN pg_constraint fk ON fk.conrelid = child.oid AND fk.contype = 'f'
  JOIN pg_class parent ON parent.oid = fk.confrelid
  JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace AND parent_ns.nspname = 'dflow'
)
INSERT INTO selected_tables SELECT table_name FROM dependency_tables ON CONFLICT DO NOTHING;

DO $block$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM selected_tables ORDER BY table_name LOOP
    PERFORM record_timing(
      'create_heap', r.table_name,
      format('CREATE TABLE %I.%I AS TABLE dflow.%I WITH NO DATA', current_schema(), r.table_name, r.table_name));
    PERFORM record_timing(
      'heap_load', r.table_name,
      format('INSERT INTO %I.%I SELECT * FROM dflow.%I', current_schema(), r.table_name, r.table_name),
      format('SELECT jsonb_build_object(''rows'', count(*), ''bytes'', pg_total_relation_size(%L::regclass)) FROM %I.%I',
             format('%I.%I', current_schema(), r.table_name), current_schema(), r.table_name));
  END LOOP;
END
$block$;

DO $block$
DECLARE r record; ddl text;
BEGIN
  FOR r IN
    SELECT i.indexrelid, ci.relname AS index_name, ct.relname AS table_name,
           pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i
    JOIN pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_class ct ON ct.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = ct.relnamespace
    JOIN selected_tables s ON s.table_name = ct.relname
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
    WHERE n.nspname = 'dflow' AND con.oid IS NULL
    ORDER BY ct.relname, ci.relname
  LOOP
    ddl := replace(r.definition, format(' ON %I.', 'dflow'), format(' ON %I.', current_schema()));
    PERFORM record_timing('index_create', r.table_name || '.' || r.index_name, ddl);
  END LOOP;
END
$block$;

DO $block$
DECLARE r record; ddl text;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN selected_tables s ON s.table_name = c.relname
    WHERE n.nspname = 'dflow' AND con.contype IN ('p','u','c')
    ORDER BY c.relname, con.contype, con.conname
  LOOP
    ddl := format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', current_schema(), r.table_name, r.conname, r.definition);
    PERFORM record_timing('key_constraint', r.table_name || '.' || r.conname, ddl);
  END LOOP;
END
$block$;

DO $block$
DECLARE r record; add_ddl text; validate_ddl text;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN selected_tables s ON s.table_name = c.relname
    WHERE n.nspname = 'dflow' AND con.contype = 'f'
    ORDER BY c.relname, con.conname
  LOOP
    add_ddl := format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s NOT VALID', current_schema(), r.table_name, r.conname,
                      replace(r.definition, format('REFERENCES %I.', 'dflow'), format('REFERENCES %I.', current_schema())));
    validate_ddl := format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I', current_schema(), r.table_name, r.conname);
    PERFORM record_timing('foreign_key_add', r.table_name || '.' || r.conname, add_ddl);
    PERFORM record_timing('foreign_key_validate', r.table_name || '.' || r.conname, validate_ddl);
  END LOOP;
END
$block$;

DO $block$
DECLARE r record; q text; began timestamptz; result jsonb;
BEGIN
  FOR r IN SELECT table_name FROM selected_tables WHERE table_name <> 'AuditLog' ORDER BY table_name LOOP
    began := clock_timestamp();
    q := format($sql$
      WITH src AS (SELECT md5(row_to_json(x)::text) h FROM dflow.%I x),
           dst AS (SELECT md5(row_to_json(x)::text) h FROM %I.%I x)
      SELECT jsonb_build_object(
        'source_count', (SELECT count(*) FROM src), 'copy_count', (SELECT count(*) FROM dst),
        'source_hash', (SELECT md5(string_agg(h, '' ORDER BY h)) FROM src),
        'copy_hash', (SELECT md5(string_agg(h, '' ORDER BY h)) FROM dst))
    $sql$, r.table_name, current_schema(), r.table_name);
    EXECUTE q INTO result;
    INSERT INTO timings VALUES
      ('full_ordered_hash', r.table_name, began, clock_timestamp(),
       extract(epoch FROM clock_timestamp() - began) * 1000,
       result->>'source_count' IS NOT DISTINCT FROM result->>'copy_count'
         AND result->>'source_hash' IS NOT DISTINCT FROM result->>'copy_hash', result);
  END LOOP;
END
$block$;

SELECT record_timing(
  'auditlog_gate', 'AuditLog',
  'SELECT 1',
  format($sql$
    WITH src_tail AS (SELECT md5(row_to_json(x)::text) h FROM dflow."AuditLog" x ORDER BY id DESC LIMIT 10000),
         dst_tail AS (SELECT md5(row_to_json(x)::text) h FROM %I."AuditLog" x ORDER BY id DESC LIMIT 10000)
    SELECT jsonb_build_object(
      'source_count', (SELECT count(*) FROM dflow."AuditLog"),
      'copy_count', (SELECT count(*) FROM %I."AuditLog"),
      'source_min_id', (SELECT min(id) FROM dflow."AuditLog"),
      'source_max_id', (SELECT max(id) FROM dflow."AuditLog"),
      'copy_min_id', (SELECT min(id) FROM %I."AuditLog"),
      'copy_max_id', (SELECT max(id) FROM %I."AuditLog"),
      'source_tail_hash', (SELECT md5(string_agg(h, '' ORDER BY h)) FROM src_tail),
      'copy_tail_hash', (SELECT md5(string_agg(h, '' ORDER BY h)) FROM dst_tail))
  $sql$, :'scratch_schema', :'scratch_schema', :'scratch_schema', :'scratch_schema'));

UPDATE timings
SET ok = detail->>'source_count' IS NOT DISTINCT FROM detail->>'copy_count'
     AND detail->>'source_min_id' IS NOT DISTINCT FROM detail->>'copy_min_id'
     AND detail->>'source_max_id' IS NOT DISTINCT FROM detail->>'copy_max_id'
     AND detail->>'source_tail_hash' IS NOT DISTINCT FROM detail->>'copy_tail_hash'
WHERE phase = 'auditlog_gate'
  AND detail ? 'source_count'
  AND detail ? 'copy_count'
  AND detail ? 'source_tail_hash'
  AND detail ? 'copy_tail_hash';

DO $block$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM selected_tables ORDER BY table_name LOOP
    PERFORM record_timing('analyze', r.table_name, format('ANALYZE %I.%I', current_schema(), r.table_name));
  END LOOP;
END
$block$;

SELECT jsonb_build_object(
  'scratch_schema', :'scratch_schema',
  'scratch_bytes', sum(pg_total_relation_size(c.oid)),
  'database_bytes', pg_database_size(current_database()),
  'failed_steps', (SELECT count(*) FROM :"scratch_schema".timings WHERE NOT ok)
) AS storage_result
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'scratch_schema' AND c.relkind IN ('r','p');

SELECT row_to_json(t) FROM :"scratch_schema".timings t ORDER BY started_at, phase, object_name;
SELECT count(*) > 0 AS rehearsal_failed FROM :"scratch_schema".timings WHERE NOT ok \gset
COMMIT;
\if :rehearsal_failed
  DO $guard$ BEGIN RAISE EXCEPTION 'rehearsal completed with failed timing steps; inspect the preserved scratch evidence'; END $guard$;
\endif
