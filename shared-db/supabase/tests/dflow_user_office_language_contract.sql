-- Contract test for dflow.users.office_location / preferred_language
-- (issue #690, migration 20260810160000).
--
-- Run on preview inside a transaction. Proves: nullable-by-default, the exact
-- accepted value sets (lowercase offices, BCP-47 languages), that invalid /
-- whitespace-padded / empty values are REJECTED, that no backfill happened,
-- and that the application resolution rule
--   coalesce(preferred_language, case when office_location = 'ningbo'
--                                     then 'zh-CN' else 'en' end)
-- yields the three documented outcomes.
--
-- A case that is expected to RAISE but does not is a FAILING test.
BEGIN;

DO $$
DECLARE
  v_backfilled bigint;
  v_unset integer;
  v_row record;
  v_office text;
  v_lang text;
  v_resolved text;
  v_ids integer[] := '{}';
BEGIN
  -- (f) No backfill: this must be checked BEFORE the test rows are written.
  SELECT count(*) INTO v_backfilled
  FROM dflow.users
  WHERE office_location IS NOT NULL OR preferred_language IS NOT NULL;
  IF v_backfilled <> 0 THEN
    RAISE EXCEPTION 'backfill detected: % dflow.users rows already carry office_location or preferred_language (expected 0)', v_backfilled;
  END IF;

  -- (a) Insert leaving both unset succeeds; both read NULL.
  INSERT INTO dflow.users(name, email)
  VALUES ('office-language-contract-unset', 'office-language-contract-unset@example.invalid')
  RETURNING id INTO v_unset;

  SELECT office_location, preferred_language INTO v_office, v_lang
  FROM dflow.users WHERE id = v_unset;
  IF v_office IS NOT NULL OR v_lang IS NOT NULL THEN
    RAISE EXCEPTION 'new row did not default to NULL/NULL: office_location %, preferred_language %', v_office, v_lang;
  END IF;

  -- (b) Every valid value is accepted, on both columns.
  FOREACH v_office IN ARRAY ARRAY['ningbo', 'nyc'] LOOP
    UPDATE dflow.users SET office_location = v_office WHERE id = v_unset;
    IF (SELECT office_location FROM dflow.users WHERE id = v_unset) <> v_office THEN
      RAISE EXCEPTION 'valid office_location % was not stored', v_office;
    END IF;
  END LOOP;

  FOREACH v_lang IN ARRAY ARRAY['en', 'zh-CN'] LOOP
    UPDATE dflow.users SET preferred_language = v_lang WHERE id = v_unset;
    IF (SELECT preferred_language FROM dflow.users WHERE id = v_unset) <> v_lang THEN
      RAISE EXCEPTION 'valid preferred_language % was not stored', v_lang;
    END IF;
  END LOOP;

  -- (c) Setting either column back to NULL succeeds.
  UPDATE dflow.users SET office_location = NULL, preferred_language = NULL WHERE id = v_unset;
  SELECT office_location, preferred_language INTO v_office, v_lang
  FROM dflow.users WHERE id = v_unset;
  IF v_office IS NOT NULL OR v_lang IS NOT NULL THEN
    RAISE EXCEPTION 'clearing back to NULL failed: office_location %, preferred_language %', v_office, v_lang;
  END IF;

  -- (d) Invalid office values must raise check_violation.
  --     'Shanghai'  -> not an office we run
  --     'ningbo '   -> trailing space; text is not trimmed
  --     ''          -> empty string is not NULL
  --     'Ningbo'    -> wrong casing; storage is lowercase-only
  FOREACH v_office IN ARRAY ARRAY['Shanghai', 'ningbo ', '', 'Ningbo'] LOOP
    BEGIN
      UPDATE dflow.users SET office_location = v_office WHERE id = v_unset;
      RAISE EXCEPTION 'invalid office_location % was ACCEPTED', quote_literal(v_office);
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  -- (e) Invalid language values must raise check_violation.
  FOREACH v_lang IN ARRAY ARRAY['zh', 'ZH-CN', 'fr', 'en ', ''] LOOP
    BEGIN
      UPDATE dflow.users SET preferred_language = v_lang WHERE id = v_unset;
      RAISE EXCEPTION 'invalid preferred_language % was ACCEPTED', quote_literal(v_lang);
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  -- The failed updates above must have left the row untouched.
  SELECT office_location, preferred_language INTO v_office, v_lang
  FROM dflow.users WHERE id = v_unset;
  IF v_office IS NOT NULL OR v_lang IS NOT NULL THEN
    RAISE EXCEPTION 'rejected values leaked into the row: office_location %, preferred_language %', v_office, v_lang;
  END IF;

  -- (g) The application resolution rule holds for the three documented cases.
  --   1. saved preferred_language wins
  --   2. else office_location = 'ningbo' -> 'zh-CN'
  --   3. else 'en'
  INSERT INTO dflow.users(name, email, office_location, preferred_language)
  VALUES
    ('office-language-contract-override', 'office-language-contract-override@example.invalid', 'nyc', 'zh-CN'),
    ('office-language-contract-ningbo',   'office-language-contract-ningbo@example.invalid',   'ningbo', NULL),
    ('office-language-contract-default',  'office-language-contract-default@example.invalid',  NULL, NULL);

  SELECT array_agg(id ORDER BY id) INTO v_ids
  FROM dflow.users
  WHERE email IN (
    'office-language-contract-override@example.invalid',
    'office-language-contract-ningbo@example.invalid',
    'office-language-contract-default@example.invalid'
  );
  IF array_length(v_ids, 1) <> 3 THEN
    RAISE EXCEPTION 'resolution-rule fixture did not insert 3 rows (found %)', coalesce(array_length(v_ids, 1), 0);
  END IF;

  FOR v_row IN
    SELECT email,
           coalesce(preferred_language,
                    CASE WHEN office_location = 'ningbo' THEN 'zh-CN' ELSE 'en' END) AS resolved
    FROM dflow.users
    WHERE id = ANY(v_ids)
  LOOP
    v_resolved := CASE v_row.email
      WHEN 'office-language-contract-override@example.invalid' THEN 'zh-CN'
      WHEN 'office-language-contract-ningbo@example.invalid'   THEN 'zh-CN'
      WHEN 'office-language-contract-default@example.invalid'  THEN 'en'
    END;
    IF v_row.resolved IS DISTINCT FROM v_resolved THEN
      RAISE EXCEPTION 'resolution rule failed for %: got %, expected %', v_row.email, v_row.resolved, v_resolved;
    END IF;
  END LOOP;

  RAISE NOTICE 'dflow.users office_location / preferred_language contract PASSED';
END
$$;

ROLLBACK;
