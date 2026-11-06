"""Exercise the actual source SQL against synthetic relation fixtures only."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--container', required=True)
parser.add_argument('--database', required=True)
args = parser.parse_args()
if not args.container.startswith('shared-db-5608-'):
    raise RuntimeError('Only an explicitly owned #5608 disposable container is permitted')
proof = (Path(__file__).resolve().parents[4] / '.github/live-proofs/5608.sql').read_text()
for original, fixture in [
    ('cron.job_run_details', 'pg_temp.proof_runs'), ('cron.job', 'pg_temp.proof_job'),
    ('supabase_migrations.schema_migrations', 'pg_temp.proof_ledger'),
    ('public.sku_style_guide_resolver_progress', 'pg_temp.proof_progress'),
    ('public.sku_style_guide_links', 'pg_temp.proof_links'),
]:
    proof = proof.replace(original, fixture)
tag = 'call public.resolve_sku_style_guide_links_run() /* shared-db:20261106171924 */'
setup = """BEGIN;
DO $$BEGIN IF current_setting('app.sku_sg_disposable',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Disposable fixture required';END IF;END$$;
CREATE TEMP TABLE proof_job(jobid bigint,jobname text,command text,active boolean default true,username text default 'postgres',schedule text default '30 4 * * *');
CREATE TEMP TABLE proof_runs(jobid bigint,status text,start_time timestamptz,end_time timestamptz,command text);
CREATE TEMP TABLE proof_ledger(version text);
CREATE TEMP TABLE proof_progress(active_link_ids uuid[],portal_hash text);
CREATE TEMP TABLE proof_links(last_seen_at timestamptz);
INSERT INTO proof_job VALUES(17,'resolve-sku-style-guide-links-nightly','TAG');
INSERT INTO proof_ledger VALUES('20261105061627'),('20261106171924');
INSERT INTO proof_progress VALUES(ARRAY['00000000-0000-0000-0000-000000000001'::uuid],'v4:fixture');
INSERT INTO proof_links VALUES(now());
INSERT INTO proof_runs SELECT 17,'succeeded',date_trunc('day',now())-make_interval(days=>n)+interval '4 hours 30 minutes',date_trunc('day',now())-make_interval(days=>n)+interval '4 hours 30 minutes 1 second',CASE WHEN n=1 THEN 'TAG' ELSE 'old command' END FROM generate_series(1,3) n;
""".replace('TAG', tag)
cases = [
    ('two historical plus one tagged', '', False),
    ('three tagged consecutive successes', "UPDATE proof_runs SET command='TAG';", True),
    ('legacy v3 cache cannot pass', "UPDATE proof_progress SET portal_hash='v3:fixture';", False),
    ('NULL cache cannot pass', "UPDATE proof_progress SET portal_hash=NULL;", False),
    ('restored v4 cache', "UPDATE proof_progress SET portal_hash='v4:fixture';", True),
    ('missing final source ledger', "DELETE FROM proof_ledger WHERE version='20261106171924';", False),
    ('restored final source ledger', "INSERT INTO proof_ledger VALUES('20261106171924');", True),
    ('prior repaired source tags cannot pass', "UPDATE proof_runs SET command='call public.resolve_sku_style_guide_links_run() /* shared-db:20261105061627 */';", False),
    ('restored final source tags', "UPDATE proof_runs SET command='TAG';", True),
    ('NULL stored command', "UPDATE proof_runs SET command=NULL WHERE start_time=(SELECT max(start_time) FROM proof_runs);", False),
    ('restore tagged before failure', "UPDATE proof_runs SET command='TAG';", True),
    ('intervening failure', "UPDATE proof_runs SET status='failed' WHERE start_time=(SELECT start_time FROM proof_runs ORDER BY start_time DESC OFFSET 1 LIMIT 1);", False),
    ('intervening untagged command', "UPDATE proof_runs SET status='succeeded';UPDATE proof_runs SET command='old command' WHERE start_time=(SELECT start_time FROM proof_runs ORDER BY start_time DESC OFFSET 1 LIMIT 1);", False),
    ('untagged failure cannot be filtered to three older successes', "UPDATE proof_runs SET command='TAG';INSERT INTO proof_runs SELECT jobid,status,start_time-interval '3 days',end_time-interval '3 days',command FROM proof_runs ORDER BY start_time DESC LIMIT 1;UPDATE proof_runs SET command='old command',status='failed' WHERE start_time=(SELECT max(start_time) FROM proof_runs);", False),
    ('three latest tagged after older history', "UPDATE proof_runs SET command='TAG',status='succeeded';", True),
    ('duplicate current job', "INSERT INTO proof_job VALUES(18,'resolve-sku-style-guide-links-nightly','TAG');", False),
    ('current job command mismatch', "DELETE FROM proof_job WHERE jobid=18;UPDATE proof_job SET command='old command';", False),
    ('forward ledger absent', "UPDATE proof_job SET command='TAG';DELETE FROM proof_ledger;", False),
    ('over budget nightly', "INSERT INTO proof_ledger VALUES('20261105061627'),('20261106171924');UPDATE proof_runs SET end_time=start_time+interval '61 seconds' WHERE start_time=(SELECT max(start_time) FROM proof_runs);", False),
    ('inactive current job', "UPDATE proof_runs SET end_time=start_time+interval '1 second';UPDATE proof_job SET active=false;", False),
    ('rescheduled current job', "UPDATE proof_job SET active=true,schedule='* * * * *';", False),
    ('changed current owner', "UPDATE proof_job SET schedule='30 4 * * *',username='other';", False),
    ('NULL current command', "UPDATE proof_job SET username='postgres',command=NULL;", False),
    ('negative nightly duration', "UPDATE proof_job SET username='postgres',command='TAG';UPDATE proof_runs SET end_time=start_time-interval '1 second' WHERE start_time=(SELECT max(start_time) FROM proof_runs);", False),
]
script = setup
for name, change, expected in cases:
    script += change.replace('TAG', tag) + '\n'
    script += "DO $case$ DECLARE passed boolean;BEGIN EXECUTE $probe$" + proof + "$probe$ INTO passed;IF passed IS DISTINCT FROM " + str(expected).lower() + " THEN RAISE EXCEPTION 'Live-proof fixture failed: " + name + "';END IF;END $case$;\n"
script += 'ROLLBACK;'
command = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=-c app.sku_sg_disposable=yes', args.container,
           'psql', '-X', '-q', '-U', 'postgres', '-d', args.database, '-v', 'ON_ERROR_STOP=1']
result = subprocess.run(command, input=script, text=True, capture_output=True)
if result.returncode:
    raise RuntimeError(result.stderr)
print(json.dumps({'actual_live_proof_sql_cases': len(cases), 'all_passed': True}))
