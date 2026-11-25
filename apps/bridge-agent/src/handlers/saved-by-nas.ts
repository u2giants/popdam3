/**
 * "Saved by" from the office NAS's own logs (u2giants/popdam3#1342).
 *
 * The NAS monitoring API (synology-monitor nas-api, read-only POST
 * /file-activity) returns events with the person's name from the SMB transfer
 * log, the File Station transfer log and the Synology Drive log.
 *
 * Two kinds of answer:
 * - "save": an event on the same file at its saved time (SMB/File Station:
 *   within 5 minutes and the same size; Drive: up to 15 minutes later).
 * - "transfer": the file was copied, downloaded or uploaded in and kept its
 *   original saved time, so the log shows the person later. Only accepted when
 *   the log between the saved time and the first snapshot holding this
 *   version shows exactly one person bringing the file in once, and nothing
 *   else (no delete, no second create), with every log read succeeding.
 *
 * Optional: without admin_config NAS_FILE_ACTIVITY (or the
 * NAS_FILE_ACTIVITY_URL/TOKEN env vars) nothing changes.
 */
import type { SnapshotVersion } from "./snapshot-tools.js";

export interface NasEvent {
  source: "smb" | "drive" | "filestation";
  time: number;
  username: string;
  action: string;
  size?: number;
  path: string;
}
export interface SavedByNas {
  name: string;
  via: "smb" | "drive" | "filestation";
  /** "transfer" = brought in later with its original saved time (copy, download, upload). */
  kind?: "save" | "transfer";
}

/** Seconds either side of the saved time. App saves write a temp file, then rename it in. */
export const WINDOW_SEC = 300;
/** Drive can log a save a few minutes after the file's saved time. */
export const DRIVE_LATE_SEC = 900;
/** The NAS API reads at most 6 hours per call. */
export const CHUNK_SEC = 6 * 3600;
/** Longest gap between snapshots we search for a transfer (covers a weekend). */
export const MAX_TRANSFER_SEC = 72 * 3600;
const TIMEOUT_MS = 15_000;
/** All log reads for one listing share this deadline. */
const LISTING_DEADLINE_MS = 45_000;

/** `IML\asilva` → `asilva`. */
export function displayUser(u: string): string {
  const i = u.lastIndexOf("\\");
  return i >= 0 ? u.slice(i + 1) : u;
}

/** Path on the share ends with the version's relative path (SMB paths start with the share name). */
export function samePath(eventPath: string, rel: string): boolean {
  const e = eventPath.toLowerCase();
  const r = "/" + rel.toLowerCase().replace(/^\/+/, "");
  return e === r || e.endsWith(r);
}

const SAVE_ACTIONS = new Set(["write", "rename", "create", "upload", "move", "copy"]);

export function pickSaver(v: Pick<SnapshotVersion, "source_path" | "size" | "mtime">, events: NasEvent[]): SavedByNas | null {
  const t = Math.floor(new Date(v.mtime).getTime() / 1000);
  let best: NasEvent | null = null;
  for (const e of events) {
    if (!samePath(e.path, v.source_path)) continue;
    const d = e.time - t;
    if (e.source === "drive") {
      if (d < -WINDOW_SEC || d > DRIVE_LATE_SEC) continue;
    } else {
      if (Math.abs(d) > WINDOW_SEC || !SAVE_ACTIONS.has(e.action)) continue;
      // SMB/File Station record the size; a rename's size is the finished file's size.
      if (e.size && e.size !== v.size) continue;
    }
    if (!best || Math.abs(e.time - t) < Math.abs(best.time - t)) best = e;
  }
  return best ? { name: displayUser(best.username), via: best.source, kind: "save" } : null;
}

/** Bounds for a transfer: after the saved time and the last snapshot without this version, up to the first snapshot with it. */
export function transferBounds(v: Pick<SnapshotVersion, "mtime" | "first_taken_at" | "prev_taken_at">): { since: number; until: number } | null {
  const t = Math.floor(new Date(v.mtime).getTime() / 1000);
  const until = Math.floor(new Date(v.first_taken_at).getTime() / 1000);
  const prev = v.prev_taken_at ? Math.floor(new Date(v.prev_taken_at).getTime() / 1000) : until - MAX_TRANSFER_SEC;
  const since = Math.max(t - WINDOW_SEC, prev);
  if (!(until > since) || until - since > MAX_TRANSFER_SEC) return null;
  return { since, until };
}

/**
 * One unambiguous transfer in the bounds, or null. Exactly one person; one
 * create/upload/copy/move; no delete. Evidence is an event with the final size,
 * or a create followed by a write from that person (large copies log a chunk size).
 */
export function pickTransfer(
  v: Pick<SnapshotVersion, "source_path" | "size">,
  events: NasEvent[],
  b: { since: number; until: number },
): SavedByNas | null {
  const on = events
    .filter((e) => e.source !== "drive" && samePath(e.path, v.source_path) && e.time >= b.since && e.time <= b.until)
    .sort((a, c) => a.time - c.time);
  if (on.length === 0) return null;
  if (new Set(on.map((e) => e.username.toLowerCase())).size !== 1) return null;
  if (on.some((e) => e.action === "delete")) return null;
  const arrivals = on.filter((e) => ["create", "upload", "copy", "move"].includes(e.action));
  if (arrivals.length > 1) return null;
  const finalSize = on.find((e) => SAVE_ACTIONS.has(e.action) && e.size === v.size);
  const create = on.find((e) => e.action === "create");
  const writeAfter = create && on.find((e) => e.action === "write" && e.time >= create.time);
  const ev = finalSize ?? (writeAfter ? create : undefined);
  return ev ? { name: displayUser(ev.username), via: ev.source, kind: "transfer" } : null;
}

/** Set from the server's heartbeat config (admin_config NAS_FILE_ACTIVITY); env vars are a fallback. */
let fromServer: { url?: string; token?: string } | null = null;
export function setNasFileActivity(cfg: { url?: string; token?: string } | null): void {
  fromServer = cfg && typeof cfg.url === "string" && typeof cfg.token === "string" ? { url: cfg.url, token: cfg.token } : null;
}
function currentEnv(): { url?: string; token?: string } {
  return fromServer ?? { url: process.env.NAS_FILE_ACTIVITY_URL, token: process.env.NAS_FILE_ACTIVITY_TOKEN };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Events for [since, until] in 6-hour reads; null if any read fails (incomplete coverage). */
async function readEvents(
  env: { url: string; token: string },
  fetchFn: Fetch,
  since: number,
  until: number,
  contains: string,
  deadline: number,
): Promise<NasEvent[] | null> {
  const out: NasEvent[] = [];
  for (let s = since; s <= until; s += CHUNK_SEC + 1) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const res = await fetchFn(`${env.url.replace(/\/+$/, "")}/file-activity`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ since: s, until: Math.min(until, s + CHUNK_SEC), contains }),
      signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, left)),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { events?: NasEvent[]; errors?: Record<string, string> };
    // A failed SMB or File Station read means the log was not fully seen.
    if (body.errors?.smb || body.errors?.filestation) return null;
    out.push(...(body.events ?? []));
  }
  return out;
}

export async function addNasSavers<T extends SnapshotVersion>(
  versions: T[],
  env: { url?: string; token?: string } = currentEnv(),
  fetchFn: Fetch = fetch,
  deadlineMs = LISTING_DEADLINE_MS,
): Promise<Array<T & { saved_by_nas?: SavedByNas }>> {
  if (!env.url || !env.token) return versions;
  const cfg = { url: env.url, token: env.token };
  const deadline = Date.now() + deadlineMs;
  const out: Array<T & { saved_by_nas?: SavedByNas }> = [];
  for (const v of versions) {
    const t = Math.floor(new Date(v.mtime).getTime() / 1000);
    const contains = v.source_path.split("/").pop() ?? "";
    try {
      const near = await readEvents(cfg, fetchFn, t - WINDOW_SEC, t + DRIVE_LATE_SEC, contains, deadline);
      let who = near ? pickSaver(v, near) : null;
      if (!who) {
        const b = transferBounds(v);
        const events = b ? await readEvents(cfg, fetchFn, b.since, b.until, contains, deadline) : null;
        if (b && events) who = pickTransfer(v, events, b);
      }
      out.push(who ? { ...v, saved_by_nas: who } : v);
    } catch {
      out.push(v); // names are a bonus; never fail the listing
    }
  }
  return out;
}
