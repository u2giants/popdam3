#!/usr/bin/env python3
"""Disabled-by-default exact SG index replacement through the canonical workflow.

Only fixed generated SQL, no migrations/ledger edits or arbitrary object input.
No network or database activity on import. CLI requires workflow context and an
explicit merged policy entry. Production activation requires root's separate review.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from atomic_migration_apply import linked_connection, Refusal

ROOT=Path(__file__).resolve().parents[1]
POLICY=ROOT/'config/nontransactional-index-maintenance.json'
TABLE='public.style_guide_search_documents'
INDEX='idx_sg_search_documents_embedding_hnsw'
PROD='qsllyeztdwjgirsysgai'
REPO='popcre/shared-db'
WORKFLOW='shared-supabase-migrations.yml'
FIELDS={'source_pr','work_issue','claim_issue','definition_sha256','lock_timeout_ms','statement_timeout_ms','swap_timeout_ms','total_timeout_s'}


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def operation(policy,operation_id):
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,39}',operation_id):
        raise Refusal('invalid operation identity')
    if set(policy)!={'schema_version','operations'} or policy['schema_version']!=1 or not isinstance(policy['operations'],dict):
        raise Refusal('maintenance policy shape refused')
    entry=policy['operations'].get(operation_id)
    if operation_id.startswith('health-'):
        from health_initial_index_maintenance import validate_operation
        return validate_operation(entry,operation_id)
    if operation_id.startswith('repack-'):
        from table_repack_maintenance import validate_operation as validate_repack
        return validate_repack(entry,operation_id)
    if not isinstance(entry,dict) or set(entry)!=FIELDS:
        raise Refusal('operation is absent or policy entry is malformed')
    for field in ['source_pr','work_issue','claim_issue','lock_timeout_ms','statement_timeout_ms','swap_timeout_ms','total_timeout_s']:
        if type(entry[field]) is not int or entry[field]<=0:
            raise Refusal('policy integer refused')
    if not re.fullmatch('[a-f0-9]{64}',entry['definition_sha256']):
        raise Refusal('definition digest refused')
    # Above the 1 s deadlock_timeout, so a waiting build makes autovacuum yield.
    if not (entry['lock_timeout_ms']<=2000 and entry['lock_timeout_ms']<entry['swap_timeout_ms']<=3000
            and 1000<=entry['statement_timeout_ms']<=900000 and 10<=entry['total_timeout_s']<=3600):
        raise Refusal('operation budget refused')
    return dict(entry)


def operation_from_dispatch_ref(ref):
    match=re.fullmatch(r'refs/db-index-maintenance-operations/([a-z][a-z0-9-]{0,39})/(preview|production)/([a-f0-9]{40})',ref)
    if not match:raise Refusal('exact maintenance dispatch ref refused')
    return match[1]


def names(operation_id):
    suffix=hashlib.sha256(operation_id.encode()).hexdigest()[:12]
    return INDEX,'sg_hnsw_'+suffix+'_new','sg_hnsw_'+suffix+'_retired'


def normalized_definition(definition,name):
    # Names are fixed/derived, never user SQL. All remaining definition bytes must match.
    prefix='CREATE INDEX '+name+' ON '+TABLE+' '
    if not isinstance(definition,str) or not definition.startswith(prefix):
        raise Refusal('index definition identity refused')
    return definition[len(prefix):]


def validate_catalog(row,name,expected_hash,table_oid=None):
    if not row or row['schema']!='public' or row['table_name']!='style_guide_search_documents' or not row['valid'] or not row['ready']:
        raise Refusal('index identity/validity refused')
    if table_oid is not None and row['table_oid']!=table_oid:
        raise Refusal('owning table OID changed')
    if digest(normalized_definition(row['definition'],name))!=expected_hash or row['constraint_owned']:
        raise Refusal('index definition/constraint ownership changed')
    return row


def next_action(state,original,new,retired):
    """Crash reconciliation is catalog-based; never delete an ambiguous object."""
    if state is None:
        if original and not new and not retired:return 'start'
        raise Refusal('initial replacement names are occupied or original is absent')
    old_oid=state['original_oid']
    if original and original['oid']==old_oid:
        if retired:raise Refusal('unexpected retired object before swap')
        if new and new['valid'] and new['ready']:return 'swap'
        if new:return 'remove_incomplete_new'
        return 'build'
    if original and new is None and retired and retired['oid']==old_oid:
        return 'remove_retired'
    if original and new is None and retired is None and original['oid']!=old_oid:
        return 'complete'
    raise Refusal('ambiguous catalog state; preserve original capability and custody')


class Maintenance:
    def __init__(self,db,receipts,entry,identity,operation_id,gate,clock=time.monotonic):
        self.db,self.receipts,self.entry,self.identity,self.operation_id,self.gate=db,receipts,entry,identity,operation_id,gate
        self.clock=clock;self.started=clock()
        self.original,self.new,self.retired=names(operation_id)

    def receipt_ref(self,phase,target=None):
        return f"refs/db-index-maintenance/{self.operation_id}/{target or self.identity['target']}/{phase}"

    def read(self,phase,target=None):
        record=self.receipts.read(self.receipt_ref(phase,target))
        if record is not None:
            for key in ['operation_id','policy_digest','source_sha','source_pr','executor_digest']:
                expected=self.operation_id if key=='operation_id' else digest(self.entry) if key=='policy_digest' else self.identity[key]
                if record.get(key)!=expected:raise Refusal('maintenance receipt binding refused')
            if record.get('target')!=(target or self.identity['target']):raise Refusal('maintenance receipt target refused')
            if target is None and record.get('project_ref')!=self.identity['project_ref']:raise Refusal('maintenance receipt project refused')
            if target=='preview':
                configured=self.identity.get('preview_project_ref')
                if not isinstance(configured,str) or not re.fullmatch('[a-z]{20}',configured) or configured==PROD:
                    raise Refusal('current configured preview reference required')
                if record.get('project_ref')!=configured:
                    raise Refusal('preview receipt project is not the currently configured preview')
        return record

    def save(self,phase,start,**extra):
        prior=self.read(phase)
        if prior is not None:return prior
        record={**self.identity,'operation_id':self.operation_id,'policy_digest':digest(self.entry),
                'phase':phase,'original_oid':start['original_oid'],'table_oid':start['table_oid'],**extra}
        return self.receipts.create(self.receipt_ref(phase),record)

    def remaining_ms(self):
        remaining=int((self.entry['total_timeout_s']-(self.clock()-self.started))*1000)
        if remaining<=0:raise Refusal('maintenance total deadline reached')
        return remaining

    def execute(self,sql,params=None):
        # Re-prove target/custody/finding immediately before each generated mutation.
        self.gate()
        remaining=self.remaining_ms()
        self.db.settings(self.entry['lock_timeout_ms'],min(remaining,self.entry['statement_timeout_ms']))
        return self.db.execute(sql,params)

    def apply(self):
        if self.identity['target']=='production':
            preview=self.read('complete','preview')
            if preview is None or preview.get('phase')!='complete':raise Refusal('exact completed preview receipt required')
            self.receipts.verify_run(preview)
        self.gate()
        self.db.settings(self.entry['lock_timeout_ms'],self.entry['statement_timeout_ms'])
        self.db.lock(self.operation_id)
        try:
            for _ in range(10):
                original,new,retired=(self.db.catalog(name) for name in [self.original,self.new,self.retired])
                start=self.read('started')
                action=next_action(start,original,new,retired)
                if action in {'remove_retired','complete'}:
                    built=self.read('built')
                    swapped=self.read('swapped')
                    if built is None or built.get('new_oid')!=original['oid']:
                        raise Refusal('current index OID is not the immutable built replacement')
                    if swapped is not None and swapped.get('new_oid')!=original['oid']:
                        raise Refusal('current index OID disagrees with immutable swap proof')
                if action=='start':
                    row=validate_catalog(original,self.original,self.entry['definition_sha256'])
                    start={'original_oid':row['oid'],'table_oid':row['table_oid']}
                    self.save('started',start)
                    continue
                # Every known index must retain the exact same definition and table.
                for row,name in [(original,self.original),(new,self.new),(retired,self.retired)]:
                    if row:
                        if not row['valid'] and action in {'remove_incomplete_new','remove_retired'} and name in {self.new,self.retired}:
                            if row['schema']!='public' or row['table_oid']!=start['table_oid'] or row['constraint_owned'] or digest(normalized_definition(row['definition'],name))!=self.entry['definition_sha256']:
                                raise Refusal('incomplete index ownership refused')
                        else:validate_catalog(row,name,self.entry['definition_sha256'],start['table_oid'])
                if action=='build':
                    self.execute(f'CREATE INDEX CONCURRENTLY {self.new} ON {TABLE} USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)')
                    continue
                if action=='remove_incomplete_new':
                    # Deterministic name was proved absent before immutable start;
                    # operation advisory lock excludes another compliant writer.
                    self.execute(f'DROP INDEX CONCURRENTLY public.{self.new}')
                    continue
                if action=='swap':
                    built=self.read('built')
                    if built is not None and built.get('new_oid')!=new['oid']:
                        raise Refusal('replacement OID disagrees with immutable build proof')
                    self.save('built',start,new_oid=new['oid'])
                    # Transaction is only bounded catalog renames, never the build.
                    self.gate()
                    swap_ms=min(self.remaining_ms(),self.entry['swap_timeout_ms'])
                    self.db.swap(self.original,self.new,self.retired,min(self.entry['lock_timeout_ms'],swap_ms),swap_ms)
                    self.save('swapped',start,new_oid=new['oid'])
                    continue
                if action=='remove_retired':
                    self.execute(f'DROP INDEX CONCURRENTLY public.{self.retired}')
                    continue
                if action=='complete':
                    self.save('complete',start,new_oid=original['oid'],definition_sha256=self.entry['definition_sha256'])
                    return
            raise Refusal('maintenance recovery action limit reached')
        finally:self.db.unlock(self.operation_id)


class Database:
    def __init__(self,connection):self.connection=connection
    def execute(self,sql,params=None):
        with self.connection.cursor() as cursor:
            cursor.execute(sql,params)
            return cursor.fetchall() if cursor.description else []
    def settings(self,lock_ms,statement_ms):
        self.execute("select set_config('lock_timeout',%s,false),set_config('statement_timeout',%s,false)",(str(lock_ms),str(statement_ms)))
    def lock(self,operation_id):
        if not self.execute('select pg_try_advisory_lock(hashtextextended(%s,5616))',(operation_id,))[0][0]:raise Refusal('operation already has an active writer')
    def unlock(self,operation_id):self.execute('select pg_advisory_unlock(hashtextextended(%s,5616))',(operation_id,))
    def catalog(self,name):
        rows=self.execute("""select c.oid,i.indrelid,n.nspname,t.relname,i.indisvalid,i.indisready,pg_get_indexdef(c.oid),
            exists(select 1 from pg_constraint x where x.conindid=c.oid)
            from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid
            join pg_class t on t.oid=i.indrelid where n.nspname='public' and c.relname=%s""",(name,))
        return dict(zip(['oid','table_oid','schema','table_name','valid','ready','definition','constraint_owned'],rows[0])) if rows else None
    def health_table_oid(self,table):
        return self.execute('select to_regclass(%s)::oid',(table,))[0][0]
    def health_preview_applied(self,version):
        return self.execute('select exists(select 1 from supabase_migrations.schema_migrations where version=%s)',(version,))[0][0]
    def health_catalog(self,name):
        row=self.catalog(name)
        if row is not None:
            row['owner']=self.execute('select pg_get_userbyid(relowner) from pg_class where oid=%s',(row['oid'],))[0][0]
        return row
    def swap(self,old,new,retired,lock_ms,timeout_ms):
        try:
            self.execute('BEGIN')
            self.execute("select set_config('lock_timeout',%s,true),set_config('statement_timeout',%s,true),set_config('transaction_timeout',%s,true)",(str(lock_ms),str(timeout_ms),str(timeout_ms)))
            self.execute(f'ALTER INDEX public.{old} RENAME TO {retired}')
            self.execute(f'ALTER INDEX public.{new} RENAME TO {old}')
            self.execute('COMMIT')
        except Exception:
            self.execute('ROLLBACK');raise


class Receipts:
    def exclusive(self,mode,request):return self.bridge(mode,'unused',request)
    def read(self,ref):return self.bridge('read',ref)
    def create(self,ref,record):return self.bridge('create',ref,record)
    def bridge(self,mode,ref,record=None):
        result=subprocess.run(['node',str(ROOT/'scripts/index-maintenance-receipt.mjs'),mode,ref],input=json.dumps(record) if record is not None else None,text=True,capture_output=True,check=True)
        return json.loads(result.stdout)
    def verify_run(self,record):
        run=gh(f"actions/runs/{record['run_id']}")
        dispatch_ref=f"refs/db-index-maintenance-operations/{record['operation_id']}/{record['target']}/{record['execution_sha']}"
        title=f"INDEX {record['target']} {dispatch_ref} {record['execution_sha']}"
        jobs=gh(f"actions/runs/{record['run_id']}/jobs?per_page=100")
        if (run.get('conclusion')!='success' or run.get('path')!='.github/workflows/'+WORKFLOW
            or run.get('head_sha')!=record['execution_sha'] or run.get('event')!='workflow_dispatch'
            or run.get('display_title')!=title
            or not any(j.get('name')=='Exact concurrent index maintenance' and j.get('conclusion')=='success' for j in jobs.get('jobs',[]))):
            raise Refusal('preview workflow-run proof refused')


def gh(endpoint):
    result=subprocess.run(['gh','api',f'repos/{REPO}/'+endpoint],text=True,capture_output=True,check=True)
    return json.loads(result.stdout)


def workflow_gate(options,entry):
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REPOSITORY')!=REPO or os.environ.get('GITHUB_EVENT_NAME')!='workflow_dispatch' or os.environ.get('GITHUB_RUN_ATTEMPT')!='1' or os.environ.get('GITHUB_ACTOR')!='github-actions[bot]' or os.environ.get('GITHUB_WORKFLOW_REF')!=REPO+'/.github/workflows/'+WORKFLOW+'@refs/heads/main':raise Refusal('canonical fresh automatic workflow context required')
    if not re.fullmatch('[a-f0-9]{40}',options.source_sha):raise Refusal('source SHA refused')
    configured_preview=os.environ.get('PREVIEW_PROJECT_REF','')
    if not re.fullmatch('[a-z]{20}',configured_preview) or configured_preview==PROD:
        raise Refusal('current protected preview reference is missing or invalid')
    if options.target=='preview' and options.expected_project_ref!=configured_preview:
        raise Refusal('requested preview is not the currently configured preview')
    run_id=os.environ.get('GITHUB_RUN_ID','')
    if not re.fullmatch('[1-9][0-9]*',run_id):raise Refusal('current workflow run ID refused')
    run=gh('actions/runs/'+run_id)
    expected_title=f'INDEX {options.target} {options.dispatch_ref} {options.source_sha}'
    if (run.get('id')!=int(run_id) or run.get('path')!='.github/workflows/'+WORKFLOW
        or run.get('head_sha')!=options.source_sha or run.get('head_branch')!='main'
        or run.get('event')!='workflow_dispatch' or run.get('status')!='in_progress'
        or run.get('conclusion') is not None or run.get('run_attempt')!=1
        or run.get('actor',{}).get('login')!='github-actions[bot]'
        or run.get('triggering_actor',{}).get('login')!='github-actions[bot]'
        or run.get('display_title')!=expected_title):
        raise Refusal('live automatic workflow run proof refused')
    head=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,text=True,capture_output=True,check=True).stdout.strip()
    if head!=options.source_sha or gh('commits/main')['sha']!=head:raise Refusal('exact current main required')
    expected_ref=f'refs/db-index-maintenance-operations/{options.operation}/{options.target}/{head}'
    if options.dispatch_ref!=expected_ref:raise Refusal('dispatch ref/source/target mismatch')
    dispatch=Receipts().read(expected_ref)
    if dispatch!={'operation_id':options.operation,'target':options.target,'source_sha':head,'policy_digest':digest(entry)}:
        raise Refusal('immutable automatic dispatch receipt refused')
    pr=gh('pulls/'+str(entry['source_pr']))
    if not pr.get('merged_at') or pr.get('base',{}).get('ref')!='main':raise Refusal('merged main source PR required')
    ancestor=subprocess.run(['git','merge-base','--is-ancestor',pr['merge_commit_sha'],head],cwd=ROOT,capture_output=True)
    if ancestor.returncode:raise Refusal('source PR is not in current main')
    authored=subprocess.run(['git','show',pr['merge_commit_sha']+':config/nontransactional-index-maintenance.json'],cwd=ROOT,text=True,capture_output=True,check=True)
    if operation(json.loads(authored.stdout),options.operation)!=entry:raise Refusal('operation was not authored by its exact merged source PR')
    if entry.get('kind')=='health-initial/v1':
        from health_initial_index_maintenance import claim_request
        admission=claim_request(entry,options.operation)
    elif entry.get('kind')=='table-repack/v1':
        from table_repack_maintenance import claim_request as repack_claim
        admission=repack_claim(entry,options.operation)
    else:
        original,new,retired=names(options.operation)
        admission={'claim_issue':entry['claim_issue'],'work_issue':entry['work_issue'],
                   'objects':['table '+TABLE,*['index public.'+name for name in (original,new,retired)]]}
    result=subprocess.run(['node',str(ROOT/'scripts/index-maintenance-receipt.mjs'),'admit'],input=json.dumps(admission),text=True,capture_output=True,check=True)
    admission_result=json.loads(result.stdout)
    if admission_result.get('admitted') is not True:raise Refusal('maintenance claim admission refused')
    import review_finding_hold
    if review_finding_hold.blocking_findings(review_finding_hold.gh_issues(REPO,entry['source_pr']),REPO,entry['source_pr']):raise Refusal('blocking review finding')
    project_ref=(options.linked_dir/'supabase/.temp/project-ref').read_text().strip()
    if project_ref!=options.expected_project_ref:raise Refusal('point-of-use linked target mismatch')
    if options.target=='production' and project_ref!=PROD or options.target=='preview' and project_ref==PROD:raise Refusal('target class mismatch')
    # Reuse canonical link/credential validation; require session pooler, not transaction pooler.
    _,env=linked_connection(options.linked_dir,options.expected_project_ref)
    if env.get('PGPORT','5432')!='5432':raise Refusal('session connection required for nontransactional maintenance')
    env['_SOURCE_MERGE_SHA']=pr['merge_commit_sha']
    if entry.get('kind')=='health-initial/v1':
        env['_HEALTH_CLAIM_SCOPE']=admission_result['scope_sha256']
    return env


def executor_digest(operation_id=None):
    paths=['scripts/nontransactional_index_maintenance.py','scripts/index-maintenance-receipt.mjs',
           '.github/workflows/shared-supabase-migrations.yml']
    if operation_id and operation_id.startswith('health-'):
        paths+=['scripts/health_initial_index_maintenance.py','config/health-initial-index-definitions.json']
    if operation_id and operation_id.startswith('repack-'):
        paths+=['scripts/table_repack_maintenance.py','config/table-repack-allowlist.json']
    return digest({path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in paths})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dispatch-ref',required=True)
    parser.add_argument('--target',choices=['preview','production'],required=True)
    parser.add_argument('--expected-project-ref',required=True)
    parser.add_argument('--linked-dir',type=Path,required=True)
    parser.add_argument('--source-sha',required=True)
    parser.add_argument('--mode',choices=['check','apply'],required=True)
    options=parser.parse_args()
    try:
        options.operation=operation_from_dispatch_ref(options.dispatch_ref)
        entry=operation(json.loads(POLICY.read_text()),options.operation)
        gate=lambda:workflow_gate(options,entry)
        env=gate()
        if options.mode=='check':
            print(json.dumps({'operation':options.operation,'target':options.target,'preflight':'passed'}));return 0
        import psycopg
        identity={'target':options.target,'project_ref':options.expected_project_ref,'preview_project_ref':os.environ['PREVIEW_PROJECT_REF'],'source_sha':env['_SOURCE_MERGE_SHA'],'execution_sha':options.source_sha,'executor_digest':executor_digest(options.operation),
                  'source_pr':entry['source_pr'],'work_issue':entry['work_issue'],'run_id':int(os.environ['GITHUB_RUN_ID'])}
        if entry.get('kind')=='health-initial/v1':
            from health_initial_index_maintenance import claim_request
            identity['claim_scope_sha256']=env['_HEALTH_CLAIM_SCOPE']
            selected_claim=claim_request(entry,options.operation)
        elif entry.get('kind')=='table-repack/v1':
            from table_repack_maintenance import claim_request as repack_claim
            selected_claim=repack_claim(entry,options.operation)
        else:
            original,new,retired=names(options.operation)
            selected_claim={'claim_issue':entry['claim_issue'],'work_issue':entry['work_issue'],
                            'objects':['table '+TABLE,*['index public.'+name for name in (original,new,retired)]]}
        request={'target':options.target,'run_id':identity['run_id'],'source_pr':entry['source_pr'],'head_sha':options.source_sha,
                 'claim':selected_claim}
        receipts=Receipts()
        request['lease']=receipts.exclusive('acquire',request)
        def fenced_gate():
            environment=gate()
            if entry.get('kind')=='health-initial/v1' and environment.get('_HEALTH_CLAIM_SCOPE')!=identity['claim_scope_sha256']:
                raise Refusal('health owning claim scope changed')
            receipts.exclusive('assert',request)
            return environment
        try:
            with psycopg.connect(host=env['PGHOST'],port=5432,user=env['PGUSER'],password=env['PGPASSWORD'],dbname=env['PGDATABASE'],sslmode=env['PGSSLMODE'],connect_timeout=15,autocommit=True,application_name='sg-index-maintenance-'+options.operation) as connection:
                if entry.get('kind')=='health-initial/v1':
                    from health_initial_index_maintenance import HealthInitial
                    HealthInitial(Database(connection),receipts,entry,identity,options.operation,fenced_gate).apply()
                elif entry.get('kind')=='table-repack/v1':
                    from table_repack_maintenance import TableRepack, RepackDatabase
                    TableRepack(RepackDatabase(Database(connection)),receipts,entry,identity,options.operation,fenced_gate).apply(env)
                else:
                    Maintenance(Database(connection),receipts,entry,identity,options.operation,fenced_gate).apply()
        finally:
            receipts.exclusive('release',request)
        print(json.dumps({'operation':options.operation,'target':options.target,'outcome':'complete'}));return 0
    except Exception as error:
        # No SQL, connection errors, raw traffic or credentials in output.
        print(json.dumps({'outcome':'refused','error_type':type(error).__name__,'reason':str(error) if isinstance(error,Refusal) else 'protected operation failed; inspect private workflow evidence','recovery':'preserve exact operation receipts and original capability'}),file=sys.stderr);return 2


if __name__=='__main__':raise SystemExit(main())
