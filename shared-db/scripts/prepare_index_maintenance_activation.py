#!/usr/bin/env python3
"""Render, validate and print an exact SG maintenance candidate; never activate.

Coordinator supplies its OWN source PR/claim after dependencies clear. No file,
GitHub, credential, connection or database action is performed by this helper.
"""
import argparse
import json
import nontransactional_index_maintenance as maintenance

OPERATION_ID='sg-hnsw-rebuild-5616-v1'
DEFINITION=(f'CREATE INDEX {maintenance.INDEX} ON {maintenance.TABLE} USING hnsw '
            '(embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)')


def prepare(source_pr,claim_issue):
    if type(source_pr) is not int or source_pr<=0 or type(claim_issue) is not int or claim_issue<=0:
        raise maintenance.Refusal('coordinator-owned positive source PR and claim issue are required')
    entry=dict(source_pr=source_pr,work_issue=5616,claim_issue=claim_issue,
        definition_sha256=maintenance.digest(maintenance.normalized_definition(DEFINITION,maintenance.INDEX)),
        lock_timeout_ms=500,statement_timeout_ms=900000,swap_timeout_ms=2500,total_timeout_s=1800)
    policy={'schema_version':1,'operations':{OPERATION_ID:entry}}
    maintenance.operation(policy,OPERATION_ID)
    original,new,retired=maintenance.names(OPERATION_ID)
    return dict(operation_id=OPERATION_ID,definition=DEFINITION,
        expected_writes=['table '+maintenance.TABLE,*['index public.'+name for name in (original,new,retired)]],
        policy=policy,notes=['candidate only; committed policy remains empty',
            'source PR must author this identical policy entry at its own merge commit',
            'coordinator must hold all exact object writes without foreign claim collision',
            'preview first; production requires matching current protected preview and successful exact workflow proof',
            '15-minute per-statement, 30-minute total, 500ms lock, 2500ms swap ceilings; no automatic enlargement'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-pr',required=True,type=int)
    parser.add_argument('--claim-issue',required=True,type=int)
    parser.add_argument('--policy-only',action='store_true',help='Print candidate policy only; never write the active configuration')
    options=parser.parse_args()
    result=prepare(options.source_pr,options.claim_issue)
    print(json.dumps(result['policy'] if options.policy_only else result,indent=2,sort_keys=True))


if __name__=='__main__':main()
