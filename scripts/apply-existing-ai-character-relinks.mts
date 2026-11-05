/** Narrow append-only application-data repair. Default read-only; the coordinator owns release. */
import {createClient} from '@supabase/supabase-js';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import{createHash}from'node:crypto';
import {addNamedCharacters,resolveCharacterScope} from '../apps/worker/src/handlers/ai-tagging-shared.js';
import {displayCharacterName}from'../apps/worker/src/handlers/tag-finish.js';
import {stable,hasReceipt,verifyPreimage,appendPayload}from'./relink-existing-ai-characters-safety.mjs';
const [file,receiptFile,reviewedSha]=process.argv.slice(2);if(!file||!receiptFile)throw Error('Private manifest and receipt paths required');
const raw=readFileSync(file,'utf8'),sha=createHash('sha256').update(raw).digest('hex'),packet=JSON.parse(raw);
const target='https://qsllyeztdwjgirsysgai.supabase.co';if(process.env.SUPABASE_URL!==target||packet.target!==target)throw Error('Production target mismatch');
const apply=reviewedSha!==undefined;if(apply&&reviewedSha!==sha)throw Error('Exact reviewed manifest hash required');if(existsSync(receiptFile))throw Error('Receipt exists; inspect previous execution first');
const c=createClient(target,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const normalized=(s:string)=>displayCharacterName(s).toLowerCase().replace(/^the\s+/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const groups=new Map<string,any[]>();for(const entry of packet.manifest){const group=groups.get(entry.assetId)??[];group.push(entry);groups.set(entry.assetId,group);}const receipt:any={target,manifestSha256:sha,apply,startedAt:new Date().toISOString(),outcomes:[]};
const save=()=>writeFileSync(receiptFile,JSON.stringify(receipt),{mode:0o600});save();
const checked=(r:any)=>{if(r.error)throw Error('Dependency read failed '+r.error.code);return r.data;};
for(const[assetId,entries]of groups as Map<string,any[]>){
 const expected=entries[0].preimage;
 const [asset,tags,links,legacy,ops,group]=await Promise.all([c.from('assets').select('*').eq('id',assetId).single(),c.from('asset_tags').select('*').eq('asset_id',assetId),c.from('asset_licensor_characters').select('*').eq('asset_id',assetId),c.from('asset_characters').select('*').eq('asset_id',assetId),c.from('admin_config').select('value').eq('key','BULK_OPERATIONS').single(),expected.asset.style_group_id?c.from('style_groups').select('*').eq('id',expected.asset.style_group_id).single():Promise.resolve({data:null,error:null})]);
 const current={asset:checked(asset),tags:checked(tags),links:checked(links),legacy:checked(legacy)};const value=checked(ops).value,operations=typeof value==='string'?JSON.parse(value):value;
 try{verifyPreimage(expected,current,operations);}catch(e){receipt.outcomes.push({assetId,status:'abstained_changed_or_receipt',reason:(e as Error).message});save();continue;}
 if(JSON.stringify(stable(checked(group)))!==JSON.stringify(stable(entries[0].groupPreimage))){receipt.outcomes.push({assetId,status:'abstained_changed_group'});save();continue;}
 const payload=[];let abort=false;let failedChecks:any=null;
 for(const entry of entries){
  const character=checked(await c.schema('core').from('character').select('*').eq('id',entry.characterId).single());
  const scope=await resolveCharacterScope(c as any,current.asset,async(q:any)=>q,(error:any)=>{if(error)throw Error('Scope dependency');});
  const ids=await addNamedCharacters(c as any,current.asset,[],[entry.sourceTag.tag]);
  const name=normalized(entry.sourceTag.tag),pattern=name.replaceAll(' ','%')+'%';
  const [canonical,aliases]=await Promise.all([c.schema('core').from('character').select('id,name,status').eq('licensor_id',entry.licensorId).ilike('name',pattern).limit(201),c.schema('core').from('character_alias').select('alias,character:character_id(id,status)').eq('licensor_id',entry.licensorId).ilike('alias',pattern).limit(51)]);
  const canonicalRows=checked(canonical),aliasRows=checked(aliases);const identities=new Set([...canonicalRows.filter((r:any)=>r.status==='active'&&normalized(r.name)===name).map((r:any)=>r.id),...aliasRows.filter((r:any)=>r.character?.status==='active'&&normalized(r.alias)===name).map((r:any)=>r.character.id)]);
  const checks={licensed:!scope.unlicensed,licensorUnchanged:scope.licensor_id===entry.licensorId,propertyUnchanged:scope.property_id===entry.propertyId,resolverExactlyOne:ids.length===1&&ids[0]===entry.characterId,identityUnique:identities.size===1&&identities.has(entry.characterId),catalogComplete:canonicalRows.length<200&&aliasRows.length<50,characterUnchanged:JSON.stringify(stable(character))===JSON.stringify(stable(entry.character))};
  if(Object.values(checks).some(ok=>!ok)){abort=true;failedChecks={sourceTagId:entry.sourceTagId,checks};break;}
  payload.push(appendPayload(entry));
 }
 if(abort){receipt.outcomes.push({assetId,status:'abstained_changed_catalog_or_scope',failedChecks});save();continue;}
 // Read the current receipt owner again after resolver checks, without any status filter.
 const finalOps=checked(await c.from('admin_config').select('value').eq('key','BULK_OPERATIONS').single()).value;
 if(hasReceipt(typeof finalOps==='string'?JSON.parse(finalOps):finalOps,assetId)){receipt.outcomes.push({assetId,status:'abstained_new_receipt'});save();continue;}
 if(!apply){receipt.outcomes.push({assetId,status:'dry_run_ready',links:payload.length});save();continue;}
 const inserted=await c.from('asset_licensor_characters').insert(payload).select('*');if(inserted.error){receipt.outcomes.push({assetId,status:'append_failed',code:inserted.error.code});save();throw Error('Append failed; inspect private receipt');}
 const [afterAsset,afterTags,afterLinks,afterLegacy]=await Promise.all([c.from('assets').select('*').eq('id',assetId).single(),c.from('asset_tags').select('*').eq('asset_id',assetId),c.from('asset_licensor_characters').select('*').eq('asset_id',assetId),c.from('asset_characters').select('*').eq('asset_id',assetId)]);
 const post={asset:checked(afterAsset),tags:checked(afterTags),links:checked(afterLinks),legacy:checked(afterLegacy)};
 receipt.outcomes.push({assetId,status:'appended',inserted:inserted.data,post});save();
 verifyPreimage({...expected,links:[...expected.links,...inserted.data!]},{...post},{});
}
receipt.completedAt=new Date().toISOString();save();console.log(JSON.stringify({apply,manifestSha256:sha,counts:receipt.outcomes.reduce((r:any,o:any)=>(r[o.status]=(r[o.status]??0)+1,r),{})}));
