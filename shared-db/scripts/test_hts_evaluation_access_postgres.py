"""Opt-in disposable PostgreSQL proof, never a hosted target."""
import os
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import atomic_migration_apply as atomic

@unittest.skipUnless(os.environ.get('HTS_EVALUATION_TEST_PORT'),'disposable PostgreSQL port not supplied')
class EvaluationPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.pg=psycopg
        cls.env={'PGHOST':'127.0.0.1','PGPORT':os.environ['HTS_EVALUATION_TEST_PORT'],
            'PGUSER':'postgres','PGDATABASE':'postgres','PGPASSWORD':os.environ.get('HTS_EVALUATION_TEST_PASSWORD','synthetic-local-test-only'),
            'PGSSLMODE':'disable',atomic.HTS_CREDENTIAL_ENV:'synthetic-credential-only-for-disposable-postgres-0000000000000000'}
        cls.raw=Path(os.environ.get('HTS_EVALUATION_MIGRATION_FILE','supabase/migrations/20261105121341_hts_evaluation_read_access.sql')).read_text()
    def admin(self):return atomic.credential_connection(self.env)
    def clean_fixture(self):
        # Disposable local cluster only. Issuance still runs as constrained postgres;
        # native fixture cleanup must not change the creator's bootstrap flags.
        env={**self.env,'PGUSER':os.environ.get('HTS_EVALUATION_TEST_CLEANUP_USER','postgres')}
        with atomic.credential_connection(env) as c:
            c.execute('DROP SCHEMA IF EXISTS plm CASCADE; DROP SCHEMA IF EXISTS coldlion CASCADE; DROP SCHEMA IF EXISTS dflow_prod CASCADE; DROP SCHEMA IF EXISTS supabase_migrations CASCADE;')
            for r in [atomic.HTS_CREDENTIAL_ROLE,'designflow_hts_evaluation_read','hts_evaluation_unauthorized']:
                if c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(r,)).fetchone():
                    c.execute('DROP OWNED BY '+r)
            c.execute('DROP ROLE IF EXISTS designflow_hts_evaluation_reader; DROP ROLE IF EXISTS designflow_hts_evaluation_read; DROP ROLE IF EXISTS hts_evaluation_unauthorized;')
    def setUp(self):
        self.clean_fixture()
        with self.admin() as c:
            c.execute('''CREATE SCHEMA plm; CREATE SCHEMA coldlion; CREATE SCHEMA dflow_prod; CREATE SCHEMA supabase_migrations;
            CREATE ROLE hts_evaluation_unauthorized NOLOGIN;
            CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text);
            CREATE TABLE plm.customs_benchmark_observation(dataset_id text,section text,source_ordinal int,style_number text,historical_hts text,packet_reference text,evidence_status text,exact_historical_candidate bool,original_record jsonb,product_description text);
            CREATE TABLE plm.customs_benchmark_artifact(content_sha256 text,private_verified bool,storage_key text);
            ALTER TABLE plm.customs_benchmark_observation ENABLE ROW LEVEL SECURITY;
            ALTER TABLE plm.customs_benchmark_artifact ENABLE ROW LEVEL SECURITY;
            CREATE TABLE coldlion.item_detail(item_no text,pre_pack_code text,company_code text,division_code text,item_cost numeric);
            ALTER TABLE coldlion.item_detail ENABLE ROW LEVEL SECURITY;
            CREATE TABLE dflow_prod."itemHeader"(item_id_pk int,item_num_id text);
            INSERT INTO plm.customs_benchmark_observation(style_number) VALUES ('SYNTHETIC');
            INSERT INTO plm.customs_benchmark_artifact VALUES ('test',true,'private-pointer'),('not-verified',false,'private-pointer');
            INSERT INTO coldlion.item_detail(item_no,pre_pack_code) VALUES ('SYNTHETIC','PPKTEST');''')
    def tearDown(self):
        self.clean_fixture()

    def apply(self,raw=None,env=None):
        atomic.initial_credential_apply(env or self.env,atomic.HTS_CREDENTIAL_VERSION,'hts_evaluation_read_access',raw or self.raw,atomic.split_sql(self.raw))
    def test_atomic_rollback_retry_login_reads_and_column_write_denials(self):
        with self.assertRaises(atomic.Refusal):self.apply(self.raw+"\nDO $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;")
        with self.admin() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM pg_roles WHERE rolname=%s',(atomic.HTS_CREDENTIAL_ROLE,)).fetchone(),(0,))
            self.assertEqual(c.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone(),(0,))
        self.apply()
        with atomic.credential_connection(self.env,reader=True) as c:
            self.assertEqual(c.execute('SHOW default_transaction_read_only').fetchone(),('on',))
            c.execute('SET ROLE designflow_hts_evaluation_read')
            self.assertEqual(c.execute('SELECT count(style_number) FROM plm.customs_benchmark_observation').fetchone(),(1,))
            self.assertEqual(c.execute('SELECT count(content_sha256) FROM plm.customs_benchmark_artifact').fetchone(),(1,))
            self.assertEqual(c.execute('SELECT pre_pack_code FROM coldlion.item_detail').fetchone(),('PPKTEST',))
        for sql in ['SELECT storage_key FROM plm.customs_benchmark_artifact','SELECT item_cost FROM coldlion.item_detail','UPDATE coldlion.item_detail SET pre_pack_code=NULL','INSERT INTO plm.customs_benchmark_observation(style_number) VALUES (\'NO\')']:
            with self.subTest(sql=sql),atomic.credential_connection(self.env,reader=True) as c:
                c.execute('SET ROLE designflow_hts_evaluation_read')
                with self.assertRaises(self.pg.Error):c.execute(sql)
                c.rollback()
        with atomic.credential_connection({**self.env,'PGUSER':os.environ.get('HTS_EVALUATION_TEST_CLEANUP_USER','postgres')}) as c:
            c.execute('SET ROLE hts_evaluation_unauthorized')
            with self.assertRaises(self.pg.Error):c.execute('SELECT pre_pack_code FROM coldlion.item_detail')
            c.rollback()
        with self.admin() as c:self.assertEqual(c.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone(),(1,))
    def test_statement_sampling_or_duration_logging_refuses_before_secret_bind(self):
        for setting in ['log_statement=all','log_min_duration_statement=0','log_min_duration_sample=0','log_transaction_sample_rate=1']:
            with self.subTest(setting=setting):
                env={**self.env,'PGOPTIONS':'-c '+setting}
                with self.assertRaises(atomic.Refusal):self.apply(env=env)
                with self.admin() as c:
                    self.assertEqual(c.execute('SELECT count(*) FROM pg_roles WHERE rolname=%s',(atomic.HTS_CREDENTIAL_ROLE,)).fetchone(),(0,))
    def test_existing_role_login_flag_drift_refuses(self):
        with self.admin() as c:c.execute('CREATE ROLE designflow_hts_evaluation_read LOGIN NOINHERIT')
        with self.assertRaises(atomic.Refusal):self.apply()
        with self.admin() as c:self.assertEqual(c.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone(),(0,))
    def test_bootstrap_creator_admin_membership_never_reaches_evaluation_reader(self):
        self.apply()
        with self.admin() as c:
            is_super=c.execute('SELECT rolsuper FROM pg_roles WHERE rolname=current_user').fetchone()[0]
            rows=c.execute("SELECT m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ('designflow_hts_evaluation_reader','designflow_hts_evaluation_read') AND m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)").fetchall()
            self.assertEqual(rows,[] if is_super else [(True,False,False),(True,False,False)])
        with atomic.credential_connection(self.env,reader=True) as c:
            with self.assertRaises(self.pg.Error):c.execute('SET ROLE postgres')
            c.rollback()

    def test_existing_password_not_rotated_when_protected_value_differs(self):
        with self.admin() as c:c.execute("CREATE ROLE designflow_hts_evaluation_reader LOGIN NOINHERIT PASSWORD 'synthetic-original-value'")
        with self.assertRaises(atomic.Refusal):self.apply()
        with self.admin() as c:self.assertEqual(c.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone(),(0,))
    def test_unexpected_existing_role_membership_or_object_access_refuses(self):
        for grant in ['GRANT pg_read_all_data TO designflow_hts_evaluation_reader','GRANT UPDATE ON coldlion.item_detail TO designflow_hts_evaluation_reader']:
            self.setUp()
            with self.admin() as c:
                c.execute('CREATE ROLE designflow_hts_evaluation_reader LOGIN NOINHERIT')
                c.execute(grant)
            with self.assertRaises(atomic.Refusal):self.apply()
            with self.admin() as c:self.assertEqual(c.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone(),(0,))

if __name__=='__main__':unittest.main()
