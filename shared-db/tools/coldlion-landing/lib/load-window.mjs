// One window, one scope, ONE transaction.
//
// The shape of every statement below is dictated by what the database already refuses:
//
//   * A window may only become `loaded` when contiguous page evidence 0..last exists,
//     every page loaded, exactly one flagged last, summing to the vendor's own
//     totalElements. So pages are written BEFORE the window is marked loaded, in the
//     same transaction, and the guard — not this file — is what proves completeness.
//   * The page evidence of a loaded window is immutable, so a window already loaded is
//     refused at the top rather than half-rewritten.
//   * `component_quantities_asserted` cannot be set at INSERT time: the guard reads the
//     components, which do not exist until after their parent does. It is a second
//     statement, and only for lines whose quantities actually reconcile.
//
// Replay is a no-op, not a duplicate: every insert is ON CONFLICT ON CONSTRAINT ... DO
// NOTHING against the real identity, and parents are mapped back by joining on that same
// identity, so a re-run of a partially-written window finishes it instead of doubling it.

import { PAGE_SIZE } from "./scopes.mjs";
import {
  sqlBool,
  sqlDate,
  sqlJson,
  sqlNumber,
  sqlText,
  sqlTimestamp,
  sqlUuid,
} from "./values.mjs";

const BATCH = 500;

const T = { text: sqlText, num: sqlNumber, int: sqlNumber, big: sqlNumber, date: sqlDate, bool: sqlBool, ts: sqlTimestamp, uuid: sqlUuid };
const PG = { text: "text", num: "numeric", int: "integer", big: "bigint", date: "date", bool: "boolean", ts: "timestamptz", uuid: "uuid" };

// ---------------------------------------------------------------------------------
// Column specifications. [column, type] — the projection keys ARE the column names.
// ---------------------------------------------------------------------------------

export const ORDER_LINE_SPEC = [
  ["company_code", "text"],
  ["sales_order_no", "big"],
  ["sales_order_line_no", "int"],
  ["master_item_no", "text"],
  ["label_code", "text"],
  ["pre_pack_code", "text"],
  ["division_code", "text"],
  ["customer_code", "text"],
  ["customer_desc", "text"],
  ["po_number", "text"],
  ["sales_person_code1", "text"],
  ["start_date", "date"],
  ["cancel_date", "date"],
  ["line_qty", "num"],
  ["line_cancelled_qty", "num"],
  ["prepack_qty", "num"],
  ["item_desc", "text"],
  ["short_item_no", "text"],
  ["brand_assurance_no", "text"],
  ["warehouse_code", "text"],
  ["prod_cost", "num"],
  ["prod_reference_no", "text"],
  ["line_source_hash", "text"],
  ["run_id", "uuid"],
  ["fetched_at", "ts"],
];

export const ORDER_COMPONENT_SPEC = [
  ["sub_item_no", "text"],
  ["sub_label_code", "text"],
  ["sub_upc", "text"],
  ["line_price", "num"],
  ["quantity", "num"],
  ["order_qty", "num"],
  ["invoice_qty", "num"],
  ["ship_qty", "num"],
  ["order_amount", "num"],
  ["ship_amount", "num"],
  ...merchSlots("sub_merch_group", 6),
  ...merchSlots("merch_group", 6),
  ["invoice_no_string", "text"],
  ["invoice_date_string", "text"],
  ["pick_ticket_no_string", "text"],
  ["document_list_cardinality_mismatch", "bool"],
  ["component_source_hash", "text"],
  ["run_id", "uuid"],
  ["fetched_at", "ts"],
];

export const INVOICE_REF_SPEC = [
  ["ordinal", "int"],
  ["invoice_no", "text"],
  ["invoice_date_token", "text"],
  ["invoice_date", "date"],
  ["date_alignment_proven", "bool"],
  ["run_id", "uuid"],
  ["fetched_at", "ts"],
];

export const PICK_TICKET_REF_SPEC = [
  ["ordinal", "int"],
  ["pick_ticket_no", "text"],
  ["run_id", "uuid"],
  ["fetched_at", "ts"],
];

export const PROD_LINE_SPEC = [
  ["company_code", "text"],
  ["prod_order_no", "big"],
  ["prod_line_seq", "big"],
  ["requested_stage_code", "text"],
  ["stage_code", "text"],
  ["division_code", "text"],
  ["customer_code", "text"],
  ["customer_desc", "text"],
  ["prod_type_code", "text"],
  ["ship_date", "date"],
  ["ship_cancel_date", "date"],
  ["orig_ship_date", "date"],
  ["orig_due_date", "date"],
  ["orig_ship_cancel_date", "date"],
  ["prod_order_date", "date"],
  ["due_date", "date"],
  ["receive_date", "date"],
  ["cust_start_date", "date"],
  ["cust_cancel_date", "date"],
  ["prod_country", "text"],
  ["freight_forwarder_code", "text"],
  ["warehouse_code", "text"],
  ["vendor_code", "text"],
  ["vendor_desc", "text"],
  ["arrival_port_code", "text"],
  ["sales_order_no", "big"],
  ["prod_reference_no", "text"],
  ["cust_po_number", "text"],
  ["item_no", "text"],
  ["item_desc", "text"],
  ["short_item_no", "text"],
  ["label_code", "text"],
  ["pre_pack_code", "text"],
  ["warehouse_sku", "text"],
  ["prod_order_qty", "num"],
  ["prepack_qty", "num"],
  ["total_ppk_qty", "num"],
  ["prod_cost", "num"],
  ["ext_cost", "num"],
  ["total_prod_cost", "num"],
  ["deposit_perc", "num"],
  ["source_observed_at", "ts"],
  ["source_version_seq", "big"],
  ["is_backfill_baseline", "bool"],
  ["retention_ordering_ambiguous", "bool"],
  ["retention_identity_ambiguous", "bool"],
  ["line_source_hash", "text"],
  ["run_id", "uuid"],
  ["fetched_at", "ts"],
];

export const PROD_COMPONENT_SPEC = [
  ["prepack_item_no", "text"],
  ["prepack_item_pkey", "text"],
  ["prepack_dim_code", "text"],
  ["prepack_division_code", "text"],
  ["ppk_detail_qty", "num"],
  ["ppk_detail_qty2", "num"],
  ["ppk_detail_cost", "num"],
  ["sub_item_no", "text"],
  ["line_price", "num"],
  ...merchSlots("ppk_merch_group", 14),
  ...merchSlots("ppk_merch_group", 14, "_desc"),
  ["component_source_hash", "text"],
  ["run_id", "uuid"],
  ["fetched_at", "ts"],
];

export const PROD_LOOKUP_SPEC = [
  ["last_prod_ref_no", "text"],
  ["last_due_date", "date"],
  ["last_prod_date", "date"],
  ["last_warehouse_code", "text"],
  ["last_vendor_code", "text"],
  ["last_vendor_desc", "text"],
  ["last_prod_cost", "num"],
  ["is_selected_lookup", "bool"],
  ["selection_rule", "text"],
  ["lookup_source_hash", "text"],
  ["run_id", "uuid"],
  ["fetched_at", "ts"],
];

function merchSlots(prefix, count, suffix = "") {
  return Array.from({ length: count }, (_, index) => [
    `${prefix}${String(index + 1).padStart(2, "0")}${suffix}`,
    "text",
  ]);
}

// ---------------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------------

export function tempTableSql(name, spec, extra = []) {
  const columns = [...extra, ...spec.map(([column, type]) => [column, PG[type]])];
  return `create temp table ${name} (\n  ${columns
    .map(([column, type]) => `${column} ${type}`)
    .join(",\n  ")}\n) on commit drop;`;
}

/** INSERT ... VALUES in bounded batches. A 200-row page is one statement; a big window is a few. */
export function insertValuesSql(name, columns, rows, emit) {
  if (rows.length === 0) return "";
  const statements = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    statements.push(
      `insert into ${name} (${columns.join(", ")}) values\n${batch
        .map((row) => `  (${emit(row)})`)
        .join(",\n")};`,
    );
  }
  return statements.join("\n");
}

function stageSql(name, spec, extra, rows) {
  const columns = [...extra.map(([column]) => column), ...spec.map(([column]) => column)];
  return [
    tempTableSql(name, spec, extra),
    insertValuesSql(name, columns, rows, (row) =>
      [
        ...extra.map(([column, , type]) => T[type](row[column])),
        ...spec.map(([column, type]) => T[type](row[column])),
      ].join(", "),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

const LOCAL = [["local_id", "uuid", "uuid"]];
const LOCAL_AND_PARENT = [
  ["local_id", "uuid", "uuid"],
  ["line_local_id", "uuid", "uuid"],
];
const CHILD_OF_COMPONENT = [
  ["line_local_id", "uuid", "uuid"],
  ["component_local_id", "uuid", "uuid"],
];

/** Rename the projection's camelCase local keys onto the staging column names. */
function withLocals(rows) {
  return rows.map((row) => ({
    ...row,
    local_id: row.localId,
    line_local_id: row.lineLocalId,
    component_local_id: row.componentLocalId,
  }));
}

// ---------------------------------------------------------------------------------
// Identity mapping
// ---------------------------------------------------------------------------------

/**
 * Map staged local ids onto real ids by joining on the REAL IDENTITY — which works
 * identically for rows this transaction inserted and rows an earlier attempt did, so a
 * resumed window finishes rather than duplicates. Nullable identity columns are compared
 * with IS NOT DISTINCT FROM to match the tables' NULLS NOT DISTINCT uniqueness.
 */
export function mapSql(mapName, stageName, target, identity, extraJoin = "") {
  const on = identity
    .map(([column, nullable]) =>
      nullable
        ? `t.${column} is not distinct from s.${column}`
        : `t.${column} = s.${column}`,
    )
    .join("\n     and ");
  return `create temp table ${mapName} (local_id uuid primary key, id uuid not null) on commit drop;
insert into ${mapName} (local_id, id)
select s.local_id, t.id
  from ${stageName} s
  join ${target} t
    on ${on}${extraJoin ? `\n     and ${extraJoin}` : ""};
do $guard$
begin
  if (select count(*) from ${mapName}) <> (select count(*) from ${stageName}) then
    raise exception 'staged rows in ${stageName} did not all resolve to ${target} identities';
  end if;
end $guard$;`;
}

// ---------------------------------------------------------------------------------
// Shared preamble and epilogue
// ---------------------------------------------------------------------------------

function preamble({ scope, window, runId, requestedBy, companyCode, startedAt, rowsFetched, pageSize, httpStatus, bodyStatus }) {
  const stage = scope.stage ? sqlText(scope.stage) : "null";
  return `begin;

-- A loaded window's page evidence is immutable. Refuse rather than half-rewrite it.
do $loaded$
begin
  if exists (
    select 1 from coldlion.window_ledger
     where endpoint = ${sqlText(scope.endpoint)}
       and company_code = ${sqlText(companyCode)}
       and division_code is not distinct from null
       and stage_code is not distinct from ${stage}
       and window_from = ${sqlDate(window.from)}
       and state = 'loaded'
  ) then
    raise exception 'window ${window.from} for ${scope.endpoint} is already loaded';
  end if;
end $loaded$;

insert into coldlion.sync_run
  (id, endpoint, company_code, request_params, window_from, window_to,
   status, requested_by, started_at, http_status, body_status, rows_fetched)
values
  (${sqlUuid(runId)}, ${sqlText(scope.endpoint)}, ${sqlText(companyCode)},
   ${sqlJson({
     companyCode,
     fromDate: window.from,
     toDate: window.to,
     size: pageSize,
     ...(scope.stage ? { stageCode: scope.stage } : {}),
   })},
   ${sqlDate(window.from)}, ${sqlDate(window.to)},
   'running', ${sqlText(requestedBy)}, ${sqlTimestamp(startedAt)}, ${sqlNumber(httpStatus)}, ${sqlNumber(bodyStatus)}, ${sqlNumber(rowsFetched)});

create temp table _window (id uuid not null) on commit drop;
with upserted as (
  insert into coldlion.window_ledger
    (endpoint, company_code, division_code, stage_code, window_from, window_to,
     state, attempt_count, last_run_id, first_attempted_at)
  values
    (${sqlText(scope.endpoint)}, ${sqlText(companyCode)}, null, ${stage},
     ${sqlDate(window.from)}, ${sqlDate(window.to)}, 'running', 1, ${sqlUuid(runId)}, now())
  on conflict on constraint coldlion_window_ledger_identity_unique do update
    set state = 'running',
        attempt_count = window_ledger.attempt_count + 1,
        last_run_id = excluded.last_run_id,
        first_attempted_at = coalesce(window_ledger.first_attempted_at, excluded.first_attempted_at),
        last_error = null
  returning id
)
insert into _window (id) select id from upserted;

create temp table _inserted (grain text not null, n bigint not null) on commit drop;`;
}

function pageLedgerSql({ scope, window, runId, companyCode, pages }) {
  const stage = scope.stage ? sqlText(scope.stage) : "null";
  const values = pages
    .map(
      (page) =>
        `  ((select id from _window), ${sqlText(scope.endpoint)}, ${sqlText(companyCode)}, null, ${stage},
   ${sqlDate(window.from)}, ${sqlNumber(page.pageNumber)}, ${sqlNumber(page.requestedPageSize)},
   ${sqlNumber(page.returnedPageSize)}, ${sqlNumber(page.rowCount)}, ${sqlNumber(page.reportedTotalElements)},
   ${sqlNumber(page.reportedTotalPages)}, ${sqlBool(page.isLastPage)}, 'loaded', 1, ${sqlUuid(runId)},
   ${sqlTimestamp(page.fetchedAt)}, now())`,
    )
    .join(",\n");
  return `insert into coldlion.history_page_ledger
  (window_id, endpoint, company_code, division_code, stage_code, window_from, page_number,
   requested_page_size, returned_page_size, page_row_count, reported_total_elements,
   reported_total_pages, is_last_page, state, attempt_count, run_id, first_attempted_at, loaded_at)
values
${values}
on conflict on constraint coldlion_history_page_ledger_identity_unique do update
  set requested_page_size = excluded.requested_page_size,
      returned_page_size = excluded.returned_page_size,
      page_row_count = excluded.page_row_count,
      reported_total_elements = excluded.reported_total_elements,
      reported_total_pages = excluded.reported_total_pages,
      is_last_page = excluded.is_last_page,
      state = 'loaded',
      attempt_count = history_page_ledger.attempt_count + 1,
      run_id = excluded.run_id,
      loaded_at = excluded.loaded_at,
      last_error = null;`;
}

function epilogue({ scope, window, runId, companyCode, completion, finishedAt, durationMs, notes }) {
  const stage = scope.stage ? sqlText(scope.stage) : "null";
  return `-- The window becomes loaded ONLY now, on the page evidence written above.
update coldlion.window_ledger
   set state = 'loaded',
       row_count = ${sqlNumber(completion.rows)},
       reported_total_elements = ${sqlNumber(completion.reportedTotalElements)},
       reported_total_pages = ${sqlNumber(completion.reportedTotalPages)},
       last_page_number = ${sqlNumber(completion.lastPageNumber)},
       loaded_at = now(),
       last_run_id = ${sqlUuid(runId)},
       last_error = null
 where endpoint = ${sqlText(scope.endpoint)}
   and company_code = ${sqlText(companyCode)}
   and division_code is not distinct from null
   and stage_code is not distinct from ${stage}
   and window_from = ${sqlDate(window.from)};

update coldlion.sync_run
   set status = 'succeeded',
       finished_at = ${sqlTimestamp(finishedAt)},
       duration_ms = ${sqlNumber(durationMs)},
       rows_inserted = (select coalesce(sum(n), 0) from _inserted),
       notes = ${sqlText(notes)}
 where id = ${sqlUuid(runId)};

commit;`;
}

function insertSql({
  target,
  constraint,
  spec,
  stageName,
  mapName,
  parentColumn,
  count,
  parentTable,
}) {
  const columns = spec.map(([column]) => column);
  const select = columns.map((column) => `s.${column}`).join(", ");
  // A production line identity can recur in a later window, and its evidence is SEALED
  // once its quantities are asserted: the immutability trigger refuses even an identical
  // component, and it fires before ON CONFLICT can absorb the duplicate. Without this
  // join the whole later window aborts, every retry aborts the same way, and that week
  // can never load. Sealed parents keep the evidence they already have; only parents
  // whose evidence is still open receive rows.
  const openParent = parentTable
    ? `
    join ${parentTable} p on p.id = m.id and not p.component_quantities_asserted`
    : "";
  return `with ins as (
  insert into ${target} (${parentColumn ? `${parentColumn}, ` : ""}${columns.join(", ")})
  select ${parentColumn ? `m.id, ` : ""}${select}
    from ${stageName} s
    ${parentColumn ? `join ${mapName} m on m.local_id = s.line_local_id` : ""}${openParent}
  on conflict on constraint ${constraint} do nothing
  returning 1 as one
)
insert into _inserted (grain, n) select ${sqlText(count)}, count(*) from ins;`;
}

/**
 * Say out loud, in the run log, when a window carried production lines whose evidence was
 * already sealed by an earlier window. Their child rows were skipped on purpose above;
 * silence would make that indistinguishable from a vendor that sent nothing.
 */
function sealedRecurrenceNoticeSql() {
  return `do $sealed$
declare
  v_n bigint;
begin
  select count(*) into v_n
    from _map_line m
    join coldlion.prod_history_line l on l.id = m.id
   where l.component_quantities_asserted;
  if v_n > 0 then
    raise notice 'skipped component and lookup evidence for % production line(s) already sealed by an earlier window', v_n;
  end if;
end $sealed$;`;
}

// ---------------------------------------------------------------------------------
// /orderHistory
// ---------------------------------------------------------------------------------

export function buildOrderHistoryLoadSql({
  window,
  scope,
  runId,
  requestedBy,
  companyCode,
  pageSize = PAGE_SIZE,
  pages,
  completion,
  projected,
  startedAt,
  finishedAt,
  durationMs,
  notes,
}) {
  const lines = withLocals(projected.lines);
  const components = withLocals(projected.components);
  const invoiceRefs = withLocals(projected.invoiceRefs);
  const pickRefs = withLocals(projected.pickTicketRefs);

  return [
    preamble({
      scope,
      window,
      runId,
      requestedBy,
      companyCode,
      startedAt,
      rowsFetched: completion.rows,
      pageSize,
      httpStatus: pages.at(-1).httpStatus,
      bodyStatus: pages.at(-1).bodyStatus,
    }),
    stageSql("_stage_line", ORDER_LINE_SPEC, LOCAL, lines),
    insertSql({
      target: "coldlion.order_history_line",
      constraint: "coldlion_order_history_line_identity_unique",
      spec: ORDER_LINE_SPEC,
      stageName: "_stage_line",
      count: "order_history_line",
    }),
    mapSql("_map_line", "_stage_line", "coldlion.order_history_line", [
      ["sales_order_no", false],
      ["sales_order_line_no", false],
      ["master_item_no", false],
      ["line_source_hash", false],
    ]),
    stageSql("_stage_component", ORDER_COMPONENT_SPEC, LOCAL_AND_PARENT, components),
    insertSql({
      target: "coldlion.order_history_component",
      constraint: "coldlion_order_history_component_identity_unique",
      spec: ORDER_COMPONENT_SPEC,
      stageName: "_stage_component",
      mapName: "_map_line",
      parentColumn: "line_id",
      count: "order_history_component",
    }),
    mapSql(
      "_map_component",
      "_stage_component",
      "coldlion.order_history_component",
      [
        ["sub_item_no", true],
        ["sub_label_code", true],
        ["component_source_hash", false],
      ],
      "t.line_id = (select m.id from _map_line m where m.local_id = s.line_local_id)",
    ),
    stageSql("_stage_invoice", INVOICE_REF_SPEC, CHILD_OF_COMPONENT, invoiceRefs),
    childRefSql({
      target: "coldlion.order_history_invoice_ref",
      constraint: "coldlion_order_history_invoice_ref_identity_unique",
      spec: INVOICE_REF_SPEC,
      stageName: "_stage_invoice",
      count: "order_history_invoice_ref",
    }),
    stageSql("_stage_pick", PICK_TICKET_REF_SPEC, CHILD_OF_COMPONENT, pickRefs),
    childRefSql({
      target: "coldlion.order_history_pick_ticket_ref",
      constraint: "coldlion_order_history_pick_ticket_ref_identity_unique",
      spec: PICK_TICKET_REF_SPEC,
      stageName: "_stage_pick",
      count: "order_history_pick_ticket_ref",
    }),
    pageLedgerSql({ scope, window, runId, companyCode, pages }),
    epilogue({ scope, window, runId, companyCode, completion, finishedAt, durationMs, notes }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Document tokens carry BOTH parents, so ownership is recorded exactly as the payload proves it. */
function childRefSql({ target, constraint, spec, stageName, count }) {
  const columns = spec.map(([column]) => column);
  return `with ins as (
  insert into ${target} (line_id, component_id, ${columns.join(", ")})
  select ml.id, mc.id, ${columns.map((column) => `s.${column}`).join(", ")}
    from ${stageName} s
    join _map_line ml on ml.local_id = s.line_local_id
    join _map_component mc on mc.local_id = s.component_local_id
  on conflict on constraint ${constraint} do nothing
  returning 1 as one
)
insert into _inserted (grain, n) select ${sqlText(count)}, count(*) from ins;`;
}

// ---------------------------------------------------------------------------------
// /prodHistory
// ---------------------------------------------------------------------------------

export function buildProdHistoryLoadSql({
  window,
  scope,
  runId,
  requestedBy,
  companyCode,
  pageSize = PAGE_SIZE,
  pages,
  completion,
  projected,
  startedAt,
  finishedAt,
  durationMs,
  notes,
}) {
  const lines = withLocals(projected.lines);
  const components = withLocals(projected.components);
  const lookups = withLocals(projected.lastLookups);
  const assertable = projected.assertableLineIds ?? [];

  return [
    preamble({
      scope,
      window,
      runId,
      requestedBy,
      companyCode,
      startedAt,
      rowsFetched: completion.rows,
      pageSize,
      httpStatus: pages.at(-1).httpStatus,
      bodyStatus: pages.at(-1).bodyStatus,
    }),
    stageSql("_stage_line", PROD_LINE_SPEC, LOCAL, lines),
    insertSql({
      target: "coldlion.prod_history_line",
      constraint: "coldlion_prod_history_line_identity_unique",
      spec: PROD_LINE_SPEC,
      stageName: "_stage_line",
      count: "prod_history_line",
    }),
    mapSql("_map_line", "_stage_line", "coldlion.prod_history_line", [
      ["company_code", false],
      ["prod_order_no", false],
      ["prod_line_seq", false],
      ["stage_code", false],
      ["line_source_hash", false],
    ]),
    stageSql("_stage_component", PROD_COMPONENT_SPEC, LOCAL_AND_PARENT, components),
    insertSql({
      target: "coldlion.prod_history_component",
      constraint: "coldlion_prod_history_component_identity_unique",
      spec: PROD_COMPONENT_SPEC,
      stageName: "_stage_component",
      mapName: "_map_line",
      parentColumn: "line_id",
      parentTable: "coldlion.prod_history_line",
      count: "prod_history_component",
    }),
    stageSql("_stage_lookup", PROD_LOOKUP_SPEC, LOCAL_AND_PARENT, lookups),
    insertSql({
      target: "coldlion.prod_history_last_lookup",
      constraint: "coldlion_prod_history_last_lookup_identity_unique",
      spec: PROD_LOOKUP_SPEC,
      stageName: "_stage_lookup",
      mapName: "_map_line",
      parentColumn: "line_id",
      parentTable: "coldlion.prod_history_line",
      count: "prod_history_last_lookup",
    }),
    sealedRecurrenceNoticeSql(),
    assertionSql(assertable),
    pageLedgerSql({ scope, window, runId, companyCode, pages }),
    epilogue({ scope, window, runId, companyCode, completion, finishedAt, durationMs, notes }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Assert component quantities AFTER the components exist — the guard reads them, so this
 * cannot be part of the parent INSERT. Only lines whose components reconcile exactly are
 * offered; the guard refuses anything else, which is the point of asking it.
 */
function assertionSql(localIds) {
  if (localIds.length === 0) return "";
  const list = localIds.map((id) => sqlUuid(id)).join(", ");
  return `update coldlion.prod_history_line l
   set component_quantities_asserted = true
  from _map_line m
 where m.id = l.id
   and m.local_id in (${list})
   and not l.component_quantities_asserted;`;
}
