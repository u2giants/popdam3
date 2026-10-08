// Offline tests for the ColdLion order-intake staging transaction and summary
// parser (plan_coldlion_order_intake.md §9 B1 / Phase E). No secrets, no
// database — buildIntakeStageSql is a pure SQL-text builder and parseStageSummary
// is a pure parser, so every branch is exercisable offline (the locked §8
// testability decision; these tests exist because regex-light coverage of this
// module let four SQL-generation defects through the first review round).

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIntakeStageSql,
  buildIntakeFailureSql,
  buildIntakeObjectAssertionSql,
  INTAKE_REQUIRED_TABLES,
  INTAKE_REQUIRED_CONSTRAINTS,
  INTAKE_LINE_SPEC,
  INTAKE_COMPONENT_SPEC,
} from "./coldlion-landing/lib/order-intake-stage.mjs";
import { parseStageSummary, sliceProjection } from "./coldlion-landing/lib/order-intake-run.mjs";

const RUN = "11111111-2222-3333-4444-555555555555";
const WINDOW = { index: 400, from: "2026-10-02", to: "2026-10-08" };

// Synthetic projection-shaped fixtures (no real customer, PO, or SKU data). The
// sealed projection emits localId on lines and lineLocalId on components.
function lineFixture(localId, salesOrderNo, lineNo, item, hash, warehouseCode) {
  return {
    localId,
    company_code: "POP",
    sales_order_no: salesOrderNo,
    sales_order_line_no: lineNo,
    master_item_no: item,
    warehouse_code: warehouseCode,
    line_source_hash: hash,
    fetched_at: "2026-10-01T12:00:00.000Z",
  };
}

function componentFixture(lineLocalId, subItem, hash) {
  return {
    lineLocalId,
    sub_item_no: subItem,
    component_source_hash: hash,
    quantity: 12,
    order_qty: 12,
    fetched_at: "2026-10-01T12:00:00.000Z",
  };
}

const POPULATED = {
  lines: [
    lineFixture("aaaaaaaa-0000-0000-0000-000000000001", 47001, 1, "ITEM-A", "hash-a", "DDPNJ"),
    lineFixture("aaaaaaaa-0000-0000-0000-000000000002", 47002, 1, "ITEM-B", "hash-b", "POECA"),
  ],
  components: [
    componentFixture("aaaaaaaa-0000-0000-0000-000000000001", "SUB-1", "chash-1"),
    componentFixture("aaaaaaaa-0000-0000-0000-000000000001", "SUB-2", "chash-2"),
    componentFixture("aaaaaaaa-0000-0000-0000-000000000002", "SUB-3", "chash-3"),
  ],
  excludedEp001: 1,
};

const EMPTY = { lines: [], components: [], excludedEp001: 0 };

function build(projected, { dryRun = false } = {}) {
  return buildIntakeStageSql({
    runId: RUN,
    window: WINDOW,
    track: "trailing",
    projected,
    companyCode: "POP",
    pageSize: 200,
    completion: {
      rows: 6,
      pages: 1,
      httpStatus: 200,
      bodyStatus: 200,
    },
    startedAt: "2026-10-01T12:00:00.000Z",
    finishedAt: "2026-10-01T12:00:03.000Z",
    durationMs: 3000,
    notes: "lines=2 components=3",
    dryRun,
  });
}

/** Split a top-level comma list, ignoring commas inside single-quoted literals. */
function splitTopLevel(value) {
  const fields = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of value) {
    if (char === "'" && (current.at(-1) !== "\\" || !quoted)) quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (char === "," && depth === 0 && !quoted) {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

function lineInsertSection(sql) {
  const start = sql.indexOf("insert into coldlion.intake_order_line");
  const end = sql.indexOf("on conflict on constraint coldlion_intake_order_line_identity_unique", start);
  return sql.slice(start, end);
}

test("the line INSERT names every column exactly once — no duplicate id, arity matches its VALUES", () => {
  const sql = build(POPULATED);
  const section = lineInsertSection(sql);
  const columns = splitTopLevel(section.slice(section.indexOf("(") + 1, section.indexOf(")")));
  // Each column appears exactly once (a duplicated id once produced 28 columns
  // against 27 value expressions — "column id specified more than once").
  assert.equal(new Set(columns.map((c) => c.trim())).size, columns.length);
  assert.equal(columns.length, INTAKE_LINE_SPEC.length + 2); // + first_seen_run, last_seen_run
  const valuesStart = section.indexOf("values");
  const firstRow = section.slice(section.indexOf("(", valuesStart) + 1, section.indexOf(")", valuesStart));
  assert.equal(splitTopLevel(firstRow).length, columns.length);
});

/** The full "(...), (...)" VALUES text between `from (values` and its `) as v(` alias. */
function componentRowsText(sql) {
  const valuesStart = sql.indexOf("from (values");
  const aliasStart = sql.indexOf("as v(", valuesStart);
  return { rowsText: sql.slice(valuesStart + "from (values".length, aliasStart).trim(), aliasStart, valuesStart };
}

test("every component VALUES row carries exactly the v(...) alias arity", () => {
  for (const projected of [POPULATED, EMPTY]) {
    const sql = build(projected);
    const { rowsText, aliasStart } = componentRowsText(sql);
    const aliases = splitTopLevel(sql.slice(aliasStart + 5, sql.indexOf(")", aliasStart)));
    assert.equal(aliases.length, 4 + INTAKE_COMPONENT_SPEC.length);
    // Top-level commas between the outer row parens separate the rows; each row
    // then splits into its own fields.
    for (const group of splitTopLevel(rowsText)) {
      const row = group.trim();
      assert.ok(row.startsWith("(") && row.endsWith(")"), `a VALUES entry is not a parenthesized row: ${row.slice(0, 40)}`);
      assert.equal(splitTopLevel(row.slice(1, -1)).length, aliases.length);
    }
  }
});

test("the empty window keeps the where-false line_map branch and a syntactically valid placeholder row", () => {
  const sql = build(EMPTY);
  assert.match(sql, /where false/);
  assert.match(sql, /select null::uuid as id/);
  // The placeholder row is all NULLs at the full alias arity (it joins to
  // nothing), never a short five-value tuple against 32 aliases.
  const { rowsText, aliasStart } = componentRowsText(sql);
  const aliases = splitTopLevel(sql.slice(aliasStart + 5, sql.indexOf(")", aliasStart)));
  const groups = splitTopLevel(rowsText);
  assert.equal(groups.length, 1);
  const row = groups[0].trim().slice(1, -1);
  assert.equal(splitTopLevel(row).length, aliases.length);
  assert.match(row, /^null::bigint, null::integer, null::text, null::text,/);
  // Non-text component columns must be typed nulls. Bare `null` in the VALUES
  // list resolves to text and fails numeric component columns (line_price etc.)
  // on insert — scheduled run 37748611709 failed live on exactly that.
  assert.match(row, /null::numeric/);
  assert.match(row, /null::boolean/);
  assert.match(row, /null::timestamptz/);
});

test("components bind to their parent line through the projection's lineLocalId", () => {
  // Builds cleanly when every component's lineLocalId resolves to a staged line...
  assert.doesNotThrow(() => build(POPULATED));
  // ...and REFUSES (before any SQL is emitted) when one does not.
  const orphan = {
    ...POPULATED,
    components: [...POPULATED.components, componentFixture("ffffffff-0000-0000-0000-00000000000f", "SUB-9", "chash-9")],
  };
  assert.throws(() => build(orphan), /component references a parent line outside this window projection/);
});

test("novelty detection reads line_map's RETURNING, groups per order, and tests the line-ref prefix collation-proof", () => {
  const sql = build(POPULATED);
  const newOrders = sql.slice(sql.indexOf("new_orders as ("), sql.indexOf("counts as ("));
  // Postgres data-modifying CTEs cannot see each other's table writes: the
  // novelty insert must read line_map (RETURNING), never a fresh read of
  // coldlion.intake_order_line inside the same statement.
  assert.match(newOrders, /from line_map m/);
  assert.doesNotMatch(newOrders, /from coldlion\.intake_order_line/);
  assert.match(newOrders, /group by m\.sales_order_no/);
  // The LIKE behind the source_system equality is the semantic prefix test:
  // collation-proof. The b-tree serves the source_system equality only — the
  // LIKE prefix cannot ride it under a non-C collation (no text_pattern_ops
  // index exists) and runs as a residual filter pending the Phase D EXPLAIN.
  // Byte-order ranges (>= prefix AND < successor, or < prefix || chr(1)) were
  // withdrawn in review — the first suppresses nothing, the second can silently
  // exclude real refs under punctuation-reordering collations.
  assert.match(newOrders, /r\.source_id like 'coldlion:so:' \|\| m\.sales_order_no::text \|\| ':%'/);
  assert.doesNotMatch(sql, /chr\(1\)/);
  assert.doesNotMatch(sql, /source_id >= 'coldlion:so:' \|\| m\.sales_order_no::text \|\| ':'/);
});

test("the durable sync_run row receives the staged counts (run_counts CTE)", () => {
  const sql = build(POPULATED);
  assert.match(sql, /run_counts as \(\s*update coldlion\.sync_run s/);
  assert.match(sql, /set rows_inserted = \(select lines_inserted from counts\) \+ \(select components_inserted from counts\)/);
  assert.match(sql, /set rows_inserted[\s\S]*?rows_updated\s+= \(select lines_updated from counts\) \+ \(select components_updated from counts\)/);
  // rows_unchanged is pinned 0, never left null: every observed row inserts or
  // updates in this model (a fresh run id per window moves last_seen_run always),
  // and a null would read as "not recorded" on the shared audit row (round-3 L-3).
  assert.match(sql, /rows_updated[\s\S]*?rows_unchanged\s+= 0/);
});

test("one transaction per window; dry-run rolls back, live run commits; the sealed ledger is never touched", () => {
  const dry = build(POPULATED, { dryRun: true });
  const live = build(POPULATED);
  assert.match(dry, /^begin;$/m);
  assert.match(dry, /rollback;\s*$/);
  assert.doesNotMatch(dry, /commit;/);
  assert.match(live, /commit;\s*$/);
  assert.doesNotMatch(live, /rollback;/);
  // The final summary SELECT must be TERMINATED before the transaction end:
  // `select ... commit` is a syntax error Postgres refuses at dispatch time,
  // so an unterminated builder ships fine offline and fails the first real
  // run. This is the twin of the C2 writer defect; the terminator is pinned
  // here so the suite catches its absence. The writer's own suite does NOT
  // pin its twin — its transaction test asserts commit;/rollback; placement
  // only, which an unterminated final statement still satisfies (round-1
  // mutation evidence: deleting the `;` from `as orders_left_pending;` leaves
  // the claim suite 24/24 green) — that gap is recorded as a carried finding
  // in this generation's completion evidence, not covered by this pin.
  assert.match(dry, /as new_order_numbers;\s*\nrollback;/);
  assert.match(live, /as new_order_numbers;\s*\ncommit;/);
  for (const sql of [dry, live]) {
    assert.doesNotMatch(sql, /window_ledger/);
    assert.doesNotMatch(sql, /recordFailure/);
  }
});

test("buildIntakeFailureSql terminates the statement before commit — the recovery path never meets the defect class (round-1 L-1 pin)", () => {
  const sql = buildIntakeFailureSql({
    runId: RUN,
    window: WINDOW,
    track: "trailing",
    companyCode: "POP",
    error: new Error("window fetch failed"),
    startedAt: "2026-10-02T15:00:00.000Z",
  });
  assert.match(sql, /^begin;$/m);
  const lines = sql.trimEnd().split("\n");
  assert.equal(lines.at(-1), "commit;");
  // The pg_notify SELECT — the statement immediately before commit — must end
  // terminated on its own line, never `select pg_notify(...) commit`. This is
  // the exact shape that would have killed the stage builder's first real
  // dispatch.
  assert.match(lines.at(-2), /\);\s*$/);
  assert.match(lines.at(-2), /pg_notify\('coldlion_sync_alert'/);
  // The failure recorder is a SIBLING of recordFailure() and must never touch
  // the sealed-window machinery (plan §8): a poisoned ledger would break
  // sealed-window resume, and the recovery path runs exactly when a window
  // has just failed.
  assert.doesNotMatch(sql, /window_ledger/);
  assert.doesNotMatch(sql, /recordFailure/);
});

test("parseStageSummary reads runSql's ALIGNED psql output (header, rule, footer and all)", () => {
  // This is the shape db.mjs's runSql actually produces: psql with --no-psqlrc
  // and --quiet prints default aligned output; only queryRows switches to
  // unaligned/tabbed. The first round parsed only tabs and read NaN counts.
  const aligned = [
    "BEGIN",
    "INSERT 0 1",
    " lines_inserted | lines_updated | components_inserted | components_updated | new_orders | new_order_numbers",
    "----------------+----------------+----------------------+---------------------+------------+------------------",
    "               2 |              0 |                    3 |                   0 |          2 | 47001,47002",
    "(1 row)",
    "",
    "COMMIT",
  ].join("\n");
  assert.deepEqual(parseStageSummary(aligned), {
    lines_inserted: 2,
    lines_updated: 0,
    components_inserted: 3,
    components_updated: 0,
    new_orders: 2,
    new_order_numbers: "47001,47002",
  });
});

test("parseStageSummary also accepts the tab-separated shape and refuses unreadable output", () => {
  assert.deepEqual(parseStageSummary("2\t0\t3\t0\t2\t47001,47002"), {
    lines_inserted: 2,
    lines_updated: 0,
    components_inserted: 3,
    components_updated: 0,
    new_orders: 2,
    new_order_numbers: "47001,47002",
  });
  assert.deepEqual(parseStageSummary("0\t0\t0\t0\t0\t"), {
    lines_inserted: 0,
    lines_updated: 0,
    components_inserted: 0,
    components_updated: 0,
    new_orders: 0,
    new_order_numbers: "",
  });
  // A NaN count would silently break the forward-scan stop rule; garbage REFUSES.
  assert.throws(() => parseStageSummary("no rows"), /no parseable summary row/);
  assert.throws(() => parseStageSummary(""), /no parseable summary row/);
  assert.throws(() => parseStageSummary(undefined), /no parseable summary row/);
});

test("novelty counts INSERTS only: new_orders returns was_insert and every new count filters on it", () => {
  const sql = build(POPULATED);
  const newOrders = sql.slice(sql.indexOf("new_orders as ("), sql.indexOf("counts as ("));
  // RETURNING on INSERT ... ON CONFLICT DO UPDATE emits updated rows too; a
  // re-observed order is NOT a new detection (round-2 H-1).
  assert.match(newOrders, /returning sales_order_no, \(first_seen_run = last_seen_run\) as was_insert/);
  // Exact discriminator, not the xmax system-column heuristic: the insert path
  // writes both run FKs equal; the update path leaves the original first_seen_run.
  assert.doesNotMatch(sql, /xmax/);
  const counts = sql.slice(sql.indexOf("counts as ("), sql.indexOf("window_state as ("));
  assert.match(counts, /\(select count\(\*\) from new_orders where was_insert\) as new_orders/);
  assert.match(counts, /from new_orders where was_insert\) as new_order_numbers/);
});

test("the line-ref novelty test carries the collation-proof LIKE beside the source_system equality", () => {
  const sql = build(POPULATED);
  const newOrders = sql.slice(sql.indexOf("new_orders as ("), sql.indexOf("counts as ("));
  // The b-tree narrows to the source_system equality; the LIKE is the
  // semantic filter and, under a non-C collation with no text_pattern_ops
  // index, a residual one (generation-13 carried finding L-2) — a collation
  // that orders ':' and ';' unexpectedly can never make the probe WRONGLY
  // include a foreign ref (round-2 L-3).
  assert.match(newOrders, /r\.source_id like 'coldlion:so:' \|\| m\.sales_order_no::text \|\| ':%'/);
});

test("the pre-flight object assertion names every required table and constraint exactly", () => {
  const sql = buildIntakeObjectAssertionSql();
  for (const name of INTAKE_REQUIRED_TABLES) {
    const parts = name.split(".");
    assert.ok(sql.includes(`('${parts[0]}', '${parts[1]}')`), `missing table ${name}`);
  }
  // Constraints are verified against their EXACT relation AND definition, never
  // by name alone (round-3 M-1): the values rows carry schema, table, conname,
  // and the pg_get_constraintdef text the live constraint must equal.
  for (const entry of INTAKE_REQUIRED_CONSTRAINTS) {
    assert.ok(
      sql.includes(`('${entry.schema}', '${entry.table}', '${entry.conname}', '${entry.definition}')`),
      `missing constraint row ${entry.conname}`,
    );
  }
  assert.match(sql, /r\.relname = k\.table_name/);
  assert.match(sql, /c\.conname = k\.conname/);
  assert.match(sql, /pg_catalog\.pg_get_constraintdef\(c\.oid\) = k\.def/);
  // Read-only: no data-modifying statement, and the result lists what is absent.
  assert.match(sql, /as missing_objects/);
  assert.doesNotMatch(sql, /(insert|update|delete|grant|create)/i);
  assert.equal(INTAKE_REQUIRED_TABLES.length, 9);
  assert.equal(INTAKE_REQUIRED_CONSTRAINTS.length, 3);
});

test("sliceProjection bounds a window to the first N distinct sales orders, cutting their components with them", () => {
  // Three orders in projection order: 47001 (two components), 47002 (one),
  // 47003 (one). A limit of 2 keeps the first TWO orders only.
  const projected = {
    lines: [
      lineFixture("aaaaaaaa-0000-0000-0000-000000000001", 47001, 1, "ITEM-A", "hash-a", "DDPNJ"),
      lineFixture("aaaaaaaa-0000-0000-0000-000000000002", 47002, 1, "ITEM-B", "hash-b", "POECA"),
      lineFixture("aaaaaaaa-0000-0000-0000-000000000003", 47003, 1, "ITEM-C", "hash-c", "FOB"),
    ],
    components: [
      componentFixture("aaaaaaaa-0000-0000-0000-000000000001", "SUB-1", "chash-1"),
      componentFixture("aaaaaaaa-0000-0000-0000-000000000001", "SUB-2", "chash-2"),
      componentFixture("aaaaaaaa-0000-0000-0000-000000000002", "SUB-3", "chash-3"),
      componentFixture("aaaaaaaa-0000-0000-0000-000000000003", "SUB-4", "chash-4"),
    ],
    excludedEp001: 0,
  };
  const sliced = sliceProjection(projected, 2);
  assert.equal(sliced.sliced, true);
  assert.equal(sliced.ordersKept, 2);
  assert.deepEqual(sliced.projected.lines.map((line) => line.sales_order_no), [47001, 47002]);
  // 47003's component is cut with its parent line; 47001's two survive.
  assert.deepEqual(sliced.projected.components.map((component) => component.sub_item_no), ["SUB-1", "SUB-2", "SUB-3"]);
  // No limit: nothing is sliced and the order count is reported.
  const whole = sliceProjection(projected, null);
  assert.equal(whole.sliced, false);
  assert.equal(whole.ordersKept, 3);
  assert.equal(whole.projected.lines.length, 3);
  // A limit that covers everything slices nothing.
  const generous = sliceProjection(projected, 5);
  assert.equal(generous.sliced, false);
  assert.equal(generous.projected.components.length, 4);
  // Multi-line orders count ONCE toward the budget.
  const multiLine = {
    lines: [
      lineFixture("aaaaaaaa-0000-0000-0000-000000000001", 47001, 1, "ITEM-A", "hash-a", "DDPNJ"),
      lineFixture("aaaaaaaa-0000-0000-0000-000000000001b", 47001, 2, "ITEM-A2", "hash-a2", "DDPNJ"),
      lineFixture("aaaaaaaa-0000-0000-0000-000000000002", 47002, 1, "ITEM-B", "hash-b", "POECA"),
    ],
    components: [componentFixture("aaaaaaaa-0000-0000-0000-000000000001", "SUB-1", "chash-1")],
    excludedEp001: 0,
  };
  const one = sliceProjection(multiLine, 1);
  assert.equal(one.ordersKept, 1);
  assert.deepEqual(one.projected.lines.map((line) => line.sales_order_line_no), [1, 2]);
});

test("intra-batch duplicate identities are de-duplicated, never allowed to abort the window", () => {
  // ON CONFLICT DO UPDATE over a VALUES list naming one identity twice aborts
  // the whole statement ("cannot affect row a second time"). The builder keeps
  // the FIRST occurrence of each line identity and each component identity.
  const duplicated = {
    lines: [
      lineFixture("aaaaaaaa-0000-0000-0000-000000000001", 47001, 1, "ITEM-A", "hash-a", "DDPNJ"),
      // Same identity as line 1, different localId: first-wins.
      lineFixture("bbbbbbbb-0000-0000-0000-000000000009", 47001, 1, "ITEM-A", "hash-a", "DDPNJ"),
      lineFixture("aaaaaaaa-0000-0000-0000-000000000002", 47002, 1, "ITEM-B", "hash-b", "POECA"),
    ],
    components: [
      componentFixture("aaaaaaaa-0000-0000-0000-000000000001", "SUB-1", "chash-1"),
      // Duplicate component identity under the KEPT parent: dropped.
      componentFixture("aaaaaaaa-0000-0000-0000-000000000001", "SUB-1", "chash-1"),
      // Same identity under the DROPPED duplicate line: resolves to the kept
      // parent's four keys, so it is also a duplicate — dropped.
      componentFixture("bbbbbbbb-0000-0000-0000-000000000009", "SUB-1", "chash-1"),
      componentFixture("aaaaaaaa-0000-0000-0000-000000000002", "SUB-3", "chash-3"),
    ],
    excludedEp001: 0,
  };
  const sql = build(duplicated);
  const section = lineInsertSection(sql);
  const valuesStart = section.indexOf("values");
  const valuesBody = section.slice(valuesStart);
  // Two line rows survive (47001 once, 47002), each listed exactly once.
  assert.equal((valuesBody.match(/47001/g) || []).length, 1);
  assert.equal((valuesBody.match(/47002/g) || []).length, 1);
  // The component VALUES list carries each identity once: chash-1 appears once.
  const compStart = sql.indexOf("from (values");
  const compBody = sql.slice(compStart, sql.indexOf(") as v(", compStart));
  assert.equal((compBody.match(/chash-1/g) || []).length, 1);
  assert.equal((compBody.match(/chash-3/g) || []).length, 1);
});

