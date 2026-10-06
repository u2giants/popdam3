// Same-issue catalog observation; backend acceptance remains a separate artifact.
// Owner: shared-db #2874. Retire this adapter after its acceptance is archived.
// Reuse the existing bounded JSON/response readers without changing #2870.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import expected from './2874-contract.json' with { type: 'json' };
import { PROJECT, QUERY_URL, parseStrictJson, readBounded, digest, positiveId } from './shared-db-2870-observation.mjs';
export const WORKFLOW = '.github/workflows/shared-db-2874-observation.yml';
const FAIL = 'SHARED_DB_2874_OBSERVATION_REFUSED';
const SHA = /^[a-f0-9]{40}$/;
const refuse = () => { throw new Error(FAIL); };
export function validateCatalog(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]
      || Object.keys(rows[0]).join('|') !== 'catalog'
      || !isDeepStrictEqual(rows[0].catalog, expected.catalog)) refuse();
  return rows;
}
export function validateEnvironment(env) {
  if (env.GITHUB_REPOSITORY !== 'popcre/shared-db' || env.GITHUB_REF !== 'refs/heads/main'
      || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || env.GITHUB_WORKFLOW_REF !== `popcre/shared-db/${WORKFLOW}@refs/heads/main`
      || !SHA.test(env.GITHUB_SHA ?? '') || !SHA.test(env.APPLICATION_COMMIT_SHA ?? '')) refuse();
  return { producer_commit_sha: env.GITHUB_SHA, producer_run_id: positiveId(env.GITHUB_RUN_ID),
    producer_run_attempt: positiveId(env.GITHUB_RUN_ATTEMPT), application_commit_sha: env.APPLICATION_COMMIT_SHA };
}
export async function queryCatalog(sql, token, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) refuse();
  const controller = new AbortController(); let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(FAIL)); }, timeoutMs);
  });
  try {
    return await Promise.race([expired, (async () => {
      const response = await fetchImpl(QUERY_URL, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, read_only: true }) });
      if (![200,201].includes(response.status) || response.redirected || (response.url && response.url !== QUERY_URL)) refuse();
      return validateCatalog(parseStrictJson(await readBounded(response)));
    })()]);
  } catch { refuse(); } finally { clearTimeout(timer); controller.abort(); }
}
export function buildObservation({rows,env,sqlBytes,contractBytes,observedAt}) {
  const identity = validateEnvironment(env);
  if (expected.project_ref !== PROJECT || !isDeepStrictEqual(parseStrictJson(contractBytes.toString('utf8')), expected)
      || typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))
      || new Date(observedAt).toISOString() !== observedAt) refuse();
  const observation = { schema_version:1, work_issue:2874, project_ref:PROJECT,
    live_assertion:expected.live_assertion, observed_at:observedAt,
    producer_repository:'popcre/shared-db', producer_commit_sha:identity.producer_commit_sha,
    producer_workflow:WORKFLOW, producer_run_id:identity.producer_run_id, producer_run_attempt:identity.producer_run_attempt,
    application_repository:expected.application_repository, application_commit_sha:identity.application_commit_sha,
    sql_sha256:digest(sqlBytes), contract_sha256:digest(contractBytes), catalog:validateCatalog(rows) };
  const bytes = Buffer.from(JSON.stringify(observation)+'\n'); if (bytes.length>8192) refuse(); return bytes;
}
export async function main(env=process.env,{fetchImpl=fetch,log=console.log,error=console.error}={}) {
  try {
    validateEnvironment(env); if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP)) refuse();
    const sqlBytes=await readFile(new URL('./2874-catalog.sql',import.meta.url));
    const contractBytes=await readFile(new URL('./2874-contract.json',import.meta.url));
    if (!isDeepStrictEqual(parseStrictJson(contractBytes.toString('utf8')),expected)) refuse();
    const rows=await queryCatalog(new TextDecoder('utf-8',{fatal:true}).decode(sqlBytes),env.SUPABASE_ACCESS_TOKEN,{fetchImpl});
    const bytes=buildObservation({rows,env,sqlBytes,contractBytes,observedAt:new Date().toISOString()});
    const directory=join(env.RUNNER_TEMP,'shared-db-2874-observation'); await mkdir(directory);
    await writeFile(join(directory,'observation.json'),bytes,{flag:'wx',mode:0o600});
    log('SHARED_DB_2874_OBSERVATION_CREATED'); return 0;
  } catch { error(FAIL); return 1; }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) process.exitCode=await main();
