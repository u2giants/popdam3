"""Exercise the actual inline metadata classifier and post-matrix dispatch command."""
import copy
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BEFORE, AFTER, OLD_TREE, NEW_TREE = (c * 40 for c in 'abcd')

def template():
    return json.loads((ROOT / 'config/designflow-consumer-release-notify.yml').read_text())

def entry(path, sha='e' * 40, kind='blob', mode='100644'):
    return dict(path=path, sha=sha, type=kind, mode=mode)

def fixture():
    event = dict(before=BEFORE, after=AFTER, head_commit=dict(
        id=AFTER, author=dict(name='shared-db-sync[bot]'),
        message='chore: sync shared-db @ popcre/shared-db@1234567'))
    def tree(sha, mirror):
        return dict(sha=sha, truncated=False, tree=[entry('package.json'),
            entry('src', kind='tree', mode='040000'),
            entry('shared-db', mirror * 40, 'tree', '040000')])
    prefix = 'repos/popcre/designflow-tracking'
    api = {prefix + '/git/commits/' + BEFORE: dict(sha=BEFORE, tree=dict(sha=OLD_TREE)),
           prefix + '/git/commits/' + AFTER: dict(sha=AFTER, tree=dict(sha=NEW_TREE)),
           prefix + '/git/trees/' + OLD_TREE: tree(OLD_TREE, '1'),
           prefix + '/git/trees/' + NEW_TREE: tree(NEW_TREE, '2')}
    return event, api

FAKE_GH = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
with open(os.environ['FAKE_CALLS'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
if os.environ.get('FAIL_DISPATCH')=='true' and sys.argv[1:3]==['workflow','run']:sys.exit(42)
if sys.argv[1:3]==['workflow','run']:print('https://github.com/popcre/shared-db/actions/runs/123');sys.exit(0)
if len(sys.argv)!=3 or sys.argv[1]!='api':sys.exit(43)
v=json.loads(Path(os.environ['FAKE_API']).read_text()).get(sys.argv[2],{'error':True})
if v.get('error'):sys.exit(44)
print(json.dumps(v))
'''

class ClassifierTests(unittest.TestCase):
    def classify(self, event=None, api=None, event_name='push'):
        default_event, default_api = fixture()
        event = default_event if event is None else event
        api = default_api if api is None else api
        run = template()['jobs']['notify-central']['steps'][0]['run']
        self.assertTrue(run.startswith("python3 - <<'PY'\n") and run.endswith('PY\n'))
        script = run[len("python3 - <<'PY'\n"):-len('PY\n')]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            gh = root / 'gh';gh.write_text(FAKE_GH);gh.chmod(0o755)
            (root/'event.json').write_text(json.dumps(event))
            (root/'api.json').write_text(json.dumps(api))
            env = {**os.environ, 'PATH':str(root)+os.pathsep+os.environ['PATH'],
                   'GITHUB_EVENT_NAME':event_name, 'GITHUB_REPOSITORY':'popcre/designflow-tracking',
                   'GITHUB_EVENT_PATH':str(root/'event.json'), 'GITHUB_OUTPUT':str(root/'output'),
                   'FAKE_API':str(root/'api.json'), 'FAKE_CALLS':str(root/'calls'),
                   'GH_TOKEN':'synthetic-fixture-only'}
            result = subprocess.run([sys.executable, '-c', script], env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = (root/'output').read_text()
            calls = (root/'calls').read_text().splitlines() if (root/'calls').exists() else []
            return output == 'skip=true\n', calls

    def test_only_authentic_mirror_tree_change_is_batched(self):
        skip, calls = self.classify();self.assertTrue(skip);self.assertEqual(len(calls),4)
    def test_real_or_mixed_code_changes_notify_even_with_large_mirror(self):
        for path in ['src', 'package.json', '.release', '.github']:
            event, api = fixture();tree=api['repos/popcre/designflow-tracking/git/trees/'+NEW_TREE]['tree']
            tree[:] = [e for e in tree if e['path'] != path]
            tree.append(entry(path,'f'*40,'tree' if path != 'package.json' else 'blob', '040000' if path != 'package.json' else '100644'))
            with self.subTest(path=path):self.assertFalse(self.classify(event,api)[0])
    def test_all_main_pr_events_keep_existing_notification(self):
        for action in ['opened','reopened','synchronize','ready_for_review']:
            event,api=fixture();event['action']=action
            self.assertEqual(self.classify(event,api,'pull_request'),(False,[]))
    def test_ordinary_or_untrusted_messages_notify(self):
        for kind in ['message','author','id']:
            event,api=fixture()
            if kind=='author':event['head_commit']['author']['name']='a developer'
            elif kind=='message':event['head_commit']['message']='update copied documentation'
            else:event['head_commit']['id']='9'*40
            self.assertEqual(self.classify(event,api),(False,[]))
    def test_new_or_deleted_branch_not_suppressed(self):
        for key in ['before','after']:
            event,api=fixture();event[key]='0'*40
            self.assertEqual(self.classify(event,api),(False,[]))
    def test_api_error_and_incomplete_or_ambiguous_roots_notify(self):
        for kind in ['error','truncated','duplicate','identity','badsha','missingmirror','symlinkmirror']:
            event,api=fixture();record=api['repos/popcre/designflow-tracking/git/trees/'+NEW_TREE]
            if kind=='error':record['error']=True
            elif kind=='truncated':record['truncated']=True
            elif kind=='duplicate':record['tree'].append(copy.deepcopy(record['tree'][0]))
            elif kind=='identity':record['sha']='9'*40
            elif kind=='badsha':record['tree'][0]['sha']='unknown'
            elif kind=='missingmirror':record['tree']=[r for r in record['tree'] if r['path']!='shared-db']
            else:record['tree'][-1].update(type='blob',mode='120000')
            with self.subTest(kind=kind):self.assertFalse(self.classify(event,api)[0])
    def test_nonmirror_mode_change_and_no_actual_mirror_change_notify(self):
        event,api=fixture();root=api['repos/popcre/designflow-tracking/git/trees/'+NEW_TREE]
        root['tree'][0]['mode']='100755';self.assertFalse(self.classify(event,api)[0])
        event,api=fixture();api['repos/popcre/designflow-tracking/git/trees/'+NEW_TREE]['tree'][-1]['sha']='1'*40
        self.assertFalse(self.classify(event,api)[0])
    def test_skip_condition_wraps_both_token_mint_and_dispatch_only(self):
        steps=template()['jobs']['notify-central']['steps']
        self.assertNotIn('if',steps[0]);self.assertEqual(steps[0]['env'],{'GH_TOKEN':'${{ github.token }}'})
        for step in steps[1:]:self.assertEqual(step['if'],"steps.mirror-only.outputs.skip != 'true'")
        self.assertEqual(template()['on']['push'],{'branches':['develop','main']})
        self.assertNotIn('paths-ignore',template()['on']['push'])

class BatchTests(unittest.TestCase):
    def job(self):
        text=(ROOT/'.github/workflows/sync.yml').read_text()
        tail=text.split('  notify-designflow:',1)[1].lstrip()
        return json.JSONDecoder().raw_decode(tail)[0]
    def test_completion_is_after_entire_matrix_even_partial_failure(self):
        job=self.job();self.assertEqual(job['needs'],['sync'])
        self.assertIn('always()',job['if']);self.assertNotIn('needs.sync.result',job['if'])
        self.assertIn("github.ref == 'refs/heads/main'",job['if'])
        self.assertIn("github.repository == 'popcre/shared-db'",job['if'])
        self.assertEqual(job['timeout-minutes'],5)
    def test_one_fixed_dispatch_per_completion_and_failure_is_visible(self):
        job=self.job();self.assertEqual(len(job['steps']),1)
        step=job['steps'][0];self.assertEqual(step['env'],{'GH_TOKEN':'${{ secrets.SYNC_TOKEN }}'})
        for status in ['success','failure','cancelled','skipped']:
            with tempfile.TemporaryDirectory() as directory:
                root=pathlib.Path(directory);gh=root/'gh';gh.write_text(FAKE_GH);gh.chmod(0o755)
                env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],
                     'GITHUB_REPOSITORY':'popcre/shared-db','GH_TOKEN':'synthetic-fixture-only',
                     'FAKE_CALLS':str(root/'calls'),'SYNC_RESULT':status}
                result=subprocess.run(['bash','-c',step['run']],env=env,capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,0,result.stderr)
                calls=[json.loads(l) for l in (root/'calls').read_text().splitlines()]
                self.assertEqual(calls,[['workflow','run','designflow-db-release.yml','--repo','popcre/shared-db','--ref','main']])
                env['FAIL_DISPATCH']='true'
                result=subprocess.run(['bash','-c',step['run']],env=env,capture_output=True,text=True,timeout=10)
                self.assertNotEqual(result.returncode,0)

if __name__=='__main__':unittest.main(verbosity=2)
