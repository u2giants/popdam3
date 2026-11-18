"""Regression coverage for pre-ledger sandbox dependencies (#4578)."""
import tempfile
import unittest
import sys
import json
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from production_migration_guard import GuardError, preflight_batch, read_sandbox_dependencies


class SandboxDependencies(unittest.TestCase):
    @staticmethod
    def snapshot(*names, dflow_prod_present=False):
        return [
            *({"name": name, "dflow_prod_present": None} for name in names),
            {"name": None, "dflow_prod_present": dflow_prod_present},
        ]

    def read(self, rows=None, ledger="sandbox", target="xupnyeifmpsacrqahwwm", returned=None):
        query = Mock(return_value=rows if rows is not None else self.snapshot("dflow.sample"))
        fetch = Mock(return_value={"id": returned or target})
        result = read_sandbox_dependencies(ledger, target, "test-token", query, fetch)
        query.assert_called_once()
        return result

    def test_catalog_proves_existing_relation(self):
        self.assertEqual(self.read(), (frozenset({"dflow.sample"}), True))
        self.assertEqual(
            self.read(rows=self.snapshot("dflow.sample", dflow_prod_present=True)),
            (frozenset({"dflow.sample"}), False),
        )

    def test_management_query_is_read_only_and_follows_identity_proof(self):
        response = MagicMock()
        response.__enter__.return_value.read.side_effect = [
            b'{"id":"xupnyeifmpsacrqahwwm"}',
            json.dumps(self.snapshot("dflow.sample")).encode(),
        ]
        with patch("production_migration_guard.urllib.request.urlopen", return_value=response) as send:
            result = read_sandbox_dependencies("sandbox", "xupnyeifmpsacrqahwwm", "test-token")
        self.assertEqual(result, (frozenset({"dflow.sample"}), True))
        identity, query = [call.args[0] for call in send.call_args_list]
        self.assertEqual(identity.get_method(), "GET")
        self.assertEqual(query.full_url, identity.full_url + "/database/query")
        self.assertEqual(query.get_method(), "POST")
        self.assertIs(json.loads(query.data)["read_only"], True)
        self.assertIn("EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='dflow_prod')", json.loads(query.data)["query"])

    def test_non_json_api_response_refuses_as_guard_error(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"<html>Cloudflare</html>"
        with patch("production_migration_guard.urllib.request.urlopen", return_value=response):
            with self.assertRaises(GuardError):
                read_sandbox_dependencies("sandbox", "xupnyeifmpsacrqahwwm", "test-token")

    def test_other_targets_and_wrong_returned_identity_refuse(self):
        for args in ({"ledger": "production"}, {"ledger": "preview"},
                     {"target": "qsllyeztdwjgirsysgai"}, {"returned": "wrong-project"}):
            with self.subTest(args=args), self.assertRaises(GuardError):
                self.read(**args)

    def test_owner_approved_schemas_are_read(self):
        import production_migration_guard as g, inspect
        src = inspect.getsource(g)
        for schema in ("api", "dam", "hts_rag", "archive", "public"):
            self.assertIn(f"'{schema}'", src.split("sandbox dependency catalog is missing")[0].rsplit("statement = ", 1)[1])

    def test_unreadable_or_malformed_catalog_refuses(self):
        for rows in (
            [],
            {},
            [{"name": "dflow.sample"}],
            self.snapshot("auth.sample"),
            self.snapshot("dflow.sample", "dflow.sample"),
            self.snapshot("dflow.sample") + [{"name": None, "dflow_prod_present": True}],
        ):
            with self.subTest(rows=rows), self.assertRaises(GuardError):
                self.read(rows=rows)

    def test_missing_dependency_still_refuses_and_live_proof_rescues_only_present_one(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            creator, change = root / "base.sql", root / "change.sql"
            creator.write_text("CREATE TABLE dflow.sample(id int);")
            change.write_text("ALTER TABLE dflow.sample ADD COLUMN quantity int;")
            migrations = {"20260101000000": creator, "20260102000000": change}
            with self.assertRaises(GuardError):
                preflight_batch(migrations, ["20260102000000"], set())
            relations, _ = self.read()
            preflight_batch(migrations, ["20260102000000"], set(), relations)
            change.write_text("DROP TABLE dflow.sample; ALTER TABLE dflow.sample ADD COLUMN quantity int;")
            with self.assertRaises(GuardError):
                preflight_batch(migrations, ["20260102000000"], set(), relations)

    def test_6356_live_function_rescues_check_constraint_dependency(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            creator, change = root / "base.sql", root / "change.sql"
            creator.write_text("CREATE FUNCTION core.norm(t text) RETURNS text LANGUAGE sql AS $$ select t $$;")
            change.write_text("CREATE TABLE core.thing(name text, CONSTRAINT c CHECK (length(core.norm(name)) > 0));")
            migrations = {"20260101000000": creator, "20260102000000": change}
            with self.assertRaises(GuardError):
                preflight_batch(migrations, ["20260102000000"], set())
            relations, _ = self.read(rows=self.snapshot("core.norm"))
            preflight_batch(migrations, ["20260102000000"], set(), relations)

    def test_6155_pre_ledger_core_relation_is_rescued_only_when_live(self):
        # #6107 sandbox dry-run 43249834351: core.licensor exists on the sandbox but
        # its creator predates the sandbox ledger. Live proof rescues it; absence still refuses.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            creator, change = root / "base.sql", root / "change.sql"
            creator.write_text("CREATE TABLE core.licensor(id uuid primary key);")
            change.write_text("ALTER TABLE core.licensor ADD COLUMN IF NOT EXISTS nickname text;")
            migrations = {"20260101000000": creator, "20260102000000": change}
            relations, _ = self.read(rows=self.snapshot("core.licensor", "plm.x"))
            preflight_batch(migrations, ["20260102000000"], set(), relations)
            relations, _ = self.read(rows=self.snapshot("core.customer"))
            with self.assertRaisesRegex(GuardError, "missing core.licensor"):
                preflight_batch(migrations, ["20260102000000"], set(), relations)

    def test_only_an_explicit_optional_alter_can_skip_the_verified_absent_schema(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            creator, change = root / "base.sql", root / "change.sql"
            creator.write_text(
                "CREATE TABLE dflow_prod.grid_cell_notes(id int); "
                "CREATE TABLE dflow_prod.required_ref(id int); "
                "CREATE TABLE plm.required_ref(id int);"
            )
            version = "20260102000000"
            migrations = {"20260101000000": creator, version: change}
            optional = "ALTER TABLE IF EXISTS dflow_prod.grid_cell_notes ADD COLUMN author_id int;"
            change.write_text(optional)
            relations, absent = self.read()
            preflight_batch(migrations, [version], set(), relations, sandbox_dflow_prod_absent=absent)
            with self.assertRaisesRegex(GuardError, "missing dflow_prod.grid_cell_notes"):
                preflight_batch(migrations, [version], set())

            relations, absent = self.read(rows=self.snapshot("dflow.sample", dflow_prod_present=True))
            with self.assertRaisesRegex(GuardError, "missing dflow_prod.grid_cell_notes"):
                preflight_batch(migrations, [version], set(), relations, sandbox_dflow_prod_absent=absent)

            cases = (
                (optional.replace(" IF EXISTS", ""), "dflow_prod.grid_cell_notes"),
                (optional.replace("dflow_prod.grid_cell_notes", "plm.required_ref"), "plm.required_ref"),
                (optional.replace("int;", "int REFERENCES dflow_prod.required_ref(id);"), "dflow_prod.required_ref"),
            )
            relations, absent = self.read()
            for sql, missing in cases:
                with self.subTest(sql=sql), self.assertRaisesRegex(GuardError, f"missing {missing}"):
                    change.write_text(sql)
                    preflight_batch(migrations, [version], set(), relations, sandbox_dflow_prod_absent=absent)


if __name__ == "__main__":
    unittest.main()
