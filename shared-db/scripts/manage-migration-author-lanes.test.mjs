import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireAuthorLane, acquireExclusive, assertLaneAvailable, assignNextReviewer, buildDynamicQueues, claimBody, EXCLUSIVE_REFS, LaneError, main, MUTEX_RECOVERY_ACTIVE_REF, MUTEX_REF, parseAuthorLease, parseQueueScope, readRefAfterWrite, recoverStaleAuthorMutex, releaseOwnedRef, requireOwnedRef, REVIEW_CURSOR_REF, validateClaimObjects } from './manage-migration-author-lanes.mjs'

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
  io.makeOwnerCommit=(message)=>{const sha=`review-${++seq}`;commits.set(sha,{message});return sha}
  io.getCommit=(sha)=>commits.get(sha)
  io.updateRef=(ref,sha)=>io.refs.set(ref,sha)
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
