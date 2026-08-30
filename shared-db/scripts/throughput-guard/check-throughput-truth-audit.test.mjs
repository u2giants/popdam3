import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { discover, ROOTS, EXTENSIONS, disposition, run } from '../check-throughput-truth-audit.mjs';

function discoverWithSource(root, source) {
  const target = path.join(root, 'scripts/x.py');
  const current = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, source);
  const rows = discover(root);
  fs.writeFileSync(target, current);
  return rows;
}

function fixture(source, auditSource = source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  for (const directory of ROOTS) fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/verification'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/x.py'), source);
  const reviewed = discoverWithSource(root, auditSource);
  const semanticKeys = reviewed.map((row) => row.semantic_key);
  const audit = { schema_version: 3, call_site_count: reviewed.length, call_site_sha256: crypto.createHash('sha256').update(JSON.stringify(semanticKeys)).digest('hex'), sites: reviewed.map((row) => ({ ...row, disposition: 'excluded', reason: 'This fixture deliberately preserves the reviewed behavior.' })) };
  fs.writeFileSync(path.join(root, 'docs/verification/throughput-guard-truth-audit-20260828.json'), `${JSON.stringify(audit, null, 2)}\n`);
  return root;
}

test('discovery roots and extensions are fixed code', () => { assert.deepEqual(ROOTS, ['scripts', '.github/workflows']); assert.ok(EXTENSIONS.has('.py')); });
test('nested guard files are discovered with semantic identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  for (const directory of ROOTS) fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts/nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/nested/x.py'), 'print("NOT_DERIVABLE")');
  const [site] = discover(root);
  assert.equal(site.site, 'scripts/nested/x.py:1');
  assert.match(site.semantic_key, /^scripts\/nested\/x\.py:[a-f0-9]{64}:1$/);
});
test('a blanket default cannot dispose an unlisted site', () => { assert.equal(disposition('scripts/x.py:hash:1', { default_disposition: { disposition: 'excluded' } }), undefined); });
test('moving an unchanged reviewed line does not require mechanical renumbering', () => { const root = fixture('\nprint("NOT_DERIVABLE")', 'print("NOT_DERIVABLE")'); assert.equal(run(root), 'truth audit OK: call_sites=1'); });
test('changing line meaning cannot reuse the old disposition', () => { const root = fixture('print("missing now")', 'print("NOT_DERIVABLE")'); assert.throws(() => run(root), /semantic inventory drift/); });
test('a legacy line-number-only inventory is refused', () => {
  const root = fixture('print("NOT_DERIVABLE")');
  const auditPath = path.join(root, 'docs/verification/throughput-guard-truth-audit-20260828.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  audit.schema_version = 2;
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  assert.throws(() => run(root), /schema_version must be 3/);
});
