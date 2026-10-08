import test from 'node:test'
import { readFileSync, mkdtempSync, rmSync, chmodSync, linkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { authorityScratchPath, captureAuthorityFile, readScratchAuthorityToken, cleanupAuthorityFile, RETAINED_QUEUE_CHECKS, validateRetirement, evaluatePreflight, gatherPreflightInput, observedStates, isWaitableRefusal, collectPages, requireWholePage, waitForPreflight, PreflightError, SELF_CONTEXT, GITHUB_ACTIONS_APP_ID } from './check-required-checks-preflight.mjs'
import { readEffectiveRequiredChecks, computeRevision, RequiredCheckAuthorityError } from './lib/required-check-authority.mjs'
const sha = 'a'.repeat(40)
function makeAuthority(overrides = {}) {
  const base = {
    mode: 'live-effective-settings',
    repository_id: 1,
    repository: 'popcre/shared-db',
    branch: 'main',
    sources: { classic: null, rulesets: [] },
    checks: [{ context: 'required', app_id: GITHUB_ACTIONS_APP_ID }, { context: SELF_CONTEXT, app_id: GITHUB_ACTIONS_APP_ID }],
  }
  const merged = { ...base, ...overrides }
  merged.revision = computeRevision(merged)
  return merged
}
const authority = makeAuthority()
const ok = (name = 'required', extra = {}) => ({ name, head_sha: sha, app: { id: GITHUB_ACTIONS_APP_ID }, status: 'completed', conclusion: 'success', started_at: '2026-09-20T10:00:00Z', ...extra })
const evaluate = (extra = {}) => evaluatePreflight({ authority, sha, checkRuns: [ok()], ...extra })
test('green exact-head required producer passes with only self authorization excluded', () => assert.equal(evaluate().required, 1))
test('required missing, pending, failing, skipped and neutral all refuse', () => {
  assert.throws(() => evaluate({ checkRuns: [] }), /never reported/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { status: 'queued' })] }), /still running/)
  for (const conclusion of ['failure', 'cancelled', 'neutral', 'skipped', 'timed_out']) assert.throws(() => evaluate({ checkRuns: [ok('required', { conclusion })] }), /failing/)
})
test('wrong app and wrong head cannot satisfy required result; later foreign success cannot mask failure', () => {
  assert.throws(() => evaluate({ checkRuns: [ok('required', { app: { id: 7 } })] }), /never reported/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { head_sha: 'c'.repeat(40) })] }), /never reported/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { conclusion: 'failure' }), ok('required', { app: { id: 7 }, started_at: '2026-09-20T11:00:00Z' })] }), /failing/)
  assert.throws(() => evaluate({ checkRuns: [], statuses: [{ context: 'required', state: 'success', creator: { id: GITHUB_ACTIONS_APP_ID } }] }), /never reported/)
})
test('advisory failure remains visible without independently vetoing a merge', () => {
  const result = evaluate({ checkRuns: [ok(), ok('optional', { conclusion: 'failure' })] })
  assert.deepEqual(result.advisory, [['optional', 'failure']])
  assert.match(result.shadow, /would refuse advisory/)
})
test('an unexpired attestation never substitutes for fresh effective settings', () => {
  assert.throws(() => evaluate({ authority: { ...makeAuthority(), mode: 'snapshot', expires: '2099-01-01' } }), /fresh effective/)
})
test('a newly effective requirement is enforced even with a still-valid old snapshot', () => {
  const current = makeAuthority({ checks: [...authority.checks, { context: 'new ruleset requirement', app_id: 7 }] })
  assert.throws(() => evaluate({ authority: current, snapshot: authority }), /never reported: new ruleset/)
})
test('same name requirements from two apps both apply; self authorization cannot change producer', () => {
  assert.throws(() => evaluate({ authority: makeAuthority({ checks: [...authority.checks, { context: 'required', app_id: 7 }] }) }), /app 7/)
  assert.throws(() => evaluate({ authority: makeAuthority({ checks: [{ context: SELF_CONTEXT, app_id: 7 }, { context: 'required', app_id: GITHUB_ACTIONS_APP_ID }] }) }), /different producer/)
})
test('revision digest is rebound to content; a tampered or stale digest refuses', () => {
  const tampered = { ...makeAuthority(), revision: 'b'.repeat(64) }
  assert.throws(() => evaluate({ authority: tampered }), /revision does not match its own content/)
  const changedChecks = { ...makeAuthority(), checks: [{ context: 'different requirement', app_id: GITHUB_ACTIONS_APP_ID }] }
  assert.throws(() => evaluate({ authority: changedChecks }), /revision does not match its own content/)
})
test('GITHUB_ACTIONS_APP_ID is the documented GitHub Actions producer identity', () => {
  assert.equal(GITHUB_ACTIONS_APP_ID, 15368)
  assert.ok(Number.isSafeInteger(GITHUB_ACTIONS_APP_ID) && GITHUB_ACTIONS_APP_ID > 0)
})
test('latest attempt wins within producer; same-time contradictory results refuse', () => {
  assert.throws(() => evaluate({ checkRuns: [ok(), ok('required', { status: 'queued', started_at: '2026-09-20T11:00:00Z' })] }), /still running/)
  assert.throws(() => evaluate({ checkRuns: [ok(), ok('required', { conclusion: 'failure' })] }), /ambiguous/)
  assert.equal(observedStates({ statuses: [{ context: 'x', state: 'success', id: 1 }] }).get('x'), 'success')
})
function liveRead({ mutateAfter = false, mutateAfterRead = 1, deny = false, truncate = false } = {}) {
  let reads = 0
  return (args) => {
    if (args.includes('graphql')) {
      if (deny) throw Error('403 integration cannot read')
      reads++
      return { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: { id: 'BPR_1', requiresStatusChecks: true, requiresStrictStatusChecks: false, requiredStatusCheckContexts: ['required'], requiredStatusChecks: [{ context: 'required', app: { databaseId: 15368 } }] } } } } }
    }
    if (args.some((arg) => arg.includes('/rules/branches/'))) return [mutateAfter && reads > mutateAfterRead ? [{ type: 'required_status_checks', ruleset_id: 2, ruleset_source: 'popcre', ruleset_source_type: 'Organization', parameters: { required_status_checks: [{ context: 'new', integration_id: 7 }] } }] : []]
    if (args.some((arg) => arg.includes('/check-runs'))) return [{ total_count: truncate ? 2 : 1, check_runs: [ok('required', { id: 1 })] }]
    return [{ total_count: 0, statuses: [] }]
  }
}
test('gather checks effective settings before and after paginated statuses and refuses mutation', () => {
  const input = gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead() })
  assert.equal(evaluatePreflight(input).required, 1)
  assert.throws(() => gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead({ mutateAfter: true }) }), /changed during/)
  assert.throws(() => gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead({ deny: true }) }), /no snapshot fallback/)
  assert.throws(() => gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: liveRead({ truncate: true }) }), /pagination returned only/)
})
test('authority reads use AUTHORITY_TOKEN only and restore GH_TOKEN for status reads', () => {
  const previous = process.env.GH_TOKEN
  process.env.GH_TOKEN = 'ordinary-test-token'
  const observed = []
  const source = liveRead()
  try {
    const input = gatherPreflightInput({ REQUESTED_SHA: sha, AUTHORITY_TOKEN: 'authority-test-token' }, {
      repo: 'popcre/shared-db',
      json(args) {
        observed.push({ authority: args.includes('graphql') || args.some((arg) => String(arg).includes('/rules/branches/')), token: process.env.GH_TOKEN })
        return source(args)
      },
    })
    assert.equal(evaluatePreflight(input).required, 1)
    assert.ok(observed.some(({ authority, token }) => authority && token === 'authority-test-token'))
    assert.ok(observed.some(({ authority, token }) => !authority && token === 'ordinary-test-token'))
    assert.ok(observed.every(({ authority, token }) => token === (authority ? 'authority-test-token' : 'ordinary-test-token')))
    assert.equal(process.env.GH_TOKEN, 'ordinary-test-token')
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = previous
  }
})
test('pagination preserves all pages and refuses incomplete totals', () => {
  assert.deepEqual(collectPages([{ check_runs: [1] }, { check_runs: [2] }], 'check_runs'), [1, 2])
  assert.throws(() => collectPages([{}], 'check_runs'), /no usable/)
  assert.throws(() => requireWholePage('checks', undefined, []), /how many/)
})
test('ruleset pagination refuses a short non-last page (fail-open guard)', () => {
  const rule = { type: 'required_status_checks', ruleset_id: 1, ruleset_source: 'popcre', ruleset_source_type: 'Organization', parameters: { required_status_checks: [{ context: 'required', integration_id: 15368 }] } }
  const graphql = { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: null } } } }
  // Probe mock: REST /protection returns 404 (genuine absence of classic rule).
  const probe404 = () => { const err = Error('gh: Not Found (HTTP 404)'); err.stderr = 'gh: Not Found (HTTP 404)'; throw err }
  const okRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    // Two pages: first has 1 rule (short), second has 1 rule. With per_page=100
    // the first page is incomplete → must refuse.
    return [[rule], [rule]]
  }
  assert.throws(() => readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: okRead }), (err) => err instanceof RequiredCheckAuthorityError && /pagination is incomplete/.test(err.message))
  // Single full-length page (exactly per_page) is ambiguous: --paginate may have
  // stopped at a Link boundary. Refuse unless a second (even empty) page
  // confirms the end.
  const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...rule, ruleset_id: i + 1, parameters: { required_status_checks: [{ context: `c${i}`, integration_id: 15368 }] } }))
  const truncatedRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    return [fullPage]
  }
  assert.throws(() => readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: truncatedRead }), (err) => err instanceof RequiredCheckAuthorityError && /pagination is incomplete/.test(err.message))
  // With a confirming empty second page, a single full page is accepted.
  const fullRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    if (args.some((arg) => String(arg).includes('page=2'))) return []
    return [fullPage]
  }
  const result = readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: fullRead })
  assert.equal(result.checks.length, 100)
  // Two pages where the first is exactly per_page and the second is partial → accepted.
  const partialLast = [[...fullPage], [rule]]
  const partialRead = (args) => {
    if (args.includes('graphql')) return graphql
    if (args.some((arg) => /\/branches\/[^/]+\/protection$/.test(String(arg)))) return probe404()
    return partialLast
  }
  const result2 = readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read: partialRead })
  assert.equal(result2.checks.length, 101)
})
test('waiting rereads authority, never waits a failure or unknown authority, and bounds pending waits', async () => {
  let time = 0, reads = 0
  const deps = { now: () => time, sleep: async (ms) => { time += ms }, log() {}, gather() { reads++; return {} }, evaluate() { if (reads < 2) throw new PreflightError('still running: required'); return { required: 1 } } }
  assert.equal((await waitForPreflight({ PREFLIGHT_WAIT_SECONDS: '2', PREFLIGHT_POLL_SECONDS: '1' }, deps)).required, 1)
  assert.equal(reads, 2)
  for (const message of ['failing: required', 'authority unreadable']) await assert.rejects(waitForPreflight({}, { ...deps, evaluate() { throw new PreflightError(message) } }), new RegExp(message))
  await assert.rejects(waitForPreflight({ PREFLIGHT_WAIT_SECONDS: '0' }, { ...deps, evaluate() { throw new PreflightError('never reported: required') } }), /Waited/)
})

test('new queued check with no timestamp cannot be hidden behind a completed older run', () => {
  assert.throws(() => evaluate({ checkRuns: [ok('required', { id: 1 }), ok('required', { id: 2, status: 'queued', started_at: null, completed_at: null })] }), /still running/)
  assert.throws(() => evaluate({ checkRuns: [ok('required', { started_at: 'invalid', completed_at: null })] }), /ambiguous/)
})
test('unrestricted same-name commit status and check must both pass', () => {
  const unrestricted = makeAuthority({ checks: [{ context: 'required', app_id: null }] })
  assert.throws(() => evaluate({ authority: unrestricted, statuses: [{ context: 'required', state: 'failure', id: 1 }] }), /failing/)
  assert.equal(evaluate({ authority: unrestricted, statuses: [{ context: 'required', state: 'success', id: 1 }] }).required, 1)
})
test('app-bound requirement: failing status without app field stays visible behind a passing check run', () => {
  // REST commit statuses carry `creator`, not `app`. A red status must never
  // hide behind a green same-name check run (BOTH-channels invariant).
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'failure', id: 1 }] }), /failing/)
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'error', id: 1 }] }), /failing/)
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'pending', id: 1 }] }), /still running|ambiguous/)
})
test('app-bound requirement: unverifiable success status cannot satisfy', () => {
  // Without `app` on the status object the producer is unknown; a success from
  // an unknown producer must not satisfy an app-bound requirement (fail-closed).
  assert.throws(() => evaluate({ checkRuns: [], statuses: [{ context: 'required', state: 'success', id: 1 }] }), /never reported/)
})
test('app-bound requirement: known-wrong-app status is excluded entirely', () => {
  // A status from a different app is ignored; the passing check run alone satisfies.
  assert.equal(evaluate({ statuses: [{ context: 'required', state: 'failure', id: 1, app: { id: 7 } }] }).required, 1)
  // But a status with NO app field (REST reality) that is red must still surface.
  assert.throws(() => evaluate({ statuses: [{ context: 'required', state: 'failure', id: 1 }] }), /failing/)
})

test('protected merge preflight preserves exact-once runner lane accounting after aggregate retirement', () => {
  const T = 'Tools offline tests', P = 'Promotion contract tests (offline)'
  const laneAuthority = makeAuthority({ checks: [T, P, SELF_CONTEXT].map((context) => ({ context, app_id: GITHUB_ACTIONS_APP_ID })) })
  const run = (checkRuns) => evaluatePreflight({ authority: laneAuthority, sha, checkRuns })
  assert.equal(run([ok(T), ok(P)]).required, 2)
  // A late default and its replacement both green must still refuse.
  assert.throws(() => run([ok(T), ok(P), ok(`${T} [lane ubuntu-24.04]`)]), /runner lane accounting refused:.*duplicate assertion/)
  assert.throws(() => run([ok(T), ok(P), ok(`${T} [lane ubuntu-24.04]`, { conclusion: 'failure' })]), /runner lane accounting refused:.*failed assertion/)
  assert.throws(() => run([ok(T), ok(P), ok(`${T} [lane ubuntu-24.04]`, { status: 'queued' })]), /runner lane accounting refused:.*still running/)
  assert.throws(() => run([ok(T), ok(P), ok(`${T} [lane windows-latest]`)]), /unregistered lane/)
  for (const conclusion of ['neutral', 'skipped', 'cancelled']) {
    // An ignored duplicate cannot masquerade as a second successful assertion.
    assert.equal(run([ok(T), ok(P), ok(`${T} [lane ubuntu-24.04]`, { conclusion })]).required, 2)
  }
  // Neither unrelated head nor foreign app can create or hide a counted result.
  assert.equal(run([ok(T), ok(P), ok(`${T} [lane ubuntu-24.04]`, { head_sha: 'b'.repeat(40) }), ok(`${T} [lane ubuntu-24.04]`, { app: { id: 7 } })]).required, 2)
  assert.throws(() => run([ok(T), ok(P, { head_sha: 'b'.repeat(40) })]), /never reported/)
  assert.throws(() => run([ok(T), ok(P, { app: { id: 7 } })]), /never reported/)
})

test('a required registered lane cannot remove the other assertion from merge accounting', () => {
  const laneAuthority = makeAuthority({ checks: [{ context: 'Tools offline tests', app_id: GITHUB_ACTIONS_APP_ID }, { context: SELF_CONTEXT, app_id: GITHUB_ACTIONS_APP_ID }] })
  assert.throws(() => evaluatePreflight({ authority: laneAuthority, sha, checkRuns: [ok('Tools offline tests')] }), /runner lane accounting refused:.*no run reported/)
})


test('lane accounting pending/absent results use the existing bounded waiter; failed/duplicate results cannot wait away', () => {
  const laneAuthority = makeAuthority({ checks: [{ context: 'Tools offline tests', app_id: GITHUB_ACTIONS_APP_ID }, { context: SELF_CONTEXT, app_id: GITHUB_ACTIONS_APP_ID }] })
  const attempt = (runs) => {
    try { evaluatePreflight({ authority: laneAuthority, sha, checkRuns: runs }); assert.fail('expected refusal') }
    catch (error) { assert.ok(error instanceof PreflightError); return isWaitableRefusal(error.message) }
  }
  assert.equal(attempt([ok('Tools offline tests')]), true)
  assert.equal(attempt([ok('Tools offline tests'), ok('Promotion contract tests (offline)', { status: 'queued' })]), true)
  assert.equal(attempt([ok('Tools offline tests'), ok('Promotion contract tests (offline)', { conclusion: 'failure' })]), false)
  assert.equal(attempt([ok('Tools offline tests'), ok('Promotion contract tests (offline)'), ok('Tools offline tests [lane ubuntu-24.04]')]), false)
})


test('all-attempt listing includes queued replacements and newest-name normalization preserves rerun semantics', () => {
  const T = 'Tools offline tests', P = 'Promotion contract tests (offline)'
  const source = liveRead()
  const rows = [ok(T, { id: 1 }), ok(P, { id: 2 }), ok(`${T} [lane ubuntu-24.04]`, { id: 3, status: 'queued' })]
  const json = (args) => {
    if (args.some((arg) => arg.includes('/check-runs'))) {
      assert.ok(args.some((arg) => arg.includes('&filter=all')), 'queued replacements must remain visible')
      return [{ total_count: 3, check_runs: rows.slice(0, 2) }, { total_count: 3, check_runs: rows.slice(2) }]
    }
    const payload = source(args)
    if (args.includes('graphql')) {
      const rule = payload.data.repository.ref.branchProtectionRule
      rule.requiredStatusCheckContexts = [T, P]
      rule.requiredStatusChecks = [T, P].map((context) => ({ context, app: { databaseId: GITHUB_ACTIONS_APP_ID } }))
    }
    return payload
  }
  const input = gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json })
  assert.throws(() => evaluatePreflight(input), /runner lane accounting refused:.*still running/)
  const required = makeAuthority({ checks: [T, P, SELF_CONTEXT].map((context) => ({ context, app_id: GITHUB_ACTIONS_APP_ID })) })
  assert.equal(evaluatePreflight({ authority: required, sha, checkRuns: [ok(T, { id: 1, conclusion: 'failure' }), ok(T, { id: 4 }), ok(P, { id: 2 })] }).required, 2)
  assert.throws(() => evaluatePreflight({ authority: required, sha, checkRuns: [ok(T, { id: 1 }), ok(T, { id: 4, status: 'queued' }), ok(P, { id: 2 })] }), /still running/)
})

test('all-attempt pagination refuses changing totals, repeated ids and missing identities', () => {
  for (const pages of [
    [{ total_count: 1, check_runs: [ok('required', { id: 1 })] }, { total_count: 2, check_runs: [] }],
    [{ total_count: 2, check_runs: [ok('required', { id: 1 }), ok('required', { id: 1 })] }],
    [{ total_count: 1, check_runs: [ok()] }],
  ]) {
    const source = liveRead()
    assert.throws(() => gatherPreflightInput({ REQUESTED_SHA: sha }, { repo: 'popcre/shared-db', json: (args) => args.some((arg) => arg.includes('/check-runs')) ? pages : source(args) }), /unstable read/)
  }
})

function retirementFixture(phase = '14') {
  const checks = RETAINED_QUEUE_CHECKS.filter(c => !['Merge queue gate','Queue-sensitive checks (aggregate)'].includes(c.context))
  const authority = makeAuthority({base_sha:'b'.repeat(40),checks,sources:{classic:{requiresStrictStatusChecks:false},rulesets:[]}})
  const contract = {...JSON.parse(readFileSync(new URL('../docs/examples/agent-work-contract-zero-database.json',import.meta.url))),work_issue:3987,generation:5,base_sha:sha}
  const r = {phase,pr:{number:3998,state:'open',head:{sha,repo:{full_name:'popcre/shared-db'}},base:{ref:'main',repo:{full_name:'popcre/shared-db'}}},
    issue:{number:3987,state:'open'},scope:{workType:'repo-maintenance',route:'repo-maintenance',status:'ready'},links:[{number:3987}],contract,
    receipt:{id:200,context:SELF_CONTEXT,state:'success',creator:{login:'github-actions[bot]'},description:'Exclusive merge lock held and exact head revalidated',url:`https://api.github.com/repos/popcre/shared-db/statuses/${sha}`},
    runId:10,runAttempt:2,sourceSha:authority.base_sha,run:{id:10,run_attempt:2,event:'workflow_dispatch',head_branch:'main',head_sha:authority.base_sha,workflow_id:11,check_suite_id:12},
    workflow:{id:11,path:'.github/workflows/guarded-migration-merge.yml'},suite:{id:12,head_sha:authority.base_sha,app:{id:GITHUB_ACTIONS_APP_ID}}}
  return {authority,retirement:r,sha,statuses:[{...r.receipt}],checkRuns:RETAINED_QUEUE_CHECKS.filter(c=>c.context!==SELF_CONTEXT).map((c,i)=>ok(c.context,{id:i+1}))}
}
test('retained13 and protected genuine14 pass without changing live12 authority',()=>{
  const f=retirementFixture();assert.equal(evaluatePreflight(f).required,14)
  f.retirement.phase='13';f.statuses=[];assert.equal(evaluatePreflight(f).required,13)
  assert.equal(f.authority.checks.length,12)
})
for (const [name,mutate] of Object.entries({
  closed:f=>f.retirement.pr.state='closed',otherPR:f=>f.retirement.pr.number=4002,wrongHead:f=>f.retirement.pr.head.sha='c'.repeat(40),
  notAdmitted:f=>f.retirement.scope.status='blocked',duplicateStatus:f=>f.statuses.push({...f.statuses[0],state:'failure'}),wrongIssue:f=>f.retirement.issue.number=3536,wrongGeneration:f=>f.retirement.contract.generation=4,
  wrongApp:f=>f.retirement.suite.app.id=99,wrongRun:f=>f.retirement.run.id=20,wrongAttempt:f=>f.retirement.run.run_attempt=1,
  wrongEvent:f=>f.retirement.run.event='pull_request',wrongSource:f=>f.retirement.run.head_sha=sha,wrongWorkflow:f=>f.retirement.workflow.path='other.yml',
  wrongCreator:f=>f.statuses[0].creator={login:'u2giants'},wrongReceipt:f=>f.retirement.receipt.id=199,
  replay:f=>f.statuses.push({...f.statuses[0],id:201,state:'failure'}),skipped:f=>f.checkRuns[0].conclusion='skipped',
  missing:f=>f.checkRuns.pop(),failure:f=>f.checkRuns[0].conclusion='failure',policyDrift:f=>{f.authority.checks.pop();f.authority.revision=computeRevision(f.authority)},
  strict:f=>{f.authority.sources.classic.requiresStrictStatusChecks=true;f.authority.revision=computeRevision(f.authority)},
  selfCheckFailure:f=>f.checkRuns.push(ok(SELF_CONTEXT,{id:999,conclusion:'failure'})),selfCheckWrongApp:f=>f.checkRuns.push(ok(SELF_CONTEXT,{id:999,app:{id:99}})),
})) test(`retained14 refuses ${name} before mutation`,()=>{const f=retirementFixture();mutate(f);assert.throws(()=>evaluatePreflight(f),PreflightError)})

function scratchFixture() {
  const dir=mkdtempSync(path.join(os.tmpdir(),'guarded-authority-test-'))
  const env={RUNNER_TEMP:dir,GITHUB_RUN_ID:'10',GITHUB_RUN_ATTEMPT:'2',GITHUB_OUTPUT:path.join(dir,'output'),AUTHORITY_TOKEN:'test-only-token'}
  env.AUTHORITY_FILE_IDENTITY=captureAuthorityFile(env)
  delete env.AUTHORITY_TOKEN
  return {dir,env,file:authorityScratchPath(env)}
}
test('protected scratch token is run-bound, exclusive and cleaned by exact ownership',()=>{
  const f=scratchFixture();try {
    assert.equal(readScratchAuthorityToken(f.env),'test-only-token')
    assert.throws(()=>captureAuthorityFile({...f.env,AUTHORITY_TOKEN:'second'}))
    cleanupAuthorityFile(f.env);assert.throws(()=>readFileSync(f.file))
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})
for(const[name,mutate]of Object.entries({
  permissions:f=>chmodSync(f.file,0o644),hardlink:f=>linkSync(f.file,path.join(f.dir,'link')),
  symlink:f=>{unlinkSync(f.file);symlinkSync(f.env.GITHUB_OUTPUT,f.file)},wrongIdentity:f=>f.env.AUTHORITY_FILE_IDENTITY='1:2:3',
  missing:f=>unlinkSync(f.file),wrongRun:f=>f.env.GITHUB_RUN_ID='11',wrongAttempt:f=>f.env.GITHUB_RUN_ATTEMPT='3',
  malformed:f=>writeFileSync(f.file,'{"token":"test-only-secret-broken'),
  empty:f=>writeFileSync(f.file,''),replacement:f=>{unlinkSync(f.file);writeFileSync(f.file,'{}',{mode:0o600})},
}))test(`protected scratch refuses ${name} read and cleanup`,()=>{const f=scratchFixture();try{mutate(f);assert.throws(()=>readScratchAuthorityToken(f.env));assert.throws(()=>cleanupAuthorityFile(f.env))}finally{rmSync(f.dir,{recursive:true,force:true})}})
test('authority scratch parse refusal never exposes malformed token content',()=>{const f=scratchFixture();try{writeFileSync(f.file,'{"token":"private-fixture-secret');assert.throws(()=>readScratchAuthorityToken(f.env),e=>!e.message.includes('private-fixture-secret'))}finally{rmSync(f.dir,{recursive:true,force:true})}})

test('scratch refuses writable parent and does not delete a collided foreign path',()=>{
  const f=scratchFixture();try{chmodSync(f.dir,0o777);assert.throws(()=>readScratchAuthorityToken(f.env));assert.throws(()=>cleanupAuthorityFile(f.env));assert.ok(readFileSync(f.file).length)}finally{chmodSync(f.dir,0o700);rmSync(f.dir,{recursive:true,force:true})}
})

test('independent final authority read refuses drift after the prior authority proof',()=>{
  assert.throws(()=>gatherPreflightInput({REQUESTED_SHA:sha},{repo:'popcre/shared-db',json:liveRead({mutateAfter:true,mutateAfterRead:2})}),/authority changed while binding/)
})
