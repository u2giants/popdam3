import { createHash } from 'node:crypto'

export const REVIEW_VERDICT_REF_PREFIX = 'refs/db-review-verdicts'
export const REVIEW_VERDICT_REPLACEMENT_REF_PREFIX = 'refs/db-review-verdict-replacements'
export const REVIEW_VERDICTS = new Set(['APPROVE', 'REVISE', 'REJECT'])
const VALIDATED_VERDICT = Symbol('validated-review-verdict')

export function reviewSlotSuffix(slot = 1) { return Number(slot) === 1 ? '' : `-slot${Number(slot)}` }
export function verdictRef({ issue, pr, headSha, slot = 1, replacementSequence = null }) {
  const prefix = replacementSequence == null ? REVIEW_VERDICT_REF_PREFIX : REVIEW_VERDICT_REPLACEMENT_REF_PREFIX
  const tail = replacementSequence == null ? '' : `-${Number(replacementSequence)}`
  return `${prefix}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}${reviewSlotSuffix(slot)}${tail}`
}
export function findingsDigest(body) { return createHash('sha256').update(String(body), 'utf8').digest('hex') }
export function assertFindingsRefForPr(findingsRef, pr) {
  const match = /^https:\/\/github\.com\/u2giants\/shared-db\/pull\/(\d+)#issuecomment-\d+$/.exec(String(findingsRef ?? ''))
  if (!match || Number(match[1]) !== Number(pr)) throw new Error('findings_ref must name a durable comment on the reviewed shared-db PR')
}

export function parseVerdictRef(ref) {
  const match = /^refs\/db-review-verdict(s|-replacements)\/(\d+)-(\d+)-([0-9a-f]{40})(?:-slot(\d+))?(?:-(\d+))?$/.exec(String(ref ?? ''))
  if (!match) return null
  const replacement = match[1] === '-replacements'
  if (replacement !== Boolean(match[6])) return null
  return { issue: Number(match[2]), pr: Number(match[3]), headSha: match[4], slot: Number(match[5] ?? 1), replacementSequence: match[6] ? Number(match[6]) : null }
}

export function formatVerdictMessage(record) {
  return `db-review-verdict ${JSON.stringify(record)}`
}
export function parseVerdictCommit(commit) {
  const message = commit?.message ?? commit?.commit?.message ?? ''
  const match = /^db-review-verdict (\{.*\})$/.exec(message)
  if (!match) throw new Error('verdict commit message is unreadable')
  let row
  try { row = JSON.parse(match[1]) } catch { throw new Error('verdict commit payload is malformed') }
  return row
}

export function validateVerdictArtifact({ ref, sha, commit, findingsBody, activeLeaseSha, assignment }) {
  const named = parseVerdictRef(ref)
  const row = parseVerdictCommit(commit)
  if (!named || !/^[0-9a-f]{40}$/i.test(String(sha ?? ''))) throw new Error('verdict ref is malformed')
  for (const key of ['issue', 'pr', 'slot']) if (Number(row[key]) !== Number(named[key])) throw new Error(`verdict ${key} disagrees with its ref`)
  if (String(row.head_sha ?? '').toLowerCase() !== named.headSha) throw new Error('verdict head disagrees with its ref')
  if (!REVIEW_VERDICTS.has(row.verdict)) throw new Error('verdict must be APPROVE, REVISE, or REJECT')
  if (!/^[0-9a-f]{40}$/i.test(String(row.assignment_sha ?? '')) || row.assignment_sha !== assignment?.sha) throw new Error('verdict assignment SHA is not the exact assignment object')
  if (String(row.reviewer ?? '') !== String(assignment?.reviewer ?? '')) throw new Error('verdict reviewer does not own the assignment')
  if (activeLeaseSha !== undefined && activeLeaseSha !== null && activeLeaseSha !== row.assignment_sha) throw new Error('reviewer holds a conflicting active lease')
  const parents = commit?.parents ?? commit?.commit?.parents ?? []
  const parentShas = parents.map((parent) => parent.sha ?? parent.oid)
  if (parentShas.length !== 1 || parentShas[0] !== row.assignment_sha) throw new Error('verdict commit is not a direct child of its assignment')
  assertFindingsRefForPr(row.findings_ref, row.pr)
  if (!/^[0-9a-f]{64}$/.test(String(row.findings_digest ?? '')) || findingsDigest(findingsBody) !== row.findings_digest) throw new Error('findings digest does not match the durable findings')
  const validated = { ...row, ref, sha }
  Object.defineProperty(validated, VALIDATED_VERDICT, { value: true })
  return validated
}

export function isValidatedVerdictArtifact(row) { return row?.[VALIDATED_VERDICT] === true }
