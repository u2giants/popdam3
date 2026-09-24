#!/usr/bin/env node
// Trusted, fail-closed preflight for the fast document handover lane (#2596).
//
// This script deliberately answers a narrow question: whether the complete PR
// file list proves the expensive ephemeral database contract test inapplicable.
// It does not authorize a merge, waive any required context, or infer handover
// ownership. Those remain the guarded merge's job.
import { pathToFileURL } from 'node:url'
import { readPullRequestFiles, classifyPullRequestFilesPayload } from './check-documents-only-pull-request.mjs'

export class CloseoutReadinessError extends Error {}

export function evaluateCloseoutReadiness({ repository, pullRequest, policySha, filesPayload }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repository ?? ''))) {
    throw new CloseoutReadinessError('repository must be an owner/repository name')
  }
  if (!/^[1-9]\d*$/.test(String(pullRequest ?? ''))) {
    throw new CloseoutReadinessError('pull request must be a positive number')
  }
  if (!/^[0-9a-f]{40}$/i.test(String(policySha ?? ''))) {
    throw new CloseoutReadinessError('policy SHA must be a 40-character commit SHA')
  }

  const classification = classifyPullRequestFilesPayload(filesPayload)
  const databaseContract = classification.documentsOnly ? 'inapplicable' : 'applicable'
  return {
    repository,
    pull_request: Number(pullRequest),
    policy_sha: String(policySha).toLowerCase(),
    documents_only: classification.documentsOnly,
    reason: classification.reason,
    gates: {
      database_contract_tests: databaseContract,
      agent_work_contract: classification.documentsOnly ? 'documents-only-exemption' : 'applicable',
      database_reviewer: classification.documentsOnly ? 'no-draw-required' : 'applicable',
      handoff_contract: 'applicable',
      guarded_merge: 'applicable',
    },
    next_action: classification.documentsOnly
      ? 'run the truthful inapplicable database-contract context; all other gates remain required'
      : 'run the database contract tests and every other applicable gate',
  }
}

export function parseArgs(argv) {
  const [repository, pullRequest, policySha, ...rest] = argv
  if (rest.length || !repository || !pullRequest || !policySha) {
    throw new CloseoutReadinessError('usage: check-closeout-readiness.mjs <owner/repo> <pull-request-number> <trusted-policy-sha>')
  }
  return { repository, pullRequest, policySha }
}

export function main(argv, deps = {}) {
  const out = deps.out ?? ((text) => process.stdout.write(text))
  const err = deps.err ?? ((text) => process.stderr.write(text))
  try {
    const { repository, pullRequest, policySha } = parseArgs(argv)
    const read = deps.read ?? readPullRequestFiles
    const filesPayload = read(repository, pullRequest)
    const result = evaluateCloseoutReadiness({ repository, pullRequest, policySha, filesPayload })
    out(`${JSON.stringify(result)}\n`)
    return result.gates.database_contract_tests === 'inapplicable' ? 0 : 1
  } catch (error) {
    err(`REFUSED: ${error.message}\n`)
    return 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2))
