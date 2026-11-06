"""Owned synthetic-only #5608 full-scale fixture, no hosted target/network."""
import argparse,json,subprocess,time
from pathlib import Path
CONTAINER='shared-db-5608-index-agent-perf'
DATABASE='sku5608_input_perf_index_agent_v2'
ROOT=Path(__file__).resolve().parents[4]
CMD=['docker','exec','-i','-e','PGOPTIONS=-c app.sku_sg_disposable=yes',CONTAINER,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d',DATABASE]
def sql(s,timeout=180):
 p=subprocess.run(CMD,input=s,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError(p.stderr[-2500:])
 return p.stdout

def setup():
 # This owned v2 database already exists from guarded header initialization.
 if sql("select to_regclass('public.assets') is null;").strip()!='t':raise RuntimeError('Setup requires a fresh disposable database')
 header=(ROOT/'supabase/tests/fixtures/5608/sku-style-guide-links-eight-portals-fixture.sql').read_text().split('\\ir ')[0]
 header=header.replace('filename text);','filename text,is_deleted boolean default false,padding text);',1).replace('create index on public.assets(sku);','create index on public.assets(sku) where is_deleted=false;\nalter table public.assets alter column padding set storage plain;')
 header=header.replace('create role anon; create role authenticated; create role service_role bypassrls;','')
 sql("do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;")
 sql(header)
 for name in ['20261030043848_sku_style_guide_links.sql','20261105044255_sku_style_guide_resolution_incremental.sql','20261105061627_sku_style_guide_resolution_snapshot.sql']:
  sql('begin;\n'+(ROOT/'supabase/migrations'/name).read_text()+'\ncommit;')
 # Revised distribution predeclared by root: match observed selectivity, not tune timing.
 bootstrap=(ROOT/'supabase/ci-bootstrap/010_pre_adoption_baseline.sql').read_text()
 a=bootstrap.rindex('CREATE OR REPLACE FUNCTION public.is_style_guide_source_pdf(')
 b=bootstrap.index('$function$;',a)+len('$function$;')
 sql(bootstrap[a:b]+"\ncreate extension pg_trgm;create index fixture_assets_filename_trgm on public.assets using gin(filename gin_trgm_ops);")
 sql('''insert into plm.dcp_style_guide(id,source_guide_id,folder_name)
 select md5('guide'||g)::uuid,'guide-'||g,'The Guide '||g from generate_series(1,10000)g;
 insert into plm.dcp_asset(id,style_guide_id,file_name)
 select md5('portal'||g)::uuid,md5('guide'||(g%10000+1))::uuid,'File_'||g||'.PSD' from generate_series(1,600000)g;
 insert into public.assets(id,sku,file_type,filename,is_deleted,padding)
 select md5('asset'||g)::uuid,case when g<=10259 then 'SKU-'||lpad((g%8050+1)::text,5,'0') when g>10259 and nr<=56407 then null else 'SKU-'||lpad((g%8677+1)::text,5,'0') end,
 case when g<=61873 then 'pdf' else 'png' end,case when g<=61873 then 'licensing_sheet.pdf' else 'unrelated.png' end,g%11=0,
 (select string_agg(md5(g::text||':'||j),'') from generate_series(1,62)j)
 from (select g,case when g>10259 then row_number() over(partition by (g>10259) order by md5('nullslot'||g)) end nr from generate_series(1,156339)g)x;
 alter table public.pdf_text_samples alter column extracted_text set storage plain;
 insert into public.pdf_text_samples(asset_id,extracted_text,sampled_at,char_count)
 select md5('asset'||g)::uuid,case when g<=10259 then E'CORE/STYLE GUIDE USED: The Guide '||(g%10000+1)||E'\\n' else E'Not an eligible style guide\\n' end||
 (select string_agg(md5(g::text||':'||j),'') from generate_series(1,60)j),now(),2000 from generate_series(1,27915)g;
 insert into public.sku_files_used(sku,file_name,source)
 select 'SKU-'||lpad((g%8050+1)::text,5,'0'),'File_'||g||'.PSD','synthetic' from generate_series(1,11602)g;
 analyze;
 ''',timeout=300)
 print(sql('''select jsonb_build_object('assets',(select count(*) from public.assets),'assets_heap',pg_relation_size('public.assets'),
 'pdfs',(select count(*) from public.pdf_text_samples),'pdf_heap',pg_relation_size('public.pdf_text_samples'),
 'files',(select count(*) from public.sku_files_used),'portal',(select count(*) from plm.asset_file_style_guide_keys),
 'asset_distinct_skus',(select count(distinct sku) from public.assets),'asset_null_frac',(select avg((sku is null)::int) from public.assets),'filename_candidates',(select count(*) from public.assets where public.is_style_guide_source_pdf(file_type,filename)), 'eligible_skus',(select count(distinct sku) from (select sku from public.sku_files_used union all select a.sku from public.pdf_text_samples p join public.assets a on a.id=p.asset_id where nullif(p.declared_style_guide_key,'') is not null)q));'''))


COLS='sku,file_name,source_system,source_style_guide_key,style_guide_label,match_method,match_confidence,matched_asset_count,core_style_guide_id'
def oracle():
 original=(ROOT/'supabase/migrations/20261030043848_sku_style_guide_links.sql').read_text()
 start=original.index('create or replace function public.resolve_sku_style_guide_links()')
 end=original.index('$function$;',start)+len('$function$;')
 body=original[start:end].replace('public.resolve_sku_style_guide_links()','public.fixture_5608_original()',1)
 sql(body+"\nselect public.fixture_5608_original();create table public.fixture_5608_reference_output as select "+COLS+" from public.sku_style_guide_links;")

def measure(source):
 import hashlib
 sql('begin;\n'+source.read_text()+'\ncommit;')
 query=r"""set statement_timeout='60s';
select clock_timestamp() as began \gset
call public.resolve_sku_style_guide_links_run(true);
select jsonb_build_object('full_seconds',extract(epoch from clock_timestamp()-:'began'::timestamptz),'progress',(select count(*) from public.sku_style_guide_resolver_progress),'links',(select count(*) from public.sku_style_guide_links),'pending',(select count(*) from pg_temp.sku_sg_pending),'differences',(select count(*) from ((table public.fixture_5608_reference_output except all select COLS from public.sku_style_guide_links) union all(select COLS from public.sku_style_guide_links except all table public.fixture_5608_reference_output))d));
set statement_timeout='5s';
select clock_timestamp() as began \gset
call public.resolve_sku_style_guide_links_run(false);
select jsonb_build_object('same_session_unchanged_seconds',extract(epoch from clock_timestamp()-:'began'::timestamptz),'pending',(select count(*) from pg_temp.sku_sg_pending));
""".replace('COLS',COLS)
 t=time.monotonic();result=subprocess.run(CMD+['-A','-t'],input=query,text=True,capture_output=True,timeout=70)
 if result.returncode:raise RuntimeError(result.stderr)
 rows=[json.loads(x) for x in result.stdout.splitlines() if x.startswith('{')]
 assert len(rows)==2 and rows[0]['full_seconds']<60 and rows[0]['differences']==0 and rows[0]['progress']==8050 and rows[0]['pending']==0
 assert rows[1]['same_session_unchanged_seconds']<5 and rows[1]['pending']==0
 fresh=time.monotonic();sql("set statement_timeout='5s';call public.resolve_sku_style_guide_links_run(false);",timeout=8);fresh=time.monotonic()-fresh
 assert fresh<5
 print(json.dumps({'migration_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'whole_session_seconds':time.monotonic()-t,'fresh_session_unchanged_wall_seconds':fresh,'results':rows,'synthetic_only':True}))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--setup',action='store_true');p.add_argument('--measure',action='store_true');p.add_argument('--container',required=True);p.add_argument('--database',required=True);p.add_argument('--migration',type=Path);a=p.parse_args()
 if not a.container.startswith('shared-db-5608-') or not a.database.startswith('sku5608_'):raise RuntimeError('Only owned disposable fixture targets allowed')
 CONTAINER=a.container;DATABASE=a.database
 CMD=['docker','exec','-i','-e','PGOPTIONS=-c app.sku_sg_disposable=yes',CONTAINER,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d',DATABASE]
 if a.setup:setup();oracle()
 if a.measure:
  if not a.migration:raise RuntimeError('An exact reviewed migration is required')
  measure(a.migration.resolve())
