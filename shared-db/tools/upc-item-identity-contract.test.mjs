// Regression pins for the UPC item-identity contract
// (supabase/migrations/20260803150000_itemdetail_coldlion_item_identity_and_upc_contract.sql).
//
// Three things about that migration are load-bearing and easy to "helpfully" undo later.
// Each one has burned this repo or this workstream already, so each gets a pin:
//
//  1. IT MUST NOT BACKFILL. The only in-database candidate for deriving the item number is
//     `whse_sku_id`, which is ColdLion's warehouseSKU, not an item number. Measured on
//     production 2026-08-03: of 21,736 rows that have one, 7,383 match exactly one
//     item_num_id, 336 match MORE THAN ONE (a wrong-item binding), and 14,017 match none.
//     A future session that "finishes the job" by adding an UPDATE ... FROM here would be
//     writing guessed identities into 336 rows that provably point at the wrong item.
//
//  2. THE VIEW MUST FAIL CLOSED. `dflow.item_detail_upc` filters on
//     `item_num_id is not null`. Every row in the table today predates 2023-12-12, so the
//     view returns nothing until the corrected sync runs. Dropping that predicate to "show
//     something" would surface a stale 2023 UPC as if it were current — the exact outcome
//     the owner called worse than showing nothing, because it looks right.
//
//  3. THE JOIN KEY MUST BE THE FULL TRIPLE. dflow."itemHeader".item_num_id is not unique
//     (19,459 rows, 17,898 distinct item numbers; real item numbers repeat across
//     divisions). An index or a contract keyed on item_num_id alone reintroduces the
//     wrong-item binding this migration exists to prevent.
//
// FULLY OFFLINE. Reads the migration file from disk. No database, no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(
  HERE,
  "..",
  "supabase",
  "migrations",
  "20260803150000_itemdetail_coldlion_item_identity_and_upc_contract.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

// Strip line comments so the prose in the header (which necessarily mentions UPDATE,
// backfill, whse_sku_id, etc.) can never satisfy or trip an assertion below.
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

test("migration is additive only — no destructive or data-writing statement", () => {
  const forbidden = [
    /\bdrop\s+(table|column|view|index|constraint)\b/i,
    /\balter\s+column\b/i,
    /\brename\s+to\b/i,
    /\bupdate\s+dflow\b/i,
    /\bdelete\s+from\b/i,
    /\btruncate\b/i,
    /\binsert\s+into\b/i,
  ];
  for (const pattern of forbidden) {
    assert.equal(
      pattern.test(code),
      false,
      `migration must not contain ${pattern} — it is declared additive and backfill-free`,
    );
  }
});

test("PIN 1: no backfill is attempted from whse_sku_id", () => {
  // whse_sku_id may only appear as a passthrough column in the view's select list,
  // never on either side of an assignment or a join condition.
  assert.equal(
    /whse_sku_id\s*=/.test(code),
    false,
    "whse_sku_id must never be used to derive or match an item identity — it is a warehouse SKU",
  );
  assert.equal(
    /split_part\s*\(/i.test(code),
    false,
    "no string-splitting heuristic may be used to recover an item number",
  );
});

test("PIN 2: the read contract fails closed on unresolved rows", () => {
  const viewBody = code.slice(code.search(/create\s+or\s+replace\s+view\s+dflow\.item_detail_upc/i));
  assert.match(
    viewBody,
    /item_num_id\s+is\s+not\s+null/i,
    "dflow.item_detail_upc must exclude rows with no resolved item identity",
  );
  assert.match(
    viewBody,
    /coalesce\s*\(\s*d\."UPC"\s*,\s*''\s*\)\s*<>\s*''/i,
    "dflow.item_detail_upc must exclude rows with no UPC",
  );
});

test("PIN 3: the identity is the full ColdLion triple, not the item number alone", () => {
  const indexStmt = code.match(/create\s+index[^;]+idx_itemdetail_coldlion_identity[^;]+;/i);
  assert.ok(indexStmt, "the identity index must exist");
  for (const col of ["item_num_id", "compan_code_fk", "div_code_fk"]) {
    assert.match(
      indexStmt[0],
      new RegExp(`\\b${col}\\b`),
      `identity index must include ${col} — item_num_id alone is not unique in dflow."itemHeader"`,
    );
  }
  for (const col of ["item_num_id", "compan_code_fk", "div_code_fk"]) {
    assert.match(
      code,
      new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`, "i"),
      `${col} must be added to dflow."itemDetail"`,
    );
  }
});

test("staleness is observable — coldlion_synced_at is added and exposed", () => {
  assert.match(code, /add\s+column\s+if\s+not\s+exists\s+coldlion_synced_at\s+timestamptz/i);
  const viewBody = code.slice(code.search(/create\s+or\s+replace\s+view\s+dflow\.item_detail_upc/i));
  assert.match(
    viewBody,
    /coldlion_synced_at/,
    "the read contract must expose coldlion_synced_at so a caller can tell a fresh UPC from a 2023 one",
  );
});

test("no unique constraint is asserted on the triple", () => {
  // dflow."itemHeader" contains two junk groups ('awda', 'ddxdd') that collide on the
  // triple, so a unique index would fail to build. Pin it so nobody adds one blind.
  assert.equal(
    /create\s+unique\s+index/i.test(code),
    false,
    "a unique index on the identity triple cannot build — junk header rows collide",
  );
});
