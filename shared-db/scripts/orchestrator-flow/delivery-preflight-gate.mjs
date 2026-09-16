// Delivery preflight as a real gate (#2728, programme popcre/ai-devops#401 Step 5).
//
// delivery-preflight.mjs composes the early delivery checks and seals their
// input, but nothing called it. This module is the caller's contract:
//   1. Run the preflight before author completion and record its input digest
//      in the evidence bundle (metadata.delivery_preflight).
//   2. When the head moves, re-run the checks only if classify-invalidation says
//      a relevant input changed. An INTEGRATION_REFRESH_ONLY result (identical
//      bundle, disjoint intervening changes, full CI, current merge base) reuses
//      the prior sealed record and makes no adapter call at all.
//   3. Refuse a reviewer draw unless a passing record is registered in a bundle
//      bound to the exact head under review.
//   4. Before either of the above, run the pass-2 rebuild check for any change
//      that adds or edits a migration. A change that drops or replaces a routine
//      whose contract-test rebuild would not match a straight replay refuses
//      here, before review, not after approvals (#401 Step 5).
// Every unreadable or mismatched input refuses; nothing here falls open.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyInvalidation } from './classify-invalidation.mjs'
import { DeliveryPreflightError, composeDeliveryPreflight, registerDeliveryPreflight, runDeliveryPreflight, validateDeliveryPreflight } from './delivery-preflight.mjs'
import { validateEvidenceBundle } from './evidence-bundle.mjs'

const SHA = /^[0-9a-f]{40}$/i
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATION = /^supabase\/migrations\/[^/]+\.sql$/

export function changedMigrations(changedFiles) {
  if (!Array.isArray(changedFiles)) throw new DeliveryPreflightError('changed files must be a list')
  return [...new Set(changedFiles.map((file) => String(typeof file === 'string' ? file : file?.path ?? '').replace(/\\/g, '/')).filter((file) => MIGRATION.test(file)).map((file) => path.posix.basename(file)))].sort()
}

// Runs scripts/check_pass2_routine_supersession.py --rebuild-check. Exit 0 is
// PASS, 1 is a proven mismatch, anything else (or unreadable output) refuses.
export function runRoutineRebuildCheck(migrations, { repoRoot = REPO_ROOT, python = process.env.PYTHON || 'python' } = {}) {
  const result = spawnSync(python, [path.join(repoRoot, 'scripts', 'check_pass2_routine_supersession.py'), '--rebuild-check', '--migrations-dir', path.join(repoRoot, 'supabase', 'migrations'), ...migrations], { encoding: 'utf8' })
  let report = null
  try { report = JSON.parse(result.stdout) } catch { /* refused below */ }
  if (result.status === 0 && report?.status === 'PASS') return report
  if (result.status === 1 && report?.status === 'BLOCKED' && Array.isArray(report.mismatches) && report.mismatches.length) return report
  throw new DeliveryPreflightError(`routine rebuild check is unreadable: ${(result.error?.message || result.stderr || `exit ${result.status}`).trim()}`)
}

/**
 * The routine_rebuild gate. Refuses when a changed migration drops or replaces a
 * routine and the pass-2 rebuild would not reproduce a straight replay.
 * `adapters.routineRebuild(migrations)` overrides the Python runner.
 */
export function assertRoutineRebuild(changedFiles, adapters = {}) {
  const migrations = changedMigrations(changedFiles)
  if (!migrations.length) return { status: 'PASS', migrations, mismatches: [] }
  const run = typeof adapters.routineRebuild === 'function' ? adapters.routineRebuild : (files) => runRoutineRebuildCheck(files, { repoRoot: adapters.repoRoot })
  const report = run(migrations)
  if (report?.status === 'PASS') return { status: 'PASS', migrations, mismatches: [] }
  const detail = (report?.mismatches ?? []).map((m) => `${m.pass2_migration} resurrects [${(m.resurrected ?? []).join(', ')}] loses [${(m.lost ?? []).join(', ')}]`).join('; ')
  throw new DeliveryPreflightError(`delivery preflight blocked by routine_rebuild: ${detail || 'unreadable rebuild report'}`)
}

function registrationOf(bundle) {
  return bundle?.metadata?.delivery_preflight ?? null
}

function registers(bundle, record) {
  const registration = registrationOf(bundle)
  return Boolean(registration && record && registration.preflight_id === record.preflight_id && registration.input_digest === record.input_digest)
}

// Decide between reuse and a fresh run. Returns { reuse, reason, classification }.
export function planDeliveryPreflight({ currentBundle, priorBundle, priorRecord, changedFiles, integration }) {
  const rerun = (reason, classification = null) => ({ reuse: false, reason, classification })
  if (!priorBundle || !priorRecord) return rerun('no prior preflight to reuse')
  try { validateEvidenceBundle(currentBundle); validateEvidenceBundle(priorBundle) } catch (error) { return rerun(`evidence bundle is unreadable: ${error.message}`) }
  if (!registers(priorBundle, priorRecord)) return rerun('the prior bundle does not register the prior preflight record')
  if (String(priorRecord.input?.head_sha ?? '').toLowerCase() !== String(priorBundle.metadata.integration_sha).toLowerCase()) return rerun('the prior preflight record is not bound to the prior bundle head')
  if (Number(priorBundle.metadata.issue) !== Number(currentBundle.metadata.issue) || Number(priorBundle.metadata.pr) !== Number(currentBundle.metadata.pr)) return rerun('the prior bundle belongs to another issue or pull request')
  if (!integration || typeof integration !== 'object') return rerun('integration facts are required to reuse a preflight')
  if (String(integration.integration_sha ?? '').toLowerCase() !== String(currentBundle.metadata.integration_sha).toLowerCase()) return rerun('integration facts do not describe the current bundle head')
  const classification = classifyInvalidation({
    reviewed_bundle_id: priorBundle.bundle_id,
    current_bundle_id: currentBundle.bundle_id,
    changed_files: changedFiles,
    global_invalidators: currentBundle.identity.global_invalidators.map((file) => file.path),
    claims: currentBundle.identity.claims,
    intervening_changes: integration.intervening_changes ?? [],
    history_available: integration.history_available,
    full_ci_success: integration.full_ci_success,
    merge_base_is_current_main: integration.merge_base_is_current_main,
    integration_sha: integration.integration_sha,
    evidence_integration_sha: integration.evidence_integration_sha,
  })
  if (classification.class !== 'INTEGRATION_REFRESH_ONLY') return rerun(`${classification.class}: ${classification.reason}`, classification)
  return { reuse: true, reason: classification.reason, classification }
}

/**
 * Run or reuse the delivery preflight and register it in the current bundle.
 * `input` is a precomposed preflight input; `adapters` supplies the per-check
 * gate functions (the expensive work) and readEvidenceRegistration. Throws
 * DeliveryPreflightError when the preflight is blocked or unreadable.
 */
export function runDeliveryPreflightGate({ currentBundle, priorBundle = null, priorRecord = null, changedFiles = [], integration = null, input = null }, adapters = {}) {
  assertRoutineRebuild(changedFiles, adapters)
  const plan = planDeliveryPreflight({ currentBundle, priorBundle, priorRecord, changedFiles, integration })
  if (plan.reuse) {
    const record = validateDeliveryPreflight(priorRecord, adapters)
    const bundle = { ...currentBundle, metadata: { ...currentBundle.metadata, delivery_preflight: { preflight_id: record.preflight_id, input_digest: record.input_digest } } }
    try { validateEvidenceBundle(bundle) } catch (error) { throw new DeliveryPreflightError(`preflight registration is invalid: ${error.message}`) }
    return { status: 'PASS', reused: true, carried_from: record.input.head_sha, record, bundle, plan }
  }
  const metadata = currentBundle?.metadata ?? {}
  const record = input
    ? runDeliveryPreflight(input, adapters)
    : composeDeliveryPreflight({ issue: Number(metadata.issue), pr: Number(metadata.pr), head_sha: String(metadata.integration_sha ?? '').toLowerCase() }, adapters)
  const bundle = registerDeliveryPreflight(currentBundle, record, adapters)
  return { status: 'PASS', reused: false, record, bundle, plan }
}

// The review gate: no reviewer is drawn without a passing, registered preflight
// whose bundle is bound to the exact head being reviewed. The record itself must
// be sealed at that head. A record sealed at an earlier head stands only when the
// caller supplies the bundle it was sealed against and the invalidation
// classification is re-run and says INTEGRATION_REFRESH_ONLY, so a stale PASS
// re-registered in a bundle with a different identity is refused.
export function assertDeliveryPreflightBeforeReview({ record, bundle, issue, pr, headSha, priorBundle = null, changedFiles = [], integration = null }, adapters = {}) {
  if (!record) throw new DeliveryPreflightError('no delivery preflight record; run --delivery-preflight before drawing a reviewer')
  assertRoutineRebuild(changedFiles, adapters)
  if (record.status !== 'PASS') throw new DeliveryPreflightError(`delivery preflight is ${String(record.status ?? 'unreadable')}; a reviewer is not drawn`)
  validateDeliveryPreflight(record, adapters)
  try { validateEvidenceBundle(bundle) } catch (error) { throw new DeliveryPreflightError(`evidence bundle is unreadable: ${error.message}`) }
  if (!registers(bundle, record)) throw new DeliveryPreflightError('the evidence bundle does not register this delivery preflight')
  if (Number(record.input.issue) !== Number(issue) || Number(record.input.pr) !== Number(pr) || Number(bundle.metadata.issue) !== Number(issue) || Number(bundle.metadata.pr) !== Number(pr)) throw new DeliveryPreflightError('delivery preflight belongs to another issue or pull request')
  if (!SHA.test(String(headSha ?? '')) || String(bundle.metadata.integration_sha).toLowerCase() !== String(headSha).toLowerCase()) throw new DeliveryPreflightError(`the evidence bundle is not bound to head ${headSha}`)
  const head = String(headSha).toLowerCase(), sealedAt = String(record.input?.head_sha ?? '').toLowerCase()
  if (sealedAt === head && !priorBundle) return { ok: true, preflight_id: record.preflight_id, head_sha: head, carried_from: null }
  if (!priorBundle) throw new DeliveryPreflightError(`delivery preflight was sealed at head ${sealedAt || 'unknown'}, not ${head}; supply the bundle it was sealed against to prove the carry`)
  const plan = planDeliveryPreflight({ currentBundle: bundle, priorBundle, priorRecord: record, changedFiles, integration })
  if (!plan.reuse) throw new DeliveryPreflightError(`delivery preflight sealed at ${sealedAt || 'unknown'} does not carry to head ${head}: ${plan.reason}`)
  return { ok: true, preflight_id: record.preflight_id, head_sha: head, carried_from: sealedAt }
}
