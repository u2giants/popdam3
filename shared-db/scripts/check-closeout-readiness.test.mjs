import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evaluateCloseoutReadiness, main } from './check-closeout-readiness.mjs'
import { jobBlockByName } from './lib/workflow-jobs.mjs'

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
  // The checkout is the protected base for every event: the PR base, the merge
  // group's base (current main), or -- on push -- the pushed main itself,
  // which already passed the merge queue (#4960).
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.merge_group\.base_sha \|\| github\.sha \}\}/)
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
  assert.match(workflow, /Not run: the trusted policy classified this change as prose-only/)
  // #4960: merge_group and push are decided too -- the queued pull request is
  // resolved and asked the same trusted policy, and a push proves its own
  // before..sha range with the trusted inventory classifier from the trusted
  // pushed main tree. A manual replay still fails closed to the full suite
  // (no pull request, no push range), and no step may bypass the decision by
  // event type any more.
  assert.match(workflow, /merge-queue-contract\.mjs --resolve-queue-pr/)
  assert.match(workflow, /check-documents-ci-route\.mjs "\$BEFORE_SHA" "\$HEAD_SHA"/)
  assert.doesNotMatch(workflow, /github\.event_name != 'pull_request' \|\|/)
})

test('every documents-only decision that can waive a safeguard uses protected policy', () => {
  const agent = jobBlockByName(readFileSync(fileURLToPath(new URL('../.github/workflows/pr-guards.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n'), 'Agent work contract')
  assert.ok(agent, 'no job emits Agent work contract')
  const merge = readFileSync(fileURLToPath(new URL('../.github/workflows/guarded-migration-merge.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  assert.match(agent, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| steps\.queue\.outputs\.pr_base_sha \}\}/)
  // The exemption is decided on merge_group too, after the queued PR is resolved.
  assert.match(agent, /id: documents_only\n        if: github\.event_name == 'merge_group' \|\| github\.event_name == 'workflow_dispatch'/)
  assert.ok(agent.indexOf('id: queue') < agent.indexOf('id: documents_only'))
  assert.match(agent, /node trusted-policy\/scripts\/check-documents-only-pull-request\.mjs/)
  assert.match(agent, /steps\.documents_only\.outputs\.value/)
  assert.match(merge, /ref: main\n          path: trusted-policy/)
  // Owner 2026-10-29: review is advisory; no pass calls the approval gate.
  assert.match(merge,/for attempt in 1 2 3 4 5; do\n\s+prove_retained_all14/)
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
