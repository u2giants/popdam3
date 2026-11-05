"""Opt-in real PG17 build/crash/writer drills in a NEW localhost-only database.

HEALTH_INITIAL_TEST_CONFIG is a protected local JSON psycopg connection mapping.
No shared Supabase target, database, credential or network route is permitted.
"""
import copy
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import nontransactional_index_maintenance as native
import health_initial_index_maintenance as health
from test_health_initial_index_maintenance import entry,identity
from test_nontransactional_index_maintenance import MemoryReceipts

CONFIG=os.environ.get('HEALTH_INITIAL_TEST_CONFIG','')


@unittest.skipUnless(CONFIG,'Explicit protected disposable localhost fixture configuration required')
class PostgresHealthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.psycopg=psycopg;cls.kwargs=json.loads(Path(CONFIG).read_text())
        if (cls.kwargs.get('host') not in ['127.0.0.1','localhost']
            or not re.fullmatch('health_initial_5622_[a-z0-9_]+',cls.kwargs.get('dbname',''))):
            raise RuntimeError('Only newly owned localhost health fixture database allowed')
        cls.connection=psycopg.connect(**cls.kwargs)
        version=cls.connection.execute("select current_database(),current_setting('server_version_num')::integer").fetchone()
        if version[0]!=cls.kwargs['dbname'] or not 170000<=version[1]<180000:raise RuntimeError('Actual PG17 fixture identity required')
        count=cls.connection.execute("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')").fetchone()[0]
        if count:raise RuntimeError('Fixture public schema must initially contain no tables')
        cls.connection.execute('create schema supabase_migrations')
        cls.connection.execute('create table supabase_migrations.schema_migrations(version text primary key)')
    @classmethod
    def tearDownClass(cls):cls.connection.close()
    def setUp(self):
        self.db=native.Database(self.connection);self.receipts=MemoryReceipts();self.op=sorted(health.IDS)[0]
        self.db.execute('create table public.dam_search_documents(entity_id uuid primary key,embedding_error text,embedding_updated_at timestamptz)')
        self.db.execute('create table public.style_guide_search_documents(entity_id uuid primary key,is_active boolean,embedding_updated_at timestamptz)')
        self.db.execute("insert into public.dam_search_documents select md5(i::text)::uuid,case when i%2=0 then 'fixture' end,now()-make_interval(secs=>i) from generate_series(1,8192)i")
        self.db.execute("insert into public.style_guide_search_documents select md5(i::text)::uuid,i%3<>0,now()-make_interval(secs=>i) from generate_series(1,8192)i")
        for spec in health.definitions().values():
            self.db.execute('CREATE INDEX '+spec['canonical']+' ON '+spec['table']+' '+spec['definition'])
            self.db.execute('insert into supabase_migrations.schema_migrations values(%s)',(spec['preview_version'],))
    def tearDown(self):
        self.db.execute("set statement_timeout='5000ms'")
        self.db.execute('drop table public.dam_search_documents')
        self.db.execute('drop table public.style_guide_search_documents')
        self.db.execute('delete from supabase_migrations.schema_migrations')
    def runner(self,target='preview',db=None):
        return health.HealthInitial(db or self.db,self.receipts,entry(self.op),identity(target),self.op,lambda:None)
    def test_all_three_real_preview_builds_preserve_canonical_oids_then_create_production(self):
        for op in sorted(health.IDS):
            with self.subTest(op=op):
                self.op=op;spec=health.definition(op)
                before=self.db.health_catalog(spec['canonical'])
                self.runner().apply()
                self.assertEqual(self.db.health_catalog(spec['canonical']),before)
                self.assertIsNone(self.db.health_catalog(spec['preview_shadow']))
                proof=self.receipts.read(self.runner().receipt_ref('complete'))
                self.assertTrue(proof['preview_builder_executed']);self.assertTrue(proof['shadow_cleanup_complete'])
                self.assertNotEqual(proof['new_oid'],before['oid'])
                # Only this disposable fixture switches its prestate to production.
                self.db.execute('drop index public.'+spec['canonical'])
                self.runner('production').apply()
                after=self.db.health_catalog(spec['canonical'])
                self.assertTrue(after['valid'] and after['ready']);self.assertEqual(after['owner'],'postgres')
                self.assertNotEqual(after['oid'],before['oid'])
    def test_effective_metadata_and_build_budgets(self):
        observed=[];execute=self.db.execute
        def record(sql,params=None):
            if sql.startswith('CREATE INDEX CONCURRENTLY') or sql.startswith('DROP INDEX CONCURRENTLY'):
                observed.append(execute("select current_setting('lock_timeout'),current_setting('statement_timeout')")[0])
            return execute(sql,params)
        self.db.execute=record
        try:self.runner().apply()
        finally:self.db.execute=execute
        self.assertEqual(observed,[('500ms','10s'),('500ms','2s')])
    def test_actual_committed_build_crash_without_receipt_preserves_ambiguous_oid(self):
        execute=self.db.execute;once=[False]
        def crash(sql,params=None):
            result=execute(sql,params)
            if sql.startswith('CREATE INDEX CONCURRENTLY') and not once[0]:once[0]=True;raise RuntimeError('fixture crash after committed build')
            return result
        self.db.execute=crash
        with self.assertRaises(RuntimeError):self.runner().apply()
        self.db.execute=execute
        before=self.db.health_catalog(health.definition(self.op)['preview_shadow'])
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertEqual(self.db.health_catalog(health.definition(self.op)['preview_shadow']),before)
        self.assertIsNone(self.runner().read('built'))
    def test_started_then_foreign_exact_valid_index_is_preserved(self):
        execute=self.db.execute
        def stop_before_create(sql,params=None):
            if sql.startswith('CREATE INDEX CONCURRENTLY'):raise RuntimeError('pause before owned create')
            return execute(sql,params)
        self.db.execute=stop_before_create
        with self.assertRaises(RuntimeError):self.runner().apply()
        self.db.execute=execute;spec=health.definition(self.op)
        self.db.execute('CREATE INDEX '+spec['preview_shadow']+' ON '+spec['table']+' '+spec['definition'])
        before=self.db.health_catalog(spec['preview_shadow'])
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertEqual(self.db.health_catalog(spec['preview_shadow']),before)
        self.assertIsNone(self.runner().read('built'))
    def test_actual_cleanup_crash_resumes_without_rebuilding(self):
        self.receipts.fail_phase='complete'
        with self.assertRaises(RuntimeError):self.runner().apply()
        built=self.receipts.read(self.runner().receipt_ref('built'))
        self.receipts.fail_phase=None;self.runner().apply()
        self.assertEqual(self.receipts.read(self.runner().receipt_ref('complete'))['new_oid'],built['new_oid'])
    def test_foreign_same_name_preimage_is_never_adopted_or_dropped(self):
        spec=health.definition(self.op)
        self.db.execute('CREATE INDEX '+spec['preview_shadow']+' ON '+spec['table']+' '+spec['definition'])
        before=self.db.health_catalog(spec['preview_shadow'])
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertEqual(self.db.health_catalog(spec['preview_shadow']),before)
    def test_real_advisory_writer_exclusion_preserves_existing_owner(self):
        other=self.psycopg.connect(**self.kwargs)
        try:
            foreign=native.Database(other);foreign.lock(self.op)
            with self.assertRaises(native.Refusal):self.runner().apply()
            # Original owner still holds its lock; the refused runner did not release it.
            self.assertTrue(other.execute('select pg_advisory_unlock(hashtextextended(%s,5616))',(self.op,)).fetchone()[0])
        finally:other.close()
    def test_cross_target_preview_proof_mismatch_refuses_before_production_build(self):
        self.runner().apply();spec=health.definition(self.op)
        self.receipts.records[self.runner().receipt_ref('complete')]['project_ref']='z'*20
        self.db.execute('drop index public.'+spec['canonical'])
        with self.assertRaises(native.Refusal):self.runner('production').apply()
        self.assertIsNone(self.db.health_catalog(spec['canonical']))
    def test_ordinary_writes_progress_during_real_concurrent_build(self):
        stop=threading.Event();ready=threading.Event();commits=[];errors=[]
        def writer():
            try:
                with self.psycopg.connect(**self.kwargs) as c:
                    c.execute("set statement_timeout='1000ms'")
                    while not stop.is_set():
                        c.execute("update public.dam_search_documents set embedding_updated_at=now() where entity_id=md5('1')::uuid")
                        commits.append(time.monotonic());ready.set();time.sleep(.005)
            except Exception as error:errors.append(type(error).__name__);ready.set()
        thread=threading.Thread(target=writer);thread.start();self.assertTrue(ready.wait(3))
        started=time.monotonic()
        try:self.runner().apply()
        finally:stop.set();thread.join(3)
        ended=time.monotonic()
        self.assertFalse(errors);self.assertFalse(thread.is_alive())
        self.assertTrue(any(started<=t<=ended for t in commits),'ordinary writer must commit during build/cleanup')


def run_ci_disposable():
    """Use only the existing localhost test role; never grant privileges or force cleanup."""
    import subprocess
    import tempfile
    import uuid
    import psycopg
    from psycopg import sql
    host=os.environ.get('PGHOST','');port=int(os.environ.get('PGPORT','0'))
    if host not in ('127.0.0.1','localhost') or not 1024<=port<=65535:
        raise RuntimeError('Explicit existing localhost disposable runner required')
    kwargs=dict(host=host,port=port,user=os.environ['PGUSER'],password=os.environ.get('PGPASSWORD',''),
                dbname=os.environ.get('PGDATABASE','postgres'),autocommit=True,connect_timeout=10)
    name='health_initial_5622_ci_'+uuid.uuid4().hex
    with psycopg.connect(**kwargs) as admin:
        version=admin.execute("select current_setting('server_version_num')::integer").fetchone()[0]
        if not 170000<=version<180000:raise RuntimeError('Actual PG17 disposable runner required')
        if admin.execute('select 1 from pg_database where datname=%s',(name,)).fetchone():raise RuntimeError('New fixture name already exists')
        admin.execute(sql.SQL('create database {} owner postgres').format(sql.Identifier(name)))
        path=None
        try:
            fixture={**kwargs,'dbname':name,'user':'postgres'}
            with tempfile.NamedTemporaryFile(mode='w',prefix='health-initial-5622-',suffix='.json',delete=False) as out:
                os.chmod(out.name,0o600);json.dump(fixture,out);path=out.name
            env={**os.environ,'HEALTH_INITIAL_TEST_CONFIG':path}
            env.pop('HEALTH_INITIAL_CREATE_DISPOSABLE',None)
            subprocess.run([sys.executable,__file__],env=env,check=True)
        finally:
            if path:Path(path).unlink(missing_ok=True)
            # Exact newly created fixture only. No FORCE, session termination or shared DB cleanup.
            admin.execute(sql.SQL('drop database {}').format(sql.Identifier(name)))


if __name__=='__main__':
    if os.environ.get('HEALTH_INITIAL_CREATE_DISPOSABLE')=='1':run_ci_disposable()
    else:unittest.main()
