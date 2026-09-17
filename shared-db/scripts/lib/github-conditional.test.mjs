// Issue #2773: request-count fixtures for shared conditional reads, the
// host-wide single-flight snapshot, the change broadcast, and the host-wide
// rate-limit latch. Every count here is a count of executor invocations, i.e.
// real `gh` wire requests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  nextPageEndpoint, parseHttpResponse, pollDelayMs, sharedConditionalGet, singleFlight,
} from './github-conditional.mjs'
import { hostQuotaLatch, runGitHubCommand } from './github-transport.mjs'
import { fetchCheckRuns } from '../orchestrator-flow/runner-lanes.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const scratch = () => mkdtempSync(path.join(tmpdir(), 'gh-2773-'))
const env = { GH_TOKEN: 'fixture-token' }

function fakeGitHub({ etag = 'W/"v1"', body = '{"n":1}', pollInterval } = {}) {
  const state = { etag, body, calls: [], counted: 0 }
  state.executor = (_bin, args) => {
    state.calls.push(args)
    const at = args.indexOf('-H')
    const sent = at >= 0 ? String(args[at + 1]).replace(/^If-None-Match:\s*/, '') : null
    const extra = pollInterval ? `X-Poll-Interval: ${pollInterval}\n` : ''
    if (sent && sent === state.etag) {
      const error = new Error('gh: HTTP 304')
      error.stdout = `HTTP/2.0 304 Not Modified\nEtag: ${state.etag}\n${extra}\n`
      throw error
    }
    state.counted += 1 // only a 200 is billed to the primary quota
    return `HTTP/2.0 200 OK\nEtag: ${state.etag}\n${extra}\n${state.body}`
  }
  return state
}

test('parseHttpResponse reads status, headers and body', () => {
  const r = parseHttpResponse('HTTP/2.0 200 OK\r\nEtag: W/"x"\r\nX-Poll-Interval: 60\r\nLink: <https://api.github.com/x?page=2>; rel="next"\r\nLink: <https://api.github.com/x?page=9>; rel="last"\r\n\r\n{"a":1}')
  assert.equal(r.status, 200); assert.equal(r.headers.get('etag'), 'W/"x"'); assert.equal(r.headers.get('x-poll-interval'), '60'); assert.equal(r.body, '{"a":1}')
  assert.equal(r.headers.get('link'), '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"')
})

test('unchanged polling consumes no primary quota: every repeat poll is a 304', () => {
  const dir = scratch(); const gh = fakeGitHub(); let clock = 0
  const read = () => sharedConditionalGet('repos/o/r/commits/abc/check-runs', { env, dir, executor: gh.executor, now: () => clock })
  const first = read()
  assert.equal(first.changed, true); assert.equal(first.body, '{"n":1}')
  for (let i = 1; i <= 20; i += 1) {
    clock += 30000
    const again = read()
    assert.equal(again.changed, false); assert.equal(again.status, 304); assert.equal(again.body, '{"n":1}')
  }
  assert.equal(gh.calls.length, 21, 'each poll generation makes exactly one conditional request')
  assert.equal(gh.counted, 1, 'twenty unchanged polls cost zero primary-quota requests')
  gh.etag = 'W/"v2"'; gh.body = '{"n":2}'; clock += 30000
  const changed = read()
  assert.equal(changed.changed, true); assert.equal(changed.body, '{"n":2}')
  assert.equal(gh.counted, 2)
  rmSync(dir, { recursive: true, force: true })
})

test('x-poll-interval is surfaced to the caller', () => {
  const dir = scratch(); const gh = fakeGitHub({ pollInterval: 60 })
  const r = sharedConditionalGet('repos/o/r/events', { env, dir, executor: gh.executor, now: () => 0 })
  assert.equal(r.pollIntervalMs, 60000)
  rmSync(dir, { recursive: true, force: true })
})

test('ten simultaneous identical readers in separate processes make one upstream read per generation', async () => {
  const dir = scratch(); const counter = path.join(dir, 'upstream-count.txt'); writeFileSync(counter, '')
  const lib = pathToFileURL(path.join(here, 'github-conditional.mjs')).href
  const script = `
    import { singleFlight } from ${JSON.stringify(lib)}
    import { appendFileSync } from 'node:fs'
    const [dir, counter, startAt] = process.argv.slice(1)
    while (Date.now() < Number(startAt)) {}
    const r = singleFlight({ dir, key: 'k', generation: 7, read: () => {
      appendFileSync(counter, 'x')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
      return { snapshot: 'one' }
    } })
    process.stdout.write(JSON.stringify(r.value))`
  const startAt = Date.now() + 1500
  const runs = Array.from({ length: 10 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir, counter, String(startAt)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err))))
  }))
  const outputs = await Promise.all(runs)
  assert.equal(readFileSync(counter, 'utf8').length, 1, 'exactly one upstream read for ten concurrent readers')
  for (const out of outputs) assert.deepEqual(JSON.parse(out), { snapshot: 'one' })
  rmSync(dir, { recursive: true, force: true })
})

test('a new generation makes a fresh read; a failed read is never served to other callers', () => {
  const dir = scratch(); let reads = 0
  assert.throws(() => singleFlight({ dir, key: 'k', generation: 1, read: () => { reads += 1; throw new Error('HTTP 502') } }), /502/)
  assert.deepEqual(singleFlight({ dir, key: 'k', generation: 1, read: () => { reads += 1; return 'ok' } }), { value: 'ok', shared: false })
  assert.deepEqual(singleFlight({ dir, key: 'k', generation: 1, read: () => { reads += 1; return 'other' } }), { value: 'ok', shared: true })
  assert.deepEqual(singleFlight({ dir, key: 'k', generation: 2, read: () => { reads += 1; return 'next' } }), { value: 'next', shared: false })
  assert.equal(reads, 3)
  rmSync(dir, { recursive: true, force: true })
})

test('a crashed lock holder is taken over instead of wedging every reader', () => {
  const dir = scratch(); let clock = Date.now()
  writeFileSync(path.join(dir, 'k.flight-3.lock'), '')
  const r = singleFlight({ dir, key: 'k', generation: 3, now: () => (clock += 30000), wait: () => {}, staleLockMs: 60000, read: () => 'recovered' })
  assert.equal(r.value, 'recovered')
  rmSync(dir, { recursive: true, force: true })
})

test('while the quota latch is active a waiter waits for the holder; a holder that died mid-wait is still taken over after the reset', () => {
  const dir = scratch(); let clock = Date.now(); let polls = 0
  writeFileSync(path.join(dir, 'k.flight-7.lock'), '')
  const reset = clock + 900000
  const r = singleFlight({
    dir, key: 'k', generation: 7, now: () => clock, staleLockMs: 60000, maxWaitMs: 120000,
    latchResetMs: () => reset,
    wait: (ms) => {
      clock += ms; polls += 1
      // The holder finishes just after a 15-minute quota wait, well past maxWaitMs and staleLockMs.
      if (clock > reset + 5000) writeFileSync(path.join(dir, 'k.flight-7.json'), JSON.stringify({ value: 'shared' }))
    },
    read: () => { throw new Error('a waiter must not start its own read') },
  })
  assert.equal(r.value, 'shared'); assert.equal(r.shared, true)
  // Crashed holder: the lock never clears and no result appears. The waiter takes over
  // no earlier than staleLockMs after the reset, and never spins in between.
  const dir2 = scratch(); clock = Date.now(); const reset2 = clock + 900000; let spins = 0
  writeFileSync(path.join(dir2, 'k.flight-8.lock'), '')
  const taken = singleFlight({ dir: dir2, key: 'k', generation: 8, now: () => clock, staleLockMs: 60000, latchResetMs: () => reset2, wait: (ms) => { clock += ms; spins += 1 }, read: () => clock })
  assert.equal(taken.shared, false); assert.ok(taken.value > reset2 + 60000, 'no takeover before the reset plus staleLockMs')
  assert.ok(spins < 900000 / 250 + 60000 / 25 + 10, `bounded local waits: ${spins}`)
  rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true })
})

test('failed polls back off 30/60/120/300s with jitter; x-poll-interval is only a floor', () => {
  assert.equal(pollDelayMs({ baseMs: 20000, failures: 0, random: () => 0.99 }), 20000, 'no backoff while healthy')
  assert.equal(pollDelayMs({ baseMs: 20000, pollIntervalHeaderMs: 60000 }), 60000)
  assert.equal(pollDelayMs({ baseMs: 90000, pollIntervalHeaderMs: 60000 }), 90000)
  assert.deepEqual([1, 2, 3, 4, 9].map((failures) => pollDelayMs({ baseMs: 20000, failures, random: () => 0 })), [30000, 60000, 120000, 300000, 300000])
  const high = pollDelayMs({ baseMs: 20000, failures: 4, random: () => 0.999 })
  assert.ok(high > 300000 && high < 360000, `jitter stays within 20%: ${high}`)
})

test('a non-api gh command is stopped by either latch and brakes only the bucket the probe shows exhausted', () => {
  const dir = scratch(); const latchEnv = { GH_TOKEN: 't4', GITHUB_QUOTA_LATCH_DIR: dir }; let clock = 7_000_000; const now = () => clock
  const resetSeconds = Math.floor((clock + 600000) / 1000)
  const executor = (_bin, args) => {
    if (args[2] === 'rate_limit') return `HTTP/2.0 200 OK

${JSON.stringify({ resources: { core: { remaining: 0, reset: resetSeconds }, graphql: { remaining: 900, reset: resetSeconds } } })}`
    const e = new Error('HTTP 403'); e.stderr = 'API rate limit exceeded for user (HTTP 403)'; throw e
  }
  assert.throws(() => runGitHubCommand(['run', 'list'], { executor, quotaLatch: hostQuotaLatch(latchEnv), maxRateLimitWaitMs: 1000, wait: () => {}, reportStderr: () => {}, now }))
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => n.replace(/^.*-/, '')), ['core.json'], 'core exhaustion seen by gh run list brakes core, not graphql')
  let wire = 0
  assert.throws(() => runGitHubCommand(['api', 'repos/o/r'], { executor: () => { wire += 1 }, quotaLatch: hostQuotaLatch(latchEnv), now }), (e) => e.quotaLatched)
  assert.throws(() => runGitHubCommand(['pr', 'view', '1'], { executor: () => { wire += 1 }, quotaLatch: hostQuotaLatch(latchEnv), now }), (e) => e.quotaLatched)
  runGitHubCommand(['api', 'graphql', '-f', 'query=x'], { executor: () => { wire += 1; return '{}' }, quotaLatch: hostQuotaLatch(latchEnv), now })
  assert.equal(wire, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('staging files are removed even when the rename fails', () => {
  const dir = scratch(); const latchEnv = { GH_TOKEN: 't3', GITHUB_QUOTA_LATCH_DIR: dir }
  const latch = hostQuotaLatch(latchEnv)
  latch.write(['api', 'x'], 1)
  const target = readdirLatch(dir); rmSync(target)
  mkdirSync(target); writeFileSync(path.join(target, 'occupied'), '') // a non-empty directory where the file belongs makes rename fail
  assert.throws(() => latch.write(['api', 'x'], 2))
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), [])
  rmSync(dir, { recursive: true, force: true })
})

test('conditional check-run pages follow Link and are validated exactly as before', () => {
  const h = 'a'.repeat(40); const served = []
  const pages = {
    [`repos/o/r/commits/${h}/check-runs?per_page=100&filter=all`]: { body: JSON.stringify({ total_count: 2, check_runs: [{ id: 1, name: 'a', status: 'completed', conclusion: 'success' }] }), link: `<https://api.github.com/repositories/9/commits/${h}/check-runs?per_page=100&filter=all&page=2>; rel="next"` },
    [`repositories/9/commits/${h}/check-runs?per_page=100&filter=all&page=2`]: { body: JSON.stringify({ total_count: 2, check_runs: [{ id: 2, name: 'b', status: 'in_progress', conclusion: null }] }), link: null },
  }
  const rows = fetchCheckRuns('o/r', h, { readPage: (endpoint) => { served.push(endpoint); return pages[endpoint] } })
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b']); assert.equal(served.length, 2)
  assert.equal(nextPageEndpoint(null), null)
  assert.equal(nextPageEndpoint('<https://api.github.com/x?page=2>; title="more"; rel="next", <https://api.github.com/x?page=9>; rel="last"'), 'x?page=2')
  assert.throws(() => nextPageEndpoint('<https://example.com/x?page=2>; rel="next"'), /not on api.github.com/)
  assert.throws(() => nextPageEndpoint('<https://api.github.com/x?page=2>; title="missing relation"'), /no rel relation/)
  assert.throws(() => fetchCheckRuns('o/r', h, { readPage: () => ({ body: JSON.stringify({ total_count: 3, check_runs: [] }), link: null }) }), /incomplete/)
})

test('rate-limit exhaustion seen by one caller stops every other caller until reset, with no wire request', () => {
  const dir = scratch(); const latchEnv = { GH_TOKEN: 'fixture-token', GITHUB_QUOTA_LATCH_DIR: dir }
  let clock = 1_000_000; const now = () => clock; const resetSeconds = Math.floor((clock + 600000) / 1000)
  const exhaustedExecutor = (_bin, args) => {
    if (args[1] === '-i' && args[2] === 'rate_limit') return `HTTP/2.0 200 OK\n\n${JSON.stringify({ resources: { core: { remaining: 0, reset: resetSeconds }, graphql: { remaining: 10, reset: resetSeconds } } })}`
    const error = new Error('HTTP 403: API rate limit exceeded'); error.stderr = 'gh: API rate limit exceeded for user (HTTP 403)'; throw error
  }
  let first = 0
  assert.throws(() => runGitHubCommand(['api', 'repos/o/r/pulls/1'], { executor: (b, a, o) => { first += 1; return exhaustedExecutor(b, a, o) }, quotaLatch: hostQuotaLatch(latchEnv), maxRateLimitWaitMs: 1000, wait: () => {}, reportStderr: () => {}, now }), /rate limit exceeded/i)
  assert.equal(first, 2, 'the discovering caller spends its failing request plus the free rate_limit probe')
  // Every other caller -- other sessions, reads and writes alike -- is stopped locally.
  for (const args of [['api', 'repos/o/r/pulls/2'], ['api', '-X', 'POST', 'repos/o/r/git/refs', '-f', 'ref=x'], ['pr', 'view', '1']]) {
    let wire = 0
    assert.throws(() => runGitHubCommand(args, { executor: () => { wire += 1; return '{}' }, quotaLatch: hostQuotaLatch(latchEnv), reportStderr: () => {}, now }), (e) => e.rateLimitExhausted && e.quotaLatched)
    assert.equal(wire, 0, `latched caller made a wire request: ${args.join(' ')}`)
  }
  // `gh api graphql` spends only graphql, so a core exhaustion does not stop it.
  let graph = 0
  runGitHubCommand(['api', 'graphql', '-f', 'query=x'], { executor: () => { graph += 1; return '{}' }, quotaLatch: hostQuotaLatch(latchEnv), now })
  assert.equal(graph, 1)
  // An opted-in reader waits for the reset instead of refusing.
  let waited = 0; let after = 0
  assert.equal(runGitHubCommand(['api', 'repos/o/r/pulls/3'], { executor: () => { after += 1; return 'ok' }, quotaLatch: hostQuotaLatch(latchEnv), maxRateLimitWaitMs: 900000, wait: (ms) => { waited = ms; clock += ms }, reportStderr: () => {}, now }), 'ok')
  assert.ok(waited >= 600000); assert.equal(after, 1)
  // After the reset every caller proceeds.
  let resumed = 0
  runGitHubCommand(['api', 'repos/o/r/pulls/4'], { executor: () => { resumed += 1; return '{}' }, quotaLatch: hostQuotaLatch(latchEnv), now })
  assert.equal(resumed, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('a fail-fast caller that cannot probe still brakes others for a bounded window; a corrupt latch is ignored', () => {
  const dir = scratch(); const latchEnv = { GH_TOKEN: 't2', GITHUB_QUOTA_LATCH_DIR: dir }; let clock = 5_000_000; const now = () => clock
  assert.throws(() => runGitHubCommand(['api', 'x'], { attempts: 1, executor: () => { const e = new Error('HTTP 429'); e.stderr = 'API rate limit exceeded (HTTP 429)'; throw e }, quotaLatch: hostQuotaLatch(latchEnv), reportStderr: () => {}, now }))
  let wire = 0
  assert.throws(() => runGitHubCommand(['api', 'y'], { executor: () => { wire += 1; return '{}' }, quotaLatch: hostQuotaLatch(latchEnv), now }), (e) => e.quotaLatched)
  clock += 61000
  runGitHubCommand(['api', 'y'], { executor: () => { wire += 1; return '{}' }, quotaLatch: hostQuotaLatch(latchEnv), now })
  assert.equal(wire, 1)
  const latch = hostQuotaLatch(latchEnv); latch.write(['api', 'z'], clock + 1e9)
  const file = readdirLatch(dir); writeFileSync(file, 'not json')
  runGitHubCommand(['api', 'z'], { executor: () => { wire += 1; return '{}' }, quotaLatch: hostQuotaLatch(latchEnv), now })
  assert.equal(wire, 2)
  assert.equal(hostQuotaLatch({ GITHUB_QUOTA_LATCH: 'off' }), null)
  rmSync(dir, { recursive: true, force: true })
})

function readdirLatch(dir) {
  return path.join(dir, readdirSync(dir).find((n) => n.endsWith('-core.json')))
}
