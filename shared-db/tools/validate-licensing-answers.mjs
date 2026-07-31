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

export function inspectAnswers(rows) {
  const blank = [];
  const multi = [];
  const offList = [];
  const codes = new Set();

  for (const r of rows) {
    const ref = r.ref ?? "(no ref)";
    const answer = String(r.YOUR_ANSWER ?? "").trim();
    if (!answer) {
      blank.push(ref);
      continue;
    }
    if (NON_CODE.test(answer)) continue;

    const tokens = answer.split(/[,;/\s]+/).filter((t) => CODE.test(t));
    if (tokens.length > 1) multi.push(`${ref}: ${answer}`);
    tokens.forEach((t) => codes.add(t.toUpperCase()));

    const options = String(r.options ?? "")
      .split("/")
      .map((o) => o.trim().toUpperCase())
      .filter(Boolean);
    if (options.length && tokens.length === 1 && !options.includes(tokens[0].toUpperCase())) {
      offList.push(`${ref}: answered ${tokens[0]}, options were ${options.join("/")}`);
    }
  }
  return { blank, multi, offList, codes: [...codes].sort() };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("Usage: node tools/validate-licensing-answers.mjs <answers.json>\n");
    process.exitCode = 2;
    return;
  }
  const rows = JSON.parse(readFileSync(file, "utf8"));
  const { blank, multi, offList, codes } = inspectAnswers(rows);

  const url = process.env.PREVIEW_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set PREVIEW_URL (or DATABASE_URL) to the preview database.");

  const { Client } = require("pg");
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  const { rows: found } = await client.query(
    `select p.code, p.name, l.name as licensor
       from core.property p
       left join core.licensor l on l.id = p.licensor_id
      where p.code = any($1)`,
    [codes],
  );
  await client.end();

  const have = new Set(found.map((r) => r.code));
  const missing = codes.filter((c) => !have.has(c));

  const report = {
    rows: rows.length,
    answered: rows.length - blank.length,
    distinct_codes: codes.length,
    problems: {
      blank,
      multiple_codes_where_one_required: multi,
      answer_outside_offered_options: offList,
      codes_absent_from_core_property: missing,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const total = blank.length + multi.length + offList.length + missing.length;
  if (total > 0) {
    process.stderr.write(
      `\n${total} problem(s) found. Do NOT accept this sheet as final.\n` +
        `Codes absent from core.property are an OWNER policy decision, not a licensing one - ` +
        `see fix_characters_style_guides.md section 8a.\n`,
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
