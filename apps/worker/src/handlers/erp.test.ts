import test from "node:test";
import assert from "node:assert/strict";
import { validateErpClassification } from "./erp.js";

test("ERP classification accepts a complete valid result", () => {
  assert.deepEqual(validateErpClassification({ category: "Wall", confidence: 0.9, rationale: "Wall-mounted canvas" }), { category: "Wall", confidence: 0.9, rationale: "Wall-mounted canvas" });
});

test("ERP classification rejects unknown categories and invalid fields", () => {
  assert.throws(() => validateErpClassification({ category: "Furniture", confidence: 0.9, rationale: "x" }), /category/);
  assert.throws(() => validateErpClassification({ category: "Wall", confidence: 2, rationale: "x" }), /confidence/);
  assert.throws(() => validateErpClassification({ category: "Wall", confidence: 0.9, rationale: " " }), /rationale/);
});

import { applyErpKeysetPage, erpKeysetAfter } from "./erp.js";

class FakeQuery {
  constructor(public rows: Array<{ id: string }>, public calls: string[] = [], private after: string | null = null, private max = Infinity) {}
  order(column: string, options: { ascending: boolean }) { this.calls.push(`order:${column}:${options.ascending}`); return this; }
  gt(column: string, value: string) { this.calls.push(`gt:${column}:${value}`); this.after = value; return this; }
  limit(count: number) { this.calls.push(`limit:${count}`); this.max = count; return this; }
  result() { return [...this.rows].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => this.after === null || r.id > this.after).slice(0, this.max); }
}

test("ERP keyset cursor ignores legacy numeric offsets", () => {
  assert.equal(erpKeysetAfter(undefined), null);
  assert.equal(erpKeysetAfter(300), null);
  assert.equal(erpKeysetAfter(""), null);
  assert.equal(erpKeysetAfter("abc"), "abc");
});

test("ERP keyset paging orders by unique id and resumes strictly after the cursor", () => {
  assert.deepEqual(applyErpKeysetPage(new FakeQuery([]), null, 100).calls, ["order:id:true", "limit:100"]);
  assert.deepEqual(applyErpKeysetPage(new FakeQuery([]), "id-5", 100).calls, ["order:id:true", "gt:id:id-5", "limit:100"]);
});

test("ERP keyset paging neither skips nor repeats rows when rows are inserted mid-run", () => {
  const rows = ["b", "d", "f", "h", "j"].map((id) => ({ id }));
  const seen: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const batch = applyErpKeysetPage(new FakeQuery(rows), after, 2).result();
    if (batch.length === 0) break;
    seen.push(...batch.map((r) => r.id));
    after = batch[batch.length - 1].id;
    if (page === 0) rows.push({ id: "a" }, { id: "e" });
  }
  assert.deepEqual(seen, ["b", "d", "e", "f", "h", "j"]);
});

import { buildErpApplyPayload, parseErpApplyResults, type ErpApplyPlan } from "./erp.js";

test("ERP apply payload keeps plan order and fields", () => {
  const plans = [
    { item: { id: "1", style_number: "S1", division_code: "D" }, updates: { mg01_code: "A" }, classificationSource: "erp", confidence: 1 },
    { item: { id: "2", style_number: "S2", division_code: null }, updates: { cover_description: "X" }, classificationSource: "ai", confidence: null },
  ] as unknown as ErpApplyPlan[];
  assert.deepEqual(buildErpApplyPayload(plans), [
    { sku: "S1", division_code: "D", updates: { mg01_code: "A" } },
    { sku: "S2", division_code: null, updates: { cover_description: "X" } },
  ]);
});

test("ERP apply results must match the item count and normalise ids", () => {
  assert.deepEqual(parseErpApplyResults([{ asset_count: 2, group_count: 1, asset_id: "a", group_id: "g" }], 1), [
    { asset_count: 2, group_count: 1, asset_id: "a", group_id: "g" },
  ]);
  assert.throws(() => parseErpApplyResults([], 1), /0 results for 1 items/);
  assert.throws(() => parseErpApplyResults(null, 1), /results for 1 items/);
});

import { ERP_MISSING_CATEGORY_OR, ERP_APPLY_MIN_PAGE_SIZE, handleApplyErpEnrichment, isErpTransientDbTimeout, nextErpApplyPageSize } from "./erp.js";
import type { OpState } from "../types.js";

test("ERP classify candidate scan treats empty-string mg_category as missing", () => {
  // The ColdLion mirror normalizes mGCategory to '' (never NULL). The scan
  // filter must cover both, or the AI path matches zero rows (u2giants/popdam3#616).
  assert.equal(ERP_MISSING_CATEGORY_OR, 'mg_category.is.null,mg_category.eq.""');
  // PostgREST parses eq."" as an empty-string match; eq.'' would match a literal two-quote string and match nothing.
});

// ── #630: transient-timeout page downsizing ─────────────────────────────────

test("only statement/lock timeouts count as transient page failures", () => {
  assert.equal(isErpTransientDbTimeout("apply_erp_item_updates failed: canceling statement due to statement timeout"), true);
  assert.equal(isErpTransientDbTimeout("apply_erp_item_updates failed: canceling statement due to lock timeout"), true);
  assert.equal(isErpTransientDbTimeout("assets lookup failed: operation timed out (57014)"), true);
  assert.equal(isErpTransientDbTimeout("assets lookup failed: relation does not exist"), false);
  assert.equal(isErpTransientDbTimeout(undefined), false);
});

test("page halving floors at ten", () => {
  assert.equal(nextErpApplyPageSize(100), 50);
  assert.equal(nextErpApplyPageSize(25), 12);
  assert.equal(nextErpApplyPageSize(12), ERP_APPLY_MIN_PAGE_SIZE);
  assert.equal(nextErpApplyPageSize(ERP_APPLY_MIN_PAGE_SIZE), ERP_APPLY_MIN_PAGE_SIZE);
});

/** Page-fetch-only fake: resolves transient errors, then a final empty page. */
class TimeoutThenEmptyClient {
  public pageSizes: number[] = [];
  constructor(private transientFailures: number, private finalError: string | null = null) {}
  schema() { return { from: () => this.builder() }; }
  private builder() {
    const b: Record<string, unknown> = {
      select: () => b, not: () => b, neq: () => b, order: () => b, gt: () => b,
      limit: (count: number) => { this.pageSizes.push(count); return b; },
      then: (resolve: (v: { data: unknown[]; error: { message: string } | null }) => void) => {
        if (this.transientFailures > 0) {
          this.transientFailures -= 1;
          resolve({ data: [], error: { message: "apply_erp_item_updates failed: canceling statement due to statement timeout" } });
        } else if (this.finalError) {
          const message = this.finalError;
          this.finalError = null;
          resolve({ data: [], error: { message } });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return b;
  }
}

const OP_STATE: OpState = {
  status: "running",
  cursor: "22d04f21-aa69-4443-a2b2-913253903176",
  params: { mode: "apply" },
  progress: { total: 2100 },
  run_id: "run-630",
};

test("a transient-timeout page retries the same cursor at halved sizes, then succeeds", async () => {
  const client = new TimeoutThenEmptyClient(2);
  const result = await handleApplyErpEnrichment(OP_STATE, client as never);
  assert.deepEqual(client.pageSizes, [100, 50, 25]);
  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.equal(result.retry_page_size, 25);
});

test("non-transient page errors return immediately without downsizing", async () => {
  const client = new TimeoutThenEmptyClient(0, "relation does not exist");
  const result = await handleApplyErpEnrichment(OP_STATE, client as never);
  assert.deepEqual(client.pageSizes, [100]);
  assert.equal(result.ok, false);
  assert.equal(result.error, "relation does not exist");
});

test("downsizing is bounded: four halvings then the page error parks the op", async () => {
  const client = new TimeoutThenEmptyClient(99);
  const result = await handleApplyErpEnrichment(OP_STATE, client as never);
  assert.deepEqual(client.pageSizes, [100, 50, 25, 12, 10]);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /statement timeout/);
});

test("a persisted working page size is the first size tried", async () => {
  const client = new TimeoutThenEmptyClient(0);
  const state: OpState = { ...OP_STATE, progress: { total: 2100, retry_page_size: 25 } };
  const result = await handleApplyErpEnrichment(state, client as never);
  assert.deepEqual(client.pageSizes, [25]);
  assert.equal(result.ok, true);
  assert.equal(result.retry_page_size, 25);
});
