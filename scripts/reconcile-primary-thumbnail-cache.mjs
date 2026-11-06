/** #5609 application-owned derived-row repair. Dry-run unless --apply. */
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export class SafeRepairFailure extends Error {
  constructor(code, httpStatus = null, providerCode = null) {
    super(code); this.code = code; this.httpStatus = httpStatus; this.providerCode = providerCode;
  }
}
export function safeFailure(error, phase) {
  return { phase, code: error instanceof SafeRepairFailure ? error.code : ["AbortError", "TimeoutError"].includes(error?.name) ? "REQUEST_TIMEOUT" : error instanceof TypeError ? "NETWORK_FAILURE" : "UNEXPECTED_FAILURE", http_status: error instanceof SafeRepairFailure ? error.httpStatus : null, provider_code: error instanceof SafeRepairFailure ? error.providerCode : null };
}
export const MAX_CANDIDATES = 1500;
const SELECT = "*,primary_asset:assets!style_groups_primary_asset_id_fkey(id,style_group_id,is_deleted,thumbnail_url,thumbnail_error,updated_at)";
const cacheKeys = ["primary_thumbnail_url", "primary_thumbnail_error"];
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const otherFields = ({ primary_asset, primary_thumbnail_url, primary_thumbnail_error, updated_at, ...rest }) => rest;
export function desired(row) {
  const a = row?.primary_asset;
  if (!a || a.id !== row.primary_asset_id || a.style_group_id !== row.id || a.is_deleted || [a.thumbnail_url, a.thumbnail_error].some((v) => v !== null && typeof v !== "string")) return null;
  return { primary_thumbnail_url: a.thumbnail_url, primary_thumbnail_error: a.thumbnail_error };
}
export const drifted = (row) => { const d = desired(row); return d !== null && cacheKeys.some((k) => row[k] !== d[k]); };

export async function repairRow(api, original, backup, apply, onPhase = () => {}) {
  if (!apply) { backup({ kind: "dry_run_candidate", before: original }); return { state: "dry_run" }; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    onPhase("row_read");
    const before = await api.read(original.id);
    if (!before || !same(otherFields(original), otherFields(before))) return { state: "conflict" };
    const patch = desired(before);
    if (!patch) return { state: "conflict" };
    if (!drifted(before)) return { state: "already_current" };
    // This is flushed to protected storage before the first mutation.
    onPhase("backup_flush");
    backup({ kind: "before_patch", attempt, before });
    onPhase("guard_read");
    const guard = await api.read(original.id);
    if (!same(guard, before)) continue;
    onPhase("conditional_patch");
    const rows = await api.patch(before, patch);
    if (rows.length !== 1 || rows[0].id !== before.id) return { state: "conflict" };
    onPhase("post_patch_read");
    const after = await api.read(original.id);
    if (!after || !same(otherFields(before), otherFields(after))) return { state: "conflict" };
    backup({ kind: "after_patch", attempt, after });
    if (!drifted(after)) return { state: "repaired", expected: otherFields(after) };
    // A concurrent source-thumbnail change can race REST's two statements.
    // Re-read from the source; never restore an old source or primary choice.
  }
  return { state: "unresolved" };
}

export async function reconcile(api, { apply = false, backup = () => {}, clock = Date.now, budgetMs = 1200000, onPhase = () => {}, onProgress = () => {} } = {}) {
  const started = clock();
  onPhase("initial_scan");
  const initial = await api.list();
  const candidates = initial.filter(drifted);
  const outsideScope = initial.filter((r) => r.primary_asset_id && !desired(r)).length;
  if (outsideScope) throw new SafeRepairFailure("OUTSIDE_SCOPE_PRIMARY");
  if (candidates.length > MAX_CANDIDATES) throw new SafeRepairFailure("CANDIDATE_CAP");
  const report = { apply, scanned: initial.length, candidates: candidates.length, repaired: 0, already_current: 0, dry_run: 0, conflict: 0, unresolved: 0, final_drift: null, unchanged_primary_and_other_fields: true, ok: false };
  onProgress({ ...report });
  const expected = new Map();
  for (const row of candidates) {
    if (clock() - started > budgetMs) throw new SafeRepairFailure("REPAIR_TIME_BUDGET");
    const result = await repairRow(api, row, backup, apply, onPhase);
    report[result.state]++;
    onProgress({ ...report });
    if (result.expected) expected.set(row.id, result.expected);
  }
  if (apply) {
    onPhase("final_scan");
    const final = await api.list();
    report.final_drift = final.filter(drifted).length;
    if (final.some((r) => r.primary_asset_id && !desired(r))) report.unchanged_primary_and_other_fields = false;
    const byId = new Map(final.map((r) => [r.id, r]));
    for (const [id, values] of expected) {
      const row = byId.get(id);
      if (!row || !same(values, otherFields(row))) report.unchanged_primary_and_other_fields = false;
    }
    report.ok = report.conflict === 0 && report.unresolved === 0 && report.final_drift === 0 && report.unchanged_primary_and_other_fields;
  } else report.ok = true;
  return report;
}

const quote = (v) => v === null ? "is.null" : `eq."${String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
export function createApi({ url, key, expectedRef, fetchImpl = fetch }) {
  if (!/^[a-z]{20}$/.test(expectedRef || "") || url !== `https://${expectedRef}.supabase.co` || !key) throw new SafeRepairFailure("TARGET_OR_CREDENTIAL_CONFIGURATION");
  const deadline = Date.now() + 1200000;
  async function request(params, options = {}) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeRepairFailure("REST_TIME_BUDGET");
    const response = await fetchImpl(`${url}/rest/v1/style_groups?${params}`, {
      ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...options.headers }, signal: AbortSignal.timeout(Math.min(15000, remaining)),
    });
    if (!response.ok) {
      let providerCode = null;
      try { const body = await response.json(); if (/^[A-Z0-9]{5,10}$/.test(body?.code || "")) providerCode = body.code; } catch { /* no raw provider response retained */ }
      throw new SafeRepairFailure("REST_HTTP_FAILURE", Number.isInteger(response.status) ? response.status : null, providerCode);
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new SafeRepairFailure("REST_RESPONSE_SHAPE");
    return rows;
  }
  return {
    async list() {
      const all = []; let cursor;
      for (let page = 0; page < 200; page++) {
        const p = new URLSearchParams({ select: SELECT, order: "id.asc", limit: "500" });
        if (cursor) p.set("id", `gt.${cursor}`);
        const rows = await request(p); all.push(...rows);
        if (rows.length < 500) return all;
        if (rows.at(-1).id === cursor) throw new SafeRepairFailure("PAGINATION_NO_PROGRESS");
        cursor = rows.at(-1).id;
      }
      throw new SafeRepairFailure("SCAN_CAP");
    },
    async read(id) {
      const rows = await request(new URLSearchParams({ select: SELECT, id: quote(id), limit: "2" }));
      if (rows.length > 1) throw new SafeRepairFailure("AMBIGUOUS_GROUP");
      return rows[0] || null;
    },
    async patch(before, fields) {
      if (!same(Object.keys(fields).sort(), [...cacheKeys].sort())) throw new SafeRepairFailure("UNAPPROVED_PATCH_FIELDS");
      const p = new URLSearchParams({ select: "id", id: quote(before.id), primary_asset_id: quote(before.primary_asset_id), updated_at: quote(before.updated_at) });
      for (const k of cacheKeys) p.set(k, quote(before[k]));
      return request(p, { method: "PATCH", body: JSON.stringify(fields) });
    },
  };
}

/** Preserve sanitized diagnostics and partial progress even if a request fails. */
export async function executeRepair(api, { apply = false, backup = () => {} } = {}) {
  let phase = "initialization", progress = {}, attemptedPatches = 0, confirmedPatches = 0;
  const observedApi = { ...api, patch: async (...args) => {
    attemptedPatches++;
    const rows = await api.patch(...args);
    if (rows.length === 1) confirmedPatches++;
    return rows;
  } };
  try {
    const report = await reconcile(observedApi, { apply, backup, onPhase: (p) => { phase = p; }, onProgress: (p) => { progress = p; } });
    return { ...report, phase: "complete", attempted_patches: attemptedPatches, confirmed_patches: confirmedPatches, failure: null };
  } catch (error) {
    return { ...progress, apply, ok: false, phase, attempted_patches: attemptedPatches, confirmed_patches: confirmedPatches, mutation_outcome_complete: false, failure: safeFailure(error, phase) };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const apply = process.argv.includes("--apply");
  const packet = process.env.PRIMARY_CACHE_REPAIR_PACKET;
  let fd, created = false, receipt;
  const backupHash = createHash("sha256");
  try {
    if (!packet || !packet.startsWith("/")) throw new SafeRepairFailure("PRIVATE_PACKET_CONFIGURATION");
    // Exclusive creation refuses an existing path/symlink; credentials never enter files.
    mkdirSync(packet, { mode: 0o700 }); created = true;
    fd = openSync(`${packet}/before-and-after.jsonl`, "wx", 0o600);
    const api = createApi({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, expectedRef: process.env.SUPABASE_EXPECTED_PROJECT_REF });
    receipt = await executeRepair(api, { apply, backup: (row) => { const line = JSON.stringify(row) + "\n"; writeSync(fd, line); fsyncSync(fd); backupHash.update(line); } });
  } catch (error) {
    receipt = { apply, ok: false, phase: "initialization", attempted_patches: 0, confirmed_patches: 0, failure: safeFailure(error, "initialization") };
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { receipt = { ...receipt, ok: false, close_failure: "PRIVATE_BACKUP_CLOSE_FAILURE" }; } }
  }
  receipt = { ...receipt, observed_at: new Date().toISOString(), backup_sha256: backupHash.digest("hex") };
  if (created) {
    try { appendFileSync(`${packet}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" }); }
    catch { receipt.ok = false; receipt.receipt_write_failure = "PRIVATE_RECEIPT_WRITE_FAILURE"; }
  }
  console.log(JSON.stringify(receipt));
  if (!receipt.ok) process.exitCode = 1;
}
