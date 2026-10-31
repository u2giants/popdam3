import { HOLD_SECONDS, POLL_SECONDS } from './merge-queue-hold.mjs'
// Merge-queue workflow coverage (issue #2530 Phase C Step 7;
// plan_shared_db_popcre_transfer_merge_queue.md).
//
// WHY THIS TEST EXISTS. A required status context that no workflow reports for
// `merge_group` leaves every merge group pending forever — GitHub waits for a
// context that never arrives. So the mapping below is the authority tying every
// required context to the workflow and job that emits it, and proving that
// emission happens for BOTH `pull_request` and `merge_group` events.
//
// The context list is derived from TWO sources and must cover both:
//   1. the committed mirror docs/verification/main-required-status-checks.json
//      (informational only; the guarded merge pre-flight enforces fresh live
//      effective settings, and the mirror cannot authorize a merge);
//   2. KNOWN_LIVE_ADDITIONS below — contexts already live but not yet mirrored.
// The mirror must never shrink this coverage, and this test fails the moment a
// mirrored context has no mapped merge-group-capable emitter.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emittedJobNames, jobBlockByName, jobBlocks, jobEvents, stepBlock } from './lib/workflow-jobs.mjs'

const readWorkflow = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function guardedCollisionWire(pr, { fetchFails = false } = {}) {
  const workflow = readWorkflow('guarded-migration-merge.yml')
  // Collision re-check removed (ai-devops#2172); the identity read stays.
  const block = /          collision_pr="\$\(node[\s\S]*?\n          '\n/.exec(workflow)?.[0]
  assert.ok(block, 'the actual guarded identity read must exist')
  const script = `set -euo pipefail
node() {
  if [ "$1" = "$GITHUB_WORKSPACE/trusted-policy/scripts/gh-read.mjs" ]; then
    [ "$2" = api ] && [ "$3" = "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" ]
    [ "$FETCH_FAILS" = 0 ] || return 1
    printf '%s' "$FIXTURE_JSON"
  elif [ "$1" = "$GITHUB_WORKSPACE/trusted-policy/scripts/check-pr-object-collisions.mjs" ]; then
    printf 'collision-head=%s\\n' "$GITHUB_SHA"
  else
    command node "$@"
  fi
}
${block}
printf 'workflow-head=%s\\n' "$GITHUB_SHA"
`
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PR_NUMBER: '7', REQUESTED_SHA: 'a'.repeat(40), GITHUB_SHA: 'b'.repeat(40),
      GITHUB_REPOSITORY: 'popcre/shared-db', GITHUB_WORKSPACE: '/synthetic',
      FIXTURE_JSON: JSON.stringify(pr), FETCH_FAILS: fetchFails ? '1' : '0' },
  })
}

function guardedQueueDecision(mode, { readFails = false } = {}) {
  const workflow = readWorkflow('guarded-migration-merge.yml')
  const step = stepBlock(workflow, 'Re-prove the head and merge while the lock is held')
  const start = step.indexOf('queue_mode="$(node "$GITHUB_WORKSPACE/trusted-policy/scripts/merge-queue-contract.mjs" --queue-mode)"')
  const endMarker = `test "$merged" = '1'`
  const end = step.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, 'the actual queue decision block must be present in the guarded merge step')
  const decision = step.slice(start, end + endMarker.length)
    .replaceAll('${{ inputs.pull_request }}', '$PR_NUMBER')
    .replaceAll('${{ inputs.head_sha }}', '$REQUESTED_SHA')
  const script = `set -euo pipefail
merge_calls=0
trap 'echo MERGE_CALL_COUNT=$merge_calls' EXIT
node() {
  if [ "$1" = "$GITHUB_WORKSPACE/trusted-policy/scripts/gh-read.mjs" ] && [ "$2" = pr ] && [ "$3" = view ]; then
    printf 'PR_node'
  elif [ "$1" = "$GITHUB_WORKSPACE/trusted-policy/scripts/merge-queue-contract.mjs" ] && [ "$2" = '--queue-mode' ]; then
    [ "$QUEUE_READ_FAILS" = 0 ] || return 1
    printf '%s' "$QUEUE_MODE"
  else
    command node "$@"
  fi
}
gh() {
  if [ "$1" = pr ] && [ "$2" = merge ]; then merge_calls=$((merge_calls + 1)); return 0; fi
  # #4731: queue admission enqueues through GraphQL as the admission app.
  if [ "$1" = api ] && [ "$2" = graphql ] && [[ "$*" == *enqueuePullRequest* ]]; then merge_calls=$((merge_calls + 1)); return 0; fi
  return 91
}
prove_retained_all14() { return 0; }
${decision}
`
  const runnerTemp = mkdtempSync(join(tmpdir(), 'guarded-queue-decision-'))
  try {
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, QUEUE_MODE: mode, QUEUE_READ_FAILS: readFails ? '1' : '0',
        PR_NUMBER: '7', REQUESTED_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'popcre/shared-db', QUEUE_ADMISSION_TOKEN: 'synthetic',
        GITHUB_WORKSPACE: '/synthetic', RUNNER_TEMP: runnerTemp },
    })
    const count = /MERGE_CALL_COUNT=(\d+)/.exec(result.stdout)?.[1]
    return { ...result, mergeCalls: count === undefined ? null : Number(count) }
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true })
  }
}

const guardedCollisionPull = () => ({ number: 7, state: 'open', head: { sha: 'a'.repeat(40), repo: { full_name: 'popcre/shared-db' } }, base: { ref: 'main', repo: { full_name: 'popcre/shared-db' } } })

test('actual protected guarded identity wire accepts the exact open PR head', () => {
  const result = guardedCollisionWire(guardedCollisionPull())
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`workflow-head=${'b'.repeat(40)}`))
  const workflow = readWorkflow('guarded-migration-merge.yml')
  const locked = workflow.slice(workflow.indexOf('      - name: Re-prove the head and merge while the lock is held'))
  assert.ok(locked.indexOf('check-main-tip-freshness.mjs --contains') < locked.indexOf('collision_pr='))
  assert.ok(locked.indexOf('headRefOid') < locked.indexOf('collision_pr='))
  assert.ok(locked.indexOf('collision_pr=') < locked.indexOf("-f state=success"))
})

for (const [label, mutate] of [
  ['moved head', pr => { pr.head.sha = 'c'.repeat(40) }],
  ['closed PR', pr => { pr.state = 'closed' }],
  ['wrong PR', pr => { pr.number = 8 }],
  ['foreign head repository', pr => { pr.head.repo.full_name = 'foreign/shared-db' }],
  ['foreign base repository', pr => { pr.base.repo.full_name = 'foreign/shared-db' }],
  ['wrong base branch', pr => { pr.base.ref = 'develop' }],
  ['unknown head repository', pr => { pr.head.repo = null }],
]) {
  test(`actual protected guarded collision wire refuses ${label} before checking or authorizing`, () => {
    const pr = guardedCollisionPull()
    mutate(pr)
    const result = guardedCollisionWire(pr)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not the exact open canonical pull request/)
    assert.doesNotMatch(result.stdout, /collision-head=/)
  })
}

test('actual protected guarded collision wire refuses an unreadable PR before checking or authorizing', () => {
  const result = guardedCollisionWire(guardedCollisionPull(), { fetchFails: true })
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout, /collision-head=/)
})
const MIRROR = JSON.parse(readFileSync(new URL('../docs/verification/main-required-status-checks.json', import.meta.url), 'utf8'))

// Live on main but not yet in the committed mirror. The mirror is rewritten by
// scripts/update-required-checks.mjs from the live read-back; it now equals the
// dated readback artifact below (16 contexts, strict false), so nothing is pending.
const KNOWN_LIVE_ADDITIONS = []
// Contexts still present in the dated mirror but no longer live-required and no
// longer emitted: the Orchestrator marker guard was retired with the role (#3874);
// live branch protection already omitted it (made advisory 2026-09-28).
const RETIRED_MIRROR_CONTEXTS = new Set(['Orchestrator marker guard', 'Agent work contract'])

// context -> emitter. kind 'check-run': the workflow job named `job` reports
// the context on whatever commit it runs on, so merge_group coverage means the
// workflow triggers on merge_group. kind 'commit-status': a status is POSTed to
// an explicit SHA — by the guarded merge lane on the reviewed PR head, and by
// the queue gate on the synthetic group SHA.
const CONTEXT_MAP = {
  'Cancelled work guard': { workflow: 'pr-guards.yml', kind: 'check-run', job: 'Cancelled work guard' },
  'Cross-PR object collision': { workflow: 'pr-guards.yml', kind: 'check-run', job: 'Cross-PR object collision' },
  'Destructive SQL outside migrations': { workflow: 'pr-guards.yml', kind: 'check-run', job: 'Destructive SQL outside migrations' },
  'Domain ownership': { workflow: 'pr-guards.yml', kind: 'check-run', job: 'Domain ownership' },
  'Handoff contract': { workflow: 'pr-guards.yml', kind: 'check-run', job: 'Handoff contract' },
  'Intake pointer guard': { workflow: 'pr-guards.yml', kind: 'check-run', job: 'Intake pointer guard' },
  'Migration author lease': { workflow: 'migration-author-lease.yml', kind: 'check-run', job: 'Migration author lease' },
  'Migration guarded merge authorization': { kind: 'commit-status' },
  'Promotion contract tests (offline)': { workflow: 'coldlion-promotion-contract-tests.yml', kind: 'check-run', job: 'Promotion contract tests (offline)' },
  'Queue-sensitive checks (aggregate)': { workflow: 'pr-guards.yml', kind: 'check-run', job: 'Queue-sensitive checks (aggregate)' },
  'SQL migration guards': { workflow: 'shared-supabase-migrations.yml', kind: 'check-run', job: 'SQL migration guards' },
  'supabase/tests against an ephemeral database': { workflow: 'database-contract-tests.yml', kind: 'check-run', job: 'supabase/tests against an ephemeral database' },
  'Tools offline tests': { workflow: 'tools-offline-tests.yml', kind: 'check-run', job: 'Tools offline tests' },
  'Merge queue gate': { workflow: 'merge-queue-gate.yml', kind: 'check-run', job: 'Merge queue gate' },
}

test('every mirrored or known-live required context has a mapped emitter', () => {
  const mirrored = MIRROR.contexts
  assert.ok(Array.isArray(mirrored) && mirrored.length > 0, 'the committed mirror carries no contexts; the required list is unknown')
  for (const context of [...mirrored, ...KNOWN_LIVE_ADDITIONS].filter((name) => !RETIRED_MIRROR_CONTEXTS.has(name))) {
    assert.ok(CONTEXT_MAP[context], `no merge-group-capable emitter is mapped for required context "${context}"`)
  }
})

// Provenance of the mirror (#3562 review M-2): a committed, dated readback of live
// branch protection. The mirror must carry exactly its contexts and strictness.
const READBACK = JSON.parse(readFileSync(new URL('../docs/verification/main-required-status-checks-readback-20260925.json', import.meta.url), 'utf8'))

test('the committed mirror equals the dated live readback artifact', () => {
  assert.deepEqual([...MIRROR.contexts].sort(), [...READBACK.contexts].sort())
  assert.equal(READBACK.contextCount, READBACK.contexts.length)
  assert.equal(MIRROR.strict, READBACK.strict)
  assert.ok(MIRROR.contexts.includes('Queue-sensitive checks (aggregate)'), 'the restored aggregate context left the mirror')
})

// #3562 review M-1: the required context "Destructive SQL outside migrations" must
// actually SCAN on merge_group, not merely run green. Pin the step, its event gate,
// its group base and its fail-closed base resolution.
test('destructive SQL guard scans the queued group against merge_group.base_sha, fail-closed', () => {
  const job = jobBlockByName(readWorkflow('pr-guards.yml'), 'Destructive SQL outside migrations')
  assert.ok(job, 'no job emits Destructive SQL outside migrations')
  const step = stepBlock(job, 'Scan SQL added by the queued group')
  assert.ok(step, 'the merge_group scan step is missing from the Destructive SQL job')
  assert.match(step, /^ {8}if: github\.event_name == 'merge_group'$/m)
  assert.match(step, /^ {10}BASE_SHA: \$\{\{ github\.event\.merge_group\.base_sha \}\}$/m)
  assert.match(step, /git cat-file -e "\$\{BASE_SHA\}\^\{commit\}"/)
  assert.match(step, /exit 1/)
  assert.match(step, /node scripts\/check-destructive-analysis\.mjs --diff-base "\$\{BASE_SHA\}"/)
  assert.match(job, /^ {6}- uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 0$/m, 'the group base must be fetchable (full history)')
})

test('the emitter check matches exact job names, not substrings or comments', () => {
  const names = emittedJobNames([
    'jobs:',
    '  a:',
    '    name: Not Destructive SQL outside migrations',
    '    # name: Destructive SQL outside migrations',
    '  b:',
    "    name: ${{ inputs.lane && format('Tools offline tests [lane {0}]', inputs.lane) || 'Tools offline tests' }}",
  ].join('\n'))
  assert.equal(names.has('Destructive SQL outside migrations'), false)
  assert.equal(names.has('Tools offline tests'), true)
})

test('every check-run emitter triggers on pull_request AND merge_group (bare trigger, no types pin)', () => {
  for (const [context, spec] of Object.entries(CONTEXT_MAP)) {
    if (spec.kind !== 'check-run') continue
    const text = readWorkflow(spec.workflow)
    assert.match(text, /^ {2}pull_request:$/m, `${spec.workflow} (${context}) lost its pull_request trigger`)
    assert.match(text, /^ {2}merge_group:$/m, `${spec.workflow} (${context}) does not trigger for merge_group`)
    // Bare merge_group: — GitHub's official merge-queue CI example uses bare
    // on: merge_group:. A types: [checks_requested] pin is a known dispatch
    // footgun (#2530 canary #4298: zero Actions runs on a valid merge group).
    assert.doesNotMatch(text, /^ {2}merge_group:\r?\n {4}types:/m, `${spec.workflow} (${context}) still pins merge_group types; use bare merge_group:`)
    assert.doesNotMatch(text, /types: \[checks_requested\]/, `${spec.workflow} (${context}) still declares types: [checks_requested]`)
    // Exact object: a job whose display name (literal, or the default branch of a
    // lane-capable name expression) equals the context. A substring or comment is not enough.
    assert.ok(emittedJobNames(text).has(spec.job), `${spec.workflow} does not emit a job named exactly "${spec.job}"`)
    // #3746: the JOB bearing the context must itself admit both events. A
    // file-level trigger is not enough once one file holds many gated jobs.
    assert.deepEqual(requiredJobEventProblems(text, spec.job), [], `${spec.workflow} (${context})`)
  }
})

function requiredJobEventProblems(text, name) {
  const block = jobBlockByName(text, name)
  if (!block) return [`no job emits "${name}"`]
  const events = jobEvents(block)
  if (events === null) return []
  if (!Array.isArray(events)) return [`job "${name}" has an unrecognised job-level if: ${events}`]
  return ['pull_request', 'merge_group'].filter((event) => !events.includes(event)).map((event) => `job "${name}" does not run on ${event}`)
}

test('the job-level event check fails when a required job drops merge_group or pull_request', () => {
  const text = readWorkflow('pr-guards.yml')
  for (const [event] of [['merge_group'], ['pull_request']]) {
    const broken = text.replace(
      /(^ {4}name: Cancelled work guard\n {4}needs: route\n {4}if: \$\{\{ !cancelled\(\) && contains\(fromJSON\('\[)([^\]]*)(\]'\), github\.event_name\) \}\}$)/m,
      (_, head, list, tail) => head + list.split(', ').filter((item) => item !== `"${event}"`).join(', ') + tail,
    )
    assert.notEqual(broken, text, 'the negative fixture did not change the file')
    assert.deepEqual(requiredJobEventProblems(broken, 'Cancelled work guard'), [`job "Cancelled work guard" does not run on ${event}`])
  }
  assert.match(requiredJobEventProblems("jobs:\n  a:\n    name: A\n    if: github.event_name != 'merge_group'\n", 'A')[0], /unrecognised/)
})

test('pr-guards.yml uses default pull_request types: no ready_for_review (#3746 review B2)', () => {
  const text = readWorkflow('pr-guards.yml')
  const onBlock = /^on:\n([\s\S]*?)^\w/m.exec(text)?.[1] ?? ''
  assert.match(onBlock, /^ {2}pull_request:\n {2}merge_group:$/m, 'pull_request must carry no types list')
  assert.ok(!/ready_for_review/.test(onBlock.replace(/^\s*#.*$/gm, '')), 'ready_for_review would start the required aggregate for lane checks it never starts')
  const aggregate = jobEvents(jobBlockByName(text, 'Queue-sensitive checks (aggregate)'))
  assert.deepEqual(aggregate, ['pull_request', 'merge_group'])
})

test('no required-context workflow is path-filtered (a filtered required check stays pending forever)', () => {
  for (const [context, spec] of Object.entries(CONTEXT_MAP)) {
    if (spec.kind !== 'check-run') continue
    const text = readWorkflow(spec.workflow)
    const onBlock = /^on:\n([\s\S]*?)^\w/m.exec(text)?.[1] ?? ''
    assert.ok(!/^ {4}paths(-ignore)?:/m.test(onBlock), `${spec.workflow} (${context}) has a paths filter on a required context`)
    // merge_group must stay bare: on.merge_group does not support paths, and
    // any child key there is a dispatch footgun (#2530).
    assert.doesNotMatch(text, /^ {2}merge_group:\r?\n {4}\S/m, `${spec.workflow} (${context}) has child keys under merge_group; use bare merge_group:`)
  }
})

test('no queue check is cancelled in progress: a re-requested group must never kill its own run', () => {
  for (const [context, spec] of Object.entries(CONTEXT_MAP)) {
    if (spec.kind !== 'check-run') continue
    const text = readWorkflow(spec.workflow)
    const line = /^ {2}cancel-in-progress: (.*)$/m.exec(text)?.[1]?.trim()
    assert.ok(line !== undefined, `${spec.workflow} (${context}) declares no concurrency cancel-in-progress policy`)
    assert.ok(
      line === 'false' || line.includes("!= 'merge_group'") || line.includes("== 'pull_request'"),
      `${spec.workflow} (${context}) may cancel an in-progress merge_group run: cancel-in-progress: ${line}`,
    )
  }
})

test('PR-payload steps defer or re-resolve on merge_group (the payload does not exist there)', () => {
  // Each job defends itself: one job's defence must never satisfy another's (#3746 review M1).
  const guards = jobBlocks(readWorkflow('pr-guards.yml'))
  const units = [
    ...['agent-work-contract', 'handoff-contract', 'pr-object-collision'].map((id) => [`pr-guards.yml#${id}`, guards.get(id)]),
    ['migration-author-lease.yml', readWorkflow('migration-author-lease.yml')],
  ]
  for (const [name, text] of units) {
    assert.ok(text, `${name} is missing`)
    const usesPayload = /github\.event\.pull_request\.|github\.base_ref|GITHUB_BASE_REF/.test(text)
    if (!usesPayload) continue
    const defended =
      /if: github\.event_name != 'merge_group'/.test(text) ||
      /merge-queue-contract\.mjs --resolve-queue-pr/.test(text) ||
      /github\.base_ref \|\| 'main'/.test(text)
    assert.ok(defended, `${name} consumes pull_request payload fields with no merge_group defence`)
  }
})

test('the queue gate keeps only one-PR identity, ascending versions and the preview hold (ai-devops#2172 C2)', () => {
  const text = readWorkflow('merge-queue-gate.yml')
  assert.match(text, /^ {2}pull_request:$/m)
  assert.match(text, /^ {2}merge_group:$/m)
  assert.match(text, /name: Merge queue gate/)
  assert.match(text, /MERGE_GROUP_REF: \$\{\{ github\.event\.merge_group\.head_ref \}\}/)
  assert.ok(text.includes('merge-queue-contract.mjs --resolve-queue-pr'), 'the gate does not resolve the queued PR through the contract')
  assert.ok(text.includes('git merge-base --is-ancestor'), 'the gate does not prove the PR head is an ancestor of the group commit')
  assert.ok(text.includes('node scripts/merge-queue-contract.mjs\n'), 'the gate does not re-check ascending migration versions')
  assert.ok(text.includes('--require-preview-rehearsal'), 'the gate does not hold for the exact-SHA preview rehearsal')
  for (const retired of ['Migration guarded merge authorization', '--authorization-state', '--recheck-interlock', '--acquire-merge', '\n  authorize:', 'statuses: write'])
    assert.ok(!text.includes(retired), `the gate still carries retired ${retired}`)
  assert.match(text, /^ {2}cancel-in-progress: false$/m)
})

// QUEUE INTERLOCK (workflow-refactor closeout §5). The authorize path must own
// the ASYNCHRONOUS MUTATION: acquire the merge lane, re-check authorization and
// the production interlock under that lane, post group-SHA success, and HOLD the
// lane until GitHub lands the merge. Posting success from a pre-wait read and
// releasing the lane is the race this structure exists to close.
// ORDER-TRUST CLASS (governed REVISE). Authorization history must be read from
// the PAGINATED `/statuses` collection via the shared helper, never the
// combined `/status` page with `| first |` or `.at(-1)`. Combined `/status`
// collapses and can omit a freeze failure, so a stale success would win.
test('every authorization status reader uses the shared paginated helper, not combined /status or jq first', () => {
  const workflows = ['merge-queue-gate.yml', 'guarded-migration-merge.yml', 'shared-supabase-migrations.yml']
  for (const name of workflows) {
    const text = readWorkflow(name)
    assert.ok(!/\| first \|/.test(text), `${name} still uses jq first on a status list`)
    assert.ok(!/commits\/\$\{[^}]+\}\/status['"]/.test(text) && !/commits\/\$[A-Z_]+\/status['"]/.test(text),
      `${name} still reads the combined /status page`)
  }
  const guarded = readWorkflow('guarded-migration-merge.yml')
  assert.ok(guarded.includes('--authorization-state'), 'the guarded lane readback must use --authorization-state')
  const migrations = readWorkflow('shared-supabase-migrations.yml')
  assert.ok(!migrations.includes('--authorization-state'), 'production dispatch no longer reads guarded authorization (#2172 C2)')
  assert.ok(!migrations.includes('--authorization-row'), 'the production freeze no longer revokes or restores authorizations (#2172 C2)')
  const contract = readFileSync(new URL('../scripts/merge-queue-contract.mjs', import.meta.url), 'utf8')
  assert.ok(contract.includes('/statuses?per_page=100'), 'the shared reader must use the paginated /statuses collection')
  assert.ok(contract.includes('--paginate') && contract.includes('--slurp'), 'the shared reader must paginate')
})

test('the actual guarded queue decision queues active, directly merges inactive, and refuses unknown before gh', () => {
  const active = guardedQueueDecision('active')
  assert.equal(active.status, 0, active.stderr)
  assert.equal(active.mergeCalls, 1)
  assert.match(active.stdout, /Queue admission complete/)

  const inactive = guardedQueueDecision('inactive')
  assert.equal(inactive.status, 0, inactive.stderr)
  assert.equal(inactive.mergeCalls, 1)
  assert.doesNotMatch(inactive.stdout, /Queue admission complete/)

  const unknown = guardedQueueDecision('unknown')
  assert.equal(unknown.status, 1)
  assert.equal(unknown.mergeCalls, 0)
  assert.match(unknown.stderr + unknown.stdout, /unknown; refusing before any merge attempt/)

  const unreadable = guardedQueueDecision('', { readFails: true })
  assert.equal(unreadable.status, 1)
  assert.equal(unreadable.mergeCalls, 0)
})

test('the guarded merge lane pins exact heads and never uses --admin', () => {
  const text = readWorkflow('guarded-migration-merge.yml')
  assert.ok(text.includes('--queue-mode'), 'the guarded lane does not read live queue state')
  assert.ok(!text.includes('--admin'), 'the guarded lane must never bypass with --admin')
  assert.ok(text.includes('--match-head-commit'), 'the guarded lane dropped exact-head matching')
})

test('both authority reads precede every pull-request script and run from protected main', () => {
  const workflow = readWorkflow('guarded-migration-merge.yml')
  const start = workflow.indexOf('      - name: Pre-flight the required status checks before taking the merge lane')
  const classifier = workflow.indexOf('      - name: Refuse out-of-boundary self-service changes before taking the merge lane', start)
  const quota = workflow.indexOf('      - name: Check the GitHub API quota before taking the merge lane', classifier)
  const lock = workflow.indexOf('      - name: Acquire the exclusive merge lane', quota)
  const reread = workflow.indexOf('      - name: Re-read required-check authority under the merge lock from protected main', lock)
  const guard = workflow.indexOf('      - name: Require current main and rerun every applicable coordination guard', reread)
  assert.ok(start >= 0 && start < classifier && classifier < quota && quota < lock && lock < reread && reread < guard, 'both authority reads and lock acquisition must precede every pull-request script')
  const preflight = workflow.slice(start, classifier)
  const protectedClassifier = workflow.slice(classifier, quota)
  const protectedQuota = workflow.slice(quota, lock)
  const protectedLock = workflow.slice(lock, reread)
  const underlock = workflow.slice(reread, guard)
  const outside = workflow.slice(0, start) + protectedClassifier + protectedQuota + protectedLock + workflow.slice(guard)
  assert.equal((workflow.match(/\$\{\{ secrets\.SYNC_TOKEN \}\}/g) ?? []).length, 2, 'the authority secret must occur only in the two protected preflight steps')
  assert.equal((outside.match(/\$\{\{ secrets\.SYNC_TOKEN \}\}/g) ?? []).length, 0, 'no head-code step may receive the authority secret')
  for (const step of [preflight, underlock]) {
    assert.match(step, /working-directory: trusted-policy/)
    assert.match(step, /AUTHORITY_TOKEN: \$\{\{ secrets\.SYNC_TOKEN \}\}/)
    assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/, 'ordinary status reads must retain the limited token')
    assert.doesNotMatch(step, /export GH_TOKEN="\$AUTHORITY_TOKEN"/, 'the authority token must be selected for authority calls only')
    assert.match(step, /export PATH="\$TRUSTED_PATH"/)
    assert.match(step, /NODE_OPTIONS: ''/)
    assert.match(step, /git rev-parse HEAD[\s\S]*git rev-parse origin\/main/)
    assert.match(step, /git status --porcelain/)
    assert.match(step, /node "\$GITHUB_WORKSPACE\/trusted-policy\/scripts\/check-required-checks-preflight\.mjs"/)
  }
  assert.match(protectedClassifier, /working-directory: trusted-policy/)
  assert.match(protectedClassifier, /node "\$GITHUB_WORKSPACE\/trusted-policy\/scripts\/check-self-service-additive-lane\.mjs" --pr/)
  assert.match(protectedQuota, /working-directory: trusted-policy/)
  assert.match(protectedLock, /working-directory: trusted-policy/)
  assert.match(protectedLock, /node "\$GITHUB_WORKSPACE\/trusted-policy\/scripts\/acquire-merge-lane-waiting\.mjs" --wait-seconds 900 --poll-seconds 15 -- --acquire-merge/)
  // #3669: the lock's "main moved independently" re-check needs the merge base
  // of the head and the main tip, so protected main must carry full history and
  // both commits must be fetched before acquisition.
  const trustedCheckout = workflow.slice(workflow.indexOf('      - name: Check out protected main policy separately from the pull request'), start)
  assert.match(trustedCheckout, /path: trusted-policy[\s\S]*fetch-depth: 0/, 'a shallow trusted-policy checkout has no merge base, so main moving independently is always refused')
  assert.doesNotMatch(trustedCheckout, /fetch-depth: 1/)
  assert.match(protectedLock, /HEAD_SHA: \$\{\{ inputs\.head_sha \}\}/)
  assert.match(protectedLock, /git fetch --no-tags --quiet origin main "\$HEAD_SHA"\n\s*node "\$GITHUB_WORKSPACE\/trusted-policy\/scripts\/acquire-merge-lane-waiting\.mjs" --wait-seconds 900 --poll-seconds 15 -- --acquire-merge/, 'the head and main tip must be fetched immediately before acquisition')
  assert.match(preflight, /GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '900'/)
  assert.match(preflight, /id: trusted_preflight/)
  assert.match(preflight, /echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/)
  assert.match(underlock, /PREFLIGHT_WAIT_SECONDS: '0'/)
  const release = workflow.slice(workflow.indexOf('      - name: Release the exclusive merge lane with ownership proof'))
  assert.match(release, /working-directory: trusted-policy/)
  // #3779: the release runs in the `merge` job, whose own pre-lock binding step
  // (`executable_source`) proved trusted-policy == origin/main. The `prepare`
  // job's preflight SHA is a different job's output and is NOT the release key.
  assert.match(release, /TRUSTED_MAIN_SHA: \$\{\{ steps\.executable_source\.outputs\.sha \}\}/)
  assert.match(release, /test "\$\(git rev-parse HEAD\)" = "\$TRUSTED_MAIN_SHA"/)
  assert.match(release, /NODE_OPTIONS: ''/)
  assert.match(release, /node "\$GITHUB_WORKSPACE\/trusted-policy\/scripts\/manage-migration-author-lanes\.mjs" --release-merge/)
  assert.doesNotMatch(outside, /^\s*AUTHORITY_TOKEN:/m, 'head code outside the protected reads must not receive the authority token')
})

test('the preview rehearsal publishes the exact rehearsed main SHA, and only on success', () => {
  const text = readWorkflow('shared-supabase-migrations.yml')
  const preview = /^ {2}preview:\n([\s\S]*?)^ {2}[a-z]/m.exec(text)?.[1] ?? ''
  assert.ok(preview, 'the preview job was not found in shared-supabase-migrations.yml')
  assert.match(preview, /^ {6}statuses: write$/m, 'the preview job cannot publish commit statuses')
  assert.ok(preview.includes("context='Post-merge preview rehearsal'"), 'the preview job does not publish the rehearsal status')
  assert.ok(preview.includes('if: success() &&'), 'the rehearsal status is not gated on success() — a failure must never post success')
  // (#5086) The historical-recovery lane posts the SAME exact-SHA release
  // signal. When the claim lane already applied every allowlisted version
  // pre-merge, the hard guard refuses a merged-main apply and directs to
  // historical recovery for fresh evidence at exact main; a lane excluded
  // here deadlocks every later migration group. The posting condition must
  // stay success()-gated and must distinguish the no-write proof in the
  // description the run leaves behind.
  const publish = preview.slice(preview.indexOf('- name: Publish the exact-SHA preview rehearsal status for the merge queue'))
  const condition = /if: success\(\) && inputs\.mode == 'apply' && \(([^)]*)\)/.exec(publish)?.[1] ?? ''
  assert.ok(condition, 'the rehearsal status publishing condition was not found')
  for (const input of ['inputs.merged_preview_source_pr', 'inputs.merged_preview_source_pr_map', 'inputs.historical_preview_source_pr', 'inputs.historical_preview_source_pr_map']) {
    assert.ok(condition.includes(`${input} != ''`), `the rehearsal status publishing condition no longer includes ${input} (#5086): the queue deadlocks when only historical-recovery evidence can exist`)
  }
  assert.match(publish, /IS_MERGED_LANE:/, 'the publishing step must distinguish merged-lane apply from historical no-write proof (#5086)')
  assert.match(publish, /proven on preview by historical recovery run/, 'the historical form must say it proved an already-applied version, not that it applied one (#5086)')
})

test('SQL migration guards fetch the base ref explicitly on merge_group (#3280 governed review)', () => {
  const text = readWorkflow('shared-supabase-migrations.yml')
  const validate = /^ {2}validate:\n([\s\S]*?)^ {2}[a-z]/m.exec(text)?.[1] ?? ''
  assert.ok(validate, 'the validate job was not found in shared-supabase-migrations.yml')
  // Guard B still needs full history; the explicit fetch is belt-and-braces ON
  // TOP of it, not a replacement.
  assert.match(validate, /fetch-depth: 0/, 'the validate job dropped fetch-depth: 0 — Guard B degrades to warning-only')
  const fetchStep = /- name: Fetch the base branch ref explicitly on merge queue runs\n {8}if: github\.event_name == 'merge_group'\n {8}run: git fetch --no-tags origin main/
  assert.match(validate, fetchStep, 'the validate job does not fetch origin/main explicitly on merge_group')
  // The fetch is worthless unless it runs BEFORE every origin/main consumer.
  for (const consumer of ['run: bash scripts/check-sql.sh', 'check-production-verification-sidecars.mjs --base', 'check-applied-migration-edit.mjs --base']) {
    assert.ok(validate.includes(consumer), `the validate job no longer contains expected base consumer "${consumer}"`)
    assert.ok(
      validate.search(fetchStep) < validate.indexOf(consumer),
      `the explicit base fetch must precede "${consumer}" in the validate job`,
    )
  }
})

// CLASS-WIDE answer to the #3280 REVISE verdicts (grok-4.6, then
// muse-spark-1.3-contributor). The finding is not about one job: on ANY
// merge_group run the checkout action is handed the queue group commit SHA, so
// no origin/<branch> remote tracking ref is created, even at fetch-depth: 0
// (the ancestor objects exist; the ref does not). Every guard that resolves a
// base ref BY NAME therefore hard-fails on every queue run.
//
// ROUND 2 CORRECTION. The first version of this test hand-listed two consumers
// and claimed they were the only ones in the repository. They were not:
// check-live-proof-probe.mjs (origin/main hardcoded, no --base to override),
// check-applied-migration-edit.mjs, check-handoff-contract.mjs and
// check-cancelled-work.mjs all resolve a base by name and all run on the queue
// path. A hand-maintained list is the wrong artifact, because it goes stale
// silently and reads as exhaustive when it is not.
//
// So the list is DERIVED. Every base-ref consumer now resolves through
// scripts/lib/resolve-base-ref.mjs, and this test finds them by scanning for
// that import. scripts/check-sql.sh is the one shell consumer and carries the
// same fetch-then-FETCH_HEAD fallback inline; it is named explicitly because a
// shell script cannot import the module. A NEW consumer is picked up the moment
// it imports the resolver, with no edit here.
const SHELL_BASE_REF_CONSUMERS = ['check-sql.sh']

function derivedBaseRefConsumers() {
  const dir = new URL('../scripts/', import.meta.url)
  const names = readdirSync(dir).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
  const importers = names.filter((name) => readFileSync(new URL(name, dir), 'utf8').includes('lib/resolve-base-ref.mjs'))
  return [...importers, ...SHELL_BASE_REF_CONSUMERS]
}

test('every base-ref consumer resolves through the one shared resolver (#3280 round 2)', () => {
  const consumers = derivedBaseRefConsumers()
  // The four the round-2 review named as missed, plus the two from round 1.
  for (const required of [
    'check-live-proof-probe.mjs',
    'check-applied-migration-edit.mjs',
    'check-handoff-contract.mjs',
    'check-cancelled-work.mjs',
    'check-production-verification-sidecars.mjs',
    // Found by my own round-2 sweep, not by the review: its 'origin/main' feeds
    // local git merge-base/show and it runs on the queue path.
    'check-sql.sh',
  ]) {
    assert.ok(consumers.includes(required), `${required} no longer resolves its base ref through the shared resolver`)
  }
})

test('the shared resolver fetches the branch and still fails closed (#3280 round 2)', () => {
  const text = readFileSync(new URL('../scripts/lib/resolve-base-ref.mjs', import.meta.url), 'utf8')
  assert.ok(text.includes("'fetch', '--no-tags', 'origin', branch"), 'the resolver no longer fetches the branch it was given')
  assert.ok(text.includes('could not resolve base ref'), 'the resolver no longer throws when nothing resolves')
  assert.ok(!/return\s+null/.test(text), 'the resolver must never return a null base instead of throwing')
})

test('every merge_group workflow that resolves an origin/<base> ref also fetches it explicitly (#3280 class fix)', () => {
  // The workflow-level fetch stays as belt-and-braces ON TOP of the resolver, so
  // a queue run does not depend on the fallback firing.
  const consumers = derivedBaseRefConsumers()
  const names = readdirSync(new URL('../.github/workflows/', import.meta.url)).filter((name) => name.endsWith('.yml'))
  let examined = 0
  for (const name of names) {
    const text = readWorkflow(name)
    if (!/^ {2}merge_group:/m.test(text)) continue
    // Matched as INVOCATIONS, not mentions: a comment naming a guard is not a
    // run of it, and running a guard's *.test.mjs is not running the guard.
    const invoked = consumers.filter((consumer) => new RegExp(`(?:node|bash|sh) scripts/${consumer.replace('.', '\.')}(?![a-z.])`).test(text))
    if (invoked.length === 0) continue
    examined += 1
    assert.match(
      text,
      /git fetch (--no-tags )?origin/,
      `${name} triggers on merge_group and invokes base-ref consumer(s) ${invoked.join(', ')}, but never fetches the base explicitly`,
    )
  }
  assert.ok(examined > 0, 'no merge_group workflow with a base-ref consumer was examined - the sweep is not running')
})

test('the EOL guard in check-sql.sh fetches its base and still fails closed (#3280)', () => {
  const sql = readFileSync(new URL('../scripts/check-sql.sh', import.meta.url), 'utf8')
  assert.ok(sql.includes('fetch --quiet --no-tags origin "$eol_base_ref"'), 'the EOL guard no longer fetches the base branch explicitly')
  assert.ok(sql.includes('EOL guard cannot resolve base'), 'the EOL guard no longer fails closed when the base cannot be resolved')
})

// 2026-09-28: the Queue interlock job's own permission block omitted
// `issues: read`, so openClaims() saw only pull requests (53 rows, 0 issues)
// and refused every merge group (merge-queue-gate run on pr-3567). Job-level
// permissions REPLACE the workflow-level block, so the job must name it itself.
// #3536: an explicit replay must inspect the selected PR, never inherited main evidence.
test('contract replay retains queue admission and validates exact selected PR identity', () => {
  const text = readWorkflow('pr-guards.yml')
  const job = jobBlockByName(text, 'Agent work contract')
  assert.deepEqual(jobEvents(job), ['merge_group', 'workflow_dispatch'])
  assert.match(text, /agent_contract_pr_number:/)
  assert.match(job, /\^\[1-9\]\[0-9\]\*\$/)
  assert.match(job, /\.state == "open"/)
  assert.match(job, /\.base\.ref == "main"/)
  assert.match(job, /\.base\.repo\.full_name == \$repo/)
  assert.match(job, /git fetch --no-tags origin "\$BASE_SHA" "\$HEAD_SHA"/)
  assert.match(job, /if \[ "\$EVENT_NAME" = "workflow_dispatch" \]; then git checkout --detach "\$HEAD_SHA"; fi/)
  assert.match(job, /--pr-base-sha "\$PR_BASE_SHA"/)
  assert.match(job, /--pr-head-sha "\$PR_HEAD_SHA"/)
  assert.match(job, /--expected-pr "\$PR_NUMBER" --expected-head-sha "\$PR_HEAD_SHA"/)
  assert.match(job, /node --test/)
})

test('manual replay runs base-owned evaluators against exact head evidence', async()=>{
  const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join,resolve}=await import('node:path')
  const {execFileSync,spawnSync}=await import('node:child_process')
  const cwd=mkdtempSync(join(tmpdir(),'contract-replay-'))
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim()
  try {
    git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture')
    writeFileSync(join(cwd,'base.txt'),'base');git('add','base.txt');git('commit','-qm','base');const base=git('rev-parse','HEAD')
    mkdirSync(join(cwd,'.agent/work/11/1'),{recursive:true});mkdirSync(join(cwd,'scripts'),{recursive:true})
    writeFileSync(join(cwd,'.agent/work/11/1/contract.json'),JSON.stringify({schema_version:1,work_issue:11}))
    writeFileSync(join(cwd,'.agent/work/11/1/completion.json'),'{}')
    writeFileSync(join(cwd,'scripts/agent-work-contract.mjs'),'process.exit(0)')
    git('add','.agent','scripts');git('commit','-qm','forged evaluator and malformed versioned pair');const head=git('rev-parse','HEAD')
    const resolver=resolve(new URL('./agent-work-contract-git-evidence.mjs',import.meta.url).pathname)
    const resolved=execFileSync(process.execPath,[resolver,'--resolve-evidence-pair','--pr-base-sha',base,'--pr-head-sha',head],{cwd,encoding:'utf8'})
    assert.match(resolved,/current \.agent\/work\/11\/1\/contract\.json \.agent\/work\/11\/1\/completion\.json/)
    const evaluator=resolve(new URL('./agent-work-contract.mjs',import.meta.url).pathname)
    const verdict=spawnSync(process.execPath,[evaluator,'--validate-contract','--contract-file','.agent/work/11/1/contract.json'],{cwd,encoding:'utf8'})
    assert.notEqual(verdict.status,0,'head-owned forged evaluator must never decide validation')
    const job=jobBlockByName(readWorkflow('pr-guards.yml'),'Agent work contract')
    assert.match(job,/node trusted-policy\/scripts\/agent-work-contract\.mjs --validate-contract/)
    assert.match(job,/node trusted-policy\/scripts\/agent-work-contract-git-evidence\.mjs/)
    assert.match(job,/--config-file trusted-policy\/config\/agent-work-contract-activation\.json/)
  } finally {rmSync(cwd,{recursive:true,force:true})}
})

test('retained14 runs before every mutation without widening authority secret environments',()=>{
  const workflow=readWorkflow('guarded-migration-merge.yml')
  const guarded=stepBlock(workflow,'Re-prove the head and merge while the lock is held')
  assert.match(guarded,/AUTHORITY_FILE_IDENTITY:/)
  assert.doesNotMatch(guarded,/secrets\.SYNC_TOKEN|AUTHORITY_TOKEN:/)
  assert.match(workflow,/--capture-authority-file/)
  assert.match(workflow,/Remove this run's protected authority scratch file[\s\S]*if: always\(\)[\s\S]*--cleanup-authority-file/)
  const lines=guarded.split('\n')
  const calls=lines.map((line,i)=>({line,i})).filter(({line})=>/^\s*(?:if )?gh pr merge /.test(line)||/^\s*admit_to_queue\s*$/.test(line))
  assert.equal(calls.length,3)
  for(const {i}of calls)assert.equal(lines[i-1].trim(),'prove_retained_all14')
  assert.match(guarded,/\[ "\$PR_NUMBER" = 3998 \] \|\| return 0/)
  assert.match(guarded,/QUEUE_RETIREMENT_PHASE=14 PREFLIGHT_WAIT_SECONDS=0/)
  assert.match(guarded,/git\/ref\/db-coordination\/merge/)
  assert.match(guarded,/matching-refs\/db-coordination\/promotion-freeze/)
  assert.equal((workflow.match(/export QUEUE_RETIREMENT_PHASE=13/g)??[]).length,2)
})

test('all job executable scripts use protected source before any credential and while scratch exists',()=>{
 const workflow=readWorkflow('guarded-migration-merge.yml')
 assert.doesNotMatch(workflow,/\b(?:node|bash|python3?) scripts\//)
 assert.doesNotMatch(workflow,/node "\$GITHUB_WORKSPACE\/scripts\//)
 const binding=workflow.indexOf('Bind protected executable source and PR data before credentials')
 const firstAuthority=workflow.indexOf('AUTHORITY_TOKEN:')
 assert.ok(binding>=0&&binding<firstAuthority)
 assert.match(workflow,/--data-root "\$GITHUB_WORKSPACE" --head-sha/)
 for(const name of ['NODE_OPTIONS','BASH_ENV','PYTHONPATH','LD_PRELOAD','GIT_EXTERNAL_DIFF']) assert.match(workflow,new RegExp(name+": ''"))
 assert.match(workflow,/GIT_CONFIG_GLOBAL: \/dev\/null/)
 assert.match(workflow,/check-sql\.sh" --data-root/)
 assert.match(workflow,/check-production-verification-sidecars\.mjs" --base origin\/main --data-root/)
})

// #4729: the merge-lane hold must outlast the slowest required merge-group check
// (supabase/tests, ~7 minutes) and stay inside its job timeout.
test('preview ordering uses the candidate migration paths and retains the latest first-parent migration target', () => {
  const text = readWorkflow('merge-queue-gate.yml')
  assert.ok(text.includes('--preview-rehearsal-target --base-sha "$BASE_SHA" --group-sha "$GITHUB_SHA"'))
  assert.ok(text.includes('--require-preview-rehearsal --sha "$target"'))
  assert.ok(text.includes('--require-preview-rehearsal --sha "$target" --base-sha "$BASE_SHA"'), 'the hold must name the group base so descendant rehearsals are bounded by it (#4782)')
  assert.ok(!text.includes('--require-preview-rehearsal --sha "$BASE_SHA"'))
})

// #4731: queue admission must use the dedicated admission app token, never
// github.token alone (GITHUB_TOKEN-created queue entries start no merge_group
// checks) and never a broad authority secret.
test('guarded merge admits to the queue with the merge-queue admission app token', () => {
  const src = readFileSync(new URL('../.github/workflows/guarded-migration-merge.yml', import.meta.url), 'utf8')
  assert.match(src, /id: queue_admission_token[\s\S]*?app-id: \$\{\{ secrets\.MERGE_QUEUE_ADMISSION_APP_ID \}\}[\s\S]*?permission-merge-queues: write/)
  assert.match(src, /QUEUE_ADMISSION_TOKEN: \$\{\{ steps\.queue_admission_token\.outputs\.token \|\| github\.token \}\}/)
  assert.match(src, /GH_TOKEN="\$QUEUE_ADMISSION_TOKEN" gh api graphql[\s\S]*?enqueuePullRequest\(input:\{pullRequestId:\$id,expectedHeadOid:\$oid\}\)/)
  const admissions = src.match(/^\s*admit_to_queue\s*$/gm) ?? []
  assert.equal(admissions.length, 2, 'both queue-mode admissions must go through admit_to_queue')
  const mint = src.match(/id: queue_admission_token[\s\S]*?(?=\n\s*- name:)/)[0]
  // Exactly the two permissions GitHub's enqueue needs, nothing broader.
  assert.deepEqual(mint.match(/permission-[a-z-]+: \w+/g), ['permission-contents: write', 'permission-merge-queues: write'])
  assert.doesNotMatch(mint, /SYNC_TOKEN|AUTHORITY_TOKEN/)
})

// A full pre-acquisition wait must retain the original post-acquisition margin.
test('guarded merge preserves twenty minutes after its busy-lane wait', () => {
  const src = readWorkflow('guarded-migration-merge.yml')
  const job = src.slice(src.indexOf('  merge:\n'))
  const minutes = Number(job.match(/timeout-minutes: (\d+)/)?.[1])
  const seconds = Number(job.match(/acquire-merge-lane-waiting\.mjs" --wait-seconds (\d+)/)?.[1])
  assert.equal(seconds, 900)
  assert.ok(minutes * 60 >= seconds + 20 * 60)
})
