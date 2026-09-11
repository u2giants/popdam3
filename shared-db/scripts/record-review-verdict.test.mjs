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
    createRef(ref,sha){if(refs.has(ref))return false;refs.set(ref,sha);return true},
    // #2710. THE PRODUCTION IO DELETES. Without this method the lease release a
    // recorded verdict performs silently no-opped here, so the idempotency test
    // below re-ran against a lease that had never actually been handed back and
    // proved nothing about the real shape. `githubIo` has `deleteRef`, so the
    // fixture must too.
    deleteRef(ref){return refs.delete(ref)}}
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

// #2464. THE CREATE SUCCEEDED, SO THE READBACK MUST BE ASKED UNTIL IT CAN ANSWER.
// GitHub's create-ref response can arrive before the ref is visible to a
// following GET. Asked exactly once, that transient absence was reported as
// "create-only verdict readback disagrees with the created object; this tuple is
// permanently refused" -- and the runner then voided the findings comment whose
// digest the just-created artifact records, burning the tuple. On PR #2409 that
// fired on four consecutive rounds while the APPROVE artifact sat in the
// namespace the whole time.
test('a create-only verdict survives a transient absent readback after a successful create (#2464)',()=>{
  const io=ioFixture()
  const real=io.readRef
  let stale=2
  io.wait=()=>{}
  io.readRef=(ref)=>{
    if(ref.startsWith('refs/db-review-verdict')&&stale>0){stale--;return null}
    return real(ref)
  }
  const recorded=recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)
  assert.equal(stale,0)
  assert.equal(recorded.verdict,'APPROVE')
  assert.equal(io.refs.get(recorded.ref),recorded.sha)
})

// A readback that never catches up still refuses -- the guarantee is not weakened
// -- but the refusal now carries the created artifact so no caller can void the
// comment the artifact's digest was computed over.
test('a readback that never confirms still refuses, and names the created artifact (#2464)',()=>{
  const io=ioFixture()
  io.wait=()=>{}
  const real=io.readRef
  io.readRef=(ref)=>ref.startsWith('refs/db-review-verdict')?null:real(ref)
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)}catch(error){caught=error}
  assert.ok(caught,'a readback that never confirms must still refuse')
  assert.match(caught.message,/readback could not confirm the created object/)
  assert.ok(caught.verdictArtifactCreated,'the refusal must carry the artifact that WAS created')
  assert.equal(io.refs.get(caught.verdictArtifactCreated.ref),caught.verdictArtifactCreated.sha)
})

// An artifact that already exists is validated against ITS OWN findings comment.
// Validating it against the comment THIS round posted reported "findings digest
// does not match the durable findings" for a valid artifact, and the runner voided
// the new comment too -- the cascade that made the tuple unrecoverable.
test('an existing artifact is validated against its own findings comment, not this round\'s (#2464)',()=>{
  const io=ioFixture()
  const first=recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)
  const laterRef='https://github.com/u2giants/shared-db/pull/2000#issuecomment-456'
  const originalFindings=io.readFindings
  io.readFindings=(url)=>url===laterRef?'A LATER ROUND POSTED A DIFFERENT BODY':originalFindings(url)
  const second=recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef:laterRef},io)
  assert.equal(second.sha,first.sha)
  assert.equal(second.findings_ref,findingsRef)
})

// #2464 (muse-spark, PR #2468). A FAILED CREATE THAT ACTUALLY LANDED IS OURS.
// The create can report an error after the ref landed -- a dropped response, a
// proxy timeout. The winner of that "race" is this round's own commit, bound to
// this round's findings comment, so a transient failure in the reads that follow
// must NOT reach the runner unmarked: the void path would edit the very comment
// the artifact's findings_digest was computed over. The positive control below
// shows a genuine race, won by ANOTHER round's commit, still throws unmarked.
test('a create that errors after landing our own SHA marks every later failure (#2464)',()=>{
  const io=ioFixture()
  io.wait=()=>{}
  const originalCreate=io.createRef
  io.createRef=(ref,sha)=>{originalCreate(ref,sha);throw new Error('502 from the create; the ref landed anyway')}
  const originalGetCommit=io.getCommit
  io.getCommit=(sha)=>{if(sha===assignmentSha)return originalGetCommit(sha);throw new Error('transient 500 reading the winner commit')}
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)}catch(error){caught=error}
  assert.ok(caught,'the failure must still be reported')
  assert.ok(caught.verdictArtifactCreated,'a failure after OUR SHA landed must carry the artifact marker')
  assert.equal(io.refs.get(caught.verdictArtifactCreated.ref),caught.verdictArtifactCreated.sha)
})
test('POSITIVE CONTROL: a race lost to another round throws unmarked (#2464)',()=>{
  const io=ioFixture()
  io.wait=()=>{}
  const originalCreate=io.createRef
  io.createRef=(ref,sha)=>{
    const row=JSON.parse(io.commits.get(sha).message.slice('db-review-verdict '.length))
    originalCreate(ref,io.makeReviewVerdictCommit(`db-review-verdict ${JSON.stringify({...row,verdict:'REJECT'})}`,assignmentSha))
    throw new Error('already exists')
  }
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)}catch(error){caught=error}
  assert.ok(caught)
  assert.match(caught.message,/contradictory create-only verdict/)
  assert.equal(caught.verdictArtifactCreated,undefined,'another round\'s artifact is not ours to protect')
})
// After an ERRORED create, a repeated null is not proof of absence -- the same
// eventual consistency that hides a fresh ref once can hide it twelve times
// (muse-spark, PR #2468 round 3). So this exit refuses AND marks unconfirmed.
// The only unmarked outcome left in the branch is a winner that is demonstrably
// another round's object, pinned by the positive control above.
test('a create that reports failure with no readable winner refuses and marks unconfirmed (#2464)',()=>{
  const io=ioFixture()
  io.wait=()=>{}
  io.createRef=()=>{throw new Error('the create never landed')}
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)}catch(error){caught=error}
  assert.ok(caught)
  assert.match(caught.message,/no winner could be read/)
  assert.equal(caught.verdictArtifactCreated?.confirmed,false)
})

// #2464 (muse-spark, PR #2468 round 2). A WINNER READ THAT THROWS PROVES NOTHING.
// io.readRef returns null only on a confirmed 404 and rethrows every other
// transport error, and the retry helper lets a thrown read propagate. After a
// failed create, that leaves us unable to say whether the ref landed -- so the
// failure is marked UNCONFIRMED and the runner still refuses to void. Voiding is
// irreversible; not voiding is not. A repeated null is marked unconfirmed for the
// same reason (round 3); the only unmarked exit left is a winner that is
// demonstrably another round's object, which the positive control above pins.
test('a winner read that throws after a failed create is marked unconfirmed (#2464)',()=>{
  const io=ioFixture()
  io.wait=()=>{}
  const originalCreate=io.createRef
  let created=false
  io.createRef=(ref,sha)=>{created=true;originalCreate(ref,sha);throw new Error('502 from the create')}
  const real=io.readRef
  io.readRef=(ref)=>{if(created&&ref.startsWith('refs/db-review-verdicts/'))throw new Error('503 reading the ref back');return real(ref)}
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)}catch(error){caught=error}
  assert.ok(caught)
  assert.ok(caught.verdictArtifactCreated,'an unprovable ref state must still refuse the void')
  assert.equal(caught.verdictArtifactCreated.confirmed,false)
})
test('a confirmed marker says so, so a notice cannot overclaim (#2464)',()=>{
  const io=ioFixture()
  io.wait=()=>{}
  const real=io.readRef
  io.readRef=(ref)=>ref.startsWith('refs/db-review-verdicts/')?null:real(ref)
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)}catch(error){caught=error}
  assert.equal(caught.verdictArtifactCreated.confirmed,true)
})

// A replacement round writes to the -<sequence> namespace, so the marker must
// name THAT ref, not the base one. Nothing else about the branch changes, which
// is exactly why an untested tuple is worth pinning (muse-spark, round 3).
test('a replacement-sequence round marks the replacement ref, not the base ref (#2464)',()=>{
  const replacementSequence=3
  const io=ioFixture()
  io.wait=()=>{}
  const assignmentRef=`refs/db-review-replacements/${issue}-${pr}-${headSha}-${replacementSequence}`
  io.refs.set(assignmentRef,assignmentSha)
  const originalCreate=io.createRef
  let created=false
  io.createRef=(ref,sha)=>{created=true;originalCreate(ref,sha);throw new Error('502 from the create')}
  const realGet=io.getCommit
  io.getCommit=(sha)=>{if(sha===assignmentSha||!created)return realGet(sha);throw new Error('transient 500')}
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef,replacementSequence},io)}catch(error){caught=error}
  assert.ok(caught)
  assert.ok(caught.verdictArtifactCreated,'a replacement round must be protected exactly like a first round')
  assert.match(caught.verdictArtifactCreated.ref,new RegExp(`^refs/db-review-verdict-replacements/${issue}-${pr}-${headSha}-${replacementSequence}$`))
  assert.equal(io.refs.get(caught.verdictArtifactCreated.ref),caught.verdictArtifactCreated.sha)
})

// #2430 (PR #2415, head 0fab4ace). A DIFFERENT SHA AT THE REF IS NOT AUTOMATICALLY
// CORRUPTION. The create is confirmed, so the object standing at the ref came from
// this call; a retried create writes a second commit with the same record and a
// different SHA, because the commit carries a timestamp and the record does not.
// Refusing on the SHA alone discarded a completed, paid-for review. These pin both
// directions: an equivalent record is a success, a different one is still refused.
test('an equivalent record under a different SHA is the same verdict (#2430)',()=>{
  const io=ioFixture()
  const originalCreate=io.createRef
  io.createRef=(ref,sha)=>{
    // The same payload re-committed: identical record, different object.
    const twin=io.makeReviewVerdictCommit(io.commits.get(sha).message,assignmentSha)
    return originalCreate(ref,twin)
  }
  const validated=recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)
  assert.equal(validated.verdict,'APPROVE')
  assert.equal(io.refs.get(validated.ref),validated.sha)
})
test('the same record with its keys in another order is still the same record (#2430)',()=>{
  const io=ioFixture()
  const originalCreate=io.createRef
  io.createRef=(ref,sha)=>{
    const row=JSON.parse(io.commits.get(sha).message.slice('db-review-verdict '.length))
    const reordered=Object.fromEntries(Object.keys(row).sort().map((key)=>[key,row[key]]))
    const twin=io.makeReviewVerdictCommit(`db-review-verdict ${JSON.stringify(reordered)}`,assignmentSha)
    return originalCreate(ref,twin)
  }
  assert.equal(recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io).verdict,'APPROVE')
})
test('POSITIVE CONTROL: a genuinely different record under a different SHA is still refused (#2430)',()=>{
  const io=ioFixture()
  const originalCreate=io.createRef
  io.createRef=(ref,sha)=>{
    const row=JSON.parse(io.commits.get(sha).message.slice('db-review-verdict '.length))
    const other=io.makeReviewVerdictCommit(`db-review-verdict ${JSON.stringify({...row,verdict:'REJECT'})}`,assignmentSha)
    return originalCreate(ref,other)
  }
  let caught=null
  try{recordReviewVerdict({issue,pr,headSha,verdict:'APPROVE',findingsRef},io)}catch(error){caught=error}
  assert.ok(caught,'a different record must still refuse')
  assert.match(caught.message,/readback could not confirm the created object/)
  assert.ok(caught.verdictArtifactCreated,'the refusal must still carry the created artifact so nothing is voided')
})
