#!/usr/bin/env python3
"""Issue4890 only: physical copy of synthetic native cluster, never a shared target.
Import is offline. Resource execution requires a separate exact action approval.
"""
import datetime
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

DATA='/var/lib/postgresql/data'
CONFIG_ROOTS=('etc/postgresql','etc/postgresql-custom')
TMPFS={DATA:'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=4294967296',
       '/etc/postgresql':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=33554432',
       '/etc/postgresql-custom':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=33554432',
       '/var/run/postgresql':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=16777216',
       '/var/log/postgresql':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=33554432',
       '/tmp':'rw,nosuid,nodev,uid=100,gid=101,mode=0700,size=134217728'}
OWNER='01a1834a-813e-7b12-b17a-3e8c3aaedfb8'
IMMUTABLE_CONFIG_SHA='e1939b94b1fd12b8a446404ff49455d7cf2a6a275a77f010abb56a247bfd5377'
CRON_BINARY_SHA='55a7bdcf1b966d51d83d248797507348de19d16f1c968948c1854bc799751108'
BACKUP_ARGS=['pg_basebackup','-h','/var/run/postgresql','-p','5432','-U','supabase_admin','-D','-','-Ft','-X','fetch','-c','fast','--manifest-checksums=SHA256','--no-password']
CONFIG_RESTORE_ARGS=['tar','-C','/','-xf','-','--numeric-owner']
DATA_RESTORE_ARGS=['sh','-c','umask 000; exec tar -C /var/lib/postgresql/data -xf - --no-same-owner --numeric-owner']
CONFIG_ARGS=['tar','--numeric-owner','-C','/','-cf','-','etc/postgresql','etc/postgresql-custom']
BINARY_ARGS=['sha256sum','/nix/store/qpz7hxz26yk04v1f0cxfhgicy360zf9n-pg_cron-1.6.4/lib/pg_cron-1.6.4.so']
HBA_PATH='/etc/postgresql/pg_hba.conf'
HBA_READ_ARGS=['cat',HBA_PATH]
HBA_STAT_ARGS=['stat','-c','%F:%u:%g:%a:%h',HBA_PATH]
HBA_APPEND_ARGS=['sh','-c','cat >> /etc/postgresql/pg_hba.conf']
HBA_RESTORE_ARGS=['sh','-c','cat > /etc/postgresql/pg_hba.conf']
HBA_LINE=b'\nlocal replication supabase_admin trust\n'
REPL_PROBE_ARGS=['psql','-XqAtw','host=/var/run/postgresql port=5432 user=supabase_admin dbname=replication replication=true','-c','IDENTIFY_SYSTEM;']
RELOAD_ARGS=['psql','-XqAtw','-h','/var/run/postgresql','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c','select pg_reload_conf();']
SOURCE_HEALTH_SQL="""select json_build_object('recovery',pg_is_in_recovery(),'superuser',(select rolsuper from pg_roles where rolname=current_user),
'roles',(select md5(string_agg(row_to_json(r)::text,E'\n' order by rolname)) from pg_roles r),
'members',(select md5(coalesce(string_agg(row_to_json(m)::text,E'\n' order by roleid,member,grantor),'')) from pg_auth_members m),
'policies',(select md5(coalesce(string_agg(row_to_json(p)::text,E'\n' order by schemaname,tablename,policyname),'')) from pg_policies p),
'objects',(select md5(string_agg(concat_ws(':',c.oid,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity),E'\n' order by c.oid)) from pg_class c),
'functions',(select md5(string_agg(concat_ws(':',p.oid,p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proconfig::text,p.prosrc,p.probin),E'\n' order by p.oid)) from pg_proc p),
'slots',(select count(*) from pg_replication_slots),'walsenders',(select count(*) from pg_stat_replication))::text;"""


UNIX_HEALTH_ARGS=['psql','-XqAtw','-h','/var/run/postgresql','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',SOURCE_HEALTH_SQL]


def process_input(stream):
    """BytesIO has no OS descriptor; archives keep their real streaming descriptor."""
    if stream is None:return {'stdin':subprocess.DEVNULL}
    if isinstance(stream,io.BytesIO):return {'input':stream.read()}
    try:descriptor=stream.fileno()
    except (AttributeError,io.UnsupportedOperation,OSError,ValueError):
        raise RuntimeError('4427 unsupported subprocess input stream') from None
    if not isinstance(descriptor,int) or descriptor<0:raise RuntimeError('4427 invalid subprocess input descriptor')
    return {'stdin':stream}


def capture_external(stderr,tool,code,phase,stdout=None):
    """Raw external diagnostics stay0600 outside cleanup's config/PGDATA trees."""
    raw=stderr if isinstance(stderr,bytes) else (stderr or '').encode(errors='replace')
    fd,path=tempfile.mkstemp(prefix='rls4427-private-external-',suffix='.stderr')
    with os.fdopen(fd,'wb') as out:out.write(raw)
    found=re.search(rb'(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?::|\s|$)',raw)
    receipt=dict(phase=phase,tool=tool,exit_code=code,sqlstate=found[1].decode() if found else None,
                private_stderr_path=path,private_stderr_sha256=hashlib.sha256(raw).hexdigest())
    if stdout is not None:
        output=stdout if isinstance(stdout,bytes) else stdout.encode(errors='replace')
        fd,output_path=tempfile.mkstemp(prefix='rls4427-private-external-',suffix='.stdout')
        with os.fdopen(fd,'wb') as out:out.write(output[:65536])
        receipt.update(private_stdout_path=output_path,private_stdout_sha256=hashlib.sha256(output).hexdigest(),
                       stdout_bytes=len(output),stdout_retained_bytes=min(len(output),65536))
    return receipt


def failure_receipt(error,phase,events):
    reason=str(error) if isinstance(error,RuntimeError) and str(error).startswith('4427 ') else '4427 external or unclassified failure'
    result=dict(qualification_passed=False,error_type=type(error).__name__,phase=phase,invariant=reason,events=list(events))
    if getattr(error,'source_diagnostic',None):result['source_diagnostic']=error.source_diagnostic
    if getattr(error,'archive_diagnostic',None):result['archive_validation']=error.archive_diagnostic
    if getattr(error,'physical_external',None):result['physical_external']=dict(error.physical_external)
    if isinstance(error,subprocess.CalledProcessError):
        tool=Path(error.cmd[0]).name if isinstance(error.cmd,list) and error.cmd else 'external'
        result['external']=capture_external(error.stderr,tool,error.returncode,phase,error.output)
    return result


def emit(events,value):
    events.append(value);print(json.dumps(value,sort_keys=True),file=sys.stderr)


def source_command_kind(args):
    if args in (BACKUP_ARGS,CONFIG_ARGS):return 'archive'
    if args in (HBA_APPEND_ARGS,HBA_RESTORE_ARGS):return 'hba-write'
    if (len(args)==3 and args[0]=='chown' and args[1] in ('0:0','100:101') and args[2]==HBA_PATH) or (len(args)==3 and args[0]=='chmod' and args[1] in ('600','640','644','755') and args[2]==HBA_PATH):return 'hba-metadata'
    if args in (BINARY_ARGS,HBA_READ_ARGS,HBA_STAT_ARGS,REPL_PROBE_ARGS,RELOAD_ARGS,UNIX_HEALTH_ARGS):return 'read'
    if args in ([tool,'--version'] for tool in ('pg_basebackup','pg_verifybackup')):return 'read'
    fixed=['psql','-XqAtw','-h','127.0.0.1','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c']
    if args[:-1]==fixed and args[-1] in (SOURCE_FACTS_SQL,CRON_SQL,SOURCE_HEALTH_SQL):return 'read'
    return None


def validate_hba_payload(source,args,stream):
    if args in (HBA_APPEND_ARGS,HBA_RESTORE_ARGS):
        expected=HBA_LINE if args==HBA_APPEND_ARGS else getattr(source,'hba_original_bytes',None)
        if expected is None or stream is None or not stream.seekable():raise RuntimeError('4427 exact HBA payload identity absent')
        position=stream.tell();actual=stream.read();stream.seek(position)
        if actual!=expected:raise RuntimeError('4427 exact HBA payload differs')
    elif args and args[0] in ('chmod','chown'):
        expected=getattr(source,'hba_saved_mode' if args[0]=='chmod' else 'hba_saved_owner',None)
        if args[1]!=expected:raise RuntimeError('4427 exact original HBA metadata differs')


def validate_missing_unix_hba(raw):
    import shlex
    trusted=False
    for line in raw.decode('utf-8').splitlines():
        fields=shlex.split(line,comments=True,posix=False)
        if not fields:continue
        if any(any(char in token for char in (chr(34),chr(39),chr(92))) for token in fields):raise RuntimeError('4427 unsupported quoted or escaped HBA token')
        if fields[0] not in ('local','host','hostssl','hostnossl') or len(fields)<(4 if fields[0]=='local' else 5):
            raise RuntimeError('4427 unsupported source HBA syntax; no permission override')
        if any('@' in f or f.startswith('+') or f.startswith('/') for f in fields[1:3]):
            raise RuntimeError('4427 unsupported source HBA indirection')
        if fields[0]!='local':continue
        databases=fields[1].split(',');users=fields[2].split(',')
        applicable=bool({'all','supabase_admin'}&set(users))
        if 'replication' in databases and applicable:
            raise RuntimeError('4427 existing Unix replication rule/deny must not be overridden')
        if applicable and bool({'all','postgres'}&set(databases)) and not trusted:
            if fields[3]!='trust':raise RuntimeError('4427 existing admin SQL route is not already trusted')
            trusted=True
    if not trusted:raise RuntimeError('4427 trusted existing local admin SQL route missing')


class TemporaryUnixHba:
    """Exact permission window on the qualified synthetic source, restored before target."""
    def __init__(self,source,private_root):self.source=source;self.root=private_root;self.events=[];self.changed=False

    def call(self,args,input_bytes=None,allowed_failure=False):
        import io
        return self.source.source_checked(args,input_file=io.BytesIO(input_bytes) if input_bytes is not None else None,allowed_failure=allowed_failure)

    def probe(self):
        result=self.call(REPL_PROBE_ARGS,allowed_failure=True)
        if result.returncode==0:
            if re.fullmatch(rb'[0-9]+\|[0-9]+\|[0-9A-F]+/[0-9A-F]+\|\s*',result.stdout) is None:
                raise RuntimeError('4427 physical IDENTIFY_SYSTEM response invalid')
            expected=getattr(self.source,'restore_authority',{}).get('system_identifier')
            if result.stdout.split(b'|')[0].decode()!=expected:raise RuntimeError('4427 physical replication identity differs')
            state='ALLOWED'
        elif result.returncode==2 and all(x in result.stderr for x in (b'no pg_hba.conf entry for replication connection',b'[local]',b'supabase_admin')):state='HBA_ABSENT'
        else:
            self.source.last_external_failure=capture_external(result.stderr,'psql',result.returncode,'source-physical-identify')
            raise RuntimeError('4427 physical replication probe refused outside HBA absence')
        emit(self.events,{'physical_identify_state':state,'exit_code':result.returncode})
        return state

    def loaded(self,expected):
        deadline=time.monotonic()+3
        while True:
            state=self.probe()
            if state==expected:return
            if time.monotonic()>=deadline:raise RuntimeError('4427 loaded Unix HBA state did not converge within three seconds')
            time.sleep(.2)

    def health(self):
        facts=json.loads(self.call(UNIX_HEALTH_ARGS).stdout)
        if facts.get('recovery') is not False or facts.get('superuser') is not True or facts.get('slots')!=0 or facts.get('walsenders')!=0:raise RuntimeError('4427 source normal SQL/capability health refused')
        return facts

    def __enter__(self):
        self.original=self.call(HBA_READ_ARGS).stdout
        validate_missing_unix_hba(self.original)
        self.metadata=self.call(HBA_STAT_ARGS).stdout.decode().strip().split(':')
        if len(self.metadata)!=5 or self.metadata[0]!='regular file' or ':'.join(self.metadata[1:3]) not in ('0:0','100:101') or self.metadata[3] not in ('600','640','644','755') or self.metadata[4]!='1':
            raise RuntimeError('4427 original HBA owner/mode/type unsupported')
        with os.fdopen(os.open(self.root/'source-original-hba',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as out:out.write(self.original)
        with tarfile.open(self.root/'source-config.tar','r:') as archive:
            if archive.extractfile('etc/postgresql/pg_hba.conf').read()!=self.original:raise RuntimeError('4427 original config/HBA capture raced')
        self.before_health=self.health()
        if self.probe()!='HBA_ABSENT':raise RuntimeError('4427 source permission window requires actual missing route')
        if not hasattr(self.source,'source_backup_window'):raise RuntimeError('4427 source backup minute admission absent')
        minute_guard(*self.source.source_backup_window,time.time(),time.monotonic())
        self.source.hba_original_bytes=self.original
        self.source.hba_saved_owner=':'.join(self.metadata[1:3]);self.source.hba_saved_mode=self.metadata[3]
        self.source.hba_window_active=True;self.changed=True
        try:
            self.call(HBA_APPEND_ARGS,HBA_LINE)
            if self.call(HBA_READ_ARGS).stdout!=self.original+HBA_LINE:raise RuntimeError('4427 source HBA append differs')
            if self.call(RELOAD_ARGS).stdout.strip()!=b't':raise RuntimeError('4427 source HBA reload signal refused')
            self.loaded('ALLOWED');self.source.hba_temporary_verified=True
            return self
        except Exception:
            self.restore();raise

    def restore(self):
        if not self.changed:return
        try:
            self.call(HBA_RESTORE_ARGS,self.original)
            self.call(['chown',':'.join(self.metadata[1:3]),HBA_PATH]);self.call(['chmod',self.metadata[3],HBA_PATH])
            if self.call(HBA_READ_ARGS).stdout!=self.original or self.call(HBA_STAT_ARGS).stdout.decode().strip().split(':')!=self.metadata:
                raise RuntimeError('4427 exact original source HBA bytes/metadata restoration failed')
            if self.call(RELOAD_ARGS).stdout.strip()!=b't':raise RuntimeError('4427 restored source HBA reload signal refused')
            self.loaded('HBA_ABSENT')
            if self.health()!=self.before_health:raise RuntimeError('4427 source capability/catalog changed during backup')
            emit(self.events,{'original_hba_restored':True,'bytes_owner_mode_equal':True,'fresh_physical_denied':True})
            self.changed=False
        except Exception:
            self.source.hba_restore_failed=True
            raise
        finally:self.source.hba_window_active=False;self.source.hba_temporary_verified=False

    def __exit__(self,*unused):self.restore()

CRON_SQL="""select json_build_object(
'jobs',(select count(*) from cron.job),
'job_hash',(select md5(coalesce(string_agg(row_to_json(j)::text,E'\n' order by jobid),'')) from cron.job j),
'schedules',(select coalesce(json_agg(schedule order by jobid),'[]') from cron.job where active),
'runs',(select count(*) from cron.job_run_details),
'run_hash',(select md5(coalesce(string_agg(row_to_json(r)::text,E'\n' order by runid),'')) from cron.job_run_details r),
'pending',(select count(*) from cron.job_run_details where status in ('starting','running')),
'workers',(select count(*) from pg_stat_activity where backend_type='pg_cron worker' or application_name='pg_cron'),
'schedulers',(select coalesce(json_agg(json_build_array(pid,backend_start::text) order by pid),'[]') from pg_stat_activity where application_name='pg_cron scheduler'))::text;"""
SOURCE_FACTS_SQL="""begin read only;
do $g$ declare r record; present boolean; begin
for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relpersistence='u' and c.relkind in ('r','m') loop
 execute format('select exists(select 1 from %I.%I limit 1)',r.nspname,r.relname) into present;
 if present then raise exception '4427 physical backup refuses nonempty unlogged relation'; end if;
end loop; end $g$;
select json_build_object('database',current_database(),'current_user',current_user,'session_user',session_user,
'superuser',(select rolsuper from pg_roles where rolname=current_user),'replication',(select rolreplication from pg_roles where rolname=current_user),
'recovery',pg_is_in_recovery(),'wal_level',current_setting('wal_level'),'max_wal_senders',current_setting('max_wal_senders')::int,
'external_tablespaces',(select count(*) from pg_tablespace where spcname not in ('pg_default','pg_global')),
'subscriptions',(select count(*) from pg_subscription),'slots',(select count(*) from pg_replication_slots),'prepared_transactions',(select count(*) from pg_prepared_xacts),
'cron_version',(select extversion from pg_extension where extname='pg_cron'),
'sodium_version',(select extversion from pg_extension where extname='pgsodium'),
'sodium_nonce_api',to_regprocedure('pgsodium.crypto_secretbox_noncegen()') is not null,
'sodium_keyid_api',to_regprocedure('pgsodium.crypto_secretbox(bytea,bytea,bigint,bytea)') is not null,
'sodium_open_keyid_api',to_regprocedure('pgsodium.crypto_secretbox_open(bytea,bytea,bigint,bytea)') is not null,
'config_file',current_setting('config_file'),'hba_file',current_setting('hba_file'),'ident_file',current_setting('ident_file'),
'data_directory',current_setting('data_directory'),'data_directory_mode',current_setting('data_directory_mode'),'archive_mode',current_setting('archive_mode'),'archive_command',current_setting('archive_command'),
'restore_command',current_setting('restore_command'),'primary_conninfo',current_setting('primary_conninfo'),
'ssl',current_setting('ssl'),'log_directory',current_setting('log_directory'),'socket',current_setting('unix_socket_directories'),
'cron_database',current_setting('cron.database_name'),'preload',current_setting('shared_preload_libraries'),
'hba_errors',(select count(*) from pg_hba_file_rules where error is not null),
'replication_hba',(select count(*) from pg_hba_file_rules where type='host' and 'replication'=any(database) and ('all'=any(user_name) or 'supabase_admin'=any(user_name)) and address in ('127.0.0.1','127.0.0.1/32') and auth_method in ('trust','scram-sha-256','md5')),
'other_backends',(select count(*) from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid() and state='active'))::text;
rollback;"""
CANARY_CREATE_SQL="""create schema if not exists rls4427_physical;
create table rls4427_physical.canary as with n as (select pgsodium.crypto_secretbox_noncegen() nonce)
select nonce,pgsodium.crypto_secretbox(convert_to('4427-physical-root-canary','UTF8'),nonce,4427::bigint,convert_to('4427snap','UTF8')) cipher from n;"""
CANARY_CHECK_SQL="select count(*)=1 and bool_and(pgsodium.crypto_secretbox_open(cipher,nonce,4427::bigint,convert_to('4427snap','UTF8'))=convert_to('4427-physical-root-canary','UTF8')) from rls4427_physical.canary;"


SQL_CRYPTO_FIELDS=('sodium_version','sodium_nonce_api','sodium_keyid_api','sodium_open_keyid_api')
SQL_CRYPTO_CAPABILITY_SQL="""select json_build_object(
'sodium_version',(select extversion from pg_extension where extname='pgsodium'),
'sodium_nonce_api',to_regprocedure('pgsodium.crypto_secretbox_noncegen()') is not null,
'sodium_keyid_api',to_regprocedure('pgsodium.crypto_secretbox(bytea,bytea,bigint,bytea)') is not null,
'sodium_open_keyid_api',to_regprocedure('pgsodium.crypto_secretbox_open(bytea,bytea,bigint,bytea)') is not null)::text;"""


def source_sql_crypto_mode(f):
    if not all(key in f for key in SQL_CRYPTO_FIELDS):return None
    if f['sodium_version']=='3.1.8' and all(f[key] is True for key in SQL_CRYPTO_FIELDS[1:]):return 'PRESENT'
    if f['sodium_version'] is None and all(f[key] is False for key in SQL_CRYPTO_FIELDS[1:]):return 'ABSENT'
    return None


def source_fact_diagnostic(f):
    """Fixed predicate names and closed metadata only; never retain the raw facts."""
    checks=[
        ('database',lambda:f.get('database')=='postgres'),
        ('current_user',lambda:f.get('current_user')=='supabase_admin'),
        ('session_user',lambda:f.get('session_user')=='supabase_admin'),
        ('superuser',lambda:f.get('superuser') is True),
        ('recovery',lambda:f.get('recovery') is False),
        ('wal_level',lambda:f.get('wal_level') in ('replica','logical')),
        ('max_wal_senders',lambda:f.get('max_wal_senders',0)>=1),
    ]
    checks += [(key,lambda key=key:f.get(key)==0) for key in ('external_tablespaces','subscriptions','slots','prepared_transactions','hba_errors','other_backends')]
    checks += [
        ('replication_hba_type',lambda:isinstance(f.get('replication_hba'),int)),
        ('cron_version',lambda:f.get('cron_version') in ('1.6','1.6.4')),
        ('cron_database',lambda:f.get('cron_database')=='postgres'),
        ('sodium_version',lambda:'sodium_version' in f and f['sodium_version'] in ('3.1.8',None)),
    ]
    checks += [(key,lambda key=key:(f.get('sodium_version')=='3.1.8' and f.get(key) is True) or ('sodium_version' in f and f['sodium_version'] is None and f.get(key) is False)) for key in SQL_CRYPTO_FIELDS[1:]]
    checks += [(key,lambda key=key,expected=expected:f.get(key)==expected) for key,expected in (
        ('config_file','/etc/postgresql/postgresql.conf'),('hba_file','/etc/postgresql/pg_hba.conf'),
        ('ident_file','/etc/postgresql/pg_ident.conf'),('data_directory',DATA))]
    checks += [
        ('data_directory_mode',lambda:f.get('data_directory_mode') in ('0700','0750')),
        ('archive_mode',lambda:f.get('archive_mode')=='off'),
        ('archive_command',lambda:f.get('archive_command') in ('','(disabled)')),
        ('restore_command',lambda:not f.get('restore_command')),
        ('primary_conninfo',lambda:not f.get('primary_conninfo')),
        ('ssl',lambda:f.get('ssl')=='off'),
        ('log_directory',lambda:f.get('log_directory') in ('log','/var/log/postgresql')),
        ('socket',lambda:f.get('socket')=='/var/run/postgresql'),
    ]
    checks += [('preload_'+library,lambda library=library:library in [item.strip() for item in f.get('preload','').split(',')]) for library in ('pg_cron','pgsodium')]
    failed=[]
    for name,check in checks:
        try:passed=bool(check())
        except (TypeError,AttributeError,ValueError):passed=False
        if not passed:failed.append(name)
    known_paths={'/tmp':'tmp','/var/run/postgresql':'var_run_postgresql','/run/postgresql':'run_postgresql',
        '/etc/postgresql':'etc_postgresql','/etc/postgresql/postgresql.conf':'etc_postgresql_conf',
        '/etc/postgresql/pg_hba.conf':'etc_postgresql_hba','/etc/postgresql/pg_ident.conf':'etc_postgresql_ident',
        '/var/lib/postgresql/data':'pgdata','log':'relative_log','/var/log/postgresql':'var_log_postgresql',
        '/var/lib/postgresql/data/log':'pgdata_log'}
    path_fields=('config_file','hba_file','ident_file','data_directory','log_directory','socket')
    enums={key:('postgres','supabase_admin') for key in ('database','current_user','session_user','cron_database')}
    enums.update(wal_level=('minimal','replica','logical'),cron_version=('1.6','1.6.4'),sodium_version=('3.1.8',),
        data_directory_mode=('0700','0750'),archive_mode=('off','on','always'),ssl=('off','on'))
    fields=list(dict.fromkeys([name.removesuffix('_type') for name,_ in checks if not name.startswith('preload_')]+['replication','preload']))
    scalar_fields=('superuser','recovery','replication','max_wal_senders','replication_hba','external_tablespaces','subscriptions','slots','prepared_transactions','hba_errors','other_backends','sodium_nonce_api','sodium_keyid_api','sodium_open_keyid_api')
    actual={}
    for key in fields:
        value=f.get(key)
        kind={type(None):'null',bool:'boolean',int:'integer',float:'number',str:'string',list:'array',dict:'object'}.get(type(value),'other')
        info=dict(present=key in f,type=kind)
        if key in scalar_fields and type(value) in (bool,int):info['value']=value
        elif isinstance(value,str):
            info.update(empty=value=='',length=len(value),sha256=hashlib.sha256(value.encode('utf-8',errors='surrogatepass')).hexdigest())
            if key in path_fields:
                parts=value.split(',') if key=='socket' else [value]
                info.update(path_count=len(parts),path_classes=[known_paths.get(part.strip(),'OTHER') for part in parts[:8]],paths_truncated=len(parts)>8,has_outer_whitespace=any(part!=part.strip() for part in parts))
            elif key=='preload':
                parts=[part.strip() for part in value.split(',') if part.strip()]
                known=('pg_cron','pgsodium','pg_stat_statements');unknown=[part for part in parts if part not in known]
                info.update(known_library_presence={library:library in parts for library in known},unrecognized_count=len(unknown),
                    unrecognized_sha256=hashlib.sha256(json.dumps(unknown,ensure_ascii=True).encode()).hexdigest())
            elif key in ('archive_command','restore_command','primary_conninfo'):
                info['representation']='empty' if value=='' else 'disabled_display' if key=='archive_command' and value=='(disabled)' else 'OTHER'
            elif value in enums.get(key,()):info['value']=value
        elif value is not None:
            info['sha256']=hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=True).encode()).hexdigest()
        actual[key]=info
    return dict(schema_version=1,failed_predicates=failed,actual=actual,sql_crypto_capability_mode=source_sql_crypto_mode(f) or 'UNSUPPORTED')


def validate_source_facts(f):
    if (f.get('database')!='postgres' or f.get('current_user')!='supabase_admin' or f.get('session_user')!='supabase_admin' or f.get('superuser') is not True
        or f.get('recovery') is not False or f.get('wal_level') not in ('replica','logical') or f.get('max_wal_senders',0)<1
        or any(f.get(k)!=0 for k in ('external_tablespaces','subscriptions','slots','prepared_transactions','hba_errors','other_backends'))
        or not isinstance(f.get('replication_hba'),int) or f.get('cron_version') not in ('1.6','1.6.4') or f.get('cron_database')!='postgres'
        or source_sql_crypto_mode(f) is None
        or f.get('config_file')!='/etc/postgresql/postgresql.conf' or f.get('hba_file')!='/etc/postgresql/pg_hba.conf'
        or f.get('ident_file')!='/etc/postgresql/pg_ident.conf' or f.get('data_directory')!=DATA or f.get('data_directory_mode') not in ('0700','0750')
        or f.get('archive_mode')!='off' or f.get('archive_command') not in ('','(disabled)') or any(f.get(k) for k in ('restore_command','primary_conninfo'))
        or f.get('ssl')!='off' or f.get('log_directory') not in ('log','/var/log/postgresql') or f.get('socket')!='/var/run/postgresql'
        or any(x not in [item.strip() for item in f.get('preload','').split(',')] for x in ('pg_cron','pgsodium'))):
        error=RuntimeError('4427 physical source startup/replication/dependency facts refused')
        error.source_diagnostic=source_fact_diagnostic(f)
        raise error
    return f


def validate_cron(f, require_scheduler=True):
    if f.get('pending')!=0 or f.get('workers')!=0 or not isinstance(f.get('schedules'),list):
        raise RuntimeError('4427 physical cron activity or schedule facts refused')
    for schedule in f['schedules']:
        fields=schedule.split() if isinstance(schedule,str) else []
        if len(fields)!=5 or any(re.fullmatch(r'[0-9*/,-]+',x) is None for x in fields):
            raise RuntimeError('4427 physical requires ordinary five-field cron schedules')
    if require_scheduler and len(f.get('schedulers',[]))!=1:
        raise RuntimeError('4427 physical scheduler identity missing or ambiguous')
    return f


def cron_fingerprint(f):
    return {k:f[k] for k in ('jobs','job_hash','schedules','runs','run_hash','pending','workers')}


def archive_member_refusal(message,kind,member,raw):
    # Called only AFTER path/type/cardinality validation. Config names stay private.
    name=raw if kind in ('backup','sealed') else '<private-config-member>'
    escaped=json.dumps(name[:192],ensure_ascii=True)
    error=RuntimeError(message)
    error.offending_header=dict(kind=kind if kind in ('config','backup','sealed') else 'unknown',
        type=member.type[0] if len(member.type)==1 else None,uid=member.uid,gid=member.gid,mode=member.mode,
        escaped_name=escaped,name_sha256=hashlib.sha256(raw.encode('utf-8',errors='surrogatepass')).hexdigest(),name_truncated=len(name)>192)
    raise error


def archive_metadata_index(path,kind):
    # A second metadata-only pass retains later headers even when validation fails early.
    # No extractfile, link following, host extraction or file-content reads occur here.
    rows=[];complete=False;parse_error=None
    try:
        with tarfile.open(path,'r:') as archive:
            for member in archive:
                if len(rows)>=100000:raise RuntimeError('metadata index header bound')
                rows.append(dict(name=member.name,type=member.type.hex(),uid=member.uid,gid=member.gid,mode=member.mode,
                    size=member.size,linkname=member.linkname,offset=member.offset))
        complete=True
    except Exception as error:parse_error=type(error).__name__
    packet=json.dumps(dict(schema_version=1,kind=kind if kind in ('config','backup','sealed') else 'unknown',
        complete=complete,parse_error=parse_error,members=rows),ensure_ascii=True,sort_keys=True).encode()
    fd,index_path=tempfile.mkstemp(prefix='rls4427-private-archive-metadata-',suffix='.json')
    with os.fdopen(fd,'wb') as out:out.write(packet)
    return dict(private_metadata_path=index_path,private_metadata_sha256=hashlib.sha256(packet).hexdigest(),metadata_complete=complete,metadata_members=len(rows))


def validate_tar(path,kind,source_mode=None):
    try:return _validate_tar(path,kind,source_mode)
    except Exception as error:
        diagnostic=dict(getattr(error,'offending_header',{}))
        try:diagnostic.update(archive_metadata_index(path,kind))
        except Exception as capture_error:diagnostic['metadata_capture_error']=type(capture_error).__name__
        error.archive_diagnostic=diagnostic
        raise


def _validate_tar(path,kind,source_mode):
    """Validate archive names/types/size before any extraction, never extract on host."""
    if kind=='backup' and source_mode not in ('0700','0750'):
        raise RuntimeError('4427 physical verified source data-directory mode missing')
    generated_mode=0o600 if source_mode=='0700' else 0o640
    manifest_receipt=None
    names=set();total=0;members={};metadata={}
    with tarfile.open(path,'r:') as archive:
        for member in archive:
            raw=member.name.removeprefix('./').rstrip('/')
            pure=PurePosixPath(raw)
            archive_root=raw in ('','.') and member.isdir()
            if not archive_root and (not raw or pure.is_absolute() or '..' in pure.parts or raw in names or not (member.isfile() or member.isdir()) or member.size<0):
                raise RuntimeError('4427 physical archive path/type/cardinality refused')
            # PG17.6 manifest header mode is bound to actual SHOW data_directory_mode.
            manifest_header=(kind=='backup' and raw=='backup_manifest' and member.isfile() and (member.uid,member.gid,member.mode)==(2048,1024,generated_mode))
            if kind!='config' and (member.uid,member.gid)!=(100,101) and not manifest_header:
                archive_member_refusal('4427 physical PGDATA ownership differs',kind,member,raw)
            if manifest_header:manifest_receipt=dict(uid=member.uid,gid=member.gid,mode=member.mode,source_data_directory_mode=source_mode)
            if archive_root:continue
            if kind=='config' and not any(raw==root or raw.startswith(root+'/') for root in CONFIG_ROOTS):
                raise RuntimeError('4427 physical config archive escaped exact roots')
            if kind!='config' and (raw in ('standby.signal','recovery.signal','postmaster.pid') or raw.startswith('pg_tblspc/')):
                raise RuntimeError('4427 physical archive has external/recovery dependency')
            if kind=='config':
                if (member.uid,member.gid) not in ((0,0),(100,101)) or member.mode & 0o7022 or member.mode & ~0o777:
                    archive_member_refusal('4427 physical unsafe configuration ownership/mode',kind,member,raw)
                if member.isfile() and member.size>1048576:raise RuntimeError('4427 physical configuration file too large')
                metadata[raw]=dict(uid=member.uid,gid=member.gid,mode=member.mode,type='directory' if member.isdir() else 'file',sha256=hashlib.sha256(archive.extractfile(member).read()).hexdigest() if member.isfile() else None)
            names.add(raw);total+=member.size
            if len(names)>100000 or total>1073741824:
                raise RuntimeError('4427 physical archive exceeds one-GiB bounded snapshot')
            if kind=='config' and member.isfile():
                if member.size>1048576:raise RuntimeError('4427 physical configuration file too large')
                members[raw]=archive.extractfile(member).read()
    if kind=='config':
        key='etc/postgresql-custom/pgsodium_root.key'
        if key not in members or re.fullmatch(rb'[0-9a-fA-F]{64}\n?',members[key]) is None:
            raise RuntimeError('4427 physical actual root-key file missing or invalid')
        for required in ('etc/postgresql/postgresql.conf','etc/postgresql/pg_hba.conf','etc/postgresql/pg_ident.conf'):
            if required not in members:raise RuntimeError('4427 physical active configuration closure missing')
        for name,raw in members.items():
            if not name.endswith('.conf'):continue
            for line in raw.decode('utf-8').splitlines():
                line=line.strip()
                if not line or line.startswith('#'):continue
                include=re.fullmatch(r"(include|include_if_exists|include_dir)\s*(?:=\s*)?'([^']+)'\s*(?:#.*)?",line)
                if not include:
                    if re.match(r'include(?:_if_exists|_dir)?\b',line):raise RuntimeError('4427 physical include syntax unsupported')
                    continue
                target=PurePosixPath(include[2])
                target=(PurePosixPath(name).parent/target) if not target.is_absolute() else PurePosixPath(str(target).lstrip('/'))
                value=str(target)
                if '..' in target.parts or not any(value==r or value.startswith(r+'/') for r in CONFIG_ROOTS):
                    raise RuntimeError('4427 physical config include escaped exact closure')
                if include[1]=='include' and value not in members:
                    raise RuntimeError('4427 physical required config include missing')
                if include[1]=='include_dir' and value not in names:
                    raise RuntimeError('4427 physical config include directory missing')
    else:
        if not {'PG_VERSION','global/pg_control'}.issubset(names):raise RuntimeError('4427 physical full cluster archive incomplete')
        if kind=='backup' and not {'backup_label','backup_manifest'}.issubset(names):raise RuntimeError('4427 physical backup manifest missing')
    with Path(path).open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    return dict(files=len(names),bytes=total,sha256=digest,**({'generated_manifest_header':manifest_receipt} if kind=='backup' else {}),**({'metadata_sha256':hashlib.sha256(json.dumps(metadata,sort_keys=True).encode()).hexdigest()} if kind=='config' else {}))


def minute_guard(start_wall,start_mono,now_wall,now_mono):
    if (int(start_wall//60)!=int(now_wall//60) or now_wall%60>=50 or now_wall<start_wall
        or abs((now_wall-start_wall)-(now_mono-start_mono))>.25):
        raise RuntimeError('4427 physical minute/deadline/clock continuity violated')


class PhysicalCluster:
    def __init__(self, source, budget_seconds=2100):
        import math
        if isinstance(budget_seconds,bool) or not isinstance(budget_seconds,(int,float)) or not math.isfinite(budget_seconds) or not 0<budget_seconds<=2700:
            raise RuntimeError('4427 physical explicit budget invalid')
        self.source=source;self.budget=budget_seconds;self.started=time.monotonic();self.cid=None
        self.name=source.prefix+'-physical';self.labels={'shared-db.qualifier':'4427-physical','shared-db.owner':OWNER}
        self.running=False;self.sealed=False;self.events=[];self.env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'}
        self.root=None;self.cleanup_mode=False;self.window_wait_seconds=0.0;self.phase='created';self.start_number=0;self.last_external_failure=None;self.crypto_capability_checks=0;self.crypto_canary_checks=0;self.root_key_bytes_verified=False

    def __enter__(self):return self.open()
    def __exit__(self,*unused):self.close()

    def budget_check(self):
        if not self.cleanup_mode and time.monotonic()-self.started>self.budget:raise RuntimeError('4427 physical total budget exhausted')

    def docker(self,*args,input_file=None,output_file=None,allowed_failure=False):
        self.budget_check()
        r=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',str(self.root/'docker-config'),*args],
            env=self.env,**process_input(input_file),stdout=output_file or subprocess.PIPE,stderr=subprocess.PIPE,timeout=20 if self.cleanup_mode else 120)
        if r.returncode and not allowed_failure:
            self.last_external_failure=capture_external(r.stderr,args[0],r.returncode,self.phase,r.stdout if output_file is None else None)
            error=RuntimeError('4427 owned physical operation failed: '+args[0])
            error.physical_external=dict(self.last_external_failure)
            raise error
        return r

    def custody(self,allow_stopped=False):
        rows=json.loads(self.docker('inspect','--type','container',self.name).stdout)
        if len(rows)!=1:raise RuntimeError('4427 physical target cardinality differs')
        row=rows[0];h=row['HostConfig'];n=row['NetworkSettings'];state=row['State']
        running=state.get('Running') is True
        stopped=allow_stopped and self.cleanup_mode and state.get('Running') is False and state.get('Status') in ('created','exited','dead')
        expected_tmpfs={DATA,'/etc/postgresql','/etc/postgresql-custom','/var/run/postgresql','/var/log/postgresql','/tmp'}
        if (row['Id']!=self.cid or row['Name']!='/'+self.name or row['Image']!=self.image_id or row['Config'].get('Labels')!=self.target_labels
            or row['Config'].get('User')!='100:101' or row['Config'].get('Entrypoint')!=['/bin/sleep'] or row['Config'].get('Cmd')!=['infinity']
            or h.get('NetworkMode')!='none' or h.get('Privileged') is not False or h.get('ReadonlyRootfs') is not True or h.get('Binds')
            or h.get('Init') is not True or h.get('Memory')!=2147483648 or h.get('NanoCpus')!=1000000000 or h.get('PidsLimit')!=256
            or h.get('Devices') or h.get('CapAdd') or h.get('PidMode','') or h.get('PortBindings')
            or h.get('Tmpfs',{})!=TMPFS or any(m.get('Type')!='tmpfs' or m.get('Destination') not in expected_tmpfs for m in row.get('Mounts',[]))
            or set(n.get('Networks',{}))!={'none'} or any(n.get('Ports',{}).values()) or not (running or stopped)):
            raise RuntimeError('4427 physical target custody/resource bounds differ')
        return {'running':running,'status':state.get('Status','running' if running else 'unknown'),'oom_killed':state.get('OOMKilled',False)}

    def target(self,args,input_file=None,output_file=None,allowed_failure=False):
        self.custody()
        return self.docker('exec',*(['-i'] if input_file else []),'--user','100:101',self.cid,*args,input_file=input_file,output_file=output_file,allowed_failure=allowed_failure)

    def config_target(self,args,input_file=None,output_file=None):
        # Only the validated original archive's two fixed operations may use OSroot.
        if args not in (CONFIG_RESTORE_ARGS,CONFIG_ARGS) or not getattr(self,'original_config_receipt',None):
            raise RuntimeError('4427 physical root configuration operation refused')
        restoring=args==CONFIG_RESTORE_ARGS
        if restoring:
            if input_file is None or output_file is not None or Path(input_file.name)!=self.root/'source-config.tar':
                raise RuntimeError('4427 physical root configuration archive differs')
            if validate_tar(input_file.name,'config')!=self.original_config_receipt:
                raise RuntimeError('4427 physical original configuration archive drift')
        elif input_file is not None or output_file is None or not os.path.samestat(os.fstat(output_file.fileno()),(self.root/'target-config.tar').stat()):
            raise RuntimeError('4427 physical root configuration verification channel refused')
        self.custody()
        return self.docker('exec',*(['-i'] if restoring else []),'--user','0:0',self.cid,*args,input_file=input_file,output_file=output_file)

    def restore_config(self):
        with (self.root/'source-config.tar').open('rb') as data:self.config_target(CONFIG_RESTORE_ARGS,input_file=data)
        with os.fdopen(os.open(self.root/'target-config.tar',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as out:self.config_target(CONFIG_ARGS,output_file=out)
        copied_config=validate_tar(self.root/'target-config.tar','config')
        if copied_config['metadata_sha256']!=self.original_config_receipt['metadata_sha256']:
            raise RuntimeError('4427 physical copied configuration ownership/mode/content differs')
        self.config_metadata_verified=True
        emit(self.events,dict(config_metadata_verified=True,metadata_sha256=copied_config['metadata_sha256']))

    def sql(self,query,role='postgres'):
        if role not in ('postgres','supabase_admin'):raise RuntimeError('4427 physical SQL role refused')
        self.guard()
        import io
        r=self.target(['psql','-XqAtw','-h','127.0.0.1','-p','5432','-U',role,'-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],input_file=io.BytesIO(query.encode()),allowed_failure=True)
        if r.returncode:
            self.last_external_failure=capture_external(r.stderr,'psql',r.returncode,self.phase,r.stdout)
            raise subprocess.CalledProcessError(r.returncode,['psql'],output=r.stdout.decode(),stderr=r.stderr.decode())
        return r.stdout.decode()

    def guard(self):
        self.budget_check()
        if self.running:minute_guard(self.start_wall,self.start_mono,time.time(),time.monotonic())

    def _admin_source(self,query):
        args=['psql','-XqAtw','-h','127.0.0.1','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',query]
        return self.source.container_exec(args).decode()

    def open(self):
        self.root=Path(tempfile.mkdtemp(prefix='rls4427-private-physical-'));os.chmod(self.root,0o700)
        (self.root/'docker-config').mkdir(mode=0o700)
        try:
            self.phase='source-qualification'
            self.source.docker_config=str(self.root/'docker-config')
            self.source.qualify_physical_source()
            if getattr(self.source,'immutable_config_sha',None)!=IMMUTABLE_CONFIG_SHA:raise RuntimeError('4427 physical source immutable config digest differs')
            identity=self.source.custody();self.source.container_id=identity[0];self.image_id=identity[1]
            facts=validate_source_facts(json.loads(self._admin_source(SOURCE_FACTS_SQL).splitlines()[-1]))
            self.source_mode=facts['data_directory_mode'];self.crypto_mode=source_sql_crypto_mode(facts)
            self.source.source_backup_window=self.admit_window()
            source_cron=validate_cron(json.loads(self._admin_source(CRON_SQL)))
            binary=self.source.container_exec(BINARY_ARGS).decode().split()[0]
            if binary!=CRON_BINARY_SHA:raise RuntimeError('4427 physical actual pg_cron binary not audited version1.6.4')
            # Capture ORIGINAL configuration before granting the temporary route.
            with os.fdopen(os.open(self.root/'source-config.tar',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as out:
                self.source.container_exec(CONFIG_ARGS,output_file=out)
            self.original_config_receipt=validate_tar(self.root/'source-config.tar','config')
            self.phase='source-temporary-unix-backup-window'
            permission=TemporaryUnixHba(self.source,self.root)
            try:
                with permission:
                    with os.fdopen(os.open(self.root/'source-basebackup.tar',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as out:
                        self.source.container_exec(BACKUP_ARGS,output_file=out)
                    self.original_backup_receipt=validate_tar(self.root/'source-basebackup.tar','backup',facts['data_directory_mode'])
                    emit(self.events,dict(original_backup_header_qualified=True,source_data_directory_mode=facts['data_directory_mode'],generated_manifest_header=self.original_backup_receipt['generated_manifest_header']))
            finally:self.events.extend(permission.events)
            minute_guard(*self.source.source_backup_window,time.time(),time.monotonic())
            after=validate_cron(json.loads(self._admin_source(CRON_SQL)))
            if cron_fingerprint(source_cron)!=cron_fingerprint(after):raise RuntimeError('4427 physical source changed during backup')
            if self.docker('ps','-aq','--filter','name=^/'+self.name+'$').stdout.strip():raise RuntimeError('4427 physical target name occupied')
            image=json.loads(self.docker('image','inspect',self.image_id).stdout)
            if len(image)!=1 or image[0]['Id']!=self.image_id:raise RuntimeError('4427 physical cached source image differs')
            self.target_labels={**(image[0].get('Config',{}).get('Labels') or {}),**self.labels}
            args=['run','--detach','--init','--pull=never','--name',self.name,'--network','none','--read-only','--user','100:101','--memory','2g','--cpus','1','--pids-limit','256','--entrypoint','/bin/sleep']
            for path,options in TMPFS.items():args+=['--tmpfs',path+':'+options]
            for k,v in self.labels.items():args+=['--label',k+'='+v]
            self.phase='target-create'
            self.cid=self.docker(*args,self.image_id,'infinity').stdout.decode().strip()
            if not re.fullmatch('[a-f0-9]{64}',self.cid):raise RuntimeError('4427 physical target ID invalid')
            self.restore_config()
            with (self.root/'source-basebackup.tar').open('rb') as data:self.target(DATA_RESTORE_ARGS,input_file=data)
            self.prepare_data_root()
            self.target(['test','-s','/etc/postgresql-custom/pgsodium_root.key'])
            with tarfile.open(self.root/'source-config.tar','r:') as archive:
                original_key=archive.extractfile('etc/postgresql-custom/pgsodium_root.key').read()
            if self.target(['sha256sum','/etc/postgresql-custom/pgsodium_root.key']).stdout.decode().split()[0]!=hashlib.sha256(original_key).hexdigest():raise RuntimeError('4427 physical original root-key copy differs')
            self.root_key_bytes_verified=True
            del original_key
            self.target(['pg_verifybackup','--exit-on-error',DATA])
            self.original_backup_verified=True
            self.start(preparation=True)
            self.source_facts=facts;self.source_cron=cron_fingerprint(source_cron)
            target_health=json.loads(self.sql(SOURCE_HEALTH_SQL,'supabase_admin'))
            if target_health!=permission.before_health:raise RuntimeError('4427 physical complete roles/grants/policies/functions/owners differ after recovery')
            self.full_capability_fingerprint=target_health
            if cron_fingerprint(validate_cron(json.loads(self.sql(CRON_SQL,'supabase_admin'))))!=self.source_cron:
                raise RuntimeError('4427 physical restored cron capability/data differs')
            self.initialize_sql_crypto_probe()
            return self
        except Exception as original:
            try:self.close()
            except Exception as cleanup:
                print(json.dumps(failure_receipt(cleanup,'physical-open-cleanup',self.events),sort_keys=True),file=sys.stderr)
            raise original

    def admit_window(self,preparation=False):
        self.budget_check()
        second=time.time()%60
        earliest,latest=(5,8) if preparation else (5,40)
        if not earliest<=second<=latest:
            wait=(65-second) if second>latest else (5-second)
            if wait>60 or time.monotonic()-self.started+wait>self.budget:raise RuntimeError('4427 physical safe startup window unavailable')
            before=time.monotonic();time.sleep(wait);self.window_wait_seconds+=time.monotonic()-before
        if not earliest<=time.time()%60<=latest:raise RuntimeError('4427 physical safe startup admission missed')
        return time.time(),time.monotonic()

    def crypto_receipt(self):
        return dict(source_mode=self.crypto_mode,sql_crypto_canary=('NOT_APPLICABLE_ABSENT_IN_SOURCE' if self.crypto_mode=='ABSENT' else 'PASSED' if self.crypto_canary_checks else 'NOT_YET_PROVEN'),
            capability_checks=self.crypto_capability_checks,canary_checks=self.crypto_canary_checks,root_key_config_bytes_equal=self.root_key_bytes_verified)

    def verify_sql_crypto_capability(self,phase):
        if getattr(self,'crypto_mode',None) not in ('PRESENT','ABSENT'):
            raise RuntimeError('4427 physical source SQL crypto mode not qualified')
        actual=json.loads(self.sql(SQL_CRYPTO_CAPABILITY_SQL,'supabase_admin'))
        if set(actual)!=set(SQL_CRYPTO_FIELDS) or source_sql_crypto_mode(actual)!=self.crypto_mode:
            raise RuntimeError('4427 physical target SQL crypto capability differs from source')
        self.crypto_capability_checks+=1
        emit(self.events,dict(sql_crypto_capability_verified=True,source_mode=self.crypto_mode,phase=phase))

    def check_crypto_canary(self,phase):
        self.verify_sql_crypto_capability(phase)
        if self.crypto_mode=='ABSENT':
            emit(self.events,dict(sql_crypto_canary='NOT_APPLICABLE_ABSENT_IN_SOURCE',phase=phase))
            return 'NOT_APPLICABLE_ABSENT_IN_SOURCE'
        if self.sql(CANARY_CHECK_SQL,'supabase_admin').strip()!='t':
            raise RuntimeError('4427 physical key-derived canary failed')
        self.crypto_canary_checks+=1
        emit(self.events,dict(sql_crypto_canary='PASSED',phase=phase))
        return 'PASSED'

    def initialize_sql_crypto_probe(self):
        self.verify_sql_crypto_capability('initial-target')
        if self.crypto_mode=='PRESENT':self.sql(CANARY_CREATE_SQL,'supabase_admin')
        return self.check_crypto_canary('initial-target')

    def data_root_identity(self):
        if getattr(self,'source_mode',None) not in ('0700','0750'):
            raise RuntimeError('4427 physical admitted source data-directory mode missing')
        actual=self.target(['stat','-c','%u:%g:%a',DATA]).stdout.decode().strip()
        if actual!='100:101:'+self.source_mode[1:]:
            raise RuntimeError('4427 physical owned data-root owner/mode differs')
        return dict(uid=100,gid=101,mode=int(self.source_mode,8))

    def prepare_data_root(self):
        if getattr(self,'source_mode',None) not in ('0700','0750'):
            raise RuntimeError('4427 physical admitted source data-directory mode missing')
        self.target(['chmod',self.source_mode,DATA])
        self.data_root_identity()

    def start(self,preparation=False):
        root_identity=self.data_root_identity()
        self.start_wall,self.start_mono=self.admit_window(preparation)
        self.running=True;self.start_number+=1
        self.phase='target-preparation' if preparation else 'target-trial'
        self.start_kind='preparation' if preparation else 'baseline-trial'
        self.target(['pg_ctl','-D','/etc/postgresql','-l','/var/log/postgresql/4427.log','-w','-t','10','start'])
        self.guard()
        server_mode=self.sql("select current_setting('data_directory_mode');",'supabase_admin').strip()
        if server_mode!=self.source_mode:raise RuntimeError('4427 physical target startup data-directory mode differs')
        emit(self.events,dict(data_directory_mode_verified=True,source_mode=self.source_mode,server_mode=server_mode,**root_identity))
        self.verify_sql_crypto_capability('normal-start')
        if self.sql('select pg_is_in_recovery();','supabase_admin').strip()!='f':raise RuntimeError('4427 physical target not normal primary')
        self.cron_at_start=validate_cron(json.loads(self.sql(CRON_SQL,'supabase_admin')))
        scheduler_start=datetime.datetime.fromisoformat(self.cron_at_start['schedulers'][0][1]).timestamp()
        if scheduler_start<self.start_wall-.25 or scheduler_start>time.time():raise RuntimeError('4427 physical scheduler startup identity/time differs')
        server_now=float(self.sql('select extract(epoch from clock_timestamp());','supabase_admin'))
        if abs(time.time()-server_now)>.25:raise RuntimeError('4427 physical target wall clock differs')
        emit(self.events,{'owned_server_started':True,'restart':self.start_number,'kind':self.start_kind,'wall_start':self.start_wall,'monotonic_start':self.start_mono,'scheduler_identity':self.cron_at_start['schedulers'][0],'cron_fingerprint_sha256':hashlib.sha256(json.dumps(cron_fingerprint(self.cron_at_start),sort_keys=True).encode()).hexdigest(),'canonical_sha256':self.baseline['sha256'] if self.sealed else None})

    def stop(self,check=True):
        if not self.running:return
        error=None
        try:
            if check:
                self.guard();after=validate_cron(json.loads(self.sql(CRON_SQL,'supabase_admin')))
                if after!=self.cron_at_start:raise RuntimeError('4427 physical scheduler identity/activity/job data changed')
        except Exception as caught:error=caught
        result=self.target(['pg_ctl','-D','/etc/postgresql','-w','-t','10','-m','smart','stop'],allowed_failure=True)
        self.running=False
        if check:
            try:minute_guard(self.start_wall,self.start_mono,time.time(),time.monotonic())
            except Exception as caught:error=error or caught
        if result.returncode or self.target(['test','!','-e',DATA+'/postmaster.pid'],allowed_failure=True).returncode:
            raise RuntimeError('4427 physical owned graceful-stop/absence failed')
        if self.target(['pg_ctl','-D','/etc/postgresql','status'],allowed_failure=True).returncode!=3:
            raise RuntimeError('4427 physical stopped server status not proven')
        control=self.target(['pg_controldata',DATA]).stdout.decode()
        if re.search(r'^Database cluster state:\s+shut down$',control,re.M) is None:
            raise RuntimeError('4427 physical canonical cluster not cleanly shut down')
        if check:
            try:minute_guard(self.start_wall,self.start_mono,time.time(),time.monotonic())
            except Exception as caught:error=error or caught
        emit(self.events,{'owned_server_stopped':True,'restart':self.start_number,'kind':self.start_kind,'pid_absent':True,'clean_shutdown':True,'minute_window_qualified':check and error is None,'wall_start':self.start_wall,'wall_end':time.time(),'elapsed_active':time.monotonic()-self.start_mono,'scheduler_identity':getattr(self,'cron_at_start',{}).get('schedulers',[]),'canonical_sha256':self.baseline['sha256'] if self.sealed else None})
        if error:raise error

    def seal(self):
        self.check_crypto_canary('before-seal')
        self.stop()
        self.data_root_identity()
        archive=self.root/'sealed-canonical.tar'
        with os.fdopen(os.open(archive,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as out:self.target(['tar','--numeric-owner','-C',DATA,'-cf','-','.'],output_file=out)
        self.baseline=validate_tar(archive,'sealed');self.sealed=True
        # Original basebackup manifest was checked before recovery. It is NOT a
        # verification claim for this changed, cleanly shut down canonical image.
        return self.baseline

    def begin_trial(self):
        if not self.sealed or self.running:raise RuntimeError('4427 physical reset requires stopped sealed owned target')
        self.target(['test','!','-e',DATA+'/postmaster.pid'])
        self.target(['find',DATA,'-mindepth','1','-delete'])
        archive=self.root/'sealed-canonical.tar'
        with archive.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        if digest!=self.baseline['sha256']:raise RuntimeError('4427 physical immutable baseline drift')
        with archive.open('rb') as data:self.target(DATA_RESTORE_ARGS,input_file=data)
        self.start()
        self.check_crypto_canary('after-reset')
        return {'baseline_sha256':self.baseline['sha256'],'start_wall':self.start_wall}

    def end_trial(self):self.stop()

    def projected_matrix_check(self,active_seconds):
        # Exclude ONLY observed explicit admission waits from measured per-restart
        # active cost. All actual wait remains consumed in the admitted global wall budget.
        import math
        if not isinstance(active_seconds,list) or len(active_seconds)!=34 or any(isinstance(v,bool) or not isinstance(v,(float,int)) or not math.isfinite(v) or v<=0 for v in active_seconds):
            raise RuntimeError('4427 physical measured active calibration cost invalid')
        projected=10*sum(active_seconds)*(60/35)+60
        elapsed=time.monotonic()-self.started
        remaining=self.budget-elapsed
        self.events.append(dict(warmup_cost_projection=True, active_seconds=list(active_seconds),
            sum_active_seconds=sum(active_seconds), max_active_seconds=max(active_seconds),
            repeats_per_warmup=10, remaining_trials=340, window_factor=60/35,
            reserve_seconds=60, elapsed_wall_seconds=elapsed, remaining_budget_seconds=remaining,
            projected_seconds=projected, admitted=projected<=remaining))
        if projected>remaining:raise RuntimeError('4427 physical warmup-measured340-run cost exceeds remaining bound')
        return projected

    def close(self):
        self.cleanup_mode=True
        if self.cid:
            state=self.custody(allow_stopped=True)
            try:
                if state['running']:
                    if self.running:self.stop(check=False)
                else:
                    self.running=False
                    emit(self.events,{'owned_keeper_not_running':True,'status':state['status'],'oom_killed':state['oom_killed'],'graceful_pg_stop':False})
            finally:
                state=self.custody(allow_stopped=True)
                if state['running']:self.docker('stop','--time','10',self.cid)
                self.custody(allow_stopped=True)
                self.docker('rm',self.cid)
                if self.docker('ps','-aq','--filter','name=^/'+self.name+'$').stdout.strip():raise RuntimeError('4427 physical owned target removal absence failed')
                emit(self.events,{'owned_container_removed':self.cid,'absent':True});self.cid=None;self.running=False
        if self.root is not None:
            if getattr(self.source,'hba_restore_failed',False):
                self.source.diagnostic('source-hba-restoration-failed',private_recovery_path=str(self.root))
            else:
                shutil.rmtree(self.root);self.root=None
