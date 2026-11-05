/** Read-only repair planner. Private input/output only; never runs an AI model or writes production. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {assetOutcome,hasReceipt,identity,matchable} from './relink-existing-ai-characters-safety.mjs';
import { displayCharacterName } from '../apps/worker/src/handlers/tag-finish.js';
import { addNamedCharacters, resolveCharacterScope } from '../apps/worker/src/handlers/ai-tagging-shared.js';
const [input, catalogFile, output] = process.argv.slice(2);
if (!input || !catalogFile || !output) throw Error('Require private candidate, catalog and output files');
const target = 'https://qsllyeztdwjgirsysgai.supabase.co';
if (process.env.SUPABASE_URL !== target || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Production target or credential missing');
const candidates = JSON.parse(readFileSync(input, 'utf8'));
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
if (candidates.length > 10000) throw Error('Candidate bound exceeded');
const characters = catalog.find((r:any) => r.kind === 'characters').data;
const operationsRaw = catalog.find((r:any) => r.kind === 'operations').data[0];
const operations = typeof operationsRaw === 'string' ? JSON.parse(operationsRaw) : operationsRaw;

const readCache = new Map<string, Promise<Response>>();
function readClient(onFailure:()=>void){return createClient(target,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false},global:{fetch:async(url:any,init:any)=>{if(init?.method&&init.method!=='GET')throw Error('Read-only planner refused mutation');const key=String(url);if(!readCache.has(key))readCache.set(key,fetch(url,init));try{const response=await readCache.get(key)!;if(!response.ok){onFailure();readCache.delete(key);}return response.clone();}catch(error){onFailure();readCache.delete(key);throw error;}}}});}
const normalized = (s:string) => displayCharacterName(s).toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const manifest:any[] = [], outcomes:any[] = [], abstentions:Record<string,number> = {};
function abstain(reason:string) {abstentions[reason] = (abstentions[reason] ?? 0) + 1;}
async function inspect(item:any) {
 const a = item.asset; let readFailures=0;const client=readClient(()=>readFailures++);
 try {
 let groupPreimage:any=null;
 if(a.style_group_id){const group=await client.from('style_groups').select('*').eq('id',a.style_group_id).single();if(group.error)throw Error('Group preimage dependency failed');groupPreimage=group.data;}
 if (hasReceipt(operations,a.id)) {abstain('external_receipt_any_status');outcomes.push({assetId:a.id,outcome:'external_receipt_any_status'});return;}
 const scope = await resolveCharacterScope(client as any,a,async(q:any)=>q,(error:any)=>{if(error)throw Error('Scope dependency failed')});
 if (scope.unlicensed || !scope.licensor_id) {abstain('missing_or_unlicensed_scope');outcomes.push({assetId:a.id,outcome:'missing_or_unlicensed_scope'});return;}
 const tags = item.tags.filter((t:any) => t.source==='ai' && t.status==='active' && !t.created_by && item.matchingTagIds.includes(t.id));
 for(const t of tags) {
  const resolved = await addNamedCharacters(client as any,a,[],[t.tag]);
  if(resolved.length!==1) continue;
  const character = characters.find((c:any)=>identity(c.id)===identity(resolved[0]) && matchable(c) && c.licensor_id===scope.licensor_id);
  if(!character || item.links.some((l:any)=>identity(l.character_id)===identity(character.id))) continue;
  // Independently reject duplicate normalized canonical or alias identities within the exact licensor.
  const [canonical,aliases] = await Promise.all([
   client.schema('core').from('character').select('id,name,status').eq('licensor_id',scope.licensor_id).ilike('name',normalized(t.tag).replaceAll(' ','%')+'%').limit(201),
   client.schema('core').from('character_alias').select('alias,character:character_id(id,status)').eq('licensor_id',scope.licensor_id).ilike('alias',normalized(t.tag).replaceAll(' ','%')+'%').limit(51),
  ]);
  if(canonical.error||aliases.error||canonical.data.length>=200||aliases.data.length>=50) {abstain('ambiguous_or_failed_catalog_read');continue;}
  const identities=new Set([...canonical.data.filter((r:any)=>matchable(r)&&normalized(r.name)===normalized(t.tag)).map((r:any)=>identity(r.id)),...aliases.data.filter((r:any)=>matchable(r.character)&&normalized(r.alias)===normalized(t.tag)).map((r:any)=>identity(r.character.id))]);
  if(identities.size!==1 || !identities.has(identity(character.id))) {abstain('ambiguous_identity');continue;}
  if(manifest.some(r=>r.assetId===a.id&&identity(r.characterId)===identity(character.id)))continue;
  manifest.push({assetId:a.id,characterId:character.id,licensorId:scope.licensor_id,propertyId:scope.property_id,sourceTagId:t.id,source:'ai',model:t.model,sourceTaggedAt:t.created_at,sourceTag:t,character,scope,preimage:item,groupPreimage,sourceAliasRows:aliases.data.filter((r:any)=>identity(r.character?.id)===identity(character.id)&&normalized(r.alias)===normalized(t.tag))});
 }
 if(readFailures){for(let i=manifest.length-1;i>=0;i--)if(manifest[i].assetId===a.id)manifest.splice(i,1);abstain('catalog_dependency_failure');outcomes.push({assetId:a.id,outcome:'catalog_dependency_failure'});}else outcomes.push(assetOutcome(manifest,a.id));
 } catch {
  for(let i=manifest.length-1;i>=0;i--)if(manifest[i].assetId===a.id)manifest.splice(i,1);
  abstain('dependency_failure');outcomes.push({assetId:a.id,outcome:'abstained_dependency_failure'});
 }
 if(outcomes.length%100===0)console.log(JSON.stringify({checkedAssets:outcomes.length,appendLinks:manifest.length}));
}
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<candidates.length)await inspect(candidates[cursor++]);}));
const payload={target,observedAt:new Date().toISOString(),candidateCount:candidates.length,abstentions,outcomes,manifest};
const serialized=JSON.stringify(payload);writeFileSync(output,serialized,{mode:0o600});
console.log(JSON.stringify({candidateCount:candidates.length,appendLinks:manifest.length,distinctAssets:new Set(manifest.map(r=>r.assetId)).size,abstentions,sha256:createHash('sha256').update(serialized).digest('hex')}));
