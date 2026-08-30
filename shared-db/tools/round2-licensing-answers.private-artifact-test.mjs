// Issue #562 — the round-2 licensing answer record must not drift from the
// roll-up it claims to represent, and must not quietly grow answers that are
// not recoverable from a committed source.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DIR = path.join(
  import.meta.dirname, '..', 'docs', 'verification', 'character-identity-rules-20260728',
);
const CSV = path.join(DIR, 'round2-licensing-answers.csv');
const MD = path.join(DIR, 'round2-licensing-answers.md');

function parseCsv(text) {
  const records = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const head = records.shift();
  return records.filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const rows = parseCsv(fs.readFileSync(CSV, 'utf8')).map((r) => ({
  ref: r.ref, answer: r.answer, disposition: r.disposition, on: r.answered_on,
}));

test('the record holds exactly the 21 rows whose ref and answer are both provable', () => {
  assert.equal(rows.length, 21);
});

test('all 11 block-C rows are present and every one is NONE', () => {
  const c = rows.filter((r) => r.ref.startsWith('C'));
  assert.equal(c.length, 11);
  assert.deepEqual([...new Set(c.map((r) => r.answer))], ['NONE']);
  assert.deepEqual(
    c.map((r) => r.ref).sort(),
    ['C004', 'C006', 'C016', 'C017', 'C018', 'C019', 'C020', 'C021', 'C022', 'C023', 'C033'],
    'the eleven refs must be exactly the ASK_C set built by build-licensing-questions-round2.py',
  );
});

test('all 9 blanks are present, and a blank is recorded as blank, never guessed', () => {
  const blanks = rows.filter((r) => r.answer === '');
  assert.equal(blanks.length, 9);
  assert.deepEqual(
    blanks.map((r) => r.ref).sort(),
    ['A005', 'B038', 'B039', 'B040', 'B041', 'B042', 'B043', 'B044', 'B045'],
    'nine blanks: A005, B038, and the seven generator-defect rows B039-B045. '
    + 'B007 is NOT a blank - it answered REAL CHARACTERS and left only the (now dead) '
    + 'names cell empty, which is why the 154 block-B rows are 126 + 20 + 8.',
  );
  for (const b of blanks) assert.match(b.disposition, /^BLANK_/);
});

test('the seven generator-defect blanks are attributed to the generator, not the reviewer', () => {
  const defect = rows.filter((r) => r.disposition === 'BLANK_MALFORMED_QUESTION').map((r) => r.ref);
  assert.deepEqual(defect.sort(), ['B039', 'B040', 'B041', 'B042', 'B043', 'B044', 'B045']);
});

test('every row is dated to the round-2 return, not to the day it was written down', () => {
  assert.deepEqual([...new Set(rows.map((r) => r.on))], ['2026-08-04']);
});

test('NO SILENT COMPLETION: the other 145 answered block-B rows are absent on purpose', () => {
  const answeredB = rows.filter((r) => r.ref.startsWith('B') && r.answer !== '').map((r) => r.ref);
  assert.deepEqual(answeredB, ['B007'],
    'B007 is the ONLY block-B answer recoverable from a committed source; '
    + 'the other 145 are not in this repository and must not be invented');
  assert.match(fs.readFileSync(MD, 'utf8'), /Do not "complete" the CSV/);
});

test('the reviewer is not named -- this repository is PUBLIC (ruling 6.14)', () => {
  // Parity with tools/round3-licensing-answers.test.mjs. Round 3 had this guard;
  // round 2 did not, and the round-2 change re-introduced the reviewer's first
  // name into two source comments that the round-3 guard does not cover.
  // Guard the evidence record AND the tools that describe round 2, so a future
  // edit cannot put an incidental personal identifier back into a public file.
  const TOOLS = path.join(import.meta.dirname);
  const guarded = [
    CSV,
    MD,
    path.join(TOOLS, 'build-licensing-questions-csv.mjs'),
    path.join(TOOLS, 'resolve-character-identity.mjs'),
    path.join(TOOLS, 'round2-licensing-answers.test.mjs'),
  ];
  // Two committed artifact FILENAMES carry the reviewer's first name. Both were
  // added before ruling 6.14 (2026-07-29 and 2026-07-31 vs 2026-08-09), so they
  // are accepted historical exposure and renaming them needs a fresh owner
  // ruling -- 6.14 forbids starting a cleanup pass without one. Referring to
  // them by their real path is therefore allowed; naming the person is not.
  // The name is assembled, never written literally, so that this guard file is
  // itself covered by the guard instead of tripping over its own pattern.
  const NAME = ['Lau', 'ra'].join('');
  const HISTORICAL_FILENAMES =
    new RegExp(`licensing-questions-for-${NAME}(?:-round2)?-\\d{8}\\.(?:csv|xlsx)`, 'gi');
  const NAMED = new RegExp(`\\b${NAME}\\b`, 'i');
  for (const file of guarded) {
    const prose = fs.readFileSync(file, 'utf8').replace(HISTORICAL_FILENAMES, '<historical-file>');
    assert.doesNotMatch(
      prose,
      NAMED,
      `${path.basename(file)} must not name the reviewer; say "the licensing company reviewer"`,
    );
  }
  // The attribution that IS allowed stays generic: a role, never a person.
  assert.match(fs.readFileSync(MD, 'utf8'), /\bthe reviewer\b/i);
});

test('the record states that the licensing question stream is closed', () => {
  assert.match(fs.readFileSync(MD, 'utf8'), /THE LICENSING QUESTION STREAM IS CLOSED/);
  assert.match(fs.readFileSync(MD, 'utf8'), /There is no round 4/);
});
