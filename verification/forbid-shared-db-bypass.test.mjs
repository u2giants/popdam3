import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// Execute the actual workflow shell block against independent synthetic Git diffs.
// The production executor and the migration ledger are never invoked here.
const workflow = readFileSync(new URL('../.github/workflows/forbid-shared-db-bypass.yml', import.meta.url), 'utf8');
const block = workflow.split('        run: |\n')[1];
assert.ok(block, 'workflow must contain its shell guard');
const blockLines = [];
for (const line of block.split('\n')) {
  if (line.trim() && !line.startsWith('          ')) break;
  blockLines.push(line.startsWith('          ') ? line.slice(10) : line);
}
const shell = blockLines.join('\n');

function guardedDiff(path, body) {
  const dir = mkdtempSync(join(tmpdir(), 'shared-db-guard-test-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
    git('init', '-q');
    git('config', 'user.name', 'Guard Fixture');
    git('config', 'user.email', 'guard-fixture@example.invalid');
    git('commit', '--allow-empty', '-qm', 'Synthetic baseline');
    const base = git('rev-parse', 'HEAD');
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
    git('add', '--', path);
    git('commit', '-qm', 'Synthetic change');
    const rendered = shell.replaceAll('${{ github.event_name }}', 'pull_request')
      .replaceAll('${{ github.event.pull_request.base.sha }}', base)
      .replaceAll('${{ github.event.before }}', '');
    return spawnSync('bash', ['-c', rendered], { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const approvedPath = 'scripts/orderlist-settled-exception-executor.py';
const exactReads = [
  `        "to_regclass('supabase_migrations.schema_migrations') is not null"`,
  `        "exists(select 1 from supabase_migrations.schema_migrations where version=%s)"`,
];

test('both exact guard-presence reads pass the actual workflow', () => {
  const result = guardedDiff(approvedPath, exactReads.join('\n') + '\n');
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

for (const [name, path, text] of [
  ['same read in another file', 'scripts/another-reader.py', exactReads[1]],
  ['additional ledger read', approvedPath, 'select * from supabase_migrations.schema_migrations'],
  ['appended ledger mutation', approvedPath, exactReads[1] + '; delete from supabase_migrations.schema_migrations'],
  ['ledger insert in approved file', approvedPath, 'insert into supabase_migrations.schema_migrations values (1)'],
  ['ledger repair', approvedPath, 'supabase migration repair'],
  ['database push', approvedPath, 'supabase db push'],
  ['database reset', approvedPath, 'supabase db reset'],
  ['forbidden credential path', approvedPath, 'SUPABASE_DB_PASSWORD'],
  ['app-owned migration', 'supabase/migrations/20990101000000_test.sql', 'select 1;'],
]) {
  test(`${name} remains rejected`, () => {
    const result = guardedDiff(path, text + '\n');
    assert.equal(result.status, 1, result.stderr + result.stdout);
  });
}

test('unrelated application code remains permitted', () => {
  const result = guardedDiff('scripts/ordinary.py', 'print("hello")\n');
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
