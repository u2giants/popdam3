// Behavioural test of the ColdLion canonical writer's component identity
// against an isolated PostgreSQL 17 (the tools-offline-tests docker step sets
// COLDLION_WRITER_TEST_CONTAINER). It replays the SO 7128092 incident
// (2026-10-26): a component line already moved onto an Import PO, the
// component set renumbered, and a new component appearing mid-set. The old
// positional ordinal silently dropped AA0631P1P01 and minted a duplicate of
// AA063PFPF02; the identity-keyed writer must do neither.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { buildWriteSql, buildIdentityGuardSql } from "./coldlion-landing/lib/order-intake-write.mjs";

const container = process.env.COLDLION_WRITER_TEST_CONTAINER;
const DB = "coldlion_identity_test";

function psql(sql, db = DB) {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", db,
    "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "|"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

const SCHEMA = `
create schema coldlion; create schema plm; create schema core; create schema app;
create function app.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at = now(); return new; end$$;
create table coldlion.sync_run (id uuid primary key, endpoint text, company_code text, request_params jsonb,
  status text, requested_by text, started_at timestamptz, finished_at timestamptz, error_message text, notes text,
  rows_inserted int, rows_updated int, rows_unchanged int);
create table coldlion.routing_code_map (code text primary key, order_type text, ship_to text);
create table coldlion.intake_new_order (id uuid primary key default gen_random_uuid(), sales_order_no bigint unique check (sales_order_no <> 0),
  warehouse_code text, state text not null, state_changed_at timestamptz, claim_evidence jsonb not null default '{}');
create table coldlion.intake_quarantine (id uuid primary key default gen_random_uuid(), reason text not null,
  sales_order_no bigint, detail jsonb not null default '{}', first_seen_run uuid);
create table coldlion.intake_order_line (id uuid primary key default gen_random_uuid(), sales_order_no bigint,
  sales_order_line_no int, master_item_no text, last_seen_run uuid, company_code text, division_code text,
  customer_code text, po_number text, sales_person_code1 text, start_date date, cancel_date date,
  line_qty numeric, warehouse_code text, line_source_hash text);
create table coldlion.intake_order_component (id uuid primary key default gen_random_uuid(), line_id uuid,
  sub_item_no text, sub_label_code text, order_qty numeric, component_source_hash text, last_seen_run uuid);
create table coldlion.item_detail (company_code text, division_code text, item_no text, item_pkey text, carton_qty numeric);
create table core.company_source_ref (company_id uuid, source_system text, source_table text, source_id text);
create table plm.erp_customer (customer_code text primary key, customer_id uuid, active boolean);
create table plm.production_order (id uuid primary key default gen_random_uuid(), production_order_number text,
  company_id uuid, metadata jsonb not null default '{}', source_system text, source_id text,
  updated_at timestamptz default now(), unique (source_system, source_id));
create table plm.production_order_source_ref (production_order_id uuid, source_system text, source_id text,
  is_primary boolean, metadata jsonb, unique (source_system, source_id));
create table plm.production_order_line (id uuid primary key default gen_random_uuid(), production_order_id uuid,
  line_number text, sku text, quantity_ordered numeric, order_person text, order_type text,
  customer_po_number text, assortment_id text, assortment_component_ordinal integer, case_pack numeric,
  ship_to text, start_ship_date date, cancel_date date, metadata jsonb, source_system text, source_id text,
  source_style_type text, item_id uuid, master_data_match_status text,
  sku_normalized text generated always as (nullif(btrim(lower(sku)), '')) stored,
  updated_at timestamptz default now(), unique (source_system, source_id));
create table plm.production_order_line_source_ref (production_order_line_id uuid references plm.production_order_line (id) on delete cascade, source_system text,
  source_id text, is_primary boolean, metadata jsonb, unique (source_system, source_id));
create unique index production_order_line_source_ref_primary_uidx on plm.production_order_line_source_ref (production_order_line_id, source_system) where is_primary;
create table coldlion.division (company_code text, division_code text, division_desc text);
create table core.customer (id uuid primary key);
create table public.style_tracker_rows (id uuid primary key, sku text);
create table plm.style_tracker_item_bridge (style_tracker_row_id uuid, tracker_type text, plm_item_id uuid);
create schema if not exists dam;
create function dam.orderlist_product_facts(uuid, text) returns table (facts jsonb) language sql as $$select '{}'::jsonb$$;
create function public.link_dam_order_lines_scoped(uuid[]) returns jsonb language sql as $$select '{}'::jsonb$$;
insert into coldlion.division values ('POP', 'D1', 'POP Creations (Licensed Products)');
insert into coldlion.routing_code_map values ('W1', 'Import', 'Ross DC');
insert into plm.erp_customer values ('ROSS', '00000000-0000-0000-0000-0000000000aa', true);
`;

const SO = 7128092;
const COMPONENTS = ["AA0631P1P01", "AA0631P1P02", "AA063PFPF01", "AA063PFPF02"];

/** Stage one observation of SO 7128092 line 1 with the given components. */
function stage(run, components) {
  return `
insert into coldlion.sync_run (id, started_at) values ('${run}', now());
with l as (
  insert into coldlion.intake_order_line (sales_order_no, sales_order_line_no, master_item_no, last_seen_run,
    company_code, division_code, customer_code, po_number, line_qty, warehouse_code, line_source_hash)
  values (${SO}, 1, 'AA06301', '${run}', 'POP', 'D1', 'ROSS', '62004433', 96, 'W1', 'h-${run}')
  returning id)
insert into coldlion.intake_order_component (line_id, sub_item_no, sub_label_code, order_qty, component_source_hash, last_seen_run)
select l.id, c, null, 24, 'hash-' || c, '${run}' from l, unnest(array[${components.map((c) => `'${c}'`).join(",")}]) c;
insert into coldlion.intake_new_order (sales_order_no, warehouse_code, state) values (${SO}, 'W1', 'pending')
  on conflict (sales_order_no) do update set state = 'pending';`;
}

const linesBySku = () => psql(`
select pl.sku || '@' || p.production_order_number || '#' || r.source_id
from plm.production_order_line_source_ref r
join plm.production_order_line pl on pl.id = r.production_order_line_id
join plm.production_order p on p.id = pl.production_order_id
where r.source_system = 'coldlion' order by pl.sku, r.source_id;`).split("\n").filter(Boolean);

let n = 0;
const run = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
const write = () => psql(buildWriteSql({ runId: run(), write: true }));

test("SO 7128092: renumbering, a moved line and a new mid-set component never drop or duplicate a component", { skip: !container }, () => {
  psql(`drop database if exists ${DB}`, "postgres");
  psql(`create database ${DB}`, "postgres");
  psql(SCHEMA);

  // 2026-10-08: ColdLion first sent only AA063PFPF02 (handle component:1).
  psql(stage(run(), ["AA063PFPF02"]));
  write();
  // 2026-10-13: the OrderList consolidation moved that line onto Import PO D3691.
  psql(`insert into plm.production_order (production_order_number) values ('D3691');
update plm.production_order_line set production_order_id = (select id from plm.production_order where production_order_number = 'D3691')
 where sku = 'AA063PFPF02';`);
  // 2026-10-26: the full set arrives; AA0631P1P01 now sorts first (mid-set
  // insertion before the existing component).
  psql(stage(run(), COMPONENTS));
  write();

  const lines = linesBySku();
  assert.deepEqual(lines.map((l) => l.split("@")[0]), COMPONENTS, `each component exactly once: ${lines}`);
  assert.ok(lines.includes(`AA063PFPF02@D3691#coldlion:so:${SO}:line:1:component:1`), "the moved line keeps its handle and stays on D3691");
  assert.equal(psql(`select count(*) from coldlion.intake_quarantine`), "0");

  // A second identical run is a no-op: nothing renumbers.
  psql(`update coldlion.intake_new_order set state = 'pending'`);
  write();
  assert.deepEqual(linesBySku(), lines);
});

test("a ref whose line SKU disagrees with its identity quarantines the order loudly and writes nothing", { skip: !container }, () => {
  psql(`update plm.production_order_line set sku = 'WRONG' where sku = 'AA0631P1P02';
update coldlion.intake_new_order set state = 'pending';`);
  const before = linesBySku();
  write();
  assert.deepEqual(linesBySku(), before);
  assert.equal(psql(`select state from coldlion.intake_new_order where sales_order_no = ${SO}`), "quarantined");
  assert.match(psql(`select detail::text from coldlion.intake_quarantine where reason = 'component-identity-conflict'`), /line=WRONG staged=AA0631P1P02.*sku-mismatch/);
});

test("a legacy ref with no recorded identity quarantines instead of minting a duplicate", { skip: !container }, () => {
  psql(`update plm.production_order_line set sku = 'AA0631P1P02' where sku = 'WRONG';
delete from coldlion.intake_quarantine;
update plm.production_order_line_source_ref set metadata = '{"origin":"coldlion_intake"}' where source_id like '%:component:1';
update coldlion.intake_new_order set state = 'pending';`);
  const before = linesBySku();
  write();
  assert.deepEqual(linesBySku(), before);
  assert.match(psql(`select detail::text from coldlion.intake_quarantine`), /ref-without-identity/);
});

test("the recurring guard passes on a correct order and names a dropped component", { skip: !container }, () => {
  psql(`delete from coldlion.intake_quarantine;
update plm.production_order_line_source_ref r set metadata = '{"origin":"coldlion_intake"}'::jsonb
  || jsonb_build_object('master_item_no', 'AA06301', 'sub_item_no', pl.sku)
  from plm.production_order_line pl where pl.id = r.production_order_line_id;
update coldlion.intake_new_order set state = 'created', claim_evidence = '{}';`);
  const ok = psql(buildIdentityGuardSql()).split("|");
  assert.deepEqual(ok.slice(0, 6), ["0", "0", "0", "0", "4", "0"]);
  psql(`delete from plm.production_order_line where sku = 'AA0631P1P01'`);
  const bad = psql(buildIdentityGuardSql()).split("|");
  assert.equal(bad[0], "1");
  assert.match(bad[6], /7128092\/1\/AA0631P1P01:missing/);
});

test("a ref whose recorded identity is null counts as no identity, never as a match", { skip: !container }, () => {
  psql(`update plm.production_order_line_source_ref set metadata = metadata || '{"master_item_no": null}'::jsonb
         where source_id like '%:component:1';`);
  const guard = psql(buildIdentityGuardSql()).split("|");
  assert.equal(guard[3], "1");
});

test("an hourly run (no --order) mints a component ColdLion added to an already-created order", { skip: !container }, () => {
  psql(`update plm.production_order_line_source_ref set metadata = metadata || '{"master_item_no": "AA06301"}'::jsonb
         where source_id like '%:component:1';
update coldlion.intake_new_order set state = 'created';
insert into coldlion.intake_order_component (line_id, sub_item_no, order_qty, component_source_hash, last_seen_run)
select l.id, 'AA0631P1P03', 24, 'hash-new', l.last_seen_run from coldlion.intake_order_line l
 where l.sales_order_no = ${SO} order by (select started_at from coldlion.sync_run where id = l.last_seen_run) desc limit 1;`);
  write();
  assert.ok(linesBySku().some((l) => l.startsWith(`AA0631P1P03@COLDLION-SO-${SO}#coldlion:so:${SO}:line:1:component:`)));
  const guard = psql(buildIdentityGuardSql()).split("|");
  assert.deepEqual(guard.slice(0, 4), ["0", "0", "0", "0"]);
  assert.equal(psql(`select state from coldlion.intake_new_order where sales_order_no = ${SO}`), "created");
});

test("the committed repair restores SO 7128092 to exactly four merged D3691 lines, and the guard passes", { skip: !container }, () => {
  psql(`drop database if exists ${DB}`, "postgres");
  psql(`create database ${DB}`, "postgres");
  psql(SCHEMA + `create table dam.production_order_snapshot (id uuid primary key default gen_random_uuid(), production_order_line_id uuid);`);
  const PH = "aaaaaaaa-0000-0000-0000-000000000001";
  const D = "aaaaaaaa-0000-0000-0000-000000000002";
  const line = (id, header, sku, qty) => `('${id}', '${header}', '1', '${sku}', ${qty}, '62004433', 'licensed',
    jsonb_build_object('master_item_no', 'AA06301', 'sub_item_no', '${sku}', 'sub_label_code', null))`;
  const ref = (id, system, sourceId) => `('${id}', '${system}', '${sourceId}', true, '{"origin":"coldlion_intake"}')`;
  psql(`${stage(run(), COMPONENTS)}
update coldlion.intake_new_order set state = 'created';
insert into plm.production_order (id, production_order_number, metadata) values
  ('${PH}', 'COLDLION-SO-${SO}', '{"production_order_number_origin":"coldlion_intake_placeholder"}'),
  ('${D}', 'D3691', '{}');
insert into plm.production_order_source_ref values ('${PH}', 'coldlion', 'coldlion:so-header:${SO}', true, '{}');
insert into plm.production_order_line (id, production_order_id, line_number, sku, quantity_ordered, customer_po_number, source_style_type, metadata) values
  ${line("1ed185c1-8822-4edd-8f29-096c30cf26d1", D, "AA063PFPF02", 1000)},
  ${line("298f50a9-9d46-4ffe-9a72-e6153e93b361", PH, "AA063PFPF02", 1000)},
  ${line("65dfc580-681d-4577-a894-f86aadcfefe7", PH, "AA0631P1P02", 1000)},
  ${line("d0913b6c-6acd-4a09-b724-f02cb2007cb8", PH, "AA063PFPF01", 1000)},
  ${line("a2f2ddd4-c13b-4637-837e-1c746a04d834", D, "AA0631P1P02", "null")},
  ${line("b8f254b3-8e1c-4e6e-bde6-136d77188b7c", D, "AA063PFPF01", "null")},
  ${line("573e156f-420c-493e-8f68-bafe66652e4a", D, "AA0631P1P01", "null")};
insert into plm.production_order_line_source_ref values
  ${ref("1ed185c1-8822-4edd-8f29-096c30cf26d1", "coldlion", `coldlion:so:${SO}:line:1:component:1`)},
  ${ref("1ed185c1-8822-4edd-8f29-096c30cf26d1", "google_order_list", "order:row:12613:component:3")},
  ${ref("298f50a9-9d46-4ffe-9a72-e6153e93b361", "coldlion", `coldlion:so:${SO}:line:1:component:4`)},
  ${ref("65dfc580-681d-4577-a894-f86aadcfefe7", "coldlion", `coldlion:so:${SO}:line:1:component:2`)},
  ${ref("d0913b6c-6acd-4a09-b724-f02cb2007cb8", "coldlion", `coldlion:so:${SO}:line:1:component:3`)},
  ${ref("a2f2ddd4-c13b-4637-837e-1c746a04d834", "google_order_list", "order:row:12613:component:2")},
  ${ref("b8f254b3-8e1c-4e6e-bde6-136d77188b7c", "google_order_list", "order:row:12613:component:4")},
  ${ref("573e156f-420c-493e-8f68-bafe66652e4a", "google_order_list", "order:row:12613:component:1")};`);

  // The fixture holds one duplicate, not production's 98: only the count
  // band is relaxed; every other statement runs exactly as committed.
  const repair = readFileSync(new URL("./coldlion-landing/repairs/20261027-component-identity.sql", import.meta.url), "utf8");
  assert.match(repair, /not between 98 and 200/);
  psql(repair.replace("not between 98 and 200", "not between 1 and 200"));

  const d3691 = psql(`select pl.sku || ' q' || pl.quantity_ordered || ' ' || string_agg(r.source_system, '+' order by r.source_system)
    from plm.production_order_line pl join plm.production_order_line_source_ref r on r.production_order_line_id = pl.id
    where pl.production_order_id = '${D}' group by pl.sku, pl.quantity_ordered order by pl.sku`).split("\n");
  assert.deepEqual(d3691, COMPONENTS.map((sku) => `${sku} q${sku === "AA0631P1P01" ? 24 : 1000} coldlion+google_order_list`));
  assert.equal(psql(`select count(*) from plm.production_order_line where production_order_id = '${PH}'`), "0");
  assert.match(psql(`select request_params ->> 'step' from coldlion.sync_run where request_params ? 'preimage'`), /^20261027-component-identity$/);

  write();
  assert.equal(psql(`select count(*) from plm.production_order_line where production_order_id = '${PH}'`), "0", "the writer mints nothing back");
  assert.deepEqual(psql(buildIdentityGuardSql()).split("|").slice(0, 6), ["0", "0", "0", "0", "4", "0"]);
});
