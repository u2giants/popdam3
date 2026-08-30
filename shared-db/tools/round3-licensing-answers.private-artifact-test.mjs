/**
 * Offline contract tests for the round-3 licensing answer evidence file
 * (issue #526 item (a)).
 *
 * NO DATABASE. This reads two committed files and nothing else.
 *
 * Why this exists. The evidence file's whole job is to outlive the prose
 * document it was extracted from. A CSV nothing reads is a CSV nothing
 * protects, so these tests are the only thing standing between it and silent
 * drift -- and, more importantly, between a PUBLIC repository and the four
 * things #526 said to leave out.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "docs", "verification", "character-identity-rules-20260728");
const CSV = path.join(DIR, "round3-licensing-answers.csv");
const NOTE = path.join(DIR, "round3-licensing-answers.md");

const EXPECTED_HEADER = "ref,answer,disposition,answered_by,answered_on,source";

/**
 * The eight refs and answers exactly as recorded in
 * `fix_characters_style_guides.md` ("Licensing round 3 -- RETURNED").
 * Duplicated here on purpose: a test that derives its expectation from the file
 * under test proves nothing.
 */
const EXPECTED = [
  ["A005", "CC", "CODE_CONFIRMATION"],
  ["B039", "IT IS JUST A LOGO OR TITLE", "DROP"],
  ["B040", "IT IS JUST A LOGO OR TITLE", "DROP"],
  ["B041", "IT IS JUST A LOGO OR TITLE", "DROP"],
  ["B042", "IT SHOWS THE CHARACTERS", "KEEP"],
  ["B043", "IT SHOWS THE CHARACTERS", "KEEP"],
  ["B044", "IT SHOWS THE CHARACTERS", "KEEP"],
  ["B045", "IT SHOWS THE CHARACTERS", "KEEP"],
];

/** Minimal RFC4180 split -- enough for this file, and it fails loudly otherwise. */
function parseCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  if (quoted) {
    throw new Error(`unterminated quoted field in CSV line: ${line}`);
  }
  out.push(field);
  return out;
}

/**
 * Read with line endings normalised to LF.
 *
 * Git checks this file out with CRLF on the Windows machines this repo is
 * worked on from. Without normalising, every field parsed off the end of a line
 * carries a trailing `\r` and compares unequal to the expected value -- which
 * is a test failing for a reason that has nothing to do with the evidence.
 */
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function rows() {
  const text = read(CSV);
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return { header: lines[0], body: lines.slice(1).map(parseCsvLine) };
}

test("the CSV header is the agreed shape", () => {
  assert.equal(rows().header, EXPECTED_HEADER);
});

test("exactly the eight round-3 refs are recorded, in order, with their answers", () => {
  const body = rows().body;
  assert.equal(body.length, 8, "round 3 was 8 rows; there is no round 4");
  assert.deepEqual(
    body.map((r) => [r[0], r[1], r[2]]),
    EXPECTED,
  );
});

test("the roll-up matches the one recorded in the narrative: 3 DROP, 4 KEEP, 1 code", () => {
  const counts = {};
  for (const r of rows().body) {
    counts[r[2]] = (counts[r[2]] ?? 0) + 1;
  }
  assert.deepEqual(counts, { DROP: 3, KEEP: 4, CODE_CONFIRMATION: 1 });
});

test("every row is attributed and dated to the 2026-08-06 return", () => {
  for (const r of rows().body) {
    assert.equal(r[4], "2026-08-06", `ref ${r[0]} must carry the return date`);
    assert.notEqual(r[3].trim(), "", `ref ${r[0]} must name who answered`);
    assert.notEqual(r[5].trim(), "", `ref ${r[0]} must cite its source cell`);
  }
});

test("no blanks and no use of the NONE OF THESE FIT escape", () => {
  // The round-3 design's success criterion. If a future edit introduces either,
  // the "8 of 8, zero blanks, zero escapes" claim in the narrative is false.
  for (const r of rows().body) {
    assert.notEqual(r[1].trim(), "", `ref ${r[0]} answer must not be blank`);
    assert.doesNotMatch(r[1], /NONE OF THESE FIT/i, `ref ${r[0]}`);
  }
});

test("the reviewer is not named -- this repository is PUBLIC", () => {
  // #526: do not copy the third party's name. The repository's own publication
  // scrub (docs/verification/intake-publication-scrub-20260807.md) redacted it.
  const text = read(CSV);
  assert.doesNotMatch(text, /\bLaura\b/i, "the reviewer's name must not appear in the evidence file");
  for (const r of rows().body) {
    assert.equal(r[3], "licensing company reviewer", `ref ${r[0]} attribution must stay generic`);
  }
});

test("no free-text notes and no POP item number leaked into the answers", () => {
  // #526: extract `ref -> answer` ONLY. The A005 note cited a real internal POP
  // item number as evidence, and that is the single highest-value thing to keep
  // out. Any bare 4+ digit run in an answer is treated as a leak: none of the
  // eight legitimate answers contains a digit at all.
  for (const r of rows().body) {
    assert.doesNotMatch(
      r[1],
      /\d{4,}/,
      `ref ${r[0]}: a long number in an answer looks like a leaked item identifier`,
    );
    assert.ok(
      r[1].length <= 40,
      `ref ${r[0]}: answers are fixed dropdown options; a long value means free-text notes leaked in`,
    );
  }
});

test("the workbook itself is still not committed", () => {
  // The round-3 workbook is deliberately held out of band. Round 1 and round 2
  // artifacts that were already committed stay as they are, so this checks only
  // for a NEW round-3 workbook appearing beside the evidence file.
  const stray = readdirSync(DIR).filter((f) => /round.?3/i.test(f) && /\.(xlsx|xls|xlsm)$/i.test(f));
  assert.deepEqual(stray, [], "the round-3 workbook must not be committed to this public repo");
});

test("the companion note records that #526 item (b), the validator run, is still NOT done", () => {
  // The whole point of #526(b) is that it is a standing compliance step that was
  // skipped. If someone edits the note to drop that admission without running
  // the validator, the outstanding step becomes invisible again.
  const note = read(NOTE);
  assert.match(note, /validate-licensing-answers\.mjs/);
  assert.match(note, /NOT\s+done/i);
  assert.match(note, /matches codes \*\*globally\*\*|globally/i);
});
