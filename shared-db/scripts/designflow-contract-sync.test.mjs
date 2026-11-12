import { test } from 'node:test';
import assert from 'node:assert';
import { manifestDigest, validateManifest } from './lib/designflow-db-release.mjs';
import { releasePolicy } from './designflow-db-release.mjs';
import {
  buildPolicyUpdate, verifiedPolicyUpdate, mergeWhenGreen, classifyVerificationError, runSync, syncApp,
} from './designflow-contract-sync.mjs';

const baseManifest = {
  schema_version: 1,
  repository: 'popcre/designflow-backend',
  production_project_ref: 'qsllyeztdwjgirsysgai',
  requirements: [],
  contracts: [
    { schema: 'dflow_prod', relation: 'users', columns: ['id', 'email'], privileges: [
      { role: 'designflow_prod_backend_runtime', privileges: ['SELECT'] },
    ]},
  ],
};

function basePolicy(digest = '0'.repeat(64)) {
  return {
    schema_version: 1,
    production_project_ref: 'qsllyeztdwjgirsysgai',
    manifest_path: '.release/database.json',
    branch: 'develop',
    status_context: 'database/production-ready',
    repositories: [
      {
        repository: 'popcre/designflow-backend',
        roles: ['designflow_prod_backend_runtime'],
        schemas: ['dflow_prod'],
        required_sources: [],
        contract_manifest_sha256: digest,
      },
      {
        repository: 'popcre/designflow-bff',
        roles: [],
        schemas: [],
        required_sources: [],
        contract_manifest_sha256: 'c9c19a5806cd7eed07af8d3b9b33d79bc13bd3821f647b806d2d924bf9853713',
      },
    ],
  };
}

const goodProof = {
  production_project_ref: 'qsllyeztdwjgirsysgai',
  failures: [],
  checked_contracts: 1,
};

// ---- digest semantics (unchanged) ----

test('contract digest changes when columns change', () => {
  const changed = { ...baseManifest, contracts: [
    { schema: 'dflow_prod', relation: 'users', columns: ['id', 'email', 'name'], privileges: [
      { role: 'designflow_prod_backend_runtime', privileges: ['SELECT'] },
    ]},
  ]};
  assert.notEqual(manifestDigest(baseManifest), manifestDigest(changed));
});

test('contract digest changes when privileges change', () => {
  const changed = { ...baseManifest, contracts: [
    { schema: 'dflow_prod', relation: 'users', columns: ['id', 'email'], privileges: [
      { role: 'designflow_prod_backend_runtime', privileges: ['SELECT', 'UPDATE'] },
    ]},
  ]};
  assert.notEqual(manifestDigest(baseManifest), manifestDigest(changed));
});

test('contract digest is stable for identical contracts', () => {
  assert.equal(manifestDigest(baseManifest), manifestDigest({ ...baseManifest }));
});

test('contract digest with empty requirements is stable regardless of original requirements', () => {
  const withReqs = { ...baseManifest, requirements: [
    { work_issue: 123, source_pr: 456, migrations: [
      { version: '20260101000000', path: 'supabase/migrations/20260101000000_test.sql', sha256: 'a'.repeat(64) },
    ]},
  ]};
  assert.equal(
    manifestDigest({ ...baseManifest, requirements: [] }),
    manifestDigest({ ...withReqs, requirements: [] }),
  );
});

test('contract digest changes when relation changes', () => {
  const changed = { ...baseManifest, contracts: [
    { schema: 'dflow_prod', relation: 'accounts', columns: ['id', 'email'], privileges: [
      { role: 'designflow_prod_backend_runtime', privileges: ['SELECT'] },
    ]},
  ]};
  assert.notEqual(manifestDigest(baseManifest), manifestDigest(changed));
});

test('contract digest changes when schema changes', () => {
  const changed = { ...baseManifest, contracts: [
    { schema: 'hts_rag', relation: 'users', columns: ['id', 'email'], privileges: [
      { role: 'designflow_prod_backend_runtime', privileges: ['SELECT'] },
    ]},
  ]};
  assert.notEqual(manifestDigest(baseManifest), manifestDigest(changed));
});

test('contract digest changes when role changes', () => {
  const changed = { ...baseManifest, contracts: [
    { schema: 'dflow_prod', relation: 'users', columns: ['id', 'email'], privileges: [
      { role: 'designflow_hts_prod_worker', privileges: ['SELECT'] },
    ]},
  ]};
  assert.notEqual(manifestDigest(baseManifest), manifestDigest(changed));
});

test('validateManifest accepts the base manifest', () => {
  assert.doesNotThrow(() => validateManifest(baseManifest));
});

// ---- finding 1: policy updates are independent per app (no stale-state writes) ----

test('buildPolicyUpdate does not mutate its input policy', () => {
  const policy = basePolicy();
  const before = JSON.stringify(policy);
  buildPolicyUpdate(policy, 'popcre/designflow-backend', 'a'.repeat(64));
  assert.equal(JSON.stringify(policy), before);
});

test('buildPolicyUpdate touches only the named app digest', () => {
  const policy = basePolicy();
  const updated = buildPolicyUpdate(policy, 'popcre/designflow-backend', 'b'.repeat(64));
  assert.equal(updated.repositories[0].contract_manifest_sha256, 'b'.repeat(64));
  assert.equal(updated.repositories[1].contract_manifest_sha256, policy.repositories[1].contract_manifest_sha256);
  assert.equal(JSON.stringify({ ...updated, repositories: undefined }), JSON.stringify({ ...policy, repositories: undefined }));
});

test('two apps updated sequentially keep both digests (regression: second write must not revert the first)', () => {
  const policy = basePolicy();
  const first = buildPolicyUpdate(policy, 'popcre/designflow-backend', 'c'.repeat(64));
  const second = buildPolicyUpdate(first, 'popcre/designflow-bff', 'd'.repeat(64));
  assert.equal(second.repositories[0].contract_manifest_sha256, 'c'.repeat(64));
  assert.equal(second.repositories[1].contract_manifest_sha256, 'd'.repeat(64));
});

test('buildPolicyUpdate refuses an unknown repository', () => {
  assert.throws(() => buildPolicyUpdate(basePolicy(), 'popcre/designflow-nope', 'e'.repeat(64)), /not in the central policy/);
});

// ---- finding 4: proven refusals vs verification that could not run ----

test('catalog proof failures classify as refused', () => {
  const error = new Error('Production catalog requirements failed (1)');
  error.failures = [{ schema: 'dflow_prod', relation: 'users', reason: 'missing_relation' }];
  assert.equal(classifyVerificationError(error), 'refused');
});

test('policy allow-list refusal classifies as refused', () => {
  const error = new Error('Schema is outside this application policy');
  error.refused = true;
  assert.equal(classifyVerificationError(error), 'refused');
});

test('transport errors classify as could-not-verify, never as a mismatch', () => {
  assert.equal(classifyVerificationError(new Error('Production catalog service refused (503)')), 'could-not-verify');
  assert.equal(classifyVerificationError(new TypeError('Malformed catalog failure')), 'could-not-verify');
});

// ---- finding 2: central policy allow-lists hold before any PR ----

test('releasePolicy accepts an updated digest inside the allow-lists', () => {
  const digest = manifestDigest({ ...baseManifest, requirements: [] });
  const updated = buildPolicyUpdate(basePolicy(), 'popcre/designflow-backend', digest);
  assert.doesNotThrow(() => releasePolicy(baseManifest, updated));
});

test('releasePolicy refuses a schema outside the app policy even when the digest matches', () => {
  const manifest = { ...baseManifest, contracts: [
    { schema: 'plm', relation: 'users', columns: ['id'], privileges: [
      { role: 'designflow_prod_backend_runtime', privileges: ['SELECT'] },
    ]},
  ]};
  const digest = manifestDigest({ ...manifest, requirements: [] });
  const updated = buildPolicyUpdate(basePolicy(), 'popcre/designflow-backend', digest);
  assert.throws(() => releasePolicy(manifest, updated), /Schema is outside this application policy/);
});

test('releasePolicy refuses a role outside the app policy even when the digest matches', () => {
  const manifest = { ...baseManifest, contracts: [
    { schema: 'dflow_prod', relation: 'users', columns: ['id'], privileges: [
      { role: 'some_other_runtime', privileges: ['SELECT'] },
    ]},
  ]};
  const digest = manifestDigest({ ...manifest, requirements: [] });
  const updated = buildPolicyUpdate(basePolicy(), 'popcre/designflow-backend', digest);
  assert.throws(() => releasePolicy(manifest, updated), /Runtime role is outside this application policy/);
});

// ---- end-to-end decision path with stubs ----

function stubs(overrides = {}) {
  const calls = { issues: [], prs: [], merges: [], reads: [] };
  return {
    calls,
    io: {
      fetchManifest: () => baseManifest,
      readProduction: async (query) => {
        calls.reads.push(query);
        return [{ production_catalog_proof: { ...goodProof } }];
      },
      findOpenPR: () => null,
      findOpenIssue: () => null,
      openIssue: (title, body) => {
        calls.issues.push({ title, body });
        return String(6000 + calls.issues.length);
      },
      createContractPR: (repository, digest) => {
        calls.prs.push({ repository, digest });
        return 6100 + calls.prs.length;
      },
      mergeWhenGreen: (pr) => {
        calls.merges.push(pr);
        return 'auto-merge queued; merges when required checks are green';
      },
      ...overrides,
    },
  };
}

test('verified mismatch opens a contract-update PR and merges only when green', async () => {
  const { calls, io } = stubs();
  const result = await syncApp(basePolicy().repositories[0], basePolicy(), io);
  assert.equal(result.status, 'pr-merged');
  assert.equal(result.digest, manifestDigest({ ...baseManifest, requirements: [] }));
  assert.equal(calls.prs.length, 1);
  assert.equal(calls.merges.length, 1);
  assert.equal(calls.issues.length, 0);
});

test('catalog proof failure opens a labeled mismatch route and never opens a PR', async () => {
  const { calls, io } = stubs({
    readProduction: async () => [{
      production_catalog_proof: {
        production_project_ref: 'qsllyeztdwjgirsysgai',
        failures: [{ schema: 'dflow_prod', relation: 'users', reason: 'missing_relation' }],
        checked_contracts: 1,
      },
    }],
  });
  const result = await syncApp(basePolicy().repositories[0], basePolicy(), io);
  assert.equal(result.status, 'issue-created');
  assert.equal(calls.prs.length, 0);
  assert.equal(calls.merges.length, 0);
  assert.equal(calls.issues.length, 1);
  assert.match(calls.issues[0].title, /^Contract sync: popcre\/designflow-backend develop /);
  assert.match(calls.issues[0].body, /db-work-scope/);
});

test('schema outside the central allow-list opens a mismatch route and never opens a PR', async () => {
  const manifest = { ...baseManifest, contracts: [
    { schema: 'plm', relation: 'users', columns: ['id'], privileges: [
      { role: 'designflow_prod_backend_runtime', privileges: ['SELECT'] },
    ]},
  ]};
  const { calls, io } = stubs({ fetchManifest: () => manifest });
  const result = await syncApp(basePolicy().repositories[0], basePolicy(), io);
  assert.equal(result.status, 'issue-created');
  assert.match(result.reason, /Schema is outside this application policy/);
  assert.equal(calls.prs.length, 0);
  assert.equal(calls.merges.length, 0);
  assert.equal(calls.issues.length, 1);
});

test('production catalog unreachable routes as could-not-verify and never merges', async () => {
  const { calls, io } = stubs({
    readProduction: async () => { throw new Error('Production catalog service refused (503)'); },
  });
  const result = await syncApp(basePolicy().repositories[0], basePolicy(), io);
  assert.equal(result.status, 'could-not-verify');
  assert.equal(calls.prs.length, 0);
  assert.equal(calls.issues.length, 1);
  assert.match(calls.issues[0].title, /^Contract sync could not verify: /);
});

test('an invalid manifest is routed and does not stop the other applications (finding 3)', async () => {
  const calls = { issues: [], prs: [], merges: [] };
  const io = {
    fetchManifest: (repository) => {
      if (repository === 'popcre/designflow-backend') return { nope: true };
      return {
        schema_version: 1,
        repository: 'popcre/designflow-bff',
        production_project_ref: 'qsllyeztdwjgirsysgai',
        requirements: [],
        contracts: [],
      };
    },
    readProduction: async () => [{ production_catalog_proof: { production_project_ref: 'qsllyeztdwjgirsysgai', failures: [], checked_contracts: 0 } }],
    findOpenPR: () => null,
    findOpenIssue: () => null,
    openIssue: (title, body) => { calls.issues.push({ title, body }); return '7000'; },
    createContractPR: (repository, digest) => { calls.prs.push({ repository, digest }); return 7100; },
    mergeWhenGreen: (pr) => { calls.merges.push(pr); return 'queued'; },
  };
  const policy = basePolicy();
  policy.repositories[1].contract_manifest_sha256 = '0'.repeat(64);
  const results = await runSync(policy, io);
  assert.equal(results.length, 2);
  assert.equal(results[0].status, 'issue-created');
  assert.equal(results[1].status, 'pr-merged');
  assert.equal(calls.prs.length, 1);
});

test('an in-sync application is left alone', async () => {
  const digest = manifestDigest({ ...baseManifest, requirements: [] });
  const { calls, io } = stubs();
  const result = await syncApp(basePolicy(digest).repositories[0], basePolicy(digest), io);
  assert.equal(result.status, 'in-sync');
  assert.equal(calls.issues.length, 0);
  assert.equal(calls.prs.length, 0);
});

test('an existing open contract-update PR is resumed instead of duplicated', async () => {
  const merged = [];
  const { calls, io } = stubs({
    findOpenPR: () => ({ number: 6109, head: { sha: 'verified-head' } }),
    readPRPolicy: () => basePolicy(manifestDigest(baseManifest)),
    mergeWhenGreen: (pr, head) => {
      assert.equal(head, 'verified-head');
      merged.push(pr); return 'auto-merge queued';
    },
  });
  const result = await syncApp(basePolicy().repositories[0], basePolicy(), io);
  assert.equal(result.status, 'pr-resumed');
  assert.equal(result.pr, 6109);
  assert.deepEqual(merged, [6109]);
  assert.equal(calls.reads.length, 1);
  assert.equal(calls.prs.length, 0);
});


test('stale open PR is never resumed or duplicated', async () => {
  const { calls, io } = stubs({
    findOpenPR: () => ({ number: 6109, head: { sha: 'old-head' } }),
    readPRPolicy: () => basePolicy('a'.repeat(64)),
  });
  const result = await syncApp(basePolicy().repositories[0], basePolicy(), io);
  assert.equal(result.status, 'pr-open');
  assert.match(result.reason, /digest differs/);
  assert.equal(calls.merges.length, 0);
  assert.equal(calls.prs.length, 0);
});

test('matching open PR cannot resume when production proof now fails', async () => {
  const { calls, io } = stubs({
    findOpenPR: () => ({ number: 6109, head: { sha: 'verified-head' } }),
    readPRPolicy: () => basePolicy(manifestDigest(baseManifest)),
    readProduction: async () => [{ production_catalog_proof: {
      ...goodProof, failures: [{ schema: 'dflow_prod', relation: 'users', reason: 'missing_relation' }],
    } }],
  });
  const result = await syncApp(basePolicy().repositories[0], basePolicy(), io);
  assert.equal(result.status, 'issue-created');
  assert.equal(calls.merges.length, 0);
});

test('fresh policy restrictions are enforced before preparing the commit', () => {
  const fresh = basePolicy();
  fresh.repositories[0].schemas = [];
  assert.throws(() => verifiedPolicyUpdate(fresh, baseManifest.repository,
    manifestDigest(baseManifest), baseManifest), /Schema is outside/);
  const updated = verifiedPolicyUpdate(basePolicy(), baseManifest.repository,
    manifestDigest(baseManifest), baseManifest);
  assert.equal(updated.repositories[0].contract_manifest_sha256, manifestDigest(baseManifest));
});

test('fallback preserves branch protection, pins the proven head and allows long checks', () => {
  const calls = [];
  mergeWhenGreen(6109, 'verified-head', (args, options) => {
    calls.push({ args, options });
    if (args.includes('--auto')) throw Error('auto merge unavailable');
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.timeout, 600_000);
  for (const call of [calls[0], calls[2]]) {
    assert.ok(!call.args.includes('--admin'));
    assert.deepEqual(call.args.slice(-2), ['--match-head-commit', 'verified-head']);
  }
});

test('fallback never merges when checks fail', () => {
  const calls = [];
  assert.throws(() => mergeWhenGreen(6109, undefined, args => {
    calls.push(args);
    throw Error('refused');
  }), /refused/);
  assert.equal(calls.length, 2);
});


test('matching open PR is refused when its policy disallows the contract', async () => {
  const prPolicy = basePolicy(manifestDigest(baseManifest));
  prPolicy.repositories[0].schemas = [];
  const { calls, io } = stubs({
    findOpenPR: () => ({ number: 6109, head: { sha: 'verified-head' } }),
    readPRPolicy: () => prPolicy,
  });
  await assert.rejects(syncApp(basePolicy().repositories[0], basePolicy(), io), /Schema is outside/);
  assert.equal(calls.merges.length, 0);
  assert.equal(calls.prs.length, 0);
});
