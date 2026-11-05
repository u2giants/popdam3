"""Execute the real workflow/credential gate with mocked process/API boundaries.

All data is synthetic. No GitHub, secret service, network or database calls occur.
"""
import argparse
import io
from contextlib import redirect_stdout
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import nontransactional_index_maintenance as maintenance
import review_finding_hold
import automatic_index_maintenance as automatic
import automatic_promotion_candidates as promotion
from test_nontransactional_index_maintenance import entry,FakeDB,MemoryReceipts

PREVIEW='a'*20
HEAD='b'*40
MERGE='c'*40
OP='sg-hnsw-rebuild-5616-v1'


class WorkflowGateTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.root=Path(self.directory.name)
        temp=self.root/'supabase/.temp';temp.mkdir(parents=True)
        (temp/'project-ref').write_text(PREVIEW)
        (temp/'pooler-url').write_text(f'postgresql://postgres.{PREVIEW}@fixture.invalid:5432/postgres?sslmode=require')
        self.entry=entry()
        self.options=argparse.Namespace(operation=OP,target='preview',expected_project_ref=PREVIEW,
            source_sha=HEAD,dispatch_ref=f'refs/db-index-maintenance-operations/{OP}/preview/{HEAD}',linked_dir=self.root)
        self.env=dict(GITHUB_ACTIONS='true',GITHUB_REPOSITORY=maintenance.REPO,GITHUB_EVENT_NAME='workflow_dispatch',
            GITHUB_RUN_ATTEMPT='1',GITHUB_ACTOR='github-actions[bot]',GITHUB_WORKFLOW_REF=maintenance.REPO+'/.github/workflows/'+maintenance.WORKFLOW+'@refs/heads/main',
            GITHUB_RUN_ID='123',PREVIEW_PROJECT_REF=PREVIEW,EXPECTED_PROJECT_REF=PREVIEW,SUPABASE_DB_PASSWORD='synthetic-not-a-secret')
        self.run=dict(id=123,path='.github/workflows/'+maintenance.WORKFLOW,head_sha=HEAD,head_branch='main',
            event='workflow_dispatch',status='in_progress',conclusion=None,run_attempt=1,
            actor={'login':'github-actions[bot]'},triggering_actor={'login':'github-actions[bot]'},
            display_title=f'INDEX preview {self.options.dispatch_ref} {HEAD}')
        self.pr=dict(merged_at='synthetic-merged',base={'ref':'main'},merge_commit_sha=MERGE)
        self.policy={'schema_version':1,'operations':{OP:self.entry}}
        self.dispatch=dict(operation_id=OP,target='preview',source_sha=HEAD,policy_digest=maintenance.digest(self.entry))
        self.admitted=True;self.findings=[];self.calls=[]

    def tearDown(self):self.directory.cleanup()

    def process(self,args,**kwargs):
        self.calls.append(args)
        if args==['git','rev-parse','HEAD']:out=HEAD
        elif args[:3]==['git','merge-base','--is-ancestor']:out=''
        elif args[:2]==['git','show']:out=json.dumps(self.policy)
        elif args[0]=='node':out=json.dumps({'admitted':self.admitted})
        else:raise AssertionError('unexpected process boundary')
        return subprocess.CompletedProcess(args,0,out,'')

    def api(self,endpoint):
        if endpoint=='actions/runs/123':return self.run
        if endpoint=='commits/main':return {'sha':HEAD}
        if endpoint=='pulls/1':return self.pr
        raise AssertionError('unexpected API boundary '+endpoint)

    def execute_gate(self):
        with patch.dict(os.environ,self.env,clear=True),patch.object(maintenance,'gh',side_effect=self.api),patch.object(maintenance.subprocess,'run',side_effect=self.process),patch.object(maintenance.Receipts,'read',return_value=self.dispatch),patch.object(review_finding_hold,'gh_issues',return_value=[]),patch.object(review_finding_hold,'blocking_findings',return_value=self.findings):
            return maintenance.workflow_gate(self.options,self.entry)

    def test_real_gate_accepts_exact_automatic_preview_and_canonical_protected_credentials(self):
        result=self.execute_gate()
        self.assertEqual(result['PGHOST'],'fixture.invalid')
        self.assertEqual(result['PGUSER'],'postgres.'+PREVIEW)
        self.assertEqual(result['PGPORT'],'5432')
        self.assertEqual(result['_SOURCE_MERGE_SHA'],MERGE)
        self.assertTrue(any(args[0]=='node' and args[-1]=='admit' for args in self.calls))

    def test_enabled_automatic_selector_dispatch_is_consumed_by_real_preview_gate(self):
        policy_path=self.root/'synthetic-policy.json';policy_path.write_text(json.dumps(self.policy))
        records={};dispatches=[]
        def read(ref):return records.get(ref)
        def create(ref,value):records[ref]=value;return value
        def dispatch_process(args,**kwargs):
            self.assertEqual(args[:3],['gh','workflow','run'])
            fields=dict(args[i+1].split('=',1) for i,value in enumerate(args) if value=='-f')
            dispatches.append(fields)
            return subprocess.CompletedProcess(args,0,'','')
        with patch.dict(os.environ,self.env,clear=True),patch.object(maintenance,'POLICY',policy_path),patch.object(maintenance,'gh',side_effect=self.api),patch.object(promotion,'workflow_runs',return_value=[]),patch.object(promotion,'is_held',return_value=False),patch.object(maintenance.Receipts,'read',side_effect=read),patch.object(maintenance.Receipts,'create',side_effect=create),patch.object(automatic.subprocess,'run',side_effect=dispatch_process),patch.object(sys,'argv',['automatic_index_maintenance.py']),redirect_stdout(io.StringIO()):
            self.assertEqual(automatic.main(),0)
        self.assertEqual(len(dispatches),1)
        fields=dispatches[0]
        self.assertEqual(fields['target'],'preview')
        self.assertEqual(fields['mode'],'apply')
        self.assertNotIn('preview_allowlist',fields)
        self.options.dispatch_ref=fields['migration_train_ref']
        self.options.source_sha=fields['commit_sha']
        self.dispatch=records[self.options.dispatch_ref]
        self.assertEqual(self.execute_gate()['_SOURCE_MERGE_SHA'],MERGE)

    def test_each_wrong_live_run_binding_refuses_before_native_admission_or_credentials(self):
        cases=[('id',999),('path','.github/workflows/other.yml'),('head_sha','d'*40),('head_branch','other'),
            ('event','push'),('status','completed'),('conclusion','failure'),('run_attempt',2),
            ('actor',{'login':'u2giants'}),('triggering_actor',{'login':'u2giants'}),('display_title','unrelated')]
        for key,value in cases:
            before=copy.deepcopy(self.run);self.run[key]=value;self.calls=[]
            with self.subTest(key=key),self.assertRaisesRegex(maintenance.Refusal,'live automatic workflow run proof'):self.execute_gate()
            self.assertFalse(any(args[0]=='node' for args in self.calls));self.run=before

    def test_manual_context_and_replay_refuse_even_when_api_proof_would_pass(self):
        for key,value in [('GITHUB_ACTOR','u2giants'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_EVENT_NAME','push')]:
            before=self.env[key];self.env[key]=value
            with self.subTest(key=key),self.assertRaises(maintenance.Refusal):self.execute_gate()
            self.env[key]=before

    def test_changed_protected_preview_ref_refuses_old_link(self):
        self.env['PREVIEW_PROJECT_REF']='e'*20
        with self.assertRaisesRegex(maintenance.Refusal,'currently configured preview'):self.execute_gate()

    def test_production_never_substitutes_for_preview(self):
        self.env['PREVIEW_PROJECT_REF']=maintenance.PROD
        with self.assertRaisesRegex(maintenance.Refusal,'preview reference'):self.execute_gate()

    def test_missing_link_wrong_link_and_transaction_pooler_refuse(self):
        temp=self.root/'supabase/.temp'
        for change in ['ref','missing','port']:
            (temp/'project-ref').write_text(PREVIEW)
            (temp/'pooler-url').write_text(f'postgresql://postgres.{PREVIEW}@fixture.invalid:5432/postgres?sslmode=require')
            if change=='ref':(temp/'project-ref').write_text('e'*20)
            elif change=='missing':(temp/'pooler-url').unlink()
            else:(temp/'pooler-url').write_text(f'postgresql://postgres.{PREVIEW}@fixture.invalid:6543/postgres?sslmode=require')
            with self.subTest(change=change),self.assertRaises(maintenance.Refusal):self.execute_gate()

    def test_policy_cannot_borrow_an_unrelated_historical_merged_pr(self):
        self.policy['operations'][OP]={**self.entry,'work_issue':9999}
        with self.assertRaisesRegex(maintenance.Refusal,'authored'):self.execute_gate()

    def test_missing_dispatch_claim_and_finding_each_refuse(self):
        self.dispatch['policy_digest']='0'*64
        with self.assertRaisesRegex(maintenance.Refusal,'dispatch receipt'):self.execute_gate()
        self.dispatch['policy_digest']=maintenance.digest(self.entry);self.admitted=False
        with self.assertRaisesRegex(maintenance.Refusal,'claim admission'):self.execute_gate()
        self.admitted=True;self.findings=[{'number':9999}]
        with self.assertRaisesRegex(maintenance.Refusal,'review finding'):self.execute_gate()


class PreviewReceiptBindingTests(unittest.TestCase):
    def runner(self,project_ref):
        db=FakeDB();receipts=MemoryReceipts();identity=dict(target='production',project_ref=maintenance.PROD,
            preview_project_ref=PREVIEW,source_sha=HEAD,execution_sha=HEAD,executor_digest='d'*64,source_pr=1,run_id=123)
        runner=maintenance.Maintenance(db,receipts,entry(),identity,'synthetic-operation',lambda:None)
        receipts.records[runner.receipt_ref('complete','preview')]={**identity,'target':'preview','project_ref':project_ref,
            'phase':'complete','operation_id':'synthetic-operation','policy_digest':maintenance.digest(entry())}
        return runner

    def test_only_current_configured_preview_receipt_is_accepted(self):
        runner=self.runner(PREVIEW)
        self.assertEqual(runner.read('complete','preview')['project_ref'],PREVIEW)

    def test_stale_preview_or_production_ref_cannot_supply_preview_proof(self):
        for wrong in ['e'*20,maintenance.PROD,None]:
            with self.subTest(wrong=wrong),self.assertRaisesRegex(maintenance.Refusal,'currently configured preview'):
                self.runner(wrong).read('complete','preview')


if __name__=='__main__':unittest.main()
