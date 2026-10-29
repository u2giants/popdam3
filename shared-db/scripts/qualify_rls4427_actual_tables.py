#!/usr/bin/env python3
"""4427-only actual-table qualification inside the existing ephemeral DB CI.

No connection options, downloaded code or live data. Only two fixed snapshot operations
use matching tools in the strictly verified existing native CI database container. Each timed statement
gets a new physical TEMPLATE clone; rollback is never treated as heap restoration.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import stat
import subprocess
import sys
import tempfile
import time
import uuid

try:
    import rls4427_physical_cluster as physical4427
except ImportError:
    from scripts import rls4427_physical_cluster as physical4427

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'supabase/tests/rls_public_admin_initplan_contracts.sql'
NATIVE_BUDGET_SECONDS = 2700
SOURCE_SQL_SHA256 = '166a1d7cae922b27c229c31162b612ccb1957a27440806681a15677151354667'
POSTGRES_CONTEXT_QUERY = "select json_build_object('system_identifier',(select system_identifier::text from pg_control_system()),'server_version_num',current_setting('server_version_num')::int,'postmaster_start',pg_postmaster_start_time()::text,'database',current_database())::text;"
RESTORE_AUTHORITY_QUERY = "select json_build_object('system_identifier',(select system_identifier::text from pg_control_system()),'server_version_num',current_setting('server_version_num')::int,'postmaster_start',pg_postmaster_start_time()::text,'database',current_database(),'current_user',current_user,'session_user',session_user,'rolsuper',r.rolsuper,'rolcanlogin',r.rolcanlogin,'is_superuser',current_setting('is_superuser'))::text from pg_roles r where r.rolname=current_user;"


def validate_restore_authority(facts, context):
    expected = {**context, 'current_user':'supabase_admin','session_user':'supabase_admin',
                'rolsuper':True,'rolcanlogin':True,'is_superuser':'on'}
    if facts != expected:
        raise RuntimeError('4427 existing restore authority or same-instance identity differs')
    return facts


END = '-- Invoker-only probing, with each write reverted by a private subtransaction.'
ADMIN = '00000000-7541-4000-8000-000000000001'
MEMBER = '00000000-7541-4000-8000-000000000002'
CASES = [('assets', 'INSERT'), ('assets', 'UPDATE'),
         ('style_groups', 'INSERT'), ('style_groups', 'UPDATE'), ('style_groups', 'DELETE')]
SIZES = (1, 100, 10000)
POLICIES = [('assets', 'Admins can insert assets', 'WITH CHECK'),
            ('assets', 'Admins can update assets', 'USING'),
            ('style_groups', 'Admins can manage style_groups', 'USING')]


def assert_ci(env):
    required = {'GITHUB_ACTIONS': 'true', 'CI': 'true', 'GITHUB_REPOSITORY': 'popcre/shared-db', 'GITHUB_WORKFLOW': 'Database Contract Tests',
                'GITHUB_EVENT_NAME': 'workflow_dispatch', 'RLS4427_QUALIFICATION': '1',
                'PGHOST': '127.0.0.1', 'PGPORT': '54322', 'PGUSER': 'postgres', 'PGDATABASE': 'postgres'}
    if any(env.get(k) != v for k, v in required.items()):
        raise RuntimeError('4427 refuses mismatched declared native CI context; parent must independently prove resource custody')
    if not re.fullmatch('[a-f0-9]{40}', env.get('GITHUB_SHA', '')):
        raise RuntimeError('4427 requires the exact native CI source SHA')
    if any(env.get(k) for k in ('SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD_PRODUCTION',
                               'SUPABASE_DB_PASSWORD_PREVIEW', 'DATABASE_URL')):
        raise RuntimeError('4427 refuses live credentials or database URL')


def fixture_sql(source):
    if hashlib.sha256(source.encode()).hexdigest() != SOURCE_SQL_SHA256:
        raise RuntimeError('4427 retained exact fixture source hash changed')
    if source.count(END) != 1:
        raise RuntimeError('4427 fixture boundary changed')
    fragment = source[source.index('begin;'):source.index(END)]
    if not fragment.lstrip().startswith('begin;') or 'create temp table rls4427_manifest' not in fragment:
        raise RuntimeError('4427 actual source fixture/preconditions missing')
    return fragment + "\ncommit;\n"


def jobs():
    result = []
    for table, command in CASES:
        for size in SIZES:
            for sample in range(11):
                variants = ('original', 'candidate') if sample % 2 == 0 else ('candidate', 'original')
                result += [(table, command, size, sample, v) for v in variants]
    for table in ('assets', 'style_groups'):
        for sample in range(11):
            variants = ('original', 'candidate') if sample % 2 == 0 else ('candidate', 'original')
            result += [(table, 'SELECT', 1000, sample, v) for v in variants]
    return [j for j in result if j[3]==0]+[j for j in result if j[3]!=0]


def seed_sql():
    return """
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at)
select md5('4427-actual-asset-'||i)::uuid,'zz-4427-actual-'||i||'.ai',
 'zz-4427-actual/'||i||'.ai','ai','zz-4427-actual-'||i,'2000-01-01'::timestamptz
from generate_series(1,10000) i;
insert into public.style_groups(id,sku,folder_path)
select md5('4427-actual-style-'||i)::uuid,'zz-4427-actual-'||i,'zz-4427-actual/'||i
from generate_series(1,10000) i;
"""


def statement(table, command, n):
    if table not in ('assets', 'style_groups') or command not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
        raise ValueError('4427 unknown workload')
    if command == 'SELECT':
        return f'SELECT count(*)::integer AS bounded_count FROM (SELECT 1 FROM public.{table} LIMIT 1000) AS bounded'
    identity = "'4427-actual-asset-'" if table == 'assets' else "'4427-actual-style-'"
    where = f"id IN (SELECT md5({identity}||i)::uuid FROM generate_series(1,{n}) i)"
    if command == 'UPDATE':
        change = "workflow_status='other'" if table == 'assets' else "program='changed-synthetic'"
        return f'UPDATE public.{table} SET {change} WHERE {where} RETURNING id'
    if command == 'DELETE' and table == 'style_groups':
        return f'DELETE FROM public.style_groups WHERE {where} RETURNING id'
    if command == 'INSERT' and table == 'assets':
        return f"""INSERT INTO public.assets(id,filename,relative_path,file_type,quick_hash,modified_at)
SELECT md5('4427-actual-insert-asset-'||i)::uuid,'zz-4427-new-'||i||'.ai',
 'zz-4427-new/'||i||'.ai','ai','zz-4427-new-'||i,'2000-01-01'::timestamptz
FROM generate_series(1,{n}) i RETURNING id"""
    if command == 'INSERT' and table == 'style_groups':
        return f"""INSERT INTO public.style_groups(id,sku,folder_path)
SELECT md5('4427-actual-insert-style-'||i)::uuid,'zz-4427-new-'||i,'zz-4427-new/'||i
FROM generate_series(1,{n}) i RETURNING id"""
    raise ValueError('4427 unsupported table command')


def role_sql(subject):
    return f"""set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim','',true);
select set_config('request.jwt.claims','{{"role":"authenticated","sub":"{subject}"}}',true);
do $guard$ begin
 if current_user<>'authenticated' or exists(select 1 from pg_roles
 where rolname=current_user and(rolsuper or rolbypassrls)) then
 raise exception '4427 role bypass'; end if;
end $guard$;
"""


def snapshot_sql(table):
    if table not in ('assets','style_groups'):raise ValueError('4427 unknown fingerprint table')
    # Actual relation bytes, rowset, indexes and visible union, not row-count-only pairing.
    # Dedicated metadata psql session only; benchmark sessions keep their defaults.
    return f"""set search_path=pg_catalog;
select jsonb_build_object(
'heap_md5',md5(pg_read_binary_file(pg_relation_filepath('public.{table}'::regclass))),
'visibility_md5',case when (pg_stat_file(pg_relation_filepath('public.{table}'::regclass)||'_vm',true)).size is not null
 then md5(pg_read_binary_file(pg_relation_filepath('public.{table}'::regclass)||'_vm')) else null end,
'indexes_md5',(select jsonb_agg(jsonb_build_array(indexrelid,
 md5(pg_read_binary_file(pg_relation_filepath(indexrelid)))) order by indexrelid)
 from pg_index where indrelid='public.{table}'::regclass),
'heap_bytes',pg_relation_size('public.{table}'),'index_bytes',pg_indexes_size('public.{table}'),
'rows_md5',(select md5(string_agg(row_to_json(t)::text,E'\\n' order by id)) from public.{table} t),
'policies',(select jsonb_agg(jsonb_build_object('table',polrelid::regclass::text,
 'name',polname,'command',polcmd,'permissive',polpermissive,'roles',polroles,
 'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))
 order by polrelid,polname) from pg_policy),
'capability',(select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl::text,
 c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c
 join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','archive','plm')),
'helpers',(select jsonb_agg(jsonb_build_array(oid,proowner,proacl::text,provolatile,
 prosecdef,proconfig,pg_get_functiondef(oid)) order by oid) from pg_proc where oid in
 ('auth.uid()'::regprocedure,'public.has_role(uuid,public.app_role)'::regprocedure)),
'settings',jsonb_build_object('server_version',current_setting('server_version'),
 'block_size',current_setting('block_size'),'work_mem',current_setting('work_mem'),
 'plan_cache_mode',current_setting('plan_cache_mode')));"""


def compact_snapshot(snapshot):
    return {**{k: snapshot[k] for k in ('heap_md5', 'visibility_md5', 'indexes_md5', 'heap_bytes', 'index_bytes', 'rows_md5', 'settings')},
            'capability_sha256': hashlib.sha256(json.dumps({k:snapshot[k] for k in
                ('policies','capability','helpers')}, sort_keys=True).encode()).hexdigest()}


def summarize(samples):
    out = []
    for table, command, size in dict.fromkeys(j[:3] for j in jobs()):
        rows = [r for r in samples if (r['table'], r['command'], r['size']) == (table, command, size)
                and not r['warmup']]
        original = [r['plan'][0]['Execution Time'] for r in rows if r['variant'] == 'original']
        candidate = [r['plan'][0]['Execution Time'] for r in rows if r['variant'] == 'candidate']
        a, b = statistics.median(original), statistics.median(candidate)
        out.append(dict(table=table, command=command, size=size, original_median_ms=a,
                        candidate_median_ms=b, delta_percent=100*(b/a-1),
                        median_regression_over_10_percent=b > a*1.1,
                        original_p95_ms=sorted(original)[-1], candidate_p95_ms=sorted(candidate)[-1]))
    return out


ORIGINAL_POLICY_CALLS=tuple(f"{function}(auth.uid(), 'admin'::{role_type})"
    for function in ('has_role','public.has_role') for role_type in ('app_role','public.app_role'))
ORIGINAL_POLICY_SPELLINGS=ORIGINAL_POLICY_CALLS+tuple('('+call+')' for call in ORIGINAL_POLICY_CALLS)


def policy_expression_diagnostic(value,key,field):
    text=re.sub(r'\s+',' ',value).strip() if isinstance(value,str) else ''
    return dict(policy_index=next(i for i,(table,name,_) in enumerate(POLICIES) if (table,name)==key),field=field,
        value_type='string' if isinstance(value,str) else 'null' if value is None else 'OTHER',
        length=len(value) if isinstance(value,str) else None,normalized_length=len(text),
        sha256=hashlib.sha256(value.encode('utf-8',errors='surrogatepass')).hexdigest() if isinstance(value,str) else None,
        function_public=bool(re.match(r'^\(?public\.has_role\(',text)),function_unqualified=bool(re.match(r'^\(?has_role\(',text)),
        type_public='::public.app_role' in text,type_unqualified='::app_role' in text,admin_literal="'admin'" in text,
        starts_outer=text.startswith('('),ends_outer=text.endswith('))'),balanced_parenthesis_count=text.count('(')==text.count(')'),
        select_present=bool(re.search(r'\bSELECT\b',text,re.IGNORECASE)))


def validate_policy_delta(before, after, variant):
    if before['capability'] != after['capability'] or before['helpers'] != after['helpers']:
        raise RuntimeError('4427 capabilities or helper definitions changed')
    left, right = before['policies'], after['policies']
    if len(left) != len(right):
        raise RuntimeError('4427 full policy union cardinality changed')
    changed = set()
    for a, b in zip(left, right):
        if a == b:
            continue
        expected = {(t, n): 'check' if clause == 'WITH CHECK' else 'qual' for t, n, clause in POLICIES}
        key = (a['table'].removeprefix('public.'), a['name'])
        if variant != 'original' or key not in expected:
            raise RuntimeError('4427 unrelated policy changed')
        field = expected[key]
        if {k:v for k,v in a.items() if k != field} != {k:v for k,v in b.items() if k != field}:
            raise RuntimeError('4427 policy roles/command/implicit check changed')
        normalized=re.sub(r'\s+', ' ', b[field]).strip() if isinstance(b[field],str) else None
        if normalized not in ORIGINAL_POLICY_SPELLINGS:
            error=RuntimeError('4427 original expression not exact')
            error.policy_expression_diagnostic=policy_expression_diagnostic(b[field],key,field)
            raise error
        changed.add(key)
    if variant == 'original' and changed != {(t,n) for t,n,_ in POLICIES}:
        raise RuntimeError('4427 intended original policy delta incomplete')




class NativeCI:
    def __init__(self):
        assert_ci(os.environ)
        self.env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
        self.env['PGPASSWORD'] = 'postgres'  # public, invented native CI password only
        self.prefix = 'rls4427_' + uuid.uuid4().hex[:12]
        self.owned = []
        self.started = time.monotonic()
        self.cleanup = []
        self.physical = None
        self.phase='admission';self.primary_error=None;self.cleanup_error=None;self.cluster_attempt=None;self.last_external_failure=None

    def command(self, tool, db, *args, input_text=None, binary=False):
        if self.physical is not None:
            if tool!='psql' or db!='postgres' or binary or input_text is None:raise RuntimeError('4427 physical target command refused')
            role='supabase_admin' if input_text in (snapshot_sql('assets'),snapshot_sql('style_groups')) else 'postgres'
            return self.physical.sql(input_text,role=role)
        cmd = [tool, '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', db, *args]
        return self.checked(cmd, input=input_text, capture_output=True, text=not binary).stdout

    def diagnostic(self, kind, **facts):
        print(json.dumps(dict(qualification_diagnostic=kind, **facts), sort_keys=True), file=sys.stderr)

    def begin_phase(self,name):
        self.phase=name;self.phase_started=time.monotonic()
        if self.physical is not None:self.physical.phase=name
        self.diagnostic('phase-begin',phase=name,elapsed_action_seconds=self.phase_started-self.started)

    def end_phase(self):
        self.diagnostic('phase-end',phase=self.phase,elapsed_phase_seconds=time.monotonic()-self.phase_started,elapsed_action_seconds=time.monotonic()-self.started)

    def checked(self, argv, **options):
        try:
            return subprocess.run(argv, env=self.env, timeout=120, check=True, **options)
        except subprocess.CalledProcessError as error:
            self.last_external_failure=physical4427.capture_external(error.stderr,Path(argv[0]).name,error.returncode,self.phase)
            self.diagnostic('command-failure',**self.last_external_failure)
            raise

    def docker_read(self, *args):
        return self.checked(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock',
            '--config', self.docker_config, *args], capture_output=True, text=True).stdout

    @staticmethod
    def validate_container(row, expected_id=None):
        cid = row.get('Id', '')
        labels = row.get('Config', {}).get('Labels', {})
        state = row.get('State', {})
        host = row.get('HostConfig', {})
        network = row.get('NetworkSettings', {})
        image = row.get('Config', {}).get('Image', '')
        if not re.fullmatch(r'[0-9a-f]{64}', cid) or (expected_id and cid != expected_id):
            raise RuntimeError('4427 native container identity changed or invalid')
        if row.get('Name') != '/supabase_db_shared-db' or any(labels.get(k) != 'shared-db'
                for k in ('com.supabase.cli.project', 'com.docker.compose.project')):
            raise RuntimeError('4427 native container name/project custody refused')
        if not state.get('Running') or state.get('Status') != 'running' or state.get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('4427 native container not healthy and running')
        if host.get('Privileged') is not False or host.get('PidMode', '') or host.get('Devices') or host.get('CapAdd') or host.get('NetworkMode') != 'supabase_network_shared-db' or host.get('IpcMode', '') not in ('', 'private') or host.get('UTSMode', '') or host.get('SecurityOpt'):
            raise RuntimeError('4427 native container elevated host access refused')
        if host.get('Binds') != ['supabase_db_shared-db:/var/lib/postgresql/data'] or host.get('Mounts') or host.get('VolumesFrom'):
            raise RuntimeError('4427 native container unexpected host mount refused')
        mounts = row.get('Mounts', [])
        if len(mounts) != 1 or any(mounts[0].get(k) != v for k, v in
                dict(Type='volume', Name='supabase_db_shared-db', Destination='/var/lib/postgresql/data', RW=True).items()):
            raise RuntimeError('4427 native container volume custody refused')
        if set(network.get('Networks', {})) != {'supabase_network_shared-db'}:
            raise RuntimeError('4427 native container network custody refused')
        expected_ports = {'5432/tcp'}
        for mapping in (host.get('PortBindings', {}), network.get('Ports', {})):
            ports = mapping.get('5432/tcp') or []
            if set(mapping) != expected_ports or not ports or any(p.get('HostPort') != '54322' or
                    p.get('HostIp', '') not in ('', '0.0.0.0', '::', '127.0.0.1', '::1') for p in ports):
                raise RuntimeError('4427 native container loopback target port mapping refused')
        if not re.fullmatch(r'public\.ecr\.aws/supabase/postgres:[A-Za-z0-9_.-]+', image):
            raise RuntimeError('4427 native CLI postgres image family refused')
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', row.get('Image', '')):
            raise RuntimeError('4427 native container immutable image identity refused')
        return cid, row['Image'], image

    def custody(self):
        rows = json.loads(self.docker_read('inspect', '--type', 'container', 'supabase_db_shared-db'))
        if not isinstance(rows, list) or len(rows) != 1:
            raise RuntimeError('4427 native container cardinality refused')
        identity = self.validate_container(rows[0], getattr(self, 'container_id', None))
        if hasattr(self, 'container_image') and identity[1:] != self.container_image:
            raise RuntimeError('4427 native container image changed')
        images = json.loads(self.docker_read('image', 'inspect', identity[1]))
        if len(images) != 1 or images[0].get('Id') != identity[1] or identity[2] not in (images[0].get('RepoTags') or []):
            raise RuntimeError('4427 native image metadata binding refused')
        inherited = images[0].get('Config', {}).get('Labels') or {}
        ownership = {'com.supabase.cli.project': 'shared-db', 'com.docker.compose.project': 'shared-db'}
        if any(k in inherited and inherited[k] != value for k, value in ownership.items()):
            raise RuntimeError('4427 native image ownership label conflicts')
        if rows[0]['Config']['Labels'] != {**inherited, **ownership}:
            raise RuntimeError('4427 container metadata differs from exact immutable image and ownership labels')
        return identity

    def source_checked(self,args,input_file=None,output_file=None,allowed_failure=False):
        args=list(args);kind=physical4427.source_command_kind(args)
        authority=['psql','-XqAtw','-h','127.0.0.1','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',RESTORE_AUTHORITY_QUERY]
        if args==authority:kind='read'
        if kind is None:raise RuntimeError('4427 unsupported physical source command')
        if kind=='archive':
            if not getattr(self,'restore_authority_qualified',False) or input_file is not None or output_file is None:
                raise RuntimeError('4427 physical archive requires qualified authority/private output')
            if args==physical4427.BACKUP_ARGS and not getattr(self,'hba_temporary_verified',False):
                raise RuntimeError('4427 physical backup route not positively loaded')
        elif kind=='hba-write':
            if not getattr(self,'restore_authority_qualified',False) or not getattr(self,'hba_window_active',False) or input_file is None or output_file is not None:
                raise RuntimeError('4427 exact HBA write outside qualified permission window')
        elif kind=='hba-metadata':
            if not getattr(self,'hba_window_active',False) or input_file is not None or output_file is not None:
                raise RuntimeError('4427 exact HBA metadata outside restoration window')
        elif input_file is not None or output_file is not None:
            raise RuntimeError('4427 physical readonly source probe refuses stdin/output file')
        if kind in ('hba-write','hba-metadata'):physical4427.validate_hba_payload(self,args,input_file)
        self.custody()
        argv=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',self.docker_config,
              'exec',*(['-i'] if input_file is not None else []),'--env','PGPASSWORD=postgres',self.container_id,*args]
        result=subprocess.run(argv,env=self.env,**physical4427.process_input(input_file),
            stdout=output_file or subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
        if result.returncode and not allowed_failure:
            self.last_external_failure=physical4427.capture_external(result.stderr,args[0],result.returncode,self.phase)
            self.diagnostic('physical-source-command-failure',exit_code=result.returncode,tool=args[0])
            raise subprocess.CalledProcessError(result.returncode,argv,output=result.stdout,stderr=result.stderr)
        return result

    def container_exec(self,args,input_file=None,output_file=None):
        return self.source_checked(args,input_file=input_file,output_file=output_file).stdout

    def qualify_physical_source(self):
        if any(k.startswith('DOCKER_') and v for k,v in os.environ.items()):raise RuntimeError('4427 physical Docker override refused')
        endpoint=Path('/var/run/docker.sock');info=endpoint.stat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=0 or info.st_mode&0o007 or str(endpoint.resolve()) not in ('/run/docker.sock','/var/run/docker.sock'):
            raise RuntimeError('4427 physical source Unix endpoint refused')
        identity=self.custody();self.container_id=identity[0];self.container_image=identity[1:]
        if identity[1]!='sha256:'+physical4427.IMMUTABLE_CONFIG_SHA:raise RuntimeError('4427 native physical image config differs')
        self.immutable_config_sha=physical4427.IMMUTABLE_CONFIG_SHA
        host=json.loads(self.sql('postgres',POSTGRES_CONTEXT_QUERY))
        args=['psql','-XqAtw','-h','127.0.0.1','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',RESTORE_AUTHORITY_QUERY]
        self.restore_authority=validate_restore_authority(json.loads(self.container_exec(args)),host)
        self.restore_authority_qualified=True
        self.physical_versions={}
        for tool in ('pg_basebackup','pg_verifybackup'):
            version=self.container_exec([tool,'--version']).decode().strip()
            if re.fullmatch(re.escape(tool)+r' \(PostgreSQL\) 17\.6',version) is None:raise RuntimeError('4427 native physical tool version differs')
            self.physical_versions[tool]=version
        self.diagnostic('physical-source-authority-qualified',**self.restore_authority)

    def sql(self,db,query):
        if db!='postgres':raise RuntimeError('4427 physical driver requires preserved database postgres')
        return self.command('psql',db,'-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate',input_text=query)

    def run(self):
        # Source/context guards supplement independently reviewed native workflow custody.
        # Environment values alone cannot cryptographically prove an actual GitHub runner.
        checkout = subprocess.run(['/usr/bin/git', 'rev-parse', 'HEAD'], cwd=ROOT,
            env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'}, capture_output=True, text=True,
            timeout=10, check=True).stdout.strip()
        if checkout != os.environ['GITHUB_SHA']:
            raise RuntimeError('4427 native CI SHA does not match actual checked-out source')
        source_hashes = {}
        for relative in ('scripts/qualify_rls4427_actual_tables.py',
                         'scripts/rls4427_physical_cluster.py',
                         'supabase/tests/rls_public_admin_actual_table_performance.sql',
                         'supabase/tests/rls_public_admin_initplan_contracts.sql'):
            committed = subprocess.run(['/usr/bin/git', 'show', 'HEAD:' + relative], cwd=ROOT,
                env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'}, capture_output=True,
                timeout=10, check=True).stdout
            actual = (ROOT / relative).read_bytes()
            if actual != committed:
                raise RuntimeError('4427 executed source differs from exact checked-out Git source')
            source_hashes[relative] = hashlib.sha256(actual).hexdigest()
        samples = []
        template = self.prefix + '_seed'
        try:
            # Prove the exact psql shell-failure/SQL-error signal before any DB creation.
            try:
                self.sql('postgres', "\\! false\n\\if :SHELL_ERROR\nselect 1/0;\n\\endif\n")
            except subprocess.CalledProcessError as error:
                if error.returncode != 3 or not re.search(r'\b22012\b', error.stderr or ''):
                    raise RuntimeError('4427 native psql failure signal was not exact') from error
            else:
                raise RuntimeError('4427 native psql shell failure did not fail closed')
            self.sql('postgres', """do $g$ begin
if (select count(*) from auth.users where email in
('zz-fixture-user-1@fixture.invalid','zz-fixture-user-2@fixture.invalid',
 'zz-fixture-user-3@fixture.invalid','zz-fixture-user-4@fixture.invalid'))<>4
then raise exception '4427 native synthetic users missing'; end if;
end $g$;""")
            original=FIXTURE.read_text();owned_fixture=fixture_sql(original)
            # This empty private CLI context permits existing source custody proof
            # BEFORE the original transactional source suite performs any DML.
            with tempfile.TemporaryDirectory(prefix='rls4427-source-suite-') as context:
                os.chmod(context,0o700)
                config=Path(context)/'docker-config';config.mkdir(mode=0o700)
                self.docker_config=str(config)
                self.begin_phase('source-identity-and-authority-qualification')
                self.qualify_physical_source()
                self.end_phase()
                self.begin_phase('source-original-contract')
                original_result=self.sql('postgres',original)
                self.diagnostic('source-original-contract-completed',execution='QUALIFIED_NATIVE_SOURCE_ONLY',output_sha256=hashlib.sha256(original_result.encode()).hexdigest(),source_sql_sha256=SOURCE_SQL_SHA256)
                self.end_phase()
            self.begin_phase('physical-source-backup-and-target-recovery')
            remaining=NATIVE_BUDGET_SECONDS-(time.monotonic()-self.started)
            if remaining<=0:raise RuntimeError('4427 forty-five-minute qualification budget exhausted before copy')
            cluster=physical4427.PhysicalCluster(self,budget_seconds=remaining);self.cluster_attempt=cluster
            cluster.open()
            self.physical=cluster
            self.end_phase()
            template='postgres'
            tool_versions=self.physical_versions
            snapshot={'sql_crypto_capability':cluster.crypto_receipt(),'kind':'FULL_PHYSICAL_CLUSTER','source_facts':cluster.source_facts,'source_image_config_sha':cluster.source.immutable_config_sha,'basebackup':cluster.original_backup_receipt,'original_config':cluster.original_config_receipt,'original_backup_verified':cluster.original_backup_verified,'full_capability_fingerprint':cluster.full_capability_fingerprint}
            self.begin_phase('owned-target-fixture-derived-sql')
            self.sql('postgres',owned_fixture+seed_sql())
            self.end_phase()
            self.begin_phase('owned-target-analyze')
            self.sql('postgres','ANALYZE public.assets; ANALYZE public.style_groups;')
            analyze_facts=json.loads(self.sql('postgres',"select json_agg(json_build_array(relname,n_tup_ins,n_mod_since_analyze,last_analyze::text) order by relname) from pg_stat_user_tables where schemaname='public' and relname in ('assets','style_groups');"))
            self.end_phase()
            self.begin_phase('owned-target-warm-snapshot')
            # Warm both tables before clean shutdown flushes their hint bits.
            for table in ('assets','style_groups'):self.sql('postgres',snapshot_sql(table))
            self.end_phase()
            self.begin_phase('owned-target-seal')
            canonical=cluster.seal()
            self.end_phase()
            warmup_active=[];projected=None;base_metadata={}
            pair_fingerprints = {}
            negative_pairs = {}
            def execute_trial(index,job):
                table,cmd,size,sample,variant=job
                self.phase=f'physical-matrix-{index}-{table}-{cmd}-{variant}';self.phase_started=time.monotonic()
                if time.monotonic() - self.started > NATIVE_BUDGET_SECONDS:
                    raise RuntimeError('4427 forty-five-minute qualification budget exhausted')
                db='postgres'
                cluster.begin_trial()
                try:
                    before = json.loads(self.sql(db, snapshot_sql(table)))
                    if before['heap_bytes'] >= 1073741824 or before['index_bytes'] >= 1073741824:
                        raise RuntimeError('4427 relation too large for bounded first-segment fingerprint')
                    if table not in base_metadata:base_metadata[table]=before
                    if before != base_metadata[table]:
                        raise RuntimeError('4427 clone physical/rowset/index/policy/settings drift')
                    if variant == 'original':
                        self.sql(db, '\n'.join(f'ALTER POLICY "{name}" ON public.{t} {clause} '
                            "(public.has_role(auth.uid(), 'admin'::public.app_role));"
                            for t, name, clause in POLICIES))
                    variant_metadata = json.loads(self.sql(db, snapshot_sql(table)))
                    validate_policy_delta(before, variant_metadata, variant)
                    # Identical read-only warmup; no aborted DML changes the starting heap.
                    query = statement(table, cmd, size)
                    selected = None
                    if cmd == 'SELECT':
                        control = f"SELECT jsonb_build_object('count',count(*),'rowset_md5',md5(string_agg(id::text,',' order by id))) FROM (SELECT id FROM public.{table} LIMIT 1000) bounded;"
                        out = self.sql(db, 'begin;\n' + role_sql(ADMIN) + control + '\nrollback;')
                        selected = json.loads(out.splitlines()[-1])
                        if selected['count'] != 1000:
                            raise RuntimeError('4427 actual SELECT count changed')
                    trial = "begin; set local statement_timeout='30s'; set local lock_timeout='3s';\n"
                    trial += role_sql(ADMIN)
                    trial += "do $g$ begin if not public.has_role(auth.uid(),'admin'::public.app_role) then raise exception '4427 missing admin'; end if; end $g$;\n"
                    trial += f'SELECT count(*) FROM public.{table};\n'
                    trial += 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query + ';\nrollback;'
                    output = self.sql(db, trial)
                    # psql also prints set_config/warmup values; JSON plan is final array.
                    start = output.index('[\n')
                    plan = json.loads(output[start:])
                    rows = plan[0]['Plan']['Actual Rows']
                    if cmd != 'SELECT' and rows != size:
                        raise RuntimeError('4427 actual command did not affect the expected synthetic rows')
                    if cmd == 'SELECT' and rows != 1:
                        raise RuntimeError('4427 SELECT aggregate row missing')
                    # Nonadmin actual-command control after timing, in its own rollback.
                    negative_sql = "begin; set local statement_timeout='30s';\n" + role_sql(MEMBER)
                    negative_sql += "do $g$ begin if public.has_role(auth.uid(),'admin'::public.app_role) then raise exception '4427 nonadmin identity is admin'; end if; end $g$;\n"
                    negative_sql += 'EXPLAIN (ANALYZE, FORMAT JSON) ' + query + ';\nrollback;'
                    try:
                        negative_out = self.sql(db, negative_sql)
                        negative_plan = json.loads(negative_out[negative_out.index('[\n'):])
                        negative = dict(sqlstate='00000', rows=negative_plan[0]['Plan']['Actual Rows'])
                    except subprocess.CalledProcessError as error:
                        found = re.search(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?::|\s|$)', error.stderr or '')
                        if not found:
                            raise RuntimeError('4427 negative control lacked exact SQLSTATE') from error
                        if found.group(1) != '42501':
                            raise RuntimeError('4427 nonadmin control failed outside permission denial') from error
                        negative = dict(sqlstate=found.group(1))
                    after = json.loads(self.sql(db, snapshot_sql(table)))
                    # Rollback logical restoration is checked, but physical after-bytes are NOT called restored.
                    validate_policy_delta(variant_metadata, after, 'candidate')
                    if before['rows_md5'] != after['rows_md5']:
                        raise RuntimeError('4427 actual fixture rollback failed')
                    key = (table, cmd, size, sample)
                    logical = {k: before[k] for k in ('heap_md5', 'visibility_md5', 'indexes_md5', 'rows_md5', 'heap_bytes', 'index_bytes', 'settings')}
                    if selected is not None:
                        logical['selected'] = selected
                    if key in pair_fingerprints and pair_fingerprints[key] != logical:
                        raise RuntimeError('4427 pair did not start with the same physical fixture')
                    pair_fingerprints[key] = logical
                    if key in negative_pairs and negative_pairs[key] != negative:
                        raise RuntimeError('4427 original/candidate nonadmin command outcome differs')
                    negative_pairs[key] = negative
                    samples.append(dict(table=table, command=cmd, size=size, sample=sample,
                        warmup=sample == 0, variant=variant, before=compact_snapshot(before), after=compact_snapshot(after), selected=selected, negative=negative, plan=plan))
                finally:
                    cluster.end_trial()
            for index,job in enumerate(jobs()):
                started=time.monotonic();wait_before=cluster.window_wait_seconds
                execute_trial(index,job)
                if job[3]==0:
                    warmup_active.append(time.monotonic()-started-(cluster.window_wait_seconds-wait_before))
                if index==33:
                    projected=cluster.projected_matrix_check(warmup_active)
            if len(samples) != 374:
                raise RuntimeError('4427 incomplete 330-DML/44-SELECT matrix')
            summary = summarize(samples)
            return dict(schema_version=1, source_sha=os.environ['GITHUB_SHA'],
                executed_source_sha256=source_hashes, tool_versions=tool_versions, snapshot=snapshot, canonical=canonical, analyze_facts=analyze_facts, warmup_active_seconds=warmup_active, actual_admission_wait_seconds=cluster.window_wait_seconds, projected_matrix_seconds=projected, owned_physical_receipts=cluster.events,
                sql_crypto_capability=cluster.crypto_receipt(), warmup_trials_in374=34, remaining_measured_trials=340, config_metadata_verified=cluster.config_metadata_verified, metadata_fingerprint_role='supabase_admin', psql_shell_failure_signal_proven=True, qualification='ISOLATED_ACTUAL_TABLES_ONLY', production_acceptance='NOT_EVALUATED',
                historical_flags='PRESERVED_UNATTRIBUTED', source_sql_sha256=hashlib.sha256(original.encode()).hexdigest(),
                original_contract_execution='QUALIFIED_NATIVE_SOURCE_ONLY', original_contract_output_sha256=hashlib.sha256(original_result.encode()).hexdigest(),
                template_snapshots=base_metadata, samples=samples, summary=summary,
                synthetic_performance_disposition='FLAGGED' if any(r['median_regression_over_10_percent'] for r in summary) else 'NO_FLAG_IN_THIS_SYNTHETIC_BATCH')
        except Exception as error:
            self.primary_error=error
            raise
        finally:
            if self.physical is not None:
                try:self.physical.close()
                except Exception as cleanup:
                    self.cleanup_error=cleanup
                    if self.primary_error is None:raise
                finally:self.physical=None


def main():
    driver=None
    try:
        driver=NativeCI();report=driver.run()
        print(json.dumps(report,sort_keys=True))
        return 0
    except Exception as exc:
        cluster=getattr(driver,'cluster_attempt',None)
        failure=physical4427.failure_receipt(exc,getattr(driver,'phase','admission'),getattr(cluster,'events',[]))
        if getattr(exc,'policy_expression_diagnostic',None) is not None:failure['policy_expression_diagnostic']=exc.policy_expression_diagnostic
        failure['elapsed_action_seconds']=time.monotonic()-driver.started if driver is not None else None
        failure['elapsed_phase_seconds']=time.monotonic()-driver.phase_started if getattr(driver,'phase_started',None) is not None else None
        failure['source_external']=getattr(driver,'last_external_failure',None)
        failure['target_external']=getattr(cluster,'last_external_failure',None)
        if getattr(driver,'cleanup_error',None) is not None:
            failure['cleanup_failure']=physical4427.failure_receipt(driver.cleanup_error,'cleanup',getattr(cluster,'events',[]))
        print(json.dumps(failure,sort_keys=True),file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
