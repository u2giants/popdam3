// Shared parser for COORDINATOR_INTAKE.md.
//
// Used by the queue-to-Issues migration (plan_coordinator-queue-to-github-issues.md):
// step 1 (inventory + arithmetic completeness check) and step 2 (publication scrub).
// It is deliberately dumb: it splits on headings and reports what it sees. It makes
// no judgement about whether a block is open, noise, or safe to publish.
//
// Node >= 20. Plain ESM, no dependencies, no build step.

import { readFile } from 'node:fs/promises';

export const DEFAULT_INTAKE_PATH = 'COORDINATOR_INTAKE.md';

// The `##` sections whose `###` blocks are candidates for migration.
export const MIGRATING_SECTIONS = ['REQUEST QUEUE', 'IN PROGRESS', 'WAITING ON OTHER PEOPLE', 'INTAKE QUEUE'];

/**
 * Split the intake file into `##` sections and `###` blocks.
 *
 * Fenced code blocks are tracked so that a `### ` line *inside* a fence is not
 * mistaken for a heading — the file's own templates contain exactly that.
 *
 * @returns {{sections: Array<{title: string, line: number, blocks: Block[]}>, blocks: Block[], totalLines: number}}
 */
export function parseIntake(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  const blocks = [];
  let section = null;
  let block = null;
  let inFence = false;

  const closeBlock = (endLine) => {
    if (!block) return;
    block.endLine = endLine;
    block.body = lines.slice(block.line - 1, endLine).join('\n');
    block = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (line.startsWith('## ')) {
      closeBlock(lineNo - 1);
      section = { title: line.slice(3).trim(), line: lineNo, blocks: [] };
      sections.push(section);
      continue;
    }

    if (line.startsWith('### ')) {
      closeBlock(lineNo - 1);
      block = {
        heading: line.slice(4).trim(),
        line: lineNo,
        endLine: null,
        section: section ? section.title : '(preamble)',
        sectionLine: section ? section.line : 0,
        kind: classifyKind(line.slice(4).trim()),
        body: '',
      };
      if (section) section.blocks.push(block);
      blocks.push(block);
    }
  }
  closeBlock(lines.length);

  return { sections, blocks, totalLines: lines.length };
}

/** Heading-shape classification only. Says nothing about whether the block is open. */
export function classifyKind(heading) {
  const h = heading.toUpperCase();
  if (h.startsWith('CLOSING NOTE')) return 'CLOSING NOTE';
  if (h.includes('SUPPLEMENT')) return 'SUPPLEMENT';
  if (h.startsWith('TAKEN OVER')) return 'TAKEN OVER';
  if (h.startsWith('INTAKE —') || h.startsWith('INTAKE -')) return 'INTAKE';
  if (h.startsWith('⛔ QUESTION') || h.includes('QUESTION TO RESOLVE')) return 'QUESTION';
  if (h.startsWith('REQUEST') || h.includes('— REQUEST —')) return 'REQUEST';
  if (h.startsWith('⛔')) return 'OWNER DECISION';
  return 'OTHER';
}

/** Section-title match that tolerates the trailing prose the file appends to some `##` lines. */
export function sectionMatches(title, wanted) {
  return title === wanted || title.startsWith(wanted + ' ');
}

/** Blocks belonging to the sections this migration draws from. */
export function migratingBlocks(parsed, wantedSections = MIGRATING_SECTIONS) {
  return parsed.blocks.filter((b) => wantedSections.some((w) => sectionMatches(b.section, w)));
}

/** Trailing `— YYYY-MM-DD —` style date in a heading, if any. */
export function headingDate(heading) {
  const m = heading.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Backlog `B<n>` references anywhere in the block body. */
export function backlogRefs(body) {
  const refs = new Set();
  for (const m of body.matchAll(/\bB(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 14) refs.add(`B${n}`);
  }
  return [...refs].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export async function loadIntake(path = DEFAULT_INTAKE_PATH) {
  return parseIntake(await readFile(path, 'utf8'));
}
