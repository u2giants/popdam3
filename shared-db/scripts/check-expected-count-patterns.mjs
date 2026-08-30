#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const [migrationDir, addedVersionsFile] = process.argv.slice(2)
const added = new Set(fs.readFileSync(addedVersionsFile, 'utf8').split(/\r?\n/).filter(Boolean))
const failures = []

for (const name of fs.readdirSync(migrationDir).filter((value) => value.endsWith('.sql') && added.has(value.slice(0, 14)))) {
  const sql = fs.readFileSync(path.join(migrationDir, name), 'utf8')
  const compact = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const directInteger = /\(\s*[a-z_][a-z0-9_.]*expected_counts\s*->>\s*(?:'[^']+'|[a-z_][a-z0-9_]*)\s*\)\s*::\s*(?:bigint|integer|int)\b/gi
  if (directInteger.test(compact)) {
    failures.push(`${name}: expected_counts text is cast directly to an integer; validate as a JSON number and assign through numeric first`)
  }

  const keyUse = /([a-z_][a-z0-9_.]*expected_counts)\s*\?\s*('([^']+)'|([a-z_][a-z0-9_]*))[\s\S]{0,800}?\1\s*->>\s*\2/gi
  for (const match of compact.matchAll(keyUse)) {
    const object = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const key = match[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const typed = new RegExp(`jsonb_typeof\\s*\\(\\s*${object}\\s*->\\s*${key}\\s*\\)\\s*(?:=|<>)\\s*'number'`, 'i')
    const globalTyped = new RegExp(`jsonb_each\\s*\\(\\s*${object}\\s*\\)[\\s\\S]{0,300}?jsonb_typeof\\s*\\([^)]*value[^)]*\\)\\s*(?:=|<>)\\s*'number'`, 'i')
    if (!typed.test(compact) && !globalTyped.test(compact)) {
      failures.push(`${name}: expected_counts key ${match[2]} is trusted after a bare ? test without a JSON-number type check`)
    }
  }
}

if (failures.length) {
  console.error('ERROR: unsafe expected-count JSON pattern detected (issue #1235):')
  for (const failure of [...new Set(failures)]) console.error(`  ${failure}`)
  process.exit(1)
}

console.log('Issue #1235 expected-count guard passed: added migrations validate JSON count types and avoid raw integer casts.')
