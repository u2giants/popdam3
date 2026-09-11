// Where licensed row data may be written.
//
// The manifest and the before-state backup both carry licensed item identities.
// This repository is PUBLIC. Nothing previously stopped an operator from passing
// `--out .` and committing ~1,190 licensed rows to a public repository by
// accident, and no gate downstream would have caught it: the PII guard scans for
// email shapes, not item identities.
//
// So the destination is checked before anything is written. A directory inside a
// git working tree is refused unless git itself says the path is ignored, which
// is the only authority that actually decides whether a file can be committed.

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

// `git -C <dir> ...` fails with "cannot change to '<dir>': No such file or
// directory" when <dir> does not exist -- and a brand-new output directory is
// the NORMAL case here: every caller runs `mkdirSync(dir, { recursive: true
// })` right after this guard. Probing a missing path must never be read as
// "outside any git working tree" -- that silently allowed `--out ./out`,
// `--out docs/verification/1984-run`, or any other not-yet-existing path
// inside this checkout to bypass the guard entirely. Walk up to the nearest
// existing ancestor first so git is always asked about a real directory.
function nearestExistingAncestor(dir) {
  let current = dir;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current; // reached the filesystem root
    current = parent;
  }
  return current;
}

function gitTopLevel(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (err) {
    // "not a repository" is a real answer and returns null. A MISSING or
    // unrunnable git binary is not an answer at all: swallowing it turned the
    // guard into an allow-all on any machine without git on PATH.
    if (err && (err.code === 'ENOENT' || err.code === 'EACCES' || err.errno === -4058)) {
      throw new Error(
        'REFUSED: git could not be run, so it is impossible to prove the output '
        + 'directory is outside a git working tree; install git or choose an '
        + 'explicitly ignored destination',
      );
    }
    return null;
  }
}

function gitIgnores(top, dir) {
  try {
    // check-ignore matches against gitignore patterns, not the filesystem, so
    // it works correctly even when `dir` does not exist yet.
    execFileSync('git', ['-C', top, 'check-ignore', '-q', '--', dir], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch { return false; }
}

/**
 * Prove an output directory may hold licensed row data.
 *
 * @param {string} candidate operator-supplied path
 * @param {{topLevel?:Function, ignores?:Function, nearestExistingAncestor?:Function}} deps injected for tests
 * @returns {string} the resolved absolute directory
 */
export function assertPrivateOutputDir(candidate, deps = {}) {
  if (!candidate || typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('REFUSED: an output directory is required');
  }
  const dir = resolve(candidate);
  const probeFrom = (deps.nearestExistingAncestor ?? nearestExistingAncestor)(dir);
  // The classification lives here so an injected probe is judged the same way
  // the real one is: only "not a repository" may return null.
  let top;
  try {
    top = (deps.topLevel ?? gitTopLevel)(probeFrom);
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('REFUSED:')) throw err;
    throw new Error(
      'REFUSED: git could not be run, so it is impossible to prove the output '
      + 'directory is outside a git working tree; install git or choose an '
      + 'explicitly ignored destination',
    );
  }
  if (top === null) return dir; // outside any git working tree
  const ignored = (deps.ignores ?? gitIgnores)(top, dir);
  if (!ignored) {
    throw new Error(
      'REFUSED: licensed row data may not be written inside a git working tree '
      + 'unless git ignores the destination; write it to the private repository '
      + 'or to an ignored directory',
    );
  }
  return dir;
}
