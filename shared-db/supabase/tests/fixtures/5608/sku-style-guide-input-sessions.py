"""Disposable-only v4 input horizon, trusted temp and exact security contract proof."""
import argparse,json,os,subprocess,sys,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--database',required=True);a=p.parse_args()
if not a.container.startswith('shared-db-5608-') or not a.database.startswith('sku5608_'):raise RuntimeError('Only owned disposable fixture targets are allowed')
sys.path.insert(0,str(Path(__file__).resolve().parents[4]/'scripts'))
from production_catalog_verification import CATALOG_CONTRACTS
contract=CATALOG_CONTRACTS['sku_style_guide_input_snapshot_v4']
cmd=['docker','exec','-i','-e','PGOPTIONS=-c app.sku_sg_disposable=yes',a.container,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d',a.database]
session=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1);sequence=0;namespace=uuid.uuid4().hex[:10]

def fixture_sql(sql):return sql.replace('INPUT-','INPUT-'+namespace+'-').replace('input-','input-'+namespace+'-')

def first(sql):
 global sequence
 sql=fixture_sql(sql)
 sequence+=1;marker='INPUT_DONE_'+str(sequence)
 session.stdin.write(sql.rstrip().rstrip(';')+';\n\\echo '+marker+'\n');session.stdin.flush();out=[]
 while True:
  line=session.stdout.readline()
  if not line:raise RuntimeError('Fixture session ended: '+session.stderr.read())
  if line.strip()==marker:return '\n'.join(out).strip()
  out.append(line.rstrip())

def second(sql):return subprocess.check_output(cmd+['-c',fixture_sql(sql)],text=True).strip()

def rejected():
 first("do $$begin begin perform public.resolve_sku_style_guide_batch();raise exception 'Untrusted source accepted';exception when insufficient_privilege then null;end;end$$")

assert first("select current_setting('app.sku_sg_disposable')")=='yes'
assert first('select ('+contract+')')=='t'
mutations=[
 "alter function public.prepare_sku_style_guide_resolution(boolean) owner to authenticated",
 "alter function public.resolve_sku_style_guide_batch(integer) security invoker",
 "alter function public.prepare_sku_style_guide_resolution(boolean) set search_path=public",
 "revoke execute on function public.resolve_sku_style_guide_batch(integer) from service_role",
 "grant execute on function public.resolve_sku_style_guide_batch(integer) to anon",
 "grant execute on function public.resolve_sku_style_guide_batch(integer) to authenticated",
 "grant execute on function public.resolve_sku_style_guide_batch(integer) to public",
 "create or replace function public.prepare_sku_style_guide_resolution(p_full boolean default false) returns integer language plpgsql security definer set search_path=public,pg_temp as $$begin return 0;end$$",
]
for mutation in mutations:
 first('begin;'+mutation);assert first('select ('+contract+')')=='f',mutation;first('rollback');assert first('select ('+contract+')')=='t'
# New observations exercise file edits and independent PDF parsing after preparation.
first("insert into plm.dcp_style_guide(id,source_guide_id,folder_name) values(md5('input-old-guide')::uuid,'input-old','Input Original'),(md5('input-new-guide')::uuid,'input-new','Input Changed');insert into plm.dcp_asset(id,style_guide_id,file_name) values(md5('input-old-file')::uuid,md5('input-old-guide')::uuid,'InputOld.PSD'),(md5('input-new-file')::uuid,md5('input-new-guide')::uuid,'InputNew.PSD');insert into public.sku_files_used(sku,file_name,source) values('INPUT-FROZEN-FILE','InputOld.PSD','synthetic');insert into public.assets(id,sku,file_type,filename) values(md5('input-pdf')::uuid,'INPUT-FROZEN-SHEET','pdf','licensing_sheet.pdf'),(md5('input-pdf-two')::uuid,'INPUT-FROZEN-SHEET','pdf','licensing_sheet.pdf');insert into public.pdf_text_samples(asset_id,extracted_text,sampled_at,char_count) values(md5('input-pdf')::uuid,'Style Guide Used: Input Original',now(),31),(md5('input-pdf-two')::uuid,'Style Guide Used: INPUT ORIGINAL',now(),31)")
first('begin;select public.prepare_sku_style_guide_resolution(true);commit')
assert first("select count(*) from pg_temp.sku_sg_inputs where sku like 'INPUT-FROZEN-%'")=='3'
# Exact original raw hash grouping, including all observations, equals frozen hashes.
assert first("select count(*) from (select sku,md5(string_agg(row_hash,'' order by row_hash)) h from pg_temp.sku_sg_inputs group by sku except all select sku,input_hash from pg_temp.sku_sg_pending) q")=='0'
second("update public.sku_files_used set file_name='InputNew.PSD' where sku='INPUT-FROZEN-FILE';update public.pdf_text_samples set extracted_text='Style Guide Used: Input Changed' where asset_id in (md5('input-pdf')::uuid,md5('input-pdf-two')::uuid)")
assert first("select file_name from pg_temp.sku_sg_inputs where sku='INPUT-FROZEN-FILE'")=='InputOld.PSD'
assert first("select min(declared_label) from pg_temp.sku_sg_inputs where sku='INPUT-FROZEN-SHEET'")=='INPUT ORIGINAL'
first("do $$declare r jsonb;begin loop r:=public.resolve_sku_style_guide_batch();exit when (r->>'sku_rows')::integer=0;end loop;end$$")
assert first("select bool_and(l.file_name='InputOld.PSD') from public.sku_style_guide_resolver_progress p join public.sku_style_guide_links l on l.id=any(p.active_link_ids) where p.sku='INPUT-FROZEN-FILE'")=='t'
assert first("select bool_and(l.style_guide_label='INPUT ORIGINAL' and l.source_style_guide_key=public.style_guide_label_norm('INPUT ORIGINAL')) from public.sku_style_guide_resolver_progress p join public.sku_style_guide_links l on l.id=any(p.active_link_ids) where p.sku='INPUT-FROZEN-SHEET' and l.source_system='sheet_declared'")=='t'
assert int(first('select public.prepare_sku_style_guide_resolution(false)'))>=2
first("do $$declare r jsonb;begin loop r:=public.resolve_sku_style_guide_batch();exit when (r->>'sku_rows')::integer=0;end loop;end$$")
assert first("select bool_and(l.file_name='InputNew.PSD') from public.sku_style_guide_resolver_progress p join public.sku_style_guide_links l on l.id=any(p.active_link_ids) where p.sku='INPUT-FROZEN-FILE'")=='t'
assert first("select bool_and(l.style_guide_label='Input Changed') from public.sku_style_guide_resolver_progress p join public.sku_style_guide_links l on l.id=any(p.active_link_ids) where p.sku='INPUT-FROZEN-SHEET'")=='t'
# Asset SKU/type changes are deferred, then excluded from the next frozen input set.
first('begin;select public.prepare_sku_style_guide_resolution(true);commit')
second("update public.assets set sku='INPUT-MOVED-SHEET',file_type='image',filename='not-source.png' where id in (md5('input-pdf')::uuid,md5('input-pdf-two')::uuid)")
assert first("select count(*) from pg_temp.sku_sg_inputs where sku='INPUT-FROZEN-SHEET'")=='2'
first("do $$declare r jsonb;begin loop r:=public.resolve_sku_style_guide_batch();exit when (r->>'sku_rows')::integer=0;end loop;end$$")
first('select public.prepare_sku_style_guide_resolution(false)')
assert first("select count(*) from pg_temp.sku_sg_inputs where sku in ('INPUT-FROZEN-SHEET','INPUT-MOVED-SHEET')")=='0'
# Zero-pending preparation must not eagerly normalize even eligible input strings.
assert first('select public.prepare_sku_style_guide_resolution(false)')=='0'
assert first('select count(*) from pg_temp.sku_sg_inputs where file_name_norm is not null or label_key is not null')=='0'
# Direct caller sources are checked using catalogs before any view evaluation.
first('select public.prepare_sku_style_guide_resolution(true)')
for mutation in [
 'alter table pg_temp.sku_sg_inputs add column unexpected integer',
 'alter table pg_temp.sku_sg_inputs add column dropped integer;alter table pg_temp.sku_sg_inputs drop column dropped',
 'alter table pg_temp.sku_sg_inputs alter column row_hash type varchar(32)',
 'alter table pg_temp.sku_sg_inputs enable row level security',
 'drop table pg_temp.sku_sg_inputs;create temporary sequence sku_sg_inputs',
 'drop table pg_temp.sku_sg_inputs',
]:
 first('begin;'+mutation);rejected();first('rollback')
first("begin;drop table pg_temp.sku_sg_inputs;set local role service_role;create temporary table sku_sg_inputs(sku text,input_kind text,file_name text,file_name_norm text,declared_label text,declared_key text,label_key text,row_hash text);reset role")
rejected();first('rollback')
first("begin;drop table pg_temp.sku_sg_inputs;create temporary sequence input_guard_sentinel;create temporary view sku_sg_inputs as select nextval('pg_temp.input_guard_sentinel')::text sku,'file'::text input_kind,null::text file_name,null::text file_name_norm,null::text declared_label,null::text declared_key,null::text label_key,null::text row_hash")
rejected();assert first('select is_called from pg_temp.input_guard_sentinel')=='f'
# Prepare replaces the hostile view, without executing it, with definer-owned raw data.
first('set local role service_role;select public.prepare_sku_style_guide_resolution(true);reset role')
assert first('select is_called from pg_temp.input_guard_sentinel')=='f'
first('select public.resolve_sku_style_guide_batch()');first('rollback')
# Reused explicit transaction compatibility entrypoint and autonomous procedure remain valid.
first('begin;select public.resolve_sku_style_guide_links();select public.resolve_sku_style_guide_links();commit')
first('call public.resolve_sku_style_guide_links_run();call public.resolve_sku_style_guide_links_run()')
assert first('select count(*) from pg_locks where pid=pg_backend_pid() and locktype=\'advisory\'')=='0'
session.stdin.close();session.wait(timeout=10)
print(json.dumps({'security_contract_positive':True,'security_contract_negative_cases':len(mutations),'frozen_file_and_pdf_changes':True,'arm2_norm_of_min_equivalent_raw_spellings':True,'next_invocation_converges':True,'asset_sku_type_changes_deferred':True,'zero_pending_skips_normalization':True,'hostile_owner_shape_view_sequence_missing_sources_rejected':True,'hostile_view_never_evaluated':True,'service_prepare_recreates_trusted_snapshot':True,'repeated_same_session_wrappers_and_procedures':True}))
