/**
 * Path containment for server-supplied relative paths (#229).
 *
 * Any path that comes from the server (asset.relative_path, job.relative_path,
 * filenames) must stay inside the configured root. Rejects empty paths, NUL
 * bytes, absolute paths (POSIX, drive-letter, UNC), and any ".." segment, then
 * re-checks the resolved result against the resolved root.
 */
import path from "node:path";

type PathApi = typeof path.posix | typeof path.win32;

export class PathContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathContainmentError";
  }
}

/** Throws unless `rel` is a plain relative path with no traversal segments. */
export function assertSafeRelativePath(rel: string): void {
  if (typeof rel !== "string" || rel.trim() === "") {
    throw new PathContainmentError("Unsafe path: empty relative path");
  }
  if (rel.includes("\0")) {
    throw new PathContainmentError("Unsafe path: contains NUL byte");
  }
  if (
    rel.startsWith("/") ||
    rel.startsWith("\\") ||
    /^[A-Za-z]:/.test(rel) ||
    path.posix.isAbsolute(rel) ||
    path.win32.isAbsolute(rel)
  ) {
    throw new PathContainmentError(`Unsafe path: absolute path not allowed (${rel})`);
  }
  if (rel.split(/[\\/]+/).some((seg) => seg === "..")) {
    throw new PathContainmentError(`Unsafe path: ".." segment not allowed (${rel})`);
  }
}

/**
 * Resolves `rel` under `root` and throws if the result escapes `root`.
 * `pathApi` defaults to the host platform; pass path.win32 / path.posix to
 * force semantics (tests, UNC roots).
 */
export function resolveUnderRoot(root: string, rel: string, pathApi: PathApi = path): string {
  assertSafeRelativePath(rel);
  if (typeof root !== "string" || root.trim() === "") {
    throw new PathContainmentError("Unsafe path: empty root");
  }
  const rootAbs = pathApi.resolve(root);
  const full = pathApi.resolve(rootAbs, rel);
  const relToRoot = pathApi.relative(rootAbs, full);
  if (
    relToRoot === "" ||
    relToRoot === ".." ||
    relToRoot.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relToRoot)
  ) {
    throw new PathContainmentError(`Unsafe path: resolves outside root (${rel})`);
  }
  return full;
}
