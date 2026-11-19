import assert from "node:assert/strict";
import test from "node:test";

// step-timing with a fake transport; never call live search. Two views are
// checked: the default warm-up flow, and --first-hit (#1196) which skips the
// warm-up pass and reports each query's first run against its repeats.
async function run(args, { cases }) {
  const originalEnv = { ...process.env };
  const originalArgv = process.argv;
  Object.assign(process.env, {
    SUPABASE_URL: "https://example.invalid",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    SEARCH_EVAL_EMAIL: "viewer@example.invalid",
    SEARCH_EVAL_PASSWORD: "fake-password",
  });
  process.argv = [originalArgv[0], "step-timing.mjs", ...args];
  const searches = [];
  const routes = [];
  let report;
  const originalLog = console.log;
  console.log = (value) => { report = JSON.parse(value); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    routes.push(path);
    if (path === "/auth/v1/token") {
      return Response.json({
        access_token: "viewer-1",
        expires_at: (Date.now() + 3_600_000) / 1000,
        expires_in: 3600,
      });
    }
    if (path === "/rest/v1/admin_config") return Response.json([{ value: { version: "fake", cases } }]);
    const body = JSON.parse(options.body);
    if (path === "/functions/v1/dam-search-ai" && body.action === "search") {
      searches.push(body.query);
      return Response.json({ ok: true, results: [], total_count: 0 }, {
        headers: { "server-timing": "embed;dur=12, search_rpc;dur=34, total;dur=50" },
      });
    }
    if (path === "/rest/v1/rpc/expand_dam_search_queries") return Response.json([]);
    if (body.action === "spelling") return Response.json({});
    if (body.action === "popsg-query-embedding") return Response.json({ mode: "keyword" });
    return Response.json({ results: [], total: 0 });
  };
  try {
    await import(`./step-timing.mjs?test=${args.join("_") || "default"}-${cases.length}`);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    process.argv = originalArgv;
    process.env = originalEnv;
  }
  return { report, searches, routes };
}

const damOnlyCases = [
  { id: "c1", query: "alpha frame", dam: {} },
  { id: "c2", query: "beta canvas", dam: {} },
];

test("--first-hit skips warm-ups and reports first vs repeat per query", async () => {
  const { report, searches } = await run(["--first-hit"], { cases: damOnlyCases });
  assert.ok(!searches.some((q) => q.startsWith("warmup")), "no warm-up pass in first-hit mode");
  assert.deepEqual(searches, ["alpha frame", "beta canvas", "alpha frame", "beta canvas"]);
  assert.equal(report.first_hit.by_pass.first.n, 2);
  assert.equal(report.first_hit.by_pass.repeat.n, 2);
  assert.equal(report.first_hit.by_pass.first.steps.search_rpc.p50, 34);
  assert.deepEqual(
    report.first_hit.runs.map((r) => [r.query, r.pass]),
    [["alpha frame", "first"], ["beta canvas", "first"], ["alpha frame", "repeat"], ["beta canvas", "repeat"]],
  );
  assert.equal(report.errors, 0);
});

test("default mode keeps the warm-up pass and the aggregate summary", async () => {
  const { report, searches } = await run([], { cases: damOnlyCases });
  assert.equal(searches.filter((q) => q.startsWith("warmup")).length, 5);
  assert.equal(searches.filter((q) => q === "alpha frame").length, 1);
  assert.equal(report.first_hit, undefined);
  assert.equal(report.engines.dam.n, 2);
  assert.equal(report.engines.dam.steps.search_rpc.p50, 34);
});
