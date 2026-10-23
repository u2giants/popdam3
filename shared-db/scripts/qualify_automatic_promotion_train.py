"""Read-only qualifier for the existing automatic job; never preview apply or SQL."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
try:
 from .historical_preview_recovery import parse_source_map, parse_versions
 from .production_business_risk_gate import prove_migration_train, prove_historical_original_apply_runs, gh_json, download_artifact
except ImportError:
 from historical_preview_recovery import parse_source_map, parse_versions
 from production_business_risk_gate import prove_migration_train, prove_historical_original_apply_runs, gh_json, download_artifact


def qualify(inputs, recovery, *, read_train, prove_sources, closing_issues, prove_originals):
 if inputs.get('active') is not True: raise ValueError('automatic policy is not active')
 if inputs.get('target')!='preview' or inputs.get('mode')!='apply' or not inputs.get('historical_map'):
  raise ValueError('train automatic qualification requires mapped historical preview apply')
 if any(inputs.get(k) for k in ('source_pr','source_map','historical_pr','claim_pr','claim_head','production_pr')):
  raise ValueError('train automatic qualification refuses competing source selectors')
 versions=parse_versions(inputs['allowlist'])
 if len(versions)!=2: raise ValueError('automatic train requires exactly two ordered versions')
 mapping=parse_source_map(inputs['historical_map'],versions)
 record=read_train(inputs['ref'],inputs['main'],inputs['allowlist'])
 entries=record.get('entries',[])
 if record.get('state')!='dispatched' or record.get('target')!='production' or record.get('base_main_sha')!=inputs['main']:
  raise ValueError('qualified train state, target or main mismatch')
 if [e.get('version') for e in entries]!=versions or len({e.get('source_pr') for e in entries})!=2:
  raise ValueError('qualified train must have two distinct authoring sources and exact ordered versions')
 if mapping!={e['version']:e['source_pr'] for e in entries}: raise ValueError('historical map differs from qualified train')
 if recovery.get('schema')!='shared-db-historical-preview-source/v4': raise ValueError('immutable mapped recovery schema mismatch')
 if recovery.get('mainSha')!=inputs['main'] or recovery.get('allowlist')!=versions or recovery.get('sourcePrMap')!=mapping:
  raise ValueError('immutable recovery proof map/main/allowlist mismatch')
 if recovery.get('sourceMergeShas')!={e['version']:e['merge_sha'] for e in entries}:
  raise ValueError('immutable recovery merge map differs from train')
 # Full native proof: every authoring PR checks, guarded merge, ancestry and bytes.
 sources=prove_sources(record,inputs['main'],versions)
 if set(sources)!={e['source_pr'] for e in entries}: raise ValueError('all-source proof is incomplete')
 issue=None
 for entry in entries:
  linked=closing_issues(entry['source_pr'])
  if not isinstance(linked,list) or len(linked)!=1 or linked[0].get('state')!='OPEN' or type(linked[0].get('number')) is not int:
   raise ValueError('each train source must bind exactly one open work issue')
  number=linked[0]['number']
  if number<1 or (issue is not None and number!=issue): raise ValueError('train sources bind different work issues')
  issue=number
 prove_originals(recovery,inputs['main'],versions)
 last=entries[-1]
 return {'source_pr':last['source_pr'],'source_merge_sha':last['merge_sha'],'work_issue':issue,'migration_train_ref':inputs['ref']}


def main():
 p=argparse.ArgumentParser()
 for name in ['target','mode','historical-map','source-pr','source-map','historical-pr','claim-pr','claim-head','production-pr']:
  p.add_argument('--'+name,default='')
 for name in ['ref','main','allowlist','recovery','train-output']:
  p.add_argument('--'+name,required=True)
 a=vars(p.parse_args()); root=Path.cwd()
 a['active']=json.loads((root/'config/production-risk-policy-activation.json').read_text()).get('active')
 def read_train(ref,sha,allow):
  subprocess.run(['node','scripts/manage-migration-author-lanes.mjs','--verify-train-dispatch',ref,'--target','production','--commit-sha',sha,'--allowlist',allow],check=True,stdout=subprocess.DEVNULL)
  subprocess.run(['node','scripts/db-flow/read-verified-train-record.mjs','--ref',ref,'--target','production','--commit-sha',sha,'--allowlist',allow,'--output',a['train_output']],check=True)
  return json.loads(Path(a['train_output']).read_text())
 def closing(pr):
  code="import{githubIo}from './scripts/manage-migration-author-lanes.mjs';console.log(JSON.stringify(githubIo.closingIssuesForPr(Number(process.argv[1]))))"
  return json.loads(subprocess.check_output(['node','--input-type=module','-e',code,str(pr)],text=True))
 try:
  out=qualify(a,json.loads(Path(a['recovery']).read_text()),read_train=read_train,
   prove_sources=lambda r,m,v:prove_migration_train(r,main_sha=m,allowlist=v,api=gh_json,repo_root=root),closing_issues=closing,
   prove_originals=lambda r,m,v:prove_historical_original_apply_runs(record=r,allowlist=v,repo_root=root,main_sha=m,api=gh_json,downloader=download_artifact))
 except Exception as exc:
  print('::error::REFUSED automatic train qualification: '+str(exc),file=sys.stderr);return 2
 for key,value in out.items(): print(str(key)+'='+str(value))
 return 0
if __name__=='__main__': sys.exit(main())
