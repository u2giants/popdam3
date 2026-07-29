// Unit tests for the incremental ClickUp -> pim.product task runner.
// Run: node --test tools/sync-clickup-tasks.test.mjs
// No database, no network (fetch is injected).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIG,
  DEFAULT_LIST_IDS,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  SOURCE_NAME,
  assertApplyTarget,
  buildFailedSyncRunSql,
  buildImportSql,
  buildSnapshot,
  buildTaskUrl,
  buildWatermarkSql,
  describeTarget,
  fetchListTasks,
  mapClickupTaskToRow,
  msToIso,
  parseListConfig,
  parseWatermarkResult,
  resolveRunMode,
  resolveWatermark,
  validateSnapshot,
} from "./sync-clickup-tasks.mjs";

// A realistic ClickUp v2 task payload (trimmed to the fields we map).
function baseTask(overrides = {}) {
  return {
    id: "8687bymye",
    name: "Bear Hug Mug",
    parent: null,
    orderindex: "12.5",
    time_estimate: 3600000,
    date_created: "1751328000000",
    date_updated: "1753660800000",
    date_closed: null,
    status: { status: "in progress", type: "custom", color: "#f9d900", orderindex: 2 },
    creator: { id: 12345, username: "Albert Hazan" },
    list: { id: "901100", name: "New Prod Development" },
    folder: { id: "801100", name: "2026 Development" },
    space: { id: "701100", name: "Product" },
    ...overrides,
  };
}

// -------------------------------------------------------------------------------------
// parseListConfig
// -------------------------------------------------------------------------------------
test("parseListConfig accepts bare ids and id=Label pairs, ignoring blanks", () => {
  assert.deepEqual(parseListConfig("901100=New Prod Development, 901200 ,,"), [
    { id: "901100", name: "New Prod Development" },
    { id: "901200", name: null },
  ]);
});

test("DEFAULT_LIST_IDS resolves to the five real ClickUp lists discovered from the API", () => {
  const lists = parseListConfig(DEFAULT_LIST_IDS);
  assert.equal(lists.length, 5);
  assert.deepEqual(lists.map((l) => l.id), [
    "13194624",
    "901104141567",
    "901103451188",
    "15061776",
    "901113451000",
  ]);
  assert.deepEqual(lists.map((l) => l.name), [
    "Licensing Management",
    "Sourcing/Sampling Projects",
    "New Prod Development",
    "Edge Generic",
    "Sprint 1",
  ]);
  assert.equal(CONFIG.lists.length, 5);
});

test("parseListConfig on an unset env var yields an empty list (no invented ids)", () => {
  assert.deepEqual(parseListConfig(""), []);
  assert.deepEqual(parseListConfig(undefined), []);
});

// -------------------------------------------------------------------------------------
// msToIso
// -------------------------------------------------------------------------------------
test("msToIso converts ClickUp string epoch millis and tolerates blanks", () => {
  assert.equal(msToIso("1753660800000"), "2025-07-28T00:00:00.000Z");
  assert.equal(msToIso(1753660800000), "2025-07-28T00:00:00.000Z");
  assert.equal(msToIso(null), null);
  assert.equal(msToIso(""), null);
  assert.equal(msToIso("not-a-number"), null);
});

// -------------------------------------------------------------------------------------
// mapClickupTaskToRow
// -------------------------------------------------------------------------------------
test("mapClickupTaskToRow maps every ClickUp-native field and keeps the raw payload", () => {
  const row = mapClickupTaskToRow(baseTask());
  assert.equal(row.clickup_task_id, "8687bymye");
  assert.equal(row.name, "Bear Hug Mug");
  assert.equal(row.clickup_parent_id, null);
  assert.equal(row.clickup_status, "in progress");
  assert.equal(row.clickup_status_type, "custom");
  assert.equal(row.clickup_status_color, "#f9d900");
  assert.equal(row.clickup_status_order, "2");
  assert.equal(row.clickup_list_id, "901100");
  assert.equal(row.clickup_list_name, "New Prod Development");
  assert.equal(row.clickup_folder_id, "801100");
  assert.equal(row.clickup_folder_name, "2026 Development");
  assert.equal(row.clickup_space_id, "701100");
  assert.equal(row.clickup_space_name, "Product");
  assert.equal(row.clickup_creator_id, "12345");
  assert.equal(row.clickup_creator_name, "Albert Hazan");
  assert.equal(row.clickup_time_estimate_ms, "3600000");
  assert.equal(row.clickup_orderindex, "12.5");
  assert.equal(row.clickup_date_updated, "2025-07-28T00:00:00.000Z");
  assert.equal(row.clickup_date_closed, null);
  assert.deepEqual(row.raw, baseTask());
});

test("mapClickupTaskToRow handles a subtask with missing folder/space/creator", () => {
  const row = mapClickupTaskToRow(
    baseTask({ id: "8689emd23", parent: "8687bymye", folder: undefined, space: undefined, creator: undefined }),
  );
  assert.equal(row.clickup_task_id, "8689emd23");
  assert.equal(row.clickup_parent_id, "8687bymye");
  assert.equal(row.clickup_folder_id, null);
  assert.equal(row.clickup_space_name, null);
  assert.equal(row.clickup_creator_id, null);
});

test("mapClickupTaskToRow refuses a task with no id", () => {
  assert.throws(() => mapClickupTaskToRow(baseTask({ id: "" })), /missing an id/);
  assert.throws(() => mapClickupTaskToRow(null), /task object/);
});

// -------------------------------------------------------------------------------------
// resolveWatermark — the review's fix #1
// -------------------------------------------------------------------------------------
test("resolveWatermark with no prior run does a full pull with no filter", () => {
  assert.deepEqual(resolveWatermark(null), { mode: "full", watermark: null, dateUpdatedGt: null });
  assert.deepEqual(resolveWatermark({}), { mode: "full", watermark: null, dateUpdatedGt: null });
});

test("resolveWatermark uses the prior run's started_at, not finished_at", () => {
  const result = resolveWatermark({
    started_at: "2026-07-28T10:00:00.000Z",
    finished_at: "2026-07-28T10:05:00.000Z",
  });
  assert.equal(result.mode, "incremental");
  assert.equal(result.watermark, "2026-07-28T10:00:00.000Z");
  assert.equal(result.dateUpdatedGt, String(Date.parse("2026-07-28T10:00:00.000Z")));
  // A task edited at 10:02 (mid-run) must still be inside the next window.
  assert.ok(Date.parse("2026-07-28T10:02:00.000Z") > Number(result.dateUpdatedGt));
});

test("resolveWatermark falls back to a full pull on an unparseable timestamp", () => {
  assert.deepEqual(resolveWatermark({ started_at: "never" }), {
    mode: "full",
    watermark: null,
    dateUpdatedGt: null,
  });
});

// -------------------------------------------------------------------------------------
// watermark SQL + parsing
// -------------------------------------------------------------------------------------
test("buildWatermarkSql reads max(started_at) of succeeded clickup runs only", () => {
  const sql = buildWatermarkSql();
  assert.match(sql, /max\(started_at\)/);
  assert.match(sql, /source_system = 'clickup'/);
  assert.match(sql, new RegExp(`source_name = '${SOURCE_NAME}'`));
  assert.match(sql, /status = 'succeeded'/);
  assert.doesNotMatch(sql, /finished_at/);
});

test("parseWatermarkResult reads JSON and psql output, and null when there is no prior run", () => {
  assert.deepEqual(parseWatermarkResult('[{"started_at":"2026-07-28T10:00:00Z"}]'), {
    started_at: "2026-07-28T10:00:00Z",
  });
  const psql = "      started_at\n------------------------\n 2026-07-28 10:00:00+00\n(1 row)\n";
  assert.deepEqual(parseWatermarkResult(psql), { started_at: "2026-07-28 10:00:00+00" });
  assert.equal(parseWatermarkResult(""), null);
  assert.equal(parseWatermarkResult('[{"started_at":null}]'), null);
});

// -------------------------------------------------------------------------------------
// snapshot + SQL construction
// -------------------------------------------------------------------------------------
test("buildImportSql dollar-quotes the snapshot and passes the mode through", () => {
  const snapshot = buildSnapshot({
    mode: "incremental",
    watermark: "2026-07-28T10:00:00.000Z",
    lists: [{ id: "901100", terminalReached: true }],
    tasks: [mapClickupTaskToRow(baseTask())],
  });
  const sql = buildImportSql(snapshot);
  assert.match(sql, /select \* from public\.sync_clickup_tasks\(\$cu_snap\$/);
  assert.match(sql, /\$cu_snap\$::jsonb, 'incremental'\);/);
  assert.match(sql, /8687bymye/);
});

test("buildImportSql never emits a mode the SQL guard would reject", () => {
  const sql = buildImportSql({ mode: "drop everything", lists: [], tasks: [] });
  assert.match(sql, /'incremental'\);/);
});

test("buildFailedSyncRunSql records a durable clickup failure row", () => {
  const sql = buildFailedSyncRunSql("fetch", "HTTP 429");
  assert.match(sql, /insert into ingest\.sync_run/);
  assert.match(sql, /'clickup', 'clickup_tasks_api', 'failed'/);
  assert.match(sql, /\$cu_error\$HTTP 429\$cu_error\$/);
  assert.match(sql, /\$cu_stage\$fetch\$cu_stage\$/);
});

// -------------------------------------------------------------------------------------
// validateSnapshot
// -------------------------------------------------------------------------------------
test("validateSnapshot accepts a clean incremental snapshot", () => {
  const snapshot = buildSnapshot({
    mode: "incremental",
    watermark: "2026-07-28T10:00:00.000Z",
    lists: [{ id: "901100", terminalReached: true }],
    tasks: [mapClickupTaskToRow(baseTask())],
  });
  const decision = validateSnapshot(snapshot);
  assert.equal(decision.ok, true, decision.errors.join("; "));
  assert.deepEqual(decision.counts, { lists: 1, tasks: 1 });
});

test("validateSnapshot allows an empty incremental pull but not an empty full pull", () => {
  const lists = [{ id: "901100", terminalReached: true }];
  assert.equal(validateSnapshot(buildSnapshot({ mode: "incremental", lists, tasks: [] })).ok, true);
  const full = validateSnapshot(buildSnapshot({ mode: "full", lists, tasks: [] }));
  assert.equal(full.ok, false);
  assert.match(full.errors.join("; "), /zero tasks/);
});

test("validateSnapshot refuses a truncated pull so the watermark cannot skip tasks", () => {
  const decision = validateSnapshot(
    buildSnapshot({
      mode: "incremental",
      lists: [{ id: "901100", terminalReached: false }],
      tasks: [mapClickupTaskToRow(baseTask())],
    }),
  );
  assert.equal(decision.ok, false);
  assert.match(decision.errors.join("; "), /terminal page/);
});

test("validateSnapshot refuses duplicate task ids (they would fight over one product row)", () => {
  const task = mapClickupTaskToRow(baseTask());
  const decision = validateSnapshot(
    buildSnapshot({ mode: "full", lists: [{ id: "901100", terminalReached: true }], tasks: [task, task] }),
  );
  assert.equal(decision.ok, false);
  assert.match(decision.errors.join("; "), /duplicate clickup_task_id/);
});

test("validateSnapshot refuses an empty list set", () => {
  const decision = validateSnapshot(buildSnapshot({ mode: "full", lists: [], tasks: [] }));
  assert.equal(decision.ok, false);
  assert.match(decision.errors.join("; "), /non-empty array/);
});

// -------------------------------------------------------------------------------------
// URL construction
// -------------------------------------------------------------------------------------
test("buildTaskUrl sets the incremental filter only when a watermark exists", () => {
  const incremental = buildTaskUrl("901100", { page: 2, dateUpdatedGt: "1753660800000" });
  assert.equal(incremental.searchParams.get("page"), "2");
  assert.equal(incremental.searchParams.get("date_updated_gt"), "1753660800000");
  assert.equal(incremental.searchParams.get("subtasks"), "true");
  assert.equal(incremental.searchParams.get("include_closed"), "true");
  assert.ok(incremental.pathname.endsWith("/list/901100/task"));

  const full = buildTaskUrl("901100", {});
  assert.equal(full.searchParams.has("date_updated_gt"), false);
});

// -------------------------------------------------------------------------------------
// paging (fetch injected)
// -------------------------------------------------------------------------------------
test("fetchListTasks pages until last_page and reports terminalReached", async () => {
  const pages = [
    { tasks: [baseTask({ id: "a" })], last_page: false },
    { tasks: [baseTask({ id: "b" })], last_page: true },
  ];
  let calls = 0;
  const fakeFetch = async () => ({ ok: true, json: async () => pages[calls++] });
  const result = await fetchListTasks("901100", "tok", {}, fakeFetch);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.terminalReached, true);
  assert.deepEqual(result.tasks.map((t) => t.id), ["a", "b"]);
});

test("fetchListTasks treats an empty page as terminal", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ tasks: [] }) });
  const result = await fetchListTasks("901100", "tok", {}, fakeFetch);
  assert.equal(result.terminalReached, true);
  assert.deepEqual(result.tasks, []);
});

test("fetchListTasks raises on a non-OK response instead of silently truncating", async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(() => fetchListTasks("901100", "tok", {}, fakeFetch), /HTTP 429/);
});

// -------------------------------------------------------------------------------------
// run mode + apply targeting
// -------------------------------------------------------------------------------------
test("resolveRunMode defaults to a dry run", () => {
  const mode = resolveRunMode([], {});
  assert.equal(mode.apply, false);
  assert.equal(mode.linked, false);
  assert.equal(mode.allowProduction, false);
  assert.match(mode.target, /dry-run/);
});

test("describeTarget never leaks credentials from DATABASE_URL", () => {
  const described = describeTarget("postgres://user:sup3rsecret@db.example.com:5432/postgres");
  assert.doesNotMatch(described, /sup3rsecret/);
  assert.doesNotMatch(described, /user/);
  assert.match(described, /db\.example\.com:5432/);
});

test("assertApplyTarget is a no-op for a dry run", () => {
  assert.doesNotThrow(() => assertApplyTarget({ apply: false, linked: false, connString: null }));
});

test("assertApplyTarget refuses production without the explicit flag", () => {
  assert.throws(
    () => assertApplyTarget({
      apply: true,
      linked: false,
      connString: `postgres://postgres.${PRODUCTION_PROJECT_REF}:x@aws.pooler.supabase.com:5432/postgres`,
    }),
    /--allow-production/,
  );
});

test("assertApplyTarget allows preview, and production only when explicitly flagged", () => {
  assert.doesNotThrow(() => assertApplyTarget({
    apply: true,
    linked: false,
    connString: `postgres://postgres.${PREVIEW_PROJECT_REF}:x@aws.pooler.supabase.com:5432/postgres`,
  }));
  assert.doesNotThrow(() => assertApplyTarget({
    apply: true,
    linked: true,
    connString: null,
    linkedProjectRef: PRODUCTION_PROJECT_REF,
    allowProduction: true,
  }));
});

test("assertApplyTarget refuses an unknown project and a missing/ambiguous target", () => {
  assert.throws(
    () => assertApplyTarget({ apply: true, linked: false, connString: "postgres://x@somewhere.else/postgres" }),
    /neither the preview project/,
  );
  assert.throws(() => assertApplyTarget({ apply: true, linked: false, connString: null }), /without a database target/);
  assert.throws(
    () => assertApplyTarget({ apply: true, linked: true, connString: "postgres://x@y/z" }),
    /choose one explicit target/,
  );
});
