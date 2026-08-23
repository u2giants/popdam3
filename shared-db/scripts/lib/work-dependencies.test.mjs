import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DependencyError, COMPLETION_SCHEMA_VERSION, SUCCESS_OUTCOMES, UNSUCCESSFUL_OUTCOMES,
  validateCompletionRecord, isSuccessful, parseCompletionComment, findCompletionRecord,
  findDependencyCycles, validateDependencyDeclaration, classifyDependency, classifyDependencies, COMPLETION_RECORD_REQUIRED_FROM,
} from './work-dependencies.mjs'

const merged = (over = {}) => ({
  schema_version: COMPLETION_SCHEMA_VERSION, work_issue: 10, outcome: 'merged',
  pr: 99, merge_sha: 'abc1234', migration_versions: ['20260823120000'], ...over,
})
const ruling = (over = {}) => ({
  schema_version: COMPLETION_SCHEMA_VERSION, work_issue: 10, outcome: 'owner-ruling-recorded',
  ruling_url: 'https://github.com/u2giants/shared-db/issues/1', resolved_by: 'https://github.com/u2giants/shared-db/commit/abc1234', ...over,
})
const comment = (record) => ({ body: '```db-work-completion\n' + JSON.stringify(record) + '\n```' })

// --- ONE SCHEMA, CONDITIONAL FIELDS ----------------------------------------

test('a merged completion must name pr, merge_sha and migration_versions', () => {
  assert.doesNotThrow(() => validateCompletionRecord(merged()))
  assert.throws(() => validateCompletionRecord(merged({ pr: undefined })), /must name its pr number/)
  assert.throws(() => validateCompletionRecord(merged({ merge_sha: undefined })), /must name the merge_sha/)
  assert.throws(() => validateCompletionRecord(merged({ merge_sha: 'nope' })), /must name the merge_sha/)
  assert.throws(() => validateCompletionRecord(merged({ migration_versions: undefined })), /must list migration_versions/)
  assert.throws(() => validateCompletionRecord(merged({ migration_versions: ['123'] })), /14-digit versions/)
  assert.doesNotThrow(() => validateCompletionRecord(merged({ migration_versions: [] })), 'a merge that adds no migration is normal')
})

// An owner ruling has no pull request. A schema that demanded `pr` everywhere
// could not express one, which is why Steps 3 and 4 originally disagreed.
test('an owner ruling needs no pr, but must link the ruling and how it was resolved', () => {
  assert.doesNotThrow(() => validateCompletionRecord(ruling()))
  assert.throws(() => validateCompletionRecord(ruling({ ruling_url: undefined })), /must link the durable ruling/)
  assert.throws(() => validateCompletionRecord(ruling({ resolved_by: '  ' })), /resolving commit or issue-comment URL/)
})

test('every unsuccessful outcome must carry a reason, because downstream work is told it', () => {
  for (const outcome of UNSUCCESSFUL_OUTCOMES) {
    assert.throws(() => validateCompletionRecord({ schema_version: 1, work_issue: 10, outcome }), /must give a reason/)
    assert.doesNotThrow(() => validateCompletionRecord({ schema_version: 1, work_issue: 10, outcome, reason: 'x' }))
  }
})

test('the envelope itself is validated', () => {
  assert.throws(() => validateCompletionRecord(null), /must be a JSON object/)
  assert.throws(() => validateCompletionRecord([]), /must be a JSON object/)
  assert.throws(() => validateCompletionRecord(merged({ schema_version: 2 })), /schema_version must be 1/)
  assert.throws(() => validateCompletionRecord(merged({ work_issue: 0 })), /positive issue number/)
  assert.throws(() => validateCompletionRecord(merged({ outcome: 'done' })), /outcome must be one of/)
})

test('only merged and owner-ruling-recorded count as success', () => {
  assert.deepEqual([...SUCCESS_OUTCOMES], ['merged', 'owner-ruling-recorded'])
  for (const outcome of SUCCESS_OUTCOMES) assert.equal(isSuccessful({ outcome }), true)
  for (const outcome of UNSUCCESSFUL_OUTCOMES) assert.equal(isSuccessful({ outcome }), false)
  assert.equal(isSuccessful(null), false)
})

// ADVISORY ONLY. A later forward correction does not make an earlier success
// false, so these pointers must never block anything by themselves.
test('invalidates and supersedes are optional advisory pointers, not blockers', () => {
  const record = validateCompletionRecord(merged({ invalidates: [7], supersedes: [8] }))
  assert.deepEqual(record.invalidates, [7])
  assert.equal(isSuccessful(record), true, 'an advisory pointer must not erase the success')
  assert.throws(() => validateCompletionRecord(merged({ invalidates: 7 })), /must be an array/)
  assert.throws(() => validateCompletionRecord(merged({ supersedes: [0] })), /positive issue numbers/)
})

// --- PARSING ---------------------------------------------------------------

test('a completion block is read out of surrounding prose', () => {
  assert.deepEqual(parseCompletionComment('before\n' + comment(merged()).body + '\nafter'), merged())
  assert.equal(parseCompletionComment('no fence here'), null)
  assert.equal(parseCompletionComment(undefined), null)
})

test('a malformed or duplicated block is an error, never a silent skip', () => {
  assert.throws(() => parseCompletionComment('```db-work-completion\n{nope}\n```'), /not valid JSON/)
  assert.throws(() => parseCompletionComment(comment(merged()).body + '\n' + comment(merged()).body), /exactly one db-work-completion block/)
})

// Completion is immutable. Quietly preferring one of two records would hide both
// a mistake and a deliberate attempt to overwrite an earlier completion record.
test('two completion records on one issue is an error, not latest-wins', () => {
  assert.throws(() => findCompletionRecord([comment(merged()), comment(merged({ pr: 100 }))]), /completion is immutable/)
  assert.equal(findCompletionRecord([{ body: 'chatter' }]), null)
  assert.deepEqual(findCompletionRecord([{ body: 'chatter' }, comment(merged())]), merged())
})

// --- DECLARATION AND CYCLES ------------------------------------------------

test('self-dependency and duplicate dependencies are refused', () => {
  assert.throws(() => validateDependencyDeclaration(5, [5]), /depends on itself/)
  assert.throws(() => validateDependencyDeclaration(5, [6, 6]), /duplicate dependencies: 6/)
  assert.deepEqual(validateDependencyDeclaration(5, [6, 7]), [6, 7])
})

// A cycle is invisible to an "is it open?" test: neither task is ever reported as
// permanently unstartable, so the pair just sits there.
test('cycles are found and the exact path is reported', () => {
  assert.deepEqual(findDependencyCycles({ 1: [2], 2: [1] })[0], [1, 2, 1])
  assert.deepEqual(findDependencyCycles({ 1: [2], 2: [3], 3: [1] })[0], [1, 2, 3, 1])
  assert.deepEqual(findDependencyCycles({ 1: [2], 2: [3] }), [], 'a chain is not a cycle')
  assert.deepEqual(findDependencyCycles({}), [])
})

test('one loop is reported once, not once per rotation', () => {
  assert.equal(findDependencyCycles({ 1: [2], 2: [3], 3: [1] }).length, 1)
})

test('a diamond is not a cycle', () => {
  assert.deepEqual(findDependencyCycles({ 1: [2, 3], 2: [4], 3: [4], 4: [] }), [])
})

// --- CLASSIFICATION: the whole point of the step ---------------------------

test('a dependency that never existed BLOCKS instead of releasing instantly', () => {
  // The old rule: a nonexistent issue is certainly not open, so a typo released
  // downstream work immediately.
  const result = classifyDependency(404, { exists: false })
  assert.equal(result.satisfied, false)
  assert.equal(result.status, 'invalid-dependency')
  assert.match(result.reason, /does not exist/)
})

test('a closed dependency with no completion record still BLOCKS', () => {
  const result = classifyDependency(10, { exists: true, open: false, comments: [] })
  assert.equal(result.satisfied, false)
  assert.equal(result.status, 'waiting')
  assert.match(result.reason, /closure alone is not success/)
})

test('every unsuccessful outcome blocks and names the outcome', () => {
  for (const outcome of UNSUCCESSFUL_OUTCOMES) {
    const record = { schema_version: 1, work_issue: 10, outcome, reason: 'because' }
    const result = classifyDependency(10, { exists: true, open: false, comments: [comment(record)] })
    assert.equal(result.satisfied, false, `${outcome} must not satisfy a dependency`)
    assert.equal(result.status, 'completed-unsuccessfully')
    assert.match(result.reason, new RegExp(outcome))
    assert.match(result.reason, /because/)
  }
})

test('a merged completion satisfies, and an owner ruling satisfies', () => {
  assert.equal(classifyDependency(10, { exists: true, open: false, comments: [comment(merged())], mergeInMain: true }).satisfied, true)
  assert.equal(classifyDependency(10, { exists: true, open: false, comments: [comment(ruling())] }).satisfied, true)
})

// The record is a claim. If main's history disagrees with it, the claim loses.
test('a merged completion whose commit is not in main is not satisfied', () => {
  const result = classifyDependency(10, { exists: true, open: false, comments: [comment(merged())], mergeInMain: false })
  assert.equal(result.satisfied, false)
  assert.equal(result.status, 'unknown')
  assert.match(result.reason, /not in main's history/)
})

test('an open dependency waits', () => {
  const result = classifyDependency(10, { exists: true, open: true })
  assert.equal(result.status, 'waiting')
})

// EVERY UNKNOWN IS A BLOCK. The failure this replaces was silence.
test('an unreadable dependency blocks and says nothing was checked', () => {
  const result = classifyDependency(10, { exists: true, unreadable: 'HTTP 500' })
  assert.equal(result.satisfied, false)
  assert.equal(result.status, 'unknown')
  assert.match(result.reason, /NOT "no dependency"/)
})

test('a completion record for the wrong issue blocks', () => {
  const result = classifyDependency(10, { exists: true, open: false, comments: [comment(merged({ work_issue: 11 }))] })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /carries a completion record for issue #11/)
})

test('an unusable completion record blocks rather than being ignored', () => {
  const result = classifyDependency(10, { exists: true, open: false, comments: [{ body: '```db-work-completion\n{bad}\n```' }] })
  assert.equal(result.status, 'unknown')
  assert.match(result.reason, /unusable completion record/)
})

test('classifyDependencies is satisfied only when every dependency is', () => {
  const states = {
    10: { exists: true, open: false, comments: [comment(merged())], mergeInMain: true },
    11: { exists: true, open: true },
  }
  assert.equal(classifyDependencies(1, [10], states).satisfied, true)
  const both = classifyDependencies(1, [10, 11], states)
  assert.equal(both.satisfied, false)
  assert.equal(both.blocked.length, 1)
  assert.equal(both.blocked[0].number, 11)
})

test('no dependencies means satisfied', () => {
  assert.equal(classifyDependencies(1, [], {}).satisfied, true)
  assert.equal(classifyDependencies(1, undefined, {}).satisfied, true)
})

test('DependencyError is the single error type callers catch', () => {
  assert.throws(() => validateCompletionRecord(null), DependencyError)
  assert.throws(() => validateDependencyDeclaration(5, [5]), DependencyError)
})

// --- THE GRANDFATHER CUTOFF -------------------------------------------------
//
// Completion records did not exist before the rule shipped. Blocking every
// dependency closed earlier would stall live work to enforce a rule it could not
// have followed. Grandfathered rows are SATISFIED but reported, so they stay
// countable instead of invisible.

test('a dependency closed before the cutoff is satisfied and reported as grandfathered', () => {
  const result = classifyDependency(10, { exists: true, open: false, closedAt: '2026-08-01T00:00:00Z', comments: [] })
  assert.equal(result.satisfied, true)
  assert.equal(result.status, 'grandfathered')
  assert.match(result.reason, /before completion records were required/)
})

test('a dependency closed after the cutoff still needs proof', () => {
  const result = classifyDependency(10, { exists: true, open: false, closedAt: '2026-09-01T00:00:00Z', comments: [] })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /closure alone is not success/)
})

test('an unknown close date is NOT grandfathered, because absence of a date is not proof of age', () => {
  assert.equal(classifyDependency(10, { exists: true, open: false, comments: [] }).satisfied, false)
  assert.equal(classifyDependency(10, { exists: true, open: false, closedAt: null, comments: [] }).satisfied, false)
})

// The cutoff excuses a MISSING record. It never excuses a record that says the
// work did not succeed.
test('the cutoff never rescues an unsuccessful outcome', () => {
  const cancelled = { schema_version: 1, work_issue: 10, outcome: 'cancelled', reason: 'dropped' }
  const result = classifyDependency(10, {
    exists: true, open: false, closedAt: '2026-08-01T00:00:00Z',
    comments: [{ body: '```db-work-completion\n' + JSON.stringify(cancelled) + '\n```' }],
  })
  assert.equal(result.satisfied, false)
  assert.equal(result.status, 'completed-unsuccessfully')
})
