#!/usr/bin/env node
// Per-step search timing (#804). Runs the judged Search test set queries as the
// viewer tester and reports p50/p95 per step. PopDAM steps come from the
// dam-search-ai Server-Timing header; PopSG steps are the separate calls the
// live page makes, timed here. Prints aggregate timings only (no results).
// Env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SEARCH_EVAL_EMAIL, SEARCH_EVAL_PASSWORD
// Options: --repeat <n> (default 1), --out <file> (JSON summary)
import { writeFileSync } from "node:fs";
import { createViewerSession } from "./viewer-session.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const need = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const url = need("SUPABASE_URL").replace(/\/$/, "");
const key = need("SUPABASE_PUBLISHABLE_KEY");

async function post(path, body, token, withTiming = false) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const data = JSON.parse(text);
  return withTiming ? { data, timing: res.headers.get("server-timing") } : data;
}
const getToken = createViewerSession({
  authenticate: () => post("/auth/v1/token?grant_type=password", { email: need("SEARCH_EVAL_EMAIL"), password: need("SEARCH_EVAL_PASSWORD") }),
});
const vp = async (path, body, withTiming) => post(path, body, await getToken(), withTiming);
const now = () => performance.now();
async function clock(steps, name, fn) { const t = now(); try { return await fn(); } finally { steps[name] = (steps[name] ?? 0) + now() - t; } }

const samples = { dam: [], sg_guides: [], sg_files: [] };

async function dam(query) {
  const t = now();
  const { timing } = await vp("/functions/v1/dam-search-ai", {
    action: "search", query, limit: 50, offset: 0, filters: {}, min_rank: 0, document_types: ["style_group"],
  }, true);
  const steps = { end_to_end: now() - t };
  for (const part of (timing ?? "").split(",")) {
    const m = part.trim().match(/^([\w]+);dur=([\d.]+)/);
    if (m) steps[m[1]] = Number(m[2]);
  }
  if (steps.total != null) steps.network_and_platform = steps.end_to_end - steps.total;
  samples.dam.push(steps);
}

// Same call order as run.mjs sgSearch / the live PopSG page.
async function sg(query, mode) {
  const steps = {}; const t = now();
  const sem = await clock(steps, "embedding_call", () => vp("/functions/v1/dam-search-ai", { action: "popsg-query-embedding", query: query.trim() }));
  const term = query.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  const variants = new Set([term.toLowerCase()]);
  const rows = await clock(steps, "expand_rpc", () => vp("/rest/v1/rpc/expand_dam_search_queries", { p_query: term }));
  for (const r of rows ?? []) if (r?.query_text) variants.add(r.query_text.toLowerCase());
  const sp = await clock(steps, "spelling_call", () => vp("/functions/v1/dam-search-ai", { action: "spelling", query: term }).catch(() => null));
  if (typeof sp?.corrected === "string") variants.add(sp.corrected.toLowerCase());
  if (typeof sem?.expansion === "string" && sem.expansion.trim()) variants.add(sem.expansion.trim().toLowerCase());
  const q = [...variants].map((v) => v.replace(/["\\]/g, " ").trim()).filter(Boolean).map((v, i) => (i ? `"${v}"` : v)).join(" OR ");
  const vec = Array.isArray(sem?.embedding) && sem.embedding.length === 768 ? `[${sem.embedding.join(",")}]` : null;
  await clock(steps, "library_rpc", () => vp("/rest/v1/rpc/search_style_guide_library_v2", {
    p_result_mode: mode, p_query: q, p_sort: "relevance", p_limit: 50, p_offset: 0, p_include_facets: false,
    ...(vec ? { p_query_embedding: vec } : {}),
    ...(vec && typeof sem.min_semantic_score === "number" ? { p_min_semantic_score: sem.min_semantic_score } : {}),
  }));
  steps.end_to_end = now() - t;
  samples[mode === "guides" ? "sg_guides" : "sg_files"].push(steps);
}

const cfg = await (await fetch(`${url}/rest/v1/admin_config?key=eq.SEARCH_EVAL_SET_V1&select=value`, {
  headers: { apikey: key, Authorization: `Bearer ${await getToken()}` },
})).json();
const cases = cfg[0].value.cases;
for (const w of ["a", "b", "c", "d", "e"]) await dam(`warmup ${w}`).catch(() => {});
samples.dam.length = 0;
const repeat = Number(arg("repeat") ?? 1);
let errors = 0;
for (let r = 0; r < repeat; r++) for (const c of cases) {
  if (c.dam) await dam(c.query).catch(() => errors++);
  if (c.sg_guides) await sg(c.query, "guides").catch(() => errors++);
  if (c.sg_files) await sg(c.query, "files").catch(() => errors++);
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]) : null; };
const summary = { checked_at: new Date().toISOString(), errors, engines: {} };
for (const [engine, list] of Object.entries(samples)) {
  const names = [...new Set(list.flatMap((s) => Object.keys(s)))];
  summary.engines[engine] = { n: list.length, steps: Object.fromEntries(names.map((n) => {
    const xs = list.map((s) => s[n]).filter((v) => typeof v === "number");
    return [n, { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95) }];
  })) };
}
const out = arg("out"); if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
