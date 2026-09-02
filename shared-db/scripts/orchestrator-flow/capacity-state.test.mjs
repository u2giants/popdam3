import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_AUTHOR_LANES, assertLaneAvailable, buildDynamicQueues, claimBody,
  parseAuthorLease, relinquishAuthorLease, resumeAuthorLease,
} from '../manage-migration-author-lanes.mjs'

const NOW=new Date('2026-08-28T12:00:00Z')
const body=(number,{capacityState='active',blockedOn=null,expiresAt=new Date('2026-08-29T00:00:00Z')}={})=>claimBody({
  version:`20260828${String(number).padStart(6,'0')}`,
  objects:[`table test.t_${number}`],owner:`owner-${number}`,branch:`branch-${number}`,
  worktree:`C:/work/${number}`,expiresAt,capacityState,blockedOn,
})

test('relinquished claims protect objects without consuming active capacity',()=>{
  const claims=Array.from({length:8},(_,index)=>({number:index+1,body:body(index+1,{capacityState:'relinquished',blockedOn:'issue:#900'})}))
  const result=assertLaneAvailable(claims,['table test.new'],NOW)
  assert.equal(result.protected.length,8)
  assert.equal(result.active.length,0)
  assert.throws(()=>assertLaneAvailable(claims,['table test.t_8'],NOW),/collision/)
})

test('clock expiry blocks merge readiness but frees zero capacity',()=>{
  const expired=Array.from({length:MAX_AUTHOR_LANES},(_,index)=>({number:index+1,body:body(index+1,{expiresAt:new Date('2026-08-28T11:00:00Z')})}))
  assert.equal(parseAuthorLease(expired[0].body,NOW).capacityState,'expired-unconfirmed')
  assert.throws(()=>assertLaneAvailable(expired,['table test.new'],NOW),/active-author leases are occupied/)
})

test('more protected claims than the active cap remain representable in queues',()=>{
  const claims=Array.from({length:8},(_,index)=>({number:index+1,body:body(index+1,{capacityState:'relinquished',blockedOn:'issue:#900'})}))
  const result=buildDynamicQueues([],claims,NOW)
  assert.equal(result.queues.flatMap((queue)=>queue.protected).length,8)
  assert.equal(result.emptyLanes,MAX_AUTHOR_LANES)
})

function memoryIo(){
  const refs=new Map(),comments=[],issues=new Map()
  const claim={number:77,state:'open',title:'CLAIM: #42 throughput fixture',body:body(77)}
  issues.set(77,claim);issues.set(42,{number:42,state:'open',body:''});issues.set(900,{number:900,state:'open',body:''})
  refs.set('refs/db-claims/20260828000077','reservation')
  let serial=0
  return {
    comments,issues,
    makeOwnerCommit:()=>`owner-${++serial}`,
    createRef:(name,sha)=>{if(refs.has(name))return false;refs.set(name,sha);return true},
    readRef:(name)=>refs.get(name)??null,
    deleteRef:(name)=>{refs.delete(name)},
    getCommitMessage:()=>'',
    openClaims:()=>[structuredClone(issues.get(77))],
    getIssue:(number)=>structuredClone(issues.get(Number(number))),
    updateIssue:(number,{body:newBody})=>{issues.get(Number(number)).body=newBody},
    localClean:()=>true,
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
