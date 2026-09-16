import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHoldReason, assertNamedHold, validateHoldReasonRecord, describeLeaseHolder, formatHoldReason, HoldReasonError } from './hold-reason.mjs'

const facts = (over = {}) => ({
  leaseHolder: () => null,
  claim: (n) => (n === 7 ? { open: true, objects: ['table core.a'], reads: ['table core.b'] } : null),
  issue: (n) => (n === 5 ? { state: 'open', dependencies: [9], objects: ['table core.a'], reads: [] } : n === 9 ? { state: 'open', dependencies: [], objects: [], reads: [] } : null),
  ...over,
})

test('grammar refuses free text and unrelated stages', () => {
  assert.deepEqual(parseHoldReason('object:#7:Table core.b, table core.a'), { kind: 'object', claim: 7, objects: ['table core.a', 'table core.b'] })
  for (const bad of ['', 'wait for #2860 production', 'lease:deploy', 'production:#2860', 'object:#7:']) assert.throws(() => parseHoldReason(bad), HoldReasonError)
})

test('lease hold accepted only while the lease is held', () => {
  assert.throws(() => assertNamedHold({ heldIssue: 5, reason: 'lease:production' }, facts()), /nobody holds/)
  const record = assertNamedHold({ heldIssue: 5, reason: 'lease:production' }, facts({ leaseHolder: () => ({ ownerSha: 'abcdef1234567890', message: 'db-coordination production r pr=12 head=x\nholder_id: h1' }) }))
  assert.equal(record.holder, 'production lease abcdef123456, holder h1, PR #12')
  assert.equal(validateHoldReasonRecord(record), record)
  assert.equal(formatHoldReason(record), 'waiting for production lease abcdef123456, holder h1, PR #12')
})

test('claim, object and dependency holds need a real conflict or declaration', () => {
  assert.deepEqual(assertNamedHold({ heldIssue: 5, reason: 'claim:#7' }, facts()).objects, ['table core.a'])
  assert.throws(() => assertNamedHold({ heldIssue: 5, reason: 'object:#7:table core.b' }, facts()), /do not conflict/)
  assert.throws(() => assertNamedHold({ heldIssue: 5, reason: 'claim:#8' }, facts()), /not an open author claim/)
  assert.equal(assertNamedHold({ heldIssue: 5, reason: 'dependency:#9' }, facts()).holder, 'issue #9')
  assert.throws(() => assertNamedHold({ heldIssue: 5, reason: 'dependency:#10' }, facts()), /not declared/)
  assert.throws(() => validateHoldReasonRecord({ kind: 'lease', holder: 'x' }), /stage/)
  assert.equal(describeLeaseHolder('merge', null, null), 'merge lease unknown')
})
