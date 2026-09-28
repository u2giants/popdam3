-- Issue #3498: final plm homes for two DesignFlow tables added after the July
-- segregation map (docs PR #3497; owner request 2026-09-24).
-- derived-from: 20260901221310, 20260904143518, 20260905053422, 20260907121732
--
-- Additive only. Structure only; row movement belongs to the DesignFlow
-- migration session. Column shapes match the dflow sources (types, nullability,
-- defaults; column order differs on item_workflow_action where actor_identity_*
-- were appended last in dflow). Cross-schema foreign keys into dflow.users are
-- deliberately omitted because an FK would install RI triggers on the live
-- dflow.users table outside this exact-object claim. User integrity is wired
-- when rows move and the application owner has an approved cutover. Intra-plm foreign
-- keys are included and VALID. The four source dflow FKs are NOT VALID;
-- preflight unresolved legacy parent keys before moving rows or the new homes
-- will reject the insert with SQLSTATE 23503. The two source integrity
-- indexes and five FK child-side indexes ship before any row movement. Four source
-- lookup-only indexes are deferred to the DesignFlow wiring session before
-- the first row is inserted:
--   item_user_assignment_active_lookup
--   item_workflow_action_item_time
--   item_workflow_action_open_handoff_lookup
--   item_workflow_action_admin_review
-- Append-only enforcement (row triggers) is deferred to the same session;
-- the COMMENTs below note it is not yet enforced. The assignment FK uses
-- ON DELETE CASCADE like its source: the wiring session must decide how that
-- interacts with its future DELETE-blocking append-only trigger before rows
-- or parent deletion are enabled. Identity-preserving movement must use
-- OVERRIDING SYSTEM VALUE and advance each new sequence past max(id). The
-- app.user_notification.workflow_action_id FK still points to dflow and must
-- be re-pointed by that owning cutover before retiring the source.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE plm.item_user_assignment (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rfq_item_id integer NOT NULL REFERENCES plm."RFQItem"("rfqItem_id") ON DELETE CASCADE,
  function_key text NOT NULL,
  user_id integer NOT NULL,
  assigned_by_user_id integer NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  effective_to timestamptz,
  assignment_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT item_user_assignment_function_key_shape_check
    CHECK (function_key = pg_catalog.lower(pg_catalog.btrim(function_key)) AND function_key ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT item_user_assignment_effective_window_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT item_user_assignment_context_object_check
    CHECK (pg_catalog.jsonb_typeof(assignment_context) = 'object')
);

CREATE INDEX item_user_assignment_rfq_item_id_idx
  ON plm.item_user_assignment (rfq_item_id);
CREATE UNIQUE INDEX item_user_assignment_one_active
  ON plm.item_user_assignment (rfq_item_id, function_key, user_id)
  WHERE effective_to IS NULL;

COMMENT ON TABLE plm.item_user_assignment IS
  'Final plm item-master home for dflow.item_user_assignment (issue #3498). Item function-role assignment history. Column shapes match the dflow source; row movement is a separate DesignFlow migration. Its active-lookup index and append-only enforcement are deferred to the wiring session; the FK-child and one-active indexes already exist. Beside productUserAssignment in the item-master group.';

CREATE TABLE plm.item_workflow_action (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rfq_item_id integer NOT NULL REFERENCES plm."RFQItem"("rfqItem_id") ON DELETE RESTRICT,
  actor_user_id integer NOT NULL,
  actor_auth_user_id uuid,
  actor_identity_source text NOT NULL DEFAULT
    (case
       when nullif(pg_catalog.current_setting('request.designflow.actor_id', true), '') is not null
         then 'designflow_jwt'
       else 'supabase_auth'
     end),
  actor_identity_email text DEFAULT
    (pg_catalog.lower(nullif(pg_catalog.btrim(
       coalesce(
         nullif(pg_catalog.current_setting('request.designflow.actor_email', true), ''),
         auth.jwt() ->> 'email'
       )
     ), ''))),
  prior_step_id integer REFERENCES plm."RFQStep"("RFQStep_id"),
  new_step_id integer NOT NULL REFERENCES plm."RFQStep"("RFQStep_id"),
  action_key text NOT NULL,
  correlation_key uuid NOT NULL,
  routing_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_action_id bigint,
  fallback_recipient_user_id integer,
  fallback_reason text,
  requires_admin_review boolean NOT NULL DEFAULT false,
  CONSTRAINT item_workflow_action_id_rfq_item_key UNIQUE (id, rfq_item_id),
  CONSTRAINT item_workflow_action_source_action_id_fkey
    FOREIGN KEY (source_action_id, rfq_item_id)
    REFERENCES plm.item_workflow_action(id, rfq_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT item_workflow_action_correlation_key_key UNIQUE (correlation_key),
  CONSTRAINT item_workflow_action_action_key_shape_check
    CHECK (action_key = pg_catalog.lower(pg_catalog.btrim(action_key)) AND action_key ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT item_workflow_action_routing_context_object_check
    CHECK (pg_catalog.jsonb_typeof(routing_context) = 'object'),
  CONSTRAINT item_workflow_action_source_action_not_self
    CHECK (source_action_id IS NULL OR source_action_id <> id),
  CONSTRAINT item_workflow_action_fallback_is_labeled
    CHECK (
      (fallback_recipient_user_id IS NULL AND fallback_reason IS NULL)
      OR (fallback_recipient_user_id IS NOT NULL
          AND fallback_reason IS NOT NULL
          AND pg_catalog.btrim(fallback_reason) <> ''
          AND source_action_id IS NOT NULL)
    ),
  CONSTRAINT item_workflow_action_actor_provenance
    CHECK (
      (actor_identity_source = 'supabase_auth' AND actor_auth_user_id IS NOT NULL)
      OR (actor_identity_source = 'designflow_jwt'
          AND actor_auth_user_id IS NULL
          AND actor_identity_email IS NOT NULL)
    ),
  CONSTRAINT item_workflow_action_return_names_its_source
    CHECK (
      routing_context ->> 'return_to_original_handoff' IS DISTINCT FROM 'true'
      OR source_action_id IS NOT NULL
    )
);

CREATE INDEX item_workflow_action_rfq_item_id_idx
  ON plm.item_workflow_action (rfq_item_id);
CREATE INDEX item_workflow_action_prior_step_id_idx
  ON plm.item_workflow_action (prior_step_id);
CREATE INDEX item_workflow_action_new_step_id_idx
  ON plm.item_workflow_action (new_step_id);
CREATE INDEX item_workflow_action_source_action_rfq_item_idx
  ON plm.item_workflow_action (source_action_id, rfq_item_id);
CREATE UNIQUE INDEX item_workflow_action_one_return_per_source
  ON plm.item_workflow_action (source_action_id)
  WHERE source_action_id IS NOT NULL;

COMMENT ON TABLE plm.item_workflow_action IS
  'Final plm item-master home for dflow.item_workflow_action (issue #3498). Workflow action history (append-only not yet enforced; triggers deferred to the wiring session). A return names source_action_id and never rewrites the original actor. Actor identity source is supabase_auth or designflow_jwt; backend email is normalized. Column shapes match the dflow source; column order differs where actor_identity_* were appended last in dflow. Row movement is a separate DesignFlow migration. Item-master group.';

-- Deny-by-default until DesignFlow wiring explicitly grants its backend role.
-- Explicit anon, authenticated, and service_role table privileges are revoked.
-- Table owners and BYPASSRLS roles retain their PostgreSQL authority.
ALTER TABLE plm.item_user_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE plm.item_workflow_action ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plm.item_user_assignment FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE plm.item_workflow_action FROM PUBLIC, anon, authenticated, service_role;

-- Catalogue-only verification of the claimed shape and deny-by-default access.
DO $verify$
DECLARE
  relation_name text;
  expected_columns integer;
  actual_columns integer;
  index_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['item_user_assignment', 'item_workflow_action'] LOOP
    expected_columns := CASE relation_name WHEN 'item_user_assignment' THEN 9 ELSE 16 END;
    SELECT count(*) INTO actual_columns
      FROM pg_catalog.pg_attribute
     WHERE attrelid = pg_catalog.to_regclass('plm.' || relation_name)
       AND attnum > 0 AND NOT attisdropped;
    IF actual_columns <> expected_columns THEN
      RAISE EXCEPTION 'plm.%: expected % columns, found %', relation_name, expected_columns, actual_columns;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
       WHERE oid = pg_catalog.to_regclass('plm.' || relation_name)
         AND relkind = 'r' AND relrowsecurity
    ) THEN
      RAISE EXCEPTION 'plm.%: ordinary table with RLS required', relation_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'plm' AND tablename = relation_name
    ) THEN
      RAISE EXCEPTION 'plm.%: unexpected RLS policy', relation_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(role_name)
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS privileges(privilege_name)
      WHERE pg_catalog.has_table_privilege(roles.role_name, 'plm.' || relation_name, privileges.privilege_name)
    ) THEN
      RAISE EXCEPTION 'plm.%: deny-by-default privilege boundary failed', relation_name;
    END IF;
  END LOOP;

  -- Compare the complete deparsed defaults with their source columns. A
  -- substring check could accept an inverted actor-identity CASE.
  IF (
    SELECT count(*) FROM pg_catalog.pg_attribute dest
    JOIN pg_catalog.pg_attrdef dd ON dd.adrelid = dest.attrelid AND dd.adnum = dest.attnum
    JOIN pg_catalog.pg_attribute src ON src.attrelid = 'dflow.item_workflow_action'::regclass
      AND src.attname = dest.attname
    JOIN pg_catalog.pg_attrdef sd ON sd.adrelid = src.attrelid AND sd.adnum = src.attnum
    WHERE dest.attrelid = 'plm.item_workflow_action'::regclass
      AND dest.attname IN ('actor_identity_source', 'actor_identity_email')
      AND pg_catalog.pg_get_expr(dd.adbin, dd.adrelid) = pg_catalog.pg_get_expr(sd.adbin, sd.adrelid)
  ) <> 2 THEN
    RAISE EXCEPTION 'actor identity defaults differ from the DesignFlow source';
  END IF;
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
$verify$;

COMMIT;
