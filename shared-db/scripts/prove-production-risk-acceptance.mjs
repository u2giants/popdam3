#!/usr/bin/env node
// AI REVIEWER RISK ACCEPTANCE FOR AUTOMATIC PRODUCTION PROMOTION.
//
// OWNER RULING, Albert Hazan in his chat 2026-09-30 (verbatim):
//   "i am non-technical and unqualified to answer technical questions. as a
//    reviewer. now and in the future"
// and 2026-09-28: "never ask a human to approve".
//
// Before this file, a migration whose SQL the business-risk classifier flagged
// (material access change, data rewrite or loss, expected downtime) could reach
// production only through a `production-owner-decision` block authored by
// Albert. He cannot evaluate that SQL, so that gate produced a signature, not a
// judgement. The judgement now comes from where the technical review already
// comes from: the allocator-assigned AI reviewer, recorded durably.
//
// WHAT IS ACCEPTED, AND NOTHING LESS:
//   1. The exact source PR head carries a DURABLE, allocator-assigned APPROVE:
//      `assertDurableReviewApproval` (every assigned slot APPROVEd, no durable
//      refusal, each verdict a create-only ref parented on its assignment, its
//      findings comment bound by digest). Nothing here can be typed in by a
//      session: the verdict is read from refs/db-review-verdicts*.
//   2. At least one of those validated APPROVE verdicts has findings (digest
//      re-checked here) that contain EXACTLY ONE fenced block
//        ```production-risk-assessment
//        {"schema":"shared-db-production-risk-assessment/v1", "main_sha": ...,
//         "ordered_allowlist": [...], "source_pr": N,
//         "assessed_risks": {"<risk_key>": "<the reviewer's assessment>", ...}}
//        ```
//      naming the EXACT main SHA being promoted, the EXACT ordered versions and
//      the source PR, and assessing EVERY risk class the gate derived with a
//      substantive written assessment (no class may be skipped or invented).
// Every other production gate (exact main, allowlist, preview/ephemeral
// evidence, hard blocks, production lock, post-apply verification) is outside
// this file and unchanged. A human is never asked.
import { pathToFileURL } from 'node:url'
import { assertDurableReviewApproval, githubIo } from './manage-migration-author-lanes.mjs'
import { findingsDigest } from './lib/review-verdict-artifact.mjs'

export const ASSESSMENT_SCHEMA = 'shared-db-production-risk-assessment/v1'
export const ACCEPTABLE_RISKS = Object.freeze(['expected_downtime', 'material_access_change', 'permanent_data_rewrite_or_loss'])
export const MIN_ASSESSMENT_CHARS = 40
const FENCE = /```production-risk-assessment[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g

export class RiskAcceptanceError extends Error {}

export function parseRiskAssessment(body, { mainSha, allowlist, sourcePr, risks }) {
  const blocks = [...String(body ?? '').matchAll(FENCE)]
  if (blocks.length !== 1) throw new RiskAcceptanceError(`findings carry ${blocks.length} production-risk-assessment blocks; exactly one is required`)
  let data
  try { data = JSON.parse(blocks[0][1]) } catch { throw new RiskAcceptanceError('production-risk-assessment block is not valid JSON') }
  const keys = ['assessed_risks', 'main_sha', 'ordered_allowlist', 'schema', 'source_pr']
  if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(keys)) throw new RiskAcceptanceError(`production-risk-assessment must have exactly the fields ${keys.join(', ')}`)
  if (data.schema !== ASSESSMENT_SCHEMA) throw new RiskAcceptanceError('production-risk-assessment schema is wrong')
  if (String(data.main_sha).toLowerCase() !== String(mainSha).toLowerCase() || !/^[0-9a-f]{40}$/i.test(String(mainSha))) throw new RiskAcceptanceError(`assessment names main ${data.main_sha}, not the exact promoted main ${mainSha}`)
  if (JSON.stringify(data.ordered_allowlist) !== JSON.stringify(allowlist)) throw new RiskAcceptanceError('assessment names a different ordered migration allowlist')
  if (data.source_pr !== Number(sourcePr)) throw new RiskAcceptanceError('assessment names a different source PR')
  const wanted = [...new Set(risks)].sort()
  if (!wanted.length) throw new RiskAcceptanceError('no derived risk class to accept')
  for (const risk of wanted) if (!ACCEPTABLE_RISKS.includes(risk)) throw new RiskAcceptanceError(`risk class ${risk} cannot be accepted by a reviewer assessment`)
  const assessed = data.assessed_risks
  if (!assessed || typeof assessed !== 'object' || Array.isArray(assessed)) throw new RiskAcceptanceError('assessed_risks must be an object')
  if (JSON.stringify(Object.keys(assessed).sort()) !== JSON.stringify(wanted)) throw new RiskAcceptanceError(`assessment covers [${Object.keys(assessed).sort()}], but the gate derived exactly [${wanted}]`)
  for (const risk of wanted) if (typeof assessed[risk] !== 'string' || assessed[risk].trim().length < MIN_ASSESSMENT_CHARS) throw new RiskAcceptanceError(`assessment of ${risk} is absent or not substantive`)
  return data
}

export function proveRiskAcceptance({ issue, pr, headSha, mainSha, allowlist, risks }, io = githubIo, approval = assertDurableReviewApproval) {
  let verdicts
  try { verdicts = approval(Number(issue), Number(pr), String(headSha).toLowerCase(), io, { includeArchived: true }) }
  catch (error) { throw new RiskAcceptanceError(`no durable allocator-assigned exact-head APPROVE for PR #${pr} at ${headSha}: ${error.message}`) }
  const approvals = (verdicts ?? []).filter((row) => row.verdict === 'APPROVE' && String(row.head_sha ?? '').toLowerCase() === String(headSha).toLowerCase())
  const failures = []
  for (const row of approvals) {
    try {
      const body = io.readFindings(row.findings_ref)
      if (findingsDigest(body) !== row.findings_digest) throw new RiskAcceptanceError('findings digest changed')
      const assessment = parseRiskAssessment(body, { mainSha, allowlist, sourcePr: pr, risks })
      return { schema: ASSESSMENT_SCHEMA, verdictRef: row.ref, verdictSha: row.sha, reviewer: row.reviewer, headSha: String(headSha).toLowerCase(), findingsRef: row.findings_ref, findingsDigest: row.findings_digest, mainSha: assessment.main_sha, orderedAllowlist: assessment.ordered_allowlist, sourcePr: assessment.source_pr, assessedRisks: assessment.assessed_risks }
    } catch (error) { failures.push(`${row.ref}: ${error.message}`) }
  }
  throw new RiskAcceptanceError(`no durable APPROVE at ${headSha} carries a matching reviewer risk assessment${failures.length ? ` (${failures.join('; ')})` : ''}`)
}

function main(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1]
  const result = proveRiskAcceptance({ issue: opts.issue, pr: opts.pr, headSha: opts['head-sha'], mainSha: opts['main-sha'], allowlist: String(opts.allowlist ?? '').split(',').map((v) => v.trim()).filter(Boolean), risks: String(opts.risks ?? '').split(',').filter(Boolean) })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(process.argv.slice(2)) } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2) }
}
