import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyEvidencePair, main, prChangedFiles, verifyGitEvidence } from './agent-work-contract-git-evidence.mjs'

const base = 'a'.repeat(40)
const prBase = 'd'.repeat(40)
const implementation = 'b'.repeat(40)
const prHead = 'c'.repeat(40)
const contract = {
  schema_version: 1, work_issue: 42, generation: 1, work_type: 'repo-maintenance', route: 'repo-maintenance',
  goal: 'fix the guard', base_sha: base, dispatcher: 'repo-session', worker: 'codex', branch: 'codex/fix', worktree: 'worktrees/fix',
  allowed_paths: ['scripts/**'], file_writes: ['scripts/fix.mjs'], db_reads: [], db_writes: [], prohibited_actions: ['no database writes'],
  required_checks: ['node --test'], assumptions: [], stop_conditions: ['stop on scope change'],
}
const report = { head_sha: implementation, files_changed: ['scripts/fix.mjs'], contract_ref: 'refs/db-contracts/42/1' }
// The merge base and the PR base agree on an un-refreshed branch, which is the
// state every legacy pull request is in.
const io = (over = {}) => ({
  isAncestor: () => true,
  changedFiles: (from) => from === base ? ['scripts/fix.mjs'] : ['.agent/contract.json', '.agent/completion.json'],
  mergeBase: () => base,
  readPublishedContract: () => contract,
  ...over,
})
const keyedPair = ['.agent/work/42/1/completion.json', '.agent/work/42/1/contract.json']

test('the implementation diff and evidence-only tail are accepted', () => {
  assert.equal(verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io()), true)
})

test('a self-reported file list cannot hide a changed file', () => {
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ changedFiles: (from) => from === base ? ['scripts/fix.mjs', 'scripts/hidden.mjs'] : ['.agent/contract.json', '.agent/completion.json'] })), /does not match Git/)
})

test('code changed after the reported head is refused', () => {
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ changedFiles: (from) => from === base ? ['scripts/fix.mjs'] : ['.agent/contract.json', '.agent/completion.json', 'scripts/late.mjs'] })), /only this pull request's own two evidence files/)
})

test('both ancestry links and full SHAs are required', () => {
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ isAncestor: () => false })), /not an ancestor/)
  assert.throws(() => verifyGitEvidence({ contract: { ...contract, base_sha: 'abc1234' }, report, prBaseSha: prBase, prHeadSha: prHead }, io()), /40-character/)
})

test('the checked-in contract must match its exact immutable published ref', () => {
  assert.throws(() => verifyGitEvidence({ contract, report: { ...report, contract_ref: 'refs/db-contracts/42/2' }, prBaseSha: prBase, prHeadSha: prHead }, io()), /exact immutable ref/)
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ readPublishedContract: () => ({ ...contract, goal: 'wider after the fact' }) })), /does not match/)
})

test('evidence pair classification distinguishes inherited, current, and half-written evidence', () => {
  assert.equal(classifyEvidencePair(['docs/change.md']), 'inherited')
  assert.equal(classifyEvidencePair(['.agent/contract.json', '.agent/completion.json', 'docs/change.md']), 'current')
  assert.equal(classifyEvidencePair(['.agent/contract.json', 'docs/change.md']), 'partial')
  assert.equal(classifyEvidencePair(['.agent/completion.json']), 'partial')
})

test('classification CLI compares the exact pull request base and head', () => {
  const output = []
  const calls = []
  const originalLog = console.log
  console.log = value => output.push(value)
  try {
    assert.equal(main(['--classify-evidence-pair', '--pr-base-sha', prBase, '--pr-head-sha', prHead], io({
      mergeBase: (actualBase, actualHead) => { calls.push(['merge-base', actualBase, actualHead]); return base },
      changedFiles: (actualBase, actualHead) => { calls.push(['diff', actualBase, actualHead]); return ['.agent/contract.json', '.agent/completion.json'] },
    })), 0)
  } finally {
    console.log = originalLog
  }
  assert.deepEqual(output, ['current'])
  assert.deepEqual(calls, [['merge-base', prBase, prHead], ['diff', base, prHead]])
})

test('a branch behind main is classified from its merge base, not as deleting evidence added later on main', () => {
  const files = prChangedFiles(prBase, prHead, {
    mergeBase: () => base,
    changedFiles: (from, to) => {
      assert.equal(from, base)
      assert.equal(to, prHead)
      return ['docs/old-branch-change.md']
    },
  })
  assert.equal(classifyEvidencePair(files), 'inherited')
})

test('a files_changed mismatch says which list is Git and exactly what to add or remove (#498)', () => {
  assert.throws(
    () => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ changedFiles: (from) => from === base ? [...report.files_changed, 'scripts/hidden.mjs'] : ['.agent/contract.json', '.agent/completion.json'] })),
    /Git changed \[.*scripts\/hidden\.mjs.*\] but \.agent\/completion\.json files_changed lists \[.*\]; add to the report \[scripts\/hidden\.mjs\], remove from the report \[\]/,
  )
})

// --- #2708: disjoint, generation-keyed evidence paths -------------------------

test('#2708: a pull request may carry its own generation-keyed pair instead of the shared one', () => {
  assert.equal(verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead },
    io({ changedFiles: (from) => from === base ? ['scripts/fix.mjs'] : keyedPair })), true)
})

test('#2708: a pull request may not carry another pull request keyed evidence pair', () => {
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead },
    io({ changedFiles: (from) => from === base ? ['scripts/fix.mjs'] : ['.agent/work/99/1/completion.json', '.agent/work/99/1/contract.json'] })),
    /only this pull request's own two evidence files.*\.agent\/work\/42\/1\/completion\.json/s)
})

test('#2708: keyed pairs classify exactly as the legacy pair does, and two of them fail closed', () => {
  assert.equal(classifyEvidencePair([...keyedPair, 'scripts/fix.mjs']), 'current')
  assert.equal(classifyEvidencePair(['.agent/work/42/1/contract.json']), 'partial')
  assert.equal(classifyEvidencePair(['.agent/work/42/2/contract.json', '.agent/work/42/2/completion.json']), 'current')
  assert.equal(classifyEvidencePair([...keyedPair, '.agent/work/99/1/contract.json', '.agent/work/99/1/completion.json']), 'conflicted')
  // Two different pull requests' evidence never lands on the same path, which is
  // the whole point: these two lists are disjoint.
  assert.deepEqual(keyedPair.filter((path) => ['.agent/work/99/1/completion.json', '.agent/work/99/1/contract.json'].includes(path)), [])
})

// --- #2845: evidence rebound to the head under review -------------------------

test('#2845: a pair anchored to a superseded base is refused', () => {
  const movedBase = 'e'.repeat(40)
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead },
    io({ mergeBase: () => movedBase, changedFiles: (from) => from === movedBase ? ['scripts/fix.mjs'] : ['.agent/contract.json', '.agent/completion.json'] })),
    /anchored to a superseded base: it records a{40} but this pull request's merge base with main is e{40}/)
})

test('#2845: rebinding the completion report to the refreshed base and head passes', () => {
  const movedBase = 'e'.repeat(40)
  const rebound = { ...report, base_sha: movedBase }
  assert.equal(verifyGitEvidence({ contract, report: rebound, prBaseSha: prBase, prHeadSha: prHead },
    io({ mergeBase: () => movedBase, changedFiles: (from) => from === movedBase ? ['scripts/fix.mjs'] : ['.agent/contract.json', '.agent/completion.json'] })), true)
})

test('#2845: a rebound base is still held to the exact-SHA and ancestry rules', () => {
  assert.throws(() => verifyGitEvidence({ contract, report: { ...report, base_sha: 'e1e2e3' }, prBaseSha: prBase, prHeadSha: prHead }, io()), /40-character base SHA/)
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ mergeBase: () => 'not-a-sha' })), /could not resolve an exact merge base/)
})
