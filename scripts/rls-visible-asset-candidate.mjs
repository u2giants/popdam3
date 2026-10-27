// Offline-authored prerequisite only. Caller owns approved login/network custody.
import {mkdir,lstat,realpath,open} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
export const PRIVATE_OUTPUT='/tmp/popdam-4427-visible-candidate-private-01a17a03/baseline.json';
const ORIGIN='https://dam.designflow.app',HOST='https://qsllyeztdwjgirsysgai.supabase.co';
const FIELDS=['id','filename','relative_path','file_type','workflow_status','is_deleted','is_licensed','customer_id','licensor_id','property_id','product_subtype_id','style_group_id','thumbnail_url','thumbnail_error','sku','updated_at','modified_at','style_group_changed_at','quick_hash','quick_hash_version'];
const NULLS=['customer_id','licensor_id','property_id','product_subtype_id','style_group_id','thumbnail_url','thumbnail_error','sku'];
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const time=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
export function isVisibleAssetCandidate(row){
  return !!row&&Object.getPrototypeOf(row)===Object.prototype&&FIELDS.every(k=>Object.hasOwn(row,k))&&
    typeof row.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)&&
    row.file_type==='png'&&row.workflow_status==='other'&&row.is_deleted===false&&row.is_licensed===false&&NULLS.every(k=>row[k]===null)&&
    text(row.filename,255)&&text(row.relative_path,2048)&&text(row.quick_hash,256)&&Number.isInteger(row.quick_hash_version)&&row.quick_hash_version>0&&
    ['updated_at','modified_at','style_group_changed_at'].every(k=>time(row[k]));
}
export function acceptedAssetResponse(response){
  try {const u=new URL(response.url());return !u.username&&!u.password&&u.origin===HOST&&u.pathname==='/rest/v1/assets'&&response.request().method()==='GET'&&[200,206].includes(response.status())&&(!u.searchParams.has('offset')||u.searchParams.get('offset')==='0')&&(!u.searchParams.has('limit')||/^[1-9]\d{0,3}$/.test(u.searchParams.get('limit'))&&Number(u.searchParams.get('limit'))<=1000);}catch{return false;}
}
async function privateDirectory(path){
  if(path!==PRIVATE_OUTPUT)throw new Error('private-output');
  const directory=dirname(path);try{await mkdir(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(directory)!==directory||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)throw new Error('private-output');
}
export async function inspectVisibleAssetCandidate(page,privateOutputPath){
  const report={candidate_found:false,candidate_bound:false,response_qualified:false,unique_filename:false,unique_visible_card:false,baseline_persisted:false,uuid_dom_attribute:false,binding_kind:'unique-filename-current-page',manifest_sha256:null};
  let output;
  try{
    await privateDirectory(privateOutputPath);
    // Reserve before navigation; never overwrite or follow an existing output link.
    output=await open(privateOutputPath,'wx',0o600);
    const stat=await output.stat();if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600)throw new Error('private-output');
    if(page.url()!==`${ORIGIN}/library`)throw new Error('route');
    const files=page.getByRole('button',{name:/^All\s+files$/,exact:true});if(await files.count()!==1)throw new Error('normal-files');
    const pending=page.waitForResponse(acceptedAssetResponse,{timeout:15000}).catch(()=>null);
    await files.click();const response=await pending;if(!response)throw new Error('response');
    const rows=await response.json();if(!Array.isArray(rows)||rows.length<1||rows.length>1000)throw new Error('body');
    report.response_qualified=true;
    const row=rows.find(isVisibleAssetCandidate);if(!row)return report;
    report.candidate_found=true;
    if(rows.filter(x=>x&&x.filename===row.filename).length!==1)return report;
    report.unique_filename=true;
    await page.waitForFunction(name=>[...document.querySelectorAll('button.group span.font-mono[title]')].filter(n=>n.getAttribute('title')===name&&n.textContent===name&&n.closest('button.group')?.getClientRects().length>0).length===1,row.filename,{timeout:10000});
    const count=await page.locator('button.group span.font-mono[title]').evaluateAll((nodes,name)=>nodes.filter(n=>n.getAttribute('title')===name&&n.textContent===name&&n.closest('button.group')?.getClientRects().length>0).length,row.filename);
    if(count!==1)return report;report.unique_visible_card=true;
    const baseline=Object.fromEntries(FIELDS.map(k=>[k,row[k]]));
    const content=JSON.stringify({schema_version:1,issue:4427,deployed_frontend_sha:'eb405c02479f1d76b319f2f2e89150493bcade45',binding_kind:report.binding_kind,uuid_dom_attribute:false,all_references_qualified:false,write_authority:false,baseline})+'\n';
    await output.writeFile(content);await output.sync();await output.close();output=null;
    report.baseline_persisted=true;report.candidate_bound=true;report.manifest_sha256=createHash('sha256').update(content).digest('hex');
    return report;
  }catch{return report;}
  finally{if(output)try{await output.close();}catch{/* Failure is unbound; partial/empty file is diagnostic only. */}}
}
