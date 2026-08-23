import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseArgs, planUnion, renderPlan, validateLiveDocument, readLive, applyUnion,
  verifyReadback, main, RequiredChecksError, DEFAULT_REPO, DEFAULT_BRANCH, ghSpawnOptions,
} from './update-required-checks.mjs'

const LIVE = Object.freeze({
  strict: false,
  contexts: [
    'Promotion contract tests (offline)', 'Cross-PR object collision', 'Tools offline tests',
    'SQL migration guards', 'Domain ownership', 'Intake pointer guard', 'Handoff contract',
    'Migration author lease', 'Migration guarded merge authorization',
  ],
})

const THE_TWO = ['Orchestrator marker guard', 'Cancelled work guard']

function io(sequence) {
  const calls = []
  let index = 0
  return {
    calls,
    run(args, options) {
      calls.push({ args, input: options?.input })
      const next = sequence[Math.min(index, sequence.length - 1)]
      index++
      if (next instanceof Error) throw next
      return typeof next === 'string' ? next : JSON.stringify(next)
    },
    log() {}, error() {},
  }
}

test('parseArgs collects repeated --add and defaults repo, branch and dry run', () => {
  const options = parseArgs(['--add', 'A', '--add', 'B'])
  assert.deepEqual(options.add, ['A', 'B'])
  assert.equal(options.repo, DEFAULT_REPO)
  assert.equal(options.branch, DEFAULT_BRANCH)
  assert.equal(options.apply, false, 'apply must be opt-in; a tool that writes by default will eventually write by accident')
})

test('parseArgs rejects a missing value, a flag as a value, and an unknown argument', () => {
  assert.throws(() => parseArgs(['--add']), /--add requires a context name/)
  assert.throws(() => parseArgs(['--add', '--apply']), /--add requires a context name/)
  assert.throws(() => parseArgs(['--repo']), /--repo requires owner\/name/)
  assert.throws(() => parseArgs(['--wat']), /unknown argument --wat/)
})

// FAIL CLOSED. Each of these would otherwise become "there are no contexts", and
// the union would then be a silent replacement of the whole list.
test('an unreadable or implausible live document is refused, never treated as empty', () => {
  assert.throws(() => validateLiveDocument(null), /not an object/)
  assert.throws(() => validateLiveDocument([]), /not an object/)
  assert.throws(() => validateLiveDocument({ strict: false }), /contexts is missing/)
  assert.throws(() => validateLiveDocument({ strict: false, contexts: 'a' }), /not an array/)
  assert.throws(() => validateLiveDocument({ strict: false, contexts: ['ok', ''] }), /non-string or empty/)
  assert.throws(() => validateLiveDocument({ strict: false, contexts: ['ok', 7] }), /non-string or empty/)
  assert.throws(() => validateLiveDocument({ contexts: ['ok'] }), /strict is missing/)
  assert.throws(() => validateLiveDocument({ strict: 'false', contexts: ['ok'] }), /strict is missing or not a boolean/)
  assert.throws(() => validateLiveDocument({ strict: false, contexts: [] }), /EMPTY/)
})

test('the union adds only what is missing and never drops or reorders an existing context', () => {
  const plan = planUnion(LIVE, THE_TWO)
  assert.deepEqual(plan.toAdd, THE_TWO)
  assert.deepEqual(plan.next.slice(0, LIVE.contexts.length), LIVE.contexts, 'existing contexts must survive in their original order')
  assert.equal(plan.next.length, LIVE.contexts.length + 2)
  for (const context of LIVE.contexts) assert.ok(plan.next.includes(context), `${context} must survive`)
  assert.equal(plan.changed, true)
})

test('strict is carried through byte-for-value and is never authored by this tool', () => {
  assert.equal(planUnion(LIVE, THE_TWO).strict, false)
  assert.equal(planUnion({ ...LIVE, strict: true }, THE_TWO).strict, true,
    'the tool echoes whatever is live; it must not have an opinion about strict')
})

test('re-running with contexts that are already required is a no-op, not a duplicate', () => {
  const plan = planUnion(LIVE, ['Handoff contract', 'Tools offline tests'])
  assert.deepEqual(plan.toAdd, [])
  assert.deepEqual(plan.alreadyPresent, ['Handoff contract', 'Tools offline tests'])
  assert.deepEqual(plan.next, LIVE.contexts)
  assert.equal(plan.changed, false)
})

test('duplicate --add values collapse to one addition', () => {
  const plan = planUnion(LIVE, ['New guard', 'New guard'])
  assert.deepEqual(plan.toAdd, ['New guard'])
  assert.equal(plan.next.filter((c) => c === 'New guard').length, 1)
})

test('an empty or whitespace context is refused rather than added', () => {
  assert.throws(() => planUnion(LIVE, ['']), /must not be empty/)
  assert.throws(() => planUnion(LIVE, ['   ']), /must not be empty/)
  assert.throws(() => planUnion(LIVE, []), /at least one --add context is required/)
})

// A RENAME is a REMOVE plus an ADD. This tool must never be the thing that
// performs one, because the removed half is invisible in a diff of the request.
test('a near-miss name is treated as a new context, so a rename can never happen silently', () => {
  const plan = planUnion(LIVE, ['Handoff Contract'])
  assert.ok(plan.next.includes('Handoff contract'), 'the original casing must survive')
  assert.ok(plan.next.includes('Handoff Contract'), 'the near-miss is an addition, not a replacement')
  assert.equal(plan.next.length, LIVE.contexts.length + 1)
})

test('the rendered plan states the mode, preserves strict visibly, and shows no removals', () => {
  const text = renderPlan(planUnion(LIVE, THE_TWO), { repo: DEFAULT_REPO, branch: 'main', apply: false })
  assert.match(text, /DRY RUN/)
  assert.match(text, /strict: false {2}\(PRESERVED EXACTLY/)
  assert.match(text, /\+ Orchestrator marker guard/)
  assert.match(text, /\+ Cancelled work guard/)
  assert.match(text, /no context removed, no context renamed/)
  assert.doesNotMatch(text, /^\s*- /m, 'a removal line must never appear; this tool only adds')
})

test('readLive uses the NARROW endpoint, never the full branch-protection object', () => {
  const transport = io([LIVE])
  readLive({ repo: DEFAULT_REPO, branch: 'main' }, transport)
  const args = transport.calls[0].args.join(' ')
  assert.match(args, /branches\/main\/protection\/required_status_checks$/)
  assert.doesNotMatch(args, /-X (PUT|PATCH)/, 'reading must not mutate')
})

test('readLive fails closed on transport failure and on non-JSON', () => {
  assert.throws(() => readLive({ repo: DEFAULT_REPO, branch: 'main' }, io([new Error('boom')])), /could not read live required status checks/)
  assert.throws(() => readLive({ repo: DEFAULT_REPO, branch: 'main' }, io(['not json'])), /not valid JSON; nothing was compared/)
})

test('applyUnion PATCHes the narrow endpoint with the union and the live strict value', () => {
  const transport = io(['{}'])
  const plan = planUnion(LIVE, THE_TWO)
  applyUnion({ repo: DEFAULT_REPO, branch: 'main' }, plan, transport)
  const call = transport.calls[0]
  assert.match(call.args.join(' '), /-X PATCH/)
  assert.match(call.args.join(' '), /protection\/required_status_checks/)
  assert.doesNotMatch(call.args.join(' '), /protection$/, 'must never write the full branch-protection object')
  const body = JSON.parse(call.input)
  assert.equal(body.strict, false)
  assert.deepEqual(body.contexts, plan.next)
  assert.deepEqual(Object.keys(body).sort(), ['contexts', 'strict'], 'the narrow body must carry nothing else')
})

// REGRESSION, 2026-08-23. The first live --apply failed with
// `422 ... nil is not an object` because the real gh() helper dropped `input` and
// set stdin to 'ignore', so `--input -` read an empty body. Every unit test passed,
// because the fake transport read options.input directly and never went near stdin.
// A mocked transport cannot prove a real subprocess contract; these two tests
// exercise the REAL helper's spawn options.
test('the real transport forwards the request body to the child stdin', () => {
  const options = ghSpawnOptions('{"strict":false,"contexts":["A"]}')
  assert.equal(options.input, '{"strict":false,"contexts":["A"]}', 'the body must reach the child or gh sends an empty request')
  assert.notEqual(options.stdio?.[0], 'ignore', "stdin must not be 'ignore' when a body is supplied")
})

test('the real transport still ignores stdin when there is no body to send', () => {
  assert.deepEqual(ghSpawnOptions(undefined).stdio, ['ignore', 'pipe', 'pipe'])
})

test('the readback refuses a lost context, a missing addition, or a flipped strict', () => {
  const plan = planUnion(LIVE, THE_TWO)
  assert.doesNotThrow(() => verifyReadback({ strict: false, contexts: plan.next }, plan))
  assert.throws(() => verifyReadback({ strict: false, contexts: LIVE.contexts }, plan), /is not required after the write/)
  const lostOne = plan.next.filter((c) => c !== 'Handoff contract')
  assert.throws(() => verifyReadback({ strict: false, contexts: lostOne }, plan), /previously required Handoff contract is GONE/)
  assert.throws(() => verifyReadback({ strict: true, contexts: plan.next }, plan), /strict changed from false to true.*#1286/s)
})

test('main dry-runs by default, writes nothing, and exits 0', async () => {
  const transport = io([LIVE])
  const code = await main(['--add', THE_TWO[0], '--add', THE_TWO[1]], transport)
  assert.equal(code, 0)
  assert.equal(transport.calls.length, 1, 'a dry run must make exactly one read and no write')
  assert.doesNotMatch(transport.calls[0].args.join(' '), /-X PATCH/)
})

test('main with --apply writes once, reads back, and exits 0', async () => {
  const after = { strict: false, contexts: [...LIVE.contexts, ...THE_TWO] }
  const transport = io([LIVE, '{}', after])
  const code = await main(['--add', THE_TWO[0], '--add', THE_TWO[1], '--apply'], transport)
  assert.equal(code, 0)
  assert.equal(transport.calls.length, 3, 'read, write, readback')
  assert.match(transport.calls[1].args.join(' '), /-X PATCH/)
})

test('main exits 1 when the readback proves the write did not take effect', async () => {
  const transport = io([LIVE, '{}', LIVE])
  assert.equal(await main(['--add', THE_TWO[0], '--apply'], transport), 1)
})

test('main exits 1 when the readback shows strict was flipped, and says to restore it', async () => {
  const flipped = { strict: true, contexts: [...LIVE.contexts, THE_TWO[0]] }
  const messages = []
  const transport = io([LIVE, '{}', flipped])
  transport.error = (text) => messages.push(String(text))
  assert.equal(await main(['--add', THE_TWO[0], '--apply'], transport), 1)
  assert.match(messages.join('\n'), /strict changed from false to true/)
  assert.match(messages.join('\n'), /Restore it immediately/)
})

// EXIT 2 IS NOT "NO DRIFT" AND NOT "NOTHING TO DO". It means the current state
// was never established, which is the one case where retrying blind is dangerous.
test('main exits 2 when the live document cannot be established', async () => {
  assert.equal(await main(['--add', 'X'], io([new Error('network down')])), 2)
  assert.equal(await main(['--add', 'X'], io(['not json'])), 2)
  assert.equal(await main(['--add', 'X'], io([{ strict: false, contexts: [] }])), 2)
  assert.equal(await main([], io([LIVE])), 2, 'no --add is a usage error, not a silent success')
})

test('main exits 0 and writes nothing when every requested context is already required', async () => {
  const transport = io([LIVE])
  assert.equal(await main(['--add', 'Handoff contract', '--apply'], transport), 0)
  assert.equal(transport.calls.length, 1, 'nothing to do must mean nothing written')
})

test('--help exits 0 without touching GitHub', async () => {
  const transport = io([new Error('should not be called')])
  assert.equal(await main(['--help'], transport), 0)
  assert.equal(transport.calls.length, 0)
})

test('RequiredChecksError is the single error type callers can catch', () => {
  assert.throws(() => validateLiveDocument(null), RequiredChecksError)
  assert.throws(() => parseArgs(['--nope']), RequiredChecksError)
})
