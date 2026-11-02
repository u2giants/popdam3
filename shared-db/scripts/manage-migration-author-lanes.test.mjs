import assert from 'node:assert/strict'
import { currentRepository, expectedOperatorAssociation } from './lib/repository-identity.mjs'
// Fixtures follow the resolved repository identity and its operator association (#3255).
const THIS_REPO = currentRepository(), OPERATOR_ASSOCIATION = expectedOperatorAssociation()
import test from 'node:test'
import { namedHold, urgentHoldDetail, urgentHoldReason } from './manage-migration-author-lanes.mjs'
import { claimWorktreeRebindRef } from './manage-migration-author-lanes.mjs'
import { allocatableReviewers, reconcilePreflightRows } from './manage-migration-author-lanes.mjs'
import { completeReviewerOperationRouteSnapshot, derivePrOperationRoute, reconcileReviewerOperationRouteFiles } from './manage-migration-author-lanes.mjs'
import { validateHoldReasonRecord } from './lib/hold-reason.mjs'
import { ENGINES } from './lib/engine-routing.mjs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { REVIEW_VERDICT_REF_PREFIX, verdictRef } from './lib/review-verdict-artifact.mjs'
import { OWN_START_ONLY_ACTIVITY, ENGINE_REVIEWER_EXCLUSION } from './manage-migration-author-lanes.mjs'
import { resolvePeerSlots } from './lib/lanes/review-assignment.mjs'
import { authorizeRepositoryMaintenanceStatus } from './manage-migration-author-lanes.mjs'
import { freezeTolerantMerge, mergedPrReviewerReuseAllowed, acquirePromotionFreeze, releasePromotionFreeze, readPromotionFreeze, PROMOTION_FREEZE_REF } from './manage-migration-author-lanes.mjs'
import { SLOT_INDEPENDENCE_CONFLICT } from './manage-migration-author-lanes.mjs'
import { canonicalReviewerAllowlist, REVIEWER_FALLBACK_PROVIDERS, orderedReviewers } from './manage-migration-author-lanes.mjs'
import { inheritReviewerAllowlist, isReviewerAllowlistSuperset, sameReviewerAllowlist } from './manage-migration-author-lanes.mjs'
import { parseAssignmentRef } from './manage-migration-author-lanes.mjs'
import { setScopeStatus, wrongOwnerMessage } from './manage-migration-author-lanes.mjs'
import { readyRecord, persistInitialReady } from './db-flow/reconcile.mjs'
import { canonicalJson, sha256 } from './db-flow/evidence-bundle.mjs'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertUnambiguousClaimTitle, claimCoversObject, renewalIssueScope, CLAIM_CLOSE_REASONS, RECORDABLE_EXCLUSION_REASONS, RETIRED_EXCLUSION_REASONS, RECOVERABLE_CLAIM_CLOSE_REASONS, LEGACY_GUARDED_CLEANUP_CLOSE_REASON, ACTIVE_REVIEWERS, OVERFLOW_REVIEWERS, reviewersForOrchestrator, findBusyReviewers, reviewLeaseAgeHours, activityFingerprintForLease, SILENCE_MIN_AGE_HOURS, SILENCE_CONFIRM_HOURS, REVIEW_SILENCE_PROBE_REF_PREFIX, REVIEW_SILENCE_RELEASE_REF_PREFIX, REVIEW_QUEUE_REF_PREFIX, pickReviewer, addedMigrationVersions, assertMergeCommitInMainHistory, REVIEWERS, RETIRED_REVIEWERS, QUARANTINED_REVIEWERS, acquireExclusive, assertLaneAvailable, assertDurableReviewApproval, buildDynamicQueues, claimBody, closedClaimAuthoredOnMain, currentMainMaxVersion, queueExit, NON_STRUCTURAL_EXITS, OUTSIDE_ORCHESTRATOR_EXITS, conflicts, completeWork, requiresReturnAddress, returnIssueToOwner, RETURNED_MARKER, createRefWithReadback, deleteRefWithReadback, EXCLUSIVE_REFS, githubIo, isConfirmedRefAbsence, LaneError, main, MUTEX_RECOVERY_ACTIVE_REF, MUTEX_REF, parseAuthorLease, parseQueueScope, parseReviewCursor, readPrAfterPush, readRefAfterWrite, recoverStaleAuthorMutex, releaseOwnedRef, failedReviewerReleaseCommand, requireOwnedRef, reviewerExecutionPreflight, runGitHubCommand, withReviewRequestBudget, REVIEW_CURSOR_REF, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_FAILURE_REF_PREFIX, validateClaimObjects, parseDoctorFailures, TERMINAL_FAILURE_CODES, doctorSpawnPlan, doctorTimeoutFailingChecks, resolveCommandPath, summarizeDoctorOutput, pickExecutableCandidate, REVIEWER_DOCTOR_TIMEOUT_MS, REVIEWER_PREFLIGHT_TIMEOUT_MS, findPrReviewAssignments, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, reviewActiveRef, parseReviewLease, EXPECTED_REF_ABSENCE, EXPECTED_REF_PRESENCE, deriveLivePreviewCandidate, validateOriginalPreviewApplyEvidence, projectReviewPr, projectReviewerOperationRouteSnapshot, reviewStateGraphqlFields, REVIEW_OPERATION_REQUEST_LIMIT, REVIEW_MUTEX_SECTION_RESERVE, REVIEW_SILENT_RECLAIM_REQUEST_LIMIT, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE, inReviewReplacementNamespace, REVIEW_REF_ROW_LIMIT, parseGhIncludeResponse, hasNextPageLink, parseLinkHeader, parseReviewExclusion, REVIEW_EXCLUSION_REF_PREFIX, parseReviewReinstatement, REVIEW_REINSTATEMENT_REF_PREFIX, REINSTATABLE_EXCLUSION_REASONS, reviewExclusionRef, reviewReinstatementRef, REVIEW_EXCLUSION_GENERATION_LIMIT, countDoctorPassLines, REVIEW_RETURN_REF_PREFIX, parseReviewReturn, readReviewReturns, reviewReturnRef, reviewRecordRefs, retiredVerdictRef, REVIEW_RETIRED_VERDICT_REF_PREFIX, reviewerReadsRepository, reviewerEmitsGovernedVerdict, readReviewVerdicts, nonReadingReviewerReplacementCommand, hasVerdictForHead, headVerdictBlocksReplacement, reviewerKnownNonReading, DURABLE_VERDICT_REF_NAMESPACE, recordReviewVerdict, markReviewRefListingRefusal, isReviewRefListingRefusal, markLeaseReadFailure, isLeaseReadFailure, REVIEW_TARGET_SUPERSEDED, withArchivedVerdictMirror, legacyLeaseTerminalReason, isCommandSizeFailure, classifyVerdictForArchive, archivedVerdictRef, REVIEW_ARCHIVED_VERDICT_REF_PREFIX, reviewStartedMarkerRef, RETURNED_COPY_MARKER, returnedCopyProvenance, REPO, noteHeldMutex, clearHeldMutex, releaseHeldMutexOnProcessExit } from './manage-migration-author-lanes.mjs'
import { readDatabasePreviewClassificationFile, withDatabasePreviewClassificationFile, databasePreviewAdmission, buildDatabasePreviewFileSnapshot } from './manage-migration-author-lanes.mjs'
import { parseReviewRelease } from './lib/lanes/review-replacement.mjs'

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
    [assignment2,{message:`db-coordination reviewer-cursor sequence=2 reviewer=glm-5.3 issue=${issue} pr=${pr} head=${headSha} slot=2`}],
    [replacement2,{message:`db-coordination reviewer-replacement sequence=7 reviewer=muse-spark-1.3-contributor issue=${issue} pr=${pr} head=${headSha} slot=2 failed-sequence=2 prior-sequence=6 failure-ref=${'9'.repeat(40)}`}],
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
  addVerdict(`refs/db-review-verdicts/${issue}-${pr}-${headSha}-slot2`,'5'.repeat(40),2,assignment2,'glm-5.3')
  if(includeLatestReplacementVerdict)addVerdict(`refs/db-review-verdict-replacements/${issue}-${pr}-${headSha}-slot2-7`,'6'.repeat(40),2,replacement2,'muse-spark-1.3-contributor')
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
    commits.set(returnSha,{message:`db-coordination reviewer-return reviewer=${returnSlot===1?'kimi-k3':'muse-spark-1.3-contributor'} issue=${issue} pr=${pr} head=${headSha} slot=${returnSlot} assignment=${retired.sha} sequence=${returnSlot===1?1:7}${retired.sequence===null?'':` replacement=${retired.sequence}`} reason=independence-conflict`})
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














const scope = (status, workType, route, priority, objects=[], depends='') => `\`\`\`db-work-scope\nstatus: ${status}\nwork_type: ${workType}\nroute: ${route}\n${workType==='structural'?'service_class: standard-application\nchange_type: migration\napplication_return_to: u2giants/example-app\nlive_assertion: authenticated create-and-read succeeds\ngenerated_types: not-applicable\n':''}priority: ${priority}\ndepends_on: ${depends}\nobjects:\n${objects.map((x)=>`  - ${x}`).join('\n')}\n\`\`\``

test('queue scope keeps status, work type, and route separate',()=>{
  assert.deepEqual(parseQueueScope(scope('ready','structural','claim-first',9,['table core.a'],'#12, 13')), {status:'ready',workType:'structural',route:'claim-first',priority:9,dependencies:[12,13],returnTo:null,writes:['table core.a'],reads:[],legacyObjects:['table core.a'],objects:['table core.a'],serviceClass:'standard-application',changeType:'migration',applicationReturnTo:'u2giants/example-app',liveAssertion:'authenticated create-and-read succeeds',generatedTypes:'not-applicable',outcomeStage:'entered'})
  assert.throws(()=>parseQueueScope(scope('ready','structural','claim-first',1)),/must list at least one write/)
  assert.throws(()=>parseQueueScope(scope('waiting','structural','claim-first',1,['table core.a'])),/status must be/)
  assert.throws(()=>parseQueueScope(scope('ready','source-data','shared-db-orchestrator',1)),/not valid/)
  assert.throws(()=>parseQueueScope(scope('ready','source-data','source-data-session',1,['table plm.nbcu_right'])),/must not claim/)
  assert.throws(()=>parseQueueScope(`\`\`\`db-work-scope\nstate: eligible\npriority: 1\nobjects:\n  - table core.a\n\`\`\``),/state is retired/)
  assert.throws(()=>parseQueueScope(`${scope('ready','structural','claim-first',1,['table core.a'])}\n${scope('blocked','repo-maintenance','repo-maintenance',1)}`),/exactly one/)
})

test('dynamic queues serialize overlapping work and refill every empty lane',()=>{
  const issues=[
    {number:1,title:'a',body:scope('ready','structural','claim-first',10,['table core.a'])},
    {number:2,title:'a later',body:scope('ready','structural','claim-first',8,['table core.a'])},
    {number:3,title:'b',body:scope('ready','structural','claim-first',7,['table core.b'])},
    {number:4,title:'c',body:scope('ready','structural','claim-first',6,['table core.c'])},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.equal(result.fullyAudited,true)
  assert.deepEqual(new Set(result.dispatchable),new Set([1,3,4]))
  assert.ok(result.queues.some((q)=>q.queued.join(',')==='1,2'))
})

test('queue priority favors the issue that unblocks the most downstream work, then the oldest issue',()=>{
  const issues=[
    {number:100,createdAt:'2026-08-04T00:00:00Z',title:'old but no dependents',body:scope('ready','structural','claim-first',999,['table core.a'])},
    {number:200,createdAt:'2026-08-03T00:00:00Z',title:'older equal blocker',body:scope('ready','structural','claim-first',1,['table core.a'])},
    {number:300,createdAt:'2026-08-02T00:00:00Z',title:'depends on 200',body:scope('ready','structural','claim-first',1,['table core.b'],'#200')},
    {number:400,createdAt:'2026-08-05T00:00:00Z',title:'larger blocker',body:scope('ready','structural','claim-first',1,['table core.a'])},
    {number:500,createdAt:'2026-08-06T00:00:00Z',title:'depends on 400',body:scope('ready','structural','claim-first',1,['table core.c'],'#400')},
    {number:600,createdAt:'2026-08-07T00:00:00Z',title:'transitively depends on 400',body:scope('ready','structural','claim-first',1,['table core.d'],'#500')},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.deepEqual(result.blockerCounts,{100:0,200:1,300:0,400:2,500:1,600:0})
  assert.equal(result.queues.find((queue)=>queue.queued.includes(400)).queued[0],400,'two downstream issues outrank every older or manually higher-priority issue')

  const ageTie=buildDynamicQueues([
    {number:700,createdAt:'2026-08-10T00:00:00Z',title:'newer',body:scope('ready','structural','claim-first',999,['table core.z'])},
    {number:800,createdAt:'2026-08-01T00:00:00Z',title:'older',body:scope('ready','structural','claim-first',1,['table core.z'])},
  ],[],NOW)
  assert.deepEqual(ageTie.queues.find((queue)=>queue.queued.includes(800)).queued,[800,700])
})

test('an open issue whose closed claim version is on main is never dispatched as fresh authoring',()=>{
  const issue={number:1769,title:'WWE tables awaiting promotion',body:scope('ready','structural','claim-first',700,['schema plm'])}
  const positiveControl=buildDynamicQueues([issue],[],NOW)
  assert.deepEqual(positiveControl.dispatchable,[1769], 'without merged-claim evidence the known issue goes red')
  const guarded=buildDynamicQueues([issue],[],NOW,[1769],null,new Map(),new Set([1769]))
  assert.deepEqual(guarded.dispatchable,[])
  assert.equal(guarded.skipped.find((row)=>row.issue===1769).reason,'authored-on-main')
})

test('authored-on-main requires the closed claim own reserved version, not a later migration touching the same object (issue #2406)',()=>{
  const reserved='20260903192801',other='20260903075635',branch='claude/issue-2138-filter-effective-assets-perf'
  const claim={number:2225,body:claimBody({
    version:reserved,
    objects:['function public.filter_effective_assets'],
    owner:'claude/orch-2224-agent-2138',branch,worktree:'C:/w/2138',
    expiresAt:new Date('2026-09-04T07:27:46.753Z'),
  })}
  const io={
    branchPulls:()=>[{number:2200,merged_at:'2026-09-03T08:00:00Z',merge_commit_sha:'a'.repeat(40)}],
    mergeCommitInMain:()=>true,
    getPrFiles:()=>[{filename:`supabase/migrations/${other}_popdam_effective_filter_identity_append.sql`,status:'added'}],
  }
  // THE LOCK (#2406 review, High): the reserved version IS on main (landed via a
  // later re-issue) and the claim's own pull merged, but that pull did not ADD
  // the reserved version. The pre-#2406 classifier -- "version on main plus any
  // merged pull from the branch" -- answered true here, which is the exact
  // misclassification this change exists to end. This assertion must fail if
  // addedMigrationVersions(io.getPrFiles(...)).includes(lease.version) is
  // removed; the case below it does not distinguish and is kept as extra cover.
  assert.equal(closedClaimAuthoredOnMain(claim,NOW,new Set([reserved]),io),false,
    'a reservation spent by a later re-issue is not authored by this claim, even though the version is on main and the claim pull merged')
  assert.equal(closedClaimAuthoredOnMain(claim,NOW,new Set([other]),io),false,
    'an unspent reservation stays unauthored even when the same object was changed elsewhere')
  io.getPrFiles=()=>[{filename:`supabase/migrations/${reserved}_filter_effective_assets.sql`,status:'added'}]
  assert.equal(closedClaimAuthoredOnMain(claim,NOW,new Set([reserved]),io),true,
    'positive control: the exact reserved version added by the merged claim pull request is authored')
})

test('dynamic queues fill inactive lanes before queueing behind active claims',()=>{
  const claims=[{number:31,body:body(['table core.a'],'31')},{number:32,body:body(['table core.b'],'32')}]
  const one=buildDynamicQueues([{number:40,title:'c',body:scope('ready','structural','claim-first',9,['table core.c'])}],claims,NOW)
  assert.deepEqual(one.dispatchable,[40])
  assert.equal(one.queues.find((q)=>q.queued.includes(40)).active,null)
  const two=buildDynamicQueues([
    {number:40,title:'c',body:scope('ready','structural','claim-first',9,['table core.c'])},
    {number:41,title:'d',body:scope('ready','structural','claim-first',8,['table core.d'])},
  ],[{number:31,body:body(['table core.a'],'31')}],NOW)
  assert.deepEqual(new Set(two.dispatchable),new Set([40,41]))
})

test('queue audit names expired active claims, queued work, and pull-request state',()=>{
  const expired=body(['table core.a'],'31','2026-08-13T08:00:00.000Z')
  const result=buildDynamicQueues(
    [{number:40,title:'waiting',body:scope('ready','structural','claim-first',9,['table core.a'])}],
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
    {number:10,title:'open dependency',body:scope('blocked','structural','claim-first',9,['table core.blocked'])},
    {number:11,title:'dependent',body:scope('ready','structural','claim-first',8,['table core.x'],'#10')},
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
  const allowed=new Set(['reject','fork','repo-session'])
  for(const [workType,exit] of Object.entries(NON_STRUCTURAL_EXITS)){
    assert.ok(allowed.has(exit),`${workType} must exit to a named destination, got ${exit}`)
    assert.notEqual(exit,'accept',`${workType} must never be accepted by the orchestrator`)
    assert.equal(queueExit(workType),exit)
  }
  assert.throws(()=>queueExit('invented-work-type'),/no structural-lane exit is defined/)
})

// OWNER RULING 2026-08-21 (issue #1366). Repository maintenance, documentation and
// security-settings work is not the orchestrator's, not even to dispatch. These
// exits are the machine-readable form of that ruling; a regression here is how the
// original routing mistake happened.
test('the 2026-08-21 owner ruling is enforced: repo work leaves the orchestrator, Master Data does not move',()=>{
  assert.equal(queueExit('repo-maintenance'),'repo-session')
  assert.equal(queueExit('documentation'),'repo-session')
  // Owner ruling 2026-09-28 (#3675): never ask a human to approve. Security
  // settings go to a separately started AI session, never back to Albert.
  assert.equal(queueExit('security-settings'),'repo-session')
  assert.equal(OUTSIDE_ORCHESTRATOR_EXITS.includes('return-to-owner'),false)
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
    {number:50,title:'structure',body:scope('ready','structural','claim-first',9,['table core.a'])},
    {number:51,title:'row cleanup',body:scope('ready','application-data','application-session',8)},
    {number:52,title:'ci guard defect',body:scope('ready','repo-maintenance','repo-maintenance',7)},
    {number:53,title:'owner question',body:scope('owner-decision','security-settings','owner-only',6)},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.deepEqual(result.notOrchestratorWork.map((x)=>x.issue),[51,52,53])
  assert.deepEqual(result.notOrchestratorWork.map((x)=>x.exit),['reject','repo-session','repo-session'])
  // #3675: a legacy owner-only scope on security-settings is AI-session work, not a human debt.
  assert.equal(result.notOrchestratorWork.find((x)=>x.issue===53).blockedOnOwner,false)
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
  assert.throws(()=>parseQueueScope(scope('ready','structural','claim-first',1,['table core.a']).replace('priority: 1','return_to: u2giants/popdam3\npriority: 1')),/must not carry a return_to/)
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
  const issues=[{number:11,title:'dependent',body:scope('ready','structural','claim-first',8,['table core.x'],'#99')}]
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
  // assertLaneAvailable lives in scripts/lib/lanes/claims.mjs since the split
  // (#3726), so the guard reads the entrypoint AND every lane module.
  const laneDir = new URL('./lib/lanes/', import.meta.url)
  const sources = [readFileSync(new URL('./manage-migration-author-lanes.mjs', import.meta.url), 'utf8'), ...readdirSync(laneDir).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(new URL(f, laneDir), 'utf8'))]
  for (const source of sources) assert.doesNotMatch(source, /MAX_AUTHOR_LANES|active-author leases are occupied|would exceed active-author capacity/, 'a lane cap must never be reintroduced')
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

function usableAdmission(row){return {provider:row.provider,status:'ready',usable:true,admission:{schema_version:1,provider:row.provider,state:'unknown',reason:'unscopable',quota_state:'unknown',reset_at:null,credential_profile_scope:null,model_scope:null}}}

function reviewIo(){
  const io=memoryIo(), commits=new Map();let seq=0
  // Legacy fixtures below pin the historical full-roster order. Tests that
  // exercise the production preference order delete this test-only override.
  io.reviewerOrder=(sequence)=>Array.from({length:ACTIVE_REVIEWERS.length},(_,offset)=>ACTIVE_REVIEWERS[(sequence-1+offset)%ACTIVE_REVIEWERS.length])
  io.resolveReviewEngine=()=> 'claude'
  io.reviewerUsability=(reviewers)=>new Map(reviewers.map((row)=>[row.provider,usableAdmission(row)]))
  io.refs.set(REVIEW_ACTIVE_CUTOVER_REF,'cutover-complete')
  io.makeOwnerCommit=(message)=>{const sha=(++seq).toString(16).padStart(40,'0');commits.set(sha,{message});return sha}
  io.getCommit=(sha)=>commits.get(sha)
  io.pauseReviewerFailure=()=>{}
  io.readPaidReviewStarts=(prefix)=>[...io.refs].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha,commit:commits.get(sha)}))
  io.updateRef=(ref,sha)=>io.refs.set(ref,sha)
  io.getIssue=()=>({state:'open'})
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:'abcdef9',ref:'codex/x'}})
  io.getIssueComments=()=>[]
  io.getPrReviews=()=>[]
  return io
}




function admittedReviewIo({closeOnMutex=false}={}){
  const io=reviewIo(),headSha='a'.repeat(40);let issueState='open',mutexCreates=0
  const body=['```db-work-scope','status: ready','work_type: structural','route: claim-first','service_class: standard-application','change_type: migration','application_return_to: u2giants/example-app','live_assertion: authenticated create-and-read succeeds','generated_types: not-applicable','outcome_stage: entered','priority: 5','depends_on:','writes:','  - table core.example','```'].join('\n')
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

function paginatedAdmissionReviewIo({commentCount=117,pageBehavior=null}={}){
  const fixture=admittedReviewIo(),comments=Array.from({length:commentCount},(_,index)=>({
    id:100000+index,body:`historical note ${index}`,author_association:'MEMBER',user:{login:'historical-user'},created_at:new Date(Date.UTC(2026,0,1,0,index)).toISOString(),updated_at:new Date(Date.UTC(2026,0,1,0,index)).toISOString(),
  })),requests=[]
  fixture.io.commentIssue=(issue,body)=>comments.push({id:100000+comments.length,body,author_association:OPERATOR_ASSOCIATION,user:{login:'u2giants'},created_at:new Date(Date.UTC(2026,9,15,0,comments.length)).toISOString(),updated_at:new Date(Date.UTC(2026,9,15,0,comments.length)).toISOString()})
  fixture.io.issueComments=(issue)=>githubIo.issueComments(issue,{readJson(args){
    const endpoint=args.at(-1),match=/[?&]page=(\d+)$/.exec(String(endpoint))
    assert.ok(match,`admission comment read must name an explicit page: ${endpoint}`)
    const pageNumber=Number(match[1]),defaultRows=comments.slice((pageNumber-1)*100,pageNumber*100)
    const output=runGitHubCommand(args,{executor:(_bin,cmdArgs)=>{
      requests.push(String(cmdArgs.at(-1)))
      if(pageBehavior){
        const result=pageBehavior({pageNumber,comments,defaultRows})
        if(result?.throw){const error=new Error(result.throw);error.stderr=result.throw;throw error}
        return JSON.stringify(result===undefined?defaultRows:result)
      }
      return JSON.stringify(defaultRows)
    },reportStderr:()=>{}})
    return JSON.parse(output)
  }})
  return {...fixture,comments,requests}
}





function captureAssignmentOutcome(request,io){
  try{return {reviewer:assignNextReviewer(request,io).reviewer}}
  catch(error){return {error:error.message}}
}




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
  // glm-5.3 was paused on 2026-09-18 (owner instruction, chat directive) for
  // weekly account-usage rotation; restored 2026-09-30 (owner instruction,
  // chat: "add GLM back into the reviewer rotation") by deleting it from
  // RETIRED_REVIEWERS.
  // kimi-k3 was paused again on 2026-09-22 (owner instruction): the account has
  // been out of credit since 2026-09-17. With deepseek-v4.1-flash added on
  // 2026-09-23 (issue #3468), glm-5.3 restored on 2026-09-30, and
  // stepfun-step-5-preview on 2026-09-25 (issue #3555, drawn only on Linux
  // machines) the live pool was seven. grok-4.6 was paused on 2026-10-07 (owner
  // instruction), restored 2026-10-08, and QUARANTINED on 2026-10-13 (owner
  // instruction: xAI account out of credit). Also on 2026-10-13 (owner
  // instruction, popcre/ai-devops#1714: rotation pool = Muse, DeepSeek, GLM,
  // StepFun) 'qwen-3.8-max' and 'gemini-3.8-flash-high' were quarantined out of
  // the maintained pool, so the live pool is exactly four, in the historical
  // REVIEWERS order.
  assert.deepEqual(ACTIVE_REVIEWERS.map((r)=>r.name),['glm-5.3','muse-spark-1.3-contributor','deepseek-v4.1-flash','stepfun-step-5-preview'])
  assert.ok(RETIRED_REVIEWERS.includes('kimi-k3'),'kimi-k3 stays paused until its account has credit again')
  assert.ok(QUARANTINED_REVIEWERS.includes('grok-4.6'),'grok-4.6 stays quarantined until the owner restores it')
  assert.ok(!RETIRED_REVIEWERS.includes('grok-4.6'),'grok-4.6 is quarantined (temporary), not retired')
  assert.equal(reviewerReadsRepository('grok-4.6'),true,'pausing grok-4.6 must not invalidate the verdicts it already recorded')
  assert.equal(reviewerReadsRepository('kimi-k3'),true,'pausing the account must not invalidate the verdicts it already recorded')
  assert.ok(!RETIRED_REVIEWERS.includes('glm-5.3'),'glm-5.3 is back in the rotation (owner instruction 2026-09-30)')
  assert.ok(ACTIVE_REVIEWERS.some((r)=>r.name==='glm-5.3'),'glm-5.3 must be drawable after the 2026-09-30 restore')
  assert.equal(reviewerReadsRepository('glm-5.3'),true,'pausing the account must not invalidate the verdicts it already recorded')
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
  // retired anywhere. Its earlier quarantine was lifted on 2026-09-07 after a
  // live qualification that actually passed (ai-devops PR #316, merge commit
  // 795902d8). On 2026-10-13 it was quarantined again under the owner's
  // shared-db-only four-reviewer pool (popcre/ai-devops#1714) — still not
  // retired, still callable by name, just not drawn by the allocator.
  assert.ok(!RETIRED_REVIEWERS.includes('qwen-3.8-max'),'qwen-3.8-max must never be listed as retired')
  assert.deepEqual(QUARANTINED_REVIEWERS,['grok-4.6','qwen-3.8-max','gemini-3.8-flash-high'],'the maintained pool is Muse, DeepSeek, GLM, StepFun (owner 2026-10-13); Grok, Qwen and Gemini stay installed but are not drawn')
  assert.ok(!ACTIVE_REVIEWERS.some((r)=>r.name==='qwen-3.8-max'),'quarantined Qwen must not be drawn by the allocator')
  // Gemini was added on 2026-09-06 (ai-devops #285) only after a recorded live
  // safety qualification AND a live review that returned a well-formed verdict
  // above a substantive report. Its wrapper is asserted so a future rename cannot
  // quietly point the rotation at nothing. Quarantined 2026-10-13 with Qwen.
  assert.equal(REVIEWERS.find((r)=>r.name==='gemini-3.8-flash-high').wrapper,'ai-gemini')
  assert.ok(!ACTIVE_REVIEWERS.some((r)=>r.name==='gemini-3.8-flash-high'),'quarantined gemini-3.8-flash-high must not be drawn by the allocator')
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
// Issue #2127's marker-resolver tests were retired with the claim-first session identity (#3874).


test('the orchestrator engine is never eligible to review its own work',()=>{
  // grok-4.6, PR #2484: `reviewersForOrchestrator('codex')` defaults to
  // ACTIVE_REVIEWERS, and since the 2026-09-06 retirement that list cannot hold
  // codex whatever the engine filter does -- so the default form proves nothing
  // any more. The filter is now asserted against REVIEWERS, which still carries
  // the codex row's orchestratorEngine plus the synthetic list below.
  assert.ok(REVIEWERS.some((row)=>row.name==='codex-gpt-5.6-sol'&&row.orchestratorEngine==='codex'))
  assert.ok(!reviewersForOrchestrator('codex',REVIEWERS).some((row)=>row.name==='codex-gpt-5.6-sol'))
  const future=[{name:'claude-opus',orchestratorEngine:'claude'},{name:'deepseek-chat'}]
  assert.deepEqual(reviewersForOrchestrator('claude',future).map((row)=>row.name),['deepseek-chat'])
  assert.throws(()=>reviewersForOrchestrator('',future),/engine is unreadable/)
})

// ---------------------------------------------------------------------------
// Issue #3232: the owner ruled on 2026-09-17 that GLM must never review GLM
// code. ZCode's engine is GLM-5.3, so a ZCode orchestrator must exclude the glm
// reviewers exactly the way a Codex orchestrator excludes the codex reviewer.
// The exclusion follows the MODEL ENGINE behind the harness, mapped through
// ENGINES[...].reviewerExclusionEngine in lib/engine-routing.mjs.

test('a GLM-engine (ZCode) orchestrator never draws the glm reviewers (#3232)',()=>{
  // Both glm rows declare the family -- including the retained glm-5.2 label,
  // so a historical name that ever becomes drawable again inherits the exclusion.
  assert.equal(REVIEWERS.find((row)=>row.name==='glm-5.3').orchestratorEngine,'glm')
  assert.equal(REVIEWERS.find((row)=>row.name==='glm-5.2').orchestratorEngine,'glm')
  // The coupling between the two files this change touches: the routing
  // module's engine vocabulary and the draw's exclusion map must agree
  // key-for-key, and zcode's family must be the one the glm rows carry, or
  // the exclusion silently misses and GLM reviews GLM code again.
  assert.deepEqual(Object.keys(ENGINE_REVIEWER_EXCLUSION).sort(),Object.keys(ENGINES).sort(),'every engine a marker can declare must have a reviewer-exclusion family')
  assert.equal(ENGINE_REVIEWER_EXCLUSION.zcode,'glm')
  // 'zcode' (the harness a marker can declare) and 'glm' (the family itself)
  // must both exclude every glm row, and no one else.
  for(const engine of ['zcode','glm']){
    const drawable=reviewersForOrchestrator(engine,REVIEWERS)
    assert.ok(!drawable.some((row)=>row.name==='glm-5.3'),`glm-5.3 must not be drawable for a ${engine} orchestrator`)
    assert.ok(!drawable.some((row)=>row.name==='glm-5.2'),`glm-5.2 must not be drawable for a ${engine} orchestrator`)
    assert.deepEqual(drawable.map((row)=>row.name),REVIEWERS.filter((row)=>row.provider!=='glm').map((row)=>row.name))
  }
  // The declared author engine chains the same way: zcode excludes glm through the family (#3874).
  assert.ok(!reviewersForOrchestrator('zcode',REVIEWERS).some((row)=>row.provider==='glm'))
})


test('codex and claude orchestrations behave exactly as before #3232',()=>{
  // The family mapping is the identity for both engines, so the new glm
  // exclusion must NOT narrow their rotation: glm-5.3 stays drawable, exactly
  // as before the glm rows declared an orchestratorEngine.
  for(const engine of ['claude','codex']){
    assert.ok(reviewersForOrchestrator(engine,REVIEWERS).some((row)=>row.name==='glm-5.3'),`glm-5.3 must stay drawable for a ${engine} orchestrator`)
  }
  assert.ok(!reviewersForOrchestrator('codex',REVIEWERS).some((row)=>row.name==='codex-gpt-5.6-sol'))
  // A glm-family row introduced for some other engine vocabulary still only
  // excludes under its own family.
  const future=[{name:'glm-9',orchestratorEngine:'glm'},{name:'deepseek-chat'}]
  assert.deepEqual(reviewersForOrchestrator('claude',future).map((row)=>row.name),['glm-9','deepseek-chat'])
})






test('batched verdict reads request repository association for every evidence source',()=>{
  const fields=reviewStateGraphqlFields({issue:1224,pr:1957},0)
  assert.equal((fields.match(/authorAssociation/g)??[]).length,3)
  assert.match(fields,/pullRequest\(number:1957\).*comments\(first:100\).*authorAssociation/)
  assert.match(fields,/reviews\(first:100\).*authorAssociation/)
  assert.match(fields,/issue\(number:1224\).*comments\(first:100\).*authorAssociation/)
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












const failedReview={issue:9,pr:109,headSha:'abcdef9000000000000000000000000000000000'}
function failedReviewIo(){const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}});assignNextReviewer(failedReview,io);return io}
const replacementRequest={...failedReview,failedSequence:1,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}























const preflightIo=()=>({resolveReviewEngine:()=> 'claude',commandAvailable:()=>true,localHead:()=>failedReview.headSha,localClean:()=>true,reviewerDoctor:()=>({ok:true,failingChecks:[]})})
const preflightRequest={reviewer:'deepseek-v4.1-flash',wrapper:'ai-deepseek-agent',worktree:'C:/review',headSha:failedReview.headSha}

test('reviewer execution preflight enforces approved wrapper, clean worktree, and exact head',()=>{
  const io=preflightIo(), request=preflightRequest
  assert.equal(reviewerExecutionPreflight(request,io).ready,true)
  assert.throws(()=>reviewerExecutionPreflight({...request,wrapper:'ai-qwen'},io),/exact wrapper/)
  assert.throws(()=>reviewerExecutionPreflight({...request,reviewer:'grok-4.6',wrapper:'ai-grok-review'},io),/approved reviewer/,'paused grok-4.6 is not an approved reviewer')
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
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,io),/not a deepseek-v4\.1-flash provider fault/)
  assert.throws(()=>reviewerExecutionPreflight(preflightRequest,io),/Do NOT pause deepseek-v4\.1-flash/)
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

// ISSUE #2828: the timeout refusal must name the repair, and must keep the prefix
// run-governed-review's DOCTOR_TIMEOUT regex matches to drive retry-then-reroute.
test('a doctor timeout names the repair without breaking the retry-then-reroute contract',()=>{
  const glm=doctorTimeoutFailingChecks('ai-glm')
  assert.equal(glm.length,1)
  assert.match(glm[0],/doctor did not answer within 60s/,'the DOCTOR_TIMEOUT prefix is load-bearing')
  assert.match(glm[0],/ai-glm server start/,'a down GLM server names its working repair (#2828)')
  const muse=doctorTimeoutFailingChecks('ai-muse',30000)
  assert.match(muse[0],/doctor did not answer within 30s/)
  assert.match(muse[0],/ai-muse doctor/,'other wrappers are told to probe locally')
  assert.doesNotMatch(muse[0],/ai-glm server start/)
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

test('REVIEWER_PREFLIGHT_TIMEOUT_MS is a real positive timeout',()=>{
  // Same contract as the single-doctor budget: a blank or broken override must
  // not become 0/NaN and silently disable the timeout on the aggregate run.
  assert.ok(Number.isFinite(REVIEWER_PREFLIGHT_TIMEOUT_MS)&&REVIEWER_PREFLIGHT_TIMEOUT_MS>0)
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







test('batched review records include the exact verdict ref for every matched replacement',()=>{
  const replacement=`${REVIEW_REPLACEMENT_REF_PREFIX}/1824-1931-${'a'.repeat(40)}-5`
  assert.deepEqual(reviewRecordRefs(['refs/explicit'],[{ref:replacement}]),[
    'refs/explicit',
    replacement,
    replacement.replace(REVIEW_REPLACEMENT_REF_PREFIX,'refs/db-review-verdict-replacements'),
  ])
})













test('review lease age is truthful for known and unknown commit dates',()=>{
  assert.equal(reviewLeaseAgeHours('2026-09-01T00:00:00Z',new Date('2026-09-01T12:00:00Z')),12)
  assert.equal(reviewLeaseAgeHours(null,new Date('2026-09-01T12:00:00Z')),null)
  assert.equal(reviewLeaseAgeHours('not-a-date',new Date('2026-09-01T12:00:00Z')),null)
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









// Issue #3027 Step 7: the reviewer START watcher's unstarted mode.
function withStartMarker(fixture){
  const ref=reviewStartedMarkerRef({...fixture.request,sequence:fixture.assigned.sequence,slot:1}),sha=fixture.io.makeOwnerCommit(`db-coordination review-started issue=${fixture.request.issue} pr=${fixture.request.pr} head=${fixture.request.headSha} slot=1 sequence=${fixture.assigned.sequence} reviewer=${fixture.assigned.reviewer} at=2026-09-04T09:00:00Z`)
  fixture.io.refs.set(ref,sha)
  return ref
}




















const opts={task:'#1',owner:'agent',branch:'codex/x',worktree:'C:/w',objects:['table core.x'],leaseHours:0.5,requestId:'r1',mutexAttempts:1}



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

test('issue 3027 every stage-lease refusal names the exact lease holder', () => {
  const io=memoryIo()
  io.openClaims=()=>[{number:1,body:body(['table core.x'],'1','2099-01-01T00:00:00Z')}]
  io.getPr=(number)=>({number:Number(number),head:{sha:'abc',ref:'codex/1'},base:{sha:'main'}})
  io.readCommitMessage=(sha)=>sha==='prod-owner-sha-0001'?'db-coordination production req pr=77 head=main\nholder_id: run-9\ngithub_run_id: 9\nacquired_at: 2026-09-16T00:00:00Z':null
  io.refs.set(EXCLUSIVE_REFS.production,'prod-owner-sha-0001')
  assert.throws(()=>acquireExclusive('merge',{owner:'a',pr:1,headSha:'abc'},io),/merges are frozen; hold_reason lease:production held by production lease prod-owner-s, holder run-9, PR #77, run 9, acquired 2026-09-16T00:00:00Z/)
  io.refs.delete(EXCLUSIVE_REFS.production);io.refs.set(EXCLUSIVE_REFS.merge,'merge-owner')
  assert.throws(()=>acquireExclusive('production',{owner:'p',headSha:'main'},io),/guarded merge is active; production promotion must wait; hold_reason lease:merge held by merge lease merge-owner/)
  io.refs.delete(EXCLUSIVE_REFS.merge)
  const first=acquireExclusive('preview',{owner:'a',pr:1,headSha:'abc'},io)
  assert.throws(()=>acquireExclusive('preview',{owner:'b',pr:2,headSha:'abc'},io),new RegExp(`occupied; hold_reason lease:preview held by preview lease ${first.ownerSha.slice(0,12)}`))
})

test('issue 3027 a hold naming an unrelated production refuses while the held production lease is accepted', () => {
  const io=memoryIo()
  const scopeBody=['```db-work-scope','status: ready','work_type: structural','route: claim-first','service_class: standard-application','change_type: migration','application_return_to: u2giants/example-app','live_assertion: authenticated create-and-read succeeds','generated_types: not-applicable','outcome_stage: entered','priority: 5','depends_on:','writes:','  - table core.mine','```'].join('\n')
  io.getIssue=(n)=>Number(n)===50?{number:50,state:'open',body:scopeBody}:{number:Number(n),state:'open',body:''}
  io.openClaims=()=>[{number:60,body:body(['table core.other'],'1','2099-01-01T00:00:00Z')}]
  assert.throws(()=>namedHold(50,'lease:production',io),/names a lease nobody holds/)
  assert.throws(()=>namedHold(50,'until #2860 production finishes',io),/hold_reason must be/)
  assert.throws(()=>namedHold(50,'claim:#60',io),/shares no conflicting object/)
  assert.throws(()=>namedHold(50,'dependency:#2860',io),/not declared/)
  io.refs.set(EXCLUSIVE_REFS.production,'prod-sha')
  const record=namedHold(50,'lease:production',io)
  assert.equal(record.kind,'lease');assert.equal(record.stage,'production');assert.equal(record.owner_sha,'prod-sha')
})

test('issue 2958 open claims never depend on the GitHub labels= filtered listing', () => {
  const requested=[]
  const rows=[
    {number:1,title:'claim',body:'b1',html_url:'u1',labels:[{name:'db-claim'}]},
    {number:2,title:'work',body:'b2',html_url:'u2',labels:[{name:'db-work'}]},
    {number:3,title:'pr',body:'b3',html_url:'u3',labels:[{name:'db-claim'}],pull_request:{}},
    {number:4,title:'claim',body:'b4',html_url:'u4',labels:['db-claim']},
  ]
  const claims=githubIo.openClaims((endpoint)=>{requested.push(endpoint);return /labels=/.test(endpoint)?[]:rows})
  assert.deepEqual(requested,[`repos/${THIS_REPO}/issues?state=open&per_page=100`])
  assert.deepEqual(claims.map((claim)=>claim.number),[1,4])
  assert.match(claims.listing,/returned 4 rows \(1 pull requests, 1 issues without db-claim, 2 claims\)/)
})

test('issue 2958 run 34985444563 an empty or PR-only open issue read never passes as no open claims', () => {
  const noSearch=()=>{throw new Error('search must not run when claims were read')}
  const pr={number:3,title:'pr',body:'b',html_url:'u',labels:[{name:'db-claim'}],pull_request:{}}
  assert.throws(()=>githubIo.openClaims(()=>[],noSearch),/returned 0 rows .*refusing to treat open claims as empty/)
  assert.throws(()=>githubIo.openClaims(()=>[pr],noSearch),/returned 1 rows \(1 pull requests.*refusing to treat open claims as empty/)
  assert.throws(()=>githubIo.openClaims(()=>null,noSearch),/unreadable; refusing/)
  const work=[{number:2,title:'work',body:'b',html_url:'u',labels:[{name:'db-work'}]}]
  const queries=[]
  assert.throws(()=>githubIo.openClaims(()=>work,(q)=>{queries.push(q);return {total_count:1,items:[{number:2957}]}}),/0 claims\); but GitHub search reports 1 open db-claim issues \(#2957\)/)
  assert.deepEqual(queries,[`repo:${THIS_REPO} is:issue is:open label:db-claim`])
  assert.throws(()=>githubIo.openClaims(()=>work,()=>({})),/cross-check was unreadable/)
  assert.deepEqual(githubIo.openClaims(()=>work,()=>({total_count:0,items:[]})),[])
})

test('issue 2958 closed claim history fails closed when the labels= listing is empty', () => {
  assert.throws(()=>githubIo.closedClaimsForWork(1769,()=>[]),/refusing to treat claim history as empty/)
  assert.throws(()=>githubIo.closedClaimsForWork(1769,()=>null),/refusing to treat claim history as empty/)
  assert.deepEqual(githubIo.closedClaimsForWork(1769,()=>[{number:5,title:'CLAIM: #12 other',body:'b',html_url:'u',state:'closed'}]),[])
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
  // #2958: a CI-only zero-match refusal must name what the lane actually saw.
  io.openClaims=()=>[{number:44,title:'claim',body:body(['table public.x'],'44','2999-01-01T00:00:00.000Z')}]
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'diagnostic',pr:7,headSha:'docs-head'},io),
    (error)=>/PR head branch compared: "codex\/docs"/.test(error.message)&&/open claims seen \(1\): #44 branch="codex\/44" active=true/.test(error.message),
  )
  io.openClaims=()=>[]
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'diagnostic-empty',pr:7,headSha:'docs-head'},io),
    /open claims seen \(0\): none/,
  )
  const docsClaim=(version,object)=>claimBody({version,objects:[object],owner:'agent-docs',branch:'codex/docs',worktree:'C:/w/docs',expiresAt:new Date('2999-01-01T00:00:00.000Z')})
  io.openClaims=()=>[{number:45,title:'claim',body:docsClaim('20260814200045','table public.x')},{number:46,title:'claim',body:docsClaim('20260814200046','table public.y')}]
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'diagnostic-multi',pr:7,headSha:'docs-head'},io),
    (error)=>/requires at most one live author claim/.test(error.message)&&/PR head branch compared: "codex\/docs"/.test(error.message)&&/open claims seen \(2\): #45 branch="codex\/docs" active=true, #46 branch="codex\/docs" active=true/.test(error.message),
  )
  io.openClaims=()=>[]
  io.getPrFiles=()=>{throw new Error('GitHub unavailable')}
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'unknown-files',pr:7,headSha:'docs-head'},io),
    /cannot read pull request files/,
  )
})

test('#2758 merge lane accepts independently moved main only through classifyBranchFreshness', () => {
  const io=memoryIo()
  io.getPrFiles=()=>[{path:'docs/operations.md',status:'modified'}]
  // Matching tip keeps the original exact-equality path: no git classification.
  io.getPr=()=>({number:7,head:{sha:'docs-head',ref:'codex/docs'},base:{sha:'main'}})
  io.mainSha=()=> 'main'
  const lock=acquireExclusive('merge',{owner:'docs',pr:7,headSha:'docs-head'},io)
  assert.equal(lock.ref,EXCLUSIVE_REFS.merge)
  releaseOwnedRef(EXCLUSIVE_REFS.merge,lock.ownerSha,io)
  // Unequal tip with unclassifiable SHAs stays a refusal, never a silent pass.
  io.getPr=()=>({number:7,head:{sha:'docs-head',ref:'codex/docs'},base:{sha:'older-main'}})
  io.mainSha=()=> 'newer-main'
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'docs',pr:7,headSha:'docs-head'},io),
    /not based on the current main tip/,
  )
  // An unreadable tip is a refusal, not an independence grant.
  io.mainSha=()=> null
  assert.throws(
    ()=>acquireExclusive('merge',{owner:'docs',pr:7,headSha:'docs-head'},io),
    /not based on the current main tip/,
  )
})

test('#2758 merge lane grants a real independent-main lock and refuses an overlapping move', () => {
  const repo=mkdtempSync(path.join(tmpdir(),'db-lane-2758-'))
  const previous=process.cwd()
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  const put=(name,contents)=>{const file=path.join(repo,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,contents)}
  const commit=(message)=>{git('add','--all');git('commit','-q','-m',message);return git('rev-parse','HEAD')}
  try{
    git('init','-q','-b','main')
    git('config','user.name','Test')
    git('config','user.email','test@example.invalid')
    git('config','commit.gpgsign','false')
    put('docs/shared.md','base\n')
    const base=commit('base')
    git('switch','-q','-c','pr')
    put('docs/pr.md','PR work\n')
    const head=commit('PR work')
    git('switch','-q','main')
    put('scripts/unrelated.mjs','export const unrelated = true\n')
    const tip=commit('independent main move')
    const io=memoryIo()
    io.getPrFiles=()=>[{path:'docs/pr.md',status:'added'}]
    io.getPr=()=>({number:7,head:{sha:head,ref:'codex/docs'},base:{sha:base}})
    io.mainSha=()=>tip
    process.chdir(repo)
    const lock=acquireExclusive('merge',{owner:'independent',pr:7,headSha:head},io)
    assert.equal(lock.ref,EXCLUSIVE_REFS.merge)
    releaseOwnedRef(EXCLUSIVE_REFS.merge,lock.ownerSha,io)

    git('switch','-q','pr')
    put('docs/shared.md','PR edit\n')
    const overlappingHead=commit('PR edits shared file')
    git('switch','-q','main')
    put('docs/shared.md','main edit\n')
    put('scripts/another.mjs','export const another = true\n')
    const overlappingTip=commit('main edits shared file')
    io.getPrFiles=()=>[{path:'docs/pr.md',status:'added'},{path:'docs/shared.md',status:'modified'}]
    io.getPr=()=>({number:7,head:{sha:overlappingHead,ref:'codex/docs'},base:{sha:base}})
    io.mainSha=()=>overlappingTip
    assert.throws(
      ()=>acquireExclusive('merge',{owner:'overlap',pr:7,headSha:overlappingHead},io),
      /not based on the current main tip/,
    )
    assert.equal(io.readRef(EXCLUSIVE_REFS.merge),null)
  } finally {
    process.chdir(previous)
    assert.ok(path.resolve(repo).startsWith(`${path.resolve(tmpdir())}${path.sep}`))
    rmSync(repo,{recursive:true,force:true})
  }
})

test('issue 1688 permits success only after the appropriate merge lock is acquired', () => {
  const documentsWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/documents-only-merge-authorization.yml',import.meta.url)),'utf8')
  const productionWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/shared-supabase-migrations.yml',import.meta.url)),'utf8')
  assert.match(documentsWorkflow,/check-documents-only-merge-authorization\.mjs[\s\S]+--authorize-repository-maintenance-status/)
  assert.doesNotMatch(documentsWorkflow,/--acquire-(?:preview|merge|production)/)
  // popcre/ai-devops#2172 stage C2: production no longer revokes merge authorizations.
  assert.ok(!productionWorkflow.includes('Migration guarded merge authorization'))
})

test('database-only workflow acquisitions supply admission while guarded merge rederives its route', () => {
  const files=['shared-supabase-migrations.yml','preview-ledger-orphan-reconciliation.yml']
  const commands=[]
  for(const file of files){
    const source=readFileSync(fileURLToPath(new URL(`../.github/workflows/${file}`,import.meta.url)),'utf8')
    const lines=source.split(/\r?\n/)
    for(let index=0;index<lines.length;index++){
      if(!/(?:manage-migration-author-lanes\.mjs["']?\s+--acquire-|acquire-merge-lane-waiting\.mjs["']?[^\n]*\s--\s+--acquire-merge\b)/.test(lines[index]))continue
      let command=lines[index].trim()
      while(command.endsWith('\\'))command+=`\n${lines[++index].trim()}`
      commands.push(`${file}: ${command}`)
    }
  }
  assert.equal(commands.length,3,commands.join('\n'))
  for(const command of commands){
    assert.match(command,/--pr\s+\S+/,command)
    if(command.startsWith('guarded-migration-merge.yml:')){
      assert.match(command,/acquire-merge-lane-waiting\.mjs["']?\s+--wait-seconds 900 --poll-seconds 15 -- --acquire-merge/,command)
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

test('reviewer rename routing requires a complete matching REST inventory and readable prior path',()=>{
  const snapshot={files:[{filename:'docs/new.json',status:'renamed'},{filename:'scripts/other.mjs',status:'modified'}]}
  const rest=[{filename:'scripts/other.mjs',status:'modified'},{filename:'docs/new.json',status:'renamed',previous_filename:'docs/old.json'}]
  assert.deepEqual(reconcileReviewerOperationRouteFiles(snapshot,rest).files,rest)
  assert.throws(()=>reconcileReviewerOperationRouteFiles(snapshot,rest.slice(0,1)),/inventories disagree/)
  assert.throws(()=>reconcileReviewerOperationRouteFiles(snapshot,[rest[0],{...rest[1],filename:'docs/elsewhere.json'}]),/inventories disagree/)
  assert.throws(()=>reconcileReviewerOperationRouteFiles(snapshot,[rest[0],{filename:'docs/new.json',status:'renamed'}]),/prior filename is unreadable/)
  assert.throws(()=>reconcileReviewerOperationRouteFiles(snapshot,[rest[0],{...rest[1],status:'copied'}]),/inventories disagree/)
})

test('reviewer routing fetches prior paths for mixed rename and deletion inventories',()=>{
  const body=['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','change_type: reviewer-tooling','priority: 5','depends_on:','writes:','reads:','```'].join('\n')
  const data={data:{repository:{pullRequest:{state:'OPEN',merged:false,mergedAt:null,headRefOid:'a'.repeat(40),files:{pageInfo:{hasNextPage:false},nodes:[{path:'docs/new.json',changeType:'RENAMED'},{path:'docs/gone.json',changeType:'DELETED'}]},closingIssuesReferences:{pageInfo:{hasNextPage:false},nodes:[{number:41,state:'OPEN',body,createdAt:'2026-09-11T17:00:00Z'}]}}}}}
  const rest=[{filename:'docs/new.json',status:'renamed',previous_filename:'docs/old.json'},{filename:'docs/gone.json',status:'removed'}]
  let reads=0
  const result=completeReviewerOperationRouteSnapshot(data,()=>{reads++;return rest})
  assert.equal(reads,1)
  assert.deepEqual(result.files,rest)
  assert.equal(derivePrOperationRoute(7,{}, {headSha:'a'.repeat(40),issue:41,snapshot:result}).route,'repo-maintenance')
  assert.equal(derivePrOperationRoute(7,{}, {headSha:'a'.repeat(40),issue:41,snapshot:completeReviewerOperationRouteSnapshot(data,()=>[{...rest[0],previous_filename:'supabase/migrations/old.sql'},rest[1]])}).route,'structural')
  assert.throws(()=>completeReviewerOperationRouteSnapshot(data,()=>[{...rest[0],filename:'docs/other.json'},rest[1]]),/inventories disagree/)
  assert.throws(()=>completeReviewerOperationRouteSnapshot(data,()=>[{filename:'docs/new.json',status:'renamed'},rest[1]]),/prior filename is unreadable/)
  const truncated=structuredClone(data);truncated.data.repository.pullRequest.files.pageInfo.hasNextPage=true
  // #4348: a pull request over one GraphQL file page routes from the complete REST inventory.
  const paged=completeReviewerOperationRouteSnapshot(truncated,()=>rest)
  assert.deepEqual(paged.files,rest)
  assert.equal(derivePrOperationRoute(7,{}, {headSha:'a'.repeat(40),issue:41,snapshot:paged}).route,'repo-maintenance')
  assert.equal(derivePrOperationRoute(7,{}, {headSha:'a'.repeat(40),issue:41,snapshot:completeReviewerOperationRouteSnapshot(truncated,()=>[...rest,{filename:'supabase/migrations/20990101000000_x.sql',status:'added'}])}).route,'structural')
  assert.throws(()=>completeReviewerOperationRouteSnapshot(truncated),/incomplete or paginated/)
  assert.throws(()=>completeReviewerOperationRouteSnapshot(truncated,()=>[]),/incomplete or paginated/)
  assert.throws(()=>completeReviewerOperationRouteSnapshot(truncated,()=>[{filename:'docs/new.json',status:'renamed'}]),/prior filename is unreadable/)
  const unlinked=structuredClone(truncated);unlinked.data.repository.pullRequest.closingIssuesReferences.pageInfo.hasNextPage=true
  assert.throws(()=>completeReviewerOperationRouteSnapshot(unlinked,()=>rest),/incomplete or paginated/)
  assert.throws(()=>completeReviewerOperationRouteSnapshot(data,()=>{throw new LaneError('REST inventory reached 100 rows')}),/reached 100 rows/)
  const noRename=structuredClone(data);noRename.data.repository.pullRequest.files.nodes=[{path:'docs/gone.json',changeType:'DELETED'}]
  completeReviewerOperationRouteSnapshot(noRename,()=>{throw new Error('must not read REST without a rename')})
})

test('githubIo reviewer routing wires the REST file inventory into rename reconciliation (#3608 review)',()=>{
  const source=readFileSync(new URL('./manage-migration-author-lanes.mjs',import.meta.url),'utf8')
  const start=source.indexOf('  readReviewerOperationRoute(pr){'),body=source.slice(start,source.indexOf('\n  },',start))
  assert.ok(start>0,'githubIo.readReviewerOperationRoute must exist')
  assert.match(body,/completeReviewerOperationRouteSnapshot\(data,\(\)=>githubIo\.getPrFiles\(Number\(pr\)\)\)/)
  assert.equal(typeof githubIo.getPrFiles,'function')
  assert.equal(typeof githubIo.readReviewerOperationRoute,'function')
})

test('operation route accepts only verified non-migration renames as repository maintenance',()=>{
  const head='a'.repeat(40),body=['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','change_type: reviewer-tooling','priority: 5','depends_on:','writes:','reads:','```'].join('\n')
  const io={getPr:()=>({state:'open',head:{sha:head}}),closingIssuesForPr:()=>[{number:41}],getIssue:()=>({state:'open',body})}
  const route=(files)=>derivePrOperationRoute(7,{...io,getPrFiles:()=>files},{headSha:head,issue:41})
  assert.equal(route([{filename:'docs/new.json',status:'renamed',previous_filename:'docs/old.json'}]).route,'repo-maintenance')
  assert.equal(route([{filename:'docs/new.json',status:'renamed',previous_filename:'supabase/migrations/20260901010101_old.sql'}]).route,'structural')
  assert.equal(route([{filename:'supabase/migrations/20260901010101_new.sql',status:'renamed',previous_filename:'docs/old.json'}]).route,'structural')
  assert.equal(route([{filename:'docs/new.json',status:'renamed'}]).route,'structural')
  assert.equal(route([{filename:'docs/new.json',status:'copied',previous_filename:'docs/old.json'}]).route,'structural')
  assert.equal(route([{filename:'docs/new.json',status:'changed'}]).route,'structural')
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


function documentsOnlyAdmissionIo(files){
  const io=memoryIo(),head='a'.repeat(40),base='b'.repeat(40)
  io.enforceAdmission=true
  io.getPr=()=>{assert.ok(io.refs.has(MUTEX_REF),'PR identity must be read under the author mutex');return {number:7,state:'open',head:{sha:head,ref:'codex/docs',repo:{full_name:THIS_REPO}},base:{sha:base,ref:'main',repo:{full_name:THIS_REPO}}}}
  io.mainSha=()=>base
  io.closingIssuesForPr=()=>[]
  io.comparePullRequestFiles=(baseSha,headSha)=>{
    assert.ok(io.refs.has(MUTEX_REF),'exact file inventory must be read under the author mutex')
    assert.equal(baseSha,base);assert.equal(headSha,head)
    return files
  }
  io.getPrFiles=()=>files
  return {io,head,base}
}

test('guarded merge admits an exact live prose-only PR without issue or evidence pair',()=>{
  const row={filename:'HANDOFF.d/checkpoint.md',status:'added',additions:1,deletions:0,changes:1,patch:'@@ -0,0 +1 @@\n+Checkpoint records current custody.'}
  const {io,head}=documentsOnlyAdmissionIo([row])
  let prReads=0;const getPr=io.getPr;io.getPr=(...args)=>{prReads++;return getPr(...args)}
  const lock=acquireExclusive('merge',{owner:'docs',pr:7,headSha:head,admissionOptions:{pr:7}},io)
  assert.ok(lock.ownerSha)
  assert.ok(io.refs.has(EXCLUSIVE_REFS.merge))
  assert.equal(io.refs.has(MUTEX_REF),false)
  assert.ok(prReads>=3,'live PR identity is read before and after inventory and again under the merge lane')
})

test('guarded merge keeps ordinary strong admission for executable instruction migration and malformed documentation diffs',()=>{
  const cases=[
    [{filename:'scripts/tool.mjs',status:'modified',additions:1,deletions:0,changes:1,patch:'@@ -1 +1 @@\n-export const oldValue = 1\n+export const newValue = 2'},'executable source'],
    [{filename:'AGENTS.md',status:'modified',additions:1,deletions:0,changes:1,patch:'@@ -1 +1 @@\n-old instruction\n+new instruction'},'instruction-bearing content'],
    [{filename:'supabase/migrations/20261016120000_change.sql',status:'added',additions:1,deletions:0,changes:1,patch:'@@ -0,0 +1 @@\n+create table core.example(id integer);'},'migration'],
  ]
  for(const [row,label] of cases){
    const {io,head}=documentsOnlyAdmissionIo([row])
    assert.throws(()=>acquireExclusive('merge',{owner:'docs',pr:7,headSha:head,admissionOptions:{pr:7}},io),/exactly one|nonclosing|structural|issue/i,label)
    assert.equal(io.refs.has(EXCLUSIVE_REFS.merge),false,label)
    assert.equal(io.refs.has(MUTEX_REF),false,`${label}: mutex released on refusal`)
  }
  const malformed=documentsOnlyAdmissionIo(null)
  malformed.io.comparePullRequestFiles=()=>null
  assert.throws(()=>acquireExclusive('merge',{owner:'docs',pr:7,headSha:malformed.head,admissionOptions:{pr:7}},malformed.io),/exactly one|nonclosing|structural|issue|inventory/i)
  assert.equal(malformed.io.refs.has(MUTEX_REF),false,'malformed inventory: mutex released on refusal')
})

test('guarded merge falls through to strong admission if the PR moves during prose inventory proof',()=>{
  const {io,head}=documentsOnlyAdmissionIo([{filename:'HANDOFF.d/checkpoint.md',status:'added',additions:1,deletions:0,changes:1,patch:'@@ -0,0 +1 @@\n+checkpoint'}])
  const getPr=io.getPr;let reads=0
  io.getPr=(number)=>{reads++;const pr=getPr(number);if(reads>=2)pr.head.sha='c'.repeat(40);return pr}
  assert.throws(()=>acquireExclusive('merge',{owner:'docs',pr:7,headSha:head,admissionOptions:{pr:7}},io),/exact head|exact-head|head SHA|changed/i)
  assert.equal(io.refs.has(EXCLUSIVE_REFS.merge),false)
  assert.equal(io.refs.has(MUTEX_REF),false,'changed PR: mutex released on refusal')
})

test('guarded merge does not skip admission for a prose PR linked to a work issue',()=>{
  const {io,head}=documentsOnlyAdmissionIo([{filename:'HANDOFF.d/checkpoint.md',status:'added',additions:1,deletions:0,changes:1,patch:'@@ -0,0 +1 @@\n+checkpoint'}])
  io.closingIssuesForPr=()=>[{number:41}]
  io.getIssue=()=>{throw new Error('linked issue admission must remain active')}
  assert.throws(()=>acquireExclusive('merge',{owner:'docs',pr:7,headSha:head,admissionOptions:{pr:7}},io),/linked issue admission must remain active/)
  assert.equal(io.refs.has(EXCLUSIVE_REFS.merge),false)
  assert.equal(io.refs.has(MUTEX_REF),false,'linked issue: mutex released on refusal')
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





test('issue 2116 retired by ai-devops#2172 C2: the production freeze touches no merge authorization', () => {
  const productionWorkflow=readFileSync(fileURLToPath(new URL('../.github/workflows/shared-supabase-migrations.yml',import.meta.url)),'utf8')
  assert.equal(productionWorkflow.indexOf('name: Revoke every pre-existing merge authorization while frozen'),-1)
  assert.equal(productionWorkflow.indexOf('name: Restore the merge authorizations this freeze revoked'),-1)
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
  io.getPr=()=>({number:4386,merged:false,state:'open',head:{sha:'exact-4385-pending-head'}})
  const issue4385=acquireExclusive('preview-recovery',{owner:'recovery',pr:4386,headSha:'main'},io)
  assert.equal(issue4385.ref,EXCLUSIVE_REFS.preview)
  releaseOwnedRef(EXCLUSIVE_REFS.preview,issue4385.ownerSha,io)
  io.getPr=()=>({number:4386,merged:false,state:'closed',head:{sha:'exact-4385-pending-head'}})
  assert.throws(()=>acquireExclusive('preview-recovery',{owner:'recovery',pr:4386,headSha:'main'},io),/already-merged/)
  io.getPr=()=>({number:4772,merged:false,state:'open',head:{sha:'exact-4827-pending-head'}})
  const issue4827=acquireExclusive('preview-recovery',{owner:'recovery',pr:4772,headSha:'main'},io)
  assert.equal(issue4827.ref,EXCLUSIVE_REFS.preview)
  releaseOwnedRef(EXCLUSIVE_REFS.preview,issue4827.ownerSha,io)
  io.getPr=()=>({number:4772,merged:false,state:'closed',head:{sha:'exact-4827-pending-head'}})
  assert.throws(()=>acquireExclusive('preview-recovery',{owner:'recovery',pr:4772,headSha:'main'},io),/already-merged/)
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



test('unreadable claims fail closed',()=>assert.throws(()=>assertLaneAvailable([{number:9,body:'bad'}],[],NOW),/unreadable/))

test('claim objects require known kinds and exact qualified identifiers',()=>{
  assert.deepEqual(validateClaimObjects(['TABLE Core.X']),['table core.x'])
  assert.deepEqual(validateClaimObjects(['column Core.X.Code']),['column core.x.code','table core.x'])
  for(const bad of [['core.x'],['table *'],['table x'],['mystery core.x'],['trigger t']])assert.throws(()=>validateClaimObjects(bad),/claim|kind/)
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


test('audit reports every malformed claim and exits 2 without becoming unusable',()=>{
  const io=memoryIo();io.openClaims=()=>[{number:1,body:'bad'},{number:2,body:'also bad'}]
  assert.equal(main(['--audit'],NOW,io),2)
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


test('requireOwnedRef fails closed when a stranded lock was replaced',()=>{
  const io=memoryIo();io.refs.set(MUTEX_REF,'new-owner')
  assert.throws(()=>requireOwnedRef(MUTEX_REF,'old-owner',io),/lost ownership/)
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

// ISSUE #2459. Five lock kinds that take MUTEX_REF were missing from the
// recovery allowlist; a crash while holding any of them wedged every lane.
test('stranded reviewer exclusion, reinstatement, release, reap and merged-claim reissue mutexes are recoverable',()=>{
  for(const kind of ['reviewer-exclusion-lock','reviewer-reinstatement-lock','reviewer-release-lock','reviewer-abandoned-lease-reap-lock','merged-claim-reissue-lock']){
    const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:`db-coordination ${kind} issue=1 pr=2`,committer:{date:'2026-08-14T19:55:00Z'}})
    assert.equal(recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io).released,'4a69fbbc',kind)
    assert.equal(io.refs.has(MUTEX_REF),false,kind)
  }
})
// Structural guard (#2459): every owner commit that is followed by a mutex
// acquisition must be a kind recovery recognizes, so a new lock kind cannot be
// minted unrecoverable without this test failing.
test('every owner-commit kind that acquires the author mutex is recoverable',async()=>{
  const {readFileSync}=await import('node:fs')
  const source=readFileSync(new URL('./manage-migration-author-lanes.mjs',import.meta.url),'utf8')
  const lines=source.split('\n')
  const kinds=new Set()
  // Holders whose kind is a label passed to the mutex wrapper.
  for(const match of source.matchAll(/withAuthorMutex\('([a-z-]+)'/g))kinds.add(match[1])
  // Exclusive lanes mint `db-coordination <kind> ...` through formatLeaseMessage.
  for(const kind of Object.keys(EXCLUSIVE_REFS))kinds.add(kind)
  // Literal owner commits, with const/let/plain assignment, ternary messages and
  // one alias hop (`ownerSha=replacementSha`), acquired anywhere in 15 lines.
  lines.forEach((line,index)=>{
    const assign=/(?:(?:const|let)\s+)?(\w+)\s*=\s*io\.makeOwnerCommit\(/.exec(line)
    if(!assign)return
    const statement=lines.slice(index,index+3).join('\n')
    const literalKinds=[...statement.matchAll(/`db-coordination ([a-z-]+)[ `]/g)].map((m)=>m[1])
    const window=lines.slice(index,index+15).join('\n')
    const names=new Set([assign[1]])
    for(const alias of window.matchAll(new RegExp(`(\\w+)=${assign[1]}\\b`,'g')))names.add(alias[1])
    const acquires=[...names].some((name)=>new RegExp(`acquire(?:Review)?Mutex\\(${name}\\b`).test(window))
    if(acquires)for(const kind of literalKinds)kinds.add(kind)
  })
  // The scanner must see every holder shape the #2991 review found it blind to.
  for(const known of ['outcome-repair','admission','preview-rehearsal','preview-ready-preparation'])assert.ok(kinds.has(known),`scanner missed ${known}`)
  for(const kind of kinds){
    const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:`db-coordination ${kind} x=1`,committer:{date:'2026-08-14T19:55:00Z'}})
    assert.equal(recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io).released,'4a69fbbc',`mutex kind ${kind} is not recoverable`)
  }
})

// #2991 review: kinds that never hold the mutex must not ride a hyphen prefix.
test('non-mutex record kinds that merely share a prefix are refused by mutex recovery',()=>{
  for(const kind of ['reviewer-failure-release','reviewer-failure','preview-unknown','merge-queue','outcome-repairs']){
    const io=memoryIo();io.refs.set(MUTEX_REF,'4a69fbbc');io.getCommit=()=>({message:`db-coordination ${kind} issue=1 pr=2`,committer:{date:'2026-08-14T19:55:00Z'}})
    assert.throws(()=>recoverStaleAuthorMutex({expectedSha:'4a69fbbc',confirmStale:true,serializedRecovery:true,now:NOW,quietMs:0},io),/not a recognized coordination lock/,kind)
    assert.equal(io.refs.get(MUTEX_REF),'4a69fbbc',kind)
  }
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


function expansionIo(overrides={}){
  const io=memoryIo(),issue={number:1063,state:'open',title:'CLAIM: #853 index',body:claimBody({version:'20260816063532',objects:['index plm.item_upper_trim_item_number_idx'],owner:'codex-issue-853-orderlist',branch:'codex/issue-853-orderlist-index',worktree:'C:\\repos\\shared-db-wt-853-index',expiresAt:new Date('2026-08-17T00:00:00Z')})}
  const workIssue={number:853,state:'open',body:'```db-work-scope\nstatus: ready\nwork_type: structural\nroute: claim-first\npriority: 1\ndepends_on:\nobjects:\n  - table plm.item\n```'}
  io.refs.set('refs/db-claims/20260816063532','reserved');io.getIssue=(n)=>structuredClone(Number(n)===853?workIssue:issue);io.updateIssue=(_n,fields)=>{Object.assign(issue,fields);return structuredClone(issue)}
  io.getPr=()=>({state:'open',head:{sha:'a'.repeat(40),ref:'codex/issue-853-orderlist-index'}});io.getPrFiles=()=>[{status:'added',filename:'supabase/migrations/20260816063532_index.sql'}];io.openClaims=()=>[structuredClone(issue)]
  io.prSources=()=>[{label:'PR #1065 [DRAFT] "index"',objects:['index plm.item_upper_trim_item_number_idx','table plm.item'],versions:['20260816063532']}]
  return Object.assign(io,{issue},overrides)
}
const expansionOptions={issue:853,claim:1063,pr:1065,owner:'codex-issue-853-orderlist',headSha:'a'.repeat(40),branch:'codex/issue-853-orderlist-index',worktree:'C:\\repos\\shared-db-wt-853-index',requestId:'expand',mutexAttempts:1}




function renewalIo(overrides={}){
  const io=memoryIo(),version='20260816045130',head='a'.repeat(40),objects=['table plm.style_tracker_item_bridge']
  const issue={number:1058,state:'open',title:'CLAIM: #853 OrderList bridge',body:claimBody({version,objects,owner:'codex-issue-853-orderlist',branch:'codex/issue-853-orderlist',worktree:'C:\\repos\\shared-db-worktrees\\issue-853-orderlist',expiresAt:new Date('2026-08-14T19:00:00Z')})}
  io.refs.set(`refs/db-claims/${version}`,'permanent')
  const workIssue={number:853,state:'open',body:scope('ready','structural','claim-first',900,objects)}
  io.openClaims=()=>[structuredClone(issue)];io.getIssue=(number)=>Number(number)===853?structuredClone(workIssue):Number(number)===1058?structuredClone(issue):null;io.updateIssue=(_n,fields)=>{Object.assign(issue,fields);return structuredClone(issue)}
  io.getPr=()=>({state:'open',head:{sha:head,ref:'codex/issue-853-orderlist'}})
  io.getPrFiles=()=>[{status:'added',filename:`supabase/migrations/${version}_orderlist.sql`}]
  io.prSources=()=>[{label:'PR #1060 "#853 OrderList"',objects:[...objects],versions:[version]}]
  return Object.assign(io,{issue,workIssue,version,head,objects},overrides)
}
const renewalOptions={claim:1058,issue:853,owner:'codex-issue-853-orderlist',branch:'codex/issue-853-orderlist',worktree:'C:\\repos\\shared-db-worktrees\\issue-853-orderlist',pr:1060,headSha:'a'.repeat(40),leaseHours:0.5,requestId:'renew-853',mutexAttempts:1}




















function expiredPrRecoveryIo({issueNumber,claimNumber,prNumber,version,owner,branch,worktree,title,tables,children},overrides={}){
  const io=memoryIo(),head='a'.repeat(40)
  const claim={number:claimNumber,state:'open',title,body:claimBody({version,objects:tables,owner,branch,worktree,expiresAt:new Date('2026-08-14T19:00:00Z')})}
  const workIssue={number:issueNumber,state:'open',body:scope('ready','structural','claim-first',2,tables)}
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
function recoveryOptions(fixture){return {claim:fixture.claimNumber,issue:fixture.issueNumber,owner:fixture.owner,branch:fixture.branch,worktree:fixture.worktree,pr:fixture.prNumber,headSha:'a'.repeat(40),leaseHours:0.5,requestId:`recover-${fixture.issueNumber}`,mutexAttempts:1}}










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
const mergedReissueArgs={issue:1645,claim:1656,sourcePr:1664,owner:'codex-agent issue-1645-1649',targetBranch:'codex/issue-1645-effective-filters-reissue',targetWorktree:'C:\\new',oldVersion:'20260827183011',leaseHours:0.5}







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

const scopeWith = (body) => ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: claim-first', 'service_class: standard-application', 'change_type: migration', 'application_return_to: u2giants/example-app', 'live_assertion: authenticated create-and-read succeeds', 'generated_types: not-applicable', 'priority: 5', 'depends_on:', body, '```'].join('\n')
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

const depScope = (deps) => ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: claim-first', 'service_class: standard-application', 'change_type: migration', 'application_return_to: u2giants/example-app', 'live_assertion: authenticated create-and-read succeeds', 'generated_types: not-applicable', 'priority: 5', 'depends_on: ' + deps, 'writes:', '  - table core.a', '```'].join('\n')
const completionComment = (record) => ({ body: '```db-work-completion\n' + JSON.stringify(record) + '\n```',author_association:OPERATOR_ASSOCIATION,author:'u2giants' })
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
  const states = { 10: { exists: true, open: false, repository: REPO, comments: [completionComment(mergedRecord(10))], mergeInMain: true } }
  const result = buildDynamicQueues([{ number: 20, title: 'downstream', body: depScope('#10') }], [], NOW, [20], states)
  assert.deepEqual(result.dispatchable, [20])
})

test('an unsuccessful outcome blocks and the audit says which outcome', () => {
  const cancelled = { schema_version: 1, work_issue: 10, outcome: 'cancelled', reason: 'superseded by a different approach' }
  const states = { 10: { exists: true, open: false, repository: REPO, comments: [completionComment(cancelled)] } }
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

test('#3396 review: completeWork refuses a merged report whose sha is only a prefix of GitHub\'s', () => {
  // abc1234 is a prefix of this 40-character merge commit; prefix agreement is not identity.
  const io = completionIo({ pr: { merged_at: 'x', merge_commit_sha: 'abc1234' + '0'.repeat(33) } })
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), /does not match GitHub's merge_commit_sha/)
  const reverse = completionIo({ pr: { merged_at: 'x', merge_commit_sha: 'abc12' } })
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, reverse), /does not match GitHub's merge_commit_sha/)
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

function typedCompletionIo(options = {}, structural = false) {
  const io = completionIo({ pr: { merged_at: 'x', merge_commit_sha: 'abc1234' }, ...options })
  io.getIssue = () => ({ body: '```db-work-scope\n' + [
    'status: ready', `work_type: ${structural ? 'structural' : 'repo-maintenance'}`,
    `route: ${structural ? 'shared-db-orchestrator' : 'repo-maintenance'}`,
    `change_type: ${structural ? 'function' : 'reviewer-tooling'}`, 'priority: 1',
    'writes:', ...(structural ? ['- function public.example'] : []),
  ].join('\n') + '\n```' })
  return io
}

test('typed nonstructural maintenance completes only with authentic merged evidence', () => {
  const io = typedCompletionIo()
  assert.equal(completeWork({ issue: 5, report: mergedRecord(5) }, io).outcome, 'merged')
  assert.equal(io.posted.length, 1)
  assert.match(io.posted[0], /db-work-completion/)
})

for (const [name, options, expected] of [
  ['unmerged PR', { pr: { merged_at: null } }, /is not merged/],
  ['wrong merge SHA', { pr: { merged_at: 'x', merge_commit_sha: 'deadbee' } }, /does not match GitHub's merge_commit_sha/],
  ['merge outside main', { ancestry: false }, /not contained in the history of main/],
  ['undeclared migration', { files: [{ filename: 'supabase/migrations/20260823120000_a.sql' }] }, /do not match the versions/],
  ['existing immutable completion', { comments: [completionComment(mergedRecord(5))] }, /completion is immutable/],
]) {
  test(`typed maintenance still refuses ${name} without publishing`, () => {
    const io = typedCompletionIo(options)
    assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), expected)
    assert.equal(io.posted.length, 0)
  })
}

test('typed structural work still cannot complete at merge even with authentic evidence', () => {
  const io = typedCompletionIo({}, true)
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), /authoritative outcome lifecycle/)
  assert.equal(io.posted.length, 0)
})

test('typed maintenance cannot complete without reading back its published evidence', () => {
  const io = typedCompletionIo()
  io.issueComments = () => []
  assert.throws(() => completeWork({ issue: 5, report: mergedRecord(5) }, io), /could not be read back/)
})

// --activate-review-cutover (issue #1777 handover)

function freshCutoverIo(){const io=reviewIo();io.refs.delete(REVIEW_ACTIVE_CUTOVER_REF);return io}

function seedAssignment(io,{issue,pr,headSha,reviewer,sequence=1}){
  const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer} issue=${issue} pr=${pr} head=${headSha}`)
  io.refs.set(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,sha)
  return sha
}














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









// ---------------------------------------------------------------------------
// Second-reviewer slots (--review-slot). Default slot 1 must be byte-for-byte
// today's behaviour; slot 2 must land a genuinely different, non-busy
// provider and stay idempotent on retry, same as slot 1 always has.
// ---------------------------------------------------------------------------






function addVerifiedServiceFailures(io,request,reviewers){
  let sequence=100
  for(const reviewer of reviewers)for(let n=0;n<2;n++){
    sequence++
    io.refs.set(`refs/db-review-started/${request.issue}-${request.pr}-${request.headSha}-slot${request.slot??1}-seq${sequence}`,io.makeOwnerCommit(`db-coordination review-started issue=${request.issue} pr=${request.pr} head=${request.headSha} slot=${request.slot??1} sequence=${sequence} reviewer=${reviewer} at=2026-10-14T18:00:00Z`))
    io.refs.set(`refs/db-review-failures/${request.issue}-${request.pr}-${request.headSha}-${sequence}`,io.makeOwnerCommit(`db-coordination reviewer-failure-release reviewer=${reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${sequence} code=wrapper_terminal_failure verdict=none artifact=none replacement=none`))
  }
}



























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
    getIssue:()=>({body:['```db-work-scope','status: ready','work_type: structural','route: claim-first','priority: 1','writes:',...writes.map((value)=>`  - ${value}`),'```'].join(String.fromCharCode(10))}),
    previewGateProof:()=>({full_ci_success:true,review_approved:true,dependency_closure_complete:true}),
    mainSha:()=>mainSha,
    previewLedger:()=>({versions:[]}),
  }}
}

test('live no-database-preview returns before claims, pull requests, reviews, or preview evidence are read',()=>{
  const target={repository:THIS_REPO,issue:433,pr:99,base_sha:'8'.repeat(40),head_sha:'9'.repeat(40)},files=[{path:'docs/note.md',status:'modified',mode:'100644',blob_sha:'c'.repeat(40),sha256:'a'.repeat(64),impact:'documentation',reason:'documentation-only change'}],applicable_checks=['unit-tests']
  const database_preview={schema_version:1,...target,decision:'NO_DATABASE_PREVIEW',reason_code:'proven_non_database_change',inspected_digest:sha256(canonicalJson({classifier_version:1,...target,files,applicable_checks})),files,applicable_checks,invalidated_by:['file-content-change','file-set-change','impact-evidence-change','applicable-check-change','classifier-version-change']}
  const forbidden=()=>{throw new Error('late database admission dependency must not run')}
  const snapshot=files.map(({path,status,mode,blob_sha,sha256,impact})=>({path,status,mode,blob_sha,sha256,impact})),bundle_id=sha256(canonicalJson({repository:target.repository,pr:target.pr,base_sha:target.base_sha,head_sha:target.head_sha,files:snapshot}))
  const evidence={...target,bundle_id,database_preview,inspected_files:snapshot},live={number:99,state:'open',base:{sha:target.base_sha,repo:{full_name:target.repository}},head:{sha:target.head_sha}}
  const io={databasePreviewClassificationEvidence:evidence,databasePreviewClassification:githubIo.databasePreviewClassification,getPr:()=>live,databasePreviewFileSnapshot:()=>snapshot,openClaims:forbidden,openPulls:forbidden,previewGateProof:forbidden,previewLedger:forbidden}
  const result=deriveLivePreviewCandidate(433,io)
  assert.equal(result.route,'no_database_preview');assert.equal(result.next_action,'return-to-natural-owner');assert.equal(result.pr,99);assert.equal(result.head_sha,target.head_sha)
  for(const replay of [{...evidence,pr:100},{...evidence,head_sha:'7'.repeat(40)}])assert.throws(()=>deriveLivePreviewCandidate(433,{...io,databasePreviewClassificationEvidence:replay}),/exact command repository|authenticated live pull request/)
})

test('the live adapter reads one explicit classification file once and fails closed on unreadable or ambiguous input',()=>{
  const evidence={repository:THIS_REPO,issue:433,pr:99,base_sha:'8'.repeat(40),head_sha:'9'.repeat(40),bundle_id:'b'.repeat(64)}
  let reads=0
  const io=withDatabasePreviewClassificationFile({databasePreviewClassification:githubIo.databasePreviewClassification},'classification.json',{reader:()=>{reads++;return JSON.stringify(evidence)}})
  assert.deepEqual(io.databasePreviewClassification(433),evidence);assert.deepEqual(io.databasePreviewClassification(433),evidence);assert.equal(reads,1)
  assert.throws(()=>io.databasePreviewClassification(434),/not #434/)
  assert.throws(()=>readDatabasePreviewClassificationFile('missing.json',{reader:()=>{throw new Error('not found')}}),/unreadable: not found/)
  assert.throws(()=>readDatabasePreviewClassificationFile('many.json',{reader:()=>JSON.stringify([evidence,evidence])}),/exactly one evidence object/)
  assert.throws(()=>readDatabasePreviewClassificationFile('bad.json',{reader:()=>'{'}),/unreadable/)
})

test('live preview snapshot preserves unsafe old and new Git identities and never exempts destructive history',()=>{
  const blob=(char,mode='100644',type='blob')=>({blob_sha:char.repeat(40),mode,type})
  const snapshot=({files,baseRows,headRows,contents})=>buildDatabasePreviewFileSnapshot(files,new Map(baseRows),new Map(headRows),(path,side)=>contents[`${side}:${path}`])
  const renamed=snapshot({files:[{filename:'docs/schema.md',previous_filename:'supabase/migrations/20260911010101_schema.sql',status:'renamed'}],baseRows:[['supabase/migrations/20260911010101_schema.sql',blob('a')]],headRows:[['docs/schema.md',blob('b')]],contents:{'base:supabase/migrations/20260911010101_schema.sql':'create table x.y();','head:docs/schema.md':'harmless prose'}})[0]
  assert.equal(renamed.impact,'database-behavior');assert.equal(renamed.previous_path,'supabase/migrations/20260911010101_schema.sql');assert.equal(renamed.base.blob_sha,'a'.repeat(40));assert.equal(renamed.head.blob_sha,'b'.repeat(40))
  const symlink=snapshot({files:[{filename:'docs/note.md',status:'modified'}],baseRows:[['docs/note.md',blob('c','120000')]],headRows:[['docs/note.md',blob('d')]],contents:{'base:docs/note.md':'unsafe-target','head:docs/note.md':'harmless prose'}})[0]
  assert.equal(symlink.impact,'ambiguous');assert.equal(symlink.base.mode,'120000');assert.equal(symlink.head.mode,'100644')
  const unsafeOld=snapshot({files:[{filename:'docs/note.md',status:'modified'}],baseRows:[['docs/note.md',blob('e')]],headRows:[['docs/note.md',blob('f')]],contents:{'base:docs/note.md':'run psql against production','head:docs/note.md':'harmless prose'}})[0]
  assert.equal(unsafeOld.impact,'database-behavior');assert.notEqual(unsafeOld.base.sha256,unsafeOld.head.sha256)
})

test('claim, reviewer, and shared-stage admission cannot ignore supplied no-preview evidence',()=>{
  const target={repository:THIS_REPO,issue:433,pr:99,base_sha:'8'.repeat(40),head_sha:'9'.repeat(40)},files=[{path:'docs/note.md',status:'modified',mode:'100644',blob_sha:'c'.repeat(40),sha256:'a'.repeat(64),impact:'documentation',reason:'documentation-only change'}],applicable_checks=['unit-tests']
  const database_preview={schema_version:1,...target,decision:'NO_DATABASE_PREVIEW',reason_code:'proven_non_database_change',inspected_digest:sha256(canonicalJson({classifier_version:1,...target,files,applicable_checks})),files,applicable_checks,invalidated_by:['file-content-change','file-set-change','impact-evidence-change','applicable-check-change','classifier-version-change']}
  const snapshot=files.map(({path,status,mode,blob_sha,sha256,impact})=>({path,status,mode,blob_sha,sha256,impact})),bundle_id=sha256(canonicalJson({repository:target.repository,pr:target.pr,base_sha:target.base_sha,head_sha:target.head_sha,files:snapshot}))
  const evidence={...target,bundle_id,database_preview,inspected_files:snapshot}
  const live={number:99,state:'open',base:{sha:target.base_sha,repo:{full_name:target.repository}},head:{sha:target.head_sha}}
  const io={databasePreviewClassificationEvidence:evidence,databasePreviewClassification:githubIo.databasePreviewClassification,getPr:()=>live,databasePreviewFileSnapshot:()=>snapshot}
  for(const command of [{claim:true,issue:433,pr:99},{assignReviewer:true,issue:433,pr:99},{acquireExclusive:'preview',issue:433,pr:99},{preparePreviewDispatch:433,pr:99},{reconcileFlow:true,issue:433,pr:99}]){
    const result=databasePreviewAdmission(command,io);assert.equal(result.decision,'NO_DATABASE_PREVIEW');assert.equal(result.next_action,'return-to-natural-owner')
  }
  for(const command of [{claim:true,issue:433},{assignReviewer:true,issue:433},{acquireExclusive:'merge',issue:433}])assert.equal(databasePreviewAdmission(command,{databasePreviewClassificationEvidence:null}).decision,'DATABASE_PREVIEW_REQUIRED')
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:434,pr:99},io),/not #434/)
  assert.throws(()=>databasePreviewAdmission({assignReviewer:true,issue:433,pr:99},{...io,databasePreviewClassificationEvidence:{...evidence,database_preview:{...database_preview,head_sha:'7'.repeat(40)}}}),/unverifiable/)
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:99},{...io,getPr:()=>({...live,base:{...live.base,sha:'7'.repeat(40)}})}),/authenticated live pull request/)
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:99},{...io,getPr:()=>({...live,head:{sha:'7'.repeat(40)}})}),/authenticated live pull request/)
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:99},{...io,databasePreviewClassificationEvidence:{...evidence,repository:'attacker/fork'}}),/exact command repository/)
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:100},io),/exact command repository/)
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:99},{...io,getPr:()=>null}),/authenticated live pull request/)
  let liveReads=0;assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:99},{...io,getPr:()=>++liveReads===1?live:{...live,head:{sha:'7'.repeat(40)}}}),/moved while/)
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:99},{...io,databasePreviewFileSnapshot:()=>[{...snapshot[0],sha256:'f'.repeat(64)}]}),/bundle identity/)
  assert.throws(()=>databasePreviewAdmission({reconcileFlow:true,issue:433,pr:99},{...io,databasePreviewFileSnapshot:()=>[{...snapshot[0],path:'fabricated.md'}]}),/bundle identity/)
  const ambiguous=[{...snapshot[0],impact:'ambiguous'}],fabricated={...evidence,bundle_id:sha256(canonicalJson({repository:target.repository,pr:target.pr,base_sha:target.base_sha,head_sha:target.head_sha,files:ambiguous}))}
  assert.throws(()=>databasePreviewAdmission({claim:true,issue:433,pr:99},{...io,databasePreviewClassificationEvidence:fabricated,databasePreviewFileSnapshot:()=>ambiguous}),/impact classification/)
})

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

function downstreamPromotionFailureJobs(overrides={}){
  const conclusions={
    'SQL migration guards':'success',
    preview:'success',
    'Automatic production qualification and dispatch':'failure',
    'Production apply review (immutable evidence + hard guards)':'skipped',
    'Production apply (automatic evidence gates)':'skipped',
    'production-dry-run':'skipped',
    ...overrides,
  }
  return {total_count:6,jobs:Object.entries(conclusions).map(([name,conclusion])=>({name,status:'completed',conclusion}))}
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

// #2549. The workflow DISPATCH identity and the APPLIED CHECKOUT identity are
// different commits. A supported merged-main rehearsal dispatches from current
// main B while checking out the merged commit A, and names its artifact for A.
test('a merged-main rehearsal may be dispatched from a later main than the checkout it applied',()=>{
  const merge='b'.repeat(40),applied='a1'.repeat(20),dispatch='d2'.repeat(20)
  const input={issue:1769,pr:1809,versions:['20260828232207'],mergeCommitSha:merge}
  const separated=({compareCommits,appliedCommit=applied,artifactName=`preview-migration-apply-${applied}`,artifactHead=dispatch}={})=>{
    const fixture=immutablePreviewApplyIo(),evidence=fixture.previewApplyRun()
    evidence.run.head_sha=dispatch
    evidence.artifacts.artifacts[0].name=artifactName
    evidence.artifacts.artifacts[0].workflow_run.head_sha=artifactHead
    evidence.logs=evidence.logs.replace(/"appliedCommit":"[0-9a-f]+"/,`"appliedCommit":"${appliedCommit}"`)
    return {...fixture,previewApplyRun:()=>evidence,compareCommits}
  }
  // Merge commit <= applied checkout <= dispatch head, and the artifact is named
  // for the checkout while its producer is still the dispatch head.
  const lineage=(base,head)=>{
    if(base===merge&&head===applied)return {status:'ahead'}
    if(base===applied&&head===dispatch)return {status:'ahead'}
    return {status:'diverged'}
  }
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,separated({compareCommits:lineage})),{type:'preview-apply',run_id:'33308168016'})
  // NEGATIVES. Without a comparison nothing is proven; a checkout off the
  // lineage, an artifact named for the dispatch head, and a forged artifact
  // producer all still refuse.
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,separated()),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,separated({compareCommits:()=>({status:'diverged'})})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,separated({compareCommits:(base,head)=>base===merge&&head===applied?{status:'ahead'}:{status:'behind'}})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,separated({compareCommits:(base,head)=>base===applied&&head===dispatch?{status:'ahead'}:{status:'behind'}})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,separated({compareCommits:lineage,artifactName:`preview-migration-apply-${dispatch}`})),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,separated({compareCommits:lineage,artifactHead:applied})),/found 0/)
  // A same-commit merged-main rehearsal still validates with no comparison at all.
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,immutablePreviewApplyIo()),{type:'preview-apply',run_id:'33308168016'})
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

test('a completed preview remains evidence when only its downstream automatic promotion failed',()=>{
  const input={issue:1769,pr:1809,versions:['20260828232207'],mergeCommitSha:'b'.repeat(40)}
  const fixture=immutablePreviewApplyIo(), evidence=fixture.previewApplyRun()
  evidence.run.conclusion='failure'
  evidence.jobs=downstreamPromotionFailureJobs()
  const io={...fixture,previewApplyRun:()=>evidence}
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,io),{type:'preview-apply',run_id:'33308168016'})
  evidence.jobs=downstreamPromotionFailureJobs({preview:'failure'})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.jobs=downstreamPromotionFailureJobs({'SQL migration guards':'failure'})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.jobs={...downstreamPromotionFailureJobs(),total_count:7,jobs:[...downstreamPromotionFailureJobs().jobs,{name:'unexpected',status:'completed',conclusion:'success'}]}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.jobs=downstreamPromotionFailureJobs({'Production apply (automatic evidence gates)':'success'})
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  delete evidence.jobs
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
})

test('a failed downstream dispatcher may leave only its own review-evidence artifact',()=>{
  const input={issue:1769,pr:1809,versions:['20260828232207'],mergeCommitSha:'b'.repeat(40)}
  const fixture=immutablePreviewApplyIo(), evidence=fixture.previewApplyRun()
  const preview=evidence.artifacts.artifacts[0],head=evidence.run.head_sha
  preview.id=456
  const extra=(over={})=>({id:457,name:'automatic-production-apply-review-evidence',digest:`sha256:${'e'.repeat(64)}`,expired:false,workflow_run:{id:evidence.run.id,head_sha:head},...over})
  evidence.run.conclusion='failure'
  evidence.jobs=downstreamPromotionFailureJobs()
  evidence.artifacts={total_count:2,artifacts:[extra(),preview]}
  const io={...fixture,previewApplyRun:()=>evidence}
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,io),{type:'preview-apply',run_id:'33308168016'})
  evidence.artifacts={total_count:2,artifacts:[extra({name:'something-else'}),preview]}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.artifacts={total_count:2,artifacts:[extra({workflow_run:{id:1,head_sha:head}}),preview]}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.artifacts={total_count:3,artifacts:[extra(),extra(),preview]}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.artifacts={total_count:2,artifacts:[extra(),preview]}
  evidence.run.conclusion='success'
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.jobs=downstreamPromotionFailureJobs({'Automatic production qualification and dispatch':'success'})
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,io),{type:'preview-apply',run_id:'33308168016'})
  evidence.artifacts.artifacts[0].expired=true
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0/)
  evidence.artifacts.artifacts[0].expired=false
  evidence.logs=evidence.logs.replaceAll('Report the preview ledger delta','UNKNOWN STEP')
  io.verifyPreviewApplyArtifact=()=>{throw new Error('preview proof is missing a valid content manifest')}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/missing a valid content manifest/)
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

// #2729 / popcre/ai-devops#401 Step 6: a claim-mode apply outside the registry
// is accepted only when its archived artifact binds the hash that merged.
function hashBoundClaimApplyIo({verify='ok',appliedCommit='1'.repeat(40),rehearsalMode='claim',withVerifier=true}={}){
  const runId=34922309051,dispatchHead='f'.repeat(40),version='20260910120000',calls=[]
  const artifact={id:77,name:`preview-migration-apply-${appliedCommit}`,digest:`sha256:${'d'.repeat(64)}`,expired:false,workflow_run:{id:runId,head_sha:dispatchHead}}
  const io={
    calls,
    issueComments:()=>[{body:`preview apply https://github.com/u2giants/shared-db/actions/runs/${runId}`}],
    previewApplyRun:()=>({
      run:{id:runId,path:'.github/workflows/shared-supabase-migrations.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',run_attempt:1,head_sha:dispatchHead},
      jobs:{total_count:0,jobs:[]},
      artifacts:{total_count:1,artifacts:[artifact]},
      logs:`Bounded apply ${JSON.stringify({allowlist:[version],appliedCommit,previewProjectRef:'mvpkijzfmfcxhnzqogzs',rehearsalMode,runId,schema:'shared-db-preview-instance-binding/v1'})}`,
    }),
  }
  if(withVerifier)io.verifyPreviewApplyArtifact=(request)=>{
    calls.push(request)
    if(verify==='mismatch'){const error=new Error('Command failed');error.stderr=`REFUSED: migration content mismatch: ${version}\n`;throw error}
    return {verified:true,runId:request.run.id,artifactId:verify==='wrong-artifact'?78:request.artifact.id,artifactDigest:request.artifact.digest,versions:request.versions}
  }
  return io
}

test('a pre-merge claim-mode apply whose artifact binds the merged migration hash is accepted',()=>{
  const merge='c'.repeat(40),io=hashBoundClaimApplyIo()
  assert.deepEqual(validateOriginalPreviewApplyEvidence({issue:2792,pr:2800,versions:['20260910120000'],mergeCommitSha:merge},io),{type:'preview-apply',run_id:'34922309051'})
  assert.equal(io.calls.length,1)
  assert.equal(io.calls[0].verificationCommit,merge)
  assert.equal(io.calls[0].binding.appliedCommit,'1'.repeat(40))
})

test('a pre-merge claim-mode apply with a different migration hash refuses and names the condition',()=>{
  const input={issue:2792,pr:2800,versions:['20260910120000'],mergeCommitSha:'c'.repeat(40)}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,hashBoundClaimApplyIo({verify:'mismatch'})),/found 0; rejected candidates: run 34922309051 \(preview-apply\): claim-mode archived artifact did not verify against merge commit c{40}: REFUSED: migration content mismatch: 20260910120000/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,hashBoundClaimApplyIo({verify:'wrong-artifact'})),/\(preview-apply\): claim-mode archived artifact receipt does not bind run 34922309051, artifact 77/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,hashBoundClaimApplyIo({withVerifier:false})),/\(preview-apply\): claim-mode apply outside the restoration registry needs the archived artifact verifier/)
  // Without a merge commit, and for a non-claim binding, the general path never opens.
  assert.throws(()=>validateOriginalPreviewApplyEvidence({...input,mergeCommitSha:null},hashBoundClaimApplyIo()),/found 0/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,hashBoundClaimApplyIo({rehearsalMode:'merged-main-rehearsal'})),/found 0/)
})

// #2729 / #401 Step 6: every rejected candidate names the condition it failed.
test('a claim-mode apply whose merged migration hash differs refuses and names the mismatched condition',()=>{
  const input={issue:2509,pr:2513,versions:['20260907131728'],mergeCommitSha:'c5f85ad3a98b7a5598e8c81a56735473d5bb5487'}
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({migrationBody:'select 1;\n'})),
    /found 0; rejected candidates: run 34157812748 \(preview-apply\): claim-mode migration hash mismatch: supabase\/migrations\/20260907131728_popsg_preview_stats_indexed_categories\.sql at merge commit c5f85ad3/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({appliedCommit:'a'.repeat(40)})),/run 34157812748 \(preview-apply\): claim-mode applied commit a{40} is not the registered bcc26039/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({previewProject:'wrong-preview'})),/\(preview-apply\): binding preview project is wrong-preview/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence({...input,versions:['20260907131729']},pinnedHistoricalClaimApplyIo()),/binding allowlist \["20260907131728"\] is not the expected versions \["20260907131729"\]/)
  // The same run is also judged, and rejected, as a reconciliation candidate.
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,pinnedHistoricalClaimApplyIo({migrationBody:'select 1;\n'})),/run 34157812748 \(preview-ledger-reconciliation\): workflow path is \.github\/workflows\/shared-supabase-migrations\.yml/)
})

test('every rejected preview-evidence candidate reports its failed condition, unreadable ones included',()=>{
  const input={issue:1769,pr:1809,versions:['20260828232207'],mergeCommitSha:'b'.repeat(40)}
  const refusal=(io)=>{try{validateOriginalPreviewApplyEvidence(input,io)}catch(error){return error.message}assert.fail('expected a refusal')}
  assert.match(refusal({...immutablePreviewApplyIo(),issueComments:()=>[]}),/found 0; no candidate run was linked from the issue$/)
  assert.match(refusal(immutablePreviewApplyIo({artifactRunId:'33308168017'})),/run 33308168016 \(preview-apply\): artifact belongs to run 33308168017/)
  assert.match(refusal(immutablePreviewApplyIo({mergeCommitSha:'c'.repeat(40)})),/run 33308168016 \(preview-apply\): binding is neither a merged-main rehearsal of pull request #1809/)
  const noDigest=immutablePreviewApplyIo();noDigest.previewApplyRun=()=>{const evidence=immutablePreviewApplyIo().previewApplyRun();delete evidence.artifacts.artifacts[0].digest;return evidence}
  assert.match(refusal(noDigest),/\(preview-apply\): preview apply artifact has no sha256 digest/)
  const noDelta=immutablePreviewApplyIo();noDelta.previewApplyRun=()=>({...immutablePreviewApplyIo().previewApplyRun(),logs:immutablePreviewApplyIo().previewApplyRun().logs.replace('- added: 20260828232207','- added: (none)')})
  assert.match(refusal(noDelta),/\(preview-apply\): ledger delta added \[\], not exactly the expected versions \["20260828232207"\]/)
  const unreadable=immutablePreviewApplyIo();unreadable.previewApplyRun=()=>{throw new Error('HTTP 404 run not found')}
  const message=refusal(unreadable)
  assert.match(message,/run 33308168016 \(preview-apply\): unreadable candidate: HTTP 404 run not found/)
  assert.match(message,/run 33308168016 \(preview-ledger-reconciliation\): unreadable candidate: HTTP 404 run not found/)
  const failedDownstream=immutablePreviewApplyIo(),evidence=failedDownstream.previewApplyRun();evidence.run.conclusion='failure';evidence.jobs=downstreamPromotionFailureJobs({preview:'failure'})
  assert.match(refusal({...failedDownstream,previewApplyRun:()=>evidence}),/\(preview-apply\): conclusion is failure without a proven preview success/)
  const archived=immutablePreviewApplyIo(),archivedEvidence=archived.previewApplyRun();archivedEvidence.artifacts.artifacts[0].id=456;archivedEvidence.logs=archivedEvidence.logs.replaceAll('Report the preview ledger delta','UNKNOWN STEP')
  assert.match(refusal({...archived,previewApplyRun:()=>archivedEvidence}),/\(preview-apply\): logs have no named preview ledger delta step and no archived artifact verifier is available/)
  assert.match(refusal({...archived,previewApplyRun:()=>archivedEvidence,verifyPreviewApplyArtifact:(request)=>({verified:true,runId:request.run.id,artifactId:457,artifactDigest:request.artifact.digest,versions:request.versions})}),/\(preview-apply\): archived artifact receipt did not verify \(verified=true, run 33308168016, artifact 457/)
  // A run linked twice is one candidate; acceptance is unchanged.
  const twice=immutablePreviewApplyIo();twice.issueComments=()=>[{body:'https://github.com/u2giants/shared-db/actions/runs/33308168016 and - apply `33308168016` — success'}]
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,twice),{type:'preview-apply',run_id:'33308168016'})
})

test('rejected reconciliation candidates name the failed condition',()=>{
  const input={issue:1722,pr:1748,versions:['20260830013942'],mergeCommitSha:'b'.repeat(40)}
  const refusal=(io,given=input)=>{try{validateOriginalPreviewApplyEvidence(given,io)}catch(error){return error.message}assert.fail('expected a refusal')}
  assert.deepEqual(validateOriginalPreviewApplyEvidence(input,immutablePreviewReconciliationIo()),{type:'preview-ledger-reconciliation',run_id:'33307904277',orphan_version:'20260828113920',replacement_version:'20260830013942'})
  assert.match(refusal(immutablePreviewReconciliationIo({sourcePr:9999})),/run 33307904277 \(preview-ledger-reconciliation\): logs do not record SOURCE_PR: 1748/)
  assert.match(refusal(immutablePreviewReconciliationIo({relation:'behind'})),/\(preview-ledger-reconciliation\): run head 75a6e35e[0-9a-f]+ is not at or after merge commit b{40} \(comparison behind\)/)
  assert.match(refusal(immutablePreviewReconciliationIo({replacement:'20260828113920'})),/\(preview-ledger-reconciliation\): reconciliation is a same-version reset of 20260828113920, not a rename/)
  assert.match(refusal(immutablePreviewReconciliationIo(),{...input,versions:['20260830013942','20260830013943']}),/\(preview-ledger-reconciliation\): reconciliation evidence covers exactly one version, not 2/)
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
  return {record,runId,artifactId,artifactDigest,refs,evidence,io:{flowAdapter:()=>flow,previewApplyRun:()=>evidence},...overrides}
}

function historicalTerminalArgs(fixture){return ['--terminalize-historical-preview-ready',fixture.record.ready_id,'--issue','2509','--run-id',fixture.runId,'--artifact-id',fixture.artifactId,'--artifact-digest',fixture.artifactDigest,'--manifest-digest',fixture.record.manifest_digest]}

test('the GitHub-backed CLI terminalizes the exact no-write historical recovery once with immutable readback',()=>{
  const fixture=historicalTerminalIo(),printed=[],log=console.log;console.log=(line)=>printed.push(line)
  try{assert.equal(main(historicalTerminalArgs(fixture),NOW,fixture.io),0);assert.equal(main(historicalTerminalArgs(fixture),NOW,fixture.io),0)}finally{console.log=log}
  const ref=`refs/db-preview-ready-outcomes/${fixture.record.ready_id}`,outcome=fixture.refs.get(ref)
  assert.equal(outcome.digest,'dispatched');assert.equal(outcome.record.outcome,'dispatched');assert.deepEqual(outcome.record.proof,{positive:true,mode:'apply',run_id:fixture.runId,artifact_id:fixture.artifactId,artifact_digest:fixture.artifactDigest,manifest_digest:fixture.record.manifest_digest,ledger_rows:626})
  assert.equal(JSON.parse(printed[0]).ref,ref)
})

test('historical recovery accepts its exact preview artifact alongside automatic review evidence',()=>{
  const fixture=historicalTerminalIo(),preview=fixture.evidence.artifacts.artifacts[0]
  fixture.evidence.artifacts.artifacts.push({
    id:preview.id+1,name:'automatic-production-apply-review-evidence',
    digest:`sha256:${'a'.repeat(64)}`,expired:false,
    workflow_run:{id:Number(fixture.runId),head_sha:fixture.record.route_context},
  })
  fixture.evidence.artifacts.total_count=2
  const log=console.log;console.log=()=>{}
  try{assert.equal(main(historicalTerminalArgs(fixture),NOW,fixture.io),0)}finally{console.log=log}
  const outcome=fixture.refs.get(`refs/db-preview-ready-outcomes/${fixture.record.ready_id}`)
  assert.equal(outcome.record.proof.artifact_id,fixture.artifactId)
  assert.equal(outcome.record.proof.artifact_digest,fixture.artifactDigest)
})

test('historical recovery refuses unknown, duplicate, expired, or cross-run extra artifacts',()=>{
  const mutations=[
    (extra)=>{extra.name='unexpected-artifact'},
    (extra,preview)=>{extra.name=preview.name},
    (extra)=>{extra.expired=true},
    (extra)=>{extra.workflow_run.id++},
    (extra)=>{extra.workflow_run.head_sha='f'.repeat(40)},
    (extra)=>{extra.digest='not-a-digest'},
    (extra,preview)=>{extra.id=preview.id},
    (extra)=>{delete extra.id},
  ]
  const error=console.error;console.error=()=>{}
  try{for(const mutate of mutations){
    const fixture=historicalTerminalIo(),preview=fixture.evidence.artifacts.artifacts[0]
    const extra={id:preview.id+1,name:'automatic-production-apply-review-evidence',digest:`sha256:${'a'.repeat(64)}`,expired:false,workflow_run:{id:Number(fixture.runId),head_sha:fixture.record.route_context}}
    mutate(extra,preview)
    fixture.evidence.artifacts.artifacts.push(extra)
    fixture.evidence.artifacts.total_count=2
    assert.equal(main(historicalTerminalArgs(fixture),NOW,fixture.io),2)
    assert.equal(fixture.refs.has(`refs/db-preview-ready-outcomes/${fixture.record.ready_id}`),false)
  }}finally{console.error=error}
  for(const broken of ['missing-page','third-artifact']){
    const fixture=historicalTerminalIo(),preview=fixture.evidence.artifacts.artifacts[0]
    fixture.evidence.artifacts.artifacts.push({id:preview.id+1,name:'automatic-production-apply-review-evidence',digest:`sha256:${'a'.repeat(64)}`,expired:false,workflow_run:{id:Number(fixture.runId),head_sha:fixture.record.route_context}})
    fixture.evidence.artifacts.total_count=2
    if(broken==='missing-page')fixture.evidence.artifacts.total_count=3
    else fixture.evidence.artifacts.artifacts.push({id:preview.id+2,name:'unexpected-artifact',expired:false,workflow_run:{id:Number(fixture.runId),head_sha:fixture.record.route_context}})
    const error=console.error;console.error=()=>{}
    try{assert.equal(main(historicalTerminalArgs(fixture),NOW,fixture.io),2)}finally{console.error=error}
    assert.equal(fixture.refs.has(`refs/db-preview-ready-outcomes/${fixture.record.ready_id}`),false)
  }
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
  assert.throws(()=>deriveLivePreviewCandidate(1769,mergedRehearsalIo({migrationBody:'create table plm.wwe_property();\ncreate table plm.undeclared();'}).io),/not all covered by claim #1805 writes/)
  // #3418: a claim that over-declares (superset of the SQL's writes) may rehearse; an unclaimed write still refuses.
  assert.equal(deriveLivePreviewCandidate(1769,mergedRehearsalIo({writes:['table plm.wwe_property','table plm.extra_locked']}).io).pr,1809)
  assert.throws(()=>deriveLivePreviewCandidate(1769,mergedRehearsalIo({writes:['table plm.other']}).io),/not all covered by claim #1805 writes/)
  // #3437: an empty claim still refuses before preview preparation can proceed.
  assert.throws(()=>deriveLivePreviewCandidate(1769,mergedRehearsalIo({writes:[]}).io),/at least one exact object to write/)
  assert.equal(deriveLivePreviewCandidate(1769,mergedRehearsalIo().io).pr,1809)
  { const noScope=mergedRehearsalIo().io; noScope.getIssue=()=>({body:'no scope fence here'}); assert.throws(()=>deriveLivePreviewCandidate(1769,noScope),/issue #1769 has no db-work-scope block; add exactly one before preparing preview dispatch/) }
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
  const {readyRecord}=await import('./db-flow/reconcile.mjs')
  const {io,mainSha}=mergedRehearsalIo()
  const record=readyRecord(deriveLivePreviewCandidate(1769,io))
  assert.equal(record.route,'merged_rehearsal')
  assert.equal(record.route_context,mainSha)
  assert.match(record.ready_id,/^[0-9a-f]{64}$/)
})

test('the reconciler refuses a merged rehearsal that names a live author claim',async()=>{
  const {readyRecord,ReconcileError}=await import('./db-flow/reconcile.mjs')
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










test('replacement ref namespaces are matched exactly, never by prefix (issue #1832)',()=>{
  const base='refs/db-review-replacements/1832-1823-abc'
  assert.ok(inReviewReplacementNamespace(`${base}-516`,base))
  assert.equal(inReviewReplacementNamespace(`${base}-slot2-516`,base),false,'a slot-2 link must not be read as a slot-1 one')
  assert.ok(inReviewReplacementNamespace(`${base}-slot2-516`,`${base}-slot2`))
  assert.equal(inReviewReplacementNamespace(base,base),false,'the legacy unsuffixed ref is handled separately, not as a link')
  assert.equal(inReviewReplacementNamespace('refs/db-review-replacements/1832-18230-1',base),false)
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



// ISSUE: EXCLUDING THE HOLDER OF THE CURRENT HEAD'S ASSIGNMENT DEADLOCKED THE PR.
//
// Live instance: issue #1999 / PR #2002, reviewer muse-spark-1.2-contributor
// excluded for `independence-conflict` while it held the assignment ref for head
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







test('a reviewer return record is parsed strictly and fails closed',()=>{
  const reviewer=ACTIVE_REVIEWERS[0].name,head='a'.repeat(40),assignmentSha='b'.repeat(40)
  const message=`db-coordination reviewer-return reviewer=${reviewer} issue=1999 pr=2002 head=${head} slot=1 assignment=${assignmentSha} reason=independence-conflict`
  // A record written before the cursor sequence was carried still parses, and
  // says so honestly with sequence null, rather than inventing an order.
  assert.deepEqual(parseReviewReturn({message}),{reviewer,issue:1999,pr:2002,headSha:head,slot:1,assignmentSha,sequence:null,replacementSequence:null,reason:'independence-conflict'})
  const sequenced=message.replace(' reason=',' sequence=9 reason=')
  assert.deepEqual(parseReviewReturn({message:sequenced}),{reviewer,issue:1999,pr:2002,headSha:head,slot:1,assignmentSha,sequence:9,replacementSequence:null,reason:'independence-conflict'})
  // The replacement form carries the sequence of the record it retires, because
  // a slot's history is ordered and the merge gate has to compare against it.
  const replacementMessage=message.replace(' reason=',' sequence=9 replacement=2 reason=')
  assert.deepEqual(parseReviewReturn({message:replacementMessage}),{reviewer,issue:1999,pr:2002,headSha:head,slot:1,assignmentSha,sequence:9,replacementSequence:2,reason:'independence-conflict'})
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' sequence=0 reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' sequence=x reason=')}),/malformed/)
  // Order matters: `replacement=` before `sequence=` is not the recorded form.
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' replacement=2 sequence=9 reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' replacement=0 reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(' reason=',' replacement=x reason=')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(reviewer,'unknown-reviewer')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace('reason=independence-conflict','reason=because-i-said-so')}),/malformed/)
  assert.throws(()=>parseReviewReturn({message:message.replace(`head=${head}`,'head=not-a-sha')}),/malformed/)
  assert.equal(reviewReturnRef({issue:1999,pr:2002,headSha:head,slot:2,assignmentSha}),`${REVIEW_RETURN_REF_PREFIX}/1999-2002-${head}-slot2-${assignmentSha}`)
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




test('the generation suffix can never collide with a reviewer name',()=>{
  for(const {name} of REVIEWERS)assert.doesNotMatch(name,/-gen\d+$/i,`reviewer ${name} would collide with the exclusion generation ref suffix`)
  assert.throws(()=>reviewExclusionRef({issue:1,pr:2,reviewer:'x-gen2'}),/collides with the exclusion generation ref suffix/)
  assert.throws(()=>reviewExclusionRef({issue:1,pr:2,reviewer:ACTIVE_REVIEWERS[0].name,generation:REVIEW_EXCLUSION_GENERATION_LIMIT+1}),/generation must be an integer/)
  assert.equal(reviewExclusionRef({issue:1,pr:2,reviewer:'grok-4.6'}),`${REVIEW_EXCLUSION_REF_PREFIX}/1-2-grok-4.6`,'generation 1 must keep the historical ref name exactly')
  assert.equal(reviewReinstatementRef({issue:1,pr:2,reviewer:'grok-4.6'}),`${REVIEW_REINSTATEMENT_REF_PREFIX}/1-2-grok-4.6`)
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
  assert.throws(()=>pendingRequiredContexts([],green),/policy has no checks/)
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
  assert.match(error.message,/a claim-first session identity is not the work issue/)
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
  // Issue #3349: the transient path now throws a cause-carrying error that names
  // the real reason and the retry, instead of a bare null. The refusal is unchanged.
  assert.throws(()=>findBusyReviewers(leaseListingIo(transient)),/transient lease snapshot read failure.*HTTP 502.*Retry the operation/)
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







// Issue #2711: abandoned assignment-keyed leases need a governed reaper.
function abandonedLeaseIo(){
  const io=withAtomicRefs(reviewIo()),heads=new Map(),prs=new Map()
  io.atomicReviewMutexRelease=(ownerSha)=>io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  io.getPr=(number)=>prs.get(Number(number))
  io.readReviewStates=(rows)=>new Map(rows.map((row)=>[`${row.issue}:${row.pr}`,{issue:{state:'open'},pr:io.getPr(row.pr),evidence:[]}]))
  io.readActiveReviewLeases=()=>new Map([...io.refs].filter(([ref])=>ref.startsWith('refs/db-review-active-v2/')).map(([ref,sha])=>[ref,{sha,commit:io.getCommit(sha)}]))
  const lease=(index,{issue,pr,headSha,state='open',current=headSha,verdict=false})=>{
    const reviewer=ACTIVE_REVIEWERS[index%ACTIVE_REVIEWERS.length].name
    const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${index+1} reviewer=${reviewer} issue=${issue} pr=${pr} head=${headSha}`)
    const ref=reviewActiveRef(reviewer,{issue,pr,headSha,slot:1})
    io.refs.set(ref,sha);prs.set(pr,{number:pr,state,head:{sha:current}})
    if(verdict)giveVerdict(io,{issue,pr,headSha})
    return ref
  }
  return {io,lease,prs}
}




// Issue #3449: a legacy v1 lease whose PR merged with a recorded verdict is terminal.
function legacyLeaseIo(){
  const base=abandonedLeaseIo(),{io,prs}=base
  io.requiresExactReviewHeadSha=true
  io.readActiveReviewLeases=()=>new Map([...io.refs].filter(([ref])=>ref.startsWith('refs/db-review-active')).map(([ref,sha])=>[ref,{sha,commit:io.getCommit(sha)}]))
  const legacy=(index,{issue,pr,headSha,state='closed',merged=true,verdict=true,mergedHead=headSha,verdictHead=headSha})=>{
    const reviewer=ACTIVE_REVIEWERS[index%ACTIVE_REVIEWERS.length].name
    const sha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${index+1} reviewer=${reviewer} issue=${issue} pr=${pr} head=${headSha}`)
    const ref=reviewActiveRef(reviewer)
    io.refs.set(ref,sha);prs.set(pr,{number:pr,state,merged,head:{sha:mergedHead}})
    if(verdict)giveVerdict(io,{issue,pr,headSha:verdictHead})
    return ref
  }
  return {...base,legacy}
}












test('DELIVERY PREFLIGHT (#2728): --delivery-preflight runs and registers a preflight without GitHub access, and refuses without its inputs', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'lane-delivery-preflight-'))
  const priorRoot=process.env.DELIVERY_EVIDENCE_REGISTRY_ROOT
  try {
    const head='a'.repeat(40),identity={policy_version:1,migrations:[],focused_files:[],verification_files:[],claims:{writes:[],reads:[]},global_invalidators:[],migration_order_digest:'0'.repeat(64)}
    const bundle={schema_version:1,bundle_id:sha256(canonicalJson(identity)),identity,metadata:{issue:41,pr:7,claim:1,base_main_sha:'b'.repeat(40),integration_sha:head,review:null,ci:null}}
    const names=['route','work_contract','object_collision','dependencies','sidecars','producers','migration_order','reviewer_capacity','runner_capacity']
    const checks=Object.fromEntries(names.map((name)=>[name,{status:'PASS',evidence_id:`${name}-evidence`}]))
    const registry=path.join(dir,'registry');mkdirSync(registry)
    for(const kind of ['sidecars','producers']){
      const registration={evidence_id:checks[kind].evidence_id,kind,issue:41,pr:7,head_sha:head,producer_id:`${kind}-producer`,artifact_digest:'d'.repeat(64)}
      Object.assign(checks[kind],{producer_id:registration.producer_id,artifact_digest:registration.artifact_digest,registry_digest:sha256(canonicalJson(registration))})
      writeFileSync(path.join(registry,`registration-${createHash('sha256').update(registration.evidence_id).digest('hex')}.json`),JSON.stringify(registration))
    }
    const inputFile=path.join(dir,'input.json'),bundleFile=path.join(dir,'bundle.json')
    writeFileSync(inputFile,JSON.stringify({issue:41,pr:7,head_sha:head,checks}));writeFileSync(bundleFile,JSON.stringify(bundle))
    process.env.DELIVERY_EVIDENCE_REGISTRY_ROOT=registry
    const touched=[],io=new Proxy({},{get(_,key){touched.push(String(key));throw new Error(`io.${String(key)} touched`)}})
    const out=[],errors=[],log=console.log,err=console.error;console.log=(line)=>out.push(String(line));console.error=(line)=>errors.push(String(line))
    let code,refused,missing
    try{
      code=main(['--delivery-preflight','--evidence-bundle',bundleFile,'--preflight-input',inputFile],NOW,io)
      refused=main(['--delivery-preflight','--evidence-bundle',bundleFile],NOW,io)
      missing=main(['--delivery-preflight','--preflight-input',inputFile],NOW,io)
    }finally{console.log=log;console.error=err}
    assert.equal(code,0,errors.join('\n'));assert.deepEqual(touched,[])
    const gate=JSON.parse(out.join('\n'))
    assert.equal(gate.status,'PASS');assert.equal(gate.reused,false);assert.equal(gate.record.input.head_sha,head)
    assert.deepEqual(gate.bundle.metadata.delivery_preflight,{preflight_id:gate.record.preflight_id,input_digest:gate.record.input_digest})
    assert.equal(refused,2);assert.equal(missing,2)
    assert.match(errors.join('\n'),/requires --preflight-input/);assert.match(errors.join('\n'),/requires --evidence-bundle/)
  } finally { if(priorRoot===undefined)delete process.env.DELIVERY_EVIDENCE_REGISTRY_ROOT;else process.env.DELIVERY_EVIDENCE_REGISTRY_ROOT=priorRoot;rmSync(dir,{recursive:true,force:true}) }
})

// Issue #2987: the verdict namespace reached its row ceiling and every reviewer
// operation refused as "active reviewer leases are unreadable".
function verdictArchiveIo(){
  const {io,lease,prs}=abandonedLeaseIo()
  io.listReviewRefsPaged=(prefix)=>[...io.refs.entries()].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha}))
  const merges=new Map()
  io.readPullStates=()=>new Map([...prs].map(([pr,row])=>[pr,{state:row.state==='open'?'open':'closed',merged:Boolean(row.merged),mergeCommitSha:row.mergeCommitSha??null,mergedAt:row.mergedAt??null}]))
  io.openPulls=()=>[...prs.values()].filter((row)=>row.state==='open')
  io.mergeTouchesMigrations=(sha)=>merges.has(sha)?merges.get(sha):null
  const pull=(pr,{state='closed',merged=false,migration,mergedAt=merged?'2026-09-14T12:00:00Z':null}={})=>{const mergeCommitSha=merged?pr.toString(16).padStart(40,'9'):null;if(merged&&migration!==undefined)merges.set(mergeCommitSha,migration);prs.set(pr,{number:pr,state,merged,mergedAt,mergeCommitSha,head:{sha:'f'.repeat(40)}})}
  return {io,lease,prs,pull}
}



test('#3806 archived verdicts stay visible to closed-PR approval readers under their original names',()=>{
  const live={ref:'refs/db-review-verdicts/1-2-'+'c'.repeat(40),sha:'1'.repeat(40)}
  const archived={ref:'refs/db-review-archived-verdicts/db-review-verdicts/1-2-'+'d'.repeat(40)+'-slot2',sha:'2'.repeat(40)}
  const refs=new Map([[live.ref,live.sha],[archived.ref,archived.sha]])
  const base={listRefs:(prefix)=>[...refs].filter(([ref])=>ref.startsWith(prefix)).map(([ref,sha])=>({ref,sha})),marker(){return this===view}}
  const view=withArchivedVerdictMirror(base)
  assert.deepEqual(view.listRefs('refs/db-review-verdicts/1-2-').map((row)=>row.ref).sort(),[live.ref,'refs/db-review-verdicts/1-2-'+'d'.repeat(40)+'-slot2'].sort())
  assert.deepEqual(view.listRefs('refs/db-review-assignments/1-2-'),[],'non-verdict listings are untouched')
  assert.equal(view.marker(),true,'other io methods keep working through the view')
  refs.set('refs/db-review-archived-verdicts/db-review-verdicts/1-2-'+'c'.repeat(40),'3'.repeat(40))
  assert.throws(()=>view.listRefs('refs/db-review-verdicts/1-2-'),/exists live and archived with different objects/)
  refs.set('refs/db-review-archived-verdicts/db-review-verdicts/1-2-'+'c'.repeat(40),live.sha)
  assert.equal(view.listRefs('refs/db-review-verdicts/1-2-').length,2,'one object live and archived is one record')
  base.listRefs=((read)=>(prefix)=>prefix.includes('archived')?null:read(prefix))(base.listRefs)
  assert.throws(()=>withArchivedVerdictMirror(base).listRefs('refs/db-review-verdicts/1-2-'),/archived verdict mirror .* is unreadable/)
  const liveNull=withArchivedVerdictMirror({listRefs:(prefix)=>prefix.includes('archived')?[]:null})
  assert.throws(()=>liveNull.listRefs('refs/db-review-verdicts/1-2-'),/verdict listing .* is unreadable/,'an unreadable live listing is never masked by a readable archive')
})





test('#2987 classifier never archives a verdict whose ref it cannot parse',()=>{
  assert.deepEqual(classifyVerdictForArchive('refs/db-review-verdicts/garbage',{pulls:new Map(),leasedPrs:new Set(),touchesMigrations:()=>false}),{archive:false,reason:'unparseable-ref'})
  assert.throws(()=>archivedVerdictRef('refs/db-review-assignments/1-2-x'),/not a durable reviewer verdict ref/)
})


// A LEGACY CLAIM TITLE MUST NOT BLANK THE WHOLE READ-ONLY AUDIT. On 2026-09-16 the
// A LEGACY CLAIM TITLE MUST NOT BLANK THE WHOLE READ-ONLY AUDIT. On 2026-09-16 the
// live `--abandonment-audit` printed one refusal and nothing else, because claim
// #2871 was titled "CLAIM: issue-2870-cutover-columns" -- no `#` -- and the identity
// read threw out of the snapshot map before any lane was described. The hourly job
// that exists to show expiry therefore showed nothing about the other seven lanes.
test('a claim whose title names no work issue becomes one unreadable row, not a blank audit',()=>{
  const body=claimBody({version:'20260916010101',objects:['table plm.x'],owner:'agent/legacy',branch:'legacy/branch',worktree:'C:/repos/x',expiresAt:new Date('2026-09-14T00:00:00Z')})
  const legacy={number:2871,state:'open',title:'CLAIM: issue-2870-cutover-columns',body}
  const ambiguous={number:2872,state:'open',title:'CLAIM: #10 supersedes #11',body}
  const io={...githubIo,openClaims:()=>[legacy,ambiguous],openWorkIssues:()=>{throw new LaneError('not needed')},openIssueNumbers:()=>{throw new LaneError('not needed')}}
  const snapshot=io.flowSnapshot(new Date('2026-09-16T00:00:00Z'))
  assert.equal(snapshot.issues.length,2,'every open claim must still be described')
  for(const row of snapshot.issues){
    assert.equal(row.issue,null,'an unidentifiable claim has no work issue to report')
    assert.match(row.capacity_error??'',/must identify exactly one work issue/)
    assert.match(row.capacity_error??'',new RegExp(`claim #${row.claim}\\b`),'the row must name the claim an operator has to go and fix')
    assert.equal(row.preview_edge_satisfied,false,'an unreadable claim can never be reported preview-ready')
    assert.equal(row.preview_error,row.capacity_error)
  }
  assert.deepEqual(snapshot.issues.map((row)=>row.claim),[2871,2872])
})

// A REFUSAL ON --abandonment-audit IS UNVERIFIABLE, NOT EXPIRED. Every other
// command may exit 2 on a refusal, but on this one 2 already means "an expired
// author lane was found", so the generic handler filed every read failure as an
// expiry report about lanes it never read. Unverifiable outranks expiry, so the
// refusal now exits 3 -- and the other commands must keep exiting 2.
test('--abandonment-audit reports a refusal as unverifiable (3), not as an expiry (2)',()=>{
  const errors=[],originalError=console.error
  console.error=(line)=>errors.push(String(line))
  try{
    const noAdapter={...githubIo,flowSnapshot:()=>({issues:[]}),flowAdapter:null}
    assert.equal(main(['--abandonment-audit'],new Date('2026-09-16T00:00:00Z'),noAdapter),3,'a missing runtime adapter means the instrument could not read')
    const unreadable={...githubIo,flowAdapter:()=>({}),flowSnapshot:()=>{throw new LaneError('claim title must identify exactly one work issue for capacity transition events')}}
    assert.equal(main(['--abandonment-audit'],new Date('2026-09-16T00:00:00Z'),unreadable),3,'an unreadable snapshot means the instrument could not read')
    assert.equal(main([],new Date('2026-09-16T00:00:00Z'),githubIo),2,'every other refusal keeps the generic exit code')
  }finally{console.error=originalError}
  assert.equal(errors.filter((line)=>line.startsWith('REFUSED: ')).length,3,'the refusal message is still printed in full; only its exit code moves')
  assert.ok(errors.some((line)=>line.includes('must identify exactly one work issue')),'the operator must still be told what could not be read')
})

test('issue 3027 an urgent item waiting on capacity names the exact claims and objects it waits behind', () => {
  const result={queues:[{lane:1,active:12,protected:[14],queued:[30],objects:['table core.b','table core.a']}]}
  assert.equal(urgentHoldDetail(result,30),'waiting for claim #12, claim #14 on table core.a, table core.b; no active work was preempted')
  assert.deepEqual(urgentHoldReason(result,30),{kind:'claim',holder:'claim #12, claim #14',objects:['table core.a','table core.b']})
  assert.match(urgentHoldDetail(result,99),/holder not found/)
  assert.doesNotThrow(()=>validateHoldReasonRecord(urgentHoldReason(result,30)),'the queue-audit hold is a valid recorded hold_reason')
  assert.equal(urgentHoldReason(result,99),null)
  assert.equal(urgentHoldReason({queues:[{lane:1,active:12,queued:[30],objects:[]}]},30),null,'a hold with no shared object is not a named hold')
})

test('issue 3027 a claim hold is accepted only when the claim and held work share a conflicting object', () => {
  const io=memoryIo()
  const scopeBody=['```db-work-scope','status: ready','work_type: structural','route: claim-first','service_class: standard-application','change_type: migration','application_return_to: u2giants/example-app','live_assertion: authenticated create-and-read succeeds','generated_types: not-applicable','outcome_stage: entered','priority: 5','depends_on:','writes:','  - table core.mine','  - table core.shared','```'].join('\n')
  io.getIssue=(n)=>Number(n)===50?{number:50,state:'open',body:scopeBody}:{number:Number(n),state:'open',body:''}
  io.openClaims=()=>[{number:60,body:body(['table core.shared','table core.theirs'],'1','2099-01-01T00:00:00Z')}]
  assert.deepEqual(namedHold(50,'claim:#60',io),{kind:'claim',holder:'claim #60',objects:['table core.shared']})
  assert.deepEqual(namedHold(50,'object:#60:table core.shared',io),{kind:'object',holder:'claim #60',objects:['table core.shared']})
  assert.throws(()=>namedHold(50,'object:#60:table core.theirs',io),/do not conflict on/)
})

test('the no-progress alarm fallback label is a coordination label the queue audit excludes', async () => {
  const { COORDINATION_LABELS } = await import('./manage-migration-author-lanes.mjs')
  const { FALLBACK_LABEL } = await import('./db-flow/no-progress-alarm.mjs')
  assert.ok(COORDINATION_LABELS.has(FALLBACK_LABEL))
})

test('#2530: outcome evidence is never read from a repository other than this one', () => {
  assert.throws(() => githubIo.readOutcomeEvidence('https://github.com/attacker/shared-db/issues/1#issuecomment-5'), /outcome evidence refused: .*only this repository/)
  assert.throws(() => githubIo.readOutcomeEvidence('https://github.com/popcre/designflow-backend/pull/1#issuecomment-5'), /outcome evidence refused/)
  assert.throws(() => githubIo.readOutcomeEvidence('not a url'), /outcome evidence refused: evidence must be an exact GitHub/)
})














// Issue #3182: guarded --rebind-claim-worktree.
function rebindIo(overrides={}){
  const io=reversionIo()
  const target='C:/repos/shared-db/.claude/worktrees/issue-764-rebind-fresh'
  io.targetWorktree=target
  io.inspected=[]
  io.localClean=(worktree)=>{io.inspected.push(worktree);return true}
  io.localHead=(worktree)=>{io.inspected.push(worktree);return io.head}
  io.localBranch=(worktree)=>{io.inspected.push(worktree);return 'codex/issue-764-sequence-repair'}
  io.getPrFiles=()=>[{filename:`supabase/migrations/${io.old}_repair.sql`}]
  return Object.assign(io,overrides)
}
const rebindArgs={issue:764,claim:1056,pr:1047,owner:'issue_764_sequence_repair/session-1053',branch:'codex/issue-764-sequence-repair',worktree:'C:\\repos\\shared-db-worktrees\\issue-764-sequence-repair',targetWorktree:'C:/repos/shared-db/.claude/worktrees/issue-764-rebind-fresh',headSha:'a'.repeat(40)}










// ISSUE #2678 -- A HEALTHY REVIEWER MUST NOT LOOK LIKE A BROKEN MACHINE.
// On 2026-09-10 `ai-kimi` and `ai-muse` both refused governed reviews with
// `doctor could not be run (exit 1) and named no check -- this is a LOCAL
// dependency fault on this machine`. Neither was faulty: the wrapper exits 1
// before any check line when its own `AI_<PROVIDER>_CALLER` is unset, because
// credentialed execution never guesses its caller. These tests spawn a real
// wrapper shim with exactly that behaviour, so the probe is proved end to end.
import { unnamedDoctorFailure } from './manage-migration-author-lanes.mjs'

const callerWrapperDir=()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'reviewer-caller-'))
  const win=process.platform==='win32'
  const file=path.join(dir,win?'ai-muse.cmd':'ai-muse')
  writeFileSync(file,win
    ?'@echo off\r\nif "%AI_MUSE_CALLER%"=="" (\r\n echo AI_MUSE_CALLER must be set explicitly to codex or claude; credentialed execution never guesses the caller 1>&2\r\n exit /b 1\r\n)\r\necho auth : OK\r\n'
    :'#!/bin/sh\nif [ -z "$AI_MUSE_CALLER" ]; then\n  echo "AI_MUSE_CALLER must be set explicitly to codex or claude; credentialed execution never guesses the caller" >&2\n  exit 1\nfi\necho "auth : OK"\n')
  if(!win)execFileSync('chmod',['755',file])
  return dir
}

test('issue 2678: the doctor probe tells the wrapper who is calling, so a healthy reviewer passes',()=>{
  const dir=callerWrapperDir(), PATH_KEY=Object.keys(process.env).find((k)=>k.toLowerCase()==='path')??'PATH'
  const originalPath=process.env[PATH_KEY], originalCaller=process.env.AI_MUSE_CALLER, originalClaude=process.env.CLAUDECODE
  try{
    process.env[PATH_KEY]=`${dir}${path.delimiter}${originalPath}`
    delete process.env.AI_MUSE_CALLER
    process.env.CLAUDECODE='1'
    // BEFORE THE FIX this probe spawned the wrapper with no caller variable, the
    // wrapper refused, and the probe called a healthy reviewer a local fault.
    const doctor=githubIo.reviewerDoctor('ai-muse')
    assert.equal(doctor.ok,true,`doctor should pass with a detected caller; got ${JSON.stringify(doctor)}`)
    assert.deepEqual(doctor.failingChecks,[])
  }finally{
    process.env[PATH_KEY]=originalPath
    if(originalCaller===undefined)delete process.env.AI_MUSE_CALLER;else process.env.AI_MUSE_CALLER=originalCaller
    if(originalClaude===undefined)delete process.env.CLAUDECODE;else process.env.CLAUDECODE=originalClaude
    rmSync(dir,{recursive:true,force:true})
  }
})

test('issue 2678: an explicitly exported caller is never overruled by detection',()=>{
  const dir=callerWrapperDir(), PATH_KEY=Object.keys(process.env).find((k)=>k.toLowerCase()==='path')??'PATH'
  const originalPath=process.env[PATH_KEY], originalCaller=process.env.AI_MUSE_CALLER
  try{
    process.env[PATH_KEY]=`${dir}${path.delimiter}${originalPath}`
    process.env.AI_MUSE_CALLER='codex'
    assert.equal(githubIo.reviewerDoctor('ai-muse').ok,true)
  }finally{
    process.env[PATH_KEY]=originalPath
    if(originalCaller===undefined)delete process.env.AI_MUSE_CALLER;else process.env.AI_MUSE_CALLER=originalCaller
    rmSync(dir,{recursive:true,force:true})
  }
})

test('issue 2678: a doctor that names no check quotes the wrapper instead of blaming the machine',()=>{
  const said='AI_MUSE_CALLER must be set explicitly to codex or claude; credentialed execution never guesses the caller'
  const message=unnamedDoctorFailure('ai-muse',{status:1},`\n${said}\n`)
  assert.match(message,/doctor could not be run \(exit 1\)/)
  assert.match(message,/never guesses the caller/)
  assert.doesNotMatch(message,/named no check/)
  // Only when the wrapper truly said nothing does the old wording stand.
  assert.match(unnamedDoctorFailure('ai-muse',{status:1},''),/named no check/)
  // Wrapper diagnostics travel into refusals, so one line, length-capped.
  const long=unnamedDoctorFailure('ai-muse',{status:1},'x'.repeat(900))
  assert.equal(long.includes('\n'),false)
  assert.ok(long.length<400,`refusal text should be capped; got ${long.length}`)
})

// ---------------------------------------------------------------------------
// Issues #2448 (2), #3125 and #2491 -- migration-author-lane tooling repairs.
// Each test below was run against the UNFIXED script first and observed to
// fail; see the pull request body for the recorded failure lines.
// ---------------------------------------------------------------------------


// #3125. `--claim --objects` refused a valid claim whose writes were listed in a
// different order from the admitted issue's (already sorted) writes.
async function twoWriteAdmittedIo(){
  const {outcomeEvent}=await import('./db-flow/outcome-lifecycle.mjs')
  const {formatEventComment}=await import('./db-coordination-events.mjs')
  const {io}=admittedReviewIo()
  const body=['```db-work-scope','status: ready','work_type: structural','route: claim-first','service_class: standard-application','change_type: migration','application_return_to: u2giants/example-app','live_assertion: authenticated create-and-read succeeds','generated_types: not-applicable','outcome_stage: entered','priority: 5','depends_on:','writes:','  - table core.zeta','  - table core.alpha','```'].join('\n')
  io.getIssue=()=>({number:41,state:'open',title:'ordered writes',body,createdAt:'2026-09-11T00:00:00Z'})
  io.getPrFiles=()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added',content:'create table core.zeta(id bigint);create table core.alpha(id bigint);'}]
  io.getFileAt=()=> 'create table core.zeta(id bigint);create table core.alpha(id bigint);'
  const history=['entered','classified','dispatched'].map((state,index)=>({author_association:OPERATOR_ASSOCIATION,author:'u2giants',body:formatEventComment(outcomeEvent({issue:41,state,actor:'test',timestamp:new Date(Date.UTC(2026,8,11,0,index)).toISOString(),evidenceUrls:state==='dispatched'?['artifact:dispatch-fixture-2929']:[]}))}))
  io.issueComments=()=>history
  io.commentIssue=()=>{}
  return io
}

// #2491. An ordinary claim apply binds and names its artifact after the CLAIM
// head it checked out, never the dispatch run head, so preparation could never
// match a version that was already applied.
test('#2491 an already-applied version matches its original claim-head apply when the caller proves that head',()=>{
  const appliedCommit='bcc2603977678db73b4ca12d3ed1312a1bff64e2'
  const input={issue:2491,pr:2500,versions:['20260907131728'],mergeCommitSha:null}
  const io=pinnedHistoricalClaimApplyIo()
  assert.deepEqual(
    validateOriginalPreviewApplyEvidence({...input,claimHeadSha:appliedCommit},io),
    {type:'preview-apply',run_id:'34157812748'},
    'the claim-head apply is the evidence; preparation must accept it')
  // Nothing is relaxed. Without a proven claim head the old refusal stands, a
  // different proven head refuses, and a non-claim binding is never admitted
  // on this path.
  assert.throws(()=>validateOriginalPreviewApplyEvidence(input,io),/found 0|no acceptable/)
  assert.throws(()=>validateOriginalPreviewApplyEvidence({...input,claimHeadSha:'c'.repeat(40)},io),/found 0|no acceptable/)
  // Muse review of #3322: the old negative-path assertion refused on allowlist
  // mismatch rather than isolating the rehearsalMode gate. Pin that gate
  // directly: a binding with the CORRECT allowlist, the CORRECT applied commit
  // and the proven claim head still refuses when it is not claim-mode.
  const nonClaim={...pinnedHistoricalClaimApplyIo(),previewApplyRun:()=>{
    const evidence=pinnedHistoricalClaimApplyIo().previewApplyRun()
    const binding=JSON.parse(String(evidence.logs).match(/\{"allowlist".*?\}/)[0])
    evidence.logs=evidence.logs.replace(JSON.stringify(binding),JSON.stringify({...binding,rehearsalMode:'merged-main-rehearsal'}))
    return evidence
  }}
  assert.throws(
    ()=>validateOriginalPreviewApplyEvidence({...input,claimHeadSha:appliedCommit},nonClaim),
    /is not claim/,
    'a non-claim binding must refuse on the claim-head path even when every other identity matches')
  // And a claim-mode binding whose applied commit is NOT the proven head still
  // refuses -- the head gate is real, not decorative.
  const wrongHead=pinnedHistoricalClaimApplyIo({appliedCommit:'a'.repeat(40)})
  assert.throws(
    ()=>validateOriginalPreviewApplyEvidence({...input,claimHeadSha:appliedCommit},wrongHead),
    /does not equal the proven claim head/,
    'a claim-mode binding at a different head must refuse and name the head condition')
})

// ISSUE #2998 item 3 — READINESS IS ASSERTED BEFORE THE DRAW, NOT AFTER IT.
//
// Observed: a merge was declined twice with no reason given; the real cause was that
// the PR was still a DRAFT, and two reviewer draws were spent discovering it. This
// drives the real CLI branch, exactly as the #2102 guard above does, because a guard
// that no test drives can be deleted from the CLI without failing CI.
//
// It also proves the guard REFUSES rather than approves: the draw must never be
// reached, and a refusal is never recorded as a verdict.
import { assertReviewerDrawReadiness } from './manage-migration-author-lanes.mjs'
function readinessRun(pr){
  let drew=false
  const io={
    pullRequestFiles(){return [{filename:'supabase/migrations/20260920000000_x.sql'}]},
    getPr(){return pr},
    listIssues(){drew=true;throw new Error('the reviewer draw must not be reached')}
  }
  const errors=[],original=console.error
  console.error=(message)=>errors.push(String(message))
  let code
  try{code=main(['--assign-reviewer','--issue','2998','--pr','2112','--head-sha','d'.repeat(40)],NOW,io)}
  finally{console.error=original}
  return {code,stderr:errors.join('\n'),drew}
}




// A MERGED pull request must still be drawable. Issue #2915 (cdc74cb5, 3cef6b68) exists
// so a merged PR bound by the verified merged-PR issue binding can be assigned a
// reviewer and receive an exact-head verdict. The readiness guard must not undo that.
test('#3338 review: readiness does not refuse a merged pull request (#2915 stays delivered)',()=>{
  assert.deepEqual(assertReviewerDrawReadiness(1,{getPr:()=>({draft:false,mergeable:true,state:'closed',merged_at:'2026-09-14T00:00:00Z'})}),{draft:false,mergeable:true})
  assert.deepEqual(assertReviewerDrawReadiness(1,{getPr:()=>({draft:false,mergeable:null,state:'closed'})}),{draft:false,mergeable:null})
})

// Issue #3348 — a closed-and-UNMERGED pull request refuses before the draw; merged,
// open, and payloads carrying no merge fields are unchanged.
test('#3348: readiness refuses a closed unmerged pull request and nothing else',()=>{
  const r=(live)=>assertReviewerDrawReadiness(7,{getPr:()=>live})
  assert.throws(()=>r({draft:false,mergeable:true,state:'closed',merged:false,merged_at:null}),/CLOSED without being merged/)
  assert.throws(()=>r({draft:false,mergeable:null,state:'closed',merged_at:null}),/CLOSED without being merged/)
  assert.deepEqual(r({draft:false,mergeable:true,state:'closed',merged:true,merged_at:'2026-09-14T00:00:00Z'}),{draft:false,mergeable:true})
  assert.deepEqual(r({draft:false,mergeable:true,state:'open',merged:false,merged_at:null}),{draft:false,mergeable:true})
  assert.deepEqual(r({draft:false,mergeable:null,state:'closed'}),{draft:false,mergeable:null})
})



// Issue #2836. A same-repo `return_to` filed the reject back into this queue and
// the already-returned guard (comments only) never saw the copy, so every
// generation minted the next one. The loop is bounded here: without the guard
// this test runs to the bound and fails instead of hanging the suite.
test('a same-repo return_to cannot mint an endless chain of returned copies (#2836)',()=>{
  const RETURN_LOOP_BOUND=8
  const issues=new Map()
  const body=scope('ready','application-data','application-session',6)
    .replace('route: application-session',`route: application-session\nreturn_to: ${REPO}`)
  issues.set(700,{number:700,title:'source rows are wrong',body,state:'open'})
  const comments=new Map([[700,[]]])
  let next=701
  const io={
    getIssue:(n)=>issues.get(n),
    getIssueComments:(n)=>comments.get(n)??[],
    createIssueIn:(repo,title,newBody)=>{
      assert.equal(repo,REPO)
      const number=next++
      issues.set(number,{number,title,body:newBody,state:'open'})
      comments.set(number,[])
      return `https://github.com/${repo}/issues/${number}`
    },
    commentIssue:(n,b)=>comments.get(n).push({body:b}),
    closeIssue:(n)=>{issues.get(n).state='closed'},
  }
  let current=700, generations=0, stopped=null
  while(generations<RETURN_LOOP_BOUND){
    let result
    try { result=returnIssueToOwner(current,io) }
    catch(error){ stopped=error; break }
    generations++
    current=Number(result.url.split('/').pop())
  }
  assert.ok(stopped,`returning kept minting copies for ${RETURN_LOOP_BOUND} generations; the return loop is unbounded`)
  assert.match(stopped.message,/returned copy/)
  assert.equal(generations,1)
  assert.equal(issues.size,2)
})

test('an already-filed returned copy is recognised by its legacy provenance line (#2836)',()=>{
  const legacy=`Returned from ${REPO}#2619 by the shared-db orchestrator.\n\nOriginal issue: https://github.com/${REPO}/issues/2619`
  assert.match(returnedCopyProvenance(legacy),/^Returned from/)
  assert.equal(returnedCopyProvenance(`${RETURNED_COPY_MARKER} https://github.com/${REPO}/issues/1`),`${RETURNED_COPY_MARKER} https://github.com/${REPO}/issues/1`)
  assert.equal(returnedCopyProvenance(scope('ready','application-data','application-session',6)),null)
})

test('the queue audit stops asking for a return address on an already-returned copy (#2836)',()=>{
  // The PRODUCTION copy shape: #2690/#2691/#2692 open with the legacy provenance
  // sentence and carry a return_to of their own inside the embedded original.
  const legacyCopy=[
    `Returned from ${REPO}#2619 by the shared-db orchestrator.`,
    '',
    `Original issue: https://github.com/${REPO}/issues/2619`,
    '',
    '---',
    '',
    scope('ready','source-data','source-data-session',100).replace('route: source-data-session',`route: source-data-session\nreturn_to: ${REPO}`),
  ].join('\n')
  const newCopy=[
    `Returned from ${REPO}#2619 by the shared-db orchestrator.`,
    `${RETURNED_COPY_MARKER} https://github.com/${REPO}/issues/2619`,
    '',
    scope('ready','source-data','source-data-session',100),
  ].join('\n')
  for(const [number,body,pattern] of [[2692,legacyCopy,/^Returned from/],[2693,newCopy,/RETURNED COPY OF/]]){
    const result=buildDynamicQueues([{number,title:'copy',body}],[],NOW,[number])
    const row=result.notOrchestratorWork.find((item)=>item.issue===number)
    assert.equal(row.exit,'reject')
    assert.equal(row.needsReturnAddress,false)
    assert.match(row.returnedCopyOf,pattern)
  }
})

test('provenance is read at the head of the body, never from a quoted example (#2836)',()=>{
  const quoting=['A fresh reject that QUOTES the sentence in its description:','','```',`Returned from ${REPO}#2619 by the shared-db orchestrator.`,'```','',scope('ready','application-data','application-session',6)].join('\n')
  assert.equal(returnedCopyProvenance(quoting),null)
  const io={
    getIssue:()=>({number:80,title:'t',body:quoting.replace('route: application-session','route: application-session\nreturn_to: u2giants/popdam3'),state:'open'}),
    getIssueComments:()=>[],
    createIssueIn:()=>'https://github.com/u2giants/popdam3/issues/12',
    commentIssue:()=>{},
    closeIssue:()=>{},
  }
  assert.equal(returnIssueToOwner(80,io).url,'https://github.com/u2giants/popdam3/issues/12')
})

// --- popcre/ai-devops#498 item 12 (issue #3050) -----------------------------
//
// A wrong-owner refusal must still REFUSE. These tests assert the exit code is
// still 2 and that nothing closed, AND assert the MESSAGE TEXT, so the wording
// cannot silently regress back to the bare "belongs to a different owner".
function refusalText(argv, io, now = NOW) {
  const messages = [], oldError = console.error, oldLog = console.log
  console.error = (value) => messages.push(String(value))
  console.log = () => {}
  let code
  try { code = main(argv, now, io) } finally { console.error = oldError; console.log = oldLog }
  return { code, text: messages.join('\n') }
}





// --- issue #2824 hole 1: the sanctioned scope-status writer -----------------
function scopeBody(status, dependsOn = '') {
  return ['Some prose.', '', '```db-work-scope', `status: ${status}`, 'work_type: repo-maintenance', 'route: repo-maintenance', 'priority: 80', `depends_on:${dependsOn ? ` ${dependsOn}` : ''}`, '```', ''].join('\n')
}

function scopeIo(status = 'blocked', { dependsOn = '', states = {} } = {}) {
  const io = memoryIo()
  let current = scopeBody(status, dependsOn)
  io.comments = []
  io.getIssue = () => ({ number: 4242, state: 'open', body: current })
  io.updateIssue = (_n, patch) => { current = patch.body }
  io.commentIssue = (_n, text) => { io.comments.push(text) }
  io.dependencyStates = () => states
  io.currentBody = () => current
  return io
}

test('#2824 --set-scope-status writes exactly the status field, reads it back, and leaves an audit comment', () => {
  const io = scopeIo('blocked')
  const result = setScopeStatus({ issue: 4242, status: 'ready', reason: 'the blocking dependency merged' }, NOW, io)
  assert.equal(result.previousStatus, 'blocked')
  assert.equal(result.status, 'ready')
  assert.equal(parseQueueScope(io.currentBody()).status, 'ready')
  // EXACTLY ONE FIELD moved.
  const before = scopeBody('blocked').split('\n'), after = io.currentBody().split('\n')
  assert.equal(before.length, after.length)
  assert.deepEqual(before.map((line, i) => i).filter((i) => before[i] !== after[i]), [3])
  assert.equal(io.comments.length, 1)
  assert.match(io.comments[0], /status` changed from `blocked` to `ready`/)
  assert.match(io.comments[0], /reason: the blocking dependency merged/)
  assert.match(io.comments[0], /It is not a completion record and it releases no dependent task\./)
  assert.equal(io.refs.has(MUTEX_REF), false, 'the mutex must be released')
})

test('#2824 --set-scope-status refuses ready while a dependency is unsatisfied, and writes nothing', () => {
  // #99 is CLOSED but carries no db-work-completion record: closure alone is not
  // success, and this is the exact case the queue gate already refuses.
  const io = scopeIo('blocked', { dependsOn: '99', states: { 99: { exists: true, open: false, closedAt: '2026-09-01T00:00:00Z', comments: [] } } })
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'ready', reason: 'I believe it is done' }, NOW, io), (error) => {
    assert.match(error.message, /refusing to set issue #4242 to ready/)
    assert.match(error.message, /#99 \(waiting\): dependency #99 is closed but has no db-work-completion record; closure alone is not success/)
    assert.match(error.message, /released only by a merged or owner-ruling-recorded db-work-completion record/)
    return true
  })
  assert.equal(parseQueueScope(io.currentBody()).status, 'blocked', 'the body must be untouched')
  assert.equal(io.comments.length, 0)
  assert.equal(io.refs.has(MUTEX_REF), false)
})

test('#2824 --set-scope-status cannot mark work complete: it fails closed on unreadable evidence', () => {
  const io = scopeIo('blocked', { dependsOn: '99', states: { 99: { exists: true, unreadable: 'API down' } } })
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'ready', reason: 'trying anyway for now' }, NOW, io), /NOT "no dependency"/)
  assert.equal(parseQueueScope(io.currentBody()).status, 'blocked')
  // No dependency reader at all is also a refusal, never a pass.
  const blind = scopeIo('blocked', { dependsOn: '99' })
  delete blind.dependencyStates
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'ready', reason: 'trying anyway for now' }, NOW, blind), /cannot prove the dependency closure without a dependency reader/)
  assert.equal(parseQueueScope(blind.currentBody()).status, 'blocked')
})

test('#2824 --set-scope-status refuses a bad status, a thin reason, a closed issue, and a failed readback', () => {
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'done', reason: 'a good long reason' }, NOW, scopeIo()), /--status must be one of ready, blocked, owner-decision/)
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'blocked', reason: 'short' }, NOW, scopeIo('ready')), /--reason must be at least 12 characters/)
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'blocked', reason: 'line one\nline two here' }, NOW, scopeIo('ready')), /--reason must be a single line/)
  const closedIssue = scopeIo('ready'); closedIssue.getIssue = () => ({ number: 4242, state: 'closed', body: scopeBody('ready') })
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'blocked', reason: 'reopening this work' }, NOW, closedIssue), /is not open/)
  // A write that silently did not land -- the #2212 failure mode -- must refuse.
  const lying = scopeIo('ready'); lying.updateIssue = () => {}
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'blocked', reason: 'a genuinely blocked thing' }, NOW, lying), /readback failed/)
  assert.equal(lying.refs.has(MUTEX_REF), false)
})

test('#2824 --set-scope-status is idempotent and refuses an absent scope block', () => {
  const io = scopeIo('ready')
  assert.deepEqual(setScopeStatus({ issue: 4242, status: 'ready', reason: 'already dispatchable' }, NOW, io), { issue: 4242, status: 'ready', previousStatus: 'ready', idempotent: true })
  assert.equal(io.comments.length, 0, 'an idempotent no-op must not spam an audit comment')
  const none = scopeIo('ready'); none.getIssue = () => ({ number: 4242, state: 'open', body: 'no scope block here' })
  assert.throws(() => setScopeStatus({ issue: 4242, status: 'blocked', reason: 'a genuinely blocked thing' }, NOW, none), /carries no db-work-scope block; add exactly one before setting its status/)
})

test('#2824 --set-scope-status is reachable from the CLI and reports the transition', () => {
  const io = scopeIo('blocked')
  const { code, text } = refusalText(['--set-scope-status', '--issue', '4242', '--status', 'ready', '--reason', 'the blocking dependency merged'], io)
  assert.equal(code, 0)
  assert.match(text, /status: blocked -> ready/)
  assert.equal(parseQueueScope(io.currentBody()).status, 'ready')
})

// #3411: a merged pull request's prior-head APPROVE is compared against the
// first parent of its guarded merge commit, never the current main tip.
test('resolveLaneApprovalBase judges a merged PR against its merge commit first parent', async () => {
  const { resolveLaneApprovalBase } = await import('./manage-migration-author-lanes.mjs')
  const head = 'd'.repeat(40), merge = 'e'.repeat(40), tip = 'f'.repeat(40)
  const io = (pr, inMain = true) => ({ mainSha: () => tip, getPr: () => pr, mergeCommitInMain: () => inMain })
  assert.deepEqual(resolveLaneApprovalBase(null, head, io(null)), { ok: true, fetch: tip })
  assert.deepEqual(resolveLaneApprovalBase(1, head, io({ number:1, merged: false, head: { sha: head } })), { ok: true, fetch: tip })
  const merged = { number:1, merged: true, merge_commit_sha: merge, head: { sha: head } }
  assert.deepEqual(resolveLaneApprovalBase(1, head, io(merged)), { ok: true, fetch: merge, firstParentOf: merge, currentMain: tip })
  assert.equal(resolveLaneApprovalBase(1, head, io(merged, false)).ok, false)
  assert.equal(resolveLaneApprovalBase(1, 'a'.repeat(40), io(merged)).ok, false)
  assert.equal(resolveLaneApprovalBase(1, head, io({ number:1, merged: true, head: { sha: head } })).ok, false)
  assert.equal(resolveLaneApprovalBase(1, head, io(null)).ok, false)
  assert.match(resolveLaneApprovalBase(1,head,io({...merged,number:2})).reason,/exact pull request/)
  assert.match(resolveLaneApprovalBase(1,head,io({...merged,merged:false,merged_at:'2026-09-22T00:00:00Z'})).reason,/inconsistent merged state/)
  assert.equal(resolveLaneApprovalBase(1,head,{...io(merged),mergeCommitInMain:undefined}).ok,false)
  assert.equal(resolveLaneApprovalBase(1,head,{...io(merged),mainSha:()=>null}).ok,false)
})


test('#3411 real Git: production refresh carries only unchanged approval after a two-parent merge and later main movement', async () => {
  const { mergedReviewComparisonBase } = await import('./manage-migration-author-lanes.mjs')
  const repo = mkdtempSync(path.join(tmpdir(), 'shared-db-3411-'))
  const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (message) => { git(['add', '.']); git(['commit', '-q', '-m', message]); return git(['rev-parse', 'HEAD']) }
  try {
    git(['init', '-q', '-b', 'main'])
    git(['config', 'user.email', 'test@example.invalid'])
    git(['config', 'user.name', 'Test'])
    git(['config', 'commit.gpgsign', 'false'])
    writeFileSync(path.join(repo, 'base.txt'), 'base\n'); commit('base')
    git(['switch', '-q', '-c', 'pr'])
    writeFileSync(path.join(repo, 'feature.txt'), 'reviewed\n'); const stale = commit('implementation before fix')
    writeFileSync(path.join(repo, 'feature.txt'), 'fixed\n'); const approved = commit('approved implementation')
    mkdirSync(path.join(repo, '.agent'))
    writeFileSync(path.join(repo, '.agent', 'contract.json'), '{}\n'); const head = commit('evidence only')
    git(['switch', '-q', 'main'])
    writeFileSync(path.join(repo, 'main.txt'), 'unrelated\n'); commit('main movement')
    git(['merge', '-q', '--no-ff', '--no-edit', 'pr'])
    const merge = git(['rev-parse', 'HEAD'])
    writeFileSync(path.join(repo, 'after-merge.txt'), 'later main movement\n'); const tip=commit('later main movement')
    git(['remote','add','origin',repo])
    const base = mergedReviewComparisonBase({ mergeCommitSha: merge, head, main: tip, gitRunner: git })
    assert.equal(base, git(['rev-parse', `${merge}^1`]))
    const reads={pr:0,main:0,ancestry:0}
    const io={
      getPr:()=>{reads.pr++;return{number:1,merged:true,merge_commit_sha:merge,head:{sha:head}}},
      mainSha:()=>{reads.main++;return tip},
      mergeCommitInMain:()=>{reads.ancestry++;return true}
    }
    const context={}
    const compare=(prior)=>githubIo.contentPreservingRefresh.call(io,prior,head,1,context,git)
    assert.equal(compare(approved).ok,true,'the production method carries unchanged implementation')
    assert.equal(compare(stale).ok,false,'changed implementation refuses')
    assert.deepEqual(reads,{pr:1,main:1,ancestry:1},'authoritative PR and ancestry facts are read once for all prior heads')
    assert.equal(githubIo.contentPreservingRefresh.call(io,approved,head,2,context,git).ok,false,'a comparison context cannot cross PRs')
    const wrongHeadIo={...io,getPr:()=>({number:1,merged:true,merge_commit_sha:merge,head:{sha:stale}})}
    assert.match(githubIo.contentPreservingRefresh.call(wrongHeadIo,approved,stale,1,{},git).reason,/second parent/)
    let failedReads=0
    const unreadableIo={...io,getPr:()=>{failedReads++;throw new Error('PR read failed')}}
    const failedContext={}
    assert.match(githubIo.contentPreservingRefresh.call(unreadableIo,approved,head,1,failedContext,git).reason,/resolve pull request comparison base: PR read failed/)
    assert.match(githubIo.contentPreservingRefresh.call(unreadableIo,stale,head,1,failedContext,git).reason,/resolve pull request comparison base: PR read failed/)
    assert.equal(failedReads,1,'an unreadable authority is not repeatedly queried for each prior head')
    const fetchFailure=()=>{throw new Error('fetch failed')}
    assert.match(githubIo.contentPreservingRefresh.call(io,approved,head,1,{},fetchFailure).reason,/could not fetch the heads to compare: fetch failed/)
    assert.throws(() => mergedReviewComparisonBase({ mergeCommitSha: merge, head: stale, main: tip, gitRunner: git }), /second parent/)
    assert.throws(() => mergedReviewComparisonBase({ mergeCommitSha: merge, head, main: stale, gitRunner: git }), /not proven in current main/)
    git(['switch','-q','-c','squash',`${merge}^1`])
    git(['merge','-q','--squash','pr']); const squash=commit('squashed PR')
    assert.throws(() => mergedReviewComparisonBase({mergeCommitSha:squash,head,main:squash,gitRunner:git}),/second parent/,'a squash has no reviewed second parent')
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('deepseek-v4.1-flash is drawable and reads the repository while deepseek-chat stays retired',()=>{
  const row=REVIEWERS.find((r)=>r.name==='deepseek-v4.1-flash')
  assert.equal(row.wrapper,'ai-deepseek-agent')
  assert.equal(row.provider,'deepseek')
  assert.ok(!RETIRED_REVIEWERS.includes('deepseek-v4.1-flash'))
  assert.ok(!QUARANTINED_REVIEWERS.includes('deepseek-v4.1-flash'))
  assert.ok(!OVERFLOW_REVIEWERS.some((r)=>r.name==='deepseek-v4.1-flash'))
  for(const engine of [null,'claude','codex'])assert.ok(reviewersForOrchestrator(engine).some((r)=>r.name==='deepseek-v4.1-flash'))
  assert.equal(reviewerReadsRepository('deepseek-v4.1-flash'),true)
  assert.ok(ACTIVE_REVIEWERS.some((r)=>r.name==='deepseek-v4.1-flash'))
  assert.ok(RETIRED_REVIEWERS.includes('deepseek-chat'))
  assert.equal(reviewerReadsRepository('deepseek-chat'),false)
})


// Issue #3449 review follow-ups: exercise the legacy predicate directly.
function legacyRow(io,ref){const busy=findBusyReviewers(io);return {busy,row:busy.stale.find((r)=>r.ref===ref)}}






// Issue #2831 -- a reviewer whose wrapper cannot emit the governed verdict line is never drawn.
import { reviewerEmitsGovernedVerdict as emits2831, nonVerdictReviewerReplacementCommand as nonVerdictCmd2831 } from './manage-migration-author-lanes.mjs'

// Issue #2787 -- the queue audit lists open issues ONCE, reads each pull request's files
// at most once, and prints exactly the queue the old repeated-listing path printed.
import { memoizePrFiles as memo2787 } from './manage-migration-author-lanes.mjs'
test('#2787: queue audit lists open issues once and prints the identical queue',()=>{
  const now=new Date('2026-09-24T12:00:00Z')
  const scope=(extra)=>'```db-work-scope\n'+extra+'\n```'
  const claim=claimBody({version:'20260924010101',objects:['table crm.x'],owner:'agent/a',branch:'a/branch',worktree:'C:/repos/a',expiresAt:new Date('2026-09-25T00:00:00Z')})
  const rows=[
    {number:1,title:'CLAIM: #2 crm.x',body:claim,created_at:'2026-09-20T00:00:00Z',labels:[{name:'db-claim'}],html_url:'u1'},
    {number:2,title:'add crm.x',body:scope('status: ready\nwork_type: structural\nroute: claim-first\npriority: 10\nwrites:\n  - table crm.x'),created_at:'2026-09-20T00:00:00Z',labels:[{name:'db-work'}]},
    {number:3,title:'docs thing',body:scope('status: ready\nwork_type: documentation\nroute: repo-maintenance\npriority: 40'),created_at:'2026-09-21T00:00:00Z',labels:[{name:'db-work'}]},
    {number:4,title:'unlabelled',body:'no scope',created_at:'2026-09-22T00:00:00Z',labels:[]},
    {number:5,title:'a pull request',body:'',created_at:'2026-09-22T00:00:00Z',labels:[],pull_request:{url:'x'}},
  ]
  const run=(withRows)=>{
    let listings=0
    const pager=(endpoint)=>{assert.match(endpoint,/issues\?state=open/);listings++;return rows}
    const io={...githubIo,
      openClaims:(p)=>githubIo.openClaims(p??pager,()=>({total_count:0,items:[]})),
      openWorkIssues:()=>githubIo.openWorkIssues(pager),
      openIssueNumbers:()=>githubIo.openIssueNumbers(pager),
      issueComments:()=>[],dependencyStates:()=>({}),openPulls:()=>[],branchPulls:()=>[],commentIssue:()=>{}}
    if(withRows)io.openIssueRows=()=>{listings++;return rows}
    else delete io.openIssueRows
    const out=[],log=console.log;console.log=(...a)=>out.push(a.join(' '))
    let code;try{code=main(['--queue-audit'],now,io)}catch(error){code='threw: '+error.message}finally{console.log=log}
    return {code,out:out.join('\n'),listings}
  }
  const oldRun=run(false),newRun=run(true)
  assert.ok(oldRun.listings>=3,'the old path listed open issues repeatedly')
  assert.equal(newRun.listings,1,'the new path lists open issues exactly once')
  assert.equal(newRun.code,oldRun.code)
  assert.equal(newRun.out,oldRun.out,'queue output must be identical')
  assert.ok(newRun.out.length>0,"the audit printed a queue")
})
test('#2787: pull request files are read at most once per audit run',()=>{
  let reads=0
  const io=memo2787({branchPulls:()=>[],mergeCommitInMain:()=>true,getPrFiles:(n)=>{reads++;return [{filename:`supabase/migrations/2026092401010${n}_x.sql`,status:'added'}]}})
  assert.deepEqual(io.getPrFiles(7),io.getPrFiles('7'))
  io.getPrFiles(8)
  assert.equal(reads,2)
})

test('#2787: queue audit reads a shared merged pull request once and removes both authored issues',()=>{
  const now=new Date('2026-09-24T12:00:00Z')
  const rows=[
    {number:2,title:'add crm.x',body:scope('ready','structural','claim-first',10,['table crm.x']),created_at:'2026-09-20T00:00:00Z',labels:[{name:'db-work'}]},
    {number:3,title:'add crm.y',body:scope('ready','structural','claim-first',10,['table crm.y']),created_at:'2026-09-21T00:00:00Z',labels:[{name:'db-work'}]},
  ]
  const versions={2:'20260924010102',3:'20260924010103'}
  const run=(authored)=>{
    let reads=0
    const io={...githubIo,
      openIssueRows:()=>rows,
      openClaims:(p)=>githubIo.openClaims(p,()=>({total_count:0,items:[]})),
      issueComments:()=>[],dependencyStates:()=>({}),openPulls:()=>[],commentIssue:()=>{},
      closedClaimsForWork:(issue)=>authored?[{number:100+issue,title:'CLAIM: #'+issue,body:claimBody({version:versions[issue],objects:['table crm.'+(issue===2?'x':'y')],owner:'agent/a',branch:'shared/branch',worktree:'C:/repos/a',expiresAt:new Date('2026-09-25T00:00:00Z')})}]:[],
      branchPulls:()=>[{number:50,merged_at:'2026-09-23T00:00:00Z',merge_commit_sha:'c'.repeat(40)}],
      mergeCommitInMain:()=>true,mainSha:()=>'d'.repeat(40),
      treeFiles:()=>Object.values(versions).map((v)=>'supabase/migrations/'+v+'_x.sql'),
      getPrFiles:()=>{reads++;return Object.values(versions).map((v)=>({filename:'supabase/migrations/'+v+'_x.sql',status:'added'}))}}
    const out=[],log=console.log;console.log=(...a)=>out.push(a.join(' '))
    try{main(['--queue-audit'],now,io)}finally{console.log=log}
    return {reads,out:out.join('\n')}
  }
  const before=run(false),after=run(true)
  const dispatch=(out)=>JSON.parse(out.slice(out.indexOf('{'),out.lastIndexOf('}')+1)).dispatchable
  assert.equal(before.reads,0)
  assert.deepEqual(new Set(dispatch(before.out)),new Set([2,3]))
  assert.equal(after.reads,1,'the shared pull request is read once')
  assert.deepEqual(dispatch(after.out),[])
})

test('stepfun-step-5-preview is drawable, reads the repository, and emits a governed verdict',()=>{
  const row=REVIEWERS.find((r)=>r.name==='stepfun-step-5-preview')
  assert.ok(row,'stepfun row is present')
  assert.equal(row.wrapper,'ai-stepfun')
  assert.equal(row.provider,'stepfun')
  assert.ok(!RETIRED_REVIEWERS.includes('stepfun-step-5-preview'))
  assert.ok(!QUARANTINED_REVIEWERS.includes('stepfun-step-5-preview'))
  for(const engine of [null,'claude','codex'])assert.ok(reviewersForOrchestrator(engine).some((r)=>r.name==='stepfun-step-5-preview'))
  assert.equal(reviewerReadsRepository('stepfun-step-5-preview'),true)
  assert.equal(reviewerEmitsGovernedVerdict('stepfun-step-5-preview'),true)
  assert.ok(!OVERFLOW_REVIEWERS.some((r)=>r.name==='stepfun-step-5-preview'))
  assert.ok(ACTIVE_REVIEWERS.some((r)=>r.name==='stepfun-step-5-preview'))
})


// ---------------------------------------------------------------------------
// ISSUE #2998 — PRE-DRAW HANDOFF READINESS.
//
// Every criterion below is checked BEFORE the draw on both CLI paths, and each
// refusal test asserts the draw was never reached (the tripwire io) and that
// the refusal never reads as an approval.
// ---------------------------------------------------------------------------
import { DrawReadinessError, PRE_DRAW_READ_BUDGET, assertDrawPromptContract, collectHandoffCollisions, currentMainReadiness, evidencePairReadiness, isPreDrawTransportFault, preDrawHandoffChecks } from './lib/reviewer-draw-readiness.mjs'
import { contractHash } from './agent-work-contract.mjs'

const HANDOFF_HEAD = 'a'.repeat(40)
const NO_DRAW_PHRASE = /No reviewer was drawn and no reviewer capacity was spent/

function handoffRun(argv, io) {
  const errors = [], original = console.error
  console.error = (message) => errors.push(String(message))
  let code
  try { code = main(argv, NOW, io) } finally { console.error = original }
  return { code, stderr: errors.join('\n') }
}

// A draw-shaped io: non-documents files, a ready open PR, and a tripwire that
// proves the draw itself was never reached when a readiness check refuses.
function drawIo(pr) {
  return {
    pullRequestFiles: () => [{ filename: 'supabase/migrations/20260925000000_x.sql', status: 'added' }],
    getPr: () => pr ?? { draft: false, mergeable: true, state: 'open' },
    listIssues() { throw new Error('the reviewer draw must not be reached') },
  }
}

const assignArgv = ['--assign-reviewer', '--issue', '2998', '--pr', '2112', '--head-sha', 'd'.repeat(40)]
const replaceArgv = ['--replace-failed-reviewer', '--issue', '2998', '--pr', '2112', '--head-sha', 'd'.repeat(40), '--reviewer', 'muse-spark-1.3-contributor', '--reason', 'x', '--failed-sequence', '1', '--failure-code', 'insufficient_quota', '--confirm-no-verdict', '--confirm-no-artifact']

test('#2998 prompt: a handoff without a brief proceeds; a carried brief must be readable, non-empty and head-clean', () => {
  assert.deepEqual(assertDrawPromptContract({ headSha: HANDOFF_HEAD }), { carried: false })
  assert.deepEqual(assertDrawPromptContract({ prompt: 'Review this change against the brief.', headSha: HANDOFF_HEAD }), { carried: true, headClean: true, validatedOnly: true })
  const dir = mkdtempSync(path.join(tmpdir(), 'draw-prompt-'))
  try {
    assert.throws(
      () => assertDrawPromptContract({ promptFile: path.join(dir, 'missing.md'), headSha: HANDOFF_HEAD }),
      (error) => error instanceof DrawReadinessError && /is not readable/.test(error.message) && NO_DRAW_PHRASE.test(error.message),
    )
    const empty = path.join(dir, 'empty.md'); writeFileSync(empty, '  \n')
    assert.throws(() => assertDrawPromptContract({ promptFile: empty, headSha: HANDOFF_HEAD }), /is empty/)
    const stale = path.join(dir, 'stale.md'); writeFileSync(stale, `Review the change.\n\nVERDICT: APPROVE ${'0'.repeat(40)}\n`)
    // A refusal names the problem without ever printing an approval or a decision line.
    assert.throws(
      () => assertDrawPromptContract({ promptFile: stale, headSha: HANDOFF_HEAD }),
      (error) => error instanceof DrawReadinessError && /binds a decision line to head/.test(error.message) && !/APPROVE|VERDICT/.test(error.message),
    )
    const clean = path.join(dir, 'clean.md'); writeFileSync(clean, 'Review the change.\n')
    assert.deepEqual(assertDrawPromptContract({ promptFile: clean, headSha: HANDOFF_HEAD }), { carried: true, headClean: true, validatedOnly: true })
    const bound = path.join(dir, 'bound.md'); writeFileSync(bound, `Review.\n\nVERDICT: APPROVE ${HANDOFF_HEAD}\n`)
    assert.deepEqual(assertDrawPromptContract({ promptFile: bound, headSha: HANDOFF_HEAD }), { carried: true, headClean: true, validatedOnly: true })
    // Both forms at once is ambiguous and refuses instead of silently dropping one (L2).
    assert.throws(() => assertDrawPromptContract({ prompt: 'x', promptFile: bound, headSha: HANDOFF_HEAD }), /both --prompt and --prompt-file/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// A complete, valid keyed evidence pair for issue 2998 generation 7, with the
// io that reads it exactly as the CLI would: two files at the head, the
// published immutable ref, and its commit message.
function evidenceFixture({ pr = 2112, issue = 2998, generation = 7, publishedContract } = {}) {
  const contract = { schema_version: 1, work_issue: issue, work_type: 'repo-maintenance', route: 'repo-maintenance', goal: 'fail fast before the draw', base_sha: 'b'.repeat(40), dispatcher: 'owner', worker: 'session', branch: 'b', worktree: 'w', allowed_paths: ['scripts/x.mjs'], file_writes: ['scripts/x.mjs'], db_reads: [], db_writes: [], prohibited_actions: ['no db'], required_checks: ['node --test x'], assumptions: ['a'], stop_conditions: ['s'], generation }
  const report = { schema_version: 1, work_issue: issue, outcome: 'ready-for-merge', pr, migration_versions: [], contract_ref: `refs/db-contracts/${issue}/${generation}`, contract_sha256: contractHash(contract), head_sha: 'e'.repeat(40), base_sha: 'b'.repeat(40), files_changed: ['scripts/x.mjs'], db_reads: [], db_writes: [], checks: [{ command: 'node --test x', exit_code: 0, evidence: 'pass' }], assumptions_resolved: [], stop_conditions_hit: [] }
  const rows = [
    { filename: `.agent/work/${issue}/${generation}/contract.json`, status: 'modified' },
    { filename: `.agent/work/${issue}/${generation}/completion.json`, status: 'modified' },
  ]
  const published = publishedContract ?? contract
  const io = {
    getFileAt: (file) => String(file).endsWith('contract.json') ? JSON.stringify(contract) : JSON.stringify(report),
    readRef: () => 'f'.repeat(40),
    readCommitMessage: () => `db-agent-contract issue=${issue} generation=${generation} sha256=${contractHash(published)}\n\n${JSON.stringify(published)}`,
  }
  return { contract, report, rows, io }
}

test('#2998 evidence: classification refuses a half pair or two pairs, and inherited or unreadable input proceeds', () => {
  assert.throws(() => evidencePairReadiness({ rows: [{ filename: '.agent/work/9/1/contract.json' }], prState: 'open' }), (error) => error instanceof DrawReadinessError && /only one half of its agent evidence pair/.test(error.message) && NO_DRAW_PHRASE.test(error.message))
  assert.throws(() => evidencePairReadiness({ rows: [{ filename: '.agent/work/9/1/contract.json' }, { filename: '.agent/work/9/1/completion.json' }, { filename: '.agent/contract.json' }], prState: 'open' }), /more than one agent evidence pair/)
  assert.deepEqual(evidencePairReadiness({ rows: [{ filename: 'scripts/x.mjs' }], prState: 'open' }), { state: 'inherited', contract: null, completion: null, key: null })
  assert.equal(evidencePairReadiness({ rows: 'nonsense', prState: 'open' }).state, 'unreadable')
})

test('#2998 evidence: a current pair validates against its contract, its completion, and the immutable publication', () => {
  const { rows, io } = evidenceFixture()
  const result = evidencePairReadiness({ rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io })
  assert.equal(result.state, 'current')
  assert.equal(result.validated, true)
})

test('#2998 evidence: definite faults refuse; transport faults and non-open pull requests proceed', () => {
  const base = evidenceFixture()
  // The completion does not bind this pull request.
  assert.throws(() => evidencePairReadiness({ rows: base.rows, pr: 9999, headSha: HANDOFF_HEAD, prState: 'open', io: base.io }), /does not bind this pull request/)
  // A required check that never ran means the report does not satisfy its contract.
  const noChecks = evidenceFixture(); noChecks.report.checks = []
  noChecks.io.getFileAt = (file) => String(file).endsWith('contract.json') ? JSON.stringify(noChecks.contract) : JSON.stringify(noChecks.report)
  assert.throws(() => evidencePairReadiness({ rows: noChecks.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: noChecks.io }), /does not satisfy its contract/)
  // No immutable publication exists for the checked-in pair.
  const unpublished = evidenceFixture(); unpublished.io.readRef = () => null
  assert.throws(() => evidencePairReadiness({ rows: unpublished.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: unpublished.io }), /no immutable contract is published/)
  // The published contract is not the checked-in contract.
  const drifted = evidenceFixture({ publishedContract: { ...evidenceFixture().contract, goal: 'different after the fact' } })
  assert.throws(() => evidencePairReadiness({ rows: drifted.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: drifted.io }), /does not match the immutable contract published before the work/)
  // Bytes that are not JSON are a definite fault.
  const garbage = evidenceFixture(); garbage.io.getFileAt = () => 'not json'
  assert.throws(() => evidencePairReadiness({ rows: garbage.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: garbage.io }), /not readable JSON/)
  // A transport fault proceeds exactly as the readiness guard always has.
  const offline = evidenceFixture(); offline.io.getFileAt = () => { throw new Error('HTTP 502') }
  assert.equal(evidencePairReadiness({ rows: offline.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: offline.io }).validated, false)
  // A merged pull request (#2915) stops at classification: the files are never read.
  const closed = evidenceFixture()
  closed.io.getFileAt = () => { throw new Error('must not read evidence for a non-open pull request') }
  assert.equal(evidencePairReadiness({ rows: closed.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'closed', io: closed.io }).validated, false)
  // No exact head means no deep judgment, and the downstream draw still demands one.
  assert.equal(evidencePairReadiness({ rows: base.rows, pr: 2112, prState: 'open', io: base.io }).validated, false)
})

test('#2998 current-main: mergeable_state is reported, never refused (M3\')', () => {
  assert.deepEqual(currentMainReadiness({ state: 'open', mergeable_state: 'behind' }), { state: 'behind' })
  assert.deepEqual(currentMainReadiness({ state: 'open', mergeable: true }), { state: 'unknown' })
  assert.deepEqual(currentMainReadiness({ state: 'closed', merged_at: '2026-09-14T00:00:00Z' }), { state: 'not-open' })
  assert.deepEqual(currentMainReadiness(undefined), { state: 'unknown' })
})

// A fake GitHub for the collision scan: open PRs with complete file lists,
// counting every read so the scan's wire cost is proved, not claimed (H1).
function collisionGitHub({ current = 9, others = [], fail } = {}) {
  const pulls = new Map([[current, { number: current, title: 'mine', draft: false, created_at: '2026-09-25T00:00:00Z', files: others.find((pr) => pr.number === current)?.files ?? [] }]])
  for (const pr of others) pulls.set(pr.number, { title: `PR ${pr.number}`, draft: false, created_at: '2026-09-20T00:00:00Z', ...pr })
  const calls = []
  const read = (args) => {
    const endpoint = args[args.length - 1]
    calls.push(endpoint)
    if (fail) fail(endpoint)
    let m
    if (/\/pulls\?state=open/.test(endpoint)) return [[...pulls.values()].map((pr) => ({ number: pr.number, title: pr.title, draft: pr.draft, created_at: pr.created_at, head: { sha: 'c'.repeat(40) } }))]
    if ((m = endpoint.match(/\/pulls\/(\d+)\/files/))) return [pulls.get(Number(m[1])).files.map((filename) => ({ filename, status: 'modified' }))]
    if ((m = endpoint.match(/\/pulls\/(\d+)\/commits/))) return [[]]
    if ((m = endpoint.match(/\/pulls\/(\d+)$/))) { const pr = pulls.get(Number(m[1])); return { number: pr.number, title: pr.title, draft: pr.draft, created_at: pr.created_at, changed_files: pr.files.length, head: { sha: 'c'.repeat(40), ref: 'x' }, base: { sha: 'b'.repeat(40), ref: 'main' }, updated_at: '2026-09-27T00:00:00Z', mergeable_state: 'clean' } }
    if (/\/timeline/.test(endpoint) || /\/comments/.test(endpoint)) return [[]]
    if (/check-runs/.test(endpoint)) return [{ check_runs: [] }]
    throw new Error(`unexpected read ${endpoint}`)
  }
  return { read, calls }
}

test('#2998 collision: a pull request that does not edit the protected source makes zero reads, even with a migration', () => {
  const gh = collisionGitHub()
  const result = collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows: [{ filename: 'scripts/example.mjs', status: 'modified' }, { filename: 'supabase/migrations/20260925000000_x.sql', status: 'added' }], read: gh.read, env: {} })
  assert.deepEqual(result, { sourceCollisions: [], reads: 0, degraded: false })
  assert.equal(collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows: 'nonsense', read: gh.read, env: {} }).reads, 0)
  assert.equal(gh.calls.length, 0)
})

test('#2998 collision: touching the protected source runs the REAL guard inside the logical-read budget', () => {
  const source = 'scripts/manage-migration-author-lanes.mjs'
  const others = [{ number: 9, created_at: '2026-09-25T00:00:00Z', files: [source] }, ...Array.from({ length: 12 }, (_, i) => ({ number: 3300 + i, files: i === 0 ? [source] : [`docs/${i}.md`] }))]
  const gh = collisionGitHub({ others })
  const rows = [{ filename: source, status: 'modified' }]
  // An exported snapshot for some other pull request must not be used (L7').
  const result = collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows, read: gh.read, env: { OPEN_PR_FILES_SNAPSHOT: '/nonexistent/other-pr.json' } })
  assert.deepEqual(result.sourceCollisions.map((row) => row.pr), [3300])
  assert.equal(gh.calls.filter((endpoint) => /\/pulls\?state=open/.test(endpoint)).length, 1)
  assert.equal(result.reads, gh.calls.length, 'every logical read is counted')
  assert.equal(result.reads, 1 + 13 * 2 + 5 + 1)
  assert.ok(result.reads <= PRE_DRAW_READ_BUDGET)
  assert.throws(() => collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows, read: gh.read, env: {}, budget: 5 }), (error) => error instanceof DrawReadinessError && /more than 5 logical GitHub reads/.test(error.message))
})

test('#2998 collision: only a genuine transport fault proceeds (degraded); a 404/403 or an incomplete input refuses', () => {
  const source = 'scripts/manage-migration-author-lanes.mjs'
  const rows = [{ filename: source, status: 'modified' }]
  const tagged = (message, extra) => Object.assign(new Error(message), extra)
  const transport = collisionGitHub({ others: [{ number: 9, files: [source] }], fail: () => { throw tagged('gh api failed', { stderr: 'HTTP 502 Bad Gateway', transientTransport: true }) } })
  assert.deepEqual(collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows, read: transport.read, env: {} }), { sourceCollisions: [], reads: 1, degraded: true })
  for (const answer of ['gh api repos/x/pulls failed: HTTP 404 Not Found', 'gh api repos/x/pulls failed: HTTP 403 Resource not accessible by integration', 'gh api repos/x failed: HTTP 422']) {
    assert.equal(isPreDrawTransportFault(new Error(answer)), false, answer)
    const definite = collisionGitHub({ others: [{ number: 9, files: [source] }], fail: () => { throw new Error(answer) } })
    assert.throws(() => collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows, read: definite.read, env: {} }), /could not gather complete inputs/)
  }
  const partial = collisionGitHub({ others: [{ number: 9, files: [source] }, { number: 3301, files: [source, 'a', 'b'] }] })
  const partialRead = (args) => { const out = partial.read(args); return /\/pulls\/3301\/files/.test(args[args.length - 1]) ? [out[0].slice(0, 1)] : out }
  assert.throws(() => collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows, read: partialRead, env: {} }), (error) => error instanceof DrawReadinessError && /returned 1 of 3 changed files/.test(error.message) && /fails closed/.test(error.message) && NO_DRAW_PHRASE.test(error.message))
  for (const message of ['GITHUB_REPOSITORY is not set', "PR #7 reaches GitHub's 3000-file limit", 'activation history for PR #7 is unreadable']) {
    assert.throws(() => collectHandoffCollisions({ repo: 'popcre/shared-db', pr: 9, rows, read: () => [[]], env: {}, gather: () => { throw new Error(message) } }), /could not gather complete inputs/)
  }
  assert.equal(isPreDrawTransportFault(new Error('API rate limit exceeded for installation (HTTP 403)')), true)
  assert.equal(isPreDrawTransportFault(new Error('connection reset by peer')), true)
})

test('#2998 evidence: an untracked or removed evidence file refuses; a tagged transport fault is degraded (M4\', M5\')', () => {
  const base = evidenceFixture()
  const untracked = { ...base.io, getFileAt: () => { throw new Error('could not read .agent/work/2998/7/contract.json at ' + HANDOFF_HEAD) } }
  assert.throws(() => evidencePairReadiness({ rows: base.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: untracked }), /could not be read at head/)
  const removed = base.rows.map((row) => ({ ...row, status: 'removed' }))
  assert.throws(() => evidencePairReadiness({ rows: removed, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: base.io }), /is removed; a pair must be added or modified in place/)
  const flaky = { ...base.io, getFileAt: () => { throw Object.assign(new Error('read failed'), { stderr: 'HTTP 503', transientTransport: true }) } }
  const degraded = evidencePairReadiness({ rows: base.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: flaky })
  assert.equal(degraded.validated, false)
  assert.equal(degraded.degraded, true)
  const nullCommit = { ...base.io, readCommitMessage: () => null }
  assert.match(evidencePairReadiness({ rows: base.rows, pr: 2112, headSha: HANDOFF_HEAD, prState: 'open', io: nullCommit }).reason, /cause unknown/)
  assert.deepEqual(preDrawHandoffChecks({ pr: 2112, headSha: HANDOFF_HEAD, rows: base.rows, live: { state: 'open' } }, flaky).degraded, ['evidence: the evidence pair could not be read (transport)'])
})

test('#2998 exact objects: a stale --head-sha and a different issue\'s evidence pair both refuse', () => {
  const live = { state: 'open', head: { sha: 'c'.repeat(40) } }
  assert.throws(() => preDrawHandoffChecks({ pr: 9, headSha: HANDOFF_HEAD, rows: [], live }, {}), (error) => /is not the live head of PR #9/.test(error.message) && NO_DRAW_PHRASE.test(error.message))
  assert.equal(preDrawHandoffChecks({ pr: 9, headSha: 'c'.repeat(40), rows: [], live }, {}).currentMain.state, 'unknown')
  const { rows, io } = evidenceFixture({ pr: 2112, issue: 2998 })
  assert.throws(() => evidencePairReadiness({ rows, pr: 2112, headSha: HANDOFF_HEAD, issue: 3001, prState: 'open', io }), /contract is for issue #2998, but this draw is for issue #3001/)
  assert.equal(evidencePairReadiness({ rows, pr: 2112, headSha: HANDOFF_HEAD, issue: '2998', prState: 'open', io }).validated, true)
})






// #3874: the orchestrator role is retired. Reviewer independence follows the
// authoring session's declared engine, and `claim-first` is a structural route.
import { authorEngineFromEnv as __authorEngineFromEnv, knownAuthorEngines as __knownAuthorEngines, CLAIM_FIRST_ROUTES as __CLAIM_FIRST_ROUTES, ROUTES_BY_WORK_TYPE as __ROUTES_BY_WORK_TYPE, QUEUE_ROUTES as __QUEUE_ROUTES } from './manage-migration-author-lanes.mjs'
import { STRUCTURAL_ROUTES as __STRUCTURAL_ROUTES } from './db-flow/admission.mjs'
test('#3874 author engine is mandatory and fails closed', () => {
  assert.throws(() => __authorEngineFromEnv(undefined), /SHARED_DB_AUTHOR_ENGINE is not set/)
  assert.throws(() => __authorEngineFromEnv('   '), /SHARED_DB_AUTHOR_ENGINE is not set/)
  assert.throws(() => __authorEngineFromEnv('claud'), /not a known engine/)
  assert.throws(() => __authorEngineFromEnv('claude; rm -rf /'), /not a known engine/)
  assert.equal(__authorEngineFromEnv('  Claude '), 'claude')
  for (const engine of ['codex', 'claude', 'zcode', 'glm']) assert.ok(__knownAuthorEngines().has(engine))
})
test('#3874 a declared author engine strictly excludes its same-engine reviewer', () => {
  const all = reviewersForOrchestrator(null)
  const glmRows = all.filter((row) => String(row.orchestratorEngine ?? '').toLowerCase() === 'glm')
  assert.ok(glmRows.length > 0, 'fixture needs at least one GLM-engine reviewer')
  const withoutZcode = reviewersForOrchestrator(__authorEngineFromEnv('zcode'))
  assert.equal(withoutZcode.length, all.length - glmRows.length)
  assert.ok(withoutZcode.every((row) => String(row.orchestratorEngine ?? '').toLowerCase() !== 'glm'))
})
test('#3874 the real GitHub io reads SHARED_DB_AUTHOR_ENGINE and refuses when it is unset', () => {
  const saved = process.env.SHARED_DB_AUTHOR_ENGINE
  try {
    delete process.env.SHARED_DB_AUTHOR_ENGINE
    assert.throws(() => githubIo.resolveReviewEngine(), /SHARED_DB_AUTHOR_ENGINE is not set/)
    process.env.SHARED_DB_AUTHOR_ENGINE = 'codex'
    assert.equal(githubIo.resolveReviewEngine(), 'codex')
  } finally {
    if (saved === undefined) delete process.env.SHARED_DB_AUTHOR_ENGINE; else process.env.SHARED_DB_AUTHOR_ENGINE = saved
  }
})
test('#3874 claim-first is a structural route and the legacy alias still works', () => {
  for (const route of ['claim-first', 'shared-db-orchestrator']) {
    assert.ok(__CLAIM_FIRST_ROUTES.has(route))
    assert.ok(__QUEUE_ROUTES.has(route))
    assert.ok(__ROUTES_BY_WORK_TYPE.structural.has(route))
    assert.ok(__STRUCTURAL_ROUTES.includes(route))
  }
})
test('#3874 a route: claim-first issue is dispatched by the queue builder end to end', () => {
  const issues = [
    { number: 1, title: 'claim-first', body: scope('ready', 'structural', 'claim-first', 10, ['table core.a']) },
    { number: 2, title: 'legacy', body: scope('ready', 'structural', 'shared-db-orchestrator', 9, ['table core.b']) },
    { number: 3, title: 'not structural', body: scope('ready', 'repo-maintenance', 'repo-maintenance', 8) },
  ]
  const result = buildDynamicQueues(issues, [], NOW)
  assert.equal(result.fullyAudited, true)
  assert.deepEqual(new Set(result.dispatchable), new Set([1, 2]))
})

// OWNER RULING 2026-10-02 (docs/owner-rulings.md): "if you can't then you'll have
// to be ok with using one reviewer twice". Merged PR post-merge slot >= 2 only.
function mergedReuseIo({merged}){
  const io=reviewIo(),headSha='e'.repeat(40)
  io.requiresExactReviewHeadSha=true
  io.getPr=(number)=>({number:Number(number),state:merged?'closed':'open',merged_at:merged?'2026-10-02T00:00:00Z':null,...(merged?{merge_commit_sha:'c'.repeat(40)}:{}),head:{sha:headSha,ref:'codex/x'}})
  if(merged)io.mergeCommitInMain=()=>true
  if(merged)io.mergedPrReviewTarget=(pr,issue)=>Number(pr)===3902&&Number(issue)===3901
  return {io,headSha}
}
function fillEverySlot(io,headSha){
  const holders=[]
  for(let slot=1;slot<=ACTIVE_REVIEWERS.length;slot+=1){
    const row=assignNextReviewer({issue:3901,pr:3902,headSha,slot},io)
    holders.push(row.reviewer)
  }
  return holders
}




// OWNER INSTRUCTION 2026-10-02: "assign someone to pause merges during production runs".
function freezeIo(){
  const io=memoryIo(),messages=new Map();let n=0
  io.makeOwnerCommit=(message)=>{const sha=(++n).toString(16).padStart(40,'0');messages.set(sha,message);return sha}
  io.readCommitMessage=(sha)=>messages.get(sha)??null
  io.openClaims=()=>[{number:1,body:body(['table core.x'],'1','2099-01-01T00:00:00Z')}]
  io.getPr=(number)=>({number:Number(number),head:{sha:'abc',ref:'codex/1'},base:{sha:'main'}})
  return io
}

test('promotion merge freeze blocks merges, never production, and expires by TTL',()=>{
  const io=freezeIo(),now=new Date('2026-10-02T12:00:00Z')
  assert.throws(()=>acquirePromotionFreeze({issue:1,pr:2,owner:'x',ttlMinutes:61,now},io),/between 1 and 60/)
  const freeze=acquirePromotionFreeze({issue:3901,pr:3902,owner:'claude-session',ttlMinutes:30,now},io)
  assert.equal(freeze.expiresAt,'2026-10-02T12:30:00.000Z')
  assert.equal(io.refs.has(MUTEX_REF),false)
  assert.throws(()=>acquirePromotionFreeze({issue:1,pr:2,owner:'other',ttlMinutes:10,now},io),/already set; promotion merge freeze held by "claude-session"/)
  assert.throws(()=>acquireExclusive('merge',{owner:'a',pr:1,headSha:'abc',now},io),/merges are paused for a production run; promotion merge freeze held by "claude-session" for PR #3902 \(issue #3901\) until 2026-10-02T12:30:00.000Z/)
  const production=acquireExclusive('production',{owner:'p',headSha:'main',now},io)
  releaseOwnedRef(EXCLUSIVE_REFS.production,production.ownerSha,io)
  assert.throws(()=>releasePromotionFreeze({owner:'someone-else',now},io),/refusing to release another holder's freeze/)
  assert.ok(acquireExclusive('merge',{owner:'a',pr:1,headSha:'abc',now:new Date('2026-10-02T12:31:00Z')},io).ownerSha,'an expired freeze never wedges merges')
  releaseOwnedRef(EXCLUSIVE_REFS.merge,io.refs.get(EXCLUSIVE_REFS.merge),io)
  assert.equal(releasePromotionFreeze({pr:3902},io).released,true,'the production cleanup releases by source PR')
  assert.equal(io.refs.has(PROMOTION_FREEZE_REF),false)
  assert.equal(releasePromotionFreeze({pr:3902},io).released,false)
})

test('#4845: a freeze lets only appended-migration, test and evidence merges through',()=>{
  const now=new Date('2026-10-02T12:00:00Z')
  const tolerant=[{filename:'supabase/migrations/20261026155023_b.sql',status:'added'},{filename:'supabase/tests/b.sql',status:'added'},{filename:'.agent/work/4811/1/contract.json',status:'added'},{filename:'docs/x.md',status:'modified'}]
  const io=freezeIo();io.getPrFiles=()=>tolerant
  acquirePromotionFreeze({issue:3901,pr:3902,owner:'claude-session',ttlMinutes:30,now},io)
  assert.equal(freezeTolerantMerge(io,1),true)
  assert.ok(acquireExclusive('merge',{owner:'a',pr:1,headSha:'abc',now},io).ownerSha,'a non-colliding appended migration merges through the freeze')
  for(const [name,files] of [
    ['modified migration',[{filename:'supabase/migrations/20261026150931_a.sql',status:'modified'}]],
    ['removed migration',[{filename:'supabase/migrations/20261026150931_a.sql',status:'removed'}]],
    ['renamed migration',[{filename:'supabase/migrations/20261026150932_a.sql',status:'renamed'}]],
    ['gate code',[...tolerant,{filename:'scripts/production_business_risk_gate.py',status:'modified'}]],
    ['workflow',[{filename:'.github/workflows/shared-supabase-migrations.yml',status:'modified'}]],
    ['empty list',[]],
  ]){
    const blocked=freezeIo();blocked.getPrFiles=()=>files
    acquirePromotionFreeze({issue:3901,pr:3902,owner:'claude-session',ttlMinutes:30,now},blocked)
    assert.throws(()=>acquireExclusive('merge',{owner:'a',pr:1,headSha:'abc',now},blocked),/merges are paused for a production run/,name)
  }
  const unreadable=freezeIo();unreadable.getPrFiles=()=>{throw new Error('api down')}
  assert.equal(freezeTolerantMerge(unreadable,1),false,'an unreadable file list fails closed')
})

test('#4845: production lane accepts a verified prefix of main and refuses anything unproven',()=>{
  const io=freezeIo(),now=new Date('2026-10-02T12:00:00Z')
  io.mainSha=()=>'tip';io.productionPrefixOk=(head,tip)=>head==='prefix'&&tip==='tip'
  const lane=acquireExclusive('production',{owner:'p',headSha:'prefix',now},io)
  assert.ok(lane.ownerSha)
  releaseOwnedRef(EXCLUSIVE_REFS.production,lane.ownerSha,io)
  assert.throws(()=>acquireExclusive('production',{owner:'p',headSha:'other',now},io),/exact current main SHA or a verified prefix/)
  delete io.productionPrefixOk
  assert.throws(()=>acquireExclusive('production',{owner:'p',headSha:'f'.repeat(40),now},io),/exact current main SHA or a verified prefix/,'the default git proof fails closed')
})

test('an expired promotion freeze is replaced by a new one',()=>{
  const io=freezeIo()
  acquirePromotionFreeze({issue:1,pr:2,owner:'old',ttlMinutes:5,now:new Date('2026-10-02T12:00:00Z')},io)
  const next=acquirePromotionFreeze({issue:3,pr:4,owner:'new',ttlMinutes:5,now:new Date('2026-10-02T12:06:00Z')},io)
  assert.equal(next.replacedExpired,true)
  assert.equal(readPromotionFreeze(io,new Date('2026-10-02T12:07:00Z')).owner,'new')
})



test('promotion merge freeze also blocks repository-maintenance authorization',()=>{
  const io=freezeIo()
  acquirePromotionFreeze({issue:3901,pr:3902,owner:'claude-session',ttlMinutes:30},io)
  assert.throws(()=>authorizeRepositoryMaintenanceStatus({pr:5,headSha:'a'.repeat(40),description:'d',targetUrl:'https://example.test/x'},io),/merges are paused for a production run; promotion merge freeze held by "claude-session"/)
  assert.equal(io.refs.has(MUTEX_REF),false)
})


test('an unreadable promotion freeze fails closed, cannot be overwritten, and names its remedy',()=>{
  const io=freezeIo()
  io.refs.set(PROMOTION_FREEZE_REF,io.makeOwnerCommit('db-coordination promotion-freeze-record pr=1 issue=2\n{"owner":"","expiresAt":"2026-10-02T00:00:00Z"}'))
  assert.equal(readPromotionFreeze(io,new Date('2030-01-01T00:00:00Z')).unreadable,true,'an ownerless record is unreadable')
  assert.throws(()=>acquireExclusive('merge',{owner:'a',pr:1,headSha:'abc',now:new Date('2030-01-01T00:00:00Z')},io),/is unreadable; clear it with --release-promotion-freeze --pr <n>/)
  assert.throws(()=>acquirePromotionFreeze({issue:3,pr:4,owner:'x',ttlMinutes:5},io),/already set/)
  io.refs.set(PROMOTION_FREEZE_REF,io.makeOwnerCommit('garbage'))
  assert.equal(releasePromotionFreeze({pr:999},io).released,true,'any positive PR releases an unreadable record')
  assert.equal(io.refs.has(PROMOTION_FREEZE_REF),false)
})

test('promotion freeze CLI acquires and releases through main()',()=>{
  const io=freezeIo(),oldLog=console.log,oldError=console.error,out=[];console.log=(line)=>out.push(String(line));console.error=()=>{}
  try{
    assert.equal(main(['--acquire-promotion-freeze','--issue','3901','--pr','3902','--owner','claude-session','--ttl-minutes','60'],NOW,io),0)
    assert.equal(JSON.parse(out.at(-1)).owner,'claude-session')
    assert.ok(io.refs.has(PROMOTION_FREEZE_REF))
    assert.notEqual(main(['--acquire-promotion-freeze','--issue','3901','--pr','3902','--owner','x','--ttl-minutes','61'],NOW,io),0)
    assert.equal(main(['--release-promotion-freeze','--owner','claude-session'],NOW,io),0)
    assert.equal(JSON.parse(out.at(-1)).released,true)
    assert.equal(io.refs.has(PROMOTION_FREEZE_REF),false)
  }finally{console.log=oldLog;console.error=oldError}
})

test('the production job releases the promotion freeze for its source PR on always(), after the lane release',()=>{
  const workflow=readFileSync(fileURLToPath(new URL('../.github/workflows/shared-supabase-migrations.yml',import.meta.url)),'utf8')
  const lane=workflow.indexOf('--release-production --owner-sha "$OWNER_SHA"'),freeze=workflow.indexOf('- name: Release the promotion merge freeze for this source PR')
  assert.ok(lane>0&&freeze>lane,'freeze release follows the production lane release')
  const step=workflow.slice(freeze,workflow.indexOf('\n      - name:',freeze+10))
  assert.match(step,/if: always\(\) && inputs\.source_pr != ''/)
  assert.match(step,/--release-promotion-freeze --pr "\$SOURCE_PR"/)
  assert.doesNotMatch(workflow,/--acquire-production[\s\S]{0,400}promotion-freeze/,'acquiring production never consults the freeze')
})

test('--ttl-minutes is refused with --release-promotion-freeze',()=>{
  const io=freezeIo(),oldLog=console.log,oldError=console.error;console.log=()=>{};console.error=()=>{}
  try{assert.notEqual(main(['--release-promotion-freeze','--owner','x','--ttl-minutes','5'],NOW,io),0)}finally{console.log=oldLog;console.error=oldError}
})


function addConservativePaidStarts(io,{issue,pr,paidAttempts}){
  const priorHead='b'.repeat(40)
  for(let sequence=1;sequence<=paidAttempts;sequence++){
    const sha=io.makeOwnerCommit(`db-coordination review-started issue=${issue} pr=${pr} head=${priorHead} slot=1 sequence=${sequence} reviewer=glm-5.3 at=2026-10-06T18:00:00Z`)
    io.refs.set(reviewStartedMarkerRef({issue,pr,headSha:priorHead,slot:1,sequence}),sha)
  }
  io.reviewContentComparison=()=>{throw new LaneError('review budget Git provenance refused: review budget conflict is outside the one canonical test append')}
  return priorHead
}

function conservativeBudgetFixture({atomic=false,issue,pr,headSha,paidAttempts=1}){
  const io=reviewIo()
  if(atomic)withAtomicRefs(io)
  io.getPr=(number)=>({number:Number(number),state:'open',head:{sha:headSha,ref:'codex/budget'}})
  const priorHead=addConservativePaidStarts(io,{issue,pr,paidAttempts})
  return {io,priorHead}
}




test('Windows monotonic pause invokes supported command launcher and independently reads protected status',async()=>{
 const {pauseProviderFailure}=await import('./manage-migration-author-lanes.mjs')
 const observedEpoch=1000,record={reviewer:'glm-5.3',failureCode:'provider_unavailable',observedEpoch}
 const hold={provider:'glm',created_epoch:observedEpoch,expires_epoch:4600,record_id:'protected',failure_class:'provider_unavailable'}
 const calls=[]
 const deps={platform:'win32',env:{ComSpec:'C:/Windows/cmd.exe'},resolveCommand:()=> 'C:/tools/ai-review-preflight.cmd',now:()=>1100*1000,execute:(file,args)=>{calls.push({file,args});return JSON.stringify(hold)}}
 assert.deepEqual(pauseProviderFailure(record,deps),hold)
 assert.equal(calls.length,2);assert.equal(calls[0].file,'C:/Windows/cmd.exe')
 assert.deepEqual(calls[0].args,['/d','/s','/c','C:/tools/ai-review-preflight.cmd','pause','glm','provider_unavailable','--seconds','3600','--observed','1000'])
 assert.deepEqual(calls[1].args,['/d','/s','/c','C:/tools/ai-review-preflight.cmd','pause-status','glm'])
 let n=0
 assert.throws(()=>pauseProviderFailure(record,{...deps,execute:()=>JSON.stringify(++n===1?hold:{...hold,record_id:'tampered'})}),/readback mismatch/)
 assert.throws(()=>pauseProviderFailure(record,{...deps,execute:()=> 'invalid JSON'}),/returned unreadable JSON/)
 const stronger={...hold,expires_epoch:10000,failure_class:'out-of-credit'}
 assert.deepEqual(pauseProviderFailure(record,{...deps,execute:()=>JSON.stringify(stronger)}),stronger)
 const expired={status:'expired',provider:'glm',observed_epoch:1000,expires_epoch:4600};n=0
 assert.deepEqual(pauseProviderFailure(record,{...deps,now:()=>5000*1000,execute:()=>JSON.stringify(++n===1?expired:stronger)}),expired)
 assert.throws(()=>pauseProviderFailure(record,{...deps,now:()=>5000*1000,execute:()=>JSON.stringify(expired)}),/status unreadable/)
})







test('supported claim validator and queue accept exact global roles without schema aliases', () => {
  assert.deepEqual(validateClaimObjects(['role "Worker"', 'role "Two  Spaces"', 'role plain']), ['role "Worker"', 'role "Two  Spaces"', 'role plain'])
  assert.throws(() => validateClaimObjects(['role core.worker']), /exact global role/)
  assert.throws(() => validateClaimObjects(['role plain', 'role "plain"']), /duplicate/)
  const parsed = parseQueueScope(scope('ready','structural','claim-first',1,['role "Worker"']))
  assert.deepEqual(parsed.writes, ['role "Worker"'])
})

test('preview admission refuses an unclaimed role owner dependency and accepts a claimed read', () => {
  const migrationBody = 'CREATE TABLE plm.wwe_property(); ALTER TABLE plm.wwe_property OWNER TO worker;'
  assert.throws(() => deriveLivePreviewCandidate(1769,mergedRehearsalIo({migrationBody}).io), /ownership role dependencies/)
  const fixture = mergedRehearsalIo({migrationBody}), claims = fixture.io.openClaims()
  claims[0].body = claims[0].body.replace('objects:', 'writes:').replace('```\n\n```db-author-lease', 'reads:\n  - role worker\n```\n\n```db-author-lease')
  fixture.io.openClaims = () => claims
  const candidate = deriveLivePreviewCandidate(1769,fixture.io)
  assert.equal(candidate.pr,1809)
})

// #4048: use actual Git commits, a local immutable contract remote and all normal
// validators. Refs and a mocked successful proof alone must not grant authority.
import { verifyNonclosingMaintenanceBinding, resolveAdmittedIssueForPr } from './manage-migration-author-lanes.mjs'
import {contractHash as bindingContractHash} from './agent-work-contract.mjs'
import {readPublishedContractFromGit as bindingPublishedContract} from './agent-work-contract-git-evidence.mjs'
function nonclosingGitFixture(structural=false){
  const dir=mkdtempSync(path.join(tmpdir(),'nonclosing-binding-')),remote=path.join(dir,'remote.git')
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  const put=(name,text)=>{const file=path.join(dir,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,text)}
  git('init','-b','main');git('config','user.name','Controlled fixture');git('config','user.email','fixture@example.invalid')
  put('app.txt','before\n');git('add','app.txt');git('commit','-m','base');const base=git('rev-parse','HEAD')
  execFileSync('git',['init','--bare',remote],{stdio:'ignore'});git('remote','add','origin',remote);git('checkout','-b','feature')
  const sourcePath=structural?'supabase/migrations/20260101000000_example.sql':'app.txt'
  const objects=structural?['table core.example']:[]
  const contract={schema_version:2,generation:1,work_issue:41,work_type:'repo-maintenance',route:'repo-maintenance',goal:'Controlled nonclosing canonical proof',base_sha:base,dispatcher:'fixture',worker:'fixture',branch:'feature',worktree:dir,allowed_paths:['app.txt'],file_writes:['app.txt'],db_reads:[],db_writes:[],prohibited_actions:[],required_checks:['fixture'],assumptions:[],stop_conditions:['Stop on unknown'],evidence_parent:null}
  if(structural)Object.assign(contract,{work_type:'structural',route:'claim-first',allowed_paths:[sourcePath],file_writes:[sourcePath],db_writes:objects})
  const ref='refs/db-contracts/41/1',publication=git('commit-tree',`${base}^{tree}`,'-p',base,'-m',`Work contract published\n\n${JSON.stringify(contract)}`)
  git('update-ref',ref,publication);git('push','origin',ref)
  put(sourcePath,structural?'CREATE TABLE core.example (id integer);\n':'genuine source\n');git('add',sourcePath);git('commit','-m','source');const implementation=git('rev-parse','HEAD')
  const report={schema_version:1,work_issue:41,outcome:'ready-for-merge',pr:7,migration_versions:[],contract_ref:ref,contract_sha256:bindingContractHash(contract),head_sha:implementation,base_sha:base,files_changed:['app.txt'],db_reads:[],db_writes:[],checks:[{command:'fixture',exit_code:0,evidence:'Actual controlled fixture source operation'}],assumptions_resolved:[],stop_conditions_hit:[]}
  if(structural)Object.assign(report,{files_changed:[sourcePath],migration_versions:['20260101000000'],db_writes:objects})
  put('.agent/work/41/1/contract.json',JSON.stringify(contract));put('.agent/work/41/1/completion.json',JSON.stringify(report));git('add','.agent');git('commit','-m','own canonical pair');const head=git('rev-parse','HEAD')
  git('push','origin',`${base}:refs/heads/main`,`${head}:refs/heads/feature`)
  const live={number:7,state:'open',user:{login:'u2giants'},author_association:OPERATOR_ASSOCIATION,body:'Refs #41\n\nPosted by Codex chat fixture on fixture',head:{sha:head,ref:'feature',repo:{full_name:THIS_REPO}},base:{sha:base,ref:'main',repo:{full_name:THIS_REPO}}}
  const work={number:41,state:'open',body:'```db-work-scope\nstatus: ready\nwork_type: repo-maintenance\nroute: repo-maintenance\nchange_type: reviewer-tooling\npriority: 100\nreads: []\nwrites: []\n```'}
  if(structural)Object.assign(work,{created_at:'2020-01-01T00:00:00Z',body:'```db-work-scope\nstatus: ready\nwork_type: structural\nroute: claim-first\npriority: 100\nwrites:\n  - table core.example\n```'})
  const files=[{filename:sourcePath,status:structural?'added':'modified'},{filename:'.agent/work/41/1/contract.json',status:'added'},{filename:'.agent/work/41/1/completion.json',status:'added'}]
  const proofGit={isAncestor:(a,b)=>{try{git('merge-base','--is-ancestor',a,b);return true}catch{return false}},mergeBase:(a,b)=>git('merge-base',a,b),changedFiles:(a,b)=>git('diff','--name-only',a,b).split('\n').filter(Boolean),readPublishedContract:ref=>bindingPublishedContract(ref,(command,args,options)=>execFileSync(command,args,{...options,cwd:dir}))}
  const io={getPr:()=>live,mainSha:()=>base,getPrFiles:()=>files,closingIssuesForPr:()=>[],getFileAt:(name,sha)=>git('show',`${sha}:${name}`),getIssue:()=>work,prepareNonclosingEvidenceGit:(a,b)=>git('fetch','--quiet','origin',a,b)}
  const gitRunner=(args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
  io.verifyNonclosingMaintenanceBinding=request=>verifyNonclosingMaintenanceBinding(request,io,proofGit,{gitRunner})
  io.verifyNonclosingStructuralBinding=request=>verifyNonclosingMaintenanceBinding({...request,structural:true},io,proofGit,{gitRunner})
  return {dir,git,gitRunner,put,contract,report,live,work,files,io,proofGit,head,base,close:()=>rmSync(dir,{recursive:true,force:true})}
}
test('nonclosing maintenance binding proves canonical live direct and snapshot routes through real Git',()=>{
  const f=nonclosingGitFixture()
  try{
    assert.equal(derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41}).route,'repo-maintenance')
    assert.equal(derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41,snapshot:{pr:{state:'open',head:{sha:f.head}},files:f.files,linkedIssues:[]}}).issue,41)
  }finally{f.close()}
})
test('nonclosing maintenance binding refuses metadata and canonical mismatches without body-only authority',()=>{
  const f=nonclosingGitFixture(),check=()=>derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41})
  try{
    for(const body of ['Refs #41','Refs #41\nRefs #41\nPosted by Codex chat fixture on fixture','Refs #42\nPosted by Codex chat fixture on fixture']){const old=f.live.body;f.live.body=body;assert.throws(check,/refused/);f.live.body=old}
    for(const [target,key,value] of [[f.live.user,'login','untrusted'],[f.live.head,'ref','other'],[f.live.head.repo,'full_name','other/repo'],[f.live.base,'ref','develop'],[f.live.base,'sha','a'.repeat(40)]]){const old=target[key];target[key]=value;assert.throws(check,/refused/);target[key]=old}
    const original=f.io.getFileAt
    for(const change of [r=>r.pr=8,r=>r.work_issue=42,r=>r.head_sha='a'.repeat(40),r=>r.base_sha='a'.repeat(40),r=>r.contract_ref='refs/db-contracts/41/2',r=>r.contract_sha256='a'.repeat(64),r=>r.checks=[],r=>r.stop_conditions_hit=['unknown']]){
      f.io.getFileAt=(name,sha)=>{const text=original(name,sha);if(!name.endsWith('/completion.json'))return text;const r=JSON.parse(text);change(r);return JSON.stringify(r)}
      assert.throws(check,/refused/);f.io.getFileAt=original
    }
    f.io.getFileAt=(name,sha)=>{const text=original(name,sha);if(!name.endsWith('/contract.json'))return text;const c=JSON.parse(text);c.goal='forged';return JSON.stringify(c)};assert.throws(check,/refused/);f.io.getFileAt=original
    const published=f.proofGit.readPublishedContract;f.proofGit.readPublishedContract=()=>{throw new Error('unknown published ref')};assert.throws(check,/refused/);f.proofGit.readPublishedContract=published
    const prepare=f.io.prepareNonclosingEvidenceGit;delete f.io.prepareNonclosingEvidenceGit;assert.throws(check,/reader unavailable/);f.io.prepareNonclosingEvidenceGit=prepare
    f.work.state='closed';assert.throws(check,/not deterministic ready/);f.work.state='open'
    const body=f.work.body;f.work.body=body.replace('status: ready','status: blocked');assert.throws(check,/not deterministic ready/);f.work.body=body
    f.work.number=42;assert.throws(check,/refused/);f.work.number=41
    const saved=f.files.splice(1,1);assert.throws(check,/refused/);f.files.splice(1,0,...saved)
    f.files.push({filename:'.agent/work/42/1/contract.json',status:'added'},{filename:'.agent/work/42/1/completion.json',status:'added'});assert.throws(check,/refused/)
  }finally{f.close()}
})
// Real commits and the normal immutable evidence readers remain the authority.
function advanceNonclosingMain(f,name,content){
  f.git('checkout','main');f.put(name,content);f.git('add',name);f.git('commit','-m','controlled main advance')
  const tip=f.git('rev-parse','HEAD');f.git('push','origin','main');f.git('checkout','feature');f.io.mainSha=()=>tip
  return tip
}
for(const structural of [false,true]){
  const route=structural?'structural':'maintenance'
  test(`nonclosing ${route} accepts stale API base after unrelated real code and documentation advances`,()=>{
    for(const name of ['scripts/unrelated.mjs','docs/unrelated.md']){
      const f=nonclosingGitFixture(structural)
      try{
        const tip=advanceNonclosingMain(f,name,'unrelated real source\n'),seen=[],evidenceBases=[]
        const mergeBase=f.proofGit.mergeBase;f.proofGit.mergeBase=(a,b)=>{evidenceBases.push([a,b]);return mergeBase(a,b)}
        const runner=args=>{seen.push(args);return f.gitRunner(args)}
        assert.equal(verifyNonclosingMaintenanceBinding({pr:7,headSha:f.head,files:f.files,issue:41,structural},f.io,f.proofGit,{gitRunner:runner}).issue,41)
        assert.equal(f.live.base.sha,f.base);assert.notEqual(tip,f.base)
        assert.deepEqual(evidenceBases,[[tip,f.head]])
        assert.ok(seen.some(args=>args[0]==='merge-base'&&args.includes(tip)&&args.includes(f.head)))
        if(name.endsWith('.mjs'))assert.ok(seen.some(args=>args[0]==='merge-tree'&&args.includes(tip)))
      }finally{f.close()}
    }
  })
  test(`nonclosing ${route} refuses actual source overlap and conflicting merge`,()=>{
    const f=nonclosingGitFixture(structural)
    try{
      advanceNonclosingMain(f,structural?'supabase/migrations/20260101000000_example.sql':'app.txt','conflicting source\n')
      assert.throws(()=>derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41}),/main also changed/)
    }finally{f.close()}
  })
  test(`nonclosing ${route} refuses invalid missing and divergent API bases`,()=>{
    const f=nonclosingGitFixture(structural)
    try{
      const tip=advanceNonclosingMain(f,'scripts/unrelated.mjs','unchanged canonical work\n')
      f.git('checkout','--orphan','divergent');f.put('orphan.txt','different ancestry\n');f.git('add','orphan.txt');f.git('commit','-m','different history')
      const divergent=f.git('rev-parse','HEAD');f.git('checkout','feature')
      for(const sha of ['',null,'not-a-sha','a'.repeat(40),divergent]){
        f.live.base.sha=sha
        assert.throws(()=>derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41}),/refused/)
      }
      f.live.base.sha=tip;delete f.io.prepareNonclosingEvidenceGit
      assert.throws(()=>derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41}),/reader unavailable/)
    }finally{f.close()}
  })
  test(`nonclosing ${route} refuses main head and live identity races after actual Git proof`,()=>{
    for(const mutate of [f=>f.io.mainSha=()=>f.base,f=>f.live.head.sha='a'.repeat(40),f=>f.live.head.ref='other',f=>f.live.base.ref='develop',f=>f.live.base.sha='a'.repeat(40),f=>f.live.body+='\nRefs #42',f=>f.live.state='closed',f=>f.live.head.repo.full_name='other/repo']){
      const f=nonclosingGitFixture(structural)
      try{
        advanceNonclosingMain(f,'scripts/unrelated.mjs','actual clean merge\n')
        const read=f.io.getIssue;f.io.getIssue=number=>{const work=read(number);mutate(f);return work}
        assert.throws(()=>derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41}),/moved during proof/)
      }finally{f.close()}
    }
  })
  test(`nonclosing ${route} refuses unreadable trial merge and changed complete merged diff`,()=>{
    const f=nonclosingGitFixture(structural)
    try{
      const tip=advanceNonclosingMain(f,'scripts/unrelated.mjs','actual clean merge\n')
      const request={pr:7,headSha:f.head,files:f.files,issue:41,structural}
      const conflict=args=>{if(args[0]==='merge-tree'){const e=new Error('controlled unreadable or conflict');e.status=1;throw e}return f.gitRunner(args)}
      assert.throws(()=>verifyNonclosingMaintenanceBinding(request,f.io,f.proofGit,{gitRunner:conflict}),/merging origin\/main into the head conflicts/)
      // Give the existing classifier a real, valid tree with collateral changes:
      // even an apparently successful trial merge must not alter the PR diff.
      const changed=args=>args[0]==='merge-tree'?f.gitRunner(['rev-parse',`${tip}^{tree}`]):f.gitRunner(args)
      assert.throws(()=>verifyNonclosingMaintenanceBinding(request,f.io,f.proofGit,{gitRunner:changed}),/trial merge changes the pull request's own diff/)
      const unreadable=args=>{if(args[0]==='diff')throw new Error('controlled Git read failure');return f.gitRunner(args)}
      assert.throws(()=>verifyNonclosingMaintenanceBinding(request,f.io,f.proofGit,{gitRunner:unreadable}),/could not be read|cannot be proven/)
    }finally{f.close()}
  })
}
test('nonclosing structural binding refuses duplicate migration version on actual main',()=>{
  const f=nonclosingGitFixture(true)
  try{
    advanceNonclosingMain(f,'supabase/migrations/20260101000000_different.sql','CREATE TABLE core.different (id integer);\n')
    assert.throws(()=>derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41}),/migration version collision/)
  }finally{f.close()}
})
test('nonclosing maintenance fallback never changes structural, unknown or multiple-closing routing',()=>{
  const head='a'.repeat(40),base={getPr:()=>({state:'open',head:{sha:head}}),closingIssuesForPr:()=>[],verifyNonclosingMaintenanceBinding:()=>{throw new Error('must never call nonclosing proof')}}
  for(const file of [{filename:'supabase/migrations/20260101000000_x.sql',status:'added'},{filename:'docs/new.md',status:'renamed',previous_filename:'docs/old.md'},{filename:'app.txt',status:'changed'},{filename:'app.txt',status:'copied'}])assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[file]},{headSha:head}),/must close exactly one/)
  assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'app.txt',status:'modified'}],closingIssuesForPr:()=>[{number:41},{number:42}]},{headSha:head}),/must close exactly one/)
  assert.equal(derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'supabase/migrations/20260101000000_x.sql',status:'added'}],closingIssuesForPr:()=>[{number:41}]},{headSha:head,issue:41}).route,'structural')
})

import {admitIssue as admitNonclosingIssue} from './lib/lanes/admission.mjs'
test('nonclosing structural proof refuses untrusted or stale canonical identity and route relabels',()=>{
 const f=nonclosingGitFixture(true),check=()=>derivePrOperationRoute(7,f.io,{headSha:f.head,issue:41})
 try{
  for(const [object,key,value] of [[f.live,'body','Refs #41'],[f.live,'body',f.live.body+'\nRefs #42'],[f.live,'body',f.live.body+'\nCloses #42'],[f.live.head,'sha','a'.repeat(40)],[f.live.base,'sha','a'.repeat(40)],[f.live.head,'ref','wrong'],[f.work,'state','closed'],[f.work,'body',f.work.body.replace('structural','repo-maintenance')],[f.work,'body',f.work.body.replace('status: ready','status: blocked')]]){
   const old=object[key];object[key]=value;assert.throws(check,/refused|changed/);object[key]=old
  }
  const prepare=f.io.prepareNonclosingEvidenceGit;delete f.io.prepareNonclosingEvidenceGit;assert.throws(check,/reader unavailable/);f.io.prepareNonclosingEvidenceGit=prepare
  const publish=f.proofGit.readPublishedContract;f.proofGit.readPublishedContract=()=>({...f.contract,route:'repo-maintenance'});assert.throws(check,/refused/);f.proofGit.readPublishedContract=publish
  const verify=f.io.verifyNonclosingStructuralBinding;f.io.verifyNonclosingStructuralBinding=()=>({issue:41,headSha:f.head,route:'repo-maintenance'});assert.throws(check,/structural binding is unreadable/);f.io.verifyNonclosingStructuralBinding=verify
  f.io.closingIssuesForPr=()=>[{number:41},{number:42}];assert.throws(check,/must close exactly one/)
 }finally{f.close()}
})

// #3536: ordinary silence recovery requires fully readable terminal quiet activity.
function ordinaryActivityFixture(activity){
  const fixture=silentLeaseIo(),options={...fixture.request,failedSequence:fixture.assigned.sequence,confirmNoVerdict:true,confirmNoArtifact:true}
  fixture.io.readLeaseActivity=()=>({issueComments:[],reviewComments:[],reviews:[],checkRuns:[],workflowRuns:[],...activity})
  return {...fixture,options}
}


function completeActivityResponseFixture(){
  const lease={pr:2237,headSha:'a'.repeat(40)},connection=(nodes=[])=>({totalCount:nodes.length,pageInfo:{hasNextPage:false},nodes})
  const graphql={data:{repository:{nameWithOwner:REPO,pullRequest:{number:lease.pr,headRefOid:lease.headSha,comments:connection([{id:'comment-1',updatedAt:'2026-09-04T11:00:00Z'}]),reviews:connection(),reviewThreads:connection([{comments:connection([{id:'reply-1',updatedAt:'2026-09-04T10:00:00Z'}])}])},object:{__typename:'Commit',oid:lease.headSha,statusCheckRollup:{contexts:connection([{__typename:'CheckRun',databaseId:1,status:'COMPLETED',conclusion:'SUCCESS',startedAt:'2026-09-04T10:00:00Z',completedAt:'2026-09-04T11:00:00Z'},{__typename:'StatusContext',id:'context-1',state:'SUCCESS',createdAt:'2026-09-04T11:00:00Z'}])}}}}}
  const rest={total_count:1,workflow_runs:[{id:2,head_sha:lease.headSha,status:'completed',conclusion:'success',created_at:'2026-09-04T10:00:00Z',updated_at:'2026-09-04T11:00:00Z'}]},requests=[]
  const readJson=(args)=>{requests.push(args);return args[1]==='graphql'?graphql:rest}
  return {lease,graphql,rest,requests,readJson,connection}
}
test('githubIo activity refuses partial GraphQL errors null malformed missing and foreign identity branches',()=>{
  const mutations=[
    w=>{w.graphql.errors=[{message:'partial resolver error'}]},
    w=>{w.graphql.errors={message:'malformed errors'}},
    w=>{w.graphql.data=null},w=>{w.graphql.data.repository=null},
    w=>{w.graphql.data.repository.nameWithOwner='foreign/repository'},
    w=>{w.graphql.data.repository.pullRequest=null},w=>{delete w.graphql.data.repository.pullRequest},
    w=>{w.graphql.data.repository.pullRequest.comments=null},
    w=>{w.graphql.data.repository.pullRequest.number=99},
    w=>{w.graphql.data.repository.pullRequest.headRefOid='b'.repeat(40)},
    w=>{w.graphql.data.repository.object=null},
    w=>{delete w.graphql.data.repository.object},
    w=>{w.graphql.data.repository.object.__typename='Tree'},
    w=>{w.graphql.data.repository.object.oid='b'.repeat(40)},
    w=>{w.graphql.data.repository.object.statusCheckRollup=null},
    w=>{delete w.graphql.data.repository.object.statusCheckRollup},
    w=>{w.graphql.data.repository.object.statusCheckRollup.contexts={}},
    w=>{w.graphql.data.repository.object.statusCheckRollup.contexts.pageInfo.hasNextPage=true},
    w=>{w.graphql.data.repository.object.statusCheckRollup.contexts.totalCount=3},
    w=>{delete w.graphql.data.repository.pullRequest.comments.pageInfo},
    w=>{w.graphql.data.repository.pullRequest.reviewThreads.nodes[0].comments.totalCount=2},
  ]
  for(const mutate of mutations){const wire=completeActivityResponseFixture();mutate(wire);assert.throws(()=>githubIo.readLeaseActivity(wire.lease,{readJson:wire.readJson}),/GraphQL|identity|unreadable|paginated/)}
})
function ordinaryCapacityRow(fixture){
  fixture.io.readActiveReviewLeases=()=>new Map([[fixture.leaseRef,{sha:fixture.leaseSha,commit:fixture.io.getCommit(fixture.leaseSha)}]])
  fixture.io.readReviewStates=()=>new Map([[`${fixture.request.issue}:${fixture.request.pr}`,{issue:{state:'open'},pr:fixture.io.getPr(),evidence:[]}]])
  return reviewerCapacityReport(fixture.io,new Date('2026-09-04T15:00:00Z')).reviewers.find(row=>row.held)
}

// Real connection pages preserve every verdict row before allocator classification.
import { completeReviewStatePages, reviewStateEntry } from './lib/lanes/github-wire.mjs'
function fixtureReviewStateBatch(repository,leases,{readJson,maxPages=20}={}){
  const issueCache=new Map(),prCache=new Map(),states=new Map()
  leases.forEach((lease,index)=>{const {pr,issue}=completeReviewStatePages(repository[`p${index}`],repository[`i${index}`],lease,query=>readJson(['api','graphql','-f',`query=${query}`]),{maxPages,issueCache,prCache});states.set(`${lease.issue}:${lease.pr}`,reviewStateEntry(pr,issue))})
  return states
}
function paginatedReviewFixture(){
  const time='2026-10-11T18:00:00Z',head='a'.repeat(40)
  const node=(id,review=false)=>({id,updatedAt:time,body:`evidence ${id}`,authorAssociation:'OWNER',...(review?{state:'COMMENTED',commit:{oid:head}}:{})})
  const connection=(nodes,totalCount=nodes.length,hasNextPage=false,endCursor=null)=>({totalCount,pageInfo:{hasNextPage,endCursor},nodes})
  const empty=()=>connection([])
  const pr={number:4193,updatedAt:time,state:'OPEN',merged:false,mergeCommit:null,headRefOid:head,comments:empty(),reviews:empty()}
  const issue={number:3536,updatedAt:time,state:'OPEN',comments:connection([node('c1')],2,true,'cursor1')}
  const page={...issue,comments:connection([node('c2')],2)}
  return {time,head,node,connection,pr,issue,page,repository:{p0:pr,i0:issue},leases:[{issue:3536,pr:4193}]}
}
test('paginated reviewer evidence follows cursor and retains every body and association',()=>{
  const f=paginatedReviewFixture(),queries=[]
  const states=fixtureReviewStateBatch(f.repository,f.leases,{readJson(args){queries.push(args.at(-1));return {data:{repository:{x:queries.length===1?f.page:f.issue}}}}})
  assert.equal(queries.length,2);assert.match(queries[0],/after:"cursor1"/);assert.doesNotMatch(queries[1],/after:/)
  assert.deepEqual(states.get('3536:4193').evidence.map(r=>r.body),['evidence c1','evidence c2'])
  assert.equal(states.get('3536:4193').evidence[1].authorAssociation,'OWNER')
})
test('paginated shared issue is read once per batch and ordinary evidence adds no reads',()=>{
  const f=paginatedReviewFixture();f.repository.p1={...f.pr,number:4194};f.repository.i1=structuredClone(f.issue);f.leases.push({issue:3536,pr:4194});let calls=0
  const states=fixtureReviewStateBatch(f.repository,f.leases,{readJson(){return {data:{repository:{x:++calls===1?f.page:f.issue}}}}})
  assert.equal(calls,2);assert.equal(states.size,2)
  f.issue.comments=f.connection([]);f.repository.i1=structuredClone(f.issue)
  fixtureReviewStateBatch(f.repository,f.leases,{readJson(){assert.fail('ordinary batch must not add a read')}})
})
test('paginated PR comments and commit-bound reviews both complete',()=>{
  const f=paginatedReviewFixture();f.issue.comments=f.connection([])
  f.pr.comments=f.connection([f.node('p1')],2,true,'comments1');f.pr.reviews=f.connection([f.node('r1',true)],2,true,'reviews1')
  const states=fixtureReviewStateBatch(f.repository,f.leases,{readJson(args){const query=args.at(-1),review=query.includes('reviews(first:100'),name=review?'reviews':'comments';return {data:{repository:{x:query.includes('after:')?{...f.pr,[name]:f.connection([f.node(review?'r2':'p2',review)],2)}:f.pr}}}}})
  const rows=states.get('3536:4193').evidence;assert.equal(rows.length,4);assert.equal(rows[3].commit_id,f.head)
})


test('#4348 reviewer-budget PR file inventory follows pages and fails closed past the cap',async()=>{
  const {ghPaginated,withReviewRequestBudget}=await import('./manage-migration-author-lanes.mjs')
  const row=(i)=>({filename:`docs/f${i}.md`,status:'modified'})
  const pages={1:Array.from({length:100},(_,i)=>row(i)),2:Array.from({length:12},(_,i)=>row(100+i))}
  const seen=[]
  const readJson=([,url])=>{seen.push(url);return pages[Number(/page=(\d+)$/.exec(url)[1])]??[]}
  const rows=withReviewRequestBudget(()=>ghPaginated('repos/x/y/pulls/7/files?per_page=100',{readJson}),50,'test-op')
  assert.equal(rows.length,112)
  assert.deepEqual(seen,['repos/x/y/pulls/7/files?per_page=100&page=1','repos/x/y/pulls/7/files?per_page=100&page=2'])
  const full=()=>Array.from({length:100},(_,i)=>row(i))
  assert.throws(()=>withReviewRequestBudget(()=>ghPaginated('repos/x/y/pulls/7/files?per_page=100',{readJson:full}),50,'test-op'),/10-page file-inventory cap/)
  assert.throws(()=>withReviewRequestBudget(()=>ghPaginated('repos/x/y/pulls/7/files?per_page=100',{readJson:()=>null}),50,'test-op'),/incomplete or malformed/)
  assert.throws(()=>withReviewRequestBudget(()=>ghPaginated('repos/x/y/issues/7/labels?per_page=100',{readJson:full}),50,'test-op'),/reached 100 rows/)
})

test('real flowAdapter admits only qualified closed merged proof selectors without changing custody',()=>{
 const prior=process.env.SHARED_DB_SESSION_ID;process.env.SHARED_DB_SESSION_ID='codex-closed-selector-test';
 try {
  function fixture(){
   const {io}=mergedRehearsalIo(),claim={...io.openClaims()[0],state:'closed'};
   const getWork=io.getIssue;io.getIssue=n=>Number(n)===claim.number?claim:getWork(n);
   io.openClaims=()=>[];io.closedClaimsForWork=()=>[claim];let writes=0;
   io.createRef=()=>{writes++;throw new Error('unexpected ready mutation')};
   return {io,claim,writes:()=>writes,adapter:(admission={admitIssue:1769,pr:1809})=>githubIo.flowAdapter.call(io,claim.number,admission)};
  }
  const good=fixture();assert.equal(good.adapter().resolveMarker().live,true);assert.match(good.claim.body,/owner: agent\/issue-1769/);assert.equal(good.writes(),0);
  const open=fixture();open.claim.state='open';open.io.openClaims=()=>[open.claim];assert.equal(open.adapter().resolveMarker().live,false);assert.equal(open.writes(),0);
  for(const change of [
   f=>{f.io.branchPulls=()=>[]},
   f=>{f.io.mergeCommitInMain=()=>false},
   f=>{f.io.getIssue=()=>null},
   f=>{f.claim.body='malformed'},
   f=>{f.claim.title='CLAIM: #1769 #1770'},
   f=>{const original=f.io.branchPulls;f.io.branchPulls=b=>[...original(b),{...original(b)[0],number:1810}]},
   f=>{f.io.openClaims=()=>[{...f.claim,state:'open'}]},
  ]){const f=fixture();change(f);assert.throws(()=>f.adapter().resolveMarker());assert.equal(f.writes(),0);}
  const mismatch=fixture();assert.throws(()=>mismatch.adapter({admitIssue:1769,pr:1810}).resolveMarker(),/not the admitted/);assert.equal(mismatch.writes(),0);
  const undeclared=fixture();delete process.env.SHARED_DB_SESSION_ID;assert.equal(undeclared.adapter().resolveMarker().live,false);
 } finally {if(prior===undefined)delete process.env.SHARED_DB_SESSION_ID;else process.env.SHARED_DB_SESSION_ID=prior;}
});

test('curated claim objects are limited to exact core tables (#2599)',async()=>{
  const {requireCuratedClaimObjects}=await import('./manage-migration-author-lanes.mjs')
  assert.doesNotThrow(()=>requireCuratedClaimObjects(['table core.property','table core.taxonomy_source_ref'],2599))
  assert.throws(()=>requireCuratedClaimObjects([],2599),/at least one exact core/)
  assert.throws(()=>requireCuratedClaimObjects(['table plm.item'],2599),/only curated core/)
  assert.throws(()=>requireCuratedClaimObjects(['function core.f()'],2599),/only curated core/)
  // #5079: the resolution home written through plm.set_source_resolution() may be claimed; no other plm table
  assert.doesNotThrow(()=>requireCuratedClaimObjects(['table core.character','table plm.source_resolution'],5079))
  assert.throws(()=>requireCuratedClaimObjects(['table plm.opa_character'],5079),/only curated core/)
  assert.throws(()=>requireCuratedClaimObjects(['table plm.source_resolution'],5079),/at least one exact core/)
})

test('curated SQL reports plm.set_source_resolution calls as plm.source_resolution writes (#5079)',async()=>{
  const {inspectCuratedSql}=await import('./db-flow/curated-admission.mjs')
  const call="do $x$ begin perform plm.set_source_resolution('nbcu','character',c.code,'matched',null,c.id,null,null,'r',null) from core.character c; end $x$;"
  assert.deepEqual([...inspectCuratedSql(call).writes].sort(),['table plm.source_resolution'])
  assert.throws(()=>inspectCuratedSql("select plm.other_setter('a');"),/not an allowed side-effect-free builtin/)
  assert.throws(()=>inspectCuratedSql("select plm.\"set_source_resolution\"('a','character','1','unresolved');"),/bare name/)
  assert.throws(()=>inspectCuratedSql("select \"plm\".set_source_resolution('a','character','1','unresolved');"),/not an allowed side-effect-free builtin/)
  assert.throws(()=>inspectCuratedSql("update plm.opa_character set core_character_id = null where character_id = 1;"),/outside curated Master Data/)
  assert.throws(()=>inspectCuratedSql("insert into plm.source_resolution (source_id) values ('x');"),/outside curated Master Data/)
})
