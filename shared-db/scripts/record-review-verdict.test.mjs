import assert from 'node:assert/strict'
import test from 'node:test'
import { recordReviewVerdict, reviewerReadsRepository, REVIEW_ASSIGNMENT_REF_PREFIX, reviewActiveRef } from './manage-migration-author-lanes.mjs'

const issue=1824,pr=2000,headSha='a'.repeat(40),assignmentSha='b'.repeat(40),reviewer='glm-5.3'
const findingsRef='https://github.com/u2giants/shared-db/pull/2000#issuecomment-123',findings='Coverage: all changed files. No material findings.'
function ioFixture(who=reviewer){
  const refs=new Map([[`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`,assignmentSha],[reviewActiveRef(who),assignmentSha]])
  const commits=new Map([[assignmentSha,{message:`db-coordination reviewer-cursor sequence=1 reviewer=${who} issue=${issue} pr=${pr} head=${headSha}`,parents:[{sha:'f'.repeat(40)}]}]])
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

// #2078. PROVE THE GUARD CAN FAIL BEFORE TRUSTING IT. The first test feeds the
// recording path a verdict from `deepseek-chat`, whose wrapper `ai-deepseek-agent`
// is a conversational API client with no filesystem, no diff and no tools -- the
// exact situation that put a confabulated review of nonexistent SQL into a durable
// artifact on PR #1989. The second shows a reviewer that DOES read the repository
// still records, so the guard is not simply refusing everything.
test('a verdict from a reviewer whose wrapper cannot read the repository is REFUSED (#2078)',()=>{
  const io=ioFixture('deepseek-chat');let commits=0,creates=0
  io.makeReviewVerdictCommit=()=>{commits++;return 'c'.repeat(40)}
  io.createRef=()=>{creates++;return true}
  assert.equal(reviewerReadsRepository('deepseek-chat'),false)
  assert.throws(()=>recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io),
    /deepseek-chat runs through a wrapper that has no access to the repository under review[\s\S]*as DESCRIBED rather than as WRITTEN/)
  // No commit, no ref: a reviewer that could not read the code leaves NO artifact.
  assert.equal(commits,0);assert.equal(creates,0)
  assert.equal([...io.refs.keys()].some((ref)=>ref.includes('db-review-verdict')),false)
  // #2079. The refusal must name a route that actually RUNS. "Use
  // --replace-failed-reviewer" was not one: replacement needs a recognized
  // terminal failure code and both no-verdict confirmations, so an operator
  // following the old message walked into a second refusal.
  let message='';try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},ioFixture('deepseek-chat'))}catch(error){message=error.message}
  assert.match(message,/no retry and no re-run can satisfy it/)
  assert.ok(message.includes(`node scripts/manage-migration-author-lanes.mjs --replace-failed-reviewer --issue ${issue} --pr ${pr} --head-sha ${headSha}`))
  assert.ok(message.includes('--failure-code reviewer_cannot_read_repository --confirm-no-verdict --confirm-no-artifact'))
})
test('a verdict from a reviewer that does read the repository still records (#2078)',()=>{
  const io=ioFixture()
  assert.equal(reviewerReadsRepository(reviewer),true)
  const recorded=recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)
  assert.equal(recorded.verdict,'APPROVE')
  assert.equal(io.commits.get(recorded.sha).parents[0].sha,assignmentSha)
})
