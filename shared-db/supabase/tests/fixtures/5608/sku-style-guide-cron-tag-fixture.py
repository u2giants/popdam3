"""Actual pg_cron fixture: preserve an existing job and reject duplicate names."""
from pathlib import Path
import subprocess,json
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--container',required=True)
parser.add_argument('--database',required=True)
args=parser.parse_args()
if not args.container.startswith('shared-db-5608-'):raise RuntimeError('Owned disposable #5608 container required')
migration=(Path(__file__).resolve().parents[4]/'supabase/migrations/20261105061627_sku_style_guide_resolution_snapshot.sql').read_text()
tag='do $nightly_identity$'+migration.split('do $nightly_identity$')[1]
cmd=['docker','exec','-i',args.container,'psql','-X','-U','supabase_admin','-d',args.database,'-v','ON_ERROR_STOP=1']
privilege=subprocess.check_output(cmd+['-Atc',"select has_function_privilege('postgres','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE')"],text=True).strip()
if privilege!='t':raise RuntimeError('Standing platform postgres EXECUTE grant is required; fixture never adds it')
before=subprocess.check_output(cmd+['-Atc',"select md5(row(jobid,jobname,username,schedule,command,active,database)::text) from cron.job where jobname='resolve-sku-style-guide-links-nightly'"],text=True).strip()
sql="""BEGIN;SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='resolve-sku-style-guide-links-nightly';SET LOCAL ROLE postgres;SELECT cron.schedule('resolve-sku-style-guide-links-nightly','30 4 * * *','call public.resolve_sku_style_guide_links_run();');RESET ROLE;CREATE TEMP TABLE expected_job AS SELECT * FROM cron.job WHERE jobname='resolve-sku-style-guide-links-nightly';SET LOCAL ROLE postgres;
"""+tag+"""
RESET ROLE;
DO $$BEGIN IF NOT EXISTS(SELECT FROM cron.job j JOIN expected_job e USING(jobid) WHERE j.jobname=e.jobname AND j.schedule=e.schedule AND j.username=e.username AND j.active=e.active AND j.database=e.database AND j.command='call public.resolve_sku_style_guide_links_run() /* shared-db:20261105061627 */') OR (SELECT count(*) FROM cron.job WHERE jobname='resolve-sku-style-guide-links-nightly')<>1 THEN RAISE EXCEPTION 'alter_job changed nightly identity/state';END IF;END$$;ROLLBACK;
"""
p=subprocess.run(cmd,input=sql,text=True,capture_output=True);assert p.returncode==0,p.stderr
sql="BEGIN;SET LOCAL ROLE postgres;SELECT cron.schedule('resolve-sku-style-guide-links-nightly','30 4 * * *','select 3');\n"+tag+'\nROLLBACK;'
p=subprocess.run(cmd,input=sql,text=True,capture_output=True);assert p.returncode!=0 and 'Expected exactly one existing nightly SKU style-guide job, found 2' in p.stderr,p.stderr
after=subprocess.check_output(cmd+['-Atc',"select md5(row(jobid,jobname,username,schedule,command,active,database)::text) from cron.job where jobname='resolve-sku-style-guide-links-nightly'"],text=True).strip()
assert before==after
print(json.dumps({'real_pg_cron_version':'1.6.4','alter_job_preserves_id_schedule_owner_active_database':True,'exact_tagged_command':True,'duplicate_name_refused':True,'rollback_restored_original':True}))
