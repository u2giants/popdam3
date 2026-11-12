import { test } from 'node:test';
import assert from 'node:assert';
import { manifestDigest, validateManifest } from './lib/designflow-db-release.mjs';

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
