#!/usr/bin/env python3
"""Synthetic protections for the production-date private source capture."""
from __future__ import annotations

import importlib.util
import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name('capture-orderlist-production-date-source.py')
SPEC = importlib.util.spec_from_file_location('capture_production_date_source', SCRIPT)
capturemod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capturemod)


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return [row if isinstance(row, tuple) else (row,) for row in self.rows]

    def fetchone(self):
        if not self.rows:
            return None
        return self.rows[0] if isinstance(self.rows[0], tuple) else (self.rows[0],)


class FakeConnection:
    def __init__(self):
        self.readonly_started = False
        self.rolled_back = False
        self.closed = False
        self.header = {
            'id': '11111111-1111-4111-8111-111111111111',
            'production_order_number': 'D-100', 'order_date': None,
            'metadata': {'customer_name': 'Buyer'}, 'preserved_unknown_header': 'raw',
        }
        self.line = {
            'id': '22222222-2222-4222-8222-222222222222',
            'production_order_id': self.header['id'], 'sku': 'STYLE-1',
            'preserved_unknown_line': {'x': 7},
        }
        self.ref = {
            'id': '33333333-3333-4333-8333-333333333333',
            'production_order_line_id': self.line['id'], 'source_id': 'google:line:1',
            'preserved_unknown_ref': True,
        }
        base = {
            'company_code': 'EDGEHOME', 'prod_order_no': 77, 'prod_reference_no': 'D-100',
            'source_observed_at': '2026-10-13T13:00:00Z', 'stage_code': 'ISS',
            'id': '44444444-4444-4444-8444-444444444444',
        }
        self.source = {**base, 'preserved_unknown_source': 'kept'}
        self.source_same_d_other_partition = {
            **base, 'id': '55555555-5555-4555-8555-555555555555',
            'company_code': 'OTHERCO', 'prod_order_no': 88,
            'preserved_unknown_source': 'other D partition',
        }
        self.source_same_partition_other_d = {
            **base, 'id': '66666666-6666-4666-8666-666666666666',
            'prod_reference_no': None, 'stage_code': 'REC',
            'preserved_unknown_source': 'same partition without D',
        }
        self.customer = {
            'company_code': 'EDGEHOME', 'customer_code': 'CUST-1',
            'customer_id': 'customer-1', 'canonical_name': 'Buyer',
            'display_name': 'Buyer', 'routing_aliases': [], 'normalized_name': 'buyer',
            'erp_updated_at': None, 'customer_updated_at': None,
        }
        self.source_queries = 0
        self.source_query_params = []
        self.source_query_text = []

    def execute(self, query, params=()):
        if query.startswith('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY'):
            self.readonly_started = True
            return FakeCursor([])
        if query.startswith('SET LOCAL') or query.startswith('SHOW'):
            return FakeCursor([('serializable' if 'isolation' in query else 'on',)])
        if 'FROM plm.production_order AS t' in query:
            rows = [self.header]
        elif 'FROM plm.production_order_line AS t' in query:
            rows = [self.line]
        elif 'FROM plm.production_order_line_source_ref AS t' in query:
            rows = [self.ref]
        elif 'FROM coldlion.prod_history_line AS s' in query:
            self.source_queries += 1
            self.source_query_params.append(params)
            self.source_query_text.append(query)
            rows = ([self.source, self.source_same_d_other_partition]
                    if 'EXISTS (' not in query else
                    [self.source, self.source_same_d_other_partition,
                     self.source_same_partition_other_d])
        elif 'FROM plm.erp_customer AS e JOIN core.customer AS c' in query:
            rows = [self.customer]
        else:
            raise AssertionError('Unexpected query in fake capture')
        if 'LIMIT %s' in query:
            return FakeCursor(rows[:params[-1]])
        return FakeCursor(rows)

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class CaptureTests(unittest.TestCase):
    def test_bounded_capture_keeps_full_to_json_rows_and_proves_readonly_session(self):
        connection = FakeConnection()
        with tempfile.TemporaryDirectory() as folder:
            held_path = Path(folder) / 'held.json'
            held_path.write_text(json.dumps([connection.header['id']]))
            held_path.chmod(0o600)
            held_sha = hashlib.sha256(held_path.read_bytes()).hexdigest()
            output = Path(folder) / 'private-capture.json'
            with mock.patch.object(capturemod.executor, 'connect', return_value=(connection, ('db', 'addr', 'started'))), \
                 mock.patch.object(capturemod.executor, '_verify_live_identity'), \
                 mock.patch.object(capturemod.executor, 'current_head', return_value='a' * 40), \
                 mock.patch.object(capturemod, '_now_utc', return_value=datetime(2026, 10, 13, 14, tzinfo=timezone.utc)):
                result = capturemod.capture(held_path, held_sha, output)
            body = json.loads(output.read_text())
            self.assertTrue(connection.readonly_started)
            self.assertTrue(connection.rolled_back)
            self.assertTrue(connection.closed)
            self.assertEqual(result['header_count'], 1)
            self.assertEqual(body['headers'][0]['preserved_unknown_header'], 'raw')
            self.assertEqual(body['lines'][0]['preserved_unknown_line'], {'x': 7})
            self.assertEqual(body['line_source_refs'][0]['preserved_unknown_ref'], True)
            self.assertEqual(body['prod_history_rows'][0]['preserved_unknown_source'], 'kept')
            self.assertEqual(len(body['prod_history_rows']), 3)
            self.assertEqual(len(connection.source_query_params[1]), 6)
            self.assertEqual(connection.source_query_params[1][1:-1],
                             ('EDGEHOME', '77', 'OTHERCO', '88'))
            self.assertIn('EXISTS (SELECT 1 FROM (VALUES ', connection.source_query_text[1])
            self.assertEqual(body['database_fingerprint'], ['db', 'addr', 'started'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(connection.source_queries, 2)

    def test_capture_rejects_held_id_not_in_full_header_snapshot(self):
        connection = FakeConnection()
        with self.assertRaisesRegex(ValueError, 'outside the captured headers'):
            capturemod.build_capture([connection.header], [connection.line], [connection.ref],
                [connection.source], [connection.customer], ['55555555-5555-4555-8555-555555555555'],
                ('db', 'addr', 'started'), datetime.now(timezone.utc), 'a' * 40)

    def test_capture_rejects_references_outside_full_line_snapshot(self):
        connection = FakeConnection()
        bad = {**connection.ref, 'production_order_line_id': 'missing-line'}
        with self.assertRaisesRegex(ValueError, 'outside the source capture'):
            capturemod.build_capture([connection.header], [connection.line], [bad],
                [connection.source], [connection.customer], [],
                ('db', 'addr', 'started'), datetime.now(timezone.utc), 'a' * 40)

    def test_capture_rejects_unobserved_or_future_source_rows(self):
        connection = FakeConnection()
        with self.assertRaisesRegex(ValueError, 'missing its observation timestamp'):
            capturemod.build_capture([connection.header], [connection.line], [connection.ref],
                [{**connection.source, 'source_observed_at': None}], [connection.customer], [],
                ('db', 'addr', 'started'), datetime.now(timezone.utc), 'a' * 40)
        with self.assertRaisesRegex(ValueError, 'later than capture time'):
            capturemod.build_capture([connection.header], [connection.line], [connection.ref],
                [{**connection.source, 'source_observed_at': '2027-01-01T00:00:00Z'}],
                [connection.customer], [], ('db', 'addr', 'started'),
                datetime(2026, 10, 13, tzinfo=timezone.utc), 'a' * 40)

    def test_capture_enforces_each_row_bound(self):
        with self.assertRaisesRegex(ValueError, 'configured bound'):
            capturemod.build_capture([{'id': str(i)} for i in range(capturemod.HEADER_LIMIT + 1)],
                [], [], [{'id': 'src', 'source_observed_at': '2026-10-13T00:00:00Z'}], [], [],
                ('db', 'addr', 'started'), datetime.now(timezone.utc), 'a' * 40)

    def test_held_input_must_be_owned_protected_json_array_with_unique_uuids(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'held.json'
            path.write_text('[]')
            path.chmod(0o644)
            with self.assertRaisesRegex(ValueError, 'ownership or permissions'):
                capturemod._load_held_ids(path, hashlib.sha256(b'[]').hexdigest())
            path.chmod(0o600)
            path.write_text(json.dumps(['11111111-1111-4111-8111-111111111111'] * 2))
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                capturemod._load_held_ids(path, hashlib.sha256(path.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                capturemod._load_held_ids(path, '0' * 64)

    def test_capture_output_is_outside_repo_and_exclusive(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'outside the repository'):
                capturemod._output_path(capturemod.ROOT / 'private.json')
            existing = Path(folder) / 'already.json'
            existing.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'already exists'):
                capturemod._output_path(existing)

    def test_bounded_query_rejects_limit_plus_one(self):
        class Oversized:
            def execute(self, query, params):
                return FakeCursor([{'id': str(i)} for i in range(params[-1])])
        with self.assertRaisesRegex(ValueError, 'bounded batch scope'):
            capturemod._read_rows(Oversized(), 'SELECT row', (), 2)


if __name__ == '__main__':
    unittest.main()
