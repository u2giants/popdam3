import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BROWSER_PACKAGE,rejectBrowserOverrides,safeMetadata,compareInventory,fixedBrowserEnvironment,requirePackageIdentity} from './rls-browser-custody.mjs';
import {requireSmokeEnvironment} from './rls-browser-smoke.mjs';
import {browserEnvironment,run} from './rls-library-live-proof.mjs';
const hash='a'.repeat(64);
test('package inventory rejects changed, missing, extra and malformed bytes',()=>{
  compareInventory({'package.json':hash},{'package.json':hash});
  for(const actual of [{},{'package.json':'b'.repeat(64)},{'package.json':hash,extra:hash}]) assert.throws(()=>compareInventory({'package.json':hash},actual));
  assert.throws(()=>compareInventory({'package.json':'wrong'},{'package.json':'wrong'}));
});
test('app package identity refuses another name or version rather than upgrading',()=>{
  requirePackageIdentity('playwright',{name:'playwright',version:'1.56.1'});
  for(const metadata of [{name:'playwright',version:'1.62.1'},{name:'other',version:'1.56.1'}])assert.throws(()=>requirePackageIdentity('playwright',metadata));
});
test('custody rejects foreign-owned/writable/symlink metadata and non-root Chrome',()=>{
  const metadata=(overrides={})=>({uid:process.getuid(),mode:0o100644,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,...overrides});
  safeMetadata(metadata());safeMetadata(metadata({uid:0}),{rootOwned:true});
  for(const stat of [metadata({uid:99999}),metadata({mode:0o100666}),metadata({isSymbolicLink:()=>true})]) assert.throws(()=>safeMetadata(stat));
  assert.throws(()=>safeMetadata(metadata({uid:99999}),{rootOwned:true}));
});
test('arbitrary browser paths/channel/distro/environment overrides are rejected',()=>{
  rejectBrowserOverrides({});
  for(const key of ['PLAYWRIGHT_BROWSERS_PATH','PLAYWRIGHT_HOST_PLATFORM_OVERRIDE','PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH','CHROME_PATH','CHROMIUM_PATH','NODE_OPTIONS','HTTP_PROXY']) assert.throws(()=>rejectBrowserOverrides({[key]:'injected'}));
  assert.throws(()=>browserEnvironment({POPDAM_PLAYWRIGHT_PACKAGE:'/tmp/other-runtime'}));
  assert.deepEqual(browserEnvironment({POPDAM_PLAYWRIGHT_PACKAGE:BROWSER_PACKAGE}),fixedBrowserEnvironment());
});
test('local smoke refuses every QA/DB/OP/proxy variable before any browser action',()=>{
  const env=fixedBrowserEnvironment();requireSmokeEnvironment(env);
  for(const key of ['POPDAM_TEST_PASSWORD','PROD_DB_PASSWORD','OP_SERVICE_ACCOUNT_TOKEN','HTTP_PROXY','NODE_OPTIONS','SUPABASE_PUBLISHABLE_KEY']) assert.throws(()=>requireSmokeEnvironment({...env,[key]:'CANARY'}));
});
test('source execution order keeps local capability before SDK auth/fixture writes',()=>{
  const run=fs.readFileSync(new URL('./rls-library-live-proof.mjs',import.meta.url),'utf8');
  assert(run.indexOf('await openQualifiedBlankBrowser')<run.indexOf('await fixture.prepare()'));
  const entry=fs.readFileSync(new URL('./run-rls-owned-fixture.mjs',import.meta.url),'utf8');
  assert.equal(entry.includes('await client.auth.signInWithPassword'),false);
  const helper=fs.readFileSync(new URL('./rls-browser-custody.mjs',import.meta.url),'utf8');
  assert(helper.includes("channel:'chrome'"));assert.equal(helper.includes('executablePath:'),false);
});
test('actual local-custody failure cannot call SDK authentication or fixture preparation',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'4427-before-fixture-'));fs.chmodSync(directory,0o700);
  const old=process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE='REJECT_UNIT_OVERRIDE';
  let prepared=0;
  try {
    const report=await run({POPDAM_ACCEPTANCE_BASE_URL:'https://dam.designflow.app',SUPABASE_PROJECT_ID:'qsllyeztdwjgirsysgai',POPDAM_TEST_USER:'ai-admin@designflow.app',POPDAM_TEST_PASSWORD:'UNIT_CANARY',DEPLOYED_FRONTEND_SHA:'a'.repeat(40),POPDAM_PLAYWRIGHT_PACKAGE:BROWSER_PACKAGE,POPDAM_PROOF_FILE:path.join(directory,'receipt.json')},
      {prepare:async()=>{prepared++;},cleanup:async()=>{},summary:()=>({passed:false})});
    assert.equal(prepared,0);assert.equal(report.passed,false);assert.equal(report.password_login,false);
    assert.equal(report.diagnostics.failed_stage,'local-browser');
    assert.equal(report.diagnostics.header_count,null);
    assert.equal(JSON.stringify(report).includes('UNIT_CANARY'),false);
  } finally {if(old===undefined)delete process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;else process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=old;fs.rmSync(directory,{recursive:true});}
});
