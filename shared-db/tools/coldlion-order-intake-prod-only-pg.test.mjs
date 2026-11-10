// Behavioural test of the no-sales-order production claim
// (coldlion-landing/lib/order-intake-prod-only.mjs) against an isolated
// PostgreSQL 17 (the tools-offline-tests docker step sets
// COLDLION_WRITER_TEST_CONTAINER). Replays the 2026-11-10 case: Amazon D3678
// and Lidl D3651 exist in ColdLion production history with sales_order_no = 0
// and show in OrderList only as Google lines.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { buildProdOnlyClaimSql, prodLineSourceId, PROD_REF_PATTERN } from "./coldlion-landing/lib/order-intake-prod-only.mjs";
import { buildAutoMergeSql } from "./coldlion-landing/lib/order-intake-write.mjs";

const container = process.env.COLDLION_WRITER_TEST_CONTAINER;
const DB = "coldlion_prod_only_test";
const RUN = () => crypto.randomUUID();

function psql(sql, db = DB) {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", db,
    "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "|"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

const SCHEMA = `
create schema coldlion; create schema plm; create schema dam;
create table coldlion.sync_run (id uuid primary key, endpoint text, company_code text, request_params jsonb,
  status text, requested_by text, started_at timestamptz, finished_at timestamptz, error_message text, notes text);
create table coldlion.prod_history_line (id uuid primary key default gen_random_uuid(), company_code text,
  prod_order_no bigint, prod_line_seq bigint, stage_code text, division_code text, sales_order_no bigint,
  prod_reference_no text, cust_po_number text, item_no text, prod_order_qty numeric,
  source_observed_at timestamptz, source_version_seq bigint, fetched_at timestamptz default now(), created_at timestamptz default now());
create table coldlion.prod_history_component (id uuid primary key default gen_random_uuid(), line_id uuid,
  sub_item_no text, prepack_item_pkey text);
create table coldlion.intake_order_line (id uuid primary key default gen_random_uuid(), sales_order_no bigint,
  sales_order_line_no int, master_item_no text, last_seen_run uuid, po_number text, line_qty numeric,
  division_code text, line_cancelled_qty numeric);
create table coldlion.intake_order_component (id uuid primary key default gen_random_uuid(), line_id uuid,
  sub_item_no text, sub_label_code text, order_qty numeric);
create table coldlion.order_history_line (id uuid primary key default gen_random_uuid(), sales_order_no bigint,
  sales_order_line_no integer, prod_reference_no text, fetched_at timestamptz default now(), created_at timestamptz default now());
create table plm.production_order (id uuid primary key default gen_random_uuid(), production_order_number text,
  voided_at timestamptz, metadata jsonb not null default '{}');
create table plm.production_order_line (id uuid primary key default gen_random_uuid(), production_order_id uuid,
  sku text, quantity_ordered numeric, customer_po_number text, assortment_id text, metadata jsonb,
  voided_at timestamptz, status text);
create table plm.production_order_line_source_ref (id uuid primary key default gen_random_uuid(),
  production_order_line_id uuid references plm.production_order_line (id) on delete cascade, source_system text,
  source_id text, is_primary boolean, metadata jsonb, unique (source_system, source_id));
create unique index production_order_line_source_ref_primary_uidx on plm.production_order_line_source_ref (production_order_line_id, source_system) where is_primary;
create table dam.production_order_snapshot (id uuid primary key default gen_random_uuid(), production_order_line_id uuid);
`;

function googleLine(header, sku, qty, row) {
  return `insert into plm.production_order (production_order_number)
    select '${header}' where not exists (select 1 from plm.production_order where production_order_number='${header}');
  with l as (insert into plm.production_order_line (production_order_id, sku, quantity_ordered)
    select id, '${sku}', ${qty ?? "null"} from plm.production_order where production_order_number='${header}' returning id)
  insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
  select id, 'google_order_list', 'order:row:${row}', true from l;\n`;
}

function prodLine(po, seq, ref, item, qty, components = [item], so = 0) {
  return `with l as (insert into coldlion.prod_history_line (company_code, prod_order_no, prod_line_seq, stage_code,
    division_code, sales_order_no, prod_reference_no, item_no, prod_order_qty, source_observed_at)
    values ('EDGEHOME', ${po}, ${seq}, 'ISS', 'D1', ${so}, '${ref}', '${item}', ${qty}, now()) returning id)
  insert into coldlion.prod_history_component (line_id, sub_item_no) select id, s from l, unnest(array[${components.map((c) => `'${c}'`).join(",")}]) s;\n`;
}

const refsOf = (sku) => psql(`select coalesce(string_agg(r.source_id || ':' || r.is_primary, ',' order by r.source_id), '')
  from plm.production_order_line l join plm.production_order_line_source_ref r on r.production_order_line_id = l.id
  where l.sku = '${sku}' and r.source_system = 'coldlion';`);

test("prod ref grammar is distinct from the sales-order grammar", () => {
  const id = prodLineSourceId(24377, 3, 1);
  assert.equal(id, "coldlion:prod:24377:line:3:component:1");
  assert.match(id, new RegExp(PROD_REF_PATTERN));
  assert.doesNotMatch(id, /^coldlion:so:/);
  assert.throws(() => prodLineSourceId(0, 1, 1));
  assert.throws(() => buildProdOnlyClaimSql({ runId: "x" }));
  assert.match(buildProdOnlyClaimSql({ runId: RUN() }), /rollback;$/);
});

test("no-sales-order production lines attach to their Google lines", { skip: !container }, () => {
  spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-c", `drop database if exists ${DB}`]);
  spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-c", `create database ${DB}`]);
  psql(SCHEMA);
  psql(
    // Amazon D3678: one plain line per SKU on both sides.
    googleLine("D3678", "MWB10DYMM01", 304, 1) + googleLine("D3678", "MWB10DYMM02", 304, 2) +
    prodLine(24377, 1, "D3678", "MWB10DYMM01", 304) + prodLine(24377, 2, "D3678", "MWB10DYMM02", 300) +
    // Lidl D3651: one Google component line, the same component in two ColdLion production orders (DC split).
    googleLine("D3651", "VDC83DYMM14", null, 3) +
    prodLine(24391, 1, "D3651", "VDC8308", 100, ["VDC83DYMM14", "VDC83DYMM15"]) +
    prodLine(24443, 1, "D3651", "VDC8308", 50, ["VDC83DYMM14"]) +
    // Two Google lines for one key and no equal quantity: never guessed.
    googleLine("D9000", "AMBIG01", 10, 4) + googleLine("D9000", "AMBIG01", 20, 5) +
    prodLine(30000, 1, "D9000", "AMBIG01", 15) +
    // Two Google lines, quantities pair one-to-one.
    googleLine("D9001", "PAIR01", 10, 6) + googleLine("D9001", "PAIR01", 20, 7) +
    prodLine(30001, 1, "D9001", "PAIR01", 20) +
    // A line that has a sales order is not this step's business.
    googleLine("D9002", "HASSO01", 5, 8) + prodLine(30002, 1, "D9002", "HASSO01", 5, ["HASSO01"], 7128000),
  );

  const [claimed, lines] = psql(buildProdOnlyClaimSql({ runId: RUN(), write: true })).split("|");
  assert.equal(Number(claimed), 5);
  assert.equal(Number(lines), 4);

  assert.equal(refsOf("MWB10DYMM01"), "coldlion:prod:24377:line:1:component:1:true");
  assert.equal(refsOf("VDC83DYMM14"),
    "coldlion:prod:24391:line:1:component:1:true,coldlion:prod:24443:line:1:component:1:false");
  assert.equal(refsOf("AMBIG01"), "");
  assert.equal(psql(`select string_agg(l.quantity_ordered::text, ',') from plm.production_order_line l
    join plm.production_order_line_source_ref r on r.production_order_line_id = l.id
    where l.sku = 'PAIR01' and r.source_system = 'coldlion';`), "20");
  assert.equal(refsOf("HASSO01"), "");

  // ColdLion's values sit beside the Google ones; a prepack sum is never guessed.
  assert.equal(psql(`select metadata->'coldlion_values' from plm.production_order_line where sku='MWB10DYMM02';`),
    '{"import_po": "D3678", "quantity_ordered": 300}');
  assert.equal(psql(`select metadata->'coldlion_values'->>'quantity_ordered' is null from plm.production_order_line where sku='VDC83DYMM14';`), "t");

  // Idempotent.
  assert.equal(psql(buildProdOnlyClaimSql({ runId: RUN(), write: true })), "0|0");

  // The sales order arrives later: the placeholder still merges onto the
  // Google line and its sales-order ref becomes the primary one.
  psql(`with h as (insert into plm.production_order (production_order_number, metadata)
      values ('COLDLION-SO-7128500', '{"production_order_number_origin":"coldlion_intake_placeholder"}') returning id),
    l as (insert into plm.production_order_line (production_order_id, sku, quantity_ordered) select id, 'MWB10DYMM01', 304 from h returning id)
    insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary, metadata)
    select id, 'coldlion', 'coldlion:so:7128500:line:1:component:1', true, '{"master_item_no":"MWB10DYMM01"}' from l;
    update plm.production_order_line set customer_po_number = '555' where sku = 'MWB10DYMM01';`);
  assert.equal(psql(buildAutoMergeSql({ runId: RUN(), write: true })), "1");
  assert.equal(refsOf("MWB10DYMM01"),
    "coldlion:prod:24377:line:1:component:1:false,coldlion:so:7128500:line:1:component:1:true");
});
