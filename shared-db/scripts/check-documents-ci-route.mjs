#!/usr/bin/env node
// TRUSTED PURE-PROSE FAST CI ROUTE (issue #3383).
//
// A true prose-only pull request may use a trusted fast CI path and skip the
// engineering suites. Anything else -- code, migrations, executable agent
// instructions, symlinks, executable modes -- retains the full path. The proof
// is an EXACT base/head Git inventory including file modes, not a guess from
// extensions alone.
//
// Fail closed on misclassification. An unreadable inventory, an unknown status,
// an unknown mode, a missing git object, a parse that does not finish cleanly:
// every one of these refuses the fast route and forces the full engineering
// path. The only exit that skips engineering suites is exit 0, and exit 0 is
// earned only by a complete inventory of non-rulebook prose documents at the
// regular non-executable mode.
//
// Runs as trusted base code. In CI this script is taken from the protected
// base, never from the pull request head, so a head cannot rewrite its own
// classifier. The head is used only as a git object to diff against.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { classifyProseGitInventory, parseGitRawInventory } from './lib/documents-only-change.mjs'

const SHA_LIKE = /^[0-9a-f]{7,40}$|^[A-Za-z0-9._\/-]+$/

export function usage () {
  return 'usage: check-documents-ci-route.mjs <base-sha> <head-sha>\n'
}

// The exact inventory of what changed between base and head, straight from git.
// `--no-abbrev` keeps the record fully specified; `-z` keeps paths with spaces
// or quotes unambiguous. Any git failure is a refusal, never a clean pass.
export function readGitRawInventory (base, head, spawn = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) {
  return spawn(['diff', '--raw', '--no-abbrev', '-z', '--no-color', base, head])
}

// Judge a raw inventory string. The parse and the classification both fail
// closed: a null parse or a non-pure-prose verdict becomes the full path.
export function classifyCiRouteFromGitRaw (raw) {
  const entries = parseGitRawInventory(raw)
  if (!entries) return { pureProse: false, reason: 'the raw git inventory could not be parsed; refusing the fast route' }
  return classifyProseGitInventory(entries)
}

export function main (argv, deps = {}) {
  const err = deps.err ?? ((text) => process.stderr.write(text))
  const out = deps.out ?? ((text) => process.stdout.write(text))
  const [base, head] = argv
  if (argv.length !== 2 || !base || !head || !SHA_LIKE.test(String(base)) || !SHA_LIKE.test(String(head))) {
    err(usage())
    return 2
  }
  const spawn = deps.spawn
  let raw
  try {
    raw = deps.raw ?? readGitRawInventory(base, head, spawn)
  } catch (error) {
    out(`full-ci-route: the git inventory could not be read: ${error.message}\n`)
    return 1
  }
  const verdict = classifyCiRouteFromGitRaw(raw)
  if (verdict.pureProse) {
    out(`pure-prose-fast-ci: ${verdict.reason}\n`)
    return 0
  }
  out(`full-ci-route: ${verdict.reason}\n`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
