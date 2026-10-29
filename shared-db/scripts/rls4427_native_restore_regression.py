#!/usr/bin/env python3
"""One reviewed #4427 local physical calibration; import is offline.

Synthetic native Supabase source only. No connection, image, command or target
options; no production rows. The separate physical helper owns backup/reset/HBA
window authority. This file supplies a bounded owned source and one paired check.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
IMAGE='sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13'
IMAGE_CONFIG='sha256:e1939b94b1fd12b8a446404ff49455d7cf2a6a275a77f010abb56a247bfd5377'
IMAGE_TAG='public.ecr.aws/supabase/postgres:17.6.1.132'
OWNER='01a1834a-a908-73d2-be1b-7225b92a7f8e'
PREFIX='rls4427-local-01a1834a'
NAME=PREFIX+'-source'
DATA='/var/lib/postgresql/data'
CONFIG_ROOTS=('etc/postgresql','etc/postgresql-custom')
TMPFS={DATA:'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=4294967296',
       '/etc/postgresql':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=33554432',
       '/etc/postgresql-custom':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=33554432',
       '/var/run/postgresql':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=16777216',
       '/var/log/postgresql':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=33554432',
       '/tmp':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=134217728'}
BOOTSTRAP_LOG='/var/log/postgresql/4427-bootstrap.log'
BOOTSTRAP_START=['sh','-c','exec docker-entrypoint.sh postgres -D /etc/postgresql > /var/log/postgresql/4427-bootstrap.log 2>&1']
BOOTSTRAP_READY=['sh','-c',"for i in $(seq 1 30); do grep -Fq 'PostgreSQL init process complete; ready for start up.' /var/log/postgresql/4427-bootstrap.log 2>/dev/null && pg_ctl -D /etc/postgresql status >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p 5432 -U supabase_admin >/dev/null 2>&1 && test \"$(psql -XqAtw -h 127.0.0.1 -p 5432 -U supabase_admin -d postgres -c 'select 1;' 2>/dev/null)\" = 1 && exit 0; sleep 1; done; exit 1"]
LABELS={'shared-db.regression':'4427-local-physical','shared-db.owner':OWNER}
CONTEXT_SQL="select json_build_object('system_identifier',(select system_identifier::text from pg_control_system()),'server_version_num',current_setting('server_version_num')::int,'postmaster_start',pg_postmaster_start_time()::text,'database',current_database())::text;"
AUTHORITY_SQL="select json_build_object('system_identifier',(select system_identifier::text from pg_control_system()),'server_version_num',current_setting('server_version_num')::int,'postmaster_start',pg_postmaster_start_time()::text,'database',current_database(),'current_user',current_user,'session_user',session_user,'rolsuper',r.rolsuper,'rolcanlogin',r.rolcanlogin,'is_superuser',current_setting('is_superuser'))::text from pg_roles r where r.rolname=current_user;"
FILE_FUNCTION_PRIVILEGES_SQL="""select json_build_object('postgres_superuser',(select rolsuper from pg_roles where rolname='postgres'),
'pg_read_server_files_member',pg_has_role('postgres','pg_read_server_files','MEMBER'),
'pg_read_binary_file_execute',has_function_privilege('postgres','pg_catalog.pg_read_binary_file(text)','EXECUTE'),
'pg_stat_file_execute',has_function_privilege('postgres','pg_catalog.pg_stat_file(text,boolean)','EXECUTE'))::text;"""
NATIVE_SQL="""select json_build_object(
'extensions',(select json_agg(json_build_array(extname,extversion,pg_get_userbyid(extowner),extnamespace,extrelocatable,extconfig::text,extcondition::text) order by extname) from pg_extension),
'roles',(select json_agg(json_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig) order by rolname) from pg_roles),
'membership',(select json_agg(json_build_array(roleid,member,grantor,admin_option,inherit_option,set_option) order by roleid,member,grantor) from pg_auth_members),
'databases',(select json_agg(json_build_array(oid,datname,datdba,datacl::text,datistemplate,datallowconn,datconnlimit) order by datname) from pg_database),
'db_settings',(select json_agg(json_build_array(setdatabase,setrole,setconfig) order by setdatabase,setrole) from pg_db_role_setting),
'native_schemas',(select json_agg(json_build_array(nspname,pg_get_userbyid(nspowner),nspacl::text) order by nspname) from pg_namespace where nspname in ('public','auth','storage')),
'worker_settings',(select json_agg(json_build_array(name,setting,context) order by name) from pg_settings where name in ('shared_preload_libraries','cron.database_name','cron.launch_active_jobs','cron.use_background_workers','pgsodium.getkey_script','row_security','ssl','wal_level','full_page_writes'))
)::text;"""
ORIGINAL_POLICY="owner='synthetic' AND rls4427_fixture.request_allowed()"
CANDIDATE_POLICY="owner='synthetic' AND (SELECT rls4427_fixture.request_allowed())"
PAIR_SQL="begin;set local role rls4427_writer;set local request.jwt.claim.role='fixture_writer';explain(analyze,buffers,format json) update rls4427_fixture.objects set label=' paired ' where owner='synthetic' returning id;rollback;"
FINGERPRINT_SQL="""select json_build_object(
'heap_md5',md5(pg_read_binary_file(pg_relation_filepath('rls4427_fixture.objects'))),
'indexes_md5',(select md5(string_agg(encode(pg_read_binary_file(pg_relation_filepath(indexrelid)),'hex'),'' order by indexrelid)) from pg_index where indrelid='rls4427_fixture.objects'::regclass),
'heap_bytes',pg_relation_size('rls4427_fixture.objects'),
'rows',(select json_agg(t order by id) from rls4427_fixture.objects t))::text;"""


def load_helper():
    path=ROOT/'scripts/rls4427_physical_cluster.py'
    spec=importlib.util.spec_from_file_location('local4427_physical',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def source_identity():
    env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'}
    head=subprocess.run(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT,env=env,check=True,capture_output=True,text=True,timeout=10).stdout.strip()
    if not re.fullmatch('[0-9a-f]{40}',head):raise RuntimeError('4427 local source commit invalid')
    hashes={}
    for relative in ('scripts/rls4427_native_restore_regression.py','scripts/rls4427_physical_cluster.py','supabase/tests/fixtures/rls4427_native_restore_fixture.sql'):
        expected=subprocess.run(['/usr/bin/git','show','HEAD:'+relative],cwd=ROOT,env=env,check=True,capture_output=True,timeout=10).stdout
        actual=(ROOT/relative).read_bytes()
        if expected!=actual:raise RuntimeError('4427 local executed source differs from committed bytes')
        hashes[relative]=hashlib.sha256(actual).hexdigest()
    return dict(source_sha=head,executed_source_sha256=hashes)


def image_config_records(stream):
    """Read cached Docker OCI export; no image code is executed or extracted on host."""
    manifests=[];configs={};layers={};layer_digests={};total=0
    class DigestReader:
        def __init__(self,raw):self.raw=raw;self.digest=hashlib.sha256()
        def read(self,size=-1):
            nonlocal total
            value=self.raw.read(size);total+=len(value)
            if total>8589934592:raise RuntimeError('4427 cached image export exceeds eight-GiB read bound')
            self.digest.update(value);return value
    with tarfile.open(fileobj=stream,mode='r|*') as outer:
        for part in outer:
            if not part.isfile() or not part.name.startswith('blobs/sha256/'):continue
            digest=part.name.rsplit('/',1)[-1]
            if re.fullmatch('[a-f0-9]{64}',digest) is None:raise RuntimeError('4427 image blob identity invalid')
            raw=outer.extractfile(part)
            if part.size<200000:
                data=raw.read()
                if hashlib.sha256(data).hexdigest()!=digest:raise RuntimeError('4427 cached image metadata blob changed')
                try:obj=json.loads(data)
                except(ValueError,UnicodeDecodeError):obj=None
                if isinstance(obj,dict) and 'layers' in obj and 'config' in obj:
                    manifests.append(obj);continue
                if 'sha256:'+digest==IMAGE_CONFIG:
                    configs[digest]=data;continue
                raw=io.BytesIO(data)
            reader=DigestReader(raw);records=[]
            try:
                with tarfile.open(fileobj=reader,mode='r|*') as layer:
                    for member in layer:
                        name=member.name.removeprefix('./').rstrip('/')
                        pure=PurePosixPath(name)
                        leaf=pure.name;parent=str(pure.parent)
                        removed=parent+'/'+leaf[4:] if leaf.startswith('.wh.') else None
                        relevant_whiteout=(removed is not None and any(removed==r or r.startswith(removed+'/') for r in CONFIG_ROOTS)) or (leaf=='.wh..wh..opq' and any(r.startswith(parent+'/') for r in CONFIG_ROOTS))
                        if not any(name==r or name.startswith(r+'/') for r in CONFIG_ROOTS) and not relevant_whiteout:continue
                        if name!=str(pure) or pure.is_absolute() or '..' in pure.parts or not(member.isfile() or member.isdir()):
                            raise RuntimeError('4427 baked config path/type refused')
                        if member.size>1048576:raise RuntimeError('4427 baked configuration member too large')
                        data=layer.extractfile(member).read() if member.isfile() else None
                        records.append((name,member.mode,member.uid,member.gid,data))
                        if len(records)>512 or sum(len(r[4] or b'') for r in records)>8388608:
                            raise RuntimeError('4427 baked config tree exceeds bounded fixture')
            except tarfile.ReadError:
                records=[]
            while reader.read(1048576):pass
            if reader.digest.hexdigest()!=digest:raise RuntimeError('4427 cached layer blob changed')
            layers[digest]=records;layer_digests[digest]=True
    found=[m for m in manifests if m.get('config',{}).get('digest')==IMAGE_CONFIG]
    if len(found)!=1 or IMAGE_CONFIG.split(':')[1] not in configs:raise RuntimeError('4427 cached image configuration binding missing')
    manifest=found[0];tree={}
    for layer in manifest['layers']:
        digest=layer['digest'].split(':')[-1]
        if digest not in layers or not layer_digests.get(digest):raise RuntimeError('4427 cached image ordered layer absent')
        for record in layers[digest]:
            name=record[0];leaf=PurePosixPath(name).name;parent=str(PurePosixPath(name).parent)
            if leaf=='.wh..wh..opq':
                tree={p:r for p,r in tree.items() if not p.startswith(parent+'/')}
            elif leaf.startswith('.wh.'):
                removed=parent+'/'+leaf[4:];tree={p:r for p,r in tree.items() if p!=removed and not p.startswith(removed+'/')}
            else:tree[name]=record
    required={'etc/postgresql/postgresql.conf','etc/postgresql/pg_hba.conf','etc/postgresql/pg_ident.conf'}
    if not required.issubset(tree) or 'etc/postgresql-custom/pgsodium_root.key' in tree:
        raise RuntimeError('4427 baked source closure missing or root key already materialized')
    if any(row[2:4]!=(100,101) for row in tree.values()):raise RuntimeError('4427 baked config owner differs from native postgres')
    return tree,configs[IMAGE_CONFIG.split(':')[1]],manifest


def write_config_tar(tree,output):
    with tarfile.open(fileobj=output,mode='w') as archive:
        for name,mode,uid,gid,data in sorted(tree.values()):
            member=tarfile.TarInfo(name);member.mode=mode;member.uid=uid;member.gid=gid;member.mtime=0
            if data is None:member.type=tarfile.DIRTYPE
            else:member.size=len(data)
            archive.addfile(member,io.BytesIO(data) if data is not None else None)


def validate_versions(tools,server):
    if server!=170006 or len(tools)!=3 or any(re.fullmatch(re.escape(tool)+r' \(PostgreSQL\) 17\.6(?: \([^\r\n]+\))?',version) is None for tool,version in zip(('psql','pg_basebackup','pg_ctl'),tools)):
        raise RuntimeError('4427 local physical calibration requires exact native PG17.6')
    return dict(server_version_num=server,tools=dict(zip(('psql','pg_basebackup','pg_ctl'),tools)))


class LocalSource:
    def __init__(self,helper):
        self.helper=helper;self.prefix=PREFIX;self.container_id=None;self.container_image=None;self.immutable_config_sha=None
        self.env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PGPASSWORD':'postgres'}
        self.started=time.monotonic();self.cleanup=False;self.events=[];self.restore_authority_qualified=False;self.keeper_running=True;self.keeper_status='running'
        self.phase='not-started';self.last_external_failure=None;self.bootstrap_launched=False

    def budget_check(self):
        if not self.cleanup and time.monotonic()-self.started>600:raise RuntimeError('4427 local ten-minute action bound exhausted')

    def docker(self,*args,input_file=None,output_file=None,allowed_failure=False):
        self.budget_check()
        result=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',self.source_docker_config,*args],env=self.env,
            **self.helper.process_input(input_file),stdout=output_file or subprocess.PIPE,stderr=subprocess.PIPE,timeout=20 if self.cleanup else 120)
        tool=args[0]
        if args[0]=='exec' and self.container_id in args:
            position=args.index(self.container_id);tool=args[position+1]
        event=dict(phase=self.phase,operation=args[0],tool=tool,exit_code=result.returncode);self.events.append(event)
        if result.returncode and not allowed_failure:
            self.last_external_failure=self.helper.capture_external(result.stderr,tool,result.returncode,self.phase)
            raise subprocess.CalledProcessError(result.returncode,[tool],stderr=result.stderr)
        return result

    def custody(self,allow_stopped=False):
        rows=json.loads(self.docker('inspect','--type','container',NAME).stdout)
        if len(rows)!=1:raise RuntimeError('4427 local source cardinality differs')
        row=rows[0];h=row['HostConfig'];n=row['NetworkSettings'];state=row['State']
        running=state.get('Running') is True
        stopped=allow_stopped and self.cleanup and state.get('Running') is False and state.get('Status') in ('created','exited','dead')
        if (row['Id']!=self.container_id or row['Image']!=self.image_id or row['Name']!='/'+NAME or row['Config'].get('Labels')!=self.expected_labels
            or row['Config'].get('User')!='100:101' or row['Config'].get('Entrypoint')!=['/bin/sleep'] or row['Config'].get('Cmd')!=['infinity']
            or not (running or stopped) or h.get('Privileged') is not False or h.get('ReadonlyRootfs') is not True
            or h.get('Memory')!=2147483648 or h.get('NanoCpus')!=1000000000 or h.get('PidsLimit')!=256
            or h.get('NetworkMode')!='none' or h.get('Binds') or h.get('PortBindings') or h.get('Devices') or h.get('CapAdd') or h.get('PidMode','')
            or h.get('Tmpfs',{})!=TMPFS or set(n.get('Networks',{}))!={'none'} or any(n.get('Ports',{}).values())
            or any(m.get('Type')!='tmpfs' or m.get('Destination') not in TMPFS for m in row.get('Mounts',[]))):
            raise RuntimeError('4427 local source custody/resource bounds differ')
        self.keeper_running=running;self.keeper_status=state.get('Status','running' if running else 'unknown')
        return self.container_id,self.image_id,IMAGE_TAG

    def execute(self,args,input_file=None,output_file=None,allowed_failure=False,detach=False):
        self.custody()
        return self.docker('exec',*(['--detach'] if detach else []),*(['-i'] if input_file is not None else []),'--user','100:101',self.container_id,*args,
                           input_file=input_file,output_file=output_file,allowed_failure=allowed_failure)

    def source_checked(self,args,input_file=None,output_file=None,allowed_failure=False):
        args=list(args);kind=self.helper.source_command_kind(args)
        if kind is None:raise RuntimeError('4427 local source transport refuses unlisted command')
        if kind=='archive':
            if not self.restore_authority_qualified or input_file is not None or output_file is None:
                raise RuntimeError('4427 local archive requires qualified authority/private output')
            if args==self.helper.BACKUP_ARGS and not getattr(self,'hba_temporary_verified',False):
                raise RuntimeError('4427 local backup route not positively loaded')
        elif kind=='hba-write':
            if not self.restore_authority_qualified or not getattr(self,'hba_window_active',False) or input_file is None or output_file is not None:
                raise RuntimeError('4427 local HBA write outside qualified permission window')
        elif kind=='hba-metadata':
            if not getattr(self,'hba_window_active',False) or input_file is not None or output_file is not None:
                raise RuntimeError('4427 local HBA metadata outside restoration window')
        elif input_file is not None or output_file is not None:
            raise RuntimeError('4427 local readonly source probe refuses stream input/output')
        if kind in ('hba-write','hba-metadata'):self.helper.validate_hba_payload(self,args,input_file)
        return self.execute(args,input_file=input_file,output_file=output_file,allowed_failure=allowed_failure)

    def container_exec(self,args,input_file=None,output_file=None):
        return self.source_checked(args,input_file=input_file,output_file=output_file).stdout

    def sql(self,database,query):
        if database!='postgres':raise RuntimeError('4427 local source refuses another database')
        result=self.execute(['psql','-XqAtw','-h','127.0.0.1','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],input_file=io.BytesIO(query.encode()),allowed_failure=True)
        if result.returncode:raise subprocess.CalledProcessError(result.returncode,['psql'],output=result.stdout.decode(),stderr=result.stderr.decode())
        return result.stdout.decode()

    def diagnostic(self,kind,**facts):
        self.events.append(dict(kind=kind,**facts))
        print(json.dumps(dict(kind=kind,**facts),sort_keys=True),file=sys.stderr)

    def qualify_physical_source(self):
        self.custody();self.restore_authority_qualified=False
        if self.immutable_config_sha!=IMAGE_CONFIG.removeprefix('sha256:'):raise RuntimeError('4427 local immutable configuration not qualified')
        context=json.loads(self.sql('postgres',CONTEXT_SQL));authority=json.loads(self.sql('postgres',AUTHORITY_SQL))
        expected={**context,'current_user':'supabase_admin','session_user':'supabase_admin','rolsuper':True,'rolcanlogin':True,'is_superuser':'on'}
        if authority!=expected or context['database']!='postgres' or context['server_version_num']!=170006 or re.fullmatch('[0-9]+',context.get('system_identifier','')) is None:
            raise RuntimeError('4427 local same-instance native administrator qualification differs')
        self.restore_authority=authority;self.restore_authority_qualified=True
        return dict(context=context,authority=authority,immutable_config_sha=self.immutable_config_sha)

    def open(self):
        if any(k.startswith('DOCKER_') and v for k,v in os.environ.items()):raise RuntimeError('4427 local Docker context override refused')
        sock=Path('/var/run/docker.sock');info=sock.stat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=0 or info.st_mode&0o007 or str(sock.resolve()) not in ('/run/docker.sock','/var/run/docker.sock'):
            raise RuntimeError('4427 local Docker endpoint refused')
        self.phase='image-export'
        self.temporary=tempfile.TemporaryDirectory(prefix='rls4427-local-physical-');self.root=Path(self.temporary.name);os.chmod(self.root,0o700)
        config=self.root/'docker-config';config.mkdir(mode=0o700);self.source_docker_config=str(config);self.docker_config=str(config)
        try:
            image=json.loads(self.docker('image','inspect',IMAGE).stdout)
            if len(image)!=1 or image[0]['Id']!=IMAGE:raise RuntimeError('4427 local cached manifest identity differs')
            self.image_id=IMAGE;self.expected_labels={**(image[0].get('Config',{}).get('Labels') or {}),**LABELS}
            # Stream the cached export once. Only bounded public configuration bytes
            # are retained; no key exists yet and no host filesystem extraction occurs.
            process=subprocess.Popen(['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',self.source_docker_config,'image','save',IMAGE],env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,stdin=subprocess.DEVNULL)
            timeout=threading.Timer(120,process.kill);timeout.start()
            try:
                tree,raw,manifest=image_config_records(process.stdout)
                code=process.wait(timeout=120)
                if code:
                    stderr=process.stderr.read();self.last_external_failure=self.helper.capture_external(stderr,'docker-image-save',code,self.phase)
                    raise subprocess.CalledProcessError(code,['docker-image-save'],stderr=stderr)
            except BaseException:
                if process.poll() is None:process.kill();process.wait(timeout=10)
                if self.last_external_failure is None:
                    stderr=process.stderr.read();self.last_external_failure=self.helper.capture_external(stderr,'docker-image-save',process.returncode,self.phase)
                raise
            finally:timeout.cancel();process.stdout.close();process.stderr.close()
            metadata=json.loads(raw)
            if metadata.get('rootfs',{}).get('diff_ids')!=image[0]['RootFS']['Layers']:raise RuntimeError('4427 local cached image rootfs/config binding differs')
            self.immutable_config_sha=IMAGE_CONFIG.removeprefix('sha256:')
            archive=self.root/'baked-config.tar'
            with os.fdopen(os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:write_config_tar(tree,output)
            if self.docker('ps','-aq','--filter','name=^/'+NAME+'$').stdout.strip():raise RuntimeError('4427 local source name occupied; no takeover')
            args=['run','--detach','--pull=never','--name',NAME,'--network','none','--read-only','--user','100:101','--memory','2g','--cpus','1','--pids-limit','256','--entrypoint','/bin/sleep']
            self.phase='source-create'
            for target,options in TMPFS.items():args+=['--tmpfs',target+':'+options]
            for k,v in LABELS.items():args+=['--label',k+'='+v]
            args+=['--env','POSTGRES_PASSWORD=postgres',IMAGE,'infinity']
            self.container_id=self.docker(*args).stdout.decode().strip()
            if re.fullmatch('[a-f0-9]{64}',self.container_id) is None:raise RuntimeError('4427 local source immutable ID invalid')
            self.custody();self.container_image=(self.image_id,IMAGE_TAG)
            self.diagnostic('owned-source-created',container_id=self.container_id,source_owner=OWNER,target_owner=self.helper.OWNER)
            self.phase='source-bootstrap'
            with archive.open('rb') as data:self.execute(['tar','-C','/','-xf','-','--no-same-owner'],input_file=data)
            self.execute(['test','!','-e',DATA+'/PG_VERSION']);self.execute(['test','!','-e','/etc/postgresql-custom/pgsodium_root.key'])
            self.execute(BOOTSTRAP_START,detach=True);self.bootstrap_launched=True
            try:self.execute(BOOTSTRAP_READY)
            except BaseException:
                log=self.execute(['head','-c','8388608',BOOTSTRAP_LOG],allowed_failure=True)
                self.bootstrap_diagnostic=self.helper.capture_external(log.stdout if log.returncode==0 else log.stderr,'bootstrap-log',log.returncode,self.phase)
                self.diagnostic('bootstrap-private-log',**self.bootstrap_diagnostic)
                raise
            self.diagnostic('owned-source-final-postmaster-ready',marker_required=True,normal_tcp_ready=True)
            self.phase='source-qualification'
            tools=[self.execute([tool,'--version']).stdout.decode().strip() for tool in ('psql','pg_basebackup','pg_ctl')]
            self.version_facts=validate_versions(tools,int(self.sql('postgres',"select current_setting('server_version_num');").strip()))
            self.qualify_physical_source()
            return self
        except BaseException:
            # Regression.run owns cleanup, so a cleanup exception cannot replace
            # the original preparation failure or its private diagnostics.
            raise

    def close(self):
        if self.container_id:
            self.cleanup=True
            self.custody(allow_stopped=True)
            try:
                if self.keeper_running:
                    result=self.execute(['pg_ctl','-D','/etc/postgresql','-w','-t','10','-m','smart','stop'],allowed_failure=True)
                    if result.returncode:
                        self.last_external_failure=self.helper.capture_external(result.stderr,'pg_ctl',result.returncode,self.phase)
                    absence=self.execute(['test','!','-e',DATA+'/postmaster.pid'],allowed_failure=True)
                    if result.returncode or absence.returncode:
                        if absence.returncode:self.last_external_failure=self.helper.capture_external(absence.stderr,'test',absence.returncode,self.phase)
                        raise RuntimeError('4427 local owned source graceful stop/absence failed')
                    self.diagnostic('owned-source-stopped',stop_exit_code=0,pid_absent=True,graceful_pg_stop=True)
                else:
                    self.diagnostic('owned-source-keeper-not-running',status=self.keeper_status,graceful_pg_stop=False)
            finally:
                try:
                    self.custody(allow_stopped=True)
                    if self.keeper_running:self.docker('stop','--time','10',self.container_id)
                    self.custody(allow_stopped=True)
                    self.docker('rm',self.container_id)
                    if self.docker('ps','-aq','--filter','name=^/'+NAME+'$').stdout.strip():raise RuntimeError('4427 local source removal absence failed')
                    self.diagnostic('owned-source-removed',container_id=self.container_id,absent=True);self.container_id=None
                finally:
                    if self.container_id is None:self.temporary.cleanup()
        elif hasattr(self,'temporary'):self.temporary.cleanup()


# All OID-independent fixture object metadata, including owners, ACLs and defaults.
METADATA = """select json_build_object(
'schemas',(select json_agg(json_build_array(nspname,pg_get_userbyid(nspowner),nspacl::text) order by nspname) from pg_namespace where nspname in ('rls4427_fixture')),
'relations',(select json_agg(json_build_array(n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('rls4427_fixture')),
'columns',(select json_agg(json_build_array(n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)) order by n.nspname,c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname in ('rls4427_fixture') and a.attnum>0 and not a.attisdropped),
'policies',(select json_agg(json_build_array(schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check) order by schemaname,tablename,policyname) from pg_policies where schemaname in ('rls4427_fixture')),
'defaults',(select json_agg(json_build_array(pg_get_userbyid(a.defaclrole),n.nspname,a.defaclobjtype,a.defaclacl::text) order by n.nspname,a.defaclobjtype) from pg_default_acl a join pg_namespace n on n.oid=a.defaclnamespace),
'constraints',(select json_agg(json_build_array(n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('rls4427_fixture')),
'indexes',(select json_agg(json_build_array(schemaname,indexname,indexdef) order by schemaname,indexname) from pg_indexes where schemaname in ('rls4427_fixture')),
'functions',(select json_agg(json_build_array(n.nspname,p.proname,pg_get_userbyid(p.proowner),p.proacl::text,pg_get_functiondef(p.oid)) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('rls4427_fixture')),
'triggers',(select json_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('rls4427_fixture') and not t.tgisinternal),
'sequences',(select json_agg(json_build_array(s.schemaname,s.sequencename,s.sequenceowner,s.data_type,s.start_value,s.min_value,s.max_value,s.increment_by,s.cycle,s.cache_size,s.last_value) order by s.schemaname,s.sequencename) from pg_sequences s where s.schemaname in ('rls4427_fixture')),
'sequence_ownership',(select json_agg(json_build_array(n.nspname,q.relname,t.relname,a.attname,d.deptype) order by n.nspname,q.relname) from pg_class q join pg_namespace n on n.oid=q.relnamespace join pg_depend d on d.classid='pg_class'::regclass and d.objid=q.oid and d.refclassid='pg_class'::regclass and d.deptype in ('a','i') join pg_class t on t.oid=d.refobjid join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid where q.relkind='S' and n.nspname in ('rls4427_fixture')),
'sequence_state',(select json_build_array(last_value,is_called) from rls4427_fixture.restore_fixture_id_seq),
'rows',(select json_agg(o order by id) from rls4427_fixture.objects o),
'public_rows',(select json_agg(o order by id) from rls4427_fixture.restore_fixture o),
'authority_rows',(select json_agg(o order by id) from rls4427_fixture.authority_fixture o))::text;"""



def digest_object(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def permission_outcomes(sql):
    """Actual role operations on invented rows only; no sequence mutation fiction."""
    cases=[('reader-select','rls4427_reader','', 'select count(*) from rls4427_fixture.objects;','2',None),
           ('reader-update-denied','rls4427_reader','',"update rls4427_fixture.objects set label='denied' where id=1;",None,'42501'),
           ('writer-update','rls4427_writer',"set local request.jwt.claim.role='fixture_writer';", "update rls4427_fixture.objects set label=' allowed ' where id=1 returning label;",'allowed',None),
           ('writer-rls-denied','rls4427_writer',"set local request.jwt.claim.role='fixture_reader';", "update rls4427_fixture.objects set label='denied' where id=1 returning id;",'',None),
           ('reader-sequence-denied','rls4427_reader','',"select nextval('rls4427_fixture.restore_fixture_id_seq');",None,'42501'),
           ('writer-sequence-read','rls4427_writer','',"select last_value from rls4427_fixture.restore_fixture_id_seq;",'1',None),
           ('default-acl-read','rls4427_reader','', 'select count(*) from rls4427_fixture.default_acl_probe;','0',None)]
    results=[]
    for name,role,setup,query,expected,error in cases:
        try:actual=sql(f'begin;set local role {role};{setup}{query}rollback;').strip()
        except subprocess.CalledProcessError as caught:
            stderr=caught.stderr.decode() if isinstance(caught.stderr,bytes) else caught.stderr or ''
            if error is None or re.search(r'(?<![A-Z0-9])'+re.escape(error)+r'(?![A-Z0-9])',stderr) is None:
                raise RuntimeError('4427 local permission operation failed outside expected SQLSTATE') from None
            results.append(dict(case=name,sqlstate=error,allowed=False));continue
        if error is not None or actual!=expected:raise RuntimeError('4427 local effective role outcome differs')
        results.append(dict(case=name,allowed=True,value=actual))
    return results


def plan_nodes(plan):
    yield plan
    for child in plan.get('Plans',[]):yield from plan_nodes(child)


def validate_pair_sample(variant,raw):
    if variant not in ('original','candidate'):raise RuntimeError('4427 local pair variant refused')
    if not isinstance(raw,list) or len(raw)!=1 or not isinstance(raw[0],dict) or not isinstance(raw[0].get('Plan'),dict):
        raise RuntimeError('4427 local EXPLAIN JSON shape differs')
    report=raw[0];plan=report['Plan']
    if plan.get('Node Type')!='ModifyTable' or plan.get('Operation')!='Update' or plan.get('Actual Rows')!=2 or plan.get('Actual Loops')!=1:
        raise RuntimeError('4427 local paired update affected rows/loops differ')
    timing=report.get('Execution Time')
    if isinstance(timing,bool) or not isinstance(timing,(int,float)) or timing<0:raise RuntimeError('4427 local execution timing missing')
    init=[n for n in plan_nodes(plan) if n.get('Parent Relationship')=='InitPlan']
    if variant=='candidate' and (not init or any(n.get('Actual Loops')!=1 for n in init)):
        raise RuntimeError('4427 local candidate request-constant InitPlan loops differ')
    return dict(variant=variant,affected_rows=2,execution_ms=timing,initplan_loops=[n.get('Actual Loops') for n in init],plan=raw)


def local_fixture_for_mode(mode):
    source=(ROOT/'supabase/tests/fixtures/rls4427_native_restore_fixture.sql').read_text()
    begin='-- 4427 PRESENT SQL crypto initialization BEGIN'
    end='-- 4427 PRESENT SQL crypto initialization END'
    if mode not in ('PRESENT','ABSENT') or source.count(begin)!=1 or source.count(end)!=1:
        raise RuntimeError('4427 fixed local SQL crypto fixture mode differs')
    if mode=='PRESENT':return source
    absent="""-- 4427 ABSENT SQL crypto source proof (no installation or removal).
DO $absent$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgsodium')
     OR to_regprocedure('pgsodium.crypto_secretbox_noncegen()') IS NOT NULL
     OR to_regprocedure('pgsodium.crypto_secretbox(bytea,bytea,bigint,bytea)') IS NOT NULL
     OR to_regprocedure('pgsodium.crypto_secretbox_open(bytea,bytea,bigint,bytea)') IS NOT NULL THEN
    RAISE EXCEPTION '4427 local source SQL crypto is not completely absent';
  END IF;
END $absent$;
"""
    return source[:source.index(begin)]+absent+source[source.index(end)+len(end):]


def case_cleanup_absence(case):
    source=any(e.get('kind')=='owned-source-removed' and e.get('absent') is True and isinstance(e.get('container_id'),str) and re.fullmatch('[a-f0-9]{64}',e['container_id']) for e in case.get('source_events',[]))
    target=any(e.get('absent') is True and isinstance(e.get('owned_container_removed'),str) and re.fullmatch('[a-f0-9]{64}',e['owned_container_removed']) for e in case.get('physical_events',[]))
    clean_source=any(e.get('kind')=='owned-source-stopped' and e.get('graceful_pg_stop') is True and e.get('pid_absent') is True for e in case.get('source_events',[]))
    starts={e.get('restart') for e in case.get('physical_events',[]) if e.get('owned_server_started') is True}
    stops={e.get('restart') for e in case.get('physical_events',[]) if e.get('owned_server_stopped') is True and e.get('clean_shutdown') is True and e.get('pid_absent') is True and e.get('minute_window_qualified') is True}
    return case.get('cleanup_passed') is True and source and target and clean_source and starts==stops=={1,2,3}


def calibrate_pair(cluster,helper):
    """Two starts of one stopped sealed physical baseline; one sample per variant."""
    baseline_metadata=json.loads(cluster.sql(METADATA,'supabase_admin'))
    baseline_native=json.loads(cluster.sql(NATIVE_SQL,'supabase_admin'))
    cluster.check_crypto_canary('local-before-seal')
    sealed=cluster.seal();records=[];same_bytes=None;same_permissions=None
    for variant,expression in [('original',ORIGINAL_POLICY),('candidate',CANDIDATE_POLICY)]:
        trial=cluster.begin_trial()
        try:
            if json.loads(cluster.sql(METADATA,'supabase_admin'))!=baseline_metadata or json.loads(cluster.sql(NATIVE_SQL,'supabase_admin'))!=baseline_native:
                raise RuntimeError('4427 local physical restart lost native/fixture metadata')
            crypto_status=cluster.check_crypto_canary('local-after-reset')
            before=json.loads(cluster.sql(FINGERPRINT_SQL,'supabase_admin'))
            if same_bytes is not None and before!=same_bytes:raise RuntimeError('4427 local paired physical starting bytes differ')
            same_bytes=before
            # An owned fixture policy only; native grants/helpers/RLS remain unchanged.
            cluster.sql(f'alter policy fixture_write on rls4427_fixture.objects using ({expression}) with check ({expression});','supabase_admin')
            raw=json.loads(cluster.sql(PAIR_SQL,'supabase_admin'));sample=validate_pair_sample(variant,raw)
            # Role DML follows timing and runs under this variant's installed policy.
            permissions=permission_outcomes(lambda query:cluster.sql(query,'supabase_admin'))
            if same_permissions is not None and permissions!=same_permissions:raise RuntimeError('4427 local paired role outcomes differ')
            same_permissions=permissions
            logical_after=json.loads(cluster.sql(METADATA,'supabase_admin'))
            policy_before=baseline_metadata['policies'];policy_after=logical_after['policies']
            expected_changed=[p for p in policy_after if p[2]=='fixture_write']
            original_changed=[p for p in policy_before if p[2]=='fixture_write']
            if len(expected_changed)!=1 or len(original_changed)!=1 or expected_changed[0][:6]!=original_changed[0][:6] or {k:v for k,v in logical_after.items()if k!='policies'}!={k:v for k,v in baseline_metadata.items()if k!='policies'}:
                raise RuntimeError('4427 local pair changed non-policy metadata/data')
            if [p for p in policy_before if p[2]!='fixture_write']!=[p for p in policy_after if p[2]!='fixture_write']:
                raise RuntimeError('4427 local pair changed overlapping policy')
            records.append(dict(**sample,baseline_sha256=trial['baseline_sha256'],before_sha256=digest_object(before),permissions=permissions,
                                root_key_canary=True if cluster.crypto_mode=='PRESENT' else None,sql_crypto_canary=crypto_status,physical_after_not_claimed_restored=True))
        finally:cluster.end_trial()
    if any(r['baseline_sha256']!=sealed['sha256'] for r in records):raise RuntimeError('4427 local pair baseline receipt differs')
    return dict(sealed_baseline=sealed,samples=records,metadata_sha256=digest_object(baseline_metadata),native_capability_sha256=digest_object(baseline_native),
                physical_start_equal=True,permissions_equal=True,root_key_decrypt_two_restarts=True if cluster.crypto_mode=='PRESENT' else None,sql_crypto_capability=cluster.crypto_receipt())


class LocalCalibrationFailure(RuntimeError):
    def __init__(self,receipt):
        super().__init__('4427 local physical calibration failed; private diagnostics preserved')
        self.receipt=receipt


class Regression:
    def __init__(self):self.source=None;self.cluster=None;self.phase='source-binding'

    def failure(self,helper,error,phase,events,source=None):
        receipt=helper.failure_receipt(error,phase,events)
        if source is not None and source.last_external_failure is not None:receipt['last_external']=dict(source.last_external_failure)
        physical=getattr(error,'physical_external',None) or getattr(self.cluster,'last_external_failure',None)
        if physical is not None:receipt['physical_external']=dict(physical)
        return receipt

    def run_case(self,helper,source,mode,started):
        local=None;primary=None;cleanup=[];result=None;self.source=None;self.cluster=None;case_started=time.monotonic()
        try:
            local=LocalSource(helper);local.started=started;local.expected_sql_crypto_mode=mode;self.source=local
            self.phase='source-open';local.open()
            self.phase='source-file-privileges';local.phase=self.phase
            postgres_file_privileges=json.loads(local.sql('postgres',FILE_FUNCTION_PRIVILEGES_SQL))
            if set(postgres_file_privileges)!={'postgres_superuser','pg_read_server_files_member','pg_read_binary_file_execute','pg_stat_file_execute'} or any(type(value)is not bool for value in postgres_file_privileges.values()):raise RuntimeError('4427 local file privilege observation is not exact booleans')
            self.phase='source-fixture';local.phase=self.phase
            local.sql('postgres',local_fixture_for_mode(mode))
            original_metadata=json.loads(local.sql('postgres',METADATA));original_native=json.loads(local.sql('postgres',NATIVE_SQL))
            self.phase='physical-open';local.phase=self.phase
            self.cluster=helper.PhysicalCluster(local,budget_seconds=max(1,600-(time.monotonic()-started)))
            cluster=self.cluster.open()
            if cluster.crypto_mode!=mode:raise RuntimeError('4427 local actual source SQL crypto mode differs from fixed case')
            if json.loads(cluster.sql(METADATA,'supabase_admin'))!=original_metadata or json.loads(cluster.sql(NATIVE_SQL,'supabase_admin'))!=original_native:
                raise RuntimeError('4427 local full physical source/target metadata differs')
            self.phase='calibration';local.phase=self.phase
            pair=calibrate_pair(cluster,helper)
            elapsed=time.monotonic()-started
            if elapsed>600:raise RuntimeError('4427 local ten-minute calibrated action exceeded')
            result=dict(**source,qualification='REAL_NATIVE_PG17_6_FULL_PHYSICAL_FOCUSED_PAIR_ONLY',production_acceptance='NOT_EVALUATED',native374_acceptance='NOT_EVALUATED',
                        historical_logical_restore_failures='PRESERVED_NOT_RECLASSIFIED',postgres_file_privileges=postgres_file_privileges,version_facts=local.version_facts,pair=pair,action_elapsed_seconds=elapsed,
                        source_owner=OWNER,target_owner=helper.OWNER,sql_crypto_capability_mode=mode,sql_crypto_capability=cluster.crypto_receipt())
        except Exception as error:
            phase=local.phase if self.phase=='source-open' and local is not None else self.phase
            primary=self.failure(helper,error,phase,local.events if local is not None else [],local)
        finally:
            self.phase='cleanup-physical'
            if self.cluster is not None:
                try:self.cluster.close()
                except Exception as error:cleanup.append(self.failure(helper,error,self.phase,getattr(self.cluster,'events',[])))
            self.phase='cleanup-source'
            if local is not None:
                local.phase=self.phase
                try:local.close()
                except Exception as error:cleanup.append(self.failure(helper,error,self.phase,local.events,local))
        events=dict(source=local.events if local is not None else [],physical=getattr(self.cluster,'events',[]))
        if primary is not None or cleanup:
            raise LocalCalibrationFailure(dict(qualification_passed=False,primary_failure=primary,cleanup_failures=cleanup,events=events))
        result.update(source_events=events['source'],physical_events=events['physical'],cleanup_passed=True,case_elapsed_seconds=time.monotonic()-case_started)
        return result

    def run(self):
        started=time.monotonic();helper=load_helper();source=source_identity();cases=[]
        for mode in ('PRESENT','ABSENT'):
            if time.monotonic()-started>=600:
                raise LocalCalibrationFailure(dict(qualification_passed=False,phase='between-fixed-cases',completed_cases=cases,invariant='4427 shared local ten-minute bound exhausted'))
            try:case=self.run_case(helper,source,mode,started)
            except LocalCalibrationFailure as error:
                error.receipt.update(case_mode=mode,completed_cases=cases,elapsed_seconds=time.monotonic()-started)
                raise
            cases.append(case)
            if not case_cleanup_absence(case) or time.monotonic()-started>600:
                raise LocalCalibrationFailure(dict(qualification_passed=False,phase='between-fixed-cases',completed_cases=cases,invariant='4427 prior fixed case cleanup/absence or shared budget not qualified'))
        return dict(**source,qualification='REAL_NATIVE_PG17_6_BOTH_SQL_CRYPTO_STATES',cases=cases,elapsed_seconds=time.monotonic()-started,
            cleanup_passed=True,native374_acceptance='NOT_EVALUATED',production_acceptance='NOT_EVALUATED')


if __name__=='__main__':
    try:print(json.dumps(Regression().run(),sort_keys=True))
    except LocalCalibrationFailure as error:
        print(json.dumps(error.receipt,sort_keys=True),file=sys.stderr);sys.exit(1)
    except Exception as error:
        # Helper/source-loading errors happen before any resource exists.
        reason=str(error) if isinstance(error,RuntimeError) and str(error).startswith('4427 ') else '4427 source/helper loading failed'
        print(json.dumps(dict(qualification_passed=False,phase='source-binding',error_type=type(error).__name__,invariant=reason)),file=sys.stderr);sys.exit(1)
