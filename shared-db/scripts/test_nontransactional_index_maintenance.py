"""Offline state-machine/fault tests. No DB connections, DDL, GitHub or credentials."""
import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import nontransactional_index_maintenance as maintenance

TAIL='USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)'


def row(name,oid=10,valid=True,table_oid=20):
    return dict(oid=oid,table_oid=table_oid,schema='public',table_name='style_guide_search_documents',
        valid=valid,ready=valid,definition=f'CREATE INDEX {name} ON {maintenance.TABLE} '+TAIL,constraint_owned=False)


def entry():
    return dict(source_pr=1,work_issue=5616,claim_issue=99,definition_sha256=maintenance.digest(TAIL),lock_timeout_ms=500,
                statement_timeout_ms=10000,swap_timeout_ms=2500,total_timeout_s=120)


class MemoryReceipts:
    def __init__(self):self.records={};self.fail_phase=None
    def read(self,ref):return copy.deepcopy(self.records.get(ref))
    def create(self,ref,record):
        if ref.endswith('/'+str(self.fail_phase)):raise RuntimeError('injected receipt failure')
        if ref in self.records and self.records[ref]!=record:raise maintenance.Refusal('immutable conflict')
        self.records[ref]=copy.deepcopy(record);return record
    def verify_run(self,record):pass


class FakeDB:
    def __init__(self,op='synthetic-operation'):
        self.old,self.new,self.retired=maintenance.names(op)
        self.rows={self.old:row(self.old)};self.sql=[];self.fail_stage=None;self.locked=False
    def catalog(self,name):return copy.deepcopy(self.rows.get(name))
    def lock(self,op):
        if self.locked:raise maintenance.Refusal('duplicate writer')
        self.locked=True
    def unlock(self,op):self.locked=False
    def settings(self,lock,statement):assert 0<lock<=2000 and statement>0
    def execute(self,sql,params=None):
        self.sql.append(sql)
        if sql.startswith('CREATE INDEX CONCURRENTLY'):
            self.rows[self.new]=row(self.new,11,self.fail_stage!='build')
            if self.fail_stage=='build':raise RuntimeError('build cancellation')
        elif sql==f'DROP INDEX CONCURRENTLY public.{self.new}':del self.rows[self.new]
        elif sql==f'DROP INDEX CONCURRENTLY public.{self.retired}':
            if self.fail_stage=='cleanup':raise RuntimeError('cleanup cancellation')
            del self.rows[self.retired]
        else:raise AssertionError('unexpected SQL '+sql)
    def swap(self,old,new,retired,lock_ms,timeout_ms):
        if self.fail_stage=='swap':raise RuntimeError('swap cancellation: original retained')
        self.sql.append('BOUNDED_ATOMIC_RENAME')
        self.rows[retired]=self.rows.pop(old);self.rows[retired]['definition']=f'CREATE INDEX {retired} ON {maintenance.TABLE} '+TAIL
        self.rows[old]=self.rows.pop(new);self.rows[old]['definition']=f'CREATE INDEX {old} ON {maintenance.TABLE} '+TAIL


class MaintenanceTests(unittest.TestCase):
    def test_lock_wait_may_exceed_deadlock_timeout_but_stays_bounded(self):
        policy=lambda value:{'schema_version':1,'operations':{'op':{**entry(),'lock_timeout_ms':value,'swap_timeout_ms':3000}}}
        self.assertEqual(maintenance.operation(policy(2000),'op')['lock_timeout_ms'],2000)
        with self.assertRaises(maintenance.Refusal):maintenance.operation(policy(2001),'op')
    def fixture(self,target='preview'):
        db=FakeDB();receipts=MemoryReceipts();gates=[]
        identity=dict(target=target,source_sha='a'*40,execution_sha='a'*40,executor_digest='d'*64,source_pr=1,work_issue=5616,project_ref='preview-fixture',run_id=8)
        def gate():gates.append('reproved')
        runner=maintenance.Maintenance(db,receipts,entry(),identity,'synthetic-operation',gate)
        return runner,db,receipts,gates

    def test_empty_policy_never_enables_maintenance(self):
        with self.assertRaises(maintenance.Refusal):maintenance.operation({'schema_version':1,'operations':{}},'synthetic-operation')

    def test_identifier_injection_and_unknown_sql_fields_refused(self):
        for op,change in [('x;DROP',{}),('valid',{'sql':'drop table x'}),('valid',{'lock_timeout_ms':5000}),('valid',{'swap_timeout_ms':5000})]:
            with self.subTest(op=op,change=change),self.assertRaises(maintenance.Refusal):
                maintenance.operation({'schema_version':1,'operations':{op:{**entry(),**change}}},op)

    def test_success_preserves_original_capability_through_build(self):
        runner,db,receipts,gates=self.fixture();runner.apply()
        self.assertEqual(set(db.rows),{db.old})
        self.assertEqual(db.rows[db.old]['oid'],11)
        self.assertTrue(db.sql[0].startswith('CREATE INDEX CONCURRENTLY'))
        self.assertEqual(db.sql[1],'BOUNDED_ATOMIC_RENAME')
        self.assertEqual(db.sql[2],f'DROP INDEX CONCURRENTLY public.{db.retired}')
        self.assertGreaterEqual(len(gates),4)
        self.assertTrue(runner.read('complete'))

    def test_retry_after_complete_executes_no_more_sql(self):
        runner,db,_,_=self.fixture();runner.apply();before=list(db.sql);runner.apply();self.assertEqual(db.sql,before)

    def test_cancelled_build_cleans_only_exact_incomplete_new_and_recovers(self):
        runner,db,_,_=self.fixture();db.fail_stage='build'
        with self.assertRaises(RuntimeError):runner.apply()
        self.assertTrue(db.rows[db.old]['valid']);self.assertFalse(db.rows[db.new]['valid'])
        db.fail_stage=None;runner.apply()
        self.assertIn(f'DROP INDEX CONCURRENTLY public.{db.new}',db.sql)
        self.assertEqual(set(db.rows),{db.old})

    def test_preexisting_replacement_is_preserved_and_refused(self):
        runner,db,_,_=self.fixture();db.rows[db.new]=row(db.new,77)
        with self.assertRaises(maintenance.Refusal):runner.apply()
        self.assertEqual(db.rows[db.new]['oid'],77);self.assertFalse(db.sql)

    def test_swap_timeout_keeps_old_index_and_retry_avoids_second_build(self):
        runner,db,_,_=self.fixture();db.fail_stage='swap'
        with self.assertRaises(RuntimeError):runner.apply()
        self.assertEqual(db.rows[db.old]['oid'],10)
        db.fail_stage=None;runner.apply()
        self.assertEqual(sum(s.startswith('CREATE INDEX') for s in db.sql),1)

    def test_crash_after_swap_missing_receipt_recovers_without_second_build(self):
        runner,db,receipts,_=self.fixture();receipts.fail_phase='swapped'
        with self.assertRaises(RuntimeError):runner.apply()
        self.assertEqual(db.rows[db.old]['oid'],11);self.assertIn(db.retired,db.rows)
        receipts.fail_phase=None;runner.apply()
        self.assertEqual(set(db.rows),{db.old})
        self.assertEqual(sum(s.startswith('CREATE INDEX') for s in db.sql),1)

    def test_cleanup_cancellation_does_not_remove_current_index(self):
        runner,db,_,_=self.fixture();db.fail_stage='cleanup'
        with self.assertRaises(RuntimeError):runner.apply()
        self.assertTrue(db.rows[db.old]['valid']);self.assertIn(db.retired,db.rows)
        db.fail_stage=None;runner.apply();self.assertEqual(set(db.rows),{db.old})

    def test_changed_definition_or_table_and_constraint_owned_refused(self):
        for change in [{'definition':'changed'},{'table_oid':99},{'constraint_owned':True}]:
            runner,db,_,_=self.fixture();db.rows[db.old].update(change)
            if 'table_oid' in change:
                # Anchor immutable start to table20 before simulating catalog drift.
                runner.save('started',{'original_oid':10,'table_oid':20})
            with self.subTest(change=change),self.assertRaises(maintenance.Refusal):runner.apply()
            self.assertFalse(db.sql)

    def test_forged_or_stale_receipt_binding_refused(self):
        runner,_,receipts,_=self.fixture();runner.save('started',{'original_oid':10,'table_oid':20})
        receipts.records[runner.receipt_ref('started')]['source_sha']='b'*40
        with self.assertRaises(maintenance.Refusal):runner.apply()

    def test_production_requires_exact_preview_completion(self):
        runner,db,_,_=self.fixture('production')
        with self.assertRaises(maintenance.Refusal):runner.apply()
        self.assertFalse(db.sql)

    def test_foreign_same_definition_original_cannot_claim_completion(self):
        runner,db,receipts,_=self.fixture();runner.apply()
        db.rows[db.old]=row(db.old,999)
        before=list(db.sql)
        with self.assertRaisesRegex(maintenance.Refusal,'immutable built replacement'):runner.apply()
        self.assertEqual(db.sql,before)

    def test_foreign_same_definition_before_cleanup_never_drops_retired(self):
        runner,db,receipts,_=self.fixture();receipts.fail_phase='swapped'
        with self.assertRaises(RuntimeError):runner.apply()
        db.rows[db.old]=row(db.old,999);receipts.fail_phase=None
        with self.assertRaisesRegex(maintenance.Refusal,'immutable built replacement'):runner.apply()
        self.assertIn(db.retired,db.rows)

    def test_total_deadline_refuses_before_generated_mutation(self):
        runner,db,_,_=self.fixture();runner.clock=lambda:runner.started+121
        with self.assertRaises(maintenance.Refusal):runner.apply()
        self.assertFalse(db.sql)

    def test_deadline_expiring_during_build_preserves_original_without_swap(self):
        runner,db,_,_=self.fixture()
        execute=db.execute
        def build_then_expire(sql,params=None):
            result=execute(sql,params)
            if sql.startswith('CREATE INDEX CONCURRENTLY'):
                runner.clock=lambda:runner.started+121
            return result
        db.execute=build_then_expire
        with self.assertRaisesRegex(maintenance.Refusal,'total deadline'):
            runner.apply()
        self.assertEqual(db.rows[db.old]['oid'],10)
        self.assertTrue(db.rows[db.new]['valid'])
        self.assertNotIn('BOUNDED_ATOMIC_RENAME',db.sql)
        self.assertNotIn(db.retired,db.rows)

    def test_foreign_retired_oid_never_dropped(self):
        runner,db,_,_=self.fixture();runner.save('started',{'original_oid':10,'table_oid':20})
        db.rows[db.old]=row(db.old,11);db.rows[db.retired]=row(db.retired,88)
        with self.assertRaises(maintenance.Refusal):runner.apply()
        self.assertFalse(db.sql)


if __name__=='__main__':unittest.main()
