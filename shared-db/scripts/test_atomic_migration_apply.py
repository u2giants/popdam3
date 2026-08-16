import hashlib
import io
import json
from pathlib import Path
from contextlib import redirect_stderr
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atomic_migration_apply as atomic


class AtomicMigrationApplyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self): self.temp.cleanup()

    def authorize(self, sql="lock table x in exclusive mode;", version="29990101000000"):
        path = self.root / f"{version}_test.sql"
        path.write_text(sql, encoding="utf-8")
        policy = {"schema_version": 1, "migrations": {version: {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "targets": ["preview"]}}}
        policy_path = self.root / "policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        return path, policy_path

    def test_split_preserves_semicolons_in_quotes_comments_and_dollar_blocks(self):
        sql = "select ';'; -- ;\n do $$ begin perform ';'; end $$; select 2;"
        self.assertEqual(len(atomic.split_sql(sql)), 3)

    def test_exact_hash_and_single_file_are_required(self):
        path, policy = self.authorize()
        with patch.object(atomic, "POLICY", policy):
            loaded = atomic.load_candidate(self.root, "29990101000000", "preview")
            self.assertEqual(loaded[0], path)
            path.write_text("select 2;", encoding="utf-8")
            with self.assertRaisesRegex(atomic.Refusal, "SHA256 mismatch"):
                atomic.load_candidate(self.root, "29990101000000", "preview")

    def test_transaction_controls_are_refused(self):
        for control in (
            "begin", "start transaction", "end", "abort", "commit", "rollback",
            "prepare transaction 'x'", "commit prepared 'x'", "rollback prepared 'x'",
            "savepoint x", "release savepoint x",
        ):
            with self.subTest(control=control):
                _, policy = self.authorize(f"{control}; select 1;")
                with patch.object(atomic, "POLICY", policy):
                    with self.assertRaisesRegex(atomic.Refusal, "transaction-control"):
                        atomic.load_candidate(self.root, "29990101000000", "preview")

    def test_classifier_never_falls_through_when_atomic_version_is_mixed(self):
        _, policy = self.authorize()
        with patch.object(atomic, "POLICY", policy):
            self.assertEqual(atomic.classify_allowlist(" 29990101000000 "), "29990101000000")
            self.assertEqual(atomic.classify_allowlist("29990101000001"), "")
            for raw in (
                "29990101000000,29990101000001",
                "29990101000001,29990101000000",
                "29990101000000,",
                ",29990101000000",
            ):
                with self.subTest(raw=raw), self.assertRaises(atomic.Refusal):
                    atomic.classify_allowlist(raw)

    def test_policy_entries_bind_exactly_one_matching_committed_file(self):
        path, policy = self.authorize()
        with patch.object(atomic, "POLICY", policy):
            atomic.validate_policy_bindings(self.root)
            path.unlink()
            with self.assertRaisesRegex(atomic.Refusal, "exactly one committed migration"):
                atomic.validate_policy_bindings(self.root)

    def test_repository_policy_entries_are_bound_to_committed_migrations(self):
        atomic.validate_policy_bindings(atomic.ROOT / "supabase" / "migrations")

    def test_version_is_validated_before_sql_construction(self):
        with self.assertRaisesRegex(atomic.Refusal, "14-digit"):
            atomic.build_wrapper("x' OR true --", "test", "select 1;", ["select 1"])

    def test_psql_error_redacts_connection_metadata(self):
        secret = "postgresql://user:secret@example.invalid/db"
        failure = SimpleNamespace(returncode=1, stderr=secret, stdout="")
        with patch.object(atomic.shutil, "which", return_value="psql"), patch.object(
            atomic.subprocess, "run", return_value=failure
        ):
            with self.assertRaises(atomic.Refusal) as caught:
                atomic.psql("postgresql://safe.invalid/db", {}, "select 1;")
        self.assertNotIn("secret", str(caught.exception))
        self.assertNotIn("example.invalid", str(caught.exception))
        self.assertIn("REDACTED", str(caught.exception))

    def test_remote_validation_accepts_compatible_varchar_and_ignores_extra_columns(self):
        columns = {
            "version": {"data_type": "character varying", "udt_name": "varchar", "is_nullable": "NO"},
            "statements": {"data_type": "ARRAY", "udt_name": "_text", "is_nullable": "YES"},
            "name": {"data_type": "text", "udt_name": "text", "is_nullable": "YES"},
        }
        with patch.object(atomic, "psql", return_value=json.dumps(columns) + "\n0"):
            atomic.validate_remote("postgresql://safe.invalid/db", {}, "29990101000000")

    def test_main_apply_uses_file_path_and_removes_the_temporary_wrapper(self):
        _, policy = self.authorize("create table atomic_test_main(id int);")
        argv = [
            "atomic_migration_apply.py", "--migrations-dir", str(self.root),
            "--linked-dir", str(self.root), "--version", "29990101000000",
            "--target", "preview", "--expected-project-ref", "preview-ref", "--mode", "apply",
        ]
        completed = SimpleNamespace(returncode=0, stderr="", stdout="")
        with patch.object(atomic, "POLICY", policy), patch.object(sys, "argv", argv), patch.object(
            atomic, "linked_connection", return_value=("postgresql://safe.invalid/db", {})
        ), patch.object(atomic, "validate_remote"), patch.object(
            atomic, "psql", return_value="1|1|test"
        ), patch.object(atomic.subprocess, "run", return_value=completed) as run:
            self.assertEqual(atomic.main(), 0)
        command = run.call_args.args[0]
        self.assertIn("-f", command)
        wrapper_path = Path(command[command.index("-f") + 1])
        self.assertFalse(wrapper_path.exists())

    def test_main_apply_failure_redacts_psql_stderr(self):
        _, policy = self.authorize("create table atomic_test_main_fail(id int);")
        argv = [
            "atomic_migration_apply.py", "--migrations-dir", str(self.root),
            "--linked-dir", str(self.root), "--version", "29990101000000",
            "--target", "preview", "--expected-project-ref", "preview-ref", "--mode", "apply",
        ]
        completed = SimpleNamespace(returncode=1, stderr="postgresql://user:secret@host/db", stdout="")
        stderr = io.StringIO()
        with patch.object(atomic, "POLICY", policy), patch.object(sys, "argv", argv), patch.object(
            atomic, "linked_connection", return_value=("postgresql://safe.invalid/db", {})
        ), patch.object(atomic, "validate_remote"), patch.object(
            atomic.subprocess, "run", return_value=completed
        ), redirect_stderr(stderr):
            self.assertEqual(atomic.main(), 2)
        self.assertNotIn("secret", stderr.getvalue())
        self.assertNotIn("host", stderr.getvalue())
        self.assertIn("REDACTED", stderr.getvalue())

    def test_wrapper_places_sql_and_exact_ledger_row_in_one_transaction(self):
        wrapper = atomic.build_wrapper("29990101000000", "test", "create table x(id int);", ["create table x(id int)"])
        self.assertLess(wrapper.index("BEGIN;"), wrapper.index("create table"))
        self.assertLess(wrapper.index("create table"), wrapper.index("INSERT INTO supabase_migrations.schema_migrations"))
        self.assertLess(wrapper.index("INSERT INTO"), wrapper.index("COMMIT;"))


if __name__ == "__main__": unittest.main()
