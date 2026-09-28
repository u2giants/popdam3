import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePreflight, gatherPreflightInput, observedStates, collectPages, requireWholePage, waitForPreflight, PreflightError, SELF_CONTEXT, GITHUB_ACTIONS_APP_ID } from './check-required-checks-preflight.mjs'
import { readEffectiveRequiredChecks, computeRevision, RequiredCheckAuthorityError } from './lib/required-check-authority.mjs'
const sha = 'a'.repeat(40)
function makeAuthority(overrides = {}) {
  const base = {
    mode: 'live-effective-settings',
    repository_id: 1,
    repository: 'popcre/shared-db',
    branch: 'main',
    sources: { classic: null, rulesets: [] },
    checks: [{ context: 'required', app_id: GITHUB_ACTIONS_APP_ID }, { context: SELF_CONTEXT, app_id: GITHUB_ACTIONS_APP_ID }],
  }
  const merged = { ...base, ...overrides }
  merged.revision = computeRevision(merged)
  return merged
}
const authority = makeAuthority()
const ok = (name = 'required', extra = {}) => ({ name, head_sha: sha, app: { id: GITHUB_ACTIONS_APP_ID }, status: 'completed', conclusion: 'success', started_at: '2026-09-20T10:00:00Z', ...extra })
const evaluate = (extra = {}) => evaluatePreflight({ authority, sha, checkRuns: [ok()], ...extra })
test('green exact-head required producer passes with only self authorization excluded', () => assert.equal(evaluate().required, 1))
test('required missing, pending, failing, skipped and neutral all refuse', () => {
  assert.throws(() => evaluate({ checkRuns: [] }), /never reported/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { status: 'queued' })] }), /still running/)
  for (const conclusion of ['failure', 'cancelled', 'neutral', 'skipped', 'timed_out']) assert.throws(() => evaluate({ checkRuns: [ok('required', { conclusion })] }), /failing/)
})
test('wrong app and wrong head cannot satisfy required result; later foreign success cannot mask failure', () => {
  assert.throws(() => evaluate({ checkRuns: [ok('required', { app: { id: 7 } })] }), /never reported/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { head_sha: 'c'.repeat(40) })] }), /never reported/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { conclusion: 'failure' }), ok('required', { app: { id: 7 }, started_at: '2026-09-20T11:00:00Z' })] }), /failing/)
  assert.throws(() => evaluate({ checkRuns: [], statuses: [{ context: 'required', state: 'success', creator: { id: GITHUB_ACTIONS_APP_ID } }] }), /never reported/)
})
test('advisory failure remains visible without independently vetoing a merge', () => {
  const result = evaluate({ checkRuns: [ok(), ok('optional', { conclusion: 'failure' })] })
  assert.deepEqual(result.advisory, [['optional', 'failure']])
  assert.match(result.shadow, /would refuse advisory/)
})
test('an unexpired attestation never substitutes for fresh effective settings', () => {
  assert.throws(() => evaluate({ authority: { ...makeAuthority(), mode: 'snapshot', expires: '2099-01-01' } }), /fresh effective/)
})
test('a newly effective requirement is enforced even with a still-valid old snapshot', () => {
  const current = makeAuthority({ checks: [...authority.checks, { context: 'new ruleset requirement', app_id: 7 }] })
  assert.throws(() => evaluate({ authority: current, snapshot: authority }), /never reported: new ruleset/)
})
test('same name requirements from two apps both apply; self authorization cannot change producer', () => {
  assert.throws(() => evaluate({ authority: makeAuthority({ checks: [...authority.checks, { context: 'required', app_id: 7 }] }) }), /app 7/)
  assert.throws(() => evaluate({ authority: makeAuthority({ checks: [{ context: SELF_CONTEXT, app_id: 7 }, { context: 'required', app_id: GITHUB_ACTIONS_APP_ID }] }) }), /different producer/)
})
test('revision digest is rebound to content; a tampered or stale digest refuses', () => {
  const tampered = { ...makeAuthority(), revision: 'b'.repeat(64) }
  assert.throws(() => evaluate({ authority: tampered }), /revision does not match its own content/)
  const changedChecks = { ...makeAuthority(), checks: [{ context: 'different requirement', app_id: GITHUB_ACTIONS_APP_ID }] }
  assert.throws(() => evaluate({ authority: changedChecks }), /revision does not match its own content/)
})
test('GITHUB_ACTIONS_APP_ID is the documented GitHub Actions producer identity', () => {
  assert.equal(GITHUB_ACTIONS_APP_ID, 15368)
  assert.ok(Number.isSafeInteger(GITHUB_ACTIONS_APP_ID) && GITHUB_ACTIONS_APP_ID > 0)
})
test('latest attempt wins within producer; same-time contradictory results refuse', () => {
  assert.throws(() => evaluate({ checkRuns: [ok(), ok('required', { status: 'queued', started_at: '2026-09-20T11:00:00Z' })] }), /still running/)
  assert.throws(() => evaluate({ checkRuns: [ok(), ok('required', { conclusion: 'failure' })] }), /ambiguous/)
  assert.equal(observedStates({ statuses: [{ context: 'x', state: 'success', id: 1 }] }).get('x'), 'success')
})
function liveRead({ mutateAfter = false, deny = false, truncate = false } = {}) {
  let reads = 0
  return (args) => {
    if (args.includes('graphql')) {
      if (deny) throw Error('403 integration cannot read')
      reads++
      return { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: { id: 'BPR_1', requiresStatusChecks: true, requiresStrictStatusChecks: false, requiredStatusCheckContexts: ['required'], requiredStatusChecks: [{ context: 'required', app: { databaseId: 15368 } }] } } } } }
    }
    if (args.some((arg) => arg.includes('/rules/branches/'))) return [mutateAfter && reads > 1 ? [{ type: 'required_status_checks', ruleset_id: 2, ruleset_source: 'popcre', ruleset_source_type: 'Organization', parameters: { required_status_checks: [{ context: 'new', integration_id: 7 }] } }] : []]
    if (args.some((arg) => arg.includes('/check-runs'))) return [{ total_count: truncate ? 2 : 1, check_runs: [ok()] }]
    return [{ total_count: 0, statuses: [] }]
  }
}
test('gather checks effective settings before and after paginated statuses and refuses mutation', () => {
  const input = gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead() })
  assert.equal(evaluatePreflight(input).required, 1)
  assert.throws(() => gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead({ mutateAfter: true }) }), /changed during/)
  assert.throws(() => gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead({ deny: true }) }), /no snapshot fallback/)
  assert.throws(() => gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead({ truncate: true }) }), /pagination returned only/)
})
test('authority reads use AUTHORITY_TOKEN only and restore GH_TOKEN for status reads', () => {
  const previous = process.env.GH_TOKEN
  process.env.GH_TOKEN = 'ordinary-test-token'
  const observed = []
  const source = liveRead()
  try {
    const input = gatherPreflightInput({ REQUESTED_SHA: sha, AUTHORITY_TOKEN: 'authority-test-token' }, {
      repo: 'popcre/shared-db',
      json(args) {
        observed.push({ authority: args.includes('graphql') || args.some((arg) => String(arg).includes('/rules/branches/')), token: process.env.GH_TOKEN })
        return source(args)
      },
    })
    assert.equal(evaluatePreflight(input).required, 1)
    assert.ok(observed.some(({ authority, token }) => authority && token === 'authority-test-token'))
    assert.ok(observed.some(({ authority, token }) => !authority && token === 'ordinary-test-token'))
    assert.ok(observed.every(({ authority, token }) => token === (authority ? 'authority-test-token' : 'ordinary-test-token')))
    assert.equal(process.env.GH_TOKEN, 'ordinary-test-token')
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = previous
  }
})
test('pagination preserves all pages and refuses incomplete totals', () => {
  assert.deepEqual(collectPages([{ check_runs: [1] }, { check_runs: [2] }], 'check_runs'), [1, 2])
  assert.throws(() => collectPages([{}], 'check_runs'), /no usable/)
  assert.throws(() => requireWholePage('checks', undefined, []), /how many/)
})
test('ruleset pagination refuses a short non-last page (fail-open guard)', () => {
  const rule = { type: 'required_status_checks', ruleset_id: 1, ruleset_source: 'popcre', ruleset_source_type: 'Organization', parameters: { required_status_checks: [{ context: 'required', integration_id: 15368 }] } }
  const graphql = { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: null } } } }
  // Probe mock: REST /protection returns 404 (genuine absence of classic rule).
  const probe404 = () => { const err = Error('gh: Not Found (HTTP 404)'); err.stderr = 'gh: Not Found (HTTP 404)'; throw err }
  const okRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    // Two pages: first has 1 rule (short), second has 1 rule. With per_page=100
    // the first page is incomplete → must refuse.
    return [[rule], [rule]]
  }
  assert.throws(() => readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: okRead }), (err) => err instanceof RequiredCheckAuthorityError && /pagination is incomplete/.test(err.message))
  // Single full-length page (exactly per_page) is ambiguous: --paginate may have
  // stopped at a Link boundary. Refuse unless a second (even empty) page
  // confirms the end.
  const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...rule, ruleset_id: i + 1, parameters: { required_status_checks: [{ context: `c${i}`, integration_id: 15368 }] } }))
  const truncatedRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    return [fullPage]
  }
  assert.throws(() => readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: truncatedRead }), (err) => err instanceof RequiredCheckAuthorityError && /pagination is incomplete/.test(err.message))
  // With a confirming empty second page, a single full page is accepted.
  const fullRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    if (args.some((arg) => String(arg).includes('page=2'))) return []
    return [fullPage]
  }
  const result = readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: fullRead })
  assert.equal(result.checks.length, 100)
  // Two pages where the first is exactly per_page and the second is partial → accepted.
  const partialLast = [[...fullPage], [rule]]
  const partialRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    return partialLast
  }
  const result2 = readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: partialRead })
  assert.equal(result2.checks.length, 101)
})
test('waiting rereads authority, never waits a failure or unknown authority, and bounds pending waits', async () => {
  let time = 0, reads = 0
  const deps = { now: () => time, sleep: async (ms) => { time += ms }, log() {}, gather() { reads++; return {} }, evaluate() { if (reads < 2) throw new PreflightError('still running: required'); return { required: 1 } } }
  assert.equal((await waitForPreflight({ PREFLIGHT_WAIT_SECONDS: '2', PREFLIGHT_POLL_SECONDS: '1' }, deps)).required, 1)
  assert.equal(reads, 2)
  for (const message of ['failing: required', 'authority unreadable']) await assert.rejects(waitForPreflight({}, { ...deps, evaluate() { throw new PreflightError(message) } }), new RegExp(message))
  await assert.rejects(waitForPreflight({ PREFLIGHT_WAIT_SECONDS: '0' }, { ...deps, evaluate() { throw new PreflightError('never reported: required') } }), /Waited/)
})

test('new queued check with no timestamp cannot be hidden behind a completed older run', () => {
  assert.throws(() => evaluate({ checkRuns: [ok('required', { id: 1 }), ok('required', { id: 2, status: 'queued', started_at: null, completed_at: null })] }), /still running/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { started_at: 'invalid', completed_at: null })] }), /ambiguous/)
})
test('unrestricted same-name commit status and check must both pass', () => {
  const unrestricted = makeAuthority({ checks: [{ context: 'required', app_id: null }] })
  assert.throws(() => evaluate({ authority: unrestricted, statuses: [{ context: 'required', state: 'failure', id: 1 }] }), /failing/)
  assert.equal(evaluate({ authority: unrestricted, statuses: [{ context: 'required', state: 'success', id: 1 }] }).required, 1)
})
test('app-bound requirement: failing status without app field stays visible behind a passing check run', () => {
  // REST commit statuses carry `creator`, not `app`. A red status must never
  // hide behind a green same-name check run (BOTH-channels invariant).
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'failure', id: 1 }] }), /failing/)
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'error', id: 1 }] }), /failing/)
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'pending', id: 1 }] }), /still running|ambiguous/)
})
test('app-bound requirement: unverifiable success status cannot satisfy', () => {
  // Without `app` on the status object the producer is unknown; a success from
  // an unknown producer must not satisfy an app-bound requirement (fail-closed).
  assert.throws(() => evaluate({ checkRuns: [], statuses: [{ context: 'required', state: 'success', id: 1 }] }), /never reported/)
})
test('app-bound requirement: known-wrong-app status is excluded entirely', () => {
  // A status from a different app is ignored; the passing check run alone satisfies.
  assert.equal(evaluate({ statuses: [{ context: 'required', state: 'failure', id: 1, app: { id: 7 } }] }).required, 1)
  // But a status with NO app field (REST reality) that is red must still surface.
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'failure', id: 1 }] }), /failing/)
})
