import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const script = path.resolve('scripts/check-skill-drift.mjs')
// Same candidate list as scripts/check-skill-drift.mjs, so the test finds the
// ai-devops checkout on Linux hosts as well as Windows ones.
const sourceRoot = process.env.AI_DEVOPS_DIR || [
  'C:/repos/ai-devops',
  '/c/repos/ai-devops',
  '/repos/ai-devops',
  path.join(process.env.HOME ?? '', 'repos/ai-devops'),
].find((dir) => existsSync(path.join(dir, 'skills', 'shared'))) || 'C:/repos/ai-devops'
const canonical = path.join(sourceRoot, 'skills', 'shared')

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'skill-drift-'))
  mkdirSync(path.join(root, 'skills'), { recursive: true })
  cpSync(canonical, path.join(root, 'skills', 'shared'), { recursive: true })
  const target = path.join(root, 'skills', 'claude', 'shared-db-change')
  mkdirSync(path.dirname(target), { recursive: true })
  cpSync(path.join(sourceRoot, 'skills', 'claude', 'shared-db-change'), target, { recursive: true })
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
