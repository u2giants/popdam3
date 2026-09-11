#!/usr/bin/env node
//
// GITHUB TRANSPORT CONFORMANCE (issue #2342)
// ==========================================
//
// WHAT THIS REFUSES, AND WHY IT HAD TO BECOME MECHANICAL
// ------------------------------------------------------
// Three consecutive production-apply runs (33920952504, 33921168245,
// 33921406952) each refused promotion while naming a DIFFERENT existing file.
// That is the signature of a spurious read, not a real fault. The survey that
// followed found EIGHT independently hand-rolled `gh` wrappers under scripts/,
// of which exactly TWO retried anything, plus workflow steps making bare
// `gh api` calls under `set -euo pipefail` — two of them while holding the
// merge lock.
//
// Nothing caught that. There was no lint rule, no conformance test, and no
// documented rule about GitHub reads anywhere in AGENTS.md, docs/ or any
// plan_*.md. A ninth wrapper could be added tomorrow by anyone, in good faith,
// and the repository would look exactly as healthy as it did the day before the
// three failed runs.
//
// So this is not advice. It fails the build.
//
// THE RULE
// --------
//   * Node code under scripts/ reaches GitHub ONLY through
//     scripts/lib/github-transport.mjs.
//   * A workflow step under .github/workflows/ may not invoke `gh api`
//     directly; it calls a script that goes through the transport.
//   * No gate builds a per-file Contents URL. File content comes from
//     scripts/lib/github-tree.mjs: one recursive tree read per ref, then blobs
//     by SHA. That is the change that removes the failure; the retry policy is
//     only the backstop for the irreducible single call.
//
// WHAT IS DELIBERATELY *NOT* FORBIDDEN
// ------------------------------------
//   * `gh` subcommands in workflows that are not `gh api` and carry no
//     governed evidence (e.g. `gh release download` in a setup step). The rule
//     targets the evidence path, and a rule broader than its evidence gets
//     suppressed rather than obeyed.
//   * The transport module itself, and test files, which must be free to fake a
//     transport in order to prove it fails correctly.
//
// PROVING THIS CHECK CAN FAIL
// ---------------------------
// A guard that has only ever seen clean input has not been tested. The sibling
// test feeds this checker a KNOWN-DIRTY tree — a synthetic file containing each
// forbidden shape — and asserts it refuses, before any assertion is made about
// the real tree. A green run on clean input proves nothing.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const TRANSPORT_MODULE = 'scripts/lib/github-transport.mjs'

export const TREE_MODULE = 'scripts/lib/github-tree.mjs'

// The two modules that may reach GitHub themselves: the transport, and the tree
// reader that is the only permitted way to read a file's content.
export const EXEMPT_FILES = new Set([TRANSPORT_MODULE, TREE_MODULE])

/** A test file may fake a transport; that is how the transport is proven. */
export function isTestFile(relPath) {
  return /\.test\.mjs$/.test(relPath) || /(^|\/)tests?\//.test(relPath)
}

// A direct spawn of the `gh` binary from Node.
const NODE_GH_SPAWN =
  /\b(?:execFileSync|execFile|spawnSync|spawn)\s*\(\s*(['"`])gh\1/

// A shell string handed to execSync/exec that starts a `gh` command.
const NODE_GH_SHELL =
  /\b(?:execSync|exec)\s*\(\s*[`'"][^`'"]*\bgh\s+(?:api|issue|pr|run|release|repo|search|api)\b/

// `gh api` inside a workflow `run:` block. Matched at a word boundary so
// `# gh api` in a comment is still matched (a commented example that gets
// uncommented is exactly how the eighth wrapper appeared) but `foo-gh api` is
// not.
const WORKFLOW_GH_API = /(?<![\w-])gh\s+api\b/

// Issue #2342 requirement 4: NO gate may make a per-file Contents call.
//
// This is the rule that actually removes the failure. A Contents URL is built
// per file and per ref, so a gate comparing every open pull request made up to
// 112 of them in sequence and any single spurious one refused promotion --
// which is exactly what stopped three production applies in a row, each naming
// a different file that existed. One recursive tree read per ref answers every
// path at once, and scripts/lib/github-tree.mjs is the only place that reads a
// blob. A count-based rule ("no more than one per ref") could not be enforced
// statically and would drift; forbidding the shape outright can be.
const NODE_CONTENTS_CALL = /repos\/[^`'"]*\/contents\//

export function scanNodeSource(relPath, text) {
  if (EXEMPT_FILES.has(relPath) || isTestFile(relPath)) return []
  const findings = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (NODE_GH_SPAWN.test(line)) {
      findings.push({ file: relPath, line: i + 1, rule: 'node-gh-spawn', text: line.trim() })
    } else if (NODE_GH_SHELL.test(line)) {
      findings.push({ file: relPath, line: i + 1, rule: 'node-gh-shell', text: line.trim() })
    } else if (NODE_CONTENTS_CALL.test(line)) {
      findings.push({ file: relPath, line: i + 1, rule: 'node-per-file-contents-call', text: line.trim() })
    }
  })
  return findings
}

// A workflow WRITE stays a direct `gh api` call, and that is the correct policy,
// not an exemption grudgingly granted. Neither `gh` nor any wrapper can tell "the
// request never landed" from "it landed and the response was lost", so a replayed
// write can set a status twice or post a second comment. A write therefore gets
// exactly one attempt whichever door it goes through, and routing it through
// scripts/gh-read.mjs would buy nothing — that script refuses mutations outright.
// Only READS are covered here, because only reads are safe to retry and only
// reads were what stalled the three production applies.
const SHELL_WRITE_MARKERS =
  /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?:\s|=)|(?:^|\s)(?:-X\s*|--method[\s=])(?:POST|PATCH|PUT|DELETE)\b/i

export function isWorkflowWrite(line) {
  return SHELL_WRITE_MARKERS.test(line)
}

/**
 * Heredoc BODIES are data, not commands.
 *
 * orchestrator-marker-guard.yml writes an alarm issue whose body tells a human
 * "check by hand: gh api …". That text is never executed. Flagging it would
 * force a maintainer either to mangle a genuinely useful instruction or to
 * switch the guard off, and a guard that cries wolf on prose is a guard people
 * learn to ignore. Everything between `<<TOKEN` and a line that is only TOKEN is
 * skipped.
 */
export function stripHeredocBodies(text) {
  const lines = text.split(/\r?\n/)
  let token = null
  return lines.map((line) => {
    if (token !== null) {
      if (line.trim() === token) { token = null }
      return ''
    }
    // The token need not end the line: `cat <<BODY > issue.md` is the common
    // shape, and anchoring at end-of-line made the scanner miss the opener and
    // then flag the prose inside the body.
    const open = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (open) token = open[2]
    return line
  }).join('\n')
}

/**
 * Join shell line continuations before classifying.
 *
 * This is not tidiness. The two status WRITES in shared-supabase-migrations.yml
 * put `gh api "…/statuses/$sha"` on one line and their `-f state=…` fields on the
 * next, so a line-at-a-time scanner reads a write as a read and demands it be
 * routed through a script that refuses writes — an unsatisfiable instruction.
 * A guard that gives an impossible order gets switched off, so it must read the
 * whole command.
 */
export function joinContinuations(text) {
  const out = []
  let buffer = null
  let startLine = 0
  text.split(/\r?\n/).forEach((line, i) => {
    if (buffer === null) { buffer = line; startLine = i + 1 } else { buffer += ' ' + line.trim() }
    if (/\\\s*$/.test(buffer.trimEnd())) {
      buffer = buffer.trimEnd().replace(/\\\s*$/, '')
      return
    }
    out.push({ line: startLine, text: buffer })
    buffer = null
  })
  if (buffer !== null) out.push({ line: startLine, text: buffer })
  return out
}

export function scanWorkflow(relPath, text) {
  const findings = []
  for (const { line, text: command } of joinContinuations(stripHeredocBodies(text))) {
    if (WORKFLOW_GH_API.test(command) && !isWorkflowWrite(command)) {
      findings.push({ file: relPath, line, rule: 'workflow-gh-api-read', text: command.trim().slice(0, 200) })
    }
  }
  return findings
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * @param {(rel: string) => string} readFile   injected so the test can scan a
 *        synthetic dirty tree without writing files into the repository.
 */
export function findViolations({ files, readFile }) {
  const findings = []
  for (const rel of files) {
    const text = readFile(rel)
    if (/^scripts\/.+\.(?:mjs|cjs|js)$/.test(rel)) findings.push(...scanNodeSource(rel, text))
    else if (/^\.github\/workflows\/.+\.ya?ml$/.test(rel)) findings.push(...scanWorkflow(rel, text))
  }
  return findings
}

export function repositoryFiles(root = repoRoot) {
  const dirs = [path.join(root, 'scripts'), path.join(root, '.github', 'workflows')]
  return dirs
    .flatMap((d) => { try { return walk(d) } catch { return [] } })
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .filter((rel) => /\.(?:mjs|cjs|js|ya?ml)$/.test(rel))
}

export function explain(findings) {
  const lines = [
    `${findings.length} GitHub call(s) bypass ${TRANSPORT_MODULE}:`,
    '',
  ]
  for (const f of findings) lines.push(`  ${f.file}:${f.line}  [${f.rule}]  ${f.text}`)
  lines.push(
    '',
    'Every governed gate reaches GitHub through the one shared transport, so that',
    'retry policy, the transient/semantic classifier, and the never-replay-a-write',
    'rule are decided in ONE place. Import runGitHubCommand or ghJson from',
    `  ${TRANSPORT_MODULE}`,
    'and pass `wrapError` to keep your gate\'s own named refusal. A workflow step',
    'should call a script rather than shelling out to `gh api` under set -e.',
    'For file content use createTreeReader from scripts/lib/github-tree.mjs: one',
    'recursive tree read per ref, then blobs by SHA — never a Contents call per file.',
  )
  return lines.join('\n')
}

export function main({ root = repoRoot, log = console.log, err = console.error } = {}) {
  const files = repositoryFiles(root)
  if (files.length === 0) {
    err('::error::transport conformance found no files to scan — the checkout or the glob is wrong')
    return 1
  }
  const findings = findViolations({
    files,
    readFile: (rel) => readFileSync(path.join(root, rel), 'utf8'),
  })
  if (findings.length) {
    err(`::error::${explain(findings)}`)
    return 1
  }
  log(`GitHub transport conformance: ${files.length} files scanned, every GitHub call goes through ${TRANSPORT_MODULE}.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
