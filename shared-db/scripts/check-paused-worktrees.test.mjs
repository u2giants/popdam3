// Tests for the paused-worktree detector (#549).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWorktreeList,
  parseMarker,
  markerProblems,
  collectPaused,
} from './check-paused-worktrees.mjs';

test('parseWorktreeList reads branches and detached heads', () => {
  const out = [
    'worktree C:/repos/shared-db',
    'HEAD abc',
    'branch refs/heads/main',
    '',
    'worktree C:/repos/shared-db/.claude/worktrees/x',
    'HEAD def',
    'detached',
    '',
  ].join('\n');
  const wts = parseWorktreeList(out);
  assert.equal(wts.length, 2);
  assert.equal(wts[0].branch, 'main');
  assert.equal(wts[1].detached, true);
  assert.equal(wts[1].branch, null);
});

test('parseMarker is case-insensitive on keys and ignores comments and blanks', () => {
  const fields = parseMarker('# note\nagent: hygiene\n\nRESUME-WHEN: PR #751 merges\n');
  assert.equal(fields.AGENT, 'hygiene');
  assert.equal(fields['RESUME-WHEN'], 'PR #751 merges');
});

test('parseMarker keeps colons inside a value', () => {
  const fields = parseMarker('SINCE: 2026-08-11T14:30Z');
  assert.equal(fields.SINCE, '2026-08-11T14:30Z');
});

test('markerProblems demands an agent and a real resume condition', () => {
  assert.deepEqual(markerProblems({ AGENT: 'a', 'RESUME-WHEN': 'PR #751 merges to main' }), []);
  assert.deepEqual(markerProblems({ 'RESUME-WHEN': 'PR #751 merges to main' }), ['missing AGENT']);
  assert.deepEqual(markerProblems({ AGENT: 'a' }), ['missing RESUME-WHEN']);
  assert.deepEqual(markerProblems({ AGENT: 'a', 'RESUME-WHEN': 'later' }), [
    'RESUME-WHEN is too vague to act on',
  ]);
});

test('collectPaused returns only worktrees carrying a marker', () => {
  const wts = [
    { path: '/a', branch: 'one', detached: false },
    { path: '/b', branch: 'two', detached: false },
  ];
  const paused = collectPaused(wts, {
    exists: (p) => p.replace(/\\/g, '/') === '/b/PAUSED',
    read: () => 'AGENT: b-agent\nISSUE: 549\nRESUME-WHEN: batch B2 lands in production\n',
  });
  assert.equal(paused.length, 1);
  assert.equal(paused[0].path, '/b');
  assert.equal(paused[0].fields.AGENT, 'b-agent');
  assert.deepEqual(paused[0].problems, []);
});

test('collectPaused surfaces an unreadable marker instead of skipping the worktree', () => {
  const paused = collectPaused([{ path: '/a', branch: 'one', detached: false }], {
    exists: () => true,
    read: () => {
      throw new Error('EACCES');
    },
  });
  assert.equal(paused.length, 1);
  assert.match(paused[0].problems[0], /unreadable: EACCES/);
});

test('a clean, unlocked, fully merged worktree is still protected if it is marked', () => {
  // This is the exact case of the #549 accident: nothing about the worktree's git state
  // distinguished it. Only the marker does.
  const paused = collectPaused([{ path: '/clean', branch: 'done', detached: false }], {
    exists: () => true,
    read: () => 'AGENT: paused-agent\nRESUME-WHEN: the orchestrator re-dispatches issue #601\n',
  });
  assert.equal(paused.length, 1);
  assert.deepEqual(paused[0].problems, []);
});
