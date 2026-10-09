"""Isolated PG16 regression; never connects to production or reads credentials."""
import os
import re
from pathlib import Path
import subprocess
import time
import unittest
import uuid
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20261009040550_dflow_users_email_ci_unique_forward.sql'
CONTRACT = ROOT / 'supabase/tests/dflow_users_email_ci_unique_contracts.sql'


@unittest.skipUnless(os.environ.get('PROOF4060_TEST_PORT') or os.environ.get('RUN_4060_PG16') == '1', 'explicit owned localhost PG16 fixture required')
class ForwardMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = os.environ.get('PROOF4060_TEST_PORT')
        if cls.port:
            import psycopg
            cls.fixture_container = os.environ.get('PROOF4060_TEST_CONTAINER', '')
            if not re.fullmatch(r'[0-9a-f]{64}', cls.fixture_container):
                raise ValueError('hosted fixture requires exact ephemeral container ID')
            cls.port = int(cls.port)
            if not 1 <= cls.port <= 65535:
                raise ValueError('invalid owned localhost fixture port')
            cls.connect = staticmethod(lambda database: psycopg.connect(
                host='127.0.0.1', port=cls.port, dbname=database, user='proof_admin',
                autocommit=True, connect_timeout=5))
            with cls.connect('postgres') as connection:
                if connection.execute('SHOW server_version_num').fetchone()[0][:2] != '16':
                    raise RuntimeError('owned fixture must be PostgreSQL16')
            return
        cls.container = 'codex-4060-pg16-' + uuid.uuid4().hex[:12]
        started = subprocess.run(['docker', 'run', '--detach', '--network', 'none', '--name', cls.container,
                                  '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16'], check=True, capture_output=True, text=True)
        cls.fixture_container = started.stdout.strip()
        if not re.fullmatch(r'[0-9a-f]{64}', cls.fixture_container):
            raise ValueError('local fixture returned invalid container ID')
        cls.addClassCleanup(lambda: subprocess.run(['docker', 'rm', '-f', cls.container], check=True, capture_output=True))
        for _ in range(60):
            ready = subprocess.run(['docker', 'exec', cls.container, 'pg_isready', '-U', 'postgres'], capture_output=True)
            if ready.returncode == 0:
                return
            time.sleep(.25)
        raise RuntimeError('isolated PostgreSQL did not become ready')

    def sql(self, text, database=None):
        if self.port:
            try:
                with self.connect(database or self.database) as connection, connection.cursor() as cursor:
                    cursor.execute(text, prepare=False)
                    result = ''
                    while True:
                        if cursor.description:
                            def value(item):
                                return 't' if item is True else 'f' if item is False else '' if item is None else str(item)
                            result = '\n'.join('|'.join(value(item) for item in row) for row in cursor.fetchall())
                        if not cursor.nextset():
                            break
                    return SimpleNamespace(returncode=0, stdout=result + ('\n' if result else ''), stderr='')
            except Exception as error:
                return SimpleNamespace(returncode=1, stdout='', stderr=str(error))
        return subprocess.run(['docker', 'exec', '-i', self.container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
                               '-U', 'postgres', '-d', database or self.database, '-At'],
                              input=text, text=True, capture_output=True)

    def setUp(self):
        self.database = 'test_' + uuid.uuid4().hex
        self.assertEqual(self.sql('CREATE DATABASE ' + self.database, 'postgres').returncode, 0)
        self.addCleanup(lambda: self.assert_success(self.sql('DROP DATABASE ' + self.database, 'postgres')))
        self.assertEqual(self.sql('CREATE SCHEMA dflow; CREATE TABLE dflow.users(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,name text,email text); INSERT INTO dflow.users(name,email) VALUES (\'existing\',\'existing@example.test\');').returncode, 0)

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)

    def assert_preserved(self):
        self.assertEqual(self.sql('SELECT count(*) FROM ONLY dflow.users').stdout.strip(), '1')
        self.assertEqual(self.sql("SELECT name || ':' || email FROM ONLY dflow.users").stdout.strip(), 'existing:existing@example.test')

    def test_correct_source_and_behavior_rollback_preserve_users(self):
        self.assert_success(self.sql(MIGRATION.read_text()))
        sequence_before = self.sql('SELECT last_value,is_called FROM dflow.users_id_seq').stdout
        self.assert_success(self.sql(CONTRACT.read_text()))
        self.assertEqual(self.sql('SELECT last_value,is_called FROM dflow.users_id_seq').stdout, sequence_before)
        self.assert_preserved()
        self.assert_success(self.sql("INSERT INTO dflow.users(name,email) VALUES ('normal','normal@example.test')"))
        rejected = self.sql("INSERT INTO dflow.users(name,email) VALUES ('duplicate',' EXISTING@EXAMPLE.TEST ')")
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('users_email_lower_uidx', rejected.stderr)
        self.assertEqual(self.sql('SELECT count(*) FROM ONLY dflow.users').stdout.strip(), '2')

    def test_varchar_absent_apply_behavior_and_drop_recovery_preserve_users(self):
        self.assert_success(self.sql('ALTER TABLE dflow.users ALTER COLUMN email TYPE varchar(255)'))
        sequence_before = self.sql('SELECT last_value,is_called FROM dflow.users_id_seq').stdout
        self.assert_success(self.sql(MIGRATION.read_text()))
        self.assert_success(self.sql(CONTRACT.read_text()))
        self.assert_preserved()
        self.assertEqual(self.sql('SELECT last_value,is_called FROM dflow.users_id_seq').stdout, sequence_before)
        self.assert_success(self.sql('BEGIN; DROP INDEX dflow.users_email_lower_uidx; COMMIT;'))
        self.assertEqual(self.sql("SELECT to_regclass('dflow.users_email_lower_uidx') IS NULL").stdout.strip(), 't')
        self.assert_preserved()
        self.assertEqual(self.sql('SELECT last_value,is_called FROM dflow.users_id_seq').stdout, sequence_before)
        self.assert_success(self.sql("BEGIN; INSERT INTO dflow.users(id,name,email) OVERRIDING SYSTEM VALUE VALUES(-406040,'recovery',' EXISTING@EXAMPLE.TEST '); ROLLBACK;"))
        self.assert_preserved()

    def test_absent_index_nondeterministic_or_nondefault_column_collation_refuses(self):
        self.assert_success(self.sql('ALTER TABLE dflow.users ALTER COLUMN email TYPE text COLLATE "C"'))
        result = self.sql(MIGRATION.read_text())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('builtin default deterministic collation', result.stderr)
        self.assertEqual(self.sql("SELECT to_regclass('dflow.users_email_lower_uidx') IS NULL").stdout.strip(), 't')
        self.assert_preserved()

    def test_tablespaced_existing_index_refuses(self):
        created = subprocess.run(['docker', 'exec', self.fixture_container, 'mktemp', '-d'], check=True, capture_output=True, text=True)
        directory = created.stdout.strip()
        if not re.fullmatch(r'/tmp/tmp\.[A-Za-z0-9]+', directory):
            raise ValueError('ephemeral mktemp returned unsafe directory')
        subprocess.run(['docker', 'exec', self.fixture_container, 'chown', 'postgres:postgres', directory], check=True, capture_output=True)
        tablespace = 'space_' + uuid.uuid4().hex
        self.assert_success(self.sql("CREATE TABLESPACE " + tablespace + " LOCATION '" + directory + "'", 'postgres'))
        try:
            self.assert_success(self.sql("CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email))) TABLESPACE " + tablespace + " WHERE nullif(btrim(email),'') IS NOT NULL"))
            before = self.sql("SELECT pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout
            result = self.sql(MIGRATION.read_text())
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('exact contract refused', result.stderr)
            self.assertNotEqual(self.sql(CONTRACT.read_text()).returncode, 0)
            self.assertEqual(self.sql("SELECT pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout, before)
            self.assert_preserved()
        finally:
            self.assert_success(self.sql('DROP INDEX IF EXISTS dflow.users_email_lower_uidx'))
            self.assert_success(self.sql('DROP TABLESPACE ' + tablespace, 'postgres'))
            subprocess.run(['docker', 'exec', self.fixture_container, 'rmdir', '--', directory], check=True, capture_output=True)

    def test_wrong_index_between_precheck_and_create_is_rejected_by_postcheck(self):
        source = MIGRATION.read_text()
        marker = 'CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx'
        raced = source.replace(marker, 'CREATE INDEX users_email_lower_uidx ON dflow.users(email);\n' + marker, 1)
        self.assertNotEqual(raced, source)
        result = self.sql(raced)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('exact post-create contract refused', result.stderr)
        self.assertEqual(self.sql("SELECT to_regclass('dflow.users_email_lower_uidx') IS NULL").stdout.strip(), 't')
        self.assert_preserved()

    def test_duplicate_without_constraint_diagnostic_is_not_swallowed(self):
        self.assert_success(self.sql(MIGRATION.read_text()))
        self.assert_success(self.sql("CREATE FUNCTION dflow.fake_duplicate() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id=-406002 THEN RAISE unique_violation; END IF; RETURN NEW; END$$; CREATE TRIGGER fake_duplicate BEFORE INSERT ON dflow.users FOR EACH ROW EXECUTE FUNCTION dflow.fake_duplicate();"))
        result = self.sql(CONTRACT.read_text())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unexpected duplicate constraint', result.stderr)
        self.assert_preserved()

    def test_nondeterministic_column_collation_refuses_before_creation(self):
        self.assert_success(self.sql("CREATE COLLATION dflow.nondeterministic (provider=icu,locale='und',deterministic=false); ALTER TABLE dflow.users ALTER COLUMN email TYPE text COLLATE dflow.nondeterministic;"))
        result = self.sql(MIGRATION.read_text())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('builtin default deterministic collation', result.stderr)
        self.assertEqual(self.sql("SELECT to_regclass('dflow.users_email_lower_uidx') IS NULL").stdout.strip(), 't')
        self.assert_preserved()

    def test_concurrent_wrong_index_between_precheck_and_create_is_rejected(self):
        if not self.port:
            self.skipTest('real two-connection race executes on the hosted localhost service adapter')
        source = MIGRATION.read_text()
        pre, after = source.split('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx', 1)
        after = 'CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx' + after
        with self.connect(self.database) as application:
            application.execute(pre, prepare=False)
            try:
                with self.connect(self.database) as competitor:
                    competitor.execute("SET statement_timeout='5s'; CREATE INDEX users_email_lower_uidx ON dflow.users(email);", prepare=False)
                with self.assertRaisesRegex(Exception, 'exact post-create contract refused'):
                    application.execute(after, prepare=False)
            finally:
                application.execute('ROLLBACK')
        self.assert_preserved()
        self.assertEqual(self.sql("SELECT pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout.strip(), 'CREATE INDEX users_email_lower_uidx ON dflow.users USING btree (email)')

    def test_historical_preview_then_forward_preserves_exact_index_and_users(self):
        old = ROOT / 'supabase/migrations/20261007232712_dflow_users_email_ci_unique.sql'
        self.assert_success(self.sql(old.read_text()))
        fingerprint = "SELECT i.indexrelid, pg_get_indexdef(i.indexrelid),obj_description(i.indexrelid,'pg_class') FROM pg_index i WHERE i.indexrelid='dflow.users_email_lower_uidx'::regclass"
        before = self.sql(fingerprint).stdout
        sequence_before = self.sql('SELECT last_value,is_called FROM dflow.users_id_seq').stdout
        self.assert_success(self.sql(MIGRATION.read_text()))
        self.assertEqual(self.sql(fingerprint).stdout, before)
        self.assertEqual(self.sql('SELECT last_value,is_called FROM dflow.users_id_seq').stdout, sequence_before)
        self.assert_preserved()
        self.assert_success(self.sql(CONTRACT.read_text()))
        self.assert_preserved()

    def test_varchar_historical_preview_then_forward_preserves_index(self):
        self.assert_success(self.sql('ALTER TABLE dflow.users ALTER COLUMN email TYPE varchar(255)'))
        old = ROOT / 'supabase/migrations/20261007232712_dflow_users_email_ci_unique.sql'
        self.assert_success(self.sql(old.read_text()))
        fingerprint = "SELECT i.indexrelid, pg_get_indexdef(i.indexrelid),obj_description(i.indexrelid,'pg_class') FROM pg_index i WHERE i.indexrelid='dflow.users_email_lower_uidx'::regclass"
        before = self.sql(fingerprint).stdout
        self.assert_success(self.sql(MIGRATION.read_text()))
        self.assertEqual(self.sql(fingerprint).stdout, before)
        self.assert_success(self.sql(CONTRACT.read_text()))
        self.assert_preserved()

    def test_varchar_wrong_normalization_refuses(self):
        self.assert_success(self.sql('ALTER TABLE dflow.users ALTER COLUMN email TYPE varchar(255)'))
        for expression in ['lower(email)', 'btrim(email)']:
            with self.subTest(expression=expression):
                self.assert_success(self.sql("CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(" + expression + ") WHERE nullif(btrim(email),'') IS NOT NULL"))
                result = self.sql(MIGRATION.read_text())
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('exact contract refused', result.stderr)
                self.assertNotEqual(self.sql(CONTRACT.read_text()).returncode, 0)
                self.assert_preserved()
                self.assert_success(self.sql('DROP INDEX dflow.users_email_lower_uidx'))

    def test_nonbuiltin_text_domain_refuses_before_rows(self):
        self.assert_success(self.sql('CREATE DOMAIN dflow.custom_email AS text; ALTER TABLE dflow.users ALTER COLUMN email TYPE dflow.custom_email'))
        for existing in [False, True]:
            with self.subTest(existing_index=existing):
                if existing:
                    self.assert_success(self.sql("CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email))) WHERE nullif(btrim(email),'') IS NOT NULL"))
                result = self.sql(MIGRATION.read_text())
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('email must be builtin text or varchar', result.stderr)
                self.assert_preserved()

    def test_exact_existing_forward_replay_is_noop(self):
        self.assert_success(self.sql(MIGRATION.read_text()))
        before = self.sql("SELECT 'dflow.users_email_lower_uidx'::regclass::oid,pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout
        self.assert_success(self.sql(MIGRATION.read_text()))
        self.assertEqual(self.sql("SELECT 'dflow.users_email_lower_uidx'::regclass::oid,pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout, before)
        self.assert_preserved()

    def test_mismatched_existing_index_refuses(self):
        indexes = [
            'CREATE INDEX users_email_lower_uidx ON dflow.users(email)',
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(email))',
        ]
        for definition in indexes:
            with self.subTest(definition=definition):
                self.assert_success(self.sql(definition))
                before = self.sql("SELECT pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout
                result = self.sql(MIGRATION.read_text())
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('existing dflow.users_email_lower_uidx exact contract refused', result.stderr)
                self.assertEqual(self.sql("SELECT pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout, before)
                self.assert_preserved()
                self.assert_success(self.sql('DROP INDEX dflow.users_email_lower_uidx'))

    def test_wrong_index_contract_refuses_before_insert(self):
        definitions = [
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(email))',
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email)))',
            'CREATE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email))) WHERE nullif(btrim(email),\'\') IS NOT NULL',
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email)) text_pattern_ops) WHERE nullif(btrim(email),\'\') IS NOT NULL',
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email)) COLLATE "C") WHERE nullif(btrim(email),\'\') IS NOT NULL',
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email))) WITH (fillfactor=80) WHERE nullif(btrim(email),\'\') IS NOT NULL',
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email)) DESC) WHERE nullif(btrim(email),\'\') IS NOT NULL',
            'CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email))) INCLUDE(name) WHERE nullif(btrim(email),\'\') IS NOT NULL',
        ]
        for definition in definitions:
            with self.subTest(definition=definition):
                self.assert_success(self.sql(definition))
                definition_before = self.sql("SELECT pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout
                migration_result = self.sql(MIGRATION.read_text())
                self.assertNotEqual(migration_result.returncode, 0)
                self.assertIn('existing dflow.users_email_lower_uidx exact contract refused', migration_result.stderr)
                self.assertEqual(self.sql("SELECT pg_get_indexdef('dflow.users_email_lower_uidx'::regclass)").stdout, definition_before)
                result = self.sql(CONTRACT.read_text())
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('exact normalized nonblank index contract refused', result.stderr)
                self.assert_preserved()
                self.assert_success(self.sql('DROP INDEX dflow.users_email_lower_uidx'))

    def test_duplicate_groups_refuse_without_index_or_row_rewrite(self):
        self.assert_success(self.sql("INSERT INTO dflow.users(name,email) VALUES ('duplicate',' EXISTING@EXAMPLE.TEST ');"))
        result = self.sql(MIGRATION.read_text())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('case-insensitive duplicate email group', result.stderr)
        self.assertEqual(self.sql("SELECT to_regclass('dflow.users_email_lower_uidx') IS NULL").stdout.strip(), 't')
        self.assertEqual(self.sql('SELECT count(*) FROM ONLY dflow.users').stdout.strip(), '2')

    def test_inheritance_refuses_before_rows_or_index(self):
        self.assert_success(self.sql('CREATE TABLE dflow.child() INHERITS(dflow.users)'))
        result = self.sql(MIGRATION.read_text())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('inheritance is unsupported', result.stderr)
        self.assertEqual(self.sql("SELECT to_regclass('dflow.users_email_lower_uidx') IS NULL").stdout.strip(), 't')
        self.assert_preserved()


class SourceDeliveryContractTests(unittest.TestCase):
    def test_canonical_catalog_derives_exact_real_index_and_table(self):
        from production_catalog_verification import derive_targets
        targets = derive_targets({'20261009040550': MIGRATION}, ['20261009040550'])
        self.assertEqual(targets.indexes, [('dflow.users_email_lower_uidx', 'dflow.users')])
        self.assertEqual(targets.tables, ['dflow.users'])

    def test_existing_ephemeral_workflow_executes_regressions_without_skip(self):
        source = (ROOT / '.github/workflows/shared-db-4060-observation.yml').read_text()
        self.assertIn('python -m unittest discover -s scripts -p test_dflow_users_email_ci_unique_forward.py -v', source)
        step = source.split('name: Run 4060 source apply and refusal regressions', 1)[1].split('  observe:', 1)[0]
        self.assertIn("PROOF4060_TEST_PORT: '5432'", step)
        self.assertIn('PROOF4060_TEST_CONTAINER: ${{ job.services.postgres.id }}', step)
        self.assertNotIn('secrets.', step)
