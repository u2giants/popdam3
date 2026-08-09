#!/usr/bin/env node
// Validate a returned licensing answer sheet BEFORE accepting any of it.
//
// WHY THIS EXISTS. Licensing round 1 (2026-07-29) came back 194 of 195 answered and looked
// finished. Only 29 answers were usable. The failures were invisible without checking each
// answer against the live canonical data:
//
//   * 154 rows answered a DIFFERENT QUESTION  - MG06 property codes where the sheet asked
//     whether a row names real characters (our sheet's fault: it asked for names in a
//     code-shaped column);
//   * 8 rows gave TWO codes where axis 1 permits exactly one;
//   * 3 codes (EX, LB, JL) do not exist in core.property at all and would create dangling
//     property_id links;
//   * 1 answer was outside the offered options; 1 was blank.
//
// NEVER accept a returned sheet on its answered-count alone. Run this first.
// See fix_characters_style_guides.md -> "Licensing round 1" for the full post-mortem.
//
// Usage (preview; pg is not a repo dependency - run from a scratch dir that has it):
//   PREVIEW_URL=postgres://... node tools/validate-licensing-answers.mjs answers.json
//
// `answers.json` is an array of objects carrying at least: ref, options, YOUR_ANSWER.
// Convert a returned .xlsx with pandas/openpyxl first; this tool deliberately does not
// parse spreadsheets, so it stays usable whatever format the sheet comes back in.
//
// Exit code 0 = every answer usable. Exit code 1 = at least one problem found.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

const NON_CODE = /^(none|drop|not characters.*|real characters.*)$/i;
const CODE = /^[A-Z0-9]{1,4}$/i;

// A property code is unique per (licensor_id, code), NOT globally
// (core.property is `unique nulls not distinct (licensor_id, code)`). So a code
// is only usable for a sheet row if it exists under THAT ROW'S licensor. Compare
// licensor labels on their letters and digits alone, so "Warner Bros" from the
// sheet matches "Warner Bros." in core.licensor.
export const normLicensor = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function inspectAnswers(rows) {
  const blank = [];
  const multi = [];
  const offList = [];
  const codes = new Set();
  const pairs = [];

  for (const r of rows) {
    const ref = r.ref ?? "(no ref)";
    const licensor = String(r.licensor ?? "").trim();
    const answer = String(r.YOUR_ANSWER ?? "").trim();
    if (!answer) {
      blank.push(ref);
      continue;
    }
    if (NON_CODE.test(answer)) continue;

    const tokens = answer.split(/[,;/\s]+/).filter((t) => CODE.test(t));
    if (tokens.length > 1) multi.push(`${ref}: ${answer}`);
    tokens.forEach((t) => {
      codes.add(t.toUpperCase());
      pairs.push({ ref, code: t.toUpperCase(), licensor });
    });

    const options = String(r.options ?? "")
      .split("/")
      .map((o) => o.trim().toUpperCase())
      .filter(Boolean);
    if (options.length && tokens.length === 1 && !options.includes(tokens[0].toUpperCase())) {
      offList.push(`${ref}: answered ${tokens[0]}, options were ${options.join("/")}`);
    }
  }
  return { blank, multi, offList, codes: [...codes].sort(), pairs };
}

/**
 * Decide, per (row, code), whether the code is usable UNDER THAT ROW'S LICENSOR.
 *
 * Before 2026-08-09 this comparison did not exist: the tool built one global set
 * of `p.code` and called any code present anywhere a pass. It even selected
 * `l.name as licensor` and then never read it. A code that exists only under the
 * WRONG licensor was waved through, which is precisely the cross-licensor defect
 * class the resolver's own `validateStyleGuideProperty` was written to catch.
 *
 * @param {Array<{ref:string, code:string, licensor:string}>} pairs
 * @param {Array<{code:string, name:string, licensor:string, licensor_code:string}>} found
 *        every core.property row whose code appears in `pairs`, any licensor
 * @returns {{missing:string[], wrongLicensor:string[], unresolvableLicensor:string[]}}
 */
export function classifyCodePresence(pairs, found) {
  // code -> the licensors that actually own a property with that code
  const owners = new Map();
  const knownLicensors = new Set();
  for (const row of found) {
    const code = String(row.code ?? "").toUpperCase();
    if (!owners.has(code)) owners.set(code, []);
    owners.get(code).push(row);
    if (row.licensor) knownLicensors.add(normLicensor(row.licensor));
    if (row.licensor_code) knownLicensors.add(normLicensor(row.licensor_code));
  }

  const missing = new Set();
  const wrongLicensor = new Set();
  const unresolvableLicensor = new Set();

  for (const { ref, code, licensor } of pairs) {
    const owning = owners.get(code) ?? [];
    if (owning.length === 0) {
      missing.add(code);
      continue;
    }
    const want = normLicensor(licensor);
    // NEVER pass a row whose licensor we cannot identify. Silently treating an
    // unknown licensor as "matches anything" would reinstate the global match
    // this function exists to remove.
    if (!want) {
      unresolvableLicensor.add(`${ref}: code ${code} answered on a row that carries no licensor, so it cannot be licensor-checked`);
      continue;
    }
    if (!knownLicensors.has(want)) {
      unresolvableLicensor.add(`${ref}: licensor "${licensor}" matches no core.licensor name or code, so code ${code} cannot be licensor-checked`);
      continue;
    }
    const match = owning.some(
      (row) => normLicensor(row.licensor) === want || normLicensor(row.licensor_code) === want,
    );
    if (!match) {
      const held = [...new Set(owning.map((row) => row.licensor || row.licensor_code || "(no licensor)"))].sort();
      wrongLicensor.add(`${ref}: code ${code} exists, but under ${held.join(", ")} — not under this row's licensor "${licensor}"`);
    }
  }

  return {
    missing: [...missing].sort(),
    wrongLicensor: [...wrongLicensor].sort(),
    unresolvableLicensor: [...unresolvableLicensor].sort(),
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("Usage: node tools/validate-licensing-answers.mjs <answers.json>\n");
    process.exitCode = 2;
    return;
  }
  const rows = JSON.parse(readFileSync(file, "utf8"));
  const { blank, multi, offList, codes, pairs } = inspectAnswers(rows);

  const url = process.env.PREVIEW_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set PREVIEW_URL (or DATABASE_URL) to the preview database.");

  const { Client } = require("pg");
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  // Deliberately NOT filtered by licensor: we need every owner of each code so we
  // can tell "does not exist" apart from "exists under the wrong licensor".
  const { rows: found } = await client.query(
    `select p.code, p.name, l.name as licensor, l.code as licensor_code
       from core.property p
       left join core.licensor l on l.id = p.licensor_id
      where p.code = any($1)`,
    [codes],
  );
  await client.end();

  const { missing, wrongLicensor, unresolvableLicensor } = classifyCodePresence(pairs, found);

  const report = {
    rows: rows.length,
    answered: rows.length - blank.length,
    distinct_codes: codes.length,
    problems: {
      blank,
      multiple_codes_where_one_required: multi,
      answer_outside_offered_options: offList,
      codes_absent_from_core_property: missing,
      codes_present_under_a_different_licensor: wrongLicensor,
      licensor_could_not_be_resolved: unresolvableLicensor,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const total = blank.length + multi.length + offList.length
    + missing.length + wrongLicensor.length + unresolvableLicensor.length;
  if (total > 0) {
    process.stderr.write(
      `\n${total} problem(s) found. Do NOT accept this sheet as final.\n` +
        `Codes absent from core.property are an OWNER policy decision, not a licensing one - ` +
        `see fix_characters_style_guides.md section 8a.\n` +
        `Codes present under a DIFFERENT licensor are NOT usable: core.property is unique per ` +
        `(licensor_id, code), so the same code means different things under different licensors.\n` +
        `A licensor that could not be resolved is a hard failure, never a pass - map it by hand ` +
        `and re-run.\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`validate-licensing-answers failed: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
