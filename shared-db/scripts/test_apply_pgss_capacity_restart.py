#!/usr/bin/env python3
"""Offline unit tests for scripts/apply_pgss_capacity_restart.py (no network, no DB)."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from zoneinfo import ZoneInfo

import apply_pgss_capacity_restart as mod

ROOT = Path(__file__).resolve().parent.parent
PREVIEW_REF = 'aaaaaaaaaaaaaaaaaaaa'
PROD_REF = mod.production_ref(ROOT)
PLAN = mod.load_plan(ROOT)
SHA = '1' * 40


def make_env(mode='preview_only'):
    return {
        'GITHUB_REPOSITORY': 'popcre/shared-db',
        'GITHUB_EVENT_NAME': 'workflow_dispatch',
        'GITHUB_REF': 'refs/heads/main',
        'GITHUB_SHA': SHA,
        'EXPECTED_HEAD': SHA,
        'WORK_ISSUE': '5609',
        'MODE': mode,
        'GITHUB_RUN_ID': '9001',
        'GITHUB_RUN_ATTEMPT': '1',
        'GITHUB_WORKFLOW_REF': f'popcre/shared-db/{mod.WORKFLOW}@refs/heads/main',
        'PREVIEW_PROJECT_REF': PREVIEW_REF,
        'SUPABASE_ACCESS_TOKEN': 'test-token-never-printed',
    }


def make_catalog(effective='5000', pending_restart=False, postmaster='2026-11-06 11:20:19-05', dealloc=113, indexes=None):
    default_indexes = [
        dict(item, valid=True, ready=True) for item in PLAN['production_candidates']
    ]
    return [{
        'execution_role': 'supabase_read_only_user',
        'session_role': 'supabase_read_only_user',
        'database': 'postgres',
        'read_only': 'on',
        'role_super': False,
        'role_bypassrls': True,
        'context': 'postmaster',
        'effective': effective,
        'pending_restart': pending_restart,
        'postmaster': postmaster,
        'database_reset': None,
        'statement_reset': postmaster,
        'dealloc': dealloc,
        'indexes': default_indexes if indexes is None else indexes,
    }]


class FakeAPI:
    def __init__(self, ref, token, *, initial_config, catalog_sequence, identity_id=None, concurrent_config=None):
        self.ref = ref
        self.token = token
        self.config = dict(initial_config)
        self.concurrent_config = concurrent_config
        self.catalog_sequence = list(catalog_sequence)
        self.identity_id = ref if identity_id is None else identity_id
        self.put_payloads = []
        self.get_config_calls = 0

    def call(self, method, kind, payload=None):
        if (method, kind) == ('GET', 'config'):
            self.get_config_calls += 1
            if self.get_config_calls == 2 and self.concurrent_config is not None:
                return dict(self.concurrent_config)
            return dict(self.config)
        if (method, kind) == ('GET', 'identity'):
            return {'id': self.identity_id}
        if (method, kind) == ('PUT', 'config'):
            # Enforce API contract checks
            mod.require(
                type(payload) is dict
                and payload.get(mod.SETTING) == mod.DESIRED
                and payload.get('restart_database') is True
                and set(payload) <= mod.CONFIG_KEYS | {'restart_database'},
                'capacity-restart body refused',
            )
            self.put_payloads.append(dict(payload))
            stored = {k: v for k, v in payload.items() if k != 'restart_database'}
            self.config = stored
            return dict(stored)
        if (method, kind) == ('POST', 'catalog'):
            mod.require(payload == {'query': mod.SQL, 'read_only': True}, 'read-only query refused')
            step = self.catalog_sequence.pop(0)
            if isinstance(step, Exception):
                raise step
            return step
        raise AssertionError(f'unexpected call {(method, kind)}')


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def monotonic(self):
        return self.t

    def sleep(self, dt):
        self.t += dt


class TestApplyPgssCapacityRestart(unittest.TestCase):
    def test_ny_maintenance_window_boundaries(self):
        ny = ZoneInfo('America/New_York')
        # Inside: Fri 18:00, Sat 21:15, Sun 04:59
        self.assertTrue(mod.is_in_ny_maintenance_window(datetime(2026, 11, 20, 18, 0, 0, tzinfo=ny)))
        self.assertTrue(mod.is_in_ny_maintenance_window(datetime(2026, 11, 21, 21, 15, 0, tzinfo=ny)))
        self.assertTrue(mod.is_in_ny_maintenance_window(datetime(2026, 11, 22, 4, 59, 59, tzinfo=ny)))
        # Outside: Fri 17:59:59, Sun 05:00:00, Mon 10:00:00
        self.assertFalse(mod.is_in_ny_maintenance_window(datetime(2026, 11, 20, 17, 59, 59, tzinfo=ny)))
        self.assertFalse(mod.is_in_ny_maintenance_window(datetime(2026, 11, 22, 5, 0, 0, tzinfo=ny)))
        self.assertFalse(mod.is_in_ny_maintenance_window(datetime(2026, 11, 23, 10, 0, 0, tzinfo=ny)))
        with self.assertRaises(mod.Refused):
            mod.is_in_ny_maintenance_window(datetime(2026, 11, 21, 21, 0, 0))

    def test_preview_only_applies_merges_overrides_and_polls_through_transient_outage(self):
        clock = FakeClock()
        api = FakeAPI(
            PREVIEW_REF,
            'tok',
            initial_config={'statement_timeout': '60s'},
            catalog_sequence=[
                make_catalog(effective='5000', pending_restart=False, postmaster='2026-08-18 16:04:35-04', dealloc=2),
                mod.Refused('vendor request refused; no response contents disclosed'),
                mod.Refused('vendor status refused'),
                make_catalog(effective='40000', pending_restart=False, postmaster='2026-11-21 21:20:00-05', dealloc=0),
            ],
        )
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'preview.json'
            receipt = mod.run(
                'preview', 'preview_only', out, env=make_env('preview_only'), root=ROOT,
                api_factory=lambda ref, tok: api, fence=lambda: None,
                now_utc=datetime(2026, 11, 23, 15, 0, 0, tzinfo=timezone.utc),  # Monday — allowed for preview
                sleep_fn=clock.sleep, monotonic_fn=clock.monotonic,
            )
            self.assertTrue(receipt['succeeded'])
            self.assertTrue(receipt['changed'])
            self.assertTrue(receipt['restarted'])
            self.assertEqual(receipt['stored_capacity'], 40000)
            self.assertEqual(receipt['effective_capacity'], 40000)
            self.assertFalse(receipt['pending_restart'])
            self.assertEqual(receipt['dealloc'], 0)
            self.assertNotEqual(receipt['postmaster_before_sha256'], receipt['postmaster_after_sha256'])
            # Exact merged PUT payload
            self.assertEqual(
                api.put_payloads,
                [{'statement_timeout': '60s', 'pg_stat_statements.max': 40000, 'restart_database': True}],
            )
            self.assertEqual(clock.t, 10.0)

    def test_production_requires_window_mode_and_valid_preview_receipt(self):
        clock = FakeClock()
        sat_ny = datetime(2026, 11, 21, 21, 30, 0, tzinfo=ZoneInfo('America/New_York'))
        mon_ny = datetime(2026, 11, 23, 10, 0, 0, tzinfo=ZoneInfo('America/New_York'))

        prev_api = FakeAPI(
            PREVIEW_REF, 'tok',
            initial_config={},
            catalog_sequence=[
                make_catalog(effective='5000', postmaster='2026-08-18 16:04:35-04', dealloc=1),
                make_catalog(effective='40000', postmaster='2026-11-21 21:30:10-05', dealloc=0),
            ],
        )
        prod_api = FakeAPI(
            PROD_REF, 'tok',
            initial_config={'max_connections': 100},
            catalog_sequence=[
                make_catalog(effective='5000', postmaster='2026-11-06 11:20:19-05', dealloc=113),
                make_catalog(effective='40000', postmaster='2026-11-21 21:31:05-05', dealloc=0),
            ],
        )
        with tempfile.TemporaryDirectory() as tmp:
            prev_out = Path(tmp) / 'preview.json'
            prod_out = Path(tmp) / 'production.json'
            mod.run(
                'preview', 'preview_and_production', prev_out, env=make_env('preview_and_production'), root=ROOT,
                api_factory=lambda ref, tok: prev_api, fence=lambda: None, now_utc=sat_ny,
                sleep_fn=clock.sleep, monotonic_fn=clock.monotonic,
            )
            # Refused outside maintenance window
            with self.assertRaisesRegex(mod.Refused, 'outside NY maintenance window'):
                mod.run(
                    'production', 'preview_and_production', prod_out, preview_receipt=prev_out,
                    env=make_env('preview_and_production'), root=ROOT,
                    api_factory=lambda ref, tok: prod_api, fence=lambda: None, now_utc=mon_ny,
                    sleep_fn=clock.sleep, monotonic_fn=clock.monotonic,
                )
            # Refused in preview_only mode
            with self.assertRaisesRegex(mod.Refused, 'preview_only'):
                mod.run(
                    'production', 'preview_only', prod_out, preview_receipt=prev_out,
                    env=make_env('preview_only'), root=ROOT,
                    api_factory=lambda ref, tok: prod_api, fence=lambda: None, now_utc=sat_ny,
                    sleep_fn=clock.sleep, monotonic_fn=clock.monotonic,
                )
            # Succeeds inside window with valid preview receipt
            receipt = mod.run(
                'production', 'preview_and_production', prod_out, preview_receipt=prev_out,
                env=make_env('preview_and_production'), root=ROOT,
                api_factory=lambda ref, tok: prod_api, fence=lambda: None, now_utc=sat_ny,
                sleep_fn=clock.sleep, monotonic_fn=clock.monotonic,
            )
            self.assertTrue(receipt['succeeded'])
            self.assertEqual(receipt['effective_capacity'], 40000)
            self.assertEqual(
                prod_api.put_payloads,
                [{'max_connections': 100, 'pg_stat_statements.max': 40000, 'restart_database': True}],
            )

    def test_idempotent_noop_when_already_effective_40000(self):
        api = FakeAPI(
            PREVIEW_REF, 'tok',
            initial_config={'pg_stat_statements.max': 40000},
            catalog_sequence=[
                make_catalog(effective='40000', pending_restart=False, postmaster='2026-11-21 21:20:00-05', dealloc=0),
                make_catalog(effective='40000', pending_restart=False, postmaster='2026-11-21 21:20:00-05', dealloc=0),
            ],
        )
        with tempfile.TemporaryDirectory() as tmp:
            receipt = mod.run(
                'preview', 'preview_only', Path(tmp) / 'p.json', env=make_env('preview_only'), root=ROOT,
                api_factory=lambda ref, tok: api, fence=lambda: None,
            )
            self.assertFalse(receipt['changed'])
            self.assertFalse(receipt['restarted'])
            self.assertEqual(api.put_payloads, [])

    def test_refuses_concurrent_config_change_and_timeout_without_postmaster_advance(self):
        api_concurrent = FakeAPI(
            PREVIEW_REF, 'tok',
            initial_config={'statement_timeout': '60s'},
            concurrent_config={'statement_timeout': '120s'},
            catalog_sequence=[make_catalog(effective='5000')],
        )
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(mod.Refused, 'concurrent config change'):
                mod.run(
                    'preview', 'preview_only', Path(tmp) / 'p1.json', env=make_env('preview_only'), root=ROOT,
                    api_factory=lambda ref, tok: api_concurrent, fence=lambda: None,
                )
            self.assertEqual(api_concurrent.put_payloads, [])

        clock = FakeClock()
        stale_postmaster = '2026-08-18 16:04:35-04'
        api_no_restart = FakeAPI(
            PREVIEW_REF, 'tok',
            initial_config={},
            catalog_sequence=[
                make_catalog(effective='5000', postmaster=stale_postmaster),
                make_catalog(effective='5000', pending_restart=True, postmaster=stale_postmaster),
                make_catalog(effective='5000', pending_restart=True, postmaster=stale_postmaster),
                make_catalog(effective='5000', pending_restart=True, postmaster=stale_postmaster),
            ],
        )
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(mod.Refused, 'without postmaster advance'):
                mod.run(
                    'preview', 'preview_only', Path(tmp) / 'p2.json', env=make_env('preview_only'), root=ROOT,
                    api_factory=lambda ref, tok: api_no_restart, fence=lambda: None,
                    poll_timeout_s=10, poll_interval_s=5, sleep_fn=clock.sleep, monotonic_fn=clock.monotonic,
                )

    def test_refuses_protected_index_drift_on_production(self):
        sat_ny = datetime(2026, 11, 21, 21, 30, 0, tzinfo=ZoneInfo('America/New_York'))
        bad_indexes = [dict(item, valid=True, ready=True) for item in PLAN['production_candidates']]
        bad_indexes[0]['definition_md5'] = '0' * 32
        prod_api = FakeAPI(
            PROD_REF, 'tok',
            initial_config={},
            catalog_sequence=[make_catalog(effective='5000', indexes=bad_indexes)],
        )
        prev_api = FakeAPI(
            PREVIEW_REF, 'tok',
            initial_config={'pg_stat_statements.max': 40000},
            catalog_sequence=[
                make_catalog(effective='40000', postmaster='2026-11-21 21:20:00-05', dealloc=0),
                make_catalog(effective='40000', postmaster='2026-11-21 21:20:00-05', dealloc=0),
            ],
        )
        with tempfile.TemporaryDirectory() as tmp:
            prev_out = Path(tmp) / 'prev.json'
            mod.run(
                'preview', 'preview_and_production', prev_out, env=make_env('preview_and_production'), root=ROOT,
                api_factory=lambda ref, tok: prev_api, fence=lambda: None, now_utc=sat_ny,
            )
            with self.assertRaisesRegex(mod.Refused, 'original candidate identity changed'):
                mod.run(
                    'production', 'preview_and_production', Path(tmp) / 'prod.json', preview_receipt=prev_out,
                    env=make_env('preview_and_production'), root=ROOT,
                    api_factory=lambda ref, tok: prod_api, fence=lambda: None, now_utc=sat_ny,
                )


if __name__ == '__main__':
    unittest.main()
