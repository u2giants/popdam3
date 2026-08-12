#!/usr/bin/env node
/**
 * Guard: at most ONE open orchestrator marker, and an unreadable answer is
 * UNKNOWN -- never "none open".
 *
 * Plan item B1/B1a/B1b of `plan_orchestrator-workflow-gaps.md`, issue #619.
 *
 * WHY THIS EXISTS
 * ---------------
 * The single-orchestrator rule is an honour-system GitHub issue. Two
 * orchestrators dispatching at once is how this repo produced four competing
 * migrations on one function. Step 0 of the orchestrator skill asks whether a
 * marker is open, and every way that question has been asked has, at least
 * once, answered "no" while a marker was open:
 *
 *   1. THE LABEL WAS RENAMED. `coordinator-marker` -> `orchestrator-marker`.
 *      A query for the old name returns empty, and step 0 reads empty as
 *      permission to start. (AGENTS.md:2231.)
 *   2. THE SERVER-SIDE LABEL FILTER IS EVENTUALLY CONSISTENT. On 2026-08-07 a
 *      `?labels=...&state=open` query returned empty for an issue that provably
 *      carried the label, then returned it five seconds later. The reliable
 *      method recorded there: enumerate every open issue and read the labels
 *      client-side.
 *   3. `gh issue list --label orchestrator-marker` PRINTED EMPTY OUTPUT while
 *      the marker existed; only the JSON form showed it. Observed live on
 *      2026-08-09, not theorised -- the evidence #619 says to fold in here.
 *
 * All three produce the same lie: an empty result read as "nobody is running".
 * So this guard never uses a server-side label filter and never treats an
 * empty, failed, or unparseable response as zero. It has three outcomes:
 *
 *   OK      0 or 1 open marker.
 *   FAIL    2 or more open markers, or the retired label is alive (B1a).
 *   UNKNOWN gh errored, returned no JSON, or returned an empty body where a
 *           JSON array was required. Exits NON-ZERO, and says so in those words.
 *
 * ⚠️ WHAT THIS CANNOT DO (B1b -- state this wherever the check is documented)
 * ---------------------------------------------------------------------------
 * It detects a MARKED collision only. A session that never claims a marker at
 * all is invisible to it. Nothing in CI can PREVENT a second orchestrator
 * starting, because a marker is claimed outside any pull request. This makes
 * the collision VISIBLE on the next PR or scheduled run instead of silent.
 * That is the whole claim. Do not oversell it.
 *
 * USAGE
 *   node scripts/check-orchestrator-marker.mjs [--repo owner/name] [--json]
 *
 * EXIT CODES
 *   0  OK
 *   1  FAIL     -- more than one marker, or the retired label is alive
 *   2  UNKNOWN  -- could not determine. Treat as "assume a marker exists".
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** The live marker label. */
export const MARKER_LABEL = 'orchestrator-marker'
/** The retired label. Its continued existence is itself the defect (B1a). */
export const RETIRED_MARKER_LABEL = 'coordinator-marker'
export const DEFAULT_REPO = 'u2giants/shared-db'

export const EXIT_OK = 0
export const EXIT_FAIL = 1
export const EXIT_UNKNOWN = 2

/** Thrown when the answer cannot be determined. Never downgraded to "none". */
export class Unknown extends Error {}

// ---------------------------------------------------------------------------
// Pure logic. Everything below `defaultIo` is I/O and is injected in tests.
// ---------------------------------------------------------------------------

/**
 * Reduce a list of open issues to the marker verdict.
 *
 * `issues` must be the FULL open-issue list, not a label-filtered one -- see
 * reason 2 in the header. Labels are read client-side here, which is the only
 * method this repo has recorded as reliable.
 *
 * Pull requests are excluded: the REST issues endpoint returns PRs too, and a
 * PR that happens to carry the label is not a session claim.
 */
export function evaluate(issues) {
  if (!Array.isArray(issues)) {
    throw new Unknown('the open-issue list was not an array')
  }

  const labelsOf = (issue) =>
    (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)

  const realIssues = issues.filter((i) => !i.pull_request)

  const markers = realIssues
    .filter((i) => labelsOf(i).includes(MARKER_LABEL))
    .map((i) => ({ number: i.number, title: i.title }))

  const retired = realIssues
    .filter((i) => labelsOf(i).includes(RETIRED_MARKER_LABEL))
    .map((i) => ({ number: i.number, title: i.title }))

  const problems = []
  if (markers.length > 1) {
    problems.push(
      `${markers.length} open \`${MARKER_LABEL}\` issues. At most one orchestrator may be ` +
        `active. Open markers: ${markers.map((m) => `#${m.number}`).join(', ')}.`,
    )
  }
  if (retired.length > 0) {
    // B1a. The retired label returning empty is what made step 0 read "nobody
    // is running". If it is alive again, a session may be claiming it.
    problems.push(
      `the retired label \`${RETIRED_MARKER_LABEL}\` is on ${retired.length} open issue(s): ` +
        `${retired.map((m) => `#${m.number}`).join(', ')}. It was renamed to ` +
        `\`${MARKER_LABEL}\`; a query for the old name returns empty and reads as ` +
        `"no orchestrator active".`,
    )
  }

  return { markers, retired, problems, ok: problems.length === 0 }
}

/** B1a, second leg: the retired label must not exist in the repo at all. */
export function evaluateLabels(labels) {
  if (!Array.isArray(labels)) {
    throw new Unknown('the label list was not an array')
  }
  const names = labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
  if (names.includes(RETIRED_MARKER_LABEL)) {
    return [
      `the retired label \`${RETIRED_MARKER_LABEL}\` still exists in the repository. ` +
        `Recreating it lets a session claim a marker nothing looks for. Delete it.`,
    ]
  }
  return []
}

export function formatReport({ markers, retired, problems }) {
  const lines = []
  lines.push(`Open \`${MARKER_LABEL}\` issues: ${markers.length}`)
  for (const m of markers) lines.push(`  #${m.number} ${m.title}`)
  if (retired.length > 0) {
    lines.push(`Open \`${RETIRED_MARKER_LABEL}\` issues: ${retired.length}`)
    for (const m of retired) lines.push(`  #${m.number} ${m.title}`)
  }
  if (problems.length === 0) {
    lines.push('')
    lines.push('OK — at most one orchestrator marker is open.')
  } else {
    lines.push('')
    lines.push('FAIL:')
    for (const p of problems) lines.push(`  - ${p}`)
  }
  lines.push('')
  lines.push(
    'LIMIT (plan item B1b): this detects a MARKED collision only. A session that never ' +
      'claims a marker is invisible to it, and nothing in CI can PREVENT a second ' +
      'orchestrator starting — a marker is claimed outside any pull request. This makes a ' +
      'collision visible, not impossible.',
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function gh(args) {
  let raw
  try {
    raw = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (error) {
    // A failed gh call is UNKNOWN. This is the whole point of B1: the previous
    // behaviour was to treat any non-answer as "none open".
    throw new Unknown(`\`gh ${args.join(' ')}\` failed: ${error.shortMessage || error.message}`)
  }
  if (raw === undefined || raw === null || raw.trim() === '') {
    // Observed 2026-08-09: gh printed EMPTY OUTPUT while the marker existed.
    // An empty body where a JSON array was required is not an empty array.
    throw new Unknown(
      `\`gh ${args.join(' ')}\` returned an EMPTY body where a JSON array was required. ` +
        `This has happened before while a marker existed. Empty is UNKNOWN, never "none open".`,
    )
  }
  return raw
}

function ghJson(args) {
  const raw = gh(args)
  try {
    return JSON.parse(raw)
  } catch {
    throw new Unknown(`\`gh ${args.join(' ')}\` did not return JSON`)
  }
}

export const defaultIo = {
  /**
   * EVERY open issue. Deliberately NOT `?labels=...`: the server-side label
   * filter is eventually consistent and has returned empty for an issue that
   * provably carried the label. Labels are matched client-side in `evaluate`.
   */
  openIssues: (repo) => ghJson(['api', '--paginate', `repos/${repo}/issues?state=open&per_page=100`]),
  labels: (repo) => ghJson(['api', '--paginate', `repos/${repo}/labels?per_page=100`]),
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function main(argv = [], io = defaultIo) {
  const repoFlag = argv.indexOf('--repo')
  const repo = repoFlag !== -1 ? argv[repoFlag + 1] : process.env.GITHUB_REPOSITORY || DEFAULT_REPO
  const asJson = argv.includes('--json')

  let result
  try {
    result = evaluate(io.openIssues(repo))
    result.problems.push(...evaluateLabels(io.labels(repo)))
    result.ok = result.problems.length === 0
  } catch (error) {
    if (error instanceof Unknown) {
      // Loud, and explicitly NOT a pass. Silence here is the original defect.
      console.error(`UNKNOWN: ${error.message}`)
      console.error(
        'Could not determine how many orchestrator markers are open. This is NOT "none open". ' +
          'Assume a marker exists and confirm by hand before dispatching anything:',
      )
      console.error(`  gh api "repos/${repo}/issues?state=open&per_page=100" --paginate --jq '.[] | select(.labels[].name=="${MARKER_LABEL}") | .number'`)
      return EXIT_UNKNOWN
    }
    throw error
  }

  if (asJson) console.log(JSON.stringify(result, null, 2))
  else console.log(formatReport(result))

  return result.ok ? EXIT_OK : EXIT_FAIL
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
