// Offline tests for the ColdLion order-intake CANONICAL WRITER claim path
// (tools/coldlion-landing/lib/order-intake-write.mjs + order-intake-write.mjs
// — plan_coldlion_order_intake.md §9 C2 / Phase E). No secrets, no database,
// no network: the writer is SQL text built by a pure builder plus small pure
// helpers, so these tests pin the claim contract the settled rules lock —
// source-ref-only idempotency, the placeholder header key, winner selection,
// deterministic ordinals, and the things the writer must never do (§8). The
// Phase B suites already pin the poller; this file completes the Phase E set.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildWriteSql,
  buildWriteFailureSql,
  buildWriterObjectAssertionSql,
  parseWriteSummary,
  normalizePoNumber,
  placeholderHeaderNumber,
  headerSourceId,
  lineSourceId,
  WRITE_REQUIRED_TABLES,
  WRITE_REQUIRED_CONSTRAINTS,
  WRITE_REQUIRED_INDEXES,
  WRITE_REQUIRED_TRIGGERS,
  WRITE_REQUIRED_COLUMNS,
} from "./coldlion-landing/lib/order-intake-write.mjs";
import { parseArgs } from "./coldlion-landing/order-intake-write.mjs";
import { date } from "./coldlion-landing/lib/values.mjs";

const RUN = "11111111-2222-3333-4444-555555555555";
const sql = buildWriteSql({ runId: RUN, write: true });
const drySql = buildWriteSql({ runId: RUN, write: false });
const limitedSql = buildWriteSql({ runId: RUN, write: true, limit: 5 });
const singleSql = buildWriteSql({ runId: RUN, write: true, order: 47001 });

/** The SQL minus its `--` comment lines: assertions about what the statement
 * DOES must not be tripped (or satisfied) by prose that merely names the
 * rule. String literals here never contain a newline, so a line whose first
 * non-space characters are `--` is always a comment. */
function codeOnly(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

/** One top-level CTE block, from `<name> as (` to the start of the next CTE
 * (the ` as (` markers at column 0 are the top-level boundaries). */
function cteBlock(text, name) {
  const start = String(text).indexOf(`${name} as (`);
  assert.ok(start >= 0, `the SQL has no ${name} CTE`);
  const rest = String(text).slice(start + 1);
  const next = rest.search(/\n[a-z_]+ as \(/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("poNumber normalization: both padding shapes, raw preserved, all-zero/empty → null (Amazon stock keying)", () => {
  // Live-solved 2026-09-17: the ERP carries the same customer PO as a
  // 10-digit zero-padded value AND an ordinary 8-digit value.
  assert.equal(normalizePoNumber("0001234567"), "1234567");
  assert.equal(normalizePoNumber("87654321"), "87654321");
  // Identifiers keep letters; only leading zeros strip.
  assert.equal(normalizePoNumber("00ABC123"), "ABC123");
  // Empty and all-zero normalize to null: those are the Amazon stock orders
  // whose placeholder is keyed on salesOrderNo alone (§8).
  assert.equal(normalizePoNumber(""), null);
  assert.equal(normalizePoNumber("0"), null);
  assert.equal(normalizePoNumber("000"), null);
  assert.equal(normalizePoNumber(null), null);
  assert.equal(normalizePoNumber(undefined), null);
  // The SQL side computes the identical normalization for line metadata —
  // full whitespace trim at BOTH ends (exactly JS trim, including tabs and
  // newlines, not a space-only btrim — round-2 review M3) — and stores the
  // RAW text in customer_po_number (letters and leading zeros are the
  // customer's identifiers, preserved as text).
  assert.match(sql, /nullif\(ltrim\(regexp_replace\(wl\.po_number, '\^\[\[:space:\]\]\+\|\[\[:space:\]\]\+\$', '', 'g'\), '0'\), ''\) as po_number_normalized/);
  assert.match(sql, /cl\.po_number, cl\.assortment_id/);
});

test("winning-version selection: DISTINCT ON per identity with the two-key tiebreak on BOTH grains", () => {
  // Line grain, first tier: winning version of every staged line per
  // (sales_order_no, sales_order_line_no, master_item_no) = greatest
  // last_seen_run, then line_source_hash — exactly the two keys the Phase A
  // coldlion_intake_order_line_winner_idx declares, so two runs can never
  // mint different winners for the same logical line.
  const versionWinners = sql.slice(sql.indexOf("line_version_winners as ("), sql.indexOf("winning_lines as ("));
  assert.match(versionWinners, /select distinct on \(l\.sales_order_no, l\.sales_order_line_no, l\.master_item_no\)/);
  assert.match(versionWinners, /order by l\.sales_order_no, l\.sales_order_line_no, l\.master_item_no,\s*l\.last_seen_run desc, l\.line_source_hash/);
  // Component grain: same winner rule per (line_id, sub_item_no,
  // sub_label_code), with NULLS LAST on the identity keys so the direct
  // line's NULL-sub component is unambiguous.
  const components = sql.slice(sql.indexOf("winning_components as ("), sql.indexOf("ordinalled as ("));
  assert.match(components, /select distinct on \(c\.line_id, c\.sub_item_no, c\.sub_label_code\)/);
  assert.match(components, /order by c\.line_id, c\.sub_item_no asc nulls last, c\.sub_label_code asc nulls last,\s*c\.last_seen_run desc, c\.component_source_hash/);
  // Constancy: within one hash group the staging identity uniques hold the
  // projection constant (one row per identity+hash), so the writer MERGES
  // NOTHING and SUMS NOTHING — a version fork is resolved by winner
  // selection above, never by aggregation, and line_qty (a parent total
  // repeated on every exploded component) is never summed either.
  assert.doesNotMatch(codeOnly(sql), /sum\s*\(/i);
  // line_qty appears exactly as a metadata payload, never as a quantity: the
  // only values ever assigned to quantity_ordered are the canonical
  // component's own columns (cl.quantity_ordered, whose origin is
  // o.order_qty).
  assert.match(sql, /'line_qty', cl\.line_qty/);
  assert.match(codeOnly(sql), /quantity_ordered = cl\.quantity_ordered/);
  for (const line of codeOnly(sql).split("\n")) {
    if (/quantity_ordered\s*=/.test(line)) assert.doesNotMatch(line, /line_qty/);
  }
});

test("an item fork under one line number resolves to ONE line ref winner, never collides the source-id grammar (round-2 review H2)", () => {
  // master_item_no is part of the line projection, so a corrected item is a
  // new version whose per-item winner sits beside the old one. The ref
  // grammar coldlion:so:<so>:line:<n>:component:<ord> has ONE slot per line
  // number, so the second tier resolves the fork by the same two-key
  // tiebreak plus master_item_no — deterministically, never by quarantine,
  // and never two winners onto one source_id.
  const secondTier = cteBlock(sql, "winning_lines");
  assert.match(secondTier, /from line_version_winners w/);
  assert.match(secondTier, /select distinct on \(w\.sales_order_no, w\.sales_order_line_no\)/);
  assert.match(secondTier, /order by w\.sales_order_no, w\.sales_order_line_no,\s*w\.last_seen_run desc, w\.line_source_hash, w\.master_item_no/);
});

test("deterministic ordinal: row_number over (sub_item_no NULLS LAST, sub_label_code NULLS LAST), 1-based, in the source_id", () => {
  const ordinalled = sql.slice(sql.indexOf("ordinalled as ("), sql.indexOf("case_pack as ("));
  assert.match(ordinalled, /row_number\(\) over \(partition by wc\.line_id\s*order by wc\.sub_item_no asc nulls last,\s*wc\.sub_label_code asc nulls last\) as component_ordinal/);
  // The ordinal rides the deterministic line source ref verbatim.
  assert.match(sql, /'coldlion:so:' \|\| wl\.sales_order_no::text \|\| ':line:'\s*\|\| wl\.sales_order_line_no::text \|\| ':component:'\s*\|\| o\.component_ordinal::text as line_source_id/);
  // One canonical line per winning component — the join is ordinalled, never
  // aggregated, and the prepack/direct rules both resolve the sku through
  // COALESCE(NULLIF(sub_item_no,''), master_item_no).
  assert.match(sql, /coalesce\(nullif\(btrim\(o\.sub_item_no\), ''\), wl\.master_item_no\) as sku/);
  // Prepack component → assortment_id = master_item_no + the stable ordinal;
  // direct line → assortment_id NULL and no assortment ordinal column value.
  assert.match(sql, /case when nullif\(btrim\(o\.sub_item_no\), ''\) is not null\s*then wl\.master_item_no end as assortment_id/);
  assert.match(sql, /case when nullif\(btrim\(o\.sub_item_no\), ''\) is not null\s*then o\.component_ordinal end as assortment_component_ordinal/);
  // Pure helpers agree with the SQL grammar.
  assert.equal(lineSourceId(47001, 2, 3), "coldlion:so:47001:line:2:component:3");
});

test("source-ref-only idempotency: miss → create placeholder; the check is exactly the coldlion header ref", () => {
  const headerRef = sql.slice(sql.indexOf("header_ref as ("), sql.indexOf("claim_failure as ("));
  // The ONE claim key: source_system='coldlion' + source_id='coldlion:so-header:<so>'.
  assert.match(headerRef, /r\.source_system = 'coldlion'/);
  assert.match(headerRef, /r\.source_id = 'coldlion:so-header:' \|\| s\.sales_order_no::text/);
  // Miss → the placeholder insert, guarded by the same ref's absence.
  const newHeaders = sql.slice(sql.indexOf("new_headers as ("), sql.indexOf("all_headers as ("));
  assert.match(newHeaders, /insert into plm\.production_order\b/);
  assert.match(newHeaders, /where not exists \(\s*select 1 from header_ref h where h\.sales_order_no = c\.sales_order_no\)/);
  // Nothing else is a claim path: the header-claim CTE carries no customer-PO
  // predicate and no production_order_number match — its only join keys are
  // the coldlion source_system and the deterministic header source_id.
  assert.doesNotMatch(codeOnly(headerRef), /po_number|production_order_number\s*=/);
  // And no JOIN or WHERE line anywhere predicates a po_number against
  // anything: customer-PO matching is not a claim path at intake (checked
  // line-scoped — the pin is about predicates, not about the word occurring
  // anywhere between two semicolons).
  for (const whole of [sql, drySql]) {
    for (const line of codeOnly(whole).split("\n")) {
      assert.doesNotMatch(line, /\b(on|where)\b[^)]*\bpo_number\b/);
    }
  }
});

test("multi-match on customer PO alone is expected under 1:N and is NEVER a quarantine reason", () => {
  // Quarantine happens only on an unresolvable customer, a customer
  // disagreement, or a non-placeholder claim failure — the three reasons the
  // Phase A table documents. A customer-PO multi-match is not a lookup this
  // writer performs at all, so no fixture can make it quarantine.
  const reasons = [...codeOnly(sql).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  const quarantineReasons = new Set(reasons.filter((r) => /^(customer|claim)-/.test(r)));
  assert.deepEqual([...quarantineReasons].sort(), ["claim-failure", "customer-disagreement", "customer-unresolvable"]);
  assert.doesNotMatch(codeOnly(sql), /po[-_ ]?(multi|match)|multi[-_ ]?po/i);
  // And the customer lookup keys are customerCode-based only.
  assert.match(sql, /r\.source_table = 'customers'/);
  assert.match(sql, /r\.source_id = wl\.customer_code/);
});

test("version fan-out resolves by winner selection, never quarantines, and the run stays bounded", () => {
  // A cross-version fork (two hashes under one identity prefix) is the exact
  // case the version identity exists for: the fork is resolved by the
  // DISTINCT ON winner, and no quarantine insert keys on a source hash. The
  // three quarantine blocks' predicates name a reason and a sales order,
  // never a hash. (Round-1 review M4 asked where the plan's constancy rule
  // lives: within one hash group the staging identity uniques —
  // unique nulls not distinct (identity..., hash) — make variation
  // structurally impossible, one row per identity+hash; C2 asserts those
  // constraints by name and definition in the pre-flight object assertion
  // instead of re-quarantining what cannot exist.)
  for (const name of ["claim_failure", "unresolvable", "disagreement"]) {
    assert.doesNotMatch(codeOnly(cteBlock(sql, name)), /hash/);
  }
  // The bounded enablement vocabulary (plan B0): --limit bounds the pending
  // orders this run may claim, deterministically by ascending sales order.
  const scope = sql.slice(sql.indexOf("scope as ("), sql.indexOf("winning_lines as ("));
  assert.match(scope, /where n\.state = 'pending'/);
  assert.match(limitedSql, /order by n\.sales_order_no\s*\n\s*limit 5/);
  assert.doesNotMatch(sql, /\n\s*limit 5/);
  // --order targets exactly one sales order (the preview-gate shape).
  assert.match(singleSql, /and n\.sales_order_no = 47001/);
  assert.doesNotMatch(sql, /and n\.sales_order_no = 47001/);
});

test("idempotent second run: state leaves pending and every UPDATE is guarded by IS DISTINCT FROM (zero rows changed)", () => {
  // Once created, the order leaves the pending state, so a second --write
  // run processes nothing; and even a re-pended order updates ZERO rows when
  // nothing differs — plm.production_order(_line) carry a set_updated_at
  // BEFORE UPDATE trigger, so an unguarded same-value update would still
  // move updated_at and break the second-run no-op proof.
  const headerUpdates = sql.slice(sql.indexOf("header_updates as ("), sql.indexOf("line_updates as ("));
  assert.match(headerUpdates, /\(p\.production_order_number, p\.company_id, p\.metadata\) is distinct from/);
  const lineUpdates = sql.slice(sql.indexOf("line_updates as ("), sql.indexOf("created as ("));
  assert.match(lineUpdates, /is distinct from/);
  assert.match(lineUpdates, /and pl\.production_order_id = cl\.production_order_id/);
  // line_number is corrected with the rest (round-3 review #9): a drifted
  // value cannot persist against a source_id that encodes the line number.
  assert.match(lineUpdates, /set production_order_id = cl\.production_order_id,\s*line_number = cl\.sales_order_line_no::text/);
  assert.match(lineUpdates, /pl\.line_number, pl\.sku, pl\.quantity_ordered,/);
  const created = sql.slice(sql.indexOf("created as ("), sql.indexOf("quarantined as ("));
  assert.match(created, /where n\.state = 'pending'/);
  // The insert paths are idempotent behind their ref checks, and the ref
  // inserts ride ON CONFLICT DO NOTHING — no ref row is ever updated.
  assert.match(sql, /on conflict \(source_system, source_id\) do nothing/);
  assert.doesNotMatch(sql, /update plm\.production_order(_line)?_source_ref/);
});

test("a dry run records NOTHING anywhere: the failure recorder is write-mode only (round-3 review #10)", () => {
  // Without --write the whole transaction rolls back; a post-rollback parse
  // failure must not insert a failed sync_run row — that would be a write on
  // a dry run. The guard lives in the entry point's catch block.
  const entry = readFileSync(new URL("./coldlion-landing/order-intake-write.mjs", import.meta.url), "utf8");
  assert.match(entry, /if \(options\.write && !isClientSpawnFault\(error\)\)/);
});

test("EP001 exclusion: the claim path filters division_code again, defence in depth", () => {
  // EP001 was filtered at ingestion AND refused by the staging check
  // constraint (plan §8); the writer asserts it once more so a future
  // constraint relaxation can never write Edgeucational rows canonically.
  const lines = sql.slice(sql.indexOf("line_version_winners as ("), sql.indexOf("winning_lines as ("));
  assert.match(lines, /where l\.division_code is distinct from 'EP001'/);
});

test("1900-01-01 → NULL: staging nulls the ERP empty marker and the writer stores dates verbatim", () => {
  // values.mjs date() is the staged projection's rule (EMPTY_DATE_MARKER and
  // anything earlier become NULL before the row lands); the writer never
  // re-parses or coerces dates.
  assert.equal(date("1900-01-01"), null);
  assert.equal(date("1899-12-31"), null);
  assert.equal(date("2026-10-02"), "2026-10-02");
  assert.match(sql, /cl\.start_date, cl\.cancel_date,/);
  assert.match(sql, /start_ship_date = cl\.start_date/);
  assert.doesNotMatch(sql, /to_date|coalesce\s*\(\s*cl\.start_date|coalesce\s*\(\s*cl\.cancel_date/);
});

test("negative quantity preserved: quantity_ordered = order_qty verbatim, never floored, abs'd, or coalesced", () => {
  // order_qty is the per-SKU quantity ColdLion computes (the 2026-08-31
  // addition the plan says to use); a cancellation arrives negative and must
  // land negative.
  assert.match(sql, /o\.order_qty as quantity_ordered/);
  assert.match(sql, /cl\.quantity_ordered, cl\.sales_person_code1/);
  assert.doesNotMatch(sql, /greatest\s*\(\s*[^)]*quantity|abs\s*\(\s*[^)]*order_qty|coalesce\s*\(\s*o\.order_qty/);
});

test("is_primary placement: exactly one header ref and one ref per line, coldlion-only", () => {
  const headerRefs = sql.slice(sql.indexOf("header_refs as ("), sql.indexOf("header_updates as ("));
  assert.match(headerRefs, /insert into plm\.production_order_source_ref/);
  assert.match(headerRefs, /select nh\.id, 'coldlion', nh\.source_id, true/);
  const lineRefs = sql.slice(sql.indexOf("line_refs as ("), sql.indexOf("header_refs as ("));
  assert.match(lineRefs, /insert into plm\.production_order_line_source_ref/);
  assert.match(lineRefs, /select li\.id, 'coldlion', li\.source_id, true/);
  // Google refs stay untouched: no write path names them and no ref row is
  // ever updated or deleted (overwriting a Google ref with a Coldlion ref is
  // forbidden, 20260810010000:222-223). Checked against the code only — the
  // comments explain the rule and must not satisfy (or trip) the pin.
  assert.doesNotMatch(codeOnly(sql), /google_order_list/);
  assert.doesNotMatch(sql, /delete from plm\.production_order(_line)?_source_ref/);
});

test("placeholder header key: COLDLION-SO-<so>, never COLDLION-SO-0, guarded update-only-placeholder", () => {
  assert.equal(placeholderHeaderNumber(47001), "COLDLION-SO-47001");
  assert.throws(() => placeholderHeaderNumber(0), /never mint COLDLION-SO-0/);
  assert.throws(() => placeholderHeaderNumber(-1), /never mint COLDLION-SO-0/);
  assert.throws(() => placeholderHeaderNumber("47001"), /placeholder header requires a positive salesOrderNo/);
  assert.equal(headerSourceId(47001), "coldlion:so-header:47001");
  assert.throws(() => headerSourceId(0), /never mint/);
  assert.throws(() => lineSourceId(0, 1, 1), /never mint/);
  assert.throws(() => lineSourceId(47001, 1, 0), /1-based component ordinal/);
  // The metadata origin stamp and the SQL-side guard: the UPDATE path (and
  // only the UPDATE path) touches production_order_number, and only under
  // the placeholder-origin predicate; a non-placeholder header is refused by
  // the claim-failure quarantine instead.
  assert.match(sql, /'production_order_number_origin', 'coldlion_intake_placeholder'/);
  const headerUpdates = sql.slice(sql.indexOf("header_updates as ("), sql.indexOf("line_updates as ("));
  assert.match(headerUpdates, /set production_order_number = 'COLDLION-SO-' \|\| c\.sales_order_no::text/);
  assert.match(headerUpdates, /p\.metadata ->> 'production_order_number_origin' = 'coldlion_intake_placeholder'/);
  const claimFailure = sql.slice(sql.indexOf("claim_failure as ("), sql.indexOf("unresolvable as ("));
  assert.match(claimFailure, /'claim-failure', hr\.sales_order_no/);
  assert.match(claimFailure, /hr\.origin is distinct from 'coldlion_intake_placeholder'/);
  // salesOrderNo = 0 is refused before any SQL is built and asserted again
  // in the scope (the table check already refuses it).
  assert.throws(() => buildWriteSql({ runId: RUN, order: 0 }), /salesOrderNo = 0 is never written/);
  assert.match(sql, /and n\.sales_order_no <> 0/);
});

test("customer resolution: company_source_ref FIRST then erp_customer (active), misses and disagreements quarantine, core.customer is never inserted", () => {
  // FIRST: core.company_source_ref by (coldlion, customers, customerCode).
  const customerRef = sql.slice(sql.indexOf("customer_ref as ("), sql.indexOf("customer_erp as ("));
  assert.match(customerRef, /join core\.company_source_ref r/);
  assert.match(customerRef, /r\.source_system = 'coldlion'/);
  assert.match(customerRef, /r\.source_table = 'customers'/);
  assert.match(customerRef, /r\.source_id = wl\.customer_code/);
  // SECOND: plm.erp_customer by natural key REQUIRING active = true and a
  // promoted customer_id.
  const customerErp = sql.slice(sql.indexOf("customer_erp as ("), sql.indexOf("order_codes as ("));
  assert.match(customerErp, /join plm\.erp_customer e/);
  assert.match(customerErp, /e\.customer_code = wl\.customer_code/);
  assert.match(customerErp, /and e\.active/);
  assert.match(customerErp, /where e\.customer_id is not null/);
  // The priority is the coalesce order: ref before erp.
  assert.match(sql, /coalesce\(cr\.company_id, ce\.company_id\)/);
  // Miss → customer-unresolvable; disagreement (either lookup ambiguous, the
  // order's lines split codes, or the two resolve different companies) →
  // customer-disagreement. Never a silent pick, never a new company.
  assert.match(sql, /'customer-unresolvable'/);
  assert.match(sql, /'customer-disagreement'/);
  assert.doesNotMatch(sql, /insert into core\.customer\b/);
  assert.doesNotMatch(sql, /insert into core\.company_source_ref/);
});

test("case pack default: full item_detail predicate with the item_pkey uniqueness assertion before use", () => {
  // Plan A2: item_detail's primary key is (company_code, division_code,
  // item_no, item_pkey); the lookup names the full predicate and asserts one
  // item_pkey per item_no BEFORE using carton_qty — ambiguous or missing
  // lookups leave case_pack NULL, never a silent pick.
  const casePack = sql.slice(sql.indexOf("case_pack as ("), sql.indexOf("customer_ref as ("));
  assert.match(casePack, /join coldlion\.item_detail d/);
  assert.match(casePack, /d\.company_code = l\.company_code/);
  assert.match(casePack, /d\.division_code = l\.division_code/);
  assert.match(casePack, /d\.item_no = coalesce\(nullif\(btrim\(c\.sub_item_no\), ''\), l\.master_item_no\)/);
  assert.match(casePack, /having count\(distinct d\.item_pkey\) = 1/);
  // order_depth_inches stays NULL: Albert's 2026-09-17 input-column list
  // omits col 18 and the writer must not "complete" it.
  assert.doesNotMatch(sql, /order_depth_inches/);
});

test("one transaction, dry-run rolls back, live commits, the sealed ledger is never touched", () => {
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.doesNotMatch(sql, /rollback;/);
  assert.match(drySql, /rollback;\s*$/);
  assert.doesNotMatch(drySql, /commit;/);
  for (const whole of [sql, drySql]) {
    assert.doesNotMatch(whole, /window_ledger/);
    assert.doesNotMatch(whole, /order_history_line|order_history_component|prod_history/);
    assert.doesNotMatch(whole, /recordFailure/);
  }
  // The run row reuses coldlion.sync_run (§8) with NO window — the writer
  // fetches nothing, so window_from/window_to stay unset (both or neither).
  assert.match(sql, /insert into coldlion\.sync_run/);
  assert.doesNotMatch(sql, /window_from/);
  assert.doesNotMatch(sql, /intake_window_state/);
});

test("the failure recorder is the §8 sibling: failed sync_run + alert, no ledger, no window state", () => {
  const failure = buildWriteFailureSql({ runId: RUN, error: new Error("synthetic failure") });
  assert.match(failure, /'failed', 'coldlion-order-intake'/);
  assert.match(failure, /pg_notify\('coldlion_sync_alert'/);
  assert.match(failure, /synthetic failure/);
  assert.doesNotMatch(failure, /window_ledger/);
  assert.doesNotMatch(failure, /intake_window_state/);
  assert.doesNotMatch(failure, /update coldlion\.sync_run/);
  // Round-1 review L4: a failure AFTER commit finds the run's succeeded row
  // already present; the conflict path appends the post-commit failure to
  // notes instead of silently recording nothing or lying that the write
  // failed.
  assert.match(failure, /on conflict \(id\) do update/);
  assert.match(failure, /post-commit failure/);
});

test("a doubly-quarantined order records ONE deterministic reason: claim-failure wins (round-1 review M2)", () => {
  // The claim-failure axis (header ref on a non-placeholder) and the customer
  // axis are independent; both quarantine rows stay visible, but the state
  // row's claim_evidence must never depend on which union row Postgres
  // happens to match — the customer axis excludes orders that already claim-
  // failed, so exactly one r row can match any order.
  const quarantined = sql.slice(sql.indexOf("quarantined as ("), sql.indexOf("run_counts as ("));
  assert.match(
    quarantined,
    /where quarantine_reason is not null\s*and sales_order_no not in \(select sales_order_no from claim_failure\)\s*union all\s*select sales_order_no, 'claim-failure' from claim_failure/,
  );
});

test("the write-path object assertion names every table, constraint, index and column the writer rides", () => {
  const assertion = buildWriterObjectAssertionSql();
  for (const name of WRITE_REQUIRED_TABLES) {
    const [schema, table] = name.split(".");
    assert.ok(assertion.includes(`('${schema}', '${table}')`), `missing table ${name}`);
  }
  // Constraints are verified against their EXACT relation AND their
  // pg_get_constraintdef text, never by name alone (round-1 review M1 + the
  // Phase B round-3 M-1 rule): the ref-table uniques the idempotency design
  // rides, the legacy canonical uniques the inserts touch, and the staging
  // identity uniques that make within-hash-group constancy structural.
  for (const entry of WRITE_REQUIRED_CONSTRAINTS) {
    assert.ok(
      assertion.includes(`('${entry.schema}', '${entry.table}', '${entry.conname}', '${entry.definition}')`),
      `missing constraint row ${entry.conname}`,
    );
  }
  // Indexes are SHAPES, not names (round-2 review H1): each index row carries
  // its full expected pg_get_indexdef text and the assertion compares it, so
  // a same-named index over different columns — or with the partial
  // predicate dropped — fails the pre-flight. The four definitions are
  // anchored here against the migrations that declare them, independently of
  // the constants file.
  for (const entry of WRITE_REQUIRED_INDEXES) {
    assert.ok(
      assertion.includes(`('${entry.schema}', '${entry.name}', '${entry.definition}')`),
      `missing index row ${entry.name}`,
    );
  }
  assert.match(assertion, /pg_catalog\.pg_get_indexdef\(c\.oid\) = i\.def/);
  assert.ok(WRITE_REQUIRED_INDEXES.some((e) => e.name === "coldlion_intake_order_line_winner_idx" && e.definition.includes("last_seen_run DESC, line_source_hash")));
  assert.ok(WRITE_REQUIRED_INDEXES.some((e) => e.name === "production_order_source_ref_primary_uidx" && e.definition.endsWith("WHERE is_primary")));
  // The set_updated_at BEFORE UPDATE ROW triggers on both canonical tables,
  // verified by exact pg_get_triggerdef text AND enabled state (round-3
  // review #4) — a same-named AFTER/statement/disabled trigger refuses.
  assert.match(assertion, /g\.tgname = t\.tgname/);
  assert.match(assertion, /g\.tgenabled = 'O'/);
  assert.match(assertion, /pg_catalog\.pg_get_triggerdef\(g\.oid\) = t\.def/);
  for (const entry of WRITE_REQUIRED_TRIGGERS) {
    assert.ok(entry.definition.startsWith("CREATE TRIGGER set_updated_at BEFORE UPDATE ON "), `trigger ${entry.table} must be a BEFORE UPDATE trigger`);
    assert.ok(entry.definition.includes(" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()"));
  }
  assert.equal(WRITE_REQUIRED_TRIGGERS.length, 2);
  // The columns the module writes AND reads: typed entries additionally pin
  // information_schema.data_type (round-3 review #3), and the staging read
  // columns come from the Phase B specs — the single source of truth.
  for (const entry of WRITE_REQUIRED_COLUMNS) {
    assert.ok(
      assertion.includes(`('${entry.schema}', '${entry.table}', '${entry.column}', ${entry.type ? `'${entry.type}'` : "null"})`),
      `missing column row ${entry.column}`,
    );
  }
  assert.match(assertion, /c\.column_name = k\.column_name/);
  assert.match(assertion, /k\.type_name is null or c\.data_type = k\.type_name/);
  const ordinalEntry = WRITE_REQUIRED_COLUMNS.find((e) => e.column === "assortment_component_ordinal");
  assert.equal(ordinalEntry.type, "integer");
  assert.ok(WRITE_REQUIRED_COLUMNS.some((e) => e.table === "intake_order_line" && e.column === "po_number"));
  assert.ok(WRITE_REQUIRED_COLUMNS.some((e) => e.table === "intake_new_order" && e.column === "state_changed_at"));
  // Read-only shape: no line STARTS a data-modifying statement (the word
  // "CREATE" appears inside the expected-definition literals, which are data,
  // not statements).
  assert.doesNotMatch(assertion, /^\s*(insert|update|delete|grant|create|drop|alter)\b/im);
  assert.match(assertion, /as missing_objects/);
});

test("parseWriteSummary reads the aligned psql shape (7 columns) and refuses unreadable output", () => {
  const aligned = [
    "BEGIN",
    "INSERT 0 1",
    " orders_created | orders_quarantined | headers_inserted | headers_updated | lines_inserted | lines_updated | orders_left_pending",
    "----------------+--------------------+-------------------+----------------+----------------+--------------+--------------------",
    "              2 |                  1 |                 2 |              0 |              5 |            0 |                  0",
    "(1 row)",
    "COMMIT",
  ].join("\n");
  const expected = {
    orders_created: 2,
    orders_quarantined: 1,
    headers_inserted: 2,
    headers_updated: 0,
    lines_inserted: 5,
    lines_updated: 0,
    orders_left_pending: 0,
  };
  assert.deepEqual(parseWriteSummary(aligned), expected);
  assert.deepEqual(parseWriteSummary("2\t1\t2\t0\t5\t0\t0"), expected);
  assert.deepEqual(parseWriteSummary("0\t0\t0\t0\t0\t0\t0"), { ...expected, orders_created: 0, orders_quarantined: 0, headers_inserted: 0, lines_inserted: 0 });
  // A NaN count would silently corrupt the run summary; garbage REFUSES.
  assert.throws(() => parseWriteSummary("no rows"), /no parseable summary row/);
  assert.throws(() => parseWriteSummary(""), /no parseable summary row/);
  assert.throws(() => parseWriteSummary(undefined), /no parseable summary row/);
  assert.throws(() => parseWriteSummary("2\t1\t2\t0\t5\tx\t0"), /no parseable summary row/);
  assert.throws(() => parseWriteSummary("2\t1\t2\t0\t5\t0"), /no parseable summary row/);
});

test("entry-point parseArgs keeps the B0 vocabulary, and importing the writer does not run it", () => {
  assert.deepEqual(parseArgs([]), { write: false, limit: null, order: null });
  assert.deepEqual(parseArgs(["--write"]), { write: true, limit: null, order: null });
  assert.deepEqual(parseArgs(["--write", "--limit", "5"]), { write: true, limit: 5, order: null });
  assert.equal(parseArgs(["--order", "47001"]).order, 47001);
  // salesOrderNo = 0 is refused at the argument layer too.
  assert.throws(() => buildWriteSql({ runId: RUN, limit: 0 }), /limit must be a positive integer/);
  // Reaching this line proves the import at the top is side-effect free (the
  // Phase B round-4 L-4 lesson: main() runs only on direct execution).
  assert.ok(true);
});

test("the entry point REFUSES bad arguments before touching anything (exit 2, round-1 review L3)", () => {
  // parseArgs validates before main() proves any target, so these run offline
  // with no env: --order 0, a non-integer limit, and an unknown flag each
  // exit 2 with the reason on stderr — never COLDLION-SO-0, never a write.
  const self = fileURLToPath(new URL("./coldlion-landing/order-intake-write.mjs", import.meta.url));
  const invoke = (args) => spawnSync(process.execPath, [self, ...args], { encoding: "utf8" });
  for (const [args, pattern] of [
    [["--order", "0"], /must be a positive sales order number/],
    [["--limit", "0"], /must be a positive integer/],
    [["--limit", "x"], /must be a positive integer/],
    [["--bogus"], /unknown argument --bogus/],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 2, `expected exit 2 for ${args.join(" ")}`);
    assert.match(result.stderr, pattern);
  }
});

test("the run refuses an invalid run id and the SQL never widens its own scope", () => {
  assert.throws(() => buildWriteSql({ runId: "not-a-uuid" }), /requires a UUID run id/);
  // Only pending orders are ever touched; claimed/created/quarantined rows
  // stay exactly as they are.
  const quarantined = sql.slice(sql.indexOf("quarantined as ("), sql.indexOf("run_counts as ("));
  assert.match(quarantined, /n\.state = 'pending'/);
  // The state vocabulary the Phase A table allows, verbatim.
  assert.match(sql, /set state = 'created', state_changed_at = now\(\)/);
  assert.match(sql, /set state = 'quarantined', state_changed_at = now\(\)/);
});
