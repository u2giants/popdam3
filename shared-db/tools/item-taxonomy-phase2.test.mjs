import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildFailedSyncRunSql,
  fetchPaged,
  sqlDollarQuote,
} from "./coldlion-sync-common.mjs";
import {
  DIVISIONS,
  buildHeaderImportSql,
  collectHeaders,
} from "./sync-merchgroup-headers.mjs";
import {
  buildItemImportPayload,
  buildItemImportSql,
} from "./sync-coldlion-items.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const resolverSql = readFileSync(
  join(here, "..", "supabase", "migrations", "20260720121000_item_taxonomy_phase2b_resolver.sql"),
  "utf8",
);

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("fetchPaged follows content pages until the terminal page", async () => {
  const calls = [];
  const pages = [
    { content: [{ itemNo: "A" }], last: false },
    { content: [{ itemNo: "B" }], last: true },
  ];
  const result = await fetchPaged("http://example.test/items?size=200", "fixture-key", async (url, options) => {
    calls.push({ url: String(url), options });
    return response(pages[calls.length - 1]);
  });
  assert.deepEqual(result.rows.map((row) => row.itemNo), ["A", "B"]);
  assert.equal(result.terminalReached, true);
  assert.equal(result.pagesFetched, 2);
  assert.match(calls[1].url, /page=1/);
  assert.equal(calls[0].options.headers["X-API-Key"], "fixture-key");
});

test("fetchPaged accepts the merchGroupHeaders plain-array response", async () => {
  const result = await fetchPaged("http://example.test/headers", "fixture-key", async () => response([{ mgTypeCode: "05" }]));
  assert.equal(result.rows.length, 1);
  assert.equal(result.terminalReached, true);
});

test("collectHeaders requests every known division without a live call", async () => {
  const seen = [];
  const rows = await collectHeaders("fixture-key", async (url) => {
    seen.push(new URL(url).searchParams.get("divisionCode"));
    return response([{ divisionCode: seen.at(-1), mgTypeCode: "05", mgTypeDesc: "fixture" }]);
  });
  assert.deepEqual(seen, DIVISIONS);
  assert.equal(rows.length, 4);
});

test("header builder calls the JSONB-fed SQL dictionary importer", () => {
  const sql = buildHeaderImportSql([{ divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor" }]);
  assert.match(sql, /plm\.import_merch_group_headers/);
  assert.match(sql, /\$cl_headers\$.*CW001.*\$cl_headers\$::jsonb/s);
});

test("item builder carries completeness and sanity-band assertions", () => {
  const payload = buildItemImportPayload([{ companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "A" }], {
    sweepId: "00000000-0000-0000-0000-000000000001",
    terminalReached: true,
    minimumSilverRatio: 0.85,
  });
  assert.equal(payload.terminalReached, true);
  assert.equal(payload.minimumSilverRatio, 0.85);
  const sql = buildItemImportSql(payload);
  assert.match(sql, /plm\.import_item_master_data/);
  assert.match(sql, /terminalReached/);
});

test("durable failure SQL records failure separately and alerts after two non-promotions", () => {
  const sql = buildFailedSyncRunSql("item_taxonomy_resolver", "apply", "forced fixture failure");
  assert.match(sql, /insert into ingest\.sync_run/);
  assert.match(sql, /'failed'/);
  assert.match(sql, /forced fixture failure/);
  assert.match(sql, /limit 1/);
  assert.match(sql, /pg_notify\('coldlion_sync_alert'/);
});

test("SQL resolver implements the locked outcome matrix and read-only core contract", () => {
  assert.match(resolverSql, /meaning_05='licensor'/);
  assert.match(resolverSql, /meaning_06='property'/);
  assert.match(resolverSql, /slot is '\|\|r\.meaning_05\|\|', not licensor'/);
  assert.match(resolverSql, /slot is '\|\|r\.meaning_06\|\|', not property'/);
  assert.match(resolverSql, /property code is ambiguous outside the resolved licensor/);
  assert.match(resolverSql, /delete from plm\.item_import_unresolved/);
  assert.match(resolverSql, /property parent wins/);
  assert.match(resolverSql, /'resolved'/);
  assert.match(resolverSql, /'partially-resolved'/);
  assert.match(resolverSql, /'ambiguous'/);
  assert.match(resolverSql, /'unresolved'/);
  assert.doesNotMatch(resolverSql, /insert\s+into\s+core\./i);
  assert.doesNotMatch(resolverSql, /update\s+core\./i);
  assert.doesNotMatch(resolverSql, /delete\s+from\s+core\./i);
  assert.doesNotMatch(resolverSql, /product_type_id\s*=/i);
  assert.doesNotMatch(resolverSql, /merch_group_id\s*=/i);
});

test("dollar quoting rejects a payload escape", () => {
  assert.throws(() => sqlDollarQuote("cl_items", "bad $cl_items$ value"), /dollar quote tag/);
});

test("#3903: loader refuses unknown flags instead of a silent fetch-only run", async () => {
  const { parseLoaderArgs } = await import("./sync-coldlion-items.mjs");
  assert.deepEqual(parseLoaderArgs(["--apply"]), { apply: true });
  assert.throws(() => parseLoaderArgs(["--linked"]), /unknown argument/);
  assert.throws(() => parseLoaderArgs(["--aply"]), /unknown argument/);
});

test("#3903: item import rolls back when licensor resolution collapses", async () => {
  const { buildItemImportSql } = await import("./sync-coldlion-items.mjs");
  const sql = buildItemImportSql({ items: [] });
  assert.ok(sql.indexOf("item_master_resolved_before") < sql.indexOf("plm.import_item_master_data"));
  assert.match(sql, /raise exception 'item master resolution collapsed/);
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /\ncommit;\n$/);
  const bypass = buildItemImportSql({ items: [] }, { allowResolutionDrop: true });
  assert.match(bypass, /RESOLUTION GUARD BYPASSED/);
  // the silver-link sanity check runs before, and outside, the bypassable block
  assert.ok(bypass.indexOf("silver rows link to plm.item") < bypass.indexOf("if false then"));
  assert.match(sql, /join plm\.item i on i\.id = ii\.item_id/);
  assert.match(buildItemImportSql({ items: [] }, { allowResolutionDrop: true }), /\n  if false then\n/);
  assert.match(sql, /group by ii\.division_code/);
});

test("#3903: nightly landing sync runs the Item Master loader in its own guarded step", async () => {
  const { readFileSync } = await import("node:fs");
  const yml = readFileSync(new URL("../.github/workflows/coldlion-landing-sync.yml", import.meta.url), "utf8");
  const step = yml.slice(yml.indexOf("- name: Refresh Item Master (plm.item) from ColdLion /items"));
  assert.ok(yml.indexOf("- name: Refresh Item Master") > 0 && yml.indexOf("- name: Refresh Item Master") < yml.indexOf("- name: Sync\n"));
  const sync = yml.slice(yml.indexOf("- name: Sync\n"));
  assert.match(sync, /^- name: Sync\n\s+if: \$\{\{ !cancelled\(\) && steps\.target\.outcome == 'success' \}\}/);
  assert.match(step, /ITEM_MASTER_ALLOW_RESOLUTION_DROP: \$\{\{ github\.event\.inputs\.allow_resolution_drop \}\}/);
  const ownStep = step.slice(0, step.indexOf("- name: Sync\n"));
  assert.match(ownStep, /\n\s+if: \$\{\{ !cancelled\(\) && steps\.target\.outcome == 'success' \}\}\n/);
  assert.match(yml, /- name: Refuse to run without an explicit target\n\s+id: target\n/);
  assert.match(step, /COLDLION_EXPECTED_PROJECT_REF: qsllyeztdwjgirsysgai/);
  assert.match(step, /node tools\/sync-coldlion-items\.mjs --apply/);
  assert.match(step, /if \[ "\$\{DRY_RUN:-false\}" = "true" \]; then\n\s+node tools\/sync-coldlion-items\.mjs\n/);
  assert.match(yml, /tools\/item-taxonomy-phase2\.test\.mjs/);
});
