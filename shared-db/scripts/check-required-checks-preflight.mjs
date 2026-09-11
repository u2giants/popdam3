#!/usr/bin/env node
// Pre-flight for the guarded merge (#1201).
//
// The guarded merge used to post its own authorization and then enter a bounded
// merge loop while holding the repository-wide exclusive merge lane. When a
// DIFFERENT required status check was missing or failing, every merge attempt was
// refused with the same "base branch policy prohibits the merge" message that the
// eventual-consistency retry exists for, so the workflow retried a condition no
// retry can resolve, held the lock for minutes, and reported nothing useful. This
// check runs BEFORE the lock is taken and names the exact contexts that are not
// satisfied on the reviewed head.
import { execFileSync } from 'node:child_process'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { pathToFileURL } from 'node:url'
import { REPO } from './manage-migration-author-lanes.mjs'
import { MERGE_SELF_CONTEXT as SELF_CONTEXT } from './lib/merge-self-context.mjs'

export class PreflightError extends Error {}

// Posted by the guarded merge itself, after this pre-flight has passed. Requiring
// it here would make the pre-flight unsatisfiable on every first run.
export { SELF_CONTEXT }
export const SELF_CHECK_RUN = 'merge'

// Routing diagnostic from documents-only-merge-authorization.yml (#2715). It fails
// on every code PR by design ("guarded code checks required"), so requiring it here
// made every code PR unmergeable through the guarded lane (#2759). It is never a
// required context; the mirrored required contexts are still enforced in full.
export const ADVISORY_CONTEXTS = ['Documents-only merge authorization']

// A skipped or neutral required check can still be refused by the merge API.
// Accept only explicit success so that refusal happens before the merge lock.
const REQUIRED_SUCCESS = new Set(['success'])
const REPORTED_SUCCESS = new Set(['success', 'neutral', 'skipped'])

// A required context can be answered by either a commit status or a check run.
// Latest wins for each name; a check run that has not completed has no conclusion
// and is reported as pending rather than passing.
export function observedStates({ statuses = [], checkRuns = [] }) {
  const seen = new Map()
  for (const s of statuses) {
    if (!s?.context) continue
    const at = Date.parse(s.updated_at ?? s.created_at ?? 0) || 0
    const prior = seen.get(s.context)
    if (!prior || at >= prior.at) seen.set(s.context, { at, state: String(s.state ?? '') })
  }
  for (const r of checkRuns) {
    if (!r?.name) continue
    const at = Date.parse(r.completed_at ?? r.started_at ?? 0) || 0
    const state = r.status === 'completed' ? String(r.conclusion ?? '') : 'pending'
    const prior = seen.get(r.name)
    if (!prior || at >= prior.at) seen.set(r.name, { at, state })
  }
  return new Map([...seen].map(([name, v]) => [name, v.state]))
}

// WHEN THE REQUIRED LIST CANNOT BE READ FROM THE API.
//
// That read needs administration access, and GitHub Actions HAS NO `administration`
// permission scope -- declaring one makes the workflow file unparseable, which took
// the only merge path in this repository down entirely. So `github.token` cannot read
// it, ever.
//
// The first attempt at this fallback checked only that every check REPORTED on the
// head was green, and claimed that was strictly stronger. It is not, and a governed
// review produced the counterexample: a head with one green non-required check and a
// required context that never reported at all passes the reported-checks test and
// fails the required-list test. Not knowing the required list means not being able to
// notice one is missing.
//
// So the fallback does not guess. It reads a COMMITTED MIRROR of the required list
// (`docs/verification/main-required-status-checks.json`, rewritten by
// `scripts/update-required-checks.mjs` whenever it changes the live list) and applies
// BOTH tests: every mirrored context must be green, AND every check reported on the
// head must be green. The second half is what covers mirror rot -- a context added
// live but not yet mirrored is still caught the moment it reports. A missing or empty
// mirror is a refusal, never an empty required list.
export const REQUIRED_CHECKS_MIRROR = 'docs/verification/main-required-status-checks.json'
export const MIRROR_BOOTSTRAP_MAIN_SHA = 'e0532e3c974a199f623f160f56416bdef4037461'
export const PINNED_REQUIRED_CONTEXTS = Object.freeze([
  // 'Agent work contract' joined the required list on 2026-09-08, the Switch 1
  // action of issue #1403, one day after enforced mode was activated. The pin only
  // ever defends against SHRINKING, so growth is recorded here deliberately.
  'Agent work contract',
  'Cancelled work guard', 'Cross-PR object collision', 'Domain ownership',
  'Handoff contract', 'Intake pointer guard', 'Migration author lease',
  'Migration guarded merge authorization', 'Orchestrator marker guard',
  'Promotion contract tests (offline)', 'SQL migration guards', 'Tools offline tests',
])

export const PREFLIGHT_SOURCE_PATH = 'scripts/check-required-checks-preflight.mjs'

// The floor the origin/main mirror is judged against must come from origin/main too.
// Reading it from the PROPOSED HEAD deadlocked the first time the pin grew: guarded
// merge checks out the head, so the head's larger pin was compared against main's
// not-yet-updated mirror and refused the one commit that would have updated it --
// and that refusal lands on the only merge path there is. It was also the last place
// a proposed head could influence the list used to judge itself, which the comment on
// readRequiredChecksMirror already said must never happen. Reading main's own pin
// fixes both. Growth stays one-directional: the head's pin must still contain every
// name main's pin has, so a head cannot quietly drop a floor entry.
export function parsePinnedFloor(source, where) {
  const withoutComments = String(source).replace(/\/\/.*/g, '')
  const block = /PINNED_REQUIRED_CONTEXTS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(withoutComments)
  if (!block) throw new PreflightError(`${PREFLIGHT_SOURCE_PATH} on ${where} carries no readable PINNED_REQUIRED_CONTEXTS, so the pinned floor is unknown`)
  const names = [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
  if (names.length === 0) throw new PreflightError(`PINNED_REQUIRED_CONTEXTS in ${PREFLIGHT_SOURCE_PATH} on ${where} is empty, which is not the same as "nothing is required"`)
  return names
}

export function readPinnedFloor(root = process.cwd(), run = execFileSync) {
  let raw
  try { raw = run('git', ['show', `origin/main:${PREFLIGHT_SOURCE_PATH}`], { encoding: 'utf8', cwd: root, maxBuffer: 8 * 1024 * 1024 }) }
  catch (e) {
    throw new PreflightError(`the trusted origin/main copy of ${PREFLIGHT_SOURCE_PATH} is missing or unreadable (${sanitize(e.message)}), so the pinned floor is unknown`)
  }
  const floor = parsePinnedFloor(raw, 'origin/main')
  const dropped = floor.filter((context) => !PINNED_REQUIRED_CONTEXTS.includes(context))
  if (dropped.length) throw new PreflightError(`this head drops contexts origin/main still pins: ${dropped.join(', ')}. The pin may only grow.`)
  return floor
}

export function parseMirror(raw, where) {
  let parsed
  try { parsed = JSON.parse(raw) }
  catch (e) { throw new PreflightError(`${REQUIRED_CHECKS_MIRROR} on ${where} is not readable JSON (${sanitize(e.message)}), so the required list is unknown from both sources`) }
  const contexts = parsed?.contexts
  if (!Array.isArray(contexts) || contexts.length === 0 || contexts.some((c) => typeof c !== 'string')) {
    throw new PreflightError(`${REQUIRED_CHECKS_MIRROR} on ${where} carries no usable contexts, which is not the same as "nothing is required"`)
  }
  return contexts
}

// The proposed head must never supply the list used to judge itself. Once main has
// the mirror, only that protected copy is read. The first merge is bound to the exact
// current main SHA and the independently reviewed immutable context floor above.
export function readRequiredChecksMirror(root = process.cwd(), run = execFileSync) {
  let raw
  try { raw = run('git', ['show', `origin/main:${REQUIRED_CHECKS_MIRROR}`], { encoding: 'utf8', cwd: root, maxBuffer: 8 * 1024 * 1024 }) }
  catch (e) {
    let mainSha = ''
    try { mainSha = String(run('git', ['rev-parse', 'origin/main'], { encoding: 'utf8', cwd: root })).trim() } catch {}
    if (mainSha === MIRROR_BOOTSTRAP_MAIN_SHA) return [...PINNED_REQUIRED_CONTEXTS]
    throw new PreflightError(`the trusted origin/main mirror ${REQUIRED_CHECKS_MIRROR} is missing or unreadable (${sanitize(e.message)}), so the required list is unknown from both sources`)
  }
  const contexts = parseMirror(raw, 'origin/main')
  // The pre-flight strips its own context before testing, so a mirror naming ONLY
  // that context leaves nothing to test and would pass with zero coverage.
  if (contexts.filter((c) => c !== SELF_CONTEXT).length === 0) {
    throw new PreflightError(`${REQUIRED_CHECKS_MIRROR} names no context other than ${SELF_CONTEXT}, so the mirror would test nothing`)
  }
  const missingPinned = readPinnedFloor(root, run).filter((context) => !contexts.includes(context))
  if (missingPinned.length) throw new PreflightError(`the trusted origin/main mirror is a stale subset; missing pinned contexts: ${missingPinned.join(', ')}`)
  return contexts
}

export function evaluateWithoutRequiredList({ statuses, checkRuns, reason, mirrorContexts }) {
  const states = observedStates({ statuses, checkRuns })
  // Half one: every MIRRORED required context must be green. This is the half the
  // reported-checks test cannot do, and the half the review's counterexample needed.
  requireContexts(mirrorContexts.filter((c) => c !== SELF_CONTEXT), states, `main's required list is unreadable (${reason}), so the committed mirror ${REQUIRED_CHECKS_MIRROR} was used`)
  // Half two: everything else that reported must also be green, so a context added
  // live but not yet mirrored cannot slip through once it starts reporting.
  const bad = [...states].filter(([name, state]) => ![SELF_CONTEXT, SELF_CHECK_RUN, ...ADVISORY_CONTEXTS.filter((c) => !mirrorContexts.includes(c))].includes(name) && !REPORTED_SUCCESS.has(state))
  if (bad.length) throw new PreflightError(`${describe(bad)} on the reviewed head. The required list came from the committed mirror, so EVERY reported check must pass. No retry can clear this, so the merge lane was not taken.`)
  return { required: mirrorContexts.filter((c) => c !== SELF_CONTEXT).length, mode: 'committed-mirror' }
}

function describe(bad) {
  const pending = bad.filter(([, s]) => s === 'pending' || s === '').map(([n]) => n)
  const failing = bad.filter(([, s]) => s !== 'pending' && s !== '').map(([n, s]) => `${n} (${s})`)
  const parts = []
  if (failing.length) parts.push(`failing: ${failing.join(', ')}`)
  if (pending.length) parts.push(`still running: ${pending.join(', ')}`)
  return parts.join('; ')
}

function requireContexts(required, states, prefix) {
  const missing = [], bad = []
  for (const context of required) {
    if (!states.has(context)) { missing.push(context); continue }
    const state = states.get(context)
    if (!REQUIRED_SUCCESS.has(state)) bad.push([context, state])
  }
  if (!missing.length && !bad.length) return
  const parts = []
  if (missing.length) parts.push(`never reported: ${missing.join(', ')}`)
  if (bad.length) parts.push(describe(bad))
  throw new PreflightError(`${prefix}. ${parts.join('; ')}. No retry can clear this, so the merge lane was not taken.`)
}

export function evaluatePreflight({ requiredContexts, statuses, checkRuns, protectionUnreadable, mirrorContexts }) {
  if (protectionUnreadable) return evaluateWithoutRequiredList({ statuses, checkRuns, reason: protectionUnreadable, mirrorContexts })
  if (!Array.isArray(requiredContexts) || requiredContexts.length === 0) throw new PreflightError('branch protection returned no required status check list, which is not the same as "nothing is required"')
  const required = requiredContexts.filter((c) => c !== SELF_CONTEXT)
  const states = observedStates({ statuses, checkRuns })
  const missing = [], pending = [], failing = []
  for (const context of required) {
    const state = states.get(context)
    if (state === undefined) missing.push(context)
    else if (REQUIRED_SUCCESS.has(state)) continue
    else if (state === 'pending' || state === '') pending.push(`${context}`)
    else failing.push(`${context} (${state})`)
  }
  if (missing.length || pending.length || failing.length) {
    const parts = []
    if (failing.length) parts.push(`failing: ${failing.join(', ')}`)
    if (pending.length) parts.push(`still running: ${pending.join(', ')}`)
    if (missing.length) parts.push(`never reported: ${missing.join(', ')}`)
    throw new PreflightError(`required status checks are not satisfied on the reviewed head — ${parts.join('; ')}. No retry can clear this, so the merge lane was not taken.`)
  }
  return { required: required.length, mode: 'required-contexts' }
}

function gh(args) {
  // No 2>/dev/null || echo '' here: an HTTP 401/403 or a network failure must be
  // reported as itself, never as an empty result that reads like "not green yet".
  // Issue #2342: shared transport, identical refusal.
  return runGitHubCommand(args, {
    wrapError: (detail) => new PreflightError(`GitHub read failed: ${detail}`),
  })
}
function json(args) { const raw = gh(args); try { return JSON.parse(raw) } catch { throw new PreflightError('GitHub returned malformed JSON') } }

// `gh api --paginate --slurp` returns an ARRAY of page objects; a single-page read
// through the same path still returns that array with one element. Flattening here
// rather than at each call site is what keeps the >100 case honest.
//
// WHY THIS IS NOT COSMETIC (#2274). Both reads used to be a bare `per_page=100`
// with no pagination. This repository already reports seventeen checks on a head,
// and a re-run adds a report rather than replacing one. Past a hundred reports a
// context that really did pass would come back absent, `evaluatePreflight` would
// call it "never reported", and the merge would be refused for a reason no one
// could act on. That is the safe direction, but it is an unexplainable block on
// the ONLY merge path, so it is fixed rather than documented.
export function collectPages(payload, key) {
  const pages = Array.isArray(payload) ? payload : [payload]
  const out = []
  for (const page of pages) {
    const rows = page?.[key]
    // A page that does not carry the list AT ALL is not an empty page -- it is a
    // read we did not understand. Skipping it silently drops however many reports
    // it held, and the whole point of paginating was to stop dropping reports.
    if (rows === undefined || rows === null) throw new PreflightError(`GitHub returned a page with no "${key}" list`)
    if (!Array.isArray(rows)) throw new PreflightError(`GitHub returned a non-list "${key}" page`)
    out.push(...rows)
  }
  return out
}

// The refusal text is printed into a public workflow log, so the API's own error
// string is flattened and bounded rather than passed through whole.
export function sanitize(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return (flat.length > 200 ? `${flat.slice(0, 200)}...` : flat) || 'no reason was reported'
}

// ONLY a permission refusal degrades. A 403 from this token is permanent and is the
// documented reason the fallback exists; a 5xx, a timeout or malformed JSON is
// transient, and quietly switching tests on a blip would hide a real outage behind a
// different check. Those refuse, and the merge is retried later.
export function isPermissionRefusal(message) {
  // Word-bounded, so a duration like `1403ms` or an id containing 403 is not a
  // permission refusal and does not silently switch the pre-flight to the fallback.
  return /\b(403|401)\b|resource not accessible|must have admin|not accessible by integration/i.test(String(message ?? ''))
}

// The count GitHub itself reports, taken from the FIRST page of a slurped read.
// Every page repeats it, and a payload that was never an array still answers.
export function reportedTotal(payload) {
  const first = Array.isArray(payload) ? payload[0] : payload
  return first?.total_count
}

// Kept as a belt-and-braces check ALONGSIDE real pagination, not instead of it.
// `--paginate` should now return every report, so this can only fire if the
// pagination itself came up short -- a truncated read, a `Link` header GitHub did
// not send, a mocked dependency. Reading fewer reports than GitHub says exist
// means the second half of the fallback (every OTHER check must also be passing)
// was judged on a partial list, so it refuses rather than guesses.
export function requireWholePage(what, totalCount, page) {
  // A missing total is NOT "we saw everything". Both endpoints document
  // `total_count`, so its absence means the payload is not the one we think we are
  // reading, and answering "complete" for an unrecognised payload is the same
  // fail-open this whole change exists to close.
  if (!Number.isInteger(totalCount)) throw new PreflightError(`GitHub did not report how many ${what} exist on the reviewed head, so the read cannot be shown to be complete. The merge lane was not taken.`)
  if (!Array.isArray(page)) throw new PreflightError(`The ${what} read did not produce a list, so it cannot be compared against GitHub's own count. The merge lane was not taken.`)
  if (totalCount > page.length) {
    throw new PreflightError(`GitHub reported ${totalCount} ${what} on the reviewed head but pagination returned only ${page.length}, so some checks were never seen. The merge lane was not taken.`)
  }
}

export function gatherPreflightInput(env = process.env, deps = { json }) {
  const read = deps.json ?? json
  const sha = String(env.REQUESTED_SHA ?? '').trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new PreflightError('REQUESTED_SHA must be a 40-character head SHA')
  let protection = null, protectionUnreadable = null
  try { protection = read(['api', `repos/${REPO}/branches/main/protection/required_status_checks`]) }
  catch (e) {
    if (!isPermissionRefusal(e.message)) throw e
    protectionUnreadable = sanitize(e.message)
  }
  // #2274: BOTH reads are paginated. Seventeen checks report on a head here and a
  // re-run adds a report rather than replacing one, so a hundred is reachable. Past
  // it, an unpaginated read made a context that really did pass look like it had
  // never reported, and the only merge path refused for a reason nobody could act
  // on. `--slurp` returns an array of pages; `collectPages` flattens it, and a
  // single-page read comes back through the same path unchanged.
  const combined = read(['api', '--paginate', '--slurp', `repos/${REPO}/commits/${sha}/status?per_page=100`])
  const runs = read(['api', '--paginate', '--slurp', `repos/${REPO}/commits/${sha}/check-runs?per_page=100`])
  const statuses = collectPages(combined, 'statuses')
  const checkRuns = collectPages(runs, 'check_runs')
  requireWholePage('commit statuses', reportedTotal(combined), statuses)
  requireWholePage('check runs', reportedTotal(runs), checkRuns)
  // NO `?? []` on the contexts. An empty list must never be read as "nothing is
  // required" -- that is the fail-open this whole script exists to prevent.
  return {
    protectionUnreadable,
    mirrorContexts: protectionUnreadable ? readRequiredChecksMirror(deps.root ?? process.cwd(), deps.run ?? execFileSync) : null,
    requiredContexts: protectionUnreadable ? null : protection?.contexts,
    statuses,
    checkRuns,
  }
}

export function main(env = process.env) {
  try {
    const { required, mode } = evaluatePreflight(gatherPreflightInput(env))
    console.log(mode === 'required-contexts'
      ? `Required status checks satisfied on the reviewed head (${required} contexts).`
      : `main's required list was unreadable from the API, so the committed mirror was used: all ${required} mirrored contexts and every other check reported on the reviewed head are passing.`)
    return 0
  } catch (e) { console.error(`REFUSED: ${e.message}`); return 2 }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
