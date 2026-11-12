// Automated contract-sync for DesignFlow application contracts (issue #6092).
//
// When an application's contract digest on develop differs from the reviewed
// central contract in config/designflow-db-releases.json, this script:
//   1. Accepts the manifest only if the central policy allow-lists still hold
//      (the same releasePolicy check the readiness observer enforces).
//   2. Verifies the new contract against the live production database with the
//      same productionCatalogQuery/verifyCatalogProof machinery the observer
//      uses.
//   3. If both pass: opens a contract-update PR cut from fresh origin/main and
//      merges it only when it is green (GitHub auto-merge, bounded fallback).
//   4. If either refuses: opens a labeled, routed issue instead. Nothing that
//      failed verification is ever merged.
//
// Idempotent: re-verifies matching open contract-update PRs; skips open issues.
// Fail-safe: a failure for one application never stops the others; the loop
// never merges on an unproven contract.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifestDigest } from './lib/designflow-db-release.mjs';
import { productionCatalogQuery, verifyCatalogProof } from './lib/designflow-db-catalog.mjs';
import { runGitHubCommand } from './lib/github-transport.mjs';
import { createTreeReader } from './lib/github-tree.mjs';
import { releasePolicy } from './designflow-db-release.mjs';

const CANONICAL = 'popcre/shared-db';
const PROJECT = 'qsllyeztdwjgirsysgai';
const POLICY_PATH = 'config/designflow-db-releases.json';

// All GitHub access goes through the one shared transport (issue #2342).
function command(args, { input, timeout = 60_000 } = {}) {
  try {
    return runGitHubCommand(args, { input, timeoutMs: timeout, maxBuffer: 20 * 1024 * 1024 });
  } catch {
    throw Error(`GitHub operation refused or unavailable: ${args[0]}`);
  }
}

function api(endpoint, body) {
  const args = ['api', endpoint];
  if (body !== undefined) args.push('--method', 'POST', '--input', '-');
  const output = command(args, { input: body === undefined ? undefined : JSON.stringify(body) });
  return output.trim() ? JSON.parse(output) : null;
}

// File content comes from one tree read per ref, then blobs by SHA (issue #2342).
const manifestTree = createTreeReader({
  json: args => JSON.parse(command(args)),
  raw: args => command(args),
  wrapError: () => Error('Application manifest tree is unavailable or incomplete'),
});

async function readProduction(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!response.ok) throw Error(`Production catalog service refused (${response.status})`);
  const body = await response.json();
  if (!Array.isArray(body)) throw Error('Production catalog envelope changed');
  return body;
}

function fetchManifest(repository, manifestPath) {
  const text = manifestTree.readFileAtRef(repository, manifestPath, 'develop');
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024)
    throw Error('Manifest content is absent or exceeds the bounded file size');
  return JSON.parse(text);
}

// One application's digest update on top of the exact policy bytes that will be
// on the new branch. Never writes from stale in-memory state (issue #6110
// finding 1): each call deep-copies its input and touches exactly one digest.
export function buildPolicyUpdate(policy, repository, newDigest) {
  const updated = JSON.parse(JSON.stringify(policy));
  const app = updated.repositories.find(row => row.repository === repository);
  if (!app) throw Error(`Repository ${repository} is not in the central policy`);
  app.contract_manifest_sha256 = newDigest;
  return updated;
}

// Validate the exact fresh policy that will be committed, not the job snapshot.
export function verifiedPolicyUpdate(policy, repository, newDigest, manifest) {
  const updated = buildPolicyUpdate(policy, repository, newDigest);
  releasePolicy(manifest, updated);
  return updated;
}

function readPRPolicy(pr) {
  return JSON.parse(manifestTree.readFileAtRef(CANONICAL, POLICY_PATH, pr.head.sha));
}

// A refusal we can prove (catalog proof failures, policy allow-list refusal)
// is a mismatch. Anything else means verification could not run, which must
// never be reported as a contract mismatch (issue #6110 finding 4).
export function classifyVerificationError(error) {
  if (error && Array.isArray(error.failures)) return 'refused';
  if (error && error.refused === true) return 'refused';
  return 'could-not-verify';
}

function findOpenPR(repository) {
  const titlePrefix = `Contract sync: ${repository}`;
  const prs = api(`repos/${CANONICAL}/pulls?state=open&per_page=100`);
  return prs.find(p => p.title.startsWith(titlePrefix)) ?? null;
}

function findOpenIssue(title) {
  const issues = api(`repos/${CANONICAL}/issues?state=open&per_page=100`);
  return issues.find(i => !i.pull_request && i.title === title) ?? null;
}

function signLine() {
  return `\n\nPosted by MiMo chat ${process.env.MIMO_SESSION_ID ?? 'unknown'} on ${process.env.HOSTNAME ?? 'unknown'}`;
}

function routingBlock(workType, route) {
  return '\n\n```db-work-scope\n'
    + 'work_type: ' + workType + '\nroute: ' + route + '\n```\n';
}

function openIssue(title, body) {
  if (findOpenIssue(title)) return null;
  const output = command(['issue', 'create', '--repo', CANONICAL, '--title', title, '--body', body,
    '--label', 'db-work', '--label', 'non-orchestrator']);
  return output.trim().split('/').pop();
}

export function mismatchBody(repository, expectedDigest, actualDigest, reason) {
  return `Contract digest mismatch detected for \`${repository}\`.\n\n`
    + `Expected digest: \`${expectedDigest}\`\n`
    + `Actual digest: \`${actualDigest ?? 'unavailable'}\`\n\n`
    + `Automatic sync refused this contract: ${reason}\n\n`
    + `Nothing was merged into the central policy. The application's contract cannot be `
    + `accepted until the refusal is cleared — either a required production migration is `
    + `awaiting apply, or the application manifest is incorrect.`
    + routingBlock('repo-maintenance', 'repo-maintenance')
    + signLine();
}

export function unreachableBody(repository, digest, reason) {
  return `Contract sync could not verify \`${repository}\`.\n\n`
    + `Observed digest: \`${digest ?? 'unavailable'}\`\n\n`
    + `Reason: ${reason}\n\n`
    + `This is a verification failure, not a proven contract mismatch. Nothing was merged. `
    + `The next runs retry automatically; this issue records that verification has been `
    + `unreachable so the block is routed instead of silent.`
    + routingBlock('repo-maintenance', 'repo-maintenance')
    + signLine();
}

export function invalidManifestBody(repository, expectedDigest, reason) {
  return `Contract sync refused the application manifest of \`${repository}\`.\n\n`
    + `Expected digest: \`${expectedDigest}\`\n\n`
    + `The manifest on \`develop\` failed validation: ${reason}\n\n`
    + `Nothing was merged into the central policy. The manifest must be corrected before `
    + `the contract can be accepted.`
    + routingBlock('repo-maintenance', 'repo-maintenance')
    + signLine();
}

// Each contract-update PR is cut from a fresh origin/main in its own throwaway
// worktree, and its config edit is computed from the bytes checked out there.
// Two mismatches in one run therefore cannot corrupt each other (issue #6110
// finding 1): each PR touches exactly one digest line of the current policy.
function createContractPR(repository, newDigest, manifest) {
  const appName = repository.replace('popcre/designflow-', '');
  const branch = `contract-sync/${appName}-${newDigest.slice(0, 8)}`;
  execFileSync('git', ['fetch', 'origin', 'main'], { stdio: 'pipe' });
  const worktree = mkdtempSync(join(tmpdir(), 'contract-sync-'));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktree, 'origin/main'], { stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', branch], { cwd: worktree, stdio: 'pipe' });
    const policy = JSON.parse(readFileSync(join(worktree, POLICY_PATH), 'utf8'));
    const updated = verifiedPolicyUpdate(policy, repository, newDigest, manifest);
    writeFileSync(join(worktree, POLICY_PATH), JSON.stringify(updated, null, 2) + '\n');
    execFileSync('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: worktree });
    execFileSync('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], { cwd: worktree });
    execFileSync('git', ['add', POLICY_PATH], { cwd: worktree });
    execFileSync('git', ['commit', '-m',
      `Contract sync: ${repository}\n\nNew digest: ${newDigest}\n`
      + `Contract verified against the live production database and accepted by the central release policy.${signLine()}`],
    { cwd: worktree });
    execFileSync('git', ['push', 'origin', branch], { cwd: worktree, stdio: 'pipe' });
    const prBody = `Automated contract sync for \`${repository}\`.\n\n`
      + `New digest: \`${newDigest}\`\n\n`
      + `The contract was verified against the live production database (${PROJECT}) and `
      + `accepted by the central release policy before this pull request was opened.`
      + signLine();
    const prOutput = command(['pr', 'create', '--repo', CANONICAL, '--title', `Contract sync: ${repository}`,
      '--body', prBody, '--base', 'main', '--head', branch]);
    const prNumber = prOutput.match(/pull\/(\d+)/)?.[1];
    if (!prNumber) throw Error('PR creation did not return a number');
    return Number(prNumber);
  } finally {
    try { rmSync(worktree, { recursive: true, force: true }); } catch { /* runner temp */ }
    try { execFileSync('git', ['worktree', 'prune'], { stdio: 'pipe' }); } catch { /* best effort */ }
  }
}

// Merge only when green. This repository merges through its merge queue: a
// plain `gh pr merge` enqueues the pull request and the queue lands it once its
// merge-group checks are green. Strategy flags (--squash) and --admin are
// refused while the queue is enabled, and a refused enqueue throws — the PR
// then stays open and is resumed on a later run, never merged unproven.
export function mergeWhenGreen(prNumber, headSha, run = command) {
  const headArgs = headSha ? ['--match-head-commit', headSha] : [];
  try {
    run(['pr', 'merge', String(prNumber), '--repo', CANONICAL, '--auto', ...headArgs]);
    return 'auto-merge queued; merges when required checks are green';
  } catch {
    run(['pr', 'checks', String(prNumber), '--repo', CANONICAL, '--watch', '--fail-fast', '--interval', '15'],
      { timeout: 10 * 60_000 });
    run(['pr', 'merge', String(prNumber), '--repo', CANONICAL, ...headArgs]);
    return 'merged after reported checks were green';
  }
}

// If a previous run left an open contract-update PR, finish it when green
// instead of stalling forever behind the idempotency skip.
function resumeOpenPR(prNumber, fx = {}, headSha) {
  const merge = fx.mergeWhenGreen ?? mergeWhenGreen;
  try {
    return { status: 'pr-resumed', pr: prNumber, merge: merge(prNumber, headSha) };
  } catch (error) {
    return { status: 'pr-open', pr: prNumber, reason: `not merged yet: ${error.message}` };
  }
}

export async function syncApp(app, policy, io = {}) {
  const fx = {
    fetchManifest: io.fetchManifest ?? fetchManifest,
    readProduction: io.readProduction ?? readProduction,
    findOpenPR: io.findOpenPR ?? findOpenPR,
    readPRPolicy: io.readPRPolicy ?? readPRPolicy,
    findOpenIssue: io.findOpenIssue ?? findOpenIssue,
    openIssue: io.openIssue ?? openIssue,
    createContractPR: io.createContractPR ?? createContractPR,
    mergeWhenGreen: io.mergeWhenGreen ?? mergeWhenGreen,
    resumeOpenPR: io.resumeOpenPR ?? ((pr, head) => resumeOpenPR(pr, fx, head)),
  };

  let manifest;
  try {
    manifest = fx.fetchManifest(app.repository, policy.manifest_path);
  } catch (error) {
    const number = fx.openIssue(
      `Contract sync could not verify: ${app.repository} develop unknown`,
      unreachableBody(app.repository, null, `manifest fetch failed: ${error.message}`));
    return { repository: app.repository, status: 'could-not-verify', reason: error.message, issue: number ?? undefined };
  }

  let digest;
  try {
    digest = manifestDigest({ ...manifest, requirements: [] });
  } catch (error) {
    const number = fx.openIssue(
      `Contract sync: ${app.repository} develop invalid-manifest`,
      invalidManifestBody(app.repository, app.contract_manifest_sha256, error.message));
    return { repository: app.repository, status: 'issue-created', reason: error.message, issue: number ?? undefined };
  }

  if (digest === app.contract_manifest_sha256) return { repository: app.repository, status: 'in-sync', digest };

  console.log(`Contract mismatch: ${app.repository} expected=${app.contract_manifest_sha256} actual=${digest}`);

  const existingPR = fx.findOpenPR(app.repository);
  if (existingPR) {
    const prPolicy = fx.readPRPolicy(existingPR);
    const prApp = prPolicy.repositories.find(row => row.repository === app.repository);
    if (prApp?.contract_manifest_sha256 !== digest) {
      return { repository: app.repository, status: 'pr-open', pr: existingPR.number,
        reason: 'Open PR digest differs from the current develop contract' };
    }
    releasePolicy(manifest, prPolicy);
  }

  const existingIssue = fx.findOpenIssue(`Contract sync: ${app.repository} develop ${digest.slice(0, 12)}`)
    ?? fx.findOpenIssue(`Contract sync could not verify: ${app.repository} develop ${digest.slice(0, 12)}`);
  if (existingIssue && !existingPR) {
    return { repository: app.repository, status: 'skipped', reason: `Issue #${existingIssue.number} already open` };
  }

  // Central policy allow-lists (schemas, roles, required baseline sources) are
  // enforced here exactly as the readiness observer enforces them, so a digest
  // that would half-update the reviewed policy is refused before any PR
  // (issue #6110 finding 2).
  try {
    releasePolicy(manifest, buildPolicyUpdate(policy, app.repository, digest));
  } catch (error) {
    error.refused = true;
    const number = fx.openIssue(
      `Contract sync: ${app.repository} develop ${digest.slice(0, 12)}`,
      mismatchBody(app.repository, app.contract_manifest_sha256, digest, error.message));
    return { repository: app.repository, status: 'issue-created', reason: error.message, issue: number ?? undefined };
  }

  let rows;
  try {
    rows = await fx.readProduction(productionCatalogQuery(manifest.contracts));
  } catch (error) {
    const number = fx.openIssue(
      `Contract sync could not verify: ${app.repository} develop ${digest.slice(0, 12)}`,
      unreachableBody(app.repository, digest, `production catalog query failed: ${error.message}`));
    return { repository: app.repository, status: 'could-not-verify', reason: error.message, issue: number ?? undefined };
  }

  try {
    verifyCatalogProof(manifest.contracts, rows[0]?.production_catalog_proof);
  } catch (error) {
    const kind = classifyVerificationError(error);
    const reason = Array.isArray(error?.failures)
      ? `production catalog requirements failed: ${JSON.stringify(error.failures)}`
      : error.message;
    const number = fx.openIssue(
      kind === 'refused'
        ? `Contract sync: ${app.repository} develop ${digest.slice(0, 12)}`
        : `Contract sync could not verify: ${app.repository} develop ${digest.slice(0, 12)}`,
      kind === 'refused'
        ? mismatchBody(app.repository, app.contract_manifest_sha256, digest, reason)
        : unreachableBody(app.repository, digest, `catalog proof could not be verified: ${reason}`));
    return { repository: app.repository, status: kind === 'refused' ? 'issue-created' : 'could-not-verify',
      reason, issue: number ?? undefined };
  }

  if (existingPR) return fx.resumeOpenPR(existingPR.number, existingPR.head.sha);

  const prNumber = fx.createContractPR(app.repository, digest, manifest);
  const merge = fx.mergeWhenGreen(prNumber);
  return { repository: app.repository, status: 'pr-merged', pr: prNumber, digest, merge };
}

export async function runSync(policy, io = {}) {
  const results = [];
  for (const app of policy.repositories) {
    try {
      results.push(await syncApp(app, policy, io));
    } catch (error) {
      // One application's failure never stops the others (issue #6110 finding 3).
      results.push({ repository: app.repository, status: 'error', reason: error.message });
    }
  }
  return results;
}

async function main() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
  const results = await runSync(policy);
  console.log(JSON.stringify(results, null, 2));
  if (results.some(r => r.status === 'error')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Contract sync failed:', error);
    process.exitCode = 1;
  });
}
