#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const INVALIDATION_CLASSES=Object.freeze(['CONTENT_INVALIDATED','GLOBAL_INVALIDATOR','OBJECT_INTERACTION','INTEGRATION_REFRESH_ONLY','UNVERIFIABLE'])
export class InvalidationError extends Error {}

function overlaps(a,b){const right=new Set(b??[]);return (a??[]).some((value)=>right.has(value))}

export function classifyInvalidation(input){
  try{
    for(const field of ['reviewed_bundle_id','current_bundle_id'])if(!/^[0-9a-f]{64}$/.test(String(input[field]??'')))throw new InvalidationError(`${field} is unavailable`)
    if(!Array.isArray(input.changed_files)||!Array.isArray(input.global_invalidators))throw new InvalidationError('changed_files and global_invalidators are required arrays')
    if(input.reviewed_bundle_id!==input.current_bundle_id)return {class:'CONTENT_INVALIDATED',requires:['new-bundle','new-review','new-downstream-evidence'],reason:'canonical bundle content changed'}
    const global=input.changed_files.filter((file)=>input.global_invalidators.includes(file))
    if(global.length)return {class:'GLOBAL_INVALIDATOR',requires:['new-bundle','new-review'],reason:`global invalidator changed: ${global.join(', ')}`}
    const interactions=input.intervening_changes??[]
    const issueWrites=input.claims?.writes??[],issueReads=input.claims?.reads??[]
    for(const change of interactions){
      if(overlaps(issueWrites,[...(change.writes??[]),...(change.reads??[])])||overlaps(issueReads,change.writes??[]))return {class:'OBJECT_INTERACTION',requires:['focused-review','integration-evidence'],reason:`intervening object interaction ${change.id??'unknown'}`}
    }
    if(input.history_available!==true||input.full_ci_success!==true||input.merge_base_is_current_main!==true)throw new InvalidationError('current integration history or full CI is not proven')
    if(!/^[0-9a-f]{40}$/i.test(String(input.integration_sha??''))||input.integration_sha!==input.evidence_integration_sha)throw new InvalidationError('integration SHA binding is unavailable or mismatched')
    return {class:'INTEGRATION_REFRESH_ONLY',requires:['collision-check','migration-order-check','full-ci'],preserve_review:true,reason:'bundle identical and intervening changes proven disjoint'}
  }catch(error){return {class:'UNVERIFIABLE',requires:['full-refresh','new-review'],reason:error.message}}
}

export function main(argv){
  const index=argv.indexOf('--input');if(index<0||!argv[index+1]){console.error('REFUSED: --input <json> is required');return 2}
  try{const result=classifyInvalidation(JSON.parse(readFileSync(argv[index+1],'utf8')));console.log(JSON.stringify(result,null,2));return result.class==='UNVERIFIABLE'?2:0}catch(error){console.error(`REFUSED: ${error.message}`);return 2}
}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
