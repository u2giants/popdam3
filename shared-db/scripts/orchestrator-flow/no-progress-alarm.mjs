#!/usr/bin/env node
// Two-hour no-progress alarm and successor resume (issue #3027, programme ai-devops#401 Step 4).
//
//   --alarm  [--repo r] [--now ISO] [--post-issue N] [--staged-label TEXT] [--dry-run]
//   --resume --issue N [--repo r] [--max-age-minutes M]
//
// --alarm reads the live orchestrator state (scripts/orchestrator-snapshot.mjs), and when an
// owned outcome has had no stage transition for more than 120 minutes, or nothing closed in
// four hours, posts ONE comment naming each stuck outcome, its blocker and the unblock action,
// with the sealed snapshot attached. It is transition-only: the alarm key covers the stalled
// set and the zero-closure flag, and a key already posted on the target issue is never
// reposted. Without --post-issue the target is the live orchestrator marker; when no marker
// resolves, stalls are still evaluated and the alarm goes to one stable fallback issue, created
// once. A run that can neither evaluate nor post exits non-zero.
//
// --resume is what a successor session runs: it reads the newest alarm comment, verifies the
// sealed snapshot, compares it with the current live state, and prints the outcomes it is
// taking over. It never writes.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson } from './evidence-bundle.mjs'
import { OrchestratorSnapshotError, snapshotInputs, verifyOrchestratorSnapshot } from './orchestrator-snapshot.mjs'
import { currentRepository } from '../lib/repository-identity.mjs'
import { ZERO_CLOSURE_WINDOW_MINUTES, defaultIo, gatherLiveInput, gh, runSnapshotCycle, stalledOutcomes, stalledRequests } from '../orchestrator-snapshot.mjs'

export const FALLBACK_TITLE = 'Orchestrator no-progress alarm (no orchestrator marker)'
// A coordination label, so the queue audit does not report the fallback issue as unlabelled work.
export const FALLBACK_LABEL = 'orchestrator-alarm'

export const ALARM_MARKER = 'db-no-progress-alarm'
export const SNAPSHOT_LANG = 'db-orchestrator-snapshot'
export const TRUSTED_AUTHORS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR'])
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

// What is normally waiting on an outcome that sits in each state, and who moves it.
export const UNBLOCK = Object.freeze({
  requested: ['ready structural request never entered the outcome ledger', 'orchestrator admits it (records entered and classified) or sets its db-work-scope status to blocked with the reason'],
  entered: ['not yet classified', 'orchestrator classifies the work and records classified'],
  classified: ['no worker dispatched', 'orchestrator dispatches a worker or records blocked with the reason'],
  dispatched: ['worker has not reported implementation complete', 'check the worker session; if it is gone, reclaim and redispatch'],
  implementation_complete: ['no review started', 'assign a governed reviewer at the exact head'],
  review_ready: ['preview proof not recorded', 'dispatch the preview apply (or the no-database-preview route)'],
  preview_verified: ['not merged', 'run the Guarded Merge for the reviewed head'],
  merged: ['production not authorized', 'obtain the recorded production authorization'],
  production_authorized: ['production apply not run', 'run the production apply lane'],
  production_applied: ['live verification not recorded', 'run the live verification and record live_verified'],
  blocked: ['recorded blocker', 'resolve the blocker named in the blocked event'],
  yielded: ['yielded to another owner', 'the natural owner resumes or closes it'],
})

export function alarmKey(alarms) {
  return sha256(canonicalJson({ stalled: alarms.stalled_outcomes.map((row) => row.work_issue).sort((a, b) => a - b), zero_closures_4h: alarms.zero_closures_4h }))
}

export function renderAlarm({ output, key, now, stagedLabel = null }) {
  const lines = [
    `<!-- ${ALARM_MARKER} alarm_key=${key} snapshot_id=${output.snapshot?.snapshot_id ?? 'none'}${stagedLabel ? ' staged=true' : ''} -->`,
    `## ${stagedLabel ? `${stagedLabel}: ` : ''}No-progress alarm`,
    '',
    `Observed at ${now}. Active outcomes: ${output.active_outcomes}. Closures in the last 4 hours: ${output.closures_in_window}.`,
    '',
  ]
  for (const row of output.stalled_outcomes) {
    const [blocker, action] = UNBLOCK[row.state] ?? ['unknown state', 'inspect the outcome events']
    lines.push(`- #${row.work_issue} has been \`${row.state}\` for ${row.minutes_since_transition} minutes (since ${row.last_transition_at}). Blocker: ${blocker}. Unblock: ${action}.`)
  }
  if (output.zero_closures_4h) lines.push('- Nothing reached live_verified in the last 4 hours while outcomes are active.')
  if (!output.snapshot) lines.push('', 'No orchestrator marker resolved, so no sealed snapshot is attached. Open or resume the orchestrator to own these outcomes.')
  else lines.push('', `Resume from this snapshot: \`node scripts/orchestrator-flow/no-progress-alarm.mjs --resume --issue <this issue>\``, '', '```' + SNAPSHOT_LANG, JSON.stringify(output.snapshot), '```')
  return lines.join('\n')
}

// Only a trusted author or the workflow itself can mark a key as posted; anyone can comment on a public issue.
export const trustedComment = (c) => TRUSTED_AUTHORS.includes(c?.author_association) || c?.user?.login === 'github-actions[bot]'
export const postedKeys = (comments) => new Set(comments.filter(trustedComment).flatMap((c) => [...String(c?.body ?? '').matchAll(new RegExp(`<!-- ${ALARM_MARKER} alarm_key=([0-9a-f]{64})`, 'g'))].map((m) => m[1])))

export function runAlarm({ repo, now, postIssue = null, stagedLabel = null, dryRun = false }, io) {
  // Read failures other than "no orchestrator" throw here, so the CLI exits 1.
  const { input, sessionStarted, unentered = [], unclaimedEvents = [] } = io.gatherLiveInput(repo)
  let raw
  if (input.marker) raw = runSnapshotCycle(input, { now, previous: null, sessionStarted }).output
  else {
    const ownedIssues = [...new Set(input.claims.flatMap((claim) => [claim.issue, ...(claim.work_issues ?? [])]))]
    raw = { snapshot: null, ...stalledOutcomes(input.outcome_events, { now, ownedIssues, sessionStarted }) }
  }
  // Ready requests that never entered the ledger alarm on the same 30-minute threshold (#3148).
  // Requests that entered the ledger but have no owning claim yet use the same event thresholds (#3158).
  const unclaimed = stalledOutcomes(unclaimedEvents, { now }).stalled_outcomes
  raw = { ...raw, stalled_outcomes: [...raw.stalled_outcomes, ...stalledRequests(unentered, { now }), ...unclaimed] }
  // Zero closures only counts once outcomes have existed for the whole four-hour window.
  const earliest = Math.min(...input.outcome_events.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)))
  const output = { ...raw, zero_closures_4h: raw.zero_closures_4h && Date.parse(now) - earliest >= ZERO_CLOSURE_WINDOW_MINUTES * 60000 }
  const marker = input.marker ? input.marker.issue : 'none'
  if (!output.stalled_outcomes.length && !output.zero_closures_4h) return { status: 'quiet', marker, active_outcomes: output.active_outcomes, snapshot_id: output.snapshot?.snapshot_id ?? null }
  const key = alarmKey(output)
  const target = postIssue ?? input.marker?.issue ?? (dryRun ? 'fallback' : io.fallbackIssue(repo))
  if (target !== 'fallback' && postedKeys(io.issueComments(repo, target)).has(key)) return { status: 'already-posted', marker, alarm_key: key, target }
  const body = renderAlarm({ output, key, now, stagedLabel })
  if (dryRun) return { status: 'would-post', marker, alarm_key: key, target, body }
  const posted = io.postComment(repo, target, body)
  if (!posted?.html_url) throw new Error(`alarm comment on #${target} was not confirmed`)
  return { status: 'posted', marker, alarm_key: key, target, comment_url: posted.html_url, stalled: output.stalled_outcomes.map((r) => r.work_issue), zero_closures_4h: output.zero_closures_4h }
}

/** The one stable fallback issue: the oldest open trusted issue with FALLBACK_TITLE and FALLBACK_LABEL, created only when none exists. */
export function findOrCreateFallback(openIssues, create) {
  const labelled = (issue) => (issue.labels ?? []).some((label) => (label?.name ?? label) === FALLBACK_LABEL)
  const found = openIssues.filter((issue) => !issue.pull_request && issue.title === FALLBACK_TITLE && labelled(issue) && trustedComment(issue)).sort((x, y) => x.number - y.number)[0]
  if (found) return found.number
  const created = create()
  if (!Number.isInteger(created?.number)) throw new Error('fallback alarm issue could not be created')
  return created.number
}

export function latestSnapshotFromComments(comments) {
  const rows = comments.filter(trustedComment)
  for (const comment of [...rows].reverse()) {
    const body = String(comment?.body ?? '')
    if (!body.includes(`<!-- ${ALARM_MARKER} `)) continue
    const match = body.match(new RegExp('```' + SNAPSHOT_LANG + '\\s*\\n([\\s\\S]*?)\\n```'))
    if (!match) continue
    try { return { snapshot: JSON.parse(match[1]), comment_url: comment.html_url ?? null } } catch { continue }
  }
  return null
}

export function runResume({ repo, issue, now, maxAgeMinutes = 24 * 60 }, io) {
  const found = latestSnapshotFromComments(io.issueComments(repo, issue))
  if (!found) throw new OrchestratorSnapshotError(`no alarm snapshot on #${issue}`)
  const { snapshot } = found
  let live = null
  const readCurrent = () => {
    live ??= io.gatherLiveInput(repo)
    if (!live.input.marker) throw new OrchestratorSnapshotError('no open routable orchestrator marker to resume against')
    return live.input
  }
  let currency
  try { currency = verifyOrchestratorSnapshot(snapshot, { readCurrent, now, maxAgeMs: maxAgeMinutes * 60000 }) } catch (error) {
    // The seal is always checked first; only freshness or drift may be reported and resumed past.
    if (!/stale|freshness/.test(error.message)) throw error
    currency = { status: 'DRIFTED', detail: error.message }
  }
  const alarms = stalledOutcomes(snapshot.state.outcome_events, { now: snapshot.captured_at, ownedIssues: snapshot.state.claims.flatMap((c) => [c.issue, ...(c.work_issues ?? [])]) })
  const current = readCurrent()
  const liveAlarms = stalledOutcomes(current.outcome_events, { now, ownedIssues: current.claims.flatMap((c) => [c.issue, ...(c.work_issues ?? [])]) })
  return {
    resumed_from: snapshot.snapshot_id,
    snapshot_captured_at: snapshot.captured_at,
    seal: 'VALID',
    currency: currency.status,
    ...(currency.detail ? { drift: currency.detail } : {}),
    marker: snapshot.state.marker,
    claims_taken_over: snapshot.state.claims.map((c) => c.issue).sort((a, b) => a - b),
    stalled_at_snapshot: alarms.stalled_outcomes.map((r) => r.work_issue),
    stalled_now: liveAlarms.stalled_outcomes.map((r) => ({ work_issue: r.work_issue, state: r.state, minutes: r.minutes_since_transition })),
    state_digest_now: sha256(canonicalJson(snapshotInputs(current))),
  }
}

export const liveIo = {
  gatherLiveInput: (repo) => gatherLiveInput(repo, defaultIo, { allowNoMarker: true }),
  fallbackIssue(repo) {
    return findOrCreateFallback(defaultIo.openIssues(repo), () => {
      const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'alarm-')), 'issue.md')
      writeFileSync(file, 'Stable target for the no-progress alarm while no orchestrator marker resolves (ai-devops#401 Step 4). Created once by the alarm workflow; keep it open.')
      return JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/issues`, '-f', `title=${FALLBACK_TITLE}`, '-F', `body=@${file}`, '-f', `labels[]=${FALLBACK_LABEL}`]))
    })
  },
  issueComments: (repo, issue) => defaultIo.issueComments(repo, issue),
  postComment(repo, issue, body) {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'alarm-')), 'body.md')
    writeFileSync(file, body)
    return JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/issues/${Number(issue)}/comments`, '-F', `body=@${file}`]))
  },
}

export function main(argv = process.argv.slice(2), { io = liveIo, stdout = console.log, stderr = console.error } = {}) {
  const value = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : null }
  const repo = currentRepository(value('--repo'))
  const now = value('--now') || new Date().toISOString()
  try {
    if (Number.isNaN(Date.parse(now))) throw new Error('--now must be an ISO instant')
    if (argv.includes('--alarm')) {
      const postIssue = value('--post-issue') ? Number(value('--post-issue')) : null
      const result = runAlarm({ repo, now, postIssue, stagedLabel: value('--staged-label') || null, dryRun: argv.includes('--dry-run') }, io)
      stdout(JSON.stringify(result, null, 2))
      return 0
    }
    if (argv.includes('--resume')) {
      const issue = Number(value('--issue'))
      if (!Number.isInteger(issue) || issue <= 0) throw new Error('--resume requires --issue')
      stdout(JSON.stringify(runResume({ repo, issue, now, maxAgeMinutes: Number(value('--max-age-minutes') ?? 1440) }, io), null, 2))
      return 0
    }
    throw new Error('one of --alarm or --resume is required')
  } catch (error) {
    stderr(`no-progress-alarm: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main()
