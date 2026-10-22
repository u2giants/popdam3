// Issue #4414 step 5: in-memory reviewer-assignment io with atomic CAS batches.
// Shared by the section-deadline and hostile-matrix suites. Not production code.
import { MUTEX_REF, REVIEW_ACTIVE_CUTOVER_REF } from '../manage-migration-author-lanes.mjs'

export const HEAD = 'a'.repeat(40)
function usable(row) {
  return { provider: row.provider, status: 'ready', usable: true, admission: { schema_version: 1, provider: row.provider, state: 'unknown', reason: 'unscopable', quota_state: 'unknown', reset_at: null, credential_profile_scope: null, model_scope: null } }
}
export function atomicIo({ start = 1, head = HEAD } = {}) {
  const refs = new Map([[REVIEW_ACTIVE_CUTOVER_REF, 'cutover-complete']])
  const commits = new Map()
  let next = start
  const rows = (prefix) => [...refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha, commit: commits.get(sha) }))
  const io = {
    refs, commits, head,
    makeOwnerCommit(message) { const sha = String(next++).padStart(40, '0'); commits.set(sha, { message, committer: { date: new Date().toISOString() } }); return sha },
    requiresExactReviewHeadSha: true, enableReviewerQueue: false,
    resolveReviewEngine: () => 'claude',
    reviewerUsability: (reviewers) => new Map(reviewers.map((row) => [row.provider, usable(row)])),
    pauseReviewerFailure: () => {},
    readPaidReviewStarts: rows,
    readRef: (ref) => refs.get(ref) ?? null,
    listRefs: rows,
    getCommit: (sha) => commits.get(sha),
    getPr: (pr) => ({ state: 'open', number: Number(pr), head: { sha: io.head } }),
    getIssue: () => ({ state: 'open' }),
    getIssueComments: () => [], getPrReviews: () => [],
    createRef(ref, sha) { if (refs.has(ref)) return false; refs.set(ref, sha); return true },
    updateRef: (ref, sha) => { refs.set(ref, sha) },
    deleteRef: (ref) => { refs.delete(ref) },
    readReviewStates: (list) => new Map(list.map((l) => [`${l.issue}:${l.pr}`, { issue: { state: 'open', number: Number(l.issue) }, pr: { state: 'open', number: Number(l.pr), head: { sha: io.head } } }])),
    readReviewRefs: (list) => new Map(list.map((ref) => [ref, refs.get(ref) ?? null])),
    atomicReviewRefs(changes) {
      for (const c of changes) if ((refs.get(c.ref) ?? null) !== (c.expected ?? null)) throw new Error(`atomic reviewer ref transition failed: stale ${c.ref}`)
      for (const c of changes) { if (c.sha) refs.set(c.ref, c.sha); else refs.delete(c.ref) }
    },
    atomicReviewMutexRelease(owner) { if (refs.get(MUTEX_REF) === owner) refs.delete(MUTEX_REF) },
    wait: () => {},
    getRateLimit: () => ({ remaining: 5000, limit: 5000, reset: 0, graphRemaining: 5000, graphLimit: 5000, graphReset: 0 }),
  }
  return io
}
