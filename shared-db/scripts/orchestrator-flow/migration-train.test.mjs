import assert from 'node:assert/strict'
import test from 'node:test'
import { proposeTrain, validateTrain, transitionTrain, MigrationTrainError } from './migration-train.mjs'
const h=(c,n=40)=>c.repeat(n), entries=(n=10)=>Array.from({length:n},(_,i)=>({version:`20260912${String(i).padStart(6,'0')}`,file_sha256:h((i%9+1).toString(),64),source_pr:100+i,merge_sha:h(((i+1)%9+1).toString()),dependencies:i?[`20260912${String(i-1).padStart(6,'0')}`]:[],risk_class:'ddl-compatible',role:'postgres',preview_assertion:`preview-${i}`,production_assertion:`prod-${i}`}))
function fixture(n=10){const es=entries(n),manifest=proposeTrain({target:'production',target_identity:'project:prod',base_main_sha:h('a'),entries:es}),proof={main_sha:h('a'),target_identity:'project:prod',available_roles:['postgres'],applied_versions:[],main_migrations:{},merge_in_main:{},preview_assertions:{},production_assertions:{}};for(const e of es){proof.main_migrations[e.version]={file_sha256:e.file_sha256,source_pr:e.source_pr,merge_sha:e.merge_sha};proof.merge_in_main[e.merge_sha]=true;proof.preview_assertions[e.version]={assertion:e.preview_assertion,result:'passed'};proof.production_assertions[e.version]={assertion:e.production_assertion,result:'passed'}}return{manifest,proof}}
test('ten compatible migrations form one immutable validated train',()=>{const {manifest,proof}=fixture();assert.equal(validateTrain(manifest,proof).entries.length,10)})
test('missing dependency refuses by migration and dependency',()=>{const {manifest,proof}=fixture(2);manifest.entries[1].dependencies=['20250101000000'];const rebuilt=proposeTrain(manifest);assert.throws(()=>validateTrain(rebuilt,proof),/migration .* missing an earlier dependency 20250101000000/)})
test('superseded migration refuses by name',()=>{const {manifest,proof}=fixture(1);proof.superseded_versions=[manifest.entries[0].version];assert.throws(()=>validateTrain(manifest,proof),/superseded/)})
test('absent database role refuses by name',()=>{const {manifest,proof}=fixture(1);proof.available_roles=[];assert.throws(()=>validateTrain(manifest,proof),/requires absent database role/)})
test('mixed risk classes refuse together',()=>{const {manifest,proof}=fixture(2),es=manifest.entries.map((e,i)=>({...e,risk_class:i?'grant-change':e.risk_class})),mixed=proposeTrain({...manifest,entries:es});assert.throws(()=>validateTrain(mixed,proof),/mixed risk classes/)})
test('stale main, target, hash, merge and assertion proof each refuse',()=>{for(const mutate of [p=>p.main_sha=h('b'),p=>p.target_identity='other',p=>p.main_migrations[Object.keys(p.main_migrations)[0]].file_sha256=h('f',64),p=>p.merge_in_main[Object.keys(p.merge_in_main)[0]]=false,p=>p.preview_assertions[Object.keys(p.preview_assertions)[0]]='wrong']){const {manifest,proof}=fixture(1);mutate(proof);assert.throws(()=>validateTrain(manifest,proof),MigrationTrainError)}})
test('mid-train failure records only an exact proper prefix and recovery is forward-only',()=>{const {manifest,proof}=fixture(3),valid=validateTrain(manifest,proof),refs=new Map(),io={createImmutable:(r,d,x)=>refs.has(r)?false:(refs.set(r,{digest:d,record:x}),true),readImmutable:r=>refs.get(r)};const auth=transitionTrain(valid,'authorized',io,{authorization_digest:h('b',64),current_main_sha:h('a'),target_identity:'project:prod'}),run=transitionTrain(auth,'dispatched',io),failed=transitionTrain(run,'failed',io,{applied_prefix:[manifest.entries[0].version]});assert.deepEqual(failed.applied_prefix,[manifest.entries[0].version]);assert.equal(transitionTrain(failed,'dispatched',io).state,'dispatched');assert.throws(()=>transitionTrain(run,'failed',io,{applied_prefix:[manifest.entries[1].version]}),/exact proper applied prefix/);assert.throws(()=>transitionTrain(run,'authorized',io),/cannot move/)})
test('immutable or stale authorization refuses rather than overwrites',()=>{const {manifest,proof}=fixture(1),valid=validateTrain(manifest,proof),refs=new Map(),io={createImmutable:(r,d,x)=>refs.has(r)?false:(refs.set(r,{digest:d,record:x}),true),readImmutable:r=>refs.get(r)},args={authorization_digest:h('b',64),current_main_sha:h('a'),target_identity:'project:prod'};transitionTrain(valid,'authorized',io,args);assert.throws(()=>transitionTrain(valid,'authorized',io,{...args,authorization_digest:h('c',64)}),/conflicting immutable/);assert.throws(()=>transitionTrain(valid,'authorized',io,{...args,current_main_sha:h('c')}),/exact current main/)})
test('out-of-order train and failed assertion refuse',()=>{const es=entries(2);assert.throws(()=>proposeTrain({target:'production',target_identity:'project:prod',base_main_sha:h('a'),entries:[es[1],es[0]]}),/strictly version ordered/);const {manifest,proof}=fixture(1);proof.preview_assertions[manifest.entries[0].version].result='failed';assert.throws(()=>validateTrain(manifest,proof),/exact passing/)})

// Manager commands and workflow integration (#2729, popcre/ai-devops#401 Step 6).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { main } from '../manage-migration-author-lanes.mjs'

function managerFixture(n=2){
  const {manifest,proof}=fixture(n),files={},refs=new Map(),commits=new Map()
  let mainSha=h('a')
  const es=manifest.entries.map((entry)=>{const body=`-- ${entry.version}\nselect 1;\n`;files[`supabase/migrations/${entry.version}_train.sql`]=body;return {...entry,file_sha256:createHash('sha256').update(body).digest('hex')}})
  const rebuilt=proposeTrain({...manifest,entries:es})
  for(const entry of es)proof.main_migrations[entry.version].file_sha256=entry.file_sha256
  const raw={mainSha:()=>mainSha,treeFiles:()=>Object.keys(files),getFileAt:(file)=>files[file],
    makeOwnerCommit:(message)=>{const sha=createHash('sha1').update(message).digest('hex');commits.set(sha,{message});return sha},
    createRef:(ref,sha)=>refs.has(ref)?false:(refs.set(ref,sha),true),readRef:(ref)=>refs.get(ref)??null,getCommit:(sha)=>commits.get(sha),
    listRefs:(prefix)=>[...refs].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha}))}
  const dir=mkdtempSync(path.join(tmpdir(),'train-'))
  const write=(name,value)=>{const file=path.join(dir,name);writeFileSync(file,JSON.stringify(value));return file}
  const run=(argv)=>{const out=[],err=[],log=console.log,error=console.error;console.log=(v)=>out.push(v);console.error=(v)=>err.push(v);try{const code=main(argv,new Date(),raw);return{code,out:out.length?JSON.parse(out.join('\n')):null,err:err.join('\n')}}finally{console.log=log;console.error=error}}
  return {manifest:rebuilt,proof,files,write,run,setMain:(sha)=>{mainSha=sha}}
}

test('manager propose, validate, authorize, dispatch, verify and close one exact train',()=>{
  const f=managerFixture(2),proofFile=f.write('proof.json',f.proof)
  const proposed=f.run(['--propose-train',f.write('input.json',{target:'production',target_identity:'project:prod',base_main_sha:h('a'),entries:f.manifest.entries})])
  assert.equal(proposed.code,0,proposed.err);assert.equal(proposed.out.train_id,f.manifest.train_id)
  const validated=f.run(['--validate-train',f.write('m.json',proposed.out),'--train-proof',proofFile]);assert.equal(validated.out.validated,true,validated.err)
  const authorized=f.run(['--authorize-train',f.write('m.json',proposed.out),'--train-proof',proofFile,'--authorization-digest',h('b',64),'--target-identity','project:prod'])
  assert.equal(authorized.code,0,authorized.err);assert.match(authorized.out.ref,/^refs\/db-migration-trains\/[0-9a-f]{64}\/000002-authorized$/)
  const dispatched=f.run(['--dispatch-train',f.write('a.json',authorized.out.record)])
  assert.equal(dispatched.code,0,dispatched.err)
  const inputs=dispatched.out.workflow_inputs,versions=f.manifest.entries.map((e)=>e.version).join(',')
  assert.deepEqual(inputs,{target:'production',commit_sha:h('a'),production_allowlist:versions,migration_train_ref:dispatched.out.ref})
  const verify=(extra={})=>f.run(['--verify-train-dispatch',inputs.migration_train_ref,'--target',extra.target??'production','--commit-sha',extra.commit??h('a'),'--allowlist',extra.allowlist??versions])
  const good=verify();assert.equal(good.code,0,good.err)
  for(const [extra,pattern] of [[{target:'preview'},/dispatch target preview is not the train target production/],[{commit:h('c')},/dispatch commit c{40} is not the train main/],[{allowlist:f.manifest.entries[0].version},/is not the exact train list/]]){const r=verify(extra);assert.equal(r.code,2);assert.match(r.err,pattern)}
  const closed=f.run(['--close-train',f.write('d.json',dispatched.out.record)])
  assert.equal(closed.code,0,closed.err);assert.equal(closed.out.record.state,'closed')
  const reused=verify();assert.equal(reused.code,2);assert.match(reused.err,/is superseded by .*000004-closed/)
})

test('manager train commands refuse changed file hash, stale main, forged record, bad prefix and foreign ref',()=>{
  const f=managerFixture(2),auth=(g)=>['--authorize-train',g.write('m.json',g.manifest),'--train-proof',g.write('proof.json',g.proof),'--authorization-digest',h('b',64),'--target-identity','project:prod']
  f.files[Object.keys(f.files)[0]]+='-- edited\n'
  let r=f.run(auth(f));assert.equal(r.code,2);assert.match(r.err,/hashes to [0-9a-f]{64} on current main, not the train hash/)
  const g=managerFixture(2)
  g.setMain(h('e'));r=g.run(auth(g));assert.equal(r.code,2);assert.match(r.err,/train is stale: main is e{40}/)
  g.setMain(h('a'));const ok=g.run(auth(g));assert.equal(ok.code,0,ok.err)
  r=g.run(['--dispatch-train',g.write('forged.json',{...ok.out.record,authorization_digest:h('c',64)})]);assert.equal(r.code,2);assert.match(r.err,/not the exact immutable record/)
  const d=g.run(['--dispatch-train',g.write('a.json',ok.out.record)]);assert.equal(d.code,0,d.err)
  r=g.run(['--close-train',g.write('d.json',d.out.record),'--failed-applied-prefix',g.manifest.entries[1].version]);assert.equal(r.code,2);assert.match(r.err,/exact proper applied prefix/)
  r=g.run(['--close-train',g.write('d.json',d.out.record),'--failed-applied-prefix',g.manifest.entries[0].version]);assert.equal(r.code,0,r.err);assert.deepEqual(r.out.record.applied_prefix,[g.manifest.entries[0].version])
  r=g.run(['--verify-train-dispatch','refs/heads/main','--target','production','--commit-sha',h('a'),'--allowlist','x']);assert.equal(r.code,2);assert.match(r.err,/needs a refs\/db-migration-trains\/ ref/)
})

test('the migrations workflow verifies a train dispatch in validate, which every apply job needs',()=>{
  const workflow=readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../.github/workflows/shared-supabase-migrations.yml'),'utf8')
  const inputs=workflow.slice(workflow.indexOf('    inputs:'),workflow.indexOf('\n  validate:')).match(/^      [a-z_]+:$/gm)
  assert.ok(inputs.includes('      migration_train_ref:'))
  assert.ok(inputs.length<=25,`workflow_dispatch allows at most 25 inputs; found ${inputs.length}`)
  const validate=workflow.slice(workflow.indexOf('\n  validate:'),workflow.indexOf('\n    needs:'))
  assert.match(validate,/if: github\.event_name == 'workflow_dispatch' && inputs\.migration_train_ref != ''[\s\S]*?node scripts\/manage-migration-author-lanes\.mjs --verify-train-dispatch "\$TRAIN_REF"/)
  assert.match(validate,/node --test scripts\/orchestrator-flow\/migration-train\.test\.mjs/)
  const needs=workflow.match(/^    needs: .+$/gm)
  assert.ok(needs.length>=5&&needs.every((line)=>/validate/.test(line)))
})
