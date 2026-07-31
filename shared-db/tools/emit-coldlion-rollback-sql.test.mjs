// Tests for the ColdLion licensor/property ROLLBACK SQL emitter.
//
// WHY THESE EXIST
// ---------------
// tools/emit-coldlion-rollback-sql.mjs is the emergency lever for the ColdLion
// production feed. It has been executed exactly once, against preview, inside a
// rolled-back transaction. The next time it runs it will be during an incident,
// under time pressure, probably by someone who did not write it. So its guards
// have to be proven to FIRE, not merely proven to exist.
//
// That "prove it fires" rule is not academic. On 2026-07-31 three separate
// defects installed cleanly, passed review, and did nothing at all: a BEFORE
// trigger that read a GENERATED ... STORED column (Postgres populates those
// AFTER before-triggers, so the value was always NULL and the guard never
// raised), a function that failed on every call, and an alert path that never
// recorded so the circuit breaker could never trip. Existence checks passed for
// all three. Every negative test below therefore commits the violation and
// asserts the observable consequence — a throw, and NO SQL produced.
//
// Fully offline: no database, no network, no filesystem writes. The emitter is a
// pure string builder, and buildRollbackSql() is called with synthetic mappings.
//
// KNOWN LIMITATION (honest, and deliberately not fixed here)
// ---------------------------------------------------------
// This tool withdraws links; it does NOT restore an overwritten name. If the
// ColdLion feed updated the name of an existing core.licensor / core.property
// row, running this rollback removes the source ref and clears the mirror link,
// but the row keeps the ColdLion-supplied name. Recovering the prior name needs
// a point-in-time restore or the pre-cutover snapshot — the rollback SQL cannot
// do it, and no assertion below pretends otherwise.

import { strict as assert } from "node:assert";
import test from "node:test";

import { buildRollbackSql } from "./emit-coldlion-rollback-sql.mjs";
import { APPROVED_COUNT, compositeKeyOf } from "./run-coldlion-licensor-property-phase4.mjs";

// Synthetic stand-ins for the frozen approval artifact. Shape only — the real
// values live in docs/verification/, which this test deliberately does not read.
function makeMappings(n = APPROVED_COUNT) {
  return Array.from({ length: n }, (_, i) => ({
    entity_type: i % 2 === 0 ? "licensor" : "property",
    company_code: "POP",
    division_code: "D1",
    mg_type_code: "L",
    mg_code: `MG-${String(i).padStart(4, "0")}`,
    canonical_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  }));
}

// --------------------------------------------------------------------------
// 1. It refuses when the mapping count is not exactly 542.
// --------------------------------------------------------------------------

test("the count guard FIRES: anything other than exactly 542 mappings emits no SQL", () => {
  // Sanity: the pinned constant is the one the incident runbook names.
  assert.equal(APPROVED_COUNT, 542);

  for (const n of [0, 1, APPROVED_COUNT - 1, APPROVED_COUNT + 1]) {
    let emitted = null;
    assert.throws(
      () => {
        emitted = buildRollbackSql(makeMappings(n));
      },
      new RegExp(`refusing to emit rollback SQL for ${n} mappings; expected exactly ${APPROVED_COUNT}`),
      `expected a refusal for ${n} mappings`,
    );
    // Observable consequence, not just a thrown error: nothing was produced.
    assert.equal(emitted, null, `SQL must not be produced for ${n} mappings`);
  }

  // Non-array inputs are refused too, rather than being coerced into a 0-row delete.
  for (const bad of [null, undefined, {}, "542", new Set(makeMappings())]) {
    assert.throws(() => buildRollbackSql(bad), /refusing to emit rollback SQL/);
  }

  // And the happy path really does produce SQL, so the guard above is not
  // passing merely because the function always throws.
  assert.match(buildRollbackSql(makeMappings()), /^-- ColdLion licensor\/property rollback/);
});

// --------------------------------------------------------------------------
// 2. It rejects an unsafe composite key.
// --------------------------------------------------------------------------

test("the composite-key guard FIRES: injection-shaped keys emit no SQL", () => {
  const hostile = [
    "'; drop table core.taxonomy_source_ref; --",
    "POP'/D1/L/MG",
    "POP/D1/L/MG 0001", // a space is enough to be rejected
    "POP/D1/L/MG;",
    'POP/D1/L/"MG"',
    "POP/D1/L/MG\nunion select",
    "POP/D1/L/MG\\0001",
  ];

  for (const evil of hostile) {
    const mappings = makeMappings();
    // Put the hostile value in the LAST element, so a guard that only checks the
    // first row would sail past it.
    mappings[mappings.length - 1] = {
      ...mappings[mappings.length - 1],
      mg_code: evil,
    };

    let emitted = null;
    assert.throws(
      () => {
        emitted = buildRollbackSql(mappings);
      },
      /refusing unsafe composite source key/,
      `expected refusal for key containing ${JSON.stringify(evil)}`,
    );
    assert.equal(emitted, null, "no SQL may be produced for an unsafe key");
  }

  // A missing field collapses to an empty segment, which is still safe per the
  // allowlist — assert the CURRENT behaviour rather than a wished-for one, so a
  // future change to it is visible in this test's diff.
  const withNull = makeMappings();
  withNull[0] = { ...withNull[0], division_code: null };
  assert.equal(compositeKeyOf(withNull[0]), "POP//L/MG-0000");
  assert.match(buildRollbackSql(withNull), /\('POP\/\/L\/MG-0000'\)/);
});

// --------------------------------------------------------------------------
// 3. The emitted SQL deletes ONLY those 542 taxonomy_source_ref rows.
// --------------------------------------------------------------------------

test("the delete is bounded to exactly the 542 approved keys and nothing else", () => {
  const mappings = makeMappings();
  const sql = buildRollbackSql(mappings);

  // Exactly one DELETE in the whole script.
  const deletes = sql.match(/\bdelete\s+from\b/gi) ?? [];
  assert.equal(deletes.length, 1, "the rollback must contain exactly one DELETE");

  // The original defective form — an unbounded delete of every ColdLion row —
  // must not be present. This is the regression that caused the tool to exist.
  assert.doesNotMatch(
    sql,
    /delete\s+from\s+core\.taxonomy_source_ref\s*(?:r\s*)?where/i,
    "the DELETE must be joined to the approved set, never a bare WHERE on source_system",
  );

  // It is scoped by the temp table AND by system/table, all three.
  assert.match(sql, /delete\s+from\s+core\.taxonomy_source_ref\s+r\s+using\s+approved_rollback\s+a/i);
  assert.match(sql, /r\.source_system\s*=\s*'coldlion'/i);
  assert.match(sql, /r\.source_table\s*=\s*'merchGroupDetails'/i);
  assert.match(sql, /r\.source_id\s*=\s*a\.source_id/i);

  // The approved set is precisely the 542 supplied keys — no more, no fewer, no
  // duplicates, and no unbound placeholder left behind.
  const literals = [...sql.matchAll(/^\s*\('([^']*)'\)[,;]?$/gm)].map((m) => m[1]);
  assert.equal(literals.length, APPROVED_COUNT, "the VALUES list must hold exactly 542 keys");
  const expected = mappings.map(compositeKeyOf);
  assert.deepEqual(literals, expected, "the emitted keys must be the supplied keys, in order");
  assert.equal(new Set(literals).size, APPROVED_COUNT, "the keys must be distinct");
  assert.doesNotMatch(sql, /:approved_mapping_json|:\w+_json/, "no unbound psql placeholder may survive");

  // The temp table itself re-asserts the count at run time, so a truncated file
  // aborts instead of silently deleting fewer rows.
  assert.match(sql, /if\s+v_n\s*<>\s*542\s+then/i);
  assert.match(sql, /raise exception 'rollback set is % rows, expected 542'/i);

  // Nothing touches the canonical rows or the parent links.
  assert.doesNotMatch(sql, /\b(?:delete\s+from|update|truncate|drop|alter)\s+core\.(?:licensor|property)\b/i);
  assert.doesNotMatch(sql, /\btruncate\b|\bdrop\s+table\s+core\./i);

  // Transactional: the operator can inspect the report and still abort.
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /on commit drop/i);
});

// --------------------------------------------------------------------------
// 4. The mirror link and resolution_status are ALWAYS cleared together.
// --------------------------------------------------------------------------

test("every mirror UPDATE clears the link and resolution_status together, never one alone", () => {
  const sql = buildRollbackSql(makeMappings());

  // Split the script into its UPDATE statements and inspect each one, rather
  // than string-matching the file as a whole — a whole-file match would pass if
  // one UPDATE cleared the link and a DIFFERENT one set the status, which is
  // exactly the 23514 failure this guard is for.
  const updates = [...sql.matchAll(/update\s+(plm\.\w+)\s+\w+\s+set\s+([\s\S]*?);/gi)];
  assert.equal(updates.length, 2, "expected exactly two mirror UPDATEs (licensor, property)");

  const seen = new Set();
  for (const [, table, body] of updates) {
    seen.add(table);
    const linkColumn = table === "plm.erp_licensor" ? "licensor_id" : "property_id";

    const clearsLink = new RegExp(`${linkColumn}\\s*=\\s*null`, "i").test(body);
    const clearsStatus = /resolution_status\s*=\s*'unresolved'/i.test(body);

    // Both, in the SAME statement. Either one alone violates
    // plm_erp_*_resolution_link_ck and aborts the whole rollback mid-incident.
    assert.ok(clearsLink, `${table} must null ${linkColumn}`);
    assert.ok(clearsStatus, `${table} must reset resolution_status alongside ${linkColumn}`);

    // The statement is scoped to the approved set, not the whole mirror table.
    assert.match(body, /in\s*\(select\s+source_id\s+from\s+approved_rollback\)/i);
    assert.match(body, /concat_ws\('\/',\s*e\.company_code,\s*e\.division_code,\s*e\.mg_type_code,\s*e\.mg_code\)/i);
  }
  assert.deepEqual([...seen].sort(), ["plm.erp_licensor", "plm.erp_property"]);

  // Guard FIRES, negative form: prove the assertion above can actually fail.
  // A hand-edited variant that clears the link without the status must be
  // caught by the same check the test just ran.
  const broken = sql.replace(/set licensor_id = null,\s*\n\s*resolution_status = 'unresolved'/, "set licensor_id = null");
  assert.notEqual(broken, sql, "the fixture edit must actually change the SQL");
  const brokenBody = /update\s+plm\.erp_licensor\s+\w+\s+set\s+([\s\S]*?);/i.exec(broken)[1];
  assert.ok(/licensor_id\s*=\s*null/i.test(brokenBody));
  assert.ok(
    !/resolution_status\s*=\s*'unresolved'/i.test(brokenBody),
    "the together-check must reject a link-only clear",
  );
});

// --------------------------------------------------------------------------
// Determinism — the operator must be able to diff two runs.
// --------------------------------------------------------------------------

test("the emitter is pure and deterministic", () => {
  const mappings = makeMappings();
  const before = JSON.stringify(mappings);
  const a = buildRollbackSql(mappings);
  const b = buildRollbackSql(makeMappings());
  assert.equal(a, b, "two runs over the same set must be byte-identical");
  assert.equal(JSON.stringify(mappings), before, "the input must not be mutated");
});
