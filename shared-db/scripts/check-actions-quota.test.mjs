import test from 'node:test'
import assert from 'node:assert/strict'
import { checkQuota, minRemaining, readQuota } from './check-actions-quota.mjs'

const NOW = Date.UTC(2026, 8, 11, 16, 0, 0)
const body = (remaining, resetInSeconds) => JSON.stringify({ resources: { core: { limit: 5000, remaining, reset: Math.floor(NOW / 1000) + resetInSeconds } } })
const quiet = () => {}
const OPTED = { GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '900' }

test('enough quota continues without waiting', () => {
  const result = checkQuota({ read: () => body(4000, 600), wait: () => assert.fail('waited'), now: () => NOW, env: {}, log: quiet })
  assert.equal(result.ok, true)
})

test('low quota with a near reset waits once, then continues', () => {
  const answers = [body(12, 300), body(5000, 3600)]
  const waits = []
  const result = checkQuota({ read: () => answers.shift(), wait: (ms) => waits.push(ms), now: () => NOW, env: OPTED, log: quiet })
  assert.equal(result.ok, true)
  assert.deepEqual(waits, [301000])
})

test('a zero, unset, or shorter cap never waits: a lock holder fails fast', () => {
  for (const env of [{}, { GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '0' }, { GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '60' }]) {
    const result = checkQuota({ read: () => body(12, 300), wait: () => assert.fail('waited under cap ' + JSON.stringify(env)), now: () => NOW, env, log: quiet })
    assert.equal(result.ok, false)
    assert.match(result.message, /^installation quota low: 12/)
  }
})

test('low quota with a far reset fails with a plain installation-quota message', () => {
  const result = checkQuota({ read: () => body(12, 40 * 60), wait: () => assert.fail('waited past 15 minutes'), now: () => NOW, env: OPTED, log: quiet })
  assert.equal(result.ok, false)
  assert.match(result.message, /^installation quota low: 12 GitHub API requests left/)
})

test('still low after the wait, or unreadable, fails closed', () => {
  const stillLow = checkQuota({ read: () => body(3, 60), wait: () => {}, now: () => NOW, env: OPTED, log: quiet })
  assert.equal(stillLow.ok, false)
  assert.match(stillLow.message, /installation quota low/)
  const unreadable = checkQuota({ read: () => { throw new Error('HTTP 502') }, now: () => NOW, env: {}, log: quiet })
  assert.equal(unreadable.ok, false)
  assert.match(unreadable.message, /installation quota low or unknown/)
})

test('the floor is configurable and defaults to 200', () => {
  assert.equal(minRemaining({}), 200)
  assert.equal(minRemaining({ ACTIONS_QUOTA_MIN_REMAINING: '500' }), 500)
  assert.equal(minRemaining({ ACTIONS_QUOTA_MIN_REMAINING: 'lots' }), 200)
})

const headered = (remaining, resetInSeconds) => `HTTP/2.0 200 OK\nX-Ratelimit-Limit: 1000\nX-Ratelimit-Remaining: ${remaining}\nX-Ratelimit-Reset: ${Math.floor(NOW / 1000) + resetInSeconds}\nX-Ratelimit-Resource: core\n\n{"full_name":"popcre/shared-db"}`

test('the charged bucket is read from a real response headers, not the rate_limit body (#3699)', () => {
  const q = readQuota(() => headered(0, 120))
  assert.equal(q.readable, true)
  assert.equal(q.remaining, 0)
  const result = checkQuota({ read: () => headered(3, 40 * 60), wait: () => assert.fail('waited'), now: () => NOW, env: OPTED, log: quiet })
  assert.equal(result.ok, false)
  assert.match(result.message, /^installation quota low: 3 GitHub API requests left/)
})

test('a probe refused for rate limit fails closed with a plain message, never continues (#3699)', () => {
  const err = Object.assign(new Error('gh failed'), { stderr: 'gh: API rate limit exceeded for installation. (HTTP 403)' })
  const result = checkQuota({ read: () => { throw err }, wait: () => assert.fail('waited'), now: () => NOW, env: OPTED, log: quiet })
  assert.equal(result.ok, false)
  assert.match(result.message, /^installation quota low: the GitHub API refused the quota probe itself/)
})

test('a refused probe waits for the reset its own 403 headers state, then continues (#3743)', () => {
  const err = Object.assign(new Error('gh failed'), { stderr: 'gh: API rate limit exceeded for installation. (HTTP 403)', stdout: headered(0, 300).replace('200 OK', '403 Forbidden') })
  const answers = [() => { throw err }, () => headered(900, 3600)]
  const waits = []
  const result = checkQuota({ read: () => answers.shift()(), wait: (ms) => waits.push(ms), now: () => NOW, env: OPTED, log: quiet })
  assert.equal(result.ok, true)
  assert.deepEqual(waits, [301000])
})
