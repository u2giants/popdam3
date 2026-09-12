// Contract tests for the one shared GitHub transport (issue #2342).
//
// Every assertion here is written so it can FAIL. The retry tests feed a known
// transient failure and count attempts; the no-retry tests feed a known
// SEMANTIC failure and assert exactly one attempt. A test that only ever sees a
// healthy executor proves nothing about a transport whose whole job is failure
// handling.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runGitHubCommand,
  ghJson,
  isTransientGitHubTransport,
  isMutatingCall,
  GitHubTransportError,
  spawnGitHub,
  isRateLimitExhausted,
  rateLimitMaxWaitMs,
  rateLimitResetDelayMs,
} from './github-transport.mjs'

const noWait = () => {}

function failingExecutor(stderr, { succeedOnAttempt = null, stdout = '{}' } = {}) {
  const calls = []
  return {
    calls,
    executor(_bin, args) {
      calls.push(args)
      if (succeedOnAttempt !== null && calls.length >= succeedOnAttempt) return stdout
      const error = new Error('Command failed')
      error.stderr = stderr
      throw error
    },
  }
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

test('transient transport markers are recognised', () => {
  for (const marker of [
    'HTTP 500: Internal Server Error',
    'HTTP 502 Bad Gateway',
    'HTTP 504',
    'connection reset by peer',
    'connection timed out',
    'net/http: TLS handshake timeout',
    'No server is currently available to service your request',
  ]) {
    assert.equal(isTransientGitHubTransport({ stderr: marker }), true, marker)
  }
})

test('404 is NOT transient — it is an answer this repository depends on believing', () => {
  // The observed production failures WERE spurious 404s. They were fixed at the
  // source (batched tree read), never by teaching the classifier to distrust a
  // true absence. If this assertion is ever flipped, every "does this ref exist"
  // read in the repo starts proving absence by timeout, which is fail-open.
  assert.equal(isTransientGitHubTransport({ stderr: 'HTTP 404: Not Found' }), false)
})

test('semantic failures are NOT transient', () => {
  for (const marker of [
    'HTTP 401: Bad credentials',
    'HTTP 403: Resource not accessible by integration',
    'HTTP 422: Validation Failed',
    'reference already exists',
    'could not resolve to a Repository',
  ]) {
    assert.equal(isTransientGitHubTransport({ stderr: marker }), false, marker)
  }
})

// ---------------------------------------------------------------------------
// Retry behaviour — proven against known-dirty input
// ---------------------------------------------------------------------------

test('a transient read failure is retried up to the attempt budget, then fails CLOSED', () => {
  const { calls, executor } = failingExecutor('HTTP 502 Bad Gateway')
  assert.throws(
    () => runGitHubCommand(['api', 'repos/o/r/git/trees/abc'], {
      executor, wait: noWait, attempts: 4, reportStderr() {},
    }),
    (error) => error instanceof GitHubTransportError && /502/.test(error.message),
  )
  assert.equal(calls.length, 4, 'all four attempts should be spent')
})

test('a transient read that recovers returns the successful body', () => {
  const { calls, executor } = failingExecutor('HTTP 503', { succeedOnAttempt: 3, stdout: '{"ok":true}' })
  const out = ghJson(['api', 'repos/o/r/contents/x'], { executor, wait: noWait, reportStderr() {} })
  assert.deepEqual(out, { ok: true })
  assert.equal(calls.length, 3)
})

test('a SEMANTIC read failure is never retried', () => {
  const { calls, executor } = failingExecutor('HTTP 404: Not Found')
  assert.throws(() => runGitHubCommand(['api', 'repos/o/r/git/ref/heads/nope'], {
    executor, wait: noWait, attempts: 4, reportStderr() {},
  }))
  assert.equal(calls.length, 1, 'a 404 answer must cost exactly one call')
})

// ---------------------------------------------------------------------------
// Primary rate-limit exhaustion — one bounded wait for the stated reset
// ---------------------------------------------------------------------------

const RATE_LIMITED = 'gh: API rate limit exceeded for installation ID 1234. (HTTP 403)'
const NOW_MS = Date.UTC(2026, 8, 11, 12, 0, 0)
const rateLimitResponse = (resetSeconds, remaining = 0, extraHeaders = '') =>
  `HTTP/2.0 200 OK\nContent-Type: application/json\nX-Ratelimit-Reset: ${resetSeconds}\n${extraHeaders}\n` +
  JSON.stringify({ resources: { core: { limit: 5000, remaining, reset: resetSeconds }, graphql: { limit: 5000, remaining: 4000, reset: resetSeconds } } })

function rateLimitedExecutor({ failures = 1, probe, stdout = '{"ok":true}', stderr = RATE_LIMITED }) {
  const calls = []
  let failed = 0
  return {
    calls,
    executor(_bin, args) {
      calls.push(args)
      if (args.join(' ') === 'api -i rate_limit') {
        if (probe instanceof Error) throw probe
        return probe
      }
      if (failed < failures) {
        failed += 1
        const error = new Error('Command failed')
        error.stderr = stderr
        throw error
      }
      return stdout
    },
  }
}

// The wait is opt-in: these tests act as a step that holds no lock and set the cap.
const OPTED_MS = 15 * 60 * 1000

test('with no opt-in, a rate-limit 403 fails fast: no wait, no probe, one call', () => {
  const saved = process.env.GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS
  delete process.env.GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS
  try {
    const { calls, executor } = rateLimitedExecutor({ probe: rateLimitResponse(Math.floor(NOW_MS / 1000) + 60) })
    assert.throws(() => runGitHubCommand(['api', 'repos/o/r/pulls'], { executor, wait: () => assert.fail('an unmarked (possibly lock-holding) step waited'), now: () => NOW_MS, reportStderr() {} }))
    assert.equal(calls.length, 1)
  } finally {
    if (saved !== undefined) process.env.GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS = saved
  }
})

test('a rate-limit 403 waits for the stated reset, then succeeds', () => {
  const resetSeconds = Math.floor(NOW_MS / 1000) + 300
  const waits = []
  const { calls, executor } = rateLimitedExecutor({ probe: rateLimitResponse(resetSeconds) })
  const out = ghJson(['api', 'repos/o/r/pulls?state=open&per_page=100'], {
    executor, wait: (ms) => waits.push(ms), now: () => NOW_MS, maxRateLimitWaitMs: OPTED_MS, reportStderr() {},
  })
  assert.deepEqual(out, { ok: true })
  assert.deepEqual(calls.map((args) => args.join(' ')), [
    'api repos/o/r/pulls?state=open&per_page=100',
    'api -i rate_limit',
    'api repos/o/r/pulls?state=open&per_page=100',
  ])
  assert.deepEqual(waits, [301000], 'waits until the reset plus one second, exactly once')
})

test('retry-after is honoured when GitHub states one', () => {
  const waits = []
  const { executor } = rateLimitedExecutor({
    probe: rateLimitResponse(Math.floor(NOW_MS / 1000) + 3000, 0, 'Retry-After: 60\n'),
    stderr: 'HTTP 429: API rate limit exceeded',
  })
  runGitHubCommand(['api', 'repos/o/r/issues'], { executor, wait: (ms) => waits.push(ms), now: () => NOW_MS, maxRateLimitWaitMs: OPTED_MS, reportStderr() {} })
  assert.deepEqual(waits, [61000])
})

test('a different 403 still fails immediately with no wait and no probe', () => {
  for (const stderr of ['HTTP 403: Resource not accessible by integration', 'HTTP 403: Forbidden', 'You have exceeded a secondary rate limit (HTTP 403)']) {
    const { calls, executor } = rateLimitedExecutor({ failures: 5, stderr, probe: rateLimitResponse(Math.floor(NOW_MS / 1000) + 10) })
    assert.throws(
      () => runGitHubCommand(['api', 'repos/o/r/pulls/1'], { executor, wait: () => assert.fail(`${stderr} waited`), now: () => NOW_MS, maxRateLimitWaitMs: OPTED_MS, reportStderr() {} }),
      (error) => error instanceof GitHubTransportError && error.rateLimitExhausted === false,
    )
    assert.equal(calls.length, 1, `${stderr} must cost exactly one call`)
  }
})

test('a reset further away than fifteen minutes fails CLOSED without waiting', () => {
  const { calls, executor } = rateLimitedExecutor({ probe: rateLimitResponse(Math.floor(NOW_MS / 1000) + 16 * 60) })
  assert.throws(
    () => runGitHubCommand(['api', 'repos/o/r/pulls'], { executor, wait: () => assert.fail('waited past the cap'), now: () => NOW_MS, maxRateLimitWaitMs: OPTED_MS, reportStderr() {} }),
    (error) => error.rateLimitExhausted === true && /rate limit exceeded/.test(error.message),
  )
  assert.equal(calls.length, 2, 'the original call and the free rate_limit probe, nothing more')
})

test('an unreadable reset, a second exhaustion, a write, or a zero cap all fail closed', () => {
  const inWindow = rateLimitResponse(Math.floor(NOW_MS / 1000) + 60)
  const unreadable = rateLimitedExecutor({ probe: new Error('probe failed') })
  assert.throws(() => runGitHubCommand(['api', 'x'], { executor: unreadable.executor, wait: () => assert.fail('guessed a reset'), now: () => NOW_MS, maxRateLimitWaitMs: OPTED_MS, reportStderr() {} }))
  const twice = rateLimitedExecutor({ failures: 2, probe: inWindow })
  const waits = []
  assert.throws(() => runGitHubCommand(['api', 'x'], { executor: twice.executor, wait: (ms) => waits.push(ms), now: () => NOW_MS, maxRateLimitWaitMs: OPTED_MS, reportStderr() {} }))
  assert.equal(waits.length, 1, 'waits at most once per call')
  const write = rateLimitedExecutor({ probe: inWindow })
  assert.throws(() => runGitHubCommand(['api', '-X', 'POST', 'repos/o/r/git/refs'], { executor: write.executor, wait: () => assert.fail('a write waited'), now: () => NOW_MS, maxRateLimitWaitMs: OPTED_MS, reportStderr() {} }))
  assert.equal(write.calls.length, 1)
  const capped = rateLimitedExecutor({ probe: inWindow })
  assert.throws(() => runGitHubCommand(['api', 'x'], { executor: capped.executor, maxRateLimitWaitMs: 0, wait: () => assert.fail('a lock holder waited'), now: () => NOW_MS, reportStderr() {} }))
  assert.equal(capped.calls.length, 1)
})

test('a caller that asked for exactly one attempt never waits or probes on a rate-limit 403', () => {
  const { calls, executor } = rateLimitedExecutor({ probe: rateLimitResponse(Math.floor(NOW_MS / 1000) + 60) })
  assert.throws(
    () => runGitHubCommand(['api', 'repos/o/r/pulls'], { executor, attempts: 1, wait: () => assert.fail('a one-attempt caller waited'), now: () => NOW_MS, reportStderr() {} }),
    (error) => error instanceof GitHubTransportError,
  )
  assert.equal(calls.length, 1, 'one call, no rate_limit probe, no replay')
})

test('the wait is opt-in, capped at 15 minutes, and malformed values fail fast', () => {
  assert.equal(rateLimitMaxWaitMs({}), 0, 'opt-in: an unmarked step (possibly lock-holding) never waits')
  assert.equal(rateLimitMaxWaitMs({ GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '' }), 0)
  assert.equal(rateLimitMaxWaitMs({ GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '0' }), 0)
  assert.equal(rateLimitMaxWaitMs({ GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '120' }), 120000)
  assert.equal(rateLimitMaxWaitMs({ GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '99999' }), 15 * 60 * 1000)
  assert.equal(rateLimitMaxWaitMs({ GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: 'soon' }), 0)
  assert.equal(isRateLimitExhausted({ stderr: 'API rate limit exceeded' }), false, 'no status code, no wait')
  assert.equal(rateLimitResetDelayMs('garbage', ['api', 'x'], NOW_MS), null)
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

test('mutating calls are detected in every shape used in this repository', () => {
  assert.equal(isMutatingCall(['api', '-X', 'POST', 'repos/o/r/git/refs']), true)
  assert.equal(isMutatingCall(['api', '--method', 'PATCH', 'repos/o/r/git/refs/x']), true)
  assert.equal(isMutatingCall(['api', '-XDELETE', 'repos/o/r/git/refs/x']), true)
  assert.equal(isMutatingCall(['api', 'repos/o/r/git/refs', '-f', 'ref=x']), true)
  assert.equal(isMutatingCall(['pr', 'merge', '123', '--squash']), true)
  assert.equal(isMutatingCall(['issue', 'comment', '5', '--body', 'x']), true)
  // Reads must NOT be misclassified — that would silently disable their retries.
  assert.equal(isMutatingCall(['api', 'repos/o/r/git/trees/abc?recursive=1']), false)
  assert.equal(isMutatingCall(['api', '-X', 'GET', 'repos/o/r/pulls']), false)
  assert.equal(isMutatingCall(['pr', 'view', '123', '--json', 'state']), false)
  assert.equal(isMutatingCall(['pr', 'list', '--state', 'open']), false)
})

test('non-api state-changing subcommands cannot pass through the read front door', () => {
  for (const args of [
    ['variable', 'set', 'KEY'], ['variable', 'update', 'KEY'], ['release', 'upload', 'v1', 'asset.zip'],
    ['cache', 'delete', '1'], ['workflow', 'enable', 'build.yml'], ['repo', 'fork', 'o/r'],
  ]) assert.equal(isMutatingCall(args), true, args.join(' '))
  for (const args of [['variable', 'get', 'KEY'], ['pr', 'view', '1'], ['issue', 'list']]) {
    assert.equal(isMutatingCall(args), false, args.join(' '))
  }
})

test('a mutating call is NOT retried even when the failure is transient', () => {
  // gh cannot distinguish "never landed" from "landed, response lost", so a
  // retried POST can create the ref twice.
  const { calls, executor } = failingExecutor('HTTP 502 Bad Gateway')
  assert.throws(() => runGitHubCommand(['api', '-X', 'POST', 'repos/o/r/git/refs', '-f', 'ref=x'], {
    executor, wait: noWait, attempts: 4, reportStderr() {},
  }))
  assert.equal(calls.length, 1, 'a write must never be replayed')
})

test('a caller that proves idempotency may opt a write into retries', () => {
  const { calls, executor } = failingExecutor('HTTP 502')
  assert.throws(() => runGitHubCommand(['api', '-X', 'PATCH', 'repos/o/r/git/refs/x'], {
    executor, wait: noWait, attempts: 3, idempotentWrite: true, reportStderr() {},
  }))
  assert.equal(calls.length, 3)
})

// ---------------------------------------------------------------------------
// Caller-preserving refusals
// ---------------------------------------------------------------------------

test('wrapError preserves each gate’s own named refusal', () => {
  class LeaseCheckError extends Error {}
  const { executor } = failingExecutor('HTTP 403: forbidden')
  assert.throws(
    () => runGitHubCommand(['api', 'repos/o/r/pulls'], {
      executor, wait: noWait, reportStderr() {},
      wrapError: (detail) => new LeaseCheckError(`GitHub read failed: ${detail}`),
    }),
    (error) => error instanceof LeaseCheckError && /GitHub read failed: HTTP 403/.test(error.message),
  )
})

test('an expected failure is not re-printed, an unexpected one is', () => {
  const printed = []
  const absent = failingExecutor('HTTP 404: Not Found')
  assert.throws(() => runGitHubCommand(['api', 'repos/o/r/git/ref/heads/x'], {
    executor: absent.executor, wait: noWait,
    expectedFailure: /HTTP 404/i, reportStderr: (t) => printed.push(t),
  }))
  assert.equal(printed.length, 0, 'an expected absence must stay quiet')

  const real = failingExecutor('HTTP 403: Bad credentials')
  assert.throws(() => runGitHubCommand(['api', 'repos/o/r/git/ref/heads/x'], {
    executor: real.executor, wait: noWait,
    expectedFailure: /HTTP 404/i, reportStderr: (t) => printed.push(t),
  }))
  assert.equal(printed.length, 1, 'a real fault must be loud')
  assert.match(printed[0], /Bad credentials/)
})

test('malformed JSON is refused by name, not swallowed', () => {
  assert.throws(
    () => ghJson(['api', 'repos/o/r/pulls'], { executor: () => 'not json', wait: noWait }),
    /invalid JSON/,
  )
})

test('spawnGitHub preserves stdin and issues a mutation exactly once', () => {
  const calls = []
  const result = spawnGitHub(['api', '-X', 'POST', 'repos/o/r/issues/1/comments', '--input', '-'], {
    input: '{"body":"one"}',
    executor: (bin, args, options) => {
      calls.push({ bin, args, options })
      return { status: 0, stdout: '{"id":1}', stderr: '' }
    },
  })
  assert.equal(result.status, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].bin, 'gh')
  assert.equal(calls[0].options.input, '{"body":"one"}')
  assert.deepEqual(calls[0].options.stdio, ['pipe', 'pipe', 'pipe'])
})

test('spawnGitHub refuses reads and retry requests', () => {
  const executor = () => assert.fail('executor must not run')
  assert.throws(() => spawnGitHub(['api', 'repos/o/r'], { executor }), /for mutations/)
  assert.throws(() => spawnGitHub(['api', '-X', 'DELETE', 'repos/o/r/git/refs/x'], { executor, idempotentWrite: true }), /never replays/)
})
