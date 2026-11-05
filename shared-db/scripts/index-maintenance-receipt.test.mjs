import test from 'node:test'
import assert from 'node:assert/strict'
import {createReceipt,readReceipt,validateRef} from './index-maintenance-receipt.mjs'
const ref='refs/db-index-maintenance/synthetic-operation/preview/started'
function io(){const refs=new Map(),commits=new Map();let n=0;return {refs,commits,readRef:r=>refs.get(r)??null,getCommit:s=>({message:commits.get(s)}),makeOwnerCommit:m=>{const s=String(++n);commits.set(s,m);return s},createRef:(r,s)=>{if(refs.has(r))return false;refs.set(r,s);return true}}}
test('receipt refs reject other authority namespaces and injection',()=>{for(const r of ['refs/heads/main',ref+';drop','refs/db-index-maintenance/../preview/started',ref.replace('/preview/','/unknown/')])assert.throws(()=>validateRef(r))})
test('canonical immutable create reads back exact content',()=>{const state=io(),record={phase:'started',source_sha:'a'.repeat(40)};assert.equal(readReceipt(ref,state),null);assert.deepEqual(createReceipt(ref,record,state),record);assert.deepEqual(readReceipt(ref,state),record)})
test('same receipt is idempotent and conflicting receipt never updates',()=>{const state=io();createReceipt(ref,{a:1},state);const before=state.refs.get(ref);assert.deepEqual(createReceipt(ref,{a:1},state),{a:1});assert.throws(()=>createReceipt(ref,{a:2},state));assert.equal(state.refs.get(ref),before)})
test('unrecognized commit payload and excessive records refuse',()=>{const state=io();state.refs.set(ref,'bad');state.commits.set('bad','unrelated');assert.throws(()=>readReceipt(ref,state));assert.throws(()=>createReceipt(ref,{body:'x'.repeat(33000)},io()))})

import {verifyMaintenanceClaim} from './index-maintenance-receipt.mjs'
import {EXCLUSIVE_REFS} from './lib/lanes/queue-routing.mjs'
import {pairKindForExclusiveKind} from './lib/lanes/exclusive-policy.mjs'
const objects=['table public.style_guide_search_documents','index public.original','index public.replacement','index public.retired']
const request={claim_issue:99,work_issue:5616,objects}
function claim(number=99,workIssue=5616,writes=objects,expiry='2099-01-01T00:00:00Z'){
 return {number,title:`CLAIM: #${workIssue} index maintenance`,body:['```db-claim','version: 29990101000000','objects:',...writes.map(w=>'  - '+w),'```','','```db-author-lease','owner: synthetic-test','branch: codex/synthetic','worktree: /tmp/synthetic','expires_at: '+expiry,'```'].join('\n')}
}
test('maintenance shares existing preview exclusive ref and compatibility role',()=>{assert.equal(EXCLUSIVE_REFS['preview-maintenance'],EXCLUSIVE_REFS.preview);assert.equal(pairKindForExclusiveKind('preview-maintenance'),'preview')})
test('exact native live claim admits all fixed writes',()=>assert.deepEqual(verifyMaintenanceClaim(request,{openClaims:()=>[claim()]}),{admitted:true,claim_issue:99,work_issue:5616}))
test('missing incomplete or differently owned work claim refuses',()=>{
 for(const claims of [[],[claim(100)],[claim(99,777)],[claim(99,5616,objects.slice(1))]])assert.throws(()=>verifyMaintenanceClaim(request,{openClaims:()=>claims}))
})
test('expired foreign claim still protects its colliding object',()=>assert.throws(()=>verifyMaintenanceClaim(request,{openClaims:()=>[claim(),claim(100,777,[objects[0]],'2020-01-01T00:00:00Z')]})))

test('retired author lease clocks do not block an exact open object claim',()=>{assert.equal(verifyMaintenanceClaim(request,{openClaims:()=>[claim(99,5616,objects,'2020-01-01T00:00:00Z')]}).admitted,true);const current=claim();current.body=current.body.split('```db-author-lease')[0].trim();assert.equal(verifyMaintenanceClaim(request,{openClaims:()=>[current]}).admitted,true)})

import {maintenanceExclusive} from './index-maintenance-receipt.mjs'
function lockIo(){
 const state=io();state.deleteRef=ref=>state.refs.delete(ref);state.readCommitMessage=sha=>state.commits.get(sha);state.mainSha=()=> 'a'.repeat(40);state.getPr=()=>({merged:true,merge_commit_sha:'a'.repeat(40)});state.compareCommits=()=>({status:'identical',behind_by:0});state.openClaims=()=>[claim()];return state
}
test('actual native exclusive manager acquires fences and releases the existing preview ref',()=>{
 const state=lockIo(),r={target:'preview',run_id:123,source_pr:1,head_sha:'a'.repeat(40),claim:request}
 r.lease=maintenanceExclusive('acquire',r,state)
 assert.equal(state.refs.get(EXCLUSIVE_REFS.preview),r.lease.ownerSha)
 assert.equal(maintenanceExclusive('assert',r,state).holderId,r.lease.holderId)
 maintenanceExclusive('release',r,state)
 assert.equal(state.refs.has(EXCLUSIVE_REFS.preview),false)
})
test('actual native production manager refuses overlapping merge and preserves that owner',()=>{
 const state=lockIo();state.refs.set(EXCLUSIVE_REFS.merge,'foreign-merge')
 const r={target:'production',run_id:123,source_pr:1,head_sha:'a'.repeat(40),claim:request}
 assert.throws(()=>maintenanceExclusive('acquire',r,state),/guarded merge/)
 assert.equal(state.refs.get(EXCLUSIVE_REFS.merge),'foreign-merge')
})
const repackRequest={kind:'table-repack/v1',operation_id:'repack-assets-804',claim_issue:5742,work_issue:5745,objects:['table public.assets']}
test('repack admits only the exact allowlisted table on its own open claim',()=>{
 const own=claim(5742,5745,['table public.assets','extension pg_repack','schema repack'])
 assert.deepEqual(verifyMaintenanceClaim(repackRequest,{openClaims:()=>[own]}),{admitted:true,claim_issue:5742,work_issue:5745,kind:'table-repack/v1'})
 for(const bad of [{...repackRequest,objects:['table public.style_groups']},{...repackRequest,objects:['table public.assets','table public.assets']},{...repackRequest,operation_id:'sg-x'},{...repackRequest,kind:'other'},{...repackRequest,operation_id:'repack-'+'a'.repeat(34)}])assert.throws(()=>verifyMaintenanceClaim(bad,{openClaims:()=>[own]}))
 assert.throws(()=>verifyMaintenanceClaim(repackRequest,{openClaims:()=>[claim(5742,5745,['extension pg_repack'])]}))
 assert.throws(()=>verifyMaintenanceClaim(repackRequest,{openClaims:()=>[own,claim(6000,6000,['table public.assets'])]}))
})
