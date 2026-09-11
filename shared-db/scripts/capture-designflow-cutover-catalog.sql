\set ON_ERROR_STOP on
-- Internal operational evidence only: index and constraint definitions are not for public issue comments.
\if :{?schema_name}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'schema_name is required'; END $guard$;
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '2min';

SELECT jsonb_build_object(
  'captured_at', clock_timestamp(),
  'database', current_database(),
  'user', current_user,
  'server_address', inet_server_addr(),
  'server_version', current_setting('server_version'),
  'transaction_read_only', current_setting('transaction_read_only'),
  'schema', :'schema_name'
) AS target_proof;

SELECT jsonb_build_object(
  'base_tables', count(*) FILTER (WHERE c.relkind IN ('r','p')),
  'views', count(*) FILTER (WHERE c.relkind IN ('v','m')),
  'columns', (SELECT count(*) FROM information_schema.columns WHERE table_schema = :'schema_name'),
  'indexes', (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname = :'schema_name'),
  'constraints', (SELECT count(*) FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class rc ON rc.oid = con.conrelid JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace WHERE rn.nspname = :'schema_name'),
  'sequences', (SELECT count(*) FROM information_schema.sequences WHERE sequence_schema = :'schema_name'),
  'heap_bytes', coalesce(sum(pg_catalog.pg_relation_size(c.oid)) FILTER (WHERE c.relkind IN ('r','p')), 0),
  'index_bytes', coalesce(sum(pg_catalog.pg_indexes_size(c.oid)) FILTER (WHERE c.relkind IN ('r','p')), 0),
  'total_bytes', coalesce(sum(pg_catalog.pg_total_relation_size(c.oid)) FILTER (WHERE c.relkind IN ('r','p')), 0),
  'estimated_rows', coalesce(sum(greatest(c.reltuples, 0)) FILTER (WHERE c.relkind IN ('r','p')), 0)::bigint
) AS schema_summary
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'schema_name';

SELECT jsonb_agg(to_jsonb(t) ORDER BY t.total_bytes DESC, t.table_name) AS table_inventory
FROM (
  SELECT
    c.relname AS table_name,
    c.reltuples::bigint AS estimated_rows,
    pg_catalog.pg_relation_size(c.oid) AS heap_bytes,
    pg_catalog.pg_indexes_size(c.oid) AS index_bytes,
    pg_catalog.pg_total_relation_size(c.oid) AS total_bytes
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = :'schema_name' AND c.relkind IN ('r','p')
) t;

SELECT jsonb_agg(to_jsonb(i) ORDER BY i.table_name, i.index_name) AS index_inventory
FROM (
  SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
  FROM pg_catalog.pg_indexes
  WHERE schemaname = :'schema_name'
) i;

SELECT jsonb_agg(to_jsonb(k) ORDER BY k.table_name, k.constraint_name) AS constraint_inventory
FROM (
  SELECT
    c.relname AS table_name,
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    con.convalidated AS validated,
    pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = :'schema_name'
) k;

SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sequence_name) AS sequence_inventory
FROM (
  SELECT sequencename AS sequence_name, data_type, start_value, min_value, max_value,
         increment_by, cycle, cache_size, last_value
  FROM pg_catalog.pg_sequences
  WHERE schemaname = :'schema_name'
) s;

COMMIT;
