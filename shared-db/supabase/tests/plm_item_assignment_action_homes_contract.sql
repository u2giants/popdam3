-- #3498: catalogue contract for the final PLM homes. No application rows move.
DO $test$
DECLARE
  relation_name text;
  expected_count integer;
  actual_count integer;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['item_user_assignment', 'item_workflow_action'] LOOP
    expected_count := CASE relation_name WHEN 'item_user_assignment' THEN 9 ELSE 16 END;
    SELECT count(*) INTO actual_count FROM pg_catalog.pg_attribute
     WHERE attrelid = pg_catalog.to_regclass('plm.' || relation_name)
       AND attnum > 0 AND NOT attisdropped;
    IF actual_count <> expected_count THEN
      RAISE EXCEPTION 'plm.% has % columns, expected %', relation_name, actual_count, expected_count;
    END IF;

    -- Types, nullability, exact defaults and identity shape must match the
    -- corresponding DesignFlow source, regardless of physical column order.
    IF EXISTS (
      (SELECT a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef, a.attidentity,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid)
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = pg_catalog.to_regclass('plm.' || relation_name)
          AND a.attnum > 0 AND NOT a.attisdropped
       EXCEPT
       SELECT a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef, a.attidentity,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid)
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = pg_catalog.to_regclass('dflow.' || relation_name)
          AND a.attnum > 0 AND NOT a.attisdropped)
      UNION ALL
      (SELECT a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef, a.attidentity,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid)
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = pg_catalog.to_regclass('dflow.' || relation_name)
          AND a.attnum > 0 AND NOT a.attisdropped
       EXCEPT
       SELECT a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef, a.attidentity,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid)
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = pg_catalog.to_regclass('plm.' || relation_name)
          AND a.attnum > 0 AND NOT a.attisdropped)
    ) THEN RAISE EXCEPTION 'plm.% differs from source column shape', relation_name; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = pg_catalog.to_regclass('plm.' || relation_name)
        AND relkind = 'r' AND relrowsecurity
    ) THEN RAISE EXCEPTION 'plm.% is not an RLS table', relation_name; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'plm' AND tablename = relation_name
    ) THEN RAISE EXCEPTION 'plm.% has an unexpected policy', relation_name; END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r(role_name)
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege_name)
      WHERE pg_catalog.has_table_privilege(r.role_name, 'plm.' || relation_name, p.privilege_name)
    ) THEN RAISE EXCEPTION 'plm.% has a forbidden role privilege', relation_name; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM (VALUES (
      'item_user_assignment_rfq_item_id_fkey', 'plm.item_user_assignment'::regclass, 'plm."RFQItem"'::regclass, ARRAY['rfq_item_id']::text[], ARRAY['rfqItem_id']::text[], 'c'),
      ('item_workflow_action_rfq_item_id_fkey', 'plm.item_workflow_action'::regclass, 'plm."RFQItem"'::regclass, ARRAY['rfq_item_id']::text[], ARRAY['rfqItem_id']::text[], 'r'),
      ('item_workflow_action_prior_step_id_fkey', 'plm.item_workflow_action'::regclass, 'plm."RFQStep"'::regclass, ARRAY['prior_step_id']::text[], ARRAY['RFQStep_id']::text[], 'a'),
      ('item_workflow_action_new_step_id_fkey', 'plm.item_workflow_action'::regclass, 'plm."RFQStep"'::regclass, ARRAY['new_step_id']::text[], ARRAY['RFQStep_id']::text[], 'a'),
      ('item_workflow_action_source_action_id_fkey', 'plm.item_workflow_action'::regclass, 'plm.item_workflow_action'::regclass, ARRAY['source_action_id','rfq_item_id']::text[], ARRAY['id','rfq_item_id']::text[], 'r')) AS expected(constraint_name, child_oid, parent_oid, child_keys, parent_keys, delete_code)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conname = expected.constraint_name AND c.contype = 'f'
        AND c.conrelid = expected.child_oid AND c.confrelid = expected.parent_oid
        AND c.convalidated AND c.confdeltype = expected.delete_code
        AND ARRAY(
          SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinal)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          ORDER BY k.ordinal
        ) = expected.child_keys
        AND ARRAY(
          SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ordinal)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
          ORDER BY k.ordinal
        ) = expected.parent_keys)
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_constraint
    WHERE contype = 'f' AND conrelid IN ('plm.item_user_assignment'::regclass, 'plm.item_workflow_action'::regclass)
  ) <> 5 THEN
    RAISE EXCEPTION 'five valid foreign keys or ON DELETE semantics differ from exact catalogue contract';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES (
      'item_user_assignment_rfq_item_id_idx', 'plm.item_user_assignment'::regclass, false, ARRAY['rfq_item_id']::text[], ''),
      ('item_user_assignment_one_active', 'plm.item_user_assignment'::regclass, true, ARRAY['rfq_item_id','function_key','user_id']::text[], 'effective_to IS NULL'),
      ('item_workflow_action_rfq_item_id_idx', 'plm.item_workflow_action'::regclass, false, ARRAY['rfq_item_id']::text[], ''),
      ('item_workflow_action_prior_step_id_idx', 'plm.item_workflow_action'::regclass, false, ARRAY['prior_step_id']::text[], ''),
      ('item_workflow_action_new_step_id_idx', 'plm.item_workflow_action'::regclass, false, ARRAY['new_step_id']::text[], ''),
      ('item_workflow_action_source_action_rfq_item_idx', 'plm.item_workflow_action'::regclass, false, ARRAY['source_action_id','rfq_item_id']::text[], ''),
      ('item_workflow_action_one_return_per_source', 'plm.item_workflow_action'::regclass, true, ARRAY['source_action_id']::text[], 'source_action_id IS NOT NULL')) AS expected(index_name, table_oid, is_unique, key_names, predicate)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = ic.relnamespace
      JOIN pg_catalog.pg_am am ON am.oid = ic.relam
      WHERE ns.nspname = 'plm' AND ic.relname = expected.index_name
        AND ic.relkind = 'i' AND am.amname = 'btree'
        AND i.indrelid = expected.table_oid
        AND i.indisunique = expected.is_unique
        AND i.indisvalid AND i.indisready AND i.indislive
        AND i.indexprs IS NULL
        AND i.indnatts = cardinality(expected.key_names)
        AND i.indnkeyatts = cardinality(expected.key_names)
        AND ARRAY(
          SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ordinal)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          ORDER BY k.ordinal
        ) = expected.key_names
        AND coalesce(trim(both '()' from pg_catalog.pg_get_expr(i.indpred, i.indrelid)), '') = expected.predicate)
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_index
    WHERE indrelid IN ('plm.item_user_assignment'::regclass, 'plm.item_workflow_action'::regclass)
  ) <> 11 THEN
    RAISE EXCEPTION 'seven claimed indexes or four primary/constraint indexes differ from exact catalogue contract';
  END IF;
END
$test$;
