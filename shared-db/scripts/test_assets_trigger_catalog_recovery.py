"""Offline verification-only recovery coverage for shared-db #5609."""
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from production_catalog_verification import CATALOG_CONTRACTS, load_behavior_sidecars, verify
from production_migration_guard import local_migrations

ROOT = Path(__file__).resolve().parent.parent
VERSION = '20261105033827'

class AssetsTriggerCatalogRecoveryTests(unittest.TestCase):
    def test_hash_bound_sidecar_covers_exact_original_trigger_set(self):
        migrations = local_migrations(ROOT)
        checks = load_behavior_sidecars(ROOT, migrations, [VERSION])
        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0]['kind'], 'catalog_contract')
        contract = CATALOG_CONTRACTS[checks[0]['contract']]
        source = migrations[VERSION].read_text()
        expected = set(re.findall(r'create trigger (\w+)', source, re.I))
        actual = set(re.findall(r"\('(trg_\w+)'", contract))
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), 10)
        for constraint in ["count(*)=10", "to_regclass('public.assets')", "t.tgenabled='O'", 'NOT t.tgisinternal', 'NOT t.tgdeferrable', 'NOT t.tginitdeferred', 't.tgnargs=0', "t.tgattr=''::int2vector", 't.tgtype=expected.event_type', 't.tgfoid=to_regprocedure(expected.signature)', 'pg_get_triggerdef(t.oid,false)', '=expected.definition_md5']:
            self.assertIn(constraint, contract)
        self.assertNotRegex(contract, r'(?i)\b(create|alter|drop|update|insert|delete)\b')

    def test_empty_static_target_migration_requires_successful_named_contract(self):
        for result in (1, 0, None):
            rows = [] if result is None else [{'id': 'assets_update_trigger_scoping_exact', 'actual_count': result, 'expected_count': 1}]
            with self.subTest(result=result), tempfile.TemporaryDirectory() as tmp, mock.patch('production_catalog_verification.run_query', return_value=[{'report': {'behavior_checks': rows}}]), mock.patch('sys.stdout', new=io.StringIO()):
                status = verify(ROOT, VERSION, Path(tmp), 'synthetic-project', 'synthetic-token', True)
                self.assertEqual(status, 0 if result == 1 else 1)
                payload = json.loads((Path(tmp) / 'production-catalog-verification.json').read_text())
                if result == 1:
                    self.assertEqual(payload['errors'], [])
