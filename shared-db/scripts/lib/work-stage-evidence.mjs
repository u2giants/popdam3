import { createHash } from 'node:crypto'
import { isTrustedOperatorComment } from './repository-identity.mjs'
import { findCompletionRecord, isSuccessful } from './work-dependencies.mjs'
import { parseOutcomeEvidence } from '../orchestrator-flow/outcome-lifecycle.mjs'
import { STRUCTURAL_ROUTES, structuralWritesMatch } from '../orchestrator-flow/admission.mjs'

export const REQUIRED_STAGES = Object.freeze(['implementation-merged', 'database-applied', 'live-verified', 'application-accepted', 'complete'])
export const STAGE_FENCE = 'db-work-stage'
const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/
const EVENT_FIELDS = Object.freeze(['schema_version', 'repository', 'work_issue', 'stage', 'pr', 'head_sha', 'merge_sha', 'evidence_digest', 'evidence_ref', 'event_id'])
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function stageEventKey(event) {
  return createHash('sha256').update(JSON.stringify([
    event.repository, event.work_issue, event.stage, event.evidence_digest,
  ])).digest('hex')
}

export function validateStageEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.schema_version !== 1) throw new Error('stage event schema_version must be 1')
  if (Object.keys(event).some(key => !EVENT_FIELDS.includes(key))) throw new Error('stage event has unknown fields')
  if (typeof event.repository !== 'string' || !REPOSITORY.test(event.repository)) throw new Error('stage event repository is required')
  if (!Number.isSafeInteger(event.work_issue) || event.work_issue <= 0) throw new Error('stage event work_issue must be positive')
  if (!REQUIRED_STAGES.includes(event.stage) || event.stage === 'complete') throw new Error('stage event must name an intermediate required stage; complete uses the final record')
  if (!Number.isSafeInteger(event.pr) || event.pr <= 0) throw new Error('stage event pr must be positive')
  for (const field of ['head_sha', 'merge_sha']) if (typeof event[field] !== 'string' || !SHA.test(event[field])) throw new Error(`stage event ${field} must be an exact SHA`)
  if (typeof event.evidence_digest !== 'string' || !DIGEST.test(event.evidence_digest)) throw new Error('stage event evidence_digest must be sha256')
  if (typeof event.evidence_ref !== 'string' || !event.evidence_ref.trim()) throw new Error('stage event evidence_ref is required')
  if (event.event_id !== stageEventKey(event)) throw new Error('stage event id does not bind task, stage and evidence digest')
  return Object.freeze(event)
}

// Comments are transport, never proof. The trusted operator may publish an event,
// but current repository facts and stage-specific evidence must still verify it.
export function findStageEvents(comments) {
  const events = new Map()
  for (const comment of comments ?? []) {
    const matches = [...String(comment?.body ?? '').matchAll(/```db-work-stage\s*\n([\s\S]*?)```/g)]
    if (!matches.length) continue
    if (!isTrustedOperatorComment(comment)) throw new Error('stage event author is not the trusted repository operator')
    if (matches.length !== 1) throw new Error('a stage comment must contain exactly one event')
    const event = validateStageEvent(JSON.parse(matches[0][1]))
    const prior = events.get(event.event_id)
    if (prior && EVENT_FIELDS.some(field => prior[field] !== event[field])) throw new Error('conflicting stage event reuses an immutable event id')
    events.set(event.event_id, event)
  }
  return [...events.values()]
}

/**
 * This reader performs no network IO. `verify` is a current-world verifier owned
 * by the caller, NOT a field accepted from the issue/comment. It must return all
 * named checks after fetching the exact repository/issue/PR and immutable evidence.
 * Missing verifier/checks never authorize readiness. No stage implies another.
 */
export function verifyAcceptedStage({ issue, stage, repository, comments, verify }) {
  if (typeof repository !== 'string' || !REPOSITORY.test(repository)) throw new Error('current repository identity is required')
  if (!REQUIRED_STAGES.includes(stage) || stage === 'complete') throw new Error('intermediate required stage is invalid')
  const events = findStageEvents(comments).filter(event => event.work_issue === issue && event.stage === stage)
  if (!events.length) return { satisfied: false, status: 'waiting', reason: `dependency #${issue} has no ${stage} event` }
  if (typeof verify !== 'function') throw new Error('current-world stage evidence verifier is unavailable')
  // Every claim for the selected stage must verify. A newer event cannot hide a
  // revoked/conflicting earlier claim; explicit repair is needed instead.
  for (const event of events) {
    if (event.repository !== repository) throw new Error('stage event repository does not match the current repository')
    const proof = verify(event)
    if (!proof || typeof proof.then === 'function') throw new Error('stage verifier must return completed evidence checks')
    const checks = ['repositoryMatches', 'issueLinked', 'prMerged', 'headMatches', 'mergeMatches', 'mergeInMain', 'evidenceDigestMatches', 'evidenceAuthorized', 'evidenceCurrent', 'notRevoked', 'stageAccepted']
    for (const check of checks) if (!Object.hasOwn(proof, check) || proof[check] !== true) throw new Error(`stage evidence did not prove ${check}`)
  }
  return { satisfied: true, status: 'accepted-stage', reason: `dependency #${issue} verified ${stage}; issue closure is administrative`, events }
}

const EVENT_COMMIT_PREFIX = 'db-work-stage '
const hash = value => createHash('sha256').update(value).digest('hex')
export const stageEventRef = event => `refs/db-work-stages/${event.work_issue}/${event.stage}/${event.event_id}`
export const stageRevocationRef = event => `refs/db-work-stage-revocations/${event.event_id}`
const sameEvent = (a, b) => EVENT_FIELDS.every(field => a[field] === b[field])

function assertFinalConsistency(event, io) {
  const final = findCompletionRecord(io.issueComments(event.work_issue), { requireTrustedAuthor: true })
  if (final && (final.work_issue !== event.work_issue || !isSuccessful(final) || (final.pr !== undefined && final.pr !== event.pr) || (final.merge_sha !== undefined && final.merge_sha !== event.merge_sha))) throw new Error('stage event contradicts immutable final completion')
}

function mergedFacts(event, io) {
  const pr = io.getPr(event.pr)
  const linked = io.closingIssuesForPr(event.pr)
  if (pr?.base?.repo?.full_name !== event.repository || pr?.base?.ref !== 'main') throw new Error('stage PR targets the wrong repository or branch')
  if (!pr.merged_at || pr.head?.sha !== event.head_sha || pr.merge_commit_sha !== event.merge_sha) throw new Error('stage PR head or merge does not match GitHub')
  if (!Array.isArray(linked) || linked.length !== 1 || Number(linked[0]?.number) !== event.work_issue) throw new Error('stage PR must link exclusively to its work issue')
  if (io.mergeCommitInMain(event.merge_sha) !== true) throw new Error('stage merge is not proven in current main')
  return JSON.stringify({ repository: event.repository, work_issue: event.work_issue, pr: event.pr, head_sha: pr.head.sha, merge_sha: pr.merge_commit_sha })
}

function currentEvidence(event, io) {
  const merged = mergedFacts(event, io)
  if (event.stage === 'implementation-merged') {
    if (event.evidence_ref !== `https://github.com/${event.repository}/pull/${event.pr}`) throw new Error('implementation evidence must name the exact merged PR')
    return merged
  }
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9][0-9]*)#issuecomment-([1-9][0-9]*)$/.exec(event.evidence_ref)
  if (!match || match[1] !== event.repository || Number(match[2]) !== event.work_issue) throw new Error('stage evidence must be an exact comment on this work issue')
  const comments = io.getIssueComments(event.work_issue)
  const comment = comments.find(row => String(row.id) === match[3])
  if (!comment || !isTrustedOperatorComment({ ...comment, author: comment.user?.login ?? comment.author }, event.repository)) throw new Error('stage evidence is not authored by the trusted operator')
  // Use the existing outcome parser and exact artifact verifiers. They are
  // required IO capabilities, never boolean assertions supplied by a caller.
  const evidence = parseOutcomeEvidence(comment.body, { requiredStage: event.stage })
  if (evidence.work_issue !== event.work_issue || evidence.merge_pr !== event.pr || evidence.merge_sha !== event.merge_sha) throw new Error('outcome evidence belongs to another issue or merge')
  const scope = io.parseScope(io.getIssue(event.work_issue)?.body ?? '')
  if (!scope || scope.workType !== 'structural' || !STRUCTURAL_ROUTES.includes(scope.route)) throw new Error('runtime stage requires admitted structural outcome evidence')
  const inspection = io.prStructuralInspection(event.pr, event.merge_sha)
  if (!Array.isArray(scope.writes) || !structuralWritesMatch(inspection, [...scope.writes].sort())) throw new Error('stage PR objects do not match the admitted writes')
  if (evidence.application_repository !== scope.applicationReturnTo || evidence.live_assertion !== scope.liveAssertion) throw new Error('outcome evidence does not match the declared acceptance contract')
  if (io.verifyProductionApply(evidence) !== true) throw new Error('production application evidence did not verify')
  if (event.stage !== 'database-applied') {
    if (io.applicationCommitInDefaultBranch(evidence.application_repository, evidence.application_commit_sha) !== true || io.verifyLiveAssertion(evidence) !== true) throw new Error('live application evidence did not verify')
    if (scope.generatedTypes === 'required' && io.verifyGeneratedTypes(evidence) !== true) throw new Error('required generated types did not verify')
  }
  return comment.body
}

function readDurableEvent(event, io) {
  const sha = io.readRef(stageEventRef(event))
  if (!sha) return null
  const message = io.getCommit(sha)?.message
  if (typeof message !== 'string' || !message.startsWith(EVENT_COMMIT_PREFIX)) throw new Error('stage event ref payload is malformed')
  const recorded = validateStageEvent(JSON.parse(message.slice(EVENT_COMMIT_PREFIX.length)))
  if (!sameEvent(recorded, event)) throw new Error('stage event ref contradicts its comment')
  return recorded
}

/** Concrete current-world adapter. No issue-provided verification flags are read. */
export function createStageEvidenceVerifier(io, repository) {
  return event => {
    validateStageEvent(event)
    assertFinalConsistency(event, io)
    if (event.repository !== repository) throw new Error('stage repository does not match the active repository')
    if (!readDurableEvent(event, io)) throw new Error('immutable stage event is absent')
    if (io.readRef(stageRevocationRef(event)) !== null) throw new Error('stage evidence is revoked or revocation state is unknown')
    if (hash(currentEvidence(event, io)) !== event.evidence_digest) throw new Error('stage evidence digest changed')
    return Object.fromEntries(['repositoryMatches', 'issueLinked', 'prMerged', 'headMatches', 'mergeMatches', 'mergeInMain', 'evidenceDigestMatches', 'evidenceAuthorized', 'evidenceCurrent', 'notRevoked', 'stageAccepted'].map(check => [check, true]))
  }
}

/** Create-only durable checkpoint, followed by recoverable at-least-once comment delivery. */
export function publishStageEvent({ issue, stage, repository, pr, evidenceRef, signature }, io) {
  // Every chat that signs repository comments may publish; authorization stays
  // with the trusted-operator author check in the verifier, not this shape test.
  if (typeof signature !== 'string' || !/^Posted by (?:Codex|Claude|MiMo) chat \S+ on \S+$/.test(signature)) throw new Error('stage publication requires the posting chat signature')
  if (!Number.isSafeInteger(issue) || issue <= 0 || !Number.isSafeInteger(pr) || pr <= 0 || typeof repository !== 'string' || !REPOSITORY.test(repository) || !REQUIRED_STAGES.includes(stage) || stage === 'complete') throw new Error('stage publication identity is invalid')
  const pull = io.getPr(pr)
  const pending = { schema_version: 1, repository, work_issue: issue, stage, pr, head_sha: pull?.head?.sha, merge_sha: pull?.merge_commit_sha, evidence_ref: evidenceRef }
  // Validate shape before any read that interpolates issue, stage or repository.
  validateStageEvent({ ...pending, evidence_digest: '0'.repeat(64), event_id: stageEventKey({ ...pending, evidence_digest: '0'.repeat(64) }) })
  const evidence_digest = hash(currentEvidence(pending, io))
  const event = validateStageEvent({ ...pending, evidence_digest, event_id: stageEventKey({ ...pending, evidence_digest }) })
  assertFinalConsistency(event, io)
  if (io.readRef(stageRevocationRef(event)) !== null) throw new Error('revoked stage event cannot be republished')
  if (!readDurableEvent(event, io)) {
    const sha = io.makeOwnerCommit(EVENT_COMMIT_PREFIX + JSON.stringify(event))
    try { io.createRef(stageEventRef(event), sha) } catch (error) {
      if (!readDurableEvent(event, io)) throw error
    }
    if (!readDurableEvent(event, io)) throw new Error('created stage event did not read back')
  }
  createStageEvidenceVerifier(io, repository)(event)
  const seen = () => findStageEvents(io.issueComments(issue)).some(existing => existing.event_id === event.event_id && sameEvent(existing, event))
  if (seen()) return { event, resumed: true }
  let writeError
  try { io.commentIssue(issue, '```' + STAGE_FENCE + '\n' + JSON.stringify(event, null, 2) + '\n```\n\n' + signature) } catch (error) { writeError = error }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (seen()) return { event, resumed: false }
    if (attempt < 2) io.wait?.(250 * (attempt + 1))
  }
  throw writeError ?? new Error('durable stage saved but comment readback is unconfirmed; resume the same event without changing its evidence')
}
