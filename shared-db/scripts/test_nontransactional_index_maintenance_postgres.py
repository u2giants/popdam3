"""Opt-in real PostgreSQL drills; never run automatically against Supabase.

Root supplies INDEX_MAINTENANCE_TEST_DSN for a NEW disposable database named
index_maintenance_5616_<suffix>, with existing pgvector 0.8.0 in extensions.
No network/DDL occurs unless that protected variable is explicitly present.
The child author did not execute these drills; root owns target proof/execution.
"""
import os
import re
import sys
from pathlib import Path
import threading
import time
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import nontransactional_index_maintenance as maintenance
from test_nontransactional_index_maintenance import MemoryReceipts
from benchmark_sg_hnsw_rebuild import vector_expression

DSN=os.environ.get('INDEX_MAINTENANCE_TEST_DSN','')


@unittest.skipUnless(DSN,'Root must explicitly provide a disposable integration-test DSN')
class PostgresMaintenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if maintenance.PROD in DSN:raise RuntimeError('production DSN refused')
        import psycopg
        cls.psycopg=psycopg
        cls.connection=psycopg.connect(DSN,autocommit=True,connect_timeout=10)
        with cls.connection.cursor() as cursor:
            cursor.execute('select current_database()')
            if not re.fullmatch(r'index_maintenance_5616_[a-z0-9_]+',cursor.fetchone()[0]):
                cls.connection.close();raise RuntimeError('new disposable fixture database name required')
            cursor.execute("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')")
            if cursor.fetchone()[0]:cls.connection.close();raise RuntimeError('fixture database public schema must have no user tables')
            cursor.execute("select extversion from pg_extension where extname='vector'")
            if cursor.fetchone()!=('0.8.0',):cls.connection.close();raise RuntimeError('existing pgvector 0.8.0 required')

    @classmethod
    def tearDownClass(cls):cls.connection.close()

    def setUp(self):
        self.db=maintenance.Database(self.connection)
        self.db.execute('CREATE TABLE '+maintenance.TABLE+' (id integer primary key,embedding extensions.vector(768), touches integer default 0)')
        self.db.execute('INSERT INTO '+maintenance.TABLE+' (id,embedding) SELECT i,'+vector_expression(17)+' FROM generate_series(1,2048) i')
        self.db.execute('CREATE INDEX '+maintenance.INDEX+' ON '+maintenance.TABLE+' USING hnsw (embedding extensions.vector_cosine_ops) WHERE embedding IS NOT NULL')
        self.receipts=MemoryReceipts()
        definition=self.db.catalog(maintenance.INDEX)['definition']
        self.entry=dict(source_pr=1,work_issue=5616,claim_issue=99,definition_sha256=maintenance.digest(maintenance.normalized_definition(definition,maintenance.INDEX)),lock_timeout_ms=100,statement_timeout_ms=30000,swap_timeout_ms=1000,total_timeout_s=120)
        self.identity=dict(target='preview',source_sha='a'*40,execution_sha='a'*40,executor_digest='d'*64,source_pr=1,project_ref='disposable',run_id=1)
        self.runner=maintenance.Maintenance(self.db,self.receipts,self.entry,self.identity,'postgres-drill',lambda:None)

    def tearDown(self):
        # Exact table created by this fixture, inside the separately proved NEW DB.
        self.db.execute("SET statement_timeout='5000ms'")
        self.db.execute('DROP TABLE '+maintenance.TABLE)

    def test_real_rebuild_preserves_count_model_space_and_writer_progress(self):
        before=self.db.catalog(maintenance.INDEX)
        stop=threading.Event();writes=[];errors=[]
        def writer():
            try:
                with self.psycopg.connect(DSN,autocommit=True,connect_timeout=10) as other:
                    while not stop.is_set():
                        with other.cursor() as cursor:cursor.execute('UPDATE '+maintenance.TABLE+' SET touches=touches+1 WHERE id=1')
                        writes.append(time.monotonic());time.sleep(.005)
            except Exception as error:errors.append(type(error).__name__)
        thread=threading.Thread(target=writer);thread.start()
        try:self.runner.apply()
        finally:stop.set();thread.join(timeout=10)
        after=self.db.catalog(maintenance.INDEX)
        self.assertNotEqual(before['oid'],after['oid'])
        self.assertEqual(before['definition'],after['definition'])
        self.assertFalse(errors);self.assertGreater(len(writes),1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM '+maintenance.TABLE+' WHERE embedding IS NOT NULL')[0][0],2048)
        self.assertTrue(self.runner.read('complete'))

    def test_real_build_cancellation_preserves_old_index_then_recovers(self):
        original=self.db.catalog(maintenance.INDEX)['oid']
        execute=self.db.execute
        cancelled=[]
        def once(sql,params=None):
            if sql.startswith('CREATE INDEX CONCURRENTLY') and not cancelled:
                cancelled.append(True)
                execute("SET statement_timeout='1ms'")
            return execute(sql,params)
        self.db.execute=once
        with self.assertRaises(self.psycopg.Error):self.runner.apply()
        self.assertEqual(self.db.catalog(maintenance.INDEX)['oid'],original)
        self.assertTrue(self.db.catalog(maintenance.INDEX)['valid'])
        self.db.execute=execute
        self.runner.apply()
        self.assertTrue(self.runner.read('complete'))

    def test_real_crash_after_swap_reconciles_without_second_build(self):
        self.receipts.fail_phase='swapped'
        with self.assertRaises(RuntimeError):self.runner.apply()
        completed_oid=self.db.catalog(maintenance.INDEX)['oid']
        self.receipts.fail_phase=None;self.runner.apply()
        self.assertEqual(self.db.catalog(maintenance.INDEX)['oid'],completed_oid)
        self.assertTrue(self.runner.read('complete'))


if __name__=='__main__':unittest.main()
