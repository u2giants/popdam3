#!/usr/bin/env node
// Preflight: is there enough GitHub API quota left for this job's heavy reads?
//
// The Actions installation token shares one hourly REST budget across every
// workflow run. When it ran out mid-job, checks failed with raw "API rate limit
// exceeded" errors that read like real guard refusals. This step asks first.
//
// It must NOT trust the `rate_limit` endpoint for the Actions token (#3699,
// 2026-09-28): that endpoint answered "5000 of 5000 left" and the very next
// REST call 0.3s later was refused "API rate limit exceeded for installation".
// The endpoint reports a fresh per-token view; the limit GitHub actually
// enforces on GITHUB_TOKEN is the shared per-repository installation budget.
// So the probe is one real, cheap REST read (the repository) and the answer is
// taken from that response's x-ratelimit-* headers -- the bucket that is really
// charged. It costs one request, which is the price of a true answer.
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

// Parse x-ratelimit-* headers from a `gh api -i` response.
export function quotaFromHeaders(raw) {
  const text = String(raw ?? '').replace(/\r\n/g, '\n')
  const boundary = text.indexOf('\n\n')
  if (!/^HTTP\//.test(text) || boundary < 0) return null
  const headers = new Map()
  for (const line of text.slice(0, boundary).split('\n').slice(1)) {
    const at = line.indexOf(':')
    if (at > 0) headers.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim())
  }
  const num = (name) => (/^\d+$/.test(headers.get(name) ?? '') ? Number(headers.get(name)) : null)
  const remaining = num('x-ratelimit-remaining')
  const reset = num('x-ratelimit-reset')
  if (remaining === null || reset === null) return { readable: false, why: 'response carries no x-ratelimit-remaining/reset headers' }
  return { readable: true, remaining, limit: num('x-ratelimit-limit'), reset, resource: headers.get('x-ratelimit-resource') ?? 'core' }
}

// A refused probe is itself the answer: the charged bucket is empty.
const EXHAUSTED = /rate limit exceeded/i

export function readQuota(read) {
  let raw
  try {
    raw = read()
  } catch (error) {
    const text = String(error?.stderr ?? error?.message ?? error)
    if (EXHAUSTED.test(text)) {
      // The refused response's own headers state the real bucket's reset.
      const refused = quotaFromHeaders(error?.stdout)
      if (refused?.readable) return { ...refused, remaining: Math.min(refused.remaining, 0) }
      return { readable: true, remaining: 0, limit: null, reset: null, why: text.split('\n').find((l) => EXHAUSTED.test(l)) }
    }
    return { readable: false, why: error.message }
  }
  const fromHeaders = quotaFromHeaders(raw)
  if (fromHeaders) return fromHeaders
  let payload
  try {
    payload = JSON.parse(raw)
  } catch (error) {
    return { readable: false, why: error.message }
  }
  const core = payload?.resources?.core
  if (!Number.isInteger(core?.remaining) || !Number.isInteger(core?.reset)) return { readable: false, why: 'rate_limit response has no core remaining/reset' }
  return { readable: true, remaining: core.remaining, limit: core.limit, reset: core.reset }
}

export function checkQuota({
  read = () => runGitHubCommand(
    ['api', '-i', process.env.GITHUB_REPOSITORY ? `repos/${process.env.GITHUB_REPOSITORY}` : 'rate_limit'],
    { maxRateLimitWaitMs: 0, attempts: 1, quotaLatch: null },
  ),
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
    if (quota.reset === null) {
      return { ok: false, message: `installation quota low: the GitHub API refused the quota probe itself (${quota.why}); reset time not stated. Re-run this job later. No pull request check was evaluated.` }
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
