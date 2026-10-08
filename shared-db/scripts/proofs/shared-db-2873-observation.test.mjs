import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import expected from './2873-contract.json' with { type:'json' };
import { validateCatalog,validateEnvironment,queryCatalog,buildObservation,main,WORKFLOW } from './shared-db-2873-observation.mjs';
import { QUERY_URL,digest } from './shared-db-2870-observation.mjs';
const rows=()=>[{catalog:structuredClone(expected.catalog)}];
const env=()=>({GITHUB_REPOSITORY:'popcre/shared-db',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW_REF:`popcre/shared-db/${WORKFLOW}@refs/heads/main`,GITHUB_SHA:'a'.repeat(40),APPLICATION_COMMIT_SHA:'b'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',SUPABASE_ACCESS_TOKEN:'fixture-only'});
const fail=/SHARED_DB_2873_OBSERVATION_REFUSED/;
test('each exact role/matrix/refusal field is mandatory',()=>{
 assert.deepEqual(validateCatalog(rows()),rows());
 for(const key of Object.keys(expected.catalog)){
  const r=rows(); r[0].catalog[key]=typeof r[0].catalog[key]==='boolean'?false:r[0].catalog[key]+1;
  assert.throws(()=>validateCatalog(r),fail);
 }
 const r=rows();r[0].catalog.extra=true;assert.throws(()=>validateCatalog(r),fail);
});
test('producer repository, branch, event, workflow, commits and attempt are exact',()=>{
 assert.equal(validateEnvironment(env()).producer_run_id,123);
 for(const [key,value] of Object.entries({GITHUB_REPOSITORY:'other/repo',GITHUB_REF:'refs/heads/feature',GITHUB_EVENT_NAME:'pull_request',GITHUB_WORKFLOW_REF:'popcre/shared-db/.github/workflows/other.yml@refs/heads/main',GITHUB_SHA:'a',APPLICATION_COMMIT_SHA:'b',GITHUB_RUN_ID:'0',GITHUB_RUN_ATTEMPT:'0'}))assert.throws(()=>validateEnvironment({...env(),[key]:value}));
});
test('request is bounded read-only on the one fixed production target',async()=>{
 let calls=0;
 const fetchImpl=async(url,options)=>{calls++;assert.equal(url,QUERY_URL);assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{query:'SELECT fixture',read_only:true});return new Response(JSON.stringify(rows()),{status:200});};
 assert.deepEqual(await queryCatalog('SELECT fixture','fixture-only',{fetchImpl}),rows());assert.equal(calls,1);
 assert.deepEqual(await queryCatalog('SELECT fixture','fixture-only',{fetchImpl:async()=>new Response(JSON.stringify(rows()),{status:201})}),rows());
 await assert.rejects(queryCatalog('SELECT fixture','bad\nkey',{fetchImpl}),fail);assert.equal(calls,1);
 for(const response of [new Response('{}',{status:403}),new Response('[{"catalog":{},"catalog":{}}]',{status:200}),new Response(JSON.stringify([{catalog:{}}]),{status:200})])await assert.rejects(queryCatalog('SELECT fixture','fixture-only',{fetchImpl:async()=>response}),fail);
 await assert.rejects(queryCatalog('SELECT fixture','fixture-only',{fetchImpl:()=>new Promise(()=>{}),timeoutMs:5}),fail);
});
test('envelope binds exact issue, catalog, query/contract hashes and application SHA',async()=>{
 const sqlBytes=await readFile(new URL('./2873-catalog.sql',import.meta.url));const contractBytes=await readFile(new URL('./2873-contract.json',import.meta.url));const args={rows:rows(),env:env(),sqlBytes,contractBytes,observedAt:'2026-10-06T21:00:00.000Z'};
 const o=JSON.parse(buildObservation(args));assert.equal(o.work_issue,2873);assert.equal(o.sql_sha256,digest(sqlBytes));assert.equal(o.contract_sha256,digest(contractBytes));assert.equal(o.application_commit_sha,env().APPLICATION_COMMIT_SHA);assert.deepEqual(o.catalog,rows());
 const bad=structuredClone(expected);bad.work_issue=2870;assert.throws(()=>buildObservation({...args,contractBytes:Buffer.from(JSON.stringify(bad))}),fail);assert.throws(()=>buildObservation({...args,observedAt:'2026-10-06T21:00:00Z'}),fail);
});
test('main writes only fresh authenticated metadata and refuses stale directory and wrong context before network',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'2873-observation-test-'));let calls=0;const options={fetchImpl:async()=>{calls++;return new Response(JSON.stringify(rows()),{status:200});},log:()=>{},error:()=>{}};
 try{
 assert.equal(await main({...env(),RUNNER_TEMP:temp},options),0);const o=JSON.parse(await readFile(join(temp,'shared-db-2873-observation/observation.json'),'utf8'));assert.equal(o.work_issue,2873);
 assert.equal(await main({...env(),RUNNER_TEMP:temp},options),1);const before=calls;
 assert.equal(await main({...env(),RUNNER_TEMP:temp,GITHUB_REF:'refs/heads/feature'},options),1);assert.equal(calls,before);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('complete profile fits the original 8192-byte artifact bound and the query reads only catalog metadata',async()=>{
 const sqlBytes=await readFile(new URL('./2873-catalog.sql',import.meta.url));const contractBytes=await readFile(new URL('./2873-contract.json',import.meta.url));
 assert.ok(buildObservation({rows:rows(),env:env(),sqlBytes,contractBytes,observedAt:'2026-10-06T21:00:00.000Z'}).length<=8192);
 const sql=sqlBytes.toString();assert.match(sql,/WITH expected/);assert.doesNotMatch(sql,/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/im);
 assert.equal(expected.catalog.role_count,8);assert.equal(expected.catalog.matrix_entries,427);
});

// #2873: Supabase's non-superuser postgres receives PostgreSQL 16+'s implicit creator
// membership in every role it creates. Both the migration post-check and the observer
// may exempt exactly that grant; each condition is load-bearing and pinned here.
test('implicit creator membership exemption is exact in migration and observer',async()=>{
 const migration=await readFile(new URL('../../supabase/migrations/20261008025618_dflow_prod_service_identities_forward_2.sql',import.meta.url),'utf8');
 const observer=await readFile(new URL('./2873-catalog.sql',import.meta.url),'utf8');
 const norm=t=>t.toLowerCase().replace(/\s+/g,' ');
 const m=norm(migration),o=norm(observer);
 // The whole exemption clause, verbatim, exactly once in each surface: dropping or
 // weakening any condition changes the clause and fails here.
 const clause="not (m.member='postgres'::regrole and m.admin_option and not m.inherit_option and not m.set_option and exists (select 1 from pg_roles g where g.oid=m.grantor and g.rolsuper)";
 const count=(t)=>t.split(clause).length-1;
 assert.equal(count(m),1,'migration exemption clause');
 assert.equal(count(o.replace(/exists\(/g,'exists (')),1,'observer exemption clause');
 assert.equal((m.match(/'postgres'::regrole/g)||[]).length,1);
 assert.equal((o.match(/'postgres'::regrole/g)||[]).length,1);
 assert.ok(o.includes("when 'v' then 'view'"),'observer must distinguish views from tables');
});
