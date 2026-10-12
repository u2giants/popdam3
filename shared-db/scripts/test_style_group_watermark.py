#!/usr/bin/env python3
"""Synthetic #2421 contracts; only a new network-isolated disposable PostgreSQL.

No URLs, credentials, remote targets, mounted directories or host ports accepted.
The original recovery function, concurrency boundary and actual scan work are tested.
"""
import json
import pathlib
import subprocess
import time
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20261012012727_style_group_change_watermark.sql'
KEY = "hashtext('style-group-change-clock-2421')"


class WatermarkContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.name = 'codex-2421-' + uuid.uuid4().hex[:12]
        subprocess.run(['docker', 'run', '-d', '--rm', '--network=none', '--name', cls.name,
                        '--label', 'codex.issue2421.disposable=true', '-e',
                        'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17'], check=True,
                       stdout=subprocess.DEVNULL)
        cls.addClassCleanup(lambda: subprocess.run(['docker', 'rm', '-f', cls.name],
                            check=False, stdout=subprocess.DEVNULL))
        for _ in range(100):
            if subprocess.run(['docker', 'exec', cls.name, 'psql', '-U', 'postgres', '-qAt', '-c', 'SELECT 1'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.05)
        time.sleep(.5)
        cls.guard()
        textcols = ['relative_path','filename','file_type','licensor_code','licensor_name',
                    'property_code','property_name','product_category','division_code',
                    'division_name','mg01_code','mg01_name','mg02_code','mg02_name',
                    'mg03_code','mg03_name','size_code','size_name']
        tax = ','.join(x+' text' for x in textcols[3:])
        cls.sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
          CREATE TABLE assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), style_group_id uuid,
            is_deleted boolean DEFAULT false, is_licensed boolean DEFAULT false,
            licensor_id uuid, property_id uuid, quick_hash text, modified_at timestamptz,'''
            + ','.join(x+' text' for x in textcols) + ''');
          CREATE INDEX ON assets(style_group_id);
          CREATE TABLE style_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text UNIQUE,
            folder_path text, is_licensed boolean DEFAULT false, licensor_id uuid, property_id uuid,
            updated_at timestamptz DEFAULT now(),asset_count integer DEFAULT 0,'''+tax+''');
          CREATE TABLE style_group_tags(style_group_id uuid REFERENCES style_groups(id),tag text,
            status text,category text,source text);
          CREATE TABLE admin_config(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
          CREATE FUNCTION refresh_style_group_counts_batch(uuid[]) RETURNS integer
            LANGUAGE sql AS 'SELECT 0';''')
        old = (ROOT / 'supabase/migrations/20260925061508_style_group_shared_derivation.sql')
        if not old.exists():
            old = next((ROOT / 'supabase/migrations').glob('20260925061508*'))
        source = old.read_text()
        source = source[:source.lower().index('create or replace function public.reconcile')]
        cls.sql(source)
        baseline = (ROOT / 'supabase/ci-bootstrap/010_pre_adoption_baseline.sql').read_text()
        start = baseline.rindex('CREATE OR REPLACE FUNCTION public.clear_style_group_batch(')
        cls.sql(baseline[start:baseline.index('$function$;', start)+len('$function$;')])
        queue = next((ROOT / 'supabase/migrations').glob('20260909005945*')).read_text()
        start = queue.lower().index('create or replace function public.queue_nightly_rebuild_style_groups()')
        queue = queue[start:queue.index('$function$;', start)+len('$function$;')]
        cls.sql(queue)
        cls.old_recovery = cls.sql("SELECT md5(pg_get_functiondef('rebuild_style_groups_batch(uuid,integer)'::regprocedure));")
        cls.sql(MIGRATION.read_text())
        cls.queue = cls.sql("SELECT pg_get_functiondef('queue_nightly_rebuild_style_groups()'::regprocedure);").replace(
            'c_enqueue_hour  constant integer := 6', 'c_enqueue_hour  constant integer := 0')
        cls.sql(cls.queue)

    @classmethod
    def guard(cls):
        state = json.loads(subprocess.check_output(['docker','inspect',cls.name], text=True))[0]
        if state['HostConfig']['NetworkMode'] != 'none' or state['HostConfig']['Binds'] or state['HostConfig']['PortBindings'] or any(m['Type'] != 'volume' or m['Destination'] != '/var/lib/postgresql/data' for m in state['Mounts']):
            raise RuntimeError('REFUSED: fixture target is not an isolated, unmounted local container')
        if state['Config']['Labels'].get('codex.issue2421.disposable') != 'true':
            raise RuntimeError('REFUSED: fixture ownership label absent')

    @classmethod
    def process(cls, query):
        cls.guard()
        p = subprocess.Popen(['docker','exec','-i',cls.name,'psql','-X','-qAt','-U','postgres',
                              '-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE,text=True)
        p.stdin.write(query); p.stdin.close(); p.stdin = None
        return p

    @classmethod
    def sql(cls, query):
        p = cls.process(query)
        out, err = p.communicate(timeout=20)
        if p.returncode:
            raise AssertionError(err)
        return out.strip()

    def setUp(self):
        self.sql('TRUNCATE style_group_tags,assets,style_groups,admin_config;')
        self.sql(self.queue)
        self.sql("CREATE OR REPLACE FUNCTION refresh_style_group_counts_batch(uuid[]) RETURNS integer LANGUAGE sql AS 'SELECT 0';")

    def wait_for(self, query):
        for _ in range(80):
            if self.sql(query) == 't': return
            time.sleep(.025)
        self.fail('concurrent fixture did not reach expected state')

    def test_rollback_contracts_and_original_recovery(self):
        self.assertEqual(self.sql("SELECT md5(pg_get_functiondef('rebuild_style_groups_batch(uuid,integer)'::regprocedure));"), self.old_recovery)
        self.sql((ROOT / 'supabase/tests/style_group_change_watermark_contracts.sql').read_text())

    def test_prior_writer_commits_before_cutoff(self):
        writer = self.process("BEGIN; INSERT INTO assets(filename,relative_path) VALUES('race','race'); SELECT pg_sleep(1); COMMIT;")
        self.wait_for("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND objid="+KEY+"::oid);")
        before = time.monotonic()
        self.sql('SELECT queue_nightly_rebuild_style_groups();')
        self.assertGreater(time.monotonic()-before, .3)
        out, err = writer.communicate(timeout=5)
        self.assertEqual(writer.returncode, 0, err)
        self.assertEqual(self.sql("SELECT (value->'style-group-change-watermark'->>'pending_cutoff')::timestamptz >= (SELECT max(style_group_changed_at) FROM assets) FROM admin_config;"),'t')

    def test_later_writer_survives_queue_commit_race(self):
        queue = self.process('BEGIN; SELECT queue_nightly_rebuild_style_groups(); SELECT pg_sleep(1); COMMIT;')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE query LIKE '%SELECT pg_sleep(1)%' AND wait_event='PgSleep');")
        before = time.monotonic()
        self.sql("INSERT INTO assets(filename,relative_path) VALUES('later','later');")
        self.assertLess(time.monotonic()-before, .6)
        out, err = queue.communicate(timeout=5)
        self.assertEqual(queue.returncode,0,err)
        self.assertEqual(self.sql("SELECT (SELECT max(style_group_changed_at) FROM assets) > (value->'style-group-change-watermark'->>'pending_cutoff')::timestamptz FROM admin_config;"),'t')

    def test_spanning_writer_cannot_publish_an_earlier_cutoff(self):
        writer = self.process("BEGIN; INSERT INTO assets(filename,relative_path) VALUES('spanning','AAA2421AA/file'); SELECT pg_sleep(1); COMMIT;")
        self.wait_for("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND objid="+KEY+"::oid);")
        queue = self.process('SELECT queue_nightly_rebuild_style_groups();')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted AND objid="+KEY+"::oid);")
        # There can be no worker run spanning this writer: its run and cutoff
        # cannot be published until the writer's transaction has committed.
        self.assertEqual(self.sql("SELECT NOT EXISTS(SELECT FROM admin_config WHERE key='BULK_OPERATIONS');"), 't')
        for process in (writer, queue):
            out, err = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, err)
        self.assertEqual(self.sql("SELECT (value->'style-group-change-watermark'->>'pending_cutoff')::timestamptz >= (SELECT style_group_changed_at FROM assets WHERE filename='spanning') FROM admin_config;"), 't')
        self.assertEqual(self.sql("SELECT rows_examined FROM rebuild_style_groups_batch(NULL,100,clock_timestamp()-interval '1 day');"), '1')

    def completed_state(self):
        self.sql("""INSERT INTO style_groups(sku) VALUES('AAA2421AA');
          INSERT INTO admin_config VALUES('BULK_OPERATIONS',jsonb_build_object(
            'rebuild-style-groups',jsonb_build_object('status','completed','run_id','ack-fixture',
              'params',jsonb_build_object('watermark_protocol',1,'changed_cutoff','2026-10-11T01:00:00Z')),
            'style-group-change-watermark',jsonb_build_object('pending_run_id','ack-fixture',
              'pending_cutoff','2026-10-11T01:00:00+00:00','pending_mode','full'),
            'style-group-counts-reconcile',jsonb_build_object('last_enqueued_at',clock_timestamp())),now());""")

    def test_concurrent_queue_retains_transaction_lock_during_counts(self):
        self.completed_state()
        self.sql("CREATE OR REPLACE FUNCTION refresh_style_group_counts_batch(uuid[]) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN 0; END $$;")
        first = self.process('SELECT queue_nightly_rebuild_style_groups();')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE query='SELECT queue_nightly_rebuild_style_groups();' AND wait_event='PgSleep');")
        second = self.process('SELECT queue_nightly_rebuild_style_groups();')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=hashtext('BULK_OPERATIONS')::oid);")
        for process in (first, second):
            out, err = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, err)
        self.assertEqual(self.sql("SELECT value->'style-group-change-watermark'->>'last_successful_run_id' FROM admin_config;"), 'ack-fixture')
        self.assertEqual(self.sql("SELECT value->'style-group-change-watermark'->>'pending_run_id' FROM admin_config;"), 'ack-fixture')

    def test_external_pending_update_survives_counts_and_ack(self):
        self.completed_state()
        self.sql("CREATE OR REPLACE FUNCTION refresh_style_group_counts_batch(uuid[]) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN 0; END $$;")
        queue = self.process('SELECT queue_nightly_rebuild_style_groups();')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE query='SELECT queue_nightly_rebuild_style_groups();' AND wait_event='PgSleep');")
        self.sql("UPDATE admin_config SET value=jsonb_set(value,'{style-group-change-watermark}',jsonb_build_object('pending_run_id','external-run','pending_cutoff','2026-10-11T02:00:00Z','pending_mode','incremental')) WHERE key='BULK_OPERATIONS';")
        out, err = queue.communicate(timeout=5)
        self.assertEqual(queue.returncode, 0, err)
        self.assertEqual(self.sql("SELECT value->'style-group-change-watermark'->>'pending_run_id' FROM admin_config;"), 'external-run')
        self.assertEqual(self.sql("SELECT value->'style-group-change-watermark'->>'pending_cutoff' FROM admin_config;"), '2026-10-11T02:00:00Z')

    def test_invalid_batch_sizes_refuse_without_mutation(self):
        for size in ('0', '-1', 'NULL'):
            self.sql("DO $$ BEGIN BEGIN PERFORM rebuild_style_groups_batch(NULL,"+size+",NULL); RAISE EXCEPTION 'invalid batch accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END; END $$;")
        self.assertEqual(self.sql('SELECT count(*) FROM assets;'), '0')

    def test_exact_installed_probe_rejects_wrong_objects(self):
        self.sql("""CREATE SCHEMA supabase_migrations;
          CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
          INSERT INTO supabase_migrations.schema_migrations VALUES('20261012012727');
          CREATE INDEX assets_style_group_id_active_idx ON assets(style_group_id,id)
            WHERE is_deleted=false AND style_group_id IS NOT NULL;
          REVOKE ALL ON FUNCTION queue_nightly_rebuild_style_groups() FROM PUBLIC,anon,authenticated;
          GRANT EXECUTE ON FUNCTION queue_nightly_rebuild_style_groups() TO service_role;
        """)
        probe = (ROOT / '.github/live-proofs/2421.sql').read_text()
        # Exact identity uses the unmodified committed queue, not the
        # enqueue-hour-zero behavior fixture used by the concurrency tests.
        migration = MIGRATION.read_text()
        start = migration.lower().index('create or replace function public.queue_nightly_rebuild_style_groups()')
        self.sql(migration[start:])
        self.assertEqual(self.sql(probe), 't')
        for mutation in (
            "ALTER INDEX assets_style_group_changed_at_idx RENAME TO preserved_clock_index; CREATE INDEX assets_style_group_changed_at_idx ON assets(id);",
            "ALTER TABLE assets DISABLE TRIGGER assets_style_group_change_clock;",
            "GRANT EXECUTE ON FUNCTION rebuild_style_groups_batch(uuid,integer,timestamptz) TO authenticated;",
            "ALTER FUNCTION stamp_style_group_asset_change() RESET search_path;",
            "ALTER FUNCTION rebuild_style_groups_batch(uuid,integer,timestamptz) STABLE;",
            "ALTER TABLE assets ALTER COLUMN style_group_changed_at DROP DEFAULT;",
            "DROP FUNCTION clear_style_group_batch(uuid,integer);",
            "ALTER FUNCTION style_group_key_for_sku(text) VOLATILE;",
            "ALTER FUNCTION style_group_key_for_sku(text) PARALLEL UNSAFE;",
            "DROP FUNCTION rebuild_style_groups_batch(uuid,integer,timestamptz); CREATE FUNCTION rebuild_style_groups_batch(uuid,integer,timestamptz) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public SET statement_timeout='120s' SET lock_timeout='0' AS 'SELECT 0'; REVOKE ALL ON FUNCTION rebuild_style_groups_batch(uuid,integer,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION rebuild_style_groups_batch(uuid,integer,timestamptz) TO service_role;",
        ):
            self.assertEqual(self.sql('BEGIN; '+mutation+'\n'+probe+'; ROLLBACK;'), 'f')
        self.sql(self.queue)
        self.assertEqual(self.sql(probe), 'f', 'a modified queue body must not pass exact installed identity')
        self.sql('DROP SCHEMA supabase_migrations CASCADE; DROP INDEX assets_style_group_id_active_idx;')

    def test_exception_classes_and_reentrant_balance(self):
        for code in ('57014','P0004','XX000'):
            broken = self.queue.replace('v_cutoff := clock_timestamp();', "RAISE EXCEPTION 'synthetic' USING ERRCODE = '"+code+"';")
            self.sql(broken)
            self.sql("DO $$ BEGIN BEGIN PERFORM queue_nightly_rebuild_style_groups(); EXCEPTION WHEN SQLSTATE '"+code+"' THEN NULL; END; IF EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND mode='ExclusiveLock' AND objid="+KEY+"::oid) THEN RAISE EXCEPTION 'leaked cutoff lock'; END IF; END $$;")
        self.sql(self.queue)
        self.sql("DO $$ BEGIN PERFORM pg_advisory_lock("+KEY+"); PERFORM queue_nightly_rebuild_style_groups(); IF NOT pg_advisory_unlock("+KEY+") OR pg_advisory_unlock("+KEY+") THEN RAISE EXCEPTION 'unbalanced reentrant cutoff lock'; END IF; END $$;")

    def test_real_cancellation_releases_session_lock(self):
        self.sql(self.queue.replace('v_cutoff := clock_timestamp();', 'PERFORM pg_sleep(5); v_cutoff := clock_timestamp();'))
        waiting = self.process("DO $$ BEGIN BEGIN PERFORM queue_nightly_rebuild_style_groups(); EXCEPTION WHEN query_canceled THEN NULL; END; IF EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND mode='ExclusiveLock' AND objid="+KEY+"::oid) THEN RAISE EXCEPTION 'actual cancellation leaked cutoff'; END IF; END $$;")
        self.wait_for("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND objid="+KEY+"::oid);")
        self.sql("SELECT pg_cancel_backend(pid) FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND objid="+KEY+"::oid;")
        out, err = waiting.communicate(timeout=5)
        self.assertEqual(waiting.returncode, 0, err)

    def test_counts_callback_does_not_hold_cutoff(self):
        self.sql("CREATE OR REPLACE FUNCTION refresh_style_group_counts_batch(uuid[]) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND mode='ExclusiveLock' AND objid="+KEY+"::oid) THEN RAISE EXCEPTION 'counts callback holds cutoff'; END IF; RETURN cardinality($1); END $$;")
        self.sql("INSERT INTO style_groups(sku) VALUES('AAA2421AA'); INSERT INTO admin_config VALUES('BULK_OPERATIONS', jsonb_build_object('rebuild-style-groups',jsonb_build_object('status','completed','run_id','counts-fixture'),'style-group-counts-reconcile',jsonb_build_object('last_enqueued_at',now())),now()); SELECT queue_nightly_rebuild_style_groups();")
        self.assertEqual(self.sql("SELECT value->'style-group-counts-reconcile'->>'last_reconciled_run_id' FROM admin_config;"), 'counts-fixture')
        self.sql("CREATE OR REPLACE FUNCTION refresh_style_group_counts_batch(uuid[]) RETURNS integer LANGUAGE sql AS 'SELECT 0';")

    def test_physical_candidate_work(self):
        self.sql("INSERT INTO style_groups(id,sku) VALUES('00000000-0000-4000-8000-000000000001','AAA2421AA'); INSERT INTO assets(id,filename,relative_path,style_group_id) SELECT lpad(to_hex(n),32,'0')::uuid,'asset','AAA2421AA/asset','00000000-0000-4000-8000-000000000001' FROM generate_series(1,10000)n; ANALYZE assets; ANALYZE style_groups;")
        cutoff = self.sql('SELECT clock_timestamp();')
        self.sql("INSERT INTO assets(id,filename,relative_path) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffc1','null','plain'); ANALYZE assets;")
        source = MIGRATION.read_text()
        candidate = source[source.index('WITH changed_groups AS MATERIALIZED ('):source.index('  asset_skus AS (')].rstrip().rstrip(',')
        candidate = candidate.replace('p_changed_since', "'"+cutoff+"'::timestamptz").replace('p_last_asset_id','NULL::uuid').replace('p_batch_size','100')
        plan = json.loads(self.sql('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+candidate+' SELECT count(*) FROM asset_batch;'))[0]['Plan']
        def scans(node):
            total = 0
            if node.get('Relation Name') == 'assets' and not node.get('Plans'):
                total += (node['Actual Rows']+node.get('Rows Removed by Filter',0))*node['Actual Loops']
            return total+sum(scans(p) for p in node.get('Plans',[]))
        work = scans(plan)
        self.assertLess(work, 500, 'differential selection still examined the old full population')
        print('candidate physical asset rows examined:',work,'old population: 10001')


if __name__ == '__main__':
    unittest.main(verbosity=2)
