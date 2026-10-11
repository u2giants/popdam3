/** Moved out of index.ts (#234) — pure move, no behavior change. */
import path from "node:path";
import * as api from "../api-client";
import { logger } from "../logger";

/** @param getMountRoot effective NAS mount root, read when an empty path is browsed. */
export async function handleDirBrowse(cmd: { request_id: string; path: string }, getMountRoot: () => string) {
  const target = cmd.path.trim();
  logger.info("Dir browse requested", { requestId: cmd.request_id, path: target });

  try {
    const { readdir, stat: fsStat } = await import("node:fs/promises");
    let entries: api.DirEntry[];

    if (!target) {
      // Empty path → list the NAS mount root
      const mountRoot = getMountRoot();
      const rawEntries = await readdir(mountRoot, { withFileTypes: true });
      entries = rawEntries.map((e) => ({ name: e.name, is_dir: e.isDirectory() }));
    } else {
      const rawEntries = await readdir(target, { withFileTypes: true });
      entries = await Promise.all(
        rawEntries.map(async (e) => {
          const entry: api.DirEntry = { name: e.name, is_dir: e.isDirectory() };
          if (!e.isDirectory()) {
            try {
              const s = await fsStat(path.join(target, e.name));
              entry.size = s.size;
              entry.modified = s.mtime.toISOString();
            } catch { /* skip */ }
          }
          return entry;
        }),
      );
    }

    await api.reportDirBrowse(cmd.request_id, target, entries);
    logger.info("Dir browse completed", { path: target, count: entries.length });
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).message ?? String(e);
    logger.warn("Dir browse failed", { path: target, error: msg });
    await api.reportDirBrowse(cmd.request_id, target, []);
  }
}
