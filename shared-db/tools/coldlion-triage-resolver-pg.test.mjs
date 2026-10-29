// Behavioural test of public.resolve_coldlion_triage (#5004) against an
// isolated PostgreSQL 17 (the tools-offline-tests docker step sets
// COLDLION_WRITER_TEST_CONTAINER). The function is loaded straight from its
// migration, so the test exercises the exact SQL that ships.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = process.env.COLDLION_WRITER_TEST_CONTAINER;
const DB = "coldlion_triage_test";
const MIGRATION = new URL("../supabase/migrations/20261029093309_coldlion_triage_link_without_customer.sql", import.meta.url);

function psql(sql, db = DB) {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", db,
    "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "|"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

const resolverSql = () => {
  const src = readFileSync(MIGRATION, "utf8");
  return src.slice(src.indexOf("create or replace function public.resolve_coldlion_triage"), src.lastIndexOf("\ncommit;"));
};

const ACTOR = "00000000-0000-0000-0000-00000000a11c";
const SCHEMA = `
create schema plm; create schema dam; create schema auth; create schema coldlion;
create table coldlion.order_history_line (id uuid primary key default gen_random_uuid(), sales_order_no bigint not null,
  sales_order_line_no integer not null, prod_reference_no text, fetched_at timestamptz not null, created_at timestamptz not null default now());
create table auth.actor (id uuid);
create function auth.uid() returns uuid language sql as $$select id from auth.actor limit 1$$;
create table plm.production_order (id uuid primary key default gen_random_uuid(), production_order_number text,
  company_id uuid, metadata jsonb not null default '{}', voided_at timestamptz, updated_at timestamptz default now());
create table plm.production_order_line (id uuid primary key default gen_random_uuid(), production_order_id uuid,
  sku text, customer_po_number text, quantity_ordered numeric, metadata jsonb not null default '{}', voided_at timestamptz, updated_at timestamptz default now());
create table plm.production_order_line_source_ref (id uuid primary key default gen_random_uuid(),
  production_order_line_id uuid references plm.production_order_line (id) on delete cascade, source_system text, source_id text, is_primary boolean default true);
create table dam.production_order_snapshot (id uuid primary key default gen_random_uuid(), production_order_line_id uuid);
insert into auth.actor values ('${ACTOR}');
insert into plm.production_order (id, production_order_number, company_id, metadata) values
  ('00000000-0000-0000-0000-0000000000d1', 'D3708', '00000000-0000-0000-0000-0000000000c1', '{}'),
  ('00000000-0000-0000-0000-0000000000d2', 'D3526', '00000000-0000-0000-0000-0000000000c1', '{}'),
  ('00000000-0000-0000-0000-0000000000d3', 'D2616', '00000000-0000-0000-0000-0000000000c2', '{}'),
  ('00000000-0000-0000-0000-0000000000d4', 'D3526', '00000000-0000-0000-0000-0000000000c2', '{}'),
  ('00000000-0000-0000-0000-0000000000d5', 'D3435', null, '{}'),
  ('00000000-0000-0000-0000-0000000000f1', 'COLDLION-SO-7000001', '00000000-0000-0000-0000-0000000000c1', '{"production_order_number_origin":"coldlion_intake_placeholder"}');
insert into plm.production_order_line (id, production_order_id, sku, quantity_ordered, metadata) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000d1', 'QTY1', 1603, '{"coldlion_values":{"quantity_ordered":1610,"import_po":"D3708"}}'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000d1', 'QTY2', 50, '{"coldlion_values":{"quantity_ordered":60,"import_po":null}}'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000d1', 'PO1', 200, '{"coldlion_values":{"quantity_ordered":200,"import_po":"D3526"}}'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-0000000000d1', 'PO2', 300, '{"coldlion_values":{"quantity_ordered":300,"import_po":"D2616"}}'),
  ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-0000000000d1', 'PO3', 300, '{"coldlion_values":{"quantity_ordered":300,"import_po":"D9999"}}'),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000d2', 'LINKME', null, '{}'),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-0000000000d3', 'LINKME', null, '{}'),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'LINKME', 144, '{}'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000f1', 'ALONE', 12, '{}');
insert into plm.production_order_line (id, production_order_id, sku, customer_po_number, quantity_ordered) values
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-0000000000d5', 'NOCUST', '315063', null),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-0000000000d5', 'NOCUST', '999', null),
  ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-0000000000d5', 'NOCUST', null, null),
  ('00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-0000000000d5', null, '315063', null),
  ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-0000000000f1', 'NOCUST', '0315063', 75);
insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id) values
  ('00000000-0000-0000-0000-000000000011', 'google_order_list', 'g11'),
  ('00000000-0000-0000-0000-000000000011', 'coldlion', 'coldlion:so:1:line:1:component:1'),
  ('00000000-0000-0000-0000-000000000012', 'coldlion', 'coldlion:so:1:line:2:component:1'),
  ('00000000-0000-0000-0000-000000000013', 'coldlion', 'coldlion:so:1:line:3:component:1'),
  ('00000000-0000-0000-0000-000000000014', 'coldlion', 'coldlion:so:1:line:4:component:1'),
  ('00000000-0000-0000-0000-000000000015', 'coldlion', 'coldlion:so:1:line:5:component:1'),
  ('00000000-0000-0000-0000-000000000021', 'google_order_list', 'g21'),
  ('00000000-0000-0000-0000-000000000022', 'google_order_list', 'g22'),
  ('00000000-0000-0000-0000-000000000031', 'coldlion', 'coldlion:so:7000001:line:1:component:1'),
  ('00000000-0000-0000-0000-000000000032', 'coldlion', 'coldlion:so:7000001:line:2:component:1'),
  ('00000000-0000-0000-0000-000000000023', 'google_order_list', 'g23'),
  ('00000000-0000-0000-0000-000000000024', 'google_order_list', 'g24'),
  ('00000000-0000-0000-0000-000000000025', 'google_order_list', 'g25'),
  ('00000000-0000-0000-0000-000000000026', 'google_order_list', 'g26'),
  ('00000000-0000-0000-0000-000000000033', 'coldlion', 'coldlion:so:7000001:line:3:component:1');
insert into coldlion.order_history_line (sales_order_no, sales_order_line_no, prod_reference_no, fetched_at) values
  (1, 3, 'D3708', now() - interval '1 day'), (1, 3, 'D3526', now()), (1, 4, 'D2616', now()), (1, 5, 'D9999', now());
insert into dam.production_order_snapshot (production_order_line_id) values ('00000000-0000-0000-0000-000000000031');
`;

const L = (n) => `00000000-0000-0000-0000-0000000000${n}`;
const resolve = (line, action, target = null) =>
  psql(`select public.resolve_coldlion_triage('${L(line)}', '${action}', ${target ? `'${L(target)}'` : "null"});`);
const refused = (line, action, target, pattern) =>
  assert.throws(() => resolve(line, action, target), pattern);

test.before(() => {
  if (!container) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, "postgres");
  psql(SCHEMA + resolverSql());
});

test("quantity: keep Google remembers the reviewed ColdLion value; take ColdLion writes it", { skip: !container }, () => {
  assert.equal(resolve(11, "keep_google_quantity"), "Kept the Google quantity 1603.");
  assert.equal(psql(`select quantity_ordered || '|' || (metadata #>> '{coldlion_reviewed,quantity_ordered}') from plm.production_order_line where id='${L(11)}'`), "1603|1610");
  refused(11, "keep_google_quantity", null, /no longer needs a decision/);
  // A later, different ColdLion value asks again.
  psql(`update plm.production_order_line set metadata = jsonb_set(metadata, '{coldlion_values,quantity_ordered}', '1620') where id='${L(11)}'`);
  assert.equal(resolve(11, "use_coldlion_quantity"), "Quantity changed to 1620.");
  assert.equal(psql(`select quantity_ordered || '|' || (metadata #>> '{coldlion_resolved_quantity,from}') from plm.production_order_line where id='${L(11)}'`), "1620|1603");
  assert.equal(resolve(12, "use_coldlion_quantity"), "Quantity changed to 60.");
  refused(13, "use_coldlion_quantity", null, /no longer needs a decision/);
});

test("Import PO: take ColdLion moves the line to that order only for the same customer", { skip: !container }, () => {
  assert.equal(resolve(13, "use_coldlion_import_po"), "Line moved from D3708 to D3526.");
  assert.equal(psql(`select production_order_id from plm.production_order_line where id='${L(13)}'`), L("d2"));
  refused(14, "use_coldlion_import_po", null, /different customer/);
  refused(15, "use_coldlion_import_po", null, /no single OrderList order D9999/);
  assert.equal(resolve(15, "keep_google_import_po"), "Kept the Google Import PO D3708.");
  refused(15, "keep_google_import_po", null, /no longer needs a decision/);
});

test("unmatched ColdLion line: link moves refs and snapshots onto the Google line; keep separate leaves it", { skip: !container }, () => {
  refused(31, "link_google_line", 11, /cannot take a ColdLion line/);
  refused(31, "link_google_line", 32, /cannot take a ColdLion line/);
  refused(31, "link_google_line", 22, /different customer/);
  assert.equal(resolve(31, "link_google_line", 21), "Linked to the Google line.");
  assert.equal(psql(`select count(*) from plm.production_order_line where id='${L(31)}'`), "0");
  assert.equal(psql(`select string_agg(source_system, ',' order by source_system) from plm.production_order_line_source_ref where production_order_line_id='${L(21)}'`), "coldlion,google_order_list");
  assert.equal(psql(`select count(*) from dam.production_order_snapshot where production_order_line_id='${L(21)}'`), "1");
  assert.equal(psql(`select quantity_ordered || '|' || (metadata #>> '{coldlion_values,quantity_ordered}') || '|' || (metadata #>> '{coldlion_linked_from,sku}') from plm.production_order_line where id='${L(21)}'`), "144|144|LINKME");
  refused(11, "keep_separate", null, /no longer needs a decision/);
  assert.equal(resolve(32, "keep_separate"), "Kept as its own ColdLion row.");
  refused(32, "keep_separate", null, /no longer needs a decision/);
});

test("a Google line with no customer links only on the same customer PO and SKU", { skip: !container }, () => {
  refused(33, "link_google_line", 24, /different customer/);
  refused(33, "link_google_line", 25, /different customer/);
  refused(33, "link_google_line", 26, /different customer/);
  assert.equal(resolve(33, "link_google_line", 23), "Linked to the Google line.");
  assert.equal(psql(`select quantity_ordered from plm.production_order_line where id='${L(23)}'`), "75");
});

test("an Import PO move needs ColdLion's own history to agree with the value on screen", { skip: !container }, () => {
  psql(`update plm.production_order_line set metadata = jsonb_set(metadata, '{coldlion_values,import_po}', '"D3526"') where id='${L(14)}'`);
  refused(14, "use_coldlion_import_po", null, /no longer shows Import PO D3526/);
});

test("a line with forged ColdLion values but no ColdLion line is refused", { skip: !container }, () => {
  psql(`update plm.production_order_line set metadata = '{"coldlion_values":{"quantity_ordered":1,"import_po":"D3526"}}' where id='${L(22)}'`);
  refused(22, "use_coldlion_quantity", null, /has no ColdLion line/);
  refused(22, "use_coldlion_import_po", null, /has no ColdLion line/);
});

test("refuses without a signed-in user and on an unknown action", { skip: !container }, () => {
  refused(12, "nonsense", null, /unknown action/);
  psql(`delete from auth.actor`);
  refused(12, "keep_google_quantity", null, /authentication required/);
});
