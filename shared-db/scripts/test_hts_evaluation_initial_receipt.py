"""One immutable initial-login receipt, never a generic relaxed receipt parser."""
import io
import json
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
sys.path.insert(0, str(Path(__file__).parent))
import atomic_migration_apply as atomic
from production_business_risk_gate import RiskGateError, canonical_sha256, prove_preview_migration_contents

VERSION = '20261105121341'
ROLE = 'designflow_hts_evaluation_reader'
SUFFIX = ' initial_credential=login_verified'


class ReceiptCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'supabase/migrations').mkdir(parents=True)
        (self.root / 'config').mkdir()

    def proof(self, version=VERSION, role=ROLE, suffix=SUFFIX, wrong_hash=False, extra_line=False):
        migration = self.root / f'supabase/migrations/{version}_synthetic.sql'
        migration.write_text('select 1;\n')
        digest = canonical_sha256(migration)
        entry = {'sha256': digest, 'targets': ['preview', 'production'], 'initial_credential_role': role}
        (self.root / 'config/atomic-migration-allowlist.json').write_text(json.dumps({'schema_version': 1, 'migrations': {version: entry}}))
        preflight = f'ATOMIC PREFLIGHT OK: target=preview version={version} sha256={digest} statements=1'
        texts = {'preview-dry-run.txt': preflight + '\n',
                 'preview-apply.txt': preflight + '\n' + f'ATOMIC APPLY OK: target=preview version={version} ledger_row=1 statements=1' + suffix + '\n' + ('unexpected\n' if extra_line else ''),
                 'migration-content-manifest.json': json.dumps({version: '0' * 64 if wrong_hash else digest})}
        return texts, version

    def prove(self, **kwargs):
        texts, version = self.proof(**kwargs)
        prove_preview_migration_contents(texts=texts, allowlist=[version], repo_root=self.root,
                                        before_versions={'old'}, after_versions={'old', version}, historical=False)

    def test_future_canonical_and_exact_pinned_historical_success(self):
        self.prove(suffix='')
        self.prove()

    def test_legacy_suffix_never_applies_to_wrong_version_or_role(self):
        for kwargs in ({'version': '20261105121342'}, {'role': 'another_reader'}, {'role': None}):
            with self.subTest(kwargs=kwargs), self.assertRaises(RiskGateError):
                self.prove(**kwargs)

    def test_historical_no_write_recovery_preserves_stable_ledger_checks(self):
        self.prove()  # its immutable original apply receipt must still pass
        name = f'{VERSION}_synthetic.sql'
        texts = {'preview-dry-run.txt': name, 'preview-apply.txt': name}
        prove_preview_migration_contents(texts=texts, allowlist=[VERSION], repo_root=self.root,
                                        before_versions={VERSION}, after_versions={VERSION}, historical=True)
        with self.assertRaises(RiskGateError):
            prove_preview_migration_contents(texts=texts, allowlist=[VERSION], repo_root=self.root,
                                            before_versions={VERSION}, after_versions={VERSION, 'extra'}, historical=True)

    def test_hash_extra_text_multiline_or_unverified_suffix_stay_refused(self):
        for kwargs in ({'wrong_hash': True}, {'extra_line': True}, {'suffix': SUFFIX + ' extra'},
                       {'suffix': ' initial_credential=unverified'}, {'suffix': '\n' + SUFFIX},
                       {'suffix': SUFFIX + SUFFIX}):
            with self.subTest(kwargs=kwargs), self.assertRaises(RiskGateError):
                self.prove(**kwargs)


class ProducerLoginReceiptTests(unittest.TestCase):
    def run_producer(self, login_error=False, wrong_identity=False):
        candidate = (VERSION, Path('/synthetic.sql'), 'synthetic', 'select 1;\n', ['select 1'])
        connection = MagicMock()
        check = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
        check.fetchone.return_value = ('wrong_reader' if wrong_identity else ROLE,)
        out, err = io.StringIO(), io.StringIO()
        def verify_before_success():
            self.assertNotIn('ATOMIC APPLY OK', out.getvalue())
            return ('wrong_reader' if wrong_identity else ROLE,)
        check.fetchone.side_effect = verify_before_success
        argv = ['atomic_migration_apply.py', '--migrations-dir', '/synthetic', '--linked-dir', '/synthetic', '--version', VERSION,
                '--target', 'preview', '--expected-project-ref', 'synthetic-preview', '--mode', 'apply']
        with patch.object(sys, 'argv', argv), patch.object(atomic, 'classify_allowlist', return_value=VERSION), \
                patch.object(atomic, 'load_candidate', return_value=candidate[1:]), \
                patch.object(atomic, 'linked_connection', return_value=('synthetic-url', {atomic.HTS_CREDENTIAL_ENV: 'x' * 64})), \
                patch.object(atomic, 'read_policy', return_value={VERSION: {'initial_credential_role': ROLE}}), \
                patch.object(atomic, 'validate_remote'), patch.object(atomic, 'canonical_migration_bytes', return_value=b'select 1;\n'), \
                patch.object(atomic, 'initial_credential_apply') as apply, patch.object(atomic, 'psql', return_value='1|1|synthetic'), \
                patch.object(atomic, 'credential_connection', side_effect=RuntimeError('synthetic failure') if login_error else None, return_value=connection) as login, \
                redirect_stdout(out), redirect_stderr(err):
            result = atomic.main()
        return result, out.getvalue(), err.getvalue(), apply, login, check

    def test_unchanged_success_receipt_follows_actual_login_check(self):
        result, output, _, apply, login, check = self.run_producer()
        self.assertEqual(result, 0)
        apply.assert_called_once()
        login.assert_called_once()
        check.execute.assert_called_once_with('SELECT current_user')
        self.assertEqual(output.splitlines()[-1], f'ATOMIC APPLY OK: target=preview version={VERSION} ledger_row=1 statements=1' + SUFFIX)
        self.assertEqual(len(output.splitlines()), 2)

    def test_login_failure_or_wrong_identity_never_emits_success(self):
        for kwargs in ({'login_error': True}, {'wrong_identity': True}):
            with self.subTest(kwargs=kwargs):
                result, output, error, *_ = self.run_producer(**kwargs)
                self.assertEqual(result, 2)
                self.assertNotIn('ATOMIC APPLY OK', output)
                self.assertIn('login verification failed', error)


if __name__ == '__main__':
    unittest.main()
