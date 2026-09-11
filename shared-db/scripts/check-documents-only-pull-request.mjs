#!/usr/bin/env node
// ONE CLASSIFIER, TWO GATES (issue #2591).
//
// The reviewer draw already exempts a prose-only pull request from the small
// external database-reviewer pool (#2102). The `Agent work contract` gate did
// not know that rule, so it still demanded the `.agent/contract.json` +
// `.agent/completion.json` pair from a pull request that changes nothing but
// documents. Adding that pair to satisfy it then made the change stop being
// documents-only -- `.json` is not a document extension -- so the exemption was
// cancelled by the act of qualifying for the other gate. A prose-only change
// could satisfy either gate but never both.
//
// This wrapper exists so BOTH gates ask the SAME function the SAME question. It
// reads the GitHub pull-request files payload itself, so it judges the pull
// request against its base rather than whatever the runner has on disk, and it
// carries the previous name of every rename. Unreadable or empty input is NOT
// documents-only: "we could not tell" must cost the full treatment.
//
// The read goes through the ONE shared GitHub transport (#2342), never a raw
// `gh api` in a workflow step, so the retry policy and the transient/semantic
// classifier stay decided in a single place.
import { pathToFileURL } from 'node:url'
import { ghJson } from './lib/github-transport.mjs'
import { changedPathsFromPullRequestFiles, classifyChangedPaths } from './lib/documents-only-change.mjs'

export function readPullRequestFiles(repo, pullRequest) {
  return JSON.stringify(ghJson(
    ['api', `repos/${repo}/pulls/${pullRequest}/files?per_page=100`, '--paginate', '--slurp'],
    { wrapError: (detail, cause) => new Error(`${detail}${cause ? `: ${cause.message}` : ''}`) },
  ))
}

export function parsePullRequestFilesPayload(text) {
  let rows
  try { rows = JSON.parse(String(text ?? '')) }
  catch { return null }
  // `gh api --paginate --slurp` returns ONE ARRAY PER PAGE, so a pull request
  // with more than 100 files arrives as an array of arrays. Flatten exactly one
  // level, and only when every entry is an array: a mixed shape is unreadable
  // input, and unreadable input is never documents-only.
  if (Array.isArray(rows) && rows.length && rows.every((row) => Array.isArray(row))) rows = rows.flat()
  return Array.isArray(rows) ? rows : null
}

export function classifyPullRequestFilesPayload(text, classifier = classifyChangedPaths) {
  const rows = parsePullRequestFilesPayload(text)
  if (!rows) return { documentsOnly: false, reason: 'the pull request file list was not readable JSON' }
  const paths = changedPathsFromPullRequestFiles(rows)
  if (!paths) return { documentsOnly: false, reason: 'the pull request file list was not an array' }
  return classifier(paths)
}

export function main(argv, deps = {}) {
  const err = deps.err ?? ((text) => process.stderr.write(text))
  const out = deps.out ?? ((text) => process.stdout.write(text))
  const [repo, pullRequest] = argv
  if (argv.length !== 2 || !repo || !/^[0-9]+$/.test(String(pullRequest ?? ''))) {
    err('usage: check-documents-only-pull-request.mjs <owner/repo> <pull-request-number>\n')
    return 2
  }
  const read = deps.read ?? (() => readPullRequestFiles(repo, pullRequest))
  let text
  try {
    text = read()
  } catch (error) {
    err(`REFUSED: the pull request file list could not be read: ${error.message}\n`)
    return 1
  }
  const verdict = classifyPullRequestFilesPayload(text)
  if (verdict.documentsOnly) {
    out(`documents-only: ${verdict.reason}\n`)
    return 0
  }
  out(`not documents-only: ${verdict.reason}\n`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
