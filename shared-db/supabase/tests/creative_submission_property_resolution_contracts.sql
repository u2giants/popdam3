-- Synthetic contract tests for issue #1713. All identities below are invented.
BEGIN;

DO $$
DECLARE
  v_unmapped uuid := '00000000-0000-4000-8000-000000000001';
  v_conflict uuid := '00000000-0000-4000-8000-000000000002';
  v_mapped_v1 uuid := '00000000-0000-4000-8000-000000000003';
  v_mapped_v2 uuid := '00000000-0000-4000-8000-000000000004';
  v_latest uuid;
  v_rejected boolean;
  v_trigger_count integer;
  v_digest text := 'sha256:' || repeat('0', 64);
BEGIN
  INSERT INTO plm.creative_submission_property_resolution (
    resolution_id, creative_source_system, creative_source_table, creative_source_id,
    decision_version, decision_state, reviewed_batch_id, reviewed_batch_digest,
    approval_actor_id, approved_at
  ) VALUES
    (v_unmapped, 'synthetic_creative', 'synthetic_property', 'creative-a', 1, 'unmapped',
     '10000000-0000-4000-8000-000000000001', v_digest,
     '20000000-0000-4000-8000-000000000001', now()),
    (v_conflict, 'synthetic_creative', 'synthetic_property', 'creative-b', 1, 'conflict',
     '10000000-0000-4000-8000-000000000002', v_digest,
     '20000000-0000-4000-8000-000000000002', now()),
    (v_mapped_v1, 'synthetic_creative', 'synthetic_property', 'creative-c', 1, 'mapped',
     '10000000-0000-4000-8000-000000000003', v_digest,
     '20000000-0000-4000-8000-000000000003', now());

  INSERT INTO plm.creative_submission_property_resolution_member (
    resolution_member_id, resolution_id, submission_source_system,
    submission_source_table, submission_source_id
  ) VALUES (
    '30000000-0000-4000-8000-000000000001', v_mapped_v1,
    'synthetic_submission', 'synthetic_property', 'submission-a'
  );

  INSERT INTO plm.creative_submission_property_resolution (
    resolution_id, creative_source_system, creative_source_table, creative_source_id,
    decision_version, decision_state, supersedes_resolution_id, reviewed_batch_id,
    reviewed_batch_digest, approval_actor_id, approved_at
  ) VALUES (
    v_mapped_v2, 'synthetic_creative', 'synthetic_property', 'creative-c', 2, 'mapped',
    v_mapped_v1, '10000000-0000-4000-8000-000000000004', v_digest,
    '20000000-0000-4000-8000-000000000004', now()
  );

  INSERT INTO plm.creative_submission_property_resolution_member (
    resolution_member_id, resolution_id, submission_source_system,
    submission_source_table, submission_source_id
  ) VALUES (
    '30000000-0000-4000-8000-000000000002', v_mapped_v2,
    'synthetic_submission', 'synthetic_property', 'submission-b'
  );

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  SELECT resolution_id INTO v_latest
  FROM plm.creative_submission_property_resolution
  WHERE creative_source_system = 'synthetic_creative'
    AND creative_source_table = 'synthetic_property'
    AND creative_source_id = 'creative-c'
  ORDER BY decision_version DESC, resolution_id DESC
  LIMIT 1;
  IF v_latest IS DISTINCT FROM v_mapped_v2 THEN
    RAISE EXCEPTION 'latest-decision lookup was not deterministic';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO plm.creative_submission_property_resolution (
      resolution_id, creative_source_system, creative_source_table, creative_source_id,
      decision_version, decision_state, reviewed_batch_id, reviewed_batch_digest,
      approval_actor_id, approved_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000005', 'synthetic_creative', 'synthetic_property',
      'creative-d', 1, 'mapped', '10000000-0000-4000-8000-000000000005', v_digest,
      '20000000-0000-4000-8000-000000000005', now()
    );
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT v_rejected THEN RAISE EXCEPTION 'memberless mapped decision was accepted'; END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO plm.creative_submission_property_resolution_member (
      resolution_member_id, resolution_id, submission_source_system,
      submission_source_table, submission_source_id
    ) VALUES (
      '30000000-0000-4000-8000-000000000003', v_unmapped,
      'synthetic_submission', 'synthetic_property', 'submission-c'
    );
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT v_rejected THEN RAISE EXCEPTION 'member-bearing unmapped decision was accepted'; END IF;

  INSERT INTO plm.creative_submission_property_resolution_member (
    resolution_member_id, resolution_id, submission_source_system,
    submission_source_table, submission_source_id
  ) VALUES (
    '30000000-0000-4000-8000-000000000005', v_conflict,
    'synthetic_submission', 'synthetic_property', 'submission-conflict-candidate'
  );
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  v_rejected := false;
  BEGIN
    INSERT INTO plm.creative_submission_property_resolution (
      resolution_id, creative_source_system, creative_source_table, creative_source_id,
      decision_version, decision_state, reviewed_batch_id, reviewed_batch_digest,
      approval_actor_id, approved_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000009', 'synthetic_creative', 'synthetic_property',
      'creative-c', 2, 'conflict', '10000000-0000-4000-8000-000000000009', v_digest,
      '20000000-0000-4000-8000-000000000009', now()
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'duplicate decision version was accepted'; END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO plm.creative_submission_property_resolution_member (
      resolution_member_id, resolution_id, submission_source_system,
      submission_source_table, submission_source_id
    ) VALUES (
      '30000000-0000-4000-8000-000000000004', v_mapped_v2,
      'synthetic_submission', 'synthetic_property', 'submission-b'
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'duplicate exact member was accepted'; END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO plm.creative_submission_property_resolution (
      resolution_id, creative_source_system, creative_source_table, creative_source_id,
      decision_version, decision_state, supersedes_resolution_id, reviewed_batch_id,
      reviewed_batch_digest, approval_actor_id, approved_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000006', 'synthetic_creative', 'synthetic_property',
      'creative-other', 3, 'conflict', v_mapped_v2,
      '10000000-0000-4000-8000-000000000006', v_digest,
      '20000000-0000-4000-8000-000000000006', now()
    );
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT v_rejected THEN RAISE EXCEPTION 'cross-identity supersession was accepted'; END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO plm.creative_submission_property_resolution (
      resolution_id, creative_source_system, creative_source_table, creative_source_id,
      decision_version, decision_state, supersedes_resolution_id, reviewed_batch_id,
      reviewed_batch_digest, approval_actor_id, approved_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000007', 'synthetic_creative', 'synthetic_property',
      'creative-c', 3, 'conflict', v_mapped_v1,
      '10000000-0000-4000-8000-000000000007', v_digest,
      '20000000-0000-4000-8000-000000000007', now()
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'a second direct successor was accepted'; END IF;

  v_rejected := false;
  BEGIN
    UPDATE plm.creative_submission_property_resolution
    SET decision_state = 'conflict' WHERE resolution_id = v_conflict;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'owner-path header update was accepted'; END IF;

  v_rejected := false;
  BEGIN
    DELETE FROM plm.creative_submission_property_resolution_member
    WHERE resolution_id = v_mapped_v1;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'owner-path member delete was accepted'; END IF;

  v_rejected := false;
  BEGIN
    TRUNCATE TABLE plm.creative_submission_property_resolution_member;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'owner-path member truncate was accepted'; END IF;

  v_rejected := false;
  BEGIN
    TRUNCATE TABLE plm.creative_submission_property_resolution;
  EXCEPTION WHEN object_not_in_prerequisite_state OR feature_not_supported THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'owner-path header truncate was accepted'; END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'plm'
      AND t.tgname IN (
        'creative_submission_property_resolution_no_truncate',
        'creative_submission_property_resolution_member_no_truncate'
      )
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND (t.tgtype & 32) = 32
      AND (t.tgtype & 1) = 0
      AND pn.nspname = 'plm'
      AND p.proname = 'reject_creative_submission_property_resolution_mutation';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'both statement-level truncate rejection triggers are required';
  END IF;

  IF NOT has_table_privilege('service_role', 'plm.creative_submission_property_resolution', 'SELECT')
     OR NOT has_table_privilege('service_role', 'plm.creative_submission_property_resolution', 'INSERT')
     OR has_table_privilege('service_role', 'plm.creative_submission_property_resolution', 'UPDATE')
     OR has_table_privilege('service_role', 'plm.creative_submission_property_resolution', 'DELETE')
     OR has_table_privilege('service_role', 'plm.creative_submission_property_resolution', 'TRUNCATE')
     OR NOT has_table_privilege('service_role', 'plm.creative_submission_property_resolution_member', 'SELECT')
     OR NOT has_table_privilege('service_role', 'plm.creative_submission_property_resolution_member', 'INSERT')
     OR has_table_privilege('service_role', 'plm.creative_submission_property_resolution_member', 'UPDATE')
     OR has_table_privilege('service_role', 'plm.creative_submission_property_resolution_member', 'DELETE')
     OR has_table_privilege('service_role', 'plm.creative_submission_property_resolution_member', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role privileges are not exactly SELECT and INSERT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'plm'
      AND table_name IN (
        'creative_submission_property_resolution',
        'creative_submission_property_resolution_member'
      )
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'an untrusted role retained table privileges';
  END IF;

  IF EXISTS (
    SELECT table_name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'plm'
      AND table_name IN (
        'creative_submission_property_resolution',
        'creative_submission_property_resolution_member'
      )
      AND grantee = 'service_role'
    GROUP BY table_name
    HAVING array_agg(privilege_type::text ORDER BY privilege_type::text)
      IS DISTINCT FROM ARRAY['INSERT', 'SELECT']::text[]
  ) OR (
    SELECT count(*)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'plm'
      AND table_name IN (
        'creative_submission_property_resolution',
        'creative_submission_property_resolution_member'
      )
      AND grantee = 'service_role'
  ) <> 4 THEN
    RAISE EXCEPTION 'service_role grant rows are not exactly SELECT and INSERT per table';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'plm'
      AND c.relname IN (
        'creative_submission_property_resolution',
        'creative_submission_property_resolution_member'
      )
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled and forced on both tables';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'plm'
      AND tablename IN (
        'creative_submission_property_resolution',
        'creative_submission_property_resolution_member'
      )
  ) THEN
    RAISE EXCEPTION 'these forced-RLS tables must not have policies';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;

SELECT count(*)
FROM plm.creative_submission_property_resolution
WHERE creative_source_system = 'synthetic_creative';

INSERT INTO plm.creative_submission_property_resolution (
  resolution_id, creative_source_system, creative_source_table, creative_source_id,
  decision_version, decision_state, reviewed_batch_id, reviewed_batch_digest,
  approval_actor_id, approved_at
) VALUES (
  '00000000-0000-4000-8000-000000000008', 'synthetic_creative', 'synthetic_property',
  'creative-service', 1, 'conflict', '10000000-0000-4000-8000-000000000008',
  'sha256:' || repeat('0', 64), '20000000-0000-4000-8000-000000000008', now()
);

SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

ROLLBACK;
