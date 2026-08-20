import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTIVE_REVIEWERS, addedMigrationVersions, assertMergeCommitInMainHistory, REVIEWERS, RETIRED_REVIEWERS, acquireAuthorLane, acquireExclusive, assertLaneAvailable, assignNextReviewer, buildDynamicQueues, claimBody, createRefWithReadback, deleteRefWithReadback, expandActiveClaimFromIssue, expandActiveClaimFromPr, EXCLUSIVE_REFS, githubIo, isConfirmedRefAbsence, LaneError, main, MUTEX_RECOVERY_ACTIVE_REF, MUTEX_REF, parseAuthorLease, parseQueueScope, readPrAfterPush, readRefAfterWrite, recoverSameOwnerSplit, recoverStaleAuthorMutex, releaseOwnedRef, replaceFailedReviewer, requireOwnedRef, renewExpiredClaim, reviewerExecutionPreflight, reversionActiveClaim, runGitHubCommand, supersedeActiveClaimVersion, REVIEW_CURSOR_REF, REVIEW_REPLACEMENT_REF_PREFIX, validateClaimObjects } from './manage-migration-author-lanes.mjs'

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

const scope = (status, workType, route, priority, objects=[], depends='') => `\`\`\`db-work-scope\nstatus: ${status}\nwork_type: ${workType}\nroute: ${route}\npriority: ${priority}\ndepends_on: ${depends}\nobjects:\n${objects.map((x)=>`  - ${x}`).join('\n')}\n\`\`\``

test('queue scope keeps status, work type, and route separate',()=>{
  assert.deepEqual(parseQueueScope(scope('ready','structural','shared-db-orchestrator',9,['table core.a'],'#12, 13')), {status:'ready',workType:'structural',route:'shared-db-orchestrator',priority:9,dependencies:[12,13],objects:['table core.a']})
  assert.throws(()=>parseQueueScope(scope('ready','structural','shared-db-orchestrator',1)),/must list exact objects/)
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

test('legacy claims count toward the three-lane cap and always protect objects', () => {
  const legacy = (n, object) => ({ number:n, body:`\`\`\`db-claim\nversion: none\nobjects:\n  - ${object}\n\`\`\`` })
  assert.throws(() => assertLaneAvailable([legacy(1,'table core.a'),legacy(2,'table core.b'),legacy(3,'table core.c')], ['table core.d'], NOW), /all 3/)
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
  for(let n=1;n<=5;n++)names.push(assignNextReviewer({issue:n,pr:100+n,headSha:`abcdef${n}`},io).reviewer)
  assert.deepEqual(names,['grok-4.6','glm-5.3','muse-spark-1.2-contributor','grok-4.6','glm-5.3'])
  assert.ok(io.refs.has(REVIEW_CURSOR_REF))
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
  assert.deepEqual(ACTIVE_REVIEWERS.map((r)=>r.name),['grok-4.6','glm-5.3','muse-spark-1.2-contributor'])
  assert.equal(REVIEWERS.find((r)=>r.name==='glm-5.3').wrapper,'ai-glm')
  assert.equal(REVIEWERS.find((r)=>r.name==='muse-spark-1.2-contributor').wrapper,'ai-muse')
})

test('reviewer assignment retry returns the same assignment without advancing',()=>{
  const io=reviewIo(), request={issue:9,pr:109,headSha:'abcdef9'}
  const first=assignNextReviewer(request,io), second=assignNextReviewer(request,io)
  assert.deepEqual(second,first)
  assert.equal(second.sequence,1)
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

const failedReview={issue:9,pr:109,headSha:'abcdef9000000000000000000000000000000000'}
function failedReviewIo(){const io=reviewIo();io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}});assignNextReviewer(failedReview,io);return io}
const replacementRequest={...failedReview,failedSequence:1,failureCode:'insufficient_quota',confirmNoVerdict:true,confirmNoArtifact:true}

test('terminal provider failure advances exactly once and retry is idempotent',()=>{
  const io=failedReviewIo(), first=replaceFailedReviewer(replacementRequest,io), second=replaceFailedReviewer(replacementRequest,io)
  assert.equal(first.sequence,2);assert.equal(first.reviewer,'glm-5.3');assert.deepEqual(second,first)
  assert.equal(assignNextReviewer(failedReview,io).reviewer,'glm-5.3')
  assert.equal(assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io).reviewer,'muse-spark-1.2-contributor')
})

test('reviewer execution preflight enforces approved wrapper, clean worktree, and exact head',()=>{
  const io={commandAvailable:()=>true,localHead:()=>failedReview.headSha,localClean:()=>true}
  const request={reviewer:'grok-4.6',wrapper:'ai-grok-review',worktree:'C:/review',headSha:failedReview.headSha}
  assert.equal(reviewerExecutionPreflight(request,io).ready,true)
  assert.throws(()=>reviewerExecutionPreflight({...request,wrapper:'ai-qwen'},io),/exact wrapper/)
  assert.throws(()=>reviewerExecutionPreflight(request,{...io,commandAvailable:()=>false}),/cannot execute/)
  assert.throws(()=>reviewerExecutionPreflight(request,{...io,localHead:()=> 'f'.repeat(40)}),/exact assigned head/)
  assert.throws(()=>reviewerExecutionPreflight(request,{...io,localClean:()=>false}),/dirty/)
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
  assert.equal(first.sequence,2);assert.equal(second.sequence,3);assert.equal(second.reviewer,'muse-spark-1.2-contributor')
  assert.deepEqual(replaceFailedReviewer(replacementRequest,io),first)
  assert.deepEqual(replaceFailedReviewer(secondRequest,io),second)
  assert.equal(assignNextReviewer(failedReview,io).sequence,3)
  assert.equal([...io.refs.keys()].filter((ref)=>ref.startsWith(REVIEW_REPLACEMENT_REF_PREFIX)).length,2)
})

test('chained replacement rejects mismatch, exact-head drift, and a verdict at every depth',()=>{
  const io=failedReviewIo(), first=replaceFailedReviewer(replacementRequest,io)
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence+1},io),/does not match/)
  io.getPr=()=>({state:'open',head:{sha:'ffffffffffffffffffffffffffffffffffffffff'}})
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:first.sequence,failureCode:'provider_unavailable'},io),/exact open PR head/)
  io.getPr=()=>({state:'open',head:{sha:failedReview.headSha}})
  io.getPrReviews=()=>[{body:`APPROVE ${failedReview.headSha}`}]
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

// THE SAME-PROVIDER WRAPAROUND REFUSE. replaceFailedReviewer picks
// ACTIVE_REVIEWERS[(sequence-1) % N] and REFUSES when that lands on the provider that
// just failed. It is correct and fail-closed -- retrying a dead provider is worse --
// but it means a replacement can be unavailable, and the operator needs to know
// exactly when.
//
// It fires after N-1 assignments since the failure, for ANY N. Going from the
// two-name roster to the three-name roster in #1290 moved that from ONE intervening
// assignment to TWO. It did NOT remove it. An earlier version of this test asserted
// `ACTIVE_REVIEWERS.length % 2 !== 0` as though odd length were the fix; a review
// showed that is a false invariant, and it is deliberately not asserted here.
//
// Two intervening assignments is not an exotic case: it is the natural rest point of a
// three-name parallel dispatch. Grok takes a PR (and holds ai-grok-review's per-repo
// in-flight lock), GLM takes the next, Muse takes the third, and the cursor sits on a
// multiple of three. Both halves are pinned below, with the exact successor named.
test('one intervening assignment gives a failed reviewer a named replacement',()=>{
  assert.equal(ACTIVE_REVIEWERS.length,3,'this test describes the three-reviewer rotation')
  const io=failedReviewIo()
  assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io)
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(replacement.reviewer,'muse-spark-1.2-contributor')
})

test('N-1 intervening assignments still strand a replacement on the failed provider',()=>{
  const io=failedReviewIo()
  for(let n=0;n<ACTIVE_REVIEWERS.length-1;n+=1){
    assignNextReviewer({issue:20+n,pr:120+n,headSha:`abcde${n}f`},io)
  }
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/same failed provider/)
})

test('reviewer replacement rejects a substantive exact-head verdict',()=>{
  const io=failedReviewIo();io.getPrReviews=()=>[{body:`REVISE ${failedReview.headSha}`}]
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/existing verdict/)
  const stateIo=failedReviewIo();stateIo.getPrReviews=()=>[{body:'',commit_id:failedReview.headSha,state:'APPROVED'}]
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
  io.getPr=()=>({merged:false})
  assert.throws(()=>acquireExclusive('preview-recovery',{owner:'recovery',pr:924,headSha:'main'},io),/already-merged/)
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
    child.on('error',reject);child.on('close',code=>resolve({code,json:JSON.parse(out),err}))
  }))
  return Promise.all(runs).finally(()=>rmSync(store,{recursive:true,force:true}))
}

test('REAL PROCESS RACE: two independent CLIs claiming one object produce exactly one winner',async()=>{
  const results=await raceWorkers(['table core.same','table core.same'])
  assert.equal(results.filter(x=>x.json.ok).length,1)
  assert.equal(results.filter(x=>!x.json.ok&&/collision/.test(x.json.error)).length,1)
})

test('REAL PROCESS RACE: four independent CLIs claiming unrelated objects admit exactly three',async()=>{
  const results=await raceWorkers(['table core.a','table core.b','table core.c','table core.d'])
  assert.equal(results.filter(x=>x.json.ok).length,3)
  assert.equal(results.filter(x=>!x.json.ok&&/all 3/.test(x.json.error)).length,1)
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

test('claim renewal rejects missing, closed, blocked, or wrong-route issue binding',()=>{
  for(const mutate of [io=>io.workIssue.state='closed',io=>io.workIssue.body=scope('blocked','structural','shared-db-orchestrator',900,io.objects),io=>io.workIssue.body=scope('ready','repo-maintenance','repo-maintenance',900)]){
    const io=renewalIo();mutate(io);assert.throws(()=>renewExpiredClaim(renewalOptions,NOW,io),/open ready structural/)
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

test('claim renewal is idempotent for the exact already-written expiry',()=>{
  const io=renewalIo();renewExpiredClaim(renewalOptions,NOW,io);const once=io.issue.body
  const result=renewExpiredClaim(renewalOptions,NOW,io);assert.equal(result.idempotent,true);assert.equal(io.issue.body,once)
})

test('claim renewal rolls back readback failure while mutex-owned and refuses after ownership loss',()=>{
  let io=renewalIo(),before=io.issue.body,reads=0,baseGet=io.getIssue
  io.getIssue=(number)=>{const value=baseGet(number);if(Number(number)===1058&&++reads===2)value.body+='\nbad';return value}
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
