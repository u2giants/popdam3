import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptableEvidencePairs, EvidencePathError, evidencePaths, isEvidencePath, LEGACY_PAIR, resolveEvidencePair } from './agent-evidence-paths.mjs'

test('#2708: the pair is keyed by work issue and generation, mirroring the contract ref', () => {
  assert.deepEqual(evidencePaths(2708, 1), {
    key: '2708/1',
    directory: '.agent/work/2708/1',
    contract: '.agent/work/2708/1/contract.json',
    completion: '.agent/work/2708/1/completion.json',
  })
  assert.equal(evidencePaths(2845).contract, '.agent/work/2845/1/contract.json')
  assert.notEqual(evidencePaths(2708, 1).directory, evidencePaths(2708, 2).directory)
})

test('#2708: two pull requests on different issues share no evidence path at all', () => {
  const a = evidencePaths(2640, 1)
  const b = evidencePaths(2695, 3)
  assert.deepEqual([a.contract, a.completion].filter((path) => [b.contract, b.completion].includes(path)), [])
})

test('#2708: a path key must be a positive integer', () => {
  for (const bad of [0, -1, '1.5', 'main', null, undefined]) assert.throws(() => evidencePaths(bad, 1), EvidencePathError)
  assert.throws(() => evidencePaths(42, 0), EvidencePathError)
})

test('#2708: evidence paths are recognised, and lookalikes are not', () => {
  assert.ok(isEvidencePath('.agent/contract.json'))
  assert.ok(isEvidencePath('.agent/work/42/1/completion.json'))
  assert.equal(isEvidencePath('.agent/work/42/1/notes.json'), false)
  assert.equal(isEvidencePath('.agent/work/42/contract.json'), false)
  assert.equal(isEvidencePath('sub/.agent/contract.json'), false)
  assert.equal(isEvidencePath('scripts/fix.mjs'), false)
})

test('#2708: resolution names the exact pair, or fails closed on more than one', () => {
  assert.deepEqual(resolveEvidencePair([]), { state: 'inherited', contract: null, completion: null, key: null })
  assert.deepEqual(resolveEvidencePair([...LEGACY_PAIR]), { state: 'current', contract: '.agent/contract.json', completion: '.agent/completion.json', key: 'legacy' })
  assert.equal(resolveEvidencePair(['.agent/work/42/1/contract.json', '.agent/work/42/1/completion.json', 'scripts/fix.mjs']).state, 'current')
  assert.equal(resolveEvidencePair(['.agent/work/42/1/completion.json']).state, 'partial')
  const conflicted = resolveEvidencePair(['.agent/contract.json', '.agent/completion.json', '.agent/work/42/1/contract.json', '.agent/work/42/1/completion.json'])
  assert.equal(conflicted.state, 'conflicted')
  assert.equal(conflicted.contract, null)
})

test('#2708: the legacy pair stays acceptable so open pull requests need not all rewrite at once', () => {
  const pairs = acceptableEvidencePairs({ work_issue: 42, generation: 2 })
  assert.deepEqual(pairs[0], ['.agent/work/42/2/completion.json', '.agent/work/42/2/contract.json'])
  assert.deepEqual(pairs.at(-1), [...LEGACY_PAIR])
  assert.deepEqual(acceptableEvidencePairs({}), [[...LEGACY_PAIR]])
})
