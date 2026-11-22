"""Offline selection and workflow integration checks; no dispatch or SQL."""
import contextlib
import io
import json
import os
import subprocess
import tempfile
from subprocess import CompletedProcess
from types import SimpleNamespace
from unittest.mock import MagicMock,patch
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import automatic_index_maintenance as automatic
import automatic_promotion_candidates as promotion
from automatic_index_maintenance import select
import nontransactional_index_maintenance as maintenance
import review_finding_hold
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

    def test_selector_and_executor_share_source_head_review_binding(self):
        operation = "test-operation"
        value = entry()
        source_pr = value["source_pr"]
        policy = {"schema_version": 1, "operations": {operation: value}}
        main_sha, pr_head, merged_sha = "d" * 40, "a" * 40, "b" * 40
        preview = "x" * 20
        dispatch_ref = f"refs/db-index-maintenance-operations/{operation}/preview/{main_sha}"
        run = {"id": 8, "path": f".github/workflows/{maintenance.WORKFLOW}",
               "head_sha": main_sha, "head_branch": "main", "event": "workflow_dispatch",
               "status": "in_progress", "conclusion": None, "run_attempt": 1,
               "actor": {"login": "github-actions[bot]"},
               "triggering_actor": {"login": "github-actions[bot]"},
               "display_title": f"INDEX preview {dispatch_ref} {main_sha}"}
        environment = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": maintenance.REPO,
                       "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_RUN_ATTEMPT": "1",
                       "GITHUB_ACTOR": "github-actions[bot]", "GITHUB_RUN_ID": "8",
                       "GITHUB_WORKFLOW_REF": f"{maintenance.REPO}/.github/workflows/"
                                              f"{maintenance.WORKFLOW}@refs/heads/main",
                       "PREVIEW_PROJECT_REF": preview}
        receipt = {"operation_id": operation, "target": "preview", "source_sha": main_sha,
                   "policy_digest": maintenance.digest(value)}
        command_outputs = [main_sha, "", json.dumps(policy), '{"admitted": true}']
        cases = [
            ("superseded, even if it matches main dispatch", pr_head, main_sha, "open", False),
            ("current", pr_head, pr_head, "open", True),
            ("unbound", pr_head, None, "open", True),
            ("missing canonical head", None, main_sha, "open", True),
            ("malformed canonical head", "not-a-sha", main_sha, "open", True),
            ("closed", None, pr_head, "closed", False),
        ]
        with tempfile.TemporaryDirectory() as directory:
            linked = Path(directory) / "supabase/.temp"
            linked.mkdir(parents=True)
            (linked / "project-ref").write_text(preview)
            options = SimpleNamespace(source_sha=main_sha, target="preview", dispatch_ref=dispatch_ref,
                                      operation=operation, expected_project_ref=preview, linked_dir=Path(directory))
            for name, canonical_head, finding_head, status, expected_hold in cases:
                with self.subTest(name=name):
                    pull = {"merged_at": "2026-11-21T01:02:03Z", "base": {"ref": "main"},
                            "merge_commit_sha": merged_sha, "head": {"sha": canonical_head}}
                    body = f"https://github.com/{maintenance.REPO}/pull/{source_pr}\n"
                    if finding_head:
                        body += f"Head SHA: `{finding_head}`\n"
                    finding = {"number": 99, "state": status, "body": body}
                    with patch.object(review_finding_hold, "_gh_object", return_value=pull), \
                         patch.object(review_finding_hold, "gh_issues_many", return_value={source_pr: [finding]}):
                        held = promotion.prefetch_holds(maintenance.REPO, [source_pr])
                        self.assertEqual(select(policy, lambda ref: None, [], held, main_sha) is None,
                                         expected_hold)
                    github = {"actions/runs/8": run, "commits/main": {"sha": main_sha},
                              f"pulls/{source_pr}": pull}
                    with patch.dict(os.environ, environment), \
                         patch.object(maintenance, "gh", side_effect=github.__getitem__), \
                         patch.object(maintenance, "Receipts") as receipts, \
                         patch.object(maintenance, "linked_connection", return_value=(None, {})) as connect, \
                         patch.object(review_finding_hold, "gh_issues", return_value=[finding]), \
                         patch.object(maintenance.subprocess, "run", side_effect=[
                             CompletedProcess([], 0, output) for output in command_outputs
                         ]):
                        receipts.return_value.read.return_value = receipt
                        if expected_hold:
                            with self.assertRaisesRegex(maintenance.Refusal, "blocking review finding"):
                                maintenance.workflow_gate(options, value)
                            connect.assert_not_called()
                        else:
                            self.assertEqual(maintenance.workflow_gate(options, value)["_SOURCE_MERGE_SHA"],
                                             merged_sha)
    def test_finished_operation_reads_no_hold_and_held_bad_receipt_is_skipped(self):
        # #6493 Step 4: each hold read settles 20 s; a finished operation must not pay it.
        policy={'schema_version':1,'operations':{'test-operation':entry()}}
        done={'phase':'complete','operation_id':'test-operation','target':'production','source_pr':1,'policy_digest':maintenance.digest(entry())}
        asked=[]
        self.assertIsNone(select(policy,lambda ref:done if ref.endswith('/production/complete') else None,[],lambda pr:asked.append(pr) or False,'a'*40))
        self.assertEqual(asked,[])
        bad=dict(done,source_pr=2)
        self.assertIsNone(select(policy,lambda ref:bad,[],lambda pr:True,'a'*40))
        with self.assertRaises(maintenance.Refusal):select(policy,lambda ref:bad,[],lambda pr:False,'a'*40)
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
        records[f'refs/db-index-maintenance/{op}/preview/complete']={'phase':'complete','operation_id':op,'target':'preview','source_pr':5757,'policy_digest':maintenance.digest(value)}
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
                 patch.object(promotion,'workflow_runs',side_effect=runs) as fetch,patch.object(promotion,'prefetch_holds',return_value=lambda pr:[]) as holds,\
                 patch.object(automatic.time,'monotonic',side_effect=clock),patch.object(automatic.time,'sleep') as sleep,\
                 patch.object(automatic.subprocess,'run') as dispatch,patch.object(sys,'argv',['automatic_index_maintenance.py']):
                self.assertEqual(automatic.main(),0)
            self.holds,self.fetch=holds,fetch
            return fetch.call_count,sleep.call_count,dispatch.call_count,output.read_text() if output.exists() else ''
    def test_waits_for_finishing_run_then_dispatches_and_signals_promotion_skip(self):
        active=[{'status':'in_progress'}]
        self.assertEqual(self.run_main([active,active,[],[]],[0,1,2]),(4,2,1,'dispatched=true\n'))
        # #6493 Step 1c: attempts are counted from a fresh re-read, never the cache.
        self.assertEqual(self.fetch.call_args.kwargs,{'fresh_since':promotion.ACTIVATED_AT})
    def test_idle_queue_does_not_sleep(self):
        self.assertEqual(self.run_main([[],[]],[0]),(2,0,1,'dispatched=true\n'))
        self.holds.assert_called_once()
    def test_wait_is_bounded_and_active_queue_dispatches_nothing(self):
        active=[{'status':'in_progress'}]
        self.assertEqual(self.run_main([active,active],[0,1,automatic.ACTIVE_WAIT_S]),(2,1,0,''))
        # Nothing dispatchable: no hold read, so no 20 s settle.
        self.holds.assert_not_called()
    def test_automatic_selector_is_part_of_existing_trigger(self):
        text=(ROOT/'.github/workflows/automatic-production-trigger.yml').read_text()
        self.assertIn('python scripts/automatic_promotion_candidates.py',text)
        self.assertIn('python scripts/automatic_index_maintenance.py',text)
        self.assertLess(text.index('python scripts/automatic_promotion_candidates.py'),text.index('python scripts/automatic_index_maintenance.py'))
        # #6508: the lane guard runs before checkout and every later step
        # respects both its skip and the promotion dispatch. The guard must
        # count dispatched lane runs only (--event workflow_dispatch), like the
        # selector's own wait; CI runs never hold the lane.
        self.assertIn("github.event.workflow_run.event != 'workflow_dispatch' && '-ci-noise' || ''",text)
        self.assertIn('id: lane_guard',text)
        self.assertLess(text.index('id: lane_guard'),text.index('uses: actions/checkout@v4'))
        self.assertIn('--event workflow_dispatch',text)
        self.assertIn('- id: checkout\n        uses: actions/checkout@v4',text)
        selector_block=text[text.index('- name: Start the next automatic promotion'):text.index('- name: Save the selector PR cache')]
        self.assertIn('id: selector',selector_block)
        self.assertIn("if: steps.lane_guard.outputs.skipped != 'true'",selector_block)
        self.assertNotIn('always()',selector_block)
        maintenance_block=text[text.index('- name: Select an explicitly enabled exact-index maintenance operation'):text.index('- name: Save the workflow-run cache')]
        self.assertIn('id: index_maintenance',maintenance_block)
        self.assertIn("if: always() && steps.lane_guard.outputs.skipped != 'true' && steps.checkout.outcome == 'success' && steps.selector.outputs.dispatched != 'true'",maintenance_block)
        save_cache_block=text[text.index('- name: Save the workflow-run cache'):]
        self.assertIn("if: always() && (steps.selector.outcome != 'skipped' || steps.index_maintenance.outcome != 'skipped')",save_cache_block)

    def _maintenance_run(self,operation_id,target,sha,conclusion='failure',run_attempt=1):
        dispatch_ref=f'refs/db-index-maintenance-operations/{operation_id}/{target}/{sha}'
        return {
            'display_title':f'INDEX {target} {dispatch_ref} {sha}',
            'conclusion':conclusion,
            'run_attempt':run_attempt,
        },dispatch_ref

    def test_attempts_accumulate_across_different_main_shas(self):
        op,target,digest='test-operation','preview','digest-1'
        receipts={}
        runs=[]
        for ch in ('a','b','c'):
            run,ref=self._maintenance_run(op,target,ch*40)
            runs.append(run)
            receipts[ref]={'operation_id':op,'target':target,'policy_digest':digest}
        self.assertEqual(automatic.failed_attempts_for_operation(runs,op,target,digest,receipts.get),3)

    def test_startup_failure_counts_toward_attempt_cap(self):
        op,target,digest='test-operation','preview','digest-1'
        run,ref=self._maintenance_run(op,target,'a'*40,conclusion='startup_failure')
        receipts={ref:{'operation_id':op,'target':target,'policy_digest':digest}}
        self.assertEqual(automatic.failed_attempts_for_operation([run],op,target,digest,receipts.get),1)

    def test_rerun_attempt_counts_toward_attempt_cap(self):
        op,target,digest='test-operation','preview','digest-1'
        run_ok,ref_ok=self._maintenance_run(op,target,'a'*40,conclusion='success',run_attempt=2)
        run_fail,ref_fail=self._maintenance_run(op,target,'b'*40,conclusion='failure',run_attempt=2)
        receipts={
            ref_ok:{'operation_id':op,'target':target,'policy_digest':digest},
            ref_fail:{'operation_id':op,'target':target,'policy_digest':digest},
        }
        self.assertGreaterEqual(automatic.failed_attempts_for_operation([run_ok],op,target,digest,receipts.get),1)
        self.assertEqual(automatic.failed_attempts_for_operation([run_fail],op,target,digest,receipts.get),2)

    def test_attempt_matching_rejects_operation_id_prefix_collision(self):
        digest='digest-1'
        r1,_=self._maintenance_run('repack-10','preview','a'*40)
        r2,_=self._maintenance_run('repack-1','production','b'*40)
        self.assertEqual(automatic.failed_attempts_for_operation([r1,r2],'repack-1','preview',digest,lambda ref:None),0)

    def test_attempt_matching_ignores_malformed_titles(self):
        op,target,digest='test-operation','preview','digest-1'
        sha='a'*40
        bad_titles=[
            f'INDEX {target} refs/db-index-maintenance-operations/{op}/{target}/{sha}',
            f'INDEX {target} refs/db-index-maintenance-operations/{op}/{target}/{"g"*40} {"g"*40}',
            f'INDEX {target} refs/db-index-maintenance-operations/{op}/{target}/{sha} {sha} extra',
            None,
        ]
        runs=[{'display_title':t,'conclusion':'failure','run_attempt':1} for t in bad_titles]
        self.assertEqual(automatic.failed_attempts_for_operation(runs,op,target,digest,lambda ref:None),0)

    def test_unreadable_or_missing_dispatch_receipt_counts_fail_closed(self):
        op,target,digest='test-operation','preview','digest-1'
        run,_=self._maintenance_run(op,target,'a'*40)
        def raise_cpe(_):raise subprocess.CalledProcessError(1,'git')
        def raise_val(_):raise ValueError('bad json')
        for reader in (lambda _:None,lambda _:'corrupt',lambda _:[],raise_cpe,raise_val):
            with self.subTest(reader=reader):
                self.assertEqual(automatic.failed_attempts_for_operation([run],op,target,digest,reader),1)

    def test_mismatched_receipt_identity_counts_fail_closed(self):
        op,target,digest='test-operation','preview','digest-1'
        run,_=self._maintenance_run(op,target,'a'*40)
        mismatches=[
            {'operation_id':'other-op','target':target,'policy_digest':'old-digest'},
            {'operation_id':op,'target':'production','policy_digest':'old-digest'},
        ]
        for receipt in mismatches:
            with self.subTest(receipt=receipt):
                self.assertEqual(automatic.failed_attempts_for_operation([run],op,target,digest,lambda _:receipt),1)

    def test_policy_digest_change_resets_attempt_budget(self):
        op,target='test-operation','preview'
        old_digest,new_digest='old-digest','new-digest'
        receipts={}
        runs=[]
        for ch in ('a','b','c'):
            run,ref=self._maintenance_run(op,target,ch*40)
            runs.append(run)
            receipts[ref]={'operation_id':op,'target':target,'policy_digest':old_digest}
        self.assertEqual(automatic.failed_attempts_for_operation(runs,op,target,new_digest,receipts.get),0)

    def test_exhausted_operation_is_skipped_and_alerts_so_next_runs(self):
        policy={'schema_version':1,'operations':{'op-a':entry(),'op-b':entry()}}
        buf=io.StringIO()
        with contextlib.redirect_stdout(buf):
            picked=select(policy,lambda ref:None,[],lambda pr:False,'a'*40,exhausted=lambda op,t,e:op=='op-a')
        self.assertEqual(picked['operation_id'],'op-b')
        out=buf.getvalue()
        self.assertIn('::error title=ENGINEER ACTION REQUIRED: index maintenance attempts exhausted::',out)
        self.assertIn('op-a',out)

    def test_lazy_attempt_fetch_not_called_when_no_op_is_ready(self):
        done_entry=entry()
        held_entry={**entry(),'source_pr':2}
        policy={'schema_version':1,'operations':{'op-done':done_entry,'op-held':held_entry}}
        done_receipt={'phase':'complete','operation_id':'op-done','target':'production','source_pr':1,'policy_digest':maintenance.digest(done_entry)}
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'policy.json';path.write_text(json.dumps(policy))
            receipts=MagicMock()
            receipts.read.side_effect=lambda ref:done_receipt if ref=='refs/db-index-maintenance/op-done/production/complete' else None
            with patch.dict(os.environ,{'GITHUB_REPOSITORY':maintenance.REPO}),patch.object(maintenance,'POLICY',path),\
                 patch.object(maintenance,'Receipts',return_value=receipts),patch.object(maintenance,'gh',return_value={'sha':'a'*40}),\
                 patch.object(promotion,'workflow_runs',return_value=[]) as fetch,\
                 patch.object(promotion,'prefetch_holds',return_value=lambda pr:pr==2),\
                 patch.object(sys,'argv',['automatic_index_maintenance.py']),\
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(automatic.main(),0)
            self.assertEqual(fetch.call_count,1)
            self.assertFalse(any('fresh_since' in c.kwargs for c in fetch.call_args_list))

    def test_bad_completion_receipt_still_refuses_when_exhausted_supplied(self):
        val=entry()
        policy={'schema_version':1,'operations':{'test-operation':val}}
        bad={'phase':'complete','operation_id':'test-operation','target':'production','source_pr':2,'policy_digest':maintenance.digest(val)}
        with self.assertRaises(maintenance.Refusal):
            select(policy,lambda ref:bad,[],lambda pr:False,'a'*40,exhausted=lambda *_:False)
        runs=[self._maintenance_run('test-operation','preview',ch*40)[0] for ch in ('a','b')]
        picked=select(
            policy,lambda ref:None,[],lambda pr:False,'c'*40,
            exhausted=lambda op,t,e:automatic.failed_attempts_for_operation(runs,op,t,maintenance.digest(e),lambda _:None)>=automatic.MAX_ATTEMPTS,
        )
        self.assertEqual(picked['operation_id'],'test-operation')


if __name__=='__main__':unittest.main()
