import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Execute the real heartbeat against an in-memory Supabase query interface.
// No Deno server, secrets, live database, or source-pattern expectations.
const source = readFileSync(new URL("../agent-api/index.ts", import.meta.url), "utf8");
const heartbeat = source.slice(source.indexOf("function acceptedCommandDeferral"), source.indexOf("// ── Style group assignment helper"));
const compiled = ts.transpileModule(heartbeat, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const nonce = "abcdef0123456789abcdef0123456789";

async function run(body: Record<string, unknown>, agentType = "windows-render", extraConfig = {}) {
  const metadata = { trigger_update: true, force_restart: true, force_apply_update: true, force_stop_jobs: true, update_requested_by: "admin", update_requested_at: "pending" };
  const config: Record<string, unknown> = {
    WINDOWS_REPAIR_CODE: "fixture-code", WINDOWS_AGENT_NAS_HOST: "fixture-nas",
    PDF_TEXT_SAMPLE_REQUEST: { status: "pending", assets: ["fixture"] },
    COMPAT_AUDIT_REQUEST: { status: "pending" }, ...extraConfig,
  };
  const writes: Array<{ table: string; action: string; payload?: any; filters: Record<string, unknown> }> = [];
  const db = { from(table: string) {
    let action = "select", payload: any, columns = "", filters: Record<string, unknown> = {}, keys: string[] | undefined;
    const query: any = {
      select(value: string) { columns = value; return query; },
      update(value: unknown) { action = "update"; payload = value; return query; },
      upsert(value: unknown) { action = "upsert"; payload = value; return query; },
      delete() { action = "delete"; return query; },
      eq(key: string, value: unknown) { filters[key] = value; return query; },
      in(key: string, value: string[]) { if (key === "key") keys = value; return query; },
      lt() { return query; }, single() { return query; }, maybeSingle() { return query; },
      then(resolve: (value: unknown) => unknown) {
        if (action !== "select") { writes.push({ table, action, payload, filters }); return Promise.resolve({ error: null }).then(resolve); }
        const data = table === "agent_registrations" ? (columns === "metadata" ? { metadata } : []) :
          table === "admin_config" ? (keys ? Object.entries(config).filter(([key]) => keys!.includes(key)).map(([key, value]) => ({ key, value })) : null) : [];
        return Promise.resolve({ data, count: 0, error: null }).then(resolve);
      },
    }; return query;
  } };
  const invoke = new Function("serviceClient", "optionalString", "json", "err", `const LOG_TAIL_LINES=50, COUNTER_HISTORY_LIMIT=60, WINDOWS_OFFLINE_MS=300000, REQUEST_AGE_MS=300000, DEFAULT_BATCH_SIZE=20, ADAPTIVE_IDLE_SECONDS=30, ADAPTIVE_ACTIVE_SECONDS=5; ${compiled}; return handleHeartbeat;`)(() => db, (b: any, k: string) => b[k] ?? null, (x: any) => x, (x: any) => x);
  return { response: await invoke(body, "fixture-agent", agentType, "fixture"), writes };
}

const request = () => ({ command_deferral: { nonce, expires_at: Date.now() + 60000 }, counters: { processed: 3 } });
describe("real heartbeat command deferral", () => {
  it("acknowledges exact nonce/expiry, keeps cloud config and heartbeat but consumes no commands", async () => {
    const body = request(); const { response, writes } = await run(body);
    expect(response.command_deferral).toEqual(body.command_deferral);
    expect(response.commands).toEqual({});
    expect(response.config.windows_agent.nas_host).toBe("fixture-nas");
    const updates = writes.filter(x => x.table === "agent_registrations");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.last_heartbeat).toBeTruthy();
    for (const flag of ["trigger_update", "force_restart", "force_apply_update", "force_stop_jobs"]) expect(updates[0].payload.metadata[flag]).toBe(true);
    expect(updates[0].payload.metadata.update_requested_by).toBe("admin");
    expect(writes.filter(x => x.table === "admin_config")).toEqual([]);
  });
  it("does not claim stale audit preview during deferral", async () => {
    const { writes } = await run(request(), "windows-render", { COMPAT_AUDIT_REQUEST: null, COMPAT_AUDIT_PREVIEW_REQUEST: { status: "processing", claimed_at: "2000-01-01" } });
    expect(writes.filter(x => x.action === "upsert")).toEqual([]);
  });
  it("next ordinary heartbeat delivers and clears retained one-shots and claims sample/audit", async () => {
    const { response, writes } = await run({});
    expect(response.command_deferral).toBeUndefined();
    expect(response.commands).toMatchObject({ trigger_update: true, force_restart: true, force_apply_update: true, force_stop_jobs: true, repair_pairing_code: "fixture-code", trigger_pdf_text_sample: true, audit_compat_thumbnails: true });
    expect(writes.filter(x => x.action === "upsert").map(x => x.payload.key)).toEqual(["PDF_TEXT_SAMPLE_REQUEST", "COMPAT_AUDIT_REQUEST"]);
    expect(writes.some(x => x.action === "delete" && x.filters.key === "WINDOWS_REPAIR_CODE")).toBe(true);
    expect(writes.filter(x => x.table === "agent_registrations")).toHaveLength(2);
  });
  it.each([null, [], {}, { nonce, expires_at: NaN }, { nonce, expires_at: Infinity }, { nonce, expires_at: "future" }, { nonce, expires_at: 0 }, { nonce, expires_at: Date.now()+600000 }, { nonce: "bad", expires_at: Date.now()+60000 }])("invalid deferral preserves ordinary command delivery: %j", async command_deferral => {
    const { response } = await run({ command_deferral });
    expect(response.command_deferral).toBeUndefined(); expect(response.commands.trigger_update).toBe(true);
  });
  it("Bridge ignores a valid deferral and still claims its requested sample", async () => {
    const { response, writes } = await run(request(), "bridge", { PDF_TEXT_SAMPLE_REQUEST: { status: "pending", force_bridge: true, assets: [] } });
    expect(response.command_deferral).toBeUndefined(); expect(response.commands.trigger_pdf_text_sample).toBe(true);
    expect(writes.some(x => x.action === "upsert" && x.payload.key === "PDF_TEXT_SAMPLE_REQUEST")).toBe(true);
  });
});
