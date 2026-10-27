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
import { randomUUID } from "node:crypto";
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
  // Prepack siblings (one staged row per component, same identity, distinct
  // hashes) are NOT versions: every row of the latest run is kept, ranked by
  // the run's started_at (a uuid run id has no time order).
  assert.doesNotMatch(versionWinners, /distinct on/);
  assert.match(versionWinners, /rank\(\) over \(partition by l\.sales_order_no, l\.sales_order_line_no\s*order by r\.started_at desc nulls last, l\.last_seen_run desc\) as run_rank/);
  assert.match(versionWinners, /left join coldlion\.sync_run r on r\.id = l\.last_seen_run/);
  assert.match(cteBlock(sql, "winning_lines"), /where w\.run_rank = 1/);
  // Component grain: one winner per (line number, master item, sub_item_no,
  // sub_label_code) across sibling rows, NULLS LAST on the identity keys.
  const components = sql.slice(sql.indexOf("winning_components as ("), sql.indexOf("ordinalled as ("));
  assert.match(components, /select distinct on \(wl\.sales_order_no, wl\.sales_order_line_no,\s*wl\.master_item_no, c\.sub_item_no, c\.sub_label_code\)/);
  assert.match(components, /order by wl\.sales_order_no, wl\.sales_order_line_no, wl\.master_item_no,\s*c\.sub_item_no asc nulls last, c\.sub_label_code asc nulls last,\s*c\.last_seen_run desc, wl\.line_source_hash, c\.component_source_hash/);
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

test("prepack siblings under one line number each keep their own slot, never collapsed to one (2026-10-23 PO 62012010)", () => {
  // ColdLion explodes a prepack line into one staged row per item under the
  // same (so, line, master_item_no). All rows of the latest run survive, and
  // the ordinal numbers items across the whole line number, so four items
  // mint four distinct source_ids instead of one winner.
  const secondTier = cteBlock(sql, "winning_lines");
  assert.match(secondTier, /from line_version_winners w/);
  assert.doesNotMatch(secondTier, /distinct on/);
  const ordinalled = cteBlock(sql, "ordinalled");
  assert.match(ordinalled, /partition by wc\.sales_order_no, wc\.sales_order_line_no/);
});

test("deterministic ordinal: row_number over (sub_item_no NULLS LAST, sub_label_code NULLS LAST), 1-based, in the source_id", () => {
  const ordinalled = sql.slice(sql.indexOf("ordinalled as ("), sql.indexOf("case_pack as ("));
  assert.match(ordinalled, /row_number\(\) over \(partition by wc\.sales_order_no, wc\.sales_order_line_no\s*order by wc\.master_item_no,\s*wc\.sub_item_no asc nulls last,\s*wc\.sub_label_code asc nulls last\) as component_ordinal/);
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
  assert.match(scope, /where n\.state in \('pending'\)/);
  // An explicit --order may re-process a created order (in-place correction).
  assert.match(singleSql, /where n\.state in \('pending', 'created'\)/);
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
  assert.match(entry, /if \(options\.write && !isClientSpawnFault\(error\) && !isClientUriFault\(error\)\)/);
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


test("division classification comes from the landed source identity and is persisted before scoped linking", () => {
  const canonical = cteBlock(sql, "canonical_lines");
  assert.match(canonical, /left join coldlion\.division d\s+on d\.company_code = wl\.company_code and d\.division_code = wl\.division_code/);
  assert.match(canonical, /case d\.division_desc/);
  assert.doesNotMatch(canonical, /when '(?:CW001|SP001|EH001)'/);
  const inserts = cteBlock(sql, "line_inserts");
  assert.match(inserts, /source_style_type,\s+master_data_match_status/);
  assert.match(inserts, /then 'unmatched' else 'not_applicable' end/);
  assert.match(cteBlock(sql, "line_updates"), /source_style_type = coalesce\(pl\.source_style_type, cl\.source_style_type\)/);
  assert.ok(WRITE_REQUIRED_CONSTRAINTS.some(c => c.table === "division" && c.definition === "PRIMARY KEY (company_code, division_code)"));
});

test("ordinary reimport preserves source and manual-link metadata and passes only exact scoped line IDs", () => {
  const updates = cteBlock(sql, "line_updates");
  assert.equal((updates.match(/coalesce\(pl\.metadata, '\{\}'::jsonb\) \|\| jsonb_build_object/g) || []).length, 2);
  const scope = cteBlock(sql, "link_scope");
  assert.match(scope, /select li\.id, li\.source_style_type, li\.sku, null, null, null/);
  assert.match(scope, /ref\.source_system = 'coldlion' and ref\.source_id = cl\.line_source_id/);
  assert.match(scope, /pl\.production_order_id = cl\.production_order_id/);
  assert.doesNotMatch(sql, /relink_dam_order_lines_bulk/);
});

test("unknown or conflicting divisions fail before commit, and all helper batches share the writer transaction", () => {
  const afterWrites = sql.slice(sql.indexOf("do $link_intake$"));
  assert.match(afterWrites, /s\.expected_type is null/);
  assert.match(afterWrites, /l\.source_style_type is distinct from s\.expected_type/);
  assert.match(afterWrites, /raise exception 'ColdLion intake division classification unknown or conflicts/);
  assert.match(afterWrites, /row_number\(\) over \(order by line_id\) - 1\) \/ 500/);
  assert.match(afterWrites, /receipt := public\.link_dam_order_lines_scoped\(batch\)/);
  assert.ok(afterWrites.indexOf("link_dam_order_lines_scoped(batch)") < afterWrites.indexOf("commit;"));
  assert.ok(drySql.indexOf("link_dam_order_lines_scoped(batch)") < drySql.indexOf("rollback;"));
  assert.match(buildWriterObjectAssertionSql(), /to_regprocedure\('public\.link_dam_order_lines_scoped\(uuid\[\]\)'\) is null/);
});

// Opt-in real SQL regression. The named disposable container has no network or
// published ports, and receives only generated synthetic fixtures; no credentials.
test("isolated PostgreSQL writer refreshes stale automatic links atomically", {
  skip: !process.env.COLDLION_INTAKE_TEST_PG_CONTAINER,
}, async (t) => {
  const container = process.env.COLDLION_INTAKE_TEST_PG_CONTAINER;
  assert.equal(container, "orderlist4886pg");
  const inspected = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
  assert.equal(inspected.status, 0);
  const isolated = JSON.parse(inspected.stdout)[0];
  assert.equal(isolated.HostConfig.NetworkMode, "none");
  assert.deepEqual(isolated.HostConfig.PortBindings, {});
  const run = (text, success = true) => {
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8" });
    if (success) assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const q = (text) => run(text).stdout.trim();
  const lit = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  const tag = randomUUID().slice(0, 8);
  const ids = Object.fromEntries(["run", "company", "oldItem", "newItem", "oldRow", "newRow"].map((key) => [key, randomUUID()]));
  const oldSku = `INTAKE-${tag}-OLD`, newSku = `INTAKE-${tag}-NEW`;
  const customer = `TEST-${tag}`, division = `LIC-${tag}`, route = `RT-${tag}`;
  q(`begin;
insert into coldlion.sync_run(id,endpoint,status,requested_by,started_at,finished_at) values('${ids.run}','/orderHistory','succeeded','synthetic-integration',now(),now());
insert into coldlion.division(company_code,division_code,division_desc,run_id,fetched_at,source_hash,first_seen_at,last_seen_at) values('POP','${division}','POP Creations (Licensed Products)','${ids.run}',now(),repeat('a',64),now(),now());
insert into core.customer(id,name) values('${ids.company}','Synthetic intake ${tag}');
insert into core.company_source_ref(company_id,source_system,source_table,source_id) values('${ids.company}','coldlion','customers','${customer}');
insert into plm.erp_customer(customer_code,name,active,customer_id) values('${customer}','Synthetic intake ${tag}',true,'${ids.company}');
insert into coldlion.routing_code_map(code,description,order_type,is_poe_ddp_family,ship_to) values('${route}','Synthetic route','FOB',false,'NJ');
insert into plm.item(id,item_number,name,source_system,source_id) values('${ids.oldItem}','${oldSku}','Synthetic old','integration_test','${tag}-old'),('${ids.newItem}','${newSku}','Synthetic new','integration_test','${tag}-new');
insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,sku,row_data) values('${ids.oldRow}','integration-${tag}','License.Style',1,'licensed','${oldSku}','{"test_report":false,"professional_photos":false}'),('${ids.newRow}','integration-${tag}','License.Style',2,'licensed','${newSku}','{"test_report":true,"professional_photos":true}');
insert into plm.style_tracker_item_bridge(style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,plm_item_id) values('${ids.oldRow}','integration-${tag}','License.Style','licensed','${ids.oldItem}'),('${ids.newRow}','integration-${tag}','License.Style','licensed','${ids.newItem}');
commit;`);
  const helper = q("select pg_get_functiondef('public.link_dam_order_lines_scoped(uuid[])'::regprocedure)");
  let sequence = 0;
  const write = (order, success = true) => run(buildWriteSql({ runId: randomUUID(), write: true, order }), success);
  const fixture = () => {
    const order = 800000000000 + Number.parseInt(tag, 16) * 100 + ++sequence;
    const staged = randomUUID();
    q(`insert into coldlion.intake_new_order(sales_order_no,warehouse_code,first_seen_run,last_seen_run) values(${order},'${route}','${ids.run}','${ids.run}');
insert into coldlion.intake_order_line(id,sales_order_no,sales_order_line_no,master_item_no,company_code,division_code,customer_code,line_qty,warehouse_code,line_source_hash,first_seen_run,last_seen_run,fetched_at) values('${staged}',${order},1,'${oldSku}','POP','${division}','${customer}',12,'${route}',repeat('b',64),'${ids.run}','${ids.run}',now());
insert into coldlion.intake_order_component(line_id,order_qty,component_source_hash,first_seen_run,last_seen_run,fetched_at) values('${staged}',12,repeat('c',64),'${ids.run}','${ids.run}',now());`);
    write(order);
    const source = `coldlion:so:${order}:line:1:component:1`;
    const where = `source_id=${lit(source)}`;
    assert.equal(q(`select item_id from plm.production_order_line where ${where}`), ids.oldItem);
    return { order, staged, where };
  };
  const snapshot = (f) => q(`select jsonb_build_object('header',(select to_jsonb(p) from plm.production_order p where p.source_id='coldlion:so-header:${f.order}'),'line',(select to_jsonb(l) from plm.production_order_line l where ${f.where}),'intake',(select to_jsonb(n) from coldlion.intake_new_order n where sales_order_no=${f.order}),'header_ref',(select to_jsonb(r) from plm.production_order_source_ref r where r.source_id='coldlion:so-header:${f.order}'),'line_ref',(select to_jsonb(r) from plm.production_order_line_source_ref r where r.source_id='coldlion:so:${f.order}:line:1:component:1'))`);
  const changeSku = (f, sku = newSku) => q(`update coldlion.intake_order_line set master_item_no=${lit(sku)} where id='${f.staged}'`);
  const state = (f) => JSON.parse(q(`select jsonb_build_object('item',item_id,'status',master_data_match_status,'metadata',metadata) from plm.production_order_line where ${f.where}`));
  await t.test("changed SKU refreshes exact new item and preserves append-only provenance; repeat is byte-identical", () => {
    const f = fixture(); changeSku(f); write(f.order);
    const after = state(f); assert.equal(after.item, ids.newItem); assert.equal(after.status, "matched");
    assert.equal(after.metadata.coldlion_intake_link_refreshes[0].prior_item_id, ids.oldItem);
    assert.equal(after.metadata.coldlion_intake_link_refreshes[0].prior_sku, oldSku);
    assert.equal(after.metadata.coldlion_intake_link_refreshes[0].prior_source_proof.master_item_no, oldSku);
    const firstReceipt = after.metadata.coldlion_intake_link_refreshes[0];
    changeSku(f, oldSku); write(f.order);
    const twice = state(f).metadata.coldlion_intake_link_refreshes;
    assert.equal(twice.length, 2); assert.deepEqual(twice[0], firstReceipt);
    const before = snapshot(f); write(f.order); assert.equal(snapshot(f), before);
  });
  await t.test("unchanged SKU wrong automatic item refreshes only to proved exact candidate", () => {
    const f = fixture(); q(`update plm.production_order_line set item_id='${ids.newItem}',metadata=metadata||'{"keep_me":"unchanged"}' where ${f.where}`);
    write(f.order); const after = state(f); assert.equal(after.item, ids.oldItem); assert.equal(after.metadata.keep_me, "unchanged");
    assert.equal(after.metadata.coldlion_intake_link_refreshes[0].reason, "stale_automatic_item");
  });
  await t.test("valid automatic, manual and not-applicable links remain byte-identical", () => {
    for (const status of ["matched", "manual", "not_applicable"]) {
      const f = fixture(); q(`update plm.production_order_line set master_data_match_status='${status}',metadata=metadata||'{"manual_evidence":"retain"}' where ${f.where}`);
      const before = snapshot(f); write(f.order); assert.equal(snapshot(f), before);
      if (status !== "matched") { changeSku(f); write(f.order); assert.equal(state(f).item, ids.oldItem); assert.equal(state(f).status, status); }
    }
  });
  await t.test("new SKU alias to same unique item preserves link receipts even with conflicting workflow", () => {
    const f = fixture(), row = randomUUID(), alias = `ALIAS-${tag}`;
    q(`insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,sku,row_data) values('${row}','integration-${tag}','License.Style',999,'licensed','${alias}','{"test_report":true,"professional_photos":true}'); insert into plm.style_tracker_item_bridge(style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,plm_item_id) values('${row}','integration-${tag}','License.Style','licensed','${ids.oldItem}');`);
    const before = state(f); changeSku(f, alias); write(f.order);
    const after = state(f); assert.equal(after.item, before.item); assert.equal(after.status, before.status);
    assert.equal(after.metadata.last_relinked_at, before.metadata.last_relinked_at);
    assert.equal(after.metadata.coldlion_intake_link_refreshes, undefined);
    q(`delete from plm.style_tracker_item_bridge where style_tracker_row_id='${row}';delete from public.style_tracker_rows where id='${row}';`);
  });
  await t.test("post-CTE moved/rekeyed/source-SKU drift aborts and rolls back the exact cohort", () => {
    const destination = fixture();
    const destinationId = q(`select production_order_id from plm.production_order_line where ${destination.where}`);
    const destinationBefore = snapshot(destination);
    for (const drift of ["source_system='other-source'", "source_id=source_id||':moved'", "sku='CONCURRENT-SKU'", `production_order_id='${destinationId}'`]) {
      const f = fixture(); changeSku(f); const before = snapshot(f);
      const injected = buildWriteSql({runId: randomUUID(),write: true,order:f.order}).replace('do $link_intake$',`update plm.production_order_line set ${drift} where ${f.where};\ndo $link_intake$`);
      const result = run(injected, false); assert.notEqual(result.status,0);
      assert.match(result.stderr,/source authority changed under lock/);
      assert.equal(snapshot(f),before);
      assert.equal(snapshot(destination),destinationBefore);
    }
  });
  await t.test("changed SKU with no match clears obsolete automatic facts honestly", () => {
    const f = fixture(); changeSku(f, `ABSENT-${tag}`); write(f.order); assert.equal(state(f).item, null); assert.equal(state(f).status, "unmatched");
    const before = snapshot(f); write(f.order); assert.equal(snapshot(f), before);
  });
  await t.test("ambiguous and conflicting new SKUs clear old auto links; unchanged SKUs preserve existing links", () => {
    for (const variant of ["ambiguous", "conflicting", "absent"]) {
      const row = randomUUID(), other = randomUUID(), sku = `EX-${variant}-${tag}`;
      if (variant !== "absent") q(`insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,sku,row_data) values('${row}','integration-${tag}','License.Style',${10 + sequence},'licensed','${sku}','{"test_report":false,"professional_photos":false}'); insert into plm.style_tracker_item_bridge(style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,plm_item_id) values('${row}','integration-${tag}','License.Style','licensed','${ids.newItem}');`);
      if (variant === "ambiguous") q(`insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,sku,row_data) values('${other}','integration-${tag}','License.Style',${100 + sequence},'licensed','${sku}','{"test_report":false,"professional_photos":false}'); insert into plm.style_tracker_item_bridge(style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,plm_item_id) values('${other}','integration-${tag}','License.Style','licensed','${ids.oldItem}');`);
      // newItem already has true/true facts, so the additional false/false row
      // is a real current-workflow conflict for the single candidate.
      const f = fixture(); changeSku(f, sku); write(f.order);
      assert.equal(state(f).item, null); assert.equal(state(f).status, "unmatched");
      q(`update plm.production_order_line set item_id='${ids.oldItem}',master_data_match_status='matched' where ${f.where}`);
      const before = snapshot(f); write(f.order); assert.equal(snapshot(f), before);
      if (variant !== "absent") q(`delete from plm.style_tracker_item_bridge where style_tracker_row_id in ('${row}','${other}');delete from public.style_tracker_rows where id in ('${row}','${other}');`);
    }
  });
  await t.test("post-clear helper failure and candidate drift roll back source fields, old link, history and receipts", () => {
    for (const fault of ["failure", "drift"]) {
      const f = fixture(); changeSku(f); const before = snapshot(f);
      try {
        const cleared = "if exists(select 1 from plm.production_order_line where id=any(p_line_ids) and (item_id is not null or master_data_match_status<>'unmatched')) then raise exception 'verified subset was not cleared'; end if; ";
        if (fault === "failure") {
          q(`create or replace function public.link_dam_order_lines_scoped(p_line_ids uuid[]) returns jsonb language plpgsql as $$begin ${cleared} raise exception 'synthetic post-clear failure'; end$$`);
        } else {
          // Change the actual bridge candidate after caller prevalidation and
          // before the real helper's own candidate/facts read. The injected
          // bridge change must itself roll back with the complete intake.
          assert.match(helper, /\nbegin\n/);
          q(helper.replace(/\nbegin\n/, `\nbegin\n ${cleared} update plm.style_tracker_item_bridge set plm_item_id='${ids.oldItem}' where style_tracker_row_id='${ids.newRow}';\n`));
        }
        const result = write(f.order, false); assert.notEqual(result.status, 0); assert.match(result.stderr, fault === "failure" ? /synthetic post-clear failure/ : /verified link replacement changed or failed/);
        assert.equal(snapshot(f), before);
        assert.equal(q(`select plm_item_id from plm.style_tracker_item_bridge where style_tracker_row_id='${ids.newRow}'`), ids.newItem);
      } finally { q(helper); }
    }
  });
});
