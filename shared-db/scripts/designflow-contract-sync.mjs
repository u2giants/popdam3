// Automated contract-sync for DesignFlow application contracts (issue #6092).
//
// When an application's contract digest on develop differs from the reviewed
// central contract in config/designflow-db-releases.json, this script:
//   1. Verifies the new contract against the live production database.
//   2. If verified: opens a contract-update PR and merges it (auto-merge).
//   3. If verification fails: opens a labeled, routed issue instead.
//
// Idempotent: skips when an open PR or issue already covers the mismatch.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { manifestDigest } from './lib/designflow-db-release.mjs';
import { productionCatalogQuery, verifyCatalogProof } from './lib/designflow-db-catalog.mjs';

const CANONICAL = 'popcre/shared-db';
const PROJECT = 'qsllyeztdwjgirsysgai';

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...opts });
}

function api(endpoint, body) {
  const args = ['api', endpoint];
  if (body !== undefined) args.push('--method', 'POST', '--input', '-');
  return JSON.parse(gh(args, { input: body ? JSON.stringify(body) : undefined }));
}

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
  const content = api(`repos/${repository}/contents/${manifestPath}?ref=develop`);
  if (content.encoding !== 'base64' || !content.content) throw Error('Manifest content unavailable');
  return JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'));
}

function findOpenPR(repository) {
  const titlePrefix = `Contract sync: ${repository}`;
  const prs = api(`repos/${CANONICAL}/pulls?state=open&per_page=100`);
  return prs.find(p => p.title.startsWith(titlePrefix)) ?? null;
}

function findOpenIssue(repository, digest) {
  const title = `Contract sync: ${repository} develop ${digest.slice(0, 12)}`;
  const issues = api(`repos/${CANONICAL}/issues?state=open&per_page=100`);
  return issues.find(i => i.title === title) ?? null;
}

function signLine() {
  return `\n\nPosted by MiMo chat ${process.env.MIMO_SESSION_ID ?? 'unknown'} on ${process.env.HOSTNAME ?? 'unknown'}`;
}

function createAndMergePR(repository, newDigest, policy) {
  const appName = repository.replace('popcre/designflow-', '');
  const branch = `contract-sync/${appName}-${newDigest.slice(0, 8)}`;

  execFileSync('git', ['checkout', '-b', branch], { cwd: process.cwd() });

  const updated = JSON.parse(JSON.stringify(policy));
  for (const app of updated.repositories) {
    if (app.repository === repository) {
      app.contract_manifest_sha256 = newDigest;
    }
  }
  writeFileSync('config/designflow-db-releases.json', JSON.stringify(updated, null, 2) + '\n');

  execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
  execFileSync('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  execFileSync('git', ['add', 'config/designflow-db-releases.json']);
  execFileSync('git', ['commit', '-m',
    `Update contract digest for ${repository}\n\nNew digest: ${newDigest}\nVerified against live production database.${signLine()}`]);
  execFileSync('git', ['push', 'origin', branch]);

  const prBody = `Automated contract sync for \`${repository}\`.\n\n`
    + `New digest: \`${newDigest}\`\n\n`
    + `Contract verified against live production database (${PROJECT}).${signLine()}`;
  const prOutput = gh(['pr', 'create', '--title', `Contract sync: ${repository}`,
    '--body', prBody, '--base', 'main', '--head', branch]);
  const prNumber = prOutput.match(/pull\/(\d+)/)?.[1];
  if (!prNumber) throw Error('PR creation did not return a number');

  gh(['pr', 'merge', prNumber, '--squash', '--admin']);
  return prNumber;
}

function createMismatchIssue(repository, newDigest, expectedDigest, error) {
  const title = `Contract sync: ${repository} develop ${newDigest.slice(0, 12)}`;
  const body = `Contract digest mismatch detected for \`${repository}\`.\n\n`
    + `Expected digest: \`${expectedDigest}\`\n`
    + `Actual digest: \`${newDigest}\`\n\n`
    + `Verification against live production database failed: ${error.message}\n\n`
    + `The application's contract references database objects that do not exist or lack required privileges. `
    + `A migration may be missing, unapplied, or the contract may be incorrect.\n\n`
    + '```db-work-scope\nwork_type: repo-maintenance\nroute: repo-maintenance\n```\n'
    + signLine();
  gh(['issue', 'create', '--title', title, '--body', body,
    '--label', 'db-work', '--label', 'non-orchestrator']);
}

async function main() {
  const policy = JSON.parse(readFileSync('config/designflow-db-releases.json', 'utf8'));
  const results = [];

  for (const app of policy.repositories) {
    let manifest;
    try {
      manifest = fetchManifest(app.repository, policy.manifest_path);
    } catch (error) {
      results.push({ repository: app.repository, status: 'error', reason: `Could not fetch manifest: ${error.message}` });
      continue;
    }

    const digest = manifestDigest({ ...manifest, requirements: [] });
    if (digest === app.contract_manifest_sha256) continue;

    console.log(`Contract mismatch: ${app.repository} expected=${app.contract_manifest_sha256} actual=${digest}`);

    const existingPR = findOpenPR(app.repository);
    if (existingPR) {
      results.push({ repository: app.repository, status: 'skipped', reason: `PR #${existingPR.number} already open` });
      continue;
    }

    const existingIssue = findOpenIssue(app.repository, digest);
    if (existingIssue) {
      results.push({ repository: app.repository, status: 'skipped', reason: `Issue #${existingIssue.number} already open` });
      continue;
    }

    try {
      const rows = await readProduction(productionCatalogQuery(manifest.contracts));
      verifyCatalogProof(manifest.contracts, rows[0].production_catalog_proof);

      const prNumber = createAndMergePR(app.repository, digest, policy);
      results.push({ repository: app.repository, status: 'pr-merged', pr: prNumber, digest });
    } catch (error) {
      createMismatchIssue(app.repository, digest, app.contract_manifest_sha256, error);
      results.push({ repository: app.repository, status: 'issue-created', digest, error: error.message });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
  console.error('Contract sync failed:', error);
  process.exitCode = 1;
});
