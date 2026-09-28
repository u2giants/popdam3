// Pure analysis for #169. Inputs containing row identifiers and values remain in
// the caller's protected scratch directory; only this aggregate leaves it.
const COUNT_FIELDS = ["n_tup_ins", "n_tup_upd", "n_tup_hot_upd", "n_tup_newpage_upd"];

function nonnegativeInteger(value, name) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error(`${name} is not a nonnegative safe integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} is not a nonnegative safe integer`);
  return number;
}

export function normalizeIndexInventory(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("no indexes found");
  const indexes = rows.map((row) => {
    if (typeof row.index_name !== "string" || typeof row.definition !== "string" ||
        !Array.isArray(row.columns) || row.columns.length === 0 ||
        row.columns.some((column) => typeof column !== "string" || !column)) {
      throw new Error("index has an unresolved dependency set");
    }
    return { name: row.index_name, definition: row.definition,
      columns: [...new Set(row.columns)].sort() };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(indexes.map((index) => index.name)).size !== indexes.length) {
    throw new Error("duplicate index name");
  }
  return { indexes, columns: [...new Set(indexes.flatMap((index) => index.columns))].sort() };
}

export function assertSameInventory(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("index definitions or dependencies changed");
}

export function counterDelta(before, after) {
  if (!before || !after || before.project_ref !== after.project_ref ||
      before.table !== after.table || before.server_started_at !== after.server_started_at ||
      before.bgwriter_reset_at !== after.bgwriter_reset_at ||
      before.database_reset_at !== after.database_reset_at) {
    throw new Error("target or statistics reset identity changed");
  }
  const delta = {};
  for (const field of COUNT_FIELDS) {
    const oldValue = nonnegativeInteger(before[field], `before ${field}`);
    const newValue = nonnegativeInteger(after[field], `after ${field}`);
    if (newValue < oldValue) throw new Error(`${field} decreased`);
    delta[field] = newValue - oldValue;
  }
  if (delta.n_tup_hot_upd > delta.n_tup_upd || delta.n_tup_newpage_upd > delta.n_tup_upd) {
    throw new Error("statistics deltas are inconsistent");
  }
  return delta;
}

export function summarizeResultReceipt(receipt, { table, paths, afterBefore, beforeAfter }) {
  const lower = Date.parse(afterBefore);
  const upper = Date.parse(beforeAfter);
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== "string" || !path) ||
      new Set(paths).size !== paths.length || !Array.isArray(receipt?.events) || receipt.events.length === 0 ||
      !Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) {
    throw new Error("result receipt or snapshot time bounds are invalid");
  }
  let attempted = 0;
  let succeeded = 0;
  const seenPaths = new Set();
  for (const event of receipt.events) {
    const observed = Date.parse(event?.observed_at);
    if (event.table !== table || !paths.includes(event.path) || !Number.isFinite(observed) ||
        observed <= lower || observed >= upper) {
      throw new Error("result receipt event is outside the named workload window");
    }
    seenPaths.add(event.path);
    const oneAttempted = nonnegativeInteger(event.attempted_rows, "receipt attempted_rows");
    const oneSucceeded = nonnegativeInteger(event.succeeded_rows, "receipt succeeded_rows");
    if (oneSucceeded > oneAttempted) throw new Error("receipt success count exceeds attempts");
    attempted += oneAttempted;
    succeeded += oneSucceeded;
    if (!Number.isSafeInteger(attempted) || !Number.isSafeInteger(succeeded)) {
      throw new Error("receipt aggregate exceeds safe integer range");
    }
  }
  if (paths.some((path) => !seenPaths.has(path))) throw new Error("result receipt is missing a declared path");
  return { attempted_rows: attempted, succeeded_rows: succeeded };
}

export async function compareSortedRows(beforeRows, afterRows) {
  const before = beforeRows[Symbol.asyncIterator]();
  const after = afterRows[Symbol.asyncIterator]();
  let previousBefore = null;
  let previousAfter = null;
  const nextRow = async (iterator, side) => {
    const next = await iterator.next();
    if (next.done) return next;
    const previous = side === "before" ? previousBefore : previousAfter;
    if (typeof next.value.id !== "string" || !next.value.id ||
        typeof next.value.version !== "string" || typeof next.value.values !== "string" ||
        (previous !== null && next.value.id <= previous)) throw new Error(`${side} snapshot is invalid or unsorted`);
    if (side === "before") previousBefore = next.value.id;
    else previousAfter = next.value.id;
    return next;
  };
  let left = await nextRow(before, "before");
  let right = await nextRow(after, "after");
  const counts = { existing_rows: 0, updated_rows: 0, indexed_value_changed: 0,
    unchanged_index_value_rows: 0, inserted_rows: 0 };
  while (!left.done || !right.done) {
    if (left.done || (!right.done && right.value.id < left.value.id)) {
      counts.inserted_rows++;
      right = await nextRow(after, "after");
      continue;
    }
    if (right.done || left.value.id < right.value.id) throw new Error("a captured row disappeared");
    counts.existing_rows++;
    const valuesChanged = left.value.values !== right.value.values;
    const versionChanged = left.value.version !== right.value.version;
    if (valuesChanged && !versionChanged) throw new Error("indexed value changed without a tuple version change");
    if (versionChanged) {
      counts.updated_rows++;
      if (valuesChanged) counts.indexed_value_changed++;
      else counts.unchanged_index_value_rows++;
    }
    left = await nextRow(before, "before");
    right = await nextRow(after, "after");
  }
  return counts;
}

export function assessWindow({ before, after, counts, operation }) {
  assertSameInventory(before.inventory, after.inventory);
  const delta = counterDelta(before.stats, after.stats);
  if (typeof operation?.name !== "string" || !operation.name.trim() ||
      !Array.isArray(operation?.paths) || operation.paths.length === 0 ||
      operation.paths.some((path) => typeof path !== "string" || !path.trim()) ||
      new Set(operation.paths).size !== operation.paths.length ||
      typeof operation?.source_commit !== "string" || !/^[0-9a-f]{40}$/.test(operation.source_commit) ||
      typeof operation?.result_receipt_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(operation.result_receipt_sha256) ||
      typeof operation?.single_writer_receipt_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(operation.single_writer_receipt_sha256) ||
      typeof operation?.reset_window_receipt_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(operation.reset_window_receipt_sha256)) {
    throw new Error("operation identity or independent writer/reset-window evidence is missing");
  }
  const attempted = nonnegativeInteger(operation.attempted_rows, "attempted_rows");
  const succeeded = nonnegativeInteger(operation.succeeded_rows, "succeeded_rows");
  if (succeeded > attempted) throw new Error("succeeded rows exceed attempts");
  if (before.row_count !== undefined && counts.existing_rows !== before.row_count ||
      after.row_count !== undefined && counts.existing_rows + counts.inserted_rows !== after.row_count) {
    throw new Error("snapshot row counts are inconsistent");
  }
  if (counts.updated_rows !== delta.n_tup_upd || counts.inserted_rows !== delta.n_tup_ins) {
    throw new Error("repeated, concurrent, or unobserved writes prevent row attribution");
  }
  if (succeeded !== delta.n_tup_upd + delta.n_tup_ins) {
    throw new Error("operation successes do not match table writes");
  }
  if (counts.indexed_value_changed + counts.unchanged_index_value_rows !== counts.updated_rows) {
    throw new Error("updated row classification is incomplete");
  }
  return {
    candidate_only: true, counter_attribution_requires_reset_window_review: true,
    attribution_requires_receipt_review: true, representative_workload_requires_review: true,
    table: before.stats.table, project_ref: before.stats.project_ref,
    source_commit: operation.source_commit, operation: operation.name, paths: operation.paths,
    result_receipt_sha256: operation.result_receipt_sha256,
    single_writer_receipt_sha256: operation.single_writer_receipt_sha256,
    reset_window_receipt_sha256: operation.reset_window_receipt_sha256,
    before_finished_at: before.finished_at, after_started_at: after.started_at,
    attempted_rows: attempted, succeeded_rows: succeeded,
    failed_rows: attempted - succeeded, indexed_value_changed: counts.indexed_value_changed,
    unchanged_index_value_rows: counts.unchanged_index_value_rows,
    inserted_rows: counts.inserted_rows, table_delta: delta,
    index_count: before.inventory.indexes.length,
  };
}
