// Trusted pure-prose fast CI route (issue #3383): the tests that must fail if
// the fast route is ever widened.
//
// The fast route skips engineering suites. Every test below asks the safety
// question first: what must NOT be able to skip them. A misclassification that
// grants the fast route to code, a migration, an executable agent instruction,
// a symlink, or a mode change is a silent loss of coverage, so those cases are
// asserted by name and cannot be deleted without failing here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyProseGitInventory, parseGitRawInventory, isDocumentPath, isRulebookPath } from './lib/documents-only-change.mjs'
import { classifyCiRouteFromGitRaw, main, readGitRawInventory } from './check-documents-ci-route.mjs'

const R = (status, srcMode, dstMode, srcPath, dstPath) => ({ status, srcMode, dstMode, srcPath, dstPath })

// ---------------------------------------------------------------------------
// parseGitRawInventory
// ---------------------------------------------------------------------------

test('a plain modify record parses to one inventory entry', () => {
  const raw = ':100644 100644 aaaa bbbb M\0docs/notes.md\0'
  assert.deepEqual(parseGitRawInventory(raw), [R('M', '100644', '100644', 'docs/notes.md', 'docs/notes.md')])
})

test('add, delete and rename records keep both sides', () => {
  assert.deepEqual(parseGitRawInventory(':000000 100644 0000 aaaa A\0docs/new.md\0'), [R('A', null, '100644', null, 'docs/new.md')])
  assert.deepEqual(parseGitRawInventory(':100644 000000 aaaa 0000 D\0docs/old.md\0'), [R('D', '100644', null, 'docs/old.md', null)])
  assert.deepEqual(parseGitRawInventory(':100644 100644 aaaa bbbb R100\0docs/a.md\0docs/b.md\0'), [R('R100', '100644', '100644', 'docs/a.md', 'docs/b.md')])
})

test('a truncated or unparsable inventory is null, never a partial pass', () => {
  assert.equal(parseGitRawInventory(''), null)
  assert.equal(parseGitRawInventory('not raw output'), null)
  assert.equal(parseGitRawInventory(':100644 100644 aaaa bbbb M\0docs/notes.md'), null, 'missing trailing NUL is unreadable')
  assert.equal(parseGitRawInventory(':100644 100644 aaaa bbbb R100\0docs/a.md\0'), null, 'rename missing its destination is unreadable')
  assert.equal(parseGitRawInventory(':100644 100644 aaaa bbbb Q\0docs/notes.md\0'), null, 'unknown status letter is unreadable')
  assert.equal(parseGitRawInventory(':1006 100644 aaaa bbbb M\0docs/notes.md\0'), null, 'short mode is unreadable')
})

// ---------------------------------------------------------------------------
// classifyProseGitInventory — the pure-prose grant
// ---------------------------------------------------------------------------

test('a complete prose-only inventory is pure prose', () => {
  const verdict = classifyProseGitInventory([
    R('M', '100644', '100644', 'docs/a.md', 'docs/a.md'),
    R('A', null, '100644', null, 'docs/b.txt'),
    R('D', '100644', null, 'docs/c.rst', null),
    R('R100', '100644', '100644', 'docs/d.md', 'docs/e.md'),
  ])
  assert.equal(verdict.pureProse, true, verdict.reason)
})

// ---------------------------------------------------------------------------
// NEGATIVE: file modes
// ---------------------------------------------------------------------------

test('a prose file made executable retains the full path', () => {
  const verdict = classifyProseGitInventory([R('M', '100644', '100755', 'docs/a.md', 'docs/a.md')])
  assert.equal(verdict.pureProse, false)
  assert.match(verdict.reason, /100755|executable|mode/)
})

test('a prose file that is already executable retains the full path', () => {
  const verdict = classifyProseGitInventory([R('M', '100755', '100755', 'docs/a.md', 'docs/a.md')])
  assert.equal(verdict.pureProse, false)
  assert.match(verdict.reason, /mode/)
})

test('a symlink whose name looks like prose retains the full path', () => {
  const verdict = classifyProseGitInventory([R('A', null, '120000', null, 'docs/a.md')])
  assert.equal(verdict.pureProse, false)
  assert.match(verdict.reason, /120000|mode/)
})

test('a submodule path retains the full path', () => {
  const verdict = classifyProseGitInventory([R('A', null, '160000', null, 'docs/a.md')])
  assert.equal(verdict.pureProse, false)
})

test('an unknown mode retains the full path', () => {
  const verdict = classifyProseGitInventory([R('M', '100644', '100664', 'docs/a.md', 'docs/a.md')])
  assert.equal(verdict.pureProse, false)
})

// ---------------------------------------------------------------------------
// NEGATIVE: renames
// ---------------------------------------------------------------------------

test('a rename out of a migration retains the full path', () => {
  const verdict = classifyProseGitInventory([R('R100', '100644', '100644', 'supabase/migrations/1_a.sql', 'docs/a.md')])
  assert.equal(verdict.pureProse, false)
  assert.match(verdict.reason, /non-prose|migration|sql/)
})

test('a rename out of a code file retains the full path', () => {
  const verdict = classifyProseGitInventory([R('R100', '100644', '100644', 'scripts/foo.mjs', 'docs/foo.md')])
  assert.equal(verdict.pureProse, false)
})

test('a rename of an instruction-bearing file retains the full path in either direction', () => {
  const toInstruction = classifyProseGitInventory([R('R100', '100644', '100644', 'docs/a.md', 'AGENTS.md')])
  assert.equal(toInstruction.pureProse, false)
  assert.match(toInstruction.reason, /instruction-bearing/)
  const fromInstruction = classifyProseGitInventory([R('R100', '100644', '100644', 'AGENTS.md', 'docs/a.md')])
  assert.equal(fromInstruction.pureProse, false)
  assert.match(fromInstruction.reason, /instruction-bearing/)
})

test('a rename between two prose documents is pure prose', () => {
  const verdict = classifyProseGitInventory([R('R100', '100644', '100644', 'docs/a.md', 'docs/b.md')])
  assert.equal(verdict.pureProse, true, verdict.reason)
})

// ---------------------------------------------------------------------------
// NEGATIVE: deletions
// ---------------------------------------------------------------------------

test('deleting a code file retains the full path', () => {
  const verdict = classifyProseGitInventory([R('D', '100644', null, 'scripts/foo.mjs', null)])
  assert.equal(verdict.pureProse, false)
  assert.match(verdict.reason, /non-prose/)
})

test('deleting a migration retains the full path', () => {
  const verdict = classifyProseGitInventory([R('D', '100644', null, 'supabase/migrations/20260101_x.sql', null)])
  assert.equal(verdict.pureProse, false)
})

test('deleting an instruction-bearing file retains the full path', () => {
  const verdict = classifyProseGitInventory([R('D', '100644', null, 'AGENTS.md', null)])
  assert.equal(verdict.pureProse, false)
  assert.match(verdict.reason, /instruction-bearing/)
})

test('deleting a prose document is pure prose', () => {
  const verdict = classifyProseGitInventory([R('D', '100644', null, 'docs/gone.md', null)])
  assert.equal(verdict.pureProse, true, verdict.reason)
})

// ---------------------------------------------------------------------------
// NEGATIVE: instruction-bearing files
// ---------------------------------------------------------------------------

for (const path of [
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/skills/shared-db-change/SKILL.md',
  'skills/claude/shared-db-orchestrator/SKILL.md',
  '.claude/agents/reviewer.md',
  '.claude/commands/wrap-up.md',
]) {
  test(`an instruction-bearing file retains the full path: ${path}`, () => {
    assert.equal(isRulebookPath(path), true)
    assert.equal(isDocumentPath(path), false)
    const verdict = classifyProseGitInventory([R('M', '100644', '100644', path, path)])
    assert.equal(verdict.pureProse, false)
    assert.match(verdict.reason, /instruction-bearing/)
  })
}

// ---------------------------------------------------------------------------
// NEGATIVE: non-prose paths
// ---------------------------------------------------------------------------

for (const path of [
  'scripts/check-sql.sh',
  'scripts/lib/documents-only-change.mjs',
  'scripts/production_catalog_verification.py',
  'tools/coldlion-recurring-promotion.test.mjs',
  'supabase/migrations/20260101_x.sql',
  '.github/workflows/tools-offline-tests.yml',
  'docs/notes.json',
  'package.json',
]) {
  test(`a non-prose file retains the full path: ${path}`, () => {
    const verdict = classifyProseGitInventory([R('M', '100644', '100644', path, path)])
    assert.equal(verdict.pureProse, false)
  })
}

// ---------------------------------------------------------------------------
// NEGATIVE: fail-closed shapes
// ---------------------------------------------------------------------------

test('an empty or unreadable inventory is never pure prose', () => {
  assert.equal(classifyProseGitInventory([]).pureProse, false)
  assert.equal(classifyProseGitInventory(null).pureProse, false)
  assert.equal(classifyProseGitInventory(undefined).pureProse, false)
  assert.equal(classifyProseGitInventory('nope').pureProse, false)
})

test('an unreadable record fails the whole inventory closed', () => {
  const verdict = classifyProseGitInventory([
    R('M', '100644', '100644', 'docs/ok.md', 'docs/ok.md'),
    null,
    R('M', '100644', '100644', 'docs/also.md', 'docs/also.md'),
  ])
  assert.equal(verdict.pureProse, false)
})

test('an unknown status letter fails closed', () => {
  assert.equal(classifyProseGitInventory([R('Q', '100644', '100644', 'docs/a.md', 'docs/a.md')]).pureProse, false)
  assert.equal(classifyProseGitInventory([R('X1', '100644', '100644', 'docs/a.md', 'docs/a.md')]).pureProse, false)
})

test('a record with no usable path fails closed', () => {
  assert.equal(classifyProseGitInventory([R('M', '100644', '100644', null, null)]).pureProse, false)
})

// ---------------------------------------------------------------------------
// classifyCiRouteFromGitRaw — parse + classify together
// ---------------------------------------------------------------------------

test('a raw inventory of only prose at 100644 takes the fast route', () => {
  const raw = ':100644 100644 aaaa bbbb M\0docs/a.md\0'
  assert.equal(classifyCiRouteFromGitRaw(raw).pureProse, true)
})

test('a raw inventory that does not parse takes the full path', () => {
  assert.equal(classifyCiRouteFromGitRaw('garbage').pureProse, false)
  assert.equal(classifyCiRouteFromGitRaw('').pureProse, false)
  assert.equal(classifyCiRouteFromGitRaw(undefined).pureProse, false)
})

test('a raw inventory mixing prose with code takes the full path', () => {
  const raw = ':100644 100644 aaaa bbbb M\0docs/a.md\0:100644 100644 cccc dddd M\0scripts/x.mjs\0'
  const verdict = classifyCiRouteFromGitRaw(raw)
  assert.equal(verdict.pureProse, false)
  assert.match(verdict.reason, /non-prose/)
})

// ---------------------------------------------------------------------------
// main() exit codes
// ---------------------------------------------------------------------------

test('main exits 2 on a bad invocation rather than guessing', () => {
  const sink = () => {}
  assert.equal(main([], { err: sink, out: sink }), 2)
  assert.equal(main(['only-one'], { err: sink, out: sink }), 2)
  assert.equal(main(['base', 'head', 'extra'], { err: sink, out: sink }), 2)
  assert.equal(main(['not a sha!', 'head'], { err: sink, out: sink }), 2)
})

test('main exits 1 (full path) when git itself refuses', () => {
  const out = []
  const code = main(['base', 'head'], {
    spawn: () => { throw new Error('bad revision') },
    err: () => {},
    out: (t) => out.push(t),
  })
  assert.equal(code, 1)
  assert.match(out.join(''), /full-ci-route/)
})

test('main exits 0 only for a proven pure-prose inventory', () => {
  const pure = ':100644 100644 aaaa bbbb M\0docs/a.md\0'
  assert.equal(main(['base', 'head'], { raw: pure, err: () => {}, out: () => {} }), 0)
  const dirty = ':100644 100755 aaaa bbbb M\0docs/a.md\0'
  assert.equal(main(['base', 'head'], { raw: dirty, err: () => {}, out: () => {} }), 1)
})

// ---------------------------------------------------------------------------
// Real git inventory — the shape CI will actually see
// ---------------------------------------------------------------------------

function run (cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function inventoryAt (cwd, base, head) {
  return readGitRawInventory(base, head, (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
}

function commitAll (cwd, message) {
  run(cwd, ['add', '-A'])
  run(cwd, ['commit', '-m', message, '--allow-empty'])
  return run(cwd, ['rev-parse', 'HEAD']).trim()
}

test('a real prose-only commit takes the fast route from a real git inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-fast-ci-'))
  try {
    run(dir, ['init', '-q', '-b', 'main'])
    run(dir, ['config', 'user.email', 'test@example.com'])
    run(dir, ['config', 'user.name', 'Test'])
    writeFileSync(join(dir, 'README.md'), '# base\n')
    const base = commitAll(dir, 'base')

    writeFileSync(join(dir, 'README.md'), '# base\n\nmore prose.\n')
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', 'notes.txt'), 'a note\n')
    const head = commitAll(dir, 'prose only')

    const raw = inventoryAt(dir, base, head)
    const verdict = classifyCiRouteFromGitRaw(raw)
    assert.equal(verdict.pureProse, true, verdict.reason)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a real executable-bit flip on a prose file takes the full path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-fast-ci-'))
  try {
    run(dir, ['init', '-q', '-b', 'main'])
    run(dir, ['config', 'user.email', 'test@example.com'])
    run(dir, ['config', 'user.name', 'Test'])
    writeFileSync(join(dir, 'README.md'), '# base\n')
    const base = commitAll(dir, 'base')

    run(dir, ['update-index', '--chmod=+x', 'README.md'])
    run(dir, ['commit', '-m', 'make readme executable'])
    const head = run(dir, ['rev-parse', 'HEAD']).trim()

    const verdict = classifyCiRouteFromGitRaw(inventoryAt(dir, base, head))
    assert.equal(verdict.pureProse, false)
    assert.match(verdict.reason, /mode/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a real code change and a real instruction change both take the full path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-fast-ci-'))
  try {
    run(dir, ['init', '-q', '-b', 'main'])
    run(dir, ['config', 'user.email', 'test@example.com'])
    run(dir, ['config', 'user.name', 'Test'])
    writeFileSync(join(dir, 'README.md'), '# base\n')
    const base = commitAll(dir, 'base')

    mkdirSync(join(dir, 'scripts'))
    writeFileSync(join(dir, 'scripts', 'x.mjs'), 'export const x = 1\n')
    const codeHead = commitAll(dir, 'add code')
    assert.equal(classifyCiRouteFromGitRaw(inventoryAt(dir, base, codeHead)).pureProse, false)

    writeFileSync(join(dir, 'AGENTS.md'), 'be careful\n')
    const instructionHead = commitAll(dir, 'add instruction')
    const instructionVerdict = classifyCiRouteFromGitRaw(inventoryAt(dir, codeHead, instructionHead))
    assert.equal(instructionVerdict.pureProse, false)
    assert.match(instructionVerdict.reason, /instruction-bearing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a real rename out of a migration takes the full path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-fast-ci-'))
  try {
    run(dir, ['init', '-q', '-b', 'main'])
    run(dir, ['config', 'user.email', 'test@example.com'])
    run(dir, ['config', 'user.name', 'Test'])
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true })
    writeFileSync(join(dir, 'supabase', 'migrations', '1_a.sql'), 'select 1;\n')
    const base = commitAll(dir, 'base')

    mkdirSync(join(dir, 'docs'), { recursive: true })
    run(dir, ['mv', 'supabase/migrations/1_a.sql', 'docs/a.md'])
    const head = commitAll(dir, 'rename migration to markdown')
    const verdict = classifyCiRouteFromGitRaw(inventoryAt(dir, base, head))
    assert.equal(verdict.pureProse, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a real symlink pointing at a prose name takes the full path', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-fast-ci-'))
  try {
    run(dir, ['init', '-q', '-b', 'main'])
    run(dir, ['config', 'user.email', 'test@example.com'])
    run(dir, ['config', 'user.name', 'Test'])
    writeFileSync(join(dir, 'README.md'), '# base\n')
    const base = commitAll(dir, 'base')

    try {
      symlinkSync('README.md', join(dir, 'docs.md'))
    } catch {
      t.skip('symlinks are not available on this machine')
      return
    }
    const head = commitAll(dir, 'add symlink')
    const verdict = classifyCiRouteFromGitRaw(inventoryAt(dir, base, head))
    assert.equal(verdict.pureProse, false)
    assert.match(verdict.reason, /mode/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
