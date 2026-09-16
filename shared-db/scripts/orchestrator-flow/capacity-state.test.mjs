import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WORKTREE_STATES, assertLaneAvailable, buildDynamicQueues, claimBody,
  expandActiveClaimFromIssue, expandActiveClaimFromPr, main, parseAuthorLease,
  recoverExpiredClaimFromPr, relinquishAuthorLease, renewExpiredClaim, resumeAuthorLease,
} from '../manage-migration-author-lanes.mjs'

const NOW=new Date('2026-08-28T12:00:00Z')
const body=(number,{capacityState='active',blockedOn=null,worktreeState=capacityState==='relinquished'?'clean':null,recoveryArtifact=null,expiresAt=new Date('2026-08-29T00:00:00Z')}={})=>claimBody({
  version:`20260828${String(number).padStart(6,'0')}`,
  objects:[`table test.t_${number}`],owner:`owner-${number}`,branch:`branch-${number}`,
  worktree:`C:/work/${number}`,expiresAt,capacityState,blockedOn,worktreeState,recoveryArtifact,
})

test('lease parser accepts the complete relinquishment tuple and rejects contradictory authority',()=>{
  for(const worktreeState of WORKTREE_STATES){
    const lease=parseAuthorLease(body(1,{capacityState:'relinquished',blockedOn:'issue:#900',worktreeState,recoveryArtifact:'artifact:'+'a'.repeat(40)}),NOW)
    assert.equal(lease.worktreeState,worktreeState)
    assert.equal(lease.recoveryArtifact,'artifact:'+'a'.repeat(40))
  }
  assert.throws(()=>body(1,{capacityState:'expired-unconfirmed'}),/capacityState must be one of/)
  assert.throws(()=>body(1,{capacityState:'relinquished',blockedOn:'issue:#900',worktreeState:null}),/requires worktreeState/)
  assert.throws(()=>body(1,{worktreeState:'clean'}),/only for relinquished/)
  assert.throws(()=>body(1,{recoveryArtifact:'artifact:'+'a'.repeat(40)}),/only for relinquished/)
  assert.throws(()=>body(1,{capacityState:'relinquished',blockedOn:'issue:#900',worktreeState:'unknown'}),/requires worktreeState/)
  assert.throws(()=>body(1,{capacityState:'relinquished',blockedOn:'issue:#900',recoveryArtifact:'artifact:mutable',worktreeState:'clean'}),/immutable-url-or-hash/)
  const active=body(1)
  for(const line of [
    'capacity_state: expired-unconfirmed',
    'worktree_state: clean',
    'recovery: artifact:'+'a'.repeat(40),
    'mystery: value',
  ]) assert.throws(()=>parseAuthorLease(active.replace('capacity_state: active',`capacity_state: active\n${line}`),NOW),/unreadable|capacity_state must be|only for relinquished|unknown field/)
  assert.throws(()=>parseAuthorLease(active.replace('owner: owner-1','owner: owner-1\nowner: duplicate'),NOW),/unreadable/)
})

test('pre-Phase-A relinquished fences remain protected but are recovery blocked',()=>{
  const legacyBody=body(1,{capacityState:'relinquished',blockedOn:'issue:#900'}).replace(/^worktree_state:.*\r?\n/m,'')
  const lease=parseAuthorLease(legacyBody,NOW)
  assert.equal(lease.capacityActive,false)
  assert.equal(lease.worktreeState,'unknown-legacy')
  assert.equal(lease.relinquishmentMetadataLegacy,true)
})

test('relinquished claims protect objects without consuming active capacity',()=>{
  const claims=Array.from({length:8},(_,index)=>({number:index+1,body:body(index+1,{capacityState:'relinquished',blockedOn:'issue:#900'})}))
  const result=assertLaneAvailable(claims,['table test.new'],NOW)
  assert.equal(result.protected.length,8)
  assert.equal(result.active.length,0)
  assert.throws(()=>assertLaneAvailable(claims,['table test.t_8'],NOW),/collision/)
})

test('clock expiry keeps object protection and never refuses unrelated work (no lane cap)',()=>{
  const expired=Array.from({length:60},(_,index)=>({number:index+1,body:body(index+1,{expiresAt:new Date('2026-08-28T11:00:00Z')})}))
  assert.equal(parseAuthorLease(expired[0].body,NOW).capacityState,'expired-unconfirmed')
  assert.equal(assertLaneAvailable(expired,['table test.new'],NOW).active.length,60)
  assert.throws(()=>assertLaneAvailable(expired,['table test.t_7'],NOW),/collision/)
})

test('protected relinquished claims each keep their own visible lane',()=>{
  const claims=Array.from({length:8},(_,index)=>({number:index+1,body:body(index+1,{capacityState:'relinquished',blockedOn:'issue:#900'})}))
  const result=buildDynamicQueues([],claims,NOW)
  assert.equal(result.queues.flatMap((queue)=>queue.protected).length,8)
  assert.equal(result.queues.length,8)
  assert.equal(result.emptyLanes,8)
})

function memoryIo(){
  const refs=new Map(),comments=[],issues=new Map(),artifacts=new Set()
  const claim={number:77,state:'open',title:'CLAIM: #42 throughput fixture',body:body(77)}
  issues.set(77,claim);issues.set(42,{number:42,state:'open',body:''});issues.set(900,{number:900,state:'open',body:''})
  refs.set('refs/db-claims/20260828000077','reservation')
  let serial=0
  return {
    comments,issues,
    makeOwnerCommit:()=>`owner-${++serial}`,
    createRef:(name,sha)=>{if(refs.has(name))return false;refs.set(name,sha);return true},
    readRef:(name)=>refs.get(name)??null,
    // #2301 Step 3: the retirement guard asks this double which versions are
    // terminally retired. Answer from the real ref map -- a hard-coded [] would
    // report "nothing is retired" without ever being asked.
    listRefs:(prefix)=>[...refs].filter(([name])=>name===prefix||name.startsWith(`${prefix}/`)).map(([ref,sha])=>({ref,sha})),
    readCommitMessage:()=>null,
    deleteRef:(name)=>{refs.delete(name)},
    getCommitMessage:()=>'',
    openClaims:()=>[structuredClone(issues.get(77))],
    getIssue:(number)=>structuredClone(issues.get(Number(number))),
    updateIssue:(number,{body:newBody})=>{issues.get(Number(number)).body=newBody},
    localClean:()=>true,
    artifacts,
    verifyArtifact:(reference)=>artifacts.has(String(reference))?{kind:'git-object',type:'blob'}:null,
    prSources:()=>[],
    commentIssue:(number,comment)=>comments.push({number,body:comment}),
  }
}

test('guarded relinquish and resume preserve the claim and write replayable events',()=>{
  const io=memoryIo()
  const relinquished=relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,io)
  assert.equal(relinquished.capacityState,'relinquished')
  assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).capacityActive,false)
  const resumed=resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io)
  assert.equal(resumed.capacityState,'active')
  assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).active,true)
  assert.equal(io.comments.length,4)
})

test('resume excludes only the protected claim own open pull request',()=>{
  const io=memoryIo()
  relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,io)
  io.prSources=()=>[{label:'PR #78',branch:'branch-77',objects:['table test.t_77'],versions:['20260828000077']}]
  const resumed=resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io)
  assert.equal(resumed.capacityState,'active')
  assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).capacityActive,true)
})

test('resume preserves every foreign claim and pull-request collision',()=>{
  for(const collision of ['claim','pull request']){
    const io=memoryIo()
    relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,io)
    io.prSources=()=>[{label:'PR #78',branch:'branch-77',objects:['table test.t_77'],versions:['20260828000077']}]
    if(collision==='claim'){
      const original=io.openClaims
      io.openClaims=()=>[...original(),{number:88,state:'open',body:body(88).replace('table test.t_88','table test.t_77')}]
    }else{
      io.prSources=()=>[
        {label:'PR #78',branch:'branch-77',objects:['table test.t_77'],versions:['20260828000077']},
        {label:'PR #89',branch:'branch-89',objects:['table test.t_77'],versions:['20260828000089']},
      ]
    }
    assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io),/object collision/)
    assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).capacityState,'relinquished')
  }
})

test('resume refuses ambiguous or version-mismatched self pull-request identity',()=>{
  for(const identity of ['ambiguous','wrong version']){
    const io=memoryIo()
    relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,io)
    io.prSources=()=>identity==='ambiguous' ? [
      {label:'PR #78',branch:'branch-77',objects:['table test.t_77'],versions:['20260828000077']},
      {label:'PR #79',branch:'branch-77',objects:['table test.t_77'],versions:['20260828000077']},
    ] : [{label:'PR #78',branch:'branch-77',objects:['table test.t_77'],versions:['20260828000078']}]
    assert.throws(
      ()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io),
      identity==='ambiguous' ? /multiple open pull-request sources/ : /does not carry the permanent claim version/,
    )
    assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).capacityState,'relinquished')
  }
})

test('relinquishment records only matching worktree evidence states',()=>{
  for(const state of WORKTREE_STATES){
    const io=memoryIo()
    io.localWorktreeState=()=>({state})
    const options={claim:77,owner:'owner-77',blockedOn:'issue:#900'}
    if(state!=='clean')options.worktreeState=state
    const result=relinquishAuthorLease(options,NOW,io)
    assert.equal(result.worktreeState,state)
    assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).worktreeState,state)
  }
  for(const state of ['dirty','absent','remote']){
    const io=memoryIo();io.localWorktreeState=()=>({state})
    assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,io),new RegExp(`explicit --worktree-state ${state} is required`))
  }
  const io=memoryIo();io.localWorktreeState=()=>{throw new Error('access denied')}
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'absent'},NOW,io),/inspection is ambiguous/)
})

test('claim 2574 absent-worktree shape can relinquish only with explicit absent evidence',()=>{
  const io=memoryIo();io.localWorktreeState=()=>({state:'absent'})
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,io),/explicit --worktree-state absent is required/)
  const result=relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'absent'},NOW,io)
  assert.equal(result.worktreeState,'absent')
})

test('idempotence binds blocker, worktree state, and recovery artifact',()=>{
  const io=memoryIo();io.localWorktreeState=()=>({state:'dirty'})
  io.artifacts.add('artifact:'+'b'.repeat(64));io.artifacts.add('artifact:'+'c'.repeat(64))
  const tuple={claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty',recoveryArtifact:'artifact:'+'b'.repeat(64)}
  relinquishAuthorLease(tuple,NOW,io)
  assert.equal(relinquishAuthorLease(tuple,NOW,io).idempotent,true)
  assert.throws(()=>relinquishAuthorLease({...tuple,recoveryArtifact:'artifact:'+'c'.repeat(64)},NOW,io),/different blocker, worktree state, or recovery artifact/)
})

test('legacy relinquishment metadata must be reconciled before resume',()=>{
  const io=memoryIo()
  io.issues.get(77).body=body(77,{capacityState:'relinquished',blockedOn:'issue:#900'}).replace(/^worktree_state:.*\r?\n/m,'')
  assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io),/must be reconciled/)
  const reconciled=relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,io)
  assert.equal(reconciled.idempotent,false)
  assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).worktreeState,'clean')
})

const REAL_ARTIFACT='artifact:'+'d'.repeat(40)
const INVENTED_ARTIFACT='artifact:'+'f'.repeat(40)

test('resume from non-clean evidence requires current clean proof or a dereferenceable recovery artifact',()=>{
  for(const state of ['dirty','absent','remote']){
    const io=memoryIo();io.localWorktreeState=()=>({state});io.artifacts.add(REAL_ARTIFACT)
    relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:state},NOW,io)
    assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io),state==='remote'?/resume from remote requires --recovery-artifact/:/requires a proven-clean worktree or --recovery-artifact/)
    assert.equal(resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12,recoveryArtifact:REAL_ARTIFACT},NOW,io).capacityState,'active')
  }
  const recovered=memoryIo();recovered.localWorktreeState=()=>({state:'dirty'})
  relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty'},NOW,recovered)
  recovered.localWorktreeState=()=>({state:'clean'})
  assert.equal(resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,recovered).capacityState,'active')
})

// HIGH 2 (muse REVISE at 8e94f114): the gate used to accept ANY well-formed
// reference, so 40 invented hex characters unblocked a dirty relinquishment.
// This test discriminates: same shape, one dereferenceable and one not.
test('an invented recovery reference of the right shape cannot unblock a dirty resume',()=>{
  const io=memoryIo();io.localWorktreeState=()=>({state:'dirty'});io.artifacts.add(REAL_ARTIFACT)
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty',recoveryArtifact:INVENTED_ARTIFACT},NOW,io),/cannot be dereferenced/)
  relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty'},NOW,io)
  assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12,recoveryArtifact:INVENTED_ARTIFACT},NOW,io),/cannot be dereferenced/)
  assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).capacityState,'relinquished')
  assert.equal(resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12,recoveryArtifact:REAL_ARTIFACT},NOW,io).capacityState,'active')
})

// An https recovery reference is well-formed but not dereferenceable here, and
// a missing or failing verification hook must refuse rather than fall through.
test('unverifiable recovery references are refused rather than trusted',()=>{
  const io=memoryIo();io.localWorktreeState=()=>({state:'dirty'})
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty',recoveryArtifact:'artifact:https://example.invalid/evidence'},NOW,io),/immutable object hash this repository can dereference/)
  const noHook=memoryIo();noHook.localWorktreeState=()=>({state:'dirty'});delete noHook.verifyArtifact
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty',recoveryArtifact:REAL_ARTIFACT},NOW,noHook),/verification is unavailable/)
  const throwing=memoryIo();throwing.localWorktreeState=()=>({state:'dirty'});throwing.verifyArtifact=()=>{throw new Error('object store offline')}
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty',recoveryArtifact:REAL_ARTIFACT},NOW,throwing),/verification is ambiguous/)
})

// HIGH 3 (muse REVISE at 8e94f114): the catch around re-observation used to
// swallow the error whenever any recovery string existed, so an unreadable
// worktree PLUS a stored reference granted resume. It must fail closed.
test('an unreadable worktree blocks resume even with a stored recovery artifact',()=>{
  const io=memoryIo();io.localWorktreeState=()=>({state:'dirty'});io.artifacts.add(REAL_ARTIFACT)
  relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty',recoveryArtifact:REAL_ARTIFACT},NOW,io)
  io.localWorktreeState=()=>{throw new Error('access denied')}
  assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io),/inspection is ambiguous/)
  assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12,recoveryArtifact:REAL_ARTIFACT},NOW,io),/inspection is ambiguous/)
  io.localWorktreeState=()=>({state:'nonsense'})
  assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io),/inspection is ambiguous/)
  assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).capacityState,'relinquished')
})

// MEDIUM 4 (muse REVISE at 8e94f114): a `remote` relinquishment says the work
// lives on another machine. A clean local tree at the same literal path is a
// DIFFERENT tree and must never satisfy it.
test('a clean local tree never satisfies a remote relinquishment',()=>{
  const io=memoryIo();io.localWorktreeState=()=>({state:'absent'});io.artifacts.add(REAL_ARTIFACT)
  relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'remote'},NOW,io)
  io.localWorktreeState=()=>({state:'clean'})
  assert.throws(()=>resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12},NOW,io),/resume from remote requires --recovery-artifact/)
  assert.equal(parseAuthorLease(io.issues.get(77).body,NOW).capacityState,'relinquished')
  assert.equal(resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12,recoveryArtifact:REAL_ARTIFACT},NOW,io).capacityState,'active')
})

// MEDIUM 5 (muse REVISE at 8e94f114): the legacy-metadata freeze was enforced
// only on resume, so a legacy relinquished claim could still be renewed or
// expanded around it. Every mutator must consult the flag.
test('legacy relinquishment metadata freezes every claim mutator, not just resume',()=>{
  const legacyBody=(expiresAt)=>body(77,{capacityState:'relinquished',blockedOn:'issue:#900',expiresAt}).replace(/^worktree_state:.*\r?\n/m,'')
  const ACTIVE=new Date('2026-08-29T00:00:00Z'),EXPIRED=new Date('2026-08-27T00:00:00Z')
  assert.equal(parseAuthorLease(legacyBody(ACTIVE),NOW).relinquishmentMetadataLegacy,true)
  assert.equal(parseAuthorLease(legacyBody(EXPIRED),NOW).relinquishmentMetadataLegacy,true)
  // The work issue carries a real ready structural scope so each mutator reaches
  // its lease check instead of stopping on an unrelated scope refusal.
  const workScope=['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 1','writes:','  - table test.t_77','```'].join('\n')
  const legacyIo=(expiresAt)=>{const io=memoryIo();io.issues.get(77).body=legacyBody(expiresAt);io.issues.get(42).body=workScope;return io}
  const identity={owner:'owner-77',branch:'branch-77',worktree:'C:/work/77'}
  const mutators=[
    ()=>renewExpiredClaim({claim:77,issue:42,...identity,pr:78,headSha:'a'.repeat(40),leaseHours:12},NOW,legacyIo(EXPIRED)),
    ()=>recoverExpiredClaimFromPr({claim:77,issue:42,...identity,pr:78,headSha:'a'.repeat(40),leaseHours:12},NOW,legacyIo(EXPIRED)),
    ()=>expandActiveClaimFromPr({claim:77,issue:42,...identity,pr:78,headSha:'a'.repeat(40)},NOW,legacyIo(ACTIVE)),
    ()=>expandActiveClaimFromIssue({claim:77,issue:42,...identity},NOW,legacyIo(ACTIVE)),
  ]
  for(const mutate of mutators)assert.throws(mutate,/must be reconciled with --relinquish-author-lease/)
})

test('blocker TOCTOU and failed readback roll back without partial capacity write',()=>{
  const changing=memoryIo(),get=changing.getIssue;let blockerReads=0
  changing.getIssue=(number)=>{if(Number(number)===900&&++blockerReads>1)return{number:900,state:'closed',body:''};return get(number)}
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,changing),/not durably open/)
  assert.equal(parseAuthorLease(changing.issues.get(77).body,NOW).capacityState,'active')

  const badReadback=memoryIo(),read=badReadback.getIssue;let claimReads=0
  badReadback.getIssue=(number)=>{const issue=read(number);if(Number(number)===77&&++claimReads===2)return{...issue,body:issue.body.replace('worktree_state: clean','worktree_state: dirty')};return issue}
  assert.throws(()=>relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900'},NOW,badReadback),/readback failed/)
  assert.equal(parseAuthorLease(badReadback.issues.get(77).body,NOW).capacityState,'active')
})

test('CLI accepts explicit worktree and recovery evidence flags',()=>{
  const io=memoryIo();io.localWorktreeState=()=>({state:'absent'});io.artifacts.add('artifact:'+'e'.repeat(40))
  const originalLog=console.log;console.log=()=>{}
  try{assert.equal(main(['--relinquish-author-lease','--claim-number','77','--owner','owner-77','--blocked-on','issue:#900','--worktree-state','absent','--recovery-artifact','artifact:'+'e'.repeat(40)],NOW,io),0)}finally{console.log=originalLog}
  const lease=parseAuthorLease(io.issues.get(77).body,NOW)
  assert.equal(lease.worktreeState,'absent')
  assert.equal(lease.recoveryArtifact,'artifact:'+'e'.repeat(40))
})

// LOW 6 (muse REVISE at 8e94f114): this used to be a source scan for the words
// delete(/move(/clean(, which passed on fixed and unfixed code alike and was
// presented as a safety proof. It is now behavioural: the io handed to the
// lifecycle is a Proxy that THROWS on any mutating capability, so reaching for
// one fails the test instead of merely being spelled differently.
test('the capacity lifecycle reaches for no worktree-mutating capability',()=>{
  const MUTATING=/delete|remove|move|rename|clean|reset|checkout|unlink|rmdir|prune|discard|stash|commitAndPush|writeFile/i
  const ALLOWED=new Set(['deleteRef'])
  const reached=[]
  const guard=(io)=>new Proxy(io,{get(target,property){
    if(typeof property==='string'&&MUTATING.test(property)&&!ALLOWED.has(property)){reached.push(property);throw new Error(`capacity lifecycle reached for mutating capability ${property}`)}
    return Reflect.get(target,property)
  }})
  const io=memoryIo();io.localWorktreeState=()=>({state:'dirty'});io.artifacts.add(REAL_ARTIFACT)
  relinquishAuthorLease({claim:77,owner:'owner-77',blockedOn:'issue:#900',worktreeState:'dirty',recoveryArtifact:REAL_ARTIFACT},NOW,guard(io))
  assert.equal(resumeAuthorLease({claim:77,owner:'owner-77',leaseHours:12,recoveryArtifact:REAL_ARTIFACT},NOW,guard(io)).capacityState,'active')
  assert.deepEqual(reached,[])
  // Positive control: prove the guard can actually fail before trusting it.
  assert.throws(()=>guard(io).cleanWorktree,/reached for mutating capability cleanWorktree/)
  assert.deepEqual(reached,['cleanWorktree'])
})
