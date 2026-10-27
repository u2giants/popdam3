// Reusable bounded RLS read qualification. Source is public; credentials and reports are not.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { PRODUCTION_PROJECT_REF } from './lib/designflow-db-catalog.mjs';

const contractPath = new URL('./proofs/4874-read-resource.json', import.meta.url);
export const RESOURCE = Object.freeze(JSON.parse(fs.readFileSync(contractPath, 'utf8')));
const EXPECTED_WORKLOADS = [ ['profiles', 200], ['admin_config', 200], ['assets', 1000], ['style_groups', 1000] ];
export function requireCondition(ok, code) { if (!ok) { const error = new Error(code); error.safeCode = code; throw error; } }
export function workloadSQL(table, limit) {
  requireCondition(EXPECTED_WORKLOADS.some(w => w[0] === table && w[1] === limit), 'unapproved_workload');
  return `SELECT count(*)::integer AS bounded_count FROM (SELECT 1 FROM public.${table} LIMIT ${limit}) AS bounded`;
}
const numeric = new Set(['Startup Cost', 'Total Cost', 'Plan Rows', 'Plan Width', 'Actual Startup Time', 'Actual Total Time', 'Actual Rows', 'Actual Loops', 'Rows Removed by Filter', 'Rows Removed by Index Recheck', 'Heap Fetches', 'Shared Hit Blocks', 'Shared Read Blocks', 'Shared Dirtied Blocks', 'Shared Written Blocks', 'Local Hit Blocks', 'Local Read Blocks', 'Local Dirtied Blocks', 'Local Written Blocks', 'Temp Read Blocks', 'Temp Written Blocks', 'Planning Time', 'Execution Time', 'Workers Planned', 'Workers Launched']);
const relations = new Set([...EXPECTED_WORKLOADS.map(w => w[0]), 'user_roles']);
export function numericPlan(value, depth = 0) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value) && depth < 40, 'invalid_plan');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (numeric.has(key) && typeof item === 'number' && Number.isFinite(item)) result[key] = item;
    else if (key === 'Node Type' && typeof item === 'string' && /^[A-Za-z ]{1,60}$/.test(item)) result[key] = item;
    else if (key === 'Relation Name' && relations.has(item)) result[key] = item;
    else if (key === 'Schema' && item === 'public') result[key] = item;
    else if (key === 'Parent Relationship' && ['Outer', 'Inner', 'SubPlan', 'InitPlan', 'Member'].includes(item)) result[key] = item;
    else if (key === 'Subplan Name' && typeof item === 'string' && /^(?:InitPlan|SubPlan) \d+(?: \(returns \$\d+\))?$/.test(item)) result[key] = item;
    else if (key === 'Plan') result[key] = numericPlan(item, depth + 1);
    else if (key === 'Plans' && Array.isArray(item) && item.length < 1000) result[key] = item.map(p => numericPlan(p, depth + 1));
  }
  return result;
}
function summaryStats(samples) {
  const values = samples.map(s => s['Execution Time']).sort((a, b) => a - b);
  return { sample_count: values.length, median_ms: (values[4] + values[5]) / 2, p95_ms: values[9] };
}
export function validateResource(c) {
  requireCondition(c.project_ref === PRODUCTION_PROJECT_REF && c.pooler_host === 'aws-1-us-east-1.pooler.supabase.com' && c.pooler_port === 6543, 'target_contract_mismatch');
  requireCondition(c.migration_version === '20261021190604' && c.warmups === 1 && c.samples === 10, 'qualification_contract_mismatch');
  requireCondition(JSON.stringify(c.workloads.map(w => [w.table, w.limit])) === JSON.stringify(EXPECTED_WORKLOADS), 'workload_contract_mismatch');
  requireCondition(c.dependencies['@supabase/supabase-js'] === '2.97.0' && c.dependencies.pg === '8.23.1' && c.statement_timeout_ms === 15000 && c.lock_timeout_ms === 3000, 'runtime_contract_mismatch');
}
export async function qualify({ createClient, Client, versions, ca, publicKey, output, env = process.env, io = fs, now = () => Date.now(), resource = RESOURCE }) {
  const report = { schema_version: 1, phase: 'after', migration_version: resource.migration_version, passed: false, workloads: [] };
  let fd, db, client, signedIn = false, transaction = false, stage = 'preflight';
  try {
    validateResource(resource);
    requireCondition(versions.sdk === '2.97.0' && versions.pg === '8.23.1', 'dependency_version_mismatch');
    requireCondition(typeof output === 'string' && path.isAbsolute(output), 'absolute_output_required');
    requireCondition(typeof publicKey === 'string' && publicKey.startsWith('sb_publishable_') && ca?.length > 0, 'public_config_or_ca_missing');
    requireCondition(env.QA_EMAIL && env.QA_PASSWORD && env.PROD_DB_PASSWORD, 'protected_environment_missing');
    // Reserve the only output before authentication so failures cannot overwrite evidence.
    fd = io.openSync(output, io.constants.O_WRONLY | io.constants.O_CREAT | io.constants.O_EXCL | io.constants.O_NOFOLLOW, 0o600);
    const stat = io.fstatSync(fd);
    requireCondition(stat.isFile() && (stat.mode & 0o777) === 0o600 && (typeof io.getuid !== 'function' || stat.uid === io.getuid()), 'unsafe_output_file');
    const apiURL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
    stage = 'normal_login';
    client = createClient(apiURL, publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) } });
    const login = await client.auth.signInWithPassword({ email: env.QA_EMAIL, password: env.QA_PASSWORD });
    delete env.QA_EMAIL; delete env.QA_PASSWORD;
    signedIn = Boolean(login.data?.session?.access_token);
    requireCondition(!login.error && signedIn, 'normal_login_failed');
    stage = 'server_identity';
    const token = login.data.session.access_token;
    const user = await client.auth.getUser(token);
    requireCondition(!user.error && user.data?.user?.id && user.data.user.id === login.data.user?.id, 'server_identity_mismatch');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    requireCondition(claims.iss === `${apiURL}/auth/v1` && claims.sub === user.data.user.id && claims.role === 'authenticated' && user.data.user.role === 'authenticated', 'jwt_target_subject_role_mismatch');
    requireCondition(Number.isFinite(claims.exp) && claims.exp * 1000 > now() + 120000, 'jwt_expiry_too_close');
    const roles = await client.from('user_roles').select('role').eq('user_id', user.data.user.id).limit(10);
    requireCondition(!roles.error && Array.isArray(roles.data) && roles.data.some(r => r.role === 'admin'), 'administrator_required');
    report.server_identity_verified = true;
    stage = 'connection';
    db = new Client({ host: resource.pooler_host, port: resource.pooler_port, user: `postgres.${PRODUCTION_PROJECT_REF}`, database: 'postgres', password: env.PROD_DB_PASSWORD, ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 12000 });
    delete env.PROD_DB_PASSWORD;
    await db.connect();
    transaction = true; // A lost BEGIN receipt still requires rollback/close.
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL default_transaction_read_only='on'");
    const identity = (await db.query("SELECT current_setting('transaction_read_only') AS ro, current_setting('default_transaction_read_only') AS default_ro, current_database() AS database_name, current_setting('supabase.project_ref', true) AS project_ref")).rows[0];
    requireCondition(identity.ro === 'on' && identity.default_ro === 'on' && identity.database_name === 'postgres' && (!identity.project_ref || identity.project_ref === PRODUCTION_PROJECT_REF), 'database_target_or_readonly_mismatch');
    await db.query("SET LOCAL statement_timeout='15s'");
    await db.query("SET LOCAL lock_timeout='3s'");
    const ledger = async () => (await db.query('SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=$1) AS present', [resource.migration_version])).rows[0].present;
    requireCondition(await ledger() === true, 'installed_migration_required');
    // Only the FULL server-validated JWT context is installed; no invented claims.
    await db.query("SELECT set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claim','',true), set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    await db.query('SET LOCAL ROLE authenticated');
    const actor = (await db.query(`SELECT current_user AS actor, r.rolsuper, r.rolbypassrls, current_setting('transaction_read_only') AS ro,
      auth.uid()=$1::uuid AS subject_matches, public.has_role(auth.uid(),'admin'::public.app_role) AS public_admin,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($2::text[]) AND c.relowner=r.oid) AS owns_target
      FROM pg_roles r WHERE r.rolname=current_user`, [claims.sub, EXPECTED_WORKLOADS.map(w => w[0])])).rows[0];
    requireCondition(actor?.actor === 'authenticated' && actor.rolsuper === false && actor.rolbypassrls === false && actor.owns_target === false && actor.ro === 'on' && actor.subject_matches === true && actor.public_admin === true, 'authenticated_nonowner_required');
    report.database_read_only = true; report.authenticated_role_nonowner_nonbypass = true;
    for (const w of resource.workloads) {
      stage = `read_${w.table}`;
      const sql = workloadSQL(w.table, w.limit);
      const count = (await db.query(sql)).rows[0].bounded_count;
      requireCondition(Number.isInteger(count) && count >= 0 && count <= w.limit, 'invalid_bounded_count');
      const item = { table: w.table, row_limit: w.limit, bounded_count: count, samples: [] };
      for (let i = 0; i < 11; i++) {
        requireCondition(claims.exp * 1000 > now() + 30000, 'jwt_expired_during_samples');
        const plans = (await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + sql)).rows[0]['QUERY PLAN'];
        requireCondition(Array.isArray(plans) && plans.length === 1 && Number.isFinite(plans[0]['Execution Time']), 'invalid_explain');
        const clean = numericPlan(plans[0]);
        if (i === 0) item.warmup = clean; else item.samples.push(clean);
      }
      Object.assign(item, summaryStats(item.samples)); report.workloads.push(item);
    }
    await db.query('RESET ROLE');
    requireCondition(await ledger() === true, 'ledger_changed_during_samples');
    report.passed = true;
  } catch (error) {
    report.failure = { stage, code: error.safeCode ?? 'qualification_refused' };
  } finally {
    if (db && transaction) { try { await db.query('ROLLBACK'); } catch { report.rollback_failed = true; report.passed = false; } }
    if (db) { try { await db.end(); } catch { report.close_failed = true; report.passed = false; } }
    if (client && signedIn) { try { const result = await client.auth.signOut({ scope: 'local' }); report.local_signout_ok = !result.error; if (result.error) report.passed = false; } catch { report.local_signout_ok = false; report.passed = false; } }
    delete env.QA_EMAIL; delete env.QA_PASSWORD; delete env.PROD_DB_PASSWORD; delete env.SUPABASE_PUBLISHABLE_KEY;
    report.observed_at = new Date(now()).toISOString();
    if (fd !== undefined) { try { io.writeFileSync(fd, JSON.stringify(report) + '\n'); io.fsyncSync(fd); } catch { report.output_failed = true; report.passed = false; } finally { try { io.closeSync(fd); } catch { report.passed = false; } } }
  }
  return report;
}
async function main() {
  // The gate approval must bind this NEW source HEAD and the resource contract.
  const args = process.argv.slice(2);
  requireCondition(args.length === 4 && args[0] === '--reviewer-approval' && args[2] === '--output', 'usage_refused');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const gate = spawnSync('ai-task-gates', ['check', '--before', 'database', '--reviewer-approval', args[1]], { cwd: root, stdio: 'ignore' });
  requireCondition(gate.status === 0, 'native_database_gate_refused');
  const load = (variable, name) => { const directory = process.env[variable]; requireCondition(directory && path.isAbsolute(directory), 'runtime_directory_required'); const require = createRequire(path.join(directory, 'package.json')); return { module: require(name), version: require(name + '/package.json').version }; };
  const sdk = load('RLS_SDK_ROOT', '@supabase/supabase-js'); const pg = load('RLS_PG_ROOT', 'pg');
  requireCondition(process.env.RLS_CA_FILE && path.isAbsolute(process.env.RLS_CA_FILE), 'ca_file_required');
  const report = await qualify({ createClient: sdk.module.createClient, Client: pg.module.Client, versions: { sdk: sdk.version, pg: pg.version }, ca: fs.readFileSync(process.env.RLS_CA_FILE), publicKey: process.env.SUPABASE_PUBLISHABLE_KEY, output: args[3] });
  console.log(JSON.stringify({ passed: report.passed, workloads: report.workloads.length, plans: report.workloads.reduce((n, w) => n + w.samples.length + 1, 0) }));
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => { console.log(JSON.stringify({ passed: false })); process.exitCode = 1; });
