import test from 'node:test'
import assert from 'node:assert/strict'
import { START_SLO_MS } from './start-reroute.mjs'
import { STAGED_LABEL, canaryLabelAllowed, dispatchSubref, lifecycleFromJob, main, qualifiedCanaryLanes, reviewerReplay, runCanary } from './start-reroute-canary.mjs'

const HEAD = 'b'.repeat(40)
function world({ stagedStartsAt = null } = {}) {
  let clock = Date.parse('2026-09-16T12:00:00.000Z')
  const runs = [], refs = new Map(), cancelled = [], dispatches = []
  const iso = (ms) => new Date(ms).toISOString()
  // Model git's file/directory rule: a ref cannot be created under, or over, an existing ref.
  const create = (ref, value) => { if (refs.has(ref)) return false; if ([...refs.keys()].some((k) => k.startsWith(`${ref}/`) || ref.startsWith(`${k}/`))) throw new Error('Reference update failed (HTTP 422)'); refs.set(ref, structuredClone(value)); return true }
  const io = {
    mainSha: () => HEAD,
    dispatch: (inputs) => { dispatches.push(inputs); runs.push({ id: runs.length + 1, inputs, created: clock, html_url: `run/${runs.length + 1}`, status: 'queued' }) },
    findRun: (attempt) => { const r = runs.find((x) => x.inputs.attempt_id === attempt); return r && { ...r, display_title: `start-reroute-canary ${attempt} on ${r.inputs.runner_label}` } },
    canaryJob: (id) => {
      const r = runs.find((x) => x.id === id), queued = r.created + 20000
      if (clock < queued || r.status === 'cancelled') return r.status === 'cancelled' ? { status: 'completed', conclusion: 'cancelled', created_at: iso(queued) } : null
      const starts = r.inputs.runner_label === STAGED_LABEL ? stagedStartsAt : queued + 5000
      if (starts === null || clock < starts) return { status: 'queued', created_at: iso(queued), started_at: iso(queued), runner_name: null }
      const done = starts + Number(r.inputs.hold_seconds) * 1000
      return clock >= done ? { status: 'completed', conclusion: 'success', created_at: iso(queued), started_at: iso(starts), runner_name: 'GitHub Actions 1' } : { status: 'in_progress', created_at: iso(queued), started_at: iso(starts), runner_name: 'GitHub Actions 1' }
    },
    cancel: (id) => { cancelled.push(id); runs.find((x) => x.id === id).status = 'cancelled' },
    durable: {
      withMutex: (fn) => fn(), readPair: (ref) => refs.get(ref) ?? null, compareCreatePair: (ref, _e, pair) => create(ref, pair),
      readLive: () => { throw new Error('bound by harness') },
      readDispatchAck: (ref) => refs.get(dispatchSubref(ref, 'dispatch-ack')) ?? null, readDispatchClaim: (ref) => refs.get(dispatchSubref(ref, 'dispatch-claim')) ?? null,
      compareCreateDispatchClaim: (ref, c) => create(dispatchSubref(ref, 'dispatch-claim'), c), compareCreateDispatchAck: (ref, a) => create(dispatchSubref(ref, 'dispatch-ack'), a),
      createAccepted: (ref, digest, result) => create(ref, { digest, result }), readAccepted: (ref) => refs.get(ref) ?? null,
    },
  }
  return { io, refs, cancelled, dispatches, runs, now: () => iso(clock), sleep: async (ms) => { clock += ms } }
}

test('a staged non-start is rerouted once after the SLO while the healthy run is kept and never cancelled', async () => {
  const w = world()
  const evidence = await runCanary({ io: w.io, now: w.now, sleep: w.sleep, healthyHold: 900 })
  assert.equal(evidence.verdict, 'PASS')
  assert.deepEqual(evidence.healthy.decisions.map((d) => d.action), ['wait', 'keep-active'].slice(evidence.healthy.decisions.length === 1 ? 1 : 0))
  assert.equal(evidence.healthy.conclusion, 'success')
  assert.deepEqual(evidence.staged.decisions.map((d) => d.action), ['wait', 'dispatch-new-run'])
  assert.ok(evidence.reroute.reserved_after_ms >= START_SLO_MS)
  assert.equal(w.dispatches.filter((d) => d.attempt_id.startsWith('replacement-')).length, 1)
  assert.equal(w.cancelled.length, 1); assert.equal(w.runs.find((r) => r.id === w.cancelled[0]).inputs.runner_label, STAGED_LABEL)
  assert.equal(evidence.accepted.accepted, true)
  assert.ok([...w.refs.keys()].some((k) => k.startsWith('refs/db-start-reroutes/runner/staged-')))
})

test('a staged run that starts is refused as a broken staging hook', async () => {
  const w = world({ stagedStartsAt: Date.parse('2026-09-16T12:01:00.000Z') })
  await assert.rejects(runCanary({ io: w.io, now: w.now, sleep: w.sleep }), /not isolated/)
  assert.equal(w.cancelled.length, 0)
})

test('the staging hook admits only registered lanes and the staged label', async () => {
  assert.equal(canaryLabelAllowed('ubuntu-latest'), true)
  assert.equal(canaryLabelAllowed(STAGED_LABEL), true)
  for (const label of ['self-hosted', 'windows-latest', 'ubuntu-latest-16-cores', '', undefined]) assert.equal(canaryLabelAllowed(label), false)
  const quiet = console.error; console.error = () => {}
  try {
    assert.equal(await main(['--check-label', 'self-hosted']), 1)
    assert.equal(await main(['--check-label', STAGED_LABEL]), 0)
  } finally { console.error = quiet }
})

test('lanes, lifecycle and reviewer replay', () => {
  assert.ok(qualifiedCanaryLanes().every((l) => l.qualified && l.assertions[0] === 'start-reroute-canary'))
  assert.deepEqual(lifecycleFromJob('a', { status: 'queued', started_at: 'x', runner_name: null }), [])
  assert.equal(lifecycleFromJob('a', { status: 'in_progress', started_at: 'x', runner_name: 'r' })[0].type, 'runner_started')
  assert.deepEqual(reviewerReplay('2026-09-16T12:00:00.000Z'), { staged_non_start: 'governed-return-and-reroute', healthy_started_review: 'keep-active' })
})

test('dispatch claim and ack refs are siblings of the reservation ref, never children of it', () => {
  const ref = 'refs/db-start-reroutes/runner/staged-abc'
  for (const kind of ['dispatch-claim', 'dispatch-ack']) assert.ok(!dispatchSubref(ref, kind).startsWith(`${ref}/`))
})
