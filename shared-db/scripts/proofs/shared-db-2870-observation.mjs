// Fixed catalog observation for #2870. No application data or application acceptance.
// Owned by shared-db; retire after the backend's acceptance evidence is archived.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT = 'qsllyeztdwjgirsysgai';
export const WORKFLOW = '.github/workflows/shared-db-2870-observation.yml';
export const QUERY_URL = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;
export const MAX_RESPONSE_BYTES = 1048576;
export const MAX_OBSERVATION_BYTES = 8192;
const FAIL = 'SHARED_DB_2870_OBSERVATION_REFUSED';
const SHA = /^[a-f0-9]{40}$/;
const EXPECTED_CONTRACT = {
  work_issue: 2870,
  source_repository: 'popcre/shared-db',
  application_repository: 'popcre/designflow-backend',
  application_branch: 'develop',
  project_ref: PROJECT,
  schema: 'dflow_prod',
  live_assertion: 'production dflow_prod users.app_profile_id and comments.app_comment_id exist as nullable uuid columns',
  columns: { comments: 'app_comment_id', users: 'app_profile_id' },
};
function refuse() { throw new Error(FAIL); }
export function digest(bytes) { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }
export function positiveId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) refuse();
  return Number(value);
}

// JSON.parse alone silently accepts duplicate keys. Scan every object first,
// with bounded nesting; then use the platform parser for full JSON grammar.
export function parseStrictJson(text) {
  let offset = 0;
  function space() { while (/[\x20\t\r\n]/.test(text[offset] ?? '\0')) offset++; }
  function string() {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') offset++;
      else if (char === '"') return JSON.parse(text.slice(start, offset));
    }
    refuse();
  }
  function value(depth) {
    if (depth > 16) refuse();
    space();
    if (text[offset] === '"') { string(); return; }
    if (text[offset] === '{') {
      offset++; space();
      const keys = new Set();
      if (text[offset] === '}') { offset++; return; }
      while (offset < text.length) {
        space(); if (text[offset] !== '"') refuse();
        const key = string(); if (keys.has(key)) refuse(); keys.add(key);
        space(); if (text[offset++] !== ':') refuse();
        value(depth + 1); space();
        const separator = text[offset++];
        if (separator === '}') return;
        if (separator !== ',') refuse();
      }
      refuse();
    }
    if (text[offset] === '[') {
      offset++; space();
      if (text[offset] === ']') { offset++; return; }
      while (offset < text.length) {
        value(depth + 1); space();
        const separator = text[offset++];
        if (separator === ']') return;
        if (separator !== ',') refuse();
      }
      refuse();
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));
    if (!match) refuse();
    if (/^-?[0-9]/.test(match[0]) && !Number.isFinite(Number(match[0]))) refuse();
    offset += match[0].length;
  }
  try {
    value(0); space(); if (offset !== text.length) refuse();
    return JSON.parse(text);
  } catch { refuse(); }
}

export function validateCatalog(rows) {
  if (!Array.isArray(rows) || rows.length !== 2) refuse();
  const expected = Object.entries(EXPECTED_CONTRACT.columns).map(([table_name, column_name]) => ({
    schema_name: 'dflow_prod', table_name, column_name, data_type: 'uuid',
    type_schema: 'pg_catalog', nullable: true, has_default: false,
  }));
  // Compare each whole object, not just asserted fields; missing/extra keys fail.
  for (const row of expected) if (rows.filter(candidate => isDeepStrictEqual(candidate, row)).length !== 1) refuse();
  return expected;
}

export function validateEnvironment(env) {
  if (env.GITHUB_REPOSITORY !== 'popcre/shared-db' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_WORKFLOW_REF !== `popcre/shared-db/${WORKFLOW}@refs/heads/main`
    || !SHA.test(env.GITHUB_SHA ?? '') || !SHA.test(env.APPLICATION_COMMIT_SHA ?? '')) refuse();
  return {
    producer_commit_sha: env.GITHUB_SHA,
    producer_run_id: positiveId(env.GITHUB_RUN_ID),
    producer_run_attempt: positiveId(env.GITHUB_RUN_ATTEMPT),
    application_commit_sha: env.APPLICATION_COMMIT_SHA,
  };
}

export async function readBounded(response) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) refuse();
  if (!response.body) refuse();
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) refuse();
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) refuse();
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch { void reader.cancel().catch(() => {}); refuse(); }
  finally { reader.releaseLock(); }
}

export async function queryCatalog(sql, token, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) refuse();
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(FAIL)); }, timeoutMs);
  });
  try {
    return await Promise.race([expired, (async () => {
      const response = await fetchImpl(QUERY_URL, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, read_only: true }),
      });
      if (response.status !== 200 || response.redirected || (response.url && response.url !== QUERY_URL)) refuse();
      return validateCatalog(parseStrictJson(await readBounded(response)));
    })()]);
  } catch { refuse(); }
  finally { clearTimeout(timer); controller.abort(); }
}

export function buildObservation({ rows, env, sqlBytes, contractBytes, observedAt }) {
  const identity = validateEnvironment(env);
  const contract = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(contractBytes));
  if (!isDeepStrictEqual(contract, EXPECTED_CONTRACT)) refuse();
  if (typeof observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt)
    || !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) refuse();
  const observation = {
    schema_version: 1, work_issue: 2870, project_ref: PROJECT,
    live_assertion: contract.live_assertion, observed_at: observedAt,
    producer_repository: 'popcre/shared-db', producer_commit_sha: identity.producer_commit_sha,
    producer_workflow: WORKFLOW, producer_run_id: identity.producer_run_id,
    producer_run_attempt: identity.producer_run_attempt,
    application_repository: contract.application_repository,
    application_commit_sha: identity.application_commit_sha,
    sql_sha256: digest(sqlBytes), contract_sha256: digest(contractBytes), catalog: validateCatalog(rows),
  };
  const bytes = Buffer.from(`${JSON.stringify(observation)}\n`);
  if (bytes.length > MAX_OBSERVATION_BYTES) refuse();
  return bytes;
}

export async function main(env = process.env, dependencies = {}) {
  const { fetchImpl = fetch, log = console.log, error = console.error } = dependencies;
  try {
    validateEnvironment(env);
    if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP)) refuse();
    const sqlBytes = await readFile(new URL('./2870-catalog.sql', import.meta.url));
    const contractBytes = await readFile(new URL('./2870-contract.json', import.meta.url));
    // Validate committed contract before touching the credential or network.
    if (!isDeepStrictEqual(parseStrictJson(contractBytes.toString('utf8')), EXPECTED_CONTRACT)) refuse();
    const sql = new TextDecoder('utf-8', { fatal: true }).decode(sqlBytes);
    const rows = await queryCatalog(sql, env.SUPABASE_ACCESS_TOKEN, { fetchImpl });
    const bytes = buildObservation({ rows, env, sqlBytes, contractBytes, observedAt: new Date().toISOString() });
    // A fresh directory plus exclusive file creation prevents stale evidence reuse.
    const directory = join(env.RUNNER_TEMP, 'shared-db-2870-observation');
    await mkdir(directory);
    await writeFile(join(directory, 'observation.json'), bytes, { flag: 'wx', mode: 0o600 });
    log('SHARED_DB_2870_OBSERVATION_CREATED');
    return 0;
  } catch { error(FAIL); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
