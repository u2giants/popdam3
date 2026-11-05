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
