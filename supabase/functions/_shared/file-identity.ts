/**
 * Foolproof move identity tiers (popdam3#1198 item 3; owner ruling 2026-11-19:
 * "there must be a foolproof way to differentiate between 'disappear' and
 * moved. we can't have duplicates").
 *
 * (quick_hash, filename, size) is a SAMPLED hint that collides for
 * template-derived files (KNOWN_QUIRKS #51) and cannot be the proof. The
 * identity recorded at ingest is:
 *   nas_volume  — stable volume/share key (never raw st_dev: Btrfs anonymous
 *                 device numbers change across mounts);
 *   nas_ino     — inode (bigint; arrives as a string over JSON);
 *   content_sha256 — full-content SHA-256 (the cross-volume fallback; a copy
 *                 or a cross-volume move gets a NEW inode).
 *
 * Two questions, one tier ladder:
 *  - moveMatchTier: is the incoming file the SAME FILE INSTANCE as a record's
 *    file (the record should follow it)? A same-volume move or rename keeps
 *    the inode; a cross-volume move keeps the bytes AND the name. A renamed
 *    COPY has neither — it is its own file and must not steal a record.
 *  - artworkMatchTier: does this record's artwork survive at the candidate's
 *    path (hiding the record removes a duplicate, not an artwork)? Content
 *    identity alone answers that, name-free, and the colliding hint is the
 *    last resort.
 *
 * Inode reuse (a deleted file's inode handed to a new file) is the one false
 * positive: an inode match is only proof when the name or the size also
 * agrees — never on inode alone when both differ.
 */
import { basenameOf } from "./move-candidates.ts";

export interface FileIdentity {
  id: string;
  relative_path: string;
  filename: string | null;
  file_size: number | null;
  quick_hash: string | null;
  nas_volume?: string | null;
  /** Inode; bigint column, so PostgREST sends a string. */
  nas_ino?: string | number | null;
  content_sha256?: string | null;
  is_deleted?: boolean | null;
}

export type MoveMatchTier = "inode" | "content_hash";
export type ArtworkMatchTier = "inode" | "content_hash" | "hint";

function sameInode(a: FileIdentity, b: FileIdentity): boolean {
  return !!a.nas_volume && !!b.nas_volume && a.nas_volume === b.nas_volume
    && a.nas_ino != null && b.nas_ino != null && String(a.nas_ino) === String(b.nas_ino);
}

/** Inode reuse guard: proof needs the name or the size to agree as well. */
function inodeConfirmed(a: FileIdentity, b: FileIdentity): boolean {
  const nameAgrees = basenameOf(a.relative_path) === basenameOf(b.relative_path) || (a.filename != null && a.filename === b.filename);
  const sizeAgrees = a.file_size != null && a.file_size === b.file_size;
  return nameAgrees || sizeAgrees;
}

function sameContent(a: FileIdentity, b: FileIdentity): boolean {
  return !!a.content_sha256 && !!b.content_sha256 && a.content_sha256 === b.content_sha256;
}

function sameHint(a: FileIdentity, b: FileIdentity): boolean {
  return !!a.quick_hash && a.quick_hash === b.quick_hash
    && !!a.filename && a.filename === b.filename
    && !!a.file_size && a.file_size === b.file_size;
}

/**
 * Same file instance for move detection: the record follows the file.
 * The content tier keeps the exact disk basename (#1233) — a renamed copy is
 * a different file and must never steal a record.
 */
export function moveMatchTier(a: FileIdentity, b: FileIdentity): MoveMatchTier | null {
  if (sameInode(a, b) && inodeConfirmed(a, b)) return "inode";
  if (sameContent(a, b) && basenameOf(a.relative_path) === basenameOf(b.relative_path)) return "content_hash";
  return null;
}

/**
 * Same artwork for the survivor proof (retire/restore): hiding a record whose
 * artwork survives at another live path removes a duplicate, not an artwork.
 * Content identity is name-free here; the hint is the colliding last resort.
 */
export function artworkMatchTier(a: FileIdentity, b: FileIdentity): ArtworkMatchTier | null {
  if (sameInode(a, b) && inodeConfirmed(a, b)) return "inode";
  if (sameContent(a, b)) return "content_hash";
  if (sameHint(a, b)) return "hint";
  return null;
}
