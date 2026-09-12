#!/usr/bin/env python3
"""Disposable PostgreSQL fixture with production-width synthetic file payload: exact result parity and an unchanged 8s budget.
Never connects to Supabase. All names and 217,193 fixture rows are synthetic.
Baseline volume timeouts are recorded, not retried or granted a larger budget.
"""
from pathlib import Path
import os,subprocess,time,json,uuid,argparse
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'supabase/migrations/20260908214749_popsg_search_v2_bounded_paging.sql'
FORWARD=ROOT/'supabase/migrations/20260911213429_popsg_search_v2_production_performance.sql'
FIXTURE="\ncreate table public.style_guide_files(id uuid primary key,is_active boolean,thumbnail_url text,thumbnail_error text);\ncreate table public.style_guide_search_documents(style_guide_file_id uuid primary key,root_label text,licensor_name text,property_folder text,style_guide_folder text,style_guide_name text,directory_path text,relative_path text,filename text,file_extension text,tag_names text[],size_bytes bigint,modified_at timestamptz,is_active boolean,pdf_text_status text,pdf_text_length integer,search_vector tsvector,padding text);\ncreate table public.style_guide_render_queue(style_guide_file_id uuid,status text,attempts integer);\ninsert into public.style_guide_files select md5(i::text)::uuid, i%37<>0,case when i%3=0 then 'https://example.invalid/preview' end,case when i%17=0 then 'synthetic terminal' end from generate_series(1,217193)i;\ninsert into public.style_guide_search_documents select f.id,'synthetic-root','licensor-'||((i/20)%20),'property-'||((i/20)%100),'guide-'||(i/20),'guide-'||(i/20),'synthetic/directory','synthetic/path/'||i,'file-'||i,case when i%2=0 then 'pdf' else 'ai' end,array['tag-'||(i%10),'shared-tag'],i*100,'2026-01-01'::timestamptz+(i%90)*interval '1 day',true,case when i%4=0 then 'extracted' end,case when i%4=0 then 100 else 0 end,to_tsvector('simple',case when i%13=0 then 'matchtoken' else 'other' end),repeat('x',500) from generate_series(1,217193)i join public.style_guide_files f on f.id=md5(i::text)::uuid;\ninsert into public.style_guide_render_queue select md5(i::text)::uuid,(array['pending','claimed','processing','failed','completed'])[1+i%5],i%5 from generate_series(1,11660)i;\ncreate index on public.style_guide_search_documents using gin(search_vector);\nanalyze;\n"
EDGE="update public.style_guide_search_documents set licensor_name='edge',root_label='edge',property_folder=case when substring(filename from 6)::int%4=0 then null when substring(filename from 6)::int%4=1 then '' else 'edge-property' end,style_guide_folder='edge-group-'||(substring(filename from 6)::int%6),style_guide_name='edge-name-'||(substring(filename from 6)::int%6),tag_names=case when substring(filename from 6)::int%5=0 then array['duplicate','duplicate',null] when substring(filename from 6)::int%5=1 then '{}'::text[] else array['duplicate','second'] end,modified_at='2026-02-01',search_vector=to_tsvector('simple',case when substring(filename from 6)::int%2=0 then 'edgechild' else 'other' end) where substring(filename from 6)::int<=40;"
CASES=[('edge-unfiltered', {}), ('edge-child', {'p_query': "'edgechild'::text"}), ('equal-date', {'p_modified_after': "'2026-02-01'::timestamptz", 'p_modified_before': "'2026-02-01'::timestamptz"}), ('before-boundary', {'p_modified_before': "'2026-02-01'::timestamptz"}), ('after-boundary', {'p_modified_after': "'2026-02-01'::timestamptz"}), ('outside-date', {'p_modified_after': "'2026-02-02'::timestamptz"}), ('combined', {'p_preview_states': "array['missing']", 'p_pdf_content_states': "array['available']", 'p_render_exception_states': "array['recoverable_error','waiting','terminal_exception','unclassified']", 'p_modified_before': "'2026-02-01'::timestamptz"}), ('duplicate-tag', {'p_tags': "array['duplicate']"}), ('empty-arrays', {'p_tags': "'{}'::text[]", 'p_extensions': "'{}'::text[]"}), ('multivalue', {'p_licensors': "array['edge','licensor-0']", 'p_extensions': "array['pdf','ai']", 'p_query': "'matchtoken'::text"})]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--dirty-visibility',action='store_true',help='Change live thumbnail-error state for about two percent of synthetic files without vacuum before timing; exercise index-only heap fetches under rendering churn.')
    parser.add_argument('--parity-only',action='store_true',help='Use 80 synthetic rows and skip the unchanged volume benchmark')
    parser.add_argument('--database-url',default=os.environ.get('POPSG_BENCHMARK_DATABASE_URL'),help='Disposable PostgreSQL to use instead of a docker container. The caller owns creating and dropping it; this script never connects to Supabase.')
    options=parser.parse_args()
    name='popsg-v2-benchmark-'+uuid.uuid4().hex[:12]
    container=None
    if options.database_url and urlparse(options.database_url).hostname not in {'127.0.0.1','localhost','::1'}:
        parser.error('Only a disposable loopback PostgreSQL target is permitted.')
    if options.database_url:
        def sql(query):
            return subprocess.run(['psql',options.database_url,'-v','ON_ERROR_STOP=1','-qAt'],input=query,text=True,capture_output=True)
    else:
        container=subprocess.check_output(['docker','run','--rm','-d','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'],text=True).strip()
        def sql(query):
            return subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],input=query,text=True,capture_output=True)
    def require(query):
        result=sql(query)
        if result.returncode:raise RuntimeError(result.stderr)
        return result.stdout.strip()
    try:
        for _ in range(60):
            if (sql('select 1;').returncode==0) if container is None else (subprocess.run(['docker','exec',container,'pg_isready','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0):break
            time.sleep(0.1)
        else:raise RuntimeError('disposable postgres did not become ready')
        require("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;create schema auth;create type public.app_name as enum('styleguides');create function auth.role() returns text language sql as $$select 'service_role'::text$$;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function public.has_app_access(uuid,public.app_name) returns boolean language sql as $$select true$$;")
        require(FIXTURE.replace('217193','80') if options.parity_only else FIXTURE)
        require("alter table public.style_guide_files add column padding text; alter table public.style_guide_files alter column padding set storage plain; update public.style_guide_files set padding=repeat(md5(id::text),25),thumbnail_url=case when thumbnail_url is not null then thumbnail_url||repeat('u',70) end,thumbnail_error=case when thumbnail_error is not null then repeat('e',809) end;vacuum analyze public.style_guide_files;")
        # Model the existing production function ACL before CREATE OR REPLACE.
        require((ROOT/'supabase/migrations/20260907131610_popsg_search_style_guide_library_v2.sql').read_text())
        require(BASE.read_text().replace('search_style_guide_library_v2','search_style_guide_library_v2_baseline'))
        require(FORWARD.read_text())
        acl_ok=require("select not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)');")
        if acl_ok!='t':raise RuntimeError('Existing RPC execution permissions changed')
        if options.dirty_visibility:
            require("update public.style_guide_files set thumbnail_error=case when thumbnail_error is null then 'synthetic newly rendered error' else null end where substring(id::text,1,2) in ('01','35','67','99','cd');")
        # Authorization boundary for both bodies: an authenticated caller without
        # PopSG access, and an anonymous caller, must be refused with 42501.
        for suffix in ['_baseline','']:
            for role,uid,access in [('authenticated',"'25060000-0000-4000-8000-000000000002'::uuid",'false'),('anon','null::uuid','true')]:
                denied=sql("create or replace function auth.role() returns text language sql as $$select '"+role+"'::text$$;create or replace function auth.uid() returns uuid language sql as $$select "+uid+"$$;create or replace function public.has_app_access(uuid,public.app_name) returns boolean language sql as $$select "+access+"$$;select public.search_style_guide_library_v2"+suffix+"(p_result_mode=>'files',p_limit=>1);")
                if denied.returncode==0 or 'PopSG access required' not in denied.stderr:raise RuntimeError('authorization boundary not enforced: '+role+suffix)
            allowed=require("create or replace function auth.role() returns text language sql as $$select 'authenticated'::text$$;create or replace function auth.uid() returns uuid language sql as $$select '25060000-0000-4000-8000-000000000001'::uuid$$;create or replace function public.has_app_access(uuid,public.app_name) returns boolean language sql as $$select true$$;select (public.search_style_guide_library_v2"+suffix+"(p_result_mode=>'files',p_limit=>1)) is not null;")
            if allowed!='t':raise RuntimeError('authorized authenticated caller refused: '+suffix)
        require("create or replace function auth.role() returns text language sql as $$select 'service_role'::text$$;create or replace function auth.uid() returns uuid language sql as $$select null::uuid$$;create or replace function public.has_app_access(uuid,public.app_name) returns boolean language sql as $$select true$$;")
        print('PASS: authorization boundary identical for baseline and forward (deny authenticated-without-access, deny anon, allow authorized).',flush=True)
        for mode in ([] if options.parity_only else ['files','guides']):
            hashes={}
            for label,suffix in [('baseline','_baseline'),('forward','')]:
                start=time.monotonic()
                result=sql("set work_mem='5MB';set statement_timeout='8000ms';select md5(value::text),value->>'total' from(select public.search_style_guide_library_v2"+suffix+"(p_result_mode=>'"+mode+"',p_sort=>'modified_desc',p_limit=>50) as value) q;")
                elapsed=round((time.monotonic()-start)*1000)
                print(json.dumps(dict(mode=mode,variant=label,elapsed_ms=elapsed,outcome='timeout' if result.returncode and 'statement timeout' in result.stderr else 'pass' if not result.returncode else 'error',summary=result.stdout.strip())),flush=True)
                if result.returncode and (label=='forward' or 'statement timeout' not in result.stderr):raise RuntimeError(result.stderr)
                if not result.returncode:hashes[label]=result.stdout.strip()
            # Full-width equality is enforced whenever the baseline finished inside its budget.
            if 'baseline' in hashes and hashes['baseline']!=hashes['forward']:raise RuntimeError('full-width result mismatch in '+mode+' mode: '+hashes['baseline']+' != '+hashes['forward'])
            print(json.dumps(dict(mode=mode,full_width_hash_equal=('baseline' in hashes) or None)),flush=True)
        require(EDGE)
        # Null activity, empty (but non-null) thumbnail values, and all live queue states.
        require("update public.style_guide_files set is_active=null where id=md5('3')::uuid; update public.style_guide_files set thumbnail_url='' where id=md5('4')::uuid; update public.style_guide_files set thumbnail_url=null,thumbnail_error='' where id=md5('5')::uuid;")
        require("delete from public.style_guide_search_documents where substring(filename from 6)::int>80;")
        require("delete from public.style_guide_files where id not in(select style_guide_file_id from public.style_guide_search_documents);")
        partition_ok=require("select not exists(select id from public.style_guide_files where is_active except (select id from public.style_guide_files where is_active and thumbnail_url is not null union all select id from public.style_guide_files where is_active and thumbnail_url is null and thumbnail_error is null union all select id from public.style_guide_files where is_active and thumbnail_url is null and thumbnail_error is not null));")
        if partition_ok!='t':raise RuntimeError('Live-state index partition lost an active file')
        count=0
        for mode in ['files','guides']:
            for case,overrides in CASES:
                for sort,offset in [(sort,offset) for sort in ['relevance','modified_desc','modified_asc','name_asc'] for offset in ['0','5']]:
                    values={'p_result_mode':"'"+mode+"'",'p_licensors':"array['edge']",'p_sort':"'"+sort+"'",'p_limit':'5','p_offset':offset,**overrides}
                    args=','.join(k+'=>'+v for k,v in values.items())
                    equal=require("set work_mem='5MB';set statement_timeout='8000ms';select public.search_style_guide_library_v2_baseline("+args+")=public.search_style_guide_library_v2("+args+");")
                    if equal!='t':raise RuntimeError('full JSON mismatch: '+mode+'/'+case+'/'+sort+'/'+offset)
                    count+=1
        print(f'PASS: {count} exact full-JSON parity cases; 0 skipped.')
    finally:
        if container is not None:
            subprocess.run(['docker','stop',container],check=True,stdout=subprocess.DEVNULL)
if __name__=='__main__':main()
