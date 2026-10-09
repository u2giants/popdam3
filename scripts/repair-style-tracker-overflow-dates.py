#!/usr/bin/env python3
"""Source-bound eight-row repair; source years are preserved, never corrected."""
import argparse,copy,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=module('refresh',ROOT/'scripts/refresh-style-tracker-rows.py')
conv=module('converter',ROOT/'scripts/import-style-tracker-xlsx.py')
SOURCE_SHA='5513f7a43a27235a74168a0cd532994c1c77b93265619e9848e9e2a6dba1b0cd'
COORDINATES=('AB3267','R4530','P5403','AC6702','W6766','X6766','W7635','R7734','R12136')
def repair_source(rows):
 old=copy.deepcopy(rows);index={(r['source_sheet'],r['source_row_number']):r for r in old}
 import re
 for coordinate in COORDINATES:
  col,num=re.fullmatch(r'([A-Z]+)([0-9]+)',coordinate).groups();r=index[('License.Style',int(num))]
  value=r['row_data'][col]
  if not isinstance(value,str) or int(value.rsplit('/',1)[-1])<=9999:raise ValueError('Expected overflow source date missing')
  r['row_data'][col]='#VALUE!'
  key=conv.SHEETS['License.Style']['legacy'].get(col)
  if key:r['row_data'][key]='#VALUE!'
  for field,letter in conv.SHEETS['License.Style']['typed'].items():
   if letter==col:r[field]='#VALUE!'
 return old

def main():
 p=argparse.ArgumentParser();p.add_argument('--workbook',type=Path,required=True);p.add_argument('--password-file',type=Path,required=True);p.add_argument('--recovery-dir',type=Path,required=True);p.add_argument('--apply',action='store_true');p.add_argument('--reviewer-approval',type=Path);a=p.parse_args()
 os.umask(0o077);a.recovery_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
 if a.recovery_dir.stat().st_mode&0o077:raise ValueError('Recovery directory is not private')
 if hashlib.sha256(a.workbook.read_bytes()).hexdigest()!=SOURCE_SHA:raise ValueError('Source checksum changed')
 subprocess.run([sys.executable,str(ROOT/'scripts/import-style-tracker-xlsx.py'),str(a.workbook),str(a.recovery_dir/'source.tsv')],check=True,stdout=subprocess.DEVNULL)
 desired=m.read_rows(a.recovery_dir/'source.tsv');old=repair_source(desired)
 import psycopg
 from psycopg.types.json import Jsonb
 c=psycopg.connect(host='aws-1-us-east-1.pooler.supabase.com',port=5432,user='postgres.'+m.TARGET,dbname='postgres',password=a.password_file.read_text().rstrip('\r\n'),connect_timeout=15)
 try:
  c.isolation_level=psycopg.IsolationLevel.REPEATABLE_READ;c.read_only=not a.apply
  if a.apply:
   if not a.reviewer_approval:raise ValueError('Independent review required')
   subprocess.run(['ai-task-gates','check','--before','database','--reviewer-approval',str(a.reviewer_approval)],cwd=ROOT,check=True)
   c.execute('lock table '+', '.join(m.TABLES)+' in exclusive mode')
   if not c.execute('select pg_try_advisory_xact_lock(852000728)').fetchone()[0]:raise ValueError('Another Master refresh is active')
  m.prove(c);before=m.snapshot(c);actual=[x[0] for x in before[m.TABLES[0]]]
  key=lambda r:(r['source_sheet'],r['source_row_number'])
  observed=[{f:r[f] for f in m.FIELDS} for r in sorted(actual,key=key)]
  if m.digest(observed)!=m.digest(sorted(old,key=key)):raise ValueError('Database differs from exact converter-error preimage')
  current={key(r):r for r in actual};changes=[(current[key(r)],r) for r,prior in zip(desired,old) if r!=prior]
  if len(changes)!=8:raise ValueError('Expected exactly eight affected source rows')
  plan={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'target':m.TARGET,'source_sha256':SOURCE_SHA,'before_digest':m.digest(before),'desired_digest':m.digest(desired),'rows':8,'cells':9}
  pf=a.recovery_dir/'plan.json';bf=a.recovery_dir/'preimages.json'
  if not a.apply:
   if pf.exists():raise ValueError('Never overwrite recovery evidence')
   bf.write_text(json.dumps(before,default=str));pf.write_text(json.dumps(plan,indent=2));c.rollback();print(json.dumps(plan));return
  if json.loads(pf.read_text())!=plan or m.digest(json.loads(bf.read_text()))!=m.digest(json.loads(json.dumps(before,default=str))):raise ValueError('Plan or recovery changed')
  n=0
  for prior,r in changes:
   n+=c.execute('update public.style_tracker_rows set row_data=%s,production_status=%s,pre_production_status=%s where id=%s',(Jsonb(r['row_data']),r['production_status'],r['pre_production_status'],prior['id'])).rowcount
  if n!=8:raise ValueError('Unexpected update count')
  after=m.snapshot(c);got=[{f:x[0][f] for f in m.FIELDS} for x in after[m.TABLES[0]]]
  if m.digest(sorted(got,key=key))!=m.digest(sorted(desired,key=key)):raise ValueError('Full source equality failed')
  for table in (m.TABLES[1],m.TABLES[3],m.TABLES[4]):
   if after[table]!=before[table]:raise ValueError('Unrelated relationships or views changed')
  c.commit();(a.recovery_dir/'result.json').write_text(json.dumps({'rows_updated':8,'cells_restored':9,'full_source_equality':True}));print('Eight rows repaired; full source equality and unchanged relationships verified')
 finally:c.close()
if __name__=='__main__':main()
