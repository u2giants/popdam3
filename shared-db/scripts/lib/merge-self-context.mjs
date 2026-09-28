// The required status context that the guarded merge posts for ITSELF, after
// every other gate has already passed.
//
// It lives in its own dependency-free module because two very different callers
// need it: the merge pre-flight (scripts/check-required-checks-preflight.mjs)
// and the preview gate in the lane manager. The pre-flight imports the lane
// manager, so the lane manager cannot import the pre-flight back. A single
// constant, imported by both, keeps one source of truth without dragging
// either of those along. The committed mirror (docs/verification/
// main-required-status-checks.json) is informational only; it never authorizes
// a merge.
export const MERGE_SELF_CONTEXT = 'Migration guarded merge authorization'
