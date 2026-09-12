import test from 'node:test';import assert from 'node:assert/strict'
import { readyRecord,persistInitialReady,preparePreviewDispatch,terminalizeReady,repairPreviewReady,reconcileFlow,ReconcileError,MODE_SEQUENCE } from './reconcile.mjs'
import { githubIo, main as managerMain } from '../manage-migration-author-lanes.mjs'
import { sha256, canonicalJson } from './evidence-bundle.mjs'
const h='a'.repeat(40),b='b'.repeat(64),base={issue:7,pr:8,head_sha:h,bundle_id:b,route:'ordinary_preview_apply',route_context:'',manifest:{target:'preview',preview_allowlist:'v',claim_pr:'8',claim_head_sha:h}}
function fake(){const refs=new Map(),eventLog=[],state={current:base,ready:[]};return{state,refs,eventLog,resolveMarker:()=>({live:true,task:'t',calling_task:'t'}),actor:()=> 't',now:()=>new Date(0).toISOString(),appendEvent:e=>eventLog.push(e),createRef:(r,d,record)=>refs.has(r)?false:(refs.set(r,{digest:d,record}),true),readRef:r=>refs.get(r),listReady:()=>state.ready,selectCurrent:()=>state.current,withMutex:f=>f(),events:()=>eventLog}}
test('ready identity changes with every safety identity input',()=>{const one=readyRecord(base);for(const [key,value] of [['issue',9],['head_sha','c'.repeat(40)],['bundle_id','d'.repeat(64)],['route','merged_rehearsal'],['route_context','e'.repeat(40)]]){const candidate={...base,[key]:value};if(key==='route')candidate.route_context='e'.repeat(40);if(key==='route_context')candidate.route='merged_rehearsal';if(candidate.route==='merged_rehearsal')candidate.manifest={target:'preview',preview_allowlist:'v',commit_sha:'f'.repeat(40),merged_preview_source_pr:'8'};assert.notEqual(readyRecord(candidate).ready_id,one.ready_id)}})
test('event is written before immutable ready ref and retry is idempotent',()=>{const io=fake(),order=[];io.appendEvent=e=>{order.push('event');io.eventLog.push(e)};const create=io.createRef;io.createRef=(...a)=>{order.push('ref');return create(...a)};const a=persistInitialReady(base,io),c=persistInitialReady(base,io);assert.deepEqual(order.slice(0,2),['event','ref']);assert.equal(a.record.ready_id,c.record.ready_id)})
test('preparation creates successor before stale terminal outcome',()=>{const io=fake(),old=readyRecord(base);io.state.ready=[{record:old}];persistInitialReady(base,io);io.state.current={...base,head_sha:'c'.repeat(40)};const newer=readyRecord(io.state.current);io.state.ready.push({record:newer});const result=preparePreviewDispatch(7,io);assert.equal(result.record.ready_id,newer.ready_id);assert.equal(io.refs.get(`refs/db-preview-ready-outcomes/${old.ready_id}`).record.outcome,'superseded')})
test('only completing apply evidence can terminalize dispatched',()=>{const io=fake();assert.throws(()=>terminalizeReady('x','dispatched',{positive:true,mode:'dry-run'},io),ReconcileError);assert.equal(terminalizeReady('x','dispatched',{positive:true,mode:'apply'},io).outcome,'dispatched')})
test('repair refuses corrupt live identity without a write',()=>{const io=fake(),id=readyRecord(base).ready_id;persistInitialReady(base,io);const before=io.refs.size;assert.throws(()=>repairPreviewReady(id,7,io),/owner decision/);assert.equal(io.refs.size,before)})
test('no matching marker is report only',()=>{const io=fake();io.resolveMarker=()=>null;const result=reconcileFlow({issues:[{issue:7,preview_edge_satisfied:true}]},io);assert.equal(result.status,'REPORT_ONLY');assert.equal(result.actions[0].action,'report-preview-ready')})
test('matching marker performs guarded transitions rather than only describing them',()=>{const io=fake(),called=[];io.relinquishCapacity=(row)=>called.push(['relinquish',row.issue]);io.resumeCapacity=(row)=>called.push(['resume',row.issue]);io.persistReady=(row)=>called.push(['ready',row.issue]);const result=reconcileFlow({issues:[{issue:1,capacity_state:'active',blocker:{durable:true}},{issue:2,capacity_state:'relinquished',blocker:{resolved:true}},{issue:3,preview_edge_satisfied:true}]},io);assert.equal(result.status,'RECONCILED');assert.deepEqual(called,[['relinquish',1],['resume',2],['ready',3]])})
test('unreadable live preview evidence is explicit and fails closed',()=>{const io=fake(),result=reconcileFlow({issues:[{issue:7,preview_error:'required CI unreadable'}]},io);assert.equal(result.status,'UNVERIFIABLE');assert.equal(result.actions[0].reason,'required CI unreadable')})
test('preview preparation rechecks marker ownership inside the mutex before writing',()=>{const io=fake();let writes=0;io.withMutex=(fn)=>{io.resolveMarker=()=>({live:true,task:'successor',calling_task:'displaced'});return fn()};io.appendEvent=()=>{writes++};io.createRef=()=>{writes++;return true};assert.throws(()=>preparePreviewDispatch(7,io),/matching live sole-orchestrator marker/);assert.equal(writes,0)})
test('manager passes admission into the preview operation without taking a second mutex',()=>{assert.equal(typeof githubIo.orchestratorFlowAdapter,'function');const adapter=fake();adapter.state.ready=[{record:readyRecord(base)}];let mutexCalls=0,outerMutexCalls=0;adapter.withMutex=(fn)=>{mutexCalls++;return fn()};const refs=new Map(),io={enforceAdmission:true,orchestratorFlowAdapter:(_claim,admission)=>{assert.equal(Number(admission.admitIssue),7);return adapter},makeOwnerCommit:()=> 'owner',readRef:(ref)=>refs.get(ref)??null,createRef:(ref,sha)=>{outerMutexCalls++;refs.set(ref,sha);return true},deleteRef:(ref)=>refs.delete(ref)};assert.equal(managerMain(['--prepare-preview-dispatch','7','--admit-issue','7','--pr','8'],new Date(),io),0);assert.equal(mutexCalls,1);assert.equal(outerMutexCalls,0)})
test('every historical rebind manifest is complete and dispatchable',()=>{
  const manifest={target:'preview',preview_allowlist:'20260828232207',claim_pr:'1809',claim_head_sha:h,commit_sha:h,historical_preview_source_pr:'1809',historical_preview_original_run_map:'20260828232207:33308168016'}
  const input={...base,route:'historical_rebind',route_context:h,manifest}
  const complete=readyRecord(input)
  assert.equal(complete.manifest.historical_preview_original_run_map,'20260828232207:33308168016')
  for(const key of ['commit_sha','historical_preview_source_pr','historical_preview_original_run_map'])assert.throws(()=>readyRecord({...input,manifest:{...manifest,[key]:''}}),ReconcileError)
  assert.throws(()=>readyRecord({...input,manifest:{...manifest,historical_preview_original_run_map:'20260828232208:33308168016'}}),/not dispatchable/)
  assert.notEqual(readyRecord({...input,manifest:{...manifest,historical_preview_original_run_map:'20260828232207:33308168017'}}).ready_id,complete.ready_id)
})

// ISSUE #2796. The stored instruction carried no mode, the workflow's `mode`
// input defaults to dry-run, so dispatching it verbatim produced a green run that
// applied nothing (run 34633793571, artifact preview-migration-dry-run-120fb612...).
test('every stored instruction names the modes its route must be dispatched with',()=>{
  const ordinary=readyRecord(base)
  assert.deepEqual(ordinary.mode_sequence,['dry-run','apply'])
  const merged=readyRecord({...base,route:'merged_rehearsal',route_context:'f'.repeat(40),manifest:{target:'preview',preview_allowlist:'v',commit_sha:'f'.repeat(40),merged_preview_source_pr:'8'}})
  assert.deepEqual(merged.mode_sequence,['dry-run','apply'])
  // APPLY-ONLY. AGENTS.md 4: "Historical recovery is apply-only; historical
  // dry-run proves nothing" -- at mode=dry-run that lane runs neither the
  // recovery proof nor a bounded dry-run and still exits 0.
  const historical=readyRecord({...base,route:'historical_rebind',route_context:h,manifest:{target:'preview',preview_allowlist:'20260828232207',claim_pr:'8',claim_head_sha:h,commit_sha:h,historical_preview_source_pr:'8',historical_preview_original_run_map:'20260828232207:33308168016'}})
  assert.deepEqual(historical.mode_sequence,['apply'])
  assert.ok(!historical.mode_sequence.includes('dry-run'),'the historical lane offered a dry-run it can never prove anything with')
  // Derived from the ROUTE, never from the caller: a candidate cannot smuggle in
  // a mode sequence its route does not permit.
  assert.deepEqual(readyRecord({...base,mode_sequence:['dry-run']}).mode_sequence,['dry-run','apply'])
  assert.deepEqual(Object.keys(MODE_SEQUENCE).sort(),['historical_rebind','merged_rehearsal','ordinary_preview_apply'])
})

test('the dispatch mode is a per-run phase, never part of ready identity',()=>{
  // Phase 2: "`mode` is a per-run phase, not part of ready identity or
  // frozen-manifest equality." Folding it into the manifest would change every
  // manifest_digest and ready_id in existence and freeze a phase into immutable
  // identity -- and would make the REQUIRED ordinary/merged dry-run undispatchable
  // from the stored instruction.
  const one=readyRecord(base)
  assert.equal('mode' in one.manifest,false)
  assert.equal(readyRecord({...base,mode_sequence:['apply']}).ready_id,one.ready_id)
  assert.equal(readyRecord({...base,mode_sequence:['apply']}).manifest_digest,one.manifest_digest)
})
// BOTH DIRECTIONS, deliberately. The first version of this test asserted only the
// writer's own convention against itself, so it passed under WHICHEVER convention the
// writer used and could not see that consumers recompute
// sha256(canonicalJson(<whole stored record>)) from the record they read back
// (manage-migration-author-lanes.mjs:2094). Each leg below fails for a different
// mistake: narrowing the stored digest, reverting occupancy to raw digest equality,
// and loosening occupancy into a tautology that accepts anything.
test('stored ready digest is the whole record, and occupancy is judged on identity',()=>{
  const io=fake(),{record}=persistInitialReady(base,io)
  const ref=io.refs.get(`refs/db-preview-ready/${record.ready_id}`)
  assert.ok(record.mode_sequence,'record must carry mode_sequence')
  // Leg 1 -- the consumer's re-derivation. Narrowing the writer breaks every NEW ref.
  assert.equal(ref.digest,sha256(canonicalJson(record)))
  const {mode_sequence:_modeSequence,...identity}=record
  // Leg 2 -- a ref written BEFORE mode_sequence existed holds the same identity under a
  // different digest; re-preparing it must converge rather than fail closed.
  const legacy={...io,readRef:()=>({digest:sha256(canonicalJson(identity)),record:identity}),createRef:()=>false}
  assert.doesNotThrow(()=>persistInitialReady(base,legacy))
  // Leg 3 -- and occupancy must still REFUSE a genuinely different identity at that ref.
  const foreign={...io,readRef:()=>({digest:sha256(canonicalJson({...identity,issue:99})),record:{...identity,issue:99}}),createRef:()=>false}
  assert.throws(()=>persistInitialReady(base,foreign),/occupied by inconsistent data/)
})
