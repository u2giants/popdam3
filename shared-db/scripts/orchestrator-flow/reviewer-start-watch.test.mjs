import test from 'node:test'
import assert from 'node:assert/strict'
import { RESUME_ATTEMPT_LIMIT, leaseStartDecision, managerArgs, mootable, pendingFromRefNames, rowFromRecord, runStep, watchOnce } from './reviewer-start-watch.mjs'

const head = 'b'.repeat(40)
const drawn = '2026-09-16T12:00:00.000Z'
const late = '2026-09-16T12:11:00.000Z'
const row = (extra = {}) => ({ leaseRef: 'refs/db-review-active-v2/ai-kimi/x', reviewer: 'kimi', issue: 10, pr: 20, headSha: head, sequence: 3, slot: 1, heldSinceIso: drawn, stale: false, started: false, lastActivityIso: 'none', verdictPresent: false, error: null, ...extra })

function memoryDurable() {
  const refs = new Map()
  const create = (ref, value) => { if (refs.has(ref)) return false; refs.set(ref, JSON.parse(JSON.stringify(value))); return true }
  return {
    refs,
    withMutex: (fn) => fn(),
    readPair: (ref) => refs.get(ref) ?? null,
    compareCreatePair: (ref, _e, pair) => create(ref, pair),
    readDispatchAck: (ref) => refs.get(`${ref}--dispatch-ack`) ?? null,
    readDispatchClaim: (ref) => refs.get(`${ref}--dispatch-claim`) ?? null,
    compareCreateDispatchClaim: (ref, claim) => create(`${ref}--dispatch-claim`, claim),
    compareCreateDispatchAck: (ref, ack) => create(`${ref}--dispatch-ack`, ack),
    createAccepted: (ref, digest, result) => create(ref, { digest, result }),
    readAccepted: () => null,
  }
}

test('a lease inside the 10-minute start SLO waits', () => {
  assert.equal(leaseStartDecision(row({ started: null, lastActivityIso: null, verdictPresent: null }), '2026-09-16T12:09:59.000Z').decision.action, 'wait')
})

test('an overdue lease with no start marker and no activity is rerouted', () => {
  assert.equal(leaseStartDecision(row(), late).decision.action, 'governed-return-and-reroute')
})

test('a started review is never rerouted, however old', () => {
  assert.equal(leaseStartDecision(row({ started: true }), '2026-09-16T15:00:00.000Z').decision.action, 'keep-active')
})

test('CI or another reviewer on the same PR is not this reviewer starting; only its own marker is', () => {
  // The manager reports own-marker-only rows; any activity value never marks a start.
  for (const lastActivityIso of ['not-counted-own-start-marker-only', '2026-09-16T12:05:00.000Z']) {
    assert.equal(leaseStartDecision(row({ lastActivityIso }), late).decision.action, 'governed-return-and-reroute', lastActivityIso)
  }
  assert.equal(leaseStartDecision(row({ started: true, lastActivityIso: 'not-counted-own-start-marker-only' }), late).decision.action, 'keep-active')
})

test('unreadable, stale, or verdict-bearing leases are left alone', () => {
  for (const extra of [{ error: 'boom', started: null }, { started: null }, { lastActivityIso: null }, { verdictPresent: null }, { stale: true }, { verdictPresent: true }, { heldSinceIso: null }]) {
    assert.equal(leaseStartDecision(row(extra), late).decision.action, 'skip', JSON.stringify(extra))
  }
})

test('activity before the draw does not count as a start', () => {
  assert.equal(leaseStartDecision(row({ lastActivityIso: '2026-09-16T11:00:00.000Z' }), late).decision.action, 'governed-return-and-reroute')
})

test('watchOnce reserves once, dispatches probe/reclaim/replace once, and never touches healthy leases', () => {
  const durable = memoryDurable(), calls = []
  const leases = [row(), row({ leaseRef: 'refs/db-review-active-v2/ai-qwen/y', reviewer: 'qwen', pr: 21, started: true })]
  const io = { now: () => late, readLeases: () => leases, manager: (args) => { calls.push(args); return { ok: args[0] } }, durable }
  const dry = watchOnce(io, { apply: false })
  assert.deepEqual(dry.map((r) => r.action), ['governed-return-and-reroute', 'keep-active'])
  assert.equal(calls.length, 0)
  const out = watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })
  assert.equal(out[0].reroute.ref, 'refs/db-start-reroutes/reviewer/review-10-20-seq3-slot1')
  assert.equal(out[0].reroute.ack.dispatch_status, 'created')
  assert.deepEqual(calls.map((a) => a[0]), ['--probe-silent-reviewer', '--reclaim-silent-reviewer', '--replace-failed-reviewer'])
  assert.ok(calls.every((a) => a.includes('--issue') && !a.includes('21')))
  assert.equal(out[1].reroute, undefined)
  // A second pass is idempotent: the durable ack short-circuits dispatch.
  const again = watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })
  assert.equal(again[0].reroute.status, 'existing')
  assert.equal(again[0].reroute.ack.status, 'existing')
  assert.equal(calls.length, 3)
})

test('a review that starts before the reservation fence refuses the reroute', () => {
  const durable = memoryDurable(), calls = []
  let reads = 0
  const io = { now: () => late, readLeases: () => [row(reads++ ? { started: true } : {})], manager: (args) => { calls.push(args); return {} }, durable }
  assert.match(watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })[0].error, /started or changed/)
  assert.equal(calls.length, 0)
  assert.equal(durable.refs.size, 0)
})

test('manager arguments use the governed unstarted silence path and admission', () => {
  assert.deepEqual(managerArgs('probe', row()).slice(0, 2), ['--probe-silent-reviewer', '--unstarted'])
  assert.ok(managerArgs('reclaim', row()).includes('--confirm-no-artifact'))
  const replace = managerArgs('replace', row())
  assert.equal(replace[replace.indexOf('--failure-code') + 1], 'silent_worker_observed')
  assert.equal(replace[replace.indexOf('--admit-issue') + 1], '10')
  assert.equal(replace[replace.indexOf('--review-slot') + 1], '1')
})

test('a dispatch interrupted after reclaim resumes from the durable record, not from the vanished lease', () => {
  const durable = memoryDurable(), calls = []
  let fail = true, leases = [row()]
  const io = {
    now: () => late,
    readLeases: () => leases,
    manager: (args) => {
      calls.push(args[0])
      if (args[0] === '--replace-failed-reviewer' && fail) { fail = false; leases = []; throw new Error('transient transport failure') }
      return { ok: args[0] }
    },
    durable,
    pendingReroutes: () => pendingFromRefNames([...durable.refs.keys()]),
  }
  assert.match(watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })[0].error, /transient transport failure/)
  // A replace-stage failure is never mooted: resume is the only way to finish it.
  assert.equal(durable.refs.has('refs/db-start-reroutes/reviewer/review-10-20-seq3-slot1--moot'), false)
  assert.deepEqual(calls, ['--probe-silent-reviewer', '--reclaim-silent-reviewer', '--replace-failed-reviewer'])
  // The retried probe and reclaim refuse as already done; only the replacement runs again.
  io.manager = (args) => {
    calls.push(args[0])
    if (args[0] === '--probe-silent-reviewer') throw new Error('REFUSED: reviewer silence probe already exists and is immutable')
    if (args[0] === '--reclaim-silent-reviewer') throw new Error('REFUSED: silent reviewer lease was already reclaimed with immutable evidence')
    assert.equal(args[args.indexOf('--failed-sequence') + 1], '3')
    assert.equal(args[args.indexOf('--head-sha') + 1], head)
    return { sequence: 4 }
  }
  const out = watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })
  assert.equal(out.length, 1)
  assert.equal(out[0].resumed, 'refs/db-start-reroutes/reviewer/review-10-20-seq3-slot1')
  assert.equal(out[0].steps.probe.status, 'already-done')
  assert.equal(out[0].steps.reclaim.status, 'already-done')
  assert.deepEqual(out[0].steps.replace, { status: 'done', result: { sequence: 4 } })
  assert.equal(out[0].ack.status, 'acknowledged')
  assert.deepEqual(watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' }), [])
})

test('only the exact already-done refusals are tolerated, and records must name an exact lease', () => {
  assert.throws(() => runStep({ manager: () => { throw new Error('silence probe requires a live lease at the exact open PR head') } }, 'probe', row()), /live lease/)
  assert.throws(() => runStep({ manager: () => { throw new Error('reviewer silence probe already exists and is immutable') } }, 'replace', row()), /already exists/)
  assert.deepEqual(rowFromRecord({ original_id: 'review-10-20-seq3-slot2', head_sha: head }), { issue: 10, pr: 20, sequence: 3, slot: 2, headSha: head })
  assert.throws(() => rowFromRecord({ original_id: 'runner-x', head_sha: head }), /exact lease/)
})

test('a probe or reclaim refusal moots the reservation, isolates the failure, and never wedges later passes', () => {
  const durable = memoryDurable(), calls = []
  let leases = [row(), row({ leaseRef: 'refs/db-review-active-v2/ai-qwen/y', reviewer: 'qwen', pr: 21, sequence: 5 })]
  const io = {
    now: () => late,
    readLeases: () => leases,
    manager: (args) => {
      calls.push([args[0], args[args.indexOf('--pr') + 1]])
      if (args[0] === '--reclaim-silent-reviewer' && args.includes('20')) { leases = leases.map((r) => r.pr === 20 ? { ...r, started: true } : r); throw new Error('unstarted reclaim refused because the review has a durable start marker') }
      return { ok: true }
    },
    durable,
    pendingReroutes: () => pendingFromRefNames([...durable.refs.keys()]),
  }
  const out = watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })
  assert.match(out[0].error, /durable start marker/)
  assert.equal(out[1].reroute.ack.status, 'acknowledged')
  assert.ok(durable.refs.has('refs/db-start-reroutes/reviewer/review-10-20-seq3-slot1--moot'))
  assert.deepEqual(calls.filter(([, pr]) => pr === '20').map(([c]) => c), ['--probe-silent-reviewer', '--reclaim-silent-reviewer'])
  // The mooted reservation is not resumed and the pass completes cleanly.
  const before = calls.length
  assert.deepEqual(watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' }).filter((e) => e.resumed || e.error), [])
  assert.equal(calls.length, before)
})

test('pending reservations exclude acknowledged and mooted ones', () => {
  const r = 'refs/db-start-reroutes/reviewer/review-1-2-seq3-slot1'
  assert.deepEqual(pendingFromRefNames([r, `${r}--dispatch-claim`, 'refs/db-start-reroutes/reviewer/a', 'refs/db-start-reroutes/reviewer/a--dispatch-ack', 'refs/db-start-reroutes/reviewer/b', 'refs/db-start-reroutes/reviewer/b--moot', `${r}--failed-1`, `${r}--failed-2`]), [{ ref: r, failures: 2 }])
})

test('a reclaim whose outcome is unknown is never mooted, so resume can finish the replacement', () => {
  const exact = { issue: 10, pr: 20, headSha: head, slot: 1, sequence: 3 }
  assert.equal(mootable({ readLeases: () => [] }, 'probe', exact), false)
  assert.equal(mootable({ readLeases: () => [row()] }, 'probe', exact), true)
  assert.equal(mootable({ readLeases: () => [row()] }, 'reclaim', exact), true)
  assert.equal(mootable({ readLeases: () => [row({ sequence: 4 })] }, 'reclaim', exact), false)
  assert.equal(mootable({ readLeases: () => [] }, 'reclaim', exact), false)
  assert.equal(mootable({ readLeases: () => { throw new Error('HTTP 502') } }, 'reclaim', exact), false)
  assert.equal(mootable({ readLeases: () => [row()] }, 'replace', exact), false)
  // Reclaim applied but its readback threw: the lease is gone, no moot, and resume completes it.
  const durable = memoryDurable(), calls = []
  let leases = [row()], phase = 1
  const io = {
    now: () => late, readLeases: () => leases, durable, pendingReroutes: () => pendingFromRefNames([...durable.refs.keys()]),
    manager: (args) => {
      calls.push(args[0])
      if (args[0] === '--reclaim-silent-reviewer') { if (phase === 1) { leases = []; throw new Error('atomic silent reviewer reclaim readback mismatch') } throw new Error('silent reviewer lease was already reclaimed with immutable evidence') }
      if (args[0] === '--probe-silent-reviewer' && phase === 2) throw new Error('reviewer silence probe already exists and is immutable')
      return { sequence: 4 }
    },
  }
  assert.match(watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })[0].error, /readback mismatch/)
  assert.equal(durable.refs.has('refs/db-start-reroutes/reviewer/review-10-20-seq3-slot1--moot'), false)
  phase = 2
  const out = watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })
  assert.equal(out[0].ack.status, 'acknowledged')
  assert.deepEqual(out[0].steps.replace, { status: 'done', result: { sequence: 4 } })
})

test('--apply requires --drawn-since and leaves leases drawn earlier to the ordinary silence path', () => {
  const durable = memoryDurable(), calls = []
  const io = { now: () => late, readLeases: () => [row()], manager: (a) => { calls.push(a); return {} }, durable, pendingReroutes: () => [] }
  assert.throws(() => watchOnce(io, { apply: true }), /--drawn-since/)
  const out = watchOnce(io, { apply: true, drawnSince: '2026-09-16T12:00:00.001Z' })
  assert.equal(out[0].action, 'skip')
  assert.match(out[0].reason, /before --drawn-since/)
  assert.equal(calls.length, 0)
  assert.equal(watchOnce(io, { apply: false }).length, 1)
})

test('a permanently refused resume is recorded per attempt and closed with a terminal moot at the limit', () => {
  const created = new Map()
  const ref = 'refs/db-start-reroutes/reviewer/review-1-2-seq3-slot1'
  const durable = { ...memoryDurable(), createAccepted: (r, _id, v) => { if (created.has(r)) return false; created.set(r, v); return true }, readPair: () => null }
  const io = { now: () => late, readLeases: () => [], manager: () => { throw new Error('replace refused') }, durable, pendingReroutes: () => [{ ref, failures: RESUME_ATTEMPT_LIMIT - 2 }] }
  const first = watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })
  assert.ok(first[0].error)
  assert.ok(created.has(`${ref}--failed-${RESUME_ATTEMPT_LIMIT - 1}`))
  assert.ok(!created.has(`${ref}--moot`))
  io.pendingReroutes = () => [{ ref, failures: RESUME_ATTEMPT_LIMIT - 1 }]
  const last = watchOnce(io, { apply: true, drawnSince: '2026-09-16T00:00:00.000Z' })
  assert.equal(last[0].gave_up, true)
  assert.match(created.get(`${ref}--moot`).reason, /resume attempts exhausted/)
})
