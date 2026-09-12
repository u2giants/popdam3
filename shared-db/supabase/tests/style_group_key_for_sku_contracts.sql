-- Synthetic-only differential parity; all fixtures roll back.
BEGIN;
DO $test$
DECLARE
  row record; old_key text; new_key text; tested integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid='public.style_group_key_for_sku(text)'::regprocedure
      AND l.lanname='sql' AND p.provolatile='i' AND p.proisstrict
      AND p.proparallel='s' AND NOT p.prosecdef
  ) THEN RAISE EXCEPTION 'SKU helper must remain immutable strict parallel-safe invoker SQL'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid='public.style_group_key_for_sku(text)'::regprocedure AND a.grantee=0
  ) THEN RAISE EXCEPTION 'SKU helper exposed to PUBLIC'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role')
    AND NOT pg_catalog.has_function_privilege('service_role','public.style_group_key_for_sku(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Service-role helper execution missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')
    AND pg_catalog.has_function_privilege('anon','public.style_group_key_for_sku(text)','EXECUTE') THEN
    RAISE EXCEPTION 'SKU helper exposed to anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
    AND pg_catalog.has_function_privilege('authenticated','public.style_group_key_for_sku(text)','EXECUTE') THEN
    RAISE EXCEPTION 'SKU helper exposed to authenticated'; END IF;
  FOR row IN SELECT * FROM (VALUES
    (NULL::text,NULL::text), ('',NULL), ('ABC1234',NULL),
    ('folder/ABC1234/image.png','ABC1234'), ('ABC1234/','ABC1234'),
    ('/ABC1234/image.png','ABC1234'), ('a/ABC1234//image.png','ABC1234'),
    ('ABC1234/XYZ9876/image.png','ABC1234'), ('folder/ABC1234',NULL),
    ('folder/AB1234/image.png',NULL), ('folder/1234567/image.png',NULL),
    ('folder/ABCDEFG/image.png',NULL), ('folder/ABC-1234/image.png',NULL),
    ('folder/ABC_1234/image.png',NULL), ('folder/ ABC1234/image.png',NULL),
    ('folder/ABC1234 /image.png',NULL), ('folder/abc1234/image.png','abc1234'),
    (U&'folder/\00C9BC1234/image.png',NULL),
    (U&'folder/ABC123\FF14/image.png',NULL),
    ('root/ABC1234/ABC1234','ABC1234')
  ) AS fixture(path,expected) LOOP
    new_key:=public.style_group_key_for_sku(row.path);
    IF new_key IS DISTINCT FROM row.expected THEN
      RAISE EXCEPTION 'Explicit SKU behavior failed for synthetic path %',row.path;
    END IF;
    tested:=tested+1;
  END LOOP;
  -- Oracle: the original consumer expression, before extraction.
  FOR row IN
    SELECT concat_ws('/',prefix,candidate,suffix) AS path
    FROM unnest(ARRAY['','plain','ABC1234','1234567']) prefix
    CROSS JOIN unnest(ARRAY['A12345','A123456','ABCDEFG','1234567','ABC1234',
      'abc1234','ABC_1234','ABC-1234','ABC1234 ','']) candidate
    CROSS JOIN unnest(ARRAY['','file.png','XYZ9876/file.png','ABC1234','/file.png']) suffix
  LOOP
    SELECT seg INTO old_key
    FROM unnest(string_to_array(row.path,'/')) WITH ORDINALITY AS t(seg,ord)
    WHERE seg ~ '^[A-Za-z0-9]+$' AND seg ~ '[A-Za-z]' AND seg ~ '[0-9]'
      AND length(seg) >= 7
      AND ord < array_length(string_to_array(row.path,'/'),1)
    ORDER BY ord LIMIT 1;
    new_key:=public.style_group_key_for_sku(row.path);
    IF new_key IS DISTINCT FROM old_key THEN
      RAISE EXCEPTION 'Old/new SKU derivation differs for synthetic path %',row.path;
    END IF;
    tested:=tested+1;
  END LOOP;
  RAISE NOTICE 'SKU parity: % synthetic cases passed',tested;
END $test$;
ROLLBACK;
