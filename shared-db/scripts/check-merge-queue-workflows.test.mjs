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
//      (the list the guarded merge pre-flight enforces);
//   2. KNOWN_LIVE_ADDITIONS below — contexts already live but not yet mirrored.
// The mirror must never shrink this coverage, and this test fails the moment a
// mirrored context has no mapped merge-group-capable emitter.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const readWorkflow = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const MIRROR = JSON.parse(readFileSync(new URL('../docs/verification/main-required-status-checks.json', import.meta.url), 'utf8'))

// Live on main but not yet in the committed mirror. The mirror is rewritten by
// scripts/update-required-checks.mjs from the live read-back; it now equals the
// dated readback artifact below (16 contexts, strict false), so nothing is pending.
const KNOWN_LIVE_ADDITIONS = []

// The exact job-level display names a workflow emits. A literal `name:` emits
// itself; a lane-capable name EXPRESSION emits its `|| '<default>'` branch on
// every non-lane run, which is the only form a required context can take.
function emittedJobNames(text) {
  const names = new Set()
  for (const [, raw] of text.matchAll(/^ {4}name: (.+)$/gm)) {
    const value = raw.trim()
    const expr = /^\$\{\{.*\|\| '([^']+)' \}\}$/.exec(value)
    names.add(expr ? expr[1] : value)
  }
  return names
}

// context -> emitter. kind 'check-run': the workflow job named `job` reports
// the context on whatever commit it runs on, so merge_group coverage means the
// workflow triggers on merge_group. kind 'commit-status': a status is POSTed to
// an explicit SHA — by the guarded merge lane on the reviewed PR head, and by
// the queue gate on the synthetic group SHA.
const CONTEXT_MAP = {
  'Agent work contract': { workflow: 'agent-work-contract.yml', kind: 'check-run', job: 'Agent work contract' },
  'Cancelled work guard': { workflow: 'cancelled-work-guard.yml', kind: 'check-run', job: 'Cancelled work guard' },
  'Cross-PR object collision': { workflow: 'pr-object-collision.yml', kind: 'check-run', job: 'Cross-PR object collision' },
  'Destructive SQL outside migrations': { workflow: 'destructive-analysis-guard.yml', kind: 'check-run', job: 'Destructive SQL outside migrations' },
  'Domain ownership': { workflow: 'domain-ownership.yml', kind: 'check-run', job: 'Domain ownership' },
  'Handoff contract': { workflow: 'handoff-contract-guard.yml', kind: 'check-run', job: 'Handoff contract' },
  'Intake pointer guard': { workflow: 'intake-pointer-guard.yml', kind: 'check-run', job: 'Intake pointer guard' },
  'Migration author lease': { workflow: 'migration-author-lease.yml', kind: 'check-run', job: 'Migration author lease' },
  'Migration guarded merge authorization': { kind: 'commit-status' },
  'Orchestrator marker guard': { workflow: 'orchestrator-marker-guard.yml', kind: 'check-run', job: 'Orchestrator marker guard' },
  'Promotion contract tests (offline)': { workflow: 'coldlion-promotion-contract-tests.yml', kind: 'check-run', job: 'Promotion contract tests (offline)' },
  'Queue-sensitive checks (aggregate)': { workflow: 'queue-sensitive-aggregate.yml', kind: 'check-run', job: 'Queue-sensitive checks (aggregate)' },
  'SQL migration guards': { workflow: 'shared-supabase-migrations.yml', kind: 'check-run', job: 'SQL migration guards' },
  'supabase/tests against an ephemeral database': { workflow: 'database-contract-tests.yml', kind: 'check-run', job: 'supabase/tests against an ephemeral database' },
  'Tools offline tests': { workflow: 'tools-offline-tests.yml', kind: 'check-run', job: 'Tools offline tests' },
  'Merge queue gate': { workflow: 'merge-queue-gate.yml', kind: 'check-run', job: 'Merge queue gate' },
}

test('every mirrored or known-live required context has a mapped emitter', () => {
  const mirrored = MIRROR.contexts
  assert.ok(Array.isArray(mirrored) && mirrored.length > 0, 'the committed mirror carries no contexts; the required list is unknown')
  for (const context of [...mirrored, ...KNOWN_LIVE_ADDITIONS]) {
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
  const text = readWorkflow('destructive-analysis-guard.yml')
  const job = text.slice(text.indexOf('    name: Destructive SQL outside migrations'))
  const at = job.indexOf('      - name: Scan SQL added by the queued group')
  assert.ok(at >= 0, 'the merge_group scan step is missing from the Destructive SQL job')
  const step = job.slice(at, (job.indexOf('\n      - name:', at + 1) + 1 || job.length + 1) - 1)
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

test('every check-run emitter triggers on pull_request AND merge_group checks_requested', () => {
  for (const [context, spec] of Object.entries(CONTEXT_MAP)) {
    if (spec.kind !== 'check-run') continue
    const text = readWorkflow(spec.workflow)
    assert.match(text, /^ {2}pull_request:$/m, `${spec.workflow} (${context}) lost its pull_request trigger`)
    assert.match(text, /^ {2}merge_group:$/m, `${spec.workflow} (${context}) does not trigger for merge_group`)
    assert.match(text, /^ {4}types: \[checks_requested\]$/m, `${spec.workflow} (${context}) does not pin merge_group checks_requested`)
    // Exact object: a job whose display name (literal, or the default branch of a
    // lane-capable name expression) equals the context. A substring or comment is not enough.
    assert.ok(emittedJobNames(text).has(spec.job), `${spec.workflow} does not emit a job named exactly "${spec.job}"`)
  }
})

test('no required-context workflow is path-filtered (a filtered required check stays pending forever)', () => {
  for (const [context, spec] of Object.entries(CONTEXT_MAP)) {
    if (spec.kind !== 'check-run') continue
    const text = readWorkflow(spec.workflow)
    const onBlock = /^on:\n([\s\S]*?)^\w/m.exec(text)?.[1] ?? ''
    assert.ok(!/^ {4}paths(-ignore)?:/m.test(onBlock), `${spec.workflow} (${context}) has a paths filter on a required context`)
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
  for (const name of ['pr-object-collision.yml', 'handoff-contract-guard.yml', 'migration-author-lease.yml', 'agent-work-contract.yml']) {
    const text = readWorkflow(name)
    const usesPayload = /github\.event\.pull_request\.|github\.base_ref|GITHUB_BASE_REF/.test(text)
    if (!usesPayload) continue
    const defended =
      /if: github\.event_name != 'merge_group'/.test(text) ||
      /merge-queue-contract\.mjs --resolve-queue-pr/.test(text) ||
      /github\.base_ref \|\| 'main'/.test(text)
    assert.ok(defended, `${name} consumes pull_request payload fields with no merge_group defence`)
  }
})

test('the queue gate: one-PR identity, ancestry proof, authorization, preview hold, group-SHA status', () => {
  const text = readWorkflow('merge-queue-gate.yml')
  assert.match(text, /^ {2}pull_request:$/m)
  assert.match(text, /^ {2}merge_group:$/m)
  assert.match(text, /name: Merge queue gate/)
  assert.match(text, /^ {2}statuses: write$/m)
  assert.match(text, /MERGE_GROUP_REF: \$\{\{ github\.event\.merge_group\.head_ref \}\}/)
  assert.ok(text.includes('merge-queue-contract.mjs --resolve-queue-pr'), 'the gate does not resolve the queued PR through the contract')
  assert.ok(text.includes('git merge-base --is-ancestor'), 'the gate does not prove the reviewed head is an ancestor of the group commit')
  assert.ok(text.includes('--require-preview-rehearsal'), 'the gate does not hold for the exact-SHA preview rehearsal')
  // The commit status is published on the GROUP sha, never the PR head here.
  assert.ok(text.includes('statuses/$MERGE_GROUP_SHA'), 'the gate does not publish authorization on the merge-group SHA')
  assert.ok(text.includes("context='Migration guarded merge authorization'"), 'the gate does not publish the guarded authorization context')
  assert.match(text, /^ {2}cancel-in-progress: false$/m)
})

// QUEUE INTERLOCK (workflow-refactor closeout §5). The authorize path must own
// the ASYNCHRONOUS MUTATION: acquire the merge lane, re-check authorization and
// the production interlock under that lane, post group-SHA success, and HOLD the
// lane until GitHub lands the merge. Posting success from a pre-wait read and
// releasing the lane is the race this structure exists to close.
test('the authorize job owns the mutation: merge lane before status, re-check under the lane, hold through the merge', () => {
  const text = readWorkflow('merge-queue-gate.yml')
  const authorizeIdx = text.indexOf('\n  authorize:')
  assert.ok(authorizeIdx > -1, 'the queue gate has no authorize job for the asynchronous mutation')
  const authorizeBlock = text.slice(authorizeIdx)

  // The authorize job is intentionally NOT a required check-run. Its name must
  // not collide with the required `Merge queue gate` context; a required
  // check-run still running would keep the group pending while it waits for
  // the merge it is itself blocking.
  assert.match(authorizeBlock, /^ {4}name: Queue interlock$/m, 'the authorize job must be named Queue interlock (not a required context)')
  assert.ok(!/^ {4}name: Merge queue gate$/m.test(authorizeBlock), 'the authorize job must not emit the required Merge queue gate check-run')

  const acquireIdx = authorizeBlock.indexOf('--acquire-merge')
  const recheckIdx = authorizeBlock.indexOf('--recheck-interlock')
  const publishIdx = authorizeBlock.indexOf("statuses/$MERGE_GROUP_SHA")
  const holdIdx = authorizeBlock.indexOf('Hold the merge lane through the actual merge')
  const releaseIdx = authorizeBlock.indexOf('--release-merge')

  assert.ok(acquireIdx > -1, 'the authorize job never acquires the exclusive merge lane')
  assert.ok(recheckIdx > acquireIdx, 'the interlock re-check must run AFTER the merge lane is acquired')
  assert.ok(publishIdx > recheckIdx, 'group-SHA authorization must be published AFTER the interlock re-check')
  assert.ok(holdIdx > publishIdx, 'the authorize job must hold the lane through the actual merge after posting success')
  assert.ok(releaseIdx > holdIdx, 'the merge lane must be released only after the hold-through-merge step')

  // Ownership is the lane hold, not the status write: the hold step must poll
  // for the live PR state and refuse a non-merge terminal state.
  assert.ok(authorizeBlock.includes("state = 'MERGED'") || authorizeBlock.includes('MERGED'), 'the hold step must observe the actual merge')
  assert.ok(authorizeBlock.includes('Refusing') || authorizeBlock.includes('REFUSED') || authorizeBlock.includes('revok'),
    'the hold path must fail closed and revoke when the mutation does not land')

  // The re-check must cover BOTH halves of the interlock: PR-head authorization
  // freshness and the production lane.
  assert.ok(text.includes('--recheck-interlock'), 'no --recheck-interlock call exists anywhere in the queue gate')
  assert.match(text, /recheck-interlock --head-sha/, 'the re-check must pin the exact PR head SHA')
})

test('the verify job does not post group-SHA success before the interlock re-check', () => {
  const text = readWorkflow('merge-queue-gate.yml')
  const verifyBlock = text.slice(text.indexOf('\n  verify:'), text.indexOf('\n  authorize:'))
  // Success publishing lives only in authorize. verify may post fail-closed
  // failure, never success, so a stale pre-wait read cannot authorize the merge.
  assert.ok(!/state=success/.test(verifyBlock), 'verify must not post success authorization; that is the authorize job under the merge lock')
  assert.ok(verifyBlock.includes('state=failure'), 'verify keeps its fail-closed failure publisher')
})

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
  const gate = readWorkflow('merge-queue-gate.yml')
  assert.ok(gate.includes('--authorization-state'), 'the queue gate must use --authorization-state')
  assert.ok(gate.includes('--recheck-interlock'), 'the queue gate must use --recheck-interlock')
  const guarded = readWorkflow('guarded-migration-merge.yml')
  assert.ok(guarded.includes('--authorization-state'), 'the guarded lane readback must use --authorization-state')
  const migrations = readWorkflow('shared-supabase-migrations.yml')
  assert.ok(migrations.includes('--authorization-state'), 'production dispatch must use --authorization-state')
  assert.ok(migrations.includes('--authorization-row'), 'freeze-lift clearing must use --authorization-row')
  const contract = readFileSync(new URL('../scripts/merge-queue-contract.mjs', import.meta.url), 'utf8')
  assert.ok(contract.includes('/statuses?per_page=100'), 'the shared reader must use the paginated /statuses collection')
  assert.ok(contract.includes('--paginate') && contract.includes('--slurp'), 'the shared reader must paginate')
})

test('the guarded merge lane is dual-mode and never uses --admin', () => {
  const text = readWorkflow('guarded-migration-merge.yml')
  assert.ok(text.includes('--queue-mode'), 'the guarded lane does not read live queue state')
  assert.ok(!text.includes('--admin'), 'the guarded lane must never bypass with --admin')
  assert.ok(text.includes('--match-head-commit'), 'the guarded lane dropped exact-head matching')
})

test('the preview rehearsal publishes the exact rehearsed main SHA, and only on success', () => {
  const text = readWorkflow('shared-supabase-migrations.yml')
  const preview = /^ {2}preview:\n([\s\S]*?)^ {2}[a-z]/m.exec(text)?.[1] ?? ''
  assert.ok(preview, 'the preview job was not found in shared-supabase-migrations.yml')
  assert.match(preview, /^ {6}statuses: write$/m, 'the preview job cannot publish commit statuses')
  assert.ok(preview.includes("context='Post-merge preview rehearsal'"), 'the preview job does not publish the rehearsal status')
  assert.ok(preview.includes('if: success() &&'), 'the rehearsal status is not gated on success() — a failure must never post success')
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
    'check-exact-head-approval.mjs',
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
