"""Fixed health-index policy and crash-state tests; no network or target writes."""
import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import nontransactional_index_maintenance as native
import health_initial_index_maintenance as health
from test_nontransactional_index_maintenance import MemoryReceipts


def entry(op):
    return dict(source_pr=1,work_issue=5622,claim_issue=5622,kind=health.KIND,
                definition_sha256=native.digest(health.definition(op)['definition']),lock_timeout_ms=500,
                statement_timeout_ms=10000,swap_timeout_ms=2000,total_timeout_s=120)


def identity(target='preview'):
    return dict(target=target,project_ref='a'*20 if target=='preview' else 'fixture-production',
                preview_project_ref='a'*20,source_sha='b'*40,execution_sha='b'*40,executor_digest='c'*64,
                source_pr=1,work_issue=5622,claim_scope_sha256='d'*64,run_id=1)


def row(spec,name,oid=10,valid=True):
    return dict(oid=oid,table_oid=20,schema='public',table_name=spec['table'].split('.')[1],
                valid=valid,ready=valid,definition='CREATE INDEX '+name+' ON '+spec['table']+' '+spec['definition'],
                constraint_owned=False,owner='postgres')


class Database:
    def __init__(self,op):
        self.spec=health.definition(op);self.rows={self.spec['canonical']:row(self.spec,self.spec['canonical'])}
        self.sql=[];self.locked=False;self.table_oid=20;self.applied=True;self.crash_after_create=False
    def health_table_oid(self,table):return self.table_oid
    def health_preview_applied(self,version):return self.applied
    def health_catalog(self,name):return copy.deepcopy(self.rows.get(name))
    def lock(self,operation_id):
        if self.locked:raise native.Refusal('duplicate writer')
        self.locked=True
    def unlock(self,operation_id):self.locked=False
    def settings(self,lock,statement):assert lock<=500 and statement>0
    def execute(self,sql,params=None):
        self.sql.append(sql)
        if sql.startswith('CREATE INDEX CONCURRENTLY '):
            name=sql.split()[3]
            if name in self.rows:raise native.Refusal('name already exists')
            self.rows[name]=row(self.spec,name,oid=11)
            if self.crash_after_create:raise RuntimeError('crash after committed build')
        elif sql.startswith('DROP INDEX CONCURRENTLY public.'):
            del self.rows[sql.split('.')[-1]]
        else:raise AssertionError('unexpected generated SQL '+sql)


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.op=sorted(health.IDS)[0];self.db=Database(self.op);self.receipts=MemoryReceipts()
    def runner(self,target='preview',gate=lambda:None):
        return health.HealthInitial(self.db,self.receipts,entry(self.op),identity(target),self.op,gate)
    def test_every_exact_definition_preview_then_production(self):
        for op in sorted(health.IDS):
            with self.subTest(op=op):
                self.op=op;self.db=Database(op);self.receipts=MemoryReceipts()
                before=copy.deepcopy(self.db.rows)
                self.runner().apply()
                self.assertEqual(self.db.rows,before)
                self.assertEqual(len(self.db.sql),2)
                self.db.rows={}
                self.runner('production').apply()
                self.assertEqual(set(self.db.rows),{health.definition(op)['canonical']})
                self.assertFalse(any('DROP' in x for x in self.db.sql[2:]))
    def test_original_missing_is_not_preview_rehearsal(self):
        self.db.rows={}
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertFalse(self.db.sql)
    def test_original_preview_ledger_required(self):
        self.db.applied=False
        with self.assertRaises(native.Refusal):self.runner().apply()
    def test_preexisting_shadow_is_never_adopted_or_dropped(self):
        name=self.db.spec['preview_shadow'];self.db.rows[name]=row(self.db.spec,name,99)
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertFalse(self.db.sql)
    def test_production_requires_genuine_preview(self):
        self.db.rows={}
        with self.assertRaises(native.Refusal):self.runner('production').apply()
        self.assertFalse(self.db.sql)
    def test_production_preexisting_index_is_not_adopted(self):
        self.runner().apply()
        with self.assertRaises(native.Refusal):self.runner('production').apply()
    def test_crash_after_build_before_receipt_preserves_ambiguous_object(self):
        self.db.crash_after_create=True
        with self.assertRaises(RuntimeError):self.runner().apply()
        self.db.crash_after_create=False
        shadow=self.db.spec['preview_shadow'];before=copy.deepcopy(self.db.rows[shadow])
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertEqual(self.db.rows[shadow],before)
        self.assertIsNone(self.runner().read('built'))
        self.assertFalse(any(x.startswith('DROP') for x in self.db.sql))
    def test_started_receipt_then_foreign_valid_index_is_never_adopted(self):
        execute=self.db.execute
        def stop_before_create(sql,params=None):
            if sql.startswith('CREATE'):raise RuntimeError('pause before own CREATE')
            return execute(sql,params)
        self.db.execute=stop_before_create
        with self.assertRaises(RuntimeError):self.runner().apply()
        self.db.execute=execute
        shadow=self.db.spec['preview_shadow'];self.db.rows[shadow]=row(self.db.spec,shadow,99)
        before=copy.deepcopy(self.db.rows[shadow])
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertEqual(self.db.rows[shadow],before)
        self.assertIsNone(self.runner().read('built'))
        self.assertFalse(any(x.startswith('DROP') for x in self.db.sql))
    def test_crash_after_owned_cleanup_resumes_without_rebuild(self):
        self.receipts.fail_phase='complete'
        with self.assertRaises(RuntimeError):self.runner().apply()
        self.receipts.fail_phase=None
        self.runner().apply()
        self.assertEqual(sum(x.startswith('CREATE') for x in self.db.sql),1)
    def pause_before_cleanup(self):
        execute=self.db.execute
        def stop_before_drop(sql,params=None):
            if sql.startswith('DROP'):raise RuntimeError('pause after immutable built receipt')
            return execute(sql,params)
        self.db.execute=stop_before_drop
        try:
            with self.assertRaises(RuntimeError):self.runner().apply()
        finally:self.db.execute=execute
    def test_changed_preview_canonical_preimage_refused(self):
        self.pause_before_cleanup();self.db.rows[self.db.spec['canonical']]['oid']=90
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertFalse(any(x.startswith('DROP') for x in self.db.sql))
    def test_changed_table_oid_refused(self):
        self.pause_before_cleanup();self.db.table_oid=21
        with self.assertRaises(native.Refusal):self.runner().apply()
    def test_changed_recorded_build_oid_not_dropped(self):
        self.receipts.fail_phase='complete'
        # Fail the drop itself after a genuine built receipt instead.
        execute=self.db.execute
        def fail_drop(sql,params=None):
            if sql.startswith('DROP'):raise RuntimeError('before cleanup')
            return execute(sql,params)
        self.db.execute=fail_drop
        with self.assertRaises(RuntimeError):self.runner().apply()
        self.db.execute=execute;self.receipts.fail_phase=None
        self.db.rows[self.db.spec['preview_shadow']]['oid']=91
        with self.assertRaises(native.Refusal):self.runner().apply()
    def test_wrong_definition_owner_constraint_invalid_state_preserved(self):
        for field,value in [('definition','unexpected'),('owner','foreign'),('constraint_owned',True),('valid',False)]:
            with self.subTest(field=field):
                self.setUp();self.pause_before_cleanup();self.db.rows[self.db.spec['preview_shadow']][field]=value
                with self.assertRaises(native.Refusal):self.runner().apply()
                self.assertFalse(any(x.startswith('DROP') for x in self.db.sql))
    def test_owner_scope_change_refuses_receipt_reuse(self):
        self.pause_before_cleanup();runner=self.runner();runner.identity['claim_scope_sha256']='e'*64
        with self.assertRaises(native.Refusal):runner.apply()
    def test_cross_target_preview_receipt_refused(self):
        self.runner().apply()
        complete=next(v for k,v in self.receipts.records.items() if k.endswith('/preview/complete'))
        complete['target']='production';self.db.rows={}
        with self.assertRaises(native.Refusal):self.runner('production').apply()
    def test_concurrent_writer_lock_refused(self):
        self.db.locked=True
        with self.assertRaises(native.Refusal):self.runner().apply()
        self.assertFalse(self.db.sql)
    def test_fencing_checked_before_each_generated_mutation(self):
        calls=[]
        self.runner(gate=lambda:calls.append(True)).apply()
        self.assertEqual(len(calls),3)
    def test_policy_rejects_arbitrary_identity_hash_target_budget_fields(self):
        base=entry(self.op)
        for key,value in [('work_issue',999),('claim_issue',999),('kind','arbitrary'),('definition_sha256','0'*64),('lock_timeout_ms',501),('sql','drop table x')]:
            with self.subTest(key=key):
                altered={**base,key:value}
                with self.assertRaises(native.Refusal):health.validate_operation(altered,self.op)
        with self.assertRaises(native.Refusal):health.definition('health-any-other')
        self.assertEqual(health.validate_operation(base,self.op),base)



class RetiredHealthSourceTests(unittest.TestCase):
    def test_original_preview_applied_sources_stay_immutable_and_pending_production_refuses(self):
        import hashlib
        import production_migration_guard as guard
        expected={
          '20261105073854':'6e7f4b4773794fbfa5d49bbcc5de24c3b6b63ff7d81bd5979ec3c48ee2b4bf50',
          '20261105073903':'ceb0cc2d93e734ff82da0929e0e381cb96db2817f14add8eca8f14aa6c5f9ab5',
          '20261105073911':'48dd5300cd792d01cf61c2777fe6e6245a7ad8449b8a635091b5a0487a710a1e',
          '20261105073920':'499cc17b2d25d433d6da51b3e42055eb54885a55a7e6f5280acc48a2f281487a'}
        for version,sha in expected.items():
            with self.subTest(version=version):
                self.assertIn(version,guard.HARD_BLOCKED)
                self.assertEqual(guard.classify_pending_version(version,set(),native.ROOT)['kind'],'retired')
                paths=list((native.ROOT/'supabase/migrations').glob(version+'_*.sql'))
                self.assertEqual(len(paths),1)
                self.assertEqual(hashlib.sha256(paths[0].read_bytes()).hexdigest(),sha)
                self.assertIn('applied preview ledger',guard.RETIRED_VERSION_REASONS[version])

if __name__=='__main__':unittest.main()
