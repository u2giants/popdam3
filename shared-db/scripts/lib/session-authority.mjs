// Claim-first session authority (issue #3874).
//
// The orchestrator role was retired by owner ruling (Albert Hazan, 2026-10-02:
// "there is no longer an orchestrator"; AGENTS.md §0.0-D). Paths that used to
// require "a matching live sole-orchestrator marker" now require a declared,
// well-formed session identity instead, and -- when the operation acts on the
// session's OWN claim (preview preparation with --claim-number) -- that the
// claim's lease owner IS that session.
//
// Abandonment action and operator adoption act on ANOTHER session's expired or
// abandoned claim, so they are deliberately not bound to the claim owner; they
// keep their own evidence gates (abandonment-audit fence, exact PR head,
// version reservation, recovery artifact, explicit worktree state). The session
// id is self-declared: it identifies who acted and is recorded; it is not an
// external credential -- exactly as the retired marker was self-opened.
//
// This is deliberately fail-closed: an unset, blank, malformed or mismatched
// identity never authorizes a mutation. It does NOT replace any serialization
// gate: preview-lane exclusivity (EXCLUSIVE_REFS + the global mutex), target
// proof, reviewer separation, guarded merge and the production lane are all
// enforced elsewhere and are unchanged.
//
// The returned object keeps the old marker shape ({live, task, calling_task,
// state}) so every existing consumer keeps its exact comparison.

export const SESSION_ID_ENV = 'SHARED_DB_SESSION_ID'
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{2,119}$/

export function readSessionId(env = process.env) {
  const raw = env?.[SESSION_ID_ENV]
  if (raw === undefined || raw === null) return null
  const id = String(raw).trim()
  if (!id) return null
  if (!SESSION_ID_PATTERN.test(id)) return { malformed: true, id: id.slice(0, 40) }
  return id
}

// claimOwner: the lease owner of the claim the operation acts on, or undefined
// when the operation names no claim. null/'' for a named-but-unreadable claim
// owner refuses rather than passing.
export function resolveSessionAuthority({ env = process.env, claimOwner } = {}) {
  const id = readSessionId(env)
  if (id === null) return { live: false, state: 'none', task: null, calling_task: '', reason: `${SESSION_ID_ENV} is not set` }
  if (typeof id === 'object') return { live: false, state: 'invalid', task: null, calling_task: '', reason: `${SESSION_ID_ENV} is malformed` }
  if (claimOwner !== undefined) {
    const owner = String(claimOwner ?? '').trim()
    if (!owner) return { live: false, state: 'unsafe', task: null, calling_task: id, reason: 'the named claim has no readable lease owner' }
    if (owner !== id) return { live: false, state: 'claim-owner-mismatch', task: owner, calling_task: id, reason: `claim lease owner ${owner} is not this session (${id})` }
  }
  return { live: true, state: 'declared', task: id, calling_task: id, reason: null }
}

export function sessionAuthorityRefusal(authority) {
  return `claim-first session authority is required (${authority?.reason ?? 'unknown'}); declare ${SESSION_ID_ENV} as this session`
}
