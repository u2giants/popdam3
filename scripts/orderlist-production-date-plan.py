#!/usr/bin/env python3
"""Plan (and, only with an exact reviewed plan, apply) blank production PO dates.

The planner consumes a private, read-only capture. Its default mode writes a
reviewable plan file and never connects to a database. Apply is intentionally
separate and verifies the complete reviewed scope before setting order_date.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

SCHEMA = 'orderlist-production-date-plan-v1'
CAPTURE_SCHEMA = 'orderlist-production-date-capture-v1'
DB_PROJECT = 'qsllyeztdwjgirsysgai'
SO_REF = re.compile(r'^coldlion:so:([0-9]+):line:[0-9]+:component:[0-9]+$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
CUSTOMER_IDENTITY_FIELDS = (
    'company_code', 'customer_code', 'customer_id', 'canonical_name',
    'display_name', 'routing_aliases', 'normalized_name', 'erp_updated_at',
    'customer_updated_at',
)
CUSTOMER_IDENTITY_SNAPSHOT_LIMIT = 2000


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), default=str)


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def _read_protected_capture(path: Path, expected_sha256: str) -> tuple[dict, str]:
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ValueError('Protected capture cannot be opened safely') from exc
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid() or
                stat.S_IMODE(before.st_mode) != 0o600):
            raise ValueError('Protected capture must be an owned regular mode-0600 file')
        with os.fdopen(fd, 'rb', closefd=False) as handle:
            raw = handle.read()
        after = os.fstat(fd)
        stable_fields = ('st_dev', 'st_ino', 'st_uid', 'st_mode', 'st_size',
                         'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(before, field) != getattr(after, field) for field in stable_fields):
            raise ValueError('Protected capture changed while being read')
    finally:
        os.close(fd)
    actual_sha256 = hashlib.sha256(raw).hexdigest()
    if actual_sha256.lower() != expected_sha256.lower():
        raise ValueError('Capture file checksum mismatch')
    try:
        capture = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('Protected capture is not valid JSON') from exc
    if not isinstance(capture, dict):
        raise ValueError('Protected capture must contain a JSON object')
    return capture, actual_sha256


def folded(value):
    if value is None:
        return None
    text = str(value).strip()
    return text.casefold() if text else None


def exact(value):
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def parse_date(value):
    if isinstance(value, date) and not isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and DATE_RE.fullmatch(value):
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            return None
    else:
        return None
    if parsed <= date(2000, 1, 1):
        return None
    return parsed.isoformat()


def _validate_capture(capture: dict) -> tuple[list[dict], str, str]:
    if not isinstance(capture, dict) or capture.get('schema') != CAPTURE_SCHEMA:
        raise ValueError('Unsupported or missing capture schema')
    rows = capture.get('prod_history_rows')
    headers = capture.get('headers')
    lines = capture.get('lines')
    refs = capture.get('line_source_refs', [])
    if not all(isinstance(x, list) for x in (rows, headers, lines, refs)):
        raise ValueError('Capture collections must be arrays')
    customer_rows = capture.get('customer_identity_rows', [])
    if not isinstance(customer_rows, list):
        raise ValueError('Customer identity bridge rows must be an array')
    if len(customer_rows) > CUSTOMER_IDENTITY_SNAPSHOT_LIMIT:
        raise ValueError('Customer identity bridge snapshot exceeds the 2,000-row bound')
    if capture.get('customer_identity_snapshot_complete') is True and (
            capture.get('customer_identity_snapshot_row_limit') != CUSTOMER_IDENTITY_SNAPSHOT_LIMIT):
        raise ValueError('Complete customer identity bridge snapshot must pin the 2,000-row limit')
    for mapping in customer_rows:
        if not isinstance(mapping, dict) or any(field not in mapping for field in CUSTOMER_IDENTITY_FIELDS):
            raise ValueError('Customer identity bridge projection is incomplete')
        if not all(exact(mapping.get(field)) for field in ('company_code', 'customer_code', 'customer_id')):
            raise ValueError('Customer identity bridge key is incomplete')
    captured_at = _timestamp(capture.get('captured_at'))
    latest = _timestamp(capture.get('latest_source_observation_at'))
    observations = [_timestamp(r.get('source_observed_at')) for r in rows
                    if isinstance(r, dict) and r.get('source_observed_at')]
    if not observations or max(observations) != latest:
        raise ValueError('Latest source observation does not match captured source rows')
    if latest > captured_at:
        raise ValueError('Source observation is later than the capture time')
    source_digest = capture.get('source_digest')
    if not isinstance(source_digest, str) or not re.fullmatch(r'[0-9a-f]{64}', source_digest):
        raise ValueError('Capture must include a source digest')
    repository_head = capture.get('repository_head')
    if not isinstance(repository_head, str) or not re.fullmatch(r'[0-9a-f]{40}', repository_head):
        raise ValueError('Capture must pin the full repository head')
    if any(not isinstance(row, dict) or not row.get('source_observed_at') for row in rows):
        raise ValueError('Every captured source row must include its observation time')
    return rows, captured_at, latest


def _timestamp(value) -> str:
    if not isinstance(value, str):
        raise ValueError('Capture timestamps must be supplied explicitly')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Capture timestamp is invalid') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('Capture timestamps must include a timezone')
    return parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _source_order_key(row):
    company = exact(row.get('company_code'))
    number = exact(row.get('prod_order_no'))
    if not company or not number:
        return None
    return (company, number)


def _source_line_ids(row):
    return {v for v in (exact(row.get('item_no')), exact(row.get('short_item_no')),
                        exact(row.get('warehouse_sku'))) if v}


def _valid_source_partition(rows: list[dict]) -> tuple[str | None, list[dict], str | None]:
    if not rows:
        return None, [], 'no_source_rows'
    for row in rows:
        if not exact(row.get('id')) or not re.fullmatch(r'[0-9a-f]{64}', str(row.get('line_source_hash') or '')):
            return None, [], 'source_provenance_incomplete'
        if not row.get('source_observed_at'):
            return None, [], 'source_observation_missing'
        if any(key not in row or row.get(key) is not False for key in
               ('retention_identity_ambiguous', 'retention_ordering_ambiguous')):
            return None, [], 'source_partition_ambiguous'
        if row.get('partition_ambiguous') is True:
            return None, [], 'source_partition_ambiguous'
    dates = {parse_date(row.get('prod_order_date')) for row in rows}
    if None in dates:
        return None, [], 'invalid_or_sentinel_source_date'
    if len(dates) != 1:
        return None, [], 'source_date_drift'
    refs = {exact(row.get('prod_reference_no')) for row in rows}
    refs.discard(None)
    if len(refs) != 1 or any(not exact(row.get('prod_reference_no')) for row in rows):
        return None, [], 'production_reference_missing_or_conflicting'
    # Customer PO is authoritative only on ISS. Later stages commonly omit it.
    issued = [row for row in rows if row.get('stage_code') == 'ISS']
    if not issued:
        return None, [], 'no_issued_stage'
    if any(not exact(row.get('cust_po_number')) for row in issued):
        return None, [], 'issued_customer_po_missing'
    vendor_values = {folded(row.get('vendor_code')) for row in issued}
    vendor_values.discard(None)
    if len(vendor_values) != 1 or any(not folded(row.get('vendor_code')) for row in issued):
        return None, [], 'issued_vendor_missing_or_conflicting'
    customers = {folded(row.get('customer_desc')) for row in issued}
    customers.discard(None)
    if len(customers) > 1:
        return None, [], 'issued_customer_identity_conflict'
    return next(iter(dates)), issued, None


def _line_skus(lines: list[dict]) -> set[str] | None:
    values = set()
    for line in lines:
        sku = exact(line.get('sku'))
        if not sku:
            return None
        values.add(sku)
    return values or None


def _line_identity_tuple(lines: list[dict]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted(((exact(line.get('sku')) or ''),
                         (exact(line.get('customer_po_number')) or '')) for line in lines))


def _line_match_reason(target_lines: list[dict], source_rows: list[dict]) -> str | None:
    target_pairs = set()
    for line in target_lines:
        sku, po = exact(line.get('sku')), exact(line.get('customer_po_number'))
        if not sku or not po:
            return 'target_line_identity_missing'
        target_pairs.add((sku, po))
    source_pairs = set()
    for row in source_rows:
        po = exact(row.get('cust_po_number'))
        sku_candidates = {sku for sku, _target_po in target_pairs if sku in _source_line_ids(row)}
        if not sku_candidates:
            return 'style_identity_mismatch'
        if len(sku_candidates) != 1:
            return 'style_identity_ambiguous'
        sku = next(iter(sku_candidates))
        if (sku, po) not in target_pairs:
            return 'customer_po_mismatch'
        source_pairs.add((sku, po))
    return None if target_pairs == source_pairs else 'style_identity_mismatch'


def _customer_aliases(row: dict) -> set[str]:
    aliases = set()
    for field in ('canonical_name', 'display_name', 'normalized_name'):
        value = row.get(field)
        if isinstance(value, str) and value.strip():
            aliases.add(value.strip().casefold())
    values = row.get('routing_aliases')
    if isinstance(values, str):
        values = [values]
    if isinstance(values, list):
        aliases.update(value.strip().casefold() for value in values
                       if isinstance(value, str) and value.strip())
    return aliases


def customer_identity_scope_rows(customer_name: str | None, source_pairs: list[list[str]],
                                 identity_rows: list[dict]) -> list[dict]:
    wanted = folded(customer_name)
    pairs = {(exact(pair[0]), exact(pair[1])) for pair in source_pairs if len(pair) == 2}
    scoped = [row for row in identity_rows
              if (exact(row.get('company_code')), exact(row.get('customer_code'))) in pairs
              or (wanted and wanted in _customer_aliases(row))]
    return sorted(scoped, key=lambda row: (exact(row.get('company_code')) or '',
                                           exact(row.get('customer_code')) or '',
                                           exact(row.get('customer_id')) or ''))


def customer_identity_snapshot_digest(rows: list[dict]) -> str:
    projected = [{field: row.get(field) for field in CUSTOMER_IDENTITY_FIELDS} for row in rows]
    projected.sort(key=lambda row: (exact(row.get('company_code')) or '',
                                    exact(row.get('customer_code')) or '',
                                    exact(row.get('customer_id')) or ''))
    return digest(projected)


def _customer_bridge_scope(customer_name: str | None, issued: list[dict],
                           identity_rows: list[dict], complete: bool,
                           applicable_pairs: list[tuple[str, str]] | None = None) -> tuple[str, list[dict], list[list[str]]]:
    wanted = folded(customer_name)
    if not wanted:
        return 'unavailable', [], []
    source_pairs = sorted({
        (exact(row.get('company_code')), exact(row.get('customer_code')))
        for row in issued
        if exact(row.get('company_code')) and exact(row.get('customer_code'))
    })
    if not source_pairs or len(source_pairs) != len({
            (exact(row.get('company_code')), exact(row.get('customer_code'))) for row in issued}):
        return 'unavailable', [], [list(pair) for pair in (applicable_pairs or source_pairs)]
    frozen_pairs = sorted(set(applicable_pairs or source_pairs))
    scoped_rows = customer_identity_scope_rows(wanted, [list(pair) for pair in frozen_pairs], identity_rows)
    if not complete:
        return 'unavailable', scoped_rows, [list(pair) for pair in frozen_pairs]
    by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in identity_rows:
        company = exact(row.get('company_code'))
        code = exact(row.get('customer_code'))
        if company and code:
            by_pair[(company, code)].append(row)
    customer_ids = set()
    for pair in source_pairs:
        if len(by_pair.get(pair, [])) != 1:
            return 'unavailable', scoped_rows, [list(x) for x in frozen_pairs]
        customer_id = exact(by_pair[pair][0].get('customer_id'))
        if not customer_id:
            return 'unavailable', scoped_rows, [list(x) for x in frozen_pairs]
        customer_ids.add(customer_id)
    if len(customer_ids) != 1:
        return 'ambiguous', scoped_rows, [list(x) for x in frozen_pairs]
    # A display name or routing alias shared by different customer IDs is not
    # sufficient evidence, even when the particular ERP code appears valid.
    alias_owners = {
        exact(row.get('customer_id'))
        for row in identity_rows
        if wanted in _customer_aliases(row) and exact(row.get('customer_id'))
    }
    if alias_owners != customer_ids:
        return ('ambiguous' if alias_owners else 'alias_mismatch',
                scoped_rows, [list(pair) for pair in frozen_pairs])
    mapped_aliases = set().union(*(
        _customer_aliases(row) for row in identity_rows
        if exact(row.get('customer_id')) in customer_ids
    )) if customer_ids else set()
    return ('match' if wanted in mapped_aliases else 'alias_mismatch',
            scoped_rows, [list(pair) for pair in frozen_pairs])


def _source_ref_route_status(target_lines: list[dict], refs_by_line: dict[str, list[dict]],
                             source_rows: list[dict]) -> str:
    cold_refs = {str(line.get('id')): [ref for ref in refs_by_line.get(str(line.get('id')), [])
                                       if ref.get('source_system') == 'coldlion']
                 for line in target_lines}
    if not any(cold_refs.values()):
        return 'absent'
    for line in target_lines:
        sku, po = exact(line.get('sku')), exact(line.get('customer_po_number'))
        matches = [row for row in source_rows if po == exact(row.get('cust_po_number'))
                   and sku in _source_line_ids(row)]
        refs_for_line = cold_refs.get(str(line.get('id')), [])
        parsed_refs = [SO_REF.fullmatch(str(ref.get('source_id') or '')) for ref in refs_for_line]
        sales_order_numbers = {str(row.get('sales_order_no')) for row in matches
                               if row.get('sales_order_link_present') is True
                               and row.get('sales_order_no') not in (None, 0, '0')}
        if not matches or len(sales_order_numbers) != 1 or len(parsed_refs) != 1 or not parsed_refs[0]:
            return 'mismatch'
        if parsed_refs[0].group(1) != next(iter(sales_order_numbers)):
            return 'mismatch'
    return 'match' if target_lines else 'absent'


def _matches(header: dict, target_lines: list[dict], all_headers: list[dict],
             lines_by_header: dict[str, list[dict]], refs_by_line: dict[str, list[dict]],
             source_rows: list[dict], held: set[str],
             identity_rows: list[dict], identity_snapshot_complete: bool,
             identity_scope_pairs: list[tuple[str, str]]) -> tuple[bool, str | None, str | None, list[dict]]:
    header_id = str(header.get('id'))
    if header_id in held:
        return False, None, 'held_header', []
    if header.get('order_date') is not None:
        return False, None, 'date_already_set', []
    if exact(header.get('production_order_number')) != exact(source_rows[0].get('prod_reference_no')):
        return False, None, 'production_number_mismatch', []
    source_date, issued, reason = _valid_source_partition(source_rows)
    if reason:
        return False, None, reason, issued
    line_reason = _line_match_reason(target_lines, issued)
    if line_reason:
        return False, None, line_reason, issued
    metadata = header.get('metadata') if isinstance(header.get('metadata'), dict) else {}
    customer = folded(metadata.get('customer_name'))
    source_customers = {folded(row.get('customer_desc')) for row in issued}
    source_customers.discard(None)
    vendor_id = folded(metadata.get('vendor_id_raw'))
    source_vendors = {folded(row.get('vendor_code')) for row in issued}
    source_vendors.discard(None)
    # This is an exact per-line corroboration, not a loose header-level overlap.
    route_ref_status = _source_ref_route_status(target_lines, refs_by_line, issued)
    if route_ref_status == 'mismatch':
        return False, None, 'coldlion_source_ref_contradiction', issued
    route_ref = route_ref_status == 'match'
    route_metadata = bool(customer) and source_customers == {customer}
    route_bridge_status, _, _ = _customer_bridge_scope(
        customer, issued, identity_rows, identity_snapshot_complete, identity_scope_pairs)
    route_bridge = route_bridge_status == 'match'
    if not (route_metadata or route_ref or route_bridge):
        return False, None, 'customer_identity_unverified', issued
    if not vendor_id:
        return False, None, 'vendor_identity_missing', issued
    if source_vendors != {vendor_id}:
        return False, None, 'vendor_identity_mismatch', issued
    # Fail if another production order has the same strong identity. Include held
    # and already-dated headers in the competition set so they cannot be ignored.
    identity = (exact(header.get('production_order_number')), vendor_id,
                _line_identity_tuple(target_lines))
    competitors = []
    for other in all_headers:
        other_id = str(other.get('id'))
        if other_id == header_id:
            continue
        other_lines = lines_by_header.get(other_id, [])
        other_identity = (exact(other.get('production_order_number')),
                          folded((other.get('metadata') or {}).get('vendor_id_raw'))
                          if isinstance(other.get('metadata'), dict) else None,
                          _line_identity_tuple(other_lines))
        if other_identity == identity:
            competitors.append(other)
    if competitors:
        return False, None, 'duplicate_target_identity', issued
    return True, source_date, None, issued


def build_plan(capture: dict, capture_file_sha256: str | None = None) -> dict:
    rows, captured_at, latest = _validate_capture(capture)
    headers = capture['headers']
    lines = capture['lines']
    refs = capture.get('line_source_refs', [])
    held = {str(x) for x in capture.get('held_header_ids', [])}
    if len({str(h.get('id')) for h in headers}) != len(headers):
        raise ValueError('Duplicate target header preimage')
    if len({str(l.get('id')) for l in lines}) != len(lines):
        raise ValueError('Duplicate target line preimage')
    lines_by_header: dict[str, list[dict]] = defaultdict(list)
    for line in lines:
        lines_by_header[str(line.get('production_order_id'))].append(line)
    refs_by_line: dict[str, list[dict]] = defaultdict(list)
    for ref in refs:
        refs_by_line[str(ref.get('production_order_line_id'))].append(ref)
    headers_by_number: dict[str, list[dict]] = defaultdict(list)
    for header in headers:
        number = exact(header.get('production_order_number'))
        if number:
            headers_by_number[number].append(header)
    source_groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        key = _source_order_key(row)
        if key and key[0] == 'EDGEHOME':
            source_groups[key].append(row)
    proposals, unresolved = [], []
    definite_nonmatches = {
        'production_number_mismatch', 'held_header', 'date_already_set',
        'vendor_identity_mismatch', 'customer_po_mismatch', 'style_identity_mismatch',
    }
    for header in headers:
        header_id = str(header.get('id'))
        target_lines = lines_by_header.get(header_id, [])
        if not target_lines:
            continue
        potential = []
        for key, source_rows in source_groups.items():
            if exact(header.get('production_order_number')) != exact(source_rows[0].get('prod_reference_no')):
                continue
            identity_scope_rows = [
                row for row in rows
                if (exact(row.get('prod_reference_no')) == exact(header.get('production_order_number')) or
                    _source_order_key(row) == key)
            ]
            scope_pairs = {
                (exact(row.get('company_code')), exact(row.get('customer_code')))
                for row in identity_scope_rows
                if exact(row.get('company_code')) and exact(row.get('customer_code'))
            }
            all_identity_rows = capture.get('customer_identity_rows', [])
            identity_rows = [
                {field: mapping.get(field) for field in CUSTOMER_IDENTITY_FIELDS}
                for mapping in all_identity_rows if isinstance(mapping, dict)
            ]
            ok, proposed_date, reason, issued = _matches(
                header, target_lines, headers_by_number.get(exact(header.get('production_order_number')), []),
                lines_by_header, refs_by_line, source_rows, held, identity_rows,
                capture.get('customer_identity_snapshot_complete') is True and
                capture.get('customer_identity_snapshot_row_limit') == CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
                sorted(scope_pairs))
            if ok:
                potential.append((key, source_rows, issued, proposed_date,
                                  identity_scope_rows, scope_pairs))
            elif reason not in definite_nonmatches:
                # Track only potentially relevant rows: exact production number.
                unresolved.append({'header_id': header_id, 'reason': reason,
                                   'source_partition': list(key),
                                   'header_preimage': deepcopy(header),
                                   'line_preimages': deepcopy(target_lines)})
        if len(potential) > 1:
            unresolved.append({'header_id': header_id, 'reason': 'multiple_source_orders_match',
                               'header_preimage': deepcopy(header), 'line_preimages': deepcopy(target_lines)})
            continue
        if len(potential) == 1:
            (key, source_rows, issued, proposed_date,
             identity_scope_rows, scope_pairs) = potential[0]
            header_metadata = header.get('metadata') if isinstance(header.get('metadata'), dict) else {}
            header_customer = folded(header_metadata.get('customer_name'))
            issued_customer_names = {folded(row.get('customer_desc')) for row in issued}
            bridge_status, bridge_rows, bridge_pairs = _customer_bridge_scope(
                header_customer, issued, identity_rows,
                capture.get('customer_identity_snapshot_complete') is True and
                capture.get('customer_identity_snapshot_row_limit') == CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
                sorted(scope_pairs))
            # Every target line must have resolved against that one source partition.
            proposal = {
                'header_id': header_id,
                'date': proposed_date,
                'header_preimage': deepcopy(header),
                'held_header_ids': sorted(held),
                'line_preimages': deepcopy(target_lines),
                'source_partition': list(key),
                'source_row_preimages': deepcopy(source_rows),
                # Lock and recheck every captured ColdLion row that carries
                # this production reference, including other company/order
                # partitions that could appear after the initial comparison.
                'identity_scope_source_preimages': deepcopy(identity_scope_rows),
                'customer_identity_scope_pairs': bridge_pairs,
                'identity_scope_customer_identity_preimages': deepcopy(bridge_rows),
                'customer_identity_snapshot_complete': capture.get('customer_identity_snapshot_complete') is True,
                'customer_identity_snapshot_row_limit': capture.get('customer_identity_snapshot_row_limit'),
                'customer_identity_snapshot_count': len(identity_rows),
                'customer_identity_snapshot_digest': customer_identity_snapshot_digest(identity_rows),
                'source_line_source_refs': deepcopy([
                    ref for line in target_lines for ref in refs_by_line.get(str(line.get('id')), [])
                ]),
                'identity_scope_header_preimages': deepcopy(
                    headers_by_number.get(exact(header.get('production_order_number')), [])),
                'identity_scope_line_preimages': deepcopy([
                    line for other in headers_by_number.get(exact(header.get('production_order_number')), [])
                    for line in lines_by_header.get(str(other.get('id')), [])
                ]),
                'identity_scope_ref_preimages': deepcopy([
                    ref for other in headers_by_number.get(exact(header.get('production_order_number')), [])
                    for line in lines_by_header.get(str(other.get('id')), [])
                    for ref in refs_by_line.get(str(line.get('id')), [])
                ]),
                'match_route': (
                    'coldlion_sales_order_reference'
                    if _source_ref_route_status(target_lines, refs_by_line, issued) == 'match'
                    else 'exact_customer_name'
                    if header_customer and issued_customer_names == {header_customer}
                    else 'erp_customer_bridge'
                ),
                'evidence': {
                    'production_order_number': exact(header.get('production_order_number')),
                    'customer_po_number': exact(issued[0].get('cust_po_number')),
                    'vendor_id_raw': header_metadata.get('vendor_id_raw'),
                    'customer_name': header_metadata.get('customer_name'),
                    'target_skus': sorted(_line_skus(target_lines) or set()),
                    'source_line_ids': [sorted(_source_line_ids(row)) for row in issued],
                    'source_row_ids': [row.get('id') for row in source_rows],
                    'source_hashes': sorted({row.get('line_source_hash') for row in source_rows}),
                    'source_observations': sorted({row.get('source_observed_at') for row in source_rows}),
                },
            }
            proposals.append(proposal)
    plan = {
        'schema': SCHEMA,
        'database_project': DB_PROJECT,
        'capture_digest': digest(capture),
        'capture_file_sha256': capture_file_sha256,
        'capture_source_digest': capture['source_digest'],
        'repository_head': capture['repository_head'],
        'captured_at': captured_at,
        'latest_source_observation_at': latest,
        'source_row_count': len(rows),
        'customer_identity_snapshot_complete': capture.get('customer_identity_snapshot_complete') is True,
        'customer_identity_snapshot_row_limit': capture.get('customer_identity_snapshot_row_limit'),
        'customer_identity_snapshot_count': len(capture.get('customer_identity_rows', [])),
        'customer_identity_snapshot_digest': customer_identity_snapshot_digest(capture.get('customer_identity_rows', [])),
        'header_count': len(headers),
        'held_header_count': len(held),
        'proposals': proposals,
        'unresolved': unresolved,
        'counts': {'proposed': len(proposals), 'unresolved': len(unresolved),
                   'unchanged_held': sum(1 for h in headers if str(h.get('id')) in held),
                   'unchanged_nonblank': sum(1 for h in headers if h.get('order_date') is not None)},
    }
    plan['plan_sha256'] = digest(plan)
    return plan


def _write_private_exclusive(path: Path, content: bytes):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True, help='Private JSON capture file')
    parser.add_argument('--capture-sha256', required=True)
    parser.add_argument('--plan-output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        capture, actual = _read_protected_capture(args.capture, args.capture_sha256)
        plan = build_plan(capture, actual)
        _write_private_exclusive(args.plan_output, (canonical(plan) + '\n').encode('utf-8'))
        print(json.dumps({'mode': 'plan-only', 'plan_sha256': plan['plan_sha256'],
                          'counts': plan['counts']}, sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({'mode': 'plan-only', 'error': str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
