// Unsealed staging SQL for the ColdLion order intake (plan_coldlion_order_intake.md §9 B1).
//
// One window, ONE transaction — but unlike the sealed loader there is no window
// ledger, no page evidence, and nothing is ever sealed: the open current week is
// re-read on every poll and the forward horizon is scanned past it. Replay is an
// update, not a duplicate: every insert is ON CONFLICT against the sealed
// identity keys VERBATIM, and the ONLY column an identical re-observation may
// change is last_seen_run. A changed projection carries a different source hash,
// misses the identity conflict, and lands as a NEW VERSION row — the C2 winner
// rule (greatest last_seen_run, then hash) resolves which version is current.
//
// This module builds SQL as text; database access is injected by the caller so
// the offline tests can exercise every branch without a database (the
// load-window.mjs + coldlion-landing-history.test.mjs pattern).

import { sqlBool, sqlColumns, sqlDate, sqlJson, sqlNumber, sqlRow, sqlText, sqlTimestamp, sqlUuid } from "./values.mjs";

export const REQUESTED_BY = "coldlion-order-intake";

// The projection keys ARE the column names; the line spec mirrors the sealed
// ORDER_LINE_SPEC with run_id replaced by the two run FKs and the explicit
// client-side id (components reference it, and the conflict path must keep the
// ORIGINAL id so a re-observed identity never orphans its components).
export const INTAKE_LINE_SPEC = [
  ["id", "uuid"],
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
  ["fetched_at", "ts"],
];

export const INTAKE_COMPONENT_SPEC = [
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
  ["sub_merch_group01", "text"],
  ["sub_merch_group02", "text"],
  ["sub_merch_group03", "text"],
  ["sub_merch_group04", "text"],
  ["sub_merch_group05", "text"],
  ["sub_merch_group06", "text"],
  ["merch_group01", "text"],
  ["merch_group02", "text"],
  ["merch_group03", "text"],
  ["merch_group04", "text"],
  ["merch_group05", "text"],
  ["merch_group06", "text"],
  ["invoice_no_string", "text"],
  ["invoice_date_string", "text"],
  ["pick_ticket_no_string", "text"],
  ["document_list_cardinality_mismatch", "bool"],
  ["component_source_hash", "text"],
  ["fetched_at", "ts"],
];

const T = { text: sqlText, num: sqlNumber, int: sqlNumber, big: sqlNumber, date: sqlDate, bool: sqlBool, ts: sqlTimestamp, uuid: sqlUuid };

function rowValues(spec, row) {
  // values.mjs sqlRow expects [column, emitterFunction, rowKey] triples; the
  // specs here carry the type NAME, resolved through T first.
  return sqlRow(spec.map(([column, emit]) => [column, T[emit], column]), row);
}

/**
 * The staging transaction for one scanned window. `projected` is the output of
 * projectOrderHistoryWindow(rows, { runId, fetchedAt }) — the sealed projection,
 * reused verbatim; this module only maps run_id -> first_seen_run/last_seen_run.
 *
 * CTE visibility (Postgres): data-modifying CTEs in one statement all see the
 * SAME snapshot and cannot see each other's writes to the target tables — only
 * RETURNING rows pass between them. So novelty detection reads `line_map`'s
 * RETURNING (exactly the lines staged THIS run), never a fresh read of
 * coldlion.intake_order_line, which would be blind to this statement's inserts.
 *
 * The line-ref novelty test is the collation-proof LIKE
 * (source_id like 'coldlion:so:<so>:%') behind the equality
 * source_system = 'coldlion', which the (source_system, source_id) unique
 * btree serves as a narrowed range before the LIKE filters it. A byte-order
 * range (>= prefix AND < successor) was tried and withdrawn in review: under a
 * collation that orders punctuation unexpectedly it can wrongly EXCLUDE a real
 * ref — a silent missed detection the LIKE cannot repair. Never reintroduce a
 * byte-successor range here without asserting the column's collation first.
 *
 * Returns SQL text. The final SELECT reports: lines inserted/updated, components
 * inserted/updated, the number of NEW sales orders detected, and their numbers
 * (for the --limit ladder and the run summary; never row contents); the
 * run_counts CTE writes the same counts into the durable sync_run row.
 */
export function buildIntakeStageSql({
  runId,
  window,
  track,
  projected,
  companyCode,
  pageSize,
  completion,
  startedAt,
  finishedAt,
  durationMs,
  notes,
  dryRun = false,
}) {
  const lines = [];
  // A dropped duplicate line's localId remaps to the KEPT line of the same
  // identity, so its components resolve to the surviving parent instead of
  // throwing "parent outside this window projection".
  const duplicateLineParents = new Map();
  {
    // Intra-batch identity de-duplication, lines first (round-3 M-6): the line
    // identity is (sales_order_no, sales_order_line_no, master_item_no,
    // line_source_hash); a repeated identity in one VALUES list would abort the
    // whole statement under ON CONFLICT DO UPDATE ("cannot affect row a second
    // time"), losing the window. First occurrence wins.
    const seenLineIdentities = new Map();
    for (const projectedLine of projected.lines) {
      const line = { ...projectedLine, id: projectedLine.localId, first_seen_run: runId, last_seen_run: runId };
      const key = JSON.stringify([
        line.sales_order_no,
        line.sales_order_line_no,
        line.master_item_no,
        line.line_source_hash,
      ]);
      if (seenLineIdentities.has(key)) {
        duplicateLineParents.set(projectedLine.localId, seenLineIdentities.get(key));
        continue;
      }
      seenLineIdentities.set(key, line);
      lines.push(line);
    }
  }
  const components = projected.components;

  const lineValues = lines
    .map((line) =>
      rowValues(
        [
          ...INTAKE_LINE_SPEC,
          ["first_seen_run", "uuid"],
          ["last_seen_run", "uuid"],
        ],
        line,
      ),
    )
    .join(",\n  ");

  // Intra-batch identity de-duplication (round-3 M-6): ON CONFLICT DO UPDATE
  // over a VALUES list that names the same identity twice aborts the whole
  // statement ("cannot affect row a second time") and loses the window — the
  // vendor repeating a component row must degrade to first-wins, not to a lost
  // window. The dedupe keys are exactly the identity keys the constraints use,
  // including the constraint's NULLS NOT DISTINCT semantics: null and '' are
  // DIFFERENT identities to the constraint, so the key preserves that edge
  // instead of normalizing null to '' (round-4 L-2); an undefined (a projection
  // that omitted the field entirely) is kept distinct from both, since it is
  // not a value the constraint can ever see.
  const identityKey = (value) => (value === null ? { null: true } : value === undefined ? { absent: true } : value);
  const seenComponentIdentities = new Set();
  const dedupedComponents = [];
  for (const component of components) {
    const parent =
      lines.find((line) => line.localId === component.lineLocalId) ??
      duplicateLineParents.get(component.lineLocalId);
    if (!parent) throw new Error("component references a parent line outside this window projection");
    const key = JSON.stringify([
      parent.sales_order_no,
      parent.sales_order_line_no,
      parent.master_item_no,
      parent.line_source_hash,
      identityKey(component.sub_item_no),
      identityKey(component.sub_label_code),
      identityKey(component.component_source_hash),
    ]);
    if (seenComponentIdentities.has(key)) continue;
    seenComponentIdentities.add(key);
    dedupedComponents.push({ component, parent });
  }

  // Components reference their parent by THIS run's local id; line_map rewrites
  // that to the id the database actually holds after the conflict path (a
  // re-observed identity keeps its ORIGINAL id, so components still conflict on
  // (line_id, sub_item, sub_label, hash) instead of duplicating).
  const componentValues = dedupedComponents.length
    ? dedupedComponents
        .map(({ component, parent }) => {
          // The projection emits lineLocalId (project-order-history.mjs:170), the
          // same key load-window.mjs:253 maps as line_local_id when it loads the
          // sealed tables; reading any other property silently finds undefined
          // parents and throws on every non-empty window.
          return `(${[
            sqlNumber(parent.sales_order_no),
            sqlNumber(parent.sales_order_line_no),
            sqlText(parent.master_item_no),
            sqlText(parent.line_source_hash),
            ...INTAKE_COMPONENT_SPEC.map(([column, emit]) => T[emit](component[column])),
          ].join(", ")})`;
        })
        .join(",\n  ")
    // An empty window still needs a syntactically valid VALUES row: the alias list
    // below names 4 join keys + every component column, so the placeholder row
    // must carry exactly as many NULLs (it joins to nothing and inserts nothing).
    : `(null::bigint, null::integer, null::text, null::text, ${INTAKE_COMPONENT_SPEC.map(() => "null").join(", ")})`;

  const componentSelect = INTAKE_COMPONENT_SPEC.map(([column]) => `v.${column}`).join(", ");

  return `begin;

insert into coldlion.sync_run
  (id, endpoint, company_code, request_params, window_from, window_to,
   status, requested_by, started_at, finished_at, duration_ms, http_status, body_status,
   rows_fetched, notes)
values
  (${sqlUuid(runId)}, '/orderHistory', ${sqlText(companyCode)},
   ${sqlJson({ companyCode, track, fromDate: window.from, toDate: window.to, size: pageSize, pages: completion.pages })},
   date ${sqlText(window.from)}, date ${sqlText(window.to)},
   'succeeded', ${sqlText(REQUESTED_BY)}, ${sqlTimestamp(startedAt)}, ${sqlTimestamp(finishedAt)},
   ${sqlNumber(durationMs)}, ${sqlNumber(completion.httpStatus)}, ${sqlNumber(completion.bodyStatus)},
   ${sqlNumber(completion.rows)}, ${sqlText(notes)})
on conflict (id) do nothing;

with line_map as (
${lines.length ? `  insert into coldlion.intake_order_line
    (${sqlColumns(INTAKE_LINE_SPEC)}, first_seen_run, last_seen_run)
  values
  ${lineValues}
  on conflict on constraint coldlion_intake_order_line_identity_unique
  do update set last_seen_run = excluded.last_seen_run
  returning id, sales_order_no, sales_order_line_no, master_item_no, line_source_hash, warehouse_code,
            (first_seen_run = last_seen_run) as was_insert` : `  select null::uuid as id, null::bigint as sales_order_no,
           null::integer as sales_order_line_no, null::text as master_item_no,
           null::text as line_source_hash, null::text as warehouse_code, false as was_insert
   where false`}
),
staged_components as (
  insert into coldlion.intake_order_component
    (line_id, ${sqlColumns(INTAKE_COMPONENT_SPEC)}, first_seen_run, last_seen_run)
  select m.id, ${componentSelect}, ${sqlUuid(runId)}, ${sqlUuid(runId)}
  from (values
  ${componentValues}
  ) as v(line_so, line_no, line_item, line_hash, ${sqlColumns(INTAKE_COMPONENT_SPEC)})
  -- Accepted, round-3 M-2b: this join has no index to ride BY CONSTRUCTION —
  -- both sides are this statement's own data (a VALUES list against line_map's
  -- RETURNING), so the planner hash-joins one window's rows. The cost is bounded
  -- by the window's size (the vendor's page cap), never by table growth; a
  -- different plan is not wanted here.
  join line_map m
    on m.sales_order_no = v.line_so
   and m.sales_order_line_no = v.line_no
   and m.master_item_no = v.line_item
   and m.line_source_hash = v.line_hash
  on conflict on constraint coldlion_intake_order_component_identity_unique
  do update set last_seen_run = excluded.last_seen_run
  returning (first_seen_run = last_seen_run) as was_insert
),
new_orders as (
  insert into coldlion.intake_new_order (sales_order_no, first_seen_run, last_seen_run, warehouse_code)
  select g.sales_order_no, ${sqlUuid(runId)}, ${sqlUuid(runId)}, g.warehouse_code
  from (
    select m.sales_order_no,
           (array_agg(m.warehouse_code order by m.warehouse_code nulls last))[1] as warehouse_code
    from line_map m
    where m.sales_order_no <> 0
      and not exists (
        select 1 from plm.production_order_source_ref h
        where h.source_system = 'coldlion'
          and h.source_id = 'coldlion:so-header:' || m.sales_order_no::text)
      and not exists (
        select 1 from plm.production_order_line_source_ref r
        where r.source_system = 'coldlion'
          and r.source_id like 'coldlion:so:' || m.sales_order_no::text || ':%')
    group by m.sales_order_no
  ) g
  on conflict (sales_order_no) do update
    set last_seen_run = excluded.last_seen_run,
        warehouse_code = excluded.warehouse_code
  -- was_insert separates the two RETURNING populations: INSERT ... ON CONFLICT
  -- DO UPDATE returns updated rows too, and a re-observed order is NOT a new
  -- detection. The discriminator is exact, not a system-column heuristic: the
  -- insert path writes first_seen_run = last_seen_run = this run; the update
  -- path leaves the ORIGINAL first_seen_run behind and moves only last_seen_run.
  -- Every "new" count below counts inserts only — until Phase C2 stamps plm
  -- source refs, a re-read re-RUNS this upsert but never re-counts.
  returning sales_order_no, (first_seen_run = last_seen_run) as was_insert
),
counts as (
  select (select count(*) from line_map where was_insert) as lines_inserted,
         (select count(*) from line_map where not was_insert) as lines_updated,
         (select count(*) from staged_components where was_insert) as components_inserted,
         (select count(*) from staged_components where not was_insert) as components_updated,
         (select count(*) from new_orders where was_insert) as new_orders,
         (select coalesce(string_agg(sales_order_no::text, ',' order by sales_order_no), '')
           from new_orders where was_insert) as new_order_numbers
),
window_state as (
  insert into coldlion.intake_window_state
    (track, from_date, to_date, last_run, last_status,
     rows_fetched, rows_staged, rows_excluded, new_orders, last_completed_at)
  values
    (${sqlText(track)}, date ${sqlText(window.from)}, date ${sqlText(window.to)},
     ${sqlUuid(runId)}, 'succeeded',
     ${sqlNumber(completion.rows)},
     ${sqlNumber(lines.length + components.length)},
     ${sqlNumber(projected.excludedEp001)},
     (select new_orders from counts), now())
  on conflict (track, from_date) do update
    set to_date = excluded.to_date,
        last_run = excluded.last_run,
        last_status = excluded.last_status,
        rows_fetched = excluded.rows_fetched,
        rows_staged = excluded.rows_staged,
        rows_excluded = excluded.rows_excluded,
        new_orders = excluded.new_orders,
        last_completed_at = excluded.last_completed_at
  returning track, from_date
),
run_counts as (
  update coldlion.sync_run s
     set rows_inserted = (select lines_inserted from counts) + (select components_inserted from counts),
         rows_updated  = (select lines_updated from counts) + (select components_updated from counts),
         -- rows_unchanged is pinned 0, never left null (round-3 L-3): in this
         -- staging model every observed row either inserts or updates — each
         -- window runs under a fresh run id, so a re-observed identity always
         -- moves last_seen_run — and there is no unchanged class to count. The
         -- sealed loaders set theirs from _counts CTEs because their model has
         -- one; a null here would read as "not recorded" on the shared audit row.
         rows_unchanged = 0
   where s.id = ${sqlUuid(runId)}
  returning s.id
)
select
  (select lines_inserted from counts) as lines_inserted,
  (select lines_updated from counts) as lines_updated,
  (select components_inserted from counts) as components_inserted,
  (select components_updated from counts) as components_updated,
  (select new_orders from counts) as new_orders,
  (select new_order_numbers from counts) as new_order_numbers
${dryRun ? "rollback;" : "commit;"}
`;
}

/**
 * The intake's failure recorder — a SIBLING of recordFailure(), deliberately NOT
 * recordFailure() itself: that function also marks coldlion.window_ledger rows
 * state='failed', which would poison sealed-window resume (plan §8). This one
 * inserts the failed sync_run row and fires the alert, and touches no ledger.
 */
export function buildIntakeFailureSql({ runId, window, track, companyCode, error, startedAt }) {
  const message = String(error?.message ?? error).slice(0, 4000);
  return `begin;
insert into coldlion.sync_run
  (id, endpoint, company_code, request_params, window_from, window_to,
   status, requested_by, started_at, finished_at, http_status, body_status, error_message)
values
  (${sqlUuid(runId)}, '/orderHistory', ${sqlText(companyCode)},
   ${sqlJson({ companyCode, requestedBy: REQUESTED_BY, fromDate: window.from, toDate: window.to })},
   date ${sqlText(window.from)}, date ${sqlText(window.to)},
   'failed', ${sqlText(REQUESTED_BY)}, ${sqlTimestamp(startedAt)}, now(),
   ${sqlNumber(error?.httpStatus ?? null)}, ${sqlNumber(error?.bodyStatus ?? null)}, ${sqlText(message)})
on conflict (id) do nothing;

insert into coldlion.intake_window_state
  (track, from_date, to_date, last_run, last_status,
   rows_fetched, rows_staged, rows_excluded, new_orders, last_completed_at)
values
  (${sqlText(track)}, date ${sqlText(window.from)}, date ${sqlText(window.to)},
   ${sqlUuid(runId)}, 'failed', 0, 0, 0, 0, now())
on conflict (track, from_date) do update
  set last_run = excluded.last_run,
      last_status = excluded.last_status,
      last_completed_at = excluded.last_completed_at;

select pg_notify('coldlion_sync_alert', ${sqlText(
    `/orderHistory intake window ${window.from}: ${message}`.slice(0, 7000),
  )});
commit;`;
}

/**
 * Pre-flight object assertion (round-2 review M-1): proveTarget() in lib/db.mjs
 * only checks the project ref and that the coldlion schema has SOME table. The
 * intake depends on exact objects, so the entry point runs this read-only check
 * before the first window and refuses to poll if anything is missing. It asserts
 * OBJECTS, not names-that-might-exist-elsewhere: six Phase A tables plus
 * coldlion.sync_run, the routing map's decode key, and both plm source-ref
 * uniques the novelty range scan rides.
 *
 * Returns SQL text whose single result row lists the missing objects (empty
 * string when everything is present). Execute with queryRows-style reads.
 */
export const INTAKE_REQUIRED_TABLES = Object.freeze([
  "coldlion.intake_window_state",
  "coldlion.intake_order_line",
  "coldlion.intake_order_component",
  "coldlion.intake_new_order",
  "coldlion.routing_code_map",
  "coldlion.intake_quarantine",
  "coldlion.sync_run",
  "plm.production_order_source_ref",
  "plm.production_order_line_source_ref",
]);

const NL = "\n";

export const INTAKE_REQUIRED_CONSTRAINTS = Object.freeze([
  {
    schema: "coldlion",
    table: "routing_code_map",
    conname: "coldlion_routing_code_map_code_pkey",
    definition: "PRIMARY KEY (code)",
  },
  {
    schema: "plm",
    table: "production_order_source_ref",
    conname: "production_order_source_ref_unique",
    definition: "UNIQUE (source_system, source_id)",
  },
  {
    schema: "plm",
    table: "production_order_line_source_ref",
    conname: "production_order_line_source_ref_unique",
    definition: "UNIQUE (source_system, source_id)",
  },
]);

export function buildIntakeObjectAssertionSql() {
  const tableRows = INTAKE_REQUIRED_TABLES.map((name) => {
    const parts = name.split(".");
    return "    (" + sqlText(parts[0]) + ", " + sqlText(parts[1]) + ")";
  }).join(", ");
  const constraintRows = INTAKE_REQUIRED_CONSTRAINTS.map(
    (entry) =>
      "    (" +
      sqlText(entry.schema) + ", " +
      sqlText(entry.table) + ", " +
      sqlText(entry.conname) + ", " +
      sqlText(entry.definition) + ")",
  ).join(", ");
  return (
    "with required_tables(table_schema, table_name) as (" + NL +
    "  values " + tableRows + NL +
    ")," + NL +
    "required_constraints(schema_name, table_name, conname, def) as (" + NL +
    "  values " + constraintRows + NL +
    ")," + NL +
    "missing as (" + NL +
    "  select t.table_schema || '.' || t.table_name as missing_object" + NL +
    "    from required_tables t" + NL +
    "   where not exists (" + NL +
    "     select 1 from pg_catalog.pg_class c" + NL +
    "     join pg_catalog.pg_namespace n on n.oid = c.relnamespace" + NL +
    "    where n.nspname = t.table_schema and c.relname = t.table_name and c.relkind = 'r')" + NL +
    "  union all" + NL +
    "  -- A constraint is verified against its EXACT relation AND its definition" + NL +
    "  -- (pg_get_constraintdef), never by name alone: a same-named constraint on" + NL +
    "  -- any other relation must not satisfy this check (round-3 M-1)." + NL +
    "  select k.schema_name || '.' || k.table_name || '!' || k.conname as missing_object" + NL +
    "    from required_constraints k" + NL +
    "   where not exists (" + NL +
    "     select 1 from pg_catalog.pg_constraint c" + NL +
    "     join pg_catalog.pg_class r on r.oid = c.conrelid" + NL +
    "     join pg_catalog.pg_namespace n on n.oid = r.relnamespace" + NL +
    "    where n.nspname = k.schema_name" + NL +
    "      and r.relname = k.table_name" + NL +
    "      and c.conname = k.conname" + NL +
    "      and pg_catalog.pg_get_constraintdef(c.oid) = k.def)" + NL +
    ")" + NL +
    "select coalesce(string_agg(missing_object, ', ' order by missing_object), '') as missing_objects from missing;"
  );
}
