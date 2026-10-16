const REVIEW_ARTIFACT = 'automatic-production-apply-review-evidence'
const WORKFLOW = '.github/workflows/shared-supabase-migrations.yml'

// Artifact selection is not rehearsal verification. The caller must still prove
// the preview binding, ledger delta and migration bytes with its existing gates.
export function selectPreviewArtifacts({run, jobs, artifacts}) {
  const rows = Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : []
  if (Number(artifacts?.total_count) !== 2 || rows.length !== 2) return rows
  const companions = rows.filter(row => row?.name === REVIEW_ARTIFACT)
  if (companions.length !== 1) return rows
  const companion = companions[0]
  const preview = rows.find(row => row !== companion)
  const graph = Array.isArray(jobs?.jobs) ? jobs.jobs : []
  const expected = new Map([
    ['SQL migration guards', 'success'],
    ['preview', 'success'],
    ['Automatic production qualification and dispatch', run?.conclusion],
    ['Production apply review (immutable evidence + hard guards)', 'skipped'],
    ['Production apply (automatic evidence gates)', 'skipped'],
    ['production-dry-run', 'skipped'],
  ])
  const validGraph = Number(jobs?.total_count) === expected.size && graph.length === expected.size &&
    [...expected].every(([name, conclusion]) => graph.filter(job =>
      job?.name === name && job.status === 'completed' && job.conclusion === conclusion).length === 1)
  const validRun = run?.path === WORKFLOW && run.event === 'workflow_dispatch' &&
    run.status === 'completed' && ['success', 'failure'].includes(run.conclusion) &&
    run.run_attempt === 1 && /^[0-9a-f]{40}$/i.test(String(run.head_sha ?? ''))
  const validArtifact = row => Number.isSafeInteger(row?.id) && row.id > 0 &&
    row.expired === false && /^sha256:[0-9a-f]{64}$/i.test(String(row.digest ?? '')) &&
    String(row.workflow_run?.id) === String(run?.id) && row.workflow_run?.head_sha === run?.head_sha
  if (!validRun || !validGraph || !validArtifact(companion) || !validArtifact(preview) ||
      companion.id === preview.id || !/^preview-migration-apply-[0-9a-f]{40}$/i.test(String(preview.name ?? ''))) {
    return rows
  }
  return [preview]
}
