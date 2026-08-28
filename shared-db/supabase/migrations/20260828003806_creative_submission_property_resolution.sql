-- Issue #1713: private, source-neutral Creative-to-Submissions Property decisions.
-- This migration creates structure only. It contains no mapping rows, source labels,
-- licensed payloads, evidence text, private paths, or loader implementation.
BEGIN;

CREATE TABLE plm.creative_submission_property_resolution (
  resolution_id uuid PRIMARY KEY,
  creative_source_system text NOT NULL CHECK (btrim(creative_source_system) <> ''),
  creative_source_table text NOT NULL CHECK (btrim(creative_source_table) <> ''),
  creative_source_id text NOT NULL CHECK (btrim(creative_source_id) <> ''),
  decision_version bigint NOT NULL CHECK (decision_version > 0),
  decision_state text NOT NULL CHECK (decision_state IN ('mapped', 'conflict', 'unmapped')),
  supersedes_resolution_id uuid
    REFERENCES plm.creative_submission_property_resolution(resolution_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  reviewed_batch_id uuid NOT NULL,
  reviewed_batch_digest text NOT NULL
    CHECK (reviewed_batch_digest ~ '^sha256:[0-9a-f]{64}$'),
  approval_actor_id uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creative_submission_property_resolution_identity_version_key UNIQUE (
    creative_source_system,
    creative_source_table,
    creative_source_id,
    decision_version
  ),
  CONSTRAINT creative_submission_property_resolution_not_self_superseding CHECK (
    supersedes_resolution_id IS NULL OR supersedes_resolution_id <> resolution_id
  )
);

CREATE TABLE plm.creative_submission_property_resolution_member (
  resolution_member_id uuid PRIMARY KEY,
  resolution_id uuid NOT NULL
    REFERENCES plm.creative_submission_property_resolution(resolution_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  submission_source_system text NOT NULL CHECK (btrim(submission_source_system) <> ''),
  submission_source_table text NOT NULL CHECK (btrim(submission_source_table) <> ''),
  submission_source_id text NOT NULL CHECK (btrim(submission_source_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creative_submission_property_resolution_latest_idx
  ON plm.creative_submission_property_resolution (
    creative_source_system,
    creative_source_table,
    creative_source_id,
    decision_version DESC,
    resolution_id DESC
  );

CREATE UNIQUE INDEX creative_submission_property_resolution_supersedes_uidx
  ON plm.creative_submission_property_resolution (supersedes_resolution_id)
  WHERE supersedes_resolution_id IS NOT NULL;

CREATE UNIQUE INDEX creative_submission_property_resolution_member_identity_uidx
  ON plm.creative_submission_property_resolution_member (
    resolution_id,
    submission_source_system,
    submission_source_table,
    submission_source_id
  );

CREATE INDEX creative_submission_property_resolution_member_submission_idx
  ON plm.creative_submission_property_resolution_member (
    submission_source_system,
    submission_source_table,
    submission_source_id,
    resolution_id
  );

CREATE OR REPLACE FUNCTION plm.reject_creative_submission_property_resolution_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Creative-to-Submissions Property decisions are append-only; % is forbidden', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION plm.enforce_creative_submission_property_resolution_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_resolution_id uuid;
  v_header plm.creative_submission_property_resolution%ROWTYPE;
  v_predecessor plm.creative_submission_property_resolution%ROWTYPE;
  v_member_count bigint;
BEGIN
  v_resolution_id := NEW.resolution_id;

  SELECT * INTO STRICT v_header
  FROM plm.creative_submission_property_resolution
  WHERE resolution_id = v_resolution_id;

  SELECT count(*) INTO v_member_count
  FROM plm.creative_submission_property_resolution_member
  WHERE resolution_id = v_resolution_id;

  IF v_header.decision_state = 'mapped' AND v_member_count = 0 THEN
    RAISE EXCEPTION 'A mapped decision requires at least one exact member identity'
      USING ERRCODE = '23514';
  ELSIF v_header.decision_state = 'unmapped' AND v_member_count <> 0 THEN
    RAISE EXCEPTION 'An unmapped decision cannot contain member identities'
      USING ERRCODE = '23514';
  END IF;

  IF v_header.supersedes_resolution_id IS NOT NULL THEN
    SELECT * INTO STRICT v_predecessor
    FROM plm.creative_submission_property_resolution
    WHERE resolution_id = v_header.supersedes_resolution_id;

    IF v_predecessor.creative_source_system IS DISTINCT FROM v_header.creative_source_system
       OR v_predecessor.creative_source_table IS DISTINCT FROM v_header.creative_source_table
       OR v_predecessor.creative_source_id IS DISTINCT FROM v_header.creative_source_id
       OR v_predecessor.decision_version >= v_header.decision_version THEN
      RAISE EXCEPTION 'A decision may supersede only an earlier version of the same exact Creative identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER creative_submission_property_resolution_immutable
BEFORE UPDATE OR DELETE ON plm.creative_submission_property_resolution
FOR EACH ROW EXECUTE FUNCTION plm.reject_creative_submission_property_resolution_mutation();

CREATE TRIGGER creative_submission_property_resolution_member_immutable
BEFORE UPDATE OR DELETE ON plm.creative_submission_property_resolution_member
FOR EACH ROW EXECUTE FUNCTION plm.reject_creative_submission_property_resolution_mutation();

CREATE TRIGGER creative_submission_property_resolution_no_truncate
BEFORE TRUNCATE ON plm.creative_submission_property_resolution
FOR EACH STATEMENT EXECUTE FUNCTION plm.reject_creative_submission_property_resolution_mutation();

CREATE TRIGGER creative_submission_property_resolution_member_no_truncate
BEFORE TRUNCATE ON plm.creative_submission_property_resolution_member
FOR EACH STATEMENT EXECUTE FUNCTION plm.reject_creative_submission_property_resolution_mutation();

CREATE CONSTRAINT TRIGGER creative_submission_property_resolution_members_check
AFTER INSERT ON plm.creative_submission_property_resolution
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plm.enforce_creative_submission_property_resolution_members();

CREATE CONSTRAINT TRIGGER creative_submission_property_resolution_member_header_check
AFTER INSERT ON plm.creative_submission_property_resolution_member
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plm.enforce_creative_submission_property_resolution_members();

ALTER TABLE plm.creative_submission_property_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE plm.creative_submission_property_resolution FORCE ROW LEVEL SECURITY;
ALTER TABLE plm.creative_submission_property_resolution_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE plm.creative_submission_property_resolution_member FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  plm.creative_submission_property_resolution,
  plm.creative_submission_property_resolution_member
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE
  plm.creative_submission_property_resolution,
  plm.creative_submission_property_resolution_member
TO service_role;

REVOKE ALL ON FUNCTION
  plm.reject_creative_submission_property_resolution_mutation(),
  plm.enforce_creative_submission_property_resolution_members()
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE plm.creative_submission_property_resolution IS
  'Append-only versioned decisions keyed only by exact Creative source identity.';
COMMENT ON TABLE plm.creative_submission_property_resolution_member IS
  'Exact Submissions source identities attached to one immutable decision version.';

COMMIT;
