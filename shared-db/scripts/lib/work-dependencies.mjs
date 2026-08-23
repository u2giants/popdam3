// Dependency proof for queued database work (Step 3, issue #1366).
//
// WHAT WAS WRONG
// --------------
// `buildDynamicQueues` blocked a task only while a dependency number appeared in
// the set of OPEN issues. Anything else counted as satisfied. That means all of
// these released downstream work:
//
//   * an issue closed as "not doing this after all";
//   * an issue closed because it was superseded, cancelled, or returned to
//     another repository;
//   * an issue closed by hand with the work never merged;
//   * a dependency number that never existed at all — a typo releases instantly,
//     because a nonexistent issue is certainly not open;
//   * a dependency cycle, where two tasks each wait for the other and neither is
//     open-and-blocking in the other's eyes.
//
// "Not currently open" is not "succeeded". This module makes a dependency
// satisfied only by a typed, machine-checkable completion record.
//
// EVERY UNKNOWN IS A BLOCK, NEVER A PASS. If an issue cannot be read, if its
// completion record is malformed, or if its evidence cannot be re-derived, the
// dependent work stays blocked and says why. The failure mode this replaces was
// silence, so silence is exactly what must not come back.

export class DependencyError extends Error {}

// GRANDFATHER CUTOFF. Completion records did not exist before this rule shipped,
// so every dependency closed earlier is necessarily without one. Blocking them all
// would stall live work to enforce a rule they could not have followed.
//
// A dependency closed BEFORE this instant is treated as satisfied and reported as
// GRANDFATHERED, so it is visible and countable rather than invisible. Anything
// closed after it must prove success like everything else. Step 8A's audit uses the
// grandfathered count to decide when this constant can be deleted.
//
// This is a one-way door: never move this date forward to unblock something.
export const COMPLETION_RECORD_REQUIRED_FROM = '2026-08-23T00:00:00.000Z'

export const COMPLETION_FENCE = 'db-work-completion'
export const COMPLETION_SCHEMA_VERSION = 1

// Outcomes that end a piece of work. Only `merged` and `owner-ruling-recorded`
// are SUCCESSES; the rest are real, legitimate endings that must never release
// downstream work.
export const SUCCESS_OUTCOMES = Object.freeze(['merged', 'owner-ruling-recorded'])
export const UNSUCCESSFUL_OUTCOMES = Object.freeze(['returned', 'cancelled', 'superseded', 'failed'])
export const COMPLETION_OUTCOMES = Object.freeze([...SUCCESS_OUTCOMES, ...UNSUCCESSFUL_OUTCOMES])

const SHA_PATTERN = /^[0-9a-f]{7,40}$/
const VERSION_PATTERN = /^\d{14}$/

/**
 * Hand-rolled validation, deliberately. This repository has no root
 * `package.json` and `scripts/check-handoff-contract.mjs` already sets the
 * precedent: a small explicit parser beats a partial JSON-Schema implementation
 * that claims to be the standard. Every rule here is a sentence someone can read.
 */
export function validateCompletionRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new DependencyError('completion record must be a JSON object')
  }
  if (record.schema_version !== COMPLETION_SCHEMA_VERSION) {
    throw new DependencyError(`completion record schema_version must be ${COMPLETION_SCHEMA_VERSION}`)
  }
  if (!Number.isInteger(record.work_issue) || record.work_issue <= 0) {
    throw new DependencyError('completion record work_issue must be a positive issue number')
  }
  if (!COMPLETION_OUTCOMES.includes(record.outcome)) {
    throw new DependencyError(`completion record outcome must be one of ${COMPLETION_OUTCOMES.join(', ')}`)
  }

  // CONDITIONAL-REQUIRED FIELDS. One schema serves every outcome. Requiring `pr`
  // unconditionally would make it impossible to express an owner ruling, and an
  // owner ruling is a legitimate dependency.
  if (record.outcome === 'merged') {
    if (!Number.isInteger(record.pr) || record.pr <= 0) throw new DependencyError('a merged completion must name its pr number')
    if (typeof record.merge_sha !== 'string' || !SHA_PATTERN.test(record.merge_sha)) {
      throw new DependencyError('a merged completion must name the merge_sha GitHub actually created')
    }
    if (!Array.isArray(record.migration_versions)) throw new DependencyError('a merged completion must list migration_versions (use [] when it added none)')
    for (const version of record.migration_versions) {
      if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) throw new DependencyError(`migration_versions must be 14-digit versions: ${String(version)}`)
    }
  }
  if (record.outcome === 'owner-ruling-recorded') {
    if (typeof record.ruling_url !== 'string' || !record.ruling_url.trim()) throw new DependencyError('an owner-ruling completion must link the durable ruling')
    if (typeof record.resolved_by !== 'string' || !record.resolved_by.trim()) {
      throw new DependencyError('an owner-ruling completion must record the resolving commit or issue-comment URL in resolved_by')
    }
  }
  if (UNSUCCESSFUL_OUTCOMES.includes(record.outcome)) {
    if (typeof record.reason !== 'string' || !record.reason.trim()) {
      throw new DependencyError(`a ${record.outcome} completion must give a reason; downstream work will be told this exact text`)
    }
  }

  // ADVISORY ONLY. A later forward correction does not make an earlier success
  // false, and semantic invalidation is domain-specific. These pointers surface
  // in an audit for a human to judge; they never auto-block anything.
  for (const field of ['invalidates', 'supersedes']) {
    if (record[field] === undefined) continue
    if (!Array.isArray(record[field])) throw new DependencyError(`${field} must be an array of issue numbers when present`)
    for (const value of record[field]) {
      if (!Number.isInteger(value) || value <= 0) throw new DependencyError(`${field} must contain positive issue numbers`)
    }
  }
  return record
}

export function isSuccessful(record) {
  return SUCCESS_OUTCOMES.includes(record?.outcome)
}

/** Extract the single fenced completion record from an issue comment body. */
export function parseCompletionComment(body) {
  if (typeof body !== 'string') return null
  const fences = [...body.matchAll(new RegExp('```' + COMPLETION_FENCE + '\\s*\\n([\\s\\S]*?)```', 'g'))]
  if (!fences.length) return null
  if (fences.length !== 1) throw new DependencyError('a comment must carry exactly one db-work-completion block')
  let parsed
  try {
    parsed = JSON.parse(fences[0][1])
  } catch {
    throw new DependencyError('db-work-completion block is not valid JSON')
  }
  return validateCompletionRecord(parsed)
}

/**
 * The completion record for an issue, or null when it has none.
 *
 * MULTIPLE RECORDS ARE AN ERROR, NOT A "LATEST WINS". Completion is immutable; a
 * second record means either a mistake or an attempt to overwrite history, and
 * quietly preferring one would hide both.
 */
export function findCompletionRecord(comments) {
  const found = []
  for (const comment of comments ?? []) {
    const record = parseCompletionComment(comment?.body)
    if (record) found.push(record)
  }
  if (found.length > 1) throw new DependencyError(`issue carries ${found.length} completion records; completion is immutable and there must be exactly one`)
  return found[0] ?? null
}

/**
 * Detect a directed cycle among the dependency edges, and print the exact path.
 *
 * A cycle is invisible to the old "is it open?" test: each task sees the other as
 * satisfied or blocked depending only on open state, and nobody reports that the
 * pair can never start. Returns an array of cycle paths, empty when acyclic.
 */
export function findDependencyCycles(edges) {
  const graph = new Map()
  for (const [from, targets] of Object.entries(edges ?? {})) {
    graph.set(Number(from), [...new Set((targets ?? []).map(Number))])
  }
  const cycles = []
  const seen = new Set()
  const onPath = new Set()
  const path = []

  const walk = (node) => {
    if (onPath.has(node)) {
      const start = path.indexOf(node)
      cycles.push([...path.slice(start), node])
      return
    }
    if (seen.has(node)) return
    seen.add(node)
    onPath.add(node)
    path.push(node)
    for (const next of graph.get(node) ?? []) walk(next)
    path.pop()
    onPath.delete(node)
  }

  for (const node of graph.keys()) walk(node)
  // De-duplicate rotations of the same cycle so one loop is reported once.
  const canonical = new Map()
  for (const cycle of cycles) {
    const key = [...cycle.slice(0, -1)].sort((a, b) => a - b).join(',')
    if (!canonical.has(key)) canonical.set(key, cycle)
  }
  return [...canonical.values()]
}

/**
 * Structural checks that need no network: existence of a declared dependency is
 * checked elsewhere (it needs GitHub), but self-dependency and duplicates are
 * decidable from the scope block alone.
 */
export function validateDependencyDeclaration(issueNumber, dependencies) {
  const list = (dependencies ?? []).map(Number)
  if (list.includes(Number(issueNumber))) throw new DependencyError(`issue #${issueNumber} depends on itself`)
  const duplicates = list.filter((value, index) => list.indexOf(value) !== index)
  if (duplicates.length) throw new DependencyError(`issue #${issueNumber} lists duplicate dependencies: ${[...new Set(duplicates)].join(', ')}`)
  return list
}

/**
 * Classify ONE dependency. `state` is the dependency's data as gathered by the
 * caller; this function performs no IO so it is exhaustively testable.
 *
 * Returns { satisfied, status, reason }. `status` is one of:
 *   satisfied | waiting | invalid-dependency | completed-unsuccessfully | unknown
 *
 * `unknown` is a BLOCK. It is separated from `invalid-dependency` because the two
 * demand different actions: one is a broken declaration, the other is "I could not
 * find out", and telling them apart is the difference between fixing a typo and
 * investigating an outage.
 */
export function classifyDependency(number, state) {
  if (!state || state.exists === false) {
    return { satisfied: false, status: 'invalid-dependency', reason: `dependency #${number} does not exist` }
  }
  if (state.unreadable) {
    return { satisfied: false, status: 'unknown', reason: `dependency #${number} could not be read: ${state.unreadable}. This is NOT "no dependency" — nothing was checked.` }
  }
  if (state.open) {
    return { satisfied: false, status: 'waiting', reason: `dependency #${number} is still open` }
  }
  let record
  try {
    record = findCompletionRecord(state.comments)
  } catch (error) {
    return { satisfied: false, status: 'unknown', reason: `dependency #${number} has an unusable completion record: ${error.message}` }
  }
  if (!record) {
    // GRANDFATHERED. Closed before completion records existed, so its absence is
    // not evidence of anything. Satisfied, but reported so it stays countable.
    if (state.closedAt && Date.parse(state.closedAt) < Date.parse(COMPLETION_RECORD_REQUIRED_FROM)) {
      return {
        satisfied: true,
        status: 'grandfathered',
        reason: `dependency #${number} closed on ${state.closedAt}, before completion records were required; accepted without proof`,
      }
    }
    // THE CENTRAL RULE. A closed issue with no typed record proves nothing about
    // whether the work succeeded, and this is the exact case that used to release
    // downstream work.
    return { satisfied: false, status: 'waiting', reason: `dependency #${number} is closed but has no db-work-completion record; closure alone is not success` }
  }
  if (record.work_issue !== Number(number)) {
    return { satisfied: false, status: 'unknown', reason: `dependency #${number} carries a completion record for issue #${record.work_issue}` }
  }
  if (!isSuccessful(record)) {
    return {
      satisfied: false,
      status: 'completed-unsuccessfully',
      reason: `dependency #${number} completed as ${record.outcome}: ${record.reason ?? 'no reason recorded'}`,
      outcome: record.outcome,
    }
  }
  if (record.outcome === 'merged' && state.mergeInMain === false) {
    return { satisfied: false, status: 'unknown', reason: `dependency #${number} claims merge ${record.merge_sha} but that commit is not in main's history` }
  }
  return { satisfied: true, status: 'satisfied', reason: `dependency #${number} completed as ${record.outcome}`, record }
}

/** Classify every dependency of one issue. Blocked reasons are returned in order. */
export function classifyDependencies(issueNumber, dependencies, statesByNumber) {
  const list = validateDependencyDeclaration(issueNumber, dependencies)
  const results = list.map((number) => ({ number, ...classifyDependency(number, statesByNumber?.[number]) }))
  return {
    satisfied: results.every((result) => result.satisfied),
    results,
    blocked: results.filter((result) => !result.satisfied),
  }
}
