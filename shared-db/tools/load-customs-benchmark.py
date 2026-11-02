#!/usr/bin/env python3
"""Lossless private customs archive loader. No DDL. Read-only unless --apply.
Uses the canonical Supabase Management API token from the process environment.
Source contents and API errors are never printed. Full source bytes stay private.
"""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

SECTIONS = ('matches','suggestions','code_checks','unmatched','coverage','anomalies')
CONTEXT = ('Owner-directed authoritative historical customs evidence benchmark (#5447; '
           'designflow-backend#279). Preserve original extraction and matching context. '
           'Historical filings are not binding CBP rulings or verified current-law labels. '
           'Packet-level links and family leads are inferred, clocks may classify components, '
           'unmatched styles are limited-snapshot mismatches, and original anomalies remain unresolved. '
           'The source item master is an exported snapshot, not verified live. '
           'Keep evaluation answers isolated from model inputs and training memory.')

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def sha(content):
    return hashlib.sha256(content).hexdigest()

def literal(value):
    return 'NULL' if value is None else "'" + str(value).replace("'","''") + "'"

def json_sql(value):
    return literal(canonical(value))+'::jsonb'

def inventory(root, master):
    root, master = Path(root).resolve(), Path(master).resolve()
    files=[]
    for p in sorted(root.rglob('*')):
        if p.is_symlink():
            raise ValueError('Source symlinks require explicit reconciliation')
        if p.is_file():
            b=p.read_bytes()
            files.append((str(p.relative_to(root)),p,sha(b),len(b)))
    b=master.read_bytes()
    files.append(('item_master_snapshot/'+master.name,master,sha(b),len(b)))
    manifest=[dict(relative_path=n,sha256=h,byte_count=s) for n,p,h,s in files]
    data=json.loads((root/'intelligence_20261101/intelligence.json').read_text())
    if data['summary']['master_sha256'] != sha(b):
        raise ValueError('The exported item-master bytes differ from the report source')
    rows=[]
    for section in SECTIONS:
        for i,row in enumerate(data[section]):
            if not isinstance(row,dict): raise ValueError('Unexpected non-object source row')
            status=row.get('status') or {'suggestions':'Family research lead','code_checks':'Code lookup evidence','unmatched':'Unmatched source style','coverage':'Packet coverage','anomalies':'Source anomaly'}[section]
            candidate=section=='matches' and status=='Historical link candidate'
            rows.append(dict(section=section,source_ordinal=i,style_number=row.get('style'),product_description=row.get('description'),product_family=row.get('group') or row.get('family'),historical_hts=row.get('hts'),packet_reference=row.get('packet'),evidence_status=status,exact_historical_candidate=candidate,current_law_verified=False,original_record=row))
    return sha(canonical(manifest).encode()),manifest,files,data,rows

class Database:
    def __init__(self,ref,ref_file):
        self.ref,self.ref_file=ref,Path(ref_file)
        self.token=os.environ['SUPABASE_ACCESS_TOKEN']
        self.connection=None
        if os.environ.get('CUSTOMS_DB_DIRECT') == '1':
            self.prove()
            import psycopg
            from psycopg.rows import dict_row
            host=os.environ['SUPABASE_DB_HOST']
            if not host.endswith('.pooler.supabase.com'):raise ValueError('Expected canonical Supabase pooler')
            self.connection=psycopg.connect(host=host,port=5432,dbname='postgres',user='postgres.'+ref,
                password=os.environ['SUPABASE_DB_PASSWORD'],sslmode='verify-full',
                sslrootcert=str(Path(__file__).resolve().parents[1]/'scripts/certs/supabase-root-2021.crt'),
                connect_timeout=15,autocommit=True,row_factory=dict_row)
            self.prove()
    def api(self,path,data=None):
        req=urllib.request.Request('https://api.supabase.com/v1/'+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=120) as response:return json.load(response)
    def prove(self):
        if self.ref_file.read_text().strip()!=self.ref:raise ValueError('Local project-ref target mismatch')
        if self.api('projects/'+self.ref)['id']!=self.ref:raise ValueError('Management API target mismatch')
        if getattr(self,'connection',None) is not None:
            sql="select current_database() as database_name,(pg_control_system()).system_identifier::text as cluster_id"
            expected=self.api('projects/'+self.ref+'/database/query',{'query':sql,'read_only':True})
            actual=self.connection.execute(sql).fetchall()
            if expected != actual:raise ValueError('Direct database cluster differs from proved API target')
    def query(self,sql,write=False):
        self.prove() # fresh target proof immediately before each write/read
        if self.connection is not None:
            with self.connection.transaction():
                with self.connection.cursor() as cursor:
                    if not write:cursor.execute('set transaction read only')
                    cursor.execute("set local statement_timeout='120s'")
                    cursor.execute("set local lock_timeout='3s'")
                    cursor.execute(sql)
                    return cursor.fetchall() if cursor.description is not None else []
        return self.api('projects/'+self.ref+'/database/query',{'query':sql,'read_only':not write})

class ObjectStore:
    """Private content-addressed originals. Never put original filenames in keys."""
    def __init__(self):
        import boto3
        self.endpoint=os.environ['S3_ENDPOINT_URL'].rstrip('/')
        self.bucket=os.environ['S3_BUCKET']
        if not self.endpoint.startswith('https://'):raise ValueError('Storage must use HTTPS')
        self.client=boto3.client('s3',endpoint_url=self.endpoint,
            region_name=os.environ['AWS_DEFAULT_REGION'],
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'])
    def preserve(self,ident,path,digest,size,apply):
        key='private/customs-benchmark/'+ident+'/'+digest
        try:
            self.client.head_object(Bucket=self.bucket,Key=key)
            exists=True
        except self.client.exceptions.ClientError as exc:
            if exc.response['Error']['Code'] not in ('404','NoSuchKey','NotFound'):raise
            exists=False
        if not exists:
            if not apply:raise ValueError('Missing archived original')
            content=path.read_bytes()
            if sha(content)!=digest:raise ValueError('Source changed before archive write')
            self.client.put_object(Bucket=self.bucket,Key=key,Body=content,ACL='private',
                ContentType=mimetypes.guess_type(path.name)[0] or 'application/octet-stream',
                Metadata={'sha256':digest})
        acl=self.client.get_object_acl(Bucket=self.bucket,Key=key)
        if any(g['Grantee'].get('Type')=='Group' for g in acl['Grants']):
            raise ValueError('Archived object has non-private ACL')
        content=self.client.get_object(Bucket=self.bucket,Key=key)['Body'].read()
        if len(content)!=size or sha(content)!=digest:raise ValueError('Archived source bytes differ')
        # Authenticated GET proves existence; unsigned HEAD proves no public read.
        url=self.endpoint.replace('https://','https://'+self.bucket+'.',1)+'/'+quote(key,safe='/')
        try:
            with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=20) as response:
                code=response.status
        except urllib.error.HTTPError as exc:code=exc.code
        if code!=403:raise ValueError('Archived object is not privately denied')
        structured=None
        if path.suffix.lower()=='.json':structured=json.loads(content)
        elif path.suffix.lower()=='.jsonl':structured=[json.loads(line) for line in content.decode().splitlines() if line.strip()]
        return dict(storage_endpoint=self.endpoint,storage_bucket=self.bucket,storage_key=key,
            private_verified=True,structured_content=structured)

def run(args):
    ident,manifest,files,data,rows=inventory(args.root,args.master)
    store=ObjectStore()
    def preserve_file(record):
        name,path,digest,size=record
        return name,store.preserve(ident,path,digest,size,args.apply or args.archive_only)
    with ThreadPoolExecutor(max_workers=4) as workers:
        objects=dict(workers.map(preserve_file,files))
    if args.archive_only:
        if not (inventory(args.root,args.master)[0]==ident):raise ValueError('Source changed during archive')
        print(json.dumps(dict(dataset_id=ident,files=len(files),source_bytes=sum(x[3] for x in files),
            all_source_sha256_verified=True,all_objects_private=True,database_file_bytes=0)))
        return
    db=Database(args.expected_ref,args.project_ref_file)
    if args.apply:
        db.query('insert into plm.customs_benchmark_dataset (dataset_id,benchmark_name,authority_scope,source_manifest,original_intelligence,authority_context,source_file_count,source_byte_count,observation_count) values ('+','.join([literal(ident),literal('customs_intelligence_20261101'),literal('historical_customs_evidence'),json_sql(manifest),json_sql(data),literal(CONTEXT),str(len(files)),str(sum(x[3] for x in files)),str(len(rows))])+') on conflict do nothing;',True)
        artifact_values=[]
        for name,path,digest,size in files:
            o=objects[name]
            artifact_values.append('('+','.join([literal(ident),literal(name),literal(digest),literal(mimetypes.guess_type(name)[0] or 'application/octet-stream'),str(size),literal(o['storage_endpoint']),literal(o['storage_bucket']),literal(o['storage_key']),'true',json_sql(o['structured_content']) if o['structured_content'] is not None else 'NULL'])+')')
        db.query('insert into plm.customs_benchmark_artifact (dataset_id,relative_path,content_sha256,media_type,byte_count,storage_endpoint,storage_bucket,storage_key,private_verified,structured_content) values '+','.join(artifact_values)+' on conflict do nothing;',True)
        for start in range(0,len(rows),100):
            values=[]
            for r in rows[start:start+100]:
                values.append('('+','.join([literal(ident),literal(r['section']),str(r['source_ordinal']),*[literal(r[k]) for k in ['style_number','product_description','product_family','historical_hts','packet_reference','evidence_status']],str(r['exact_historical_candidate']).lower(),'false',json_sql(r['original_record'])])+')')
            db.query('insert into plm.customs_benchmark_observation values '+','.join(values)+' on conflict do nothing;',True)
    stored=db.query('select source_manifest,original_intelligence,authority_context,source_file_count,source_byte_count,observation_count from plm.customs_benchmark_dataset where dataset_id='+literal(ident))
    if not (len(stored)==1):raise ValueError('Dataset absent')
    d=stored[0]
    if not (d['source_manifest']==manifest and d['original_intelligence']==data and d['authority_context']==CONTEXT):raise ValueError('Dataset context mismatch')
    if not ((d['source_file_count'],d['source_byte_count'],d['observation_count'])==(len(files),sum(x[3] for x in files),len(rows))):raise ValueError('Dataset counts mismatch')
    artifacts=db.query('select relative_path,content_sha256,byte_count,storage_endpoint,storage_bucket,storage_key,private_verified,structured_content from plm.customs_benchmark_artifact where dataset_id='+literal(ident))
    expected={n:(h,s) for n,p,h,s in files}
    if not (len(artifacts)==len(expected)):raise ValueError('Incomplete archive references')
    for a in artifacts:
        if not (expected[a['relative_path']]==(a['content_sha256'],a['byte_count'])):raise ValueError('Archive identity mismatch')
        if not ({k:a[k] for k in objects[a['relative_path']]}==objects[a['relative_path']]):raise ValueError('Archive location or extraction mismatch')
    observed=db.query('select section,source_ordinal,style_number,product_description,product_family,historical_hts,packet_reference,evidence_status,exact_historical_candidate,current_law_verified,original_record from plm.customs_benchmark_observation where dataset_id='+literal(ident))
    if not (sorted(observed,key=lambda r:(r['section'],r['source_ordinal']))==sorted(rows,key=lambda r:(r['section'],r['source_ordinal']))):raise ValueError('Observation or context mismatch')
    if not (inventory(args.root,args.master)[0]==ident):raise ValueError('Source changed during verification')
    print(json.dumps(dict(target=args.expected_ref,dataset_id=ident,files=len(files),source_bytes=sum(x[3] for x in files),observations=len(rows),sections={s:len(data[s]) for s in SECTIONS},all_source_sha256_verified=True,all_row_context_verified=True,all_objects_private=True,database_file_bytes=0)))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True);p.add_argument('--master',required=True)
    p.add_argument('--expected-ref');p.add_argument('--project-ref-file')
    p.add_argument('--archive-only',action='store_true')
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    if not args.archive_only and (not args.expected_ref or not args.project_ref_file):p.error('Database target and project-ref file required')
    if args.archive_only and args.apply:p.error('Choose archive-only or apply')
    try:run(args)
    except Exception as exc:
        # Error bodies can contain SQL, secrets or private source evidence.
        print('Customs benchmark operation failed ('+type(exc).__name__+', HTTP '+str(getattr(exc,'code','n/a'))+'); private error details withheld.',file=sys.stderr)
        return 1
    return 0
if __name__=='__main__':sys.exit(main())
