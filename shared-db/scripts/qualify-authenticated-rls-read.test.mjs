import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { qualify, RESOURCE, workloadSQL, numericPlan } from './qualify-authenticated-rls-read.mjs';

function fixture(mode = 'ok') {
  const events = [], directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rls-read-test-'));
  const output = path.join(directory, 'result.json');
  const now = 1800000000000;
  const subject = '00000000-0000-4000-8000-000000000001';
  const claims = { iss: `https://${RESOURCE.project_ref}.supabase.co/auth/v1`, sub: subject, role: 'authenticated', exp: now / 1000 + 900, mock_secret: 'CLAIM_CANARY' };
  if (mode === 'issuer') claims.iss = 'https://invalid.example/auth/v1';
  if (mode === 'subject') claims.sub = '00000000-0000-4000-8000-000000000002';
  if (mode === 'role') claims.role = 'service_role';
  if (mode === 'expiry') claims.exp = now / 1000 + 10;
  const token = 'TOKEN_CANARY.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.SIGNATURE_CANARY';
  const env = { QA_EMAIL: 'tester@example.invalid', QA_PASSWORD: 'PASSWORD_CANARY', PROD_DB_PASSWORD: 'DB_PASSWORD_CANARY', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mock' };
  const client = {
    auth: {
      signInWithPassword: async () => { events.push('login'); return { data: { session: { access_token: token }, user: { id: subject } }, error: mode === 'login' ? { message: token } : null }; },
      getUser: async received => { assert.equal(received, token); return { data: { user: { id: mode === 'identity' ? 'unmatched' : subject, role: 'authenticated' } } }; },
      signOut: async options => { assert.deepEqual(options, { scope: 'local' }); events.push('signout'); if (mode === 'signout-throw') throw Error(token); return { error: mode === 'signout' ? { message: token } : null }; }
    },
    from: table => { assert.equal(table, 'user_roles'); return { select: () => ({ eq: () => ({ limit: async () => ({ data: mode === 'admin' ? [] : [{ role: 'admin' }] }) }) }) }; }
  };
  class Client {
    constructor(config) { assert.equal(config.ssl.rejectUnauthorized, true); assert.equal(config.host, RESOURCE.pooler_host); assert.equal(config.user, `postgres.${RESOURCE.project_ref}`); }
    async connect() { events.push('connect'); }
    async end() { events.push('end'); if (mode === 'close') throw Error(token); }
    async query(sql, params) {
      events.push(sql);
      if (sql === 'ROLLBACK' && mode === 'rollback') throw Error(token);
      if (mode === 'query' && sql.startsWith('EXPLAIN')) throw Error(token);
      if (sql === 'BEGIN READ ONLY' || sql.startsWith('SET ') || sql === 'RESET ROLE' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('AS database_name')) return { rows: [{ ro: mode === 'readonly' ? 'off' : 'on', default_ro: 'on', database_name: 'postgres', project_ref: mode === 'target' ? 'foreign' : RESOURCE.project_ref }] };
      if (sql.includes('schema_migrations')) { assert.equal(params[0], '20261021190604'); return { rows: [{ present: mode !== 'ledger' }] }; }
      if (sql.startsWith('SELECT set_config')) { assert.deepEqual(JSON.parse(params[0]), claims); return { rows: [] }; }
      if (sql.includes('current_user AS actor')) return { rows: [{ actor: 'authenticated', rolsuper: mode === 'superuser', rolbypassrls: mode === 'bypass', owns_target: mode === 'owner', ro: 'on', subject_matches: true, public_admin: true }] };
      if (sql.startsWith('SELECT count')) return { rows: [{ bounded_count: mode === 'count' ? 999999 : 43 }] };
      if (sql.startsWith('EXPLAIN')) return { rows: [{ 'QUERY PLAN': [{ 'Execution Time': 1, Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'profiles', 'Actual Loops': 1, Filter: token, Output: [subject], 'Index Cond': 'PASSWORD_CANARY', JIT: token } }] }] };
      throw Error('Unexpected mock SQL');
    }
  }
  const options = { createClient: (_url, _key, options) => { assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }); return client; }, Client, versions: { sdk: '2.97.0', pg: '8.23.1' }, ca: Buffer.from('MOCK_CA'), publicKey: env.SUPABASE_PUBLISHABLE_KEY, output, env, now: () => now };
  return { events, directory, output, env, options, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
function assertClean(f, report) {
  const text = JSON.stringify(report);
  for (const secret of ['TOKEN_CANARY', 'SIGNATURE_CANARY', 'CLAIM_CANARY', 'PASSWORD_CANARY', 'DB_PASSWORD_CANARY', 'tester@example.invalid', '00000000-0000-4000-8000-000000000001']) assert(!text.includes(secret));
  assert.equal(Object.keys(f.env).length, 0);
  if (f.events.includes('connect')) assert.equal(f.events[f.events.indexOf('connect') + 1], 'BEGIN READ ONLY');
  if (f.events.includes('BEGIN READ ONLY')) { assert(f.events.includes('ROLLBACK')); assert(f.events.includes('end')); }
  if (f.events.includes('login')) assert(f.events.includes('signout'));
  if (fs.existsSync(f.output)) { assert.equal(fs.statSync(f.output).mode & 0o777, 0o600); assert.deepEqual(JSON.parse(fs.readFileSync(f.output)), report); }
}
test('fixed exact four workloads and 44 plans, read-only first, full genuine claims, clean output', async () => {
  const f = fixture(); try {
    const report = await qualify(f.options); assert.equal(report.passed, true); assert.equal(report.workloads.length, 4);
    assert.equal(f.events.filter(e => e.startsWith('EXPLAIN')).length, 44);
    assert.deepEqual(report.workloads.map(w => [w.table, w.row_limit, w.samples.length]), [['profiles', 200, 10], ['admin_config', 200, 10], ['assets', 1000, 10], ['style_groups', 1000, 10]]);
    for (const w of RESOURCE.workloads) assert(f.events.includes(workloadSQL(w.table, w.limit)));
    assertClean(f, report);
  } finally { f.cleanup(); }
});
for (const mode of ['login', 'identity', 'issuer', 'subject', 'role', 'expiry', 'admin']) test(`identity failure ${mode} prevents DB connection`, async () => {
  const f = fixture(mode); try { const r = await qualify(f.options); assert.equal(r.passed, false); assert(!f.events.includes('connect')); assertClean(f, r); } finally { f.cleanup(); }
});
for (const mode of ['target', 'readonly', 'ledger', 'bypass', 'superuser', 'owner', 'query', 'count', 'rollback', 'close', 'signout', 'signout-throw']) test(`fails closed and cleans up: ${mode}`, async () => {
  const f = fixture(mode); try { const r = await qualify(f.options); assert.equal(r.passed, false); assertClean(f, r); } finally { f.cleanup(); }
});
test('dependency/contract drift fails before authentication', async () => {
  for (const mutate of [o => o.versions.pg = '8.24.0', o => o.resource = { ...RESOURCE, project_ref: 'foreign' }, o => o.resource = { ...RESOURCE, samples: 11 }]) {
    const f = fixture(); try { mutate(f.options); const r = await qualify(f.options); assert.equal(r.passed, false); assert(!f.events.includes('login')); assertClean(f, r); } finally { f.cleanup(); }
  }
});
test('existing output and symlink cannot be overwritten or cause login', async () => {
  for (const symlink of [false, true]) { const f = fixture(); try {
    const target = path.join(f.directory, 'original'); fs.writeFileSync(target, 'retained');
    if (symlink) fs.symlinkSync(target, f.output); else fs.writeFileSync(f.output, 'retained');
    const r = await qualify(f.options); assert.equal(r.passed, false); assert(!f.events.includes('login')); assert.equal(fs.readFileSync(target, 'utf8'), 'retained'); assert.equal(fs.readFileSync(f.output, 'utf8'), 'retained');
  } finally { f.cleanup(); } }
});
test('output reservation explicitly uses EXCL, NOFOLLOW, 0600; write failure fails closed', async () => {
  const f = fixture(); try {
    const io = Object.create(fs); io.openSync = (p, flags, mode) => { assert(flags & fs.constants.O_EXCL); assert(flags & fs.constants.O_NOFOLLOW); assert.equal(mode, 0o600); return fs.openSync(p, flags, mode); };
    io.writeFileSync = () => { throw Error('TOKEN_CANARY'); }; f.options.io = io;
    const r = await qualify(f.options); assert.equal(r.passed, false); assert.equal(r.output_failed, true); assert(f.events.includes('ROLLBACK')); assert(f.events.includes('signout')); assert(!JSON.stringify(r).includes('TOKEN_CANARY'));
  } finally { f.cleanup(); }
});
test('sanitizer omits predicates, arbitrary relations and untrusted error content', () => {
  assert.deepEqual(numericPlan({ 'Execution Time': 1, 'Relation Name': 'license-secret', Filter: 'secret', Output: ['secret'], Plans: [{ 'Node Type': 'Result', 'Actual Loops': 1 }], 'Subplan Name': 'InitPlan 1 (returns $0)' }), { 'Execution Time': 1, Plans: [{ 'Node Type': 'Result', 'Actual Loops': 1 }], 'Subplan Name': 'InitPlan 1 (returns $0)' });
  assert.throws(() => workloadSQL('assets;DELETE', 1000)); assert.throws(() => workloadSQL('assets', 1001));
});
test('CLI missing approval never loads credentials or emits error details', () => {
  const child = spawnSync(process.execPath, ['scripts/qualify-authenticated-rls-read.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(child.status, 1); assert.equal(child.stdout.trim(), '{"passed":false}'); assert.equal(child.stderr, '');
});
