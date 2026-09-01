import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTIVE_REVIEWERS, MAX_AUTHOR_LANES, OVERFLOW_REVIEWERS, reviewersForOrchestrator, findBusyReviewers, pickReviewer, addedMigrationVersions, assertMergeCommitInMainHistory, REVIEWERS, RETIRED_REVIEWERS, acquireAuthorLane, acquireExclusive, assertLaneAvailable, assignNextReviewer, assertDurableReviewApproval, buildDynamicQueues, claimBody, queueExit, NON_STRUCTURAL_EXITS, OUTSIDE_ORCHESTRATOR_EXITS, conflicts, completeWork, requiresReturnAddress, returnIssueToOwner, RETURNED_MARKER, createRefWithReadback, deleteRefWithReadback, expandActiveClaimFromIssue, expandActiveClaimFromPr, EXCLUSIVE_REFS, githubIo, isConfirmedRefAbsence, LaneError, main, MUTEX_RECOVERY_ACTIVE_REF, MUTEX_REF, parseAuthorLease, parseQueueScope, parseReviewCursor, readPrAfterPush, readRefAfterWrite, recoverSameOwnerSplit, recoverStaleAuthorMutex, reissueMergedStrandedClaim, releaseOwnedRef, replaceFailedReviewer, requireOwnedRef, renewExpiredClaim, reviewerExecutionPreflight, reversionActiveClaim, runGitHubCommand, withReviewRequestBudget, supersedeActiveClaimVersion, REVIEW_CURSOR_REF, REVIEW_REPLACEMENT_REF_PREFIX, validateClaimObjects, parseDoctorFailures, TERMINAL_FAILURE_CODES, doctorSpawnPlan, resolveCommandPath, summarizeDoctorOutput, pickExecutableCandidate, REVIEWER_DOCTOR_TIMEOUT_MS, findPrReviewAssignments, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, reviewActiveRef, parseReviewLease, EXPECTED_REF_ABSENCE, EXPECTED_REF_PRESENCE, deriveLivePreviewCandidate, validateOriginalPreviewApplyEvidence, projectReviewPr, reviewStateGraphqlFields, REVIEW_OPERATION_REQUEST_LIMIT, REVIEW_MUTEX_SECTION_RESERVE, inReviewReplacementNamespace, activateReviewCutover, REVIEW_REF_PAGE_LIMIT, excludeReviewerForPr, parseReviewExclusion, REVIEW_EXCLUSION_REF_PREFIX, reviewRecordRefs } from './manage-migration-author-lanes.mjs'

function commandFailure(message){const error=new Error(message);error.stderr=message;return error}

test('GitHub coordination transport retries bounded transient failures with identical deterministic arguments',()=>{
  const calls=[],waits=[],args=['api','-X','POST','repos/u2giants/shared-db/git/commits','-f','message=exact']
  const result=runGitHubCommand(args,{executor:(command,actual)=>{
    calls.push([command,[...actual]])
    if(calls.length<3)throw commandFailure('HTTP 503: No server is currently available')
    return '{"sha":"same"}'
  },wait:waits.push.bind(waits)})
  assert.equal(result,'{"sha":"same"}')
  assert.deepEqual(waits,[1000,2000])
  assert.equal(calls.length,3)
  assert.ok(calls.every(([,actual])=>JSON.stringify(actual)===JSON.stringify(args)))
})

test('GitHub coordination transport exhausts after four attempts and never retries 4xx',()=>{
  let transientCalls=0
  assert.throws(()=>runGitHubCommand(['api','endpoint'],{executor:()=>{transientCalls++;throw commandFailure('HTTP 502: bad gateway')},wait:()=>{}}),error=>error instanceof LaneError&&error.transientTransport===true)
  assert.equal(transientCalls,4)
  let permanentCalls=0
  assert.throws(()=>runGitHubCommand(['api','endpoint'],{executor:()=>{permanentCalls++;throw commandFailure('HTTP 422: semantic mismatch')},wait:()=>{}}),error=>error instanceof LaneError&&error.transientTransport===false)
  assert.equal(permanentCalls,1)
})

test('create ref accepts only exact readback after a lost success response',()=>{
  const lost=new LaneError('HTTP 503 after POST');lost.transientTransport=true
  assert.equal(createRefWithReadback('refs/db-coordination/preview','abc',{run:()=>{throw lost},readRef:()=> 'abc'}),true)
  assert.equal(createRefWithReadback('refs/db-coordination/preview','abc',{run:()=>{throw lost},readRef:()=> 'other'}),false)
  assert.throws(()=>createRefWithReadback('refs/db-coordination/preview','abc',{run:()=>{throw lost},readRef:()=>null}),/HTTP 503/)
  const exists=new LaneError('HTTP 422: Reference already exists')
  assert.equal(createRefWithReadback('refs/db-coordination/preview','abc',{run:()=>{throw exists},readRef:()=> 'abc'}),true)
  assert.equal(createRefWithReadback('refs/db-coordination/preview','abc',{run:()=>{throw exists},readRef:()=> 'other'}),false)
})

test('delete ref accepts only proved absence after a lost success response',()=>{
  const lost=new LaneError('HTTP 503 after DELETE');lost.transientTransport=true
  assert.doesNotThrow(()=>deleteRefWithReadback('refs/db-coordination/preview',{run:()=>{throw lost},readRef:()=>null}))
  assert.throws(()=>deleteRefWithReadback('refs/db-coordination/preview',{run:()=>{throw lost},readRef:()=> 'next-owner'}),/HTTP 503/)
  const absent=new LaneError('HTTP 422: Reference does not exist')
  assert.doesNotThrow(()=>deleteRefWithReadback('refs/db-coordination/preview',{run:()=>{throw absent},readRef:()=>null}))
  assert.throws(()=>deleteRefWithReadback('refs/db-coordination/preview',{run:()=>{throw absent},readRef:()=> 'next-owner'}),/does not exist/)
})

test('GitHub coordination delete never replays after response loss and preserves a new owner',()=>{
  const originalExecutor=githubIo.deleteRef
  let deleteCalls=0,readCalls=0
  const run=(args)=>runGitHubCommand(args,{
    attempts:1,
    executor:()=>{deleteCalls++;throw commandFailure('HTTP 503 after DELETE')},
    wait:()=>assert.fail('single-attempt DELETE must not back off for a replay'),
  })
  assert.throws(()=>deleteRefWithReadback('refs/db-coordination/preview',{
    run,
    readRef:()=>{readCalls++;return 'next-owner'},
  }),error=>error instanceof LaneError&&error.transientTransport===true)
  assert.equal(deleteCalls,1)
  assert.equal(readCalls,1)
  assert.equal(typeof originalExecutor,'function')
})

const NOW = new Date('2026-08-14T20:00:00Z')
const body = (objects, owner, expires = '2026-08-15T08:00:00.000Z') => claimBody({ version:`2026081420${owner.padStart(4,'0')}`, objects, owner:`agent-${owner}`, branch:`codex/${owner}`, worktree:`C:/w/${owner}`, expiresAt:new Date(expires) })

function durableApprovalFixture({includeLatestReplacementVerdict=true}={}){
  const issue=1824,pr=1931,headSha='a'.repeat(40),findingsBody='review findings',findingsRef=`https://github.com/u2giants/shared-db/pull/${pr}#issuecomment-1`
  const assignment1='1'.repeat(40),assignment2='2'.repeat(40),replacement2='3'.repeat(40)
  const commits=new Map([
    [assignment1,{message:`db-coordination reviewer-cursor sequence=1 reviewer=kimi-k3 issue=${issue} pr=${pr} head=${headSha} slot=1`}],
    [assignment2,{message:`db-coordination reviewer-cursor sequence=2 reviewer=kimi-k3 issue=${issue} pr=${pr} head=${headSha} slot=2`}],
    [replacement2,{message:`db-coordination reviewer-replacement sequence=7 reviewer=kimi-k3 issue=${issue} pr=${pr} head=${headSha} reason=wrapper_terminal_failure`}],
  ])
  const refs=new Map([
    [`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,assignment1],
    [`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}-slot2`,assignment2],
    [`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${headSha}-slot2-7`,replacement2],
  ])
  const addVerdict=(ref,sha,slot,assignmentSha)=>{
    const record={verdict:'APPROVE',head_sha:headSha,issue,pr,slot,reviewer:'kimi-k3',assignment_sha:assignmentSha,findings_digest:createHash('sha256').update(findingsBody).digest('hex'),findings_ref:findingsRef}
    refs.set(ref,sha);commits.set(sha,{message:`db-review-verdict ${JSON.stringify(record)}`,parents:[{sha:assignmentSha}]})
  }
  addVerdict(`refs/db-review-verdicts/${issue}-${pr}-${headSha}`,'4'.repeat(40),1,assignment1)
  addVerdict(`refs/db-review-verdicts/${issue}-${pr}-${headSha}-slot2`,'5'.repeat(40),2,assignment2)
  if(includeLatestReplacementVerdict)addVerdict(`refs/db-review-verdict-replacements/${issue}-${pr}-${headSha}-slot2-7`,'6'.repeat(40),2,replacement2)
  const io={
    listRefs:(prefix)=>[...refs].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})),
    readRef:(ref)=>refs.get(ref)??null,
    getCommit:(sha)=>commits.get(sha),
    readFindings:()=>findingsBody,
  }
  return{issue,pr,headSha,io}
}

test('durable preview approval requires APPROVE for every latest reviewer slot',()=>{
  const fixture=durableApprovalFixture()
  const verdicts=assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io)
  assert.equal(verdicts.filter((row)=>row.verdict==='APPROVE').length,3)
})

test('durable preview approval rejects an older slot verdict after replacement',()=>{
  const fixture=durableApprovalFixture({includeLatestReplacementVerdict:false})
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io),/review slot 2 has no durable APPROVE for its latest exact-head assignment/)
})

const scope = (status, workType, route, priority, objects=[], depends='') => `\`\`\`db-work-scope\nstatus: ${status}\nwork_type: ${workType}\nroute: ${route}\npriority: ${priority}\ndepends_on: ${depends}\nobjects:\n${objects.map((x)=>`  - ${x}`).join('\n')}\n\`\`\``

test('queue scope keeps status, work type, and route separate',()=>{
  assert.deepEqual(parseQueueScope(scope('ready','structural','shared-db-orchestrator',9,['table core.a'],'#12, 13')), {status:'ready',workType:'structural',route:'shared-db-orchestrator',priority:9,dependencies:[12,13],returnTo:null,writes:['table core.a'],reads:[],legacyObjects:['table core.a'],objects:['table core.a']})
  assert.throws(()=>parseQueueScope(scope('ready','structural','shared-db-orchestrator',1)),/must list at least one write/)
  assert.throws(()=>parseQueueScope(scope('waiting','structural','shared-db-orchestrator',1,['table core.a'])),/status must be/)
  assert.throws(()=>parseQueueScope(scope('ready','source-data','shared-db-orchestrator',1)),/not valid/)
  assert.throws(()=>parseQueueScope(scope('ready','source-data','source-data-session',1,['table plm.nbcu_right'])),/must not claim/)
  assert.throws(()=>parseQueueScope(`\`\`\`db-work-scope\nstate: eligible\npriority: 1\nobjects:\n  - table core.a\n\`\`\``),/state is retired/)
  assert.throws(()=>parseQueueScope(`${scope('ready','structural','shared-db-orchestrator',1,['table core.a'])}\n${scope('blocked','repo-maintenance','repo-maintenance',1)}`),/exactly one/)
})

test('dynamic queues serialize overlapping work and refill every empty lane',()=>{
  const issues=[
    {number:1,title:'a',body:scope('ready','structural','shared-db-orchestrator',10,['table core.a'])},
    {number:2,title:'a later',body:scope('ready','structural','shared-db-orchestrator',8,['table core.a'])},
    {number:3,title:'b',body:scope('ready','structural','shared-db-orchestrator',7,['table core.b'])},
    {number:4,title:'c',body:scope('ready','structural','shared-db-orchestrator',6,['table core.c'])},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.equal(result.fullyAudited,true)
  assert.deepEqual(new Set(result.dispatchable),new Set([1,3,4]))
  assert.ok(result.queues.some((q)=>q.queued.join(',')==='1,2'))
})

test('an open issue whose closed claim version is on main is never dispatched as fresh authoring',()=>{
  const issue={number:1769,title:'WWE tables awaiting promotion',body:scope('ready','structural','shared-db-orchestrator',700,['schema plm'])}
  const positiveControl=buildDynamicQueues([issue],[],NOW)
  assert.deepEqual(positiveControl.dispatchable,[1769], 'without merged-claim evidence the known issue goes red')
  const guarded=buildDynamicQueues([issue],[],NOW,[1769],null,new Map(),new Set([1769]))
  assert.deepEqual(guarded.dispatchable,[])
  assert.equal(guarded.skipped.find((row)=>row.issue===1769).reason,'authored-on-main')
})

test('dynamic queues fill inactive lanes before queueing behind active claims',()=>{
  const claims=[{number:31,body:body(['table core.a'],'31')},{number:32,body:body(['table core.b'],'32')}]
  const one=buildDynamicQueues([{number:40,title:'c',body:scope('ready','structural','shared-db-orchestrator',9,['table core.c'])}],claims,NOW)
  assert.deepEqual(one.dispatchable,[40])
  assert.equal(one.queues.find((q)=>q.queued.includes(40)).active,null)
  const two=buildDynamicQueues([
    {number:40,title:'c',body:scope('ready','structural','shared-db-orchestrator',9,['table core.c'])},
    {number:41,title:'d',body:scope('ready','structural','shared-db-orchestrator',8,['table core.d'])},
  ],[{number:31,body:body(['table core.a'],'31')}],NOW)
  assert.deepEqual(new Set(two.dispatchable),new Set([40,41]))
})

test('queue audit names expired active claims, queued work, and pull-request state',()=>{
  const expired=body(['table core.a'],'31','2026-08-13T08:00:00.000Z')
  const result=buildDynamicQueues(
    [{number:40,title:'waiting',body:scope('ready','structural','shared-db-orchestrator',9,['table core.a'])}],
    [{number:31,body:expired}],
    NOW,
    [40],
    null,
    new Map([[31,'merged']]),
  )
  const lane=result.queues.find((row)=>row.active===31)
  assert.equal(lane.activeLeaseState,'expired-unconfirmed')
  assert.equal(lane.activePrState,'merged')
  assert.deepEqual(result.expiredClaims,[{claim:31,lane:lane.lane,expires_at:'2026-08-13T08:00:00.000Z',pr_state:'merged',queued:[40]}])
  assert.deepEqual(result.dispatchable,[],'expiry must remain visible without releasing object protection')
})

test('status and non-structural routes never consume a migration-author lane',()=>{
  const issues=[
    {number:10,title:'open dependency',body:scope('blocked','structural','shared-db-orchestrator',9,['table core.blocked'])},
    {number:11,title:'dependent',body:scope('ready','structural','shared-db-orchestrator',8,['table core.x'],'#10')},
    {number:12,title:'owner',body:scope('owner-decision','security-settings','owner-only',7)},
    {number:13,title:'data',body:scope('ready','application-data','application-session',6)},
    {number:14,title:'app',body:scope('ready','repo-maintenance','repo-maintenance',5)},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.deepEqual(result.dispatchable,[])
  assert.equal(result.skipped.length,5)
  assert.equal(result.fullyAudited,true)
})

test('every non-structural work type has a named exit and never accept',()=>{
  assert.equal(queueExit('structural'),'accept')
  const allowed=new Set(['reject','fork','repo-session','return-to-owner'])
  for(const [workType,exit] of Object.entries(NON_STRUCTURAL_EXITS)){
    assert.ok(allowed.has(exit),`${workType} must exit to a named destination, got ${exit}`)
    assert.notEqual(exit,'accept',`${workType} must never be accepted by the orchestrator`)
    assert.equal(queueExit(workType),exit)
  }
  assert.throws(()=>queueExit('invented-work-type'),/no orchestrator exit is defined/)
})

// OWNER RULING 2026-08-21 (issue #1366). Repository maintenance, documentation and
// security-settings work is not the orchestrator's, not even to dispatch. These
// exits are the machine-readable form of that ruling; a regression here is how the
// original routing mistake happened.
test('the 2026-08-21 owner ruling is enforced: repo work leaves the orchestrator, Master Data does not move',()=>{
  assert.equal(queueExit('repo-maintenance'),'repo-session')
  assert.equal(queueExit('documentation'),'repo-session')
  assert.equal(queueExit('security-settings'),'return-to-owner')
  // Deliberately unchanged. The ruling did not cover curated Master Data, which
  // AGENTS.md 6.4 still governs inside this repository.
  assert.equal(queueExit('curated-master-data'),'fork')
  for(const workType of ['repo-maintenance','documentation','security-settings']){
    assert.ok(OUTSIDE_ORCHESTRATOR_EXITS.includes(queueExit(workType)),`${workType} must be outside orchestrator action`)
  }
  assert.equal(OUTSIDE_ORCHESTRATOR_EXITS.includes('fork'),false,'fork still means the orchestrator hands the work on inside this repo')
  assert.equal(OUTSIDE_ORCHESTRATOR_EXITS.includes('reject'),false,'a reject is still an orchestrator action: it must be returned')
})

test('every work type keeps an exit, so a new one cannot be added without a routing decision',()=>{
  const expected=['structural','curated-master-data','application-data','source-data','repo-maintenance','documentation','security-settings']
  const covered=new Set(['structural',...Object.keys(NON_STRUCTURAL_EXITS)])
  for(const workType of expected) assert.ok(covered.has(workType),`${workType} has no exit`)
  assert.equal(covered.size,expected.length,'an unexpected work type gained an exit without updating this test')
})

test('the queue audit names every open issue that fails the shape test with its exit',()=>{
  const issues=[
    {number:50,title:'structure',body:scope('ready','structural','shared-db-orchestrator',9,['table core.a'])},
    {number:51,title:'row cleanup',body:scope('ready','application-data','application-session',8)},
    {number:52,title:'ci guard defect',body:scope('ready','repo-maintenance','repo-maintenance',7)},
    {number:53,title:'owner question',body:scope('owner-decision','security-settings','owner-only',6)},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.deepEqual(result.notOrchestratorWork.map((x)=>x.issue),[51,52,53])
  assert.deepEqual(result.notOrchestratorWork.map((x)=>x.exit),['reject','repo-session','return-to-owner'])
  assert.equal(result.notOrchestratorWork.find((x)=>x.issue===53).blockedOnOwner,true)
  assert.equal(result.notOrchestratorWork.some((x)=>x.issue===50),false)
  assert.deepEqual(result.dispatchable,[50])
})

test('a non-structural issue parked at blocked is still reported rather than silently skipped',()=>{
  const result=buildDynamicQueues([{number:54,title:'parked',body:scope('blocked','documentation','repo-maintenance',5)}],[],NOW)
  assert.deepEqual(result.notOrchestratorWork.map((x)=>x.exit),['repo-session'])
  assert.deepEqual(result.dispatchable,[])
})

test('curated Master Data forks inside this repo and is never returned to an application repo',()=>{
  assert.equal(queueExit('curated-master-data'),'fork')
  assert.equal(requiresReturnAddress('curated-master-data'),false)
  const result=buildDynamicQueues([{number:80,title:'outside-sourced property load',body:scope('ready','curated-master-data','curated-master-data-governance',10)}],[],NOW)
  assert.equal(result.notOrchestratorWork[0].exit,'fork')
  assert.equal(result.notOrchestratorWork[0].needsReturnAddress,false)
})

test('a reject exit without a return address is reported and fails the audit',()=>{
  const noAddress=scope('ready','application-data','application-session',6)
  const addressed=noAddress.replace('route: application-session','route: application-session\nreturn_to: u2giants/popdam3')
  assert.equal(requiresReturnAddress('application-data'),true)
  assert.equal(requiresReturnAddress('repo-maintenance'),false)
  const result=buildDynamicQueues([{number:60,title:'rows',body:noAddress},{number:61,title:'rows',body:addressed}],[],NOW)
  const [missing,present]=result.notOrchestratorWork
  assert.equal(missing.needsReturnAddress,true)
  assert.equal(missing.returnTo,null)
  assert.equal(present.needsReturnAddress,false)
  assert.equal(present.returnTo,'u2giants/popdam3')
})

test('return_to is validated when present and never allowed on structural work',()=>{
  assert.throws(()=>parseQueueScope(scope('ready','application-data','application-session',1).replace('route: application-session','route: application-session\nreturn_to: not a repo')),/owner\/repo slug/)
  assert.throws(()=>parseQueueScope(scope('ready','structural','shared-db-orchestrator',1,['table core.a']).replace('priority: 1','return_to: u2giants/popdam3\npriority: 1')),/must not carry a return_to/)
})

test('returning a rejected issue files it in the owning repo BEFORE closing it here',()=>{
  const calls=[]
  const io={
    getIssue:()=>({number:70,title:'PopDAM rows are wrong',body:scope('ready','application-data','application-session',6).replace('route: application-session','route: application-session\nreturn_to: u2giants/popdam3'),state:'open'}),
    getIssueComments:()=>[],
    createIssueIn:(repo,title,body)=>{calls.push(['create',repo,title]);assert.match(body,/Original issue/);return 'https://github.com/u2giants/popdam3/issues/9'},
    commentIssue:(n,b)=>{calls.push(['comment',n,b]);assert.ok(b.includes(RETURNED_MARKER))},
    closeIssue:(n)=>calls.push(['close',n]),
  }
  const result=returnIssueToOwner(70,io)
  assert.equal(result.url,'https://github.com/u2giants/popdam3/issues/9')
  assert.deepEqual(calls.map((c)=>c[0]),['create','comment','close'])
})

test('a failed mirror creation leaves the rejected issue open and untouched',()=>{
  const calls=[]
  const base={
    getIssue:()=>({number:71,title:'t',body:scope('ready','application-data','application-session',6).replace('route: application-session','route: application-session\nreturn_to: u2giants/popdam3'),state:'open'}),
    getIssueComments:()=>[],
    commentIssue:(n)=>calls.push(['comment',n]),
    closeIssue:(n)=>calls.push(['close',n]),
  }
  assert.throws(()=>returnIssueToOwner(71,{...base,createIssueIn:()=>{throw new Error('gh failed')}}),/gh failed/)
  assert.throws(()=>returnIssueToOwner(71,{...base,createIssueIn:()=>''}),/did not return an issue URL/)
  assert.deepEqual(calls,[])
})

test('return refuses fork work, a missing address, and a second return',()=>{
  const io=(body,comments=[])=>({getIssue:()=>({number:72,title:'t',body,state:'open'}),getIssueComments:()=>comments,createIssueIn:()=>{throw new Error('must not be called')},commentIssue:()=>{},closeIssue:()=>{}})
  assert.throws(()=>returnIssueToOwner(72,io(scope('ready','repo-maintenance','repo-maintenance',5))),/whose exit is repo-session, not return/)
  assert.throws(()=>returnIssueToOwner(72,io(scope('ready','application-data','application-session',5))),/no return_to address/)
  const addressed=scope('ready','application-data','application-session',5).replace('route: application-session','route: application-session\nreturn_to: u2giants/popdam3')
  assert.throws(()=>returnIssueToOwner(72,io(addressed,[{body:`${RETURNED_MARKER} https://github.com/u2giants/popdam3/issues/9`}])),/already returned/)
})

test('dependency on an open non-db-work issue prevents dispatch',()=>{
  const issues=[{number:11,title:'dependent',body:scope('ready','structural','shared-db-orchestrator',8,['table core.x'],'#99')}]
  const result=buildDynamicQueues(issues,[],NOW,[11,99])
  assert.deepEqual(result.dispatchable,[])
  assert.match(result.skipped[0].reason,/99/)
})

test('NBCU rights classification is source-data work and never dispatches',()=>{
  const result=buildDynamicQueues([{number:732,title:'NBCU rights classification',body:scope('ready','source-data','source-data-session',600)}],[],NOW)
  assert.deepEqual(result.dispatchable,[])
  assert.equal(result.skipped[0].route,'source-data-session')
})

test('application row cleanup is application data and never dispatches',()=>{
  const result=buildDynamicQueues([{number:20,title:'row cleanup',body:scope('ready','application-data','application-session',10)}],[],NOW)
  assert.deepEqual(result.dispatchable,[])
})

test('outside-sourced core.property load keeps governed Master Data route without an author lane',()=>{
  const result=buildDynamicQueues([{number:21,title:'outside source load',body:scope('ready','curated-master-data','curated-master-data-governance',10)}],[],NOW)
  assert.deepEqual(result.dispatchable,[])
  assert.equal(result.skipped[0].route,'curated-master-data-governance')
})

test('owner-only question with no implementation never dispatches',()=>{
  const result=buildDynamicQueues([{number:22,title:'owner question',body:scope('owner-decision','repo-maintenance','owner-only',10)}],[],NOW)
  assert.deepEqual(result.dispatchable,[])
})

test('answering a data question changes status only and cannot become structural',()=>{
  const answered=scope('ready','source-data','source-data-session',10)
  const parsed=parseQueueScope(answered)
  assert.equal(parsed.status,'ready')
  assert.equal(parsed.workType,'source-data')
  assert.equal(parsed.route,'source-data-session')
  assert.deepEqual(buildDynamicQueues([{number:23,title:'answered data question',body:answered}],[],NOW).dispatchable,[])
})

test('an unclassified issue prevents proof that an empty lane is justified',()=>{
  const result=buildDynamicQueues([{number:20,title:'unknown',body:'plain prose'}],[],NOW)
  assert.equal(result.fullyAudited,false)
  assert.deepEqual(result.unclassified,[20])
})

test('legacy claims count toward the author-lane cap and always protect objects', () => {
  const legacy = (n, object) => ({ number:n, body:`\`\`\`db-claim\nversion: none\nobjects:\n  - ${object}\n\`\`\`` })
  // Asserted against the constant, not a literal, so the cap can move without
  // this test quietly checking the wrong number -- but the constant itself is
  // pinned, so a change to it is a deliberate edit here.
  assert.equal(MAX_AUTHOR_LANES, 8)
  const full = Array.from({length:MAX_AUTHOR_LANES},(_,i)=>legacy(i+1,`table core.t${i}`))
  assert.doesNotThrow(() => assertLaneAvailable(full.slice(0,MAX_AUTHOR_LANES-1), ['table core.d'], NOW))
  assert.throws(() => assertLaneAvailable(full, ['table core.d'], NOW), new RegExp(`all ${MAX_AUTHOR_LANES}`))
  assert.throws(() => assertLaneAvailable([legacy(1,'table core.a')], ['TABLE core.a'], NOW), /collision/)
  assert.equal(parseAuthorLease(legacy(1,'table core.a').body, NOW).legacy, true)
})

test('expired claims retain capacity and object protection until explicit release', () => {
  const claims=[{number:4,body:body(['table core.old'],'4','2026-08-14T19:59:59Z')}]
  const state=assertLaneAvailable(claims,['table core.new'],NOW)
  assert.equal(state.active.length,1)
  assert.deepEqual(state.stale.map(x=>x.number),[4])
  assert.throws(()=>assertLaneAvailable(claims,['table core.old'],NOW),/collision/)
})

test('open PR objects participate in acquisition collision checks', () => {
  assert.throws(()=>assertLaneAvailable([],['function plm.f'],NOW,{prSources:[{label:'PR #9',objects:['FUNCTION plm.f']}]}),/PR #9/)
})

function memoryIo() {
  let seq=0
  const refs=new Map()
  const calls=[]
  return { refs,calls,
    openClaims:()=>[], prSources:()=>[], openPulls:()=>[],
    makeOwnerCommit:()=>`sha-${++seq}`,
    createRef:(ref,sha)=>{calls.push(['create',ref,sha]);if(refs.has(ref))return false;refs.set(ref,sha);return true},
    readRef:(ref)=>refs.get(ref)??null,
    listRefs:(prefix)=>[...refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})),
    deleteRef:(ref)=>{calls.push(['delete',ref]);refs.delete(ref)},
    reserveVersion:()=>({version:'20260814170219'}),
    createClaim:()=> 'https://github.test/issues/1', closeClaim:()=>{},
    getPr:(number)=>({number:Number(number),head:{sha:'abc',ref:'codex/x'},base:{sha:'main'}}),mainSha:()=> 'main',
    getCommit:()=>({message:'db-coordination author-acquisition request-1',committer:{date:'2026-08-14T19:55:00Z'}}),
  }
}

function reviewIo(){
  const io=memoryIo(), commits=new Map();let seq=0
  io.resolveOrchestratorEngine=()=> 'claude'
  io.refs.set(REVIEW_ACTIVE_CUTOVER_REF,'cutover-complete')
  io.makeOwnerCommit=(message)=>{const sha=(++seq).toString(16).padStart(40,'0');commits.set(sha,{message});return sha}
  io.getCommit=(sha)=>commits.get(sha)
  io.updateRef=(ref,sha)=>io.refs.set(ref,sha)
  io.getIssue=()=>({state:'open'})
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:'abcdef9',ref:'codex/x'}})
  io.getIssueComments=()=>[]
  io.getPrReviews=()=>[]
  return io
}

test('reviewer cursor advances atomically through the durable round robin',()=>{
  const io=reviewIo(), names=[]
  for(let n=1;n<=ACTIVE_REVIEWERS.length+1;n++)names.push(assignNextReviewer({issue:n,pr:100+n,headSha:`abcdef${n}`},io).reviewer)
  assert.deepEqual(names,[...ACTIVE_REVIEWERS.map((row)=>row.name),ACTIVE_REVIEWERS[0].name])
  assert.ok(io.refs.has(REVIEW_CURSOR_REF))
})

test('durable per-PR exclusion skips a truthfully disposed reviewer on a new head',()=>{
  const io=reviewIo(), first=assignNextReviewer({issue:1833,pr:1900,headSha:'a'.repeat(40)},io)
  const evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1900-${'a'.repeat(40)}`)
  const excluded=excludeReviewerForPr({issue:1833,pr:1900,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io)
  assert.deepEqual(parseReviewExclusion(io.getCommit(excluded.sha)),{reviewer:first.reviewer,issue:1833,pr:1900,reason:'already-reviewed',evidenceSha})
  io.getPr=()=>({state:'open',head:{sha:'b'.repeat(40),ref:'codex/x'}})
  const next=assignNextReviewer({issue:1833,pr:1900,headSha:'b'.repeat(40)},io)
  assert.notEqual(next.reviewer,first.reviewer)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-review-failures/1833-1900-')),false)
})

test('reviewer exclusion is idempotent and rejects false evidence or changed disposition',()=>{
  const io=reviewIo(), first=assignNextReviewer({issue:1833,pr:1901,headSha:'c'.repeat(40)},io)
  const evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1901-${'c'.repeat(40)}`),request={issue:1833,pr:1901,reviewer:first.reviewer,reason:'terminal-unavailable',evidenceSha}
  const one=excludeReviewerForPr(request,io),two=excludeReviewerForPr(request,io)
  assert.equal(two.sha,one.sha)
  assert.throws(()=>excludeReviewerForPr({...request,issue:1834},io),/evidence does not match/)
  assert.throws(()=>excludeReviewerForPr({...request,reason:'already-reviewed'},io),/different durable exclusion/)
})

test('a same-head review continues in the next slot without fabricating a failure',()=>{
  const io=reviewIo(),head='e'.repeat(40),first=assignNextReviewer({issue:1833,pr:1904,headSha:head},io),evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1904-${head}`)
  excludeReviewerForPr({issue:1833,pr:1904,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io)
  const next=assignNextReviewer({issue:1833,pr:1904,headSha:head,slot:2},io)
  assert.notEqual(next.reviewer,first.reviewer)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-review-failures/1833-1904-')),false)
})

test('an exclusion created while assignment waits for the mutex is never missed',()=>{
  const io=reviewIo(),reviewer=ACTIVE_REVIEWERS[0].name,ref=`${REVIEW_EXCLUSION_REF_PREFIX}/1833-1902-${reviewer}`
  const exclusionSha=io.makeOwnerCommit(`db-coordination reviewer-exclusion reviewer=${reviewer} issue=1833 pr=1902 reason=independence-conflict evidence=${'a'.repeat(40)}`),create=io.createRef
  io.createRef=(target,sha)=>{const made=create(target,sha);if(target===MUTEX_REF&&made)io.refs.set(ref,exclusionSha);return made}
  const assigned=assignNextReviewer({issue:1833,pr:1902,headSha:'d'.repeat(40)},io)
  assert.notEqual(assigned.reviewer,reviewer)
})

test('replacement selection skips reviewers durably excluded for the PR',()=>{
  const io=reviewIo(),headA='a'.repeat(40),headB='b'.repeat(40),first=assignNextReviewer({issue:1833,pr:1903,headSha:headA},io)
  io.getPr=()=>({state:'open',head:{sha:headB,ref:'codex/x'}})
  const second=assignNextReviewer({issue:1833,pr:1903,headSha:headB},io),evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1903-${headB}`)
  excludeReviewerForPr({issue:1833,pr:1903,reviewer:second.reviewer,reason:'terminal-unavailable',evidenceSha},io)
  io.getPr=()=>({state:'open',head:{sha:headA,ref:'codex/x'}})
  const replacement=replaceFailedReviewer({issue:1833,pr:1903,headSha:headA,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  assert.notEqual(replacement.reviewer,second.reviewer)
})

test('active reviewer lease parser round-trips exact identity and fails closed',()=>{
  const reviewer=ACTIVE_REVIEWERS[0].name, message=`db-coordination reviewer-lease generation=7 reviewer=${reviewer} issue=1767 pr=1800 head=${'a'.repeat(40)} sequence=9`
  assert.deepEqual(parseReviewLease({message}),{generation:7,reviewer,issue:1767,pr:1800,headSha:'a'.repeat(40),sequence:9})
  assert.throws(()=>parseReviewLease({message:message.replace(reviewer,'unknown-reviewer')}),/malformed/)
  assert.throws(()=>parseReviewLease({message:message.replace('head='+('a'.repeat(40)),'head=not-a-sha')}),/malformed/)
  const legacy=parseReviewLease({message:message.replace('a'.repeat(40),'abcdef1')})
  const io=reviewIo(),sha=io.makeOwnerCommit(message.replace('a'.repeat(40),'abcdef1')),ref=reviewActiveRef(reviewer)
  assert.equal(legacy.headSha,'abcdef1');io.requiresExactReviewHeadSha=true;io.refs.set(ref,sha);assert.equal(findBusyReviewers(io),null)
})

test('low or unreadable quota refuses before owner commit and mutex acquisition',()=>{
  for(const quota of [{remaining:10,graphRemaining:5000,reset:1787943600,graphReset:1787943600},{remaining:5000,graphRemaining:10,reset:1787943600,graphReset:1787943600},null]){
    const io=reviewIo();let owners=0;io.getRateLimit=()=>quota;io.makeOwnerCommit=(...args)=>{owners++;return reviewIo().makeOwnerCommit(...args)}
    assert.throws(()=>assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40)},io),/quota/i)
    assert.equal(owners,0);assert.equal(io.refs.has(MUTEX_REF),false)
  }
})

test('wire-level request budget counts every retry and refuses the request past the limit',()=>{
  const overLimit=REVIEW_OPERATION_REQUEST_LIMIT+1
  let attempts=0
  assert.throws(()=>withReviewRequestBudget(()=>{
    for(let n=0;n<overLimit;n++)runGitHubCommand(['api','rate_limit'],{executor:()=>{attempts++;return '{}'}})
  }),new RegExp(`before request ${overLimit}`))
  assert.equal(attempts,REVIEW_OPERATION_REQUEST_LIMIT)
  attempts=0
  assert.throws(()=>withReviewRequestBudget(()=>runGitHubCommand(['api','endpoint'],{attempts:overLimit,wait:()=>{},executor:()=>{attempts++;const e=new Error('HTTP 502');e.stderr='HTTP 502';throw e},reportStderr:()=>{}})),new RegExp(`before request ${overLimit}`))
  assert.equal(attempts,REVIEW_OPERATION_REQUEST_LIMIT)
})

test('10,000 historical assignments do not change bounded availability cost',()=>{
  const run=(history)=>{
    const io=reviewIo();let requests=0,activeReads=0,historyScans=0
    for(let n=0;n<history;n++)io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${n}-${n+1}-${'b'.repeat(40)}`,`historical-${n}`)
    for(const name of ['readRef','getCommit','getPr','getIssueComments','getPrReviews','makeOwnerCommit','createRef','updateRef','deleteRef']){
      const fn=io[name];io[name]=(...args)=>{requests++;if(name==='readRef'&&String(args[0]).startsWith(REVIEW_ACTIVE_REF_PREFIX))activeReads++;return fn(...args)}
    }
    io.readActiveReviewLeases=()=>{requests++;return new Map()}
    const list=io.listRefs;io.listRefs=(prefix)=>{requests++;if(String(prefix).startsWith(REVIEW_ASSIGNMENT_REF_PREFIX))historyScans++;return list(prefix)}
    assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40)},io)
    return {requests,activeReads,historyScans}
  }
  const empty=run(0), large=run(10_000)
  assert.equal(large.historyScans,0);assert.equal(empty.requests,large.requests)
  assert.equal(large.requests,19,JSON.stringify(large));assert.equal(large.activeReads,0,JSON.stringify(large))
})

test('complete assignment stays inside the real wire-attempt budget',()=>{
  const io=reviewIo();let attempts=0,baseLoaded=false
  const rawGetCommit=io.getCommit
  const active=new Map(),states=new Map()
  ACTIVE_REVIEWERS.slice(0,-1).forEach((reviewer,index)=>{
    const issue=2000+index,pr=2100+index,headSha=`c${index}`.padEnd(40,'0')
    const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${index+1} reviewer=${reviewer.name} issue=${issue} pr=${pr} head=${headSha}`)
    io.refs.set(reviewActiveRef(reviewer.name),sha);active.set(reviewActiveRef(reviewer.name),{sha,commit:io.getCommit(sha)})
    states.set(`${issue}:${pr}`,{pr:{state:'open',head:{sha:headSha}},evidence:[]})
  })
  states.set('1767:1800',{issue:{state:'open'},pr:{state:'open',head:{sha:'a'.repeat(40)}},evidence:[]})
  // Multiple durable exclusions must remain one fixed-cost exact-record read.
  // The former prefix scan paid an unreserved getCommit request for every row
  // after the mutex was acquired and could exhaust the global wire ceiling.
  REVIEWERS.slice(0,4).forEach((reviewer,index)=>{
    const sha=io.makeOwnerCommit(`db-coordination reviewer-exclusion reviewer=${reviewer.name} issue=1767 pr=1800 reason=already-reviewed evidence=${String(index+1).repeat(40).slice(0,40)}`)
    io.refs.set(`${REVIEW_EXCLUSION_REF_PREFIX}/1767-1800-${reviewer.name}`,sha)
  })
  const wire=(n=1)=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;return '{}'}})}
  io.getRateLimit=()=>{wire(2);return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire();const snapshot=new Map(active);for(const [ref,sha] of io.refs)if(ref.startsWith(REVIEW_ACTIVE_REF_PREFIX))snapshot.set(ref,{sha,commit:rawGetCommit(sha)});return snapshot}
  io.readReviewStates=()=>{wire();return states}
  io.readReviewRefs=(refs)=>{wire();return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.readReviewRecords=(refs)=>{wire();return new Map(refs.map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}))}
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  for(const name of ['readRef','listRefs','getCommit','getPr','getIssueComments','getPrReviews','createRef','updateRef','deleteRef']){
    const fn=io[name];io[name]=(...args)=>{wire();return fn(...args)}
  }
  const make=io.makeOwnerCommit
  io.makeOwnerCommit=(message)=>{wire(1);baseLoaded=true;return make(message)}
  const result=assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40)},io)
  assert.ok(result.reviewer);assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`used ${attempts} wire attempts`)
  attempts=0
  assert.deepEqual(assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40)},io),result)
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`retry used ${attempts} wire attempts`)
})

test('complete slot-2 assignment stays inside the real wire-attempt budget (issue #1812)',()=>{
  // Regression for issue #1812: --review-slot 2 adds resolveSlotOneReviewer's
  // three extra wire calls (listRefs + readRef + getCommit) on top of slot 1's
  // own pre-mutex cost, so the budget must be sized for slot>=2's real total,
  // not just slot 1's. Before the fix this threw REFUSED at 9 pre-mutex calls
  // + the 13-call mutex-acquisition reserve = 22 > the old 19-request limit.
  const io=reviewIo();let attempts=0
  const rawGetCommit=io.getCommit
  const active=new Map(),states=new Map()
  ACTIVE_REVIEWERS.slice(0,-2).forEach((reviewer,index)=>{
    const issue=2200+index,pr=2300+index,headSha=`d${index}`.padEnd(40,'0')
    const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${index+1} reviewer=${reviewer.name} issue=${issue} pr=${pr} head=${headSha}`)
    io.refs.set(reviewActiveRef(reviewer.name),sha);active.set(reviewActiveRef(reviewer.name),{sha,commit:io.getCommit(sha)})
    states.set(`${issue}:${pr}`,{pr:{state:'open',head:{sha:headSha}},evidence:[]})
  })
  states.set('1722:1748',{issue:{state:'open'},pr:{state:'open',head:{sha:'a'.repeat(40)}},evidence:[]})
  const wire=(n=1)=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;return '{}'}})}
  io.getRateLimit=()=>{wire(2);return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire();const snapshot=new Map(active);for(const [ref,sha] of io.refs)if(ref.startsWith(REVIEW_ACTIVE_REF_PREFIX))snapshot.set(ref,{sha,commit:rawGetCommit(sha)});return snapshot}
  io.readReviewStates=()=>{wire();return states}
  io.readReviewRefs=(refs)=>{wire();return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  for(const name of ['readRef','listRefs','getCommit','getPr','getIssueComments','getPrReviews','createRef','updateRef','deleteRef']){
    const fn=io[name];io[name]=(...args)=>{wire();return fn(...args)}
  }
  const make=io.makeOwnerCommit
  io.makeOwnerCommit=(message)=>{wire(1);return make(message)}
  const first=assignNextReviewer({issue:1722,pr:1748,headSha:'a'.repeat(40)},io)
  attempts=0
  const second=assignNextReviewer({issue:1722,pr:1748,headSha:'a'.repeat(40),slot:2},io)
  assert.notEqual(second.reviewer,first.reviewer);assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`slot 2 used ${attempts} wire attempts`)
  // Round-6 review finding (issue #1812): `attempts <= LIMIT` on its own lets
  // several one-line regressions through green -- a dropped listRefs on the
  // counted path (9 pre-mutex becomes 8), or a silently raised ceiling. Pin the
  // operands themselves, not just the inequality they satisfy.
  //
  // Round-7 correction: an earlier version of this comment claimed the reserve
  // is what lets the operation release a mutex it has taken. That is false.
  // Release is guaranteed by `cleanupReserve`, which is set when the mutex is
  // acquired and enforced in `consumeReviewWireRequest`. The reserve here is an
  // ENTRY gate: it refuses to take the mutex unless the whole mutex-held
  // section still fits. Both reviewers derived that mechanism correctly, and
  // the wrong name was nearly merged anyway -- so the gate is now asserted by
  // behaviour below, not only by its numeral.
  assert.equal(attempts,21,`slot 2 used ${attempts} wire attempts; this fixture costs exactly 21 of the ${REVIEW_OPERATION_REQUEST_LIMIT}-request budget. If this changed, re-derive the ceiling rather than widening it`)
  assert.equal(REVIEW_MUTEX_SECTION_RESERVE,14,'the mutex-section entry-gate reserve changed without this budget being re-derived')
  assert.equal(REVIEW_OPERATION_REQUEST_LIMIT,23,'the ceiling changed; re-derive it against the real cost rather than raising it again')
  // The three pins above are near-tautologies: they restate constants. None of
  // them fails if the CALL SITE stops using the constant, because the gate asks
  // `count + required > LIMIT` and the remaining budget after pre-mutex is
  // LIMIT - count either way. So assert what the gate DOES: with one extra
  // counted pre-mutex call, the operation must refuse BEFORE the mutex exists.
  // A reserve one smaller would clear this gate, take the mutex, and only then
  // discover it cannot finish -- which is the failure the gate exists to stop.
  const slot2Ref=`${REVIEW_ASSIGNMENT_REF_PREFIX}/1722-1748-${'a'.repeat(40)}-slot2`
  assert.ok(io.refs.has(slot2Ref),'the slot-2 assignment ref should exist before it is cleared to re-run the pre-mutex path (the post-mutex portion re-runs via the cursor branch; pre-mutex cost is identical either way, which is all this gate assertion depends on)')
  io.refs.delete(slot2Ref)
  const rate=io.getRateLimit
  io.getRateLimit=()=>{wire(1);return rate()}
  attempts=0
  assert.throws(()=>assignNextReviewer({issue:1722,pr:1748,headSha:'a'.repeat(40),slot:2},io),/budget/i,'one extra pre-mutex call must be refused by the entry gate')
  assert.equal(io.refs.get(MUTEX_REF)??null,null,'the entry gate must refuse before the mutex is acquired; acquiring it and failing inside is what strands it for every other lane')
  io.getRateLimit=rate
  attempts=0
  assert.deepEqual(assignNextReviewer({issue:1722,pr:1748,headSha:'a'.repeat(40),slot:2},io),second)
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`slot 2 retry used ${attempts} wire attempts`)
})

test('complete replacement stays inside the real wire-attempt budget',()=>{
  const io=failedReviewIo();let attempts=0,baseLoaded=false;const labels=[]
  const rawGetCommit=io.getCommit
  const assigned=parseReviewCursor(io.getCommit(io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`)))
  const states=new Map([[`${failedReview.issue}:${failedReview.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:failedReview.headSha}},evidence:[]}]])
  const wire=(n=1,label='wire')=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;labels.push(label);return '{}'}})}
  io.getRateLimit=()=>{wire(1,'quota');return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  const ordinaryQuota=io.getRateLimit
  io.readActiveReviewLeases=()=>{wire(1,'active');return new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:rawGetCommit(sha)}]))};io.readReviewStates=()=>{wire(1,'states');return states}
  io.readReviewRefs=(refs)=>{wire(1,'readReviewRefs');return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{wire(1,'atomicReviewRefs');for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  io.readReviewRecords=(refs,prefix)=>{wire(prefix?2:1,'readReviewRecords');const result=new Map(refs.map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}));Object.defineProperty(result,'matching',{value:prefix?[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})):[]});return result}
  for(const name of ['readRef','listRefs','getCommit','getPr','getIssue','getIssueComments','getPrReviews','createRef','updateRef','deleteRef']){const fn=io[name];io[name]=(...args)=>{wire(1,`${name}:${String(args[0])}`);return fn(...args)}}
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(message)=>{wire(1,'commit');baseLoaded=true;return make(message)}
  // Baseline preflight is 8 requests, including the exact create-only verdict
  // ref check. Five additional fixed-record reads make 13; reserve 11 must
  // refuse because it exceeds the request ceiling. Reserve 10 would
  // acquire the mutex with no room for the measured success path plus cleanup.
  io.getRateLimit=()=>{wire(6,'replacement-record-read');return ordinaryQuota()}
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/budget/i)
  assert.equal(labels.includes(`createRef:${MUTEX_REF}`),false,'new replacement budget refusal must precede mutex acquisition')
  io.getRateLimit=ordinaryQuota;attempts=0;labels.length=0
  let result;try{result=replaceFailedReviewer(replacementRequest,io)}catch(error){throw new Error(`${error.message}; calls=${labels.join(',')}`)}
  assert.ok(result.reviewer);assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`used ${attempts} wire attempts`)
  const mutexAt=labels.indexOf(`createRef:${MUTEX_REF}`)
  assert.notEqual(mutexAt,-1,`mutex acquisition was not observed: ${labels.join(',')}`)
  assert.equal(mutexAt,8,'the first replacement path spends 8 requests before its mutex gate, including durable-verdict refusal')
  assert.equal(labels.length-mutexAt,10,`new replacement success path costs exactly 10 requests after mutex acquisition: ${labels.slice(mutexAt).join(',')}`)
  attempts=0;labels.length=0
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),result)
  const retryMutexAt=labels.indexOf(`createRef:${MUTEX_REF}`)
  assert.notEqual(retryMutexAt,-1,`retry mutex acquisition was not observed: ${labels.join(',')}`)
  assert.equal(retryMutexAt,9,'the idempotent path spends 9 requests before its mutex gate')
  assert.equal(labels.length-retryMutexAt,10,`idempotent replacement success path costs exactly 10 requests after mutex acquisition: ${labels.slice(retryMutexAt).join(',')}`)
  const source=readFileSync(new URL('./manage-migration-author-lanes.mjs',import.meta.url),'utf8')
  assert.match(source,/requireReviewWireCapacity\(11\);acquireReviewMutex\(ownerSha,io\);mutexAcquired=true/,'the idempotent reserve changed without re-derivation')
  assert.match(source,/requireReviewWireCapacity\(12\);acquireReviewMutex\(ownerSha,io\);mutexAcquired=true/,'the new-replacement reserve changed without re-derivation')
  // Baseline preflight is 8 requests. Six additional fixed-record reads make
  // 14; reserve 10 must refuse because 14 + 10 exceeds the 23-call ceiling.
  // Reserve 9 would acquire the mutex at exactly 23 and leave no room for the
  // measured success path.
  io.getRateLimit=()=>{wire(6,'replacement-record-read');return ordinaryQuota()}
  attempts=0;labels.length=0
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/budget/i)
  assert.equal(labels.includes(`createRef:${MUTEX_REF}`),false,'budget refusal must happen before mutex acquisition')
})

test('atomic replacement succeeds when the failed assignment has no active lease',()=>{
  const io=failedReviewIo(),failedRef=reviewActiveRef('grok-4.6');io.refs.delete(failedRef)
  io.readActiveReviewLeases=()=>new Map()
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  const result=replaceFailedReviewer(replacementRequest,io)
  assert.ok(result.reviewer);assert.equal(io.refs.has(failedRef),false);assert.equal(io.refs.has(reviewActiveRef(result.reviewer)),true)
})

test('merged-head replacement reuses the bounded target snapshot instead of rereading issue and verdict evidence (#1911)',()=>{
  const io=failedReviewIo(),mergeSha='c'.repeat(40)
  io.getIssue=()=>{throw new Error('separate issue read is forbidden')}
  io.getPr=()=>{throw new Error('separate PR read is forbidden')}
  io.getIssueComments=()=>{throw new Error('separate verdict read is forbidden')}
  io.getPrReviews=()=>{throw new Error('separate review read is forbidden')}
  io.mergeCommitInMain=(sha)=>sha===mergeSha
  io.readActiveReviewLeases=()=>new Map()
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{
    issue:{state:'closed'},
    pr:{state:'closed',merged:true,merge_commit_sha:mergeSha,head:{sha:lease.headSha}},
    evidence:[],
  }]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  const result=replaceFailedReviewer(replacementRequest,io)
  assert.ok(result.reviewer)
  assert.notEqual(result.reviewer,'codex-gpt-5.6-sol')
})

// ACTIVE ROTATION (owner instruction, 2026-08-28). Codex GPT-5.6 Sol and
// DeepSeek are ordinary approved reviewers. All-busy must fail closed.
function busyIo(){
  // Each active rotation reviewer holds one live assignment: an open PR, still
  // at the head it was given, with no verdict recorded.
  const io=reviewIo(), heads=new Map()
  ACTIVE_REVIEWERS.forEach((row,index)=>{
    const issue=500+index, pr=600+index, headSha=`fee${index}`.padEnd(40,'0')
    heads.set(pr,headSha)
    const sha=io.makeOwnerCommit(`db-coordination reviewer-lease generation=${index+1} reviewer=${row.name} issue=${issue} pr=${pr} head=${headSha} sequence=${index+1}`)
    io.refs.set(reviewActiveRef(row.name),sha)
  })
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:heads.get(Number(number))??'abcdef9'}})
  return {io,heads}
}

test('every active reviewer busy refuses a new assignment',()=>{
  const {io}=busyIo()
  assert.deepEqual([...findBusyReviewers(io)].sort(),ACTIVE_REVIEWERS.map((r)=>r.name).sort())
  assert.throws(()=>assignNextReviewer({issue:9,pr:109,headSha:'abcdef9'},io),/no reviewer is available/)
})

test('a busy rotation slot advances to the next free active reviewer',()=>{
  const {io,heads}=busyIo()
  // Muse's PR is merged, so muse is free again -- and free means rotation, even
  // though the sequence would otherwise land elsewhere.
  const musePr=600+ACTIVE_REVIEWERS.findIndex((r)=>r.name==='muse-spark-1.2-contributor')
  const openPr=io.getPr
  io.getPr=(number)=>Number(number)===musePr?{number:musePr,state:'closed',head:{sha:heads.get(musePr)}}:openPr(number)
  assert.ok(!findBusyReviewers(io).has('muse-spark-1.2-contributor'))
  assert.equal(pickReviewer(1,io).name,'muse-spark-1.2-contributor')
})

test('a recorded verdict and a moved head both free the reviewer that held them',()=>{
  const {io,heads}=busyIo()
  const grokPr=600
  // A verdict tied to the exact head ends that review.
  const verdictIo={...io,getPrReviews:(number)=>Number(number)===grokPr?[{body:`APPROVE ${heads.get(grokPr)}`,author_association:'OWNER'}]:[]}
  assert.ok(!findBusyReviewers(verdictIo).has('grok-4.6'))
  // So does a push that moves the PR past the head the reviewer was given.
  const openPr=io.getPr
  const movedIo={...io,getPr:(number)=>Number(number)===grokPr?{number:grokPr,state:'open',head:{sha:'9'.repeat(40)}}:openPr(number)}
  assert.ok(!findBusyReviewers(movedIo).has('grok-4.6'))
})

test('an unreadable busy probe keeps the rotation',()=>{
  // FAIL OPEN. A probe that cannot read GitHub must never silently send every
  // review to the provider that costs money per run.
  const {io}=busyIo()
  const blind={...io,readRef:()=>{throw new Error('HTTP 500')}}
  assert.equal(findBusyReviewers(blind),null)
  assert.equal(pickReviewer(1,blind).name,'grok-4.6')
  const noReadRef={...io};delete noReadRef.readRef
  assert.equal(findBusyReviewers(noReadRef),null)
  assert.equal(pickReviewer(2,noReadRef).name,'glm-5.3')
})

test('retired reviewer names stay resolvable so historical review evidence never orphans',()=>{
  // Reviewer names are read back out of permanent coordination refs and looked up
  // in REVIEWERS. One of those lookups is not null-guarded, so deleting a retired
  // name turns every historical review record into a crash. Renaming glm-5.2 to
  // glm-5.3 in place would have done exactly that.
  for(const retired of RETIRED_REVIEWERS){
    const row=REVIEWERS.find((r)=>r.name===retired)
    assert.ok(row,`retired reviewer ${retired} must remain readable in REVIEWERS`)
    assert.ok(row.wrapper,`retired reviewer ${retired} must still resolve to a wrapper`)
    assert.ok(!ACTIVE_REVIEWERS.some((r)=>r.name===retired),`${retired} must not receive new work`)
  }
})

test('the active rotation is exactly the current models, in a stable order',()=>{
  // Order and length are the round robin. A change here silently reassigns every
  // in-flight sequence to a different reviewer, so it must be asserted, not assumed.
  assert.deepEqual(ACTIVE_REVIEWERS.map((r)=>r.name),['grok-4.6','glm-5.3','kimi-k3','muse-spark-1.2-contributor','codex-gpt-5.6-sol','deepseek-chat'])
  assert.deepEqual(OVERFLOW_REVIEWERS,[])
  assert.equal(REVIEWERS.find((r)=>r.name==='kimi-k3').wrapper,'ai-kimi')
  assert.equal(REVIEWERS.find((r)=>r.name==='codex-gpt-5.6-sol').wrapper,'ai-codex-review')
  assert.equal(REVIEWERS.find((r)=>r.name==='glm-5.3').wrapper,'ai-glm')
  assert.equal(REVIEWERS.find((r)=>r.name==='muse-spark-1.2-contributor').wrapper,'ai-muse')
  assert.equal(REVIEWERS.find((r)=>r.name==='deepseek-chat').wrapper,'ai-deepseek-agent')
  assert.ok(!ACTIVE_REVIEWERS.some((r)=>/qwen|gemini/i.test(r.name)),'Qwen and Gemini must remain outside the active rotation')
})

test('the orchestrator engine is never eligible to review its own work',()=>{
  assert.ok(!reviewersForOrchestrator('codex').some((row)=>row.name==='codex-gpt-5.6-sol'))
  const future=[{name:'claude-opus',orchestratorEngine:'claude'},{name:'deepseek-chat'}]
  assert.deepEqual(reviewersForOrchestrator('claude',future).map((row)=>row.name),['deepseek-chat'])
  assert.throws(()=>reviewersForOrchestrator('',future),/engine is unreadable/)
})

test('a Codex orchestrator skips Codex in assignment and preflight',()=>{
  const io=reviewIo();io.resolveOrchestratorEngine=()=> 'codex'
  const assigned=[]
  for(let n=1;n<=ACTIVE_REVIEWERS.length;n++)assigned.push(assignNextReviewer({issue:700+n,pr:800+n,headSha:n.toString(16).padStart(40,'a')},io).reviewer)
  assert.ok(!assigned.includes('codex-gpt-5.6-sol'))
  const preflight={...preflightIo(),resolveOrchestratorEngine:()=> 'codex'}
  assert.throws(()=>reviewerExecutionPreflight({reviewer:'codex-gpt-5.6-sol',wrapper:'ai-codex-review',worktree:'C:/review',headSha:failedReview.headSha},preflight),/approved reviewer/)
})

test('reviewer assignment retry returns the same assignment without advancing',()=>{
  const io=reviewIo(), request={issue:9,pr:109,headSha:'abcdef9'}
  const first=assignNextReviewer(request,io), second=assignNextReviewer(request,io)
  assert.deepEqual(second,first)
  assert.equal(second.sequence,1)
})

test('assignment fails closed when the bounded reviewer index was never activated',()=>{
  const io=reviewIo();io.refs.delete(REVIEW_ACTIVE_CUTOVER_REF)
  assert.throws(()=>assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40)},io),/cutover is incomplete/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('assignment retry releases its lease after an exact-head verdict',()=>{
  const io=reviewIo(),request={issue:9,pr:109,headSha:'abcdef9'},first=assignNextReviewer(request,io),ref=reviewActiveRef(first.reviewer)
  io.getIssueComments=()=>[{body:`APPROVE ${request.headSha}`,author_association:'OWNER'}]
  assert.deepEqual(assignNextReviewer(request,io),first)
  assert.equal(io.refs.has(ref),false)
})

test('batched verdict reads request repository association for every evidence source',()=>{
  const fields=reviewStateGraphqlFields({issue:1224,pr:1957},0)
  assert.equal((fields.match(/authorAssociation/g)??[]).length,3)
  assert.match(fields,/pullRequest\(number:1957\).*comments\(first:100\).*authorAssociation/)
  assert.match(fields,/reviews\(first:100\).*authorAssociation/)
  assert.match(fields,/issue\(number:1224\).*comments\(first:100\).*authorAssociation/)
})

test('normal assignment retry releases an OWNER verdict lease without a manual ref path',()=>{
  const io=reviewIo(),headSha='7'.repeat(40),request={issue:1224,pr:1957,headSha}
  const first=assignNextReviewer(request,io),ref=reviewActiveRef(first.reviewer)
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{
    issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},
    evidence:[{body:`VERDICT: APPROVE\n\nReviewed at ${headSha}.`,authorAssociation:'OWNER'}],
  }]))
  let atomicLeaseRelease=false
  io.readReviewRefs=(refs)=>new Map(refs.map((name)=>[name,io.refs.get(name)??null]))
  io.atomicReviewRefs=(changes)=>{
    atomicLeaseRelease ||= changes.some((change)=>change.ref===ref&&change.expected===io.refs.get(ref)&&change.sha===null)
    for(const change of changes){assert.equal(io.refs.get(change.ref)??null,change.expected??null);if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}
  }
  assert.deepEqual(assignNextReviewer(request,io),first)
  assert.equal(io.refs.has(ref),false)
  assert.equal(atomicLeaseRelease,true)
})

test('normal assignment retry refuses a non-OWNER verdict and keeps its lease',()=>{
  const io=reviewIo(),headSha='8'.repeat(40),request={issue:1225,pr:1958,headSha}
  const first=assignNextReviewer(request,io),ref=reviewActiveRef(first.reviewer)
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{
    issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},
    evidence:[{body:`VERDICT: APPROVE\n\nReviewed at ${headSha}.`,authorAssociation:'CONTRIBUTOR'}],
  }]))
  assert.deepEqual(assignNextReviewer(request,io),first)
  assert.equal(io.refs.has(ref),true)
})

test('reviewer assignment refuses an abbreviated head SHA before acquiring its mutex',()=>{
  const io=reviewIo()
  io.requiresExactReviewHeadSha=true
  assert.throws(()=>assignNextReviewer({issue:1767,pr:1800,headSha:'abcdef1'},io),/exact 40-character head SHA/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('a successor lease appearing after preflight is never deleted',()=>{
  const io=reviewIo(),reviewer=ACTIVE_REVIEWERS[0],oldHead='d'.repeat(40),newHead='e'.repeat(40)
  const oldSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=${reviewer.name} issue=70 pr=80 head=${oldHead}`)
  const successorSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=2 reviewer=${reviewer.name} issue=71 pr=81 head=${newHead}`)
  const ref=reviewActiveRef(reviewer.name);io.refs.set(ref,oldSha)
  io.readActiveReviewLeases=()=>new Map([[ref,{sha:oldSha,commit:io.getCommit(oldSha)}]])
  io.readReviewStates=()=>new Map([['70:80',{issue:{state:'open'},pr:{state:'open',head:{sha:newHead}},evidence:[]}]])
  io.readReviewRefs=(refs)=>{if(refs.includes(ref))io.refs.set(ref,successorSha);return new Map(refs.map((name)=>[name,io.refs.get(name)??null]))}
  assert.throws(()=>assignNextReviewer({issue:72,pr:82,headSha:'f'.repeat(40)},io),/changed after preflight/)
  assert.equal(io.refs.get(ref),successorSha)
})

test('pre-cutover permanent assignment recreates its missing active lease',()=>{
  const io=reviewIo(),request={issue:9,pr:109,headSha:'abcdef9'},first=assignNextReviewer(request,io)
  const ref=reviewActiveRef(first.reviewer);io.refs.delete(ref)
  assert.deepEqual(assignNextReviewer(request,io),first)
  assert.ok(io.refs.has(ref))
})

test('cursor-only legacy assignment recreates its missing permanent and active refs',()=>{
  const io=reviewIo(),request={issue:100,pr:200,headSha:'b'.repeat(40)},reviewer=ACTIVE_REVIEWERS[0]
  io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=11 reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
  io.refs.set(REVIEW_CURSOR_REF,sha)
  assert.equal(assignNextReviewer(request,io).reviewer,reviewer.name)
  assert.equal(io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`),sha);assert.equal(io.refs.get(reviewActiveRef(reviewer.name)),sha)
})

test('a live historical assignment never recreates an active lease for a retired reviewer',()=>{
  const io=reviewIo(),request={issue:99,pr:199,headSha:'6'.repeat(40)},reviewer=RETIRED_REVIEWERS[0]
  io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=7 reviewer=${reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`,sha)
  assert.throws(()=>assignNextReviewer(request,io),/retired reviewer/)
  assert.equal(io.refs.has(`${REVIEW_ACTIVE_REF_PREFIX}/${reviewer}`),false);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('reviewer assignment remains stable after later assignments advance the cursor',()=>{
  const io=reviewIo(), a={issue:9,pr:109,headSha:'abcdef9'}
  const first=assignNextReviewer(a,io)
  assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io)
  assert.deepEqual(assignNextReviewer(a,io),first)
})

test('concurrent orchestrator cannot advance reviewer cursor without the mutex',()=>{
  const io=reviewIo();io.refs.set(MUTEX_REF,'other-orchestrator')
  assert.throws(()=>assignNextReviewer({issue:9,pr:109,headSha:'abcdef9'},io),/occupied/)
  assert.equal(io.refs.get(REVIEW_CURSOR_REF),undefined)
})

// AGENTS.md section 4 rule 2 is merge-first, so a migration that has reached main and
// only THEN owes an exact-head approval is an expected state (#1817). These four cases
// pin the merged-PR eligibility rule and, just as importantly, its limits. They drive
// the atomic path because that is the one production `githubIo` takes.
const MERGED_HEAD='8d3c31accd5b21ea669e65f5ae53f5f95cc57337'
function mergedPrIo({merged=true,mergeSha='b'.repeat(40),inMain=true,evidence=[]}={}){
  const io=reviewIo()
  const pr={number:1809,state:'closed',merged,merged_at:merged?'2026-08-28T00:00:00Z':null,merge_commit_sha:mergeSha,head:{sha:MERGED_HEAD,ref:'codex/x'}}
  io.getPr=()=>pr
  io.ancestryCalls=[]
  io.mergeCommitInMain=(sha)=>{io.ancestryCalls.push(sha);return inMain&&sha===mergeSha}
  // Deliberately NOT the REST-shaped `pr` above. readReviewStates is GraphQL-backed and
  // projects its own narrower object; feeding the REST shape here masked a production
  // defect where that projection carried no merge SHA at all, so every merged PR was
  // rejected after the mutex. This fixture mirrors the real projection exactly.
  const projected={state:merged?'merged':'closed',merged,merge_commit_sha:mergeSha,head:{sha:MERGED_HEAD}}
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'closed'},pr:projected,evidence}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  return io
}
const mergedRequest={issue:1769,pr:1809,headSha:MERGED_HEAD}

test('the GraphQL review-state projection carries the merge SHA the eligibility rule needs',()=>{
  // This is the assertion the fixture above CANNOT make. readReviewStates projects its
  // own narrow object from GraphQL, and it originally dropped both the merged flag and
  // the merge commit -- so every merged PR was rejected at the post-mutex gate in
  // production while hand-written fixtures passed. Testing the projection directly is
  // the only thing that pins it.
  const projected=projectReviewPr({state:'MERGED',merged:true,mergeCommit:{oid:'b'.repeat(40)},headRefOid:MERGED_HEAD})
  assert.equal(projected.merged,true)
  assert.equal(projected.merge_commit_sha,'b'.repeat(40))
  assert.equal(projected.state,'merged')
  assert.equal(projected.head.sha,MERGED_HEAD)
  // An unmerged PR must project as ineligible, not merely as missing data.
  const open_=projectReviewPr({state:'OPEN',merged:false,mergeCommit:null,headRefOid:MERGED_HEAD})
  assert.equal(open_.merged,false)
  assert.equal(open_.merge_commit_sha,'')
})

test('a merged pull request can receive a review assignment pinned to its merged head',()=>{
  const io=mergedPrIo()
  const result=assignNextReviewer(mergedRequest,io)
  assert.ok(result.reviewer)
  // The assignment ref shape is unchanged by the merged route, so the merge-lock gate
  // parser reads a merged-PR assignment exactly as it reads an open-PR one.
  const written=[...io.refs.keys()].filter((ref)=>ref.startsWith(REVIEW_ASSIGNMENT_REF_PREFIX))
  assert.deepEqual(written,[`${REVIEW_ASSIGNMENT_REF_PREFIX}/1769-1809-${MERGED_HEAD}`])
})

test('a closed but unmerged pull request is still refused a reviewer',()=>{
  assert.throws(()=>assignNextReviewer(mergedRequest,mergedPrIo({merged:false,mergeSha:''})),/changed after mutex acquisition/)
})

test('a closed issue with an open pull request is still refused a reviewer',()=>{
  const io=mergedPrIo(),openPr={state:'open',merged:false,merge_commit_sha:'',head:{sha:MERGED_HEAD}}
  io.getPr=()=>openPr
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'closed'},pr:openPr,evidence:[]}]))
  assert.throws(()=>assignNextReviewer(mergedRequest,io),/changed after mutex acquisition/)
})

test('an existing assignment is not returned after its closed issue target becomes an open PR',()=>{
  const io=mergedPrIo(),assigned=assignNextReviewer(mergedRequest,io),openPr={state:'open',merged:false,merge_commit_sha:'',head:{sha:MERGED_HEAD}}
  assert.ok(assigned.reviewer);io.getPr=()=>openPr
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'closed'},pr:openPr,evidence:[]}]))
  assert.throws(()=>assignNextReviewer(mergedRequest,io),/merge eligibility changed/)
})

test('an existing assignment is not returned after an open issue target closes unmerged or moves head',()=>{
  for(const pr of [{state:'closed',merged:false,merge_commit_sha:'',head:{sha:MERGED_HEAD}},{state:'open',merged:false,merge_commit_sha:'',head:{sha:'c'.repeat(40)}}]){
    const io=mergedPrIo();assignNextReviewer(mergedRequest,io);io.getPr=()=>pr
    io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr,evidence:[]}]))
    assert.throws(()=>assignNextReviewer(mergedRequest,io),/merge eligibility changed/)
  }
})

test('a merged pull request whose merge commit is absent from main is refused',()=>{
  // Discriminating on ANCESTRY specifically, not merely on "not open": this io differs
  // from the passing merged case above by exactly one bit, the ancestry answer. The
  // assertion that mergeCommitInMain was actually consulted with the merge SHA is what
  // stops the check from being silently dropped while the test still passes.
  const io=mergedPrIo({inMain:false})
  assert.throws(()=>assignNextReviewer(mergedRequest,io),/changed after mutex acquisition/)
  assert.deepEqual([...new Set(io.ancestryCalls)],['b'.repeat(40)])
})

test('the merged-PR ancestry answer is memoised, so it costs two requests once',()=>{
  // The predicate is reached from several alternative return paths in one operation.
  // Without the memo the wire cost would scale with call sites, which is the claim the
  // reserved budget depends on.
  const io=mergedPrIo()
  assignNextReviewer(mergedRequest,io)
  assert.equal(new Set(io.ancestryCalls).size,1)
  assert.equal(io.ancestryCalls.length,1)
})

test('a merged pull request can also receive a reviewer REPLACEMENT for its merged head',()=>{
  // The pre-mutex gate on the replacement path is a separate site from the post-mutex
  // recheck. An open-only test there throws before the merged-eligible gate is reached,
  // so replacement stayed impossible for a merged head even once assignment worked.
  const io=mergedPrIo()
  const first=assignNextReviewer(mergedRequest,io)
  const replaced=replaceFailedReviewer({...mergedRequest,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  assert.ok(replaced.reviewer)
  assert.notEqual(replaced.reviewer,first.reviewer)
})

test('an existing replacement is not returned after its closed issue target becomes an open PR',()=>{
  const io=mergedPrIo(),first=assignNextReviewer(mergedRequest,io),request={...mergedRequest,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}
  replaceFailedReviewer(request,io)
  const openPr={state:'open',merged:false,merge_commit_sha:'',head:{sha:MERGED_HEAD}};io.getPr=()=>openPr
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'closed'},pr:openPr,evidence:[]}]))
  assert.throws(()=>replaceFailedReviewer(request,io),/merge eligibility changed/)
})

test('an existing replacement is not returned after its open issue target moves head',()=>{
  const io=mergedPrIo(),first=assignNextReviewer(mergedRequest,io),request={...mergedRequest,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}
  replaceFailedReviewer(request,io)
  const moved={state:'open',merged:false,merge_commit_sha:'',head:{sha:'d'.repeat(40)}};io.getPr=()=>moved
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:moved,evidence:[]}]))
  assert.throws(()=>replaceFailedReviewer(request,io),/merge eligibility changed/)
})

test('an existing verdict at the merged head still refuses a new assignment',()=>{
  // A refusal tied to a head blocks that head permanently; the merged route inherits
  // that guard unchanged and must never become a way to void one.
  const io=mergedPrIo({evidence:[{state:'CHANGES_REQUESTED',commit_id:MERGED_HEAD,body:'REVISE',author_association:'OWNER'}]})
  assert.throws(()=>assignNextReviewer(mergedRequest,io),/changed after mutex acquisition/)
})

const failedReview={issue:9,pr:109,headSha:'abcdef9000000000000000000000000000000000'}
function failedReviewIo(){const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}});assignNextReviewer(failedReview,io);return io}
const replacementRequest={...failedReview,failedSequence:1,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}

test('terminal provider failure advances exactly once and retry is idempotent',()=>{
  const io=failedReviewIo(), first=replaceFailedReviewer(replacementRequest,io), second=replaceFailedReviewer(replacementRequest,io)
  assert.equal(first.sequence,2);assert.equal(first.reviewer,'glm-5.3');assert.deepEqual(second,first)
  assert.equal(assignNextReviewer(failedReview,io).reviewer,'glm-5.3')
  assert.equal(assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io).reviewer,'kimi-k3')
})

test('three terminal providers do not grow replacement preflight past the fixed wire budget (#1962)',()=>{
  const io=failedReviewIo();let attempts=0;const labels=[]
  const rawGetCommit=io.getCommit
  const wire=(n=1,label='wire')=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;labels.push(label);return '{}'}})}
  io.getRateLimit=()=>{wire(2,'quota');return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire(1,'active');return new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:rawGetCommit(sha)}]))}
  io.readReviewStates=(leases)=>{wire(1,'states');return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>{wire(1,'readReviewRefs');return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{wire(1,'atomicReviewRefs');for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  io.readReviewRecords=(refs,prefix)=>{wire(prefix?2:1,'readReviewRecords');const matching=prefix?[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha,commit:rawGetCommit(sha)})):[];const result=new Map(reviewRecordRefs(refs,matching).map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}));Object.defineProperty(result,'matching',{value:matching});return result}
  for(const name of ['readRef','getCommit','createRef']){const fn=io[name];io[name]=(...args)=>{wire(1,`${name}:${String(args[0])}`);return fn(...args)}}
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(message)=>{wire(1,'commit');return make(message)}
  const first=replaceFailedReviewer(replacementRequest,io)
  const second=replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence},io)
  attempts=0;labels.length=0
  const third=replaceFailedReviewer({...replacementRequest,failedSequence:second.sequence},io)
  assert.ok(third.reviewer)
  const mutexAt=labels.indexOf(`createRef:${MUTEX_REF}`)
  assert.equal(mutexAt,11,`third terminal-provider replacement pre-mutex accounting drifted: ${labels.join(',')}`)
  assert.equal(labels.length-mutexAt,10,`third terminal-provider replacement post-mutex accounting drifted: ${labels.join(',')}`)
  assert.equal(attempts,21,`third terminal-provider replacement wire accounting drifted: ${labels.join(',')}`)
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`third terminal-provider replacement used ${attempts} wire attempts`)
  const source=readFileSync(new URL('./manage-migration-author-lanes.mjs',import.meta.url),'utf8')
  assert.match(source,/const allRefs=reviewRecordRefs\(refs,matches\)/,'the production batch must include every immutable matching replacement and verdict ref')
  assert.match(source,/record\?\.sha===row\.sha&&record\?\.commit\?\.message\?record\.commit:undefined/,'matching replacement rows may reuse a batched commit only after exact SHA and message validation')
})

test('replacement retry releases its lease after an exact-head verdict',()=>{
  const io=failedReviewIo(),first=replaceFailedReviewer(replacementRequest,io),ref=reviewActiveRef(first.reviewer)
  io.getIssueComments=()=>[{body:`APPROVE ${failedReview.headSha}`,author_association:'OWNER'}]
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),first)
  assert.equal(io.refs.has(ref),false)
  assert.equal(assignNextReviewer(failedReview,io).reviewer,first.reviewer)
  assert.equal(io.refs.has(ref),false)
})

test('reviewer mutex acquisition tolerates delayed create visibility without caching stale reads',()=>{
  const io=reviewIo(),read=io.readRef;let mutexReads=0,batches=0
  io.readReviewRefs=(refs)=>{batches++;return new Map(refs.map((ref)=>[ref,ref===MUTEX_REF&&batches===1?null:io.refs.get(ref)??null]))}
  io.readRef=(ref)=>ref===MUTEX_REF&&++mutexReads<3?null:read(ref)
  const result=assignNextReviewer({issue:91,pr:191,headSha:'a'.repeat(40)},io)
  assert.ok(result.reviewer);assert.equal(io.refs.has(MUTEX_REF),false);assert.ok(mutexReads>=3)
})

test('reviewer mutex acquisition proof failure releases the newly-created mutex',()=>{
  const io=reviewIo()
  io.readReviewRefs=()=>{throw new Error('mutex proof unavailable')}
  assert.throws(()=>assignNextReviewer({issue:95,pr:195,headSha:'e'.repeat(40)},io),/mutex proof unavailable/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('lost mutex-create response releases an exact owned ref before returning the error',()=>{
  const io=reviewIo(),create=io.createRef
  io.createRef=(ref,sha)=>{create(ref,sha);throw new Error('create response lost')}
  assert.throws(()=>assignNextReviewer({issue:98,pr:198,headSha:'5'.repeat(40)},io),/create response lost/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('wire budget always preserves enough requests to release an acquired mutex',()=>{
  const io=reviewIo();let attempts=0,proofReads=0
  const wire=(n=1)=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;return '{}'}})}
  // Consume the same slack the real slot-1 pre-mutex path would (6 calls
  // reserved out of REVIEW_OPERATION_REQUEST_LIMIT), so this stays a tight,
  // zero-spare fit regardless of what the limit is currently set to.
  io.getRateLimit=()=>{wire(2+(REVIEW_OPERATION_REQUEST_LIMIT-19));return {remaining:5000,graphRemaining:5000,reset:1787943986,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire();return new Map()}
  io.readReviewStates=(leases)=>{wire();return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))}
  for(const name of ['createRef','readRef','deleteRef']){const fn=io[name];io[name]=(...args)=>{wire();return fn(...args)}}
  io.readReviewRefs=(refs)=>{wire();proofReads++;return new Map(refs.map((ref)=>[ref,ref===MUTEX_REF&&proofReads===1?null:io.refs.get(ref)??null]))}
  assert.throws(()=>assignNextReviewer({issue:97,pr:197,headSha:'4'.repeat(40)},io),/budget exhausted/)
  assert.equal(io.refs.has(MUTEX_REF),false);assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`used ${attempts} wire attempts`)
})

test('a stale selected reviewer that becomes live after locking is not overwritten',()=>{
  const io=reviewIo(),reviewer=ACTIVE_REVIEWERS[0],oldHead='1'.repeat(40),movedHead='2'.repeat(40),requestHead='3'.repeat(40)
  const oldSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=${reviewer.name} issue=70 pr=80 head=${oldHead}`),ref=reviewActiveRef(reviewer.name)
  io.refs.set(ref,oldSha)
  io.readActiveReviewLeases=()=>new Map([[ref,{sha:oldSha,commit:io.getCommit(oldSha)}]])
  let stateReads=0
  io.readReviewStates=(leases)=>{stateReads++;return new Map(leases.map((lease)=>{
    if(lease.issue===70)return ['70:80',{issue:{state:'open'},pr:{state:'open',head:{sha:stateReads===1?movedHead:oldHead}},evidence:[]}]
    return [`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]
  }))}
  io.readReviewRefs=(refs)=>new Map(refs.map((name)=>[name,io.refs.get(name)??null]))
  io.atomicReviewRefs=()=>{throw new Error('must not overwrite revived lease')}
  assert.throws(()=>assignNextReviewer({issue:96,pr:196,headSha:requestHead},io),/became live/)
  assert.equal(io.refs.get(ref),oldSha);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('atomic assignment failure leaves no partial refs and clears the mutex',()=>{
  const io=reviewIo();io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]));io.atomicReviewRefs=()=>{throw new Error('atomic push rejected')}
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  assert.throws(()=>assignNextReviewer({issue:92,pr:192,headSha:'b'.repeat(40)},io),/atomic push rejected/)
  assert.equal(io.refs.has(MUTEX_REF),false);assert.equal(io.refs.has(REVIEW_CURSOR_REF),false)
})

test('lost atomic assignment readback clears mutex and retry converges',()=>{
  const io=reviewIo();let batches=0
  io.readReviewRefs=(refs)=>{batches++;if(batches===2)throw new Error('readback lost');return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  const request={issue:93,pr:193,headSha:'c'.repeat(40)}
  assert.throws(()=>assignNextReviewer(request,io),/readback lost/);assert.equal(io.refs.has(MUTEX_REF),false)
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  assert.equal(assignNextReviewer(request,io).issue,93)
})

test('replacement retry repairs a crash between permanent evidence and lease updates',()=>{
  const io=failedReviewIo(),failedRef=reviewActiveRef('grok-4.6'),failedSha=io.refs.get(failedRef)
  const first=replaceFailedReviewer(replacementRequest,io),replacementRef=reviewActiveRef(first.reviewer)
  io.refs.delete(replacementRef);io.refs.set(failedRef,failedSha)
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),first)
  assert.equal(io.refs.has(failedRef),false);assert.ok(io.refs.has(replacementRef))
  io.refs.delete(replacementRef);io.refs.set(failedRef,failedSha)
  assert.equal(assignNextReviewer(failedReview,io).reviewer,first.reviewer)
  assert.equal(io.refs.has(failedRef),false);assert.ok(io.refs.has(replacementRef))
})

test('a historical replacement never recreates an active lease for a retired reviewer',()=>{
  const io=failedReviewIo(),reviewer=RETIRED_REVIEWERS[0],sequence=2
  const sha=io.makeOwnerCommit(`db-coordination reviewer-failure-replacement sequence=${sequence} reviewer=${reviewer} issue=${failedReview.issue} pr=${failedReview.pr} head=${failedReview.headSha} failed-sequence=1 prior-sequence=1 failure-ref=self failed-reviewer=grok-4.6 code=provider_unavailable verdict=none artifact=none`)
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-1`,sha)
  io.refs.set(`refs/db-review-failures/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-1`,sha)
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/retired reviewer/)
  assert.throws(()=>assignNextReviewer(failedReview,io),/retired reviewer/)
  assert.equal(io.refs.has(`${REVIEW_ACTIVE_REF_PREFIX}/${reviewer}`),false);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('replacement retry swaps a conclusively stale occupied successor lease',()=>{
  const io=failedReviewIo(),failedRef=reviewActiveRef('grok-4.6'),failedSha=io.refs.get(failedRef)
  const first=replaceFailedReviewer(replacementRequest,io),replacementRef=reviewActiveRef(first.reviewer)
  const staleSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=99 reviewer=${first.reviewer} issue=99 pr=199 head=${'d'.repeat(40)}`)
  io.refs.set(replacementRef,staleSha);io.refs.set(failedRef,failedSha)
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),first)
  assert.equal(io.refs.has(failedRef),false);assert.equal(io.refs.get(replacementRef),first.replacementSha)
})

test('replacement retry does not overwrite a same-SHA stale lease that becomes live after locking',()=>{
  const io=failedReviewIo(),failedRef=reviewActiveRef('grok-4.6'),failedSha=io.refs.get(failedRef)
  const first=replaceFailedReviewer(replacementRequest,io),replacementRef=reviewActiveRef(first.reviewer),oldHead='7'.repeat(40),movedHead='8'.repeat(40)
  const staleSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=99 reviewer=${first.reviewer} issue=99 pr=199 head=${oldHead}`)
  io.refs.set(replacementRef,staleSha);io.refs.set(failedRef,failedSha)
  io.readActiveReviewLeases=()=>new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:io.getCommit(sha)}]))
  let reads=0
  io.readReviewStates=(leases)=>{reads++;return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.issue===99?(reads===1?movedHead:oldHead):lease.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]));io.atomicReviewRefs=()=>{throw new Error('must not overwrite revived lease')}
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/became live/)
  assert.equal(io.refs.get(replacementRef),staleSha);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('replacement retry never overwrites an unrelated live successor lease',()=>{
  const io=failedReviewIo(),failedRef=reviewActiveRef('grok-4.6'),failedSha=io.refs.get(failedRef)
  const first=replaceFailedReviewer(replacementRequest,io),replacementRef=reviewActiveRef(first.reviewer)
  const liveSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=88 reviewer=${first.reviewer} issue=88 pr=188 head=${failedReview.headSha}`)
  io.refs.set(replacementRef,liveSha);io.refs.set(failedRef,failedSha)
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/unrelated live lease/)
  assert.equal(io.refs.get(replacementRef),liveSha);assert.equal(io.refs.get(failedRef),failedSha)
})

test('replacement refuses a PR close arriving after mutex acquisition',()=>{
  const io=failedReviewIo();let stateReads=0
  io.readActiveReviewLeases=()=>new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:io.getCommit(sha)}]))
  io.readReviewStates=(leases)=>{stateReads++;return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:stateReads===1?'open':'closed',head:{sha:lease.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=()=>{throw new Error('must not mutate')}
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/changed after mutex acquisition/)
  assert.equal(io.refs.has(MUTEX_REF),false);assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-review-failures')),false)
})

test('replacement does not overwrite a same-SHA stale target lease that becomes live after locking',()=>{
  const io=failedReviewIo(),target=ACTIVE_REVIEWERS[1],oldHead='9'.repeat(40),movedHead='a'.repeat(40),targetRef=reviewActiveRef(target.name)
  const staleSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=99 reviewer=${target.name} issue=99 pr=199 head=${oldHead}`)
  io.refs.set(targetRef,staleSha)
  io.readActiveReviewLeases=()=>new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:io.getCommit(sha)}]))
  let reads=0
  io.readReviewStates=(leases)=>{reads++;return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.issue===99?(reads===1?movedHead:oldHead):lease.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]));io.atomicReviewRefs=()=>{throw new Error('must not overwrite revived lease')}
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/became live/)
  assert.equal(io.refs.get(targetRef),staleSha);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('assignment refuses a PR close arriving after mutex acquisition',()=>{
  const io=reviewIo();let stateReads=0
  io.readActiveReviewLeases=()=>new Map()
  io.readReviewStates=(leases)=>{stateReads++;return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:stateReads===1?'open':'closed',head:{sha:lease.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]));io.atomicReviewRefs=()=>{throw new Error('must not mutate')}
  assert.throws(()=>assignNextReviewer({issue:94,pr:194,headSha:'d'.repeat(40)},io),/changed after mutex acquisition/)
  assert.equal(io.refs.has(MUTEX_REF),false);assert.equal(io.refs.has(REVIEW_CURSOR_REF),false)
})

const preflightIo=()=>({resolveOrchestratorEngine:()=> 'claude',commandAvailable:()=>true,localHead:()=>failedReview.headSha,localClean:()=>true,reviewerDoctor:()=>({ok:true,failingChecks:[]})})
const preflightRequest={reviewer:'grok-4.6',wrapper:'ai-grok-review',worktree:'C:/review',headSha:failedReview.headSha}

test('reviewer execution preflight enforces approved wrapper, clean worktree, and exact head',()=>{
  const io=preflightIo(), request=preflightRequest
  assert.equal(reviewerExecutionPreflight(request,io).ready,true)
  assert.throws(()=>reviewerExecutionPreflight({...request,wrapper:'ai-qwen'},io),/exact wrapper/)
  assert.throws(()=>reviewerExecutionPreflight(request,{...io,commandAvailable:()=>false}),/cannot execute/)
  assert.throws(()=>reviewerExecutionPreflight(request,{...io,localHead:()=> 'f'.repeat(40)}),/exact assigned head/)
  assert.throws(()=>reviewerExecutionPreflight(request,{...io,localClean:()=>false}),/dirty/)
})

// THE TWO-DAY BENCH (#1287). glm-5.3 was paused on three `provider_unavailable`
// failures while the provider was working: its local OpenCode server was not
// running and `ai-glm doctor` said so in one line. The preflight passed because
// it only checked that the wrapper binary existed. These tests pin the probe and
// the wording, because the wording is what stops the next wrong pause.
test('preflight refuses a LOCAL dependency fault and quotes the failing check',()=>{
  const io={...preflightIo(),reviewerDoctor:()=>({ok:false,failingChecks:['health endpoint answers']})}
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,io),/health endpoint answers/)
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,io),/LOCAL dependency fault/)
  // It must say plainly that the reviewer is not at fault, or the next operator
  // pauses a working provider exactly as before.
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,io),/not a grok-4.6 provider fault/)
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,io),/Do NOT pause grok-4.6/)
})

test('preflight refuses to report ready on evidence it never collected',()=>{
  const {reviewerDoctor,...noDoctor}=preflightIo()
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,noDoctor),/has no reviewerDoctor/)
  // An explicit opt-out is allowed, but the result says the probe did not run
  // rather than implying the provider was proved healthy.
  const skipped=reviewerExecutionPreflight({...preflightRequest,skipDoctor:true},noDoctor)
  assert.equal(skipped.ready,true);assert.equal(skipped.doctorChecked,false)
  assert.equal(reviewerExecutionPreflight(preflightRequest,preflightIo()).doctorChecked,true)
})

test('a doctor that names no failing check still refuses, and unnamed is not a pass',()=>{
  const io={...preflightIo(),reviewerDoctor:()=>({ok:false,failingChecks:[]})}
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,io),/an unnamed check/)
})

// A WINDOWS SHIM CANNOT BE SPAWNED DIRECTLY, and getting this wrong would have
// made the new preflight refuse EVERY review on Albert's machines with a false
// local-fault diagnosis -- the exact misdiagnosis this change exists to end.
// Caught by an independent review before it shipped; `execFileSync('ai-glm',...)`
// fails ENOENT on win32 even though `where.exe` finds the file.
test('a Windows .cmd wrapper is spawned through the command interpreter',()=>{
  const win=doctorSpawnPlan('C:/Users/ahazan/.local/bin/ai-glm.cmd','win32')
  assert.match(win.file,/cmd\.exe$/i)
  assert.deepEqual(win.args.slice(-2),['C:/Users/ahazan/.local/bin/ai-glm.cmd','doctor'])
  assert.ok(win.args.includes('/c'),'a batch shim must be run with cmd /c')
  assert.deepEqual(doctorSpawnPlan('C:/tools/ai-glm.BAT','win32').args.slice(-2),['C:/tools/ai-glm.BAT','doctor'])
  // Anything that is not a batch shim, on any platform, is executed directly.
  assert.deepEqual(doctorSpawnPlan('/usr/local/bin/ai-glm','linux'),{file:'/usr/local/bin/ai-glm',args:['doctor']})
  assert.deepEqual(doctorSpawnPlan('C:/tools/ai-glm.exe','win32'),{file:'C:/tools/ai-glm.exe',args:['doctor']})
  // A .cmd path on a non-Windows platform is NOT special-cased into cmd.exe.
  assert.deepEqual(doctorSpawnPlan('/opt/ai-glm.cmd','linux'),{file:'/opt/ai-glm.cmd',args:['doctor']})
})

test('SILENCE IS NOT A PASS, but an unfamiliar format is not a failure',()=>{
  // Real ai-muse output shape.
  assert.deepEqual(summarizeDoctorOutput('PASS  health endpoint answers'),{ok:true,failingChecks:[],format:'checks'})
  // A failing check always wins over any number of passing ones.
  assert.deepEqual(summarizeDoctorOutput('PASS  a\nFAIL  b\nPASS  c'),{ok:false,failingChecks:['b'],format:'checks'})
  // Nothing at all proves nothing.
  assert.equal(summarizeDoctorOutput('').ok,false)
  assert.equal(summarizeDoctorOutput('   \n\n').ok,false)
  assert.match(summarizeDoctorOutput('').failingChecks[0],/nothing at all/)
  assert.equal(summarizeDoctorOutput('').format,'silent')
  // REAL ai-grok-review output: no check lines anywhere, health signalled by exit
  // status alone. Refusing this would block a healthy Grok on every review.
  const grok=['grok binary   : /c/Users/ahazan/.grok/bin/grok','grok version  : grok 1.0.5 (5115b46bc9) [stable]','model         : grok-4.6','','auth          : OK (grok models succeeded)'].join('\n')
  // Its `auth : OK` footer is the TRAILING check form, read since 2026-08-25, so a
  // healthy Grok now reports as recognised checks rather than an unreadable format.
  assert.deepEqual(summarizeDoctorOutput(grok),{ok:true,failingChecks:[],format:'checks'})
  assert.equal(summarizeDoctorOutput(grok+'\nFAIL  auth').ok,false)
  // Output with no check line in EITHER form is still healthy on exit status alone.
  assert.deepEqual(summarizeDoctorOutput('grok binary   : /c/grok\nmodel         : grok-4.6'),{ok:true,failingChecks:[],format:'unrecognized'})
  // REAL ai-kimi output. This is the case the old parser could not see: a genuine
  // FAIL in the trailing form scored as an unreadable format and therefore as
  // healthy. Un-retiring kimi-k3 without this fix would have re-armed exactly the
  // false local-fault diagnosis the doctor probe exists to prevent.
  const kimi=['kimi version  : 0.36.1','model pin     : kimi-code/k3','read-only     : PASS (readonly-review.md)','preflight     : FAIL (execution-context-denied)','','auth          : OK'].join('\n')
  const kimiSummary=summarizeDoctorOutput(kimi)
  assert.equal(kimiSummary.ok,false)
  assert.equal(kimiSummary.format,'checks')
  assert.match(kimiSummary.failingChecks[0],/^preflight /)
  // A healthy kimi -- same shape, no FAIL -- passes.
  assert.equal(summarizeDoctorOutput(kimi.replace('preflight     : FAIL (execution-context-denied)','preflight     : PASS')).ok,true)
  // REAL ai-codex-review output: exactly one leading-form PASS line.
  assert.deepEqual(summarizeDoctorOutput('PASS provider=codex sandbox=read-only reasoning=explicit command=codex'),{ok:true,failingChecks:[],format:'checks'})
})

// `where.exe` lists an extension-less bash script BEFORE the .cmd shim for most
// wrappers here. Windows cannot execute the former at all, so taking the first
// line reported ai-grok-review and ai-muse as local faults while both were
// healthy -- the same false diagnosis this change exists to end, twice over.
test('on Windows the runnable shim is chosen, not the unrunnable script listed first',()=>{
  const both=['C:/Users/ahazan/.local/bin/ai-grok-review','C:/Users/ahazan/.local/bin/ai-grok-review.cmd']
  assert.equal(pickExecutableCandidate(both,'win32','.COM;.EXE;.BAT;.CMD'),both[1])
  // On a POSIX machine the extension-less file IS the executable; do not reorder.
  assert.equal(pickExecutableCandidate(['/usr/local/bin/ai-grok-review'],'linux'),'/usr/local/bin/ai-grok-review')
  assert.equal(pickExecutableCandidate(both,'linux'),both[0])
  // Nothing runnable: fall back to the first line rather than pretending it is missing.
  assert.equal(pickExecutableCandidate(['C:/tools/ai-glm.sh'],'win32','.COM;.EXE;.BAT;.CMD'),'C:/tools/ai-glm.sh')
  assert.equal(pickExecutableCandidate([],'win32'),null)
  // A missing PATHEXT must not disable the preference.
  assert.equal(pickExecutableCandidate(both,'win32',undefined),both[1])
})

test('REVIEWER_DOCTOR_TIMEOUT_MS is a real positive timeout',()=>{
  // Node treats 0 and NaN as "no timeout", so a blank or broken override would
  // silently let a hung doctor hang a governed lane.
  assert.ok(Number.isFinite(REVIEWER_DOCTOR_TIMEOUT_MS)&&REVIEWER_DOCTOR_TIMEOUT_MS>0)
})

test('resolveCommandPath returns the first candidate, or null when absent',()=>{
  assert.equal(resolveCommandPath('definitely-not-a-real-command-1287'),null)
  const node=resolveCommandPath('node')
  assert.ok(node&&node.length>0,'node must resolve on any machine running this suite')
  assert.ok(!/\r|\n/.test(node),'the resolved path must be a single trimmed line')
})

test('parseDoctorFailures returns only the failing check names, in order',()=>{
  const output=['PASS  pinned OpenCode is installed','FAIL  health endpoint answers','PASS  1Password command is available','FAIL  exact model is available'].join('\n')
  assert.deepEqual(parseDoctorFailures(output),['health endpoint answers','exact model is available'])
  assert.deepEqual(parseDoctorFailures('PASS  everything'),[])
  assert.deepEqual(parseDoctorFailures(''),[])
  assert.deepEqual(parseDoctorFailures('FAIL  trailing spaces   '),['trailing spaces'])
})

test('local_dependency_unavailable is a distinct terminal code and must name what failed',()=>{
  assert.ok(TERMINAL_FAILURE_CODES.includes('local_dependency_unavailable'))
  assert.ok(TERMINAL_FAILURE_CODES.includes('provider_unavailable'))
  const io=failedReviewIo(), local={...replacementRequest,failureCode:'local_dependency_unavailable'}
  assert.throws(()=>replaceFailedReviewer(local,io),/requires --failing-check/)
  // Named but not confirmed unfixable: refuse, and tell the operator to fix the
  // machine and retry the SAME reviewer rather than spend a rotation slot.
  const named={...local,failingCheck:'health endpoint answers'}
  assert.throws(()=>replaceFailedReviewer(named,io),/LOCAL dependency fault/)
  assert.throws(()=>replaceFailedReviewer(named,io),/retry the SAME reviewer/)
  // Nothing was recorded against the working provider.
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-review-failures/')),false)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_REPLACEMENT_REF_PREFIX)),false)
})

test('a confirmed-unfixable local fault replaces and writes the failing check into the evidence',()=>{
  const io=failedReviewIo()
  const done=replaceFailedReviewer({...replacementRequest,failureCode:'local_dependency_unavailable',failingCheck:'health endpoint answers',confirmLocalDependencyUnfixable:true},io)
  assert.equal(done.reviewer,'glm-5.3')
  const failureRef=[...io.refs.keys()].find((ref)=>ref.startsWith('refs/db-review-failures/'))
  const message=io.getCommit(io.refs.get(failureRef)).message
  assert.match(message,/code=local_dependency_unavailable/)
  assert.match(message,/failing-check=health_endpoint_answers/)
})

test('a confirmed-unfixable local replacement is idempotent with the same flags',()=>{
  const io=failedReviewIo()
  const request={...replacementRequest,failureCode:'local_dependency_unavailable',failingCheck:'health endpoint answers',confirmLocalDependencyUnfixable:true}
  const first=replaceFailedReviewer(request,io)
  assert.deepEqual(replaceFailedReviewer(request,io),first)
  // The evidence is written once, not once per retry.
  assert.equal([...io.refs.keys()].filter((ref)=>ref.startsWith('refs/db-review-failures/')).length,1)
})

test('--failing-check is refused for every code that is not a local fault',()=>{
  const io=failedReviewIo()
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failingCheck:'health endpoint answers'},io),/applies only to local_dependency_unavailable/)
  // An ordinary provider failure still records no failing-check field at all.
  const done=replaceFailedReviewer(replacementRequest,io)
  const failureRef=[...io.refs.keys()].find((ref)=>ref.startsWith('refs/db-review-failures/'))
  assert.ok(done.replacementSha)
  assert.doesNotMatch(io.getCommit(io.refs.get(failureRef)).message,/failing-check/)
})

test('paused Qwen evidence remains readable but Qwen receives no new assignment',()=>{
  const io=reviewIo(), request={issue:9,pr:109,headSha:'abcdef9'}
  const historical=io.makeOwnerCommit('db-coordination reviewer-cursor sequence=64 reviewer=qwen-3.8-max issue=9 pr=109 head=abcdef9')
  io.refs.set(REVIEW_CURSOR_REF,historical)
  const recovered=assignNextReviewer(request,io)
  assert.equal(recovered.reviewer,'qwen-3.8-max');assert.equal(recovered.wrapper,'ai-qwen')
  const next=assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io)
  assert.notEqual(next.reviewer,'qwen-3.8-max')
})

test('two consecutive terminal no-verdict failures form an immutable idempotent chain',()=>{
  const io=failedReviewIo()
  const first=replaceFailedReviewer(replacementRequest,io)
  const secondRequest={...replacementRequest,failedSequence:first.sequence,failureCode:'turn_limit_cancelled'}
  const second=replaceFailedReviewer(secondRequest,io)
  assert.equal(first.sequence,2);assert.equal(second.sequence,3);assert.equal(second.reviewer,'kimi-k3')
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),first)
  assert.deepEqual(replaceFailedReviewer(secondRequest,io),second)
  assert.equal(assignNextReviewer(failedReview,io).sequence,3)
  assert.equal([...io.refs.keys()].filter((ref)=>ref.startsWith(REVIEW_REPLACEMENT_REF_PREFIX)).length,2)
})

test('batched review records include the exact verdict ref for every matched replacement',()=>{
  const replacement=`${REVIEW_REPLACEMENT_REF_PREFIX}/1824-1931-${'a'.repeat(40)}-5`
  assert.deepEqual(reviewRecordRefs(['refs/explicit'],[{ref:replacement}]),[
    'refs/explicit',
    replacement,
    replacement.replace(REVIEW_REPLACEMENT_REF_PREFIX,'refs/db-review-verdict-replacements'),
  ])
})

test('production-shaped batched records refuse a chained replacement with an artifact-only predecessor verdict',()=>{
  const io=failedReviewIo(),rawGetCommit=io.getCommit
  io.readReviewRecords=(refs,prefix)=>{
    const matching=prefix?[...io.refs.entries()]
      .filter(([ref])=>ref.startsWith(prefix))
      .map(([ref,sha])=>({ref,sha,commit:rawGetCommit(sha)})):[]
    const result=new Map(reviewRecordRefs(refs,matching).map((ref)=>{
      const sha=io.refs.get(ref)
      return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]
    }))
    Object.defineProperty(result,'matching',{value:matching})
    return result
  }
  const first=replaceFailedReviewer(replacementRequest,io)
  const predecessorRef=`${REVIEW_REPLACEMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-${replacementRequest.failedSequence}`
  const verdictRef=predecessorRef.replace(REVIEW_REPLACEMENT_REF_PREFIX,'refs/db-review-verdict-replacements')
  io.refs.set(verdictRef,io.makeOwnerCommit('artifact-only exact-head verdict'))
  assert.throws(
    ()=>replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence,failureCode:'provider_unavailable'},io),
    /existing verdict/,
  )
})

test('chained replacement rejects mismatch, exact-head drift, and a verdict at every depth',()=>{
  const io=failedReviewIo(), first=replaceFailedReviewer(replacementRequest,io)
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence+1},io),/does not match/)
  io.getPr=()=>({state:'open',head:{sha:'ffffffffffffffffffffffffffffffffffffffff'}})
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence,failureCode:'provider_unavailable'},io),/exact open PR head/)
  io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}})
  io.getPrReviews=()=>[{body:`APPROVE ${failedReview.headSha}`,author_association:'OWNER'}]
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence,failureCode:'provider_unavailable'},io),/existing verdict/)
})

test('concurrent chained replacement write is rejected without changing the cursor or prior links',()=>{
  const io=failedReviewIo(), first=replaceFailedReviewer(replacementRequest,io), before=io.refs.get(REVIEW_CURSOR_REF), create=io.createRef
  io.createRef=(ref,sha)=>ref===`${REVIEW_REPLACEMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-${first.sequence}`?false:create(ref,sha)
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence,failureCode:'wrapper_terminal_failure'},io),/created concurrently/)
  assert.equal(io.refs.get(REVIEW_CURSOR_REF),before)
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),first)
})

test('reviewer replacement rejects a mismatched original assignment',()=>{
  const io=failedReviewIo()
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:99},io),/does not match/)
})

// THE SAME-PROVIDER WRAPAROUND, NOW SKIPPED (#1297). replaceFailedReviewer starts at
// ACTIVE_REVIEWERS[(sequence-1) % N] but SKIPS any provider that already failed on
// this exact head, advancing the durable cursor past it. It used to REFUSE instead,
// which stranded a failed review with no replacement at all after N-1 assignments,
// for ANY N -- and after the #1290 roster change that was TWO intervening
// assignments, the natural rest point of a three-name parallel dispatch (Grok takes
// a PR and holds ai-grok-review's per-repo in-flight lock, GLM the next, Muse the
// third, cursor on a multiple of three).
//
// Roster length was never the fix. An earlier version of this test asserted
// `ACTIVE_REVIEWERS.length % 2 !== 0` as though odd length were; a review showed that
// is a false invariant, and it is deliberately not asserted here. Both halves are
// pinned below, with the exact successor named in each case.
test('one intervening assignment gives a failed reviewer a named replacement',()=>{
  assert.equal(ACTIVE_REVIEWERS.length,6,'this test describes the approved six-reviewer rotation')
  const io=failedReviewIo()
  assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io)
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(replacement.reviewer,'kimi-k3')
})

test('N-1 intervening assignments skip the failed provider instead of stranding the replacement',()=>{
  assert.equal(ACTIVE_REVIEWERS.length,6,'this test describes the approved six-reviewer rotation')
  const io=failedReviewIo()
  for(let n=0;n<ACTIVE_REVIEWERS.length-1;n+=1){
    assignNextReviewer({issue:20+n,pr:120+n,headSha:`abcde${n}f`},io)
  }
  // The cursor now sits on a multiple of the roster length, so the plain modulo would compute
  // back to grok-4.6 -- the provider that just failed. The selection skips it and
  // advances the durable cursor one extra step to the next active name.
  const cursorBefore=parseReviewCursor(io.getCommit(io.refs.get(REVIEW_CURSOR_REF)))
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(replacement.reviewer,'glm-5.3')
  assert.equal(replacement.sequence,cursorBefore.sequence+2)
  assert.equal(parseReviewCursor(io.getCommit(io.refs.get(REVIEW_CURSOR_REF))).sequence,replacement.sequence)
  // Governed guarantees survive the skip: the retry is byte-identical.
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),replacement)
})

test('a chained replacement skips TWO already-failed providers to reach the last name',()=>{
  const io=failedReviewIo()
  for(let n=0;n<ACTIVE_REVIEWERS.length-1;n+=1){
    assignNextReviewer({issue:30+n,pr:130+n,headSha:`abcdf${n}f`},io)
  }
  // grok-4.6 failed, then its replacement glm-5.3 fails too. The cursor is then
  // walked back to a roster boundary so the plain modulo computes to grok-4.6, and
  // selection must skip BOTH failed names (offset 2) to land on the next live one.
  const first=replaceFailedReviewer(replacementRequest,io)
  assert.equal(first.reviewer,'glm-5.3')
  let n=0
  while(parseReviewCursor(io.getCommit(io.refs.get(REVIEW_CURSOR_REF))).sequence%ACTIVE_REVIEWERS.length!==0){
    assignNextReviewer({issue:40+n,pr:140+n,headSha:`abcdf${n}9`},io);n+=1
  }
  const cursorBefore=parseReviewCursor(io.getCommit(io.refs.get(REVIEW_CURSOR_REF)))
  assert.equal(cursorBefore.sequence%ACTIVE_REVIEWERS.length,0,'the cursor must sit on a roster boundary for this to be a two-name skip')
  const second=replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence},io)
  assert.equal(second.reviewer,'kimi-k3')
  assert.equal(second.sequence,cursorBefore.sequence+3)
  assert.deepEqual(replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence},io),second)
})

test('replacement exhausts the active rotation, then refuses',()=>{
  const io=failedReviewIo()
  const seen=['grok-4.6']
  let failedSequence=replacementRequest.failedSequence
  for(let n=0;n<ACTIVE_REVIEWERS.length-1;n+=1){
    const step=replaceFailedReviewer({...replacementRequest,failedSequence},io)
    assert.ok(!seen.includes(step.reviewer),`${step.reviewer} was already spent on this head`)
    seen.push(step.reviewer);failedSequence=step.sequence
  }
  assert.deepEqual(seen,ACTIVE_REVIEWERS.map((r)=>r.name))
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence},io),/no other reviewer is available/)
})

test('reviewer replacement rejects a substantive exact-head verdict',()=>{
  const io=failedReviewIo();io.getPrReviews=()=>[{body:`REVISE ${failedReview.headSha}`,author_association:'OWNER'}]
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/existing verdict/)
  const stateIo=failedReviewIo();stateIo.getPrReviews=()=>[{body:'',commit_id:failedReview.headSha,state:'APPROVED',author_association:'OWNER'}]
  assert.throws(()=>replaceFailedReviewer(replacementRequest,stateIo),/existing verdict/)
})

test('reviewer replacement retry rejects mismatched failure sequence and missing evidence',()=>{
  const io=failedReviewIo(), done=replaceFailedReviewer(replacementRequest,io)
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:99},io),/does not match/)
  const failureRef=[...io.refs.keys()].find((ref)=>ref.startsWith('refs/db-review-failures/'));io.refs.delete(failureRef)
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/evidence is missing/)
  assert.ok(done.replacementSha)
})

test('reviewer replacement rejects unproved or nonterminal failures',()=>{
  const io=failedReviewIo()
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,confirmNoVerdict:false},io),/confirmation/)
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failureCode:'reviewer_disagreed'},io),/recognized terminal/)
})

test('partial reviewer replacement failure rolls back cursor and immutable evidence',()=>{
  const io=failedReviewIo(), assignment=io.refs.get(REVIEW_CURSOR_REF), originalCreate=io.createRef
  io.createRef=(ref,sha)=>ref.startsWith('refs/db-review-replacements/')?false:originalCreate(ref,sha)
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/created concurrently/)
  assert.equal(io.refs.get(REVIEW_CURSOR_REF),assignment)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-review-failures/')),false)
})

const opts={task:'#1',owner:'agent',branch:'codex/x',worktree:'C:/w',objects:['table core.x'],leaseHours:12,requestId:'r1',mutexAttempts:1}

test('GitHub create-if-absent mutex makes acquisition cross-host atomic', () => {
  const io=memoryIo()
  io.refs.set(MUTEX_REF,'other-host-owner')
  assert.throws(()=>acquireAuthorLane(opts,NOW,io),/occupied/)
  assert.equal(io.refs.get(MUTEX_REF),'other-host-owner')
})

test('fresh custom refs tolerate transient GitHub 404 reads without weakening ownership', () => {
  const io=memoryIo();let reads=0,waits=0
  io.readRef=(ref)=>ref===MUTEX_REF && ++reads<4 ? null : io.refs.get(ref)??null
  io.wait=()=>{waits++}
  const result=acquireAuthorLane(opts,NOW,io)
  assert.equal(result.version,'20260814170219')
  assert.equal(waits,3)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('post-write proof fails immediately when GitHub shows a different owner', () => {
  const io=memoryIo();let waits=0
  io.readRef=()=> 'different-owner';io.wait=()=>{waits++}
  assert.equal(readRefAfterWrite(MUTEX_REF,'ours',io), 'different-owner')
  assert.equal(waits,0)
})

test('serialized recovery tolerates transient 404 for its fresh recovery marker',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');let markerReads=0
  io.readRef=(ref)=>ref===MUTEX_RECOVERY_ACTIVE_REF && ++markerReads<3 ? null : io.refs.get(ref)??null
  io.wait=()=>{}
  const result=recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io)
  assert.equal(result.released,'4a69fbbc')
  assert.equal(io.refs.has(MUTEX_RECOVERY_ACTIVE_REF),false)
})

test('mutex is safely released when reservation or issue creation fails', () => {
  for (const failure of ['reserve','issue']) {
    const io=memoryIo()
    if(failure==='reserve')io.reserveVersion=()=>{throw new LaneError('boom')}
    else io.createClaim=()=>{throw new LaneError('boom')}
    assert.throws(()=>acquireAuthorLane(opts,NOW,io),/boom/)
    assert.equal(io.refs.has(MUTEX_REF),false)
  }
})

test('release refuses to delete a lock now owned by someone else', () => {
  const io=memoryIo();io.refs.set(EXCLUSIVE_REFS.preview,'new-owner')
  assert.throws(()=>releaseOwnedRef(EXCLUSIVE_REFS.preview,'old-owner',io),/another owner/)
  assert.equal(io.refs.get(EXCLUSIVE_REFS.preview),'new-owner')
})

test('preview and merge are fixed exclusive refs and merge refuses during production', () => {
  const io=memoryIo()
  io.openClaims=()=>[{number:1,body:body(['table core.x'],'1','2099-01-01T00:00:00Z')}]
  io.getPr=(number)=>({number:Number(number),head:{sha:'abc',ref:'codex/1'},base:{sha:'main'}})
  const first=acquireExclusive('preview',{owner:'a',pr:1,headSha:'abc'},io)
  assert.throws(()=>acquireExclusive('preview',{owner:'b',pr:2,headSha:'abc'},io),/occupied/)
  releaseOwnedRef(EXCLUSIVE_REFS.preview,first.ownerSha,io)
  io.refs.set(EXCLUSIVE_REFS.production,'production-owner')
  assert.throws(()=>acquireExclusive('merge',{owner:'a',pr:1,headSha:'abc'},io),/merges are frozen/)
  io.refs.delete(EXCLUSIVE_REFS.production);io.refs.set(EXCLUSIVE_REFS.merge,'merge-owner')
  assert.throws(()=>acquireExclusive('production',{owner:'p',headSha:'main'},io),/guarded merge is active/)
})

test('historical preview recovery shares the preview lock and requires current main plus merged source PR',()=>{
  const io=memoryIo()
  io.getPr=()=>({merged:true,merge_commit_sha:'merged'})
  const lock=acquireExclusive('preview-recovery',{owner:'recovery',pr:924,headSha:'main'},io)
  assert.equal(lock.ref,EXCLUSIVE_REFS.preview)
  releaseOwnedRef(EXCLUSIVE_REFS.preview,lock.ownerSha,io)
  assert.throws(()=>acquireExclusive('preview-recovery',{owner:'recovery',pr:924,headSha:'old'},io),/current main/)
  io.getPr=()=>({number:999,merged:false,state:'open',head:{sha:'pending'}})
  assert.throws(()=>acquireExclusive('preview-recovery',{owner:'recovery',pr:924,headSha:'main'},io),/already-merged/)
  io.getPr=()=>({number:1372,merged:false,state:'open',head:{sha:'exact-pending-head'}})
  const circular=acquireExclusive('preview-recovery',{owner:'recovery',pr:1372,headSha:'main'},io)
  assert.equal(circular.ref,EXCLUSIVE_REFS.preview)
  releaseOwnedRef(EXCLUSIVE_REFS.preview,circular.ownerSha,io)
  io.getPr=()=>({number:1495,merged:false,state:'open',head:{sha:'exact-1439-pending-head'}})
  const issue1439=acquireExclusive('preview-recovery',{owner:'recovery',pr:1495,headSha:'main'},io)
  assert.equal(issue1439.ref,EXCLUSIVE_REFS.preview)
  releaseOwnedRef(EXCLUSIVE_REFS.preview,issue1439.ownerSha,io)
  io.getPr=()=>({number:1660,merged:false,state:'open',head:{sha:'exact-1658-pending-head'}})
  const issue1658=acquireExclusive('preview-recovery',{owner:'recovery',pr:1660,headSha:'main'},io)
  assert.equal(issue1658.ref,EXCLUSIVE_REFS.preview)
  releaseOwnedRef(EXCLUSIVE_REFS.preview,issue1658.ownerSha,io)
  // A pending PR outside the exact allowlist is still refused.
  io.getPr=()=>({number:1661,merged:false,state:'open',head:{sha:'other-pending-head'}})
  assert.throws(()=>acquireExclusive('preview-recovery',{owner:'recovery',pr:1661,headSha:'main'},io),/already-merged/)
})

// ---------------------------------------------------------------------------
// POST-MERGE PREVIEW REHEARSAL (#1208)
// ---------------------------------------------------------------------------
function rehearsalIo(overrides = {}) {
  const io = memoryIo()
  io.compareUrls = []
  io.getPr = () => ({ merged: true, merge_commit_sha: 'merge-sha' })
  io.getPrFiles = () => [{ status: 'added', filename: 'supabase/migrations/20260818232639_coldlion.sql' }]
  io.compareCommits = (base, head) => { io.compareUrls.push(`compare/${base}...${head}`); return { status: 'identical', ahead_by: 0, behind_by: 0 } }
  return Object.assign(io, overrides)
}
const REHEARSAL = { owner: 'gha', pr: 1193, headSha: 'main', versions: ['20260818232639'] }

test('post-merge preview rehearsal shares the preview lock and is authorised by merge-commit ancestry', () => {
  const io = rehearsalIo()
  const lock = acquireExclusive('preview-rehearsal', REHEARSAL, io)
  assert.equal(lock.ref, EXCLUSIVE_REFS.preview)
  // MUTUAL EXCLUSION, unchanged: while a rehearsal holds preview, the ordinary
  // preview lane cannot be acquired, and vice versa.
  io.getPr = (number) => ({ number: Number(number), head: { sha: 'abc', ref: 'codex/1' }, base: { sha: 'main' } })
  io.openClaims = () => [{ number: 1, body: body(['table core.x'], '1', '2099-01-01T00:00:00Z') }]
  assert.throws(() => acquireExclusive('preview', { owner: 'b', pr: 2, headSha: 'abc' }, io), /occupied/)
  releaseOwnedRef(EXCLUSIVE_REFS.preview, lock.ownerSha, io)
})

test('post-merge preview rehearsal compares merge commit as BASE and main tip as HEAD', () => {
  // THE ARGUMENT-ORDER TEST. Inverting the compare call inverts the meaning of
  // `ahead` and would accept a descendant of main -- i.e. unmerged code.
  const io = rehearsalIo()
  const lock = acquireExclusive('preview-rehearsal', REHEARSAL, io)
  releaseOwnedRef(EXCLUSIVE_REFS.preview, lock.ownerSha, io)
  assert.deepEqual(io.compareUrls, ['compare/merge-sha...main'])
})

test('post-merge preview rehearsal fails closed on every missing authorisation', () => {
  const cases = [
    ['not merged', { getPr: () => ({ merged: false }) }, REHEARSAL, /is not merged/],
    ['no merge commit', { getPr: () => ({ merged: true }) }, REHEARSAL, /is not merged/],
    ['pull request unreadable', { getPr: () => null }, REHEARSAL, /cannot read pull request/],
    ['pull request read throws', { getPr: () => { throw new Error('HTTP 502') } }, REHEARSAL, /cannot read pull request .*HTTP 502/],
    ['main tip unreadable', { mainSha: () => null }, REHEARSAL, /cannot read the current main tip/],
    ['not the main tip', {}, { ...REHEARSAL, headSha: 'stale' }, /exact current main SHA/],
    ['merge commit behind main', { compareCommits: () => ({ status: 'ahead', ahead_by: 3, behind_by: 2 }) }, REHEARSAL, /not contained in the history of main tip/],
    ['merge commit diverged', { compareCommits: () => ({ status: 'diverged', ahead_by: 1, behind_by: 0 }) }, REHEARSAL, /not contained in the history of main tip/],
    ['merge commit is a descendant of main', { compareCommits: () => ({ status: 'behind', ahead_by: 0, behind_by: 0 }) }, REHEARSAL, /not contained in the history of main tip/],
    ['ancestry unreadable', { compareCommits: () => null }, REHEARSAL, /ancestry is unreadable/],
    ['ancestry read throws', { compareCommits: () => { throw new Error('HTTP 502') } }, REHEARSAL, /ancestry is unreadable .*HTTP 502/],
    ['no versions named', {}, { ...REHEARSAL, versions: [] }, /requires the exact migration versions/],
    ['malformed version', {}, { ...REHEARSAL, versions: ['nope'] }, /exact 14-digit migration version/],
    ['version not added by the PR', {}, { ...REHEARSAL, versions: ['20260818203751'] }, /were not added by pull request #1193/],
    ['version only modified by the PR', { getPrFiles: () => [{ status: 'modified', filename: 'supabase/migrations/20260818232639_coldlion.sql' }] }, REHEARSAL, /were not added by pull request #1193/],
    ['pull request files unreadable', { getPrFiles: () => null }, REHEARSAL, /files are unreadable/],
    ['pull request files read throws', { getPrFiles: () => { throw new Error('HTTP 502') } }, REHEARSAL, /cannot read the files of pull request .*HTTP 502/],
  ]
  for (const [label, overrides, metadata, expected] of cases) {
    const io = rehearsalIo(overrides)
    assert.throws(() => acquireExclusive('preview-rehearsal', metadata, io), expected, label)
    // FAIL CLOSED MEANS NO LOCK LEFT BEHIND, and no author mutex either.
    assert.equal(io.refs.has(EXCLUSIVE_REFS.preview), false, `${label} left the preview lock`)
    assert.equal(io.refs.has(MUTEX_REF), false, `${label} left the author mutex`)
  }
})

test('post-merge preview rehearsal accepts a merge commit that later commits sit on top of', () => {
  const io = rehearsalIo({ compareCommits: () => ({ status: 'ahead', ahead_by: 4, behind_by: 0 }) })
  const lock = acquireExclusive('preview-rehearsal', REHEARSAL, io)
  assert.equal(lock.kind, 'preview-rehearsal')
  releaseOwnedRef(EXCLUSIVE_REFS.preview, lock.ownerSha, io)
})

test('post-merge preview rehearsal never needs or reads a live author claim', () => {
  const io = rehearsalIo({ openClaims: () => { throw new Error('author claims must not be consulted') } })
  const lock = acquireExclusive('preview-rehearsal', REHEARSAL, io)
  releaseOwnedRef(EXCLUSIVE_REFS.preview, lock.ownerSha, io)
})

// Deliberately a SECOND import statement, placed here rather than appended to the
// import list at the top of the file: PR #1359 appends to that same line, and two
// appends to one line is a merge conflict for no benefit.
import { parseVersionPrMap } from './manage-migration-author-lanes.mjs'

// ---------------------------------------------------------------------------
// POST-MERGE REHEARSAL OF A BATCH AUTHORED BY SEVERAL PULL REQUESTS (#1350)
//
// AGENTS.md 6.5 requires certain ship sets to be applied as exactly ONE bounded
// event, and no single pull request authored the whole set. The map form makes
// that batch expressible WITHOUT weakening anything: every one of the four
// proofs still runs, per version rather than per batch.
// ---------------------------------------------------------------------------
const MULTI_PR_MERGES = { 408: 'merge-408', 1347: 'merge-1347' }
const MULTI_PR_ADDED = {
  408: [{ status: 'added', filename: 'supabase/migrations/20260802170000_plm_import.sql' }],
  1347: [{ status: 'added', filename: 'supabase/migrations/20260820183334_fr_erasure.sql' }],
}
function multiPrIo(overrides = {}) {
  const io = rehearsalIo()
  io.getPr = (number) => {
    const sha = MULTI_PR_MERGES[Number(number)]
    return sha ? { merged: true, merge_commit_sha: sha } : null
  }
  io.getPrFiles = (number) => MULTI_PR_ADDED[Number(number)] ?? []
  return Object.assign(io, overrides)
}
const MULTI_PR_REHEARSAL = {
  owner: 'gha', pr: 1347, headSha: 'main',
  versions: ['20260802170000', '20260820183334'],
  versionPrMap: '20260802170000:408,20260820183334:1347',
}

test('post-merge preview rehearsal accepts a bounded batch authored by several merged PRs', () => {
  const io = multiPrIo()
  const lock = acquireExclusive('preview-rehearsal', MULTI_PR_REHEARSAL, io)
  assert.equal(lock.kind, 'preview-rehearsal')
  assert.equal(lock.ref, EXCLUSIVE_REFS.preview)
  // EVERY member's merge commit was compared against the main tip, base first.
  // One ancestry proof per authoring pull request, not one for the batch.
  assert.deepEqual(io.compareUrls, ['compare/merge-408...main', 'compare/merge-1347...main'])
  releaseOwnedRef(EXCLUSIVE_REFS.preview, lock.ownerSha, io)
})

test('post-merge preview rehearsal map fails closed on every per-version proof', () => {
  const cases = [
    ['version missing from the map', {}, { ...MULTI_PR_REHEARSAL, versionPrMap: '20260820183334:1347' }, /does not name every allowlisted version: 20260802170000/],
    ['stray map entry outside the allowlist', {}, { ...MULTI_PR_REHEARSAL, versionPrMap: '20260802170000:408,20260820183334:1347,20260101000000:99' }, /not in the allowlist: 20260101000000/],
    ['map entry for an unmerged PR', { getPr: (n) => (Number(n) === 408 ? { merged: false } : { merged: true, merge_commit_sha: 'merge-1347' }) }, MULTI_PR_REHEARSAL, /#408 is not merged/],
    ['map entry with no merge commit', { getPr: (n) => (Number(n) === 408 ? { merged: true } : { merged: true, merge_commit_sha: 'merge-1347' }) }, MULTI_PR_REHEARSAL, /#408 is not merged/],
    ['map merge commit is not an ancestor of main', { compareCommits: (base) => (base === 'merge-408' ? { status: 'diverged', ahead_by: 1, behind_by: 4 } : { status: 'identical', ahead_by: 0, behind_by: 0 }) }, MULTI_PR_REHEARSAL, /merge commit merge-408 is not contained in the history of main tip/],
    ['map PR did not add the version it is named for', { getPrFiles: (n) => (Number(n) === 408 ? [{ status: 'modified', filename: 'supabase/migrations/20260802170000_plm_import.sql' }] : MULTI_PR_ADDED[Number(n)]) }, MULTI_PR_REHEARSAL, /version 20260802170000 was not added by pull request #408/],
    ['map PR unreadable', { getPr: (n) => (Number(n) === 408 ? null : { merged: true, merge_commit_sha: 'merge-1347' }) }, MULTI_PR_REHEARSAL, /cannot read pull request #408/],
    ['lock PR is not a member of the batch', {}, { ...MULTI_PR_REHEARSAL, pr: 9999 }, /lock PR #9999 is not one of the pull requests in the version-to-PR map/],
    ['malformed map entry', {}, { ...MULTI_PR_REHEARSAL, versionPrMap: '20260802170000-408' }, /must be version:pull-request/],
    ['duplicate version in the map', {}, { ...MULTI_PR_REHEARSAL, versionPrMap: '20260802170000:408,20260802170000:1347' }, /names 20260802170000 more than once/],
    ['map cannot rescue an empty allowlist', {}, { ...MULTI_PR_REHEARSAL, versions: [] }, /requires the exact migration versions/],
    ['map cannot rescue a malformed version', {}, { ...MULTI_PR_REHEARSAL, versions: ['nope'], versionPrMap: 'nope:408' }, /exact 14-digit migration version/],
    ['map cannot rescue a stale main tip', {}, { ...MULTI_PR_REHEARSAL, headSha: 'stale' }, /exact current main SHA/],
  ]
  for (const [label, overrides, metadata, expected] of cases) {
    const io = multiPrIo(overrides)
    assert.throws(() => acquireExclusive('preview-rehearsal', metadata, io), expected, label)
    assert.equal(io.refs.has(EXCLUSIVE_REFS.preview), false, `${label} left the preview lock`)
    assert.equal(io.refs.has(MUTEX_REF), false, `${label} left the author mutex`)
  }
})

test('the single-PR rehearsal form is untouched by the map form', () => {
  // The common case must keep behaving exactly as before: no map, one PR, and
  // the batch-wide "not added by pull request #N" refusal still fires.
  const io = rehearsalIo()
  const lock = acquireExclusive('preview-rehearsal', REHEARSAL, io)
  releaseOwnedRef(EXCLUSIVE_REFS.preview, lock.ownerSha, io)
  const missing = rehearsalIo()
  assert.throws(() => acquireExclusive('preview-rehearsal', { ...REHEARSAL, versions: ['20260818203751'] }, missing), /were not added by pull request #1193/)
  // A map that is PRESENT but empty refuses; it never falls back silently.
  const blank = rehearsalIo()
  assert.throws(() => acquireExclusive('preview-rehearsal', { ...REHEARSAL, versionPrMap: '   ' }, blank), /version-to-PR map is empty/)
  assert.equal(blank.refs.has(EXCLUSIVE_REFS.preview), false)
})

test('parseVersionPrMap covers the allowlist exactly in both directions', () => {
  assert.deepEqual([...parseVersionPrMap('20260802170000:408,20260820183334:1347', ['20260802170000', '20260820183334'])],
    [['20260802170000', 408], ['20260820183334', 1347]])
  assert.throws(() => parseVersionPrMap('', ['20260802170000']), /is empty/)
  assert.throws(() => parseVersionPrMap('20260802170000:0', ['20260802170000']), /non-positive pull request/)
})

test('added migration versions ignore anything the pull request did not add', () => {
  assert.deepEqual(addedMigrationVersions([
    { status: 'added', filename: 'supabase/migrations/20260818232639_a.sql' },
    { status: 'modified', filename: 'supabase/migrations/20260818203751_b.sql' },
    { status: 'added', filename: 'docs/notes.md' },
    { status: 'renamed', filename: 'supabase/migrations/20260101000000_c.sql' },
  ]), ['20260818232639'])
  assert.throws(() => addedMigrationVersions(undefined), /unreadable/)
})

// EVERY OPERAND OF THE READABILITY GUARD, SEPARATELY (#1213 round 9, the
// author's own per-condition hunt). The guard is
// `!comparison || typeof comparison.status !== 'string' || !Number.isInteger(comparison.behind_by)`.
// A falsy comparison and a missing behind_by each had a case; the middle operand
// -- a comparison carrying a valid integer behind_by but a status that is not a
// string -- had none, so it could be deleted with the whole suite green. It is
// the operand that stops a JSON `null`, a number, or an object status from
// reaching the membership test below, where `['identical','ahead'].includes(...)`
// would quietly answer false and produce the WRONG refusal message.
test('merge-commit ancestry helper refuses every unreadable comparison shape', () => {
  for (const comparison of [
    null,
    undefined,
    { status: 'ahead' },                      // behind_by missing
    { status: 'ahead', behind_by: '0' },      // behind_by a string
    { status: 'ahead', behind_by: 1.5 },      // behind_by not an integer
    { status: null, behind_by: 0 },           // status not a string
    { status: 0, behind_by: 0 },
    { status: ['ahead'], behind_by: 0 },
    { behind_by: 0 },                         // status missing entirely
  ]) {
    assert.throws(
      () => assertMergeCommitInMainHistory('m', 'main', { compareCommits: () => comparison }),
      /unreadable/,
      `expected an unreadable-comparison refusal for ${JSON.stringify(comparison)}`,
    )
  }
  // The honest shape gets PAST this guard, or every case above is vacuous.
  assert.doesNotThrow(() => assertMergeCommitInMainHistory(
    'm', 'main', { compareCommits: () => ({ status: 'identical', behind_by: 0 }) }))
})

test('unreadable claims fail closed',()=>assert.throws(()=>assertLaneAvailable([{number:9,body:'bad'}],[],NOW),/unreadable/))

test('claim objects require known kinds and exact qualified identifiers',()=>{
  assert.deepEqual(validateClaimObjects(['TABLE Core.X']),['table core.x'])
  assert.deepEqual(validateClaimObjects(['column Core.X.Code']),['column core.x.code','table core.x'])
  for(const bad of [['core.x'],['table *'],['table x'],['mystery core.x'],['trigger t']])assert.throws(()=>validateClaimObjects(bad),/claim|kind/)
})

test('explicit claim release is mutex-protected, owner-confirmed, and refuses an open PR',()=>{
  const io=memoryIo();let closed=null
  io.openClaims=()=>[{number:7,body:body(['table core.x'],'7')}]
  io.closeClaim=(n)=>{closed=n}
  assert.equal(main(['--release-claim','7','--owner','agent-7','--confirm-finished'],NOW,io),0)
  assert.equal(closed,7);assert.equal(io.refs.has(MUTEX_REF),false)
  closed=null;io.openPulls=()=>[{head:{ref:'codex/7'}}]
  assert.equal(main(['--release-claim','7','--owner','agent-7','--confirm-finished'],NOW,io),2)
  assert.equal(closed,null)
})

test('audit reports every malformed claim and exits 2 without becoming unusable',()=>{
  const io=memoryIo();io.openClaims=()=>[{number:1,body:'bad'},{number:2,body:'also bad'}]
  assert.equal(main(['--audit'],NOW,io),2)
})

function raceWorkers(objects){
  const store=mkdtempSync(path.join(tmpdir(),'db-lane-race-'))
  const worker=fileURLToPath(new URL('./test-fixtures/migration-lane-race-worker.mjs',import.meta.url))
  const runs=objects.map((object,index)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[worker,store,String(index+1),object],{windowsHide:true})
    let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x)
    child.on('error',reject);child.on('close',code=>{
      let json
      try{json=JSON.parse(out)}catch(error){return reject(new Error(`race worker ${index+1} returned invalid JSON (${error.message}); stderr=${err.trim()||'<empty>'}; stdout=${out.trim()||'<empty>'}`))}
      if(![0,2].includes(code))return reject(new Error(`race worker ${index+1} exited ${code}; stderr=${err.trim()||'<empty>'}; stdout=${out.trim()||'<empty>'}`))
      resolve({code,json,err})
    })
  }))
  return Promise.all(runs).finally(()=>rmSync(store,{recursive:true,force:true}))
}

test('REAL PROCESS RACE: two independent CLIs claiming one object produce exactly one winner',async()=>{
  const results=await raceWorkers(['table core.same','table core.same'])
  assert.equal(results.filter(x=>x.json.ok).length,1)
  assert.equal(results.filter(x=>!x.json.ok&&/collision/.test(x.json.error)).length,1)
})

test('REAL PROCESS RACE: cap+1 independent CLIs claiming unrelated objects admit exactly the cap',async()=>{
  const objects=Array.from({length:MAX_AUTHOR_LANES+1},(_,i)=>`table core.r${i}`)
  const results=await raceWorkers(objects)
  assert.equal(results.filter(x=>x.json.ok).length,MAX_AUTHOR_LANES)
  assert.equal(results.filter(x=>!x.json.ok&&new RegExp(`all ${MAX_AUTHOR_LANES}`).test(x.json.error)).length,1)
})

test('GitHub 403 and rate-limit failures refuse acquisition without creating a claim',()=>{
  for(const message of ['HTTP 403 forbidden','API rate limit exceeded']){
    const io=memoryIo();let created=false;io.createRef=()=>{throw new LaneError(message)};io.createClaim=()=>{created=true}
    assert.throws(()=>acquireAuthorLane(opts,NOW,io),new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
    assert.equal(created,false)
  }
})

test('ambiguous GitHub delete failure fails closed and never retries or deletes a replacement',()=>{
  const io=memoryIo();io.refs.set(EXCLUSIVE_REFS.preview,'owner');let deletes=0
  io.deleteRef=()=>{deletes++;throw new LaneError('connection dropped after DELETE')}
  assert.throws(()=>releaseOwnedRef(EXCLUSIVE_REFS.preview,'owner',io),/connection dropped/)
  assert.equal(deletes,1);assert.equal(io.refs.get(EXCLUSIVE_REFS.preview),'owner')
})

test('release accepts a replacement owner that acquired immediately after the delete',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'ours');let deletes=0
  io.deleteRef=()=>{deletes++;io.refs.set(MUTEX_REF,'next-owner')}
  assert.equal(releaseOwnedRef(MUTEX_REF,'ours',io),true)
  assert.equal(deletes,1);assert.equal(io.refs.get(MUTEX_REF),'next-owner')
})

test('101 claims and 101 open PR sources are all considered',()=>{
  const claims=Array.from({length:101},(_,i)=>({number:i+1,body:body([`table core.c${i}`],String(i+1))}))
  const state=assertLaneAvailable(claims,[],NOW,{ignoreCapacity:true});assert.equal(state.active.length,101)
  const prs=Array.from({length:101},(_,i)=>({label:`PR #${i+1}`,objects:[`table core.p${i}`]}))
  assert.throws(()=>assertLaneAvailable([],['table core.p100'],NOW,{prSources:prs}),/PR #101/)
})

test('release tolerates one stale post-delete GitHub read',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'ours');let reads=0,waits=0
  io.deleteRef=()=>io.refs.delete(MUTEX_REF)
  io.readRef=()=>++reads===2?'ours':io.refs.get(MUTEX_REF)??null
  io.wait=()=>{waits++}
  assert.equal(releaseOwnedRef(MUTEX_REF,'ours',io),true)
  assert.equal(waits,1)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('release tolerates bounded stale owner reads until exact absence is visible',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'ours');let postDeleteReads=0,deleted=false,waited=0
  io.deleteRef=()=>{deleted=true}
  io.readRef=(ref)=>deleted&&ref===MUTEX_REF?(++postDeleteReads<5?'ours':null):io.refs.get(ref)??null
  io.wait=(ms)=>{waited+=ms}
  assert.equal(releaseOwnedRef(MUTEX_REF,'ours',io),true)
  assert.equal(postDeleteReads,5);assert.equal(waited,3250)
})

test('release fails closed on ambiguous transport readback without retrying delete',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'ours');let deletes=0,reads=0
  io.deleteRef=()=>{deletes++}
  io.readRef=()=>{if(++reads===1)return 'ours';throw new LaneError('transport endpoint not found')}
  assert.throws(()=>releaseOwnedRef(MUTEX_REF,'ours',io),/transport endpoint not found/)
  assert.equal(deletes,1)
})

test('only an explicit GitHub HTTP 404 is confirmed ref absence',()=>{
  assert.equal(isConfirmedRefAbsence(new Error('gh: Not Found (HTTP 404)')),true)
  assert.equal(isConfirmedRefAbsence(new Error('transport endpoint not found')),false)
  assert.equal(isConfirmedRefAbsence(new Error('HTTP 502 upstream failure')),false)
})

test('release never deletes a changed owner during bounded readback',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'ours');let deleted=false,deletes=0
  io.deleteRef=()=>{deleted=true;deletes++}
  io.readRef=()=>deleted?'successor':'ours'
  assert.equal(releaseOwnedRef(MUTEX_REF,'ours',io),true)
  assert.equal(deletes,1)
})

test('stranded author mutex recovery requires exact SHA, lock type, age, and explicit confirmation',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc')
  const recover=(values={})=>recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0,...values},io)
  assert.throws(()=>recover({expectedSha:'deadbeef'}),/not expected/)
  assert.throws(()=>recover({confirmStale:false}),/requires/)
  assert.throws(()=>recover({serializedRecovery:false}),/serialized recovery workflow/)
  io.getCommit=()=>({message:'unrelated commit',committer:{date:'2026-08-14T19:55:00Z'}})
  assert.throws(()=>recover(),/not a recognized/)
  io.getCommit=()=>({message:'db-coordination author-acquisition request-1',committer:{date:'2026-08-14T19:59:30Z'}})
  assert.throws(()=>recover(),/only 30 seconds/)
  io.getCommit=()=>({message:'db-coordination author-acquisition request-1',committer:{date:'2026-08-14T19:55:00Z'}})
  assert.equal(recover().released,'4a69fbbc')
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('author acquisition proves mutex ownership before each GitHub mutation',()=>{
  const io=memoryIo();let reserved=false,created=false
  io.openClaims=()=>{io.refs.set(MUTEX_REF,'stolen');return []}
  io.reserveVersion=()=>{reserved=true;return {version:'20260814170219'}}
  io.createClaim=()=>{created=true}
  assert.throws(()=>acquireAuthorLane(opts,NOW,io),/lost ownership/)
  assert.equal(reserved,false);assert.equal(created,false)
})

test('requireOwnedRef fails closed when a stranded lock was replaced',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'new-owner')
  assert.throws(()=>requireOwnedRef(MUTEX_REF,'old-owner',io),/lost ownership/)
})
test('stale process that resumes after claim creation closes its own claim and returns no lane',()=>{
  const io=memoryIo();let closed=null
  io.createClaim=()=>{io.refs.set(MUTEX_REF,'successor');return 'https://github.test/issues/77'}
  io.closeClaim=(number)=>{closed=String(number)}
  assert.throws(()=>acquireAuthorLane(opts,NOW,io),/lost ownership/)
  assert.equal(closed,'77');assert.equal(io.refs.get(MUTEX_REF),'successor')
})
test('active serialized recovery fences every new author acquisition',()=>{
  const io=memoryIo();io.refs.set(MUTEX_RECOVERY_ACTIVE_REF,'4a69fbbc')
  assert.throws(()=>acquireAuthorLane(opts,NOW,io),/recovery is active/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})
test('serialized recovery resumes its own stranded active marker and cleans it',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.refs.set(MUTEX_RECOVERY_ACTIVE_REF,'4a69fbbc')
  const result=recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io)
  assert.equal(result.released,'4a69fbbc');assert.equal(io.refs.has(MUTEX_REF),false);assert.equal(io.refs.has(MUTEX_RECOVERY_ACTIVE_REF),false)
})
test('REAL CLI: a relative script path executes main and refuses an invalid argument', () => {
  const result = spawnSync(process.execPath, ['scripts/manage-migration-author-lanes.mjs', '--definitely-invalid'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown argument/)
})
test('forged caller-written production risk JSON has no CLI authorization path', () => {
  const result = spawnSync(process.execPath, ['scripts/manage-migration-author-lanes.mjs', '--production-risk-gate', 'forged.json'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown argument: --production-risk-gate/)
})
test('manual verdict recording has no CLI authorization path', () => {
  const result = spawnSync(process.execPath, ['scripts/manage-migration-author-lanes.mjs', '--record-review-verdict'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown argument: --record-review-verdict/)
})
test('stranded atomic split-recovery mutex is recognized and safely recoverable',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:'db-coordination claim-split-recovery request-2',committer:{date:'2026-08-14T19:55:00Z'}})
  const result=recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io)
  assert.equal(result.released,'4a69fbbc');assert.equal(io.refs.has(MUTEX_REF),false)
})
test('stranded reviewer assignment and replacement mutexes are recoverable',()=>{
  for(const kind of ['reviewer-assignment-lock','reviewer-replacement-lock']){
    const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:`db-coordination ${kind} issue=1 pr=2 head=abcdef0`,committer:{date:'2026-08-14T19:55:00Z'}})
    assert.equal(recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io).released,'4a69fbbc')
  }
})
test('stranded claim lease renewal mutex is recognized and safely recoverable',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:'db-coordination claim-lease-renewal renew-853',committer:{date:'2026-08-14T19:55:00Z'}})
  const result=recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io)
  assert.equal(result.released,'4a69fbbc');assert.equal(io.refs.has(MUTEX_REF),false)
})

function splitIo(overrides={}) {
  const io=memoryIo(), original=['table plm.style_tracker_item_bridge'], combined=[...original,'index plm.item_upper_trim_item_number_idx']
  const issues=new Map([[1058,{number:1058,state:'closed',title:'CLAIM: #853/#868 bridge',body:claimBody({version:'20260816045130',objects:original,owner:'session',branch:'codex/source',worktree:'C:/source',expiresAt:new Date('2026-08-17T00:00:00Z')})}],[1063,{number:1063,state:'open',title:'CLAIM: #853/#868 bridge plus index',body:claimBody({version:'20260816063532',objects:combined,owner:'session',branch:'codex/source',worktree:'C:/source',expiresAt:new Date('2026-08-17T00:00:00Z')})}]])
  io.refs.set('refs/db-claims/20260816045130','reserved-a');io.refs.set('refs/db-claims/20260816063532','reserved-b')
  io.getIssue=(n)=>structuredClone(issues.get(Number(n)))
  io.getIssueComments=()=>[{body:'Expired migration-author lease closed by guarded cleanup. Its migration version remains unavailable.'}]
  io.updateIssue=(n,fields)=>{Object.assign(issues.get(Number(n)),fields);return io.getIssue(n)}
  io.getPr=(n)=>Number(n)===1060?{state:'open',head:{ref:'codex/source'}}:{state:'open',head:{ref:'codex/target'}}
  io.getPrFiles=(n)=>[{filename:`supabase/migrations/${Number(n)===1060?'20260816045130_a':'20260816063532_b'}.sql`}]
  io.openClaims=()=>[io.getIssue(1063)]
  io.prSources=()=>[{label:'PR #1060 "source"',objects:['table plm.style_tracker_item_bridge']},{label:'PR #1064 [DRAFT] "target"',objects:['index plm.item_upper_trim_item_number_idx']}]
  return Object.assign(io,{issues},overrides)
}
const splitOptions={releasedClaim:1058,activeClaim:1063,sourcePr:1060,targetPr:1064,targetBranch:'codex/target',targetWorktree:'C:/target',requestId:'split',mutexAttempts:1}

test('same-owner split recovery atomically restores original and rebinds remainder claim',()=>{
  const io=splitIo(),result=recoverSameOwnerSplit(splitOptions,NOW,io)
  assert.deepEqual(result.versions,['20260816045130','20260816063532']);assert.equal(io.getIssue(1058).state,'open');assert.match(io.getIssue(1063).body,/branch: codex\/target/)
})
test('same-owner split recovery rejects mismatched owner, workstream, subset, and remainder',()=>{
  for(const mutate of [(io)=>io.issues.get(1063).title='CLAIM: #999 other',(io)=>io.issues.get(1063).body=io.issues.get(1063).body.replace('owner: session','owner: intruder'),(io)=>io.issues.get(1058).body=io.issues.get(1058).body.replace('table plm.style_tracker_item_bridge','table core.other'),(io)=>io.issues.get(1063).body=io.issues.get(1063).body.replace('index plm.item_upper_trim_item_number_idx','index plm.wrong')]){const io=splitIo();mutate(io);assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io));assert.equal(io.getIssue(1058).state,'closed')}
})
test('same-owner split recovery rejects pull-request mismatch and third-party collision',()=>{
  let io=splitIo({getPrFiles:()=>[{filename:'supabase/migrations/20260816000000_wrong.sql'}]});assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/pull request/)
  io=splitIo();io.openClaims=()=>[io.getIssue(1063),{number:77,body:claimBody({version:'20260816070000',objects:['table plm.style_tracker_item_bridge'],owner:'other',branch:'other',worktree:'C:/other',expiresAt:new Date('2026-08-17T00:00:00Z')})}];assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/collision/)
  io=splitIo();io.prSources=()=>[{label:'PR #999',objects:['table plm.style_tracker_item_bridge']}];assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/PR #999/)
})
test('same-owner split recovery is pinned and rejects removed files, duplicate versions, and bad close reason',()=>{
  let io=splitIo();assert.throws(()=>recoverSameOwnerSplit({...splitOptions,releasedClaim:999},NOW,io),/pinned/)
  io=splitIo({getPrFiles:()=>[{status:'removed',filename:'supabase/migrations/20260816045130_a.sql'}]});assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/removes/)
  io=splitIo();io.issues.get(1063).body=io.issues.get(1063).body.replace('20260816063532','20260816045130');assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/different permanent versions/)
  io=splitIo({getIssueComments:()=>[{body:'manual close'}]});assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/guarded-release reason/)
  io=splitIo();io.issues.get(1058).body=io.issues.get(1058).body.replace('2026-08-17T00:00:00.000Z','2026-08-14T19:00:00.000Z');assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/unexpired/)
  io=splitIo({getPr:()=>({state:'open',head:{ref:'codex/source'}})});assert.throws(()=>recoverSameOwnerSplit({...splitOptions,targetBranch:'codex/source'},NOW,io),/different pull-request branches/)
  io=splitIo();io.prSources=()=>[{label:'PR #999 "duplicate version"',objects:['table core.unrelated'],versions:['20260816045130']}];assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/version collision/)
})
test('same-owner split recovery allows unrelated removed files while retaining migration proof',()=>{
  const io=splitIo({getPrFiles:(n)=>[
    {status:'removed',filename:'scripts/obsolete-contract.test.mjs'},
    {status:'renamed',filename:`supabase/migrations/${Number(n)===1060?'20260816045130_a':'20260816063532_b'}.sql`},
  ]})
  const result=recoverSameOwnerSplit(splitOptions,NOW,io)
  assert.deepEqual(result.versions,['20260816045130','20260816063532'])
})
test('same-owner split recovery refuses rollback mutations after mutex ownership loss',()=>{
  const io=splitIo();const update=io.updateIssue;let updates=0;io.updateIssue=(n,fields)=>{updates++;const result=update(n,fields);if(updates===1)io.refs.set(MUTEX_REF,'successor');return result}
  assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/ROLLBACK NOT ATTEMPTED/);assert.equal(updates,1)
})
test('same-owner split recovery rolls both issue mutations back after partial readback failure',()=>{
  const io=splitIo();let activeReservationReads=0;const read=io.readRef,get=io.getIssue;io.readRef=(ref)=>ref==='refs/db-claims/20260816063532'&&++activeReservationReads===2?null:read(ref)
  assert.throws(()=>recoverSameOwnerSplit(splitOptions,NOW,io),/reservation disappeared/);assert.equal(get(1058).state,'closed');assert.match(get(1063).body,/branch: codex\/source/)
})

function expansionIo(overrides={}){
  const io=memoryIo(),issue={number:1063,state:'open',title:'CLAIM: #853 index',body:claimBody({version:'20260816063532',objects:['index plm.item_upper_trim_item_number_idx'],owner:'codex-issue-853-orderlist',branch:'codex/issue-853-orderlist-index',worktree:'C:\\repos\\shared-db-wt-853-index',expiresAt:new Date('2026-08-17T00:00:00Z')})}
  const workIssue={number:853,state:'open',body:'```db-work-scope\nstatus: ready\nwork_type: structural\nroute: shared-db-orchestrator\npriority: 1\ndepends_on:\nobjects:\n  - table plm.item\n```'}
  io.refs.set('refs/db-claims/20260816063532','reserved');io.getIssue=(n)=>structuredClone(Number(n)===853?workIssue:issue);io.updateIssue=(_n,fields)=>{Object.assign(issue,fields);return structuredClone(issue)}
  io.getPr=()=>({state:'open',head:{sha:'a'.repeat(40),ref:'codex/issue-853-orderlist-index'}});io.getPrFiles=()=>[{status:'added',filename:'supabase/migrations/20260816063532_index.sql'}];io.openClaims=()=>[structuredClone(issue)]
  io.prSources=()=>[{label:'PR #1065 [DRAFT] "index"',objects:['index plm.item_upper_trim_item_number_idx','table plm.item'],versions:['20260816063532']}]
  return Object.assign(io,{issue},overrides)
}
const expansionOptions={issue:853,claim:1063,pr:1065,owner:'codex-issue-853-orderlist',headSha:'a'.repeat(40),branch:'codex/issue-853-orderlist-index',worktree:'C:\\repos\\shared-db-wt-853-index',requestId:'expand',mutexAttempts:1}
test('active claim expansion adds exactly the parser-proven uncovered object',()=>{
  const io=expansionIo(),result=expandActiveClaimFromPr(expansionOptions,NOW,io);assert.deepEqual(result.added,['table plm.item']);assert.deepEqual(parseAuthorLease(io.issue.body,NOW).objects,['index plm.item_upper_trim_item_number_idx','table plm.item'])
})
test('active claim expansion adds every parser-proven object and rejects collisions, stale lease, and changed binding',()=>{
  let io=expansionIo();io.prSources=()=>[{label:'PR #1065 "x"',objects:['index plm.item_upper_trim_item_number_idx','table plm.item','table plm.extra'],versions:['20260816063532']}];assert.deepEqual(expandActiveClaimFromPr(expansionOptions,NOW,io).added,['table plm.item','table plm.extra'])
  io=expansionIo();io.openClaims=()=>[io.getIssue(1063),{number:9,body:claimBody({version:'20260816070000',objects:['table plm.item'],owner:'other',branch:'other',worktree:'C:/other',expiresAt:new Date('2026-08-17T00:00:00Z')})}];assert.throws(()=>expandActiveClaimFromPr(expansionOptions,NOW,io),/collision/)
  io=expansionIo();io.issue.body=io.issue.body.replace('2026-08-17T00:00:00.000Z','2026-08-14T19:00:00.000Z');assert.throws(()=>expandActiveClaimFromPr(expansionOptions,NOW,io),/expired/)
  io=expansionIo();assert.throws(()=>expandActiveClaimFromPr({...expansionOptions,headSha:'b'.repeat(40)},NOW,io),/head or branch changed/)
  io=expansionIo();assert.throws(()=>expandActiveClaimFromPr({...expansionOptions,issue:999},NOW,io),/exact issue/)
})
test('active claim expansion rolls back an ambiguous update failure while mutex-owned',()=>{
  const io=expansionIo(),before=io.issue.body;io.updateIssue=(_n,fields)=>{Object.assign(io.issue,fields);if(fields.body!==before)throw new LaneError('connection lost');return io.getIssue()}
  assert.throws(()=>expandActiveClaimFromPr(expansionOptions,NOW,io),/connection lost/);assert.equal(io.issue.body,before)
})
test('REAL main command wires exact issue and claim into generalized expansion',()=>{
  const io=expansionIo(),args=['--expand-active-claim-from-pr','--issue','853','--claim-number','1063','--pr','1065','--owner','codex-issue-853-orderlist','--head-sha','a'.repeat(40),'--branch','codex/issue-853-orderlist-index','--worktree','C:\\repos\\shared-db-wt-853-index']
  assert.equal(main(args,NOW,io),0);assert.ok(parseAuthorLease(io.issue.body,NOW).objects.includes('table plm.item'))
})

test('issue-scope expansion adds only exact ready structural issue objects before authoring',()=>{
  const io=expansionIo(),baseGet=io.getIssue;io.prSources=()=>[]
  io.getIssue=(n)=>{const row=baseGet(n);if(Number(n)===853)row.body=row.body.replace('  - table plm.item','  - table plm.item\n  - table plm.extra');return row}
  const result=expandActiveClaimFromIssue(expansionOptions,NOW,io)
  assert.deepEqual(result.added,['table plm.item','table plm.extra'])
  assert.deepEqual(parseAuthorLease(io.issue.body,NOW).objects.sort(),['index plm.item_upper_trim_item_number_idx','table plm.extra','table plm.item'])
})

test('issue-scope expansion rejects wrong routing, collisions, and ambiguous updates',()=>{
  let io=expansionIo(),baseGet=io.getIssue
  io.getIssue=(n)=>{const row=baseGet(n);if(Number(n)===853)row.body=row.body.replace('status: ready','status: blocked');return row}
  assert.throws(()=>expandActiveClaimFromIssue(expansionOptions,NOW,io),/not open ready structural/)
  io=expansionIo();io.openClaims=()=>[io.getIssue(1063),{number:9,body:claimBody({version:'20260816070000',objects:['table plm.item'],owner:'other',branch:'other',worktree:'C:/other',expiresAt:new Date('2026-08-17T00:00:00Z')})}]
  assert.throws(()=>expandActiveClaimFromIssue(expansionOptions,NOW,io),/collision/)
  io=expansionIo();io.prSources=()=>[];const before=io.issue.body;io.updateIssue=(_n,fields)=>{Object.assign(io.issue,fields);if(fields.body!==before)throw new LaneError('connection lost');return io.getIssue(1063)}
  assert.throws(()=>expandActiveClaimFromIssue(expansionOptions,NOW,io),/connection lost/);assert.equal(io.issue.body,before)
})

test('REAL main command expands an active claim from exact issue scope',()=>{
  const io=expansionIo();io.prSources=()=>[];const args=['--expand-active-claim-from-issue','--issue','853','--claim-number','1063','--owner','codex-issue-853-orderlist','--branch','codex/issue-853-orderlist-index','--worktree','C:\\repos\\shared-db-wt-853-index']
  assert.equal(main(args,NOW,io),0);assert.ok(parseAuthorLease(io.issue.body,NOW).objects.includes('table plm.item'))
})

function renewalIo(overrides={}){
  const io=memoryIo(),version='20260816045130',head='a'.repeat(40),objects=['table plm.style_tracker_item_bridge']
  const issue={number:1058,state:'open',title:'CLAIM: #853 OrderList bridge',body:claimBody({version,objects,owner:'codex-issue-853-orderlist',branch:'codex/issue-853-orderlist',worktree:'C:\\repos\\shared-db-worktrees\\issue-853-orderlist',expiresAt:new Date('2026-08-14T19:00:00Z')})}
  io.refs.set(`refs/db-claims/${version}`,'permanent')
  const workIssue={number:853,state:'open',body:scope('ready','structural','shared-db-orchestrator',900,objects)}
  io.openClaims=()=>[structuredClone(issue)];io.getIssue=(number)=>Number(number)===853?structuredClone(workIssue):Number(number)===1058?structuredClone(issue):null;io.updateIssue=(_n,fields)=>{Object.assign(issue,fields);return structuredClone(issue)}
  io.getPr=()=>({state:'open',head:{sha:head,ref:'codex/issue-853-orderlist'}})
  io.getPrFiles=()=>[{status:'added',filename:`supabase/migrations/${version}_orderlist.sql`}]
  io.prSources=()=>[{label:'PR #1060 "#853 OrderList"',objects:[...objects],versions:[version]}]
  return Object.assign(io,{issue,workIssue,version,head,objects},overrides)
}
const renewalOptions={claim:1058,issue:853,owner:'codex-issue-853-orderlist',branch:'codex/issue-853-orderlist',worktree:'C:\\repos\\shared-db-worktrees\\issue-853-orderlist',pr:1060,headSha:'a'.repeat(40),leaseHours:12,requestId:'renew-853',mutexAttempts:1}

test('#853-shaped expired claim renewal preserves every byte except expires_at',()=>{
  const io=renewalIo(),before=io.issue.body,result=renewExpiredClaim(renewalOptions,NOW,io)
  assert.equal(result.idempotent,false);assert.equal(result.version,io.version)
  assert.equal(io.issue.body.replace(/^expires_at:.*$/m,'expires_at: X'),before.replace(/^expires_at:.*$/m,'expires_at: X'))
  assert.match(io.issue.body,/expires_at: 2026-08-15T08:00:00.000Z/)
})

test('claim renewal rejects every exact identity and permanent-version mismatch',()=>{
  for(const [change,pattern] of [[{owner:'wrong'},/owner/],[{branch:'wrong'},/branch/],[{worktree:'wrong'},/worktree/],[{headSha:'b'.repeat(40)},/head/],[{pr:999},/parser source/]])assert.throws(()=>renewExpiredClaim({...renewalOptions,...change},NOW,renewalIo()),pattern)
  let io=renewalIo();io.getPrFiles=()=>[{filename:'supabase/migrations/20260816000000_wrong.sql'}];assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/migration version/)
  io=renewalIo();io.refs.delete(`refs/db-claims/${io.version}`);assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/reservation/)
})

test('claim renewal requires one open claim and rejects object collisions',()=>{
  let io=renewalIo();io.openClaims=()=>[];assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/uniquely open/)
  io=renewalIo();const duplicate=io.openClaims()[0];io.openClaims=()=>[duplicate,{...duplicate}];assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/uniquely open/)
  io=renewalIo();io.openClaims=()=>[structuredClone(io.issue),{number:77,body:claimBody({version:'20260816070000',objects:io.objects,owner:'other',branch:'other',worktree:'C:/other',expiresAt:new Date('2026-08-17T00:00:00Z')})}];assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/collision/)
  io=renewalIo();io.prSources=()=>[{label:'PR #1060',objects:io.objects,versions:[io.version]},{label:'PR #999',objects:io.objects,versions:['20260816070000']}];assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/collision/)
})

test('claim renewal rejects uncovered PR objects, concurrent mutation, and active unrelated leases',()=>{
  let io=renewalIo();io.prSources=()=>[{label:'PR #1060',objects:[...io.objects,'table plm.item'],versions:[io.version]}];assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/does not cover/)
  io=renewalIo();const listed=io.openClaims()[0];io.openClaims=()=>[listed];io.getIssue=()=>({...listed,body:`${listed.body}\nchanged`});assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/concurrently/)
  io=renewalIo();io.issue.body=io.issue.body.replace('2026-08-14T19:00:00.000Z','2026-08-15T09:00:00.000Z');assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/active lease/)
})

test('claim renewal accepts parser-empty sequence PR only through exact issue scope',()=>{
  const io=renewalIo();io.prSources=()=>[{label:'PR #1060',objects:[],versions:[io.version]}]
  assert.equal(renewExpiredClaim(renewalOptions,NOW,io).idempotent,false)
  const bad=renewalIo();bad.prSources=()=>[{label:'PR #1060',objects:[],versions:[bad.version]}];bad.workIssue.body=scope('ready','structural','shared-db-orchestrator',900,['sequence dflow.wrong_seq'])
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,bad),/issue objects do not exactly match/)
})

test('curated Master Data renewal preserves an exact legacy claim when issue scope objects are blank',()=>{
  const io=renewalIo()
  io.workIssue.body=scope('ready','curated-master-data','curated-master-data-governance',900,[])
  const result=renewExpiredClaim(renewalOptions,NOW,io)
  assert.equal(result.idempotent,false)
  assert.deepEqual(parseAuthorLease(io.issue.body,NOW).objects,io.objects)
  assert.equal(io.issue.body.replace(/^expires_at:.*$/m,'expires_at: X'),claimBody({version:io.version,objects:io.objects,owner:renewalOptions.owner,branch:renewalOptions.branch,worktree:renewalOptions.worktree,expiresAt:new Date('2026-08-14T19:00:00Z')}).replace(/^expires_at:.*$/m,'expires_at: X'))
})

test('curated renewal still refuses a mismatched declared object and unrelated work types',()=>{
  let io=renewalIo();io.workIssue.body=scope('ready','curated-master-data','curated-master-data-governance',900,['table public.licensors'])
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/must not claim database objects/)
  for(const [workType,route] of [['repo-maintenance','repo-maintenance'],['application-data','application-session'],['source-data','source-data-session']]){
    io=renewalIo();io.workIssue.body=scope('ready',workType,route,900,[])
    assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/structural or curated Master Data/)
  }
})

test('blank curated renewal scope refuses a claim title shared by multiple work issues',()=>{
  const io=renewalIo();io.issue.title='CLAIM: #853/#868 shared curated work';io.workIssue.body=scope('ready','curated-master-data','curated-master-data-governance',900,[])
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/exactly one work issue/)
})

test('claim renewal rejects missing, closed, blocked, or wrong-route issue binding',()=>{
  for(const mutate of [io=>io.workIssue.state='closed',io=>io.workIssue.body=scope('blocked','structural','shared-db-orchestrator',900,io.objects),io=>io.workIssue.body=scope('ready','repo-maintenance','repo-maintenance',900)]){
    const io=renewalIo();mutate(io);assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/open ready structural or curated Master Data/)
  }
  assert.throws(()=>renewExpiredClaim({...renewalOptions,issue:999},NOW,renewalIo()),/not identified by the claim title/)
})

test('claim renewal binds the requested issue number to the claim title',()=>{
  const io=renewalIo();io.workIssue.number=764
  assert.throws(()=>renewExpiredClaim({...renewalOptions,issue:764},NOW,io),/not identified by the claim title/)
})

test('claim renewal refuses an issue scope mutation immediately before write',()=>{
  const io=renewalIo(),baseGet=io.getIssue;let reads=0
  io.getIssue=(number)=>{const value=baseGet(number);if(Number(number)===853&&++reads===2)value.body=scope('blocked','structural','shared-db-orchestrator',900,io.objects);return value}
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/issue changed concurrently/)
  assert.match(io.issue.body,/expires_at: 2026-08-14T19:00:00.000Z/)
})

test('curated renewal refuses a claim title mutation immediately before write',()=>{
  const io=renewalIo(),baseGet=io.getIssue;io.workIssue.body=scope('ready','curated-master-data','curated-master-data-governance',900,[]);let claimReads=0
  io.getIssue=(number)=>{const value=baseGet(number);if(Number(number)===1058&&++claimReads===2)value.title='CLAIM without a work issue';return value}
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/claim changed concurrently during renewal/)
  assert.match(io.issue.body,/expires_at: 2026-08-14T19:00:00.000Z/)
})

test('curated renewal rolls back when the claim title changes during the write',()=>{
  const io=renewalIo(),before=io.issue.body,baseGet=io.getIssue
  io.workIssue.body=scope('ready','curated-master-data','curated-master-data-governance',900,[])
  let claimReads=0
  io.getIssue=(number)=>{if(Number(number)===1058&&++claimReads===3)io.issue.title='CLAIM without a work issue';return baseGet(number)}
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/exact readback failed/)
  assert.equal(io.issue.body,before)
  assert.equal(io.issue.title,'CLAIM without a work issue')
})

test('claim renewal is idempotent for the exact already-written expiry',()=>{
  const io=renewalIo();renewExpiredClaim(renewalOptions,NOW,io);const once=io.issue.body
  const result=renewExpiredClaim(renewalOptions,NOW,io);assert.equal(result.idempotent,true);assert.equal(io.issue.body,once)
})

test('claim renewal rolls back readback failure while mutex-owned and refuses after ownership loss',()=>{
  let io=renewalIo(),before=io.issue.body,reads=0,baseGet=io.getIssue
  io.getIssue=(number)=>{const value=baseGet(number);if(Number(number)===1058&&++reads===3)value.body+='\nbad';return value}
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/readback/);assert.equal(io.issue.body,before)
  io=renewalIo();before=io.issue.body;const update=io.updateIssue;io.updateIssue=(n,fields)=>{const result=update(n,fields);io.refs.set(MUTEX_REF,'successor');return result}
  assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/ROLLBACK NOT ATTEMPTED/);assert.notEqual(io.issue.body,before)
})

test('claim renewal enforces a bounded lease and real CLI wiring',()=>{
  for(const leaseHours of [0,24.01,NaN])assert.throws(()=>renewExpiredClaim({...renewalOptions,leaseHours},NOW,renewalIo()),/no more than 24/)
  const io=renewalIo(),args=['--renew-claim','--claim-number','1058','--issue','853','--owner',renewalOptions.owner,'--branch',renewalOptions.branch,'--worktree',renewalOptions.worktree,'--pr','1060','--head-sha',renewalOptions.headSha,'--lease-hours','12']
  assert.equal(main(args,NOW,io),0);assert.equal(parseAuthorLease(io.issue.body,NOW).active,true)
})

function reversionIo(overrides={}){
  const io=memoryIo(),old='20260816044638',fresh='20260816120000',head='a'.repeat(40),newHead='b'.repeat(40)
  const issue={number:1056,state:'open',title:'CLAIM: #764 sequence repair',body:claimBody({version:old,objects:['sequence dflow.licensingtime_id_seq','sequence dflow.properties_and_characters_id_seq'],owner:'issue_764_sequence_repair/session-1053',branch:'codex/issue-764-sequence-repair',worktree:'C:\\repos\\shared-db-worktrees\\issue-764-sequence-repair',expiresAt:new Date('2026-08-16T16:46:32Z')})}
  const commits=new Map();let commitSequence=0
  io.makeOwnerCommit=(message)=>{const sha=(++commitSequence).toString(16).padStart(40,'0');commits.set(sha,{message});return sha};io.getCommit=(sha)=>commits.get(sha)
  io.refs.set(`refs/db-claims/${old}`,'1'.repeat(40));io.refs.set(`refs/db-claims/${fresh}`,'2'.repeat(40))
  io.getIssue=()=>structuredClone(issue);io.updateIssue=(_,fields)=>{Object.assign(issue,fields);return structuredClone(issue)}
  io.getPr=()=>({state:'open',head:{sha:head,ref:'codex/issue-764-sequence-repair'}})
  io.getPrFiles=()=>[{filename:`supabase/migrations/${old}_repair.sql`}]
  io.localClean=()=>true;io.localHead=()=>head;io.currentMaxVersion=()=> '20260816063532'
  io.reserveVersion=()=>({version:fresh});io.rewriteVersion=()=>{};io.commitAndPushReversion=()=>{io.getPr=()=>({state:'open',head:{sha:newHead,ref:'codex/issue-764-sequence-repair'}});io.getPrFiles=()=>[{filename:`supabase/migrations/${fresh}_repair.sql`}];return newHead}
  return Object.assign(io,{issue,head,newHead,old,fresh},overrides)
}
const reversionArgs={issue:764,claim:1056,pr:1047,owner:'issue_764_sequence_repair/session-1053',oldVersion:'20260816044638',headSha:'a'.repeat(40),branch:'codex/issue-764-sequence-repair',worktree:'C:\\repos\\shared-db-worktrees\\issue-764-sequence-repair'}
test('active claim reversion preserves ownership and both permanent refs',()=>{
  const io=reversionIo(),result=reversionActiveClaim(reversionArgs,NOW,io),lease=parseAuthorLease(io.issue.body,NOW)
  assert.equal(result.newVersion,io.fresh);assert.equal(lease.version,io.fresh);assert.equal(lease.owner,'issue_764_sequence_repair/session-1053');assert.equal(io.refs.get(`refs/db-claims/${io.old}`),'1'.repeat(40))
})
test('active claim reversion rejects changed head, collision, dirty worktree, and non-later reservation',()=>{
  assert.throws(()=>reversionActiveClaim({...reversionArgs,headSha:'c'.repeat(40)},NOW,reversionIo()),/exact head/)
  assert.throws(()=>reversionActiveClaim(reversionArgs,NOW,reversionIo({localClean:()=>false})),/dirty/)
  assert.throws(()=>reversionActiveClaim(reversionArgs,NOW,reversionIo({reserveVersion:()=>({version:'20260816040000'})})),/not later/)
  assert.throws(()=>reversionActiveClaim({...reversionArgs,claim:999},NOW,reversionIo()),/not open/)
  assert.throws(()=>reversionActiveClaim({...reversionArgs,issue:765},NOW,reversionIo()),/claim issue/)
  assert.throws(()=>reversionActiveClaim({...reversionArgs,owner:'another'},NOW,reversionIo()),/claim issue/)
})
test('active claim reversion fails closed when mutex ownership is lost during partial failure',()=>{
  const io=reversionIo();io.commitAndPushReversion=()=>{io.refs.set(MUTEX_REF,'successor');throw new Error('push failed')}
  assert.throws(()=>reversionActiveClaim(reversionArgs,NOW,io),/ROLLBACK NOT ATTEMPTED/)
  assert.equal(io.refs.get(`refs/db-claims/${io.old}`),'1'.repeat(40))
})
test('active claim reversion rolls back an applied-then-failed issue update',()=>{
  const io=reversionIo(),original=io.issue.body,baseUpdate=io.updateIssue,rewrites=[];let first=true
  io.rewriteVersion=(_,from,to)=>{rewrites.push([from,to])}
  io.updateIssue=(number,fields)=>{const result=baseUpdate(number,fields);if(first){first=false;throw new Error('response lost after PATCH')}return result}
  assert.throws(()=>reversionActiveClaim(reversionArgs,NOW,io),/response lost/)
  assert.equal(io.issue.body,original)
  assert.deepEqual(rewrites,[[io.old,io.fresh],[io.fresh,io.old]])
})

test('general active-claim version supersession is idempotent from immutable evidence',()=>{
  const io=reversionIo(),first=supersedeActiveClaimVersion(reversionArgs,NOW,io)
  const second=supersedeActiveClaimVersion(reversionArgs,NOW,io)
  assert.equal(second.idempotent,true);assert.equal(second.newVersion,first.newVersion);assert.equal(second.newHead,first.newHead)
  assert.equal(io.refs.get(`refs/db-claims/${io.old}`),'1'.repeat(40));assert.equal(io.refs.get(`refs/db-claims/${io.fresh}`),'2'.repeat(40))
})
test('general version supersession allows unrelated removals but refuses removed migration files',()=>{
  const allowed=reversionIo({getPrFiles:()=>[
    {status:'removed',filename:'scripts/obsolete-contract.test.mjs'},
    {status:'modified',filename:'supabase/migrations/20260816044638_repair.sql'},
  ]})
  assert.equal(supersedeActiveClaimVersion(reversionArgs,NOW,allowed).newVersion,allowed.fresh)

  const refused=reversionIo({getPrFiles:()=>[
    {status:'removed',filename:'supabase/migrations/20260816044638_repair.sql'},
    {status:'removed',filename:'scripts/obsolete-contract.test.mjs'},
  ]})
  assert.throws(()=>supersedeActiveClaimVersion(reversionArgs,NOW,refused),/removes a migration file/)
  assert.equal(refused.issue.body,reversionIo().issue.body)
})

function mergedReissueIo(overrides={}){
  const io=memoryIo(),old='20260827183011',fresh='20260828120000',merge='c'.repeat(40),main='d'.repeat(40),objects=['table public.asset_effective_tags','function public.filter_effective_assets']
  const issue={number:1656,state:'open',title:'CLAIM: #1645 PopDAM effective filters and facet parity',body:claimBody({version:old,objects,owner:'codex-agent issue-1645-1649',branch:'codex/issue-1645-effective-filters-1649',worktree:'C:\\old',expiresAt:new Date('2026-08-28T01:08:18.594Z')})}
  const commits=new Map();let sequence=0
  io.makeOwnerCommit=(message)=>{const sha=(++sequence).toString(16).padStart(40,'0');commits.set(sha,{message});return sha};io.getCommit=(sha)=>commits.get(sha)
  io.refs.set(`refs/db-claims/${old}`,'1'.repeat(40));io.refs.set(`refs/db-claims/${fresh}`,'2'.repeat(40));io.refs.set('refs/heads/main',main)
  io.getIssue=()=>structuredClone(issue);io.updateIssue=(_,fields)=>{Object.assign(issue,fields);return structuredClone(issue)}
  io.getPr=()=>({state:'closed',merged_at:'2026-08-27T19:00:00Z',merge_commit_sha:merge})
  io.getPrFiles=()=>[{status:'added',filename:`supabase/migrations/${old}_popdam_effective_asset_filters.sql`},{status:'added',filename:'supabase/tests/popdam_effective_asset_filter_contracts.sql'}]
  io.mainSha=()=>main;io.compareCommits=()=>({status:'ahead',behind_by:0});io.reserveVersion=()=>({version:fresh})
  return Object.assign(io,{issue,old,fresh,merge,main,objects},overrides)
}
const mergedReissueArgs={issue:1645,claim:1656,sourcePr:1664,owner:'codex-agent issue-1645-1649',targetBranch:'codex/issue-1645-effective-filters-reissue',targetWorktree:'C:\\new',oldVersion:'20260827183011',leaseHours:12}

test('merged stranded claim reissue preserves the exact object lock and both permanent reservations',()=>{
  const io=mergedReissueIo(),result=reissueMergedStrandedClaim(mergedReissueArgs,NOW,io),lease=parseAuthorLease(io.issue.body,NOW)
  assert.equal(result.newVersion,io.fresh);assert.equal(lease.version,io.fresh);assert.deepEqual([...lease.objects].sort(),[...io.objects].sort())
  assert.equal(lease.owner,mergedReissueArgs.owner);assert.equal(lease.branch,mergedReissueArgs.targetBranch);assert.equal(lease.worktree,mergedReissueArgs.targetWorktree)
  assert.equal(io.refs.get(`refs/db-claims/${io.old}`),'1'.repeat(40));assert.equal(io.refs.get(`refs/db-claims/${io.fresh}`),'2'.repeat(40))
  assert.ok(io.refs.get(`refs/db-claim-retirements/1656-${io.old}`))
})

test('merged stranded claim reissue is idempotent only from matching immutable evidence',()=>{
  const io=mergedReissueIo(),first=reissueMergedStrandedClaim(mergedReissueArgs,NOW,io),second=reissueMergedStrandedClaim(mergedReissueArgs,NOW,io)
  assert.equal(second.idempotent,true);assert.equal(second.retirementSha,first.retirementSha);assert.equal(second.newVersion,first.newVersion)
  io.issue.body=io.issue.body.replace(mergedReissueArgs.targetBranch,'foreign')
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,io),/neither original nor exactly reissued/)
})

test('merged stranded claim reissue refuses unmerged, non-main, wrong-version, reused-location, and reservation failures',()=>{
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,mergedReissueIo({getPr:()=>({state:'open'})})),/not merged/)
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,mergedReissueIo({compareCommits:()=>({status:'diverged',behind_by:1})})),/not contained/)
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,mergedReissueIo({getPrFiles:()=>[{status:'added',filename:'supabase/migrations/20260827180000_wrong.sql'}]})),/stranded migration/)
  assert.throws(()=>reissueMergedStrandedClaim({...mergedReissueArgs,targetBranch:'codex/issue-1645-effective-filters-1649'},NOW,mergedReissueIo()),/fresh target/)
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,mergedReissueIo({reserveVersion:()=>({version:'20260827170000'})})),/not later/)
})

test('merged stranded claim reissue rolls back claim and evidence after partial failure and fails closed after mutex loss',()=>{
  let io=mergedReissueIo(),before=io.issue.body,baseUpdate=io.updateIssue,first=true
  io.updateIssue=(number,fields)=>{const result=baseUpdate(number,fields);if(first){first=false;throw new Error('response lost')}return result}
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,io),/response lost/);assert.equal(io.issue.body,before);assert.equal(io.readRef(`refs/db-claim-retirements/1656-${io.old}`),null)
  io=mergedReissueIo();io.updateIssue=(number,fields)=>{Object.assign(io.issue,fields);io.refs.set(MUTEX_REF,'successor');throw new Error('lost mutex')}
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,io),/ROLLBACK NOT ATTEMPTED/)
})

test('merged stranded claim reissue resumes exact evidence stranded before the claim update',()=>{
  const io=mergedReissueIo(),create=io.createRef
  io.createRef=(ref,sha)=>{const result=create(ref,sha);if(ref.startsWith('refs/db-claim-retirements/'))io.refs.set(MUTEX_REF,'successor');return result}
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,io),/ROLLBACK NOT ATTEMPTED/)
  assert.equal(parseAuthorLease(io.issue.body,NOW).version,io.old)
  io.createRef=create;io.refs.delete(MUTEX_REF)
  const resumed=reissueMergedStrandedClaim(mergedReissueArgs,NOW,io)
  assert.equal(resumed.idempotent,false);assert.equal(parseAuthorLease(io.issue.body,NOW).version,io.fresh)
})

test('REAL main command wires the merged stranded claim reissue identities',()=>{
  const io=mergedReissueIo(),args=['--reissue-merged-stranded-claim','--issue','1645','--claim-number','1656','--source-pr','1664','--owner',mergedReissueArgs.owner,'--target-branch',mergedReissueArgs.targetBranch,'--target-worktree',mergedReissueArgs.targetWorktree,'--old-version',mergedReissueArgs.oldVersion,'--lease-hours','12']
  assert.equal(main(args,NOW,io),0);assert.equal(parseAuthorLease(io.issue.body,NOW).version,io.fresh)
})

// Issue #1165. A stale PR readback after a landed push is eventual consistency,
// not a failed push, and treating it as failure permanently burns a migration
// version reservation on every attempt.
function stalingReversionIo(staleReads,{foreignHead=null,extraVersion=null}={}){
  const io=reversionIo(),waits=[]
  io.wait=(ms)=>{waits.push(ms)}
  const push=io.commitAndPushReversion
  io.commitAndPushReversion=(...args)=>{
    const head=push(...args),freshPr=io.getPr,freshFiles=io.getPrFiles
    let remaining=staleReads
    io.getPr=()=>remaining>0?({state:'open',head:{sha:foreignHead??io.head,ref:'codex/issue-764-sequence-repair'}}):freshPr()
    io.getPrFiles=()=>{
      if(remaining<=0)return freshFiles()
      remaining-=1
      const files=[{filename:`supabase/migrations/${io.old}_repair.sql`}]
      if(extraVersion)files.push({filename:`supabase/migrations/${extraVersion}_other.sql`})
      return files
    }
    return head
  }
  return Object.assign(io,{waits})
}

test('version supersession rides out a bounded stale PR readback instead of burning the reservation',()=>{
  const io=stalingReversionIo(3),result=supersedeActiveClaimVersion(reversionArgs,NOW,io)
  assert.equal(result.newVersion,io.fresh);assert.equal(result.newHead,io.newHead);assert.equal(result.idempotent,false)
  assert.equal(parseAuthorLease(io.issue.body,NOW).version,io.fresh)
  assert.equal(io.refs.get(`refs/db-claims/${io.old}`),'1'.repeat(40));assert.equal(io.refs.get(`refs/db-claims/${io.fresh}`),'2'.repeat(40))
  assert.equal(io.waits.length,3)
})

test('version supersession still refuses and rolls back when the PR readback never catches up',()=>{
  const io=stalingReversionIo(Number.MAX_SAFE_INTEGER),original=io.issue.body,rewrites=[]
  io.rewriteVersion=(_,from,to)=>{rewrites.push([from,to])}
  assert.throws(()=>supersedeActiveClaimVersion(reversionArgs,NOW,io),/did not expose exactly the new reserved migration/)
  assert.equal(io.issue.body,original)
  assert.deepEqual(rewrites,[[io.old,io.fresh],[io.fresh,io.old]])
  assert.equal(io.waits.length,11)
})

test('version supersession fails closed on the FIRST read for anything that is not exactly stale',()=>{
  const foreign=stalingReversionIo(5,{foreignHead:'f'.repeat(40)})
  assert.throws(()=>supersedeActiveClaimVersion(reversionArgs,NOW,foreign),/did not expose exactly the new reserved migration/)
  assert.equal(foreign.waits.length,0)
  const collided=stalingReversionIo(5,{extraVersion:'20260816130000'})
  assert.throws(()=>supersedeActiveClaimVersion(reversionArgs,NOW,collided),/did not expose exactly the new reserved migration/)
  assert.equal(collided.waits.length,0)
})

test('readPrAfterPush accepts every partially-propagated combination and no other',()=>{
  const head='b'.repeat(40),staleHead='a'.repeat(40),branch='codex/x',version='20260816120000',staleVersion='20260816044638'
  const expected={head,version,branch,staleHead,staleVersion}
  const io=(sha,files,state='open',ref=branch)=>({wait:()=>{},getPr:()=>({state,head:{sha,ref}}),getPrFiles:()=>files.map((v)=>({filename:`supabase/migrations/${v}_x.sql`}))})
  assert.ok(readPrAfterPush(1,expected,io(head,[version]),1))
  for(const [sha,files] of [[staleHead,[staleVersion]],[staleHead,[version]],[head,[staleVersion]]]){
    assert.equal(readPrAfterPush(1,expected,io(sha,files),1),null,'a stale combination must not be accepted as proof')
    assert.ok(readPrAfterPush(1,expected,{...io(sha,files),getPr:()=>({state:'open',head:{sha:head,ref:branch}}),getPrFiles:()=>[{filename:`supabase/migrations/${version}_x.sql`}]},2))
  }
  assert.equal(readPrAfterPush(1,expected,io('c'.repeat(40),[version]),12),null)
  assert.equal(readPrAfterPush(1,expected,io(head,[]),12),null)
  assert.equal(readPrAfterPush(1,expected,io(head,[version,staleVersion]),12),null)
  assert.equal(readPrAfterPush(1,expected,io(head,[version],'closed'),12),null)
  assert.equal(readPrAfterPush(1,expected,io(head,[version],'open','other/branch'),12),null)
})

test('general version supersession CLI binds every identity field',()=>{
  const io=reversionIo(),args=['--supersede-active-claim-version','--issue','764','--claim-number','1056','--owner',reversionArgs.owner,'--branch',reversionArgs.branch,'--worktree',reversionArgs.worktree,'--pr','1047','--head-sha',reversionArgs.headSha,'--old-version',reversionArgs.oldVersion]
  assert.equal(main(args,NOW,io),0);assert.equal(parseAuthorLease(io.issue.body,NOW).version,io.fresh)
})

function withReversionRepo(files,run){
  const repo=mkdtempSync(path.join(tmpdir(),'db-lane-reversion-'))
  try{
    for(const [relative,contents] of Object.entries(files)){
      const absolute=path.join(repo,relative);mkdirSync(path.dirname(absolute),{recursive:true});writeFileSync(absolute,contents)
    }
    const initialized=spawnSync('git',['init','--quiet',repo],{encoding:'utf8'});assert.equal(initialized.status,0,initialized.stderr)
    const added=spawnSync('git',['-C',repo,'add','--all'],{encoding:'utf8'});assert.equal(added.status,0,added.stderr)
    return run(repo)
  }finally{rmSync(repo,{recursive:true,force:true})}
}

test('REAL GIT: version rewrite discovers a migration whose version exists only in its filename and reverses it',()=>withReversionRepo({
  'supabase/migrations/20260816044638_repair.sql':'select nextval(regclass);\n',
  'docs/reversion.md':'reserved version 20260816044638\n',
},(repo)=>{
  const old='20260816044638',fresh='20260816120000',oldFile=path.join(repo,'supabase/migrations',`${old}_repair.sql`),newFile=path.join(repo,'supabase/migrations',`${fresh}_repair.sql`)
  githubIo.rewriteVersion(repo,old,fresh)
  assert.equal(existsSync(oldFile),false);assert.equal(existsSync(newFile),true);assert.equal(readFileSync(newFile,'utf8'),'select nextval(regclass);\n');assert.equal(readFileSync(path.join(repo,'docs/reversion.md'),'utf8'),`reserved version ${fresh}\n`)
  githubIo.rewriteVersion(repo,fresh,old)
  assert.equal(existsSync(oldFile),true);assert.equal(existsSync(newFile),false);assert.equal(readFileSync(path.join(repo,'docs/reversion.md'),'utf8'),`reserved version ${old}\n`)
}))

test('REAL GIT: version rewrite rekeys and rehashes its verification sidecar',()=>withReversionRepo({
  'supabase/migrations/20260816044638_repair.sql':'-- version 20260816044638\nselect 1;\n',
  'scripts/production-verification-sidecars/20260816044638.json':JSON.stringify({schema_version:1,migration_version:'20260816044638',migration_sha256:'0'.repeat(64),checks:[]}),
  'scripts/production_business_risk_gate.py':'PREVIEW_PRODUCER_PATHS=("scripts/production-verification-sidecars/20260816044638.json",)\n',
},(repo)=>{const old='20260816044638',fresh='20260816120000';githubIo.rewriteVersion(repo,old,fresh);const sidecar=JSON.parse(readFileSync(path.join(repo,'scripts/production-verification-sidecars',`${fresh}.json`),'utf8'));assert.equal(sidecar.migration_version,fresh);assert.equal(sidecar.migration_sha256,createHash('sha256').update(`-- version ${fresh}\nselect 1;\n`).digest('hex'));assert.equal(existsSync(path.join(repo,'scripts/production-verification-sidecars',`${old}.json`)),false);assert.match(readFileSync(path.join(repo,'scripts/production_business_risk_gate.py'),'utf8'),new RegExp(fresh));assert.doesNotMatch(readFileSync(path.join(repo,'scripts/production_business_risk_gate.py'),'utf8'),new RegExp(old))}))

test('REAL GIT: sidecar rename failure restores migration, sidecar, and contents',()=>withReversionRepo({
  'supabase/migrations/20260816044638_repair.sql':'-- version 20260816044638\nselect 1;\n',
  'scripts/production-verification-sidecars/20260816044638.json':JSON.stringify({schema_version:1,migration_version:'20260816044638',migration_sha256:'0'.repeat(64),checks:[]}),
},(repo)=>{const old='20260816044638',fresh='20260816120000',io={...githubIo,renameSidecarVersion(){throw new Error('injected sidecar rename failure')}};assert.throws(()=>io.rewriteVersion(repo,old,fresh),/injected sidecar rename failure/);assert.equal(existsSync(path.join(repo,'supabase/migrations',`${old}_repair.sql`)),true);assert.equal(existsSync(path.join(repo,'supabase/migrations',`${fresh}_repair.sql`)),false);const sidecar=JSON.parse(readFileSync(path.join(repo,'scripts/production-verification-sidecars',`${old}.json`),'utf8'));assert.equal(sidecar.migration_version,old);assert.equal(sidecar.migration_sha256,'0'.repeat(64))}))

test('REAL GIT: version rewrite fails closed on missing, duplicate, and malformed migration filenames',()=>{
  const old='20260816044638',fresh='20260816120000'
  for(const files of [
    {'docs/reversion.md':`reserved version ${old}\n`},
    {[`supabase/migrations/${old}_a.sql`]:'select 1;\n',[`supabase/migrations/${old}_b.sql`]:'select 2;\n'},
    {[`supabase/migrations/${old}.sql`]:'select 1;\n','docs/reversion.md':`reserved version ${old}\n`},
  ])withReversionRepo(files,(repo)=>{
    const before=new Map(Object.keys(files).map((relative)=>[relative,readFileSync(path.join(repo,relative),'utf8')]))
    assert.throws(()=>githubIo.rewriteVersion(repo,old,fresh),/exactly one/)
    for(const [relative,contents] of before)assert.equal(readFileSync(path.join(repo,relative),'utf8'),contents)
  })
})

test('REAL GIT: version rewrite refuses an existing target filename without editing either migration',()=>withReversionRepo({
  'supabase/migrations/20260816044638_repair.sql':'-- version 20260816044638\nselect 1;\n',
  'supabase/migrations/20260816120000_repair.sql':'select 2;\n',
},(repo)=>{
  const old='20260816044638',fresh='20260816120000',oldFile=path.join(repo,'supabase/migrations',`${old}_repair.sql`),newFile=path.join(repo,'supabase/migrations',`${fresh}_repair.sql`)
  assert.throws(()=>githubIo.rewriteVersion(repo,old,fresh),/target filename already exists/)
  assert.equal(readFileSync(oldFile,'utf8'),`-- version ${old}\nselect 1;\n`);assert.equal(readFileSync(newFile,'utf8'),'select 2;\n')
}))

test('REAL GIT: failed migration rename restores all content edits before returning',()=>withReversionRepo({
  'supabase/migrations/20260816044638_repair.sql':'-- version 20260816044638\nselect 1;\n',
  'docs/reversion.md':'reserved version 20260816044638\n',
},(repo)=>{
  const io={...githubIo,renameVersionFile(){throw new Error('injected rename failure')}},old='20260816044638',fresh='20260816120000',oldFile=path.join(repo,'supabase/migrations',`${old}_repair.sql`)
  assert.throws(()=>io.rewriteVersion(repo,old,fresh),/injected rename failure/)
  assert.equal(existsSync(oldFile),true);assert.equal(existsSync(path.join(repo,'supabase/migrations',`${fresh}_repair.sql`)),false)
  assert.equal(readFileSync(oldFile,'utf8'),`-- version ${old}\nselect 1;\n`);assert.equal(readFileSync(path.join(repo,'docs/reversion.md'),'utf8'),`reserved version ${old}\n`)
}))

test('an open issue with no db-work label is reported and blocks an empty-lane claim',()=>{
  const issues=[
    {number:70,title:'labelled',labels:['db-work'],body:scope('ready','repo-maintenance','repo-maintenance',5)},
    {number:71,title:'unlabelled but classified',labels:[],body:scope('ready','repo-maintenance','repo-maintenance',5)},
    {number:72,title:'unlabelled and unclassified',labels:['bug'],body:'no scope block here'},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.deepEqual(result.unlabelled,[71,72])
  assert.deepEqual(result.unclassified,[72])
  assert.equal(result.fullyAudited,false)
})

test('openWorkIssues audits every open issue and excludes only coordination issues',()=>{
  const rows=[
    {number:80,title:'work',body:'b',labels:[{name:'db-work'}]},
    {number:81,title:'unlabelled',body:'b',labels:[]},
    {number:82,title:'claim',body:'b',labels:[{name:'db-claim'}]},
    {number:83,title:'marker',body:'b',labels:[{name:'orchestrator-marker'}]},
    {number:84,title:'pr',body:'b',labels:[],pull_request:{}},
  ]
  const calls=[]
  const result=githubIo.openWorkIssues((endpoint)=>{calls.push(endpoint);return rows})
  assert.deepEqual(result.map((x)=>x.number),[80,81])
  assert.ok(calls.every((endpoint)=>!/labels=/.test(endpoint)),'the audit must not filter by label')
})


// --- issue #1351: an assignment must stay findable after the PR head moves ---

const movedHead='beef1230000000000000000000000000000000ff'

test('a reviewer assignment stays findable after the pull request head moves',()=>{
  const io=failedReviewIo()
  const found=findPrReviewAssignments(failedReview.issue,failedReview.pr,io)
  assert.equal(found.length,1)
  assert.equal(found[0].headSha,failedReview.headSha)
  assert.equal(found[0].sequence,1)
  assert.ok(found[0].ref.startsWith(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-`))
  // The head moved. The record is still there, and it is still filed under the
  // exact commit it reviews.
  io.getPr=()=>({state:'open',head:{sha:movedHead}})
  assert.deepEqual(findPrReviewAssignments(failedReview.issue,failedReview.pr,io),found)
})

test('replacement at a moved head reports the record that EXISTS instead of claiming it is missing',()=>{
  const io=failedReviewIo()
  io.getPr=()=>({state:'open',head:{sha:movedHead}})
  // The operator does what the tool demands and names the PR's CURRENT head.
  // Before this fix that produced "original durable reviewer assignment is
  // missing" -- a phantom data-loss report (issue #1351).
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,headSha:movedHead},io),(error)=>{
    assert.ok(error instanceof LaneError)
    assert.match(error.message,/NOT missing/)
    assert.match(error.message,/sequence=1/)
    assert.match(error.message,new RegExp(failedReview.headSha))
    assert.match(error.message,/--assign-reviewer/)
    assert.doesNotMatch(error.message,/assignment is missing/)
    return true
  })
})

test('replacement at the assigned head after a push says the code under review changed',()=>{
  const io=failedReviewIo()
  io.getPr=()=>({state:'open',head:{sha:movedHead}})
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),(error)=>{
    assert.match(error.message,/exact open PR head/)
    assert.match(error.message,/IS recorded/)
    assert.match(error.message,new RegExp(movedHead))
    return true
  })
})

test('a genuinely absent reviewer assignment still refuses, and says so accurately',()=>{
  const io=reviewIo()
  io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}})
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/under ANY head/)
})

test('the verdict-to-commit binding survives: each head keeps its own assignment record',()=>{
  const io=failedReviewIo()
  io.getPr=()=>({state:'open',head:{sha:movedHead}})
  const second=assignNextReviewer({...failedReview,headSha:movedHead},io)
  assert.notEqual(second.sequence,1)
  const found=findPrReviewAssignments(failedReview.issue,failedReview.pr,io)
  assert.deepEqual(found.map((row)=>row.headSha).sort(),[failedReview.headSha,movedHead].sort())
  // A new head NEVER inherits the old head's reviewer record.
  assert.equal(found.find((row)=>row.headSha===movedHead).sequence,second.sequence)
  assert.equal(found.find((row)=>row.headSha===failedReview.headSha).sequence,1)
})

// --- issue #1351: expected 404 probes are quiet, real failures are loud ---

test('an expected ref-absence answer does not print, and still throws',()=>{
  const printed=[]
  assert.throws(()=>runGitHubCommand(['api','repos/x/git/ref/heads/nope'],{
    executor:()=>{throw commandFailure('gh: Not Found (HTTP 404)')},
    wait:()=>{},expectedFailure:EXPECTED_REF_ABSENCE,reportStderr:(text)=>printed.push(text),
  }),(error)=>error instanceof LaneError&&isConfirmedRefAbsence(error))
  assert.deepEqual(printed,[])
})

test('a genuine GitHub failure still prints its own stderr loudly',()=>{
  const printed=[]
  // Same call site, same suppression option: only the ANSWER is quiet.
  assert.throws(()=>runGitHubCommand(['api','repos/x/git/ref/heads/main'],{
    executor:()=>{throw commandFailure('gh: Bad credentials (HTTP 401)')},
    wait:()=>{},expectedFailure:EXPECTED_REF_ABSENCE,reportStderr:(text)=>printed.push(text),
  }),/Bad credentials/)
  assert.equal(printed.length,1)
  assert.match(printed[0],/Bad credentials/)
  assert.match(printed[0],/repos\/x\/git\/ref\/heads\/main/)
})

test('an ambiguous not-found without a 404 stays loud and stays a hard failure',()=>{
  const printed=[]
  assert.throws(()=>runGitHubCommand(['api','endpoint'],{
    executor:()=>{throw commandFailure('could not resolve host: not found')},
    wait:()=>{},expectedFailure:EXPECTED_REF_ABSENCE,reportStderr:(text)=>printed.push(text),
  }),LaneError)
  assert.equal(printed.length,1)
})

test('a retried transient failure prints once, at the end, not once per attempt',()=>{
  const printed=[]
  assert.throws(()=>runGitHubCommand(['api','endpoint'],{
    executor:()=>{throw commandFailure('HTTP 502: bad gateway')},
    wait:()=>{},reportStderr:(text)=>printed.push(text),
  }),LaneError)
  assert.equal(printed.length,1)
})

test('GitHub stderr is captured by the child process, never inherited to the terminal',()=>{
  // This is what silences the benign 404s at the source. If stderr were
  // inherited, gh would print them before this code could ever classify them.
  let seen=null
  runGitHubCommand(['api','endpoint'],{executor:(command,args,options)=>{seen=options;return '{}'}})
  assert.deepEqual(seen.stdio,['ignore','pipe','pipe'])
})

test('ref creation and deletion mark their expected answers as expected',()=>{
  const seen=[]
  createRefWithReadback('refs/x','sha',{run:(args,options)=>{seen.push(options?.expectedFailure);return ''}})
  deleteRefWithReadback('refs/x',{run:(args,options)=>{seen.push(options?.expectedFailure);return ''}})
  assert.deepEqual(seen,[EXPECTED_REF_PRESENCE,EXPECTED_REF_ABSENCE])
})

// --- THE CONFLICT MATRIX (Step 2, issue #1366) ------------------------------
//
//              B reads   B writes
//   A reads      no        YES
//   A writes     YES       YES

test('read/read does not conflict, so unrelated readers run in parallel', () => {
  const a = { writes: [], reads: ['table core.a'] }
  const b = { writes: [], reads: ['table core.a'] }
  assert.equal(conflicts(a, b), false)
  assert.equal(conflicts(b, a), false)
})

test('write/write conflicts in both directions', () => {
  const a = { writes: ['table core.a'], reads: [] }
  const b = { writes: ['table core.a'], reads: [] }
  assert.equal(conflicts(a, b), true)
  assert.equal(conflicts(b, a), true)
})

// BOTH DIRECTIONS MATTER. A one-sided check would let a writer start against an
// active reader whenever the reader happened to be evaluated first.
test('write/read conflicts whichever way round the two tasks are compared', () => {
  const writer = { writes: ['table core.a'], reads: [] }
  const reader = { writes: [], reads: ['table core.a'] }
  assert.equal(conflicts(writer, reader), true, 'a writer must not run against an active reader')
  assert.equal(conflicts(reader, writer), true, 'a reader must not start against an active writer')
})

test('tasks touching different objects never conflict', () => {
  assert.equal(conflicts({ writes: ['table core.a'], reads: ['table core.c'] }, { writes: ['table core.b'], reads: ['table core.d'] }), false)
})

test('missing or empty read/write sets are treated as empty rather than throwing', () => {
  assert.equal(conflicts({}, {}), false)
  assert.equal(conflicts(undefined, { writes: ['table core.a'], reads: [] }), false)
  assert.equal(conflicts({ writes: ['table core.a'] }, { reads: ['table core.a'] }), true)
})

// --- READ/WRITE SCOPE PARSING ----------------------------------------------

const scopeWith = (body) => ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'priority: 5', 'depends_on:', body, '```'].join('\n')
const repoScopeWith = (body) => ['```db-work-scope', 'status: ready', 'work_type: repo-maintenance', 'route: repo-maintenance', 'priority: 5', 'depends_on:', body, '```'].join('\n')

test('a scope may declare writes and reads separately', () => {
  const parsed = parseQueueScope(scopeWith('writes:\n  - table core.a\nreads:\n  - table core.b'))
  assert.deepEqual(parsed.writes, ['table core.a'])
  assert.deepEqual(parsed.reads, ['table core.b'])
  assert.deepEqual(parsed.legacyObjects, [])
})

// LEGACY_OBJECTS_MEANS_WRITES. Reading an old claim as anything weaker than a
// write would let a new writer start against work already in flight.
test('a legacy objects: scope is read as WRITES and is flagged as legacy', () => {
  const legacy = parseQueueScope(scopeWith('objects:\n  - table core.a'))
  assert.deepEqual(legacy.writes, ['table core.a'])
  assert.deepEqual(legacy.reads, [])
  assert.deepEqual(legacy.legacyObjects, ['table core.a'], 'Step 8A finds retirable claims through this field')
  assert.equal(conflicts(legacy, { writes: [], reads: ['table core.a'] }), true, 'a legacy claim must still block a reader')
})

test('mixing the legacy objects: list with writes: or reads: is refused', () => {
  assert.throws(() => parseQueueScope(scopeWith('objects:\n  - table core.a\nwrites:\n  - table core.b')), /must not mix the legacy objects: list/)
  assert.throws(() => parseQueueScope(scopeWith('objects:\n  - table core.a\nreads:\n  - table core.b')), /must not mix the legacy objects: list/)
})

test('declaring one object as both a read and a write is refused at authoring time', () => {
  assert.throws(() => parseQueueScope(scopeWith('writes:\n  - table core.a\nreads:\n  - table core.a')), /both a read and a write/)
})

test('a repeated list header is an error, not a silent append', () => {
  assert.throws(() => parseQueueScope(scopeWith('writes:\n  - table core.a\nwrites:\n  - table core.b')), /repeats the writes: list/)
})

test('structural work must declare at least one write; reads alone are not enough', () => {
  assert.throws(() => parseQueueScope(scopeWith('reads:\n  - table core.a')), /must list at least one write/)
})

test('non-structural work may declare neither reads nor writes', () => {
  assert.throws(() => parseQueueScope(repoScopeWith('writes:\n  - table core.a')), /must not claim database objects/)
  assert.throws(() => parseQueueScope(repoScopeWith('reads:\n  - table core.a')), /must not claim database objects/)
  assert.deepEqual(parseQueueScope(repoScopeWith('')).writes, [])
})

test('reads and writes are normalised and de-duplicated like objects always were', () => {
  const parsed = parseQueueScope(scopeWith('writes:\n  - TABLE  core.A\nreads:\n  - VIEW   api.B'))
  assert.deepEqual(parsed.writes, ['table core.a'])
  assert.deepEqual(parsed.reads, ['view api.b'])
})

test('quoted exact identifiers are accepted and canonicalized without losing case or spaces', () => {
  const parsed = parseQueueScope(scopeWith('writes:\n  - TABLE "MixedSchema"."MixedTable"\n  - SEQUENCE dflow."itemHeader_item_num_id_pk _seq"'))
  assert.deepEqual(parsed.writes, [
    'table "MixedSchema"."MixedTable"',
    'sequence dflow."itemHeader_item_num_id_pk _seq"',
  ])
  assert.deepEqual(validateClaimObjects(['column "MixedSchema"."MixedTable"."Mixed Column"']), [
    'column "MixedSchema"."MixedTable"."Mixed Column"',
    'table "MixedSchema"."MixedTable"',
  ])
  assert.throws(() => validateClaimObjects(['table core..too_broad']), /schema-qualified exact name/)
  assert.throws(() => validateClaimObjects(['table core.valid trailing']), /schema-qualified exact name/)
  assert.deepEqual(validateClaimObjects(['table "core"."foo"']), ['table core.foo'])
  assert.deepEqual(validateClaimObjects(['table core."a""b"']), ['table core."a""b"'])
})

test('claimBody round-trips reads and writes, and omits an empty reads header', () => {
  const expiresAt = new Date('2026-08-24T00:00:00Z')
  const withReads = claimBody({ version: '20260823120000', writes: ['table core.a'], reads: ['table core.b'], owner: 'o', branch: 'b', worktree: 'w', expiresAt })
  assert.match(withReads, /^writes:$/m)
  assert.match(withReads, /^reads:$/m)
  const lease = parseAuthorLease(withReads, new Date('2026-08-23T00:00:00Z'))
  assert.deepEqual(lease.writes, ['table core.a'])
  assert.deepEqual(lease.reads, ['table core.b'])

  const writesOnly = claimBody({ version: '20260823120000', writes: ['table core.a'], owner: 'o', branch: 'b', worktree: 'w', expiresAt })
  assert.doesNotMatch(writesOnly, /^reads:$/m, 'an empty reads header would make every legacy claim look edited')
})

test('claimBody still accepts the deprecated objects parameter as writes', () => {
  const body = claimBody({ version: '20260823120000', objects: ['table core.a'], owner: 'o', branch: 'b', worktree: 'w', expiresAt: new Date('2026-08-24T00:00:00Z') })
  assert.deepEqual(parseAuthorLease(body, new Date('2026-08-23T00:00:00Z')).writes, ['table core.a'])
})

// THE POINT OF THE WHOLE STEP: two readers of one table share the queue; a
// writer against that table serialises them.
test('the queue lets two readers of one table run in parallel but serialises a writer', () => {
  const reader = (n) => ({
    number: n,
    title: 'reader ' + n,
    body: scopeWith('writes:\n  - table core.own' + n + '\nreads:\n  - table core.shared'),
  })
  const readers = buildDynamicQueues([reader(1), reader(2)], [], NOW)
  assert.equal(readers.dispatchable.length, 2, 'two readers of the same table must be dispatchable at once')

  const writer = { number: 3, title: 'writer', body: scopeWith('writes:\n  - table core.shared') }
  const mixed = buildDynamicQueues([reader(1), writer], [], NOW)
  assert.equal(mixed.dispatchable.length, 1, 'a writer and a reader of the same table must serialise')
})

// --- DEPENDENCY PROOF IN THE QUEUE (Step 3, issue #1366) --------------------

const depScope = (deps) => ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'priority: 5', 'depends_on: ' + deps, 'writes:', '  - table core.a', '```'].join('\n')
const completionComment = (record) => ({ body: '```db-work-completion\n' + JSON.stringify(record) + '\n```' })
const mergedRecord = (issue) => ({ schema_version: 1, work_issue: issue, outcome: 'merged', pr: 1, merge_sha: 'abc1234', migration_versions: [] })

// THE CENTRAL REGRESSION. Before Step 3 the queue asked only "is the dependency
// number in the open set?", so a closed-without-merging issue released downstream
// work immediately.
test('a closed dependency with no completion record does NOT release downstream work', () => {
  const issues = [{ number: 20, title: 'downstream', body: depScope('#10') }]
  const states = { 10: { exists: true, open: false, comments: [] } }
  const result = buildDynamicQueues(issues, [], NOW, [20], states)
  assert.deepEqual(result.dispatchable, [], 'closure alone must not count as success')
  assert.match(result.skipped.find((row)=>row.issue===20).detail, /closure alone is not success/)
})

test('a dependency that never existed BLOCKS instead of releasing instantly', () => {
  const result = buildDynamicQueues([{ number: 20, title: 'typo', body: depScope('#99999') }], [], NOW, [20], { 99999: { exists: false } })
  assert.deepEqual(result.dispatchable, [])
  assert.match(result.skipped.find((row)=>row.issue===20).detail, /does not exist/)
})

test('a proven merged dependency does release downstream work', () => {
  const states = { 10: { exists: true, open: false, comments: [completionComment(mergedRecord(10))], mergeInMain: true } }
  const result = buildDynamicQueues([{ number: 20, title: 'downstream', body: depScope('#10') }], [], NOW, [20], states)
  assert.deepEqual(result.dispatchable, [20])
})

test('an unsuccessful outcome blocks and the audit says which outcome', () => {
  const cancelled = { schema_version: 1, work_issue: 10, outcome: 'cancelled', reason: 'superseded by a different approach' }
  const states = { 10: { exists: true, open: false, comments: [completionComment(cancelled)] } }
  const result = buildDynamicQueues([{ number: 20, title: 'downstream', body: depScope('#10') }], [], NOW, [20], states)
  assert.deepEqual(result.dispatchable, [])
  assert.match(result.skipped.find((row)=>row.issue===20).detail, /completed as cancelled: superseded/)
})

// A CYCLE IS NEVER STARTABLE, and an open/closed test can never see it.
test('a dependency cycle is reported by path and fails the audit', () => {
  const issues = [
    { number: 20, title: 'a', body: depScope('#21') },
    { number: 21, title: 'b', body: depScope('#20') },
  ]
  const result = buildDynamicQueues(issues, [], NOW, [20, 21], {})
  assert.equal(result.dependencyCycles.length, 1)
  assert.deepEqual(result.dependencyCycles[0], [20, 21, 20])
  assert.equal(result.fullyAudited, false, 'an audit with a cycle in it is not a clean audit')
})

test('self-dependency and duplicate dependencies are reported as malformed', () => {
  const selfDep = buildDynamicQueues([{ number: 20, title: 'a', body: depScope('#20') }], [], NOW, [20], {})
  assert.equal(selfDep.malformed.length, 1)
  assert.match(selfDep.malformed[0].reason, /depends on itself/)

  const duplicate = buildDynamicQueues([{ number: 20, title: 'a', body: depScope('#21, 21') }], [], NOW, [20], {})
  assert.match(duplicate.malformed[0].reason, /duplicate dependencies/)
})

// EVERY UNKNOWN IS A BLOCK. The failure being replaced was silence.
test('an unreadable dependency blocks rather than being treated as absent', () => {
  const result = buildDynamicQueues([{ number: 20, title: 'a', body: depScope('#10') }], [], NOW, [20], { 10: { exists: true, unreadable: 'HTTP 500' } })
  assert.deepEqual(result.dispatchable, [])
  assert.match(result.skipped.find((row)=>row.issue===20).detail, /NOT "no dependency"/)
})

// BACKWARD COMPATIBILITY. Callers and fixtures that pass no dependency state keep
// the old open-set behaviour rather than blocking everything.
test('with no dependency state supplied, the old open-set behaviour still applies', () => {
  const result = buildDynamicQueues([{ number: 20, title: 'a', body: depScope('#10') }], [], NOW, [20, 10])
  assert.deepEqual(result.dispatchable, [], 'an open dependency still blocks')
  const released = buildDynamicQueues([{ number: 20, title: 'a', body: depScope('#10') }], [], NOW, [20])
  assert.deepEqual(released.dispatchable, [20])
})

// --- completeWork ----------------------------------------------------------

function completionIo({ comments = [], pr = null, files = [], main = 'main1234', ancestry = true } = {}) {
  const posted = []
  return {
    posted,
    issueComments: () => [...comments, ...posted.map((body)=>({ body }))],
    commentIssue: (_number, body) => { posted.push(body) },
    getPr: () => pr,
    getPrFiles: () => files,
    readRef: () => main,
    // assertMergeCommitInMainHistory reaches for compareCommits; ancestry=false
    // simulates a merge commit that is not actually contained in main.
    compareCommits: () => (ancestry ? { status: 'identical', behind_by: 0 } : { status: 'diverged', behind_by: 3 }),
  }
}

test('completeWork refuses a report whose work_issue does not match --issue', () => {
  assert.throws(() => completeWork({ issue: 5, report: { schema_version: 1, work_issue: 6, outcome: 'cancelled', reason: 'x' } }, completionIo()), /report is for issue #6/)
})

test('completeWork refuses to publish a second record, because completion is immutable', () => {
  const io = completionIo({ comments: [completionComment(mergedRecord(5))] })
  assert.throws(() => completeWork({ issue: 5, report: { schema_version: 1, work_issue: 5, outcome: 'cancelled', reason: 'x' } }, io), /completion is immutable/)
})

test('completeWork publishes an unsuccessful outcome and reads it back', () => {
  const io = completionIo()
  const published = completeWork({ issue: 5, report: { schema_version: 1, work_issue: 5, outcome: 'returned', reason: 'belongs to popdam3' } }, io)
  assert.equal(published.outcome, 'returned')
  assert.equal(io.posted.length, 1)
  assert.match(io.posted[0], /immutable/)
})

// A REPORT IS A CLAIM, NOT EVIDENCE. Every checkable field is re-derived.
test('completeWork refuses a merged report whose pull request is not merged', () => {
  const io = completionIo({ pr: { merged_at: null } })
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), /is not merged/)
})

test('completeWork refuses a merged report whose sha disagrees with GitHub', () => {
  const io = completionIo({ pr: { merged_at: 'x', merge_commit_sha: 'deadbee' } })
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), /does not match GitHub's merge_commit_sha/)
})

test('completeWork refuses a merged report whose migration_versions are wrong', () => {
  const io = completionIo({
    pr: { merged_at: 'x', merge_commit_sha: 'abc1234' },
    files: [{ filename: 'supabase/migrations/20260823120000_a.sql' }],
  })
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), /do not match the versions PR #1 actually added/)
})

test('completeWork refuses a merged report whose commit is not contained in main', () => {
  const io = completionIo({ pr: { merged_at: 'x', merge_commit_sha: 'abc1234' }, ancestry: false })
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), /not contained in the history of main/)
})

test('completeWork publishes a fully proven merged report and reads it back', () => {
  const io = completionIo({ pr: { merged_at: 'x', merge_commit_sha: 'abc1234' }, files: [] })
  const published = completeWork({ issue: 5, report: mergedRecord(5) }, io)
  assert.equal(published.outcome, 'merged')
  assert.equal(io.posted.length, 1)
})

// --activate-review-cutover (issue #1777 handover)

function freshCutoverIo(){const io=reviewIo();io.refs.delete(REVIEW_ACTIVE_CUTOVER_REF);return io}

function seedAssignment(io,{issue,pr,headSha,reviewer,sequence=1}){
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer} issue=${issue} pr=${pr} head=${headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,sha)
  return sha
}

// REGRESSION (issue #1798 round 2, grok-4.6 High #5). `--replace-failed-reviewer`
// does NOT rewrite the assignment ref, so a review that was replaced while live
// still names its FAILED reviewer there. A cutover that read only assignment refs
// would backfill a lease for someone who is not reviewing and leave the reviewer
// who actually is invisible to the busy probe -- the exact blindness activation
// exists to prevent.
test('cutover activation backfills the REPLACEMENT reviewer, not the failed reviewer named on the assignment ref',()=>{
  const io=freshCutoverIo(),headSha='c'.repeat(40)
  io.openPulls=()=>[{number:410,head:{sha:headSha}}]
  seedAssignment(io,{issue:41,pr:410,headSha,reviewer:'grok-4.6'})
  const replacementSha=io.makeOwnerCommit(`db-coordination reviewer-replacement sequence=2 reviewer=glm-5.3 issue=41 pr=410 head=${headSha} failed-sequence=1 prior-sequence=1 failure-ref=${'d'.repeat(40)}`)
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/41-410-${headSha}`,replacementSha)
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  assert.deepEqual(result.backfilled,[{reviewer:'glm-5.3',issue:41,pr:410,headSha,ref:reviewActiveRef('glm-5.3')}])
  assert.equal(io.refs.get(reviewActiveRef('glm-5.3')),replacementSha)
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
})

// M2 (issue #1798 round 3): the test above seeds only the LEGACY unsuffixed
// replacement ref. The shape replaceFailedReviewerOperation actually writes for
// every link after the first is `<issue>-<pr>-<head>-<failedSequence>`, and that
// shape had never been exercised through the cutover at all.
test('cutover activation resolves the replacement written in the real -<failedSequence> ref shape',()=>{
  const io=freshCutoverIo(),headSha='9'.repeat(40)
  io.openPulls=()=>[{number:430,head:{sha:headSha}}]
  seedAssignment(io,{issue:43,pr:430,headSha,reviewer:'grok-4.6'})
  const first=io.makeOwnerCommit(`db-coordination reviewer-replacement sequence=2 reviewer=glm-5.3 issue=43 pr=430 head=${headSha} failed-sequence=1 prior-sequence=1 failure-ref=${'d'.repeat(40)}`)
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/43-430-${headSha}`,first)
  // Replaced a SECOND time: highest failure sequence must win, and the winner is
  // the one written under the suffixed ref name.
  const second=io.makeOwnerCommit(`db-coordination reviewer-replacement sequence=5 reviewer=kimi-k3 issue=43 pr=430 head=${headSha} failed-sequence=2 prior-sequence=2 failure-ref=${'d'.repeat(40)}`)
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/43-430-${headSha}-2`,second)
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  assert.deepEqual(result.backfilled,[{reviewer:'kimi-k3',issue:43,pr:430,headSha,ref:reviewActiveRef('kimi-k3')}])
  assert.equal(io.refs.get(reviewActiveRef('kimi-k3')),second)
  assert.equal(io.refs.has(reviewActiveRef('glm-5.3')),false)
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
})

// REGRESSION (issue #1798 round 3, glm-5.3 High 1). The assignment half of the
// candidate loop refuses an unreadable record; the replacement half used to catch
// the same failure and DISCARD the row. That divergence reintroduced the original
// fail-open: the failed reviewer is backfilled as live and the reviewer who is
// actually reviewing stays invisible to the busy probe.
test('cutover activation REFUSES an unreadable replacement record instead of silently dropping it',()=>{
  const io=freshCutoverIo(),headSha='8'.repeat(40)
  io.openPulls=()=>[{number:440,head:{sha:headSha}}]
  seedAssignment(io,{issue:44,pr:440,headSha,reviewer:'grok-4.6'})
  const junk=io.makeOwnerCommit('db-coordination reviewer-replacement written-by-a-grammar-this-parser-does-not-know')
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/44-440-${headSha}`,junk)
  assert.throws(()=>activateReviewCutover(io),/replacement ref .* is unreadable: .*cutover activation refused/)
  // Nothing may be backfilled or activated on the way out, and the mutex is released.
  assert.equal(io.refs.has(REVIEW_ACTIVE_CUTOVER_REF),false)
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('cutover activation refuses an assignment whose commit identity disagrees with its ref',()=>{
  const io=freshCutoverIo(),headSha='6'.repeat(40)
  io.openPulls=()=>[{number:460,head:{sha:headSha}}]
  const wrong=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=grok-4.6 issue=46 pr=461 head=${headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/46-460-${headSha}`,wrong)
  assert.throws(()=>activateReviewCutover(io),/assignment ref .* disagrees with its commit record .*cutover activation refused/)
  assert.equal(io.refs.has(REVIEW_ACTIVE_CUTOVER_REF),false)
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('cutover activation refuses a replacement whose commit identity disagrees with its ref',()=>{
  const io=freshCutoverIo(),headSha='5'.repeat(40)
  io.openPulls=()=>[{number:470,head:{sha:headSha}}]
  seedAssignment(io,{issue:47,pr:470,headSha,reviewer:'grok-4.6'})
  const wrong=io.makeOwnerCommit(`db-coordination reviewer-replacement sequence=2 reviewer=glm-5.3 issue=47 pr=471 head=${headSha} failed-sequence=1 prior-sequence=1 failure-ref=${'d'.repeat(40)}`)
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/47-470-${headSha}`,wrong)
  assert.throws(()=>activateReviewCutover(io),/replacement ref .* disagrees with its commit record .*cutover activation refused/)
  assert.equal(io.refs.has(REVIEW_ACTIVE_CUTOVER_REF),false)
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
  assert.equal(io.refs.has(reviewActiveRef('glm-5.3')),false)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

// Same fail-open, reached the other way: production readReviewRecords returns
// `{sha, commit:{message}}` whose `commit` key is TRUTHY even when GraphQL gave
// back no message. Testing `record.commit` rather than the message let an empty
// message through as if it had been read.
test('cutover activation does not accept a review record whose commit carries no message',()=>{
  const io=freshCutoverIo(),headSha='7'.repeat(40)
  io.openPulls=()=>[{number:450,head:{sha:headSha}}]
  const assignmentSha=seedAssignment(io,{issue:45,pr:450,headSha,reviewer:'grok-4.6'})
  let fellBack=false
  io.readReviewRecords=(refs)=>new Map(refs.map((ref)=>[ref,{sha:io.refs.get(ref),commit:{message:null}}]))
  const rawGetCommit=io.getCommit
  io.getCommit=(sha)=>{if(sha===assignmentSha)fellBack=true;return rawGetCommit(sha)}
  const result=activateReviewCutover(io)
  assert.equal(fellBack,true,'a message-less record must fall back to the per-ref commit read, not be treated as read')
  assert.deepEqual(result.backfilled,[{reviewer:'grok-4.6',issue:45,pr:450,headSha,ref:reviewActiveRef('grok-4.6')}])
})

// REGRESSION (issue #1798 round 2). The paged listing must REFUSE past its page
// ceiling rather than silently return a truncated view of the review history --
// a short read here reads as "no live review", which is the fail-open this
// activation exists to avoid.
test('cutover activation fails closed when the ref listing refuses as possibly truncated',()=>{
  const io=freshCutoverIo(),headSha='f'.repeat(40)
  io.openPulls=()=>[{number:420,head:{sha:headSha}}]
  seedAssignment(io,{issue:42,pr:420,headSha,reviewer:'grok-4.6'})
  io.listReviewRefsPaged=()=>{throw new LaneError(`refs/db-review-assignments exceeded ${REVIEW_REF_PAGE_LIMIT} pages of 100 refs; refusing a possibly truncated reviewer audit`)}
  assert.throws(()=>activateReviewCutover(io),/refusing a possibly truncated reviewer audit/)
  assert.equal(io.refs.has(REVIEW_ACTIVE_CUTOVER_REF),false)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('cutover activation is idempotent and performs no writes once already active',()=>{
  const io=reviewIo(),before=[...io.refs.entries()]
  const result=activateReviewCutover(io)
  assert.deepEqual(result,{activated:false,alreadyActive:true,cutoverSha:'cutover-complete',backfilled:[]})
  assert.deepEqual([...io.refs.entries()],before)
})

test('cutover activation with no open PRs creates the cutover ref with no backfill',()=>{
  const io=freshCutoverIo()
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  assert.deepEqual(result.backfilled,[])
  assert.equal(io.refs.get(REVIEW_ACTIVE_CUTOVER_REF),result.cutoverSha)
})

test('cutover activation backfills the active lease for a pre-cutover live review before creating the cutover ref',()=>{
  const io=freshCutoverIo(),headSha='a'.repeat(40)
  io.openPulls=()=>[{number:109,head:{sha:headSha}}]
  seedAssignment(io,{issue:9,pr:109,headSha,reviewer:'grok-4.6'})
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  assert.deepEqual(result.backfilled,[{reviewer:'grok-4.6',issue:9,pr:109,headSha,ref:reviewActiveRef('grok-4.6')}])
  assert.ok(io.refs.has(reviewActiveRef('grok-4.6')))
  assert.ok(io.refs.has(REVIEW_ACTIVE_CUTOVER_REF))
})

test('cutover activation skips a pre-cutover assignment that already has a verdict',()=>{
  const io=freshCutoverIo(),headSha='b'.repeat(40)
  io.openPulls=()=>[{number:110,head:{sha:headSha}}]
  seedAssignment(io,{issue:10,pr:110,headSha,reviewer:'grok-4.6'})
  io.getIssueComments=()=>[{body:`APPROVE ${headSha}`,commit_id:headSha,author_association:'OWNER'}]
  const result=activateReviewCutover(io)
  assert.deepEqual(result.backfilled,[])
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
})

// REGRESSION (issue #1822, glm-5.3 sequence 524 High). The BATCHED verdict
// check -- the path production takes whenever readReviewStates is available --
// carried its own anywhere-in-body verdict test long after every other consumer
// moved to the shared opening-line predicate. A head-quoting progress note that
// merely CONTAINS the word "approve" scored as a finished verdict, so activation
// skipped creating that reviewer's protective lease and the busy probe went
// blind: the double-assignment hazard this activation exists to prevent, failing
// silently. Nothing covered the batched path's verdict logic at all.
function batchedStatesIo(io,{issue,pr,headSha,evidence}){
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence}]))
  return {issue,pr,headSha}
}

test('cutover activation on the BATCHED path does not read head-quoting progress prose as a verdict',()=>{
  const io=freshCutoverIo(),headSha='e'.repeat(40)
  io.openPulls=()=>[{number:112,head:{sha:headSha}}]
  seedAssignment(io,{issue:12,pr:112,headSha,reviewer:'grok-4.6'})
  // A real progress note in the shape this repository has already produced
  // twice: the head SHA, and the verdict word mid-sentence rather than opening
  // a line. There is no verdict here, so the lease MUST be created.
  batchedStatesIo(io,{issue:12,pr:112,headSha,evidence:[
    {body:`Still reviewing ${headSha}; I expect to approve once the fixture lands.`,commit_id:null,state:null},
  ]})
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  assert.deepEqual(result.backfilled,[{reviewer:'grok-4.6',issue:12,pr:112,headSha,ref:reviewActiveRef('grok-4.6')}])
  assert.ok(io.refs.has(reviewActiveRef('grok-4.6')))
})

// The other half: the batched path must still SEE a real verdict. Without this,
// the test above could be satisfied by a predicate that never returns true.
test('cutover activation on the BATCHED path still skips an assignment with a real opening-line verdict',()=>{
  const io=freshCutoverIo(),headSha='f'.repeat(40)
  io.openPulls=()=>[{number:113,head:{sha:headSha}}]
  seedAssignment(io,{issue:13,pr:113,headSha,reviewer:'grok-4.6'})
  batchedStatesIo(io,{issue:13,pr:113,headSha,evidence:[
    {body:`VERDICT: APPROVE\n\nReviewed at ${headSha}.`,commit_id:null,state:null,author_association:'OWNER'},
  ]})
  const result=activateReviewCutover(io)
  assert.deepEqual(result.backfilled,[])
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
})

// And the conditional-approval rule reaches the batched path too: "APPROVE WITH
// CONDITIONS" withholds, so the reviewer is still live and still needs its lease.
test('cutover activation on the BATCHED path treats APPROVE WITH CONDITIONS as no verdict',()=>{
  const io=freshCutoverIo(),headSha='1'.repeat(40)
  io.openPulls=()=>[{number:114,head:{sha:headSha}}]
  seedAssignment(io,{issue:14,pr:114,headSha,reviewer:'grok-4.6'})
  batchedStatesIo(io,{issue:14,pr:114,headSha,evidence:[
    {body:`APPROVE WITH CONDITIONS\n\nReviewed at ${headSha}.`,commit_id:null,state:null},
  ]})
  const result=activateReviewCutover(io)
  assert.equal(result.backfilled.length,1)
  assert.ok(io.refs.has(reviewActiveRef('grok-4.6')))
})

test('cutover activation retried after success is idempotent and repeats no backfill',()=>{
  const io=freshCutoverIo(),headSha='c'.repeat(40)
  io.openPulls=()=>[{number:111,head:{sha:headSha}}]
  seedAssignment(io,{issue:11,pr:111,headSha,reviewer:'glm-5.3'})
  const first=activateReviewCutover(io)
  const second=activateReviewCutover(io)
  assert.equal(first.activated,true)
  assert.deepEqual(second,{activated:false,alreadyActive:true,cutoverSha:first.cutoverSha,backfilled:[]})
})

test('cutover activation fails closed when an open PR head SHA cannot be proved exact',()=>{
  const io=freshCutoverIo()
  io.openPulls=()=>[{number:112,head:{sha:'not-a-sha'}}]
  assert.throws(()=>activateReviewCutover(io),/40-character head SHA/)
  assert.equal(io.refs.has(REVIEW_ACTIVE_CUTOVER_REF),false)
})

test('cutover activation fails closed on an assignment naming an unrecognized reviewer',()=>{
  const io=freshCutoverIo(),headSha='d'.repeat(40)
  io.openPulls=()=>[{number:113,head:{sha:headSha}}]
  seedAssignment(io,{issue:12,pr:113,headSha,reviewer:'not-a-real-reviewer'})
  assert.throws(()=>activateReviewCutover(io),/unrecognized reviewer/)
  assert.equal(io.refs.has(REVIEW_ACTIVE_CUTOVER_REF),false)
})

test('cutover activation requires openPulls and listRefs to avoid an unproven audit',()=>{
  const io=freshCutoverIo();delete io.openPulls
  assert.throws(()=>activateReviewCutover(io),/requires openPulls and listRefs/)
})

// REGRESSION (issue #1798, glm-5.3 review at d91857e). Every test above uses
// an in-memory fake whose io methods never touch the real wire-budget
// accounting, so all of them passed while activation was UNCOMPLETABLE
// against real GitHub the moment there was an actual live review to
// backfill -- the exact case this feature exists for. This test routes every
// GitHub-shaped call through the real `runGitHubCommand` budget counter, the
// same way 'complete assignment stays inside the real wire-attempt budget'
// and 'complete replacement stays inside the real wire-attempt budget' do
// for the other two review operations, and exercises the one scenario those
// two counterparts never covered for cutover activation: a live review
// actually in progress, which is what needs to be found and backfilled.
test('cutover activation with a live in-progress review stays inside the real wire-attempt budget',()=>{
  const io=freshCutoverIo(),headSha='1'.repeat(40)
  io.openPulls=()=>[{number:400,head:{sha:headSha}}]
  seedAssignment(io,{issue:40,pr:400,headSha,reviewer:'grok-4.6'})
  const rawGetCommit=io.getCommit
  let attempts=0;const labels=[]
  const wire=(n=1,label='wire')=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;labels.push(label);return '{}'}})}
  // PRODUCTION-FAITHFUL COSTS (issue #1798 round 2, grok-4.6 at 53abae0). The
  // first version of this test charged a friendlier price than githubIo really
  // pays, which is why it passed while activation was still broken on the real
  // wire. Each cost below is the real one:
  //   getRateLimit        -> 2 (REST rate_limit + GraphQL rateLimit)
  //   readReviewRecords   -> 2 (GraphQL for explicit refs + REST prefix list),
  //                          and `.matching` rows carry NO commit message
  //   listReviewRefsPaged -> 1 per 100-ref page
  //   readActiveReviewLeases -> 1, and it warms reviewCommitBase, so
  //   makeOwnerCommit     -> 1 after it (3 only when the base is still cold)
  io.getRateLimit=()=>{wire(2,'quota');return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire(1,'activeLeases');return new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:rawGetCommit(sha)}]))}
  io.readReviewStates=(leases)=>{wire(1,'states');return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>{wire(1,'readReviewRefs');return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  // These namespaces are append-only across the repository's WHOLE review
  // history, so a fixture holding two refs would charge one page while the real
  // repository charges four and two (370 assignment refs / 106 replacement refs,
  // measured 2026-08-29). Charging the fixture one page apiece is precisely the
  // friendlier-than-production fiction that let the previous version of this
  // test pass over a broken activation, so the real page counts are charged here.
  const REAL_REF_PAGES={[REVIEW_ASSIGNMENT_REF_PREFIX]:4,[REVIEW_REPLACEMENT_REF_PREFIX]:2}
  io.listReviewRefsPaged=(prefix)=>{wire(REAL_REF_PAGES[prefix]??1,`listReviewRefsPaged:${prefix}`);return [...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha}))}
  io.readReviewRecords=(refs,prefix)=>{
    assert.ok(refs.length,'production readReviewRecords builds an EMPTY GraphQL selection set for an empty ref list, which GitHub rejects outright')
    wire(prefix?2:1,'readReviewRecords')
    const result=new Map(refs.map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}))
    // Production attaches NO commit message to prefix matches -- they come from
    // a separate REST listing. Modelling that is the whole point of this test.
    Object.defineProperty(result,'matching',{value:prefix?[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})):[]})
    return result
  }
  for(const name of ['readRef','listRefs','getCommit','getPr','getIssue','getIssueComments','getPrReviews','createRef','updateRef','deleteRef','openPulls']){
    const fn=io[name];if(typeof fn==='function')io[name]=(...args)=>{wire(1,`${name}:${String(args[0]??'')}`);return fn(...args)}
  }
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(message)=>{wire(1,'commit');return make(message)}
  let result
  try{result=activateReviewCutover(io)}catch(error){throw new Error(`${error.message}; used ${attempts} wire attempts; calls=${labels.join(',')}`)}
  assert.equal(result.activated,true)
  assert.deepEqual(result.backfilled,[{reviewer:'grok-4.6',issue:40,pr:400,headSha,ref:reviewActiveRef('grok-4.6')}])
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`used ${attempts} wire attempts; calls=${labels.join(',')}`)
})

// ---------------------------------------------------------------------------
// Second-reviewer slots (--review-slot). Default slot 1 must be byte-for-byte
// today's behaviour; slot 2 must land a genuinely different, non-busy
// provider and stay idempotent on retry, same as slot 1 always has.
// ---------------------------------------------------------------------------

test('slot 1 is the unchanged default: omitting --review-slot behaves exactly as before',()=>{
  const io=reviewIo(),request={issue:200,pr:300,headSha:'a'.repeat(40)}
  const implicit=assignNextReviewer(request,io)
  assert.equal(implicit.slot,1)
  assert.equal(implicit.reviewer,'grok-4.6')
  const explicit=assignNextReviewer({...request,slot:1},io)
  assert.deepEqual(explicit,implicit)
})

test('slot 2 requires slot 1 to already be assigned for this exact head',()=>{
  const io=reviewIo()
  assert.throws(()=>assignNextReviewer({issue:201,pr:301,headSha:'b'.repeat(40),slot:2},io),/slot 2 requires slot 1/)
})

test('slot 2 lands a different provider than slot 1, and is idempotent on retry',()=>{
  const io=reviewIo(),request={issue:202,pr:302,headSha:'c'.repeat(40)}
  const first=assignNextReviewer(request,io)
  const second=assignNextReviewer({...request,slot:2},io)
  assert.equal(second.slot,2)
  assert.notEqual(second.reviewer,first.reviewer)
  const retry=assignNextReviewer({...request,slot:2},io)
  assert.deepEqual(retry,second)
  // Retrying slot 1 for the same head must still be untouched and unchanged.
  assert.deepEqual(assignNextReviewer(request,io),first)
})

test('slot 2 skips a provider that is busy on unrelated live review work',()=>{
  const io=reviewIo(),request={issue:203,pr:303,headSha:'d'.repeat(40)}
  const first=assignNextReviewer(request,io) // grok-4.6
  // Occupy glm-5.3 (the round-robin's next name) with unrelated live work so
  // it is neither slot 1's reviewer nor free for slot 2.
  io.getPr=(number)=>Number(number)===999?{number:999,state:'open',head:{sha:'e'.repeat(40)}}:{number:Number(number),state:'open',head:{sha:request.headSha}}
  assignNextReviewer({issue:998,pr:999,headSha:'e'.repeat(40)},io) // consumes glm-5.3
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:request.headSha}})
  const second=assignNextReviewer({...request,slot:2},io)
  assert.notEqual(second.reviewer,first.reviewer)
  assert.notEqual(second.reviewer,'glm-5.3')
})

test('slot 2 never lands on a provider already assigned slot 1 for this exact head, across the whole roster',()=>{
  const io=reviewIo()
  for(let n=0;n<ACTIVE_REVIEWERS.length;n+=1){
    const request={issue:900+n,pr:1900+n,headSha:`${n}`.repeat(40).slice(0,40).padEnd(40,'0')}
    const first=assignNextReviewer(request,io)
    const second=assignNextReviewer({...request,slot:2},io)
    assert.notEqual(second.reviewer,first.reviewer,`sequence starting at reviewer ${first.reviewer} still picked itself for slot 2`)
  }
})

test('slot 2 keeps its own ref namespace: it never disturbs or is confused with slot 1 records',()=>{
  const io=reviewIo(),request={issue:204,pr:304,headSha:'f'.repeat(40)}
  const first=assignNextReviewer(request,io)
  const second=assignNextReviewer({...request,slot:2},io)
  assert.ok(io.refs.has(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`))
  assert.ok(io.refs.has(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-slot2`))
  assert.deepEqual(assignNextReviewer(request,io),first)
  assert.deepEqual(assignNextReviewer({...request,slot:2},io),second)
})

test('an invalid review slot is refused',()=>{
  const io=reviewIo()
  assert.throws(()=>assignNextReviewer({issue:205,pr:305,headSha:'a'.repeat(40),slot:0},io),/positive integer/)
  assert.throws(()=>assignNextReviewer({issue:205,pr:305,headSha:'a'.repeat(40),slot:1.5},io),/positive integer/)
})

test('retrying a slot-2 assignment must still refuse a reviewer that is no longer independent from the live orchestrator',()=>{
  // Occupy grok-4.6, glm-5.3 and kimi-k3 with unrelated live review work so the
  // rotation's next two picks for our real request land on muse (slot 1) then
  // codex-gpt-5.6-sol (slot 2), while the orchestrator engine is still 'claude'
  // and codex is eligible.
  const io=reviewIo()
  for(let n=0;n<3;n++)assignNextReviewer({issue:600+n,pr:700+n,headSha:`${n}`.repeat(40)},io)
  const request={issue:206,pr:306,headSha:'9'.repeat(40)}
  const first=assignNextReviewer(request,io)
  assert.equal(first.reviewer,'muse-spark-1.2-contributor')
  const second=assignNextReviewer({...request,slot:2},io)
  assert.equal(second.reviewer,'codex-gpt-5.6-sol')
  // A live lease for codex now exists for this exact head/slot. A retry of the
  // same slot-2 request must re-check eligibility every time, not just on a
  // fresh assignment -- if the orchestrator engine has since become Codex,
  // handing back the still-live Codex assignment on retry would let a Codex
  // orchestrator review its own work.
  io.resolveOrchestratorEngine=()=> 'codex'
  assert.throws(()=>assignNextReviewer({...request,slot:2},io),/orchestrator-conflicting reviewer codex-gpt-5\.6-sol/)
})

// REGRESSION (issue #1798, glm-5.3 review at d91857e). `resolveSlotOneReviewer`
// used to spend up to three real wire requests (listRefs, readRef, getCommit)
// BEFORE the mutex is even acquired, on every fresh slot-2 assignment -- and
// that preflight cost is what blew slot 2's own 19-request budget on real
// GitHub every time, independent of everything else in the operation. Same
// counter-routing technique as 'complete assignment stays inside the real
// wire-attempt budget' above; that test never covered slot 2 at all.
test('complete slot-2 assignment stays inside the real wire-attempt budget',()=>{
  const io=reviewIo(),request={issue:2200,pr:2300,headSha:'a'.repeat(40)}
  const first=assignNextReviewer(request,io)
  const rawGetCommit=io.getCommit
  const active=new Map([[reviewActiveRef(first.reviewer),{sha:io.refs.get(reviewActiveRef(first.reviewer)),commit:rawGetCommit(io.refs.get(reviewActiveRef(first.reviewer)))}]])
  const states=new Map([[`${request.issue}:${request.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:request.headSha}},evidence:[]}]])
  let attempts=0
  const wire=(n=1)=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;return '{}'}})}
  // PRODUCTION-FAITHFUL COSTS (issue #1798 round 3, glm-5.3 High 2). This fixture
  // used to charge getRateLimit and readReviewRecords ONE request each. Production
  // pays TWO for each -- getRateLimit is a REST rate_limit plus a GraphQL rateLimit,
  // and readReviewRecords is a GraphQL read for the explicit refs plus a separate
  // REST listing for the prefix. Undercharging them by one apiece is what made this
  // test pass over a slot-2 path that could not actually clear its own capacity
  // precheck on the real wire. It is the second time on this branch that a test
  // charged less than the real system does, so the prices are spelled out here.
  io.getRateLimit=()=>{wire(2);return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire();return active}
  io.readReviewStates=()=>{wire();return states}
  io.readReviewRefs=(refs)=>{wire();return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  io.readReviewRecords=(refs,prefix)=>{wire(prefix?2:1);const result=new Map(refs.map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}));
    // Production attaches NO commit message to prefix matches: they come from a
    // separate REST listing whose own comment says every caller falls back to
    // io.getCommit(row.sha). Handing them a message here is the friendlier shape.
    Object.defineProperty(result,'matching',{value:[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha}))});return result}
  for(const name of ['readRef','listRefs','getCommit','getPr','getIssue','getIssueComments','getPrReviews','createRef','updateRef','deleteRef']){
    const fn=io[name];io[name]=(...args)=>{wire();return fn(...args)}
  }
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(message)=>{wire();return make(message)}
  // The ceiling this asserts against is #1813's, which this branch defers to.
  // #1813 derived its pre-mutex figure as 9 because resolveSlotOneReviewer cost
  // three calls there. On this branch that resolve is BATCHED into one
  // readReviewRecords, which costs 2, so the honest pre-mutex figure is 8.
  // Taking #1813's mutex placement and this branch's resolve while keeping
  // #1813's arithmetic is half-applied accounting, and it went green.
  // slot 2 pays 8 requests BEFORE the mutex (the slot-1 preflight plus the
  // extra resolveSlotOneReviewer read), and then must still be able to reserve
  // REVIEW_MUTEX_SECTION_RESERVE for the whole mutex-held section. The entry
  // gate is what that sum has to clear, so that sum is the honest cost.
  // Asserted in BOTH directions rather than picking whichever outcome the
  // current constant makes convenient: under a ceiling that cannot hold the
  // operation it must be refused CLEANLY, before the mutex is taken -- never by
  // hitting the hard wall partway through.
  const honestCost=8+REVIEW_MUTEX_SECTION_RESERVE
  if(REVIEW_OPERATION_REQUEST_LIMIT<honestCost){
    assert.throws(()=>assignNextReviewer({...request,slot:2},io),/cannot fit \d+ remaining requests inside the \d+-request budget; refused before mutex acquisition/)
    assert.equal(io.refs.has(MUTEX_REF),false,'a refused slot-2 assignment must not have taken the mutex')
    assert.ok(attempts<honestCost,`refusal must happen before the budget is spent, used ${attempts}`)
    return
  }
  let result
  try{result=assignNextReviewer({...request,slot:2},io)}catch(error){throw new Error(`${error.message}; used ${attempts} wire attempts so far`)}
  assert.equal(result.slot,2)
  assert.notEqual(result.reviewer,first.reviewer)
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`used ${attempts} wire attempts`)
  assert.ok(attempts<=honestCost,`used ${attempts} wire attempts, more than the ${honestCost} this operation is documented to cost`)
})

// REGRESSION (issue #1798, glm-5.3 review at d91857e, medium finding). A
// slot-2 durable assignment ref carries a `-slot2` suffix after the exact
// issue-pr-head tuple. The cutover audit used to match refs with a bare
// `endsWith('-${number}-${headSha}')`, so a slot-2 assignment's ref never
// matched and its live lease was silently never backfilled.
// REGRESSION (issue #1798 round 6, grok-4.6 blocking finding). The two cases
// above are each covered alone -- a replacement with no slot 2, and a slot 2
// with no replacement -- and NOTHING combined them. Combined is where the
// original fail-open survives: the cutover gathers replacements PER PULL
// REQUEST, not per slot, so one shared list is applied to every assignment on
// that PR. A slot-1 replacement then wins the slot-2 assignment too, the
// slot-2 reviewer never gets a lease, and the busy probe goes blind to a
// provider that is actually reviewing -- the double-assignment hazard this
// whole activation exists to prevent.
//
// PR #1838 made the replacement WRITER slot-aware, which is a different half of
// the same problem. The reader is still per-PR, and legacy unsuffixed slot-1
// replacement refs are deliberately still honoured, so this state is reachable
// on today's refs.
test('a slot-1 replacement must not steal the slot-2 assignment during cutover',()=>{
  const io=freshCutoverIo(),headSha='7'.repeat(40)
  io.openPulls=()=>[{number:440,head:{sha:headSha}}]
  // Slot 1: grok-4.6 assigned, then genuinely replaced by glm-5.3.
  seedAssignment(io,{issue:44,pr:440,headSha,reviewer:'grok-4.6'})
  const replacementSha=io.makeOwnerCommit(`db-coordination reviewer-replacement sequence=9 reviewer=glm-5.3 issue=44 pr=440 head=${headSha} failed-sequence=1 prior-sequence=1 failure-ref=${'d'.repeat(40)}`)
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/44-440-${headSha}`,replacementSha)
  // Slot 2: kimi-k3, live, never replaced. Its own namespace, untouched.
  const slotTwoSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=3 reviewer=kimi-k3 issue=44 pr=440 head=${headSha} slot=2`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/44-440-${headSha}-slot2`,slotTwoSha)
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  const leased=result.backfilled.map((row)=>row.reviewer).sort()
  assert.deepEqual(leased,['glm-5.3','kimi-k3'],`both live reviewers must be leased; got ${leased.join(',')}`)
  assert.equal(io.refs.get(reviewActiveRef('kimi-k3')),slotTwoSha,'slot 2 must be leased under its OWN assignment commit, not the slot-1 replacement')
  assert.equal(io.refs.get(reviewActiveRef('glm-5.3')),replacementSha)
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false,'the replaced slot-1 reviewer is not reviewing')
})

test('cutover activation backfills a slot-2 live review, not just slot 1',()=>{
  const io=freshCutoverIo(),headSha='2'.repeat(40)
  io.openPulls=()=>[{number:401,head:{sha:headSha}}]
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=glm-5.3 issue=41 pr=401 head=${headSha} slot=2`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/41-401-${headSha}-slot2`,sha)
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  assert.deepEqual(result.backfilled,[{reviewer:'glm-5.3',issue:41,pr:401,headSha,ref:reviewActiveRef('glm-5.3')}])
  assert.ok(io.refs.has(reviewActiveRef('glm-5.3')))
})

// AGENTS.md section 4 rule 2 is merge-first: merge, rehearse on preview from the
// merged commit, then promote. Before this test the lane only ever looked at
// `state=open` pulls and hardcoded merged:false, so the POST_MERGE_REHEARSAL route
// was unreachable and every merged claim was stranded without rehearsal proof.
function mergedRehearsalIo(){
  const version='20260828232207'
  const migration=`supabase/migrations/${version}_wwe.sql`
  const claim={number:1805,title:'CLAIM: #1769 wwe tables',body:[
    '```db-claim','version: '+version,'objects:','  - table plm.wwe_property','```','',
    '```db-author-lease','owner: agent/issue-1769','branch: issue-1769-wwe-tables',
    'worktree: C:/repos/x','expires_at: 2099-01-01T00:00:00Z','```'].join('\n')}
  const head='a'.repeat(40), mergeSha='b'.repeat(40), mainSha='d'.repeat(40)
  const files={[migration]:'create table plm.wwe_property();','config/orchestrator-global-invalidators-v1.json':'{"schema_version":1,"files":[]}'}
  return {head,mergeSha,mainSha,version,io:{
    openClaims:()=>[claim],
    openPulls:()=>[],
    branchPulls:(branch)=>branch==='issue-1769-wwe-tables'?[{number:1809,head:{ref:branch,sha:head},base:{sha:'c'.repeat(40)},merged_at:'2026-08-29T00:32:19Z',merge_commit_sha:mergeSha}]:[],
    mergeCommitInMain:(sha)=>sha===mergeSha,
    getPrFiles:()=>[{filename:migration,status:'added'}],
    getFileAt:(file)=>{if(!(file in files))throw new LaneError(`missing ${file}`);return files[file]},
    treeFiles:()=>[migration],
    getIssue:()=>({body:['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 1','writes:','  - table plm.wwe_property','```'].join(String.fromCharCode(10))}),
    previewGateProof:()=>({full_ci_success:true,review_approved:true,dependency_closure_complete:true}),
    mainSha:()=>mainSha,
    previewLedger:()=>({versions:[]}),
  }}
}

function immutablePreviewApplyIo({sourcePr=1809,artifactRunId='33308168016',mergeCommitSha='b'.repeat(40)}={}){
  const runId='33308168016',headSha='75a6e35e46a79af7c059836a64a5b621ac79404a',version='20260828232207'
  return {
    issueComments:()=>[{body:`Original apply: https://github.com/u2giants/shared-db/actions/runs/${runId}`}],
    previewApplyRun:()=>({
      run:{id:Number(runId),path:'.github/workflows/shared-supabase-migrations.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',run_attempt:1,head_sha:headSha},
      artifacts:{total_count:1,artifacts:[{name:`preview-migration-apply-${headSha}`,digest:`sha256:${'d'.repeat(64)}`,expired:false,workflow_run:{id:Number(artifactRunId),head_sha:headSha}}]},
      logs:[`Bounded apply ${JSON.stringify({allowlist:[version],appliedCommit:headSha,mergeCommitSha,previewProjectRef:'mvpkijzfmfcxhnzqogzs',rehearsalMode:'merged-main-rehearsal',runId:Number(runId),schema:'shared-db-preview-instance-binding/v1',sourcePr})}`,`preview\tReport the preview ledger delta\t2026-08-30T00:00:00Z ### Preview ledger delta`,`preview\tReport the preview ledger delta\t2026-08-30T00:00:00Z - added: ${version}`,'preview\tReport the preview ledger delta\t2026-08-30T00:00:00Z - removed: (none)'].join('\n'),
    }),
  }
}

function immutablePreviewReconciliationIo({sourcePr=1748,replacement='20260830013942',artifactRunId='33307904277',relation='ahead'}={}){
  const runId='33307904277',headSha='75a6e35e46a79af7c059836a64a5b621ac79404a',orphan='20260828113920'
  return {
    issueComments:()=>[{body:`Governed ledger reconciliation: https://github.com/u2giants/shared-db/actions/runs/${runId}`}],
    compareCommits:()=>({status:relation}),
    previewApplyRun:()=>({
      run:{id:Number(runId),path:'.github/workflows/preview-ledger-orphan-reconciliation.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',run_attempt:1,head_sha:headSha},
      artifacts:{total_count:1,artifacts:[{name:`preview-ledger-orphan-reconciliation-${orphan}`,expired:false,workflow_run:{id:Number(artifactRunId),head_sha:headSha}}]},
      logs:[`ISSUE: 1722`,`SOURCE_PR: ${sourcePr}`,`ORPHAN: ${orphan}`,`REPLACEMENT: ${replacement}`,`PREVIEW LEDGER RECONCILIATION APPLY OK: removed=${orphan} replacement=${replacement}`].join('\n'),
    }),
  }
}

test('immutable original preview-apply evidence validates only the exact run',()=>{
  const input={issue:1769,pr:1809,versions:['20260828232207'],mergeCommitSha:'b'.repeat(40)}
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,immutablePreviewApplyIo()),{type:'preview-apply',run_id:'33308168016'})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,{...immutablePreviewApplyIo(),issueComments:()=>[]}),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,immutablePreviewApplyIo({artifactRunId:'33308168017'})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,immutablePreviewApplyIo({mergeCommitSha:'c'.repeat(40)})),/found 0/)
  const labelled=immutablePreviewApplyIo()
  labelled.issueComments=()=>[{body:'- apply `33308168016` — success'}]
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,labelled),{type:'preview-apply',run_id:'33308168016'})
  labelled.issueComments=()=>[{body:'unrelated run `33308168016` succeeded'}]
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,labelled),/found 0/)
  const noDelta=immutablePreviewApplyIo()
  noDelta.previewApplyRun=()=>({...immutablePreviewApplyIo().previewApplyRun(),logs:immutablePreviewApplyIo().previewApplyRun().logs.replace(`- added: 20260828232207`,'- added: (none)')})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,noDelta),/found 0/)
  const spoofedDelta=immutablePreviewApplyIo()
  spoofedDelta.previewApplyRun=()=>{const evidence=immutablePreviewApplyIo().previewApplyRun();evidence.logs=evidence.logs.replace('preview\tReport the preview ledger delta\t2026-08-30T00:00:00Z - added: 20260828232207','preview\tEarlier unrelated step\t2026-08-30T00:00:00Z - added: 20260828232207\npreview\tReport the preview ledger delta\t2026-08-30T00:00:00Z - added: 20260828232208');return evidence}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,spoofedDelta),/found 0/)
  const noDigest=immutablePreviewApplyIo()
  noDigest.previewApplyRun=()=>{const evidence=immutablePreviewApplyIo().previewApplyRun();delete evidence.artifacts.artifacts[0].digest;return evidence}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,noDigest),/found 0/)
})

test('immutable preview-ledger reconciliation evidence validates the renamed current version without replay',()=>{
  const input={issue:1722,pr:1748,versions:['20260830013942'],mergeCommitSha:'5'.repeat(40)}
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,immutablePreviewReconciliationIo()),{type:'preview-ledger-reconciliation',run_id:'33307904277',orphan_version:'20260828113920',replacement_version:'20260830013942'})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,immutablePreviewReconciliationIo({sourcePr:9999})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,immutablePreviewReconciliationIo({replacement:'20260830013943'})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,immutablePreviewReconciliationIo({artifactRunId:'33307904278'})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,immutablePreviewReconciliationIo({relation:'diverged'})),/found 0/)
  const reset=immutablePreviewReconciliationIo({replacement:'20260828113920'})
  assert.throws(()=>validateOriginalPreviewApplyEvidence({...input,versions:['20260828113920']},reset),/found 0/)
})

test('an already-applied merged claim receives validated evidence before route selection',()=>{
  const {io,mainSha,version}=mergedRehearsalIo()
  Object.assign(io,immutablePreviewApplyIo())
  io.previewLedger=()=>({versions:[version]})
  const candidate=deriveLivePreviewCandidate(1769,io)
  assert.equal(candidate.route,'historical_rebind')
  assert.equal(candidate.route_context,mainSha)
  assert.equal(candidate.manifest.historical_preview_original_run_map,'20260828232207:33308168016')
})

test('a merged claim still reaches the post-merge rehearsal route instead of being stranded',()=>{
  const {io,mainSha,head,version}=mergedRehearsalIo()
  const candidate=deriveLivePreviewCandidate(1769,io)
  assert.equal(candidate.route,'merged_rehearsal')
  assert.equal(candidate.pr,1809)
  assert.equal(candidate.head_sha,head)
  // commit_sha is the CURRENT MAIN TIP -- shared-supabase-migrations asserts
  // `git rev-parse origin/main` equals it. The fixture deliberately keeps the main
  // tip different from the merge commit so anchoring at the wrong one fails here.
  assert.equal(candidate.route_context,mainSha)
  assert.equal(candidate.manifest.commit_sha,mainSha)
  assert.equal(candidate.manifest.merged_preview_source_pr,'1809')
  assert.equal(candidate.manifest.preview_allowlist,version)
  // "merged_preview_source_pr replaces claim_pr ... do not name both" -- naming
  // either claim field alongside it makes the workflow refuse the dispatch outright.
  assert.equal('claim_pr' in candidate.manifest,false)
  assert.equal('claim_head_sha' in candidate.manifest,false)
})

test('a single closed claim recovers only the merged-rehearsal route (issue #1852)',()=>{
  const {io,mainSha,version}=mergedRehearsalIo()
  const claim=io.openClaims()[0]
  const unrelated={...claim,number:77,title:'CLAIM: #99 supersedes #100 historical cleanup',state:'closed'}
  const dormant={...claim,number:1839,title:'CLAIM: issue #1769 — replacement branch that produced no pull request',body:claim.body.replace('issue-1769-wwe-tables','claude/wwe-tables-1769'),state:'closed'}
  const recovered=githubIo.closedClaimsForWork(1769,()=>[unrelated,dormant,{...claim,state:'closed'}])
  assert.deepEqual(recovered.map((row)=>row.number),[1839,1805])
  io.openClaims=()=>[]
  io.closedClaimsForWork=()=>recovered
  const candidate=deriveLivePreviewCandidate(1769,io)
  assert.equal(candidate.route,'merged_rehearsal')
  assert.equal(candidate.route_context,mainSha)
  assert.equal(candidate.manifest.preview_allowlist,version)
  assert.equal('claim_pr' in candidate.manifest,false)
  assert.equal('claim_head_sha' in candidate.manifest,false)
})

test('closed-claim recovery refuses ambiguity, an open PR, and a merge outside main',()=>{
  const {io}=mergedRehearsalIo()
  const claim=io.openClaims()[0]
  io.openClaims=()=>[]
  io.closedClaimsForWork=()=>[{...claim,state:'closed'},{...claim,number:1806,state:'closed'}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io),/explicit --claim-number/)

  const selected=deriveLivePreviewCandidate(1769,io,{claimNumber:claim.number})
  assert.equal(selected.route,'merged_rehearsal')
  assert.throws(()=>deriveLivePreviewCandidate(1769,io,{claimNumber:9999}),/not a unique historical claim/)

  io.closedClaimsForWork=()=>[{...claim,state:'closed'}]
  io.openPulls=()=>[{number:1809,head:{ref:'issue-1769-wwe-tables',sha:'a'.repeat(40)}}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io),/still open/)

  io.openPulls=()=>[]
  io.mergeCommitInMain=()=>false
  assert.throws(()=>deriveLivePreviewCandidate(1769,io),/is not in main history/)
})

test('historical recovery ignores malformed unrelated open claim titles but strictly binds the selected closed claim',()=>{
  const {io}=mergedRehearsalIo(),claim=io.openClaims()[0]
  const unrelated={...claim,number:99,title:'CLAIM without a work issue',body:claim.body.replace('20260828232207','20260828232208').replace('issue-1769-wwe-tables','unrelated-branch')}
  io.openClaims=()=>[unrelated]
  io.closedClaimsForWork=()=>[{...claim,state:'closed'}]
  assert.equal(deriveLivePreviewCandidate(1769,io,{claimNumber:claim.number}).route,'merged_rehearsal')

  io.closedClaimsForWork=()=>[{...claim,title:'CLAIM without a work issue',state:'closed'}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io,{claimNumber:claim.number}),/exactly one work issue/)
  io.closedClaimsForWork=()=>[{...claim,title:'CLAIM: #1769 and #1770',state:'closed'}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io,{claimNumber:claim.number}),/exactly one work issue/)
  io.closedClaimsForWork=()=>[{...claim,title:'CLAIM: #1770 wrong work item',state:'closed'}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io,{claimNumber:claim.number}),/does not identify work issue #1769/)

  io.openClaims=()=>[{...unrelated,title:'CLAIM: #1769 and #1770'}]
  io.closedClaimsForWork=()=>[{...claim,state:'closed'}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io,{claimNumber:claim.number}),/ambiguously identifies work issue #1769/)

  io.openClaims=()=>[{...unrelated,body:claim.body}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io,{claimNumber:claim.number}),/invalid title protects recovery version 20260828232207/)
})

test('a merged claim whose merge commit is not in main history is refused',()=>{
  const {io}=mergedRehearsalIo()
  io.mergeCommitInMain=()=>false
  assert.throws(()=>deriveLivePreviewCandidate(1769,io),/is not in main history/)
})

test('two merged pull requests on one claim branch are still refused as ambiguous',()=>{
  const {io}=mergedRehearsalIo()
  const one=io.branchPulls('issue-1769-wwe-tables')[0]
  io.branchPulls=()=>[one,{...one,number:1810}]
  assert.throws(()=>deriveLivePreviewCandidate(1769,io),/exactly one live pull request/)
})

// The shape assertions above cannot catch a CONSUMER that wants different fields.
// They did not: the reconciler still required claim_pr, so the merged rehearsal
// emitted a valid manifest and then failed one layer down at persistence, and both
// independent verification passes missed it because neither drove the manifest into
// the next stage. This test does, and it is the one that would have caught it.
test('the merged-rehearsal candidate is accepted by the reconciler it is handed to',async()=>{
  const {readyRecord}=await import('./orchestrator-flow/reconcile.mjs')
  const {io,mainSha}=mergedRehearsalIo()
  const record=readyRecord(deriveLivePreviewCandidate(1769,io))
  assert.equal(record.route,'merged_rehearsal')
  assert.equal(record.route_context,mainSha)
  assert.match(record.ready_id,/^[0-9a-f]{64}$/)
})

test('the reconciler refuses a merged rehearsal that names a live author claim',async()=>{
  const {readyRecord,ReconcileError}=await import('./orchestrator-flow/reconcile.mjs')
  const {io}=mergedRehearsalIo()
  const candidate=deriveLivePreviewCandidate(1769,io)
  assert.throws(()=>readyRecord({...candidate,manifest:{...candidate.manifest,claim_pr:'1809'}}),(error)=>error instanceof ReconcileError&&/must not name a live author claim/.test(error.message))
})

// ---------------------------------------------------------------------------
// Slot-2 reviewer replacement (issue #1832). Reproduced on PR #1823 at head
// c8aeeb19: slot 2 drew deepseek-chat (sequence 516), the provider returned
// HTTP 402 with no conversation, verdict or artifact, and the governed
// replacement refused with "durable reviewer assignment or replacement does
// not match the replacement request". The refusal was correct: the operation
// resolved the failed sequence against slot 1's UNSUFFIXED ref namespace,
// where sequence 516 does not appear, and failed closed rather than silently
// replacing slot 1's reviewer. The missing piece is a slot-aware route.
// ---------------------------------------------------------------------------

test('a failed slot-2 reviewer can be replaced without touching slot 1 (issue #1832)',()=>{
  const io=reviewIo(),request={issue:1832,pr:1823,headSha:'c'.repeat(40)}
  io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const slotOne=assignNextReviewer(request,io)
  const slotTwo=assignNextReviewer({...request,slot:2},io)
  assert.notEqual(slotTwo.reviewer,slotOne.reviewer)
  const replaced=replaceFailedReviewer({...request,slot:2,failedSequence:slotTwo.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  assert.notEqual(replaced.reviewer,slotTwo.reviewer,'the replacement must not re-pick the failed slot-2 provider')
  assert.notEqual(replaced.reviewer,slotOne.reviewer,'slot 2 must stay independent of slot 1 after replacement')
  // Slot 1 is untouched: same reviewer, same record, same lease.
  assert.deepEqual(assignNextReviewer(request,io),slotOne)
  // And the slot-2 assignment route now hands back the replacement, not the
  // failed original -- the replacement namespace must be the slot-2 one.
  assert.equal(assignNextReviewer({...request,slot:2},io).reviewer,replaced.reviewer)
  // The failed provider's lease is released by the same governed operation.
  assert.equal(io.refs.get(reviewActiveRef(slotTwo.reviewer))??null,null,'the failed slot-2 reviewer lease must lapse through the replacement')
  // Idempotent retry, same as slot 1 has always been.
  assert.deepEqual(replaceFailedReviewer({...request,slot:2,failedSequence:slotTwo.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io),replaced)
})

test('a slot-2 replacement request must never be answered from slot 1 records (issue #1832)',()=>{
  // The dirty case that could plausibly slip past a loose fix: slot 1 exists
  // and is perfectly replaceable at its own sequence, so a slot-unaware or
  // loosened matcher would happily replace slot 1 while the caller believes
  // it is replacing slot 2. Naming slot 2 with slot 1's sequence must refuse.
  const io=reviewIo(),request={issue:1833,pr:1824,headSha:'d'.repeat(40)}
  io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const slotOne=assignNextReviewer(request,io)
  const slotTwo=assignNextReviewer({...request,slot:2},io)
  assert.throws(()=>replaceFailedReviewer({...request,slot:2,failedSequence:slotOne.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io),/does not match the replacement request/)
  // And the mirror: slot 1 must not be replaceable by naming slot 2's sequence.
  assert.throws(()=>replaceFailedReviewer({...request,failedSequence:slotTwo.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io),/does not match the replacement request/)
  // Nothing moved.
  assert.deepEqual(assignNextReviewer(request,io),slotOne)
  assert.deepEqual(assignNextReviewer({...request,slot:2},io),slotTwo)
})

test('a complete slot-2 replacement stays inside the real wire-attempt budget (issue #1832)',()=>{
  // resolveSlotOneReviewer adds three pre-mutex wire calls to the replacement
  // path exactly as it does to assignment (#1812). Measure the real total under
  // the shipped REVIEW_OPERATION_REQUEST_LIMIT rather than assuming it fits.
  const request={issue:1834,pr:1825,headSha:'e'.repeat(40)}
  const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  assignNextReviewer(request,io)
  const slotTwo=assignNextReviewer({...request,slot:2},io)
  let attempts=0;const labels=[]
  const rawGetCommit=io.getCommit
  const active=new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:rawGetCommit(sha)}]))
  const states=new Map([[`${request.issue}:${request.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:request.headSha}},evidence:[]}]])
  const wire=(n=1,label='wire')=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;labels.push(label);return '{}'}})}
  io.getRateLimit=()=>{wire(1,'quota');return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire(1,'active');return active}
  io.readReviewStates=()=>{wire(1,'states');return states}
  io.readReviewRefs=(refs)=>{wire(1,'readReviewRefs');return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  io.readReviewRecords=(refs,prefix)=>{wire(prefix?2:1,'readReviewRecords');const result=new Map(refs.map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}));Object.defineProperty(result,'matching',{value:prefix?[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})):[]});return result}
  for(const name of ['readRef','listRefs','getCommit','getPr','getIssue','getIssueComments','getPrReviews','createRef','updateRef','deleteRef']){const fn=io[name];io[name]=(...args)=>{wire(1,`${name}:${String(args[0])}`);return fn(...args)}}
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(message)=>{wire(1,'commit');return make(message)}
  let result
  try{result=replaceFailedReviewer({...request,slot:2,failedSequence:slotTwo.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)}
  catch(error){throw new Error(`${error.message}; calls=${labels.join(',')}`)}
  assert.ok(result.reviewer)
  assert.equal(attempts,18,`slot-2 replacement used ${attempts} of ${REVIEW_OPERATION_REQUEST_LIMIT}: ${labels.join(',')}`)
  // Durable-verdict refusal and exact exclusion reads are both fixed-cost. Their
  // cost does not grow with the number of exclusions; the batched record reads
  // avoid per-exclusion commit calls.
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`slot-2 replacement exceeded the ${REVIEW_OPERATION_REQUEST_LIMIT}-request budget`)
})

test('a slot-2 replacement never falls back onto slot 1\'s own reviewer (issue #1832)',()=>{
  // The dirty case: chain two slot-2 replacements until the rotation's only
  // remaining name IS slot 1's reviewer. Correct behaviour is to refuse. Two
  // separate ways to get this wrong both land on slot 1's provider -- dropping
  // the slot-1 exclusion, or sourcing it from a prefix scan that mistakes a
  // slot-2 replacement ref for a slot-1 one (slot 1's base is a prefix of
  // slot 2's). Either would hand the same provider both verdicts on one head,
  // which is not two independent reviews.
  const request={issue:1835,pr:1826,headSha:'f'.repeat(40)}
  const io=reviewIo(),heads=new Map()
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:heads.get(Number(number))??request.headSha}})
  const slotOne=assignNextReviewer(request,io)
  const slotTwo=assignNextReviewer({...request,slot:2},io)
  const failure={failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}
  const firstReplacement=replaceFailedReviewer({...request,slot:2,failedSequence:slotTwo.sequence,...failure},io)
  // Park every remaining active provider on unrelated live review work, so the
  // rotation's only untaken, unfailed name left is slot 1's reviewer.
  // Slot 1 holds no live lease at this point: its lease was reclaimed while its
  // assignment record still stands. That is what makes this the dirty case --
  // the ordinary busy check no longer hides slot 1's reviewer, so the slot-1
  // exclusion is the only thing keeping it out of the pick.
  io.refs.delete(reviewActiveRef(slotOne.reviewer))
  const spent=new Set([slotOne.reviewer,slotTwo.reviewer,firstReplacement.reviewer])
  ACTIVE_REVIEWERS.filter((row)=>!spent.has(row.name)).forEach((row,index)=>{
    const issue=700+index,pr=800+index,headSha=`ba${index}`.padEnd(40,'0')
    heads.set(pr,headSha)
    io.refs.set(reviewActiveRef(row.name),io.makeOwnerCommit(`db-coordination reviewer-lease generation=${index+1} reviewer=${row.name} issue=${issue} pr=${pr} head=${headSha} sequence=${900+index}`))
  })
  assert.throws(()=>replaceFailedReviewer({...request,slot:2,failedSequence:firstReplacement.sequence,...failure},io),/no other independent reviewer is available for slot 2/)
  // Slot 1 is untouched by the refusal.
  assert.deepEqual(assignNextReviewer(request,io),slotOne)
})

test('an invalid slot on a replacement request is refused (issue #1832)',()=>{
  const io=failedReviewIo()
  for(const slot of [0,-1,1.5,'two'])assert.throws(()=>replaceFailedReviewer({...replacementRequest,slot},io),/positive integer/)
})

test('replacement ref namespaces are matched exactly, never by prefix (issue #1832)',()=>{
  const base='refs/db-review-replacements/1832-1823-abc'
  assert.ok(inReviewReplacementNamespace(`${base}-516`,base))
  assert.equal(inReviewReplacementNamespace(`${base}-slot2-516`,base),false,'a slot-2 link must not be read as a slot-1 one')
  assert.ok(inReviewReplacementNamespace(`${base}-slot2-516`,`${base}-slot2`))
  assert.equal(inReviewReplacementNamespace(base,base),false,'the legacy unsuffixed ref is handled separately, not as a link')
  assert.equal(inReviewReplacementNamespace('refs/db-review-replacements/1832-18230-1',base),false)
})

test('--replace-failed-reviewer honours --review-slot on the command line (issue #1832)',()=>{
  // The CLI is the only route an orchestrator actually uses. Before #1832 it
  // never forwarded --review-slot to the replacement, so a slot-2 request was
  // silently answered from slot 1's records.
  const request={issue:1836,pr:1827,headSha:'1'.repeat(40)}
  const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const slotOne=assignNextReviewer(request,io)
  const slotTwo=assignNextReviewer({...request,slot:2},io)
  const argv=['--replace-failed-reviewer','--issue',String(request.issue),'--pr',String(request.pr),'--head-sha',request.headSha,'--review-slot','2','--failed-sequence',String(slotTwo.sequence),'--failure-code','insufficient_quota','--confirm-no-verdict','--confirm-no-artifact']
  const printed=[];const log=console.log;console.log=(line)=>printed.push(line)
  try{assert.equal(main(argv,NOW,io),0)}finally{console.log=log}
  const result=JSON.parse(printed.join('\n'))
  assert.equal(result.slot,2)
  assert.notEqual(result.reviewer,slotTwo.reviewer)
  assert.notEqual(result.reviewer,slotOne.reviewer)
  assert.deepEqual(assignNextReviewer(request,io),slotOne,'slot 1 must be untouched by a slot-2 command-line replacement')
})
