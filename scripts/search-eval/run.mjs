#!/usr/bin/env node
// Re-runs the judged search test against live PopDAM and PopSG search as the viewer tester.
// Cheap: about 100 searches, one at a time, no AI tagging or paid model calls.
// Env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SEARCH_EVAL_EMAIL, SEARCH_EVAL_PASSWORD
// Options: --cases <file> (instead of the database copy), --raw <file> (full hit ids, private;
// never commit it), --report <file> (aggregate only, safe to share), --label <text>.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { scoreSearch, summarize, trustWarning } from "./score.mjs";
import { createViewerSession, ViewerAuthenticationError } from "./viewer-session.mjs";

const SET_KEY = "SEARCH_EVAL_SET_V1";
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const url = need("SUPABASE_URL").replace(/\/$/, "");
const key = need("SUPABASE_PUBLISHABLE_KEY");

async function post(path, body, token, timeoutMs = 30_000) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return JSON.parse(text);
}

const getToken = createViewerSession({
  authenticate: () => post("/auth/v1/token?grant_type=password", {
    email: need("SEARCH_EVAL_EMAIL"),
    password: need("SEARCH_EVAL_PASSWORD"),
  }),
});

async function viewerPost(path, body, timeoutMs) {
  return post(path, body, await getToken(), timeoutMs);
}

async function loadSet() {
  const file = arg("cases");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const res = await fetch(`${url}/rest/v1/admin_config?key=eq.${SET_KEY}&select=value`, {
    headers: { apikey: key, Authorization: `Bearer ${await getToken()}` },
    signal: AbortSignal.timeout(30_000),
  });
  const rows = await res.json();
  if (!res.ok || !rows[0]) throw new Error(`Could not read ${SET_KEY}`);
  return rows[0].value;
}

async function timed(fn) {
  const started = Date.now();
  try {
    return { ...(await fn()), ms: Date.now() - started, error: null };
  } catch (error) {
    return { hits: [], total: 0, ms: Date.now() - started, error: String(error?.message ?? error) };
  }
}

const damSearch = (query) => timed(async () => {
  const data = await viewerPost("/functions/v1/dam-search-ai", {
    action: "search", query, limit: 50, offset: 0, filters: {}, min_rank: 0, document_types: ["style_group"],
  }, 45_000);
  return { hits: data.results.map((r) => r.entity_id), total: data.total_count };
});

// Same expansion and query text as src/pages/popsg/PopSGLibraryPage.tsx.
async function popsgQuery(query) {
  const variants = new Set();
  const add = (value) => {
    const v = value.trim().toLowerCase();
    if (!v) return;
    variants.add(v);
    if (v.includes("-")) variants.add(v.replace(/-/g, " "));
    if (/\s/.test(v)) variants.add(v.replace(/\s+/g, "-"));
  };
  const term = query.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  add(term);
  const rows = await viewerPost("/rest/v1/rpc/expand_dam_search_queries", { p_query: term });
  for (const row of rows ?? []) if (row?.query_text) add(row.query_text);
  const spelling = await viewerPost("/functions/v1/dam-search-ai", { action: "spelling", query: term }).catch((error) => {
    if (error instanceof ViewerAuthenticationError || error.status === 401 || error.status === 403) throw error;
    return null;
  });
  if (typeof spelling?.corrected === "string") add(spelling.corrected);
  return [...variants]
    .map((t) => t.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t, i) => (i === 0 ? t : `"${t}"`))
    .join(" OR ");
}

// Kept only in the private --raw file, to judge results that are not judged yet.
const sgDetail = (r) => ({
  licensor: r.licensor_name,
  property: r.property_folder,
  guide: r.style_guide_name,
  path: r.relative_path ?? null,
  thumbnail: r.thumbnail_url ?? null,
  tags: r.tag_names ?? [],
});

const sgSearch = (query, mode) => timed(async () => {
  const p_query = await popsgQuery(query);
  const data = await viewerPost("/rest/v1/rpc/search_style_guide_library_v2", {
    p_result_mode: mode, p_query, p_sort: "relevance", p_limit: 50, p_offset: 0,
  }, 45_000);
  const results = data.results ?? [];
  const hits = results.map((r) => (mode === "guides" ? r.guide_key : r.style_guide_file_id));
  return { hits, total: data.total ?? hits.length, details: results.map(sgDetail) };
});

const set = await loadSet();
const rows = { dam: [], sg_guides: [], sg_files: [] };
const checkpoint = arg("checkpoint");
const setHash = createHash("sha256").update(JSON.stringify(set)).digest("hex");
const saved = checkpoint && existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : null;
if (saved && saved.set_hash !== setHash) throw new Error("Checkpoint belongs to a different judged set");
const raw = saved?.raw ?? {};
const persist = () => {
  if (checkpoint) writeFileSync(checkpoint, JSON.stringify({ set_hash: setHash, raw }), { mode: 0o600 });
};
for (const testCase of set.cases) {
  raw[testCase.id] ??= {};
  const runs = raw[testCase.id];
  if (testCase.dam && !runs.dam) { runs.dam = await damSearch(testCase.query); persist(); }
  if (testCase.sg_guides && !runs.sg_guides) { runs.sg_guides = await sgSearch(testCase.query, "guides"); persist(); }
  if (testCase.sg_files && !runs.sg_files) { runs.sg_files = await sgSearch(testCase.query, "files"); persist(); }
  for (const [engine, run] of Object.entries(runs)) {
    raw[testCase.id][engine] = run;
    rows[engine].push(scoreSearch(testCase, testCase[engine], run.hits, run));
  }
}

const report = { set_hash: setHash, label: arg("label"), set_version: set.version, checked_at: new Date().toISOString(), engines: {} };
for (const [engine, engineRows] of Object.entries(rows)) {
  if (!engineRows.length) continue;
  const summary = summarize(engineRows);
  report.engines[engine] = {
    ...summary,
    errors_by_type: engineRows.reduce((counts, row) => {
      if (row.error) counts[row.error] = (counts[row.error] ?? 0) + 1;
      return counts;
    }, {}),
    warning: trustWarning(summary),
    failed_case_ids: engineRows.filter((r) => !r.pass).map((r) => r.id),
  };
}
if (arg("raw")) writeFileSync(arg("raw"), JSON.stringify({ raw, rows }, null, 1));
if (arg("report")) writeFileSync(arg("report"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
