import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { REQUALIFIED_PREVIEW_RUNS, requalifiedPreviewRun, requalifiedPreviewArtifact } from './requalified-preview-runs.mjs'

const head = 'fe3931607f952029ce6174073f7320d580a188b7'
const run = { id: 39173012894, run_attempt: 2, head_sha: head }
const art = (id, name, digest) => ({ id, name, digest, expired: false, workflow_run: { id: 39173012894, head_sha: head } })
const preview = art(12153700170, `preview-migration-apply-${head}`, 'sha256:5b965d6cd686681ec0734c630b92fb602ae0ab8cfd277961a128d03d6461d479')
const set = rows => ({ total_count: rows.length, artifacts: rows })
const good = set([preview, art(12153008946, 'automatic-production-apply-review-evidence', 'sha256:' + 'a'.repeat(64)), art(12153114783, 'automatic-production-apply-review-evidence', 'sha256:' + 'b'.repeat(64))])

test('pinned run, attempt and head are admitted', () => {
  assert.equal(requalifiedPreviewRun(run).version, '20261018191107')
  assert.equal(requalifiedPreviewArtifact(run, good), preview)
})
test('any other run, attempt or head is refused', () => {
  assert.equal(requalifiedPreviewRun({ ...run, id: 1 }), null)
  assert.equal(requalifiedPreviewRun({ ...run, run_attempt: 3 }), null)
  assert.equal(requalifiedPreviewRun({ ...run, head_sha: 'f'.repeat(40) }), null)
})
test('a changed artifact set is refused', () => {
  assert.equal(requalifiedPreviewArtifact(run, set([{ ...preview, digest: 'sha256:' + 'c'.repeat(64) }, ...good.artifacts.slice(1)])), null)
  assert.equal(requalifiedPreviewArtifact(run, set(good.artifacts.slice(0, 2))), null)
  assert.equal(requalifiedPreviewArtifact(run, set([...good.artifacts, art(9, 'automatic-production-apply-review-evidence', 'sha256:' + 'd'.repeat(64))])), null)
  assert.equal(requalifiedPreviewArtifact(run, set([{ ...preview, expired: true }, ...good.artifacts.slice(1)])), null)
})
test('python twin pins the same record', () => {
  const py = fs.readFileSync(new URL('../requalified_preview_runs.py', import.meta.url), 'utf8')
  for (const [id, r] of Object.entries(REQUALIFIED_PREVIEW_RUNS)) {
    for (const value of [id, r.version, String(r.sourcePr), r.headSha, `"run_attempt": ${r.runAttempt}`, String(r.previewArtifactId), r.previewArtifactDigest, ...r.reviewArtifactIds.map(String)]) assert.ok(py.includes(value), value)
  }
})
