"""Offline controls: no Docker/socket/SQL action is executed by these tests."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

P=Path(__file__).with_name('rls4427_physical_cluster.py')
spec=importlib.util.spec_from_file_location('physical4427',P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class PhysicalControls(unittest.TestCase):
    def source(self):
        class Source:
            prefix='rls4427_test'
        return Source()

    def facts(self):
        return dict(database='postgres',current_user='supabase_admin',session_user='supabase_admin',superuser=True,replication=True,
            recovery=False,wal_level='logical',max_wal_senders=10,external_tablespaces=0,subscriptions=0,slots=0,prepared_transactions=0,
            cron_version='1.6',sodium_version='3.1.8',sodium_nonce_api=True,sodium_keyid_api=True,sodium_open_keyid_api=True,config_file='/etc/postgresql/postgresql.conf',hba_file='/etc/postgresql/pg_hba.conf',
            ident_file='/etc/postgresql/pg_ident.conf',data_directory=m.DATA,data_directory_mode='0700',archive_mode='off',archive_command='',restore_command='',
            primary_conninfo='',ssl='off',log_directory='/var/log/postgresql',socket='/var/run/postgresql',cron_database='postgres',
            preload='pg_stat_statements, pg_cron, pgsodium',hba_errors=0,replication_hba=1,other_backends=0)

    def test_import_and_construction_do_not_launch_resources(self):
        with patch.object(m.subprocess,'run') as run:
            p=m.PhysicalCluster(self.source());self.assertIsNone(p.cid);run.assert_not_called()

    def test_actual_source_startup_and_omission_facts_fail_closed(self):
        facts=self.facts();self.assertEqual(m.validate_source_facts(facts),facts)
        for k,v in [('current_user','postgres'),('superuser',False),('recovery',True),('wal_level','minimal'),('max_wal_senders',0),
                    ('external_tablespaces',1),('subscriptions',1),('slots',1),('prepared_transactions',1),('replication_hba','unknown'),
                    ('hba_errors',1),('other_backends',1),('cron_version','other'),('ssl','on'),('archive_mode','on'),
                    ('archive_command','external'),('primary_conninfo','external'),('restore_command','external'),
                    ('config_file','/foreign/config'),('preload','pg_cron')]:
            with self.subTest(key=k),self.assertRaisesRegex(RuntimeError,'facts refused'):m.validate_source_facts({**facts,k:v})
        self.assertIn("select exists(select 1",m.SOURCE_FACTS_SQL)
        self.assertIn("nonempty unlogged relation",m.SOURCE_FACTS_SQL)
        self.assertNotIn('reltuples',m.SOURCE_FACTS_SQL)

    def test_source_fact_query_and_original_guard_condition_remain_byte_pinned(self):
        import ast
        tree=ast.parse(P.read_text());validator=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='validate_source_facts')
        self.assertEqual(m.hashlib.sha256(ast.get_source_segment(P.read_text(),validator.body[0].test).encode()).hexdigest(),'35986fc7f5b2ecd655598aadad7c9be29c4a138492a12fb53ff2dd160d21c9c1')
        self.assertEqual(m.hashlib.sha256(m.SOURCE_FACTS_SQL.encode()).hexdigest(),'fc9c6386304ae2706ba24fb6080de66bf8fd880ded367195017d2efc454fce11')
        facts=self.facts();self.assertIs(m.validate_source_facts(facts),facts)
        self.assertEqual(m.source_fact_diagnostic(facts)['failed_predicates'],[])

    def test_every_original_refusal_predicate_has_distinct_sanitized_fact_diagnostics(self):
        changes=[('database','UNIT_SECRET','database'),('current_user','postgres','current_user'),('session_user','postgres','session_user'),
            ('superuser',False,'superuser'),('recovery',True,'recovery'),('wal_level','minimal','wal_level'),('max_wal_senders',0,'max_wal_senders')]
        changes += [(key,1,key) for key in ('external_tablespaces','subscriptions','slots','prepared_transactions','hba_errors','other_backends')]
        changes += [('replication_hba','UNIT_SECRET','replication_hba_type'),('cron_version','UNIT_SECRET','cron_version'),('cron_database','UNIT_SECRET','cron_database'),('sodium_version','UNIT_SECRET','sodium_version')]
        changes += [(key,False,key) for key in ('sodium_nonce_api','sodium_keyid_api','sodium_open_keyid_api')]
        changes += [(key,'/private/UNIT_SECRET',key) for key in ('config_file','hba_file','ident_file','data_directory')]
        changes += [('data_directory_mode','0701','data_directory_mode'),('archive_mode','on','archive_mode'),('archive_command','UNIT_SECRET','archive_command'),
            ('restore_command','UNIT_SECRET','restore_command'),('primary_conninfo','UNIT_SECRET','primary_conninfo'),('ssl','on','ssl'),
            ('log_directory','/tmp','log_directory'),('socket','/run/postgresql','socket'),('preload','pg_cron','preload_pgsodium'),('preload','pgsodium','preload_pg_cron')]
        with patch.object(m.subprocess,'run') as subprocess_run:
            for key,value,predicate in changes:
                with self.subTest(predicate=predicate),self.assertRaisesRegex(RuntimeError,'facts refused') as caught:m.validate_source_facts({**self.facts(),key:value})
                receipt=m.failure_receipt(caught.exception,'source-qualification',[])
                self.assertEqual(receipt['source_diagnostic']['failed_predicates'],[predicate] if predicate!='sodium_version' else ['sodium_version','sodium_nonce_api','sodium_keyid_api','sodium_open_keyid_api'])
                self.assertNotIn('UNIT_SECRET',json.dumps(receipt))
            subprocess_run.assert_not_called()
        secret='UNIT_SOURCE_DIAGNOSTIC_SECRET'
        facts={**self.facts(),**{key:secret for key in ('archive_command','restore_command','primary_conninfo','database','cron_version','config_file','socket')},
            'preload':'pg_cron,pgsodium,'+secret,secret:secret}
        with self.assertRaises(RuntimeError) as caught:m.validate_source_facts(facts)
        receipt=m.failure_receipt(caught.exception,'source-qualification',[]);packet=json.dumps(receipt);actual=receipt['source_diagnostic']['actual']
        self.assertNotIn(secret,packet);self.assertNotIn('raw',actual);self.assertNotIn(secret,actual)
        from contextlib import redirect_stderr
        public=io.StringIO()
        with redirect_stderr(public):m.emit([],receipt)
        self.assertNotIn(secret,public.getvalue());self.assertNotIn(secret,json.dumps(caught.exception.__dict__))
        self.assertEqual(actual['preload']['unrecognized_count'],1)
        self.assertTrue(actual['preload']['known_library_presence']['pg_cron']);self.assertTrue(actual['preload']['known_library_presence']['pgsodium'])
        for key in ('archive_command','restore_command','primary_conninfo','database','cron_version','config_file','socket'):
            self.assertEqual(actual[key]['sha256'],m.hashlib.sha256(secret.encode()).hexdigest());self.assertNotIn('value',actual[key])
        for key in ('archive_command','restore_command','primary_conninfo'):
            diagnostic=m.source_fact_diagnostic({**self.facts(),key:123456})
            self.assertNotIn('value',diagnostic['actual'][key])
        self.assertEqual(m.source_fact_diagnostic({**self.facts(),'socket':'/var/run/postgresql, /tmp'})['actual']['socket']['path_classes'],['var_run_postgresql','tmp'])

    def test_actual_physical_open_preserves_queried_refusal_without_any_resource_operation(self):
        facts={**self.facts(),'socket':'/tmp','log_directory':'/tmp'};queries=[]
        class Source:
            prefix='rls4427_diagnostic_unit';immutable_config_sha=m.IMMUTABLE_CONFIG_SHA
            def qualify_physical_source(self):pass
            def custody(self):return ('a'*64,'b'*64)
            def container_exec(self,args):
                queries.append(args);return json.dumps(facts).encode()
        p=m.PhysicalCluster(Source())
        with patch.object(m.subprocess,'run') as subprocess_run,self.assertRaisesRegex(RuntimeError,'facts refused') as caught:p.open()
        subprocess_run.assert_not_called();self.assertIsNone(p.cid);self.assertIsNone(p.root)
        self.assertEqual(len(queries),1);self.assertEqual(queries[0][-1],m.SOURCE_FACTS_SQL)
        receipt=m.failure_receipt(caught.exception,'source-qualification',p.events)
        self.assertEqual(receipt['source_diagnostic']['failed_predicates'],['log_directory','socket'])
        self.assertEqual(receipt['source_diagnostic']['actual']['socket']['path_classes'],['tmp'])
        self.assertEqual(receipt['source_diagnostic']['actual']['log_directory']['path_classes'],['tmp'])
        self.assertEqual(receipt['source_diagnostic']['actual']['max_wal_senders']['value'],10)
        self.assertEqual(receipt['source_diagnostic']['actual']['database']['value'],'postgres')

    def test_actual_cached_sodium_sql_api_is_required_before_any_backup(self):
        facts=self.facts();self.assertEqual(m.validate_source_facts(facts)['sodium_version'],'3.1.8')
        for key,value in [('sodium_version',None),('sodium_version','3.1.7'),('sodium_nonce_api',False),('sodium_keyid_api',False),('sodium_open_keyid_api',False)]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.validate_source_facts({**facts,key:value})
        self.assertIn("to_regprocedure('pgsodium.crypto_secretbox(bytea,bytea,bigint,bytea)')",m.SOURCE_FACTS_SQL)
        self.assertIn("to_regprocedure('pgsodium.crypto_secretbox_open(bytea,bytea,bigint,bytea)')",m.SOURCE_FACTS_SQL)
        source=P.read_text()
        self.assertLess(source.index('facts=validate_source_facts'),source.index('with permission:'))

    def test_exact_present_or_absent_source_sql_crypto_states_and_all_mixed_states(self):
        import itertools
        for version in ('3.1.8',None,'3.1.7'):
            for apis in itertools.product((False,True),repeat=3):
                facts={**self.facts(),'sodium_version':version,**dict(zip(m.SQL_CRYPTO_FIELDS[1:],apis))}
                mode='PRESENT' if version=='3.1.8' and all(apis) else 'ABSENT' if version is None and not any(apis) else None
                self.assertEqual(m.source_sql_crypto_mode(facts),mode)
                if mode:
                    self.assertIs(m.validate_source_facts(facts),facts);self.assertEqual(m.source_fact_diagnostic(facts)['failed_predicates'],[])
                else:
                    with self.assertRaisesRegex(RuntimeError,'facts refused'):m.validate_source_facts(facts)
        absent=dict(sodium_version=None,sodium_nonce_api=False,sodium_keyid_api=False,sodium_open_keyid_api=False)
        for key in m.SQL_CRYPTO_FIELDS:
            bad={**self.facts(),**absent};del bad[key]
            with self.assertRaises(RuntimeError):m.validate_source_facts(bad)
        self.assertEqual(m.hashlib.sha256(m.SOURCE_FACTS_SQL.encode()).hexdigest(),'fc9c6386304ae2706ba24fb6080de66bf8fd880ded367195017d2efc454fce11')
        self.assertNotIn('CREATE',m.SQL_CRYPTO_CAPABILITY_SQL.upper());self.assertNotIn('ALTER',m.SQL_CRYPTO_CAPABILITY_SQL.upper())

    def test_actual_crypto_lifecycle_preserves_present_and_absent_modes_through_seal_resets(self):
        from types import SimpleNamespace
        for mode in ('PRESENT','ABSENT'):
            capability={key:self.facts()[key] for key in m.SQL_CRYPTO_FIELDS} if mode=='PRESENT' else dict(sodium_version=None,sodium_nonce_api=False,sodium_keyid_api=False,sodium_open_keyid_api=False)
            with tempfile.TemporaryDirectory() as d:
                p=m.PhysicalCluster(self.source());p.root=Path(d);p.source_mode='0700';p.crypto_mode=mode;p.root_key_bytes_verified=True
                queries=[];stops=[]
                def sql(q,role):
                    self.assertEqual(role,'supabase_admin');queries.append(q)
                    if q==m.SQL_CRYPTO_CAPABILITY_SQL:return json.dumps(capability)
                    if q in (m.CANARY_CREATE_SQL,m.CANARY_CHECK_SQL):
                        self.assertEqual(mode,'PRESENT','Absent source must NEVERexecute SQLcrypto CREATE/CHECK')
                        return 't'
                    if 'data_directory_mode' in q:return '0700'
                    if 'pg_is_in_recovery' in q:return 'f'
                    if q==m.CRON_SQL:return json.dumps(dict(jobs=0,job_hash='j',schedules=[],runs=0,run_hash='r',pending=0,workers=0,schedulers=[[1,'1970-01-01T00:02:05+00:00']]))
                    if 'clock_timestamp' in q:return '125'
                    self.fail(q)
                def target(args,**kw):
                    if kw.get('output_file'):
                        with tarfile.open(fileobj=kw['output_file'],mode='w') as out:
                            for name in ('PG_VERSION','global/pg_control'):
                                e=tarfile.TarInfo(name);e.uid=100;e.gid=101;e.size=1;out.addfile(e,io.BytesIO(b'x'))
                    return SimpleNamespace(returncode=0,stdout=b'')
                def stop(*a,**kw):p.running=False;stops.append(True)
                with patch.object(p,'sql',side_effect=sql),patch.object(p,'target',side_effect=target),patch.object(p,'stop',side_effect=stop),patch.object(p,'data_root_identity',return_value=dict(uid=100,gid=101,mode=0o700)),patch.object(p,'admit_window',return_value=(125,10)),patch.object(p,'guard'),patch.object(m.time,'time',return_value=125):
                    p.start();p.initialize_sql_crypto_probe();p.seal()
                    for _ in range(2):p.begin_trial();p.end_trial()
                self.assertEqual(p.start_number,3);self.assertEqual(len(stops),3);self.assertGreaterEqual(p.crypto_capability_checks,8)
                receipt=p.crypto_receipt();self.assertTrue(receipt['root_key_config_bytes_equal'])
                if mode=='PRESENT':
                    self.assertEqual(queries.count(m.CANARY_CREATE_SQL),1);self.assertEqual(queries.count(m.CANARY_CHECK_SQL),4);self.assertEqual(receipt['sql_crypto_canary'],'PASSED')
                else:
                    self.assertEqual(receipt['sql_crypto_canary'],'NOT_APPLICABLE_ABSENT_IN_SOURCE');self.assertEqual(receipt['canary_checks'],0)
                    self.assertNotIn(m.CANARY_CREATE_SQL,queries);self.assertNotIn(m.CANARY_CHECK_SQL,queries)

    def test_target_sql_crypto_drift_partial_or_wrong_mode_fails_before_any_canary(self):
        for mode in ('PRESENT','ABSENT'):
            p=m.PhysicalCluster(self.source());p.crypto_mode=mode
            present={key:self.facts()[key] for key in m.SQL_CRYPTO_FIELDS};absent=dict(sodium_version=None,sodium_nonce_api=False,sodium_keyid_api=False,sodium_open_keyid_api=False)
            for bad in [absent if mode=='PRESENT' else present,{**absent,'sodium_nonce_api':True},{**present,'sodium_version':'3.1.7'},{k:v for k,v in absent.items()if k!='sodium_version'}]:
                calls=[]
                def sql(q,role):calls.append(q);return json.dumps(bad)
                with patch.object(p,'sql',side_effect=sql),self.assertRaisesRegex(RuntimeError,'capability differs'):p.initialize_sql_crypto_probe()
                self.assertEqual(calls,[m.SQL_CRYPTO_CAPABILITY_SQL]);self.assertEqual(p.crypto_canary_checks,0)

    def test_inactive_archive_display_is_qualified_without_configuration_change(self):
        facts=self.facts()
        self.assertEqual(m.validate_source_facts({**facts,'archive_command':'(disabled)'} )['archive_mode'],'off')
        for changes in [dict(archive_mode='on',archive_command='(disabled)'),dict(archive_mode='always',archive_command=''),dict(archive_command='external'),dict(restore_command='external'),dict(primary_conninfo='external')]:
            with self.subTest(changes=changes),self.assertRaises(RuntimeError):m.validate_source_facts({**facts,**changes})

    def test_real_child_physical_sql_hba_and_file_archive_channels(self):
        import subprocess
        real_run=subprocess.run;seen=[]
        reader=['/usr/bin/python3','-c','import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())']
        def child(argv,**kwargs):
            self.assertEqual(argv[0],'/usr/bin/docker')
            seen.append(dict(kwargs))
            return real_run(reader,**kwargs)
        p=m.PhysicalCluster(self.source());p.root=Path('/private/offline-test-config');p.cid='a'*64
        with patch.object(p,'custody'),patch.object(m.subprocess,'run',side_effect=child):
            for payload in (b"select 'owned4427';\n",m.HBA_LINE):
                self.assertEqual(p.target(['fixed-test-stdin-reader'],input_file=io.BytesIO(payload)).stdout,payload)
                self.assertEqual(seen[-1]['input'],payload);self.assertNotIn('stdin',seen[-1])
            with tempfile.TemporaryFile() as archive:
                payload=b'PGDMP-invented-archive\x00'*4096;archive.write(payload);archive.seek(0)
                self.assertEqual(p.target(['fixed-test-archive-reader'],input_file=archive).stdout,payload)
                self.assertIs(seen[-1]['stdin'],archive);self.assertNotIn('input',seen[-1])
            query="select 'small fixed SQL';"
            self.assertEqual(p.sql(query),query)
            self.assertEqual(seen[-1]['input'],query.encode())
        with self.assertRaises(RuntimeError):m.process_input(io.StringIO('unsupported'))

    def test_existing_nix_cron_binary_is_closed_without_alias_or_hash_fallback(self):
        self.assertEqual(m.BINARY_ARGS,['sha256sum','/nix/store/qpz7hxz26yk04v1f0cxfhgicy360zf9n-pg_cron-1.6.4/lib/pg_cron-1.6.4.so'])
        self.assertEqual(m.CRON_BINARY_SHA,'55a7bdcf1b966d51d83d248797507348de19d16f1c968948c1854bc799751108')
        self.assertEqual(m.source_command_kind(m.BINARY_ARGS),'read')
        self.assertIsNone(m.source_command_kind(['sha256sum','/usr/lib/postgresql/lib/pg_cron.so']))
        self.assertIsNone(m.source_command_kind(m.BINARY_ARGS+['another-library']))

    def test_cron_preserves_normal_minute_jobs_but_no_startup_or_interval_jobs(self):
        facts=dict(jobs=2,job_hash='j',schedules=['* * * * *','0 1 * * 1-5'],runs=3,run_hash='r',pending=0,workers=0,schedulers=[[10,'fixed']])
        self.assertEqual(m.validate_cron(facts),facts)
        for schedules in [['@reboot'],['5 seconds'],['* * * * * *'],['bad * * * *']]:
            with self.assertRaises(RuntimeError):m.validate_cron({**facts,'schedules':schedules})
        for key,value in [('pending',1),('workers',1),('schedulers',[])]:
            with self.assertRaises(RuntimeError):m.validate_cron({**facts,key:value})
        changed=copy.deepcopy(facts);changed['schedulers']=[[11,'new']]
        self.assertEqual(m.cron_fingerprint(facts),m.cron_fingerprint(changed))
        # Per-running-instance check retains the full scheduler tuple separately.
        self.assertNotEqual(facts,changed)

    def archive(self,path,files,links=None):
        with tarfile.open(path,'w') as out:
            for name,value in files.items():
                entry=tarfile.TarInfo(name);entry.uid=100;entry.gid=101;entry.size=len(value);out.addfile(entry,io.BytesIO(value))
            for name,target in (links or {}).items():
                entry=tarfile.TarInfo(name);entry.type=tarfile.SYMTYPE;entry.linkname=target;out.addfile(entry)

    def config(self):
        return {'etc/postgresql/postgresql.conf':b"include='/etc/postgresql-custom/custom.conf'\n",
                'etc/postgresql/pg_hba.conf':b'local replication supabase_admin trust\n',
                'etc/postgresql/pg_ident.conf':b'', 'etc/postgresql-custom/custom.conf':b"shared_preload_libraries='pg_cron,pgsodium'\n",
                'etc/postgresql-custom/pgsodium_root.key':b'a'*64}

    def test_private_config_requires_real_key_and_exact_closed_include_graph(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'config.tar';self.archive(path,self.config());self.assertEqual(m.validate_tar(path,'config')['files'],5)
            for change in [dict(self.config(),**{'etc/postgresql-custom/pgsodium_root.key':b''}),
                           {k:v for k,v in self.config().items() if not k.endswith('root.key')},
                           dict(self.config(),**{'etc/postgresql/postgresql.conf':b"include='/outside/file'\n"}),
                           dict(self.config(),**{'etc/postgresql/postgresql.conf':b"include='/etc/postgresql-custom/missing.conf'\n"}),
                           dict(self.config(),**{'etc/postgresql/postgresql.conf':b'include /unsupported\n'})]:
                self.archive(path,change)
                with self.assertRaises(RuntimeError):m.validate_tar(path,'config')
            self.archive(path,self.config(),{'etc/postgresql-custom/alias':'/outside'})
            with self.assertRaises(RuntimeError):m.validate_tar(path,'config')

    def test_archive_escape_recovery_external_dependency_and_manifest_refuse(self):
        full={'PG_VERSION':b'17','global/pg_control':b'invented','backup_label':b'owned','backup_manifest':b'{}'}
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'cluster.tar';self.archive(path,full);m.validate_tar(path,'backup','0700')
            for name in ('../escape','/absolute','standby.signal','recovery.signal','postmaster.pid','pg_tblspc/external'):
                self.archive(path,{**full,name:b'bad'})
                with self.assertRaises(RuntimeError):m.validate_tar(path,'backup','0700')
            self.archive(path,{k:v for k,v in full.items() if k!='backup_manifest'})
            with self.assertRaises(RuntimeError):m.validate_tar(path,'backup','0700')
            m.validate_tar(path,'sealed') # Explicitly different from original backup verification.

    def test_mixed_configuration_metadata_is_preserved_and_every_mutation_refuses(self):
        from types import SimpleNamespace
        def config_archive(path,change=None):
            with tarfile.open(path,'w') as out:
                for name,owner in [('etc/postgresql',(0,0)),('etc/postgresql-custom',(100,101))]:
                    e=tarfile.TarInfo(name);e.type=tarfile.DIRTYPE;e.uid,e.gid=owner;e.mode=0o755
                    if change:change(e)
                    out.addfile(e)
                for i,(name,value) in enumerate(self.config().items()):
                    e=tarfile.TarInfo(name);e.uid,e.gid=(0,0) if i%2 else (100,101);e.mode=0o600 if name.endswith('key') else 0o755;e.size=len(value)
                    if change:change(e)
                    out.addfile(e,io.BytesIO(value))
        with tempfile.TemporaryDirectory() as d:
            p=m.PhysicalCluster(self.source());p.root=Path(d);p.cid='a'*64
            original=p.root/'source-config.tar';config_archive(original)
            p.original_config_receipt=m.validate_tar(original,'config')
            calls=[]
            def docker(*args,**kw):
                calls.append(args)
                if kw.get('output_file'):
                    kw['output_file'].write(original.read_bytes())
                return SimpleNamespace(returncode=0,stdout=b'',stderr=b'')
            with patch.object(p,'custody') as custody,patch.object(p,'docker',side_effect=docker):
                p.restore_config();self.assertTrue(p.config_metadata_verified)
                self.assertEqual(calls[0],('exec','-i','--user','0:0',p.cid,*m.CONFIG_RESTORE_ARGS))
                self.assertEqual(calls[1],('exec','--user','0:0',p.cid,*m.CONFIG_ARGS));self.assertEqual(custody.call_count,2)
                for args in [m.CONFIG_RESTORE_ARGS+['foreign'],['sh','-c','anything'],['tar','-C','/','-xf','-']]:
                    with self.assertRaises(RuntimeError):p.config_target(args)
                foreign=p.root/'foreign.tar';foreign.write_bytes(original.read_bytes())
                with foreign.open('rb') as stream,self.assertRaises(RuntimeError):p.config_target(m.CONFIG_RESTORE_ARGS,input_file=stream)
            for changes in [dict(uid=100,gid=101),dict(mode=0o644)]:
                changed=p.root/'changed.tar';config_archive(changed,lambda e:[setattr(e,k,v) for k,v in changes.items()])
                self.assertNotEqual(m.validate_tar(changed,'config')['metadata_sha256'],p.original_config_receipt['metadata_sha256'])
                (p.root/'target-config.tar').unlink(missing_ok=True)
                def altered_docker(*args,**kw):
                    if kw.get('output_file'):kw['output_file'].write(changed.read_bytes())
                    return SimpleNamespace(returncode=0,stdout=b'',stderr=b'')
                with patch.object(p,'custody'),patch.object(p,'docker',side_effect=altered_docker),self.assertRaisesRegex(RuntimeError,'ownership/mode/content differs'):p.restore_config()
            for changes in [dict(uid=99),dict(mode=0o777),dict(mode=0o4755)]:
                changed=p.root/'bad.tar';config_archive(changed,lambda e:[setattr(e,k,v) for k,v in changes.items()])
                with self.assertRaises(RuntimeError):m.validate_tar(changed,'config')
            # A root-owned PGDATA entry must refuse before extraction, including archive root.
            for name in ['PG_VERSION','.']:
                with tarfile.open(p.root/'bad-pg.tar','w') as out:
                    e=tarfile.TarInfo(name);e.type=tarfile.DIRTYPE if name=='.' else tarfile.REGTYPE;out.addfile(e)
                with self.assertRaisesRegex(RuntimeError,'PGDATA ownership'):m.validate_tar(p.root/'bad-pg.tar','backup','0700')

    def test_only_backup_tool_manifest_has_exact_generated_header_exception(self):
        full={'PG_VERSION':b'17','global/pg_control':b'invented','backup_label':b'owned','backup_manifest':b'{}'}
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'backup.tar'
            def archive(name='backup_manifest',uid=2048,gid=1024,mode=0o600,directory=False):
                with tarfile.open(p,'w') as out:
                    for n,data in full.items():
                        e=tarfile.TarInfo(n if n!='backup_manifest' else name);e.uid=100;e.gid=101;e.mode=0o600;e.size=len(data)
                        if n=='backup_manifest':
                            e.uid=uid;e.gid=gid;e.mode=mode
                            if directory:e.type=tarfile.DIRTYPE;e.size=0
                        out.addfile(e,io.BytesIO(data) if e.isfile() else None)
            archive();self.assertEqual(m.validate_tar(p,'backup','0700')['files'],4)
            with self.assertRaisesRegex(RuntimeError,'ownership'):m.validate_tar(p,'sealed')
            for change in [dict(name='other'),dict(uid=2047),dict(gid=1025),dict(mode=0o644),dict(directory=True)]:
                archive(**change)
                with self.subTest(change=change),self.assertRaisesRegex(RuntimeError,'ownership'):m.validate_tar(p,'backup','0700')

    def test_verified_source_mode_binds_only_canonical_generated_manifest_permissions(self):
        full={'PG_VERSION':b'17','global/pg_control':b'invented','backup_label':b'owned','backup_manifest':b'{}'}
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'backup.tar'
            def archive(mode):
                with tarfile.open(p,'w') as out:
                    for n,data in full.items():
                        e=tarfile.TarInfo(n);e.uid=100;e.gid=101;e.mode=0o600;e.size=len(data)
                        if n=='backup_manifest':e.uid=2048;e.gid=1024;e.mode=mode
                        out.addfile(e,io.BytesIO(data))
            for source,expected,wrong in [('0700',0o600,0o640),('0750',0o640,0o600)]:
                archive(expected);r=m.validate_tar(p,'backup',source)
                self.assertEqual(r['generated_manifest_header'],dict(uid=2048,gid=1024,mode=expected,source_data_directory_mode=source))
                with self.assertRaisesRegex(RuntimeError,'ownership'):m.validate_tar(p,'sealed')
                archive(wrong)
                with self.assertRaisesRegex(RuntimeError,'ownership'):m.validate_tar(p,'backup',source)
            for mode in (None,'700','0777','0640'):
                with self.assertRaisesRegex(RuntimeError,'verified source'):m.validate_tar(p,'backup',mode)
            facts=self.facts()
            for mode in ('0700','0750'):self.assertEqual(m.validate_source_facts({**facts,'data_directory_mode':mode})['data_directory_mode'],mode)
            for mode in (None,'700','0777',0o700):
                with self.assertRaises(RuntimeError):m.validate_source_facts({**facts,'data_directory_mode':mode})

    def test_real_owner_refusal_retains_complete_private_metadata_after_archive_cleanup(self):
        from contextlib import redirect_stderr
        import os,stat
        public=io.StringIO();secret=b'never-copy-archive-file-contents-into-diagnostics'
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'backup.tar'
            with tarfile.open(p,'w') as out:
                for n,uid in [('base/123/456',99),('PG_VERSION',100),('global/pg_control',100),('backup_label',100),('backup_manifest',100),('last-header',100)]:
                    e=tarfile.TarInfo(n);e.uid=uid;e.gid=101;e.mode=0o640;e.size=len(secret);out.addfile(e,io.BytesIO(secret))
            with self.assertRaisesRegex(RuntimeError,'PGDATA ownership differs') as caught:m.validate_tar(p,'backup','0750')
            error=caught.exception
            receipt=m.failure_receipt(error,'physical-open',[])
            with redirect_stderr(public):m.emit([],receipt)
            diagnostic=receipt['archive_validation'];index=Path(diagnostic['private_metadata_path'])
            self.assertEqual(diagnostic['uid'],99);self.assertEqual(diagnostic['gid'],101)
            self.assertEqual(diagnostic['mode'],0o640);self.assertEqual(diagnostic['type'],ord('0'))
            self.assertEqual(diagnostic['escaped_name'],'"base/123/456"')
            self.assertTrue(diagnostic['metadata_complete']);self.assertEqual(diagnostic['metadata_members'],6)
            self.assertEqual(stat.S_IMODE(index.stat().st_mode),0o600)
            packet=index.read_bytes();self.assertEqual(m.hashlib.sha256(packet).hexdigest(),diagnostic['private_metadata_sha256'])
            self.assertNotIn(secret,packet);self.assertNotIn(secret.decode(),public.getvalue())
            self.assertEqual(json.loads(packet)['members'][-1]['name'],'last-header')
        self.assertTrue(index.exists());index.unlink()
        # Invalid paths are refused before ownership/name diagnostics; their names stay only in private index.
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'unsafe.tar';self.archive(p,{'/private-secret-path':b'invented'})
            with self.assertRaisesRegex(RuntimeError,'path/type') as caught:m.validate_tar(p,'backup','0700')
            receipt=m.failure_receipt(caught.exception,'physical-open',[])
            self.assertNotIn('/private-secret-path',json.dumps(receipt));self.assertNotIn('escaped_name',receipt['archive_validation'])
            Path(receipt['archive_validation']['private_metadata_path']).unlink()
        # Even a valid config path must not print private arbitrary config names.
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'config.tar'
            with tarfile.open(p,'w') as out:
                e=tarfile.TarInfo('etc/postgresql/private-secret-name.conf');e.uid=99;e.gid=101;out.addfile(e)
            with self.assertRaises(RuntimeError) as caught:m.validate_tar(p,'config')
            receipt=m.failure_receipt(caught.exception,'physical-open',[])
            self.assertNotIn('private-secret-name',json.dumps(receipt))
            self.assertEqual(receipt['archive_validation']['escaped_name'],'"<private-config-member>"')
            Path(receipt['archive_validation']['private_metadata_path']).unlink()

    def test_owned_root_mode_preparation_and_every_normal_start_require_source_identity(self):
        from types import SimpleNamespace
        for mode,crypto_mode in __import__('itertools').product(('0700','0750'),('PRESENT','ABSENT')):
            p=m.PhysicalCluster(self.source());p.source_mode=mode;p.crypto_mode=crypto_mode
            calls=[]
            def target(args,**kw):
                calls.append(args)
                return SimpleNamespace(stdout=('100:101:'+mode[1:]+'\n').encode() if args[0]=='stat' else b'',returncode=0)
            def sql(q,role):
                self.assertEqual(role,'supabase_admin')
                if q==m.SQL_CRYPTO_CAPABILITY_SQL:return json.dumps({key:self.facts()[key] for key in m.SQL_CRYPTO_FIELDS} if crypto_mode=='PRESENT' else dict(sodium_version=None,sodium_nonce_api=False,sodium_keyid_api=False,sodium_open_keyid_api=False))
                if 'data_directory_mode' in q:return mode
                if 'pg_is_in_recovery' in q:return 'f'
                if q==m.CRON_SQL:return json.dumps(dict(jobs=0,job_hash='j',schedules=[],runs=0,run_hash='r',pending=0,workers=0,schedulers=[[1,'1970-01-01T00:02:05+00:00']]))
                if 'clock_timestamp' in q:return '125'
                self.fail(q)
            with patch.object(p,'target',side_effect=target),patch.object(p,'sql',side_effect=sql) as sqlmock,patch.object(p,'admit_window',return_value=(125,10)),patch.object(p,'guard'),patch.object(m.time,'time',return_value=125):
                p.prepare_data_root();self.assertEqual(calls[0],['chmod',mode,m.DATA])
                for _ in range(2):
                    p.running=False;p.start()
                self.assertEqual(sum('data_directory_mode' in call.args[0] for call in sqlmock.call_args_list),2)
                self.assertEqual(sum(e.get('data_directory_mode_verified',False) for e in p.events),2)
                self.assertTrue(all(e['mode']==int(mode,8) for e in p.events if e.get('data_directory_mode_verified')))
            for badstat in ['0:101:'+mode[1:],'100:102:'+mode[1:],'100:101:'+('700' if mode=='0750' else '750')]:
                with patch.object(p,'target',return_value=SimpleNamespace(stdout=badstat.encode())) as t,self.assertRaisesRegex(RuntimeError,'data-root owner/mode'):p.start()
                self.assertEqual(t.call_count,1);self.assertEqual(t.call_args.args[0][0],'stat')
            with patch.object(p,'target',side_effect=target),patch.object(p,'sql',return_value='0750' if mode=='0700' else '0700'),patch.object(p,'admit_window',return_value=(125,10)),patch.object(p,'guard'),self.assertRaisesRegex(RuntimeError,'startup data-directory mode'):p.start()

    def test_actual_sealed_tar_reset_preserves_root_and_members_despite_restrictive_umask(self):
        import subprocess,os,stat
        from types import SimpleNamespace
        for mode in ('0700','0750'):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);data=root/'data';data.mkdir(mode=0o700);data.chmod(int(mode,8));private=root/'private';private.mkdir()
                binary=root/'bin';binary.mkdir();(binary/'tar').symlink_to('/usr/bin/busybox')
                archive=private/'sealed-canonical.tar'
                with tarfile.open(archive,'w') as out:
                    for name,content,directory in [('.',b'',True),('global',b'',True),('PG_VERSION',b'17',False),('global/pg_control',b'invented',False)]:
                        e=tarfile.TarInfo(name);e.uid=100;e.gid=101;e.mode=int(mode,8) if directory else (0o640 if mode=='0750' else 0o600)
                        if directory:e.type=tarfile.DIRTYPE
                        else:e.size=len(content)
                        out.addfile(e,io.BytesIO(content) if not directory else None)
                p=m.PhysicalCluster(self.source());p.root=private;p.source_mode=mode;p.crypto_mode='PRESENT';p.sealed=True;p.running=False;p.baseline=m.validate_tar(archive,'sealed')
                def target(args,input_file=None,**kw):
                    # Real HOST BusyBox executes the exact fixed wrapper with only its test-root path remapped.
                    if args==m.DATA_RESTORE_ARGS:
                        command=['/usr/bin/busybox','sh','-c',args[2].replace('/var/lib/postgresql/data',str(data))]
                    else:command=['/usr/bin/'+args[0],*args[1:]]
                    return subprocess.run(command,stdin=input_file or subprocess.DEVNULL,capture_output=True,check=True,umask=0o077,env={'PATH':str(binary)})
                def start():
                    p.start_wall=125
                    self.assertEqual(stat.S_IMODE(data.stat().st_mode),int(mode,8))
                    self.assertEqual(stat.S_IMODE((data/'PG_VERSION').stat().st_mode),0o640 if mode=='0750' else 0o600)
                with patch.object(m,'DATA',str(data)),patch.object(p,'target',side_effect=target),patch.object(p,'start',side_effect=start) as started,patch.object(p,'check_crypto_canary',return_value='PASSED'):
                    p.begin_trial();p.begin_trial();self.assertEqual(started.call_count,2)
        source=P.read_text()
        self.assertEqual(source.count('self.target(DATA_RESTORE_ARGS,input_file=data)'),2)
        self.assertEqual(m.DATA_RESTORE_ARGS,['sh','-c','umask 000; exec tar -C /var/lib/postgresql/data -xf - --no-same-owner --numeric-owner'])
        self.assertEqual(m.CONFIG_RESTORE_ARGS,['tar','-C','/','-xf','-','--numeric-owner'])
        self.assertLess(source.index('self.prepare_data_root()'),source.index('self.start(preparation=True)'))
        self.assertIn('self.data_root_identity()\n        archive=self.root',source)

    def test_actual_busybox_nonroot_default_and_p_flags_lose_group_permissions(self):
        import subprocess,os,stat
        self.assertNotEqual(os.getuid(),0,'This negative control requires the actual unprivileged host user')
        version=subprocess.run(['/usr/bin/busybox'],capture_output=True,text=True,check=True).stdout.splitlines()[0]
        self.assertRegex(version,r'^BusyBox v[0-9]+\.[0-9]+\.[0-9]+(?: \([^\r\n]*\))? multi-call binary\.$')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);archive=root/'owned.tar'
            with tarfile.open(archive,'w') as out:
                for name,directory in [('nested',True),('nested/file',False)]:
                    e=tarfile.TarInfo(name);e.uid=100;e.gid=101;e.mode=0o750 if directory else 0o640
                    if directory:e.type=tarfile.DIRTYPE;out.addfile(e)
                    else:e.size=1;out.addfile(e,io.BytesIO(b'x'))
            for i,flags in enumerate([[],['--no-same-owner'],['--no-same-owner','--same-permissions'],['--no-same-owner','-p']]):
                target=root/str(i);target.mkdir()
                with archive.open('rb') as stream:
                    result=subprocess.run(['/usr/bin/busybox','tar','-C',str(target),'-xf','-',*flags],stdin=stream,capture_output=True,check=True,umask=0o077)
                self.assertEqual(result.stderr,b'');self.assertEqual(stat.S_IMODE((target/'nested').stat().st_mode),0o700)
                self.assertEqual(stat.S_IMODE((target/'nested/file').stat().st_mode),0o600)
                self.assertEqual((target/'nested/file').stat().st_uid,os.getuid())
            # The failed flag is really unsupported by the same existing BusyBox version.
            result=subprocess.run(['/usr/bin/busybox','tar','--same-owner'],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0);self.assertIn('unrecognized option',result.stderr)

    def test_minute_deadline_and_wall_monotonic_continuity_are_real_guards(self):
        m.minute_guard(125,10,140,25)
        for endwall,endmono in [(170,55),(185,70),(124,9),(140,26)]:
            with self.subTest(endwall=endwall),self.assertRaises(RuntimeError):m.minute_guard(125,10,endwall,endmono)

    def test_exact_target_resource_custody_rejects_authority_expansion(self):
        import subprocess
        p=m.PhysicalCluster(self.source());p.cid='a'*64;p.image_id='sha256:'+'b'*64;p.target_labels=dict(p.labels)
        row=dict(Id=p.cid,Name='/'+p.name,Image=p.image_id,Config=dict(Labels=p.target_labels,User='100:101',Entrypoint=['/bin/sleep'],Cmd=['infinity']),
            State=dict(Running=True),HostConfig=dict(Init=True,NetworkMode='none',Privileged=False,ReadonlyRootfs=True,Memory=2147483648,NanoCpus=1000000000,PidsLimit=256,Tmpfs=dict(m.TMPFS)),
            NetworkSettings=dict(Networks={'none':{}},Ports={}),Mounts=[])
        def result(value):return subprocess.CompletedProcess([],0,stdout=json.dumps([value]).encode(),stderr=b'')
        with patch.object(p,'docker',return_value=result(row)):p.custody()
        for section,key,value in [('Config','User','0'),('Config','Labels',{}),('HostConfig','Init',False),('HostConfig','Memory',4294967296),('HostConfig','PidsLimit',512),
            ('HostConfig','NetworkMode','bridge'),('HostConfig','Binds',['/host:/target']),('HostConfig','ReadonlyRootfs',False),
            ('HostConfig','Tmpfs',{**m.TMPFS,m.DATA:m.TMPFS[m.DATA].replace('4294967296','8589934592')}),
            ('NetworkSettings','Ports',{'5432/tcp':[{'HostPort':'5432'}]})]:
            wrong=copy.deepcopy(row);wrong[section][key]=value
            with self.subTest(key=key),patch.object(p,'docker',return_value=result(wrong)),self.assertRaises(RuntimeError):p.custody()

    def test_stopped_owned_keeper_cleanup_skips_exec_and_foreign_identity_refuses(self):
        import subprocess
        for foreign in (False,True):
            p=m.PhysicalCluster(self.source());p.cid='a'*64;p.running=True;p.image_id='sha256:'+'b'*64;p.target_labels=dict(p.labels)
            row=dict(Id='b'*64 if foreign else p.cid,Name='/'+p.name,Image=p.image_id,Config=dict(Labels=p.target_labels,User='100:101',Entrypoint=['/bin/sleep'],Cmd=['infinity']),
                State=dict(Running=False,Status='exited',OOMKilled=True),HostConfig=dict(Init=True,NetworkMode='none',Privileged=False,ReadonlyRootfs=True,Memory=2147483648,NanoCpus=1000000000,PidsLimit=256,Tmpfs=dict(m.TMPFS)),
                NetworkSettings=dict(Networks={'none':{}},Ports={}),Mounts=[])
            operations=[]
            def docker(*args,**kwargs):
                operations.append(args)
                if args[0]=='inspect':return subprocess.CompletedProcess([],0,stdout=json.dumps([row]).encode(),stderr=b'')
                if args[0]in('rm','ps'):return subprocess.CompletedProcess([],0,stdout=b'',stderr=b'')
                self.fail('no stop or exec into dead owned keeper')
            with patch.object(p,'docker',side_effect=docker),patch.object(p,'stop') as stop:
                if foreign:
                    with self.assertRaises(RuntimeError):p.close()
                    self.assertFalse(any(x[0]=='rm' for x in operations))
                else:
                    with self.assertRaises(RuntimeError):p.target(['pg_ctl','status'])
                    p.close();self.assertIsNone(p.cid);self.assertFalse(p.running)
                    self.assertEqual(sum(x[0]=='rm'for x in operations),1)
                    self.assertTrue(p.events[-1]['absent']);self.assertFalse(p.events[0]['graceful_pg_stop'])
                stop.assert_not_called()

    def test_graceful_stop_failure_still_disposes_exact_owned_target_and_remains_failure(self):
        import subprocess
        p=m.PhysicalCluster(self.source());p.cid='a'*64;p.running=True
        states=[dict(running=True,status='running',oom_killed=False),dict(running=True,status='running',oom_killed=False),dict(running=False,status='exited',oom_killed=False)]
        result=subprocess.CompletedProcess([],0,stdout=b'',stderr=b'')
        with patch.object(p,'custody',side_effect=states),patch.object(p,'stop',side_effect=RuntimeError('4427 actual graceful failure')),patch.object(p,'docker',return_value=result) as docker:
            with self.assertRaisesRegex(RuntimeError,'actual graceful failure'):p.close()
            self.assertTrue(any(x.args[0]=='rm' for x in docker.call_args_list));self.assertIsNone(p.cid)
            self.assertTrue(p.events[-1]['absent'])

    def test_failure_diagnostics_are_private_and_never_inline_raw_stderr(self):
        import subprocess
        err=subprocess.CalledProcessError(3,['psql'],stderr='ERROR:  42501\nprivate external detail')
        receipt=m.failure_receipt(err,'fixture-stage',[{'absent':True}])
        self.assertFalse(receipt['qualification_passed']);self.assertEqual(receipt['external']['sqlstate'],'42501')
        path=Path(receipt['external']['private_stderr_path'])
        try:
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertEqual(path.read_text(),err.stderr)
            self.assertNotIn('private external detail',json.dumps(receipt))
        finally:path.unlink()

    def test_reset_requires_stopped_sealed_owned_target_before_command(self):
        p=m.PhysicalCluster(self.source())
        with patch.object(p,'target') as target:
            with self.assertRaises(RuntimeError):p.begin_trial()
            p.sealed=True;p.running=True
            with self.assertRaises(RuntimeError):p.begin_trial()
            target.assert_not_called()

    def test_measured_cost_admission_refuses_unbounded_full_matrix(self):
        p=m.PhysicalCluster(self.source())
        self.assertGreater(p.projected_matrix_check([1]*34),340)
        with self.assertRaisesRegex(RuntimeError,'cost exceeds'):p.projected_matrix_check([10]*34)
        for invalid in ([1]*33,[1]*35,[1]*33+[0],[1]*33+[True],[1]*33+[float('nan')]):
            with self.assertRaisesRegex(RuntimeError,'cost invalid'):p.projected_matrix_check(invalid)
        p.started-=2050
        with self.assertRaisesRegex(RuntimeError,'remaining bound'):p.projected_matrix_check([1]*34)

    def test_weighted_projection_counts_each_workload_ten_times_and_keeps_refusal_receipt(self):
        p=m.PhysicalCluster(self.source())
        costs=[1.0]*33+[4.0]
        actual=p.projected_matrix_check(costs)
        self.assertAlmostEqual(actual,10*sum(costs)*(60/35)+60)
        self.assertLess(actual,340*max(costs)*(60/35)+60)
        self.assertEqual(p.events[-1]['active_seconds'],costs)
        self.assertTrue(p.events[-1]['admitted'])
        self.assertAlmostEqual(p.projected_matrix_check([2.0]*34),340*2*(60/35)+60)
        p.started-=2050
        with self.assertRaisesRegex(RuntimeError,'remaining bound'):
            p.projected_matrix_check(costs)
        receipt=p.events[-1]
        self.assertFalse(receipt['admitted'])
        self.assertEqual(receipt['remaining_trials'],340)
        self.assertEqual(receipt['active_seconds'],costs)
        self.assertLess(receipt['remaining_budget_seconds'],50)

    def test_failed_stdout_is_private_bounded_and_full_digest_only_public(self):
        import hashlib,stat
        secret=b'private-output-secret'
        raw=secret+b'x'*70000
        receipt=m.capture_external(b'','psql',128,'target-trial',raw)
        try:
            retained=Path(receipt['private_stdout_path']).read_bytes()
            self.assertEqual(retained,raw[:65536])
            self.assertEqual(receipt['stdout_bytes'],len(raw))
            self.assertEqual(receipt['private_stdout_sha256'],hashlib.sha256(raw).hexdigest())
            self.assertEqual(stat.S_IMODE(Path(receipt['private_stdout_path']).stat().st_mode),0o600)
            self.assertNotIn(secret.decode(),json.dumps(receipt))
        finally:
            Path(receipt['private_stdout_path']).unlink()
            Path(receipt['private_stderr_path']).unlink()

    def test_docker_failure_keeps_private_stdout_receipt(self):
        import subprocess
        p=m.PhysicalCluster(self.source());p.root=Path('/tmp/fixed-owned-test')
        result=subprocess.CompletedProcess([],128,stdout=b'private-runtime-cause',stderr=b'')
        with patch.object(m.subprocess,'run',return_value=result):
            with self.assertRaisesRegex(RuntimeError,'owned physical operation failed') as caught:
                p.docker('exec','fixed-owned-id','psql')
        receipt=m.failure_receipt(caught.exception,'target-trial',[])
        external=receipt['physical_external']
        try:
            self.assertEqual(Path(external['private_stdout_path']).read_bytes(),result.stdout)
            self.assertNotIn('private-runtime-cause',json.dumps(receipt))
        finally:
            Path(external['private_stdout_path']).unlink()
            Path(external['private_stderr_path']).unlink()

    def test_native_capacity_is_explicit_bounded_and_all_elapsed_counts(self):
        self.assertEqual(m.PhysicalCluster(self.source()).budget,2100)
        p=m.PhysicalCluster(self.source(),budget_seconds=2700)
        self.assertEqual(p.budget,2700)
        p.started-=1000
        self.assertLess(p.projected_matrix_check([1]*34),1700)
        self.assertLess(p.events[-1]['remaining_budget_seconds'],1700)
        p.started-=1690
        with self.assertRaisesRegex(RuntimeError,'remaining bound'):p.projected_matrix_check([1]*34)
        for invalid in (0,-1,2701,True,float('inf'),float('nan'),'2700'):
            with self.subTest(invalid=invalid),self.assertRaisesRegex(RuntimeError,'budget invalid'):
                m.PhysicalCluster(self.source(),budget_seconds=invalid)

    def test_cleanup_survives_action_budget_expiry(self):
        p=m.PhysicalCluster(self.source());p.started=time.monotonic()-2200
        with self.assertRaises(RuntimeError):p.budget_check()
        p.cleanup_mode=True;p.budget_check()

    def test_original_unix_hba_denial_allow_denial_and_metadata_are_proven(self):
        import subprocess
        original=b'local all supabase_admin trust\nlocal all all peer\nhost all all 127.0.0.1/32 trust\n'
        class Source:
            restore_authority={'system_identifier':'123'}
            hba_window_active=False;hba_temporary_verified=False
            data=original;loaded=False;mode='755';owner='100:101'
            def source_checked(self,args,input_file=None,allowed_failure=False):
                self.asserted=m.source_command_kind(args)
                if self.asserted is None:raise AssertionError('unlisted source command')
                result=b''
                if args==m.HBA_READ_ARGS:result=self.data
                elif args==m.HBA_STAT_ARGS:result=('regular file:'+self.owner+':'+self.mode+':1').encode()
                elif args==m.HBA_APPEND_ARGS:
                    assert self.hba_window_active;self.data+=input_file.read()
                elif args==m.HBA_RESTORE_ARGS:
                    assert self.hba_window_active;self.data=input_file.read()
                elif args[0]=='chown':self.owner=args[1]
                elif args[0]=='chmod':self.mode=args[1]
                elif args==m.RELOAD_ARGS:self.loaded=m.HBA_LINE in self.data;result=b't\n'
                elif args==m.REPL_PROBE_ARGS:
                    if self.loaded:return subprocess.CompletedProcess(args,0,stdout=b'123|1|0/A|\n',stderr=b'')
                    return subprocess.CompletedProcess(args,2,stdout=b'',stderr=b'FATAL: no pg_hba.conf entry for replication connection from host "[local]", user "supabase_admin"')
                else:result=json.dumps(dict(recovery=False,superuser=True,slots=0,walsenders=0,roles='same',members='same',policies='same',objects='same')).encode()
                return subprocess.CompletedProcess(args,0,stdout=result,stderr=b'')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.archive(root/'source-config.tar',{'etc/postgresql/pg_hba.conf':original})
            source=Source();window=m.TemporaryUnixHba(source,root)
            source.source_backup_window=(125,10)
            with patch.object(m.time,'time',return_value=130),patch.object(m.time,'monotonic',return_value=15),self.assertRaisesRegex(RuntimeError,'synthetic backup failure'):
                with window:
                    self.assertTrue(source.hba_temporary_verified);self.assertEqual(source.data,original+m.HBA_LINE)
                    raise RuntimeError('synthetic backup failure')
            self.assertEqual(source.data,original);self.assertEqual(source.mode,'755');self.assertEqual(source.owner,'100:101')
            self.assertFalse(source.loaded);self.assertFalse(source.hba_window_active)
            self.assertEqual([r['physical_identify_state'] for r in window.events if 'physical_identify_state' in r],['HBA_ABSENT','ALLOWED','HBA_ABSENT'])
            self.assertTrue(window.events[-1]['original_hba_restored'])
            self.assertEqual((root/'source-original-hba').read_bytes(),original)

    def test_existing_replication_deny_and_hba_indirection_cannot_be_overridden(self):
        valid=b'local all supabase_admin trust\n'
        m.validate_missing_unix_hba(valid)
        for extra in (b'local replication supabase_admin reject\n',b'local replication all trust\n',b'include /external/file\n',b'local all @users trust\n',b'local "replication" supabase_admin trust\n',b'local all "all" trust\n'):
            with self.subTest(extra=extra),self.assertRaises(RuntimeError):m.validate_missing_unix_hba(valid+extra)
        self.assertIsNone(m.source_command_kind(['sh','-c','arbitrary']))
        self.assertIsNone(m.source_command_kind(['chmod','777',m.HBA_PATH]))
        self.assertEqual(m.source_command_kind(['chmod','755',m.HBA_PATH]),'hba-metadata')
        self.assertEqual(m.BACKUP_ARGS[m.BACKUP_ARGS.index('-h')+1],'/var/run/postgresql')

    def test_canary_uses_only_root_derived_bigint_api_and_never_outputs_root(self):
        self.assertIn('4427::bigint',m.CANARY_CREATE_SQL)
        self.assertIn('crypto_secretbox_open',m.CANARY_CHECK_SQL)
        self.assertNotIn('derive_key',m.CANARY_CREATE_SQL+m.CANARY_CHECK_SQL)
        self.assertNotIn('pgsodium_root.key',m.CANARY_CREATE_SQL+m.CANARY_CHECK_SQL)


if __name__=='__main__':unittest.main()
