import test from 'node:test'
import assert from 'node:assert/strict'
import { stageEventKey, validateStageEvent, findStageEvents, verifyAcceptedStage } from './work-stage-evidence.mjs'
import { classifyDependency, classifyDependencies, parseDependencyDeclarations, validateDependencyDeclaration, findDependencyCycles } from './work-dependencies.mjs'
import { expectedOperatorAssociation } from './repository-identity.mjs'

const event = (over = {}) => {
  const value = { schema_version: 1, repository: 'popcre/shared-db', work_issue: 10, stage: 'implementation-merged', pr: 99, head_sha: 'a'.repeat(40), merge_sha: 'b'.repeat(40), evidence_digest: 'c'.repeat(64), evidence_ref: 'refs/evidence/10/1', ...over }
  return { ...value, event_id: stageEventKey(value) }
}
const comment = value => ({ body: '```db-work-stage\n' + JSON.stringify(value) + '\n```', author: 'u2giants', author_association: expectedOperatorAssociation() })
const verified = () => Object.fromEntries(['repositoryMatches', 'issueLinked', 'prMerged', 'headMatches', 'mergeMatches', 'mergeInMain', 'evidenceDigestMatches', 'evidenceAuthorized', 'evidenceCurrent', 'notRevoked', 'stageAccepted'].map(key => [key, true]))
const state = (over = {}) => ({ exists: true, open: true, repository: 'popcre/shared-db', comments: [comment(event())], verifyStageEvidence: verified, ...over })
const declaration = { issue: 10, required_stage: 'implementation-merged' }

test('explicit declarations preserve numeric legacy semantics and reject unknown stages', () => {
  assert.deepEqual(parseDependencyDeclarations('#10, 11@live-verified'), [10, { issue: 11, required_stage: 'live-verified' }])
  assert.deepEqual(parseDependencyDeclarations([10, declaration]), [10, declaration])
  for (const value of ['0', '-1', '1@done', '1.5', '1e2', '9007199254740992']) assert.throws(() => parseDependencyDeclarations(value))
  assert.throws(() => parseDependencyDeclarations([{ ...declaration, optional: true }]), /unknown fields/)
  assert.throws(() => validateDependencyDeclaration(10, [declaration]), /itself/)
  assert.throws(() => validateDependencyDeclaration(1, [10, declaration]), /duplicate/)
  assert.deepEqual(findDependencyCycles({ 1: [{ issue: 2, required_stage: 'live-verified' }], 2: [1] }), [[1, 2, 1]])
})

test('open with verified explicit stage releases but old dependencies still require closure', () => {
  assert.equal(classifyDependency(declaration, state()).satisfied, true)
  assert.equal(classifyDependency(10, state()).satisfied, false)
  assert.equal(classifyDependency({ issue: 10, required_stage: 'complete' }, state()).satisfied, false)
  assert.equal(classifyDependencies(1, [declaration], { 10: state() }).satisfied, true)
  assert.equal(classifyDependency(declaration, state({ open: false, comments: [] })).satisfied, false)
})

test('stage readiness requires every independently verified current-world check', () => {
  for (const field of Object.keys(verified())) {
    for (const value of [false, undefined]) {
      const result = classifyDependency(declaration, state({ verifyStageEvidence: () => ({ ...verified(), [field]: value }) }))
      assert.equal(result.satisfied, false, field)
      assert.match(result.reason, new RegExp(field))
    }
  }
  for (const verifyStageEvidence of [undefined, () => Promise.resolve(verified()), () => { throw new Error('HTTP 429') }]) {
    assert.equal(classifyDependency(declaration, state({ verifyStageEvidence })).satisfied, false)
  }
})

test('forged, wrong repository, wrong issue, wrong stage and unauthorized author cannot release', () => {
  for (const over of [{ repository: 'attacker/shared-db' }, { work_issue: 11 }, { stage: 'live-verified' }, { event_id: 'forged' }]) {
    const value = { ...event(), ...over }
    if (!over.event_id) value.event_id = stageEventKey(value)
    assert.equal(classifyDependency(declaration, state({ comments: [comment(value)] })).satisfied, false)
  }
  assert.equal(classifyDependency(declaration, state({ comments: [{ ...comment(event()), author: 'attacker' }] })).satisfied, false)
  assert.equal(classifyDependency(declaration, state({ repository: undefined })).satisfied, false)
})

test('duplicate delivery has one event identity; contradictory reuse blocks', () => {
  assert.equal(findStageEvents([comment(event()), comment(event())]).length, 1)
  assert.equal(classifyDependency(declaration, state({ comments: [comment(event()), comment(event())] })).events.length, 1)
  assert.throws(() => findStageEvents([comment(event()), comment(event({ pr: 100 }))]), /conflicting/)
  assert.throws(() => validateStageEvent(event({ stage: 'complete' })), /final record/)
})

test('no later stage implies earlier acceptance and no newer evidence hides revoked evidence', () => {
  assert.equal(classifyDependency({ issue: 10, required_stage: 'live-verified' }, state()).satisfied, false)
  const comments = [comment(event()), comment(event({ evidence_digest: 'd'.repeat(64) }))]
  const result = classifyDependency(declaration, state({ comments, verifyStageEvidence: value => ({ ...verified(), notRevoked: value.evidence_digest !== 'c'.repeat(64) }) }))
  assert.equal(result.satisfied, false)
})

test('immutable final record contradictions fail before stage acceptance', () => {
  const finalComment = record => ({ ...comment(event()), body: '```db-work-completion\n' + JSON.stringify(record) + '\n```' })
  for (const record of [
    { schema_version: 1, work_issue: 10, outcome: 'cancelled', reason: 'cancelled' },
    { schema_version: 1, work_issue: 11, outcome: 'merged', pr: 99, merge_sha: 'b'.repeat(40), migration_versions: [] },
    { schema_version: 1, work_issue: 10, outcome: 'merged', pr: 100, merge_sha: 'b'.repeat(40), migration_versions: [] },
    { schema_version: 1, work_issue: 10, outcome: 'merged', pr: 99, merge_sha: 'd'.repeat(40), migration_versions: [] },
  ]) assert.equal(classifyDependency(declaration, state({ comments: [comment(event()), finalComment(record)] })).satisfied, false)
})


test('stage envelope rejects coercible fields and unknown assertions; verifier cannot rewrite the event', () => {
  for (const field of ['repository', 'head_sha', 'merge_sha', 'evidence_digest']) {
    const value = event(); value[field] = [value[field]]; value.event_id = stageEventKey(value)
    assert.throws(() => validateStageEvent(value))
  }
  assert.throws(() => validateStageEvent(event({ accepted: true })), /unknown fields/)
  const result = classifyDependency(declaration, state({ verifyStageEvidence: value => { value.pr = 100; return verified() } }))
  assert.equal(result.satisfied, false)
  assert.equal(classifyDependency(declaration, state({ verifyStageEvidence: () => Object.create(verified()) })).satisfied, false)
  assert.equal(findStageEvents([comment(event()), comment(Object.fromEntries(Object.entries(event()).reverse()))]).length, 1)
})

import { createStageEvidenceVerifier, publishStageEvent, stageEventRef, stageRevocationRef } from './work-stage-evidence.mjs'
import { parseOutcomeEvidence } from '../orchestrator-flow/outcome-lifecycle.mjs'

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
    parseScope: () => ({ workType: 'structural', route: 'shared-db-orchestrator', applicationReturnTo: 'popcre/shared-db', liveAssertion: 'business behavior works', generatedTypes: 'required', writes: ['public.example'] }),
    prStructuralInspection: () => ({ objects: ['public.example'] }),
    parseOutcomeEvidence: body => { calls.push('parseOutcomeEvidence'); return parseOutcomeEvidence(body) },
    verifyProductionApply: () => { calls.push('verifyProductionApply'); return true },
    applicationCommitInDefaultBranch: () => { calls.push('applicationCommitInDefaultBranch'); return true },
    verifyLiveAssertion: () => { calls.push('verifyLiveAssertion'); return true },
    verifyGeneratedTypes: () => { calls.push('verifyGeneratedTypes'); return true },
  }
}
const publishInput = (over = {}) => ({ issue: 10, stage: 'implementation-merged', repository: 'popcre/shared-db', pr: 99, evidenceRef: 'https://github.com/popcre/shared-db/pull/99', signature: 'Posted by Codex chat test on machine', ...over })

test('concrete publisher and verifier reread immutable refs and actual PR facts; replay writes once', () => {
  const io = runtimeIo()
  const published = publishStageEvent(publishInput(), io)
  assert.equal(published.resumed, false)
  assert.equal(publishStageEvent(publishInput(), io).resumed, true)
  assert.equal(io.calls.filter(v => v === 'commentIssue').length, 1)
  assert.equal(classifyDependency(declaration, state({ comments: io.comments, verifyStageEvidence: createStageEvidenceVerifier(io, 'popcre/shared-db') })).satisfied, true)
  io.refs.set(stageRevocationRef(published.event), 'f'.repeat(40))
  assert.throws(() => createStageEvidenceVerifier(io, 'popcre/shared-db')(published.event), /revoked/)
  assert.throws(() => publishStageEvent(publishInput(), io), /revoked/)
})

test('publication recovers response loss after successful ref or comment writes', () => {
  for (const method of ['createRef', 'commentIssue']) {
    const io = runtimeIo(), original = io[method]
    io[method] = (...args) => { original(...args); throw new Error('response lost') }
    const result = publishStageEvent(publishInput(), io)
    assert.equal(result.event.work_issue, 10)
    assert.equal(io.comments.length, 1)
    assert.equal(publishStageEvent(publishInput(), io).resumed, true)
  }
})

test('unconfirmed comment delivery preserves checkpoint and refuses false success', () => {
  const io = runtimeIo()
  io.commentIssue = () => { throw new Error('network unavailable') }
  assert.throws(() => publishStageEvent(publishInput(), io), /network unavailable/)
  assert.equal(io.refs.size, 1)
  assert.equal(io.comments.length, 0)
})

test('concrete current-world verifier rejects changed PR, missing membership and forged immutable payload', () => {
  for (const change of [
    io => { io.getPr = () => ({}) },
    io => { io.closingIssuesForPr = () => [{ number: 11 }] },
    io => { io.mergeCommitInMain = () => undefined },
    io => { io.refs.clear() },
    io => { for (const sha of io.commits.keys()) io.commits.set(sha, 'forged') },
  ]) {
    const io = runtimeIo(), result = publishStageEvent(publishInput(), io)
    change(io)
    assert.throws(() => createStageEvidenceVerifier(io, 'popcre/shared-db')(result.event))
  }
})

test('runtime stages invoke the existing outcome parser and artifact verifiers; failures remain failures', () => {
  for (const stage of ['database-applied', 'live-verified', 'application-accepted']) {
    const io = runtimeIo()
    publishStageEvent(publishInput({ stage, evidenceRef: 'https://github.com/popcre/shared-db/issues/10#issuecomment-123' }), io)
    assert.ok(io.calls.includes('verifyProductionApply'))
    assert.equal(io.calls.includes('verifyLiveAssertion'), stage !== 'database-applied')
    assert.equal(io.calls.includes('verifyGeneratedTypes'), stage !== 'database-applied')
  }
  for (const method of ['verifyProductionApply', 'applicationCommitInDefaultBranch', 'verifyLiveAssertion', 'verifyGeneratedTypes']) {
    const io = runtimeIo(); io[method] = () => false
    assert.throws(() => publishStageEvent(publishInput({ stage: 'live-verified', evidenceRef: 'https://github.com/popcre/shared-db/issues/10#issuecomment-123' }), io))
    assert.equal(io.refs.size, 0)
  }
})

test('runtime stage proof is bound to authorized exact acceptance and cannot be edited after publication', () => {
  for (const mutate of [
    io => { io.evidenceComment.user.login = 'attacker' },
    io => { io.evidenceComment.body = 'malformed' },
    io => { io.parseScope = () => ({ workType: 'repo-maintenance' }) },
    io => { io.prStructuralInspection = () => ({ objects: ['public.wrong'] }) },
    io => { io.evidenceComment.body = io.evidenceComment.body.replace('business behavior works', 'different acceptance') },
  ]) {
    const io = runtimeIo(); mutate(io)
    assert.throws(() => publishStageEvent(publishInput({ stage: 'live-verified', evidenceRef: 'https://github.com/popcre/shared-db/issues/10#issuecomment-123' }), io))
  }
  const io = runtimeIo(), result = publishStageEvent(publishInput({ stage: 'live-verified', evidenceRef: 'https://github.com/popcre/shared-db/issues/10#issuecomment-123' }), io)
  io.evidenceComment.body += '\nchanged'
  assert.throws(() => createStageEvidenceVerifier(io, 'popcre/shared-db')(result.event), /digest changed/)
})


test('publisher rejects bad identities before IO and final cancellation before checkpoint writes', () => {
  for (const over of [{ issue: -1 }, { pr: '99' }, { repository: ['popcre/shared-db'] }, { stage: 'complete' }]) {
    const io = runtimeIo(); io.getPr = () => { throw new Error('IO should not run') }
    assert.throws(() => publishStageEvent(publishInput(over), io), /identity is invalid/)
  }
  const io = runtimeIo()
  io.comments.push({ author: 'u2giants', author_association: expectedOperatorAssociation(), body: '```db-work-completion\n' + JSON.stringify({ schema_version: 1, work_issue: 10, outcome: 'cancelled', reason: 'cancelled' }) + '\n```' })
  assert.throws(() => publishStageEvent(publishInput(), io), /immutable final completion/)
  assert.equal(io.refs.size, 0)
})


test('publisher accepts every repository chat signature and refuses malformed ones', () => {
  for (const signature of ['Posted by Codex chat abc on host', 'Posted by Claude chat abc on host', 'Posted by MiMo chat unknown on edge-dev']) {
    assert.equal(publishStageEvent(publishInput({ signature }), runtimeIo()).event.stage, 'implementation-merged')
  }
  for (const signature of ['Posted by MiMo chat', 'signed by MiMo chat x on y', 'Posted by MiMo chat  on host', 42]) {
    const io = runtimeIo()
    io.getPr = () => { throw new Error('IO should not run') }
    assert.throws(() => publishStageEvent(publishInput({ signature }), io), /chat signature/)
  }
})


test('database-applied accepts its own complete proof without any future live proof', () => {
  const io = runtimeIo()
  const record = parseOutcomeEvidence(io.evidenceComment.body)
  for (const key of ['application_commit_sha', 'live_evidence', 'live_artifact_id', 'live_artifact_digest']) delete record[key]
  io.evidenceComment.body = '```db-outcome-evidence\n' + JSON.stringify(record) + '\n```'
  const input = publishInput({ stage: 'database-applied', evidenceRef: 'https://github.com/popcre/shared-db/issues/10#issuecomment-123' })
  assert.equal(publishStageEvent(input, io).event.stage, 'database-applied')
  assert.ok(!io.calls.includes('verifyLiveAssertion'))
  assert.throws(() => parseOutcomeEvidence(io.evidenceComment.body), /application_commit_sha/)
  assert.throws(() => parseOutcomeEvidence(io.evidenceComment.body, { requiredStage: 'imaginary' }), /unknown required/)
  for (const key of ['production_evidence', 'production_commit_sha', 'production_artifact_id', 'production_artifact_digest']) {
    const bad = { ...record }; delete bad[key]
    assert.throws(() => parseOutcomeEvidence('```db-outcome-evidence\n' + JSON.stringify(bad) + '\n```', { requiredStage: 'database-applied' }))
  }
  assert.throws(() => publishStageEvent({ ...input, stage: 'live-verified' }, io), /application_commit_sha/)
})
