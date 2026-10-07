import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import expected from './2874-contract.json' with { type:'json' };
import { validateCatalog,validateEnvironment,queryCatalog,buildObservation,main,WORKFLOW } from './shared-db-2874-observation.mjs';
import { QUERY_URL,digest } from './shared-db-2870-observation.mjs';
const rows=()=>[{catalog:structuredClone(expected.catalog)}];
const env=()=>({GITHUB_REPOSITORY:'popcre/shared-db',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW_REF:`popcre/shared-db/${WORKFLOW}@refs/heads/main`,GITHUB_SHA:'a'.repeat(40),APPLICATION_COMMIT_SHA:'b'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',SUPABASE_ACCESS_TOKEN:'fixture-only'});
const fail=/SHARED_DB_2874_OBSERVATION_REFUSED/;
test('exact four-relation, five-function closed metadata is required',()=>{
 assert.deepEqual(validateCatalog(rows()),rows());
 for(const mutate of [r=>r.pop(),r=>r.push(r[0]),r=>r[0].extra=true,r=>r[0].catalog.client_access_closed=false,r=>r[0].catalog.relation_count=3,r=>r[0].catalog.structure_sha256='0'.repeat(64),r=>r[0].catalog.functions.pop(),r=>r[0].catalog.functions[0].source_sha256='0'.repeat(64),r=>r[0].catalog.functions[0].owner='authenticated',r=>r[0].catalog.functions[0].argument_types.push('text'),r=>r[0].catalog.functions[0].configuration=['search_path=public']]){
 const r=rows();mutate(r);assert.throws(()=>validateCatalog(r),fail);
 }
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
 await assert.rejects(queryCatalog('SELECT fixture','fixture-only',{fetchImpl:async()=>new Response('[{"catalog":{},"catalog":{}}]',{status:201})}),fail);
 await assert.rejects(queryCatalog('SELECT fixture','bad\nkey',{fetchImpl}),fail);assert.equal(calls,1);
 for(const response of [new Response('{}',{status:403}),new Response('[{"catalog":{},"catalog":{}}]',{status:200}),new Response(JSON.stringify([{catalog:{}}]),{status:200})])await assert.rejects(queryCatalog('SELECT fixture','fixture-only',{fetchImpl:async()=>response}),fail);
 await assert.rejects(queryCatalog('SELECT fixture','fixture-only',{fetchImpl:()=>new Promise(()=>{}),timeoutMs:5}),fail);
});
test('envelope binds exact issue, catalog, query/contract hashes and application SHA',async()=>{
 const sqlBytes=await readFile(new URL('./2874-catalog.sql',import.meta.url));const contractBytes=await readFile(new URL('./2874-contract.json',import.meta.url));const args={rows:rows(),env:env(),sqlBytes,contractBytes,observedAt:'2026-10-06T21:00:00.000Z'};
 const o=JSON.parse(buildObservation(args));assert.equal(o.work_issue,2874);assert.equal(o.sql_sha256,digest(sqlBytes));assert.equal(o.contract_sha256,digest(contractBytes));assert.equal(o.application_commit_sha,env().APPLICATION_COMMIT_SHA);assert.deepEqual(o.catalog,rows());
 const bad=structuredClone(expected);bad.work_issue=2870;assert.throws(()=>buildObservation({...args,contractBytes:Buffer.from(JSON.stringify(bad))}),fail);assert.throws(()=>buildObservation({...args,observedAt:'2026-10-06T21:00:00Z'}),fail);
});
test('main writes only fresh authenticated metadata and refuses stale directory and wrong context before network',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'2874-observation-test-'));let calls=0;const options={fetchImpl:async()=>{calls++;return new Response(JSON.stringify(rows()),{status:200});},log:()=>{},error:()=>{}};
 try{
 assert.equal(await main({...env(),RUNNER_TEMP:temp},options),0);const o=JSON.parse(await readFile(join(temp,'shared-db-2874-observation/observation.json'),'utf8'));assert.equal(o.work_issue,2874);
 assert.equal(await main({...env(),RUNNER_TEMP:temp},options),1);const before=calls;
 assert.equal(await main({...env(),RUNNER_TEMP:temp,GITHUB_REF:'refs/heads/feature'},options),1);assert.equal(calls,before);
 }finally{await rm(temp,{recursive:true,force:true});}
});
