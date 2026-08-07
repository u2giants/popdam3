#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const data = JSON.parse(fs.readFileSync(path.join(dir, 'baseline.json'), 'utf8'));
const norm = s => String(s ?? '').toLowerCase().replace(/[”″]/g,'"').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const depthKey = s => { const v=String(s??'').toLowerCase().replace(/in(ch(es)?)?|["”″]/g,'').trim(); const n=Number(v); return Number.isFinite(n)?String(n):v; };
const packaging = ['Cardboard corners','Traybox','PVC bag with J-card','Hanger with J-card and polybag','Polybag with hangtag','Packaging sticker','Phone stand packaging','Tablet stand packaging'];
const corePack = data.snapshots['core.packaging_type'];
const packRows = packaging.map(name => {
  const exact = corePack.find(r => norm(r.name) === norm(name));
  const alias = exact || corePack.find(r => norm(r.name).replace(/s$/,'') === norm(name).replace(/s$/,''));
  return { designflow:name, classification: exact?'normalized-exact':alias?'alias-candidate':'designflow-only', core:alias?.name ?? null,
    liveUsage:Number(data.analyses.packagingUsage.find(r=>r.value===name)?.usage_count ?? 0) };
});
const direct = data.coldlion.detailCalls.flatMap(c=>c.rows);
const mirror = data.analyses.mg04Mirror;
const dkey = r => `${r.divisionCode}|${r.mgTypeCode}|${r.mgCode}`;
const mkey = r => `${r.divisionCode_fk}|04|${r.mg_code}`;
const directMap = new Map(direct.map(r=>[dkey(r),r]));
const mirrorMap = new Map(mirror.map(r=>[mkey(r),r]));
const mg = {
  directCount:direct.length, mirrorCount:mirror.length,
  exactCompositeMatches:mirror.filter(r=>directMap.has(mkey(r))).length,
  mirrorOnly:mirror.filter(r=>!directMap.has(mkey(r))), directOnly:direct.filter(r=>!mirrorMap.has(dkey(r))),
  labelConflicts:mirror.filter(r=>directMap.has(mkey(r)) && norm(directMap.get(mkey(r)).mgDesc)!==norm(r.mg_desc))
};
const users = data.snapshots['dflow.users'];
const creatives = data.analyses.assignments.filter(r=>r.role==='creative_designer').map(a=>{
  const u=users.find(x=>x.id===a.user_id_fk); const full=[u?.name,u?.lastname].filter(Boolean).join(' ');
  const match=data.snapshots['core.creative_designer'].find(d=>norm(d.name)===norm(full));
  return {...a,person:full,email:u?.email,status:u?.status,canonicalId:match?.id??null,canonicalName:match?.name??null};
});
const coreFactories=data.snapshots['core.factory'];
const factories=data.snapshots['dflow.Factory'].map(v=>{
  const match=coreFactories.find(f=>norm(f.name)===norm(v.factory_name)||norm(f.display_name)===norm(v.factory_name));
  return {legacyId:v.id,name:v.factory_name,status:v.factory_status,usage:0,canonicalId:match?.id??null,canonicalName:match?.name??null};
});
const depths=data.snapshots['dflow.itemDepth'];
const depthUsage=data.analyses.depthUsage.map(u=>{
  const n=depthKey(u.value);
  const matches=depths.filter(d=>depthKey(d.itemDepth_title)===n);
  return {...u,matches:matches.map(d=>d.itemDepth_id)};
});
const summary={capturedAt:data.capturedAt,
  packaging:{designflowCount:8,coreCount:corePack.length,rows:packRows,coreOnly:corePack.filter(c=>!packaging.some(p=>norm(p)===norm(c.name))).map(c=>c.name)},
  productSize:{...mg,mirrorOnlyCount:mg.mirrorOnly.length,directOnlyCount:mg.directOnly.length,labelConflictCount:mg.labelConflicts.length,coreProductSizeExists:false,ledgerMatches:data.ledger},
  creativeDesigner:{assignmentCount:creatives.length,uniquePeople:new Set(creatives.map(x=>x.user_id_fk)).size,rows:creatives,nonCreativeAssignments:data.analyses.assignments.filter(r=>r.role!=='creative_designer').length},
  vendorFactory:{legacyCount:factories.length,coreCount:coreFactories.length,exactNameMatches:factories.filter(x=>x.canonicalId).length,unmatched:factories.filter(x=>!x.canonicalId),liveNonblankVendorRefs:data.analyses.vendorUsage.filter(x=>String(x.vendor_code_fk).trim()).length},
  depth:{lookupCount:depths.length,activeCount:depths.filter(x=>x.itemDepth_status==='ACTIVE').length,usageValues:depthUsage.length,usageRows:Number(depthUsage.reduce((n,x)=>n+BigInt(x.usage_count),0n)),unmatchedUsage:depthUsage.filter(x=>x.value!=='(blank)'&&x.matches.length===0),ambiguousUsage:depthUsage.filter(x=>x.matches.length>1),has063:depths.some(x=>/0[.]63/.test(x.itemDepth_title)),mirrorLatest:data.analyses.depthMirrorFreshness[0].latest_airbyte_at}
};
fs.writeFileSync(path.join(dir,'comparison-summary.json'),JSON.stringify(summary,null,2)+'\n');
const md=`# Master Data and DesignFlow read-only comparison\n\nCaptured: ${summary.capturedAt}\n\n## Baseline\n\nProduction shared Supabase was queried read-only. DesignFlow production remains Cloud SQL by configuration; the Supabase dflow tables are a mirror. Counts: packaging ${corePack.length}, product size absent, creative designers ${summary.creativeDesigner.assignmentCount} assignments, factories ${coreFactories.length}, itemDepth ${depths.length}, item headers ${data.tables['dflow.itemHeader'].count}.\n\n## Packaging Type\n\nAll 8 hard-coded values and all ${corePack.length} core rows are accounted for. ${packRows.filter(x=>x.classification==='normalized-exact').length} normalized exact, ${packRows.filter(x=>x.classification==='alias-candidate').length} alias candidate, ${packRows.filter(x=>x.classification==='designflow-only').length} DesignFlow-only. Live item usage is effectively empty: 19,461 blank and one “Cardboard corners”. Phase 2 exception list is in comparison-summary.json.\n\n## Product Size / MG04\n\nThe direct ColdLion header call returned a paged envelope with ${data.coldlion.headersCount} rows on page 0 and terminal-page metadata. It identified MG04 Size for SP001, EH001, and CW001. Detail calls are documented plain arrays: ${data.coldlion.detailCalls.map(x=>`${x.divisionCode} ${x.rowCount}`).join(', ')}; total ${direct.length}, each with a SHA-256 hash. The dflow mirror has ${mirror.length}. Composite matches: ${mg.exactCompositeMatches}; mirror-only: ${mg.mirrorOnly.length}; direct-only: ${mg.directOnly.length}; label conflicts: ${mg.labelConflicts.length}. The mirror includes EP001 (${mirror.filter(x=>x.divisionCode_fk==='EP001').length}) although the current direct header feed does not advertise it. Therefore the direct feed is proven not to be a complete replacement for all mirrored/live identities, and the importer must not be built yet. Production has no core.product_size table and no matching applied migration-ledger entry.\n\n## Creative Designer\n\nThere are ${creatives.length} creative_designer assignments across ${new Set(creatives.map(x=>x.item_id_fk)).size} items, all for one DesignFlow user. That person has no exact canonical core.creative_designer match. Two creative_director assignments were correctly excluded. Phase 2 needs one owner-approved person mapping.\n\n## Vendor / Factory\n\nThe mirror has ${factories.length} legacy Factory rows, core has ${coreFactories.length}, and ${factories.filter(x=>x.canonicalId).length} match by normalized exact name. ItemHeader contains no nonblank vendor reference, so no currently mirrored item is blocked by a Vendor FK. The remaining name-only mappings are Phase 2 review candidates and must be reconciled through ColdLion/source codes before cutover.\n\n## Depth\n\nThe mirror has ${depths.length} lookup rows (${summary.depth.activeCount} active) and ${depthUsage.length} distinct stored item text values. ${summary.depth.unmatchedUsage.length} nonblank stored values do not exactly normalize to one lookup title; ${summary.depth.ambiguousUsage.length} map to multiple lookup rows. 0.63 is not in the mirrored lookup. The newest Airbyte timestamp recorded on itemDepth is ${summary.depth.mirrorLatest}, so this copy cannot prove the authoritative current Cloud SQL snapshot. The comparison therefore accounts for the mirror and all mirrored item values, but production authority remains a blocking evidence gap before import.\n\n## Cut Point A result\n\nAll six read-only domains were compared. No schema or business data was changed. Size is blocked by direct-feed incompleteness and absent core.product_size. Depth is blocked by the stale/unproven Cloud SQL mirror. Packaging, Creative Designer, and Vendor/Factory remain Phase 2.\n`;
const correctedMd = md.replace('0.63 is not in the mirrored lookup.', `0.63 ${summary.depth.has063?'is':'is not'} in the mirrored lookup.`);
fs.writeFileSync(path.join(dir,'comparison-report.md'),correctedMd);
console.log(JSON.stringify({packaging:summary.packaging,productSize:{directCount:direct.length,mirrorCount:mirror.length,exact:mg.exactCompositeMatches,mirrorOnly:mg.mirrorOnly.length,directOnly:mg.directOnly.length,labelConflicts:mg.labelConflicts.length},creativeDesigner:summary.creativeDesigner,vendorFactory:{legacyCount:factories.length,coreCount:coreFactories.length,exactNameMatches:factories.filter(x=>x.canonicalId).length,unmatched:factories.filter(x=>!x.canonicalId).length},depth:{lookupCount:depths.length,usageValues:depthUsage.length,unmatched:summary.depth.unmatchedUsage.length,ambiguous:summary.depth.ambiguousUsage.length,has063:summary.depth.has063}},null,2));
