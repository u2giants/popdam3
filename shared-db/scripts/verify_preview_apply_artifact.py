"""Read-only original-preview proof when archived display step names are lost.

The caller still proves PR/run provenance. This reader binds the downloaded ZIP
to GitHub's digest and proves its actual ledger delta and migration bytes. It
never derives proof from UNKNOWN STEP output or timestamp guesses.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

from production_migration_guard import parse_remote_versions
from production_business_risk_gate import preview_content_manifest


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def verify(request, archive_bytes, migration_bytes):
    artifact, run, binding = (request[key] for key in ('artifact', 'run', 'binding'))
    versions = request['versions']
    require(isinstance(versions, list) and versions and len(set(versions)) == len(versions)
            and all(isinstance(v, str) and re.fullmatch(r'\d{14}', v) for v in versions), 'invalid allowlist')
    require(run.get('path') == '.github/workflows/shared-supabase-migrations.yml'
            and run.get('event') == 'workflow_dispatch' and run.get('status') == 'completed'
            and run.get('conclusion') == 'success' and run.get('run_attempt') == 1,
            'not a successful original apply run')
    require(isinstance(run.get('id'), int) and not isinstance(run['id'], bool)
            and re.fullmatch(r'[0-9a-f]{40}', str(run.get('head_sha', ''))), 'invalid run identity')
    require(artifact.get('expired') is False
            and artifact.get('name') == 'preview-migration-apply-' + str(binding.get('appliedCommit'))
            and artifact.get('workflow_run', {}).get('id') == run['id']
            and artifact.get('workflow_run', {}).get('head_sha') == run['head_sha'], 'artifact run identity mismatch')
    require(artifact.get('digest') == 'sha256:' + hashlib.sha256(archive_bytes).hexdigest(), 'artifact digest mismatch')
    require(binding.get('schema') == 'shared-db-preview-instance-binding/v1'
            and re.fullmatch(r'[0-9a-f]{40}', str(binding.get('appliedCommit', '')))
            and binding.get('runId') == run['id']
            and binding.get('previewProjectRef') == request['previewProjectRef']
            and sorted(binding.get('allowlist', [])) == sorted(versions)
            and binding.get('rehearsalMode') in ('claim', 'merged-main-rehearsal'), 'preview binding mismatch')
    texts = {}
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        require(len(archive.infolist()) <= 32
                and sum(entry.file_size for entry in archive.infolist()) <= 32 * 1024 * 1024,
                'oversized artifact archive')
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            name = Path(entry.filename).name
            require(name not in texts, 'duplicate artifact basename')
            require(entry.file_size <= 16 * 1024 * 1024, 'oversized artifact entry')
            texts[name] = archive.read(entry).decode('utf-8', errors='strict')
    require('historical-preview-source.json' not in texts, 'recovery artifact is not original apply proof')
    require(json.loads(texts['preview-instance.json']) == binding, 'archive preview binding mismatch')
    with tempfile.TemporaryDirectory(prefix='original-preview-ledger-') as folder:
        before, after = Path(folder, 'before'), Path(folder, 'after')
        before.write_text(texts['preview-ledger-before.txt'], encoding='utf-8')
        after.write_text(texts['preview-ledger-after.txt'], encoding='utf-8')
        old, new = parse_remote_versions(before), parse_remote_versions(after)
    require(new - old == set(versions) and not old - new, 'artifact ledger delta mismatch')
    manifest = preview_content_manifest(texts)
    for version in versions:
        require(manifest.get(version) == hashlib.sha256(migration_bytes(version)).hexdigest(),
                'migration content mismatch: ' + version)
    return {'verified': True, 'runId': run['id'], 'artifactId': artifact['id'],
            'artifactDigest': artifact['digest'], 'versions': sorted(versions)}


def git_migration_reader(commit):
    require(re.fullmatch(r'[0-9a-f]{40}', str(commit)), 'invalid verification commit')
    names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit,
                                     '--', 'supabase/migrations'], text=True).splitlines()

    def read(version):
        matches = [name for name in names if Path(name).name.startswith(version + '_') and name.endswith('.sql')]
        require(len(matches) == 1, 'migration absent or ambiguous at verification commit')
        return subprocess.check_output(['git', 'show', commit + ':' + matches[0]])
    return read


def main():
    request = json.load(sys.stdin)
    artifact_id = request['artifact']['id']
    require(isinstance(artifact_id, int) and not isinstance(artifact_id, bool) and artifact_id > 0,
            'invalid artifact id')
    archive = subprocess.check_output(['gh', 'api',
        f'repos/u2giants/shared-db/actions/artifacts/{artifact_id}/zip'], stderr=subprocess.PIPE)
    print(json.dumps(verify(request, archive, git_migration_reader(request['verificationCommit']))))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Preview artifact proof refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
