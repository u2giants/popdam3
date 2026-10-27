#!/usr/bin/env node
// Nightly READ-ONLY check: do active ColdLion MG06 Property names match the scraped
// licensor Submissions vocabularies, allowing presentation noise (see property-name-match.mjs)?
//
// The scraped vocabulary is read with the same SQL the DB Data Admin inventory uses: the
// Property branch of the DEPLOYED api.db_data_admin_scraped_source_inventory definition
// (read with pg_get_functiondef), cut at its `keyed` CTE. That function itself cannot be called from CI (it requires a
// licensing-manager JWT), and copying its 700 lines here would drift.
//
// Output is COUNTS and ColdLion mg codes only. This repository is public: Property names
// never go to stdout, the job summary, or an artifact.
//
// Usage: node tools/check-coldlion-property-scrape-names.mjs --linked [--summary FILE]

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { runSql } from "./coldlion-sync-common.mjs";
import { matchPropertyNames } from "./property-name-match.mjs";

export const DEFINITION_SQL =
  "select pg_get_functiondef('api.db_data_admin_scraped_source_inventory(text,text,text,integer)'::regprocedure) as result;";

// Returns a standalone SELECT of (licensor_name, display_label) for Submissions rows.
export function scrapedSubmissionsSql(definitionText) {
  const start = definitionText.indexOf("if v_entity_kind = 'property' then");
  if (start < 0) throw new Error("inventory definition: property branch not found");
  const withAt = definitionText.indexOf("with ", start);
  const cut = definitionText.indexOf("), filtered as (", withAt);
  if (withAt < 0 || cut < 0) throw new Error("inventory definition: keyed/filtered anchors not found");
  const body = definitionText.slice(withAt, cut);
  if (/\b(p_search|p_cursor|v_cursor_key|v_page_size)\b/.test(body)) {
    throw new Error("inventory definition: property CTEs now reference function arguments; update this extractor");
  }
  // The inventory hides a Warner product-catalogue (Submissions) row when the same
  // source_id exists in Warner art assets (#4081, display de-duplication only). For a
  // vocabulary check those catalogue names still count, so they are added back directly.
  return `${body})
select licensor_name, display_label from keyed where source_purpose = 'Submissions'
union
select 'Warner Bros. - Submissions (STARLABS Product catalogue)', btrim(w.label)
from plm.wb_property w
where w.source_namespace = 'warner_product_catalogue' and nullif(btrim(w.label), '') is not null`;
}

export function buildSql(definitionText) {
  // One plain SELECT (no writes, no session settings) so the CLI returns exactly one row.
  return `select json_build_object(
  'scraped', (select coalesce(json_agg(s), '[]') from (${scrapedSubmissionsSql(definitionText)}) s),
  'coldlion', (select coalesce(json_agg(c), '[]') from (
     select division_code, mg_code, coalesce(mg_desc, '') as name
     from coldlion.merch_group_detail
     where mg_type_code = '06' and division_code in ('CW001', 'SP001') and active = 'Y') c)
) as result;`;
}

export function parseResult(stdout, { raw = false } = {}) {
  const rows = JSON.parse(stdout);
  const flat = Array.isArray(rows) ? rows : rows.rows ?? [];
  const hit = flat.find((r) => r && r.result !== undefined);
  if (!hit) throw new Error("no result row in query output");
  if (raw || typeof hit.result !== "string") return hit.result;
  return JSON.parse(hit.result);
}

export function summarize({ scraped, coldlion }) {
  if (scraped.length === 0) throw new Error("scraped Submissions vocabulary is empty");
  const r = matchPropertyNames(coldlion, scraped.map((s) => s.display_label));
  const blank = coldlion.filter((c) => c.name.trim() === "");
  return {
    coldlionActive: coldlion.length,
    scrapedSubmissions: scraped.length,
    exact: r.exact.length,
    loose: r.loose.length,
    unmatched: r.unmatched.length,
    looseCodes: [...new Set(r.loose.map((x) => x.mg_code))].sort(),
    unmatchedCodes: [...new Set(r.unmatched.map((x) => x.mg_code))].sort(),
    blankNameCodes: [...new Set(blank.map((x) => x.mg_code))].sort(),
  };
}

function markdown(s) {
  return [
    "## ColdLion MG06 vs licensor-website names",
    `Active ColdLion Property rows (CW001+SP001): ${s.coldlionActive}. Scraped Submissions names: ${s.scrapedSubmissions}.`,
    "",
    `- Exact name match: ${s.exact}`,
    `- Match after ignoring dashes, spacing, quotes, case, "&", "The": ${s.loose} (codes: ${s.looseCodes.join(", ") || "none"})`,
    `- No scraped match (often a licensor we do not scrape): ${s.unmatched} (codes: ${s.unmatchedCodes.join(", ") || "none"})`,
    `- Blank names: ${s.blankNameCodes.length} (codes: ${s.blankNameCodes.join(", ") || "none"})`,
    "",
  ].join("\n");
}

async function main(argv) {
  const linked = argv.includes("--linked");
  const i = argv.indexOf("--summary");
  const definition = parseResult(runSql(DEFINITION_SQL, { linked }), { raw: true });
  if (typeof definition !== "string" || !definition.includes("db_data_admin_scraped_source_inventory")) {
    throw new Error("could not read the deployed inventory definition");
  }
  const s = summarize(parseResult(runSql(buildSql(definition), { linked })));
  const md = markdown(s);
  console.log(md);
  if (i >= 0) fs.appendFileSync(argv[i + 1], md);
  if (s.blankNameCodes.length > 0) {
    console.error(`FAIL: ${s.blankNameCodes.length} active ColdLion Property code(s) have no name`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
