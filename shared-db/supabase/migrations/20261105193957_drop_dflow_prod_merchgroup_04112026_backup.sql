-- Claim #5748. Drop the old backup copy dflow_prod."merchGroup_04112026".
-- Albert authorized on 2026-11-05: "merchGroup_04112026 can be deleted now".
-- Read-only check on production 2026-11-05: no dependent views, foreign keys,
-- functions or application code; no migration creates it.
-- Backup: 1Password vault vibe_coding document ufsr7gf6knsdpa3t2uszn7kvza
--   (3,883 rows, gzip JSON, sha256 ab65537a5d3086a43fffdf7941e7b34a19dc7bfcb0bf442a452e456a79de563e).
-- derived-from: none
-- Absent table (e.g. preview) is a clean no-op. RESTRICT refuses if a dependent appeared.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $drop_backup$
DECLARE
  inbound int;
BEGIN
  IF to_regclass('dflow_prod."merchGroup_04112026"') IS NULL THEN
    RAISE NOTICE '5748: dflow_prod."merchGroup_04112026" already absent; nothing to do';
    RETURN;
  END IF;

  SELECT count(*) INTO inbound
  FROM pg_constraint
  WHERE contype = 'f'
    AND confrelid = 'dflow_prod."merchGroup_04112026"'::regclass;
  IF inbound > 0 THEN
    RAISE EXCEPTION '5748: % foreign keys still reference the backup table', inbound;
  END IF;

  DROP TABLE dflow_prod."merchGroup_04112026" RESTRICT;
END
$drop_backup$;

COMMIT;
