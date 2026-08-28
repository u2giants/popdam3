#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPreviewGraph, assertAcyclic } from './preview-graph.mjs'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'

export function selectPreviewRoute(input){
  try{
    if(!/^[0-9a-f]{40}$/i.test(String(input.head_sha??''))||!Number.isInteger(input.pr)||!Number.isInteger(input.issue))throw new Error('exact issue, PR and head are required')
    if(!/^[0-9a-f]{64}$/.test(String(input.bundle_id??'')))throw new Error('bundle identity is unavailable')
    if(!Array.isArray(input.versions)||!input.versions.length||input.versions.some((version)=>!/^\d{14}$/.test(String(version))))throw new Error('versions must be a non-empty 14-digit array')
    if(input.dependency_closure_complete!==true)throw new Error('migration dependency closure is not proven')
    const claims=[...(input.claims??[])]
    if(!claims.some((claim)=>claim.pr===input.pr))claims.push({issue:input.issue,pr:input.pr,versions:input.versions,merged:Boolean(input.merged)})
    const graph=assertAcyclic(buildPreviewGraph({mainVersions:input.main_versions,previewVersions:input.preview_versions,claims}))
    const requested=new Set(input.versions.map(String)),main=new Set(input.main_versions.map(String)),preview=new Set(input.preview_versions.map(String))
    const blockers=graph.edges.filter((edge)=>requested.has(edge.to)&&!requested.has(edge.from)).map((edge)=>edge.from)
    let route,reason
    if(blockers.length){route='WAITING';reason=`preview contains unmerged predecessor(s): ${[...new Set(blockers)].join(', ')}`}
    else if([...requested].every((version)=>preview.has(version))){
      if(input.original_apply_evidence?.type!=='preview-apply'||!/^[0-9]+$/.test(String(input.original_apply_evidence.run_id??'')))throw new Error('already-applied versions require typed original preview-apply evidence')
      route=input.merged?'PREVIEW_REBIND':'HISTORICAL_RECOVERY';reason='requested bytes already exist on preview; never reapply'
    }else if(input.merged){
      if(![...requested].every((version)=>main.has(version)))throw new Error('merged route versions are not all on current main')
      route='POST_MERGE_REHEARSAL';reason='merged versions are absent from preview'
    }else{route='NORMAL_PREVIEW';reason='open exact-head versions are absent from preview'}
    const context={issue:input.issue,pr:input.pr,head_sha:input.head_sha,bundle_id:input.bundle_id,versions:[...requested].sort(),graph_digest:graph.digest,route,blockers:[...new Set(blockers)].sort()}
    return {status:route==='WAITING'?'WAITING':'READY',route,reason,context,decision_id:sha256(canonicalJson(context)),graph}
  }catch(error){return {status:'UNVERIFIABLE',route:'UNVERIFIABLE',reason:error.message}}
}

export function main(argv){const index=argv.indexOf('--input');if(index<0||!argv[index+1]){console.error('REFUSED: --input <json> is required');return 2}try{const result=selectPreviewRoute(JSON.parse(readFileSync(argv[index+1],'utf8')));console.log(JSON.stringify(result,null,2));return result.status==='UNVERIFIABLE'?2:0}catch(error){console.error(`REFUSED: ${error.message}`);return 2}}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
