import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { acceptedApplyArtifactNames, compareAncestry, dispatchCommitFromTitle, applyArtifactName } from './production-apply-artifact-name.mjs'
import { parseOriginalUpload } from '../designflow-db-release.mjs'
import { assertCurrentLiveProducer } from './production-catalog-recovery.mjs'

// Shapes from run 42519276272 (#5974): dispatched 9a9d…, executed at 4ae9….
const dispatched = '9'.repeat(40), head = '4'.repeat(40), other = 'e'.repeat(40)
const run = { head_sha: head, display_title: `DB production apply ${dispatched} PR5944 20261108135128` }
const ancestorOnly = (base, h) => base === dispatched && h === head

test('run-name dispatch commit parses only from a production apply title', () => {
  assert.equal(dispatchCommitFromTitle(run.display_title), dispatched)
  for (const t of [undefined, '', `DB preview apply ${dispatched} PR1 20261108135128`, `INDEX production x ${dispatched}`,
    `DB production apply ${dispatched} PR5944 `, `DB production apply ${"A".repeat(40)} PR5944 20261108135128`])
    assert.equal(dispatchCommitFromTitle(t), null)
})

test('head-named evidence is always accepted', () => {
  assert.deepEqual([...acceptedApplyArtifactNames(run, () => false)], [applyArtifactName(head)])
})

test('dispatch-named evidence is accepted only with verified ancestry to the run head', () => {
  assert.ok(acceptedApplyArtifactNames(run, ancestorOnly).has(applyArtifactName(dispatched)))
  assert.ok(!acceptedApplyArtifactNames(run, () => false).has(applyArtifactName(dispatched)))
  assert.ok(!acceptedApplyArtifactNames(run, undefined).has(applyArtifactName(dispatched)))
  assert.ok(!acceptedApplyArtifactNames(run, () => 'true').has(applyArtifactName(dispatched)))
})

test('no arbitrary commit is ever accepted', () => {
  const names = acceptedApplyArtifactNames(run, () => true)
  assert.equal(names.size, 2)
  assert.ok(!names.has(applyArtifactName(other)))
  assert.equal(acceptedApplyArtifactNames({ head_sha: 'nope', display_title: run.display_title }, () => true).size, 0)
  assert.equal(acceptedApplyArtifactNames({ ...run, display_title: 'DB production apply' }, () => true).size, 1)
})

test('compare ancestry requires ahead/identical with nothing behind, and fails closed', () => {
  assert.equal(compareAncestry(() => ({ status: 'ahead', behind_by: 0 }))(dispatched, head), true)
  assert.equal(compareAncestry(() => ({ status: 'identical', behind_by: 0 }))(dispatched, head), true)
  assert.equal(compareAncestry(() => ({ status: 'diverged', behind_by: 1 }))(dispatched, head), false)
  assert.equal(compareAncestry(() => ({ status: 'behind', behind_by: 2 }))(dispatched, head), false)
  assert.equal(compareAncestry(() => { throw Error('404') })(dispatched, head), false)
})

test('original upload parsing accepts dispatch-named upload only when the caller proved it', () => {
  const log = `Artifact ID 12\nSHA256 digest of uploaded artifact zip is ${'b'.repeat(64)}\nArtifact ${applyArtifactName(dispatched)}.zip successfully finalized\n`
  assert.throws(() => parseOriginalUpload(log, run, 3))
  assert.equal(parseOriginalUpload(log, run, 3, acceptedApplyArtifactNames(run, ancestorOnly)).artifact_id, 12)
  assert.throws(() => parseOriginalUpload(log.replace(dispatched, other), run, 3, acceptedApplyArtifactNames(run, ancestorOnly)))
})

test('current-live producer custody accepts the run-name dispatch commit but not another commit', () => {
  const names = ['SQL migration guards', 'Production apply review (immutable evidence + hard guards)', 'Production apply (automatic evidence gates)']
  const original = { id: 10, run_attempt: 1, head_branch: 'main', head_sha: head, display_title: run.display_title,
    path: '.github/workflows/shared-supabase-migrations.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success' }
  const jobs = { total_count: 3, jobs: names.map((name, i) => ({ id: 20 + i, run_id: 10, run_attempt: 1, name, status: 'completed', conclusion: 'success' })) }
  const producer = name => ({ original, jobs, later: [], latestAttempt: 1, artifact: null, absence: 'authenticated-404',
    upload: { artifact_id: 30, digest: `sha256:${'c'.repeat(64)}`, name, job_id: 22, log_sha256: 'f'.repeat(64) } })
  assert.equal(assertCurrentLiveProducer(producer(applyArtifactName(head))), true)
  assert.equal(assertCurrentLiveProducer(producer(applyArtifactName(dispatched))), true)
  assert.throws(() => assertCurrentLiveProducer(producer(applyArtifactName(other))))
})

test('the apply workflow names its evidence after the commit the run executed at', () => {
  const wf = readFileSync(new URL('../../.github/workflows/shared-supabase-migrations.yml', import.meta.url), 'utf8')
  assert.match(wf, /name: production-migration-apply-\$\{\{ github\.sha \}\}/)
  assert.doesNotMatch(wf, /name: production-migration-apply-\$\{\{ inputs\.commit_sha \}\}/)
})
