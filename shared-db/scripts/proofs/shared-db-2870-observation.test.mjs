import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT, WORKFLOW, QUERY_URL, MAX_RESPONSE_BYTES, MAX_OBSERVATION_BYTES,
  digest, positiveId, parseStrictJson, validateCatalog, validateEnvironment,
  readBounded, queryCatalog, buildObservation, main,
} from './shared-db-2870-observation.mjs';

const sqlBytes = await readFile(new URL('./2870-catalog.sql', import.meta.url));
const contractBytes = await readFile(new URL('./2870-contract.json', import.meta.url));
const rows = ['comments', 'users'].map((table_name, index) => ({
  schema_name: 'dflow_prod', table_name, column_name: ['app_comment_id', 'app_profile_id'][index],
  data_type: 'uuid', type_schema: 'pg_catalog', nullable: true, has_default: false,
}));
const env = {
  GITHUB_REPOSITORY: 'popcre/shared-db', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40),
  GITHUB_WORKFLOW_REF: `popcre/shared-db/${WORKFLOW}@refs/heads/main`,
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', APPLICATION_COMMIT_SHA: 'b'.repeat(40),
};
const observedAt = '2026-09-20T16:00:00.000Z';
const valid = { rows, env, sqlBytes, contractBytes, observedAt };
const response = () => new Response(JSON.stringify(rows));
const failure = /SHARED_DB_2870_OBSERVATION_REFUSED/;

test('closed observation schema, exact identities and original byte hashes', () => {
  const bytes = buildObservation(valid);
  assert.ok(bytes.length <= MAX_OBSERVATION_BYTES);
  assert.deepEqual(JSON.parse(bytes), {
    schema_version: 1, work_issue: 2870, project_ref: PROJECT,
    live_assertion: JSON.parse(contractBytes).live_assertion, observed_at: observedAt,
    producer_repository: 'popcre/shared-db', producer_commit_sha: env.GITHUB_SHA,
    producer_workflow: WORKFLOW, producer_run_id: 123, producer_run_attempt: 2,
    application_repository: 'popcre/designflow-backend', application_commit_sha: env.APPLICATION_COMMIT_SHA,
    sql_sha256: digest(sqlBytes), contract_sha256: digest(contractBytes), catalog: rows,
  });
  assert.deepEqual(validateCatalog([...rows].reverse()), rows);
  assert.notEqual(digest(sqlBytes), digest(Buffer.concat([sqlBytes, Buffer.from(' ')])));
});

test('reject wrong environment, target, contract, IDs and timestamps', () => {
  for (const key of Object.keys(env)) {
    assert.throws(() => validateEnvironment({ ...env, [key]: 'wrong' }), failure, key);
    assert.throws(() => validateEnvironment({ ...env, [key]: undefined }), failure, key);
  }
  for (const id of ['0', '-1', '01', '1e2', '+1', '1.0', '9007199254740992', '', 1]) {
    assert.throws(() => positiveId(id), failure);
  }
  assert.equal(positiveId('9007199254740991'), Number.MAX_SAFE_INTEGER);
  for (const [key, value] of [['project_ref', 'wrong'], ['work_issue', 1], ['schema', 'public'], ['extra', true]]) {
    const contract = { ...JSON.parse(contractBytes), [key]: value };
    assert.throws(() => buildObservation({ ...valid, contractBytes: Buffer.from(JSON.stringify(contract)) }), failure);
  }
  for (const observedAt of ['2026-09-20', '2026-09-20T16:00:00Z', '2026-02-30T16:00:00.000Z', '', null]) {
    assert.throws(() => buildObservation({ ...valid, observedAt }), failure);
  }
});

test('reject every catalog mismatch, extra row, missing or duplicate pair', () => {
  for (const bad of [null, {}, [], rows.slice(1), [...rows, rows[0]], [rows[0], rows[0]]]) {
    assert.throws(() => validateCatalog(bad), failure);
  }
  for (const key of Object.keys(rows[0])) {
    const bad = structuredClone(rows); bad[0][key] = 'wrong';
    assert.throws(() => validateCatalog(bad), failure, key);
    delete bad[0][key]; assert.throws(() => validateCatalog(bad), failure, key);
  }
  for (const patch of [{ extra: true }, { nullable: false }, { has_default: true }, { nullable: 1 }, { type_schema: 'public' }]) {
    assert.throws(() => validateCatalog([{ ...rows[0], ...patch }, rows[1]]), failure);
  }
});

test('strict JSON rejects duplicate escaped keys, nonfinite numbers and deep nesting', () => {
  for (const bad of ['{"a":1,"a":2}', '{"a":{"x":1,"\\u0078":2}}', '[1e999]',
    '[NaN]', '{"x":1,}', '[1,]', '{} trailing', '"bad\nstring"', '['.repeat(18) + '0' + ']'.repeat(18)]) {
    assert.throws(() => parseStrictJson(bad), failure);
  }
  const good = ' {"q\\\"\\\\": [null,true,false,-1.25e2,{"a":"☺"}]} \n';
  assert.deepEqual(parseStrictJson(good), JSON.parse(good));
});

test('query uses one exact target, read_only, redirect refusal and abort signal', async () => {
  let calls = 0;
  const result = await queryCatalog(sqlBytes.toString('utf8'), 'test-only-token', {
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, QUERY_URL);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(options.headers, { Authorization: 'Bearer test-only-token', 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(options.body), { query: sqlBytes.toString('utf8'), read_only: true });
      return response();
    },
  });
  assert.equal(calls, 1); assert.deepEqual(result, rows);
});

test('302 off-host, 307 same-origin, failed HTTP and fetch errors refuse without retry', async () => {
  for (const [status, location] of [[302, 'https://attacker.invalid/'], [307, QUERY_URL], [401, ''], [500, '']]) {
    let calls = 0;
    await assert.rejects(queryCatalog('fixed sql', 'sentinel-secret', { fetchImpl: async () => {
      calls++; return new Response('SENSITIVE_RESPONSE', { status, headers: { location } });
    } }), error => error.message === 'SHARED_DB_2870_OBSERVATION_REFUSED');
    assert.equal(calls, 1);
  }
  await assert.rejects(queryCatalog('fixed sql', 'sentinel-secret', { fetchImpl: async () => {
    throw new Error('sentinel-secret SENSITIVE_RESPONSE');
  } }), error => error.message === 'SHARED_DB_2870_OBSERVATION_REFUSED');
  for (const patch of [{ redirected: true }, { url: 'https://attacker.invalid/' }]) {
    const redirected = response();
    for (const [key, value] of Object.entries(patch)) Object.defineProperty(redirected, key, { value });
    await assert.rejects(queryCatalog('fixed sql', 'token', { fetchImpl: async () => redirected }), failure);
  }
  for (const token of ['', undefined, 'x\r\ny']) {
    await assert.rejects(queryCatalog('fixed sql', token, { fetchImpl: () => assert.fail('must not fetch') }), failure);
  }
});

test('timeout aborts the request and bounds stalled body reads', async () => {
  let signal;
  await assert.rejects(queryCatalog('fixed sql', 'token', { timeoutMs: 10, fetchImpl: async (_url, options) => {
    signal = options.signal; return new Promise(() => {});
  } }), failure);
  assert.equal(signal.aborted, true);
  await assert.rejects(queryCatalog('fixed sql', 'token', { timeoutMs: 10, fetchImpl: async () =>
    new Response(new ReadableStream({ start() {} })) }), failure);
});

test('streaming byte limit, declared size, fatal UTF8 and malformed response fail closed', async () => {
  assert.equal((await readBounded(new Response(' '.repeat(MAX_RESPONSE_BYTES)))).length, MAX_RESPONSE_BYTES);
  for (const makeResponse of [
    () => new Response(' '.repeat(MAX_RESPONSE_BYTES + 1)),
    () => new Response('[]', { headers: { 'content-length': `${MAX_RESPONSE_BYTES + 1}` } }),
    () => new Response('[]', { headers: { 'content-length': 'wrong' } }),
    () => new Response(Uint8Array.of(0xc0, 0xaf)),
    () => new Response('{"data":[]}'),
    () => new Response(JSON.stringify(rows).replace('"nullable":true', '"nullable":false,"nullable":true')),
    () => new Response('SENSITIVE_RESPONSE'),
  ]) {
    await assert.rejects(queryCatalog('fixed sql', 'token', { fetchImpl: async () => makeResponse() }), failure);
  }
});

test('main writes only observation on success and never logs secret or returned metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'central-2870-test-'));
  const output = []; const log = message => output.push(message);
  try {
    const settings = { ...env, RUNNER_TEMP: directory, SUPABASE_ACCESS_TOKEN: 'sentinel-secret' };
    assert.equal(await main(settings, { fetchImpl: async () => response(), log, error: log }), 0);
    const files = await readdir(join(directory, 'shared-db-2870-observation'));
    assert.deepEqual(files, ['observation.json']);
    const actual = JSON.parse(await readFile(join(directory, 'shared-db-2870-observation/observation.json')));
    assert.deepEqual(actual.catalog, rows);
    assert.equal(actual.application_commit_sha, env.APPLICATION_COMMIT_SHA);
    assert.equal(await main(settings, { fetchImpl: async () => response(), log, error: log }), 1);
    assert.deepEqual(output, ['SHARED_DB_2870_OBSERVATION_CREATED', 'SHARED_DB_2870_OBSERVATION_REFUSED']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('main failure emits only fixed error and no artifact for every API refusal', async () => {
  for (const fetchImpl of [
    async () => new Response('SENSITIVE_RESPONSE', { status: 302, headers: { location: 'https://attacker.invalid/' } }),
    async () => new Response('SENSITIVE_RESPONSE', { status: 307, headers: { location: QUERY_URL } }),
    async () => new Response('SENSITIVE_RESPONSE'.repeat(MAX_RESPONSE_BYTES)),
    async () => { throw new Error('sentinel-secret SENSITIVE_RESPONSE'); },
    async () => new Response(JSON.stringify([{ ...rows[0], has_default: true }, rows[1]])),
  ]) {
    const directory = await mkdtemp(join(tmpdir(), 'central-2870-failure-'));
    const output = []; const log = message => output.push(message);
    try {
      assert.equal(await main({ ...env, RUNNER_TEMP: directory, SUPABASE_ACCESS_TOKEN: 'sentinel-secret' },
        { fetchImpl, log, error: log }), 1);
      assert.deepEqual(output, ['SHARED_DB_2870_OBSERVATION_REFUSED']);
      assert.deepEqual(await readdir(directory), []);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('main refuses invalid target context before any network access', async () => {
  const output = [];
  assert.equal(await main({ ...env, GITHUB_REF: 'refs/heads/other', RUNNER_TEMP: tmpdir(), SUPABASE_ACCESS_TOKEN: 'sentinel-secret' }, {
    fetchImpl: () => assert.fail('must not fetch'), error: message => output.push(message),
  }), 1);
  assert.deepEqual(output, ['SHARED_DB_2870_OBSERVATION_REFUSED']);
});

test('workflow scopes credential to manual-main query and pins every action', async () => {
  const yaml = await readFile(new URL('../../.github/workflows/shared-db-2870-observation.yml', import.meta.url), 'utf8');
  assert.match(yaml, /github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'/);
  assert.equal(yaml.match(/SUPABASE_ACCESS_TOKEN:/g).length, 1);
  assert.match(yaml, /compression-level: 0/);
  for (const line of yaml.split('\n').filter(line => line.includes('uses:'))) {
    assert.match(line, /uses: actions\/(?:checkout|upload-artifact)@[a-f0-9]{40}/);
  }
  assert.doesNotMatch(yaml, /\b(?:npm|op) |pull_request_target/);
});
