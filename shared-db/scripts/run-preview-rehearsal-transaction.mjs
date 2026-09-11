#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const PRODUCTION_PROJECT_REF = 'qsllyeztdwjgirsysgai'

// libpq reads the WHOLE URI, not just its authority. `?host=`, `?hostaddr=`,
// `?user=` and `?port=` in the query silently OVERRIDE the host and user this
// script would otherwise check, so a URL whose authority names preview can still
// connect to production. The overrides are refused outright rather than parsed,
// and the identity that must prove the preview ref is built from every part of
// the URI, casefolded, with an empty host refused so libpq cannot fall back to
// an inherited PGHOST. (External review, grok-4.6, PR #1951.)
const CONNECTION_OVERRIDE_PARAMS = ['host', 'hostaddr', 'user', 'port', 'dbname', 'service', 'passfile']

export function validateRehearsal({ projectRef, fixtureId, databaseUrl, sql }) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new Error('project ref must be exactly 20 lowercase letters')
  if (projectRef === PRODUCTION_PROJECT_REF) throw new Error(`refusing production project ${PRODUCTION_PROJECT_REF}`)
  if (!/^AI-PERF-[0-9]{8}-[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/.test(fixtureId ?? '')) throw new Error('fixture id must use AI-PERF-YYYYMMDD-name')
  let parsed
  try { parsed=new URL(databaseUrl) } catch { throw new Error('SUPABASE_DB_URL is not a valid PostgreSQL URL') }
  if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw new Error('SUPABASE_DB_URL is not a PostgreSQL URL')
  if (!parsed.hostname) throw new Error('SUPABASE_DB_URL names no host, so libpq would choose the target from the environment')
  for (const [key] of parsed.searchParams) {
    if (CONNECTION_OVERRIDE_PARAMS.includes(key.toLowerCase())) throw new Error(`SUPABASE_DB_URL parameter ${key} can redirect the connection and is refused`)
  }
  if (parsed.hash) throw new Error('SUPABASE_DB_URL carries a fragment, which this guard cannot account for')
  let identity
  try { identity=decodeURIComponent(`${parsed.username} ${parsed.hostname} ${parsed.pathname} ${parsed.search}`).toLowerCase() }
  catch { throw new Error('SUPABASE_DB_URL is not decodable and cannot be proved') }
  if (identity.includes(PRODUCTION_PROJECT_REF)) throw new Error(`refusing a connection identity that names production ${PRODUCTION_PROJECT_REF}`)
  const exactRef=new RegExp(`(^|[^a-z])${projectRef}([^a-z]|$)`)
  if (!exactRef.test(identity)) throw new Error('SUPABASE_DB_URL does not prove the requested preview project ref in its host or user identity')
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('rehearsal SQL is empty')
  const stripped = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
  // psql honours a meta-command after a semicolon as readily as at the start of
  // a line, and `\connect` after the transaction has ended opens a NEW
  // autocommit session that this guard never inspected. A rehearsal fixture has
  // no legitimate use for a backslash, so every backslash is refused.
  if (stripped.includes('\\')) throw new Error('psql meta-commands are not allowed in rehearsal SQL')
  if (/\b(begin|start\s+transaction|commit|rollback|savepoint|release\s+savepoint|prepare\s+transaction)\b/i.test(stripped)) throw new Error('rehearsal SQL cannot control its transaction')
  // END and ABORT are PostgreSQL's own synonyms for COMMIT and ROLLBACK. Matched
  // only in statement position so `case ... end` stays legal.
  if (/(?:^|;)\s*(?:end|abort)\b/i.test(stripped)) throw new Error('rehearsal SQL cannot end its transaction with END or ABORT')
  if (/\b(vacuum|alter\s+system|create\s+database|drop\s+database|reindex\s+[^;]*\bconcurrently\b)\b/i.test(stripped)) throw new Error('rehearsal SQL contains a statement that cannot be safely rolled back')
}

export function buildRehearsalSql({ projectRef, fixtureId, sql }) {
  const safeFixture = fixtureId.replaceAll("'", "''")
  return `\\set ON_ERROR_STOP on
\\echo TARGET_PROOF preview=${projectRef} production_refused=${PRODUCTION_PROJECT_REF}
BEGIN;
SET LOCAL statement_timeout = '30min';
SET LOCAL lock_timeout = '10s';
SELECT set_config('app.fixture_id', '${safeFixture}', true);
SELECT set_config('app.rehearsal_open', '1', true);
${sql.trim()}
-- PROOF THE TRANSACTION IS STILL OPEN. app.rehearsal_open was set with
-- is_local = true, so it exists only for the lifetime of the transaction opened
-- above. If the fixture ended that transaction by any means, this statement runs
-- in a new one, current_setting raises an unrecognized configuration parameter,
-- ON_ERROR_STOP aborts, and the run fails instead of printing a rollback that
-- did not happen. (External review, grok-4.6, PR #1951.)
SELECT current_setting('app.rehearsal_open');
ROLLBACK;
\\echo REHEARSAL_ROLLED_BACK fixture=${fixtureId}
`
}

export function parseArgs(argv) {
  const out = {}
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i]
    if (arg==='--project-ref') out.projectRef=argv[++i]
    else if (arg==='--fixture-id') out.fixtureId=argv[++i]
    else if (arg==='--sql-file') out.sqlFile=argv[++i]
    else throw new Error(`unknown argument ${arg}`)
  }
  if (!out.projectRef || !out.fixtureId || !out.sqlFile) throw new Error('--project-ref, --fixture-id, and --sql-file are required')
  return out
}

export function main(argv=process.argv.slice(2), env=process.env) {
  const options=parseArgs(argv)
  const sql=readFileSync(options.sqlFile,'utf8')
  const databaseUrl=env.SUPABASE_DB_URL
  validateRehearsal({...options,databaseUrl,sql})
  const wrapped=buildRehearsalSql({...options,sql})
  console.log(`TARGET PROOF: preview ${options.projectRef}; production ${PRODUCTION_PROJECT_REF} refused; fixture ${options.fixtureId}`)
  const childEnv={...env,PGDATABASE:databaseUrl}
  delete childEnv.SUPABASE_DB_URL
  // The URI in PGDATABASE is the only destination this run has proved. Any other
  // libpq variable inherited from the caller could name a different one, so they
  // are removed rather than trusted. (External review, grok-4.6, PR #1951.)
  for (const key of Object.keys(childEnv)) {
    if (/^PG/.test(key) && key !== 'PGDATABASE') delete childEnv[key]
  }
  const result=spawnSync('psql',['--no-psqlrc','--file','-'],{input:wrapped,stdio:['pipe','inherit','inherit'],env:childEnv})
  if (result.error) throw result.error
  if (result.status!==0) throw new Error(`rehearsal failed with exit ${result.status}; no rehearsal statement was committed`)
  return 0
}

if (import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { process.exitCode=main() } catch (error) { console.error(`REFUSED: ${error.message}`); process.exitCode=1 }
}
