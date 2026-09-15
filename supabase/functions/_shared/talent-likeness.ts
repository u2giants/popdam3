// Talent likeness for a style-guide file (u2giants/popdam3#132, shared-db #2802/#2911).
//
// Business rule (shared-db docs/style-guides-characters-and-royalties.md §2):
// the flag belongs to the file, and is TRUE/FALSE only when the licensor's
// explicit "With Likeness" / "No Likeness" naming says so. Everything else is
// NULL ("the source gave no answer"), which must never be read as FALSE.
// Only the file's own name is read. Folder paths never count, so a folder such
// as "_TALENT LIKENESS_" leaves its files NULL.
const WITH_LIKENESS = /(^|[^a-z])with[\s_-]*likeness([^a-z]|$)/i;
const NO_LIKENESS = /(^|[^a-z])no[\s_-]*likeness([^a-z]|$)/i;

export function talentLikenessFromFilename(filename: string | null | undefined): boolean | null {
  if (!filename) return null;
  const hasWith = WITH_LIKENESS.test(filename);
  const hasNo = NO_LIKENESS.test(filename);
  if (hasWith === hasNo) return null; // neither, or contradictory naming
  return hasWith;
}
