SELECT n.nspname AS schema_name, c.relname AS table_name,
       a.attname AS column_name, t.typname AS data_type,
       tn.nspname AS type_schema, NOT a.attnotnull AS nullable,
       a.atthasdef AS has_default
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
WHERE n.nspname = 'dflow_prod'
  AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
  AND ((c.relname = 'comments' AND a.attname = 'app_comment_id')
    OR (c.relname = 'users' AND a.attname = 'app_profile_id'))
ORDER BY c.relname, a.attname
LIMIT 3;
