// One event-aware watcher per watched GitHub resource, shared host-wide (issue #2773).
//
// WHY THIS EXISTS
// ---------------
// Every session that waited on GitHub ran its own polling loop. Conditional
// reads (github-conditional.mjs) made an unchanged poll free, but each waiter
// still decided on its own when to poll and learned of a change only from its
// own read. This module gives every waiter on the host one shared view:
//
//   1. EVENTS FIRST. Anything that learns of a change -- a webhook receiver, a
//      finished workflow, or this host's own mutation -- calls notifyChange().
//      Every waiter on that resource wakes exactly once for that event, with no
//      GitHub request.
//   2. BROADCAST. When any waiter's conditional read sees a new body, the shared
//      state generation moves and every other waiter wakes once from it, again
//      with no request of its own.
//   3. SAFE FALLBACK. If no event ever arrives, waiters still poll, but on
//      window-aligned instants so identical waiters join one single-flight read
//      (one upstream request per window, a free 304 when unchanged), honour
//      x-poll-interval, back off 30/60/120/300s with jitter after failed reads,
//      and, through the transport, stop for the host quota latch until its reset. Between checks a
//      waiter sleeps; it only stats two local files, never the network, so
//      there is no busy loop.
//
// A wake never judges the resource: the caller re-reads and validates exactly as
// before. A timeout returns a timeout, never a change.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { defaultSharedDir, pollDelayMs, sharedConditionalGet, sharedReadKey } from './github-conditional.mjs'

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms))

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function files(endpoint, env, dir) {
  const key = sharedReadKey(endpoint, env)
  return { state: path.join(dir, `${key}.state.json`), events: path.join(dir, `${key}.events.json`) }
}

/**
 * Current shared position for a resource, read from local files only. A field is
 * null when its file is absent or unreadable (for example mid-replace on Windows);
 * null never counts as a change, so a transient read failure can neither wake a
 * waiter nor make the same token wake it twice.
 */
export function watchCursor(endpoint, { env = process.env, dir = defaultSharedDir(env) } = {}) {
  const f = files(endpoint, env, dir)
  const token = readJson(f.events)?.token
  const generation = Number(readJson(f.state)?.generation)
  return { event: typeof token === 'string' ? token : null, generation: Number.isFinite(generation) ? generation : null }
}

function merge(known, seen) {
  return { event: seen.event ?? known?.event ?? null, generation: seen.generation ?? known?.generation ?? null }
}

/**
 * Record that `endpoint` changed. Every waiter on it wakes once. Each call gets a
 * unique token, so two notifiers racing can never cancel each other out.
 */
export function notifyChange(endpoint, { env = process.env, dir = defaultSharedDir(env), source = 'event', now = Date.now } = {}) {
  mkdirSync(dir, { recursive: true })
  const f = files(endpoint, env, dir)
  const token = `${now()}-${process.pid}-${randomBytes(6).toString('hex')}`
  const staging = `${f.events}.${token}.tmp`
  try {
    writeFileSync(staging, JSON.stringify({ token, source: String(source), at: new Date(now()).toISOString() }))
    renameSync(staging, f.events)
  } finally {
    rmSync(staging, { force: true })
  }
  return token
}

function transientReadFailure(error) {
  return Boolean(error?.transientTransport || (error?.name === 'SharedReadError' && /did not finish/.test(error.message)))
}

/**
 * Block until `endpoint` changes after `since` (a watchCursor() value), or until
 * `timeoutMs` passes. Returns { reason: 'event' | 'changed' | 'timeout', cursor, polls }.
 * Pass the returned cursor back in to wait for the next change: each change wakes
 * a waiter once.
 */
export function waitForChange(endpoint, {
  since,
  timeoutMs,
  baseMs = 30000,
  windowMs = 5000,
  checkMs = 1000,
  env = process.env,
  dir = defaultSharedDir(env),
  read = sharedConditionalGet,
  wait = sleepSync,
  now = Date.now,
  random = Math.random,
} = {}) {
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) < 0) throw new Error('waitForChange requires a finite timeoutMs')
  if (!Number.isFinite(Number(windowMs)) || Number(windowMs) <= 0) throw new Error('waitForChange requires a positive windowMs')
  if (!Number.isFinite(Number(baseMs)) || Number(baseMs) < 0) throw new Error('waitForChange requires a non-negative baseMs')
  if (!Number.isFinite(Number(checkMs)) || Number(checkMs) <= 0) throw new Error('waitForChange requires a positive checkMs')
  mkdirSync(dir, { recursive: true })
  const start = merge(null, since ?? watchCursor(endpoint, { env, dir }))
  const deadline = now() + Number(timeoutMs)
  // Every scheduled poll is strictly in the future, so a zero delay still sleeps.
  const align = (at) => Math.max(Math.ceil(at / windowMs) * windowMs, now() + 1)
  let nextPollAt = align(now() + baseMs)
  let failures = 0
  let polls = 0
  for (;;) {
    const seen = watchCursor(endpoint, { env, dir })
    const cursor = merge(start, seen)
    if (seen.event !== null && seen.event !== start.event) return { reason: 'event', cursor, polls }
    if (seen.generation !== null && seen.generation !== start.generation) return { reason: 'changed', cursor, polls }
    const current = now()
    if (current >= deadline) return { reason: 'timeout', cursor, polls }
    if (current >= nextPollAt) {
      polls += 1
      try {
        const result = read(endpoint, { env, dir, now })
        failures = 0
        nextPollAt = align(now() + pollDelayMs({ baseMs, pollIntervalHeaderMs: result?.pollIntervalMs }))
      } catch (error) {
        if (!transientReadFailure(error)) throw error
        failures += 1
        nextPollAt = align(now() + pollDelayMs({ baseMs, failures, random }))
      }
      continue
    }
    wait(Math.max(1, Math.min(checkMs, nextPollAt - current, deadline - current)))
  }
}
