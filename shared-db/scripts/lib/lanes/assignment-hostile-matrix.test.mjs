// Issue #4414 plan step 5 (§10 hostile matrix). Proofs not already covered by an
// existing named test live here; docs/verification/reviewer-assignment-holds.md maps
// every §10 name to its test. Fake io with real CAS semantics; no wall-clock timing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MUTEX_REF, REVIEW_CURSOR_REF, REVIEW_ASSIGNMENT_REF_PREFIX } from '../../manage-migration-author-lanes.mjs'
import { atomicIo, HEAD } from '../../test-fixtures/review-assignment-io.mjs'

const REQUEST = { issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }
const assignmentRefs = (io) => [...io.refs.keys()].filter((ref) => ref.startsWith(`${REVIEW_ASSIGNMENT_REF_PREFIX}/`))
function captureStderr(fn) {
  const lines = [], original = process.stderr.write
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true }
  try { return { result: fn(), lines } } catch (error) { return { error, lines } } finally { process.stderr.write = original }
}









