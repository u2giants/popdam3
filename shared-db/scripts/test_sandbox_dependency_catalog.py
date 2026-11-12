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
    def read(self, rows=None, ledger="sandbox", target="xupnyeifmpsacrqahwwm", returned=None):
        query = Mock(return_value=rows if rows is not None else [{"name": "dflow.sample"}])
        fetch = Mock(return_value={"id": returned or target})
        result = read_sandbox_dependencies(ledger, target, "test-token", query, fetch)
        query.assert_called_once()
        return result

    def test_catalog_proves_existing_relation(self):
        self.assertEqual(self.read(), frozenset({"dflow.sample"}))

    def test_management_query_is_read_only_and_follows_identity_proof(self):
        response = MagicMock()
        response.__enter__.return_value.read.side_effect = [
            b'{"id":"xupnyeifmpsacrqahwwm"}', b'[{"name":"dflow.sample"}]']
        with patch("production_migration_guard.urllib.request.urlopen", return_value=response) as send:
            result = read_sandbox_dependencies("sandbox", "xupnyeifmpsacrqahwwm", "test-token")
        self.assertEqual(result, frozenset({"dflow.sample"}))
        identity, query = [call.args[0] for call in send.call_args_list]
        self.assertEqual(identity.get_method(), "GET")
        self.assertEqual(query.full_url, identity.full_url + "/database/query")
        self.assertEqual(query.get_method(), "POST")
        self.assertIs(json.loads(query.data)["read_only"], True)

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

    def test_unreadable_or_malformed_catalog_refuses(self):
        for rows in ([], {}, [{"name": "public.sample"}], [{"name": "dflow.sample"}] * 2):
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
            preflight_batch(migrations, ["20260102000000"], set(), self.read())
            change.write_text("DROP TABLE dflow.sample; ALTER TABLE dflow.sample ADD COLUMN quantity int;")
            with self.assertRaises(GuardError):
                preflight_batch(migrations, ["20260102000000"], set(), self.read())

    def test_6155_pre_ledger_core_relation_is_rescued_only_when_live(self):
        # #6107 sandbox dry-run 43249834351: core.licensor exists on the sandbox but
        # its creator predates the sandbox ledger. Live proof rescues it; absence still refuses.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            creator, change = root / "base.sql", root / "change.sql"
            creator.write_text("CREATE TABLE core.licensor(id uuid primary key);")
            change.write_text("ALTER TABLE core.licensor ADD COLUMN IF NOT EXISTS nickname text;")
            migrations = {"20260101000000": creator, "20260102000000": change}
            preflight_batch(migrations, ["20260102000000"], set(),
                            self.read(rows=[{"name": "core.licensor"}, {"name": "plm.x"}]))
            with self.assertRaises(GuardError):
                preflight_batch(migrations, ["20260102000000"], set(),
                                self.read(rows=[{"name": "core.customer"}]))


if __name__ == "__main__":
    unittest.main()
