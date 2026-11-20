/**
 * Move detection must only re-home an asset when the file's name is unchanged
 * (#51) and the name is the EXACT disk basename (#1233): a file named
 * " x.ai" is a different file from "x.ai" even when their contents collide.
 */
export function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** The unique same-basename candidate, or null when zero or ambiguous. */
export function pickMoveCandidate<T extends { relative_path: string }>(
  candidates: T[],
  relativePath: string,
): T | null {
  const target = basenameOf(relativePath);
  const nameMatches = candidates.filter((c) => basenameOf(c.relative_path) === target);
  return nameMatches.length === 1 ? nameMatches[0] : null;
}
