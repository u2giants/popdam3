/**
 * Resolve a NAS path to the exact name the Windows SMB client lists.
 *
 * Samba's catia/fruit mapping, and any other name translation on the share, can
 * change how a file name looks to Windows. Constructing the path from the
 * database name can then miss the file even though it is there. When the
 * constructed path does not exist, list the parent folder and match by a
 * normalized name, then open the name that is actually listed.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Private-use code points Samba catia uses for characters Windows forbids. */
const CATIA_TO_ASCII: Record<string, string> = {
  "": '"',
  "": "*",
  "": ":",
  "": "<",
  "": ">",
  "": "?",
  "": "\\",
  "": "|",
};

/** Map private-use catia characters back to ASCII. */
export function normalizeSmbName(name: string): string {
  let out = "";
  for (const ch of name) out += CATIA_TO_ASCII[ch] ?? ch;
  return out;
}

/** Same as normalizeSmbName, with the Windows-forbidden characters removed (last-resort key). */
function looseKey(name: string): string {
  return normalizeSmbName(name).replace(/["*:<>?\\|]/g, "");
}

/**
 * Pick the listed name that matches `requested`. Exact (normalized) match first;
 * a loose match only when it is unique. Returns null when nothing matches.
 */
export function matchSmbName(requested: string, listed: string[]): string | null {
  const want = normalizeSmbName(requested);
  const exact = listed.filter((n) => normalizeSmbName(n) === want);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const wantLoose = looseKey(requested);
  const loose = listed.filter((n) => looseKey(n) === wantLoose);
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Return the path with each segment replaced by the name the share actually lists.
 * Returns the input unchanged when it already exists or when a segment cannot be matched.
 */
export function resolveExistingSmbPath(windowsPath: string): string {
  if (existsSync(windowsPath)) return windowsPath;
  const drive = /^[A-Za-z]:\\/.exec(windowsPath);
  if (!drive) return windowsPath;
  const parts = windowsPath.slice(drive[0].length).split("\\").filter((p) => p.length > 0);
  let cur = drive[0];
  for (const seg of parts) {
    const direct = path.join(cur, seg);
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
    cur = path.join(cur, match);
  }
  return cur;
}
