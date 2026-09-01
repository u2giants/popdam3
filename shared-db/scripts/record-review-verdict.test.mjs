import assert from 'node:assert/strict'
import test from 'node:test'
import { recordReviewVerdict, REVIEW_ASSIGNMENT_REF_PREFIX, reviewActiveRef } from './manage-migration-author-lanes.mjs'

const issue=1824,pr=2000,headSha='a'.repeat(40),assignmentSha='b'.repeat(40),reviewer='glm-5.3'
const findingsRef='https://github.com/u2giants/shared-db/pull/2000#issuecomment-123',findings='Coverage: all changed files. No material findings.'
function ioFixture(){
  const refs=new Map([[`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,assignmentSha],[reviewActiveRef(reviewer),assignmentSha]])
  const commits=new Map([[assignmentSha,{message:`db-coordination reviewer-cursor sequence=1 reviewer=${reviewer} issue=${issue} pr=${pr} head=${headSha}`,parents:[{sha:'f'.repeat(40)}]}]])
  let seq=12
  return {refs,commits,readRef:(ref)=>refs.get(ref)??null,getCommit:(sha)=>commits.get(sha),getPr:()=>({state:'open',head:{sha:headSha}}),readFindings:(url)=>url===findingsRef?findings:null,
    makeReviewVerdictCommit(message,parent){const sha=(seq++).toString(16).padStart(40,'0');commits.set(sha,{message,parents:[{sha:parent}]});return sha},
    createRef(ref,sha){if(refs.has(ref))return false;refs.set(ref,sha);return true}}
}
test('recording is create-only, bound to the assignment parent, and idempotent',()=>{
  const io=ioFixture(),request={issue,pr,headSha,verdict:'APPROVE',findingsRef}
  const first=recordReviewVerdict(request,io),second=recordReviewVerdict(request,io)
  assert.equal(first.sha,second.sha)
  assert.equal(io.commits.get(first.sha).parents[0].sha,assignmentSha)
})
test('a review that lost its active lease writes no artifact',()=>{
  const io=ioFixture();io.refs.delete(reviewActiveRef(reviewer))
  assert.throws(()=>recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io),/does not hold/)
  assert.equal([...io.refs.keys()].some((ref)=>ref.includes('db-review-verdict')),false)
})
test('a contradictory verdict that wins the create race permanently refuses the tuple',()=>{
  const io=ioFixture(),originalCreate=io.createRef
  io.createRef=(ref,sha)=>{
    const commit=io.commits.get(sha),row=JSON.parse(commit.message.slice('db-review-verdict '.length))
    const contradictory=io.makeReviewVerdictCommit(`db-review-verdict ${JSON.stringify({...row,verdict:'REJECT'})}`,assignmentSha)
    originalCreate(ref,contradictory)
    throw new Error('already exists')
  }
  assert.throws(()=>recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io),/contradictory create-only verdict/)
})
test('findings for another PR are refused before a commit or ref is created',()=>{
  const io=ioFixture();let commits=0,creates=0
  io.makeReviewVerdictCommit=()=>{commits++;return 'c'.repeat(40)}
  io.createRef=()=>{creates++;return true}
  assert.throws(()=>recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef:'https://github.com/u2giants/shared-db/pull/2001#issuecomment-123'},io),/reviewed shared-db PR/)
  assert.equal(commits,0);assert.equal(creates,0)
})
