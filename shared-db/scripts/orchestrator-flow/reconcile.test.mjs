import test from 'node:test';import assert from 'node:assert/strict'
import { readyRecord,persistInitialReady,preparePreviewDispatch,terminalizeReady,repairPreviewReady,reconcileFlow,ReconcileError,MODE_SEQUENCE,RECONCILE_SCHEMA_VERSION,RELINQUISH_WORKTREE_STATES,parseAbandonmentAudit,abandonmentEvidenceFor,reportOnlyFlowIo,abandonmentAuditExit } from './reconcile.mjs'
import { githubIo, main as managerMain, WORKTREE_STATES, claimBody, assertAbandonmentEvidence, relinquishAuthorLease, flowCapacityFacts } from '../manage-migration-author-lanes.mjs'
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

// ---------------------------------------------------------------------------
// ISSUE #2301 STEP 4. Capacity and preview are separate truths. One undecipherable
// preview edge used to turn the whole reconciliation UNVERIFIABLE, hiding every
// other lane's readable capacity report behind a single word. And expiry is not
// abandonment: an expired lease means a clock ran out, while abandonment is a
// fact that exists only if somebody wrote the evidence down.
// ---------------------------------------------------------------------------
const AUDIT_HEAD='c'.repeat(40)
function auditFields(overrides={}){return {claim:'#41',pr:'#42',head_sha:AUDIT_HEAD,owner:'gone-agent',...overrides}}
function auditBody(overrides={},workType='repo-maintenance'){
  return ['```db-work-scope','status: ready',`work_type: ${workType}`,'route: repo-maintenance','priority: 1','```','','```abandonment-audit',
    ...Object.entries(auditFields(overrides)).map(([k,v])=>`${k}: ${v}`),'```'].join('\n')
}
function expiredRow(overrides={}){
  return {issue:5,claim:41,owner:'gone-agent',capacity_state:'expired-unconfirmed',
    expired_claim:{claim:41,owner:'gone-agent',pr:42,head_sha:AUDIT_HEAD,pr_state:'open',
      expires_at:'2026-09-15T00:00:00.000Z',expired_for_seconds:7200,queued_behind:3},
    blocker:{durable:true,resolved:false,reference:'issue:#77',state:'open',work_type:'repo-maintenance',
      audit:{claim:41,pr:42,head_sha:AUDIT_HEAD,owner:'gone-agent'}},...overrides}
}
const reportFor=(row,io=fake())=>reconcileFlow({issues:[row]},io).actions.find((a)=>a.action==='expired-unconfirmed-report')

test('one unreadable preview edge cannot hide another lane capacity report',()=>{
  const io=fake(),called=[]
  io.relinquishCapacity=(row)=>{called.push(row.issue);return 'relinquished'}
  const result=reconcileFlow({issues:[
    {issue:1,preview_error:'required CI unreadable'},
    {issue:2,capacity_state:'active',blocker:{durable:true,reference:'issue:#9'}},
    expiredRow(),
  ]},io)
  assert.equal(result.preview.status,'UNVERIFIABLE')
  assert.equal(result.capacity.status,'RECONCILED','the capacity domain was readable and must say so')
  assert.equal(result.schema_version,RECONCILE_SCHEMA_VERSION)
  assert.deepEqual(called,[2],"issue 2's capacity action still happened")
  assert.deepEqual(result.actions.filter((a)=>a.domain==='capacity').map((a)=>a.action).sort(),
    ['expired-unconfirmed-report','relinquish-capacity'])
  assert.equal(result.capacity.unverifiable,0)
  assert.equal(result.preview.unverifiable,1)
  // The legacy aggregate word keeps its exact old meaning for consumers that read only it.
  assert.equal(result.status,'UNVERIFIABLE')
})

test('an unreadable capacity row cannot hide another lane preview readiness',()=>{
  const io=fake(),ready=[]
  io.persistReady=(row)=>{ready.push(row.issue);return 'ready'}
  const result=reconcileFlow({issues:[{issue:1,capacity_error:'claim body unreadable'},{issue:2,preview_edge_satisfied:true}]},io)
  assert.equal(result.capacity.status,'UNVERIFIABLE')
  assert.equal(result.preview.status,'RECONCILED')
  assert.deepEqual(ready,[2])
  // A capacity error suppresses that ROW's capacity actions, never another row's.
  assert.equal(result.actions.find((a)=>a.issue===1&&a.domain==='capacity').action,'capacity-unverifiable')
})

test('an expired claim without abandonment evidence reports and never suggests a mutation',()=>{
  const io=fake(),touched=[]
  io.relinquishCapacity=(row)=>touched.push(row.issue)
  // An ORDINARY durable work dependency. The task is blocked; nobody said the author left.
  const row=expiredRow({blocker:{durable:true,resolved:false,reference:'issue:#88',state:'open',work_type:'structural',audit:null}})
  const report=reportFor(row,io)
  assert.equal(report.suggested_command,null)
  assert.equal(report.abandonment_evidence,null)
  assert.equal(report.mutates,false)
  assert.deepEqual(touched,[],'expiry alone must never mutate')
  // The report still carries everything an operator needs in order to judge it.
  assert.equal(report.claim,41);assert.equal(report.pr,42);assert.equal(report.pr_state,'open')
  assert.equal(report.expires_at,'2026-09-15T00:00:00.000Z');assert.equal(report.expired_for_seconds,7200)
  assert.equal(report.queued_behind,3);assert.equal(report.blocker.reference,'issue:#88')
})

test('an unreadable queued-behind count reports unknown rather than none',()=>{
  const row=expiredRow()
  delete row.expired_claim.queued_behind
  assert.equal(reportFor(row).queued_behind,null,'an unreadable queue must not read as an empty one')
})

test('an exact abandonment-audit issue yields only the suggested separate command',()=>{
  const io=fake(),touched=[]
  io.relinquishCapacity=(row)=>touched.push(row.issue)
  const result=reconcileFlow({issues:[expiredRow()]},io)
  assert.equal(result.mutating,true,'the marker is live, so this is a mutating run')
  const report=result.actions.find((a)=>a.action==='expired-unconfirmed-report')
  assert.match(report.suggested_command,/--relinquish-author-lease --claim-number 41 --owner "gone-agent" --blocked-on issue:#77 --worktree-state <clean\|dirty\|absent\|remote>/)
  assert.equal(report.mutates,false)
  assert.deepEqual(touched,[],'even a live marker must not transition an expired claim automatically')
  assert.deepEqual(result.actions.filter((a)=>a.issue===5).map((a)=>a.action),['expired-unconfirmed-report'])
})

test('every way of being the wrong evidence refuses the suggestion',()=>{
  const base41=expiredRow(),blocker=base41.blocker
  const mutations={
    'a closed audit issue':{...blocker,state:'closed'},
    'a resolved blocker':{...blocker,resolved:true},
    'a non-durable blocker':{...blocker,durable:false},
    'the wrong work type':{...blocker,work_type:'structural'},
    'no audit fence':{...blocker,audit:null},
    'a different claim':{...blocker,audit:{...blocker.audit,claim:99}},
    'a different pull request':{...blocker,audit:{...blocker.audit,pr:99}},
    'a different head':{...blocker,audit:{...blocker.audit,head_sha:'d'.repeat(40)}},
    'a different owner':{...blocker,audit:{...blocker.audit,owner:'somebody-else'}},
  }
  assert.ok(abandonmentEvidenceFor(base41),'the unmutated fixture must be accepted, or this test proves nothing')
  for(const [name,mutated] of Object.entries(mutations)){
    assert.equal(abandonmentEvidenceFor({...base41,blocker:mutated}),null,`${name} must not count as abandonment evidence`)
    assert.equal(reportFor({...base41,blocker:mutated}).suggested_command,null,`${name} must not produce a relinquish suggestion`)
  }
})

test('an abandonment-audit fence is read whole or not at all',()=>{
  assert.deepEqual(parseAbandonmentAudit(auditBody()),{claim:41,pr:42,head_sha:AUDIT_HEAD,owner:'gone-agent'})
  assert.equal(parseAbandonmentAudit('no fence here'),null)
  for(const field of ['claim','pr','head_sha','owner'])
    assert.equal(parseAbandonmentAudit(auditBody({[field]:''})),null,`a fence missing ${field} is not evidence`)
  assert.equal(parseAbandonmentAudit(auditBody({head_sha:'not-a-sha'})),null)
  assert.equal(parseAbandonmentAudit(auditBody({claim:'#0'})),null)
})

test('the suggested worktree states are the states the command actually accepts',()=>{
  // Two lists in two modules that must agree, or the suggestion tells an operator
  // to run a command with a value that command refuses.
  assert.deepEqual([...RELINQUISH_WORKTREE_STATES],[...WORKTREE_STATES])
})

test('reconcile exit codes are deterministic per domain',()=>{
  const adapter={resolveMarker:()=>null}
  const run=(issues)=>managerMain(['--reconcile-flow'],new Date(),{flowSnapshot:()=>({issues}),orchestratorFlowAdapter:()=>adapter})
  assert.equal(run([{issue:1,preview_edge_satisfied:true}]),0)
  assert.equal(run([{issue:1,preview_error:'unreadable'}]),2,'a preview-domain failure alone is exit 2')
  assert.equal(run([{issue:1,capacity_error:'unreadable'}]),2,'a capacity-domain failure alone is exit 2')
  assert.equal(run([expiredRow()]),0,'an expired report is a report, not a failure')
})

// --- #2301 Step 5: the scheduled read-only audit -----------------------------

test('the scheduled audit cannot write even when a live marker says it may',()=>{
  // The ONLY thing that makes --reconcile-flow mutate is the marker, and a hosted
  // runner merely happens not to hold one. This asserts the stronger property: a
  // marker that WOULD authorise every transition still produces no call, because
  // the capability was removed rather than left unused. Each hook throws if
  // reached, so a regression fails loudly here instead of writing in production.
  const called=[]
  const adapter={
    resolveMarker:()=>({live:true,task:'t',calling_task:'t'}),
    relinquishCapacity:(row)=>called.push(['relinquish',row.issue]),
    resumeCapacity:(row)=>called.push(['resume',row.issue]),
    persistReady:(row)=>called.push(['ready',row.issue]),
  }
  const issues=[{issue:1,capacity_state:'active',blocker:{durable:true}},{issue:2,capacity_state:'relinquished',blocker:{resolved:true}},{issue:3,preview_edge_satisfied:true}]
  // The same input through the mutating entry point, to prove the fixture really
  // would have written and this test is not passing on an inert case.
  assert.equal(reconcileFlow({issues},adapter).status,'RECONCILED')
  assert.deepEqual(called,[['relinquish',1],['resume',2],['ready',3]])
  called.length=0
  const guarded=reconcileFlow({issues},reportOnlyFlowIo(adapter))
  assert.equal(guarded.mutating,false)
  assert.equal(guarded.status,'REPORT_ONLY')
  assert.deepEqual(called,[],'the read-only audit called a mutation hook')
  for(const hook of ['relinquishCapacity','resumeCapacity','persistReady'])
    assert.throws(()=>reportOnlyFlowIo(adapter)[hook]({issue:1}),/read-only abandonment audit must never call/,`${hook} was still callable`)
})

test('expiry and unreadability are different exit codes, and neither is clean',()=>{
  // An hourly job whose every abnormal state is one number teaches its operator to
  // ignore that number. Expiry needs a decision; an unreadable state means the
  // instrument is broken and must fail closed, so they are 2 and 3, never 0.
  const adapter={resolveMarker:()=>({live:true,task:'t',calling_task:'t'})}
  const run=(issues)=>managerMain(['--abandonment-audit'],new Date(),{flowSnapshot:()=>({issues}),orchestratorFlowAdapter:()=>adapter})
  assert.equal(run([{issue:1,preview_edge_satisfied:true}]),0)
  assert.equal(run([expiredRow()]),2,'a non-empty expired claim must be visible, not silent')
  assert.equal(run([{issue:1,capacity_error:'unreadable'}]),3,'an unreadable capacity row must be distinguishable from expiry')
  assert.equal(run([{issue:1,preview_error:'unreadable'}]),3)
  assert.equal(run([expiredRow(),{issue:9,capacity_error:'unreadable'}]),3,'unreadable outranks expiry; the audit is not trusted to have seen everything')
})

test('the audit fails closed on any result it does not recognise',()=>{
  // abandonmentAuditExit is what the workflow's exit status comes from, so a
  // future schema, or a result that claims to have mutated, must never read as a
  // clean hour. Enumerated rather than tested through the CLI, because the CLI
  // cannot currently produce these and that is exactly why they need pinning.
  const clean={schema_version:RECONCILE_SCHEMA_VERSION,mutating:false,capacity:{status:'REPORT_ONLY'},preview:{status:'REPORT_ONLY'},actions:[]}
  assert.equal(abandonmentAuditExit(clean),0,'the control case must be clean, or the rest proves nothing')
  assert.equal(abandonmentAuditExit({...clean,schema_version:RECONCILE_SCHEMA_VERSION+1}),3)
  assert.equal(abandonmentAuditExit({...clean,mutating:true}),3)
  assert.equal(abandonmentAuditExit(null),3)
  assert.equal(abandonmentAuditExit({}),3)
})

test('the scheduled audit reports the claim and queued-behind count an operator needs',()=>{
  // "Something expired" is not actionable. The plan requires the exact claim and
  // the exact queued-behind count, and requires null to survive as UNKNOWN rather
  // than being rendered as zero, which would read as "nobody is waiting".
  const adapter={resolveMarker:()=>({live:true,task:'t',calling_task:'t'})}
  const capture=(issues)=>{
    const lines=[],write=console.log
    console.log=(text)=>lines.push(text)
    try{managerMain(['--abandonment-audit'],new Date(),{flowSnapshot:()=>({issues}),orchestratorFlowAdapter:()=>adapter})}
    finally{console.log=write}
    return JSON.parse(lines.join('\n'))
  }
  const row=expiredRow()
  const report=capture([row]).actions.find((action)=>action.action==='expired-unconfirmed-report')
  assert.equal(report.claim,row.expired_claim.claim)
  assert.equal(report.queued_behind,row.expired_claim.queued_behind)
  assert.equal(report.mutates,false)
  const unknown=structuredClone(row);unknown.expired_claim.queued_behind=null
  assert.equal(capture([unknown]).actions.find((action)=>action.action==='expired-unconfirmed-report').queued_behind,null,
    'an unreadable queue was rendered as a number an operator would act on')
})

// --- the separate guarded command ------------------------------------------
const NOW=new Date('2026-09-15T02:00:00Z')
function laneIo({auditWorkType='repo-maintenance',auditOverrides={},pulls=[{number:42,state:'open',head:{sha:AUDIT_HEAD}}],marker={live:true,task:'t',calling_task:'t'},blockerState='open'}={}){
  const refs=new Map(),comments=[],issues=new Map()
  const claimText=claimBody({version:'20260828000077',objects:['table test.t_77'],owner:'gone-agent',
    branch:'branch-77',worktree:'C:/work/77',expiresAt:new Date('2026-09-15T00:00:00Z')})
  issues.set(77,{number:77,state:'open',title:'CLAIM: #5 abandonment fixture',body:claimText})
  issues.set(900,{number:900,state:blockerState,body:auditBody({claim:'#77',owner:'gone-agent',...auditOverrides},auditWorkType)})
  issues.set(901,{number:901,state:'open',body:'an ordinary dependency with no audit fence'})
  refs.set('refs/db-claims/20260828000077','reservation')
  let serial=0
  return {comments,issues,
    makeOwnerCommit:()=>`owner-${++serial}`,
    createRef:(name,sha)=>{if(refs.has(name))return false;refs.set(name,sha);return true},
    readRef:(name)=>refs.get(name)??null,
    listRefs:(prefix)=>[...refs].filter(([name])=>name===prefix||name.startsWith(`${prefix}/`)).map(([ref,sha])=>({ref,sha})),
    readCommitMessage:()=>null,deleteRef:(name)=>{refs.delete(name)},getCommitMessage:()=>'',
    openClaims:()=>[structuredClone(issues.get(77))],
    getIssue:(number)=>structuredClone(issues.get(Number(number))),
    updateIssue:(number,{body:newBody})=>{issues.get(Number(number)).body=newBody},
    localClean:()=>true,verifyArtifact:()=>null,prSources:()=>[],
    branchPulls:()=>pulls,
    orchestratorFlowAdapter:()=>({resolveMarker:()=>marker}),
    commentIssue:(number,comment)=>comments.push({number,body:comment})}
}
const lease77={owner:'gone-agent',branch:'branch-77'}

test('the guarded command revalidates the whole abandonment tuple before it writes',()=>{
  const options={claim:77,worktreeState:'dirty'}
  assert.deepEqual(assertAbandonmentEvidence(options,lease77,'issue:#900',laneIo()),
    {claim:77,pr:42,head_sha:AUDIT_HEAD,owner:'gone-agent'})
  const refusals={
    'a closed audit issue':{blockerState:'closed'},
    'a head that has moved since the audit':{pulls:[{number:42,state:'open',head:{sha:'e'.repeat(40)}}]},
    'a pull request that is not on the claim branch':{pulls:[{number:99,state:'open',head:{sha:AUDIT_HEAD}}]},
    'a reclassified audit issue':{auditWorkType:'documentation'},
    'an audit naming a different claim':{auditOverrides:{claim:'#99'}},
    'an audit naming a different owner':{auditOverrides:{owner:'somebody-else'}},
    'no live orchestrator marker':{marker:{live:false,task:'t',calling_task:'t'}},
    'a displaced marker':{marker:{live:true,task:'successor',calling_task:'displaced'}},
  }
  for(const [name,override] of Object.entries(refusals))
    assert.throws(()=>assertAbandonmentEvidence(options,lease77,'issue:#900',laneIo(override)),Error,`${name} must refuse`)
  // The operator's own observation is required; it is never inferred from the audit.
  assert.throws(()=>assertAbandonmentEvidence({claim:77},lease77,'issue:#900',laneIo()),/explicit --worktree-state/)
  // An ordinary work dependency carries no audit fence and takes none of this path.
  assert.equal(assertAbandonmentEvidence(options,lease77,'issue:#901',laneIo()),null)
})

test('automatic reconciliation can never complete an abandonment relinquishment',()=>{
  // The flow adapter calls relinquishAuthorLease without a worktree state, because
  // no automated caller can observe somebody else's disk. That refusal IS the
  // property: the lane is reported, and only an operator-run command can take it.
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'gone-agent',blockedOn:'issue:#900'},NOW,laneIo()),
    /explicit --worktree-state/)
  // With the observation supplied, the same evidence is accepted.
  const io=laneIo()
  const result=relinquishAuthorLease({claim:77,owner:'gone-agent',blockedOn:'issue:#900',worktreeState:'clean'},NOW,io)
  assert.equal(result.capacityState,'relinquished')
  // An ordinary blocker still needs no marker and no audit, so the existing path is unchanged.
  assert.equal(relinquishAuthorLease({claim:77,owner:'gone-agent',blockedOn:'issue:#901',worktreeState:'clean'},NOW,laneIo()).capacityState,'relinquished')
})

test('the suggested command is runnable exactly as printed',()=>{
  // Matching the suggestion against a regex only proves the string is the string
  // we wrote. The suggestion's whole purpose is to be pasted, so this test builds
  // it from real capacity facts, splits it into argv, and runs it through the real
  // CLI. `--claim 41` passed the regex test and would have died in the parser,
  // because --claim is the boolean that CLAIMS a lane; --claim-number is the value.
  const factsIo=laneIo()
  factsIo.getIssue=((inner)=>(number)=>Number(number)===5?{number:5,state:'open',body:'blocked_on: issue:#900'}:inner(number))(factsIo.getIssue)
  const row={issue:5,claim:77,...flowCapacityFacts(factsIo.issues.get(77),5,NOW,factsIo,()=>0)}
  const report=reconcileFlow({issues:[row]},{resolveMarker:()=>null}).actions.find((a)=>a.action==='expired-unconfirmed-report')
  assert.ok(report.suggested_command,'the fixture must carry real evidence, or this test proves nothing')
  const argv=report.suggested_command.match(/"[^"]*"|\S+/g).slice(2)
    .map((token)=>token.replace(/^"|"$/g,''))
    // the one placeholder: the operator supplies their own observation.
    .map((token)=>/^<.+>$/.test(token)?'clean':token)
  const io=laneIo()
  assert.equal(managerMain(argv,NOW,io),0,'the printed command must be accepted by the parser it names')
  assert.match(io.issues.get(77).body,/capacity_state: relinquished/,'and it must do what the report said it would do')
})

test('evidence that changes between the two reads refuses rather than writing',()=>{
  // Both reads are inside the mutex, but the audit issue lives outside it. A second
  // read that is still well formed, still names this claim and owner, and still
  // names a pull request on this branch is the case no individual check can catch;
  // only comparing the two records can.
  const other='f'.repeat(40)
  const io=laneIo({pulls:[{number:42,state:'open',head:{sha:AUDIT_HEAD}},{number:43,state:'open',head:{sha:other}}]})
  // The swap is tied to the worktree observation, which happens between the two
  // evidence reads, rather than to a read count that would drift with the code.
  let swapped=false
  io.localClean=()=>{swapped=true;return true}
  io.getIssue=((inner)=>(number)=>{
    if(Number(number)!==900||!swapped)return inner(number)
    return {number:900,state:'open',body:auditBody({claim:'#77',pr:'#43',head_sha:other,owner:'gone-agent'})}
  })(io.getIssue)
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'gone-agent',blockedOn:'issue:#900',worktreeState:'clean'},NOW,io),
    /changed concurrently/,'a swapped-but-valid audit record must refuse')
  assert.ok(swapped,'the refusal must come from a second read, not from the first')
  assert.doesNotMatch(io.issues.get(77).body,/capacity_state: relinquished/,'and nothing may be written')
})

test('capacity facts name where each fact came from',()=>{
  const io=laneIo()
  io.getIssue=((inner)=>(number)=>Number(number)===5?{number:5,state:'open',body:'blocked_on: issue:#900'}:inner(number))(io.getIssue)
  const facts=flowCapacityFacts(io.issues.get(77),5,NOW,io,()=>3)
  assert.equal(facts.capacity_state,'expired-unconfirmed')
  assert.equal(facts.owner,'gone-agent')
  assert.equal(facts.blocker.reference,'issue:#900')
  assert.equal(facts.blocker.work_type,'repo-maintenance')
  assert.equal(facts.blocker.resolved,false)
  assert.deepEqual(facts.blocker.audit,{claim:77,pr:42,head_sha:AUDIT_HEAD,owner:'gone-agent'})
  assert.equal(facts.expired_claim.expired_for_seconds,7200)
  assert.equal(facts.expired_claim.pr,42)
  assert.equal(facts.expired_claim.pr_state,'open')
  assert.equal(facts.expired_claim.queued_behind,3)
})
