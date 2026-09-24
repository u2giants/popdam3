import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evaluateCloseoutReadiness, main } from './check-closeout-readiness.mjs'

const SHA = 'a'.repeat(40)
const payload = (rows) => JSON.stringify(rows)

test('a pure handoff makes only the ephemeral database context inapplicable', () => {
  const result = evaluateCloseoutReadiness({
    repository: 'fixture-owner/fixture-repo', pullRequest: '2596', policySha: SHA,
    filesPayload: payload([{ filename: 'HANDOFF.d/next.md' }, { filename: 'docs/closeout.md' }]),
  })
  assert.equal(result.documents_only, true)
  assert.equal(result.gates.database_contract_tests, 'inapplicable')
  assert.equal(result.gates.handoff_contract, 'applicable')
  assert.equal(result.gates.guarded_merge, 'applicable')
})

test('AGENTS/skill rulebook, workflow, code, and a rename from SQL retain the full path', () => {
  for (const row of [
    { filename: 'AGENTS.md' },
    { filename: '.claude/skills/x/SKILL.md' },
    { filename: '.github/workflows/database-contract-tests.yml' },
    { filename: 'scripts/check-closeout-readiness.mjs' },
    { filename: 'docs/new.md', previous_filename: 'supabase/migrations/20260908000000_x.sql' },
  ]) {
    const result = evaluateCloseoutReadiness({ repository: 'fixture-owner/fixture-repo', pullRequest: '1', policySha: SHA, filesPayload: payload([row]) })
    assert.equal(result.gates.database_contract_tests, 'applicable', JSON.stringify(row))
  }
})

test('unreadable file evidence retains the full path', () => {
  const result = evaluateCloseoutReadiness({ repository: 'fixture-owner/fixture-repo', pullRequest: '1', policySha: SHA, filesPayload: 'not json' })
  assert.equal(result.documents_only, false)
  assert.equal(result.gates.database_contract_tests, 'applicable')
})

test('the command emits machine-readable result and refuses malformed identity', () => {
  const out = []
  assert.equal(main(['fixture-owner/fixture-repo', '1', SHA], { read: () => payload([{ filename: 'HANDOFF.d/a.md' }]), out: (text) => out.push(text), err: () => {} }), 0)
  assert.equal(JSON.parse(out.join('')).gates.database_contract_tests, 'inapplicable')
  assert.equal(main(['fixture-owner/fixture-repo', 'nope', SHA], { read: () => '[]', out: () => {}, err: () => {} }), 2)
})

test('the contract workflow takes the classification only from protected base policy', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/database-contract-tests.yml', import.meta.url)), 'utf8')
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/)
  assert.match(workflow, /pull-requests: read/)
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/)
  // Only a positive inapplicable answer skips; an undecidable read runs the full test.
  assert.match(workflow, /if \[ "\$status" -eq 0 \] && \[ "\$applicability" = inapplicable \]/)
  assert.doesNotMatch(workflow, /test "\$status" -le 1/)
  assert.match(workflow, /POLICY_SHA="\$\(git rev-parse HEAD\)"/)
  assert.match(workflow, /if \[ -f scripts\/check-closeout-readiness\.mjs \]/)
  assert.match(workflow, /check-documents-only-pull-request\.mjs "\$GITHUB_REPOSITORY" "\$PR_NUMBER"/)
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/)
  assert.match(workflow, /Refuse an unreadable applicability decision/)
  assert.match(workflow, /needs\.classify\.result != 'success'/)
  assert.match(workflow, /Not run: the trusted base policy classified this pull request as prose-only/)
  // Pushes and manual replays have no pull-request object, so they must retain
  // the complete database test rather than becoming accidentally inapplicable.
  assert.match(workflow, /github\.event_name != 'pull_request' \|\| needs\.classify\.outputs\.database_contract_tests == 'applicable'/)
})

test('every documents-only decision that can waive a safeguard uses protected policy', () => {
  const agent = readFileSync(fileURLToPath(new URL('../.github/workflows/agent-work-contract.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  const merge = readFileSync(fileURLToPath(new URL('../.github/workflows/guarded-migration-merge.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  assert.match(agent, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| steps\.queue\.outputs\.pr_base_sha \}\}/)
  // The exemption is decided on merge_group too, after the queued PR is resolved.
  assert.match(agent, /id: documents_only\n        if: github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/)
  assert.ok(agent.indexOf('id: queue') < agent.indexOf('id: documents_only'))
  assert.match(agent, /node trusted-policy\/scripts\/check-documents-only-pull-request\.mjs/)
  assert.match(agent, /steps\.documents_only\.outputs\.value/)
  assert.match(merge, /ref: main\n          path: trusted-policy/)
  // Both the first pass and the lock-held re-proof run protected main's copy.
  assert.equal(merge.match(/trusted-policy\/scripts\/check-exact-head-approval\.mjs/g).length, 2)
  assert.doesNotMatch(merge, /^\s*node scripts\/check-exact-head-approval\.mjs/m)
})

test('a failed file-list read refuses with exit 2 and never reports inapplicable', () => {
  const out = []
  assert.equal(main(['fixture-owner/fixture-repo', '1', SHA], { read: () => { throw new Error('HTTP 403') }, out: (t) => out.push(t), err: () => {} }), 2)
  assert.equal(out.length, 0)
})

test('an empty file list is never documents-only', () => {
  const result = evaluateCloseoutReadiness({ repository: 'fixture-owner/fixture-repo', pullRequest: '1', policySha: SHA, filesPayload: '[]' })
  assert.equal(result.gates.database_contract_tests, 'applicable')
})
