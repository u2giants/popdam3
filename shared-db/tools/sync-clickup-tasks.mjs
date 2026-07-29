#!/usr/bin/env node
// Operational runner for the incremental ClickUp -> pim.product task import.
//
// Pulls every configured ClickUp list with `date_updated_gt=<watermark>`, builds one
// JSON snapshot, and calls public.sync_clickup_tasks(snapshot, mode) — the SECURITY
// DEFINER importer added in migration 20260728160000_clickup_incremental_task_import.sql.
//
// Design notes
// ------------
// * WATERMARK. The cutoff for the next run is the PREVIOUS successful run's stored
//   watermark_at (in ingest.sync_run.metadata), which THIS runner captures as a PRE-FETCH
//   timestamp (before any ClickUp API call) and passes through the snapshot as
//   fetch_started_at. The SQL function stores that timestamp minus a 60s overlap as
//   watermark_at. A task edited while the run is in flight has date_updated inside the
//   window; the pre-fetch watermark + overlap re-reads it, and the upsert makes that free.
//   On partial failure (rows_failed > 0) the function does NOT advance the watermark, so
//   failed rows are retried; snapshot.skip_task_ids (CLICKUP_SKIP_TASK_IDS) is the escape
//   hatch for permanently-bad ids.
// * FIRST RUN. No prior successful run means no watermark, which means mode 'full'
//   and no date_updated_gt filter — that full pull is also what reconciles the legacy
//   rows the 20260728160000 backfill claimed onto (external_source, external_id).
// * NO ROW-BY-ROW JS WRITES. Like every other sync in this repo, JS only builds and
//   validates the snapshot; all upserting, guarding and run accounting is SQL.
// * DRY-RUN IS THE DEFAULT. --apply is required to write anything.
// * EXIT CODES. --apply exits 0 only on a clean, non-locked run. It exits non-zero when
//   another run held the advisory lock (nothing moved) or when rows_failed > 0 (partial
//   failure; watermark not advanced), so a scheduled job does not report green on no work.
//   Dry-run behaviour is unchanged (always exits 0).
//
// Usage:
//   CLICKUP_LIST_IDS=a,b,c DATABASE_URL=postgres://... node tools/sync-clickup-tasks.mjs
//   CLICKUP_LIST_IDS=a,b,c DATABASE_URL=postgres://... node tools/sync-clickup-tasks.mjs --apply
//   CLICKUP_LIST_IDS=a,b,c                            node tools/sync-clickup-tasks.mjs --apply --linked
//
// ClickUp token: env CLICKUP_API_TOKEN, else
//   `op read "op://vibe_coding/clickup.com API credentials/api token"`.
// The token is NEVER printed, never written into SQL, and never committed.

import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runSql, sqlDollarQuote } from "./coldlion-sync-common.mjs";
import { extractGoMapText, parseGoMap } from "./phase6-cli-result-parse.mjs";

// =====================================================================================
// CONFIG
// =====================================================================================
export const SOURCE_SYSTEM = "clickup";
export const SOURCE_NAME = "clickup_tasks_api";
export const CLICKUP_BASE_URL = process.env.CLICKUP_BASE_URL ?? "https://api.clickup.com/api/v2";
export const CLICKUP_TOKEN_REF = "op://vibe_coding/clickup.com API credentials/api token";
export const CLICKUP_WORKSPACE_REF = "op://vibe_coding/clickup.com API credentials/workspace id";
export const PREVIEW_PROJECT_REF = "rjyboqwcdzcocqgmsyel";
export const PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai";

// Non-zero exit codes so a scheduled job does not look green when nothing moved. Distinct
// values distinguish the two "did not complete cleanly" outcomes (defect 5).
export const EXIT_LOCKED = 2;          // another importer held the advisory lock; no data moved
export const EXIT_PARTIAL_FAILURE = 1; // rows_failed > 0; watermark NOT advanced (rows retried)

// The five target ClickUp lists. These ids were resolved ONCE from the live ClickUp API
// on 2026-07-28 (`node tools/sync-clickup-tasks.mjs --discover-lists`, 23 lists in the
// workspace) — they are not guesses. They stay overridable via CLICKUP_LIST_IDS
// (comma-separated, each optionally "id=Label") because list membership is operations
// config, not a constant: adding a sixth list must not need a code change.
//   13194624     Licensing Management        (POP Creations / Design Management)
//   901104141567 Sourcing/Sampling Projects  (POP Creations / Design Management)
//   901103451188 New Prod Development        (POP Creations / Design Management)
//   15061776     Edge Generic                (Spruce Line / Edge Home Folder)
//   901113451000 Sprint 1                    (designflow / Development)
export const DEFAULT_LIST_IDS = [
  "13194624=Licensing Management",
  "901104141567=Sourcing/Sampling Projects",
  "901103451188=New Prod Development",
  "15061776=Edge Generic",
  "901113451000=Sprint 1",
].join(",");

export const CONFIG = {
  lists: parseListConfig(process.env.CLICKUP_LIST_IDS ?? DEFAULT_LIST_IDS),
  includeClosed: (process.env.CLICKUP_INCLUDE_CLOSED ?? "true") !== "false",
  includeSubtasks: (process.env.CLICKUP_INCLUDE_SUBTASKS ?? "true") !== "false",
  maxPages: Number(process.env.CLICKUP_MAX_PAGES ?? 500),
  // Defect 2 escape hatch: acknowledged permanently-bad ClickUp task ids. The SQL importer
  // skips these wholesale (counted as rows_skipped, never rows_failed), so they cannot wedge
  // the watermark. Remove an id from the env to re-enable automatic retry of it.
  skipTaskIds: parseSkipTaskIds(process.env.CLICKUP_SKIP_TASK_IDS),
};

// =====================================================================================
// Pure helpers (no network, no DB) — unit tested.
// =====================================================================================

// "123=Licensing Management,456" -> [{id:"123",name:"Licensing Management"},{id:"456",name:null}]
export function parseListConfig(raw) {
  return String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf("=");
      if (eq === -1) return { id: entry, name: null };
      return { id: entry.slice(0, eq).trim(), name: entry.slice(eq + 1).trim() || null };
    })
    .filter((l) => l.id !== "");
}

// Comma-separated ClickUp task ids -> trimmed, non-empty id list (defect 2 escape hatch).
export function parseSkipTaskIds(raw) {
  return String(raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

// ClickUp returns epoch milliseconds as a STRING. Anything non-numeric becomes null
// rather than an Invalid Date that would poison the snapshot.
export function msToIso(value) {
  if (value === null || value === undefined || value === "") return null;
  const ms = Number(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// ClickUp task JSON -> the flat snapshot row shape pim.sync_clickup_tasks consumes.
// Every field is ClickUp-NATIVE. Custom fields (buyer/licensor/customer/factory) are
// deliberately out of scope for this pass; the whole task is still preserved in `raw`
// so a later pass can map them without a re-pull.
export function mapClickupTaskToRow(task) {
  if (!task || typeof task !== "object") {
    throw new Error("mapClickupTaskToRow expects a ClickUp task object");
  }
  const id = task.id === null || task.id === undefined ? "" : String(task.id).trim();
  if (id === "") throw new Error("ClickUp task is missing an id");

  const status = task.status ?? {};
  const creator = task.creator ?? {};
  const str = (v) => (v === null || v === undefined || v === "" ? null : String(v));

  return {
    clickup_task_id: id,
    name: str(task.name),
    clickup_parent_id: str(task.parent),
    clickup_status: str(status.status),
    clickup_status_type: str(status.type),
    clickup_status_color: str(status.color),
    clickup_status_order: str(status.orderindex),
    clickup_space_id: str(task.space?.id),
    clickup_space_name: str(task.space?.name),
    clickup_folder_id: str(task.folder?.id),
    clickup_folder_name: str(task.folder?.name),
    clickup_list_id: str(task.list?.id),
    clickup_list_name: str(task.list?.name),
    clickup_creator_id: str(creator.id),
    clickup_creator_name: str(creator.username),
    clickup_time_estimate_ms: str(task.time_estimate),
    clickup_orderindex: str(task.orderindex),
    clickup_date_created: msToIso(task.date_created),
    clickup_date_updated: msToIso(task.date_updated),
    clickup_date_closed: msToIso(task.date_closed),
    raw: task,
  };
}

// Decide the run mode + the ClickUp date_updated_gt cutoff from the prior successful run.
// `lastSyncRun` is { started_at } or null. Returns { mode, watermark, dateUpdatedGt }.
export function resolveWatermark(lastSyncRun) {
  const startedAt = lastSyncRun?.started_at ?? lastSyncRun?.startedAt ?? null;
  if (!startedAt) return { mode: "full", watermark: null, dateUpdatedGt: null };
  const parsed = new Date(startedAt);
  if (Number.isNaN(parsed.getTime())) {
    return { mode: "full", watermark: null, dateUpdatedGt: null };
  }
  return {
    mode: "incremental",
    watermark: parsed.toISOString(),
    // ClickUp wants epoch milliseconds. `_gt` is strict, so re-reading the boundary
    // task is not a risk; missing one is, hence started_at rather than finished_at.
    dateUpdatedGt: String(parsed.getTime()),
  };
}

export function buildWatermarkSql() {
  // The next run's cutoff is the watermark_at the previous successful run STORED (not its
  // started_at). A partial-failure run keeps status 'succeeded' but stores a non-advancing
  // watermark_at, so reading the latest run's stored value re-pulls the failed rows.
  return `select s.metadata ->> 'watermark_at' as started_at
from ingest.sync_run s
where s.source_system = '${SOURCE_SYSTEM}'
  and s.source_name = '${SOURCE_NAME}'
  and s.status = 'succeeded'
  and s.metadata ? 'watermark_at'
order by s.started_at desc nulls last
limit 1;\n`;
}

// Parse the single started_at cell out of either `supabase db query` JSON or psql text.
export function parseWatermarkResult(stdout) {
  if (!stdout || !stdout.trim()) return null;
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const row = Array.isArray(parsed) ? parsed[0] : Array.isArray(parsed?.rows) ? parsed.rows[0] : parsed;
    const value = row?.started_at ?? null;
    return value ? { started_at: value } : null;
  } catch {
    // psql text output.
  }
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes("started_at")) continue;
    if (/^[-+\s|│]*$/.test(line)) continue;
    if (/^\(/.test(line)) continue;
    const cell = line.split(/[|│]/)[0].trim();
    if (!cell) continue;
    if (Number.isNaN(new Date(cell).getTime())) continue;
    return { started_at: cell };
  }
  return null;
}

export function buildSnapshot({ mode, watermark, lists, tasks, fetchStartedAt, skipTaskIds }) {
  return {
    source: SOURCE_SYSTEM,
    mode,
    watermark: watermark ?? null,
    // Defect 1: the PRE-FETCH instant, captured before any ClickUp API call. The SQL
    // function stores this (minus a 60s overlap) as the next run's date_updated_gt.
    fetch_started_at: fetchStartedAt ?? null,
    lists,
    tasks,
    // Defect 2 escape hatch: acknowledged permanently-bad ids.
    skip_task_ids: Array.isArray(skipTaskIds)
      ? [...new Set(skipTaskIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
      : [],
  };
}

export function buildImportSql(snapshot) {
  const mode = snapshot?.mode === "full" ? "full" : "incremental";
  // Emit a single jsonb cell so the runner can parse locked / rows_failed reliably from
  // every result shape `runSql` can return: clean JSON (`supabase db query`), the Go
  // map[...] dump the hosted CLI renders for jsonb, and psql aligned text.
  return `select to_jsonb(t) as result from public.sync_clickup_tasks(${sqlDollarQuote("cu_snap", snapshot)}::jsonb, '${mode}') t;\n`;
}

// Parse the importer result row (locked / rows_failed / counters) from any runSql output
// shape. Fail-closed: returns null when no `locked` boolean can be confirmed, so the runner
// never mistakes a parse failure for a clean run. Reuses the proven Phase 6 CLI parser for
// the Go map[...] cell form (defect 5).
export function parseImportResult(stdout) {
  if (!stdout || !String(stdout).trim()) return null;
  const trimmed = String(stdout).trim();

  let row = null;
  try {
    row = normalizeResultRow(JSON.parse(trimmed));
  } catch {
    // not pure JSON
  }
  if (isValidResult(row)) return coerceResult(row);

  // JSON object embedded in CLI/table noise ([\s\S] tolerates psql line wrapping).
  const m = trimmed.match(/\{[\s\S]*?"locked"\s*:\s*(true|false)[\s\S]*?\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      if (isValidResult(obj)) return coerceResult(obj);
    } catch {
      // fall through
    }
  }

  // Go-style map[...] cell (Ubuntu hosted `supabase db query` renders jsonb this way).
  const mapText = extractGoMapText(trimmed);
  if (mapText) {
    const obj = parseGoMap(mapText);
    if (isValidResult(obj)) return coerceResult(obj);
  }

  // psql aligned table (dev DATABASE_URL path): split header + first data row on pipes.
  const tableRow = parsePsqlTableRow(trimmed);
  if (isValidResult(tableRow)) return coerceResult(tableRow);

  return null;
}

function normalizeResultRow(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (Array.isArray(parsed)) return unwrapResultCell(parsed[0]);
  if (Array.isArray(parsed.rows)) return unwrapResultCell(parsed.rows[0]);
  if (parsed.result && typeof parsed.result === "object") return parsed.result;
  return parsed;
}

function unwrapResultCell(row) {
  if (!row || typeof row !== "object") return null;
  if ("locked" in row) return row;
  if (row.result && typeof row.result === "object") return row.result;
  if (typeof row.result === "string") {
    try { return JSON.parse(row.result); } catch { return null; }
  }
  const first = Object.values(row)[0];
  if (first && typeof first === "object") return first;
  if (typeof first === "string") { try { return JSON.parse(first); } catch { return null; } }
  return row;
}

function isValidResult(obj) {
  return !!obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj.locked === "boolean";
}

function coerceResult(obj) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v)
    ? v : Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    sync_run_id: obj.sync_run_id ?? null,
    mode: obj.mode ?? null,
    locked: obj.locked === true,
    rows_seen: num(obj.rows_seen),
    rows_inserted: num(obj.rows_inserted),
    rows_updated: num(obj.rows_updated),
    rows_unchanged: num(obj.rows_unchanged),
    rows_failed: num(obj.rows_failed),
    watermark_at: obj.watermark_at ?? null,
    snapshot_hash: obj.snapshot_hash ?? null,
  };
}

function parsePsqlTableRow(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.includes("locked") && l.includes("rows_failed"));
  if (!header) return null;
  const cols = header.split("|").map((c) => c.trim());
  const lockedIdx = cols.indexOf("locked");
  if (lockedIdx < 0) return null;
  const headerIdx = lines.indexOf(header);
  const dataLine = lines
    .slice(headerIdx + 1)
    .find((l) => (l.match(/\|/g) || []).length >= cols.length - 1
      && !/^[|\s-]+$/.test(l)
      && !/^\s*\(\d+ rows?\)/.test(l));
  if (!dataLine) return null;
  const cells = dataLine.split("|").map((c) => c.trim());
  const get = (name) => { const i = cols.indexOf(name); return i >= 0 ? cells[i] : undefined; };
  return {
    locked: get("locked") === "t",
    rows_failed: Number(get("rows_failed") ?? "0") || 0,
    rows_seen: Number(get("rows_seen") ?? "0") || 0,
  };
}

// Durable failure row, recorded by the RUNNER in its own transaction (the in-function
// failed sync_run rolls back with the aborted import). Mirrors the ColdLion pattern but
// with source_system 'clickup'.
export function buildFailedSyncRunSql(stage, message) {
  const error = String(message ?? "").slice(0, 4000);
  return `insert into ingest.sync_run
  (source_system, source_name, status, started_at, finished_at, error, metadata)
values ('${SOURCE_SYSTEM}', '${SOURCE_NAME}', 'failed', now(), now(),
  ${sqlDollarQuote("cu_error", error)},
  jsonb_build_object('recorded_by','clickup sync runner','stage',${sqlDollarQuote("cu_stage", stage)}));
`;
}

// Caller-side validation, defence in depth against the SQL guards.
export function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, errors: ["snapshot must be an object"], counts: {} };
  }
  if (!Array.isArray(snapshot.lists) || snapshot.lists.length === 0) {
    errors.push("snapshot.lists must be a non-empty array");
  }
  if (!Array.isArray(snapshot.tasks)) errors.push("snapshot.tasks must be an array");
  if (errors.length) return { ok: false, errors, counts: {} };

  for (const list of snapshot.lists) {
    if (list.terminalReached !== true) {
      errors.push(`list ${list.id} did not reach a terminal page — refusing to advance the watermark`);
    }
  }
  if (snapshot.mode === "full" && snapshot.tasks.length === 0) {
    errors.push("full-mode pull returned zero tasks");
  }
  const seen = new Set();
  for (const task of snapshot.tasks) {
    const id = task?.clickup_task_id;
    if (!id) errors.push("a snapshot task is missing clickup_task_id");
    else if (seen.has(id)) errors.push(`duplicate clickup_task_id in snapshot: ${id}`);
    else seen.add(id);
  }
  return {
    ok: errors.length === 0,
    errors,
    counts: { lists: snapshot.lists.length, tasks: snapshot.tasks.length },
  };
}

export function describeTarget(connString, { linked = false } = {}) {
  if (linked) return "supabase --linked (project resolved by `supabase link`)";
  if (!connString) return "none (dry-run; set DATABASE_URL or pass --linked to apply)";
  try {
    const u = new URL(connString);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.hostname}:${u.port || "(default)"}${u.pathname}`;
  } catch {
    return "unparseable DATABASE_URL (credentials hidden)";
  }
}

export function resolveRunMode(argv = process.argv.slice(2), env = process.env) {
  const args = new Set(argv);
  const apply = args.has("--apply");
  const linked = args.has("--linked");
  const connString = env.DATABASE_URL ?? env.SUPABASE_DB_URL ?? null;
  return {
    apply,
    linked,
    discoverLists: args.has("--discover-lists"),
    allowProduction: args.has("--allow-production"),
    connString,
    target: describeTarget(connString, { linked }),
  };
}

// Production is a deliberate, explicitly-flagged act. Everything else is preview.
export function assertApplyTarget({ apply, linked, connString, linkedProjectRef = null, allowProduction = false }) {
  if (!apply) return;
  if (linked && connString) {
    throw new Error("Refusing --apply with both --linked and DATABASE_URL; choose one explicit target");
  }
  const ref = linked ? linkedProjectRef : connString;
  if (!ref) {
    throw new Error("Refusing --apply without a database target; pass --linked or set DATABASE_URL");
  }
  const identity = String(ref);
  if (identity.includes(PRODUCTION_PROJECT_REF) && !allowProduction) {
    throw new Error(
      `Refusing --apply to production project ${PRODUCTION_PROJECT_REF} without an explicit --allow-production flag`,
    );
  }
  if (!identity.includes(PRODUCTION_PROJECT_REF) && !identity.includes(PREVIEW_PROJECT_REF)) {
    throw new Error(
      `Refusing --apply: target identifies neither the preview project ${PREVIEW_PROJECT_REF} nor production`,
    );
  }
}

// Build the paged ClickUp task URL for one list.
export function buildTaskUrl(listId, { page = 0, dateUpdatedGt = null, includeClosed = true, includeSubtasks = true } = {}) {
  const url = new URL(`${CLICKUP_BASE_URL}/list/${encodeURIComponent(listId)}/task`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("order_by", "updated");
  url.searchParams.set("reverse", "true");
  if (includeSubtasks) url.searchParams.set("subtasks", "true");
  if (includeClosed) url.searchParams.set("include_closed", "true");
  if (dateUpdatedGt) url.searchParams.set("date_updated_gt", String(dateUpdatedGt));
  return url;
}

// =====================================================================================
// Credential + network (not unit-tested for live behaviour).
// =====================================================================================
function readOpRef(ref, envValue, envName) {
  if (envValue) return envValue;
  const result = spawnSync("op", ["read", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${envName} is not set and \`op read\` failed for the documented 1Password reference.`);
  }
  return result.stdout.trim();
}

export function readClickupApiToken() {
  return readOpRef(CLICKUP_TOKEN_REF, process.env.CLICKUP_API_TOKEN, "CLICKUP_API_TOKEN");
}

export function readClickupWorkspaceId() {
  return readOpRef(CLICKUP_WORKSPACE_REF, process.env.CLICKUP_WORKSPACE_ID, "CLICKUP_WORKSPACE_ID");
}

// Page one list to exhaustion. ClickUp signals the end with last_page:true, and also
// (older behaviour) with an empty tasks array — both are treated as terminal.
export async function fetchListTasks(listId, token, opts = {}, fetchImpl = fetch) {
  const tasks = [];
  let page = 0;
  let terminalReached = false;
  for (; page < CONFIG.maxPages; page += 1) {
    const url = buildTaskUrl(listId, { ...opts, page });
    const response = await fetchImpl(url, { headers: { Authorization: token, "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(`ClickUp list ${listId} page ${page} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.tasks)) {
      throw new Error(`ClickUp list ${listId} page ${page} did not return a tasks array`);
    }
    tasks.push(...payload.tasks);
    if (payload.last_page === true || payload.tasks.length === 0) {
      terminalReached = true;
      page += 1;
      break;
    }
  }
  if (!terminalReached) {
    throw new Error(`ClickUp list ${listId} exceeded CLICKUP_MAX_PAGES=${CONFIG.maxPages} without a terminal page`);
  }
  return { tasks, terminalReached, pagesFetched: page };
}

// One-time helper: print every list id/name in the workspace so CLICKUP_LIST_IDS can be
// filled in from real ids instead of guesses. Prints ids only, never the token.
async function discoverLists(token, workspaceId, fetchImpl = fetch) {
  const get = async (path) => {
    const response = await fetchImpl(`${CLICKUP_BASE_URL}${path}`, { headers: { Authorization: token } });
    if (!response.ok) throw new Error(`GET ${path} returned HTTP ${response.status}`);
    return response.json();
  };
  const out = [];
  const { spaces = [] } = await get(`/team/${encodeURIComponent(workspaceId)}/space?archived=false`);
  for (const space of spaces) {
    const { lists: folderless = [] } = await get(`/space/${space.id}/list?archived=false`);
    for (const list of folderless) {
      out.push({ list_id: list.id, list_name: list.name, folder: null, space: space.name });
    }
    const { folders = [] } = await get(`/space/${space.id}/folder?archived=false`);
    for (const folder of folders) {
      for (const list of folder.lists ?? []) {
        out.push({ list_id: list.id, list_name: list.name, folder: folder.name, space: space.name });
      }
    }
  }
  return out;
}

function readLinkedProjectRefSafely() {
  try {
    return readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim();
  } catch {
    return null;
  }
}

async function main() {
  const run = resolveRunMode(process.argv.slice(2), process.env);
  const token = readClickupApiToken();

  if (run.discoverLists) {
    const lists = await discoverLists(token, readClickupWorkspaceId());
    process.stdout.write(`${JSON.stringify({ lists }, null, 2)}\n`);
    return;
  }

  if (CONFIG.lists.length === 0) {
    throw new Error(
      "CLICKUP_LIST_IDS is empty. Set it to the comma-separated ClickUp list ids to sync " +
        "(run with --discover-lists to print every id/name in the workspace).",
    );
  }

  const linkedProjectRef = run.linked ? readLinkedProjectRefSafely() : null;
  assertApplyTarget({ ...run, linkedProjectRef });

  process.stdout.write(`${JSON.stringify({
    target: run.target,
    mode: run.apply ? "apply" : "dry-run (no DB write)",
    source_name: SOURCE_NAME,
    lists: CONFIG.lists,
  }, null, 2)}\n`);

  // Defect 1: capture the fetch-start instant BEFORE any ClickUp API call. The SQL
  // function stores this (minus a 60s overlap) as the next run's date_updated_gt, so a
  // task edited while this run is still pulling lists is re-read instead of lost forever.
  const fetchStartedAt = new Date().toISOString();

  let stage = "watermark";
  try {
    // Watermark read needs a DB target. Without one (pure dry run) we do a full pull.
    let last = null;
    if (run.connString || run.linked) {
      last = parseWatermarkResult(runSql(buildWatermarkSql(), { linked: run.linked }));
    }
    const { mode, watermark, dateUpdatedGt } = resolveWatermark(last);
    process.stdout.write(`${JSON.stringify({ mode, watermark }, null, 2)}\n`);

    stage = "fetch";
    const lists = [];
    const tasks = [];
    for (const list of CONFIG.lists) {
      const result = await fetchListTasks(list.id, token, {
        dateUpdatedGt,
        includeClosed: CONFIG.includeClosed,
        includeSubtasks: CONFIG.includeSubtasks,
      });
      lists.push({
        id: list.id,
        name: list.name,
        pagesFetched: result.pagesFetched,
        terminalReached: result.terminalReached,
        rowCount: result.tasks.length,
      });
      for (const task of result.tasks) tasks.push(mapClickupTaskToRow(task));
      process.stdout.write(`${JSON.stringify({
        list_id: list.id,
        list_name: list.name,
        pages_fetched: result.pagesFetched,
        rows_seen: result.tasks.length,
      })}\n`);
    }

    // ClickUp returns a subtask under every list it is visible in; dedupe on task id,
    // keeping the last copy (they are identical payloads).
    const byId = new Map();
    for (const task of tasks) byId.set(task.clickup_task_id, task);
    const snapshot = buildSnapshot({
      mode,
      watermark,
      lists,
      tasks: [...byId.values()],
      fetchStartedAt,
      skipTaskIds: CONFIG.skipTaskIds,
    });

    stage = "validate";
    const decision = validateSnapshot(snapshot);
    if (!decision.ok) throw new Error(`Refusing to apply: ${decision.errors.join("; ")}`);

    process.stdout.write(`${JSON.stringify({
      counts: decision.counts,
      skip_task_ids: snapshot.skip_task_ids,
      apply: run.apply,
    }, null, 2)}\n`);

    if (run.apply) {
      stage = "apply";
      const raw = runSql(buildImportSql(snapshot), { linked: run.linked });
      process.stdout.write(raw);

      // Defect 5: act on the result instead of printing and ignoring it. A scheduled job
      // must not report green when another run held the lock or when rows failed.
      const result = parseImportResult(raw);
      if (result?.locked) {
        process.stderr.write(
          "ClickUp sync skipped: another importer held the advisory lock, so no data moved. Re-run later.\n",
        );
        process.exitCode = EXIT_LOCKED;
        return;
      }
      if (result && result.rows_failed > 0) {
        process.stderr.write(
          `ClickUp sync completed with ${result.rows_failed} failed row(s); the watermark was NOT advanced ` +
            "and those rows will be retried next run. Inspect ingest.sync_run metadata.errors; if a task is " +
            "permanently malformed, add its id to CLICKUP_SKIP_TASK_IDS to stop retrying it.\n",
        );
        process.exitCode = EXIT_PARTIAL_FAILURE;
        return;
      }
      if (!result) {
        process.stderr.write(
          "WARNING: could not parse the importer result to verify locked/rows_failed; inspect the output above.\n",
        );
      }
    } else {
      process.stdout.write(`${JSON.stringify({ sample_row: snapshot.tasks[0] ?? null }, null, 2)}\n`);
      process.stdout.write("Dry-run complete. No database write performed. Re-run with --apply to import.\n");
    }
  } catch (error) {
    if (run.apply) {
      try {
        runSql(buildFailedSyncRunSql(stage, error?.message ?? String(error)), { linked: run.linked });
      } catch (recErr) {
        process.stderr.write(`WARNING: could not record durable failure: ${recErr?.message ?? recErr}\n`);
      }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`ClickUp task sync failed: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
