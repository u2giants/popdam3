#!/usr/bin/env node
// Two-hour no-progress alarm and successor resume (issue #3027, programme ai-devops#401 Step 4).
//
//   --alarm  [--repo r] [--now ISO] [--post-issue N] [--staged-label TEXT] [--dry-run]
//   --resume --issue N [--repo r] [--max-age-minutes M]
//
// --alarm reads the live claim-first state (scripts/flow-snapshot.mjs), and when an
// owned outcome has had no stage transition for more than 120 minutes, or nothing closed in
// four hours, posts ONE comment naming each stuck outcome, its blocker and the unblock action,
// with the sealed snapshot attached. It is transition-only: the alarm key covers the stalled
// set and the zero-closure flag, and a key already posted on the target issue is never
// reposted. Without --post-issue the target is the live claim-first session identity; when no marker
// resolves, stalls are still evaluated and the alarm goes to one stable fallback issue, created
// once. A run that can neither evaluate nor post exits non-zero.
//
// --resume is what a successor session runs: it reads the newest alarm comment, verifies the
// sealed snapshot, compares it with the current live state, and prints the outcomes it is
// taking over. It never writes.
//
// PROMOTION-LANE STALLS (plan_go-live-lane-prevention.md §9 3.2/3.3, issue #5782):
// the same 30-minute tick also watches the go-live lane, read-only. It runs the
// promotion selector with --dry-run (which never dispatches) and reads its trace,
// plus three small read-only facts: the last successful apply, the latest Queue
// Hygiene Report run, and the promotion merge freeze record. It alarms on a PR
// held by a review finding over 60 minutes, on a change out of automatic
// attempts (the ENGINEER ACTION REQUIRED text, now on a channel someone reads),
// on a starved lane (candidates exist and nothing applied in 60 minutes — the
// 2026-11-05 signature), on a Queue Hygiene Report run that concluded failure
// ("the instrument could not run" must never be silence), and names the freeze
// complaint whenever a promotion merge freeze has been live over 15 minutes.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson } from './evidence-bundle.mjs'
import { FlowSnapshotError, snapshotInputs, verifyFlowSnapshot } from './snapshot.mjs'
import { currentRepository } from '../lib/repository-identity.mjs'
import { ZERO_CLOSURE_WINDOW_MINUTES, defaultIo, gatherLiveInput, gh, runSnapshotCycle, stalledOutcomes, stalledRequests } from '../flow-snapshot.mjs'

export const FALLBACK_TITLE = 'No-progress alarm (no claim-first session identity)'
// The title before #4348. An issue still open under it is the same fallback, so it is matched, never forked.
export const LEGACY_FALLBACK_TITLE = 'Orchestrator no-progress alarm (no orchestrator marker)'
// A coordination label, so the queue audit does not report the fallback issue as unlabelled work.
export const FALLBACK_LABEL = 'orchestrator-alarm'

export const ALARM_MARKER = 'db-no-progress-alarm'
export const SNAPSHOT_LANG = 'db-flow-snapshot'
export const LEGACY_SNAPSHOT_LANG = 'db-orchestrator-snapshot'
export const TRUSTED_AUTHORS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR'])
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

// What is normally waiting on an outcome that sits in each state, and who moves it.
export const UNBLOCK = Object.freeze({
  requested: ['ready structural request never entered the outcome ledger', 'claim owner admits it (records entered and classified) or sets its db-work-scope status to blocked with the reason'],
  entered: ['not yet classified', 'claim owner classifies the work and records classified'],
  classified: ['no worker dispatched', 'claim owner starts implementation or records blocked with the reason'],
  dispatched: ['worker has not reported implementation complete', 'check the worker session; if it is gone, reclaim and redispatch'],
  implementation_complete: ['no review started', 'assign a governed reviewer at the exact head'],
  review_ready: ['preview proof not recorded', 'dispatch the preview apply (or the no-database-preview route)'],
  preview_verified: ['not merged', 'run the Guarded Merge for the reviewed head'],
  merged: ['production not authorized', 'obtain the recorded production authorization'],
  production_authorized: ['production apply not run', 'run the production apply lane'],
  production_applied: ['live verification not recorded', 'run the live verification and record live_verified'],
  blocked: ['recorded blocker', 'resolve the blocker named in the blocked event'],
  yielded: ['yielded to another owner', 'the natural owner resumes or closes it'],
  // Promotion-lane stall classes (plan §9 3.2/3.3, issue #5782).
  promotion_held: ['a blocking review finding holds this merged change', 'resolve or dismiss the named review finding with written justification (reviews are advisory, 2026-10-29) and let the queue pick the change up'],
  promotion_exhausted: ['the change exhausted its automatic promotion attempts', 'investigate the failure, fix the migration or its dependencies, and re-dispatch through the normal promotion path (the stuck-change tracking issue owns the detail)'],
  promotion_starved: ['merged candidates exist but nothing has applied in over an hour', 'inspect the promotion queue — holds, pin refusals and the freeze — then re-dispatch or repair; see the selector trace'],
  instrument_down: ['the daily Queue Hygiene Report itself could not run', 'repair the report (exit 2 means it could not read) and re-dispatch it; silence is never a clean queue'],
  freeze_wedged: ['a promotion merge freeze has been live over 15 minutes and merges are paused', 'check the go-live run; the run\'s end releases the freeze, or release it with the documented command for its source PR'],
})

// Promotion-lane thresholds (plan §9 3.2/3.3). A review hold alarms at 60
// minutes (the selector's own 30-minute annotation is the early warning); a
// lane with candidates and no successful apply in 60 minutes is the starved
// signature; a freeze older than 15 minutes is named so a wedged one is seen,
// not discovered. All are minutes of wall clock, evaluated against --now.
export const PROMOTION_HELD_ALARM_MINUTES = 60
export const STARVED_LANE_MINUTES = 60
export const FREEZE_COMPLAINT_MINUTES = 15

// The selector's stdout trace (plan §9 3.2: "run --dry-run and read its trace;
// do not make the selector write anything"). Only its own lines are read: the
// `held N min` advisory annotation, the exhausted lines, and the terminal action.
const HELD_MINUTES_RE = /^::error title=Production release held over 30 minutes::PR #(\d+) .*? held (\d+) min by (.+)$/
const HELD_LINE_RE = /^held: PR #(\d+) by (.+?); later PRs still promote$/
const EXHAUSTED_LINE_RE = /^exhausted: PR #(\d+) (out of .+?); later PRs still promote$/
const ENGINEER_LINE_RE = /^::error title=(ENGINEER ACTION REQUIRED: .+?)::(PR #(\d+) .+)$/
const ACTION_RE = /^(dispatch|wait|idle): /

export function parsePromotionTrace(stdout) {
  const held = new Map(), exhausted = new Map(), lines = String(stdout ?? '').split(/\r?\n/)
  let action = null
  for (const line of lines) {
    let match
    if ((match = HELD_MINUTES_RE.exec(line))) {
      const [, pr, minutes, findings] = match
      held.set(Number(pr), { pr: Number(pr), minutes: Number(minutes), findings: findings.trim() })
    } else if ((match = HELD_LINE_RE.exec(line))) {
      const [, pr, findings] = match
      if (!held.has(Number(pr))) held.set(Number(pr), { pr: Number(pr), minutes: 0, findings: findings.trim() })
    } else if ((match = ENGINEER_LINE_RE.exec(line))) {
      // The loud ENGINEER ACTION REQUIRED text travels verbatim into the alarm.
      exhausted.set(Number(match[3]), { pr: Number(match[3]), note: `${match[1]}: ${match[2].trim()}` })
    } else if ((match = EXHAUSTED_LINE_RE.exec(line))) {
      if (!exhausted.has(Number(match[1]))) exhausted.set(Number(match[1]), { pr: Number(match[1]), note: match[2] })
    } else if ((match = ACTION_RE.exec(line))) {
      action = match[1]
    }
  }
  return { held: [...held.values()], exhausted: [...exhausted.values()], action }
}

/** The promotion-lane stall rows for one tick. Pure: `promotion` is whatever
 *  `io.gatherPromotionInput` returned (fixtures included). */
export function promotionStalls(promotion, now) {
  const rows = []
  const at = Date.parse(now)
  const { trace = { held: [], exhausted: [], action: null }, last_apply_success_at = null,
    hygiene_run = null, freeze = null, error = null } = promotion ?? {}
  if (error) {
    rows.push({ lane: 'promotion', state: 'instrument_down', work_issue: 0,
      display: 'the promotion lane evaluator', minutes_since_transition: null, detail: error })
  }
  for (const held of trace.held) {
    if (held.minutes > PROMOTION_HELD_ALARM_MINUTES) {
      rows.push({ lane: 'promotion', state: 'promotion_held', work_issue: held.pr,
        display: `PR #${held.pr}`, minutes_since_transition: held.minutes,
        detail: `held ${held.minutes} min by ${held.findings}` })
    }
  }
  for (const exhausted of trace.exhausted) {
    rows.push({ lane: 'promotion', state: 'promotion_exhausted', work_issue: exhausted.pr,
      display: `PR #${exhausted.pr}`, minutes_since_transition: null, detail: exhausted.note })
  }
  const candidates = Boolean(trace.held.length || trace.exhausted.length || trace.action === 'dispatch')
  const lastApply = last_apply_success_at ? Date.parse(last_apply_success_at) : null
  if (candidates && (lastApply === null || at - lastApply > STARVED_LANE_MINUTES * 60000)) {
    rows.push({ lane: 'promotion', state: 'promotion_starved', work_issue: 0,
      display: 'the promotion lane', minutes_since_transition: lastApply ? Math.round((at - lastApply) / 60000) : null,
      detail: 'candidates exist but no successful apply in 60 minutes' })
  }
  if (hygiene_run && hygiene_run.conclusion === 'failure') {
    rows.push({ lane: 'promotion', state: 'instrument_down', work_issue: 0,
      display: 'the Queue Hygiene Report', minutes_since_transition: null,
      detail: `the instrument could not run: ${hygiene_run.url}` })
  }
  if (freeze && freeze.acquired_at) {
    const age = at - Date.parse(freeze.acquired_at)
    if (Number.isFinite(age) && age > FREEZE_COMPLAINT_MINUTES * 60000) {
      rows.push({ lane: 'promotion', state: 'freeze_wedged', work_issue: freeze.pr ?? 0,
        display: `the promotion merge freeze for PR #${freeze.pr ?? '?'}`,
        minutes_since_transition: Math.round(age / 60000),
        detail: freeze.complaint ?? 'merges are paused for a production run; promotion merge freeze is live' })
    }
  }
  return rows
}

export function alarmKey(alarms) {
  // Claim-first rows key exactly as they always have (a key derivation change
  // would repost every live alarm once); promotion rows join as their own
  // component so a new stall class fires and an identical set never reposts.
  const claimFirst = alarms.stalled_outcomes.filter((row) => row.lane !== 'promotion').map((row) => row.work_issue).sort((a, b) => a - b)
  const promotion = alarms.stalled_outcomes.filter((row) => row.lane === 'promotion').map((row) => `${row.state}:${row.work_issue}`).sort()
  const base = { stalled: claimFirst, zero_closures_4h: alarms.zero_closures_4h }
  return sha256(canonicalJson(promotion.length ? { ...base, promotion } : base))
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
    if (row.lane === 'promotion') continue
    const [blocker, action] = UNBLOCK[row.state] ?? ['unknown state', 'inspect the outcome events']
    lines.push(`- #${row.work_issue} has been \`${row.state}\` for ${row.minutes_since_transition} minutes (since ${row.last_transition_at}). Blocker: ${blocker}. Unblock: ${action}.`)
  }
  const promotion = output.stalled_outcomes.filter((row) => row.lane === 'promotion')
  if (promotion.length) {
    lines.push('', '### Promotion lane (go-live)', '')
    for (const row of promotion) {
      const [blocker, action] = UNBLOCK[row.state] ?? ['unknown state', 'inspect the promotion trace']
      const age = row.minutes_since_transition == null ? '' : ` for ${row.minutes_since_transition} minutes`
      lines.push(`- ${row.display} — \`${row.state}\`${age}${row.detail ? ` (${row.detail})` : ''}. Blocker: ${blocker}. Unblock: ${action}.`)
    }
  }
  if (output.zero_closures_4h) lines.push('- Nothing reached live_verified in the last 4 hours while outcomes are active.')
  if (!output.snapshot) lines.push('', 'No claim-first session identity resolved, so no sealed snapshot is attached. Open a claim-first session to own these outcomes.')
  else lines.push('', `Resume from this snapshot: \`node scripts/db-flow/no-progress-alarm.mjs --resume --issue <this issue>\``, '', '```' + SNAPSHOT_LANG, JSON.stringify(output.snapshot), '```')
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
  // Promotion-lane stalls (plan §9 3.2/3.3) join the same comment and the same
  // transition-only key; read-only state only.
  output.stalled_outcomes = [...output.stalled_outcomes, ...promotionStalls(io.gatherPromotionInput(repo), now)]
  const marker = input.marker ? input.marker.issue : 'none'
  if (!output.stalled_outcomes.length && !output.zero_closures_4h) return { status: 'quiet', marker, active_outcomes: output.active_outcomes, snapshot_id: output.snapshot?.snapshot_id ?? null }
  const key = alarmKey(output)
  const target = postIssue ?? input.marker?.issue ?? (dryRun ? 'fallback' : io.fallbackIssue(repo))
  if (target !== 'fallback' && postedKeys(io.issueComments(repo, target)).has(key)) return { status: 'already-posted', marker, alarm_key: key, target }
  const body = renderAlarm({ output, key, now, stagedLabel })
  if (dryRun) return { status: 'would-post', marker, alarm_key: key, target, body }
  const posted = io.postComment(repo, target, body)
  if (!posted?.html_url) throw new Error(`alarm comment on #${target} was not confirmed`)
  return { status: 'posted', marker, alarm_key: key, target, comment_url: posted.html_url,
    stalled: output.stalled_outcomes.filter((r) => r.lane !== 'promotion').map((r) => r.work_issue),
    promotion: output.stalled_outcomes.filter((r) => r.lane === 'promotion').map((r) => `${r.state}:${r.display}`),
    zero_closures_4h: output.zero_closures_4h }
}

/** The one stable fallback issue: the oldest open trusted issue with FALLBACK_TITLE and FALLBACK_LABEL, created only when none exists. */
export function findOrCreateFallback(openIssues, create) {
  const labelled = (issue) => (issue.labels ?? []).some((label) => (label?.name ?? label) === FALLBACK_LABEL)
  const found = openIssues.filter((issue) => !issue.pull_request && (issue.title === FALLBACK_TITLE || issue.title === LEGACY_FALLBACK_TITLE) && labelled(issue) && trustedComment(issue)).sort((x, y) => x.number - y.number)[0]
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
    const match = body.match(new RegExp('```' + SNAPSHOT_LANG + '\\s*\\n([\\s\\S]*?)\\n```')) || body.match(new RegExp('```' + LEGACY_SNAPSHOT_LANG + '\\s*\\n([\\s\\S]*?)\\n```'))
    if (!match) continue
    try { return { snapshot: JSON.parse(match[1]), comment_url: comment.html_url ?? null } } catch { continue }
  }
  return null
}

export function runResume({ repo, issue, now, maxAgeMinutes = 24 * 60 }, io) {
  const found = latestSnapshotFromComments(io.issueComments(repo, issue))
  if (!found) throw new FlowSnapshotError(`no alarm snapshot on #${issue}`)
  const { snapshot } = found
  let live = null
  const readCurrent = () => {
    live ??= io.gatherLiveInput(repo)
    if (!live.input.marker) throw new FlowSnapshotError('no open routable claim-first session identity to resume against')
    return live.input
  }
  let currency
  try { currency = verifyFlowSnapshot(snapshot, { readCurrent, now, maxAgeMs: maxAgeMinutes * 60000 }) } catch (error) {
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
  // Promotion-lane facts for plan §9 3.2/3.3, all read-only. The selector runs
  // with --dry-run (it never dispatches); the rest are single API reads. A read
  // that cannot run degrades to `error`, which the evaluator turns into a loud
  // instrument row — silence is never the outcome.
  gatherPromotionInput(repo) {
    const result = { trace: { held: [], exhausted: [], action: null }, last_apply_success_at: null, hygiene_run: null, freeze: null, error: null }
    try {
      const python = ['python', 'python3'].find((name) => {
        try { execFileSync(name, ['--version'], { stdio: 'ignore' }); return true } catch { return false }
      })
      if (!python) throw new Error('no python interpreter for the promotion selector')
      const stdout = execFileSync(python, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'automatic_promotion_candidates.py'), '--dry-run'],
        { encoding: 'utf8', timeout: 360_000, env: process.env })
      result.trace = parsePromotionTrace(stdout)
    } catch (error) {
      result.error = `the promotion selector --dry-run trace could not be read (${String(error?.message ?? error).split('\n')[0]})`
    }
    try {
      const runs = JSON.parse(gh(['api', `repos/${repo}/actions/workflows/shared-supabase-migrations.yml/runs?per_page=30`]))
      const applied = (runs?.workflow_runs ?? []).find((run) => run.conclusion === 'success'
        && /^(DB production apply|DB preview apply) /.test(run.display_title ?? run.name ?? ''))
      result.last_apply_success_at = applied?.updated_at ?? null
    } catch { /* unreadable runs starve the lane conservatively: null means "no success seen" */ }
    try {
      const runs = JSON.parse(gh(['api', `repos/${repo}/actions/workflows/queue-hygiene-report.yml/runs?per_page=1`]))
      const run = runs?.workflow_runs?.[0]
      if (run) result.hygiene_run = { conclusion: run.conclusion ?? run.status, url: run.html_url }
    } catch { /* the report-failure row stays silent only when the read fails; the trace error row still fires */ }
    try {
      const ref = JSON.parse(gh(['api', `repos/${repo}/git/ref/db-coordination%2Fpromotion-freeze`]))
      const commit = JSON.parse(gh(['api', `repos/${repo}/git/commits/${ref?.object?.sha}`]))
      const message = String(commit?.message ?? '')
      const header = /promotion-freeze-record pr=(\d+) issue=(\d+)/.exec(message)
      const record = JSON.parse(message.slice(message.indexOf('{')))
      if (header && record?.acquiredAt) {
        result.freeze = {
          pr: Number(header[1]), issue: Number(header[2]), owner: record.owner ?? 'unknown',
          acquired_at: record.acquiredAt, expires_at: record.expiresAt,
          // The exact user-facing complaint assertNoPromotionFreeze throws
          // (scripts/lib/lanes/exclusive-locks.mjs promotionFreezeText), so a
          // wedged freeze reads exactly like the refusal a merging session saw.
          complaint: `merges are paused for a production run; promotion merge freeze held by ${JSON.stringify(record.owner ?? 'unknown')} for PR #${Number(header[1])} (issue #${Number(header[2])}) until ${record.expiresAt}`,
        }
      }
    } catch { /* no freeze record is the normal state */ }
    return result
  },
  fallbackIssue(repo) {
    return findOrCreateFallback(defaultIo.openIssues(repo), () => {
      const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'alarm-')), 'issue.md')
      writeFileSync(file, 'Stable target for the no-progress alarm while no claim-first session identity resolves (ai-devops#401 Step 4). Created once by the alarm workflow; keep it open.')
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
