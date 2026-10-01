import test from 'node:test'
import assert from 'node:assert/strict'
import { authorityReadEnv } from './authority-token-read.mjs'

test('authorityReadEnv swaps GH_TOKEN only when an elevated token is present', () => {
  assert.equal(authorityReadEnv({ GH_TOKEN: 'workflow-token' }), null)
  const scoped = authorityReadEnv({ GH_TOKEN: 'workflow-token', AUTHORITY_TOKEN: '  classic-pat  ', OTHER: 'kept' })
  assert.equal(scoped.GH_TOKEN, 'classic-pat')
  assert.equal(scoped.OTHER, 'kept')
  assert.notEqual(scoped, process.env)
})

test('authorityReadEnv never mutates the input environment', () => {
  const env = { GH_TOKEN: 'workflow-token', AUTHORITY_TOKEN: 'classic-pat' }
  authorityReadEnv(env)
  assert.equal(env.GH_TOKEN, 'workflow-token')
})
