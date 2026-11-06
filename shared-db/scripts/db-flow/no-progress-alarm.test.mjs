import test from 'node:test'
import assert from 'node:assert/strict'
import { FALLBACK_LABEL, FALLBACK_TITLE, LEGACY_FALLBACK_TITLE, alarmKey, findOrCreateFallback, latestSnapshotFromComments, main, parsePromotionTrace, postedKeys, promotionStalls, runAlarm, runResume } from './no-progress-alarm.mjs'
import { gatherLiveInput } from '../flow-snapshot.mjs'

const T0 = '2026-09-16T08:00:00.000Z'
function input({ events = [{ event_id: 'e1', event_type: 'dispatched', work_issue: 11, timestamp: T0 }] } = {}) {
  return {
    marker: { issue: 900, status: 'active', route_id: 'route-1' },
    claims: [{ issue: 10, title: 'CLAIM: #11 work', work_issues: [11] }],
    pull_requests: [], reviewer_leases: [], stage_locks: [], eligible_queue: [],
    outcome_events: events,
  }
}
function io(state = input(), promotion = null) {
  const comments = new Map(), posts = []
  return {
    posts, comments,
    gatherLiveInput: () => ({ input: state, sessionStarted: null }),
    // Quiet by default: no holds, no exhausted changes, an apply within the
    // hour, a green hygiene report and no freeze. Canary tests override.
    gatherPromotionInput: () => promotion ?? {
      trace: { held: [], exhausted: [], action: 'idle' }, last_apply_success_at: '2026-09-16T11:59:00.000Z',
      hygiene_run: { conclusion: 'success', url: 'u/hygiene' }, freeze: null, error: null,
    },
    issueComments: (_repo, issue) => comments.get(issue) ?? [],
    postComment: (_repo, issue, body) => {
      posts.push({ issue, body })
      comments.set(issue, [...(comments.get(issue) ?? []), { body, author_association: 'NONE', user: { login: 'github-actions[bot]' }, html_url: `u${posts.length}` }])
      return { html_url: `u${posts.length}` }
    },
  }
}

test('an outcome without a transition for over 120 minutes fires exactly one alarm naming blocker and unblock action', () => {
  const fake = io()
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T09:59:00.000Z' }, fake).status, 'quiet')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z' }, fake)
  assert.equal(fired.status, 'posted'); assert.equal(fired.target, 900); assert.deepEqual(fired.stalled, [11])
  assert.match(fake.posts[0].body, /#11 has been `dispatched` for 121 minutes/)
  assert.match(fake.posts[0].body, /Unblock: check the worker session/)
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T10:31:00.000Z' }, fake).status, 'already-posted')
  assert.equal(fake.posts.length, 1)
})

test('issue 3148 a ready request that never entered the ledger is named in the alarm with its unblock action', () => {
  const fake = io(input({ events: [] }))
  fake.gatherLiveInput = () => ({ input: input({ events: [] }), sessionStarted: null, unentered: [{ work_issue: 3036, created_at: '2026-09-16T11:51:07Z' }] })
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T12:21:00.000Z' }, fake).status, 'quiet')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:23:00.000Z' }, fake)
  assert.equal(fired.status, 'posted'); assert.deepEqual(fired.stalled, [3036])
  assert.match(fake.posts[0].body, /#3036 has been `requested` for 31 minutes/)
  assert.match(fake.posts[0].body, /Unblock: claim owner admits it/)
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T12:53:00.000Z' }, fake).status, 'already-posted')
  assert.equal(fake.posts.length, 1)
})

test('issue 3158 a request that entered the ledger but has no owning claim still alarms', () => {
  const fake = io(input({ events: [] }))
  const unclaimedEvents = [{ event_id: 'u1', event_type: 'entered', work_issue: 3160, timestamp: '2026-09-16T12:00:00.000Z' }]
  fake.gatherLiveInput = () => ({ input: input({ events: [] }), sessionStarted: null, unentered: [], unclaimedEvents })
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T12:30:00.000Z' }, fake).status, 'quiet')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:31:00.000Z' }, fake)
  assert.equal(fired.status, 'posted'); assert.deepEqual(fired.stalled, [3160])
  assert.match(fake.posts[0].body, /#3160 has been `entered` for 31 minutes/)
  assert.match(fake.posts[0].body, /Unblock: claim owner classifies/)
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T13:01:00.000Z' }, fake).status, 'already-posted')
})

test('an untrusted comment carrying the alarm key cannot suppress the alarm', () => {
  const fake = io()
  const planted = runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z', dryRun: true }, fake)
  fake.comments.set(900, [{ body: `<!-- db-no-progress-alarm alarm_key=${planted.alarm_key} -->`, author_association: 'NONE', user: { login: 'stranger' } }])
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z' }, fake).status, 'posted')
  fake.comments.set(901, [{ body: `<!-- db-no-progress-alarm alarm_key=${planted.alarm_key} -->`, author_association: 'MEMBER' }])
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z', postIssue: 901 }, fake).status, 'already-posted')
})

test('zero closures alone fires only once outcomes have existed for the whole four-hour window', () => {
  const events = [
    { event_id: 'e1', event_type: 'entered', work_issue: 11, timestamp: T0 },
    { event_id: 'e2', event_type: 'classified', work_issue: 11, timestamp: '2026-09-16T11:50:00.000Z' },
  ]
  const fake = io(input({ events }))
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T11:55:00.000Z' }, fake).status, 'quiet')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:05:00.000Z' }, fake)
  assert.equal(fired.status, 'posted'); assert.deepEqual(fired.stalled, []); assert.equal(fired.zero_closures_4h, true)
  assert.match(fake.posts[0].body, /Nothing reached live_verified in the last 4 hours/)
})

test('a staged alarm goes only to the named issue and is labelled', () => {
  const fake = io()
  const result = runAlarm({ repo: 'r', now: '2026-09-16T11:00:00.000Z', postIssue: 3027, stagedLabel: 'STAGED CANARY' }, fake)
  assert.equal(result.target, 3027); assert.match(fake.posts[0].body, /^<!-- db-no-progress-alarm alarm_key=[0-9a-f]{64} .* staged=true -->\n## STAGED CANARY: No-progress alarm/)
  assert.equal(postedKeys(fake.comments.get(3027)).size, 1)
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T11:00:00.000Z', postIssue: 3027, dryRun: true }, io()).status, 'would-post')
})

test('a successor resumes from the posted sealed snapshot and refuses a tampered one', () => {
  const fake = io()
  runAlarm({ repo: 'r', now: '2026-09-16T10:30:00.000Z', postIssue: 5 }, fake)
  const resumed = runResume({ repo: 'r', issue: 5, now: '2026-09-16T10:31:00.000Z' }, fake)
  assert.equal(resumed.seal, 'VALID'); assert.equal(resumed.currency, 'CURRENT')
  assert.deepEqual(resumed.claims_taken_over, [10]); assert.deepEqual(resumed.stalled_at_snapshot, [11]); assert.equal(resumed.stalled_now[0].work_issue, 11)
  const drifted = runResume({ repo: 'r', issue: 5, now: '2026-09-16T10:31:00.000Z' }, { ...fake, gatherLiveInput: () => ({ input: input({ events: [] }) }) })
  assert.equal(drifted.currency, 'DRIFTED')
  const [comment] = fake.comments.get(5)
  const tampered = { ...comment, body: comment.body.replace('"issue":10', '"issue":12') }
  assert.throws(() => runResume({ repo: 'r', issue: 5, now: '2026-09-16T10:31:00.000Z' }, { ...fake, issueComments: () => [tampered] }), /seal is invalid/)
  assert.equal(latestSnapshotFromComments([{ ...comment, author_association: 'NONE', user: { login: 'stranger' } }]), null)
})

test('alarm key ignores minute counters and the CLI reports failures with exit 1', () => {
  const base = { stalled_outcomes: [{ work_issue: 2, minutes_since_transition: 130 }], zero_closures_4h: true }
  assert.equal(alarmKey(base), alarmKey({ ...base, stalled_outcomes: [{ work_issue: 2, minutes_since_transition: 500 }] }))
  const errors = []
  assert.equal(main(['--resume'], { io: io(), stdout: () => {}, stderr: (l) => errors.push(l) }), 1)
  assert.match(errors[0], /requires --issue/)
})

test('with no claim-first session identity the alarm still evaluates stalls and posts to the stable fallback issue', () => {
  let asked = 0
  const fake = { ...io({ ...input(), marker: null }), fallbackIssue: () => { asked += 1; return 4242 } }
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T09:59:00.000Z' }, fake).status, 'quiet')
  assert.equal(asked, 0, 'a quiet run touches no fallback issue')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z' }, fake)
  assert.equal(fired.status, 'posted'); assert.equal(fired.target, 4242); assert.equal(fired.marker, 'none'); assert.deepEqual(fired.stalled, [11]); assert.equal(fired.comment_url, 'u1')
  assert.match(fake.posts[0].body, /#11 has been `dispatched` for 121 minutes/)
  assert.match(fake.posts[0].body, /No claim-first session identity resolved/)
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T10:31:00.000Z' }, fake).status, 'already-posted')
  assert.equal(fake.posts.length, 1)
})

test('the fallback issue is reused, created only when missing, and a failed create or unconfirmed post fails the run', () => {
  const labels = [{ name: FALLBACK_LABEL }]
  // The workflow token creates the issue, so production reuse rests on the github-actions[bot] shape.
  const bot = { author_association: 'NONE', user: { login: 'github-actions[bot]' }, labels }
  const existing = [{ number: 9, title: FALLBACK_TITLE, author_association: 'OWNER', labels }, { number: 7, title: FALLBACK_TITLE, ...bot }, { number: 3, title: FALLBACK_TITLE, author_association: 'NONE', user: { login: 'x' }, labels }, { number: 2, title: FALLBACK_TITLE, author_association: 'OWNER' }]
  assert.equal(findOrCreateFallback(existing, () => assert.fail('must not create')), 7)
  assert.equal(findOrCreateFallback([], () => ({ number: 50 })), 50)
  // #4348: a fallback still open under the pre-rename title is reused, not forked.
  assert.equal(findOrCreateFallback([{ number: 4, title: LEGACY_FALLBACK_TITLE, ...bot }], () => assert.fail('must not fork the legacy fallback')), 4)
  assert.equal(findOrCreateFallback([{ number: 4, title: 'Some other title', ...bot }], () => ({ number: 51 })), 51)
  assert.throws(() => findOrCreateFallback([], () => ({})), /could not be created/)
  const cannotPost = { ...io({ ...input(), marker: null }), fallbackIssue: () => { throw new Error('gh api POST failed') } }
  const errors = []
  assert.equal(main(['--alarm', '--now', '2026-09-16T10:01:00.000Z'], { io: cannotPost, stdout: () => {}, stderr: (l) => errors.push(l) }), 1)
  assert.match(errors[0], /POST failed/)
  assert.throws(() => runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z' }, { ...io(), postComment: () => ({}) }), /not confirmed/)
})

test('only the alarm reads live state without a marker; other read failures still fail the run', () => {
  const base = { openIssues: () => [], openPullRequests: () => [], matchingRefs: () => [], issueComments: () => [] }
  const exit3 = { ...base, resolveMarker: () => { throw new Error('claim-first session identity did not resolve (exit 3)') } }
  assert.equal(gatherLiveInput('r', exit3, { allowNoMarker: true }).input.marker, null)
  assert.throws(() => gatherLiveInput('r', exit3), /exit 3/)
  assert.equal(gatherLiveInput('r', { ...base, resolveMarker: () => ({ marker: 5, routing: {} }) }, { allowNoMarker: true }).input.marker, null)
  assert.throws(() => gatherLiveInput('r', { ...base, resolveMarker: () => { throw new Error('claim-first session identity did not resolve (exit 2)') } }, { allowNoMarker: true }), /exit 2/)
  const errors = []
  assert.equal(main(['--alarm'], { io: { ...io(), gatherLiveInput: () => { throw new Error('gh api failed') } }, stdout: () => {}, stderr: (l) => errors.push(l) }), 1)
  assert.match(errors[0], /gh api failed/)
})

test('resume names the missing claim-first session identity instead of a shape error', () => {
  const fake = io()
  runAlarm({ repo: 'r', now: '2026-09-16T10:30:00.000Z', postIssue: 5 }, fake)
  const gone = { ...fake, gatherLiveInput: () => ({ input: { ...input(), marker: null }, sessionStarted: null }) }
  assert.throws(() => runResume({ repo: 'r', issue: 5, now: '2026-09-16T10:31:00.000Z' }, gone), /no open routable claim-first session identity/)
})

// --- Promotion-lane stalls (plan_go-live-lane-prevention.md §9 3.2/3.3, #5782) ---
// One staged canary per new class; each fires exactly once and the comment names
// the class's own evidence. The claim-first input is empty of stalls throughout,
// so every assertion below is about the promotion lane alone.

const QUIET_APPLY = '2026-09-16T11:59:00.000Z'
const promotionInput = (overrides = {}) => ({
  trace: { held: [], exhausted: [], action: 'idle', ...(overrides.trace ?? {}) },
  last_apply_success_at: QUIET_APPLY, hygiene_run: { conclusion: 'success', url: 'u/hygiene' },
  freeze: null, error: null, ...overrides,
})

test('canary: a PR held by a review finding over 60 minutes alarms once and names the finding', () => {
  const fake = io(input({ events: [] }), promotionInput({
    trace: { held: [{ pr: 5630, minutes: 1036, findings: '#5631' }], exhausted: [], action: 'idle' },
    last_apply_success_at: QUIET_APPLY,
  }))
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:00:00.000Z', postIssue: 3027 }, fake)
  assert.equal(fired.status, 'posted')
  assert.deepEqual(fired.promotion, ['promotion_held:PR #5630'])
  assert.match(fake.posts[0].body, /PR #5630 — `promotion_held` for 1036 minutes \(held 1036 min by #5631\)/)
  assert.match(fake.posts[0].body, /resolve or dismiss the named review finding/)
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T12:31:00.000Z', postIssue: 3027 }, fake).status, 'already-posted')
  assert.equal(fake.posts.length, 1)
})

test('canary: a change out of automatic attempts alarms once and surfaces the ENGINEER text', () => {
  const fake = io(input({ events: [] }), promotionInput({
    trace: { held: [], exhausted: [{ pr: 5686, note: 'ENGINEER ACTION REQUIRED: automatic attempts exhausted: PR #5686 (versions 20261105142616) failed 3 automatic attempts at this main commit; later PRs still promote' }], action: 'idle' },
    last_apply_success_at: QUIET_APPLY,
  }))
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:00:00.000Z', postIssue: 3027 }, fake)
  assert.equal(fired.status, 'posted')
  assert.deepEqual(fired.promotion, ['promotion_exhausted:PR #5686'])
  assert.match(fake.posts[0].body, /PR #5686 — `promotion_exhausted` \(ENGINEER ACTION REQUIRED: automatic attempts exhausted: PR #5686/)
  assert.match(fake.posts[0].body, /ENGINEER ACTION REQUIRED/)
})

test('canary: a starved lane (candidates exist, no successful apply in 60 minutes) alarms', () => {
  const fake = io(input({ events: [] }), promotionInput({
    trace: { held: [{ pr: 5619, minutes: 45, findings: '#5620' }], exhausted: [], action: 'idle' },
    last_apply_success_at: '2026-09-16T10:50:00.000Z',
  }))
  const quiet = runAlarm({ repo: 'r', now: '2026-09-16T11:49:00.000Z', postIssue: 3027 }, fake)
  assert.equal(quiet.status, 'quiet')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:00:00.000Z', postIssue: 3027 }, fake)
  assert.equal(fired.status, 'posted')
  assert.deepEqual(fired.promotion, ['promotion_starved:the promotion lane'])
  assert.match(fake.posts[0].body, /no successful apply in 60 minutes/)
})

test('canary: a Queue Hygiene Report run that failed is named as the instrument going down', () => {
  const fake = io(input({ events: [] }), promotionInput({
    hygiene_run: { conclusion: 'failure', url: 'https://github.com/o/r/actions/runs/42027627758' },
  }))
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:00:00.000Z', postIssue: 3027 }, fake)
  assert.equal(fired.status, 'posted')
  assert.deepEqual(fired.promotion, ['instrument_down:the Queue Hygiene Report'])
  assert.match(fake.posts[0].body, /the instrument could not run: https:\/\/github\.com\/o\/r\/actions\/runs\/42027627758/)
  assert.match(fake.posts[0].body, /silence is never a clean queue/)
})

test('canary: a promotion freeze live over 15 minutes surfaces the merges-are-paused complaint', () => {
  const fake = io(input({ events: [] }), promotionInput({
    freeze: {
      pr: 5619, issue: 5608, owner: 'automatic-production-qualification',
      acquired_at: '2026-09-16T11:40:00.000Z', expires_at: '2026-09-16T12:25:00.000Z',
      complaint: 'merges are paused for a production run; promotion merge freeze held by "automatic-production-qualification" for PR #5619 (issue #5608) until 2026-09-16T12:25:00.000Z',
    },
    last_apply_success_at: '2026-09-16T11:30:00.000Z',
  }))
  const quiet = runAlarm({ repo: 'r', now: '2026-09-16T11:54:00.000Z', postIssue: 3027 }, fake)
  assert.equal(quiet.status, 'quiet')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T11:56:00.000Z', postIssue: 3027 }, fake)
  assert.equal(fired.status, 'posted')
  assert.deepEqual(fired.promotion, ['freeze_wedged:the promotion merge freeze for PR #5619'])
  assert.match(fake.posts[0].body, /merges are paused for a production run; promotion merge freeze held by "automatic-production-qualification" for PR #5619 \(issue #5608\) until /)
})

test('canary: a failing report and a staged freeze are named together in one comment', () => {
  // The plan §9 3.3 verification gate: "the alarm comment names both".
  const fake = io(input({ events: [] }), promotionInput({
    hygiene_run: { conclusion: 'failure', url: 'https://github.com/o/r/actions/runs/42027627758' },
    freeze: {
      pr: 5619, issue: 5608, owner: 'automatic-production-qualification',
      acquired_at: '2026-09-16T11:00:00.000Z', expires_at: '2026-09-16T11:45:00.000Z',
      complaint: 'merges are paused for a production run; promotion merge freeze held by "automatic-production-qualification" for PR #5619 (issue #5608) until 2026-09-16T11:45:00.000Z',
    },
  }))
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T11:20:00.000Z', postIssue: 3027, stagedLabel: 'STAGED CANARY' }, fake)
  assert.equal(fired.status, 'posted')
  assert.match(fake.posts[0].body, /^<!-- db-no-progress-alarm alarm_key=[0-9a-f]{64} .* staged=true -->\n## STAGED CANARY: No-progress alarm/)
  assert.match(fake.posts[0].body, /the instrument could not run: https:\/\/github\.com\/o\/r\/actions\/runs\/42027627758/)
  assert.match(fake.posts[0].body, /merges are paused for a production run/)
})

test('the promotion selector trace parser reads holds, exhaustion and the terminal action', () => {
  const trace = parsePromotionTrace([
    'held: PR #5630 by #5631; later PRs still promote',
    '::error title=Production release held over 30 minutes::PR #5630 (versions 20261105042549) held 1036 min by #5631',
    'exhausted: PR #5686 out of automatic attempts; later PRs still promote',
    '::error title=ENGINEER ACTION REQUIRED: automatic attempts exhausted::PR #5686 (versions 20261105142616) failed 3 automatic attempts at this main commit; later PRs still promote',
    'exhausted: PR #7 out of refunds (cap 3 per change); later PRs still promote',
    'dispatch: PR #5619 versions 20261105044255 not yet in production',
  ].join('\n'))
  assert.deepEqual(trace.held, [{ pr: 5630, minutes: 1036, findings: '#5631' }])
  assert.deepEqual(trace.exhausted, [
    { pr: 5686, note: 'ENGINEER ACTION REQUIRED: automatic attempts exhausted: PR #5686 (versions 20261105142616) failed 3 automatic attempts at this main commit; later PRs still promote' },
    { pr: 7, note: 'out of refunds (cap 3 per change)' },
  ])
  assert.equal(trace.action, 'dispatch')
  assert.deepEqual(parsePromotionTrace('idle: every merged migration PR since activation is in production\n').held, [])
})

test('an unreadable promotion evaluator becomes a loud instrument row, never silence', () => {
  const fake = io(input({ events: [] }), promotionInput({ error: 'the promotion selector --dry-run trace could not be read (gh api failed)' }))
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T12:00:00.000Z', postIssue: 3027 }, fake)
  assert.equal(fired.status, 'posted')
  assert.deepEqual(fired.promotion, ['instrument_down:the promotion lane evaluator'])
  assert.match(fake.posts[0].body, /the promotion selector --dry-run trace could not be read/)
})

test('a quiet promotion lane changes nothing: no comment and legacy alarms keep their key', () => {
  const legacy = { stalled_outcomes: [{ work_issue: 11, state: 'dispatched' }], zero_closures_4h: false }
  const withPromotion = { stalled_outcomes: [...legacy.stalled_outcomes, { lane: 'promotion', state: 'promotion_held', work_issue: 5630 }], zero_closures_4h: false }
  // Legacy-only sets key exactly as before the promotion classes existed: only
  // the work-issue numbers and the zero-closure flag participate.
  assert.equal(alarmKey(legacy), alarmKey({ stalled_outcomes: [{ work_issue: 11, state: 'yielded' }], zero_closures_4h: false }))
  // A promotion row is its own key component: a new stall class fires again.
  assert.notEqual(alarmKey(legacy), alarmKey(withPromotion))
  const fake = io(input({ events: [] }))
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T12:00:00.000Z', postIssue: 3027 }, fake).status, 'quiet')
  assert.equal(fake.posts.length, 0)
  assert.deepEqual(promotionStalls(promotionInput(), '2026-09-16T12:00:00.000Z'), [])
})
