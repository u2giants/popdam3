import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkPolicy, checkRouting, expectedPolicy } from './check-current-workflow-policy.mjs'

const source = readFileSync(new URL('./check-exact-head-approval.mjs', import.meta.url), 'utf8')
const document = readFileSync(new URL('../docs/agents/current-workflow.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const documentsOnly = (paths) => paths.every((path) => path.startsWith('plan_'))
const expected = expectedPolicy({ activation: { active: true }, approvalSource: source, documentsOnly })

test('current procedure records the current review counts and owner rulings', () => assert.equal(checkPolicy(document, expected), true))
test('current_policy_matrix_mismatch_refuses', () => {
  for (const [before, after] of [['| authors | unlimited |', '| authors | 8 |'], ['| reviewer-concurrency | unlimited |', '| reviewer-concurrency | one-per-provider |'], ['| migration-reviews | 2 |', '| migration-reviews | 1 |'], ['| automatic-production-policy | active |', '| automatic-production-policy | inactive |'], ['| standalone-plans | documentation |', '| standalone-plans | guarded |']]) {
    assert.throws(() => checkPolicy(document.replace(before, after), expected), /matrix mismatch/)
  }
})
test('actual activation and classifier disagreement cannot be hidden by documentation', () => {
  assert.throws(() => checkPolicy(document, expectedPolicy({ activation: { active: false }, approvalSource: source, documentsOnly })), /automatic-production-policy/)
  assert.throws(() => checkPolicy(document, expectedPolicy({ activation: { active: true }, approvalSource: source, documentsOnly: () => false })), /standalone-plans/)
})
test('weakened instruction classification is refused', () => assert.throws(() => checkPolicy(document, expectedPolicy({ activation: { active: true }, approvalSource: source, documentsOnly: () => true })), /agent-instructions/))
test('matrix rows cannot be duplicated, omitted or expanded silently', () => {
  assert.throws(() => checkPolicy(document + '\n## Policy matrix\n', expected), /one explicit/)
  assert.throws(() => checkPolicy(document.replace('| authors | unlimited | Owner ruling 2026-09-16 |', ''), expected), /authors/)
  assert.throws(() => checkPolicy(document.replace('| authors | unlimited | Owner ruling 2026-09-16 |', '| authors | unlimited | Owner ruling 2026-09-16 |\n| authors | unlimited | Owner ruling 2026-09-16 |'), expected), /duplicated/)
  assert.throws(() => checkPolicy(document.replace('| authors | unlimited | Owner ruling 2026-09-16 |', '| invented | yes | none |'), expected), /Unrecognized/)
})
test('unknown authority or omitted lock refuses instead of adopting a policy', () => {
  assert.throws(() => expectedPolicy({ activation: {}, approvalSource: source }), /activation authority/)
  assert.throws(() => expectedPolicy({ activation: { active: true }, approvalSource: 'new gate implementation' }), /derive review counts/)
  assert.throws(() => expectedPolicy({ activation: { active: true }, approvalSource: source, exclusiveRefs: { preview: 'x', merge: 'y' } }), /lane authority/)
})
test('current procedure is discoverable through both active instruction routers', () => {
  const routes = { agents: '- [current-workflow.md](docs/agents/current-workflow.md)', coordination: '- [current-workflow.md](current-workflow.md)' }
  assert.equal(checkRouting(routes), true)
  assert.throws(() => checkRouting({ ...routes, agents: '' }), /AGENTS.md/)
  assert.throws(() => checkRouting({ ...routes, coordination: 'historical pointer only' }), /section-4/)
  assert.throws(() => checkRouting({ ...routes, agents: `<!-- ${routes.agents} -->` }), /routing link/)
})
