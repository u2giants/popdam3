import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_URL = "https://qsllyeztdwjgirsysgai.supabase.co";
const COUNT_FIELDS = [
  "live_assets", "grouped_assets", "ungrouped_assets", "style_group_rows",
  "effective_tag_rows", "assets_missing_or_wrong_group",
  "assets_with_unexpected_group", "orphan_group_references",
  "effective_tag_sample_assets", "effective_tag_missing_rows",
  "effective_tag_extra_rows", "effective_tag_drifted_assets",
];
const ASSIGNMENT_DRIFT = [
  "assets_missing_or_wrong_group", "assets_with_unexpected_group", "orphan_group_references",
];

export function assessDriftRow(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") {
    throw new Error("reconciler did not return exactly one aggregate row");
  }
  const row = rows[0];
  const observedAt = Date.parse(row.observed_at);
  if (!Number.isFinite(observedAt)) throw new Error("reconciler observation time is invalid");
  const counts = {};
  for (const field of COUNT_FIELDS) {
    if (!(typeof row[field] === "number" || typeof row[field] === "string") ||
        String(row[field]).trim() === "") throw new Error(`reconciler ${field} is invalid`);
    const value = Number(row[field]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`reconciler ${field} is invalid`);
    counts[field] = value;
  }
  if (!(typeof row.effective_tag_drift_rate === "number" || typeof row.effective_tag_drift_rate === "string") ||
      String(row.effective_tag_drift_rate).trim() === "") throw new Error("reconciler drift rate is invalid");
  const rate = Number(row.effective_tag_drift_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("reconciler drift rate is invalid");
  if (counts.grouped_assets + counts.ungrouped_assets !== counts.live_assets ||
      counts.effective_tag_drifted_assets > counts.effective_tag_sample_assets) {
    throw new Error("reconciler aggregate counts are inconsistent");
  }
  const failures = ASSIGNMENT_DRIFT.filter((field) => counts[field] !== 0)
    .map((field) => `${field}=${counts[field]}`);
  return { observed_at: new Date(observedAt).toISOString(), ...counts,
    effective_tag_drift_rate: rate, failures };
}

export async function observe({ url, key, fetchImpl = fetch, now = () => new Date() }) {
  const checkedAt = now().toISOString();
  const report = { ok: false, checked_at: checkedAt, project_ref: "qsllyeztdwjgirsysgai",
    measurement: null, failures: [] };
  try {
    if (url?.replace(/\/$/, "") !== EXPECTED_URL || !key) {
      throw new Error("expected production Supabase URL and injected service-role key");
    }
    const response = await fetchImpl(`${EXPECTED_URL}/rest/v1/rpc/reconcile_style_group_drift`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_effective_tag_sample: 5000 }),
      signal: AbortSignal.timeout(660_000),
    });
    if (!response.ok) throw new Error(`reconciler RPC returned HTTP ${response.status}`);
    const measurement = assessDriftRow(await response.json());
    report.measurement = { ...measurement, failures: undefined };
    report.failures = measurement.failures;
    report.ok = report.failures.length === 0;
  } catch (error) {
    // Never put a provider response, URL, or credential into the retained artifact.
    report.failures = [error instanceof Error && error.message.startsWith("reconciler ")
      ? error.message : error instanceof Error && error.message.startsWith("expected production")
        ? error.message : "reconciler request failed or returned an invalid response"];
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await observe({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
  await writeFile(process.env.STYLE_GROUP_DRIFT_REPORT_PATH || "style-group-drift-report.json",
    `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(report.ok ? "Style-group reconciler passed" : `Style-group reconciler alert: ${report.failures.join("; ")}`);
  if (!report.ok) process.exitCode = 1;
}
