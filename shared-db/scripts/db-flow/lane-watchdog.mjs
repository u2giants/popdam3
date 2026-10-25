#!/usr/bin/env node
//
// LANE WATCHDOG (2026-10-23 incident, issue #2729 lane programme)
// ================================================================
//
// On 2026-10-23 conflict markers committed into a workflow file meant the
// queue-sensitive lane jobs created ZERO check runs for every pull request,
// while "Queue-sensitive checks (aggregate)" (pr-guards.yml) waited up to 50
// minutes on assertions that could never start. Every PR sat unmergeable for
// hours with nothing red: the missing lane context is invisible to a wait
// that only counts check runs that exist.
//
// Every 10 minutes (.github/workflows/lane-watchdog.yml) this script lists
// the open pull requests, and for each PR whose head commit is older than
// five minutes checks whether every context registered in
// scripts/db-flow/runner-lanes.json (queue_sensitive_jobs) has at least one
// check run — ANY status, including the lane-suffixed replacement names
// ("<context> [lane <label>]") — on that head. A context with ZERO check
// runs gets one replacement dispatch of its owning workflow for the PR head
// ref, exactly ONCE per head: before planning a dispatch the workflow's
// recent workflow_dispatch runs for that ref are read, and any run already
// bound to this head_sha makes the watchdog stand down for that head. A new
// push moves the head and earns exactly one fresh dispatch.
//
// WHAT IT NEVER DOES
// ------------------
// It never merges, never pushes, never creates, updates or deletes a ref,
// never touches the database. Structurally: every GitHub read goes through
// scripts/lib/github-transport.mjs (the one shared transport, #2342), and
// the ONLY write is the single workflow-dispatch POST
// (POST /repos/:repo/actions/workflows/:wf/dispatches) issued through the
// same transport, which runs a mutation exactly once and never replays it.
// It cannot push a commit or move a ref because it never asks GitHub to.
//
// EXIT CODES: 0 ran (findings or none); 1 a dispatch attempt failed; 2 the
// state could not be read (an instrument that could not read must never be
// mistaken for "no findings" — same discipline as queue-hygiene-report).
//
// Run: node scripts/db-flow/lane-watchdog.mjs --repo owner/name [--min-age-minutes 5] [--dry-run]

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegistry, fetchCheckRuns } from './runner-lanes.mjs'
import { runGitHubCommand } from '../lib/github-transport.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/
const SAFE_REF = /^[A-Za-z0-9._\/-]+$/
const DEFAULT_MIN_HEAD_AGE_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Pure decision logic (unit-tested offline in lane-watchdog.test.mjs).
// ---------------------------------------------------------------------------

/** The registered lane contexts the watchdog owes every PR head. */
export function laneContextJobs(registry) {
  return registry.queue_sensitive_jobs
}

/**
 * Does this head have at least one check run for the context — any status —
 * under the stable name or a lane-suffixed replacement name?
 */
export function contextHasCheckRun(context, checkRuns) {
  return (checkRuns ?? []).some((run) => {
    const name = String(run?.name ?? '')
    return name === context || (name.startsWith(`${context} [lane `) && name.endsWith(']'))
  })
}

/**
 * Age of a PR head in milliseconds, from the head commit's committer date
 * (falling back to the author date). Null when the commit is unknown — the
 * caller must then skip, not guess.
 */
export function headAgeMs(commit, nowMs) {
  const date = commit?.commit?.committer?.date ?? commit?.commit?.author?.date
  if (!date) return null
  const t = Date.parse(date)
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : null
}

/**
 * The dispatch plan. Inputs are plain data so the whole decision is testable
 * offline:
 *
 *   registry   — runner-lanes.json contents (queue_sensitive_jobs lanes)
 *   repo       — owner/name, used to detect fork heads
 *   pulls      — REST pulls entries: {number, head:{sha, ref, repo:{full_name}}}
 *   commitsBySha        — {sha: commit response} (for head age)
 *   checkRunsBySha      — {sha: [{name, status, conclusion}]}
 *   dispatchRunsByWorkflowRef — {"<workflow>|<ref>": [{head_sha}]} recent
 *                        workflow_dispatch runs (the loop-safety read)
 *   nowMs      — evaluation instant
 *   minHeadAgeMs — grace before a missing context counts (default 5 min)
 *
 * Returns { dispatches, notes } where dispatches is deduplicated by
 * (workflow, ref, head_sha): a dispatch happens at most once per head even
 * if two PRs share it. Nothing here performs the dispatch.
 */
export function planDispatches({
  registry,
  repo,
  pulls,
  commitsBySha = {},
  checkRunsBySha = {},
  dispatchRunsByWorkflowRef = {},
  nowMs = Date.now(),
  minHeadAgeMs = DEFAULT_MIN_HEAD_AGE_MS,
}) {
  const jobs = laneContextJobs(registry)
  const dispatches = []
  const notes = []
  const planned = new Set()

  for (const pull of pulls ?? []) {
    const number = pull?.number
    const headSha = pull?.head?.sha
    const headRef = pull?.head?.ref
    if (!Number.isInteger(number) || !headSha || !headRef) continue
    if (pull.head.repo?.full_name && pull.head.repo.full_name !== repo) {
      notes.push({ pr: number, action: 'skip-fork-head', reason: `head lives in ${pull.head.repo.full_name}; a dispatch in ${repo} cannot run it` })
      continue
    }
    const age = headAgeMs(commitsBySha[headSha], nowMs)
    if (age === null) {
      notes.push({ pr: number, action: 'skip-unreadable-head', reason: 'head commit date unknown; refusing to guess' })
      continue
    }
    if (age < minHeadAgeMs) {
      notes.push({ pr: number, action: 'skip-young-head', reason: `head is ${Math.round(age / 1000)}s old (< ${Math.round(minHeadAgeMs / 1000)}s grace); CI may still be starting` })
      continue
    }
    const checkRuns = checkRunsBySha[headSha] ?? []
    for (const job of jobs) {
      if (contextHasCheckRun(job.context, checkRuns)) continue
      const priorDispatches = dispatchRunsByWorkflowRef[`${job.workflow}|${headRef}`] ?? []
      if (priorDispatches.some((run) => run?.head_sha === headSha)) {
        notes.push({ pr: number, action: 'skip-already-dispatched', context: job.context, reason: `a workflow_dispatch run of ${job.workflow} already exists for head ${headSha.slice(0, 10)}` })
        continue
      }
      const dedupeKey = `${job.workflow}|${headRef}|${headSha}`
      if (planned.has(dedupeKey)) continue
      planned.add(dedupeKey)
      dispatches.push({
        pr: number,
        workflow: job.workflow,
        context: job.context,
        ref: headRef,
        head_sha: headSha,
        reason: `context "${job.context}" has zero check runs on head ${headSha.slice(0, 10)} (${Math.round(age / 60000)}m old)`,
      })
    }
  }
  return { dispatches, notes }
}

// ---------------------------------------------------------------------------
// Live pass. Every read goes through the shared transport; the dispatch POST
// is the only write and is issued exactly once by the transport's
// mutation policy (a mutating call never retries).
// ---------------------------------------------------------------------------

function argValue(argv, flag) { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }

function transportIo({ log = console.log } = {}) {
  return {
    readJson(args) {
      return JSON.parse(runGitHubCommand(args))
    },
    dispatchWorkflow(repo, workflow, ref) {
      if (!REPO_SLUG.test(repo)) throw new Error(`refusing unsafe repo slug: ${repo}`)
      if (!SAFE_REF.test(ref) || ref.includes('..')) throw new Error(`refusing unsafe ref: ${ref}`)
      // A mutation: the transport issues it exactly once, never replays it.
      runGitHubCommand([
        'api', '-X', 'POST',
        `repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
        '-f', `ref=${ref}`,
      ])
    },
    log,
  }
}

/** Read every open pull request, refusing a truncated listing. */
export function readOpenPulls(io, repo) {
  const pulls = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = io.readJson(['api', `repos/${repo}/pulls?state=open&per_page=100&page=${page}`])
    if (!Array.isArray(batch)) throw new Error('pull listing did not return an array; refusing rather than judge a partial read')
    pulls.push(...batch)
    if (batch.length < 100) return pulls
  }
  throw new Error('pull listing exceeded 10 pages; refusing rather than judge a partial read')
}

export function runWatchdog({
  repo,
  registry = loadRegistry(),
  io = transportIo(),
  nowMs = Date.now(),
  minHeadAgeMs = DEFAULT_MIN_HEAD_AGE_MS,
  dryRun = false,
} = {}) {
  if (!REPO_SLUG.test(String(repo ?? ''))) throw new Error('--repo owner/name (or GITHUB_REPOSITORY) is required')
  const pulls = readOpenPulls(io, repo)
  const notes = []
  const commitsBySha = {}
  const checkRunsBySha = {}
  for (const pull of pulls) {
    if (pull.head.repo?.full_name && pull.head.repo.full_name !== repo) continue // fork heads never need reads
    const sha = pull.head.sha
    const commit = io.readJson(['api', `repos/${repo}/commits/${sha}`])
    commitsBySha[sha] = commit
    const age = headAgeMs(commit, nowMs)
    if (age === null || age < minHeadAgeMs) continue
    // Reuse the proven, page-validated reader from the lane programme so the
    // "zero check runs" verdict is never made from a truncated listing.
    const runs = readCheckRunsForHead(io, repo, sha)
    checkRunsBySha[sha] = runs
  }
  // Loop-safety read only where a context is actually missing.
  const probe = planDispatches({ registry, repo, pulls, commitsBySha, checkRunsBySha, nowMs, minHeadAgeMs })
  const dispatchRunsByWorkflowRef = {}
  for (const candidate of probe.dispatches) {
    const key = `${candidate.workflow}|${candidate.ref}`
    if (key in dispatchRunsByWorkflowRef) continue
    const answer = io.readJson(['api', `repos/${repo}/actions/workflows/${encodeURIComponent(candidate.workflow)}/runs?branch=${encodeURIComponent(candidate.ref)}&event=workflow_dispatch&per_page=30`])
    dispatchRunsByWorkflowRef[key] = Array.isArray(answer?.workflow_runs) ? answer.workflow_runs : []
  }
  const plan = planDispatches({ registry, repo, pulls, commitsBySha, checkRunsBySha, dispatchRunsByWorkflowRef, nowMs, minHeadAgeMs })
  notes.push(...plan.notes)
  const log = io.log ?? console.log
  for (const note of notes) {
    if (note.action === 'skip-young-head') continue // the normal state; not worth a log line every 10 minutes
    log(`PR #${note.pr}: ${note.action}${note.context ? ` (${note.context})` : ''}: ${note.reason}`)
  }
  if (!plan.dispatches.length) {
    log(`lane watchdog: ${pulls.length} open pull request(s); every registered lane context has a check run where it must.`)
    return { dispatches: [], notes, failures: [] }
  }
  const failures = []
  for (const dispatch of plan.dispatches) {
    if (dryRun) {
      log(`PR #${dispatch.pr}: DRY-RUN would dispatch ${dispatch.workflow} on ${dispatch.ref} — ${dispatch.reason}`)
      continue
    }
    try {
      io.dispatchWorkflow(repo, dispatch.workflow, dispatch.ref)
      log(`PR #${dispatch.pr}: dispatched ${dispatch.workflow} on ${dispatch.ref} — ${dispatch.reason}`)
    } catch (error) {
      failures.push({ dispatch, error: error?.message ?? String(error) })
      log(`PR #${dispatch.pr}: DISPATCH FAILED ${dispatch.workflow} on ${dispatch.ref}: ${error?.message ?? error}`)
    }
  }
  return { dispatches: plan.dispatches, notes, failures }
}

// Same pagination contract as the aggregate reader (fetchCheckRuns in
// runner-lanes.mjs): every page, filter=all, refusal on a partial read.
function readCheckRunsForHead(io, repo, sha) {
  return fetchCheckRuns(repo, sha, { readJson: (args) => io.readJson(args) })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  try {
    const minAgeMinutes = Number(argValue(argv, '--min-age-minutes') ?? 5)
    const result = runWatchdog({
      repo: argValue(argv, '--repo') ?? process.env.GITHUB_REPOSITORY,
      minHeadAgeMs: Math.max(0, minAgeMinutes) * 60000,
      dryRun: argv.includes('--dry-run'),
    })
    if (result.failures.length) process.exit(1)
  } catch (error) {
    console.error(`lane watchdog: could not read the state: ${error?.message ?? error}`)
    process.exit(2)
  }
}
