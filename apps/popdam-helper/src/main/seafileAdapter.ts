/**
 * Seafile / SeaDrive adapter.
 *
 * The Helper *supervises* an officially-installed SeaDrive client — it never
 * forks, embeds, or writes into the shared mount as the primary workflow.
 * Everything here is read-only detection + path mapping + hydration waiting.
 *
 * Boundary (see docs/POPDAM_HELPER.md / HANDOFF.md):
 *  - Detect the installed client and its mount root.
 *  - Map a PopDAM root_id + relative_path to a SeaDrive library path.
 *  - Confirm a file is hydrated (fully local) or trigger + wait for hydration.
 *  - Optionally fetch the Seafile REST `obj_id` for source_version (needs a token).
 *
 * No API token required for the first slice: getSeafileObjId() returns null
 * when no token/server URL is configured, which is an accepted state.
 */

import { existsSync, statSync, openSync, closeSync, readSync, readdirSync } from "fs";
import { join, normalize, isAbsolute, sep } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { loadToken } from "./credentials";
import { saveConfig } from "./config";
import { log } from "./logger";
import type {
  LocalConfig,
  SeafileLibraryMapping,
  StorageHealth,
  HydrationStatus,
} from "@shared/types";

// ── Mount-root detection & library discovery ────────────────────────────────
//
// SeaDrive does NOT put a library in one fixed place. The mount location varies
// by OS and by the account name picked at sign-in (Windows: C:\seadrive\<acct>\,
// macOS: ~/SeaDrive\<acct>\), and within a mount a library can sit under any of
// several category folders depending on how it's shared with that user:
//   My Libraries\<lib>            (libraries you own)
//   Shared with all\<lib>
//   Shared with me\<lib>
//   Shared with groups\<group>\<lib>
// Non-technical users won't know or configure this, so the Helper discovers the
// library folder by searching every plausible base + category, then caches the
// hit. Search is bounded (depth + node caps) so a virtual drive can't hang us.

function safeIsDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Immediate subdirectory names of `p` (dirs only, no dotfiles). Never throws. */
function subDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** SeaDrive category folders a library may live under, relative to a base mount. */
const SEADRIVE_CATEGORY_DIRS = ["My Libraries", "Shared with all", "Shared with me"];

/**
 * Every plausible SeaDrive base mount to search beneath. Includes the explicit
 * config root, the per-account subfolders of the platform default mount, and (on
 * Windows) C:\seadrive\<acct>. Order matters: explicit/config first.
 */
export function seaDriveBaseRoots(config: LocalConfig): string[] {
  const out: string[] = [];
  const add = (p?: string | null) => {
    if (p && safeIsDir(p) && !out.includes(p)) out.push(p);
  };

  add(config.seaDriveRoot);

  // Platform default mount parents + their per-account subfolders.
  const parents =
    process.platform === "win32"
      ? ["C:\\seadrive", join(homedir(), "seadrive"), join(homedir(), "SeaDrive")]
      : [join(homedir(), "SeaDrive"), join(homedir(), "seadrive")];

  for (const parent of parents) {
    add(parent);
    for (const acct of subDirs(parent)) add(join(parent, acct));
  }
  return out;
}

/** Backwards-compatible single representative mount root (first base), or null. */
export function detectSeaDriveRoot(config: LocalConfig): string | null {
  return seaDriveBaseRoots(config)[0] ?? null;
}

/** Bounded breadth-first search for a directory named `target` under `base`. */
function bfsFindDir(base: string, target: string, maxDepth: number, maxNodes: number): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (visited++ > maxNodes) break;
    for (const name of subDirs(dir)) {
      const child = join(dir, name);
      if (name === target) return child;
      if (depth + 1 < maxDepth) queue.push({ dir: child, depth: depth + 1 });
    }
  }
  return null;
}

/** Search one base mount for a library folder named `target`. */
function searchUnderBase(base: string, target: string): string | null {
  // Fast deterministic candidates (direct + known category folders).
  const direct = [join(base, target), ...SEADRIVE_CATEGORY_DIRS.map((c) => join(base, c, target))];
  for (const c of direct) if (safeIsDir(c)) return c;

  // "Shared with groups/<group>/<lib>" — one extra (group-name) level.
  const groups = join(base, "Shared with groups");
  if (safeIsDir(groups)) {
    for (const g of subDirs(groups)) {
      const c = join(groups, g, target);
      if (safeIsDir(c)) return c;
    }
  }

  // Bounded fallback scan for anything we didn't anticipate.
  return bfsFindDir(base, target, 3, 400);
}

/**
 * Locate the absolute path of a SeaDrive library folder by its name. Checks the
 * per-library cache (re-validated), then searches every base/category. On a
 * fresh discovery, caches the hit in config so the next checkout is instant.
 * Returns null if the library isn't mounted anywhere we can see.
 */
export function findLibraryDir(seaDriveFolder: string, config: LocalConfig): string | null {
  const cached = config.seafileLibraryPaths?.[seaDriveFolder];
  if (cached && safeIsDir(cached)) return cached;

  for (const base of seaDriveBaseRoots(config)) {
    const found = searchUnderBase(base, seaDriveFolder);
    if (found) {
      try {
        saveConfig({
          seafileLibraryPaths: { ...(config.seafileLibraryPaths ?? {}), [seaDriveFolder]: found },
        });
      } catch (e) {
        log.warn("Could not cache discovered library path:", (e as Error).message);
      }
      return found;
    }
  }
  return null;
}

// ── Install / process detection ─────────────────────────────────────────────

/**
 * Best-effort check for an installed SeaDrive (virtual-drive) client.
 * We only support SeaDrive — never the legacy Seafile *sync* client, which would
 * try to fully download a library to local disk. Do not add sync-client paths here.
 */
export function isSeaDriveInstalled(): boolean {
  const paths =
    process.platform === "darwin"
      ? [
          "/Applications/SeaDrive.app",
          join(homedir(), "Applications/SeaDrive.app"),
        ]
      : [
          "C:\\Program Files\\SeaDrive\\seadrive.exe",
          "C:\\Program Files (x86)\\SeaDrive\\seadrive.exe",
        ];
  return paths.some((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

/** Best-effort process-list check. Never throws — returns false on any error. */
export function isSeaDriveRunning(): boolean {
  try {
    if (process.platform === "darwin") {
      // pgrep exits non-zero (throws) when nothing matches.
      const out = execFileSync("pgrep", ["-il", "seadrive"], {
        encoding: "utf-8",
        timeout: 3000,
      });
      return out.trim().length > 0;
    }
    // Windows
    const out = execFileSync(
      "tasklist",
      ["/FI", "IMAGENAME eq seadrive.exe", "/NH"],
      { encoding: "utf-8", timeout: 3000 },
    );
    return /seadrive\.exe/i.test(out);
  } catch {
    return false;
  }
}

// ── Path mapping ────────────────────────────────────────────────────────────

/** Reject relative paths that try to escape the library root. */
function sanitizeRelativePath(p: string): string {
  const normalized = normalize(p.replace(/\\/g, "/"));
  if (
    isAbsolute(normalized) ||
    normalized.startsWith("..") ||
    normalized.includes(".." + sep) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.startsWith("//") ||
    normalized.startsWith("\\\\")
  ) {
    throw new Error(`Unsafe relative path rejected: "${p}"`);
  }
  return normalized;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Find the Seafile library whose pathPrefix is the longest match for a given
 * relative_path. A PopDAM root can hold multiple libraries as subfolders
 * (e.g. "Decor/Character Licensed" and "Decor/Generic Decor"), so we match on
 * the full prefix, not just the first segment.
 */
function findMappingForPath(
  relativePath: string,
  config: LocalConfig,
): SeafileLibraryMapping | null {
  const rel = normalizeRel(relativePath);
  let best: SeafileLibraryMapping | null = null;
  let bestLen = -1;
  for (const m of config.seafileLibraries ?? []) {
    const prefix = normalizeRel(m.pathPrefix);
    if (rel === prefix || rel.startsWith(prefix + "/")) {
      if (prefix.length > bestLen) {
        best = m;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

export interface SeafileTarget {
  mapping: SeafileLibraryMapping;
  localPath: string;  // absolute path under the SeaDrive mount
  pathInLib: string;  // path within the Seafile library (relative_path minus the prefix)
}

/**
 * Resolve a PopDAM relative_path to a SeaDrive target: the matching library,
 * the absolute local path, and the in-library path.
 *
 * Throws on: no mount root, no library covering the path, or unsafe path.
 */
export function resolveSeafileTarget(
  relativePath: string,
  config: LocalConfig,
): SeafileTarget {
  if (seaDriveBaseRoots(config).length === 0) {
    throw new Error("SeaDrive mount not found — is the SeaDrive client installed and signed in?");
  }

  const mapping = findMappingForPath(relativePath, config);
  if (!mapping) {
    throw new Error(`No Seafile library covers "${relativePath}".`);
  }

  // Auto-discover where THIS library is mounted (My Libraries / Shared with … ).
  const libDir = findLibraryDir(mapping.seaDriveFolder, config);
  if (!libDir) {
    throw new Error(
      `The "${mapping.displayName}" library isn't visible in SeaDrive yet. ` +
        `Open SeaDrive and make sure that library is synced/enabled, then try again.`,
    );
  }

  const rel = normalizeRel(relativePath);
  const prefix = normalizeRel(mapping.pathPrefix);
  const remainder = rel === prefix ? "" : rel.slice(prefix.length + 1);
  const pathInLib = remainder ? sanitizeRelativePath(remainder) : "";
  const localPath = pathInLib ? join(libDir, pathInLib) : libDir;
  return { mapping, localPath, pathInLib };
}

/** Convenience wrapper returning just the absolute local path. */
export function resolveSeafilePath(relativePath: string, config: LocalConfig): string {
  return resolveSeafileTarget(relativePath, config).localPath;
}

/** Configured library folders the Helper can actually locate in SeaDrive. */
export function getMountedLibraries(config: LocalConfig): string[] {
  if (seaDriveBaseRoots(config).length === 0) return [];
  return (config.seafileLibraries ?? [])
    .map((m) => m.seaDriveFolder)
    .filter((folder) => findLibraryDir(folder, config) !== null);
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface SeafileHealth extends StorageHealth {
  provider: "seafile";
  installed: boolean;
  running: boolean;
  root: string | null;
  librariesConfigured: string[];
  librariesMounted: string[];
  librariesMissing: string[];
}

export function getSeafileHealth(config: LocalConfig): SeafileHealth {
  const installed = isSeaDriveInstalled();
  const running = isSeaDriveRunning();
  const root = detectSeaDriveRoot(config);
  const configured = (config.seafileLibraries ?? []).map((m) => m.seaDriveFolder);
  const mounted = getMountedLibraries(config);
  const missing = configured.filter((f) => !mounted.includes(f));

  let detail: string | undefined;
  if (!installed) detail = "SeaDrive client not detected.";
  else if (!root) detail = "SeaDrive mount root not found.";
  else if (!running) detail = "SeaDrive client is not running.";
  else if (missing.length) detail = `Libraries not mounted: ${missing.join(", ")}`;

  const available = !!root && missing.length === 0;
  return {
    provider: "seafile",
    available,
    installed,
    running,
    root,
    librariesConfigured: configured,
    librariesMounted: mounted,
    librariesMissing: missing,
    detail,
  };
}

// ── Hydration ───────────────────────────────────────────────────────────────

/**
 * SeaDrive presents cloud-only files as zero-byte (or sparse) placeholders that
 * fill in on access. We treat a readable, non-empty, size-stable file as local.
 */
export function getHydrationStatus(localPath: string): HydrationStatus {
  try {
    if (!existsSync(localPath)) return { state: "unavailable" };
    const size = statSync(localPath).size;
    if (size <= 0) return { state: "hydrating", bytesDone: 0 };
    return { state: "local", bytesDone: size, bytesTotal: size };
  } catch {
    return { state: "unavailable" };
  }
}

/** Touch the file to nudge SeaDrive into hydrating it (read first byte). */
function nudgeHydration(localPath: string): void {
  try {
    const fd = openSync(localPath, "r");
    try {
      const buf = Buffer.alloc(1);
      readSync(fd, buf, 0, 1, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Ensure a SeaDrive file is fully local. Triggers hydration and polls until the
 * size is stable across two reads. Throws if it never stabilizes in time.
 */
export async function ensureHydrated(
  localPath: string,
  opts: { maxAttempts?: number; intervalMs?: number; onProgress?: (s: HydrationStatus) => void } = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 60; // ~3 min at 3s
  const intervalMs = opts.intervalMs ?? 3000;

  if (!existsSync(localPath)) {
    throw new Error(`File not found in SeaDrive: ${localPath}`);
  }

  nudgeHydration(localPath);

  let lastSize = -1;
  let stable = 0;
  for (let i = 0; i < maxAttempts; i++) {
    const status = getHydrationStatus(localPath);
    opts.onProgress?.(status);
    if (status.state === "local") {
      const size = status.bytesDone ?? 0;
      if (size === lastSize) {
        stable++;
        if (stable >= 2) return;
      } else {
        stable = 0;
        lastSize = size;
      }
    } else if (status.state === "unavailable") {
      throw new Error(`File became unavailable during hydration: ${localPath}`);
    } else {
      stable = 0;
      nudgeHydration(localPath);
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `File "${localPath}" did not finish hydrating from SeaDrive in time.`,
  );
}

// ── Seafile REST: obj_id for source_version ─────────────────────────────────

/**
 * Fetch the Seafile server file object id (obj_id) used as source_version.
 * Returns null when no API token / server URL is configured — accepted for the
 * first slice (source_version stays null for those checkouts).
 *
 * Endpoint: GET {server}/api2/repos/{libraryId}/file/detail/?p=/{pathInLib}
 */
export async function getSeafileObjId(
  libraryId: string,
  pathInLib: string,
  config: LocalConfig,
): Promise<string | null> {
  const token = loadToken("seafile_api_token");
  const server = config.seafileServerUrl;
  if (!token || !server) return null;

  try {
    const p = "/" + pathInLib.replace(/\\/g, "/").replace(/^\/+/, "");
    const url =
      `${server.replace(/\/$/, "")}/api2/repos/${libraryId}/file/detail/` +
      `?p=${encodeURIComponent(p)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      log.warn(`Seafile file/detail failed (${res.status}) for ${pathInLib}`);
      return null;
    }
    const json = (await res.json()) as { id?: string };
    return json.id ?? null;
  } catch (e) {
    log.warn("Seafile obj_id lookup failed:", e);
    return null;
  }
}

// ── Mapping test (Settings UI) ──────────────────────────────────────────────

export interface MappingTestResult {
  ok: boolean;
  resolvedPath?: string;
  exists?: boolean;
  message: string;
}

export function testSeafileMapping(
  sampleRelativePath: string,
  config: LocalConfig,
): MappingTestResult {
  try {
    const { localPath, mapping } = resolveSeafileTarget(sampleRelativePath, config);
    const exists = existsSync(localPath);
    return {
      ok: true,
      resolvedPath: localPath,
      exists,
      message: exists
        ? `Resolves to library "${mapping.displayName}" and the path exists.`
        : `Resolves to library "${mapping.displayName}", but the sample path is not hydrated/synced yet.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
