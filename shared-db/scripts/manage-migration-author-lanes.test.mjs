import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { REVIEW_VERDICT_REF_PREFIX } from './lib/review-verdict-artifact.mjs'
import { assignWithMutexRetry } from './manage-migration-author-lanes.mjs'
import { readyRecord, persistInitialReady } from './orchestrator-flow/reconcile.mjs'
import { canonicalJson, sha256 } from './orchestrator-flow/evidence-bundle.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAIM_CLOSE_REASONS, RECOVERABLE_CLAIM_CLOSE_REASONS, LEGACY_GUARDED_CLEANUP_CLOSE_REASON, ACTIVE_REVIEWERS, OVERFLOW_REVIEWERS, reviewersForOrchestrator, findBusyReviewers, reviewerCapacityReport, reviewLeaseAgeHours, activityFingerprintForLease, probeSilentReviewer, reclaimSilentReviewer, SILENCE_MIN_AGE_HOURS, SILENCE_CONFIRM_HOURS, REVIEW_SILENCE_PROBE_REF_PREFIX, REVIEW_SILENCE_RELEASE_REF_PREFIX, REVIEW_QUEUE_REF_PREFIX, pickReviewer, addedMigrationVersions, assertMergeCommitInMainHistory, REVIEWERS, RETIRED_REVIEWERS, QUARANTINED_REVIEWERS, acquireAuthorLane, acquireExclusive, assertLaneAvailable, assignNextReviewer, assertDurableReviewApproval, buildDynamicQueues, claimBody, currentMainMaxVersion, queueExit, NON_STRUCTURAL_EXITS, OUTSIDE_ORCHESTRATOR_EXITS, conflicts, completeWork, requiresReturnAddress, returnIssueToOwner, RETURNED_MARKER, createRefWithReadback, deleteRefWithReadback, expandActiveClaimFromIssue, expandActiveClaimFromPr, EXCLUSIVE_REFS, githubIo, isConfirmedRefAbsence, LaneError, main, MUTEX_RECOVERY_ACTIVE_REF, MUTEX_REF, parseAuthorLease, parseQueueScope, parseReviewCursor, readPrAfterPush, readRefAfterWrite, recoverExpiredClaimFromPr, recoverSameOwnerSplit, recoverStaleAuthorMutex, reissueMergedStrandedClaim, releaseOwnedRef, releaseFailedReviewer, replaceFailedReviewer, failedReviewerReleaseCommand, requireOwnedRef, renewExpiredClaim, reviewerExecutionPreflight, reversionActiveClaim, runGitHubCommand, withReviewRequestBudget, supersedeActiveClaimVersion, REVIEW_CURSOR_REF, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_FAILURE_REF_PREFIX, validateClaimObjects, parseDoctorFailures, TERMINAL_FAILURE_CODES, doctorSpawnPlan, resolveCommandPath, summarizeDoctorOutput, pickExecutableCandidate, REVIEWER_DOCTOR_TIMEOUT_MS, findPrReviewAssignments, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, reviewActiveRef, parseReviewLease, EXPECTED_REF_ABSENCE, EXPECTED_REF_PRESENCE, deriveLivePreviewCandidate, validateOriginalPreviewApplyEvidence, projectReviewPr, projectReviewerOperationRouteSnapshot, reviewStateGraphqlFields, REVIEW_OPERATION_REQUEST_LIMIT, REVIEW_MUTEX_SECTION_RESERVE, REVIEW_SILENT_RECLAIM_REQUEST_LIMIT, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE, inReviewReplacementNamespace, activateReviewCutover, REVIEW_REF_ROW_LIMIT, parseGhIncludeResponse, hasNextPageLink, parseLinkHeader, excludeReviewerForPr, parseReviewExclusion, REVIEW_EXCLUSION_REF_PREFIX, reinstateReviewerExclusion, parseReviewReinstatement, REVIEW_REINSTATEMENT_REF_PREFIX, REINSTATABLE_EXCLUSION_REASONS, reviewExclusionRef, reviewReinstatementRef, REVIEW_EXCLUSION_GENERATION_LIMIT, countDoctorPassLines, REVIEW_RETURN_REF_PREFIX, parseReviewReturn, readReviewReturns, reviewReturnRef, reviewRecordRefs, retiredVerdictRef, REVIEW_RETIRED_VERDICT_REF_PREFIX, reviewerReadsRepository, readReviewVerdicts, nonReadingReviewerReplacementCommand, hasVerdictForHead, headVerdictBlocksReplacement, reviewerKnownNonReading, DURABLE_VERDICT_REF_NAMESPACE, readOrchestratorResolution, orchestratorEngineFromResolution, recordReviewVerdict, markReviewRefListingRefusal, isReviewRefListingRefusal } from './manage-migration-author-lanes.mjs'

function commandFailure(message){const error=new Error(message);error.stderr=message;return error}

test('current migration version refreshes live main before reading its tree',()=>{
  const calls=[]
  const run=(_command,args)=>{calls.push(args);return args.includes('ls-tree')?'supabase/migrations/20260830123456_x.sql\n':''}
  assert.equal(currentMainMaxVersion('C:/worktree',run),'20260830123456')
  assert.deepEqual(calls[0],['-C','C:/worktree','fetch','--quiet','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main'])
  assert.ok(calls[1].includes('refs/remotes/origin/main'))
})

test('current migration version refuses when live main cannot be refreshed',()=>{
  assert.throws(()=>currentMainMaxVersion('C:/worktree',()=>{throw new Error('offline')}),/offline/)
})

test('GitHub coordination transport retries only explicitly idempotent writes with identical deterministic arguments',()=>{
  const calls=[],waits=[],args=['api','-X','POST','repos/u2giants/shared-db/git/commits','-f','message=exact']
  const result=runGitHubCommand(args,{executor:(command,actual)=>{
    calls.push([command,[...actual]])
    if(calls.length<3)throw commandFailure('HTTP 503: No server is currently available')
    return '{"sha":"same"}'
  },wait:waits.push.bind(waits),idempotentWrite:true})
  assert.equal(result,'{"sha":"same"}')
  assert.deepEqual(waits,[1000,2000])
  assert.equal(calls.length,3)
  assert.ok(calls.every(([,actual])=>JSON.stringify(actual)===JSON.stringify(args)))
})

test('GitHub coordination transport never replays an unproven write by default',()=>{
  let calls=0
  assert.throws(()=>runGitHubCommand(['issue','comment','1','--body','once'],{
    executor:()=>{calls+=1;throw commandFailure('HTTP 503: response lost')},wait:()=>{},
  }),error=>error instanceof LaneError&&error.transientTransport===true)
  assert.equal(calls,1)
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

function durableApprovalFixture({includeLatestReplacementVerdict=true,returnSlot=null,keepReturnedSlotVerdict=false,redraw=false,redrawVerdict=true}={}){
  const issue=1824,pr=1931,headSha='a'.repeat(40),findingsBody='review findings',findingsRef=`https://github.com/u2giants/shared-db/pull/${pr}#issuecomment-1`
  const assignment1='1'.repeat(40),assignment2='2'.repeat(40),replacement2='3'.repeat(40)
  const commits=new Map([
    [assignment1,{message:`db-coordination reviewer-cursor sequence=1 reviewer=kimi-k3 issue=${issue} pr=${pr} head=${headSha} slot=1`}],
    [assignment2,{message:`db-coordination reviewer-cursor sequence=2 reviewer=kimi-k3 issue=${issue} pr=${pr} head=${headSha} slot=2`}],
    [replacement2,{message:`db-coordination reviewer-replacement sequence=7 reviewer=kimi-k3 issue=${issue} pr=${pr} head=${headSha} slot=2 failed-sequence=2 prior-sequence=6 failure-ref=${'9'.repeat(40)}`}],
  ])
  const refs=new Map([
    [`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,assignment1],
    [`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}-slot2`,assignment2],
    [`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${headSha}-slot2-7`,replacement2],
  ])
  const addVerdict=(ref,sha,slot,assignmentSha,reviewer='kimi-k3')=>{
    const record={verdict:'APPROVE',head_sha:headSha,issue,pr,slot,reviewer,assignment_sha:assignmentSha,findings_digest:createHash('sha256').update(findingsBody).digest('hex'),findings_ref:findingsRef}
    refs.set(ref,sha);commits.set(sha,{message:`db-review-verdict ${JSON.stringify(record)}`,parents:[{sha:assignmentSha}]})
  }
  addVerdict(`refs/db-review-verdicts/${issue}-${pr}-${headSha}`,'4'.repeat(40),1,assignment1)
  addVerdict(`refs/db-review-verdicts/${issue}-${pr}-${headSha}-slot2`,'5'.repeat(40),2,assignment2)
  if(includeLatestReplacementVerdict)addVerdict(`refs/db-review-verdict-replacements/${issue}-${pr}-${headSha}-slot2-7`,'6'.repeat(40),2,replacement2)
  // `returnSlot` retires one slot's latest assignment exactly the way
  // --exclude-reviewer does: the ref is cleared and a durable return record is
  // written in its place. Slot 1 retires its original assignment; slot 2 retires
  // its LATEST record, the replacement, leaving the superseded original behind.
  if(returnSlot){
    const retired=returnSlot===1?{ref:`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,sha:assignment1,sequence:null}
      :{ref:`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${headSha}-slot2-7`,sha:replacement2,sequence:7}
    refs.delete(retired.ref)
    if(!keepReturnedSlotVerdict)refs.delete(returnSlot===1?`refs/db-review-verdicts/${issue}-${pr}-${headSha}`:`refs/db-review-verdict-replacements/${issue}-${pr}-${headSha}-slot2-7`)
    const returnSha='7'.repeat(40)
    refs.set(`${REVIEW_RETURN_REF_PREFIX}/${issue}-${pr}-${headSha}${returnSlot===1?'':'-slot2'}-${retired.sha}`,returnSha)
    commits.set(returnSha,{message:`db-coordination reviewer-return reviewer=kimi-k3 issue=${issue} pr=${pr} head=${headSha} slot=${returnSlot} assignment=${retired.sha} sequence=${returnSlot===1?1:7}${retired.sequence===null?'':` replacement=${retired.sequence}`} reason=independence-conflict`})
    // THE RE-DRAW. A returned slot is answerable again by a genuinely NEWER
    // assignment for the same slot -- and only by that. `--assign-reviewer`
    // recreates the ORIGINAL ref (namespace sequence 0) and
    // `--replace-failed-reviewer` recreates the replacement ref under the SAME
    // failed-sequence tail, so in both real routes the namespace tail cannot
    // tell new from superseded. The global cursor sequence can, and that is what
    // this exercises: sequence 11, drawn after the returned record.
    if(redraw){
      const redrawn='8'.repeat(40)
      commits.set(redrawn,returnSlot===1
        ?{message:`db-coordination reviewer-cursor sequence=11 reviewer=grok-4.6 issue=${issue} pr=${pr} head=${headSha} slot=1`}
        :{message:`db-coordination reviewer-replacement sequence=11 reviewer=grok-4.6 issue=${issue} pr=${pr} head=${headSha} slot=2 failed-sequence=2 prior-sequence=7 failure-ref=${'9'.repeat(40)}`})
      refs.set(retired.ref,redrawn)
      if(redrawVerdict)addVerdict(returnSlot===1?`refs/db-review-verdicts/${issue}-${pr}-${headSha}`:`refs/db-review-verdict-replacements/${issue}-${pr}-${headSha}-slot2-7`,'b'.repeat(40),returnSlot,redrawn,'grok-4.6')
    }
  }
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

// APPROVAL CARRY-FORWARD AT THE PREVIEW GATE (#2758): the same rule as the merge gate.
test('#2758: durable approval at a prior head carries to a content-identical refreshed head',()=>{
  const fixture=durableApprovalFixture(),refreshed='c'.repeat(40),calls=[]
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,refreshed,fixture.io))
  const verdicts=assertDurableReviewApproval(fixture.issue,fixture.pr,refreshed,{...fixture.io,contentPreservingRefresh:(a,b)=>{calls.push([a,b]);return{ok:true}}})
  assert.equal(verdicts.filter((row)=>row.verdict==='APPROVE').length,3)
  assert.deepEqual(calls,[[fixture.headSha,refreshed]])
})

test('POSITIVE CONTROL #2758: a refreshed head whose PR diff changed is not carried',()=>{
  const fixture=durableApprovalFixture()
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,'c'.repeat(40),{...fixture.io,contentPreservingRefresh:()=>({ok:false,reason:'diff changed'})}))
})

test('POSITIVE CONTROL #2758: a prior head known only by its verdict is inspected before any carry',()=>{
  const fixture=durableApprovalFixture(),refreshed='c'.repeat(40),orphan=`refs/db-review-verdicts/${fixture.issue}-${fixture.pr}-${'d'.repeat(40)}`
  const listRefs=(prefix)=>[...fixture.io.listRefs(prefix),...(orphan.startsWith(prefix)?[{ref:orphan,sha:'5'.repeat(40)}]:[])]
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,refreshed,{...fixture.io,listRefs,contentPreservingRefresh:()=>({ok:true})}),/could not be read|durable reviewer refusal/)
})

test('POSITIVE CONTROL #2758: a refreshed head with an assignment of its own is never carried past',()=>{
  const fixture=durableApprovalFixture(),refreshed='c'.repeat(40)
  const listRefs=(prefix)=>prefix===`${REVIEW_ASSIGNMENT_REF_PREFIX}/${fixture.issue}-${fixture.pr}-${refreshed}`?[{ref:prefix,sha:'1'.repeat(40)}]:fixture.io.listRefs(prefix)
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,refreshed,{...fixture.io,listRefs,contentPreservingRefresh:()=>({ok:true})}),/reviewer records of its own/)
})

test('POSITIVE CONTROL #2758: a refreshed head with a return of its own is never carried past',()=>{
  const fixture=durableApprovalFixture(),refreshed='c'.repeat(40)
  const returned='2'.repeat(40),returnSha='6'.repeat(40)
  const listRefs=(prefix)=>`${REVIEW_RETURN_REF_PREFIX}/${fixture.issue}-${fixture.pr}-${refreshed}`.startsWith(prefix)&&prefix.includes(refreshed)?[{ref:`${REVIEW_RETURN_REF_PREFIX}/${fixture.issue}-${fixture.pr}-${refreshed}-${returned}`,sha:returnSha}]:fixture.io.listRefs(prefix)
  const getCommit=(sha)=>sha===returnSha?{message:`db-coordination reviewer-return reviewer=kimi-k3 issue=${fixture.issue} pr=${fixture.pr} head=${refreshed} slot=1 assignment=${returned} sequence=1 reason=independence-conflict`}:fixture.io.getCommit(sha)
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,refreshed,{...fixture.io,listRefs,getCommit,contentPreservingRefresh:()=>({ok:true})}),/reviewer records of its own/)
})

// THE MULTI-SLOT RETURN HOLE (grok-4.6 review of PR #2077, high finding 2).
//
// Dropping a returned assignment from the gate is fail-CLOSED with one slot --
// nothing is left, and the emptiness refusal fires. With two slots it was
// fail-OPEN: slot 2's own APPROVE was enough to make the gate green while slot
// 1's assignment for this exact head had been returned and nobody had approved
// anything for it. That is a merge authorized over an unreviewed slot, the exact
// failure the return record exists to prevent. Both tests below fail against the
// version of the gate that only filtered returned SHAs.
test('a returned slot is never satisfied by another slot APPROVE',()=>{
  const fixture=durableApprovalFixture({returnSlot:1})
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io),/review slot 1 was durably returned and has no live exact-head assignment/)
})

// A returned slot is not satisfied by a raced verdict on the assignment it
// retired either. The verdict still READS -- it resolves through the return
// record instead of breaking the audit chain with "no live assignment record" --
// but it authorizes nothing.
test('a verdict raced onto a returned assignment reads but never approves the slot',()=>{
  const fixture=durableApprovalFixture({returnSlot:1,keepReturnedSlotVerdict:true})
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io),/review slot 1 was durably returned and has no live exact-head assignment/)
})

// Returning a slot's LATEST record does not hand the slot back to the older
// record that latest one had already superseded: slot 2's returned replacement
// cannot be answered for by the original assignment it replaced.
test('a returned replacement is not satisfied by the assignment it superseded',()=>{
  const fixture=durableApprovalFixture({returnSlot:2})
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io),/review slot 2 was durably returned and has no live exact-head assignment/)
})

// THE OVER-CORRECTION (grok-4.6 second REVISE of PR #2077, high finding 2).
//
// A returned slot must not be answerable by another slot, nor by the record the
// returned one had already superseded -- but it MUST be answerable by a
// genuinely newer assignment that carries its own APPROVE. Comparing the
// replacement-namespace tail made that impossible: `--assign-reviewer`
// recreates the original ref, whose tail is 0, and `--replace-failed-reviewer`
// recreates the replacement ref under the same failed-sequence tail, so neither
// real recovery route could ever compare as newer and the slot stayed red
// forever. Both tests below fail against the tail comparison and pass against
// the cursor-sequence comparison.
test('a re-drawn original assignment with its own APPROVE answers a returned slot',()=>{
  const fixture=durableApprovalFixture({returnSlot:1,redraw:true})
  const verdicts=assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io)
  assert.equal(verdicts.filter((row)=>row.verdict==='APPROVE').length,3)
})

test('a re-drawn replacement with its own APPROVE answers a returned replacement slot',()=>{
  const fixture=durableApprovalFixture({returnSlot:2,redraw:true})
  const verdicts=assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io)
  assert.equal(verdicts.filter((row)=>row.verdict==='APPROVE').length,3)
})

// The re-draw is not a free pass: the NEW assignment still has to record its
// own APPROVE. Without one the slot stays red, so "newer" relaxed the ordering
// rule and nothing else.
test('a re-drawn assignment without its own APPROVE still leaves the slot red',()=>{
  const fixture=durableApprovalFixture({returnSlot:2,redraw:true,redrawVerdict:false})
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io),/review slot 2 has no durable APPROVE for its latest exact-head assignment/)
})

const scope = (status, workType, route, priority, objects=[], depends='') => `\`\`\`db-work-scope\nstatus: ${status}\nwork_type: ${workType}\nroute: ${route}\n${workType==='structural'?'service_class: standard-application\nchange_type: migration\napplication_return_to: u2giants/example-app\nlive_assertion: authenticated create-and-read succeeds\ngenerated_types: not-applicable\n':''}priority: ${priority}\ndepends_on: ${depends}\nobjects:\n${objects.map((x)=>`  - ${x}`).join('\n')}\n\`\`\``

test('queue scope keeps status, work type, and route separate',()=>{
  assert.deepEqual(parseQueueScope(scope('ready','structural','shared-db-orchestrator',9,['table core.a'],'#12, 13')), {status:'ready',workType:'structural',route:'shared-db-orchestrator',priority:9,dependencies:[12,13],returnTo:null,writes:['table core.a'],reads:[],legacyObjects:['table core.a'],objects:['table core.a'],serviceClass:'standard-application',changeType:'migration',applicationReturnTo:'u2giants/example-app',liveAssertion:'authenticated create-and-read succeeds',generatedTypes:'not-applicable',outcomeStage:'entered'})
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

test('queue priority favors the issue that unblocks the most downstream work, then the oldest issue',()=>{
  const issues=[
    {number:100,createdAt:'2026-08-04T00:00:00Z',title:'old but no dependents',body:scope('ready','structural','shared-db-orchestrator',999,['table core.a'])},
    {number:200,createdAt:'2026-08-03T00:00:00Z',title:'older equal blocker',body:scope('ready','structural','shared-db-orchestrator',1,['table core.a'])},
    {number:300,createdAt:'2026-08-02T00:00:00Z',title:'depends on 200',body:scope('ready','structural','shared-db-orchestrator',1,['table core.b'],'#200')},
    {number:400,createdAt:'2026-08-05T00:00:00Z',title:'larger blocker',body:scope('ready','structural','shared-db-orchestrator',1,['table core.a'])},
    {number:500,createdAt:'2026-08-06T00:00:00Z',title:'depends on 400',body:scope('ready','structural','shared-db-orchestrator',1,['table core.c'],'#400')},
    {number:600,createdAt:'2026-08-07T00:00:00Z',title:'transitively depends on 400',body:scope('ready','structural','shared-db-orchestrator',1,['table core.d'],'#500')},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.deepEqual(result.blockerCounts,{100:0,200:1,300:0,400:2,500:1,600:0})
  assert.equal(result.queues.find((queue)=>queue.queued.includes(400)).queued[0],400,'two downstream issues outrank every older or manually higher-priority issue')

  const ageTie=buildDynamicQueues([
    {number:700,createdAt:'2026-08-10T00:00:00Z',title:'newer',body:scope('ready','structural','shared-db-orchestrator',999,['table core.z'])},
    {number:800,createdAt:'2026-08-01T00:00:00Z',title:'older',body:scope('ready','structural','shared-db-orchestrator',1,['table core.z'])},
  ],[],NOW)
  assert.deepEqual(ageTie.queues.find((queue)=>queue.queued.includes(800)).queued,[800,700])
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

test('legacy claims never hit a lane cap and always protect objects', () => {
  const legacy = (n, object) => ({ number:n, body:`\`\`\`db-claim\nversion: none\nobjects:\n  - ${object}\n\`\`\`` })
  // NO AUTHOR LANE CAP (owner ruling, issue #2775). Far more active claims than
  // any former cap (3/5/8/24) never refuse unrelated work; only object overlap does.
  const many = Array.from({length:500},(_,i)=>legacy(i+1,`table core.t${i}`))
  const state = assertLaneAvailable(many, ['table core.d'], NOW)
  assert.equal(state.active.length, 500)
  assert.throws(() => assertLaneAvailable(many, ['table core.t499'], NOW), /collision with claim #500/)
  const source = readFileSync(new URL('./manage-migration-author-lanes.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /MAX_AUTHOR_LANES|active-author leases are occupied|would exceed active-author capacity/, 'a lane cap must never be reintroduced')
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

// A VERDICT IS AN ARTIFACT (issue #2075). Every lane decision now proves "a
// verdict exists for this head" from the create-only durable ref, so a fixture
// that means "a verdict exists" has to record the ref. Writing decision words
// into a comment is exactly the trust that produced #2075 and no longer means
// anything to the lane code.
function giveVerdict(io,{issue,pr,headSha,slot=1,replacementSequence=null}){
  const prefix=replacementSequence===null?'refs/db-review-verdicts':'refs/db-review-verdict-replacements'
  const suffix=`${slot===1?'':`-slot${slot}`}${replacementSequence===null?'':`-${replacementSequence}`}`
  const ref=`${prefix}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}${suffix}`
  io.refs.set(ref,io.makeOwnerCommit(`db-review-verdict {"issue":${Number(issue)},"pr":${Number(pr)},"head_sha":"${String(headSha).toLowerCase()}"}`))
  return ref
}

function reviewIo(){
  const io=memoryIo(), commits=new Map();let seq=0
  io.resolveOrchestratorEngine=()=> 'claude'
  io.reviewerUsability=(reviewers)=>new Map(reviewers.map((row)=>[row.provider,{provider:row.provider,status:'ready',usable:true}]))
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

function admittedReviewIo({closeOnMutex=false}={}){
  const io=reviewIo(),headSha='a'.repeat(40);let issueState='open',mutexCreates=0
  const body=['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','service_class: standard-application','change_type: migration','application_return_to: u2giants/example-app','live_assertion: authenticated create-and-read succeeds','generated_types: not-applicable','outcome_stage: entered','priority: 5','depends_on:','writes:','  - table core.example','```'].join('\n')
  io.enforceAdmission=true
  io.getIssue=()=>({number:41,state:issueState,title:'review admission',body,createdAt:'2026-09-11T00:00:00Z'})
  io.closingIssuesForPr=()=>[{number:41,state:issueState}]
  io.getPr=(number)=>({number:Number(number),state:'open',merged_at:null,head:{sha:headSha,ref:'codex/x'}})
  io.getPrFiles=()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added',content:'create table core.example(id bigint);'}]
  io.getFileAt=()=> 'create table core.example(id bigint);'
  const create=io.createRef
  io.createRef=(ref,sha)=>{if(ref===MUTEX_REF){mutexCreates++;if(closeOnMutex)issueState='closed'}return create(ref,sha)}
  return {io,headSha,mutexCreates:()=>mutexCreates}
}

test('reviewer admission shares one mutex interval on the green path',()=>{
  const {io,headSha,mutexCreates}=admittedReviewIo()
  const result=assignNextReviewer({issue:41,pr:7,headSha,admissionOptions:{admitIssue:41,pr:7}},io)
  assert.ok(result.reviewer);assert.equal(mutexCreates(),1);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('reviewer admission revalidates after its mutex is acquired',()=>{
  const {io,headSha,mutexCreates}=admittedReviewIo({closeOnMutex:true})
  assert.throws(()=>assignNextReviewer({issue:41,pr:7,headSha,admissionOptions:{admitIssue:41,pr:7}},io),/closed and cannot be admitted/)
  assert.equal(mutexCreates(),1);assert.equal(io.refs.has(MUTEX_REF),false);assert.equal(io.refs.has(REVIEW_CURSOR_REF),false)
})

// Issue #2802. The structural-admission gate landed on 2026-09-11, AFTER the reviewer
// operation's 25-request ceiling was derived (docs/verification/
// reviewer-assignment-api-budget-2026-08-28.md) for a draw that had no admission step.
// Charged against that ceiling, every structural draw in the fleet refused with
// "exhausted its derived 25-request budget before request 24 (2 held back as the
// mutex-release reserve)". The fixtures above never reproduced it because they make no
// REAL wire requests, and the budget only charges requests that go through the shared
// transport. This one does, so the admission gate's reads are counted the way
// production counts them.
function wiredAdmittedReviewIo(options){
  const fixture=admittedReviewIo(options),io=fixture.io,labels=[]
  // The fixture PR carries many migration files so the wired read count is large. A
  // production PR does carry many files and admission does read each one's content at
  // the exact head -- but those content reads are NOT billed to the reviewer budget in
  // production; see the wiring note below. Every file here writes the one structural
  // object the fixture issue declares, so the change stays admissible; only the count grows.
  const files=[{filename:'supabase/migrations/20260911120000_example.sql',status:'added',content:'create table core.example(id bigint);'}]
  for(let i=1;i<=30;i+=1)files.push({filename:`supabase/migrations/2026091112${String(i).padStart(4,'0')}_example_column.sql`,status:'added',content:`alter table core.example add column label_${i} text;`})
  io.getPrFiles=()=>files
  io.getFileAt=(path)=>files.find((row)=>row.filename===String(path))?.content??'create table core.example(id bigint);'
  const wire=(label)=>runGitHubCommand(['api','fixture'],{executor:()=>{labels.push(label);return '{}'}})
  // This is NOT a production-shaped request count, and must not be read as one. The
  // fixture deliberately routes three admission reads onto the BUDGETED wire so that
  // deleting withoutReviewRequestBudget makes this suite fail: it is a revert detector,
  // not a measurement. Production charges fewer reads than this. In particular
  // githubIo.getFileAt (and treeFiles) go through laneTreeReader -> createTreeReader in
  // scripts/lib/github-tree.mjs, which calls runGitHubCommand from
  // scripts/lib/github-transport.mjs -- the shared transport, which never reaches
  // consumeReviewWireRequest -- so blob and tree reads are not charged to the reviewer
  // budget in production at all. What production admission actually charges is getPr,
  // getPrFiles (via ghPaginated), closingIssuesForPr, getIssue, and the comment/outcome
  // history reads. The reviewer draw's own reads are left off the wire either way:
  // charging them here too would refuse for a reason that has nothing to do with #2802.
  for(const name of ['getPrFiles','getFileAt','closingIssuesForPr']){
    const fn=io[name]
    if(typeof fn!=='function')continue
    io[name]=(...args)=>{wire(name);return fn(...args)}
  }
  return {...fixture,io,labels}
}

test('#2802 the structural-admission gate is not charged to the reviewer request budget',()=>{
  const {io,headSha,labels,mutexCreates}=wiredAdmittedReviewIo()
  const result=assignNextReviewer({issue:41,pr:7,headSha,admissionOptions:{admitIssue:41,pr:7}},io)
  assert.ok(result.reviewer,'a structural draw must complete instead of refusing on the reviewer budget')
  assert.equal(mutexCreates(),1)
  assert.equal(io.refs.has(MUTEX_REF),false,'the reviewer mutex must still be released')
  // Admission must still RUN. Only its accounting moves, so every read it makes has to
  // still be observable on the wire.
  for(const label of ['getPrFiles','getFileAt','closingIssuesForPr'])assert.ok(labels.includes(label),`the admission gate must still read ${label}: ${labels.join(',')}`)
  // The proof: this one operation puts MORE wired requests through the budgeted executor
  // than the reviewer ceiling allows, and still completes. That can only be true if the
  // admission gate's requests are not charged to the reviewer operation.
  assert.ok(labels.length>REVIEW_OPERATION_REQUEST_LIMIT,`this fixture made only ${labels.length} requests; it must exceed the ${REVIEW_OPERATION_REQUEST_LIMIT}-request reviewer ceiling or it proves nothing: ${labels.join(',')}`)
  // ...and NOT because the ceiling or the reserve was widened to let it through, which
  // is the shortcut issue #2075 exists to prevent.
  assert.equal(REVIEW_OPERATION_REQUEST_LIMIT,25,'the reviewer ceiling must not be widened to make this pass (issue #2075)')
  assert.equal(REVIEW_MUTEX_SECTION_RESERVE,15,'the mutex-release reserve must not be touched to make this pass')
})

test('#2802 an inadmissible issue is still refused when admission is not charged to the reviewer budget',()=>{
  const {io,headSha,labels,mutexCreates}=wiredAdmittedReviewIo({closeOnMutex:true})
  assert.throws(()=>assignNextReviewer({issue:41,pr:7,headSha,admissionOptions:{admitIssue:41,pr:7}},io),/closed and cannot be admitted/)
  assert.equal(mutexCreates(),1)
  assert.equal(io.refs.has(MUTEX_REF),false,'a refused admission must not strand the reviewer mutex')
  assert.equal(io.refs.has(REVIEW_CURSOR_REF),false,'a refused admission must stop the draw before it consumes a sequence')
  assert.ok(labels.includes('getPrFiles'),'the refusal must come from the admission gate actually running')
})

test('#2705 reviewer assignment skips a provider that reconciled preflight says is unusable',()=>{
  const io=reviewIo(), skipped=ACTIVE_REVIEWERS[0]
  io.reviewerUsability=(reviewers)=>new Map(reviewers.map((row)=>[row.provider,{provider:row.provider,status:row.name===skipped.name?'quarantined':'ready',failure_class:row.name===skipped.name?'live-qualification-required':null,usable:row.name!==skipped.name}]))
  const assigned=assignNextReviewer({issue:2705,pr:2706,headSha:'a'.repeat(40)},io)
  assert.notEqual(assigned.reviewer,skipped.name)
  assert.equal(assigned.sequence,1,'skipping an unusable provider must not burn a durable sequence')
})

test('#2705 reviewer assignment refuses when reconciled preflight state is unreadable',()=>{
  const io=reviewIo()
  io.reviewerUsability=()=>{throw new LaneError('ai-review-preflight returned no reconciled state for gemini')}
  assert.throws(()=>assignNextReviewer({issue:2705,pr:2706,headSha:'b'.repeat(40)},io),/no reconciled state/)
  assert.equal(io.refs.has(REVIEW_CURSOR_REF),false,'an unreadable preflight must not consume a sequence')
})

test('#2705 reviewer assignment refuses malformed reconciled state before durable mutation',()=>{
  const io=reviewIo(),before=[...io.refs]
  io.reviewerUsability=()=>({usable:true})
  assert.throws(()=>assignNextReviewer({issue:2705,pr:2706,headSha:'c'.repeat(40)},io),/malformed reconciled/)
  assert.deepEqual([...io.refs],before)
})

// Production `githubIo` always defines the atomic compare-and-swap ref writer,
// and the exclusion RETURN path now refuses to run without it: retiring a
// durable assignment ref through a compare-then-delete fallback is not a
// compare-and-swap and can tear. Every test that excludes a reviewer who still
// holds a slot therefore has to offer the same primitive production offers.
function withAtomicRefs(io){
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{
    for(const change of changes)if((io.refs.get(change.ref)??null)!==(change.expected??null))throw new LaneError(`atomic reviewer ref transition failed: ${change.ref}`)
    for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}
  }
  io.readReviewStates=(rows)=>new Map(rows.map((row)=>[`${row.issue}:${row.pr}`,{issue:io.getIssue(),pr:io.getPr(row.pr),evidence:io.getIssueComments(row.pr)}]))
  return io
}

test('reviewer cursor advances atomically through the durable round robin',()=>{
  const io=reviewIo(), names=[]
  for(let n=1;n<=ACTIVE_REVIEWERS.length+1;n++)names.push(assignNextReviewer({issue:n,pr:100+n,headSha:`abcdef${n}`},io).reviewer)
  assert.deepEqual(names,[...ACTIVE_REVIEWERS.map((row)=>row.name),ACTIVE_REVIEWERS[0].name])
  assert.ok(io.refs.has(REVIEW_CURSOR_REF))
})

test('#2694 exact-head assignments let one reviewer hold concurrent independent reviews without overwriting either lease',()=>{
  const io=withAtomicRefs(reviewIo()),heads=new Map()
  io.requiresExactReviewHeadSha=true
  io.getPr=(pr)=>({number:Number(pr),state:'open',head:{sha:heads.get(Number(pr)),ref:'codex/x'}})
  const assigned=[]
  for(let n=0;n<=ACTIVE_REVIEWERS.length;n++){
    const request={issue:2694+n,pr:3694+n,headSha:n.toString(16).padStart(40,'a')}
    heads.set(request.pr,request.headSha)
    assigned.push(assignNextReviewer(request,io))
  }
  const first=assigned[0],again=assigned.at(-1)
  assert.equal(again.reviewer,first.reviewer,'round-robin may reuse a reviewer even while its earlier exact-head review is live')
  const firstRef=reviewActiveRef(first.reviewer,first),againRef=reviewActiveRef(again.reviewer,again)
  assert.notEqual(firstRef,againRef)
  assert.ok(io.refs.has(firstRef),'the first exact assignment lease remains intact')
  assert.ok(io.refs.has(againRef),'the concurrent exact assignment owns a separate lease')
  assert.equal(io.refs.get(firstRef),io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${first.issue}-${first.pr}-${first.headSha}`))
  assert.equal(io.refs.get(againRef),io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${again.issue}-${again.pr}-${again.headSha}`))
})

test('durable per-PR exclusion skips a truthfully disposed reviewer on a new head',()=>{
  const io=withAtomicRefs(reviewIo())
  io.getPr=()=>({number:1900,state:'open',head:{sha:'a'.repeat(40),ref:'codex/x'}})
  const first=assignNextReviewer({issue:1833,pr:1900,headSha:'a'.repeat(40)},io)
  const evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1900-${'a'.repeat(40)}`)
  const excluded=excludeReviewerForPr({issue:1833,pr:1900,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io)
  assert.deepEqual(parseReviewExclusion(io.getCommit(excluded.sha)),{reviewer:first.reviewer,issue:1833,pr:1900,reason:'already-reviewed',evidenceSha})
  io.getPr=()=>({state:'open',head:{sha:'b'.repeat(40),ref:'codex/x'}})
  const next=assignNextReviewer({issue:1833,pr:1900,headSha:'b'.repeat(40)},io)
  assert.notEqual(next.reviewer,first.reviewer)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-review-failures/1833-1900-')),false)
})

test('reviewer exclusion is idempotent and rejects false evidence or changed disposition',()=>{
  const io=withAtomicRefs(reviewIo())
  io.getPr=()=>({number:1901,state:'open',head:{sha:'c'.repeat(40),ref:'codex/x'}})
  const first=assignNextReviewer({issue:1833,pr:1901,headSha:'c'.repeat(40)},io)
  const evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1901-${'c'.repeat(40)}`),request={issue:1833,pr:1901,reviewer:first.reviewer,reason:'terminal-unavailable',evidenceSha}
  const one=excludeReviewerForPr(request,io),two=excludeReviewerForPr(request,io)
  assert.equal(two.sha,one.sha)
  assert.throws(()=>excludeReviewerForPr({...request,issue:1834},io),/evidence does not match/)
  assert.throws(()=>excludeReviewerForPr({...request,reason:'already-reviewed'},io),/different durable exclusion/)
})

// Excluding slot 1's reviewer now RETURNS slot 1's assignment, so slot 1 is
// re-assigned to a fresh reviewer before slot 2 is requested. The previous
// version of this test skipped straight to slot 2 while slot 1's ref still named
// the excluded reviewer -- which is exactly the state assertDurableReviewApproval
// can never be satisfied from, so that shortcut was never a usable route.
test('a same-head review continues in the next slot without fabricating a failure',()=>{
  const io=withAtomicRefs(reviewIo()),head='e'.repeat(40)
  io.getPr=()=>({number:1904,state:'open',head:{sha:head,ref:'codex/x'}})
  const first=assignNextReviewer({issue:1833,pr:1904,headSha:head},io),evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1904-${head}`)
  excludeReviewerForPr({issue:1833,pr:1904,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io)
  const replaced=assignNextReviewer({issue:1833,pr:1904,headSha:head},io)
  assert.notEqual(replaced.reviewer,first.reviewer)
  const next=assignNextReviewer({issue:1833,pr:1904,headSha:head,slot:2},io)
  assert.notEqual(next.reviewer,first.reviewer)
  assert.notEqual(next.reviewer,replaced.reviewer)
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
  const io=withAtomicRefs(reviewIo()),headA='a'.repeat(40),headB='b'.repeat(40)
  io.getPr=()=>({number:1903,state:'open',head:{sha:headA,ref:'codex/x'}})
  const first=assignNextReviewer({issue:1833,pr:1903,headSha:headA},io)
  io.getPr=()=>({state:'open',head:{sha:headB,ref:'codex/x'}})
  const second=assignNextReviewer({issue:1833,pr:1903,headSha:headB},io),evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1833-1903-${headB}`)
  excludeReviewerForPr({issue:1833,pr:1903,reviewer:second.reviewer,reason:'terminal-unavailable',evidenceSha},io)
  io.getPr=()=>({state:'open',head:{sha:headA,ref:'codex/x'}})
  const replacement=replaceFailedReviewer({issue:1833,pr:1903,headSha:headA,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  assert.notEqual(replacement.reviewer,second.reviewer)
})

test('active reviewer lease parser round-trips exact identity and fails closed',()=>{
  const reviewer=ACTIVE_REVIEWERS[0].name, message=`db-coordination reviewer-lease generation=7 reviewer=${reviewer} issue=1767 pr=1800 head=${'a'.repeat(40)} sequence=9`
  assert.deepEqual(parseReviewLease({message}),{generation:7,reviewer,issue:1767,pr:1800,headSha:'a'.repeat(40),sequence:9,slot:1})
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
  const io=reviewIo();let attempts=0,baseLoaded=false;io.enforceAdmission=true
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
  io.readReviewerOperationRoute=()=>{wire();return {pr:{state:'open',head:{sha:'a'.repeat(40)}},files:[{filename:'scripts/reviewer-tool.mjs',status:'modified'}],linkedIssues:[{number:1767,state:'open',createdAt:'2026-09-11T17:00:00Z',body:['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','service_class: maintenance','change_type: reviewer-tooling','priority: 5','depends_on:','objects:','```'].join('\n')}]}}
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
  const result=assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40),admissionOptions:{pr:1800}},io)
  assert.ok(result.reviewer);assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`used ${attempts} wire attempts`)
  assert.equal(attempts,22,`repository-maintenance assignment used ${attempts} requests; the single routing projection must keep the existing 25-request ceiling`)
  attempts=0
  assert.deepEqual(assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40),admissionOptions:{pr:1800}},io),result)
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
  assert.equal(attempts,23,`slot 2 used ${attempts} wire attempts; this fixture costs exactly 23 of the ${REVIEW_OPERATION_REQUEST_LIMIT}-request budget (21 before issue #2075 added one pre-mutex and one post-mutex durable-verdict listing). If this changed, re-derive the ceiling rather than widening it`)
  assert.equal(REVIEW_MUTEX_SECTION_RESERVE,15,'the mutex-section entry-gate reserve changed without this budget being re-derived')
  assert.equal(REVIEW_OPERATION_REQUEST_LIMIT,25,'the ceiling changed; re-derive it against the real cost rather than raising it again')
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
  assert.equal(mutexAt,9,'the first replacement path spends 9 requests before its mutex gate, including durable-verdict refusal and the durable-verdict listing that replaced comment-text trust (issue #2075)')
  assert.equal(labels.length-mutexAt,11,`new replacement success path costs exactly 11 requests after mutex acquisition: ${labels.slice(mutexAt).join(',')}`)
  attempts=0;labels.length=0
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),result)
  const retryMutexAt=labels.indexOf(`createRef:${MUTEX_REF}`)
  assert.notEqual(retryMutexAt,-1,`retry mutex acquisition was not observed: ${labels.join(',')}`)
  assert.equal(retryMutexAt,9,'the idempotent path spends 9 requests before its mutex gate because its predecessor failure ref rides in the fixed-record batch')
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
  io.refs.delete(reviewActiveRef('grok-4.6'))
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
  // No assertion that the drawn name is not codex: replacements draw from ACTIVE_REVIEWERS,
  // which the rotation test pins exactly, so such an assertion could never fail. The refusal of
  // a retired name is proved where it is enforced, in the eligibility and preflight tests.
})

// ACTIVE ROTATION (owner instruction, 2026-08-28). Codex GPT-5.6 Sol and DeepSeek
// were ordinary approved reviewers then; BOTH ARE RETIRED NOW (DeepSeek for
// fabricated reviews, Codex on 2026-09-06 for an exhausted account), so this
// fixture occupies whatever ACTIVE_REVIEWERS currently holds. All-busy must fail
// closed.
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
  const musePr=600+ACTIVE_REVIEWERS.findIndex((r)=>r.name==='muse-spark-1.3-contributor')
  const openPr=io.getPr
  io.getPr=(number)=>Number(number)===musePr?{number:musePr,state:'closed',head:{sha:heads.get(musePr)}}:openPr(number)
  assert.ok(!findBusyReviewers(io).has('muse-spark-1.3-contributor'))
  assert.equal(pickReviewer(1,io).name,'muse-spark-1.3-contributor')
})

test('a recorded verdict and a moved head both free the reviewer that held them',()=>{
  const grokIndex=ACTIVE_REVIEWERS.findIndex((row)=>row.name==='grok-4.6')
  const grokPr=600+grokIndex,grokIssue=500+grokIndex
  // A DURABLE verdict artifact tied to the exact head ends that review.
  const held=busyIo()
  giveVerdict(held.io,{issue:grokIssue,pr:grokPr,headSha:held.heads.get(grokPr)})
  assert.ok(!findBusyReviewers(held.io).has('grok-4.6'))
  // So does a push that moves the PR past the head the reviewer was given.
  const {io}=busyIo()
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
  // codex-gpt-5.6-sol was retired from the rotation on 2026-09-06 by owner
  // instruction after its account usage limit stayed exhausted for a full
  // session. Its row stays in REVIEWERS so durable artifacts naming it resolve.
  // kimi-k3 was unpaused on 2026-09-07 (owner instruction, PR #2483).
  assert.deepEqual(ACTIVE_REVIEWERS.map((r)=>r.name),['grok-4.6','glm-5.3','kimi-k3','qwen-3.8-max','muse-spark-1.3-contributor','gemini-3.8-flash-high'])
  assert.ok(RETIRED_REVIEWERS.includes('codex-gpt-5.6-sol'),'codex-gpt-5.6-sol must stay out of the rotation')
  assert.equal(reviewerReadsRepository('codex-gpt-5.6-sol'),true,'retiring the account must not invalidate the verdicts it already recorded')
  assert.deepEqual(OVERFLOW_REVIEWERS,[])
  assert.equal(REVIEWERS.find((r)=>r.name==='kimi-k3').wrapper,'ai-kimi')
  assert.equal(REVIEWERS.find((r)=>r.name==='codex-gpt-5.6-sol').wrapper,'ai-codex-review')
  assert.equal(REVIEWERS.find((r)=>r.name==='glm-5.3').wrapper,'ai-glm')
  assert.equal(REVIEWERS.find((r)=>r.name==='muse-spark-1.2-contributor').wrapper,'ai-muse')
  assert.ok(RETIRED_REVIEWERS.includes('muse-spark-1.2-contributor'),'the historical Muse 1.2 identity must remain readable but never receive new work')
  assert.ok(!ACTIVE_REVIEWERS.some((r)=>r.name==='muse-spark-1.2-contributor'),'the retired Muse 1.2 identity must never receive new work')
  assert.equal(REVIEWERS.find((r)=>r.name==='muse-spark-1.3-contributor').wrapper,'ai-muse')
  assert.equal(REVIEWERS.find((r)=>r.name==='deepseek-chat').wrapper,'ai-deepseek-agent')
  // Qwen is NOT retired (owner instruction, 2026-09-04) and must not be named as
  // retired anywhere. Its quarantine was lifted on 2026-09-07 after a live
  // qualification that actually passed (ai-devops PR #316, merge commit
  // 795902d8): the wrapper's credential handoff now survives the runtime's
  // startup re-exec and runs on the live Model Studio lane. The retirement half
  // is still asserted because dropping it re-introduces the false retirement
  // claim; the drawable half replaces the old undrawable assertion so a silent
  // re-quarantine cannot pass unnoticed.
  assert.ok(!RETIRED_REVIEWERS.includes('qwen-3.8-max'),'qwen-3.8-max must never be listed as retired')
  assert.deepEqual(QUARANTINED_REVIEWERS,[])
  assert.ok(ACTIVE_REVIEWERS.some((r)=>r.name==='qwen-3.8-max'),'live-qualified Qwen must be drawable')
  // Gemini was added on 2026-09-06 (ai-devops #285) only after a recorded live
  // safety qualification AND a live review that returned a well-formed verdict
  // above a substantive report. Its wrapper is asserted so a future rename cannot
  // quietly point the rotation at nothing.
  assert.equal(REVIEWERS.find((r)=>r.name==='gemini-3.8-flash-high').wrapper,'ai-gemini')
  assert.ok(ACTIVE_REVIEWERS.some((r)=>r.name==='gemini-3.8-flash-high'),'gemini-3.8-flash-high must be drawable')
  assert.equal(REVIEWERS.find((r)=>r.name==='qwen-3.8-max').wrapper,'ai-qwen')
})

test('deepseek-chat can never be drawn for a code review (#2078)',()=>{
  // The draw is the round robin over ACTIVE_REVIEWERS at every offset, so walking
  // a full cycle of every eligible orchestrator engine covers every reachable pick.
  assert.ok(!ACTIVE_REVIEWERS.some((r)=>r.name==='deepseek-chat'),'deepseek-chat must not be drawable')
  assert.ok(!OVERFLOW_REVIEWERS.some((r)=>r.name==='deepseek-chat'),'deepseek-chat must not be reachable through overflow')
  assert.ok(RETIRED_REVIEWERS.includes('deepseek-chat'))
  for(const engine of ['claude','codex'])assert.ok(!reviewersForOrchestrator(engine).some((r)=>r.name==='deepseek-chat'))
  // ...and it is still readable, because durable refs on PR #1989 name it.
  assert.equal(REVIEWERS.find((r)=>r.name==='deepseek-chat').wrapper,'ai-deepseek-agent')
})

test('the roster records, per reviewer, whether its wrapper reads the repository (#2078)',()=>{
  // Verified against each wrapper in ai-devops/bin, not assumed. Every reviewer
  // that stays drawable hands its model a real checkout it can open files in.
  for(const row of ACTIVE_REVIEWERS)assert.equal(reviewerReadsRepository(row.name),true,`${row.name} (${row.wrapper}) must read the repository under review to stay drawable`)
  assert.equal(reviewerReadsRepository('deepseek-chat'),false)
  assert.equal(reviewerReadsRepository('nobody-at-all'),false,'an unknown reviewer must fail closed')
  assert.equal(reviewerReadsRepository(undefined),false)
})

// ---------------------------------------------------------------------------
// Issue #2127: the marker resolver exits non-zero for answers it is CERTAIN of.
// `--resolve` exits 3 for `state: none` and 1 for ambiguous/invalid/unsafe, so a
// bare try/catch around execFileSync turned a correct answer into "could not be
// resolved" and froze reviewer assignment repository-wide with zero markers open.
//
// `exitingResolver` reproduces the exact spawn failure shape execFileSync throws:
// a non-zero status with the JSON still on `error.stdout`.
const exitingResolver=(stdout,status)=>()=>{const error=new Error(`Command failed: node scripts/check-orchestrator-marker.mjs --resolve --json`);error.status=status;error.stdout=stdout;throw error}
const NONE_JSON=JSON.stringify({state:'none',routing:null,message:'NO ACTIVE ORCHESTRATOR: zero open markers.'})
const AMBIGUOUS_JSON=JSON.stringify({state:'ambiguous',routing:null,message:'AMBIGUOUS and UNSAFE: 2 open markers (#10, #11).'})

test('zero open markers is an ANSWER, not a resolver failure (#2127)',()=>{
  const resolved=readOrchestratorResolution(exitingResolver(NONE_JSON,3))
  assert.equal(resolved.state,'none')
  // The whole point of the fix: `state: none` excludes nothing, so it must not
  // refuse, and it must never be described as an unresolvable/unreadable engine.
  assert.equal(orchestratorEngineFromResolution(resolved),null)
  assert.deepEqual(reviewersForOrchestrator(null).map((row)=>row.name),ACTIVE_REVIEWERS.map((row)=>row.name))
})

test('a genuinely broken resolver is still refused, and named as a run failure (#2127)',()=>{
  // Nothing parseable on stdout -- a crash, a missing file, exit 2 UNKNOWN.
  assert.throws(()=>readOrchestratorResolution(exitingResolver('',2)),(error)=>{
    assert.ok(error instanceof LaneError)
    assert.match(error.message,/resolver could not be run/)
    return true
  })
  assert.throws(()=>readOrchestratorResolution(()=>{throw Object.assign(new Error('spawn ENOENT'),{stdout:undefined})}),/resolver could not be run/)
  // Output that is present but not JSON is a fault too, and says so distinctly.
  assert.throws(()=>readOrchestratorResolution(exitingResolver('<html>502 Bad Gateway</html>',1)),/resolver produced unreadable output/)
  assert.throws(()=>readOrchestratorResolution(()=>JSON.stringify({routing:null})),/returned no state/)
})

test('two open markers still fail closed, and the refusal names ambiguity (#2127)',()=>{
  const resolved=readOrchestratorResolution(exitingResolver(AMBIGUOUS_JSON,1))
  assert.equal(resolved.state,'ambiguous')
  assert.throws(()=>orchestratorEngineFromResolution(resolved),(error)=>{
    assert.ok(error instanceof LaneError)
    assert.match(error.message,/marker is ambiguous/)
    assert.doesNotMatch(error.message,/could not be resolved/)
    return true
  })
  for(const state of ['invalid','unsafe'])assert.throws(()=>orchestratorEngineFromResolution({state,routing:null}),new RegExp(`marker is ${state}`))
  // A declared marker still excludes its own engine, unchanged.
  assert.equal(orchestratorEngineFromResolution({state:'declared',routing:{engine:'Claude'}}),'claude')
  assert.throws(()=>orchestratorEngineFromResolution({state:'declared',routing:{}}),/declares no engine/)
})

test('with no orchestrator running the full rotation is drawable (#2127)',()=>{
  const io=reviewIo();io.resolveOrchestratorEngine=()=> null
  const assigned=[]
  for(let n=1;n<=ACTIVE_REVIEWERS.length;n++)assigned.push(assignNextReviewer({issue:7100+n,pr:8100+n,headSha:n.toString(16).padStart(40,'c')},io).reviewer)
  for(const row of ACTIVE_REVIEWERS)assert.ok(assigned.includes(row.name),`${row.name} must be drawable when no orchestrator marker is open`)
  // An io with no resolver at all is still UNREADABLE and still refuses --
  // `undefined` must never be read as "no orchestrator is running".
  assert.throws(()=>reviewersForOrchestrator(undefined),/engine is unreadable/)
})

test('the orchestrator engine is never eligible to review its own work',()=>{
  // grok-4.6, PR #2484: `reviewersForOrchestrator('codex')` defaults to
  // ACTIVE_REVIEWERS, and since the 2026-09-06 retirement that list cannot hold
  // codex whatever the engine filter does -- so the default form proves nothing
  // any more. The filter is now asserted against REVIEWERS, which still carries
  // the only row with an orchestratorEngine, plus the synthetic list below.
  assert.ok(REVIEWERS.some((row)=>row.name==='codex-gpt-5.6-sol'&&row.orchestratorEngine==='codex'))
  assert.ok(!reviewersForOrchestrator('codex',REVIEWERS).some((row)=>row.name==='codex-gpt-5.6-sol'))
  const future=[{name:'claude-opus',orchestratorEngine:'claude'},{name:'deepseek-chat'}]
  assert.deepEqual(reviewersForOrchestrator('claude',future).map((row)=>row.name),['deepseek-chat'])
  assert.throws(()=>reviewersForOrchestrator('',future),/engine is unreadable/)
})

test('a Codex orchestrator draws the whole active roster and still refuses the retired Codex reviewer',()=>{
  // grok-4.6, PR #2484: asserting that a Codex orchestrator does not DRAW codex
  // became tautological once codex was retired -- retirement alone satisfies it.
  // The invariant worth pinning now is the other one: no ACTIVE reviewer carries
  // an orchestrator engine, so a live Codex orchestrator must cost the rotation
  // nothing at all. If a future roster adds an engine-carrying reviewer, this
  // assertion is the one that notices.
  const io=reviewIo();io.resolveOrchestratorEngine=()=> 'codex'
  const assigned=[]
  for(let n=1;n<=ACTIVE_REVIEWERS.length;n++)assigned.push(assignNextReviewer({issue:700+n,pr:800+n,headSha:n.toString(16).padStart(40,'a')},io).reviewer)
  assert.deepEqual([...assigned].sort(),ACTIVE_REVIEWERS.map((row)=>row.name).sort(),'a Codex orchestrator must not narrow the current roster')
  // grok-4.6, round 2: `assert.ok(!assigned.includes('codex-...'))` used to sit
  // here and is gone -- `assigned` was just asserted equal to ACTIVE_REVIEWERS,
  // which cannot contain a retired name, so it could not fail for any reason.
  //
  // The preflight refusal below is kept, but say what it now proves: a RETIRED
  // name is refused execution. It is not engine coverage. `reviewerExecutionPreflight`
  // resolves through `reviewersForOrchestrator()` with its ACTIVE_REVIEWERS
  // default and takes no roster argument, so the case it used to cover -- an
  // ACTIVE, engine-matching reviewer refused at execution time -- cannot be
  // built at this call site at all while no active reviewer carries an engine.
  // Swapping the resolver to 'claude' below would throw the same error. The
  // engine filter itself is covered non-vacuously in 'the orchestrator engine is
  // never eligible to review its own work', against REVIEWERS and a synthetic
  // roster; the assertion above is what would notice an engine-carrying name
  // re-entering the active roster and make this call site meaningful again.
  const preflight={...preflightIo(),resolveOrchestratorEngine:()=> 'codex'}
  assert.throws(()=>reviewerExecutionPreflight({reviewer:'codex-gpt-5.6-sol',wrapper:'ai-codex-review',worktree:'C:/review',headSha:failedReview.headSha},preflight),/approved reviewer/)
})

test('reviewer assignment retry returns the same assignment without advancing',()=>{
  const io=reviewIo(), request={issue:9,pr:109,headSha:'abcdef9'}
  const first=assignNextReviewer(request,io), second=assignNextReviewer(request,io)
  assert.deepEqual(second,first)
  assert.equal(second.sequence,1)
})

test('assignment retry refuses a terminal release completed after preflight but before mutex acquisition',()=>{
  const io=reviewIo(),request={issue:9,pr:109,headSha:'9'.repeat(40)},first=assignNextReviewer(request,io),leaseRef=reviewActiveRef(first.reviewer)
  const createRef=io.createRef;let interleave=true
  io.createRef=(ref,sha)=>{
    if(interleave&&ref===MUTEX_REF){
      interleave=false
      io.refs.delete(leaseRef)
      const releaseSha=io.makeOwnerCommit(`db-coordination reviewer-failure-release reviewer=${first.reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${first.sequence} code=turn_limit_cancelled verdict=none artifact=none replacement=none`)
      io.refs.set(`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${first.sequence}`,releaseSha)
    }
    return createRef(ref,sha)
  }
  assert.throws(()=>assignNextReviewer(request,io),/terminal failure was released/)
  assert.equal(io.refs.get(leaseRef)??null,null)
})

test('assignment fails closed when the bounded reviewer index was never activated',()=>{
  const io=reviewIo();io.refs.delete(REVIEW_ACTIVE_CUTOVER_REF)
  assert.throws(()=>assignNextReviewer({issue:1767,pr:1800,headSha:'a'.repeat(40)},io),/cutover is incomplete/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('assignment retry releases its lease after an exact-head verdict',()=>{
  const io=reviewIo(),headSha='abcdef9'.padEnd(40,'0'),request={issue:9,pr:109,headSha}
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:headSha,ref:'codex/x'}})
  const first=assignNextReviewer(request,io),ref=reviewActiveRef(first.reviewer)
  giveVerdict(io,{issue:9,pr:109,headSha})
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
    evidence:[],
  }]))
  giveVerdict(io,{issue:1224,pr:1957,headSha})
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
  // RETIRED_REVIEWERS[0] is positional, so assert the property the test actually
  // needs -- that this name cannot be drawn -- rather than trusting the index.
  const io=reviewIo(),request={issue:99,pr:199,headSha:'6'.repeat(40)},reviewer=RETIRED_REVIEWERS[0]
  assert.ok(!ACTIVE_REVIEWERS.some((r)=>r.name===reviewer),`${reviewer} must be ineligible for this test to mean anything`)
  io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=7 reviewer=${reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`,sha)
  assert.throws(()=>assignNextReviewer(request,io),/retired, quarantined or orchestrator-conflicting reviewer/)
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
  const io=mergedPrIo()
  giveVerdict(io,{issue:mergedRequest.issue,pr:mergedRequest.pr,headSha:MERGED_HEAD})
  assert.throws(()=>assignNextReviewer(mergedRequest,io),/changed after mutex acquisition/)
})

const failedReview={issue:9,pr:109,headSha:'abcdef9000000000000000000000000000000000'}
function failedReviewIo(){const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}});assignNextReviewer(failedReview,io);return io}
const replacementRequest={...failedReview,failedSequence:1,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}

test('terminal provider failure advances exactly once and retry is idempotent',()=>{
  const io=failedReviewIo(), first=replaceFailedReviewer(replacementRequest,io), second=replaceFailedReviewer(replacementRequest,io)
  assert.equal(first.sequence,2);assert.equal(first.reviewer,'glm-5.3');assert.deepEqual(second,first)
  assert.equal(first.replacementSequence,1,'the recorder needs the ref suffix, not the allocation cursor')
  assert.equal(io.refs.get(first.assignmentRef),first.replacementSha)
  assert.ok(first.assignmentRef.endsWith(`-${first.replacementSequence}`))
  assert.equal(assignNextReviewer(failedReview,io).replacementSequence,first.replacementSequence)
  assert.equal(assignNextReviewer(failedReview,io).reviewer,'glm-5.3')
  assert.equal(assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io).reviewer,'kimi-k3')
})

test('a retired reviewer is replaced cleanly, without an exclusion deadlock (#2078)',()=>{
  // The live consequence of retiring deepseek-chat: PR #1989 holds a durable
  // assignment naming it. --assign-reviewer now refuses that head ("belongs to a
  // retired reviewer ... Record a governed replacement"), so --replace-failed-reviewer
  // is the route. This proves the route works for a name that is in REVIEWERS but
  // NOT in ACTIVE_REVIEWERS: the failed name only has to RESOLVE, never to be eligible.
  const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}})
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=deepseek-chat issue=${failedReview.issue} pr=${failedReview.pr} head=${failedReview.headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`,sha)
  io.refs.set(reviewActiveRef('deepseek-chat'),sha)
  io.refs.set(REVIEW_CURSOR_REF,sha)
  assert.throws(()=>assignNextReviewer(failedReview,io),/belongs to a retired, quarantined or orchestrator-conflicting reviewer[\s\S]*Record a governed replacement for this exact head/)
  const replacement=replaceFailedReviewer({...replacementRequest,failureCode:'wrapper_terminal_failure'},io)
  assert.equal(replacement.reviewer,'glm-5.3')
  assert.equal(reviewerReadsRepository(replacement.reviewer),true,'the replacement must be a reviewer that reads the code')
  assert.equal(io.refs.get(reviewActiveRef('deepseek-chat'))??null,null,'the retired reviewer lease is released')
  assert.equal(io.refs.get(reviewActiveRef('glm-5.3')),replacement.replacementSha)
  // Idempotent, exactly as for any other replacement.
  assert.deepEqual(replaceFailedReviewer({...replacementRequest,failureCode:'wrapper_terminal_failure'},io),replacement)
})

test('a failed reviewer holding an UNRELATED live lease no longer blocks its own replacement (#2106)',()=>{
  // ISSUE #2106 -- the second reviewer-pool deadlock mode. The reviewer that
  // failed on THIS head has since been drawn onto a different review. A reviewer
  // holds at most one lease, so that proves the lease this failure is about was
  // already released. Replacement used to refuse outright, and freeing every
  // OTHER reviewer in the pool could not clear it: only this one reviewer going
  // idle would. During marker #2074 two assignments each needed four draws.
  const io=failedReviewIo()
  const failedName='grok-4.6'
  assert.equal(io.refs.has(reviewActiveRef(failedName)),true,'the fixture must start with the failed reviewer holding its own lease')
  // Same head so the unrelated lease is LIVE, not stale -- the point of the test
  // is an active unrelated review, not a leftover to be swept.
  const unrelated=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=99 reviewer=${failedName} issue=777 pr=778 head=${failedReview.headSha}`)
  io.refs.set(reviewActiveRef(failedName),unrelated)
  let protectedByCas=false
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  const applyAtomic=(changes)=>{
    for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null)
    for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}
  }
  io.atomicReviewRefs=(changes)=>{
    if(changes.some((change)=>change.ref===`${REVIEW_REPLACEMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-1`)){
      const preservation=changes.find((change)=>change.ref===reviewActiveRef(failedName))
      assert.deepEqual(preservation,{ref:reviewActiveRef(failedName),expected:unrelated,sha:unrelated},'the unrelated lease must be protected by the same atomic compare-and-swap')
      protectedByCas=true
    }
    applyAtomic(changes)
  }
  io.atomicReviewMutexRelease=(ownerSha)=>applyAtomic([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(protectedByCas,true)
  assert.equal(replacement.reviewer,'glm-5.3')
  assert.equal(io.refs.get(reviewActiveRef(failedName)),unrelated,'the unrelated review must be left exactly as it was found')
  assert.equal(io.refs.get(reviewActiveRef('glm-5.3')),replacement.replacementSha)
  // Still idempotent, and still does not touch the unrelated lease on retry.
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),replacement)
  assert.equal(io.refs.get(reviewActiveRef(failedName)),unrelated)
})

test('a MATCHING failed lease is still released, and the relaxation is not a blanket one (#2106)',()=>{
  // The control for the test above. Nothing about a lease that genuinely belongs
  // to this failure changes: it is still released, and the outcome does not claim
  // it was already gone.
  const io=failedReviewIo()
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(io.refs.get(reviewActiveRef('grok-4.6'))??null,null,'the matching failed lease is released exactly as before')
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
  io.readReviewRecords=(refs,prefix,dependentFailurePrefix)=>{wire(prefix?2:1,'readReviewRecords');const matching=prefix?[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha,commit:rawGetCommit(sha)})):[];const dependent=dependentFailurePrefix?matching.flatMap(({ref})=>{const suffix=ref.startsWith(`${prefix}-`)?ref.slice(prefix.length+1):'';return /^\d+$/.test(suffix)?[`${dependentFailurePrefix}-${suffix}`]:[]}):[];const result=new Map(reviewRecordRefs([...refs,...dependent],matching).map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}));Object.defineProperty(result,'matching',{value:matching});return result}
  for(const name of ['readRef','getCommit','createRef']){const fn=io[name];io[name]=(...args)=>{wire(1,`${name}:${String(args[0])}`);return fn(...args)}}
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(message)=>{wire(1,'commit');return make(message)}
  const first=replaceFailedReviewer(replacementRequest,io)
  const second=replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence},io)
  attempts=0;labels.length=0
  const third=replaceFailedReviewer({...replacementRequest,failedSequence:second.sequence},io)
  assert.ok(third.reviewer)
  const mutexAt=labels.indexOf(`createRef:${MUTEX_REF}`)
  assert.equal(mutexAt,9,`third terminal-provider replacement pre-mutex accounting drifted: ${labels.join(',')}`)
  assert.equal(labels.length-mutexAt,10,`third terminal-provider replacement post-mutex accounting drifted: ${labels.join(',')}`)
  assert.equal(attempts,19,`third terminal-provider replacement wire accounting drifted: ${labels.join(',')}`)
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`third terminal-provider replacement used ${attempts} wire attempts`)
  const source=readFileSync(new URL('./manage-migration-author-lanes.mjs',import.meta.url),'utf8')
  assert.match(source,/const allRefs=reviewRecordRefs\(\[\.\.\.refs,\.\.\.dependentFailures\],matches\)/,'the production batch must include every immutable matching replacement, predecessor failure and verdict ref')
  assert.match(source,/record\?\.sha===row\.sha&&record\?\.commit\?\.message\?record\.commit:undefined/,'matching replacement rows may reuse a batched commit only after exact SHA and message validation')
})

test('released slot-2 replacement with slot-1 approval and a reinstated reviewer fits the 25-request budget (#2550)',()=>{
  const io=doctoredIo(),request={issue:2550,pr:2551,headSha:'25'.repeat(20)}
  // Reproduce the live eligibility history: Grok was excluded as terminally
  // unavailable, then returned to this PR only through fresh wrapper-doctor
  // proof. The original exclusion remains immutable beside its reinstatement.
  const excluded=excludeFor(io,{issue:request.issue,pr:request.pr,reason:'terminal-unavailable'})
  assert.equal(excluded.reviewer,'grok-4.6')
  const reinstated=reinstateReviewerExclusion({issue:request.issue,pr:request.pr,reviewer:excluded.reviewer},io)
  assert.equal(io.refs.get(reviewReinstatementRef({issue:request.issue,pr:request.pr,reviewer:excluded.reviewer})),reinstated.sha)

  const busyPr=9550,busyHead='9'.repeat(40)
  io.getPr=(number)=>Number(number)===busyPr?{state:'open',head:{sha:busyHead}}:{state:'open',head:{sha:request.headSha}}
  const slotOne=assignNextReviewer(request,io)
  const slotTwo=assignNextReviewer({...request,slot:2},io)
  assert.equal(slotOne.reviewer,'glm-5.3')
  assert.equal(slotTwo.reviewer,'kimi-k3')
  giveVerdict(io,{...request,slot:1})
  const firstReplacement=replaceFailedReviewer({...request,slot:2,failedSequence:slotTwo.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  assert.equal(firstReplacement.reviewer,'qwen-3.8-max')
  // Reproduce the live #2509 chain exactly: the predecessor was assigned while
  // Muse 1.2 was drawable, then that catalogued name retired. Its active ref now
  // belongs to unrelated work, so replacement must carry the historical row in
  // the one lease snapshot without making Muse 1.2 eligible for a new draw.
  const retiredName='muse-spark-1.2-contributor'
  const retiredPredecessorSha=io.makeOwnerCommit(io.getCommit(firstReplacement.replacementSha).message.replace(`reviewer=${firstReplacement.reviewer}`,`reviewer=${retiredName}`))
  io.refs.set(firstReplacement.assignmentRef,retiredPredecessorSha)
  io.refs.set(`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${slotTwo.sequence}`,retiredPredecessorSha)
  io.refs.delete(reviewActiveRef(firstReplacement.reviewer))
  io.refs.set(reviewActiveRef(retiredName),retiredPredecessorSha)
  const releasedRequest={...request,slot:2,failedSequence:firstReplacement.sequence,failureCode:'local_dependency_unavailable',failingCheck:'review-wrapper-no-explicit-base-packet',confirmLocalDependencyUnfixable:true,confirmNoVerdict:true,confirmNoArtifact:true}
  const released=releaseFailedReviewer(releasedRequest,io)
  assert.equal(io.refs.get(reviewActiveRef(retiredName))??null,null)

  // The next rotation candidate is busy elsewhere, making the freshly
  // reinstated Grok record materially necessary to the successful draw.
  const busyReviewers=['muse-spark-1.3-contributor','gemini-3.8-flash-high']
  for(const [index,name] of busyReviewers.entries()){
    const busySha=io.makeOwnerCommit(`db-coordination reviewer-lease generation=1 reviewer=${name} issue=9550 pr=${busyPr} head=${busyHead} sequence=${9550+index}`)
    io.refs.set(reviewActiveRef(name),busySha)
  }
  const unrelatedRetiredSha=io.makeOwnerCommit(`db-coordination reviewer-lease generation=1 reviewer=${retiredName} issue=${busyPr} pr=${busyPr} head=${busyHead} sequence=9549`)
  io.refs.set(reviewActiveRef(retiredName),unrelatedRetiredSha)

  let attempts=0;const labels=[],batched=[];const rawGetCommit=io.getCommit
  const wire=(n=1,label='wire')=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{attempts++;labels.push(label);return '{}'}})}
  io.getRateLimit=()=>{wire(2,'quota');return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire(1,'active');return new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:rawGetCommit(sha)}]))}
  io.readReviewStates=(leases)=>{wire(1,'states');return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.pr===busyPr?busyHead:request.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>{wire(1,'readReviewRefs');return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{wire(1,'atomicReviewRefs');for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  io.readReviewRecords=(refs,prefix,dependentFailurePrefix)=>{
    wire(prefix?2:1,'readReviewRecords')
    const matching=prefix?[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha,commit:rawGetCommit(sha)})):[]
    const dependent=dependentFailurePrefix?matching.flatMap(({ref})=>{const suffix=ref.startsWith(`${prefix}-`)?ref.slice(prefix.length+1):'';return /^\d+$/.test(suffix)?[`${dependentFailurePrefix}-${suffix}`]:[]}):[]
    batched.push(...dependent)
    const result=new Map(reviewRecordRefs([...refs,...dependent],matching).map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}))
    Object.defineProperty(result,'matching',{value:matching});return result
  }
  for(const name of ['readRef','listRefs','getCommit','createRef']){const fn=io[name];io[name]=(...args)=>{wire(1,`${name}:${String(args[0])}`);return fn(...args)}}
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(message)=>{wire(1,'commit');return make(message)}

  const replacement=replaceFailedReviewer(releasedRequest,io)
  assert.equal(replacement.reviewer,'grok-4.6','the reinstated independent reviewer must be drawable again')
  assert.equal(replacement.failureSha,released.failureSha,'the replacement must adopt the immutable release record')
  assert.ok(batched.includes(`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${slotTwo.sequence}`),'the predecessor failure must ride in the fixed-record batch')
  assert.equal(attempts,23,`released slot-2 replacement wire accounting drifted: ${labels.join(',')}`)
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`released slot-2 replacement used ${attempts} requests: ${labels.join(',')}`)
  assert.equal(labels.some((label)=>label.startsWith(`readRef:${REVIEW_FAILURE_REF_PREFIX}/`)),false,'batched predecessor evidence must not be reread individually')
  assert.equal(labels.includes(`readRef:${reviewActiveRef(retiredName)}`),false,'catalogued retired reviewer lease must reuse the complete snapshot')
  assert.equal(labels.includes(`getCommit:${unrelatedRetiredSha}`),false,'catalogued retired reviewer lease commit must reuse the complete snapshot')
  assert.equal(io.refs.get(reviewActiveRef(retiredName)),unrelatedRetiredSha,'the unrelated retired-reviewer lease must remain unchanged')
  assert.equal(io.refs.get(replacement.assignmentRef),replacement.replacementSha,'the exact replacement assignment ref must read back')

  attempts=0;labels.length=0;batched.length=0
  assert.deepEqual(replaceFailedReviewer(releasedRequest,io),replacement)
  assert.equal(attempts,22,`released slot-2 idempotent retry wire accounting drifted: ${labels.join(',')}`)
  assert.ok(attempts<=REVIEW_OPERATION_REQUEST_LIMIT,`idempotent retry used ${attempts} requests: ${labels.join(',')}`)
  assert.equal(labels.some((label)=>label.startsWith(`readRef:${REVIEW_FAILURE_REF_PREFIX}/`)),false,'idempotent retry must reuse the same fixed evidence snapshot')
})

test('replacement retry releases its lease after an exact-head verdict',()=>{
  const io=failedReviewIo(),first=replaceFailedReviewer(replacementRequest,io),ref=reviewActiveRef(first.reviewer)
  giveVerdict(io,{issue:failedReview.issue,pr:failedReview.pr,headSha:failedReview.headSha})
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
  io.getRateLimit=()=>{wire(2+(REVIEW_OPERATION_REQUEST_LIMIT-20));return {remaining:5000,graphRemaining:5000,reset:1787943986,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire();return new Map()}
  io.readReviewStates=(leases)=>{wire();return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))}
  for(const name of ['createRef','readRef','deleteRef']){const fn=io[name];io[name]=(...args)=>{wire();return fn(...args)}}
  io.readReviewRefs=(refs)=>{wire();proofReads++;return new Map(refs.map((ref)=>[ref,ref===MUTEX_REF&&proofReads===1?null:io.refs.get(ref)??null]))}
  assert.throws(()=>assignNextReviewer({issue:97,pr:197,headSha:'4'.repeat(40)},io),/exhausted its derived 25-request budget/)
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
  assert.ok(!ACTIVE_REVIEWERS.some((r)=>r.name===reviewer),`${reviewer} must be ineligible for this test to mean anything`)
  const sha=io.makeOwnerCommit(`db-coordination reviewer-failure-replacement sequence=${sequence} reviewer=${reviewer} issue=${failedReview.issue} pr=${failedReview.pr} head=${failedReview.headSha} failed-sequence=1 prior-sequence=1 failure-ref=self failed-reviewer=grok-4.6 code=provider_unavailable verdict=none artifact=none`)
  io.refs.set(`${REVIEW_REPLACEMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-1`,sha)
  io.refs.set(`refs/db-review-failures/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-1`,sha)
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/retired, quarantined or orchestrator-conflicting reviewer/)
  assert.throws(()=>assignNextReviewer(failedReview,io),/retired, quarantined or orchestrator-conflicting reviewer/)
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

test('an ineligible reviewer stays readable but receives no new assignment',()=>{
  // AMENDED 2026-09-01 (#2079). This test previously asserted that the
  // cursor-echo branch HANDS BACK the ineligible reviewer. That was the defect,
  // not the contract: the branch created the durable assignment ref and returned
  // an ineligible name while taking no lease, so no verdict could ever follow --
  // wasted work, and a refusal inconsistent with the prior-assignment path four
  // lines above it. What the test was really protecting -- that an ineligible
  // name stays READABLE forever, because durable refs name it -- is asserted
  // directly below and unchanged.
  //
  // REPOINTED 2026-09-07. This used to be written around 'qwen-3.8-max', which is
  // drawable again after its live qualification passed, so it can no longer
  // demonstrate ineligibility. It now uses the RETIRED 'codex-gpt-5.6-sol'. The
  // contract under test is unchanged and still covers exactly one ineligible
  // name; only the example moved.
  const ineligible='codex-gpt-5.6-sol'
  const io=reviewIo(), request={issue:9,pr:109,headSha:'abcdef9'}
  const historical=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=64 reviewer=${ineligible} issue=9 pr=109 head=abcdef9`)
  io.refs.set(REVIEW_CURSOR_REF,historical)
  // Still readable: the historical cursor parses and the name resolves.
  assert.equal(parseReviewCursor(io.getCommit(historical)).reviewer,ineligible)
  assert.equal(REVIEWERS.find((row)=>row.name===ineligible)?.wrapper,'ai-codex-review')
  assert.throws(()=>assignNextReviewer(request,io),/belongs to a retired, quarantined or orchestrator-conflicting reviewer[\s\S]*Record a governed replacement for this exact head/)
  // Refused BEFORE any side effect: no assignment ref, no lease.
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_ASSIGNMENT_REF_PREFIX)),false)
  assert.equal(io.refs.get(reviewActiveRef(ineligible))??null,null)
  const next=assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io)
  assert.notEqual(next.reviewer,ineligible)
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
  giveVerdict(io,{issue:failedReview.issue,pr:failedReview.pr,headSha:failedReview.headSha})
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
  assert.equal(ACTIVE_REVIEWERS.length,6,'this test describes the approved six-reviewer rotation (deepseek-chat retired, #2078; gemini-3.8-flash-high added 2026-09-06; codex-gpt-5.6-sol retired 2026-09-06; kimi-k3 unpaused 2026-09-07; qwen-3.8-max unquarantined 2026-09-07)')
  const io=failedReviewIo()
  assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io)
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(replacement.reviewer,'kimi-k3')
})

test('N-1 intervening assignments skip the failed provider instead of stranding the replacement',()=>{
  assert.equal(ACTIVE_REVIEWERS.length,6,'this test describes the approved six-reviewer rotation (deepseek-chat retired, #2078; gemini-3.8-flash-high added 2026-09-06; codex-gpt-5.6-sol retired 2026-09-06; kimi-k3 unpaused 2026-09-07; qwen-3.8-max unquarantined 2026-09-07)')
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

test('release frees a terminally failed lease when every reviewer slot is full',()=>{
  const io=failedReviewIo()
  for(let n=0;n<ACTIVE_REVIEWERS.length-1;n+=1)assignNextReviewer({issue:2100+n,pr:2200+n,headSha:`${n+1}`.repeat(40)},io)
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha===null)io.refs.delete(change.ref);else io.refs.set(change.ref,change.sha)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  assert.equal(findBusyReviewers(io).size,ACTIVE_REVIEWERS.length)
  let refusal=null
  try{replaceFailedReviewer(replacementRequest,io)}catch(error){refusal=error}
  assert.match(refusal?.message??'',/no replacement reviewer is available|no other reviewer is available/)
  assert.match(refusal.message,new RegExp(`1 of ${ACTIVE_REVIEWERS.length} already failed on this exact head`))
  assert.match(refusal.message,new RegExp(`${ACTIVE_REVIEWERS.length-1} of ${ACTIVE_REVIEWERS.length} hold other live leases`))
  assert.match(refusal.message,/glm-5\.3 #2100\/PR #2200/)
  const cursorBefore=io.refs.get(REVIEW_CURSOR_REF)
  const released=releaseFailedReviewer(replacementRequest,io)
  assert.equal(released.reviewer,'grok-4.6')
  assert.equal(io.refs.get(reviewActiveRef(released.reviewer))??null,null)
  assert.equal(findBusyReviewers(io).size,ACTIVE_REVIEWERS.length-1)
  assert.equal(io.refs.get(REVIEW_CURSOR_REF),cursorBefore,'release must not move the rotation cursor')
  assert.throws(()=>assignNextReviewer(failedReview,io),/terminal failure was released/,'an assignment retry must not recreate a terminally released lease')
  assert.throws(()=>releaseFailedReviewer(replacementRequest,io),/already released/,'release evidence is create-only and retry-safe')
})

// #2694 round 2, and the regression the round-1 code did NOT have. The
// already-released retry used to answer "is a lease still present?" by reading
// ONE ref name and testing it for non-emptiness. Under the one-provider ref name
// that question cannot tell THIS job's lease from a completely unrelated SIBLING
// job the same provider is running: the moment grok-4.6 picked up any other
// work, an honest retry of a release that had already succeeded was answered
// with "reconciliation requires manual audit" -- a false corruption alarm that
// sends an operator hand-editing refs a live job is using. The retry now PROVES
// a candidate ref holds this exact assignment tuple before treating it as this
// job's outstanding lease.
//
// RED/GREEN: replace `leaseRefHoldsAssignment(...)` in the already-released
// branch of `releaseFailedReviewer` with the round-1 `io.readRef(ref)!==null`
// and this test fails on the manual-audit refusal instead.
test('a release retry does not mistake a live sibling job for the outstanding lease of this job (#2694)',()=>{
  const io=failedReviewIo()
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha===null)io.refs.delete(change.ref);else io.refs.set(change.ref,change.sha)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  const released=releaseFailedReviewer(replacementRequest,io)
  assert.equal(released.reviewer,'grok-4.6')
  const leaseRef=reviewActiveRef('grok-4.6')
  assert.equal(io.refs.get(leaseRef)??null,null,'the released job hands its own lease back')
  // The SAME provider now holds a lease for a DIFFERENT job. Nothing about this
  // job changed: its release evidence is still immutable and still complete.
  const siblingSha=io.makeOwnerCommit('db-coordination reviewer-cursor sequence=7 reviewer=grok-4.6 issue=4242 pr=4343 head=cafe000000000000000000000000000000000000 slot=1')
  io.refs.set(leaseRef,siblingSha)
  assert.throws(()=>releaseFailedReviewer(replacementRequest,io),/already released/,'the sibling lease must not be read as the outstanding lease of this job')
  assert.equal(io.refs.get(leaseRef),siblingSha,'the lease of the sibling job is left exactly as it was')
  // POSITIVE CONTROL: when the ref really does hold THIS job's lease again, the
  // manual-audit refusal still fires, so the check above is not simply disabled.
  const ownSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=grok-4.6 issue=${failedReview.issue} pr=${failedReview.pr} head=${failedReview.headSha} slot=1`)
  io.refs.set(leaseRef,ownSha)
  assert.throws(()=>releaseFailedReviewer(replacementRequest,io),/reconciliation requires manual audit/)
})

test('terminal release resolves the historical unsuffixed first replacement record',()=>{
  const io=failedReviewIo(),reviewer='glm-5.3',sequence=2,base=`${REVIEW_REPLACEMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`
  const sha=io.makeOwnerCommit(`db-coordination reviewer-failure-replacement sequence=${sequence} reviewer=${reviewer} issue=${failedReview.issue} pr=${failedReview.pr} head=${failedReview.headSha} failed-sequence=1 prior-sequence=1 failure-ref=self failed-reviewer=grok-4.6 code=provider_unavailable verdict=none artifact=none`)
  io.refs.set(base,sha);io.refs.set(`${REVIEW_FAILURE_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}-1`,sha);io.refs.delete(reviewActiveRef('grok-4.6'));io.refs.set(reviewActiveRef(reviewer),sha)
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha===null)io.refs.delete(change.ref);else io.refs.set(change.ref,change.sha)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  const released=releaseFailedReviewer({...replacementRequest,failedSequence:sequence},io)
  assert.equal(released.reviewer,reviewer)
  assert.equal(io.refs.get(reviewActiveRef(reviewer))??null,null)
})

test('saturation release instructions preserve slot and local dependency evidence',()=>{
  const command=failedReviewerReleaseCommand({...replacementRequest,slot:2},{failureCode:'local_dependency_unavailable',failingCheck:'reviewer doctor service'})
  assert.match(command,/--review-slot 2/)
  assert.match(command,/--failing-check "reviewer doctor service"/)
  assert.match(command,/--confirm-local-dependency-unfixable/)
  assert.match(command,/--confirm-no-verdict --confirm-no-artifact$/)
})

test('review lease age is truthful for known and unknown commit dates',()=>{
  assert.equal(reviewLeaseAgeHours('2026-09-01T00:00:00Z',new Date('2026-09-01T12:00:00Z')),12)
  assert.equal(reviewLeaseAgeHours(null,new Date('2026-09-01T12:00:00Z')),null)
  assert.equal(reviewLeaseAgeHours('not-a-date',new Date('2026-09-01T12:00:00Z')),null)
})

test('capacity report classifies free, live, stale, aged, and unknown leases without mutation',()=>{
  const io=reviewIo(),snapshot=new Map(),states=new Map(),now=new Date('2026-09-02T12:00:00Z')
  // One case per active reviewer: six, after codex-gpt-5.6-sol was retired on
  // 2026-09-06, kimi-k3 was unpaused on 2026-09-07 and qwen-3.8-max was
  // unquarantined on 2026-09-07. 'moved' and 'verdict' both
  // reach 'stale-reclaimable' but by different routes, and both are proved:
  // 'verdict' occupies two slots here, and 'moved' is proved below by moving a
  // head under a lease that this pass classified as live.
  const cases=[
    {kind:'live',date:'2026-09-02T11:00:00Z'},
    {kind:'verdict',date:'2026-09-02T10:00:00Z'},
    {kind:'aged',date:'2026-08-31T00:00:00Z'},
    {kind:'unknown',date:null},
    {kind:'verdict',date:'2026-09-02T10:00:00Z'},
    {kind:'live',date:'2026-09-02T11:00:00Z'},
  ]
  const heads=new Map()
  cases.forEach((entry,index)=>{
    const reviewer=ACTIVE_REVIEWERS[index],issue=2300+index,pr=2400+index,headSha=`${index+1}`.repeat(40),sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${index+1} reviewer=${reviewer.name} issue=${issue} pr=${pr} head=${headSha}`),commit={...io.getCommit(sha),committedDate:entry.date}
    io.refs.set(reviewActiveRef(reviewer.name),sha);snapshot.set(reviewActiveRef(reviewer.name),{sha,commit})
    heads.set(index,`${issue}:${pr}`)
    states.set(`${issue}:${pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:headSha}},evidence:[]})
    if(entry.kind==='verdict')giveVerdict(io,{issue,pr,headSha})
  })
  assert.equal(cases.length,ACTIVE_REVIEWERS.length,'every reviewer must carry a lease for the occupied pass')
  io.readActiveReviewLeases=()=>snapshot
  io.readReviewStates=()=>states
  const before=new Map(io.refs),report=reviewerCapacityReport(io,now)
  assert.deepEqual(report.reviewers.map((row)=>row.classification),['live','stale-reclaimable','suspect-aged','unknown','stale-reclaimable','live'])
  assert.deepEqual(report.summary,{total:6,free:0,live:3,reclaimable:2,silenceProbed:0,silenceReclaimable:0,unknown:1})
  assert.deepEqual(io.refs,before,'capacity report must be read-only')
  // The OTHER route to 'stale-reclaimable': the reviewed head moved out from
  // under a lease this same pass just called live. No recorded verdict involved.
  const livePair=states.get(heads.get(0))
  states.set(heads.get(0),{...livePair,pr:{...livePair.pr,head:{sha:'f'.repeat(40)}}})
  assert.deepEqual(reviewerCapacityReport(io,now).reviewers.map((row)=>row.classification),['stale-reclaimable','stale-reclaimable','suspect-aged','unknown','stale-reclaimable','live'])
  states.set(heads.get(0),livePair)
  // 'free' is the fifth classification and it is a property of an ABSENT lease, so
  // it is proved by removing one rather than by needing a spare roster name.
  const freed=ACTIVE_REVIEWERS.at(-1).name
  snapshot.delete(reviewActiveRef(freed));io.refs.delete(reviewActiveRef(freed))
  const withFree=reviewerCapacityReport(io,now)
  assert.deepEqual(withFree.reviewers.map((row)=>row.classification),['live','stale-reclaimable','suspect-aged','unknown','stale-reclaimable','free'])
  assert.deepEqual(withFree.summary,{total:6,free:1,live:2,reclaimable:2,silenceProbed:0,silenceReclaimable:0,unknown:1})
})

function silentLeaseIo({heldSince='2026-09-04T10:00:00Z',activity=[]}={}){
  const io=withAtomicRefs(reviewIo()),request={issue:2345,pr:2237,headSha:'a'.repeat(40),slot:1}
  io.enableReviewerSilence=true
  io.getPr=()=>({number:request.pr,state:'open',draft:true,head:{sha:request.headSha}})
  const assigned=assignNextReviewer(request,io),leaseRef=reviewActiveRef(assigned.reviewer),leaseSha=io.refs.get(leaseRef),rawGet=io.getCommit
  io.getCommit=(sha)=>sha===leaseSha?{...rawGet(sha),committedDate:heldSince}:rawGet(sha)
  io.readLeaseActivity=()=>({issueComments:activity,reviewComments:[],reviews:[],checkRuns:[],workflowRuns:[]})
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  return {io,request,assigned,leaseRef,leaseSha}
}

test('silence fingerprint changes on reviewer progress and ignores an unrelated main dispatch',()=>{
  const fixture=silentLeaseIo(),lease={...fixture.assigned,slot:1}
  const first=activityFingerprintForLease(lease,fixture.io)
  fixture.io.readLeaseActivity=()=>({issueComments:[{updated_at:'2026-09-04T12:30:00Z'}],reviewComments:[],reviews:[],checkRuns:[],workflowRuns:[]})
  const second=activityFingerprintForLease(lease,fixture.io)
  assert.notEqual(first.fingerprint,second.fingerprint)
  assert.equal(first.lastActivityIso,'none','a workflow run not returned for the lease head cannot count as reviewer activity')
})

test('a genuinely working lane cannot be probed or reclaimed after one comment',()=>{
  const active=silentLeaseIo({activity:[{updated_at:'2026-09-04T12:30:00Z'}]})
  assert.throws(()=>probeSilentReviewer({...active.request,failedSequence:active.assigned.sequence},new Date('2026-09-04T13:00:00Z'),active.io),/activity occurred after/)
  const quiet=silentLeaseIo(),options={...quiet.request,failedSequence:quiet.assigned.sequence,confirmNoVerdict:true,confirmNoArtifact:true}
  probeSilentReviewer(options,new Date('2026-09-04T12:00:00Z'),quiet.io)
  quiet.io.readLeaseActivity=()=>({issueComments:[{updated_at:'2026-09-04T13:00:00Z'}],reviewComments:[],reviews:[],checkRuns:[],workflowRuns:[]})
  assert.throws(()=>reclaimSilentReviewer(options,new Date('2026-09-04T14:00:00Z'),quiet.io),/fingerprint changed/)
  assert.equal(quiet.io.refs.get(quiet.leaseRef),quiet.leaseSha)
})

test('the six-hour #2237 shape probes and reclaims after an unchanged confirmation window',()=>{
  const {io,request,assigned,leaseRef}=silentLeaseIo(),options={...request,failedSequence:assigned.sequence,confirmNoVerdict:true,confirmNoArtifact:true}
  const probe=probeSilentReviewer(options,new Date('2026-09-04T12:00:00Z'),io)
  assert.ok(probe.probeRef.startsWith(REVIEW_SILENCE_PROBE_REF_PREFIX))
  assert.throws(()=>reclaimSilentReviewer(options,new Date('2026-09-04T13:59:59Z'),io),/at least 2 hours/)
  const released=reclaimSilentReviewer(options,new Date('2026-09-04T14:00:00Z'),io)
  assert.ok(released.releaseSha);assert.equal(io.refs.get(leaseRef)??null,null)
  assert.ok([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_SILENCE_RELEASE_REF_PREFIX)))
  assert.equal(TERMINAL_FAILURE_CODES.length,6)
  assert.equal(TERMINAL_FAILURE_CODES.includes('silent_worker_observed'),false)
  assert.throws(()=>assignNextReviewer(request,io),/silent lease was reclaimed/)
  const replacement=replaceFailedReviewer({...options,failureCode:'silent_worker_observed'},io)
  assert.notEqual(replacement.reviewer,assigned.reviewer)
})

test('capacity reports a silence probe and only calls it reclaimable after confirmation',()=>{
  const {io,request,assigned}=silentLeaseIo(),options={...request,failedSequence:assigned.sequence}
  probeSilentReviewer(options,new Date('2026-09-04T12:00:00Z'),io)
  const waiting=reviewerCapacityReport(io,new Date('2026-09-04T13:00:00Z')).reviewers.find((row)=>row.reviewer===assigned.reviewer)
  assert.equal(waiting.classification,'silence-probed');assert.equal(waiting.lastActivityIso,'none');assert.ok(waiting.silenceProbe?.sha)
  const ready=reviewerCapacityReport(io,new Date('2026-09-04T14:00:00Z')).reviewers.find((row)=>row.reviewer===assigned.reviewer)
  assert.equal(ready.classification,'silence-reclaimable')
})

test('silent reclaim frees a slot even when the entire reviewer pool is occupied',()=>{
  const fixture=silentLeaseIo(),heads=new Map([[fixture.request.pr,fixture.request.headSha]]),baseGetPr=fixture.io.getPr
  ACTIVE_REVIEWERS.filter((row)=>row.name!==fixture.assigned.reviewer).forEach((row,index)=>{
    const issue=2400+index,pr=2500+index,headSha=`${index+2}`.repeat(40),sha=fixture.io.makeOwnerCommit(`db-coordination reviewer-lease generation=${index+2} reviewer=${row.name} issue=${issue} pr=${pr} head=${headSha} sequence=${index+2}`)
    fixture.io.refs.set(reviewActiveRef(row.name),sha);heads.set(pr,headSha)
  })
  fixture.io.getPr=(pr)=>heads.has(Number(pr))?{number:Number(pr),state:'open',draft:false,head:{sha:heads.get(Number(pr))}}:baseGetPr(pr)
  fixture.io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:fixture.io.getPr(lease.pr),evidence:[]}]))
  assert.equal(findBusyReviewers(fixture.io).size,ACTIVE_REVIEWERS.length)
  const options={...fixture.request,failedSequence:fixture.assigned.sequence,confirmNoVerdict:true,confirmNoArtifact:true}
  probeSilentReviewer(options,new Date('2026-09-04T12:00:00Z'),fixture.io)
  reclaimSilentReviewer(options,new Date('2026-09-04T14:00:00Z'),fixture.io)
  assert.equal(findBusyReviewers(fixture.io).size,ACTIVE_REVIEWERS.length-1)
  const next={issue:2600,pr:2700,headSha:'f'.repeat(40)};heads.set(next.pr,next.headSha)
  assert.equal(assignNextReviewer(next,fixture.io).reviewer,fixture.assigned.reviewer)
})

test('a four-minute stale-reclaimable lease is untouchable by both silence commands',()=>{
  const fixture=silentLeaseIo({heldSince:'2026-09-04T12:00:00Z'}),moved='b'.repeat(40),original=fixture.io.getPr
  fixture.io.getPr=()=>({...original(),head:{sha:moved}})
  const options={...fixture.request,failedSequence:fixture.assigned.sequence,confirmNoVerdict:true,confirmNoArtifact:true}
  assert.throws(()=>probeSilentReviewer(options,new Date('2026-09-04T12:04:00Z'),fixture.io),/live lease|exact open PR head/)
  assert.throws(()=>reclaimSilentReviewer(options,new Date('2026-09-04T16:00:00Z'),fixture.io),/prior silence probe/)
  const matching=silentLeaseIo({heldSince:'2026-09-04T12:00:00Z'})
  assert.throws(()=>probeSilentReviewer({...matching.request,failedSequence:matching.assigned.sequence},new Date('2026-09-04T12:04:00Z'),matching.io),/at least 2 hours/)
})

test('reviewer queue serves the oldest live ticket and drops a moved-head ticket',()=>{
  const io=reviewIo(),heads=new Map([[301,'a'.repeat(40)],[302,'b'.repeat(40)]])
  io.enableReviewerQueue=true;io.getPr=(pr)=>({number:Number(pr),state:'open',head:{sha:heads.get(Number(pr))}})
  const requestedAt=new Date(Date.now()-60*60*1000).toISOString()
  const olderSha=io.makeOwnerCommit(`db-coordination reviewer-queue-ticket issue=201 pr=301 slot=1 head=${'a'.repeat(40)} requested-at=${requestedAt}`)
  io.refs.set(`${REVIEW_QUEUE_REF_PREFIX}/201-301-1`,olderSha)
  assert.throws(()=>assignNextReviewer({issue:202,pr:302,headSha:'b'.repeat(40)},io),/older ticket #201/)
  const firstMutexWrite=io.calls.findIndex((call)=>call[0]==='create'&&call[1]===MUTEX_REF),firstQueueWrite=io.calls.findIndex((call)=>call[0]==='create'&&call[1]===`${REVIEW_QUEUE_REF_PREFIX}/202-302-1`)
  assert.ok(firstMutexWrite>=0&&firstMutexWrite<firstQueueWrite,'queue tickets must be serialized under the reviewer mutex')
  const first=assignNextReviewer({issue:201,pr:301,headSha:'a'.repeat(40)},io)
  assert.ok(first.reviewer);assert.equal(io.refs.has(`${REVIEW_QUEUE_REF_PREFIX}/201-301-1`),false)
  const staleSha=io.makeOwnerCommit(`db-coordination reviewer-queue-ticket issue=203 pr=303 slot=1 head=${'c'.repeat(40)} requested-at=2026-09-04T09:00:00.000Z`)
  io.refs.set(`${REVIEW_QUEUE_REF_PREFIX}/203-303-1`,staleSha);heads.set(303,'d'.repeat(40))
  assert.ok(assignNextReviewer({issue:202,pr:302,headSha:'b'.repeat(40)},io).reviewer)
})

test('an abandoned head-of-line reviewer ticket expires and cannot wedge later assignments',()=>{
  const io=reviewIo(),heads=new Map([[305,'a'.repeat(40)],[306,'b'.repeat(40)]])
  io.enableReviewerQueue=true;io.getPr=(pr)=>({number:Number(pr),state:'open',head:{sha:heads.get(Number(pr))}})
  const expiredAt=new Date(Date.now()-3*60*60*1000).toISOString()
  const expiredSha=io.makeOwnerCommit(`db-coordination reviewer-queue-ticket issue=205 pr=305 slot=1 head=${'a'.repeat(40)} requested-at=${expiredAt}`)
  io.refs.set(`${REVIEW_QUEUE_REF_PREFIX}/205-305-1`,expiredSha)
  assert.ok(assignNextReviewer({issue:206,pr:306,headSha:'b'.repeat(40)},io).reviewer)
  assert.equal(io.refs.has(`${REVIEW_QUEUE_REF_PREFIX}/205-305-1`),false)
})

test('a failed head-of-line assignment evacuates its own ticket immediately',()=>{
  const io=reviewIo(),request={issue:207,pr:307,headSha:'c'.repeat(40)}
  io.enableReviewerQueue=true;io.getPr=()=>({number:307,state:'open',head:{sha:request.headSha}})
  for(const reviewer of ACTIVE_REVIEWERS){const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=20 reviewer=${reviewer.name} issue=999 pr=998 head=${'d'.repeat(40)}`);io.refs.set(reviewActiveRef(reviewer.name),sha)}
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  assert.throws(()=>assignNextReviewer(request,io),/no reviewer is available/)
  assert.equal(io.refs.has(`${REVIEW_QUEUE_REF_PREFIX}/207-307-1`),false)
})

test('an unreadable reviewer queue does not invent a FIFO refusal',()=>{
  const io=reviewIo(),request={issue:204,pr:304,headSha:'e'.repeat(40)}
  io.enableReviewerQueue=true;io.getPr=()=>({number:304,state:'open',head:{sha:request.headSha}})
  const list=io.listRefs;io.listRefs=(prefix)=>{if(prefix===REVIEW_QUEUE_REF_PREFIX)throw new Error('unreadable queue');return list(prefix)}
  assert.ok(assignNextReviewer(request,io).reviewer)
})

test('live reviewer draws have no global FIFO: a later PR draws a free provider past an older ticket (marker #2758)',()=>{
  assert.equal(githubIo.enableReviewerQueue,false)
  const io=reviewIo(),heads=new Map([[311,'a'.repeat(40)],[312,'b'.repeat(40)]])
  io.enableReviewerQueue=githubIo.enableReviewerQueue;io.getPr=(pr)=>({number:Number(pr),state:'open',head:{sha:heads.get(Number(pr))}})
  const olderSha=io.makeOwnerCommit(`db-coordination reviewer-queue-ticket issue=211 pr=311 slot=1 head=${'a'.repeat(40)} requested-at=${new Date(Date.now()-3600000).toISOString()}`)
  io.refs.set(`${REVIEW_QUEUE_REF_PREFIX}/211-311-1`,olderSha)
  const second=assignNextReviewer({issue:212,pr:312,headSha:'b'.repeat(40)},io)
  const first=assignNextReviewer({issue:211,pr:311,headSha:'a'.repeat(40)},io)
  assert.ok(second.reviewer&&first.reviewer);assert.notEqual(second.reviewer,first.reviewer)
})

test('a reviewer draw retries only a briefly occupied review mutex',()=>{
  const io=reviewIo(),request={issue:213,pr:313,headSha:'c'.repeat(40)},waits=[]
  io.enableReviewerQueue=false;io.getPr=()=>({number:313,state:'open',head:{sha:request.headSha}})
  const create=io.createRef.bind(io);let blocked=1
  io.createRef=(ref,sha)=>{if(ref===MUTEX_REF&&blocked>0){blocked--;return false}return create(ref,sha)}
  assert.ok(assignWithMutexRetry(request,io,{wait:(ms)=>waits.push(ms)}).reviewer)
  assert.equal(waits.length,1)
  assert.ok(waits[0]>=300000,'lock-contention retry waits at least five minutes')
  const io2=reviewIo();io2.enableReviewerQueue=false;io2.getPr=()=>({number:313,state:'open',head:{sha:request.headSha}});io2.createRef=(ref,sha)=>ref===MUTEX_REF?false:true
  assert.throws(()=>assignWithMutexRetry(request,io2,{attempts:3,wait:()=>{}}),/is occupied/)
  const io3=reviewIo();io3.enableReviewerQueue=false
  const waits3=[]
  assert.throws(()=>assignWithMutexRetry({...request,headSha:'not-a-sha'},io3,{attempts:3,wait:(ms)=>waits3.push(ms)}),(error)=>!/is occupied/.test(error.message))
  assert.equal(waits3.length,0,'a failure other than mutex occupation is never retried')
})

test('capacity report distinguishes an unreadable verdict from no verdict and keeps the other rows visible (issue #2157)',()=>{
  const io=reviewIo(),reviewer=ACTIVE_REVIEWERS[0],issue=2157,pr=2239,headSha='a7'.repeat(20)
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=${reviewer.name} issue=${issue} pr=${pr} head=${headSha}`)
  const snapshot=new Map([[reviewActiveRef(reviewer.name),{sha,commit:{...io.getCommit(sha),committedDate:'2026-09-03T12:00:00Z'}}]])
  const states=new Map([[`${issue}:${pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:headSha}},evidence:[]}]])
  io.readActiveReviewLeases=()=>snapshot
  io.readReviewStates=()=>states
  const listRefs=io.listRefs
  io.listRefs=(prefix)=>{
    if(prefix.startsWith(DURABLE_VERDICT_REF_NAMESPACE))throw new Error('GitHub verdict namespace unreadable')
    return listRefs(prefix)
  }
  const report=reviewerCapacityReport(io,new Date('2026-09-03T13:00:00Z'))
  const row=report.reviewers.find((entry)=>entry.reviewer===reviewer.name)
  assert.equal(row.verdictPresent,null)
  assert.equal(row.verdictReadError,'GitHub verdict namespace unreadable')
  assert.equal(row.classification,'unknown')
  assert.equal(report.summary.unknown,1)
  assert.equal(report.reviewers.length,ACTIVE_REVIEWERS.length,'one unreadable lease must not hide the other reviewers')
  const free=report.reviewers.find((entry)=>entry.held===false)
  assert.equal(free.verdictPresent,false)
  assert.equal(free.verdictReadError,null)
})

test('release refuses a verdict or a changed lease under the mutex',()=>{
  const verdictIo=failedReviewIo()
  giveVerdict(verdictIo,{issue:failedReview.issue,pr:failedReview.pr,headSha:failedReview.headSha})
  assert.throws(()=>releaseFailedReviewer(replacementRequest,verdictIo),/verdict/)
  const changed=failedReviewIo(),leaseRef=reviewActiveRef('grok-4.6'),real=changed.refs.get(leaseRef),commit=changed.getCommit(real)
  changed.getCommit=(sha)=>sha===real?{message:commit.message.replace('sequence=1','sequence=99')}:reviewIo().getCommit(sha)
  assert.throws(()=>releaseFailedReviewer(replacementRequest,changed),/does not match/)
})

test('release refuses when a verdict appears after preflight and changes no ref',()=>{
  const io=failedReviewIo();let reads=0,verdictListings=0,injected=null
  io.readReviewStates=(leases)=>{reads+=1;return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))}
  // The verdict ARTIFACT lands between the preflight listing and the
  // mutex-protected re-listing, which is the race this test exists for.
  const rawListRefs=io.listRefs
  io.listRefs=(prefix)=>{
    if(prefix===DURABLE_VERDICT_REF_NAMESPACE&&++verdictListings===2)injected=giveVerdict(io,{issue:failedReview.issue,pr:failedReview.pr,headSha:failedReview.headSha})
    return rawListRefs(prefix)
  }
  const before=new Map(io.refs)
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha===null)io.refs.delete(change.ref);else io.refs.set(change.ref,change.sha)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  assert.throws(()=>releaseFailedReviewer(replacementRequest,io),/changed after mutex acquisition/)
  assert.equal(reads,2,'the verdict must appear only on the mutex-protected recheck')
  // The verdict artifact the fixture injects mid-run is the race, not a
  // coordination ref the release wrote. Everything else must be untouched.
  const after=new Map(io.refs)
  assert.ok(injected&&after.delete(injected),'the race fixture must have injected the durable verdict artifact')
  assert.deepEqual(after,before,'a post-preflight verdict must preserve every coordination ref')
})

test('a governed replacement adopts immutable release evidence after capacity becomes available',()=>{
  const io=failedReviewIo()
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha===null)io.refs.delete(change.ref);else io.refs.set(change.ref,change.sha)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  const released=releaseFailedReviewer(replacementRequest,io),failureRef=[...io.refs.keys()].find((ref)=>ref.startsWith('refs/db-review-failures/'))
  assert.equal(io.refs.get(failureRef),released.failureSha)
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(replacement.reviewer,'glm-5.3')
  assert.equal(replacement.failureSha,released.failureSha,'replacement must adopt, not overwrite, the release evidence')
  assert.equal(io.refs.get(failureRef),released.failureSha)
  assert.equal(io.refs.get(reviewActiveRef(replacement.reviewer)),replacement.replacementSha)
})

test('assignment retry cannot recreate a terminally released replacement reviewer lease',()=>{
  const io=failedReviewIo(),replacement=replaceFailedReviewer(replacementRequest,io)
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha===null)io.refs.delete(change.ref);else io.refs.set(change.ref,change.sha)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  releaseFailedReviewer({...replacementRequest,failedSequence:replacement.sequence,failureCode:'turn_limit_cancelled'},io)
  assert.equal(io.refs.get(reviewActiveRef(replacement.reviewer))??null,null)
  assert.throws(()=>assignNextReviewer(failedReview,io),/terminal failure was released/)
  assert.equal(io.refs.get(reviewActiveRef(replacement.reviewer))??null,null)
})

test('reviewer replacement rejects a substantive exact-head verdict',()=>{
  const io=failedReviewIo();giveVerdict(io,{issue:failedReview.issue,pr:failedReview.pr,headSha:failedReview.headSha})
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/existing verdict/)
  // A REPLACEMENT verdict artifact for the same head counts too.
  const stateIo=failedReviewIo();giveVerdict(stateIo,{issue:failedReview.issue,pr:failedReview.pr,headSha:failedReview.headSha,replacementSequence:1})
  assert.throws(()=>replaceFailedReviewer(replacementRequest,stateIo),/existing verdict/)
})

test('reviewer replacement retry rejects mismatched failure sequence and missing evidence',()=>{
  const io=failedReviewIo(), done=replaceFailedReviewer(replacementRequest,io)
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:99},io),/does not match/)
  // Use the production-shaped fixed-record batch and forbid a fallback read so
  // both negative controls exercise the optimized path itself.
  const rawGetCommit=io.getCommit,rawReadRef=io.readRef
  io.readReviewRecords=(refs,prefix,dependentFailurePrefix)=>{
    const matching=prefix?[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha,commit:rawGetCommit(sha)})):[]
    const dependent=dependentFailurePrefix?matching.flatMap(({ref})=>{const suffix=ref.startsWith(`${prefix}-`)?ref.slice(prefix.length+1):'';return /^\d+$/.test(suffix)?[`${dependentFailurePrefix}-${suffix}`]:[]}):[]
    const result=new Map(reviewRecordRefs([...refs,...dependent],matching).map((ref)=>{const sha=io.refs.get(ref);return [ref,sha?{sha,commit:rawGetCommit(sha)}:null]}))
    Object.defineProperty(result,'matching',{value:matching});return result
  }
  io.readRef=(ref)=>{if(ref.startsWith(`${REVIEW_FAILURE_REF_PREFIX}/`))throw new Error('individual failure-ref reread is forbidden');return rawReadRef(ref)}
  const failureRef=[...io.refs.keys()].find((ref)=>ref.startsWith('refs/db-review-failures/'));io.refs.delete(failureRef)
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/evidence is missing/)
  io.refs.set(failureRef,io.makeOwnerCommit('unrelated immutable record'))
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/evidence is missing or changed/)
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

test('issue 1688 routes non-migration pull requests through the guarded merge lane', () => {
  const io=memoryIo()
  io.getPr=()=>({number:7,head:{sha:'docs-head',ref:'codex/docs'},base:{sha:'main'}})
  io.getPrFiles=()=>[{path:'docs/operations.md',status:'modified'}]
  const lock=acquireExclusive('merge',{owner:'docs',pr:7,headSha:'docs-head'},io)
  assert.equal(lock.ref,EXCLUSIVE_REFS.merge)
  releaseOwnedRef(EXCLUSIVE_REFS.merge,lock.ownerSha,io)
  io.getPrFiles=()=>[{path:'supabase/migrations/20990101000000_change.sql',status:'added'}]
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'migration-without-claim',pr:7,headSha:'docs-head'},io),
    /requires exactly one live author claim/,
  )
  io.getPrFiles=()=>{throw new Error('GitHub unavailable')}
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'unknown-files',pr:7,headSha:'docs-head'},io),
    /cannot read pull request files/,
  )
})

test('issue 1688 permits success only after the appropriate merge lock is acquired', () => {
  const leaseWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/migration-author-lease.yml',import.meta.url)),'utf8')
  const mergeWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/guarded-migration-merge.yml',import.meta.url)),'utf8')
  const documentsWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/documents-only-merge-authorization.yml',import.meta.url)),'utf8')
  const productionWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/shared-supabase-migrations.yml',import.meta.url)),'utf8')
  assert.doesNotMatch(leaseWorkflow,/state=success[^\n]+Migration guarded merge authorization/)
  assert.match(mergeWorkflow,/--acquire-merge[\s\S]+state=success[^\n]+Migration guarded merge authorization/)
  assert.match(documentsWorkflow,/check-documents-only-merge-authorization\.mjs[\s\S]+--authorize-repository-maintenance-status/)
  assert.doesNotMatch(documentsWorkflow,/--acquire-(?:preview|merge|production)/)
  const acquire=productionWorkflow.indexOf('name: Acquire the exclusive production lane and freeze merges')
  const revoke=productionWorkflow.indexOf('name: Revoke every pre-existing merge authorization while frozen')
  const release=productionWorkflow.indexOf('name: Release the exclusive production lane with ownership proof')
  assert.ok(acquire >= 0 && acquire < revoke && revoke < release)
  assert.match(productionWorkflow.slice(revoke,release),/state=failure[\s\S]+Migration guarded merge authorization/)
  assert.match(productionWorkflow,/production-apply:[\s\S]+permissions:[\s\S]+statuses: write/)
})

test('database-only workflow acquisitions supply admission while guarded merge rederives its route', () => {
  const files=['guarded-migration-merge.yml','shared-supabase-migrations.yml','preview-ledger-orphan-reconciliation.yml']
  const commands=[]
  for(const file of files){
    const source=readFileSync(fileURLToPath(new URL(`../.github/workflows/${file}`,import.meta.url)),'utf8')
    const lines=source.split(/\r?\n/)
    for(let index=0;index<lines.length;index++){
      if(!/manage-migration-author-lanes\.mjs --acquire-/.test(lines[index]))continue
      let command=lines[index].trim()
      while(command.endsWith('\\'))command+=`\n${lines[++index].trim()}`
      commands.push(`${file}: ${command}`)
    }
  }
  assert.equal(commands.length,4,commands.join('\n'))
  for(const command of commands){
    assert.match(command,/--pr\s+\S+/,command)
    if(command.startsWith('guarded-migration-merge.yml:')){
      assert.doesNotMatch(command,/--admit-issue\s+\S+/,command)
      assert.match(command,/--head-sha\s+\S+/,command)
    }else assert.match(command,/--admit-issue\s+\S+/,command)
  }
})

test('reviewer routing GraphQL projection is complete and treats every rename as explicit evidence',()=>{
  const body=['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','service_class: maintenance','change_type: reviewer-tooling','priority: 5','depends_on:','objects:','```'].join('\n')
  const response={data:{repository:{pullRequest:{state:'OPEN',merged:false,mergedAt:null,headRefOid:'a'.repeat(40),files:{pageInfo:{hasNextPage:false},nodes:[{path:'scripts/new.mjs',changeType:'RENAMED'}]},closingIssuesReferences:{pageInfo:{hasNextPage:false},nodes:[{number:41,state:'OPEN',body,createdAt:'2026-09-11T17:00:00Z'}]}}}}}
  const snapshot=projectReviewerOperationRouteSnapshot(response)
  assert.equal(snapshot.files[0].status,'renamed');assert.equal(snapshot.linkedIssues[0].number,41)
  for(const mutate of [
    value=>value.data.repository.pullRequest.files.pageInfo.hasNextPage=true,
    value=>value.data.repository.pullRequest.closingIssuesReferences.pageInfo.hasNextPage=true,
    value=>value.data.repository.pullRequest.files.nodes=null,
  ]){const value=structuredClone(response);mutate(value);assert.throws(()=>projectReviewerOperationRouteSnapshot(value),/incomplete or paginated/)}
})

test('guarded merge rederives deterministic repository maintenance inside its mutex',()=>{
  const io=memoryIo(),head='a'.repeat(40),comments=[];io.enforceAdmission=true
  io.getPr=()=>({number:7,state:'open',head:{sha:head,ref:'codex/tooling'},base:{sha:'main'}})
  io.getPrFiles=()=>[{filename:'scripts/tool.mjs',path:'scripts/tool.mjs',status:'modified'}]
  io.closingIssuesForPr=()=>[{number:41}]
  io.getIssue=()=>({number:41,state:'open',createdAt:'2026-09-11T17:00:00Z',body:['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','service_class: maintenance','change_type: workflow','priority: 5','depends_on:','objects:','```'].join('\n')})
  io.commentIssue=(_number,body)=>comments.push(body)
  const oldLog=console.log,oldError=console.error;console.log=()=>{};console.error=()=>{}
  try{assert.equal(main(['--acquire-merge','--owner','tooling','--pr','7','--head-sha',head],NOW,io),0)}finally{console.log=oldLog;console.error=oldError}
  assert.ok(io.refs.has(EXCLUSIVE_REFS.merge));assert.equal(io.refs.has(MUTEX_REF),false);assert.equal(comments.length,0)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-claims/')),false);assert.equal(io.refs.has(EXCLUSIVE_REFS.preview),false)
})

test('guarded merge derives and admits its one live linked structural issue',()=>{
  const {io,headSha:head}=admittedReviewIo()
  io.getPr=(number)=>({number:Number(number),state:'open',merged_at:null,head:{sha:head,ref:'codex/x'},base:{sha:'b'.repeat(40)}})
  io.mainSha=()=> 'b'.repeat(40)
  io.openClaims=()=>[{number:99,body:claimBody({version:'20260911120000',writes:['table core.example'],reads:[],owner:'author',branch:'codex/x',worktree:'C:/w/x',expiresAt:new Date('2026-09-13T00:00:00Z')})}]
  const result=acquireExclusive('merge',{owner:'tooling',pr:7,headSha:head,admissionOptions:{pr:7}},io)
  assert.ok(result.ownerSha);assert.ok(io.refs.has(EXCLUSIVE_REFS.merge));assert.equal(io.refs.has(MUTEX_REF),false)
})

test('guarded merge cannot route unknown inventory as repository maintenance',()=>{
  const io=memoryIo(),head='a'.repeat(40);io.enforceAdmission=true
  io.getPr=()=>({number:7,state:'open',head:{sha:head,ref:'codex/tooling'},base:{sha:'main'}})
  io.closingIssuesForPr=()=>[{number:41}]
  io.getIssue=()=>({number:41,state:'open',createdAt:'2026-09-11T17:00:00Z',body:['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','service_class: maintenance','change_type: workflow','priority: 5','depends_on:','objects:','```'].join('\n')})
  io.getPrFiles=()=>[]
  assert.throws(()=>acquireExclusive('merge',{owner:'tooling',pr:7,headSha:head,admissionOptions:{pr:7}},io),/empty or unreadable/)
  assert.equal(io.refs.has(EXCLUSIVE_REFS.merge),false);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('repository-maintenance reviewer keeps natural exact-head review without DDL admission',()=>{
  const {io,headSha,mutexCreates}=admittedReviewIo()
  io.getIssue=()=>({number:41,state:'open',title:'tooling repair',createdAt:'2026-09-11T17:00:00Z',body:['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','service_class: maintenance','change_type: reviewer-tooling','priority: 5','depends_on:','objects:','```'].join('\n')})
  io.getPrFiles=()=>[{filename:'scripts/reviewer-tool.mjs',status:'modified'},{filename:'scripts/reviewer-tool.test.mjs',status:'added'}]
  const result=assignNextReviewer({issue:41,pr:7,headSha,admissionOptions:{pr:7}},io)
  assert.ok(result.reviewer);assert.equal(mutexCreates(),1);assert.equal(io.refs.has(MUTEX_REF),false)
})

test('manager assignment and replacement preserve repository-maintenance review without admission writes',()=>{
  const {io,headSha}=admittedReviewIo();const comments=[]
  io.getIssue=()=>({number:41,state:'open',title:'tooling repair',createdAt:'2026-09-11T17:00:00Z',body:['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','service_class: maintenance','change_type: reviewer-tooling','priority: 5','depends_on:','objects:','```'].join('\n')})
  io.getPrFiles=()=>[{filename:'scripts/reviewer-tool.mjs',status:'modified'}]
  io.commentIssue=(_number,body)=>comments.push(body)
  const oldLog=console.log,oldError=console.error;console.log=()=>{};console.error=()=>{}
  try{
    assert.equal(main(['--assign-reviewer','--issue','41','--pr','7','--head-sha',headSha],NOW,io),0)
    assert.equal(main(['--replace-failed-reviewer','--issue','41','--pr','7','--head-sha',headSha,'--failed-sequence','1','--failure-code','insufficient_quota','--confirm-no-verdict','--confirm-no-artifact'],NOW,io),0)
  }finally{console.log=oldLog;console.error=oldError}
  assert.ok([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_ASSIGNMENT_REF_PREFIX)))
  assert.ok([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_REPLACEMENT_REF_PREFIX)))
  assert.equal(comments.length,0);assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith('refs/db-claims/')),false)
  assert.equal(io.refs.has(EXCLUSIVE_REFS.preview),false)
})

test('structural reviewer cannot omit admission through the shared reviewer path',()=>{
  const {io,headSha}=admittedReviewIo()
  assert.throws(()=>assignNextReviewer({issue:41,pr:7,headSha,admissionOptions:{pr:7}},io),/requires --admit-issue 41/)
  assert.equal(io.refs.has(REVIEW_CURSOR_REF),false)
})

test('manager structural assignment and replacement still require the linked admission',()=>{
  let fixture=admittedReviewIo(),messages=[];const oldLog=console.log,oldError=console.error;console.log=()=>{};console.error=(value)=>messages.push(String(value))
  try{
    assert.equal(main(['--assign-reviewer','--issue','41','--pr','7','--head-sha',fixture.headSha],NOW,fixture.io),2)
    fixture=admittedReviewIo();fixture.io.enforceAdmission=false
    const first=assignNextReviewer({issue:41,pr:7,headSha:fixture.headSha},fixture.io)
    fixture.io.enforceAdmission=true
    assert.equal(main(['--replace-failed-reviewer','--issue','41','--pr','7','--head-sha',fixture.headSha,'--failed-sequence',String(first.sequence),'--failure-code','insufficient_quota','--confirm-no-verdict','--confirm-no-artifact'],NOW,fixture.io),2)
  }finally{console.log=oldLog;console.error=oldError}
  assert.equal(messages.filter((value)=>value.includes('requires --admit-issue 41')).length,2,messages.join(' | '))
})

test('issue 2116 the production freeze names itself and restores every authorization it revoked', () => {
  const productionWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/shared-supabase-migrations.yml',import.meta.url)),'utf8')
  const revoke=productionWorkflow.indexOf('name: Revoke every pre-existing merge authorization while frozen')
  const release=productionWorkflow.indexOf('name: Release the exclusive production lane with ownership proof')
  const restore=productionWorkflow.indexOf('name: Restore the merge authorizations this freeze revoked')
  assert.ok(revoke >= 0 && release >= 0 && restore >= 0)
  // The restoration has to outlive the promotion, so it comes after the lane is
  // released and it runs unconditionally.
  assert.ok(release < restore, 'the restoration must run after the production lane is released')
  // Bounded to this step, not sliced to end-of-file, so a step appended after it
  // can never satisfy these assertions on the restoration's behalf.
  const afterRestore=productionWorkflow.indexOf('\n      - name:',restore+1)
  const restoreStep=productionWorkflow.slice(restore,afterRestore>=0?afterRestore:undefined)
  // A partially-failed revoke is exactly the damage this repairs, and so is a
  // CANCELLED one -- a cancelled step reports neither success nor failure, so any
  // condition that enumerates outcomes skips itself on the very case that leaves
  // heads revoked with nobody coming back for them. The condition must therefore be
  // bare `always()`, and this asserts the absence of a narrowing clause, not merely
  // the presence of `always()`.
  assert.match(restoreStep,/\n +if: always\(\)\r?\n/,'the restoration must run on every outcome of the revoke step, cancellation included')
  assert.doesNotMatch(restoreStep,/revoke_frozen_authorizations\.(outcome|conclusion)/,'the restoration must not narrow itself to particular revoke outcomes')
  // A revoked head must be traceable to the run that took it, and the refusal must
  // name the one command that puts it back.
  const revokeStep=productionWorkflow.slice(revoke,release)
  const description='Revoked by production freeze run ${GITHUB_RUN_ID}; re-run guarded-migration-merge.yml'
  assert.ok(revokeStep.includes(`description="${description}"`),'the revocation must name the run that wrote it')
  assert.match(revokeStep,/target_url=.*actions\/runs\/\$\{GITHUB_RUN_ID\}/)
  // Restoration clears the freeze's own marker to `pending`. Granting `success`
  // here would assert a merge lock nobody holds; only guarded-migration-merge.yml
  // may write that, and #1688's assertion above still proves it is the only writer.
  assert.match(restoreStep,/state=pending/)
  assert.doesNotMatch(restoreStep,/state=success/)
  // OWNERSHIP IS THE WHOLE SAFETY ARGUMENT, so pin its USE, not merely the
  // definition of the string it compares against. The previous version asserted
  // only that the marker was assigned; the comparison itself could have been
  // deleted with the test still green, and a freeze would then have restored
  // revocations written by guarded-migration-merge.yml or by another freeze run.
  assert.ok(restoreStep.includes(`expected="${description}"`),'the restoration must know the exact description it wrote')
  assert.match(restoreStep,/\[ "\$state" != 'failure' \] \|\| \[ "\$description" != "\$expected" \]/,'the restoration must compare the FULL description, not a run-id substring')
  // An unreadable status is not "no status". Swallowing the read would leave a
  // revoked head red forever while the log claimed it was left alone deliberately.
  assert.doesNotMatch(restoreStep,/2>\/dev\/null \|\| echo/)
  assert.match(restoreStep,/could not READ the authorization status/)
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
import { parseVersionPrMap, pendingRequiredContexts } from './manage-migration-author-lanes.mjs'

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

// THE DOCUMENTS-ONLY DRAW GUARD IS WIRED INTO --assign-reviewer (#2102).
//
// `assertReviewerDrawIsWarranted` is what actually protects reviewer-pool
// capacity, and its only caller is the CLI branch below. A review of this change
// found that no test imported it and no test drove `main(['--assign-reviewer', …])`
// at all, so deleting the call from the CLI would not have failed CI while a
// documents-only pull request went on spending a reviewer slot. This drives the
// real CLI: the refusal, the rename that must NOT be exempt, and a control
// proving a migration change still reaches the draw.
function assignReviewerRun(files){
  const io={pullRequestFiles(){return files}}
  const errors=[],original=console.error
  console.error=(message)=>errors.push(String(message))
  let code
  try{code=main(['--assign-reviewer','--issue','2102','--pr','2112','--head-sha','d'.repeat(40)],NOW,io)}
  finally{console.error=original}
  return {code,stderr:errors.join('\n')}
}

test('--assign-reviewer refuses to draw a database reviewer for a documents-only pull request (#2102)',()=>{
  const refused=assignReviewerRun([{filename:'docs/notes.md'},{filename:'HANDOFF.d/2026-09-02T0000Z-note.md'}])
  assert.equal(refused.code,2)
  assert.match(refused.stderr,/documents-only change/)
  assert.match(refused.stderr,/does not draw from the database reviewer pool/)
  // The refusal must name the rule, not just fail: an unexplained refusal at the
  // draw is indistinguishable from the reviewer pool being broken.
  assert.match(refused.stderr,/Rulebook files/)
})

test('--assign-reviewer still draws for a rulebook file, a migration, and a migration renamed to a document (#2102)',()=>{
  // Each of these must get PAST the guard. The draw then fails on the stub io,
  // which is the point: the failure is anything EXCEPT the documents-only refusal.
  for(const files of [
    [{filename:'docs/notes.md'},{filename:'AGENTS.md'}],
    [{filename:'docs/notes.md'},{filename:'supabase/migrations/20260902120000_add_thing.sql'}],
    [{filename:'docs/moved.md',previous_filename:'supabase/migrations/20260902120000_add_thing.sql'}],
  ]){
    const drawn=assignReviewerRun(files)
    assert.doesNotMatch(drawn.stderr,/documents-only change/,JSON.stringify(files))
  }
  // And an unreadable file list fails OPEN at the draw: "we could not tell" costs
  // a review, it never grants an exemption.
  assert.doesNotMatch(assignReviewerRun('nonsense').stderr,/documents-only change/)
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

// ISSUE #2454. Duplicate claims on one branch cannot be cleared by the ordinary
// release path, because that path refuses any branch with an open PR — and the
// duplicate's branch legitimately has one. The narrow path below proves, from
// live GitHub state alone, that the claim it closes is NOT the authority.
function duplicateIo({prVersion='20260814200007',files=null}={}){
  const io=memoryIo()
  // #7 is the authority (version 20260814200007, the version the PR uses);
  // #8 is the duplicate opened by a dispatch error on the same branch.
  io.openClaims=()=>[
    {number:7,body:body(['table core.x'],'7')},
    {number:8,body:claimBody({version:'20260814209999',objects:['table core.y'],owner:'agent-7',branch:'codex/7',worktree:'C:/w/8',expiresAt:new Date('2026-08-15T08:00:00.000Z')})},
  ]
  io.openPulls=()=>[{number:2409,head:{ref:'codex/7'}}]
  io.getPrFiles=()=>files??[{filename:`supabase/migrations/${prVersion}_add_bridges.sql`,status:'added'}]
  return io
}

test('a duplicate claim on a branch with an open PR releases with a truthful reason',()=>{
  const io=duplicateIo();let closed=null,reason=null
  io.closeClaim=(n,r)=>{closed=n;reason=r}
  assert.equal(main(['--release-duplicate-claim','8','--owner','agent-7','--confirm-finished'],NOW,io),0)
  assert.equal(closed,8)
  assert.equal(reason,CLAIM_CLOSE_REASONS.duplicateRelease)
  assert.doesNotMatch(reason,/Expired migration-author lease|guarded cleanup/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('the authority claim on the same branch is refused',()=>{
  const io=duplicateIo();let closed=null
  io.closeClaim=(n)=>{closed=n}
  assert.equal(main(['--release-duplicate-claim','7','--owner','agent-7','--confirm-finished'],NOW,io),2)
  assert.equal(closed,null)
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('a lone claim on a branch with an open PR is still refused',()=>{
  const io=duplicateIo();let closed=null
  io.closeClaim=(n)=>{closed=n}
  io.openClaims=()=>[{number:7,body:body(['table core.x'],'7')}]
  assert.equal(main(['--release-duplicate-claim','7','--owner','agent-7','--confirm-finished'],NOW,io),2)
  // And the ordinary release path still refuses it too — nothing was widened.
  assert.equal(main(['--release-claim','7','--owner','agent-7','--confirm-finished'],NOW,io),2)
  assert.equal(closed,null)
})

test('duplicate release refuses a wrong owner, a missing PR migration, and a missing authority holder',()=>{
  let closed=null
  const wrongOwner=duplicateIo();wrongOwner.closeClaim=(n)=>{closed=n}
  assert.equal(main(['--release-duplicate-claim','8','--owner','agent-9','--confirm-finished'],NOW,wrongOwner),2)
  const noMigration=duplicateIo({files:[{filename:'docs/notes.md',status:'added'}]});noMigration.closeClaim=(n)=>{closed=n}
  assert.equal(main(['--release-duplicate-claim','8','--owner','agent-7','--confirm-finished'],NOW,noMigration),2)
  // The PR uses a version NEITHER open claim holds: nothing is proved, so nothing closes.
  const unproved=duplicateIo({prVersion:'20260814201111'});unproved.closeClaim=(n)=>{closed=n}
  assert.equal(main(['--release-duplicate-claim','8','--owner','agent-7','--confirm-finished'],NOW,unproved),2)
  // There is no override flag to force it.
  const forced=duplicateIo({prVersion:'20260814201111'});forced.closeClaim=(n)=>{closed=n}
  assert.equal(main(['--release-duplicate-claim','8','--owner','agent-7','--confirm-finished','--force'],NOW,forced),2)
  assert.equal(closed,null)
})

// ISSUE #2454 review. The PR file snapshot must be re-read under the mutex
// immediately before the close, so a push landing mid-proof cannot be closed on.
test('a pull-request change between the two proofs refuses the duplicate release',()=>{
  const io=duplicateIo();let closed=null,calls=0
  io.closeClaim=(n)=>{closed=n}
  // First read proves #7 is the authority; the second read shows the PR now
  // carrying the DUPLICATE's own version instead.
  io.getPrFiles=()=>{calls+=1;return calls===1?[{filename:'supabase/migrations/20260814200007_add_bridges.sql',status:'added'}]:[{filename:'supabase/migrations/20260814209999_add_bridges.sql',status:'added'}]}
  assert.equal(main(['--release-duplicate-claim','8','--owner','agent-7','--confirm-finished'],NOW,io),2)
  assert.equal(closed,null)
  assert.ok(calls>=2,'the pull-request files must be re-read under the mutex before the close')
  assert.equal(io.refs.has(MUTEX_REF),false)
})

// ISSUE #2448. No close path may claim an expiry sweep that never runs.
test('every claim-close reason states its own cause and never asserts expiry',()=>{
  for(const reason of Object.values(CLAIM_CLOSE_REASONS)){
    assert.doesNotMatch(reason,/[Ee]xpired migration-author lease|guarded cleanup/)
    assert.match(reason,/No lease expired and no cleanup sweep ran\./)
  }
  // Historical recovery still reads pre-repair closures, and now also reads the
  // truthful explicit-release reason, so it does not start refusing valid ones.
  assert.equal(RECOVERABLE_CLAIM_CLOSE_REASONS.has(LEGACY_GUARDED_CLEANUP_CLOSE_REASON),true)
  assert.equal(RECOVERABLE_CLAIM_CLOSE_REASONS.has(CLAIM_CLOSE_REASONS.explicitRelease),true)
  assert.equal(RECOVERABLE_CLAIM_CLOSE_REASONS.has(CLAIM_CLOSE_REASONS.acquisitionRollback),false)
})

test('an explicit release states an explicit release, not an expiry sweep',()=>{
  const io=memoryIo();let reason=null
  io.openClaims=()=>[{number:7,body:body(['table core.x'],'7')}]
  io.closeClaim=(n,r)=>{reason=r}
  assert.equal(main(['--release-claim','7','--owner','agent-7','--confirm-finished'],NOW,io),0)
  assert.equal(reason,CLAIM_CLOSE_REASONS.explicitRelease)
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

test('REAL PROCESS RACE: 25 independent CLIs claiming unrelated objects are all admitted (no lane cap)',async()=>{
  const objects=Array.from({length:25},(_,i)=>`table core.r${i}`)
  const results=await raceWorkers(objects)
  assert.equal(results.filter(x=>x.json.ok).length,25)
  assert.equal(results.filter(x=>!x.json.ok).length,0,'no unrelated author is ever refused for capacity')
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
  const state=assertLaneAvailable(claims,[],NOW);assert.equal(state.active.length,101)
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
test('stale process that loses ownership after claim creation leaves the claim protected for explicit recovery',()=>{
  const io=memoryIo();let closed=null
  io.createClaim=()=>{io.refs.set(MUTEX_REF,'successor');return 'https://github.test/issues/77'}
  io.closeClaim=(number)=>{closed=String(number)}
  assert.throws(()=>acquireAuthorLane(opts,NOW,io),/claim .* remains protected for explicit recovery/)
  assert.equal(closed,null);assert.equal(io.refs.get(MUTEX_REF),'successor')
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
test('stranded reviewer queue and silence-release mutexes are recoverable',()=>{
  for(const kind of ['reviewer-queue-lock','reviewer-silence-release-lock']){
    const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:`db-coordination ${kind} issue=1 pr=2 head=${'a'.repeat(40)} sequence=3`,committer:{date:'2026-08-14T19:55:00Z'}})
    assert.equal(recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io).released,'4a69fbbc')
    assert.equal(io.refs.has(MUTEX_REF),false)
  }
})
// ISSUE #2454. The duplicate-release path mints its own mutex owner commit, so
// stale-mutex recovery must recognize that lock kind — otherwise a death between
// acquire and release wedges every author lane with no sanctioned way out.
test('stranded duplicate-claim-release mutex is recognized and safely recoverable',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:'db-coordination duplicate-claim-release 1f0c3a2e-0000-4000-8000-000000000000',committer:{date:'2026-08-14T19:55:00Z'}})
  const result=recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io)
  assert.equal(result.released,'4a69fbbc');assert.equal(io.refs.has(MUTEX_REF),false)
})

test('stranded repository-maintenance authorization mutex is recognized and safely recoverable',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:`db-coordination repository-maintenance-authorization pr=2715 head=${'a'.repeat(40)}`,committer:{date:'2026-08-14T19:55:00Z'}})
  const result=recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io)
  assert.equal(result.released,'4a69fbbc');assert.equal(io.refs.has(MUTEX_REF),false)
})

test('stranded claim lease renewal mutex is recognized and safely recoverable',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:'db-coordination claim-lease-renewal renew-853',committer:{date:'2026-08-14T19:55:00Z'}})
  const result=recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io)
  assert.equal(result.released,'4a69fbbc');assert.equal(io.refs.has(MUTEX_REF),false)
})
test('stranded expired claim recovery mutex is recognized and safely recoverable',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:'db-coordination expired-claim-recovery recover-2177',committer:{date:'2026-08-14T19:55:00Z'}})
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

function expiredPrRecoveryIo({issueNumber,claimNumber,prNumber,version,owner,branch,worktree,title,tables,children},overrides={}){
  const io=memoryIo(),head='a'.repeat(40)
  const claim={number:claimNumber,state:'open',title,body:claimBody({version,objects:tables,owner,branch,worktree,expiresAt:new Date('2026-08-14T19:00:00Z')})}
  const workIssue={number:issueNumber,state:'open',body:scope('ready','structural','shared-db-orchestrator',2,tables)}
  io.refs.set(`refs/db-claims/${version}`,'permanent')
  io.openClaims=()=>[structuredClone(claim)]
  io.getIssue=(number)=>Number(number)===issueNumber?structuredClone(workIssue):Number(number)===claimNumber?structuredClone(claim):null
  io.updateCalls=0;io.updateIssue=(_number,fields)=>{io.updateCalls++;Object.assign(claim,fields);return structuredClone(claim)}
  io.getPr=()=>({state:'open',head:{sha:head,ref:branch}})
  io.getPrFiles=()=>[{status:'added',filename:`supabase/migrations/${version}_fixture.sql`}]
  io.prSources=()=>[{label:`PR #${prNumber} fixture`,objects:[...tables,...children],versions:[version]}]
  return Object.assign(io,{claim,workIssue,head,tables,children},overrides)
}

const recovery2177={issueNumber:2177,claimNumber:2182,prNumber:2183,version:'20260904001147',owner:'claude-subagent-2177',branch:'claude/2177-coldlion-cust-sp',worktree:'C:\\repos\\shared-db\\.claude\\worktrees\\coldlion-cust-sp-2177',title:'CLAIM: #2177 ColdLion customer + salesperson field projections (owner ruling issue 2081, run c5519623574)',tables:['table coldlion.customer','table coldlion.salesperson'],children:['column coldlion.customer.customer_name','column coldlion.customer.currency_code','column coldlion.customer.payment_terms','column coldlion.customer.price_level','column coldlion.customer.salesperson_code','column coldlion.customer.ship_via','column coldlion.customer.tax_code','column coldlion.salesperson.active']}
const recovery2175={issueNumber:2175,claimNumber:2184,prNumber:2185,version:'20260903030716',owner:'claude-opus-5-subagent-2175',branch:'claude/2175-coldlion-unit-5a',worktree:'C:\\repos\\shared-db\\.claude\\worktrees\\coldlion-5a-inv-prodtrack',title:'CLAIM: Issue #2175 ColdLion landing unit 5a: create coldlion.inventory and coldlion.prod_tracking landing tables from live-sampled shapes',tables:['table coldlion.inventory','table coldlion.prod_tracking'],children:['column coldlion.inventory.company_code','column coldlion.inventory.item_pkey','column coldlion.inventory.warehouse_code','column coldlion.inventory.inventory_qty','column coldlion.inventory.inventory_cost','column coldlion.prod_tracking.company_code','column coldlion.prod_tracking.prod_order_no','column coldlion.prod_tracking.order_date','column coldlion.prod_tracking.start_date','column coldlion.prod_tracking.cancel_date','column coldlion.prod_tracking.payload_hash','column coldlion.prod_tracking.source_updated_at']}
function recoveryOptions(fixture){return {claim:fixture.claimNumber,issue:fixture.issueNumber,owner:fixture.owner,branch:fixture.branch,worktree:fixture.worktree,pr:fixture.prNumber,headSha:'a'.repeat(40),leaseHours:12,requestId:`recover-${fixture.issueNumber}`,mutexAttempts:1}}

test('#2177/#2182 expired recovery atomically appends eight PR-derived child columns and renews',()=>{
  const io=expiredPrRecoveryIo(recovery2177),before=io.claim.body,result=recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),lease=parseAuthorLease(io.claim.body,NOW)
  assert.deepEqual(result.added,recovery2177.children);assert.deepEqual(lease.objects,[...recovery2177.tables,...recovery2177.children].sort());assert.equal(lease.active,true);assert.equal(io.updateCalls,1)
  assert.equal(io.claim.body.replace(/  - column .*\n/g,'').replace(/^expires_at:.*$/m,'expires_at: X'),before.replace(/^expires_at:.*$/m,'expires_at: X'))
})

test('#2175/#2184 expired recovery atomically appends twelve PR-derived child columns and renews',()=>{
  const io=expiredPrRecoveryIo(recovery2175),before=io.claim.body,result=recoverExpiredClaimFromPr(recoveryOptions(recovery2175),NOW,io),lease=parseAuthorLease(io.claim.body,NOW)
  assert.equal(result.added.length,12);assert.deepEqual(lease.objects,[...recovery2175.tables,...recovery2175.children].sort());assert.equal(lease.active,true);assert.equal(io.updateCalls,1)
  assert.equal(io.claim.body.replace(/  - column .*\n/g,'').replace(/^expires_at:.*$/m,'expires_at: X'),before.replace(/^expires_at:.*$/m,'expires_at: X'))
})

test('a recovered claim can be renewed again from the same unchanged issue and PR evidence',()=>{
  const io=expiredPrRecoveryIo(recovery2177),options=recoveryOptions(recovery2177)
  recoverExpiredClaimFromPr(options,NOW,io)
  const later=new Date('2026-08-16T20:00:00Z'),result=renewExpiredClaim(options,later,io)
  assert.equal(result.idempotent,false);assert.equal(parseAuthorLease(io.claim.body,later).active,true);assert.equal(io.updateCalls,2)
})

test('expired PR recovery fails closed on collision, stale identity, active lease, or shortened head SHA',()=>{
  let io=expiredPrRecoveryIo(recovery2177),other={number:999,body:claimBody({version:'20260905000000',objects:[recovery2177.children[0]],owner:'other',branch:'other',worktree:'C:/other',expiresAt:new Date('2026-08-17T00:00:00Z')})}
  io.openClaims=()=>[structuredClone(io.claim),other];assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/collision/);assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177);assert.throws(()=>recoverExpiredClaimFromPr({...recoveryOptions(recovery2177),headSha:'b'.repeat(40)},NOW,io),/exact head/);assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177);io.claim.body=io.claim.body.replace('2026-08-14T19:00:00.000Z','2026-08-15T09:00:00.000Z');assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/must be non-legacy and expired/);assert.equal(io.updateCalls,0)
  assert.throws(()=>recoverExpiredClaimFromPr({...recoveryOptions(recovery2177),headSha:'a'.repeat(7)},NOW,expiredPrRecoveryIo(recovery2177)),/40-character/)
})

test('expired PR recovery refuses every authority, scope, parser, reservation, and version mismatch before writing',()=>{
  for(const change of [{owner:'wrong'},{branch:'wrong'},{worktree:'wrong'}]){const io=expiredPrRecoveryIo(recovery2177);assert.throws(()=>recoverExpiredClaimFromPr({...recoveryOptions(recovery2177),...change},NOW,io),/owner, branch, or worktree/);assert.equal(io.updateCalls,0)}
  let io=expiredPrRecoveryIo(recovery2177);io.refs.delete(`refs/db-claims/${recovery2177.version}`);assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/reservation/);assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177);io.workIssue.body=scope('blocked','structural','shared-db-orchestrator',2,recovery2177.tables);assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/open ready structural/);assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177);io.prSources=()=>[];assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/parser source/);assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177);io.getPrFiles=()=>[{filename:`supabase/migrations/${recovery2177.version}_a.sql`},{filename:'supabase/migrations/20260904001148_b.sql'}];assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/migration version/);assert.equal(io.updateCalls,0)
})

test('expired PR recovery refuses concurrent identity changes and never rolls back after mutex ownership loss',()=>{
  let io=expiredPrRecoveryIo(recovery2177),baseGet=io.getIssue,workReads=0
  io.getIssue=(number)=>{const value=baseGet(number);if(Number(number)===2177&&++workReads===2)value.body=scope('blocked','structural','shared-db-orchestrator',2,recovery2177.tables);return value}
  assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/issue changed concurrently/);assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177);const before=io.claim.body,baseUpdate=io.updateIssue
  io.updateIssue=(number,fields)=>{const result=baseUpdate(number,fields);io.refs.set(MUTEX_REF,'successor');return result}
  assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/ROLLBACK NOT ATTEMPTED/);assert.notEqual(io.claim.body,before);assert.equal(io.updateCalls,1)
})

test('expired PR recovery rolls back its single atomic write after an ambiguous update failure',()=>{
  const io=expiredPrRecoveryIo(recovery2177),before=io.claim.body,baseUpdate=io.updateIssue;let first=true
  io.updateIssue=(number,fields)=>{const result=baseUpdate(number,fields);if(first){first=false;throw new LaneError('response lost after PATCH')}return result}
  assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),/response lost/);assert.equal(io.claim.body,before);assert.equal(io.updateCalls,2)
})

test('THE DEADLOCK: an expired claim whose PR objects exceed it is refused by BOTH renewal and expansion, and only recovery frees it',()=>{
  // Reproduces the live #2182/#2184/#2226/#2195 stall: the lease has expired AND the PR
  // parses objects the claim never covered, so each pre-existing path refuses on the other's
  // precondition. Without recoverExpiredClaimFromPr the lane is unrecoverable.
  let io=expiredPrRecoveryIo(recovery2177)
  assert.equal(parseAuthorLease(io.claim.body,NOW).active,false,'fixture lease must already be expired')
  assert.throws(()=>renewExpiredClaim(recoveryOptions(recovery2177),NOW,io),/claim does not cover parsed pull request objects/)
  assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177)
  assert.throws(()=>expandActiveClaimFromPr({...recoveryOptions(recovery2177),claim:recovery2177.claimNumber},NOW,io),/target claim lease is legacy or expired/)
  assert.equal(io.updateCalls,0)
  io=expiredPrRecoveryIo(recovery2177)
  const result=recoverExpiredClaimFromPr(recoveryOptions(recovery2177),NOW,io),lease=parseAuthorLease(io.claim.body,NOW)
  assert.deepEqual(result.added,recovery2177.children)
  assert.equal(lease.active,true,'recovery must both cover the PR objects and restore a live lease')
  assert.equal(io.updateCalls,1)
})

test('REAL main command wires expired PR expansion and renewal as one recovery',()=>{
  const io=expiredPrRecoveryIo(recovery2177),f=recovery2177,args=['--recover-expired-claim-from-pr','--claim-number',String(f.claimNumber),'--issue',String(f.issueNumber),'--owner',f.owner,'--branch',f.branch,'--worktree',f.worktree,'--pr',String(f.prNumber),'--head-sha','a'.repeat(40),'--lease-hours','12']
  assert.equal(main(args,NOW,io),0);assert.equal(parseAuthorLease(io.claim.body,NOW).active,true);assert.equal(io.updateCalls,1)
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
  assert.throws(()=>reversionActiveClaim({...reversionArgs,issue:765},NOW,reversionIo()),/claim title does not identify exact issue #765/)
  assert.throws(()=>reversionActiveClaim({...reversionArgs,owner:'another'},NOW,reversionIo()),/claim owner changed/)
})
test('issue 2188: version supersession accepts established claim-title forms and names the exact changed field',()=>{
  for(const title of ['CLAIM: 764 sequence repair','CLAIM: issue #764 sequence repair','CLAIM: Issue 764 sequence repair']){
    const io=reversionIo();io.issue.title=title
    assert.equal(reversionActiveClaim(reversionArgs,NOW,io).newVersion,io.fresh,title)
  }
  const wrongTitle=reversionIo();wrongTitle.issue.title='CLAIM: 1764 unrelated work'
  assert.throws(()=>reversionActiveClaim(reversionArgs,NOW,wrongTitle),/claim title does not identify exact issue #764/)
  const wrongVersion=reversionIo();wrongVersion.issue.body=wrongVersion.issue.body.replace(reversionArgs.oldVersion,'20260816044639')
  assert.throws(()=>reversionActiveClaim(reversionArgs,NOW,wrongVersion),/claim version changed/)
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
test('issue 2188: merged stranded reissue accepts established titles and pins exact workstream identity',()=>{
  for(const title of ['CLAIM: 1645 repair','CLAIM: issue #1645 repair','CLAIM: Issue 1645 repair']){
    const io=mergedReissueIo();io.issue.title=title
    assert.equal(reissueMergedStrandedClaim(mergedReissueArgs,NOW,io).newVersion,io.fresh,title)
  }
  for(const title of ['CLAIM: 11645 unrelated','CLAIM: #1645/#1646 compound']){
    const io=mergedReissueIo();io.issue.title=title
    assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,io),/claim title does not identify exact issue #1645/)
  }
  const wrongVersion=mergedReissueIo();wrongVersion.issue.body=wrongVersion.issue.body.replace(mergedReissueArgs.oldVersion,'20260827183012')
  assert.throws(()=>reissueMergedStrandedClaim(mergedReissueArgs,NOW,wrongVersion),/claim stranded version changed/)
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

const scopeWith = (body) => ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'service_class: standard-application', 'change_type: migration', 'application_return_to: u2giants/example-app', 'live_assertion: authenticated create-and-read succeeds', 'generated_types: not-applicable', 'priority: 5', 'depends_on:', body, '```'].join('\n')
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

const depScope = (deps) => ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'service_class: standard-application', 'change_type: migration', 'application_return_to: u2giants/example-app', 'live_assertion: authenticated create-and-read succeeds', 'generated_types: not-applicable', 'priority: 5', 'depends_on: ' + deps, 'writes:', '  - table core.a', '```'].join('\n')
const completionComment = (record) => ({ body: '```db-work-completion\n' + JSON.stringify(record) + '\n```',author_association:'OWNER',author:'u2giants' })
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
  io.listReviewRefsPaged=()=>{throw new LaneError(`refs/db-review-assignments returned 1200 refs, at or past the ${REVIEW_REF_ROW_LIMIT}-ref ceiling; refusing a possibly truncated reviewer audit. Retire refs rather than raising the ceiling (#2152)`)}
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
  giveVerdict(io,{issue:10,pr:110,headSha})
  const result=activateReviewCutover(io)
  assert.deepEqual(result.backfilled,[])
  assert.equal(io.refs.has(reviewActiveRef('grok-4.6')),false)
})

test('cutover activation still backfills a live SLOT 2 lease when only slot 1 has a verdict (issue #2208 follow-up F3)',()=>{
  // The activation asked the any-slot verdict question, so slot 1's verdict made
  // slot 2's reviewer look answered and it never got its protective lease -- the
  // busy probe then goes blind and the same provider can be handed slot 2 again,
  // the exact double-assignment hazard this activation exists to prevent.
  const io=freshCutoverIo(),headSha='d'.repeat(40)
  io.openPulls=()=>[{number:111,head:{sha:headSha}}]
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=2 reviewer=glm-5.3 issue=11 pr=111 head=${headSha} slot=2`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/11-111-${headSha}-slot2`,sha)
  giveVerdict(io,{issue:11,pr:111,headSha,slot:1})
  const result=activateReviewCutover(io)
  assert.deepEqual(result.backfilled,[{reviewer:'glm-5.3',issue:11,pr:111,headSha,ref:reviewActiveRef('glm-5.3')}])
  assert.ok(io.refs.has(reviewActiveRef('glm-5.3')))
})

test('cutover activation still backfills a live SLOT 1 lease when only slot 2 has a verdict (issue #2208)',()=>{
  const io=freshCutoverIo(),headSha='e'.repeat(40)
  io.openPulls=()=>[{number:112,head:{sha:headSha}}]
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=3 reviewer=grok-4.6 issue=12 pr=112 head=${headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/12-112-${headSha}`,sha)
  giveVerdict(io,{issue:12,pr:112,headSha,slot:2})
  const result=activateReviewCutover(io)
  assert.deepEqual(result.backfilled,[{reviewer:'grok-4.6',issue:12,pr:112,headSha,ref:reviewActiveRef('grok-4.6')}])
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
  batchedStatesIo(io,{issue:13,pr:113,headSha,evidence:[]})
  giveVerdict(io,{issue:13,pr:113,headSha})
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
  //   listReviewRefsPaged -> 1, flat, for any namespace size (issue #2152:
  //                          git/matching-refs is not paginated and returns
  //                          the whole namespace in a single request)
  //   readActiveReviewLeases -> 1, and it warms reviewCommitBase, so
  //   makeOwnerCommit     -> 1 after it (3 only when the base is still cold)
  io.getRateLimit=()=>{wire(2,'quota');return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  io.readActiveReviewLeases=()=>{wire(1,'activeLeases');return new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:rawGetCommit(sha)}]))}
  io.readReviewStates=(leases)=>{wire(1,'states');return new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:{state:'open',head:{sha:lease.headSha}},evidence:[]}]))}
  io.readReviewRefs=(refs)=>{wire(1,'readReviewRefs');return new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))}
  io.atomicReviewRefs=(changes)=>{for(const change of changes)assert.equal(io.refs.get(change.ref)??null,change.expected??null);for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  // These namespaces are append-only across the repository's WHOLE review
  // history (726 assignment refs / 229 replacement refs, measured 2026-09-02),
  // and this used to charge four and two requests for them because the listing
  // walked pages. It no longer does: `git/matching-refs` is not a paginated
  // endpoint, so one request returns the whole namespace whatever its size
  // (issue #2152). Charging ONE here is now the production-faithful price, and
  // it is the size-independent one -- the cost can no longer drift up as refs
  // accumulate, which is what made the old charge a moving target.
  io.listReviewRefsPaged=(prefix)=>{wire(1,`listReviewRefsPaged:${prefix}`);return [...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha}))}
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

test('slot 2 is drawable as a genuine first-time assignment even though slot 1 already has a durable verdict for this exact head (issue #2208)',()=>{
  // Reviewers are asynchronous: slot 1 finishing (and recording its durable
  // verdict) before slot 2 is even drawn is the ORDINARY case, not an edge
  // case. `hasVerdictForHead` used to answer "does ANY slot have a verdict for
  // this head" with no slot filter, so the post-mutex freshness recheck inside
  // the ordinary assignment path mistook slot 1's pre-existing, unrelated
  // verdict for "the verdict state changed after I took the mutex" and refused
  // to draw slot 2 at all -- forever, for that head. The only workaround was
  // discarding slot 1's already-valid verdict by pushing a new head and
  // redrawing both slots together.
  const io=withAtomicRefs(reviewIo()),request={issue:2208,pr:2299,headSha:'e'.repeat(40)}
  io.getPr=()=>({number:request.pr,state:'open',head:{sha:request.headSha,ref:'codex/x'}})
  const first=assignNextReviewer(request,io)
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:1})
  const second=assignNextReviewer({...request,slot:2},io)
  assert.equal(second.slot,2)
  assert.notEqual(second.reviewer,first.reviewer)
  // Idempotent retry of the same slot-2 draw must still work once it exists.
  assert.deepEqual(assignNextReviewer({...request,slot:2},io),second)
})

test("a live slot-2 reviewer stays BUSY while slot 1 holds a verdict for the same head (issue #2208 follow-up, codex-gpt-5.6-sol REJECT)",()=>{
  // The busy-reviewer scan used to ask "does ANY slot have a verdict for this
  // head", so the moment slot 1 recorded its verdict, slot 2's still-working
  // reviewer was classified stale and its active lease became reclaimable --
  // two sessions could then hold the same slot at once. The lease knows which
  // slot it belongs to; the question must be asked on behalf of that slot.
  const io=withAtomicRefs(reviewIo()),request={issue:2211,pr:2302,headSha:'c3'.repeat(20)}
  io.getPr=()=>({number:request.pr,state:'open',head:{sha:request.headSha,ref:'codex/x'}})
  const first=assignNextReviewer(request,io)
  const second=assignNextReviewer({...request,slot:2},io)
  assert.notEqual(first.reviewer,second.reviewer)
  // Slot 1 finishes. Slot 2 has NOT.
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:1})
  const busy=findBusyReviewers(io)
  assert.ok(busy,'busy scan must be readable')
  // Slot 1's reviewer is genuinely free -- its own verdict landed.
  assert.ok(!busy.has(first.reviewer),`${first.reviewer} recorded slot 1's verdict and must be free`)
  assert.ok(!busy.stale.some((row)=>row.assignment.reviewer===second.reviewer),`${second.reviewer} is still working slot 2 and must NOT be reclaimable`)
  assert.ok(busy.has(second.reviewer),`${second.reviewer} still holds a live slot-2 lease and must stay busy`)
  // The capacity report must tell the same story.
  const report=reviewerCapacityReport(io)
  const slotTwoRow=report.reviewers.find((row)=>row.reviewer===second.reviewer)
  assert.equal(slotTwoRow.verdictPresent,false)
  assert.notEqual(slotTwoRow.classification,'stale-reclaimable')
  // And once slot 2 itself records a verdict, its reviewer frees normally.
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:2})
  assert.ok(!findBusyReviewers(io).has(second.reviewer))
})

test("a sibling slot's verdict must NOT free a genuinely unknown-slot live lease (issue #2208 follow-up round 3)",()=>{
  // REVERSE DIRECTION, on the ONE record shape that is still genuinely
  // ambiguous: a pre-#2077 replacement message, which carries no `slot=` token
  // at all. Scoping is meant to NARROW what blocks an action; in the liveness
  // path the old head-wide fallback did the opposite -- "a verdict exists" went
  // TRUE the moment ANY sibling slot finished, so a live lease became
  // reclaimable by a stranger's verdict. Absence of a slot must never be
  // permission to reclaim.
  const io=reviewIo(),issue=2213,pr=2304,headSha='c5'.repeat(20)
  const message=`db-coordination reviewer-replacement sequence=8 reviewer=grok-4.6 issue=${issue} pr=${pr} head=${headSha} failed-sequence=7 prior-sequence=7 failure-ref=${'b'.repeat(40)}`
  assert.equal(parseReviewLease({message}).slot,null,'this fixture must be the UNKNOWN-slot shape')
  io.refs.set(reviewActiveRef('grok-4.6'),io.makeOwnerCommit(message))
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:headSha}})
  // A stranger finishes slot 2. Our lease does not say it is not slot 2.
  giveVerdict(io,{issue,pr,headSha,slot:2})
  const busy=findBusyReviewers(io)
  assert.ok(busy,'busy scan must be readable')
  assert.ok(busy.has('grok-4.6'),"a sibling slot's verdict must not free an unknown-slot lease")
  assert.ok(!busy.stale.some((row)=>row.assignment.reviewer==='grok-4.6'),'and it must not be reclaimable')
  assert.equal(reviewerCapacityReport(io).reviewers.find((row)=>row.reviewer==='grok-4.6').verdictPresent,false)
  // Holding it conservatively must not strand it: the ordinary releases still
  // work. The head moves...
  const moved={...io,getPr:()=>({number:pr,state:'open',head:{sha:'9'.repeat(40)}})}
  assert.ok(!findBusyReviewers(moved).has('grok-4.6'))
  // ...or the PR closes.
  const closed={...io,getPr:()=>({number:pr,state:'closed',head:{sha:headSha}})}
  assert.ok(!findBusyReviewers(closed).has('grok-4.6'))
})

test('a replacement lease STATES its slot even for slot 1, so its own verdict still frees it (issue #2208 follow-up round 3)',()=>{
  // The conservative unknown-slot branch must not become a leak. Every
  // replacement record written from now on states `slot=`, slot 1 included --
  // its active lease ref is NOT slot-namespaced, so the message is the only
  // place the slot can come from. This pins the written message shape, not just
  // the behaviour that depends on it.
  const io=withAtomicRefs(reviewIo()),request={issue:2214,pr:2305,headSha:'c6'.repeat(20)}
  io.getPr=()=>({number:request.pr,state:'open',head:{sha:request.headSha,ref:'codex/x'}})
  const first=assignNextReviewer(request,io)
  const replacement=replaceFailedReviewer({...request,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  const leaseSha=io.refs.get(reviewActiveRef(replacement.reviewer))
  assert.match(io.getCommit(leaseSha).message,/ slot=1 /,'a slot-1 replacement message must state its slot')
  assert.equal(parseReviewLease(io.getCommit(leaseSha)).slot,1)
  assert.ok(findBusyReviewers(io).has(replacement.reviewer))
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:1})
  assert.ok(!findBusyReviewers(io).has(replacement.reviewer),"its own slot's verdict must still free it")
})

test('parseReviewLease reads the slot from the message form, and never guesses one (issue #2208 follow-up)',()=>{
  const cursorTwo=parseReviewLease({message:'db-coordination reviewer-cursor sequence=7 reviewer=grok-4.6 issue=1 pr=2 head='+'a'.repeat(40)+' slot=2'})
  assert.equal(cursorTwo.slot,2)
  // Current --assign-reviewer omits ` slot=` for slot 1, so absent MEANS 1 here.
  const cursorOne=parseReviewLease({message:'db-coordination reviewer-cursor sequence=7 reviewer=grok-4.6 issue=1 pr=2 head='+'a'.repeat(40)})
  assert.equal(cursorOne.slot,1)
  // Pre-#2077 replacement messages carry no slot token: UNKNOWN, never 1.
  const legacyReplacement=parseReviewLease({message:'db-coordination reviewer-replacement sequence=8 reviewer=glm-5.3 issue=1 pr=2 head='+'a'.repeat(40)+' failed-sequence=7 prior-sequence=7 failure-ref='+'b'.repeat(40)})
  assert.equal(legacyReplacement.slot,null)
  const replacementTwo=parseReviewLease({message:'db-coordination reviewer-replacement sequence=8 reviewer=glm-5.3 issue=1 pr=2 head='+'a'.repeat(40)+' slot=2 failed-sequence=7 prior-sequence=7 failure-ref='+'b'.repeat(40)})
  assert.equal(replacementTwo.slot,2)
  // The legacy generation-form lease is SLOT 1 (round 3). Nothing writes that
  // form any more; it is read-only history from before review slots existed, so
  // slot 1 is the only slot it could ever have belonged to. Under the round-3
  // fail-closed liveness sentinel, leaving it UNKNOWN would pin those leases
  // busy forever -- `a recorded verdict and a moved head both free the reviewer
  // that held them` is the guard that says so.
  const generation=parseReviewLease({message:'db-coordination reviewer-lease generation=3 reviewer=kimi-k3 issue=1 pr=2 head='+'a'.repeat(40)+' sequence=9'})
  assert.equal(generation.slot,1)
  assert.equal(generation.sequence,9)
})

test('hasVerdictForHead: an optional slot narrows the match; omitted, it still answers for ANY slot (issue #2208)',()=>{
  const io=reviewIo(),issue=2210,pr=2301,headSha='f2'.repeat(20)
  assert.equal(hasVerdictForHead(issue,pr,headSha,io),false)
  giveVerdict(io,{issue,pr,headSha,slot:1})
  // No slot given: unchanged pre-#2208 behavior, any slot's verdict counts.
  assert.equal(hasVerdictForHead(issue,pr,headSha,io),true)
  // Asked on behalf of slot 1 specifically: still true, it's slot 1's own verdict.
  assert.equal(hasVerdictForHead(issue,pr,headSha,io,{slot:1}),true)
  // Asked on behalf of slot 2 specifically: false. Slot 1's verdict is a
  // SIBLING slot's state, not slot 2's own -- this is the exact distinction
  // #2208's lockout collapsed.
  assert.equal(hasVerdictForHead(issue,pr,headSha,io,{slot:2}),false)
  giveVerdict(io,{issue,pr,headSha,slot:2})
  assert.equal(hasVerdictForHead(issue,pr,headSha,io,{slot:2}),true)
})

test('releasing a failed slot 2 reviewer is still refused once slot 2 ITSELF already has a durable verdict (issue #2208 does not weaken same-slot protection)',()=>{
  const io=withAtomicRefs(reviewIo()),request={issue:2209,pr:2300,headSha:'f1'.repeat(20)}
  io.getPr=()=>({number:request.pr,state:'open',head:{sha:request.headSha,ref:'codex/x'}})
  assignNextReviewer(request,io)
  const second=assignNextReviewer({...request,slot:2},io)
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:2})
  assert.throws(()=>releaseFailedReviewer({issue:request.issue,pr:request.pr,headSha:request.headSha,failedSequence:second.sequence,slot:2,failureCode:'provider_unavailable',confirmNoVerdict:true,confirmNoArtifact:true},io),/verdict/)
})

test('an invalid review slot is refused',()=>{
  const io=reviewIo()
  assert.throws(()=>assignNextReviewer({issue:205,pr:305,headSha:'a'.repeat(40),slot:0},io),/positive integer/)
  assert.throws(()=>assignNextReviewer({issue:205,pr:305,headSha:'a'.repeat(40),slot:1.5},io),/positive integer/)
})

test('retrying a slot-2 assignment must still refuse a durable assignment to a reviewer that is no longer eligible',()=>{
  // grok-4.6, PR #2484: be exact about which half of this guard the fixture
  // proves. The refusal below is produced by RETIREMENT -- the planted lease is
  // never consulted, because findBusyReviewers only walks ACTIVE_REVIEWERS. The
  // engine half of the same guard has no active carrier left to provoke it and
  // is proved directly against REVIEWERS on the last line instead. Deleting the
  // retry-time eligibility check still fails this test: the fixture's PR head
  // does not match, so the retry would hand the stale assignment straight back.
  //
  // Codex was retired from the active roster on 2026-09-06 and it is the only
  // reviewer that ever carried an orchestrator engine, so this conflict can no
  // longer be produced by DRAWING codex. It can still be produced by the state
  // that matters in production: a DURABLE slot-2 assignment recorded to codex
  // before the retirement, whose retry lands here afterwards. The guard is
  // re-checked on every retry return, so a still-live assignment to a reviewer
  // that is no longer eligible -- retired, quarantined, or conflicting with the
  // live orchestrator engine -- must refuse rather than hand the slot back.
  const io=reviewIo(),request={issue:206,pr:306,headSha:'9'.repeat(40)}
  assignNextReviewer(request,io)
  const second=assignNextReviewer({...request,slot:2},io)
  // second.reviewer is drawn from ACTIVE_REVIEWERS, so it cannot be codex; asserting that here
  // would be an assertion that can never fail. It is stated only as the premise of the rewrite
  // below, which plants codex as the durably recorded slot-2 reviewer.
  const assignmentRef=`refs/db-review-assignments/${request.issue}-${request.pr}-${request.headSha}-slot2`
  const recorded=io.getCommit(io.refs.get(assignmentRef)).message
  const rewritten=io.makeOwnerCommit(recorded.replace(`reviewer=${second.reviewer}`,'reviewer=codex-gpt-5.6-sol'))
  io.refs.set(assignmentRef,rewritten)
  io.refs.delete(reviewActiveRef(second.reviewer))
  io.refs.set(reviewActiveRef('codex-gpt-5.6-sol'),rewritten)
  assert.throws(()=>assignNextReviewer({...request,slot:2},io),/orchestrator-conflicting reviewer codex-gpt-5\.6-sol/)
  // Same refusal for the live-orchestrator route the retirement made
  // undrawable: the filter itself still removes an engine-matching reviewer.
  assert.equal(reviewersForOrchestrator('codex',REVIEWERS).some((row)=>row.name==='codex-gpt-5.6-sol'),false)
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
function mergedRehearsalIo({version='20260828232207',migration=`supabase/migrations/${version}_wwe.sql`,workIssue=1769,claimNumber=1805,prNumber=1809,branch='issue-1769-wwe-tables',head='a'.repeat(40),mergeSha='b'.repeat(40),mainSha='d'.repeat(40),migrationBody='create table plm.wwe_property();',writes=['table plm.wwe_property']}={}){
  const claim={number:claimNumber,title:`CLAIM: #${workIssue} migration`,body:[
    '```db-claim','version: '+version,'objects:',...writes.map((value)=>`  - ${value}`),'```','',
    '```db-author-lease',`owner: agent/issue-${workIssue}`,`branch: ${branch}`,
    'worktree: C:/repos/x','expires_at: 2099-01-01T00:00:00Z','```'].join('\n')}
  const files={[migration]:migrationBody,'config/orchestrator-global-invalidators-v1.json':'{"schema_version":1,"files":[]}'}
  return {head,mergeSha,mainSha,version,io:{
    openClaims:()=>[claim],
    openPulls:()=>[],
    branchPulls:(candidate)=>candidate===branch?[{number:prNumber,head:{ref:branch,sha:head},base:{sha:'c'.repeat(40)},merged_at:'2026-08-29T00:32:19Z',merge_commit_sha:mergeSha}]:[],
    mergeCommitInMain:(sha)=>sha===mergeSha,
    getPrFiles:()=>[{filename:migration,status:'added'}],
    getFileAt:(file)=>{if(!(file in files))throw new LaneError(`missing ${file}`);return files[file]},
    treeFiles:()=>[migration],
    getIssue:()=>({body:['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 1','writes:',...writes.map((value)=>`  - ${value}`),'```'].join(String.fromCharCode(10))}),
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

function pinnedHistoricalClaimApplyIo({runId='34157812748',appliedCommit='bcc2603977678db73b4ca12d3ed1312a1bff64e2',previewProject='mvpkijzfmfcxhnzqogzs',migrationBody=null}={}){
  const dispatchHead='4f093e3d4c97e4272d147d38e7243ec57d3c08f1',version='20260907131728'
  const migration='supabase/migrations/20260907131728_popsg_preview_stats_indexed_categories.sql'
  const body=migrationBody??readFileSync(migration,'utf8')
  return {
    issueComments:()=>[{body:`Authoritative original preview application: https://github.com/u2giants/shared-db/actions/runs/${runId}`}],
    getFileAt:(file)=>{if(file!==migration)throw new LaneError(`missing ${file}`);return body},
    previewApplyRun:()=>( {
      run:{id:Number(runId),path:'.github/workflows/shared-supabase-migrations.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',run_attempt:1,head_sha:dispatchHead},
      artifacts:{total_count:1,artifacts:[{name:`preview-migration-apply-${appliedCommit}`,digest:'sha256:3fcd874602c5c52293448a83fdb27c126a8f0cf78e63e24af0d2a10a03128a6b',expired:false,workflow_run:{id:Number(runId),head_sha:dispatchHead}}]},
      logs:[`Bounded apply ${JSON.stringify({allowlist:[version],appliedCommit,previewProjectRef:previewProject,rehearsalMode:'claim',runId:Number(runId),schema:'shared-db-preview-instance-binding/v1'})}`,`preview\tReport the preview ledger delta\t2026-09-07T20:03:31Z ### Preview ledger delta`,`preview\tReport the preview ledger delta\t2026-09-07T20:03:31Z - added: ${version}`,'preview\tReport the preview ledger delta\t2026-09-07T20:03:31Z - removed: (none)'].join('\n'),
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

test('archived unnamed steps require an exact artifact receipt and never override contradictory named proof',()=>{
  const input={issue:1769,pr:1809,versions:['20260828232207'],mergeCommitSha:'b'.repeat(40)}
  const fixture=immutablePreviewApplyIo(), evidence=fixture.previewApplyRun()
  evidence.artifacts.artifacts[0].id=456
  evidence.logs=evidence.logs.replaceAll('Report the preview ledger delta','UNKNOWN STEP')
  const io={...fixture,previewApplyRun:()=>evidence}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  let calls=0
  io.verifyPreviewApplyArtifact=(request)=>{
    calls++
    assert.equal(request.verificationCommit,input.mergeCommitSha)
    return {verified:true,runId:request.run.id,artifactId:456,artifactDigest:request.artifact.digest,versions:request.versions}
  }
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,io),{type:'preview-apply',run_id:'33308168016'})
  assert.equal(calls,1)
  const valid=io.verifyPreviewApplyArtifact
  io.verifyPreviewApplyArtifact=(request)=>({...valid(request),artifactId:457})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  io.verifyPreviewApplyArtifact=()=>{throw new Error('digest mismatch')}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.logs+='\npreview\tReport the preview ledger delta\t- added: 20260101000000'
  io.verifyPreviewApplyArtifact=()=>assert.fail('contradictory named proof must not use artifact fallback')
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
})

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

test('the exact byte-pinned #2509 claim apply is valid immutable historical-rebind evidence',()=>{
  const input={issue:2509,pr:2513,versions:['20260907131728'],mergeCommitSha:'c5f85ad3a98b7a5598e8c81a56735473d5bb5487'}
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo()),{type:'preview-apply',run_id:'34157812748'})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({runId:'34157812749'})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({appliedCommit:'a'.repeat(40)})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({previewProject:'wrong-preview'})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({migrationBody:'select 1;\n'})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence({...input,versions:['20260907131729']},pinnedHistoricalClaimApplyIo()),/found 0/)
})

function historicalTerminalIo(overrides={}){
  const manifest={target:'preview',preview_allowlist:'20260907131728',claim_pr:'2513',claim_head_sha:'1be8f325dbf1ff035bd5039638dc47c14a3eb155',commit_sha:'c5f85ad3a98b7a5598e8c81a56735473d5bb5487',historical_preview_source_pr:'2513',historical_preview_original_run_map:'20260907131728:34157812748'}
  const readyInput={issue:2509,pr:2513,head_sha:manifest.claim_head_sha,bundle_id:'7e75bf09d81bc26fd310797c9db658629871b3ed186ee4788dfce4a6ac13b42b',route:'historical_rebind',route_context:manifest.commit_sha,manifest}
  const record=readyRecord(readyInput),refs=new Map()
  // Written by the REAL writer rather than by a hand-copied digest convention. A
  // producer/consumer digest divergence must BREAK this fixture, not hide inside it:
  // the previous hand-set digest pinned one convention and passed either way.
  persistInitialReady(readyInput,{resolveMarker:()=>({live:true,task:'t',calling_task:'t'}),actor:()=> 't',now:()=> '2026-09-08T09:38:33Z',appendEvent:()=>{},createRef:(ref,digest,value)=>refs.has(ref)?false:(refs.set(ref,{digest,record:value}),true),readRef:(ref)=>refs.get(ref)??null})
  const runId='34211013201',artifactId='10049835085',artifactDigest=`sha256:${'4'.repeat(64)}`
  const evidence={
    run:{id:Number(runId),path:'.github/workflows/shared-supabase-migrations.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',run_attempt:1,head_sha:manifest.commit_sha},
    artifacts:{total_count:1,artifacts:[{id:Number(artifactId),name:`preview-migration-apply-${manifest.commit_sha}`,digest:artifactDigest,expired:false,workflow_run:{id:Number(runId),head_sha:manifest.commit_sha}}]},
    logs:[`preview\tProve historical preview recovery source\t2026-09-08T09:38:33Z ORIGINAL_RUN_MAP: ${manifest.historical_preview_original_run_map}`,`preview\tProve historical preview recovery source\t2026-09-08T09:38:33Z SOURCE_PR: ${manifest.historical_preview_source_pr}`,`preview\tProve historical preview recovery source\t2026-09-08T09:38:33Z MAIN_SHA: ${manifest.commit_sha}`,`preview\tAssert the target project ref is PREVIEW\t2026-09-08T09:38:30Z PREVIEW_ALLOWLIST: ${manifest.preview_allowlist}`,'preview\tReport the preview ledger delta\t2026-09-08T09:38:53Z - rows before: 626','preview\tReport the preview ledger delta\t2026-09-08T09:38:53Z - rows after:  626','preview\tReport the preview ledger delta\t2026-09-08T09:38:53Z - added: (none)','preview\tReport the preview ledger delta\t2026-09-08T09:38:53Z - removed: (none)'].join('\n'),
  }
  const flow={resolveMarker:()=>({live:true,task:'route',calling_task:'route'}),readRef:(ref)=>refs.get(ref)??null,createRef:(ref,digest,value)=>{if(refs.has(ref))return false;refs.set(ref,{digest,record:value});return true}}
  return {record,runId,artifactId,artifactDigest,refs,evidence,io:{orchestratorFlowAdapter:()=>flow,previewApplyRun:()=>evidence},...overrides}
}

function historicalTerminalArgs(fixture){return ['--terminalize-historical-preview-ready',fixture.record.ready_id,'--issue','2509','--run-id',fixture.runId,'--artifact-id',fixture.artifactId,'--artifact-digest',fixture.artifactDigest,'--manifest-digest',fixture.record.manifest_digest]}

test('the GitHub-backed CLI terminalizes the exact no-write historical recovery once with immutable readback',()=>{
  const fixture=historicalTerminalIo(),printed=[],log=console.log;console.log=(line)=>printed.push(line)
  try{assert.equal(main(historicalTerminalArgs(fixture),NOW,fixture.io),0);assert.equal(main(historicalTerminalArgs(fixture),NOW,fixture.io),0)}finally{console.log=log}
  const ref=`refs/db-preview-ready-outcomes/${fixture.record.ready_id}`,outcome=fixture.refs.get(ref)
  assert.equal(outcome.digest,'dispatched');assert.equal(outcome.record.outcome,'dispatched');assert.deepEqual(outcome.record.proof,{positive:true,mode:'apply',run_id:fixture.runId,artifact_id:fixture.artifactId,artifact_digest:fixture.artifactDigest,manifest_digest:fixture.record.manifest_digest,ledger_rows:626})
  assert.equal(JSON.parse(printed[0]).ref,ref)
})

test('historical recovery terminalization fails closed on every mismatched live proof',()=>{
  const cases=[
    (f,a)=>{a[1]='f'.repeat(64)},
    (f,a)=>{a[a.indexOf('--run-id')+1]='34211013202'},
    (f,a)=>{a[a.indexOf('--artifact-id')+1]='10049835086'},
    (f,a)=>{a[a.indexOf('--artifact-digest')+1]=`sha256:${'5'.repeat(64)}`},
    (f,a)=>{a[a.indexOf('--manifest-digest')+1]='6'.repeat(64)},
    (f)=>{f.evidence.run.conclusion='failure'},
    (f)=>{f.evidence.logs=f.evidence.logs.replace('- rows after:  626','- rows after:  627')},
    (f)=>{f.evidence.logs=f.evidence.logs.replace('ORIGINAL_RUN_MAP: 20260907131728:34157812748','ORIGINAL_RUN_MAP: 20260907131728:34157812749')},
  ]
  const error=console.error;console.error=()=>{}
  try{for(const mutate of cases){const fixture=historicalTerminalIo(),args=historicalTerminalArgs(fixture);mutate(fixture,args);assert.equal(main(args,NOW,fixture.io),2);assert.equal(fixture.refs.has(`refs/db-preview-ready-outcomes/${fixture.record.ready_id}`),false)}}finally{console.error=error}
  const occupied=historicalTerminalIo(),outcomeRef=`refs/db-preview-ready-outcomes/${occupied.record.ready_id}`;occupied.refs.set(outcomeRef,{digest:'dispatched',record:{outcome:'dispatched',proof:{positive:true,mode:'apply'}}})
  console.error=()=>{};try{assert.equal(main(historicalTerminalArgs(occupied),NOW,occupied.io),2)}finally{console.error=error}
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

test('preview preparation classifies migration SQL, not filenames, and binds it to the claim writes',()=>{
  assert.throws(()=>deriveLivePreviewCandidate(1769,mergedRehearsalIo({migrationBody:'insert into plm.wwe_property values (1);'}).io),/not structural/)
  assert.throws(()=>deriveLivePreviewCandidate(1769,mergedRehearsalIo({migrationBody:'create table plm.wwe_property();\ncreate table plm.undeclared();'}).io),/do not exactly match claim #1805 writes/)
  assert.equal(deriveLivePreviewCandidate(1769,mergedRehearsalIo().io).pr,1809)
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

test('#2509 emits only the existing no-write historical recovery manifest from its exact pinned apply',()=>{
  const migration='supabase/migrations/20260907131728_popsg_preview_stats_indexed_categories.sql'
  const mergeSha='c5f85ad3a98b7a5598e8c81a56735473d5bb5487',head='1be8f325dbf1ff035bd5039638dc47c14a3eb155'
  const fixture=mergedRehearsalIo({
    version:'20260907131728',migration,workIssue:2509,claimNumber:2511,prNumber:2513,branch:'codex/issue-2509-popsg-preview-stats',head,mergeSha,mainSha:mergeSha,
    migrationBody:readFileSync(migration,'utf8'),
    writes:['function public.get_sg_preview_stats','index public.idx_sgf_active_preview_category','table public.style_guide_files'],
  })
  const evidence=pinnedHistoricalClaimApplyIo();delete evidence.getFileAt
  Object.assign(fixture.io,evidence)
  fixture.io.previewLedger=()=>({versions:['20260907131728']})
  const candidate=deriveLivePreviewCandidate(2509,fixture.io)
  assert.equal(candidate.route,'historical_rebind')
  assert.equal(candidate.route_context,mergeSha)
  assert.deepEqual(candidate.manifest,{
    target:'preview',preview_allowlist:'20260907131728',claim_pr:'2513',claim_head_sha:head,commit_sha:mergeSha,
    historical_preview_source_pr:'2513',historical_preview_original_run_map:'20260907131728:34157812748',
  })
  assert.equal('merged_preview_source_pr' in candidate.manifest,false)
  assert.equal('production_allowlist' in candidate.manifest,false)
  // #2796: apply-only, and the instruction says so. The workflow's mode input
  // defaults to dry-run, and a historical dry-run runs neither the recovery proof
  // nor a bounded dry-run -- it just succeeds having proved nothing.
  assert.deepEqual(candidate.mode_sequence,['apply'])
  assert.equal('mode' in candidate.manifest,false)
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
  // #2796: the dry-run is a REQUIRED first phase here, so the instruction names
  // both phases rather than being silent and dispatching at the dry-run default.
  assert.deepEqual(candidate.mode_sequence,['dry-run','apply'])
  assert.equal('mode' in candidate.manifest,false)
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

test('a slot-1 verdict neither frees nor blocks a live slot-2 replacement (issue #2208)',()=>{
  const io=withAtomicRefs(reviewIo()),request={issue:2208,pr:2221,headSha:'d8'.repeat(20)}
  io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const slotOne=assignNextReviewer(request,io)
  const slotTwo=assignNextReviewer({...request,slot:2},io)
  const replacementRequest={...request,slot:2,failedSequence:slotTwo.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}
  const replacement=replaceFailedReviewer(replacementRequest,io)
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:1})
  const assigned=assignNextReviewer({...request,slot:2},io)
  assert.equal(assigned.reviewer,replacement.reviewer,'slot-1 completion must not clear the live slot-2 replacement lease')
  assert.equal(assigned.replacementSha,replacement.replacementSha)
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),replacement,'slot-1 completion must not block an idempotent slot-2 replacement retry')
  assert.equal(io.refs.get(reviewActiveRef(replacement.reviewer)),replacement.replacementSha)
  assert.notEqual(replacement.reviewer,slotOne.reviewer)
})

test('a slot-2 verdict never frees a live slot-1 replacement (issue #2208)',()=>{
  const io=withAtomicRefs(reviewIo()),request={issue:2208,pr:2221,headSha:'f8'.repeat(20)}
  io.getPr=()=>({state:'open',head:{sha:request.headSha}})
  const slotOne=assignNextReviewer(request,io)
  assignNextReviewer({...request,slot:2},io)
  const replacementRequest={...request,failedSequence:slotOne.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}
  const replacement=replaceFailedReviewer(replacementRequest,io)
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:2})
  const busy=findBusyReviewers(io)
  assert.ok(busy.has(replacement.reviewer))
  assert.equal(io.refs.get(reviewActiveRef(replacement.reviewer)),replacement.replacementSha)
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),replacement)
})

test("end to end: slot 1's verdict must not refuse --replace-failed-reviewer --review-slot 2 at the same head (issue #2208 follow-up F2)",()=>{
  // The unit check above proves the predicate; this proves the COMMAND. With
  // assertAssignmentWasNotTerminallyReleased after a slot-2 release, a refusal
  // here leaves slot 2 unfillable at that head and the only escape is pushing a
  // new head -- which discards slot 1's valid verdict. The merge gate's own
  // disregarded-verdict note tells operators to run exactly this command.
  const io=withAtomicRefs(reviewIo()),request={issue:2212,pr:2303,headSha:'c4'.repeat(20)}
  io.getPr=()=>({number:request.pr,state:'open',head:{sha:request.headSha,ref:'codex/x'}})
  assignNextReviewer(request,io)
  const second=assignNextReviewer({...request,slot:2},io)
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:1})
  const replacement=replaceFailedReviewer({...request,slot:2,failedSequence:second.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  assert.notEqual(replacement.reviewer,second.reviewer)
  // Same-slot protection is NOT weakened: slot 2's own verdict still forbids it.
  giveVerdict(io,{issue:request.issue,pr:request.pr,headSha:request.headSha,slot:2})
  assert.throws(()=>replaceFailedReviewer({...request,slot:2,failedSequence:replacement.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io),/verdict/)
})

test('replacement refusal is scoped to the requested review slot (issue #2208)',()=>{
  const io=reviewIo(),issue=2208,pr=2221,headSha='e8'.repeat(20)
  giveVerdict(io,{issue,pr,headSha,slot:1})
  assert.equal(headVerdictBlocksReplacement(issue,pr,headSha,io,{slot:2}),false)
  assert.equal(headVerdictBlocksReplacement(issue,pr,headSha,io,{slot:1}),true)
  assert.equal(headVerdictBlocksReplacement(issue,pr,headSha,io,{slot:null}),true,'an unknown slot remains fail-closed')
  assert.equal(headVerdictBlocksReplacement(issue,pr,headSha,io),true,'legacy omitted-slot callers remain fail-closed')
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
  assert.equal(attempts,20,`slot-2 replacement used ${attempts} of ${REVIEW_OPERATION_REQUEST_LIMIT}: ${labels.join(',')}`)
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

// ---------------------------------------------------------------------------
// #2079. THE READ SIDE OF THE NON-READING-REVIEWER FACT.
// The write-side guard added for #2078 binds only future verdicts. The artifact
// deepseek-chat already produced (refs/db-review-verdicts/1987-1989-fe810d47...)
// is immutable and was still merge-gate-valid. These tests fix the head this
// fixture describes and prove the recorded artifact no longer satisfies the
// gate, in BOTH verdict directions, and that the slot stays re-reviewable.
// ---------------------------------------------------------------------------
function nonReadingVerdictFixture(verdict='APPROVE',reviewer='deepseek-chat'){
  const issue=1987,pr=1989,headSha='f'.repeat(40),findingsBody='fabricated findings'
  const findingsRef=`https://github.com/u2giants/shared-db/pull/${pr}#issuecomment-9`
  const assignmentSha='1'.repeat(40),verdictSha='2'.repeat(40)
  const commits=new Map([[assignmentSha,{message:`db-coordination reviewer-cursor sequence=1 reviewer=${reviewer} issue=${issue} pr=${pr} head=${headSha} slot=1`}]])
  const record={verdict,head_sha:headSha,issue,pr,slot:1,reviewer,assignment_sha:assignmentSha,findings_digest:createHash('sha256').update(findingsBody).digest('hex'),findings_ref:findingsRef}
  commits.set(verdictSha,{message:`db-review-verdict ${JSON.stringify(record)}`,parents:[{sha:assignmentSha}]})
  const refs=new Map([
    [`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,assignmentSha],
    [`${REVIEW_VERDICT_REF_PREFIX}/${issue}-${pr}-${headSha}`,verdictSha],
  ])
  const io={
    listRefs:(prefix)=>[...refs].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})),
    readRef:(ref)=>refs.get(ref)??null,
    getCommit:(sha)=>commits.get(sha),
    readFindings:()=>findingsBody,
  }
  return {issue,pr,headSha,io,verdictSha}
}

test('an already-recorded APPROVE from a reviewer that cannot read the repository does not satisfy the preview gate (#2079)',()=>{
  const fixture=nonReadingVerdictFixture('APPROVE')
  // Read as absent, not as evidence.
  assert.deepEqual(readReviewVerdicts(fixture.issue,fixture.pr,fixture.headSha,fixture.io),[])
  const disregarded=readReviewVerdicts(fixture.issue,fixture.pr,fixture.headSha,fixture.io,{includeDisregarded:true})
  assert.equal(disregarded.length,1)
  assert.equal(disregarded[0].disregarded,true)
  assert.equal(disregarded[0].reviewer,'deepseek-chat')
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io),
    /review slot 1 has no durable APPROVE[\s\S]*DISREGARDED because their reviewer cannot read the repository[\s\S]*reviewer_cannot_read_repository/)
  // Control: the SAME artifact from a reviewer that reads the code still passes,
  // so this is a reviewer-capability rule and not a blanket refusal.
  const reading=nonReadingVerdictFixture('APPROVE','glm-5.3')
  assert.equal(assertDurableReviewApproval(reading.issue,reading.pr,reading.headSha,reading.io).length,1)
})

test('a recorded REVISE from a non-reading reviewer is absent, never a permanent refusal (#2079)',()=>{
  const fixture=nonReadingVerdictFixture('REVISE')
  // ABSENT, not REFUSED. A refusal on an immutable create-only artifact could
  // never be cleared and the pull request would be stuck forever.
  assert.throws(()=>assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io),
    /review slot 1 has no durable APPROVE/)
  assert.doesNotThrow(()=>{try{assertDurableReviewApproval(fixture.issue,fixture.pr,fixture.headSha,fixture.io)}catch(error){
    assert.doesNotMatch(error.message,/carries a durable reviewer refusal/);return}})
  // The real deepseek-chat verdict on PR #1989 was a REVISE, so this is the
  // exact artifact the issue describes.
  assert.equal(readReviewVerdicts(fixture.issue,fixture.pr,fixture.headSha,fixture.io).length,0)
})

test('a disregarded verdict does not forbid the replacement its own refusal names (#2079)',()=>{
  // The recovery route must run ON THE SAME HEAD that already carries the
  // fabricated artifact. Before this fix the durable verdict tripped
  // "an existing verdict for the exact head forbids reviewer replacement",
  // so the message named a route that was itself refused.
  const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}})
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=1 reviewer=deepseek-chat issue=${failedReview.issue} pr=${failedReview.pr} head=${failedReview.headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`,sha)
  io.refs.set(reviewActiveRef('deepseek-chat'),sha)
  io.refs.set(REVIEW_CURSOR_REF,sha)
  io.refs.set(`${REVIEW_VERDICT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`,sha)
  const replacement=replaceFailedReviewer({...replacementRequest,failureCode:'reviewer_cannot_read_repository'},io)
  assert.equal(reviewerReadsRepository(replacement.reviewer),true)
  assert.ok(TERMINAL_FAILURE_CODES.includes('reviewer_cannot_read_repository'))
  assert.equal(nonReadingReviewerReplacementCommand({issue:failedReview.issue,pr:failedReview.pr,headSha:failedReview.headSha,slot:1},1).includes('--failure-code reviewer_cannot_read_repository --confirm-no-verdict --confirm-no-artifact'),true)
})

test('a verdict from a reviewer that DOES read the repository still forbids replacement (#2079)',()=>{
  // The scope control for the test above: a genuine verdict must keep blocking
  // replacement, or "replace the reviewer" becomes a way to un-review a change.
  const io=failedReviewIo()
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`
  assert.equal(reviewerReadsRepository(parseReviewCursor(io.getCommit(io.refs.get(assignmentRef))).reviewer),true)
  io.refs.set(`${REVIEW_VERDICT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`,io.refs.get(assignmentRef))
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/existing verdict for the exact head forbids reviewer replacement/)
})

// #2079 ROUND 3 -- FAIL-CLOSED ATTRIBUTION ON THE REPLACEMENT PATH.
//
// Replacement is the "un-review this head" direction. It may discard a durable
// verdict artifact ONLY when the artifact is positively attributed to a roster
// reviewer whose row says readsRepository:false. Every other outcome -- an
// unknown name, a case-shifted name, a missing or unreadable owning record, an
// unparseable cursor commit -- must BLOCK, because permitting on an
// unclassifiable artifact is the same hole as trusting one.
function attributionFixture(setup){
  const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}})
  const {issue,pr,headSha}=failedReview
  const verdictSha=io.makeOwnerCommit('verdict')
  io.refs.set(`${REVIEW_VERDICT_REF_PREFIX}/${issue}-${pr}-${headSha}`,verdictSha)
  setup(io,{issue,pr,headSha})
  return io
}
function assignmentCursor(reviewer){
  return `db-coordination reviewer-cursor sequence=1 reviewer=${reviewer} issue=${failedReview.issue} pr=${failedReview.pr} head=${failedReview.headSha}`
}
const attributionBlocks=(io)=>headVerdictBlocksReplacement(failedReview.issue,failedReview.pr,failedReview.headSha,io)

test('#2079: a verdict from a reviewer OUTSIDE the roster blocks replacement',()=>{
  // The round-2 hole. `reviewerReadsRepository` returns false for an unknown
  // name, and returning that directly PERMITTED replacement -- so any artifact
  // that could not be attributed could be stripped off the head.
  const io=attributionFixture((io,{issue,pr,headSha})=>{
    io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,io.makeOwnerCommit(assignmentCursor('some-retired-reviewer-9')))
  })
  assert.equal(attributionBlocks(io),true)
})

test('#2079: a CASE-SHIFTED non-reading name blocks replacement',()=>{
  // `parseReviewCursor` matches reviewer names case-insensitively; the roster
  // lookup is exact. So "DeepSeek-Chat" resolves as a name but classifies as
  // nothing, and unclassifiable must block.
  const io=attributionFixture((io,{issue,pr,headSha})=>{
    io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,io.makeOwnerCommit(assignmentCursor('DeepSeek-Chat')))
  })
  assert.equal(attributionBlocks(io),true)
})

test('#2079: a verdict whose owning assignment ref is MISSING blocks replacement',()=>{
  const io=attributionFixture(()=>{})
  assert.equal(io.refs.has(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${failedReview.issue}-${failedReview.pr}-${failedReview.headSha}`),false)
  assert.equal(attributionBlocks(io),true)
})

test('#2079: an UNREADABLE owning record blocks replacement',()=>{
  const io=attributionFixture((io,{issue,pr,headSha})=>{
    io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,io.makeOwnerCommit(assignmentCursor('deepseek-chat')))
    io.readRef=()=>{throw new LaneError('ref read failed')}
  })
  // A transport failure must not read as "no reviewer, therefore discardable".
  assert.equal(attributionBlocks(io),true)
})

test('#2079: an UNPARSEABLE assignment commit message blocks replacement',()=>{
  const io=attributionFixture((io,{issue,pr,headSha})=>{
    io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,io.makeOwnerCommit('not a reviewer cursor at all'))
  })
  assert.equal(attributionBlocks(io),true)
})

test('#2079: a REPLACEMENT-namespace verdict with no owning replacement record blocks',()=>{
  // The verdict ref names replacement sequence 3, so the owning record is in the
  // replacement namespace. A stale assignment ref must not answer for it.
  const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}})
  const {issue,pr,headSha}=failedReview
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,io.makeOwnerCommit(assignmentCursor('deepseek-chat')))
  io.refs.set(`refs/db-review-verdict-replacements/${issue}-${pr}-${headSha}-3`,io.makeOwnerCommit('verdict'))
  assert.equal(attributionBlocks(io),true)
})

test('#2079: only a roster row that positively says readsRepository:false is discardable',()=>{
  // The deliberate pass-through, stated as the predicate itself.
  assert.equal(reviewerKnownNonReading('deepseek-chat'),true)
  assert.equal(reviewerKnownNonReading('glm-5.3'),false)
  assert.equal(reviewerKnownNonReading('who-is-this'),false)
  assert.equal(reviewerKnownNonReading(''),false)
  assert.equal(reviewerKnownNonReading(undefined),false)
  // ...and the pass-through still holds end to end: the known non-reading
  // artifact does NOT block the replacement its own refusal message names.
  const io=attributionFixture((io,{issue,pr,headSha})=>{
    io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,io.makeOwnerCommit(assignmentCursor('deepseek-chat')))
  })
  assert.equal(attributionBlocks(io),false)
})

test('every reviewer records WHEN and AGAINST WHAT its readsRepository claim was verified (#2079)',()=>{
  // readsRepository is a hand-maintained claim about wrappers in another
  // repository. Nothing here can re-verify it, so the provenance is mandatory:
  // a new reviewer cannot be added without saying when a human checked it.
  for(const row of REVIEWERS){
    assert.equal(typeof row.readsRepository,'boolean',`${row.name} must state readsRepository`)
    assert.match(row.readsRepositoryVerified?.date??'',/^\d{4}-\d{2}-\d{2}$/,`${row.name} must record the verification date`)
    assert.ok(String(row.readsRepositoryVerified?.evidence??'').trim().length>20,`${row.name} must record what was read`)
  }
})

// ISSUE #2075 -- THE CAUSE, NOT THE SYMPTOM. The orphaned findings comment only
// deadlocked PR #2080 because every lane decision read a decision word out of
// comment text. These two assertions are the whole repair: prose never creates a
// verdict, and an unreadable namespace refuses rather than reporting "no verdict"
// (the fail-OPEN direction that would let release and replacement proceed).
test('issue 2075: comment prose is never a verdict and the durable artifact always is',()=>{
  const io=reviewIo(),headSha='2075'.padEnd(40,'a'),issue=2075,pr=2080
  io.getIssueComments=()=>[{body:`VERDICT: APPROVE ${headSha}`,author_association:'OWNER',commit_id:headSha}]
  io.getPrReviews=()=>[{body:`APPROVE ${headSha}`,state:'APPROVED',author_association:'OWNER',commit_id:headSha}]
  assert.equal(hasVerdictForHead(issue,pr,headSha,io),false,'a trusted comment must not create a verdict')
  giveVerdict(io,{issue,pr,headSha})
  assert.equal(hasVerdictForHead(issue,pr,headSha,io),true,'the create-only artifact is the verdict')
  assert.equal(hasVerdictForHead(issue,pr,'b'.repeat(40),io),false,'a verdict at another head never carries forward')
  assert.equal(hasVerdictForHead(issue,9999,headSha,io),false,'a verdict on another PR is not this PR')
})

test('issue 2075: an unreadable durable verdict namespace refuses instead of reporting no verdict',()=>{
  const io=reviewIo();delete io.listRefs
  assert.throws(()=>hasVerdictForHead(2075,2080,'a'.repeat(40),io),/never by comment text/)
})

// ISSUE: EXCLUDING THE HOLDER OF THE CURRENT HEAD'S ASSIGNMENT DEADLOCKED THE PR.
//
// Live instance: issue #1999 / PR #2002, reviewer muse-spark-1.2-contributor
// excluded for `already-reviewed` while it held the assignment ref for head
// 0f139c0d. The exclusion released the lease and left the assignment ref naming
// the excluded reviewer, so every later --assign-reviewer for that head refused
// ("it was not returned or re-leased"), --replace-failed-reviewer could not be
// used honestly (it demands a terminal failure code and nothing failed), and
// assertDurableReviewApproval kept demanding an APPROVE for a slot no eligible
// reviewer could ever be drawn into. The four tests below are the proof set: the
// first two fail against the pre-fix script, the last two must keep passing.
function returnScenario(issue,pr,head){
  const io=withAtomicRefs(reviewIo())
  io.getPr=()=>({number:pr,state:'open',head:{sha:head,ref:'codex/x'}})
  const first=assignNextReviewer({issue,pr,headSha:head},io)
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${head}`
  return {io,first,assignmentRef,evidenceSha:io.refs.get(assignmentRef)}
}

// PROOF 1 + 2. Fails against the current script with "durable assignment
// reviewer <name> is excluded for this PR (already-reviewed); it was not
// returned or re-leased"; passes once the exclusion returns the assignment.
test('excluding the holder of this head assignment returns the slot and a different reviewer is drawn (issue #1999)',()=>{
  const head='f'.repeat(40),{io,first,assignmentRef,evidenceSha}=returnScenario(1999,2002,head)
  const excluded=excludeReviewerForPr({issue:1999,pr:2002,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io)
  assert.equal(excluded.returned.length,1)
  const record=parseReviewReturn(io.getCommit(excluded.returned[0].sha))
  // `sequence` is the retired assignment's global cursor sequence. It is what
  // lets the merge gate tell a NEWER assignment for this slot from the one that
  // was handed back, so it is asserted here rather than left to the gate tests.
  assert.deepEqual(record,{reviewer:first.reviewer,issue:1999,pr:2002,headSha:head,slot:1,assignmentSha:evidenceSha,sequence:first.sequence,replacementSequence:null,reason:'already-reviewed'})
  assert.equal(excluded.returned[0].ref,reviewReturnRef(record))
  // The retired assignment ref is cleared, and the return record -- not a bare
  // deletion -- is what carries the fact that it ever existed.
  assert.equal(io.refs.get(assignmentRef),undefined)
  assert.deepEqual(readReviewReturns(1999,2002,head,io).map((row)=>row.assignmentSha),[evidenceSha])
  assert.equal(io.refs.get(`${REVIEW_ACTIVE_REF_PREFIX}/${first.reviewer}`),undefined)
  const next=assignNextReviewer({issue:1999,pr:2002,headSha:head},io)
  assert.notEqual(next.reviewer,first.reviewer)
  assert.equal(io.refs.get(assignmentRef),io.refs.get(`${REVIEW_ACTIVE_REF_PREFIX}/${next.reviewer}`))
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith(`${REVIEW_FAILURE_REF_PREFIX}/1999-2002-`)),false)
})

// The same proof through the atomic compare-and-swap io, because the exclusion
// takes a different write path there and a readback mismatch must be provable.
test('the exclusion return lands atomically with the exclusion record (issue #1999)',()=>{
  const head='f'.repeat(40),{io,first,assignmentRef,evidenceSha}=returnScenario(1999,2012,head)
  io.readReviewRefs=(refs)=>new Map(refs.map((ref)=>[ref,io.refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{
    for(const change of changes)if((io.refs.get(change.ref)??null)!==(change.expected??null))throw new LaneError(`atomic reviewer ref transition failed: ${change.ref}`)
    for(const change of changes){if(change.sha)io.refs.set(change.ref,change.sha);else io.refs.delete(change.ref)}
  }
  io.readReviewStates=(rows)=>new Map(rows.map((row)=>[`${row.issue}:${row.pr}`,{issue:io.getIssue(),pr:io.getPr(row.pr),evidence:[]}]))
  const excluded=excludeReviewerForPr({issue:1999,pr:2012,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.equal(excluded.returned.length,1)
  assert.equal(io.refs.get(assignmentRef),undefined)
  assert.equal(io.refs.get(excluded.returned[0].ref),excluded.returned[0].sha)
  const next=assignNextReviewer({issue:1999,pr:2012,headSha:head},io)
  assert.notEqual(next.reviewer,first.reviewer)
})

// PROOF 3. The exclusion is never weakened: the returned reviewer stays barred
// from this pull request on this head and on every later head.
test('a returned reviewer is still never drawn again for that pull request (issue #1999)',()=>{
  const head='f'.repeat(40),{io,first,evidenceSha}=returnScenario(1999,2003,head)
  excludeReviewerForPr({issue:1999,pr:2003,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io)
  assert.ok(io.refs.get(`${REVIEW_EXCLUSION_REF_PREFIX}/1999-2003-${first.reviewer}`))
  const drawn=[]
  for(let n=0;n<ACTIVE_REVIEWERS.length+1;n++){
    const next=`${'0'.repeat(39)}${n.toString(16)}`.slice(-40).padStart(40,'0')
    io.getPr=()=>({number:2003,state:'open',head:{sha:next,ref:'codex/x'}})
    // Each head's reviewer finishes before the next head is assigned, so the
    // rotation is free to come back around to every provider except the
    // excluded one -- which is the point of the assertion below.
    io.getIssueComments=(number)=>Number(number)===2003?drawn.map((row)=>({body:`head ${row.headSha} APPROVE`})):[]
    io.getPrReviews=()=>[]
    drawn.push(assignNextReviewer({issue:1999,pr:2003,headSha:next},io))
  }
  assert.equal(drawn.some((row)=>row.reviewer===first.reviewer),false)
  // Re-running the identical exclusion stays idempotent after the return, and
  // records no second return for an assignment it already retired.
  assert.deepEqual(excludeReviewerForPr({issue:1999,pr:2003,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io).returned,[])
})

// PROOF 4. The approval gate is not softened. A live slot with no APPROVE is
// still refused, and a RETURNED assignment is superseded rather than silently
// satisfied -- even if its ref were somehow re-created after the return.
test('durable approval still refuses a live slot with no APPROVE and never passes a returned one (issue #1999)',()=>{
  const head='f'.repeat(40),{io,first,assignmentRef,evidenceSha}=returnScenario(1999,2004,head)
  assert.throws(()=>assertDurableReviewApproval(1999,2004,head,io),/review slot 1 has no durable APPROVE/)
  excludeReviewerForPr({issue:1999,pr:2004,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io)
  assert.throws(()=>assertDurableReviewApproval(1999,2004,head,io),/no durable reviewer assignment/)
  // A returned assignment whose ref was re-created by a racing writer is still
  // superseded history: it can neither satisfy the slot nor resurrect it.
  io.refs.set(assignmentRef,evidenceSha)
  assert.throws(()=>assertDurableReviewApproval(1999,2004,head,io),/no durable reviewer assignment/)
  io.refs.delete(assignmentRef)
  const next=assignNextReviewer({issue:1999,pr:2004,headSha:head},io)
  assert.notEqual(next.reviewer,first.reviewer)
  assert.throws(()=>assertDurableReviewApproval(1999,2004,head,io),/review slot 1 has no durable APPROVE/)
})

// A reviewer that already delivered a durable verdict is finished, not
// returnable: returning it would strip the assignment record its verdict
// artifact is validated against.
test('an assignment that already carries a durable verdict is never returned (issue #1999)',()=>{
  const head='f'.repeat(40),{io,first,evidenceSha}=returnScenario(1999,2005,head)
  io.refs.set(`refs/db-review-verdicts/1999-2005-${head}`,'b'.repeat(40))
  assert.throws(()=>excludeReviewerForPr({issue:1999,pr:2005,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io),/already recorded a durable verdict/)
  assert.ok(io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/1999-2005-${head}`))
})

// A completed review on an older head is immutable evidence, not a live lease.
// When that same reviewer holds a separate current exact-head assignment, an
// exclusion must return only the current assignment instead of treating the
// historical verdict as a reason to strand the current slot.
test('#2694 returns a live exact-head assignment despite the same reviewer having approved an older head',()=>{
  const io=withAtomicRefs(reviewIo()),issue=2694,pr=3699,oldHead='a'.repeat(40),currentHead='b'.repeat(40)
  io.requiresExactReviewHeadSha=true
  let liveHead=oldHead
  io.getPr=()=>({number:pr,state:'open',head:{sha:liveHead,ref:'codex/x'}})
  const old=assignNextReviewer({issue,pr,headSha:oldHead},io)
  const oldAssignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${oldHead}`
  const oldLeaseRef=reviewActiveRef(old.reviewer,old)
  const oldEvidenceSha=io.refs.get(oldAssignmentRef)
  io.refs.delete(oldLeaseRef)
  io.refs.set(`refs/db-review-verdicts/${issue}-${pr}-${oldHead}`,oldEvidenceSha)
  for(let n=0;n<ACTIVE_REVIEWERS.length-1;n++){
    const head=(n+1).toString(16).padStart(40,'c'),otherPr=3700+n
    io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:Number(number)===pr?liveHead:head,ref:'codex/x'}})
    assignNextReviewer({issue:2700+n,pr:otherPr,headSha:head},io)
  }
  liveHead=currentHead
  const current=assignNextReviewer({issue,pr,headSha:currentHead},io)
  assert.equal(current.reviewer,old.reviewer,'round-robin must reuse the reviewer for the separate current assignment')
  const currentAssignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${currentHead}`
  const currentEvidenceSha=io.refs.get(currentAssignmentRef)
  const excluded=excludeReviewerForPr({issue,pr,reviewer:current.reviewer,reason:'terminal-unavailable',evidenceSha:currentEvidenceSha},io)
  assert.equal(excluded.returned.length,1)
  assert.equal(excluded.returned[0].assignmentRef,currentAssignmentRef)
  assert.ok(io.refs.get(oldAssignmentRef),'the approved historical assignment remains durable')
  assert.equal(io.refs.get(`refs/db-review-verdicts/${issue}-${pr}-${oldHead}`),oldEvidenceSha,'the historical verdict remains untouched')
  assert.equal(io.refs.get(currentAssignmentRef),undefined,'only the live current assignment is returned')
  assert.equal(io.refs.get(reviewActiveRef(current.reviewer,current)),undefined,'the returned assignment own exact-head lease is released with it')
})

// A REPLACEMENT HOLDER STRANDS THE SLOT THE SAME WAY AN ORIGINAL DOES.
// --assign-reviewer reads the replacement namespace FIRST, so a replacement ref
// left naming an excluded reviewer is the identical #1999 deadlock. The
// exclusion returns both namespaces, and the return record carries the retired
// record's replacement sequence so the merge gate can order the slot's history.
function replacementScenario(issue,pr,head){
  const io=withAtomicRefs(reviewIo())
  io.getPr=()=>({number:pr,state:'open',head:{sha:head,ref:'codex/x'}})
  const first=assignNextReviewer({issue,pr,headSha:head},io)
  const replacement=replaceFailedReviewer({issue,pr,headSha:head,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  const replacementRef=[...io.refs.keys()].find((ref)=>ref.startsWith(`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${head}`))
  return {io,first,replacement,replacementRef,evidenceSha:io.refs.get(replacementRef)}
}

test('excluding a replacement holder returns the replacement slot too (issue #1999)',()=>{
  const head='c'.repeat(40),{io,replacement,replacementRef,evidenceSha}=replacementScenario(1999,2006,head)
  const excluded=excludeReviewerForPr({issue:1999,pr:2006,reviewer:replacement.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.equal(excluded.returned.length,1)
  assert.equal(excluded.returned[0].assignmentRef,replacementRef)
  assert.equal(io.refs.get(replacementRef),undefined)
  const record=parseReviewReturn(io.getCommit(excluded.returned[0].sha))
  assert.equal(record.reviewer,replacement.reviewer)
  assert.equal(record.assignmentSha,evidenceSha)
  assert.ok(record.replacementSequence>=1)
  assert.deepEqual(readReviewReturns(1999,2006,head,io).map((row)=>row.assignmentSha),[evidenceSha])
  // The slot no longer refuses every future assignment with the #1999 message.
  // (This scenario's release fixture stops the retry for an unrelated reason;
  // what is asserted is that the exclusion deadlock is not the reason.)
  try{assignNextReviewer({issue:1999,pr:2006,headSha:head},io)}
  catch(error){assert.doesNotMatch(error.message,/is excluded for this PR/)}
})

// SLOT 2 IS NOT SLOT 1 (grok-4.6 second REVISE of PR #2077, high finding 1).
//
// The exclusion used to take the slot from the ASSIGNMENT COMMIT. A replacement
// message carried no `slot=` token, so a slot-2 replacement parsed as slot 1 and
// the return was written against slot 1: it named the slot-1 return ref, asked
// slot 1's verdict ref whether the work had already been reviewed, and told the
// merge gate slot 1 had been handed back -- bricking an innocent, already
// approved slot 1 while letting a REVIEWED slot-2 replacement be returned. The
// gate tests cannot catch this: they hand-build their slot-2 return with slot=2
// already in both the ref and the commit. Only the writer can be caught here.
function slotTwoReplacementScenario(issue,pr,head){
  const io=withAtomicRefs(reviewIo())
  io.getPr=()=>({number:pr,state:'open',head:{sha:head,ref:'codex/x'}})
  const first=assignNextReviewer({issue,pr,headSha:head},io)
  const slotTwo=assignNextReviewer({issue,pr,headSha:head,slot:2},io)
  const replacement=replaceFailedReviewer({issue,pr,headSha:head,slot:2,failedSequence:slotTwo.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  const replacementRef=[...io.refs.keys()].find((ref)=>ref.startsWith(`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${head}-slot2-`))
  return {io,first,slotTwo,replacement,replacementRef,evidenceSha:io.refs.get(replacementRef)}
}

test('excluding a slot-2 replacement holder charges the return to slot 2, never slot 1',()=>{
  const head='1'.repeat(40),{io,replacement,replacementRef,evidenceSha}=slotTwoReplacementScenario(2077,2100,head)
  assert.ok(replacementRef&&evidenceSha)
  const excluded=excludeReviewerForPr({issue:2077,pr:2100,reviewer:replacement.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.equal(excluded.returned.length,1)
  assert.equal(excluded.returned[0].assignmentRef,replacementRef)
  assert.equal(excluded.returned[0].slot,2)
  const record=parseReviewReturn(io.getCommit(excluded.returned[0].sha))
  assert.equal(record.slot,2)
  assert.equal(record.sequence,replacement.sequence)
  assert.equal(excluded.returned[0].ref,reviewReturnRef(record))
  assert.ok(excluded.returned[0].ref.includes('-slot2-'))
  // The replacement COMMIT states its slot too, in the same form the original
  // assignment writer uses. It is not what the writer trusts -- the ref is --
  // but a record whose message is silent about its slot cannot be cross-checked
  // against its ref at all, and silence is how this defect stayed invisible.
  assert.equal(parseReviewCursor(io.getCommit(evidenceSha)).slot,2)
  assert.equal(parseReviewCursor(io.getCommit(io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/2077-2100-${head}`))).slot,null)
  // Slot 1 is untouched and no slot-1 return was invented for it -- the exact
  // way an innocent, already-approved slot 1 used to be bricked.
  assert.ok(io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/2077-2100-${head}`))
  assert.deepEqual(readReviewReturns(2077,2100,head,io).map((row)=>row.slot),[2])
})

// A record whose commit contradicts its own ref is CORRUPTION, not a choice
// between two answers. The ref is the authority on slot, so the writer stops
// rather than returning a slot nobody can prove was held.
test('an assignment whose commit contradicts its ref about the slot stops the exclusion',()=>{
  const head='6'.repeat(40),{io,replacement,replacementRef,evidenceSha}=slotTwoReplacementScenario(2077,2105,head)
  const commit=io.getCommit(evidenceSha)
  const forged={...commit,message:commit.message.replace(' slot=2',' slot=1')}
  const getCommit=io.getCommit
  io.getCommit=(sha)=>sha===evidenceSha?forged:getCommit(sha)
  assert.throws(()=>excludeReviewerForPr({issue:2077,pr:2105,reviewer:replacement.reviewer,reason:'independence-conflict',evidenceSha},io),/names slot 2 but its commit says slot 1/)
  assert.equal(io.refs.get(replacementRef),evidenceSha)
})

// END TO END, WRITER INTO GATE. The reviewer's counter-spot-check found that
// `excluding a replacement holder returns the replacement slot too` passes even
// with the merge gate's returned-slot rule deleted. This one does not: it takes
// the return records the WRITER actually produced and asks the gate about them.
// Delete the `newestReturned` loop and the refusal changes to slot 1's missing
// APPROVE, so the slot-2 assertion goes red; charge the return to slot 1 again
// and it names slot 1 instead. It is pinned to both defects at once.
test('the return the writer produced makes the merge gate refuse slot 2, not slot 1',()=>{
  const head='5'.repeat(40),{io,replacement,evidenceSha}=slotTwoReplacementScenario(2077,2104,head)
  excludeReviewerForPr({issue:2077,pr:2104,reviewer:replacement.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.throws(()=>assertDurableReviewApproval(2077,2104,head,io),/review slot 2 was durably returned and has no live exact-head assignment/)
  // And the refusal names the command that actually refills a returned
  // REPLACEMENT, which is not --assign-reviewer.
  assert.throws(()=>assertDurableReviewApproval(2077,2104,head,io),/--replace-failed-reviewer with the same --failed-sequence/)
})

// The verdict question is asked of the slot the record actually belongs to.
// With the slot read from the commit, a REVIEWED slot-2 replacement was asked
// about slot 1's verdict ref, found nothing there, and was returned anyway.
test('a reviewed slot-2 replacement is never returned as an unreviewed slot 1',()=>{
  const head='2'.repeat(40),{io,slotTwo,replacement,replacementRef,evidenceSha}=slotTwoReplacementScenario(2077,2101,head)
  const sequence=Number(/-(\d+)$/.exec(replacementRef)[1])
  assert.equal(sequence,slotTwo.sequence)
  io.refs.set(`refs/db-review-verdict-replacements/2077-2101-${head}-slot2-${sequence}`,'b'.repeat(40))
  assert.throws(()=>excludeReviewerForPr({issue:2077,pr:2101,reviewer:replacement.reviewer,reason:'already-reviewed',evidenceSha},io),/already recorded a durable verdict .* slot 2/)
  assert.equal(io.refs.get(replacementRef),evidenceSha)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_RETURN_REF_PREFIX)),false)
})

// THE RESIDUAL VERDICT WINDOW (grok-4.6 second REVISE of PR #2077, medium).
//
// `recordReviewVerdict` does not take the review mutex, so a verdict can still
// land after the in-mutex scan and before the return's push lands. It authorizes
// nothing -- its assignment_sha names the object the return just retired -- but
// the verdict ref is keyed per TUPLE, not per assignment, and it is create-only.
// Left in place it PINNED the head: no re-drawn reviewer could ever record a
// verdict for it again, and the only escape was a spurious new head. The orphan
// is now retired into its own durable namespace in a second atomic push, so the
// object survives for audit and the tuple is free.
function racedVerdictIo(io,tupleRef,verdictSha,record){
  const atomic=io.atomicReviewRefs,getCommit=io.getCommit
  let armed=false
  io.atomicReviewRefs=(changes)=>{
    const result=atomic(changes)
    if(!armed&&changes.some((change)=>change.ref.startsWith(REVIEW_RETURN_REF_PREFIX))){armed=true;io.refs.set(tupleRef,verdictSha)}
    return result
  }
  io.getCommit=(sha)=>sha===verdictSha?{message:`db-review-verdict ${JSON.stringify(record)}`,parents:[{sha:record.assignment_sha}]}:getCommit(sha)
}

test('a verdict that lands after the in-mutex scan is retired, not left pinning the head',()=>{
  const head='3'.repeat(40),{io,first,assignmentRef,evidenceSha}=returnScenario(2077,2102,head)
  const tupleRef=`refs/db-review-verdicts/2077-2102-${head}`,verdictSha='c'.repeat(40)
  racedVerdictIo(io,tupleRef,verdictSha,{verdict:'APPROVE',head_sha:head,issue:2077,pr:2102,slot:1,reviewer:first.reviewer,assignment_sha:evidenceSha,findings_digest:'0'.repeat(64)})
  const excluded=excludeReviewerForPr({issue:2077,pr:2102,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.equal(excluded.returned.length,1)
  assert.equal(io.refs.get(assignmentRef),undefined)
  // The tuple is free again, so the head is reviewable by the next reviewer.
  assert.equal(io.refs.get(tupleRef),undefined)
  // And the raced object is still named by a durable ref that records which
  // retired assignment it answered. Nothing is deleted, only re-filed.
  const retired=retiredVerdictRef({issue:2077,pr:2102,headSha:head,slot:1,replacementSequence:null,verdictSha})
  assert.ok(retired.startsWith(REVIEW_RETIRED_VERDICT_REF_PREFIX))
  assert.equal(io.refs.get(retired),verdictSha)
})

// A raced verdict that answers some OTHER assignment is not this orphan, and is
// never swept aside: the command stops and leaves both refs for a human.
test('a verdict naming another assignment stops the exclusion for audit',()=>{
  const head='4'.repeat(40),{io,first,evidenceSha}=returnScenario(2077,2103,head)
  const tupleRef=`refs/db-review-verdicts/2077-2103-${head}`,verdictSha='d'.repeat(40)
  racedVerdictIo(io,tupleRef,verdictSha,{verdict:'APPROVE',head_sha:head,issue:2077,pr:2103,slot:1,reviewer:first.reviewer,assignment_sha:'e'.repeat(40),findings_digest:'0'.repeat(64)})
  assert.throws(()=>excludeReviewerForPr({issue:2077,pr:2103,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io),/stopped for audit/)
  assert.equal(io.refs.get(tupleRef),verdictSha)
})

// The verdict refusal is not a slot-1-original presence stub: a verdict recorded
// against a REPLACEMENT sequence lives in its own ref namespace, and the refusal
// has to ask each held record about its own sequence.
test('a replacement assignment that already carries a durable verdict is never returned (issue #1999)',()=>{
  const head='d'.repeat(40),{io,replacement,replacementRef,evidenceSha}=replacementScenario(1999,2007,head)
  const sequence=Number(/-(\d+)$/.exec(replacementRef)[1])
  io.refs.set(`refs/db-review-verdict-replacements/1999-2007-${head}-${sequence}`,'b'.repeat(40))
  assert.throws(()=>excludeReviewerForPr({issue:1999,pr:2007,reviewer:replacement.reviewer,reason:'already-reviewed',evidenceSha},io),/already recorded a durable verdict/)
  assert.equal(io.refs.get(replacementRef),evidenceSha)
})

// A verdict-shaped COMMENT is not a durable verdict artifact. Only the
// create-only verdict ref bars a return; prose never does, in either direction.
test('a comment-only verdict never bars returning the slot (issue #1999)',()=>{
  const head='f'.repeat(40),{io,first,assignmentRef,evidenceSha}=returnScenario(1999,2008,head)
  io.getIssueComments=(number)=>Number(number)===2008?[{body:`head ${head} APPROVE`,author_association:'OWNER'}]:[]
  const excluded=excludeReviewerForPr({issue:1999,pr:2008,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.equal(excluded.returned.length,1)
  assert.equal(io.refs.get(assignmentRef),undefined)
})

// THE VERDICT RACE (grok-4.6 review of PR #2077, high finding 3).
// `recordReviewVerdict` does not take the review mutex, so a verdict can land
// after a pre-mutex scan and before the return's push. The scan that decides is
// therefore run again INSIDE the mutex, immediately before the write. Here the
// verdict appears exactly at mutex acquisition: the pre-mutex answer says
// "returnable", the in-mutex answer must say "reviewed, refuse", and the
// assignment ref must survive untouched.
test('a verdict recorded while the exclusion waits for the mutex still refuses the return (issue #1999)',()=>{
  const head='f'.repeat(40),{io,first,assignmentRef,evidenceSha}=returnScenario(1999,2009,head)
  const create=io.createRef
  io.createRef=(ref,sha)=>{const made=create(ref,sha);if(ref===MUTEX_REF&&made)io.refs.set(`refs/db-review-verdicts/1999-2009-${head}`,'b'.repeat(40));return made}
  assert.throws(()=>excludeReviewerForPr({issue:1999,pr:2009,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io),/already recorded a durable verdict/)
  assert.equal(io.refs.get(assignmentRef),evidenceSha)
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_RETURN_REF_PREFIX)),false)
  assert.equal(io.refs.get(MUTEX_REF),undefined)
})

// Retiring a durable assignment ref is a compare-and-swap or it does not happen.
// The compare-then-delete fallback can tear -- return record created, assignment
// ref still naming the excluded reviewer -- and the documented re-run cannot
// repair that state. So the return refuses the io instead of falling back.
test('returning a slot refuses an io without atomic compare-and-swap refs (issue #1999)',()=>{
  const head='f'.repeat(40),io=reviewIo()
  io.getPr=()=>({number:2010,state:'open',head:{sha:head,ref:'codex/x'}})
  const first=assignNextReviewer({issue:1999,pr:2010,headSha:head},io)
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/1999-2010-${head}`
  assert.throws(()=>excludeReviewerForPr({issue:1999,pr:2010,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha:io.refs.get(assignmentRef)},io),/requires atomic compare-and-swap ref support/)
  assert.equal(io.refs.get(assignmentRef),io.refs.get(assignmentRef))
  assert.equal([...io.refs.keys()].some((ref)=>ref.startsWith(REVIEW_EXCLUSION_REF_PREFIX)),false)
})

test('a reviewer return record is parsed strictly and fails closed',()=>{
  const reviewer=ACTIVE_REVIEWERS[0].name,head='a'.repeat(40),assignmentSha='b'.repeat(40)
  const message=`db-coordination reviewer-return reviewer=${reviewer} issue=1999 pr=2002 head=${head} slot=1 assignment=${assignmentSha} reason=already-reviewed`
  // A record written before the cursor sequence was carried still parses, and
  // says so honestly with sequence null, rather than inventing an order.
  assert.deepEqual(parseReviewReturn({message}),{reviewer,issue:1999,pr:2002,headSha:head,slot:1,assignmentSha,sequence:null,replacementSequence:null,reason:'already-reviewed'})
  const sequenced=message.replace(' reason=',' sequence=9 reason=')
  assert.deepEqual(parseReviewReturn({message:sequenced}),{reviewer,issue:1999,pr:2002,headSha:head,slot:1,assignmentSha,sequence:9,replacementSequence:null,reason:'already-reviewed'})
  // The replacement form carries the sequence of the record it retires, because
  // a slot's history is ordered and the merge gate has to compare against it.
  const replacementMessage=message.replace(' reason=',' sequence=9 replacement=2 reason=')
  assert.deepEqual(parseReviewReturn({message:replacementMessage}),{reviewer,issue:1999,pr:2002,headSha:head,slot:1,assignmentSha,sequence:9,replacementSequence:2,reason:'already-reviewed'})
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' sequence=0 reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' sequence=x reason=')}),/malformed/)
  // Order matters: `replacement=` before `sequence=` is not the recorded form.
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' replacement=2 sequence=9 reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' replacement=0 reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' replacement=x reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(reviewer,'unknown-reviewer')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace('reason=already-reviewed','reason=because-i-said-so')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(`head=${head}`,'head=not-a-sha')}),/malformed/)
  assert.equal(reviewReturnRef({issue:1999,pr:2002,headSha:head,slot:2,assignmentSha}),`${REVIEW_RETURN_REF_PREFIX}/1999-2002-${head}-slot2-${assignmentSha}`)
})

test('a reviewer return whose ref name disagrees with its commit is refused',()=>{
  const io=reviewIo(),reviewer=ACTIVE_REVIEWERS[0].name,head='a'.repeat(40),assignmentSha='b'.repeat(40)
  const sha=io.makeOwnerCommit(`db-coordination reviewer-return reviewer=${reviewer} issue=1999 pr=2002 head=${head} slot=1 assignment=${assignmentSha} reason=already-reviewed`)
  io.refs.set(`${REVIEW_RETURN_REF_PREFIX}/1999-2002-${head}-slot2-${assignmentSha}`,sha)
  assert.throws(()=>readReviewReturns(1999,2002,head,io),/does not match its ref identity/)
})

// THE RE-RUN MUST REACH THE RETIREMENT (grok-4.6 third REVISE of PR #2077).
//
// The retirement is a SECOND atomic push, made after the one that records the
// exclusion and its returns. If that second push fails -- or the process dies
// between the two -- the exclusion is already durable and the returned
// assignment ref is already cleared, so a re-run found nothing held and stopped
// on the idempotent early return, before the retirement could run again. The
// raced verdict then held the per-tuple ref for that head with no repair short of
// a new push, which is the escape this whole feature exists to close. The re-run
// now rebuilds the returned rows from the durable return records themselves.
test('re-running the exclusion retires a verdict left orphaned by a failed retirement push',()=>{
  const head='5'.repeat(40),{io,first,assignmentRef,evidenceSha}=returnScenario(2077,2104,head)
  const tupleRef=`refs/db-review-verdicts/2077-2104-${head}`,verdictSha='c'.repeat(40)
  racedVerdictIo(io,tupleRef,verdictSha,{verdict:'APPROVE',head_sha:head,issue:2077,pr:2104,slot:1,reviewer:first.reviewer,assignment_sha:evidenceSha,findings_digest:'0'.repeat(64)})
  // The exclusion+return push lands; the retirement push is the one that fails.
  const atomic=io.atomicReviewRefs
  io.atomicReviewRefs=(changes)=>{
    if(changes.some((change)=>change.ref.startsWith(REVIEW_RETIRED_VERDICT_REF_PREFIX)))throw new LaneError('HTTP 503 during retirement push')
    return atomic(changes)
  }
  assert.throws(()=>excludeReviewerForPr({issue:2077,pr:2104,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io),/503/)
  // Durably half-done: the slot is returned, and the orphan still pins the tuple.
  assert.equal(io.refs.get(assignmentRef),undefined)
  assert.deepEqual(readReviewReturns(2077,2104,head,io).map((row)=>row.assignmentSha),[evidenceSha])
  assert.equal(io.refs.get(tupleRef),verdictSha)
  // The documented repair -- re-run the IDENTICAL exclusion -- now completes it.
  io.atomicReviewRefs=atomic
  const repaired=excludeReviewerForPr({issue:2077,pr:2104,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.equal(repaired.ref,`${REVIEW_EXCLUSION_REF_PREFIX}/2077-2104-${first.reviewer}`)
  assert.equal(io.refs.get(tupleRef),undefined)
  assert.equal(io.refs.get(retiredVerdictRef({issue:2077,pr:2104,headSha:head,slot:1,replacementSequence:null,verdictSha})),verdictSha)
  // Nothing new was recorded: no second exclusion, no second return.
  assert.equal(readReviewReturns(2077,2104,head,io).length,1)
  // And with nothing left orphaned, a third run is the plain no-op it always was.
  const again=excludeReviewerForPr({issue:2077,pr:2104,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io)
  assert.deepEqual(again.returned,[])
})

// FAIL CLOSED ON A REF THIS PARSER CANNOT NAME.
//
// The legacy first-implementation replacement link had no namespace tail, so the
// shared ref parser answers null for it. The exclusion scan used to drop such a
// row silently -- which excluded the reviewer while writing NO return for the
// record it still held, re-creating the stranded slot the return exists to
// repair. It now stops instead, and only for a record that really does name the
// reviewer being excluded: another reviewer's legacy link is not this command's
// problem and must not brick every exclusion on the pull request.
test('a malformed assignment ref still held by the excluded reviewer stops the exclusion',()=>{
  const head='6'.repeat(40),{io,first,evidenceSha}=returnScenario(2077,2105,head)
  const legacy=`${REVIEW_REPLACEMENT_REF_PREFIX}/2077-2105-${head}`
  io.refs.set(legacy,evidenceSha)
  assert.throws(()=>excludeReviewerForPr({issue:2077,pr:2105,reviewer:first.reviewer,reason:'independence-conflict',evidenceSha},io),/cannot be named by the shared ref parser/)
  assert.equal(io.refs.get(legacy),evidenceSha)
  assert.equal(io.readRef(`${REVIEW_EXCLUSION_REF_PREFIX}/2077-2105-${first.reviewer}`),null)
})

// ---------------------------------------------------------------------------
// listReviewRefsPaged against a namespace that GENUINELY exceeds one page
// (issue #2152).
//
// The broken pager shipped because every test for it used a fixture holding
// fewer than 100 refs, where `chunk.length<100` fires on the first request and
// a page-1-repeating endpoint is indistinguishable from a correct one. These
// tests use a fake transport that models the REAL endpoint measured on
// 2026-09-02: `git/matching-refs` ignores BOTH `per_page` and `page`, sends no
// Link header, and returns the complete matching set in one response.
// ---------------------------------------------------------------------------

// The fake endpoint. Deliberately ignores every pagination parameter, exactly
// as the real one does -- that is the whole point of the fixture.
const matchingRefsServer=(count,{link=null}={})=>{
  const calls=[]
  const rows=Array.from({length:count},(_,i)=>({ref:`refs/db-review-assignments/${i}-${i+1}-${String(i).padStart(40,'0')}`,object:{sha:String(i).padStart(40,'0')}}))
  return {calls,rows,serve(endpoint){calls.push(endpoint);return rows},headers:link?{link}:{}}
}

// The pager as it stood on main at bd00aaa7, copied verbatim except that its
// request goes to the fake server instead of `gh`. Kept here as the CONTROL: a
// test that only the new implementation can pass is worth nothing unless the
// old one demonstrably fails it.
const brokenPagerAtBd00aaa7=(prefix,server,pageLimit=6)=>{
  const short=prefix.replace(/^refs\//,'')
  const rows=[]
  for(let page=1;page<=pageLimit;page++){
    const chunk=server.serve(`repos/u2giants/shared-db/git/matching-refs/${short}?per_page=100&page=${page}`)
    if(!Array.isArray(chunk))throw new LaneError(`GitHub page ${page} for ${prefix} was incomplete or malformed`)
    rows.push(...chunk.map((row)=>({ref:row.ref,sha:row.object?.sha})).filter((row)=>row.sha))
    if(chunk.length<100)return rows
  }
  throw new LaneError(`${prefix} exceeded ${pageLimit} pages of 100 refs; refusing a possibly truncated reviewer audit`)
}

test('CONTROL: the pre-#2152 pager refuses on a 726-ref namespace served by a page-ignoring endpoint',()=>{
  const server=matchingRefsServer(726)
  assert.throws(()=>brokenPagerAtBd00aaa7(REVIEW_ASSIGNMENT_REF_PREFIX,server),/exceeded 6 pages of 100 refs/)
  assert.equal(server.calls.length,6,'it spent six counted requests to learn nothing')
})

// EVIDENCE FOR THE #2152 POST-MORTEM QUESTION -- did any decision ever run on a
// DUPLICATED ref list? Not from a namespace that held still. The old loop
// returns early only on `chunk.length<100`, and a page-1-repeating endpoint
// returns a short page only when the namespace itself holds under 100 refs --
// in which case one request already held the whole namespace and the list was
// correct and duplicate-free. At 100 refs or more every request is full, so the
// loop runs to the ceiling and THROWS. Against a STABLE namespace the two
// outcomes are "correct list" and "loud refusal", with nothing between them.
// The next test shows the one case that does fall between them.
test('CONTROL: the pre-#2152 pager has no path that returns a duplicated list from a STABLE namespace',()=>{
  for(const count of [0,1,99]){
    const server=matchingRefsServer(count)
    const rows=brokenPagerAtBd00aaa7(REVIEW_ASSIGNMENT_REF_PREFIX,server)
    assert.equal(server.calls.length,1,'a sub-100 namespace answered in one request, so nothing repeated')
    assert.equal(rows.length,count)
    assert.equal(new Set(rows.map((row)=>row.ref)).size,count)
  }
  for(const count of [100,120,726]){
    const server=matchingRefsServer(count)
    assert.throws(()=>brokenPagerAtBd00aaa7(REVIEW_ASSIGNMENT_REF_PREFIX,server),/refusing a possibly truncated reviewer audit/,`a ${count}-ref namespace must refuse, never return`)
  }
})

// The same page-ignoring endpoint, but the namespace SHRINKS between requests.
// That is what a concurrent ref retirement looks like from the pager's side,
// and refs/db-review-retired-verdicts means retirement is a routine operation
// here, not a thought experiment.
const shrinkingMatchingRefsServer=(counts)=>{
  const calls=[]
  const rowsFor=(count)=>Array.from({length:count},(_,i)=>({ref:`refs/db-review-assignments/${i}-${i+1}-${String(i).padStart(40,'0')}`,object:{sha:String(i).padStart(40,'0')}}))
  return {calls,serve(endpoint){const count=counts[Math.min(calls.length,counts.length-1)];calls.push(endpoint);return rowsFor(count)},headers:{}}
}

// This test previously claimed the duplicated list needed a RAISED ceiling, and
// proved it by CONSTRUCTING the duplicate rows inside its own catch block --
// an assertion that passed whatever the pager did. Replaced with the real path
// (#2155 review 2). No fabrication: every row here came out of the old loop.
test('CONTROL: the pre-#2152 pager DOES return a duplicated list when the namespace shrinks mid-walk',()=>{
  const server=shrinkingMatchingRefsServer([120,120,99])
  const rows=brokenPagerAtBd00aaa7(REVIEW_ASSIGNMENT_REF_PREFIX,server)
  assert.equal(server.calls.length,3,'the third request came back short, so the loop RETURNED instead of refusing')
  assert.equal(rows.length,339,'120 + 120 + 99 rows accumulated from three requests that were all page 1')
  assert.equal(new Set(rows.map((row)=>row.ref)).size,120,'only 120 distinct refs exist; the rest are repeats a caller would have counted twice')
})

test('CONTROL: raising the pre-#2152 page ceiling buys more requests and the SAME refusal',()=>{
  // Raising the ceiling was never the fix: against a stable 726-ref namespace
  // every ceiling spends its full budget of requests and then refuses anyway.
  for(const ceiling of [3,6,12]){
    const server=matchingRefsServer(726)
    assert.throws(()=>brokenPagerAtBd00aaa7(REVIEW_ASSIGNMENT_REF_PREFIX,server,ceiling),new RegExp(`exceeded ${ceiling} pages of 100 refs`))
    assert.equal(server.calls.length,ceiling,'and each of those requests was charged to the wire budget')
  }
})

// THE CONTROL THAT MUST GO RED IF THE FIX IS REVERTED (#2155 review 2). It
// drives the PRODUCTION listing against the endpoint as measured on 2026-09-02
// -- page-ignoring, no Link header, 726 refs in one response -- which is the
// exact shape that took the governed reviewer system down.
//
// The request count is asserted FIRST, and deliberately so. The pre-#2152 pager
// accepted no transport argument at all, so on a reverted tree the injected
// server is never called and THIS line is the failure: it names the defect (the
// listing did not read the namespace in a single injected request) instead of
// reporting whatever the reverted page walk did on the live wire.
test('CONTROL: the fixed listing reads a 726-ref namespace in ONE injected request and returns it whole',()=>{
  const server=matchingRefsServer(726)
  let rows=null,refusal=null
  try{rows=githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,(endpoint)=>({rows:server.serve(endpoint),headers:server.headers}))}
  catch(error){refusal=error}
  assert.equal(server.calls.length,1,'the production listing must read the whole namespace in exactly ONE request through the injected transport')
  assert.equal(refusal,null,`a 726-ref namespace must not refuse: ${refusal?.message??''}`)
  assert.equal(rows.length,726,'every ref came back')
  assert.equal(new Set(rows.map((row)=>row.ref)).size,726,'once each')
  assert.equal(/[?&]page=/.test(server.calls[0]),false,'and it did not ask for a page the endpoint ignores')
})

test('listReviewRefsPaged returns every ref of a 726-ref namespace, once each, in ONE request',()=>{
  const server=matchingRefsServer(726)
  const rows=githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,(endpoint)=>({rows:server.serve(endpoint),headers:server.headers}))
  assert.equal(rows.length,726)
  assert.equal(new Set(rows.map((row)=>row.ref)).size,726,'no duplicates')
  assert.equal(server.calls.length,1,'one counted wire request, whatever the namespace holds')
  assert.equal(/[?&]page=/.test(server.calls[0]),false,'the endpoint ignores page=N, so asking for one is a lie about what came back')
})

test('listReviewRefsPaged refuses LOUDLY when GitHub advertises a further page',()=>{
  const server=matchingRefsServer(100,{link:'<https://api.github.com/repositories/1/git/matching-refs/x?page=2>; rel="next", <https://api.github.com/repositories/1/git/matching-refs/x?page=9>; rel="last"'})
  assert.throws(()=>githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,(endpoint)=>({rows:server.serve(endpoint),headers:server.headers})),/paginated Link header.*refusing a possibly truncated reviewer audit/s)
})

test('listReviewRefsPaged accepts a Link header that offers only prev/last',()=>{
  const server=matchingRefsServer(3,{link:'<https://api.github.com/repositories/1/git/matching-refs/x?page=1>; rel="prev"'})
  assert.equal(githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,(endpoint)=>({rows:server.serve(endpoint),headers:server.headers})).length,3)
})

test('listReviewRefsPaged refuses at the row ceiling rather than trusting a possibly capped list',()=>{
  const server=matchingRefsServer(REVIEW_REF_ROW_LIMIT)
  assert.throws(()=>githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,(endpoint)=>({rows:server.serve(endpoint),headers:server.headers})),new RegExp(`returned ${REVIEW_REF_ROW_LIMIT} refs, at or past the ${REVIEW_REF_ROW_LIMIT}-ref ceiling`))
})

test('the row ceiling sits above every namespace this repository actually holds',()=>{
  // 726 assignment refs measured 2026-09-02; the ceiling must clear it or the
  // audit paths refuse on day one. See REVIEW_REF_ROW_LIMIT for the derivation.
  assert.ok(REVIEW_REF_ROW_LIMIT>726,`ceiling ${REVIEW_REF_ROW_LIMIT} must exceed the largest live namespace`)
})

test('listReviewRefsPaged refuses a malformed body instead of reading it as an empty namespace',()=>{
  assert.throws(()=>githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,()=>({rows:{message:'Not Found'},headers:{}})),/incomplete or malformed/)
})

test('parseGhIncludeResponse splits real gh -i output and lowercases header names',()=>{
  const body=JSON.stringify([{ref:'refs/db-review-assignments/1-2-abc',object:{sha:'abc'}}])
  const {rows,headers}=parseGhIncludeResponse(`HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nLink: <https://api.github.com/x?page=2>; rel="next"\r\n\r\n${body}`)
  assert.equal(rows.length,1)
  assert.equal(headers['content-type'],'application/json')
  assert.equal(hasNextPageLink(headers),true)
  assert.equal(hasNextPageLink({}),false)
  assert.equal(hasNextPageLink({link:'<https://api.github.com/x?page=1>; rel="last"'}),false)
})

test('parseGhIncludeResponse refuses output with no header/body boundary',()=>{
  assert.throws(()=>parseGhIncludeResponse('HTTP/2.0 200 OK'),/no header\/body boundary/)
})


// ---------------------------------------------------------------------------
// The Link-header truncation detector (issue #2152, glm-5.3 review of #2155).
//
// hasNextPageLink is the load-bearing guard for a function whose failure
// direction is fail-OPEN: a missed rel="next" is a silently truncated reviewer
// audit, which reads as "no verdict". Three ways the first implementation could
// have been fooled, none of them producible against GitHub today -- which is
// not a property this repository controls.
// ---------------------------------------------------------------------------

const rawGhResponse=(headerLines,body)=>[...headerLines,'',JSON.stringify(body)].join('\r\n')
const linkPagerFetch=(headers,rows=[])=>()=>({rows,headers})

test('a repeated Link header line is JOINED, so rel="next" on the FIRST line still refuses',()=>{
  // gh prints one line per header field. Building the map with
  // Object.fromEntries kept only the LAST Link line, so this rel="next" was
  // invisible and the listing returned as if it were the complete set.
  const {headers,rows}=parseGhIncludeResponse(rawGhResponse([
    'HTTP/2.0 200 OK',
    'Content-Type: application/json',
    'Link: <https://api.github.com/repositories/1/git/matching-refs/x?page=2>; rel="next"',
    'Link: <https://api.github.com/repositories/1/git/matching-refs/x?page=9>; rel="last"',
  ],[{ref:'refs/db-review-assignments/1-2-abc',object:{sha:'abc'}}]))
  assert.equal(rows.length,1)
  assert.match(headers.link,/rel="next".*rel="last"/,'both lines must survive, joined per RFC 9110')
  assert.equal(hasNextPageLink(headers),true)
  assert.throws(()=>githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,linkPagerFetch(headers)),/paginated Link header/)
})

test('an array of Link values is also searched in full, not just its last entry',()=>{
  assert.equal(hasNextPageLink({link:['<https://a/x?page=2>; rel="next"','<https://a/x?page=1>; rel="prev"']}),true)
})

test('rel=next inside a QUOTED parameter value is not a next page and must not refuse',()=>{
  // `title="rel=next"` is a value, not a parameter. The old regex matched the
  // text wherever it sat and refused a complete listing -- a false alarm on a
  // guard that must only fire on a real further page.
  const headers={link:'<https://a/x?page=1>; rel="prev"; title="rel=next"'}
  assert.equal(hasNextPageLink(headers),false)
  const rows=githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,linkPagerFetch(headers,[{ref:'refs/db-review-assignments/1-2-abc',object:{sha:'abc'}}]))
  assert.equal(rows.length,1)
})

test('rel is matched as a whitespace-separated token list, never as a substring',()=>{
  assert.equal(hasNextPageLink({link:'<https://a/x>; rel="nextish"'}),false)
  assert.equal(hasNextPageLink({link:'<https://a/x>; rel="noopener next"'}),true)
  assert.equal(hasNextPageLink({link:'<https://a/x>; rel=next'}),true)
})

test('an unparseable Link value REFUSES rather than reading as "no further pages"',()=>{
  // The last four are the holes the first version of this parser left OPEN
  // (#2155 review 2): a parameter with no `=` at all, an empty unquoted value,
  // and an unquoted value swallowing a stray quote. Each parsed cleanly into a
  // rel that was not `next`, so a malformed truncation marker answered "no
  // further pages" -- the fail-open direction this guard exists to close.
  for(const broken of ['garbage','<https://a/x; rel="next"','<https://a/x>; rel="next','<https://a/x>; = "next"','<https://a/x> rel="next"','<https://a/x>; rel','<https://a/x>; rel="prev"; next','<https://a/x>; rel=','<https://a/x>; rel=next"']){
    assert.throws(()=>hasNextPageLink({link:broken}),/unparseable Link header/,`must refuse: ${broken}`)
    assert.throws(()=>githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,linkPagerFetch({link:broken})),/unparseable Link header/)
  }
})

test('a link value carrying NO relation refuses rather than reading as "no further pages"',()=>{
  // The third hole of the same class (#2155 review 3). A link value with no
  // `rel` at all parsed cleanly with an empty relation, so hasNextPageLink
  // answered false when the truth was UNKNOWN. A header truncated at the
  // semicolon -- `<uri>; rel="next"` cut to `<uri>` -- lands exactly here, which
  // is the silent truncation this whole change exists to prevent. RFC 8288
  // requires a rel on every link value, so both shapes below are malformed.
  for(const broken of ['<https://a/x?page=2>','<https://a/x?page=2>; title="next"','<https://a/x?page=2>; rel="next", <https://a/x?page=9>']){
    assert.throws(()=>hasNextPageLink({link:broken}),/unparseable Link header \(a link value carries no rel relation\)/,`must refuse: ${broken}`)
    assert.throws(()=>githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,linkPagerFetch({link:broken})),/unparseable Link header/)
  }
  assert.throws(()=>parseLinkHeader('<https://a/x?page=2>'),/unparseable Link header/)
})

test('an absent or empty Link header is simply no further pages',()=>{
  assert.equal(hasNextPageLink({}),false)
  assert.equal(hasNextPageLink({link:''}),false)
  assert.equal(hasNextPageLink({link:'   '}),false)
  assert.equal(hasNextPageLink(undefined),false)
})

// ---------------------------------------------------------------------------
// THE STRICT REWRITE (#2152 review 4). Four review rounds found four fail-OPEN
// holes of the SAME family in a scanner that accepted whatever it had not
// specifically objected to. The parser now PROVES a header is well formed
// before returning anything, and refuses everything it cannot account for.
// These cases pin each known variant plus the two shapes that must still parse.
// ---------------------------------------------------------------------------
test('an UNTERMINATED <URI> cannot swallow the next link value',()=>{
  // The fourth hole. The closing `>` was searched for across the WHOLE
  // remaining header, so a first value missing its bracket ran past the comma
  // and ate the second value's `>`. The literal rel="next" ended up inside the
  // URI text and the surviving parameters gave a different relation, so a
  // TRUNCATED listing read as complete -- fail OPEN, again.
  const broken='<https://a/x?page=2; rel="next", <https://b/y>; rel="prev"'
  assert.throws(()=>hasNextPageLink({link:broken}),/unparseable Link header \(a second < inside <URI>, so an earlier <URI> was never closed\)/,`must refuse: ${broken}`)
  assert.throws(()=>parseLinkHeader('<https://a/x?page=2; rel="next"'),/unparseable Link header \(unterminated <URI>\)/,'a lone unterminated <URI> refuses too')
  assert.throws(()=>githubIo.listReviewRefsPaged(REVIEW_ASSIGNMENT_REF_PREFIX,linkPagerFetch({link:broken})),/unparseable Link header/)
})

test('a header ending in a TRAILING comma refuses rather than parsing as one good value',()=>{
  // The fifth hole, found by the external reviewer. A trailing comma leaves an
  // empty final link value: a header cut mid-transmission looks like a clean
  // single value, so a truncated listing answers "no further pages".
  for(const broken of ['<https://a/x?page=2>; rel="next",','<https://a/x?page=2>; rel="next", ',', <https://a/x?page=2>; rel="next"','<https://a/x?page=2>; rel="next",, <https://b/y>; rel="last"']){
    assert.throws(()=>hasNextPageLink({link:broken}),/unparseable Link header \(an empty link value \(a leading, doubled or trailing comma\)\)/,`must refuse: ${broken}`)
  }
})

test('a link value with NO rel, a parameter with no =, and an unquoted value holding a quote all refuse',()=>{
  assert.throws(()=>hasNextPageLink({link:'<https://a/x?page=2>'}),/a link value carries no rel relation/,'no rel')
  assert.throws(()=>hasNextPageLink({link:'<https://a/x?page=2>; rel'}),/link parameter "rel" has no value/,'parameter with no =')
  assert.throws(()=>hasNextPageLink({link:'<https://a/x?page=2>; rel=next"'}),/unparseable Link header/,'an unquoted value may not hold a quote')
  assert.throws(()=>hasNextPageLink({link:'<https://a/x?page=2> rel="next"'}),/leftover text in a link value/,'leftover text between > and the next parameter')
})

test('a , and a ; INSIDE the URI and inside a quoted parameter still read as a real next page',()=>{
  // The strict shape must not become strict in the wrong direction: commas and
  // semicolons are ordinary text inside <URI> and inside a quoted value, and a
  // real further page must still be SEEN, not refused.
  const header='<https://api.github.com/x?q=a,b;c&page=2>; rel="next"; title="page 2, of 3; final", <https://api.github.com/x?q=a,b;c&page=3>; rel="last"'
  assert.equal(hasNextPageLink({link:header}),true)
  const links=parseLinkHeader(header)
  assert.equal(links.length,2,'the commas inside the URI and inside the quoted title must not split the header')
  assert.equal(links[0].uri,'https://api.github.com/x?q=a,b;c&page=2')
  assert.equal(links[0].params.title,'page 2, of 3; final')
  assert.equal(links[1].params.rel,'last')
})


test('parseLinkHeader reads uri and parameters structurally',()=>{
  const links=parseLinkHeader('<https://a/x?page=2>; rel="next"; title="a, b; c", <https://a/x?page=9>; rel="last"')
  assert.equal(links.length,2)
  assert.equal(links[0].uri,'https://a/x?page=2')
  assert.equal(links[0].params.rel,'next')
  assert.equal(links[0].params.title,'a, b; c','a comma or semicolon inside quotes must not split the value')
  assert.equal(links[1].params.rel,'last')
})

// ---------------------------------------------------------------------------
// REINSTATING A FALSELY "TERMINAL" REVIEWER (issue #2224).
//
// Three of five reviewers carried `terminal-unavailable` exclusions for one PR
// while the other two were leased to PRs that could not merge until that PR
// did. The exclusion record creates but never clears, so there was no route
// back and the whole migration queue deadlocked -- even though one of the three
// providers demonstrably ran fine the same day. These tests pin the narrow way
// out and, more importantly, the three ways that stay shut.
// ---------------------------------------------------------------------------

function doctoredIo(output='PASS provider=codex sandbox=read-only reasoning=explicit command=codex\n'){
  const io=withAtomicRefs(reviewIo())
  io.reviewerDoctor=(wrapper)=>{io.doctoredWrapper=wrapper;return {...summarizeDoctorOutput(output),output}}
  return io
}

function excludeFor(io,{issue,pr,reason}){
  io.getPr=()=>({number:pr,state:'open',head:{sha:'a'.repeat(40),ref:'codex/x'}})
  const first=assignNextReviewer({issue,pr,headSha:'a'.repeat(40)},io)
  const evidenceSha=io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${'a'.repeat(40)}`)
  return {reviewer:first.reviewer,excluded:excludeReviewerForPr({issue,pr,reviewer:first.reviewer,reason,evidenceSha},io)}
}

test('a terminal-unavailable exclusion is reinstated on fresh doctor proof, and the original record survives',()=>{
  const io=doctoredIo(),issue=2224,pr=2199
  const {reviewer,excluded}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  const exclusionRef=`${REVIEW_EXCLUSION_REF_PREFIX}/${issue}-${pr}-${reviewer}`
  assert.equal(io.refs.get(exclusionRef),excluded.sha)
  // Before: the excluded reviewer cannot be drawn for this PR.
  io.getPr=()=>({state:'open',head:{sha:'b'.repeat(40),ref:'codex/x'}})
  assert.notEqual(assignNextReviewer({issue,pr,headSha:'b'.repeat(40)},io).reviewer,reviewer)

  const result=reinstateReviewerExclusion({issue,pr,reviewer},io)
  assert.equal(result.repeat,false)
  assert.equal(result.reason,'terminal-unavailable')
  assert.equal(io.doctoredWrapper,REVIEWERS.find((row)=>row.name===reviewer).wrapper)
  // APPEND-ONLY. The exclusion ref is byte-for-byte where it was; the
  // reinstatement is a separate ref that carries the proof verbatim.
  assert.equal(io.refs.get(exclusionRef),excluded.sha,'the original exclusion record must survive reinstatement')
  assert.equal(result.ref,`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-${pr}-${reviewer}`)
  const record=parseReviewReinstatement(io.getCommit(result.sha))
  assert.equal(record.exclusionSha,String(excluded.sha).toLowerCase())
  assert.match(record.proof,/^PASS provider=codex/)
  assert.equal(record.passedChecks,1)

  // After: the reviewer is drawable for this PR again, on a fresh head.
  const names=[]
  for(let n=0;n<ACTIVE_REVIEWERS.length;n+=1){
    const head=`${n}`.padEnd(40,'c');io.getPr=()=>({state:'open',head:{sha:head,ref:'codex/x'}})
    names.push(assignNextReviewer({issue,pr,headSha:head,slot:1},io).reviewer)
  }
  assert.ok(names.includes(reviewer),'a reinstated reviewer must become drawable again')
})

test('reinstatement is idempotent and a re-run records nothing new',()=>{
  const io=doctoredIo(),issue=2224,pr=2198
  const {reviewer}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  const one=reinstateReviewerExclusion({issue,pr,reviewer},io)
  const refCount=io.refs.size
  const two=reinstateReviewerExclusion({issue,pr,reviewer},io)
  assert.equal(two.sha,one.sha)
  assert.equal(two.repeat,true)
  assert.equal(io.refs.size,refCount,'a re-run must write no new ref')
})

test('reinstatement REFUSES every reason that is an independence guarantee',()=>{
  for(const reason of ['already-reviewed','independence-conflict']){
    const io=doctoredIo(),issue=2224,pr=reason==='already-reviewed'?2196:2197
    const {reviewer}=excludeFor(io,{issue,pr,reason})
    assert.throws(()=>reinstateReviewerExclusion({issue,pr,reviewer},io),new RegExp(`excluded .* with reason ${reason}`))
    assert.equal(io.refs.has(`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-${pr}-${reviewer}`),false,'a refused reinstatement must leave no record')
    assert.equal(io.doctoredWrapper,undefined,'an independence exclusion is refused before any provider is probed')
    // And the reviewer stays excluded.
    io.getPr=()=>({state:'open',head:{sha:'b'.repeat(40),ref:'codex/x'}})
    assert.notEqual(assignNextReviewer({issue,pr,headSha:'b'.repeat(40)},io).reviewer,reviewer)
  }
  assert.deepEqual([...REINSTATABLE_EXCLUSION_REASONS],['terminal-unavailable'],'widening this set lifts an independence guarantee; re-derive it, never extend it')
})

test('reinstatement REFUSES without fresh positive proof from the wrapper itself',()=>{
  const issue=2224
  // (a) No probe available at all is not a pass.
  const noProbe=withAtomicRefs(reviewIo()),a=excludeFor(noProbe,{issue,pr:2190,reason:'terminal-unavailable'})
  assert.throws(()=>reinstateReviewerExclusion({issue,pr:2190,reviewer:a.reviewer},noProbe),/has no reviewerDoctor/)
  assert.equal(noProbe.refs.has(`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-2190-${a.reviewer}`),false)
  // (b) The provider still cannot run: the exclusion stands.
  const failing=doctoredIo('FAIL provider=codex auth\n'),b=excludeFor(failing,{issue,pr:2191,reason:'terminal-unavailable'})
  assert.throws(()=>reinstateReviewerExclusion({issue,pr:2191,reviewer:b.reviewer},failing),/doctor reports "provider=codex auth"\. The terminal-unavailable exclusion stands\./)
  // (c) Output that cannot be READ is not proof. This is the exact shape of the
  //     misreading that produced the false terminal call in the first place.
  const noisy=doctoredIo('codex is thinking about it\n'),c=excludeFor(noisy,{issue,pr:2192,reason:'terminal-unavailable'})
  assert.throws(()=>reinstateReviewerExclusion({issue,pr:2192,reviewer:c.reviewer},noisy),/no readable PASS check/)
  // (d) Silence proves nothing.
  const silent=doctoredIo(''),d=excludeFor(silent,{issue,pr:2193,reason:'terminal-unavailable'})
  assert.throws(()=>reinstateReviewerExclusion({issue,pr:2193,reviewer:d.reviewer},silent),/doctor reports "doctor reported nothing at all/)
  for(const [io,pr,reviewer] of [[failing,2191,b.reviewer],[noisy,2192,c.reviewer],[silent,2193,d.reviewer]]){
    assert.equal(io.refs.has(`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-${pr}-${reviewer}`),false,'a refused reinstatement must leave no record')
    io.getPr=()=>({state:'open',head:{sha:'b'.repeat(40),ref:'codex/x'}})
    assert.notEqual(assignNextReviewer({issue,pr,headSha:'b'.repeat(40)},io).reviewer,reviewer)
  }
})

test('reinstatement refuses when there is no exclusion to lift',()=>{
  const io=doctoredIo()
  assert.throws(()=>reinstateReviewerExclusion({issue:2224,pr:2189,reviewer:ACTIVE_REVIEWERS[0].name},io),/has no durable exclusion/)
  assert.throws(()=>reinstateReviewerExclusion({issue:2224,pr:2189,reviewer:'not-a-reviewer'},io),/requires issue, PR, and a known reviewer/)
})

test('a reinstatement record whose evidence was edited stops matching its own digest',()=>{
  const io=doctoredIo(),issue=2224,pr=2188
  const {reviewer}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  const result=reinstateReviewerExclusion({issue,pr,reviewer},io)
  const good=io.getCommit(result.sha)
  assert.equal(parseReviewReinstatement(good).proofDigest,result.proofDigest)
  assert.throws(()=>parseReviewReinstatement({message:good.message.replace('PASS provider=codex','PASS provider=tampered')}),/proof does not match its recorded digest/)
  assert.throws(()=>parseReviewReinstatement({message:good.message.split('\n')[0]}),/proof does not match its recorded digest/)
  assert.throws(()=>parseReviewReinstatement({message:good.message.replace('reason=terminal-unavailable','reason=already-reviewed')}),/malformed/)
  assert.throws(()=>parseReviewReinstatement({message:good.message.replace(`reviewer=${reviewer}`,'reviewer=not-a-reviewer')}),/malformed/)
})

test('a reinstatement naming a different exclusion is corruption, not a lift',()=>{
  const io=doctoredIo(),issue=2224,pr=2187
  const {reviewer}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  const result=reinstateReviewerExclusion({issue,pr,reviewer},io)
  const forged=io.getCommit(result.sha).message.replace(/exclusion=[0-9a-f]{7,40}/,`exclusion=${'f'.repeat(40)}`)
  io.refs.set(result.ref,io.makeOwnerCommit(forged))
  io.getPr=()=>({state:'open',head:{sha:'b'.repeat(40),ref:'codex/x'}})
  assert.throws(()=>assignNextReviewer({issue,pr,headSha:'b'.repeat(40)},io),/stopped for audit/)
})


// ---------------------------------------------------------------------------
// A LIFT MUST NOT SPEND THE ONLY EXCLUSION SLOT (#2224 review 2, High).
//
// The exclusion ref is create-only. Before generations, a reinstatement left
// that single ref occupied forever, so a LATER `already-reviewed` exclusion --
// the record that enforces "a provider that already judged these bytes is
// never re-drawn" -- was refused as "already has a different durable
// exclusion", and draw-time selection reads only the live exclusion set. The
// independence rule was therefore unenforceable for any reinstated reviewer on
// that pull request. Generations fix that while keeping every record.
// ---------------------------------------------------------------------------

// Draw heads until `reviewer` is the one assigned, and answer with the head and
// the durable assignment SHA, which is the evidence a real exclusion carries.
function drawUntilAssigned(io,{issue,pr,reviewer,salt=''}){
  for(let n=0;n<ACTIVE_REVIEWERS.length*2;n+=1){
    // `salt` keeps heads distinct across repeated draws in one test; reusing a
    // head reuses the per-head return ref and the write is refused as a clash.
    const head=`${n}${salt}`.padEnd(40,'e')
    io.getPr=()=>({number:pr,state:'open',head:{sha:head,ref:'codex/x'}})
    const drawn=assignNextReviewer({issue,pr,headSha:head,slot:1},io)
    if(drawn.reviewer===reviewer)return {headSha:head,evidenceSha:io.refs.get(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${head}`)}
  }
  throw new Error(`${reviewer} was never drawn again`)
}

test('after a lift, a LATER already-reviewed exclusion is recorded and bars the reviewer again',()=>{
  const io=doctoredIo(),issue=2224,pr=2186
  const {reviewer,excluded}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  const lift=reinstateReviewerExclusion({issue,pr,reviewer},io)
  assert.equal(lift.repeat,false)
  const redrawn=drawUntilAssigned(io,{issue,pr,reviewer})

  // The independence exclusion the old code could not record at all.
  const later=excludeReviewerForPr({issue,pr,reviewer,reason:'already-reviewed',evidenceSha:redrawn.evidenceSha},io)
  assert.equal(later.ref,reviewExclusionRef({issue,pr,reviewer,generation:2}))
  assert.notEqual(later.sha,excluded.sha)
  // APPEND-ONLY: the first exclusion and its lift are byte-for-byte intact.
  assert.equal(io.refs.get(reviewExclusionRef({issue,pr,reviewer})),excluded.sha,'the original exclusion record must survive')
  assert.equal(io.refs.get(reviewReinstatementRef({issue,pr,reviewer})),lift.sha,'the reinstatement record must survive')
  assert.equal(parseReviewExclusion(io.getCommit(later.sha)).reason,'already-reviewed')

  // AND IT ACTUALLY KEEPS THEM OUT, at every LATER head of the same PR.
  const names=[]
  for(let n=0;n<ACTIVE_REVIEWERS.length;n+=1){
    const head=`${n}`.padEnd(40,'f')
    io.getPr=()=>({number:pr,state:'open',head:{sha:head,ref:'codex/x'}})
    try{names.push(assignNextReviewer({issue,pr,headSha:head,slot:1},io).reviewer)}
    catch(error){assert.match(String(error.message),/no reviewer is available|no independent reviewer/)}
  }
  assert.equal(names.includes(reviewer),false,'a reviewer re-excluded for independence must never be drawn again on this PR')
})

test('a second, unlifted generation is idempotent and is never lifted by the FIRST generation reinstatement',()=>{
  const io=doctoredIo(),issue=2224,pr=2185
  const {reviewer}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  reinstateReviewerExclusion({issue,pr,reviewer},io)
  const redrawn=drawUntilAssigned(io,{issue,pr,reviewer})
  const later=excludeReviewerForPr({issue,pr,reviewer,reason:'already-reviewed',evidenceSha:redrawn.evidenceSha},io)
  const refCount=io.refs.size
  const again=excludeReviewerForPr({issue,pr,reviewer,reason:'already-reviewed',evidenceSha:redrawn.evidenceSha},io)
  assert.equal(again.sha,later.sha,'an identical re-run must be the same record')
  assert.equal(io.refs.size,refCount,'an identical re-run must write no new ref')
  // The gen-2 exclusion is an independence guarantee and cannot be lifted.
  assert.throws(()=>reinstateReviewerExclusion({issue,pr,reviewer},io),/with reason already-reviewed/)
  assert.equal(io.refs.has(reviewReinstatementRef({issue,pr,reviewer,generation:2})),false)
})

test('when every generation has been LIFTED, the refusal says the reviewer is not excluded',()=>{
  // Exhausting the generation loop is only reachable when every generation was
  // lifted -- a live one returns first. The refusal used to say "every one of
  // them is live, so the reviewer is already excluded", which is the opposite of
  // the truth and sends the caller to fix an exclusion that bars nobody.
  const io=doctoredIo(),issue=2224,pr=2184
  const {reviewer}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  reinstateReviewerExclusion({issue,pr,reviewer},io)
  let evidenceSha=null
  for(let generation=2;generation<=REVIEW_EXCLUSION_GENERATION_LIMIT;generation+=1){
    evidenceSha=drawUntilAssigned(io,{issue,pr,reviewer,salt:`${generation}`}).evidenceSha
    const later=excludeReviewerForPr({issue,pr,reviewer,reason:'terminal-unavailable',evidenceSha},io)
    assert.equal(later.ref,reviewExclusionRef({issue,pr,reviewer,generation}))
    reinstateReviewerExclusion({issue,pr,reviewer},io)
  }
  const refCount=io.refs.size
  assert.throws(()=>excludeReviewerForPr({issue,pr,reviewer,reason:'terminal-unavailable',evidenceSha},io),(error)=>{
    const message=String(error.message)
    assert.match(message,/every one of them has been lifted/)
    assert.match(message,/NOT currently excluded/)
    assert.doesNotMatch(message,/every one of them is live/)
    assert.doesNotMatch(message,/nothing is being lost/)
    return true
  })
  assert.equal(io.refs.size,refCount,'a refused exclusion must write no ref')
})

test('the generation suffix can never collide with a reviewer name',()=>{
  for(const {name} of REVIEWERS)assert.doesNotMatch(name,/-gen\d+$/i,`reviewer ${name} would collide with the exclusion generation ref suffix`)
  assert.throws(()=>reviewExclusionRef({issue:1,pr:2,reviewer:'x-gen2'}),/collides with the exclusion generation ref suffix/)
  assert.throws(()=>reviewExclusionRef({issue:1,pr:2,reviewer:ACTIVE_REVIEWERS[0].name,generation:REVIEW_EXCLUSION_GENERATION_LIMIT+1}),/generation must be an integer/)
  assert.equal(reviewExclusionRef({issue:1,pr:2,reviewer:'grok-4.6'}),`${REVIEW_EXCLUSION_REF_PREFIX}/1-2-grok-4.6`,'generation 1 must keep the historical ref name exactly')
  assert.equal(reviewReinstatementRef({issue:1,pr:2,reviewer:'grok-4.6'}),`${REVIEW_REINSTATEMENT_REF_PREFIX}/1-2-grok-4.6`)
})

// ---------------------------------------------------------------------------
// THE READ-PATH INDEPENDENCE GUARD (#2224 review 2, Medium).
//
// `parseReviewReinstatement` only checks the record's OWN header reason, so a
// planted reinstatement sitting beside an `already-reviewed` exclusion parses
// cleanly. The reader proves the reason from the EXCLUSION commit instead, and
// stops the whole exclusion read rather than dropping an independence bar.
// ---------------------------------------------------------------------------
test('a planted reinstatement can never lift an independence exclusion on the READ path',()=>{
  for(const reason of ['already-reviewed','independence-conflict']){
    const io=doctoredIo(),issue=2224,pr=reason==='already-reviewed'?2184:2183
    // A genuine reinstatement record, minted on a different PR of the same io.
    const donorPr=pr-100
    const donor=excludeFor(io,{issue,pr:donorPr,reason:'terminal-unavailable'})
    const genuine=io.getCommit(reinstateReviewerExclusion({issue,pr:donorPr,reviewer:donor.reviewer},io).sha).message

    const {reviewer,excluded}=excludeFor(io,{issue,pr,reason})
    // Re-headed onto the independence exclusion. The digest still matches --
    // it covers the body only -- and the header reason is the reinstatable one,
    // so the record itself parses. Only the cross-check from the exclusion
    // commit can catch it.
    const forged=genuine.replace(`reviewer=${donor.reviewer}`,`reviewer=${reviewer}`).replace(`issue=${issue} pr=${donorPr}`,`issue=${issue} pr=${pr}`).replace(/exclusion=[0-9a-f]{7,40}/,`exclusion=${String(excluded.sha).toLowerCase()}`)
    assert.equal(parseReviewReinstatement({message:forged}).reason,'terminal-unavailable','the plant must parse, or this test proves nothing')
    io.refs.set(reviewReinstatementRef({issue,pr,reviewer}),io.makeOwnerCommit(forged))

    io.getPr=()=>({number:pr,state:'open',head:{sha:'b'.repeat(40),ref:'codex/x'}})
    assert.throws(()=>assignNextReviewer({issue,pr,headSha:'b'.repeat(40)},io),new RegExp(`reinstatement exists for a ${reason} exclusion`),'an independence exclusion must never be dropped from the live set')
  }
})

test('a reinstatement header may not claim more passing checks than its own proof holds',()=>{
  const io=doctoredIo('PASS provider=codex sandbox=read-only\nPASS provider=codex auth=ok\n'),issue=2224,pr=2182
  const {reviewer}=excludeFor(io,{issue,pr,reason:'terminal-unavailable'})
  const result=reinstateReviewerExclusion({issue,pr,reviewer},io)
  assert.equal(result.passedChecks,2)
  assert.equal(countDoctorPassLines('PASS a b\nnoise\nthing : OK\n'),2)
  // Same body, inflated count: the digest still matches, the claim does not.
  const message=io.getCommit(result.sha).message
  assert.throws(()=>parseReviewReinstatement({message:message.replace('checks=2','checks=9')}),/claims 9 passing checks but its recorded proof contains 2/)
})

test('the preview gate excludes the context the guarded merge sets for itself', () => {
  const required=['SQL migration guards','Migration author lease','Migration guarded merge authorization']
  const green=new Map([['SQL migration guards','SUCCESS'],['Migration author lease','SUCCESS']])
  // The self-set context is absent from the head's checks, exactly as it is
  // before any merge has run. It must not hold preview back.
  assert.deepEqual(pendingRequiredContexts(required,green),[])
  // Positive control: a genuinely failing required check must still be reported,
  // so the exclusion above is proven to be narrow rather than a blanket pass.
  const red=new Map([['SQL migration guards','FAILURE'],['Migration author lease','SUCCESS']])
  assert.deepEqual(pendingRequiredContexts(required,red),['SQL migration guards'])
})

test('#2460 expired recovery works for a claim legitimately expanded beyond its issue scope, and still enforces the subset guarantee',()=>{
  // A claim that --expand-active-claim-from-pr has already grown holds a STRICT SUPERSET of its
  // work issue's scope objects. That state is tool-produced and sanctioned, so recovery must not
  // refuse it on a count-equality test. The guarantee that matters — every object the work issue
  // names is covered by the claim — is the subset test, and it is unchanged.
  const f=recovery2177,alreadyExpanded='table coldlion.previously_expanded'
  const io=expiredPrRecoveryIo(f),superset=[...f.tables,alreadyExpanded]
  io.claim.body=claimBody({version:f.version,objects:superset,owner:f.owner,branch:f.branch,worktree:f.worktree,expiresAt:new Date('2026-08-14T19:00:00Z')})
  assert.equal(parseAuthorLease(io.claim.body,NOW).active,false,'fixture lease must already be expired')
  assert.deepEqual(parseQueueScope(io.workIssue.body).objects,f.tables,'work issue scope must be a strict subset of the claim')
  const result=recoverExpiredClaimFromPr(recoveryOptions(f),NOW,io),lease=parseAuthorLease(io.claim.body,NOW)
  assert.deepEqual(result.added,f.children,'recovery must add exactly the uncovered PR objects')
  assert.deepEqual(lease.objects,[...superset,...f.children].sort())
  assert.equal(lease.active,true,'recovery must restore a live lease')
  assert.equal(io.updateCalls,1)
  // Unchanged precondition: an object the work issue names but the claim does not cover is refused.
  const missing=expiredPrRecoveryIo(f)
  missing.workIssue.body=scope('ready','structural','shared-db-orchestrator',2,[...f.tables,'table coldlion.never_claimed'])
  assert.throws(()=>recoverExpiredClaimFromPr(recoveryOptions(f),NOW,missing),/do not exactly match the permanent claim objects/)
  assert.equal(missing.updateCalls,0)
})

// #2486. A verdict ref that WAS created can read back as absent for seconds.
// Asked once, that stale absence was indistinguishable from a failed create, so
// a genuine APPROVE was declared "permanently refused" and the runner then
// voided its findings comment -- destroying the artifact's digest for good.
// The retry must accept a late-but-correct answer and still refuse a real
// third-party winner on the FIRST read, with no wait.
function verdictIo({ readRef }) {
  const assignmentRef='refs/db-review-assignments/2355-2415-'+'a'.repeat(40)
  const commits=new Map([['c'.repeat(40),{message:'db-coordination reviewer-cursor sequence=7 reviewer=muse-spark-1.2-contributor issue=2355 pr=2415 head='+'a'.repeat(40)+' slot=1'}]])
  const state={waits:0}
  return {
    assignmentRef, commits, state,
    readRef, getCommit:(sha)=>commits.get(sha),
    getPr:()=>({state:'open',head:{sha:'a'.repeat(40)}}),
    readFindings:()=>'findings body',
    makeReviewVerdictCommit:(message,parent)=>{commits.set('b'.repeat(40),{message,parents:[{sha:parent}]});return 'b'.repeat(40)},
    createRef:()=>true,
    wait:()=>{state.waits++},
  }
}
const VERDICT_OPTS={issue:2355,pr:2415,slot:1,headSha:'a'.repeat(40),verdict:'APPROVE',findingsRef:'https://github.com/u2giants/shared-db/pull/2415#issuecomment-1'}

test('a created verdict ref that reads back absent is retried, not burned', () => {
  let verdictReads=0
  const io=verdictIo({readRef(ref){
    if(ref.startsWith('refs/db-review-assignments/'))return 'c'.repeat(40)
    if(ref.startsWith('refs/db-review-active/'))return 'c'.repeat(40)
    return ++verdictReads<=3 ? null : 'b'.repeat(40)
  }})
  const result=recordReviewVerdict(VERDICT_OPTS,io)
  assert.equal(result.verdict,'APPROVE')
  assert.ok(io.state.waits>0)
})

test('#2694 a verdict accepts its own parallel exact-head lease even when no legacy provider lease exists', () => {
  let verdictReads=0
  const io=verdictIo({readRef(ref){
    if(ref.startsWith('refs/db-review-assignments/'))return 'c'.repeat(40)
    if(ref.startsWith('refs/db-review-active-v2/'))return 'c'.repeat(40)
    if(ref.startsWith('refs/db-review-active/'))return null
    return ++verdictReads<=3 ? null : 'b'.repeat(40)
  }})
  io.requiresExactReviewHeadSha=true
  const result=recordReviewVerdict(VERDICT_OPTS,io)
  assert.equal(result.verdict,'APPROVE')
})

test('a standing verdict with a genuinely different record still refuses, and is marked created', () => {
  const io=verdictIo({readRef(ref){
    if(ref.startsWith('refs/db-review-assignments/'))return 'c'.repeat(40)
    if(ref.startsWith('refs/db-review-active/'))return 'c'.repeat(40)
    return null
  }})
  const inner=io.readRef
  let seen=0
  io.readRef=(ref)=>ref.startsWith('refs/db-review-verdicts/')?(++seen===1?null:'d'.repeat(40)):inner(ref)
  io.commits.set('d'.repeat(40),{message:'not a verdict record at all',parents:[{sha:'c'.repeat(40)}]})
  let error=null
  assert.throws(()=>{try{recordReviewVerdict(VERDICT_OPTS,io)}catch(caught){error=caught;throw caught}},/must not be voided/)
  assert.deepEqual(error.verdictArtifactCreated,{ref:'refs/db-review-verdicts/2355-2415-'+'a'.repeat(40),sha:'b'.repeat(40),confirmed:true})
})

// #2311. Both refusals below used to name a menu of possible causes and leave the
// operator to guess. In the field that cost real time twice: a closed work issue
// with an open PR was reported as a head change that had not happened, and a
// verdict recorded against an orchestrator-marker number was reported as a lease
// the reviewer did in fact hold. Each test asserts the specific cause AND that the
// misleading alternative is not what the message blames.
test('#2311 a closed work issue with an open PR says so, and does not blame the head',()=>{
  const io=mergedPrIo(),openPr={state:'open',merged:false,merge_commit_sha:'',head:{sha:MERGED_HEAD}}
  io.getPr=()=>openPr
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'closed'},pr:openPr,evidence:[]}]))
  let error=null
  assert.throws(()=>{try{assignNextReviewer(mergedRequest,io)}catch(caught){error=caught;throw caught}},/changed after mutex acquisition/)
  assert.match(error.message,/work issue #1769 is closed while PR #1809 is still open/)
  assert.match(error.message,/Reopen issue #1769, or merge the pull request first/)
  assert.match(error.message,/orchestrator marker rather than the work issue/)
  assert.doesNotMatch(error.message,/head is now/,'the head did not move, so the refusal must not say it did')
})

test('#2311 a head that really did move is named with both SHAs, not the issue state',()=>{
  const io=mergedPrIo(),moved={state:'open',merged:false,merge_commit_sha:'',head:{sha:'c'.repeat(40)}}
  io.getPr=()=>moved
  io.readReviewStates=(leases)=>new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,{issue:{state:'open'},pr:moved,evidence:[]}]))
  let error=null
  assert.throws(()=>{try{assignNextReviewer(mergedRequest,io)}catch(caught){error=caught;throw caught}},/changed after mutex acquisition/)
  assert.match(error.message,new RegExp(`PR #1809 head is now ${'c'.repeat(40)}, not the requested ${MERGED_HEAD}`))
  assert.doesNotMatch(error.message,/work issue #1769 is/,'the issue is open, so the refusal must not blame it')
})

test('#2311 a verdict refused on the active lease names the assignment the lease actually holds',()=>{
  const other='e'.repeat(40)
  const io=verdictIo({readRef(ref){
    if(ref.startsWith('refs/db-review-assignments/'))return 'c'.repeat(40)
    if(ref.startsWith('refs/db-review-active/'))return other
    return null
  }})
  io.commits.set(other,{message:'db-coordination reviewer-cursor sequence=8 reviewer=muse-spark-1.2-contributor issue=2320 pr=2415 head='+'a'.repeat(40)+' slot=1'})
  let error=null
  assert.throws(()=>{try{recordReviewVerdict(VERDICT_OPTS,io)}catch(caught){error=caught;throw caught}},/exact active lease/)
  assert.match(error.message,/active lease \(refs\/db-review-active\/muse-spark-1\.2-contributor\) holds the assignment for issue #2320, PR #2415/)
  assert.match(error.message,/this verdict is for issue #2355, PR #2415/)
  assert.match(error.message,/an orchestrator marker is not the work issue/)
})

test('#2311 a reviewer with no active lease at all is told that, not told it holds a different one',()=>{
  const io=verdictIo({readRef(ref){
    if(ref.startsWith('refs/db-review-assignments/'))return 'c'.repeat(40)
    return null
  }})
  let error=null
  assert.throws(()=>{try{recordReviewVerdict(VERDICT_OPTS,io)}catch(caught){error=caught;throw caught}},/exact active lease/)
  assert.match(error.message,/holds no active lease at all/)
  assert.doesNotMatch(error.message,/the assignment for issue/,'there is no other assignment to name')
})

// #2694 REVIEW (REVISE at 2e4cc55a) -- THE PROOF SET FOR FINDINGS 1-4.
//
// Every test below drives a PRODUCTION-SHAPED io: `requiresExactReviewHeadSha`
// is true, so the lane code names leases exactly as `githubIo` makes it. Each
// one is red against the reviewed head:
//   1  legacy exclusion -- the return scan read the v2 name and called the live
//      one-provider lease "not outstanding", then deleted it anyway.
//   3  v2 exclusion -- the delete named only the one-provider ref, so the v2
//      lease outlived the assignment it held.
//   2  legacy release -- the compare-and-swap named an empty v2 ref and threw.
//   4  two live jobs -- the reviewer-keyed compatibility view collapsed them,
//      so the repaired job's lease was never released.
function productionReviewIo(){
  const io=withAtomicRefs(reviewIo()),heads=new Map()
  io.requiresExactReviewHeadSha=true
  io.heads=heads
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:heads.get(Number(number))??'abcdef9',ref:'codex/x'}})
  // Production lists the whole active-lease namespace in one complete-or-refused
  // read; without it `findBusyReviewers` only enumerates the one-provider names
  // and cannot see a second concurrent job at all.
  io.readActiveReviewLeases=()=>new Map([...io.refs.entries()].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)).map(([ref,sha])=>[ref,{sha,commit:io.getCommit(sha)}]))
  return io
}
// An assignment drawn before the cutover: its lease sits under the ONE-PROVIDER
// ref, which is where every in-flight review's lease was when this head shipped.
function demoteLeaseToLegacy(io,assignment){
  const v2=reviewActiveRef(assignment.reviewer,assignment),sha=io.refs.get(v2)
  assert.ok(sha,'the fixture must start from a real exact-head lease')
  io.refs.delete(v2)
  io.refs.set(reviewActiveRef(assignment.reviewer),sha)
  return {legacyRef:reviewActiveRef(assignment.reviewer),leaseSha:sha}
}
// A SECOND, independent live job for the same provider, as its own v2 lease.
function plantConcurrentLease(io,{reviewer,issue,pr,headSha,sequence}){
  io.heads.set(pr,headSha)
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer} issue=${issue} pr=${pr} head=${headSha}`)
  const ref=reviewActiveRef(reviewer,{issue,pr,headSha})
  io.refs.set(ref,sha)
  return {ref,sha}
}

test('#2694 excluding the holder of a pre-cutover one-provider lease returns the slot instead of stranding it',()=>{
  const io=productionReviewIo(),issue=2694,pr=3801,head='1'.repeat(40)
  io.heads.set(pr,head)
  const first=assignNextReviewer({issue,pr,headSha:head},io)
  const {legacyRef,leaseSha}=demoteLeaseToLegacy(io,first)
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${head}`
  const evidenceSha=io.refs.get(assignmentRef)
  assert.equal(evidenceSha,leaseSha,'the lease and the assignment are the same commit')
  const excluded=excludeReviewerForPr({issue,pr,reviewer:first.reviewer,reason:'terminal-unavailable',evidenceSha},io)
  // PRE-FIX: `returned` came back empty -- the scan looked at the v2 name, saw
  // nothing, and skipped the live assignment -- while the one-provider lease was
  // deleted regardless, leaving a slot that could never be returned or refilled.
  assert.equal(excluded.returned.length,1,'the live legacy assignment must be returned')
  assert.equal(excluded.returned[0].assignmentRef,assignmentRef)
  assert.equal(io.refs.get(assignmentRef),undefined,'the assignment ref is cleared')
  assert.equal(io.refs.get(legacyRef),undefined,'the one-provider lease it held is released with it')
  const next=assignNextReviewer({issue,pr,headSha:head},io)
  assert.notEqual(next.reviewer,first.reviewer,'the returned slot is refillable')
})

test('#2694 excluding one of two concurrent exact-head jobs frees that job lease and leaves the other alone',()=>{
  const io=productionReviewIo(),issue=2694,pr=3802,head='2'.repeat(40)
  io.heads.set(pr,head)
  const first=assignNextReviewer({issue,pr,headSha:head},io)
  const leaseRef=reviewActiveRef(first.reviewer,first)
  const other=plantConcurrentLease(io,{reviewer:first.reviewer,issue:2695,pr:3803,headSha:'3'.repeat(40),sequence:9001})
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${head}`
  const evidenceSha=io.refs.get(assignmentRef)
  const excluded=excludeReviewerForPr({issue,pr,reviewer:first.reviewer,reason:'terminal-unavailable',evidenceSha},io)
  assert.equal(excluded.returned.length,1)
  assert.equal(io.refs.get(assignmentRef),undefined)
  // PRE-FIX: the delete named only `refs/db-review-active/<reviewer>`, so this
  // lease survived its own returned assignment -- a ghost that left the slot
  // both taken and impossible to redraw.
  assert.equal(io.refs.get(leaseRef),undefined,'the returned assignment lease is deleted')
  assert.equal(io.refs.get(other.ref),other.sha,'the reviewer independent concurrent job is untouched')
})

test('#2694 a terminal failure on a pre-cutover one-provider lease can still be released',()=>{
  const io=productionReviewIo(),issue=2696,pr=3804,head='4'.repeat(40)
  io.heads.set(pr,head)
  const first=assignNextReviewer({issue,pr,headSha:head},io)
  const {legacyRef}=demoteLeaseToLegacy(io,first)
  // PRE-FIX: the compare-and-swap named the v2 ref, which is empty here, so the
  // post-mutex ownership check threw and the provider could never be freed.
  const released=releaseFailedReviewer({issue,pr,headSha:head,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true},io)
  assert.equal(released.reviewer,first.reviewer)
  assert.equal(io.refs.get(legacyRef),undefined,'the lease that actually held the assignment is released')
  assert.equal(io.refs.has(MUTEX_REF),false)
})

test('#2694 a replacement retry repairs the failed job even when its reviewer holds a second live job',()=>{
  const io=productionReviewIo(),issue=2697,pr=3805,head='5'.repeat(40)
  io.heads.set(pr,head)
  const first=assignNextReviewer({issue,pr,headSha:head},io)
  const failedLeaseRef=reviewActiveRef(first.reviewer,first),failedLeaseSha=io.refs.get(failedLeaseRef)
  const request={issue,pr,headSha:head,failedSequence:first.sequence,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}
  const replacement=replaceFailedReviewer(request,io)
  assert.notEqual(replacement.reviewer,first.reviewer)
  // A torn first attempt: the failed job lease is still there, and the SAME
  // failed provider now also holds a second independent live job recorded after
  // it, so the reviewer-keyed compatibility view answers with the second only.
  io.refs.set(failedLeaseRef,failedLeaseSha)
  const other=plantConcurrentLease(io,{reviewer:first.reviewer,issue:2698,pr:3806,headSha:'6'.repeat(40),sequence:9002})
  // PRE-FIX: `[...preflightBusy.leases.values()].find(...)` could not see the
  // failed job, so the retry restored the replacement lease while leaving the
  // failed reviewer a live claim on the same slot.
  assert.deepEqual(replaceFailedReviewer(request,io),replacement)
  assert.equal(io.refs.get(failedLeaseRef),undefined,'the failed job lease is released by the retry')
  assert.equal(io.refs.get(other.ref),other.sha,'the reviewer independent concurrent job is untouched')
})

// #2694 REVIEW ROUND 2 (REVISE at 2e4cc55a) -- THE PROOF SET FOR FINDINGS 2,5,6,7,8,9,10.

// CRITICAL 2. Nothing released a reviewer lease after a verdict. Pre-cutover the
// reviewer-keyed ref was implicitly reclaimed by that reviewer's NEXT draw; a
// tuple-keyed v2 ref is never wanted again, so it leaks forever and the
// namespace grows without bound until the listing ceiling refuses everything.
function verdictLeaseIo(){
  const refs=new Map()
  const head='a'.repeat(40)
  const leaseRef=`refs/db-review-active-v2/muse-spark-1.2-contributor/2355-2415-${head}`
  refs.set(`refs/db-review-assignments/2355-2415-${head}`,'c'.repeat(40))
  refs.set(leaseRef,'c'.repeat(40))
  const io=verdictIo({readRef:(ref)=>refs.get(ref)??null})
  io.requiresExactReviewHeadSha=true
  io.refs=refs
  io.leaseRef=leaseRef
  io.createRef=(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true}
  io.deleteRef=(ref)=>{refs.delete(ref)}
  io.readReviewRefs=(names)=>new Map(names.map((ref)=>[ref,refs.get(ref)??null]))
  io.atomicReviewRefs=(changes)=>{
    for(const change of changes)if((refs.get(change.ref)??null)!==(change.expected??null))throw new LaneError(`atomic reviewer ref transition failed: ${change.ref}`)
    for(const change of changes){if(change.sha)refs.set(change.ref,change.sha);else refs.delete(change.ref)}
  }
  return io
}

test('#2694 a recorded verdict releases its own assignment-keyed lease',()=>{
  const io=verdictLeaseIo()
  const result=recordReviewVerdict(VERDICT_OPTS,io)
  assert.equal(result.verdict,'APPROVE')
  assert.equal(result.lease_ref,io.leaseRef)
  assert.equal(result.lease_released,true,'the verdict must reclaim the tuple-keyed lease nothing else will ever want again')
  assert.equal(io.refs.has(io.leaseRef),false,'the v2 lease ref must be gone once the verdict is durable')
})

test('#2694 a verdict never fails because its lease could not be released',()=>{
  const io=verdictLeaseIo()
  io.atomicReviewRefs=()=>{throw new LaneError('transport down')}
  io.deleteRef=()=>{throw new LaneError('transport down')}
  const result=recordReviewVerdict(VERDICT_OPTS,io)
  assert.equal(result.verdict,'APPROVE','a release failure must never void a durable verdict artifact')
  assert.equal(result.lease_released,false)
})

// HIGH 5. The listing ceiling is a REFUSAL, not a truncation, and
// `findBusyReviewers` swallowed it into a fail-open `null` that every caller
// then reported as "active reviewer leases are unreadable" -- naming the wrong
// cause for a total outage of every draw, release and capacity report.
function leaseListingIo(thrown){
  return {readActiveReviewLeases:()=>{throw thrown},listRefs:()=>[],readRef:(ref)=>ref===REVIEW_ACTIVE_CUTOVER_REF?'cutover-complete':null,getCommit:()=>null}
}

test('#2694 a determinate lease-listing refusal names its real cause instead of "unreadable"',()=>{
  const refusal=markReviewRefListingRefusal(new LaneError(`refs/db-review-active-v2/ returned 1000 refs, at or past the ${REVIEW_REF_ROW_LIMIT}-ref ceiling; refusing a possibly truncated reviewer audit. Retire refs rather than raising the ceiling (#2152)`),{reason:'ceiling'})
  assert.equal(isReviewRefListingRefusal(refusal),true)
  let error=null
  assert.throws(()=>{try{findBusyReviewers(leaseListingIo(refusal))}catch(caught){error=caught;throw caught}},LaneError)
  assert.match(error.message,/at or past the 1000-ref ceiling/)
  assert.match(error.message,/Retire refs rather than raising the ceiling/)
  assert.doesNotMatch(error.message,/unreadable/,'a ceiling refusal is determinate, not an unreadable namespace')
})

test('#2694 a transient lease-listing failure still fails open rather than stopping the lane',()=>{
  const transient=new LaneError('HTTP 502: bad gateway')
  assert.equal(isReviewRefListingRefusal(transient),false)
  assert.equal(findBusyReviewers(leaseListingIo(transient)),null)
})

// MEDIUM-HIGH 6. The capacity report read the lossy reviewer-keyed Map, so two
// live jobs held by one provider collapsed into a single row and the second job
// was invisible to the operator deciding whether the pool had room.
test('#2694 the capacity report shows one row per live lease, not one per reviewer',()=>{
  const io=withAtomicRefs(reviewIo()),heads=new Map()
  io.requiresExactReviewHeadSha=true
  io.getPr=(pr)=>({number:Number(pr),state:'open',head:{sha:heads.get(Number(pr)),ref:'codex/x'}})
  const assigned=[]
  for(let n=0;n<=ACTIVE_REVIEWERS.length;n++){
    const request={issue:2694+n,pr:3894+n,headSha:n.toString(16).padStart(40,'a')}
    heads.set(request.pr,request.headSha)
    assigned.push(assignNextReviewer(request,io))
  }
  const doubled=assigned[0].reviewer
  assert.equal(assigned.at(-1).reviewer,doubled,'round-robin must hand the same provider a second concurrent job')
  io.readActiveReviewLeases=()=>new Map([...io.refs].filter(([ref])=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)||ref.startsWith('refs/db-review-active-v2')).map(([ref,sha])=>[ref,{sha,commit:{...io.getCommit(sha),committedDate:'2026-09-02T11:00:00Z'}}]))
  const rows=reviewerCapacityReport(io).reviewers.filter((row)=>row.reviewer===doubled&&row.held)
  assert.equal(rows.length,2,'both live jobs for one provider must be reported')
  assert.deepEqual(rows.map((row)=>row.leaseRef).sort(),[reviewActiveRef(doubled,assigned[0]),reviewActiveRef(doubled,assigned.at(-1))].sort())
})

// MEDIUM 7. The exclusion scan charged one uncached `readRef` per candidate
// lease ref against the 25-request wire budget; `readReviewRefs` costs one for
// the whole set and the proxy already offers it.
test('#2694 the exclusion scan batches its lease reads instead of paying per ref',()=>{
  const head='f'.repeat(40),{io,first,evidenceSha}=returnScenario(1999,2011,head)
  let perRefReads=0
  const inner=io.readRef
  io.readRef=(ref)=>{if(ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)||ref.startsWith('refs/db-review-active-v2'))perRefReads++;return inner(ref)}
  excludeReviewerForPr({issue:1999,pr:2011,reviewer:first.reviewer,reason:'already-reviewed',evidenceSha},io)
  assert.equal(perRefReads,0,'every candidate lease ref must be read through the single batched request')
})

// MEDIUM 8. The refusal was built from the LEGACY ref's contents while the v2
// ref held the conflicting lease, so it reported "holds no active lease at all"
// about a reviewer that demonstrably held one -- defeating #2311's guarantee
// that a refusal names the assignment the lease actually holds.
test('#2694 a verdict refused on a parallel lease names that lease, not the empty legacy ref',()=>{
  const other='e'.repeat(40)
  const io=verdictIo({readRef(ref){
    if(ref.startsWith('refs/db-review-assignments/'))return 'c'.repeat(40)
    if(ref.startsWith('refs/db-review-active-v2/'))return other
    return null
  }})
  io.requiresExactReviewHeadSha=true
  io.commits.set(other,{message:'db-coordination reviewer-cursor sequence=8 reviewer=muse-spark-1.2-contributor issue=2320 pr=2415 head='+'a'.repeat(40)+' slot=1'})
  let error=null
  assert.throws(()=>{try{recordReviewVerdict(VERDICT_OPTS,io)}catch(caught){error=caught;throw caught}},/exact active lease/)
  assert.match(error.message,/refs\/db-review-active-v2\/muse-spark-1\.2-contributor\//)
  assert.match(error.message,/holds the assignment for issue #2320, PR #2415/)
  assert.doesNotMatch(error.message,/holds no active lease at all/,'the parallel lease is held, so the refusal must not claim there is none')
})

// MEDIUM 9. The exhaustion message named "is already assigned to this exact
// head" as a cause, which `notTaken` does not implement at all. The message now
// states, per provider, the reason that provider was actually refused.
test('#2694 the exhaustion refusal states the reason each provider was refused',()=>{
  const {io}=busyIo()
  let error=null
  assert.throws(()=>{try{assignNextReviewer({issue:9,pr:119,headSha:'abcdef9'},io)}catch(caught){error=caught;throw caught}},/no reviewer is available/)
  for(const row of ACTIVE_REVIEWERS)assert.ok(error.message.includes(row.name),`the refusal must account for ${row.name}`)
  assert.match(error.message,/already holds a live review lease \(serial-lease protocol\)/)
  assert.doesNotMatch(error.message,/is already assigned to this exact head/,'no code path implements that cause')
})

// LOW 10. Cutover activation backfilled reviewer-keyed refs, so a provider that
// legitimately held two live pre-cutover reviews was refused as a corruption.
test('#2694 cutover activation backfills assignment-keyed leases for a provider holding two live reviews',()=>{
  const io=withAtomicRefs(freshCutoverIo()),headA='a'.repeat(40),headB='b'.repeat(40)
  io.requiresExactReviewHeadSha=true
  io.openPulls=()=>[{number:510,head:{sha:headA}},{number:511,head:{sha:headB}}]
  seedAssignment(io,{issue:51,pr:510,headSha:headA,reviewer:'glm-5.3'})
  seedAssignment(io,{issue:52,pr:511,headSha:headB,reviewer:'glm-5.3',sequence:2})
  const result=activateReviewCutover(io)
  assert.equal(result.activated,true)
  assert.equal(result.backfilled.length,2)
  assert.deepEqual(result.backfilled.map((row)=>row.ref).sort(),[
    reviewActiveRef('glm-5.3',{issue:51,pr:510,headSha:headA,slot:1}),
    reviewActiveRef('glm-5.3',{issue:52,pr:511,headSha:headB,slot:1}),
  ].sort())
  for(const row of result.backfilled)assert.ok(io.refs.has(row.ref))
})

test('#2694 releasing a slot 2 failure is refused when the lease at that ref names slot 1',()=>{
  // The inline lease-match check in `releaseFailedReviewer` compared issue, PR,
  // head, sequence and reviewer but NOT the slot. It only ever agreed with
  // `leaseMatchesAssignment` because one global sequence cursor keeps sequences
  // unique across slots. Here the slot-2 assignment's lease ref holds a lease
  // that names slot 1, and every other field matches: PRE-FIX the release
  // proceeded and deleted a lease belonging to another slot.
  const io=withAtomicRefs(reviewIo()),request={issue:2694,pr:2694,headSha:'c7'.repeat(20)}
  io.getPr=()=>({number:request.pr,state:'open',head:{sha:request.headSha,ref:'codex/x'}})
  assignNextReviewer(request,io)
  const second=assignNextReviewer({...request,slot:2},io)
  const leaseRef=[...io.refs.keys()].find((ref)=>ref.startsWith(REVIEW_ACTIVE_REF_PREFIX)&&String(io.getCommit(io.refs.get(ref))?.message??'').includes(`sequence=${second.sequence} `))
  assert.ok(leaseRef,'the fixture must start from a real slot 2 lease')
  const original=String(io.getCommit(io.refs.get(leaseRef)).message)
  assert.ok(/ slot=2(|$)/.test(original),'the slot 2 lease must carry its slot')
  // Same tuple, slot 1 instead of slot 2 (a cursor-form lease with no slot token
  // IS slot 1).
  io.refs.set(leaseRef,io.makeOwnerCommit(original.replace(/ slot=2(?=s|$)/,'')))
  assert.throws(()=>releaseFailedReviewer({issue:request.issue,pr:request.pr,headSha:request.headSha,failedSequence:second.sequence,slot:2,failureCode:'provider_unavailable',confirmNoVerdict:true,confirmNoArtifact:true},io),/active lease does not match the terminal failure evidence/)
})

test('#2705 replacement allocation also skips providers that reconciled preflight refuses',()=>{
  const io=failedReviewIo(), allowed='qwen'
  io.reviewerUsability=(reviewers)=>new Map(reviewers.map((row)=>[row.provider,{provider:row.provider,status:row.provider===allowed?'ready':'quarantined',usable:row.provider===allowed}]))
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(replacement.reviewer,'qwen-3.8-max')
})

// ISSUE #2697. `--reclaim-silent-reviewer` was added after
// REVIEW_OPERATION_REQUEST_LIMIT was derived and was never measured against it, so
// every reclaim refused at request 24 and a dead lease could never be released. This
// fixture is the derivation: it counts the path's real wire attempts the same way the
// assignment and replacement fixtures count theirs, and it runs under the operation's
// OWN budget with no override, so it goes red the moment the reclaim is charged against
// a ceiling that was not derived for it.
function instrumentedSilentReclaimIo(mode="legacy"){
  const fixture=silentLeaseIo(),{io,request,assigned}=fixture,options={...request,failedSequence:assigned.sequence,confirmNoVerdict:true,confirmNoArtifact:true}
  let leaseRef=fixture.leaseRef
  if(mode!=="serial")io.requiresExactReviewHeadSha=true
  if(mode==="parallel"){leaseRef=reviewActiveRef(assigned.reviewer,request);io.refs.set(leaseRef,io.refs.get(fixture.leaseRef));io.refs.delete(fixture.leaseRef)}
  probeSilentReviewer(options,new Date('2026-09-04T12:00:00Z'),io)
  const state={attempts:0,labels:[],quotaCost:2}
  const wire=(n=1,label='wire')=>{for(let i=0;i<n;i++)runGitHubCommand(['api','fixture'],{executor:()=>{state.attempts++;state.labels.push(label);return '{}'}})}
  io.getRateLimit=()=>{wire(state.quotaCost,'quota');return {remaining:5000,limit:5000,reset:1787943986,graphRemaining:5000,graphLimit:5000,graphReset:1787943986}}
  const rawReadReviewRefs=io.readReviewRefs,rawAtomic=io.atomicReviewRefs,rawActivity=io.readLeaseActivity
  io.readReviewRefs=(refs)=>{wire(1,'readReviewRefs');return rawReadReviewRefs(refs)}
  io.atomicReviewRefs=(changes)=>{wire(1,'atomicReviewRefs');return rawAtomic(changes)}
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  io.readLeaseActivity=(...a)=>{wire(1,'readLeaseActivity');return rawActivity(...a)}
  for(const name of ['readRef','listRefs','listReviewRefsPaged','getCommit','getPr','getIssue','getIssueComments','getPrReviews','createRef','updateRef','deleteRef','readReviewRecords','readActiveReviewLeases','readReviewStates']){
    const fn=io[name];if(typeof fn!=='function')continue
    io[name]=(...args)=>{wire(1,`${name}:${String(args[0])}`);return fn(...args)}
  }
  const make=io.makeOwnerCommit;io.makeOwnerCommit=(m)=>{wire(1,'commit');return make(m)}
  return {io,options,leaseRef,state}
}

test('silent reviewer reclaim costs exactly its derived 30-request budget (issue #2697)',()=>{
  const {io,options,leaseRef,state}=instrumentedSilentReclaimIo()
  let released;try{released=reclaimSilentReviewer(options,new Date('2026-09-04T14:00:00Z'),io)}
  catch(error){throw new Error(`${error.message}; calls=${state.labels.join(',')}`)}
  assert.ok(released.releaseSha);assert.equal(io.refs.get(leaseRef)??null,null)
  assert.equal(state.attempts,30,`the silent reclaim path costs exactly 30 wire requests; measured ${state.attempts}: ${state.labels.join(',')}. If this changed, RE-DERIVE the ceiling from a fresh measurement and record it in docs/verification/reviewer-silent-reclaim-api-budget-2026-09-10.md -- never widen it to fit a refusal (issue #2075)`)
  assert.equal(state.attempts,REVIEW_SILENT_RECLAIM_REQUEST_LIMIT,'the enforced ceiling must equal the measured total, with no undeclared headroom')
  const mutexAt=state.labels.indexOf(`createRef:${MUTEX_REF}`)
  assert.notEqual(mutexAt,-1,`mutex acquisition was not observed: ${state.labels.join(',')}`)
  assert.equal(mutexAt,15,`the reclaim spends 15 requests before its mutex gate: ${state.labels.slice(0,mutexAt).join(',')}`)
  assert.equal(state.labels.length-mutexAt,REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE,`the mutex-held section costs exactly ${REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE} requests: ${state.labels.slice(mutexAt).join(',')}`)
  // The redundancy the measurement found, and why it stays gone: the post-mutex check
  // used to read the PR fresh twice for the same PR in the same statement. Exactly one
  // fresh PR read may happen inside the mutex section.
  assert.equal(state.labels.slice(mutexAt).filter((label)=>label===`getPr:${options.pr}`).length,1,'the mutex-held section must read the PR fresh exactly once')
  assert.equal(REVIEW_OPERATION_REQUEST_LIMIT,25,'the shared assignment/replacement ceiling must not be widened by the reclaim derivation')
})

test('silent reviewer reclaim refuses before the mutex when its mutex section will not fit (issue #2697)',()=>{
  const {io,options,leaseRef,state}=instrumentedSilentReclaimIo()
  state.quotaCost=3 // one extra pre-mutex request: 16 + 15 > 30
  assert.throws(()=>reclaimSilentReviewer(options,new Date('2026-09-04T14:00:00Z'),io),/cannot fit 15 remaining requests inside the 30-request budget/)
  assert.equal(state.labels.includes(`createRef:${MUTEX_REF}`),false,`the reclaim budget refusal must precede mutex acquisition: ${state.labels.join(',')}`)
  assert.ok(io.refs.get(leaseRef),'a refused reclaim must leave the lease untouched')
  assert.equal(io.refs.get(MUTEX_REF)??null,null,'a refused reclaim must leave no mutex behind')
})

test('an exhausted reviewer budget names the operation and its derived ceiling (issue #2697)',()=>{
  const {io,options,state}=instrumentedSilentReclaimIo()
  state.quotaCost=30 // spend the whole derived budget on the very first call
  assert.throws(()=>reclaimSilentReviewer(options,new Date('2026-09-04T14:00:00Z'),io),(error)=>{
    assert.match(error.message,/reclaim-silent-reviewer/,'the refusal must name the operation whose budget it is')
    assert.match(error.message,/derived 30-request budget/,'the refusal must state the derived ceiling for that operation')
    assert.match(error.message,/Re-derive it from a written measurement rather than widening it/,'the refusal must point at re-derivation, not widening')
    return true
  })
})

for(const mode of ['serial','parallel'])test('silent reclaim current key derivation '+mode,()=>{
  const {io,options,state}=instrumentedSilentReclaimIo(mode)
  reclaimSilentReviewer(options,new Date('2026-09-04T14:00:00Z'),io)
  assert.equal(state.attempts,28)
})
