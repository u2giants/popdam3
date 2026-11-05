/** Append-only application-data repair support. Never contains production credentials or licensed rows. */
export function stable(value) {
 if(Array.isArray(value))return value.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
}
export function hasReceipt(operations,assetId) {
 return Object.values(operations).some(op=>op?.external_job&&JSON.stringify(op.external_job).includes(assetId));
}
export function verifyPreimage(expected,current,operations) {
 if(hasReceipt(operations,expected.asset.id))throw Error('Protected external receipt');
 for(const key of ['asset','tags','links','legacy'])if(JSON.stringify(stable(expected[key]))!==JSON.stringify(stable(current[key])))throw Error('Changed '+key+' preimage');
}
export function appendPayload(entry) {
 const source=entry.preimage.tags.find(t=>t.id===entry.sourceTagId);
 if(!source||source.source!=='ai'||source.status!=='active'||source.created_by||source.model!==entry.model)throw Error('Existing AI provenance required');
 if(entry.preimage.links.some(row=>row.character_id===entry.characterId))throw Error('Already linked');
 if(entry.character.status!=='active'||entry.character.licensor_id!==entry.licensorId)throw Error('Active scoped character required');
 return {asset_id:entry.assetId,character_id:entry.characterId,source:'ai',model:source.model,tagged_at:source.updated_at??source.created_at};
}
export function assetOutcome(manifest,assetId) {
 const appends=manifest.filter(row=>row.assetId===assetId).length;
 return {assetId,outcome:appends?'append_missing_links':'no_missing_unambiguous_new_character',appends};
}
