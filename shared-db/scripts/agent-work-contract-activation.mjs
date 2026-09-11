#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export class ActivationError extends Error {}

const SHA_PATTERN = /^[0-9a-f]{40}$/i

export function validateActivationConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new ActivationError('activation config must be a JSON object')
  if (config.schema_version !== 1) throw new ActivationError('activation config schema_version must be 1')
  if (!['report-only', 'enforced'].includes(config.mode)) throw new ActivationError('activation config mode must be report-only or enforced')
  if (!Array.isArray(config.grandfathered_prs)) throw new ActivationError('activation config grandfathered_prs must be an array')
  const seen = new Set()
  for (const entry of config.grandfathered_prs) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ActivationError('each grandfathered PR must name its number and exact head_sha')
    const keys = Object.keys(entry).sort().join(',')
    if (keys !== 'head_sha,number') throw new ActivationError('each grandfathered PR must contain only number and head_sha')
    if (!Number.isInteger(entry.number) || entry.number <= 0) throw new ActivationError('grandfathered PR number must be a positive integer')
    if (!SHA_PATTERN.test(entry.head_sha)) throw new ActivationError(`grandfathered PR #${entry.number} must carry an exact 40-character head_sha`)
    if (seen.has(entry.number)) throw new ActivationError(`grandfathered PR #${entry.number} is listed more than once`)
    seen.add(entry.number)
  }
  if (config.mode === 'enforced' && !/^\d{4}-\d{2}-\d{2}$/.test(String(config.activated_at ?? ''))) {
    throw new ActivationError('enforced mode requires activated_at as YYYY-MM-DD')
  }
  return config
}

export function isGrandfathered(config, { pr, headSha }) {
  validateActivationConfig(config)
  if (!Number.isInteger(pr) || pr <= 0 || !SHA_PATTERN.test(String(headSha ?? ''))) return false
  return config.grandfathered_prs.some((entry) => entry.number === pr && entry.head_sha === headSha)
}

function parseArgs(argv) {
  const options = { configFile: null, pr: null, headSha: null, mode: false, isGrandfathered: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--config-file') { options.configFile = value; i++; continue }
    if (arg === '--pr') { options.pr = Number(value); i++; continue }
    if (arg === '--head-sha') { options.headSha = value; i++; continue }
    if (arg === '--mode') { options.mode = true; continue }
    if (arg === '--is-grandfathered') { options.isGrandfathered = true; continue }
    throw new ActivationError(`unknown argument ${arg}`)
  }
  if (!options.configFile || Number(options.mode) + Number(options.isGrandfathered) !== 1) throw new ActivationError('choose --mode or --is-grandfathered and provide --config-file')
  return options
}

export function main(argv, io = {}) {
  const log = io.log ?? console.log
  const error = io.error ?? console.error
  try {
    const options = parseArgs(argv)
    const config = validateActivationConfig(JSON.parse(readFileSync(options.configFile, 'utf8')))
    if (options.mode) { log(config.mode); return 0 }
    if (isGrandfathered(config, { pr: options.pr, headSha: options.headSha })) { log(`PR #${options.pr} is grandfathered at exact head ${options.headSha}.`); return 0 }
    return 1
  } catch (failure) {
    error(failure.message)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2))
