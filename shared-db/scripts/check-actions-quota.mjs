#!/usr/bin/env node
// Preflight: is there enough GitHub API quota left for this job's heavy reads?
//
// The Actions installation token shares one hourly REST budget across every
// workflow run. When it ran out mid-job, checks failed with raw "API rate limit
// exceeded" errors that read like real guard refusals. This step asks first,
// using the `rate_limit` endpoint, which does not count against the quota.
//
//   remaining >= ACTIONS_QUOTA_MIN_REMAINING (default 200)  -> continue
//   below it, reset within the opted-in cap                 -> wait, then re-check once
//     (GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS, at most 900; unset or 0 means never wait)
//   below it, reset further away, or unreadable             -> fail with a clear
//                                                              "installation quota low"
//
// It decides nothing about the pull request. It only stops a job from starting
// work it cannot finish, and names the real cause when that happens.

import { pathToFileURL } from 'node:url'
import { rateLimitMaxWaitMs, runGitHubCommand } from './lib/github-transport.mjs'

export const DEFAULT_MIN_REMAINING = 200

export function minRemaining(env = process.env) {
  const raw = env.ACTIONS_QUOTA_MIN_REMAINING
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_MIN_REMAINING
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MIN_REMAINING
}

export function readQuota(read) {
  let payload
  try {
    payload = JSON.parse(read())
  } catch (error) {
    return { readable: false, why: error.message }
  }
  const core = payload?.resources?.core
  if (!Number.isInteger(core?.remaining) || !Number.isInteger(core?.reset)) return { readable: false, why: 'rate_limit response has no core remaining/reset' }
  return { readable: true, remaining: core.remaining, limit: core.limit, reset: core.reset }
}

export function checkQuota({
  read = () => runGitHubCommand(['api', 'rate_limit'], { maxRateLimitWaitMs: 0 }),
  wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now = Date.now,
  env = process.env,
  log = console.log,
} = {}) {
  const floor = minRemaining(env)
  const maxWaitMs = rateLimitMaxWaitMs(env)
  for (let pass = 0; pass < 2; pass += 1) {
    const quota = readQuota(read)
    if (!quota.readable) return { ok: false, message: `installation quota low or unknown: could not read the remaining GitHub API quota (${quota.why}). Refusing to start work that may not finish.` }
    if (quota.remaining >= floor) {
      log(`GitHub API quota: ${quota.remaining} of ${quota.limit} requests left; continuing.`)
      return { ok: true, remaining: quota.remaining }
    }
    const delay = quota.reset * 1000 - now()
    const resetAt = new Date(quota.reset * 1000).toISOString()
    if (pass === 0 && maxWaitMs > 0 && delay <= maxWaitMs) {
      log(`GitHub API quota: only ${quota.remaining} requests left (floor ${floor}); waiting ${Math.ceil(Math.max(delay, 0) / 1000)}s for the reset at ${resetAt}.`)
      wait(Math.max(delay, 0) + 1000)
      continue
    }
    return {
      ok: false,
      message: `installation quota low: ${quota.remaining} GitHub API requests left (this job needs at least ${floor}); the quota resets at ${resetAt}. Re-run this job after that time. No pull request check was evaluated.`,
    }
  }
  return { ok: false, message: 'installation quota low: the quota was still below the floor after waiting for its reset.' }
}

function main() {
  const result = checkQuota()
  if (result.ok) return 0
  console.error(`::error::${result.message}`)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main())
