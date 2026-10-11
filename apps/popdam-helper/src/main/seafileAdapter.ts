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

import { access, open, readdir, stat } from "fs/promises";
import { basename, join, normalize, isAbsolute, sep } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { loadToken } from "./credentials";
import { saveConfig } from "./config";
import { log } from "./logger";
import { joinWithinRoot } from "./pathSafety";
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

async function safeIsDirAsync(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Async directory listing for health checks, which must never block Electron's UI thread. */
async function subDirsAsync(p: string): Promise<string[]> {
  try {
    const entries = await readdir(p, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() || await safeIsDirAsync(join(p, entry.name))) dirs.push(entry.name);
    }
    return dirs;
  } catch {
    return [];
  }
}

/** SeaDrive category folders a library may live under, relative to a base mount. */
const SEADRIVE_CATEGORY_DIRS = ["My Libraries", "Shared with all", "Shared with me"];
const SEADRIVE_ALL_CATEGORY_DIRS = [...SEADRIVE_CATEGORY_DIRS, "Shared with groups"];

/**
 * Every plausible SeaDrive base mount to search beneath. Includes the explicit
 * config root, the per-account subfolders of the platform default mount, and (on
 * Windows) C:\seadrive\<acct>. Order matters: explicit/config first.
 */
async function seaDriveBaseRootsAsync(config: LocalConfig): Promise<string[]> {
  const out: string[] = [];
  const add = async (p?: string | null) => {
    if (p && await safeIsDirAsync(p) && !out.includes(p)) out.push(p);
  };

  await add(config.seaDriveRoot);
  for (const acct of await subDirsAsync(config.seaDriveRoot ?? "")) {
    await add(join(config.seaDriveRoot ?? "", acct));
  }

  const parents = process.platform === "win32"
    ? ["C:\\seadrive", join(homedir(), "seadrive"), join(homedir(), "SeaDrive")]
    : [join(homedir(), "SeaDrive"), join(homedir(), "seadrive")];
  for (const parent of parents) {
    await add(parent);
    for (const acct of await subDirsAsync(parent)) await add(join(parent, acct));
  }
  return out;
}

/** Backwards-compatible single representative mount root (first base), or null. */
export async function detectSeaDriveRootAsync(config: LocalConfig): Promise<string | null> {
  return (await seaDriveBaseRootsAsync(config))[0] ?? null;
}

function addUnique(out: string[], name: string): void {
  if (!out.some((existing) => existing.toLowerCase() === name.toLowerCase())) out.push(name);
}

/**
 * Inventory visible SeaDrive library folders. This is broader than the PopDAM
 * checkout mapping: it shows what the client can see, including libraries not
 * yet configured in HELPER_SEAFILE_LIBRARIES.
 */
async function discoverSeaDriveLibrariesAsync(config: LocalConfig): Promise<string[]> {
  const found: string[] = [];
  const categoryNames = new Set(SEADRIVE_ALL_CATEGORY_DIRS.map((d) => d.toLowerCase()));
  for (const base of await seaDriveBaseRootsAsync(config)) {
    if (categoryNames.has(basename(base).toLowerCase())) {
      for (const lib of await subDirsAsync(base)) addUnique(found, lib);
    }
    for (const category of SEADRIVE_ALL_CATEGORY_DIRS) {
      const categoryDir = join(base, category);
      if (!await safeIsDirAsync(categoryDir)) continue;
      for (const child of await subDirsAsync(categoryDir)) {
        addUnique(found, child);
        if (category === "Shared with groups") {
          for (const nested of await subDirsAsync(join(categoryDir, child))) addUnique(found, nested);
        }
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

async function bfsFindDirAsync(base: string, target: string): Promise<string | null> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (visited++ > 400) break;
    for (const name of await subDirsAsync(dir)) {
      const child = join(dir, name);
      if (name.toLowerCase() === target.toLowerCase()) return child;
      if (depth + 1 < 3) queue.push({ dir: child, depth: depth + 1 });
    }
  }
  return null;
}

async function findLibraryDirAsync(seaDriveFolder: string, config: LocalConfig): Promise<string | null> {
  const cached = config.seafileLibraryPaths?.[seaDriveFolder];
  if (cached && await safeIsDirAsync(cached)) return cached;
  for (const base of await seaDriveBaseRootsAsync(config)) {
    const candidates = [
      join(base, seaDriveFolder),
      ...SEADRIVE_CATEGORY_DIRS.map((category) => join(base, category, seaDriveFolder)),
    ];
    for (const candidate of candidates) if (await safeIsDirAsync(candidate)) return candidate;
    const groups = join(base, "Shared with groups");
    if (await safeIsDirAsync(groups)) {
      for (const group of await subDirsAsync(groups)) {
        const candidate = join(groups, group, seaDriveFolder);
        if (await safeIsDirAsync(candidate)) return candidate;
      }
    }
    const found = await bfsFindDirAsync(base, seaDriveFolder);
    if (found) return found;
  }
  return null;
}

/**
 * Locate the absolute path of a SeaDrive library folder by its name. Checks the
 * per-library cache (re-validated), then searches every base/category. On a
 * fresh discovery, caches the hit in config so the next checkout is instant.
 * Returns null if the library isn't mounted anywhere we can see.
 */
async function findAndCacheLibraryDirAsync(seaDriveFolder: string, config: LocalConfig): Promise<string | null> {
  const found = await findLibraryDirAsync(seaDriveFolder, config);
  if (found && config.seafileLibraryPaths?.[seaDriveFolder] !== found) {
    try {
      saveConfig({
        seafileLibraryPaths: { ...(config.seafileLibraryPaths ?? {}), [seaDriveFolder]: found },
      });
    } catch (e) {
      log.warn("Could not cache discovered library path:", (e as Error).message);
    }
  }
  return found;
}

// ── Install / process detection ─────────────────────────────────────────────

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
export async function resolveSeafileTarget(
  relativePath: string,
  config: LocalConfig,
): Promise<SeafileTarget> {
  if ((await seaDriveBaseRootsAsync(config)).length === 0) {
    throw new Error("SeaDrive mount not found — is the SeaDrive client installed and signed in?");
  }

  const mapping = findMappingForPath(relativePath, config);
  if (!mapping) {
    throw new Error(`No Seafile library covers "${relativePath}".`);
  }

  // Auto-discover where THIS library is mounted (My Libraries / Shared with … ).
  const libDir = await findAndCacheLibraryDirAsync(mapping.seaDriveFolder, config);
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
  const localPath = pathInLib ? joinWithinRoot(libDir, pathInLib) : libDir;
  return { mapping, localPath, pathInLib };
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface SeafileHealth extends StorageHealth {
  provider: "seafile";
  installed: boolean;
  running: boolean;
  root: string | null;
  discoveredLibraries: string[];
  librariesConfigured: string[];
  librariesMounted: string[];
  librariesMissing: string[];
}

/** Health polling uses async filesystem calls so a slow macOS SeaDrive mount cannot freeze Electron. */
export async function getSeafileHealthAsync(config: LocalConfig): Promise<SeafileHealth> {
  const running = isSeaDriveRunning();
  const roots = await seaDriveBaseRootsAsync(config);
  const root = roots[0] ?? null;
  const appPaths = process.platform === "darwin"
    ? ["/Applications/SeaDrive.app", join(homedir(), "Applications/SeaDrive.app")]
    : ["C:\\Program Files\\SeaDrive\\seadrive.exe", "C:\\Program Files (x86)\\SeaDrive\\seadrive.exe"];
  const installed = running || !!root || (await Promise.all(appPaths.map(pathExists))).some(Boolean);
  const discovered = await discoverSeaDriveLibrariesAsync(config);
  const mappings = config.seafileLibraries ?? [];
  const configured = mappings.map((library) => library.seaDriveFolder);
  const mountedChecks = await Promise.all(mappings.map(async (library) => ({
    folder: library.seaDriveFolder,
    mounted: await findLibraryDirAsync(library.seaDriveFolder, config) !== null,
  })));
  const librariesMounted = mountedChecks.filter((library) => library.mounted).map((library) => library.folder);
  const librariesMissing = mountedChecks.filter((library) => !library.mounted).map((library) => library.folder);
  let detail: string | undefined;
  if (!installed) detail = "SeaDrive client not detected.";
  else if (!root) detail = "SeaDrive mount root not found.";
  else if (!running) detail = "SeaDrive client is not running.";
  return {
    provider: "seafile",
    available: installed && running && !!root && librariesMissing.length === 0,
    installed,
    running,
    root,
    librariesMounted,
    librariesMissing,
    discoveredLibraries: discovered,
    librariesConfigured: configured,
    detail,
  };
}

// ── Hydration ───────────────────────────────────────────────────────────────

/**
 * SeaDrive presents cloud-only files as zero-byte (or sparse) placeholders that
 * fill in on access. We treat a readable, non-empty, size-stable file as local.
 */
export async function getHydrationStatus(localPath: string): Promise<HydrationStatus> {
  try {
    const size = (await stat(localPath)).size;
    if (size <= 0) return { state: "hydrating", bytesDone: 0 };
    return { state: "local", bytesDone: size, bytesTotal: size };
  } catch {
    return { state: "unavailable" };
  }
}

/** Touch the file to nudge SeaDrive into hydrating it (read first byte). */
async function nudgeHydration(localPath: string): Promise<void> {
  try {
    const fh = await open(localPath, "r");
    try {
      await fh.read(Buffer.alloc(1), 0, 1, 0);
    } finally {
      await fh.close();
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

  if (!(await pathExists(localPath))) {
    throw new Error(`File not found in SeaDrive: ${localPath}`);
  }

  await nudgeHydration(localPath);

  let lastSize = -1;
  let stable = 0;
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getHydrationStatus(localPath);
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
      await nudgeHydration(localPath);
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

export async function testSeafileMapping(
  sampleRelativePath: string,
  config: LocalConfig,
): Promise<MappingTestResult> {
  try {
    const { localPath, mapping } = await resolveSeafileTarget(sampleRelativePath, config);
    const exists = await pathExists(localPath);
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
