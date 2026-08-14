import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const script = path.resolve('scripts/check-skill-drift.mjs')
const canonical = path.join(process.env.AI_DEVOPS_DIR || 'C:/repos/ai-devops', 'skills', 'shared')

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'skill-drift-'))
  mkdirSync(path.join(root, 'skills'), { recursive: true })
  cpSync(canonical, path.join(root, 'skills', 'shared'), { recursive: true })
  const sourceRoot = process.env.AI_DEVOPS_DIR || 'C:/repos/ai-devops'
  for (const skill of ['shared-db-change', 'shared-db-handover']) {
    const target = path.join(root, 'skills', 'claude', skill)
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(path.join(sourceRoot, 'skills', 'claude', skill), target, { recursive: true })
  }
  return root
}

function run(root) {
  return spawnSync(process.execPath, [script, '--require-skills'], {
    cwd: path.resolve('.'), env: { ...process.env, AI_DEVOPS_DIR: root }, encoding: 'utf8',
  })
}

test('canonical shared skill is found and passes required safety assertions', () => {
  const root = fixture()
  try { assert.equal(run(root).status, 0) } finally { rmSync(root, { recursive: true, force: true }) }
})

test('require-skills fails when only the retired claude path exists', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skill-drift-'))
  mkdirSync(path.join(root, 'skills', 'claude', 'shared-db-orchestrator'), { recursive: true })
  writeFileSync(path.join(root, 'skills', 'claude', 'shared-db-orchestrator', 'SKILL.md'), 'old')
  try { assert.notEqual(run(root).status, 0) } finally { rmSync(root, { recursive: true, force: true }) }
})

test('missing atomic/exclusive wording fails', () => {
  const root = fixture()
  const skill = path.join(root, 'skills', 'shared', 'shared-db-orchestrator', 'SKILL.md')
  const text = execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(skill)},'utf8').replace(/exclusive GitHub-backed preview lock/i,'preview turn'))`], { encoding: 'utf8' })
  writeFileSync(skill, text)
  try {
    const result = run(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing-exclusive-preview/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
