#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { validateDriftResult } from './report-ledger-drift-status.mjs'
import { runGitHubCommand } from './lib/github-transport.mjs'

export const TITLE = 'MIGRATION LEDGER DRIFT — merged work may not be applied'
export function fingerprint(result) {
  validateDriftResult(result)
  const versions = [...result.drift.actionableMergedNotApplied].sort()
  return createHash('sha256').update(JSON.stringify({ target: result.target, project: result.projectRef, versions: versions.map(v => [v, result.pendingClassifications[v]]), orphans: [...result.drift.appliedNotMerged].sort() })).digest('hex')
}

// Successful monitoring means verified drift is durably reported, never a clean ledger.
// Exact-title enumeration refuses ambiguous alarms; writes are never retried.
export function publishAlarm({ result, report, repository, runUrl, event }, io) {
  const digest = fingerprint(result)
  if (!['push', 'schedule'].includes(event) || result.target !== 'production' || !result.drift.driftFound) throw new Error('automatic alarm requires verified production drift')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !runUrl.startsWith(`https://github.com/${repository}/actions/runs/`) || !/^\d+$/.test(runUrl.split('/').at(-1))) throw new Error('alarm run identity is invalid')
  if (typeof report !== 'string' || !report.trim()) throw new Error('drift report is unreadable')
  const marker = `<!-- ledger-drift-fingerprint:${digest} -->`
  const matches = io.listIssues().filter(row => !row.pull_request && row.state === 'open' && row.title === TITLE)
  if (matches.length > 1) throw new Error('multiple open alarms; refusing ambiguous publication')
  const body = `${marker}\nVerified production drift reported; the ledger is NOT clean.\n\nImmutable report: [workflow run](${runUrl})\n\n${report}\n\nNo production apply was performed. Keep this alarm open until a fresh read-only check proves clearance.\n\nPosted by Codex chat unknown on GitHub Actions\n`
  let issue = matches[0]
  if (!issue) issue = io.createIssue(TITLE, body)
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('alarm issue identity unreadable')
  issue = io.readIssue(issue.number)
  if (issue.state !== 'open' || issue.title !== TITLE || issue.pull_request) throw new Error('alarm issue is no longer open or has changed')
  const comments = io.listComments(issue.number)
  if (!Array.isArray(comments)) throw new Error('alarm comment history unreadable')
  const trustedReport = row => row?.user?.login === 'github-actions[bot]' && /<!-- ledger-drift-fingerprint:[a-f0-9]{64} -->/.test(row.body ?? '') && (row.body ?? '').includes(`https://github.com/${repository}/actions/runs/`)
  const latest = [...comments].sort((a,b) => a.id-b.id).filter(trustedReport).at(-1)
  const current = latest?.body ?? (trustedReport(issue) ? issue.body : '')
  if (!current.includes(marker)) {
    const posted = io.comment(issue.number, body)
    const readback = io.readComment(posted.id)
    if (readback.body !== body) throw new Error('alarm publication readback does not match')
  }
  const finalIssue = io.readIssue(issue.number)
  if (finalIssue.state !== 'open' || finalIssue.title !== TITLE) throw new Error('alarm changed during publication')
  return { issue: issue.number, fingerprint: digest, message: 'Verified drift reported; NOT a clean ledger.' }
}

export function githubIo(repository, run = runGitHubCommand) {
  const json = (args, input) => JSON.parse(run(args, input === undefined ? {} : { input: JSON.stringify(input), attempts: 1 }))
  const root = `repos/${repository}`
  const pages = endpoint => json(['api', '--paginate', '--slurp', endpoint]).flat()
  return {
    listIssues: () => pages(`${root}/issues?state=open&per_page=100`),
    readIssue: n => json(['api', `${root}/issues/${n}`]),
    createIssue: (title,body) => json(['api', '--method', 'POST', `${root}/issues`, '--input', '-'], { title, body, labels: ['db-work'] }),
    listComments: n => pages(`${root}/issues/${n}/comments?per_page=100`),
    comment: (n,body) => json(['api', '--method', 'POST', `${root}/issues/${n}/comments`, '--input', '-'], { body }),
    readComment: id => json(['api', `${root}/issues/comments/${id}`]),
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [jsonFile, reportFile] = process.argv.slice(2)
    console.log(JSON.stringify(publishAlarm({ result: JSON.parse(readFileSync(jsonFile,'utf8')), report: readFileSync(reportFile,'utf8'), repository: process.env.GITHUB_REPOSITORY, runUrl: process.env.RUN_URL, event: process.env.GITHUB_EVENT_NAME }, githubIo(process.env.GITHUB_REPOSITORY))))
  } catch (error) { console.error(`::error::Drift report could not be durably published: ${error.message}`); process.exitCode = 2 }
}
