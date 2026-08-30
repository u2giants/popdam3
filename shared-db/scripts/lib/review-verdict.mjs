const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const CONDITIONAL = /\bWITH\s+CONDITIONS?\b/i
const APPROVE = /^APPROVE(?:D)?(?![A-Za-z0-9])/i
const REFUSAL = /^(?:REJECT(?:ED)?|REVISE|REQUEST[_\s]CHANGES)(?![A-Za-z0-9])/i

export const stripVerdictLabel = (line) => String(line).replace(/^[\s>*_#-]+/, '').replace(/^VERDICT\s*:\s*/i, '').replace(/^[\s*_]+/, '')
const bodyLines = (body) => String(body ?? '').split(/\r?\n/)
export const verdictOpensLine = (body, pattern) => bodyLines(body).some((line) => pattern.test(stripVerdictLabel(line)))

export function trustedVerdictEvidence(row) {
  const association = String(row?.author_association ?? row?.authorAssociation ?? '').toUpperCase()
  return TRUSTED_ASSOCIATIONS.has(association)
}

export const evidenceTiedToHead = (row, headSha) => row?.commit_id === headSha || String(row?.body ?? '').includes(headSha)
export const unambiguouslyTiedToHead = (row, headSha) => row?.commit_id === headSha || (
  String(row?.body ?? '').includes(headSha) &&
  [...String(row?.body ?? '').matchAll(/[0-9a-f]{40}/gi)].every((match) => match[0].toLowerCase() === String(headSha).toLowerCase())
)

export const approvalLine = (body) => bodyLines(body).some((line, index, all) => {
  const stripped = stripVerdictLabel(line)
  return APPROVE.test(stripped) && !CONDITIONAL.test(`${stripped} ${all[index + 1] ?? ''}`)
})
export const refusalLine = (body) => bodyLines(body).some((line) => REFUSAL.test(stripVerdictLabel(line)))

const state = (row) => String(row?.state ?? '').toUpperCase()
export function isApprovalFor(row, headSha) {
  return trustedVerdictEvidence(row) && unambiguouslyTiedToHead(row, headSha) && (approvalLine(row?.body) || state(row) === 'APPROVED')
}
export function isVerdictFor(row, headSha) {
  if (!trustedVerdictEvidence(row) || !evidenceTiedToHead(row, headSha)) return false
  return ['APPROVED', 'CHANGES_REQUESTED'].includes(state(row)) || approvalLine(row?.body) || refusalLine(row?.body)
}
export const anyVerdictFor = (evidence, headSha) => (evidence ?? []).some((row) => isVerdictFor(row, headSha))
