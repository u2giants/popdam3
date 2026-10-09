import hashlib
import io
import json
from pathlib import Path
from contextlib import redirect_stderr, redirect_stdout
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

    def authorize(self, sql="lock table x in exclusive mode;", version="29990101000000", strip_outer_transaction=False):
        path = self.root / f"{version}_test.sql"
        path.write_text(sql, encoding="utf-8")
        entry = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "targets": ["preview"]}
        if strip_outer_transaction:
            entry["strip_outer_transaction"] = True
        policy = {"schema_version": 1, "migrations": {version: entry}}
        policy_path = self.root / "policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        return path, policy_path

    def test_split_preserves_semicolons_in_quotes_comments_and_dollar_blocks(self):
        sql = "select ';'; -- ;\n do $$ begin perform ';'; end $$; select 2;"
        self.assertEqual(len(atomic.split_sql(sql)), 3)

    def test_split_keeps_sql_atomic_body_and_ignores_nested_lexical_traps(self):
        sql = r"""CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC
          SELECT CASE WHEN true THEN CASE WHEN false THEN 1 ELSE 2 END ELSE 3 END;
          SELECT E'escaped \' END; BEGIN ATOMIC'::text;
          /* outer ; END; /* nested BEGIN ATOMIC; */ still-comment */
          BEGIN ATOMIC SELECT 4; END;
        END;
        SELECT 5;"""
        statements = atomic.split_sql(sql)
        self.assertEqual(len(statements), 2)
        self.assertTrue(statements[0].startswith("CREATE OR REPLACE FUNCTION"))
        self.assertIn("BEGIN ATOMIC SELECT 4; END", statements[0])
        self.assertEqual(statements[1], "SELECT 5")

    def test_unclosed_or_unbalanced_sql_atomic_body_is_refused(self):
        for sql in (
            "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1;",
            "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1; END END;",
        ):
            with self.subTest(sql=sql), self.assertRaises(atomic.Refusal):
                atomic.split_sql(sql)

    def test_top_level_transaction_control_after_atomic_body_is_refused(self):
        sql = "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1; END; COMMIT;"
        _, policy = self.authorize(sql)
        with patch.object(atomic, "POLICY", policy), self.assertRaisesRegex(
            atomic.Refusal, "transaction-control"
        ):
            atomic.load_candidate(self.root, "29990101000000", "preview")

    def test_exact_hash_and_single_file_are_required(self):
        path, policy = self.authorize()
        with patch.object(atomic, "POLICY", policy):
            loaded = atomic.load_candidate(self.root, "29990101000000", "preview")
            self.assertEqual(loaded[0], path)
            path.write_text("select 2;", encoding="utf-8")
            with self.assertRaisesRegex(atomic.Refusal, "SHA256 mismatch"):
                atomic.load_candidate(self.root, "29990101000000", "preview")

    def test_policy_hash_is_stable_across_lf_and_windows_crlf_checkouts(self):
        path = self.root / "29990101000000_test.sql"
        canonical = b"lock table x in exclusive mode;\nselect 1;\n"
        path.write_bytes(canonical)
        digest = hashlib.sha256(canonical).hexdigest()
        policy = {
            "schema_version": 1,
            "migrations": {
                "29990101000000": {"sha256": digest, "targets": ["preview"]}
            },
        }
        policy_path = self.root / "policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")

        with patch.object(atomic, "POLICY", policy_path):
            atomic.validate_policy_bindings(self.root)
            path.write_bytes(canonical.replace(b"\n", b"\r\n"))
            atomic.validate_policy_bindings(self.root)
            loaded = atomic.load_candidate(self.root, "29990101000000", "preview")

        self.assertEqual(loaded[2].encode("utf-8"), canonical)
        self.assertEqual(
            hashlib.sha256(atomic.canonical_migration_bytes(path)).hexdigest(), digest
        )

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

    def test_outer_transaction_stripping_requires_explicit_opt_in_and_exact_pair(self):
        sql = "-- migration note\nbegin;\ncreate table x(id int);\ncommit;"
        path, policy = self.authorize(sql)
        with patch.object(atomic, "POLICY", policy), self.assertRaisesRegex(
            atomic.Refusal, "transaction-control"
        ):
            atomic.load_candidate(self.root, "29990101000000", "preview")

        path, policy = self.authorize(sql, strip_outer_transaction=True)
        with patch.object(atomic, "POLICY", policy):
            _, _, executable_sql, statements = atomic.load_candidate(
                self.root, "29990101000000", "preview"
            )
        self.assertEqual(statements, ["create table x(id int)"])
        self.assertEqual(executable_sql, "create table x(id int);\n")

    def test_outer_transaction_opt_in_rejects_options_unpaired_and_internal_controls(self):
        cases = (
            "begin transaction; select 1; commit;",
            "begin; select 1;",
            "begin; select 1; commit; commit;",
            "begin; select 1; rollback; commit;",
            "begin; select 1; /* outer /* nested */ tail */ commit; commit;",
            "begin; commit;",
        )
        for sql in cases:
            with self.subTest(sql=sql):
                _, policy = self.authorize(sql, strip_outer_transaction=True)
                with patch.object(atomic, "POLICY", policy), self.assertRaises(atomic.Refusal):
                    atomic.load_candidate(self.root, "29990101000000", "preview")

    def test_nested_leading_comment_cannot_hide_transaction_control(self):
        for strip_outer in (False, True):
            with self.subTest(strip_outer=strip_outer):
                sql = "/* outer /* nested */ tail */ COMMIT;"
                if strip_outer:
                    sql = "BEGIN; SELECT 1; " + sql + " COMMIT;"
                _, policy = self.authorize(sql, strip_outer_transaction=strip_outer)
                with patch.object(atomic, "POLICY", policy), self.assertRaisesRegex(
                    atomic.Refusal, "transaction-control"
                ):
                    atomic.load_candidate(self.root, "29990101000000", "preview")

    def test_quoted_and_literal_transaction_keywords_are_not_controls(self):
        sql = "select 'BEGIN'; select \"COMMIT\";"
        _, policy = self.authorize(sql)
        with patch.object(atomic, "POLICY", policy):
            _, _, _, statements = atomic.load_candidate(self.root, "29990101000000", "preview")
        self.assertEqual(len(statements), 2)
        self.assertEqual(atomic.control_tokens("'BEGIN'"), ["<literal>"])
        self.assertEqual(atomic.control_tokens('"COMMIT"'), ["<identifier>"])

    def test_non_boolean_outer_transaction_policy_flag_is_refused(self):
        _, policy = self.authorize()
        value = json.loads(policy.read_text(encoding="utf-8"))
        value["migrations"]["29990101000000"]["strip_outer_transaction"] = "true"
        policy.write_text(json.dumps(value), encoding="utf-8")
        with patch.object(atomic, "POLICY", policy), self.assertRaisesRegex(
            atomic.Refusal, "transaction flag is invalid"
        ):
            atomic.read_policy()

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

    def test_orderlist_migration_is_exactly_allowlisted_for_both_targets(self):
        version = "20261009073649"
        expected_digest = "bbe83b7db3ac4eb67a1468da83f32d1d9a5a75695decdf09a2957bcf6b31e590"
        policy = atomic.read_policy()

        self.assertEqual(policy[version], {
            "sha256": expected_digest,
            "targets": ["preview", "production"],
            "strip_outer_transaction": True,
        })
        migration_dir = atomic.ROOT / "supabase" / "migrations"
        path = migration_dir / f"{version}_popdam_orderlist_sheets_integration.sql"
        self.assertEqual(hashlib.sha256(atomic.canonical_migration_bytes(path)).hexdigest(), expected_digest)
        atomic.validate_policy_bindings(migration_dir)
        self.assertEqual(atomic.classify_allowlist(version), version)

    def test_orderlist_allowlist_check_mode_is_offline_and_target_scoped(self):
        version = "20261009073649"
        migration_dir = atomic.ROOT / "supabase" / "migrations"

        for target in ("preview", "production"):
            with self.subTest(target=target):
                argv = [
                    "atomic_migration_apply.py", "--migrations-dir", str(migration_dir),
                    "--linked-dir", str(self.root), "--version", version,
                    "--target", target, "--expected-project-ref", f"{target}-ref",
                    "--mode", "check",
                ]
                output = io.StringIO()
                with patch.object(sys, "argv", argv), patch.object(
                    atomic, "linked_connection",
                    return_value=("postgresql://safe.invalid/db", {"PGSSLMODE": "require"}),
                ) as linked, patch.object(atomic, "validate_remote") as remote, patch.object(
                    atomic.subprocess, "run", side_effect=AssertionError("check mode must not apply SQL")
                ), redirect_stdout(output):
                    self.assertEqual(atomic.main(), 0)

                linked.assert_called_once_with(self.root, f"{target}-ref")
                remote.assert_called_once_with(
                    "postgresql://safe.invalid/db", {"PGSSLMODE": "require"}, version
                )
                self.assertIn(f"ATOMIC PREFLIGHT OK: target={target} version={version}", output.getvalue())

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

    def test_linked_connection_moves_target_to_pg_env_and_sweeps_ambient_target(self):
        linked = self.root / "supabase" / ".temp"
        linked.mkdir(parents=True)
        (linked / "pooler-url").write_text(
            "postgresql://postgres.preview-ref" + "@" + "pooler.example:6543/postgres?sslmode=verify-full",
            encoding="utf-8",
        )
        with patch.dict(atomic.os.environ, {
            "EXPECTED_PROJECT_REF": "preview-ref", "SUPABASE_DB_PASSWORD": "private-value",
            "PGHOST": "wrong-host", "PGHOSTADDR": "wrong-address", "PGSSLMODE": "disable",
            "PAGER": "cat",
        }):
            url, env = atomic.linked_connection(self.root, "preview-ref")
        self.assertIn("pooler.example", url)
        self.assertEqual(env["PGHOST"], "pooler.example")
        self.assertEqual(env["PGPORT"], "6543")
        self.assertEqual(env["PGUSER"], "postgres.preview-ref")
        self.assertEqual(env["PGDATABASE"], "postgres")
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGPASSWORD"], "private-value")
        self.assertNotIn("PGHOSTADDR", env)
        self.assertEqual(env["PAGER"], "cat")

    def test_psql_argv_contains_no_connection_url(self):
        url = "postgresql://postgres.preview-ref" + "@" + "pooler.example:6543/postgres"
        completed = SimpleNamespace(returncode=0, stderr="", stdout="1\n")
        with patch.object(atomic.shutil, "which", return_value="psql"), patch.object(
            atomic.subprocess, "run", return_value=completed
        ) as run:
            self.assertEqual(atomic.psql(url, {"PGHOST": "pooler.example"}, "select 1;"), "1")
        self.assertNotIn(url, run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs["env"]["PGHOST"], "pooler.example")

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
        self.assertNotIn("postgresql://safe.invalid/db", command)
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
