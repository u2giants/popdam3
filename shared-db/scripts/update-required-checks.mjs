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
//   * REFUSES any removal or rename unless each retired context is named with
//     --remove (owner ruling 2026-09-28, docs/agents/owner-rulings.md §0.5),
//     and never removes a production-promotion context (PROTECTED_CONTEXTS);
//   * is DRY RUN by default and applies only with --apply;
//   * fails closed on an empty, malformed, or incomplete live document, because
//     "I could not read the current contexts" must never be treated as "there
//     are none".
//
// It reads back after applying, because an unverified write is not evidence.

import { execFileSync } from 'node:child_process'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readEffectiveRequiredChecks, normalizeRequirements } from './lib/required-check-authority.mjs'
import { resolveRepositoryIdentity, RepositoryIdentityError } from './lib/repository-identity.mjs'

export const DEFAULT_BRANCH = 'main'

export class RequiredChecksError extends Error {}

// Production promotion (scripts/production_business_risk_gate.py REQUIRED_CHECKS)
// requires these at the merged head. They can never be retired by this tool.
export const PROTECTED_CONTEXTS = Object.freeze(['Cross-PR object collision', 'Migration author lease'])

export const USAGE = `Usage:
  node scripts/update-required-checks.mjs --add "<context>" [--add "<context>"...] [options]

Options:
  --add <context>     A required status check context to ADD. Repeatable.
  --remove <context>  A required context to RETIRE (owner ruling 2026-09-28). Repeatable.
                      Needs a reviewed PR stating the before/after list. Never allowed
                      for ${PROTECTED_CONTEXTS.join(', ')}.
  --repo <owner/name> Default: GITHUB_REPOSITORY, else this checkout's verified GitHub origin
  --branch <name>     Default: ${DEFAULT_BRANCH}
  --refresh-mirror    Read effective settings and refresh local evidence; no GitHub mutation.
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
// Issue #2342: the stdin/`input` handling documented above now lives in the one
// shared transport, which carries the same comment and the same two tests. The
// refusal text is unchanged.
function gh(args, { executor = execFileSync, input } = {}) {
  return runGitHubCommand(args, {
    executor,
    input,
    maxBuffer: 32 * 1024 * 1024,
    wrapError: (detail) => new RequiredChecksError(`GitHub command failed: ${detail}`),
  })
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
  const options = { add: [], remove: [], repo: undefined, branch: DEFAULT_BRANCH, apply: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--refresh-mirror') { options.refreshMirror = true; continue }
    if (arg === '--apply') { options.apply = true; continue }
    const value = argv[i + 1]
    if (arg === '--add') {
      if (value === undefined || value.startsWith('--')) throw new RequiredChecksError('--add requires a context name')
      options.add.push(value); i++; continue
    }
    if (arg === '--remove') {
      if (value === undefined || value.startsWith('--')) throw new RequiredChecksError('--remove requires a context name')
      options.remove.push(value); i++; continue
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
  // An explicit --repo must agree with the detected identity; nothing is hard-coded (#2530).
  if (options.help) return options
  try { options.repo = resolveRepositoryIdentity({ explicit: options.repo }) }
  catch (error) { if (error instanceof RepositoryIdentityError) throw new RequiredChecksError(error.message); throw error }
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
  if (document.checks !== undefined) {
    let checks
    try { checks = normalizeRequirements(document.checks) } catch (error) { throw new RequiredChecksError(error.message) }
    if (document.contexts.some((context) => !checks.some((check) => check.context === context)) || checks.some((check) => !document.contexts.includes(check.context))) throw new RequiredChecksError('live contexts and producer bindings disagree')
  }
  return document
}

export function planUnion(live, additions, removals = []) {
  const validated = validateLiveDocument(live)
  const requested = additions.map((context) => String(context))
  const retiring = [...new Set(removals.map((context) => String(context)))]
  if (!requested.length && !retiring.length) throw new RequiredChecksError('at least one --add or --remove context is required')
  for (const context of retiring) {
    if (PROTECTED_CONTEXTS.includes(context)) throw new RequiredChecksError(`refusing: ${context} is required for production promotion and can never be retired`)
    if (!validated.contexts.includes(context)) throw new RequiredChecksError(`refusing: ${context} is not currently required; nothing to retire`)
    if (requested.includes(context)) throw new RequiredChecksError(`refusing: ${context} is both added and removed`)
  }
  for (const context of requested) {
    if (!context.trim()) throw new RequiredChecksError('a context to add must not be empty or whitespace')
  }
  const existing = validated.contexts
  const existingSet = new Set(existing)
  const alreadyPresent = requested.filter((context) => existingSet.has(context))
  const toAdd = [...new Set(requested.filter((context) => !existingSet.has(context)))]
  // Union, with the live order preserved and additions appended. Preserving order
  // keeps the diff readable and makes an accidental reordering visible.
  const next = [...existing.filter((context) => !retiring.includes(context)), ...toAdd]

  // Belt and braces: the only contexts that may disappear are the ones named
  // with --remove. If this ever fires, the logic above is wrong.
  const removed = existing.filter((context) => !next.includes(context))
  const unexpected = removed.filter((context) => !retiring.includes(context))
  if (unexpected.length) throw new RequiredChecksError(`refusing: the computed change would REMOVE ${unexpected.join(', ')}`)

  const checks = validated.checks === undefined ? undefined : [...validated.checks.filter((check) => !retiring.includes(check.context)).map((check) => ({ ...check })), ...toAdd.map((context) => ({ context, app_id: null }))]
  return { strict: validated.strict, existing: existing.filter((context) => !retiring.includes(context)), before: existing, toAdd, toRemove: retiring, alreadyPresent, next, checks, changed: toAdd.length > 0 || retiring.length > 0 }
}

export function renderPlan(plan, { repo, branch, apply }) {
  const lines = []
  lines.push(`Required status checks — ${repo}@${branch}`)
  lines.push(`  mode: ${apply ? 'APPLY' : 'DRY RUN (nothing will be written)'}`)
  lines.push('')
  lines.push(`  strict: ${plan.strict}  (PRESERVED EXACTLY — issue #1286 owner ruling; this tool never changes it)`)
  lines.push('')
  const current = plan.before ?? plan.existing
  lines.push(`  currently required (${current.length}):`)
  for (const context of current) lines.push(`    = ${context}`)
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
  if (plan.toRemove?.length) {
    lines.push('')
    lines.push(`  RETIRING (${plan.toRemove.length}) — owner ruling 2026-09-28:`)
    for (const context of plan.toRemove) lines.push(`    - ${context}`)
  }
  lines.push('')
  lines.push(plan.toRemove?.length
    ? `  resulting list (${plan.next.length}): only the contexts named above removed.`
    : `  resulting list (${plan.next.length}): no context removed, no context renamed.`)
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
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.checks)) throw new RequiredChecksError("live producer bindings are missing; refusing to write")
    return parsed
  } catch (error) {
    if (error instanceof RequiredChecksError) throw error
    throw new RequiredChecksError('live required_status_checks response was not valid JSON; nothing was compared')
  }
}

export function applyUnion({ repo, branch }, plan, io = {}) {
  const run = io.run ?? gh
  // The NARROW endpoint. PATCH here touches only required_status_checks and
  // leaves force-push, deletion, admin enforcement, reviews and everything else
  // untouched. `strict` is echoed back exactly as read.
  // Omit app_id for unrestricted checks: GitHub's documented "any source"
  // encoding is the absence of app_id, not -1 or null (which may 422 or fail
  // to match check runs produced by a specific app).
  const checks = plan.checks?.map((check) => (check.app_id == null || check.app_id === -1) ? { context: check.context } : { context: check.context, app_id: check.app_id })
  const body = JSON.stringify(plan.checks ? { strict: plan.strict, checks } : { strict: plan.strict, contexts: plan.next })
  run(['api', '-X', 'PATCH', `repos/${repo}/branches/${branch}/protection/required_status_checks`, '--input', '-'], { input: body })
  return body
}

// This committed readback is human-readable evidence, never merge authority.
// Fresh effective settings must be read again at every protected merge boundary.
export const MIRROR_PATH = 'docs/verification/main-required-status-checks.json'

export function mirrorDocument(validated, repo, branch, now = new Date(), authority) {
  return `${JSON.stringify({
    _why: 'Informational for guarded merge and never merge authority. Merge-queue activation uses these contexts as a coverage baseline. Protected merge boundaries read classic protection and applicable inherited rulesets live. Rewritten by scripts/update-required-checks.mjs; do not hand-edit.',
    authority: authority ?? null,
    repo, branch,
    capturedIso: now.toISOString(),
    strict: validated.strict,
    // Merge-queue coverage uses this as the classic readback baseline. The
    // separate authority snapshot records inherited ruleset requirements.
    contexts: [...new Set(validated.contexts)].sort(),
    checks: authority?.checks ?? validated.checks ?? null,
  }, null, 2)}
`
}

export function writeMirror(validated, { repo, branch }, io = {}) {
  const write = io.write ?? writeFileSync
  write(join(io.root ?? process.cwd(), MIRROR_PATH), mirrorDocument(validated, repo, branch, io.now, io.authority), 'utf8')
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
  if (plan.checks) {
    const afterChecks = normalizeRequirements(validated.checks)
    for (const before of normalizeRequirements(plan.checks)) {
      if (!afterChecks.some((after) => after.context === before.context && after.app_id === before.app_id)) throw new RequiredChecksError(`readback FAILED: producer binding changed for ${before.context}`)
    }
  }
  const retired = plan.toRemove ?? []
  if (retired.some((context) => validated.contexts.includes(context))) throw new RequiredChecksError(`readback FAILED: ${retired.filter((context) => validated.contexts.includes(context)).join(', ')} is still required after the write`)
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
  const effective = () => (io.readEffective ?? readEffectiveRequiredChecks)({ repo: options.repo, branch: options.branch, read: (args) => JSON.parse((io.run ?? gh)(args)) })
  if (options.refreshMirror) {
    if (options.apply || options.add.length || options.remove.length) { error('--refresh-mirror cannot be combined with --apply, --add or --remove'); return 2 }
    try {
      const authority = effective()
      const classic = authority.sources?.classic
      if (!classic?.requiresStatusChecks || !Array.isArray(classic.requiredStatusCheckContexts) || classic.requiredStatusCheckContexts.length === 0) throw new RequiredChecksError('cannot refresh classic coverage baseline without readable classic required checks')
      writeMirror({ strict: classic.requiresStrictStatusChecks, contexts: classic.requiredStatusCheckContexts }, options, { ...io, authority })
      log(`Refreshed informational mirror from live effective settings (${authority.checks.length} requirements, revision ${authority.revision}); no settings changed.`)
      return 0
    } catch (readError) { error(readError.message); return 2 }
  }
  if (!options.add.length && !options.remove.length) { error('at least one --add or --remove context is required'); error(USAGE); return 2 }

  let plan
  try {
    plan = planUnion(readLive(options, io), options.add, options.remove)
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
    const authority = effective()
    const classic = authority.sources.classic
    if (!classic || JSON.stringify([...classic.requiredStatusCheckContexts].sort()) !== JSON.stringify([...after.contexts].sort())) throw new RequiredChecksError('effective settings changed since classic readback; mirror not written')
    writeMirror(after, options, { ...io, authority })
    log('')
    log(`Rewrote ${MIRROR_PATH} from the readback. COMMIT IT as informational readback; fresh effective settings alone authorize preflight.`)
    return 0
  } catch (verifyError) {
    error(String(verifyError.message))
    return 1
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2))
