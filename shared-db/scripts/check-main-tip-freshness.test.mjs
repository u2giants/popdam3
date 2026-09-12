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

import { classifyBranchFreshness, classifyMainTip, isDocumentationPath } from './check-main-tip-freshness.mjs'

// #2758: a main that moved is not a refusal when the PR is independent of it.
// Fixture: dispatched main D; PR branch off D adds a migration + .agent evidence.
function branchFixture() {
  const { repo, sha: dispatched } = makeRepo()
  commitFiles(repo, { '.agent/contract.json': '{"h":"d"}\n', 'shared.mjs': 'export const a = 1\n' }, 'dispatched main')
  git(repo, ['switch', '-q', '-c', 'pr'])
  const head = commitFiles(repo, { 'supabase/migrations/20260911120000_pr.sql': 'create table pr_t (id int);\n', '.agent/contract.json': '{"h":"pr"}\n' }, 'pr')
  git(repo, ['switch', '-q', 'main'])
  return { repo, dispatched, head }
}
const branch = (repo, headSha, tipSha) => classifyBranchFreshness({ headSha, tipSha, gitRunner: (args) => git(repo, args) })

test('#2758: main moved by unrelated code, PR merges cleanly and touches none of it: accepted', () => {
  const { repo, head } = branchFixture()
  try {
    const tip = commitFiles(repo, { 'scripts/other.mjs': 'export const x = 1\n', 'supabase/migrations/20260911110000_other.sql': 'select 2;\n' }, 'main moves')
    const result = branch(repo, head, tip)
    assert.equal(result.ok, true, result.reason); assert.equal(result.independent, true)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('#2758: a branch that already merged main, with its own diff unchanged, is accepted', () => {
  const { repo, head } = branchFixture()
  try {
    commitFiles(repo, { 'scripts/other.mjs': 'export const x = 1\n' }, 'main moves')
    git(repo, ['switch', '-q', 'pr']); git(repo, ['merge', '-q', '--no-edit', 'main'])
    const refreshed = git(repo, ['rev-parse', 'HEAD']).trim()
    git(repo, ['switch', '-q', 'main'])
    const tip = commitFiles(repo, { 'scripts/third.mjs': 'export const y = 1\n' }, 'main moves again')
    const result = branch(repo, refreshed, tip)
    assert.equal(result.ok, true, result.reason)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('#2758: an .agent-only overlap that merges cleanly is accepted', () => {
  const { repo, head } = branchFixture()
  try {
    const tip = commitFiles(repo, { '.agent/completion.json': '{}\n', 'scripts/other.mjs': 'x\n' }, 'main moves with evidence')
    assert.equal(branch(repo, head, tip).ok, true)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL #2758: main changed a file the PR also changes: refused', () => {
  const { repo } = branchFixture()
  try {
    git(repo, ['switch', '-q', 'pr'])
    const head = commitFiles(repo, { 'shared.mjs': 'export const a = 2\n' }, 'pr edits shared')
    git(repo, ['switch', '-q', 'main'])
    const tip = commitFiles(repo, { 'shared.mjs': 'export const a = 1\nexport const b = 3\n' }, 'main edits shared')
    const result = branch(repo, head, tip)
    assert.equal(result.ok, false); assert.match(result.reason, /REFUSED/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL #2758: main took the same migration version: refused', () => {
  const { repo, head } = branchFixture()
  try {
    const tip = commitFiles(repo, { 'supabase/migrations/20260911120000_other.sql': 'select 3;\n' }, 'main takes the version')
    const result = branch(repo, head, tip)
    assert.equal(result.ok, false); assert.match(result.reason, /20260911120000/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('POSITIVE CONTROL #2758: an .agent overlap that conflicts is refused', () => {
  const { repo, head } = branchFixture()
  try {
    const tip = commitFiles(repo, { '.agent/contract.json': '{"h":"main-later"}\n', 'scripts/other.mjs': 'x\n' }, 'main rewrites evidence')
    const result = branch(repo, head, tip)
    assert.equal(result.ok, false); assert.match(result.reason, /conflict/i)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

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

// ISSUE #2465 -- a merge commit must be classified by what MAIN gained, not by
// the merged branch's own files. `git log -m` diffed the merge against BOTH
// parents, so the second parent contributed every file main already had that the
// branch did not, and the documentation exemption could never fire for a repo
// that merges through pull requests. Both directions are proved: a
// documentation-only advance through a merge is accepted, and a merge that
// actually lands code is still refused.
test('a documentation-only advance that lands through a merge commit is accepted (#2465)', () => {
  const { repo, sha } = makeRepo()
  try {
    // The documentation branch forks FIRST, at the seed. Main then gains a code
    // merge -- that merge is the dispatched commit. The documentation branch is
    // merged afterwards, so its second parent is missing every code file main
    // gained in the meantime, which is exactly what `-m` used to report.
    git(repo, ['branch', 'docs-branch'])
    git(repo, ['checkout', '-q', '-b', 'feature'])
    commitFiles(repo, { 'scripts/feature.mjs': 'export const a = 1' }, 'feat: code')
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge pull request: feature', 'feature'])
    const dispatched = git(repo, ['rev-parse', 'HEAD']).trim()

    git(repo, ['checkout', '-q', 'docs-branch'])
    commitFiles(repo, { 'HANDOFF.d/2026-09-06T2213Z-note.md': '# note' }, 'docs: handover')
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge pull request: docs', 'docs-branch'])
    const tip = git(repo, ['rev-parse', 'HEAD']).trim()

    const verdict = classify(repo, dispatched, tip)
    assert.equal(verdict.ok, true, verdict.reason)
    assert.deepEqual(verdict.movedBy, ['HANDOFF.d/2026-09-06T2213Z-note.md'])
    assert.equal(sha.length, 40)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('POSITIVE CONTROL: a merge that lands code is still refused (#2465)', () => {
  const { repo, sha } = makeRepo()
  try {
    git(repo, ['checkout', '-q', '-b', 'code-branch'])
    commitFiles(repo, { 'scripts/landed.mjs': 'export const b = 2\n', 'AGENTS.md': 'rules\n' }, 'feat: code')
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge pull request: code', 'code-branch'])
    const tip = git(repo, ['rev-parse', 'HEAD']).trim()

    const verdict = classify(repo, sha, tip)
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /scripts\/landed\.mjs/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('POSITIVE CONTROL: a rename from code to documentation is still refused (#2465)', () => {
  const { repo, sha } = makeRepo()
  try {
    const base = commitFiles(repo, { 'scripts/moved.mjs': 'export const c = 3\n' }, 'feat: code')
    mkdirSync(join(repo, 'docs'), { recursive: true })
    git(repo, ['mv', 'scripts/moved.mjs', 'docs/moved.md'])
    git(repo, ['commit', '-q', '-m', 'chore: move'])
    const tip = git(repo, ['rev-parse', 'HEAD']).trim()

    const verdict = classify(repo, base, tip)
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /scripts\/moved\.mjs/)
    assert.equal(sha.length, 40)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
