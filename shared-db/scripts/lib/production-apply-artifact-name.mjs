// Which evidence artifact names a production apply run may carry (#5974).
//
// The apply workflow is dispatched on ref `main` with input commit_sha; it checks
// out and verifies exactly commit_sha, but the run's head_sha is whatever main
// was when the run started. Runs before #5974 named their artifact after
// commit_sha, so when main moved between commit selection and dispatch (run
// 42519276272: dispatched 9a9d6f67, ran at 4ae95632) no verifier found it.
// The workflow now names the artifact after github.sha (= run.head_sha). For
// older runs we accept the dispatch commit name ONLY when it is the commit the
// run-name records AND it is a verified ancestor of the run's head commit.
const SHA = /^[a-f0-9]{40}$/
const TITLE = /^DB production apply ([a-f0-9]{40}) PR[1-9][0-9]* [0-9]{14}(?:,[0-9]{14})*$/

export function applyArtifactName(sha) { return `production-migration-apply-${sha}` }

// The dispatch commit recorded in a production apply run-name, or null.
export function dispatchCommitFromTitle(title) { return TITLE.exec(typeof title === 'string' ? title : '')?.[1] ?? null }

// Names a run's apply evidence may carry. `isAncestor(base, head)` must return
// true only after a live compare proves base is an ancestor of (or equal to) head.
export function acceptedApplyArtifactNames(run, isAncestor) {
  const head = typeof run?.head_sha === 'string' ? run.head_sha : ''
  if (!SHA.test(head)) return new Set()
  const names = new Set([applyArtifactName(head)])
  const dispatched = dispatchCommitFromTitle(run.display_title)
  if (dispatched && dispatched !== head && typeof isAncestor === 'function' && isAncestor(dispatched, head) === true)
    names.add(applyArtifactName(dispatched))
  return names
}

// Ancestry predicate over a GitHub compare reader: read(base, head) -> compare body.
export function compareAncestry(read) {
  return (base, head) => {
    let c
    try { c = read(base, head) } catch { return false }
    return ['ahead', 'identical'].includes(c?.status) && Number(c?.behind_by) === 0
  }
}
