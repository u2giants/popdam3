"""Genuine two-connection PG17 admission races; dedicated local fixture only."""
import subprocess
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import atomic_migration_apply as atomic
import test_publisher_character_curation_5683 as fixture

class LockedCuration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture.Curation.setUpClass.__func__(cls)
        fixture.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);')
    snapshot=fixture.Curation.snapshot
    def setUp(self):
        fixture.Curation.setUp(self)
        fixture.query('truncate supabase_migrations.schema_migrations')

    def wrapper(self, *, mutant=False):
        text=atomic.build_wrapper(atomic.CURATED_CHARACTER_LOCK_VERSION,'publisher_character_curation',fixture.SQL,atomic.split_sql(fixture.SQL),admission_lock_contract=atomic.CURATED_CHARACTER_LOCK_CONTRACT)
        # Only synthetic authority hashes differ; production source/contract are validated first.
        text=text.replace(fixture.SQL.rstrip(),self.sql.rstrip(),1)
        boundary='  end loop;\n  for candidate'
        assert text.count(boundary)>=1
        text=text.replace(boundary,"  end loop;\n  raise notice 'PREFLIGHT_FINISHED';\n  perform pg_sleep(0.8);\n  for candidate",1)
        if mutant:
            text=text.replace('LOCK TABLE core.licensor, core.character, core.character_alias, core.taxonomy_source_ref IN SHARE ROW EXCLUSIVE MODE;\n','',1)
        return text

    def cleanup_process(self,p):
        if p.poll() is None:
            p.kill();p.wait(timeout=5)
        for stream in (p.stdin,p.stdout,p.stderr):
            if stream is not None and not stream.closed: stream.close()

    def start(self,text,marker='PREFLIGHT_FINISHED'):
        p=subprocess.Popen(['psql',fixture.URL,'-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.addCleanup(self.cleanup_process,p)
        p.stdin.write(text);p.stdin.close()
        line=p.stderr.readline()
        self.assertIn(marker,line)
        return p

    def finish(self,p):
        stdout=p.stdout.read();stderr=p.stderr.read();p.wait(timeout=5)
        self.assertEqual(p.returncode,0,stderr)
        self.assertEqual(fixture.query('select count(*) from supabase_migrations.schema_migrations').stdout.strip(),'1')
        return stdout

    def test_each_phantom_and_witness_update_is_bounded_and_old_rows_preserved(self):
        mutations=[
            f"insert into core.character values(gen_random_uuid(),'{fixture.IDS[1]}','Chase',null,'active','{{}}')",
            f"insert into core.character_alias values(gen_random_uuid(),'{fixture.IDS[3]}','Cheer Bear','cheer bear')",
            f"insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,raw) values('core','licensor','{fixture.IDS[1]}','coldlion','fixture','new-witness','{{}}')",
            f"update core.taxonomy_source_ref set raw='{{\"changed\":true}}' where entity_id='{fixture.IDS[3]}'",
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.setUp();before=self.snapshot();p=self.start(self.wrapper())
                result=fixture.query("\\set VERBOSITY verbose\nbegin;set local lock_timeout='100ms';set local statement_timeout='2500ms';"+mutation+';commit;',ok=False)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('55P03',result.stderr)
                # Ordinary reads and FK-style key-share reads remain available under the barrier.
                read=fixture.query('begin;set local lock_timeout=\'100ms\';select id from core.licensor for key share;rollback;')
                self.assertEqual(len(read.stdout.strip().splitlines()),2)
                self.finish(p)
                after=__import__('json').loads(self.snapshot());old=__import__('json').loads(before)
                self.assertEqual(after['parents'],old['parents'])
                self.assertEqual([r for r in after['refs'] if r['entity_table']=='licensor'],old['refs'])
                self.assertEqual(len(after['chars']),2)
                self.assertIsNone(after['aliases'])

    def test_removing_barrier_wrongly_commits_duplicate_after_completed_preflight(self):
        p=self.start(self.wrapper(mutant=True))
        fixture.query(f"insert into core.character values('00000000-0000-4000-8000-000000000077','{fixture.IDS[1]}','Chase',null,'active','{{\"keep\":true}}')")
        competing=fixture.query("select to_jsonb(c) from core.character c where id='00000000-0000-4000-8000-000000000077'").stdout
        self.finish(p)
        self.assertEqual(fixture.query("select count(*) from core.character where name='Chase'").stdout.strip(),'2')
        self.assertEqual(fixture.query("select to_jsonb(c) from core.character c where id='00000000-0000-4000-8000-000000000077'").stdout,competing)

    def test_preexisting_writer_causes_bounded_barrier_rollback_without_partial_rows_or_ledger(self):
        p=subprocess.Popen(['psql',fixture.URL,'-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.addCleanup(self.cleanup_process,p)
        p.stdin.write(f"begin;insert into core.character values('00000000-0000-4000-8000-000000000077','{fixture.IDS[1]}','Chase',null,'active','{{}}');\n\\echo WRITER_READY\nselect pg_sleep(0.8);commit;")
        p.stdin.close();self.assertEqual(p.stdout.readline().strip(),'WRITER_READY')
        result=fixture.query('\\set VERBOSITY verbose\n'+self.wrapper(),ok=False)
        self.assertNotEqual(result.returncode,0);self.assertIn('55P03',result.stderr)
        p.wait(timeout=5);self.assertEqual(p.returncode,0,p.stderr.read())
        self.assertEqual(fixture.query('select count(*) from core.character').stdout.strip(),'1')
        self.assertEqual(fixture.query('select count(*) from supabase_migrations.schema_migrations').stdout.strip(),'0')
        self.assertEqual(fixture.query("select count(*) from core.taxonomy_source_ref where entity_table='character'").stdout.strip(),'0')

    def test_statement_and_total_transaction_ceilings_rollback_and_release_barrier(self):
        for pause,expected in [("select pg_sleep(2.8);",'57014'),("select pg_sleep(1.6);select pg_sleep(1.6);",'transaction timeout')]:
            with self.subTest(expected=expected):
                self.setUp();before=self.snapshot()
                wrapper=self.wrapper().replace(atomic.CURATED_CHARACTER_LOCK_SQL,atomic.CURATED_CHARACTER_LOCK_SQL+pause+"\n",1)
                result=fixture.query('\\set VERBOSITY verbose\n'+wrapper,ok=False)
                self.assertNotEqual(result.returncode,0)
                self.assertIn(expected,result.stderr)
                self.assertEqual(self.snapshot(),before)
                self.assertEqual(fixture.query('select count(*) from supabase_migrations.schema_migrations').stdout.strip(),'0')
                fixture.query("begin;set local lock_timeout='100ms';lock table core.licensor,core.character,core.character_alias,core.taxonomy_source_ref in share row exclusive mode;rollback;")

if __name__=='__main__': unittest.main()
