#!/usr/bin/env node
// Repository identity conformance (issue #2530, plan_shared_db_popcre_transfer_merge_queue.md
// Step 2). Refuses any NEW hard-coded owner/name slug for this repository in
// workflows, scripts and tools.
//
// Live code must resolve its repository through scripts/lib/repository-identity.mjs
// (JavaScript), scripts/repository_identity.py (Python) or `github.repository` /
// `$GITHUB_REPOSITORY` (workflows). Every remaining literal occurrence is listed in
// ALLOWLIST below: one file, an EXACT count, and the reason it is not a live
// hard-code. There is no directory exemption. A count that grows, shrinks, or
// appears in an unlisted file fails, so the list can never silently go stale.
//
// Detected forms: the plain slug, a regex-escaped slug, a URL-encoded slug, and a
// split GraphQL owner literal.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SCAN_ROOTS = ['.github/workflows', 'scripts', 'tools']
const SCANNED_EXTENSIONS = /\.(?:mjs|cjs|js|ts|py|sh|ps1|yml|yaml|json|sql)$/i

export const PATTERNS = [
  /u2giants(?:\\{0,2}\/|%2F)shared-db/gi,
  /owner\s*[:=]\s*\\?["'`]u2giants\\?["'`]/gi,
]

const FIXTURE = 'test fixture: literal evidence/URL data, not a repository the code talks to'
const PROSE = 'comment or message prose naming the repository, not a value the code uses'

// Exact counts. Update deliberately, with a reason, when a count changes.
export const ALLOWLIST = {
  'scripts/lib/repository-identity.mjs': [1, 'HISTORICAL_REPOSITORY_SLUG: accepted only for pre-transfer evidence URLs'],
  'scripts/lib/repository-identity.test.mjs': [12, 'tests the historical slug, the old-origin remote form, and pre-transfer operator trust and comment aliases'],
  'scripts/repository_identity.py': [1, 'HISTORICAL_REPOSITORY_SLUG: accepted only for pre-transfer evidence URLs'],
  'scripts/test_repository_identity.py': [5, 'tests the historical slug and the old-origin remote form'],
  'scripts/check-repository-identity-conformance.test.mjs': [5, 'positive controls for the detector'],
  'scripts/capture-repository-transfer-baseline.mjs': [1, 'Step 1 baseline records the pre-transfer identity (lands in a separate PR)', { optional: true }],
  'scripts/capture-repository-transfer-baseline.test.mjs': [2, 'Step 1 baseline fixtures (lands in a separate PR)', { optional: true }],
  'scripts/orchestrator-flow/runner-lanes.json': [1, 'authorization link to a historical owner comment (#2729); a durable evidence URL'],
  'scripts/reclassify-db-work-routing-20260816.mjs': [1, 'dated one-off script that already ran; historical record'],
  'tools/migrate-intake-to-issues.mjs': [1, 'one-off intake migration that already ran; historical record'],
  'tools/intake-inventory.mjs': [1, PROSE],
  'scripts/check-cancelled-work.mjs': [1, 'describes a cancelled owner decision about the historical repository; text, not an API target'],
  'scripts/check-skill-drift.mjs': [1, PROSE],
  'scripts/lib/orchestrator-admission.mjs': [1, PROSE],
  'scripts/refresh-code-pr-branch.mjs': [1, PROSE],
  'tools/sync-opa-property-character.mjs': [1, PROSE],
  'tools/sync-paramount-creative-library.mjs': [1, PROSE],
  'tools/sync-warner-starlabs.mjs': [1, PROSE],
  'scripts/tests/test-task-gates.sh': [1, 'throwaway fixture repository origin; the gate under test only needs a GitHub URL'],
  'scripts/check-cancelled-work.test.mjs': [2, FIXTURE],
  'scripts/check-documents-only-merge-authorization.test.mjs': [2, FIXTURE],
  'scripts/check-documents-only-pull-request.test.mjs': [4, FIXTURE],
  'scripts/check-exact-head-approval.test.mjs': [3, FIXTURE],
  'scripts/check-github-transport-conformance.test.mjs': [1, FIXTURE],
  'scripts/check-handoff-contract.test.mjs': [2, FIXTURE],
  'scripts/check-live-proof-probe.test.mjs': [6, 'issue-body fixtures naming the historical return-to repository and the transferred-name test, lines 12, 18, 24, 46, 56, 74 (#2530)'],
  'scripts/check-intake-pointer.test.mjs': [1, FIXTURE],
  'scripts/check-orchestrator-marker.test.mjs': [1, FIXTURE],
  'scripts/check-pr-object-collisions.test.mjs': [2, FIXTURE],
  'scripts/lib/orchestrator-admission.test.mjs': [1, FIXTURE],
  'scripts/lib/review-verdict-artifact.test.mjs': [2, FIXTURE],
  'scripts/lib/work-dependencies.test.mjs': [2, FIXTURE],
  'scripts/manage-migration-author-lanes.test.mjs': [11, FIXTURE],
  'scripts/migration-retirement-tombstones.test.mjs': [2, FIXTURE],
  'scripts/orchestrator-flow/admission-outcome.test.mjs': [19, FIXTURE],
  'scripts/orchestrator-flow/qualify-change.test.mjs': [1, FIXTURE],
  'scripts/orchestrator-flow/runner-lanes.test.mjs': [12, FIXTURE],
  'scripts/orchestrator-flow/select-preview-route.test.mjs': [3, FIXTURE],
  'scripts/record-review-verdict.test.mjs': [3, FIXTURE],
  'scripts/repair-voided-findings.test.mjs': [2, FIXTURE],
  'scripts/repository-maintenance-authorization.test.mjs': [1, FIXTURE],
  'scripts/run-governed-review.test.mjs': [12, FIXTURE],
  'scripts/test_shared_db_live_proof.py': [1, FIXTURE],
  'scripts/update-required-checks.test.mjs': [2, 'mirror-document fixture'],
  'tools/dispatch-coldlion-taxonomy-alerts.test.mjs': [6, FIXTURE],
}

export function countOccurrences(text) {
  let count = 0
  for (const pattern of PATTERNS) count += (String(text).match(pattern) ?? []).length
  return count
}

export function evaluate(counts, allowlist = ALLOWLIST) {
  const failures = []
  for (const [file, count] of Object.entries(counts)) {
    if (count === 0) continue
    const entry = allowlist[file]
    if (!entry) failures.push(`${file}: ${count} hard-coded repository slug(s); resolve it through the repository identity helper or github.repository`)
    else if (entry[0] !== count) failures.push(`${file}: allowlisted ${entry[0]} but found ${count}; update the allowlist deliberately or remove the hard-code`)
  }
  for (const [file, [expected, , options]] of Object.entries(allowlist)) {
    const present = file in counts
    if (present && counts[file] !== 0) continue
    if (present || !options?.optional) failures.push(`${file}: allowlisted ${expected} but found none; remove the stale allowlist entry`)
  }
  return failures
}

export function listFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...SCAN_ROOTS], { encoding: 'utf8' })
  return [...new Set(out.split('\n').map((line) => line.trim()).filter((file) => file && SCANNED_EXTENSIONS.test(file)))]
}

export function scanTree(root) {
  const counts = {}
  for (const file of listFiles(root)) {
    let text
    try { text = readFileSync(path.join(root, file), 'utf8') } catch { continue }
    counts[file] = countOccurrences(text)
  }
  return counts
}

export function main(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const failures = evaluate(scanTree(root))
  if (failures.length) {
    for (const failure of failures) console.error(`::error::${failure}`)
    console.error(`Repository identity conformance FAILED: ${failures.length} problem(s).`)
    return 1
  }
  console.log(`Repository identity conformance OK: every remaining literal slug is allowlisted with an exact count (${Object.keys(ALLOWLIST).length} entries).`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
