#!/usr/bin/env node
// Keep exactly one of `orchestrator` / `non-orchestrator` on every shared-db issue.
//
// Owner rule (Albert, 2026-09-17): every issue is explicitly tagged orch or non-orch,
// nothing blank. Rule, from the issue body's `db-work-scope` block:
//   work_type structural | curated-master-data  -> orchestrator
//   any other work_type                          -> non-orchestrator
//   labelled orchestrator-marker / orchestrator-alarm / db-claim -> non-orchestrator
//   no block (or no work_type)                   -> non-orchestrator, plus one comment
//                                                   asking for a block (re-run on edit)
//
// The work_type read is deliberately tolerant. `parseQueueScope` in
// manage-migration-author-lanes.mjs throws on any incomplete block, and an issue whose
// block is incomplete still must not stay unlabelled; the fence pattern is the same.
//
// Authority: an issue that already carries exactly one of the two labels was classified by
// a person or the backfill, so the default (fill) mode leaves it alone and only fixes a
// blank or a both-labels issue. `--authoritative` applies the rule over an existing label;
// the workflow uses it only when the issue is opened or its body is edited.
//
// Usage: node scripts/sync-issue-orchestrator-label.mjs --issue <n> | --all  [--authoritative] [--max-changes <n>] [--dry-run]
import { runGitHubCommand } from './lib/github-transport.mjs'
import { currentRepository } from './lib/repository-identity.mjs'
import { pathToFileURL } from 'node:url'

export const ORCH = 'orchestrator'
export const NON_ORCH = 'non-orchestrator'
export const ORCH_WORK_TYPES = new Set(['structural', 'curated-master-data'])
export const COORDINATION_LABELS = new Set(['orchestrator-marker', 'orchestrator-alarm', 'db-claim'])
export const MISSING_SCOPE_MARKER = '<!-- issue-orch-label-sync:scope-absent -->'
const SCOPE_FENCE = /```db-work-scope\s*\n([\s\S]*?)```/g

export function scopeWorkType(body = '') {
  for (const fence of (body ?? '').matchAll(SCOPE_FENCE)) {
    const m = fence[1].match(/^\s*work_type:\s*([A-Za-z0-9_-]+)\s*$/m)
    if (m) return m[1]
  }
  return null
}

export function classifyIssue(issue, { authoritative = true } = {}) {
  const names = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
  let want
  let needsScope = false
  if (names.some((n) => COORDINATION_LABELS.has(n))) want = NON_ORCH
  else {
    const workType = scopeWorkType(issue.body)
    if (workType === null) { want = NON_ORCH; needsScope = true }
    else want = ORCH_WORK_TYPES.has(workType) ? ORCH : NON_ORCH
  }
  const hasOrch = names.includes(ORCH)
  const hasNon = names.includes(NON_ORCH)
  if (!authoritative && hasOrch !== hasNon) return { want: hasOrch ? ORCH : NON_ORCH, add: [], remove: [], needsScope: false }
  const other = want === ORCH ? NON_ORCH : ORCH
  return {
    want,
    add: names.includes(want) ? [] : [want],
    remove: names.includes(other) ? [other] : [],
    needsScope,
  }
}

export function missingScopeComment() {
  const f = '```'
  return [
    MISSING_SCOPE_MARKER,
    'This issue has no `db-work-scope` block with a `work_type`, so it has been labelled **non-orchestrator**.',
    'If it changes database structure or is a curated Master Data load, edit the issue body to add a block such as:',
    '',
    '````',
    `${f}db-work-scope`,
    'work_type: structural',
    f,
    '````',
    '',
    'The label is recomputed automatically whenever the issue is edited.',
  ].join('\n')
}

// Label adds and removes are idempotent, so the transport may replay them; a comment
// POST is not, so it gets exactly one attempt.
function gh(args, input) {
  const write = args.includes('-X')
  const comment = input !== undefined
  return runGitHubCommand(args, { input, idempotentWrite: write && !comment, attempts: comment ? 1 : 4, maxBuffer: 256 * 1024 * 1024 })
}
const repo = () => currentRepository()

export function syncIssue(issue, { dryRun = false, authoritative = false, run = gh } = {}) {
  if (issue.pull_request) return null
  const plan = classifyIssue(issue, { authoritative })
  const n = issue.number
  const tag = `#${n}: want=${plan.want} add=[${plan.add}] remove=[${plan.remove}]`
  if (dryRun) {
    if (plan.add.length || plan.remove.length) console.log(`DRY ${tag}`)
    return plan
  }
  for (const label of plan.add) run(['api', '-X', 'POST', `repos/${repo()}/issues/${n}/labels`, '-f', `labels[]=${label}`])
  for (const label of plan.remove) run(['api', '-X', 'DELETE', `repos/${repo()}/issues/${n}/labels/${encodeURIComponent(label)}`])
  if (plan.needsScope && issue.state === 'open') {
    const pages = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repo()}/issues/${n}/comments?per_page=100`]))
    if (!pages.flat().some((c) => (c.body ?? '').includes(MISSING_SCOPE_MARKER))) {
      run(['api', '-X', 'POST', `repos/${repo()}/issues/${n}/comments`, '--input', '-'], JSON.stringify({ body: missingScopeComment() }))
      plan.commented = true
    }
  }
  if (plan.add.length || plan.remove.length || plan.commented) console.log(`SYNCED ${tag}${plan.commented ? ' commented' : ''}`)
  return plan
}

function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const authoritative = argv.includes('--authoritative')
  const i = argv.indexOf('--issue')
  let issues
  if (i >= 0) {
    const n = Number(argv[i + 1])
    if (!Number.isInteger(n) || n <= 0) throw new Error('--issue needs an issue number')
    issues = [JSON.parse(gh(['api', `repos/${repo()}/issues/${n}`]))]
  } else if (argv.includes('--all')) {
    issues = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo()}/issues?state=all&per_page=100`])).flat()
  } else throw new Error('usage: --issue <n> | --all [--dry-run]')
  // GITHUB_TOKEN allows ~1000 REST calls an hour, so one sweep stops after a bounded
  // number of changes and the next day's sweep carries on from what is still blank.
  const m = argv.indexOf('--max-changes')
  const maxChanges = m >= 0 ? Number(argv[m + 1]) : Infinity
  let changed = 0
  let checked = 0
  for (const issue of issues) {
    if (changed >= maxChanges) { console.log(`stopped at --max-changes ${maxChanges}; the next sweep continues`); break }
    const plan = syncIssue(issue, { dryRun, authoritative })
    if (!plan) continue
    checked++
    if (plan.add.length || plan.remove.length) changed++
  }
  console.log(`checked ${checked} issue(s); ${changed} label change(s)${dryRun ? ' planned' : ''}`)
  if (checked === 0 && i >= 0) throw new Error('target was not an issue')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(process.argv.slice(2)) } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1) }
}
