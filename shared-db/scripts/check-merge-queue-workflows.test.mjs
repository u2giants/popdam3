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

const MIRROR = JSON.parse(readFileSync(new URL('../docs/verification/main-required-status-checks.json', import.meta.url), 'utf8'))

// Live on main but not yet in the committed mirror. The mirror is rewritten by
// scripts/update-required-checks.mjs from the live read-back; it now equals the
// dated readback artifact below (16 contexts, strict false), so nothing is pending.
const KNOWN_LIVE_ADDITIONS = []
// Contexts still present in the dated mirror but no longer live-required and no
// longer emitted: the Orchestrator marker guard was retired with the role (#3874);
// live branch protection already omitted it (made advisory 2026-09-28).
const RETIRED_MIRROR_CONTEXTS = new Set(['Orchestrator marker guard', 'Agent work contract', 'Migration author lease', 'Migration guarded merge authorization'])

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
    ...['handoff-contract', 'pr-object-collision'].map((id) => [`pr-guards.yml#${id}`, guards.get(id)]),
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

// ISSUE #5370. The "Revalidate migration order" step runs the contract's
// no-args ascending-version order check, which resolves its PR number from
// PR_NUMBER or, in merge_group context, from MERGE_GROUP_REF. The step
// historically carried only GH_TOKEN, so the check refused on every merge_group
// run and the guard was silently dead. The step must feed the queued PR
// identity it already resolved, and the order check must still run bare.
function revalidateIdentityProblems(step) {
  if (!step) return ['the Revalidate migration order step is missing']
  const problems = []
  if (!/^ {10}MERGE_GROUP_REF: \$\{\{ github\.event\.merge_group\.head_ref \}\}$/m.test(step)) problems.push('the revalidation step does not feed MERGE_GROUP_REF')
  if (!/^ {10}PR_NUMBER: \$\{\{ steps\.queue\.outputs\.pr \}\}$/m.test(step)) problems.push('the revalidation step does not feed PR_NUMBER')
  if (!/node scripts\/merge-queue-contract\.mjs\n/m.test(step)) problems.push('the bare ascending-version order check is missing')
  return problems
}

test('the queue gate feeds the queued PR identity to the migration-order re-validation (issue #5370)', () => {
  const job = jobBlockByName(readWorkflow('merge-queue-gate.yml'), 'Merge queue gate')
  assert.ok(job, 'no job emits Merge queue gate')
  const step = stepBlock(job, 'Revalidate migration order')
  assert.deepEqual(revalidateIdentityProblems(step), [])
  // Negative fixture: a step that feeds no PR identity must be caught.
  const starved = step.replace(/^ {10}(?:MERGE_GROUP_REF|PR_NUMBER): .*\n/gm, '')
  assert.notEqual(starved, step, 'the negative fixture did not change the step')
  assert.deepEqual(revalidateIdentityProblems(starved), [
    'the revalidation step does not feed MERGE_GROUP_REF',
    'the revalidation step does not feed PR_NUMBER',
  ])
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
  const workflows = ['merge-queue-gate.yml', 'shared-supabase-migrations.yml']
  for (const name of workflows) {
    const text = readWorkflow(name)
    assert.ok(!/\| first \|/.test(text), `${name} still uses jq first on a status list`)
    assert.ok(!/commits\/\$\{[^}]+\}\/status['"]/.test(text) && !/commits\/\$[A-Z_]+\/status['"]/.test(text),
      `${name} still reads the combined /status page`)
  }
  const migrations = readWorkflow('shared-supabase-migrations.yml')
  assert.ok(!migrations.includes('--authorization-state'), 'production dispatch no longer reads guarded authorization (#2172 C2)')
  assert.ok(!migrations.includes('--authorization-row'), 'the production freeze no longer revokes or restores authorizations (#2172 C2)')
  const contract = readFileSync(new URL('../scripts/merge-queue-contract.mjs', import.meta.url), 'utf8')
  assert.ok(contract.includes('/statuses?per_page=100'), 'the shared reader must use the paginated /statuses collection')
  assert.ok(contract.includes('--paginate') && contract.includes('--slurp'), 'the shared reader must paginate')
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

// A full pre-acquisition wait must retain the original post-acquisition margin.
