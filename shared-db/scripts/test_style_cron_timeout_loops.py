#!/usr/bin/env python3
"""u2giants/popdam3#804 contracts on a new network-isolated disposable PostgreSQL 17.

No URLs, credentials, remote targets, mounted directories or host ports accepted.
Each psql -c is one simple-protocol string, the way pg_cron sends a job command.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import time
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20261105165947_style_cron_timeout_retry_loops.sql'
# popdam3#804 task 4 replaced the library snapshot gate (signature only, no 6-hour
# maximum staleness) and moved the prewarm job to every 15 minutes. Replayed on top so
# the gate assertions below describe the function at head.
SNAPSHOT_GATE = ROOT / 'supabase/migrations/20261111162335_popsg_prewarm_interval_snapshot_signature_only.sql'
WRAPPER = ROOT / 'supabase/migrations/20261027012301_popsg_semantic_search_foundation.sql'
PREWARM_CADENCE = ROOT / 'supabase/migrations/20261113043850_popsg_prewarm_every_10_minutes.sql'
ACK = "SELECT value->'style-group-counts-reconcile' FROM admin_config WHERE key='BULK_OPERATIONS'"
REFRESHES = "SELECT count(*) FROM calls WHERE step IS NULL"

FIXTURE = r'''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY, jobname text, schedule text, command text,
  active boolean DEFAULT true, username text DEFAULT 'postgres', database text DEFAULT current_database());
CREATE TABLE cron.job_run_details(jobid bigint, status text, start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.alter_job(job_id bigint, command text DEFAULT NULL, schedule text DEFAULT NULL)
  RETURNS void LANGUAGE sql AS
  $$ UPDATE cron.job SET command = coalesce(alter_job.command, cron.job.command),
                         schedule = coalesce(alter_job.schedule, cron.job.schedule) WHERE jobid = job_id $$;
INSERT INTO cron.job(jobid,jobname,schedule,command) VALUES
  (9,'refresh-style-guide-matviews','7 * * * *','SELECT public.refresh_style_guide_matviews();'),
  (12,'refresh-style-guide-library-default-snapshot','*/15 * * * *','select public.refresh_style_guide_library_default_snapshot()'),
  (13,'prewarm-style-guide-search','*/5 * * * *','select public.prewarm_style_guide_search()');
CREATE TABLE admin_config(key text PRIMARY KEY, value jsonb, updated_at timestamptz, updated_by uuid);
CREATE TABLE style_groups(id uuid PRIMARY KEY, asset_count int DEFAULT 0);
CREATE TABLE style_guide_files(id serial PRIMARY KEY, name text);
CREATE TABLE style_guide_render_queue(id serial PRIMARY KEY);
CREATE TABLE style_guide_search_documents(id serial PRIMARY KEY);
CREATE TABLE style_guide_crawl_runs(id uuid PRIMARY KEY, lifecycle_state text, ingest_completed_at timestamptz,
  refresh_started_at timestamptz, refresh_completed_at timestamptz);
CREATE TABLE calls(id bigserial PRIMARY KEY, step text, ids uuid[]);
CREATE TABLE cfg(sleep_s float8);
INSERT INTO cfg VALUES (0);
CREATE MATERIALIZED VIEW style_guide_library_default_guides AS SELECT clock_timestamp() t, 1 k;
CREATE UNIQUE INDEX ON style_guide_library_default_guides(k);
CREATE MATERIALIZED VIEW style_guide_library_default_summary AS SELECT clock_timestamp() t, 1 k;
CREATE UNIQUE INDEX ON style_guide_library_default_summary(k);
CREATE FUNCTION refresh_style_group_counts_batch(p uuid[]) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(sleep_s) FROM cfg;
  INSERT INTO calls(ids) VALUES (p);
  RETURN cardinality(p);
END $$;
CREATE FUNCTION refresh_style_guide_matviews(p_run_id uuid, p_search_batch_size int, p_step text)
RETURNS TABLE(refreshed_at timestamptz, search_documents_synced int) LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO calls(step) VALUES (p_step);
  RETURN QUERY SELECT now(), 0;
END $$;
'''


class Contracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.name = 'style-cron-804-' + uuid.uuid4().hex[:12]
        subprocess.run(['docker', 'run', '-d', '--rm', '--network=none', '--name', cls.name,
                        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17'],
                       check=True, stdout=subprocess.DEVNULL)
        cls.addClassCleanup(lambda: subprocess.run(['docker', 'rm', '-f', cls.name],
                            check=False, stdout=subprocess.DEVNULL))
        for _ in range(200):
            if subprocess.run(['docker', 'exec', cls.name, 'psql', '-h', '127.0.0.1', '-U', 'postgres',
                               '-qAt', '-c', 'SELECT 1'], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.1)
        cls.sql(FIXTURE)
        body = re.search(r"refresh_style_guide_matviews\(\s*p_run_id uuid DEFAULT NULL::uuid.*?AS \$\$(.*?)\$\$",
                         WRAPPER.read_text(), re.S | re.I)
        if body:
            wrapper = body.group(1)
        else:
            wrapper = re.search(r"p_search_batch_size integer default 5000\s*\)\s*returns table.*?as \$function\$(.*?)\$function\$",
                                WRAPPER.read_text(), re.S | re.I).group(1)
        cls.sql('CREATE FUNCTION refresh_style_guide_matviews(p_run_id uuid DEFAULT NULL, '
                'p_search_batch_size int DEFAULT 5000) RETURNS TABLE(refreshed_at timestamptz, '
                'search_documents_synced int) LANGUAGE plpgsql SECURITY DEFINER AS $w$' + wrapper + '$w$')
        cls.sql(MIGRATION.read_text())
        cls.sql(SNAPSHOT_GATE.read_text())
        cls.sql(PREWARM_CADENCE.read_text())

    @classmethod
    def sql(cls, text, check=True):
        result = subprocess.run(['docker', 'exec', '-i', cls.name, 'psql', '-h', '127.0.0.1', '-U', 'postgres',
                                 '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                                input=text, text=True, capture_output=True)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    @classmethod
    def simple(cls, text):
        """One simple-protocol string, as pg_cron sends it."""
        return subprocess.run(['docker', 'exec', cls.name, 'psql', '-h', '127.0.0.1', '-U', 'postgres',
                               '-qAt', '-c', text], text=True, capture_output=True)

    def reset(self, op, groups=5):
        self.sql(f'''TRUNCATE calls; UPDATE cfg SET sleep_s=0; TRUNCATE style_groups;
          INSERT INTO style_groups(id) SELECT gen_random_uuid() FROM generate_series(1,{groups});
          DELETE FROM admin_config;
          INSERT INTO admin_config(key,value,updated_at) VALUES ('BULK_OPERATIONS',
            '{json.dumps(op)}'::jsonb, now());''')

    def marker(self):
        return json.loads(self.sql(ACK))

    def ids_seen(self):
        return self.sql('SELECT count(x), count(DISTINCT x) FROM calls, unnest(ids) x WHERE ids IS NOT NULL')

    def completed(self, run='11111111-1111-1111-1111-111111111111'):
        # Past 06:00 UTC never enqueues here because last_enqueued_at is today.
        return {'rebuild-style-groups': {'status': 'completed', 'run_id': run,
                                         'updated_at': '2026-11-05T10:42:44Z'},
                'style-group-counts-reconcile': {'last_enqueued_at': self.sql("SELECT now()"),
                                                 'last_reconciled_run_id': 'older',
                                                 'last_reconciled_at': self.sql("SELECT now()")}}

    def drain(self, passes=1):
        for _ in range(passes):
            self.sql('SELECT queue_nightly_rebuild_style_groups()')

    def budget_exhausted_pass(self):
        """Exhaust the pass budget before any chunk by back-dating nothing: patch the budget."""
        return self.sql("SELECT pg_get_functiondef('queue_nightly_rebuild_style_groups()'::regprocedure)")

    def with_budget(self, seconds):
        src = self.budget_exhausted_pass().replace("interval '60 seconds'", f"interval '{seconds} seconds'")
        self.assertIn(f"interval '{seconds} seconds'", src)
        self.sql(src)
        self.addCleanup(lambda: self.sql(self.budget_exhausted_pass().replace(
            f"interval '{seconds} seconds'", "interval '60 seconds'")))

    def test_walk_resumes_without_skips_and_stamps_only_at_the_end(self):
        self.reset(self.completed(), groups=450)
        self.sql('UPDATE cfg SET sleep_s=0.4')
        self.with_budget(0.5)
        self.drain()
        first = self.marker()
        self.assertIn('reconcile_walk', first)
        self.assertEqual(first['last_reconciled_run_id'], 'older', 'no stamp before the full walk')
        self.assertLess(int(self.ids_seen().split('|')[0]), 450)
        for _ in range(8):
            if 'reconcile_walk' not in self.marker():
                break
            self.drain()
        done = self.marker()
        self.assertNotIn('reconcile_walk', done)
        self.assertEqual(done['last_reconciled_run_id'], '11111111-1111-1111-1111-111111111111')
        self.assertEqual(done['last_reconcile_reason'], 'rebuild_completed')
        self.assertEqual(done['last_reconcile_rows_written'], 450)
        self.assertEqual(self.ids_seen(), '450|450', 'every group exactly once')

    def test_single_pass_keeps_original_stamp_semantics(self):
        op = self.completed()
        self.reset(op, groups=3)
        now = self.sql('BEGIN; SELECT queue_nightly_rebuild_style_groups(); SELECT now(); COMMIT;').splitlines()[-1]
        done = self.marker()
        self.assertEqual(done['last_reconciled_at'], now)
        self.assertEqual(done['last_reconcile_trigger_status'], 'completed')
        self.assertEqual(done['last_reconcile_rows_written'], 3)
        self.assertNotIn('reconcile_walk', done)

    def test_new_operation_state_restarts_the_walk(self):
        self.reset(self.completed(), groups=450)
        self.sql('UPDATE cfg SET sleep_s=0.4')
        self.with_budget(0.5)
        self.drain()
        cursor = self.marker()['reconcile_walk']['after_id']
        self.assertIsNotNone(cursor)
        # In flight: no counts mid-rebuild and the cursor stays parked.
        self.sql("""UPDATE admin_config SET value = jsonb_set(value,'{rebuild-style-groups}',
          value->'rebuild-style-groups' || '{"status":"running","updated_at":"2099-01-01T00:00:00Z"}')
          WHERE key='BULK_OPERATIONS'; TRUNCATE calls""")
        self.drain()
        self.assertEqual(self.sql('SELECT count(*) FROM calls'), '0')
        # A new completed run must walk from the first group again.
        self.sql("""UPDATE cfg SET sleep_s=0; UPDATE admin_config SET value = jsonb_set(value,'{rebuild-style-groups}',
          value->'rebuild-style-groups' || '{"status":"completed","run_id":"22222222-2222-2222-2222-222222222222","updated_at":"2099-01-01T00:00:01Z"}')
          WHERE key='BULK_OPERATIONS'""")
        self.drain()
        self.assertEqual(self.ids_seen(), '450|450')
        self.assertEqual(self.marker()['last_reconciled_run_id'], '22222222-2222-2222-2222-222222222222')

    def test_lock_order_is_preserved(self):
        src = MIGRATION.read_text()
        body = src[src.index('function public.queue_nightly_rebuild_style_groups'):]
        clock = body.index("pg_advisory_lock(hashtext('style-group-change-clock-2421'))")
        bulk = body.index("pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'))")
        self.assertLess(clock, bulk)
        self.assertNotIn('offset', re.sub(r'--.*', '', body).lower().split('c_pass_budget')[-1])

    def test_set_local_extends_the_job_timer_but_function_set_does_not(self):
        self.sql("ALTER SYSTEM SET statement_timeout='1s'; SELECT pg_reload_conf();")
        self.addCleanup(lambda: self.sql("ALTER SYSTEM RESET statement_timeout; SELECT pg_reload_conf();"))
        time.sleep(.5)
        self.sql("""SET statement_timeout=0; CREATE OR REPLACE FUNCTION fset() RETURNS void LANGUAGE plpgsql
          SET statement_timeout='10min' AS $$ BEGIN PERFORM pg_sleep(2); END $$;""")
        self.assertIn('statement timeout', self.simple('select pg_sleep(2)').stderr)
        self.assertIn('statement timeout', self.simple('select fset()').stderr)
        good = self.simple("set local statement_timeout = '10min'; select pg_sleep(2)")
        self.assertEqual(good.returncode, 0, good.stderr)
        self.assertNotIn('statement timeout', good.stderr)

    def test_job_commands_and_prewarm_untouched(self):
        rows = dict(line.split('|', 1) for line in
                    self.sql('SELECT jobname, command FROM cron.job').splitlines())
        self.assertIn("statement_timeout = '10min'", rows['refresh-style-guide-matviews'])
        self.assertIn("statement_timeout = '10min'", rows['refresh-style-guide-library-default-snapshot'])
        self.assertEqual(rows['prewarm-style-guide-search'], 'select public.prewarm_style_guide_search()')
        self.assertEqual(self.sql("SELECT schedule FROM cron.job WHERE jobname='prewarm-style-guide-search'"),
                         '4-59/10 * * * *')

    def library_refreshed_at(self):
        return self.sql("SELECT value->'library-default-snapshot'->>'refreshed_at' FROM admin_config "
                        "WHERE key='STYLE_GUIDE_REFRESH_STATE'")

    def flush_stats(self):
        self.sql('SELECT pg_stat_force_next_flush()')

    def test_library_gate(self):
        self.sql("DELETE FROM admin_config")
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        first = self.library_refreshed_at()
        self.assertTrue(first)
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        self.assertEqual(self.library_refreshed_at(), first, 'unchanged source skips')
        # A document-only change waits for the hourly bound.
        self.sql("INSERT INTO style_guide_search_documents DEFAULT VALUES; SELECT pg_stat_force_next_flush()")
        time.sleep(.2)
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        self.assertEqual(self.library_refreshed_at(), first)
        self.sql("""UPDATE admin_config SET value = jsonb_set(value,'{library-default-snapshot,refreshed_at}',
          to_jsonb(now() - interval '61 minutes')) WHERE key='STYLE_GUIDE_REFRESH_STATE'""")
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        second = self.library_refreshed_at()
        self.assertNotEqual(second, first)
        # A file change refreshes at once, as does TRUNCATE, which counts no tuples.
        self.sql("INSERT INTO style_guide_files(name) VALUES ('x'); SELECT pg_stat_force_next_flush()")
        time.sleep(.2)
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        third = self.library_refreshed_at()
        self.assertNotEqual(third, second)
        self.sql('TRUNCATE style_guide_render_queue')
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        fourth = self.library_refreshed_at()
        self.assertNotEqual(fourth, third)
        # Age alone never refreshes: the change signature decides (20261111162335).
        self.sql("""UPDATE admin_config SET value = jsonb_set(value,'{library-default-snapshot,refreshed_at}',
          to_jsonb(now() - interval '3 days')) WHERE key='STYLE_GUIDE_REFRESH_STATE'""")
        aged = self.library_refreshed_at()
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        self.assertEqual(self.library_refreshed_at(), aged, 'unchanged source skips at any age')
        # ...and a real counted change still refreshes an aged snapshot at once.
        self.sql("INSERT INTO style_guide_files(name) VALUES ('y'); SELECT pg_stat_force_next_flush()")
        time.sleep(.2)
        self.sql('SELECT refresh_style_guide_library_default_snapshot()')
        self.assertNotEqual(self.library_refreshed_at(), aged)

    def test_matview_job_gate_keeps_search_sync_and_crawl_proof(self):
        self.sql("DELETE FROM admin_config; TRUNCATE calls; DELETE FROM style_guide_crawl_runs")
        self.sql('SELECT refresh_style_guide_matviews_job()')
        self.sql('SELECT refresh_style_guide_matviews_job()')
        self.assertEqual(self.sql('SELECT string_agg(step, \',\' ORDER BY id) FROM calls'), 'all,search')
        self.sql("""INSERT INTO style_guide_crawl_runs VALUES (gen_random_uuid(),'reconciling',
          now() - interval '30 days',NULL,NULL)""")
        self.sql('SELECT refresh_style_guide_matviews_job()')
        self.assertTrue(self.sql('SELECT step FROM calls ORDER BY id DESC LIMIT 1') == 'search',
                        'stale abandoned crawls do not force refreshes forever')
        self.sql("""INSERT INTO style_guide_crawl_runs VALUES (gen_random_uuid(),'refreshing',now(),now(),NULL)""")
        self.sql('SELECT refresh_style_guide_matviews_job()')
        self.assertEqual(self.sql('SELECT step FROM calls ORDER BY id DESC LIMIT 1'), 'all')
        self.sql("DELETE FROM style_guide_crawl_runs")
        self.sql("""INSERT INTO style_guide_files(name) VALUES ('y'); SELECT pg_stat_force_next_flush()""")
        time.sleep(.2)
        self.sql('SELECT refresh_style_guide_matviews_job()')
        self.assertEqual(self.sql('SELECT step FROM calls ORDER BY id DESC LIMIT 1'), 'all')

    def test_await_accepts_the_new_job_and_refuses_drift(self):
        self.sql("""DELETE FROM style_guide_crawl_runs; TRUNCATE cron.job_run_details;
          INSERT INTO style_guide_crawl_runs VALUES
            ('33333333-3333-3333-3333-333333333333','reconciling',now(),NULL,NULL)""")
        self.assertEqual(self.sql("SELECT ready FROM await_style_guide_matview_refresh("
                                  "'33333333-3333-3333-3333-333333333333')"), 'f')
        self.sql("""INSERT INTO cron.job_run_details VALUES (9,'succeeded',clock_timestamp(),clock_timestamp()+interval '1s')""")
        self.assertEqual(self.sql("SELECT ready FROM await_style_guide_matview_refresh("
                                  "'33333333-3333-3333-3333-333333333333')"), 't')
        self.sql("UPDATE cron.job SET command='select public.refresh_style_guide_matviews()' WHERE jobid=9")
        self.addCleanup(lambda: self.sql(
            "UPDATE cron.job SET command='set local statement_timeout = ''10min''; "
            "select public.refresh_style_guide_matviews_job()' WHERE jobid=9"))
        result = subprocess.run(['docker', 'exec', self.name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-qAt', '-c',
                                 "SELECT ready FROM await_style_guide_matview_refresh('33333333-3333-3333-3333-333333333333')"],
                                text=True, capture_output=True)
        self.assertIn('command changed', result.stderr)

    def test_new_functions_are_not_publicly_executable(self):
        for sig in ('refresh_style_guide_matviews_job()', 'style_guide_refresh_source_signature(regclass[])'):
            for role in ('anon', 'authenticated', 'service_role', 'public'):
                self.assertEqual(self.sql(
                    f"SELECT has_function_privilege('{role}', '{sig}', 'execute')" if role != 'public' else
                    f"SELECT coalesce(bool_or(grantee=0), false) FROM pg_proc, aclexplode(proacl) WHERE oid='{sig}'::regprocedure"), 'f')


if __name__ == '__main__':
    unittest.main()
