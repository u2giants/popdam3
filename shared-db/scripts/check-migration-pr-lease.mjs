#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { dispatchObjectKeys } from './check-pr-object-collisions.mjs'
import { parseAuthorLease, REPO } from './manage-migration-author-lanes.mjs'

export class LeaseCheckError extends Error {}
const normalize = (x) => String(x).trim().replace(/\s+/g,' ').toLowerCase()

export function declarationCoversActual(declared, actual) {
  if (declared.has(actual)) return true
  const column = /^column ([a-z_][a-z0-9_$]*\.[a-z_][a-z0-9_$]*)\.[a-z_][a-z0-9_$]*$/.exec(actual)
  return Boolean(column && declared.has(`table ${column[1]}`))
}

export function validateMigrationLease({ claims, branch, files, now = new Date(), reservationExists }) {
  const migrations=files.filter(f=>f.filename?.startsWith('supabase/migrations/')&&f.filename.endsWith('.sql')&&f.status!=='removed')
  if (!migrations.length) return { relevant:false }
  const matching=[]
  for(const claim of claims){
    let lease
    try{ lease=parseAuthorLease(claim.body,now) }catch(error){ throw new LeaseCheckError(`claim #${claim.number} is unreadable: ${error.message}`) }
    if(!lease.legacy && lease.branch===branch) matching.push({...claim,lease})
  }
  if(matching.length!==1) throw new LeaseCheckError(`migration PR branch ${branch} must have exactly one active ref-backed claim; found ${matching.length}`)
  const holder=matching[0]
  if(!holder.lease.active) throw new LeaseCheckError(`claim #${holder.number} is expired`)
  const declared=new Set(holder.lease.objects.map(normalize))
  const actual=new Set()
  const versions=new Set()
  for(const file of migrations){
    const version=path.basename(file.filename).slice(0,14)
    if(!/^\d{14}$/.test(version)) throw new LeaseCheckError(`${file.filename} has no 14-digit migration version`)
    versions.add(version)
    if(!String(file.sql??'').trim()) throw new LeaseCheckError(`${file.filename} returned empty SQL`)
    for(const object of dispatchObjectKeys(file.sql)) actual.add(normalize(object))
  }
  if(versions.size!==1 || !versions.has(holder.lease.version)) throw new LeaseCheckError(`migration version must exactly match claim #${holder.number}`)
  if(!reservationExists(holder.lease.version)) throw new LeaseCheckError(`permanent reservation ref is missing for ${holder.lease.version}`)
  const undeclared=[...actual].filter(x=>!declarationCoversActual(declared,x))
  if(undeclared.length) throw new LeaseCheckError(`migration writes undeclared objects: ${undeclared.join(', ')}`)
  return { relevant:true, claim:holder.number, version:holder.lease.version, objects:[...actual].sort() }
}

function gh(args){try{return execFileSync('gh',args,{encoding:'utf8',maxBuffer:64*1024*1024})}catch(e){throw new LeaseCheckError(`GitHub read failed: ${e.stderr||e.message}`)}}
function json(args){const raw=gh(args);try{return JSON.parse(raw)}catch{throw new LeaseCheckError('GitHub returned malformed JSON')}}
export function flattenPages(result, endpoint='GitHub API'){if(!Array.isArray(result)||result.some(x=>!Array.isArray(x)))throw new LeaseCheckError(`GitHub pagination for ${endpoint} is malformed`);return result.flat()}
function pages(endpoint){return flattenPages(json(['api','--paginate','--slurp',endpoint]),endpoint)}
function rawFile(filename,ref){return gh(['api','-H','Accept: application/vnd.github.raw',`repos/${REPO}/contents/${filename.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`])}

export function gatherPrInput(env=process.env){
  let event={};if(env.GITHUB_EVENT_PATH)event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'))
  const number=Number(env.PR_NUMBER||event.pull_request?.number);if(!number)throw new LeaseCheckError('PR number is unavailable')
  const pr=json(['api',`repos/${REPO}/pulls/${number}`]);if(!pr?.head?.sha||!pr?.head?.ref)throw new LeaseCheckError('PR head branch/SHA is unavailable')
  const apiFiles=pages(`repos/${REPO}/pulls/${number}/files?per_page=100`)
  if(Number(pr.changed_files)!==apiFiles.length)throw new LeaseCheckError(`incomplete PR pagination: expected ${pr.changed_files}, received ${apiFiles.length}`)
  if(apiFiles.length>=3000)throw new LeaseCheckError('GitHub REST file limit reached; collision coverage is incomplete')
  const files=apiFiles.map(f=>({...f,sql:f.status==='removed'||!f.filename?.endsWith('.sql')?'':rawFile(f.filename,pr.head.sha)}))
  const issues=pages(`repos/${REPO}/issues?state=open&labels=db-claim&per_page=100`)
  return {claims:issues.filter(x=>!x.pull_request).map(x=>({number:x.number,body:x.body})),branch:pr.head.ref,files,reservationExists:(version)=>{try{return Boolean(json(['api',`repos/${REPO}/git/ref/db-claims/${version}`])?.object?.sha)}catch{return false}}}
}

export function main(env=process.env){try{const result=validateMigrationLease(gatherPrInput(env));console.log(result.relevant?`Migration claim verified: #${result.claim}, version ${result.version}.`:'No migration files changed; claim check is not applicable.');return 0}catch(e){console.error(`REFUSED: ${e.message}`);return 2}}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exitCode=main()
