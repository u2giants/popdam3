// A merge-from-main refresh keeps an APPROVE; a change of the author's own does not (#2758).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { isContentPreservingRefresh } from './pr-content-equivalence.mjs'

const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
function write(repo, files) { for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), body) } }
function commit(repo, files, message) { write(repo, files); git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', message]); return git(repo, ['rev-parse', 'HEAD']).trim() }

// main: seed. PR branch: a migration + evidence, approved at A. main then gains
// unrelated code, and the branch merges main (head B).
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'pr-equiv-'))
  git(repo, ['init', '-q', '-b', 'main']); git(repo, ['config', 'user.email', 't@example.invalid']); git(repo, ['config', 'user.name', 'T']); git(repo, ['config', 'commit.gpgsign', 'false'])
  commit(repo, { 'seed.sql': 'select 1;\n', '.agent/contract.json': '{"head":"seed"}\n' }, 'seed')
  git(repo, ['switch', '-q', '-c', 'pr'])
  const approved = commit(repo, { 'supabase/migrations/20260911120000_add_thing.sql': 'create table thing (id int);\n', '.agent/contract.json': '{"head":"a"}\n' }, 'pr change')
  git(repo, ['switch', '-q', 'main'])
  commit(repo, { 'scripts/other.mjs': 'export const x = 1\n', 'supabase/migrations/20260911110000_other.sql': 'select 2;\n' }, 'main moves')
  git(repo, ['switch', '-q', 'pr'])
  git(repo, ['merge', '-q', '--no-edit', 'main'])
  const refreshed = git(repo, ['rev-parse', 'HEAD']).trim()
  return { repo, approved, refreshed }
}
const check = (repo, approvedHead, head) => isContentPreservingRefresh({ approvedHead, head, mainRef: 'main', gitRunner: (args) => git(repo, args) })

test('a merge-only refresh from main keeps the approval', () => {
  const { repo, approved, refreshed } = fixture()
  try { const proof = check(repo, approved, refreshed); assert.equal(proof.ok, true, proof.reason) } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a refresh that also edits the migration needs a new review', () => {
  const { repo, approved } = fixture()
  try {
    const edited = commit(repo, { 'supabase/migrations/20260911120000_add_thing.sql': 'create table thing (id bigint);\n' }, 'edit migration')
    const proof = check(repo, approved, edited)
    assert.equal(proof.ok, false); assert.match(proof.reason, /diff changed/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a whitespace-only edit inside SQL is a change', () => {
  const { repo, approved } = fixture()
  try {
    const edited = commit(repo, { 'supabase/migrations/20260911120000_add_thing.sql': 'create table thing  (id int);\n' }, 'whitespace')
    assert.equal(check(repo, approved, edited).ok, false)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('an .agent evidence-only change keeps the approval', () => {
  const { repo, approved, refreshed } = fixture()
  try {
    const evidence = commit(repo, { '.agent/contract.json': `{"head":"${refreshed}"}\n`, '.agent/completion.json': '{}\n' }, 'bind evidence')
    const proof = check(repo, approved, evidence); assert.equal(proof.ok, true, proof.reason)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: main editing the same file outside the hunk context needs a new review', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pr-equiv-'))
  try {
    git(repo, ['init', '-q', '-b', 'main']); git(repo, ['config', 'user.email', 't@example.invalid']); git(repo, ['config', 'user.name', 'T']); git(repo, ['config', 'commit.gpgsign', 'false'])
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`)
    const body = (edit) => { const copy = [...lines]; edit(copy); return copy.join('\n') + '\n' }
    commit(repo, { 'scripts/shared.mjs': body(() => {}) }, 'seed')
    git(repo, ['switch', '-q', '-c', 'pr'])
    const approved = commit(repo, { 'scripts/shared.mjs': body((c) => { c[1] = 'pr edit' }) }, 'pr change')
    git(repo, ['switch', '-q', 'main'])
    commit(repo, { 'scripts/shared.mjs': body((c) => { c[27] = 'main edit' }) }, 'main edits far away')
    git(repo, ['switch', '-q', 'pr'])
    git(repo, ['merge', '-q', '--no-edit', 'main'])
    const refreshed = git(repo, ['rev-parse', 'HEAD']).trim()
    const proof = check(repo, approved, refreshed)
    assert.equal(proof.ok, false); assert.match(proof.reason, /main changed scripts\/shared\.mjs/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: only the root .agent/ tree is excluded; a nested .agent path is compared', () => {
  const { repo, approved } = fixture()
  try {
    const nested = commit(repo, { 'supabase/.agent/contract.json': '{"smuggled":true}\n' }, 'nested agent dir')
    const proof = check(repo, approved, nested)
    assert.equal(proof.ok, false); assert.match(proof.reason, /diff changed/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a rewritten branch is not a refresh even with the same diff', () => {
  const { repo, approved } = fixture()
  try {
    git(repo, ['switch', '-q', '-c', 'rewrite', 'main'])
    const rebuilt = commit(repo, { 'supabase/migrations/20260911120000_add_thing.sql': 'create table thing (id int);\n', '.agent/contract.json': '{"head":"a"}\n' }, 'rebased')
    const proof = check(repo, approved, rebuilt)
    assert.equal(proof.ok, false); assert.match(proof.reason, /not an ancestor/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: an unreadable head is not equivalent', () => {
  const { repo, approved } = fixture()
  try { assert.equal(check(repo, approved, 'f'.repeat(40)).ok, false) } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('a carried approval records the approved implementation digest, unchanged by an evidence commit', () => {
  const { repo, approved, refreshed } = fixture()
  try {
    const merged = check(repo, approved, refreshed)
    assert.match(merged.implementation_digest, /^[0-9a-f]{64}$/)
    const evidence = commit(repo, { '.agent/completion.json': '{"bound":true}\n' }, 'evidence only')
    assert.equal(check(repo, approved, evidence).implementation_digest, merged.implementation_digest)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

// STORED SCRIPT HASH (#2728). main pins a detector hash in a baseline; the pull
// request edits another baseline line, then merges a main that changed the script
// and re-pinned the hash. Spacer lines keep the two hunks apart so the merge is clean.
const REGISTRY = JSON.stringify({ schema_version: 1, entries: [{ file: 'docs/baseline.json', field: 'detector_source_sha256', source: 'scripts/detector.py' }] })
const sha = (text) => createHash('sha256').update(text).digest('hex')
const baseline = (hash, tail) => `{\n  "detector_source_sha256": "${hash}",\n${Array.from({ length: 12 }, (_, i) => `  "spacer_${i}": ${i},\n`).join('')}  "tail": "${tail}"\n}\n`
function storedFixture({ registryOnMain = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'pr-equiv-hash-'))
  git(repo, ['init', '-q', '-b', 'main']); git(repo, ['config', 'user.email', 't@example.invalid']); git(repo, ['config', 'user.name', 'T']); git(repo, ['config', 'commit.gpgsign', 'false'])
  const seed = { 'scripts/detector.py': 'print(1)\n', 'docs/baseline.json': baseline(sha('print(1)\n'), 'old') }
  if (registryOnMain) seed['config/review-carry-forward-stored-hashes-v1.json'] = REGISTRY
  commit(repo, seed, 'seed')
  git(repo, ['switch', '-q', '-c', 'pr'])
  const prFiles = { 'docs/baseline.json': baseline(sha('print(1)\n'), 'new'), 'scripts/feature.mjs': 'export const y = 1\n' }
  if (!registryOnMain) prFiles['config/review-carry-forward-stored-hashes-v1.json'] = REGISTRY
  const approved = commit(repo, prFiles, 'pr change')
  git(repo, ['switch', '-q', 'main'])
  commit(repo, { 'scripts/detector.py': 'print(2)\n', 'docs/baseline.json': baseline(sha('print(2)\n'), 'old') }, 'main changes detector and re-pins')
  git(repo, ['switch', '-q', 'pr'])
  git(repo, ['merge', '-q', '--no-edit', 'main'])
  return { repo, approved, refreshed: git(repo, ['rev-parse', 'HEAD']).trim() }
}

test('a merge from main that re-pins a registered script hash keeps the approval', () => {
  const { repo, approved, refreshed } = storedFixture()
  try { const proof = check(repo, approved, refreshed); assert.equal(proof.ok, true, proof.reason); assert.match(proof.implementation_digest, /^[0-9a-f]{64}$/) } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a pinned hash that does not match its source voids the approval', () => {
  const { repo, approved } = storedFixture()
  try {
    const wrong = commit(repo, { 'docs/baseline.json': baseline('a'.repeat(64), 'new') }, 'wrong pin')
    const proof = check(repo, approved, wrong); assert.equal(proof.ok, false); assert.match(proof.reason, /pins a script hash/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a one-line change in the pinned file beside a valid re-pin voids the approval', () => {
  const { repo, approved } = storedFixture()
  try {
    const edited = commit(repo, { 'docs/baseline.json': baseline(sha('print(2)\n'), 'newer') }, 'one line')
    assert.equal(check(repo, approved, edited).ok, false)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a one-line implementation change voids the approval after a re-pin refresh', () => {
  const { repo, approved } = storedFixture()
  try {
    const edited = commit(repo, { 'scripts/feature.mjs': 'export const y = 2\n' }, 'one line')
    const proof = check(repo, approved, edited); assert.equal(proof.ok, false); assert.match(proof.reason, /diff changed/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a registry added only by the pull request is not trusted', () => {
  const { repo, approved, refreshed } = storedFixture({ registryOnMain: false })
  try { assert.equal(check(repo, approved, refreshed).ok, false) } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a malformed registry on main fails closed', () => {
  const { repo, approved, refreshed } = storedFixture()
  try {
    git(repo, ['switch', '-q', 'main'])
    commit(repo, { 'config/review-carry-forward-stored-hashes-v1.json': '{"schema_version":1,"entries":[{"file":"../x","field":"f","source":"s"}]}' }, 'bad registry')
    const proof = check(repo, approved, refreshed); assert.equal(proof.ok, false); assert.match(proof.reason, /registry/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a mode-only change to a stored-hash file voids the approval', () => {
  const { repo, approved, refreshed } = storedFixture()
  try {
    assert.equal(check(repo, approved, refreshed).ok, true)
    git(repo, ['update-index', '--chmod=+x', 'docs/baseline.json']); git(repo, ['commit', '-q', '-m', 'mode only'])
    const moded = git(repo, ['rev-parse', 'HEAD']).trim()
    assert.equal(git(repo, ['diff', '--name-only', refreshed, moded]).trim(), 'docs/baseline.json')
    const proof = check(repo, approved, moded); assert.equal(proof.ok, false); assert.match(proof.reason, /pins a script hash/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL: a non-blob at a stored-hash path fails closed', () => {
  const { repo, approved, refreshed } = storedFixture()
  try {
    git(repo, ['update-index', '--cacheinfo', `160000,${refreshed},docs/baseline.json`]); git(repo, ['commit', '-q', '-m', 'gitlink'])
    const linked = git(repo, ['rev-parse', 'HEAD']).trim()
    const proof = check(repo, approved, linked); assert.equal(proof.ok, false); assert.match(proof.reason, /not a regular file \(160000 commit\)/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})
