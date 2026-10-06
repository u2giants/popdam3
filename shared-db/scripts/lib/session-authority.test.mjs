import assert from 'node:assert/strict'
import test from 'node:test'
import { readSessionId, resolveSessionAuthority, sessionAuthorityRefusal, SESSION_ID_ENV } from './session-authority.mjs'

const env = (value) => (value === undefined ? {} : { [SESSION_ID_ENV]: value })

test('#3874 an undeclared or blank session is never live', () => {
  for (const value of [undefined, '', '   ']) {
    const authority = resolveSessionAuthority({ env: env(value) })
    assert.equal(authority.live, false)
    assert.equal(authority.state, 'none')
    assert.notEqual(authority.calling_task, authority.task)
  }
})

test('#3874 a malformed session id is refused, not trimmed into validity', () => {
  for (const value of ['a', 'bad id with spaces', 'x;rm -rf /', '-leading-dash']) {
    const authority = resolveSessionAuthority({ env: env(value) })
    assert.equal(authority.live, false)
    assert.equal(authority.state, 'invalid')
  }
})

test('#3874 a declared session with no named claim is live and matches itself', () => {
  const authority = resolveSessionAuthority({ env: env('claude-chat-1234') })
  assert.equal(authority.live, true)
  assert.equal(authority.task, 'claude-chat-1234')
  assert.equal(authority.calling_task, authority.task)
})

test('#3874 a named claim must be owned by the declared session', () => {
  const ok = resolveSessionAuthority({ env: env('owner-a'), claimOwner: 'owner-a' })
  assert.equal(ok.live, true)
  const other = resolveSessionAuthority({ env: env('owner-a'), claimOwner: 'owner-b' })
  assert.equal(other.live, false)
  assert.equal(other.state, 'claim-owner-mismatch')
  assert.notEqual(other.task, other.calling_task)
  for (const owner of [null, '', '  ']) {
    const unreadable = resolveSessionAuthority({ env: env('owner-a'), claimOwner: owner })
    assert.equal(unreadable.live, false)
    assert.equal(unreadable.state, 'unsafe')
  }
})

test('#3874 the refusal names the variable and the reason', () => {
  const message = sessionAuthorityRefusal(resolveSessionAuthority({ env: {} }))
  assert.match(message, /SHARED_DB_SESSION_ID/)
  assert.match(message, /not set/)
  assert.equal(readSessionId({}), null)
})
