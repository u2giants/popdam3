import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { discover, ROOTS, EXTENSIONS, disposition, run, dispositionFileName, readCatalogues, groupBySource, DISPOSITION_DIR, DISPOSITION_SCHEMA_VERSION, HISTORICAL_AUDIT } from '../check-throughput-truth-audit.mjs';

const REASON = 'This fixture deliberately preserves the reviewed behavior.';

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  for (const directory of ROOTS) fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.mkdirSync(path.join(root, DISPOSITION_DIR), { recursive: true });
  return root;
}

function catalogueFor(root, source) {
  return path.join(root, DISPOSITION_DIR, dispositionFileName(source));
}

/** Write one reviewed catalogue per source, from the sites currently on disk. */
function writeCatalogues(root, { reason = REASON } = {}) {
  for (const [source, rows] of groupBySource(discover(root))) {
    const body = { schema_version: DISPOSITION_SCHEMA_VERSION, source, sites: rows.map((row) => ({ site: row.site, semantic_key: row.semantic_key, line_sha256: row.line_sha256, disposition: 'excluded', reason })) };
    fs.writeFileSync(catalogueFor(root, source), `${JSON.stringify(body, null, 2)}\n`);
  }
}

/** Build a root whose catalogue was reviewed against `auditSource` but whose file holds `source`. */
function fixture(source, auditSource = source) {
  const root = tempRoot();
  const target = path.join(root, 'scripts/x.py');
  fs.writeFileSync(target, auditSource);
  writeCatalogues(root);
  fs.writeFileSync(target, source);
  return root;
}

test('discovery roots and extensions are fixed code', () => { assert.deepEqual(ROOTS, ['scripts', '.github/workflows']); assert.ok(EXTENSIONS.has('.py')); });

test('nested guard files are discovered with semantic identity', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'scripts/nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/nested/x.py'), 'print("NOT_DERIVABLE")');
  const [site] = discover(root);
  assert.equal(site.site, 'scripts/nested/x.py:1');
  assert.equal(site.source, 'scripts/nested/x.py');
  assert.match(site.semantic_key, /^scripts\/nested\/x\.py:[a-f0-9]{64}:1$/);
});

test('a blanket default cannot dispose an unlisted site', () => { assert.equal(disposition('scripts/x.py:hash:1', { default_disposition: { disposition: 'excluded' } }), undefined); });

test('moving an unchanged reviewed line does not require mechanical renumbering', () => { assert.match(run(fixture('\nprint("NOT_DERIVABLE")', 'print("NOT_DERIVABLE")')), /^truth audit OK: call_sites=1 /); });

test('changing line meaning cannot reuse the old disposition', () => { assert.throws(() => run(fixture('print("missing now")', 'print("NOT_DERIVABLE")')), /semantic inventory drift/); });

test('disposition_unknown_site_refuses', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'scripts/x.py'), 'print("NOT_DERIVABLE")');
  assert.throws(() => run(root), /no reviewed disposition catalogue for scripts\/x\.py/);
  writeCatalogues(root);
  fs.appendFileSync(path.join(root, 'scripts/x.py'), '\nprint("NOT_DERIVABLE again, not applied")');
  assert.throws(() => run(root), /semantic inventory drift in scripts\/x\.py/);
});

test('disposition_deleted_site_requires_retirement', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'scripts/x.py'), 'print("NOT_DERIVABLE")');
  fs.writeFileSync(path.join(root, 'scripts/y.py'), 'print("NOT_DERIVABLE")');
  writeCatalogues(root);
  fs.rmSync(path.join(root, 'scripts/y.py'));
  assert.throws(() => run(root), /must be retired: scripts\/y\.py/);
  fs.rmSync(catalogueFor(root, 'scripts/y.py'));
  assert.match(run(root), /call_sites=1 sources=1/);
});

test('disposition_path_rename_preserves_review', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'scripts/x.py'), 'print("NOT_DERIVABLE")');
  writeCatalogues(root);
  const reviewed = JSON.parse(fs.readFileSync(catalogueFor(root, 'scripts/x.py'), 'utf8'));
  // A rename moves the reviewed reason with the code; the identity is rebound, never invented.
  fs.renameSync(path.join(root, 'scripts/x.py'), path.join(root, 'scripts/renamed.py'));
  fs.rmSync(catalogueFor(root, 'scripts/x.py'));
  assert.throws(() => run(root), /no reviewed disposition catalogue for scripts\/renamed\.py/);
  const [row] = discover(root);
  assert.equal(row.line_sha256, reviewed.sites[0].line_sha256);
  fs.writeFileSync(catalogueFor(root, 'scripts/renamed.py'), `${JSON.stringify({ schema_version: DISPOSITION_SCHEMA_VERSION, source: 'scripts/renamed.py', sites: [{ site: row.site, semantic_key: row.semantic_key, line_sha256: row.line_sha256, disposition: 'excluded', reason: reviewed.sites[0].reason }] }, null, 2)}\n`);
  assert.match(run(root), /call_sites=1/);
});

test('disposition_duplicate_identity_refuses', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'scripts/x.py'), 'print("NOT_DERIVABLE")\nprint("NOT_DERIVABLE")');
  writeCatalogues(root);
  const file = catalogueFor(root, 'scripts/x.py');
  const catalogue = JSON.parse(fs.readFileSync(file, 'utf8'));
  catalogue.sites[1] = { ...catalogue.sites[0] };
  fs.writeFileSync(file, `${JSON.stringify(catalogue, null, 2)}\n`);
  assert.throws(() => run(root), /duplicate semantic identities/);
});

test('disposition_empty_reason_refuses', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'scripts/x.py'), 'print("NOT_DERIVABLE")');
  writeCatalogues(root, { reason: 'too short' });
  assert.throws(() => run(root), /no substantive semantically bound disposition/);
});

test('a catalogue filename is bound to its declared source and cannot be smuggled', () => {
  assert.throws(() => dispositionFileName('scripts/../../etc/passwd'), /unsafe disposition source path/);
  assert.throws(() => dispositionFileName('/etc/passwd'), /unsafe disposition source path/);
  assert.throws(() => dispositionFileName('scripts/a~b.py'), /unsafe disposition source path/);
  assert.throws(() => dispositionFileName('docs/x.py'), /outside the discovery roots/);
  assert.equal(dispositionFileName('scripts/x.py'), 'scripts~x.py.json');
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'scripts/x.py'), 'print("NOT_DERIVABLE")');
  writeCatalogues(root);
  fs.renameSync(catalogueFor(root, 'scripts/x.py'), path.join(root, DISPOSITION_DIR, 'SCRIPTS~X.PY.json'));
  assert.throws(() => readCatalogues(root), /does not match its declared source|schema_version/);
});

test('an aggregate call_site_count and call_site_sha256 are no longer an input', () => {
  const root = fixture('print("NOT_DERIVABLE")');
  fs.mkdirSync(path.join(root, path.dirname(HISTORICAL_AUDIT)), { recursive: true });
  fs.writeFileSync(path.join(root, HISTORICAL_AUDIT), `${JSON.stringify({ schema_version: 3, status: 'historical', call_site_count: 99999, call_site_sha256: 'deliberately-wrong', sites: [] }, null, 2)}\n`);
  assert.match(run(root), /^truth audit OK: call_sites=1 /);
});

test('historical_disposition_loader_preserves_review_records', () => {
  // Historical conversion evidence is a fixed input, not a ceiling on the live catalogue.
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const historical = JSON.parse(fs.readFileSync(path.join(repoRoot, HISTORICAL_AUDIT), 'utf8'));
  const root = tempRoot();
  const grouped = new Map();
  for (const row of historical.sites) {
    const source = row.semantic_key.split(':')[0];
    if (!grouped.has(source)) grouped.set(source, []);
    grouped.get(source).push(row);
  }
  for (const [source, sites] of grouped) {
    fs.writeFileSync(catalogueFor(root, source), JSON.stringify({ schema_version: DISPOSITION_SCHEMA_VERSION, source, sites }));
  }
  const loaded = [...readCatalogues(root).values()].flatMap((catalogue) => catalogue.sites);
  const shape = (rows) => rows.map((row) => `${row.semantic_key}|${row.line_sha256}|${row.disposition}|${row.reason}`).sort();
  assert.equal(loaded.length, historical.sites.length);
  assert.deepEqual(shape(loaded), shape(historical.sites));
});

test('current_repository_catalogues_follow_current_discovery', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const found = discover(repoRoot);
  assert.match(run(repoRoot), new RegExp(`^truth audit OK: call_sites=${found.length} sources=${groupBySource(found).size} `));
});

test('reviewed_catalogues_may_evolve_without_rewriting_history', () => {
  const root = tempRoot();
  const oldSource = 'scripts/old.py', newSource = 'scripts/new.py';
  const put = (source, text) => fs.writeFileSync(path.join(root, source), text);
  const review = (source) => {
    const sites = discover(root).filter((row) => row.source === source).map((row) => ({ ...row, disposition: 'excluded', reason: REASON }));
    fs.writeFileSync(catalogueFor(root, source), JSON.stringify({ schema_version: DISPOSITION_SCHEMA_VERSION, source, sites }));
  };
  put(oldSource, 'print("missing first")\nprint("missing second")'); review(oldSource);
  const historical = fs.readFileSync(catalogueFor(root, oldSource), 'utf8');
  fs.writeFileSync(path.join(root, 'historical.json'), historical);
  put(newSource, 'print("missing new")');
  assert.throws(() => run(root), /no reviewed disposition catalogue/);
  review(newSource); assert.match(run(root), /call_sites=3 /);
  put(oldSource, 'print("missing changed")\nprint("missing second")');
  assert.throws(() => run(root), /semantic inventory drift/);
  review(oldSource); assert.match(run(root), /call_sites=3 /);
  put(oldSource, 'print("missing changed")');
  assert.throws(() => run(root), /semantic inventory drift/);
  review(oldSource); assert.match(run(root), /call_sites=2 /);
  assert.equal(fs.readFileSync(path.join(root, 'historical.json'), 'utf8'), historical);
});

test('independent_source_dispositions_merge_without_global_edit', () => {
  // The regression issue #2832 reported: two unrelated call-site changes had to edit one shared
  // count and digest, so the second lane could never be correct without redoing the first.
  const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-merge-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'fixture');
  for (const directory of ROOTS) fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.mkdirSync(path.join(root, DISPOSITION_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/a.py'), 'print("NOT_DERIVABLE")');
  fs.writeFileSync(path.join(root, 'scripts/b.py'), 'print("NOT_DERIVABLE")');
  writeCatalogues(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');

  const lane = (branch, file) => {
    git(root, 'checkout', '-q', '-b', branch, 'main');
    fs.appendFileSync(path.join(root, file), '\nprint("a second NOT_DERIVABLE here")');
    writeCatalogues(root);
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', branch);
  };
  lane('lane-a', 'scripts/a.py');
  lane('lane-b', 'scripts/b.py');

  git(root, 'checkout', '-q', 'lane-a');
  git(root, 'merge', '-q', '--no-edit', 'lane-b');
  assert.equal(git(root, 'status', '--porcelain').trim(), '');
  assert.match(run(root), /^truth audit OK: call_sites=4 sources=2 /);
});
