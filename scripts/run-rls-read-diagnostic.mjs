import {run,requireReadonlyDiagnosticEnvironment} from './rls-library-live-proof.mjs';
import {BROWSER_PACKAGE} from './rls-browser-custody.mjs';
// One fixed readonly route: no fixture/SDK/PG imports or caller-controlled mode.
try {
  requireReadonlyDiagnosticEnvironment(process.env);
  const env = {
    POPDAM_ACCEPTANCE_BASE_URL:'https://dam.designflow.app',
    SUPABASE_PROJECT_ID:'qsllyeztdwjgirsysgai',
    DEPLOYED_FRONTEND_SHA:'eb405c02479f1d76b319f2f2e89150493bcade45',
    POPDAM_PLAYWRIGHT_PACKAGE:BROWSER_PACKAGE,
    POPDAM_PROOF_FILE:'/tmp/popdam-4427-read-diagnostic-private-01a17a03/proof.json',
    POPDAM_TEST_USER:process.env.POPDAM_TEST_USER,
    POPDAM_TEST_PASSWORD:process.env.POPDAM_TEST_PASSWORD,
  };
  delete process.env.POPDAM_TEST_USER;
  delete process.env.POPDAM_TEST_PASSWORD;
  const report = await run(env, null);
  delete env.POPDAM_TEST_USER;
  delete env.POPDAM_TEST_PASSWORD;
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
} catch { console.error('FAIL: bounded readonly diagnostic or private receipt'); process.exitCode = 1; }
