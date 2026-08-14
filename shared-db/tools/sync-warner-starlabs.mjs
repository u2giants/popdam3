#!/usr/bin/env node
/**
 * Warner Bros. STARLABS extract loader.
 *
 * ============================================================================
 * THIS FILE CONTAINS NO WARNER DATA, AND MUST NEVER CONTAIN ANY.
 * ============================================================================
 * `u2giants/shared-db` is a PUBLIC repository. The STARLABS extract is
 * business-confidential Warner Bros. data held under a commercial licensing
 * relationship, and it lives in the PRIVATE repository:
 *
 *     u2giants/licensor-source-data  ->  warner-bros/
 *
 *     SCHEMA IN GIT. DATA OUT OF GIT.
 *
 * This runner reads the extract out of a local checkout of the PRIVATE repo at
 * runtime, streams it to the guarded database functions in bounded chunks, and
 * writes nothing back into this repo. It never prints a source row, and its
 * error messages report COUNTS, never values.
 *
 * Database side (every guard is re-evaluated there; this runner is deliberately
 * NOT the only line of defence):
 *     plm.begin_wb_capture(...)                     20260810130000
 *     plm.load_wb_chunk(uuid, integer, text, text)  20260810130000
 *     plm.finalize_wb_capture(uuid, text, numeric)  20260810130000
 *     plm.fail_wb_capture(uuid, text)               20260810130000
 * which assemble the stream and hand the COMPLETE snapshot to the eight shipped
 * loaders plm.sync_wb_<entity>(jsonb, text, numeric) from 20260810030000.
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *   WB_SOURCE_REPO=/path/to/licensor-source-data \
 *   WB_PINNED_COMMIT=<the 40-hex commit the counts were verified against> \
 *   WB_SOURCE_URL=https://<portal-origin>          # ORIGIN ONLY \
 *   WB_CAPTURED_AT=2026-08-07                      # the SNAPSHOT date \
 *   WB_CAPTURED_BY='<operator>' \
 *   WB_EXPECTED_PROJECT_REF=<the project ref you MEANT to write> \
 *   DATABASE_URL=postgres://... \
 *   node tools/sync-warner-starlabs.mjs --apply
 *
 * Without --apply it is a DRY RUN: it verifies the checkout, reads and parses
 * every file, hashes every chunk, prints counts, and contacts no database.
 *
 * ============================================================================
 * REFUSAL 1 -- THE WORKING TREE MUST BE CLEAN AND HEAD MUST BE THE PINNED COMMIT
 * ============================================================================
 * This loader NEVER READS THE FILESYSTEM for source data. Every CSV is read with
 *
 *     git show <pinned-commit>:warner-bros/<file>
 *
 * and the run aborts unless `git status --porcelain` is EMPTY and `git rev-parse
 * HEAD` equals the pinned commit.
 *
 * This is not fussiness. The database's G8 guard asserts exact row totals that
 * were verified against ONE commit, so a file read from a dirty tree is a file
 * whose counts nobody verified. Reading through `git show` at a pinned object
 * makes "which bytes did we load" answerable months later; reading the working
 * directory makes it unanswerable.
 *
 * The clean-tree check is separate from, and not made redundant by, reading at
 * the pinned commit: a dirty tree means the operator has uncommitted intent in
 * that checkout, and silently ignoring it is how a scrape gets loaded that the
 * operator believed they had changed.
 *
 * ============================================================================
 * REFUSAL 2 -- THE PROJECT REF MUST BE STATED AND MUST MATCH
 * ============================================================================
 * Every database guard runs INSIDE whichever project you reached, so no database
 * guard can tell you that you reached the WRONG project. One mistyped variable
 * would load the whole confidential extract into the wrong Supabase project.
 * Printing the ref is not a gate -- nobody may be watching. So the intended ref
 * is a REQUIRED, EXPLICIT input, it is compared against the ref parsed out of
 * DATABASE_URL, and a mismatch ABORTS BEFORE THE FIRST BYTE IS SENT.
 * Do not "simplify" this into a warning.
 *
 * ============================================================================
 * WHY THE FILE LIST IS HARD-CODED AND THERE IS NO readdir ANYWHERE
 * ============================================================================
 * THIS IS THE MOST IMPORTANT LINE IN THIS FILE. The eight capture files are
 * named literally in CAPTURE_FILES below. This loader does not call readdir, it
 * does not glob, and it must never be changed to.
 *
 * The failure this prevents is real and was observed in a live checkout of the
 * private repo: `links-property-character.csv` had a STAGED DELETION. A
 * directory listing of that checkout simply does not contain the file, so a
 * glob-driven loader loads ZERO of those 4,158 property-to-character links --
 * the single most valuable relationship in the whole extract, and the only one
 * Warner states directly -- and reports complete success. Nothing is missing
 * from its point of view, because it never knew the file was supposed to exist.
 *
 * A hard-coded list turns that silent zero into a loud ENOENT. That is the whole
 * design: the set of files is a FACT ABOUT THE CAPTURE, not an observation of a
 * directory, so it is written down here and asserted, never discovered.
 *
 * (Refusal 1 independently rejects that same checkout for being dirty. Both
 * guards are kept. A guard that is only correct because another guard fired
 * first is not a guard.)
 *
 * NEVER hard-code a project ref, a URL, a password or a key in this file.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

/** A Supabase project ref: 20 lowercase letters/digits. No ref is hard-coded here. */
const PROJECT_REF = /^[a-z0-9]{20}$/;
/** A full git object name. Short SHAs are refused: they are ambiguous by design. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The eight capture files, by name, and the plm.wb_* mirror each one feeds.
 *
 * READ THE readdir NOTE IN THE HEADER BEFORE TOUCHING THIS.
 *
 * Order matters only for readability; each target is loaded as its own
 * independent capture, so a failure in one does not half-load another.
 *
 * ============================================================================
 * WHY EACH ENTRY CARRIES A requiredHeaders LIST
 * ============================================================================
 * `csvToObjects` keys every row by whatever row 0 says, and those keys are
 * passed to the database UNCHANGED. Before 2026-08-11 nothing checked row 0 at
 * all: the only shape check in the whole loader was `if (!rows.length)`. A file
 * whose columns had been RENAMED, DROPPED, DUPLICATED or swapped for another
 * file's columns therefore parsed happily into objects with the wrong keys.
 *
 * Truncation was already covered (the database asserts exact row totals, and an
 * LFS pointer fails on row count), but COLUMN IDENTITY was not covered by
 * anything, at any layer, until the row reached the database -- where the G6
 * required-field check would report "N rows malformed", which reads as bad DATA
 * rather than as a wrong-SHAPED file. That is a diagnosability failure on a
 * loader whose stated contract is "never a silent partial".
 *
 * The lists below are NOT invented here. Each one is exactly the set of keys
 * the matching `plm.sync_wb_*` loader's G6 block requires to be non-blank, in
 * `supabase/migrations/20260810030000_warner_starlabs_source_landing.sql`. If a
 * migration ever changes a loader's required fields, change the list here in
 * the same pull request -- the two are one contract expressed twice, and
 * `sync-warner-starlabs.test.mjs` asserts every entry has a non-empty list.
 */
export const CAPTURE_FILES = Object.freeze([
  { file: "franchises-normalized.csv", target: "wb_franchise", requiredHeaders: Object.freeze(["source_namespace", "label", "identity_method", "source_url"]) },
  { file: "properties-normalized.csv", target: "wb_property", requiredHeaders: Object.freeze(["source_namespace", "label", "identity_method", "source_url"]) },
  { file: "characters-normalized.csv", target: "wb_character_normalized", requiredHeaders: Object.freeze(["source_namespace", "label", "identity_method", "source_url"]) },
  { file: "style-guides-normalized.csv", target: "wb_style_guide_normalized", requiredHeaders: Object.freeze(["source_namespace", "label", "identity_method", "source_url"]) },
  { file: "assets-normalized.csv", target: "wb_asset_normalized", requiredHeaders: Object.freeze(["source_namespace", "source_id", "file_name", "source_path", "source_url"]) },
  { file: "links-asset-franchise-normalized.csv", target: "wb_asset_franchise", requiredHeaders: Object.freeze(["asset_namespace", "asset_source_id", "franchise_namespace", "source_url"]) },
  { file: "links-asset-property-normalized.csv", target: "wb_asset_property", requiredHeaders: Object.freeze(["asset_namespace", "asset_source_id", "property_namespace", "source_url"]) },
  { file: "links-asset-character-normalized.csv", target: "wb_asset_character_normalized", requiredHeaders: Object.freeze(["asset_namespace", "asset_source_id", "character_namespace", "source_url"]) },
  { file: "links-asset-style-guide-normalized.csv", target: "wb_asset_style_guide_normalized", requiredHeaders: Object.freeze(["asset_namespace", "asset_source_id", "style_guide_namespace", "source_url"]) },
  { file: "links-property-character-normalized.csv", target: "wb_property_character_normalized", requiredHeaders: Object.freeze(["property_namespace", "character_namespace", "property_label", "character_label", "source_url"]) },
  { file: "links-franchise-property-evidence.csv", target: "wb_franchise_property_evidence", requiredHeaders: Object.freeze(["franchise_namespace", "property_namespace", "evidence_source", "source_url"]), allowEmpty: true },
]);

/** The required-header list for one capture file, or null if the file is unknown. */
export function requiredHeadersFor(file) {
  const entry = CAPTURE_FILES.find((c) => c.file === file);
  return entry ? entry.requiredHeaders : null;
}

const NULLABLE_ASSET_FIELDS = Object.freeze([
  "warner_asset_id",
  "season",
  "file_size_bytes",
]);

/** Convert only exact empty optional Asset values to JSON null before hashing. */
export function normalizeCaptureRows(target, rows) {
  if (target !== "wb_asset_normalized") return rows;
  return rows.map((row) => {
    const normalized = { ...row };
    for (const field of NULLABLE_ASSET_FIELDS) {
      if (normalized[field] === "") normalized[field] = null;
    }
    return normalized;
  });
}

/**
 * REFUSAL 0. Prove the file's COLUMN IDENTITY before a single row is built.
 *
 * Three conditions are hard refusals, because each one silently produces rows
 * with the wrong keys:
 *
 *   - a BLANK header name    -> every value in that column lands under the key ""
 *   - a DUPLICATED header    -> the later column wins and the earlier is lost
 *   - a MISSING required one -> the database sees the field as absent, which its
 *                               G6 check reports as malformed DATA, not as a
 *                               wrong-shaped FILE
 *
 * Column ORDER is deliberately NOT checked: rows are keyed by name, so a
 * reordered file is genuinely equivalent. An UNKNOWN extra column is likewise
 * not a refusal -- the loaders keep the whole row in `raw`, so a new column
 * added upstream is additive and blocking it would strand a valid capture --
 * but it IS reported on stderr, because a column appearing without anyone
 * deciding to add it is exactly the drift this repo keeps rediscovering late.
 *
 * Header NAMES are structural metadata, not licensed Warner data, so unlike row
 * values they are safe to print. No row value is ever echoed.
 *
 * @param {string} file  one of CAPTURE_FILES[].file
 * @param {string[]} header  row 0, verbatim
 * @param {(msg: string) => void} [warn]  injected for tests
 */
export function assertCaptureHeaders(file, header, warn = (m) => console.error(m)) {
  const required = requiredHeadersFor(file);
  if (!required) {
    throw new Error(
      `REFUSING TO LOAD. ${file} is not one of the normalized capture files. The file list is a ` +
        "fact about the capture, not an observation of a directory."
    );
  }
  const cols = (header ?? []).map((h) => String(h).replace(/^﻿/, "").trim());

  const blanks = cols.reduce((n, h) => (h === "" ? n + 1 : n), 0);
  if (blanks > 0) {
    throw new Error(
      `REFUSING TO LOAD. warner-bros/${file} has ${blanks} blank column name(s) in its header ` +
        "row. Every value in a blank-named column would be keyed by the empty string and " +
        "silently discarded by the loader."
    );
  }

  const seen = new Set();
  const dupes = [];
  for (const h of cols) {
    if (seen.has(h)) dupes.push(h);
    seen.add(h);
  }
  if (dupes.length) {
    throw new Error(
      `REFUSING TO LOAD. warner-bros/${file} has duplicated column name(s) ` +
        `[${[...new Set(dupes)].join(", ")}]. Only the LAST column of a duplicated pair ` +
        "survives into the row object, so the earlier one is lost with no error."
    );
  }

  const missing = required.filter((h) => !seen.has(h));
  if (missing.length) {
    throw new Error(
      `REFUSING TO LOAD. warner-bros/${file} is missing required column(s) ` +
        `[${missing.join(", ")}]. Expected at least [${required.join(", ")}]; the header row ` +
        `reads [${cols.join(", ")}]. A renamed or reordered-away column loads as rows with ` +
        "the WRONG KEYS, which the database reports as malformed data rather than as a " +
        "wrong-shaped file."
    );
  }

  const unknown = cols.filter((h) => !required.includes(h));
  if (unknown.length) {
    warn(
      `NOTE: warner-bros/${file} carries column(s) not in this loader's required set ` +
        `[${unknown.join(", ")}]. These are kept verbatim in the row's raw payload and are ` +
        "not an error, but a column that appeared without anyone deciding to add it is drift."
    );
  }

  return { columns: cols, unknown };
}

/**
 * Rows per chunk.
 *
 * MEASURED, NOT GUESSED, and the measurement corrected the premise this loader
 * was commissioned under. Against preview rjyboqwcdzcocqgmsyel on 2026-08-10:
 *
 *   Postgres wire, one jsonb bind through the transaction pooler:
 *     1 MB 99ms | 16 MB 541ms | 32 MB 1.1s | 64 MB 3.4s | 96 MB 16.3s | 128 MB 24.3s
 *   PostgREST HTTP POST, service_role:
 *     0.5 MB through 64 MB all accepted; no 413 was ever produced.
 *
 * There is therefore NO hard body limit to size chunks against -- a single 62 MB
 * request goes through on both transports. What degrades, sharply and
 * superlinearly, is TIME above roughly 32 MB.
 *
 * So the chunk size is chosen for transaction hygiene rather than for a limit:
 * 25,000 rows, and additionally a soft byte budget, whichever binds first.
 * 25,000 rows of the widest file (assets.csv) is ~10 MB, comfortably inside the
 * flat part of the curve, and makes the largest file six chunks -- small enough
 * that a failed chunk is cheap to retry, large enough that the per-call overhead
 * is irrelevant.
 *
 * The database enforces the 25,000 ceiling independently in plm.load_wb_chunk.
 * Raising it here alone will simply be refused there.
 */
export const MAX_CHUNK_ROWS = 25000;
/** Soft byte budget per chunk, from the flat part of the measured curve. */
export const MAX_CHUNK_BYTES = 12 * 1024 * 1024;

/**
 * Decode as STRICT UTF-8.
 *
 * Node's default "utf8" decoding is lenient: an invalid byte becomes U+FFFD
 * silently. A property or character name would land corrupted, pass every later
 * check, and be indistinguishable from correct data. Silent repair of licensor
 * data is how a wrong name reaches a licensing decision.
 */
export function decodeUtf8Strict(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(
      "Source file is not valid UTF-8. Node's default decoding would have silently " +
        "replaced the bad bytes with U+FFFD and corrupted a name without any error. " +
        "Re-export the file as UTF-8; do not load it."
    );
  }
}

/** RFC4180-ish CSV parser: quotes, doubled quotes, embedded commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * Header row + data rows -> array of objects keyed by header name.
 *
 * The keys are passed through to the database UNCHANGED and UNRENAMED. The
 * shipped loaders read the CSV header names directly, so renaming a key here
 * would produce a row that fails the loader's G6 required-field check -- which
 * is the correct outcome, and the reason no renaming is attempted.
 */
export function csvToObjects(text) {
  return rowsToObjects(parseCsv(text));
}

/** The keying half of `csvToObjects`, split out so the header can be checked first. */
export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] ?? ""; });
    return o;
  });
}

export function sha256(input) {
  return createHash("sha256").update(input, typeof input === "string" ? "utf8" : undefined).digest("hex");
}

/**
 * Resolve and VERIFY the database target.
 * Returns the ref on success; throws BEFORE any connection on mismatch.
 */
export function resolveTarget({ databaseUrl, expectedRef }) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!expectedRef) {
    throw new Error(
      "WB_EXPECTED_PROJECT_REF is required. The database cannot tell you that you " +
        "reached the wrong project, so the intended ref must be stated explicitly and " +
        "matched before the first byte is sent."
    );
  }
  if (!PROJECT_REF.test(expectedRef)) {
    throw new Error(
      `WB_EXPECTED_PROJECT_REF ${JSON.stringify(expectedRef)} is not a 20-character project ref.`
    );
  }
  // Supabase connection strings carry the ref either as the user (postgres.<ref>)
  // or as the host label (db.<ref>.supabase.co / <ref>.pooler...).
  const found = new Set();
  for (const m of databaseUrl.matchAll(/[.@/]([a-z0-9]{20})[.:@/]/g)) found.add(m[1]);
  for (const m of databaseUrl.matchAll(/postgres\.([a-z0-9]{20})/g)) found.add(m[1]);
  if (!found.size) {
    throw new Error(
      "Could not find a project ref in DATABASE_URL. Refusing to connect: an unverifiable " +
        "target is exactly the case this check exists for."
    );
  }
  if (!found.has(expectedRef)) {
    throw new Error(
      `REFUSING TO CONNECT. DATABASE_URL points at project ref(s) [${[...found].join(", ")}] ` +
        `but WB_EXPECTED_PROJECT_REF is ${expectedRef}. Nothing has been sent.`
    );
  }
  return expectedRef;
}

/**
 * Run git in the private checkout. Buffer is generous: assets.csv is ~62 MB.
 *
 * GIT_NO_REPLACE_OBJECTS=1 is not decoration. `git show` and `git cat-file`
 * both HONOUR `refs/replace/*`, and a replace ref is invisible to every check
 * this loader makes: neither `git rev-parse HEAD` nor `git status --porcelain`
 * reveals one. So a replaced object would let the pinned commit resolve to
 * different content while every refusal in this file still reported "clean
 * checkout, pinned commit". The threat model is narrow (it needs write access
 * to the private capture repo), but the cost of closing it is one env var and
 * the failure it prevents is the one this loader exists to prevent.
 */
async function git(repoDir, args, { encoding = "utf8" } = {}) {
  const { stdout } = await execFileAsync("git", ["-C", repoDir, ...args], {
    encoding: encoding === "buffer" ? "buffer" : "utf8",
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
  });
  return stdout;
}

/**
 * REFUSAL 1. Prove the checkout is clean and sitting on the pinned commit.
 * Throws before anything is read.
 */
export async function assertPinnedCleanCheckout(repoDir, pinnedCommit, runGit = git) {
  if (!FULL_SHA.test(pinnedCommit)) {
    throw new Error(
      `WB_PINNED_COMMIT ${JSON.stringify(pinnedCommit)} is not a full 40-character commit ` +
        "SHA. A short SHA is ambiguous, and the whole point of pinning is that it is not."
    );
  }

  const status = (await runGit(repoDir, ["status", "--porcelain"])).trim();
  if (status !== "") {
    const n = status.split("\n").length;
    throw new Error(
      `REFUSING TO LOAD. The private source checkout at ${repoDir} has ${n} uncommitted ` +
        "change(s); `git status --porcelain` must be EMPTY. The pinned row totals the " +
        "database asserts were verified against one commit, and a checkout with " +
        "uncommitted intent is not that commit. Paths are NOT printed: they are " +
        "confidential source filenames. Commit, stash or clean the checkout, or clone a " +
        "fresh one at the pinned commit."
    );
  }

  const head = (await runGit(repoDir, ["rev-parse", "HEAD"])).trim();
  if (head !== pinnedCommit) {
    throw new Error(
      `REFUSING TO LOAD. HEAD of ${repoDir} is ${head} but WB_PINNED_COMMIT is ` +
        `${pinnedCommit}. The database asserts exact row totals verified against the ` +
        "pinned commit; loading a different commit under that commit's name would " +
        "certify counts nobody checked."
    );
  }

  return head;
}

/**
 * Read ONE capture file out of the pinned commit. Never touches the filesystem
 * copy: `git show <commit>:<path>` reads the committed object.
 */
export async function readPinnedCsv(repoDir, pinnedCommit, file, runGit = git, warn) {
  const oid = await resolvePinnedBlob(repoDir, pinnedCommit, file, runGit);

  let raw;
  try {
    raw = await runGit(repoDir, ["cat-file", "blob", oid], { encoding: "buffer" });
  } catch (err) {
    throw new Error(
      `REFUSING TO LOAD. warner-bros/${file} resolved to object ${oid} at pinned commit ` +
        `${pinnedCommit} but that object could not be read. The eight capture files are a ` +
        "fact about the capture, not an observation of a directory, so this is a hard " +
        `failure and never a silent zero. Underlying error: ${String(err.message).split("\n")[0]}`
    );
  }

  const rows = parseCsv(decodeUtf8Strict(raw));
  assertCaptureHeaders(file, rows[0] ?? [], warn ?? ((m) => console.error(m)));
  return rowsToObjects(rows);
}

/**
 * Resolve one capture path at the pinned commit to a REGULAR FILE blob, or refuse.
 *
 * WHY THIS IS NOT `git show <commit>:<path>` ANY MORE. `git show` renders
 * whatever the path points at, and three of those renderings parse as CSV
 * rather than failing:
 *
 *   - mode 120000 (symlink) prints the LINK TARGET TEXT -- one short line, which
 *     `parseCsv` happily returns as a header row
 *   - a TREE prints a directory listing
 *   - mode 160000 (gitlink / submodule) prints a commit rendering
 *
 * Any of those could reach the database as rows. `git ls-tree` is the only way
 * to see the MODE, so the mode is checked first and the content is then read by
 * object id with `git cat-file blob`, which cannot re-resolve to anything else.
 *
 * The clean-status and pinned-HEAD refusals are NOT load-bearing here: content
 * comes from the committed tree regardless of what the worktree looks like.
 */
export async function resolvePinnedBlob(repoDir, pinnedCommit, file, runGit = git) {
  const path = `warner-bros/${file}`;
  let listing;
  try {
    listing = await runGit(repoDir, ["ls-tree", "-z", pinnedCommit, "--", path]);
  } catch (err) {
    throw new Error(
      `REFUSING TO LOAD. warner-bros/${file} could not be looked up in pinned commit ` +
        `${pinnedCommit}. Underlying error: ${String(err.message).split("\n")[0]}`
    );
  }

  const entries = String(listing).split("\0").filter((e) => e !== "");
  if (entries.length !== 1) {
    throw new Error(
      `REFUSING TO LOAD. warner-bros/${file} resolves to ${entries.length} tree entries at ` +
        `pinned commit ${pinnedCommit}; exactly 1 is required. The eight capture files are a ` +
        "fact about the capture, not an observation of a directory, so a missing one is a " +
        "hard failure and never a silent zero."
    );
  }

  const m = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t/.exec(entries[0]);
  if (!m) {
    throw new Error(
      `REFUSING TO LOAD. the tree entry for warner-bros/${file} at ${pinnedCommit} could not ` +
        "be parsed. Refusing rather than guessing its type."
    );
  }
  const [, mode, type, oid] = m;
  if (type !== "blob" || mode !== "100644") {
    throw new Error(
      `REFUSING TO LOAD. warner-bros/${file} is mode ${mode} (${type}) at pinned commit ` +
        `${pinnedCommit}; only a regular-file blob (100644) may be loaded. A symlink renders ` +
        "as its target text, a tree as a directory listing and a gitlink as a commit -- each " +
        "of which can parse as CSV and reach the database as rows."
    );
  }
  return oid;
}

/**
 * Split rows into chunks bounded by BOTH the row ceiling and the byte budget,
 * and hash each chunk over the EXACT bytes that will be sent.
 *
 * The digest is taken of the serialized JSON TEXT, and the database recomputes
 * it from the text it receives -- see the long note on plm.load_wb_chunk. Do not
 * "improve" this by hashing the row array before serialization: the two sides
 * would then be hashing different things and the check would compare nothing.
 */
export function buildChunks(rows, { maxRows = MAX_CHUNK_ROWS, maxBytes = MAX_CHUNK_BYTES } = {}) {
  if (maxRows < 1 || maxRows > MAX_CHUNK_ROWS) {
    throw new Error(`Chunk row bound must be between 1 and ${MAX_CHUNK_ROWS}; got ${maxRows}.`);
  }
  const chunks = [];
  let batch = [];
  let bytes = 2; // the enclosing []

  const flush = () => {
    if (!batch.length) return;
    const json = JSON.stringify(batch);
    chunks.push({
      chunkNumber: chunks.length + 1,
      rowCount: batch.length,
      json,
      sha256: sha256(json),
    });
    batch = [];
    bytes = 2;
  };

  for (const row of rows) {
    // Buffer.byteLength, NOT .length: `.length` counts UTF-16 code units, so a
    // non-ASCII licensor or character name UNDERCOUNTS against a byte budget.
    const size = Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
    if (batch.length >= maxRows || (batch.length && bytes + size > maxBytes)) flush();
    batch.push(row);
    bytes += size;
  }
  flush();
  return chunks;
}

/**
 * The manifest digest for a whole stream: sha256 over the newline-joined,
 * chunk-ordered per-chunk digests. Each of those was verified server-side
 * against the bytes actually received, so the chain is a verified statement
 * about the whole stream rather than a declaration about it.
 */
export function chainDigest(chunks) {
  return sha256(chunks.map((c) => c.sha256).join("\n"));
}

/** Required-input validation. Runs BEFORE any file read or connection. */
export function resolveRunConfig(env) {
  const need = (k, why) => {
    const v = (env[k] ?? "").trim();
    if (!v) throw new Error(`${k} is required. ${why}`);
    return v;
  };

  const capturedAt = need(
    "WB_CAPTURED_AT",
    "It is the SNAPSHOT date (YYYY-MM-DD) and is never derived from the clock: the " +
      "database server runs America/New_York, so a UTC-midnight value read through " +
      "::date lands on the previous day and would silently misdate the capture."
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)) {
    throw new Error(`WB_CAPTURED_AT must be YYYY-MM-DD; got ${JSON.stringify(capturedAt)}.`);
  }

  const sourceUrl = need("WB_SOURCE_URL", "Every capture must carry its own provenance.");
  if (/[?#]/.test(sourceUrl)) {
    throw new Error(
      "WB_SOURCE_URL must be an ORIGIN only. It carries a query string or fragment, which " +
        "is how a session token or a signed portal URL ends up stored in the database."
    );
  }

  return {
    repoDir: resolvePath(
      need("WB_SOURCE_REPO", "Point it at the root of the PRIVATE licensor-source-data checkout.")
    ),
    pinnedCommit: need(
      "WB_PINNED_COMMIT",
      "The full 40-character commit the database's pinned row totals were verified against."
    ),
    capturedAt,
    sourceUrl,
    capturedBy: need("WB_CAPTURED_BY", "Who ran the capture."),
    expectedRef: (env.WB_EXPECTED_PROJECT_REF ?? "").trim(),
    databaseUrl: env.DATABASE_URL ?? "",
    maxShrinkFraction: env.WB_MAX_SHRINK_FRACTION ?? null,
    notes: env.WB_NOTES ?? null,
  };
}

/**
 * Read every capture file at the pinned commit and prepare its chunks.
 * Nothing is sent, and no database is contacted.
 */
export async function prepareCaptures(cfg, deps = {}) {
  const runGit = deps.git ?? git;
  await assertPinnedCleanCheckout(cfg.repoDir, cfg.pinnedCommit, runGit);

  const captures = [];
  for (const { file, target, allowEmpty = false } of CAPTURE_FILES) {
    const rows = normalizeCaptureRows(
      target,
      await readPinnedCsv(cfg.repoDir, cfg.pinnedCommit, file, runGit)
    );
    if (!rows.length && !allowEmpty) {
      throw new Error(
        `REFUSING TO LOAD. warner-bros/${file} parsed to ZERO rows at the pinned commit. ` +
          "An empty capture file is a failed extract, never an empty population."
      );
    }
    const chunks = buildChunks(rows);
    captures.push({
      file,
      target,
      rowCount: rows.length,
      chunks,
      manifestSha256: chainDigest(chunks),
      skipLoad: rows.length === 0 && allowEmpty,
    });
  }
  return captures;
}

/** Counts only. NEVER a row. Safe to print and safe to paste into a report. */
export function summarise(captures) {
  return captures.map((c) => ({
    file: c.file,
    target: c.target,
    rows: c.rowCount,
    chunks: c.chunks.length,
    bytes: c.chunks.reduce((n, ch) => n + ch.json.length, 0),
  }));
}

/**
 * Stream ONE capture: begin, load every chunk, finalize.
 * On any error the capture is marked FAILED (which also clears its payloads)
 * and the original error is re-thrown.
 */
export async function loadCapture(client, cfg, capture, log = console.log) {
  let captureId = null;
  try {
    const begun = await client.query(
      "select plm.begin_wb_capture($1,$2::date,$3,$4,$5,$6,$7,$8) as id",
      [
        capture.target,
        cfg.capturedAt,
        cfg.pinnedCommit,
        capture.manifestSha256,
        capture.rowCount,
        cfg.capturedBy,
        cfg.sourceUrl,
        cfg.notes,
      ]
    );
    captureId = begun.rows[0].id;
    log(`  ${capture.target}: capture ${captureId}, ${capture.chunks.length} chunk(s)`);

    for (const ch of capture.chunks) {
      const r = await client.query("select plm.load_wb_chunk($1,$2,$3,$4) as n", [
        captureId,
        ch.chunkNumber,
        ch.json,
        ch.sha256,
      ]);
      const n = Number(r.rows[0].n);
      // Validate the response, do not assume it. A chunk that reports fewer rows
      // than it was given has silently dropped something.
      if (n !== ch.rowCount) {
        throw new Error(
          `${capture.target} chunk ${ch.chunkNumber}: sent ${ch.rowCount} rows, database reported ${n}.`
        );
      }
    }

    const args = [captureId, capture.manifestSha256];
    let sql = "select * from plm.finalize_wb_capture($1,$2)";
    if (cfg.maxShrinkFraction !== null && cfg.maxShrinkFraction !== undefined) {
      sql = "select * from plm.finalize_wb_capture($1,$2,$3::numeric)";
      args.push(cfg.maxShrinkFraction);
    }
    const report = await client.query(sql, args);
    const row = report.rows[0];
    log(
      `  ${capture.target}: COMPLETE -- seen ${row.rows_seen}, landed ${row.rows_landed} ` +
        `(new ${row.rows_inserted}, updated ${row.rows_updated}, unchanged ${row.rows_unchanged}, ` +
        `collapsed ${row.rows_collapsed}), held-not-in-snapshot ${row.rows_missing}`
    );
    return { captureId, report: row };
  } catch (err) {
    if (captureId) {
      try {
        await client.query("select plm.fail_wb_capture($1,$2)", [
          captureId,
          String(err.message).slice(0, 500),
        ]);
        log(`  ${capture.target}: capture ${captureId} marked FAILED and its payloads cleared.`);
      } catch {
        /* the original error matters more than this one */
      }
    }
    throw err;
  }
}

/** Load prepared streams while recording truthful optional zero-row streams as skipped. */
export async function loadPreparedCaptures(client, cfg, captures, log = console.log, load = loadCapture) {
  const results = [];
  for (const capture of captures) {
    const truthfulOptionalEmpty =
      capture.file === "links-franchise-property-evidence.csv" &&
      capture.target === "wb_franchise_property_evidence" &&
      capture.rowCount === 0 &&
      Array.isArray(capture.chunks) &&
      capture.chunks.length === 0 &&
      capture.manifestSha256 === chainDigest([]);
    if (capture.skipLoad && !truthfulOptionalEmpty) {
      throw new Error(
        "REFUSING TO SKIP. Only the verified zero-row Franchise-to-Property evidence stream is optional."
      );
    }
    if (capture.rowCount === 0 && !truthfulOptionalEmpty) {
      throw new Error("REFUSING TO LOAD. An unverified zero-row capture reached the load boundary.");
    }
    if (truthfulOptionalEmpty) {
      log(`  ${capture.target}: SKIPPED -- optional source stream declared 0 rows; no database call made.`);
      results.push({ target: capture.target, skipped: true, rows: 0 });
      continue;
    }
    results.push(await load(client, cfg, capture, log));
  }
  return results;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const cfg = resolveRunConfig(process.env);

  // Everything verifiable is verified BEFORE any connection is opened.
  const captures = await prepareCaptures(cfg);

  console.log("Warner Bros. STARLABS extract");
  console.log("  private source repo  :", cfg.repoDir);
  console.log("  pinned commit        :", cfg.pinnedCommit, "(clean tree, HEAD verified)");
  console.log("  snapshot captured_at :", cfg.capturedAt);
  console.log("  per-target plan      :", JSON.stringify(summarise(captures), null, 2));

  if (!apply) {
    console.log("\nDRY RUN. No database was contacted. Re-run with --apply to load.");
    return;
  }

  const ref = resolveTarget({ databaseUrl: cfg.databaseUrl, expectedRef: cfg.expectedRef });
  console.log("  target project ref   :", ref, "(verified against DATABASE_URL)");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: cfg.databaseUrl });
  await client.connect();
  try {
    await loadPreparedCaptures(client, cfg, captures);
    console.log("  ALL ELEVEN CAPTURES COMPLETE.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  });
}
