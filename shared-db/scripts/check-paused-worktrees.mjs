#!/usr/bin/env node
/**
 * Report which git worktrees have deliberately PAUSED — issue #549, backlog B11.
 *
 * The accident this guards: a cleanup agent deleted the worktree of an agent that had paused
 * awaiting re-dispatch, while breaking no rule. The worktree was clean, unlocked and held no
 * unmerged work. A paused agent and a finished agent are byte-identical on disk, so the old
 * criteria could not possibly have told them apart.
 *
 * The convention (docs/worktree-pause-protocol.md): a pausing agent writes a `PAUSED` file in
 * its worktree root before it stops. This script finds them.
 *
 * READ ONLY. It never removes, locks or modifies a worktree, and never touches a database.
 *
 *   node scripts/check-paused-worktrees.mjs           list paused worktrees, always exit 0
 *   node scripts/check-paused-worktrees.mjs --guard   exit 1 if any worktree is paused
 *   node scripts/check-paused-worktrees.mjs --json    machine-readable output
 *
 * Absence of a PAUSED file is NOT permission to delete a worktree. See the doc.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_FIELDS = ['AGENT', 'RESUME-WHEN'];

export function parseWorktreeList(porcelain) {
  const worktrees = [];
  let current = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: null, detached: false };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'detached' && current) {
      current.detached = true;
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

export function parseMarker(text) {
  const fields = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim().toUpperCase()] = line.slice(idx + 1).trim();
  }
  return fields;
}

export function markerProblems(fields) {
  const problems = [];
  for (const key of REQUIRED_FIELDS) {
    if (!fields[key]) problems.push(`missing ${key}`);
  }
  // A resume condition must name a real event. This is deliberately a weak check: it catches the
  // empty and the obviously-hedged, and leaves judgement to the reader for everything else.
  const resume = fields['RESUME-WHEN'] ?? '';
  if (resume && resume.length < 12) problems.push('RESUME-WHEN is too vague to act on');
  return problems;
}

export function collectPaused(worktrees, { exists = existsSync, read = readFileSync } = {}) {
  const paused = [];
  for (const wt of worktrees) {
    const marker = path.join(wt.path, 'PAUSED');
    if (!exists(marker)) continue;
    let fields = {};
    let readError = null;
    try {
      fields = parseMarker(read(marker, 'utf8'));
    } catch (err) {
      readError = err.message;
    }
    paused.push({
      path: wt.path,
      branch: wt.branch ?? (wt.detached ? '(detached)' : null),
      fields,
      readError,
      problems: readError ? [`unreadable: ${readError}`] : markerProblems(fields),
    });
  }
  return paused;
}

function main(argv) {
  const guard = argv.includes('--guard');
  const asJson = argv.includes('--json');

  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  });
  const worktrees = parseWorktreeList(porcelain);
  const paused = collectPaused(worktrees);

  if (asJson) {
    console.log(JSON.stringify({ scanned: worktrees.length, paused }, null, 2));
  } else if (paused.length === 0) {
    console.log(`No PAUSED worktrees. Scanned ${worktrees.length}.`);
    console.log(
      'Absence of a marker is NOT permission to delete anything — see docs/worktree-pause-protocol.md.',
    );
  } else {
    console.log(`${paused.length} PAUSED worktree(s) of ${worktrees.length} scanned. DO NOT REMOVE THESE.\n`);
    for (const p of paused) {
      console.log(`  ${p.path}`);
      console.log(`    branch:      ${p.branch ?? '(none)'}`);
      console.log(`    agent:       ${p.fields.AGENT ?? '(unstated)'}`);
      console.log(`    issue:       ${p.fields.ISSUE ?? '(unstated)'}`);
      console.log(`    since:       ${p.fields.SINCE ?? '(unstated)'}`);
      console.log(`    resume when: ${p.fields['RESUME-WHEN'] ?? '(unstated)'}`);
      if (p.problems.length) console.log(`    ⚠️  marker problems: ${p.problems.join('; ')}`);
      console.log('');
    }
  }

  if (guard && paused.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-paused-worktrees.mjs')) {
  main(process.argv.slice(2));
}
