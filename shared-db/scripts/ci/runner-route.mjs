#!/usr/bin/env node
// Self-hosted Linux runner router (edge-dev3-linux).
//
// Owner request (Albert, 2026-10-07): "point the checks at it. and set it up as
// a runner for shared-db as well". Routed jobs run on the self-hosted runner
// labelled shared-db-linux ONLY when it is proven online and idle right now;
// every other outcome -- fork pull request, absent or stale heartbeat, busy or
// offline runner, malformed input, or this script failing -- returns the job's
// existing hosted label, so no merge ever depends on one machine.
//
// The heartbeat is the repository variable SHARED_DB_LINUX_RUNNER_HEARTBEAT,
// written every minute by scripts/ci/edge-runner-heartbeat.sh on the runner host
// as "<online|offline>,<idle|busy>,<unix-seconds>". GITHUB_TOKEN cannot list
// self-hosted runners, so the host reports its own state; a dead host stops
// writing and its heartbeat goes stale, which routes everything back to hosted.
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const SELF_HOSTED = ['self-hosted', 'Linux', 'X64', 'shared-db-linux']
export const MAX_HEARTBEAT_AGE_SECONDS = 150

export function decideRunner({ eventName, headRepo, repository, heartbeat, fallback, nowSeconds }) {
  const fb = { runsOn: fallback, reason: '' }
  if (!fallback) throw new Error('fallback label is required')
  if (eventName === 'pull_request_target') return { ...fb, reason: 'pull_request_target never routes to self-hosted' }
  if (eventName === 'pull_request' && headRepo !== repository) return { ...fb, reason: 'fork pull request never routes to self-hosted' }
  const m = /^(online|offline),(idle|busy),(\d{9,11})$/.exec(String(heartbeat ?? '').trim())
  if (!m) return { ...fb, reason: 'no valid runner heartbeat' }
  const age = nowSeconds - Number(m[3])
  if (age > MAX_HEARTBEAT_AGE_SECONDS || age < -60) return { ...fb, reason: `heartbeat is stale (${age}s old)` }
  if (m[1] !== 'online') return { ...fb, reason: 'runner offline' }
  if (m[2] !== 'idle') return { ...fb, reason: 'runner busy' }
  return { runsOn: SELF_HOSTED, reason: `runner online and idle (heartbeat ${age}s old)` }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env
  const fallback = env.FALLBACK_LABEL || 'ubuntu-latest'
  let out
  try {
    out = decideRunner({
      eventName: env.EVENT_NAME,
      headRepo: env.HEAD_REPO,
      repository: env.REPOSITORY,
      heartbeat: env.HEARTBEAT,
      fallback,
      nowSeconds: Math.floor(Date.now() / 1000),
    })
  } catch (error) {
    out = { runsOn: fallback, reason: `router error: ${error.message}` }
  }
  console.log(`runs-on: ${JSON.stringify(out.runsOn)} -- ${out.reason}`)
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `runs_on=${JSON.stringify(out.runsOn)}\n`)
}
