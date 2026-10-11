import test from 'node:test';
import assert from 'node:assert/strict';
import {ClaimAccounting,inspectMaintenanceLease,HeartbeatDelivery} from './maintenance-lease';
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

test('lease arriving during HTTP cannot lose already-delivered commands or acknowledge idle',async()=>{
 const delivery=new HeartbeatDelivery();let receive!: (r:{commands:{restart:boolean}})=>void;
 let dispatchDone!:()=>void;let calls=0;
 const pending=delivery.deliver(undefined,()=>new Promise<{commands:{restart:boolean}}>(r=>{receive=r}),async response=>{
  assert.equal(response.commands.restart,true);calls++;
  await new Promise<void>(r=>{dispatchDone=r});
 });
 const lease={nonce:'a'.repeat(32),expires_at:2000};
 assert.equal(delivery.inFlight,1);assert.equal(delivery.confirmedFor(lease,1000),false);
 receive({commands:{restart:true}});await new Promise(r=>setImmediate(r));
 assert.equal(calls,1);assert.equal(delivery.inFlight,1);assert.equal(delivery.confirmedFor(lease,1000),false);
 dispatchDone();await pending;
 assert.equal(delivery.inFlight,0);assert.equal(delivery.confirmedFor(lease,1000),false);
});
test('old backend still dispatches consumed commands, accepted current nonce permits idle only until expiry',async()=>{
 const delivery=new HeartbeatDelivery();const lease={nonce:'a'.repeat(32),expires_at:2000};let calls=0;
 await delivery.deliver(lease,async()=>({commands:{sample:true}}),async r=>{assert.equal(r.commands.sample,true);calls++});
 assert.equal(calls,1);assert.equal(delivery.confirmedFor(lease,1000),false);
 await delivery.deliver(lease,async()=>({command_deferral:lease,commands:{}}),async()=>{});
 assert.equal(delivery.confirmedFor(lease,1000),true);
 assert.equal(delivery.confirmedFor({...lease,nonce:'b'.repeat(32)},1000),false);
 assert.equal(delivery.confirmedFor(lease,2000),false);
 await delivery.deliver(undefined,async()=>({commands:{sample:true}}),async()=>{calls++});
 assert.equal(calls,2);assert.equal(delivery.confirmedFor(lease,1000),false);
});

test('actual TIFF and hygiene loops pause claims and count HTTP before await through completion',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const ts=await import('typescript');
 const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
 for(const name of ['startTiffScanChecker','startTiffPolling','startTiffReinspectPolling','startHygieneScanChecker']) {
  const parsed=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
  const declaration=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)!;
  const body=declaration.getText(parsed);
  const callbacks:Array<()=>Promise<void>>=[];let paused=true;let finish!:(value:unknown)=>void;let claims=0;
  const context:any={auxiliaryWork:0,activeJobs:0,claimAccounting:{inFlight:0},heartbeatDelivery:{inFlight:0},
   isBackfillingPdfText:false,isBackfillingSgPdfText:false,isSamplingPdfText:false,isRunningCompatAudit:false,isRunningCompatAuditPreview:false,
   getUpdateState:()=>({updating:false}),configReceived:true,healthStatus:{healthy:true},tiffScanRunning:false,hygieneScanRunning:false,
   agentId:'test',logger:{info:()=>{},debug:()=>{},error:()=>{}},
   maintenancePausesClaims:()=>paused,setTimeout:(fn:()=>Promise<void>)=>callbacks.push(fn),
   api:{callApi:()=>{claims++;return new Promise(resolve=>{finish=resolve})}}};
  vm.runInNewContext(ts.transpileModule(body+`\n${name}();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  await callbacks.shift()!();assert.equal(claims,0,name+' refuses new claim while paused');
  paused=false;const running=callbacks.shift()!();
  assert.equal(claims,1);assert.equal(context.auxiliaryWork,1,name+' counts before HTTP await');
  paused=true;assert.equal(inspectMaintenanceLease(request,1000,0,context.auxiliaryWork,false).idle,false);
  finish({request:null,jobs:[]});await running;
  assert.equal(context.auxiliaryWork,0,name+' releases only after returned work finishes');
  if(name==='startTiffScanChecker'||name==='startHygieneScanChecker') {
   let nasDone!:(value:unknown)=>void;
   Object.assign(context,{cloudNasMountPath:'Z:',cloudNasHost:'read-host',cloudNasShare:'mac',cloudNasUsername:'user',cloudNasPassword:'private',
    ensureNasMapped:()=>new Promise(resolve=>{nasDone=resolve})});
   context.api.callApi=async(action:string)=>action.startsWith('claim-')?{request:{request_id:'owned'}}:{};
   paused=false;const work=callbacks.shift()!();await new Promise(resolve=>setImmediate(resolve));
   assert.equal(context.auxiliaryWork,1,name+' retains count through NAS work after claim returned');
   paused=true;assert.equal(inspectMaintenanceLease(request,1000,0,context.auxiliaryWork,false).idle,false);
   nasDone({ok:false,error:'bounded-test'});await work;
   assert.equal(context.auxiliaryWork,0,name+' releases after completion report');
  }
 }
});
