import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArguments, runStagePublication } from './publish-work-stage-evidence.mjs'
import { expectedOperatorAssociation } from './lib/repository-identity.mjs'
import { parseOutcomeEvidence } from './db-flow/outcome-lifecycle.mjs'
import { stageEventRef } from './lib/work-stage-evidence.mjs'
function runtimeIo() {
  const refs = new Map(), commits = new Map(), comments = [], calls = []
  const evidence = { schema_version: 1, work_issue: 10, merge_pr: 99, merge_sha: 'b'.repeat(40), application_repository: 'popcre/shared-db', production_evidence: 'https://github.com/popcre/shared-db/actions/runs/1', production_commit_sha: 'b'.repeat(40), production_artifact_id: 1, production_artifact_digest: 'sha256:' + 'd'.repeat(64), application_commit_sha: 'b'.repeat(40), live_assertion: 'business behavior works', live_evidence: 'https://github.com/popcre/shared-db/actions/runs/2', live_artifact_id: 2, live_artifact_digest: 'sha256:' + 'e'.repeat(64), environment: 'production', verified_at: '2026-09-20T19:00:00Z' }
  const evidenceComment = { id: 123, user: { login: 'u2giants' }, author_association: expectedOperatorAssociation(), body: '```db-outcome-evidence\n' + JSON.stringify(evidence) + '\n```' }
  return {
    refs, commits, comments, calls, evidenceComment,
    getPr: () => ({ base: { repo: { full_name: 'popcre/shared-db' }, ref: 'main' }, merged_at: '2026-09-20T19:00:00Z', head: { sha: 'a'.repeat(40) }, merge_commit_sha: 'b'.repeat(40) }),
    closingIssuesForPr: () => [{ number: 10 }], mergeCommitInMain: () => true,
    readRef: ref => refs.get(ref) ?? null, getCommit: sha => ({ message: commits.get(sha) }),
    makeOwnerCommit: message => { const sha = String(commits.size + 1).padStart(40, '0'); commits.set(sha, message); return sha },
    createRef: (ref, sha) => { if (refs.has(ref)) return false; refs.set(ref, sha); return true },
    issueComments: () => comments,
    commentIssue: (issue, body) => { calls.push('commentIssue'); comments.push({ author: 'u2giants', author_association: expectedOperatorAssociation(), body }) },
    getIssueComments: () => [evidenceComment], getIssue: () => ({ body: 'scope' }),
    parseScope: () => ({ workType: 'structural', route: 'claim-first', applicationReturnTo: 'popcre/shared-db', liveAssertion: 'business behavior works', generatedTypes: 'required', writes: ['public.example'] }),
    prStructuralInspection: () => ({ objects: ['public.example'] }),
    parseOutcomeEvidence: body => { calls.push('parseOutcomeEvidence'); return parseOutcomeEvidence(body) },
    verifyProductionApply: () => { calls.push('verifyProductionApply'); return true },
    applicationCommitInDefaultBranch: () => { calls.push('applicationCommitInDefaultBranch'); return true },
    verifyLiveAssertion: () => { calls.push('verifyLiveAssertion'); return true },
    verifyGeneratedTypes: () => { calls.push('verifyGeneratedTypes'); return true },
  }
}

const input = { issue: 10, pr: 99, stage: 'database-applied', commentId: 123 }
function context(io) {
  for (const method of ['makeOwnerCommit', 'createRef', 'commentIssue']) {
    const original = io[method]
    io[method] = (...args) => { io.calls.push('WRITE:' + method); return original(...args) }
  }
  return { io, repository: 'popcre/shared-db', operator: () => 'u2giants', env: { CODEX_THREAD_ID: 'actual-test-session' }, machine: 'test-host' }
}
const writes = io => io.calls.filter(call => call.startsWith('WRITE:'))
test('strict arguments reject missing, unknown, duplicate, unsafe and final-stage inputs', () => {
  const args = ['--issue','10','--pr','99','--stage','database-applied','--evidence-comment-id','123']
  assert.equal(parseArguments(args).publish, false)
  for (const extra of [['--override'], ['--issue','10'], ['--publish','--publish']]) assert.throws(() => parseArguments([...args,...extra]))
  for (const value of ['0','-1','1e3','9007199254740992']) assert.throws(() => parseArguments(args.map(v => v === '123' ? value : v)))
  assert.throws(() => parseArguments(args.map(v => v === 'database-applied' ? 'complete' : v)))
})
test('default verifies concrete production evidence but creates no commit, ref or comment', () => {
  const io=runtimeIo(), result=runStagePublication(input,context(io))
  assert.equal(result.verified,true); assert.equal(result.durable_event_exists,false)
  assert.equal(result.comment_published,false); assert.equal(io.refs.size,0)
  assert.ok(io.calls.includes('verifyProductionApply')); assert.deepEqual(writes(io),[])
})
test('missing, forged and invalid production evidence stop before all writes', () => {
  for (const alter of [io => { io.getIssueComments=()=>[] }, io => { io.evidenceComment.user.login='attacker' }, io => { io.verifyProductionApply=()=>false }, io => { io.closingIssuesForPr=()=>[{number:11}] }, io => { io.prStructuralInspection=()=>({objects:['public.other']}) }]) {
    const io=runtimeIo(),ctx=context(io); alter(io)
    assert.throws(()=>runStagePublication(input,ctx)); assert.deepEqual(writes(io),[])
  }
})
test('closed structural issue remains eligible without reopening or ownership changes', () => {
  const io=runtimeIo(); io.getIssue=()=>({state:'closed',body:'scope'})
  io.updateIssue=()=>{throw new Error('must never reopen')}
  assert.equal(runStagePublication(input,context(io)).verified,true); assert.deepEqual(writes(io),[])
})
test('explicit publish uses native durable event and replay writes nothing', () => {
  const io=runtimeIo(),ctx=context(io), first=runStagePublication({...input,publish:true},ctx)
  assert.equal(first.comment_published,true); assert.equal(io.refs.size,1)
  assert.equal(io.refs.has(stageEventRef(first.event)),true)
  const count=writes(io).length
  assert.equal(runStagePublication({...input,publish:true},ctx).resumed,true)
  assert.equal(writes(io).length,count)
})
test('report distinguishes existing durable event missing comment from a new unpublished event', () => {
  const io=runtimeIo(),ctx=context(io)
  runStagePublication({...input,publish:true},ctx); io.comments.length=0; io.calls.length=0
  const report=runStagePublication(input,ctx)
  assert.equal(report.durable_event_exists,true); assert.equal(report.comment_already_exists,false)
  assert.equal(report.comment_published,false); assert.deepEqual(writes(io),[])
})
test('report recognizes existing verified comment and still makes zero writes', () => {
  const io=runtimeIo(),ctx=context(io); runStagePublication({...input,publish:true},ctx); io.calls.length=0
  const report=runStagePublication(input,ctx)
  assert.equal(report.comment_already_exists,true); assert.equal(report.comment_published,false); assert.deepEqual(writes(io),[])
})
test('contradictory changed durable evidence and wrong actor refuse without writes', () => {
  const io=runtimeIo(),ctx=context(io); runStagePublication({...input,publish:true},ctx); io.calls.length=0
  for (const sha of io.commits.keys()) io.commits.set(sha,'forged')
  assert.throws(()=>runStagePublication(input,ctx),/malformed/); assert.deepEqual(writes(io),[])
  assert.throws(()=>runStagePublication(input,{...ctx,operator:()=> 'attacker'}),/authenticated actor/)
  assert.throws(()=>runStagePublication(input,{...ctx,env:{}}),/posting chat/)
})

test('immutable final completion contradiction stops both modes before mutation', () => {
  for (const publish of [false,true]) {
    const io=runtimeIo(),ctx=context(io)
    io.comments.push({author:'u2giants',author_association:expectedOperatorAssociation(),body:'```db-work-completion\n'+JSON.stringify({schema_version:1,work_issue:10,outcome:'cancelled',reason:'cancelled'})+'\n```'})
    assert.throws(()=>runStagePublication({...input,publish},ctx),/immutable final completion/)
    assert.deepEqual(writes(io),[])
  }
})
