import assert from 'node:assert/strict'
import test from 'node:test'

import { requireCurrentMain, StaleWorktree } from './check-worktree-freshness.mjs'

const SHA = 'a'.repeat(40)

function runner({ head = SHA, main = SHA, fetchError = null } = {}) {
  const calls = []
  const run = (_command, args) => {
    calls.push(args)
    if (args.includes('fetch')) {
      if (fetchError) throw fetchError
      return ''
    }
    if (args.at(-1) === 'HEAD') return `${head}\n`
    if (args.at(-1) === 'refs/remotes/origin/main') return `${main}\n`
    throw new Error(`unexpected git call: ${args.join(' ')}`)
  }
  return { calls, run }
}

test('accepts only when HEAD equals freshly fetched origin/main', () => {
  const fixture = runner()
  assert.deepEqual(requireCurrentMain({ root: 'C:/repo', run: fixture.run }), { head: SHA, main: SHA })
  assert.ok(fixture.calls[0].includes('+refs/heads/main:refs/remotes/origin/main'))
})

test('refuses a stale working tree and names both exact commits', () => {
  const fixture = runner({ head: 'b'.repeat(40) })
  assert.throws(
    () => requireCurrentMain({ root: 'C:/repo', run: fixture.run }),
    (error) => error instanceof StaleWorktree && error.message.includes('b'.repeat(40)) && error.message.includes(SHA),
  )
})

test('refuses when live origin/main cannot be refreshed', () => {
  const fixture = runner({ fetchError: new Error('network unavailable') })
  assert.throws(() => requireCurrentMain({ root: 'C:/repo', run: fixture.run }), /could not refresh live origin\/main/)
})

test('refuses malformed revision output instead of guessing', () => {
  const fixture = runner({ head: 'main', main: 'main' })
  assert.throws(() => requireCurrentMain({ root: 'C:/repo', run: fixture.run }), /malformed commit SHA/)
})
