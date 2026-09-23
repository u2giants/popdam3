import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MergeQueueError,
  MergeQueueModeUnknown,
  PREVIEW_REHEARSAL_CONTEXT,
  QUEUE_RULE,
  RULESET_NAME,
  assertOldestMigration,
  assertProductionInterlock,
  assertQueueAuthorizationCurrent,
  awaitPreviewRehearsal,
  baseNeedsPreview,
  checkQueueOrder,
  latestContextState,
  main as contractMain,
  migrationVersions,
  pullRequestFromQueueRef,
  queueMode,
  queueRulesetMatches,
  readOpenPullRequests,
  readPullRequestFiles,
  recheckQueueInterlock,
  rehearsalState,
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
  rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters } }],
}

test('the approved rule is exactly one all-green PR built and merged at a time', () => {
  assert.deepEqual(QUEUE_RULE.parameters, {
    check_response_timeout_minutes: 30,
    grouping_strategy: 'ALLGREEN',
    max_entries_to_build: 1,
    max_entries_to_merge: 1,
    merge_method: 'MERGE',
    min_entries_to_merge: 1,
    min_entries_to_merge_wait_minutes: 0,
  })
  assert.equal(queueRulesetMatches(approvedDetail), true)
  assert.equal(queueRulesetMatches({ ...approvedDetail, enforcement: 'evaluate' }), false)
  assert.equal(queueRulesetMatches({ ...approvedDetail, conditions: { ref_name: { include: ['refs/heads/develop'] } } }), false)
  assert.equal(queueRulesetMatches({ ...approvedDetail, rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters, max_entries_to_build: 2 } }] }), false)
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
    if (target.endsWith('rulesets/42')) return { ...approvedDetail, rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters, grouping_strategy: 'HEADGREEN' } }] }
    throw new Error(`unexpected read ${target}`)
  }
  assert.throws(() => queueMode({ repo: REPO, read: drifted }), /not the exact approved one-PR queue/)
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
