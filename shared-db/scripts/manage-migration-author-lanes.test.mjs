import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireAuthorLane, acquireExclusive, assertLaneAvailable, assignNextReviewer, buildDynamicQueues, claimBody, expandActiveClaimFromPr, EXCLUSIVE_REFS, LaneError, main, MUTEX_RECOVERY_ACTIVE_REF, MUTEX_REF, parseAuthorLease, parseQueueScope, readRefAfterWrite, recoverSameOwnerSplit, recoverStaleAuthorMutex, releaseOwnedRef, replaceFailedReviewer, requireOwnedRef, REVIEW_CURSOR_REF, validateClaimObjects } from './manage-migration-author-lanes.mjs'

const NOW = new Date('2026-08-14T20:00:00Z')
const body = (objects, owner, expires = '2026-08-15T08:00:00.000Z') => claimBody({ version:`2026081420${owner.padStart(4,'0')}`, objects, owner:`agent-${owner}`, branch:`codex/${owner}`, worktree:`C:/w/${owner}`, expiresAt:new Date(expires) })

const scope = (state, priority, objects=[], depends='') => `\`\`\`db-work-scope\nstate: ${state}\npriority: ${priority}\ndepends_on: ${depends}\nobjects:\n${objects.map((x)=>`  - ${x}`).join('\n')}\n\`\`\``

test('queue scope is strict and requires objects for eligible work',()=>{
  assert.deepEqual(parseQueueScope(scope('eligible',9,['table core.a'],'#12, 13')), {state:'eligible',priority:9,dependencies:[12,13],objects:['table core.a']})
  assert.throws(()=>parseQueueScope(scope('eligible',1)),/must list exact objects/)
  assert.throws(()=>parseQueueScope(scope('waiting',1,['table core.a'])),/state must be/)
  assert.throws(()=>parseQueueScope(`${scope('eligible',1,['table core.a'])}\n${scope('blocked',1)}`),/exactly one/)
})

test('dynamic queues serialize overlapping work and refill every empty lane',()=>{
  const issues=[
    {number:1,title:'a',body:scope('eligible',10,['table core.a'])},
    {number:2,title:'a later',body:scope('eligible',8,['table core.a'])},
    {number:3,title:'b',body:scope('eligible',7,['table core.b'])},
    {number:4,title:'c',body:scope('eligible',6,['table core.c'])},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.equal(result.fullyAudited,true)
  assert.deepEqual(new Set(result.dispatchable),new Set([1,3,4]))
  assert.ok(result.queues.some((q)=>q.queued.join(',')==='1,2'))
})

test('dynamic queues fill inactive lanes before queueing behind active claims',()=>{
  const claims=[{number:31,body:body(['table core.a'],'31')},{number:32,body:body(['table core.b'],'32')}]
  const one=buildDynamicQueues([{number:40,title:'c',body:scope('eligible',9,['table core.c'])}],claims,NOW)
  assert.deepEqual(one.dispatchable,[40])
  assert.equal(one.queues.find((q)=>q.queued.includes(40)).active,null)
  const two=buildDynamicQueues([
    {number:40,title:'c',body:scope('eligible',9,['table core.c'])},
    {number:41,title:'d',body:scope('eligible',8,['table core.d'])},
  ],[{number:31,body:body(['table core.a'],'31')}],NOW)
  assert.deepEqual(new Set(two.dispatchable),new Set([40,41]))
})

test('blocked, owner-decision, data-only and dependent work never consume a lane',()=>{
  const issues=[
    {number:10,title:'open dependency',body:scope('blocked',9)},
    {number:11,title:'dependent',body:scope('eligible',8,['table core.x'],'#10')},
    {number:12,title:'owner',body:scope('owner-decision',7)},
    {number:13,title:'data',body:scope('data-only',6)},
    {number:14,title:'app',body:scope('non-structural',5)},
  ]
  const result=buildDynamicQueues(issues,[],NOW)
  assert.deepEqual(result.dispatchable,[])
  assert.equal(result.skipped.length,5)
  assert.equal(result.fullyAudited,true)
})

test('dependency on an open non-db-work issue prevents dispatch',()=>{
  const issues=[{number:11,title:'dependent',body:scope('eligible',8,['table core.x'],'#99')}]
  const result=buildDynamicQueues(issues,[],NOW,[11,99])
  assert.deepEqual(result.dispatchable,[])
  assert.match(result.skipped[0].reason,/99/)
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
  assert.deepEqual(names,['grok-4.6','glm-5.2','kimi-k3','qwen-3.8-max','grok-4.6'])
  assert.ok(io.refs.has(REVIEW_CURSOR_REF))
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
  assert.equal(first.sequence,2);assert.equal(first.reviewer,'glm-5.2');assert.deepEqual(second,first)
  assert.equal(assignNextReviewer(failedReview,io).reviewer,'glm-5.2')
  assert.equal(assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io).reviewer,'kimi-k3')
})

test('reviewer replacement rejects mismatched original assignment and preserves intervening rotation',()=>{
  const io=failedReviewIo()
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:2},io),/does not match/)
  assignNextReviewer({issue:10,pr:110,headSha:'abcdefa'},io)
  const replacement=replaceFailedReviewer(replacementRequest,io)
  assert.equal(replacement.priorSequence,2);assert.equal(replacement.sequence,3);assert.equal(replacement.reviewer,'kimi-k3')
})

test('reviewer replacement rejects a substantive exact-head verdict',()=>{
  const io=failedReviewIo();io.getPrReviews=()=>[{body:`REVISE ${failedReview.headSha}`}]
  assert.throws(()=>replaceFailedReviewer(replacementRequest,io),/existing verdict/)
  const stateIo=failedReviewIo();stateIo.getPrReviews=()=>[{body:'',commit_id:failedReview.headSha,state:'APPROVED'}]
  assert.throws(()=>replaceFailedReviewer(replacementRequest,stateIo),/existing verdict/)
})

test('reviewer replacement retry rejects mismatched failure sequence and missing evidence',()=>{
  const io=failedReviewIo(), done=replaceFailedReviewer(replacementRequest,io)
  assert.throws(()=>replaceFailedReviewer({...replacementRequest,failedSequence:2},io),/does not match/)
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
  const io=memoryIo(),issue={number:1063,state:'open',body:claimBody({version:'20260816063532',objects:['index plm.item_upper_trim_item_number_idx'],owner:'codex-issue-853-orderlist',branch:'codex/issue-853-orderlist-index',worktree:'C:\\repos\\shared-db-wt-853-index',expiresAt:new Date('2026-08-17T00:00:00Z')})}
  io.refs.set('refs/db-claims/20260816063532','reserved');io.getIssue=()=>structuredClone(issue);io.updateIssue=(_n,fields)=>{Object.assign(issue,fields);return structuredClone(issue)}
  io.getPr=()=>({state:'open',head:{sha:'head',ref:'codex/issue-853-orderlist-index'}});io.getPrFiles=()=>[{status:'added',filename:'supabase/migrations/20260816063532_index.sql'}];io.openClaims=()=>[structuredClone(issue)]
  io.prSources=()=>[{label:'PR #1065 [DRAFT] "index"',objects:['index plm.item_upper_trim_item_number_idx','table plm.item'],versions:['20260816063532']}]
  return Object.assign(io,{issue},overrides)
}
const expansionOptions={claim:1063,pr:1065,owner:'codex-issue-853-orderlist',headSha:'head',branch:'codex/issue-853-orderlist-index',worktree:'C:\\repos\\shared-db-wt-853-index',requestId:'expand',mutexAttempts:1}
test('active claim expansion adds exactly the parser-proven uncovered object',()=>{
  const io=expansionIo(),result=expandActiveClaimFromPr(expansionOptions,NOW,io);assert.deepEqual(result.added,['table plm.item']);assert.deepEqual(parseAuthorLease(io.issue.body,NOW).objects,['index plm.item_upper_trim_item_number_idx','table plm.item'])
})
test('active claim expansion rejects arbitrary extras, collisions, stale lease, and changed binding',()=>{
  let io=expansionIo();io.prSources=()=>[{label:'PR #1065 "x"',objects:['index plm.item_upper_trim_item_number_idx','table plm.item','table plm.extra'],versions:['20260816063532']}];assert.throws(()=>expandActiveClaimFromPr(expansionOptions,NOW,io),/exactly table plm.item/)
  io=expansionIo();io.openClaims=()=>[io.getIssue(),{number:9,body:claimBody({version:'20260816070000',objects:['table plm.item'],owner:'other',branch:'other',worktree:'C:/other',expiresAt:new Date('2026-08-17T00:00:00Z')})}];assert.throws(()=>expandActiveClaimFromPr(expansionOptions,NOW,io),/collision/)
  io=expansionIo();io.issue.body=io.issue.body.replace('2026-08-17T00:00:00.000Z','2026-08-14T19:00:00.000Z');assert.throws(()=>expandActiveClaimFromPr(expansionOptions,NOW,io),/expired/)
  io=expansionIo();assert.throws(()=>expandActiveClaimFromPr({...expansionOptions,headSha:'wrong'},NOW,io),/head or branch changed/)
})
test('active claim expansion rolls back an ambiguous update failure while mutex-owned',()=>{
  const io=expansionIo(),before=io.issue.body;io.updateIssue=(_n,fields)=>{Object.assign(io.issue,fields);if(fields.body!==before)throw new LaneError('connection lost');return io.getIssue()}
  assert.throws(()=>expandActiveClaimFromPr(expansionOptions,NOW,io),/connection lost/);assert.equal(io.issue.body,before)
})
test('REAL main command wires claim-number into the incident-pinned expansion',()=>{
  const io=expansionIo(),args=['--expand-active-claim-from-pr','--claim-number','1063','--pr','1065','--owner','codex-issue-853-orderlist','--head-sha','head','--branch','codex/issue-853-orderlist-index','--worktree','C:\\repos\\shared-db-wt-853-index']
  assert.equal(main(args,NOW,io),0);assert.ok(parseAuthorLease(io.issue.body,NOW).objects.includes('table plm.item'))
})
