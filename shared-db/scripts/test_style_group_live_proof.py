#!/usr/bin/env python3
"""Guard issue #2478's one-off production proof route without weakening others."""
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from shared_db_live_proof import LiveProofError, execute_bounded_probe
from style_group_live_proof import (CA_FILE, CA_SHA256, HOST, PORT, PROBE_SHA256, USER,
                                    execute_style_group_probe, main)
from test_shared_db_live_proof import FakeConnection


class StyleGroupProofTests(unittest.TestCase):
    def setUp(self):
        # Hash exactly what main() hashes: the committed bytes, not newline-normalized text.
        self.sql = (ROOT / ".github/live-proofs/2478.sql").read_bytes().decode("utf-8")
        self.connection = FakeConnection()
        self.connection.state = ["postgres", "postgres", "postgres", "on",
                                 "8s", "1s", False, True]

    def test_public_ca_and_exact_committed_probe_are_pinned(self):
        self.assertEqual(hashlib.sha256(self.sql.encode()).hexdigest(), PROBE_SHA256)
        self.assertEqual(hashlib.sha256(CA_FILE.read_bytes()).hexdigest(), CA_SHA256)

    def test_only_exact_probe_uses_privileged_read_only_transaction(self):
        self.assertEqual(execute_style_group_probe(self.connection, self.sql), [{"passed": True}])
        self.assertEqual(self.connection.calls[0][0], "SET TRANSACTION READ ONLY")
        self.assertEqual(self.connection.calls[1][1], ("8000ms", "1000ms"))
        self.assertEqual(self.connection.calls[-1], (self.sql, None, {"prepare": True}))
        self.assertTrue(self.connection.rolled_back)
        with self.assertRaises(LiveProofError):
            execute_style_group_probe(FakeConnection(), "select true as passed")

    def test_role_limits_result_and_server_refusal_stop(self):
        for index, value in ((0, "service_role"), (1, "service_role"), (2, "other"),
                             (3, "off"), (4, "0"), (5, "0"), (6, True), (7, False)):
            with self.subTest(index=index):
                connection = FakeConnection()
                connection.state = self.connection.state[:]
                connection.state[index] = value
                with self.assertRaises(LiveProofError):
                    execute_style_group_probe(connection, self.sql)
                self.assertFalse(any(call[2].get("prepare") for call in connection.calls))
        self.connection.rows = [(False,)]
        with self.assertRaises(LiveProofError):
            execute_style_group_probe(self.connection, self.sql)
        self.connection.error = RuntimeError("private query text")
        with self.assertRaises(LiveProofError) as caught:
            execute_style_group_probe(self.connection, self.sql)
        self.assertNotIn("private query text", str(caught.exception))

    def test_general_bypassrls_refusal_remains(self):
        # A correctly shaped 9-column general-route state that differs ONLY in
        # rolbypassrls=True, so the BYPASSRLS clause itself is what refuses.
        connection = FakeConnection()
        connection.state = ["postgres", "postgres", "postgres", "pg_catalog, public",
                            "on", "8s", "1s", False, False]
        execute_bounded_probe(connection, self.sql, expected_role="postgres")
        connection = FakeConnection()
        connection.state = ["postgres", "postgres", "postgres", "pg_catalog, public",
                            "on", "8s", "1s", False, True]
        with self.assertRaises(LiveProofError):
            execute_bounded_probe(connection, self.sql, expected_role="postgres")
        self.assertFalse(any(call[2].get("prepare") for call in connection.calls))

    def test_workflow_limits_direct_route_to_2478(self):
        workflow = (ROOT / ".github/workflows/shared-db-live-proof.yml").read_text()
        self.assertIn("inputs.work_issue != '2478'", workflow)
        self.assertIn("inputs.work_issue == '2478'", workflow)
        self.assertIn("scripts/style_group_live_proof.py", workflow)
        self.assertIn("secrets.SUPABASE_DB_PASSWORD_PRODUCTION", workflow)
        self.assertIn("name: shared-db-live-proof-${{ inputs.work_issue }}-${{ github.sha }}", workflow)

    def test_assertion_must_name_the_probe_version(self):
        from style_group_live_proof import assertion_names_probe_version
        def issue(text):
            return {"body": f"```db-work-scope\nlive_assertion: {text}\n```\n"}
        assertion_names_probe_version(issue("migration 20260925061508 recorded"), self.sql)
        for text in ("migration 20260920203337 recorded",
                     "migrations 20260925061508 and 20260920203337",
                     "no version named"):
            with self.subTest(text=text), self.assertRaises(LiveProofError):
                assertion_names_probe_version(issue(text), self.sql)

    def test_main_pins_connection_parameters_and_refuses_misroutes(self):
        self.assertEqual(PORT, 5432)
        calls = []
        connection = FakeConnection()
        connection.state = self.connection.state[:]
        connection.info = SimpleNamespace(host=HOST, port=PORT, dbname="postgres",
                                          user=USER, transaction_status=0)

        def connect(**kwargs):
            calls.append(kwargs)
            return connection

        with tempfile.TemporaryDirectory() as directory:
            issue_file = Path(directory) / "issue.json"
            issue_file.write_text(json.dumps({"number": 2478, "body": """
```db-work-scope
work_type: structural
application_return_to: popcre/shared-db
live_assertion: migration 20260925061508 and derivation controls pass
```
"""}))
            argv = ["--work-issue", "2478", "--issue-json", str(issue_file),
                    "--probe", ".github/live-proofs/2478.sql", "--commit-sha", "a" * 40,
                    "--output", str(Path(directory) / "proof.json")]
            with patch.dict(sys.modules, {"psycopg": SimpleNamespace(connect=connect)}), \
                 patch.dict(os.environ, {"SUPABASE_DB_PASSWORD_PRODUCTION": "test-only"}):
                main(argv)
                self.assertEqual(json.loads(Path(argv[-1]).read_text())["result"], "passed")
                self.assertEqual(calls[-1]["password"], "test-only")
                self.assertEqual(calls[-1]["host"], HOST)
                self.assertEqual(calls[-1]["port"], PORT)
                self.assertEqual(calls[-1]["user"], USER)
                self.assertEqual(calls[-1]["dbname"], "postgres")
                self.assertEqual(calls[-1]["sslmode"], "verify-full")
                self.assertEqual(calls[-1]["sslrootcert"], str(CA_FILE))
                for field, wrong in (("host", "wrong.pooler.supabase.com"),
                                     ("port", 6543), ("dbname", "other"),
                                     ("user", "other")):
                    with self.subTest(field=field):
                        setattr(connection.info, field, wrong)
                        with self.assertRaises(LiveProofError):
                            main(argv[:-1] + [str(Path(directory) / f"{field}.json")])
                        setattr(connection.info, field, {"host": HOST, "port": PORT,
                                                        "dbname": "postgres", "user": USER}[field])
                with patch.dict(os.environ, {}, clear=True), self.assertRaises(LiveProofError):
                    main(argv[:-1] + [str(Path(directory) / "missing-secret.json")])
                with patch("style_group_live_proof.CA_SHA256", "0" * 64), self.assertRaises(LiveProofError):
                    main(argv[:-1] + [str(Path(directory) / "changed-ca.json")])
                with self.assertRaises(LiveProofError):
                    main(argv[:5] + ["scripts/test_style_group_live_proof.py"] + argv[6:-1]
                         + [str(Path(directory) / "wrong-probe.json")])
                with self.assertRaises(LiveProofError):
                    main(["--work-issue", "2479"] + argv[2:-1]
                         + [str(Path(directory) / "wrong-issue.json")])
                with self.assertRaises(LiveProofError):
                    main(argv)  # output already exists
                # A post-connect configuration mismatch never runs the probe.
                connection.calls.clear()
                connection.info.port = 6543
                with self.assertRaises(LiveProofError):
                    main(argv[:-1] + [str(Path(directory) / "no-probe.json")])
                self.assertFalse(any(call[2].get("prepare") for call in connection.calls))
                connection.info.port = PORT
                # A failure after connecting is not reported as a connection refusal.
                connection.rows = [(False,)]
                with self.assertRaises(LiveProofError) as caught:
                    main(argv[:-1] + [str(Path(directory) / "failed.json")])
                self.assertNotIn("connection refused", str(caught.exception))
        self.assertEqual(len(calls), 7)

    def test_time_budget_is_enforced(self):
        with self.assertRaises(LiveProofError):
            execute_style_group_probe(self.connection, self.sql, clock=iter([0, 9]).__next__)


if __name__ == "__main__":
    unittest.main()
