#!/usr/bin/env node
// Fast offline reuse of CI guards. No reviewer, database or publication action.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:os';
import { performance } from 'node:perf_hooks';

export const STEP_MS = 60_000;
export const TOTAL_MS = 180_000;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const FAMILY = ['rls-public-admin-initplan', 'rls-owner-uid-initplan', 'rls-style-guide-access-initplan', 'rls-packaging-access-initplan', 'check-live-proof-probe'];
const PYTHON = ['shared_db_live_proof', 'production_catalog_verification', 'rls_admin_catalog_recovery', 'production_catalog_recovery_evidence'];

export class LocalCheckError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}
export function parseArgs(argv) {
  let base = 'origin/main', plan = false, seenBase = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' && !plan) plan = true;
    else if (argv[i] === '--base' && argv[i + 1] && !seenBase) { base = argv[++i]; seenBase = true; }
    else throw new LocalCheckError('usage: check-delivery-local.mjs [--plan] [--base <40-character SHA|origin/main>]');
  }
  if (base !== 'origin/main' && !SHA.test(base)) throw new LocalCheckError('--base must be a full commit SHA or origin/main (local only; never fetch)');
  return { base, plan };
}
export function buildPlan({ root = process.cwd(), base = 'origin/main' } = {}) {
  if (base !== 'origin/main' && !SHA.test(base)) throw new LocalCheckError('invalid local comparison base');
  const throughput = readdirSync(path.join(root, 'scripts/throughput-guard')).filter(n => n.endsWith('.test.mjs')).sort().map(n => `scripts/throughput-guard/${n}`);
  if (!throughput.length) throw new LocalCheckError('full throughput test family is missing');
  return [
    { name: 'sidecars-and-baseline', command: 'node', args: ['scripts/check-production-verification-sidecars.mjs', '--base', base] },
    { name: 'throughput-truth', command: 'node', args: ['scripts/check-throughput-truth-audit.mjs'] },
    { name: 'merge-coordination-tests', command: 'node', args: ['--test', 'scripts/manage-migration-author-lanes.test.mjs', 'scripts/check-merge-queue-workflows.test.mjs', 'scripts/merge-queue-hold.test.mjs', 'scripts/acquire-merge-lane-waiting.test.mjs'] },
    { name: 'full-throughput-tests', command: 'node', args: ['--test', ...throughput] },
    { name: 'rls-family-and-live-proof-parser', command: 'node', args: ['--test', ...FAMILY.map(n => `scripts/${n}.test.mjs`)] },
    { name: 'focused-python-catalog-and-live-proof', command: 'python3', args: ['-m', 'unittest', ...PYTHON.map(n => `scripts.test_${n}`)] },
  ];
}
// Each child gets its own process group on POSIX, so timeout also stops nested tests.
export function runCommand(step, { root, timeoutMs }) {
  return new Promise(resolve => {
    let child, timer, done = false, stdout = '', stderr = '', error;
    const finish = (status, signal) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ status, signal, error, stdout, stderr });
    };
    const kill = () => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } };
    try { child = spawn(step.command, step.args, { cwd: root, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (caught) { error = caught; finish(null, null); return; }
    const collect = key => chunk => {
      if (key === 'stdout') stdout += chunk; else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 4 * 1024 * 1024) { error = { code: 'ENOBUFS' }; kill(); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.once('error', caught => { error = caught; finish(null, null); });
    child.once('close', finish);
    timer = setTimeout(() => { error = { code: 'ETIMEDOUT' }; kill(); }, timeoutMs);
  });
}
export function requireSuccess(step, result) {
  if (result.error) {
    const code = result.error.code || 'runner-error';
    throw new LocalCheckError(`${step.name}: ${code}${code === 'ENOENT' ? ` (missing command: ${step.command})` : ''}`, code === 'ETIMEDOUT' ? 124 : code === 'ENOENT' ? 127 : 1);
  }
  if (result.signal) throw new LocalCheckError(`${step.name}: terminated by ${result.signal}`, 128 + (constants.signals[result.signal] || 0));
  if (result.status !== 0) throw new LocalCheckError(`${step.name}: exit ${result.status ?? 'unknown'}`, Number.isInteger(result.status) && result.status > 0 && result.status < 256 ? result.status : 1);
}
export async function nativeIdentity({ root, execute }) {
  const step = { name: 'native-source-identity', command: 'ai-review-lifecycle', args: ['identity', root] };
  const result = await execute(step);
  try { return JSON.parse(result.stdout); }
  catch { throw new LocalCheckError('native source identity returned invalid JSON; installed identity tool is required'); }
}
export function validateIdentity(value, root) {
  if (value?.schema_version !== 1 || value.repository_root !== root || !SHA.test(value.head || '') || !DIGEST.test(value.source_digest || '') || !DIGEST.test(value.working_tree_sha256 || '') || !DIGEST.test(value.repository_key || '') || typeof value.normalized_upstream !== 'string' || !value.normalized_upstream) throw new LocalCheckError('native source identity is missing or malformed; no substitute identity is accepted');
  return value;
}
export async function runLocal({ root = process.cwd(), base = 'origin/main', runner = runCommand, identity = nativeIdentity, clock = () => performance.now(), onResult = () => {} } = {}) {
  root = path.resolve(root);
  const started = clock(), completed = [];
  const remaining = () => {
    const elapsed = clock() - started;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TOTAL_MS) throw new LocalCheckError('local delivery check exceeded its 180-second global budget', 124);
    return TOTAL_MS - elapsed;
  };
  const execute = async step => {
    const timeoutMs = Math.min(STEP_MS, remaining());
    let result;
    try { result = await runner(step, { root, timeoutMs }); }
    catch (error) { throw new LocalCheckError(`${step.name}: runner threw ${error.code || error.name || 'error'}`); }
    onResult(step, result); requireSuccess(step, result); remaining(); return result;
  };
  const before = validateIdentity(await identity({ root, execute }), root);
  // Resolve locally, then give the existing sidecar resolver an immutable SHA;
  // it cannot fall back to fetching an absent origin/main during this offline run.
  if (base !== 'origin/main' && !SHA.test(base)) throw new LocalCheckError('invalid local comparison base');
  const resolved = (await execute({ name: 'local-base', command: 'git', args: ['rev-parse', '--verify', `${base}^{commit}`] })).stdout.trim();
  if (!SHA.test(resolved)) throw new LocalCheckError('comparison base is not locally available; no fetch attempted');
  for (const step of buildPlan({ root, base: resolved })) { await execute(step); completed.push(step.name); }
  const after = validateIdentity(await identity({ root, execute }), root);
  remaining();
  for (const key of ['head', 'source_digest', 'working_tree_sha256', 'repository_key', 'normalized_upstream', 'repository_root']) if (before[key] !== after[key]) throw new LocalCheckError(`source changed during local checks: ${key}; rerun on stable source`);
  return { passed: true, base: resolved, identity_before: before, identity_after: after, completed };
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.plan) { console.log(JSON.stringify({ base: options.base, commands: buildPlan({ base: options.base }), step_timeout_ms: STEP_MS, global_timeout_ms: TOTAL_MS, identity_prerequisite: 'ai-review-lifecycle identity <repository> before and after' }, null, 2)); return 0; }
    const report = await runLocal({ base: options.base, onResult(step, result) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.stderr.write(`[local delivery] ${step.name}: ${result.error?.code || result.signal || result.status}\n`);
    } });
    console.log(JSON.stringify(report)); return 0;
  } catch (error) { console.error(`REFUSED: ${error.message}`); return error.exitCode || 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
