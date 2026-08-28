#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export class EvidenceBundleError extends Error {}
export const EVIDENCE_POLICY_VERSION=1

const TOP_KEYS=new Set(['schema_version','bundle_id','identity','metadata'])
const IDENTITY_KEYS=new Set(['policy_version','migrations','focused_files','verification_files','claims','global_invalidators','migration_order_digest'])
const METADATA_KEYS=new Set(['issue','pr','claim','base_main_sha','integration_sha','review','ci'])

export function canonicalJson(value){
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function sha256(value){return createHash('sha256').update(value).digest('hex')}
export function normalizeLf(value){return String(value).replace(/\r\n?/g,'\n')}

function assertExactKeys(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new EvidenceBundleError(`${label} must be an object`)
  for(const key of Object.keys(value))if(!keys.has(key))throw new EvidenceBundleError(`${label} has unknown field ${key}`)
  for(const key of keys)if(!(key in value))throw new EvidenceBundleError(`${label} is missing ${key}`)
}
function sortedUnique(values,label){
  if(!Array.isArray(values))throw new EvidenceBundleError(`${label} must be an array`)
  const normalized=values.map((value)=>String(value).trim())
  if(normalized.some((value)=>!value)||new Set(normalized).size!==normalized.length)throw new EvidenceBundleError(`${label} must contain unique non-empty values`)
  return normalized.sort()
}
function fileRecords(paths,{readFile,fileExists}){
  return sortedUnique(paths,'file paths').map((file)=>{
    if(path.isAbsolute(file)||file.includes('..')||!fileExists(file))throw new EvidenceBundleError(`required evidence file is missing or unsafe: ${file}`)
    return {path:file.replaceAll('\\','/'),sha256:sha256(normalizeLf(readFile(file)))}
  })
}

export function buildEvidenceBundle(input,adapters){
  if(adapters.isClean()!==true)throw new EvidenceBundleError('worktree must be clean before evidence is bundled')
  const migrations=sortedUnique(input.migrations??[],'migrations').map((file)=>{
    const match=/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(file)
    if(!match)throw new EvidenceBundleError(`migration path is not versioned: ${file}`)
    if(!adapters.fileExists(file))throw new EvidenceBundleError(`required evidence file is missing: ${file}`)
    return {version:match[1],path:file,sha256:sha256(normalizeLf(adapters.readFile(file)))}
  }).sort((a,b)=>a.version.localeCompare(b.version))
  if(!migrations.length)throw new EvidenceBundleError('at least one migration is required')
  const inventory=JSON.parse(adapters.readFile('config/orchestrator-global-invalidators-v1.json'))
  if(inventory.schema_version!==1||!Array.isArray(inventory.files))throw new EvidenceBundleError('global invalidator inventory is unreadable')
  const identity={
    policy_version:EVIDENCE_POLICY_VERSION,
    migrations,
    focused_files:fileRecords(input.focusedFiles??[],adapters),
    verification_files:fileRecords(input.verificationFiles??[],adapters),
    claims:{writes:sortedUnique(input.writes??[],'claim writes'),reads:sortedUnique(input.reads??[],'claim reads')},
    global_invalidators:fileRecords(inventory.files,adapters),
    migration_order_digest:String(input.migrationOrderDigest??''),
  }
  if(!/^[0-9a-f]{64}$/.test(identity.migration_order_digest))throw new EvidenceBundleError('migration_order_digest must be sha256')
  const metadata={issue:Number(input.issue),pr:Number(input.pr),claim:Number(input.claim),base_main_sha:String(input.baseMainSha??''),integration_sha:String(input.integrationSha??''),review:input.review??null,ci:input.ci??null}
  for(const field of ['issue','pr','claim'])if(!Number.isInteger(metadata[field])||metadata[field]<=0)throw new EvidenceBundleError(`${field} must be a positive integer`)
  for(const field of ['base_main_sha','integration_sha'])if(!/^[0-9a-f]{40}$/i.test(metadata[field]))throw new EvidenceBundleError(`${field} must be an exact commit SHA`)
  return {schema_version:1,bundle_id:sha256(canonicalJson(identity)),identity,metadata}
}

export function validateEvidenceBundle(bundle){
  assertExactKeys(bundle,TOP_KEYS,'bundle');if(bundle.schema_version!==1)throw new EvidenceBundleError('schema_version must be 1')
  assertExactKeys(bundle.identity,IDENTITY_KEYS,'identity');assertExactKeys(bundle.metadata,METADATA_KEYS,'metadata')
  if(bundle.bundle_id!==sha256(canonicalJson(bundle.identity)))throw new EvidenceBundleError('bundle_id does not match canonical identity')
  return bundle
}

export function discoverModuleImports(entryFiles,{readFile,fileExists}){
  const discovered=new Set(),queue=[...entryFiles]
  while(queue.length){
    const file=queue.shift().replaceAll('\\','/');if(discovered.has(file))continue
    if(!fileExists(file))throw new EvidenceBundleError(`discovered invalidator is missing: ${file}`)
    discovered.add(file)
    const directory=path.posix.dirname(file)
    for(const match of readFile(file).matchAll(/(?:from\s+|import\s*(?:\(\s*)?)(['"])(\.\.?\/[^'"]+)\1/g)){
      let target=path.posix.normalize(path.posix.join(directory,match[2]))
      if(!path.posix.extname(target))target+='.mjs'
      if(fileExists(target))queue.push(target)
    }
  }
  return [...discovered].sort()
}

export function main(argv){
  const inputIndex=argv.indexOf('--input');if(inputIndex<0||!argv[inputIndex+1]){console.error('REFUSED: --input <json> is required');return 2}
  try{
    const root=process.cwd(),input=JSON.parse(readFileSync(argv[inputIndex+1],'utf8'))
    const adapters={readFile:(file)=>readFileSync(path.resolve(root,file),'utf8'),fileExists:(file)=>{try{readFileSync(path.resolve(root,file));return true}catch{return false}},isClean:()=>execFileSync('git',['status','--porcelain=v1'],{cwd:root,encoding:'utf8'}).trim()===''}
    console.log(JSON.stringify(buildEvidenceBundle(input,adapters),null,2));return 0
  }catch(error){console.error(`REFUSED: ${error.message}`);return 2}
}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
