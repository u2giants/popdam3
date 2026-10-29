"""Offline integration of the fixed #4427 contract with the existing verifier."""
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from production_catalog_verification import CATALOG_CONTRACTS, build_behavior_sql, load_behavior_sidecars
from production_migration_guard import GuardError

ROOT = Path(__file__).resolve().parents[1]
VERSION = '20261021190604'
MIGRATION = ROOT / 'supabase/migrations/20261021190604_public_admin_rls_initplans.sql'
CONTRACT = CATALOG_CONTRACTS['rls_public_admin_install_v1']


class AdminCatalogRecoveryTests(unittest.TestCase):
    def test_complete_original_snapshot_and_all_existing_checks_are_preserved(self):
        # Remove ONLY the narrowly inserted composition CTE; everything else
        # must equal the original immutable installed-catalog probe byte for byte.
        normalized = re.sub(r"'((?:''|[^'])*)'::jsonb", lambda m: '$baseline$' + m[1].replace("''", "'") + '$baseline$::jsonb' if m[1].startswith('[{') else m[0], CONTRACT)
        start = normalized.index('), expected_policies AS (')
        end = normalized.index('), expected_tables AS (', start)
        restored = (normalized[:start] + normalized[end:]).strip().replace(
            'WITH original_expected_policies AS (', 'WITH expected_policies AS (', 1)
        # Immutable original probe baseline remains independently pinned after repair.
        self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(), '32fa4afed5690359d851fd6588c881871345669afc65b8fc4f27429cddd7d2fd')
        snapshots = [json.loads(x) for x in re.findall(r'\$baseline\$([\s\S]*?)\$baseline\$::jsonb', normalized)]
        self.assertEqual([len(x) for x in snapshots], [72, 39, 2])
        self.assertIn('where version=\'20261021190604\'', CONTRACT)
        for proof in ['policy_proof', 'table_proof', 'helper_proof', 'archive_proof']:
            self.assertIn('(select passed from ' + proof + ')', CONTRACT)

    def test_only_exact_known_ledger_conditioned_successor_can_compose(self):
        start = CONTRACT.index('), expected_policies AS (')
        end = CONTRACT.index('), expected_tables AS (', start)
        composition = CONTRACT[start:end]
        self.assertIn("exists(select 1 from supabase_migrations.schema_migrations where version='20261023122936')", composition)
        self.assertEqual(re.findall(r"\('public','([^']+)','([^']+)'\)", composition), [
            ('app_access', 'Users read own app_access'),
            ('profiles', 'Users read own profile'),
            ('profiles', 'Users update own profile')])
        expression = "(user_id = ( SELECT auth.uid() AS uid))"
        self.assertIn("then '" + expression + "' else e.qual end as qual", composition)
        successor = (ROOT / 'supabase/migrations/20261023122936_owner_uid_initplans.sql').read_text()
        for table, policy in [('app_access', 'Users read own app_access'), ('profiles', 'Users read own profile'), ('profiles', 'Users update own profile')]:
            self.assertIn('ALTER POLICY "' + policy + '" ON "public"."' + table + '"\n  USING (' + expression + ');', successor)
        self.assertIn('e.with_check,e.oid from original_expected_policies e', composition)

    def synthetic_sidecar(self, root):
        folder = root / 'scripts/production-verification-sidecars'
        folder.mkdir(parents=True)
        value = dict(schema_version=1, migration_version=VERSION,
            migration_sha256=hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
            checks=[dict(id='rls_public_admin_install', kind='catalog_contract',
                contract='rls_public_admin_install_v1', expected_count=1)])
        (folder / (VERSION + '.json')).write_text(json.dumps(value))
        return value

    def test_synthetic_fixture_exercises_existing_boolean_assertion_in_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.synthetic_sidecar(root)
            checks = load_behavior_sidecars(root, {VERSION: MIGRATION}, [VERSION])
            self.assertEqual(len(checks), 1)
            self.assertEqual(checks[0]['migration_sha256'], hashlib.sha256(MIGRATION.read_bytes()).hexdigest())
            self.assertEqual(checks[0]['contract'], 'rls_public_admin_install_v1')
            query = build_behavior_sql(checks)
            self.assertIn('case when (' + CONTRACT + ') then 1 else 0 end', query)
            self.assertIn('1::bigint as expected_count', query)

    def test_changed_migration_cannot_reuse_synthetic_sidecar(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.synthetic_sidecar(root)
            altered = root / MIGRATION.name
            altered.write_bytes(MIGRATION.read_bytes() + b'\n-- mutation\n')
            with self.assertRaisesRegex(GuardError, 'migration hash mismatch'):
                load_behavior_sidecars(root, {VERSION: altered}, [VERSION])

    def test_active_sidecar_is_exactly_registered_to_merged_bootstrap_contract(self):
        sidecar = json.loads((ROOT / 'scripts/production-verification-sidecars' / (VERSION + '.json')).read_text())
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(sidecar, self.synthetic_sidecar(Path(directory)))
        checks = load_behavior_sidecars(ROOT, {VERSION: MIGRATION}, [VERSION])
        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0]['contract'], 'rls_public_admin_install_v1')
        self.assertEqual(checks[0]['expected_count'], 1)
        self.assertIn('case when (' + CONTRACT + ') then 1 else 0 end', build_behavior_sql(checks))
        registry = json.loads((ROOT / 'config/production-verification-sidecar-registry.json').read_text())
        self.assertEqual([item for item in registry['sidecars'] if item['version'] == VERSION],
            [dict(version=VERSION, issue=4867)])

    def test_native_producer_probe_is_exact_existing_canonical_and_migration_unchanged(self):
        self.assertEqual(hashlib.sha256(MIGRATION.read_bytes()).hexdigest(), '436f304ae74922d3543f7da2f9b1127abf5e4050ab267314636bb5bdd9220300')
        probe = (ROOT / '.github/live-proofs/4427.sql').read_bytes()
        self.assertEqual(probe, CONTRACT.strip().encode())
        self.assertEqual(hashlib.sha256(probe).hexdigest(), '99648c0a01fcba2001490a5f29e08f7a160e2fdc5fa31e593cdefa65accfe118')
        self.assertIn("version='20261023122936'", probe.decode())


if __name__ == '__main__':
    unittest.main()
