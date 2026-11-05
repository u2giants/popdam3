"""Offline repack state-machine tests. No DB connections, GitHub, client binary or credentials."""
import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import nontransactional_index_maintenance as maintenance
import table_repack_maintenance as repack

OP='repack-assets-804'


def entry(**over):
    value=dict(kind=repack.KIND,source_pr=1,work_issue=5745,claim_issue=5742,table='public.assets',
               client_sha256='a'*64,wait_timeout_s=30,total_timeout_s=3000)
    value.update(over);return value


class MemoryReceipts:
    def __init__(self):self.records={}
    def read(self,ref):return copy.deepcopy(self.records.get(ref))
    def create(self,ref,record):
        if ref in self.records and self.records[ref]!=record:raise maintenance.Refusal('immutable conflict')
        self.records[ref]=copy.deepcopy(record);return record
    def verify_run(self,record):pass


def state(relfilenode=100,**over):
    value=dict(oid=7,relfilenode=relfilenode,relpages=10,heap_bytes=81920,indexes=46,valid_indexes=46,triggers=25,constraints=9,acl='{x}',total_bytes=3<<30,rows=152000)
    value.update(over);return value


class FakeDB:
    def __init__(self):
        self.state=state();self.version='1.5.2';self.leftovers=False;self.locked=False
    def lock(self,op):
        if self.locked:raise maintenance.Refusal('duplicate writer')
        self.locked=True
    def unlock(self,op):self.locked=False
    def repack_extension_version(self):return self.version
    def repack_leftovers(self):return self.leftovers
    def table_state(self,table):
        assert table=='public.assets';return copy.deepcopy(self.state)


def identity(target='preview'):
    return dict(target=target,project_ref='abcdefghijklmnopqrst' if target=='preview' else maintenance.PROD,
                preview_project_ref='abcdefghijklmnopqrst',source_sha='b'*40,execution_sha='c'*40,
                executor_digest='d'*64,source_pr=1,work_issue=5745,run_id=5)


def runner(db,receipts,target='preview',client=None,gate=lambda:None,value=None):
    calls=[]
    def default(e,env,timeout):
        calls.append(timeout);db.state=state(relfilenode=200,relpages=3,heap_bytes=24576)
    return repack.TableRepack(db,receipts,value or entry(),identity(target),OP,gate,client=client or default,disk=lambda ref:20<<30),calls


class PolicyTests(unittest.TestCase):
    def test_exact_entry_validates_through_shared_operation(self):
        policy={'schema_version':1,'operations':{OP:entry()}}
        self.assertEqual(maintenance.operation(policy,OP),entry())
    def test_unallowlisted_table_or_budget_or_shape_refuses(self):
        for bad in [entry(table='public.style_groups'),entry(wait_timeout_s=600),entry(total_timeout_s=99999),
                    entry(client_sha256='x'),{**entry(),'extra':1},entry(kind='other')]:
            with self.subTest(bad=bad),self.assertRaises(maintenance.Refusal):
                maintenance.operation({'schema_version':1,'operations':{OP:bad}},OP)
    def test_claim_names_only_the_table(self):
        self.assertEqual(repack.claim_request(entry(),OP)['objects'],['table public.assets'])
    def test_client_arguments_are_fixed_and_never_kill_backends(self):
        args=repack.command('/bin/pg_repack',entry())
        self.assertEqual(args,['/bin/pg_repack','--no-superuser-check','--no-kill-backend','--no-order','--wait-timeout=30','--table=public.assets','--elevel=WARNING'])
    def test_unpinned_client_refuses_before_running(self):
        with self.assertRaises(maintenance.Refusal):repack.run_client(entry(),{},60)
    def test_committed_policy_still_parses(self):
        policy=json.loads(maintenance.POLICY.read_text())
        for op in policy['operations']:maintenance.operation(policy,op)


class StateMachineTests(unittest.TestCase):
    def test_preview_repacks_and_records_completion(self):
        db,receipts=FakeDB(),MemoryReceipts();job,calls=runner(db,receipts);job.apply()
        self.assertEqual(len(calls),1);self.assertFalse(db.locked)
        done=receipts.read(f'refs/db-index-maintenance/{OP}/preview/complete')
        self.assertTrue(done['repacked']);self.assertEqual(done['before']['relfilenode'],100);self.assertEqual(done['after']['relfilenode'],200)
    def test_production_requires_completed_preview(self):
        db,receipts=FakeDB(),MemoryReceipts();job,calls=runner(db,receipts,'production')
        with self.assertRaises(maintenance.Refusal):job.apply()
        self.assertEqual(calls,[])
    def test_production_after_preview(self):
        receipts=MemoryReceipts();runner(FakeDB(),receipts)[0].apply()
        db=FakeDB();job,calls=runner(db,receipts,'production');job.apply()
        self.assertEqual(len(calls),1)
        self.assertTrue(receipts.read(f'refs/db-index-maintenance/{OP}/production/complete')['repacked'])
    def test_wrong_extension_or_leftovers_refuse_without_running(self):
        for setup in [lambda d:setattr(d,'version',None),lambda d:setattr(d,'version','1.5.3'),lambda d:setattr(d,'leftovers',True)]:
            db=FakeDB();setup(db);job,calls=runner(db,MemoryReceipts())
            with self.assertRaises(maintenance.Refusal):job.apply()
            self.assertEqual(calls,[]);self.assertFalse(db.locked)
    def test_client_failure_keeps_table_and_records_no_completion(self):
        db,receipts=FakeDB(),MemoryReceipts()
        def fail(e,env,t):raise maintenance.Refusal('pg_repack client did not complete')
        job,_=runner(db,receipts,client=fail)
        with self.assertRaises(maintenance.Refusal):job.apply()
        self.assertIsNone(receipts.read(f'refs/db-index-maintenance/{OP}/preview/complete'))
        self.assertEqual(db.state['relfilenode'],100)
    def test_client_that_does_not_swap_refuses(self):
        db=FakeDB();job,_=runner(db,MemoryReceipts(),client=lambda e,env,t:None)
        with self.assertRaises(maintenance.Refusal):job.apply()
    def test_shape_change_refuses(self):
        db=FakeDB()
        def lossy(e,env,t):db.state=state(relfilenode=200,indexes=45,valid_indexes=45)
        job,_=runner(db,MemoryReceipts(),client=lossy)
        with self.assertRaises(maintenance.Refusal):job.apply()
    def test_resume_after_swap_completes_without_second_run(self):
        db,receipts=FakeDB(),MemoryReceipts()
        def crash(e,env,t):db.state=state(relfilenode=200);raise RuntimeError('runner lost after swap')
        job,_=runner(db,receipts,client=crash)
        with self.assertRaises(RuntimeError):job.apply()
        job,calls=runner(db,receipts);job.apply()
        self.assertEqual(calls,[])
        self.assertTrue(receipts.read(f'refs/db-index-maintenance/{OP}/preview/complete')['repacked'])
    def test_table_identity_change_refuses(self):
        db,receipts=FakeDB(),MemoryReceipts()
        def crash(e,env,t):raise RuntimeError('lost before swap')
        job,_=runner(db,receipts,client=crash)
        with self.assertRaises(RuntimeError):job.apply()
        db.state=state(oid=8);job,calls=runner(db,receipts)
        with self.assertRaises(maintenance.Refusal):job.apply()
        self.assertEqual(calls,[])
    def test_gate_rechecked_before_client(self):
        db=FakeDB();seen=[]
        job,calls=runner(db,MemoryReceipts(),gate=lambda:seen.append(1))
        job.apply();self.assertGreaterEqual(len(seen),3)
    def test_low_disk_refuses_before_running(self):
        db=FakeDB();job,calls=runner(db,MemoryReceipts());job.disk=lambda ref:(3<<30)+(512<<20)
        with self.assertRaises(maintenance.Refusal):job.apply()
        self.assertEqual(calls,[])
    def test_row_loss_beyond_concurrent_band_refuses(self):
        db=FakeDB()
        def lossy(e,env,t):db.state=state(relfilenode=200,rows=151000)
        job,_=runner(db,MemoryReceipts(),client=lossy)
        with self.assertRaises(maintenance.Refusal):job.apply()
    def test_small_concurrent_row_drift_completes(self):
        db=FakeDB()
        def drift(e,env,t):db.state=state(relfilenode=200,rows=152040)
        job,_=runner(db,MemoryReceipts(),client=drift);job.apply()
    def test_executor_digest_covers_repack_module(self):
        self.assertNotEqual(maintenance.executor_digest(OP),maintenance.executor_digest('sg-hnsw-rebuild-706b'))


if __name__=='__main__':unittest.main()
