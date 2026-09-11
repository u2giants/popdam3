/**
 * Issue #2318: regression coverage proving that delegated traffic, a `db-work`
 * label, a handoff, or a structural need cannot create orchestrator authority,
 * and that the safe default stays non-orchestrator Path A.
 *
 * NO DATABASE, NO NETWORK. Every input is a literal.
 *
 * The cases are not hypothetical. Each refusal test names a step in the actual
 * reasoning that produced unauthorized marker #2312 on 2026-09-04.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseRoutingBlock, renderRoutingBlock } from './orchestrator-routing.mjs'
import {
  AUTHORIZATION_EFFECTIVE_DATE,
  AUTHORIZATION_FIELD,
  REFUSED_GROUNDS,
  validateAdmission,
  validateAuthorizationValue,
} from './orchestrator-admission.mjs'

/** A marker opened after admission took effect, so the field is required. */
const AFTER = '2026-09-11T09:00:00Z'
/** A marker opened before it, so a missing field is grandfathered with a warning. */
const BEFORE = '2026-09-09T09:00:00Z'

const fields = (over = {}) => ({
  status: 'active',
  identifier: 'shared-db.orch',
  engine: 'codex',
  session_name: 'shared-db.orch EDGE-DEV 2318',
  route_id: '00000000-0000-7000-8000-00000000a1a1',
  owner: 'u2giants',
  machine: 'EDGE-DEV',
  started: '2026-09-11T08:00:00Z',
  handover_issue: 'none',
  briefing: 'HANDOFF.d/example.md',
  ...over,
})

// --- the four inferences that actually happened -----------------------------

test('a `db-work` label is refused, and the refusal says a label routes work rather than creating a role', () => {
  const result = validateAuthorizationValue('db-work')
  assert.equal(result.admissible, false)
  assert.match(result.problems[0], /REFUSED/)
  assert.match(result.problems[0], /routes work to an orchestrator; it never creates one/)
  assert.match(result.problems[0], /Path A/)
})

test('delegated task traffic is refused, and the refusal names marker #2312', () => {
  for (const ground of ['delegated-task', 'delegation', 'task-traffic', 'cross-task-delegation']) {
    const result = validateAuthorizationValue(ground)
    assert.equal(result.admissible, false, `${ground} must not be admissible`)
  }
  assert.match(validateAuthorizationValue('task-traffic').problems[0], /marker #2312/)
  assert.match(
    validateAuthorizationValue('delegated-task').problems[0],
    /cannot grant a role it does not own/,
  )
})

test('a structural need is refused, and is told to QUEUE the work instead', () => {
  const result = validateAuthorizationValue('structural-need')
  assert.equal(result.admissible, false)
  assert.match(result.problems[0], /reason to QUEUE work for an orchestrator, not grounds to become one/)
})

test('a handoff document is refused, and is pointed at the one handover form that is admissible', () => {
  const result = validateAuthorizationValue('handoff')
  assert.equal(result.admissible, false)
  assert.match(result.problems[0], /cannot confer a role/)
  assert.match(result.problems[0], /owner-authorized-handover #<marker issue>/)
})

test('every refused ground is refused, and none of them leaks through as free text', () => {
  for (const ground of Object.keys(REFUSED_GROUNDS)) {
    const result = validateAuthorizationValue(ground)
    assert.equal(result.admissible, false, `${ground} must be refused`)
    assert.match(result.problems[0], /REFUSED/, `${ground} must say REFUSED`)
  }
})

test('a refused ground is still refused when written with spaces, underscores, capitals or a trailing period', () => {
  for (const written of ['DB Work', 'db_work', 'Structural Need.', 'Task Traffic']) {
    assert.equal(validateAuthorizationValue(written).admissible, false, `${written} must be refused`)
  }
})

// --- fail closed ------------------------------------------------------------

test('an unrecognised ground is REFUSED, not accepted as free text', () => {
  const result = validateAuthorizationValue('the migration was urgent and nobody else was running')
  assert.equal(result.admissible, false)
  assert.match(result.problems[0], /not a recognised ground, so it is REFUSED/)
  assert.match(result.problems[0], /stay a non-orchestrator\s+session and queue the work/)
})

test('a blank or missing ground is refused, and blank is explicitly not a default', () => {
  for (const value of ['', '   ', undefined, null]) {
    const result = validateAuthorizationValue(value)
    assert.equal(result.admissible, false)
    assert.match(result.problems[0], /Blank is never a default/)
  }
})

test('an almost-right owner form is refused rather than rounded up to the real one', () => {
  for (const value of [
    'owner-current-chat',
    'owner-current-chat yesterday',
    'owner-current-chat 2026-09-11',
    'owner current chat 2026-09-11T09:00:00Z',
    'owner-authorized-handover',
    'owner-authorized-handover #',
  ]) {
    assert.equal(validateAuthorizationValue(value).admissible, false, `${value} must be refused`)
  }
})

// --- the two admissible grounds --------------------------------------------

test('explicit owner authorization in the current chat is admissible', () => {
  const result = validateAuthorizationValue('owner-current-chat 2026-09-11T09:12:00Z')
  assert.equal(result.admissible, true)
  assert.equal(result.form, 'owner-current-chat')
  assert.deepEqual(result.problems, [])
})

test('an owner-authorized handover is admissible only when it cites the marker it is actually continuing', () => {
  const good = validateAuthorizationValue('owner-authorized-handover #2625', { handoverIssue: 2625 })
  assert.equal(good.admissible, true)
  assert.equal(good.form, 'owner-authorized-handover')

  const wrong = validateAuthorizationValue('owner-authorized-handover #2625', { handoverIssue: 2312 })
  assert.equal(wrong.admissible, false)
  assert.match(wrong.problems[0], /names a different one/)

  const none = validateAuthorizationValue('owner-authorized-handover #2625', { handoverIssue: null })
  assert.equal(none.admissible, false)
  assert.match(none.problems[0], /A handover you are not continuing is not a handover/)
})

// --- whole-marker admission -------------------------------------------------

test('a marker opened after the effective date must carry the field, and a missing one fails', () => {
  const result = validateAdmission(fields(), { createdAt: AFTER })
  assert.equal(result.required, true)
  assert.equal(result.admissible, false)
  assert.equal(result.warnings.length, 0)
  assert.match(result.problems[0], /Blank is never a default/)
})

test('a marker opened before the effective date is grandfathered with a WARNING, never a silent pass', () => {
  const result = validateAdmission(fields(), { createdAt: BEFORE })
  assert.equal(result.required, false)
  assert.equal(result.admissible, false)
  assert.deepEqual(result.problems, [])
  assert.match(result.warnings[0], /does not fail the guard/)
  assert.match(result.warnings[0], /were never recorded and cannot be audited/)
})

test('grandfathering covers a MISSING field only -- a pre-existing marker that writes a refused ground still fails', () => {
  const result = validateAdmission(fields({ [AUTHORIZATION_FIELD]: 'db-work' }), { createdAt: BEFORE })
  assert.equal(result.required, true)
  assert.equal(result.admissible, false)
  assert.match(result.problems[0], /REFUSED/)
})

test('a marker with an admissible handover ground passes only when its own handover_issue agrees', () => {
  const agreeing = validateAdmission(
    fields({ handover_issue: '#2625', [AUTHORIZATION_FIELD]: 'owner-authorized-handover #2625' }),
    { createdAt: AFTER },
  )
  assert.equal(agreeing.admissible, true)

  const disagreeing = validateAdmission(
    fields({ handover_issue: 'none', [AUTHORIZATION_FIELD]: 'owner-authorized-handover #2625' }),
    { createdAt: AFTER },
  )
  assert.equal(disagreeing.admissible, false)
})

test('a marker with no routing block at all is not admissible, and adds no second failure on top of the routing one', () => {
  const result = validateAdmission(null, { createdAt: AFTER })
  assert.equal(result.admissible, false)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.warnings, [])
})

test('an unreadable creation date is treated as in-force, never as grandfathered', () => {
  for (const createdAt of [null, undefined, '', 'not-a-date']) {
    const result = validateAdmission(fields(), { createdAt })
    assert.equal(result.required, true, `${createdAt} must not grandfather`)
    assert.equal(result.admissible, false)
  }
})

// --- the field is authored into new markers ---------------------------------

test('a newly rendered routing block carries the authorization field, and a blank one is refused', () => {
  const block = renderRoutingBlock(fields())
  assert.match(block, new RegExp(`^${AUTHORIZATION_FIELD}:`, 'm'))

  const parsed = parseRoutingBlock(block)
  assert.equal(parsed[AUTHORIZATION_FIELD], '')
  assert.equal(validateAdmission(parsed, { createdAt: AFTER }).admissible, false)
})

test('the effective date is a date, and is the day after admission shipped rather than the day of', () => {
  assert.match(AUTHORIZATION_EFFECTIVE_DATE, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(AUTHORIZATION_EFFECTIVE_DATE > '2026-09-09', true)
})
