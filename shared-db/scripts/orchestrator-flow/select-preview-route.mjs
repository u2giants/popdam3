#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPreviewGraph, assertAcyclic } from './preview-graph.mjs'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'

export const PREVIEW_CLASSIFIER_VERSION = 1
export const NO_DATABASE_PREVIEW = 'NO_DATABASE_PREVIEW'
export const DATABASE_PREVIEW_REQUIRED = 'DATABASE_PREVIEW_REQUIRED'
const NO_PREVIEW_IMPACTS = new Set(['documentation','reviewer-tooling','ci-workflow','read-only-test','application-only'])
const PREVIEW_REQUIRED_IMPACTS = new Set(['database-structure','database-behavior','database-permission','database-data','generated','ambiguous'])
const INVALIDATION_CONDITIONS = Object.freeze(['file-content-change','file-set-change','impact-evidence-change','applicable-check-change','classifier-version-change'])

export function databasePreviewRequiredFromEvidenceBundle(bundle){
  const identity=bundle?.identity
  if(!identity||bundle.bundle_id!==sha256(canonicalJson(identity)))throw new Error('database evidence bundle identity is unavailable or changed')
  const target={repository:'u2giants/shared-db',issue:bundle?.metadata?.issue,pr:bundle?.metadata?.pr,base_sha:bundle?.metadata?.base_main_sha,head_sha:bundle?.metadata?.integration_sha}
  if(!Number.isInteger(target.issue)||!Number.isInteger(target.pr)||!/^[0-9a-f]{40}$/i.test(String(target.base_sha??''))||!/^[0-9a-f]{40}$/i.test(String(target.head_sha??'')))throw new Error('database evidence bundle target identity is unavailable')
  const byPath=new Map()
  const add=(rows,impact,reason)=>{for(const row of rows??[]){const existing=byPath.get(row.path);if(existing&&existing.sha256!==row.sha256)throw new Error(`database evidence bundle disagrees on ${row.path}`);byPath.set(row.path,{path:row.path,sha256:row.sha256,impact,reason})}}
  add(identity.migrations,'database-structure','versioned migration executes against the database')
  add(identity.focused_files,'read-only-test','database contract evidence remains applicable')
  add(identity.verification_files,'database-behavior','production verification contract observes database behavior')
  add(identity.global_invalidators,'generated','global database guard input invalidates prior qualification')
  const files=[...byPath.values()].sort((a,b)=>a.path.localeCompare(b.path)),applicable_checks=['database-preview','exact-head-review','full-ci']
  const firstRequired=files.find((file)=>PREVIEW_REQUIRED_IMPACTS.has(file.impact))
  if(!firstRequired)throw new Error('database evidence bundle names no preview-requiring input')
  return {schema_version:1,...target,decision:DATABASE_PREVIEW_REQUIRED,reason_code:`impact_${firstRequired.impact.replaceAll('-','_')}`,inspected_digest:sha256(canonicalJson({classifier_version:PREVIEW_CLASSIFIER_VERSION,...target,files,applicable_checks})),files,applicable_checks,invalidated_by:[...INVALIDATION_CONDITIONS]}
}

export function bindSenderPreviewClassification(value,inspectedFiles,target){
  const keys=['schema_version','decision','reason_code','base_sha','head_sha','inspected_digest','files','applicable_checks','invalidated_by']
  if(!value||Object.keys(value).some(key=>!keys.includes(key))||value.schema_version!==1||value.base_sha!==target.base_sha||value.head_sha!==target.head_sha||!Array.isArray(value.files)||!Array.isArray(value.applicable_checks))throw new Error('sender preview identity or schema is invalid')
  if(canonicalJson(value.invalidated_by)!==canonicalJson(INVALIDATION_CONDITIONS))throw new Error('sender preview invalidation conditions changed')
  const expectedDigest=sha256(canonicalJson({classifier_version:1,base_sha:value.base_sha,head_sha:value.head_sha,files:value.files,applicable_checks:value.applicable_checks}))
  if(value.inspected_digest!==expectedDigest)throw new Error('sender preview digest does not match its inputs')
  const live=new Map(inspectedFiles.map(file=>[file.path,file]))
  if(live.size!==inspectedFiles.length||value.files.length!==live.size||new Set(value.files.map(file=>file.path)).size!==live.size)throw new Error('sender preview file set differs from live Git')
  const files=value.files.map(file=>{
    const actual=live.get(file.path)
    if(Object.keys(file).some(key=>!['path','sha256','mode','impact','reason','change_type'].includes(key))||!actual||file.sha256!==actual.sha256||file.mode!==actual.mode||file.impact!==actual.impact||file.change_type!==(actual.status==='removed'?'deleted':'present'))throw new Error('sender preview file identity or impact differs from live Git')
    const {impact,...identity}=actual
    return {...identity,impact,reason:file.reason}
  }).sort((a,b)=>a.path.localeCompare(b.path))
  const bound={...value,...target,files,inspected_digest:sha256(canonicalJson({classifier_version:PREVIEW_CLASSIFIER_VERSION,...target,files,applicable_checks:value.applicable_checks}))}
  return validatePreviewClassification(bound,inspectedFiles,target)
}

export function validatePreviewClassification(value,inspectedFiles,target){
  if(!value||value.schema_version!==1||!Array.isArray(value.files)||!value.files.length)throw new Error('explicit schema-version-1 database preview classification is required')
  const known=new Set(['schema_version','repository','issue','pr','base_sha','head_sha','decision','reason_code','inspected_digest','files','applicable_checks','invalidated_by'])
  if(Object.keys(value).some((key)=>!known.has(key)))throw new Error('database preview classification contains an unknown input')
  if(![NO_DATABASE_PREVIEW,DATABASE_PREVIEW_REQUIRED].includes(value.decision))throw new Error('database preview decision is unknown')
  if(!target||value.repository!==target.repository||value.issue!==target.issue||value.pr!==target.pr||value.base_sha!==target.base_sha||value.head_sha!==target.head_sha)throw new Error('database preview classification target does not match exact repository, issue, PR, base and head')
  if(!Array.isArray(value.applicable_checks)||!value.applicable_checks.length||value.applicable_checks.some((check)=>typeof check!=='string'||!check.trim()))throw new Error('database preview classification requires applicable checks')
  if(new Set(value.applicable_checks).size!==value.applicable_checks.length)throw new Error('database preview classification has duplicate applicable checks')
  if(canonicalJson(value.invalidated_by)!==canonicalJson(INVALIDATION_CONDITIONS))throw new Error('database preview invalidation conditions are incomplete or changed')
  const normalizeSide=(side,label)=>{if(side===null)return null;if(!side||Object.keys(side).some((key)=>!['mode','type','blob_sha','sha256'].includes(key))||typeof side.mode!=='string'||typeof side.type!=='string'||!/^[0-9a-f]{40}$/.test(String(side.blob_sha??''))||!/^[0-9a-f]{64}$/.test(String(side.sha256??'')))throw new Error(`database preview classification has invalid ${label} Git identity`);return{mode:side.mode,type:side.type,blob_sha:side.blob_sha,sha256:side.sha256}}
  const seen=new Set(),files=value.files.map((entry)=>{
    if(!entry||Object.keys(entry).some((key)=>!['path','previous_path','status','mode','blob_sha','sha256','base','head','impact','reason'].includes(key)))throw new Error('database preview classification file contains an unknown input')
    const normalized=String(entry?.path??'').replaceAll('\\','/')
    if(!normalized||normalized.startsWith('/')||normalized.split('/').includes('..')||seen.has(normalized))throw new Error('database preview classification has an unsafe or duplicate inspected path')
    seen.add(normalized)
    if(!/^[0-9a-f]{64}$/.test(String(entry?.sha256??'')))throw new Error(`database preview classification has an invalid file digest for ${normalized}`)
    const hasGitIdentity=entry.status!==undefined||entry.mode!==undefined||entry.blob_sha!==undefined
    if((value.decision===NO_DATABASE_PREVIEW||hasGitIdentity)&&(!['added','modified','removed','renamed','copied','changed','unchanged'].includes(entry?.status)||!/^100(?:644|755)$/.test(String(entry?.mode??''))||!/^[0-9a-f]{40}$/.test(String(entry?.blob_sha??''))))throw new Error(`database preview classification has invalid Git identity for ${normalized}`)
    if(!NO_PREVIEW_IMPACTS.has(entry?.impact)&&!PREVIEW_REQUIRED_IMPACTS.has(entry?.impact))throw new Error(`database preview classification has unknown impact for ${normalized}`)
    if(typeof entry?.reason!=='string'||!entry.reason.trim())throw new Error(`database preview classification has no impact reason for ${normalized}`)
    const history=entry.base!==undefined||entry.head!==undefined||entry.previous_path!==undefined?{...(entry.previous_path!==undefined?{previous_path:String(entry.previous_path).replaceAll('\\','/')}:{}),base:normalizeSide(entry.base,'base'),head:normalizeSide(entry.head,'head')}:{ }
    if(value.decision===NO_DATABASE_PREVIEW&&Object.keys(history).length&&((entry.status==='added'&&history.base!==null)||(entry.status!=='added'&&history.base===null)||(entry.status==='removed'&&history.head!==null)||(entry.status!=='removed'&&history.head===null)))throw new Error(`database preview classification has incomplete side history for ${normalized}`)
    return {path:normalized,...history,...(hasGitIdentity?{status:entry.status,mode:entry.mode,blob_sha:entry.blob_sha}:{}),sha256:entry.sha256,impact:entry.impact,reason:entry.reason.trim()}
  }).sort((a,b)=>a.path.localeCompare(b.path))
  const checks=[...new Set(value.applicable_checks.map((check)=>check.trim()))].sort()
  if(!Array.isArray(inspectedFiles)||!inspectedFiles.length)throw new Error('exact inspected file set is required independently of the preview decision')
  const authoritative=inspectedFiles.map((entry)=>{const hasGitIdentity=entry?.status!==undefined||entry?.mode!==undefined||entry?.blob_sha!==undefined,history=entry?.base!==undefined||entry?.head!==undefined||entry?.previous_path!==undefined?{...(entry.previous_path!==undefined?{previous_path:String(entry.previous_path).replaceAll('\\','/')}:{}),base:normalizeSide(entry.base,'base'),head:normalizeSide(entry.head,'head')}:{ };return{path:String(entry?.path??'').replaceAll('\\','/'),...history,...(hasGitIdentity?{status:entry.status,mode:entry.mode,blob_sha:entry.blob_sha}:{}),sha256:String(entry?.sha256??'')}}).sort((a,b)=>a.path.localeCompare(b.path))
  const malformed=authoritative.some((entry)=>!entry.path||!/^[0-9a-f]{64}$/.test(entry.sha256)||(value.decision===NO_DATABASE_PREVIEW&&(!['added','modified','removed','renamed','copied','changed','unchanged'].includes(entry.status)||!/^100(?:644|755)$/.test(String(entry.mode??''))||!/^[0-9a-f]{40}$/.test(String(entry.blob_sha??'')))))
  if(malformed||new Set(authoritative.map((entry)=>entry.path)).size!==authoritative.length)throw new Error('exact inspected file set is malformed')
  if(canonicalJson(authoritative)!==canonicalJson(files.map(({path,previous_path,base,head,status,mode,blob_sha,sha256})=>({path,...(previous_path!==undefined?{previous_path}:{}),...(base!==undefined||head!==undefined?{base,head}:{}),...(status!==undefined?{status,mode,blob_sha}:{}),sha256}))))throw new Error('database preview classification does not cover the exact inspected Git objects and bytes')
  const inspectedDigest=sha256(canonicalJson({classifier_version:PREVIEW_CLASSIFIER_VERSION,repository:value.repository,issue:value.issue,pr:value.pr,base_sha:value.base_sha,head_sha:value.head_sha,files,applicable_checks:checks}))
  if(value.inspected_digest!==inspectedDigest)throw new Error('database preview classification digest does not match its exact inspected inputs')
  const required=files.filter((file)=>PREVIEW_REQUIRED_IMPACTS.has(file.impact))
  const expectedDecision=required.length?DATABASE_PREVIEW_REQUIRED:NO_DATABASE_PREVIEW
  const expectedReason=required.length?`impact_${required[0].impact.replaceAll('-','_')}`:'proven_non_database_change'
  if(value.decision!==expectedDecision||value.reason_code!==expectedReason)throw new Error('database preview decision or reason does not match inspected impacts')
  return {schema_version:1,repository:value.repository,issue:value.issue,pr:value.pr,base_sha:value.base_sha,head_sha:value.head_sha,decision:expectedDecision,reason_code:expectedReason,inspected_digest:inspectedDigest,files,applicable_checks:checks,invalidated_by:[...INVALIDATION_CONDITIONS]}
}

export function selectPreviewRoute(input){
  try{
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(input.repository??''))||!/^[0-9a-f]{40}$/i.test(String(input.head_sha??''))||!/^[0-9a-f]{40}$/i.test(String(input.base_sha??''))||!Number.isInteger(input.pr)||!Number.isInteger(input.issue))throw new Error('exact repository, issue, PR, base and head are required')
    if(!/^[0-9a-f]{64}$/.test(String(input.bundle_id??'')))throw new Error('bundle identity is unavailable')
    const classification=validatePreviewClassification(input.database_preview,input.inspected_files,{repository:input.repository,issue:input.issue,pr:input.pr,base_sha:input.base_sha,head_sha:input.head_sha})
    if(classification.decision===NO_DATABASE_PREVIEW){
      const context={repository:input.repository,issue:input.issue,pr:input.pr,base_sha:input.base_sha,head_sha:input.head_sha,bundle_id:input.bundle_id,route:NO_DATABASE_PREVIEW,classification_digest:classification.inspected_digest,reason_code:classification.reason_code,applicable_checks:classification.applicable_checks}
      return {status:'READY',route:NO_DATABASE_PREVIEW,reason:'exact inspected inputs prove no database preview is applicable',context,decision_id:sha256(canonicalJson(context)),classification}
    }
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
      if(!['preview-apply','preview-ledger-reconciliation'].includes(input.original_apply_evidence?.type)||!/^[0-9]+$/.test(String(input.original_apply_evidence.run_id??'')))throw new Error('already-applied versions require typed immutable preview evidence')
      route=input.merged?'PREVIEW_REBIND':'HISTORICAL_RECOVERY';reason='requested bytes already exist on preview; never reapply'
    }else if(input.merged){
      if(![...requested].every((version)=>main.has(version)))throw new Error('merged route versions are not all on current main')
      route='POST_MERGE_REHEARSAL';reason='merged versions are absent from preview'
    }else{route='NORMAL_PREVIEW';reason='open exact-head versions are absent from preview'}
    const context={repository:input.repository,issue:input.issue,pr:input.pr,base_sha:input.base_sha,head_sha:input.head_sha,bundle_id:input.bundle_id,versions:[...requested].sort(),graph_digest:graph.digest,route,blockers:[...new Set(blockers)].sort(),classification_digest:classification.inspected_digest,reason_code:classification.reason_code}
    return {status:route==='WAITING'?'WAITING':'READY',route,reason,context,decision_id:sha256(canonicalJson(context)),graph}
  }catch(error){return {status:'UNVERIFIABLE',route:'UNVERIFIABLE',reason:error.message}}
}

export function main(argv){const index=argv.indexOf('--input');if(index<0||!argv[index+1]){console.error('REFUSED: --input <json> is required');return 2}try{const result=selectPreviewRoute(JSON.parse(readFileSync(argv[index+1],'utf8')));console.log(JSON.stringify(result,null,2));return result.status==='UNVERIFIABLE'?2:0}catch(error){console.error(`REFUSED: ${error.message}`);return 2}}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
