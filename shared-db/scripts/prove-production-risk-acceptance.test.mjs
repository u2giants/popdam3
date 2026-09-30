import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRiskAssessment, proveRiskAcceptance, ASSESSMENT_SCHEMA } from './prove-production-risk-acceptance.mjs'
import { findingsDigest } from './lib/review-verdict-artifact.mjs'

const MAIN = 'b'.repeat(40), HEAD = 'c'.repeat(40)
const expected = { mainSha: MAIN, allowlist: ['20260930185929'], sourcePr: 3847, risks: ['material_access_change', 'permanent_data_rewrite_or_loss'] }
const text = 'Only service_role can execute it; the DML inside the body runs only when called.'
const block = (over = {}) => ({ schema: ASSESSMENT_SCHEMA, main_sha: MAIN, ordered_allowlist: ['20260930185929'], source_pr: 3847, assessed_risks: { material_access_change: text, permanent_data_rewrite_or_loss: text }, ...over })
const body = (data) => `findings\n\n\`\`\`production-risk-assessment\n${JSON.stringify(data)}\n\`\`\`\n\nVERDICT: APPROVE ${HEAD}`

test('an exact, complete reviewer assessment is accepted', () => {
  assert.equal(parseRiskAssessment(body(block()), expected).main_sha, MAIN)
})

test('every mismatch or omission refuses', () => {
  const bad = [
    block({ main_sha: 'd'.repeat(40) }), block({ ordered_allowlist: ['20260930185930'] }), block({ source_pr: 1 }),
    block({ schema: 'x' }), block({ assessed_risks: { material_access_change: text } }),
    block({ assessed_risks: { material_access_change: text, permanent_data_rewrite_or_loss: 'ok' } }),
    block({ assessed_risks: { material_access_change: text, permanent_data_rewrite_or_loss: text, expected_downtime: text } }),
    { ...block(), extra: 1 },
  ]
  for (const data of bad) assert.throws(() => parseRiskAssessment(body(data), expected))
  assert.throws(() => parseRiskAssessment('no block', expected), /0 production-risk-assessment/)
  assert.throws(() => parseRiskAssessment(body(block()) + body(block()), expected), /2 production-risk-assessment/)
  assert.throws(() => parseRiskAssessment(body(block()), { ...expected, risks: ['recovery_unproven'] }), /cannot be accepted/)
})

test('acceptance needs the durable exact-head APPROVE and digest-bound findings', () => {
  const findings = body(block())
  const row = { verdict: 'APPROVE', head_sha: HEAD, ref: 'refs/db-review-verdicts/3458-3847-' + HEAD + '-slot3', sha: 'e'.repeat(40), reviewer: 'grok-4.6', findings_ref: 'u', findings_digest: findingsDigest(findings) }
  const io = { readFindings: () => findings }
  const args = { issue: 3458, pr: 3847, headSha: HEAD, mainSha: MAIN, allowlist: expected.allowlist, risks: expected.risks }
  assert.equal(proveRiskAcceptance(args, io, () => [row]).reviewer, 'grok-4.6')
  assert.throws(() => proveRiskAcceptance(args, io, () => { throw new Error('the exact head carries a durable reviewer refusal') }), /no durable allocator-assigned/)
  assert.throws(() => proveRiskAcceptance(args, { readFindings: () => findings + ' edited' }, () => [row]), /digest changed/)
  assert.throws(() => proveRiskAcceptance(args, io, () => [{ ...row, head_sha: 'f'.repeat(40) }]), /no durable APPROVE/)
  assert.throws(() => proveRiskAcceptance(args, io, () => [{ ...row, verdict: 'REVISE' }]), /no durable APPROVE/)
})
