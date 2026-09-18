import test from 'node:test'
import { currentRepository, expectedOperatorAssociation } from './lib/repository-identity.mjs'
// Fixtures follow the resolved repository identity and its operator association (#3255).
const THIS_REPO = currentRepository(), OPERATOR_ASSOCIATION = expectedOperatorAssociation()
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { parseArgs, declaredInputs, normalizeDigest, pickEvidenceDigest, buildInputs, assertDeclared, plan, main, DispatchError, WORKFLOW } from './dispatch-production-apply.mjs'

const SHA = 'a'.repeat(40)
const HEX = 'b'.repeat(64)
const workflowText = execFileSync('git', ['show', `HEAD:${WORKFLOW}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

test('#507(c) arguments refuse incomplete or contradictory requests before any lookup', () => {
  assert.throws(() => parseArgs(['--versions', '20260101000000']), /--mode must be/)
  assert.throws(() => parseArgs(['--versions', '2026', '--mode', 'dry-run']), /14-digit/)
  assert.throws(() => parseArgs(['--versions', '20260101000000', '--mode', 'apply']), /--review-run-id/)
  assert.throws(() => parseArgs(['--versions', '20260101000000', '--mode', 'apply', '--review-run-id', '1']), /--source-pr and --work-issue/)
  assert.throws(() => parseArgs(['--versions', '20260101000000', '--mode', 'dry-run', '--review-run-id', '1']), /dry-run takes no reviewRunId/)
  assert.throws(() => parseArgs(['--versions', '20260101000000', '--mode', 'dry-run', '--bogus', 'x']), /unknown or incomplete option --bogus/)
  assert.throws(() => parseArgs(['--versions', '20260101000000', '--mode', 'apply', '--review-run-id', '1', '--source-pr', '2', '--work-issue', '3', '--preview-run-id', '4', '--ephemeral-check-run-id', '5']), /not both/)
  assert.deepEqual(parseArgs(['--versions', '20260101000000, 20260102000000', '--mode', 'dry-run', '--dispatch']).versions, ['20260101000000', '20260102000000'])
})

test('#507(c) every input the helper can send is declared by the real workflow', () => {
  const declared = declaredInputs(workflowText)
  const full = buildInputs(
    { mode: 'apply', versions: ['20260101000000'], reviewRunId: 1, sourcePr: 2, workIssue: 3, previewRunId: 4, ownerDecisionRunId: 5, mergedPrIssueBinding: '2:3', derivationOverride: 'x' },
    { commitSha: SHA, digests: { review: `sha256:${HEX}`, preview: `sha256:${HEX}`, owner_decision: `sha256:${HEX}` } },
  )
  assert.doesNotThrow(() => assertDeclared(full, declared))
  assert.doesNotThrow(() => assertDeclared({ ephemeral_check_run_id: '9' }, declared))
  assert.equal(full.confirmation, `APPLY ${SHA}`)
  assert.throws(() => assertDeclared({ ...full, review_digest: 'x' }, declared), /does not declare input\(s\) review_digest; GitHub would answer HTTP 422/)
  const dry = buildInputs({ mode: 'dry-run', versions: ['20260101000000'] }, { commitSha: SHA })
  assert.deepEqual(Object.keys(dry).sort(), ['commit_sha', 'confirmation', 'mode', 'production_allowlist', 'target'])
  assert.equal(dry.confirmation, `DRY-RUN ${SHA}`)
})

test('#507(c) evidence digests come only from one successful run artifact and are normalized', () => {
  assert.equal(normalizeDigest(HEX), `sha256:${HEX}`)
  assert.throws(() => normalizeDigest('md5:1'), /not a sha256/)
  const ok = { status: 'completed', conclusion: 'success' }
  assert.equal(pickEvidenceDigest('review', 1, ok, [{ name: 'automatic-production-apply-review-evidence', digest: HEX }, { name: `preview-migration-apply-${SHA}`, digest: 'x' }]), `sha256:${HEX}`)
  assert.equal(pickEvidenceDigest('preview', 1, ok, [{ name: `preview-migration-apply-${SHA}`, digest: `sha256:${HEX}` }]), `sha256:${HEX}`)
  assert.throws(() => pickEvidenceDigest('review', 1, { status: 'completed', conclusion: 'failure' }, []), /completed\/failure, not a success/)
  assert.throws(() => pickEvidenceDigest('review', 1, ok, [{ name: `production-apply-review-${SHA}`, digest: HEX }]), /0 matching unexpired artifacts/)
  assert.throws(() => pickEvidenceDigest('owner_decision', 1, ok, [{ name: 'production-owner-decision-7', digest: HEX, expired: true }]), /0 matching/)
})

test('#507(c) plan refuses a stale commit and main dispatches one JSON body only with --dispatch', () => {
  const gitRun = (args) => (args[0] === 'rev-parse' ? SHA : args[0] === 'show' ? workflowText : '')
  assert.throws(() => plan({ mode: 'dry-run', versions: ['20260101000000'], commitSha: 'c'.repeat(40) }, { gitRun }), /is not the current origin\/main/)
  const readJson = (args) => (args[1].endsWith('/artifacts?per_page=100') ? { artifacts: [{ name: 'production-apply-review-evidence', digest: HEX }] } : { status: 'completed', conclusion: 'success' })
  const sent = [], logs = []
  const argv = ['--versions', '20260101000000', '--mode', 'apply', '--review-run-id', '11', '--ephemeral-check-run-id', '12', '--source-pr', '2', '--work-issue', '3']
  assert.equal(main(argv, { gitRun, readJson, log: (l) => logs.push(l), send: (repo, body) => sent.push([repo, body]) }), 0)
  assert.equal(sent.length, 0)
  assert.match(logs.at(-1), /Plan only/)
  assert.equal(main([...argv, '--dispatch'], { gitRun, readJson, log: (l) => logs.push(l), send: (repo, body) => sent.push([repo, body]) }), 0)
  assert.equal(sent.length, 1)
  const body = JSON.parse(sent[0][1])
  assert.equal(sent[0][0], THIS_REPO)
  assert.deepEqual(body, { ref: 'main', inputs: { target: 'production', mode: 'apply', production_allowlist: '20260101000000', commit_sha: SHA, confirmation: `APPLY ${SHA}`, review_run_id: '11', review_artifact_digest: `sha256:${HEX}`, source_pr: '2', work_issue: '3', ephemeral_check_run_id: '12' } })
  assert.match(logs.at(-1), /production environment approval/)
  assert.equal(main(['--mode', 'x'], { log: () => {} }), 1)
  assert.ok(new DispatchError('x') instanceof Error)
})
