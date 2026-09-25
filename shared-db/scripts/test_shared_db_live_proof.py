import re
import copy
import json
import tempfile
import hashlib
from types import SimpleNamespace
from unittest.mock import patch
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shared_db_live_proof import (LiveProofError, build_proof, execute_bounded_probe,
                                  build_qualification, verify_qualification, qualification_main,
                                  execute_management_probe, MANAGEMENT_ROLE_POLICY, _digest,
                                  validate_probe_with_repository_parser, management_query)  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SHA = "c" * 40
ASSERTION = "a Data API request as anon is refused"


def issue(number=2848, return_to="u2giants/shared-db", assertion=ASSERTION, work_type="structural"):
    lines = ["```db-work-scope", f"work_type: {work_type}", f"application_return_to: {return_to}"]
    if assertion is not None:
        lines.append(f"live_assertion: {assertion}")
    lines.append("```")
    return {"number": number, "body": "\n".join(lines)}


def run(**overrides):
    args = dict(issue=issue(), work_issue=2848, probe_sql="select true as passed", commit_sha=SHA,
                query=lambda sql: [{"passed": True}], now=datetime(2026, 9, 14, 18, 0, 0, tzinfo=timezone.utc))
    args.update(overrides)
    return build_proof(**args)


class BuildProofTests(unittest.TestCase):
    def test_passing_probe_produces_the_exact_proof_shape(self):
        self.assertEqual(run(), {
            "schema_version": 1, "work_issue": 2848, "application_commit_sha": SHA,
            "live_assertion": ASSERTION, "environment": "production", "result": "passed",
            "observed_at": "2026-09-14T18:00:00Z",
        })

    def test_refusals(self):
        cases = {
            "false probe": dict(query=lambda sql: [{"passed": False}]),
            "no rows": dict(query=lambda sql: []),
            "two rows": dict(query=lambda sql: [{"passed": True}, {"passed": True}]),
            "string true": dict(query=lambda sql: [{"passed": "true"}]),
            "extra column": dict(query=lambda sql: [{"passed": True, "x": 1}]),
            "other application": dict(issue=issue(return_to="u2giants/popdam3")),
            "no assertion": dict(issue=issue(assertion=None)),
            "not structural": dict(issue=issue(work_type="repo-maintenance")),
            "wrong issue payload": dict(issue=issue(number=1)),
            "bad sha": dict(commit_sha="C" * 40),
            "empty probe": dict(probe_sql="  "),
            "two scope blocks": dict(issue={"number": 2848, "body": issue()["body"] * 2}),
        }
        for name, override in cases.items():
            with self.subTest(name), self.assertRaises(LiveProofError):
                run(**override)

    def test_refusal_never_queries_before_scope_checks(self):
        calls = []
        with self.assertRaises(LiveProofError):
            run(issue=issue(return_to="u2giants/popdam3"), query=lambda sql: calls.append(sql))
        self.assertEqual(calls, [])


class WorkflowShapeTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / ".github/workflows/shared-db-live-proof.yml").read_text(encoding="utf-8")

    def test_artifact_name_matches_what_complete_outcome_re_derives(self):
        self.assertIn("name: shared-db-live-proof-${{ inputs.work_issue }}-${{ github.sha }}", self.text)
        self.assertIn("db-live-proof.json", self.text)
        lane = (ROOT / "scripts/manage-migration-author-lanes.mjs").read_text(encoding="utf-8")
        self.assertIn("shared-db-live-proof-${evidence.work_issue}-", lane)
        self.assertIn("'db-live-proof.json'", lane)

    def test_dispatch_only_read_only_and_main_only(self):
        self.assertRegex(self.text, r"on:\s*\n\s*workflow_dispatch:")
        self.assertNotRegex(self.text, r"\b(push|pull_request|schedule):")
        self.assertIn("contents: read", self.text)
        self.assertNotRegex(self.text, r":\s*write\b")
        self.assertIn('test "$GITHUB_REF" = refs/heads/main', self.text)
        self.assertIsNone(re.search(r"\bgh api\b", self.text))

    def test_every_committed_probe_is_a_single_statement(self):
        for probe in (ROOT / ".github/live-proofs").glob("*.sql"):
            body = "\n".join(l for l in probe.read_text(encoding="utf-8").splitlines() if not l.strip().startswith("--"))
            with self.subTest(probe.name):
                self.assertEqual(body.strip().rstrip(";").count(";"), 0)
                self.assertRegex(body, r"\bas passed\b")


class FakeConnection:
    """Protocol fixture, never evidence of actual PostgreSQL enforcement."""
    autocommit = True
    info = SimpleNamespace(transaction_status=0)

    def __init__(self):
        self.calls = []
        self.state = ['proof_reader', 'proof_reader', 'postgres', 'pg_catalog, public',
                      'on', '8s', '1s', False, False]
        self.description = [SimpleNamespace(name='passed', type_code=16)]
        self.rows = [(True,)]
        self.error = None
        self.rolled_back = False

    def transaction(self, *, force_rollback):
        assert force_rollback
        parent = self
        class Transaction:
            def __enter__(self): return self
            def __exit__(self, *args): parent.rolled_back = True
        return Transaction()

    def cursor(self): return self
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, parameters=None, **kwargs):
        self.calls.append((sql, parameters, kwargs))
        if kwargs.get('prepare') and self.error:
            raise self.error
    def fetchone(self): return self.state
    def fetchmany(self, count): return self.rows[:count]


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeConnection()
        self.sql = 'select true as passed'
        self.bindings = dict(work_issue=3367, source_sha=SHA, source_pr=3368,
                             migration_hashes={'20260920000000': 'a' * 64},
                             target={'environment': 'preview', 'identity': 'qualified-preview'},
                             baseline_sha256='b' * 64,
                             producer={'repository': 'popcre/shared-db', 'run_id': 1,
                                       'run_attempt': 1, 'workflow_sha': SHA})

    def execute(self, **kwargs):
        return execute_bounded_probe(self.connection, self.sql,
                                     expected_role='proof_reader', **kwargs)

    def manifest(self):
        return build_qualification(connection=self.connection, expected_role='proof_reader',
                                   bindings=self.bindings, probe_sql=self.sql)

    def test_runtime_uses_read_only_server_limits_and_single_statement_protocol(self):
        result = self.execute()
        self.assertEqual(self.connection.calls[0][0], 'SET TRANSACTION READ ONLY')
        self.assertEqual(self.connection.calls[1][1], ('8000ms', '1000ms'))
        self.assertEqual(self.connection.calls[-1], (self.sql, None, {'prepare': True}))
        self.assertEqual(result['execution_role'], 'proof_reader')
        self.assertTrue(self.connection.rolled_back)

    def test_wrong_result_shapes_refuse(self):
        for rows in ([], [(False,)], [(None,)], [('true',)], [(True,), (True,)]):
            self.connection.rows = rows
            with self.subTest(rows=rows), self.assertRaises(LiveProofError): self.execute()
            self.assertTrue(self.connection.rolled_back)
        self.connection.rows = [(True,)]
        for description in (None, [], [SimpleNamespace(name='other', type_code=16)],
                            [SimpleNamespace(name='passed', type_code=25)],
                            [SimpleNamespace(name='passed', type_code=16)] * 2):
            self.connection.description = description
            with self.subTest(description=description), self.assertRaises(LiveProofError): self.execute()

    def test_side_effect_permission_timeout_and_multistatement_server_refusals(self):
        for name in ('ReadOnlySqlTransaction', 'InsufficientPrivilege', 'QueryCanceled', 'SyntaxError'):
            self.connection.error = type(name, (Exception,), {})('private SQL must not leak')
            with self.subTest(name=name), self.assertRaises(LiveProofError) as caught:
                self.execute()
            self.assertNotIn('private SQL', str(caught.exception))
            self.assertTrue(self.connection.rolled_back)

    def test_role_and_settings_must_be_observed_not_asserted(self):
        original = self.connection.state[:]
        for index, value in ((0, 'postgres'), (1, 'postgres'), (4, 'off'), (5, '0'),
                             (6, '0'), (7, True), (8, True)):
            self.connection.state = original[:]
            self.connection.state[index] = value
            with self.subTest(index=index), self.assertRaises(LiveProofError): self.execute()
            self.assertFalse(any(c[2].get('prepare') for c in self.connection.calls))
            self.connection.calls.clear()

    def test_timeout_and_invalid_connection_refuse(self):
        with self.assertRaises(LiveProofError): self.execute(clock=iter([0, 9]).__next__)
        for kwargs in ({'statement_ms': 0}, {'statement_ms': 30001}, {'lock_ms': 9000},
                       {'statement_ms': True}):
            with self.subTest(kwargs=kwargs), self.assertRaises(LiveProofError): self.execute(**kwargs)
        self.connection.autocommit = False
        with self.assertRaises(LiveProofError): self.execute()

    def test_manifest_is_preview_not_production_outcome(self):
        manifest = self.manifest()
        self.assertEqual(manifest['target']['environment'], 'preview')
        self.assertEqual(manifest['kind'], 'acceptance-probe-qualification')
        self.assertNotIn('rows', manifest['runtime'])
        self.assertEqual(verify_qualification(manifest, bindings=self.bindings,
                                             probe_sql=self.sql, expected_role='proof_reader'), manifest)

    def test_every_binding_change_invalidates_qualification(self):
        manifest = self.manifest()
        changes = dict(work_issue=3368, source_sha='d' * 40, source_pr=3369,
                       migration_hashes={'20260920000000': 'd' * 64},
                       target={'environment': 'production', 'identity': 'production'},
                       baseline_sha256='d' * 64,
                       producer={**self.bindings['producer'], 'run_attempt': 2})
        for key, value in changes.items():
            with self.subTest(key=key), self.assertRaises(LiveProofError):
                verify_qualification(manifest, bindings={**self.bindings, key: value},
                                     probe_sql=self.sql, expected_role='proof_reader')
        with self.assertRaises(LiveProofError):
            verify_qualification(manifest, bindings=self.bindings, probe_sql=self.sql + ' ',
                                 expected_role='proof_reader')
        with self.assertRaises(LiveProofError):
            verify_qualification(manifest, bindings=self.bindings, probe_sql=self.sql,
                                 expected_role='another_role')

    def test_tampering_refuses_and_missing_baseline_does_not_exempt(self):
        manifest = self.manifest()
        manifest['runtime']['duration_ms'] = -1
        with self.assertRaises(LiveProofError):
            verify_qualification(manifest, bindings=self.bindings, probe_sql=self.sql,
                                 expected_role='proof_reader')
        self.bindings['baseline_sha256'] = ''
        with self.assertRaises(LiveProofError): self.manifest()


class QualificationCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture = QualificationTests()
        fixture.setUp()
        self.connection = fixture.connection
        self.connection.info = SimpleNamespace(transaction_status=0, host="127.0.0.1", dbname="postgres")
        self.sql = b"select true as passed;\r\n"
        (self.root / "probe.sql").write_bytes(self.sql)
        (self.root / "bindings.json").write_text(json.dumps(fixture.bindings))
        self.args = ["--bindings-json", str(self.root / "bindings.json"),
                     "--probe", str(self.root / "probe.sql"), "--expected-role", "proof_reader",
                     "--expected-host", "127.0.0.1", "--expected-database", "postgres",
                     "--output", str(self.root / "qualification.json")]
        self.connect_calls = []

    def connect(self, secret, **options):
        self.connect_calls.append((secret, options))
        return self.connection

    def run_cli(self, **kwargs):
        return qualification_main(self.args, connector=kwargs.get('connector', self.connect),
                                  environ=kwargs.get('environ', {'SHARED_DB_PROBE_DSN': 'private-secret'}))

    def test_cli_preserves_exact_probe_bytes_and_bounds_connection(self):
        self.assertEqual(self.run_cli(), 0)
        result = json.loads((self.root / "qualification.json").read_text())
        self.assertEqual(result['probe_sha256'], hashlib.sha256(self.sql).hexdigest())
        self.assertEqual(self.connect_calls, [('private-secret', {'autocommit': True, 'connect_timeout': 10})])
        self.assertNotIn('private-secret', json.dumps(result))
        self.assertTrue(self.connection.rolled_back)

    def test_wrong_endpoint_refuses_before_any_sql_or_artifact(self):
        for field in ('host', 'dbname'):
            old = getattr(self.connection.info, field)
            setattr(self.connection.info, field, 'wrong-target')
            with self.subTest(field=field), self.assertRaisesRegex(LiveProofError, 'endpoint'):
                self.run_cli()
            self.assertEqual(self.connection.calls, [])
            self.assertFalse((self.root / "qualification.json").exists())
            setattr(self.connection.info, field, old)

    def test_driver_error_is_redacted_and_never_writes_evidence(self):
        def fail(*args, **kwargs):
            raise RuntimeError('private-secret and SQL')
        with self.assertRaises(LiveProofError) as caught:
            self.run_cli(connector=fail)
        self.assertNotIn('private-secret', str(caught.exception))
        self.assertFalse((self.root / "qualification.json").exists())

    def test_existing_evidence_and_absent_secret_refuse_before_connect(self):
        with self.assertRaisesRegex(LiveProofError, 'absent'):
            self.run_cli(environ={})
        (self.root / "qualification.json").write_text('retained previous evidence')
        with self.assertRaisesRegex(LiveProofError, 'already exists'):
            self.run_cli()
        self.assertEqual(self.connect_calls, [])
        self.assertEqual((self.root / "qualification.json").read_text(), 'retained previous evidence')

    def test_malformed_bindings_refuse_before_connect(self):
        (self.root / "bindings.json").write_text('{}')
        with self.assertRaises(LiveProofError):
            self.run_cli()
        self.assertEqual(self.connect_calls, [])


class ManagementQualificationTests(unittest.TestCase):
    def setUp(self):
        fixture = QualificationTests()
        fixture.setUp()
        self.bindings = fixture.bindings
        self.sql = "SELECT true AS passed;\r\n"
        self.queries = []

    def run_probe(self, rows=None, validator=lambda sql: sql.replace(";", "", 1), **kwargs):
        def query(sql):
            self.queries.append(sql)
            return [{"passed": True}] if rows is None else rows
        return execute_management_probe(query, self.sql, expected_role="supabase_read_only_user",
                                        validator=validator, **kwargs)

    def test_implicit_transaction_exact_policy_asserts_before_exact_probe(self):
        result = self.run_probe()
        query = self.queries[0]
        self.assertTrue(query.startswith("SET TRANSACTION READ ONLY;"))
        self.assertNotIn("BEGIN", query)
        self.assertTrue(query.endswith("ROLLBACK;"))
        self.assertIn(self.sql.replace(";", "", 1), query)
        self.assertLess(query.index("qualification_guard"), query.index("WITH qualification_result"))
        self.assertIn("pg_catalog.pg_typeof(q.passed)", query)
        self.assertIn("pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(q))", query)
        self.assertIn("LIMIT 2", query)
        self.assertIn("NOT rolsuper AND rolbypassrls", query)
        self.assertIn("pg_catalog.current_setting('standard_conforming_strings') = 'on'", query)
        self.assertNotIn("SET LOCAL standard_conforming_strings", query)
        self.assertEqual(result['role_policy']['standard_conforming_strings'], 'on')
        self.assertIn("session_user = 'supabase_read_only_user'", query)
        self.assertIn("pg_catalog.current_database() = 'postgres'", query)
        self.assertEqual(result['role_policy'], MANAGEMENT_ROLE_POLICY)
        self.assertEqual(result['role_policy_sha256'], _digest(MANAGEMENT_ROLE_POLICY))
        self.assertEqual(result['role_verification'], 'same-transaction-server-assertion')

    def test_api_last_nonempty_guard_never_counts_as_empty_probe_success(self):
        for rows in ([{'qualification_guard': 1}], [], [{'passed': True}, {'passed': True}],
                     [{'passed': True, 'extra': 1}], [{'passed': 'true'}]):
            with self.subTest(rows=rows), self.assertRaises(LiveProofError):
                self.run_probe(rows=rows)

    def test_failed_parser_or_unknown_role_does_not_issue_any_query(self):
        with self.assertRaises(LiveProofError):
            self.run_probe(validator=lambda sql: False)
        self.assertEqual(self.queries, [])
        with self.assertRaises(LiveProofError):
            execute_management_probe(lambda sql: self.queries.append(sql), self.sql,
                                     expected_role='postgres')
        self.assertEqual(self.queries, [])

    def test_api_role_timeout_and_permission_errors_never_become_runtime_evidence(self):
        for name in ('DivisionByZero', 'QueryCanceled', 'InsufficientPrivilege'):
            def denied(sql): raise type(name, (Exception,), {})('private response')
            with self.subTest(name=name), self.assertRaises(LiveProofError) as caught:
                execute_management_probe(denied, self.sql, expected_role='supabase_read_only_user',
                                         validator=lambda sql: sql.replace(";", "", 1))
            self.assertNotIn('private response', str(caught.exception))
            self.assertTrue(caught.exception.__suppress_context__)
        with self.assertRaises(LiveProofError):
            self.run_probe(clock=iter([0, 9]).__next__)

    def test_manifest_requires_independently_selected_exact_role_policy_and_budgets(self):
        runtime = self.run_probe()
        with patch('shared_db_live_proof.execute_management_probe', return_value=runtime):
            manifest = build_qualification(management_query=lambda sql: [],
                                          expected_role='supabase_read_only_user',
                                          bindings=self.bindings, probe_sql=self.sql)
        options = dict(bindings=self.bindings, probe_sql=self.sql,
                       expected_role='supabase_read_only_user', expected_role_policy=MANAGEMENT_ROLE_POLICY)
        self.assertEqual(verify_qualification(manifest, **options), manifest)
        for override in ({'expected_role_policy': None}, {'statement_ms': 9000},
                         {'expected_role_policy': {**MANAGEMENT_ROLE_POLICY, 'rolbypassrls': False}}):
            with self.subTest(override=override), self.assertRaises(LiveProofError):
                verify_qualification(manifest, **{**options, **override})
        tampered = copy.deepcopy(manifest)
        tampered['runtime']['role_policy']['rolsuper'] = True
        tampered['manifest_sha256'] = _digest({k:v for k,v in tampered.items() if k!='manifest_sha256'})
        with self.assertRaises(LiveProofError): verify_qualification(tampered, **options)

    def test_api_cli_binds_proven_target_and_reuses_read_only_request(self):
        fixture = QualificationCliTests()
        fixture.setUp()
        try:
            project = 'q' * 20
            bindings = json.loads((fixture.root / 'bindings.json').read_text())
            bindings['target']['identity'] = project
            (fixture.root / 'bindings.json').write_text(json.dumps(bindings))
            args = fixture.args + ['--transport', 'management-api', '--project-ref', project]
            args[args.index('--expected-role') + 1] = 'supabase_read_only_user'
            response = SimpleNamespace(read=lambda limit: b'[{"passed":true}]')
            from contextlib import nullcontext
            with patch('shared_db_live_proof.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps({'statement':'SELECT true AS passed'}))), \
                 patch('urllib.request.urlopen', return_value=nullcontext(response)) as http:
                self.assertEqual(qualification_main(args, environ={'SUPABASE_ACCESS_TOKEN':'private-token'}), 0)
            request = http.call_args.args[0]
            self.assertEqual(request.full_url, f'https://api.supabase.com/v1/projects/{project}/database/query')
            self.assertIs(json.loads(request.data)['read_only'], True)
            self.assertEqual(http.call_args.kwargs['timeout'], 18)
            saved = json.loads((fixture.root / 'qualification.json').read_text())
            self.assertEqual(saved['runtime']['role_policy'], MANAGEMENT_ROLE_POLICY)
            self.assertNotIn('private-token', json.dumps(saved))
            (fixture.root / 'qualification.json').unlink()
            args[args.index('--project-ref') + 1] = 'r' * 20
            with patch('urllib.request.urlopen') as http, self.assertRaisesRegex(LiveProofError, 'target'):
                qualification_main(args, environ={'SUPABASE_ACCESS_TOKEN':'private-token'})
            http.assert_not_called()
        finally:
            fixture.temp.cleanup()

    def test_api_transport_bounds_response_and_redacts_http_errors(self):
        from contextlib import nullcontext
        response = SimpleNamespace(read=lambda limit: b'x' * limit)
        with patch('urllib.request.urlopen', return_value=nullcontext(response)), self.assertRaises(LiveProofError):
            management_query('q' * 20, 'private-token', 'SELECT true AS passed;', timeout_seconds=18)
        with patch('urllib.request.urlopen', side_effect=RuntimeError('private-token and query')):
            with self.assertRaises(LiveProofError) as caught:
                management_query('q' * 20, 'private-token', 'SELECT true AS passed;', timeout_seconds=18)
        self.assertNotIn('private-token', str(caught.exception))
        self.assertTrue(caught.exception.__suppress_context__)

    def test_rehashed_database_or_nonfinite_duration_tamper_refuses(self):
        with patch('shared_db_live_proof.execute_management_probe', return_value=self.run_probe()):
            manifest = build_qualification(management_query=lambda sql: [],
                                          expected_role='supabase_read_only_user',
                                          bindings=self.bindings, probe_sql=self.sql)
        manifest['runtime']['database'] = 'different'
        manifest['manifest_sha256'] = _digest({k:v for k,v in manifest.items() if k!='manifest_sha256'})
        with self.assertRaises(LiveProofError):
            verify_qualification(manifest, bindings=self.bindings, probe_sql=self.sql,
                                 expected_role='supabase_read_only_user', expected_role_policy=MANAGEMENT_ROLE_POLICY)
        manifest['runtime']['duration_ms'] = float('nan')
        with self.assertRaises(LiveProofError):
            verify_qualification(manifest, bindings=self.bindings, probe_sql=self.sql,
                                 expected_role='supabase_read_only_user', expected_role_policy=MANAGEMENT_ROLE_POLICY)

    def test_shared_lexer_capability_is_checked_and_sql_is_stdin_not_argument(self):
        with patch('shared_db_live_proof.subprocess.run', return_value=SimpleNamespace(returncode=2)) as run:
            with self.assertRaises(LiveProofError): validate_probe_with_repository_parser(self.sql)
            args, kwargs = run.call_args
            self.assertNotIn(self.sql, args[0])
            self.assertEqual(kwargs['input'], self.sql)
            self.assertIn('PROBE_SQL_LEXER_VERSION!==2', args[0][3])
        with patch('shared_db_live_proof.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps({'statement':'SELECT true AS passed'}))):
            self.assertTrue(validate_probe_with_repository_parser(self.sql))


if __name__ == "__main__":
    unittest.main()
