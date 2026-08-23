#!/usr/bin/env node
// Add required status checks to a protected branch WITHOUT losing anything else.
// (AGENTS.md 0.0-C; plan_multi_agent_database_coordination_hardening.md Step 1;
// issue #1366.)
//
// WHY THIS EXISTS AS A TESTED CLI AND NOT A ONE-LINE `gh api` CALL
// ----------------------------------------------------------------
// The obvious way to add a required check is to PUT the whole branch-protection
// object back with one more context in it. That is how required checks get
// silently DELETED: the full-object endpoint replaces every field, so anything
// absent from the request body is removed. A single hand-written PUT has already
// been proposed in this repository's history for exactly this task.
//
// Two specific losses are possible and both are unacceptable:
//
//   1. DROPPING AN EXISTING CONTEXT. Nine contexts guard `main`. A PUT that
//      forgets one silently unprotects it, and nothing announces the loss.
//
//   2. FLIPPING `strict` BACK TO TRUE. `required_status_checks.strict` is
//      deliberately FALSE by Albert's 2026-08-19 ruling in issue #1286: strict
//      mode restarted the entire check suite on every branch after every
//      unrelated merge, costing roughly 50 minutes a day. It is an owner
//      decision, not drift. A full-object PUT that omits `strict` re-enables it
//      by default, reversing an owner ruling by accident.
//
// So this tool:
//   * uses the NARROW required-status-checks endpoint, never the full
//     branch-protection object;
//   * reads the live document first and forms an exact SET UNION;
//   * preserves the live `strict` value byte-for-value and refuses to change it;
//   * REFUSES any removal or rename - this tool only ever adds;
//   * is DRY RUN by default and applies only with --apply;
//   * fails closed on an empty, malformed, or incomplete live document, because
//     "I could not read the current contexts" must never be treated as "there
//     are none".
//
// It reads back after applying, because an unverified write is not evidence.

import { execFileSync } from 'node:child_process'

export const DEFAULT_REPO = 'u2giants/shared-db'
export const DEFAULT_BRANCH = 'main'

export class RequiredChecksError extends Error {}

export const USAGE = `Usage:
  node scripts/update-required-checks.mjs --add "<context>" [--add "<context>"...] [options]

Options:
  --add <context>     A required status check context to ADD. Repeatable. Required.
  --repo <owner/name> Default: ${DEFAULT_REPO}
  --branch <name>     Default: ${DEFAULT_BRANCH}
  --apply             Actually write. Without it this is a dry run that changes nothing.
  --help

Exit codes:
  0  dry run printed, or apply succeeded and the readback proved it
  1  refused: the change would remove or rename a context, or the readback disagreed
  2  could not read the live document. NOT "no protection" - nothing was compared.
`

// `input` MUST be forwarded to the child's stdin. `applyUnion` sends the request
// body with `--input -`, which reads stdin; the first version of this helper
// dropped `input` and set stdin to 'ignore', so gh sent an EMPTY body and GitHub
// answered `422 ... nil is not an object`. Every unit test passed anyway, because
// the fake transport inspected `options.input` directly and never exercised the
// real stdin path. Hence the `ghSpawnOptions` probe and its two tests.
function gh(args, { executor = execFileSync, input } = {}) {
  const spawnOptions = { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  if (input === undefined) {
    spawnOptions.stdio = ['ignore', 'pipe', 'pipe']
  } else {
    // stdin must be a pipe for `input` to reach the child. Naming 'ignore' here
    // would silently discard the request body.
    spawnOptions.input = input
  }
  try {
    return executor('gh', args, spawnOptions)
  } catch (error) {
    const detail = String(error.stderr ?? '').trim() || String(error.message ?? '').trim()
    throw new RequiredChecksError(`GitHub command failed: ${detail}`)
  }
}

/**
 * Exported ONLY so a test can prove the real transport hands the request body to
 * the child process. Returns the spawn options `gh` would use.
 */
export function ghSpawnOptions(input) {
  const captured = {}
  try {
    gh(['api', 'noop'], { input, executor: (_file, _args, options) => { Object.assign(captured, options); return '{}' } })
  } catch { /* the fake executor cannot fail, but never let a probe throw */ }
  return captured
}

export function parseArgs(argv) {
  const options = { add: [], repo: DEFAULT_REPO, branch: DEFAULT_BRANCH, apply: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--apply') { options.apply = true; continue }
    const value = argv[i + 1]
    if (arg === '--add') {
      if (value === undefined || value.startsWith('--')) throw new RequiredChecksError('--add requires a context name')
      options.add.push(value); i++; continue
    }
    if (arg === '--repo') {
      if (!value || value.startsWith('--')) throw new RequiredChecksError('--repo requires owner/name')
      options.repo = value; i++; continue
    }
    if (arg === '--branch') {
      if (!value || value.startsWith('--')) throw new RequiredChecksError('--branch requires a branch name')
      options.branch = value; i++; continue
    }
    throw new RequiredChecksError(`unknown argument ${arg}`)
  }
  return options
}

// FAIL CLOSED. Every one of these refusals exists because the alternative is to
// treat an unreadable or surprising document as an empty one and then write a
// "union" that is really a replacement.
export function validateLiveDocument(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new RequiredChecksError('live required_status_checks is not an object; refusing to guess')
  }
  if (!Array.isArray(document.contexts)) {
    throw new RequiredChecksError('live required_status_checks.contexts is missing or not an array; refusing to guess')
  }
  if (document.contexts.some((context) => typeof context !== 'string' || !context.trim())) {
    throw new RequiredChecksError('live required_status_checks.contexts contains a non-string or empty entry; refusing to guess')
  }
  if (typeof document.strict !== 'boolean') {
    throw new RequiredChecksError('live required_status_checks.strict is missing or not a boolean; refusing to write without it')
  }
  if (document.contexts.length === 0) {
    // An empty list is legal in GitHub's model but has never been this branch's
    // state. Treat it as "the read did not work" rather than silently making
    // this tool the sole author of the whole list.
    throw new RequiredChecksError('live required_status_checks.contexts is EMPTY; that is not a credible reading of a protected branch. Nothing was compared. Investigate before writing.')
  }
  return document
}

export function planUnion(live, additions) {
  const validated = validateLiveDocument(live)
  const requested = additions.map((context) => String(context))
  if (!requested.length) throw new RequiredChecksError('at least one --add context is required')
  for (const context of requested) {
    if (!context.trim()) throw new RequiredChecksError('a context to add must not be empty or whitespace')
  }
  const existing = validated.contexts
  const existingSet = new Set(existing)
  const alreadyPresent = requested.filter((context) => existingSet.has(context))
  const toAdd = [...new Set(requested.filter((context) => !existingSet.has(context)))]
  // Union, with the live order preserved and additions appended. Preserving order
  // keeps the diff readable and makes an accidental reordering visible.
  const next = [...existing, ...toAdd]

  // Belt and braces: prove the result is a superset before anything is written.
  // If this ever fires, the union logic above is wrong and must not reach GitHub.
  const removed = existing.filter((context) => !next.includes(context))
  if (removed.length) throw new RequiredChecksError(`refusing: the computed change would REMOVE ${removed.join(', ')}`)

  return { strict: validated.strict, existing, toAdd, alreadyPresent, next, changed: toAdd.length > 0 }
}

export function renderPlan(plan, { repo, branch, apply }) {
  const lines = []
  lines.push(`Required status checks — ${repo}@${branch}`)
  lines.push(`  mode: ${apply ? 'APPLY' : 'DRY RUN (nothing will be written)'}`)
  lines.push('')
  lines.push(`  strict: ${plan.strict}  (PRESERVED EXACTLY — issue #1286 owner ruling; this tool never changes it)`)
  lines.push('')
  lines.push(`  currently required (${plan.existing.length}):`)
  for (const context of plan.existing) lines.push(`    = ${context}`)
  if (plan.alreadyPresent.length) {
    lines.push('')
    lines.push('  already present, nothing to do:')
    for (const context of plan.alreadyPresent) lines.push(`    = ${context}`)
  }
  lines.push('')
  if (plan.toAdd.length) {
    lines.push(`  ADDING (${plan.toAdd.length}):`)
    for (const context of plan.toAdd) lines.push(`    + ${context}`)
  } else {
    lines.push('  ADDING: nothing. Every requested context is already required.')
  }
  lines.push('')
  lines.push(`  resulting list (${plan.next.length}): no context removed, no context renamed.`)
  return lines.join('\n')
}

export function readLive({ repo, branch }, io = {}) {
  const run = io.run ?? gh
  let raw
  try {
    raw = run(['api', `repos/${repo}/branches/${branch}/protection/required_status_checks`])
  } catch (error) {
    throw new RequiredChecksError(`could not read live required status checks: ${error.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new RequiredChecksError('live required_status_checks response was not valid JSON; nothing was compared')
  }
}

export function applyUnion({ repo, branch }, plan, io = {}) {
  const run = io.run ?? gh
  // The NARROW endpoint. PATCH here touches only required_status_checks and
  // leaves force-push, deletion, admin enforcement, reviews and everything else
  // untouched. `strict` is echoed back exactly as read.
  const body = JSON.stringify({ strict: plan.strict, contexts: plan.next })
  run(['api', '-X', 'PATCH', `repos/${repo}/branches/${branch}/protection/required_status_checks`, '--input', '-'], { input: body })
  return body
}

export function verifyReadback(live, plan) {
  const validated = validateLiveDocument(live)
  // ORDER MATTERS. Report a LOST context before a missing addition: losing a guard
  // that was already protecting `main` is the emergency, and it would otherwise be
  // reported with the milder "is not required after the write" wording.
  const lost = plan.existing.filter((context) => !validated.contexts.includes(context))
  if (lost.length) throw new RequiredChecksError(`readback FAILED: previously required ${lost.join(', ')} is GONE. Restore it immediately.`)
  const missing = plan.next.filter((context) => !validated.contexts.includes(context))
  if (missing.length) throw new RequiredChecksError(`readback FAILED: ${missing.join(', ')} is not required after the write`)
  if (validated.strict !== plan.strict) {
    throw new RequiredChecksError(`readback FAILED: strict changed from ${plan.strict} to ${validated.strict}. Issue #1286 requires it stay ${plan.strict}. Restore it immediately.`)
  }
  return validated
}

export async function main(argv, io = {}) {
  const log = io.log ?? ((text) => console.log(text))
  const error = io.error ?? ((text) => console.error(text))
  let options
  try {
    options = parseArgs(argv)
  } catch (parseError) {
    error(String(parseError.message)); error(USAGE); return 2
  }
  if (options.help) { log(USAGE); return 0 }
  if (!options.add.length) { error('at least one --add context is required'); error(USAGE); return 2 }

  let plan
  try {
    plan = planUnion(readLive(options, io), options.add)
  } catch (readError) {
    error(String(readError.message))
    // A refusal to remove is a REFUSAL (1). Anything else here means we could not
    // establish the current state at all (2), which must never read as "clean".
    return /refusing/i.test(String(readError.message)) ? 1 : 2
  }

  log(renderPlan(plan, options))

  if (!options.apply) {
    log('')
    log('Dry run only. Nothing was written. Re-run with --apply to make this change.')
    return 0
  }
  if (!plan.changed) {
    log('')
    log('Nothing to apply; the live list already satisfies the request.')
    return 0
  }

  try {
    applyUnion(options, plan, io)
  } catch (writeError) {
    error(`apply FAILED: ${writeError.message}`)
    error('Re-read the live document before retrying. Do not assume the write did nothing.')
    return 1
  }

  try {
    const after = verifyReadback(readLive(options, io), plan)
    log('')
    log(`READBACK OK — ${after.contexts.length} contexts required, strict: ${after.strict}`)
    for (const context of after.contexts) log(`    = ${context}`)
    return 0
  } catch (verifyError) {
    error(String(verifyError.message))
    return 1
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2))
