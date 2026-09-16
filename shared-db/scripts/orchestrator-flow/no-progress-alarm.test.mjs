import test from 'node:test'
import assert from 'node:assert/strict'
import { FALLBACK_LABEL, FALLBACK_TITLE, alarmKey, findOrCreateFallback, latestSnapshotFromComments, main, postedKeys, runAlarm, runResume } from './no-progress-alarm.mjs'
import { gatherLiveInput } from '../orchestrator-snapshot.mjs'

const T0 = '2026-09-16T08:00:00.000Z'
function input({ events = [{ event_id: 'e1', event_type: 'dispatched', work_issue: 11, timestamp: T0 }] } = {}) {
  return {
    marker: { issue: 900, status: 'active', route_id: 'route-1' },
    claims: [{ issue: 10, title: 'CLAIM: #11 work', work_issues: [11] }],
    pull_requests: [], reviewer_leases: [], stage_locks: [], eligible_queue: [],
    outcome_events: events,
  }
}
function io(state = input()) {
  const comments = new Map(), posts = []
  return {
    posts, comments,
    gatherLiveInput: () => ({ input: state, sessionStarted: null }),
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

test('with no orchestrator marker the alarm still evaluates stalls and posts to the stable fallback issue', () => {
  let asked = 0
  const fake = { ...io({ ...input(), marker: null }), fallbackIssue: () => { asked += 1; return 4242 } }
  assert.equal(runAlarm({ repo: 'r', now: '2026-09-16T09:59:00.000Z' }, fake).status, 'quiet')
  assert.equal(asked, 0, 'a quiet run touches no fallback issue')
  const fired = runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z' }, fake)
  assert.equal(fired.status, 'posted'); assert.equal(fired.target, 4242); assert.equal(fired.marker, 'none'); assert.deepEqual(fired.stalled, [11]); assert.equal(fired.comment_url, 'u1')
  assert.match(fake.posts[0].body, /#11 has been `dispatched` for 121 minutes/)
  assert.match(fake.posts[0].body, /No orchestrator marker resolved/)
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
  assert.throws(() => findOrCreateFallback([], () => ({})), /could not be created/)
  const cannotPost = { ...io({ ...input(), marker: null }), fallbackIssue: () => { throw new Error('gh api POST failed') } }
  const errors = []
  assert.equal(main(['--alarm', '--now', '2026-09-16T10:01:00.000Z'], { io: cannotPost, stdout: () => {}, stderr: (l) => errors.push(l) }), 1)
  assert.match(errors[0], /POST failed/)
  assert.throws(() => runAlarm({ repo: 'r', now: '2026-09-16T10:01:00.000Z' }, { ...io(), postComment: () => ({}) }), /not confirmed/)
})

test('only the alarm reads live state without a marker; other read failures still fail the run', () => {
  const base = { openIssues: () => [], openPullRequests: () => [], matchingRefs: () => [], issueComments: () => [] }
  const exit3 = { ...base, resolveMarker: () => { throw new Error('orchestrator marker did not resolve (exit 3)') } }
  assert.equal(gatherLiveInput('r', exit3, { allowNoMarker: true }).input.marker, null)
  assert.throws(() => gatherLiveInput('r', exit3), /exit 3/)
  assert.equal(gatherLiveInput('r', { ...base, resolveMarker: () => ({ marker: 5, routing: {} }) }, { allowNoMarker: true }).input.marker, null)
  assert.throws(() => gatherLiveInput('r', { ...base, resolveMarker: () => { throw new Error('orchestrator marker did not resolve (exit 2)') } }, { allowNoMarker: true }), /exit 2/)
  const errors = []
  assert.equal(main(['--alarm'], { io: { ...io(), gatherLiveInput: () => { throw new Error('gh api failed') } }, stdout: () => {}, stderr: (l) => errors.push(l) }), 1)
  assert.match(errors[0], /gh api failed/)
})

test('resume names the missing orchestrator marker instead of a shape error', () => {
  const fake = io()
  runAlarm({ repo: 'r', now: '2026-09-16T10:30:00.000Z', postIssue: 5 }, fake)
  const gone = { ...fake, gatherLiveInput: () => ({ input: { ...input(), marker: null }, sessionStarted: null }) }
  assert.throws(() => runResume({ repo: 'r', issue: 5, now: '2026-09-16T10:31:00.000Z' }, gone), /no open routable orchestrator marker/)
})
