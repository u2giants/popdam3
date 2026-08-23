import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EventError, EVENT_TYPES, EVENT_SCHEMA_VERSION,
  validateEvent, eventId, parseEventComment, formatEventComment,
  auditTimeline, renderTimeline,
} from './db-coordination-events.mjs'

const at = (minutes) => new Date(Date.UTC(2026, 7, 23, 12, minutes)).toISOString()
const event = (over = {}) => {
  const base = {
    schema_version: EVENT_SCHEMA_VERSION,
    event_type: 'dispatched',
    timestamp: at(0),
    work_issue: 42,
    actor: 'shared-db-orchestrator',
    result: 'succeeded',
    ...over,
  }
  return { ...base, event_id: over.event_id ?? eventId(base) }
}

test('a complete event validates', () => {
  assert.doesNotThrow(() => validateEvent(event()))
})

test('the envelope is checked', () => {
  assert.throws(() => validateEvent(null), /must be a JSON object/)
  assert.throws(() => validateEvent(event({ schema_version: 2 })), /schema_version must be 1/)
  assert.throws(() => validateEvent({ ...event(), event_id: '' }), /must carry an event_id/)
  assert.throws(() => validateEvent(event({ event_type: 'invented' })), /event_type must be one of/)
  assert.throws(() => validateEvent(event({ timestamp: 'yesterday' })), /must be an ISO instant/)
  assert.throws(() => validateEvent(event({ work_issue: 0 })), /positive issue number/)
  assert.throws(() => validateEvent(event({ actor: '' })), /must record an actor/)
  assert.throws(() => validateEvent(event({ result: 'maybe' })), /result must be one of/)
  assert.throws(() => validateEvent({ ...event(), surprise: 1 }), /unknown field surprise/)
})

// AN UNEXPLAINED REFUSAL IN A TIMELINE IS NOISE.
test('a refused event must say why', () => {
  assert.throws(() => validateEvent(event({ result: 'refused' })), /must carry a detail/)
  assert.doesNotThrow(() => validateEvent(event({ result: 'refused', detail: 'lane already held' })))
})

// NO STAGE HEARTBEATS. Step 6 has none, and a 10-minute cadence would bury the
// timeline this exists to make readable. Author-claim renewal is different: it is
// real, retained, and rare.
test('there are no stage renewal event types, but claim_renewed is kept', () => {
  assert.equal(EVENT_TYPES.includes('preview_renewed'), false)
  assert.equal(EVENT_TYPES.includes('merge_renewed'), false)
  assert.equal(EVENT_TYPES.includes('claim_renewed'), true, 'renewExpiredClaim is retained functionality and must remain expressible')
})

test('the same event yields the same id, so a retry is detectable as a duplicate', () => {
  assert.equal(eventId(event()), eventId(event()))
  assert.notEqual(eventId(event()), eventId(event({ event_type: 'claim_acquired' })))
})

test('events round-trip through a comment', () => {
  const original = event()
  const [parsed] = parseEventComment('prose\n' + formatEventComment(original) + '\nmore prose')
  assert.deepEqual(parsed, original)
  assert.deepEqual(parseEventComment('nothing here'), [])
  assert.throws(() => parseEventComment('```db-coordination-event\n{bad}\n```'), /not valid JSON/)
})

// --- TIMELINE AUDIT --------------------------------------------------------

test('a well-formed lifecycle replays cleanly', () => {
  const audit = auditTimeline([
    event({ event_type: 'contract_published', timestamp: at(0) }),
    event({ event_type: 'dispatched', timestamp: at(1) }),
    event({ event_type: 'claim_acquired', timestamp: at(2) }),
    event({ event_type: 'preview_acquired', timestamp: at(3) }),
    event({ event_type: 'preview_released', timestamp: at(4) }),
    event({ event_type: 'merge_acquired', timestamp: at(5) }),
    event({ event_type: 'merge_released', timestamp: at(6) }),
    event({ event_type: 'claim_released', timestamp: at(7) }),
    event({ event_type: 'work_completed', timestamp: at(8) }),
  ])
  assert.equal(audit.valid, true, audit.problems.join('; '))
  assert.equal(audit.terminal, 'work_completed')
  assert.deepEqual(audit.stillHeld, [])
})

test('events out of order are sorted by timestamp before replay', () => {
  const audit = auditTimeline([
    event({ event_type: 'preview_released', timestamp: at(4) }),
    event({ event_type: 'preview_acquired', timestamp: at(3) }),
  ])
  assert.equal(audit.valid, true)
})

test('a duplicate event_id is reported rather than counted twice', () => {
  const one = event({ event_type: 'preview_acquired', timestamp: at(1), event_id: 'fixed' })
  const audit = auditTimeline([one, { ...one }])
  assert.match(audit.problems.join(' '), /duplicate event_id fixed/)
})

test('releasing a stage never acquired is an impossible transition', () => {
  const audit = auditTimeline([event({ event_type: 'merge_released', timestamp: at(1) })])
  assert.equal(audit.valid, false)
  assert.match(audit.problems.join(' '), /merge_released without a preceding merge_acquired/)
})

test('acquiring a stage twice without releasing is an impossible transition', () => {
  const audit = auditTimeline([
    event({ event_type: 'preview_acquired', timestamp: at(1), holder_id: 'a' }),
    event({ event_type: 'preview_acquired', timestamp: at(2), holder_id: 'b' }),
  ])
  assert.match(audit.problems.join(' '), /preview_acquired twice without an intervening preview_released/)
})

// A LEAKED STAGE BLOCKS EVERYONE ELSE, so it must not pass an audit quietly.
test('finishing while still holding a stage is reported', () => {
  const audit = auditTimeline([
    event({ event_type: 'production_acquired', timestamp: at(1) }),
    event({ event_type: 'work_completed', timestamp: at(2) }),
  ])
  assert.equal(audit.valid, false)
  assert.match(audit.problems.join(' '), /still holding production/)
})

test('work continuing after it ended is reported', () => {
  const audit = auditTimeline([
    event({ event_type: 'work_completed', timestamp: at(1) }),
    event({ event_type: 'merge_acquired', timestamp: at(2) }),
  ])
  assert.match(audit.problems.join(' '), /occurs after the work already ended/)
})

// THE POINT OF RECORDING REFUSALS: they show the attempt without ever implying
// ownership was taken.
test('a refused acquisition changes no state and cannot leak a stage', () => {
  const audit = auditTimeline([
    event({ event_type: 'preview_acquired', timestamp: at(1), result: 'refused', detail: 'already held by #99' }),
    event({ event_type: 'work_completed', timestamp: at(2) }),
  ])
  assert.equal(audit.valid, true, audit.problems.join('; '))
  assert.deepEqual(audit.stillHeld, [], 'a refusal must never look like an acquisition')
})

test('a refused release does not consume a real acquisition', () => {
  const audit = auditTimeline([
    event({ event_type: 'merge_acquired', timestamp: at(1) }),
    event({ event_type: 'merge_released', timestamp: at(2), result: 'refused', detail: 'wrong generation' }),
    event({ event_type: 'merge_released', timestamp: at(3) }),
  ])
  assert.equal(audit.valid, true, audit.problems.join('; '))
})

test('the rendered timeline is stable and shows problems', () => {
  const audit = auditTimeline([
    event({ event_type: 'preview_acquired', timestamp: at(1), generation: 2 }),
    event({ event_type: 'merge_released', timestamp: at(2) }),
  ])
  const text = renderTimeline(audit)
  assert.match(text, /preview_acquired {2}\(gen 2\)/)
  assert.match(text, /TIMELINE PROBLEMS:/)
  assert.equal(renderTimeline(audit), text, 'rendering must be deterministic so two audits diff cleanly')
})

test('EventError is the single error type callers catch', () => {
  assert.throws(() => validateEvent(null), EventError)
})
