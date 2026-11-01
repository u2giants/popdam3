import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MergeQueueError,
  MergeQueueModeUnknown,
  PREVIEW_REHEARSAL_CONTEXT,
  QUEUE_RULE,
  REQUIRED_STATUS_CHECKS_RULE,
  REQUIRED_STATUS_CHECK_CONTEXTS,
  RULESET_NAME,
  assertOldestMigration,
  assertProductionInterlock,
  assertQueueAuthorizationCurrent,
  awaitPreviewRehearsal,
  baseNeedsPreview,
  previewRehearsalTarget,
  checkQueueOrder,
  latestContextState,
  main as contractMain,
  migrationVersions,
  pullRequestFromQueueRef,
  queueMode,
  queueRulesetMatches,
  queueParametersEqual,
  requiredStatusChecksEqual,
  readOpenPullRequests,
  readPullRequestFiles,
  recheckQueueInterlock,
  rehearsalState,
  resolveAuthorizedHead,
  verifyQueuePullRequest,
} from './merge-queue-contract.mjs'

const REPO = 'acme/widgets'

test('extracts exactly one PR from a GitHub merge queue ref', () => {
  assert.equal(pullRequestFromQueueRef('refs/heads/gh-readonly-queue/main/pr-1435-deadbeef'), 1435)
  assert.equal(pullRequestFromQueueRef('gh-readonly-queue/main/pr-3267-0123abcd'), 3267)
  assert.throws(() => pullRequestFromQueueRef('refs/heads/main'), /expected exactly one pull request/)
  assert.throws(() => pullRequestFromQueueRef(''), /expected exactly one pull request/)
  assert.throws(() => pullRequestFromQueueRef('gh-readonly-queue/main/pr-12-aaa/pr-34-bbb'), /expected exactly one pull request/)
})

test('queue-ref PR identity is independently verified against live PR shape', () => {
  const row = { number: 1435, state: 'OPEN', baseRefName: 'main', headRefOid: 'a'.repeat(40) }
  assert.equal(verifyQueuePullRequest(1435, row), 1435)
  assert.throws(() => verifyQueuePullRequest(1436, row), /different pull request/)
  assert.throws(() => verifyQueuePullRequest(1435, { ...row, state: 'MERGED' }), /not open/)
  assert.throws(() => verifyQueuePullRequest(1435, { ...row, baseRefName: 'develop' }), /base is not main/)
  assert.throws(() => verifyQueuePullRequest(1435, { ...row, headRefOid: 'xyz' }), /head SHA is unreadable/)
})

test('REST pagination is slurped and flattened without a 100-row window', () => {
  const read = (args) => {
    assert.ok(args.includes('--slurp'))
    if (args.at(-1).includes('/files?')) return [[{ filename: 'README.md' }], [{ filename: 'docs/x.md' }]]
    return [[{ number: 1, draft: false }], [{ number: 2, draft: true }]]
  }
  assert.deepEqual(readPullRequestFiles(1, { repo: REPO, read }), ['README.md', 'docs/x.md'])
  assert.deepEqual(readOpenPullRequests({ repo: REPO, read }), [
    { number: 1, isDraft: false, files: ['README.md', 'docs/x.md'] },
    { number: 2, isDraft: true, files: ['README.md', 'docs/x.md'] },
  ])
})

test('a malformed page shape is refused, never flattened away', () => {
  const bad = () => ({ unexpected: true })
  assert.throws(() => readPullRequestFiles(1, { repo: REPO, read: bad }), /pagination is unreadable/)
  assert.throws(() => readOpenPullRequests({ repo: REPO, read: bad }), /pagination is unreadable/)
})

test('the 3,000-file coverage ceiling is a refusal, not a complete list', () => {
  const files = Array.from({ length: 3000 }, (_, i) => ({ filename: `f${i}.sql` }))
  const read = () => [files]
  assert.throws(() => readPullRequestFiles(1, { repo: REPO, read }), /3000-file coverage limit/)
})

test('migration versions are exact, unique, and ordered', () => {
  assert.deepEqual(migrationVersions([
    'supabase/migrations/20260825120001_b.sql',
    'docs/x.md',
    'supabase/migrations/20260825120000_a.sql',
    'supabase/migrations/not-a-version.sql',
  ]), ['20260825120000', '20260825120001'])
})

test('oldest open migration PR must enter first', () => {
  const candidate = ['supabase/migrations/20260825120002_candidate.sql']
  assert.throws(() => assertOldestMigration(20, candidate, [
    { number: 19, isDraft: false, files: ['supabase/migrations/20260825120001_older.sql'] },
  ]), /behind open PR #19/)
  assert.equal(assertOldestMigration(20, candidate, [
    { number: 19, isDraft: true, files: ['supabase/migrations/20260825120001_older.sql'] },
    { number: 21, isDraft: false, files: ['supabase/migrations/20260825120003_newer.sql'] },
  ]).relevant, true)
  // The candidate never blocks itself.
  assert.equal(assertOldestMigration(20, candidate, [
    { number: 20, isDraft: false, files: candidate },
  ]).relevant, true)
})

test('non-migration PRs do not participate and migration merges require preview', () => {
  assert.equal(assertOldestMigration(20, ['README.md'], []).relevant, false)
  assert.equal(baseNeedsPreview(['README.md']), false)
  assert.equal(baseNeedsPreview(['supabase/migrations/20260825120000_x.sql']), true)
})

test('checkQueueOrder wires candidate files and open PRs through the reader', () => {
  const read = (args) => {
    const target = args.at(-1)
    if (target.includes('pulls?state=open')) return [[{ number: 9, draft: false }]]
    if (target.includes('pulls/9/files')) return [[{ filename: 'supabase/migrations/20260825120001_old.sql' }]]
    return [[{ filename: 'supabase/migrations/20260825120002_new.sql' }]]
  }
  assert.throws(() => checkQueueOrder(10, { repo: REPO, read }), /behind open PR #9/)
})

// ---------------------------------------------------------------------------
// Queue-mode detection
// ---------------------------------------------------------------------------

const approvedDetail = {
  name: RULESET_NAME,
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters } }, { type: 'required_status_checks', parameters: { ...REQUIRED_STATUS_CHECKS_RULE.parameters, required_status_checks: [...REQUIRED_STATUS_CHECKS_RULE.parameters.required_status_checks] } }],
}

test('the approved rule is exactly one all-green PR built and merged at a time', () => {
  assert.deepEqual(QUEUE_RULE.parameters, {
    check_response_timeout_minutes: 90,
    grouping_strategy: 'ALLGREEN',
    max_entries_to_build: 1,
    max_entries_to_merge: 1,
    merge_method: 'MERGE',
    min_entries_to_merge: 1,
    min_entries_to_merge_wait_minutes: 0,
  })
  assert.equal(REQUIRED_STATUS_CHECK_CONTEXTS.length, 3)
  assert.equal(REQUIRED_STATUS_CHECKS_RULE.parameters.required_status_checks.length, 3)
  assert.ok(!REQUIRED_STATUS_CHECK_CONTEXTS.includes('Merge queue gate'))
  assert.ok(!REQUIRED_STATUS_CHECK_CONTEXTS.includes('Migration guarded merge authorization'))
  assert.ok(!REQUIRED_STATUS_CHECK_CONTEXTS.includes('Queue-sensitive checks (aggregate)'))
  assert.equal(queueRulesetMatches(approvedDetail), true)
  assert.equal(queueRulesetMatches({ ...approvedDetail, enforcement: 'evaluate' }), false)
  assert.equal(queueRulesetMatches({ ...approvedDetail, conditions: { ref_name: { include: ['refs/heads/develop'] } } }), false)
  assert.equal(queueRulesetMatches({ ...approvedDetail, rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters, max_entries_to_build: 2 } }, REQUIRED_STATUS_CHECKS_RULE] }), false)
  // A merge_queue-only ruleset is not the approved dual-rule shape (#2530).
  assert.equal(queueRulesetMatches({ ...approvedDetail, rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters } }] }), false)
  // required_status_checks drift (missing context) refuses.
  assert.equal(queueRulesetMatches({
    ...approvedDetail,
    rules: [
      { type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters } },
      { type: 'required_status_checks', parameters: { ...REQUIRED_STATUS_CHECKS_RULE.parameters, required_status_checks: [{ context: 'only-one' }] } },
    ],
  }), false)
})

test('queue mode: active only for the exact approved ruleset', () => {
  const read = (args) => {
    const target = args.at(-1)
    if (target.endsWith('includes_parents=false')) return [{ id: 42, name: RULESET_NAME, enforcement: 'active' }]
    if (target.endsWith('rulesets/42')) return approvedDetail
    throw new Error(`unexpected read ${target}`)
  }
  assert.equal(queueMode({ repo: REPO, read }), 'active')
})

test('queue mode: inactive when no rulesets exist or the named one is disabled', () => {
  assert.equal(queueMode({ repo: REPO, read: () => [] }), 'inactive')
  const read = (args) => {
    const target = args.at(-1)
    if (target.endsWith('includes_parents=false')) return [{ id: 42, name: RULESET_NAME, enforcement: 'disabled' }]
    if (target.endsWith('rulesets/42')) return { ...approvedDetail, enforcement: 'disabled' }
    throw new Error(`unexpected read ${target}`)
  }
  assert.equal(queueMode({ repo: REPO, read }), 'inactive')
})

test('queue mode: unknown, never guessed, on duplicates, foreign queues, or shape drift', () => {
  const dup = () => [{ id: 1, name: RULESET_NAME, enforcement: 'active' }, { id: 2, name: RULESET_NAME, enforcement: 'active' }]
  assert.throws(() => queueMode({ repo: REPO, read: dup }), MergeQueueModeUnknown)

  const foreign = (args) => {
    const target = args.at(-1)
    if (target.endsWith('includes_parents=false')) return [{ id: 7, name: 'someone elses queue', enforcement: 'active' }]
    if (target.endsWith('rulesets/7')) {
      return { name: 'someone elses queue', enforcement: 'active', conditions: { ref_name: { include: ['~ALL'] } }, rules: [{ type: 'merge_queue' }] }
    }
    throw new Error(`unexpected read ${target}`)
  }
  assert.throws(() => queueMode({ repo: REPO, read: foreign }), /DIFFERENT active ruleset/)

  const drifted = (args) => {
    const target = args.at(-1)
    if (target.endsWith('includes_parents=false')) return [{ id: 42, name: RULESET_NAME, enforcement: 'active' }]
    if (target.endsWith('rulesets/42')) return { ...approvedDetail, rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters, grouping_strategy: 'HEADGREEN' } }, REQUIRED_STATUS_CHECKS_RULE] }
    throw new Error(`unexpected read ${target}`)
  }
  assert.throws(() => queueMode({ repo: REPO, read: drifted }), /not the exact approved one-PR queue/)

  const emptyActive = (args) => {
    const target = args.at(-1)
    if (target.endsWith('includes_parents=false')) return [{ id: 43, name: RULESET_NAME, enforcement: 'active' }]
    if (target.endsWith('rulesets/43')) return { ...approvedDetail, rules: [] }
    throw new Error(`unexpected read ${target}`)
  }
  assert.throws(() => queueMode({ repo: REPO, read: emptyActive }), /not the exact approved one-PR queue/)
})

// ---------------------------------------------------------------------------
// Shared-preview hold
// ---------------------------------------------------------------------------

const SHA = 'b'.repeat(40)

test('rehearsal state is the LATEST status for the exact context', () => {
  assert.equal(rehearsalState([]), null)
  assert.equal(rehearsalState([
    { context: PREVIEW_REHEARSAL_CONTEXT, state: 'failure', created_at: '2026-09-18T00:00:00Z', id: 1 },
    { context: PREVIEW_REHEARSAL_CONTEXT, state: 'success', created_at: '2026-09-18T01:00:00Z', id: 2 },
    { context: 'unrelated', state: 'failure', created_at: '2026-09-18T02:00:00Z', id: 3 },
  ]), 'success')
  // Array order must not win: newer failure listed first still wins.
  assert.equal(rehearsalState([
    { context: PREVIEW_REHEARSAL_CONTEXT, state: 'failure', created_at: '2026-09-18T02:00:00Z', id: 2 },
    { context: PREVIEW_REHEARSAL_CONTEXT, state: 'success', created_at: '2026-09-18T01:00:00Z', id: 1 },
  ]), 'failure')
})

test('the hold releases on success, waits on pending, and refuses failure', async () => {
  const noSleep = async () => {}
  assert.equal((await awaitPreviewRehearsal({ sha: SHA, budgetMs: 1000, readStatuses: async () => [{ context: PREVIEW_REHEARSAL_CONTEXT, state: 'success', created_at: '2026-09-18T01:00:00Z', id: 1 }], sleep: noSleep })).state, 'success')

  let polls = 0
  const pendingThenSuccess = async () => (++polls === 3 ? [{ context: PREVIEW_REHEARSAL_CONTEXT, state: 'success', created_at: '2026-09-18T01:00:00Z', id: 3 }] : [{ context: PREVIEW_REHEARSAL_CONTEXT, state: 'pending', created_at: '2026-09-18T00:00:00Z', id: polls }])
  assert.equal((await awaitPreviewRehearsal({ sha: SHA, budgetMs: 100000, intervalMs: 1, readStatuses: pendingThenSuccess, sleep: noSleep })).state, 'success')
  assert.equal(polls, 3)

  await assert.rejects(
    awaitPreviewRehearsal({ sha: SHA, budgetMs: 1000, readStatuses: async () => [{ context: PREVIEW_REHEARSAL_CONTEXT, state: 'failure', created_at: '2026-09-18T01:00:00Z', id: 1 }], sleep: noSleep }),
    /is failure; recover preview/,
  )
  await assert.rejects(
    awaitPreviewRehearsal({ sha: SHA, budgetMs: 10, intervalMs: 100, readStatuses: async () => [], sleep: noSleep }),
    /did not complete a successful post-merge preview rehearsal/,
  )
  await assert.rejects(
    awaitPreviewRehearsal({ sha: 'not-a-sha', budgetMs: 10, readStatuses: async () => [], sleep: noSleep }),
    MergeQueueError,
  )
})

// ---------------------------------------------------------------------------
// Queue authorization interlock (workflow-refactor closeout §5)
// ---------------------------------------------------------------------------
//
// THE RACE THESE TESTS PIN. Admission under the merge lock releases that lock
// after queue admission. The merge-group path may then wait up to 25 minutes
// for preview rehearsal. A production freeze in that window revokes the PR-head
// authorization and takes the production lane. Carrying the pre-wait success
// forward would post group-SHA success and let GitHub merge under the freeze.
// The interlock re-check must refuse, and the authorize path must hold the
// merge lane through the actual mutation.

test('a production freeze refuses queue authorization at the mutation point', () => {
  assert.equal(assertProductionInterlock({ productionHeld: false }), true)
  assert.throws(
    () => assertProductionInterlock({ productionHeld: true }),
    /production promotion is active; queue authorization is frozen/,
  )
})

test('a revoked PR-head authorization refuses queue authorization at the mutation point', () => {
  assert.equal(assertQueueAuthorizationCurrent('success'), true)
  // Production freeze posts state=failure on every open PR head.
  assert.throws(() => assertQueueAuthorizationCurrent('failure'), /no live successful guarded merge authorization/)
  assert.throws(() => assertQueueAuthorizationCurrent('pending'), /no live successful guarded merge authorization/)
  assert.throws(() => assertQueueAuthorizationCurrent('error'), /no live successful guarded merge authorization/)
  assert.throws(() => assertQueueAuthorizationCurrent(null), /no live successful guarded merge authorization/)
  assert.throws(() => assertQueueAuthorizationCurrent(undefined), /no live successful guarded merge authorization/)
})

test('admission -> production freeze/revocation -> queue authorization refuses (the named interleaving)', () => {
  // T0: guarded merge posted success on the PR head and admitted to the queue.
  const atAdmission = { headState: 'success', productionHeld: false }
  assert.equal(recheckQueueInterlock(atAdmission).authorized, true)

  // T1: production freeze revoked the PR-head status during the preview wait.
  assert.throws(
    () => recheckQueueInterlock({ headState: 'failure', productionHeld: false }),
    /no live successful guarded merge authorization/,
  )

  // T1b: production freeze holds the production lane (revocation may lag).
  assert.throws(
    () => recheckQueueInterlock({ headState: 'success', productionHeld: true }),
    /production promotion is active/,
  )

  // T1c: both — the production interlock is judged first and names the freeze.
  assert.throws(
    () => recheckQueueInterlock({ headState: 'failure', productionHeld: true }),
    /production promotion is active/,
  )

  // T2: freeze lifted and guarded merge re-authorized — the mutation may proceed.
  assert.equal(recheckQueueInterlock({ headState: 'success', productionHeld: false }).authorized, true)
})

test('the interlock never treats an unreadable authorization as green', () => {
  for (const headState of ['', 'SUCCESS', 'Success', 'success ', ' none', 0, false, {}]) {
    assert.throws(() => assertQueueAuthorizationCurrent(headState), MergeQueueError, `headState=${JSON.stringify(headState)} must refuse`)
  }
})

// ---------------------------------------------------------------------------
// Newest-by-timestamp status selection (REVISE finding: order-trust is fail-open)
// ---------------------------------------------------------------------------

test('latestContextState picks newest by timestamp/id, never array order', () => {
  const ctx = 'Migration guarded merge authorization'
  // Admission success listed AFTER freeze failure: the newer failure must win.
  assert.equal(latestContextState([
    { context: ctx, state: 'failure', created_at: '2026-09-23T02:00:00Z', id: 2 },
    { context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1 },
  ], ctx), 'failure')
  // Same, opposite listing order.
  assert.equal(latestContextState([
    { context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1 },
    { context: ctx, state: 'failure', created_at: '2026-09-23T02:00:00Z', id: 2 },
  ], ctx), 'failure')
  // Tie on timestamp: higher id wins.
  assert.equal(latestContextState([
    { context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1 },
    { context: ctx, state: 'failure', created_at: '2026-09-23T01:00:00Z', id: 2 },
  ], ctx), 'failure')
  // Unrelated contexts ignored; empty means none (hold, not pass).
  assert.equal(latestContextState([
    { context: 'other', state: 'success', created_at: '2026-09-23T03:00:00Z', id: 9 },
  ], ctx), null)
  assert.equal(latestContextState([], ctx), null)
})

test('latestContextState refuses malformed or duplicate status histories', () => {
  const ctx = 'Migration guarded merge authorization'
  assert.throws(() => latestContextState(null, ctx), /unreadable/)
  // created_at is REQUIRED (selectNewestCommitStatus contract): missing or
  // unparsable refuse — never collapse to epoch 0 and keep array order.
  assert.throws(() => latestContextState([{ context: ctx, state: 'success', created_at: 'nope', id: 1 }], ctx), /malformed ordering metadata/)
  assert.throws(() => latestContextState([{ context: ctx, state: 'success', id: 1 }], ctx), /malformed ordering metadata/)
  // id is REQUIRED as a positive safe integer.
  assert.throws(() => latestContextState([{ context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z' }], ctx), /malformed ordering metadata/)
  assert.throws(() => latestContextState([{ context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 0 }], ctx), /malformed ordering metadata/)
  assert.throws(() => latestContextState([{ context: ctx, state: 'green', created_at: '2026-09-23T01:00:00Z', id: 1 }], ctx), /malformed ordering metadata/)
  assert.throws(() => latestContextState([
    { context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1 },
    { context: ctx, state: 'failure', created_at: '2026-09-23T02:00:00Z', id: 1 },
  ], ctx), /duplicate identities/)
})

test('--recheck-interlock CLI uses newest status and fail-closed production 404 matching', async () => {
  const headSha = 'a'.repeat(40)
  const ctx = 'Migration guarded merge authorization'
  const logs = []
  const originalLog = console.log
  console.log = (msg) => logs.push(String(msg))
  try {
    // Newest row is failure even though success is listed last: must refuse.
    // Read path is the PAGINATED /statuses collection (`--paginate --slurp`).
    const readOrderTrap = (args) => {
      const url = String(args.at(-1) ?? '')
      if (url.includes('/statuses')) {
        assert.ok(args.includes('--paginate') && args.includes('--slurp'), 'status history must be read paginated')
        return [[
          { context: ctx, state: 'failure', created_at: '2026-09-23T02:00:00Z', id: 2 },
          { context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1 },
        ]]
      }
      throw new Error('HTTP 404 Not Found')
    }
    await assert.rejects(
      contractMain(['--recheck-interlock', '--head-sha', headSha], {}, { read: readOrderTrap }),
      /no live successful guarded merge authorization \(state: failure\)/,
    )

    // Newest success + production 404-shaped free lane: authorizes.
    const readFree = (args) => {
      const url = String(args.at(-1) ?? '')
      if (url.includes('/statuses')) {
        return [[{ context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1, description: 'ok' }]]
      }
      throw new Error('Not Found')
    }
    logs.length = 0
    assert.equal(await contractMain(['--recheck-interlock', '--head-sha', headSha], {}, { read: readFree }), 0)
    assert.match(logs.at(-1) ?? '', /"authorized":true/)

    // Bare "Not Found" without 404 digits is still free (aligned with configure-merge-queue).
    logs.length = 0
    assert.equal(await contractMain(['--recheck-interlock', '--head-sha', headSha], {}, { read: readFree }), 0)

    // A non-404 production-ref read failure is fail-closed, never "free".
    const readBlowup = (args) => {
      const url = String(args.at(-1) ?? '')
      if (url.includes('/statuses')) {
        return [[{ context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1 }]]
      }
      throw new Error('HTTP 500 upstream')
    }
    await assert.rejects(
      contractMain(['--recheck-interlock', '--head-sha', headSha], {}, { read: readBlowup }),
      /production interlock is unreadable/,
    )

    // --authorization-state prints the newest state only.
    logs.length = 0
    assert.equal(await contractMain(['--authorization-state', '--head-sha', headSha], {}, { read: readOrderTrap }), 0)
    assert.equal(logs.at(-1), 'failure')

    // --authorization-row prints newest state|description for freeze-lift matching.
    logs.length = 0
    assert.equal(await contractMain(['--authorization-row', '--head-sha', headSha], {}, {
      read: (args) => {
        const url = String(args.at(-1) ?? '')
        if (url.includes('/statuses')) {
          return [[
            { context: ctx, state: 'failure', created_at: '2026-09-23T02:00:00Z', id: 2, description: 'Revoked by production freeze run 9; re-run guarded-migration-merge.yml' },
            { context: ctx, state: 'success', created_at: '2026-09-23T01:00:00Z', id: 1, description: 'ok' },
          ]]
        }
        throw new Error('Not Found')
      },
    }), 0)
    assert.equal(logs.at(-1), 'failure|Revoked by production freeze run 9; re-run guarded-migration-merge.yml')

    // No rows: none| with empty description.
    logs.length = 0
    assert.equal(await contractMain(['--authorization-row', '--head-sha', headSha], {}, {
      read: (args) => {
        const url = String(args.at(-1) ?? '')
        if (url.includes('/statuses')) return [[]]
        throw new Error('Not Found')
      },
    }), 0)
    assert.equal(logs.at(-1), 'none|')
  } finally {
    console.log = originalLog
  }
})

// #3566: GitHub read back ruleset 24024180 with identical values in ITS key order;
// JSON-string comparison refused the live approved queue.
const GITHUB_ORDER_PARAMETERS = { merge_method: 'MERGE', max_entries_to_build: 1, min_entries_to_merge: 1, max_entries_to_merge: 1, min_entries_to_merge_wait_minutes: 0, grouping_strategy: 'ALLGREEN', check_response_timeout_minutes: 90 }

test('queue parameters compare by key and value, not by key order (#3566)', () => {
  assert.notEqual(JSON.stringify(GITHUB_ORDER_PARAMETERS), JSON.stringify(QUEUE_RULE.parameters), 'fixture must reproduce the differing order')
  assert.equal(queueParametersEqual(GITHUB_ORDER_PARAMETERS), true)
  assert.equal(queueRulesetMatches({ ...approvedDetail, rules: [{ type: 'merge_queue', parameters: GITHUB_ORDER_PARAMETERS }, REQUIRED_STATUS_CHECKS_RULE] }), true)
  assert.equal(queueParametersEqual({ ...GITHUB_ORDER_PARAMETERS, max_entries_to_build: 2 }), false)
  assert.equal(queueParametersEqual({ ...GITHUB_ORDER_PARAMETERS, extra: 1 }), false)
  const { grouping_strategy, ...absent } = GITHUB_ORDER_PARAMETERS
  assert.equal(queueParametersEqual(absent), false)
  assert.equal(queueParametersEqual({ ...GITHUB_ORDER_PARAMETERS, max_entries_to_build: '1' }), false)
  assert.equal(queueParametersEqual(null), false)
  assert.equal(queueParametersEqual([]), false)
})

test('required_status_checks compare: policy flags exact, contexts by name set, integration_id when echoed', () => {
  const expected = REQUIRED_STATUS_CHECKS_RULE.parameters
  assert.equal(requiredStatusChecksEqual(expected), true)
  // GitHub key order / echoed integration_id still matches.
  assert.equal(requiredStatusChecksEqual({
    strict_required_status_checks_policy: false,
    do_not_enforce_on_create: false,
    required_status_checks: expected.required_status_checks.map((r) => ({ integration_id: r.integration_id, context: r.context })),
  }), true)
  // Absent integration_id is tolerated.
  assert.equal(requiredStatusChecksEqual({
    ...expected,
    required_status_checks: expected.required_status_checks.map((r) => ({ context: r.context })),
  }), true)
  assert.equal(requiredStatusChecksEqual({ ...expected, strict_required_status_checks_policy: true }), false)
  assert.equal(requiredStatusChecksEqual({ ...expected, do_not_enforce_on_create: true }), false)
  assert.equal(requiredStatusChecksEqual({ ...expected, required_status_checks: expected.required_status_checks.slice(1) }), false)
  assert.equal(requiredStatusChecksEqual({
    ...expected,
    required_status_checks: expected.required_status_checks.map((r) => (r.context === 'SQL migration guards' ? { context: 'SQL migration guards', integration_id: 999 } : r)),
  }), false)
  assert.equal(requiredStatusChecksEqual(null), false)
  assert.equal(requiredStatusChecksEqual([]), false)
})

// Authorized head under the verifyGitEvidence ancestor+tail rule (canary #4321).
// Authorization binds to the implementation commit; the live tip may carry only
// this PR's own evidence pair after it.
test('resolveAuthorizedHead: the tip itself when it carries authorization', () => {
  const tip = 'a'.repeat(40)
  const resolved = resolveAuthorizedHead(tip, {
    isAncestor: () => true,
    changedFiles: () => [],
    firstParent: () => 'b'.repeat(40),
    readAuthorizationState: (sha) => (sha === tip ? 'success' : 'none'),
  })
  assert.deepEqual(resolved, { authorizedHead: tip, evidenceTail: [], mode: 'exact' })
})

test('resolveAuthorizedHead: implementation head when the tip is a pure evidence tail', () => {
  const impl = '1'.repeat(40)
  const tip = '2'.repeat(40)
  const pair = [
    '.agent/work/2530/7/completion.json',
    '.agent/work/2530/7/contract.json',
  ]
  const resolved = resolveAuthorizedHead(tip, {
    isAncestor: (ancestor, descendant) => ancestor === impl && descendant === tip,
    changedFiles: (from, to) => (from === impl && to === tip ? pair : []),
    firstParent: (sha) => (sha === tip ? impl : null),
    readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
  })
  assert.equal(resolved.authorizedHead, impl)
  assert.equal(resolved.mode, 'evidence-tail')
  assert.deepEqual(resolved.evidenceTail, pair)
})

test('resolveAuthorizedHead: legacy evidence pair is also a lawful tail', () => {
  const impl = '3'.repeat(40)
  const tip = '4'.repeat(40)
  const pair = ['.agent/completion.json', '.agent/contract.json']
  const resolved = resolveAuthorizedHead(tip, {
    isAncestor: () => true,
    changedFiles: () => pair,
    firstParent: (sha) => (sha === tip ? impl : null),
    readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
  })
  assert.equal(resolved.authorizedHead, impl)
  assert.equal(resolved.mode, 'evidence-tail')
})

test('resolveAuthorizedHead: refuses a non-evidence tail over an authorized parent', () => {
  const impl = '5'.repeat(40)
  const tip = '6'.repeat(40)
  assert.throws(
    () => resolveAuthorizedHead(tip, {
      isAncestor: () => true,
      changedFiles: () => ['scripts/merge-queue-contract.mjs'],
      firstParent: (sha) => (sha === tip ? impl : null),
      readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
    }),
    /no authorized PR head found/,
  )
})

test('resolveAuthorizedHead: refuses a complete pair plus an extra non-evidence file', () => {
  const impl = 'a'.repeat(40)
  const tip = 'b'.repeat(40)
  assert.throws(
    () => resolveAuthorizedHead(tip, {
      isAncestor: () => true,
      changedFiles: () => ['.agent/completion.json', '.agent/contract.json', 'scripts/merge-queue-contract.mjs'],
      firstParent: (sha) => (sha === tip ? impl : null),
      readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
    }),
    /no authorized PR head found/,
  )
})

test('resolveAuthorizedHead: refuses a complete pair plus an extra .agent file', () => {
  const impl = 'c'.repeat(40)
  const tip = 'd'.repeat(40)
  assert.throws(
    () => resolveAuthorizedHead(tip, {
      isAncestor: () => true,
      changedFiles: () => ['.agent/completion.json', '.agent/contract.json', '.agent/work/2530/1/completion.json'],
      firstParent: (sha) => (sha === tip ? impl : null),
      readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
    }),
    /no authorized PR head found/,
  )
})

test('resolveAuthorizedHead: refuses when neither tip nor parent is authorized', () => {
  const impl = '7'.repeat(40)
  const tip = '8'.repeat(40)
  assert.throws(
    () => resolveAuthorizedHead(tip, {
      isAncestor: () => true,
      changedFiles: () => [],
      firstParent: (sha) => (sha === tip ? impl : null),
      readAuthorizationState: () => 'failure',
    }),
    /no authorized PR head found/,
  )
})

test('resolveAuthorizedHead: refuses a malformed tip and missing IO', () => {
  assert.throws(() => resolveAuthorizedHead('nope', {
    isAncestor: () => true, changedFiles: () => [], firstParent: () => null, readAuthorizationState: () => 'success',
  }), /40-character live tip/)
  assert.throws(() => resolveAuthorizedHead('a'.repeat(40), {}), /requires isAncestor/)
})

test('resolveAuthorizedHead: refuses a keyed pair from another work issue when workIssue is bound', () => {
  const impl = '9'.repeat(40)
  const tip = 'a1'.repeat(20)
  const foreign = ['.agent/work/9999/1/completion.json', '.agent/work/9999/1/contract.json']
  assert.throws(
    () => resolveAuthorizedHead(tip, {
      isAncestor: () => true,
      changedFiles: () => foreign,
      firstParent: (sha) => (sha === tip ? impl : null),
      readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
      workIssue: 2530,
    }),
    /no authorized PR head found/,
  )
  const own = ['.agent/work/2530/9/completion.json', '.agent/work/2530/9/contract.json']
  const ok = resolveAuthorizedHead(tip, {
    isAncestor: () => true,
    changedFiles: () => own,
    firstParent: (sha) => (sha === tip ? impl : null),
    readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
    workIssue: 2530,
  })
  assert.equal(ok.mode, 'evidence-tail')
})

test('resolveAuthorizedHead: empty tree span over an authorized ancestor is mode=ancestor, never exact', () => {
  const impl = 'b1'.repeat(20)
  const tip = 'c1'.repeat(20)
  const resolved = resolveAuthorizedHead(tip, {
    isAncestor: () => true,
    changedFiles: () => [],
    firstParent: (sha) => (sha === tip ? impl : null),
    readAuthorizationState: (sha) => (sha === impl ? 'success' : 'none'),
  })
  assert.equal(resolved.authorizedHead, impl)
  assert.equal(resolved.mode, 'ancestor')
  assert.notEqual(resolved.authorizedHead, tip)
})


test('maintenance can repair evidence while a later migration retains the pending first-parent rehearsal', () => {
  const baseSha = 'a'.repeat(40), groupSha = 'b'.repeat(40), pending = 'c'.repeat(40)
  const calls = []
  const git = (paths, latest = pending) => (args) => {
    calls.push(args)
    if (args[0] === 'diff') return paths
    if (args[0] === 'log') return latest
    return ''
  }
  assert.equal(previewRehearsalTarget({ baseSha, groupSha }, git('scripts/repair.mjs\nREADME.md')), null)
  assert.equal(calls.some((args) => args[0] === 'log'), false)
  calls.length = 0
  assert.equal(previewRehearsalTarget({ baseSha, groupSha }, git('supabase/migrations/20261025125632_next.sql')), pending)
  assert.deepEqual(calls.find((args) => args[0] === 'log'), ['log', '--first-parent', '-1', '--format=%H', baseSha, '--', 'supabase/migrations/'])
  assert.deepEqual(calls.at(-1), ['merge-base', '--is-ancestor', pending, baseSha])
  assert.throws(() => previewRehearsalTarget({ baseSha, groupSha }, git('supabase/migrations/20261025125632_next.sql', '')), /unavailable/)
  assert.throws(() => previewRehearsalTarget({ baseSha: 'main', groupSha }, git('')), /exact/)
  assert.throws(() => previewRehearsalTarget({ baseSha, groupSha }, () => { throw new Error('git unavailable') }), /git unavailable/)
})

// #4782: the rehearsal workflow rehearses only the current main tip, so a pass
// recorded on a main descendant of the migration commit must count.
const MIG = 'a'.repeat(40), TIP = 'b'.repeat(40), OTHER = 'c'.repeat(40)
const rehearsal = (state) => [{ context: PREVIEW_REHEARSAL_CONTEXT, state, created_at: '2026-10-25T20:00:00Z', id: 1 }]
const noWait = async () => {}
test('#4782 preview hold accepts a success recorded on a descendant that contains the migration commit', async () => {
  const result = await awaitPreviewRehearsal({ sha: MIG, descendants: [TIP], budgetMs: 1000, readStatuses: async (sha) => (sha === TIP ? rehearsal('success') : []), sleep: noWait, log: () => {} })
  assert.equal(result.state, 'success')
  assert.equal(result.rehearsedSha, TIP)
})
test('#4782 preview hold still refuses when no rehearsal success exists on the commit or any descendant', async () => {
  await assert.rejects(awaitPreviewRehearsal({ sha: MIG, descendants: [TIP], budgetMs: 10, intervalMs: 5, readStatuses: async () => [], sleep: noWait, log: () => {} }), /did not complete a successful post-merge preview rehearsal/)
})
test('#4782 a success on a commit outside the descendant list never counts', async () => {
  await assert.rejects(awaitPreviewRehearsal({ sha: MIG, descendants: [TIP], budgetMs: 10, intervalMs: 5, readStatuses: async (sha) => (sha === OTHER ? rehearsal('success') : []), sleep: noWait, log: () => {} }), /did not complete/)
})
test('#4782 a failed rehearsal on the migration commit still refuses even if a descendant passed', async () => {
  await assert.rejects(awaitPreviewRehearsal({ sha: MIG, descendants: [TIP], budgetMs: 1000, readStatuses: async (sha) => rehearsal(sha === MIG ? 'failure' : 'success'), sleep: noWait, log: () => {} }), /is failure/)
})
test('#4782 malformed descendants refuse', async () => {
  await assert.rejects(awaitPreviewRehearsal({ sha: MIG, descendants: ['nope'], budgetMs: 10, readStatuses: async () => [], sleep: noWait }), /descendants must be/)
})

test('only the lean core list is an approved live shape (ai-devops#2172 C2)', async () => {
  const m = await import('./merge-queue-contract.mjs')
  const rows = (list) => ({ do_not_enforce_on_create: false, strict_required_status_checks_policy: false, required_status_checks: list.map((context) => ({ context, integration_id: 15368 })) })
  assert.equal(m.requiredStatusChecksEqual(rows(m.REQUIRED_STATUS_CHECK_CONTEXTS)), true)
  assert.equal(m.LEGACY_REQUIRED_STATUS_CHECK_CONTEXTS, undefined)
  assert.equal(m.requiredStatusChecksEqual(rows([...m.REQUIRED_STATUS_CHECK_CONTEXTS, 'Merge queue gate'])), false)
  assert.equal(m.requiredStatusChecksEqual(rows(m.REQUIRED_STATUS_CHECK_CONTEXTS.slice(1))), false)
})

// ---------------------------------------------------------------------------
// Queue-time order-check PR resolution (issue #5370)
// ---------------------------------------------------------------------------
//
// WHY THESE TESTS EXIST. The merge-queue gate's "Revalidate migration order"
// step ran this contract's no-args mode with no PR_NUMBER in env, so the
// ascending-version order check refused on EVERY merge_group run and was
// silently dead. The number is now derived from MERGE_GROUP_REF in merge_group
// context. The derivation must never become a silent pass: an unresolvable PR
// number still refuses, and the order check itself is not weakened.

const orderReadNoMigrations = (args) => {
  const url = String(args.at(-1) ?? '')
  if (url.includes('pulls?state=open')) return [[]]
  if (url.includes('/files')) return [[{ filename: 'README.md' }]]
  throw new Error(`unexpected read ${url}`)
}

const orderReadViolation = (args) => {
  const url = String(args.at(-1) ?? '')
  if (url.includes('pulls?state=open')) return [[{ number: 9, draft: false }]]
  if (url.includes('pulls/9/files')) return [[{ filename: 'supabase/migrations/20260825120001_old.sql' }]]
  return [[{ filename: 'supabase/migrations/20260825120002_new.sql' }]]
}

const mustNotRead = () => { throw new Error('must not read') }

test('merge_group context with a resolvable ref passes the queue-time order re-validation', async () => {
  const logs = []
  const originalLog = console.log
  console.log = (msg) => logs.push(String(msg))
  try {
    assert.equal(await contractMain([], {
      MERGE_GROUP_REF: 'refs/heads/gh-readonly-queue/main/pr-1435-deadbeef',
    }, { read: orderReadNoMigrations }), 0)
    assert.match(logs.at(-1) ?? '', /not applicable/)
  } finally {
    console.log = originalLog
  }
})

test('the ref-derived order check still refuses a real ordering violation (not weakened)', async () => {
  await assert.rejects(
    contractMain([], { MERGE_GROUP_REF: 'refs/heads/gh-readonly-queue/main/pr-20-deadbeef' }, { read: orderReadViolation }),
    /behind open PR #9/,
  )
})

test('an unresolvable PR number still refuses (fail-closed)', async () => {
  // No PR_NUMBER and no MERGE_GROUP_REF — the original refusal, unchanged.
  await assert.rejects(contractMain([], {}, { read: mustNotRead }), /PR_NUMBER must be a positive integer/)
  // A merge-group ref naming no (or several) PR is refused, never guessed.
  await assert.rejects(contractMain([], { MERGE_GROUP_REF: 'refs/heads/main' }, { read: mustNotRead }), /expected exactly one pull request/)
  await assert.rejects(contractMain([], { MERGE_GROUP_REF: 'gh-readonly-queue/main/pr-12-aaa/pr-34-bbb' }, { read: mustNotRead }), /expected exactly one pull request/)
  // A garbage PR_NUMBER with no usable ref refuses.
  await assert.rejects(contractMain([], { PR_NUMBER: 'abc' }, { read: mustNotRead }), /PR_NUMBER must be a positive integer/)
  await assert.rejects(contractMain([], { PR_NUMBER: '0' }, { read: mustNotRead }), /PR_NUMBER must be a positive integer/)
  await assert.rejects(contractMain([], { PR_NUMBER: '-5' }, { read: mustNotRead }), /PR_NUMBER must be a positive integer/)
})

test('an explicit valid PR_NUMBER wins over the merge-group ref', async () => {
  const seen = []
  const read = (args) => {
    const url = String(args.at(-1) ?? '')
    seen.push(url)
    if (url.includes('pulls?state=open')) return [[]]
    return [[{ filename: 'README.md' }]]
  }
  const logs = []
  const originalLog = console.log
  console.log = (msg) => logs.push(String(msg))
  try {
    assert.equal(await contractMain([], {
      PR_NUMBER: '1435',
      MERGE_GROUP_REF: 'refs/heads/gh-readonly-queue/main/pr-9999-deadbeef',
    }, { read }), 0)
  } finally {
    console.log = originalLog
  }
  assert.ok(seen.some((url) => url.includes('pulls/1435/files')), `order check must run for PR 1435; reads: ${seen.join(', ')}`)
  assert.ok(!seen.some((url) => url.includes('pulls/9999/files')), 'a valid PR_NUMBER must not be overridden by the merge-group ref')
})