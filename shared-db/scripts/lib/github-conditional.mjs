// Shared conditional reads for polling callers (issue #2773).
//
// WHY THIS EXISTS
// ---------------
// Every session that waited on GitHub polled on its own timer and paid a full
// primary-quota request per poll, even when nothing had changed. Ten sessions
// watching the same head made ten identical reads every interval against one
// shared 5,000-request hourly bucket.
//
// Two rules remove that waste without making any wait longer:
//
//   1. CONDITIONAL. Every poll sends the stored ETag. GitHub answers an
//      unchanged resource with HTTP 304, which does NOT count against the
//      primary quota (verified live on 2026-09-17: x-ratelimit-used stayed
//      flat across three consecutive 304s while each 200 raised it by one).
//      The cached body is returned byte-for-byte.
//   2. SINGLE-FLIGHT, HOST-WIDE. Identical reads from any process on this
//      machine within one 5-second window share ONE upstream request. The
//      first caller takes an exclusive lock file; every other caller waits
//      locally (no network) for the result that caller writes. Windows are
//      fixed, so two callers straddling a boundary may still make two reads.
//
// A healthy poll interval is never lengthened (an unchanged poll is free, so
// waiting longer would only make work slower) except to honour GitHub's own
// x-poll-interval. Consecutive failed polls back off 30/60/120/300s with jitter. Quota exhaustion is handled by the
// host-wide latch in github-transport.mjs, which stops every caller until the
// reset; while that latch is active a waiter keeps waiting for the holder's
// delayed result, and its takeover and timeout bounds start at the reset.
//
// Nothing here judges a response. A cached body is exactly the bytes GitHub
// last returned for that ETag, and every caller still validates it as before.
// A failed read is never shared: each caller fails on its own bounded path.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hostQuotaLatch, runGitHubCommand } from './github-transport.mjs'
import { parseLinkHeader } from '../manage-migration-author-lanes.mjs'

export class SharedReadError extends Error {
  constructor(message, { transientTransport = false } = {}) {
    super(message)
    this.name = 'SharedReadError'
    this.transientTransport = transientTransport
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

export const FAILURE_BACKOFF_SECONDS = [30, 60, 120, 300]

/**
 * Delay before the next poll. A healthy poll waits exactly `baseMs`, raised only
 * to GitHub's own x-poll-interval (a floor, never a ceiling). After consecutive
 * FAILED polls the delay steps through 30/60/120/300 seconds plus up to 20% jitter,
 * so many sessions hitting one outage do not retry in lockstep.
 */
export function pollDelayMs({ baseMs, failures = 0, pollIntervalHeaderMs = 0, random = Math.random }) {
  let delay = Math.max(Number(baseMs) || 0, Number(pollIntervalHeaderMs) || 0)
  if (failures > 0) {
    const step = FAILURE_BACKOFF_SECONDS[Math.min(failures, FAILURE_BACKOFF_SECONDS.length) - 1] * 1000
    delay = Math.max(delay, step) + Math.floor(random() * step * 0.2)
  }
  return delay
}

/** Split a `gh api -i` response into status, lower-cased headers, and body. */
export function parseHttpResponse(raw) {
  const text = String(raw ?? '').replace(/\r\n/g, '\n')
  const boundary = text.indexOf('\n\n')
  const head = boundary < 0 ? text : text.slice(0, boundary)
  const body = boundary < 0 ? '' : text.slice(boundary + 2)
  const lines = head.split('\n')
  const status = Number(/^HTTP\/\S+\s+(\d{3})/.exec(lines[0] ?? '')?.[1])
  const headers = new Map()
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':')
    if (at > 0) {
      const name = line.slice(0, at).trim().toLowerCase()
      const value = line.slice(at + 1).trim()
      headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value)
    }
  }
  return { status: Number.isFinite(status) ? status : null, headers, body }
}

export function defaultSharedDir(env = process.env) {
  return env.GITHUB_SHARED_READ_DIR || path.join(tmpdir(), 'shared-db-github-reads')
}

export function sharedReadKey(endpoint, env = process.env) {
  const identity = String(env.GH_TOKEN || env.GITHUB_TOKEN || 'gh-cli-login')
  return createHash('sha256').update(`${identity}\n${endpoint}`).digest('hex').slice(0, 32)
}

function readJsonFile(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function writeJsonAtomic(file, value) {
  const staging = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    writeFileSync(staging, JSON.stringify(value))
    renameSync(staging, file)
  } finally {
    rmSync(staging, { force: true })
  }
}

/**
 * Run `read` at most once per (key, generation) across every process on the
 * host. Callers that lose the race wait locally for the winner's result. A lock
 * older than `staleLockMs` (a crashed holder) is taken over. `latchResetMs()` returns
 * the host quota latch's reset time: until then a live holder may be sleeping for
 * the reset, so the takeover and timeout bounds are measured from that reset, not
 * from now. A holder that crashed during a latched wait is therefore still taken
 * over, just no earlier than `staleLockMs` after the reset.
 */
export function singleFlight({ dir, key, generation, read, wait = sleepSync, now = Date.now, staleLockMs = 60000, maxWaitMs = 120000, latchResetMs = () => 0 }) {
  mkdirSync(dir, { recursive: true })
  const resultFile = path.join(dir, `${key}.flight-${generation}.json`)
  const lockFile = path.join(dir, `${key}.flight-${generation}.lock`)
  const started = now()
  for (;;) {
    const done = readJsonFile(resultFile)
    if (done) return { value: done.value, shared: true }
    let fd
    try {
      fd = openSync(lockFile, 'wx')
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
      let lockMtime
      try {
        lockMtime = statSync(lockFile).mtimeMs
      } catch (statError) {
        // EPERM with no lock file is a real permission fault, not contention.
        if (error.code === 'EPERM') throw error
        continue
      }
      let reset = 0
      try { reset = Number(latchResetMs()) || 0 } catch { reset = 0 }
      const current = now()
      const holdUntil = Math.max(lockMtime, reset)
      if (current - holdUntil > staleLockMs) { rmSync(lockFile, { force: true }); continue }
      if (current - Math.max(started, reset) > maxWaitMs) throw new SharedReadError(`shared GitHub read did not finish within ${maxWaitMs}ms (lock ${lockFile})`)
      wait(current < reset ? 250 : 25)
      continue
    }
    closeSync(fd)
    try {
      const again = readJsonFile(resultFile)
      if (again) return { value: again.value, shared: true }
      const value = read()
      writeJsonAtomic(resultFile, { value })
      pruneOldFlights(dir, key, generation)
      return { value, shared: false }
    } finally {
      rmSync(lockFile, { force: true })
    }
  }
}

// Finished generations older than the previous one can never be joined again.
function pruneOldFlights(dir, key, generation) {
  try {
    for (const name of readdirSync(dir)) {
      const match = /^(.+)\.flight-(\d+)\.json$/.exec(name)
      if (match && match[1] === key && Number(match[2]) < generation - 1) rmSync(path.join(dir, name), { force: true })
    }
  } catch { /* housekeeping only */ }
}

// `gh api -i` exits non-zero on 304 but prints the response on stdout. The
// transport wraps errors and drops stdout, so the 304 is turned back into a
// normal result at the executor, before the transport's classifier sees it.
function acceptNotModified(executor) {
  return (bin, args, options) => {
    try {
      return executor(bin, args, options)
    } catch (error) {
      const stdout = String(error?.stdout ?? '')
      if (/^HTTP\/\S+\s+304\b/.test(stdout)) return stdout
      throw error
    }
  }
}

/**
 * One conditional GET of a single REST page, shared host-wide.
 * Returns { body, changed, status, pollIntervalMs, link, requested }.
 * `requested` is false when this caller joined another caller's read.
 */
export function sharedConditionalGet(endpoint, {
  env = process.env,
  dir = defaultSharedDir(env),
  executor = execFileSync,
  now = Date.now,
  wait = sleepSync,
  windowMs = 5000,
  // A fixture executor never touches the machine's latch unless one is passed.
  quotaLatch = executor === execFileSync ? hostQuotaLatch(env) : null,
} = {}) {
  mkdirSync(dir, { recursive: true })
  const key = sharedReadKey(endpoint, env)
  const stateFile = path.join(dir, `${key}.state.json`)
  const generation = Math.floor(now() / windowMs)
  const flight = singleFlight({
    dir, key, generation, wait, now,
    latchResetMs: () => quotaLatch?.read(['api', endpoint]) ?? 0,
    read: () => {
      const state = readJsonFile(stateFile)
      const args = ['api', '-i']
      if (state?.etag && typeof state.body === 'string') args.push('-H', `If-None-Match: ${state.etag}`)
      args.push(endpoint)
      const response = parseHttpResponse(runGitHubCommand(args, { executor: acceptNotModified(executor), quotaLatch }))
      const header = response.headers.get('x-poll-interval') ?? ''
      const pollIntervalMs = /^\d+$/.test(header) ? Number(header) * 1000 : 0
      if (response.status === 304) {
        if (!state || typeof state.body !== 'string') throw new SharedReadError(`GitHub answered 304 for ${endpoint} but no cached body exists; refusing to invent one`)
        return { body: state.body, changed: false, status: 304, pollIntervalMs, link: state.link ?? null }
      }
      if (response.status !== 200) throw new SharedReadError(`GitHub answered HTTP ${response.status} for ${endpoint}`, { transientTransport: response.status >= 500 && response.status <= 599 })
      const next = { etag: response.headers.get('etag') ?? null, body: response.body, generation: Number(state?.generation ?? 0) + 1, link: response.headers.get('link') ?? null }
      writeJsonAtomic(stateFile, next)
      return { body: next.body, changed: true, status: 200, pollIntervalMs, link: next.link }
    },
  })
  return { ...flight.value, requested: !flight.shared }
}

/** Next-page URL from a Link header, or null. */
export function nextPageEndpoint(link) {
  const value = String(link ?? '').trim()
  if (!value) return null
  const next = parseLinkHeader(value).find((entry) => String(entry.params.rel ?? '').trim().toLowerCase().split(/\s+/).includes('next'))
  if (!next) return null
  let parsed
  try { parsed = new URL(next.uri) } catch { throw new SharedReadError('check-run Link rel=next URI is invalid; refusing a partial listing') }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.github.com') throw new SharedReadError('check-run Link rel=next URI is not on api.github.com; refusing a partial listing')
  return `${parsed.pathname.replace(/^\//, '')}${parsed.search}`
}
