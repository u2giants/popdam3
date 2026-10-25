import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRiskAssessment, proveRiskAcceptance, ASSESSMENT_SCHEMA, ASSESSMENT_SCHEMA_V2, provePreMergeBinding, RiskAcceptanceError } from './prove-production-risk-acceptance.mjs'
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

// Pre-merge (v2) blocks: the first review may carry the risk assessment before
// the merge; acceptance re-proves ancestry and per-version blob identity
// against the exact promoted main through the GitHub API.
const v2 = (over = {}) => ({ schema: ASSESSMENT_SCHEMA_V2, head_sha: HEAD, ordered_allowlist: ['20260930185929'], source_pr: 3847, assessed_risks: { material_access_change: text, permanent_data_rewrite_or_loss: text }, ...over })
const v2Expected = { ...expected, headSha: HEAD }
const MIG = 'supabase/migrations/20260930185929_repair.sql', BLOB = '9'.repeat(40)
const okReader = (over = {}) => {
  const responses = {
    [`repos/popcre/shared-db/compare/${HEAD}...${MAIN}`]: { status: 'ahead', behind_by: 0 },
    [`repos/popcre/shared-db/git/trees/${HEAD}?recursive=1`]: { truncated: false, tree: [{ type: 'blob', path: MIG, sha: BLOB }] },
    [`repos/popcre/shared-db/git/trees/${MAIN}?recursive=1`]: { truncated: false, tree: [{ type: 'blob', path: MIG, sha: BLOB }] },
    ...over,
  }
  return path => {
    if (!(path in responses)) throw new RiskAcceptanceError(`the pre-merge binding re-proof could not read ${path}`)
    return responses[path]
  }
}

test('v2 blocks refuse every field mismatch, short assessment, wrong head, allowlist drift and stacking', () => {
  const bad = [
    v2({ head_sha: 'd'.repeat(40) }),                       // wrong head_sha
    v2({ head_sha: MAIN }),                                 // main SHA pasted as head
    { ...v2(), extra: 1 },                                  // extra field
    { schema: ASSESSMENT_SCHEMA_V2, head_sha: HEAD, ordered_allowlist: ['20260930185929'], source_pr: 3847 }, // missing assessed_risks
    v2({ ordered_allowlist: ['20260930185930'] }),          // allowlist mismatch
    v2({ source_pr: 1 }),                                   // wrong source PR
    v2({ assessed_risks: { material_access_change: text, permanent_data_rewrite_or_loss: 'too short' } }), // under 40 chars
    v2({ assessed_risks: { material_access_change: text } }), // missing class
    v2({ schema: 'x' }),                                    // unknown schema
  ]
  for (const data of bad) assert.throws(() => parseRiskAssessment(body(data), v2Expected), RiskAcceptanceError)
  // a v2 block with no head bound to compare against cannot be accepted
  assert.throws(() => parseRiskAssessment(body(v2()), { mainSha: MAIN, allowlist: expected.allowlist, sourcePr: 3847, risks: expected.risks }), /reviewed source PR head/)
  // two blocks in one findings body must refuse, v2 as much as v1
  assert.throws(() => parseRiskAssessment(body(v2()) + body(v2()), v2Expected), /2 production-risk-assessment/)
  assert.throws(() => parseRiskAssessment(body(v2()) + body(block()), v2Expected), /2 production-risk-assessment/)
})

test('v2 acceptance re-proves ancestry and per-version blob identity at the promoted main', () => {
  const findings = body(v2())
  const row = { verdict: 'APPROVE', head_sha: HEAD, ref: 'refs/db-review-verdicts/3458-3847-' + HEAD + '-slot3', sha: 'e'.repeat(40), reviewer: 'grok-4.6', findings_ref: 'u', findings_digest: findingsDigest(findings) }
  const io = { readFindings: () => findings }
  const args = { issue: 3458, pr: 3847, headSha: HEAD, mainSha: MAIN, allowlist: expected.allowlist, risks: expected.risks }
  const reads = []
  const track = reader => path => { reads.push(path); return reader(path) }
  // valid ancestry + identical blobs: accepted, evidence bound to the promoted main
  const proof = proveRiskAcceptance(args, io, () => [row], track(okReader()))
  assert.equal(proof.schema, ASSESSMENT_SCHEMA_V2)
  assert.equal(proof.mainSha, MAIN)
  assert.equal(proof.headSha, HEAD)
  assert.ok(reads.includes(`repos/popcre/shared-db/compare/${HEAD}...${MAIN}`))
  // ancestry not proven: main moved past the reviewed head
  assert.throws(() => proveRiskAcceptance(args, io, () => [row], okReader({ [`repos/popcre/shared-db/compare/${HEAD}...${MAIN}`]: { status: 'behind', behind_by: 1 } })), /not an ancestor/)
  assert.throws(() => proveRiskAcceptance(args, io, () => [row], okReader({ [`repos/popcre/shared-db/compare/${HEAD}...${MAIN}`]: { status: 'diverged', behind_by: 0 } })), /not an ancestor/)
  // migration blob differs between the reviewed head and the promoted main
  assert.throws(() => proveRiskAcceptance(args, io, () => [row], okReader({ [`repos/popcre/shared-db/git/trees/${MAIN}?recursive=1`]: { truncated: false, tree: [{ type: 'blob', path: MIG, sha: '8'.repeat(40) }] } })), /differs between the reviewed head/)
  // migration absent from main entirely
  assert.throws(() => proveRiskAcceptance(args, io, () => [row], okReader({ [`repos/popcre/shared-db/git/trees/${MAIN}?recursive=1`]: { truncated: false, tree: [] } })), /differs between the reviewed head/)
  // truncated tree read refuses instead of guessing
  assert.throws(() => proveRiskAcceptance(args, io, () => [row], okReader({ [`repos/popcre/shared-db/git/trees/${HEAD}?recursive=1`]: { truncated: true, tree: [] } })), /truncated or unreadable/)
  // a block on a non-APPROVE verdict never reaches the re-proof at all
  assert.throws(() => proveRiskAcceptance(args, io, () => [{ ...row, verdict: 'REJECT' }], track(okReader())), /no durable APPROVE/)
  assert.equal(reads.length, 3)
})

test('provePreMergeBinding demands exactly one migration per version at the reviewed head', () => {
  const binding = { headSha: HEAD, mainSha: MAIN, allowlist: expected.allowlist }
  assert.ok(provePreMergeBinding(binding, okReader()) === undefined)
  assert.ok(provePreMergeBinding(binding, okReader({ [`repos/popcre/shared-db/compare/${HEAD}...${MAIN}`]: { status: 'identical', behind_by: 0 } })) === undefined)
  const second = 'supabase/migrations/20260930185929_duplicate.sql'
  assert.throws(() => provePreMergeBinding(binding, okReader({ [`repos/popcre/shared-db/git/trees/${HEAD}?recursive=1`]: { truncated: false, tree: [{ type: 'blob', path: MIG, sha: BLOB }, { type: 'blob', path: second, sha: '7'.repeat(40) }] } })), /exactly one migration/)
  assert.throws(() => provePreMergeBinding(binding, okReader({ [`repos/popcre/shared-db/git/trees/${HEAD}?recursive=1`]: { truncated: false, tree: [] } })), /exactly one migration/)
  // an injected reader's own failure surfaces as-is; the DEFAULT reader is the one that wraps it
  assert.throws(() => provePreMergeBinding(binding, path => { throw new Error('offline') }), /offline/)
  assert.throws(() => provePreMergeBinding(binding, null), RiskAcceptanceError)
})
