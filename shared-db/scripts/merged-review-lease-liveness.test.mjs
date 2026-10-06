import assert from 'node:assert/strict'
import test from 'node:test'
import { findBusyReviewers, reviewLeaseStillHeld } from './manage-migration-author-lanes.mjs'
import { isReviewAssignmentLive, assertReviewLeaseStillStale } from './lib/lanes/review-approval.mjs'
import { projectReviewPr } from './lib/lanes/review-assignment.mjs'
import { reviewTargetSuperseded } from './lib/lanes/queue-routing.mjs'
import { REVIEW_ACTIVE_CUTOVER_REF, REVIEW_ACTIVE_PARALLEL_REF_PREFIX } from './lib/lanes/constants.mjs'

const headSha='a'.repeat(40)
const assignment={issue:3882,pr:3886,headSha,slot:4,sequence:4960,reviewer:'muse-spark-1.3-contributor'}
const leaseRef=`${REVIEW_ACTIVE_PARALLEL_REF_PREFIX}/${assignment.reviewer}/3882-3886-${headSha}-slot4`
function fixture({bound=true,state='closed',merged=true,head=headSha,verdictSlot=null}={}){
  const pr=projectReviewPr({state:state.toUpperCase(),merged,headRefOid:head,mergeCommit:{oid:'d'.repeat(40)}})
  const commit={message:`db-coordination reviewer-cursor sequence=4960 reviewer=${assignment.reviewer} issue=3882 pr=3886 head=${headSha} slot=4`}
  const states=new Map([['3882:3886',{pr}]])
  const refs=verdictSlot===null?[]:[{ref:`refs/db-review-verdicts/3882-3886-${headSha}-slot${verdictSlot}`}]
  const io={readRef:ref=>ref===REVIEW_ACTIVE_CUTOVER_REF?'cutover':null,
    readActiveReviewLeases:()=>new Map([[leaseRef,{sha:'b'.repeat(40),commit}]]),
    readReviewStates:()=>states,getPr:()=>pr,listRefs:()=>refs,
    mergedPrReviewTarget:(pr,issue)=>bound&&pr===3886&&issue===3882}
  return {io,states}
}

test('verified merged exact head remains held through replacement restore and review start',()=>{
  const {io,states}=fixture()
  assert.equal(isReviewAssignmentLive(assignment,states,io),true)
  assert.equal(findBusyReviewers(io).has(assignment.reviewer),true)
  assert.equal(reviewLeaseStillHeld(assignment,io)?.sequence,4960)
  assert.throws(()=>assertReviewLeaseStillStale({assignment},states,io),/became live/)
})
for(const [name,options] of [['unbound merged',{bound:false}],['closed unmerged',{merged:false}],['moved head',{head:'c'.repeat(40)}],['completed own slot',{verdictSlot:4}]])test(`${name} is stale for assignment restoration`,()=>{
  const {io,states}=fixture(options)
  assert.equal(isReviewAssignmentLive(assignment,states,io),false)
  assert.equal(findBusyReviewers(io).has(assignment.reviewer),false)
  assert.equal(reviewLeaseStillHeld(assignment,io),null)
  assert.doesNotThrow(()=>assertReviewLeaseStillStale({assignment},states,io))
})
test('sibling verdict does not release the pending production assessment',()=>{
  const {io,states}=fixture({verdictSlot:3})
  assert.equal(isReviewAssignmentLive(assignment,states,io),true)
  assert.equal(reviewLeaseStillHeld(assignment,io)?.slot,4)
})
test('open exact-head reviews retain their existing behavior without a binding',()=>{
  const {io,states}=fixture({state:'open',merged:false,bound:false})
  assert.equal(isReviewAssignmentLive(assignment,states,io),true)
  assert.equal(reviewLeaseStillHeld(assignment,io)?.sequence,4960)
})
test('unreadable merged binding refuses discovery and start',()=>{
  const {io}=fixture();io.mergedPrReviewTarget=()=>{throw new Error('binding unreadable')}
  assert.throws(()=>findBusyReviewers(io),/binding unreadable/)
  assert.throws(()=>reviewLeaseStillHeld(assignment,io),/binding unreadable/)
})

test('an exact bound merged review cannot be released as superseded',()=>{
  const {io,states}=fixture(),pr=states.get('3882:3886').pr
  assert.equal(reviewTargetSuperseded(pr,headSha,assignment,io),false)
  assert.equal(reviewTargetSuperseded(pr,headSha,{...assignment,issue:99},io),true)
  assert.equal(reviewTargetSuperseded({...pr,head:{sha:'c'.repeat(40)}},headSha,assignment,io),true)
})
test('wrong issue and PR refuse merged liveness and startup',()=>{
  const {io,states}=fixture()
  for(const target of [{...assignment,issue:99},{...assignment,pr:99}]){
    assert.equal(isReviewAssignmentLive(target,states,io),false)
    assert.equal(reviewLeaseStillHeld(target,io),null)
  }
})
test('unreadable binding also refuses replacement restore, mutex recheck and superseded release',()=>{
  const {io,states}=fixture();io.mergedPrReviewTarget=()=>{throw new Error('binding unreadable')}
  assert.throws(()=>isReviewAssignmentLive(assignment,states,io),/binding unreadable/)
  assert.throws(()=>assertReviewLeaseStillStale({assignment},states,io),/binding unreadable/)
  assert.throws(()=>reviewTargetSuperseded(states.get('3882:3886').pr,headSha,assignment,io),/binding unreadable/)
})
