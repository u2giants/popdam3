import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { contractLogicalRef, contractStorageRef } from './contract-storage.mjs'
import { readPublishedContractFromGit } from '../agent-work-contract-git-evidence.mjs'
import { deletionArguments, parseRefs, retirementPlan } from '../retire-contract-refs.mjs'
import { contractIo } from '../agent-work-contract.mjs'

const old = 'refs/db-contracts/42/3', archive = 'refs/db-evidence/contracts/42/3', sha = 'a'.repeat(40)
test('historical identities resolve only to preserved storage; other coordination refs are unchanged', () => {
  assert.equal(contractStorageRef(old), archive)
  assert.equal(contractLogicalRef(archive), old)
  for (const ref of ['refs/db-coordination/production', 'refs/db-contracts-extra/42/3', archive]) assert.equal(contractStorageRef(ref), ref)
})
test('historical Git evidence reads the archived ref and unchanged payload without an old-namespace request', () => {
  const calls = [], payload = { work_issue: 42, generation: 3, goal: 'unchanged' }
  const record = readPublishedContractFromGit(old, (_bin, args) => {
    calls.push(args)
    if (args[0] === 'ls-remote') return `${sha}\t${archive}\n`
    if (args[0] === 'fetch') return ''
    return `db-agent-contract\n\n${JSON.stringify(payload)}`
  })
  assert.deepEqual(record, payload)
  assert.equal(calls[0].at(-1), archive)
  assert.equal(calls[1].at(-1), archive)
  assert.ok(!JSON.stringify(calls).includes(old))
})
test('publication and API readers use preserved storage while generation planning keeps logical identities', () => {
  const original = childProcess.execFileSync, calls = []
  childProcess.execFileSync = (bin, args) => {
    assert.equal(bin, 'gh')
    calls.push(args)
    if (args.some(arg => String(arg).includes('matching-refs/'))) return JSON.stringify([{ ref: archive, object: { sha } }])
    return JSON.stringify({ object: { sha } })
  }
  syncBuiltinESMExports()
  try {
    assert.equal(contractIo.readRef(old), sha)
    assert.deepEqual(contractIo.listRefs('refs/db-contracts/42/'), [{ ref: old, sha }])
    contractIo.createRef(old, sha)
    assert.ok(!JSON.stringify(calls).includes('refs/db-contracts'))
    assert.ok(calls[2].includes(`ref=${archive}`))
  } finally { childProcess.execFileSync = original; syncBuiltinESMExports() }
})
test('retirement refuses a conflicting archive or an unrelated coordination ref', () => {
  assert.throws(() => retirementPlan(new Map([[old, sha]]), new Map([[archive, 'b'.repeat(40)]])), /differs/)
  assert.throws(() => retirementPlan(new Map([['refs/db-coordination/production', sha]]), new Map()), /unexpected/)
})
test('deletion requires unchanged originals and matching preservation for every record', () => {
  const live = new Map([[old, sha]]), preserved = new Map([[archive, sha]])
  const plan = retirementPlan(live, preserved)
  assert.deepEqual(deletionArguments(plan, live, preserved), ['push', '--atomic', `--force-with-lease=${old}:${sha}`, 'origin', `:${old}`])
  assert.throws(() => deletionArguments(plan, new Map([[old, 'b'.repeat(40)]]), preserved), /changed/)
  assert.throws(() => deletionArguments(plan, live, new Map()), /changed/)
  assert.throws(() => deletionArguments(plan, new Map([...live, ['refs/db-contracts/43/1', sha]]), preserved), /namespace changed/)
  assert.throws(() => deletionArguments([...plan, ...plan], live, preserved), /namespace changed/)
})
test('malformed or duplicate advertised refs cannot become a deletion plan', () => {
  assert.throws(() => parseRefs(`bad ${old}`), /Malformed/)
  assert.throws(() => parseRefs(`${sha} ${old}\n${sha} ${old}`), /duplicate/)
})
