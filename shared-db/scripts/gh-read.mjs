#!/usr/bin/env node
//
// THE SHELL'S FRONT DOOR ONTO THE ONE SHARED GITHUB TRANSPORT (issue #2342).
//
// WHY THIS EXISTS RATHER THAN A `gh api` CALL IN THE WORKFLOW
// -----------------------------------------------------------
// Governed workflows read evidence with bare `gh api` under `set -euo
// pipefail`. Two of those calls run while the guarded merge holds the EXCLUSIVE
// merge lock, and preview-ledger-orphan-reconciliation makes seven in a row.
// Under `set -e` a single spurious 502 does not just fail the read — it aborts
// the step, and in the merge-lock case it aborts while holding a lock that the
// next lane is queued behind. That is the same failure that stopped three
// production applies in a row (runs 33920952504, 33921168245, 33921406952).
//
// A shell function with its own retry loop would have been a SECOND transport,
// with its own classifier drifting away from the Node one. This is a thin CLI
// over scripts/lib/github-transport.mjs instead: one module decides what is
// transient, what may be replayed, and when to fail closed. Two front doors,
// one policy.
//
// USAGE
//   node scripts/gh-read.mjs <gh args...>        # e.g. api repos/o/r/pulls/1
//   node scripts/gh-read.mjs --out FILE <args...>
//
// It writes gh's stdout to stdout (or to --out) and exits non-zero, loudly, on
// a failure the transport did not recover — so `set -e` still stops the step
// for a REAL fault. Nothing this reads is relaxed; only spurious transport
// failures are absorbed.
//
// READS ONLY, BY REFUSAL. A mutation is rejected before it is issued: `gh` and
// this wrapper cannot tell "the write never landed" from "it landed and the
// response was lost", so replaying one could post a second comment or set a
// status twice. Workflows keep issuing their writes with `gh api` directly,
// where they get exactly one attempt, which is the correct policy for a write.

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runGitHubCommand, isMutatingCall } from './lib/github-transport.mjs'

export function parseArgv(argv) {
  const args = [...argv]
  let out = null
  const rest = []
  while (args.length) {
    const token = args.shift()
    if (token === '--out') {
      out = args.shift() ?? null
      if (!out) throw new Error('--out needs a file path')
    } else if (token === '--') {
      rest.push(...args)
      break
    } else {
      rest.push(token)
    }
  }
  return { out, args: rest }
}

export function main(argv, { log = (t) => process.stdout.write(t), err = console.error, run = runGitHubCommand } = {}) {
  let parsed
  try {
    parsed = parseArgv(argv)
  } catch (error) {
    err(`::error::gh-read: ${error.message}`)
    return 2
  }
  if (parsed.args.length === 0) {
    err('::error::gh-read: no gh arguments given')
    return 2
  }
  if (isMutatingCall(parsed.args)) {
    err(`::error::gh-read is for READS only and refuses to issue a mutation: gh ${parsed.args.join(' ')}`)
    return 2
  }
  let body
  try {
    // `--out` is also used for artifact zip downloads. Keep bytes as bytes;
    // decoding arbitrary binary data as UTF-8 corrupts it before unzip.
    body = run(parsed.args, { encoding: parsed.out ? null : 'utf8' })
  } catch (error) {
    // Fail closed and loudly. The step must still stop for a real fault.
    err(`::error::gh-read failed after retries: ${error.message}`)
    return 1
  }
  if (parsed.out) writeFileSync(parsed.out, body)
  else log(body)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
