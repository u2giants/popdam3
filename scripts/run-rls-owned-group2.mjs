import {readFileSync, lstatSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {run} from './rls-library-live-proof.mjs';
import {MANIFEST_SHA256,digest,validateManifest,protectedCounts,createFixtureProtocol} from './rls-owned-fixture.mjs';

// One prospective manifest only; no user-supplied SQL/UUID/table/module paths.
const manifestFile = '/tmp/4427-prospective-group2-01a17b07.json';
let client, protocol;
try {
  const stat = lstatSync(manifestFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) || realpathSync(manifestFile) !== manifestFile) throw new Error('private manifest');
  const bytes = readFileSync(manifestFile);
  if (digest(bytes) !== MANIFEST_SHA256) throw new Error('manifest pin');
  const m = validateManifest(JSON.parse(bytes));
  if (m.sdk_root !== '/tmp/admin4427-lesc6qjq/api-deps' || m.pg_root !== '/home/ahazan/.codex/tmp/rls-resume-01a14fa2') throw new Error('runtime roots');
  if (m.ca_file !== '/home/ahazan/.codex/tmp/rls-resume-01a14fa2/prod-ca-2021.crt' || m.deployed_sha !== process.env.DEPLOYED_FRONTEND_SHA) throw new Error('resource pin');
  if (digest(readFileSync(m.runtime_attestation_file)) !== m.runtime_attestation_sha256 || digest(readFileSync(m.official_registry_report_file)) !== m.official_registry_report_sha256) throw new Error('runtime source attestation');
  const sdkRequire = createRequire(`${m.sdk_root}/package.json`), pgRequire = createRequire(`${m.pg_root}/package.json`);
  if (sdkRequire('@supabase/supabase-js/package.json').version !== m.dependencies.sdk || pgRequire('pg/package.json').version !== m.dependencies.pg) throw new Error('runtime versions');
  const {createClient} = sdkRequire('@supabase/supabase-js'), {Client} = pgRequire('pg');
  const ca = readFileSync(m.ca_file);
  if (digest(ca) !== m.ca_sha256) throw new Error('CA pin');
  if (m.owner_session !== '01a17a03-63b6-7081-ab54-29fa144bf678' || m.owner_machine !== 'edge-dev3' || m.deployed_sha !== 'eb405c02479f1d76b319f2f2e89150493bcade45' || m.public_bundle_sha256 !== '103592793cc91129f1b60f49179549d8f82af284a9be6208917bf6f4394638ee') throw new Error('prospective group2 ownership/build');
  const env = Object.fromEntries(['POPDAM_TEST_USER','POPDAM_TEST_PASSWORD','PROD_DB_PASSWORD','SUPABASE_PUBLISHABLE_KEY','POPDAM_ACCEPTANCE_BASE_URL','SUPABASE_PROJECT_ID','DEPLOYED_FRONTEND_SHA','POPDAM_PLAYWRIGHT_PACKAGE','PLAYWRIGHT_BROWSERS_PATH','POPDAM_PROOF_FILE'].map(k=>[k,process.env[k]]));
  env.POPDAM_PROOF_FILE = '/tmp/popdam-4427-owned-group2-private-01a17a03/fixture-proof.json';
  for (const key of ['POPDAM_TEST_USER','POPDAM_TEST_PASSWORD','PROD_DB_PASSWORD','SUPABASE_PUBLISHABLE_KEY']) delete process.env[key];
  if (env.POPDAM_TEST_USER !== 'ai-admin@designflow.app' || !env.POPDAM_TEST_PASSWORD || !env.PROD_DB_PASSWORD || !env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) throw new Error('protected environment');
  client = createClient(`https://${m.project}.supabase.co`,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  protocol = createFixtureProtocol({client,manifest:m,credentials:{email:env.POPDAM_TEST_USER,password:env.POPDAM_TEST_PASSWORD},counts:()=>protectedCounts({Client,password:env.PROD_DB_PASSWORD,ca,manifest:m})});
  const report = await run(env,protocol);
  for (const key of ['POPDAM_TEST_USER','POPDAM_TEST_PASSWORD','PROD_DB_PASSWORD','SUPABASE_PUBLISHABLE_KEY']) delete env[key];
  console.log(JSON.stringify(report)); if (!report.passed) process.exitCode = 1;
} catch { console.error('FAIL: owned fixture qualification; inspect private receipt or pending fixture manifest'); process.exitCode = 1; }
finally {
  if (client && protocol?.summary().sdk_auth_attempted && !protocol.summary().sdk_signed_out) {
    try { const result = await client.auth.signOut({scope:'local'}); if (result.error) process.exitCode = 1; } catch { process.exitCode = 1; }
  }
}
