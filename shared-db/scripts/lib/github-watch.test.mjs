// Issue #2773: the event-aware watcher wakes every waiter once per change and its
// fallback polls a bounded number of times without busy-looping.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { notifyChange, waitForChange, watchCursor } from './github-watch.mjs'
import { sharedReadKey } from './github-conditional.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const moduleUrl = pathToFileURL(path.join(here, 'github-watch.mjs')).href
const ENDPOINT = 'repos/o/r/pulls/1'
const env = { GH_REPO: 'o/r' }

test('one notify wakes each of 10 waiting processes exactly once with no upstream read', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-watch-'))
  try {
    const script = `
      import { appendFileSync, writeFileSync } from 'node:fs'
      import { waitForChange, watchCursor } from ${JSON.stringify(moduleUrl)}
      const dir = process.argv[1], env = { GH_REPO: 'o/r' }
      let cursor = watchCursor(${JSON.stringify(ENDPOINT)}, { env, dir })
      writeFileSync(dir + '/ready-' + process.pid, '')
      const read = () => { appendFileSync(dir + '/reads.log', 'x'); return {} }
      for (let i = 0; i < 2; i++) {
        const r = waitForChange(${JSON.stringify(ENDPOINT)}, { since: cursor, env, dir, read, timeoutMs: i ? 1500 : 60000, baseMs: 3600000, checkMs: 50 })
        console.log(r.reason)
        cursor = r.cursor
      }`
    const children = Array.from({ length: 10 }, () => spawn(process.execPath, ['--input-type=module', '-e', script, dir], { stdio: ['ignore', 'pipe', 'pipe'] }))
    const outputs = children.map((child) => new Promise((resolve) => {
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('close', (code) => resolve({ code, out }))
    }))
    const deadline = Date.now() + 30000
    while (children.some((c) => !existsSync(path.join(dir, `ready-${c.pid}`)))) {
      assert.ok(Date.now() < deadline, 'waiters did not start')
      await new Promise((r) => setTimeout(r, 50))
    }
    await new Promise((r) => setTimeout(r, 200))
    notifyChange(ENDPOINT, { env, dir, source: 'webhook' })
    for (const { code, out } of await Promise.all(outputs)) {
      assert.equal(code, 0, out)
      assert.deepEqual(out.trim().split(/\r?\n/), ['event', 'timeout'])
    }
    assert.equal(existsSync(path.join(dir, 'reads.log')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function clock() {
  let t = 1_000_000
  const waits = []
  return { now: () => t, wait: (ms) => { waits.push(ms); t += ms }, waits, advance: (ms) => { t += ms } }
}

test('with no event, the fallback poll detects a change with bounded reads and sleeps between checks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-watch-'))
  try {
    const c = clock()
    const stateFile = path.join(dir, `${sharedReadKey(ENDPOINT, env)}.state.json`)
    writeFileSync(stateFile, JSON.stringify({ generation: 1, body: '{}' }))
    let reads = 0
    const read = () => {
      reads += 1
      if (reads === 3) writeFileSync(stateFile, JSON.stringify({ generation: 2, body: '{"x":1}' }))
      return { pollIntervalMs: 0 }
    }
    const since = watchCursor(ENDPOINT, { env, dir })
    const result = waitForChange(ENDPOINT, { since, env, dir, read, now: c.now, wait: c.wait, timeoutMs: 600000, baseMs: 30000, checkMs: 1000 })
    assert.equal(result.reason, 'changed')
    assert.equal(reads, 3)
    assert.equal(result.polls, 3)
    assert.ok(c.waits.every((ms) => ms >= 1 && ms <= 1000))
    assert.ok(c.waits.length <= 100, `slept ${c.waits.length} times`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('x-poll-interval stretches the fallback and failed reads back off; timeout never claims a change', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-watch-'))
  try {
    const c = clock()
    const at = []
    let n = 0
    const read = () => {
      at.push(c.now())
      n += 1
      if (n === 1) return { pollIntervalMs: 120000 }
      const error = new Error('502'); error.transientTransport = true; throw error
    }
    const result = waitForChange(ENDPOINT, { env, dir, read, now: c.now, wait: c.wait, random: () => 0, timeoutMs: 400000, baseMs: 30000, checkMs: 5000 })
    assert.equal(result.reason, 'timeout')
    assert.ok(at[1] - at[0] >= 120000, 'x-poll-interval honoured')
    assert.ok(at[2] - at[1] >= 30000 && at[3] - at[2] >= 60000, 'failures back off')
    assert.ok(at.length <= 5)
    assert.throws(() => waitForChange(ENDPOINT, { env, dir, read: () => { throw new Error('bad') }, now: c.now, wait: c.wait, timeoutMs: 100000, baseMs: 0 }), /bad/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable or vanished event or state file never wakes a waiter, and a token wakes once', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-watch-'))
  try {
    const c = clock()
    const key = sharedReadKey(ENDPOINT, env)
    const events = path.join(dir, `${key}.events.json`), state = path.join(dir, `${key}.state.json`)
    writeFileSync(state, JSON.stringify({ generation: 4, body: '{}' }))
    notifyChange(ENDPOINT, { env, dir })
    const since = watchCursor(ENDPOINT, { env, dir })
    let checks = 0
    const wait = (ms) => {
      c.wait(ms)
      checks += 1
      if (checks === 2) { rmSync(events); writeFileSync(state, '{partial') }
      if (checks === 4) { writeFileSync(events, JSON.stringify({ token: since.event })); writeFileSync(state, JSON.stringify({ generation: 4, body: '{}' })) }
    }
    const result = waitForChange(ENDPOINT, { since, env, dir, read: () => ({}), now: c.now, wait, timeoutMs: 10000, baseMs: 3600000, checkMs: 1000 })
    assert.equal(result.reason, 'timeout')
    assert.deepEqual(result.cursor, since)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('zero delays still sleep between polls and invalid windows are refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-watch-'))
  try {
    const c = clock()
    let reads = 0
    const result = waitForChange(ENDPOINT, { env, dir, read: () => { reads += 1; return {} }, now: c.now, wait: c.wait, timeoutMs: 50, baseMs: 0, windowMs: 1, checkMs: 1 })
    assert.equal(result.reason, 'timeout')
    assert.ok(c.waits.length >= reads && reads <= 51, `reads ${reads}, sleeps ${c.waits.length}`)
    for (const windowMs of [0, -1, Number.NaN]) {
      assert.throws(() => waitForChange(ENDPOINT, { env, dir, now: c.now, wait: c.wait, timeoutMs: 10, windowMs }), /windowMs/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
