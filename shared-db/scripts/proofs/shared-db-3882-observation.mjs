// Owner: shared-db maintenance. Bounded support for #3882 and its existing children.
// Reuses the #2870 parser/HTTP bounds. Retire with this family's accepted evidence.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseStrictJson,readBounded,digest} from './shared-db-2870-observation.mjs';
export const WORKFLOW='.github/workflows/shared-db-3882-observation.yml';
export const contract=JSON.parse(await readFile(new URL('./3882-contract.json',import.meta.url)));
const check=v=>{if(!v)throw Error('Catalog observation refused');};
export function validateRows(rows,issue){
 check(Array.isArray(rows)&&rows.length===17&&Object.hasOwn(contract.issues,String(issue)));
 const tables=rows.filter(r=>r.kind==='table');check(tables.length===12);
 for(const [table,schema] of Object.entries(contract.tables)){
 const found=tables.filter(r=>r.table_name===table);check(found.length===1);const r=found[0];
 check(r.schema_name===schema&&r.passed===true&&r.work_issue===null&&Array.isArray(r.columns)&&r.columns.length>0);
 check(new Set(r.columns).size===r.columns.length&&r.columns.every(c=>typeof c==='string'&&c.length>0));
 }
 const assertions=rows.filter(r=>r.kind==='assertion');check(assertions.length===5&&new Set(assertions.map(r=>r.work_issue)).size===5&&assertions.every(r=>Object.hasOwn(contract.issues,String(r.work_issue))&&typeof r.passed==='boolean'));
 check(assertions.find(r=>r.work_issue===Number(issue))?.passed===true);return rows;
}
export function validateSandbox(rows){check(Array.isArray(rows)&&rows.length===1&&rows[0].shape_passed===true&&/^\d+$/.test(String(rows[0].row_count))&&Number.isSafeInteger(Number(rows[0].row_count))&&Number(rows[0].row_count)>=10122);return rows;}
export async function query(project,sql,token,fetchImpl=fetch){
 check([contract.production_project_ref,contract.sandbox_project_ref].includes(project)&&typeof token==='string'&&token&&!/[\r\n]/.test(token));
 const url=`https://api.supabase.com/v1/projects/${project}/database/query`;
 const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:true})});
 check([200,201].includes(response.status)&&!response.redirected&&(!response.url||response.url===url));return parseStrictJson(await readBounded(response));
}
export function validateContext(env){
 check(env.GITHUB_REPOSITORY===contract.source_repository&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_WORKFLOW_REF===`${contract.source_repository}/${WORKFLOW}@refs/heads/main`&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&/^[a-f0-9]{40}$/.test(env.APPLICATION_COMMIT_SHA||'')&&Object.hasOwn(contract.issues,env.WORK_ISSUE||''));
 for(const k of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])check(/^[1-9][0-9]*$/.test(env[k]||'')&&Number.isSafeInteger(Number(env[k])));
}
export async function main(env=process.env){try{
 validateContext(env);check(env.RUNNER_TEMP&&isAbsolute(env.RUNNER_TEMP));
 const names=['3882-contract.json','3882-production.sql','3882-sandbox.sql'];const bytes=await Promise.all(names.map(n=>readFile(new URL(n,import.meta.url))));
 const rows=validateRows(await query(contract.production_project_ref,bytes[1].toString(),env.SUPABASE_ACCESS_TOKEN),env.WORK_ISSUE);
 const sandbox=env.WORK_ISSUE==='3890'?validateSandbox(await query(contract.sandbox_project_ref,bytes[2].toString(),env.SUPABASE_ACCESS_TOKEN)):null;
 const observation={schema_version:1,work_issue:Number(env.WORK_ISSUE),project_ref:contract.production_project_ref,live_assertion:contract.issues[env.WORK_ISSUE].live_assertion,environment:contract.issues[env.WORK_ISSUE].environment,observed_at:new Date().toISOString(),producer_repository:contract.source_repository,producer_commit_sha:env.GITHUB_SHA,producer_workflow:WORKFLOW,producer_run_id:Number(env.GITHUB_RUN_ID),producer_run_attempt:Number(env.GITHUB_RUN_ATTEMPT),application_repository:contract.application_repository,application_commit_sha:env.APPLICATION_COMMIT_SHA,file_sha256:Object.fromEntries(names.map((n,i)=>[n,digest(bytes[i])])),catalog:rows,sandbox};
 const out=Buffer.from(JSON.stringify(observation)+'\n');check(out.length<=65536);const dir=join(env.RUNNER_TEMP,'shared-db-3882-observation');await mkdir(dir);await writeFile(join(dir,'observation.json'),out,{flag:'wx',mode:0o600});console.log('PASS: fixed catalog observation created');return 0;
 }catch{console.error('REFUSED: fixed catalog observation');return 1;}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
