import test from 'node:test'
import assert from 'node:assert/strict'
import { main } from './report-observer-allowance.mjs'

test('receipt names each allowance with counts and never prints a token', () => {
  const seen = []
  const run = (args, opts) => {
    seen.push({ args, attempts: opts.attempts, hasExecutor: typeof opts.executor === 'function' })
    return { resources: { core: { used: 7, limit: 5000 } } }
  }
  const lines = []
  const code = main({
    env: { OPERATOR_TOKEN: 'op-secret-value', READ_TOKEN: 'rd-secret-value' },
    log: (line) => lines.push(line),
    run,
  })
  assert.equal(code, 0)
  assert.deepEqual(lines, ['OPERATOR_TOKEN used=7 limit=5000', 'READ_TOKEN used=7 limit=5000'])
  assert.ok(lines.every((line) => !line.includes('secret')))
  assert.deepEqual(seen.map((call) => call.args), [['api', 'rate_limit'], ['api', 'rate_limit']])
  assert.ok(seen.every((call) => call.attempts === 1 && call.hasExecutor))
})

test('a missing or refused token prints unavailable and the receipt still exits 0', () => {
  const run = () => { throw Error('GitHub command failed: HTTP 401') }
  const lines = []
  const code = main({ env: { READ_TOKEN: 'rd-secret-value' }, log: (line) => lines.push(line), run })
  assert.equal(code, 0)
  assert.deepEqual(lines, ['OPERATOR_TOKEN unavailable', 'READ_TOKEN unavailable'])
  assert.ok(lines.every((line) => !line.includes('secret')))
})

test('a malformed body prints unavailable rather than a broken receipt line', () => {
  const run = () => ({})
  const lines = []
  const code = main({ env: { OPERATOR_TOKEN: 'op', READ_TOKEN: 'rd' }, log: (line) => lines.push(line), run })
  assert.equal(code, 0)
  assert.deepEqual(lines, ['OPERATOR_TOKEN unavailable', 'READ_TOKEN unavailable'])
})
