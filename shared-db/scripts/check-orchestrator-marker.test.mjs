/**
 * Plan item B2 of `plan_orchestrator-workflow-gaps.md` (issue #619):
 * negative-path tests for the orchestrator marker guard.
 *
 * NO DATABASE, NO NETWORK. The `gh` layer is injected.
 *
 * The required cases from B2 -- two open markers must FAIL, a `gh` error must
 * FAIL, zero open must PASS, one must PASS -- plus the three real ways this
 * repo has recorded the question being answered wrongly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EXIT_OK,
  EXIT_FAIL,
  EXIT_UNKNOWN,
  MARKER_LABEL,
  RETIRED_MARKER_LABEL,
  EXIT_NONE,
  Unknown,
  evaluate,
  evaluateRouting,
  resolveTarget,
  evaluateLabels,
  formatReport,
  formatTarget,
  main,
} from './check-orchestrator-marker.mjs'

/**
 * A VALID routing block (#1605). Tests that predate the routing contract used a
 * marker with no body at all; a bare marker is now a FAILURE, so the shared
 * fixture carries a good block and the routing tests vary it deliberately.
 */
const ROUTING = (over = {}) => {
  const fields = {
    status: 'active',
    identifier: 'shared-db.orch',
    engine: 'codex',
    session_name: 'shared-db.orch EDGE-DEV resume-1579',
    route_id: '01a0387e-2895-72d3-97c2-55838595c69e',
    owner: 'u2giants',
    machine: 'EDGE-DEV',
    started: '2026-08-26T14:39:25Z',
    handover_issue: 'none',
    briefing: 'HANDOFF.d/example.md',
    ...over,
  }
  const body = Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return '```orchestrator-routing\n' + body + '\n```'
}

const issue = (number, labels, extra = {}) => ({
  number,
  title: `issue ${number}`,
  labels: labels.map((name) => ({ name })),
  body: labels.includes(MARKER_LABEL) ? ROUTING() : '',
  created_at: '2026-08-27T09:00:00Z',
  ...extra,
})

/** An io stub. Anything omitted returns an empty list. */
const io = ({ issues = [], labels = [], bodies = {} } = {}) => ({
  openIssues: () => issues,
  labels: () => labels,
  issueBody: (_repo, number) => bodies[number] ?? '',
})

// --- B2: the four required cases -------------------------------------------

test('zero open markers PASSES', () => {
  assert.equal(main([], io({ issues: [issue(1, ['db-work'])] })), EXIT_OK)
})

test('exactly one open marker PASSES', () => {
  assert.equal(main([], io({ issues: [issue(793, [MARKER_LABEL])] })), EXIT_OK)
})

test('two open markers FAIL, and both are named', () => {
  const issues = [issue(793, [MARKER_LABEL]), issue(855, [MARKER_LABEL])]
  assert.equal(main([], io({ issues })), EXIT_FAIL)

  const result = evaluate(issues)
  assert.equal(result.ok, false)
  assert.equal(result.markers.length, 2)
  assert.match(result.problems[0], /#793/)
  assert.match(result.problems[0], /#855/)
})

test('a gh error is UNKNOWN and exits non-zero -- it is NOT "none open"', () => {
  const exit = main([], {
    openIssues: () => {
      throw new Unknown('`gh api ...` failed: not authenticated')
    },
    labels: () => [],
  })
  assert.equal(exit, EXIT_UNKNOWN)
  assert.notEqual(exit, EXIT_OK, 'an unreadable answer must never pass')
})

// --- The three recorded ways the question got answered wrongly --------------

test('an EMPTY gh body is UNKNOWN, not zero markers', () => {
  // Observed 2026-08-09: `gh issue list --label orchestrator-marker` printed
  // empty output while the marker existed. Only the JSON form showed it.
  const exit = main([], {
    openIssues: () => {
      throw new Unknown('returned an EMPTY body where a JSON array was required')
    },
    labels: () => [],
  })
  assert.equal(exit, EXIT_UNKNOWN)
})

test('a non-array response is UNKNOWN, not zero markers', () => {
  assert.throws(() => evaluate(null), Unknown)
  assert.throws(() => evaluate(undefined), Unknown)
  assert.throws(() => evaluate({ message: 'Not Found' }), Unknown)
})

test('B1a: the retired coordinator-marker label on an open issue FAILS', () => {
  const issues = [issue(473, [RETIRED_MARKER_LABEL])]
  assert.equal(main([], io({ issues })), EXIT_FAIL)
  assert.match(evaluate(issues).problems[0], /renamed/)
})

test('B1a: the retired label merely EXISTING in the repo FAILS', () => {
  // Querying a retired label returns empty, and step 0 reads empty as
  // permission to start. If the label can be claimed, it can lie again.
  const problems = evaluateLabels([{ name: 'db-work' }, { name: RETIRED_MARKER_LABEL }])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /Delete it/)
  assert.equal(main([], io({ labels: [{ name: RETIRED_MARKER_LABEL }] })), EXIT_FAIL)
})

test('the guard never uses a server-side label filter', () => {
  // The filter is eventually consistent: on 2026-08-07 it returned empty for an
  // issue that provably carried the label, then returned it five seconds later.
  // Labels must be matched client-side. This asserts the io contract, which is
  // the part a future edit would most plausibly "optimise" back into the bug.
  let requested = null
  main([], { openIssues: (repo) => ((requested = repo), []), labels: () => [] })
  assert.ok(requested, 'openIssues must be called with the repo')
})

// --- Shape details that carry real failure modes ----------------------------

test('pull requests carrying the label are not counted as sessions', () => {
  const issues = [
    issue(793, [MARKER_LABEL]),
    issue(800, [MARKER_LABEL], { pull_request: { url: 'x' } }),
  ]
  assert.equal(evaluate(issues).markers.length, 1)
  assert.equal(main([], io({ issues })), EXIT_OK)
})

test('string labels and object labels are both understood', () => {
  const raw = [{ number: 1, title: 't', labels: [MARKER_LABEL] }]
  assert.equal(evaluate(raw).markers.length, 1)
})

test('an issue with no labels key does not crash the guard', () => {
  assert.equal(evaluate([{ number: 1, title: 't' }]).markers.length, 0)
})

test('B1b: the report always states what the check cannot do', () => {
  // The limit must appear wherever the check is documented, including its own
  // output -- otherwise a green run reads as "no second orchestrator exists".
  const report = formatReport(evaluate([issue(793, [MARKER_LABEL])]))
  assert.match(report, /MARKED collision only/)
  assert.match(report, /never claims a marker/)
  assert.match(report, /visible, not impossible/)
})

// --- #1605: the routing contract -------------------------------------------
//
// The marker proved an orchestrator EXISTED and never said where to reach one,
// so a session resolved the destination from an old handoff and delegated to a
// session that had already CLOSED. Every test below is a way that can happen.

const marker = (over = {}, extra = {}) =>
  issue(1602, [MARKER_LABEL], { body: ROUTING(over), ...extra })

test('a marker with NO routing block FAILS — it names no delegation target', () => {
  const result = evaluateRouting([{ number: 1602, body: 'Started: 2026-08-27', createdAt: '2026-08-27T09:00:00Z' }])
  assert.equal(result.problems.length, 1)
  assert.match(result.problems[0], /no `orchestrator-routing` block/)
  assert.equal(main([], io({ issues: [issue(1602, [MARKER_LABEL], { body: 'Started: today' })] })), EXIT_FAIL)
})

test('a missing route_id FAILS, and a BLANK one is not a default', () => {
  assert.equal(main([], io({ issues: [marker({ route_id: null })] })), EXIT_FAIL)
  assert.equal(main([], io({ issues: [marker({ route_id: '' })] })), EXIT_FAIL)
})

test('a PLACEHOLDER route_id FAILS — it reads as answered and routes nowhere', () => {
  for (const placeholder of ['TBD', 'none', 'unknown', 'n/a', 'pending']) {
    assert.equal(
      main([], io({ issues: [marker({ route_id: placeholder })] })),
      EXIT_FAIL,
      `${placeholder} must not pass as a routable id`,
    )
  }
})

test('a route_id of the wrong SHAPE for its engine FAILS', () => {
  // A Claude sessionId in a Codex marker routes nowhere: `codex-reply` takes a
  // thread UUID. Cross-engine paste is the likeliest hand-authoring error.
  assert.equal(main([], io({ issues: [marker({ route_id: 'local_baefce7c-eb8b-4733-8a37-357f141ae013' })] })), EXIT_FAIL)
  assert.equal(main([], io({ issues: [marker({ engine: 'claude', route_id: 'local_baefce7c-eb8b-4733-8a37-357f141ae013' })] })), EXIT_OK)
  assert.equal(main([], io({ issues: [marker({ engine: 'perl' })] })), EXIT_FAIL)
})

test('the identifier must be exactly shared-db.orch', () => {
  assert.equal(main([], io({ issues: [marker({ identifier: 'shared-db-orchestrator' })] })), EXIT_FAIL)
  assert.equal(main([], io({ issues: [marker({ session_name: 'EDGE-DEV orchestrator' })] })), EXIT_FAIL)
  assert.equal(main([], io({ issues: [marker({ session_name: 'shared-db.orch anything after' })] })), EXIT_OK)
})

test('an OPEN marker whose status is not active FAILS', () => {
  // An orchestrator that stops CLOSES its marker. Leaving one open in another
  // state is what stops a successor starting while nobody is actually running.
  assert.equal(main([], io({ issues: [marker({ status: 'closed' })] })), EXIT_FAIL)
  assert.equal(main([], io({ issues: [marker({ status: 'handing-over' })] })), EXIT_FAIL)
})

test('an unorderable start time FAILS', () => {
  assert.equal(main([], io({ issues: [marker({ started: '2026-08-26' })] })), EXIT_FAIL)
  assert.equal(main([], io({ issues: [marker({ started: 'this morning' })] })), EXIT_FAIL)
})

test('a SUCCESSOR that inherits its predecessor route_id FAILS', () => {
  // The exact defect: the successor's marker pointed at the closed session.
  const inherited = '01a0387e-2895-72d3-97c2-55838595c69e'
  const issues = [marker({ handover_issue: '1579', route_id: inherited })]
  const bodies = { 1579: ROUTING({ route_id: inherited }) }
  assert.equal(main([], io({ issues, bodies })), EXIT_FAIL)

  // Its OWN new id is what the contract requires, and it passes.
  const own = [marker({ handover_issue: '1579', route_id: '01a03125-3b15-7373-b7fc-4b95ca9e49d1' })]
  assert.equal(main([], io({ issues: own, bodies })), EXIT_OK)
})

test('an UNREADABLE predecessor is UNKNOWN, not a pass', () => {
  // ⚠️ THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-08-26. It required EXIT_OK on
  // the reasoning that an unreadable predecessor must not block a successor with
  // a valid id of its own. Independent Codex GPT-5.6 review showed that is
  // fail-OPEN and defeats the inheritance check entirely: a successor honestly
  // declares handover_issue: 1579, copies #1579's stale id, the read of #1579
  // transiently fails, the copy compares against null and PASSES — routing to
  // the dead session this whole contract exists to prevent. Availability is not
  // the property being protected. If the check cannot run, the answer is UNKNOWN.
  const issues = [marker({ handover_issue: '1579' })]
  const exit = main([], {
    openIssues: () => issues,
    labels: () => [],
    issueBody: () => {
      throw new Unknown('predecessor unreadable')
    },
  })
  assert.equal(exit, EXIT_UNKNOWN)
  assert.notEqual(exit, EXIT_OK, 'an unverifiable inheritance check must never pass')
})

test('resolve: a RETIRED-LABEL collision refuses to resolve, even with a valid marker', () => {
  // ⚠️ FOUND 2026-08-26 by independent Codex GPT-5.6 review, and it was real:
  // `--resolve` originally received only the marker list and never consulted
  // the guard's own problems or the label check. One valid marker plus an open
  // `coordinator-marker` issue therefore FAILED the guard and RESOLVED to an
  // active target on identical input — routing straight past a detected
  // second-orchestrator signal. Anything that fails the guard must refuse.
  const issues = [marker(), issue(2, [RETIRED_MARKER_LABEL])]
  assert.equal(main([], io({ issues })), EXIT_FAIL, 'the normal guard must fail')
  assert.equal(main(['--resolve'], io({ issues })), EXIT_FAIL, 'and resolution must refuse')
})

test('resolve: the retired label merely EXISTING refuses to resolve', () => {
  const issues = [marker()]
  assert.equal(main(['--resolve'], io({ issues, labels: [{ name: RETIRED_MARKER_LABEL }] })), EXIT_FAIL)
})

test('resolve: the MACHINE-READABLE state is "declared", never "active"', () => {
  // Found 2026-08-26 by independent Codex GPT-5.6 review, round 2: the human
  // output was corrected to MARKER-DECLARED TARGET while the JSON still said
  // `state: "active"`, so any tool reading the JSON kept the exact overclaim the
  // prose had just dropped. Shape is all that is ever checked.
  const target = resolveTarget(evaluate([marker()]).markers)
  assert.equal(target.state, 'declared')
  assert.notEqual(target.state, 'active')
})

test('resolve: a target is DECLARED, never proven active or reachable', () => {
  // Shape is all this repo can check — there is no session API. A fabricated
  // UUID resolves exactly like a real one, so the output must not claim more.
  const out = formatTarget(resolveTarget(evaluate([marker({ route_id: '00000000-0000-4000-8000-000000000000' })]).markers))
  assert.match(out, /MARKER-DECLARED TARGET/)
  assert.doesNotMatch(out, /^ACTIVE ORCHESTRATOR/m)
  assert.match(out, /NOT PROVEN/)
  assert.match(out, /silence is not delivery/)
})

test('a marker predating the contract WARNS but does not fail the guard', () => {
  // Marker #1602 was live at merge and no PR author could fix it.
  const stale = issue(1602, [MARKER_LABEL], { body: 'Started: 2026-08-20', created_at: '2026-08-20T10:00:00Z' })
  assert.equal(main([], io({ issues: [stale] })), EXIT_OK)
  const routing = evaluateRouting(evaluate([stale]).markers)
  assert.equal(routing.problems.length, 0)
  assert.ok(routing.warnings.some((w) => /does not fail the guard/.test(w)))
  assert.match(formatReport({ ...evaluate([stale]), ...routing }), /WARNING \(grandfathered/)
})

// --- #1605: --resolve, the only sanctioned way to get a destination ---------

test('resolve: ZERO markers is NO ACTIVE ORCHESTRATOR — queue, do not dispatch', () => {
  const target = resolveTarget([])
  assert.equal(target.state, 'none')
  assert.equal(target.routing, null)
  assert.match(target.message, /QUEUE the work/)
  assert.match(target.message, /not permission to dispatch/)
  // A distinct exit code: "nobody is running" must never be confused with OK.
  assert.equal(main(['--resolve'], io({ issues: [] })), EXIT_NONE)
})

test('resolve: TWO markers is ambiguous and unsafe — no target is returned', () => {
  const target = resolveTarget([{ number: 1 }, { number: 2 }])
  assert.equal(target.state, 'ambiguous')
  assert.equal(target.routing, null)
  assert.match(target.message, /AMBIGUOUS/)
  assert.equal(main(['--resolve'], io({ issues: [issue(1, [MARKER_LABEL]), issue(2, [MARKER_LABEL])] })), EXIT_FAIL)
})

test('resolve: ONE valid marker returns the routable target and how to reach it', () => {
  const target = resolveTarget(evaluate([marker()]).markers)
  assert.equal(target.state, 'declared')
  assert.equal(target.routing.routeId, '01a0387e-2895-72d3-97c2-55838595c69e')
  assert.equal(target.routing.identifier, 'shared-db.orch')
  assert.match(target.routing.howToReach, /codex-reply.* with threadId/)
  assert.equal(main(['--resolve'], io({ issues: [marker()] })), EXIT_OK)
})

test('resolve: a Claude-held orchestrator resolves to a Claude session message', () => {
  const target = resolveTarget(
    evaluate([marker({ engine: 'claude', route_id: 'local_baefce7c-eb8b-4733-8a37-357f141ae013' })]).markers,
  )
  assert.equal(target.state, 'declared')
  assert.match(target.routing.howToReach, /Claude cross-session message to sessionId/)
})

test('resolve: INVALID is not NONE — an orchestrator may be live and unreachable', () => {
  // These are opposite instructions and collapsing them is the whole defect.
  const target = resolveTarget(evaluate([issue(1602, [MARKER_LABEL], { body: 'no block here' })]).markers)
  assert.equal(target.state, 'invalid')
  assert.equal(target.routing, null)
  assert.match(target.message, /may be live and unreachable/)
  assert.match(target.message, /NOT "no orchestrator"/)
  assert.notEqual(main(['--resolve'], io({ issues: [issue(1602, [MARKER_LABEL], { body: 'x' })] })), EXIT_NONE)
})

test('resolve: grandfathering NEVER applies — a stale marker still cannot be routed to', () => {
  // The PR guard forgives a marker written before the contract. Resolution
  // cannot: it still carries no address, and inventing one is the defect.
  const stale = issue(1602, [MARKER_LABEL], { body: 'Started: 2026-08-20', created_at: '2026-08-20T10:00:00Z' })
  assert.equal(main([], io({ issues: [stale] })), EXIT_OK)
  assert.equal(resolveTarget(evaluate([stale]).markers).state, 'invalid')
  assert.equal(main(['--resolve'], io({ issues: [stale] })), EXIT_FAIL)
})

test('resolve: an unreadable GitHub stays UNKNOWN, never "no active orchestrator"', () => {
  const exit = main(['--resolve'], {
    openIssues: () => {
      throw new Unknown('gh failed')
    },
    labels: () => [],
    issueBody: () => '',
  })
  assert.equal(exit, EXIT_UNKNOWN)
  assert.notEqual(exit, EXIT_NONE)
})

test('resolve: the target names the CURRENT marker and forbids history as a source', () => {
  // Closing or handing over a marker must invalidate the old target by
  // construction, not by anyone remembering to stop using it.
  const out = formatTarget(resolveTarget(evaluate([marker()]).markers))
  assert.match(out, /resolved from open marker #1602 only/)
  assert.match(out, /Do not route from a handoff, a closed marker, or conversation history/)
  assert.match(out, /Re-resolve before every delegation/)
})
