"""Offline selection and workflow integration checks; no dispatch or SQL."""
import json
import os
import tempfile
from unittest.mock import MagicMock,patch
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import automatic_index_maintenance as automatic
import automatic_promotion_candidates as promotion
from automatic_index_maintenance import select
import nontransactional_index_maintenance as maintenance
from test_nontransactional_index_maintenance import entry
ROOT=Path(__file__).resolve().parents[1]


class SelectionTests(unittest.TestCase):
    def test_empty_default_policy_enables_nothing(self):
        policy={'schema_version':1,'operations':{}}
        self.assertIsNone(select(policy,lambda r:None,[],lambda pr:False,'a'*40))
    def test_committed_policy_entries_are_valid_without_forbidding_future_activation(self):
        policy=json.loads((ROOT/'config/nontransactional-index-maintenance.json').read_text())
        self.assertEqual(set(policy),{'schema_version','operations'})
        self.assertEqual(policy['schema_version'],1)
        for operation_id in policy['operations']:maintenance.operation(policy,operation_id)
    def test_active_workflow_and_finding_hold_block_selection(self):
        policy={'schema_version':1,'operations':{'test-operation':entry()}}
        self.assertIsNone(select(policy,lambda r:None,[{'status':'in_progress'}],lambda pr:False,'a'*40))
        self.assertIsNone(select(policy,lambda r:None,[],lambda pr:True,'a'*40))
    def test_preview_then_production_then_done(self):
        policy={'schema_version':1,'operations':{'test-operation':entry()}}
        records={};read=lambda ref:records.get(ref)
        self.assertEqual(select(policy,read,[],lambda pr:False,'a'*40)['target'],'preview')
        records['refs/db-index-maintenance/test-operation/preview/complete']={'phase':'complete','operation_id':'test-operation','target':'preview','source_pr':1,'policy_digest':maintenance.digest(entry())}
        self.assertEqual(select(policy,read,[],lambda pr:False,'a'*40)['target'],'production')
        records['refs/db-index-maintenance/test-operation/production/complete']={'phase':'complete','operation_id':'test-operation','target':'production','source_pr':1,'policy_digest':maintenance.digest(entry())}
        self.assertIsNone(select(policy,read,[],lambda pr:False,'a'*40))
    def test_preview_only_repack_stops_after_preview(self):
        import test_table_repack_maintenance as rt
        value=rt.entry(preview_only=True);op='repack-test-1'
        policy={'schema_version':1,'operations':{op:value}}
        records={};read=lambda ref:records.get(ref)
        self.assertEqual(select(policy,read,[],lambda pr:False,'a'*40)['target'],'preview')
        records[f'refs/db-index-maintenance/{op}/preview/complete']={'phase':'complete','operation_id':op,'target':'preview','source_pr':1,'policy_digest':maintenance.digest(value)}
        self.assertIsNone(select(policy,read,[],lambda pr:False,'a'*40))
    def test_malformed_completion_fails_loudly_instead_of_skipping_work(self):
        policy={'schema_version':1,'operations':{'test-operation':entry()}}
        with self.assertRaises(maintenance.Refusal):select(policy,lambda ref:{'phase':'complete'},[],lambda pr:False,'a'*40)
    def test_existing_workflow_keeps_serialized_queue_and_notify_dependency(self):
        text=(ROOT/'.github/workflows/shared-supabase-migrations.yml').read_text()
        self.assertIn('shared-supabase-migrations-production',text)
        self.assertIn('shared-supabase-migrations-preview',text)
        self.assertIn('production-apply, index-maintenance]',text)
        self.assertIn("startsWith(inputs.migration_train_ref, 'refs/db-index-maintenance-operations/') == false && github.event_name",text)
        self.assertIn('scripts/atomic_migration_apply.py',text)
        self.assertIn('supabase db push --include-all',text)
        self.assertIn('Refuse a mixed maintenance/migration dispatch',text)
    def run_main(self,runs,clock):
        policy={'schema_version':1,'operations':{'test-operation':entry()}}
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'policy.json';path.write_text(json.dumps(policy));output=Path(root)/'output'
            receipts=MagicMock();receipts.read.return_value=None
            with patch.dict(os.environ,{'GITHUB_REPOSITORY':maintenance.REPO,'GITHUB_OUTPUT':str(output)}),patch.object(maintenance,'POLICY',path),\
                 patch.object(maintenance,'Receipts',return_value=receipts),patch.object(maintenance,'gh',return_value={'sha':'a'*40}),\
                 patch.object(promotion,'workflow_runs',side_effect=runs) as fetch,patch.object(promotion,'is_held',return_value=False),\
                 patch.object(automatic.time,'monotonic',side_effect=clock),patch.object(automatic.time,'sleep') as sleep,\
                 patch.object(automatic.subprocess,'run') as dispatch,patch.object(sys,'argv',['automatic_index_maintenance.py']):
                self.assertEqual(automatic.main(),0)
            return fetch.call_count,sleep.call_count,dispatch.call_count,output.read_text() if output.exists() else ''
    def test_waits_for_finishing_run_then_dispatches_and_signals_promotion_skip(self):
        active=[{'status':'in_progress'}]
        self.assertEqual(self.run_main([active,active,[]],[0,1,2]),(3,2,1,'dispatched=true\n'))
    def test_idle_queue_does_not_sleep(self):
        self.assertEqual(self.run_main([[]],[0]),(1,0,1,'dispatched=true\n'))
    def test_wait_is_bounded_and_active_queue_dispatches_nothing(self):
        active=[{'status':'in_progress'}]
        self.assertEqual(self.run_main([active,active],[0,1,automatic.ACTIVE_WAIT_S]),(2,1,0,''))
    def test_automatic_selector_is_part_of_existing_trigger(self):
        text=(ROOT/'.github/workflows/automatic-production-trigger.yml').read_text()
        self.assertIn('python scripts/automatic_promotion_candidates.py',text)
        self.assertIn('python scripts/automatic_index_maintenance.py',text)
        self.assertLess(text.index('python scripts/automatic_index_maintenance.py'),text.index('python scripts/automatic_promotion_candidates.py'))
        self.assertIn("if: always() && steps.index_maintenance.outputs.dispatched != 'true'",text)


if __name__=='__main__':unittest.main()
