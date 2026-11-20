/**
 * NAS file identity capture (popdam3#1198 item 3): the stable volume key and
 * the inode recorded at ingest so a move can be PROVEN, not guessed.
 *
 * The volume key is the scanning mount root's share name (e.g. "mac" from
 * "/mnt/nas/mac") — never raw `st_dev`: Btrfs anonymous device numbers change
 * across mounts/reboots, so (dev, ino) pairs would break silently. The
 * constraint to keep: one mount root per bridge configuration, and the root's
 * basename names the filesystem the inodes come from.
 *
 * The inode must be read with `stat(path, { bigint: true })` and sent to the
 * cloud as a STRING: Btrfs inodes exceed 2^53, where JSON numbers lose
 * precision.
 */

/** Stable volume key for a scanning mount root ("/mnt/nas/mac" → "mac"). */
export function volumeKeyOf(mountRoot: string): string {
  const trimmed = mountRoot.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/** Inode for the ingest payload: a decimal string, or null when unavailable. */
export function inodeKey(ino: bigint | number | string | null | undefined): string | null {
  if (ino == null) return null;
  const s = String(ino);
  return /^\d{1,20}$/.test(s) ? s : null;
}
