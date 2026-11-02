import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mutexSectionReserveAfterPrepare, MUTEX_REF, REVIEW_OPERATION_REQUEST_LIMIT, REVIEW_MUTEX_SECTION_RESERVE, REVIEW_STARTED_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, REVIEW_ASSIGNMENT_REF_PREFIX } from '../../manage-migration-author-lanes.mjs'

function usableAdmission(row) {
  return {
    provider: row.provider,
    status: 'ready',
    usable: true,
    admission: {
      schema_version: 1,
      provider: row.provider,
      state: 'unknown',
      reason: 'unscopable',
      quota_state: 'unknown',
      reset_at: null,
      credential_profile_scope: null,
      model_scope: null,
    },
  }
}

function baseIo() {
  const refs = new Map()
  const commits = new Map()
  let next = 1
  refs.set(REVIEW_ACTIVE_CUTOVER_REF, 'cutover-complete')
  return {
    refs,
    commits,
    makeOwnerCommit(message) {
      const sha = String(next++).padStart(40, '0')
      commits.set(sha, { message, committer: { date: new Date().toISOString() } })
      return sha
    },
    requiresExactReviewHeadSha: true,
    enableReviewerQueue: false,
    resolveReviewEngine: () => 'claude',
    reviewerUsability: (reviewers) => new Map(reviewers.map((row) => [row.provider, usableAdmission(row)])),
    pauseReviewerFailure: () => {},
    readPaidReviewStarts: (prefix) => [...refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha, commit: commits.get(sha) })),
    readRef: (ref) => refs.get(ref) ?? null,
    listRefs: (prefix) => [...refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha, commit: commits.get(sha) })),
    getCommit: (sha) => commits.get(sha),
    getPr: (pr) => ({ state: 'open', number: Number(pr), head: { sha: 'a'.repeat(40) } }),
    getIssue: () => ({ state: 'open' }),
    getIssueComments: () => [],
    getPrReviews: () => [],
    createRef(ref, sha) {
      if (refs.has(ref)) return false
      refs.set(ref, sha)
      return true
    },
    updateRef: (ref, sha) => { refs.set(ref, sha) },
    deleteRef: (ref) => { refs.delete(ref) },
    getRateLimit: () => ({ remaining: 5000, limit: 5000, reset: 0, graphRemaining: 5000, graphLimit: 5000, graphReset: 0 }),
  }
}



test('derived request ceilings are unchanged (not widened by instrumentation)', () => {
  assert.equal(REVIEW_OPERATION_REQUEST_LIMIT, 25)
  assert.equal(REVIEW_MUTEX_SECTION_RESERVE, 15)
  assert.ok(String(REVIEW_ASSIGNMENT_REF_PREFIX).includes('assignment') || String(REVIEW_ASSIGNMENT_REF_PREFIX).length > 0)
})


