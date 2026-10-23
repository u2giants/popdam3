import copy
import unittest
from scripts.qualify_automatic_promotion_train import qualify

class AutomaticTrainTests(unittest.TestCase):
 def setUp(self):
  self.i=dict(active=True,target='preview',mode='apply',historical_map='20261022221940:4648,20261023014911:4673',allowlist='20261022221940,20261023014911',main='a'*40,ref='refs/db-migration-trains/'+'b'*64+'/000002-dispatched')
  self.entries=[dict(version='20261022221940',source_pr=4648,merge_sha='c'*40),dict(version='20261023014911',source_pr=4673,merge_sha='d'*40)]
  self.train=dict(state='dispatched',target='production',base_main_sha='a'*40,entries=self.entries)
  self.recovery=dict(schema='shared-db-historical-preview-source/v4',mainSha='a'*40,allowlist=self.i['allowlist'].split(','),sourcePrMap={e['version']:e['source_pr'] for e in self.entries},sourceMergeShas={e['version']:e['merge_sha'] for e in self.entries})
  self.calls=[]
  self.deps=dict(read_train=lambda *a:self.train,prove_sources=self.prove,closing_issues=lambda pr:[dict(number=3869,state='OPEN')],prove_originals=lambda *a:self.calls.append('originals'))
 def prove(self,*a):self.calls.append('all-sources');return {4648:('h','m'),4673:('h','m')}
 def go(self):return qualify(self.i,self.recovery,**self.deps)
 def test_valid_last_source_and_full_proof(self):
  self.assertEqual(self.go(),dict(source_pr=4673,source_merge_sha='d'*40,work_issue=3869,migration_train_ref=self.i['ref']));self.assertEqual(self.calls,['all-sources','originals'])
 def test_wrong_modes_and_competing_selectors(self):
  original=copy.deepcopy(self.i)
  for k,v in [('active',False),('target','production'),('mode','dry-run'),('historical_map',''),('source_pr','4648'),('source_map','x'),('historical_pr','4673'),('claim_pr','1'),('claim_head','a'*40),('production_pr','4673')]:
   with self.subTest(k=k):self.i=original|{k:v};self.assertRaises(ValueError,self.go)
 def test_wrong_native_record_or_stale_ref(self):
  for k,v in [('state','authorized'),('target','preview'),('base_main_sha','e'*40)]:
   with self.subTest(k=k):self.train[k]=v;self.assertRaises(ValueError,self.go);self.setUp()
  def fail(*a):raise ValueError('native latest immutable ref refusal')
  self.deps['read_train']=fail;self.assertRaisesRegex(ValueError,'immutable',self.go)
 def test_map_and_merge_and_main_drift(self):
  for k,v in [('schema','forged'),('mainSha','b'*40),('allowlist',['20261022221940']),('sourcePrMap',{'20261022221940':4673}),('sourceMergeShas',{})]:
   with self.subTest(k=k):self.recovery[k]=v;self.assertRaises(ValueError,self.go);self.setUp()
 def test_train_map_drift(self):
  self.entries[0]['source_pr']=999;self.assertRaises(ValueError,self.go)
 def test_no_partial_all_source_proof(self):
  self.deps['prove_sources']=lambda *a:{4673:('h','m')};self.assertRaises(ValueError,self.go);self.assertNotIn('originals',self.calls)
 def test_all_source_proof_failure_propagates(self):
  def fail(*a):raise ValueError('CI/hash/guarded-merge/ancestry refused')
  self.deps['prove_sources']=fail;self.assertRaisesRegex(ValueError,'ancestry',self.go)
 def test_issue_binding_refusals(self):
  for rows in [[],[dict(number=3869,state='CLOSED')],[dict(number=3869,state='OPEN'),dict(number=1,state='OPEN')]]:
   self.deps['closing_issues']=lambda pr:rows;self.assertRaises(ValueError,self.go)
  self.deps['closing_issues']=lambda pr:[dict(number=pr,state='OPEN')];self.assertRaisesRegex(ValueError,'different',self.go)
 def test_original_proof_failure_no_ephemeral_fallback(self):
  def fail(*a):raise ValueError('historical producer refused')
  self.deps['prove_originals']=fail;self.assertRaisesRegex(ValueError,'producer',self.go)
 def test_exact_two_distinct_ordered_sources(self):
  self.entries.reverse();self.assertRaises(ValueError,self.go)
  self.setUp();self.entries[0]['source_pr']=4673;self.assertRaises(ValueError,self.go)
  self.setUp();self.i['allowlist']='20261022221940';self.assertRaises(ValueError,self.go)
if __name__=='__main__':unittest.main()
