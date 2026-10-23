import test from 'node:test';
import assert from 'node:assert/strict';
import { productionCatalogQuery, verifyCatalogProof, PRODUCTION_PROJECT_REF } from './designflow-db-catalog.mjs';

const contracts = [{
  schema: 'catalog_probe_schema', relation: 'catalog_probe_relation', columns: ['id', 'email'],
  privileges: [{ role: 'catalog_probe_reader', privileges: ['SELECT'] },
    { role: 'catalog_probe_writer', privileges: ['INSERT', 'UPDATE', 'DELETE', 'REFERENCES'] }]
}];
const proof = (overrides = {}) => ({ production_project_ref: PRODUCTION_PROJECT_REF, failures: [], checked_contracts: 1, ...overrides });
const copy = () => structuredClone(contracts);

test('query embeds the complete normalized manifest only as one JSON string literal', () => {
  const query = productionCatalogQuery(contracts);
  const match = query.match(/jsonb_to_recordset\('((?:[^']|'')*)'::jsonb\)/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1].replaceAll("''", "'")), contracts);
  const withoutPayload = query.replace(match[0], 'jsonb_to_recordset(PAYLOAD::jsonb)');
  for (const name of ['catalog_probe_schema', 'catalog_probe_relation', 'catalog_probe_reader', 'catalog_probe_writer']) {
    assert.equal(withoutPayload.includes(name), false);
  }
  assert.equal(query.includes('"catalog_probe_schema"."catalog_probe_relation"'), false);
});

test('SQL is a fixed read-only transaction with one catalog SELECT and no business relation access', () => {
  const query = productionCatalogQuery(contracts);
  assert.ok(query.startsWith('BEGIN READ ONLY;\nWITH required_contracts AS ('));
  assert.ok(query.endsWith('\nCOMMIT;'));
  const sql = query.replace(/'(?:[^']|'')*'/g, "''");
  assert.equal(sql.split(';').filter(part => part.trim()).length, 3);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|DO|CALL|EXECUTE)\b/i);
  assert.match(sql, /LEFT JOIN pg_catalog\.pg_namespace/);
  assert.match(sql, /LEFT JOIN pg_catalog\.pg_class/);
  assert.match(sql, /LEFT JOIN pg_catalog\.pg_attribute/);
  assert.match(sql, /LEFT JOIN pg_catalog\.pg_roles/);
  assert.doesNotMatch(sql, /FROM\s+["`]/);
});

test('missing role, relation, namespace and columns are collected without unsafe privilege calls', () => {
  const query = productionCatalogQuery(contracts);
  assert.match(query, /WHERE namespace_oid IS NULL/);
  assert.match(query, /WHERE namespace_oid IS NOT NULL AND relation_oid IS NULL/);
  assert.match(query, /WHERE relation_oid IS NOT NULL AND attnum IS NULL/);
  assert.match(query, /FROM required_roles WHERE role_oid IS NULL/);
  assert.match(query, /WHERE CASE\s+WHEN role_oid IS NULL OR relation_oid IS NULL THEN false/);
  assert.match(query, /WHERE CASE\s+WHEN requested\.privilege <> 'SELECT' OR requested\.role_oid IS NULL\s+OR requested\.relation_oid IS NULL OR attribute\.attnum IS NULL THEN false/);
  assert.match(query, /AND attribute\.attnum > 0 AND NOT attribute\.attisdropped/);
});

test('SELECT checks every selected column and write privileges stay table-level', () => {
  const query = productionCatalogQuery(contracts);
  assert.match(query, /WHEN privilege = 'SELECT' AND jsonb_array_length\(columns\) > 0 THEN false/);
  assert.match(query, /ELSE NOT pg_catalog\.has_table_privilege\(role_oid, relation_oid, privilege\)/);
  assert.match(query, /CROSS JOIN LATERAL jsonb_array_elements_text\(requested\.columns\)/);
  assert.match(query, /has_column_privilege\(requested\.role_oid, requested\.relation_oid, attribute\.attnum, 'SELECT'\)/);
});

test('empty contracts generate a valid empty catalog proof and require count zero', () => {
  const query = productionCatalogQuery([]);
  assert.match(query, /jsonb_to_recordset\('\[\]'::jsonb\)/);
  assert.match(query, /COALESCE\(\(SELECT jsonb_agg/);
  assert.deepEqual(verifyCatalogProof([], proof({ checked_contracts: 0 })), proof({ checked_contracts: 0 }));
  assert.throws(() => verifyCatalogProof([], proof()), /count mismatch/);
});

for (const hostile of ["x'; DROP TABLE users;--", 'x"', 'x\\', 'x\ny', 'x.y', '', 'a'.repeat(64)]) {
  for (const field of ['schema', 'relation', 'column', 'role']) {
    test(`rejects hostile identifier in ${field}: ${JSON.stringify(hostile)}`, () => {
      const value = copy();
      if (field === 'column') value[0].columns[0] = hostile;
      else if (field === 'role') value[0].privileges[0].role = hostile;
      else value[0][field] = hostile;
      assert.throws(() => productionCatalogQuery(value), /identifier/);
      assert.throws(() => verifyCatalogProof(value, proof()), /identifier/);
    });
  }
}

test('rejects non-manifest fields, invalid privilege types and duplicate role requirements', () => {
  assert.throws(() => productionCatalogQuery([{ ...contracts[0], sql: 'SELECT 1' }]), /fields/);
  for (const invalid of ['TRUNCATE', 'select', "SELECT');SELECT 1;--", null, {}]) {
    const value = copy(); value[0].privileges[0].privileges = [invalid];
    assert.throws(() => productionCatalogQuery(value), /privilege/);
  }
  const value = copy(); value[0].privileges.push(structuredClone(value[0].privileges[0]));
  assert.throws(() => productionCatalogQuery(value), /duplicate role/);
});

test('successful proof requires the exact envelope and returns no asserted verification flag', () => {
  assert.deepEqual(verifyCatalogProof(contracts, proof()), proof());
  assert.throws(() => verifyCatalogProof(contracts, { ...proof(), verified: true }), /fields/);
  assert.throws(() => verifyCatalogProof(contracts, { verified: true }), /fields/);
  assert.throws(() => verifyCatalogProof(contracts, [proof()]), /object/);
  assert.throws(() => verifyCatalogProof(contracts, null), /object/);
  assert.throws(() => verifyCatalogProof(contracts, { ...proof(), errors: [] }), /fields/);
  assert.throws(() => verifyCatalogProof(contracts, { ...proof(), error: 'permission denied' }), /fields/);
  const missing = proof(); delete missing.failures;
  assert.throws(() => verifyCatalogProof(contracts, missing), /fields/);
  assert.throws(() => verifyCatalogProof(contracts, proof({ failures: null })), /array/);
});

test('wrong target or contract count cannot be accepted as success', () => {
  assert.throws(() => verifyCatalogProof(contracts, proof({ production_project_ref: 'xupnyeifmpsacrqahwwm' })), /target/);
  for (const count of [0, 2, -1, 1.1, '1', NaN, Infinity, null]) {
    assert.throws(() => verifyCatalogProof(contracts, proof({ checked_contracts: count })), /count mismatch/);
  }
});

for (const failure of [
  { schema: 'dflow_prod', relation: 'sample', reason: 'missing_namespace' },
  { schema: 'dflow_prod', relation: 'sample', reason: 'missing_relation' },
  { schema: 'dflow_prod', relation: 'sample', column: 'email', reason: 'missing_column' },
  { schema: 'dflow_prod', relation: 'sample', role: 'tracking_runtime', reason: 'missing_role' },
  { schema: 'dflow_prod', relation: 'sample', role: 'tracking_runtime', privilege: 'INSERT', reason: 'missing_privilege' },
  { schema: 'dflow_prod', relation: 'sample', column: 'email', role: 'tracking_runtime', privilege: 'SELECT', reason: 'missing_privilege' }
]) {
  test(`nonempty synthetic failure is refused: ${failure.reason} ${failure.privilege || ''}`, () => {
    assert.throws(() => verifyCatalogProof(contracts, proof({ failures: [failure] })), error => {
      assert.match(error.message, /requirements failed/);
      assert.deepEqual(error.failures, [failure]);
      return true;
    });
  });
}

test('failure data cannot carry business fields or caller-asserted success', () => {
  assert.throws(() => verifyCatalogProof(contracts, proof({ failures: [{ schema: 'dflow_prod', relation: 'sample', reason: 'missing_relation', business_rows: [] }] })), /fields/);
  assert.throws(() => verifyCatalogProof(contracts, proof({ failures: [true] })), /Malformed/);
});

// Append this block to designflow-db-catalog.test.mjs. Existing imports supply
// test, assert, productionCatalogQuery, verifyCatalogProof and PRODUCTION_PROJECT_REF.
import { spawnSync } from 'node:child_process';

const catalogTestContainer = process.env.DFLOW_RELEASE_CATALOG_TEST_CONTAINER;

test('catalog requirements execute safely against an explicitly selected synthetic PostgreSQL container', {
  skip: !catalogTestContainer,
  timeout: 60_000
}, async t => {
  // This is a container name, never a database URL. A fixed local Docker socket
  // and PostgreSQL Unix socket prevent inherited remote connection overrides.
  assert.match(catalogTestContainer, /^dflow-release-gate-[a-z0-9][a-z0-9-]{0,62}$/,
    'DFLOW_RELEASE_CATALOG_TEST_CONTAINER must name a dedicated dflow-release-gate synthetic container');
  const suffix = `${process.pid}_${Date.now().toString(36)}`;
  const schema = `catalog_probe_test_${suffix}`;
  const role = `catalog_probe_role_${suffix}`;
  const absentRole = `catalog_probe_missing_${suffix}`;
  const relation = 'probe_rows';

  function psql(sql, { expectFailure = false } = {}) {
    const result = spawnSync('/usr/bin/docker', [
      '--host', 'unix:///var/run/docker.sock', 'exec', '-i', catalogTestContainer,
      'psql', '--no-psqlrc', '--quiet', '--no-align', '--tuples-only',
      '--set', 'ON_ERROR_STOP=1', '--host', '/var/run/postgresql', '--port', '5432',
      '--username', 'postgres', '--dbname', 'postgres'
    ], { input: sql, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'synthetic PostgreSQL command must finish within its deadline');
    if (expectFailure) assert.notEqual(result.status, 0, 'expected synthetic command to be refused');
    else assert.equal(result.status, 0, `synthetic PostgreSQL command failed: ${result.stderr}`);
    return result;
  }

  function requirement({ columns = ['id'], privileges = ['SELECT'], relationName = relation, roleName = role } = {}) {
    return [{ schema, relation: relationName, columns, privileges: [{ role: roleName, privileges }] }];
  }

  function runProof(required) {
    const query = productionCatalogQuery(required);
    assert.ok(query.startsWith('BEGIN READ ONLY;\n'));
    assert.ok(query.endsWith('\nCOMMIT;'));
    return JSON.parse(psql(query).stdout.trim());
  }

  function fixtureRows() {
    return JSON.parse(psql(`SELECT COALESCE(jsonb_agg(to_jsonb(fixture) ORDER BY id), '[]'::jsonb)
      FROM "${schema}"."${relation}" AS fixture;`).stdout.trim());
  }

  let created = false;
  let originalRows;
  try {
    // No existing schema or role is reused or dropped. A failed setup rolls
    // back atomically; cleanup targets only the names created in this test.
    psql(`BEGIN;
      CREATE ROLE "${role}" NOLOGIN;
      CREATE SCHEMA "${schema}";
      CREATE TABLE "${schema}"."${relation}" (id integer PRIMARY KEY, email text, note text);
      INSERT INTO "${schema}"."${relation}" VALUES (1, 'synthetic@example.invalid', 'unchanged fixture');
      GRANT USAGE ON SCHEMA "${schema}" TO "${role}";
      GRANT SELECT (id) ON "${schema}"."${relation}" TO "${role}";
      COMMIT;`);
    created = true;
    originalRows = fixtureRows();

    await t.test('column-only SELECT grants satisfy selected-column contracts without table SELECT', () => {
      const grantState = JSON.parse(psql(`SELECT jsonb_build_object(
        'table_select', has_table_privilege('${role}', '"${schema}"."${relation}"', 'SELECT'),
        'column_select', has_column_privilege('${role}', '"${schema}"."${relation}"', 'id', 'SELECT'));`).stdout.trim());
      assert.deepEqual(grantState, { table_select: false, column_select: true });
      const required = requirement();
      assert.deepEqual(verifyCatalogProof(required, runProof(required)), {
        production_project_ref: PRODUCTION_PROJECT_REF, failures: [], checked_contracts: 1
      });
    });

    await t.test('missing column SELECT grants are refused without reading fixture rows', () => {
      const required = requirement({ columns: ['id', 'email'] });
      const actual = runProof(required);
      assert.deepEqual(actual.failures, [{ schema, relation, column: 'email', role, privilege: 'SELECT', reason: 'missing_privilege' }]);
      assert.throws(() => verifyCatalogProof(required, actual), /requirements failed/);
    });

    await t.test('table-level write privileges are required only when requested', () => {
      const writes = ['INSERT', 'UPDATE', 'DELETE', 'REFERENCES'];
      const required = requirement({ privileges: writes });
      const actual = runProof(required);
      assert.equal(actual.failures.length, writes.length);
      assert.deepEqual(actual.failures.map(failure => failure.privilege).sort(), [...writes].sort());
      for (const failure of actual.failures) {
        assert.deepEqual(failure, { schema, relation, role, privilege: failure.privilege, reason: 'missing_privilege' });
      }
      assert.throws(() => verifyCatalogProof(required, actual), /requirements failed/);
      psql(`GRANT INSERT, UPDATE, DELETE, REFERENCES ON "${schema}"."${relation}" TO "${role}";`);
      assert.deepEqual(runProof(required).failures, []);
    });

    await t.test('schema USAGE denial refuses an otherwise satisfied relation requirement', () => {
      psql(`REVOKE USAGE ON SCHEMA "${schema}" FROM "${role}";`);
      try {
        const required = requirement();
        const actual = runProof(required);
        assert.deepEqual(actual.failures, [{ schema, relation, role, reason: 'missing_schema_usage' }]);
        assert.throws(() => verifyCatalogProof(required, actual), /requirements failed/);
      } finally {
        psql(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}";`);
      }
    });

    await t.test('missing named role produces a failure envelope without a PostgreSQL exception', () => {
      const required = requirement({ roleName: absentRole });
      const actual = runProof(required);
      assert.deepEqual(actual.failures, [{ schema, relation, role: absentRole, reason: 'missing_role' }]);
      assert.throws(() => verifyCatalogProof(required, actual), /requirements failed/);
    });

    await t.test('missing relation produces a failure envelope without a PostgreSQL exception', () => {
      const required = requirement({ relationName: 'absent_relation' });
      const actual = runProof(required);
      assert.deepEqual(actual.failures, [{ schema, relation: 'absent_relation', reason: 'missing_relation' }]);
      assert.throws(() => verifyCatalogProof(required, actual), /requirements failed/);
    });

    await t.test('missing column produces a failure envelope without a PostgreSQL exception', () => {
      const required = requirement({ columns: ['absent_column'] });
      const actual = runProof(required);
      assert.deepEqual(actual.failures, [{ schema, relation, column: 'absent_column', reason: 'missing_column' }]);
      assert.throws(() => verifyCatalogProof(required, actual), /requirements failed/);
    });

    await t.test('zero contracts produce a valid empty proof', () => {
      const actual = runProof([]);
      assert.deepEqual(verifyCatalogProof([], actual), {
        production_project_ref: PRODUCTION_PROJECT_REF, failures: [], checked_contracts: 0
      });
    });

    await t.test('PostgreSQL enforces the read-only transaction and fixture data remains unchanged', () => {
      const refused = psql(`BEGIN READ ONLY;
        INSERT INTO "${schema}"."${relation}" VALUES (2, 'refused@example.invalid', 'must not exist');
        COMMIT;`, { expectFailure: true });
      assert.match(refused.stderr, /read-only transaction/);
      assert.deepEqual(fixtureRows(), originalRows);
    });
  } finally {
    if (created) {
      try {
        // Detect any accidental fixture-data mutation, including after a failed subtest.
        if (originalRows) assert.deepEqual(fixtureRows(), originalRows);
      } finally {
        psql(`BEGIN; DROP SCHEMA "${schema}" CASCADE; DROP ROLE "${role}"; COMMIT;`);
      }
    }
  }
});
