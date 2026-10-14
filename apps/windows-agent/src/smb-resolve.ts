/**
 * Resolve a NAS path to the exact name the Windows SMB client lists.
 *
 * Samba's catia/fruit mapping, and any other name translation on the share, can
 * change how a file name looks to Windows. Constructing the path from the
 * database name can then miss the file even though it is there. When the
 * constructed path does not exist, list the parent folder and match by normalized
 * name, then open the name that is actually listed.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Windows path rules are used on every platform so the resolver behaves the same under test. */
const win = path.win32;

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

/**
 * Return the path with each segment replaced by the name the share actually lists.
 * Returns the input unchanged when it already exists or when a segment cannot be matched.
 */
export function resolveExistingSmbPath(windowsPath: string): string {
  if (existsSync(windowsPath)) return windowsPath;
  const split = splitSmbRoot(windowsPath);
  if (!split) return windowsPath;
  let cur = split.root;
  for (const seg of split.segments) {
    const direct = win.join(cur, seg);
    if (existsSync(direct)) {
      cur = direct;
      continue;
    }
    let listed: string[];
    try {
      listed = readdirSync(cur);
    } catch {
      return windowsPath;
    }
    const match = matchSmbName(seg, listed);
    if (!match) return windowsPath;
    cur = win.join(cur, match);
  }
  return cur;
}
