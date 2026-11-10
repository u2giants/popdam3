// Behavioural test of the distro-replaces-bulk step
// (coldlion-landing/lib/order-intake-distro.mjs) against an isolated
// PostgreSQL 17 (COLDLION_WRITER_TEST_CONTAINER). Replays Lidl D3651 on
// 2026-11-10: one Google bulk line per style, three ColdLion distro sales
// orders (7128093/94/95) carrying production reference D3651.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { buildDistroReplaceSql, DISTRO_VOID_REASON } from "./coldlion-landing/lib/order-intake-distro.mjs";

const container = process.env.COLDLION_WRITER_TEST_CONTAINER;
const DB = "coldlion_distro_test";
const RUN = () => crypto.randomUUID();

function psql(sql, db = DB) {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", db,
    "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "|"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

const SCHEMA = `
create schema coldlion; create schema plm;
create table coldlion.sync_run (id uuid primary key, endpoint text, company_code text, request_params jsonb,
  status text, requested_by text, started_at timestamptz, finished_at timestamptz, error_message text, notes text);
create table coldlion.order_history_line (id uuid primary key default gen_random_uuid(), sales_order_no bigint,
  sales_order_line_no integer, prod_reference_no text, fetched_at timestamptz default now(), created_at timestamptz default now());
create table plm.production_order (id uuid primary key default gen_random_uuid(), production_order_number text,
  voided_at timestamptz, metadata jsonb not null default '{}');
create table plm.production_order_line (id uuid primary key default gen_random_uuid(), production_order_id uuid,
  sku text, quantity_ordered numeric, customer_po_number text, metadata jsonb, voided_at timestamptz,
  void_reason text, status text, updated_at timestamptz);
create table plm.production_order_line_source_ref (id uuid primary key default gen_random_uuid(),
  production_order_line_id uuid references plm.production_order_line (id), source_system text,
  source_id text, is_primary boolean, unique (source_system, source_id));
`;

function header(number, placeholder = false) {
  return `insert into plm.production_order (production_order_number, metadata)
    select '${number}', ${placeholder ? `'{"production_order_number_origin":"coldlion_intake_placeholder"}'` : "'{}'"}
    where not exists (select 1 from plm.production_order where production_order_number='${number}');\n`;
}

function googleLine(number, sku, row, po = null) {
  return header(number) + `with l as (insert into plm.production_order_line (production_order_id, sku, customer_po_number)
    select id, '${sku}', ${po ? `'${po}'` : "null"} from plm.production_order where production_order_number='${number}' returning id)
  insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
  select id, 'google_order_list', 'order:row:${row}:component:1:${sku}', true from l;\n`;
}

function distroLine(so, line, component, sku, qty, ref) {
  const number = `COLDLION-SO-${so}`;
  return header(number, true) + `with l as (insert into plm.production_order_line (production_order_id, sku, quantity_ordered, customer_po_number)
    select id, '${sku}', ${qty}, 'PO${so}' from plm.production_order where production_order_number='${number}' returning id)
  insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
  select id, 'coldlion', 'coldlion:so:${so}:line:${line}:component:${component}', true from l;
  insert into coldlion.order_history_line (sales_order_no, sales_order_line_no, prod_reference_no)
  select ${so}, ${line}, '${ref}' where not exists (select 1 from coldlion.order_history_line where sales_order_no=${so} and sales_order_line_no=${line});\n`;
}

test("distro SQL preserves explicit separation and production linkage", () => {
  const sql = buildDistroReplaceSql({ runId: RUN() });
  assert.match(sql, /coalesce\(pl.metadata ->> 'coldlion_kept_separate', ''\) <> 'true'/);
  assert.match(sql, /r.source_id ~ '\^coldlion:\(so\|prod\):'/);
  assert.match(sql, /where gk.po_blank or dk.sos >= 2/);
  assert.match(sql, /rollback;$/);
  assert.match(buildDistroReplaceSql({ runId: RUN(), write: true }), /commit;$/);
});

test("distro sales orders replace the Google bulk line", { skip: !container }, () => {
  spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-c", `drop database if exists ${DB}`]);
  spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-c", `create database ${DB}`]);
  let seed = SCHEMA;
  // Lidl D3651: bulk Google lines, blank PO; three distro orders.
  seed += googleLine("D3651", "VDC83DYMM14", 12562);
  seed += googleLine("D3651", "VDC83DYMM15", 12562);
  for (const [so, qty] of [[7128093, 342], [7128094, 797], [7128095, 336]]) {
    seed += distroLine(so, 1, 1, "VDC83DYMM14", qty, "d3651 ");
    seed += distroLine(so, 1, 2, "VDC83DYMM15", qty, "D3651");
  }
  // One sales order against a Google line that has its own different PO: not a distro case.
  seed += googleLine("D9000", "SINGLE01", 9000, "OTHERPO");
  seed += distroLine(7200000, 1, 1, "SINGLE01", 10, "D9000");
  // Two Google lines for one key: ambiguous, left alone.
  seed += googleLine("D9100", "TWICE01", 9100);
  seed += googleLine("D9100", "TWICE01", 9101);
  seed += distroLine(7300000, 1, 1, "TWICE01", 5, "D9100");
  seed += distroLine(7300001, 1, 1, "TWICE01", 6, "D9100");
  // Multiple sales orders also replace a bulk line with a nonblank PO.
  seed += googleLine("D9200", "MULTI01", 9200, "BULKPO");
  seed += distroLine(7400000, 1, 1, "MULTI01", 5, "D9200");
  seed += distroLine(7400001, 1, 1, "MULTI01", 6, "D9200");
  // A human keep-separate decision survives even with an eligible blank-PO bulk.
  seed += googleLine("D9300", "KEPT01", 9300);
  seed += distroLine(7500000, 1, 1, "KEPT01", 7, "D9300");
  seed += `update plm.production_order_line set metadata='{"coldlion_kept_separate":true}' where sku='KEPT01' and quantity_ordered=7;`;
  // Production-only linkage must stay on a live bulk line.
  seed += googleLine("D9400", "PROD01", 9400);
  seed += `insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
    select id, 'coldlion', 'coldlion:prod:9400:line:1:component:1', false
    from plm.production_order_line where sku='PROD01';`;
  seed += distroLine(7600000, 1, 1, "PROD01", 8, "D9400");
  seed += distroLine(7600001, 1, 1, "PROD01", 9, "D9400");
  psql(seed);

  const snapshot = () => psql(`select jsonb_build_object(
    'lines', (select jsonb_agg(to_jsonb(l) order by l.id) from plm.production_order_line l),
    'refs', (select jsonb_agg(to_jsonb(r) order by r.id) from plm.production_order_line_source_ref r),
    'runs', (select jsonb_agg(to_jsonb(r) order by r.id) from coldlion.sync_run r))`);
  const before = snapshot();
  // Dry run writes nothing.
  assert.equal(psql(buildDistroReplaceSql({ runId: RUN() })), "8|3");
  assert.equal(psql("select count(*) from plm.production_order_line where voided_at is not null"), "0");
  assert.equal(snapshot(), before);

  assert.equal(psql(buildDistroReplaceSql({ runId: RUN(), write: true })), "8|3");

  // Distro lines now sit under D3651 and are live.
  assert.equal(psql(`select count(*) from plm.production_order_line l join plm.production_order p on p.id=l.production_order_id
    where p.production_order_number='D3651' and l.voided_at is null and l.quantity_ordered is not null`), "6");
  // The bulk lines are retired, kept, and linked to their replacements.
  assert.equal(psql(`select string_agg(l.sku || ':' || (l.void_reason = '${DISTRO_VOID_REASON.replace(/'/g, "''")}') || ':' ||
      jsonb_array_length(l.metadata->'orderlist_replaced_by_distro'->'line_ids') || ':' ||
      (l.metadata->'orderlist_replaced_by_distro'->'sales_orders')::text, ',' order by l.sku)
    from plm.production_order_line l where l.voided_at is not null and l.sku like 'VDC%'`),
    "VDC83DYMM14:true:3:[7128093, 7128094, 7128095],VDC83DYMM15:true:3:[7128093, 7128094, 7128095]");
  // Live D3651 quantity counts the distro lines once and nothing else.
  assert.equal(psql(`select sum(l.quantity_ordered) from plm.production_order_line l join plm.production_order p on p.id=l.production_order_id
    where p.production_order_number='D3651' and l.voided_at is null`), String(2 * (342 + 797 + 336)));
  // Non-distro and ambiguous cases untouched.
  assert.equal(psql(`select count(*) from plm.production_order_line l join plm.production_order p on p.id=l.production_order_id
    where p.production_order_number ~ '^COLDLION-SO-7[23]'`), "3");
  assert.equal(psql(`select count(*) from plm.production_order_line l join plm.production_order p on p.id=l.production_order_id
    where p.production_order_number='D9200' and l.voided_at is null and l.quantity_ordered is not null`), "2");
  assert.equal(psql(`select count(*) from plm.production_order_line where sku='MULTI01' and voided_at is not null`), "1");
  assert.equal(psql(`select count(*) from plm.production_order_line l join plm.production_order p on p.id=l.production_order_id
    where l.sku in ('KEPT01','PROD01') and l.voided_at is null
      and ((l.quantity_ordered is null and p.production_order_number in ('D9300','D9400'))
        or (l.quantity_ordered is not null and p.production_order_number like 'COLDLION-SO-%'))`), "5");
  assert.equal(psql(`select count(*) from plm.production_order_line_source_ref r
    join plm.production_order_line l on l.id=r.production_order_line_id
    where r.source_id='coldlion:prod:9400:line:1:component:1' and l.voided_at is null`), "1");
  // Preimage recorded; a second run is a no-op.
  assert.equal(psql("select count(*) from coldlion.sync_run where request_params->>'step'='distro-replaces-bulk'"), "1");
  assert.equal(psql(buildDistroReplaceSql({ runId: RUN(), write: true })), "0|0");
});
