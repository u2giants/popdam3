#!/usr/bin/env node
// Bounded wait for the exclusive merge lane (merge-queue Queue interlock).
//
// WHY THIS EXISTS. `manage-migration-author-lanes.mjs --acquire-merge` tries the
// create-only ref refs/db-coordination/merge exactly once. When another PR's
// queue run (or a guarded merge) is holding that lane through its own mutation,
// the attempt refuses with "refs/db-coordination/merge is occupied" and the
// group is ejected from the queue -- 15+ ejections on 2026-10-26/27 alone
// (PR #4934 twice, behind #4912 and #4938). The holder normally releases within
// minutes, so the queue should wait for it instead of failing.
//
// SAFETY. This wrapper never touches a ref itself. Every attempt is a complete,
// fresh run of the unchanged `--acquire-merge` CLI: new owner commit, author
// mutex, admission, live head, claims, main freshness, production lane and
// promotion-freeze checks, then the atomic create-only ref. Only the single
// refusal "refs/db-coordination/merge is occupied" is retried; every other
// refusal (production active, freeze, head moved, mutex stuck, ...) fails on
// the first attempt exactly as before. The wait is bounded by --wait-seconds.
//
// Usage: acquire-merge-lane-waiting.mjs [--wait-seconds N] [--poll-seconds N] -- --acquire-merge <args...>
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const OCCUPIED = /refs\/db-coordination\/merge is occupied/

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

export function runCli(args) {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'manage-migration-author-lanes.mjs')
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') }
}

export function acquireMergeLaneWaiting(args, { waitSeconds = 900, pollSeconds = 15, run = runCli, wait = sleep, now = () => Date.now(), log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  if (args[0] !== '--acquire-merge') throw new Error('acquire-merge-lane-waiting only wraps --acquire-merge')
  const start = now(), deadline = start + waitSeconds * 1000
  for (let attempt = 1; ; attempt++) {
    const result = run(args)
    const elapsed = Math.round((now() - start) / 1000)
    if (result.status === 0) {
      if (attempt > 1) log(`merge lane acquired on attempt ${attempt} after waiting ${elapsed}s`)
      return { ...result, attempts: attempt, waitedSeconds: elapsed }
    }
    const holder = result.stderr.split('\n').find((line) => OCCUPIED.test(line))
    if (!holder) return { ...result, attempts: attempt, waitedSeconds: elapsed }
    if (now() + pollSeconds * 1000 > deadline) {
      log(`REFUSED: merge lane still occupied after waiting ${elapsed}s (budget ${waitSeconds}s, ${attempt} attempts); last holder: ${holder.trim()}`)
      return { ...result, attempts: attempt, waitedSeconds: elapsed }
    }
    log(`merge lane busy (attempt ${attempt}, waited ${elapsed}s of ${waitSeconds}s); retrying in ${pollSeconds}s; ${holder.trim()}`)
    wait(pollSeconds * 1000)
  }
}

function main(argv) {
  const sep = argv.indexOf('--')
  if (sep < 0) { process.stderr.write('usage: acquire-merge-lane-waiting.mjs [--wait-seconds N] [--poll-seconds N] -- --acquire-merge ...\n'); return 2 }
  const own = argv.slice(0, sep), opts = {}
  for (let i = 0; i < own.length; i += 2) {
    const value = Number(own[i + 1])
    if (!Number.isInteger(value) || value < 0) { process.stderr.write(`invalid value for ${own[i]}\n`); return 2 }
    if (own[i] === '--wait-seconds') opts.waitSeconds = value
    else if (own[i] === '--poll-seconds') opts.pollSeconds = Math.max(1, value)
    else { process.stderr.write(`unknown option ${own[i]}\n`); return 2 }
  }
  let result
  try { result = acquireMergeLaneWaiting(argv.slice(sep + 1), opts) } catch (error) { process.stderr.write(`${error.message}\n`); return 2 }
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  return result.status
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
