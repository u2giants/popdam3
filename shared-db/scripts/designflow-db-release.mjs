import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateManifest, manifestDigest, verifyRequirementSource } from './lib/designflow-db-release.mjs';
import { githubIo, parseQueueScope, trainIo } from './manage-migration-author-lanes.mjs';
import { readyRecord, preparePreviewDispatch } from './db-flow/reconcile.mjs';
import { canonicalJson, sha256 } from './db-flow/evidence-bundle.mjs';
import { admitIssue } from './lib/lanes/admission.mjs';
import { formatEventComment } from './db-coordination-events.mjs';
import { productionCatalogQuery, verifyCatalogProof } from './lib/designflow-db-catalog.mjs';
import { readZipEntries } from './lib/zip-entries.mjs';
import { selectArtifactFiles } from './lib/lanes/review-leases.mjs';
import { fileMatchesLedgerStatements } from './check-applied-migration-edit.mjs';
import { runGitHubCommand } from './lib/github-transport.mjs';
import { createTreeReader } from './lib/github-tree.mjs';

import { proposeTrain, trainRecordRef, assertDispatchMatchesTrain } from './db-flow/migration-train.mjs';

const CANONICAL = 'popcre/shared-db';
const WORKFLOW = 'shared-supabase-migrations.yml';
const SHA = /^[a-f0-9]{40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const policyPath = new URL('../config/designflow-db-releases.json', import.meta.url);

export function releasePolicy(manifest, policy) {
  const m = validateManifest(manifest);
  const app = policy.repositories.find(row => row.repository === m.repository);
  if (!app || policy.schema_version !== 1 || policy.branch !== 'develop' ||
      policy.production_project_ref !== m.production_project_ref) throw Error('Unrecognized release policy/target');
  if (app.contract_manifest_sha256 !== manifestDigest({ ...m, requirements: [] }))
    throw Error('Application contracts do not match the reviewed central contract');
  const declared = new Set(m.requirements.map(r => `${r.work_issue}:${r.source_pr}`));
  for (const required of app.required_sources)
    if (!declared.has(`${required.work_issue}:${required.source_pr}`)) throw Error('Required baseline migration was omitted');
  for (const c of m.contracts) if (!app.schemas.includes(c.schema)) throw Error('Schema is outside this application policy');
  for (const c of m.contracts) for (const p of c.privileges)
    if (!app.roles.includes(p.role)) throw Error('Runtime role is outside this application policy');
  return m;
}

// All effects use authenticated adapters. Application contents are data, never code.
export async function assessRelease({ repository, head, manifest, policy, branch = 'develop' }, io) {
  if (!SHA.test(head) || !['develop', 'main'].includes(branch)) throw Error('Exact application commit and release branch are required');
  const m = releasePolicy(manifest, policy);
  if (m.repository !== repository) throw Error('Application manifest repository mismatch');
  if (branch === 'main' && await io.sourceAllowed?.(repository, head) !== true)
    throw Error('Main release is not an exact reviewed develop-to-main source tree');
  const identity = { repository, branch, head_sha: head, manifest_sha256: manifestDigest(m),
    production_project_ref: m.production_project_ref };
  const current = () => io.applicationHead(repository, branch);
  if (await current() !== head) throw Error('Application develop head changed before assessment');
  const proven = [];
  for (const requirement of m.requirements) {
    const facts = await io.sourceFacts(requirement);
    verifyRequirementSource(requirement, facts);
    const evidence = await io.productionEvidence(requirement, facts);
    if (!evidence) {
      if (branch === 'main') return { ...identity, status: 'waiting', requirement: requirement.work_issue,
        progress: { state: 'develop-database-promotion-required' } };
      if (await current() !== head) throw Error('Application develop head changed before promotion');
      const companions = m.requirements.filter(r => r.work_issue === requirement.work_issue);
      if (companions.length > 1) {
        for (const companion of companions) verifyRequirementSource(companion, await io.sourceFacts(companion));
        return { ...identity, status: 'waiting', requirement: requirement.work_issue,
          progress: { state: 'qualified-migration-train-required', source_prs: companions.map(r => r.source_pr) } };
      }
      const progress = await io.promote(requirement, facts);
      return { ...identity, status: 'waiting', requirement: requirement.work_issue, progress };
    }
    proven.push(evidence);
  }
  const catalog = await io.catalog(m.contracts, m.production_project_ref);
  if (await current() !== head) throw Error('Application develop head changed before readiness publication');
  return { ...identity, status: 'ready', requirements: proven, catalog_sha256: hash(JSON.stringify(catalog)) };
}

function command(args, { input, timeout = 60_000, token } = {}) {
  const executor = token ? ((file, argv, options) => execFileSync(file, argv, { ...options, env: { ...process.env, GH_TOKEN: token } })) : undefined;
  try { return runGitHubCommand(args, { executor, input, timeoutMs: timeout, maxBuffer: 20 * 1024 * 1024 }); }
  catch { throw Error(`GitHub operation refused or unavailable: ${args[0]}`); }
}
function api(endpoint, body, { token } = {}) {
  const args = ['api', endpoint];
  if (body !== undefined) args.push('--method', 'POST', '--input', '-');
  const output = command(args, { token, input: body === undefined ? undefined : JSON.stringify(body) });
  return output.trim() ? JSON.parse(output) : null;
}
function pages(endpoint, limit = 5) {
  const rows = [];
  for (let page = 1; page <= limit; page++) {
    const batch = api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw Error('GitHub page is not an array');
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw Error('GitHub pagination limit reached; completeness is not proven');
}
export function workflowRuns(read, endpoint, limit = 5) {
  const runs = [];
  for (let page = 1; page <= limit; page++) {
    const response = read(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!response || !Array.isArray(response.workflow_runs)) throw Error('Workflow run page is unreadable');
    runs.push(...response.workflow_runs);
    if (response.workflow_runs.length < 100) return runs;
  }
  throw Error('Workflow run pagination bound reached; discovery is incomplete');
}

export function artifactContainsSource(requirement, files) {
  const manifest = JSON.parse(files.get('migration-content-manifest.json'));
  const catalog = JSON.parse(files.get('production-catalog-verification.json'));
  const expected = requirement.migrations.map(m => m.version).sort().join(',');
  return Array.isArray(catalog?.allowlist) && catalog.allowlist.slice().sort().join(',') === expected &&
    !!manifest && !Array.isArray(manifest) && requirement.migrations.every(m => manifest[m.version] === m.sha256);
}

const sourceTree = createTreeReader({ json: args => JSON.parse(command(args)), raw: args => command(args),
  wrapError: () => Error('Canonical source tree is unavailable or incomplete') });
function content(repository, path, ref) {
  const text = sourceTree.readFileAtRef(repository, path, ref);
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024)
    throw Error('Source content is absent or exceeds the bounded file size');
  return text;
}

export function dispatchTitle(manifest, mode) {
  if (!['dry-run', 'apply'].includes(mode) || manifest.target !== 'preview' || !SHA.test(manifest.commit_sha) ||
      !/^[1-9][0-9]*$/.test(String(manifest.merged_preview_source_pr)) ||
      !/^\d{14}(?:,\d{14})*$/.test(manifest.preview_allowlist))
    throw Error('Only canonical preview dispatch is permitted');
  return `DB preview ${mode} ${manifest.commit_sha} PR${manifest.merged_preview_source_pr} ${manifest.preview_allowlist}`;
}

function sourceFacts(requirement) {
  const pr = api(`repos/${CANONICAL}/pulls/${requirement.source_pr}`);
  const linked = githubIo.closingIssuesForPr(requirement.source_pr);
  if (linked.length !== 1 || Number(linked[0].number) !== requirement.work_issue)
    throw Error('Canonical source must link exclusively to its required work issue');
  const main = api(`repos/${CANONICAL}/commits/main`).sha;
  const comparison = api(`repos/${CANONICAL}/compare/${pr.merge_commit_sha}...${main}`);
  const files = pages(`repos/${CANONICAL}/pulls/${requirement.source_pr}/files`)
    .filter(row => row.filename.startsWith('supabase/migrations/')).map(row => {
      if (row.status !== 'added') throw Error('Release migration must be newly authored, never rewritten');
      const source = content(CANONICAL, row.filename, pr.head.sha);
      if (content(CANONICAL, row.filename, main) !== source) throw Error('Migration changed after source approval');
      return { path: row.filename, content: source };
    });
  return { repository: pr.base.repo.full_name, base_branch: pr.base.ref, merged: pr.merged === true,
    source_pr: pr.number, work_issue: Number(linked[0].number), head_sha40: pr.head.sha,
    merge_sha40: pr.merge_commit_sha, merge_in_main: ['ahead', 'identical'].includes(comparison.status) && comparison.behind_by === 0, files };
}

export function verifyApplyReceipt(requirement, facts, receipt, ledger, batchProof = null) {
  const keys = ['schema_version', 'work_issue', 'source_pr', 'source_head_sha', 'source_merge_sha',
    'production_main_sha', 'production_run_id', 'production_run_attempt', 'artifact_id', 'artifact_digest',
    'migration_hashes', 'ledger_fingerprints', 'catalog_sha256', 'captured_at'];
  if (receipt?.schema_version === 2) keys.push('batch');
  if (!receipt || Object.keys(receipt).length !== keys.length || keys.some(k => !Object.hasOwn(receipt, k)) || ![1, 2].includes(receipt.schema_version) ||
      receipt.work_issue !== requirement.work_issue || receipt.source_pr !== requirement.source_pr ||
      receipt.source_head_sha !== facts.head_sha40 || receipt.source_merge_sha !== facts.merge_sha40 ||
      !SHA.test(receipt.production_main_sha) || !/^sha256:[a-f0-9]{64}$/.test(receipt.artifact_digest) ||
      !/^[a-f0-9]{64}$/.test(receipt.catalog_sha256) ||
      !['production_run_id', 'production_run_attempt', 'artifact_id'].every(k => Number.isSafeInteger(receipt[k]) && receipt[k] > 0) ||
      !Number.isFinite(Date.parse(receipt.captured_at)) || Date.parse(receipt.captured_at) > Date.now()) throw Error('Malformed immutable production receipt');
  if (receipt.schema_version === 2 && (!batchProof || canonicalJson(receipt.batch) !== canonicalJson(batchProof)))
    throw Error('Batch receipt lacks independently authenticated current source/train/ledger proof');
  if (receipt.schema_version === 2 && (receipt.production_main_sha !== batchProof.production_main_sha ||
      receipt.production_run_id !== batchProof.production_run_id || receipt.production_run_attempt !== batchProof.production_run_attempt))
    throw Error('Batch receipt producer binding differs');
  if (receipt.schema_version === 2 && receipt.catalog_sha256 !== batchProof.catalog_sha256)
    throw Error('Batch receipt catalog binding differs');
  const expected = requirement.migrations.map(m => m.version).sort().join(',');
  for (const data of [receipt.migration_hashes, receipt.ledger_fingerprints, ledger])
    if (!data || Array.isArray(data) || Object.keys(data).sort().join(',') !== expected) throw Error('Receipt/ledger migration set differs');
  for (const m of requirement.migrations)
    if (receipt.migration_hashes[m.version] !== m.sha256 || !/^[a-f0-9]{64}$/.test(receipt.ledger_fingerprints[m.version]) ||
        receipt.ledger_fingerprints[m.version] !== ledger[m.version]) throw Error('Applied migration or live ledger fingerprint changed');
  return { work_issue: requirement.work_issue, source_pr: requirement.source_pr, run_id: receipt.production_run_id,
    artifact_id: receipt.artifact_id, artifact_digest: receipt.artifact_digest };
}

function verifyProducer(run) {
  if (run.path !== `.github/workflows/${WORKFLOW}` || run.event !== 'workflow_dispatch' || run.status !== 'completed' ||
      run.conclusion !== 'success' || !githubIo.mergeCommitInMain(run.head_sha)) return false;
  const jobs = api(`repos/${CANONICAL}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (jobs.total_count > 100) throw Error('Production producer jobs exceed bounded verification');
  for (const name of ['SQL migration guards', 'Production apply review (immutable evidence + hard guards)', 'Production apply (automatic evidence gates)'])
    if (jobs.jobs.filter(j => j.name === name && j.status === 'completed' && j.conclusion === 'success').length !== 1) return false;
  return true;
}

export function verifyAppliedFiles(requirement, files) {
  const manifest = JSON.parse(files.get('migration-content-manifest.json'));
  if (!manifest || Array.isArray(manifest) || requirement.migrations.some(m => manifest[m.version] !== m.sha256))
    throw Error('Applied migration hashes differ from required source');
  const catalog = JSON.parse(files.get('production-catalog-verification.json'));
  const expected = requirement.migrations.map(m => m.version).sort();
  if (catalog.enforcing !== true || !Array.isArray(catalog.errors) || catalog.errors.length ||
      catalog.allowlist?.slice().sort().join(',') !== expected.join(',')) throw Error('Enforced production catalog proof did not pass');
  const versions = name => new Set(String(files.get(name) ?? '').split(/\r?\n/).flatMap(line => {
    const match = /^\s*(?:\d{14})?\s*\|\s*(\d{14})\s*\|/.exec(line);
    return match ? [match[1]] : [];
  }));
  const before = versions('production-ledger-before.txt'), after = versions('production-ledger-after.txt');
  if (!after.size || [...before].some(v => !after.has(v)) ||
      [...after].filter(v => !before.has(v)).sort().join(',') !== expected.join(',')) throw Error('Production ledger delta differs from the exact required migration set');
  return Object.fromEntries(requirement.migrations.map(m => [m.version, manifest[m.version]]));
}

// Candidate detection grants no authority. Only an authenticated native train
// and the complete producer/archive/ledger proof below can establish application.
export function batchRunCandidate(title, requirement) {
  const match = /^DB production apply ([a-f0-9]{40}) PR(?:[1-9][0-9]*)? ([0-9,]+)$/.exec(title ?? '');
  const versions = match?.[2].split(',');
  return !!versions && new Set(versions).size === versions.length &&
    requirement.migrations.every(m => versions.includes(m.version));
}
export function batchArtifactCandidate(requirement, files) {
  const manifest = JSON.parse(files.get('migration-content-manifest.json'));
  const catalog = JSON.parse(files.get('production-catalog-verification.json'));
  return Array.isArray(catalog.allowlist) && catalog.allowlist.length > requirement.migrations.length &&
    requirement.migrations.every(m => catalog.allowlist.includes(m.version) && manifest?.[m.version] === m.sha256);
}

// Pure verification consumes authenticated canonical I/O facts, never app claims.
// Every train entry must be accounted for by an exact independently merged PR.
export function verifyBatchProductionFiles(requirement, facts, files, proof) {
  verifyRequirementSource(requirement, facts);
  const { run, jobs, train_ref, train_sha, record, sources, ledger } = proof;
  if (!files.get('production-apply.txt')?.trim()) throw Error('Batch has no original production apply output');
  if (run.repository?.full_name !== CANONICAL || run.repository?.id !== 1275568548 ||
      run.head_repository?.id !== run.repository.id || run.path !== `.github/workflows/${WORKFLOW}` ||
      run.event !== 'workflow_dispatch' || run.status !== 'completed' || run.conclusion !== 'success' ||
      !SHA.test(run.head_sha) || !Number.isSafeInteger(run.id) || run.id < 1 ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw Error('Batch producer identity refused');
  for (const name of ['SQL migration guards', 'Production apply review (immutable evidence + hard guards)', 'Production apply (automatic evidence gates)']) {
    const rows = jobs.jobs?.filter(j => j.name === name && j.status === 'completed' && j.conclusion === 'success' && j.run_id === run.id && j.run_attempt === run.run_attempt);
    if (rows?.length !== 1) throw Error('Batch producer job proof incomplete');
  }
  const guards = jobs.jobs.find(j => j.name === 'SQL migration guards');
  if (guards.steps?.filter(s => s.name === 'Refuse a migration-train dispatch that is not the exact recorded train' && s.conclusion === 'success').length !== 1)
    throw Error('Batch producer did not verify an exact native train');
  const identity = proposeTrain(record);
  if (!SHA.test(train_sha) || record.train_id !== identity.train_id || record.manifest_digest !== identity.manifest_digest ||
      trainRecordRef(record) !== train_ref || record.target_identity !== 'qsllyeztdwjgirsysgai') throw Error('Batch native train identity changed');
  const catalog = JSON.parse(files.get('production-catalog-verification.json'));
  assertDispatchMatchesTrain(record, { target: 'production', commit_sha: run.head_sha, allowlist: catalog.allowlist });
  if (!Array.isArray(sources) || !sources.length || new Set(sources.map(s => s.requirement.source_pr)).size !== sources.length)
    throw Error('Batch source map is absent or ambiguous');
  const sourceMap = [];
  for (const source of sources) {
    verifyRequirementSource(source.requirement, source.facts);
    for (const migration of source.requirement.migrations) {
      const entries = record.entries.filter(e => e.version === migration.version && e.source_pr === source.requirement.source_pr &&
        e.file_sha256 === migration.sha256 && e.merge_sha === source.facts.merge_sha40);
      if (entries.length !== 1) throw Error('Batch entry differs from exact authenticated source');
      sourceMap.push({ work_issue: source.requirement.work_issue, source_pr: source.requirement.source_pr,
        source_head_sha: source.facts.head_sha40, source_merge_sha: source.facts.merge_sha40, ...migration });
    }
  }
  sourceMap.sort((a, b) => a.version.localeCompare(b.version));
  if (sourceMap.length !== record.entries.length || new Set(sourceMap.map(m => m.version)).size !== sourceMap.length ||
      sourceMap.map(m => m.version).join(',') !== record.entries.map(e => e.version).join(',')) throw Error('Batch source map does not cover the complete train');
  const own = sources.filter(s => s.requirement.source_pr === requirement.source_pr && s.requirement.work_issue === requirement.work_issue);
  if (own.length !== 1 || canonicalJson(own[0].facts) !== canonicalJson(facts) || canonicalJson(own[0].requirement) !== canonicalJson(requirement))
    throw Error('Batch cannot supply a different requirement source');
  const migration_hashes = verifyAppliedFiles({ migrations: sourceMap }, files);
  if (!ledger || Object.keys(ledger).sort().join(',') !== sourceMap.map(m => m.version).join(',') ||
      Object.values(ledger).some(value => !/^[a-f0-9]{64}$/.test(value))) throw Error('Batch live ledger proof is incomplete');
  return { train_ref, train_sha, train_id: record.train_id, production_main_sha: run.head_sha,
    production_run_id: run.id, production_run_attempt: run.run_attempt, source_map: sourceMap,
    migration_hashes, ledger_fingerprints: ledger, catalog_sha256: hash(files.get('production-catalog-verification.json')) };
}

async function productionArchive(run, artifactId, expectedDigest) {
  const artifact = api(`repos/${CANONICAL}/actions/artifacts/${artifactId}`);
  if (artifact.id !== artifactId || artifact.expired !== false || artifact.name !== `production-migration-apply-${run.head_sha}` ||
      artifact.digest !== expectedDigest || artifact.workflow_run?.head_sha !== run.head_sha || artifact.workflow_run?.id !== run.id)
    throw Error('Batch production archive producer changed');
  let bytes;
  try { bytes = runGitHubCommand(['api', `repos/${CANONICAL}/actions/artifacts/${artifactId}/zip`],
    { encoding: null, timeoutMs: 60_000, maxBuffer: 16 * 1024 * 1024 }); }
  catch { throw Error('Batch production archive is unavailable'); }
  if (`sha256:${hash(bytes)}` !== expectedDigest) throw Error('Batch archive digest differs');
  return selectArtifactFiles(readZipEntries(bytes), ['production-apply.txt', 'production-ledger-before.txt', 'production-ledger-after.txt',
    'migration-content-manifest.json', 'production-catalog-verification.json']);
}

export function validatedTrainRefFromLog(log) {
  if (typeof log !== 'string' || Buffer.byteLength(log) > 20 * 1024 * 1024) throw Error('Batch guard log is unreadable');
  const refs = [...new Set([...log.matchAll(/^\d{4}-\d{2}-\d{2}T[^ \r\n]+Z[ \t]+TRAIN_REF: (refs\/db-migration-trains\/[a-f0-9]{64}\/[0-9]{6}-dispatched)[ \t]*\r?$/gm)].map(m => m[1]))];
  if (refs.length !== 1) throw Error('Batch exact validated train input is unavailable');
  return refs[0];
}

async function authenticateBatch(requirement, facts, run, files) {
  const jobs = api(`repos/${CANONICAL}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (!Array.isArray(jobs.jobs) || jobs.total_count > 100) throw Error('Batch producer jobs incomplete');
  const guards = jobs.jobs.filter(j => j.name === 'SQL migration guards' && j.conclusion === 'success');
  if (guards.length !== 1 || guards[0].run_id !== run.id || guards[0].run_attempt !== run.run_attempt)
    throw Error('Batch guard job identity differs');
  // The existing workflow does not archive its train input. Its authenticated
  // guard-job log records the exact input while the successful native step
  // proves it was validated. Never guess a train from a coincident allowlist.
  const log = command(['api', `repos/${CANONICAL}/actions/jobs/${guards[0].id}/logs`]);
  const train_ref = validatedTrainRefFromLog(log), train_sha = githubIo.readRef(train_ref);
  const payload = trainIo(githubIo).readImmutable(train_ref);
  if (!payload || !train_sha) throw Error('Batch immutable native train is unavailable');
  const record = payload.record, sources = [], ledger = {};
  if (!Array.isArray(record.entries) || record.entries.length > 200) throw Error('Batch train entry bound exceeded');
  for (const source_pr of [...new Set(record.entries.map(e => e.source_pr))]) {
    const linked = githubIo.closingIssuesForPr(source_pr);
    if (linked.length !== 1) throw Error('Batch source issue binding is ambiguous');
    const entries = record.entries.filter(e => e.source_pr === source_pr);
    const mainFiles = githubIo.treeFiles(run.head_sha);
    const migrations = entries.map(e => {
      const paths = mainFiles.filter(p => p.startsWith(`supabase/migrations/${e.version}_`) && p.endsWith('.sql'));
      if (paths.length !== 1) throw Error('Batch migration source path is ambiguous');
      return { version: e.version, path: paths[0], sha256: e.file_sha256 };
    });
    const required = { work_issue: Number(linked[0].number), source_pr, migrations };
    const source = sourceFacts(required);
    const comparison = api(`repos/${CANONICAL}/compare/${source.merge_sha40}...${run.head_sha}`);
    if (!['identical', 'ahead'].includes(comparison.status) || comparison.behind_by !== 0) throw Error('Batch source was absent from producer main');
    for (const migration of migrations) if (hash(content(CANONICAL, migration.path, run.head_sha)) !== migration.sha256)
      throw Error('Batch producer migration bytes changed');
    Object.assign(ledger, await ledgerFingerprints(required, source));
    sources.push({ requirement: required, facts: source });
  }
  return verifyBatchProductionFiles(requirement, facts, files, { run, jobs, train_ref, train_sha, record, sources, ledger });
}

async function ledgerFingerprints(requirement, facts) {
  const literal = JSON.stringify(requirement.migrations.map(m => m.version)).replaceAll("'", "''");
  const rows = await readProduction(`BEGIN READ ONLY;
    SELECT coalesce(jsonb_object_agg(s.version, jsonb_build_object('fingerprint',encode(sha256(convert_to(array_to_json(s.statements)::text, 'UTF8')), 'hex'),'statements',s.statements)), '{}'::jsonb) AS ledger
    FROM supabase_migrations.schema_migrations s
    JOIN jsonb_array_elements_text('${literal}'::jsonb) wanted(version) ON wanted.version=s.version;
    COMMIT;`);
  if (rows.length !== 1 || !rows[0].ledger || Array.isArray(rows[0].ledger)) throw Error('Live migration ledger is unreadable');
  const fingerprints = {};
  for (const m of requirement.migrations) {
    const live = rows[0].ledger[m.version];
    if (!live) continue;
    const source = facts.files.find(f => f.path === m.path)?.content;
    if (!fileMatchesLedgerStatements(source, live.statements)) {
      // The existing reviewed atomic applier has one explicit outer-transaction
      // transformation. Reuse its exact policy/parser; never strip SQL ad hoc.
      let expected;
      try { expected = JSON.parse(execFileSync('python', ['-c',
        'import hashlib,json,sys;from pathlib import Path;sys.path.insert(0,"scripts");from atomic_migration_apply import load_candidate;p,_,_,s=load_candidate(Path("supabase/migrations"),sys.argv[1],"production");print(json.dumps({"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"statements":s}))', m.version],
        { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })); }
      catch { throw Error('Current production ledger statements differ from exact canonical source'); }
      if (expected.sha256 !== m.sha256 || JSON.stringify(expected.statements) !== JSON.stringify(live.statements)) throw Error('Current production ledger statements differ from the authorized atomic source');
    }
    fingerprints[m.version] = live.fingerprint;
  }
  return fingerprints;
}

async function productionEvidence(requirement, facts) {
  const ledger = await ledgerFingerprints(requirement, facts);
  const ref = `refs/designflow-db-apply-receipts/${requirement.work_issue}/${requirement.source_pr}/${facts.head_sha40}`;
  const archived = githubIo.readRef(ref);
  if (archived) {
    const message = githubIo.getCommit(archived)?.message, prefix = 'designflow-db-apply-receipt ';
    if (!message?.startsWith(prefix)) throw Error('Production receipt has unknown provenance');
    const receipt = JSON.parse(message.slice(prefix.length));
    const run = api(`repos/${CANONICAL}/actions/runs/${receipt.production_run_id}/attempts/${receipt.production_run_attempt}`);
    if (run.head_sha !== receipt.production_main_sha || !verifyProducer(run)) throw Error('Archived production producer no longer verifies');
    let batchProof = null;
    if (receipt.schema_version === 2) {
      const files = await productionArchive(run, receipt.artifact_id, receipt.artifact_digest);
      batchProof = await authenticateBatch(requirement, facts, run, files);
    }
    return verifyApplyReceipt(requirement, facts, receipt, ledger, batchProof);
  }
  if (Object.keys(ledger).length !== requirement.migrations.length) return null;
  const scope = parseQueueScope(api(`repos/${CANONICAL}/issues/${requirement.work_issue}`).body);
  const comments = pages(`repos/${CANONICAL}/issues/${requirement.work_issue}/comments`);
  const mentioned = comments.flatMap(row => [...row.body.matchAll(/https:\/\/github\.com\/popcre\/shared-db\/actions\/runs\/([1-9][0-9]*)/g)].map(m => m[1]));
  const source = api(`repos/${CANONICAL}/pulls/${requirement.source_pr}`);
  if (!source.merged_at || source.head.sha !== facts.head_sha40) throw Error('Production discovery source changed');
  const since = encodeURIComponent(`>=${source.merged_at}`);
  const discovered = workflowRuns(api, `repos/${CANONICAL}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&status=success&created=${since}`);
  const ids = [...new Set([...mentioned, ...discovered.filter(r => productionRunMatches(r.display_title, requirement) || batchRunCandidate(r.display_title, requirement)).map(r => String(r.id))])];
  if (ids.length > 50) throw Error('Production evidence candidates exceed bounded verification');
  const verified = [];
  for (const id of ids) {
    const run = api(`repos/${CANONICAL}/actions/runs/${id}`);
    if (!verifyProducer(run)) continue;
    const artifacts = api(`repos/${CANONICAL}/actions/runs/${id}/artifacts?per_page=100`);
    if (artifacts.total_count > 100) throw Error('Artifact pagination required');
    for (const artifact of artifacts.artifacts.filter(a => a.name === `production-migration-apply-${run.head_sha}` && a.expired === false)) {
      const evidence = { schema_version: 1, work_issue: requirement.work_issue, merge_pr: requirement.source_pr,
        merge_sha: facts.merge_sha40, application_repository: scope.applicationReturnTo,
        production_evidence: run.html_url, production_commit_sha: run.head_sha,
        production_artifact_id: artifact.id, production_artifact_digest: artifact.digest,
        live_assertion: scope.liveAssertion, environment: 'production', verified_at: new Date().toISOString() };
      if (artifact.workflow_run?.head_sha !== run.head_sha || Number(artifact.workflow_run?.id) !== run.id) throw Error('Production artifact producer changed');
      let bytes;
      try { bytes = runGitHubCommand(['api', `repos/${CANONICAL}/actions/artifacts/${artifact.id}/zip`],
        { encoding: null, timeoutMs: 60_000, maxBuffer: 16 * 1024 * 1024 }); }
      catch { throw Error('Production artifact download is unavailable'); }
      if (artifact.digest !== `sha256:${hash(bytes)}`) throw Error('Production archive digest differs');
      const files = selectArtifactFiles(readZipEntries(bytes), ['production-apply.txt', 'production-ledger-before.txt', 'production-ledger-after.txt',
        'migration-content-manifest.json', 'production-catalog-verification.json']);
      if (!artifactContainsSource(requirement, files) && !batchArtifactCandidate(requirement, files)) continue;
      const batch = artifactContainsSource(requirement, files) ? null : await authenticateBatch(requirement, facts, run, files);
      const actualHashes = batch ? Object.fromEntries(requirement.migrations.map(m => [m.version, m.sha256])) : verifyAppliedFiles(requirement, files);
      if (!batch) {
        const verifier = { ...githubIo, readArtifactFiles: () => files };
        if (verifier.verifyProductionApply(evidence) !== true) throw Error('Native production artifact verifier refused');
      }
      const receipt = { schema_version: batch ? 2 : 1, work_issue: requirement.work_issue, source_pr: requirement.source_pr,
        source_head_sha: facts.head_sha40, source_merge_sha: facts.merge_sha40, production_main_sha: run.head_sha,
        production_run_id: run.id, production_run_attempt: run.run_attempt, artifact_id: artifact.id, artifact_digest: artifact.digest,
        migration_hashes: actualHashes, ledger_fingerprints: ledger, catalog_sha256: hash(files.get('production-catalog-verification.json')),
        captured_at: new Date().toISOString(), ...(batch ? { batch } : {}) };
      verifyApplyReceipt(requirement, facts, receipt, ledger, batch);
      verified.push({ receipt, result: { work_issue: requirement.work_issue, source_pr: requirement.source_pr, run_id: run.id,
        artifact_id: artifact.id, artifact_digest: artifact.digest } });
    }
  }
  if (verified.length > 1) throw Error('Ambiguous production evidence requires reconciliation');
  if (!verified.length) return null;
  const candidate = verified[0];
  const sha = githubIo.makeOwnerCommit('designflow-db-apply-receipt ' + JSON.stringify(candidate.receipt));
  if (!githubIo.createRef(ref, sha) || githubIo.readRef(ref) !== sha) throw Error('Immutable application receipt could not be preserved');
  return candidate.result;
}

export function productionRunMatches(title, requirement) {
  const match = /^DB production apply ([a-f0-9]{40}) PR([1-9][0-9]*) ([0-9,]+)$/.exec(title ?? '');
  const versions = match?.[3].split(',');
  return !!match && Number(match[2]) === requirement.source_pr &&
    new Set(versions).size === versions.length &&
    versions.slice().sort().join(',') === requirement.migrations.map(m => m.version).sort().join(',');
}

// Reuse the native current candidate and admission proofs without changing issue
// state or outcome history. A closed, unfinished issue needs its existing owner
// to restore admission; the observer never silently reopens it.
export function prepareReleaseReady(requirement, native = githubIo) {
  const readOnly = Object.create(native);
  readOnly.commentIssue = undefined;
  readOnly.updateIssue = undefined;
  const options = { preparePreviewDispatch: requirement.work_issue,
    admitIssue: requirement.work_issue, pr: requirement.source_pr };
  const flow = readOnly.flowAdapter(null, options);
  const assertSession = () => {
    const authority = flow.resolveMarker();
    if (!authority?.live || authority.task !== authority.calling_task)
      throw Error('Native claim-first session authority is required');
  };
  const candidate = () => {
    assertSession();
    admitIssue(requirement.work_issue, readOnly, { pr: requirement.source_pr, allowLegacy: true });
    const ready = readyRecord(flow.selectCurrent(requirement.work_issue));
    if (ready.route !== 'merged_rehearsal' || ready.pr !== requirement.source_pr ||
        ready.manifest.preview_allowlist.split(',').sort().join(',') !== requirement.migrations.map(m => m.version).sort().join(','))
      throw Error('Native preview instruction does not match the release requirement');
    return ready;
  };
  const reuse = ready => {
    const ref = `refs/db-preview-ready/${ready.ready_id}`;
    const stored = flow.readRef(ref);
    if (!stored) return null;
    if (stored.digest !== sha256(canonicalJson(stored.record)) ||
        readyRecord(stored.record).ready_id !== ready.ready_id ||
        canonicalJson(readyRecord(stored.record)) !== canonicalJson(ready))
      throw Error('Stored native ready instruction differs from current verified identity');
    const outcome = flow.readRef(`refs/db-preview-ready-outcomes/${ready.ready_id}`);
    if (outcome && outcome.record?.outcome !== 'dispatched')
      throw Error('Native ready instruction has a conflicting terminal outcome');
    const bindings = flow.events(requirement.work_issue).filter(e => e.schema_version === 2 &&
      e.event_type === 'preview_ready' && e.ready_id === ready.ready_id);
    if (bindings.length !== 1) throw Error('Native ready instruction requires one authenticated event binding');
    return ready;
  };
  const existing = reuse(candidate());
  if (existing) return existing; // No mutex, issue comment, or coordination write.
  return flow.withMutex(() => {
    const ready = candidate();
    const concurrent = reuse(ready);
    if (concurrent) return concurrent;
    if (flow.events(requirement.work_issue).some(e => e.ready_id === ready.ready_id))
      throw Error('Uncertain native ready preparation requires reconciliation before retry');
    // The native admission mutex is already held. Native preparation retains its
    // source/dependency proofs, immutable ready binding and supersession checks.
    const prepared = preparePreviewDispatch(requirement.work_issue, { ...flow,
      withMutex: fn => fn(),
      appendEvent: event => native.commentIssue(event.work_issue, formatEventComment(event)) });
    if (prepared.status !== 'PREVIEW_READY') throw Error('Native preparation did not complete');
    return reuse(ready);
  });
}

// Scheduled passes sequence dry-run then apply; uncertain writes are never replayed.
function promote(requirement) {
  const ready = prepareReleaseReady(requirement);
  if (api(`repos/${CANONICAL}/commits/main`).sha !== ready.manifest.commit_sha) throw Error('Canonical main changed before dispatch');
  for (const mode of ready.mode_sequence) {
    const ref = `refs/designflow-db-dispatches/${ready.ready_id}/${mode}`;
    const prior = githubIo.readRef(ref);
    const title = dispatchTitle(ready.manifest, mode);
    const runs = workflowRuns(api, `repos/${CANONICAL}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&head_sha=${ready.manifest.commit_sha}`)
      .filter(r => r.head_sha === ready.manifest.commit_sha && r.display_title === title);
    if (runs.length > 1) throw Error('Ambiguous native dispatch run; never guess');
    if (prior) {
      const message = githubIo.getCommit(prior)?.message;
      const prefix = 'designflow-db-dispatch ';
      if (!message?.startsWith(prefix)) throw Error('Malformed preserved dispatch');
      const recorded = JSON.parse(message.slice(prefix.length));
      if (recorded.ready_id !== ready.ready_id || recorded.mode !== mode || recorded.title !== title) throw Error('Preserved dispatch identity changed');
      const run = runs[0];
      if (!run) return { state: 'awaiting-run', mode, ready_id: ready.ready_id, replay_allowed: false };
      if (Date.parse(run.created_at) < Date.parse(recorded.created_at) - 1000)
        throw Error('Preserved dispatch predates its authenticated custody; reconcile before retry');
      if (run.status !== 'completed') return { state: 'running', mode, run_id: run.id };
      if (run.conclusion !== 'success') throw Error('Native rehearsal failed; repair its cause before recovery');
      continue;
    }
    if (runs.length) throw Error('Existing run has no release dispatch custody; reconcile before adoption');
    const record = { ready_id: ready.ready_id, mode, title, created_at: new Date().toISOString() };
    const owner = githubIo.makeOwnerCommit('designflow-db-dispatch ' + JSON.stringify(record));
    if (!githubIo.createRef(ref, owner) || githubIo.readRef(ref) !== owner) throw Error('Dispatch custody could not be preserved');
    // Deliberately one write attempt. A timeout remains an unresolved dispatch.
    api(`repos/${CANONICAL}/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main', inputs: { ...ready.manifest, mode } });
    return { state: 'dispatched', mode, ready_id: ready.ready_id };
  }
  return { state: 'awaiting-production-evidence', ready_id: ready.ready_id };
}

export async function runObserver(policy, io) {
  const results = [];
  for (const app of policy.repositories) for (const branch of policy.release_branches ?? ['develop']) {
    let head;
    try {
      head = await io.applicationHead(app.repository, branch);
      if (!SHA.test(head)) throw Error('Application head is not an exact SHA');
      await io.status(app.repository, head, 'pending', 'Checking required production database changes');
      const manifest = await io.manifest(app.repository, head);
      const result = await assessRelease({ repository: app.repository, head, manifest, policy, branch }, io);
      await io.status(app.repository, head, result.status === 'ready' ? 'success' : 'pending',
        result.status === 'ready' ? 'Required production database changes and contracts verified' : 'Required database promotion remains pending');
      results.push(result);
    } catch (error) {
      if (head && SHA.test(head)) await io.status(app.repository, head, 'failure', 'Database readiness could not be proven; see central run');
      results.push({ repository: app.repository, branch, head_sha: head, status: 'blocked', reason: error.message });
    }
  }
  return results;
}

async function readProduction(query) {
  const project = 'qsllyeztdwjgirsysgai';
  if (!process.env.SUPABASE_ACCESS_TOKEN)
    throw Error('Authenticated production catalog access is unavailable');
  // Target comes from reviewed central policy and the fixed HTTPS endpoint.
  // A project label returned by SQL is never used as connection authority.
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!response.ok) throw Error(`Production catalog service refused (${response.status})`);
  const body = await response.json();
  if (!Array.isArray(body)) throw Error('Production catalog envelope changed');
  return body;
}

async function catalog(contracts, project) {
  if (project !== 'qsllyeztdwjgirsysgai') throw Error('Production catalog target mismatch');
  const rows = await readProduction(productionCatalogQuery(contracts));
  if (rows.length !== 1) throw Error('Production catalog envelope changed');
  return verifyCatalogProof(contracts, rows[0].production_catalog_proof);
}

export function assertObserverSource(env, localHead) {
  if (env.GITHUB_REPOSITORY !== CANONICAL || env.GITHUB_REF !== 'refs/heads/main' ||
      !SHA.test(env.GITHUB_SHA ?? '') || env.GITHUB_SHA !== localHead)
    throw Error('Observer source must equal its authenticated canonical workflow commit');
  if (!env.DFLOW_READINESS_STATUS_TOKEN || env.DFLOW_READINESS_APP_SLUG !== 'pop-ai-watchers')
    throw Error('The designated readiness App credential is unavailable; no publisher fallback');
}

export function publishAppStatus(repository, head, body, token, send = api) {
  if (!token || !/^popcre\/designflow-(backend|bff|frontend|item-master|tracking|data-syncing)$/.test(repository) || !SHA.test(head))
    throw Error('Exact application and designated App token required for readiness status');
  const result = send(`repos/${repository}/statuses/${head}`, body, { token });
  if (result?.creator?.login !== 'pop-ai-watchers[bot]' || result.state !== body.state || result.context !== body.context)
    throw Error('Readiness status was not published by the designated App');
  return result;
}

export async function main() {
  if (process.argv.slice(2).join(' ') !== '--observe' || process.env.GITHUB_REPOSITORY !== CANONICAL || process.env.GITHUB_REF !== 'refs/heads/main')
    throw Error('Observer executes only from canonical main with --observe');
  assertObserverSource(process.env, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000 }).trim());
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  const remaining = api('rate_limit').resources.core.remaining;
  if (!Number.isSafeInteger(remaining) || remaining < 1000) throw Error('GitHub API reserve is unavailable');
  const factsCache = new Map(), evidenceCache = new Map();
  const memo = (cache, key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  const url = `https://github.com/${CANONICAL}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const io = {
    applicationHead: (repo, branch = 'develop') => api(`repos/${repo}/git/ref/heads/${branch}`).object.sha,
    sourceAllowed: (repo, mainHead) => {
      const commit = api(`repos/${repo}/commits/${mainHead}`);
      const pulls = pages(`repos/${repo}/commits/${mainHead}/pulls`);
      const eligible = pulls.filter(p => p.merged_at && p.merge_commit_sha === mainHead && p.base.ref === 'main' &&
        p.head.ref === 'develop' && p.base.repo.full_name === repo && p.head.repo?.full_name === repo);
      if (eligible.length !== 1) return false;
      return api(`repos/${repo}/commits/${eligible[0].head.sha}`).commit.tree.sha === commit.commit.tree.sha;
    },
    manifest: (repo, head) => JSON.parse(content(repo, policy.manifest_path, head)),
    sourceFacts: requirement => memo(factsCache, requirement.source_pr, () => sourceFacts(requirement)),
    productionEvidence: (requirement, facts) => memo(evidenceCache, requirement.source_pr, () => productionEvidence(requirement, facts)),
    promote,
    catalog,
    status: (repo, head, state, description) => publishAppStatus(repo, head, { state, context: policy.status_context, description, target_url: url }, process.env.DFLOW_READINESS_STATUS_TOKEN),
  };
  const results = await runObserver(policy, io);
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  if (results.some(r => r.status === 'blocked')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { process.stderr.write('Database release observer refused; no readiness was authorized.\n'); process.exitCode = 1; });
