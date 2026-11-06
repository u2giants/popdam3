"""Fixed online table repack (pg_repack 1.5.2) through the exact-index maintenance route.

Only allowlisted tables, a sha256-pinned client binary and fixed arguments; no
runtime SQL, object names or flags come from input. pg_repack takes ACCESS
EXCLUSIVE only briefly at start and at the final swap; --no-kill-backend makes
it give up instead of cancelling application queries, and the table keeps
every row, index, trigger and grant (u2giants/popdam3#804, shared-db#5742).
Preview runs first; production requires the verified completed preview receipt.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import re
import json
import subprocess
import urllib.request
from nontransactional_index_maintenance import Maintenance, Refusal, digest

KIND='table-repack/v1'
PREFIX='repack-'
ALLOWLIST=Path(__file__).resolve().parents[1]/'config/table-repack-allowlist.json'
ALLOWLIST_FIELDS={'table','max_heap_mb','automatic','source_issue','reason'}
EXTENSION_VERSION='1.5.2'
FIELDS={'kind','source_pr','work_issue','claim_issue','table','client_sha256','wait_timeout_s','total_timeout_s'}
# A preview-only operation (test-mode run of the weekly check) never reaches production.
OPTIONAL_FIELDS={'preview_only'}


def load_allowlist(path=None):
    """Governed allowlist (plan_db-anti-bloat-safeguards.md Step 7). Any malformed entry refuses the whole file."""
    value=json.loads(Path(path or ALLOWLIST).read_text())
    if not isinstance(value,dict) or set(value)!={'schema_version','tables'} or value['schema_version']!=1 or not isinstance(value['tables'],list):
        raise Refusal('repack allowlist shape refused')
    out={}
    for item in value['tables']:
        if not isinstance(item,dict) or set(item)!=ALLOWLIST_FIELDS:raise Refusal('repack allowlist entry fields refused')
        if not isinstance(item['table'],str) or not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}',item['table']):
            raise Refusal('repack allowlist table name refused')
        if type(item['max_heap_mb']) is not int or not 0<item['max_heap_mb']<=16384:raise Refusal('repack allowlist size limit refused')
        if type(item['source_issue']) is not int or item['source_issue']<=0:raise Refusal('repack allowlist source issue refused')
        if type(item['automatic']) is not bool or not isinstance(item['reason'],str) or not item['reason'].strip():
            raise Refusal('repack allowlist entry refused')
        if item['table'] in out:raise Refusal('repack allowlist duplicate table refused')
        out[item['table']]=dict(item)
    return out


TABLES=frozenset(load_allowlist())


def validate_operation(entry,operation_id):
    if not operation_id.startswith(PREFIX):raise Refusal('repack operation identity refused')
    if not isinstance(entry,dict) or not FIELDS<=set(entry)<=FIELDS|OPTIONAL_FIELDS or entry.get('kind')!=KIND:
        raise Refusal('repack policy shape refused')
    if 'preview_only' in entry and entry['preview_only'] is not True:raise Refusal('repack preview_only flag refused')
    for field in ['source_pr','work_issue','claim_issue','wait_timeout_s','total_timeout_s']:
        if type(entry[field]) is not int or entry[field]<=0:raise Refusal('repack policy integer refused')
    if entry['table'] not in TABLES:raise Refusal('repack table is not allowlisted')
    if not isinstance(entry['client_sha256'],str) or not re.fullmatch('[a-f0-9]{64}',entry['client_sha256']):
        raise Refusal('repack client digest refused')
    # Short lock waits: a busy table makes the repack give up, never queue readers behind it.
    if not (entry['wait_timeout_s']<=60 and 60<=entry['total_timeout_s']<=3600):
        raise Refusal('repack budget refused')
    return dict(entry)


def claim_request(entry,operation_id):
    return {'claim_issue':entry['claim_issue'],'work_issue':entry['work_issue'],'kind':KIND,'operation_id':operation_id,
            'objects':['table '+entry['table']]}


def command(binary,entry):
    schema,table=entry['table'].split('.')
    return [str(binary),'--no-superuser-check','--no-kill-backend','--no-order',
            f'--wait-timeout={entry["wait_timeout_s"]}',f'--table={schema}.{table}','--elevel=WARNING']


def run_client(entry,env,timeout_s):
    binary=Path(os.environ.get('PG_REPACK_BIN',''))
    if not binary.is_file() or hashlib.sha256(binary.read_bytes()).hexdigest()!=entry['client_sha256']:
        raise Refusal('pinned pg_repack client required')
    child={k:v for k,v in env.items() if k in {'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE'}}
    child.update(PATH=os.environ.get('PATH',''),PGAPPNAME='table-repack-maintenance')
    result=subprocess.run(command(binary,entry),env=child,text=True,capture_output=True,timeout=timeout_s)
    if result.returncode:raise Refusal('pg_repack client did not complete; table and original capability retained')


DISK_HEADROOM_BYTES=1<<30


def row_drift_allowed(before):
    # Concurrent application inserts/deletes continue during the online repack;
    # anything beyond this band is treated as loss/duplication and refused.
    return max(50,before//1000)


def provider_disk_available(project_ref):
    token=os.environ.get('SUPABASE_ACCESS_TOKEN','')
    if not re.fullmatch('[a-z]{20}',project_ref or '') or not token:raise Refusal('disk utilization proof unavailable')
    request=urllib.request.Request(f'https://api.supabase.com/v1/projects/{project_ref}/config/disk/util',
                                   headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(request,timeout=30) as response:
        value=json.load(response)['metrics']['fs_avail_bytes']
    if type(value) is not int or value<0:raise Refusal('disk utilization proof refused')
    return value


class TableRepack(Maintenance):
    """States: started (pre-image) -> client run -> complete (new relfilenode, same shape)."""
    def __init__(self,db,receipts,entry,identity,operation_id,gate,client=run_client,disk=provider_disk_available,**kwargs):
        super().__init__(db,receipts,entry,identity,operation_id,gate,**kwargs)
        self.client,self.disk=client,disk

    def read(self,phase,target=None):
        record=super().read(phase,target)
        if record is not None and (record.get('kind')!=KIND or record.get('table')!=self.entry['table']):
            raise Refusal('repack receipt binding refused')
        return record

    def save(self,phase,start,**extra):
        prior=self.read(phase)
        if prior is not None:return prior
        record={**self.identity,'operation_id':self.operation_id,'policy_digest':digest(self.entry),'kind':KIND,
                'table':self.entry['table'],**{k:start[k] for k in ['table_oid','original_oid','before']},'phase':phase,**extra}
        return self.receipts.create(self.receipt_ref(phase),record)

    def remaining_s(self):
        remaining=self.entry['total_timeout_s']-(self.clock()-self.started)
        if remaining<=5:raise Refusal('repack total deadline reached')
        return int(remaining)

    def apply(self,env=None):
        if self.identity['target']=='production':
            if self.entry.get('preview_only'):raise Refusal('preview-only repack operation never runs on production')
            preview=self.read('complete','preview')
            if preview is None or preview.get('phase')!='complete' or not preview.get('repacked'):
                raise Refusal('exact completed preview repack receipt required')
            self.receipts.verify_run(preview)
        self.gate()
        self.db.lock(self.operation_id)
        try:
            if self.db.repack_extension_version()!=EXTENSION_VERSION:raise Refusal('pg_repack extension 1.5.2 required')
            state=self.db.table_state(self.entry['table'])
            if state is None:raise Refusal('repack table is absent')
            start=self.read('started')
            if start is None:
                if self.db.repack_leftovers():raise Refusal('leftover pg_repack objects; preserve for governed recovery')
                start={'table_oid':state['oid'],'original_oid':state['oid'],'before':state}
                self.save('started',start)
                start=self.read('started')
            if start.get('table_oid')!=state['oid']:raise Refusal('repack table OID changed')
            if state['heap_bytes']>load_allowlist()[self.entry['table']]['max_heap_mb']*1048576:
                raise Refusal('repack table heap exceeds its allowlisted size limit')
            before=start['before']
            if state['relfilenode']==before['relfilenode']:
                if self.db.repack_leftovers():raise Refusal('leftover pg_repack objects; preserve for governed recovery')
                # pg_repack builds a full copy of heap, TOAST and every index before the swap.
                if self.disk(self.identity['project_ref'])<state['total_bytes']+DISK_HEADROOM_BYTES:
                    raise Refusal('insufficient free disk for a full table copy plus 1 GiB headroom')
                self.gate()
                self.client(self.entry,env or {},self.remaining_s())
                state=self.db.table_state(self.entry['table'])
                if state is None or state['oid']!=before['oid'] or state['relfilenode']==before['relfilenode']:
                    raise Refusal('repack did not swap the table storage')
            if self.db.repack_leftovers():raise Refusal('pg_repack left objects behind; preserve for governed recovery')
            for key in ['indexes','valid_indexes','triggers','constraints','acl']:
                if state[key]!=before[key]:raise Refusal('repacked table shape changed: '+key)
            if abs(state['rows']-before['rows'])>row_drift_allowed(before['rows']):
                raise Refusal('repacked table row count moved beyond concurrent-write band')
            self.gate()
            self.save('complete',start,after=state,repacked=True)
        finally:self.db.unlock(self.operation_id)


class RepackDatabase:
    """Read-only catalog probes for the repack state machine (the client does the writes)."""
    def __init__(self,database):self.database=database
    def lock(self,operation_id):self.database.lock(operation_id)
    def unlock(self,operation_id):self.database.unlock(operation_id)
    def repack_extension_version(self):
        rows=self.database.execute("select extversion from pg_extension where extname='pg_repack'")
        return rows[0][0] if rows else None
    def repack_leftovers(self):
        return self.database.execute("""select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='repack' and (c.relname like 'log\\_%' or c.relname like 'table\\_%'))""")[0][0]
    def table_state(self,table):
        rows=self.database.execute("""select c.oid::bigint,c.relfilenode::bigint,c.relpages::bigint,pg_relation_size(c.oid),
              (select count(*) from pg_index i where i.indrelid=c.oid),
              (select count(*) from pg_index i where i.indrelid=c.oid and i.indisvalid and i.indisready),
              (select count(*) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
              (select count(*) from pg_constraint k where k.conrelid=c.oid),
              coalesce(c.relacl::text,''),pg_total_relation_size(c.oid)
            from pg_class c where c.oid=to_regclass(%s)""",(table,))
        if not rows or rows[0][0] is None:return None
        keys=['oid','relfilenode','relpages','heap_bytes','indexes','valid_indexes','triggers','constraints','acl','total_bytes']
        value=dict(zip(keys,[int(v) if isinstance(v,int) else v for v in rows[0]]))
        if table not in TABLES:raise Refusal('repack table is not allowlisted')
        schema,name=table.split('.')
        # Identifier comes only from the fixed allowlist above, never from input.
        value['rows']=int(self.database.execute(f'select count(*) from "{schema}"."{name}"')[0][0])
        return value
