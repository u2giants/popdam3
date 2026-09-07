import { writeFile } from "node:fs/promises";

const EXPECTED_URL = "https://qsllyeztdwjgirsysgai.supabase.co";
const REPORT_PATH = process.env.CANARY_REPORT_PATH || "production-canary-report.json";
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const failures = [];
const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}

async function request(name, target, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(target, { ...options, signal: controller.signal });
    record(name, response.ok, `HTTP ${response.status}`);
    return response;
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function rest(path) {
  const response = await request(`database ${path.split("?")[0]}`, `${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response?.ok) return null;
  try { return await response.json(); } catch { return null; }
}

if (url !== EXPECTED_URL || !key) {
  record("production target", false, "expected production Supabase URL and injected service-role key");
} else {
  record("production target", true, "Virginia production project");
  await request("DAM frontend", "https://dam.designflow.app/");
  await request("PopSG frontend", "https://sg.designflow.app/");

  for (const [label, path] of [
    ["active assets", "assets?select=id&is_deleted=eq.false&limit=1"],
    ["style groups", "style_groups?select=id&limit=1"],
    ["active PopSG files", "style_guide_files?select=id&is_active=eq.true&limit=1"],
  ]) {
    const rows = await rest(path);
    record(label, Array.isArray(rows) && rows.length > 0, "expected at least one production row");
  }

  const agents = await rest("agent_registrations?select=agent_type,last_heartbeat&agent_type=in.(bridge,windows-render)");
  const now = Date.now();
  for (const type of ["bridge", "windows-render"]) {
    const newest = (agents || []).filter((row) => row.agent_type === type)
      .map((row) => Date.parse(row.last_heartbeat)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    const ageMinutes = newest ? Math.round((now - newest) / 60_000) : null;
    record(`${type} heartbeat`, newest && now - newest <= 10 * 60_000, ageMinutes === null ? "missing" : `${ageMinutes} minutes old`);
  }

  const workerRows = await rest("admin_config?select=value,updated_at&key=eq.WORKER_HEARTBEAT");
  const workerAt = workerRows?.[0] ? Date.parse(workerRows[0].updated_at) : NaN;
  record("Railway worker heartbeat", Number.isFinite(workerAt) && now - workerAt <= 5 * 60_000,
    Number.isFinite(workerAt) ? `${Math.round((now - workerAt) / 60_000)} minutes old` : "missing");

  const operationRows = await rest("admin_config?select=value&key=eq.BULK_OPERATIONS");
  const operations = operationRows?.[0]?.value || {};
  const recentFailures = Object.entries(operations).filter(([, state]) => {
    const updated = Date.parse(state?.updated_at || "");
    return ["failed", "interrupted"].includes(state?.status) && state?.interruption_reason_code !== "user_stop" &&
      Number.isFinite(updated) && now - updated <= 20 * 60_000;
  }).map(([name, state]) => `${name} (${state.interruption_reason_code || state.status})`);
  record("recent background failures", recentFailures.length === 0,
    recentFailures.length ? recentFailures.join(", ") : "none in the last 20 minutes");
}

const report = { ok: failures.length === 0, checked_at: new Date().toISOString(), failures, checks };
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(report.ok ? "Production canary passed" : `Production canary failed: ${failures.join("; ")}`);
if (!report.ok) process.exitCode = 1;
