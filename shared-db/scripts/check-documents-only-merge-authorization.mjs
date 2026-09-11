#!/usr/bin/env node
// Fail-closed adapter for the #2715 required-status lane. It deliberately uses
// trusted base code in pull_request_target and permits plans as prose while
// retaining the narrower #2102 database-reviewer exemption.
import { pathToFileURL } from 'node:url'
import { classifyLightweightMergePullRequestFiles } from './lib/documents-only-change.mjs'
import { parsePullRequestFilesPayload, readPullRequestFiles } from './check-documents-only-pull-request.mjs'

export function main(argv, deps = {}) {
  const err = deps.err ?? ((text) => process.stderr.write(text))
  const out = deps.out ?? ((text) => process.stdout.write(text))
  const [repo, pullRequest] = argv
  if (argv.length !== 2 || !repo || !/^[0-9]+$/.test(String(pullRequest ?? ''))) {
    err('usage: check-documents-only-merge-authorization.mjs <owner/repo> <pull-request-number>\n')
    return 2
  }
  const read = deps.read ?? (() => readPullRequestFiles(repo, pullRequest))
  let text
  try { text = read() }
  catch (error) {
    err(`REFUSED: the pull request file list could not be read: ${error.message}\n`)
    return 1
  }
  const rows = parsePullRequestFilesPayload(text)
  const verdict = rows ? classifyLightweightMergePullRequestFiles(rows) : { documentsOnly: false, reason: 'the pull request file list was not readable JSON' }
  if (verdict.documentsOnly) {
    out(`documents-only merge authorization: ${verdict.reason}\n`)
    return 0
  }
  out(`not documents-only merge authorization: ${verdict.reason}\n`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
