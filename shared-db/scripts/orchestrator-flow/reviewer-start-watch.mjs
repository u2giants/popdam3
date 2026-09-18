#!/usr/bin/env node
// Reviewer start watcher (issue #3027, programme popcre/ai-devops#401 Step 7).
//
//   node scripts/orchestrator-flow/reviewer-start-watch.mjs [--apply --drawn-since <ISO>] [--repo owner/name]
//
// Every reviewer lease is read through the lane manager (--reviewer-start-watch-leases).
// run-governed-review.mjs writes a durable refs/db-review-started marker before it launches a
// provider. A lease with its own marker is a started review and is kept (reviewerStartDecision
// -> keep-active); it is never touched here. PR-wide CI or another slot's activity never counts
// as this reviewer starting. A lease older than the 10-minute start SLO without its own marker
// is a confirmed non-start; unreadable evidence is skipped, never treated as started or not. With --apply it is reserved
// create-only under refs/db-start-reroutes/reviewer/<id> (reserveReviewerReroute), then
// dispatched exactly once (dispatchQueuedReroute): the slot is returned through the existing
// governed silence path in its unstarted mode (probe, reclaim) and the next eligible provider
// is drawn with --replace-failed-reviewer --failure-code silent_worker_observed.
// Without --apply it only prints decisions.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { START_SLO_MS, createDurableStartRerouteAdapter, dispatchQueuedReroute, reserveReviewerReroute, reviewerStartDecision } from './start-reroute.mjs'
import { dispatchSubref, liveIo as canaryLiveIo } from './start-reroute-canary.mjs'
import { runGitHubCommand } from '../lib/github-transport.mjs'
import { currentRepository } from '../lib/repository-identity.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MANAGER = path.resolve(HERE, '..', 'manage-migration-author-lanes.mjs')
export const REPLACEMENT_PROVIDER = 'next-eligible'

export function assignmentForLease(row) {
  return { id: `review-${row.issue}-${row.pr}-seq${row.sequence}-slot${row.slot}`, head_sha: String(row.headSha).toLowerCase(), assigned_at: row.heldSinceIso }
}

const unread = (value) => value === null || value === undefined

/** Decision for one lease row. Unreadable or ambiguous evidence always leaves the lease alone. */
export function leaseStartDecision(row, now) {
  const assignment = assignmentForLease(row)
  if (row.stale) return { assignment, decision: { action: 'skip', reason: 'stale lease belongs to the ordinary reaper' } }
  if (!row.heldSinceIso || !Number.isFinite(Date.parse(row.heldSinceIso))) return { assignment, decision: { action: 'skip', reason: 'lease draw time is unreadable' } }
  const overdue = Date.parse(now) - Date.parse(row.heldSinceIso) >= START_SLO_MS
  if (!overdue) return { assignment, decision: reviewerStartDecision(assignment, { now, provider_state: 'usable', lifecycle: [] }) }
  if (row.error || unread(row.started) || unread(row.verdictPresent) || !row.lastActivityIso) return { assignment, decision: { action: 'skip', reason: `start evidence is unreadable: ${row.error ?? 'not read'}` } }
  if (row.verdictPresent) return { assignment, decision: { action: 'skip', reason: 'a verdict exists for this head' } }
  const lifecycle = []
  if (row.started) lifecycle.push({ assignment_id: assignment.id, type: 'review_started', at: row.heldSinceIso, source: 'durable-start-marker' })
  return { assignment, decision: reviewerStartDecision(assignment, { now, provider_state: lifecycle.length ? 'usable' : 'confirmed-not-started', lifecycle }) }
}

export function managerArgs(step, row) {
  const base = ['--issue', String(row.issue), '--pr', String(row.pr), '--head-sha', row.headSha, '--failed-sequence', String(row.sequence), '--review-slot', String(row.slot)]
  if (step === 'probe') return ['--probe-silent-reviewer', '--unstarted', ...base]
  if (step === 'reclaim') return ['--reclaim-silent-reviewer', '--unstarted', '--confirm-no-verdict', '--confirm-no-artifact', ...base]
  if (step === 'replace') return ['--replace-failed-reviewer', '--failure-code', 'silent_worker_observed', '--confirm-no-verdict', '--confirm-no-artifact', '--admit-issue', String(row.issue), ...base]
  throw new Error(`unknown step ${step}`)
}

/** Rebuilds the exact lease identity from a durable reroute record, so a dispatch can resume after the lease is gone. */
export function rowFromRecord(record) {
  const m = /^review-(\d+)-(\d+)-seq(\d+)-slot(\d+)$/.exec(String(record?.original_id ?? ''))
  if (!m || !/^[0-9a-f]{40}$/.test(String(record?.head_sha ?? ''))) throw new Error('reviewer reroute record does not name an exact lease')
  return { issue: Number(m[1]), pr: Number(m[2]), sequence: Number(m[3]), slot: Number(m[4]), headSha: record.head_sha }
}

// A step the manager already completed durably refuses with these exact reasons; a resumed
// dispatch treats them as done. The replacement step is idempotent in the manager itself.
const ALREADY_DONE = {
  probe: /reviewer silence probe already exists and is immutable/,
  reclaim: /silent reviewer lease was already reclaimed with immutable evidence/,
}

export function runStep(io, step, row) {
  try { return { status: 'done', result: io.manager(managerArgs(step, row)) } } catch (error) {
    const message = String(error?.message ?? error)
    if (ALREADY_DONE[step]?.test(message)) return { status: 'already-done', reason: message }
    throw error
  }
}

// A probe or reclaim refusal is mooted only when the exact lease (same draw sequence) is read
// back as still held, which proves no reclaim applied and the lease scan still owns it. A
// vanished or unreadable lease may be this reservation's own completed reclaim: never moot.
export function mootable(io, step, exact) {
  if (step !== 'probe' && step !== 'reclaim') return false
  try {
    return io.readLeases().some((r) => Number(r.issue) === exact.issue && Number(r.pr) === exact.pr && String(r.headSha).toLowerCase() === exact.headSha && Number(r.slot) === exact.slot && Number(r.sequence) === exact.sequence)
  } catch { return false }
}

function markMoot(io, rerouteId, record, step, error) {
  const ref = `refs/db-start-reroutes/reviewer/${record.original_id}`
  try { io.durable.createAccepted(dispatchSubref(ref, 'moot'), rerouteId, { step, reason: String(error?.message ?? error).slice(0, 500), at: io.now() }) } catch {}
}

function dispatchDurable(io, entry) {
  return {
    ...io.durable,
    dispatchReplacement: (rerouteId, record) => {
      const exact = rowFromRecord(record)
      entry.steps = {}
      for (const step of ['probe', 'reclaim', 'replace']) {
        try { entry.steps[step] = runStep(io, step, exact) } catch (error) {
          // Moot only when the refusal provably left the lease untouched (see mootable): then a
          // still-overdue lease is picked up again by the lease scan, and one that started, moved,
          // or closed needs nothing, so resume stops retrying it. A reclaim that may have applied
          // (lease gone or unreadable) and any replace failure stay pending for resume.
          if (mootable(io, step, exact)) markMoot(io, rerouteId, record, step, error)
          throw error
        }
      }
      entry.dispatched_at = io.now()
      return { reroute_id: rerouteId, replacement_id: record.replacement_id, status: 'created' }
    },
  }
}

/**
 * One watch pass. io: { now(), readLeases(), manager(args) -> parsed JSON, durable (canary durable adapter shape) }.
 * Only rows whose decision is governed-return-and-reroute are acted on, and only with apply.
 */
export function watchOnce(io, { apply = false, drawnSince = null } = {}) {
  // Transition guard: reviews launched by runners that predate start markers have none. With
  // --apply the operator must name the instant from which every runner writes markers; older
  // leases are left to the ordinary two-hour silence path.
  if (apply && !Number.isFinite(Date.parse(drawnSince ?? ''))) throw new Error('--apply requires --drawn-since <ISO time> after which every governed runner writes start markers')
  // A malformed --drawn-since would otherwise compare as NaN and silently skip every overdue lease,
  // so a dry run would report no non-starts while some exist.
  if (drawnSince != null && !Number.isFinite(Date.parse(drawnSince))) throw new Error(`--drawn-since is not a valid ISO time: ${drawnSince}`)
  const now = io.now()
  const out = []
  const handled = new Set()
  for (const row of io.readLeases()) {
    let { assignment, decision } = leaseStartDecision(row, now)
    if (decision.action === 'governed-return-and-reroute' && drawnSince && !(Date.parse(row.heldSinceIso) >= Date.parse(drawnSince))) decision = { action: 'skip', reason: 'lease drawn before --drawn-since; left to the ordinary silence path' }
    if (decision.action === 'governed-return-and-reroute' && apply) decision = rerouteBudgetDecision(io, row, decision)
    const entry = { lease: row.leaseRef, reviewer: row.reviewer, issue: row.issue, pr: row.pr, sequence: row.sequence, slot: row.slot, held_since: row.heldSinceIso, action: decision.action, reason: decision.reason ?? null }
    out.push(entry)
    if (decision.action !== 'governed-return-and-reroute' || !apply) continue
    const adapter = createDurableStartRerouteAdapter({
      ...io.durable,
      // Re-read inside the reservation fence: a review that started meanwhile refuses the reservation.
      readLive: () => {
        const fresh = io.readLeases().find((r) => r.leaseRef === row.leaseRef && r.sequence === row.sequence)
        if (!fresh) throw new Error('lease disappeared before the reroute reservation')
        const still = leaseStartDecision(fresh, io.now()).decision.action === 'governed-return-and-reroute'
        return { now: io.now(), provider_state: 'confirmed-not-started', lifecycle: still ? [] : [{ assignment_id: assignment.id, type: 'review_started', at: fresh.heldSinceIso, source: 'fence-reread' }] }
      },
    })
    // One reservation's refusal never stops the pass for other leases.
    try {
      const reserved = reserveReviewerReroute(assignment, decision, { id: `replacement-${assignment.id}`, provider: REPLACEMENT_PROVIDER }, adapter)
      entry.reroute = { ref: reserved.ref, reroute_id: reserved.reroute_id, status: reserved.status, reserved_at: io.now() }
      handled.add(reserved.ref)
      entry.reroute.ack = dispatchQueuedReroute(reserved.ref, dispatchDurable(io, entry.reroute))
    } catch (error) { entry.error = String(error?.message ?? error) }
  }
  // Resume reservations whose dispatch never acknowledged (a crash between steps): the lease may
  // already be gone, so the exact identity comes from the durable record, not from a lease row.
  if (apply && typeof io.pendingReroutes === 'function') {
    for (const pending of io.pendingReroutes()) {
      const ref = typeof pending === 'string' ? pending : pending.ref, failures = typeof pending === 'string' ? 0 : pending.failures
      if (handled.has(ref)) continue
      const entry = { resumed: ref, prior_failures: failures }
      out.push(entry)
      try { entry.ack = dispatchQueuedReroute(ref, dispatchDurable(io, entry)) } catch (error) {
        entry.error = String(error?.message ?? error)
        // Every failed resume leaves a create-only attempt record; after RESUME_ATTEMPT_LIMIT the
        // reservation is closed with a terminal moot naming the last refusal, for an engineer.
        const attempt = failures + 1
        try { io.durable.createAccepted(dispatchSubref(ref, `failed-${attempt}`), ref, { reason: entry.error.slice(0, 500), at: io.now() }) } catch {}
        if (attempt >= RESUME_ATTEMPT_LIMIT) {
          try { io.durable.createAccepted(dispatchSubref(ref, 'moot'), ref, { step: 'resume', reason: `resume attempts exhausted (${attempt}); engineer attention required: ${entry.error.slice(0, 400)}`, at: io.now() }) } catch {}
          entry.gave_up = true
        }
      }
    }
  }
  return out
}

export const RESUME_ATTEMPT_LIMIT = 12

// A replacement lease is itself watched, so a slot whose replacements never start either would
// otherwise be rerouted every pass, forever, once the watcher runs unattended (#3242). Each
// (issue, PR, slot) gets this many automatic reroutes; after that the lease is left to the
// ordinary two-hour silence path. Reroute refs do not carry the head, so the budget spans heads.
export const AUTO_REROUTES_PER_SLOT = 2

export function priorReroutesForSlot(refNames, row) {
  const prefix = `refs/db-start-reroutes/reviewer/review-${Number(row.issue)}-${Number(row.pr)}-seq`
  const suffix = `-slot${Number(row.slot)}`
  return [...new Set(refNames)].filter((ref) => ref.startsWith(prefix) && ref.endsWith(suffix) && /^\d+$/.test(ref.slice(prefix.length, -suffix.length))).length
}

function rerouteBudgetDecision(io, row, decision) {
  if (typeof io.rerouteRefs !== 'function') return decision
  let prior
  try { prior = priorReroutesForSlot(io.rerouteRefs(), row) } catch (error) { return { action: 'skip', reason: `reroute history is unreadable: ${String(error?.message ?? error).slice(0, 200)}` } }
  return prior >= AUTO_REROUTES_PER_SLOT ? { action: 'skip', reason: `automatic reroute budget exhausted (${prior} for this slot); left to the ordinary silence path` } : decision
}

/** Reservations with neither a dispatch acknowledgement nor a moot marker, with failed-resume counts. */
export function pendingFromRefNames(refs) {
  const names = new Set(refs)
  return [...names].filter((ref) => !ref.includes('--') && !names.has(dispatchSubref(ref, 'dispatch-ack')) && !names.has(dispatchSubref(ref, 'moot')))
    .map((ref) => ({ ref, failures: [...names].filter((name) => name.startsWith(`${ref}--failed-`)).length }))
}

export function liveWatchIo(repo, env = process.env) {
  const manager = (args) => {
    const run = spawnSync(process.execPath, [MANAGER, ...args], { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 })
    if (run.status !== 0) throw new Error(String(run.stderr || run.stdout || `manager exited ${run.status}`).trim())
    return JSON.parse(run.stdout)
  }
  const durable = canaryLiveIo(repo).durable
  const rerouteRefs = () => JSON.parse(runGitHubCommand(['api', '--paginate', '--slurp', `repos/${repo}/git/matching-refs/db-start-reroutes/reviewer/`]) || '[]').flat().map((row) => row.ref)
  const pendingReroutes = () => pendingFromRefNames(rerouteRefs())
  return { now: () => new Date().toISOString(), readLeases: () => manager(['--reviewer-start-watch-leases']), manager, durable, rerouteRefs, pendingReroutes }
}

// An unattended pass that could not finish a reroute must fail its run, not report success.
export const exitCodeFor = (rows) => (rows.some((row) => row.error) ? 1 : 0)

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--repo')
  // --repo is an assertion: it must agree with GITHUB_REPOSITORY and the verified origin (#2530).
  const repo = currentRepository(i >= 0 ? argv[i + 1] : undefined)
  const apply = argv.includes('--apply')
  const d = argv.indexOf('--drawn-since')
  const drawnSince = d >= 0 ? argv[d + 1] : null
  const rows = watchOnce(liveWatchIo(repo), { apply, drawnSince })
  console.log(JSON.stringify({ at: new Date().toISOString(), slo_ms: START_SLO_MS, apply, leases: rows }, null, 2))
  return exitCodeFor(rows)
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main()
