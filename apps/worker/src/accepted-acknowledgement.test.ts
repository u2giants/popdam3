import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSubmissionOwnerFactory, persistAcceptedProviderAcknowledgement, type AcceptedProviderAcknowledgement, type RpcCall } from './provider-submission-recovery.js';
import { saveAcceptedAcknowledgement, reconcileHeldAcknowledgement, holdsAcceptedAcknowledgement } from './operation-loop.js';
import type { OpState } from './types.js';
const now = Date.parse('2026-10-13T19:00:00Z');
function fixture(key = 'ack-test'): AcceptedProviderAcknowledgement {
 const owner=createSubmissionOwnerFactory()('run'); const token='private-test-receipt';
 const claimed: OpState={status:'running',run_id:'run',cursor:4,started_at:'start',state_revision:10,params:{asset_ids:['one']},progress:{tagged:4},external_job:{provider:'meta-responses',phase:'submitting',model:'model',submission_owner:owner,lease_proof:createHash('md5').update(token).digest('hex'),lease_expires_at:new Date(now+60000).toISOString(),lease_claimed_at:new Date(now).toISOString(),items:[{custom_id:'one',asset_id:'one',status:'prepared'}]} as OpState['external_job']};
 return {opKey:key,owner,leaseToken:token,claimed,submitted:{...structuredClone(claimed),external_job:{...claimed.external_job!,phase:'pending',provider_batch_id:'accepted-id'}},attempts:0};
}
function envelope(ok:boolean, operation:OpState, reason='saved') {return {data:{ok,operation,state_revision:operation.state_revision,lease_receipt_issued:false,reason,provider_batch_id:operation.external_job?.provider_batch_id},error:null};}
test('submission owner stable in process and distinct across overlap',()=>{const a=createSubmissionOwnerFactory(),b=createSubmissionOwnerFactory();assert.equal(a('r'),a('r'));assert.notEqual(a('r'),b('r'));assert.match(a('r'),/^railway:r:[0-9a-f-]{36}$/);});
test('explicit revision race preserves receipt, latest lease, generic next cursor and completed status',async()=>{
 const ack=fixture();ack.submitted.cursor=19;ack.submitted.status='completed';
 const fresh=structuredClone(ack.claimed);fresh.state_revision=11;fresh.external_job!.lease_expires_at=new Date(now+120000).toISOString();let calls=0;
 const rpc:RpcCall=async(_,p)=>{calls++;assert.equal(p.p_only_if_status,'running');if(calls===1)return envelope(false,fresh,'revision_conflict');const offered=p.p_op_state as OpState;assert.equal(offered.cursor,19);assert.equal(offered.status,'completed');assert.equal(offered.external_job!.lease_expires_at,fresh.external_job!.lease_expires_at);assert.equal(offered.external_job!.lease_token,ack.leaseToken);return envelope(true,{...offered,state_revision:12});};
 assert.equal((await persistAcceptedProviderAcknowledgement(rpc,async()=>fresh,ack,()=>now)).saved,true);assert.equal(calls,2);
});
test('three conflict bound cannot reroll',async()=>{const ack=fixture();let calls=0;const rpc:RpcCall=async()=>{calls++;return envelope(false,ack.claimed,'revision_conflict');};const read=async()=>({...ack.claimed,state_revision:10+calls});assert.equal((await persistAcceptedProviderAcknowledgement(rpc,read,ack,()=>now)).saved,false);await persistAcceptedProviderAcknowledgement(rpc,read,ack,()=>now);assert.equal(calls,3);});
for(const [label,mutate] of Object.entries({
 run:(s:OpState)=>{s.run_id='foreign';},params:(s:OpState)=>{s.params={asset_ids:['foreign']};},cursor:(s:OpState)=>{s.cursor=5;},start:(s:OpState)=>{s.started_at='other';},progress:(s:OpState)=>{s.progress={tagged:5};},attempt:(s:OpState)=>{s.meta_tag_attempt={asset_id:'different'} as OpState['meta_tag_attempt'];},model:(s:OpState)=>{s.external_job!.model='other';},catalog:(s:OpState)=>{s.external_job!.meta_character_catalog_ids=['foreign'];},owner:(s:OpState)=>{s.external_job!.submission_owner='foreign';},proof:(s:OpState)=>{s.external_job!.lease_proof='foreign';},expiry:(s:OpState)=>{s.external_job!.lease_expires_at=new Date(now).toISOString();},ambiguous:(s:OpState)=>{s.external_job!.ambiguous_prior_owner='old';},revision:(s:OpState)=>{s.state_revision=11.5;},stop:(s:OpState)=>{s.status='interrupted';},replacement:(s:OpState)=>{s.external_job!.provider_batch_id='other-id';},
}))test(`revision conflict refuses changed ${label} without another save`,async()=>{const ack=fixture();const fresh=structuredClone(ack.claimed);fresh.state_revision=11;mutate(fresh);let calls=0;const rpc:RpcCall=async()=>{calls++;return envelope(false,fresh,'revision_conflict');};assert.equal((await persistAcceptedProviderAcknowledgement(rpc,async()=>fresh,ack,()=>now)).saved,false);assert.equal(calls,1);});
test('same exact accepted ID already bound while stopped acknowledges without resumed write',async()=>{const ack=fixture();const fresh={...structuredClone(ack.submitted),status:'interrupted' as const,state_revision:11};let calls=0;const rpc:RpcCall=async()=>{calls++;return envelope(false,fresh,'revision_conflict');};assert.equal((await persistAcceptedProviderAcknowledgement(rpc,async()=>fresh,ack,()=>now)).saved,true);assert.equal(calls,1);});
for(const kind of ['transport','malformed','refused'])test(`${kind} never retries persistence`,async()=>{const ack=fixture();let calls=0,reads=0;const rpc:RpcCall=async()=>{calls++;if(kind==='transport')throw Error('unknown');if(kind==='malformed')return {data:{},error:null};return envelope(false,ack.claimed,'status_mismatch');};assert.equal((await persistAcceptedProviderAcknowledgement(rpc,async()=>{reads++;return ack.claimed;},ack,()=>now)).saved,false);assert.equal(calls,1);assert.equal(reads,0);});
test('hung save and read settle at existing dependency bound without another save',async()=>{for(const phase of ['save','read']){const ack=fixture();let calls=0;const rpc:RpcCall=()=>{calls++;return phase==='save'?new Promise(()=>{}):Promise.resolve(envelope(false,ack.claimed,'revision_conflict'));};const outcome=await persistAcceptedProviderAcknowledgement(rpc,()=>new Promise(()=>{}),ack,()=>now,5);assert.equal(outcome.saved,false);assert.match(outcome.reason,/unknown/);assert.equal(calls,1);}});
test('actual operation-loop holds unknown save; later exact landed state clears RAM only',async()=>{
 const ack=fixture('late-landed');ack.claimed.external_job!.lease_expires_at=new Date(Date.now()+60000).toISOString();ack.submitted.external_job!.lease_expires_at=ack.claimed.external_job!.lease_expires_at;
 let saves=0;const rpc:RpcCall=async()=>{saves++;throw Error('response lost');};assert.equal((await saveAcceptedAcknowledgement(ack,rpc,async()=>null)).saved,false);assert.equal(holdsAcceptedAcknowledgement(ack.opKey),true);
 assert.equal(reconcileHeldAcknowledgement(ack.opKey,ack.claimed),true);assert.equal(saves,1);assert.equal(reconcileHeldAcknowledgement(ack.opKey,ack.submitted),false);assert.equal(saves,1);
 assert.equal(reconcileHeldAcknowledgement('unknown-64',{status:'interrupted',cursor:64}),false);
});
test('real Meta adapter makes one POST across three guarded persistence conflicts',async()=>{
 const {createStoredMetaResponse,retrieveStoredMetaResponse}=await import('./meta-model-api.js');const original=globalThis.fetch;let posts=0,saves=0;
 globalThis.fetch=async(_url,init)=>{if(init?.method==='POST'){posts++;return new Response('data: {"type":"response.created","response":{"id":"accepted-id"}}\n\n');}return new Response('{"id":"accepted-id","status":"completed"}');};
 try{const ack=fixture('one-post-integration');ack.claimed.external_job!.lease_expires_at=new Date(Date.now()+60000).toISOString();ack.submitted.external_job!.lease_expires_at=ack.claimed.external_job!.lease_expires_at;
 ack.submitted.external_job!.provider_batch_id=await createStoredMetaResponse('test',{model:'meta-direct/muse-spark-1.3-contributor',messages:[]},60000,ack.owner);
 const rpc:RpcCall=async()=>{saves++;return envelope(false,ack.claimed,'revision_conflict');};const read=async()=>({...ack.claimed,state_revision:10+saves});
 assert.equal((await saveAcceptedAcknowledgement(ack,rpc,read)).saved,false);assert.equal(posts,1);assert.equal(saves,3);assert.equal(holdsAcceptedAcknowledgement(ack.opKey),true);
 reconcileHeldAcknowledgement(ack.opKey,ack.submitted);await retrieveStoredMetaResponse('test','accepted-id',60000);
 }finally{globalThis.fetch=original;}
});
