"""Exactly three health indexes; no runtime SQL/table/name inputs or activation.

Preview genuinely builds and removes only its fixed owned shadow. Production
creates the fixed canonical index; historical preview indexes remain untouched.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from nontransactional_index_maintenance import Maintenance, Refusal, ROOT, FIELDS, digest

REGISTRY=ROOT/'config/health-initial-index-definitions.json'
REGISTRY_SHA256='84a870f7ad2f9c1d0201a614f9964f386adf7dfc51e3048967d45ef69b5b9eaa'
KIND='health-initial/v1'
IDS=frozenset(['health-dam-errored-5622','health-dam-write-5622','health-sg-write-5622'])


def definitions():
    raw=REGISTRY.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=REGISTRY_SHA256:raise Refusal('fixed health definition registry changed')
    result=json.loads(raw)
    if set(result)!=IDS:raise Refusal('fixed health operation inventory changed')
    names=[r[k] for r in result.values() for k in ['canonical','preview_shadow']]
    if len(set(names))!=6 or any(len(n)>63 for n in names):raise Refusal('health index name collision')
    return result


def definition(operation_id):
    if operation_id not in IDS:raise Refusal('unknown fixed health operation')
    return definitions()[operation_id]


def validate_operation(entry,operation_id):
    spec=definition(operation_id)
    if not isinstance(entry,dict) or set(entry)!=FIELDS|{'kind'} or entry.get('kind')!=KIND:
        raise Refusal('health initial policy shape refused')
    for field in ['source_pr','work_issue','claim_issue','lock_timeout_ms','statement_timeout_ms','swap_timeout_ms','total_timeout_s']:
        if type(entry[field]) is not int or entry[field]<=0:raise Refusal('health policy integer refused')
    if entry['work_issue']!=5622 or entry['claim_issue']!=5622:raise Refusal('exact health work/claim owner required')
    if entry['definition_sha256']!=digest(spec['definition']):raise Refusal('fixed health definition digest refused')
    if not (entry['lock_timeout_ms']<=500 and 1000<=entry['statement_timeout_ms']<=900000
            and entry['swap_timeout_ms']<=2500 and 10<=entry['total_timeout_s']<=3600):
        raise Refusal('health nonblocking build budget refused')
    return dict(entry)


def claim_request(entry,operation_id):
    spec=definition(operation_id)
    return {'claim_issue':entry['claim_issue'],'work_issue':entry['work_issue'],'kind':KIND,'operation_id':operation_id,
            'objects':['index public.'+spec[k] for k in ['canonical','preview_shadow']],
            'reads':['table '+spec['table']]}


def validate_index(row,name,spec,table_oid):
    expected='CREATE INDEX '+name+' ON '+spec['table']+' '+spec['definition']
    if (not row or row['schema']!='public' or row['table_name']!=spec['table'].split('.')[1]
        or row['table_oid']!=table_oid or row.get('owner')!='postgres' or row['constraint_owned']
        or row['definition']!=expected):raise Refusal('health index identity/owner/definition refused')
    return row


class HealthInitial(Maintenance):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.spec=definition(self.operation_id)
        self.canonical=self.spec['canonical']
        self.build_name=self.spec['preview_shadow'] if self.identity['target']=='preview' else self.canonical

    def read(self,phase,target=None):
        record=super().read(phase,target)
        if record is not None and (record.get('kind')!=KIND or record.get('claim_issue')!=5622
            or record.get('claim_scope_sha256')!=self.identity.get('claim_scope_sha256')):
            raise Refusal('health receipt owner/scope binding refused')
        return record

    def save(self,phase,start,**extra):
        prior=self.read(phase)
        if prior is not None:return prior
        record={**self.identity,'operation_id':self.operation_id,'policy_digest':digest(self.entry),'kind':KIND,
                'claim_issue':self.entry['claim_issue'],'phase':phase,**start,**extra}
        return self.receipts.create(self.receipt_ref(phase),record)

    def checked_start(self,start,table_oid):
        if (start.get('kind')!=KIND or start.get('claim_issue')!=5622 or start.get('table_oid')!=table_oid
            or start.get('build_name')!=self.build_name or start.get('canonical_name')!=self.canonical):
            raise Refusal('health immutable start identity refused')
        if self.identity['target']=='preview':
            current=self.db.health_catalog(self.canonical)
            if current!=start.get('canonical_preimage'):raise Refusal('preview canonical index changed')
        elif start.get('canonical_preimage') is not None:
            raise Refusal('production initial index was not originally absent')

    def execute(self,sql,params=None):
        create='CREATE INDEX CONCURRENTLY '+self.build_name+' ON '+self.spec['table']+' '+self.spec['definition']
        drop='DROP INDEX CONCURRENTLY public.'+self.build_name
        if params is not None or (sql!=create and not (self.identity['target']=='preview' and sql==drop)):
            raise Refusal('only exact fixed health build/owned-shadow cleanup SQL permitted')
        self.gate()
        budget=self.entry['swap_timeout_ms'] if sql==drop else self.entry['statement_timeout_ms']
        self.db.settings(self.entry['lock_timeout_ms'],min(self.remaining_ms(),budget))
        return self.db.execute(sql)

    def apply(self):
        if self.identity['target']=='production':
            preview=self.read('complete','preview')
            if (preview is None or preview.get('kind')!=KIND or preview.get('claim_issue')!=5622
                or not preview.get('preview_builder_executed') or not preview.get('shadow_cleanup_complete')
                or preview.get('definition_sha256')!=self.entry['definition_sha256']):
                raise Refusal('genuine completed health preview build/cleanup required')
            self.receipts.verify_run(preview)
        self.gate()
        self.db.settings(self.entry['lock_timeout_ms'],min(self.remaining_ms(),self.entry['swap_timeout_ms']))
        self.db.lock(self.operation_id)
        try:
            table_oid=self.db.health_table_oid(self.spec['table'])
            if not isinstance(table_oid,int) or table_oid<=0:raise Refusal('health owning table is absent')
            for _ in range(8):
                self.db.settings(self.entry['lock_timeout_ms'],min(self.remaining_ms(),self.entry['swap_timeout_ms']))
                start=self.read('started')
                row=self.db.health_catalog(self.build_name)
                if start is None:
                    if row is not None:raise Refusal('initial health build name already occupied')
                    canonical=self.db.health_catalog(self.canonical)
                    if self.identity['target']=='preview':
                        validate_index(canonical,self.canonical,self.spec,table_oid)
                        if not canonical['valid'] or not canonical['ready']:
                            raise Refusal('historical preview canonical index is invalid')
                        if not self.db.health_preview_applied(self.spec['preview_version']):
                            raise Refusal('historical preview index source ledger is absent')
                    elif canonical is not None:raise Refusal('production canonical index was not initially absent')
                    start={'table_oid':table_oid,'canonical_name':self.canonical,'build_name':self.build_name,
                           'canonical_preimage':canonical if self.identity['target']=='preview' else None}
                    self.save('started',start)
                    continue
                self.checked_start(start,table_oid)
                built=self.read('built')
                if built is not None and (built.get('kind')!=KIND or built.get('claim_issue')!=5622
                    or built.get('table_oid')!=table_oid or built.get('build_name')!=self.build_name
                    or not isinstance(built.get('new_oid'),int) or built['new_oid']<=0):
                    raise Refusal('health immutable build identity refused')
                if row is None:
                    if built is not None:
                        if self.identity['target']!='preview':raise Refusal('production built index disappeared')
                        self.save('complete',start,new_oid=built['new_oid'],definition_sha256=self.entry['definition_sha256'],
                                  preview_builder_executed=True,shadow_cleanup_complete=True)
                        return
                    self.execute('CREATE INDEX CONCURRENTLY '+self.build_name+' ON '+self.spec['table']+' '+self.spec['definition'])
                    # Only this process's successful exact CREATE may establish
                    # ownership. A resumed exact-name row without this immutable
                    # OID receipt is ambiguous and must never be adopted/dropped.
                    created=self.db.health_catalog(self.build_name)
                    validate_index(created,self.build_name,self.spec,table_oid)
                    if not created['valid'] or not created['ready']:
                        raise Refusal('new health build incomplete; preserve for governed recovery')
                    self.checked_start(start,table_oid)
                    self.save('built',start,new_oid=created['oid'],definition_sha256=self.entry['definition_sha256'])
                    continue
                validate_index(row,self.build_name,self.spec,table_oid)
                if built is not None and row['oid']!=built['new_oid']:
                    raise Refusal('health index OID changed after owned build receipt')
                if not row['valid'] or not row['ready']:
                    # An invalid object without an owned OID receipt is ambiguous.
                    # Preserve it for governed investigation, never drop by name alone.
                    raise Refusal('incomplete health build; preserve object and receipts for owned-OID recovery')
                if built is None:
                    raise Refusal('ambiguous resumed health index without immutable owned-OID receipt; preserve object')
                if self.identity['target']=='preview':
                    # Only this exact immutable owned OID can be removed. Recheck
                    # canonical preimage and fencing immediately before mutation.
                    self.checked_start(start,table_oid)
                    self.execute('DROP INDEX CONCURRENTLY public.'+self.build_name)
                    continue
                self.save('complete',start,new_oid=row['oid'],definition_sha256=self.entry['definition_sha256'],
                          preview_builder_executed=False,shadow_cleanup_complete=False)
                return
            raise Refusal('health recovery action limit reached')
        finally:self.db.unlock(self.operation_id)
