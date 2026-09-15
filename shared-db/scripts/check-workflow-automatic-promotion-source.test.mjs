// Runs the automatic production qualification job's OWN source guard, under a
// real shell (issue #2729, programme popcre/ai-devops#401 Step 6).
//
// WHY THIS FILE EXISTS
// --------------------
// "Automatic production qualification and dispatch" keyed only on
// merged_preview_source_pr. The sanctioned recovery lane sets
// historical_preview_source_pr, so successful recovery runs 34969488760 (#2860)
// and 34970936447 (#2792) skipped the job and production was dispatched by hand.
//
// The fix must let a single-PR recovery reach the job WITHOUT a weaker gate. So
// this file proves both directions: a recovery whose own preview proof binds the
// source PR, exact main, allowlist and a merge hash qualifies; every other shape
// (maps, both inputs, no proof, a proof for another PR/main/allowlist, no merge
// hash, inactive policy, no digest) refuses before anything is dispatched. It
// then sabotages the guard to show the refusals are real.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = path.join(repoRoot, '.github/workflows/shared-supabase-migrations.yml')
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bashCommand = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash'
const MAIN = 'a'.repeat(40)
const MERGE = 'b'.repeat(40)
const DIGEST = `sha256:${'c'.repeat(64)}`
const ALLOW = '20260901000000,20260902000000'

function workflowText() { return readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n') }

function guardBlock() {
  const text = workflowText()
  const begin = text.indexOf('# >>> BEGIN automatic-promotion-source-guard')
  const end = text.indexOf('# <<< END automatic-promotion-source-guard')
  assert.ok(begin !== -1, 'the automatic-promotion-source-guard BEGIN marker is absent from the workflow')
  assert.ok(end > begin, 'the automatic-promotion-source-guard END marker is absent or out of order')
  const lines = text.slice(text.indexOf('\n', begin) + 1, end).split('\n')
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length))
  return lines.map((l) => l.slice(indent)).join('\n')
}

function jobSection() {
  const text = workflowText()
  return text.split('automatic-production-promotion:', 2)[1].split('\n  production-dry-run:', 1)[0]
}

function runGuard({ env = {}, proof, active = true, block = guardBlock() } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'promotion-source-guard-'))
  mkdirSync(path.join(dir, 'config'))
  writeFileSync(path.join(dir, 'config/production-risk-policy-activation.json'), JSON.stringify({ active }))
  const evidence = path.join(dir, 'historical-preview-source.json')
  if (proof !== undefined) writeFileSync(evidence, JSON.stringify(proof))
  const output = path.join(dir, 'github-output')
  writeFileSync(output, '')
  const childEnv = { ...process.env }
  for (const name of ['SOURCE_PR', 'SOURCE_MAP', 'HISTORICAL_SOURCE_PR', 'HISTORICAL_SOURCE_MAP']) delete childEnv[name]
  Object.assign(childEnv, {
    PREVIEW_DIGEST: DIGEST, MAIN_SHA: MAIN, PREVIEW_ALLOWLIST: ALLOW,
    RECOVERY_EVIDENCE: evidence.replaceAll('\\', '/'), GITHUB_OUTPUT: output.replaceAll('\\', '/'), ...env,
  })
  const run = spawnSync(bashCommand, ['-c', `set -euo pipefail\n${block}\nprintf 'REACHED_THE_WORK\\n'`], { cwd: dir, encoding: 'utf8', env: childEnv })
  return { ...run, outputs: readFileSync(output, 'utf8') }
}

const validProof = (over = {}) => ({ schema: 'v3', sourcePr: 2860, sourceMergeSha: MERGE, mainSha: MAIN, allowlist: ALLOW.split(','), originalApplyRuns: {}, ...over })
const REFUSED = /ENGINEER ACTION REQUIRED/

function assertRefused(run, pattern = REFUSED) {
  assert.notEqual(run.status, 0, `the guard accepted a shape it must refuse: ${run.stdout}`)
  assert.match(run.stderr, pattern)
  assert.ok(!run.stdout.includes('REACHED_THE_WORK'))
  assert.ok(!/source_pr=/.test(run.outputs), 'a refused run still published a qualified source PR')
}

test('a merged single source PR still qualifies exactly as before', () => {
  const run = runGuard({ env: { SOURCE_PR: '2850' } })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.outputs, /^source_pr=2850$/m)
  assert.ok(!/source_merge_sha=/.test(run.outputs))
})

test('a successful single-PR recovery run with its exact proof reaches qualification', () => {
  const run = runGuard({ env: { HISTORICAL_SOURCE_PR: '2860' }, proof: validProof() })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.outputs, /^source_pr=2860$/m)
  assert.match(run.outputs, new RegExp(`^source_merge_sha=${MERGE}$`, 'm'))
})

test('maps and doubly named sources refuse on both lanes', () => {
  assertRefused(runGuard({ env: { SOURCE_MAP: '20260901000000:1' } }))
  assertRefused(runGuard({ env: { HISTORICAL_SOURCE_MAP: '20260901000000:1' }, proof: validProof() }))
  assertRefused(runGuard({ env: { SOURCE_PR: '2860', HISTORICAL_SOURCE_PR: '2860' }, proof: validProof() }))
  assertRefused(runGuard({ env: {} }))
  assertRefused(runGuard({ env: { HISTORICAL_SOURCE_PR: '0' }, proof: validProof() }))
})

test('a recovery without its own bound proof refuses: no weaker gate', () => {
  assertRefused(runGuard({ env: { HISTORICAL_SOURCE_PR: '2860' } }), /carries no historical-preview-source/)
  for (const over of [{ sourcePr: 2792 }, { mainSha: 'd'.repeat(40) }, { allowlist: ['20260901000000'] }, { sourceMergeSha: null }, { sourceMergeSha: 'short' }, { sourcePrMap: { '20260901000000': 2860 } }]) {
    assertRefused(runGuard({ env: { HISTORICAL_SOURCE_PR: '2860' }, proof: validProof(over) }), /does not bind/)
  }
})

test('the shared activation and digest gates apply to recovery exactly as to merged', () => {
  for (const env of [{ SOURCE_PR: '2850' }, { HISTORICAL_SOURCE_PR: '2860' }]) {
    assertRefused(runGuard({ env, proof: validProof(), active: false }), /policy is not active/)
    assertRefused(runGuard({ env: { ...env, PREVIEW_DIGEST: 'sha256:nope' }, proof: validProof() }), /artifact digest/)
  }
})

test('a guard with the recovery proof check removed is caught', () => {
  const removed = guardBlock().replace(/if \[ -n "\$\{HISTORICAL_SOURCE_PR:-\}" \]; then[\s\S]*?\n {0}fi\n(?=if ! \[\[ "\$\{PREVIEW_DIGEST)/, '')
  assert.notEqual(removed, guardBlock(), 'the sabotage did not apply; update this test to the guard shape')
  const run = runGuard({ env: { HISTORICAL_SOURCE_PR: '2860' }, proof: validProof({ sourcePr: 2792 }), block: removed })
  assert.equal(run.status, 0, 'without the proof check a foreign proof would qualify, which is what the real guard refuses')
})

test('the guard block stays runnable offline: no gh, curl or git', () => {
  const block = guardBlock()
  for (const forbidden of ['gh ', 'curl', 'git ']) assert.ok(!block.includes(forbidden), `the guard block must not use ${forbidden.trim()}`)
})

test('the job is reachable from a single-PR recovery, and never from a recovery map', () => {
  const text = workflowText()
  const header = text.split('automatic-production-promotion:', 2)[1].split('needs:', 1)[0]
  assert.match(header, /inputs\.historical_preview_source_pr != '' && inputs\.historical_preview_source_pr_map == ''/)
  assert.doesNotMatch(header, /historical_preview_source_pr_map != ''/)
  assert.match(header, /inputs\.mode == 'apply'/)
  assert.match(header, /inputs\.target == 'preview'/)
})

test('every later step uses the guarded source PR, and recovery re-proves the live merge hash', () => {
  const job = jobSection()
  const afterGuard = job.split('# <<< END automatic-promotion-source-guard', 2)[1]
  assert.doesNotMatch(afterGuard, /SOURCE_PR: \$\{\{ inputs\./, 'a step after the guard reads the raw input instead of the guarded output')
  assert.equal((afterGuard.match(/SOURCE_PR: \$\{\{ steps\.source_guard\.outputs\.source_pr \}\}/g) ?? []).length, 3)
  assert.match(afterGuard, /git merge-base --is-ancestor "\$RECOVERED_MERGE_SHA" "\$MAIN_SHA"/)
  for (const gate of ['check-exact-head-approval.mjs', 'Migration guarded merge authorization', '--resolve-admitted-issue-for-pr']) assert.ok(afterGuard.includes(gate), `shared gate ${gate} is absent`)
})

test('Windows executes the workflow shell through supported Git Bash', () => {
  if (process.platform === 'win32') assert.equal(bashCommand, gitBash)
  else assert.equal(bashCommand, 'bash')
})
