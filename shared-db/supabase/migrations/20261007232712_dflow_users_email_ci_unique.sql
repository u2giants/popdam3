-- #4060 (follow-up to popcre/designflow-backend#140): case-insensitive unique
-- email for DesignFlow staff users. App code (designflow-backend#155) rejects a
-- duplicate signup, but only the database can guarantee it under concurrency.
-- Claim #4062. Adds one index on dflow.users; no row, column or privilege change.
-- Read-only check 2026-10-07: 0 case-insensitive duplicate groups in production
-- and in the DesignFlow sandbox; the guard below refuses if that has changed.
-- Key matches the in-tree identity resolvers: lower(btrim(email)); blanks are absent.
-- Rollback: DROP INDEX IF EXISTS dflow.users_email_lower_uidx;
-- derived-from: none
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE dflow.users IN SHARE MODE;
DO $guard$
DECLARE
  dup_groups bigint;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT lower(btrim(email)) FROM dflow.users
    WHERE nullif(btrim(email), '') IS NOT NULL
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'dflow.users has % case-insensitive duplicate email group(s); resolve them in the application before adding the unique index (#4060)', dup_groups;
  END IF;
END
$guard$;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx
  ON dflow.users (lower(btrim(email)))
  WHERE nullif(btrim(email), '') IS NOT NULL;
COMMENT ON INDEX dflow.users_email_lower_uidx IS
  'Case-insensitive unique staff email (#4060, designflow-backend#140).';
COMMIT;
