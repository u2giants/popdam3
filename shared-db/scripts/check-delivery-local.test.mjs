import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, parseArgs, runLocal, runCommand, STEP_MS, TOTAL_MS } from './check-delivery-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'a'.repeat(40);
const native = () => ({ schema_version: 1, repository_root: root, normalized_upstream: 'https://github.com/popcre/shared-db', repository_key: 'b'.repeat(64), head: 'c'.repeat(40), source_digest: 'd'.repeat(64), working_tree_sha256: 'e'.repeat(64) });
const ok = { status: 0, signal: null, stdout: '', stderr: '' };
function harness({ fail, mutate, elapsed = () => 0 } = {}) {
  const calls = [], identities = [];
  return {
    calls, identities,
    options: {
      root, base, clock: elapsed,
      identity: async () => { const value = native(); if (identities.length && mutate) mutate(value); identities.push(value); return value; },
      runner: async (step, options) => {
        calls.push({ ...step, ...options });
        if (fail?.name === step.name) return { ...ok, ...fail.result };
        return { ...ok, stdout: step.command === 'git' ? base + '\n' : '' };
      },
    },
  };
}
test('plan reuses baseline/sidecar FIRST and every requested full test family without shell globbing', () => {
  const plan = buildPlan({ root, base });
  assert.deepEqual(plan[0], { name: 'sidecars-and-baseline', command: 'node', args: ['scripts/check-production-verification-sidecars.mjs', '--base', base] });
  assert.deepEqual(plan[1].args, ['scripts/check-throughput-truth-audit.mjs']);
  const throughput = readdirSync(path.join(root, 'scripts/throughput-guard')).filter(n => n.endsWith('.test.mjs')).sort().map(n => `scripts/throughput-guard/${n}`);
  assert.deepEqual(plan[3].args, ['--test', ...throughput]);
  assert.deepEqual(plan[2].args, ['--test', 'scripts/manage-migration-author-lanes.test.mjs', 'scripts/check-merge-queue-workflows.test.mjs', 'scripts/merge-queue-hold.test.mjs', 'scripts/acquire-merge-lane-waiting.test.mjs']);
  assert.ok(throughput.length > 1);
  for (const file of ['rls-public-admin-initplan', 'rls-owner-uid-initplan', 'rls-style-guide-access-initplan', 'rls-packaging-access-initplan', 'check-live-proof-probe']) assert.ok(plan[4].args.includes(`scripts/${file}.test.mjs`));
  assert.deepEqual(plan[5].args, ['-m', 'unittest', 'scripts.test_shared_db_live_proof', 'scripts.test_production_catalog_verification', 'scripts.test_rls_admin_catalog_recovery', 'scripts.test_production_catalog_recovery_evidence']);
  assert.equal(plan.some(p => p.args.some(a => a.includes('*'))), false);
});
test('plan is deterministic and runs without installed identity or Python tools', () => {
  assert.deepEqual(buildPlan({ root, base }), buildPlan({ root, base }));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-delivery-local.mjs'), '--plan', '--base', base], { cwd: root, env: { PATH: '', LANG: 'C.UTF-8' }, encoding: 'utf8', timeout: 2000 });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.commands.length, 6); assert.equal(plan.global_timeout_ms, TOTAL_MS);
});
test('CLI refuses partial SHA, arbitrary refs and unknown flags', () => {
  assert.deepEqual(parseArgs([]), { base: 'origin/main', plan: false });
  assert.deepEqual(parseArgs(['--base', base, '--plan']), { base, plan: true });
  for (const args of [['--base', 'abc123'], ['--base', 'main'], ['--base'], ['--skip-python'], ['--plan', '--plan'], ['--base', 'origin/main', '--base', base]]) assert.throws(() => parseArgs(args));
});
test('matching native identities plus all existing commands passes, using local immutable base', async () => {
  const h = harness(); const report = await runLocal(h.options);
  assert.equal(report.passed, true); assert.equal(h.identities.length, 2);
  assert.deepEqual(report.identity_before, native()); assert.deepEqual(report.identity_after, native());
  assert.deepEqual(report.completed, buildPlan({ root, base }).map(p => p.name));
  assert.deepEqual(h.calls[0].args, ['rev-parse', '--verify', `${base}^{commit}`]);
  assert.equal(h.calls[1].args.at(-1), base);
  assert.ok(h.calls.every(c => c.timeoutMs > 0 && c.timeoutMs <= STEP_MS));
  assert.equal(h.calls.some(c => c.args.includes('fetch')), false);
});
test('sidecar detector failure prevents throughput tests, all Node/Python suites, and retries', async () => {
  const h = harness({ fail: { name: 'sidecars-and-baseline', result: { status: 17 } } });
  await assert.rejects(runLocal(h.options), error => error.exitCode === 17 && /sidecars-and-baseline: exit 17/.test(error.message));
  assert.deepEqual(h.calls.map(c => c.name), ['local-base', 'sidecars-and-baseline']);
  assert.equal(h.identities.length, 1);
});
test('throughput truth failure prevents every test suite', async () => {
  const h = harness({ fail: { name: 'throughput-truth', result: { status: 2 } } });
  await assert.rejects(runLocal(h.options), /throughput-truth: exit 2/);
  assert.equal(h.calls.some(c => c.name.endsWith('tests') || c.command === 'python3'), false);
});
test('coordination regression stops before throughput, RLS and Python suites', async () => {
  const h = harness({ fail: { name: 'merge-coordination-tests', result: { status: 73 } } });
  await assert.rejects(runLocal(h.options), error => error.exitCode === 73 && /merge-coordination-tests/.test(error.message));
  assert.deepEqual(h.calls.map(c => c.name), ['local-base', 'sidecars-and-baseline', 'throughput-truth', 'merge-coordination-tests']);
});
test('timeout, missing command, signal and unknown exit are explicit refusals', async () => {
  for (const [result, message, exitCode] of [
    [{ error: { code: 'ETIMEDOUT' }, status: null }, /ETIMEDOUT/, 124],
    [{ error: { code: 'ENOENT' }, status: null }, /missing command: node/, 127],
    [{ signal: 'SIGTERM', status: null }, /terminated by SIGTERM/, 143],
    [{ status: null }, /exit unknown/, 1],
  ]) {
    const h = harness({ fail: { name: 'sidecars-and-baseline', result } });
    await assert.rejects(runLocal(h.options), error => error.exitCode === exitCode && message.test(error.message));
    assert.equal(h.calls.length, 2);
  }
});
test('HEAD, source digest and dirty-tree mutation refuse even when every command passed', async () => {
  for (const key of ['head', 'source_digest', 'working_tree_sha256']) {
    const h = harness({ mutate: value => { value[key] = 'f'.repeat(key === 'head' ? 40 : 64); } });
    await assert.rejects(runLocal(h.options), new RegExp(`source changed during local checks: ${key}`));
    assert.equal(h.calls.length, 7); assert.equal(h.identities.length, 2);
  }
});
test('missing installed native identity tool refuses before any guard; no alternate hash is generated', async () => {
  const calls = [];
  await assert.rejects(runLocal({ root, base, runner: async step => { calls.push(step.name); return { ...ok, status: null, error: { code: 'ENOENT' } }; } }), error => error.exitCode === 127 && /ai-review-lifecycle/.test(error.message));
  assert.deepEqual(calls, ['native-source-identity']);
});
test('malformed native identity or identity JSON refuses before guards', async () => {
  const h = harness();
  await assert.rejects(runLocal({ ...h.options, identity: async () => ({ ...native(), source_digest: 'invented' }) }), /identity is missing or malformed/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(runLocal({ root, base, runner: async () => ({ ...ok, stdout: 'not JSON' }) }), /identity returned invalid JSON/);
});
test('unavailable local base refuses without fetch or guard execution', async () => {
  const h = harness({ fail: { name: 'local-base', result: { status: 128, stderr: 'unknown revision' } } });
  await assert.rejects(runLocal(h.options), /local-base: exit 128/);
  assert.equal(h.calls.length, 1);
});
test('global budget caps the next step and refuses when exhausted', async () => {
  let now = 0; const h = harness({ elapsed: () => now });
  const runner = h.options.runner;
  h.options.runner = async (step, options) => { const result = await runner(step, options); if (step.name === 'sidecars-and-baseline') now = TOTAL_MS - 10; if (step.name === 'throughput-truth') now = TOTAL_MS; return result; };
  await assert.rejects(runLocal(h.options), error => error.exitCode === 124 && /global budget/.test(error.message));
  assert.equal(h.calls.at(-1).timeoutMs, 10); assert.equal(h.calls.at(-1).name, 'throughput-truth');
});
test('runner exceptions are reported instead of passing or retrying', async () => {
  const h = harness(); h.options.runner = async () => { throw Object.assign(new Error('failure'), { code: 'EACCES' }); };
  await assert.rejects(runLocal(h.options), /local-base: runner threw EACCES/);
});
test('real child timeout and missing executable produce bounded failures', async () => {
  const timeout = await runCommand({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, { root, timeoutMs: 30 });
  assert.equal(timeout.error.code, 'ETIMEDOUT'); assert.equal(timeout.signal, 'SIGKILL');
  const missing = await runCommand({ command: 'nonexistent-5033-test-command', args: [] }, { root, timeoutMs: 1000 });
  assert.equal(missing.error.code, 'ENOENT');
});
