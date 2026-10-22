"""Invented, local PostgreSQL regression for #4210's forward-only recovery.

No network, Supabase credentials, shared database, or licensed rows are used.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / 'supabase/migrations/20261012005136_popsg_parse_search_query_once.sql'
NEW = ROOT / 'supabase/migrations/20261022043547_popsg_guides_matched_set_via_search_index.sql'
SIGNATURE = 'public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)'


class ForwardRecovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='popsg-forward-local-')
        cls.directory = Path(cls.temp.name)
        bins = sorted(Path('/usr/lib/postgresql').glob('*/bin/initdb'), reverse=True)
        which_initdb = shutil.which('initdb')
        cls.container = None
        if (bins or which_initdb) and shutil.which('psql'):
            cls.bin = bins[0].parent if bins else Path(which_initdb).parent
            cls.data = cls.directory / 'data'
            subprocess.run([str(cls.bin / 'initdb'), '-D', str(cls.data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
            # Pick a free localhost port: a fixed port collides with any other
            # postgres on this machine and the fixture must never reuse one.
            sock = socket.socket()
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
            sock.close()
            # 127.0.0.1 works on Windows and Linux; empty listen_addresses is not portable.
            subprocess.run([str(cls.bin / 'pg_ctl'), '-D', str(cls.data), '-l', str(cls.directory / 'server.log'), '-o', f"-p {cls.port} -h 127.0.0.1 -k \"\"", 'start', '-w'], check=True, capture_output=True)
            cls.env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': str(cls.port), 'PGUSER': 'postgres', 'PGDATABASE': 'postgres'}
            cls.psql = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
        elif shutil.which('docker'):
            # A private network-less disposable fixture, never an existing container.
            cls.container = 'popsg-forward-fixture-' + uuid.uuid4().hex[:12]
            subprocess.run(['docker', 'run', '--rm', '-d', '--network', 'none', '--name', cls.container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17'], check=True, capture_output=True)
            cls.addClassCleanup(lambda: subprocess.run(['docker', 'rm', '-f', cls.container], capture_output=True))
            for _ in range(120):
                ready = subprocess.run(['docker', 'exec', cls.container, 'sh', '-c', 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres'], capture_output=True)
                if not ready.returncode:
                    break
                time.sleep(0.25)
            else:
                raise AssertionError('Private PostgreSQL fixture did not start')
            cls.env = os.environ.copy()
            cls.psql = ['docker', 'exec', '-i', cls.container, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
        else:
            raise unittest.SkipTest('Local PostgreSQL or Docker tools unavailable')
        cls.old_definition = OLD.read_text().split('create or replace function', 1)[1]
        cls.definition = 'create or replace function' + cls.old_definition
        text = NEW.read_text()
        cls.guard = text[text.index('do $recovery_contract$'):text.index('create or replace function')]
        cls.sql("""
create role authenticated; create role anon; create role service_role;
create schema auth;
create type public.app_name as enum ('styleguides');
create function auth.role() returns text language sql stable as $b$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$b$;
create function auth.uid() returns uuid language sql stable as $b$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$b$;
create function public.has_app_access(uuid,public.app_name) returns boolean language sql stable as $b$select $1='00000000-0000-0000-0000-000000000001'::uuid$b$;
create table public.style_guide_files(id uuid primary key,is_active boolean,thumbnail_url text,thumbnail_error text);
create type public.queue_status as enum ('pending','claimed','processing','done','failed');
create table public.style_guide_render_queue(style_guide_file_id uuid,status public.queue_status,attempts integer);
create table public.style_guide_search_documents(style_guide_file_id uuid primary key,root_label text,licensor_name text,property_folder text,style_guide_folder text,style_guide_name text,directory_path text,relative_path text,filename text,file_extension text,tag_names text[],size_bytes bigint,modified_at timestamptz,pdf_text_status text,pdf_text_length integer,is_active boolean,search_vector tsvector);
create materialized view public.style_guide_library_default_summary as select ''::text result_mode,0::bigint total,'{}'::jsonb facets where false;
create materialized view public.style_guide_library_default_guides as select '{}'::jsonb result,null::timestamptz modified_at,''::text sort_name,''::text entity_key where false;
insert into public.style_guide_files select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,i<>8,case when i%3=0 then null else 'https://fixture.invalid/preview' end,case when i=6 then 'invented_failure' end from generate_series(1,8)i;
insert into public.style_guide_search_documents select id,'Fixture root',case when n=7 then 'Other licensor' else 'Fixture licensor' end,case when n<=4 then 'A' else 'B' end,'Fixture guide folder',case when n<=4 then 'Guide A' else 'Guide B' end,'fixture','fixture', 'ART-'||n||'.pdf',case when n=4 then 'ai' else 'pdf' end,array['blue','fixture'],123,timestamptz '2026-10-01 12:00:00+00'+(case when n=6 then 20 else n end)*interval '1 minute','extracted',100,true,to_tsvector('simple',case when n<=5 then 'blue ART123 playful shapes' else 'red ART999 quiet shapes' end) from (select id,row_number() over(order by id) n from public.style_guide_files) f;
insert into public.style_guide_render_queue select id,'pending',0 from public.style_guide_files where thumbnail_url is null;
""" + cls.definition + f"revoke all on function {SIGNATURE} from public; grant execute on function {SIGNATURE} to authenticated, service_role;")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'data') and (cls.data / 'postmaster.pid').exists():
            subprocess.run([str(cls.bin / 'pg_ctl'), '-D', str(cls.data), 'stop', '-m', 'immediate'], capture_output=True)
        cls.temp.cleanup()

    @classmethod
    def sql(cls, text, succeeds=True):
        run = subprocess.run(cls.psql, input=text, text=True, env=cls.env, capture_output=True)
        if succeeds and run.returncode:
            raise AssertionError(run.stderr)
        if not succeeds and not run.returncode:
            raise AssertionError('Drift was accepted')
        return run.stdout.strip(), run.stderr

    def test_full_json_parity_counts_facets_pages_and_acl(self):
        calls=[]
        for mode in ('files','guides'):
            for query in ('NULL', "'blue'", "'ART123'", "'zznomatch'"):
                for sort in ('relevance','modified_desc','modified_asc','name_asc'):
                    for offset in (0,2,99):
                        calls.append(f"select public.search_style_guide_library_v2(p_result_mode=>'{mode}',p_query=>{query},p_sort=>'{sort}',p_limit=>2,p_offset=>{offset})")
            for limit in (1,50):
                calls.append(f"select public.search_style_guide_library_v2(p_result_mode=>'{mode}',p_query=>'shapes',p_limit=>{limit})")
            for parameter,value in [('p_licensors',"array['Other licensor']"),('p_style_guides',"array['Guide B']"),('p_modified_after',"timestamptz '2026-10-01 12:03:00+00'"),('p_modified_before',"timestamptz '2026-10-01 12:04:30+00'"),('p_properties',"array['A']"),('p_extensions',"array['PDF']"),('p_tags',"array['blue']"),('p_preview_states',"array['missing']"),('p_render_exception_states',"array['waiting']"),('p_pdf_content_states',"array['available']")]:
                calls.append(f"select public.search_style_guide_library_v2(p_result_mode=>'{mode}',p_query=>'blue',{parameter}=>{value})")
        statements=';\n'.join(calls)+';'
        before,_=self.sql(statements)
        acl_before,_=self.sql(f"select proacl::text from pg_proc where oid='{SIGNATURE}'::regprocedure;")
        self.sql(NEW.read_text())
        after,_=self.sql(statements)
        self.assertEqual(before,after)
        self.assertEqual(len(after.splitlines()),120)
        first=json.loads(after.splitlines()[0]);self.assertEqual(first['total'],7)
        keyword,_=self.sql("select public.search_style_guide_library_v2(p_query=>'ART123')->>'total';")
        self.assertEqual(keyword,'5')
        # Guide B's newest child (n=6) has no preview: the thumbnail must fall back to n=5.
        thumb,_=self.sql("select r->>'thumbnail_url' from jsonb_array_elements(public.search_style_guide_library_v2(p_result_mode=>'guides',p_query=>'shapes')->'results') r where r->>'style_guide_name'='Guide B' and r->>'licensor_name'='Fixture licensor';")
        self.assertEqual(thumb,'https://fixture.invalid/preview')
        empty,_=self.sql("select public.search_style_guide_library_v2(p_query=>'zznomatch')->>'total';")
        self.assertEqual(empty,'0')
        acl_after,_=self.sql(f"select proacl::text from pg_proc where oid='{SIGNATURE}'::regprocedure;")
        self.assertEqual(acl_before,acl_after)
        _,error=self.sql("begin;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';select public.search_style_guide_library_v2(p_query=>'blue');rollback;",False)
        self.assertIn('PopSG access required',error)
        allowed,_=self.sql("begin;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';select public.search_style_guide_library_v2(p_query=>'blue')->>'total';rollback;")
        self.assertEqual(allowed,'5')

    def test_fail_closed_before_replacement_for_each_drift(self):
        mutations=[
            f"alter function {SIGNATURE} set work_mem='128MB';",
            f"alter function {SIGNATURE} set statement_timeout='30s';",
            f"alter function {SIGNATURE} reset all;",
            "alter table public.style_guide_search_documents alter column pdf_text_length type bigint;",
            f"alter function {SIGNATURE} security invoker;",
            f"alter function {SIGNATURE} volatile;",
            f"alter function {SIGNATURE} owner to authenticated;",
            f"grant execute on function {SIGNATURE} to anon;",
            f"revoke execute on function {SIGNATURE} from service_role;",
            "alter table public.style_guide_search_documents rename search_vector to search_vector_drift;",
            self.definition.replace('tsq as materialized','tsq as not materialized'),
        ]
        for change in mutations:
            with self.subTest(change=change[:80]):
                _,error=self.sql('begin;'+change+NEW.read_text()+'rollback;',False)
                self.assertIn('exact already-live reviewed contract',error)
        self.sql(self.guard)


class RepairMarkers(unittest.TestCase):
    """Static checks only — no PostgreSQL fixture required."""

    def test_repaired_body_markers_and_static_provenance(self):
        text = NEW.read_text()
        self.assertIn('-- derived-from: 20261012005136\n', text)
        self.assertIn("md5(prosrc) in ('9d5dd045810fa3fce5cc3d508e1210ff', '97e0d7ed121765f239867a48618f695b')", text)
        self.assertIn("md5(prosrc) = 'eb7e64398002f7f575d97708bf6641a5'", text)
        body = text.split('as $function$',1)[1].rsplit('$function$;',1)[0]
        self.assertEqual(hashlib.md5(body.encode()).hexdigest(), 'eb7e64398002f7f575d97708bf6641a5')
        # A: live_files materialized once (no remaining not-materialized form).
        self.assertIn('live_files as materialized (', body)
        self.assertNotIn('live_files as not materialized (', body)
        # B: page_children stops joining style_guide_files; thumbs come from page_thumb.
        self.assertIn('page_thumb_ids as materialized (', body)
        self.assertIn('page_thumb as materialized (', body)
        # Thumbnail joins once per page row, never once per matched child.
        self.assertIn('left join page_thumb th on th.group_id=pg.group_id', body)
        self.assertNotIn('left join page_thumb t on t.group_id = d.group_id', body)
        # page_children joins page on the hashable length-prefixed group_id, not a
        # five-way IS NOT DISTINCT FROM (which forced a 94k x 50 nested loop).
        self.assertIn('on pg.group_id = concat_ws(chr(31),', body.split('page_children as materialized (',1)[1].split('page_thumb_ids',1)[0])
        # guide_facets deduplicates entity attributes before the lateral fan-out.
        self.assertIn("'tags'::text as category, tag.value", body)
        self.assertIn('join public.style_guide_files f on f.id = t.style_guide_file_id', body)
        # Files path keeps its live style_guide_files join; Guides path must not.
        guides_body = body.split('execute $guides_query$', 1)[1]
        # Guides matched set starts from the search_vector GIN predicate, not a pkey probe per live file.
        guides_children = guides_body.split('active_children as materialized (',1)[1].split('), entities as materialized',1)[0]
        self.assertIn('m.is_active and m.search_vector @@ mt.query', guides_children)
        self.assertNotIn('from public.style_guide_search_documents d\n    join live_files', guides_children)
        self.assertIn('live_payload.thumbnail_url', body)  # Files path still live-joins
        self.assertNotIn('live_payload.thumbnail_url', guides_body)
        # C/D/E landmarks.
        self.assertIn('cross join lateral (', body)
        self.assertIn('pdf_text_available', body)
        self.assertIn('group by d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name', body)
        sidecar = json.loads((ROOT / 'scripts/production-verification-sidecars/20261022043547.json').read_text())
        self.assertEqual(sidecar['migration_sha256'], hashlib.sha256(NEW.read_bytes()).hexdigest())
        for marker in sidecar['marker_reviews']:
            self.assertIn('execute $guides_query$', text.splitlines()[marker['line_start']-1])


if __name__ == '__main__':
    unittest.main()
