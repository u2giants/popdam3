-- #3890 forward reissue: original20261006203846 remains immutable and retired for production.
-- Same executable transition; original Sandbox result is preserved. Current targets validate and no-op.
-- #3890 / #3882: preserve the legacy DesignFlow table while correcting its sandbox schema.
-- Shared preview and production already have this table in dflow and are unchanged.
-- Reversal on sandbox, before reverting the application map: SET SCHEMA core.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $move$
DECLARE
  source_oid oid := to_regclass('core.properties_and_characters');
  target_oid oid := to_regclass('dflow.properties_and_characters');
  legacy_oid oid;
  matched_columns integer;
BEGIN
  IF source_oid IS NOT NULL AND target_oid IS NOT NULL THEN
    RAISE EXCEPTION 'Both legacy source and destination exist; refuse to merge or overwrite either table';
  END IF;
  legacy_oid := coalesce(source_oid, target_oid);
  IF legacy_oid IS NULL THEN
    RAISE EXCEPTION 'Neither expected legacy table exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = legacy_oid AND relkind = 'r') THEN
    RAISE EXCEPTION 'Legacy relation is not an ordinary table';
  END IF;
  SELECT count(*) INTO matched_columns
  FROM (VALUES
    ('id', 'integer', true), ('name', 'character varying(255)', true),
    ('type', 'character varying(50)', true), ('licensor_id', 'integer', true),
    ('source_licensed_property_id', 'character varying(100)', false),
    ('source_character_id', 'character varying(100)', false),
    ('created_at', 'timestamp with time zone', true),
    ('updated_at', 'timestamp with time zone', true)
  ) expected(name, type_name, required)
  JOIN pg_attribute a ON a.attrelid = legacy_oid AND a.attnum > 0
    AND NOT a.attisdropped AND a.attname = expected.name
    AND format_type(a.atttypid, a.atttypmod) = expected.type_name
    AND a.attnotnull = expected.required;
  IF matched_columns <> 8 OR
    (SELECT count(*) FROM pg_attribute WHERE attrelid = legacy_oid
      AND attnum > 0 AND NOT attisdropped) <> 8 THEN
    RAISE EXCEPTION 'Legacy source does not have the expected eight-column DesignFlow shape';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a
    ON a.attrelid = c.conrelid AND a.attname = 'id'
    WHERE c.conrelid = legacy_oid AND c.contype = 'p'
      AND c.convalidated AND c.conkey = ARRAY[a.attnum]) THEN
    RAISE EXCEPTION 'Legacy relation does not have the expected id primary key';
  END IF;
  IF source_oid IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE core.properties_and_characters SET SCHEMA dflow;
  IF to_regclass('dflow.properties_and_characters')::oid IS DISTINCT FROM source_oid THEN
    RAISE EXCEPTION 'Schema move did not preserve the original table identity';
  END IF;
END
$move$;
COMMIT;
