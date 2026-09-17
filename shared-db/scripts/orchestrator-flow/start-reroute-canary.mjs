#!/usr/bin/env node
// Live proof harness for start reroute (issue #3027, programme ai-devops#401 Step 7).
//
//   node scripts/orchestrator-flow/start-reroute-canary.mjs --run [--repo r] [--healthy-hold 900]
//
// It dispatches two canary runs of start-reroute-canary.yml at the current main head:
//   healthy - on a registered lane, held longer than the 10-minute start SLO once running;
//   staged  - on the one label no runner serves, so it never starts (the staged non-start).
// It then polls both through runnerStartDecision (start-reroute.mjs). The healthy run must stay
// keep-active and is never cancelled. When the staged run crosses the SLO, the reroute is
// reserved create-only under refs/db-start-reroutes, dispatched once through
// dispatchQueuedReroute onto an independent qualified lane, and the replacement's result is
// accepted through acceptRunnerResult. The staged original is cancelled only after that, and it
// is the only run the harness ever cancels.
//
// It also replays the reviewer non-start decision offline (confirmed-not-started reroutes, a
// started review is kept). The final JSON is the evidence.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { loadRegistry } from './runner-lanes.mjs'
import { START_SLO_MS, acceptRunnerResult, createDurableStartRerouteAdapter, dispatchQueuedReroute, reserveRunnerReroute, reviewerStartDecision, runnerStartDecision } from './start-reroute.mjs'
import { runGitHubCommand } from '../lib/github-transport.mjs'
import { currentRepository } from '../lib/repository-identity.mjs'

export const WORKFLOW = 'start-reroute-canary.yml'
export const STAGED_LABEL = 'db-staged-non-start-canary'
export const ASSERTION = 'start-reroute-canary'
export const CANARY_JOB = 'canary'
// Git refs are files: once refs/x exists, refs/x/child can never be created (HTTP 422). Dispatch
// claim and ack refs are therefore siblings of the reservation ref, never children of it.
export const dispatchSubref = (ref, kind) => `${ref}--${kind}`

/** The staging hook's only admissible labels: a registered lane or the staged non-start label. */
export function canaryLabelAllowed(label, registry = loadRegistry()) {
  return label === STAGED_LABEL || registry.lanes.some((lane) => lane.label === label)
}

export function qualifiedCanaryLanes(registry = loadRegistry()) {
  return registry.lanes.filter((lane) => lane.qualified === true).map((lane) => ({ name: lane.label, qualified: true, assertions: [ASSERTION] }))
}

/** Lifecycle events for runnerStartDecision from the canary job of one run. */
export function lifecycleFromJob(attemptId, job) {
  if (!job) return []
  return job.started_at && job.status !== 'queued' && job.status !== 'waiting' && job.runner_name ? [{ attempt_id: attemptId, type: 'runner_started', at: job.started_at }] : []
}

export function reviewerReplay(now = new Date().toISOString()) {
  const head = 'a'.repeat(40), assigned = new Date(Date.parse(now) - START_SLO_MS - 60000).toISOString()
  const notStarted = reviewerStartDecision({ id: 'staged-reviewer', head_sha: head, assigned_at: assigned }, { now, provider_state: 'confirmed-not-started', lifecycle: [] })
  const healthy = reviewerStartDecision({ id: 'healthy-reviewer', head_sha: head, assigned_at: assigned }, { now, provider_state: 'usable', lifecycle: [{ assignment_id: 'healthy-reviewer', type: 'review_started', at: assigned, source: 'durable-lifecycle' }] })
  return { staged_non_start: notStarted.action, healthy_started_review: healthy.action }
}

export async function runCanary({ io, now = () => new Date().toISOString(), sleep, pollMs = 20000, healthyHold = 900, deadlineMs = 40 * 60000, registry = loadRegistry() }) {
  const stamp = Date.parse(now()).toString(36)
  const head = io.mainSha()
  const lanes = qualifiedCanaryLanes(registry)
  const healthy = { id: `healthy-${stamp}`, workflow: WORKFLOW, lane: lanes[0].name, head_sha: head, required_assertions: [ASSERTION] }
  const staged = { id: `staged-${stamp}`, workflow: WORKFLOW, lane: STAGED_LABEL, head_sha: head, required_assertions: [ASSERTION] }
  io.dispatch({ attempt_id: healthy.id, runner_label: healthy.lane, hold_seconds: String(healthyHold) })
  io.dispatch({ attempt_id: staged.id, runner_label: staged.lane, hold_seconds: '30' })
  const evidence = { head_sha: head, slo_ms: START_SLO_MS, healthy: { id: healthy.id, decisions: [] }, staged: { id: staged.id, decisions: [] }, cancelled: [] }
  const started = Date.parse(now())
  let reroute = null, replacement = null
  const observe = (attempt) => {
    const run = io.findRun(attempt.id)
    const job = run ? io.canaryJob(run.id) : null
    return { run, job }
  }
  while (Date.parse(now()) - started < deadlineMs) {
    const h = observe(healthy), s = observe(staged)
    if (h.job && !healthy.queued_at) { healthy.queued_at = h.job.created_at; evidence.healthy.run_url = h.run.html_url }
    if (s.job && !staged.queued_at) { staged.queued_at = s.job.created_at; evidence.staged.run_url = s.run.html_url }
    if (healthy.queued_at) {
      const d = runnerStartDecision(healthy, { now: now(), lifecycle: lifecycleFromJob(healthy.id, h.job), qualified_lanes: lanes })
      if (evidence.healthy.decisions.at(-1)?.action !== d.action) evidence.healthy.decisions.push({ at: now(), action: d.action })
      evidence.healthy.status = h.job.status; evidence.healthy.conclusion = h.job.conclusion
    }
    if (staged.queued_at && !reroute) {
      const lifecycle = lifecycleFromJob(staged.id, s.job)
      const d = runnerStartDecision(staged, { now: now(), lifecycle, qualified_lanes: lanes })
      if (evidence.staged.decisions.at(-1)?.action !== d.action) evidence.staged.decisions.push({ at: now(), action: d.action })
      if (d.action === 'keep-active') throw new Error('the staged non-start unexpectedly started; the staging hook is not isolated')
      if (d.action === 'dispatch-new-run') {
        const replacementId = `replacement-${staged.id}`
        const adapter = createDurableStartRerouteAdapter({ ...io.durable, readLive: () => { const fresh = observe(staged); return { now: now(), lifecycle: lifecycleFromJob(staged.id, fresh.job), qualified_lanes: lanes } } })
        reroute = reserveRunnerReroute(staged, d, { id: replacementId }, adapter)
        reroute.reserved_at = now()
        reroute.ack = dispatchQueuedReroute(reroute.ref, { ...io.durable, dispatchReplacement: (rerouteId, record) => { io.dispatch({ attempt_id: record.replacement_id, runner_label: record.lane, hold_seconds: '30' }); return { reroute_id: rerouteId, replacement_id: record.replacement_id, status: 'created' } } })
        reroute.dispatched_at = now(); reroute.lane = d.lane
        replacement = { id: replacementId }
      }
    }
    if (replacement) {
      const r = observe(replacement)
      if (r.job) { replacement.status = r.job.status; replacement.conclusion = r.job.conclusion; replacement.started_at = r.job.started_at; replacement.run_url = r.run.html_url; replacement.runner = r.job.runner_name }
    }
    const healthyDone = evidence.healthy.status === 'completed'
    if (healthyDone && replacement?.status === 'completed') break
    await sleep(pollMs)
  }
  if (replacement?.conclusion === 'success') {
    const assertions = [{ name: ASSERTION, result: 'passed' }]
    const identity = { attempt_id: replacement.id, supersedes_attempt_id: staged.id, reroute_id: reroute.reroute_id, workflow: WORKFLOW, lane: reroute.lane, head_sha: head, assertions }
    evidence.accepted = acceptRunnerResult({ ...identity, result_digest: sha256(canonicalJson(identity)) }, staged, { ...io.durable, readReroute: (ref) => { const pair = io.durable.readPair(ref); return pair ? { digest: pair.digest, record: pair.record } : null } })
  }
  const stagedRun = io.findRun(staged.id)
  if (evidence.accepted && stagedRun && stagedRun.status !== 'completed') { io.cancel(stagedRun.id); evidence.cancelled.push({ run: stagedRun.html_url, why: 'staged non-start superseded by the accepted replacement' }) }
  const queuedMs = Date.parse(staged.queued_at)
  evidence.reroute = reroute && { ref: reroute.ref, reroute_id: reroute.reroute_id, lane: reroute.lane, dispatch: reroute.ack?.dispatch_status, reserved_after_ms: Date.parse(reroute.reserved_at) - queuedMs, replacement_started_after_ms: replacement?.started_at ? Date.parse(replacement.started_at) - queuedMs : null }
  evidence.replacement = replacement
  evidence.reviewer_replay = reviewerReplay(now())
  evidence.verdict = Boolean(evidence.accepted && evidence.healthy.conclusion === 'success' && evidence.healthy.decisions.every((d) => d.action !== 'dispatch-new-run') && evidence.cancelled.length <= 1 && evidence.reroute.reserved_after_ms >= START_SLO_MS && evidence.reroute.reserved_after_ms <= START_SLO_MS + 2 * pollMs + 60000) ? 'PASS' : 'FAIL'
  return evidence
}

// ---------------------------------------------------------------- live GitHub adapter

export function liveIo(repo) {
  const api = (args, opts = {}) => runGitHubCommand(['api', ...args], opts)
  const json = (args) => JSON.parse(api(args) || 'null')
  const refRead = (ref) => { try { const r = json([`repos/${repo}/git/ref/${ref.replace(/^refs\//, '')}`]); return JSON.parse(json([`repos/${repo}/git/commits/${r.object.sha}`]).message) } catch (error) { if (/Not Found|404/.test(String(error.message ?? error))) return null; throw error } }
  const refCreate = (ref, value) => {
    const main = json([`repos/${repo}/git/ref/heads/main`]).object.sha
    const tree = json([`repos/${repo}/git/commits/${main}`]).tree.sha
    const commit = json(['-X', 'POST', `repos/${repo}/git/commits`, '-f', `message=${canonicalJson(value)}`, '-f', `tree=${tree}`, '-f', `parents[]=${main}`]).sha
    try { api(['-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=${ref}`, '-f', `sha=${commit}`]); return true } catch (error) {
      // Create-only: a ref that now exists means another writer won; the caller re-reads it.
      if (refRead(ref) !== null) return false
      throw error
    }
  }
  let dispatchedSince = new Date(Date.now() - 60000).toISOString()
  return {
    mainSha: () => json([`repos/${repo}/git/ref/heads/main`]).object.sha,
    dispatch: (inputs) => api(['-X', 'POST', `repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, '-f', 'ref=main', ...Object.entries(inputs).flatMap(([k, v]) => ['-f', `inputs[${k}]=${v}`])]),
    findRun: (attemptId) => (json([`repos/${repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&created=>=${dispatchedSince}&per_page=50`])?.workflow_runs ?? []).find((run) => run.display_title.startsWith(`start-reroute-canary ${attemptId} on `)) ?? null,
    canaryJob: (runId) => (json([`repos/${repo}/actions/runs/${runId}/jobs`])?.jobs ?? []).find((job) => job.name === CANARY_JOB) ?? null,
    cancel: (runId) => api(['-X', 'POST', `repos/${repo}/actions/runs/${runId}/cancel`]),
    durable: {
      withMutex: (fn) => fn(),
      readPair: (ref) => refRead(ref),
      compareCreatePair: (ref, _expected, pair) => refCreate(ref, pair),
      readLive: () => { throw new Error('readLive is bound by the harness') },
      readDispatchAck: (ref) => refRead(dispatchSubref(ref, 'dispatch-ack')),
      readDispatchClaim: (ref) => refRead(dispatchSubref(ref, 'dispatch-claim')),
      compareCreateDispatchClaim: (ref, claim) => refCreate(dispatchSubref(ref, 'dispatch-claim'), claim),
      compareCreateDispatchAck: (ref, ack) => refCreate(dispatchSubref(ref, 'dispatch-ack'), ack),
      readReroute: (ref) => { const pair = refRead(ref); return pair ? { digest: pair.digest, record: pair.record } : null },
      createAccepted: (ref, digest, result) => refCreate(ref, { digest, result }),
      readAccepted: (ref) => refRead(ref),
    },
  }
}

export async function main(argv = process.argv.slice(2)) {
  const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  if (argv.includes('--check-label')) {
    if (canaryLabelAllowed(value('--check-label'))) return 0
    console.error('label is not a registered lane or the staged non-start label'); return 1
  }
  if (!argv.includes('--run')) { console.error('usage: --run [--repo owner/name] [--healthy-hold seconds] | --check-label LABEL'); return 2 }
  const repo = currentRepository(value('--repo'))
  const evidence = await runCanary({ io: liveIo(repo), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), healthyHold: Number(value('--healthy-hold') ?? 900) })
  console.log(JSON.stringify(evidence, null, 2))
  return evidence.verdict === 'PASS' ? 0 : 1
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = await main()
