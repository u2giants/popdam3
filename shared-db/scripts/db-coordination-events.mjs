#!/usr/bin/env node
// Coordination lifecycle events (Step 5, issue #1366).
//
// WHY
// ---
// The state of a piece of database work is currently reconstructable only by
// reading issues, refs, pull requests, workflow runs, and comments together — and
// in practice, by reading an agent's chat transcript, which nobody else has. When
// something goes wrong there is no ordered account of what happened.
//
// This is that account: append-only events on the work issue, in one vocabulary,
// which `--coordination-audit` replays into a timeline.
//
// WHAT IS DELIBERATELY NOT HERE
// -----------------------------
// NO HEARTBEAT OR RENEWAL EVENTS FOR STAGES. Step 6 has no heartbeats, and a
// 10-minute renewal cadence would bury the timeline this exists to make readable.
// `claim_renewed` IS kept, because author-claim renewal is real, retained
// functionality (`renewExpiredClaim`) that happens rarely.
//
// A REFUSAL IS NOT AN ACQUISITION. Failed attempts may be recorded with
// `result: refused`, but only after the refusal is known, and they can never be
// mistaken for ownership. That distinction is the point of recording them at all.

import { createHash } from 'node:crypto'

export const EVENT_FENCE = 'db-coordination-event'
export const EVENT_SCHEMA_VERSION = 2
export const READABLE_EVENT_SCHEMA_VERSIONS = Object.freeze([1, 2])

export class EventError extends Error {}

export const EVENT_TYPES = Object.freeze([
  'contract_published', 'contract_superseded',
  'dispatched',
  'claim_acquired', 'claim_renewed', 'claim_expanded', 'claim_released',
  'author_capacity_relinquished', 'author_capacity_resumed',
  'issue_blocked', 'issue_unblocked',
  'ci_started', 'ci_completed',
  'review_wait',
  'review_started', 'review_completed',
  'preview_wait', 'preview_ready',
  'preview_acquired', 'preview_released',
  'merge_acquired', 'merge_released',
  'production_acquired', 'production_released',
  'recovery_started', 'recovery_completed',
  'work_completed', 'work_cancelled', 'work_returned',
])

export const EVENT_RESULTS = Object.freeze(['succeeded', 'refused'])

// Acquisition/release pairs, used to reject an impossible sequence: releasing
// something never acquired, or acquiring it twice without releasing.
const STAGE_PAIRS = Object.freeze({
  preview_acquired: 'preview_released',
  merge_acquired: 'merge_released',
  production_acquired: 'production_released',
  claim_acquired: 'claim_released',
})
const RELEASE_TO_ACQUIRE = Object.freeze(Object.fromEntries(Object.entries(STAGE_PAIRS).map(([a, r]) => [r, a])))

const TERMINAL_EVENTS = Object.freeze(['work_completed', 'work_cancelled', 'work_returned'])

/**
 * Hand-rolled validation, matching Steps 3 and 4 and the precedent in
 * `scripts/check-handoff-contract.mjs`. No new dependency; every rule readable.
 */
export function validateEvent(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) throw new EventError('event must be a JSON object')
  if (!READABLE_EVENT_SCHEMA_VERSIONS.includes(event.schema_version)) throw new EventError(`event schema_version must be one of ${READABLE_EVENT_SCHEMA_VERSIONS.join(', ')}`)
  if (typeof event.event_id !== 'string' || !event.event_id.trim()) throw new EventError('event must carry an event_id')
  if (!EVENT_TYPES.includes(event.event_type)) throw new EventError(`event_type must be one of ${EVENT_TYPES.join(', ')}`)
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) throw new EventError('event timestamp must be an ISO instant')
  if (!Number.isInteger(event.work_issue) || event.work_issue <= 0) throw new EventError('event work_issue must be a positive issue number')
  if (typeof event.actor !== 'string' || !event.actor.trim()) throw new EventError('event must record an actor')
  if (!EVENT_RESULTS.includes(event.result)) throw new EventError(`event result must be one of ${EVENT_RESULTS.join(', ')}`)

  const v1 = ['schema_version', 'event_id', 'event_type', 'timestamp', 'work_issue', 'claim_issue', 'pr', 'head_sha', 'actor', 'provider', 'holder_id', 'generation', 'db_reads', 'db_writes', 'result', 'evidence_urls', 'detail']
  const v2 = ['ready_id', 'bundle_id', 'route', 'route_context', 'manifest_digest', 'invalidation_class', 'review_bundle_id', 'integration_sha']
  const known = new Set(event.schema_version === 1 ? v1 : [...v1, ...v2])
  for (const key of Object.keys(event)) {
    if (!known.has(key)) throw new EventError(`event has unknown field ${key}`)
  }
  for (const field of ['db_reads', 'db_writes', 'evidence_urls']) {
    if (event[field] !== undefined && !Array.isArray(event[field])) throw new EventError(`event ${field} must be an array when present`)
  }
  if (event.generation !== undefined && (!Number.isInteger(event.generation) || event.generation <= 0)) {
    throw new EventError('event generation must be a positive integer when present')
  }
  // A REFUSAL MUST SAY WHY. An unexplained refusal in a timeline is noise.
  if (event.result === 'refused' && (typeof event.detail !== 'string' || !event.detail.trim())) {
    throw new EventError('a refused event must carry a detail saying why it was refused')
  }
  return event
}

/**
 * Stable event id: same event, same id, so a retried publication is detectable as
 * a duplicate rather than appearing as a second thing that happened.
 */
export function eventId(event) {
  const material = [event.event_type, event.work_issue, event.timestamp, event.actor, event.holder_id ?? '', event.generation ?? '', event.pr ?? ''].join('|')
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}

export function coordinationEvent({ eventType, workIssue, claimIssue, actor, timestamp, detail, ...optional }) {
  const event = {
    schema_version: EVENT_SCHEMA_VERSION,
    event_id: '',
    event_type: eventType,
    timestamp,
    work_issue: Number(workIssue),
    actor,
    result: 'succeeded',
    ...(claimIssue === undefined ? {} : { claim_issue: Number(claimIssue) }),
    ...(detail ? { detail } : {}),
    ...optional,
  }
  event.event_id = eventId(event)
  return validateEvent(event)
}

export const previewWaitEvent = (input) => coordinationEvent({ ...input, eventType:'preview_wait' })
export const previewReadyEvent = (input) => coordinationEvent({ ...input, eventType:'preview_ready' })

export function parseEventComment(body) {
  if (typeof body !== 'string') return []
  const fences = [...body.matchAll(new RegExp('```' + EVENT_FENCE + '\\s*\\n([\\s\\S]*?)```', 'g'))]
  return fences.map((fence) => {
    let parsed
    try { parsed = JSON.parse(fence[1]) } catch { throw new EventError('db-coordination-event block is not valid JSON') }
    return validateEvent(parsed)
  })
}

export function formatEventComment(event) {
  validateEvent(event)
  return ['```' + EVENT_FENCE, JSON.stringify(event, null, 2), '```'].join('\n')
}

/**
 * Replay events into a timeline, rejecting duplicates and impossible transitions.
 *
 * A REFUSED EVENT CHANGES NO STATE. That is what makes it safe to record: the
 * timeline shows the attempt without ever implying ownership was taken.
 */
export function auditTimeline(events) {
  const problems = []
  const ordered = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.event_id.localeCompare(b.event_id))

  const seen = new Set()
  const held = new Set()
  let terminal = null

  for (const event of ordered) {
    if (seen.has(event.event_id)) { problems.push(`duplicate event_id ${event.event_id} (${event.event_type})`); continue }
    seen.add(event.event_id)

    if (event.result === 'refused') continue

    if (terminal && !TERMINAL_EVENTS.includes(event.event_type)) {
      problems.push(`${event.event_type} occurs after the work already ended with ${terminal}`)
    }
    if (STAGE_PAIRS[event.event_type]) {
      if (held.has(event.event_type)) problems.push(`${event.event_type} twice without an intervening ${STAGE_PAIRS[event.event_type]}`)
      held.add(event.event_type)
    }
    if (RELEASE_TO_ACQUIRE[event.event_type]) {
      const acquire = RELEASE_TO_ACQUIRE[event.event_type]
      if (!held.has(acquire)) problems.push(`${event.event_type} without a preceding ${acquire}`)
      held.delete(acquire)
    }
    if (TERMINAL_EVENTS.includes(event.event_type)) terminal = event.event_type
  }

  // A stage still held at the end of a completed piece of work is a leak, and a
  // leaked preview or merge lane blocks everyone else.
  for (const stage of held) {
    if (terminal) problems.push(`work ended with ${terminal} while still holding ${stage.replace('_acquired', '')}`)
  }

  return { valid: problems.length === 0, problems, events: ordered, terminal, stillHeld: [...held] }
}

/** Human-readable rendering. Stable ordering so two runs of an audit diff cleanly. */
export function renderTimeline(audit) {
  const lines = []
  for (const event of audit.events) {
    const marks = [event.result === 'refused' ? 'REFUSED' : null, event.generation ? `gen ${event.generation}` : null, event.pr ? `PR #${event.pr}` : null]
      .filter(Boolean).join(', ')
    lines.push(`${event.timestamp}  ${event.event_type}${marks ? `  (${marks})` : ''}  by ${event.actor}${event.detail ? ` — ${event.detail}` : ''}`)
  }
  if (!audit.valid) {
    lines.push('')
    lines.push('TIMELINE PROBLEMS:')
    for (const problem of audit.problems) lines.push(`  - ${problem}`)
  }
  return lines.join('\n')
}
