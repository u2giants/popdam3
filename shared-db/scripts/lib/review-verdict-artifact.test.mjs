import assert from 'node:assert/strict'
import test from 'node:test'
import { findingsDigest, formatVerdictMessage, parseVerdictRef, validateVerdictArtifact, verdictRef } from './review-verdict-artifact.mjs'

const head='a'.repeat(40),assignmentSha='b'.repeat(40),sha='c'.repeat(40),findings='Coverage: scripts and workflow. No material findings.'
const ref=verdictRef({issue:1824,pr:2000,headSha:head,slot:2})
const record={verdict:'APPROVE',head_sha:head,issue:1824,pr:2000,slot:2,reviewer:'glm-5.3',assignment_sha:assignmentSha,findings_digest:findingsDigest(findings),findings_ref:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-123'}
const artifact=(overrides={})=>({ref,sha,commit:{message:formatVerdictMessage({...record,...overrides.record}),parents:overrides.parents??[{sha:assignmentSha}]},findingsBody:overrides.findingsBody??findings,activeLeaseSha:overrides.activeLeaseSha??assignmentSha,assignment:{sha:assignmentSha,reviewer:overrides.assignmentReviewer??'glm-5.3'}})

test('real GitHub commit/ref/comment shapes validate as one exact durable verdict',()=>{
  assert.equal(parseVerdictRef(ref).slot,2)
  assert.equal(validateVerdictArtifact(artifact()).verdict,'APPROVE')
})

test('mutation: widening the verdict enum is detected',()=>assert.throws(()=>validateVerdictArtifact(artifact({record:{verdict:'APPROVE WITH CONDITIONS'}})),/must be APPROVE/))
test('mutation: dropping assignment parentage is detected',()=>assert.throws(()=>validateVerdictArtifact(artifact({parents:[{sha:'d'.repeat(40)}]})),/direct child/))
test('mutation: recording outside the exact reviewer lease is detected',()=>assert.throws(()=>validateVerdictArtifact(artifact({activeLeaseSha:'e'.repeat(40)})),/conflicting active lease/))
test('a durable verdict remains valid after the reviewer lease rotates',()=>assert.equal(validateVerdictArtifact({...artifact(),activeLeaseSha:undefined}).verdict,'APPROVE'))
test('mutation: substituting reviewer identity is detected',()=>assert.throws(()=>validateVerdictArtifact(artifact({assignmentReviewer:'kimi-k3'})),/does not own/))
test('mutation: changing durable findings after recording is detected',()=>assert.throws(()=>validateVerdictArtifact(artifact({findingsBody:'edited later'})),/digest/))
test('mutation: findings on another PR cannot authorize this PR',()=>assert.throws(()=>validateVerdictArtifact(artifact({record:{findings_ref:'https://github.com/u2giants/shared-db/pull/2001#issuecomment-123'}})),/reviewed shared-db PR/))
test('replacement verdict namespace is exact and cannot masquerade as an original assignment',()=>{
  const replacement=verdictRef({issue:1824,pr:2000,headSha:head,replacementSequence:7})
  assert.equal(parseVerdictRef(replacement).replacementSequence,7)
  assert.equal(parseVerdictRef(`${replacement}-8`),null)
})
