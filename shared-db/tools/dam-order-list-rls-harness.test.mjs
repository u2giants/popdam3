/**
 * Offline shape guard for the PopDAM OrderList contract test (issue #655).
 *
 * NO DATABASE. This parses supabase/tests/dam_order_list_contract.sql as text.
 *
 * The defect it guards. The two saved-view RLS isolation checks used to be bare
 * `select case when ... then 'PASS ...' else 'FAIL ...' end` statements sitting
 * OUTSIDE any do block. psql prints a row either way, so a genuine leak between
 * users printed the word FAIL and the script still exited 0. A green run proved
 * only that two queries had run -- which is precisely nothing, for an RLS test.
 *
 * Why a text test rather than a database test. The contract file needs a live
 * preview database and cannot run in CI. That is exactly why the defect survived
 * review: nothing mechanical ever looked at it. These assertions are about the
 * SHAPE of the harness, which is a property of the text, so they can run on
 * every PR and will fail the moment the exit-0 shape comes back.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(REPO, "supabase", "tests", "dam_order_list_contract.sql");

/**
 * Read with line endings normalised to LF.
 *
 * This repo is worked on from Windows checkouts, so the file arrives with CRLF.
 * JavaScript's `.` does not match `\r`, so `/--.*$/` silently fails to strip a
 * comment on a CRLF line -- which made the comment DESCRIBING the #655 defect
 * register as the defect. Normalising here rather than per-regex keeps that
 * trap out of every assertion below.
 */
const sql = () => readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");

/**
 * Split the file into `do $$ ... $$;` blocks and everything else.
 * Returns the lines that are NOT inside a do block, with 1-based line numbers,
 * comments stripped.
 */
function linesOutsideDoBlocks() {
  const out = [];
  let inBlock = false;
  sql()
    .split("\n")
    .forEach((raw, i) => {
      const line = raw.replace(/--.*$/, "");
      if (!inBlock && /\bdo\s*\$\$/.test(line)) {
        inBlock = true;
        return;
      }
      if (inBlock) {
        if (/\$\$\s*;/.test(line)) inBlock = false;
        return;
      }
      out.push({ n: i + 1, text: line });
    });
  assert.equal(inBlock, false, "unterminated do $$ block -- the file does not parse");
  return out;
}

test("no assertion outside a do block can print FAIL and still exit 0", () => {
  // The core of #655. Any `FAIL` string produced by a plain statement is a
  // result row, not an error: psql exits 0 and CI, or a human, reads it as a
  // pass. Every assertion must live inside a block that raises.
  const offenders = linesOutsideDoBlocks().filter((l) => /'[^']*FAIL/i.test(l.text));
  assert.deepEqual(
    offenders.map((l) => `line ${l.n}: ${l.text.trim()}`),
    [],
    "these assertions print FAIL without failing the run -- move them into a raising do block",
  );
});

/**
 * `assert.match` prints the whole 30 KB file as `actual` when it fails, which
 * buries the message. Assert on a boolean and say what was missing instead.
 */
function assertContains(pattern, why) {
  assert.ok(pattern.test(sql()), `${why} -- expected to find ${pattern} in ${path.basename(FILE)}`);
}

test("a PART 3 block exists, is role-scoped, and raises on failure", () => {
  assertContains(/PART 3/, "the saved-view RLS isolation part must exist");
  assertContains(/raise exception 'PART 3 FAILED/, "PART 3 must raise, not print");
  assertContains(/set local role authenticated/, "the checks must run as authenticated");
});

test("both users are checked, and each asserts zero foreign rows, not just a count of one", () => {
  // A count of 1 alone is satisfiable by the wrong row. `user_id <> <self>`
  // being zero is the assertion that actually means "isolated".
  assertContains(/leaked to user A/, "user A's isolation must be checked");
  assertContains(/leaked to user B/, "user B's isolation must be checked");
  const foreignRowChecks = sql().match(/where user_id <> v_user_[ab]/g) ?? [];
  assert.equal(foreignRowChecks.length, 2, "each user needs its own foreign-row check");
});

test("every role switch is switched back", () => {
  const text = sql().replace(/--.*$/gm, "");
  const sets = text.match(/set local role authenticated/g) ?? [];
  const resets = text.match(/reset role/g) ?? [];
  assert.ok(sets.length > 0, "expected at least one role switch");
  assert.equal(
    resets.length,
    sets.length,
    "a role switch left un-reset leaks the authenticated role into later assertions",
  );
});

test("a run that skips PART 3 cannot read as clean", () => {
  // Deleting the block must not quietly shrink coverage back to the #655 state.
  assertContains(/PART 3 did not run/, "the PART-3-ran guard must exist");
});

test("the file still ends in rollback and never commits", () => {
  // Preview carries a production data clone. This is unchanged by #655 and is
  // asserted here because PART 3 was added inside that transaction.
  const text = sql().replace(/--.*$/gm, "");
  assert.match(text, /\brollback\s*;\s*$/, "the file must end in rollback");
  assert.doesNotMatch(text, /^\s*commit\s*;/im, "this file must never commit");
});
