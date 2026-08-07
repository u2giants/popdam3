// Negative-path tests for the intake-pointer guard.
//
// Backlog B7 standard, which is standing policy in this repo: a test that only proves the
// guard EXISTS is worthless against the defect class it guards. Three separate defects on
// 2026-07-31 installed cleanly, compiled, passed review and did nothing. Every assertion
// here proves the guard REFUSES something.
//
//   node --test scripts/check-intake-pointer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SCRIPT = new URL('./check-intake-pointer.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Run the guard in a throwaway directory holding `content`, with POINTER_MODE forced on. */
function runGuard(content, { pointerMode = true, writeFile = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pointer-guard-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    let src = readFileSync(SCRIPT, 'utf8');
    if (pointerMode) src = src.replace('const POINTER_MODE = false;', 'const POINTER_MODE = true;');
    const copy = join(dir, 'scripts', 'check-intake-pointer.mjs');
    writeFileSync(copy, src, 'utf8');
    if (writeFile) writeFileSync(join(dir, 'COORDINATOR_INTAKE.md'), content, 'utf8');
    try {
      const stdout = execFileSync(process.execPath, [copy], { cwd: dir, encoding: 'utf8' });
      return { code: 0, out: stdout };
    } catch (err) {
      return { code: err.status ?? 1, out: (err.stdout ?? '') + (err.stderr ?? '') };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD_POINTER = `# COORDINATOR_INTAKE.md — retired

Work now lives in GitHub Issues:

    gh issue list --repo u2giants/shared-db --label db-work

An **empty** issue list is NOT proof there is no work. Also read
\`HANDOFF.md\` ## BACKLOG and the files in \`HANDOFF.d/\`.

The full history of this file is at commit abc1234.
`;

test('a valid pointer passes', () => {
  const r = runGuard(GOOD_POINTER);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /is a pointer/);
});

test('REFUSES a returning REQUEST QUEUE heading', () => {
  const r = runGuard(GOOD_POINTER + '\n## REQUEST QUEUE\n\n### REQUEST — something — 2026-08-09\n');
  assert.equal(r.code, 1, 'guard did not fail on a rebuilt queue section');
  assert.match(r.out, /REQUEST QUEUE/);
});

test('REFUSES a lower-cased section heading', () => {
  // The case-insensitivity matters: AGENTS.md refers to "the coordinator intake" in lower
  // case, and a case-sensitive gate would wave a lower-cased rebuild straight through.
  const r = runGuard(GOOD_POINTER + '\n## intake queue\n');
  assert.equal(r.code, 1, 'guard is case-sensitive and missed a lower-cased rebuild');
});

test('REFUSES a heading dressed up with punctuation and emoji', () => {
  const r = runGuard(GOOD_POINTER + '\n## ⚠️ **In Progress** — live work\n');
  assert.equal(r.code, 1, 'guard was defeated by decoration around the heading');
});

test('REFUSES a file that has grown past pointer length', () => {
  const r = runGuard(GOOD_POINTER + '\nfiller\n'.repeat(60));
  assert.equal(r.code, 1, 'guard did not fail on a file that grew a body');
  assert.match(r.out, /lines/);
});

test('REFUSES a pointer that has lost the "empty is not idle" warning', () => {
  const stripped = '# COORDINATOR_INTAKE.md — retired\n\nWork lives in GitHub Issues now.\n';
  const r = runGuard(stripped);
  assert.equal(r.code, 1, 'guard allowed the warning to be dropped');
  assert.match(r.out, /empty/i);
});

test('REFUSES a missing file rather than passing vacuously', () => {
  const r = runGuard('', { writeFile: false });
  assert.equal(r.code, 1, 'guard passed when the file did not exist');
  assert.match(r.out, /does not exist/);
});

test('is dormant, and says so, while pointer mode is off', () => {
  const r = runGuard('anything at all\n', { pointerMode: false });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /dormant/);
});
