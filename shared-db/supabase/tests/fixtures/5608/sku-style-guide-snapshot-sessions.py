"""Synthetic disposable-only sessions after the eight-portal + snapshot fixtures."""
import argparse
import json
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--container', required=True)
parser.add_argument('--database', required=True)
args = parser.parse_args()
if not args.container.startswith('shared-db-5608-'):
    raise RuntimeError('Only an explicitly owned #5608 disposable container is permitted')
command = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=-c app.sku_sg_disposable=yes',
           args.container, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', args.database]
session = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, text=True, bufsize=1)
sequence = 0

def first(sql):
    global sequence
    sequence += 1
    marker = 'SNAPSHOT_DONE_' + str(sequence)
    session.stdin.write(sql.rstrip() + (';' if not sql.rstrip().endswith(';') else '') + '\n\\echo ' + marker + '\n')
    session.stdin.flush()
    result = []
    while True:
        line = session.stdout.readline()
        if not line:
            raise RuntimeError('Session ended: ' + session.stderr.read())
        if line.strip() == marker:
            return '\n'.join(result).strip()
        result.append(line.rstrip())

def second(sql):
    return subprocess.check_output(command + ['-v', 'ON_ERROR_STOP=1', '-c', sql], text=True).strip()

assert first("select current_setting('app.sku_sg_disposable',true)") == 'yes'
first("delete from public.sku_style_guide_links where sku like 'SNAP-CANCEL-%';delete from public.sku_style_guide_resolver_progress where sku like 'SNAP-CANCEL-%';delete from public.sku_files_used where sku like 'SNAP-CANCEL-%';update plm.dcp_asset set file_name='.psd';")
first('begin;select public.prepare_sku_style_guide_resolution(true);commit;')
before = first('select count(*) from pg_temp.sku_sg_portal where source_system=\'disney_dcpvault\' and matched_file_name=\'.psd\';')
assert int(before) > 0
second("update plm.dcp_asset set file_name='Concurrent.PSD';")
assert first("select count(*) from pg_temp.sku_sg_portal where source_system='disney_dcpvault' and matched_file_name='.psd';") == before
first("do $$declare r jsonb;begin loop r:=public.resolve_sku_style_guide_batch();exit when (r->>'sku_rows')::int=0;end loop;end$$;")
assert int(first('select public.prepare_sku_style_guide_resolution(false);')) > 0
assert int(first("select count(*) from pg_temp.sku_sg_portal where source_system='disney_dcpvault' and matched_file_name='Concurrent.PSD';")) > 0
first('call public.resolve_sku_style_guide_links_run();')
# Only these new SKUs are pending; cancel after batch-two DML must retain 100.
first("insert into public.sku_files_used select 'SNAP-CANCEL-'||lpad(g::text,3,'0'),'Concurrent.PSD','synthetic' from generate_series(1,201) g;")
first("select cron.schedule('sku-style-guide-links-catchup-5608','*/5 * * * *','call public.resolve_sku_style_guide_links_run()');")
first("""create table public.snapshot_batch_counter(n integer);insert into public.snapshot_batch_counter values(0);
alter function public.resolve_sku_style_guide_batch(integer) rename to resolve_sku_style_guide_batch_actual;
create function public.resolve_sku_style_guide_batch(p_batch_size integer default 100) returns jsonb language plpgsql security definer set search_path=public as $$declare n integer;r jsonb;begin update public.snapshot_batch_counter c set n=c.n+1 returning c.n into n;r:=public.resolve_sku_style_guide_batch_actual(p_batch_size);if n=2 then perform pg_sleep(3);end if;return r;end$$;""")
first("set statement_timeout='150ms';\n\\set ON_ERROR_STOP off\ncall public.resolve_sku_style_guide_links_run();\n\\set ON_ERROR_STOP on\nset statement_timeout=0;")
assert first("select count(*) from public.sku_style_guide_resolver_progress where sku like 'SNAP-CANCEL-%';") == '100'
assert first("select count(*) from public.sku_style_guide_links where sku like 'SNAP-CANCEL-%';") == '100'
assert first("select count(*) from pg_locks where pid=pg_backend_pid() and locktype='advisory';") == '0'
assert first("select count(*) from cron.job where jobname='sku-style-guide-links-catchup-5608';") == '1'
first("drop function public.resolve_sku_style_guide_batch(integer);alter function public.resolve_sku_style_guide_batch_actual(integer) rename to resolve_sku_style_guide_batch;")
first('call public.resolve_sku_style_guide_links_run();call public.resolve_sku_style_guide_links_run();')
assert first("select count(*) from public.sku_style_guide_resolver_progress where sku like 'SNAP-CANCEL-%';") == '201'
assert first("select count(*) from public.sku_style_guide_links where sku like 'SNAP-CANCEL-%';") == '201'
assert first("select count(*) from cron.job where jobname='sku-style-guide-links-catchup-5608';") == '0'
# A new connection recreates its own snapshot and also converges without stale state.
second('call public.resolve_sku_style_guide_links_run();')
first('drop table public.snapshot_batch_counter;')
session.stdin.close()
session.wait(timeout=10)
errors = session.stderr.read()
assert 'canceling statement due to statement timeout' in errors
print(json.dumps({'concurrent_portal_snapshot': True, 'next_invocation_invalidates': True,
                  'canceled_batch_1_durable_skus': 100, 'post_DML_batch_2_progress_and_links_rolled_back': True, 'same_session_resumed_skus': 201,
                  'lock_released_on_cancellation': True, 'catchup_retained_until_complete': True,
                  'repeated_same_and_fresh_session_calls': True}))
