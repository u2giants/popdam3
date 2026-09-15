import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { DELIVERY_CHECKS } from './delivery-preflight.mjs'
import { assertDeliveryPreflightBeforeReview, planDeliveryPreflight, runDeliveryPreflightGate } from './delivery-preflight-gate.mjs'

const HEAD_A = 'a'.repeat(40), HEAD_B = 'c'.repeat(40)
const checksFor = (head, status = 'PASS') => {
  const checks = Object.fromEntries(DELIVERY_CHECKS.map((name) => [name, { status: name === 'reviewer_capacity' ? status : 'PASS', evidence_id: `${name}-${head.slice(0, 4)}` }]))
  for (const name of ['sidecars', 'producers']) {
    const registration = { evidence_id: checks[name].evidence_id, kind: name, issue: 2728, pr: 2800, head_sha: head, producer_id: `${name}-producer`, artifact_digest: 'b'.repeat(64) }
    Object.assign(checks[name], { producer_id: registration.producer_id, artifact_digest: registration.artifact_digest, registry_digest: sha256(canonicalJson(registration)) })
  }
  return checks
}
function adaptersFor(head, status = 'PASS', calls = []) {
  const checks = checksFor(head, status)
  const adapters = Object.fromEntries(DELIVERY_CHECKS.map((name) => [name, () => { calls.push(name); return checks[name] }]))
  adapters.readEvidenceRegistration = (id) => {
    for (const h of [HEAD_A, HEAD_B]) for (const name of ['sidecars', 'producers']) {
      const check = checksFor(h)[name]
      if (check.evidence_id === id) return { evidence_id: id, kind: name, issue: 2728, pr: 2800, head_sha: h, producer_id: check.producer_id, artifact_digest: check.artifact_digest }
    }
    return null
  }
  return adapters
}
const identity = { policy_version: 1, migrations: [], focused_files: [], verification_files: [], claims: { writes: ['public.thing'], reads: [] }, global_invalidators: [{ path: 'config/orchestrator-global-invalidators-v1.json', sha256: 'd'.repeat(64) }], migration_order_digest: '0'.repeat(64) }
const bundleAt = (head, id = identity) => ({ schema_version: 1, bundle_id: sha256(canonicalJson(id)), identity: id, metadata: { issue: 2728, pr: 2800, claim: 1, base_main_sha: 'e'.repeat(40), integration_sha: head, review: null, ci: null } })
const facts = (head) => ({ integration_sha: head, evidence_integration_sha: head, history_available: true, full_ci_success: true, merge_base_is_current_main: true, intervening_changes: [{ id: 'docs-move', writes: [], reads: [] }] })

function priorRun() {
  const calls = []
  const first = runDeliveryPreflightGate({ currentBundle: bundleAt(HEAD_A) }, adaptersFor(HEAD_A, 'PASS', calls))
  return { first, calls }
}

test('the first run composes every gate once and registers its digest in the bundle', () => {
  const { first, calls } = priorRun()
  assert.deepEqual(calls, DELIVERY_CHECKS)
  assert.equal(first.reused, false)
  assert.deepEqual(first.bundle.metadata.delivery_preflight, { preflight_id: first.record.preflight_id, input_digest: first.record.input_digest })
})

test('unrelated doc movement reuses the sealed preflight without rerunning any gate', () => {
  const { first } = priorRun()
  const calls = []
  const second = runDeliveryPreflightGate({ currentBundle: bundleAt(HEAD_B), priorBundle: first.bundle, priorRecord: first.record, changedFiles: ['docs/notes.md'], integration: facts(HEAD_B) }, adaptersFor(HEAD_B, 'PASS', calls))
  assert.equal(second.reused, true, second.plan.reason)
  assert.deepEqual(calls, [])
  assert.equal(second.carried_from, HEAD_A)
  assert.equal(second.bundle.metadata.integration_sha, HEAD_B)
  const carried = assertDeliveryPreflightBeforeReview({ record: second.record, bundle: second.bundle, issue: 2728, pr: 2800, headSha: HEAD_B, priorBundle: first.bundle, changedFiles: ['docs/notes.md'], integration: facts(HEAD_B) }, adaptersFor(HEAD_B))
  assert.equal(carried.ok, true); assert.equal(carried.carried_from, HEAD_A)
})

test('POSITIVE CONTROL: a changed bundle reruns the gates', () => {
  const { first } = priorRun()
  const changed = bundleAt(HEAD_B, { ...identity, claims: { writes: ['public.thing', 'public.other'], reads: [] } })
  const calls = []
  const second = runDeliveryPreflightGate({ currentBundle: changed, priorBundle: first.bundle, priorRecord: first.record, changedFiles: ['supabase/migrations/x.sql'], integration: facts(HEAD_B) }, adaptersFor(HEAD_B, 'PASS', calls))
  assert.equal(second.reused, false); assert.match(second.plan.reason, /CONTENT_INVALIDATED/); assert.deepEqual(calls, DELIVERY_CHECKS)
})

test('POSITIVE CONTROL: a global invalidator change or unproven CI reruns the gates', () => {
  const { first } = priorRun()
  const base = { currentBundle: bundleAt(HEAD_B), priorBundle: first.bundle, priorRecord: first.record }
  assert.match(planDeliveryPreflight({ ...base, changedFiles: ['config/orchestrator-global-invalidators-v1.json'], integration: facts(HEAD_B) }).reason, /GLOBAL_INVALIDATOR/)
  assert.match(planDeliveryPreflight({ ...base, changedFiles: [], integration: { ...facts(HEAD_B), full_ci_success: false } }).reason, /UNVERIFIABLE/)
  assert.equal(planDeliveryPreflight({ ...base, changedFiles: [], integration: facts(HEAD_A) }).reuse, false)
})

test('a blocked preflight refuses, and review refuses a blocked or absent record', () => {
  assert.throws(() => runDeliveryPreflightGate({ currentBundle: bundleAt(HEAD_A) }, adaptersFor(HEAD_A, 'BLOCKED')), /blocked by reviewer_capacity/)
  const { first } = priorRun()
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: null, bundle: first.bundle, issue: 2728, pr: 2800, headSha: HEAD_A }), /no delivery preflight record/)
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: { ...first.record, status: 'BLOCKED' }, bundle: first.bundle, issue: 2728, pr: 2800, headSha: HEAD_A }), /BLOCKED/)
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: first.record, bundle: bundleAt(HEAD_A), issue: 2728, pr: 2800, headSha: HEAD_A }, adaptersFor(HEAD_A)), /does not register/)
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: first.record, bundle: first.bundle, issue: 2728, pr: 2800, headSha: HEAD_B }, adaptersFor(HEAD_A)), /not bound to head/)
  assert.equal(assertDeliveryPreflightBeforeReview({ record: first.record, bundle: first.bundle, issue: 2728, pr: 2800, headSha: HEAD_A }, adaptersFor(HEAD_A)).ok, true)
})

test('POSITIVE CONTROL: review refuses a PASS record sealed at another head unless the carry is re-proven', () => {
  const { first } = priorRun()
  const second = runDeliveryPreflightGate({ currentBundle: bundleAt(HEAD_B), priorBundle: first.bundle, priorRecord: first.record, changedFiles: ['docs/notes.md'], integration: facts(HEAD_B) }, adaptersFor(HEAD_B))
  assert.equal(second.reused, true)
  // The bundle at HEAD_B registers the record, but the record was sealed at HEAD_A.
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: second.record, bundle: second.bundle, issue: 2728, pr: 2800, headSha: HEAD_B }, adaptersFor(HEAD_B)), /sealed at head a{40}, not c{40}/)
  // A prior bundle that did not seal the record is not a carry proof.
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: second.record, bundle: second.bundle, issue: 2728, pr: 2800, headSha: HEAD_B, priorBundle: bundleAt(HEAD_A), changedFiles: [], integration: facts(HEAD_B) }, adaptersFor(HEAD_B)), /does not carry.*does not register/)
})

test('POSITIVE CONTROL: review refuses a stale PASS record re-registered in a bundle with a different identity', () => {
  const { first } = priorRun()
  const otherIdentity = { ...identity, claims: { writes: ['public.thing', 'public.other'], reads: [] } }
  const stale = { ...bundleAt(HEAD_B, otherIdentity) }
  stale.metadata = { ...stale.metadata, delivery_preflight: { preflight_id: first.record.preflight_id, input_digest: first.record.input_digest } }
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: first.record, bundle: stale, issue: 2728, pr: 2800, headSha: HEAD_B, priorBundle: first.bundle, changedFiles: ['supabase/migrations/x.sql'], integration: facts(HEAD_B) }, adaptersFor(HEAD_A)), /does not carry.*CONTENT_INVALIDATED/)
  // Same head, different identity: the sealing bundle is supplied and the classification refuses it too.
  const sameHead = { ...bundleAt(HEAD_A, otherIdentity) }
  sameHead.metadata = { ...sameHead.metadata, delivery_preflight: { preflight_id: first.record.preflight_id, input_digest: first.record.input_digest } }
  assert.throws(() => assertDeliveryPreflightBeforeReview({ record: first.record, bundle: sameHead, issue: 2728, pr: 2800, headSha: HEAD_A, priorBundle: first.bundle, changedFiles: [], integration: facts(HEAD_A) }, adaptersFor(HEAD_A)), /CONTENT_INVALIDATED/)
})
