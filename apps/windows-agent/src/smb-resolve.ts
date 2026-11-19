/**
 * Resolve a NAS path to the exact name the Windows SMB client lists.
 *
 * Samba's catia/fruit mapping, and any other name translation on the share, can
 * change how a file name looks to Windows. Constructing the path from the
 * database name can then miss the file even though it is there. When the
 * constructed path does not exist, list the parent folder and match by normalized
 * name, then open the name that is actually listed.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Windows path rules are used on every platform so the resolver behaves the same under test. */
const win = path.win32;

/**
 * Windows MAX_PATH (260) applies to fs calls unless the path uses the extended-length prefix.
 * Long NAS paths (over 230 characters) must be prefixed for existsSync/readdirSync/statSync.
 */
export function longPath(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32" || p.startsWith("\\\\?\\")) return p;
  if (/^[A-Za-z]:\\/.test(p)) return "\\\\?\\" + p;
  if (p.startsWith("\\\\")) return "\\\\?\\UNC\\" + p.slice(2);
  return p;
}

/** Private-use code points Samba catia uses for characters Windows forbids. */
const CATIA_TO_ASCII: Record<string, string> = {
  "\uF022": '"',
  "\uF02A": "*",
  "\uF03A": ":",
  "\uF03C": "<",
  "\uF03E": ">",
  "\uF03F": "?",
  "\uF05C": "\\",
  "\uF07C": "|",
};

/** Map private-use catia characters back to ASCII. */
export function normalizeSmbName(name: string): string {
  let out = "";
  for (const ch of name) out += CATIA_TO_ASCII[ch] ?? ch;
  return out;
}

/**
 * Pick the listed name whose normalized form equals the requested normalized name.
 * No loose matching: on the NAS `10"Wall.psd` and `10Wall.psd` are different files,
 * so a near match must never stand in for the requested file.
 */
export function matchSmbName(requested: string, listed: string[]): string | null {
  const want = normalizeSmbName(requested);
  const exact = listed.filter((n) => normalizeSmbName(n) === want);
  return exact.length === 1 ? exact[0] : null;
}

/** NAS-reported size and modified time for the asset being rendered. */
export interface ExpectedFile {
  size: number;
  mtimeMs: number;
}

/** Windows 8.3 short names look like `4TQCYS~A.AI`: they contain `~`. */
function isMangledName(name: string): boolean {
  return name.includes("~");
}

/**
 * When Samba lists a long name only as an 8.3 short name, pick the entry whose size and
 * modified time equal the NAS values. Restricted to mangled names with the same extension.
 * Returns null unless exactly one entry matches (refuses 0 and more-than-one).
 */
export function matchMangledFile(
  requested: string,
  listed: string[],
  statOf: (name: string) => { size: number; mtimeMs: number },
  expected: ExpectedFile,
): string | null {
  const ext = win.extname(requested).toLowerCase();
  if (!ext) return null;
  const hits = listed.filter((n) => {
    if (!isMangledName(n) || win.extname(n).toLowerCase() !== ext) return false;
    try {
      const st = statOf(n);
      return st.size === expected.size && Math.abs(st.mtimeMs - expected.mtimeMs) <= 2000;
    } catch {
      return false;
    }
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Split a Windows path into its root (drive `Z:\` or UNC `\\host\share\`) and the
 * segments under it. Returns null when the path has neither form.
 */
export function splitSmbRoot(windowsPath: string): { root: string; segments: string[] } | null {
  const drive = /^[A-Za-z]:\\/.exec(windowsPath);
  const unc = /^\\\\[^\\]+\\[^\\]+\\/.exec(windowsPath);
  const root = drive ? drive[0] : unc ? unc[0] : null;
  if (!root) return null;
  return { root, segments: windowsPath.slice(root.length).split("\\").filter((p) => p.length > 0) };
}

/** File-system calls the resolver needs; injectable so tests can model an SMB listing. */
export interface SmbFs {
  exists(p: string): boolean;
  list(p: string): string[];
  stat(p: string): { size: number; mtimeMs: number; isDirectory: boolean };
}

const realFs: SmbFs = {
  exists: (p) => existsSync(longPath(p)),
  list: (p) => readdirSync(longPath(p)),
  stat: (p) => {
    const st = statSync(longPath(p));
    return { size: st.size, mtimeMs: st.mtimeMs, isDirectory: st.isDirectory() };
  },
};

/** Shared across the entire lookup, including nested folder guesses. */
const MAX_MANGLED_DIR_PROBES = 64;

/** Require an 8.3-shaped alias before guessing an intermediate folder. */
const MANGLED_DIR_NAME = /^(?=[a-z0-9~]{3,8}(?:\.|$))[a-z0-9]+~(?:[a-z0-9]|[0-9]+)(?:\.[a-z0-9]{1,3})?$/i;

/**
 * Resolve `segments[i..]` under `cur`. Returns the full listed path, or null.
 *
 * Without catia, Samba shows a folder whose name has a forbidden character (e.g.
 * `12"`) only as an 8.3 name such as `1736GU~Y`. A folder has no size to match, so
 * each mangled folder is probed: it is accepted only when exactly one of them
 * contains the rest of the path.
 */
function resolveFrom(
  fs: SmbFs,
  cur: string,
  segments: string[],
  i: number,
  budget: { remaining: number },
  expected?: ExpectedFile,
): string | null {
  if (i === segments.length) return cur;
  const seg = segments[i];
  const last = i === segments.length - 1;
  const direct = win.join(cur, seg);
  if (fs.exists(direct)) return resolveFrom(fs, direct, segments, i + 1, budget, expected);
  let listed: string[];
  try {
    listed = fs.list(cur);
  } catch {
    return null;
  }
  const named = matchSmbName(seg, listed);
  if (named) return resolveFrom(fs, win.join(cur, named), segments, i + 1, budget, expected);
  if (last) {
    if (!expected) return null;
    const m = matchMangledFile(seg, listed, (n) => fs.stat(win.join(cur, n)), expected);
    return m ? win.join(cur, m) : null;
  }
  let hit: string | null = null;
  for (const name of listed) {
    if (!MANGLED_DIR_NAME.test(name)) continue;
    if (--budget.remaining < 0) return null;
    const candidate = win.join(cur, name);
    let resolved: string | null;
    try {
      if (!fs.stat(candidate).isDirectory) continue;
      resolved = resolveFrom(fs, candidate, segments, i + 1, budget, expected);
    } catch {
      continue;
    }
    if (budget.remaining < 0) return null;
    if (!resolved) continue;
    if (hit) return null;
    hit = resolved;
  }
  return hit;
}

/**
 * Return the path with each segment replaced by the name the share actually lists.
 * Returns the input unchanged when it already exists or when a segment cannot be matched.
 */
export function resolveExistingSmbPath(windowsPath: string, expected?: ExpectedFile, fs: SmbFs = realFs): string {
  if (fs.exists(windowsPath)) return windowsPath;
  const split = splitSmbRoot(windowsPath);
  if (!split) return windowsPath;
  return resolveFrom(fs, split.root, split.segments, 0, { remaining: MAX_MANGLED_DIR_PROBES }, expected) ?? windowsPath;
}
