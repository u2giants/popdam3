#!/usr/bin/env python3
"""Create a bounded, protected read-only capture for production-date planning."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
HEADER_LIMIT = 10_000
LINE_LIMIT = 50_000
REF_LIMIT = 50_000
SOURCE_LIMIT = 100_000
MAX_CAPTURE_BYTES = 128 * 1024 * 1024

SPEC = importlib.util.spec_from_file_location(
    'apply_production_date_plan', ROOT / 'scripts' / 'apply-orderlist-production-date-plan.py')
executor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = executor
SPEC.loader.exec_module(executor)
planner = executor.planner


def _utc_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _load_held_ids(path: Path, expected_sha256: str) -> list[str]:
    raw = executor.read_private_input(path)
    if hashlib.sha256(raw).hexdigest() != expected_sha256.lower():
        raise ValueError('Held-header input checksum mismatch')
    try:
        values = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('Held-header input must be a protected JSON array') from exc
    if not isinstance(values, list):
        raise ValueError('Held-header input must be a protected JSON array')
    result = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError('Held-header identities must be UUID strings')
        try:
            normalized = str(UUID(value))
        except ValueError as exc:
            raise ValueError('Held-header identities must be UUID strings') from exc
        if value.casefold() != normalized:
            raise ValueError('Held-header identities must use canonical UUID form')
        result.append(normalized)
    if len(result) != len(set(result)):
        raise ValueError('Held-header input contains duplicate identities')
    return result


def _output_path(path: Path) -> Path:
    return planner._validate_private_output_path(path)


def _ids(rows: list[dict], field: str) -> list[str]:
    result = []
    for row in rows:
        value = row.get(field)
        if value is None or not str(value):
            raise ValueError(f'Captured rows are missing {field}')
        result.append(str(value))
    if len(result) != len(set(result)):
        raise ValueError(f'Captured rows contain duplicate {field}')
    return result


def _read_rows(conn, sql: str, params: tuple, limit: int) -> list[dict]:
    return executor._bounded_rows(conn, sql, params, limit=limit)


def _capture_rows(conn) -> tuple[list[dict], list[dict], list[dict], list[dict], list[dict]]:
    headers = _read_rows(
        conn,
        'SELECT to_jsonb(t) AS row, t.id::text AS row_id FROM plm.production_order AS t',
        (), HEADER_LIMIT)
    header_ids = _ids(headers, 'id')
    # Keep source-number spelling byte-for-byte: candidates are joined by exact
    # equality below, and no whitespace/case normalization is an identity rule.
    d_numbers = sorted({str(row['production_order_number'])
                        for row in headers
                        if row.get('production_order_number') is not None and
                        str(row['production_order_number']) != ''})
    if d_numbers:
        d_sources = _read_rows(
            conn,
            'SELECT to_jsonb(s) AS row, s.id::text AS row_id FROM coldlion.prod_history_line AS s '
            'WHERE s.prod_reference_no::text = ANY(%s::text[])', (d_numbers,), SOURCE_LIMIT)
        partitions = sorted({(str(row['company_code']), str(row['prod_order_no']))
                             for row in d_sources
                             if row.get('company_code') is not None and row.get('prod_order_no') is not None})
        if partitions:
            values = ', '.join('(%s::text, %s::text)' for _ in partitions)
            partition_params = tuple(part for pair in partitions for part in pair)
            clause = ('EXISTS (SELECT 1 FROM (VALUES ' + values +
                      ') AS selected(company_code, order_no) '
                      'WHERE s.company_code::text = selected.company_code '
                      'AND s.prod_order_no::text = selected.order_no)')
        else:
            clause = 'FALSE'
            partition_params = ()
        source_rows = _read_rows(
            conn,
            'SELECT to_jsonb(s) AS row, s.id::text AS row_id FROM coldlion.prod_history_line AS s '
            f'WHERE s.prod_reference_no::text = ANY(%s::text[]) OR {clause}',
            (d_numbers, *partition_params), SOURCE_LIMIT)
    else:
        d_sources = []
        source_rows = []
    _ids(source_rows, 'id')
    if not source_rows:
        raise ValueError('ColdLion production-history capture contains no source rows')

    # Preserve every header sharing an exact source D-number, including
    # competitors, but do not serialize unrelated production-order lines.
    matched_d_numbers = {str(row['prod_reference_no']) for row in d_sources
                         if row.get('prod_reference_no') is not None}
    candidate_header_ids = [str(row['id']) for row in headers
                            if row.get('production_order_number') is not None and
                            str(row['production_order_number']) in matched_d_numbers]
    if candidate_header_ids:
        lines = _read_rows(
            conn,
            'SELECT to_jsonb(t) AS row, t.id::text AS row_id FROM plm.production_order_line AS t '
            'WHERE t.production_order_id = ANY(%s::uuid[])',
            (candidate_header_ids,), LINE_LIMIT)
    else:
        lines = []
    line_ids = _ids(lines, 'id')
    if line_ids:
        refs = _read_rows(
            conn,
            'SELECT to_jsonb(t) AS row, t.id::text AS row_id FROM plm.production_order_line_source_ref AS t '
            'WHERE t.production_order_line_id = ANY(%s::uuid[])',
            (line_ids,), REF_LIMIT)
    else:
        refs = []

    customer_rows = executor._batch_customer_snapshot(conn, plan=None)
    if len(customer_rows) > planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT:
        raise ValueError('ERP customer identity snapshot exceeds the 2,000-row bound')
    return headers, lines, refs, source_rows, customer_rows


def build_capture(headers: list[dict], lines: list[dict], refs: list[dict],
                  source_rows: list[dict], customer_rows: list[dict],
                  held_ids: list[str], database_fingerprint: tuple[str, ...],
                  captured_at: datetime, repository_head: str) -> dict:
    header_ids = set(_ids(headers, 'id'))
    if not set(held_ids).issubset(header_ids):
        raise ValueError('Held-header input contains an identity outside the captured headers')
    line_ids = set(_ids(lines, 'id'))
    if any(str(line.get('production_order_id')) not in header_ids for line in lines):
        raise ValueError('Captured line refers to a header outside the source capture')
    if any(str(ref.get('production_order_line_id')) not in line_ids for ref in refs):
        raise ValueError('Captured source reference refers to a line outside the source capture')
    if len(headers) > HEADER_LIMIT or len(lines) > LINE_LIMIT or len(refs) > REF_LIMIT or len(source_rows) > SOURCE_LIMIT:
        raise ValueError('Captured source rows exceed a configured bound')
    if len(customer_rows) > planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT:
        raise ValueError('ERP customer identity snapshot exceeds the 2,000-row bound')
    observations = []
    for row in source_rows:
        value = row.get('source_observed_at')
        if not value:
            raise ValueError('A ColdLion source row is missing its observation timestamp')
        observations.append(planner._parse_timestamp(value))
    latest = max(observations)
    captured = captured_at.astimezone(timezone.utc)
    if latest > captured:
        raise ValueError('A ColdLion source observation is later than capture time')
    if (len(database_fingerprint) != 3 or
            not all(isinstance(value, str) and value for value in database_fingerprint)):
        raise ValueError('Virginia database fingerprint is incomplete')
    if len(repository_head) != 40 or any(ch not in '0123456789abcdef' for ch in repository_head):
        raise ValueError('Current repository head is not a full Git SHA')
    return {
        'schema': planner.CAPTURE_SCHEMA,
        'captured_at': _utc_text(captured),
        'latest_source_observation_at': _utc_text(latest),
        'source_digest': planner.digest(source_rows),
        'repository_head': repository_head,
        'database_project': executor.TARGET,
        'database_region': 'us-east-1',
        'database_host': executor.POOLER_HOST,
        'database_port': executor.POOLER_PORT,
        'database_name': executor.DATABASE,
        'database_fingerprint': list(database_fingerprint),
        'headers': headers,
        'lines': lines,
        'line_source_refs': refs,
        'held_header_ids': sorted(held_ids),
        'prod_history_rows': source_rows,
        'customer_identity_rows': customer_rows,
        'customer_identity_snapshot_complete': True,
        'customer_identity_snapshot_row_limit': planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
    }


def capture(held_path: Path, held_sha256: str, output: Path) -> dict:
    held_ids = _load_held_ids(held_path, held_sha256)
    output_path = _output_path(output)
    conn, fingerprint = executor.connect()
    try:
        executor._begin(conn, apply=False)
        headers, lines, refs, source_rows, customer_rows = _capture_rows(conn)
        captured = build_capture(headers, lines, refs, source_rows, customer_rows,
                                 held_ids, fingerprint, _now_utc(),
                                 executor.current_head())
        executor._verify_live_identity(conn, fingerprint)
        raw = (planner.canonical(captured) + '\n').encode('utf-8')
        if len(raw) > MAX_CAPTURE_BYTES:
            raise ValueError('Serialized capture exceeds the 128 MiB bound')
        planner._write_private_exclusive(output_path, raw)
        if output_path.stat().st_mode & 0o777 != 0o600:
            raise ValueError('Capture output was not created with mode 0600')
        return {'path': str(output_path), 'sha256': hashlib.sha256(raw).hexdigest(),
                'header_count': len(headers), 'line_count': len(lines),
                'source_count': len(source_rows), 'held_header_count': len(held_ids),
                'customer_identity_count': len(customer_rows)}
    finally:
        conn.rollback()
        conn.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--held-header-ids', type=Path, required=True,
                        help='Private mode-0600 JSON array of held header UUIDs')
    parser.add_argument('--held-header-ids-sha256', required=True,
                        help='Expected SHA-256 of the exact protected held-header file')
    parser.add_argument('--output', type=Path, required=True,
                        help='Exclusive private capture output outside the repository')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(capture(args.held_header_ids, args.held_header_ids_sha256,
                                 args.output), sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({'error': str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
