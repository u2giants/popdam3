import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover, run, readCatalogues, dispositionFileName, DISPOSITION_DIR, DISPOSITION_SCHEMA_VERSION, HISTORICAL_AUDIT } from '../check-throughput-truth-audit.mjs';

function fixture(source, reason = 'Reviewed against the exact enclosing source context.') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-context-'));
  for (const dir of ['scripts', '.github/workflows', DISPOSITION_DIR]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const file = path.join(root, 'scripts/x.py');
  fs.writeFileSync(file, source);
  const sites = discover(root).map((row) => ({ ...row, disposition: 'excluded', reason }));
  const catalogue = path.join(root, DISPOSITION_DIR, dispositionFileName('scripts/x.py'));
  fs.writeFileSync(catalogue, JSON.stringify({ schema_version: DISPOSITION_SCHEMA_VERSION, source: 'scripts/x.py', sites }));
  return { root, file, catalogue, sites };
}

test('identical call lines cannot exchange enclosing functions and retain review', () => {
  const f = fixture('def first():\n    print("NOT_DERIVABLE")\ndef second():\n    print("NOT_DERIVABLE")\n');
  fs.writeFileSync(f.file, 'def second():\n    print("NOT_DERIVABLE")\ndef first():\n    print("NOT_DERIVABLE")\n');
  assert.throws(() => run(f.root), /semantic inventory drift/);
});

test('whitespace-only reviewed reason refuses', () => {
  const f = fixture('print("NOT_DERIVABLE")', ' \t\n'.repeat(20));
  assert.throws(() => run(f.root), /no substantive semantically bound disposition/);
});

test('blank lines remain diagnostic rather than identity', () => {
  const f = fixture('def first():\n    print("NOT_DERIVABLE")\n');
  fs.writeFileSync(f.file, '\n\ndef first():\n\n    print("NOT_DERIVABLE")\n\n');
  assert.match(run(f.root), /truth audit OK/);
});

test('duplicate indistinguishable source contexts refuse instead of ordinal review assignment', () => {
  const duplicate = 'def duplicate():\n    before()\n    before_again()\n    print("NOT_DERIVABLE")\n    after()\n    after_again()\n';
  assert.throws(() => fixture(duplicate + duplicate), /ambiguous.*identit/);
});

test('malicious source encodings and excluded roots refuse', () => {
  for (const source of ['scripts/%2e%2e/x.py', 'scripts\\..\\x.py', 'scripts/a~b.py', 'scripts/../x.py', 'docs/x.py', 'scripts/\u0000x.py']) {
    assert.throws(() => dispositionFileName(source), /unsafe|outside/);
  }
});

function assertHistoricalDispositions(historical, current, retired) {
  assert.equal(new Set(retired.map((row) => row.semantic_key)).size, retired.length, 'retired identity keys must be unique');
  const historicalByKey = new Map(historical.map((row) => [row.semantic_key, row]));
  for (const row of retired) {
    const original = historicalByKey.get(row.semantic_key);
    assert.ok(original, `retired identity was not in the historical audit: ${row.semantic_key}`);
    for (const field of ['line_sha256', 'disposition', 'reason']) assert.equal(row[field], original[field], `retired identity changed its historical ${field}`);
  }
  const retiredByKey = new Map(retired.map((row) => [row.semantic_key, row]));
  for (const original of historical) {
    const matches = current.filter((row) => (row.legacy_semantic_key ?? row.semantic_key) === original.semantic_key);
    assert.ok(matches.length <= 1, `duplicate current historical identity: ${original.semantic_key}`);
    const retirement = retiredByKey.get(original.semantic_key);
    if (matches.length && retirement) assert.equal(retirement.state, 'pending', `live identity cannot already be retired: ${original.semantic_key}`);
    if (!matches.length && retirement) assert.equal(retirement.state, 'retired', `missing identity needs a completed retirement: ${original.semantic_key}`);
    const matched = matches[0] ?? retirement;
    assert.ok(matched, `historical identity disappeared without a retirement record: ${original.semantic_key}`);
    for (const field of ['line_sha256', 'disposition', 'reason']) assert.equal(matched[field], original[field], `${original.semantic_key}: ${field}`);
  }
}

test('context migration preserves every historical identity hash verdict and reason, including explicit retirements', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const historical = JSON.parse(fs.readFileSync(path.join(root, HISTORICAL_AUDIT), 'utf8')).sites;
  const current = [...readCatalogues(root).values()].flatMap(({ sites }) => sites);
  const archive = JSON.parse(fs.readFileSync(path.join(root, 'docs/verification/throughput-retired-identity-sites.json'), 'utf8'));
  assert.equal(archive.schema_version, 1);
  assert.equal(archive.retired_by_pr, 3521);
  assertHistoricalDispositions(historical, current, archive.sites);
});

test('historical identity retirement refuses unexplained loss and changed verdicts', () => {
  const row = { semantic_key: 'scripts/x.py:hash:1', line_sha256: 'hash', disposition: 'excluded', reason: 'reviewed reason' };
  assert.throws(() => assertHistoricalDispositions([row], [], []), /disappeared without a retirement record/);
  assert.throws(() => assertHistoricalDispositions([row], [], [{ ...row, state: 'retired', reason: 'new reason' }]), /changed its historical reason/);
  assert.throws(() => assertHistoricalDispositions([row], [], [{ ...row, state: 'pending' }]), /needs a completed retirement/);
  assert.throws(() => assertHistoricalDispositions([row], [row], [{ ...row, state: 'retired' }]), /live identity cannot already be retired/);
  assert.throws(() => assertHistoricalDispositions([row], [], [row, row]), /keys must be unique/);
});

test('separate YAML jobs distinguish identical snippets without ordinal identity', () => {
  const f = fixture('print("NOT_DERIVABLE")');
  const file = path.join(f.root, '.github/workflows/x.yml');
  fs.writeFileSync(file, 'jobs:\n  first:\n    steps:\n      - run: |\n          before\n          before_again\n          echo NOT_DERIVABLE\n          after\n          after_again\n  second:\n    steps:\n      - run: |\n          before\n          before_again\n          echo NOT_DERIVABLE\n          after\n          after_again\n');
  const rows = discover(f.root).filter(({ source }) => source.endsWith('x.yml'));
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].semantic_key, rows[1].semantic_key);
});
