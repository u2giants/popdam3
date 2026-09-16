import test from 'node:test'
import assert from 'node:assert/strict'
import { alarmKey, latestSnapshotFromComments, main, postedKeys, runAlarm, runResume } from './no-progress-alarm.mjs'

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

test('no open orchestrator marker reports no-orchestrator; other read failures still throw', () => {
  const fail = (message) => ({ ...io(), gatherLiveInput: () => { throw new Error(message) } })
  assert.equal(runAlarm({ repo: 'r', now: T0 }, fail('orchestrator marker did not resolve (exit 3)')).status, 'no-orchestrator')
  assert.equal(runAlarm({ repo: 'r', now: T0 }, fail('no open routable orchestrator marker')).status, 'no-orchestrator')
  assert.throws(() => runAlarm({ repo: 'r', now: T0 }, fail('orchestrator marker did not resolve (exit 2)')), /exit 2/)
})
