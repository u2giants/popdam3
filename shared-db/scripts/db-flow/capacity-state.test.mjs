import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKTREE_STATES, assertLaneAvailable, buildDynamicQueues, claimBody, main, parseAuthorLease } from '../manage-migration-author-lanes.mjs'

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









const REAL_ARTIFACT='artifact:'+'d'.repeat(40)
const INVENTED_ARTIFACT='artifact:'+'f'.repeat(40)









