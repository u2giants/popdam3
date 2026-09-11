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
