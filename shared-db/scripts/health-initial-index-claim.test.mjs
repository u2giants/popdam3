import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyMaintenanceClaim,maintenanceExclusive} from './index-maintenance-receipt.mjs'
import {EXCLUSIVE_REFS} from './lib/lanes/queue-routing.mjs'
const kind='health-initial/v1'
const request={kind,operation_id:'health-dam-errored-5622',claim_issue:5622,work_issue:5622,
 objects:['index public.dam_search_health_errored_idx','index public.dam_search_health_errored_preview_5622'],
 reads:['table public.dam_search_documents']}
function claim(number=5622,writes=request.objects,reads=request.reads){
 return {number,title:`CLAIM: #${number} exact health source`,body:[
  '```db-claim','version: 29990101000000','objects:',...writes.map(x=>'  - '+x),'```',
  '```db-work-scope','status: ready','work_type: structural','route: claim-first','change_type: index','priority: 60',
  'writes:',...writes.map(x=>'  - '+x),'reads:',...reads.map(x=>'  - '+x),'```'].join('\n')}
}
const io=(others=[])=>({openClaims:()=>[claim(),...others]})
test('exact fixed index writes and declared table read admit with owner-scope hash',()=>{
 const result=verifyMaintenanceClaim(request,io());assert.equal(result.admitted,true);assert.match(result.scope_sha256,/^[a-f0-9]{64}$/)
})
test('unknown operation, arbitrary table, mode, owner, names or missing dependency refuse',()=>{
 for(const patch of [{operation_id:'health-arbitrary'},{kind:'unknown'},{claim_issue:99},{work_issue:99},{objects:request.objects.slice(1)},
  {objects:[request.objects[0],'index public.foreign']},{reads:['table public.assets']},{reads:[]}]){
  assert.throws(()=>verifyMaintenanceClaim({...request,...patch},io()))
 }
})
test('claim must explicitly cover both writes and the dependency read',()=>{
 for(const owner of [claim(5622,request.objects.slice(1)),claim(5622,request.objects,[]),claim(9)]){
  assert.throws(()=>verifyMaintenanceClaim(request,{openClaims:()=>[owner]}))
 }
})
test('foreign table WRITE blocks own table READ; never hide broad maintenance ownership',()=>{
 const foreign=claim(5681,['table public.dam_search_documents'],[])
 assert.throws(()=>verifyMaintenanceClaim(request,io([foreign])),/conflicts/)
})
test('legacy broad table WRITE remains exclusive even without typed scope',()=>{
 const foreign={number:5681,title:'CLAIM: #5681',body:'```db-claim\nversion: 29990101000001\nobjects:\n  - table public.dam_search_documents\n```'}
 assert.throws(()=>verifyMaintenanceClaim(request,io([foreign])),/conflicts/)
})
test('foreign READ or WRITE on either exact index blocks own index WRITE',()=>{
 for(const foreign of [claim(8,[request.objects[0]],[]),claim(8,['function public.unrelated'],[request.objects[1]])]){
  assert.throws(()=>verifyMaintenanceClaim(request,io([foreign])),/conflicts/)
 }
})
test('read/read table dependency is permitted without widening index writes',()=>{
 const foreign=claim(8,['function public.unrelated'],request.reads)
 assert.equal(verifyMaintenanceClaim(request,io([foreign])).admitted,true)
})
test('present malformed foreign scope fails closed',()=>{
 const foreign=claim(8,['function public.unrelated'],request.reads)
 foreign.body=foreign.body.replace('change_type: index','change_type: invalid')
 assert.throws(()=>verifyMaintenanceClaim(request,io([foreign])))
})
test('owner scope change changes receipt identity without depending on prose notes',()=>{
 const before=verifyMaintenanceClaim(request,io()).scope_sha256
 const changed=claim(5622,[...request.objects,'function public.get_search_embedding_health'],request.reads)
 const after=verifyMaintenanceClaim(request,{openClaims:()=>[changed]}).scope_sha256
 assert.notEqual(before,after)
 changed.body+='\nAdditional public continuity note.'
 assert.equal(verifyMaintenanceClaim(request,{openClaims:()=>[changed]}).scope_sha256,after)
})
function lockIo(){
 const refs=new Map(),commits=new Map();let n=0
 return {refs,readRef:r=>refs.get(r)??null,getCommit:s=>({message:commits.get(s)}),
  makeOwnerCommit:m=>{const s=String(++n);commits.set(s,m);return s},
  createRef:(r,s)=>{if(refs.has(r))return false;refs.set(r,s);return true},deleteRef:r=>refs.delete(r),
  readCommitMessage:s=>commits.get(s),mainSha:()=> 'a'.repeat(40),getPr:()=>({merged:true,merge_commit_sha:'a'.repeat(40)}),
  compareCommits:()=>({status:'identical',behind_by:0}),openClaims:()=>[claim()]}
}
test('health uses the existing preview lane and exact fencing; no alternate lease',()=>{
 const state=lockIo(),r={target:'preview',run_id:123,source_pr:1,head_sha:'a'.repeat(40),claim:request}
 r.lease=maintenanceExclusive('acquire',r,state)
 assert.equal(state.refs.get(EXCLUSIVE_REFS.preview),r.lease.ownerSha)
 assert.equal(maintenanceExclusive('assert',r,state).holderId,r.lease.holderId)
 maintenanceExclusive('release',r,state)
 assert.equal(state.refs.has(EXCLUSIVE_REFS.preview),false)
})
test('existing foreign preview or production lane is never adopted or released',()=>{
 for(const target of ['preview','production']){
  const state=lockIo(),ref=EXCLUSIVE_REFS[target];state.refs.set(ref,'foreign-operation')
  const r={target,run_id:123,source_pr:1,head_sha:'a'.repeat(40),claim:request}
  assert.throws(()=>maintenanceExclusive('acquire',r,state));assert.equal(state.refs.get(ref),'foreign-operation')
 }
})
test('wrong target cannot assert or release own actual preview lease',()=>{
 const state=lockIo(),r={target:'preview',run_id:123,source_pr:1,head_sha:'a'.repeat(40),claim:request}
 r.lease=maintenanceExclusive('acquire',r,state);const before=state.refs.get(EXCLUSIVE_REFS.preview)
 for(const mode of ['assert','release'])assert.throws(()=>maintenanceExclusive(mode,{...r,target:'production'},state))
 assert.equal(state.refs.get(EXCLUSIVE_REFS.preview),before)
 maintenanceExclusive('release',r,state)
})
