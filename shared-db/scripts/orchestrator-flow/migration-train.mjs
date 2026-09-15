import { canonicalJson, sha256 } from './evidence-bundle.mjs'

export class MigrationTrainError extends Error {}
export const TRAIN_REF_PREFIX='refs/db-migration-trains'
export const TRAIN_STATES=Object.freeze(['proposed','authorized','dispatched','closed','failed'])
const VERSION=/^\d{14}$/, SHA=/^[0-9a-f]{40}$/i, DIGEST=/^[0-9a-f]{64}$/i

function requireExactEntries(entries){
  if(!Array.isArray(entries)||!entries.length)throw new MigrationTrainError('train requires a nonempty exact migration list')
  const seen=new Set()
  const normalized=entries.map((raw,index)=>{
    const entry={version:String(raw.version??''),file_sha256:String(raw.file_sha256??''),source_pr:Number(raw.source_pr),merge_sha:String(raw.merge_sha??''),dependencies:[...(raw.dependencies??[])].map(String).sort(),risk_class:String(raw.risk_class??''),role:String(raw.role??''),preview_assertion:String(raw.preview_assertion??''),production_assertion:String(raw.production_assertion??'')}
    if(!VERSION.test(entry.version)||!DIGEST.test(entry.file_sha256)||!Number.isInteger(entry.source_pr)||entry.source_pr<1||!SHA.test(entry.merge_sha)||!entry.risk_class||!entry.role||!entry.preview_assertion||!entry.production_assertion)throw new MigrationTrainError(`migration at position ${index+1} is missing exact identity, role, risk, or assertions`)
    if(seen.has(entry.version))throw new MigrationTrainError(`migration ${entry.version} appears more than once`);seen.add(entry.version)
    if(entry.dependencies.some((v)=>!VERSION.test(v)))throw new MigrationTrainError(`migration ${entry.version} has an invalid dependency`)
    return entry
  })
  for(let i=1;i<normalized.length;i++)if(normalized[i-1].version>=normalized[i].version)throw new MigrationTrainError('train migration list must be strictly version ordered')
  return normalized
}

export function proposeTrain({target,target_identity,base_main_sha,entries}){
  if(!target||!target_identity||!SHA.test(String(base_main_sha??'')))throw new MigrationTrainError('train requires exact target identity and current main SHA')
  const record={schema_version:1,target:String(target),target_identity:String(target_identity),base_main_sha:String(base_main_sha).toLowerCase(),entries:requireExactEntries(entries)}
  const manifest_digest=sha256(canonicalJson(record)),train_id=manifest_digest
  return {...record,manifest_digest,train_id,state:'proposed',generation:1}
}

export function validateTrain(manifest,proof){
  const expected=proposeTrain(manifest)
  if(manifest.train_id!==expected.train_id||manifest.manifest_digest!==expected.manifest_digest)throw new MigrationTrainError('train manifest identity or digest is stale')
  if(proof.main_sha!==manifest.base_main_sha)throw new MigrationTrainError('train authorization is stale because current main moved')
  if(proof.target_identity!==manifest.target_identity)throw new MigrationTrainError('train target identity changed')
  const versions=new Set(manifest.entries.map((e)=>e.version)),risks=new Set(manifest.entries.map((e)=>e.risk_class)),roles=new Set(proof.available_roles??[]),ledger=new Set(proof.applied_versions??[]),forbidden=new Set(proof.forbidden_versions??[]),superseded=new Set(proof.superseded_versions??[])
  if(risks.size!==1)throw new MigrationTrainError(`mixed risk classes refuse: ${[...risks].join(', ')}`)
  for(const entry of manifest.entries){
    const live=proof.main_migrations?.[entry.version]
    if(!live||live.file_sha256!==entry.file_sha256||live.source_pr!==entry.source_pr||live.merge_sha!==entry.merge_sha||proof.merge_in_main?.[entry.merge_sha]!==true)throw new MigrationTrainError(`migration ${entry.version} is not exactly merged on current main`)
    if(ledger.has(entry.version))throw new MigrationTrainError(`migration ${entry.version} is already applied on the exact target`)
    if(forbidden.has(entry.version))throw new MigrationTrainError(`migration ${entry.version} is forbidden`)
    if(superseded.has(entry.version))throw new MigrationTrainError(`migration ${entry.version} is superseded`)
    if(!roles.has(entry.role))throw new MigrationTrainError(`migration ${entry.version} requires absent database role ${entry.role}`)
    for(const dependency of entry.dependencies)if(!ledger.has(dependency)&&(!versions.has(dependency)||manifest.entries.findIndex((x)=>x.version===dependency)>=manifest.entries.findIndex((x)=>x.version===entry.version)))throw new MigrationTrainError(`migration ${entry.version} is missing an earlier dependency ${dependency}`)
    const preview=proof.preview_assertions?.[entry.version],production=proof.production_assertions?.[entry.version]
    if(preview?.assertion!==entry.preview_assertion||preview?.result!=='passed'||production?.assertion!==entry.production_assertion||production?.result!=='passed')throw new MigrationTrainError(`migration ${entry.version} lacks exact passing preview/production assertion coverage`)
  }
  return {...manifest,validated:true,risk_class:[...risks][0]}
}

export function transitionTrain(manifest,next,io,{authorization_digest=null,current_main_sha=null,target_identity=null,applied_prefix=[]}={}){
  const allowed={proposed:['authorized'],authorized:['dispatched'],dispatched:['closed','failed'],failed:['dispatched'],closed:[]}
  if(!TRAIN_STATES.includes(next)||!allowed[manifest.state]?.includes(next))throw new MigrationTrainError(`train cannot move from ${manifest.state} to ${next}`)
  if(next==='authorized'&&(manifest.validated!==true||!DIGEST.test(String(authorization_digest??''))||current_main_sha!==manifest.base_main_sha||target_identity!==manifest.target_identity))throw new MigrationTrainError('authorization requires a validated manifest, exact current main and target, and policy-evidence digest')
  const exact=manifest.entries.map((e)=>e.version),prefix=[...applied_prefix].map(String)
  if(next==='failed'&&(prefix.some((v,i)=>v!==exact[i])||prefix.length>=exact.length))throw new MigrationTrainError('failure must record the exact proper applied prefix for forward recovery')
  const record={...manifest,state:next,generation:Number(manifest.generation??1)+1,...(authorization_digest?{authorization_digest}:{}),...(next==='failed'?{applied_prefix:prefix}:{}),previous_digest:sha256(canonicalJson(manifest))}
  const digest=sha256(canonicalJson(record)),ref=`${TRAIN_REF_PREFIX}/${manifest.train_id}/${String(record.generation).padStart(6,'0')}-${next}`
  if(!io.createImmutable(ref,digest,record)){const prior=io.readImmutable(ref);if(prior?.digest!==digest)throw new MigrationTrainError(`conflicting immutable ${next} record already exists`)}
  return record
}
