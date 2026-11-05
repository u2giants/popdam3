import assert from "node:assert/strict";
import test from "node:test";

// Run the actual evaluator with a fake clock and fake transport; never call live search.
for (const failSpelling of [false, true]) {
  test(`every protected request uses a current viewer session; spelling auth failure=${failSpelling}`, async (t) => {
    let clock = 1_000_000;
    let authCalls = 0;
    let expiresAt = 0;
    let guideSearches = 0;
    let report;
    const routes = [];
    const originalEnv = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: "https://example.invalid", SUPABASE_PUBLISHABLE_KEY: "publishable", SEARCH_EVAL_EMAIL: "viewer@example.invalid", SEARCH_EVAL_PASSWORD: "fake-password" });
    t.after(() => { process.env = originalEnv; });
    t.mock.method(Date, "now", () => clock);
    t.mock.method(console, "log", (value) => { report = JSON.parse(value); });
    t.mock.method(globalThis, "fetch", async (url, options = {}) => {
      const path = new URL(url).pathname;
      routes.push(path);
      let result;
      if (path === "/auth/v1/token") {
        assert.deepEqual(JSON.parse(options.body), { email: "viewer@example.invalid", password: "fake-password" });
        assert.equal(options.headers.Authorization, "Bearer publishable");
        expiresAt = clock + 3_600_000;
        result = { access_token: `viewer-${++authCalls}`, expires_at: expiresAt / 1000, expires_in: 3600 };
      } else {
        assert.equal(options.headers.Authorization, `Bearer viewer-${authCalls}`);
        assert.ok(clock < expiresAt - 60_000, "request has a full safety margin");
        if (path === "/rest/v1/admin_config") {
          result = [{ value: { version: "fake", cases: [{ id: "fake-case", kind: "character", query: "example", dam: {}, sg_guides: {}, sg_files: {} }] } }];
        } else {
          const body = JSON.parse(options.body);
          clock += 2_000_000;
          if (body.action === "spelling" && failSpelling) return new Response("{}", { status: 401 });
          if (path === "/rest/v1/rpc/expand_dam_search_queries") result = [];
          else if (path === "/rest/v1/rpc/search_style_guide_library_v2") { guideSearches++; result = { results: [], total: 0 }; }
          else if (body.action === "spelling") result = {};
          else result = { results: [], total_count: 0 };
        }
      }
      return Response.json(result);
    });
    await import(`./run.mjs?test=${failSpelling}`);
    assert.ok(authCalls > 1, "renews across a long evaluation");
    assert.ok(routes.includes("/rest/v1/admin_config"), "saved-set read authenticates too");
    if (failSpelling) {
      assert.equal(guideSearches, 0, "does not hide auth failure or retry the search");
      assert.equal(report.engines.sg_guides.overall.errors, 1);
      assert.equal(report.engines.sg_files.overall.errors, 1);
    } else {
      assert.equal(guideSearches, 2);
      assert.equal(report.engines.sg_guides.overall.errors, 0);
      assert.equal(report.engines.sg_files.overall.errors, 0);
    }
  });
}

test("checkpoints each engine and resumes without replaying completed searches", async (t) => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = mkdtempSync(join(tmpdir(), "search-eval-test-"));
  const checkpoint = join(folder, "checkpoint.json");
  const oldArgs = process.argv;
  const oldEnv = { ...process.env };
  t.after(() => { process.argv = oldArgs; process.env = oldEnv; rmSync(folder, { recursive: true }); });
  process.argv = [...oldArgs.slice(0, 2), "--checkpoint", checkpoint, "--phase", "before", "--run-id", "test-run", "--source-head", "fake-head", "--label", "before"];
  Object.assign(process.env, { SUPABASE_URL: "https://example.invalid", SUPABASE_PUBLISHABLE_KEY: "publishable", SEARCH_EVAL_EMAIL: "viewer@example.invalid", SEARCH_EVAL_PASSWORD: "fake" });
  let searches = 0;
  let changedSet = false;
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    if (path === "/auth/v1/token") return Response.json({ access_token: "fake", expires_in: 3600 });
    if (path === "/rest/v1/admin_config") return Response.json([{ value: { version: changedSet ? "changed" : "fake", cases: [{ id: "fake-case", kind: "character", query: "example", dam: {} }] } }]);
    searches++;
    return Response.json({ results: [], total_count: 0 });
  });
  await import("./run.mjs?test=checkpoint-first");
  assert.equal(searches, 1);
  const saved = JSON.parse(readFileSync(checkpoint));
  assert.ok(saved.set_hash);
  assert.ok(saved.raw["fake-case"].dam);
  await import("./run.mjs?test=checkpoint-resume");
  assert.equal(searches, 1, "does not silently rerun successful or failed completed requests");
  for (const flag of ["label", "phase", "run-id", "source-head"]) {
    const index = process.argv.indexOf(`--${flag}`) + 1;
    const original = process.argv[index];
    process.argv[index] = "different";
    await assert.rejects(import(`./run.mjs?test=checkpoint-different-${flag}`), /different evaluation identity/);
    process.argv[index] = original;
  }
  process.env.SUPABASE_URL = "https://different.invalid";
  await assert.rejects(import("./run.mjs?test=checkpoint-different-target"), /different evaluation identity/);
  process.env.SUPABASE_URL = "https://example.invalid";
  assert.equal(searches, 1, "refused identities never search or overwrite evidence");
  assert.deepEqual(JSON.parse(readFileSync(checkpoint)), saved);
  changedSet = true;
  await assert.rejects(import("./run.mjs?test=checkpoint-different-set"), /different judged set/);
});

test("a failed checkpoint replacement preserves the prior engine and partial resume avoids replay", async (t) => {
  const { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = mkdtempSync(join(tmpdir(), "search-eval-partial-"));
  const checkpoint = join(folder, "checkpoint.json");
  const temporary = `${checkpoint}.${process.pid}.tmp`;
  const oldArgs = process.argv;
  const oldEnv = { ...process.env };
  t.after(() => { process.argv = oldArgs; process.env = oldEnv; rmSync(folder, { recursive: true }); });
  process.argv = [...oldArgs.slice(0, 2), "--checkpoint", checkpoint, "--phase", "before", "--run-id", "partial-run", "--source-head", "fake-head", "--label", "before"];
  Object.assign(process.env, { SUPABASE_URL: "https://example.invalid", SUPABASE_PUBLISHABLE_KEY: "publishable", SEARCH_EVAL_EMAIL: "viewer@example.invalid", SEARCH_EVAL_PASSWORD: "fake" });
  let failReplacement = true;
  let damSearches = 0;
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/auth/v1/token") return Response.json({ access_token: "fake", expires_in: 3600 });
    if (path === "/rest/v1/admin_config") return Response.json([{ value: { version: "fake", cases: [{ id: "fake-case", kind: "character", query: "example", dam: {}, sg_guides: {} }] } }]);
    if (path === "/rest/v1/rpc/expand_dam_search_queries") return Response.json([]);
    if (path === "/rest/v1/rpc/search_style_guide_library_v2") {
      if (failReplacement) mkdirSync(temporary);
      return Response.json({ results: [], total: 0 });
    }
    if (JSON.parse(options.body).action === "spelling") return Response.json({});
    damSearches++;
    return Response.json({ results: [], total_count: 0 });
  });
  await assert.rejects(import("./run.mjs?test=partial-failed-write"), /EISDIR/);
  const preserved = JSON.parse(readFileSync(checkpoint));
  assert.ok(preserved.raw["fake-case"].dam);
  assert.equal(preserved.raw["fake-case"].sg_guides, undefined);
  assert.equal(statSync(checkpoint).mode & 0o777, 0o600);
  rmSync(temporary, { recursive: true });
  failReplacement = false;
  await import("./run.mjs?test=partial-recovery");
  assert.equal(damSearches, 1);
  const completed = JSON.parse(readFileSync(checkpoint));
  assert.deepEqual(completed.raw["fake-case"].dam, preserved.raw["fake-case"].dam);
  assert.ok(completed.raw["fake-case"].sg_guides);
  assert.equal(completed.started_at, preserved.started_at);
});
