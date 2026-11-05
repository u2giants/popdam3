#!/usr/bin/env node
// #5447 / backend #278. Read-only product-eligibility evidence, never HTS answers.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,mkdtempSync,existsSync,realpathSync,openSync,writeFileSync,closeSync,renameSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchPagedMaster,fetchArrayMaster} from './lib/master-http.mjs';
import {COMPANY_CODE} from './lib/scopes.mjs';
export const SOURCE='direct-current-coldlion-itemDetails-read';
const LOGIN='designflow_hts_evaluation_reader',ROLE='designflow_hts_evaluation_read';
const clean=x=>String(x??'').trim(),sha=x=>createHash('sha256').update(x).digest('hex');
export function validateMetadata(value){
 if(!value||Object.keys(value).some(k=>k!=='items')||!Array.isArray(value.items)||!value.items.length||value.items.length>215)throw Error('invalid bounded metadata population');
 const seen=new Set();return value.items.map(x=>{
  if(!x||Object.keys(x).some(k=>!['id','style'].includes(k))||typeof x.id!=='string'||!/^item-[1-9][0-9]{0,9}$/.test(x.id)||Number(x.id.slice(5))>2147483647||seen.has(x.id)||typeof x.style!=='string'||!clean(x.style)||x.style.length>100)throw Error('invalid or duplicate metadata identity');
  seen.add(x.id);return {id:x.id,style:clean(x.style)};
 });
}
export function associationSql(items){
 const ids=validateMetadata({items}).map(x=>Number(x.id.slice(5)));
 return `BEGIN READ ONLY;\nSET LOCAL statement_timeout='8s';\nDO $guard$ BEGIN IF session_user<>'${LOGIN}' OR current_user<>'${LOGIN}' OR current_setting('transaction_read_only')<>'on' OR current_setting('default_transaction_read_only')<>'on' THEN RAISE EXCEPTION 'read identity refused'; END IF; END $guard$;\nSET ROLE ${ROLE};\nDO $guard$ BEGIN IF current_user<>'${ROLE}' THEN RAISE EXCEPTION 'active read role refused'; END IF; END $guard$;\nSELECT json_build_object('login',session_user,'role',current_user,'readOnly',current_setting('transaction_read_only'));\nPREPARE hts_qualification_items(bigint[]) AS SELECT coalesce(json_agg(json_build_object('id','item-'||item_id_pk::text,'style',btrim(item_num_id))),'[]'::json) FROM dflow_prod."itemHeader" WHERE item_id_pk=ANY($1);\nEXECUTE hts_qualification_items(ARRAY[${ids.join(',')}]::bigint[]);\nROLLBACK;\n`;
}
export function readCurrentItems(items,env=process.env,run=spawnSync){
 const ref=env.HTS_EXPECTED_PROJECT_REF;
 if(!/^[a-z0-9]{20}$/.test(ref||'')||env.PGUSER!==`${LOGIN}.${ref}`||!env.PGHOST||!env.PGPORT||!env.PGDATABASE||!env.PGPASSWORD||env.PGSSLMODE!=='require')throw Error('protected dedicated target is required');
 const child={PATH:env.PATH,LANG:env.LANG||'C.UTF-8',PGHOST:env.PGHOST,PGPORT:env.PGPORT,PGDATABASE:env.PGDATABASE,PGUSER:env.PGUSER,PGPASSWORD:env.PGPASSWORD,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c default_transaction_read_only=on'};
 const r=run('psql',['-X','--no-psqlrc','--quiet','--tuples-only','--no-align','--set','ON_ERROR_STOP=1'],{input:associationSql(items),env:child,encoding:'utf8',timeout:15000,maxBuffer:1048576});
 if(r.error||r.status!==0)throw Error('bounded dedicated association read failed');
 let lines;try{lines=r.stdout.trim().split('\n').map(x=>JSON.parse(x));}catch{throw Error('invalid association read proof');}
 if(lines.length!==2||lines[0].login!==LOGIN||lines[0].role!==ROLE||lines[0].readOnly!=='on'||!Array.isArray(lines[1]))throw Error('read identity proof refused');
 return {identity:lines[0],items:lines[1],querySha256:sha(associationSql(items))};
}
function unknown(){return {state:'unknown',companyCode:null,divisionCode:null,detailMatched:false,sourceComplete:false,sourceAsOfUtc:null};}
export async function qualify({metadata,readItems=readCurrentItems,env=process.env,fetchImpl=fetch,now=()=>new Date().toISOString(),paceMs=3000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}}){
 const items=validateMetadata(metadata),startedAtUtc=now(),association=readItems(items,env);
 if(!association||!Array.isArray(association.items))throw Error('current association unavailable');
 const current=new Map();for(const row of association.items){if(!items.some(x=>x.id===row.id))throw Error('unexpected current item identity');if(!current.has(row.id))current.set(row.id,[]);current.get(row.id).push(row.style);}
 const groups=new Map(),states=new Map();
 for(const x of items){const mapped=current.get(x.id)||[];if(mapped.length!==1||typeof mapped[0]!=='string'||clean(mapped[0]).toUpperCase()!==x.style.toUpperCase()){states.set(x.id,unknown());continue;}const style=clean(mapped[0]),normalized=style.toUpperCase();if(!groups.has(normalized))groups.set(normalized,{style,ids:[]});groups.get(normalized).ids.push(x.id);}
 if(!env.COLDLION_API_KEY)throw Error('protected existing vendor key is required');
 const seen=new Set(),proofs=[];let calls=0,last=0;
 const boundedFetch=async(url,options)=>{const request=String(url);if(seen.has(request)||calls>=650)throw Object.assign(Error('bounded retry refused'),{permanent:true});seen.add(request);calls++;
  try{const response=await fetchImpl(url,options);if(!response.ok)throw Error('vendor response refused');const body=await response.text();JSON.parse(body);return new Response(body,{status:response.status,headers:response.headers});}catch(e){throw Object.assign(Error('bounded vendor read unavailable'),{permanent:true});}};
 const requestGate=async()=>{const wait=Math.max(0,paceMs-(Date.now()-last));if(wait)await sleep(wait);last=Date.now();};
 const options={fetchImpl:boundedFetch,requestGate,timeoutMs:10000,pauseMs:0};
 for(const {style,ids} of groups.values()){
  let result=unknown();const proof={ids,headerStartedAtUtc:now(),reason:'unknown'};
  try{
   const headers=await fetchPagedMaster('/items',{companyCode:COMPANY_CODE,itemNo:style},env.COLDLION_API_KEY,{...options,size:200});proof.headerFinishedAtUtc=now();proof.headerRows=headers.length;
   if(headers.length!==1||headers.some(x=>clean(x.companyCode)!==COMPANY_CODE||clean(x.itemNo)!==style||!clean(x.divisionCode)))throw Error('header_context_missing_or_ambiguous');
   const companyCode=clean(headers[0].companyCode),divisionCode=clean(headers[0].divisionCode);result.companyCode=companyCode;result.divisionCode=divisionCode;
   proof.detailStartedAtUtc=now();const details=await fetchArrayMaster('/itemDetails',{companyCode,divisionCode,itemNo:style},env.COLDLION_API_KEY,options);proof.detailFinishedAtUtc=now();proof.detailRows=details.length;
   if(!details.length)throw Error('detail_empty');const keys=new Set();
   for(const d of details){if(clean(d.companyCode)!==companyCode||clean(d.divisionCode)!==divisionCode||clean(d.itemNo)!==style||!clean(d.itemPkey)||keys.has(clean(d.itemPkey))||!Object.hasOwn(d,'prePackCode')||(d.prePackCode!==null&&typeof d.prePackCode!=='string'))throw Error('detail_identity_incomplete');keys.add(clean(d.itemPkey));}
   result={state:details.some(x=>clean(x.prePackCode))?'prepack':'non_prepack',companyCode,divisionCode,detailMatched:true,sourceComplete:true,sourceAsOfUtc:proof.detailFinishedAtUtc};proof.reason='complete_current_exact_context';proof.markerPresent=result.state==='prepack';
  }catch(e){proof.reason=['header_context_missing_or_ambiguous','detail_empty','detail_identity_incomplete'].includes(e.message)?e.message:'bounded_vendor_read_unavailable';}
  for(const id of ids)states.set(id,result);proofs.push(proof);onProgress({completedContexts:proofs.length,totalContexts:groups.size,networkCalls:calls});
 }
 const receipt={schemaVersion:1,source:SOURCE,observedAtUtc:now(),items:items.map(x=>({id:x.id,...states.get(x.id)}))};
 const bytes=JSON.stringify(receipt,null,2)+'\n';
 return {receipt,provenance:{startedAtUtc,finishedAtUtc:receipt.observedAtUtc,configuredCompanyScope:COMPANY_CODE,association,metadataSha256:sha(JSON.stringify({items})),networkCalls:calls,proofs,receiptSha256:sha(bytes)}};
}
export function assertPrivateTarget(output){
 if(existsSync(output))throw Error('private output target already exists');
 let parent=realpathSync(dirname(resolve(output)));
 for(;;){if(existsSync(join(parent,'.git')))throw Error('private output inside a Git checkout refused');const next=dirname(parent);if(next===parent)break;parent=next;}
}
export function writePrivateOutput(output,result){
 assertPrivateTarget(output);
 const staged=mkdtempSync(join(dirname(output),'.hts-qualification-'));
 try{for(const [name,value] of [['qualification.json',result.receipt],['provenance.json',result.provenance]]){const fd=openSync(join(staged,name),'wx',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');}finally{closeSync(fd);}}
  if(existsSync(output))throw Error('private output target appeared');renameSync(staged,output);
 }catch(e){rmSync(staged,{recursive:true,force:true});throw e;}
 return result.provenance.receiptSha256;
}

async function main(){
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--input'||args[2]!=='--output')throw Error('input and new private output directory required');
 const input=resolve(args[1]),output=resolve(args[3]),stat=lstatSync(input);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('protected metadata file required');
 assertPrivateTarget(output);const result=await qualify({metadata:JSON.parse(readFileSync(input,'utf8'))});const receiptSha256=writePrivateOutput(output,result);
 const counts=result.receipt.items.reduce((a,x)=>(a[x.state]++,a),{prepack:0,non_prepack:0,unknown:0});console.log(JSON.stringify({source:SOURCE,items:result.receipt.items.length,counts,receiptSha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Read-only qualification failed; no source rows or credentials printed.');process.exitCode=1;});
