#!/usr/bin/env node
// Validate this small explicit matrix, never infer policy from arbitrary prose.
// Owner-ruling rows below assert the cited rulings, not a second activation file.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isDocumentsOnlyChange } from './lib/documents-only-change.mjs'
import { EXCLUSIVE_REFS } from './manage-migration-author-lanes.mjs'

export function expectedPolicy({ activation, approvalSource, documentsOnly = isDocumentsOnlyChange, exclusiveRefs = EXCLUSIVE_REFS }) {
  const slots = approvalSource.match(/const requiredSlots\s*=\s*Object\.prototype\.hasOwnProperty\.call\(input,\s*'changedFiles'\)\s*&&\s*migrationsTouched\s*\?\s*(\d+)\s*:\s*(\d+)/)
  if (!slots) throw new Error('Policy authority changed: derive review counts from the current gate before updating this check')
  if (typeof activation?.active !== 'boolean') throw new Error('Production activation authority is not a boolean')
  if (!['preview', 'merge', 'production'].every((key) => typeof exclusiveRefs[key] === 'string' && exclusiveRefs[key])) throw new Error('Exclusive mutation lane authority changed')
  return {
    scope: 'structure-and-curated-master-data',
    'ordinary-rows': 'application-owner',
    authors: 'unlimited',
    'reviewer-concurrency': 'unlimited',
    'migration-reviews': slots[1],
    'governed-code-reviews': slots[2],
    'standalone-plans': documentsOnly(['plan_policy_example.md']) ? 'documentation' : 'guarded',
    'agent-instructions': ['AGENTS.md', 'CLAUDE.md', 'skills/example/SKILL.md', '.claude/agents/example.md'].every((path) => !documentsOnly([path])) ? 'guarded' : 'unguarded',
    'automatic-production-policy': activation.active ? 'active' : 'inactive',
    'preview-target': 'repository-variable-PREVIEW_PROJECT_REF',
    'exclusive-mutation-lanes': 'preview,merge,production',
    'completion-closure': 'issue-opener-or-explicit-authority',
  }
}

export function checkPolicy(document, expected) {
  const sections = String(document).split('## Policy matrix\n')
  if (sections.length !== 2) throw new Error('Current workflow requires one explicit Policy matrix section')
  const section = sections[1]?.split('\n## ')[0]
  if (!section) throw new Error('Current workflow requires one explicit Policy matrix section')
  const rows = new Map()
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((value) => value.trim())
    if (cells[0] === 'Policy' || cells.every((value) => /^-+$/.test(value))) continue
    if (cells.length !== 3 || !cells[2] || rows.has(cells[0])) throw new Error(`Invalid or duplicated policy row: ${cells[0]}`)
    rows.set(cells[0], cells[1])
  }
  const errors = Object.entries(expected).filter(([key, value]) => rows.get(key) !== value).map(([key, value]) => `${key}: expected ${value}, read ${rows.get(key) ?? '(absent)'}`)
  for (const key of rows.keys()) if (!(key in expected)) errors.push(`Unrecognized policy row: ${key}`)
  if (errors.length) throw new Error(`Current policy matrix mismatch: ${errors.join('; ')}`)
  return true
}

export function checkRouting({ agents, coordination }) {
  for (const [source, text, link] of [
    ['AGENTS.md', agents, '[current-workflow.md](docs/agents/current-workflow.md)'],
    ['section-4-anti-collision-rules.md', coordination, '[current-workflow.md](current-workflow.md)'],
  ]) {
    if (!String(text).split(/\r?\n/).some((line) => line.trim() === `- ${link}`)) throw new Error(`Current workflow routing link required in ${source}`)
  }
  return true
}

export function main() {
  try {
    const document = readFileSync(new URL('../docs/agents/current-workflow.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const activation = JSON.parse(readFileSync(new URL('../config/production-risk-policy-activation.json', import.meta.url), 'utf8'))
    const approvalSource = readFileSync(new URL('./check-exact-head-approval.mjs', import.meta.url), 'utf8')
    checkPolicy(document, expectedPolicy({ activation, approvalSource }))
    checkRouting({ agents: readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8'), coordination: readFileSync(new URL('../docs/agents/section-4-anti-collision-rules.md', import.meta.url), 'utf8') })
    console.log('Current workflow policy matrix matches implementation and cited owner rulings.')
    return 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
