#!/usr/bin/env node
// Issue #2437 CLI. Two modes, both read-only and without database contact:
//   --issue-body-file <path> [--labels <comma list>]
//       Fails when the labels include `destructive-proposal` and the body lacks a
//       required checklist heading or leaves one empty.
//   --diff-base <git ref>
//       Fails when SQL added since the base introduces a destructive DROP /
//       TRUNCATE / VACUUM FULL / DELETE without WHERE outside migrations and test
//       fixtures, unless the same file carries `-- destructive-proposal: #<issue>`
//       AND every issue it names exists, carries the label and has a complete
//       checklist. Issues are read with `gh api`; an unreadable issue fails closed.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ghJson } from './lib/github-transport.mjs'
import { currentRepository } from './lib/repository-identity.mjs'
import { PROPOSAL_LABEL, REQUIRED_HEADINGS, checkProposalBody, findDestructiveSql, findMarkedDestructiveSql, checkMarkerIssue } from './lib/destructive-analysis-guard.mjs'

export function fetchIssueWithGh(number, repo = currentRepository()) {
  const notFound = /HTTP 404|Not Found/i
  let issue
  try {
    issue = ghJson(['api', `repos/${repo}/issues/${number}`], { expectedFailure: notFound })
  } catch (e) {
    if (notFound.test(`${e.stderr ?? ''}${e.stdout ?? ''}${e.message ?? ''}`)) return null
    throw new Error(`could not read issue #${number}: ${String(e.message).trim().split('\n')[0]}`)
  }
  return { labels: (issue.labels ?? []).map((l) => l.name), body: issue.body ?? '', isPullRequest: Boolean(issue.pull_request) }
}

const defaultIo = {
  readFile: (p) => readFileSync(p, 'utf8'),
  diff: (base) => execFileSync('git', ['diff', '--unified=0', '--no-ext-diff', `${base}...HEAD`, '--', '*.sql'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
  fetchIssue: fetchIssueWithGh,
  log: console.log,
  error: console.error,
}

export function main(argv, io = defaultIo) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const bodyFile = arg('--issue-body-file')
  const base = arg('--diff-base')
  if (bodyFile !== undefined) {
    const labels = String(arg('--labels') ?? '').split(',').map((l) => l.trim().toLowerCase()).filter(Boolean)
    if (!labels.includes(PROPOSAL_LABEL)) { io.log(`Issue is not labeled ${PROPOSAL_LABEL}; checklist not required.`); return 0 }
    const result = checkProposalBody(io.readFile(bodyFile))
    if (result.ok) { io.log(`Destructive-proposal checklist complete: ${REQUIRED_HEADINGS.join(', ')}.`); return 0 }
    if (result.absent.length) io.error(`ERROR: destructive-proposal issue body is absent heading(s): ${result.absent.join(', ')}`)
    if (result.empty.length) io.error(`ERROR: destructive-proposal issue body leaves heading(s) empty: ${result.empty.join(', ')}`)
    io.error('Absence is not proof (#2437). Use .github/ISSUE_TEMPLATE/destructive-proposal.md and fill every section in the BODY, not a comment.')
    return 1
  }
  if (base !== undefined) {
    const diff = io.diff(base)
    const findings = findDestructiveSql(diff)
    const rejected = []
    const cache = new Map()
    for (const { file, kinds, issues } of findMarkedDestructiveSql(diff)) {
      for (const n of issues) {
        if (!cache.has(n)) {
          try { cache.set(n, checkMarkerIssue(io.fetchIssue(n))) } catch (e) { cache.set(n, `could not be verified (${e.message})`) }
        }
        if (cache.get(n)) rejected.push({ file, kinds, issue: n, reason: cache.get(n) })
      }
    }
    if (!findings.length && !rejected.length) { io.log('No unmarked or unverified destructive SQL added outside migrations.'); return 0 }
    io.error('ERROR: destructive SQL added outside the migration path (#2437):')
    for (const f of findings) io.error(`  ${f.file}: ${f.kinds.join(', ')}`)
    for (const r of rejected) io.error(`  ${r.file}: ${r.kinds.join(', ')} — marker issue #${r.issue} ${r.reason}`)
    io.error('Add `-- destructive-proposal: #<issue>` naming an existing destructive-proposal issue whose checklist is complete, or remove the statement.')
    return 1
  }
  io.error('usage: check-destructive-analysis.mjs --issue-body-file <path> [--labels <list>] | --diff-base <ref>')
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2))
