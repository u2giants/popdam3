/**
 * End-of-scan reconciliation of the catalog against the disk (#1117).
 *
 * A file deleted from the NAS used to stay live forever: nothing compared the
 * catalog with the disk. After a complete scan the bridge pages through every
 * live record under the scanned roots; any record the walk did not see is
 * checked on disk, and only a real ENOENT counts as missing.
 *
 * Guards, all of which must hold before anything is retired:
 *  - every scan root lists at least one entry, before and after the checks
 *    (an unmounted share shows an empty folder);
 *  - a record under a folder the walk could not read is left alone, and if
 *    the list of such folders was cut short nothing is retired at all;
 *  - the missing share stays under a ceiling, so a half-mounted volume cannot
 *    empty the catalog.
 * Retirement is a soft delete; a file that returns revives its record.
 */
import { resolveUnderRoot } from "./common/path-containment.js";

export interface LiveAssetPath {
  id: string;
  relative_path: string;
}

export interface ReconcileDeps {
  listLivePaths: (afterId: string | null) => Promise<{ assets: LiveAssetPath[]; next_after_id: string | null }>;
  retire: (assets: Array<{ asset_id: string; confirmed_absent_path: string }>) => Promise<{ retired: number }>;
  stat: (path: string) => Promise<unknown>;
  readdir: (path: string) => Promise<string[]>;
  shouldAbort?: () => boolean;
}

export interface ReconcileOptions {
  mountRoot: string;
  scanRoots: string[];
  seenPaths: ReadonlySet<string>;
  /** Folders the walk could not read, relative to the mount root. */
  skippedDirs: string[];
  /** True when the skipped-folder list hit its cap and may be incomplete. */
  skippedDirsTruncated: boolean;
  /** Refuse when more than this share of the live records under the roots is missing. */
  maxMissingFraction?: number;
  /** ...unless the missing count is at most this (small libraries, small cleanups). */
  minMissingAllowance?: number;
  retireBatchSize?: number;
  statConcurrency?: number;
}

export interface ReconcileResult {
  live_under_roots: number;
  missing: number;
  retired: number;
  refused?: "skipped_dirs" | "root_unreadable" | "too_many_missing" | "aborted";
}

const fold = (p: string) => p.normalize("NFC").toLowerCase();

async function rootsReadable(roots: string[], readdir: ReconcileDeps["readdir"]): Promise<boolean> {
  if (roots.length === 0) return false;
  for (const root of roots) {
    try {
      if ((await readdir(root)).length === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function reconcileMissingFiles(options: ReconcileOptions, deps: ReconcileDeps): Promise<ReconcileResult> {
  const result: ReconcileResult = { live_under_roots: 0, missing: 0, retired: 0 };
  if (options.skippedDirsTruncated) return { ...result, refused: "skipped_dirs" };
  const skipped = options.skippedDirs.map((d) => d.replace(/^\/+|\/+$/g, "")).filter(Boolean);

  const roots = options.scanRoots.map((r) => r.replace(/\/+$/, ""));
  if (!await rootsReadable(roots, deps.readdir)) return { ...result, refused: "root_unreadable" };

  // Guards against a name that differs from the catalog only by letter case or
  // Unicode form: such a file is present, whatever stat says about the old spelling.
  const seenFolded = new Set<string>();
  for (const p of options.seenPaths) seenFolded.add(fold(p));

  const concurrency = options.statConcurrency ?? 8;
  const missing: Array<{ asset_id: string; confirmed_absent_path: string }> = [];
  let afterId: string | null = null;
  do {
    if (deps.shouldAbort?.()) return { ...result, refused: "aborted" };
    const page = await deps.listLivePaths(afterId);
    const toCheck: Array<{ id: string; relative_path: string; fullPath: string }> = [];
    for (const asset of page.assets) {
      if (!asset.relative_path) continue;
      let fullPath: string;
      try {
        fullPath = resolveUnderRoot(options.mountRoot, asset.relative_path);
      } catch {
        continue;
      }
      if (!roots.some((root) => fullPath.startsWith(`${root}/`))) continue;
      result.live_under_roots++;
      if (options.seenPaths.has(asset.relative_path) || seenFolded.has(fold(asset.relative_path))) continue;
      if (skipped.some((d) => asset.relative_path === d || asset.relative_path.startsWith(`${d}/`))) continue;
      toCheck.push({ ...asset, fullPath });
    }
    for (let i = 0; i < toCheck.length; i += concurrency) {
      await Promise.all(toCheck.slice(i, i + concurrency).map(async (asset) => {
        try {
          await deps.stat(asset.fullPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            missing.push({ asset_id: asset.id, confirmed_absent_path: asset.relative_path });
          }
        }
      }));
    }
    afterId = page.next_after_id;
  } while (afterId);

  result.missing = missing.length;
  if (missing.length === 0) return result;

  const ceiling = Math.max(
    options.minMissingAllowance ?? 200,
    Math.floor(result.live_under_roots * (options.maxMissingFraction ?? 0.2)),
  );
  if (missing.length > ceiling) return { ...result, refused: "too_many_missing" };
  if (!await rootsReadable(roots, deps.readdir)) return { ...result, refused: "root_unreadable" };

  const batchSize = options.retireBatchSize ?? 100;
  for (let i = 0; i < missing.length; i += batchSize) {
    if (deps.shouldAbort?.()) return { ...result, refused: "aborted" };
    const { retired } = await deps.retire(missing.slice(i, i + batchSize));
    result.retired += retired;
  }
  return result;
}
