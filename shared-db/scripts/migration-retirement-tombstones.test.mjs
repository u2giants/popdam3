// Issue #2301, Step 3 -- terminal retirement tombstones.
//
// These tests exist because the failure they guard against is SILENT: a retired
// migration lane that can be resurrected looks exactly like a healthy one from
// every report, and only announces itself when a dead branch merges.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  LaneError,
  RETIRED_CLAIM_REF_PREFIX,
  RETIREMENT_SCHEMA_VERSION,
  RETIREMENT_RECORD_PREFIX,
  RETIREMENT_REF_ROW_LIMIT,
  retiredClaimRef,
  normalizeRetirementIdentity,
  validateRetirementRecord,
  formatRetirementRecord,
  parseRetirementRecord,
  resetRetirementSnapshot,
  isVersionRetired,
  readRetirementRecord,
  assertClaimNotRetired,
  assertRetirementIdentityAvailable,
  createRetirementTombstone,
  acquireAuthorLane,
  resumeAuthorLease,
  renewExpiredClaim,
  expandActiveClaimFromPr,
  expandActiveClaimFromIssue,
  recoverSameOwnerSplit,
  recoverExpiredClaimFromPr,
  supersedeActiveClaimVersion,
  reissueMergedStrandedClaim,
  claimBody,
  main,
  retiredReopenedClaims,
  MUTEX_REF,
} from './manage-migration-author-lanes.mjs'
// The whole module, so the wiring check below can DISCOVER claim-mutating paths
// instead of being handed a list of the ones somebody already remembered.
import * as lanes from './manage-migration-author-lanes.mjs'

const VERSION = '20260901120000'
const HEAD = 'a'.repeat(40)

function record(overrides = {}) {
  return {
    schema_version: RETIREMENT_SCHEMA_VERSION,
    claim: 4101,
    pr: 4102,
    head_sha: HEAD,
    branch: 'codex/issue-4101',
    version: VERSION,
    worktree: 'C:/repos/shared-db/.claude/worktrees/agent-4101',
    worktree_state: 'absent',
    decision: 'abandoned-worktree',
    evidence: 'https://github.com/u2giants/shared-db/issues/4101#issuecomment-1',
    successor_issue: null,
    created_at: '2026-09-01T12:00:00.000Z',
    ...overrides,
  }
}

// A deliberately small GitHub double. It counts calls, because "one bounded ref
// listing rather than per-claim calls" is a REQUIREMENT of this step, not an
// optimisation, and a requirement nothing counts is a requirement nothing keeps.
function fakeIo({ refs = new Map(), commits = new Map(), failCreate = false } = {}) {
  const calls = { listRefs: 0, readRef: 0, readCommitMessage: 0, createRef: 0, deleteRef: 0, makeOwnerCommit: 0 }
  const io = {
    calls,
    refs,
    commits,
    makeOwnerCommit(message) {
      calls.makeOwnerCommit++
      const sha = createHash('sha1').update(message).digest('hex')
      commits.set(sha, message)
      return sha
    },
    createRef(ref, sha) {
      calls.createRef++
      if (failCreate) return false
      if (refs.has(ref)) return false
      refs.set(ref, sha)
      return true
    },
    readRef(ref) { calls.readRef++; return refs.get(ref) ?? null },
    readCommitMessage(sha) { calls.readCommitMessage++; return commits.has(sha) ? commits.get(sha) : null },
    listRefs(prefix) {
      calls.listRefs++
      return [...refs].filter(([ref]) => ref.startsWith(`${prefix}/`)).map(([ref, sha]) => ({ ref, sha }))
    },
    deleteRef() { calls.deleteRef++; throw new Error('retirement refs are never deleted') },
  }
  return io
}

function withTombstone(overrides = {}) {
  const io = fakeIo()
  createRetirementTombstone(record(overrides), io)
  resetRetirementSnapshot()
  return io
}

test.beforeEach(() => resetRetirementSnapshot())

// --- payload bindings -------------------------------------------------------

test('#2301 a retirement record binds claim, PR, exact head, branch, version, worktree, state, decision, evidence and time', () => {
  const validated = validateRetirementRecord(record())
  for (const field of ['claim', 'pr', 'head_sha', 'branch', 'version', 'worktree', 'worktree_state', 'decision', 'evidence', 'created_at']) {
    assert.throws(() => validateRetirementRecord({ ...record(), [field]: undefined }), new RegExp(`missing ${field}`))
  }
  assert.equal(validated.head_sha, HEAD)
})

test('#2301 "no successor" must be stated, never omitted', () => {
  // An omitted successor and a deliberate "there is none" must not be the same
  // record: only one of them is a decision.
  assert.throws(() => validateRetirementRecord({ ...record(), successor_issue: undefined }), /missing successor_issue/)
  assert.equal(validateRetirementRecord(record({ successor_issue: null })).successor_issue, null)
  assert.equal(validateRetirementRecord(record({ decision: 'superseded-by-successor', successor_issue: 4200 })).successor_issue, 4200)
})

test('#2301 a supersession must name the work that replaced it', () => {
  assert.throws(() => validateRetirementRecord(record({ decision: 'superseded-by-successor' })), /must name its successor issue/)
})

test('#2301 a retirement record refuses an unknown field, a short head SHA, a bad version and an unknown decision', () => {
  assert.throws(() => validateRetirementRecord({ ...record(), note: 'x' }), /unknown field note/)
  assert.throws(() => validateRetirementRecord(record({ head_sha: 'abc123' })), /exact 40-character commit SHA/)
  assert.throws(() => validateRetirementRecord(record({ version: '2026' })), /exactly 14 digits/)
  assert.throws(() => validateRetirementRecord(record({ decision: 'gave-up' })), /decision must be one of/)
  assert.throws(() => validateRetirementRecord(record({ worktree_state: 'vanished' })), /worktree_state must be one of/)
})

test('#2301 retiring unmerged work needs a durable owner decision, not a typed sentence', () => {
  assert.throws(() => validateRetirementRecord(record({ worktree_state: 'dirty' })), /requires an owner-decision record/)
  assert.throws(() => validateRetirementRecord(record({ worktree_state: 'remote' })), /requires an owner-decision record/)
  assert.throws(() => validateRetirementRecord(record({ owner_decision: 'the owner said fine' })), /allowed only for a dirty or remote/)
})

test('#2301 a retirement record survives a format and parse round trip', () => {
  const text = formatRetirementRecord(record())
  assert.ok(text.startsWith(RETIREMENT_RECORD_PREFIX))
  assert.deepEqual(parseRetirementRecord(text), validateRetirementRecord(record()))
})

// --- fail-closed reading ----------------------------------------------------

test('#2301 an unreadable or foreign retirement record refuses instead of reading as "not retired"', () => {
  assert.throws(() => parseRetirementRecord('chore: unrelated commit'), /does not point to a retirement record/)
  assert.throws(() => parseRetirementRecord(`${RETIREMENT_RECORD_PREFIX}{oops`), /not readable JSON/)
  const io = withTombstone()
  io.commits.clear() // ref present, target unreadable
  assert.throws(() => readRetirementRecord(VERSION, io), /unreadable; refusing rather than treating it as not retired/)
})

test('#2301 a malformed ref in the retirement namespace refuses the whole audit', () => {
  const io = fakeIo({ refs: new Map([[`${RETIRED_CLAIM_REF_PREFIX}/not-a-version`, 'f'.repeat(40)]]) })
  assert.throws(() => isVersionRetired(VERSION, io), /malformed retirement ref/)
})

test('#2301 a retirement listing at its ceiling refuses rather than reading truncation as absence', () => {
  const refs = new Map()
  for (let n = 0; n < RETIREMENT_REF_ROW_LIMIT; n++) refs.set(`${RETIRED_CLAIM_REF_PREFIX}/${String(20260901000000 + n)}`, 'b'.repeat(40))
  assert.throws(() => isVersionRetired(VERSION, fakeIo({ refs })), /refusing a possibly truncated retirement audit/)
})

test('#2301 a retirement ref requires an exact 14-digit version', () => {
  assert.throws(() => retiredClaimRef('2026'), /exact 14-digit migration version/)
  assert.equal(retiredClaimRef(VERSION), `${RETIRED_CLAIM_REF_PREFIX}/${VERSION}`)
})

// --- create-only, idempotent, immutable ------------------------------------

test('#2301 a tombstone is created once and read back at the exact commit it wrote', () => {
  const io = fakeIo()
  const result = createRetirementTombstone(record(), io)
  assert.equal(result.idempotent, false)
  assert.equal(result.ref, `${RETIRED_CLAIM_REF_PREFIX}/${VERSION}`)
  assert.equal(io.refs.get(result.ref), result.sha)
  assert.deepEqual(parseRetirementRecord(io.commits.get(result.sha)), validateRetirementRecord(record()))
})

test('#2301 an identical retry is idempotent and writes nothing further', () => {
  const io = withTombstone()
  const before = io.refs.get(retiredClaimRef(VERSION))
  const created = io.calls.createRef
  const retry = createRetirementTombstone(record(), io)
  assert.equal(retry.idempotent, true)
  assert.equal(retry.sha, before)
  assert.equal(io.calls.createRef, created, 'an identical retry must not attempt a second create')
})

test('#2301 a conflicting tombstone refuses and never replaces the record already there', () => {
  const io = withTombstone()
  const original = io.refs.get(retiredClaimRef(VERSION))
  assert.throws(() => createRetirementTombstone(record({ claim: 9999 }), io), /conflicting retirement tombstone/)
  assert.equal(io.refs.get(retiredClaimRef(VERSION)), original, 'the existing tombstone must be untouched')
  assert.equal(io.calls.deleteRef, 0)
})

test('#2301 losing the create race to an identical record succeeds, to a different one refuses', () => {
  // The REAL race: the ref is absent when we look, and present by the time our
  // create lands. A double that pre-sets the ref tests the ordinary conflicting
  // -tombstone branch instead, and never exercises the race at all.
  const racing = (winnerRecord) => {
    const io = fakeIo({ failCreate: true })
    const winner = io.makeOwnerCommit(formatRetirementRecord(winnerRecord))
    let looked = false
    io.readRef = (ref) => {
      io.calls.readRef++
      if (ref !== retiredClaimRef(VERSION)) return io.refs.get(ref) ?? null
      if (!looked) { looked = true; return null } // absent when we checked
      return winner // the rival won between our check and our create
    }
    return { io, winner }
  }
  const agreed = racing(record())
  const settled = createRetirementTombstone(record(), agreed.io)
  assert.equal(settled.idempotent, true)
  assert.equal(settled.sha, agreed.winner)

  const conflicted = racing(record({ claim: 5555 }))
  assert.throws(() => createRetirementTombstone(record(), conflicted.io), /created concurrently with a different record/)
  assert.equal(conflicted.io.calls.deleteRef, 0)
})

test('#2301 no retirement path ever deletes a ref', () => {
  const io = withTombstone()
  createRetirementTombstone(record(), io)
  assert.throws(() => createRetirementTombstone(record({ pr: 1 }), io), LaneError)
  assert.throws(() => assertClaimNotRetired(VERSION, 'resumed', io), LaneError)
  assert.equal(io.calls.deleteRef, 0, 'retirement refs are permanent; nothing may delete one')
})

// --- permanence and identity ------------------------------------------------

test('#2301 a retired version stays retired and names the successor when there is one', () => {
  const io = withTombstone({ decision: 'superseded-by-successor', successor_issue: 4200 })
  assert.equal(isVersionRetired(VERSION, io), true)
  assert.throws(() => assertClaimNotRetired(VERSION, 'renewed', io), /can never be renewed; successor work is issue #4200/)
})

test('#2301 a retirement with no successor tells the operator what a successor needs', () => {
  const io = withTombstone()
  assert.throws(() => assertClaimNotRetired(VERSION, 'expanded', io), /a successor needs a fresh claim, branch, worktree and migration version/)
})

test('#2301 an unretired version is not blocked', () => {
  const io = withTombstone()
  assert.equal(assertClaimNotRetired('20261231235959', 'resumed', io), null)
})

test('#2301 a retired branch or worktree can never be reused, including under a different spelling', () => {
  const io = withTombstone()
  assert.throws(() => assertRetirementIdentityAvailable({ branch: 'codex/issue-4101', worktree: 'C:/fresh' }, io), /must use a fresh branch/)
  assert.throws(() => assertRetirementIdentityAvailable({ branch: 'codex/fresh', worktree: 'C:\\repos\\shared-db\\.claude\\worktrees\\agent-4101\\' }, io), /must use a fresh worktree/)
  // The successor's own fresh identity is unaffected.
  assert.equal(assertRetirementIdentityAvailable({ branch: 'codex/issue-4200', worktree: 'C:/repos/shared-db/.claude/worktrees/agent-4200' }, io), undefined)
})

test('#2301 identity normalisation treats separator, case and trailing slash as the same directory', () => {
  assert.equal(normalizeRetirementIdentity('C:\\Repos\\A\\'), normalizeRetirementIdentity('c:/repos/a'))
})

// --- wiring and API budget --------------------------------------------------

test('#2301 every claim-reactivation path consults the retirement guard', () => {
  // Source-level wiring check on purpose: the risk this step exists to remove is
  // a NEW mutation path that forgets the guard, and that is a property of the
  // call sites, not of any single behaviour a fixture can reach.
  //
  // DISCOVERED, never enumerated. A list of the paths that DO carry the guard can
  // never catch the path that forgot it, because a path nobody remembered to
  // guard is also a path nobody remembered to add to the list. An earlier version
  // of this test named five functions and passed while three others re-pointed
  // claims with no guard at all.
  //
  // The exemptions below are de-escalations. Each states why it must NOT refuse,
  // because an unexplained exemption is how the next hole gets waved through.
  const EXEMPT = {
    main: 'the CLI performs the retirement itself; guarding it would make --release-claim --retire refuse its own close',
    relinquishAuthorLease: 'relinquishing hands capacity back and never re-points or extends a lease; refusing it would strand a retired claim rather than protect it',
  }
  const population = [], unguarded = []
  for (const [name, fn] of Object.entries(lanes)) {
    if (typeof fn !== 'function' || Object.hasOwn(EXEMPT, name)) continue
    const source = fn.toString()
    // Reads a lease and writes the claim back: that is a claim mutation.
    if (!/parseAuthorLease/.test(source) || !/\.updateIssue\(/.test(source)) continue
    population.push(name)
    if (!/assertClaimNotRetired/.test(source)) unguarded.push(name)
  }
  assert.deepEqual(unguarded.sort(), [], 'every path that re-points or extends a claim must refuse a terminally retired version')
  // A discovery that finds nothing would pass the assertion above while checking
  // nothing at all, so the population itself is held to a floor.
  assert.ok(population.length >= 8, `discovery found only ${population.length} claim-mutating paths, so the discovery itself is broken`)
  for (const [name, fn] of Object.entries({ resumeAuthorLease, renewExpiredClaim, expandActiveClaimFromPr, expandActiveClaimFromIssue, recoverSameOwnerSplit, recoverExpiredClaimFromPr, supersedeActiveClaimVersion, reissueMergedStrandedClaim })) {
    assert.match(fn.toString(), /assertClaimNotRetired/, `${name} must refuse a terminally retired claim`)
  }
  assert.match(acquireAuthorLane.toString(), /assertRetirementIdentityAvailable/, 'acquiring a lane must refuse a retired branch or worktree')
})

// --- ordering, rollback and reporting --------------------------------------

const LEASE = { version: VERSION, objects: ['table core.x'], owner: 'a', branch: 'codex/issue-4101', worktree: 'C:/repos/shared-db/.claude/worktrees/agent-4101', expiresAt: new Date('2026-09-02T00:00:00Z') }
const NOW = new Date('2026-09-01T12:00:00Z')

function releaseIo({ closeThrows = false, refs, commits } = {}) {
  const io = fakeIo({ refs, commits })
  const events = []
  io.deleteRef = (ref) => { io.calls.deleteRef++; events.push(`delete:${ref}`); io.refs.delete(ref); return true }
  io.openClaims = () => [{ number: 4101, body: claimBody(LEASE) }]
  io.openPulls = () => []
  io.prSources = () => []
  io.closeClaim = (number, reason) => { events.push(`close:${number}`); if (closeThrows) throw new LaneError('GitHub refused the close'); io.closed = { number, reason } }
  const createRef = io.createRef
  io.createRef = (ref, sha) => { const ok = createRef(ref, sha); if (ok && ref.startsWith(RETIRED_CLAIM_REF_PREFIX)) events.push(`tombstone:${ref}`); return ok }
  io.events = events
  return io
}

const RETIRE_ARGV = ['--release-claim', '4101', '--owner', 'a', '--confirm-finished', '--retire', 'abandoned-worktree', '--pr', '4102', '--head-sha', HEAD, '--worktree-state', 'absent', '--evidence', 'https://github.com/u2giants/shared-db/issues/4101#issuecomment-1']

test('#2301 --release-claim --retire creates the tombstone BEFORE it closes the claim', () => {
  const io = releaseIo()
  assert.equal(main(RETIRE_ARGV, NOW, io), 0)
  assert.deepEqual(io.events.filter((e) => e.startsWith('tombstone:') || e.startsWith('close:')), [`tombstone:${retiredClaimRef(VERSION)}`, 'close:4101'])
  assert.equal(io.closed.number, 4101)
  assert.match(io.closed.reason, /terminal retirement/i)
})

test('#2301 a failed close leaves the tombstone standing and the identical retry finishes the job', () => {
  const io = releaseIo({ closeThrows: true })
  assert.notEqual(main(RETIRE_ARGV, NOW, io), 0)
  assert.ok(io.refs.get(retiredClaimRef(VERSION)), 'the terminal record must survive a failed close')
  assert.ok(!io.events.some((e) => e.startsWith(`delete:${RETIRED_CLAIM_REF_PREFIX}`)), 'rollback must never delete the tombstone')
  resetRetirementSnapshot()
  const retry = releaseIo({ refs: io.refs, commits: io.commits })
  assert.equal(main(RETIRE_ARGV, NOW, retry), 0)
  assert.equal(retry.closed.number, 4101)
})

test('#2301 retirement refuses without the exact PR, head SHA and worktree state it records', () => {
  for (const drop of ['--pr', '--head-sha', '--worktree-state']) {
    const argv = [...RETIRE_ARGV]
    argv.splice(argv.indexOf(drop), 2)
    resetRetirementSnapshot()
    assert.notEqual(main(argv, NOW, releaseIo()), 0, `retirement must refuse without ${drop}`)
  }
})

test('#2301 --retire refuses an unknown decision word at the command boundary', () => {
  const argv = [...RETIRE_ARGV]
  argv[argv.indexOf('abandoned-worktree')] = 'gave-up'
  assert.notEqual(main(argv, NOW, releaseIo()), 0)
})

test('#2301 an ordinary release is unchanged and writes no tombstone', () => {
  const io = releaseIo()
  assert.equal(main(['--release-claim', '4101', '--owner', 'a', '--confirm-finished'], NOW, io), 0)
  assert.equal(io.refs.get(retiredClaimRef(VERSION)), undefined)
  assert.ok(!/terminal retirement/i.test(io.closed.reason))
})

test('#2301 a reopened claim over a retired version is reported as RETIRED-REOPENED', () => {
  const io = withTombstone({ decision: 'superseded-by-successor', successor_issue: 4200 })
  const rows = retiredReopenedClaims([{ number: 4101, body: claimBody(LEASE) }], NOW, io)
  assert.deepEqual(rows, [{ status: 'RETIRED-REOPENED', claim: 4101, version: VERSION, branch: LEASE.branch, decision: 'superseded-by-successor', retiredClaim: 4101, successorIssue: 4200 }])
})

test('#2301 an open claim on a live version is never reported as reopened', () => {
  const io = withTombstone()
  assert.deepEqual(retiredReopenedClaims([{ number: 7, body: claimBody({ ...LEASE, version: '20261231235959', branch: 'codex/live', worktree: 'C:/live' }) }], NOW, io), [])
})

test('#2301 the mutex is not left held after a retirement', () => {
  const io = releaseIo()
  main(RETIRE_ARGV, NOW, io)
  assert.equal(io.refs.get(MUTEX_REF) ?? null, null)
})

test('#2301 a retirement audit costs ONE bounded ref listing, not one call per claim', () => {
  const io = fakeIo()
  createRetirementTombstone(record(), io)
  resetRetirementSnapshot()
  const before = io.calls.listRefs
  for (let n = 0; n < 40; n++) isVersionRetired(`2026090112${String(n).padStart(4, '0')}`, io)
  assert.equal(io.calls.listRefs - before, 1, '40 retirement questions must cost exactly one ref listing')
})
