import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the actual edge router, authentication and claim handler. Only module
// boundaries are replaced: no network, server listener, or real job can exist.
function routerFixture() {
  const pairedId = "00000000-0000-4000-8000-000000000001";
  const key = "synthetic-agent-key";
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const claims: Array<Record<string, unknown>> = [];
  let handler: (request: Request) => Promise<Response>;
  const client = {
    from(table: string) {
      if (table !== "agent_registrations") throw new Error(`Unexpected table ${table}`);
      let suppliedHash: unknown;
      return {
        select(columns: string) {
          expect(columns).toBe("id, agent_name, agent_type");
          return this;
        },
        eq(column: string, value: unknown) {
          expect(column).toBe("agent_key_hash");
          suppliedHash = value;
          return this;
        },
        async maybeSingle() {
          return { data: suppliedHash === hash(key) ? { id: pairedId, agent_name: "Synthetic", agent_type: "windows-render" } : null, error: null };
        },
      };
    },
    async rpc(name: string, params: Record<string, unknown>) {
      expect(name).toBe("claim_tiff_jobs");
      claims.push(params);
      return { data: [], error: null };
    },
  };
  const http = {
    corsServe(callback: typeof handler) {
      handler = callback;
    },
    json: (value: unknown) => Response.json(value),
    err: (message: string, status = 400) => Response.json({ error: message }, { status }),
  };
  const source = readFileSync(new URL("../agent-api/index.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, {
    exports: {},
    Request,
    Response,
    URL,
    Date,
    Deno: { env: { get: () => undefined } },
    console: { warn() {}, error() {}, log() {} },
    require(name: string) {
      if (name.endsWith("/http.ts")) return http;
      if (name.endsWith("/service-client.ts")) return { serviceClient: () => client };
      if (name.endsWith("/crypto.ts")) return { sha256Hex: async (value: string) => hash(value) };
      return new Proxy({}, {
        get(_target, property) {
          throw new Error(`Unexpected dependency ${name}:${String(property)}`);
        },
      });
    },
  });
  return {
    pairedId,
    claims,
    request: (body: Record<string, unknown>, agentKey: string | null = key) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (agentKey !== null) headers["x-agent-key"] = agentKey;
      return handler(
        new Request("http://localhost/functions/v1/agent-api", { method: "POST", headers, body: JSON.stringify({ action: "claim-tiff-job", ...body }) }),
      );
    },
  };
}

describe("actual agent router claim identity", () => {
  it.each([
    ["mismatched", { agent_id: "00000000-0000-4000-8000-000000000002" }],
    ["missing", {}],
    ["malformed", { agent_id: { untrusted: true } }],
  ])("uses authenticated registration for %s body identity", async (_label, body) => {
    const fixture = routerFixture();
    const response = await fixture.request(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, jobs: [] });
    expect(fixture.claims).toEqual([{ p_agent_id: fixture.pairedId, p_batch_size: 1 }]);
  });
  it.each([null, "invalid-synthetic-key"])("refuses unauthenticated claims without touching the queue (%s)", async (key) => {
    const fixture = routerFixture();
    const response = await fixture.request({ agent_id: fixture.pairedId }, key);
    expect(response.status).toBe(401);
    expect(fixture.claims).toEqual([]);
  });
});
