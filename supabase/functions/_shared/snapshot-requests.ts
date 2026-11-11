/**
 * Restore-from-snapshot request/response over admin_config (u2giants/popdam3#963).
 *
 * Same single-slot pattern as DIR_BROWSE_REQUEST, but every result is bound to
 * its request_id, the candidate paths and the restore destination are computed
 * on the server from the asset row, and the browser never supplies a folder.
 * Pure over an injected client so it is unit-testable.
 */

export const SNAPSHOT_NAME_RE = /^GMT[+-]\d{2}-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/;
export const VERSIONS_REQUEST_KEY = "SNAPSHOT_VERSIONS_REQUEST";
export const VERSIONS_RESULT_KEY = "SNAPSHOT_VERSIONS_RESULT";
export const RESTORE_REQUEST_KEY = "SNAPSHOT_RESTORE_REQUEST";
export const RESTORE_RESULT_KEY = "SNAPSHOT_RESTORE_RESULT";

// deno-lint-ignore no-explicit-any
type Db = any;
type Out = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string): Out => ({ status, body: { error } });

async function loadAsset(db: Db, assetId: unknown) {
  if (typeof assetId !== "string" || !/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  const { data } = await db.from("assets").select("id, relative_path, filename").eq("id", assetId).maybeSingle();
  return (data as { id: string; relative_path: string; filename: string } | null) ?? null;
}

async function candidates(db: Db, assetId: string): Promise<string[]> {
  const { data, error } = await db.rpc("dam_asset_path_candidates", { p_asset_id: assetId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[])
    .map((r) => (typeof r === "string" ? r : (r as Record<string, string>).dam_asset_path_candidates))
    .filter((p): p is string => typeof p === "string" && p.length > 0);
}

async function readKey(db: Db, key: string): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("admin_config").select("value").eq("key", key).maybeSingle();
  return (data?.value as Record<string, unknown>) ?? null;
}

async function writeKey(db: Db, key: string, value: Record<string, unknown>, userId?: string) {
  const row: Record<string, unknown> = { key, value, updated_at: new Date().toISOString() };
  if (userId) row.updated_by = userId;
  const { error } = await db.from("admin_config").upsert(row, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** A different pending request less than 2 minutes old blocks a new one. */
async function busy(db: Db, key: string): Promise<boolean> {
  const cur = await readKey(db, key);
  if (!cur || cur.status !== "pending") return false;
  return Date.now() - new Date(String(cur.requested_at)).getTime() < 120_000;
}

export async function requestSnapshotVersions(db: Db, body: Record<string, unknown>, userId: string): Promise<Out> {
  const asset = await loadAsset(db, body.asset_id);
  if (!asset) return fail(404, "Asset not found");
  if (await busy(db, VERSIONS_REQUEST_KEY)) return fail(409, "Another older-copies search is running; try again in a minute");
  const list = await candidates(db, asset.id);
  const requestId = crypto.randomUUID();
  await writeKey(db, VERSIONS_REQUEST_KEY, {
    request_id: requestId, asset_id: asset.id, candidates: list, status: "pending",
    requested_by: userId, requested_at: new Date().toISOString(),
  }, userId);
  return ok({ request_id: requestId, candidates: list });
}

export async function requestSnapshotRestore(db: Db, body: Record<string, unknown>, userId: string): Promise<Out> {
  const asset = await loadAsset(db, body.asset_id);
  if (!asset) return fail(404, "Asset not found");
  const snapshot = body.snapshot;
  if (typeof snapshot !== "string" || !SNAPSHOT_NAME_RE.test(snapshot)) return fail(400, "Invalid snapshot name");
  const sourcePath = body.source_path;
  const list = await candidates(db, asset.id);
  if (typeof sourcePath !== "string" || !list.includes(sourcePath)) {
    return fail(400, "source_path is not one of this file's known locations");
  }
  if (await busy(db, RESTORE_REQUEST_KEY)) return fail(409, "Another restore is running; try again in a minute");
  // Destination = the asset's CURRENT folder, from the row. Never from the request.
  const slash = asset.relative_path.lastIndexOf("/");
  if (slash <= 0) return fail(400, "File has no folder");
  const requestId = crypto.randomUUID();
  await writeKey(db, RESTORE_REQUEST_KEY, {
    request_id: requestId, asset_id: asset.id, snapshot, source_path: sourcePath,
    destination_dir: asset.relative_path.slice(0, slash), status: "pending",
    requested_by: userId, requested_at: new Date().toISOString(),
  }, userId);
  return ok({ request_id: requestId });
}

export async function getResult(db: Db, resultKey: string, body: Record<string, unknown>): Promise<Out> {
  const requestId = body.request_id;
  if (typeof requestId !== "string" || !requestId) return fail(400, "Missing request_id");
  const result = await readKey(db, resultKey);
  return ok({ result: result && result.request_id === requestId ? result : null });
}

/** Agent side: store the result and close the request only when request_id matches. */
export async function reportResult(
  db: Db, requestKey: string, resultKey: string, body: Record<string, unknown>,
): Promise<Out> {
  const requestId = body.request_id;
  if (typeof requestId !== "string" || !requestId) return fail(400, "Missing request_id");
  const pending = await readKey(db, requestKey);
  if (!pending || pending.request_id !== requestId || pending.status !== "pending") {
    return ok({ ignored: true });
  }
  const { request_id: _r, ...rest } = body;
  await writeKey(db, resultKey, { request_id: requestId, ...rest, reported_at: new Date().toISOString() });
  await writeKey(db, requestKey, { ...pending, status: "completed" });
  return ok({});
}

/** Heartbeat delivery: pending requests for the bridge. */
export function snapshotCommands(configMap: Record<string, unknown>) {
  const v = configMap[VERSIONS_REQUEST_KEY] as Record<string, unknown> | undefined;
  const r = configMap[RESTORE_REQUEST_KEY] as Record<string, unknown> | undefined;
  return {
    snapshot_versions: v?.status === "pending"
      ? { request_id: String(v.request_id), candidates: (v.candidates as string[]) ?? [] }
      : null,
    snapshot_restore: r?.status === "pending"
      ? {
        request_id: String(r.request_id), snapshot: String(r.snapshot),
        source_path: String(r.source_path), destination_dir: String(r.destination_dir),
      }
      : null,
  };
}
