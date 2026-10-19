// EXACT PINNED RE-QUALIFIED PREVIEW APPLY RUNS (#4464).
//
// A merged-main preview apply run is evidence only at run_attempt 1. Run
// 39173012894 applied 20261018191107 to preview exactly once (attempt 1, preview
// job 117810059327, artifact 12153700170), then an operator re-ran ONLY its
// downstream qualification job, which made the run attempt 2 and left a second
// review-evidence companion. The preview job and its artifact were not re-run.
// Each record admits exactly that run, attempt, preview artifact (id + digest)
// and companion set; anything else keeps the attempt-1 refusal.
export const REQUALIFIED_PREVIEW_RUNS = Object.freeze({
  '39173012894': Object.freeze({
    version: '20261018191107',
    sourcePr: 4476,
    headSha: 'fe3931607f952029ce6174073f7320d580a188b7',
    runAttempt: 2,
    previewArtifactId: 12153700170,
    previewArtifactDigest: 'sha256:5b965d6cd686681ec0734c630b92fb602ae0ab8cfd277961a128d03d6461d479',
    reviewArtifactIds: Object.freeze([12153008946, 12153114783]),
  }),
})

// The pinned record when `run` is exactly a pinned re-qualified run, else null.
export function requalifiedPreviewRun(run) {
  const record = REQUALIFIED_PREVIEW_RUNS[String(run?.id)]
  if (!record) return null
  if (run.run_attempt !== record.runAttempt || run.head_sha !== record.headSha) return null
  return record
}

// The single pinned preview artifact when the run's artifact set is exactly the
// pinned preview artifact plus the pinned companions, else null.
export function requalifiedPreviewArtifact(run, artifacts) {
  const record = requalifiedPreviewRun(run)
  const rows = Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : []
  if (!record || Number(artifacts?.total_count) !== 1 + record.reviewArtifactIds.length || rows.length !== Number(artifacts.total_count)) return null
  const preview = rows.filter(row => row?.id === record.previewArtifactId)
  const companions = rows.filter(row => row?.name === 'automatic-production-apply-review-evidence')
  if (preview.length !== 1 || preview[0].digest !== record.previewArtifactDigest || preview[0].expired !== false ||
      preview[0].name !== `preview-migration-apply-${record.headSha}` ||
      String(preview[0].workflow_run?.id) !== String(run.id) || preview[0].workflow_run?.head_sha !== run.head_sha) return null
  const ids = companions.map(row => row.id).sort((a, b) => a - b)
  if (JSON.stringify(ids) !== JSON.stringify([...record.reviewArtifactIds].sort((a, b) => a - b))) return null
  return preview[0]
}
