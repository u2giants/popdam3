import copy
import hashlib
import io
import json
import unittest
import zipfile

from verify_preview_apply_artifact import verify


class OriginalArtifactTests(unittest.TestCase):
    def fixture(self):
        version, prior, sha = '20260909132734', '20260101000000', 'a' * 40
        binding = dict(schema='shared-db-preview-instance-binding/v1', runId=123,
                       previewProjectRef='preview', allowlist=[version],
                       appliedCommit=sha, mergeCommitSha=sha,
                       rehearsalMode='merged-main-rehearsal', sourcePr=2634)
        request = dict(versions=[version], previewProjectRef='preview', binding=binding,
                       run=dict(id=123, path='.github/workflows/shared-supabase-migrations.yml',
                                event='workflow_dispatch', status='completed', conclusion='success',
                                run_attempt=1, head_sha=sha),
                       artifact=dict(id=456, expired=False, name='preview-migration-apply-' + sha,
                                     workflow_run=dict(id=123, head_sha=sha)))
        files = {'preview-instance.json': json.dumps(binding),
                 'preview-ledger-before.txt': json.dumps([dict(version=prior)]),
                 'preview-ledger-after.txt': json.dumps([dict(version=prior), dict(version=version)]),
                 'migration-content-manifest.json': json.dumps({version: hashlib.sha256(b'SELECT 1;').hexdigest()})}
        return request, files

    def archive(self, request, files):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for name, contents in files.items():
                archive.writestr(name, contents)
        data = output.getvalue()
        request['artifact']['digest'] = 'sha256:' + hashlib.sha256(data).hexdigest()
        return data

    def test_exact_original_proof(self):
        request, files = self.fixture()
        result = verify(request, self.archive(request, files), lambda _: b'SELECT 1;')
        self.assertEqual(result['versions'], ['20260909132734'])
        self.assertTrue(result['verified'])

    def test_refuses_changed_metadata(self):
        mutations = [lambda r: r['run'].update(conclusion='failure'),
                     lambda r: r['run'].update(run_attempt=2),
                     lambda r: r['artifact'].update(expired=True),
                     lambda r: r['artifact']['workflow_run'].update(id=124),
                     lambda r: r['artifact']['workflow_run'].update(head_sha='b' * 40),
                     lambda r: r.update(previewProjectRef='production'),
                     lambda r: r['artifact'].update(digest='sha256:' + '0' * 64)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                request, files = self.fixture()
                archive = self.archive(request, files)
                mutate(request)
                with self.assertRaises(ValueError):
                    verify(request, archive, lambda _: b'SELECT 1;')

    def test_refuses_invalid_archive_evidence(self):
        request, original = self.fixture()
        changes = [dict(**{'preview-ledger-after.txt': original['preview-ledger-before.txt']}),
                   {'preview-ledger-before.txt': json.dumps([dict(version='20250101000000')])},
                   {'preview-ledger-after.txt': json.dumps([dict(version='20260101000000'), dict(version='20260909132734'), dict(version='20260909132735')])},
                   {'preview-instance.json': '{}'},
                   {'migration-content-manifest.json': '{}'},
                   {'historical-preview-source.json': '{}'},
                   {'nested/preview-instance.json': original['preview-instance.json']}]
        for changed in changes:
            with self.subTest(files=list(changed)):
                candidate = copy.deepcopy(request)
                with self.assertRaises(ValueError):
                    verify(candidate, self.archive(candidate, original | changed), lambda _: b'SELECT 1;')

    def test_refuses_changed_migration_bytes(self):
        request, files = self.fixture()
        with self.assertRaisesRegex(ValueError, 'content mismatch'):
            verify(request, self.archive(request, files), lambda _: b'SELECT 2;')


if __name__ == '__main__':
    unittest.main()
