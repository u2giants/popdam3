#!/usr/bin/env node
// Explicit registered #3618 stopped-merged custody operation.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transferStoppedMergedClaimAuthor, validateStoppedMergedAdoptionRequest } from './lib/lanes/stopped-merged-claim-adoption.mjs'

const FLAGS = new Map([
  ['--request-file','requestFile'], ['--review-issue','reviewIssue'], ['--review-pr','reviewPr'], ['--review-head-sha','reviewHeadSha'],
  ['--observation-file','observationFile'], ['--preservation-bundle','preservationBundle']
])
export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = FLAGS.get(argv[i]); const value = argv[i + 1]
    if (!key || Object.hasOwn(out, key) || !value || value.startsWith('--')) throw Error('unknown, duplicate or missing guarded adoption argument')
    out[key] = value
  }
  if (!out.requestFile || !out.observationFile || !out.preservationBundle || !out.reviewIssue || !out.reviewPr || !out.reviewHeadSha) throw Error('request, review, observation and preservation files are required')
  const request = JSON.parse(readFileSync(out.requestFile, 'utf8'))
  request.authorizationQuote = request.authorizationQuote ?? ''
  out.reviewIssue = Number(out.reviewIssue); out.reviewPr = Number(out.reviewPr)
  if (out.reviewIssue !== 3618) throw Error('review issue must be the registered capability issue 3618')
  out.request = validateStoppedMergedAdoptionRequest(request)
  out.observation = JSON.parse(readFileSync(out.observationFile, 'utf8'))
  return out
}
export function main(argv, now = new Date(), io, output = console) {
  try { const args = parseArgs(argv); const result = transferStoppedMergedClaimAuthor(args, now, io); output.log(JSON.stringify(result, null, 2)); return 0 } catch (error) { output.error(error.message); return 1 }
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
