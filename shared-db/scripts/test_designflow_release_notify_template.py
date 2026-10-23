import json, pathlib, unittest
P=pathlib.Path(__file__).resolve().parents[1]/'config'/'designflow-consumer-release-notify.yml'
class TemplateTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.raw=P.read_text();cls.w=json.loads(cls.raw)
 def test_exact_events(self):
  self.assertEqual(self.w['on'],{'push':{'branches':['develop','main']},'pull_request':{'branches':['main'],'types':['opened','reopened','synchronize','ready_for_review']}})
 def test_permission_and_timeout(self):
  self.assertEqual(self.w['permissions'],{'contents':'read'});j=self.w['jobs']['notify-central'];self.assertEqual(j['timeout-minutes'],5);self.assertIs(type(j['timeout-minutes']),int);self.assertNotIn('permissions',j)
 def test_no_checkout_or_application_execution(self):
  steps=self.w['jobs']['notify-central']['steps'];self.assertEqual(len(steps),2);self.assertEqual([s['uses'] for s in steps if 'uses' in s],['actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1']);self.assertNotRegex(self.raw,r'(?i)(checkout|npm |yarn |curl |SYNC_TOKEN|WATCHER|pull_request_target|schedule:)')
 def test_dedicated_narrow_app_token(self):
  s=self.w['jobs']['notify-central']['steps'][0]
  self.assertEqual(s['with'],{'app-id':'${{ vars.DFLOW_RELEASE_DISPATCH_APP_ID }}','private-key':'${{ secrets.DFLOW_RELEASE_DISPATCH_PRIVATE_KEY }}','owner':'popcre','repositories':'shared-db','permission-actions':'write'})
 def test_fixed_dispatch_no_inputs(self):
  s=self.w['jobs']['notify-central']['steps'][1];self.assertEqual(s['env'],{'GH_TOKEN':'${{ steps.dispatch-token.outputs.token }}'})
  self.assertEqual(s['run'],'''printf '%s' '{"ref":"main"}' | gh api --method POST \\
  repos/popcre/shared-db/actions/workflows/designflow-db-release.yml/dispatches \\
  --input -
''');self.assertNotIn('${{',s['run'])
 def test_event_guard_and_fork_cases(self):
  guard=self.w['jobs']['notify-central']['if'];self.assertEqual(guard,"github.repository_owner == 'popcre' && (github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository)")
  def admitted(owner,event,head,repo):return owner=='popcre' and (event=='push' or head==repo)
  for branch in ['develop','main']:self.assertTrue(admitted('popcre','push',None,'popcre/designflow-frontend'))
  for action in ['opened','reopened','synchronize','ready_for_review']:self.assertTrue(admitted('popcre','pull_request','popcre/designflow-frontend','popcre/designflow-frontend'))
  self.assertFalse(admitted('popcre','pull_request','outsider/designflow-frontend','popcre/designflow-frontend'));self.assertFalse(admitted('outsider','push',None,'outsider/designflow-frontend'))
 def test_no_required_gate_or_hook(self):
  self.assertEqual(set(self.w),{'name','on','permissions','jobs'});self.assertEqual(set(self.w['jobs']),{'notify-central'});self.assertNotIn('workflow_call',self.w['on']);self.assertNotIn('workflow_dispatch',self.w['on'])
if __name__=='__main__':unittest.main(verbosity=2)
