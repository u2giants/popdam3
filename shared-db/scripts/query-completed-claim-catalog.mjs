// Fixed read-only administrative proof. No application data or acceptance.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {QUERY_URL,readBounded,parseStrictJson} from './proofs/shared-db-2870-observation.mjs';
import {RECOVERY_PROJECT,RECOVERY_SQL,expectedRecoveryCatalog} from './lib/lanes/completed-claim-recovery.mjs';
export async function queryFreshRecoveryCatalog(token,{fetchImpl=fetch,timeoutMs=15000}={}){
 const refuse=()=>{throw new Error('COMPLETED_CLAIM_CATALOG_REFUSED')};
 if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))refuse();
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetchImpl(QUERY_URL,{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:RECOVERY_SQL,read_only:true})});
  if(![200,201].includes(response.status)||response.redirected||(response.url&&response.url!==QUERY_URL))refuse();
  const rows=parseStrictJson(await readBounded(response));
  if(!Array.isArray(rows)||rows.length!==1||Object.keys(rows[0]).sort().join('|')!=='catalog|observed_at'||!isDeepStrictEqual(rows[0].catalog,expectedRecoveryCatalog)||!Number.isFinite(Date.parse(rows[0].observed_at)))refuse();
  return {project_ref:RECOVERY_PROJECT,...rows[0]};
 }catch{refuse()}finally{clearTimeout(timer);controller.abort()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await queryFreshRecoveryCatalog(process.env.SUPABASE_ACCESS_TOKEN)))}catch{console.error('COMPLETED_CLAIM_CATALOG_REFUSED');process.exitCode=2}
}
