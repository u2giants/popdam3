import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync} from 'node:fs'
import {verifyCurrentLiveAttestation,readMetadataZip} from './current-live-attestation.mjs'
const sha='a'.repeat(40),uri='https://github.com/popcre/shared-db',workflow='.github/workflows/production-catalog-verification-recovery.yml',signer=`${uri}/${workflow}@refs/heads/main`,invocation=`${uri}/actions/runs/101/attempts/2`
const zip=(files={'current-live-binding.json':'{}','production-catalog-verification.json':'{}'},compression=0)=>execFileSync('python3',['-c','import sys,json,zipfile,io; b=io.BytesIO(); z=zipfile.ZipFile(b,"w",compression=int(sys.argv[1])); [z.writestr(k,v) for k,v in json.load(sys.stdin).items()]; z.close(); sys.stdout.buffer.write(b.getvalue())',String(compression)],{input:JSON.stringify(files)})
function fixture(){
 const zipBytes=zip(),hash=createHash('sha256').update(zipBytes).digest('hex')
 // Shape pinned to actual gh verificationResult from the official cli/cli
 // attest-demo fixture and authenticated current-live run40258907625. This injected result tests policy, not cryptography.
 const certificate={issuer:'https://token.actions.githubusercontent.com',subjectAlternativeName:signer,buildSignerURI:signer,buildSignerDigest:sha,sourceRepositoryURI:uri,sourceRepositoryDigest:sha,sourceRepositoryRef:'refs/heads/main',sourceRepositoryIdentifier:'11',sourceRepositoryOwnerIdentifier:'12',runInvocationURI:invocation,buildTrigger:'workflow_dispatch'}
 const statement={_type:'https://in-toto.io/Statement/v1',subject:[{name:'current-live-content.zip',digest:{sha256:hash}}],predicateType:'https://slsa.dev/provenance/v1',predicate:{buildDefinition:{buildType:'https://actions.github.io/buildtypes/workflow/v1',externalParameters:{workflow:{repository:uri,path:workflow,ref:'refs/heads/main'}},internalParameters:{github:{event_name:'workflow_dispatch',repository_id:'11',repository_owner_id:'12'}},resolvedDependencies:[{uri:`git+${uri}@refs/heads/main`,digest:{gitCommit:sha}}]},runDetails:{metadata:{invocationId:invocation}}}}
 const result=[{verificationResult:{signature:{certificate},statement}}]
 const input={zipBytes,bundleBytes:Buffer.from('fixture bundle'),repositoryId:11,ownerId:12,verifierSha:sha,runId:101,runAttempt:2}
 return {input,result,certificate,statement,run:()=>JSON.stringify(result)}
}
test('verifier pins installed gh cryptographic boundary and cleans private files',()=>{
 const f=fixture();let paths
 const result=verifyCurrentLiveAttestation(f.input,{execFileSync:(cmd,args,opts)=>{
  assert.equal(cmd,'gh');assert.equal(opts.timeout,60000);assert.deepEqual(args.slice(0,2),['attestation','verify']);paths=[args[2],args[4]]
  for(const [flag,value] of [['--repo','popcre/shared-db'],['--signer-workflow',`popcre/shared-db/${workflow}`],['--signer-digest',sha],['--source-digest',sha],['--source-ref','refs/heads/main'],['--cert-oidc-issuer','https://token.actions.githubusercontent.com'],['--format','json']])assert.equal(args[args.indexOf(flag)+1],value)
  return f.run()
 }})
 assert.equal(result.subjectSha256,createHash('sha256').update(f.input.zipBytes).digest('hex'));assert.ok(paths.every(p=>!existsSync(p)))
})
test('crypto failure, malformed output, raw unsigned statement and ambiguous results refuse',()=>{
 for(const run of [()=>{throw Error('invalid signature')},()=>'',()=>JSON.stringify({statement:{}}),()=>JSON.stringify([{},{}]),()=>JSON.stringify([{attestation:{statement:{}}}])])assert.throws(()=>verifyCurrentLiveAttestation(fixture().input,{execFileSync:run}))
})
test('each authenticated certificate identity is independently enforced',()=>{
 for(const key of Object.keys(fixture().certificate)){
  const f=fixture();f.certificate[key]='foreign';assert.throws(()=>verifyCurrentLiveAttestation(f.input,{execFileSync:f.run}),undefined,key)
 }
 for(const key of ['repositoryId','ownerId','runId','runAttempt'])for(const value of [0,'11',1.5,Number.MAX_SAFE_INTEGER+1]){const f=fixture();f.input[key]=value;let called=false;assert.throws(()=>verifyCurrentLiveAttestation(f.input,{execFileSync:()=>{called=true;return f.run()}}));assert.equal(called,false)}
})
test('copied valid verification cannot authorize changed bytes, source, target identifiers or workflow',()=>{
 const mutations=[f=>{f.input.zipBytes=zip({'current-live-binding.json':'{"target":"foreign"}','production-catalog-verification.json':'{}'})},f=>{f.input.verifierSha='b'.repeat(40)},f=>{f.input.repositoryId=13},f=>{f.input.ownerId=13},f=>{f.input.runId=102},f=>{f.input.runAttempt=3},f=>{f.statement.subject[0].digest.sha256='f'.repeat(64)},f=>{f.statement.subject.push(f.statement.subject[0])},f=>{f.statement.predicate.buildDefinition.externalParameters.workflow.path='foreign.yml'},f=>{f.statement.predicate.buildDefinition.internalParameters.github.repository_id='13'},f=>{f.statement.predicate.buildDefinition.internalParameters.github.repository_owner_id='13'},f=>{f.statement.predicate.buildDefinition.internalParameters.github.event_name='pull_request'},f=>{f.statement.predicate.runDetails.metadata.invocationId=invocation+'/other'},f=>{f.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit='b'.repeat(40)}]
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>verifyCurrentLiveAttestation(f.input,{execFileSync:f.run}))}
})
test('ZIP accepts only bounded exact two metadata files before any inflation',()=>{
 assert.equal(readMetadataZip(zip()).size,2)
 for(const bytes of [Buffer.from('invalid'),zip({'current-live-binding.json':'{}'}),zip({'current-live-binding.json':'{}','production-catalog-verification.json':'{}','business-rows.json':'[]'}),zip({'../current-live-binding.json':'{}','production-catalog-verification.json':'{}'}),zip(undefined,8),Buffer.alloc(4*1024*1024+1)])assert.throws(()=>readMetadataZip(bytes))
})

test('only the actual GitHub Actions workflow buildType is admitted',()=>{
 const f=fixture();
 assert.equal(f.statement.predicate.buildDefinition.buildType,'https://actions.github.io/buildtypes/workflow/v1');
 assert.doesNotThrow(()=>verifyCurrentLiveAttestation(f.input,{execFileSync:f.run}));
 for(const type of ['https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1','https://actions.github.io/buildtypes/workflow/v2','https://example.com/buildtypes/workflow/v1','',null]){
  const wrong=fixture();wrong.statement.predicate.buildDefinition.buildType=type;
  assert.throws(()=>verifyCurrentLiveAttestation(wrong.input,{execFileSync:wrong.run}));
 }
});
