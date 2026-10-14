/**
 * Samba's catia/fruit mapping shows names containing characters Windows forbids
 * using a private-use code point (U+F000 block). A NAS file named `10"Wallclock.psd`
 * is seen by SMB clients as `10Wallclock.psd`, so the agent must translate
 * each path segment the same way before it opens the file.
 *
 * Mapping (Samba vfs_catia defaults): " *  : < > ? \ |
 */
const SMB_CATIA_MAP: Record<string, string> = {
  '"': "",
  "*": "",
  ":": "",
  "<": "",
  ">": "",
  "?": "",
  "\\": "",
  "|": "",
};

/** Translate one path segment (a single file or folder name) for an SMB client. */
export function toSmbClientSegment(segment: string): string {
  let out = "";
  for (const ch of segment) out += SMB_CATIA_MAP[ch] ?? ch;
  return out;
}

/** Translate a POSIX relative path segment by segment for an SMB client. */
export function toSmbClientRelativePath(relativePath: string): string {
  return relativePath.split("/").map(toSmbClientSegment).join("/");
}
