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
  Unknown,
  evaluate,
  evaluateLabels,
  formatReport,
  main,
} from './check-orchestrator-marker.mjs'

const issue = (number, labels, extra = {}) => ({
  number,
  title: `issue ${number}`,
  labels: labels.map((name) => ({ name })),
  ...extra,
})

/** An io stub. Anything omitted returns an empty list. */
const io = ({ issues = [], labels = [] } = {}) => ({
  openIssues: () => issues,
  labels: () => labels,
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
