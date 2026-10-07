"""Fail-before-apply regression checks and opt-in isolated PostgreSQL proofs."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_production_verification_sidecars import check, has_guarded_static_table_ddl
from production_catalog_verification import CATALOG_CONTRACTS, GuardError


class GuardedStaticDDLTests(unittest.TestCase):
    def test_real_guarded_alter_is_detected(self):
        self.assertTrue(has_guarded_static_table_ddl('DO $guard$ BEGIN ALTER TABLE app.t DROP CONSTRAINT x; END $guard$;'))

    def test_comments_literals_and_callable_routines_are_not_apply_ddl(self):
        for sql in ["-- DO $$ ALTER TABLE app.t; $$", "DO $$ BEGIN PERFORM 'ALTER TABLE app.t'; END $$;", "DO $$ BEGIN /* ALTER TABLE app.t; */ PERFORM 1; END $$;", "CREATE FUNCTION public.x() RETURNS void AS $$ BEGIN ALTER TABLE app.t DROP CONSTRAINT x; END $$ LANGUAGE plpgsql;", "CREATE FUNCTION public.x() RETURNS void AS $fn$ BEGIN PERFORM 'DO $$ BEGIN ALTER TABLE app.t DROP CONSTRAINT x; END $$'; END $fn$ LANGUAGE plpgsql;"]:
            with self.subTest(sql=sql):
                self.assertFalse(has_guarded_static_table_ddl(sql))

    def fixture(self, kind=None, wrong_hash=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'supabase/migrations').mkdir(parents=True)
        (root / 'scripts/production-verification-sidecars').mkdir(parents=True)
        (root / 'config').mkdir()
        version = '20260101000000'
        sql = 'DO $$ BEGIN ALTER TABLE app.t DROP CONSTRAINT x; END $$;'
        (root / f'supabase/migrations/{version}_fixture.sql').write_text(sql)
        declared = []
        if kind:
            item = {'id': 'fixture', 'kind': kind, 'expected_count': 1}
            if kind == 'catalog_contract':
                item['contract'] = 'designflow_remaining_user_fks_v1'
            else:
                item.update(relation='information_schema.columns', filters=[{'column': 'table_schema', 'type': 'text', 'equals': 'app'}])
            sidecar = {'schema_version': 1, 'migration_version': version, 'migration_sha256': '0' * 64 if wrong_hash else hashlib.sha256(sql.encode()).hexdigest(), 'checks': [item]}
            (root / f'scripts/production-verification-sidecars/{version}.json').write_text(json.dumps(sidecar))
            declared = [{'version': version, 'issue': 3907}]
        (root / 'config/production-verification-sidecar-registry.json').write_text(json.dumps({'schema_version': 1, 'sidecars': declared}))
        return root, version

    def test_missing_contract_refuses_before_apply(self):
        root, version = self.fixture()
        with self.assertRaisesRegex(GuardError, 'guarded static ALTER TABLE'):
            check(root, [version])

    def test_generic_row_count_cannot_substitute_for_exact_catalog_contract(self):
        root, version = self.fixture('exact_row_count')
        with self.assertRaisesRegex(GuardError, 'guarded static ALTER TABLE'):
            check(root, [version])

    def test_registered_hash_bound_contract_passes(self):
        root, version = self.fixture('catalog_contract')
        self.assertEqual(check(root, [version])['status'], 'OK')

    def test_changed_migration_bytes_refuse(self):
        root, version = self.fixture('catalog_contract', wrong_hash=True)
        with self.assertRaises(GuardError):
            check(root, [version])


@unittest.skipUnless(os.environ.get('SHARED_DB_FK_CATALOG_TEST_CONTAINER') and os.environ.get('SHARED_DB_FK_CATALOG_TEST_OWNER'), 'isolated owned PostgreSQL fixture not requested')
class PostgreSQLForeignKeyContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = os.environ['SHARED_DB_FK_CATALOG_TEST_CONTAINER']
        info = json.loads(subprocess.check_output(['docker', 'inspect', cls.container], text=True))[0]
        assert info['Config']['Labels'].get('codex.owner') == os.environ['SHARED_DB_FK_CATALOG_TEST_OWNER']
        assert info['HostConfig']['NetworkMode'] == 'none' and not info['HostConfig']['PortBindings']

    def sql(self, sql):
        return subprocess.check_output(['docker', 'exec', '-i', self.container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True).strip()

    def setUp(self):
        self.sql('''DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS plm CASCADE; DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS dflow CASCADE;
        CREATE SCHEMA app; CREATE SCHEMA plm; CREATE SCHEMA core; CREATE SCHEMA dflow;
        CREATE TABLE app.users(id integer PRIMARY KEY); CREATE TABLE dflow.users(id integer PRIMARY KEY, other_id integer UNIQUE);
        CREATE TABLE app."RolePermissions"("UserId" integer, other_id integer, CONSTRAINT "RolePermissions_UserId_fkey" FOREIGN KEY("UserId") REFERENCES dflow.users(id));
        CREATE TABLE plm.art_piece_attachment(created_by integer, updated_by integer, CONSTRAINT art_piece_attachment_created_by_fkey FOREIGN KEY(created_by) REFERENCES dflow.users(id), CONSTRAINT art_piece_attachment_updated_by_fkey FOREIGN KEY(updated_by) REFERENCES dflow.users(id));
        CREATE TABLE core."merchGroup"(mg_id integer PRIMARY KEY); CREATE TABLE core.artist_types(id integer PRIMARY KEY); CREATE TABLE plm."divisionCode"("divCode_id" integer PRIMARY KEY);
        CREATE TABLE dflow."merchGroup"(mg_id integer PRIMARY KEY); CREATE TABLE dflow.artist_types(id integer PRIMARY KEY); CREATE TABLE dflow."divisionCode"("divCode_id" integer PRIMARY KEY);
        CREATE TABLE dflow.artists(art_source_id integer, artist_type_id integer, divisioncode_id integer, CONSTRAINT artists_art_source_id_fkey FOREIGN KEY(art_source_id) REFERENCES core."merchGroup"(mg_id), CONSTRAINT artists_artist_type_id_fkey FOREIGN KEY(artist_type_id) REFERENCES core.artist_types(id), CONSTRAINT artists_divisioncode_id_fkey FOREIGN KEY(divisioncode_id) REFERENCES plm."divisionCode"("divCode_id"));''')

    def verdict(self, family):
        return self.sql('SELECT (' + CATALOG_CONTRACTS[family] + ');')

    def test_correct_families_pass_and_missing_each_relationship_fails(self):
        for family, table, names in [('designflow_remaining_user_fks_v1', 'plm.art_piece_attachment', ['art_piece_attachment_created_by_fkey', 'art_piece_attachment_updated_by_fkey']), ('designflow_artist_parent_fks_v1', 'dflow.artists', ['artists_art_source_id_fkey', 'artists_artist_type_id_fkey', 'artists_divisioncode_id_fkey']), ('designflow_remaining_user_fks_v1', 'app."RolePermissions"', ['RolePermissions_UserId_fkey'])]:
            self.assertEqual(self.verdict(family), 't')
            for name in names:
                # Perform the mutation and probe in one session, then rollback.
                result = self.sql(f'BEGIN; ALTER TABLE {table} DROP CONSTRAINT "{name}"; SELECT ({CATALOG_CONTRACTS[family]}); ROLLBACK;')
                self.assertEqual(result, 'f')

    def test_user_wrong_parent_column_action_validation_and_deferral_fail(self):
        for definition in ['FOREIGN KEY("UserId") REFERENCES app.users(id)', 'FOREIGN KEY(other_id) REFERENCES dflow.users(id)', 'FOREIGN KEY("UserId") REFERENCES dflow.users(other_id)', 'FOREIGN KEY("UserId") REFERENCES dflow.users(id) ON DELETE CASCADE', 'FOREIGN KEY("UserId") REFERENCES dflow.users(id) NOT VALID', 'FOREIGN KEY("UserId") REFERENCES dflow.users(id) DEFERRABLE INITIALLY DEFERRED']:
            result = self.sql('BEGIN; ALTER TABLE app."RolePermissions" DROP CONSTRAINT "RolePermissions_UserId_fkey"; ALTER TABLE app."RolePermissions" ADD CONSTRAINT "RolePermissions_UserId_fkey" ' + definition + '; SELECT (' + CATALOG_CONTRACTS['designflow_remaining_user_fks_v1'] + '); ROLLBACK;')
            self.assertEqual(result, 'f', definition)

    def test_artist_each_original_parent_fails(self):
        for name, column, parent, key in [('artists_art_source_id_fkey', 'art_source_id', 'dflow."merchGroup"', 'mg_id'), ('artists_artist_type_id_fkey', 'artist_type_id', 'dflow.artist_types', 'id'), ('artists_divisioncode_id_fkey', 'divisioncode_id', 'dflow."divisionCode"', 'divCode_id')]:
            result = self.sql(f'BEGIN; ALTER TABLE dflow.artists DROP CONSTRAINT {name}; ALTER TABLE dflow.artists ADD CONSTRAINT {name} FOREIGN KEY({column}) REFERENCES {parent}("{key}"); SELECT ({CATALOG_CONTRACTS["designflow_artist_parent_fks_v1"]}); ROLLBACK;')
            self.assertEqual(result, 'f')


if __name__ == '__main__':
    unittest.main()
