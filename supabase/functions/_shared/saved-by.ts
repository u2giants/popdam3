/**
 * "Saved by" for Older copies (u2giants/popdam3#1342).
 *
 * Seafile records the person behind every change made through it. A NAS file
 * that came from Seafile has exactly the Seafile revision's size and a modified
 * time within seconds of that revision's commit, so each snapshot version is
 * matched to a Seafile revision by size + time. Revisions committed by the NAS
 * sync account mean the save happened on the NAS itself (SMB or Synology Drive).
 *
 * Pure over an injected DB client and fetch so it is unit-testable.
 */

// deno-lint-ignore no-explicit-any
type Db = any;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface VersionIn {
  source_path: string;
  size: number;
  mtime: string;
}
export interface SavedBy {
  source_path: string;
  size: number;
  mtime: string;
  /** "seafile" = a person's Seafile save; "nas" = saved on the NAS (name not yet known); null = no match. */
  via: "seafile" | "nas" | null;
  name: string | null;
}
interface Library {
  libraryId: string;
  pathPrefix: string;
}
interface Revision {
  ctime: number;
  size: number;
  name: string | null;
  email: string | null;
}

/** Commit time and NAS modified time of the same save differ by seconds. */
export const MATCH_WINDOW_SEC = 120;
/** How long after a NAS save the sync account may upload it. */
export const NAS_UPLOAD_LAG_SEC = 12 * 3600;
const MAX_PAGES = 4;
const MAX_VERSIONS = 50;

export function parseLibraries(raw: unknown): Library[] {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((l) => l && typeof l.libraryId === "string" && typeof l.pathPrefix === "string" && l.pathPrefix)
    .map((l) => ({ libraryId: l.libraryId, pathPrefix: l.pathPrefix.replace(/\/+$/, "") }));
}

/** NAS relative path → Seafile library + path inside it, or null when no library covers it. */
export function toSeafile(path: string, libs: Library[]): { libraryId: string; path: string } | null {
  for (const l of libs) {
    if (path === l.pathPrefix || path.startsWith(l.pathPrefix + "/")) {
      return { libraryId: l.libraryId, path: path.slice(l.pathPrefix.length) || "/" };
    }
  }
  return null;
}

export function isSyncAccount(r: Revision, syncEmails: string[]): boolean {
  return (!!r.email && syncEmails.includes(r.email)) || r.name === "nas-sync";
}

export function matchVersion(v: VersionIn, revs: Revision[], syncEmails: string[]): Pick<SavedBy, "via" | "name"> {
  const t = Math.floor(new Date(v.mtime).getTime() / 1000);
  let best: Revision | null = null;
  for (const r of revs) {
    if (r.size !== v.size) continue;
    const d = r.ctime - t;
    // A person's Seafile save lands on the NAS stamped with the commit time (seconds apart);
    // a NAS save reaches Seafile later, whenever the sync account next uploads.
    if (d < -MATCH_WINDOW_SEC || d > NAS_UPLOAD_LAG_SEC) continue;
    if (!best || Math.abs(d) < Math.abs(best.ctime - t)) best = r;
  }
  if (!best) return { via: null, name: null };
  if (isSyncAccount(best, syncEmails)) return { via: "nas", name: null };
  if (Math.abs(best.ctime - t) > MATCH_WINDOW_SEC) return { via: null, name: null };
  return { via: "seafile", name: best.name ?? best.email };
}

async function fileHistory(fetchFn: Fetch, server: string, token: string, libraryId: string, path: string): Promise<Revision[]> {
  const out: Revision[] = [];
  let commit: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(`${server}/api2/repos/${libraryId}/file/history/`);
    u.searchParams.set("p", path);
    if (commit) u.searchParams.set("commit_id", commit);
    const res = await fetchFn(u.toString(), { headers: { Authorization: `Token ${token}`, Accept: "application/json" } });
    if (!res.ok) break;
    const body = await res.json() as { commits?: Record<string, unknown>[]; next_start_commit?: string | null };
    for (const c of body.commits ?? []) {
      const info = (c.user_info ?? {}) as Record<string, unknown>;
      out.push({
        ctime: Number(c.ctime),
        size: Number(c.rev_file_size),
        name: typeof info.name === "string" ? info.name : null,
        email: typeof info.email === "string" ? info.email : (typeof c.creator_name === "string" ? c.creator_name : null),
      });
    }
    commit = body.next_start_commit ?? null;
    if (!commit) break;
  }
  return out;
}

export async function lookupSavedBy(
  db: Db,
  body: Record<string, unknown>,
  env: { token: string | null; syncEmails: string[] },
  fetchFn: Fetch = fetch,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const assetId = body.asset_id;
  if (typeof assetId !== "string" || !/^[0-9a-f-]{36}$/i.test(assetId)) return { status: 404, body: { error: "Asset not found" } };
  const { data: asset } = await db.from("assets").select("id, relative_path").eq("id", assetId).maybeSingle();
  if (!asset) return { status: 404, body: { error: "Asset not found" } };
  const versions = (Array.isArray(body.versions) ? body.versions : []).slice(0, MAX_VERSIONS) as VersionIn[];
  if (!env.token) return { status: 200, body: { ok: true, configured: false, versions: [] } };

  // Only the asset's own known locations may be looked up.
  const { data: candRows, error } = await db.rpc("dam_asset_path_candidates", { p_asset_id: assetId });
  if (error) return { status: 500, body: { error: error.message } };
  const allowed = new Set<string>(
    ((candRows ?? []) as unknown[]).map((r) => typeof r === "string" ? r : (r as Record<string, string>).dam_asset_path_candidates),
  );
  allowed.add(asset.relative_path);

  const { data: cfg } = await db.from("admin_config").select("value").eq("key", "HELPER_SEAFILE_LIBRARIES").maybeSingle();
  const libs = parseLibraries(cfg?.value);
  const { data: srv } = await db.from("admin_config").select("value").eq("key", "HELPER_SEAFILE_SERVER_URL").maybeSingle();
  const server = (typeof srv?.value === "string" ? srv.value : "").replace(/\/+$/, "");
  if (!server || libs.length === 0) return { status: 200, body: { ok: true, configured: false, versions: [] } };

  // Seafile follows renames from the current path; old paths are tried too.
  const paths = [asset.relative_path, ...new Set(versions.map((v) => v.source_path))].filter((p) => allowed.has(p));
  const revs: Revision[] = [];
  for (const p of [...new Set(paths)]) {
    const sf = toSeafile(p, libs);
    if (sf) revs.push(...await fileHistory(fetchFn, server, env.token, sf.libraryId, sf.path));
  }

  const out: SavedBy[] = versions
    .filter((v) => v && typeof v.source_path === "string" && typeof v.size === "number" && typeof v.mtime === "string")
    .map((v) => ({ source_path: v.source_path, size: v.size, mtime: v.mtime, ...matchVersion(v, revs, env.syncEmails) }));
  return { status: 200, body: { ok: true, configured: true, versions: out } };
}
