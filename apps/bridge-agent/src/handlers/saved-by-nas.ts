/**
 * "Saved by" from the office NAS's own logs (u2giants/popdam3#1342).
 *
 * The NAS monitoring API (synology-monitor nas-api, read-only POST
 * /file-activity) returns save events with the person's name from the SMB
 * transfer log and the Synology Drive log. For each snapshot version we look a
 * few minutes around its saved time for an event on the same file, and for SMB
 * the same size. Optional: without NAS_FILE_ACTIVITY_URL/TOKEN nothing changes.
 */
import type { SnapshotVersion } from "./snapshot-tools.js";

export interface NasEvent {
  source: "smb" | "drive";
  time: number;
  username: string;
  action: string;
  size?: number;
  path: string;
}
export interface SavedByNas {
  name: string;
  via: "smb" | "drive";
}

/** Seconds either side of the saved time. App saves write a temp file, then rename it in. */
export const WINDOW_SEC = 300;
const TIMEOUT_MS = 15_000;

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

export function pickSaver(v: Pick<SnapshotVersion, "source_path" | "size" | "mtime">, events: NasEvent[]): SavedByNas | null {
  const t = Math.floor(new Date(v.mtime).getTime() / 1000);
  let best: NasEvent | null = null;
  for (const e of events) {
    if (!samePath(e.path, v.source_path)) continue;
    if (Math.abs(e.time - t) > WINDOW_SEC) continue;
    // SMB records the size; a rename's size is the finished file's size.
    if (e.source === "smb" && e.size && e.size !== v.size) continue;
    if (!best || Math.abs(e.time - t) < Math.abs(best.time - t)) best = e;
  }
  return best ? { name: displayUser(best.username), via: best.source } : null;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function addNasSavers<T extends SnapshotVersion>(
  versions: T[],
  env: { url?: string; token?: string } = { url: process.env.NAS_FILE_ACTIVITY_URL, token: process.env.NAS_FILE_ACTIVITY_TOKEN },
  fetchFn: Fetch = fetch,
): Promise<Array<T & { saved_by_nas?: SavedByNas }>> {
  if (!env.url || !env.token) return versions;
  const out: Array<T & { saved_by_nas?: SavedByNas }> = [];
  for (const v of versions) {
    const t = Math.floor(new Date(v.mtime).getTime() / 1000);
    try {
      const res = await fetchFn(`${env.url.replace(/\/+$/, "")}/file-activity`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ since: t - WINDOW_SEC, until: t + WINDOW_SEC, contains: v.source_path.split("/").pop() }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        out.push(v);
        continue;
      }
      const body = (await res.json()) as { events?: NasEvent[] };
      const who = pickSaver(v, body.events ?? []);
      out.push(who ? { ...v, saved_by_nas: who } : v);
    } catch {
      out.push(v); // names are a bonus; never fail the listing
    }
  }
  return out;
}
