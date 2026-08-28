#!/usr/bin/env node
/**
 * Guard: at most ONE open orchestrator marker, and an unreadable answer is
 * UNKNOWN -- never "none open".
 *
 * Plan item B1/B1a/B1b of plan_orchestrator-workflow-gaps.md, issue #619.
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
 *   FAIL    2 or more open markers, the retired label is alive (B1a), or the
 *           single open marker carries no valid routing contract (#1605).
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
 * ROUTING (#1605)
 * ---------------
 * Counting markers answers "is someone running". It never answered "WHERE DO I
 * SEND WORK", and a session with no answer to that resolved the destination
 * from conversation history and an old handoff -- and delegated to an
 * orchestrator that had already closed. Every open marker must now carry an
 * `orchestrator-routing` block; see `scripts/lib/orchestrator-routing.mjs`.
 *
 * `--resolve` is the ONLY sanctioned way to obtain a delegation target. It
 * reads the CURRENT open marker and nothing else, so closing or handing over a
 * marker invalidates the old target by construction.
 *
 * ⚠️ NONE AND INVALID ARE DIFFERENT ANSWERS AND NEITHER IS PERMISSION TO
 * DISPATCH. None means nobody is running -- QUEUE the work until a successor
 * starts. Invalid means an orchestrator may be live and unreachable -- STOP.
 * Collapsing either into the other is the defect B1 exists to prevent.
 *
 * USAGE
 *   node scripts/check-orchestrator-marker.mjs [--repo owner/name] [--json]
 *   node scripts/check-orchestrator-marker.mjs --resolve [--repo owner/name] [--json]
 *
 * EXIT CODES
 *   0  OK
 *   1  FAIL     -- more than one marker, the retired label is alive, or the
 *                  open marker's routing contract is missing or malformed
 *   2  UNKNOWN  -- could not determine. Treat as "assume a marker exists".
 *   3  NONE     -- `--resolve` only: no open marker, so NO ACTIVE ORCHESTRATOR.
 *                  Queue the work. This is not a licence to dispatch.
 */

import { execFileSync } from 'node:child_process'
import { parseRoutingBlock, validateRouting } from './lib/orchestrator-routing.mjs'
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
/** `--resolve` only: no open marker at all. Queue the work; do not dispatch. */
export const EXIT_NONE = 3

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
    .map((i) => ({ number: i.number, title: i.title, body: i.body ?? '', createdAt: i.created_at ?? null }))

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

/**
 * The routing contract took effect on this date (#1605).
 *
 * A marker opened BEFORE it cannot be failed for lacking a block that did not
 * exist when it was written -- marker #1602 was live at merge. Grandfathering
 * keeps the PR guard honest instead of red for a reason no PR author can fix.
 *
 * ⚠️ IT IS SCOPED TO THE PR GUARD AND NOTHING ELSE. `--resolve` NEVER
 * grandfathers: a grandfathered marker still carries no address, so it still
 * cannot be routed to, and saying otherwise would hand back a destination that
 * does not exist. That is the original defect.
 *
 * It is the day AFTER this merged, not the day of. Marker #1602 was opened on
 * 2026-08-26, hours before the contract existed; a same-day cutoff would fail
 * the live orchestrator's marker for not carrying a block nobody could have
 * written yet. The first marker that can honestly be held to this is the first
 * one opened after it shipped.
 */
export const CONTRACT_EFFECTIVE_DATE = '2026-08-27'

/**
 * Validate the routing contract on the open markers.
 *
 * Only meaningful for exactly one marker: zero has nothing to validate, and two
 * or more already FAIL on count -- routing problems would be noise on top of an
 * ambiguity the session must resolve first.
 *
 * @param markers from `evaluate`
 * @param predecessorRouteIdOf optional `(issueNumber) => routeId|null`
 */
export function evaluateRouting(markers, predecessorRouteIdOf = () => null) {
  if (markers.length !== 1) return { problems: [], warnings: [], routing: null }
  const [marker] = markers

  const fields = parseRoutingBlock(marker.body)
  const handover = fields?.handover_issue?.replace(/^#/, '')
  const predecessorRouteId =
    handover && /^\d+$/.test(handover) ? predecessorRouteIdOf(Number(handover)) : null

  const { valid, problems, routing } = validateRouting(fields, { predecessorRouteId })
  if (valid) return { problems: [], warnings: [], routing }

  const grandfathered =
    marker.createdAt && marker.createdAt.slice(0, 10) < CONTRACT_EFFECTIVE_DATE

  const prefixed = problems.map((p) => `marker #${marker.number}: ${p}`)
  if (grandfathered) {
    return {
      problems: [],
      warnings: [
        ...prefixed,
        `marker #${marker.number} opened ${marker.createdAt.slice(0, 10)}, before the routing ` +
          `contract took effect on ${CONTRACT_EFFECTIVE_DATE}, so this does not fail the guard. ` +
          `It DOES mean the marker names no delegation target: \`--resolve\` reports it INVALID ` +
          `and no session may route to it. Edit the marker to add the block, or close it.`,
      ],
      routing: null,
    }
  }
  return { problems: prefixed, warnings: [], routing: null }
}

/**
 * Resolve the delegation target from the CURRENT open marker and nothing else.
 *
 * Never consults conversation history, a handoff file, or a closed marker --
 * which is what makes closing or handing over a marker invalidate the old
 * target automatically rather than by anyone remembering to.
 *
 * @returns {{state: 'declared'|'none'|'ambiguous'|'invalid', ...}}
 */
export function resolveTarget(markers, predecessorRouteIdOf = () => null) {
  if (markers.length === 0) {
    return {
      state: 'none',
      routing: null,
      message:
        'NO ACTIVE ORCHESTRATOR: zero open markers. QUEUE the work until a successor starts ' +
        'and opens one. Zero markers is not permission to dispatch, and it is not permission ' +
        'to start orchestrating without claiming a marker yourself.',
    }
  }
  if (markers.length > 1) {
    return {
      state: 'ambiguous',
      routing: null,
      message:
        `AMBIGUOUS and UNSAFE: ${markers.length} open markers (${markers.map((m) => `#${m.number}`).join(', ')}). ` +
        'Two orchestrators dispatching at once is how this repo produced four competing ' +
        'migrations on one function. Do not guess which is live and do not route to either.',
    }
  }
  const { problems, warnings, routing } = evaluateRouting(markers, predecessorRouteIdOf)
  // `declared`, NOT `active`. Flagged 2026-08-26 by independent Codex GPT-5.6
  // review: the human output was corrected to MARKER-DECLARED TARGET while the
  // machine-readable state still said `active`, so any tool reading the JSON kept
  // the overclaim the prose had just dropped. Shape is all that was checked.
  if (routing) return { state: 'declared', routing, message: null, marker: markers[0].number }
  return {
    state: 'invalid',
    routing: null,
    marker: markers[0].number,
    message:
      `UNROUTABLE: marker #${markers[0].number} is open but names no usable delegation target. ` +
      'An orchestrator may be live and unreachable. This is NOT "no orchestrator" -- do not ' +
      'fall back to a handoff, an old marker, or conversation history for an address. ' +
      'Reasons:\n' +
      [...problems, ...warnings].map((p) => `  - ${p}`).join('\n'),
  }
}

export function formatReport({ markers, retired, problems, warnings = [], routing = null }) {
  const lines = []
  lines.push(`Open \`${MARKER_LABEL}\` issues: ${markers.length}`)
  for (const m of markers) lines.push(`  #${m.number} ${m.title}`)
  if (retired.length > 0) {
    lines.push(`Open \`${RETIRED_MARKER_LABEL}\` issues: ${retired.length}`)
    for (const m of retired) lines.push(`  #${m.number} ${m.title}`)
  }
  if (routing) {
    lines.push('')
    lines.push(`Delegation target (#1605): ${routing.howToReach}`)
    lines.push(`  session_name: ${routing.sessionName}`)
    lines.push(`  owner: ${routing.owner}   machine: ${routing.machine}   started: ${routing.started}`)
  }
  if (warnings.length > 0) {
    lines.push('')
    lines.push('WARNING (grandfathered — does not fail this check):')
    for (const w of warnings) lines.push(`  - ${w}`)
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

/**
 * Human-readable delegation target for `--resolve`.
 *
 * ⚠️ THE HEADING SAYS "DECLARED", NOT "ACTIVE", AND THAT IS DELIBERATE. It read
 * `ACTIVE ORCHESTRATOR` until an independent Codex GPT-5.6 review on 2026-08-26
 * pointed out that nothing here proves activity. This repository has no session
 * API: it validates the SHAPE of an id, never that the session exists, is
 * running, belongs to the named owner or machine, is the shared-db
 * orchestrator, or can receive anything. A fabricated UUID with otherwise valid
 * fields resolves exactly like a real one. What is proven is narrow and worth
 * stating exactly: ONE open marker DECLARES this address.
 */
export function formatTarget({ routing, marker }) {
  return [
    `MARKER-DECLARED TARGET — resolved from open marker #${marker} only.`,
    '',
    `  identifier:   ${routing.identifier}`,
    `  session_name: ${routing.sessionName}`,
    `  engine:       ${routing.engine}`,
    `  route_id:     ${routing.routeId}`,
    `  owner:        ${routing.owner}`,
    `  machine:      ${routing.machine}`,
    `  started:      ${routing.started}`,
    `  handover:     ${routing.handoverIssue ? `#${routing.handoverIssue}` : 'none (cold start)'}`,
    `  briefing:     ${routing.briefing}`,
    '',
    `  TRY IT BY:    ${routing.howToReach}`,
    '',
    'This came from the CURRENT open marker. Do not route from a handoff, a closed marker, ' +
      'or conversation history — those are how a delegation reached a session that had ' +
      'already closed. Re-resolve before every delegation; a handover changes this target.',
    '',
    'NOT PROVEN: that this session exists, is running, is reachable, or is the orchestrator. ' +
      'Only that one open marker declares this address. Confirm you got a reply — silence is ' +
      'not delivery, and this tool cannot tell you the difference.',
  ].join('\n')
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
  /**
   * One issue's body, open or CLOSED — a predecessor marker is closed by
   * definition, so this cannot reuse `openIssues`.
   */
  issueBody: (repo, number) => ghJson(['api', `repos/${repo}/issues/${number}`])?.body ?? '',
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function main(argv = [], io = defaultIo) {
  const repoFlag = argv.indexOf('--repo')
  const repo = repoFlag !== -1 ? argv[repoFlag + 1] : process.env.GITHUB_REPOSITORY || DEFAULT_REPO
  const asJson = argv.includes('--json')
  const resolving = argv.includes('--resolve')

  /**
   * The predecessor's routable id, read from the handover issue it names.
   *
   * ⚠️ A LOOKUP FAILURE IS `Unknown`, NOT `null`. This originally swallowed the
   * error and returned null "so that an unreadable predecessor cannot block a
   * successor that recorded a valid id of its own". Independent Codex GPT-5.6
   * review, 2026-08-26, showed that is fail-OPEN and defeats the check outright:
   * a successor honestly declares `handover_issue: 1579`, copies #1579's stale
   * id, GitHub read of #1579 transiently fails, the copy compares against null
   * and PASSES — routing to the dead session this contract exists to prevent.
   * Availability is not the property being protected here. If the inheritance
   * check cannot run, the answer is UNKNOWN.
   */
  const predecessorRouteIdOf = (number) =>
    parseRoutingBlock(io.issueBody(repo, number))?.route_id ?? null

  let result
  try {
    result = evaluate(io.openIssues(repo))

    if (resolving) {
      // ⚠️ THE SAFETY FINDINGS GATE RESOLUTION. Found 2026-08-26 by independent
      // Codex GPT-5.6 review: this originally passed only `result.markers` to
      // `resolveTarget` and never consulted `result.problems` or the label
      // check. One valid marker PLUS an open `coordinator-marker` issue then
      // FAILED the guard and RESOLVED to an active target on the same input --
      // routing straight past a detected second-orchestrator signal. Anything
      // that fails the guard must refuse to resolve.
      const unsafe = [...result.problems, ...evaluateLabels(io.labels(repo))]
      if (unsafe.length > 0) {
        const message =
          'UNSAFE — refusing to resolve a delegation target. The marker guard failed on this ' +
          'repository state, so no address here can be trusted. Resolve the collision first:\n' +
          unsafe.map((p) => `  - ${p}`).join('\n')
        if (asJson) console.log(JSON.stringify({ state: 'unsafe', routing: null, message }, null, 2))
        else console.log(message)
        return EXIT_FAIL
      }

      const target = resolveTarget(result.markers, predecessorRouteIdOf)
      if (asJson) console.log(JSON.stringify(target, null, 2))
      else console.log(target.state === 'declared' ? formatTarget(target) : target.message)
      if (target.state === 'declared') return EXIT_OK
      return target.state === 'none' ? EXIT_NONE : EXIT_FAIL
    }

    const routingResult = evaluateRouting(result.markers, predecessorRouteIdOf)
    result.problems.push(...routingResult.problems)
    result.warnings = routingResult.warnings
    result.routing = routingResult.routing
    result.problems.push(...evaluateLabels(io.labels(repo)))
    result.ok = result.problems.length === 0
  } catch (error) {
    if (error instanceof Unknown) {
      // Loud, and explicitly NOT a pass. Silence here is the original defect.
      console.error(`UNKNOWN: ${error.message}`)
      console.error(
        'Could not determine how many orchestrator markers are open. This is NOT "none open", ' +
          'and under --resolve it is NOT "no active orchestrator". ' +
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
