#!/usr/bin/env node
//
// COUNTS-ONLY ALLOWANCE RECEIPT (shared-db#6772).
//
// The DesignFlow release observer spends two distinct hourly allowances: the
// operator credential's and the App read token's. After a run this prints
// `NAME used=N limit=M` for each, so the log says WHICH allowance moved. It
// never prints a token. An unusable token prints `NAME unavailable` and the
// receipt still exits 0: this step is evidence, not a gate (the workflow runs
// it with continue-on-error).
//
// GitHub is reached through scripts/lib/github-transport.mjs like every other
// read (conformance #2342) — a workflow step must not shell out to `gh api`.
// One attempt, fail fast: a receipt must never hold a runner waiting out a
// quota window.
//
// USAGE
//   node scripts/report-observer-allowance.mjs
//   env: OPERATOR_TOKEN, READ_TOKEN

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ghJson } from './lib/github-transport.mjs'

const RECEIPT_TOKENS = ['OPERATOR_TOKEN', 'READ_TOKEN']

export function main({ env = process.env, log = console.log, run = ghJson } = {}) {
  for (const name of RECEIPT_TOKENS) {
    const token = env[name]
    if (!token) { log(`${name} unavailable`); continue }
    // The receipt must ask AS each token — the two allowances are separate —
    // so the child authenticates with that token while the transport keeps
    // deciding retry policy.
    const executor = (file, argv, options) => execFileSync(file, argv, { ...options, env: { ...env, GH_TOKEN: token } })
    try {
      const { used, limit } = run(['api', 'rate_limit'], { attempts: 1, executor }).resources.core
      log(`${name} used=${used} limit=${limit}`)
    } catch {
      log(`${name} unavailable`)
    }
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
