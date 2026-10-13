#!/usr/bin/env python3
"""Synthetic safety tests for the frozen date-plan executor."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import copy
import os
from pathlib import Path
import stat
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock
import subprocess
import types

SCRIPT = Path(__file__).with_name('apply-orderlist-production-date-plan.py')
SPEC = importlib.util.spec_from_file_location('apply_production_date_plan', SCRIPT)
executor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(executor)


def frozen_plan():
    customer_rows = [{
        'company_code': 'EDGEHOME', 'customer_code': 'CUST-1',
        'customer_id': 'customer-1', 'canonical_name': 'Customer One',
    }]
    snapshot_digest = executor.planner.customer_identity_snapshot_digest(customer_rows)
    plan = {
        'schema': executor.planner.SCHEMA,
        'database_project': executor.TARGET,
        'database_region': executor.planner.DB_REGION,
        'database_host': executor.POOLER_HOST,
        'database_port': executor.POOLER_PORT,
        'database_name': executor.DATABASE,
        'database_fingerprint': ['db', 'addr', 'started'],
        'repository_head': '1' * 40,
        'capture_file_sha256': '2' * 64,
        'capture_source_digest': '3' * 64,
        'customer_identity_snapshot_complete': True,
        'customer_identity_snapshot_row_limit': executor.planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
        'customer_identity_snapshot_count': len(customer_rows),
        'customer_identity_snapshot_digest': snapshot_digest,
        'proposals': [{
            'header_id': 'header-1', 'date': '2024-03-04', 'held_header_ids': [],
            'header_preimage': {'id': 'header-1', 'production_order_number': 'D-1',
                                'order_date': None, 'updated_at': 'before', 'metadata': {'x': 'y'}},
            'source_partition': ['EDGEHOME', '55'],
            'source_row_preimages': [{'id': 'source-1'}],
            'identity_scope_source_preimages': [{'id': 'source-1'}],
            'identity_scope_line_preimages': [],
            'identity_scope_ref_preimages': [],
            'customer_identity_scope_pairs': [['EDGEHOME', 'CUST-1']],
            'identity_scope_customer_identity_preimages': customer_rows,
            'customer_identity_snapshot_complete': True,
            'customer_identity_snapshot_row_limit': executor.planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
            'customer_identity_snapshot_count': len(customer_rows),
            'customer_identity_snapshot_digest': snapshot_digest,
            'evidence': {'production_order_number': 'D-1', 'customer_name': 'Customer One'},
            'identity_scope_header_preimages': [{'id': 'header-1'}],
        }],
    }
    plan['plan_sha256'] = executor.planner.digest(plan)
    return plan


def batch_plan():
    customer_rows = [
        {'company_code': 'EDGEHOME', 'customer_code': 'CUST-1', 'customer_id': 'customer-1',
         'canonical_name': 'Customer One'},
        {'company_code': 'OTHERCO', 'customer_code': 'CUST-2', 'customer_id': 'customer-2',
         'canonical_name': 'Customer Two'},
    ]
    headers = [
        {'id': '00000000-0000-0000-0000-000000000001', 'production_order_number': 'D-10',
         'order_date': None, 'updated_at': 'before-1', 'metadata': {'customer_name': 'Customer One'}},
        {'id': '00000000-0000-0000-0000-000000000002', 'production_order_number': 'D-10',
         'order_date': None, 'updated_at': 'before-2', 'metadata': {'customer_name': 'Customer Two'}},
    ]
    lines = [
        {'id': '00000000-0000-0000-0000-000000000011', 'production_order_id': headers[0]['id'], 'sku': 'SKU-1'},
        {'id': '00000000-0000-0000-0000-000000000012', 'production_order_id': headers[1]['id'], 'sku': 'SKU-2'},
    ]
    refs = [
        {'id': '00000000-0000-0000-0000-000000000021', 'production_order_line_id': lines[0]['id'],
         'source_id': 'coldlion:so:1:line:1:component:1'},
        {'id': '00000000-0000-0000-0000-000000000022', 'production_order_line_id': lines[1]['id'],
         'source_id': 'coldlion:so:2:line:1:component:1'},
    ]
    source = [
        {'id': 'source-1', 'company_code': 'EDGEHOME', 'prod_order_no': 55,
         'prod_reference_no': 'D-10', 'prod_order_date': '2024-03-04'},
        {'id': 'source-2', 'company_code': 'OTHERCO', 'prod_order_no': 77,
         'prod_reference_no': 'D-10', 'prod_order_date': '2025-03-04'},
        {'id': 'source-3', 'company_code': 'EDGEHOME', 'prod_order_no': 55,
         'prod_reference_no': None, 'prod_order_date': '2024-03-04'},
        {'id': 'source-4', 'company_code': 'OTHERCO', 'prod_order_no': 77,
         'prod_reference_no': None, 'prod_order_date': '2025-03-04'},
    ]
    bridge_digest = executor.planner.customer_identity_snapshot_digest(customer_rows)
    proposals = []
    for i, (header, customer, company, order_no, date) in enumerate((
            (headers[0], customer_rows[0], 'EDGEHOME', '55', '2024-03-04'),
            (headers[1], customer_rows[1], 'OTHERCO', '77', '2025-03-04'))):
        scoped_source = [row for row in source if row['prod_reference_no'] == 'D-10' or
                         (row['company_code'] == company and str(row['prod_order_no']) == order_no)]
        proposals.append({
            'header_id': header['id'], 'date': date, 'held_header_ids': [],
            'header_preimage': header, 'source_partition': [company, order_no],
            'source_row_preimages': scoped_source,
            'identity_scope_source_preimages': scoped_source,
            'identity_scope_header_preimages': headers,
            'identity_scope_line_preimages': lines,
            'identity_scope_ref_preimages': refs,
            'identity_scope_customer_identity_preimages': [customer],
            'customer_identity_scope_pairs': [[company, customer['customer_code']]],
            'customer_identity_snapshot_complete': True,
            'customer_identity_snapshot_row_limit': executor.planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
            'customer_identity_snapshot_count': len(customer_rows),
            'customer_identity_snapshot_digest': bridge_digest,
            'evidence': {'production_order_number': 'D-10',
                         'customer_name': customer['canonical_name']},
        })
    return {
        'schema': executor.planner.SCHEMA,
        'database_project': executor.TARGET,
        'database_region': executor.planner.DB_REGION,
        'database_host': executor.POOLER_HOST,
        'database_port': executor.POOLER_PORT,
        'database_name': executor.DATABASE,
        'database_fingerprint': ['db', 'addr', 'started'],
        'repository_head': '1' * 40,
        'capture_file_sha256': '2' * 64,
        'capture_source_digest': '3' * 64,
        'customer_identity_snapshot_complete': True,
        'customer_identity_snapshot_row_limit': executor.planner.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
        'customer_identity_snapshot_count': len(customer_rows),
        'customer_identity_snapshot_digest': bridge_digest,
        'proposals': proposals,
    }


class BatchSnapshotConnection:
    def __init__(self, plan):
        self.plan = plan
        self.queries = []
        self.snapshot = {
            'headers': executor._union_preimages(plan, 'identity_scope_header_preimages', 'header'),
            'lines': executor._union_preimages(plan, 'identity_scope_line_preimages', 'line'),
            'refs': executor._union_preimages(plan, 'identity_scope_ref_preimages', 'ref'),
            'source': executor._union_preimages(plan, 'identity_scope_source_preimages', 'source'),
            'customer_rows': [
                {'company_code': 'EDGEHOME', 'customer_code': 'CUST-1', 'customer_id': 'customer-1',
                 'canonical_name': 'Customer One'},
                {'company_code': 'OTHERCO', 'customer_code': 'CUST-2', 'customer_id': 'customer-2',
                 'canonical_name': 'Customer Two'},
            ],
        }

    def execute(self, query, params=()):
        self.queries.append((query, params))
        if query == 'SHOW transaction_isolation':
            return FakeCursor([('serializable',)])
        elif query == 'SHOW transaction_read_only':
            return FakeCursor([('on',)])
        elif 'FROM plm.production_order AS t' in query:
            rows = self.snapshot['headers']
        elif 'FROM plm.production_order_line_source_ref AS t' in query:
            rows = self.snapshot['refs']
        elif 'FROM plm.production_order_line AS t' in query:
            rows = self.snapshot['lines']
        elif 'FROM coldlion.prod_history_line AS s' in query:
            rows = self.snapshot['source']
        elif 'FROM plm.erp_customer AS e' in query:
            return FakeCursor([(row,) for row in self.snapshot['customer_rows']])
        elif 'pg_try_advisory_xact_lock' in query:
            return FakeCursor([(True,)])
        else:
            return FakeCursor([])
        return FakeCursor([(row, ) for row in rows])

    def rollback(self):
        pass

    def close(self):
        pass

    def commit(self):
        pass


class ApplyFlowConnection(BatchSnapshotConnection):
    def __init__(self, plan, *, lock_allowed=True, corrupt_afterimage=False):
        super().__init__(plan)
        self.info = types.SimpleNamespace(
            host=executor.POOLER_HOST, port=executor.POOLER_PORT,
            user=executor.POOLER_USER, dbname=executor.DATABASE)
        self.events = []
        self.lock_allowed = lock_allowed
        self.corrupt_afterimage = corrupt_afterimage
        self.updated = False
        self.header_reads = 0
        self.update_params = None

    def execute(self, query, params=()):
        self.queries.append((query, params))
        if query.startswith('BEGIN '):
            self.events.append('begin')
            return FakeCursor([])
        if query.startswith('SET LOCAL'):
            return FakeCursor([])
        if query == 'SHOW transaction_isolation':
            return FakeCursor([('serializable',)])
        if query == 'SHOW transaction_read_only':
            return FakeCursor([('on' if self.read_only else 'off',)])
        if 'SELECT pg_try_advisory_xact_lock' in query:
            self.events.append('advisory-lock')
            return FakeCursor([(self.lock_allowed,)])
        if query.startswith('LOCK TABLE '):
            self.events.append('table-lock')
            return FakeCursor([])
        if query.startswith('UPDATE plm.production_order AS po '):
            self.events.append('update')
            self.update_params = params
            by_id = {str(row['id']): row for row in self.snapshot['headers']}
            updated = []
            for header_id, order_date in zip(params[::2], params[1::2]):
                row = by_id[str(header_id)]
                row['order_date'] = order_date
                row['updated_at'] = 'transaction timestamp'
                updated.append(copy.deepcopy(row))
            self.updated = True
            return FakeCursor([(row,) for row in updated])
        if 'FROM plm.production_order AS t' in query:
            self.header_reads += 1
            if self.corrupt_afterimage and self.updated and self.header_reads >= 2:
                planned = self.plan['proposals'][0]['header_id']
                next(row for row in self.snapshot['headers'] if str(row['id']) == str(planned))['order_date'] = '2099-01-01'
            return FakeCursor([(row, row['id']) for row in self.snapshot['headers']])
        if 'FROM plm.production_order_line_source_ref AS t' in query:
            return FakeCursor([(row, row['id']) for row in self.snapshot['refs']])
        if 'FROM plm.production_order_line AS t' in query:
            return FakeCursor([(row, row['id']) for row in self.snapshot['lines']])
        if 'FROM coldlion.prod_history_line AS s' in query:
            self.events.append('source-read')
            return FakeCursor([(row, row['id']) for row in self.snapshot['source']])
        if 'FROM plm.erp_customer AS e' in query:
            return FakeCursor([(row,) for row in self.snapshot['customer_rows']])
        raise AssertionError('Unexpected query in apply orchestration fixture')

    def rollback(self):
        self.events.append('rollback')

    def commit(self):
        self.events.append('commit')


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class ApplyProductionDatePlanTests(unittest.TestCase):
    def test_executor_rejects_oversized_private_input_before_reading(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'oversized-plan.json'
            path.write_bytes(b'{}')
            path.chmod(0o600)
            fake_stat = SimpleNamespace(
                st_dev=1, st_ino=2, st_uid=os.getuid(), st_mode=stat.S_IFREG | 0o600,
                st_size=executor.MAX_PROTECTED_INPUT_BYTES + 1,
                st_mtime_ns=1, st_ctime_ns=1)
            with (mock.patch.object(executor.os, 'fstat', return_value=fake_stat),
                  mock.patch.object(executor.os, 'read', side_effect=AssertionError('must not read'))):
                with self.assertRaisesRegex(ValueError, '128 MiB input bound'):
                    executor.read_private_input(path)

    def test_transaction_mode_is_verified_before_application_reads(self):
        class TransactionConnection:
            def __init__(self, isolation='serializable', server_read_only=None):
                self.isolation = isolation
                self.read_only = None
                self.server_read_only = server_read_only
                self.queries = []
            def execute(self, query):
                self.queries.append(query)
                if query == 'SHOW transaction_isolation':
                    return FakeCursor([(self.isolation,)])
                if query == 'SHOW transaction_read_only':
                    reported = self.server_read_only or ('on' if self.read_only else 'off')
                    return FakeCursor([(reported,)])
                return FakeCursor([])

        valid_read = TransactionConnection()
        executor._begin(valid_read, apply=False)
        self.assertTrue(valid_read.read_only)
        self.assertEqual(valid_read.queries[-2:], [
            'SHOW transaction_isolation', 'SHOW transaction_read_only'])

        valid_write = TransactionConnection()
        executor._begin(valid_write, apply=True)
        self.assertFalse(valid_write.read_only)
        self.assertEqual(valid_write.queries[-1], 'SHOW transaction_read_only')

        for isolation, read_only, message in (
                ('read committed', 'on', 'isolation is not serializable'),
                ('serializable', 'off', 'read-only mode does not match')):
            invalid = TransactionConnection(isolation, read_only)
            with self.assertRaisesRegex(ValueError, message):
                executor._begin(invalid, apply=False)
            self.assertEqual(invalid.queries[-2:], [
                'SHOW transaction_isolation', 'SHOW transaction_read_only'])

    def test_batched_scope_is_five_reads_and_supports_reused_d_with_distinct_dates(self):
        plan = batch_plan()
        connection = BatchSnapshotConnection(plan)
        snapshot = executor._batch_live_snapshot(connection, plan)
        self.assertEqual(len(connection.queries), 5)
        executor._assert_batch_snapshot(plan, snapshot)
        self.assertEqual([p['date'] for p in plan['proposals']], ['2024-03-04', '2025-03-04'])
        self.assertEqual(len(snapshot['source']), 4)
        self.assertIn('VALUES', connection.queries[3][0])
        self.assertIn('ANY(%s::uuid[])', connection.queries[1][0])
        self.assertIn('ANY(%s::uuid[])', connection.queries[2][0])

    def test_batched_snapshot_rejects_conflicting_preimage_ids_and_drift(self):
        plan = batch_plan()
        conflicting = json.loads(json.dumps(plan))
        conflicting['proposals'][1]['identity_scope_header_preimages'][0]['metadata']['tampered'] = True
        with self.assertRaisesRegex(ValueError, 'conflicting duplicate header'):
            executor._union_preimages(conflicting, 'identity_scope_header_preimages', 'header')

        connection = BatchSnapshotConnection(plan)
        snapshot = executor._batch_live_snapshot(connection, plan)
        snapshot = copy.deepcopy(snapshot)
        snapshot['source'][0]['prod_order_date'] = '2026-01-01'
        with self.assertRaisesRegex(ValueError, 'ColdLion production-history evidence changed'):
            executor._assert_batch_snapshot(plan, snapshot)

    def test_batched_afterimage_allows_only_planned_dates_and_managed_timestamp(self):
        plan = batch_plan()
        connection = BatchSnapshotConnection(plan)
        snapshot = copy.deepcopy(executor._batch_live_snapshot(connection, plan))
        dates = {p['header_id']: p['date'] for p in plan['proposals']}
        for header in snapshot['headers']:
            if header['id'] in dates:
                header['order_date'] = dates[header['id']]
                header['updated_at'] = 'transaction timestamp'
        executor._assert_batch_snapshot(plan, snapshot, dates)
        snapshot['headers'][0]['metadata']['unexpected'] = True
        with self.assertRaisesRegex(ValueError, 'header changed beyond approved'):
            executor._assert_batch_snapshot(plan, snapshot, dates)

    def test_readonly_preflight_uses_batch_snapshot_and_never_updates(self):
        plan = batch_plan()
        connection = BatchSnapshotConnection(plan)
        with (mock.patch.object(executor, 'connect', return_value=(connection, ('db', 'addr', 'started'))),
              mock.patch.object(executor, '_verify_live_identity')):
            result = executor.run_preflight(plan)
        self.assertEqual(result, {'mode': 'read-only-preflight', 'proposed': 2, 'changed': 0})
        self.assertEqual(sum('FROM plm.production_order AS t' in q for q, _ in connection.queries), 1)
        self.assertEqual(sum('FROM plm.production_order_line AS t' in q for q, _ in connection.queries), 1)
        self.assertEqual(sum('FROM plm.production_order_line_source_ref AS t' in q for q, _ in connection.queries), 1)
        self.assertEqual(sum('FROM coldlion.prod_history_line AS s' in q for q, _ in connection.queries), 1)
        self.assertEqual(sum('FROM plm.erp_customer AS e' in q for q, _ in connection.queries), 1)
        customer_query = next(q for q, _ in connection.queries if 'FROM plm.erp_customer AS e' in q)
        self.assertIn('c.name AS canonical_name', customer_query)
        self.assertNotIn('c.canonical_name', customer_query)
        self.assertFalse(any(q.lstrip().upper().startswith('UPDATE ') for q, _ in connection.queries))

    def test_readonly_preflight_rejects_capture_fingerprint_before_database_queries(self):
        plan = batch_plan()
        connection = BatchSnapshotConnection(plan)
        with mock.patch.object(executor, 'connect', return_value=(connection, ('other', 'addr', 'started'))), \
             mock.patch.object(executor, '_verify_live_identity'):
            with self.assertRaisesRegex(ValueError, 'fingerprint differs from the captured target'):
                executor.run_preflight(plan)
        self.assertEqual(connection.queries, [])

    def _run_apply_with_fake_target_proof(self, plan, connection):
        fingerprint = ('db', 'addr', 'started')
        identity = SimpleNamespace(fingerprint=fingerprint)
        def assert_target(conn, **kwargs):
            connection.events.append('target-proof')
            return identity
        def read_identity(conn):
            connection.events.append('fingerprint-read')
            return identity
        with (mock.patch.object(executor, 'connect', return_value=(connection, fingerprint)),
              mock.patch.object(executor.shared_db_importer, 'assert_server_is_target', side_effect=assert_target),
              mock.patch.object(executor.shared_db_importer, 'read_server_identity', side_effect=read_identity)):
            return executor.apply_plan(plan)

    def test_apply_plan_end_to_end_commits_only_after_locks_update_readback_and_identity_proof(self):
        plan = batch_plan()
        connection = ApplyFlowConnection(plan)
        result = self._run_apply_with_fake_target_proof(plan, connection)
        self.assertEqual(result, {'mode': 'applied', 'proposed': 2, 'changed': 2})
        self.assertEqual(connection.read_only, False)
        self.assertEqual(connection.update_params, (
            '00000000-0000-0000-0000-000000000001', '2024-03-04',
            '00000000-0000-0000-0000-000000000002', '2025-03-04'))
        self.assertEqual([row['order_date'] for row in sorted(
            connection.snapshot['headers'], key=lambda row: row['id'])],
            ['2024-03-04', '2025-03-04'])
        self.assertEqual(connection.events.count('target-proof'), 2)
        self.assertEqual(connection.events.count('fingerprint-read'), 2)
        update_index = connection.events.index('update')
        commit_index = connection.events.index('commit')
        self.assertTrue(all(index < update_index for index, event in enumerate(connection.events)
                            if event == 'table-lock'))
        self.assertGreater(connection.events.index('fingerprint-read', update_index), update_index)
        self.assertEqual(commit_index, len(connection.events) - 1)
        post_source_read = max(index for index, event in enumerate(connection.events)
                               if event == 'source-read')
        final_target_proof = max(index for index, event in enumerate(connection.events)
                                 if event == 'fingerprint-read')
        self.assertGreater(final_target_proof, post_source_read)

    def test_apply_plan_corrupt_afterimage_rolls_back_without_commit(self):
        plan = batch_plan()
        connection = ApplyFlowConnection(plan, corrupt_afterimage=True)
        with self.assertRaisesRegex(ValueError, 'header changed beyond approved'):
            self._run_apply_with_fake_target_proof(plan, connection)
        self.assertTrue(connection.updated)
        self.assertIn('rollback', connection.events)
        self.assertNotIn('commit', connection.events)

    def test_apply_plan_lock_refusal_rolls_back_before_any_update(self):
        plan = batch_plan()
        connection = ApplyFlowConnection(plan, lock_allowed=False)
        with self.assertRaisesRegex(ValueError, 'Another production-date plan is active'):
            self._run_apply_with_fake_target_proof(plan, connection)
        self.assertNotIn('update', connection.events)
        self.assertNotIn('table-lock', connection.events)
        self.assertIn('rollback', connection.events)
        self.assertNotIn('commit', connection.events)

    def test_frozen_plan_requires_exact_virginia_target_fields(self):
        for field, bad_value in (
                ('database_region', 'us-west-2'),
                ('database_host', 'spoofed.example'),
                ('database_port', 6432),
                ('database_name', 'not-postgres'),
                ('database_fingerprint', ['db', None, 'started'])):
            with self.subTest(field=field):
                plan = frozen_plan()
                plan[field] = bad_value
                with self.assertRaisesRegex(ValueError, 'approved Virginia database identity'):
                    executor._check_plan_scope(plan)

    def test_bulk_update_uses_one_values_statement_and_rejects_partial_count(self):
        plan = batch_plan()

        class UpdateConnection:
            def __init__(self, count):
                self.count = count
                self.query = None
            def execute(self, query, params):
                self.query = (query, params)
                rows = []
                for proposal in plan['proposals'][:self.count]:
                    after = dict(proposal['header_preimage'], order_date=proposal['date'], updated_at='now')
                    rows.append((after,))
                return FakeCursor(rows)

        success = UpdateConnection(2)
        result = executor._bulk_update_dates(success, plan)
        self.assertEqual(set(result), {p['header_id'] for p in plan['proposals']})
        self.assertEqual(success.query[0].count('UPDATE plm.production_order'), 1)
        self.assertIn('FROM (VALUES ', success.query[0])
        self.assertEqual(len(success.query[1]), 4)

        partial = UpdateConnection(1)
        with self.assertRaisesRegex(ValueError, 'exactly the approved headers'):
            executor._bulk_update_dates(partial, plan)

    def test_afterimage_allows_only_order_date_and_updated_at(self):
        before = {'id': 'h1', 'order_date': None, 'updated_at': 'old', 'metadata': {'keep': 1}}
        after = {'id': 'h1', 'order_date': '2024-03-04', 'updated_at': 'new', 'metadata': {'keep': 1}}
        self.assertTrue(executor._afterimage_matches(before, after, '2024-03-04'))
        changed_metadata = dict(after, metadata={'keep': 2})
        self.assertFalse(executor._afterimage_matches(before, changed_metadata, '2024-03-04'))
        wrong_date = dict(after, order_date='2024-03-05')
        self.assertFalse(executor._afterimage_matches(before, wrong_date, '2024-03-04'))

    def test_reused_d_header_scope_allows_only_each_individually_planned_date(self):
        before = [
            {'id': 'h1', 'order_date': None, 'updated_at': 'old1', 'metadata': {'customer': 'A'}},
            {'id': 'h2', 'order_date': None, 'updated_at': 'old2', 'metadata': {'customer': 'B'}},
        ]
        after = [
            {'id': 'h1', 'order_date': '2024-03-04', 'updated_at': 'new1', 'metadata': {'customer': 'A'}},
            {'id': 'h2', 'order_date': '2025-03-04', 'updated_at': 'new2', 'metadata': {'customer': 'B'}},
        ]
        self.assertTrue(executor._scope_headers_afterimage_matches(
            before, after, {'h1': '2024-03-04', 'h2': '2025-03-04'}))
        self.assertFalse(executor._scope_headers_afterimage_matches(
            before, after, {'h1': '2024-03-04'}))

    def test_database_connection_must_identify_expected_project(self):
        self.assertTrue(executor._conninfo_target_ok({
            'host': 'aws-1-us-east-1.pooler.supabase.com',
            'user': 'postgres.' + executor.TARGET,
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'verify-full',
        }))
        self.assertFalse(executor._conninfo_target_ok({
            'host': 'db.' + executor.TARGET + '.supabase.co', 'user': 'postgres',
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'verify-full',
        }))
        self.assertFalse(executor._conninfo_target_ok({
            'host': 'attacker-' + executor.TARGET + '.evil.example',
            'user': 'postgres.' + executor.TARGET,
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'verify-full',
        }))
        self.assertFalse(executor._conninfo_target_ok({
            'host': 'db.' + executor.TARGET + '.supabase.co.attacker.example',
            'user': 'postgres.' + executor.TARGET,
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'verify-full',
        }))
        self.assertFalse(executor._conninfo_target_ok({
            'host': 'aws-1-us-east-1.pooler.supabase.com',
            'user': 'postgres.' + executor.TARGET,
            'port': '6543', 'dbname': 'postgres', 'sslmode': 'verify-full',
        }))
        self.assertFalse(executor._conninfo_target_ok({
            'host': 'aws-1-us-east-1.pooler.supabase.com',
            'user': 'postgres.other-project',
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'verify-full',
        }))
        self.assertFalse(executor._conninfo_target_ok({
            'host': 'aws-1-us-east-1.pooler.supabase.com',
            'user': 'postgres.' + executor.TARGET,
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'prefer',
        }))
        self.assertFalse(executor._conninfo_target_ok({
            'host': 'aws-1-us-east-1.pooler.supabase.com',
            'hostaddr': '203.0.113.7',
            'user': 'postgres.' + executor.TARGET,
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'verify-full',
        }))

    def test_pinned_ca_is_verified_copied_private_and_used_with_verify_full(self):
        certificate = (b'-----BEGIN CERTIFICATE-----\n'
                       b'SYNTHETIC TEST CA ONLY\n'
                       b'-----END CERTIFICATE-----\n')
        certificate_sha = executor.sha_bytes(certificate)
        with tempfile.TemporaryDirectory() as folder:
            test_ca = Path(folder) / 'synthetic-test-ca.pem'
            test_ca.write_bytes(certificate)
            test_ca.chmod(0o444)
            with (mock.patch.object(executor, 'CA_FILE', test_ca),
                  mock.patch.object(executor, 'CA_SHA256', certificate_sha)):
                with executor._pinned_ca_file() as ca_path:
                    self.assertEqual(ca_path.read_bytes(), certificate)
                    self.assertEqual(ca_path.stat().st_mode & 0o777, 0o600)
                self.assertFalse(ca_path.exists())

        class Connection:
            def __init__(self):
                self.info = types.SimpleNamespace(
                    host=executor.POOLER_HOST, port=executor.POOLER_PORT,
                    user=executor.POOLER_USER, dbname=executor.DATABASE)
                self.closed = False
            def commit(self):
                pass
            def close(self):
                self.closed = True

        conn = Connection()
        calls = {}
        psycopg = types.ModuleType('psycopg')
        psycopg.IsolationLevel = types.SimpleNamespace(SERIALIZABLE='serializable')
        def fake_connect(dsn, **kwargs):
            calls.update(kwargs)
            ca_path = Path(kwargs['sslrootcert'])
            calls['ca_bytes'] = ca_path.read_bytes()
            calls['ca_mode'] = ca_path.stat().st_mode & 0o777
            return conn
        psycopg.connect = fake_connect
        conninfo = types.ModuleType('psycopg.conninfo')
        conninfo.conninfo_to_dict = lambda dsn: {
            'host': executor.POOLER_HOST, 'user': executor.POOLER_USER,
            'port': '5432', 'dbname': 'postgres', 'sslmode': 'verify-full'}
        identity = types.SimpleNamespace(fingerprint=('db', 'addr', 'started'))
        with tempfile.TemporaryDirectory() as folder:
            test_ca = Path(folder) / 'synthetic-test-ca.pem'
            test_ca.write_bytes(certificate)
            test_ca.chmod(0o444)
            with (mock.patch.object(executor, 'CA_FILE', test_ca),
                  mock.patch.object(executor, 'CA_SHA256', certificate_sha),
                  mock.patch.dict('sys.modules', {'psycopg': psycopg, 'psycopg.conninfo': conninfo}),
              mock.patch.dict('os.environ', {'PRODUCTION_DATABASE_URL': 'host=approved'}),
              mock.patch.object(executor.shared_db_importer, 'assert_server_is_target', return_value=identity),
              mock.patch.object(executor.shared_db_importer, 'read_server_identity', return_value=identity)):
                returned, fingerprint = executor.connect()
        self.assertIs(returned, conn)
        self.assertEqual(fingerprint, identity.fingerprint)
        self.assertEqual(calls['sslmode'], 'verify-full')
        self.assertEqual(conn.isolation_level, psycopg.IsolationLevel.SERIALIZABLE)
        self.assertTrue(conn.read_only)
        self.assertEqual(calls['ca_bytes'], certificate)
        self.assertEqual(calls['ca_mode'], 0o600)
        self.assertNotEqual(calls['sslrootcert'], 'system')

    def test_pinned_ca_rejects_changed_certificate_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            fake_ca = Path(folder) / 'root.crt'
            fake_ca.write_bytes(b'wrong certificate')
            fake_ca.chmod(0o444)
            with (mock.patch.object(executor, 'CA_FILE', fake_ca),
                  self.assertRaisesRegex(ValueError, 'checksum mismatch')):
                with executor._pinned_ca_file():
                    self.fail('Invalid certificate was yielded to libpq')

    def test_pinned_ca_rejects_writable_source_file(self):
        with tempfile.TemporaryDirectory() as folder:
            fake_ca = Path(folder) / 'root.crt'
            fake_ca.write_bytes(b'-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----\n')
            fake_ca.chmod(0o664)
            with (mock.patch.object(executor, 'CA_FILE', fake_ca),
                  mock.patch.object(executor, 'CA_SHA256', executor.sha_bytes(fake_ca.read_bytes())),
                  self.assertRaisesRegex(ValueError, 'unsafe ownership or permissions')):
                with executor._pinned_ca_file():
                    self.fail('Writable certificate source was yielded to libpq')
    def test_live_batch_snapshot_locks_full_customer_bridge_and_binds_digest(self):
        plan = batch_plan()
        connection = BatchSnapshotConnection(plan)
        snapshot = executor._batch_live_snapshot(connection, plan, lock='SHARE')
        self.assertEqual(len(connection.queries), 5)
        customer_query, params = connection.queries[4]
        self.assertIn('JOIN core.customer AS c ON c.id = e.customer_id', customer_query)
        self.assertIn('FOR SHARE OF e, c', customer_query)
        self.assertIn('LIMIT 2001', customer_query)
        self.assertEqual(params, ())
        executor._assert_batch_snapshot(plan, snapshot)

        changed = copy.deepcopy(snapshot)
        changed['customer_rows'][1]['display_name'] = 'Changed customer mapping'
        with self.assertRaisesRegex(ValueError, 'ERP customer identity bridge changed'):
            executor._assert_batch_snapshot(plan, changed)

    def test_live_batch_source_query_covers_reference_and_selected_partitions(self):
        plan = batch_plan()
        connection = BatchSnapshotConnection(plan)
        snapshot = executor._batch_live_snapshot(connection, plan, lock='SHARE')
        source_query, params = connection.queries[3]
        self.assertIn('prod_reference_no::text = ANY(%s::text[])', source_query)
        self.assertIn('EXISTS (SELECT 1 FROM (VALUES ', source_query)
        self.assertIn('FOR SHARE', source_query)
        self.assertEqual(params[0], ['D-10'])
        self.assertEqual(len(snapshot['source']), 4)
        executor._assert_batch_snapshot(plan, snapshot)

    def test_frozen_plan_requires_both_file_and_internal_hashes(self):
        plan = frozen_plan()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'plan.json'
            path.write_text(json.dumps(plan, sort_keys=True, separators=(',', ':')))
            path.chmod(0o600)
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(executor.load_frozen_plan(path, sha)['plan_sha256'], plan['plan_sha256'])
            path.write_text(path.read_text().replace('2024-03-04', '2024-03-05'))
            changed_sha = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'internal checksum'):
                executor.load_frozen_plan(path, changed_sha)

    def _review_inputs(self, folder: Path):
        plan = frozen_plan()
        plan_path = folder / 'plan.json'
        plan_raw = json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()
        plan_path.write_bytes(plan_raw)
        plan_path.chmod(0o600)
        plan = executor.load_frozen_plan(plan_path, hashlib.sha256(plan_raw).hexdigest(), plan_raw)
        report = folder / 'review.json'
        report.write_text('{"verdict":"APPROVE"}\n')
        report.chmod(0o644)
        report_sha = hashlib.sha256(report.read_bytes()).hexdigest()
        gate = Path('/worksp/ai-devops/bin/ai-task-gates')
        gate_sha = 'a' * 64
        with mock.patch.object(executor, '_verified_gate', return_value=(gate, gate_sha)):
            bundle = {
                'schema': executor.REVIEW_BUNDLE_SCHEMA,
                'plan_file_sha256': hashlib.sha256(plan_raw).hexdigest(),
                'plan_sha256': plan['plan_sha256'],
                'capture_file_sha256': plan['capture_file_sha256'],
                'capture_source_digest': plan['capture_source_digest'],
                'database_project': executor.TARGET,
                'repository_head': plan['repository_head'],
                'planner_file_sha256': hashlib.sha256(
                    executor.read_private_or_repo_file(executor.ROOT / 'scripts' / 'orderlist-production-date-plan.py')).hexdigest(),
                'executor_file_sha256': hashlib.sha256(
                    executor.read_private_or_repo_file(Path(executor.__file__).resolve())).hexdigest(),
                'reviewer_report_sha256': report_sha,
                'task_gate_path': str(gate),
                'task_gate_sha256': gate_sha,
                'proposed_count': len(plan['proposals']),
            }
        bundle_path = folder / 'bundle.json'
        bundle_raw = json.dumps(bundle, sort_keys=True, separators=(',', ':')).encode()
        bundle_path.write_bytes(bundle_raw)
        bundle_path.chmod(0o600)
        return plan, plan_path, plan_raw, report, bundle, bundle_path, bundle_raw

    def test_reviewer_bundle_binds_exact_plan_capture_code_report_gate_and_count(self):
        with tempfile.TemporaryDirectory() as temp:
            plan, _, plan_raw, report, bundle, _, bundle_raw = self._review_inputs(Path(temp))
            with mock.patch.object(executor, '_verified_gate', return_value=(
                    Path(bundle['task_gate_path']), bundle['task_gate_sha256'])):
                accepted, gate, gate_sha, _ = executor.validate_reviewer_bundle(
                    plan, plan_raw, report, bundle_raw, hashlib.sha256(bundle_raw).hexdigest())
            self.assertEqual(accepted, bundle)
            self.assertEqual(gate_sha, bundle['task_gate_sha256'])
            self.assertEqual(str(gate), bundle['task_gate_path'])

            for key, bad_value in (
                    ('plan_sha256', 'f' * 64),
                    ('capture_source_digest', 'e' * 64),
                    ('repository_head', '0' * 40),
                    ('planner_file_sha256', 'd' * 64),
                    ('executor_file_sha256', 'c' * 64),
                    ('reviewer_report_sha256', 'b' * 64),
                    ('task_gate_path', '/tmp/fake-gate'),
                    ('task_gate_sha256', '9' * 64),
                    ('proposed_count', 2)):
                altered = dict(bundle, **{key: bad_value})
                altered_raw = json.dumps(altered, sort_keys=True, separators=(',', ':')).encode()
                with mock.patch.object(executor, '_verified_gate', return_value=(
                        Path(bundle['task_gate_path']), bundle['task_gate_sha256'])):
                    with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'does not bind'):
                        executor.validate_reviewer_bundle(
                            plan, plan_raw, report, altered_raw,
                            hashlib.sha256(altered_raw).hexdigest())

    def test_tampered_reviewer_report_fails_before_apply_connection(self):
        with tempfile.TemporaryDirectory() as temp:
            plan, plan_path, plan_raw, report, bundle, bundle_path, bundle_raw = self._review_inputs(Path(temp))
            report.write_text('{"verdict":"REJECT"}\n')
            args = [
                '--plan', str(plan_path), '--plan-sha256', hashlib.sha256(plan_raw).hexdigest(),
                '--apply', '--reviewer-approval', str(report), '--reviewer-bundle', str(bundle_path),
                '--reviewer-bundle-sha256', hashlib.sha256(bundle_raw).hexdigest(),
            ]
            with (mock.patch.object(executor, 'current_head', return_value=plan['repository_head']),
                  mock.patch.object(executor, '_verified_gate', return_value=(
                      Path(bundle['task_gate_path']), bundle['task_gate_sha256'])),
                  mock.patch.object(executor, 'apply_plan') as apply,
                  mock.patch.object(executor, 'connect') as connect):
                self.assertEqual(executor.main(args), 2)
                apply.assert_not_called()
                connect.assert_not_called()

    def test_mismatched_gate_binding_fails_before_apply_connection(self):
        with tempfile.TemporaryDirectory() as temp:
            plan, plan_path, plan_raw, report, bundle, bundle_path, _ = self._review_inputs(Path(temp))
            bundle['task_gate_path'] = '/tmp/substitute-ai-task-gates'
            bad_bundle_raw = json.dumps(bundle, sort_keys=True, separators=(',', ':')).encode()
            bundle_path.write_bytes(bad_bundle_raw)
            args = [
                '--plan', str(plan_path), '--plan-sha256', hashlib.sha256(plan_raw).hexdigest(),
                '--apply', '--reviewer-approval', str(report), '--reviewer-bundle', str(bundle_path),
                '--reviewer-bundle-sha256', hashlib.sha256(bad_bundle_raw).hexdigest(),
            ]
            with (mock.patch.object(executor, 'current_head', return_value=plan['repository_head']),
                  mock.patch.object(executor, '_verified_gate', return_value=(
                      Path('/worksp/ai-devops/bin/ai-task-gates'), 'a' * 64)),
                  mock.patch.object(executor, 'apply_plan') as apply,
                  mock.patch.object(executor, 'connect') as connect):
                self.assertEqual(executor.main(args), 2)
                apply.assert_not_called()
                connect.assert_not_called()

    def test_private_inputs_reject_symlinks_and_wrong_permissions(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            target = folder / 'target'
            target.write_text('protected')
            target.chmod(0o600)
            existing = folder / 'existing'
            existing.write_text('protected')
            existing.chmod(0o600)
            dangling = folder / 'dangling'
            dangling.symlink_to(folder / 'missing')
            with self.assertRaisesRegex(ValueError, 'opened safely'):
                executor.read_private_input(dangling)
            public = folder / 'public'
            public.write_text('protected')
            public.chmod(0o644)
            with self.assertRaisesRegex(ValueError, 'ownership or permissions'):
                executor.read_private_input(public)
            self.assertEqual(target.read_text(), 'protected')
            self.assertEqual(existing.read_text(), 'protected')

    def test_managed_gate_resolves_to_exact_secure_executable(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            executable = folder / 'managed-gate'
            executable.write_text('#!/bin/sh\nexit 0\n')
            executable.chmod(0o700)
            launcher = folder / 'launcher'
            launcher.symlink_to(executable)
            with (mock.patch.object(executor, 'GATE_LAUNCHER', launcher),
                  mock.patch.object(executor, 'GATE_RESOLVED_PATH', executable)):
                resolved, digest = executor._verified_gate()
                self.assertEqual(resolved, executable)
                self.assertEqual(digest, hashlib.sha256(executable.read_bytes()).hexdigest())
                wrong = folder / 'other-gate'
                wrong.write_text('wrong')
                wrong.chmod(0o700)
                launcher.unlink()
                launcher.symlink_to(wrong)
                with self.assertRaisesRegex(ValueError, 'path changed'):
                    executor._verified_gate()
                launcher.unlink()
                launcher.symlink_to(executable)
                executable.chmod(0o720)
                with self.assertRaisesRegex(ValueError, 'unsafe ownership or permissions'):
                    executor._verified_gate()

    def test_reviewer_gate_executes_only_bound_absolute_managed_path(self):
        with tempfile.TemporaryDirectory() as temp:
            plan, _, _, report, bundle, _, _ = self._review_inputs(Path(temp))
            gate = Path(bundle['task_gate_path'])
            digest = bundle['task_gate_sha256']
            seen = {}
            def fake_run(argv, **kwargs):
                seen['argv'] = argv
                staged = Path(argv[argv.index('--reviewer-approval') + 1])
                seen['staged_bytes'] = staged.read_bytes()
                return subprocess.CompletedProcess(argv, 0, '', '')
            with (mock.patch.object(executor, '_verified_gate', return_value=(gate, digest)),
                  mock.patch.object(executor.subprocess, 'run', side_effect=fake_run)):
                executor.verify_reviewer_gate(plan, report, bundle, gate, digest,
                                              report.read_bytes())
            argv = seen['argv']
            self.assertEqual(argv[0], str(gate))
            self.assertTrue(Path(argv[0]).is_absolute())
            self.assertNotEqual(Path(argv[argv.index('--reviewer-approval') + 1]), report)
            self.assertEqual(seen['staged_bytes'], report.read_bytes())

    def test_frozen_plan_rejects_held_and_duplicate_targets(self):
        plan = frozen_plan()
        plan['proposals'][0]['held_header_ids'] = ['header-1']
        with self.assertRaisesRegex(ValueError, 'held header'):
            executor._check_plan_scope(plan)
        plan = frozen_plan()
        plan['proposals'].append(dict(plan['proposals'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate or blank target'):
            executor._check_plan_scope(plan)

    def test_frozen_plan_requires_complete_customer_identity_snapshot(self):
        plan = frozen_plan()
        plan['customer_identity_snapshot_complete'] = False
        with self.assertRaisesRegex(ValueError, 'complete bounded ERP customer identity snapshot'):
            executor._check_plan_scope(plan)
        plan = frozen_plan()
        plan['proposals'][0]['customer_identity_snapshot_complete'] = False
        with self.assertRaisesRegex(ValueError, 'missing source or identity-scope preimages'):
            executor._check_plan_scope(plan)


if __name__ == '__main__':
    unittest.main()
