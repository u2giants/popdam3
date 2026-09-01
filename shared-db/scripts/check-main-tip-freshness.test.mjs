// Tests for the main-tip freshness narrowing (#2047, #2030).
//
// EVERY permissive assertion here is paired with a POSITIVE CONTROL that must
// still REFUSE. A test suite for a gate that only proves the gate says yes is
// worthless: it passes just as happily when the gate has been disabled. The
// controls below are the reason to believe this narrowing narrowed only what it
// claimed to.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyMainTip, isDocumentationPath } from './check-main-tip-freshness.mjs'

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A throwaway repository with a first commit, returned with its SHA. */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'main-tip-'))
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.invalid'])
  git(repo, ['config', 'user.name', 'Test'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repo, 'seed.sql'), 'select 1;\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'seed'])
  return { repo, sha: git(repo, ['rev-parse', 'HEAD']).trim() }
}

function commitFiles(repo, files, message) {
  for (const [path, body] of Object.entries(files)) {
    const full = join(repo, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', message])
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

function classify(repo, mainSha, tipSha) {
  return classifyMainTip({
    mainSha,
    tipSha,
    gitRunner: (args) => git(repo, args),
  })
}

test('an unmoved tip is accepted, exactly as the bare equality test did', () => {
  const { repo, sha } = makeRepo()
  try {
    const verdict = classify(repo, sha, sha)
    assert.equal(verdict.ok, true)
    assert.match(verdict.reason, /exactly the dispatched commit/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a tip that advanced by documentation only is accepted', () => {
  const { repo, sha } = makeRepo()
  try {
    const tip = commitFiles(
      repo,
      { 'HANDOFF.d/2026-09-01T1059Z-note.md': '# note\n', 'AGENTS.md': 'rules\n' },
      'docs: handover',
    )
    const verdict = classify(repo, sha, tip)
    assert.equal(verdict.ok, true, verdict.reason)
    assert.match(verdict.reason, /every change since/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('POSITIVE CONTROL: a tip that advanced by a migration is still refused', () => {
  const { repo, sha } = makeRepo()
  try {
    const tip = commitFiles(
      repo,
      { 'supabase/migrations/20260901120000_thing.sql': 'create table x();\n' },
      'feat: migration',
    )
    const verdict = classify(repo, sha, tip)
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /not documentation/)
    assert.match(verdict.reason, /20260901120000_thing\.sql/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('POSITIVE CONTROL: one code file among many documentation files still refuses', () => {
  const { repo, sha } = makeRepo()
  try {
    commitFiles(repo, { 'HANDOFF.d/a.md': 'a\n' }, 'docs: a')
    commitFiles(repo, { 'HANDOFF.d/b.md': 'b\n' }, 'docs: b')
    const tip = commitFiles(repo, { 'scripts/thing.mjs': '// x\n' }, 'feat: script')
    const verdict = classify(repo, sha, tip)
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /scripts\/thing\.mjs/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('POSITIVE CONTROL: the reviewed detector baseline is NOT documentation, despite living in docs/', () => {
  // This is the case a directory-based allowlist would have gotten wrong, and it
  // is the reason the rule is extension-based. See the header of the script.
  assert.equal(
    isDocumentationPath('docs/verification/throughput-guard-truth-baseline-20260828.json'),
    false,
  )

  const { repo, sha } = makeRepo()
  try {
    const tip = commitFiles(
      repo,
      { 'docs/verification/throughput-guard-truth-baseline-20260828.json': '{"a":1}\n' },
      'chore: baseline',
    )
    const verdict = classify(repo, sha, tip)
    assert.equal(verdict.ok, false, 'a reviewed baseline must never pass as documentation')
    assert.match(verdict.reason, /throughput-guard-truth-baseline/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('POSITIVE CONTROL: Markdown inside .github/ is not documentation', () => {
  assert.equal(isDocumentationPath('.github/PULL_REQUEST_TEMPLATE.md'), false)
  assert.equal(isDocumentationPath('.github/workflows/apply.yml'), false)
})

test('POSITIVE CONTROL: a tip on a different line of history is refused, not diffed', () => {
  const { repo, sha } = makeRepo()
  try {
    // Rewrite history so the dispatched commit is no longer an ancestor. Even
    // though the divergent commit touches only Markdown, the answer is REFUSE:
    // the tip did not advance, it was replaced.
    git(repo, ['checkout', '-q', '--orphan', 'other'])
    git(repo, ['rm', '-q', '-rf', '.'])
    const tip = commitFiles(repo, { 'README.md': 'other\n' }, 'docs: orphan')
    const verdict = classify(repo, sha, tip)
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /different line of\s+history/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a malformed MAIN_SHA is refused rather than resolved', () => {
  const verdict = classifyMainTip({ mainSha: 'main', tipSha: 'a'.repeat(40) })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /not a full 40-character commit SHA/)
})

test('an unresolvable tip is refused', () => {
  const verdict = classifyMainTip({ mainSha: 'a'.repeat(40), tipSha: '' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /could not be resolved/)
})

test('POSITIVE CONTROL: an unreadable range refuses instead of passing', () => {
  const verdict = classifyMainTip({
    mainSha: 'a'.repeat(40),
    tipSha: 'b'.repeat(40),
    gitRunner: (args) => {
      if (args[0] === 'merge-base') return '' // claim ancestry
      throw new Error('git exploded')
    },
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /could not be read/)
})

test('POSITIVE CONTROL: an advanced tip reporting no changed file refuses', () => {
  const verdict = classifyMainTip({
    mainSha: 'a'.repeat(40),
    tipSha: 'b'.repeat(40),
    gitRunner: (args) => (args[0] === 'merge-base' ? '' : ''),
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /no changed file/)
})

test('POSITIVE CONTROL: a rename from code to Markdown is refused, not hidden', () => {
  // `diff.renames` defaults to true, and rename detection makes --name-only
  // report ONLY the destination. Without --no-renames this commit reports one
  // Markdown path and PASSES while deleting a script. Found by external review.
  const { repo, sha } = makeRepo()
  try {
    commitFiles(repo, { 'scripts/thing.mjs': '// x\n' }, 'feat: script')

    const base = git(repo, ['rev-parse', 'HEAD']).trim()
    git(repo, ['config', 'diff.renames', 'true'])
    mkdirSync(join(repo, 'docs'), { recursive: true })
    git(repo, ['mv', 'scripts/thing.mjs', 'docs/thing.md'])
    git(repo, ['commit', '-q', '-m', 'chore: rename'])
    const tip = git(repo, ['rev-parse', 'HEAD']).trim()
    const verdict = classify(repo, base, tip)
    assert.equal(verdict.ok, false, 'a code file renamed to .md must not pass as documentation')
    assert.match(verdict.reason, /scripts\/thing\.mjs/)
    assert.equal(sha.length, 40)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('POSITIVE CONTROL: a .txt control file is NOT documentation', () => {
  // supabase/tests/ci-quarantine.txt decides which contract tests may fail the
  // job. `.txt` is therefore not an inert extension in this repository, and was
  // removed from the allowlist after external review.
  assert.equal(isDocumentationPath('supabase/tests/ci-quarantine.txt'), false)
  assert.equal(isDocumentationPath('notes.txt'), false)
})

test('extension matching is case-insensitive but not substring-based', () => {
  assert.equal(isDocumentationPath('HANDOFF.d/x.MD'), true)
  // A file merely CONTAINING ".md" is not Markdown.
  assert.equal(isDocumentationPath('scripts/parse.md.py'), false)
  assert.equal(isDocumentationPath('supabase/migrations/1.sql'), false)
  assert.equal(isDocumentationPath(''), false)
})
