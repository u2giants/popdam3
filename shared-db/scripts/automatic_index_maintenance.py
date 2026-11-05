#!/usr/bin/env python3
"""Select one explicitly enabled exact-index operation; empty policy is a no-op.

Called only by the existing automatic promotion trigger. Never executes SQL.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import nontransactional_index_maintenance as maintenance

ACTIVE_WAIT_S=120
ACTIVE_POLL_S=20


def select(policy,read_receipt,active_runs,held,source_sha):
    if active_runs:return None
    for operation_id in sorted(policy['operations']):
        entry=maintenance.operation(policy,operation_id)
        if held(entry['source_pr']):continue
        base=f'refs/db-index-maintenance/{operation_id}'
        def completed(target):
            record=read_receipt(base+'/'+target+'/complete')
            if record is None:return None
            if (record.get('phase')!='complete' or record.get('operation_id')!=operation_id
                or record.get('target')!=target or record.get('source_pr')!=entry['source_pr']
                or record.get('policy_digest')!=maintenance.digest(entry)):
                raise maintenance.Refusal('completion receipt binding refused')
            return record
        if completed('production') is not None:continue
        preview=completed('preview')
        target='production' if preview is not None else 'preview'
        return dict(operation_id=operation_id,target=target,source_sha=source_sha)
    return None


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dry-run',action='store_true');options=parser.parse_args()
    policy=json.loads(maintenance.POLICY.read_text())
    if set(policy)!={'schema_version','operations'} or policy['schema_version']!=1 or not isinstance(policy['operations'],dict):raise maintenance.Refusal('maintenance policy refused')
    if not policy['operations']:
        print('No index maintenance operations enabled.');return 0
    if os.environ.get('GITHUB_REPOSITORY')!=maintenance.REPO:raise maintenance.Refusal('canonical repository required')
    import automatic_promotion_candidates as promotion
    # The run that nudged this trigger is still finishing, so give it a bounded
    # moment to clear rather than losing this turn to a promotion (popdam3#804).
    deadline=time.monotonic()+ACTIVE_WAIT_S
    while True:
        runs=promotion.workflow_runs(maintenance.REPO)
        active=[r for r in runs if r.get('status') in {'queued','in_progress','requested','waiting','pending'}]
        if not active or time.monotonic()>=deadline:break
        time.sleep(ACTIVE_POLL_S)
    receipts=maintenance.Receipts()
    def verified_read(ref):
        record=receipts.read(ref)
        if record is not None and ref.endswith('/complete'):receipts.verify_run(record)
        return record
    candidate=select(policy,verified_read,active,lambda pr:bool(promotion.is_held(maintenance.REPO,pr)),maintenance.gh('commits/main')['sha'])
    if candidate is None:
        print('No ready index maintenance operation.');return 0
    # Existing 3-attempt policy, operation-qualified and exact main-qualified.
    dispatch_ref=f"refs/db-index-maintenance-operations/{candidate['operation_id']}/{candidate['target']}/{candidate['source_sha']}"
    title=f"INDEX {candidate['target']} {dispatch_ref} {candidate['source_sha']}"
    attempts=[r for r in runs if r.get('display_title')==title and r.get('conclusion') in {'failure','cancelled','timed_out'}]
    if len(attempts)>=3:raise maintenance.Refusal('maintenance automatic attempts exhausted; preserve same-issue recovery custody')
    print(json.dumps(candidate))
    if options.dry_run:return 0
    maintenance.Receipts().create(dispatch_ref,{'operation_id':candidate['operation_id'],'target':candidate['target'],
        'source_sha':candidate['source_sha'],'policy_digest':maintenance.digest(maintenance.operation(policy,candidate['operation_id']))})
    subprocess.run(['gh','workflow','run',maintenance.WORKFLOW,'--repo',maintenance.REPO,'--ref','main',
                    '-f','target='+candidate['target'],'-f','mode=apply','-f','commit_sha='+candidate['source_sha'],
                    '-f','migration_train_ref='+dispatch_ref],check=True)
    output=os.environ.get('GITHUB_OUTPUT')
    if output:
        with open(output,'a') as handle:handle.write('dispatched=true\n')
    return 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        print('Index maintenance selection refused: '+type(error).__name__,file=sys.stderr);raise SystemExit(2)
