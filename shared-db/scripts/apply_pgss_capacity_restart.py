#!/usr/bin/env python3
"""Fixed #5609 control-plane capacity increase (40000) with controlled Postgres restart."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
PLAN = 'config/pgss-capacity-restart.json'
WORKFLOW = '.github/workflows/apply-pgss-capacity-restart.yml'
REF_MODULE = 'scripts/shared_db_live_proof.py'
ADAPTER = 'scripts/pgss-restart-exclusive.mjs'
OPERATION = 'pg-stat-statements-capacity-restart/v1'
SETTING = 'pg_stat_statements.max'
DESIRED = 40000
ALLOWED_MODES = ('preview_only', 'preview_and_production')
WINDOW_TZ = 'America/New_York'
CANDIDATE_NAMES = (
    'idx_assets_full_text_search',
    'idx_assets_tags',
    'idx_sgf_directory_path_trgm',
    'idx_style_guide_files_tag_search_trgm',
)
# Versioned Management API update schema. Unknown keys fail closed.
CONFIG_KEYS = frozenset(
    'effective_cache_size logical_decoding_work_mem pg_stat_statements.max '
    'pg_net.batch_size autovacuum_max_workers autovacuum_work_mem cron.log_statement '
    'log_autovacuum_min_duration log_checkpoints log_connections log_disconnections '
    'log_duration log_lock_waits log_recovery_conflict_waits log_replication_commands '
    'log_startup_progress_interval log_statement log_temp_files maintenance_work_mem '
    'track_activity_query_size max_connections max_locks_per_transaction '
    'max_logical_replication_workers max_parallel_maintenance_workers max_parallel_workers '
    'max_parallel_workers_per_gather max_replication_slots max_slot_wal_keep_size '
    'max_standby_archive_delay max_standby_streaming_delay max_sync_workers_per_subscription '
    'max_wal_size max_wal_senders max_worker_processes session_replication_role shared_buffers '
    'statement_timeout track_commit_timestamp wal_keep_size wal_sender_timeout work_mem '
    'checkpoint_timeout hot_standby_feedback'.split()
)
CATALOG_KEYS = {
    'execution_role', 'session_role', 'database', 'read_only', 'role_super',
    'role_bypassrls', 'context', 'effective', 'pending_restart', 'postmaster',
    'database_reset', 'statement_reset', 'dealloc', 'indexes',
}
INDEX_KEYS = {'schema', 'index', 'index_oid', 'table_oid', 'definition_md5', 'valid', 'ready'}
SQL = """select current_user as execution_role, session_user as session_role,
 current_database() as database, current_setting('transaction_read_only') as read_only,
 (select rolsuper from pg_roles where rolname=current_user) as role_super,
 (select rolbypassrls from pg_roles where rolname=current_user) as role_bypassrls,
 s.context, s.setting as effective, s.pending_restart,
 pg_postmaster_start_time()::text as postmaster,
 (select stats_reset::text from pg_stat_database where datname=current_database()) as database_reset,
 (select stats_reset::text from extensions.pg_stat_statements_info) as statement_reset,
 (select dealloc from extensions.pg_stat_statements_info) as dealloc,
 (select jsonb_agg(jsonb_build_object('schema',n.nspname,'index',c.relname,
   'index_oid',c.oid::text,'table_oid',i.indrelid::text,
   'definition_md5',md5(pg_get_indexdef(c.oid)), 'valid',i.indisvalid,'ready',i.indisready)
   order by c.relname)
  from pg_index i join pg_class c on c.oid=i.indexrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
  ('idx_assets_full_text_search','idx_assets_tags','idx_sgf_directory_path_trgm',
   'idx_style_guide_files_tag_search_trgm')) as indexes
 from pg_settings s where s.name='pg_stat_statements.max'"""


class Refused(Exception):
    """Messages are fixed public diagnostics, never vendor response text."""


def require(ok, message):
    if not ok:
        raise Refused(message)


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    ).hexdigest()


def file_hash(root, name):
    return hashlib.sha256((root / name).read_bytes()).hexdigest()


def safe_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key refused')
            result[key] = value
        return result

    def bad_number(value):
        raise Refused('noninteger JSON number refused')

    return json.loads(data, object_pairs_hook=pairs, parse_float=bad_number, parse_constant=bad_number)


def is_in_ny_maintenance_window(now_utc=None):
    """Authorized disruptive window: Friday 18:00 through Sunday 05:00 America/New_York."""
    instant = datetime.now(timezone.utc) if now_utc is None else now_utc
    require(instant.tzinfo is not None, 'naive timestamp refused')
    ny = instant.astimezone(ZoneInfo(WINDOW_TZ))
    wd = ny.weekday()  # Mon=0 .. Fri=4, Sat=5, Sun=6
    if wd == 4:
        return ny.hour >= 18
    if wd == 5:
        return True
    if wd == 6:
        return ny.hour < 5
    return False


def production_ref(root=ROOT):
    tree = ast.parse((root / REF_MODULE).read_text(encoding='utf-8'))
    values = [
        node.value.value
        for node in tree.body
        if isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == 'PROJECT_REF'
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    ]
    require(len(values) == 1 and re.fullmatch('[a-z]{20}', values[0]), 'canonical target refused')
    return values[0]


def load_plan(root=ROOT):
    plan = safe_json((root / PLAN).read_text(encoding='utf-8'))
    require(
        set(plan)
        == {
            'schema_version', 'operation', 'work_issue', 'owner', 'necessity', 'retirement',
            'source_pr', 'setting', 'desired', 'restart_database', 'allowed_modes',
            'expected_pre_effective', 'maintenance_window_tz', 'production_candidates',
        },
        'plan shape refused',
    )
    require(
        type(plan['schema_version']) is int
        and plan['schema_version'] == 1
        and plan['operation'] == OPERATION
        and type(plan['work_issue']) is int
        and plan['work_issue'] == 5609
        and plan['setting'] == SETTING
        and type(plan['desired']) is int
        and plan['desired'] == DESIRED
        and plan['restart_database'] is True
        and plan['allowed_modes'] == list(ALLOWED_MODES)
        and plan['expected_pre_effective'] == [5000, 40000]
        and plan['maintenance_window_tz'] == WINDOW_TZ,
        'fixed operation refused',
    )
    require(
        all(type(plan[k]) is str and plan[k] for k in ('owner', 'necessity', 'retirement')),
        'plan ownership refused',
    )
    indexes = plan['production_candidates']
    require(type(indexes) is list and len(indexes) == 4, 'candidate plan refused')
    require(sorted(x['index'] for x in indexes) == list(CANDIDATE_NAMES), 'candidate names refused')
    for index in indexes:
        require(
            set(index) == INDEX_KEYS - {'valid', 'ready'}
            and index['schema'] == 'public'
            and re.fullmatch('[1-9][0-9]*', index['index_oid'])
            and re.fullmatch('[1-9][0-9]*', index['table_oid'])
            and re.fullmatch('[0-9a-f]{32}', index['definition_md5']),
            'candidate identity refused',
        )
    return plan


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Refused('redirect refused')


class API:
    def __init__(self, ref, token, transport=None):
        require(type(ref) is str and re.fullmatch('[a-z]{20}', ref), 'target syntax refused')
        require(
            type(token) is str and token and '\n' not in token and '\r' not in token,
            'credential unavailable',
        )
        self.base = 'https://api.supabase.com/v1/projects/' + ref
        self.ref = ref
        self.token = token
        self.transport = transport or urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        )

    def call(self, method, kind, payload=None):
        require(
            (method, kind) in {('GET', 'config'), ('GET', 'identity'), ('PUT', 'config'), ('POST', 'catalog')},
            'operation endpoint refused',
        )
        endpoint = {
            'config': '/config/database/postgres',
            'catalog': '/database/query/read-only',
            'identity': '',
        }[kind]
        if method == 'POST':
            require(payload == {'query': SQL, 'read_only': True}, 'read-only query refused')
        if method == 'PUT':
            require(
                type(payload) is dict
                and payload.get(SETTING) == DESIRED
                and payload.get('restart_database') is True
                and set(payload) <= CONFIG_KEYS | {'restart_database'},
                'capacity-restart body refused',
            )
        request = urllib.request.Request(
            self.base + endpoint,
            method=method,
            data=None if payload is None else json.dumps(payload, allow_nan=False).encode(),
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'},
        )
        try:
            with self.transport.open(request, timeout=25) as response:
                require(response.status == 200, 'vendor status refused')
                data = response.read(1048577)
                require(len(data) <= 1048576, 'vendor response too large')
                return safe_json(data)
        except Refused:
            raise
        except Exception:
            raise Refused('vendor request refused; no response contents disclosed') from None


def validate_config(value):
    require(type(value) is dict and set(value) <= CONFIG_KEYS, 'config shape refused')
    booleans = {
        'cron.log_statement', 'log_checkpoints', 'log_connections', 'log_disconnections',
        'log_duration', 'log_lock_waits', 'log_recovery_conflict_waits', 'log_replication_commands',
        'track_commit_timestamp', 'hot_standby_feedback',
    }
    integers = {
        SETTING, 'pg_net.batch_size', 'autovacuum_max_workers', 'max_connections',
        'max_locks_per_transaction', 'max_logical_replication_workers',
        'max_parallel_maintenance_workers', 'max_parallel_workers',
        'max_parallel_workers_per_gather', 'max_replication_slots',
        'max_sync_workers_per_subscription', 'max_wal_senders', 'max_worker_processes',
    }
    require(
        all(type(v) is (bool if k in booleans else int if k in integers else str) for k, v in value.items()),
        'config value refused',
    )
    require(
        SETTING not in value or (type(value[SETTING]) is int and value[SETTING] in (5000, DESIRED)),
        'stored capacity refused',
    )
    return value


def validate_catalog(rows, plan, target):
    require(
        type(rows) is list and len(rows) == 1 and type(rows[0]) is dict and set(rows[0]) == CATALOG_KEYS,
        'catalog shape refused',
    )
    row = rows[0]
    require(
        row['execution_role'] == row['session_role'] == 'supabase_read_only_user'
        and row['database'] == 'postgres'
        and row['read_only'] == 'on'
        and row['role_super'] is False
        and row['role_bypassrls'] is True,
        'catalog identity refused',
    )
    require(
        row['context'] == 'postmaster'
        and row['effective'] in ('5000', '40000')
        and type(row['pending_restart']) is bool
        and type(row['dealloc']) is int
        and row['dealloc'] >= 0,
        'runtime capacity refused',
    )
    require(
        type(row['postmaster']) is str
        and row['postmaster']
        and type(row['statement_reset']) is str
        and row['statement_reset']
        and (row['database_reset'] is None or type(row['database_reset']) is str),
        'counter identity refused',
    )
    indexes = row['indexes']
    require(type(indexes) is list and len(indexes) == 4, 'catalog candidates refused')
    require(sorted(x.get('index', '') for x in indexes) == list(CANDIDATE_NAMES), 'catalog names refused')
    for index in indexes:
        require(
            set(index) == INDEX_KEYS and index['valid'] is True and index['ready'] is True,
            'catalog index state refused',
        )
        require(
            index['schema'] == 'public'
            and type(index['index_oid']) is str
            and re.fullmatch('[1-9][0-9]*', index['index_oid'])
            and type(index['table_oid']) is str
            and re.fullmatch('[1-9][0-9]*', index['table_oid'])
            and type(index['definition_md5']) is str
            and re.fullmatch('[0-9a-f]{32}', index['definition_md5']),
            'catalog identity shape refused',
        )
    if target == 'production':
        identities = [{k: v for k, v in x.items() if k not in ('valid', 'ready')} for x in indexes]
        require(
            sorted(identities, key=lambda x: x['index']) == plan['production_candidates'],
            'original candidate identity changed',
        )
    return row


def context(env, root=ROOT):
    require(
        env.get('GITHUB_REPOSITORY') == 'popcre/shared-db'
        and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
        and env.get('GITHUB_REF') == 'refs/heads/main',
        'workflow context refused',
    )
    sha = env.get('GITHUB_SHA', '')
    mode = env.get('MODE', '')
    require(
        re.fullmatch('[0-9a-f]{40}', sha)
        and env.get('EXPECTED_HEAD') == sha
        and env.get('WORK_ISSUE') == '5609'
        and mode in ALLOWED_MODES,
        'source binding refused',
    )
    require(
        re.fullmatch('[1-9][0-9]*', env.get('GITHUB_RUN_ID', ''))
        and re.fullmatch('[1-9][0-9]*', env.get('GITHUB_RUN_ATTEMPT', '')),
        'run binding refused',
    )
    require(
        env.get('GITHUB_WORKFLOW_REF') == 'popcre/shared-db/' + WORKFLOW + '@refs/heads/main',
        'workflow identity refused',
    )
    return {
        'source_sha': sha,
        'run_id': env['GITHUB_RUN_ID'],
        'run_attempt': env['GITHUB_RUN_ATTEMPT'],
        'workflow': WORKFLOW,
        'mode': mode,
        'plan_sha256': file_hash(root, PLAN),
        'files_sha256': {
            name: file_hash(root, name)
            for name in (
                PLAN,
                WORKFLOW,
                'scripts/apply_pgss_capacity_restart.py',
                ADAPTER,
                REF_MODULE,
                '.ai-devops/task-gates.json',
            )
        },
    }


def validate_preview(receipt, binding, preview_ref):
    expected_keys = set(binding) | {
        'schema_version', 'operation', 'work_issue', 'target', 'target_sha256',
        'restart_database', 'succeeded', 'changed', 'restarted', 'stored_capacity',
        'effective_capacity', 'pending_restart', 'dealloc', 'before_sha256',
        'after_sha256', 'postmaster_before_sha256', 'postmaster_after_sha256',
        'reset_sha256', 'indexes_sha256',
    }
    require(type(receipt) is dict and set(receipt) == expected_keys, 'preview receipt shape refused')
    require(
        all(receipt[k] == v for k, v in binding.items())
        and receipt['schema_version'] == 1
        and receipt['operation'] == OPERATION
        and receipt['work_issue'] == 5609
        and receipt['target'] == 'preview'
        and receipt['target_sha256'] == digest(preview_ref)
        and receipt['restart_database'] is True
        and receipt['succeeded'] is True
        and receipt['stored_capacity'] == DESIRED
        and receipt['effective_capacity'] == DESIRED
        and receipt['pending_restart'] is False
        and type(receipt['changed']) is bool
        and type(receipt['restarted']) is bool
        and type(receipt['dealloc']) is int
        and receipt['dealloc'] >= 0,
        'preview receipt binding refused',
    )
    if receipt['changed']:
        require(
            receipt['restarted'] is True
            and receipt['postmaster_before_sha256'] != receipt['postmaster_after_sha256'],
            'preview receipt restart proof refused',
        )
    for key in (
        'before_sha256', 'after_sha256', 'postmaster_before_sha256',
        'postmaster_after_sha256', 'reset_sha256', 'indexes_sha256',
    ):
        require(
            type(receipt[key]) is str and re.fullmatch('[0-9a-f]{64}', receipt[key]),
            'preview receipt hash refused',
        )


def wait_for_effective_restart(
    api, plan, target, before_postmaster, *, poll_timeout_s=300, poll_interval_s=5,
    sleep_fn=time.sleep, monotonic_fn=time.monotonic,
):
    deadline = monotonic_fn() + poll_timeout_s
    last_catalog = None
    while True:
        try:
            rows = api.call('POST', 'catalog', {'query': SQL, 'read_only': True})
            later = validate_catalog(rows, plan, target)
            last_catalog = later
            if (
                int(later['effective']) == DESIRED
                and later['pending_restart'] is False
                and later['postmaster'] != before_postmaster
            ):
                return later
        except Refused as err:
            # Structural/index identity failures fail immediately; transient vendor
            # outages during the Postgres bounce are retried until poll_timeout_s.
            if str(err) not in ('vendor request refused; no response contents disclosed', 'vendor status refused'):
                raise
        if monotonic_fn() >= deadline:
            if last_catalog is not None and last_catalog['postmaster'] == before_postmaster:
                raise Refused('post-restart verification timed out without postmaster advance')
            raise Refused('post-restart capacity verification timed out')
        sleep_fn(poll_interval_s)


def apply_capacity_restart(
    api, plan, target, fence, *, poll_timeout_s=300, poll_interval_s=5,
    sleep_fn=time.sleep, monotonic_fn=time.monotonic,
):
    before = validate_config(api.call('GET', 'config'))
    catalog = validate_catalog(api.call('POST', 'catalog', {'query': SQL, 'read_only': True}), plan, target)
    pre_effective = int(catalog['effective'])
    require(
        before.get(SETTING, pre_effective) >= pre_effective and DESIRED >= pre_effective,
        'capacity decrease refused',
    )
    needs_apply = (
        before.get(SETTING) != DESIRED
        or pre_effective != DESIRED
        or catalog['pending_restart'] is True
    )
    restarted = False
    if needs_apply:
        fence()
        identity = api.call('GET', 'identity')
        require(type(identity) is dict and identity.get('id') == api.ref, 'point-of-use target identity refused')
        latest = validate_config(api.call('GET', 'config'))
        require(latest == before, 'concurrent config change refused')
        payload = dict(latest, **{SETTING: DESIRED, 'restart_database': True})
        returned = validate_config(api.call('PUT', 'config', payload))
        require(
            returned.get(SETTING) == DESIRED
            and {k: v for k, v in before.items() if k != SETTING}
            == {k: v for k, v in returned.items() if k != SETTING},
            'returned overrides changed unexpectedly',
        )
        later = wait_for_effective_restart(
            api, plan, target, catalog['postmaster'],
            poll_timeout_s=poll_timeout_s, poll_interval_s=poll_interval_s,
            sleep_fn=sleep_fn, monotonic_fn=monotonic_fn,
        )
        restarted = True
    else:
        later = validate_catalog(api.call('POST', 'catalog', {'query': SQL, 'read_only': True}), plan, target)
        require(
            int(later['effective']) == DESIRED and later['pending_restart'] is False,
            'idempotent capacity verification refused',
        )
    after = validate_config(api.call('GET', 'config'))
    require(
        after.get(SETTING) == DESIRED
        and {k: v for k, v in before.items() if k != SETTING}
        == {k: v for k, v in after.items() if k != SETTING},
        'stored overrides changed unexpectedly',
    )
    require(later['indexes'] == catalog['indexes'], 'protected index identities changed across restart')
    return {
        'changed': needs_apply,
        'restarted': restarted,
        'stored_capacity': DESIRED,
        'effective_capacity': int(later['effective']),
        'pending_restart': later['pending_restart'],
        'dealloc': later['dealloc'],
        'before_sha256': digest(before),
        'after_sha256': digest(after),
        'postmaster_before_sha256': digest(catalog['postmaster']),
        'postmaster_after_sha256': digest(later['postmaster']),
        'reset_sha256': digest([later['database_reset'], later['statement_reset']]),
        'indexes_sha256': digest(later['indexes']),
    }


def run(
    target, mode, output, preview_receipt=None, env=None, root=ROOT,
    api_factory=API, fence=None, now_utc=None,
    poll_timeout_s=300, poll_interval_s=5, sleep_fn=time.sleep, monotonic_fn=time.monotonic,
):
    env = os.environ if env is None else env
    require(target in ('preview', 'production'), 'target refused')
    require(mode in ALLOWED_MODES, 'mode refused')
    binding = context(env, root)
    require(binding['mode'] == mode, 'mode mismatch refused')
    plan = load_plan(root)
    prod = production_ref(root)
    preview = env.get('PREVIEW_PROJECT_REF', '')
    require(re.fullmatch('[a-z]{20}', preview) and preview != prod, 'preview target refused')
    if target == 'production':
        require(mode == 'preview_and_production', 'production refused in preview_only mode')
        require(is_in_ny_maintenance_window(now_utc), 'production restart refused outside NY maintenance window')
        require(preview_receipt is not None, 'preview prerequisite unavailable')
        validate_preview(safe_json(Path(preview_receipt).read_text(encoding='utf-8')), binding, preview)
    else:
        require(preview_receipt is None, 'preview input refused')
    ref = preview if target == 'preview' else prod
    require(callable(fence), 'native exclusive fencing unavailable')
    result = apply_capacity_restart(
        api_factory(ref, env.get('SUPABASE_ACCESS_TOKEN', '')),
        plan, target, fence,
        poll_timeout_s=poll_timeout_s, poll_interval_s=poll_interval_s,
        sleep_fn=sleep_fn, monotonic_fn=monotonic_fn,
    )
    receipt = dict(
        binding,
        schema_version=1,
        operation=OPERATION,
        work_issue=5609,
        target=target,
        target_sha256=digest(ref),
        restart_database=True,
        succeeded=True,
        **result,
    )
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    return receipt


def native_fence(target):
    # GitHub/native ownership checks never inherit the Supabase credential.
    environment = dict(os.environ)
    environment.pop('SUPABASE_ACCESS_TOKEN', None)
    result = subprocess.run(
        ['node', str(ROOT / ADAPTER), 'verify', target],
        cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45,
    )
    require(result.returncode == 0, 'native exclusive fence refused')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=('preview', 'production'), required=True)
    parser.add_argument('--mode', choices=ALLOWED_MODES, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--preview-receipt', type=Path)
    args = parser.parse_args()
    try:
        require(not args.output.exists(), 'existing receipt output refused')

        def fence():
            native_fence(args.target)

        fence()
        run(args.target, args.mode, args.output, args.preview_receipt, fence=fence)
        print('Fixed capacity increase and controlled restart verified at effective 40000.')
        return 0
    except Exception as error:
        print(
            str(error) if isinstance(error, Refused) else 'Capacity restart refused; no private details disclosed.',
            file=sys.stderr,
        )
        return 1


if __name__ == '__main__':
    sys.exit(main())
