import { resolveUnderRoot } from "./common/path-containment.js";

interface Deps {
  stat: (path: string) => Promise<unknown>;
  retire: (assetId: string, survivingAssetId: string, confirmedAbsentPath: string) => Promise<{ retired: boolean; reason?: string }>;
  warn: (message: string, details: Record<string, unknown>) => void;
}

async function isConfirmedAbsent(path: string, stat: Deps["stat"]): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Retires same-identity records whose path is gone (docs/KNOWN_QUIRKS.md #81).
 * Only a real ENOENT counts, and only while the new file and the stale path's
 * top-level folder are both readable, so an unmounted share retires nothing.
 * A failure here must never fail the ingest that just succeeded.
 */
export async function retireConfirmedStaleRecords(
  candidates: Array<{ id: string; relative_path: string }>,
  survivingAssetId: string,
  survivingAbsolutePath: string,
  mountRoot: string,
  deps: Deps,
): Promise<void> {
  for (const candidate of candidates) {
    try {
      const fullPath = resolveUnderRoot(mountRoot, candidate.relative_path);
      await deps.stat(survivingAbsolutePath);
      await deps.stat(resolveUnderRoot(mountRoot, candidate.relative_path.split("/")[0]));
      if (!await isConfirmedAbsent(fullPath, deps.stat)) continue;
      await deps.retire(candidate.id, survivingAssetId, candidate.relative_path);
    } catch (e) {
      deps.warn("Stale record check failed; keeping the record", { assetId: candidate.id, error: (e as Error).message });
    }
  }
}
