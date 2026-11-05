-- Issue #5447; bounded system evaluation for designflow-backend #278.
-- derived-from: none
-- The exact-hash atomic executor issues the initial credential in the same
-- transaction. No password, private archive value or source pointer is stored here.
DO $roles$
DECLARE
  created_roles text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'designflow_hts_evaluation_read') THEN
    CREATE ROLE designflow_hts_evaluation_read NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    created_roles := array_append(created_roles, 'designflow_hts_evaluation_read');
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'designflow_hts_evaluation_reader') THEN
    CREATE ROLE designflow_hts_evaluation_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
    created_roles := array_append(created_roles, 'designflow_hts_evaluation_reader');
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('designflow_hts_evaluation_read', 'designflow_hts_evaluation_reader')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION 'evaluation identity attributes do not match the approved read-only contract';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE
    (rolname = 'designflow_hts_evaluation_read' AND rolcanlogin)
    OR (rolname = 'designflow_hts_evaluation_reader' AND NOT rolcanlogin)) THEN
    RAISE EXCEPTION 'evaluation identity login flags do not match the approved contract';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE (parent.rolname IN ('designflow_hts_evaluation_read','designflow_hts_evaluation_reader')
       OR member.rolname IN ('designflow_hts_evaluation_read','designflow_hts_evaluation_reader'))
      AND NOT ((parent.rolname='designflow_hts_evaluation_read'
        AND member.rolname='designflow_hts_evaluation_reader' AND NOT m.admin_option)
        -- PostgreSQL 16/17 gives a non-superuser role creator ADMIN only.
        -- Accept only roles created above, without SET or inherited authority.
        OR (parent.rolname=ANY(created_roles) AND member.rolname=current_user
          AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option))) THEN
    RAISE EXCEPTION 'evaluation identities have unexpected role memberships';
  END IF;
  -- Refuse reuse of identities with any prior object authority. A completed
  -- migration is never replayed; initial issuance never inherits old access.
  IF EXISTS (SELECT FROM pg_shdepend d JOIN pg_roles r ON r.oid=d.refobjid
    WHERE d.refclassid='pg_authid'::regclass
      AND r.rolname IN ('designflow_hts_evaluation_read','designflow_hts_evaluation_reader')
      AND d.deptype IN ('o','a','i','r')) THEN
    RAISE EXCEPTION 'evaluation identities already have object authority; initial issuance refused';
  END IF;
END
$roles$;

GRANT designflow_hts_evaluation_read TO designflow_hts_evaluation_reader;
ALTER ROLE designflow_hts_evaluation_reader SET default_transaction_read_only = on;
GRANT USAGE ON SCHEMA plm, coldlion, dflow_prod TO designflow_hts_evaluation_read;
GRANT SELECT (dataset_id, section, source_ordinal, style_number, historical_hts,
  packet_reference, evidence_status, exact_historical_candidate, original_record)
  ON plm.customs_benchmark_observation TO designflow_hts_evaluation_read;
GRANT SELECT (content_sha256, private_verified)
  ON plm.customs_benchmark_artifact TO designflow_hts_evaluation_read;
GRANT SELECT (item_id_pk, item_num_id)
  ON dflow_prod."itemHeader" TO designflow_hts_evaluation_read;
GRANT SELECT (item_no, pre_pack_code, company_code, division_code)
  ON coldlion.item_detail TO designflow_hts_evaluation_read;

CREATE POLICY hts_evaluation_read ON plm.customs_benchmark_observation
  FOR SELECT TO designflow_hts_evaluation_read USING (true);
CREATE POLICY hts_evaluation_read ON plm.customs_benchmark_artifact
  FOR SELECT TO designflow_hts_evaluation_read USING (private_verified);
CREATE POLICY hts_evaluation_read ON coldlion.item_detail
  FOR SELECT TO designflow_hts_evaluation_read USING (true);

COMMENT ON ROLE designflow_hts_evaluation_reader IS
  'Private bounded HTS evaluation only (#5447/#278); explicit SET ROLE designflow_hts_evaluation_read. No browser, classifier, migration or write authority.';
COMMENT ON ROLE designflow_hts_evaluation_read IS
  'Column-scoped private evidence/prepack reads for bounded system evaluation; evaluated answers never enter classifier prompts or shared learning.';
