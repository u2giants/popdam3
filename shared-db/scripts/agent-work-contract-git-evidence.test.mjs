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
const io = (over = {}) => ({
  isAncestor: () => true,
  changedFiles: (from) => from === prBase ? ['scripts/fix.mjs'] : ['.agent/contract.json', '.agent/completion.json'],
  mergeBase: () => base,
  readPublishedContract: () => contract,
  ...over,
})

test('the implementation diff and evidence-only tail are accepted', () => {
  assert.equal(verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io()), true)
})

test('a self-reported file list cannot hide a changed file', () => {
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ changedFiles: (from) => from === prBase ? ['scripts/fix.mjs', 'scripts/hidden.mjs'] : ['.agent/contract.json', '.agent/completion.json'] })), /does not match Git/)
})

test('code changed after the reported head is refused', () => {
  assert.throws(() => verifyGitEvidence({ contract, report, prBaseSha: prBase, prHeadSha: prHead }, io({ changedFiles: (from) => from === prBase ? ['scripts/fix.mjs'] : ['.agent/contract.json', '.agent/completion.json', 'scripts/late.mjs'] })), /only the two/)
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
