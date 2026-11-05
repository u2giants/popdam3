"""Offline selection and workflow integration checks; no dispatch or SQL."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
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
    def test_automatic_selector_is_part_of_existing_trigger(self):
        text=(ROOT/'.github/workflows/automatic-production-trigger.yml').read_text()
        self.assertIn('python scripts/automatic_promotion_candidates.py',text)
        self.assertIn('python scripts/automatic_index_maintenance.py',text)


if __name__=='__main__':unittest.main()
