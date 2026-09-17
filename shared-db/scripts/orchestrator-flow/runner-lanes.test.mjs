import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadRegistry, validateRegistry, qualifiedLanesFor, replacementDispatchInputs, aggregateVerdict, laneCheckName, workflowLaneConformance, runAggregate, fetchCheckRuns, RunnerLaneError } from './runner-lanes.mjs'
import { runnerStartDecision, reserveRunnerReroute, acceptRunnerResult, createDurableStartRerouteAdapter, dispatchQueuedReroute } from './start-reroute.mjs'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const registry = loadRegistry()
const h = 'b'.repeat(40), queued = '2026-09-15T10:00:00Z', late = '2026-09-15T10:11:00Z'
const TOOLS = 'tools-offline-tests.yml'
const attempt = { id: 'run-1', workflow: TOOLS, lane: 'ubuntu-latest', head_sha: h, queued_at: queued, required_assertions: ['tools-offline-tests'] }
const ok = (name) => ({ name, status: 'completed', conclusion: 'success' })

function durableStore(liveOverride = {}) {
  const refs = new Map(), claims = new Map(), acks = new Map(), dispatches = []
  const live = { now: late, lifecycle: [], qualified_lanes: qualifiedLanesFor(registry, TOOLS), ...liveOverride }
  const durable = {
    withMutex: (f) => f(), readPair: (r) => refs.get(r), compareCreatePair: (r, _e, pair) => refs.has(r) ? false : (refs.set(r, pair), true),
    readLive: () => live, createAccepted: (r, d, x) => refs.has(r) ? false : (refs.set(r, { digest: d, result: x }), true), readAccepted: (r) => refs.get(r),
    readDispatchAck: (r) => acks.get(r), compareCreateDispatchClaim: (r, x) => claims.has(r) ? false : (claims.set(r, x), true), readDispatchClaim: (r) => claims.get(r),
    dispatchReplacement: (id, record) => { const prior = dispatches.find((d) => d.id === id); if (prior) return { status: 'existing', reroute_id: id, replacement_id: record.replacement_id }; dispatches.push({ id, record, inputs: replacementDispatchInputs(registry, { action: 'dispatch-new-run', workflow: record.workflow, lane: record.lane, head_sha: record.head_sha }) }); return { status: 'created', reroute_id: id, replacement_id: record.replacement_id } },
    compareCreateDispatchAck: (r, x) => acks.has(r) ? false : (acks.set(r, x), true),
  }
  return { refs, dispatches, live, durable, io: createDurableStartRerouteAdapter(durable) }
}

test('registry declares five distinct free standard lanes with identical assertions per job', () => {
  assert.equal(registry.lanes.length, 5)
  assert.deepEqual(registry.lanes.map((l) => l.label), ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-24.04-arm', 'ubuntu-22.04-arm'])
  assert.ok(registry.lanes.every((l) => l.class === 'standard' && l.qualified === true))
  for (const job of registry.queue_sensitive_jobs) {
    const lanes = qualifiedLanesFor(registry, job.workflow)
    assert.equal(new Set(lanes.map((l) => l.name)).size, 5)
    assert.ok(lanes.every((l) => canonicalJson(l.assertions) === canonicalJson(job.assertions)))
  }
  assert.throws(() => validateRegistry({ ...registry, lanes: registry.lanes.slice(0, 4) }), /five/)
  assert.throws(() => validateRegistry({ ...registry, lanes: [...registry.lanes.slice(0, 4), { name: 'ubuntu-latest-8-cores', label: 'ubuntu-latest-8-cores', class: 'standard', qualified: true }] }), /larger paid/)
  assert.throws(() => validateRegistry({ ...registry, lanes: [...registry.lanes.slice(0, 4), { ...registry.lanes[0] }] }), /duplicate lane/)
})

test('both queue-sensitive workflows expose exactly the registry lanes and keep the stable default context', () => {
  for (const job of registry.queue_sensitive_jobs) {
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows', job.workflow), 'utf8')
    assert.deepEqual(workflowLaneConformance(registry, text, job), [], job.workflow)
    assert.ok(text.includes(`  ${job.job_id}:`), `${job.workflow} has job ${job.job_id}`)
  }
  const aggregate = fs.readFileSync(path.join(ROOT, '.github/workflows/queue-sensitive-aggregate.yml'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(aggregate.includes(`name: ${registry.aggregate_context}\n`))
  assert.ok(!/runs-on:.*(cores|large|gpu)/i.test(aggregate))
  assert.ok(workflowLaneConformance(registry, 'runs-on: ubuntu-latest', registry.queue_sensitive_jobs[0]).length >= 3, 'conformance check can fail')
})

test('registry validation refuses every unsafe shape', () => {
  const lanes = registry.lanes, jobs = registry.queue_sensitive_jobs
  const withLane = (lane) => ({ ...registry, lanes: [...lanes.slice(0, 4), lane] })
  assert.throws(() => validateRegistry(withLane({ ...lanes[4], class: 'larger' })), /not a free standard runner/)
  assert.throws(() => validateRegistry(withLane({ ...lanes[4], class: undefined })), /not a free standard runner/)
  for (const label of ['Ubuntu-22.04', 'ubuntu 22.04', 'ubuntu;rm', '-ubuntu', 'ubuntu/22.04', '']) {
    assert.throws(() => validateRegistry(withLane({ ...lanes[4], name: label, label })), /unsafe/, JSON.stringify(label))
  }
  assert.throws(() => validateRegistry(withLane({ ...lanes[4], name: 'other' })), /unsafe/, 'name must equal label')
  for (const label of ['ubuntu-latest-4-cores', 'ubuntu-large', 'ubuntu-gpu-t4', 'ubuntu-24.04-xl']) {
    assert.throws(() => validateRegistry(withLane({ ...lanes[4], name: label, label })), /larger paid/, label)
  }
  assert.throws(() => validateRegistry(withLane({ ...lanes[1] })), /duplicate lane ubuntu-24.04/)
  assert.throws(() => validateRegistry({ ...registry, queue_sensitive_jobs: [{ ...jobs[0], context: registry.aggregate_context }] }), /duplicate context Queue-sensitive checks \(aggregate\)/)
  assert.equal(registry.aggregate_context, 'Queue-sensitive checks (aggregate)')
  assert.throws(() => validateRegistry({ ...registry, queue_sensitive_jobs: [jobs[0], { ...jobs[1], context: jobs[0].context }] }), /duplicate context/)
  assert.throws(() => validateRegistry({ ...registry, queue_sensitive_jobs: [jobs[0], { ...jobs[1], assertions: [jobs[0].assertions[0]] }] }), /unsafe or duplicated/)
  assert.throws(() => validateRegistry({ ...registry, queue_sensitive_jobs: [{ ...jobs[0], assertions: ['a', 'a'] }] }), /unsafe or duplicated: a/)
  assert.throws(() => validateRegistry({ ...registry, queue_sensitive_jobs: [{ ...jobs[0], assertions: ['bad token'] }] }), /unsafe or duplicated/)
  assert.doesNotThrow(() => validateRegistry(registry))
})

test('workflow conformance detects drift in input type, default, required flag, permissions and lane guard', () => {
  for (const job of registry.queue_sensitive_jobs) {
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows', job.workflow), 'utf8').replace(/\r\n/g, '\n')
    const drift = (from, to, pattern) => {
      assert.ok(text.includes(from), `${job.workflow} contains ${from}`)
      const problems = workflowLaneConformance(registry, text.replace(from, to), job)
      assert.ok(problems.some((p) => pattern.test(p)), `${job.workflow}: ${from} -> ${to} gave ${JSON.stringify(problems)}`)
    }
    drift('        type: choice\n', '        type: string\n', /type is not choice/)
    drift("        default: ''\n", '        default: ubuntu-24.04\n', /default/)
    drift('        required: false\n', '        required: true\n', /required flag/)
    drift('permissions:\n  contents: read\n', 'permissions:\n  contents: write\n', /permissions/)
    drift('permissions:\n  contents: read\n', 'permissions:\n  contents: read\n  actions: write\n', /permissions/)
    drift('permissions:\n  contents: read\n', 'permissions: write-all\n', /permissions/)
    drift('    timeout-minutes: 30\n', '    timeout-minutes: 30\n    permissions:\n      contents: write\n', /permissions/)
    drift("''|ubuntu-latest|", "''|windows-latest|ubuntu-latest|", /lane guard/)
    drift('|ubuntu-22.04-arm) ;;', ') ;;', /lane guard/)
    drift('exit 1 ;;\n', 'exit 0 ;;\n', /lane guard/)
    drift('LANE: ${{ inputs.lane }}', 'LANE: ubuntu-latest', /lane guard step does not read/)
  }
})

test('injected runner non-pickup produces exactly one qualified replacement run on a different lane', () => {
  const s = durableStore()
  const decision = runnerStartDecision(attempt, { now: late, lifecycle: [], qualified_lanes: qualifiedLanesFor(registry, TOOLS) })
  assert.equal(decision.action, 'dispatch-new-run')
  assert.notEqual(decision.lane, attempt.lane)
  assert.ok(registry.lanes.some((l) => l.label === decision.lane))
  const reserved = reserveRunnerReroute(attempt, decision, { id: 'run-2' }, s.io)
  assert.equal(reserved.status, 'queued')
  assert.equal(dispatchQueuedReroute(reserved.ref, s.durable).status, 'acknowledged')
  assert.equal(s.dispatches.length, 1)
  assert.deepEqual(s.dispatches[0].inputs, { workflow: TOOLS, inputs: { lane: decision.lane }, head_sha: h })
  const assertions = [{ name: 'tools-offline-tests', result: 'passed' }]
  const identity = { attempt_id: 'run-2', supersedes_attempt_id: 'run-1', reroute_id: reserved.reroute_id, workflow: TOOLS, lane: decision.lane, head_sha: h, assertions }
  const accepted = acceptRunnerResult({ ...identity, result_digest: sha256(canonicalJson(identity)) }, attempt, s.io)
  assert.equal(accepted.accepted, true)
  const verdict = aggregateVerdict(registry, [{ name: 'Tools offline tests', status: 'completed', conclusion: 'cancelled' }, ok(laneCheckName('Tools offline tests', decision.lane)), ok('Promotion contract tests (offline)')])
  assert.equal(verdict.verdict, 'pass')
})

test('duplicate prevention: a second reservation, dispatch or result for the same original is refused or idempotent', () => {
  const s = durableStore()
  const decision = runnerStartDecision(attempt, { now: late, qualified_lanes: qualifiedLanesFor(registry, TOOLS) })
  const first = reserveRunnerReroute(attempt, decision, { id: 'run-2' }, s.io)
  assert.equal(reserveRunnerReroute(attempt, decision, { id: 'run-2' }, s.io).status, 'existing')
  assert.throws(() => reserveRunnerReroute(attempt, decision, { id: 'run-3' }, s.io), /different runner replacement/)
  dispatchQueuedReroute(first.ref, s.durable)
  assert.equal(dispatchQueuedReroute(first.ref, s.durable).status, 'existing')
  assert.equal(s.dispatches.length, 1)
  const otherLane = qualifiedLanesFor(registry, TOOLS).filter((l) => l.name !== attempt.lane && l.name !== decision.lane)[0].name
  assert.throws(() => reserveRunnerReroute(attempt, { ...decision, lane: otherLane }, { id: 'run-2' }, s.io), /changed|different/)
  assert.throws(() => replacementDispatchInputs(registry, { ...decision, lane: 'ubuntu-latest-16-cores' }), RunnerLaneError)
})

test('an active quiet runner is kept and never replaced', () => {
  const lifecycle = [{ attempt_id: 'run-1', type: 'runner_started', at: '2026-09-15T10:01:00Z' }]
  assert.deepEqual(runnerStartDecision(attempt, { now: '2026-09-15T11:30:00Z', lifecycle, qualified_lanes: qualifiedLanesFor(registry, TOOLS) }), { action: 'keep-active', started_at: '2026-09-15T10:01:00Z' })
  const s = durableStore({ lifecycle })
  const decision = runnerStartDecision(attempt, { now: late, qualified_lanes: qualifiedLanesFor(registry, TOOLS) })
  assert.throws(() => reserveRunnerReroute(attempt, decision, { id: 'run-2' }, s.io), /started or changed/)
  assert.equal(s.refs.size, 0)
  assert.equal(runnerStartDecision(attempt, { now: '2026-09-15T10:05:00Z', qualified_lanes: qualifiedLanesFor(registry, TOOLS) }).action, 'wait')
})

test('aggregate truth: missing, duplicate and failed assertions all refuse; pending waits', () => {
  const T = 'Tools offline tests', P = 'Promotion contract tests (offline)'
  assert.equal(aggregateVerdict(registry, [ok(T), ok(P), ok('Domain ownership')]).verdict, 'pass')
  const missing = aggregateVerdict(registry, [ok(T)])
  assert.equal(missing.verdict, 'refuse'); assert.match(missing.refusals.join(), /Promotion contract tests \(offline\): assertion never ran/)
  assert.equal(aggregateVerdict(registry, [ok(T), { name: P, status: 'completed', conclusion: 'cancelled' }]).verdict, 'refuse')
  const duplicate = aggregateVerdict(registry, [ok(T), ok(laneCheckName(T, 'ubuntu-22.04-arm')), ok(P)])
  assert.equal(duplicate.verdict, 'refuse'); assert.match(duplicate.refusals.join(), /duplicate assertion/)
  const failed = aggregateVerdict(registry, [ok(T), { name: laneCheckName(P, 'ubuntu-24.04'), status: 'completed', conclusion: 'failure' }, ok(P)])
  assert.equal(failed.verdict, 'refuse'); assert.match(failed.refusals.join(), /failed assertion/)
  for (const conclusion of ['timed_out', 'startup_failure', 'action_required', 'stale', 'mystery']) assert.equal(aggregateVerdict(registry, [ok(T), { name: P, status: 'completed', conclusion }]).verdict, 'refuse', conclusion)
  assert.equal(aggregateVerdict(registry, [ok(T), ok(laneCheckName(P, 'windows-latest'))]).verdict, 'refuse')
  assert.equal(aggregateVerdict(registry, [ok(T), { name: P, status: 'queued', conclusion: null }]).verdict, 'pending')
  assert.equal(aggregateVerdict(registry, [ok(T), { name: P, status: 'queued', conclusion: null }, ok(laneCheckName(P, 'ubuntu-24.04'))]).verdict, 'pending', 'a superseded run must be cancelled before acceptance')
  let clock = 0
  const timedOut = runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => [ok(T), { name: P, status: 'queued' }], sleep: (ms) => { clock += ms }, now: () => clock, timeoutMs: 60000, log: () => {} })
  assert.equal(timedOut.verdict, 'refuse')
  assert.throws(() => runAggregate({ repo: 'x', headSha: 'nope', registry, fetchRuns: () => [], sleep: () => {}, timeoutMs: 1 }), /40-hex/)
})

test('registry validation refuses self-hosted, non-Ubuntu and custom runner labels', () => {
  const lanes = registry.lanes
  const withLane = (label) => ({ ...registry, lanes: [...lanes.slice(0, 4), { ...lanes[4], name: label, label }] })
  for (const label of ['self-hosted', 'windows-latest', 'windows-2022', 'macos-14', 'macos-latest', 'linux', 'x64', 'ubuntu', 'ubuntu-latest-custom', 'my-runner-group', 'ubuntu-24.04-arm64', 'ubuntu-2404']) {
    assert.throws(() => validateRegistry(withLane(label)), /not a GitHub-hosted standard Ubuntu label/, label)
  }
  for (const label of ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04-arm']) assert.doesNotThrow(() => validateRegistry({ ...registry, lanes: [...lanes.filter((l) => l.label !== label).slice(0, 4), { ...lanes[4], name: label, label }] }), label)
})

test('workflow conformance refuses any extra, missing or non-Ubuntu choice option', () => {
  for (const job of registry.queue_sensitive_jobs) {
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows', job.workflow), 'utf8').replace(/\r\n/g, '\n')
    assert.deepEqual(workflowLaneConformance(registry, text, job), [], job.workflow)
    const last = '          - ubuntu-22.04-arm\n'
    assert.ok(text.includes(last), `${job.workflow} lists ubuntu-22.04-arm`)
    const drifts = [
      [last, `${last}          - self-hosted\n`],
      [last, `${last}          - windows-latest\n`],
      ["          - ''\n", "          - ''\n          - macos-14\n"],
      [last, `${last}          - [self-hosted, linux]\n`],
      ["          - ''\n", ''],
      [last, ''],
      ['          - ubuntu-24.04\n', '          - self-hosted\n'],
      ['        options:\n', '        choices:\n'],
    ]
    for (const [from, to] of drifts) {
      const problems = workflowLaneConformance(registry, text.replace(from, to), job)
      assert.ok(problems.some((p) => /lane choice options/.test(p)), `${job.workflow}: ${JSON.stringify(to)} gave ${JSON.stringify(problems)}`)
    }
  }
})

test('live check-run listing paginates, keeps queued runs, takes the newest re-run and refuses partial reads', () => {
  const T = 'Tools offline tests', P = 'Promotion contract tests (offline)'
  const run = (id, name, status = 'completed', conclusion = 'success') => ({ id, name, status, conclusion })
  let seenArgs
  const reader = (payload) => ({ readJson: (args) => { seenArgs = args; return payload } })
  const filler = Array.from({ length: 100 }, (_, i) => run(1000 + i, `Other check ${i}`))
  const pages = [{ total_count: 103, check_runs: filler }, { total_count: 103, check_runs: [run(1, T, 'completed', 'failure'), run(2, T), run(3, P, 'queued', null)] }]
  const rows = fetchCheckRuns('u2giants/shared-db', h, reader(pages))
  assert.deepEqual(seenArgs.slice(0, 3), ['api', '--paginate', '--slurp'])
  assert.match(seenArgs[3], /per_page=100&filter=all$/)
  assert.deepEqual(rows.find((r) => r.name === T), { name: T, status: 'completed', conclusion: 'success' }, 'newest re-run wins')
  assert.deepEqual(rows.find((r) => r.name === P), { name: P, status: 'queued', conclusion: null }, 'a queued run is not dropped')
  assert.equal(rows.length, 102)
  assert.equal(aggregateVerdict(registry, rows).verdict, 'pending')
  const refuse = (payload, pattern) => assert.throws(() => fetchCheckRuns('u2giants/shared-db', h, reader(payload)), pattern, JSON.stringify(payload).slice(0, 80))
  refuse([pages[0]], /incomplete \(100 of 103\)/)
  refuse([{ total_count: 103, check_runs: filler }, { total_count: 104, check_runs: pages[1].check_runs }], /incomplete/)
  refuse([pages[0], { total_count: 103 }], /no check_runs list/)
  refuse([pages[0], { check_runs: pages[1].check_runs }], /no total_count/)
  refuse({ total_count: 1, check_runs: [run(2, T)] }, /did not return pages/)
  refuse([], /did not return pages/)
  refuse([{ total_count: 2, check_runs: [run(2, T), run(2, T)] }], /repeated run 2/)
  refuse([{ total_count: 1, check_runs: [{ name: T, status: 'completed', conclusion: 'success' }] }], /without a name or id/)
})

test('a failed check-run read is retried with jittered backoff until the deadline; content refusals still fail at once', () => {
  const T = 'Tools offline tests', P = 'Promotion contract tests (offline)'
  let clock = 0, calls = 0; const sleeps = []
  const transient = (message) => Object.assign(new Error(message), { transientTransport: true })
  const recovered = runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, random: () => 0, fetchRuns: () => { calls += 1; if (calls < 3) throw transient('HTTP 502'); return [ok(T), ok(P)] }, sleep: (ms) => { sleeps.push(ms); clock += ms }, now: () => clock, timeoutMs: 600000, log: () => {} })
  assert.equal(recovered.verdict, 'pass'); assert.deepEqual(sleeps, [30000, 60000])
  clock = 0
  const down = runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, random: () => 0, fetchRuns: () => { throw transient('HTTP 503') }, sleep: (ms) => { clock += ms }, now: () => clock, timeoutMs: 600000, log: () => {} })
  assert.equal(down.verdict, 'refuse'); assert.match(down.refusals.join(), /still failing at deadline: HTTP 503/)
  assert.throws(() => runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => { throw new RunnerLaneError('incomplete listing') }, sleep: () => { throw new Error('must not wait') }, now: () => 0, timeoutMs: 600000, log: () => {} }), /incomplete listing/)
  for (const message of ['HTTP 404: commit absent', 'HTTP 401: bad credentials', 'HTTP 403: Resource not accessible by integration']) {
    let slept = false
    assert.throws(() => runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => { throw new Error(message) }, sleep: () => { slept = true }, now: () => 0, timeoutMs: 600000, log: () => {} }), new RegExp(message.split(':')[0]))
    assert.equal(slept, false, `${message} must fail immediately`)
  }
  const floor = []; clock = 0; calls = 0
  runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => { calls += 1; const rows = calls < 2 ? [ok(T)] : [ok(T), ok(P)]; Object.defineProperty(rows, 'pollIntervalMs', { value: 60000 }); return rows }, sleep: (ms) => { floor.push(ms); clock += ms }, now: () => clock, timeoutMs: 600000, log: () => {} })
  assert.deepEqual(floor, [60000], 'x-poll-interval raises the healthy interval')
})

test('aggregate waits for a context that has not reported yet, and refuses it at the deadline', () => {
  const T = 'Tools offline tests', P = 'Promotion contract tests (offline)'
  let clock = 0, calls = 0
  const sleep = (ms) => { clock += ms }
  const late = runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => (++calls < 3 ? [ok(T)] : [ok(T), ok(P)]), sleep, now: () => clock, timeoutMs: 600000, log: () => {} })
  assert.equal(late.verdict, 'pass'); assert.equal(calls, 3)
  clock = 0
  const never = runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => [ok(T)], sleep, now: () => clock, timeoutMs: 60000, log: () => {} })
  assert.equal(never.verdict, 'refuse'); assert.match(never.refusals.join(), /still not finished at deadline: Promotion contract tests \(offline\)/)
  let slept = false
  const failedNow = runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => [{ name: T, status: 'completed', conclusion: 'failure' }], sleep: () => { slept = true }, now: () => 0, timeoutMs: 60000, log: () => {} })
  assert.equal(failedNow.verdict, 'refuse'); assert.equal(slept, false, 'a real failure never waits for an unreported context')
  const cancelledOnly = runAggregate({ repo: 'u2giants/shared-db', headSha: h, registry, fetchRuns: () => [ok(T), { name: P, status: 'completed', conclusion: 'cancelled' }], sleep: () => { slept = true }, now: () => 0, timeoutMs: 60000, log: () => {} })
  assert.equal(cancelledOnly.verdict, 'refuse'); assert.equal(slept, false, 'a context whose only run was cancelled refuses at once')
})
