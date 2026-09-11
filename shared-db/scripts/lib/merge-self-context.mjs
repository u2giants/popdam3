// The required status context that the guarded merge posts for ITSELF, after
// every other gate has already passed.
//
// It lives in its own dependency-free module because two very different callers
// need it: the merge pre-flight (scripts/check-required-checks-preflight.mjs)
// and the preview gate in the lane manager. The pre-flight imports the lane
// manager, so the lane manager cannot import the pre-flight back, and the
// pre-flight also reads a docs mirror that must stay out of the preview job's
// executed closure. A single constant, imported by both, keeps one source of
// truth without dragging either of those along.
export const MERGE_SELF_CONTEXT = 'Migration guarded merge authorization'
