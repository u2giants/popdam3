import test from 'node:test';
import assert from 'node:assert/strict';
import {ClaimAccounting,inspectMaintenanceLease} from './maintenance-lease';
const request=JSON.stringify({nonce:'a'.repeat(32),expires_at:2000,host:'EDGE-ALIEN'});
test('pause cannot certify active jobs, in-flight claims or exclusive work idle',()=>{
 assert.equal(inspectMaintenanceLease(request,1000,1,0,false).idle,false);
 assert.equal(inspectMaintenanceLease(request,1000,0,1,false).idle,false);
 assert.equal(inspectMaintenanceLease(request,1000,0,0,true).idle,false);
 assert.equal(inspectMaintenanceLease(request,1000,0,0,false).idle,true);
});
test('lease expiry resumes claims and wrong source identity cannot acknowledge idle',()=>{
 assert.deepEqual(inspectMaintenanceLease(request,2000,0,0,false),{pause:false});
 assert.throws(()=>inspectMaintenanceLease('{}',1000,0,0,false));
 assert.throws(()=>inspectMaintenanceLease(JSON.stringify({nonce:'a'.repeat(32),expires_at:301001,host:'EDGE-ALIEN'}),1000,0,0,false));
 assert.throws(()=>inspectMaintenanceLease(JSON.stringify({nonce:'a'.repeat(32),expires_at:2000,host:'other'}),1000,0,0,false));
});
test('returned leased job becomes active BEFORE in-flight counter clears; active job is retained',async()=>{
 const state=new ClaimAccounting();let active=0;let finish!: (result: object)=>void;
 const pending=state.claim(()=>new Promise<object>(resolve=>{finish=resolve;}),(job)=>{assert.equal(state.inFlight,1);if(job)active++;});
 assert.equal(state.inFlight,1);
 assert.equal(inspectMaintenanceLease(request,1000,active,state.inFlight,false).idle,false);
 finish({id:'already-leased-job'});await pending;
 assert.equal(state.inFlight,0);assert.equal(active,1);
 assert.equal(inspectMaintenanceLease(request,1000,active,state.inFlight,false).idle,false);
 active--;assert.equal(inspectMaintenanceLease(request,1000,active,state.inFlight,false).idle,true);
});
test('claim failure restores accounting and does not consume or fabricate a job',async()=>{
 const state=new ClaimAccounting();let accepted=false;
 await assert.rejects(state.claim(async()=>{throw new Error('provider unavailable');},()=>{accepted=true;}));
 assert.equal(state.inFlight,0);assert.equal(accepted,false);
});

test('administrative dispatch in flight prevents idle, then expiry restores normal work',async()=>{
 const dispatch=new ClaimAccounting();let complete!:()=>void;
 const pending=dispatch.claim(()=>new Promise<void>(resolve=>{complete=resolve}),()=>{});
 assert.equal(inspectMaintenanceLease(request,1000,0,dispatch.inFlight,false).idle,false);
 complete();await pending;
 assert.equal(inspectMaintenanceLease(request,1000,0,dispatch.inFlight,false).idle,true);
 assert.deepEqual(inspectMaintenanceLease(request,2000,0,dispatch.inFlight,false),{pause:false});
});
