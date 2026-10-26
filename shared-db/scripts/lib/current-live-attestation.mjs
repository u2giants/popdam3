import {createHash} from 'node:crypto'
import {runGitHubCommand} from './github-transport.mjs'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {readZipEntries} from './zip-entries.mjs'

const REPOSITORY='popcre/shared-db'
const WORKFLOW='.github/workflows/production-catalog-verification-recovery.yml'
const ISSUER='https://token.actions.githubusercontent.com'
const MAX_BYTES=4*1024*1024
const FILES=['current-live-binding.json','production-catalog-verification.json']
const refuse=()=>{throw Error('Current-live attestation authentication refused')}
function bounded(bytes){if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)refuse();return bytes}

// The producer emits a two-file stored ZIP. Check sizes/method before the shared
// reader can allocate decompressed data; no extraction or artifact execution.
export function readMetadataZip(bytes){
 const b=bounded(bytes),end=b.length-22
 if(end<0||b.readUInt32LE(end)!==0x06054b50||b.readUInt16LE(end+20)!==0||b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0||b.readUInt16LE(end+8)!==2||b.readUInt16LE(end+10)!==2)refuse()
 let offset=b.readUInt32LE(end+16),total=0
 if(offset+b.readUInt32LE(end+12)!==end)refuse()
 const names=[]
 for(let i=0;i<2;i++){
  if(offset+46>end||b.readUInt32LE(offset)!==0x02014b50||b.readUInt16LE(offset+10)!==0)refuse()
  const size=b.readUInt32LE(offset+24),compressed=b.readUInt32LE(offset+20),n=b.readUInt16LE(offset+28),extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32)
  if(size!==compressed||size>MAX_BYTES/2||offset+46+n+extra+comment>end)refuse()
  names.push(b.subarray(offset+46,offset+46+n).toString('utf8'));total+=size;offset+=46+n+extra+comment
 }
 if(offset!==end||total>MAX_BYTES||names.sort().join('|')!==FILES.slice().sort().join('|'))refuse()
 const files=readZipEntries(b)
 if(files.size!==2||FILES.some(name=>!files.has(name)))refuse()
 return files
}

// Only gh's authenticated verificationResult is policy input, never raw bundle
// claims or a Git ref. Tests inject the process boundary, not a crypto verdict.
export function verifyCurrentLiveAttestation({zipBytes,bundleBytes,repositoryId,ownerId,verifierSha,runId,runAttempt},deps={}){
 bounded(zipBytes);bounded(bundleBytes);readMetadataZip(zipBytes)
 for(const id of [repositoryId,ownerId,runId,runAttempt])if(!Number.isSafeInteger(id)||id<=0)refuse()
 if(typeof verifierSha!=='string'||!/^[a-f0-9]{40}$/.test(verifierSha))refuse()
 const subjectSha256=createHash('sha256').update(zipBytes).digest('hex')
 const dir=mkdtempSync(join(tmpdir(),'current-live-attestation-'))
 let result
 try{
  const zip=join(dir,'current-live-content.zip'),bundle=join(dir,'current-live-attestation.jsonl')
  writeFileSync(zip,zipBytes,{mode:0o600});writeFileSync(bundle,bundleBytes,{mode:0o600})
  const args=['attestation','verify',zip,'--bundle',bundle,'--repo',REPOSITORY,'--signer-workflow',`${REPOSITORY}/${WORKFLOW}`,'--signer-digest',verifierSha,'--source-ref','refs/heads/main','--source-digest',verifierSha,'--cert-oidc-issuer',ISSUER,'--predicate-type','https://slsa.dev/provenance/v1','--format','json']
  result=JSON.parse((deps.execFileSync??((_command,argv,options)=>runGitHubCommand(argv,options)))('gh',args,{encoding:'utf8',timeout:60000,maxBuffer:MAX_BYTES,stdio:['ignore','pipe','pipe']}))
 }finally{rmSync(dir,{recursive:true,force:true})}
 if(!Array.isArray(result)||result.length!==1)refuse()
 const v=result[0]?.verificationResult,c=v?.signature?.certificate,s=v?.statement,p=s?.predicate,d=p?.buildDefinition,g=d?.internalParameters?.github,w=d?.externalParameters?.workflow
 const uri=`https://github.com/${REPOSITORY}`,signer=`${uri}/${WORKFLOW}@refs/heads/main`,invocation=`${uri}/actions/runs/${runId}/attempts/${runAttempt}`
 if(c?.issuer!==ISSUER||c.subjectAlternativeName!==signer||c.buildSignerURI!==signer||c.buildSignerDigest!==verifierSha||c.sourceRepositoryURI!==uri||c.sourceRepositoryDigest!==verifierSha||c.sourceRepositoryRef!=='refs/heads/main'||c.sourceRepositoryIdentifier!==String(repositoryId)||c.sourceRepositoryOwnerIdentifier!==String(ownerId)||c.runInvocationURI!==invocation||c.buildTrigger!=='workflow_dispatch')refuse()
 if(s?._type!=='https://in-toto.io/Statement/v1'||s.predicateType!=='https://slsa.dev/provenance/v1'||!Array.isArray(s.subject)||s.subject.length!==1||s.subject[0].name!=='current-live-content.zip'||Object.keys(s.subject[0].digest??{}).join()!=='sha256'||s.subject[0].digest.sha256!==subjectSha256)refuse()
 if(d?.buildType!=='https://actions.github.io/buildtypes/workflow/v1'||w?.repository!==uri||w.path!==WORKFLOW||w.ref!=='refs/heads/main'||g?.event_name!=='workflow_dispatch'||g.repository_id!==String(repositoryId)||g.repository_owner_id!==String(ownerId)||p?.runDetails?.metadata?.invocationId!==invocation)refuse()
 if(!Array.isArray(d.resolvedDependencies)||d.resolvedDependencies.length!==1||d.resolvedDependencies[0].uri!==`git+${uri}@refs/heads/main`||d.resolvedDependencies[0].digest?.gitCommit!==verifierSha)refuse()
 return {subjectSha256,repositoryId,ownerId,verifierSha,runId,runAttempt}
}
