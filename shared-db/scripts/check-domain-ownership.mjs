#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const productionHost = 'data.designflow.app'
const requiredOwner = 'DB Data Admin'
const forbiddenRuntimeVestiges = [
  { pattern: /\.directus-deploy\.env/i, label: 'retired environment file' },
  { pattern: /\bdirectus-db-[a-z0-9-]+\b/i, label: 'retired database container' },
  { pattern: /\bDX_URL\s*=/i, label: 'retired API connection variable' },
  {
    pattern: /\bnzli85mk3luzb6u7cnq5fidu\b/i,
    label: 'retired Coolify application identifier',
  },
]

const forbiddenClaims = [
  {
    pattern: /Directus[^.\n]{0,120}\b(?:stays|remains|running|rollback|import source|read-only)\b/i,
    label: 'claim that the retired application still has a live or rollback role',
  },
  {
    pattern: /\b(?:stays|remains|running|rollback|import source|read-only)\b[^.\n]{0,120}Directus/i,
    label: 'claim that the retired application still has a live or rollback role',
  },
  {
    pattern: new RegExp(`Directus[^\\n]{0,160}${productionHost.replaceAll('.', '\\.')}`, 'i'),
    label: 'association between the retired application and DB Data Admin hostname',
  },
  {
    pattern: new RegExp(`${productionHost.replaceAll('.', '\\.')}[^\\n]{0,160}Directus`, 'i'),
    label: 'association between DB Data Admin hostname and the retired application',
  },
]

export function checkOwnership(entries) {
  const failures = []

  for (const [file, text] of entries) {
    for (const rule of forbiddenRuntimeVestiges) {
      if (rule.pattern.test(text)) failures.push(`${file}: ${rule.label}`)
    }

    for (const rule of forbiddenClaims) {
      if (rule.pattern.test(text)) failures.push(`${file}: ${rule.label}`)
    }

    if (
      text.includes(productionHost) &&
      !text.includes(requiredOwner)
    ) {
      failures.push(
        `${file}: uses ${productionHost} without identifying its owner as ${requiredOwner}`,
      )
    }
  }

  return failures
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
  }).split('\0').filter(Boolean)

  const textFiles = files.filter((file) =>
    file !== 'scripts/check-domain-ownership.test.mjs' &&
    /\.(?:md|mdc|txt|ya?ml|json|mjs|cjs|js|jsx|ts|tsx|html|css|env|example)$/i.test(file),
  )
  const failures = checkOwnership(
    textFiles.map((file) => [file, readFileSync(file, 'utf8')]),
  )

  if (failures.length > 0) {
    console.error('DB Data Admin domain-ownership check failed:')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }

  console.log(
    `Domain ownership passed: ${productionHost} is reserved exclusively for ${requiredOwner}; no retired runtime vestiges were found.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
