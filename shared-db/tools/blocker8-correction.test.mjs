/**
 * Offline drift guard for the blocker-8 correction (issue #518).
 *
 * NO DATABASE. This reads committed markdown and nothing else.
 *
 * Why this exists. Blocker 8 was mis-stated for months and the wrong wording
 * was copied forward from document to document, because nothing ever failed
 * when it was. The correction now lives in ONE place -- §2.1 of the cutover
 * plan -- and these tests are what stop it being copied wrong again, deleted,
 * or quietly outgrown by a new document repeating the original error.
 *
 * Precedent: the previous "recommended forward correction" in that section
 * pointed at COORDINATOR_INTAKE.md, which was retired on 2026-08-07. The
 * instruction sat there dead until #518. A stale pointer that nothing checks
 * is the exact failure mode.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = path.join(REPO, "docs", "licensor-property-cloudsql-cutover-plan-20260806.md");

/** The real writer. Blocker 8's whole correction is this citation. */
const REAL_WRITER = "designflow-backend/routes/admin.router.js:87";
/** The READ endpoint the handover wrongly cited as the writer. */
const READ_ENDPOINT = "item_library.service.js";
/**
 * No file carries the original wrong claim any more. The last one --
 * HANDOFF.d/2026-08-03T2359Z-t16-coordinator-licensor-property-priority.md --
 * was retired whole (not edited) on 2026-08-13 in the HANDOFF.d cleanup once
 * its work was proven done. See §2.1. Do NOT add entries here to make a
 * failure go away: a new offender means someone copied the wrong wording
 * forward, and the new file is what must be fixed.
 */
const KNOWN_STALE = [];

function plan() {
  return readFileSync(PLAN, "utf8");
}

/** Every tracked markdown file, minus node_modules. */
function allMarkdown(dir = REPO, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) allMarkdown(full, out);
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

test("the cutover plan names the REAL writer endpoint", () => {
  assert.ok(
    plan().includes(REAL_WRITER),
    `the correction of record must cite ${REAL_WRITER}`,
  );
});

test("the correction section §2.1 still exists and states the defect", () => {
  const text = plan();
  assert.match(text, /###\s*2\.1\s+Where the wrong wording still survives/);
  assert.match(text, /type-blind/i, "the real defect is type-blindness");
  assert.match(text, /\*\*READ\*\* endpoint/, "it must say the cited endpoint is a READ endpoint");
});

test("the correction says the endpoint fix is NOT shared-db work", () => {
  // The single most expensive way to get #518 wrong is for a shared-db session
  // to try to fix the endpoint. It lives in the popcre org, in another repo.
  const text = plan();
  assert.match(text, /NOT shared-db work/);
  assert.match(text, /designflow-backend/);
});

test("the dead COORDINATOR_INTAKE.md instruction has not come back", () => {
  // COORDINATOR_INTAKE.md was retired 2026-08-07 and no longer holds the
  // blocker-8 text. Any instruction to correct it there is unactionable.
  const section = plan().split("### 2.1")[1] ?? "";
  assert.doesNotMatch(
    section,
    /stale-sweep agent that owns `COORDINATOR_INTAKE\.md`/,
    "that forward-correction instruction is dead; do not restore it",
  );
});

test("no file still carries the original mis-statement", () => {
  // If this fails, someone copied the wrong wording forward again -- fix the
  // new file, do not extend KNOWN_STALE.
  const offenders = [];
  for (const file of allMarkdown()) {
    const rel = path.relative(REPO, file).split(path.sep).join("/");
    if (rel === "docs/licensor-property-cloudsql-cutover-plan-20260806.md") continue;
    const text = readFileSync(file, "utf8");
    // The wrong claim is the READ endpoint being named as the unvalidated
    // 5-role WRITE path. Both halves must be present on the same line.
    const bad = text
      .split("\n")
      .some((line) => line.includes(READ_ENDPOINT) && /open to 5 roles/i.test(line));
    if (bad) offenders.push(rel);
  }
  assert.deepEqual(offenders, KNOWN_STALE);
});
