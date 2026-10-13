#!/usr/bin/env python3
"""Read-only preflight or exact reviewed application of a date-only plan."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'qsllyeztdwjgirsysgai'
ADVISORY_LOCK = 852000728
POOLER_HOST = 'aws-1-us-east-1.pooler.supabase.com'
POOLER_PORT = 5432
POOLER_USER = 'postgres.' + TARGET
DATABASE = 'postgres'
CA_FILE = ROOT / 'shared-db' / 'scripts' / 'certs' / 'supabase-root-2021.crt'
CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
MAX_PROPOSALS = 1000
MAX_BATCH_SCOPE_ROWS = 100000
MAX_PROTECTED_INPUT_BYTES = 128 * 1024 * 1024
REVIEW_BUNDLE_SCHEMA = 'orderlist-production-date-review-bundle-v1'
GATE_LAUNCHER = Path('/usr/local/bin/ai-task-gates')
GATE_RESOLVED_PATH = Path('/worksp/ai-devops/bin/ai-task-gates')

SPEC = importlib.util.spec_from_file_location(
    'production_date_planner', ROOT / 'scripts' / 'orderlist-production-date-plan.py')
planner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = planner
SPEC.loader.exec_module(planner)
IMPORTER_SPEC = importlib.util.spec_from_file_location(
    'shared_db_importer', ROOT / 'shared-db' / 'scripts' / 'import-order-list-xlsx.py')
shared_db_importer = importlib.util.module_from_spec(IMPORTER_SPEC)
sys.modules[IMPORTER_SPEC.name] = shared_db_importer
IMPORTER_SPEC.loader.exec_module(shared_db_importer)


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_fd(path: Path, *, allowed_uids: set[int], mode_0600: bool = False) -> bytes:
    flags = os.O_RDONLY | getattr(os, 'O_CLOEXEC', 0) | getattr(os, 'O_NOFOLLOW', 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ValueError('Protected input cannot be opened safely') from exc
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in allowed_uids or
                (mode_0600 and stat.S_IMODE(info.st_mode) != 0o600) or
                (not mode_0600 and info.st_mode & (stat.S_IWGRP | stat.S_IWOTH))):
            raise ValueError('Protected input has unsafe ownership or permissions')
        if info.st_size > MAX_PROTECTED_INPUT_BYTES:
            raise ValueError('Protected input exceeds the 128 MiB input bound')
        chunks = []
        total = 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_PROTECTED_INPUT_BYTES:
                raise ValueError('Protected input exceeds the 128 MiB input bound')
            chunks.append(chunk)
        after = os.fstat(fd)
        stable_fields = ('st_dev', 'st_ino', 'st_uid', 'st_mode', 'st_size',
                         'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(info, field) != getattr(after, field) for field in stable_fields):
            raise ValueError('Protected input changed while being read')
        return b''.join(chunks)
    finally:
        os.close(fd)


def read_private_input(path: Path) -> bytes:
    return _read_fd(path, allowed_uids={os.getuid()}, mode_0600=True)


def read_reviewer_report(path: Path) -> bytes:
    return _read_fd(path, allowed_uids={os.getuid(), 0}, mode_0600=False)


@contextmanager
def _pinned_ca_file():
    ca_bytes = _read_fd(CA_FILE, allowed_uids={os.getuid(), 0})
    if sha_bytes(ca_bytes) != CA_SHA256:
        raise ValueError('Pinned Virginia database certificate checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='popdam-date-ca-') as ca_dir:
        ca_path = Path(ca_dir) / 'supabase-root-2021.crt'
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
        fd = os.open(ca_path, flags, 0o600)
        with os.fdopen(fd, 'wb') as ca_handle:
            ca_handle.write(ca_bytes)
            ca_handle.flush()
            os.fsync(ca_handle.fileno())
        private_copy = _read_fd(ca_path, allowed_uids={os.getuid()}, mode_0600=True)
        if sha_bytes(private_copy) != CA_SHA256:
            raise ValueError('Private Virginia database certificate copy failed verification')
        yield ca_path


def load_frozen_plan(path: Path, expected_sha: str, raw: bytes | None = None) -> dict:
    raw = read_private_input(path) if raw is None else raw
    if sha_bytes(raw) != expected_sha.lower():
        raise ValueError('Frozen plan file checksum mismatch')
    plan = json.loads(raw)
    if plan.get('schema') != planner.SCHEMA or plan.get('database_project') != TARGET:
        raise ValueError('Unsupported plan or database target')
    plan_sha = plan.get('plan_sha256')
    digestable = dict(plan)
    digestable.pop('plan_sha256', None)
    if not isinstance(plan_sha, str) or planner.digest(digestable) != plan_sha:
        raise ValueError('Frozen plan internal checksum mismatch')
    if not re.fullmatch(r'[0-9a-f]{40}', str(plan.get('repository_head') or '')):
        raise ValueError('Frozen plan does not pin a full repository head')
    if not re.fullmatch(r'[0-9a-f]{64}', str(plan.get('capture_file_sha256') or '')):
        raise ValueError('Frozen plan does not pin the source capture file')
    if not re.fullmatch(r'[0-9a-f]{64}', str(plan.get('capture_source_digest') or '')):
        raise ValueError('Frozen plan does not pin the source evidence digest')
    if not isinstance(plan.get('proposals'), list) or not plan['proposals']:
        raise ValueError('Frozen plan has no date proposals')
    return plan


def current_head() -> str:
    try:
        return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True,
                              capture_output=True, text=True).stdout.strip()
    except Exception as exc:
        raise ValueError('Cannot verify current repository head') from exc


def require_exact_head(plan: dict):
    if current_head() != plan['repository_head']:
        raise ValueError('Current repository head differs from frozen plan')


def _verified_gate() -> tuple[Path, str]:
    try:
        resolved = GATE_LAUNCHER.resolve(strict=True)
        if resolved != GATE_RESOLVED_PATH:
            raise ValueError('Managed task-gate path changed')
        info = resolved.stat()
    except (OSError, RuntimeError) as exc:
        raise ValueError('Managed task-gate executable is unavailable') from exc
    if (not stat.S_ISREG(info.st_mode) or not info.st_mode & stat.S_IXUSR or
            info.st_mode & (stat.S_IWGRP | stat.S_IWOTH) or
            info.st_uid not in {os.getuid(), 0}):
        raise ValueError('Managed task-gate executable has unsafe ownership or permissions')
    return resolved, sha_bytes(_read_fd(resolved, allowed_uids={os.getuid(), 0}))


def validate_reviewer_bundle(plan: dict, plan_raw: bytes, report: Path,
                             bundle_raw: bytes, expected_bundle_sha: str) -> tuple[dict, Path, str, bytes]:
    if sha_bytes(bundle_raw) != expected_bundle_sha.lower():
        raise ValueError('Reviewer bundle file checksum mismatch')
    try:
        bundle = json.loads(bundle_raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError('Reviewer bundle is invalid') from exc
    if not isinstance(bundle, dict) or bundle.get('schema') != REVIEW_BUNDLE_SCHEMA:
        raise ValueError('Unsupported reviewer bundle')
    gate, gate_sha = _verified_gate()
    report_raw = read_reviewer_report(report)
    expected = {
        'plan_file_sha256': sha_bytes(plan_raw),
        'plan_sha256': plan['plan_sha256'],
        'capture_file_sha256': plan['capture_file_sha256'],
        'capture_source_digest': plan['capture_source_digest'],
        'database_project': TARGET,
        'repository_head': plan['repository_head'],
        'planner_file_sha256': sha_bytes(read_private_or_repo_file(ROOT / 'scripts' / 'orderlist-production-date-plan.py')),
        'executor_file_sha256': sha_bytes(read_private_or_repo_file(Path(__file__).resolve())),
        'reviewer_report_sha256': sha_bytes(report_raw),
        'task_gate_path': str(gate),
        'task_gate_sha256': gate_sha,
        'proposed_count': len(plan['proposals']),
    }
    if any(bundle.get(key) != value for key, value in expected.items()):
        raise ValueError('Reviewer bundle does not bind the exact date plan and execution inputs')
    return bundle, gate, gate_sha, report_raw


def read_private_or_repo_file(path: Path) -> bytes:
    # Code inputs are checked as regular, non-writable files and opened without
    # following a final-component symlink. Their bytes are what the bundle pins.
    return _read_fd(path, allowed_uids={os.getuid(), 0}, mode_0600=False)


def verify_reviewer_gate(plan: dict, report: Path, bundle: dict,
                         gate: Path, gate_sha: str, report_raw: bytes):
    if sha_bytes(report_raw) != bundle['reviewer_report_sha256']:
        raise ValueError('Reviewer report changed after bundle validation')
    if _verified_gate() != (gate, gate_sha):
        raise ValueError('Managed task-gate executable changed after bundle validation')
    try:
        with tempfile.TemporaryDirectory(prefix='orderlist-date-review-') as private_dir:
            staged_report = Path(private_dir) / 'reviewer-report.json'
            fd = os.open(staged_report, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                         getattr(os, 'O_NOFOLLOW', 0), 0o600)
            try:
                os.write(fd, report_raw)
                os.fsync(fd)
            finally:
                os.close(fd)
            if sha_bytes(read_private_input(staged_report)) != bundle['reviewer_report_sha256']:
                raise ValueError('Staged reviewer report checksum mismatch')
            completed = subprocess.run(
                [str(gate), 'check', '--before', 'database',
                 '--reviewer-approval', str(staged_report), '--target-head', plan['repository_head']],
                cwd=ROOT, check=False, capture_output=True, text=True, timeout=30)
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError('Reviewer and task-gate verification could not run') from exc
    if completed.returncode != 0:
        raise ValueError('Reviewer or task-gate verification did not pass')
    if sha_bytes(read_reviewer_report(report)) != bundle['reviewer_report_sha256']:
        raise ValueError('Reviewer report changed during task-gate verification')
    if _verified_gate() != (gate, gate_sha):
        raise ValueError('Managed task-gate executable changed during verification')


def _conninfo_target_ok(conninfo: dict) -> bool:
    host = str(conninfo.get('host') or '').casefold()
    user = str(conninfo.get('user') or '').casefold()
    port = str(conninfo.get('port') or '5432')
    dbname = str(conninfo.get('dbname') or conninfo.get('database') or '')
    sslmode = str(conninfo.get('sslmode') or '').casefold()
    # Only the project's Virginia session pooler is accepted. Checking for a
    # project-ref substring in a host is unsafe: attacker-controlled suffixes
    # such as "<ref>.evil.example" would otherwise pass.
    return (host == POOLER_HOST and port == str(POOLER_PORT) and
            user == POOLER_USER.casefold() and dbname == DATABASE and
            sslmode == 'verify-full' and not conninfo.get('hostaddr') and
            not conninfo.get('service') and not conninfo.get('servicefile'))


def connect():
    dsn = os.environ.get('PRODUCTION_DATABASE_URL')
    if not dsn:
        raise ValueError('Protected production database connection is unavailable')
    try:
        import psycopg
        from psycopg.conninfo import conninfo_to_dict
        target = conninfo_to_dict(dsn)
        if not _conninfo_target_ok(target):
            raise ValueError('Connection does not identify the expected production project')
        # libpq reads CA files by path, so use a private pinned copy.
        with _pinned_ca_file() as ca_path:
            conn = psycopg.connect(dsn, connect_timeout=8, sslmode='verify-full',
                                   sslrootcert=str(ca_path))
        try:
            # The first target proof is a read-only session. It cannot issue
            # application SQL even if a caller reaches this function directly.
            conn.read_only = True
            # Reuse the canonical importer's live-server identity proof. The
            # DSN is only an initial guard; the connected socket and a fresh
            # server fingerprint are the actual target evidence.
            identity = shared_db_importer.assert_server_is_target(
                conn, expected_ref=TARGET, mode='production')
            if (conn.info.host != POOLER_HOST or conn.info.port != POOLER_PORT or
                    conn.info.user != POOLER_USER or conn.info.dbname != DATABASE):
                raise ValueError('Connected database parameters do not match the production target')
            if (not identity.fingerprint or
                    shared_db_importer.read_server_identity(conn).fingerprint != identity.fingerprint):
                raise ValueError('Production database identity changed during target proof')
            conn.commit()
            return conn, identity.fingerprint
        except Exception:
            conn.close()
            raise
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('Protected database connection failed') from exc


def _same_rows(actual: list[dict], expected: list[dict]) -> bool:
    return sorted((planner.canonical(x) for x in actual)) == sorted((planner.canonical(x) for x in expected))


def _dedupe_preimages(rows: list[dict], label: str) -> list[dict]:
    by_id = {}
    for row in rows:
        if not isinstance(row, dict) or not row.get('id'):
            raise ValueError(f'Frozen {label} preimage is missing its identity')
        key = str(row['id'])
        previous = by_id.get(key)
        if previous is not None and planner.canonical(previous) != planner.canonical(row):
            raise ValueError(f'Frozen plan contains conflicting duplicate {label} preimages')
        by_id[key] = row
    return [by_id[key] for key in sorted(by_id)]


def _union_preimages(plan: dict, field: str, label: str) -> list[dict]:
    rows = []
    for proposal in plan['proposals']:
        values = proposal.get(field)
        if not isinstance(values, list):
            raise ValueError(f'Frozen plan is missing its {label} preimage list')
        rows.extend(values)
    return _dedupe_preimages(rows, label)


def _batch_scope_keys(plan: dict) -> tuple[list[str], list[tuple[str, str]], list[str], list[str]]:
    d_numbers = sorted({str(p['evidence']['production_order_number']) for p in plan['proposals']})
    partitions = sorted({(str(p['source_partition'][0]), str(p['source_partition'][1]))
                         for p in plan['proposals']})
    header_ids = sorted({str(row['id']) for row in _union_preimages(
        plan, 'identity_scope_header_preimages', 'header')})
    line_ids = sorted({str(row['id']) for row in _union_preimages(
        plan, 'identity_scope_line_preimages', 'line')})
    return d_numbers, partitions, header_ids, line_ids


def _bounded_rows(conn, query: str, params: tuple, lock: str = '',
                  limit: int = MAX_BATCH_SCOPE_ROWS) -> list[dict]:
    if lock not in ('', 'SHARE', 'UPDATE'):
        raise ValueError('Unsupported batch row lock')
    suffix = f' FOR {lock}' if lock else ''
    fetched = conn.execute(
        query + f' ORDER BY row_id LIMIT %s{suffix}', (*params, limit + 1)).fetchall()
    if len(fetched) > limit:
        raise ValueError('Live order-date evidence exceeds the bounded batch scope')
    return [row[0] for row in fetched]


def _batch_customer_snapshot(conn, plan: dict | None = None, lock: bool = False) -> list[dict]:
    if plan is not None and (plan.get('customer_identity_snapshot_complete') is not True or
            plan.get('customer_identity_snapshot_row_limit') != planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT):
        raise ValueError('A complete bounded ERP customer identity snapshot is required')
    locking = ' FOR SHARE OF e, c' if lock else ''
    query = (
        'SELECT to_jsonb(mapped) AS row FROM ('
        'SELECT e.company_code, e.customer_code, e.customer_id, '
        'c.name AS canonical_name, c.display_name, c.routing_aliases, c.normalized_name, '
        'e.updated_at AS erp_updated_at, c.updated_at AS customer_updated_at '
        'FROM plm.erp_customer AS e JOIN core.customer AS c ON c.id = e.customer_id '
        f'ORDER BY e.company_code, e.customer_code LIMIT {planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT + 1}{locking}'
        ') AS mapped ORDER BY mapped.company_code, mapped.customer_code'
    )
    snapshot = [row[0] for row in conn.execute(query).fetchall()]
    if len(snapshot) > planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT:
        raise ValueError('Live ERP customer identity snapshot exceeds the 2,000-row bound')
    if plan is not None and (len(snapshot) != plan.get('customer_identity_snapshot_count') or
            planner.customer_identity_snapshot_digest(snapshot) !=
            plan.get('customer_identity_snapshot_digest')):
        raise ValueError('Complete ERP customer identity snapshot changed since planning')
    return snapshot


def _batch_live_snapshot(conn, plan: dict, lock: str = '') -> dict:
    d_numbers, partitions, header_ids, line_ids = _batch_scope_keys(plan)
    headers = _bounded_rows(conn,
        'SELECT to_jsonb(t) AS row, t.id::text AS row_id FROM plm.production_order AS t '
        'WHERE t.production_order_number = ANY(%s::text[])', (d_numbers,),
        'UPDATE' if lock in ('UPDATE', 'SHARE') else '')
    lines = _bounded_rows(conn,
        'SELECT to_jsonb(t) AS row, t.id::text AS row_id FROM plm.production_order_line AS t '
        'WHERE t.production_order_id = ANY(%s::uuid[])', (header_ids,), lock)
    refs = _bounded_rows(conn,
        'SELECT to_jsonb(t) AS row, t.id::text AS row_id FROM plm.production_order_line_source_ref AS t '
        'WHERE t.production_order_line_id = ANY(%s::uuid[])', (line_ids,), lock)
    values = ', '.join('(%s::text, %s::text)' for _ in partitions)
    partition_params = tuple(value for pair in partitions for value in pair)
    partition_clause = (
        f'EXISTS (SELECT 1 FROM (VALUES {values}) AS selected(company_code, order_no) '
        'WHERE s.company_code::text = selected.company_code AND s.prod_order_no::text = selected.order_no)'
    )
    source = _bounded_rows(conn,
        'SELECT to_jsonb(s) AS row, s.id::text AS row_id FROM coldlion.prod_history_line AS s '
        f'WHERE s.prod_reference_no::text = ANY(%s::text[]) OR {partition_clause}',
        (d_numbers, *partition_params), lock)
    customer_rows = _batch_customer_snapshot(conn, plan, lock == 'SHARE')
    return {'headers': headers, 'lines': lines, 'refs': refs,
            'source': source, 'customer_rows': customer_rows}


def _assert_batch_snapshot(plan: dict, actual: dict,
                           planned_dates: dict[str, str] | None = None):
    expected = {
        'headers': _union_preimages(plan, 'identity_scope_header_preimages', 'header'),
        'lines': _union_preimages(plan, 'identity_scope_line_preimages', 'line'),
        'refs': _union_preimages(plan, 'identity_scope_ref_preimages', 'source reference'),
        'source': _union_preimages(plan, 'identity_scope_source_preimages', 'ColdLion source'),
    }
    if planned_dates is None:
        if not _same_rows(actual['headers'], expected['headers']):
            raise ValueError('Production-order identity scope changed since planning')
    elif not _scope_headers_afterimage_matches(expected['headers'], actual['headers'], planned_dates):
        raise ValueError('Production-order header changed beyond approved order_date fields')
    for kind, label in (('lines', 'Production-order line evidence'),
                        ('refs', 'Production-order source references'),
                        ('source', 'ColdLion production-history evidence')):
        if not _same_rows(actual[kind], expected[kind]):
            raise ValueError(f'{label} changed since planning')

    for proposal in plan['proposals']:
        d_number = str(proposal['evidence']['production_order_number'])
        proposal_headers = [row for row in actual['headers']
                            if str(row.get('production_order_number')) == d_number]
        header_ids = {str(row.get('id')) for row in proposal_headers}
        proposal_lines = [row for row in actual['lines']
                          if str(row.get('production_order_id')) in header_ids]
        line_ids = {str(row.get('id')) for row in proposal_lines}
        proposal_refs = [row for row in actual['refs']
                         if str(row.get('production_order_line_id')) in line_ids]
        company, order_no = (str(x) for x in proposal['source_partition'])
        proposal_source = [row for row in actual['source'] if
            str(row.get('prod_reference_no')) == d_number or
            (str(row.get('company_code')) == company and
             str(row.get('prod_order_no')) == order_no)]
        checks = (
            (proposal_lines, proposal['identity_scope_line_preimages'], 'line'),
            (proposal_refs, proposal['identity_scope_ref_preimages'], 'source reference'),
            (proposal_source, proposal['identity_scope_source_preimages'], 'ColdLion source'),
        )
        for found, pinned, label in checks:
            if not _same_rows(found, pinned):
                raise ValueError(f'Proposal {label} scope changed since planning')
        if planned_dates is None:
            if not _same_rows(proposal_headers, proposal['identity_scope_header_preimages']):
                raise ValueError('Proposal header scope changed since planning')
        elif not _scope_headers_afterimage_matches(
                proposal['identity_scope_header_preimages'], proposal_headers, planned_dates):
            raise ValueError('Production-order header changed beyond approved order_date fields')
        customer_scope = planner.customer_identity_scope_rows(
            proposal['evidence'].get('customer_name'),
            proposal.get('customer_identity_scope_pairs', []), actual['customer_rows'])
        if not _same_rows(customer_scope, proposal['identity_scope_customer_identity_preimages']):
            raise ValueError('ERP customer identity bridge changed since planning')
        target = [row for row in proposal_headers if str(row.get('id')) == str(proposal['header_id'])]
        if len(target) != 1:
            raise ValueError('Target production-order header is missing')
        if planned_dates is None:
            if planner.canonical(target[0]) != planner.canonical(proposal['header_preimage']):
                raise ValueError('Target production-order header differs from its exact preimage')
            if target[0].get('order_date') is not None:
                raise ValueError('Target header date is no longer blank')
            if str(proposal['header_id']) in {str(x) for x in proposal.get('held_header_ids', [])}:
                raise ValueError('A held header cannot be changed')


def _bulk_update_dates(conn, plan: dict) -> dict[str, dict]:
    proposals = sorted(plan['proposals'], key=lambda p: str(p['header_id']))
    values = ', '.join('(%s::uuid, %s::date)' for _ in proposals)
    params = tuple(value for p in proposals for value in (p['header_id'], p['date']))
    rows = conn.execute(
        'UPDATE plm.production_order AS po SET order_date = approved.order_date '
        f'FROM (VALUES {values}) AS approved(id, order_date) '
        'WHERE po.id = approved.id AND po.order_date IS NULL RETURNING to_jsonb(po)',
        params).fetchall()
    after = [row[0] for row in rows]
    after_by_id = {str(row.get('id')): row for row in after}
    if len(after) != len(proposals) or len(after_by_id) != len(proposals):
        raise ValueError('Bulk date update did not affect exactly the approved headers')
    for proposal in proposals:
        actual_row = after_by_id.get(str(proposal['header_id']))
        if actual_row is None or not _afterimage_matches(
                proposal['header_preimage'], actual_row, proposal['date']):
            raise ValueError('Bulk date update did not match an approved header afterimage')
    return after_by_id


def _check_plan_scope(plan: dict):
    if not isinstance(plan.get('proposals'), list) or not plan['proposals'] or len(plan['proposals']) > MAX_PROPOSALS:
        raise ValueError('Frozen plan proposal count is outside the bounded batch limit')
    if (plan.get('customer_identity_snapshot_complete') is not True or
            plan.get('customer_identity_snapshot_row_limit') != planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT or
            not isinstance(plan.get('customer_identity_snapshot_count'), int) or
            plan['customer_identity_snapshot_count'] > planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT or
            not re.fullmatch(r'[0-9a-f]{64}', str(plan.get('customer_identity_snapshot_digest') or ''))):
        raise ValueError('Frozen plan lacks a complete bounded ERP customer identity snapshot')
    seen = set()
    for proposal in plan['proposals']:
        header_id = str(proposal.get('header_id') or '')
        if not header_id or header_id in seen:
            raise ValueError('Frozen plan has a duplicate or blank target header')
        seen.add(header_id)
        if not planner.parse_date(proposal.get('date')):
            raise ValueError('Frozen plan contains an invalid production date')
        if not isinstance(proposal.get('header_preimage'), dict) or proposal['header_preimage'].get('order_date') is not None:
            raise ValueError('Frozen plan target is not a blank header')
        if str(proposal['header_preimage'].get('id')) != header_id:
            raise ValueError('Frozen plan header identity is inconsistent')
        if header_id in {str(x) for x in proposal.get('held_header_ids', [])}:
            raise ValueError('Frozen plan attempts to change a held header')
        partition = proposal.get('source_partition')
        evidence = proposal.get('evidence')
        if (not isinstance(partition, list) or len(partition) != 2 or
                not all(isinstance(value, str) and value.strip() for value in partition) or
                not isinstance(evidence, dict) or
                not isinstance(evidence.get('production_order_number'), str) or
                not evidence['production_order_number'].strip()):
            raise ValueError('Frozen plan has incomplete batch identity keys')
        if (not proposal.get('source_row_preimages') or
                not proposal.get('identity_scope_source_preimages') or
                not proposal.get('identity_scope_header_preimages') or
                not isinstance(proposal.get('customer_identity_scope_pairs'), list) or
                not isinstance(proposal.get('identity_scope_customer_identity_preimages'), list) or
                not isinstance(proposal.get('identity_scope_line_preimages'), list) or
                not isinstance(proposal.get('identity_scope_ref_preimages'), list) or
                proposal.get('customer_identity_snapshot_complete') is not True or
                proposal.get('customer_identity_snapshot_row_limit') != planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT or
                not isinstance(proposal.get('customer_identity_snapshot_count'), int) or
                proposal['customer_identity_snapshot_count'] > planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT or
                not re.fullmatch(r'[0-9a-f]{64}', str(proposal.get('customer_identity_snapshot_digest') or ''))):
            raise ValueError('Frozen plan is missing source or identity-scope preimages')
        if (proposal.get('customer_identity_snapshot_count') != plan['customer_identity_snapshot_count'] or
                proposal.get('customer_identity_snapshot_digest') != plan['customer_identity_snapshot_digest']):
            raise ValueError('Frozen proposal and plan customer identity snapshots differ')
    for field, label in (
            ('identity_scope_header_preimages', 'header'),
            ('identity_scope_line_preimages', 'line'),
            ('identity_scope_ref_preimages', 'source reference'),
            ('identity_scope_source_preimages', 'ColdLion source')):
        _union_preimages(plan, field, label)


def _begin(conn, apply: bool):
    conn.execute('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE' + ('' if apply else ' READ ONLY'))
    conn.execute("SET LOCAL statement_timeout = '8000ms'")
    conn.execute("SET LOCAL lock_timeout = '2000ms'")
    isolation = conn.execute('SHOW transaction_isolation').fetchone()[0]
    read_only = conn.execute('SHOW transaction_read_only').fetchone()[0]
    expected_read_only = 'off' if apply else 'on'
    if str(isolation).casefold() != 'serializable':
        raise ValueError('Database transaction isolation is not serializable')
    if str(read_only).casefold() != expected_read_only:
        raise ValueError('Database transaction read-only mode does not match the operation')


def _afterimage_matches(before: dict, after: dict, expected_date: str) -> bool:
    before = dict(before)
    after = dict(after)
    before.pop('updated_at', None)
    after.pop('updated_at', None)
    before['order_date'] = expected_date
    return planner.canonical(before) == planner.canonical(after)


def _scope_headers_afterimage_matches(expected: list[dict], actual: list[dict],
                                      planned_dates: dict[str, str]) -> bool:
    actual_by_id = {str(row.get('id')): row for row in actual}
    if set(actual_by_id) != {str(row.get('id')) for row in expected}:
        return False
    for before in expected:
        header_id = str(before.get('id'))
        after = actual_by_id[header_id]
        if header_id in planned_dates:
            if not _afterimage_matches(before, after, planned_dates[header_id]):
                return False
        elif planner.canonical(before) != planner.canonical(after):
            return False
    return True


def run_preflight(plan: dict) -> dict:
    _check_plan_scope(plan)
    conn, fingerprint = connect()
    try:
        _begin(conn, apply=False)
        _verify_live_identity(conn, fingerprint)
        if not conn.execute('SELECT pg_try_advisory_xact_lock(%s)', (ADVISORY_LOCK,)).fetchone()[0]:
            raise ValueError('Another production-date plan is active')
        snapshot = _batch_live_snapshot(conn, plan)
        _assert_batch_snapshot(plan, snapshot)
        conn.rollback()
        return {'mode': 'read-only-preflight', 'proposed': len(plan['proposals']), 'changed': 0}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def apply_plan(plan: dict) -> dict:
    _check_plan_scope(plan)
    conn, fingerprint = connect()
    try:
        conn.read_only = False
        _begin(conn, apply=True)
        _verify_live_identity(conn, fingerprint)
        if not conn.execute('SELECT pg_try_advisory_xact_lock(%s)', (ADVISORY_LOCK,)).fetchone()[0]:
            raise ValueError('Another production-date plan is active')
        # Prevent new headers or ColdLion history rows from appearing in the
        # pinned identity scope while the transaction is in progress. NOWAIT
        # turns concurrent writers into a clean retry instead of a wait.
        conn.execute('LOCK TABLE plm.production_order IN SHARE MODE NOWAIT')
        conn.execute('LOCK TABLE plm.production_order_line IN SHARE MODE NOWAIT')
        conn.execute('LOCK TABLE plm.production_order_line_source_ref IN SHARE MODE NOWAIT')
        conn.execute('LOCK TABLE coldlion.prod_history_line IN SHARE MODE NOWAIT')
        if any(p.get('customer_identity_scope_pairs') for p in plan['proposals']):
            conn.execute('LOCK TABLE plm.erp_customer IN SHARE MODE NOWAIT')
            conn.execute('LOCK TABLE core.customer IN SHARE MODE NOWAIT')
        before = _batch_live_snapshot(conn, plan, lock='SHARE')
        _assert_batch_snapshot(plan, before)
        planned_dates = {p['header_id']: p['date'] for p in plan['proposals']}
        _bulk_update_dates(conn, plan)
        after = _batch_live_snapshot(conn, plan, lock='SHARE')
        _assert_batch_snapshot(plan, after, planned_dates)
        _verify_live_identity(conn, fingerprint)
        conn.commit()
        return {'mode': 'applied', 'proposed': len(plan['proposals']), 'changed': len(plan['proposals'])}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _verify_live_identity(conn, fingerprint: tuple[str, ...]):
    identity = shared_db_importer.assert_server_is_target(
        conn, expected_ref=TARGET, mode='production')
    if (conn.info.host != POOLER_HOST or conn.info.port != POOLER_PORT or
            conn.info.user != POOLER_USER or conn.info.dbname != DATABASE or
            identity.fingerprint != fingerprint or
            shared_db_importer.read_server_identity(conn).fingerprint != fingerprint):
        raise ValueError('Production database identity changed during the date operation')


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--apply', action='store_true', help='Apply the exact frozen plan (default: read-only preflight)')
    parser.add_argument('--reviewer-approval', type=Path,
                        help='Exact-head reviewer APPROVE report; mandatory with --apply')
    parser.add_argument('--reviewer-bundle', type=Path,
                        help='Protected exact-plan production-action review bundle; mandatory with --apply')
    parser.add_argument('--reviewer-bundle-sha256',
                        help='Expected SHA-256 of the protected reviewer bundle')
    args = parser.parse_args(argv)
    try:
        plan_raw = read_private_input(args.plan)
        if sha_bytes(plan_raw) != args.plan_sha256.lower():
            raise ValueError('Frozen plan file checksum mismatch')
        plan = load_frozen_plan(args.plan, args.plan_sha256, plan_raw)
        require_exact_head(plan)
        if args.apply:
            if (args.reviewer_approval is None or args.reviewer_bundle is None or
                    args.reviewer_bundle_sha256 is None):
                raise ValueError('Reviewer report and exact-plan bundle are required for apply')
            bundle_raw = read_private_input(args.reviewer_bundle)
            bundle, gate, gate_sha, report_raw = validate_reviewer_bundle(
                plan, plan_raw, args.reviewer_approval, bundle_raw,
                args.reviewer_bundle_sha256)
            verify_reviewer_gate(plan, args.reviewer_approval, bundle, gate, gate_sha, report_raw)
            result = apply_plan(plan)
        else:
            result = run_preflight(plan)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        # Do not surface driver exceptions: they may contain connection details.
        message = str(exc) if isinstance(exc, ValueError) else 'Production-date preflight/apply failed'
        print(json.dumps({'mode': 'apply' if args.apply else 'read-only-preflight', 'error': message}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
